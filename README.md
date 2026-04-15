# DXIR STATS

Production-ready Minecraft monitoring dashboard for Vercel with:

- Live server stats (`/api/data`)
- Stable player UI with UUID-first avatar caching + fallback
- Avatar flow supports premium + cracked players (Mojang UUID -> Ely.by -> Minotar)
- AFK-aware playtime tracking (session/total/daily/weekly)
- Live leaderboard categories (`kills`, `balance`, `bounty`, `earnings`, `playtime`)
- Realtime websocket updates (no frontend polling loops)

## Run locally

```powershell
npm install
npm run send
```

> `npm run send` posts metrics every 2 seconds to `https://stats.dxir.live/api/data` by default.

To target another deployment:

```powershell
$env:DXIR_STATS_URL="https://your-domain.vercel.app"
npm run send
```

## API endpoints

- `GET/POST /api/data`
- `GET /api/players`
- `GET /api/player/{uuid-or-name}/playtime`
- `GET/POST /api/player/{uuid-or-name}/activity`
- `GET /api/player/{uuid-or-name}/stats`
- `GET/POST /api/leaderboard/kills`
- `GET/POST /api/leaderboard/balance`
- `GET/POST /api/leaderboard/bounty`
- `GET/POST /api/leaderboard/earnings`
- `GET/POST /api/leaderboard/playtime`
- `GET/POST /api/leaderboard` (aggregate endpoint)
- `GET /api/realtime-config` (public websocket client config)

## Persistent storage on Vercel

If these env vars are present, state is persisted in Upstash/Vercel KV:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Without KV, the API uses in-memory state (works locally, resets on cold start).

## Realtime websocket setup (Pusher)

Set these env vars in Vercel for event-driven updates:

- `PUSHER_APP_ID`
- `PUSHER_KEY`
- `PUSHER_SECRET`
- `PUSHER_CLUSTER`
- `PUSHER_CHANNEL` (optional, default: `dxir-stats`)

Emitted events:

- `stats_update`
- `player_join`
- `player_leave`
- `player_update`
- `leaderboard_update`

When these env vars are missing, the UI still loads a snapshot but realtime streaming is disabled.

## Mojang UUID + avatar caching

- Username-to-UUID cache is persisted in API state (`uuidDirectory`).
- UUID-to-avatar cache is persisted in API state (`avatarDirectory`).
- On cache miss, the API resolves Mojang UUID once, stores it, then reuses cached avatar URL.

## Paper hook example

See `docs/PaperRealtimeBridgeExample.java` for a basic join/leave/move hook that posts live snapshots to `/api/data`.

