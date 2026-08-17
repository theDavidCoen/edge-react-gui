import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils'

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export type UnsignedNostrEvent = Omit<NostrEvent, 'id' | 'sig'>

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

export const randomizedCreatedAt = (): number => {
  const skew = randomBytes(2)
  const maxSkew = 2 * 24 * 60 * 60
  return nowSeconds() - (((skew[0] << 8) | skew[1]) % maxSkew)
}

export const serializeEvent = (event: UnsignedNostrEvent): string =>
  JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ])

export const getEventHash = (event: UnsignedNostrEvent): string =>
  bytesToHex(sha256(utf8ToBytes(serializeEvent(event))))

export const signEvent = (
  unsigned: UnsignedNostrEvent,
  seckey: Uint8Array
): NostrEvent => {
  const id = getEventHash(unsigned)
  const sig = bytesToHex(schnorr.sign(id, seckey))
  return { ...unsigned, id, sig }
}

export const verifyEvent = (event: NostrEvent): boolean => {
  try {
    const unsigned: UnsignedNostrEvent = {
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content
    }
    if (getEventHash(unsigned) !== event.id) return false
    return schnorr.verify(event.sig, event.id, event.pubkey)
  } catch {
    return false
  }
}

export const getPublicKeyHex = (seckey: Uint8Array): string =>
  bytesToHex(schnorr.getPublicKey(seckey))
