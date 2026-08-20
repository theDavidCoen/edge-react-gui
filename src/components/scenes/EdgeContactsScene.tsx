import * as React from 'react'
import { FlatList, Keyboard, View } from 'react-native'

import { SCROLL_INDICATOR_INSET_FIX } from '../../constants/constantSettings'
import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import {
  type FooterRender,
  useSceneFooterState
} from '../../state/SceneFooterState'
import { useSelector } from '../../types/reactRedux'
import type { EdgeAppSceneProps } from '../../types/routerTypes'
import {
  contactMatchesSearch,
  primaryIdentifier
} from '../../util/contacts/match'
import {
  syncAndReloadEdgeContacts,
  useEdgeContacts
} from '../../util/contacts/store'
import type { EdgeContact } from '../../util/contacts/types'
import { truncateString } from '../../util/utils'
import { EdgeButton } from '../buttons/EdgeButton'
import { SceneWrapper } from '../common/SceneWrapper'
import { SearchIconAnimated, ShieldCheckmarkIcon } from '../icons/ThemedIcons'
import { Space } from '../layout/Space'
import { EditEdgeContactModal } from '../modals/EditEdgeContactModal'
import { Airship } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText, SmallText } from '../themed/EdgeText'
import { SceneFooterWrapper } from '../themed/SceneFooterWrapper'
import { SelectableRow } from '../themed/SelectableRow'
import {
  SimpleTextInput,
  type SimpleTextInputRef
} from '../themed/SimpleTextInput'

interface Props extends EdgeAppSceneProps<'edgeContacts'> {}

export const EdgeContactsScene: React.FC<Props> = () => {
  const account = useSelector(state => state.core.account)
  const theme = useTheme()
  const styles = getStyles(theme)
  const contacts = useEdgeContacts()

  const [searchText, setSearchText] = React.useState('')
  const [isSearching, setIsSearching] = React.useState(false)
  const [footerHeight, setFooterHeight] = React.useState<number | undefined>()

  const textInputRef = React.useRef<SimpleTextInputRef>(null)
  const footerOpenRatio = useSceneFooterState(state => state.footerOpenRatio)
  const setKeepOpen = useSceneFooterState(state => state.setKeepOpen)

  useAsyncEffect(
    async () => {
      await syncAndReloadEdgeContacts(account)
    },
    [account],
    'EdgeContactsScene'
  )

  React.useEffect(() => {
    if (setKeepOpen != null) setKeepOpen(isSearching)
    if (isSearching && textInputRef.current != null) {
      textInputRef.current.focus()
    }
    if (!isSearching && textInputRef.current != null) {
      textInputRef.current.blur()
    }
  }, [isSearching, setKeepOpen])

  const filteredContacts = React.useMemo(
    () => contacts.filter(contact => contactMatchesSearch(contact, searchText)),
    [contacts, searchText]
  )

  const handleStartSearching = useHandler(() => {
    setIsSearching(true)
  })

  const handleDoneSearching = useHandler(() => {
    setSearchText('')
    setIsSearching(false)
  })

  const handleChangeText = useHandler((value: string) => {
    setSearchText(value)
  })

  const handleFooterLayoutHeight = useHandler((height: number) => {
    setFooterHeight(height)
  })

  const handleSubmitEditing = useHandler(() => {
    Keyboard.dismiss()
  })

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

  const renderFooter: FooterRender = React.useCallback(
    sceneWrapperInfo => {
      return (
        <SceneFooterWrapper
          key="EdgeContactsScene-SearchFooter"
          sceneWrapperInfo={sceneWrapperInfo}
          onLayoutHeight={handleFooterLayoutHeight}
        >
          <View style={styles.privacyBox}>
            <ShieldCheckmarkIcon
              size={theme.rem(1.25)}
              color={theme.iconTappable}
            />
            <View style={styles.privacyText}>
              <SmallText>{lstrings.edge_contact_privacy}</SmallText>
            </View>
          </View>
          <SimpleTextInput
            returnKeyType="search"
            placeholder={lstrings.edge_contacts_search}
            onChangeText={handleChangeText}
            value={searchText}
            active={isSearching}
            onCancel={handleDoneSearching}
            onFocus={handleStartSearching}
            onSubmitEditing={handleSubmitEditing}
            ref={textInputRef}
            iconComponent={SearchIconAnimated}
            scale={footerHeight == null ? undefined : footerOpenRatio}
            horizontalRem={1}
            verticalRem={0.5}
            autoCorrect={false}
          />
        </SceneFooterWrapper>
      )
    },
    [
      footerHeight,
      footerOpenRatio,
      handleChangeText,
      handleDoneSearching,
      handleFooterLayoutHeight,
      handleStartSearching,
      handleSubmitEditing,
      isSearching,
      searchText,
      styles.privacyBox,
      styles.privacyText,
      theme
    ]
  )

  return (
    <SceneWrapper
      avoidKeyboard
      footerHeight={footerHeight}
      renderFooter={renderFooter}
    >
      {({ insetStyle, undoInsetStyle }) => (
        <View style={[styles.listStack, undoInsetStyle]}>
          <FlatList
            contentContainerStyle={{
              ...insetStyle,
              ...styles.listContent,
              paddingBottom: (insetStyle.paddingBottom ?? 0) + theme.rem(1)
            }}
            data={filteredContacts}
            keyExtractor={item => item.id}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={renderContact}
            scrollIndicatorInsets={SCROLL_INDICATOR_INSET_FIX}
            ListEmptyComponent={
              <Space aroundRem={0.5}>
                <EdgeText>{lstrings.choose_recipient_empty}</EdgeText>
              </Space>
            }
            ListFooterComponent={
              isSearching ? null : (
                <Space aroundRem={0.5} bottomRem={0.5}>
                  <EdgeButton
                    type="secondary"
                    label={`+ ${lstrings.choose_recipient_add_contact}`}
                    onPress={handleAddContact}
                  />
                </Space>
              )
            }
          />
        </View>
      )}
    </SceneWrapper>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  listStack: {
    flexGrow: 1
  },
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
  },
  privacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.rem(0.5),
    backgroundColor: theme.cardBaseColor,
    borderRadius: theme.rem(0.5),
    marginHorizontal: theme.rem(1),
    marginTop: theme.rem(0.5),
    padding: theme.rem(0.75)
  },
  privacyText: {
    flex: 1
  }
}))
