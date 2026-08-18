import * as React from 'react'
import { FlatList, View } from 'react-native'

import { SCROLL_INDICATOR_INSET_FIX } from '../../constants/constantSettings'
import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import { useSelector } from '../../types/reactRedux'
import type { EdgeAppSceneProps } from '../../types/routerTypes'
import { primaryIdentifier } from '../../util/contacts/match'
import { loadEdgeContacts, useEdgeContacts } from '../../util/contacts/store'
import type { EdgeContact } from '../../util/contacts/types'
import { truncateString } from '../../util/utils'
import { EdgeButton } from '../buttons/EdgeButton'
import { SceneWrapper } from '../common/SceneWrapper'
import { Space } from '../layout/Space'
import { EditEdgeContactModal } from '../modals/EditEdgeContactModal'
import { Airship } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText } from '../themed/EdgeText'
import { SelectableRow } from '../themed/SelectableRow'

interface Props extends EdgeAppSceneProps<'edgeContacts'> {}

export const EdgeContactsScene: React.FC<Props> = () => {
  const account = useSelector(state => state.core.account)
  const theme = useTheme()
  const styles = getStyles(theme)
  const contacts = useEdgeContacts()

  useAsyncEffect(
    async () => {
      await loadEdgeContacts(account)
    },
    [account],
    'EdgeContactsScene'
  )

  const handleAddContact = useHandler(async () => {
    await Airship.show<EdgeContact | undefined>(bridge => (
      <EditEdgeContactModal bridge={bridge} account={account} />
    ))
  })

  const handleEditContact = useHandler(async (contact: EdgeContact) => {
    await Airship.show<EdgeContact | undefined>(bridge => (
      <EditEdgeContactModal
        bridge={bridge}
        account={account}
        contact={contact}
      />
    ))
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
          handleEditContact(item).catch(() => {})
        }}
      />
    )
  }

  return (
    <SceneWrapper>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={contacts}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        renderItem={renderContact}
        scrollIndicatorInsets={SCROLL_INDICATOR_INSET_FIX}
        ListEmptyComponent={
          <Space aroundRem={0.5}>
            <EdgeText>{lstrings.choose_recipient_empty}</EdgeText>
          </Space>
        }
        ListFooterComponent={
          <Space aroundRem={0.5} bottomRem={1}>
            <EdgeButton
              type="secondary"
              label={`+ ${lstrings.choose_recipient_add_contact}`}
              onPress={handleAddContact}
            />
          </Space>
        }
      />
    </SceneWrapper>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  listContent: {
    flexGrow: 1,
    paddingTop: theme.rem(0.5)
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
