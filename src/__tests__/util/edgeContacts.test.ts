import { beforeEach, describe, expect, it } from '@jest/globals'
import type { EdgeAccount } from 'edge-core-js'

import {
  contactMatchesSearch,
  detectIdentifierType,
  pickContactSendUri
} from '../../util/contacts/match'
import {
  deleteEdgeContact,
  getCachedEdgeContacts,
  loadEdgeContacts,
  mergeEdgeContacts,
  reloadEdgeContacts,
  resetEdgeContactsStore,
  saveEdgeContact
} from '../../util/contacts/store'
import {
  EDGE_CONTACTS_LEGACY_KEY,
  EDGE_CONTACTS_STORE_ID,
  type EdgeContact,
  edgeContactItemId
} from '../../util/contacts/types'
import { encodeNpub, hexToBytes } from '../../util/nostr/bech32Keys'

const makeAccount = (): EdgeAccount & {
  _stores: Map<string, Map<string, string>>
} => {
  const stores = new Map<string, Map<string, string>>()
  return {
    id: 'account-1',
    loggedIn: true,
    _stores: stores,
    sync: async () => {},
    dataStore: {
      getItem: async (storeId: string, itemId: string) => {
        const value = stores.get(storeId)?.get(itemId)
        if (value == null) throw new Error('missing')
        return value
      },
      setItem: async (storeId: string, itemId: string, value: string) => {
        let store = stores.get(storeId)
        if (store == null) {
          store = new Map()
          stores.set(storeId, store)
        }
        store.set(itemId, value)
      },
      deleteItem: async (storeId: string, itemId: string) => {
        stores.get(storeId)?.delete(itemId)
      },
      listItemIds: async (storeId: string) => {
        const store = stores.get(storeId)
        return store == null ? [] : [...store.keys()]
      }
    }
  } as unknown as EdgeAccount & {
    _stores: Map<string, Map<string, string>>
  }
}

const contact = (
  partial: Partial<EdgeContact> & { name: string }
): EdgeContact => ({
  id: partial.id ?? 'c1',
  name: partial.name,
  identifiers: partial.identifiers ?? [
    {
      id: 'i1',
      type: 'address',
      value: 'bc1qexample',
      pluginId: 'bitcoin',
      primary: true
    }
  ],
  createdAt: partial.createdAt ?? 1,
  updatedAt: partial.updatedAt ?? 1,
  deletedAt: partial.deletedAt
})

describe('detectIdentifierType', () => {
  it('detects npub and nip05, otherwise address', () => {
    const npub = encodeNpub(
      hexToBytes(
        '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'
      )
    )
    expect(detectIdentifierType(npub)).toBe('npub')
    expect(detectIdentifierType('alice@edge.app')).toBe('nip05')
    expect(detectIdentifierType('bc1qxyz')).toBe('address')
  })
})

describe('contactMatchesSearch', () => {
  it('matches name and identifier values', () => {
    const marco = contact({ name: 'Marco' })
    expect(contactMatchesSearch(marco, 'mar')).toBe(true)
    expect(contactMatchesSearch(marco, 'bc1q')).toBe(true)
    expect(contactMatchesSearch(marco, 'alice')).toBe(false)
  })
})

describe('pickContactSendUri', () => {
  it('prefers a matching plugin address, then FIO', () => {
    const mixed = contact({
      name: 'Marco',
      identifiers: [
        {
          id: 'n1',
          type: 'nip05',
          value: 'marco@example.com',
          primary: true
        },
        {
          id: 'b1',
          type: 'address',
          value: 'bc1qmarco',
          pluginId: 'bitcoin'
        },
        { id: 'f1', type: 'fio', value: 'marco@edge' }
      ]
    })
    expect(pickContactSendUri(mixed, { pluginId: 'bitcoin' })).toBe('bc1qmarco')
    expect(
      pickContactSendUri(mixed, { pluginId: 'ethereum', isFioOnly: true })
    ).toBe('marco@edge')
    expect(pickContactSendUri(mixed, { pluginId: 'ethereum' })).toBe(
      'marco@edge'
    )
  })
})

describe('mergeEdgeContacts', () => {
  it('keeps the newer updatedAt when ids collide', () => {
    const older = contact({ id: 'a', name: 'Old', updatedAt: 1 })
    const newer = contact({ id: 'a', name: 'New', updatedAt: 2 })
    const other = contact({ id: 'b', name: 'Bob', updatedAt: 1 })
    expect(mergeEdgeContacts([older, other], [newer]).map(c => c.name)).toEqual(
      ['Bob', 'New']
    )
  })

  it('drops contacts when a newer tombstone wins', () => {
    const live = contact({ id: 'a', name: 'Live', updatedAt: 1 })
    const tombstone = contact({
      id: 'a',
      name: 'Live',
      updatedAt: 5,
      deletedAt: 5
    })
    expect(mergeEdgeContacts([live], [tombstone])).toEqual([])
  })
})

describe('edge contacts store', () => {
  beforeEach(() => {
    resetEdgeContactsStore()
  })

  it('saves contacts as per-id items and reloads them', async () => {
    const account = makeAccount()
    const saved = await saveEdgeContact(
      account,
      contact({ name: 'Alice', id: 'alice-1' })
    )
    expect(saved.name).toBe('Alice')

    const store = account._stores.get(EDGE_CONTACTS_STORE_ID)
    expect(store?.has(edgeContactItemId('alice-1'))).toBe(true)
    expect(store?.has(EDGE_CONTACTS_LEGACY_KEY)).toBe(false)

    resetEdgeContactsStore()
    await loadEdgeContacts(account)
    expect(getCachedEdgeContacts().map(item => item.name)).toEqual(['Alice'])
  })

  it('ignores a stale legacy blob when per-contact items exist', async () => {
    const account = makeAccount()
    await account.dataStore.setItem(
      EDGE_CONTACTS_STORE_ID,
      EDGE_CONTACTS_LEGACY_KEY,
      JSON.stringify([
        contact({ id: 'legacy-1', name: 'Legacy', updatedAt: 5 }),
        contact({ id: 'ghost', name: 'Ghost', updatedAt: 5 })
      ])
    )
    await account.dataStore.setItem(
      EDGE_CONTACTS_STORE_ID,
      edgeContactItemId('legacy-1'),
      JSON.stringify(contact({ id: 'legacy-1', name: 'Legacy', updatedAt: 5 }))
    )

    await loadEdgeContacts(account, { force: true })
    expect(getCachedEdgeContacts().map(item => item.name)).toEqual(['Legacy'])
    expect(
      account._stores.get(EDGE_CONTACTS_STORE_ID)?.has(EDGE_CONTACTS_LEGACY_KEY)
    ).toBe(false)
  })

  it('migrates the legacy contacts blob to per-id items', async () => {
    const account = makeAccount()
    await account.dataStore.setItem(
      EDGE_CONTACTS_STORE_ID,
      EDGE_CONTACTS_LEGACY_KEY,
      JSON.stringify([
        contact({ id: 'legacy-1', name: 'Legacy', updatedAt: 5 })
      ])
    )

    await loadEdgeContacts(account, { force: true })
    expect(getCachedEdgeContacts().map(item => item.name)).toEqual(['Legacy'])

    const store = account._stores.get(EDGE_CONTACTS_STORE_ID)
    expect(store?.has(edgeContactItemId('legacy-1'))).toBe(true)
    expect(store?.has(EDGE_CONTACTS_LEGACY_KEY)).toBe(false)
  })

  it('force reload replaces cache with disk (cross-device deletes stick)', async () => {
    const account = makeAccount()
    await saveEdgeContact(
      account,
      contact({ id: 'keep', name: 'Keep', updatedAt: 2 })
    )
    await saveEdgeContact(
      account,
      contact({ id: 'gone', name: 'Gone', updatedAt: 2 })
    )

    // Another device tombstoned "gone" and added "remote":
    await account.dataStore.setItem(
      EDGE_CONTACTS_STORE_ID,
      edgeContactItemId('gone'),
      JSON.stringify(
        contact({ id: 'gone', name: 'Gone', updatedAt: 99, deletedAt: 99 })
      )
    )
    await account.dataStore.setItem(
      EDGE_CONTACTS_STORE_ID,
      edgeContactItemId('remote'),
      JSON.stringify(contact({ id: 'remote', name: 'Remote', updatedAt: 3 }))
    )

    await reloadEdgeContacts(account)
    expect(
      getCachedEdgeContacts()
        .map(item => item.name)
        .sort()
    ).toEqual(['Keep', 'Remote'])
  })

  it('writes a syncable tombstone instead of hard-deleting', async () => {
    const account = makeAccount()
    await saveEdgeContact(account, contact({ id: 'gone', name: 'Gone' }))
    await deleteEdgeContact(account, 'gone')
    expect(getCachedEdgeContacts()).toEqual([])
    const raw = account._stores
      .get(EDGE_CONTACTS_STORE_ID)
      ?.get(edgeContactItemId('gone'))
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw ?? '')
    expect(parsed.deletedAt).toBeGreaterThan(0)
  })

  it('hides tombstoned contacts after reload', async () => {
    const account = makeAccount()
    await saveEdgeContact(account, contact({ id: 'gone', name: 'Gone' }))
    await deleteEdgeContact(account, 'gone')

    resetEdgeContactsStore()
    await reloadEdgeContacts(account)
    expect(getCachedEdgeContacts()).toEqual([])
  })
})
