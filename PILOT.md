# Kindred private pilot

The pilot lets invited adults in Bengaluru find an activity partner, send a meetup proposal, accept it and confirm afterward whether they met. It runs separately from the IBM Bob BOBaTHON demo in [README.md](README.md).

## Start the pilot

Use Node.js 20.19 or newer. From the repository root in PowerShell:

```powershell
cd server
npm ci --ignore-scripts
$kindredSecret = node -p 'require("node:crypto").randomBytes(32).toString("hex")'
if (-not (Test-Path .env.pilot)) {
  "PILOT_SECRET=$kindredSecret" | Set-Content .env.pilot -Encoding utf8NoBOM
}
npm run pilot
```

Open [Kindred Pilot](http://127.0.0.1:8788). In a second terminal in the same server folder, run `npm run pilot:invites -- 3` to create three registration codes. Each code is single-use and expires after seven days. Send one code per tester privately. The signup form asks for a display name, username, password, and confirmation that the tester is 18 or older. Pilot participants should save their password.

For remote testers, serve port 8788 behind an HTTPS reverse proxy. A temporary Cloudflare Quick Tunnel can forward to `http://127.0.0.1:8788`. It depends on your computer, pilot server, and tunnel staying online. For a dedicated host, set `PILOT_HOST` and `PILOT_PORT` to the proxy’s expected address and set `PILOT_DB_FILE` to a private file on a persistent volume. Keep one server process per data file.

## What to test

1. Give two testers separate codes. Ask both to save a plan for the same activity and date, with at least 30 minutes of overlapping availability in IST.
2. Have one tester click **Refresh**, read the explanation and send a proposal with a public meetup location and time.
3. Have the other click **Refresh** and accept or decline. Both can refresh to see the result. After the proposed time, both can press **We met** if it happened.
4. Ask both testers whether the activity, time, neighborhood or shared interests drove their decision.

Run `npm run pilot:summary` to see current accounts, invitations, accepted proposals, confirmed meetups and reports. Keep reports private and check for them during the pilot. Deleting an account removes its profile, invitations, sessions, blocks and linked reports from the active data file.

Search checks activity, date, availability and bilateral blocks before ranking up to five candidates by shared-interest overlap and neighborhood. It currently runs an exact scan of pilot profiles. The pilot uses its own locally persisted JSON file, avoids social-account connections, and keeps the demo fixtures and MCP endpoints on the separate demo server.
