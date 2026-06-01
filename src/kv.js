// Vercel KV adapter with an in-memory fallback so the service works locally
// (and in tests) without provisioning KV. The fallback is process-local —
// state is lost on restart, which is fine for dev but obviously not for
// production. In production, set KV_REST_API_URL + KV_REST_API_TOKEN via the
// Vercel Storage integration.

let backend
const inMemory = new Map()

function memoryBackend() {
  return {
    name: 'in-memory',
    async get(key) {
      const v = inMemory.get(key)
      return v === undefined ? null : JSON.parse(v)
    },
    async set(key, value) {
      inMemory.set(key, JSON.stringify(value))
    },
    async del(key) {
      inMemory.delete(key)
    },
    async sadd(key, member) {
      const set = inMemory.get(key)
        ? new Set(JSON.parse(inMemory.get(key)))
        : new Set()
      set.add(member)
      inMemory.set(key, JSON.stringify([...set]))
    },
    async srem(key, member) {
      const set = inMemory.get(key)
        ? new Set(JSON.parse(inMemory.get(key)))
        : new Set()
      set.delete(member)
      inMemory.set(key, JSON.stringify([...set]))
    },
    async smembers(key) {
      const raw = inMemory.get(key)
      return raw ? JSON.parse(raw) : []
    },
  }
}

async function init() {
  if (backend) return backend
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const mod = await import('@vercel/kv')
    backend = {
      name: 'vercel-kv',
      get: (k) => mod.kv.get(k),
      set: (k, v) => mod.kv.set(k, v),
      del: (k) => mod.kv.del(k),
      sadd: (k, m) => mod.kv.sadd(k, m),
      srem: (k, m) => mod.kv.srem(k, m),
      smembers: (k) => mod.kv.smembers(k),
    }
  } else {
    backend = memoryBackend()
    console.warn(
      '[kv] Vercel KV not configured — using in-memory fallback (state is process-local; ok for dev).',
    )
  }
  return backend
}

export const kv = {
  async get(key) {
    const b = await init()
    return b.get(key)
  },
  async set(key, value) {
    const b = await init()
    return b.set(key, value)
  },
  async del(key) {
    const b = await init()
    return b.del(key)
  },
  async sadd(key, member) {
    const b = await init()
    return b.sadd(key, member)
  },
  async srem(key, member) {
    const b = await init()
    return b.srem(key, member)
  },
  async smembers(key) {
    const b = await init()
    return b.smembers(key)
  },
}

// ── Key conventions ──────────────────────────────────────────────────────
//
// Mappings + indexes used by ensureGame / trackGame / resultsCron.
export const keys = {
  /** apiFixtureId → { gameId, leagueId, createdAt } */
  fixtureMap: (apiFixtureId) => `fixture:${apiFixtureId}`,
  /** set of apiFixtureIds pending a result */
  trackedSet: () => 'tracked',
  /** apiFixtureId → tracked metadata { gameId, leagueId, startTime, team1, team2 } */
  trackedItem: (apiFixtureId) => `tracked:${apiFixtureId}`,
  /** gameId (on-chain index) → apiFixtureId, populated by ensureGame.
   *  Used by the cron's on-chain backstop sweep to recover apiFixtureId for
   *  games whose trackedItem fell out of KV. */
  gameToFixture: (gameId) => `game:${gameId}`,

  // ── Email-code re-auth for withdrawals (#2) ─────────────────────────────
  /** Active 6-digit code for an (email, destination) pair. TTL ~10 min via
   *  attached `expiresAt`; value = { codeHash, attemptsLeft, amount, expiresAt }. */
  withdrawCode: (email, destination) =>
    `wd:code:${email.toLowerCase()}:${destination.toLowerCase()}`,
  /** Per-email rate-limit bucket for /auth/withdraw/request-code */
  withdrawCodeRateLimit: (email) => `wd:rl:${email.toLowerCase()}`,
  /** Set of trusted destinations the user has previously confirmed via email
   *  code. Looked up by both endpoints to decide whether a fresh code is
   *  needed. */
  withdrawTrusted: (email) => `wd:trusted:${email.toLowerCase()}`,

  // ── Device tracking for new-device alerts (#5b) ──────────────────────────
  /** Set of deviceIds we've seen for this email. */
  devicesSeen: (email) => `dev:seen:${email.toLowerCase()}`,
  /** Per-email rate-limit bucket for /auth/device/register */
  deviceRateLimit: (email) => `dev:rl:${email.toLowerCase()}`,
}
