// GET /fixtures?leagueId=<id>&limit=<n>
//
// Returns the next `limit` upcoming fixtures for the given league from
// AllSportsAPI, normalised to a compact shape the frontend can render
// without knowing AllSportsAPI internals. Cached in process memory for a
// few minutes to respect rate limits and speed up repeated views.

import { fetchUpcomingFixtures, fixtureStartSeconds } from './allSportsApi.js'
import { leagueExists, LEAGUES, MIN_FIXTURE_LEAD_SECONDS } from './config.js'

const CACHE_MS = 5 * 60 * 1000 // 5 minutes
const COUNTS_CACHE_MS = 5 * 60 * 1000
const DEFAULT_LIMIT = 20
const FETCH_CONCURRENCY = 5

const cache = new Map() // leagueId -> { at: epochMs, rows: [...] }
let countsCache = null  // { at: epochMs, counts: { [leagueId]: number } }

function shapeFixture(f) {
  const startTime = fixtureStartSeconds(f)
  return {
    apiFixtureId: Number(f.event_key),
    leagueId: Number(f.league_key),
    leagueName: f.league_name,
    team1: f.event_home_team,
    team2: f.event_away_team,
    team1Logo: f.home_team_logo || null,
    team2Logo: f.away_team_logo || null,
    startTime, // unix seconds, UTC
    venue: f.event_stadium || null,
    status: f.event_status || '',
  }
}

// Load rows for one league using cache if warm; populates the per-league
// cache as a side-effect so /fixtures?leagueId=… is free afterward.
async function loadLeagueRows(leagueId) {
  const now = Date.now()
  const cached = cache.get(leagueId)
  if (cached && now - cached.at < CACHE_MS) return cached.rows
  const raw = await fetchUpcomingFixtures(leagueId)
  const nowSec = Math.floor(now / 1000)
  const rows = raw
    .map(shapeFixture)
    .filter(
      (f) => f.startTime > 0 && f.startTime - nowSec > MIN_FIXTURE_LEAD_SECONDS,
    )
    .sort((a, b) => a.startTime - b.startTime)
  cache.set(leagueId, { at: now, rows })
  return rows
}

export async function fixturesHandler(req, res) {
  try {
    const leagueId = Number(req.query?.leagueId)
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      return res.status(400).json({ error: 'leagueId query param required' })
    }
    if (!leagueExists(leagueId)) {
      return res.status(404).json({ error: 'Unknown leagueId' })
    }
    const limit = Math.min(
      Math.max(1, Number(req.query?.limit) || DEFAULT_LIMIT),
      50,
    )

    const cached = cache.get(leagueId)
    const wasCached = !!(cached && Date.now() - cached.at < CACHE_MS)
    const rows = await loadLeagueRows(leagueId)

    res.json({
      leagueId,
      fixtures: rows.slice(0, limit),
      cached: wasCached,
    })
  } catch (err) {
    console.error('[GET /fixtures] failed:', err)
    res
      .status(502)
      .json({ error: err?.message || 'Failed to fetch fixtures' })
  }
}

// Simple concurrency-limited map. Avoids hammering AllSportsAPI when the
// counts cache is cold (50 leagues).
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let i = 0
  async function next() {
    while (i < items.length) {
      const idx = i++
      try {
        results[idx] = await worker(items[idx])
      } catch (err) {
        results[idx] = { error: err }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
  return results
}

// GET /fixtures/counts — { counts: { [leagueId]: count } } for every
// registered league. Aggregate-cached for 5 minutes so a typical page load
// is a single in-memory read; cold-cache loads fan out with concurrency.
export async function fixtureCountsHandler(_req, res) {
  try {
    const now = Date.now()
    if (countsCache && now - countsCache.at < COUNTS_CACHE_MS) {
      return res.json({ counts: countsCache.counts, cached: true })
    }

    const results = await mapWithConcurrency(
      LEAGUES,
      FETCH_CONCURRENCY,
      async (l) => {
        const rows = await loadLeagueRows(l.leagueId)
        return { leagueId: l.leagueId, count: rows.length }
      },
    )

    const counts = {}
    for (const r of results) {
      if (r && !r.error) counts[r.leagueId] = r.count
    }
    countsCache = { at: now, counts }
    res.json({ counts, cached: false })
  } catch (err) {
    console.error('[GET /fixtures/counts] failed:', err)
    res
      .status(502)
      .json({ error: err?.message || 'Failed to fetch fixture counts' })
  }
}
