/**
 * Parmesan — BTC→RBTC EtherSwap.claim helpers (GUI-side orchestration).
 *
 * After Boltz reaches transaction.server.confirmed, Edge must broadcast
 * EtherSwap.claim(preimage, amount, refundAddress, timelock) from the RSK
 * claimAddress wallet. Currency engines alone cannot do this (cross-wallet).
 */

import type { EdgeCurrencyWallet } from 'edge-core-js'

const BOLTZ_API = 'https://api.boltz.exchange'
const BOLTZ_FILE_PREFIX = 'parmesan-boltz-'
const ETHER_SWAP_FALLBACK = '0xe761e1354097757c019855637746e7dd1bef1654'

export const BOLTZ_SERVER_LOCK_READY_STATES = new Set([
  'transaction.server.mempool',
  'transaction.server.confirmed'
])

export interface ParmesanSwapRecord {
  id: string
  direction: 'btc_rbtc' | 'rbtc_btc'
  status: string
  preimage?: string
  preimageHash?: string
  claimAddress?: string
  claimAmountWei?: string
  refundAddress?: string
  timelock?: number
  serverLockTxid?: string
  amount?: string | number
  created?: unknown
}

/** Selector keccak256("claim(bytes32,uint256,address,uint256)")[:4] = c3c37fbc */
export function encodeEtherSwapClaimCalldata(
  preimageHex: string,
  amountWei: string | number | bigint,
  refundAddress: string,
  timelock: number
): string {
  const preimage = preimageHex
    .replace(/^0x/, '')
    .toLowerCase()
    .padStart(64, '0')
  const amount = BigInt(amountWei).toString(16).padStart(64, '0')
  const refund = refundAddress
    .replace(/^0x/, '')
    .toLowerCase()
    .padStart(64, '0')
  const lock = BigInt(timelock).toString(16).padStart(64, '0')
  return `c3c37fbc${preimage}${amount}${refund}${lock}`
}

export async function fetchBoltzSwapStatus(
  id: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BOLTZ_API}/v2/swap/${id}`)
  if (!res.ok) throw new Error(`Boltz status HTTP ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

export async function fetchRskEtherSwapAddress(): Promise<string> {
  const res = await fetch(`${BOLTZ_API}/v2/chain/RBTC/contracts`)
  if (!res.ok) return ETHER_SWAP_FALLBACK
  const body = (await res.json()) as {
    swapContracts?: { EtherSwap?: string }
  }
  return body.swapContracts?.EtherSwap ?? ETHER_SWAP_FALLBACK
}

/**
 * Parse Lockup event params from a Rootstock Blockscout tx logs response.
 */
export async function fetchClaimParamsFromServerLockTx(
  serverLockTxid: string
): Promise<{
  claimAmountWei: string
  refundAddress: string
  timelock: number
  claimAddress: string
  preimageHash: string
}> {
  const res = await fetch(
    `https://rootstock.blockscout.com/api/v2/transactions/${serverLockTxid}/logs`
  )
  if (!res.ok) {
    throw new Error(`RSK lock tx logs HTTP ${res.status}`)
  }
  const body = (await res.json()) as {
    items?: Array<{
      decoded?: {
        method_call?: string
        parameters?: Array<{ name: string; value: string }>
      }
    }>
  }
  const items = body.items ?? []
  for (const log of items) {
    const params = log.decoded?.parameters
    if (params == null) continue
    const map: Record<string, string> = {}
    for (const p of params) map[p.name] = p.value
    if (
      map.amount != null &&
      map.refundAddress != null &&
      map.timelock != null &&
      map.claimAddress != null
    ) {
      return {
        claimAmountWei: map.amount,
        refundAddress: map.refundAddress,
        timelock: Number(map.timelock),
        claimAddress: map.claimAddress,
        preimageHash: map.preimageHash ?? ''
      }
    }
  }
  throw new Error(`No EtherSwap Lockup event in ${serverLockTxid}`)
}

export async function listParmesanSwapsOnWallet(
  wallet: EdgeCurrencyWallet
): Promise<Array<{ filename: string; record: ParmesanSwapRecord }>> {
  // Engine writes parmesan-boltz-*.json to walletLocalDisklet (= localDisklet),
  // NOT the synced repo disklet exposed as wallet.disklet.
  const disklet = wallet.localDisklet
  const listing = await disklet.list('').catch(() => ({}))
  const out: Array<{ filename: string; record: ParmesanSwapRecord }> = []
  for (const name of Object.keys(listing)) {
    if (!name.startsWith(BOLTZ_FILE_PREFIX)) continue
    try {
      const raw = await disklet.getText(name)
      out.push({
        filename: name,
        record: JSON.parse(raw) as ParmesanSwapRecord
      })
    } catch {
      // skip
    }
  }
  return out
}

export async function saveParmesanSwap(
  wallet: EdgeCurrencyWallet,
  record: ParmesanSwapRecord
): Promise<void> {
  await wallet.localDisklet.setText(
    `${BOLTZ_FILE_PREFIX}${record.id}.json`,
    JSON.stringify(record)
  )
}

function addressesEqual(a: string, b: string): boolean {
  return (
    a.replace(/^0x/, '').toLowerCase() === b.replace(/^0x/, '').toLowerCase()
  )
}

export async function findRskWalletForClaim(
  wallets: Record<string, EdgeCurrencyWallet>,
  claimAddress: string
): Promise<EdgeCurrencyWallet | undefined> {
  for (const wallet of Object.values(wallets)) {
    if (wallet.currencyInfo.pluginId !== 'rsk') continue
    try {
      const { publicAddress } = await wallet.getReceiveAddress({
        tokenId: null
      })
      if (addressesEqual(publicAddress, claimAddress)) return wallet
    } catch {
      // try next
    }
  }
  // Fallback: first RSK wallet (Myself usually uses the only one)
  return Object.values(wallets).find(w => w.currencyInfo.pluginId === 'rsk')
}

/**
 * Broadcast EtherSwap.claim from the RSK wallet. Returns the claim txid.
 */
export async function claimBoltzRbtcSwap(
  rskWallet: EdgeCurrencyWallet,
  swap: ParmesanSwapRecord
): Promise<string> {
  if (swap.preimage == null || swap.preimage === '') {
    throw new Error(`Missing preimage for swap ${swap.id}`)
  }
  let amountWei = swap.claimAmountWei
  let refundAddress = swap.refundAddress
  let timelock = swap.timelock

  if (amountWei == null || refundAddress == null || timelock == null) {
    if (swap.serverLockTxid == null) {
      throw new Error(`Missing claim params and serverLockTxid for ${swap.id}`)
    }
    const fromTx = await fetchClaimParamsFromServerLockTx(swap.serverLockTxid)
    amountWei = fromTx.claimAmountWei
    refundAddress = fromTx.refundAddress
    timelock = fromTx.timelock
  }

  const etherSwap = await fetchRskEtherSwapAddress()
  const data = encodeEtherSwapClaimCalldata(
    swap.preimage,
    amountWei,
    refundAddress,
    timelock
  )

  const edgeTx = await rskWallet.makeSpend({
    tokenId: null,
    spendTargets: [
      {
        publicAddress: etherSwap,
        nativeAmount: '0'
      }
    ],
    memos: [{ type: 'hex', value: data }],
    metadata: {
      notes: `Boltz claim BTC→RBTC swap ID: ${swap.id}`
    }
  })
  const signed = await rskWallet.signTx(edgeTx)
  const broadcast = await rskWallet.broadcastTx(signed)
  await rskWallet.saveTx(broadcast)
  return broadcast.txid
}
