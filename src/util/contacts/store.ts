import { asMaybe } from 'cleaners'
import type { EdgeAccount } from 'edge-core-js'
import * as React from 'react'
import { makeEvent } from 'yavent'

import {
  isAccountDataStoreActive,
  isClosedDataStoreError
} from '../accountDataStore'
import {
  asEdgeContact,
  asEdgeContacts,
  EDGE_CONTACTS_LEGACY_KEY,
  EDGE_CONTACTS_STORE_ID,
  type EdgeContact,
  edgeContactItemId,
  type EdgeContacts,
  isActiveEdgeContact,
  isEdgeContactItemId
} from './types'

let cachedAccountId: string | null = null
let cachedContacts: EdgeContacts = []
let loadPromise: Promise<void> | null = null

const [watchContacts, emitContacts] = makeEvent<EdgeContacts>()

watchContacts(contacts => {
  cachedContacts = contacts
})

export interface LoadEdgeContactsOpts {
  /**
   * Re-read from the encrypted account store even if already cached.
   * Use after login, account sync, or app foreground.
   */
  force?: boolean
}

const sortContacts = (contacts: EdgeContacts): EdgeContacts =>
  [...contacts].sort((a, b) => {
    const byName = a.name.localeCompare(b.name)
    return byName !== 0 ? byName : a.id.localeCompare(b.id)
  })

/**
 * Merge two contact lists by id. When both sides share an id, the contact
 * with the greater `updatedAt` wins (ties prefer `incoming`).
 */
export const mergeEdgeContacts = (
  base: EdgeContacts,
  incoming: EdgeContacts
): EdgeContacts => {
  const map = new Map<string, EdgeContact>()
  for (const contact of base) map.set(contact.id, contact)
  for (const contact of incoming) {
    const existing = map.get(contact.id)
    if (existing == null || contact.updatedAt >= existing.updatedAt) {
      map.set(contact.id, contact)
    }
  }
  return sortContacts([...map.values()].filter(isActiveEdgeContact))
}

const sameContactSet = (a: EdgeContacts, b: EdgeContacts): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].updatedAt !== b[i].updatedAt) return false
  }
  return true
}

const emitIfChanged = (contacts: EdgeContacts): void => {
  const next = sortContacts(contacts)
  if (sameContactSet(cachedContacts, next)) return
  emitContacts(next)
}

const writeContactItem = async (
  account: EdgeAccount,
  contact: EdgeContact
): Promise<boolean> => {
  if (!isAccountDataStoreActive(account)) return false
  try {
    await account.dataStore.setItem(
      EDGE_CONTACTS_STORE_ID,
      edgeContactItemId(contact.id),
      JSON.stringify(contact)
    )
    return true
  } catch (error) {
    if (isClosedDataStoreError(error)) return false
    throw error
  }
}

const pushAccountSync = async (account: EdgeAccount): Promise<void> => {
  try {
    await account.sync()
  } catch {
    // Offline or account closing — tombstone will sync on next cycle.
  }
}

interface ReadResult {
  contacts: EdgeContacts
  hadLegacyKey: boolean
  hasPerContactItems: boolean
}

const readContactsFromStore = async (
  account: EdgeAccount
): Promise<ReadResult> => {
  let itemIds: string[] = []
  try {
    itemIds = await account.dataStore.listItemIds(EDGE_CONTACTS_STORE_ID)
  } catch {
    itemIds = []
  }

  const perContact: EdgeContact[] = []
  let hadLegacyKey = false

  for (const itemId of itemIds) {
    if (itemId === EDGE_CONTACTS_LEGACY_KEY) {
      hadLegacyKey = true
      continue
    }
    if (!isEdgeContactItemId(itemId)) continue
    try {
      const text = await account.dataStore.getItem(
        EDGE_CONTACTS_STORE_ID,
        itemId
      )
      const parsed = asMaybe(asEdgeContact)(JSON.parse(text))
      if (parsed != null && isActiveEdgeContact(parsed)) perContact.push(parsed)
    } catch {
      // Skip malformed items.
    }
  }

  // Per-contact files are authoritative once any exist. A stale legacy blob
  // must not resurrect contacts deleted on another device.
  if (perContact.length > 0) {
    return {
      contacts: sortContacts(perContact),
      hadLegacyKey,
      hasPerContactItems: true
    }
  }

  let legacy: EdgeContacts = []
  try {
    const text = await account.dataStore.getItem(
      EDGE_CONTACTS_STORE_ID,
      EDGE_CONTACTS_LEGACY_KEY
    )
    legacy = (asMaybe(asEdgeContacts)(JSON.parse(text)) ?? []).filter(
      isActiveEdgeContact
    )
    if (legacy.length > 0) hadLegacyKey = true
  } catch {
    // No legacy blob.
  }

  return {
    contacts: sortContacts(legacy),
    hadLegacyKey,
    hasPerContactItems: false
  }
}

const deleteLegacyBlob = async (account: EdgeAccount): Promise<void> => {
  try {
    await account.dataStore.deleteItem(
      EDGE_CONTACTS_STORE_ID,
      EDGE_CONTACTS_LEGACY_KEY
    )
  } catch (error) {
    if (!isClosedDataStoreError(error)) throw error
  }
}

const migrateLegacyContacts = async (
  account: EdgeAccount,
  contacts: EdgeContacts
): Promise<void> => {
  for (const contact of contacts) {
    await writeContactItem(account, contact)
  }
  try {
    await account.dataStore.deleteItem(
      EDGE_CONTACTS_STORE_ID,
      EDGE_CONTACTS_LEGACY_KEY
    )
  } catch (error) {
    if (!isClosedDataStoreError(error)) throw error
  }
}

export const useEdgeContacts = (): EdgeContacts => {
  const [contacts, setContacts] = React.useState(cachedContacts)
  React.useEffect(() => {
    setContacts(cachedContacts)
    return watchContacts(setContacts)
  }, [])
  return contacts
}

export const getCachedEdgeContacts = (): EdgeContacts => cachedContacts

export const resetEdgeContactsStore = (): void => {
  cachedAccountId = null
  cachedContacts = []
  loadPromise = null
  emitContacts([])
}

export const loadEdgeContacts = async (
  account: EdgeAccount,
  opts: LoadEdgeContactsOpts = {}
): Promise<void> => {
  const { force = false } = opts
  if (!isAccountDataStoreActive(account)) return

  if (loadPromise != null && cachedAccountId === account.id) {
    await loadPromise
    if (!force) return
  } else if (!force && cachedAccountId === account.id) {
    return
  }

  cachedAccountId = account.id
  const pending = (async () => {
    const {
      contacts: diskContacts,
      hadLegacyKey,
      hasPerContactItems
    } = await readContactsFromStore(account)

    const next = sortContacts(diskContacts)

    if (hasPerContactItems && hadLegacyKey) {
      await deleteLegacyBlob(account)
    } else if (!hasPerContactItems && next.length > 0) {
      await migrateLegacyContacts(account, next)
    }

    emitIfChanged(next)
  })()

  loadPromise = pending
  try {
    await pending
  } finally {
    if (loadPromise === pending) loadPromise = null
  }
}

/**
 * Force a re-read from the encrypted account store (cross-device sync).
 */
export const reloadEdgeContacts = async (
  account: EdgeAccount
): Promise<void> => {
  await loadEdgeContacts(account, { force: true })
}

/**
 * Sync the account repo, then reload contacts from disk.
 */
export const syncAndReloadEdgeContacts = async (
  account: EdgeAccount
): Promise<void> => {
  await account.waitForAllWallets()
  await account.sync()
  await reloadEdgeContacts(account)
}

export const saveEdgeContact = async (
  account: EdgeAccount,
  contact: EdgeContact
): Promise<EdgeContact> => {
  await loadEdgeContacts(account)
  const now = Date.now()
  const next: EdgeContact = { ...contact, updatedAt: now, deletedAt: undefined }
  const existingIndex = cachedContacts.findIndex(item => item.id === next.id)
  const contacts =
    existingIndex >= 0
      ? cachedContacts.map((item, index) =>
          index === existingIndex ? next : item
        )
      : [...cachedContacts, next]

  emitIfChanged(contacts)
  await writeContactItem(account, next)
  return next
}

export const deleteEdgeContact = async (
  account: EdgeAccount,
  contactId: string
): Promise<void> => {
  await loadEdgeContacts(account)
  const existing = cachedContacts.find(item => item.id === contactId)
  if (existing == null) return

  const now = Date.now()
  const tombstone: EdgeContact = { ...existing, updatedAt: now, deletedAt: now }
  emitIfChanged(cachedContacts.filter(item => item.id !== contactId))
  await writeContactItem(account, tombstone)
  await pushAccountSync(account)
}
