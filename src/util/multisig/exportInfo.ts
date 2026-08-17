import {
  buildMultisigDescriptor,
  deriveBitcoinMultisigFromDescriptor,
  deriveBitcoinMultisigOnChain,
  descriptorOriginsMatchXpubs,
  normalizeExtendedKey,
  validateCosignerXpubs
} from './bitcoinP2wsh'
import {
  addDescriptorChecksum,
  stripDescriptorChecksum
} from './descriptorChecksum'
import {
  getMultisigReceiveAddress,
  type MultisigProposal,
  proposalUsesLegacyBip49Keys
} from './types'

export interface MultisigExportPayload {
  format: 'edge-multisig-export'
  version: 1
  walletName: string
  requiredSignatures: number
  totalCosigners: number
  keyOrigin: string
  descriptor?: string
  p2wshAddress?: string
  witnessScriptHex?: string
  cosigners: Array<{
    xpub: string
    parentFingerprint?: string
  }>
}

const cosignerDescriptorInputs = (
  proposal: MultisigProposal
): Array<{ xpub: string; fingerprint?: string }> => {
  const out: Array<{ xpub: string; fingerprint?: string }> = []
  for (const item of proposal.cosigners) {
    if (item.xpub == null || item.xpub.trim() === '') continue
    out.push({ xpub: item.xpub, fingerprint: item.parentFingerprint })
  }
  return out
}

export const resolveMultisigExportFields = (
  proposal: MultisigProposal
): {
  descriptor?: string
  p2wshAddress?: string
  witnessScriptHex?: string
} => {
  const stored = {
    descriptor:
      proposal.descriptor != null && proposal.descriptor.trim() !== ''
        ? addDescriptorChecksum(proposal.descriptor)
        : undefined,
    p2wshAddress:
      proposal.p2wshAddress != null && proposal.p2wshAddress.trim() !== ''
        ? proposal.p2wshAddress.trim()
        : undefined,
    witnessScriptHex:
      proposal.witnessScriptHex != null &&
      proposal.witnessScriptHex.trim() !== ''
        ? proposal.witnessScriptHex.trim()
        : undefined
  }
  if (
    stored.descriptor != null &&
    !descriptorOriginsMatchXpubs(stored.descriptor)
  ) {
    stored.descriptor = undefined
  }
  if (stored.descriptor != null && stored.p2wshAddress != null) return stored

  const xpubs = proposal.cosigners
    .map(c => c.xpub)
    .filter((x): x is string => x != null && x.trim() !== '')
  if (xpubs.length < proposal.totalCosigners) return stored

  try {
    let descriptor = stored.descriptor
    let onChain
    if (descriptor != null) {
      onChain = deriveBitcoinMultisigFromDescriptor({ descriptor })
    } else if (proposalUsesLegacyBip49Keys(proposal)) {
      const validated = xpubs.map(x => normalizeExtendedKey(x))
      onChain = deriveBitcoinMultisigOnChain({
        xpubs: validated,
        requiredSignatures: proposal.requiredSignatures
      })
    } else {
      const validated = validateCosignerXpubs(xpubs)
      onChain = deriveBitcoinMultisigOnChain({
        xpubs: validated,
        requiredSignatures: proposal.requiredSignatures
      })
      descriptor = buildMultisigDescriptor(
        proposal.requiredSignatures,
        cosignerDescriptorInputs(proposal)
      )
    }
    return {
      descriptor,
      p2wshAddress: stored.p2wshAddress ?? onChain.p2wshAddress,
      witnessScriptHex: stored.witnessScriptHex ?? onChain.witnessScriptHex
    }
  } catch {
    return stored
  }
}

export const buildMultisigExportPayload = (
  proposal: MultisigProposal
): MultisigExportPayload => {
  const fields = resolveMultisigExportFields(proposal)
  return {
    format: 'edge-multisig-export',
    version: 1,
    walletName: proposal.walletName,
    requiredSignatures: proposal.requiredSignatures,
    totalCosigners: proposal.totalCosigners,
    keyOrigin:
      proposal.keyOrigin ??
      (proposalUsesLegacyBip49Keys(proposal) ? 'bip49' : 'bip48'),
    descriptor: fields.descriptor,
    p2wshAddress: fields.p2wshAddress ?? getMultisigReceiveAddress(proposal),
    witnessScriptHex: fields.witnessScriptHex,
    cosigners: proposal.cosigners
      .filter(c => c.xpub != null && c.xpub.trim() !== '')
      .map(c => ({
        xpub: c.xpub!,
        parentFingerprint: c.parentFingerprint
      }))
  }
}

export const buildMultisigExportText = (proposal: MultisigProposal): string => {
  const descriptor = resolveMultisigExportFields(proposal).descriptor
  if (descriptor == null || descriptor === '') {
    throw new Error('Multisig output descriptor is not available')
  }
  return addDescriptorChecksum(descriptor)
}

export const buildMultisigExportFilename = (
  proposal: MultisigProposal,
  extension: 'txt' | 'bsms' = 'txt'
): string => {
  const base = proposal.walletName
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const name = base !== '' ? base : 'multisig'
  return `${name}.${extension}`
}

/**
 * BIP-129 coordinator/wallet record for Sparrow Import Wallet → BSMS.
 * Uses the HD template (`/**` + `/0/*,/1/*`) from the BIP-129 test vectors.
 */
export const buildMultisigBsmsText = (proposal: MultisigProposal): string => {
  const fields = resolveMultisigExportFields(proposal)
  if (fields.descriptor == null || fields.descriptor === '') {
    throw new Error('Multisig output descriptor is not available')
  }
  const address = fields.p2wshAddress ?? getMultisigReceiveAddress(proposal)
  if (address == null || address === '') {
    throw new Error('Multisig receive address is not available')
  }
  const template = addDescriptorChecksum(
    stripDescriptorChecksum(fields.descriptor).replace(/\/<0;1>\/\*/g, '/**')
  )
  return ['BSMS 1.0', template, '/0/*,/1/*', address].join('\n')
}
