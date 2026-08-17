import { base64, hex } from '@scure/base'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import * as btc from '@scure/btc-signer'
import { pubECDSA } from '@scure/btc-signer/utils.js'
import type { EdgeCurrencyConfig, EdgeCurrencyWallet } from 'edge-core-js'

import {
  deriveBitcoinMultisigOnChain,
  deriveCosignerPubkeyAtIndex,
  normalizeExtendedKey,
  sortPubkeysBip67
} from './bitcoinP2wsh'
import { deriveBip48AccountNode } from './multisigKeys'
import { LEGACY_MULTISIG_BIP49_ACCOUNT_PATH } from './multisigPaths'
import { parsePsbtV0, serializePsbtV0 } from './psbtManual'
import type { MultisigProposal } from './types'

export interface BlockbookUtxo {
  txid: string
  vout: number
  value: string
  confirmations?: number
  height?: number
  /** Receive branch index (change=0) this UTXO belongs to. */
  addressIndex?: number
}

export interface MultisigSpendQuote {
  amountNative: string
  feeNative: string
  destAddress: string
  changeAddress: string
  utxos: BlockbookUtxo[]
  totalInputNative: string
  psbtBase64: string
}

const DEFAULT_BLOCKBOOK = [
  'https://btc-wusa1.edge.app',
  'https://btc-eu1.edge.app'
]

const DEFAULT_FEE_SAT_PER_VB = 3n
const DUST_SATS = 546n

const bytesToHex = (bytes: Uint8Array): string => hex.encode(bytes)
const hexToBytes = (h: string): Uint8Array => hex.decode(h)
const psbtBytesToBase64 = (psbt: Uint8Array): string => base64.encode(psbt)
const psbtBase64ToBytes = (s: string): Uint8Array => base64.decode(s)

export const getBlockbookBases = (
  wallet?: EdgeCurrencyWallet,
  currencyConfig?: EdgeCurrencyConfig
): string[] => {
  const fromWallet = (
    wallet?.currencyInfo as {
      defaultSettings?: { otherSettings?: { blockbookServers?: string[] } }
    }
  )?.defaultSettings?.otherSettings?.blockbookServers
  const fromConfig = (
    currencyConfig?.currencyInfo as {
      defaultSettings?: { otherSettings?: { blockbookServers?: string[] } }
    }
  )?.defaultSettings?.otherSettings?.blockbookServers
  const list = [
    ...(fromWallet ?? []),
    ...(fromConfig ?? []),
    ...DEFAULT_BLOCKBOOK
  ]
  const https = list
    .map(url =>
      url
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://')
        .replace(/\/$/, '')
    )
    .filter(url => url.startsWith('http'))
  return [...new Set(https)]
}

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Blockbook HTTP ${response.status}`)
  }
  return await response.json()
}

export const fetchP2wshUtxos = async (
  address: string,
  bases: string[] = DEFAULT_BLOCKBOOK
): Promise<BlockbookUtxo[]> => {
  let lastError: unknown
  for (const base of bases) {
    try {
      const raw = await fetchJson(`${base}/api/v2/utxo/${address}`)
      if (!Array.isArray(raw)) continue
      return raw.map((item: any) => ({
        txid: String(item.txid),
        vout: Number(item.vout),
        value: String(item.value),
        confirmations:
          item.confirmations != null ? Number(item.confirmations) : undefined,
        height: item.height != null ? Number(item.height) : undefined
      }))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Could not fetch P2WSH UTXOs')
}

export const fetchP2wshBalanceSats = async (
  address: string,
  bases?: string[]
): Promise<bigint> => {
  const utxos = await fetchP2wshUtxos(address, bases)
  return utxos.reduce((sum, u) => sum + BigInt(u.value), 0n)
}

/**
 * Blockbook `estimatefee/N` returns BTC per kilobyte. Convert to sat/vB
 * (minimum 1). Falls back to a modest default when Blockbook is unreachable.
 */
export const fetchFeeSatPerVb = async (
  bases: string[] = DEFAULT_BLOCKBOOK
): Promise<bigint> => {
  for (const base of bases) {
    try {
      const raw = (await fetchJson(`${base}/api/v2/estimatefee/2`)) as {
        result?: string | number
      }
      const btcPerKb = Number(raw.result)
      if (!Number.isFinite(btcPerKb) || btcPerKb <= 0) continue
      const satPerVb = Math.ceil((btcPerKb * 1e8) / 1000)
      return BigInt(Math.max(1, satPerVb))
    } catch {}
  }
  return DEFAULT_FEE_SAT_PER_VB
}

export interface BlockbookAddressInfo {
  address: string
  balanceSats: string
  totalReceivedSats: string
  totalSentSats: string
  txCount: number
}

const asSatsString = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  return '0'
}

/** Blockbook address summary (balance + tx count). */
export const fetchBlockbookAddressInfo = async (
  address: string,
  bases: string[] = DEFAULT_BLOCKBOOK
): Promise<BlockbookAddressInfo> => {
  let lastError: unknown
  for (const base of bases) {
    try {
      const raw = (await fetchJson(
        `${base}/api/v2/address/${address}?details=basic`
      )) as Record<string, unknown>
      return {
        address,
        balanceSats: asSatsString(raw.balance),
        totalReceivedSats: asSatsString(raw.totalReceived),
        totalSentSats: asSatsString(raw.totalSent),
        txCount: Number(raw.txs ?? 0)
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Could not fetch Blockbook address info')
}

export const broadcastRawTx = async (
  txHex: string,
  bases: string[] = DEFAULT_BLOCKBOOK
): Promise<string> => {
  let lastError: unknown
  for (const base of bases) {
    try {
      const response = await fetch(`${base}/api/v2/sendtx/`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: txHex
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(text !== '' ? text : `sendtx HTTP ${response.status}`)
      }
      // Blockbook returns txid as plain text or JSON
      try {
        const parsed = JSON.parse(text)
        if (typeof parsed === 'string') return parsed
        if (parsed?.result != null) return String(parsed.result)
      } catch {}
      return text.trim().replace(/^"|"$/g, '')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Could not broadcast transaction')
}

const estimateVsize = (
  inputCount: number,
  outputCount: number,
  requiredSignatures: number = 2
): bigint => {
  // Approximate P2WSH m-of-n input vsize (witness + non-witness).
  const perInput = 50n + BigInt(requiredSignatures) * 27n + 30n
  return BigInt(inputCount) * perInput + BigInt(outputCount) * 43n + 10n
}

const buildPayment = (
  proposal: MultisigProposal,
  change: number,
  addressIndex: number
): ReturnType<typeof btc.p2wsh> => {
  const xpubs = [
    ...new Set(
      proposal.cosigners
        .map(c => c.xpub)
        .filter((x): x is string => x != null && x !== '')
        .map(x => x.trim())
    )
  ]
  // Must BIP67-sort: unsorted p2ms derives a different address than
  // deriveBitcoinMultisigOnChain (watch / Request), so UTXO lookup fails.
  const pubkeys = sortPubkeysBip67(
    xpubs.map(xpub => deriveCosignerPubkeyAtIndex(xpub, change, addressIndex))
  )
  return btc.p2wsh(btc.p2ms(proposal.requiredSignatures, pubkeys))
}

export const getChangeAddress = (proposal: MultisigProposal): string => {
  const onChain = deriveBitcoinMultisigOnChain({
    xpubs: proposal.cosigners
      .map(c => c.xpub)
      .filter((x): x is string => x != null && x !== ''),
    requiredSignatures: proposal.requiredSignatures,
    change: 1,
    addressIndex: 0
  })
  return onChain.p2wshAddress
}

export const buildMultisigSpendQuote = async (opts: {
  proposal: MultisigProposal
  destAddress: string
  amountNative: string
  feeSatPerVb?: bigint
  bases?: string[]
  /** Inclusive max receive index to scan for UTXOs (default 0). */
  maxReceiveIndex?: number
}): Promise<MultisigSpendQuote> => {
  const { proposal, destAddress, amountNative } = opts
  const bases = opts.bases ?? DEFAULT_BLOCKBOOK
  const maxReceiveIndex = opts.maxReceiveIndex ?? 0
  const m = proposal.requiredSignatures

  // Collect UTXOs across used receive indices (HD).
  const utxos: BlockbookUtxo[] = []
  for (let index = 0; index <= maxReceiveIndex; index++) {
    const payment = buildPayment(proposal, 0, index)
    if (payment.address == null) continue
    try {
      const found = await fetchP2wshUtxos(payment.address, bases)
      for (const u of found) utxos.push({ ...u, addressIndex: index })
    } catch {}
  }
  if (utxos.length === 0) {
    throw new Error('No funds on multisig P2WSH address')
  }

  const amount = BigInt(amountNative)
  if (amount <= 0n) throw new Error('Amount must be positive')

  const changePayment = buildPayment(proposal, 1, 0)
  const changeAddress = changePayment.address
  if (changeAddress == null) {
    throw new Error('Failed to derive multisig change address')
  }

  const feeRate = opts.feeSatPerVb ?? (await fetchFeeSatPerVb(bases))
  const sorted = [...utxos].sort((a, b) =>
    BigInt(b.value) > BigInt(a.value) ? 1 : -1
  )
  const selected: BlockbookUtxo[] = []
  let totalIn = 0n
  for (const utxo of sorted) {
    selected.push(utxo)
    totalIn += BigInt(utxo.value)
    const feeWithChange = estimateVsize(selected.length, 2, m) * feeRate
    const feeNoChange = estimateVsize(selected.length, 1, m) * feeRate
    if (
      totalIn >= amount + feeWithChange ||
      (totalIn >= amount + feeNoChange &&
        totalIn - amount - feeNoChange < DUST_SATS)
    ) {
      break
    }
  }

  let fee = estimateVsize(selected.length, 2, m) * feeRate
  let change = totalIn - amount - fee
  const useChange = change >= DUST_SATS
  if (!useChange) {
    fee = estimateVsize(selected.length, 1, m) * feeRate
    if (totalIn < amount + fee) {
      throw new Error('Insufficient P2WSH funds for amount + fee')
    }
    // Fold leftover below dust into the fee (standard Bitcoin wallet behavior).
    fee = totalIn - amount
    change = 0n
  } else if (totalIn < amount + fee) {
    throw new Error('Insufficient P2WSH funds for amount + fee')
  }

  const tx = new btc.Transaction()
  for (const utxo of selected) {
    const index = utxo.addressIndex ?? 0
    const payment = buildPayment(proposal, 0, index)
    tx.addInput({
      txid: hexToBytes(utxo.txid),
      index: utxo.vout,
      witnessUtxo: {
        script: payment.script,
        amount: BigInt(utxo.value)
      },
      witnessScript: payment.witnessScript,
      sighashType: btc.SigHash.ALL
    })
  }
  tx.addOutputAddress(destAddress.trim(), amount, btc.NETWORK)
  if (useChange) {
    tx.addOutputAddress(changeAddress, change, btc.NETWORK)
  }

  // Manual PSBT v0 — Hermes cannot run scure toPSBT (Writer/magic/TextEncoder).
  const psbtBase64 = psbtBytesToBase64(serializePsbtV0(tx))
  return {
    amountNative: amount.toString(),
    feeNative: fee.toString(),
    destAddress: destAddress.trim(),
    changeAddress,
    utxos: selected,
    totalInputNative: totalIn.toString(),
    psbtBase64
  }
}

/** Max sendable sats after a 1-output fee for all current P2WSH UTXOs. */
export const getMaxP2wshSpendable = async (opts: {
  proposal: MultisigProposal
  bases?: string[]
  maxReceiveIndex?: number
  feeSatPerVb?: bigint
}): Promise<bigint> => {
  const bases = opts.bases ?? DEFAULT_BLOCKBOOK
  const maxReceiveIndex = opts.maxReceiveIndex ?? 0
  const m = opts.proposal.requiredSignatures
  const utxos: BlockbookUtxo[] = []
  for (let index = 0; index <= maxReceiveIndex; index++) {
    const payment = buildPayment(opts.proposal, 0, index)
    if (payment.address == null) continue
    try {
      const found = await fetchP2wshUtxos(payment.address, bases)
      for (const u of found) utxos.push(u)
    } catch {}
  }
  if (utxos.length === 0) return 0n
  let totalIn = 0n
  for (const u of utxos) totalIn += BigInt(u.value)
  const feeRate = opts.feeSatPerVb ?? (await fetchFeeSatPerVb(bases))
  const fee = estimateVsize(utxos.length, 1, m) * feeRate
  const max = totalIn - fee
  return max > 0n ? max : 0n
}

export const psbtFromBase64 = (psbtBase64: string): btc.Transaction =>
  parsePsbtV0(psbtBase64ToBytes(psbtBase64))

export const psbtToBase64 = (tx: btc.Transaction): string =>
  psbtBytesToBase64(serializePsbtV0(tx))
/** Count unique pubkeys that have signed every input. */
export const countPsbtSignatures = (psbtBase64: string): number => {
  const tx = psbtFromBase64(psbtBase64)
  if (tx.inputsLength === 0) return 0
  const perInput: Array<Set<string>> = []
  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i)
    const set = new Set<string>()
    for (const [pubkey] of input.partialSig ?? []) {
      set.add(bytesToHex(pubkey))
    }
    perInput.push(set)
  }
  const first = perInput[0]
  let count = 0
  for (const pk of first) {
    if (perInput.every(set => set.has(pk))) count++
  }
  return count
}

export const deriveCosignerPrivkey = (
  privateMaterial: string,
  change: number,
  addressIndex: number,
  legacyBip49: boolean = false
): Uint8Array => {
  const trimmed = privateMaterial.trim()

  // Extended private key (xprv / yprv / zprv / …)
  if (/^[xyzXYZ]prv/i.test(trimmed) || /^[tuv]prv/i.test(trimmed)) {
    const node = HDKey.fromExtendedKey(normalizeExtendedKey(trimmed))
    const account =
      node.depth === 0
        ? legacyBip49
          ? node.derive(LEGACY_MULTISIG_BIP49_ACCOUNT_PATH)
          : deriveBip48AccountNode(node)
        : node
    const child = account.deriveChild(change).deriveChild(addressIndex)
    if (child.privateKey == null) {
      throw new Error('Extended key has no private key')
    }
    return child.privateKey
  }

  // Hex secp256k1 key
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
    return hexToBytes(trimmed.replace(/^0x/, ''))
  }

  // Mnemonic → BIP-48 (or legacy BIP-49) account, then change/index
  const words = trimmed.split(/\s+/).filter(w => w.length > 0)
  if (words.length >= 12) {
    const seed = mnemonicToSeedSync(trimmed)
    const root = HDKey.fromMasterSeed(seed)
    const account = legacyBip49
      ? root.derive(LEGACY_MULTISIG_BIP49_ACCOUNT_PATH)
      : deriveBip48AccountNode(root)
    const child = account.deriveChild(change).deriveChild(addressIndex)
    if (child.privateKey == null) {
      throw new Error('Failed to derive multisig private key')
    }
    return child.privateKey
  }

  throw new Error('Unsupported private key format for multisig signing')
}

export const partialSignPsbt = (
  psbtBase64: string,
  privateMaterial: string,
  change: number = 0,
  addressIndex: number = 0,
  maxReceiveIndex: number = 0,
  legacyBip49: boolean = false
): string => {
  const tx = psbtFromBase64(psbtBase64)
  const maxIndex = Math.max(addressIndex, maxReceiveIndex)
  for (let i = 0; i <= maxIndex; i++) {
    try {
      tx.sign(deriveCosignerPrivkey(privateMaterial, 0, i, legacyBip49))
    } catch {}
  }
  try {
    tx.sign(deriveCosignerPrivkey(privateMaterial, 1, 0, legacyBip49))
  } catch {}
  // Keep legacy single-index path when maxReceiveIndex is 0
  if (change !== 0) {
    try {
      tx.sign(
        deriveCosignerPrivkey(
          privateMaterial,
          change,
          addressIndex,
          legacyBip49
        )
      )
    } catch {}
  }
  return psbtToBase64(tx)
}

export const finalizeAndExtractTx = (
  psbtBase64: string
): { txHex: string; txid: string } => {
  const tx = psbtFromBase64(psbtBase64)
  tx.finalize()
  return { txHex: tx.hex, txid: tx.id }
}

export const pubkeyHexFromPriv = (priv: Uint8Array): string =>
  bytesToHex(pubECDSA(priv))
