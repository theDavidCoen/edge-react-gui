import { asArray, asString } from 'cleaners'
import type { EdgeAccount } from 'edge-core-js'

import {
  isAccountDataStoreActive,
  isClosedDataStoreError
} from '../multisig/accountActive'
import { getMultisigProposal } from '../multisig/store'
import { MULTISIG_STORE_ID } from '../multisig/types'

export const SEEN_NOSTR_EVENT_IDS_KEY = 'seenNostrEventIds'
export const SEEN_PROPOSAL_IDS_KEY = 'seenProposalIds'
export const SEEN_SPEND_IDS_KEY = 'seenSpendIds'

const MAX_SEEN_IDS = 10000

const asSeenIds = asArray(asString)

const trimSeen = (ids: string[]): string[] => {
  if (ids.length <= MAX_SEEN_IDS) return ids
  return ids.slice(ids.length - MAX_SEEN_IDS)
}

const loadJsonArray = async (
  account: EdgeAccount,
  key: string
): Promise<string[]> => {
  try {
    const text = await account.dataStore.getItem(MULTISIG_STORE_ID, key)
    const parsed = JSON.parse(text)
    return trimSeen(asSeenIds(parsed))
  } catch {
    return []
  }
}

const saveJsonArray = async (
  account: EdgeAccount,
  key: string,
  ids: string[]
): Promise<void> => {
  if (!isAccountDataStoreActive(account)) return
  try {
    await account.dataStore.setItem(
      MULTISIG_STORE_ID,
      key,
      JSON.stringify(trimSeen(ids))
    )
  } catch (error) {
    if (isClosedDataStoreError(error)) return
    throw error
  }
}

let cachedEventIds: Set<string> | null = null
let cachedProposalIds: Set<string> | null = null
let cachedSpendIds: Set<string> | null = null
let cachedAccountId: string | null = null

const resetCacheIfAccountChanged = (account: EdgeAccount): void => {
  if (cachedAccountId != null && cachedAccountId !== account.id) {
    cachedEventIds = null
    cachedProposalIds = null
    cachedSpendIds = null
  }
  cachedAccountId = account.id
}

export const loadNostrDedupStore = async (
  account: EdgeAccount
): Promise<void> => {
  resetCacheIfAccountChanged(account)
  const [events, proposals, spends] = await Promise.all([
    loadJsonArray(account, SEEN_NOSTR_EVENT_IDS_KEY),
    loadJsonArray(account, SEEN_PROPOSAL_IDS_KEY),
    loadJsonArray(account, SEEN_SPEND_IDS_KEY)
  ])
  cachedEventIds = new Set(events)
  cachedProposalIds = new Set(proposals)
  cachedSpendIds = new Set(spends)
}

export const markNostrEventSeen = async (
  account: EdgeAccount,
  eventId: string
): Promise<void> => {
  if (cachedEventIds == null) await loadNostrDedupStore(account)
  if (cachedEventIds?.has(eventId) === true) return
  const next = new Set(cachedEventIds ?? [])
  next.add(eventId)
  cachedEventIds = next
  await saveJsonArray(account, SEEN_NOSTR_EVENT_IDS_KEY, [...next])
}

export const isNostrEventSeenSync = (eventId: string): boolean =>
  cachedEventIds?.has(eventId) ?? false

export const isNostrEventSeen = async (
  account: EdgeAccount,
  eventId: string
): Promise<boolean> => {
  if (cachedEventIds == null) await loadNostrDedupStore(account)
  return isNostrEventSeenSync(eventId)
}

export const isProposalHandshakeSeen = async (
  account: EdgeAccount,
  proposalId: string
): Promise<boolean> => {
  if (cachedProposalIds == null) await loadNostrDedupStore(account)
  return (
    (cachedProposalIds?.has(proposalId) ?? false) ||
    getMultisigProposal(proposalId) != null
  )
}

export const markProposalHandshakeSeen = async (
  account: EdgeAccount,
  proposalId: string
): Promise<void> => {
  if (cachedProposalIds == null) await loadNostrDedupStore(account)
  if (cachedProposalIds?.has(proposalId) === true) return
  const next = new Set(cachedProposalIds ?? [])
  next.add(proposalId)
  cachedProposalIds = next
  await saveJsonArray(account, SEEN_PROPOSAL_IDS_KEY, [...next])
}

export const spendHandshakeKey = (
  spendId: string,
  walletProposalId: string
): string => `${walletProposalId}:${spendId}`

export const isSpendHandshakeSeen = async (
  account: EdgeAccount,
  spendId: string,
  walletProposalId: string
): Promise<boolean> => {
  if (cachedSpendIds == null) await loadNostrDedupStore(account)
  const key = spendHandshakeKey(spendId, walletProposalId)
  return cachedSpendIds?.has(key) ?? false
}

export const markSpendHandshakeSeen = async (
  account: EdgeAccount,
  spendId: string,
  walletProposalId: string
): Promise<void> => {
  if (cachedSpendIds == null) await loadNostrDedupStore(account)
  const key = spendHandshakeKey(spendId, walletProposalId)
  if (cachedSpendIds?.has(key) === true) return
  const next = new Set(cachedSpendIds ?? [])
  next.add(key)
  cachedSpendIds = next
  await saveJsonArray(account, SEEN_SPEND_IDS_KEY, [...next])
}
