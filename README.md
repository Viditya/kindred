# ✦ Kindred — meet people who share your vibe

Built at the **IBM Bob BOBaTHON** by Thejasvi & Viditya Tyagi.

Kindred is a meetup app for Bengaluru: coffee chats, treks, travel buddies, friendship, dating, or a marriage-minded match. People sign in, connect their social apps, pass a vibe check, and get matched with people they'd actually enjoy meeting. Then they go out and do something wonderful together.

```
kindred/
├── index.html            ← the whole web app (Explore, Connect, Vibe Check, Matches, Meetups, Profile)
└── server/
    ├── src/server.js     ← REST API: auth, profile, OAuth, /api/events, /api/concierge, MCP at /mcp
    ├── src/mcp.js        ← 15 MCP tools (8 social apps + 7 cross-channel tools)
    ├── src/providers.js  ← Instagram, LinkedIn, Spotify, Strava, YouTube, X, Facebook, Goodreads
    ├── src/matching.js   ← compatibility engine + demo personas + meetups
    ├── src/events.js     ← 26 curated Bangalore events across 10 moods
    ├── src/store.js      ← users, hashed passwords (scrypt), sessions (JSON file)
    ├── src/stdio.js      ← local MCP entry for IBM Bob / Claude Desktop
    ├── scripts/
    │   └── mcp-smoke.js  ← smoke test: calls tools/list + all MCP tools against a live server
    └── .env.example
```

## Run it (2 commands)
```bash
cd server && npm install
npm start          # → http://localhost:8787  (web app + API + MCP)
```
Open http://localhost:8787 and log in with the pre-seeded demo account:
- **Email:** `demo@kindred.app`  **Password:** `demo1234`  (trust score 75, 5 channels connected, matches unlocked)

If the server isn't running, `index.html` still opens on its own in **offline demo mode** (works on GitHub Pages).

## Screens
| Screen | What it does |
|---|---|
| ✦ **Explore** | Photo collage hero, 26 Bangalore experiences across 10 moods, a Bangalore joke of the day, and a **Spin the Date Wheel** game |
| **Connect** | Link 8 social apps. Interest signals feed a **Vibe DNA** across 8 traits |
| **Vibe Check** | 5-question quiz and ID checks (phone, selfie, DigiLocker, work email) → **Trust Score** |
| **Matches** | Ranked match %, **Vibe Twin** badge (≥85%), AI icebreaker, meetup planner with safety features |
| **Meetups** | Hosted meetups for verified members, gated by trust score. **Confetti** on RSVP |
| **Profile** | Edit details, Vibe DNA, MCP config copy button, **My Vibe Card** PNG download |
| **✦ Ask Kindred** | Floating concierge — natural-language match + event finder (watsonx.ai or rule-based) |

## REST API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/signup` | — | Create account |
| `POST` | `/api/auth/login` | — | Log in → returns `{ token, user }` |
| `POST` | `/api/auth/logout` | ✓ | Invalidate session |
| `GET` | `/api/me` | ✓ | Fetch current user (profile, channels, DNA, trust) |
| `PUT` | `/api/me` | ✓ | Update profile + quiz answers |
| `POST` | `/api/verify/:kind` | ✓ | Mark a verification step (phone, selfie, id, work) |
| `GET` | `/api/channels` | — | List all 8 social app providers |
| `POST` | `/api/connect/:id` | ✓ | Connect a channel (live OAuth or demo signals) |
| `DELETE` | `/api/connect/:id` | ✓ | Disconnect + delete derived data |
| `GET` | `/api/events` | — | 26 Bangalore events. `?mood=Music` to filter |
| `POST` | `/api/concierge` | ✓ | AI concierge: `{ request }` → `{ reply, matches[], events[], powered }` |
| `POST` | `/mcp` | ✓ Bearer | MCP Streamable HTTP endpoint (15 tools) |

## MCP integration — 15 tools

The server exposes **15 MCP tools** over Streamable HTTP at `/mcp`. Pass your session token as `Authorization: Bearer <token>`.

| Tool | Purpose |
|---|---|
| `instagram_get_signals` … `goodreads_get_signals` | Read consented data from each of 8 social apps → Vibe DNA |
| `list_channels` | List connected/disconnected channels |
| `disconnect_channel` | Revoke a channel and delete its derived data |
| `get_vibe_profile` | Aggregated interests, DNA, trust score across all channels |
| `find_matches` | Ranked matches filtered by intent, up to 20 results |
| `suggest_meetups` | Meetups ranked by shared interests, with trust-gate info |
| `explore_events` | 26 Bangalore events filtered by mood or ranked by interest overlap |
| `plan_date` | Full meetup plan: venue, icebreaker, safety checklist from a match name + mood + budget |

## Connect Kindred to IBM Bob

### Remote (Streamable HTTP) — recommended

1. Start the server: `cd server && npm start`
2. Log in at `http://localhost:8787` as `demo@kindred.app` / `demo1234`
3. Go to **Profile** → click **📋 Copy MCP config — paste into IBM Bob**
4. In IBM Bob → Settings → MCP Servers → paste the JSON:

```json
{
  "mcpServers": {
    "kindred": {
      "type": "streamable-http",
      "url": "http://localhost:8787/mcp",
      "headers": { "Authorization": "Bearer <your-session-token>" }
    }
  }
}
```

5. Ask Bob the 3 magic prompts (see below).

### Local (stdio) — for Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "kindred": {
      "command": "node",
      "args": ["/absolute/path/to/kindred/server/src/stdio.js"],
      "env": { "KINDRED_EMAIL": "demo@kindred.app" }
    }
  }
}
```

### 3 live demo prompts for IBM Bob on stage

```
1. "Use Kindred's get_vibe_profile tool to read my Vibe DNA and trust score."

2. "Now use find_matches with intent 'Treks & outdoors' and show me the top 3 results with their compatibility breakdown."

3. "Use plan_date to plan a meetup with Rohan, trekking mood, low budget — give me the venue, icebreaker and safety checklist."
```

## Smoke test

```bash
cd server && npm install
npm start &                        # keep this running
node scripts/mcp-smoke.js          # runs in another terminal
```

Expected output: all 9 sections green ✓, covering auth, /api/events, /api/concierge, tools/list, get_vibe_profile, find_matches, explore_events, plan_date, and suggest_meetups.

## Compatibility formula
```
Match % = 35% Interests + 30% Intent + 25% Values (vibe check) + 10% Social footprint
```

## AI Concierge
`POST /api/concierge` with `{ "request": "find me a trek buddy this Sunday and something to eat after" }` returns:
- A short natural-language reply
- Up to 3 ranked match cards
- Up to 2 relevant event cards
- `powered`: `"IBM watsonx.ai (Granite) · Built with IBM Bob"` if `WATSONX_API_KEY` is set, otherwise rule-based

Set `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` in `server/.env` to activate the Granite model.

## Going live with real social data
Copy `.env.example` → `server/.env`, register apps with each platform, set redirect URIs to `{PUBLIC_URL}/api/oauth/<channel>/callback`.

| App | API | Notes |
|---|---|---|
| Spotify | Top artists → genres | Easiest; works in dev mode right away |
| Strava | Activities → sport types | Easy |
| YouTube | Subscriptions | Google Cloud OAuth client |
| Instagram | Media captions → hashtags | Meta app review for production |
| Facebook | Page likes | `user_likes` needs Meta review |
| LinkedIn | OpenID userinfo | Identity only; interests not exposed |
| X | Liked posts → hashtags | Paid API tier |
| Goodreads | Public shelf RSS | API closed 2020; user enters public id |

## Privacy & safety
- Read-only, consent-first. We extract interest *signals* only — never posts, DMs or personal data.
- Revoke any channel → its data is deleted immediately.
- Passwords are hashed with scrypt.
- Every meetup is verified-members-only. Safe-meet sharing, check-in reminders and in-app SOS are built into the planner.

## Notes
- Explore photos use `picsum.photos` (deterministic, CDN-reliable, no rate limits).
- Event listings are sample data for the demo.
- The JSON file store is demo-grade. Swap for Supabase/Postgres in production.
