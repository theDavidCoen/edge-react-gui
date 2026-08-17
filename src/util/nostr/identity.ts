import { schnorr } from '@noble/curves/secp256k1'
import { bytesToHex } from '@noble/hashes/utils'
import type { EdgeAccount } from 'edge-core-js'

import {
  getCachedMultisigIdentity,
  loadMultisigStore,
  saveMultisigIdentity
} from '../multisig/store'
import type { NostrIdentity } from '../multisig/types'
import { decodeNsec, encodeNpub } from './bech32Keys'

export const ensureNostrIdentity = async (
  account: EdgeAccount
): Promise<NostrIdentity> => {
  await loadMultisigStore(account)
  const existing = getCachedMultisigIdentity()
  if (existing != null) return existing

  const seckey = schnorr.utils.randomSecretKey()
  const identity: NostrIdentity = {
    nsecHex: bytesToHex(seckey),
    npub: encodeNpub(schnorr.getPublicKey(seckey)),
    displayName: undefined,
    name: undefined,
    nip05: undefined
  }
  await saveMultisigIdentity(account, identity)
  return identity
}

/**
 * Replace the Edge-generated (or previously imported) Nostr identity with an
 * existing nsec. Used everywhere Multisig/Nostr identity is read from store.
 */
export const importNostrIdentity = async (
  account: EdgeAccount,
  nsec: string
): Promise<NostrIdentity> => {
  await loadMultisigStore(account)
  const seckey = decodeNsec(nsec)
  const identity: NostrIdentity = {
    nsecHex: bytesToHex(seckey),
    npub: encodeNpub(schnorr.getPublicKey(seckey)),
    displayName: undefined,
    name: undefined,
    nip05: undefined
  }
  await saveMultisigIdentity(account, identity)
  return identity
}
