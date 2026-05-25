# V3 Bet — Sports Oracle

Backend that bridges AllSportsAPI to the unified `P2PBetting` contract:

- **`GET /fixtures?leagueId=<id>`** — next 20 upcoming fixtures in a league.
- **`POST /games/ensure`** — `{ leagueId, apiFixtureId }` → on-chain `gameId`.
  Creates the game on the contract if it doesn't exist yet.
- **`POST /games/track`** — `{ apiFixtureId }` — call after a pool is created
  on a fixture, so the results cron knows to poll it.
- **`GET /cron/results`** — every 10 min: query AllSportsAPI for tracked
  games, propose finished results (`proposeGameResult`), cancel
  postponed/abandoned ones. Two-operator settlement: the second operator
  confirms via the separate Telegram-bot service.
- **`GET /health`** · **`GET /info`** — diagnostics.

## Architecture

```
frontend ───►  GET /fixtures        ──► AllSportsAPI (cached server-side)
frontend ───►  POST /games/ensure   ──► createGame() ─► P2PBetting
frontend ───►  POST /games/track    ──► KV  (queued for results polling)
Vercel Cron ►  GET /cron/results    ──► AllSportsAPI + proposeGameResult()
```

Operator wallet held here proposes; the Telegram-bot operator (separate
folder) confirms. Two distinct addresses on `addOperator(...)`.

## Local dev

```bash
cd sports-oracle
npm install
cp .env.example .env   # then fill it in
npm run dev            # or: npm start
```

Without Vercel KV credentials, state lives in-process (lost on restart) —
fine for dev, not for production.

## Env

| Var | What |
| --- | --- |
| `PORT` | Local port (default 8788) |
| `CHAIN_ID` | `84532` Base Sepolia · `8453` Base mainnet |
| `P2P_BETTING_ADDRESS` | Deployed unified P2PBetting contract |
| `OPERATOR_PRIVATE_KEY` | Propose-operator wallet (added via `addOperator`) |
| `RPC_URL` | Read RPC; defaults to the public chain endpoint |
| `ALLSPORTSAPI_KEY` | AllSportsAPI key (server-side only, never browser) |
| `CRON_SECRET` | Cron auth — Vercel sets `Authorization: Bearer <CRON_SECRET>` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Set by Vercel KV integration |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |

## Deploy on Vercel

1. Push this folder to its own GitHub repo (same pattern as `session-server`).
2. Import the repo into Vercel — framework preset **Other**.
3. **Project Settings → Environment Variables** — set every var from the
   table above. Vercel KV integration auto-fills the KV vars.
4. The `vercel.json` has a `crons` entry that fires `GET /cron/results`
   every 10 minutes. Vercel Cron requires the **Pro** plan; on Hobby,
   schedule the same URL externally (cron-job.org / GitHub Actions).

## Frontend integration (Phase 4 — pending)

1. Render `/fixtures?leagueId=…` in the Create Pool tab.
2. On pick → `POST /games/ensure { leagueId, apiFixtureId }` → get `gameId`.
3. After the user's `createPool` confirms → `POST /games/track { apiFixtureId }`.

## Two-operator settlement reminder

The contract requires two distinct operator addresses to settle a game (the
proposer cannot confirm their own proposal). This service is operator #1
(propose). Operator #2 (confirm) is the Telegram-bot service — Phase 5.
