# DXIR STATS

Production-ready Minecraft monitoring dashboard for Vercel with:

- Live server stats (`/api/data`)
- Stable player UI with UUID-first avatar caching + fallback
- AFK-aware playtime tracking (session/total/daily/weekly)
- Live leaderboard categories (`kills`, `balance`, `bounty`, `earnings`, `playtime`)

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
- `GET /api/player/{uuid-or-name}/playtime`
- `GET/POST /api/player/{uuid-or-name}/activity`
- `GET /api/player/{uuid-or-name}/stats`
- `GET/POST /api/leaderboard/kills`
- `GET/POST /api/leaderboard/balance`
- `GET/POST /api/leaderboard/bounty`
- `GET/POST /api/leaderboard/earnings`
- `GET/POST /api/leaderboard/playtime`
- `GET/POST /api/leaderboard` (aggregate endpoint)

## Persistent storage on Vercel

If these env vars are present, state is persisted in Upstash/Vercel KV:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Without KV, the API uses in-memory state (works locally, resets on cold start).

