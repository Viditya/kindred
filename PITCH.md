# ✦ Kindred — 3-minute winning pitch (IBM Bob BOBaTHON 2026)

## Open with this — the emotional hook (15 sec)
> *"IBM's greatest invention isn't a mainframe or a large language model. It's the conviction — 113 years strong — that technology exists to serve humanity. Today we built something that proves that conviction is still alive: an AI that fights loneliness, keeps people safe, and creates real human connections. This is Kindred."*

## One-liner
**Kindred turns your digital life into real-life connections.** It reads the signals you already create — music, runs, books, travel — with your consent, and introduces you to verified people in Bengaluru to meet over coffee, on a trek, on a trip, or for something more.

## The problem (20 sec)
- Bengaluru has 13 million people. Most transplants know fewer than 10 of them.
- Dating apps optimise for swiping, not meeting. Most matches never turn into a real meetup.
- Fake profiles and safety worries — especially for women — make people disengage.
- **This is a human problem. AI should solve it, not make it worse.**

## The solution (40 sec)
1. **Connect:** 8 social apps → one **Vibe DNA** (Adventure, Creativity, Intellect, Social, Wellness, Calm, Ambition, Values).
2. **Qualify:** a vibe check plus ID verification gives a **Trust Score**. 60+ unlocks matches; 80+ unlocks trips.
3. **Match:** a transparent compatibility score (35% interests, 30% intent, 25% values, 10% social signals), **Vibe Twin** badge for 85%+ matches, and an AI icebreaker.
4. **Meet:** 26 curated Bangalore experiences, an AI concierge, a full date planner with safe-meet features, and a Spin-the-Date-Wheel game.

## The IBM Bob angle (30 sec), our differentiator
- **The app was built with IBM Bob:** front end, API, OAuth flows, MCP server, and watsonx.ai integration.
- **Kindred is an MCP server.** Every social app is an MCP tool, plus `find_matches`, `suggest_meetups`, `explore_events`, and `plan_date`.
- **Ask Kindred AI concierge** (the ✦ floating button): natural-language match and event finder, powered by IBM watsonx.ai Granite or rule-based fallback.
- So **Bob, or any AI agent, can be your personal matchmaker**: "Pull my Strava and Spotify signals and find me three trek buddies for Sunday."
- Kindred isn't just an app; it's a **social layer for the AI-agent era.**

## Live demo script (90 sec)
1. Open Explore → scroll the photo collage, the joke ticker and the mood filters (Food → Spiritual → Travellers).
2. **Spin the Date Wheel** 🎡. It always gets a laugh.
3. Log in as `demo@kindred.app` / `demo1234` — the demo account is pre-seeded with Spotify + Strava + Instagram connected and trust score 75. Matches are already unlocked.
4. Matches → find Rohan or Ishita → like them → 🎉 **confetti** fires → **"It's a mutual vibe!"** modal appears.
5. Click the **✦ floating button** → **Ask Kindred** panel opens → type: *"Find me a trek buddy and somewhere to eat after"* → AI reply + match cards + event cards appear in real time.
6. Profile → **📋 Copy MCP config — paste into IBM Bob** → switch to IBM Bob → paste → then type the 3 prompts live:
   - *"Use get_vibe_profile to read my Vibe DNA and trust score."*
   - *"Use find_matches with intent 'Treks & outdoors' and show me the top 3."*
   - *"Use plan_date with Rohan, trekking mood, low budget — give me the venue, icebreaker and safety checklist."*
7. *(Optional)* Profile → **⬇ Download Vibe Card** → shows a beautiful PNG of the demo user's Vibe DNA.

## MCP tools on stage (the moment judges remember)
```
Prompt 1: "Use Kindred's get_vibe_profile tool to read my Vibe DNA and trust score."
Prompt 2: "Now use find_matches with intent 'Treks & outdoors' — show top 3 with compatibility breakdown."
Prompt 3: "Use plan_date with Rohan, trekking mood, low budget — venue, icebreaker and safety checklist."
```
Bob orchestrates 3 tool calls, Kindred returns structured data, Bob narrates it back. Live on stage.

## Business model (15 sec)
- Freemium, with **Kindred Gold** (₹499/mo) for curated trips and priority matching.
- Commission on paid experiences (treks, supper clubs, retreats, 10–15%).
- Venue and brand partnerships (cafés, breweries, gyms, travel operators).
- B2B: city welcome packs for companies relocating employees to Bengaluru.

## Why we win
| Judging lens | Kindred |
|---|---|
| Innovation | Social-signal Vibe DNA + MCP-native social graph + AI concierge for AI agents |
| Use of IBM Bob | Built with Bob *and* designed to be driven by Bob through 15 MCP tools |
| Completeness | Working login, 8 OAuth providers, 15 MCP tools, AI concierge, matching, meetups, Vibe Card |
| Impact | Tackles urban loneliness with safety-first design for Bengaluru's transplant generation |
| Polish | Premium UI, confetti, Vibe Twin badge, shareable Vibe Card, Bangalore-native content |

## Close with this — land the IBM values (15 sec)
> *"Three IBM values, one app: Trust and responsibility — every match is consent-first, verified and explainable. Dedication to the user — safety is not a feature, it's the product. And innovation that matters — because the loneliest generation in history deserves better than a swipe. We built Kindred with IBM Bob. We built it for people. And we built it in one day."*

## Roadmap
watsonx.ai for personalised icebreakers → real Spotify + Strava OAuth → Supabase backend → launch in Bengaluru with 50 partner venues → Mysuru, Pune, Hyderabad.
