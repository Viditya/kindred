// =====================================================================
// Kindred MCP server — exposes each social channel + matching as MCP tools
// so any MCP client (IBM Bob, Claude, Cursor, watsonx Orchestrate…) can
// read a user's consented social signals and plan meetups.
// =====================================================================
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PROVIDERS, pullSignals, extract } from './providers.js';
import { aggregate, publicUser, trustScore, updateUser } from './store.js';
import { PEOPLE, MEETUPS, compat } from './matching.js';
import { EVENTS } from './events.js';

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });

export async function connectChannel(user, id, token = 'demo') {
  const { mode, raw } = await pullSignals(id, token);
  const { interests, dna } = extract(raw);
  user.channels[id] = { mode, token: mode === 'live' ? token : undefined, connectedAt: Date.now(), interests, dna };
  updateUser(user, {});
  return { channel: PROVIDERS[id].name, mode, interests, dna };
}

export function buildMcpServer(getUser) {
  const server = new McpServer({ name: 'kindred-social', version: '1.1.0' });
  const ids = Object.keys(PROVIDERS);

  // ---- One tool per social app ------------------------------------
  for (const id of ids) {
    server.registerTool(
      `${id}_get_signals`,
      {
        title: `${PROVIDERS[id].name} — interest signals`,
        description: `Read the signed-in user's consented ${PROVIDERS[id].name} data and return interest signals + Vibe DNA. Connects the channel if not connected yet.`,
        inputSchema: { refresh: z.boolean().optional().describe('Re-pull from the platform API') },
      },
      async ({ refresh }) => {
        const u = getUser();
        const c = u.channels[id];
        if (c && !refresh) return text({ channel: PROVIDERS[id].name, mode: c.mode, interests: c.interests, dna: c.dna });
        return text(await connectChannel(u, id, c?.token || 'demo'));
      },
    );
  }

  // ---- Cross-channel tools ----------------------------------------
  server.registerTool('list_channels', {
    title: 'List social channels',
    description: 'List all supported social apps and which ones the user has connected.',
    inputSchema: {},
  }, async () => {
    const u = getUser();
    return text(ids.map((id) => ({ id, name: PROVIDERS[id].name, connected: !!u.channels[id], mode: u.channels[id]?.mode || null })));
  });

  server.registerTool('disconnect_channel', {
    title: 'Disconnect a channel',
    description: 'Revoke a social channel and delete all signals derived from it.',
    inputSchema: { channel: z.enum(ids) },
  }, async ({ channel }) => {
    const u = getUser(); delete u.channels[channel]; updateUser(u, {});
    return text(`${PROVIDERS[channel].name} disconnected and its data deleted.`);
  });

  server.registerTool('get_vibe_profile', {
    title: 'Get Vibe profile',
    description: 'Aggregated interests, Vibe DNA, trust score and profile across all connected channels.',
    inputSchema: {},
  }, async () => text(publicUser(getUser())));

  server.registerTool('find_matches', {
    title: 'Find compatible people',
    description: 'Rank people by compatibility (35% interests, 30% intent, 25% values, 10% social signals).',
    inputSchema: {
      intent: z.string().optional().describe('Filter: Friendship, Coffee chats, Treks & outdoors, Travel buddies, Dating, Marriage-minded'),
      limit: z.number().int().min(1).max(20).optional(),
    },
  }, async ({ intent, limit = 5 }) => {
    const u = getUser();
    if (trustScore(u) < 60) return text(`Trust score ${trustScore(u)}/100 — needs 60 to unlock matches. Verify identity or connect more channels.`);
    const me = { ...aggregate(u), profile: u.profile, channels: Object.keys(u.channels).length };
    const ranked = PEOPLE.filter((p) => !intent || p.intent.includes(intent))
      .map((p) => ({ name: p.n, age: p.a, area: p.c, job: p.job, lookingFor: p.intent, ...compat(me, p) }))
      .sort((a, b) => b.total - a.total).slice(0, limit);
    return text(ranked);
  });

  server.registerTool('suggest_meetups', {
    title: 'Suggest group meetups',
    description: 'Curated, verified-only meetups ranked by shared interests and gated by trust score.',
    inputSchema: {},
  }, async () => {
    const u = getUser(); const { interests } = aggregate(u); const t = trustScore(u);
    return text(MEETUPS.map((m) => ({ ...m, sharedInterests: m.tags.filter((x) => interests[x]), unlocked: t >= m.min, requiresTrust: m.min }))
      .sort((a, b) => b.sharedInterests.length - a.sharedInterests.length));
  });

  // ---- explore_events: search the Bangalore events list ------------
  server.registerTool('explore_events', {
    title: 'Explore Bangalore events',
    description: 'Find curated Bangalore events by mood/category or matching the user\'s interests.',
    inputSchema: {
      mood: z.string().optional().describe('Category filter: Food, Music, Dates & Romance, Lifestyle, Fitness & Health, Science, Comedy, Spiritual, Travellers, Company'),
      match_interests: z.boolean().optional().describe('If true, rank events by overlap with the user\'s Vibe DNA interests'),
    },
  }, async ({ mood, match_interests }) => {
    const u = getUser();
    const { interests } = aggregate(u);
    const myInterests = new Set(Object.keys(interests));
    let list = mood ? EVENTS.filter((e) => e.cat === mood) : EVENTS;
    if (match_interests) {
      list = list
        .map((e) => ({ ...e, sharedInterests: e.tags.filter((t) => myInterests.has(t)) }))
        .sort((a, b) => b.sharedInterests.length - a.sharedInterests.length);
    }
    return text(list);
  });

  // ---- plan_date: full date plan from a match + mood + budget ------
  server.registerTool('plan_date', {
    title: 'Plan a date or meetup',
    description: 'Generate a full meetup plan: venue from Bangalore events, suggested time, AI icebreaker and safety checklist.',
    inputSchema: {
      match_name: z.string().describe('Name of the person to meet (from find_matches results)'),
      mood: z.string().optional().describe('Mood/vibe: Trekking, Coffee, Dinner, Music, Travel, Spiritual, etc.'),
      budget: z.string().optional().describe('Budget: low (<₹500), medium (₹500–2000), high (>₹2000)'),
    },
  }, async ({ match_name, mood = '', budget = 'medium' }) => {
    const u = getUser();
    const me = { ...aggregate(u), profile: u.profile, channels: Object.keys(u.channels).length };

    // Find the match
    const person = PEOPLE.find((p) => p.n.toLowerCase() === match_name.toLowerCase());
    if (!person) return text(`No match found for "${match_name}". Use find_matches to see available matches.`);

    const c = compat(me, person);

    // Pick an event matching mood or shared interests
    const moods = mood.toLowerCase();
    const shared = new Set(c.shared);
    const event = EVENTS.find((e) =>
      (moods && (e.cat.toLowerCase().includes(moods) || e.tags.some((t) => t.toLowerCase().includes(moods)))) ||
      e.tags.some((t) => shared.has(t))
    ) || EVENTS[0];

    // Icebreaker
    const sharedWord = c.shared[0] || person.interests[0] || 'your shared passions';
    const icebreaker = `Ask ${person.n} about their favourite ${sharedWord.toLowerCase()} experience in Bangalore. ${c.total >= 70 ? "You two are a strong match — this will flow naturally." : "Keep it light and curious."}`;

    const safetyChecklist = [
      '✓ Share live location with a trusted contact before you go',
      '✓ Meet in a public, well-lit venue (all Kindred events qualify)',
      '✓ Kindred check-in reminder: app will ping you 1 hour in',
      '✓ In-app SOS button available throughout the meetup',
      '✓ Both your profiles are verified — you can see each other\'s trust scores',
    ];

    const budgetNote = { low: 'Under ₹500 — coffee, a walk, a free event', medium: '₹500–2000 — most Kindred experiences fall here', high: '₹2000+ — premium venues, overnight trips' }[budget] || '';

    const plan = {
      meeting: `${person.n}, ${person.a} · ${person.job} · ${person.c}`,
      compatibility: `${c.total}% match · Shared interests: ${c.shared.join(', ') || 'none yet'}`,
      suggestedVenue: { name: event.t, where: event.where, when: event.when, description: event.p },
      icebreaker,
      budget: budgetNote,
      safetyChecklist,
    };

    return text(plan);
  });

  return server;
}
