// Resend client + two transactional email templates:
//
//   1. Withdrawal verification code (#2 of the security plan).
//   2. New-device sign-in alert    (#5b of the security plan).
//
// If RESEND_API_KEY is missing, both helpers log to console instead of
// throwing so local dev keeps working with the same code path.

import { Resend } from 'resend'
import { RESEND_API_KEY, RESEND_FROM_EMAIL, PUBLIC_APP_URL } from './config.js'

let _resend = null
function client() {
  if (!RESEND_API_KEY) return null
  if (!_resend) _resend = new Resend(RESEND_API_KEY)
  return _resend
}

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string' || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ── Email #1: withdrawal verification code ──────────────────────────────
export async function sendWithdrawCodeEmail({ to, code, destination, amount }) {
  const subject = `Your V3 Bet withdrawal code: ${code}`
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; background: #0d1f2d; color: #e6edf3; padding: 32px; border-radius: 12px;">
      <h2 style="color: #62f7a2; margin: 0 0 16px;">Confirm your withdrawal</h2>
      <p style="color: #9aa6b2; line-height: 1.5; margin: 0 0 24px;">
        Enter this code in the V3 Bet withdrawal screen to send funds to a new address.
        The code expires in <strong style="color: #fff;">10 minutes</strong>.
      </p>
      <div style="background: #0a1722; border: 2px solid #62f7a2; border-radius: 8px; padding: 24px; text-align: center; margin: 0 0 24px;">
        <p style="margin: 0 0 8px; font-size: 12px; color: #9aa6b2; letter-spacing: 0.1em; text-transform: uppercase;">Verification code</p>
        <p style="margin: 0; font-size: 36px; font-weight: 800; letter-spacing: 0.25em; color: #fff;">${code}</p>
      </div>
      <div style="background: #0a1722; border-radius: 8px; padding: 16px; margin: 0 0 24px;">
        <p style="margin: 0 0 4px; font-size: 11px; color: #9aa6b2;">Amount</p>
        <p style="margin: 0 0 12px; font-size: 16px; color: #fff;"><strong>${amount} USDC</strong></p>
        <p style="margin: 0 0 4px; font-size: 11px; color: #9aa6b2;">Destination</p>
        <p style="margin: 0; font-size: 13px; font-family: ui-monospace, monospace; color: #fff; word-break: break-all;">${destination}</p>
      </div>
      <p style="color: #f5c14a; font-size: 13px; line-height: 1.5; margin: 0 0 16px;">
        <strong>⚠ If you didn't request this withdrawal,</strong> ignore this email and rotate your account immediately —
        someone may have access to your sign-in session.
      </p>
      <p style="color: #6b7785; font-size: 11px; margin: 0; line-height: 1.5;">
        V3 Bet · <a href="${PUBLIC_APP_URL}" style="color: #9aa6b2;">${PUBLIC_APP_URL}</a>
      </p>
    </div>
  `.trim()

  const text = `Your V3 Bet withdrawal code: ${code}

Enter this in the withdrawal screen to send ${amount} USDC to ${shortAddr(destination)}.
Code expires in 10 minutes.

Destination: ${destination}

If you didn't request this withdrawal, ignore this email and review your account at ${PUBLIC_APP_URL}.`

  const r = client()
  if (!r) {
    console.warn('[email] RESEND_API_KEY missing — would send withdraw code to', to, code)
    return { sent: false }
  }
  try {
    const result = await r.emails.send({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html,
      text,
    })
    if (result?.error) {
      console.error('[email] withdraw-code send error:', result.error)
      return { sent: false, error: result.error }
    }
    return { sent: true, id: result?.data?.id }
  } catch (err) {
    console.error('[email] withdraw-code threw:', err)
    return { sent: false, error: err?.message }
  }
}

// ── Email #2: new-device sign-in alert ──────────────────────────────────
export async function sendNewDeviceAlertEmail({ to, userAgent, ip, when }) {
  const ts = (when ? new Date(when) : new Date()).toUTCString()
  const subject = 'New device signed in to your V3 Bet account'
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; background: #0d1f2d; color: #e6edf3; padding: 32px; border-radius: 12px;">
      <h2 style="color: #f5c14a; margin: 0 0 16px;">⚠ New device signed in</h2>
      <p style="color: #9aa6b2; line-height: 1.5; margin: 0 0 24px;">
        A new device just signed in to your V3 Bet account.
      </p>
      <div style="background: #0a1722; border-radius: 8px; padding: 16px; margin: 0 0 24px;">
        <p style="margin: 0 0 4px; font-size: 11px; color: #9aa6b2;">When (UTC)</p>
        <p style="margin: 0 0 12px; font-size: 13px; color: #fff;">${ts}</p>
        <p style="margin: 0 0 4px; font-size: 11px; color: #9aa6b2;">Device</p>
        <p style="margin: 0 0 12px; font-size: 13px; color: #fff; word-break: break-word;">${userAgent || 'Unknown'}</p>
        ${ip ? `<p style="margin: 0 0 4px; font-size: 11px; color: #9aa6b2;">IP</p>
        <p style="margin: 0; font-size: 13px; font-family: ui-monospace, monospace; color: #fff;">${ip}</p>` : ''}
      </div>
      <p style="color: #62f7a2; font-size: 14px; line-height: 1.5; margin: 0 0 16px;">
        <strong>If this was you</strong> — no action needed. We'll only email you when a
        device we haven't seen before signs in.
      </p>
      <p style="color: #ff7a7a; font-size: 13px; line-height: 1.5; margin: 0 0 16px;">
        <strong>If this wasn't you</strong> — withdraw funds to a wallet you control
        immediately and avoid signing in again until you've reviewed your inbox for
        suspicious sign-in links. Visit <a href="${PUBLIC_APP_URL}" style="color: #62f7a2;">${PUBLIC_APP_URL}</a>.
      </p>
      <p style="color: #6b7785; font-size: 11px; margin: 0; line-height: 1.5;">
        V3 Bet · <a href="${PUBLIC_APP_URL}" style="color: #9aa6b2;">${PUBLIC_APP_URL}</a>
      </p>
    </div>
  `.trim()

  const text = `A new device just signed in to your V3 Bet account.

Time (UTC): ${ts}
Device: ${userAgent || 'Unknown'}${ip ? `
IP: ${ip}` : ''}

If this was you, no action needed.
If this wasn't you, withdraw funds to a wallet you control and review your account at ${PUBLIC_APP_URL}.`

  const r = client()
  if (!r) {
    console.warn('[email] RESEND_API_KEY missing — would send new-device alert to', to)
    return { sent: false }
  }
  try {
    const result = await r.emails.send({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html,
      text,
    })
    if (result?.error) {
      console.error('[email] new-device alert error:', result.error)
      return { sent: false, error: result.error }
    }
    return { sent: true, id: result?.data?.id }
  } catch (err) {
    console.error('[email] new-device alert threw:', err)
    return { sent: false, error: err?.message }
  }
}
