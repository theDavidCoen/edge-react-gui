import * as React from 'react'
import { View } from 'react-native'

import { Fontello } from '../../assets/vector/index'
import { lstrings } from '../../locales/strings'
import { EdgeTouchableOpacity } from '../common/EdgeTouchableOpacity'
import { PeopleIcon } from '../icons/ThemedIcons'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText } from './EdgeText'

export interface Props {
  copyToClipboard: () => Promise<void>
  openContactsModal: () => Promise<void>
  openShareModal: () => Promise<void>
}

export function ShareButtons(props: Props): React.ReactElement {
  const { copyToClipboard, openShareModal, openContactsModal } = props
  const theme = useTheme()
  const styles = getStyles(theme)

  return (
    <View style={styles.container}>
      <ShareButton
        icon={<PeopleIcon size={theme.rem(1.5)} color={theme.iconTappable} />}
        text={lstrings.contacts_title}
        onPress={openContactsModal}
      />
      <ShareButton
        icon={
          <Fontello
            name="Copy-icon"
            size={theme.rem(1.5)}
            color={theme.iconTappable}
          />
        }
        text={lstrings.fragment_request_copy_title}
        onPress={copyToClipboard}
      />
      <ShareButton
        icon={
          <Fontello
            name="FIO-share"
            size={theme.rem(1.5)}
            color={theme.iconTappable}
          />
        }
        text={lstrings.string_share}
        onPress={openShareModal}
      />
    </View>
  )
}

function ShareButton(props: {
  text: string
  onPress: () => Promise<void>
  icon: React.ReactNode
}): React.ReactElement {
  const { icon, text, onPress } = props
  const theme = useTheme()
  const styles = getStyles(theme)

  return (
    <EdgeTouchableOpacity
      accessible={false}
      style={styles.button}
      onPress={onPress}
    >
      {icon}
      <EdgeText style={styles.text}>{text}</EdgeText>
    </EdgeTouchableOpacity>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: theme.rem(1),
    marginBottom: theme.rem(1),
    marginVertical: theme.rem(1)
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  text: {
    textAlign: 'center',
    fontSize: theme.rem(0.75),
    marginTop: theme.rem(0.5)
  }
}))
