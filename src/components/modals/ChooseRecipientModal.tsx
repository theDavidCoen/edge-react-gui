import type { EdgeAccount } from 'edge-core-js'
import * as React from 'react'
import { FlatList, View } from 'react-native'
import type { AirshipBridge } from 'react-native-airship'
import { sprintf } from 'sprintf-js'

import { SCROLL_INDICATOR_INSET_FIX } from '../../constants/constantSettings'
import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import {
  contactMatchesSearch,
  pickContactSendUri,
  primaryIdentifier
} from '../../util/contacts/match'
import {
  syncAndReloadEdgeContacts,
  useEdgeContacts
} from '../../util/contacts/store'
import type { EdgeContact } from '../../util/contacts/types'
import {
  type RecipientPurpose,
  validateRecipientInput
} from '../../util/contacts/validate'
import { truncateString } from '../../util/utils'
import { EdgeButton } from '../buttons/EdgeButton'
import { SearchIconAnimated } from '../icons/ThemedIcons'
import { Space } from '../layout/Space'
import { Airship, showToast } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText } from '../themed/EdgeText'
import { ModalFilledTextInput } from '../themed/FilledTextInput'
import { SelectableRow } from '../themed/SelectableRow'
import { EdgeContactSavedModal } from './EdgeContactSavedModal'
import { EdgeModal } from './EdgeModal'
import { EditEdgeContactModal } from './EditEdgeContactModal'

interface Props {
  bridge: AirshipBridge<string | undefined>
  account: EdgeAccount
  walletId: string
  currencyCode: string
  title?: string
  purpose?: RecipientPurpose
  isFioOnly?: boolean
}

export const ChooseRecipientModal: React.FC<Props> = props => {
  const {
    bridge,
    account,
    walletId,
    currencyCode,
    title,
    purpose = 'send',
    isFioOnly = false
  } = props
  const theme = useTheme()
  const styles = getStyles(theme)
  const contacts = useEdgeContacts()

  const coreWallet = account.currencyWallets[walletId]
  const pluginId = coreWallet?.currencyInfo.pluginId ?? ''

  const [search, setSearch] = React.useState('')
  const validatingRef = React.useRef(false)

  useAsyncEffect(
    async () => {
      await syncAndReloadEdgeContacts(account)
    },
    [account],
    'ChooseRecipientModal'
  )

  const filtered = React.useMemo(
    () => contacts.filter(contact => contactMatchesSearch(contact, search)),
    [contacts, search]
  )

  const handleCancel = useHandler(() => {
    bridge.resolve(undefined)
  })

  const resolveValue = useHandler((value: string) => {
    const trimmed = value.trim()
    if (trimmed === '') return
    bridge.resolve(trimmed)
  })

  const resolveContact = useHandler((contact: EdgeContact) => {
    const uri = pickContactSendUri(contact, { pluginId, isFioOnly })
    if (uri == null) {
      showToast(sprintf(lstrings.choose_recipient_no_match_s, currencyCode))
      return
    }
    bridge.resolve(uri)
  })

  const handleAddContact = useHandler(async () => {
    const saved = await Airship.show<EdgeContact | undefined>(editBridge => (
      <EditEdgeContactModal
        bridge={editBridge}
        account={account}
        pluginId={pluginId}
        currencyCode={currencyCode}
      />
    ))
    if (saved == null) return
    const uri = pickContactSendUri(saved, { pluginId, isFioOnly })
    const use = await Airship.show<boolean>(savedBridge => (
      <EdgeContactSavedModal
        bridge={savedBridge}
        contact={saved}
        canUse={uri != null}
      />
    ))
    if (use && uri != null) bridge.resolve(uri)
  })

  const tryAutoResolve = useHandler(async (value: string) => {
    if (coreWallet == null || validatingRef.current) return
    const trimmed = value.trim()
    if (trimmed === '') return

    validatingRef.current = true
    try {
      const exactContact = contacts.find(
        contact => contact.name.trim().toLowerCase() === trimmed.toLowerCase()
      )
      if (exactContact != null) {
        resolveContact(exactContact)
        return
      }

      const isValid = await validateRecipientInput(trimmed, {
        account,
        coreWallet,
        currencyCode,
        purpose
      })
      if (isValid) resolveValue(trimmed)
    } finally {
      validatingRef.current = false
    }
  })

  const handleSearchChange = useHandler((value: string) => {
    setSearch(value)
  })

  React.useEffect(() => {
    const trimmed = search.trim()
    if (trimmed === '') return
    const timer = setTimeout(() => {
      tryAutoResolve(search).catch(() => {})
    }, 400)
    return () => {
      clearTimeout(timer)
    }
  }, [search, tryAutoResolve])

  const handleSearchSubmit = useHandler(async () => {
    const trimmed = search.trim()
    if (trimmed === '') return

    if (filtered.length === 1) {
      resolveContact(filtered[0])
      return
    }

    const isValid = await validateRecipientInput(trimmed, {
      account,
      coreWallet,
      currencyCode,
      purpose
    })
    if (isValid) {
      resolveValue(trimmed)
      return
    }

    resolveValue(trimmed)
  })

  const renderContact = ({
    item
  }: {
    item: EdgeContact
  }): React.ReactElement => {
    const identifier = primaryIdentifier(item)
    const subtitle =
      identifier == null
        ? undefined
        : truncateString(identifier.value, 28, true)
    const trimmed = item.name.trim().charAt(0).toUpperCase()
    const initial = trimmed === '' ? '?' : trimmed
    return (
      <SelectableRow
        icon={
          <View style={styles.avatar}>
            <EdgeText style={styles.avatarText}>{initial}</EdgeText>
          </View>
        }
        title={item.name}
        subTitle={subtitle}
        onPress={() => {
          resolveContact(item)
        }}
      />
    )
  }

  return (
    <EdgeModal
      bridge={bridge}
      title={title ?? lstrings.choose_recipient_title}
      onCancel={handleCancel}
    >
      <ModalFilledTextInput
        autoCapitalize="none"
        autoCorrect={false}
        iconComponent={SearchIconAnimated}
        placeholder={lstrings.choose_recipient_search_placeholder}
        returnKeyType="search"
        value={search}
        onChangeText={handleSearchChange}
        onSubmitEditing={() => {
          handleSearchSubmit().catch(() => {})
        }}
      />
      <Space horizontalRem={0.5} topRem={0.5} bottomRem={0.25}>
        <EdgeText>{lstrings.choose_recipient_edge_contacts}</EdgeText>
      </Space>
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        renderItem={renderContact}
        scrollIndicatorInsets={SCROLL_INDICATOR_INSET_FIX}
        style={styles.list}
        ListEmptyComponent={
          <Space aroundRem={0.5}>
            <EdgeText>{lstrings.choose_recipient_empty}</EdgeText>
          </Space>
        }
      />
      <Space aroundRem={0.5} bottomRem={1}>
        <EdgeButton
          type="secondary"
          label={`+ ${lstrings.choose_recipient_add_contact}`}
          onPress={handleAddContact}
        />
      </Space>
    </EdgeModal>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  list: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: theme.rem(0.25)
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: theme.iconTappable,
    borderRadius: theme.rem(1),
    height: theme.rem(2),
    justifyContent: 'center',
    width: theme.rem(2)
  },
  avatarText: {
    color: theme.backgroundGradientColors[0],
    textAlign: 'center'
  }
}))
