import * as React from 'react'
import { getColors } from 'react-native-image-colors'

import { ARKADE_PLUGIN_ID } from '../selectors/WalletSelectors'
import { useState } from '../types/reactHooks'
import type { EdgeAsset } from '../types/types'
import { getCurrencyIconUris } from '../util/CdnUris'

export const useIconColor = (edgeAsset: EdgeAsset): string | undefined => {
  const [color, setColor] = useState<string | undefined>(undefined)
  const primaryCurrencyIconUrl = React.useMemo(() => {
    const { pluginId, tokenId } = edgeAsset
    if (pluginId == null) return null

    // Arkade reuses Bitcoin icons (no CDN asset under arkade/)
    const iconPluginId = pluginId === ARKADE_PLUGIN_ID ? 'bitcoin' : pluginId
    const icon = getCurrencyIconUris(iconPluginId, tokenId)
    return icon.symbolImage
  }, [edgeAsset])

  React.useEffect(() => {
    if (primaryCurrencyIconUrl == null) return

    getColors(primaryCurrencyIconUrl, {
      cache: true,
      key: primaryCurrencyIconUrl
    })
      .then(colors => {
        if (colors.platform === 'ios') {
          setColor(colors.primary)
        }
        if (colors.platform === 'android') {
          setColor(colors.vibrant)
        }
      })
      .catch((err: unknown) => {
        console.warn(err)
      })
  }, [primaryCurrencyIconUrl])

  return color
}
