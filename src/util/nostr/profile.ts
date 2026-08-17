import { asBoolean, asObject, asOptional, asString } from 'cleaners'
import type { EdgeAccount } from 'edge-core-js'
import * as React from 'react'
import { makeEvent } from 'yavent'

import {
  getCachedMultisigIdentity,
  saveMultisigIdentity
} from '../multisig/store'
import { type NostrIdentity, truncateNpub } from '../multisig/types'
import { bytesToHex, decodeNpub, encodeNpub, hexToBytes } from './bech32Keys'
import {
  getPublicKeyHex,
  type NostrEvent,
  signEvent,
  verifyEvent
} from './events'
import { ensureNostrIdentity } from './identity'
import { lookupNip05PubkeyHex } from './nip05'
import { publishToRelays, queryRelays } from './query'

export interface NostrProfile {
  npub: string
  pubkeyHex: string
  name?: string
  displayName?: string
  nip05?: string
  nip05Verified?: boolean
  about?: string
  updatedAt: number
}

const asKind0Content = asObject({
  name: asOptional(asString),
  display_name: asOptional(asString),
  displayName: asOptional(asString),
  nip05: asOptional(asString),
  about: asOptional(asString),
  bot: asOptional(asBoolean)
})

const profileByNpub = new Map<string, NostrProfile>()
const [watchProfiles, emitProfiles] =
  makeEvent<ReadonlyMap<string, NostrProfile>>()

const upsertProfile = (profile: NostrProfile): void => {
  const prev = profileByNpub.get(profile.npub)
  if (prev != null && prev.updatedAt > profile.updatedAt) return
  profileByNpub.set(profile.npub, profile)
  emitProfiles(new Map(profileByNpub))
}

export const getCachedNostrProfile = (npub: string): NostrProfile | undefined =>
  profileByNpub.get(npub)

export const useNostrProfilesVersion = (): number => {
  const [version, setVersion] = React.useState(0)
  React.useEffect(
    () =>
      watchProfiles(() => {
        setVersion(v => v + 1)
      }),
    []
  )
  return version
}

/** Prefer display name, then name, then NIP-05, else truncated npub. */
export const getNostrDisplayLabel = (npub: string): string => {
  const profile = profileByNpub.get(npub)
  if (profile?.displayName != null && profile.displayName.trim() !== '') {
    return profile.displayName.trim()
  }
  if (profile?.name != null && profile.name.trim() !== '') {
    return profile.name.trim()
  }
  if (profile?.nip05 != null && profile.nip05.trim() !== '') {
    return formatNip05Display(profile.nip05.trim())
  }
  return truncateNpub(npub)
}

export const useNostrDisplayLabel = (npub: string | undefined): string => {
  useNostrProfilesVersion()
  if (npub == null || npub === '') return ''
  return getNostrDisplayLabel(npub)
}

export const formatNip05Display = (nip05: string): string => {
  const trimmed = nip05.trim()
  if (trimmed.startsWith('_@')) return trimmed.slice(2)
  return trimmed
}

export const parseKind0Event = (event: NostrEvent): NostrProfile | null => {
  if (event.kind !== 0) return null
  if (!verifyEvent(event)) return null
  let content: ReturnType<typeof asKind0Content>
  try {
    content = asKind0Content(JSON.parse(event.content))
  } catch {
    return null
  }
  const displayName =
    content.display_name?.trim() !== ''
      ? content.display_name
      : content.displayName?.trim() !== ''
      ? content.displayName
      : undefined
  return {
    npub: encodeNpub(hexToBytes(event.pubkey)),
    pubkeyHex: event.pubkey.toLowerCase(),
    name: content.name?.trim() !== '' ? content.name?.trim() : undefined,
    displayName: displayName?.trim(),
    nip05: content.nip05?.trim() !== '' ? content.nip05?.trim() : undefined,
    about: content.about?.trim() !== '' ? content.about?.trim() : undefined,
    updatedAt: event.created_at
  }
}

export const verifyNip05 = async (
  nip05: string,
  pubkeyHex: string
): Promise<boolean> => {
  try {
    const mapped = await lookupNip05PubkeyHex(nip05)
    return mapped != null && mapped === pubkeyHex.toLowerCase()
  } catch {
    return false
  }
}

export const fetchNostrProfiles = async (npubs: string[]): Promise<void> => {
  const unique = [...new Set(npubs.filter(n => n.trim() !== ''))]
  if (unique.length === 0) return

  const authors = unique.map(npub => bytesToHex(decodeNpub(npub)))
  const events = await queryRelays([
    { kinds: [0], authors, limit: unique.length }
  ])

  // Keep latest kind 0 per pubkey
  const latestByPubkey = new Map<string, NostrEvent>()
  for (const event of events) {
    if (event.kind !== 0) continue
    const prev = latestByPubkey.get(event.pubkey)
    if (prev == null || event.created_at > prev.created_at) {
      latestByPubkey.set(event.pubkey, event)
    }
  }

  await Promise.all(
    [...latestByPubkey.values()].map(async event => {
      const profile = parseKind0Event(event)
      if (profile == null) return
      if (profile.nip05 != null) {
        const mapped = await lookupNip05PubkeyHex(profile.nip05)
        profile.nip05Verified =
          mapped != null && mapped === profile.pubkeyHex.toLowerCase()
      }
      upsertProfile(profile)
    })
  )
}

export const seedProfileFromIdentity = (identity: NostrIdentity): void => {
  if (
    identity.displayName == null &&
    identity.name == null &&
    identity.nip05 == null
  ) {
    return
  }
  upsertProfile({
    npub: identity.npub,
    pubkeyHex: bytesToHex(decodeNpub(identity.npub)),
    displayName: identity.displayName,
    name: identity.name,
    nip05: identity.nip05,
    updatedAt: Math.floor(Date.now() / 1000)
  })
}

export const refreshOwnNostrProfile = async (
  account: EdgeAccount
): Promise<NostrProfile | null> => {
  const identity = await ensureNostrIdentity(account)
  seedProfileFromIdentity(identity)
  await fetchNostrProfiles([identity.npub])
  const remote = getCachedNostrProfile(identity.npub)
  if (remote != null) {
    const next: NostrIdentity = {
      ...identity,
      displayName: remote.displayName ?? identity.displayName,
      name: remote.name ?? identity.name,
      nip05: remote.nip05 ?? identity.nip05
    }
    if (
      next.displayName !== identity.displayName ||
      next.name !== identity.name ||
      next.nip05 !== identity.nip05
    ) {
      await saveMultisigIdentity(account, next)
    }
    return remote
  }
  return getCachedNostrProfile(identity.npub) ?? null
}

export const publishNostrDisplayName = async (
  account: EdgeAccount,
  displayName: string
): Promise<NostrProfile> => {
  const trimmed = displayName.trim()
  if (trimmed === '') {
    throw new Error('Display name cannot be empty')
  }
  const identity = await ensureNostrIdentity(account)
  const seckey = hexToBytes(identity.nsecHex)
  const pubkeyHex = getPublicKeyHex(seckey)
  const existing = getCachedNostrProfile(identity.npub)

  const content = {
    name: existing?.name ?? trimmed,
    display_name: trimmed,
    ...(existing?.nip05 != null ? { nip05: existing.nip05 } : {}),
    ...(existing?.about != null ? { about: existing.about } : {})
  }

  const event = signEvent(
    {
      pubkey: pubkeyHex,
      created_at: Math.floor(Date.now() / 1000),
      kind: 0,
      tags: [],
      content: JSON.stringify(content)
    },
    seckey
  )

  await publishToRelays(event)

  const profile: NostrProfile = {
    npub: identity.npub,
    pubkeyHex,
    name: content.name,
    displayName: trimmed,
    nip05: existing?.nip05,
    nip05Verified: existing?.nip05Verified,
    about: existing?.about,
    updatedAt: event.created_at
  }
  upsertProfile(profile)

  await saveMultisigIdentity(account, {
    ...identity,
    displayName: trimmed,
    name: content.name,
    nip05: existing?.nip05 ?? identity.nip05
  })

  return profile
}

export const getLocalIdentityProfile = (): NostrProfile | null => {
  const identity = getCachedMultisigIdentity()
  if (identity == null) return null
  return (
    getCachedNostrProfile(identity.npub) ?? {
      npub: identity.npub,
      pubkeyHex: bytesToHex(decodeNpub(identity.npub)),
      displayName: identity.displayName,
      name: identity.name,
      nip05: identity.nip05,
      updatedAt: 0
    }
  )
}
