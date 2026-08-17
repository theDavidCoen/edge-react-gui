import {
  normalizeExtendedKey,
  type ParsedMultisigDescriptor,
  parseMultisigDescriptor
} from './bitcoinP2wsh'
import {
  addDescriptorChecksum,
  stripDescriptorChecksum
} from './descriptorChecksum'
import {
  deriveBip48AccountFromPrivateMaterial,
  deriveLegacyBip49AccountFromPrivateMaterial,
  type MultisigAccountKeyInfo
} from './multisigKeys'

export interface ParsedImportedMultisig {
  kind: 'wallet'
  descriptor: string
  parsed: ParsedMultisigDescriptor
  firstAddress?: string
}

export type ImportedMultisigParseResult =
  | ParsedImportedMultisig
  | { kind: 'signer' }
  | { kind: 'invalid' }

export interface MatchedImportedMultisigSeed {
  keyOrigin: 'bip48' | 'bip49'
  local: MultisigAccountKeyInfo
}

const normalizeDescriptorTemplate = (descriptor: string): string =>
  stripDescriptorChecksum(descriptor.trim()).replace(/\/\*\*/g, '/<0;1>/*')

/**
 * Parse a pasted Edge export: raw BIP-380 descriptor or BIP-129 wallet BSMS.
 * Single-keystore signer records (`00` + one xpub) are not a full wallet.
 */
export const parseImportedMultisigText = (
  raw: string
): ImportedMultisigParseResult => {
  const trimmed = raw.trim()
  if (trimmed === '') return { kind: 'invalid' }

  const lines = trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')

  let descriptorSource = trimmed.replace(/\r?\n/g, '')
  let firstAddress: string | undefined

  if (/^BSMS 1\.0$/i.test(lines[0] ?? '')) {
    if (lines.length < 2) return { kind: 'invalid' }
    const second = lines[1]
    if (
      second === '00' ||
      (/^[0-9a-f]+$/i.test(second) && !second.toLowerCase().startsWith('wsh'))
    ) {
      return { kind: 'signer' }
    }
    descriptorSource = second
    if (lines[3]?.startsWith('bc1')) {
      firstAddress = lines[3]
    }
  }

  const descriptor = addDescriptorChecksum(
    normalizeDescriptorTemplate(descriptorSource)
  )
  const parsed = parseMultisigDescriptor(descriptor)
  if (parsed == null) return { kind: 'invalid' }
  return { kind: 'wallet', descriptor, parsed, firstAddress }
}

/**
 * Confirm this seed (or account xprv) is one of the descriptor cosigners.
 * Prefers BIP-48, then legacy BIP-49 used by older Edge multisig wallets.
 */
export const matchImportedMultisigSeed = (
  parsed: ParsedMultisigDescriptor,
  seed: string
): MatchedImportedMultisigSeed | undefined => {
  const locals: MultisigAccountKeyInfo[] = []
  try {
    locals.push(deriveBip48AccountFromPrivateMaterial(seed))
  } catch {}
  try {
    locals.push(deriveLegacyBip49AccountFromPrivateMaterial(seed))
  } catch {}

  const remoteXpubs = parsed.cosignerKeys.map(key =>
    normalizeExtendedKey(key.xpub)
  )
  for (const local of locals) {
    try {
      const localXpub = normalizeExtendedKey(local.xpub)
      const match = parsed.cosignerKeys.find(
        (_, index) => remoteXpubs[index] === localXpub
      )
      if (match == null) continue
      // Trust the derived xpub bytes, not the descriptor origin label.
      return { keyOrigin: local.keyOrigin, local }
    } catch {}
  }
  return undefined
}
