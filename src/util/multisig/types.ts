import {
  asArray,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'

import {
  deriveBitcoinMultisigFromDescriptor,
  deriveBitcoinMultisigOnChain
} from './bitcoinP2wsh'

export const MULTISIG_STORE_ID = 'edge-multisig'
export const MULTISIG_IDENTITY_KEY = 'identity'
export const MULTISIG_PROPOSALS_KEY = 'proposals'
export const MULTISIG_SPENDS_KEY = 'spends'

export const asNostrIdentity = asObject({
  nsecHex: asString,
  npub: asString,
  displayName: asOptional(asString),
  name: asOptional(asString),
  nip05: asOptional(asString)
})
export interface NostrIdentity {
  nsecHex: string
  npub: string
  displayName?: string
  name?: string
  nip05?: string
}

export const asMultisigCosignerStatus = asValue('pending', 'accepted', 'local')
export type MultisigCosignerStatus = ReturnType<typeof asMultisigCosignerStatus>

export const asMultisigCosigner = asObject({
  npub: asOptional(asString),
  xpub: asOptional(asString),
  nip05: asOptional(asString),
  status: asMultisigCosignerStatus,
  parentFingerprint: asOptional(asString)
})
export interface MultisigCosigner {
  npub?: string
  xpub?: string
  nip05?: string
  status: MultisigCosignerStatus
  parentFingerprint?: string
}

export const asMultisigProposalStatus = asValue(
  'pending',
  'complete',
  'declined'
)
export type MultisigProposalStatus = ReturnType<typeof asMultisigProposalStatus>

export const asMultisigKeyOrigin = asValue('bip48', 'bip49')
export type MultisigKeyOrigin = ReturnType<typeof asMultisigKeyOrigin>

export const asMultisigProposal = asObject({
  id: asString,
  createdAt: asNumber,
  role: asValue('initiator', 'cosigner'),
  requiredSignatures: asNumber,
  totalCosigners: asNumber,
  walletName: asString,
  walletId: asOptional(asString),
  localXpub: asOptional(asString),
  localParentFingerprint: asOptional(asString),
  initiatorNpub: asString,
  status: asMultisigProposalStatus,
  cosigners: asArray(asMultisigCosigner),
  p2wshAddress: asOptional(asString),
  witnessScriptHex: asOptional(asString),
  descriptor: asOptional(asString),
  keyOrigin: asOptional(asMultisigKeyOrigin)
})
export interface MultisigProposal {
  id: string
  createdAt: number
  role: 'initiator' | 'cosigner'
  requiredSignatures: number
  totalCosigners: number
  walletName: string
  walletId?: string
  localXpub?: string
  localParentFingerprint?: string
  initiatorNpub: string
  status: MultisigProposalStatus
  cosigners: MultisigCosigner[]
  p2wshAddress?: string
  witnessScriptHex?: string
  descriptor?: string
  keyOrigin?: MultisigKeyOrigin
}

export const asMultisigProposals = asArray(asMultisigProposal)
export type MultisigProposals = MultisigProposal[]

export const asMultisigInviteMessage = asObject({
  type: asValue('edge-multisig-invite'),
  version: asNumber,
  proposalId: asString,
  walletName: asString,
  requiredSignatures: asNumber,
  totalCosigners: asNumber,
  initiatorNpub: asString,
  initiatorXpub: asString,
  cosignerNpubs: asArray(asString)
})
export type MultisigInviteMessage = ReturnType<typeof asMultisigInviteMessage>

export const asMultisigAcceptMessage = asObject({
  type: asValue('edge-multisig-accept'),
  version: asNumber,
  proposalId: asString,
  npub: asString,
  xpub: asString
})
export type MultisigAcceptMessage = ReturnType<typeof asMultisigAcceptMessage>

export const asMultisigCompleteMessage = asObject({
  type: asValue('edge-multisig-complete'),
  version: asNumber,
  proposalId: asString,
  cosigners: asArray(asMultisigCosigner)
})
export interface MultisigCompleteMessage {
  type: 'edge-multisig-complete'
  version: number
  proposalId: string
  cosigners: MultisigCosigner[]
}

export const asMultisigSpendSignerStatus = asValue(
  'pending',
  'signed',
  'rejected'
)
export type MultisigSpendSignerStatus = ReturnType<
  typeof asMultisigSpendSignerStatus
>

export const asMultisigSpendSigner = asObject({
  npub: asString,
  status: asMultisigSpendSignerStatus
})
export type MultisigSpendSigner = ReturnType<typeof asMultisigSpendSigner>

export const asMultisigSpendStatus = asValue('pending', 'broadcast', 'rejected')
export type MultisigSpendStatus = ReturnType<typeof asMultisigSpendStatus>

export const asMultisigSpendProposal = asObject({
  id: asString,
  walletProposalId: asString,
  walletId: asOptional(asString),
  createdAt: asNumber,
  status: asMultisigSpendStatus,
  requiredSignatures: asNumber,
  totalCosigners: asNumber,
  psbtBase64: asString,
  amountNative: asString,
  destAddress: asString,
  feeNative: asString,
  initiatorNpub: asString,
  txid: asOptional(asString),
  signers: asArray(asMultisigSpendSigner)
})
export interface MultisigSpendProposal {
  id: string
  walletProposalId: string
  walletId?: string
  createdAt: number
  status: MultisigSpendStatus
  requiredSignatures: number
  totalCosigners: number
  psbtBase64: string
  amountNative: string
  destAddress: string
  feeNative: string
  initiatorNpub: string
  txid?: string
  signers: MultisigSpendSigner[]
}

export const asMultisigSpendProposals = asArray(asMultisigSpendProposal)
export type MultisigSpendProposals = MultisigSpendProposal[]

export const asMultisigSpendRequestMessage = asObject({
  type: asValue('edge-multisig-spend-request'),
  version: asNumber,
  spendId: asString,
  walletProposalId: asString,
  requiredSignatures: asNumber,
  totalCosigners: asNumber,
  psbtBase64: asString,
  amountNative: asString,
  destAddress: asString,
  feeNative: asString,
  initiatorNpub: asString,
  signers: asArray(asMultisigSpendSigner)
})
export type MultisigSpendRequestMessage = ReturnType<
  typeof asMultisigSpendRequestMessage
>

export const asMultisigSpendPartialMessage = asObject({
  type: asValue('edge-multisig-spend-partial'),
  version: asNumber,
  spendId: asString,
  walletProposalId: asString,
  npub: asString,
  psbtBase64: asString,
  signers: asArray(asMultisigSpendSigner)
})
export type MultisigSpendPartialMessage = ReturnType<
  typeof asMultisigSpendPartialMessage
>

export const asMultisigSpendRejectMessage = asObject({
  type: asValue('edge-multisig-spend-reject'),
  version: asNumber,
  spendId: asString,
  walletProposalId: asString,
  npub: asString
})
export type MultisigSpendRejectMessage = ReturnType<
  typeof asMultisigSpendRejectMessage
>

export const asMultisigSpendCompleteMessage = asObject({
  type: asValue('edge-multisig-spend-complete'),
  version: asNumber,
  spendId: asString,
  walletProposalId: asString,
  txid: asString,
  psbtBase64: asString,
  signers: asArray(asMultisigSpendSigner)
})
export type MultisigSpendCompleteMessage = ReturnType<
  typeof asMultisigSpendCompleteMessage
>

export const pendingCount = (proposal: MultisigProposal): number =>
  proposal.cosigners.filter(
    c => c.status === 'accepted' || c.status === 'local'
  ).length

export const cosignerXpubCount = (proposal: MultisigProposal): number =>
  proposal.cosigners.filter(c => c.xpub != null && c.xpub.trim() !== '').length

export const isMultisigProposalReadyToComplete = (
  proposal: MultisigProposal
): boolean =>
  pendingCount(proposal) >= proposal.totalCosigners &&
  cosignerXpubCount(proposal) >= proposal.totalCosigners

export const npubsEqual = (
  a: string | undefined,
  b: string | undefined
): boolean => {
  if (a == null || b == null || a === '' || b === '') return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

const cosignerJoinRank = (status: MultisigCosignerStatus): number =>
  status === 'pending' ? 0 : 1

export const mergeCosignerLists = (
  primary: MultisigCosigner[],
  secondary: MultisigCosigner[]
): MultisigCosigner[] => {
  const byKey = new Map<string, MultisigCosigner>()
  const keyOf = (item: MultisigCosigner): string =>
    item.npub != null && item.npub !== ''
      ? `n:${item.npub.trim().toLowerCase()}`
      : `x:${item.xpub ?? ''}`
  for (const list of [secondary, primary]) {
    for (const item of list) {
      const key = keyOf(item)
      const prev = byKey.get(key)
      if (prev == null) {
        byKey.set(key, item)
        continue
      }
      const keepPrev =
        cosignerJoinRank(prev.status) > cosignerJoinRank(item.status)
      byKey.set(key, {
        ...prev,
        ...item,
        status: keepPrev ? prev.status : item.status,
        xpub: item.xpub ?? prev.xpub,
        nip05: item.nip05 ?? prev.nip05,
        parentFingerprint: item.parentFingerprint ?? prev.parentFingerprint
      })
    }
  }
  return [...byKey.values()]
}

export const proposalStateRank = (proposal: MultisigProposal): number => {
  let rank = 0
  if (proposal.status === 'complete') rank += 300
  else if (proposal.status === 'declined') rank += 150
  if (proposal.walletId != null) rank += 50
  rank += pendingCount(proposal) * 10
  rank += cosignerXpubCount(proposal)
  return rank
}

export const mergeProposalPair = (
  disk: MultisigProposal,
  memory: MultisigProposal
): MultisigProposal => {
  const richer =
    proposalStateRank(memory) >= proposalStateRank(disk) ? memory : disk
  const status =
    disk.status === 'complete' || memory.status === 'complete'
      ? 'complete'
      : richer.status
  return {
    ...richer,
    status,
    walletId: memory.walletId ?? disk.walletId,
    localXpub: memory.localXpub ?? disk.localXpub,
    localParentFingerprint:
      memory.localParentFingerprint ?? disk.localParentFingerprint,
    cosigners: mergeCosignerLists(memory.cosigners, disk.cosigners),
    p2wshAddress: memory.p2wshAddress ?? disk.p2wshAddress,
    witnessScriptHex: memory.witnessScriptHex ?? disk.witnessScriptHex,
    descriptor: memory.descriptor ?? disk.descriptor
  }
}

export const mergeProposalLists = (
  disk: MultisigProposals,
  memory: MultisigProposals
): MultisigProposals => {
  const byId = new Map<string, MultisigProposal>()
  for (const proposal of disk) byId.set(proposal.id, proposal)
  for (const proposal of memory) {
    const prev = byId.get(proposal.id)
    byId.set(
      proposal.id,
      prev == null ? proposal : mergeProposalPair(prev, proposal)
    )
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export const isWalletWaitingCosigners = (
  proposals: readonly MultisigProposal[],
  walletId: string
): boolean => {
  const forWallet = proposals.filter(item => item.walletId === walletId)
  if (forWallet.some(item => item.status === 'complete')) return false
  return forWallet.some(item => item.status === 'pending')
}

export const withLocalCosignerAccepted = (
  proposal: MultisigProposal,
  localNpub: string
): MultisigProposal => {
  if (localNpub === '' || proposal.walletId == null) return proposal
  let changed = false
  let found = false
  const cosigners = proposal.cosigners.map(item => {
    if (!npubsEqual(item.npub, localNpub)) return item
    found = true
    if (item.status !== 'pending') return item
    changed = true
    return {
      ...item,
      status: 'accepted' as const,
      xpub: item.xpub ?? proposal.localXpub
    }
  })
  if (!found && proposal.role === 'cosigner') {
    changed = true
    cosigners.push({
      npub: localNpub,
      xpub: proposal.localXpub,
      nip05: undefined,
      status: 'accepted',
      parentFingerprint: proposal.localParentFingerprint
    })
  }
  if (!changed) return proposal
  return { ...proposal, cosigners }
}

export const hasLocalJoinedProposal = (
  proposal: MultisigProposal,
  localNpub: string
): boolean => {
  if (proposal.role === 'initiator') return true
  if (proposal.walletId != null) return true
  return proposal.cosigners.some(
    item => npubsEqual(item.npub, localNpub) && item.status === 'accepted'
  )
}

export const spendSignedCount = (spend: MultisigSpendProposal): number =>
  spend.signers.filter(s => s.status === 'signed').length

export const isXpubLike = (value: string): boolean =>
  /^(xpub|ypub|zpub|Ypub|Zpub|tpub|upub|vpub)[1-9A-HJ-NP-Za-km-z]{20,}$/.test(
    value.trim()
  )

export const formatMultisigWalletName = (
  requiredSignatures: number,
  totalCosigners: number
): string => `Bitcoin Multisig ${requiredSignatures}-of-${totalCosigners}`

export const proposalUsesLegacyBip49Keys = (
  proposal: MultisigProposal
): boolean =>
  proposal.keyOrigin === 'bip49' ||
  (proposal.keyOrigin == null && proposal.descriptor == null)

export const truncateNpub = (npub: string, head = 12, tail = 6): string => {
  if (npub.length <= head + tail + 1) return npub
  return `${npub.slice(0, head)}…${npub.slice(-tail)}`
}

export const getMultisigReceiveAddress = (
  proposal: MultisigProposal | undefined,
  receiveIndex: number = 0
): string | undefined => {
  if (proposal == null || proposal.status !== 'complete') return undefined
  // Prefer live HD index when provided; fall back to stored m/0/0 address.
  if (receiveIndex === 0) {
    if (proposal.p2wshAddress != null && proposal.p2wshAddress !== '') {
      return proposal.p2wshAddress
    }
  }
  const xpubs = proposal.cosigners
    .map(c => c.xpub)
    .filter((x): x is string => x != null && x !== '')
  if (xpubs.length < proposal.totalCosigners) return undefined
  try {
    if (proposal.descriptor != null && proposal.descriptor !== '') {
      return deriveBitcoinMultisigFromDescriptor({
        descriptor: proposal.descriptor,
        change: 0,
        addressIndex: receiveIndex
      }).p2wshAddress
    }
    return deriveBitcoinMultisigOnChain({
      xpubs,
      requiredSignatures: proposal.requiredSignatures,
      change: 0,
      addressIndex: receiveIndex
    }).p2wshAddress
  } catch {
    return undefined
  }
}
