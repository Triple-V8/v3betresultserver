// POST /games/ensure  { leagueId, apiFixtureId }
//
// Returns { gameId, alreadyExisted } for the on-chain Game corresponding to
// the given AllSportsAPI fixture. If the mapping isn't in our KV, we fetch
// the fixture, call `createGame(leagueId, team1, team2, startTime)` on the
// unified P2PBetting contract, and store the mapping. Per-fixture in-process
// lock prevents two simultaneous picks from double-creating.

import { contract } from './chain.js'
import { fetchFixtureById, fixtureStartSeconds } from './allSportsApi.js'
import { leagueExists, MIN_FIXTURE_LEAD_SECONDS } from './config.js'
import { kv, keys } from './kv.js'

const inflight = new Map() // apiFixtureId -> Promise

async function doEnsure(leagueId, apiFixtureId) {
  // Cache hit — already mapped.
  const cached = await kv.get(keys.fixtureMap(apiFixtureId))
  if (cached?.gameId != null) {
    return { gameId: Number(cached.gameId), alreadyExisted: true }
  }

  // Look up the fixture in AllSportsAPI; cross-check the league.
  const fixture = await fetchFixtureById(apiFixtureId)
  if (!fixture) {
    throw new Error(`Fixture ${apiFixtureId} not found in AllSportsAPI`)
  }
  if (Number(fixture.league_key) !== Number(leagueId)) {
    throw new Error(
      `Fixture ${apiFixtureId} belongs to league ${fixture.league_key}, not ${leagueId}`,
    )
  }
  const team1 = fixture.event_home_team
  const team2 = fixture.event_away_team
  const startTime = fixtureStartSeconds(fixture)
  if (!team1 || !team2 || !startTime) {
    throw new Error(`Fixture ${apiFixtureId} is missing team or start-time data`)
  }
  // Local check before sending — match the contract's MIN_FUTURE_TIME so the
  // user gets a friendlier error than a generic revert.
  const nowSec = Math.floor(Date.now() / 1000)
  if (startTime - nowSec < MIN_FIXTURE_LEAD_SECONDS) {
    throw new Error('Fixture is too close to kickoff to be added on-chain')
  }

  // Send createGame. We rely on the contract's DuplicateGame revert if a
  // racing path created it already; recover by reading the index from the
  // tx receipt's GameCreated event.
  const tx = await contract.createGame(
    BigInt(leagueId),
    team1,
    team2,
    BigInt(startTime),
  )
  const receipt = await tx.wait()

  // Parse the GameCreated event to get the new gameIndex.
  let gameId = null
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: log.topics,
        data: log.data,
      })
      if (parsed?.name === 'GameCreated') {
        gameId = Number(parsed.args.gameIndex)
        break
      }
    } catch (_) {
      // Not our event; ignore.
    }
  }
  if (gameId == null) {
    throw new Error('createGame succeeded but GameCreated event was not found')
  }

  await kv.set(keys.fixtureMap(apiFixtureId), {
    gameId,
    leagueId,
    team1,
    team2,
    startTime,
    createdAt: Date.now(),
  })

  // Reverse map so the results-cron on-chain sweep can recover the
  // apiFixtureId for any unfinished game it finds.
  await kv.set(keys.gameToFixture(gameId), { apiFixtureId, leagueId })

  // Eagerly add to the tracked set the moment a game exists on-chain.
  // Previously this happened only when /games/track fired after a pool
  // was created — if that fire-and-forget call failed, the game became
  // invisible to the cron. Tracking up-front (with /games/track now an
  // idempotent no-op) means every on-chain game gets polled.
  await kv.set(keys.trackedItem(apiFixtureId), {
    apiFixtureId,
    gameId,
    leagueId,
    startTime,
    team1,
    team2,
    addedAt: Date.now(),
  })
  await kv.sadd(keys.trackedSet(), String(apiFixtureId))

  return { gameId, alreadyExisted: false }
}

export async function ensureGameHandler(req, res) {
  try {
    const body = req.body || {}
    const leagueId = Number(body.leagueId)
    const apiFixtureId = Number(body.apiFixtureId)
    if (!Number.isFinite(leagueId) || !leagueExists(leagueId)) {
      return res.status(400).json({ error: 'Invalid or unknown leagueId' })
    }
    if (!Number.isFinite(apiFixtureId) || apiFixtureId <= 0) {
      return res.status(400).json({ error: 'Invalid apiFixtureId' })
    }

    // Per-fixture lock so concurrent requests share a single createGame tx.
    if (!inflight.has(apiFixtureId)) {
      inflight.set(
        apiFixtureId,
        doEnsure(leagueId, apiFixtureId).finally(() => {
          inflight.delete(apiFixtureId)
        }),
      )
    }
    const result = await inflight.get(apiFixtureId)
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[POST /games/ensure] failed:', err)
    res.status(400).json({ error: err?.message || 'ensureGame failed' })
  }
}
