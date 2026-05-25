// Environment + chain + league registry. Fails fast with a clear error if a
// required variable is missing.

import 'dotenv/config'

function required(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required env var: ${name} — copy .env.example to .env and fill it in.`,
    )
  }
  return value
}

export const PORT = Number(process.env.PORT || 8788)

export const CHAIN_ID = Number(process.env.CHAIN_ID || 84532)
export const IS_TESTNET = CHAIN_ID === 84532

// Default RPC = the chain's public endpoint. Override with a paid endpoint
// for production throughput.
const DEFAULT_RPC = IS_TESTNET
  ? 'https://sepolia.base.org'
  : 'https://mainnet.base.org'
export const RPC_URL = process.env.RPC_URL || DEFAULT_RPC

export const P2P_BETTING_ADDRESS = required('P2P_BETTING_ADDRESS')
export const OPERATOR_PRIVATE_KEY = required('OPERATOR_PRIVATE_KEY')
export const ALLSPORTSAPI_KEY = required('ALLSPORTSAPI_KEY')

export const CRON_SECRET = process.env.CRON_SECRET || ''

export const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || 'http://localhost:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Registered leagues. The set MUST match what's been added on-chain via
// `addLeague(leagueId, name)`. Keep this in sync with
// `scripts/add-all-leagues.js` at the repo root.
export const LEAGUES = [
  { leagueId: 28,    name: 'FIFA World Cup' },
  { leagueId: 3,     name: 'UEFA Champions League' },
  { leagueId: 1,     name: 'UEFA European Championship' },
  { leagueId: 152,   name: 'Premier League' },
  { leagueId: 17,    name: 'Copa América' },
  { leagueId: 302,   name: 'La Liga' },
  { leagueId: 175,   name: 'Bundesliga' },
  { leagueId: 207,   name: 'Serie A' },
  { leagueId: 12614, name: 'FIFA Club World Cup' },
  { leagueId: 29,    name: 'Africa Cup of Nations' },
  { leagueId: 168,   name: 'Ligue 1' },
  { leagueId: 4,     name: 'UEFA Europa League' },
  { leagueId: 99,    name: 'Campeonato Brasileiro Série A' },
  { leagueId: 18,    name: 'Copa Libertadores' },
  { leagueId: 332,   name: 'Major League Soccer' },
  { leagueId: 278,   name: 'Saudi Pro League' },
  { leagueId: 266,   name: 'Primeira Liga' },
  { leagueId: 244,   name: 'Eredivisie' },
  { leagueId: 683,   name: 'UEFA Conference League' },
  { leagueId: 15,    name: 'CONCACAF Gold Cup' },
  { leagueId: 63,    name: 'Belgian Pro League' },
  { leagueId: 146,   name: 'FA Cup' },
  { leagueId: 322,   name: 'Turkish Süper Lig' },
  { leagueId: 44,    name: 'Argentine Primera División' },
  { leagueId: 147,   name: 'EFL Cup' },
  { leagueId: 279,   name: 'Scottish Premiership' },
  { leagueId: 5,     name: 'CONCACAF Champions Cup' },
  { leagueId: 308,   name: 'Swiss Super League' },
  { leagueId: 10,    name: 'AFC Champions League Elite' },
  { leagueId: 56,    name: 'Austrian Bundesliga' },
  { leagueId: 346,   name: 'CAF Champions League' },
  { leagueId: 135,   name: 'Danish Superliga' },
  { leagueId: 178,   name: 'Greek Super League' },
  { leagueId: 633,   name: 'UEFA Nations League' },
  { leagueId: 259,   name: 'Polish Ekstraklasa' },
  { leagueId: 390,   name: 'CAF Confederation Cup' },
  { leagueId: 253,   name: 'Norwegian Eliteserien' },
  { leagueId: 347,   name: 'Asian Cup' },
  { leagueId: 325,   name: 'Ukrainian Premier League' },
  { leagueId: 134,   name: 'Czech First League' },
  { leagueId: 431,   name: 'Leagues Cup' },
  { leagueId: 235,   name: 'Liga MX' },
  { leagueId: 385,   name: 'Copa Sudamericana' },
  { leagueId: 307,   name: 'Swedish Allsvenskan' },
  { leagueId: 425,   name: 'FIFA U-20 World Cup' },
  { leagueId: 288,   name: 'Serbian SuperLiga' },
  { leagueId: 665,   name: 'OFC Nations Cup' },
  { leagueId: 124,   name: 'Croatian Football League' },
  { leagueId: 646,   name: 'Arab Club Champions Cup' },
  { leagueId: 118,   name: 'Chinese Super League' },
]

export const LEAGUE_IDS = new Set(LEAGUES.map((l) => l.leagueId))

export function leagueExists(leagueId) {
  return LEAGUE_IDS.has(Number(leagueId))
}

// On-chain MIN_FUTURE_TIME = 1 hour (`P2PBetting.MIN_FUTURE_TIME`). We add a
// small buffer so a fixture that's ~1h away doesn't race the contract's check
// between fetch and tx mining.
export const MIN_FIXTURE_LEAD_SECONDS = 65 * 60 // 1h 5min
