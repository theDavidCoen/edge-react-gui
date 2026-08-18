import { schnorr } from '@noble/curves/secp256k1'
import { bytesToHex } from '@noble/hashes/utils'
import type { EdgeAccount } from 'edge-core-js'

import { decodeNsec, encodeNpub } from './bech32Keys'
import {
  getCachedNostrIdentity,
  loadNostrStore,
  saveNostrIdentity
} from './store'
import type { NostrIdentity } from './types'

export const ensureNostrIdentity = async (
  account: EdgeAccount
): Promise<NostrIdentity> => {
  await loadNostrStore(account)
  const existing = getCachedNostrIdentity()
  if (existing != null) return existing

  const seckey = schnorr.utils.randomSecretKey()
  const identity: NostrIdentity = {
    nsecHex: bytesToHex(seckey),
    npub: encodeNpub(schnorr.getPublicKey(seckey)),
    displayName: undefined,
    name: undefined,
    nip05: undefined
  }
  await saveNostrIdentity(account, identity)
  return identity
}

/**
 * Replace the Edge-generated (or previously imported) Nostr identity with an
 * existing nsec.
 */
export const importNostrIdentity = async (
  account: EdgeAccount,
  nsec: string
): Promise<NostrIdentity> => {
  await loadNostrStore(account)
  const seckey = decodeNsec(nsec)
  const identity: NostrIdentity = {
    nsecHex: bytesToHex(seckey),
    npub: encodeNpub(schnorr.getPublicKey(seckey)),
    displayName: undefined,
    name: undefined,
    nip05: undefined
  }
  await saveNostrIdentity(account, identity)
  return identity
}
