import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { digest, makeInvite, openPilotStore, validInvite } from './pilot-store.js';

const secret = process.env.PILOT_SECRET;
if (!secret || secret.length < 32) throw new Error('Set PILOT_SECRET in .env.pilot (at least 32 random characters).');
const db = openPilotStore(path.resolve(process.env.PILOT_DB_FILE || 'data/pilot.json'));
const activities = ['Coffee chat', 'Walk', 'Trek', 'Book meetup', 'Board games'];
const fields = {
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/),
  password: z.string().min(12).max(128),
};
const credentials = z.object(fields);
const signup = credentials.extend({
  name: z.string().trim().min(1).max(50),
  code: z.string().trim().max(100),
  adult: z.literal(true),
});
const minute = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const profile = z.object({
  name: z.string().trim().min(1).max(50),
  plan: z.object({
    activity: z.enum(activities),
    day: z.iso.date(),
    from: time,
    until: time,
    area: z.string().trim().min(2).max(60),
    interests: z.array(z.string().trim().min(1).max(30)).min(1).max(8),
  }).nullable(),
});
const proposal = z.object({
  time,
  place: z.string().trim().min(3).max(120),
});
const report = z.object({ reason: z.string().trim().min(4).max(400) });
const normalized = (text) => text.normalize('NFKC').toLowerCase();
const indiaDay = (ms = Date.now()) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const startTime = (day, clock) => Date.parse(day + 'T' + clock + ':00+05:30');
const publicMember = ({ id, name, plan }) => ({ id, name, area: plan?.area });
const ownMember = ({ id, name, plan }) => ({ id, name, plan });

function windowTogether(a, b) {
  if (!a || !b || a.activity !== b.activity || a.day !== b.day) return null;
  const from = a.from > b.from ? a.from : b.from;
  const until = a.until < b.until ? a.until : b.until;
  if (minute(until) - minute(from) < 30 || startTime(a.day, until) <= Date.now()) return null;
  return { from, until };
}

function blocked(data, a, b) {
  return data.blocks.some(([source, target]) => (source === a && target === b) || (source === b && target === a));
}

function neighbors(data, viewer) {
  if (!viewer.plan) return [];
  const tags = new Set(viewer.plan.interests.map(normalized));
  const activeInvites = new Set(data.invitations
    .filter((i) => ['pending', 'accepted'].includes(i.status) && i.day === viewer.plan.day &&
      i.activity === viewer.plan.activity && startTime(i.day, i.time) > Date.now())
    .map((i) => i.from === viewer.id ? i.to : i.to === viewer.id ? i.from : null));
  return data.members.flatMap((member) => {
    if (member.id === viewer.id || activeInvites.has(member.id) || blocked(data, viewer.id, member.id)) return [];
    const overlap = windowTogether(viewer.plan, member.plan);
    if (!overlap) return [];
    const interests = member.plan.interests;
    const shared = interests.filter((tag) => tags.has(normalized(tag)));
    const union = new Set([...tags, ...interests.map(normalized)]);
    const local = normalized(viewer.plan.area) === normalized(member.plan.area);
    const score = 2 * shared.length / union.size + (local ? 1 : 0);
    return [{ ...publicMember(member), shared, overlap, score }];
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 5).map(({ score, ...match }) => match);
}

function invitationsFor(data, viewer) {
  return data.invitations.flatMap((invitation) => {
    const outgoing = invitation.from === viewer.id;
    if (!outgoing && invitation.to !== viewer.id) return [];
    const peerId = outgoing ? invitation.to : invitation.from;
    const peer = data.members.find((member) => member.id === peerId);
    if (!peer || blocked(data, viewer.id, peerId) || invitation.status === 'withdrawn') return [];
    const { id, activity, day, time, place, attended } = invitation;
    const past = startTime(day, time) <= Date.now();
    const status = past && invitation.status === 'pending' ? 'expired' : invitation.status;
    return [{ id, peer: publicMember(peer), outgoing, activity, day, time, place, status, past,
      attended: attended.includes(viewer.id), bothAttended: attended.length === 2 }];
  }).reverse();
}

const sessionCookie = 'kindred_pilot';
const ttl = 7 * 24 * 60 * 60 * 1000;
const passwordHash = (password, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
const dummyHash = '00000000000000000000000000000000:' + '0'.repeat(128);

function serve() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' });
      const origin = req.get('origin');
      const trustedOrigin = !origin || ['https://', 'http://'].some((prefix) => origin === prefix + req.get('host'));
      if (!trustedOrigin || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Open Kindred directly.' });
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));

  const attempts = new Map();
  const windowMs = 15 * 60 * 1000;
  function limitAuth(req, res, next) {
    const now = Date.now();
    for (const [key, limit] of attempts) if (limit.until <= now) attempts.delete(key);
    const key = (process.env.PILOT_CLOUDFLARE === '1' && req.get('cf-connecting-ip')) || req.ip;
    const limit = attempts.get(key) || { count: 0, until: now + windowMs };
    attempts.set(key, limit);
    if (++limit.count > 30 || attempts.size > 1000) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    next();
  }
  app.use(['/api/signup', '/api/login'], limitAuth);

  const localHttp = (req) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get('host') || '') && req.get('x-forwarded-proto') !== 'https';
  const cookieOptions = (req) => ({ httpOnly: true, sameSite: 'strict', secure: !localHttp(req), path: '/' });
  const cookie = (req) => (req.get('cookie') || '').match(/(?:^|;\s*)kindred_pilot=([a-f0-9]{64})(?:;|$)/)?.[1];
  const auth = (req, res, next) => {
    const token = cookie(req);
    const data = db.read();
    req.session = token && digest(token);
    const session = data.sessions[req.session];
    req.member = session && session.expires > Date.now() && data.members.find((member) => member.id === session.memberId);
    if (!req.member) return res.status(401).json({ error: 'Sign in to continue.' });
    next();
  };
  function newSession(req, res, token) {
    res.cookie(sessionCookie, token, { ...cookieOptions(req), maxAge: ttl });
  }
  function addSession(data, memberId) {
    const now = Date.now();
    for (const [key, session] of Object.entries(data.sessions)) if (session.expires <= now) delete data.sessions[key];
    const token = crypto.randomBytes(32).toString('hex');
    data.sessions[digest(token)] = { memberId, expires: now + ttl };
    return token;
  }
  function reject(message, status = 400) {
    throw Object.assign(new Error(message), { status });
  }
  function input(schema, value, message = 'Check the information you entered.') {
    const parsed = schema.safeParse(value);
    if (!parsed.success) reject(message);
    return parsed.data;
  }
  app.get('/api/config', (_req, res) => res.json({ activities, today: indiaDay(), lastDay: indiaDay(Date.now() + 14 * 86400000) }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.post('/api/signup', (req, res) => {
    const { code, handle, password, name } = input(signup, req.body, 'Use a valid invite, a 3–24 character username and a password of at least 12 characters. Confirm you’re 18 or older.');
    const codeId = digest(code);
    if (!validInvite(code, secret) || Object.hasOwn(db.read().usedInvites, codeId)) reject('This registration code is invalid, expired or already used.');
    if (db.read().members.some((member) => member.handle === handle)) reject('That username is taken.', 409);
    const member = { id: crypto.randomUUID(), handle, name, password: passwordHash(password), plan: null };
    const token = db.update((data) => {
      for (const [key, expires] of Object.entries(data.usedInvites)) if (expires <= Date.now()) delete data.usedInvites[key];
      data.usedInvites[codeId] = Number(code.split('.')[0]);
      data.members.push(member);
      return addSession(data, member.id);
    });
    newSession(req, res, token);
    res.status(201).json(ownMember(member));
  });
  app.post('/api/login', (req, res) => {
    const { handle, password } = input(credentials, req.body, 'Username or password is incorrect.');
    const member = db.read().members.find((m) => m.handle === handle);
    const expected = member?.password || dummyHash;
    const actual = passwordHash(password, expected.split(':')[0]);
    const verified = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    if (!member || !verified) reject('Username or password is incorrect.', 401);
    const token = db.update((data) => addSession(data, member.id));
    newSession(req, res, token);
    res.json(ownMember(member));
  });
  app.post('/api/logout', auth, (req, res) => {
    db.update((data) => { delete data.sessions[req.session]; });
    res.clearCookie(sessionCookie, cookieOptions(req)).json({ ok: true });
  });
  app.get('/api/me', auth, (req, res) => res.json(ownMember(req.member)));
  app.put('/api/me', auth, (req, res) => {
    const next = input(profile, req.body);
    if (next.plan) {
      const { day, from, until, interests } = next.plan;
      if (day < indiaDay() || day > indiaDay(Date.now() + 14 * 86400000) ||
          startTime(day, until) <= Date.now() || minute(until) - minute(from) < 30) {
        reject('Pick a date within the next two weeks and a time window of at least 30 minutes that hasn’t ended.');
      }
      next.plan.interests = [...new Map(interests.map((item) => [normalized(item), item])).values()];
    }
    const updated = db.update((data) => {
      const member = data.members.find((m) => m.id === req.member.id);
      const previous = JSON.stringify(member.plan);
      Object.assign(member, next);
      if (previous !== JSON.stringify(member.plan)) {
        for (const invite of data.invitations) {
          if (invite.status === 'pending' && [invite.from, invite.to].includes(member.id)) {
            const from = data.members.find((m) => m.id === invite.from);
            const to = data.members.find((m) => m.id === invite.to);
            const overlap = windowTogether(from?.plan, to?.plan);
            if (!overlap || from.plan.day !== invite.day || from.plan.activity !== invite.activity ||
                invite.time < overlap.from || invite.time >= overlap.until) invite.status = 'withdrawn';
          }
        }
      }
      return ownMember(member);
    });
    res.json(updated);
  });
  app.delete('/api/me', auth, (req, res) => {
    const id = req.member.id;
    db.update((data) => {
      data.members = data.members.filter((member) => member.id !== id);
      for (const [key, session] of Object.entries(data.sessions)) if (session.memberId === id) delete data.sessions[key];
      data.invitations = data.invitations.filter((i) => i.from !== id && i.to !== id);
      data.blocks = data.blocks.filter((pair) => !pair.includes(id));
      data.reports = data.reports.filter((r) => r.from !== id && r.to !== id);
    });
    res.clearCookie(sessionCookie, cookieOptions(req)).json({ ok: true });
  });
  app.get('/api/matches', auth, (req, res) => res.json(neighbors(db.read(), req.member)));
  app.get('/api/invitations', auth, (req, res) => res.json(invitationsFor(db.read(), req.member)));
  app.post('/api/invitations/:peer', auth, (req, res) => {
    const { time, place } = input(proposal, req.body, 'Enter a time and public meetup spot.');
    const { member } = req;
    const data = db.read();
    const peer = data.members.find((m) => m.id === req.params.peer);
    const match = neighbors(data, member).find((m) => m.id === peer?.id);
    if (!match) reject('This suggestion is no longer available. Refresh matches.', 409);
    const { activity, day } = member.plan;
    if (time < match.overlap.from || time >= match.overlap.until || startTime(day, time) <= Date.now()) {
      reject('Choose a future time inside the shared window.');
    }
    db.update((draft) => {
      draft.invitations.push({ id: crypto.randomUUID(), from: member.id, to: peer.id, activity, day, time, place,
        status: 'pending', attended: [] });
    });
    res.status(201).json({ ok: true });
  });
  app.post('/api/invitations/:id/:action', auth, (req, res) => {
    const { id, action } = req.params;
    const data = db.read();
    const viewer = req.member.id;
    const card = invitationsFor(data, req.member).find((i) => i.id === id);
    if (!card) reject('Invitation unavailable.', 404);
    const incoming = !card.outgoing;
    const pending = card.status === 'pending';
    const accepted = card.status === 'accepted';
    const allowed = {
      accept: incoming && pending,
      decline: incoming && pending,
      cancel: !card.past && ((!incoming && pending) || accepted),
      attended: accepted && card.past,
    };
    if (!Object.hasOwn(allowed, action) || !allowed[action]) reject('This action is no longer available.', 409);
    db.update((draft) => {
      const invitation = draft.invitations.find((i) => i.id === id);
      if (action === 'attended') {
        if (!invitation.attended.includes(viewer)) invitation.attended.push(viewer);
        return;
      }
      invitation.status = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[action];
    });
    res.json({ ok: true });
  });
  app.post('/api/members/:peer/:action', auth, (req, res) => {
    const { peer, action } = req.params;
    const data = db.read();
    const id = req.member.id;
    const visible = neighbors(data, req.member).some((m) => m.id === peer) ||
      invitationsFor(data, req.member).some((invite) => invite.peer.id === peer);
    if (!visible || !['block', 'report'].includes(action)) reject('Member unavailable.', 404);
    const reason = action === 'report' ? input(report, req.body, 'Enter a short reason for the report.').reason : null;
    db.update((draft) => {
      draft.blocks.push([id, peer]);
      if (reason) draft.reports.push({ from: id, to: peer, reason, at: new Date().toISOString() });
    });
    res.json({ ok: true });
  });

  const frontend = fileURLToPath(new URL('../pilot/', import.meta.url));
  for (const [route, filename] of [['/', 'index.html'], ['/pilot.css', 'pilot.css'], ['/pilot.js', 'pilot.js']]) {
    app.get(route, (_req, res) => res.sendFile(filename, { root: frontend }));
  }
  app.use((_req, res) => res.status(404).json({ error: 'Page not found.' }));
  app.use((error, _req, res, _next) => {
    if (error.status && error.status < 500) return res.status(error.status).json({
      error: ['entity.parse.failed', 'entity.too.large'].includes(error.type) ? 'The request is invalid.' : error.message,
    });
    console.error('Pilot request failed:', error.code || error.name);
    res.status(500).json({ error: 'Couldn’t save that. Try again.' });
  });
  const port = z.coerce.number().int().min(1).max(65535).parse(process.env.PILOT_PORT || 8788);
  const host = process.env.PILOT_HOST || '127.0.0.1';
  app.listen(port, host, () => console.log('Kindred pilot listening on http://' + host + ':' + port));
}

const command = process.argv[2];
if (command === 'invites') {
  const count = z.coerce.number().int().min(1).max(50).parse(process.argv[3] || 1);
  for (let i = 0; i < count; i++) console.log(makeInvite(secret));
} else if (command === 'summary') {
  const { members, invitations, reports } = db.read();
  console.log(JSON.stringify({
    members: members.length,
    searchableProfiles: members.filter((member) => member.plan && startTime(member.plan.day, member.plan.until) > Date.now()).length,
    sent: invitations.length,
    accepted: invitations.filter((invite) => invite.status === 'accepted').length,
    confirmedMeetups: invitations.filter((invite) => invite.attended.length === 2).length,
    reports,
  }, null, 2));
} else if (!command) {
  serve();
} else {
  throw new Error('Unknown pilot command');
}
