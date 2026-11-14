import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openPilotStore(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  let data = fs.existsSync(filename)
    ? JSON.parse(fs.readFileSync(filename, 'utf8'))
    : { members: [], sessions: {}, usedInvites: {}, invitations: [], blocks: [], reports: [] };

  return {
    read: () => data,
    update(change) {
      const next = structuredClone(data);
      const result = change(next);
      const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600, flush: true });
        fs.renameSync(temporary, filename);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
      data = next;
      return result;
    },
  };
}

const inviteLifetime = 7 * 24 * 60 * 60 * 1000;
const signature = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('base64url');

export function makeInvite(secret) {
  const body = (Date.now() + inviteLifetime) + '.' + crypto.randomBytes(12).toString('base64url');
  return body + '.' + signature(body, secret);
}

export function validInvite(code, secret) {
  const [until, nonce, mac] = code.split('.');
  if (!/^\d{13}$/.test(until) || !/^[\w-]{16}$/.test(nonce) || !/^[\w-]{43}$/.test(mac) || Number(until) <= Date.now()) return false;
  const body = until + '.' + nonce;
  return code === body + '.' + mac && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(signature(body, secret)));
}

export const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');
