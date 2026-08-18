import { asMaybe } from 'cleaners'
import type { EdgeAccount } from 'edge-core-js'
import * as React from 'react'
import { makeEvent } from 'yavent'

import {
  isAccountDataStoreActive,
  isClosedDataStoreError
} from '../accountDataStore'
import {
  asEdgeContacts,
  EDGE_CONTACTS_KEY,
  EDGE_CONTACTS_STORE_ID,
  type EdgeContact,
  type EdgeContacts
} from './types'

let cachedAccountId: string | null = null
let cachedContacts: EdgeContacts = []
let loadPromise: Promise<void> | null = null

const [watchContacts, emitContacts] = makeEvent<EdgeContacts>()

watchContacts(contacts => {
  cachedContacts = contacts
})

const writeContacts = async (
  account: EdgeAccount,
  contacts: EdgeContacts
): Promise<boolean> => {
  if (!isAccountDataStoreActive(account)) return false
  try {
    await account.dataStore.setItem(
      EDGE_CONTACTS_STORE_ID,
      EDGE_CONTACTS_KEY,
      JSON.stringify(contacts)
    )
    return true
  } catch (error) {
    if (isClosedDataStoreError(error)) return false
    throw error
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

export const loadEdgeContacts = async (account: EdgeAccount): Promise<void> => {
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
        EDGE_CONTACTS_STORE_ID,
        EDGE_CONTACTS_KEY
      )
      const parsed = asMaybe(asEdgeContacts)(JSON.parse(text))
      emitContacts(parsed ?? [])
    } catch {
      emitContacts([])
    }
  })()
  loadPromise = pending
  try {
    await pending
  } finally {
    if (loadPromise === pending) loadPromise = null
  }
}

const persist = async (
  account: EdgeAccount,
  contacts: EdgeContacts
): Promise<void> => {
  emitContacts(contacts)
  await writeContacts(account, contacts)
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
  await persist(account, contacts)
  return next
}

export const deleteEdgeContact = async (
  account: EdgeAccount,
  contactId: string
): Promise<void> => {
  await loadEdgeContacts(account)
  await persist(
    account,
    cachedContacts.filter(item => item.id !== contactId)
  )
}
