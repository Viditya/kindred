// =====================================================================
// Kindred API + MCP (Streamable HTTP) server
//   REST  : /api/auth/*, /api/me, /api/connect/:channel, /api/oauth/*
//           /api/events, /api/concierge
//   MCP   : POST /mcp   (Authorization: Bearer <session token>)
//   Web   : serves ../index.html at /
// =====================================================================
import 'node:process';
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as store from './store.js';
import { PROVIDERS, isLive } from './providers.js';
import { buildMcpServer, connectChannel } from './mcp.js';
import { EVENTS, MOODS } from './events.js';
import { PEOPLE, compat } from './matching.js';

try { process.loadEnvFile?.('.env'); } catch {}
const PORT = process.env.PORT || 8787;
const BASE = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Seed demo account so the IBM Bob live demo works with zero setup ----
async function seedDemo() {
  try {
    const email = 'demo@kindred.app';
    if (!store.userByEmail(email)) {
      store.signup({ email, password: 'demo1234', name: 'Demo User' });
    }
    const u = store.userByEmail(email);
    // Pre-connect Spotify, Strava and Instagram in demo mode so matches unlock
    for (const id of ['spotify', 'strava', 'instagram', 'linkedin', 'goodreads']) {
      if (!u.channels[id]) await connectChannel(u, id, 'demo');
    }
    // Pre-verify phone + selfie so trust score ≥ 60
    for (const v of ['phone', 'selfie', 'id']) {
      if (!u.verified.includes(v)) u.verified.push(v);
    }
    // Pre-fill intent + quiz answers
    u.profile.intent = ['Treks & outdoors', 'Coffee chats', 'Travel buddies'];
    u.profile.answers = { weekend: 'Sunrise trek', social: 'The one starting conversations', values: 'Curiosity', pace: "Spontaneous — let's go!" };
    u.profile.name = 'Demo User';
    u.profile.age = '28';
    u.profile.city = 'Indiranagar, Bengaluru';
    u.profile.bio = 'Into sunrise treks, filter coffee and finding good people. Built this app with IBM Bob.';
    store.updateUser(u, {});
    console.log(`\n  ✦ Demo account ready: demo@kindred.app / demo1234`);
    console.log(`  ✦ Trust score: ${store.trustScore(u)}/100  ·  Channels: ${Object.keys(u.channels).join(', ')}`);
  } catch (e) { /* account may already exist with sessions from prior run */ }
}
await seedDemo();

const app = express();
app.use(express.json());
app.use((req, res, next) => { // CORS so the GitHub Pages front-end can call the API
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token;
const auth = (req, res, next) => {
  const u = store.userByToken(bearer(req));
  if (!u) return res.status(401).json({ error: 'Please log in' });
  req.user = u; next();
};
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(400).json({ error: e.message }); } };

// ---------------- Auth ----------------
app.post('/api/auth/signup', wrap((req) => store.signup(req.body)));
app.post('/api/auth/login', wrap((req) => store.login(req.body)));
app.post('/api/auth/logout', auth, wrap((req) => { store.logout(bearer(req)); return { ok: true }; }));

// ---------------- Profile ----------------
app.get('/api/me', auth, wrap((req) => store.publicUser(req.user)));
app.put('/api/me', auth, wrap((req) => {
  const { profile = {}, hiddenInterests } = req.body;
  const allowed = ['name', 'age', 'city', 'bio', 'job', 'intent', 'answers'];
  for (const k of allowed) if (k in profile) req.user.profile[k] = profile[k];
  if (hiddenInterests) req.user.hiddenInterests = hiddenInterests;
  store.updateUser(req.user, {});
  return store.publicUser(req.user);
}));
app.post('/api/verify/:kind', auth, wrap((req) => {
  if (!req.user.verified.includes(req.params.kind)) req.user.verified.push(req.params.kind);
  store.updateUser(req.user, {});
  return store.publicUser(req.user);
}));

// ---------------- Social channels ----------------
app.get('/api/channels', (req, res) =>
  res.json(Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, live: isLive(id) }))));

const pending = new Map(); // state → { email, id, verifier }
app.post('/api/connect/:id', auth, wrap(async (req) => {
  const id = req.params.id; const p = PROVIDERS[id];
  if (!p) throw new Error('Unknown channel');
  if (!isLive(id) || p.rss) {
    await connectChannel(req.user, id, p.rss && req.body.handle ? req.body.handle : 'demo');
    return { connected: true, user: store.publicUser(req.user) };
  }
  const state = crypto.randomBytes(12).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  pending.set(state, { email: req.user.email, id, verifier, returnTo: req.body.returnTo });
  const q = new URLSearchParams({
    client_id: process.env[`${id.toUpperCase()}_CLIENT_ID`], redirect_uri: `${BASE}/api/oauth/${id}/callback`,
    response_type: 'code', scope: p.scope, state,
    ...(p.pkce ? { code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' } : {}),
  });
  return { authUrl: `${p.authUrl}?${q}` };
}));

app.get('/api/oauth/:id/callback', async (req, res) => {
  const st = pending.get(req.query.state); pending.delete(req.query.state);
  if (!st || st.id !== req.params.id) return res.status(400).send('Invalid OAuth state');
  try {
    const id = st.id; const p = PROVIDERS[id];
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code: req.query.code, redirect_uri: `${BASE}/api/oauth/${id}/callback`,
      client_id: process.env[`${id.toUpperCase()}_CLIENT_ID`], client_secret: process.env[`${id.toUpperCase()}_CLIENT_SECRET`],
      ...(p.pkce ? { code_verifier: st.verifier } : {}),
    });
    const r = await fetch(p.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const tok = await r.json();
    if (!tok.access_token) throw new Error(JSON.stringify(tok));
    await connectChannel(store.userByEmail(st.email), id, tok.access_token);
    res.redirect(`${st.returnTo || BASE + '/'}#connected=${id}`);
  } catch (e) { res.status(500).send(`OAuth failed: ${e.message}`); }
});

app.delete('/api/connect/:id', auth, wrap((req) => {
  delete req.user.channels[req.params.id]; store.updateUser(req.user, {});
  return store.publicUser(req.user);
}));

// ---------------- Events ----------------
app.get('/api/events', (req, res) => {
  const { mood } = req.query;
  const list = mood ? EVENTS.filter((e) => e.cat === mood) : EVENTS;
  res.json({ events: list, moods: MOODS });
});

// ---------------- AI Concierge ----------------
// Rule-based template (always works). Upgrade to watsonx.ai when WATSONX_API_KEY is set.
async function watsonxReply(prompt, context) {
  const key = process.env.WATSONX_API_KEY;
  const projectId = process.env.WATSONX_PROJECT_ID;
  const url = process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com';
  if (!key || !projectId) return null;
  try {
    const body = {
      model_id: process.env.WATSONX_MODEL || 'ibm/granite-3-3-8b-instruct',
      input: `You are Kindred, a friendly concierge for a Bengaluru social meetup app.\nContext about the user:\n${JSON.stringify(context, null, 2)}\n\nUser request: "${prompt}"\n\nReply in 2-3 short sentences. Mention 1–2 specific matches by name and 1 event by name. Be warm and human.`,
      parameters: { decoding_method: 'greedy', max_new_tokens: 180, stop_sequences: ['\n\n'] },
      project_id: projectId,
    };
    const r = await fetch(`${url}/ml/v1/text/generation?version=2023-05-29`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.results?.[0]?.generated_text?.trim() || null;
  } catch { return null; }
}

function ruleBasedReply(request, matches, events) {
  const lc = request.toLowerCase();
  const isTrek = /trek|hike|nandi|outdoor/i.test(lc);
  const isFood = /food|eat|restaurant|cafe|coffee/i.test(lc);
  const isDate = /date|dating|romance|romantic/i.test(lc);
  const isTravel = /travel|trip|weekend|coorg|hampi/i.test(lc);

  let verb = 'meet up with someone';
  if (isTrek) verb = 'go trekking';
  if (isFood) verb = 'explore some food spots';
  if (isDate) verb = 'plan a date';
  if (isTravel) verb = 'plan a trip';

  const names = matches.slice(0, 2).map((m) => m.name);
  const event = events[0];
  return `Based on your Vibe DNA, ${names.join(' and ')} are your best bets to ${verb} — you share key interests and your intent aligns. ${event ? `For the experience itself, check out **${event.t}** (${event.when} at ${event.where}).` : ''} Want me to plan the full meetup with safety features?`;
}

app.post('/api/concierge', auth, wrap(async (req) => {
  const { request } = req.body;
  if (!request) throw new Error('request is required');

  const u = req.user;
  const me = { ...store.aggregate(u), profile: u.profile, channels: Object.keys(u.channels).length };
  const ts = store.trustScore(u);

  // Find top matches
  const ranked = ts >= 60
    ? PEOPLE.map((p) => ({ name: p.n, age: p.a, area: p.c, job: p.job, lookingFor: p.intent, ...compat(me, p) }))
        .sort((a, b) => b.total - a.total).slice(0, 3)
    : [];

  // Find relevant events
  const lc = request.toLowerCase();
  const myInterests = new Set(Object.keys(me.interests));
  const relevantEvents = EVENTS.filter((e) =>
    e.tags.some((t) => myInterests.has(t)) ||
    e.cat.toLowerCase().split(/\s+/).some((w) => lc.includes(w))
  ).slice(0, 2);

  // Build reply
  const context = { interests: Object.keys(me.interests).slice(0, 8), trustScore: ts, topMatches: ranked.slice(0, 2).map((m) => ({ name: m.name, match: m.total + '%', shared: m.shared })) };
  const aiText = await watsonxReply(request, context);
  const replyText = aiText || ruleBasedReply(request, ranked, relevantEvents);
  const powered = process.env.WATSONX_API_KEY ? 'IBM watsonx.ai (Granite) · Built with IBM Bob' : 'Rule-based · Upgrade by adding WATSONX_API_KEY · Built with IBM Bob';

  return { reply: replyText, matches: ranked.slice(0, 3), events: relevantEvents, powered };
}));

// ---------------- MCP over Streamable HTTP ----------------
app.post('/mcp', async (req, res) => {
  const u = store.userByToken(bearer(req));
  if (!u) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: pass your Kindred session token as Bearer' }, id: null });
  const server = buildMcpServer(() => u);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // stateless
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get('/mcp', (req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Stateless MCP — use POST' }, id: null }));

// ---------------- Web app ----------------
app.use(express.static(path.resolve(__dirname, '../..'), { index: 'index.html' }));

app.listen(PORT, () => {
  console.log(`\n✦ Kindred running → ${BASE}`);
  console.log(`  MCP endpoint : ${BASE}/mcp`);
  console.log(`  Events API   : ${BASE}/api/events`);
  console.log(`  Concierge    : ${BASE}/api/concierge\n`);
  console.log('  IBM Bob MCP config (paste into Bob → Settings → MCP Servers):');
  console.log('  Login as demo@kindred.app / demo1234, then copy config from Profile page.\n');
});
