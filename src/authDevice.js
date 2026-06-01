// New-device sign-in alerts — #5b of the security plan.
//
// Flow:
//   1. On sign-in success, frontend reads (or generates) a stable deviceId
//      from localStorage and POSTs { email, deviceId, userAgent }.
//   2. Server tracks the set of deviceIds it's seen for this email in KV.
//      - First-ever device for a brand-new email → log silently. No alert
//        because we'd be alerting the user about themselves on first signin.
//      - Subsequent unknown device → fire a Resend email alert.
//   3. Known device → just bump lastSeen, no email.
//
// Rate limited per email to keep the alert email cost bounded.

import { kv, keys } from './kv.js'
import { sendNewDeviceAlertEmail } from './email.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_DEVICES_TRACKED = 20
const RATE_WINDOW_MS = 60 * 60 * 1000
const MAX_CALLS_PER_WINDOW = 60

async function prune(arr, now, ttl) {
  const cutoff = now - ttl
  return (arr || []).filter((t) => Number(t) > cutoff)
}

function clientIp(req) {
  // Vercel + Express forwards: prefer the first IP in x-forwarded-for.
  const fwd = req.headers?.['x-forwarded-for'] || ''
  if (fwd) return String(fwd).split(',')[0].trim()
  return req.ip || req.socket?.remoteAddress || ''
}

export async function registerDeviceHandler(req, res) {
  try {
    const { email, deviceId, userAgent } = req.body || {}
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email' })
    }
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 128) {
      return res.status(400).json({ error: 'Invalid deviceId' })
    }

    // Rate-limit so a runaway client can't blast us with bogus device IDs.
    const now = Date.now()
    const rlRaw = await kv.get(keys.deviceRateLimit(email))
    const recent = await prune((rlRaw && rlRaw.calls) || [], now, RATE_WINDOW_MS)
    if (recent.length >= MAX_CALLS_PER_WINDOW) {
      return res.status(429).json({ error: 'Too many device registrations' })
    }
    recent.push(now)
    await kv.set(keys.deviceRateLimit(email), { calls: recent })

    // Look up the device set for this email.
    const seenRaw = await kv.get(keys.devicesSeen(email))
    const list = (seenRaw && seenRaw.list) || []
    const isFirstEverDevice = list.length === 0
    const idx = list.findIndex((d) => d.id === deviceId)
    const isNewDevice = idx === -1

    if (isNewDevice) {
      // Prepend (newest first), cap to MAX_DEVICES_TRACKED so we don't grow
      // forever for ultra-active accounts.
      const entry = {
        id: deviceId,
        firstSeen: now,
        lastSeen: now,
        userAgent: String(userAgent || '').slice(0, 256),
      }
      const next = [entry, ...list].slice(0, MAX_DEVICES_TRACKED)
      await kv.set(keys.devicesSeen(email), { list: next })

      // Only alert on *subsequent* new devices. First-ever device for an
      // email is the user's onboarding device; alerting then would be noise.
      if (!isFirstEverDevice) {
        const ip = clientIp(req)
        // Fire and forget — we don't want email-send failure to break sign-in.
        sendNewDeviceAlertEmail({
          to: email,
          userAgent,
          ip,
          when: now,
        }).catch((e) => console.warn('[auth/device] alert send failed:', e?.message))
      }
      return res.json({ ok: true, isNewDevice: true, isFirstEverDevice })
    }

    // Known device — bump lastSeen.
    list[idx] = { ...list[idx], lastSeen: now }
    await kv.set(keys.devicesSeen(email), { list })
    return res.json({ ok: true, isNewDevice: false, isFirstEverDevice: false })
  } catch (err) {
    console.error('[POST /auth/device/register] failed:', err)
    return res.status(500).json({ error: err?.message || 'register failed' })
  }
}
