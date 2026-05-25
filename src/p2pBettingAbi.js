// Minimal ABI fragment — only the functions/events the oracle calls.
// Kept narrow on purpose: shorter ABI → smaller bundle and a clear contract
// surface for this service.

export const P2P_BETTING_ABI = [
  // Writes
  {
    type: 'function',
    name: 'createGame',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'leagueId', type: 'uint256' },
      { name: 'team1', type: 'string' },
      { name: 'team2', type: 'string' },
      { name: 'startTime', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'proposeGameResult',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'gameIndex', type: 'uint256' },
      { name: 'result', type: 'uint8' }, // GameResult enum
      { name: 'team1Score', type: 'uint256' },
      { name: 'team2Score', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelGame',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'gameIndex', type: 'uint256' }],
    outputs: [],
  },
  // Reads — sanity checks
  {
    type: 'function',
    name: 'getGame',
    stateMutability: 'view',
    inputs: [{ name: 'gameIndex', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'leagueId', type: 'uint256' },
          { name: 'team1', type: 'string' },
          { name: 'team2', type: 'string' },
          { name: 'startTime', type: 'uint256' },
          { name: 'isFinished', type: 'bool' },
          { name: 'result', type: 'uint8' },
          { name: 'team1Score', type: 'uint256' },
          { name: 'team2Score', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'leagues',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'exists', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'gamesByLeague',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isOperator',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getLeagueIds',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getGameCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getGamesByLeague',
    stateMutability: 'view',
    inputs: [{ name: 'leagueId', type: 'uint256' }],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'pendingResults',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'status', type: 'uint8' },
      { name: 'result', type: 'uint8' },
      { name: 'team1Score', type: 'uint256' },
      { name: 'team2Score', type: 'uint256' },
      { name: 'proposedBy', type: 'address' },
      { name: 'proposalId', type: 'uint256' },
      { name: 'confirmationCount', type: 'uint256' },
      { name: 'proposedAt', type: 'uint256' },
      { name: 'confirmationDeadline', type: 'uint256' },
    ],
  },
  // Events
  {
    type: 'event',
    name: 'GameCreated',
    inputs: [
      { name: 'gameIndex', type: 'uint256', indexed: true },
      { name: 'leagueId', type: 'uint256', indexed: true },
      { name: 'team1', type: 'string', indexed: false },
      { name: 'team2', type: 'string', indexed: false },
      { name: 'startTime', type: 'uint256', indexed: false },
    ],
  },
]

// GameResult enum values, matching the contract.
export const GameResult = {
  UNSET: 0,
  CANCELLED: 1,
  TEAM1_WIN: 2,
  TEAM2_WIN: 3,
  DRAW: 4,
}

// ResultStatus enum on pendingResults[gameId].status.
export const ResultStatus = {
  UNSET: 0,
  PENDING: 1,
  CONFIRMED: 2,
  DISPUTED: 3,
}
