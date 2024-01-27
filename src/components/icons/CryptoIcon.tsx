import { EdgeTokenId } from 'edge-core-js'
import * as React from 'react'
import { StyleSheet, View } from 'react-native'
import FastImage from 'react-native-fast-image'

import compromisedIcon from '../../assets/images/compromisedIcon.png'
import { useWatch } from '../../hooks/useWatch'
import { useSelector } from '../../types/reactRedux'
import { getCurrencyIconUris } from '../../util/CdnUris'
import { fixSides, mapSides, sidesToMargin } from '../../util/sides'
import { WalletSyncCircle } from '../progress-indicators/WalletSyncCircle'
import { cacheStyles, Theme, useTheme } from '../services/ThemeContext'

interface Props {
  // Main props - If non is specified, would just render an empty view
  pluginId?: string // Needed when walletId is not supplied and we still want to get an icon
  tokenId: EdgeTokenId // Needed when it's a token (not the plugin's native currency)
  walletId?: string // To allow showing the progress ratio sync circle

  // Image props
  hideSecondary?: boolean // Only show the currency icon for token (no secondary icon for the network)
  mono?: boolean // To use the mono dark icon logo

  // Styling props
  marginRem?: number | number[]
  sizeRem?: number
}

const CryptoIconComponent = (props: Props) => {
  const { hideSecondary = false, marginRem, mono = false, sizeRem = 2, tokenId, walletId } = props

  const theme = useTheme()
  const styles = getStyles(theme)
  const size = theme.rem(sizeRem)

  // Track wallets state from account and update the wallet when ready
  const account = useSelector(state => state.core.account)
  const currencyWallets = useWatch(account, 'currencyWallets')
  const wallet = walletId != null ? currencyWallets[walletId] : null
  const compromised = useSelector(state => {
    if (walletId == null) return 0
    const { modalShown = 0 } = state.ui?.settings?.securityCheckedWallets?.[walletId] ?? {}
    return modalShown > 0
  })

  const { pluginId = wallet?.currencyInfo.pluginId } = props

  // Primary Currency icon
  const primaryCurrencyIcon = React.useMemo(() => {
    if (pluginId == null) return null

    // Get Currency Icon URI
    const icon = getCurrencyIconUris(pluginId, tokenId)
    const source = { uri: mono ? icon.symbolImageDarkMono : icon.symbolImage }

    // Return Currency logo from the edge server
    return source
  }, [pluginId, tokenId, mono])

  // Secondary (parent) currency icon (if it's a token)
  const secondaryCurrencyIcon = React.useMemo(() => {
    if (compromised) {
      return compromisedIcon
    }

    // Skip if this is not a token:
    if (pluginId == null || tokenId == null || tokenId === pluginId) {
      return null
    }

    // Get Parent Icon URI
    const icon = getCurrencyIconUris(pluginId, null)
    const source = { uri: mono ? icon.symbolImageDarkMono : icon.symbolImage }

    // Return Parent logo from the edge server
    return source
  }, [compromised, mono, pluginId, tokenId])

  // Main view styling
  const spacingStyle = React.useMemo(
    () => ({
      ...sidesToMargin(mapSides(fixSides(marginRem, 0), theme.rem)),
      height: size,
      width: size
    }),
    [marginRem, size, theme.rem]
  )

  return (
    <View style={spacingStyle}>
      {wallet == null ? null : (
        <WalletSyncCircle
          /* key prevents component from being recycled and shared between wallets */
          key={`${wallet.id}${String(tokenId)}`}
          size={size}
          wallet={wallet}
        />
      )}
      {primaryCurrencyIcon != null ? <FastImage style={StyleSheet.absoluteFill} source={primaryCurrencyIcon} /> : null}
      {hideSecondary ? null : secondaryCurrencyIcon != null ? <FastImage style={styles.parentIcon} source={secondaryCurrencyIcon} /> : null}
    </View>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  parentIcon: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: '50%',
    height: '50%'
  }
}))

export const CryptoIcon = React.memo(CryptoIconComponent)
