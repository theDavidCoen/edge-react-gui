import type { EdgeAccount } from 'edge-core-js'
import * as React from 'react'
import { View } from 'react-native'
import type { AirshipBridge } from 'react-native-airship'
import { sprintf } from 'sprintf-js'
import { v4 as uuidv4 } from 'uuid'

import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import { identifierTypeLabel } from '../../util/contacts/labels'
import { detectIdentifierType } from '../../util/contacts/match'
import { saveEdgeContact } from '../../util/contacts/store'
import type {
  EdgeContact,
  EdgeContactIdentifier,
  EdgeContactIdentifierType
} from '../../util/contacts/types'
import { isValidNpub } from '../../util/nostr/bech32Keys'
import { isNip05Like } from '../../util/nostr/nip05'
import { DropdownInputButton } from '../buttons/DropdownInputButton'
import { EdgeButton } from '../buttons/EdgeButton'
import { EdgeCard } from '../cards/EdgeCard'
import { ShieldCheckmarkIcon } from '../icons/ThemedIcons'
import { Space } from '../layout/Space'
import { Airship, showError, showToast } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText, SmallText } from '../themed/EdgeText'
import { ModalFilledTextInput } from '../themed/FilledTextInput'
import { SelectableRow } from '../themed/SelectableRow'
import { EdgeModal } from './EdgeModal'
import { ListModal } from './ListModal'

interface DraftIdentifier {
  id: string
  type: EdgeContactIdentifierType
  value: string
}

interface Props {
  bridge: AirshipBridge<EdgeContact | undefined>
  account: EdgeAccount
  pluginId?: string
  currencyCode?: string
}

const IDENTIFIER_TYPES: EdgeContactIdentifierType[] = [
  'address',
  'npub',
  'nip05',
  'fio'
]

const makeDraft = (): DraftIdentifier => ({
  id: uuidv4(),
  type: 'address',
  value: ''
})

export const EditEdgeContactModal: React.FC<Props> = props => {
  const { bridge, account, pluginId, currencyCode } = props
  const theme = useTheme()
  const styles = getStyles(theme)

  const [name, setName] = React.useState('')
  const [identifiers, setIdentifiers] = React.useState<DraftIdentifier[]>([
    makeDraft()
  ])
  const [saving, setSaving] = React.useState(false)

  const handleCancel = useHandler(() => {
    bridge.resolve(undefined)
  })

  const handleChangeType = useHandler(async (id: string) => {
    const selected = await Airship.show<EdgeContactIdentifierType | undefined>(
      typeBridge => (
        <ListModal
          bridge={typeBridge}
          title={lstrings.edge_contact_type}
          textInput={false}
          rowsData={IDENTIFIER_TYPES}
          rowComponent={(type: EdgeContactIdentifierType) => (
            <SelectableRow
              title={identifierTypeLabel(type)}
              onPress={() => {
                typeBridge.resolve(type)
              }}
            />
          )}
        />
      )
    )
    if (selected == null) return
    setIdentifiers(current =>
      current.map(item => (item.id === id ? { ...item, type: selected } : item))
    )
  })

  const handleChangeValue = useHandler((id: string, value: string) => {
    setIdentifiers(current =>
      current.map(item => {
        if (item.id !== id) return item
        const detected = detectIdentifierType(value)
        const type =
          item.value === '' && value !== '' && item.type === 'address'
            ? detected
            : item.type
        return { ...item, value, type }
      })
    )
  })

  const handleAddIdentifier = useHandler(() => {
    setIdentifiers(current => [...current, makeDraft()])
  })

  const handleSave = useHandler(async () => {
    const trimmedName = name.trim()
    if (trimmedName === '') {
      showToast(lstrings.edge_contact_name_required)
      return
    }

    const cleaned: EdgeContactIdentifier[] = []
    for (const item of identifiers) {
      const value = item.value.trim()
      if (value === '') continue
      if (item.type === 'npub' && !isValidNpub(value)) {
        showError(lstrings.edge_contact_invalid_npub)
        return
      }
      if (item.type === 'nip05' && !isNip05Like(value)) {
        showError(lstrings.edge_contact_invalid_nip05)
        return
      }
      cleaned.push({
        id: item.id,
        type: item.type,
        value,
        pluginId: item.type === 'address' ? pluginId : undefined,
        currencyCode: item.type === 'address' ? currencyCode : undefined,
        primary: cleaned.length === 0
      })
    }
    if (cleaned.length === 0) {
      showToast(lstrings.edge_contact_identifier_required)
      return
    }

    const now = Date.now()
    const contact: EdgeContact = {
      id: uuidv4(),
      name: trimmedName,
      identifiers: cleaned,
      createdAt: now,
      updatedAt: now
    }

    setSaving(true)
    try {
      const saved = await saveEdgeContact(account, contact)
      bridge.resolve(saved)
    } catch (error: unknown) {
      showError(error)
    } finally {
      setSaving(false)
    }
  })

  return (
    <EdgeModal
      bridge={bridge}
      title={lstrings.edge_contact_new_title}
      onCancel={handleCancel}
      scroll
    >
      <ModalFilledTextInput
        autoCapitalize="words"
        autoCorrect
        placeholder={lstrings.edge_contact_name}
        returnKeyType="next"
        value={name}
        onChangeText={setName}
      />
      {identifiers.map((item, index) => (
        <EdgeCard key={item.id}>
          <Space horizontalRem={0.5} topRem={0.5}>
            <EdgeText>
              {sprintf(lstrings.edge_contact_identifier_s, String(index + 1))}
            </EdgeText>
          </Space>
          <Space horizontalRem={0.5} bottomRem={0.5}>
            <DropdownInputButton
              onPress={async () => {
                await handleChangeType(item.id)
              }}
            >
              <EdgeText>{identifierTypeLabel(item.type)}</EdgeText>
            </DropdownInputButton>
          </Space>
          <ModalFilledTextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={lstrings.edge_contact_value_placeholder}
            returnKeyType="done"
            value={item.value}
            onChangeText={value => {
              handleChangeValue(item.id, value)
            }}
          />
        </EdgeCard>
      ))}
      <Space aroundRem={0.5}>
        <EdgeButton
          type="secondary"
          label={`+ ${lstrings.edge_contact_add_identifier}`}
          onPress={handleAddIdentifier}
        />
      </Space>
      <View style={styles.privacyBox}>
        <ShieldCheckmarkIcon
          size={theme.rem(1.25)}
          color={theme.iconTappable}
        />
        <View style={styles.privacyText}>
          <SmallText>{lstrings.edge_contact_privacy}</SmallText>
        </View>
      </View>
      <Space aroundRem={0.5} bottomRem={1}>
        <EdgeButton
          type="primary"
          label={lstrings.string_save}
          spinner={saving}
          disabled={saving}
          onPress={handleSave}
        />
      </Space>
    </EdgeModal>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  privacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.rem(0.5),
    backgroundColor: theme.cardBaseColor,
    borderRadius: theme.rem(0.5),
    marginHorizontal: theme.rem(0.5),
    marginVertical: theme.rem(0.5),
    padding: theme.rem(0.75)
  },
  privacyText: {
    flex: 1
  }
}))
