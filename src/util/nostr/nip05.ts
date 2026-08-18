import { asMaybe, asObject, asString } from 'cleaners'

import { encodeNpub, hexToBytes, isValidNpub } from './bech32Keys'

export interface Nip05Parts {
  local: string
  domain: string
  identifier: string
}

const LOCAL_RE = /^[a-z0-9-_.]+$/
const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/**
 * Parse a NIP-05 identifier (`name@domain` or `domain` → `_@domain`).
 * npub / nprofile strings are rejected.
 */
export const parseNip05Identifier = (raw: string): Nip05Parts | undefined => {
  const trimmed = raw.trim().replace(/^@+/, '')
  if (trimmed === '') return undefined
  if (isValidNpub(trimmed)) return undefined
  if (/^n(pub|profile|event|addr|sec)1/i.test(trimmed)) return undefined

  let local: string
  let domain: string
  const at = trimmed.lastIndexOf('@')
  if (at < 0) {
    domain = trimmed.toLowerCase()
    local = '_'
  } else {
    local = trimmed.slice(0, at).toLowerCase()
    domain = trimmed.slice(at + 1).toLowerCase()
  }
  if (local === '' || domain === '') return undefined
  if (!LOCAL_RE.test(local) || !DOMAIN_RE.test(domain)) return undefined
  return { local, domain, identifier: `${local}@${domain}` }
}

export const isNip05Like = (raw: string): boolean =>
  parseNip05Identifier(raw) != null

const asNamesMap = asMaybe(asObject(asString))

/** HTTPS well-known lookup (NIP-05). Returns lowercase 32-byte pubkey hex. */
export const lookupNip05PubkeyHex = async (
  raw: string
): Promise<string | undefined> => {
  const parts = parseNip05Identifier(raw)
  if (parts == null) return undefined
  const url = `https://${
    parts.domain
  }/.well-known/nostr.json?name=${encodeURIComponent(parts.local)}`
  const response = await fetch(url, { redirect: 'manual' })
  if (response.status < 200 || response.status >= 300) return undefined
  const json: unknown = await response.json()
  const names = asNamesMap((json as { names?: unknown }).names)
  if (names == null) return undefined
  const mapped = names[parts.local]
  if (mapped == null || !/^[0-9a-f]{64}$/i.test(mapped)) return undefined
  return mapped.toLowerCase()
}

export const resolveNip05ToNpub = async (raw: string): Promise<string> => {
  const hex = await lookupNip05PubkeyHex(raw)
  if (hex == null) {
    throw new Error('NIP05_NOT_FOUND')
  }
  return encodeNpub(hexToBytes(hex))
}

export const resolveNostrInput = async (
  raw: string
): Promise<{ npub: string; nip05?: string }> => {
  const trimmed = raw.trim()
  if (isValidNpub(trimmed)) return { npub: trimmed }
  const parts = parseNip05Identifier(trimmed)
  if (parts == null) {
    throw new Error('INVALID_NOSTR_ID')
  }
  const npub = await resolveNip05ToNpub(trimmed)
  return { npub, nip05: parts.identifier }
}
