// POST /games/track  { apiFixtureId }
//
// Marks a fixture as "needs results polling" — call this from the frontend
// AFTER a pool has been successfully created on it. The cron only polls
// tracked games (so we don't waste API quota on fixtures nobody bet on).

import { kv, keys } from './kv.js'

export async function trackGameHandler(req, res) {
  try {
    const apiFixtureId = Number(req.body?.apiFixtureId)
    if (!Number.isFinite(apiFixtureId) || apiFixtureId <= 0) {
      return res.status(400).json({ error: 'Invalid apiFixtureId' })
    }

    // Read the existing fixture mapping so we can store the metadata the
    // cron will need (gameId, startTime, etc.) without re-querying AllSportsAPI.
    const mapping = await kv.get(keys.fixtureMap(apiFixtureId))
    if (!mapping?.gameId) {
      return res
        .status(404)
        .json({ error: 'Fixture has no on-chain game — call /games/ensure first' })
    }

    await kv.set(keys.trackedItem(apiFixtureId), {
      apiFixtureId,
      gameId: Number(mapping.gameId),
      leagueId: Number(mapping.leagueId),
      startTime: Number(mapping.startTime),
      team1: mapping.team1,
      team2: mapping.team2,
      addedAt: Date.now(),
    })
    await kv.sadd(keys.trackedSet(), String(apiFixtureId))

    res.json({ ok: true, tracked: apiFixtureId })
  } catch (err) {
    console.error('[POST /games/track] failed:', err)
    res.status(400).json({ error: err?.message || 'trackGame failed' })
  }
}
