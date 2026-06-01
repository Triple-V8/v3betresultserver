// Email-code re-auth for withdrawals — #2 of the security plan.
//
// Flow:
//   1. Frontend POSTs /auth/withdraw/request-code { email, destination, amount }.
//      Server rate-limits, generates a 6-digit code, stores its hash in KV
//      with a 10-minute TTL, sends the code via Resend.
//   2. Frontend POSTs /auth/withdraw/verify-code  { email, destination, code }.
//      Server hashes the supplied code, constant-time compares, marks the
//      destination as "trusted" for this email on success.
//   3. Future withdrawals to the same destination are pre-authorized for
//      ~30 days (trusted-set TTL).
//
// Important: the actual on-chain USDC transfer is still signed by the user's
// wallet client-side. This endpoint just gates whether the frontend submits.
// An attacker who fully owns the page session can bypass the gate by skipping
// the call; the real fix for that is #1 (scoped session keys). This layer
// catches the much more common (and devastating) case of clipboard-swap or
// human typo on a copy-paste.

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { isAddress } from 'ethers'

import { kv, keys } from './kv.js'
import { sendWithdrawCodeEmail } from './email.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_TTL_MS = 10 * 60 * 1000
const RATE_WINDOW_MS = 60 * 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 5
const MAX_VERIFY_ATTEMPTS = 5
const TRUST_TTL_MS = 30 * 24 * 60 * 60 * 1000

function hashCode(code, email, destination) {
  // Bind the code to the (email, destination) pair so a stolen code can only
  // be used for the exact withdrawal it was issued for.
  return createHash('sha256')
    .update(`${code}|${email.toLowerCase()}|${destination.toLowerCase()}`)
    .digest('hex')
}

function safeEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(aHex, 'hex')
    const b = Buffer.from(bHex, 'hex')
    if (a.length !== b.length || a.length === 0) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

async function prune(arr, now, ttl) {
  const cutoff = now - ttl
  return (arr || []).filter((t) => Number(t) > cutoff)
}

// ── POST /auth/withdraw/request-code ────────────────────────────────────
export async function requestWithdrawCodeHandler(req, res) {
  try {
    const { email, destination, amount } = req.body || {}
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email' })
    }
    if (!destination || !isAddress(destination)) {
      return res.status(400).json({ error: 'Invalid destination address' })
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    // Skip the email round-trip if this destination is already trusted.
    const trustedRaw = await kv.get(keys.withdrawTrusted(email))
    const trusted = (trustedRaw && trustedRaw.list) || []
    if (trusted.some((t) => t.addr === destination.toLowerCase() && t.until > Date.now())) {
      return res.json({ ok: true, alreadyTrusted: true })
    }

    // Rate limit.
    const now = Date.now()
    const rlRaw = await kv.get(keys.withdrawCodeRateLimit(email))
    const recent = await prune((rlRaw && rlRaw.attempts) || [], now, RATE_WINDOW_MS)
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      const oldest = Math.min(...recent)
      const retryAfter = Math.max(0, oldest + RATE_WINDOW_MS - now)
      return res
        .status(429)
        .json({ error: 'Too many code requests — try again later', retryAfter })
    }
    recent.push(now)
    await kv.set(keys.withdrawCodeRateLimit(email), { attempts: recent })

    // Generate a 6-digit code (cryptographically random).
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const codeHash = hashCode(code, email, destination)
    await kv.set(keys.withdrawCode(email, destination), {
      codeHash,
      attemptsLeft: MAX_VERIFY_ATTEMPTS,
      amount: String(amount),
      expiresAt: now + CODE_TTL_MS,
    })

    const send = await sendWithdrawCodeEmail({
      to: email,
      code,
      destination,
      amount: String(amount),
    })
    if (!send.sent) {
      console.warn('[auth/withdraw] email did not send:', send.error)
    }

    return res.json({ ok: true })
  } catch (err) {
    console.error('[POST /auth/withdraw/request-code] failed:', err)
    return res.status(500).json({ error: err?.message || 'request-code failed' })
  }
}

// ── POST /auth/withdraw/verify-code ─────────────────────────────────────
export async function verifyWithdrawCodeHandler(req, res) {
  try {
    const { email, destination, code } = req.body || {}
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email' })
    }
    if (!destination || !isAddress(destination)) {
      return res.status(400).json({ error: 'Invalid destination' })
    }
    const supplied = String(code || '').trim()
    if (!/^\d{4,8}$/.test(supplied)) {
      return res.status(400).json({ error: 'Invalid code' })
    }

    const entry = await kv.get(keys.withdrawCode(email, destination))
    if (!entry) {
      return res.status(400).json({ error: 'No active code — request a new one' })
    }
    if (Date.now() > Number(entry.expiresAt || 0)) {
      await kv.del(keys.withdrawCode(email, destination))
      return res.status(400).json({ error: 'Code expired — request a new one' })
    }
    if (Number(entry.attemptsLeft || 0) <= 0) {
      await kv.del(keys.withdrawCode(email, destination))
      return res.status(429).json({ error: 'Too many incorrect attempts — request a new code' })
    }

    const hashed = hashCode(supplied, email, destination)
    if (!safeEqualHex(hashed, entry.codeHash)) {
      const left = Number(entry.attemptsLeft) - 1
      if (left <= 0) {
        await kv.del(keys.withdrawCode(email, destination))
      } else {
        await kv.set(keys.withdrawCode(email, destination), {
          ...entry,
          attemptsLeft: left,
        })
      }
      return res.status(400).json({ error: 'Incorrect code', attemptsLeft: Math.max(left, 0) })
    }

    // Success — consume the code and add the destination to the trusted set.
    await kv.del(keys.withdrawCode(email, destination))

    const trustedRaw = await kv.get(keys.withdrawTrusted(email))
    const list = (trustedRaw && trustedRaw.list) || []
    const idx = list.findIndex((t) => t.addr === destination.toLowerCase())
    const entryRow = {
      addr: destination.toLowerCase(),
      until: Date.now() + TRUST_TTL_MS,
    }
    if (idx >= 0) list[idx] = entryRow
    else list.push(entryRow)
    await kv.set(keys.withdrawTrusted(email), { list })

    return res.json({ ok: true })
  } catch (err) {
    console.error('[POST /auth/withdraw/verify-code] failed:', err)
    return res.status(500).json({ error: err?.message || 'verify-code failed' })
  }
}
