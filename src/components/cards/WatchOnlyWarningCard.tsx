import * as React from 'react'
import { View } from 'react-native'

import { lstrings } from '../../locales/strings'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { AlertCardUi4 } from './AlertCard'

interface Props {
  compact?: boolean
}

export const WatchOnlyWarningCard = (props: Props): React.JSX.Element => {
  const { compact = false } = props
  const theme = useTheme()
  const styles = getStyles(theme)

  return (
    <View style={compact ? styles.compact : styles.full}>
      <AlertCardUi4
        type="warning"
        title={lstrings.watch_only_wallet_title}
        body={lstrings.watch_only_wallet_message}
      />
    </View>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  compact: {
    marginBottom: theme.rem(0.5)
  },
  full: {
    marginHorizontal: theme.rem(0.5),
    marginBottom: theme.rem(1)
  }
}))
