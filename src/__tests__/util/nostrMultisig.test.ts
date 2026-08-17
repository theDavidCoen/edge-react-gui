import { describe, expect, it } from '@jest/globals'
import { schnorr } from '@noble/curves/secp256k1'

import {
  asMultisigSpendCompleteMessage,
  asMultisigSpendPartialMessage,
  asMultisigSpendRejectMessage,
  asMultisigSpendRequestMessage
} from '../../util/multisig/types'
import {
  decodeNpub,
  encodeNpub,
  isValidNpub
} from '../../util/nostr/bech32Keys'
import {
  generateNostrSeckey,
  unwrapGift,
  wrapGift
} from '../../util/nostr/nip17'
import { nip44Decrypt, nip44Encrypt } from '../../util/nostr/nip44'

describe('Nostr multisig crypto', () => {
  it('round-trips NIP-44 payloads', () => {
    const alice = generateNostrSeckey()
    const bob = generateNostrSeckey()
    const bobPub = schnorr.getPublicKey(bob)
    const message = '{"type":"edge-multisig-invite","version":1}'
    const encrypted = nip44Encrypt(message, alice, bobPub)
    const decrypted = nip44Decrypt(encrypted, bob, schnorr.getPublicKey(alice))
    expect(decrypted).toBe(message)
  })

  it('wraps and unwraps NIP-17 gift wraps', () => {
    const alice = generateNostrSeckey()
    const bob = generateNostrSeckey()
    const bobPub = schnorr.getPublicKey(bob)
    const gift = wrapGift('hello-multisig', alice, bobPub)
    expect(gift.kind).toBe(1059)
    const rumor = unwrapGift(gift, bob)
    expect(rumor.content).toBe('hello-multisig')
    expect(rumor.kind).toBe(14)
  })

  it('encodes npub keys', () => {
    const seckey = generateNostrSeckey()
    const npub = encodeNpub(schnorr.getPublicKey(seckey))
    expect(npub.startsWith('npub1')).toBe(true)
    expect(isValidNpub(npub)).toBe(true)
    expect(decodeNpub(npub)).toEqual(schnorr.getPublicKey(seckey))
  })
})

describe('Multisig spend Nostr message cleaners', () => {
  const signers = [
    { npub: 'npub1aaa', status: 'signed' as const },
    { npub: 'npub1bbb', status: 'pending' as const }
  ]

  it('parses spend-request messages', () => {
    const msg = asMultisigSpendRequestMessage({
      type: 'edge-multisig-spend-request',
      version: 1,
      spendId: 'spend-1',
      walletProposalId: 'wallet-1',
      requiredSignatures: 2,
      totalCosigners: 3,
      psbtBase64: 'cHNidP8BAH0C',
      amountNative: '10000',
      destAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      feeNative: '500',
      initiatorNpub: 'npub1aaa',
      signers
    })
    expect(msg.spendId).toBe('spend-1')
    expect(msg.requiredSignatures).toBe(2)
  })

  it('parses spend-partial, reject, and complete messages', () => {
    expect(
      asMultisigSpendPartialMessage({
        type: 'edge-multisig-spend-partial',
        version: 1,
        spendId: 'spend-1',
        walletProposalId: 'wallet-1',
        npub: 'npub1bbb',
        psbtBase64: 'cHNidP8UPDATED',
        signers
      }).psbtBase64
    ).toBe('cHNidP8UPDATED')

    expect(
      asMultisigSpendRejectMessage({
        type: 'edge-multisig-spend-reject',
        version: 1,
        spendId: 'spend-1',
        walletProposalId: 'wallet-1',
        npub: 'npub1bbb'
      }).npub
    ).toBe('npub1bbb')

    expect(
      asMultisigSpendCompleteMessage({
        type: 'edge-multisig-spend-complete',
        version: 1,
        spendId: 'spend-1',
        walletProposalId: 'wallet-1',
        txid: 'ab'.repeat(32),
        psbtBase64: 'cHNidP8FINAL',
        signers
      }).txid
    ).toHaveLength(64)
  })
})
