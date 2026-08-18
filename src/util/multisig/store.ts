import { asMaybe } from 'cleaners'
import type { EdgeAccount } from 'edge-core-js'
import * as React from 'react'
import { makeEvent } from 'yavent'

import {
  isAccountDataStoreActive,
  isClosedDataStoreError
} from './accountActive'
import {
  asMultisigProposal,
  asMultisigSpendProposal,
  asNostrIdentity,
  isWalletWaitingCosigners,
  mergeProposalLists,
  MULTISIG_IDENTITY_KEY,
  MULTISIG_PROPOSALS_KEY,
  MULTISIG_SPENDS_KEY,
  MULTISIG_STORE_ID,
  type MultisigProposal,
  type MultisigProposals,
  type MultisigSpendProposal,
  type MultisigSpendProposals,
  type NostrIdentity
} from './types'

let cachedAccountId: string | null = null
let cachedIdentity: NostrIdentity | null = null
let cachedProposals: MultisigProposals = []
let cachedSpends: MultisigSpendProposals = []
let loadPromise: Promise<void> | null = null
let storeLoadedForAccount: string | null = null

const [watchIdentity, emitIdentity] = makeEvent<NostrIdentity | null>()
const [watchProposals, emitProposals] = makeEvent<MultisigProposals>()
const [watchSpends, emitSpends] = makeEvent<MultisigSpendProposals>()

watchIdentity(identity => {
  cachedIdentity = identity
})
watchProposals(proposals => {
  cachedProposals = proposals
})
watchSpends(spends => {
  cachedSpends = spends
})

const writeMultisigStoreItem = async (
  account: EdgeAccount,
  key: string,
  value: string
): Promise<boolean> => {
  if (!isAccountDataStoreActive(account)) return false
  try {
    await account.dataStore.setItem(MULTISIG_STORE_ID, key, value)
    return true
  } catch (error) {
    if (isClosedDataStoreError(error)) return false
    throw error
  }
}

export const useMultisigIdentity = (): NostrIdentity | null => {
  const [identity, setIdentity] = React.useState(cachedIdentity)
  React.useEffect(() => {
    setIdentity(cachedIdentity)
    return watchIdentity(setIdentity)
  }, [])
  return identity
}

export const useMultisigProposals = (): MultisigProposals => {
  const [proposals, setProposals] = React.useState(cachedProposals)
  React.useEffect(() => {
    setProposals(cachedProposals)
    return watchProposals(setProposals)
  }, [])
  return proposals
}

export const useMultisigSpends = (): MultisigSpendProposals => {
  const [spends, setSpends] = React.useState(cachedSpends)
  React.useEffect(() => {
    setSpends(cachedSpends)
    return watchSpends(setSpends)
  }, [])
  return spends
}

export const getCachedMultisigProposals = (): MultisigProposals =>
  cachedProposals

export const getCachedMultisigIdentity = (): NostrIdentity | null =>
  cachedIdentity

/** Resolves when a Nostr identity exists, or null if `isCancelled` becomes true. */
export const waitForNostrIdentity = async (
  isCancelled?: () => boolean
): Promise<NostrIdentity | null> => {
  const existing = getCachedMultisigIdentity()
  if (existing != null) return existing
  return await new Promise(resolve => {
    let settled = false
    let unsub = (): void => {}
    const timers: { id?: ReturnType<typeof setInterval> } = {}
    const finish = (value: NostrIdentity | null): void => {
      if (settled) return
      settled = true
      unsub()
      if (timers.id != null) clearInterval(timers.id)
      resolve(value)
    }
    unsub = watchIdentity(identity => {
      if (identity != null) finish(identity)
    })
    timers.id = setInterval(() => {
      if (isCancelled != null && !isCancelled()) finish(null)
    }, 400)
  })
}

export const getCachedMultisigSpends = (): MultisigSpendProposals =>
  cachedSpends

const parseProposals = (raw: unknown): MultisigProposals => {
  if (!Array.isArray(raw)) return []
  const out: MultisigProposals = []
  for (const item of raw) {
    const parsed = asMaybe(asMultisigProposal)(item)
    if (parsed != null) out.push(parsed as MultisigProposal)
  }
  return out
}

const parseSpends = (raw: unknown): MultisigSpendProposals => {
  if (!Array.isArray(raw)) return []
  const out: MultisigSpendProposals = []
  for (const item of raw) {
    const parsed = asMaybe(asMultisigSpendProposal)(item)
    if (parsed != null) out.push(parsed as MultisigSpendProposal)
  }
  return out
}

export const loadMultisigStore = async (
  account: EdgeAccount
): Promise<void> => {
  if (loadPromise != null && cachedAccountId === account.id) {
    await loadPromise
    return
  }

  const run = async (): Promise<void> => {
    if (cachedAccountId != null && cachedAccountId !== account.id) {
      cachedIdentity = null
      cachedProposals = []
      cachedSpends = []
      storeLoadedForAccount = null
      emitIdentity(null)
      emitProposals([])
      emitSpends([])
    }
    cachedAccountId = account.id

    try {
      const text = await account.dataStore.getItem(
        MULTISIG_STORE_ID,
        MULTISIG_IDENTITY_KEY
      )
      cachedIdentity = asNostrIdentity(JSON.parse(text))
    } catch {
      cachedIdentity = null
    }
    emitIdentity(cachedIdentity)

    try {
      const text = await account.dataStore.getItem(
        MULTISIG_STORE_ID,
        MULTISIG_PROPOSALS_KEY
      )
      cachedProposals = mergeProposalLists(
        parseProposals(JSON.parse(text)),
        cachedProposals
      )
    } catch {
      if (cachedAccountId !== account.id) cachedProposals = []
    }
    emitProposals(cachedProposals)

    try {
      const text = await account.dataStore.getItem(
        MULTISIG_STORE_ID,
        MULTISIG_SPENDS_KEY
      )
      cachedSpends = parseSpends(JSON.parse(text))
    } catch {
      if (cachedAccountId !== account.id) cachedSpends = []
    }
    emitSpends(cachedSpends)
    storeLoadedForAccount = account.id
  }

  loadPromise = run().finally(() => {
    loadPromise = null
  })
  await loadPromise
}

export const saveMultisigIdentity = async (
  account: EdgeAccount,
  identity: NostrIdentity
): Promise<void> => {
  cachedAccountId = account.id
  cachedIdentity = identity
  emitIdentity(identity)
  await writeMultisigStoreItem(
    account,
    MULTISIG_IDENTITY_KEY,
    JSON.stringify(identity)
  )
}

export const saveMultisigProposals = async (
  account: EdgeAccount,
  proposals: MultisigProposals
): Promise<void> => {
  cachedAccountId = account.id
  cachedProposals = proposals
  emitProposals(proposals)
  await writeMultisigStoreItem(
    account,
    MULTISIG_PROPOSALS_KEY,
    JSON.stringify(proposals)
  )
}

export const saveMultisigSpends = async (
  account: EdgeAccount,
  spends: MultisigSpendProposals
): Promise<void> => {
  cachedAccountId = account.id
  cachedSpends = spends
  emitSpends(spends)
  await writeMultisigStoreItem(
    account,
    MULTISIG_SPENDS_KEY,
    JSON.stringify(spends)
  )
}

export const ensureMultisigStoreLoaded = async (
  account: EdgeAccount
): Promise<void> => {
  if (storeLoadedForAccount === account.id) return
  await loadMultisigStore(account)
}

export const upsertMultisigProposal = async (
  account: EdgeAccount,
  proposal: MultisigProposal
): Promise<MultisigProposal> => {
  if (storeLoadedForAccount !== account.id) {
    await loadMultisigStore(account)
  }
  const next = cachedProposals.filter(item => item.id !== proposal.id)
  next.unshift(proposal)
  await saveMultisigProposals(account, next)
  return proposal
}

export const upsertMultisigSpend = async (
  account: EdgeAccount,
  spend: MultisigSpendProposal
): Promise<MultisigSpendProposal> => {
  if (storeLoadedForAccount !== account.id) {
    await loadMultisigStore(account)
  }
  const next = cachedSpends.filter(item => item.id !== spend.id)
  next.unshift(spend)
  await saveMultisigSpends(account, next)
  return spend
}

export const getMultisigProposal = (
  proposalId: string
): MultisigProposal | undefined =>
  cachedProposals.find(item => item.id === proposalId)

export const getMultisigProposalByWalletId = (
  walletId: string
): MultisigProposal | undefined => {
  const matches = cachedProposals.filter(item => item.walletId === walletId)
  return (
    matches.find(item => item.status === 'complete') ??
    matches.find(item => item.status === 'pending') ??
    matches[0]
  )
}

export const getMultisigSpend = (
  spendId: string
): MultisigSpendProposal | undefined =>
  cachedSpends.find(item => item.id === spendId)

export const getPendingMultisigSpendsForWallet = (
  walletId: string
): MultisigSpendProposals =>
  cachedSpends.filter(
    item => item.walletId === walletId && item.status === 'pending'
  )

export const isMultisigWaitingCosigners = (walletId: string): boolean =>
  isWalletWaitingCosigners(cachedProposals, walletId)

export const isCompleteMultisigWallet = (walletId: string): boolean => {
  const proposal = getMultisigProposalByWalletId(walletId)
  // Complete = all cosigners joined. P2WSH may be repaired lazily after ypub→xpub fix.
  return proposal != null && proposal.status === 'complete'
}
