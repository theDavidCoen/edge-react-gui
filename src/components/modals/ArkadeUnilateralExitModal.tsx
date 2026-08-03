import type { EdgeCurrencyWallet } from 'edge-core-js'
import * as React from 'react'
import { Linking, Platform, View } from 'react-native'
import type { AirshipBridge } from 'react-native-airship'
import RNFS from 'react-native-fs'
import Share, { type ShareOptions } from 'react-native-share'
import { sprintf } from 'sprintf-js'

import { getUniqueWalletName } from '../../actions/CreateWalletActions'
import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import { useSelector } from '../../types/reactRedux'
import type { NavigationBase } from '../../types/routerTypes'
import { ARKADE_UNILATERAL_EXIT_EXECUTOR_URL } from '../../util/arkadeDefaults'
import { ModalButtons } from '../buttons/ModalButtons'
import { AlertCardUi4 } from '../cards/AlertCard'
import { WarningCard } from '../cards/WarningCard'
import { EdgeTouchableOpacity } from '../common/EdgeTouchableOpacity'
import { Airship, showError, showToast } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText, Paragraph } from '../themed/EdgeText'
import { EdgeModal } from './EdgeModal'
import { WalletListModal, type WalletListResult } from './WalletListModal'

interface Props {
  bridge: AirshipBridge<boolean>
  wallet: EdgeCurrencyWallet
  /** Required for WalletListModal; Airship is outside NavigationContainer. */
  navigation?: NavigationBase
}

interface ArkadeUnilateralExitPackageResult {
  json: string
  filename: string
  executorUrl: string
  mode: 'graph'
  sweepAddress: string
}

interface ArkadeExitOtherMethods {
  arkadePrepareUnilateralExitPackage?: (
    destination: string
  ) => Promise<ArkadeUnilateralExitPackageResult>
}

/**
 * Guides average users through unilateral exit via a JSON package + Edge web
 * executor (prototype). No in-app Unroll / slide-to-confirm.
 */
export const ArkadeUnilateralExitModal: React.FC<Props> = props => {
  const { bridge, wallet, navigation } = props
  const theme = useTheme()
  const styles = getStyles(theme)
  const account = useSelector(state => state.core.account)
  const defaultIsoFiat = useSelector(state => state.ui.settings.defaultIsoFiat)

  const [destWalletId, setDestWalletId] = React.useState<string | undefined>()
  const [destAddress, setDestAddress] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [loadingDest, setLoadingDest] = React.useState(true)
  const [prepareError, setPrepareError] = React.useState<string | undefined>()

  const bitcoinWallets = React.useMemo(() => {
    return Object.values(account.currencyWallets).filter(
      w => w.currencyInfo.pluginId === 'bitcoin'
    )
  }, [account.currencyWallets])

  const destWallet =
    destWalletId != null ? account.currencyWallets[destWalletId] : undefined
  const destName = destWallet?.name ?? ''

  const loadAddressForWallet = React.useCallback(
    async (btcWallet: EdgeCurrencyWallet): Promise<string> => {
      const { segwitAddress, publicAddress } =
        await btcWallet.getReceiveAddress({ tokenId: null })
      return segwitAddress ?? publicAddress
    },
    []
  )

  React.useEffect(() => {
    let cancelled = false
    const prepare = async (): Promise<void> => {
      setLoadingDest(true)
      try {
        let btcWallets = Object.values(account.currencyWallets).filter(
          w => w.currencyInfo.pluginId === 'bitcoin'
        )
        if (btcWallets.length === 0) {
          const { walletType } = account.currencyConfig.bitcoin.currencyInfo
          const created = await account.createCurrencyWallet(walletType, {
            name: getUniqueWalletName(account, 'bitcoin'),
            fiatCurrencyCode: defaultIsoFiat
          })
          btcWallets = [created]
        }
        if (cancelled) return
        const chosen = btcWallets[0]
        setDestWalletId(chosen.id)
        const address = await loadAddressForWallet(chosen)
        if (!cancelled) setDestAddress(address)
      } catch (error: unknown) {
        if (!cancelled) showError(error)
      } finally {
        if (!cancelled) setLoadingDest(false)
      }
    }
    prepare().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [account, defaultIsoFiat, loadAddressForWallet])

  const handleCancel = useHandler(() => {
    if (busy) return
    bridge.resolve(false)
  })

  const handlePickDestination = useHandler(async () => {
    if (busy || loadingDest || navigation == null) return
    if (bitcoinWallets.length <= 1) return

    const result = await Airship.show<WalletListResult>(listBridge => (
      <WalletListModal
        bridge={listBridge}
        headerTitle={lstrings.your_wallets}
        navigation={navigation}
        allowedAssets={[{ pluginId: 'bitcoin', tokenId: null }]}
      />
    ))
    if (result?.type !== 'wallet') return
    const btcWallet = account.currencyWallets[result.walletId]
    if (btcWallet == null) return
    setDestWalletId(btcWallet.id)
    setDestAddress(await loadAddressForWallet(btcWallet))
  })

  const handleOpenExecutor = useHandler(() => {
    Linking.openURL(ARKADE_UNILATERAL_EXIT_EXECUTOR_URL).catch(
      (error: unknown) => {
        showError(error)
      }
    )
  })

  const sharePackage = async (
    result: ArkadeUnilateralExitPackageResult
  ): Promise<void> => {
    const dir =
      Platform.OS === 'android'
        ? RNFS.ExternalCachesDirectoryPath
        : RNFS.DocumentDirectoryPath
    const path = `${dir}/${result.filename}`
    await RNFS.writeFile(path, result.json, 'utf8')

    const shareOptions: ShareOptions = {
      title: lstrings.arkade_exit_save_title,
      subject: lstrings.arkade_exit_save_title,
      message: '',
      urls: [`file://${path}`],
      type: 'application/json',
      failOnCancel: false
    }
    await Share.open(shareOptions)
  }

  const handleSave = useHandler(async () => {
    if (destAddress === '' || busy) return
    setBusy(true)
    setPrepareError(undefined)
    try {
      const otherMethods = wallet.otherMethods as ArkadeExitOtherMethods
      if (otherMethods.arkadePrepareUnilateralExitPackage == null) {
        throw new Error(lstrings.arkade_exit_unavailable)
      }
      const result = await otherMethods.arkadePrepareUnilateralExitPackage(
        destAddress
      )
      await sharePackage(result)
      showToast(lstrings.arkade_exit_save_success)
      bridge.resolve(true)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      // User dismissed the share sheet — not a hard failure.
      if (
        /User did not share|User cancelled|canceled|cancelled/i.test(message)
      ) {
        bridge.resolve(true)
        return
      }
      setPrepareError(sprintf(lstrings.arkade_exit_prepare_error_1s, message))
      showError(error)
    } finally {
      setBusy(false)
    }
  })

  const canSave =
    !busy && !loadingDest && destAddress !== '' && destWalletId != null

  const canPick =
    bitcoinWallets.length > 1 && !busy && !loadingDest && navigation != null

  return (
    <EdgeModal
      bridge={bridge}
      warning
      title={lstrings.arkade_exit_title}
      onCancel={handleCancel}
      scroll
    >
      <Paragraph>{lstrings.arkade_exit_body}</Paragraph>

      <WarningCard
        title={lstrings.arkade_exit_warning_title}
        points={[
          lstrings.arkade_exit_steps_bullet,
          lstrings.arkade_exit_support_bullet,
          lstrings.arkade_exit_secret_bullet,
          lstrings.arkade_exit_prototype_bullet
        ]}
        marginRem={[1, 0.5]}
      />

      {prepareError != null ? (
        <AlertCardUi4
          type="error"
          title={lstrings.arkade_exit_prepare_error_title}
          body={prepareError}
          marginRem={[0.5, 0]}
        />
      ) : null}

      <EdgeTouchableOpacity
        disabled={!canPick}
        onPress={handlePickDestination}
        style={styles.destRow}
      >
        <EdgeText style={styles.dest}>
          {loadingDest
            ? lstrings.loading
            : sprintf(
                lstrings.arkade_exit_destination_1s,
                destName !== '' ? destName : '—'
              )}
        </EdgeText>
        {canPick ? (
          <EdgeText style={styles.change}>{lstrings.select_wallet}</EdgeText>
        ) : null}
      </EdgeTouchableOpacity>

      <View style={styles.buttons}>
        <ModalButtons
          primary={{
            label: lstrings.arkade_exit_save_button,
            onPress: handleSave,
            disabled: !canSave,
            spinner: busy
          }}
          secondary={{
            label: lstrings.arkade_exit_open_executor,
            onPress: handleOpenExecutor,
            disabled: busy
          }}
        />
      </View>
    </EdgeModal>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  destRow: {
    marginTop: theme.rem(0.5),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  dest: {
    color: theme.secondaryText,
    flex: 1
  },
  change: {
    color: theme.primaryText,
    marginLeft: theme.rem(0.5)
  },
  buttons: {
    marginTop: theme.rem(1),
    marginBottom: theme.rem(0.5)
  }
}))
