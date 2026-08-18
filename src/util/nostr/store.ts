import { asMaybe } from 'cleaners'
import type { EdgeAccount } from 'edge-core-js'
import * as React from 'react'
import { makeEvent } from 'yavent'

import {
  isAccountDataStoreActive,
  isClosedDataStoreError
} from '../accountDataStore'
import {
  asNostrIdentity,
  NOSTR_IDENTITY_KEY,
  NOSTR_STORE_ID,
  type NostrIdentity
} from './types'

let cachedAccountId: string | null = null
let cachedIdentity: NostrIdentity | null = null
let loadPromise: Promise<void> | null = null

const [watchIdentity, emitIdentity] = makeEvent<NostrIdentity | null>()

watchIdentity(identity => {
  cachedIdentity = identity
})

const writeNostrStoreItem = async (
  account: EdgeAccount,
  key: string,
  value: string
): Promise<boolean> => {
  if (!isAccountDataStoreActive(account)) return false
  try {
    await account.dataStore.setItem(NOSTR_STORE_ID, key, value)
    return true
  } catch (error) {
    if (isClosedDataStoreError(error)) return false
    throw error
  }
}

export const useNostrIdentity = (): NostrIdentity | null => {
  const [identity, setIdentity] = React.useState(cachedIdentity)
  React.useEffect(() => {
    setIdentity(cachedIdentity)
    return watchIdentity(setIdentity)
  }, [])
  return identity
}

export const getCachedNostrIdentity = (): NostrIdentity | null => cachedIdentity

export const resetNostrStore = (): void => {
  cachedAccountId = null
  cachedIdentity = null
  loadPromise = null
  emitIdentity(null)
}

export const loadNostrStore = async (account: EdgeAccount): Promise<void> => {
  if (!isAccountDataStoreActive(account)) return
  if (cachedAccountId === account.id && loadPromise == null) return
  if (loadPromise != null && cachedAccountId === account.id) {
    await loadPromise
    return
  }

  cachedAccountId = account.id
  const pending = (async () => {
    try {
      const text = await account.dataStore.getItem(
        NOSTR_STORE_ID,
        NOSTR_IDENTITY_KEY
      )
      const identity = asMaybe(asNostrIdentity)(JSON.parse(text))
      emitIdentity(identity ?? null)
    } catch {
      emitIdentity(null)
    }
  })()
  loadPromise = pending
  try {
    await pending
  } finally {
    if (loadPromise === pending) loadPromise = null
  }
}

export const saveNostrIdentity = async (
  account: EdgeAccount,
  identity: NostrIdentity
): Promise<void> => {
  emitIdentity(identity)
  await writeNostrStoreItem(
    account,
    NOSTR_IDENTITY_KEY,
    JSON.stringify(identity)
  )
}
