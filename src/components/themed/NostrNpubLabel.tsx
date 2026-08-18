import * as React from 'react'

import { isValidNpub } from '../../util/nostr/bech32Keys'
import {
  fetchNostrProfiles,
  getCachedNostrProfile,
  getNostrDisplayLabel,
  useNostrDisplayLabel,
  useNostrProfilesVersion
} from '../../util/nostr/profile'

interface Props {
  npub: string | undefined
  /** Fallback when npub is missing (e.g. truncated xpub). */
  fallback?: string
}

/**
 * Resolves a Nostr display label for an npub (display name / NIP-05 / truncated).
 * Prefetches kind-0 metadata when the npub is first shown.
 */
export const useResolvedNostrLabel = (
  npub: string | undefined,
  fallback?: string
): string => {
  useNostrProfilesVersion()
  React.useEffect(() => {
    if (npub == null || npub === '' || !isValidNpub(npub)) return
    if (getCachedNostrProfile(npub) != null) return
    fetchNostrProfiles([npub]).catch(() => {})
  }, [npub])

  const label = useNostrDisplayLabel(npub)
  if (npub == null || npub === '') return fallback ?? ''
  return label
}

export const NostrNpubLabel: React.FC<Props> = props => {
  const { npub, fallback } = props
  const label = useResolvedNostrLabel(npub, fallback)
  return <>{label}</>
}

/** True when we have a profile name/nip05 rather than only a truncated npub. */
export const hasNostrFriendlyLabel = (npub: string): boolean => {
  const profile = getCachedNostrProfile(npub)
  if (profile == null) return false
  return (
    (profile.displayName != null && profile.displayName.trim() !== '') ||
    (profile.name != null && profile.name.trim() !== '') ||
    (profile.nip05 != null && profile.nip05.trim() !== '')
  )
}

export const getNpubOrLabel = (npub: string): string =>
  getNostrDisplayLabel(npub)
