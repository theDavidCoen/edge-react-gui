import type { EdgeAccount } from 'edge-core-js'

import {
  getLocalAccountSettings,
  writeAccountNotifInfo
} from '../../actions/LocalSettingsActions'
import {
  getCachedMultisigIdentity,
  getCachedMultisigProposals,
  getMultisigProposal
} from './store'
import { npubsEqual } from './types'

export const getMultisigInviteNotifKey = (initiatorNpub: string): string =>
  `multisigInvite-${initiatorNpub}`

export const getLegacyMultisigInviteNotifKey = (proposalId: string): string =>
  `multisigInvite-${proposalId}`

export const isMultisigInviteNotifKey = (key: string): boolean =>
  key.startsWith('multisigInvite-')

export const getProposalIdFromMultisigNotifKey = (key: string): string =>
  key.slice('multisigInvite-'.length)

export const addMultisigInviteNotification = async (
  account: EdgeAccount,
  proposalId: string,
  initiatorNpub: string,
  forceShow: boolean = false
): Promise<boolean> => {
  const settings = await getLocalAccountSettings(account)
  const key = getMultisigInviteNotifKey(initiatorNpub)
  const existing = settings.notifState[key]
  const isNew = existing == null || existing.isCompleted
  const show = forceShow || isNew

  await writeAccountNotifInfo(account, key, {
    dateReceived: show ? new Date() : existing.dateReceived,
    isPriority: false,
    isCompleted: false,
    isBannerHidden: show ? false : existing.isBannerHidden,
    params: { proposalId }
  })

  const legacyKey = getLegacyMultisigInviteNotifKey(proposalId)
  if (legacyKey !== key) {
    await writeAccountNotifInfo(account, legacyKey, {
      isCompleted: true,
      isBannerHidden: true
    })
  }
  return show
}

export const completeMultisigInviteNotification = async (
  account: EdgeAccount,
  proposalId: string
): Promise<void> => {
  const proposal = getMultisigProposal(proposalId)
  const keys = new Set<string>([getLegacyMultisigInviteNotifKey(proposalId)])
  if (proposal?.initiatorNpub != null) {
    keys.add(getMultisigInviteNotifKey(proposal.initiatorNpub))
  }
  for (const key of keys) {
    await writeAccountNotifInfo(account, key, {
      isCompleted: true,
      isBannerHidden: true
    })
  }
}

/**
 * Historical relay dumps created one notification per failed create attempt.
 * Keep a single incomplete invite card per initiator, pointing at the newest
 * invite that still needs this account to join.
 */
export const collapseMultisigInviteNotifications = async (
  account: EdgeAccount
): Promise<void> => {
  const settings = await getLocalAccountSettings(account)
  const localNpub = getCachedMultisigIdentity()?.npub
  const latestByInitiator = new Map<string, string>()

  for (const proposal of getCachedMultisigProposals()) {
    if (proposal.status !== 'pending' || proposal.role !== 'cosigner') continue
    const localPending =
      localNpub == null ||
      proposal.cosigners.some(
        item => npubsEqual(item.npub, localNpub) && item.status === 'pending'
      )
    if (!localPending) continue
    const prevId = latestByInitiator.get(proposal.initiatorNpub)
    if (prevId == null) {
      latestByInitiator.set(proposal.initiatorNpub, proposal.id)
      continue
    }
    const prev = getMultisigProposal(prevId)
    if (prev == null || proposal.createdAt >= prev.createdAt) {
      latestByInitiator.set(proposal.initiatorNpub, proposal.id)
    }
  }

  for (const [key, info] of Object.entries(settings.notifState)) {
    if (!isMultisigInviteNotifKey(key) || info.isCompleted) continue
    const proposalId =
      info.params?.proposalId ?? getProposalIdFromMultisigNotifKey(key)
    const proposal = getMultisigProposal(proposalId)
    const initiator = proposal?.initiatorNpub
    const canonicalId =
      initiator != null ? latestByInitiator.get(initiator) : undefined
    const canonicalKey =
      initiator != null ? getMultisigInviteNotifKey(initiator) : undefined
    const keep =
      canonicalKey != null &&
      canonicalId != null &&
      key === canonicalKey &&
      proposalId === canonicalId
    if (keep) continue
    await writeAccountNotifInfo(account, key, {
      isCompleted: true,
      isBannerHidden: true
    })
  }

  for (const [initiatorNpub, proposalId] of latestByInitiator) {
    const key = getMultisigInviteNotifKey(initiatorNpub)
    const existing = (await getLocalAccountSettings(account)).notifState[key]
    await writeAccountNotifInfo(account, key, {
      dateReceived: existing?.dateReceived ?? new Date(),
      isPriority: false,
      isCompleted: false,
      isBannerHidden: false,
      params: { proposalId }
    })
  }
}

export const showJoinableInviteBanners = async (
  account: EdgeAccount
): Promise<void> => {
  const localNpub = getCachedMultisigIdentity()?.npub
  for (const proposal of getCachedMultisigProposals()) {
    if (proposal.status !== 'pending' || proposal.role !== 'cosigner') continue
    if (proposal.walletId != null) continue
    if (
      localNpub != null &&
      !proposal.cosigners.some(
        item => npubsEqual(item.npub, localNpub) && item.status === 'pending'
      )
    ) {
      continue
    }
    await addMultisigInviteNotification(
      account,
      proposal.id,
      proposal.initiatorNpub,
      true
    )
  }
}

export const getMultisigSpendNotifKey = (spendId: string): string =>
  `multisigSpend-${spendId}`

export const isMultisigSpendNotifKey = (key: string): boolean =>
  key.startsWith('multisigSpend-')

export const getSpendIdFromMultisigNotifKey = (key: string): string =>
  key.slice('multisigSpend-'.length)

export const addMultisigSpendNotification = async (
  account: EdgeAccount,
  spendId: string
): Promise<void> => {
  await writeAccountNotifInfo(account, getMultisigSpendNotifKey(spendId), {
    dateReceived: new Date(),
    isPriority: true,
    isCompleted: false,
    isBannerHidden: false,
    params: { spendId }
  })
}

export const completeMultisigSpendNotification = async (
  account: EdgeAccount,
  spendId: string
): Promise<void> => {
  await writeAccountNotifInfo(account, getMultisigSpendNotifKey(spendId), {
    isCompleted: true,
    isBannerHidden: true
  })
}
