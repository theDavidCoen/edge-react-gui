import { sha256 } from '@noble/hashes/sha256'
import { base58check, hex } from '@scure/base'
import { HDKey } from '@scure/bip32'
import { bech32 } from 'bech32'

import {
  addDescriptorChecksum,
  stripDescriptorChecksum
} from './descriptorChecksum'
import { MULTISIG_DESCRIPTOR_ORIGIN_PATH } from './multisigPaths'

const OP_CHECKMULTISIG = 0xae
const b58check = base58check(sha256)

/** BIP32 mainnet xpub / xprv version bytes (@scure/bip32 only accepts these). */
const XPUB_VERSION = hex.decode('0488b21e')
const XPRV_VERSION = hex.decode('0488ade4')

/**
 * SLIP-132 public / private version bytes that Edge and Electrum may return
 * (ypub bip49, zpub bip84, etc.). Without normalizing, HDKey.fromExtendedKey
 * throws "Version mismatch" and P2WSH derivation silently fails.
 */
const EXTENDED_PUBLIC_VERSIONS = new Set([
  '0488b21e', // xpub
  '049d7cb2', // ypub
  '04b24746', // zpub
  '0295b43f', // Ypub
  '02aa7ed3', // Zpub
  '043587cf', // tpub
  '044a5262', // upub
  '045f1cf6' // vpub
])
const EXTENDED_PRIVATE_VERSIONS = new Set([
  '0488ade4', // xprv
  '049d7878', // yprv
  '04b2430c', // zprv
  '0295b005', // Yprv
  '02aa7a99', // Zprv
  '04358394', // tprv
  '044a4e28', // uprv
  '045f18bc' // vprv
])

/**
 * Edge `getDisplayPublicKey` joins every script-type xpub with newlines
 * (`Object.values(publicKeys).join('\\n')`). Split and pick one account key.
 * Prefer ypub (bip49) — the default Edge Bitcoin wallet used for multisig.
 */
export const pickEdgeAccountXpub = (raw: string): string => {
  const tokens = raw
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(token => token.length > 0)
    .filter(token =>
      /^(xpub|ypub|zpub|Ypub|Zpub|tpub|upub|vpub)[1-9A-HJ-NP-Za-km-z]+$/.test(
        token
      )
    )
  if (tokens.length === 0) {
    throw new Error('No extended public key found')
  }
  const prefer = (prefixes: string[]): string | undefined =>
    tokens.find(token => prefixes.some(prefix => token.startsWith(prefix)))
  return (
    prefer(['ypub', 'upub']) ??
    prefer(['zpub', 'vpub']) ??
    prefer(['xpub', 'tpub', 'Ypub', 'Zpub']) ??
    tokens[0]
  )
}

const pickSingleExtendedKey = (raw: string): string => {
  const tokens = raw
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(token => token.length > 0)
  const pub = tokens.filter(token =>
    /^(xpub|ypub|zpub|Ypub|Zpub|tpub|upub|vpub)/.test(token)
  )
  if (pub.length > 0) return pickEdgeAccountXpub(raw)
  const priv = tokens.find(token =>
    /^(xprv|yprv|zprv|Yprv|Zprv|tprv|uprv|vprv)/.test(token)
  )
  if (priv != null) return priv
  if (tokens.length === 1) return tokens[0]
  throw new Error('No extended key found')
}

/**
 * Rewrite SLIP-132 version bytes to canonical BIP32 xpub/xprv so @scure/bip32
 * can parse keys returned by Edge `getDisplayPublicKey` (often ypub).
 */
export const normalizeExtendedKey = (extendedKey: string): string => {
  const trimmed = pickSingleExtendedKey(extendedKey)
  const data = b58check.decode(trimmed)
  if (data.length < 78) {
    throw new Error('Invalid extended key length')
  }
  const versionHex = hex.encode(data.slice(0, 4))
  const isPrivate = EXTENDED_PRIVATE_VERSIONS.has(versionHex)
  const isPublic = EXTENDED_PUBLIC_VERSIONS.has(versionHex)
  if (!isPrivate && !isPublic) {
    throw new Error(`Unknown extended key version: ${versionHex}`)
  }
  const target = isPrivate ? XPRV_VERSION : XPUB_VERSION
  if (
    data[0] === target[0] &&
    data[1] === target[1] &&
    data[2] === target[2] &&
    data[3] === target[3]
  ) {
    return trimmed
  }
  const rewritten = new Uint8Array(data)
  rewritten.set(target, 0)
  return b58check.encode(rewritten)
}

const encodeOpN = (n: number): number => {
  if (n >= 1 && n <= 16) return 0x50 + n
  throw new Error(`Unsupported multisig threshold: ${n}`)
}

const pushData = (data: Uint8Array): Uint8Array => {
  if (data.length > 75) {
    throw new Error('Push data too large')
  }
  const out = new Uint8Array(1 + data.length)
  out[0] = data.length
  out.set(data, 1)
  return out
}

/** BIP67 lexicographic pubkey sort (required for deterministic P2WSH). */
export const sortPubkeysBip67 = (pubkeys: Uint8Array[]): Uint8Array[] =>
  [...pubkeys].sort((a, b) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] - b[i]
    }
    return 0
  })

/** BIP67-sorted P2WSH witness script for m-of-n multisig. */
export const buildP2wshWitnessScript = (
  requiredSignatures: number,
  pubkeys: Uint8Array[]
): Uint8Array => {
  const sorted = sortPubkeysBip67(pubkeys)

  const chunks: Uint8Array[] = [
    new Uint8Array([encodeOpN(requiredSignatures)]),
    ...sorted.map(pk => pushData(pk)),
    new Uint8Array([encodeOpN(sorted.length), OP_CHECKMULTISIG])
  ]

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0)
  const script = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunks) {
    script.set(chunk, offset)
    offset += chunk.length
  }
  return script
}

export const witnessScriptToP2wshAddress = (
  witnessScript: Uint8Array
): string => {
  const scriptHash = sha256(witnessScript)
  const words = bech32.toWords(scriptHash)
  return bech32.encode('bc', [0, ...words], 1000)
}

export const deriveCosignerPubkeyAtIndex = (
  xpub: string,
  change: number,
  index: number
): Uint8Array => {
  const node = HDKey.fromExtendedKey(normalizeExtendedKey(xpub))
  const child = node.deriveChild(change).deriveChild(index)
  const publicKey = child.publicKey
  if (publicKey == null) {
    throw new Error('Failed to derive cosigner pubkey')
  }
  return publicKey
}

export interface BitcoinMultisigOnChain {
  witnessScriptHex: string
  p2wshAddress: string
  xpubs: string[]
}

/** Derive native segwit (P2WSH) multisig receive address at m/0/0. */
export const deriveBitcoinMultisigOnChain = (opts: {
  xpubs: string[]
  requiredSignatures: number
  change?: number
  addressIndex?: number
}): BitcoinMultisigOnChain => {
  const { xpubs, requiredSignatures, change = 0, addressIndex = 0 } = opts
  const uniqueXpubs = [
    ...new Set(xpubs.map(x => x.trim()).filter(x => x !== ''))
  ]
  if (uniqueXpubs.length < 2) {
    throw new Error('Multisig requires at least two xpubs')
  }
  if (requiredSignatures < 1 || requiredSignatures > uniqueXpubs.length) {
    throw new Error('Invalid multisig threshold')
  }

  const pubkeys = uniqueXpubs.map(xpub =>
    deriveCosignerPubkeyAtIndex(xpub, change, addressIndex)
  )
  const witnessScript = buildP2wshWitnessScript(requiredSignatures, pubkeys)

  return {
    witnessScriptHex: Buffer.from(witnessScript).toString('hex'),
    p2wshAddress: witnessScriptToP2wshAddress(witnessScript),
    xpubs: uniqueXpubs
  }
}

export const extractParentFingerprint = (extendedKey: string): string => {
  const data = b58check.decode(normalizeExtendedKey(extendedKey))
  if (data.length < 9) throw new Error('Invalid extended key')
  return hex.encode(data.slice(5, 9))
}

/** BIP-32 header fields encoded in the xpub itself (not the descriptor origin). */
export interface ExtendedKeyBip32Header {
  depth: number
  childIndex: number
}

/** Native-segwit script type 2' at BIP-48 account depth. */
export const BIP48_NATIVE_SEGWIT_CHILD_INDEX = 0x80000002

/**
 * Read depth and child index from the serialized extended key.
 * Descriptor origin `[fp/48'/0'/0'/2']` cannot change these bytes.
 */
export const readExtendedKeyBip32 = (
  extendedKey: string
): ExtendedKeyBip32Header => {
  const data = b58check.decode(normalizeExtendedKey(extendedKey))
  if (data.length < 13) throw new Error('Invalid extended key')
  const childIndex =
    ((data[9] << 24) | (data[10] << 16) | (data[11] << 8) | data[12]) >>> 0
  return { depth: data[4], childIndex }
}

/** True only if the xpub node is m/…/48'/0'/0'/2' (depth 4, index 2'). */
export const isBip48NativeSegwitAccountXpub = (
  extendedKey: string
): boolean => {
  try {
    const { depth, childIndex } = readExtendedKeyBip32(extendedKey)
    return depth === 4 && childIndex === BIP48_NATIVE_SEGWIT_CHILD_INDEX
  } catch {
    return false
  }
}

export const getCosignerAccountIdentity = (xpub: string): string => {
  const node = HDKey.fromExtendedKey(normalizeExtendedKey(xpub))
  if (node.publicKey == null || node.chainCode == null) {
    throw new Error('Invalid cosigner xpub')
  }
  return `${hex.encode(node.chainCode)}:${hex.encode(node.publicKey)}`
}

/** Reject duplicate account keys and cosigners that share the same physical seed. */
export const validateCosignerXpubs = (xpubs: string[]): string[] => {
  const identities = new Map<string, string>()
  const unique: string[] = []
  for (const raw of xpubs) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const normalized = normalizeExtendedKey(trimmed)
    const identity = getCosignerAccountIdentity(normalized)
    if (identities.has(identity)) {
      throw new Error('Cosigner extended keys must represent distinct accounts')
    }
    identities.set(identity, normalized)
    unique.push(normalized)
  }
  if (unique.length < 2) {
    throw new Error('Multisig requires at least two distinct cosigner xpubs')
  }
  return unique
}

export interface CosignerDescriptorInput {
  xpub: string
  fingerprint?: string
}

export interface ParsedMultisigDescriptor {
  requiredSignatures: number
  cosignerKeys: Array<{
    fingerprint: string
    originPath: string
    xpub: string
    multipath?: string
  }>
}

const DESCRIPTOR_KEY_RE =
  /\[([0-9a-fA-F]{8})\/([^\]]+)\](xpub[1-9A-HJ-NP-Za-km-z]+)(?:\/(<0;1>|\d+)\/\*)?/g

/**
 * BIP-380 / BIP-389 output descriptor for native segwit P2WSH sorted multisig.
 * Example: wsh(sortedmulti(2,[fp/48'/0'/0'/2']xpub…/<0;1>/*,…))
 */
export const buildMultisigDescriptor = (
  requiredSignatures: number,
  cosigners: CosignerDescriptorInput[],
  multipath: boolean = true
): string => {
  const xpubs = cosigners.map(item => item.xpub)
  const validated = validateCosignerXpubs(xpubs)
  const suffix = multipath ? '/<0;1>/*' : '/0/*'
  const parts = validated.map(xpub => {
    if (!isBip48NativeSegwitAccountXpub(xpub)) {
      throw new Error(
        "Cosigner xpub is not BIP-48 m/48'/0'/0'/2' (depth 4, index 2')"
      )
    }
    const override = cosigners.find(
      item => normalizeExtendedKey(item.xpub.trim()) === xpub
    )?.fingerprint
    const fingerprint = override ?? extractParentFingerprint(xpub)
    return `[${fingerprint}/${MULTISIG_DESCRIPTOR_ORIGIN_PATH}]${xpub}${suffix}`
  })
  if (requiredSignatures < 1 || requiredSignatures > parts.length) {
    throw new Error('Invalid multisig threshold for descriptor')
  }
  return addDescriptorChecksum(
    `wsh(sortedmulti(${requiredSignatures},${parts.join(',')}))`
  )
}

export const parseMultisigDescriptor = (
  descriptor: string
): ParsedMultisigDescriptor | null => {
  const trimmed = stripDescriptorChecksum(descriptor)
  const header = /^wsh\(sortedmulti\((\d+),(.*)\)\)$/.exec(trimmed)
  if (header == null) return null

  const requiredSignatures = Number(header[1])
  const keysBody = header[2]
  const cosignerKeys: ParsedMultisigDescriptor['cosignerKeys'] = []
  const re = new RegExp(DESCRIPTOR_KEY_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(keysBody)) != null) {
    cosignerKeys.push({
      fingerprint: match[1].toLowerCase(),
      originPath: match[2],
      xpub: normalizeExtendedKey(match[3]),
      multipath: match[4]
    })
  }
  if (cosignerKeys.length < 2) return null
  return { requiredSignatures, cosignerKeys }
}

/** Origin path claims BIP-48 iff every embedded xpub actually is that node. */
export const descriptorOriginsMatchXpubs = (descriptor: string): boolean => {
  const parsed = parseMultisigDescriptor(descriptor)
  if (parsed == null) return false
  return parsed.cosignerKeys.every(key => {
    const originIsBip48 = /(?:^|\/)48'/.test(key.originPath)
    return originIsBip48 === isBip48NativeSegwitAccountXpub(key.xpub)
  })
}

export const deriveBitcoinMultisigFromDescriptor = (opts: {
  descriptor: string
  change?: number
  addressIndex?: number
}): BitcoinMultisigOnChain => {
  const parsed = parseMultisigDescriptor(opts.descriptor)
  if (parsed == null) {
    throw new Error('Invalid multisig output descriptor')
  }
  const xpubs = parsed.cosignerKeys.map(key => key.xpub)
  return deriveBitcoinMultisigOnChain({
    xpubs,
    requiredSignatures: parsed.requiredSignatures,
    change: opts.change ?? 0,
    addressIndex: opts.addressIndex ?? 0
  })
}
