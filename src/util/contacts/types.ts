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
export const EDGE_CONTACTS_KEY = 'contacts'

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
