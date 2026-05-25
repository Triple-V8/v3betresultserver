// Express app for the V3 Bet sports oracle.
//
// Same listen-vs-Vercel split as session-server: this file builds the app
// without calling `listen`. `src/index.js` listens for local dev; `api/index.js`
// exports the app to Vercel.

import express from 'express'
import cors from 'cors'

import { ALLOWED_ORIGINS } from './config.js'
import { operatorAddress } from './chain.js'
import { fixturesHandler, fixtureCountsHandler } from './fixtures.js'
import { ensureGameHandler } from './ensureGame.js'
import { trackGameHandler } from './trackGame.js'
import { resultsCronHandler, sweepCronHandler } from './resultsCron.js'

const app = express()
app.use(express.json({ limit: '256kb' }))
app.use(
  cors({
    origin(origin, cb) {
      // Same-origin / curl (no Origin) and configured origins.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true)
      else cb(new Error(`Origin not allowed: ${origin}`))
    },
  }),
)

// ── Health / info ────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }))

app.get('/info', (_req, res) => {
  res.json({
    operatorAddress,
    role: 'propose',
  })
})

// ── Fixtures (public read, cached) ──────────────────────────────────────
app.get('/fixtures', fixturesHandler)
app.get('/fixtures/counts', fixtureCountsHandler)

// ── Mutating endpoints called by the frontend ───────────────────────────
app.post('/games/ensure', ensureGameHandler)
app.post('/games/track', trackGameHandler)

// ── Cron — Vercel hits these on the schedules in vercel.json ────────────
// `/cron/results`: every 10 min — processes the KV trackedSet (the fast
//                  path for ensureGame-created fixtures).
// `/cron/sweep`:   every 30 min — bounded on-chain backstop over the last
//                  20 game IDs, catching orphans (admin-created games or
//                  fixtures the trackedSet missed). Never blocks /results.
// Both accept GET + POST so manual debug curls work.
app.get('/cron/results', resultsCronHandler)
app.post('/cron/results', resultsCronHandler)
app.get('/cron/sweep', sweepCronHandler)
app.post('/cron/sweep', sweepCronHandler)

// Generic / CORS error handler.
app.use((err, _req, res, _next) => {
  res.status(403).json({ error: err?.message || 'Request rejected' })
})

export default app
