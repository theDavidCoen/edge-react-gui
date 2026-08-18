import { lstrings } from '../../locales/strings'
import type { EdgeContactIdentifierType } from './types'

export const identifierTypeLabel = (
  type: EdgeContactIdentifierType
): string => {
  switch (type) {
    case 'npub':
      return lstrings.edge_contact_type_npub
    case 'nip05':
      return lstrings.edge_contact_type_nip05
    case 'fio':
      return lstrings.edge_contact_type_fio
    default:
      return lstrings.edge_contact_type_address
  }
}
