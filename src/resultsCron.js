// GET /cron/results  (invoked by Vercel Cron every 10 min)
//
// For each tracked fixture whose kickoff + ~2.5h has passed and which still
// has no on-chain result, query AllSportsAPI; if finished, propose the
// result (`proposeGameResult`); if postponed/abandoned, cancel the game
// (`cancelGame`); else leave it tracked for the next tick.
//
// This handler proposes only — the second-operator `confirmGameResult` lives
// in the Telegram-bot service (Phase 5).

import { contract, readContract } from './chain.js'
import { fetchFixtureResult, findFixtureByMatch } from './allSportsApi.js'
import { GameResult, ResultStatus } from './p2pBettingAbi.js'
import { kv, keys } from './kv.js'
import { CRON_SECRET } from './config.js'

const MATCH_BUFFER_SECONDS = 150 * 60 // 2h 30min after kickoff before polling
const SWEEP_WINDOW = 50                // number of most-recent gameIds the backstop sweep inspects

// AllSportsAPI status string → on-chain action.
function classifyStatus(status) {
  const s = String(status || '').trim().toLowerCase()
  // Finished / extra time / penalties — read scores and propose a result.
  if (
    s === 'finished' ||
    s === 'after et' ||
    s === 'after pen.' ||
    s === 'after pen' ||
    s === 'ft' ||
    s === 'aet' ||
    s === 'pen'
  ) {
    return 'FINISHED'
  }
  // Did not / cannot finish — cancel the game; pools refund.
  if (
    s === 'postponed' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'abandoned' ||
    s === 'walkover' ||
    s === 'wo'
  ) {
    return 'CANCELLED'
  }
  // Anything else (empty / in-progress / suspended): not actionable yet.
  return 'PENDING'
}

// Map score → GameResult enum, matching the contract's _validateResultConsistency.
function scoresToResult(t1, t2) {
  if (t1 === t2) return GameResult.DRAW
  return t1 > t2 ? GameResult.TEAM1_WIN : GameResult.TEAM2_WIN
}

function parseScore(raw) {
  // AllSportsAPI returns final score as "1 - 2" in `event_final_result`.
  if (!raw || typeof raw !== 'string') return null
  const m = raw.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/)
  if (!m) return null
  return { t1: Number(m[1]), t2: Number(m[2]) }
}

async function isFinishedOnChain(gameId) {
  try {
    const g = await readContract.getGame(BigInt(gameId))
    return Boolean(g?.isFinished)
  } catch (_) {
    return false
  }
}

async function processOne(item, results) {
  const nowSec = Math.floor(Date.now() / 1000)
  if (nowSec < item.startTime + MATCH_BUFFER_SECONDS) {
    results.skipped++
    return
  }

  // If the game is already settled on-chain (someone proposed + the second
  // operator confirmed), we can drop it from tracking.
  if (await isFinishedOnChain(item.gameId)) {
    await kv.del(keys.trackedItem(item.apiFixtureId))
    await kv.srem(keys.trackedSet(), String(item.apiFixtureId))
    results.alreadyOnChain++
    return
  }

  const fixture = await fetchFixtureResult(item.apiFixtureId, item.startTime)
  if (!fixture) {
    results.notFound++
    return
  }
  const verdict = classifyStatus(fixture.event_status)

  try {
    if (verdict === 'FINISHED') {
      const scores = parseScore(fixture.event_final_result)
      if (!scores) {
        results.scoreParseFailed++
        return
      }
      const enumResult = scoresToResult(scores.t1, scores.t2)
      const tx = await contract.proposeGameResult(
        BigInt(item.gameId),
        enumResult,
        BigInt(scores.t1),
        BigInt(scores.t2),
      )
      await tx.wait()
      results.proposed++
      results.proposedDetails.push({
        apiFixtureId: item.apiFixtureId,
        gameId: item.gameId,
        result: enumResult,
        scores,
      })
      // Don't untrack yet — only untrack once the second operator confirms.
      return
    }

    if (verdict === 'CANCELLED') {
      const tx = await contract.cancelGame(BigInt(item.gameId))
      await tx.wait()
      await kv.del(keys.trackedItem(item.apiFixtureId))
      await kv.srem(keys.trackedSet(), String(item.apiFixtureId))
      results.cancelled++
      return
    }

    // Still PENDING (live / suspended / status missing) — leave for next tick.
    results.pending++
  } catch (err) {
    const msg = err?.shortMessage || err?.message || String(err)
    // Re-proposing or proposing for a finished game is fine — just skip.
    if (/ResultAlreadyPending|GameAlreadyFinished/i.test(msg)) {
      results.alreadyProposed++
      return
    }
    results.failed++
    results.failedDetails.push({ apiFixtureId: item.apiFixtureId, error: msg })
  }
}

// Shared auth gate for both cron endpoints.
function authorizedCron(req, res) {
  if (!CRON_SECRET) return true
  const auth = req.headers?.authorization || req.get?.('authorization') || ''
  if (auth !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

// Primary handler — processes the KV trackedSet only. ensureGame writes
// straight into this set, so this is the fast path for every game the
// frontend creates. Runs every 10 min via Vercel Cron (`/cron/results`).
export async function resultsCronHandler(req, res) {
  if (!authorizedCron(req, res)) return

  const results = {
    scanned: 0,
    skipped: 0,
    pending: 0,
    proposed: 0,
    cancelled: 0,
    alreadyOnChain: 0,
    alreadyProposed: 0,
    notFound: 0,
    scoreParseFailed: 0,
    failed: 0,
    proposedDetails: [],
    failedDetails: [],
  }

  try {
    const members = await kv.smembers(keys.trackedSet())
    results.scanned = members.length
    for (const id of members) {
      const item = await kv.get(keys.trackedItem(id))
      if (!item) {
        // Stale set entry — clean up.
        await kv.srem(keys.trackedSet(), id)
        continue
      }
      // Process in series — keeps nonce ordering simple and rate-friendly.
      // eslint-disable-next-line no-await-in-loop
      await processOne(item, results)
    }
    res.json({ ok: true, results })
  } catch (err) {
    console.error('[GET /cron/results] failed:', err)
    res.status(500).json({ error: err?.message || 'cron failed', results })
  }
}

// Resolve the apiFixtureId for an on-chain game. First tries the KV reverse
// map (ensureGame writes it). Falls back to an AllSportsAPI team+date search
// so admin-panel-created games can be settled too — and caches the result
// in the reverse map so the next tick takes the fast path.
async function resolveApiFixtureId(gameId, game) {
  const ref = await kv.get(keys.gameToFixture(gameId))
  const cached = Number(ref?.apiFixtureId)
  if (Number.isFinite(cached) && cached > 0) {
    return { apiFixtureId: cached, source: 'reverse-map' }
  }
  try {
    const fixture = await findFixtureByMatch(
      Number(game.leagueId),
      game.team1,
      game.team2,
      Number(game.startTime),
    )
    if (!fixture?.event_key) return { apiFixtureId: null, source: 'no-match' }
    const apiFixtureId = Number(fixture.event_key)
    // Cache for subsequent ticks.
    await kv.set(keys.gameToFixture(gameId), {
      apiFixtureId,
      leagueId: Number(game.leagueId),
    })
    return { apiFixtureId, source: 'allsports-search' }
  } catch (err) {
    console.warn(`[cron sweep] AllSportsAPI lookup failed for game ${gameId}:`, err?.message)
    return { apiFixtureId: null, source: 'lookup-error' }
  }
}

// Pure sweep body — no req/res, no auth. Called by sweepCronHandler over
// HTTP and directly by the local startup hook in src/index.js so a fresh
// `npm start` immediately proposes results for any finished games sitting
// in the last 20 game IDs without a proposal.
export async function runSweep() {
  const results = {
    scanned: 0,
    pending: 0,
    proposed: 0,
    cancelled: 0,
    alreadyOnChain: 0,
    alreadyProposed: 0,
    notFound: 0,
    scoreParseFailed: 0,
    failed: 0,
    proposedDetails: [],
    failedDetails: [],
    sweepWindow: SWEEP_WINDOW,
    sweepInspected: 0,
    sweepNotYetDue: 0,
    sweepAlreadyPending: 0,
    sweepAlreadyConfirmed: 0,
    sweepResolvedViaReverseMap: 0,
    sweepResolvedViaAllSports: 0,
    sweepUnresolvable: 0,
    sweepProcessed: 0,
  }

  const total = Number(await readContract.getGameCount())
  if (!Number.isFinite(total) || total <= 0) return results

  const start = Math.max(0, total - SWEEP_WINDOW)
  const nowSec = Math.floor(Date.now() / 1000)

  for (let gameId = start; gameId < total; gameId++) {
    results.sweepInspected++

    let game
    try {
      // eslint-disable-next-line no-await-in-loop
      game = await readContract.getGame(BigInt(gameId))
    } catch (_) {
      continue
    }
    if (!game) continue
    if (game.isFinished) continue
    if (Number(game.result) === GameResult.CANCELLED) continue

    const startTime = Number(game.startTime)
    if (nowSec < startTime + MATCH_BUFFER_SECONDS) {
      results.sweepNotYetDue++
      continue
    }

    // Skip if a proposal is already pending or confirmed.
    try {
      // eslint-disable-next-line no-await-in-loop
      const pending = await readContract.pendingResults(BigInt(gameId))
      const status = Number(pending?.status ?? pending?.[0] ?? 0)
      if (status === ResultStatus.PENDING) {
        results.sweepAlreadyPending++
        continue
      }
      if (status === ResultStatus.CONFIRMED) {
        results.sweepAlreadyConfirmed++
        continue
      }
    } catch (_) {
      // Fall through; processOne's catch handles duplicate proposals.
    }

    // eslint-disable-next-line no-await-in-loop
    const { apiFixtureId, source } = await resolveApiFixtureId(gameId, game)
    if (!apiFixtureId) {
      results.sweepUnresolvable++
      continue
    }
    if (source === 'reverse-map') results.sweepResolvedViaReverseMap++
    else if (source === 'allsports-search') results.sweepResolvedViaAllSports++

    const item = {
      apiFixtureId,
      gameId,
      leagueId: Number(game.leagueId),
      startTime,
      team1: game.team1,
      team2: game.team2,
    }
    // Make sure this fixture lands in the primary trackedSet too, so
    // subsequent ticks of /cron/results pick it up on the fast path.
    // eslint-disable-next-line no-await-in-loop
    await kv.set(keys.trackedItem(apiFixtureId), { ...item, addedAt: Date.now() })
    // eslint-disable-next-line no-await-in-loop
    await kv.sadd(keys.trackedSet(), String(apiFixtureId))
    results.sweepProcessed++
    // eslint-disable-next-line no-await-in-loop
    await processOne(item, results)
  }

  return results
}

// Backstop sweep — bounded to the last SWEEP_WINDOW on-chain games. Runs
// on a separate, slower schedule (`/cron/sweep`, every 30 min) so the
// primary trackedSet path is never blocked by sweep work.
//
// The sweep is purely additive: anything already proposed/confirmed/
// finished is skipped. Games already in the trackedSet are skipped via
// pendingResults state — the primary cron will have processed them in
// the same window.
export async function sweepCronHandler(req, res) {
  if (!authorizedCron(req, res)) return
  try {
    const results = await runSweep()
    res.json({ ok: true, results })
  } catch (err) {
    console.error('[GET /cron/sweep] failed:', err)
    res.status(500).json({ error: err?.message || 'sweep failed' })
  }
}
