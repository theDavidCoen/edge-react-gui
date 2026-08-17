import { schnorr } from '@noble/curves/secp256k1'
import { randomBytes } from '@noble/hashes/utils'

import { getPublicKeyHex, type NostrEvent, signEvent } from './events'
import { nip44Decrypt, nip44Encrypt } from './nip44'

const KIND_RUMOR = 14
const KIND_SEAL = 13
const KIND_GIFT_WRAP = 1059

export interface UnsignedRumor {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

/**
 * NIP-17 private DM: rumor (kind 14) sealed (kind 13) then gift-wrapped
 * (kind 1059) with NIP-44. See NIP-59.
 */
export const wrapGift = (
  content: string,
  senderSeckey: Uint8Array,
  recipientPubkey: Uint8Array
): NostrEvent => {
  const senderPub = getPublicKeyHex(senderSeckey)
  const recipientHex = Array.from(recipientPubkey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  const rumor: UnsignedRumor = {
    pubkey: senderPub,
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_RUMOR,
    tags: [['p', recipientHex]],
    content
  }
  const sealedContent = nip44Encrypt(
    JSON.stringify(rumor),
    senderSeckey,
    recipientPubkey
  )
  const seal = signEvent(
    {
      pubkey: senderPub,
      created_at: Math.floor(Date.now() / 1000),
      kind: KIND_SEAL,
      tags: [],
      content: sealedContent
    },
    senderSeckey
  )

  const wrapSeckey = randomBytes(32)
  const wrapPub = getPublicKeyHex(wrapSeckey)
  const wrappedContent = nip44Encrypt(
    JSON.stringify(seal),
    wrapSeckey,
    recipientPubkey
  )
  return signEvent(
    {
      pubkey: wrapPub,
      created_at: Math.floor(Date.now() / 1000) - (randomBytes(1)[0] % 120),
      kind: KIND_GIFT_WRAP,
      tags: [['p', recipientHex]],
      content: wrappedContent
    },
    wrapSeckey
  )
}

export const unwrapGift = (
  giftWrap: NostrEvent,
  recipientSeckey: Uint8Array
): UnsignedRumor => {
  if (giftWrap.kind !== KIND_GIFT_WRAP) {
    throw new Error('Not a gift wrap')
  }
  const wrapSender = hexToBytes32(giftWrap.pubkey)
  const sealJson = nip44Decrypt(giftWrap.content, recipientSeckey, wrapSender)
  const seal = JSON.parse(sealJson) as NostrEvent
  if (seal.kind !== KIND_SEAL) {
    throw new Error('Not a seal')
  }
  const senderPub = hexToBytes32(seal.pubkey)
  const rumorJson = nip44Decrypt(seal.content, recipientSeckey, senderPub)
  const rumor = JSON.parse(rumorJson) as UnsignedRumor
  if (rumor.kind !== KIND_RUMOR) {
    throw new Error('Not a private message rumor')
  }
  return rumor
}

export const generateNostrSeckey = (): Uint8Array => {
  return schnorr.utils.randomSecretKey()
}

const hexToBytes32 = (hex: string): Uint8Array => {
  const clean = hex.length === 64 ? hex : hex.padStart(64, '0')
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}
