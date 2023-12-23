import * as React from 'react'
import { View } from 'react-native'
import { cacheStyles } from 'react-native-patina'

import { Theme, useTheme } from '../services/ThemeContext'

interface Props {
  children: SplitRow[] | SplitRow
}

interface SplitRow {
  left: React.ReactNode
  right: React.ReactNode
}

/**
 * A view representing rows of data split on the left and right edges of the
 * line. Neither side will exceed 50% of the width of the view.
 **/
export const SplitRowsView = (props: Props) => {
  const { children } = props
  const theme = useTheme()
  const styles = getStyles(theme)

  const getSplitRow = (row: SplitRow, key?: string) => (
    <View key={key} style={styles.row}>
      <View style={styles.leftColumn}>{row.left}</View>
      <View style={styles.rightColumn}>{row.right}</View>
    </View>
  )

  return (
    <View style={styles.container}>
      {Array.isArray(children) ? children.map((row: SplitRow, index: number) => getSplitRow(row, index.toString())) : getSplitRow(children)}
    </View>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  container: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    flex: 1
  },
  leftColumn: {
    flexDirection: 'column',
    justifyContent: 'flex-start',
    flex: 1,
    maxWidth: '50%'
  },
  rightColumn: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    flex: 1,
    maxWidth: '50%'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start'
  }
}))