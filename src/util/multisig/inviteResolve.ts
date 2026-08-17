import { getCachedMultisigIdentity, getCachedMultisigProposals } from './store'
import { type MultisigProposal, npubsEqual } from './types'

const needsLocalJoin = (
  proposal: MultisigProposal,
  localNpub: string | undefined
): boolean => {
  if (proposal.status !== 'pending') return false
  if (proposal.role !== 'cosigner') return false
  if (localNpub == null) return true
  return proposal.cosigners.some(
    item => npubsEqual(item.npub, localNpub) && item.status === 'pending'
  )
}

const latestMatching = (
  proposals: MultisigProposal[],
  predicate: (proposal: MultisigProposal) => boolean
): MultisigProposal | undefined =>
  proposals.filter(predicate).sort((a, b) => b.createdAt - a.createdAt)[0]

/**
 * Prefer the newest invite that still needs this account to join.
 * Historical create retries share an initiator but have different proposalIds.
 */
export const resolveJoinableMultisigProposalId = (
  proposals: MultisigProposal[],
  requested: string | undefined,
  localNpub: string | undefined
): string | undefined => {
  if (requested != null) {
    const requestedProposal = proposals.find(item => item.id === requested)
    if (requestedProposal != null && requestedProposal.status !== 'declined') {
      // Already joined this proposal — do not bounce to a leftover invite.
      if (!needsLocalJoin(requestedProposal, localNpub)) {
        return requestedProposal.id
      }
      const newerJoinable = latestMatching(
        proposals,
        item =>
          item.initiatorNpub === requestedProposal.initiatorNpub &&
          needsLocalJoin(item, localNpub)
      )
      if (newerJoinable != null) return newerJoinable.id
      return requestedProposal.id
    }
  }

  return latestMatching(proposals, item => needsLocalJoin(item, localNpub))?.id
}

export const resolveStoredJoinableProposalId = (
  requested?: string
): string | undefined =>
  resolveJoinableMultisigProposalId(
    getCachedMultisigProposals(),
    requested,
    getCachedMultisigIdentity()?.npub
  )
