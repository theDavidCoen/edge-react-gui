import type { EdgeCurrencyWallet, EdgeTransaction } from 'edge-core-js'
import { makeEvent } from 'yavent'

import { deriveBitcoinMultisigOnChain } from './bitcoinP2wsh'
import {
  fetchBlockbookAddressInfo,
  fetchP2wshUtxos,
  getBlockbookBases
} from './spendPsbt'
import type { MultisigProposal } from './types'

export const RECEIVE_GAP_LIMIT = 20

export interface P2wshWatchSnapshot {
  walletId: string
  balanceSats: string
  receiveIndex: number
  receiveAddress: string
  /** Receive indices that have UTXOs or history (inclusive). */
  maxUsedReceiveIndex: number
  transactions: EdgeTransaction[]
  updatedAt: number
}

const cache = new Map<string, P2wshWatchSnapshot>()
const inflight = new Map<string, Promise<P2wshWatchSnapshot | null>>()
const [watchP2wsh, emitP2wsh] = makeEvent<{
  walletId: string
  snapshot: P2wshWatchSnapshot | null
}>()
/** New receive txs since the previous watch snapshot (not on first fetch). */
const [watchP2wshIncoming, emitP2wshIncoming] = makeEvent<{
  walletId: string
  transactions: EdgeTransaction[]
}>()

export { watchP2wsh, watchP2wshIncoming }

export const getCachedP2wshWatch = (
  walletId: string
): P2wshWatchSnapshot | undefined => cache.get(walletId)

export const getCachedMultisigReceiveAddress = (
  walletId: string
): string | undefined => cache.get(walletId)?.receiveAddress

const xpubsOf = (proposal: MultisigProposal): string[] =>
  proposal.cosigners
    .map(c => c.xpub)
    .filter((x): x is string => x != null && x !== '')

export const deriveReceiveAddressAt = (
  proposal: MultisigProposal,
  addressIndex: number
): string =>
  deriveBitcoinMultisigOnChain({
    xpubs: xpubsOf(proposal),
    requiredSignatures: proposal.requiredSignatures,
    change: 0,
    addressIndex
  }).p2wshAddress

const isAddressUsed = async (
  address: string,
  bases: string[]
): Promise<boolean> => {
  try {
    const info = await fetchBlockbookAddressInfo(address, bases)
    return (
      info.txCount > 0 ||
      BigInt(info.balanceSats) > 0n ||
      BigInt(info.totalReceivedSats) > 0n
    )
  } catch {
    return false
  }
}

/** Next unused receive index after the highest used (gap-limited scan). */
export const findFreshReceiveIndex = async (
  proposal: MultisigProposal,
  bases: string[],
  knownMaxUsed: number = -1
): Promise<{ index: number; address: string; maxUsed: number }> => {
  let lastUsed = knownMaxUsed
  const start = Math.max(0, knownMaxUsed)
  const firstPassEnd = Math.max(RECEIVE_GAP_LIMIT, start + RECEIVE_GAP_LIMIT)

  const checkRange = async (from: number, to: number): Promise<void> => {
    const checks = await Promise.all(
      Array.from({ length: Math.max(0, to - from + 1) }, async (_, offset) => {
        const i = from + offset
        const address = deriveReceiveAddressAt(proposal, i)
        return (await isAddressUsed(address, bases)) ? i : -1
      })
    )
    for (const i of checks) {
      if (i > lastUsed) lastUsed = i
    }
  }

  await checkRange(0, firstPassEnd - 1)
  // Extend a full gap past last used if activity was found near the edge
  if (lastUsed >= firstPassEnd - RECEIVE_GAP_LIMIT) {
    await checkRange(firstPassEnd, lastUsed + RECEIVE_GAP_LIMIT)
  }

  const index = lastUsed + 1
  return {
    index,
    address: deriveReceiveAddressAt(proposal, index),
    maxUsed: lastUsed
  }
}

interface BlockbookTxVin {
  addresses?: string[]
  value?: string
}
interface BlockbookTxVout {
  addresses?: string[]
  value?: string
}
interface BlockbookTx {
  txid: string
  blockHeight?: number
  blockTime?: number
  fees?: string
  vin?: BlockbookTxVin[]
  vout?: BlockbookTxVout[]
}

const fetchAddressTxs = async (
  address: string,
  bases: string[]
): Promise<BlockbookTx[]> => {
  for (const base of bases) {
    try {
      const response = await fetch(
        `${base}/api/v2/address/${address}?details=txs&pageSize=50`
      )
      if (!response.ok) continue
      const raw = (await response.json()) as { transactions?: BlockbookTx[] }
      return raw.transactions ?? []
    } catch {}
  }
  return []
}

const toEdgeTx = (
  walletId: string,
  ourAddresses: Set<string>,
  tx: BlockbookTx
): EdgeTransaction => {
  let received = 0n
  let sent = 0n
  for (const vin of tx.vin ?? []) {
    for (const addr of vin.addresses ?? []) {
      if (ourAddresses.has(addr)) sent += BigInt(vin.value ?? '0')
    }
  }
  for (const vout of tx.vout ?? []) {
    for (const addr of vout.addresses ?? []) {
      if (ourAddresses.has(addr)) received += BigInt(vout.value ?? '0')
    }
  }
  const net = received - sent
  const ourReceiveAddresses = [...ourAddresses].filter(addr =>
    (tx.vout ?? []).some(o => (o.addresses ?? []).includes(addr))
  )
  // Core list UI treats missing confirmations as "Syncing...".
  const confirmations: EdgeTransaction['confirmations'] =
    tx.blockHeight != null && tx.blockHeight > 0 ? 'confirmed' : 'unconfirmed'
  const edgeTx: EdgeTransaction = {
    txid: tx.txid,
    date: tx.blockTime ?? Math.floor(Date.now() / 1000),
    currencyCode: 'BTC',
    blockHeight: tx.blockHeight ?? 0,
    nativeAmount: net.toString(),
    networkFee: String(tx.fees ?? '0'),
    networkFees: [],
    ourReceiveAddresses,
    signedTx: '',
    isSend: net < 0n,
    memos: [],
    tokenId: null,
    walletId,
    metadata: {},
    spendTargets: [],
    confirmations
  }
  return edgeTx
}

/**
 * Refresh P2WSH balance, fresh receive address, and tx history from Blockbook.
 */
export const refreshP2wshWatch = async (
  walletId: string,
  proposal: MultisigProposal,
  wallet?: EdgeCurrencyWallet
): Promise<P2wshWatchSnapshot | null> => {
  const existing = inflight.get(walletId)
  if (existing != null) return await existing

  const run = async (): Promise<P2wshWatchSnapshot | null> => {
    if (proposal.status !== 'complete') {
      cache.delete(walletId)
      emitP2wsh({ walletId, snapshot: null })
      return null
    }
    const bases = getBlockbookBases(wallet)
    const prior = cache.get(walletId)
    const fresh = await findFreshReceiveIndex(
      proposal,
      bases,
      prior?.maxUsedReceiveIndex ?? -1
    )
    const maxUsed = fresh.maxUsed

    const indices: number[] = []
    for (let i = 0; i <= Math.max(maxUsed, 0); i++) indices.push(i)
    if (!indices.includes(fresh.index)) indices.push(fresh.index)

    const ourAddresses = new Set<string>()
    for (const index of indices) {
      ourAddresses.add(deriveReceiveAddressAt(proposal, index))
    }
    // Always include change m/1/0 for spend detection in history
    try {
      ourAddresses.add(
        deriveBitcoinMultisigOnChain({
          xpubs: xpubsOf(proposal),
          requiredSignatures: proposal.requiredSignatures,
          change: 1,
          addressIndex: 0
        }).p2wshAddress
      )
    } catch {}

    // Parallel UTXO + tx fetch for all watched receive indices
    const perIndex = await Promise.all(
      indices.map(async index => {
        const address = deriveReceiveAddressAt(proposal, index)
        const [utxos, txs] = await Promise.all([
          fetchP2wshUtxos(address, bases).catch(() => []),
          fetchAddressTxs(address, bases).catch(() => [])
        ])
        return { utxos, txs }
      })
    )

    let balance = 0n
    const rawByTxid = new Map<string, BlockbookTx>()
    for (const { utxos, txs } of perIndex) {
      for (const u of utxos) balance += BigInt(u.value)
      for (const tx of txs) rawByTxid.set(tx.txid, tx)
    }

    const transactions = [...rawByTxid.values()]
      .map(tx => toEdgeTx(walletId, ourAddresses, tx))
      .sort((a, b) => b.date - a.date)

    // Notify only for receives that appear after we already had a snapshot
    // (skip cold start / first hydrate so history does not spam).
    if (prior != null) {
      const priorTxids = new Set(prior.transactions.map(tx => tx.txid))
      const newReceives = transactions.filter(
        tx =>
          !priorTxids.has(tx.txid) && !tx.isSend && BigInt(tx.nativeAmount) > 0n
      )
      if (newReceives.length > 0) {
        emitP2wshIncoming({ walletId, transactions: newReceives })
      }
    }

    const snapshot: P2wshWatchSnapshot = {
      walletId,
      balanceSats: balance.toString(),
      receiveIndex: fresh.index,
      receiveAddress: fresh.address,
      maxUsedReceiveIndex: maxUsed,
      transactions,
      updatedAt: Date.now()
    }
    cache.set(walletId, snapshot)
    emitP2wsh({ walletId, snapshot })
    return snapshot
  }

  const promise = run().finally(() => {
    inflight.delete(walletId)
  })
  inflight.set(walletId, promise)
  return await promise
}
