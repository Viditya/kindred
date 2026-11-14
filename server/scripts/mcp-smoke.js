#!/usr/bin/env node
// =====================================================================
// Kindred MCP smoke test — calls tools/list and find_matches against
// a running server (default: http://localhost:8787).
// Usage:
//   node server/scripts/mcp-smoke.js
//   KINDRED_TOKEN=<token> node server/scripts/mcp-smoke.js
//   BASE_URL=http://localhost:8787 node server/scripts/mcp-smoke.js
// =====================================================================

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const EMAIL = process.env.KINDRED_EMAIL || 'demo@kindred.app';
const PASSWORD = process.env.KINDRED_PASSWORD || 'demo1234';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GOLD = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function ok(label) { console.log(`  ${GREEN}✓${RESET} ${label}`); }
function fail(label, err) { console.error(`  ${RED}✗${RESET} ${label}: ${err}`); process.exitCode = 1; }
function section(title) { console.log(`\n${BOLD}${GOLD}▸ ${title}${RESET}`); }

// ---- JSON-RPC 2.0 helper -----------------------------------------
async function mcp(token, method, params = {}) {
  const id = Math.random().toString(36).slice(2);
  const body = { jsonrpc: '2.0', id, method, params };
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

// ---- REST helper --------------------------------------------------
async function rest(path, opts = {}, token) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

async function run() {
  console.log(`\n${BOLD}✦ Kindred MCP smoke test${RESET}  →  ${BASE}\n`);

  // 1. Auth
  section('1. Authentication');
  let token = process.env.KINDRED_TOKEN;
  if (!token) {
    try {
      const r = await rest('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
      token = r.token;
      ok(`Login as ${EMAIL}  (trust score: ${r.user.trust})`);
    } catch (e) { fail('Login', e.message); return; }
  } else {
    ok(`Using provided token`);
  }

  // 2. REST: /api/events
  section('2. REST /api/events');
  try {
    const { events, moods } = await rest('/api/events');
    ok(`${events.length} events, ${moods.length} moods`);
    const trekEvents = await rest('/api/events?mood=Fitness+%26+Health');
    ok(`Mood filter "Fitness & Health": ${trekEvents.events.length} events`);
  } catch (e) { fail('/api/events', e.message); }

  // 3. REST: /api/concierge
  section('3. REST /api/concierge');
  try {
    const r = await rest('/api/concierge', { method: 'POST', body: { request: 'Find me a trek buddy for this Sunday' } }, token);
    ok(`Reply: "${r.reply.slice(0, 80)}…"`);
    ok(`Matches returned: ${r.matches.length}  ·  Events: ${r.events.length}`);
    ok(`Powered by: ${r.powered}`);
  } catch (e) { fail('/api/concierge', e.message); }

  // 4. MCP: initialize + tools/list
  section('4. MCP tools/list');
  try {
    const result = await mcp(token, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'kindred-smoke', version: '1.0.0' },
    });
    ok(`Server: ${result.serverInfo?.name}  v${result.serverInfo?.version}`);
  } catch (e) { fail('initialize', e.message); }

  try {
    const result = await mcp(token, 'tools/list');
    const tools = result.tools || [];
    ok(`${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
    const expected = ['spotify_get_signals', 'strava_get_signals', 'get_vibe_profile', 'find_matches', 'suggest_meetups', 'explore_events', 'plan_date'];
    for (const t of expected) {
      if (tools.find((x) => x.name === t)) ok(`  tool present: ${t}`);
      else fail(`  tool missing`, t);
    }
  } catch (e) { fail('tools/list', e.message); }

  // 5. MCP: get_vibe_profile
  section('5. MCP get_vibe_profile');
  try {
    const r = await mcp(token, 'tools/call', { name: 'get_vibe_profile', arguments: {} });
    const profile = JSON.parse(r.content[0].text);
    ok(`trust: ${profile.trust}  ·  channels: ${Object.keys(profile.channels).join(', ')}`);
    ok(`top interests: ${Object.keys(profile.interests).slice(0, 4).join(', ')}`);
  } catch (e) { fail('get_vibe_profile', e.message); }

  // 6. MCP: find_matches
  section('6. MCP find_matches');
  try {
    const r = await mcp(token, 'tools/call', { name: 'find_matches', arguments: { intent: 'Treks & outdoors', limit: 3 } });
    const matches = JSON.parse(r.content[0].text);
    if (Array.isArray(matches)) {
      ok(`${matches.length} matches returned`);
      matches.forEach((m) => ok(`  ${m.name} (${m.area}) — ${m.total}%  shared: ${(m.shared||[]).join(', ')}`));
    } else {
      ok(`Response: ${r.content[0].text.slice(0, 100)}`);
    }
  } catch (e) { fail('find_matches', e.message); }

  // 7. MCP: explore_events
  section('7. MCP explore_events');
  try {
    const r = await mcp(token, 'tools/call', { name: 'explore_events', arguments: { match_interests: true } });
    const events = JSON.parse(r.content[0].text);
    ok(`${events.length} events ranked by interest overlap`);
    ok(`  top event: ${events[0]?.t}  (${events[0]?.cat})`);
  } catch (e) { fail('explore_events', e.message); }

  // 8. MCP: plan_date
  section('8. MCP plan_date');
  try {
    const r = await mcp(token, 'tools/call', { name: 'plan_date', arguments: { match_name: 'Rohan', mood: 'trekking', budget: 'low' } });
    const plan = JSON.parse(r.content[0].text);
    ok(`Meeting: ${plan.meeting}`);
    ok(`Venue: ${plan.suggestedVenue?.name}  @ ${plan.suggestedVenue?.where}`);
    ok(`Icebreaker: "${plan.icebreaker?.slice(0, 70)}…"`);
    ok(`Safety checklist: ${plan.safetyChecklist?.length} items`);
  } catch (e) { fail('plan_date', e.message); }

  // 9. MCP: suggest_meetups
  section('9. MCP suggest_meetups');
  try {
    const r = await mcp(token, 'tools/call', { name: 'suggest_meetups', arguments: {} });
    const meetups = JSON.parse(r.content[0].text);
    ok(`${meetups.length} meetups`);
    ok(`  top: "${meetups[0]?.t}"  unlocked: ${meetups[0]?.unlocked}`);
  } catch (e) { fail('suggest_meetups', e.message); }

  // Summary
  const exitCode = process.exitCode || 0;
  console.log(`\n${exitCode === 0 ? GREEN + '✦ All smoke tests passed' : RED + '✦ Some tests failed'}${RESET}\n`);
}

run().catch((e) => { console.error(RED + '✗ Unexpected error: ' + RESET, e); process.exit(1); });
