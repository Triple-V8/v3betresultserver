// AllSportsAPI football client.
//
// API key lives ONLY here on the server. Two endpoints are used:
//   • met=Fixtures — upcoming fixtures in a league within a date range.
//   • met=Fixtures with the same id — used to read the post-match result.
//
// The free-form `event_status` text is mapped to our settlement outcomes in
// resultsCron.js, not here — this module just returns raw payloads.

import { ALLSPORTSAPI_KEY } from './config.js'

const BASE = 'https://apiv2.allsportsapi.com/football/'

// Format a JS Date → 'YYYY-MM-DD' (AllSportsAPI's expected date format).
function ymd(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function call(params) {
  const qs = new URLSearchParams({
    APIkey: ALLSPORTSAPI_KEY,
    ...params,
  }).toString()
  const url = `${BASE}?${qs}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AllSportsAPI ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  if (data && data.success === 0) {
    throw new Error(`AllSportsAPI error: ${data.result || 'unknown'}`)
  }
  return Array.isArray(data?.result) ? data.result : []
}

/**
 * Upcoming fixtures for a league, from today through the next `windowDays`.
 * Returned items keep the API's raw shape — at minimum: event_key,
 * event_date, event_time, event_home_team, event_away_team.
 */
export async function fetchUpcomingFixtures(leagueId, windowDays = 14) {
  const from = new Date()
  const to = new Date(from.getTime() + windowDays * 24 * 60 * 60 * 1000)
  return call({
    met: 'Fixtures',
    leagueId: String(leagueId),
    from: ymd(from),
    to: ymd(to),
  })
}

/**
 * Look up a single fixture by its `event_key` (== `apiFixtureId`). We pass a
 * +/-1-day window so a fixture moving by a few hours doesn't disappear.
 */
export async function fetchFixtureById(apiFixtureId) {
  const today = new Date()
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const inOneYear = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000)
  // Some AllSportsAPI tiers don't honour `matchId` alone — pass a generous
  // date window plus the matchId to be safe.
  const rows = await call({
    met: 'Fixtures',
    matchId: String(apiFixtureId),
    from: ymd(yesterday),
    to: ymd(inOneYear),
  })
  return rows.find((r) => String(r.event_key) === String(apiFixtureId)) || null
}

// Loose team-name compare: lowercase, collapse whitespace, strip diacritics
// and common short-form suffixes ("fc", "cf", "afc"). AllSportsAPI and
// admin-panel inputs sometimes differ in punctuation/casing.
function normalizeTeamName(name) {
  if (!name) return ''
  return String(name)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|cd|cp|ac)\b/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find an AllSportsAPI fixture in a league that matches the given
 * team1/team2 + startTime (±90 minutes). Used by the cron's backstop
 * sweep when an on-chain game has no reverse-map entry (e.g. it was
 * created via the admin panel rather than /games/ensure).
 *
 * Returns the raw fixture row, or null if no plausible match exists.
 */
export async function findFixtureByMatch(leagueId, team1, team2, startTimeSec) {
  const t1 = normalizeTeamName(team1)
  const t2 = normalizeTeamName(team2)
  if (!t1 || !t2 || !startTimeSec) return null
  const start = new Date(startTimeSec * 1000)
  const dayBefore = new Date(start.getTime() - 24 * 60 * 60 * 1000)
  const dayAfter = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const rows = await call({
    met: 'Fixtures',
    leagueId: String(leagueId),
    from: ymd(dayBefore),
    to: ymd(dayAfter),
  })
  const TIME_TOL_SEC = 90 * 60 // 90 min, covers TZ wobble + slight reschedules
  for (const r of rows) {
    const home = normalizeTeamName(r.event_home_team)
    const away = normalizeTeamName(r.event_away_team)
    // Accept either ordering — admin may have swapped home/away.
    const teamsMatch =
      (home === t1 && away === t2) || (home === t2 && away === t1)
    if (!teamsMatch) continue
    const fixtureStart = fixtureStartSeconds(r)
    if (!fixtureStart) continue
    if (Math.abs(fixtureStart - startTimeSec) <= TIME_TOL_SEC) return r
  }
  return null
}

/**
 * Look up the latest state of a previously-stored fixture (for the results
 * cron). Returns null if the API can't find it.
 */
export async function fetchFixtureResult(apiFixtureId, startTimeSec) {
  const start = new Date(startTimeSec * 1000)
  const dayBefore = new Date(start.getTime() - 24 * 60 * 60 * 1000)
  const weekAfter = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
  const rows = await call({
    met: 'Fixtures',
    matchId: String(apiFixtureId),
    from: ymd(dayBefore),
    to: ymd(weekAfter),
  })
  return rows.find((r) => String(r.event_key) === String(apiFixtureId)) || null
}

// Convert AllSportsAPI's `event_date` ("YYYY-MM-DD") + `event_time` ("HH:MM")
// to a unix-second timestamp. The API returns times in UTC by default.
export function fixtureStartSeconds(fixture) {
  const date = fixture?.event_date
  const time = fixture?.event_time || '00:00'
  if (!date) return 0
  const iso = `${date}T${time}:00Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}
