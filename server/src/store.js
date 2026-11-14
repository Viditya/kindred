// Tiny JSON-file store (swap for Supabase/Firebase/Postgres in production)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = process.env.DB_FILE || path.resolve('data/db.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });
let db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { users: {}, sessions: {} };
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
const verify = (pw, stored) => {
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 64));
};

export function signup({ email, password, name }) {
  email = String(email || '').trim().toLowerCase();
  if (!email.includes('@') || String(password || '').length < 6) throw new Error('Valid email and 6+ char password required');
  if (db.users[email]) throw new Error('Account already exists — please log in');
  db.users[email] = {
    email, pw: hash(password),
    profile: { name: name || email.split('@')[0], age: '', city: 'Bengaluru', bio: '', job: '', intent: [], answers: {} },
    channels: {},          // { spotify: { mode, token, connectedAt, interests, dna } }
    verified: [],
    createdAt: Date.now(),
  };
  save();
  return login({ email, password });
}

export function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const u = db.users[email];
  if (!u || !verify(password || '', u.pw)) throw new Error('Invalid email or password');
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { email, at: Date.now() };
  save();
  return { token, user: publicUser(u) };
}

export const logout = (token) => { delete db.sessions[token]; save(); };
export const userByToken = (token) => db.sessions[token] && db.users[db.sessions[token].email];
export const userByEmail = (email) => db.users[String(email).toLowerCase()];

export function updateUser(u, patch) { Object.assign(u, patch); save(); return u; }

export function aggregate(u) {
  const interests = {}; const dna = {};
  for (const c of Object.values(u.channels)) {
    for (const [k, v] of Object.entries(c.interests)) interests[k] = (interests[k] || 0) + v;
    for (const [k, v] of Object.entries(c.dna)) dna[k] = Math.min(100, (dna[k] || 0) + v);
  }
  for (const k of u.hiddenInterests || []) delete interests[k];
  return { interests, dna };
}

export function trustScore(u) {
  const pts = { phone: 15, selfie: 25, id: 20, work: 10 };
  let s = u.verified.reduce((a, v) => a + (pts[v] || 0), 0);
  s += Math.min(15, Object.keys(u.channels).length * 4);
  const a = u.profile.answers || {};
  s += (['weekend', 'social', 'values', 'pace'].filter((k) => a[k]).length + (u.profile.intent.length ? 1 : 0)) * 3;
  return Math.min(100, s);
}

export function publicUser(u) {
  const { interests, dna } = aggregate(u);
  return {
    email: u.email, profile: u.profile, verified: u.verified,
    channels: Object.fromEntries(Object.entries(u.channels).map(([k, c]) => [k, { mode: c.mode, connectedAt: c.connectedAt }])),
    interests, dna, trust: trustScore(u),
  };
}
