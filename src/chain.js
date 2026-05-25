// ethers v6 client + operator wallet + P2PBetting contract handle.
//
// The wallet held here is the *propose* operator (wallet #1 of the
// two-operator settlement model). It signs `createGame`, `proposeGameResult`,
// and `cancelGame`. The *confirm* operator lives in the separate Telegram-bot
// service (Phase 5).

import { ethers } from 'ethers'
import {
  RPC_URL,
  CHAIN_ID,
  P2P_BETTING_ADDRESS,
  OPERATOR_PRIVATE_KEY,
} from './config.js'
import { P2P_BETTING_ABI } from './p2pBettingAbi.js'

export const provider = new ethers.JsonRpcProvider(RPC_URL, {
  chainId: CHAIN_ID,
  name: CHAIN_ID === 84532 ? 'base-sepolia' : 'base',
})

export const operatorWallet = new ethers.Wallet(OPERATOR_PRIVATE_KEY, provider)

export const operatorAddress = operatorWallet.address

export const contract = new ethers.Contract(
  P2P_BETTING_ADDRESS,
  P2P_BETTING_ABI,
  operatorWallet,
)

// Read-only handle for safer/quicker calls that don't need the signer.
export const readContract = new ethers.Contract(
  P2P_BETTING_ADDRESS,
  P2P_BETTING_ABI,
  provider,
)
