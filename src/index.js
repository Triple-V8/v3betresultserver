// Local entry point — starts the oracle with a long-lived listener.
// On Vercel the app is served as a serverless function (api/index.js)
// and this file is not used.

import app from './app.js'
import { PORT, CHAIN_ID, P2P_BETTING_ADDRESS } from './config.js'
import { operatorAddress } from './chain.js'
import { runSweep } from './resultsCron.js'

app.listen(PORT, () => {
  console.log(`V3 Bet sports oracle listening on http://localhost:${PORT}`)
  console.log(`Chain id:            ${CHAIN_ID}`)
  console.log(`P2PBetting:          ${P2P_BETTING_ADDRESS}`)
  console.log(`Operator (propose):  ${operatorAddress}`)

  // Fire the bounded last-20 backstop sweep once on startup so a fresh
  // restart immediately proposes results for any finished games still
  // missing a proposal. Doesn't block listen — runs in the background.
  console.log('[startup] running backstop sweep over last 20 games…')
  runSweep()
    .then((results) => {
      const summary = {
        inspected: results.sweepInspected,
        proposed: results.proposed,
        cancelled: results.cancelled,
        alreadyPending: results.sweepAlreadyPending,
        alreadyConfirmed: results.sweepAlreadyConfirmed,
        notYetDue: results.sweepNotYetDue,
        unresolvable: results.sweepUnresolvable,
        viaReverseMap: results.sweepResolvedViaReverseMap,
        viaAllSports: results.sweepResolvedViaAllSports,
        failed: results.failed,
      }
      console.log('[startup] sweep done:', summary)
      if (results.proposedDetails?.length) {
        console.log('[startup] proposed:', results.proposedDetails)
      }
      if (results.failedDetails?.length) {
        console.warn('[startup] failed:', results.failedDetails)
      }
    })
    .catch((err) => {
      console.error('[startup] sweep failed:', err?.message || err)
    })
})
