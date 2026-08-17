import { describe, expect, it, jest } from '@jest/globals'

import { encodeNpub, hexToBytes } from '../../util/nostr/bech32Keys'
import {
  isNip05Like,
  parseNip05Identifier,
  resolveCosignerNostrInput,
  resolveNip05ToNpub
} from '../../util/nostr/nip05'

const PUBKEY_HEX =
  '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'
const NPUB = encodeNpub(hexToBytes(PUBKEY_HEX))

describe('parseNip05Identifier', () => {
  it('parses name@domain', () => {
    expect(parseNip05Identifier('Alice@Edge.app')).toEqual({
      local: 'alice',
      domain: 'edge.app',
      identifier: 'alice@edge.app'
    })
  })

  it('maps a bare domain to _@domain', () => {
    expect(parseNip05Identifier('nostrich.social')).toEqual({
      local: '_',
      domain: 'nostrich.social',
      identifier: '_@nostrich.social'
    })
  })

  it('rejects npubs and garbage', () => {
    expect(parseNip05Identifier(NPUB)).toBeUndefined()
    expect(parseNip05Identifier('not an identifier')).toBeUndefined()
    expect(isNip05Like('hello')).toBe(false)
    expect(isNip05Like('bob@nostrich.social')).toBe(true)
  })
})

describe('resolveNip05ToNpub', () => {
  it('reads the pubkey from well-known nostr.json', async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      status: 200,
      json: async () => ({ names: { bob: PUBKEY_HEX } })
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(resolveNip05ToNpub('bob@nostrich.social')).resolves.toBe(NPUB)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://nostrich.social/.well-known/nostr.json?name=bob',
      { redirect: 'manual' }
    )
  })

  it('throws when the name is missing', async () => {
    global.fetch = jest.fn(async () => ({
      status: 200,
      json: async () => ({ names: {} })
    })) as unknown as typeof fetch
    await expect(resolveNip05ToNpub('bob@nostrich.social')).rejects.toThrow(
      'NIP05_NOT_FOUND'
    )
  })
})

describe('resolveCosignerNostrInput', () => {
  it('passes through a valid npub', async () => {
    await expect(resolveCosignerNostrInput(NPUB)).resolves.toEqual({
      npub: NPUB
    })
  })
})
