import { beforeEach, describe, expect, it } from '@jest/globals'
import type { EdgeAccount } from 'edge-core-js'

import {
  contactMatchesSearch,
  detectIdentifierType,
  pickContactSendUri
} from '../../util/contacts/match'
import {
  getCachedEdgeContacts,
  loadEdgeContacts,
  resetEdgeContactsStore,
  saveEdgeContact
} from '../../util/contacts/store'
import type { EdgeContact } from '../../util/contacts/types'
import { encodeNpub, hexToBytes } from '../../util/nostr/bech32Keys'

const makeAccount = (): EdgeAccount => {
  const stores = new Map<string, Map<string, string>>()
  return {
    id: 'account-1',
    loggedIn: true,
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
      }
    }
  } as unknown as EdgeAccount
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
  createdAt: 1,
  updatedAt: 1
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

describe('edge contacts store', () => {
  beforeEach(() => {
    resetEdgeContactsStore()
  })

  it('saves and reloads contacts from the encrypted account store', async () => {
    const account = makeAccount()
    const saved = await saveEdgeContact(
      account,
      contact({ name: 'Alice', id: 'alice-1' })
    )
    expect(saved.name).toBe('Alice')

    resetEdgeContactsStore()
    await loadEdgeContacts(account)
    expect(getCachedEdgeContacts().map(item => item.name)).toEqual(['Alice'])
  })
})
