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
  return sortContacts([...map.values()])
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

const deleteContactItem = async (
  account: EdgeAccount,
  contactId: string
): Promise<boolean> => {
  if (!isAccountDataStoreActive(account)) return false
  try {
    await account.dataStore.deleteItem(
      EDGE_CONTACTS_STORE_ID,
      edgeContactItemId(contactId)
    )
    return true
  } catch (error) {
    if (isClosedDataStoreError(error)) return false
    throw error
  }
}

interface ReadResult {
  contacts: EdgeContacts
  hadLegacy: boolean
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
  let hadLegacy = false

  for (const itemId of itemIds) {
    if (itemId === EDGE_CONTACTS_LEGACY_KEY) {
      hadLegacy = true
      continue
    }
    if (!isEdgeContactItemId(itemId)) continue
    try {
      const text = await account.dataStore.getItem(
        EDGE_CONTACTS_STORE_ID,
        itemId
      )
      const parsed = asMaybe(asEdgeContact)(JSON.parse(text))
      if (parsed != null) perContact.push(parsed)
    } catch {
      // Skip malformed items.
    }
  }

  let legacy: EdgeContacts = []
  if (hadLegacy || itemIds.length === 0) {
    try {
      const text = await account.dataStore.getItem(
        EDGE_CONTACTS_STORE_ID,
        EDGE_CONTACTS_LEGACY_KEY
      )
      legacy = asMaybe(asEdgeContacts)(JSON.parse(text)) ?? []
      if (legacy.length > 0) hadLegacy = true
    } catch {
      // No legacy blob.
    }
  }

  return {
    contacts: mergeEdgeContacts(perContact, legacy),
    hadLegacy
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
    const { contacts: diskContacts, hadLegacy } = await readContactsFromStore(
      account
    )

    // Disk (post-sync) is authoritative for membership so deletes from other
    // devices stick. Per-item files already last-write-win on conflicts.
    const next = sortContacts(diskContacts)

    if (hadLegacy) {
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

export const saveEdgeContact = async (
  account: EdgeAccount,
  contact: EdgeContact
): Promise<EdgeContact> => {
  await loadEdgeContacts(account)
  const now = Date.now()
  const next: EdgeContact = { ...contact, updatedAt: now }
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
  emitIfChanged(cachedContacts.filter(item => item.id !== contactId))
  await deleteContactItem(account, contactId)
}
