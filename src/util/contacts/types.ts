import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'

export const EDGE_CONTACTS_STORE_ID = 'edgeContacts'

/** Legacy single-blob key used before per-contact items. */
export const EDGE_CONTACTS_LEGACY_KEY = 'contacts'

export const EDGE_CONTACT_ITEM_PREFIX = 'contact:'

export const edgeContactItemId = (contactId: string): string =>
  `${EDGE_CONTACT_ITEM_PREFIX}${contactId}`

export const isEdgeContactItemId = (itemId: string): boolean =>
  itemId.startsWith(EDGE_CONTACT_ITEM_PREFIX)

export const asEdgeContactIdentifierType = asValue(
  'address',
  'npub',
  'nip05',
  'fio'
)
export type EdgeContactIdentifierType = ReturnType<
  typeof asEdgeContactIdentifierType
>

export const asEdgeContactIdentifier = asObject({
  id: asString,
  type: asEdgeContactIdentifierType,
  value: asString,
  pluginId: asOptional(asString),
  currencyCode: asOptional(asString),
  primary: asOptional(asBoolean)
})
export interface EdgeContactIdentifier {
  id: string
  type: EdgeContactIdentifierType
  value: string
  pluginId?: string
  currencyCode?: string
  primary?: boolean
}

export const asEdgeContact = asObject({
  id: asString,
  name: asString,
  identifiers: asArray(asEdgeContactIdentifier),
  createdAt: asNumber,
  updatedAt: asNumber
})
export interface EdgeContact {
  id: string
  name: string
  identifiers: EdgeContactIdentifier[]
  createdAt: number
  updatedAt: number
}

export const asEdgeContacts = asArray(asEdgeContact)
export type EdgeContacts = EdgeContact[]
