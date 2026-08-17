import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'

import {
  extractParentFingerprint,
  isBip48NativeSegwitAccountXpub,
  normalizeExtendedKey
} from './bitcoinP2wsh'
import { LEGACY_MULTISIG_BIP49_ACCOUNT_PATH } from './multisigPaths'

export { isBip48NativeSegwitAccountXpub }

export interface MultisigAccountKeyInfo {
  xpub: string
  parentFingerprint: string
  rootFingerprint: string
  keyOrigin: 'bip48' | 'bip49'
}

const HARDENED = 0x80000000
const BIP48_PURPOSE = HARDENED + 48
const BIP48_COIN_TYPE = HARDENED + 0
const BIP48_ACCOUNT = HARDENED + 0
/** Native segwit script type for BIP-48 P2WSH. */
const BIP48_SCRIPT_TYPE = HARDENED + 2

export const formatFingerprint = (fingerprint: number): string =>
  fingerprint.toString(16).padStart(8, '0')

const isExtendedPrivateKey = (value: string): boolean =>
  /^[xyzXYZ]prv/i.test(value) || /^[tuv]prv/i.test(value)

const isMnemonic = (value: string): boolean => {
  const words = value.split(/\s+/).filter(word => word.length > 0)
  return words.length >= 12
}

/**
 * Pull the BIP-39 seed (or master xprv) out of Edge raw wallet keys.
 * `bitcoinKey` is the same material as Master Private Key / the BIP-49 shell.
 */
export const walletSeedFromPrivateKeys = (keys: unknown): string => {
  if (typeof keys === 'string') {
    const trimmed = keys.trim()
    if (trimmed !== '') return trimmed
  }
  if (keys != null && typeof keys === 'object') {
    const record = keys as Record<string, unknown>
    for (const field of ['bitcoinKey', 'seed', 'mnemonic']) {
      const value = record[field]
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim()
      }
    }
  }
  throw new Error('Wallet private seed is not available')
}

/** BIP-48 native-segwit account: m/48'/0'/0'/2' via deriveChild (no path string). */
export const deriveBip48AccountNode = (root: HDKey): HDKey => {
  const account = root
    .deriveChild(BIP48_PURPOSE)
    .deriveChild(BIP48_COIN_TYPE)
    .deriveChild(BIP48_ACCOUNT)
    .deriveChild(BIP48_SCRIPT_TYPE)
  if (account.depth !== 4 || account.index !== BIP48_SCRIPT_TYPE) {
    throw new Error("BIP-48 account must be m/48'/0'/0'/2' (depth 4, index 2')")
  }
  return account
}

const accountKeyInfoFromNode = (
  account: HDKey,
  root: HDKey,
  keyOrigin: 'bip48' | 'bip49'
): MultisigAccountKeyInfo => {
  const xpub = account.publicExtendedKey
  const originFingerprint =
    root.depth === 0
      ? formatFingerprint(root.fingerprint)
      : extractParentFingerprint(xpub)
  return {
    xpub,
    parentFingerprint: originFingerprint,
    rootFingerprint: formatFingerprint(root.fingerprint),
    keyOrigin
  }
}

/** Derive BIP-48 native segwit multisig account xpub from wallet private material. */
export const deriveBip48AccountFromPrivateMaterial = (
  privateMaterial: string
): MultisigAccountKeyInfo => {
  const trimmed = privateMaterial.trim()

  if (isExtendedPrivateKey(trimmed)) {
    const node = HDKey.fromExtendedKey(normalizeExtendedKey(trimmed))
    if (node.depth === 0) {
      const account = deriveBip48AccountNode(node)
      return accountKeyInfoFromNode(account, node, 'bip48')
    }
    if (node.depth === 4 && node.index === BIP48_SCRIPT_TYPE) {
      return accountKeyInfoFromNode(node, node, 'bip48')
    }
    throw new Error(
      'Extended private key is not a master seed or BIP-48 account'
    )
  }

  if (isMnemonic(trimmed)) {
    const root = HDKey.fromMasterSeed(mnemonicToSeedSync(trimmed))
    const account = deriveBip48AccountNode(root)
    return accountKeyInfoFromNode(account, root, 'bip48')
  }

  throw new Error('Cannot derive BIP-48 multisig xpub from private material')
}

/** Legacy BIP-49 account xpub (pre–BIP-48 multisig wallets). */
export const deriveLegacyBip49AccountFromPrivateMaterial = (
  privateMaterial: string
): MultisigAccountKeyInfo => {
  const trimmed = privateMaterial.trim()

  if (isExtendedPrivateKey(trimmed)) {
    const node = HDKey.fromExtendedKey(normalizeExtendedKey(trimmed))
    if (node.depth === 0) {
      const account = node.derive(LEGACY_MULTISIG_BIP49_ACCOUNT_PATH)
      return accountKeyInfoFromNode(account, node, 'bip49')
    }
    if (node.depth === 3 || node.depth === 4) {
      return accountKeyInfoFromNode(node, node, 'bip49')
    }
    throw new Error('Extended private key depth is not a BIP-32 account')
  }

  if (isMnemonic(trimmed)) {
    const root = HDKey.fromMasterSeed(mnemonicToSeedSync(trimmed))
    const account = root.derive(LEGACY_MULTISIG_BIP49_ACCOUNT_PATH)
    return accountKeyInfoFromNode(account, root, 'bip49')
  }

  throw new Error(
    'Cannot derive legacy BIP-49 multisig xpub from private material'
  )
}

export const deriveLocalMultisigAccountKey = async (
  account: {
    getDisplayPrivateKey: (walletId: string) => Promise<string>
    getRawPrivateKey: (walletId: string) => Promise<unknown>
  },
  walletId: string
): Promise<MultisigAccountKeyInfo> => {
  try {
    const raw = await account.getRawPrivateKey(walletId)
    return deriveBip48AccountFromPrivateMaterial(walletSeedFromPrivateKeys(raw))
  } catch {
    const material = await account.getDisplayPrivateKey(walletId)
    return deriveBip48AccountFromPrivateMaterial(material)
  }
}
