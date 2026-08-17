import { asArray, asMaybe, asNumber, asObject, asString } from 'cleaners'
import type { EdgeAccount } from 'edge-core-js'

import {
  isAccountDataStoreActive,
  isClosedDataStoreError
} from '../multisig/accountActive'
import { MULTISIG_STORE_ID } from '../multisig/types'
import { decodeNpub, hexToBytes } from './bech32Keys'
import { wrapGift } from './nip17'
import type { NostrRelayPool } from './relayPool'

export const PENDING_NOSTR_OUTBOX_KEY = 'pendingNostrOutbox'

export const asNostrOutboxEntry = asObject({
  id: asString,
  targetNpub: asString,
  content: asString,
  nsecHex: asString,
  createdAt: asNumber,
  retryCount: asNumber
})
export type NostrOutboxEntry = ReturnType<typeof asNostrOutboxEntry>

const asOutbox = asArray(asMaybe(asNostrOutboxEntry))

const MAX_OUTBOX = 200

export const outboxBackoffMs = (retryCount: number): number => {
  if (retryCount <= 0) return 0
  return Math.min(60_000, 1000 * 2 ** Math.min(retryCount, 6))
}

export const loadNostrOutbox = async (
  account: EdgeAccount
): Promise<NostrOutboxEntry[]> => {
  try {
    const text = await account.dataStore.getItem(
      MULTISIG_STORE_ID,
      PENDING_NOSTR_OUTBOX_KEY
    )
    const parsed = JSON.parse(text)
    return asOutbox(parsed).filter(
      (item): item is NostrOutboxEntry => item != null
    )
  } catch {
    return []
  }
}

export const saveNostrOutbox = async (
  account: EdgeAccount,
  entries: NostrOutboxEntry[]
): Promise<void> => {
  if (!isAccountDataStoreActive(account)) return
  const trimmed =
    entries.length > MAX_OUTBOX ? entries.slice(-MAX_OUTBOX) : entries
  try {
    await account.dataStore.setItem(
      MULTISIG_STORE_ID,
      PENDING_NOSTR_OUTBOX_KEY,
      JSON.stringify(trimmed)
    )
  } catch (error) {
    if (isClosedDataStoreError(error)) return
    throw error
  }
}

export const enqueueNostrOutbox = async (
  account: EdgeAccount,
  entry: {
    targetNpub: string
    content: string
    nsecHex: string
  }
): Promise<void> => {
  const existing = await loadNostrOutbox(account)
  const duplicate = existing.some(
    item =>
      item.targetNpub === entry.targetNpub && item.content === entry.content
  )
  if (duplicate) return
  const next: NostrOutboxEntry = {
    id: `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`,
    targetNpub: entry.targetNpub,
    content: entry.content,
    nsecHex: entry.nsecHex,
    createdAt: Date.now(),
    retryCount: 0
  }
  await saveNostrOutbox(account, [...existing, next])
}

export const flushNostrOutbox = async (
  account: EdgeAccount,
  pool: NostrRelayPool
): Promise<number> => {
  const entries = await loadNostrOutbox(account)
  if (entries.length === 0) return 0

  const now = Date.now()
  const remaining: NostrOutboxEntry[] = []
  let flushed = 0

  for (const entry of entries) {
    const waitUntil = entry.createdAt + outboxBackoffMs(entry.retryCount)
    if (now < waitUntil) {
      remaining.push(entry)
      continue
    }
    try {
      const seckey = hexToBytes(entry.nsecHex)
      const event = wrapGift(
        entry.content,
        seckey,
        decodeNpub(entry.targetNpub)
      )
      await pool.publish(event)
      flushed++
    } catch {
      remaining.push({
        ...entry,
        retryCount: entry.retryCount + 1,
        createdAt: Date.now()
      })
    }
  }

  await saveNostrOutbox(account, remaining)
  return flushed
}
