import * as React from 'react'
import { View } from 'react-native'
import type { AirshipBridge } from 'react-native-airship'

import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import { identifierTypeLabel } from '../../util/contacts/labels'
import type { EdgeContact } from '../../util/contacts/types'
import { truncateString } from '../../util/utils'
import { EdgeButton } from '../buttons/EdgeButton'
import { EdgeCard } from '../cards/EdgeCard'
import { ShieldCheckmarkIcon } from '../icons/ThemedIcons'
import { Space } from '../layout/Space'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText, SmallText } from '../themed/EdgeText'
import { EdgeModal } from './EdgeModal'

interface Props {
  bridge: AirshipBridge<boolean>
  contact: EdgeContact
  canUse: boolean
}

export const EdgeContactSavedModal: React.FC<Props> = props => {
  const { bridge, contact, canUse } = props
  const theme = useTheme()
  const styles = getStyles(theme)
  const trimmedInitial = contact.name.trim().charAt(0).toUpperCase()
  const initial = trimmedInitial === '' ? '?' : trimmedInitial

  const handleCancel = useHandler(() => {
    bridge.resolve(false)
  })

  const handleUse = useHandler(() => {
    bridge.resolve(true)
  })

  return (
    <EdgeModal bridge={bridge} onCancel={handleCancel} scroll>
      <View style={styles.header}>
        <View style={styles.avatarLarge}>
          <EdgeText style={styles.avatarLetter}>{initial}</EdgeText>
        </View>
        <EdgeText style={styles.title}>
          {lstrings.edge_contact_saved_title}
        </EdgeText>
        <EdgeText>{contact.name}</EdgeText>
      </View>
      <EdgeCard sections>
        {contact.identifiers.map(item => (
          <View key={item.id} style={styles.identifierRow}>
            <View style={styles.identifierText}>
              <EdgeText>{truncateString(item.value, 28, true)}</EdgeText>
              <SmallText>{identifierTypeLabel(item.type)}</SmallText>
            </View>
            {item.primary === true ? (
              <EdgeText style={styles.primary}>
                {lstrings.edge_contact_primary}
              </EdgeText>
            ) : null}
          </View>
        ))}
      </EdgeCard>
      {canUse ? (
        <Space aroundRem={0.5} topRem={1}>
          <EdgeButton
            type="secondary"
            label={lstrings.edge_contact_use_recipient}
            onPress={handleUse}
          />
        </Space>
      ) : null}
      <View style={styles.footer}>
        <ShieldCheckmarkIcon
          size={theme.rem(0.875)}
          color={theme.iconTappable}
        />
        <SmallText>{lstrings.edge_contact_saved_footer}</SmallText>
      </View>
    </EdgeModal>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  header: {
    alignItems: 'center',
    marginBottom: theme.rem(1),
    marginTop: theme.rem(0.5)
  },
  avatarLarge: {
    alignItems: 'center',
    backgroundColor: theme.iconTappable,
    borderRadius: theme.rem(2),
    height: theme.rem(4),
    justifyContent: 'center',
    marginBottom: theme.rem(0.75),
    width: theme.rem(4)
  },
  avatarLetter: {
    color: theme.backgroundGradientColors[0],
    fontSize: theme.rem(1.5)
  },
  title: {
    marginBottom: theme.rem(0.25)
  },
  identifierRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: theme.rem(0.5),
    paddingVertical: theme.rem(0.5)
  },
  identifierText: {
    flex: 1
  },
  primary: {
    color: theme.iconTappable,
    fontSize: theme.rem(0.75),
    marginLeft: theme.rem(0.5)
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.rem(0.5),
    justifyContent: 'center',
    marginBottom: theme.rem(1),
    marginTop: theme.rem(0.75)
  }
}))
