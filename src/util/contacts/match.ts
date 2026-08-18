import { isValidNpub } from '../nostr/bech32Keys'
import { isNip05Like } from '../nostr/nip05'
import { normalizeForSearch } from '../utils'
import type {
  EdgeContact,
  EdgeContactIdentifier,
  EdgeContactIdentifierType
} from './types'

export const detectIdentifierType = (
  raw: string
): EdgeContactIdentifierType => {
  const trimmed = raw.trim()
  if (isValidNpub(trimmed)) return 'npub'
  if (isNip05Like(trimmed)) return 'nip05'
  return 'address'
}

export const primaryIdentifier = (
  contact: EdgeContact
): EdgeContactIdentifier | undefined => {
  return (
    contact.identifiers.find(item => item.primary === true) ??
    contact.identifiers[0]
  )
}

export const contactMatchesSearch = (
  contact: EdgeContact,
  searchText: string
): boolean => {
  const target = normalizeForSearch(searchText)
  if (target === '') return true
  if (normalizeForSearch(contact.name).includes(target)) return true
  return contact.identifiers.some(item =>
    normalizeForSearch(item.value).includes(target)
  )
}

export const pickContactSendUri = (
  contact: EdgeContact,
  opts: {
    pluginId: string
    isFioOnly?: boolean
  }
): string | undefined => {
  const { pluginId, isFioOnly } = opts
  if (isFioOnly === true) {
    return contact.identifiers.find(item => item.type === 'fio')?.value
  }

  const byPlugin = contact.identifiers.find(
    item => item.type === 'address' && item.pluginId === pluginId
  )
  if (byPlugin != null) return byPlugin.value

  const primary = contact.identifiers.find(
    item =>
      item.type === 'address' &&
      item.primary === true &&
      (item.pluginId == null || item.pluginId === pluginId)
  )
  if (primary != null) return primary.value

  return contact.identifiers.find(item => item.type === 'fio')?.value
}
