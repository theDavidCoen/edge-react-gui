import { asObject, asOptional, asString } from 'cleaners'

export const NOSTR_STORE_ID = 'edgeNostr'
export const NOSTR_IDENTITY_KEY = 'identity'

export const asNostrIdentity = asObject({
  nsecHex: asString,
  npub: asString,
  displayName: asOptional(asString),
  name: asOptional(asString),
  nip05: asOptional(asString)
})

export interface NostrIdentity {
  nsecHex: string
  npub: string
  displayName?: string
  name?: string
  nip05?: string
}

export const truncateNpub = (npub: string, head = 12, tail = 6): string => {
  if (npub.length <= head + tail + 1) return npub
  return `${npub.slice(0, head)}…${npub.slice(-tail)}`
}
