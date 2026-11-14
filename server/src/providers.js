// =====================================================================
// Social channel providers
// Each provider: OAuth config + a fetcher that turns the platform's API
// response into raw "signals" (genres, hashtags, activity types, titles).
// If no CLIENT_ID is set in .env, the provider runs in DEMO mode and
// returns realistic mock signals so the hackathon demo always works.
// =====================================================================

const env = (k) => process.env[k] || '';

async function getJSON(url, token, extraHeaders = {}) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } });
  if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`);
  return r.json();
}
const hashtags = (txt = '') => (txt.match(/#(\w+)/g) || []).map((h) => h.slice(1));

export const PROVIDERS = {
  instagram: {
    name: 'Instagram',
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    scope: 'user_profile,user_media',
    async fetch(token) {
      const d = await getJSON('https://graph.instagram.com/me/media?fields=caption,media_type&limit=50', token);
      return d.data.flatMap((m) => hashtags(m.caption));
    },
    mock: ['photography', 'streetfood', 'travel', 'cafe', 'sunset'],
  },
  linkedin: {
    name: 'LinkedIn',
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scope: 'openid profile email',
    async fetch(token) {
      // Sign-in with LinkedIn (OIDC) exposes identity only; used for verification.
      const me = await getJSON('https://api.linkedin.com/v2/userinfo', token);
      return ['professional', me.email_verified ? 'verified-work' : null].filter(Boolean);
    },
    mock: ['startups', 'product', 'leadership', 'ai'],
  },
  spotify: {
    name: 'Spotify',
    authUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    scope: 'user-top-read',
    async fetch(token) {
      const d = await getJSON('https://api.spotify.com/v1/me/top/artists?limit=30&time_range=medium_term', token);
      return d.items.flatMap((a) => a.genres);
    },
    mock: ['indie', 'carnatic', 'lo-fi', 'live music'],
  },
  strava: {
    name: 'Strava',
    authUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
    scope: 'activity:read',
    async fetch(token) {
      const d = await getJSON('https://www.strava.com/api/v3/athlete/activities?per_page=50', token);
      return d.map((a) => a.sport_type || a.type);
    },
    mock: ['Hike', 'Run', 'Ride'],
  },
  youtube: {
    name: 'YouTube',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    async fetch(token) {
      const d = await getJSON('https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50', token);
      return d.items.map((s) => s.snippet.title + ' ' + (s.snippet.description || ''));
    },
    mock: ['cooking', 'tech reviews', 'documentary'],
  },
  x: {
    name: 'X / Twitter',
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    scope: 'tweet.read users.read like.read offline.access',
    pkce: true,
    async fetch(token) {
      const me = await getJSON('https://api.twitter.com/2/users/me', token);
      const likes = await getJSON(`https://api.twitter.com/2/users/${me.data.id}/liked_tweets?max_results=50`, token);
      return (likes.data || []).flatMap((t) => hashtags(t.text));
    },
    mock: ['tech', 'cricket', 'startups'],
  },
  facebook: {
    name: 'Facebook',
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scope: 'public_profile,user_likes',
    async fetch(token) {
      const d = await getJSON('https://graph.facebook.com/v19.0/me/likes?fields=name,category&limit=50', token);
      return d.data.map((p) => `${p.name} ${p.category}`);
    },
    mock: ['volunteering', 'family', 'community'],
  },
  goodreads: {
    name: 'Goodreads',
    // Goodreads closed its public API in 2020 — we read the user's PUBLIC shelf RSS instead.
    rss: true,
    async fetch(goodreadsUserId) {
      const r = await fetch(`https://www.goodreads.com/review/list_rss/${goodreadsUserId}?shelf=read`);
      const xml = await r.text();
      return [...xml.matchAll(/<user_shelves>(.*?)<\/user_shelves>/g)].map((m) => m[1]).concat(['books']);
    },
    mock: ['books', 'philosophy', 'sci-fi'],
  },
};

export const isLive = (id) => !!env(`${id.toUpperCase()}_CLIENT_ID`) || (id === 'goodreads' && false);

// ---------------------------------------------------------------------
// Signal → interest + Vibe DNA mapping (keyword taxonomy)
// ---------------------------------------------------------------------
const TAXONOMY = [
  { k: /photo|camera|sunset/i, i: 'Photography', d: { Creativity: 8 } },
  { k: /food|cook|chef|recipe/i, i: 'Cooking', d: { Creativity: 5, Social: 3 } },
  { k: /travel|wander|trip|backpack/i, i: 'Travel', d: { Adventure: 10 } },
  { k: /cafe|coffee/i, i: 'Cafés', d: { Social: 6, Calm: 4 } },
  { k: /startup|founder|vc|entrepreneur/i, i: 'Startups', d: { Ambition: 12 } },
  { k: /product|design/i, i: 'Product', d: { Ambition: 5, Creativity: 5 } },
  { k: /leader|professional|verified-work/i, i: 'Leadership', d: { Ambition: 8 } },
  { k: /\bai\b|machine learning|tech/i, i: 'AI & Tech', d: { Intellect: 10 } },
  { k: /indie|rock|pop|lo-?fi|jazz|live/i, i: 'Live music', d: { Creativity: 6, Social: 4 } },
  { k: /carnatic|hindustani|classical|bollywood|filmi/i, i: 'Indian classical', d: { Calm: 8, Values: 4 } },
  { k: /hike|trek|climb|mountain/i, i: 'Trekking', d: { Adventure: 14, Wellness: 8 } },
  { k: /run|marathon/i, i: 'Running', d: { Wellness: 12 } },
  { k: /ride|cycl|bike/i, i: 'Cycling', d: { Wellness: 8, Adventure: 6 } },
  { k: /yoga|meditat/i, i: 'Yoga', d: { Wellness: 8, Calm: 10 } },
  { k: /book|read|novel|philosoph|sci-?fi|fiction/i, i: 'Books', d: { Intellect: 10, Calm: 5 } },
  { k: /documentar|history|science/i, i: 'Documentaries', d: { Intellect: 8 } },
  { k: /cricket|football|sport/i, i: 'Cricket', d: { Social: 6 } },
  { k: /volunteer|ngo|community|charity/i, i: 'Volunteering', d: { Values: 14, Social: 4 } },
  { k: /family/i, i: 'Family', d: { Values: 10 } },
];

export function extract(rawSignals) {
  const interests = {}; const dna = {};
  for (const s of rawSignals) {
    for (const t of TAXONOMY) {
      if (t.k.test(s)) {
        interests[t.i] = (interests[t.i] || 0) + 1;
        for (const [k, v] of Object.entries(t.d)) dna[k] = Math.min(100, (dna[k] || 0) + v);
      }
    }
  }
  return { interests, dna };
}

export async function pullSignals(id, tokenOrHandle) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown provider ${id}`);
  if (!tokenOrHandle || tokenOrHandle === 'demo') return { mode: 'demo', raw: p.mock };
  return { mode: 'live', raw: await p.fetch(tokenOrHandle) };
}
