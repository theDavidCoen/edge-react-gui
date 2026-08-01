import Clipboard from '@react-native-clipboard/clipboard'
import { div, toFixed } from 'biggystring'
import type { EdgeCurrencyWallet } from 'edge-core-js'
import * as React from 'react'
import { View } from 'react-native'
import type { AirshipBridge } from 'react-native-airship'
import { sprintf } from 'sprintf-js'

import { getUniqueWalletName } from '../../actions/CreateWalletActions'
import type { GuiExchangeRates } from '../../actions/ExchangeRateActions'
import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import { convertCurrency } from '../../selectors/WalletSelectors'
import { useSelector } from '../../types/reactRedux'
import type { NavigationBase } from '../../types/routerTypes'
import { ARKADE_PLUGIN_ID } from '../../util/arkade'
import { getCryptoText } from '../../util/cryptoTextUtils'
import { DECIMAL_PRECISION } from '../../util/utils'
import { AlertCardUi4 } from '../cards/AlertCard'
import { EdgeCard } from '../cards/EdgeCard'
import { WarningCard } from '../cards/WarningCard'
import { EdgeTouchableOpacity } from '../common/EdgeTouchableOpacity'
import { EdgeRow } from '../rows/EdgeRow'
import { Airship, showError, showToast } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { EdgeText, Paragraph } from '../themed/EdgeText'
import { SafeSlider } from '../themed/SafeSlider'
import { EdgeModal } from './EdgeModal'
import { WalletListModal, type WalletListResult } from './WalletListModal'

interface Props {
  bridge: AirshipBridge<boolean>
  wallet: EdgeCurrencyWallet
  /** Required for WalletListModal; Airship is outside NavigationContainer. */
  navigation?: NavigationBase
}

interface ArkadeUnilateralExitEstimate {
  grossAmountSats: string
  estimatedFeeSats: string
  netAmountSats: string
  feeRatio: number
  vBytes: number
  feeRateSatvB: number
  timelockBlocks: number
  uneconomical: boolean
  highFeeImpact: boolean
}

interface ArkadeExitOtherMethods {
  arkadeEstimateUnilateralExit?: (
    destination: string
  ) => Promise<ArkadeUnilateralExitEstimate>
  arkadeUnilateralExitToAddress?: (destination: string) => Promise<{
    txid: string
    destination: string
    phase: 'sweep' | 'unroll'
  }>
  arkadeGetUnrollFeeAddress?: () => Promise<string>
}

const formatSatsLine = (
  wallet: EdgeCurrencyWallet,
  sats: string,
  exchangeRates: GuiExchangeRates,
  defaultIsoFiat: string
): { crypto: string; fiat: string } => {
  const { denominations, currencyCode } = wallet.currencyInfo
  const exchangeDenomination =
    denominations.find(d => d.name === currencyCode) ?? denominations[0]
  const displayDenomination =
    denominations.find(d => d.name === 'BTC') ?? exchangeDenomination

  const crypto = getCryptoText({
    nativeAmount: sats,
    displayDenomination,
    exchangeDenomination,
    currencyCode: displayDenomination.name
  })

  const fiatValue = convertCurrency(
    exchangeRates,
    ARKADE_PLUGIN_ID,
    null,
    defaultIsoFiat,
    div(sats, displayDenomination.multiplier, DECIMAL_PRECISION)
  )
  const fiat =
    fiatValue !== '0' ? `~${toFixed(fiatValue, 0, 2)} ${defaultIsoFiat}` : ''

  return { crypto, fiat }
}

/**
 * Exit Arkade VTXOs to a non-Arkade Bitcoin wallet via the unilateral path
 * (Unroll chain + CSV sweep). Shows live fee estimates before confirmation.
 */
export const ArkadeUnilateralExitModal: React.FC<Props> = props => {
  const { bridge, wallet, navigation } = props
  const theme = useTheme()
  const styles = getStyles(theme)
  const account = useSelector(state => state.core.account)
  const exchangeRates = useSelector(state => state.exchangeRates)
  const defaultIsoFiat = useSelector(state => state.ui.settings.defaultIsoFiat)

  const [destWalletId, setDestWalletId] = React.useState<string | undefined>()
  const [destAddress, setDestAddress] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [loadingDest, setLoadingDest] = React.useState(true)
  const [isCalculatingFee, setIsCalculatingFee] = React.useState(false)
  const [feeError, setFeeError] = React.useState<string | undefined>()
  const [estimate, setEstimate] = React.useState<
    ArkadeUnilateralExitEstimate | undefined
  >()
  const [feeAddress, setFeeAddress] = React.useState('')
  const [feeAddressError, setFeeAddressError] = React.useState<
    string | undefined
  >()
  const [loadingFeeAddress, setLoadingFeeAddress] = React.useState(true)

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

  React.useEffect(() => {
    let cancelled = false
    const otherMethods = wallet.otherMethods as ArkadeExitOtherMethods

    const loadFeeAddress = async (): Promise<void> => {
      setLoadingFeeAddress(true)
      setFeeAddressError(undefined)
      try {
        if (otherMethods.arkadeGetUnrollFeeAddress == null) {
          throw new Error(lstrings.arkade_exit_unavailable)
        }
        const address = await otherMethods.arkadeGetUnrollFeeAddress()
        if (!cancelled) setFeeAddress(address)
      } catch (error: unknown) {
        if (!cancelled) {
          setFeeAddress('')
          const message = error instanceof Error ? error.message : String(error)
          setFeeAddressError(
            sprintf(lstrings.arkade_exit_fee_address_error_1s, message)
          )
        }
      } finally {
        if (!cancelled) setLoadingFeeAddress(false)
      }
    }

    loadFeeAddress().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [wallet])

  React.useEffect(() => {
    let cancelled = false
    const otherMethods = wallet.otherMethods as ArkadeExitOtherMethods

    if (
      loadingDest ||
      destAddress === '' ||
      otherMethods.arkadeEstimateUnilateralExit == null
    ) {
      setEstimate(undefined)
      setFeeError(undefined)
      setIsCalculatingFee(false)
      return () => {
        cancelled = true
      }
    }

    const run = async (): Promise<void> => {
      setIsCalculatingFee(true)
      setFeeError(undefined)
      try {
        const next = await otherMethods.arkadeEstimateUnilateralExit!(
          destAddress
        )
        if (!cancelled) setEstimate(next)
      } catch (error: unknown) {
        if (!cancelled) {
          setEstimate(undefined)
          const message = error instanceof Error ? error.message : String(error)
          setFeeError(sprintf(lstrings.arkade_exit_fee_error_1s, message))
        }
      } finally {
        if (!cancelled) setIsCalculatingFee(false)
      }
    }

    run().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [destAddress, loadingDest, wallet])

  const handleCancel = useHandler(() => {
    if (busy) return
    bridge.resolve(false)
  })

  const handleCopyFeeAddress = useHandler(() => {
    if (feeAddress === '') return
    Clipboard.setString(feeAddress)
    showToast(lstrings.fragment_copied)
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

  const handleConfirm = useHandler(async (reset: () => void) => {
    if (destAddress === '') {
      reset()
      return
    }
    setBusy(true)
    try {
      const otherMethods = wallet.otherMethods as ArkadeExitOtherMethods
      if (otherMethods.arkadeUnilateralExitToAddress == null) {
        throw new Error(lstrings.arkade_exit_unavailable)
      }
      const result = await otherMethods.arkadeUnilateralExitToAddress(
        destAddress
      )
      if (result.phase === 'sweep' && result.txid !== '') {
        showToast(
          sprintf(
            lstrings.arkade_exit_success_1s,
            destName !== '' ? destName : result.destination.slice(0, 12)
          )
        )
      } else {
        showToast(lstrings.arkade_exit_success_unroll)
      }
      bridge.resolve(true)
    } catch (error: unknown) {
      showError(error)
      reset()
    } finally {
      setBusy(false)
    }
  })

  const uneconomical = estimate?.uneconomical === true
  const canConfirm =
    !busy &&
    !loadingDest &&
    !isCalculatingFee &&
    feeError == null &&
    estimate != null &&
    !uneconomical &&
    destAddress !== '' &&
    destWalletId != null

  const canPick =
    bitcoinWallets.length > 1 && !busy && !loadingDest && navigation != null

  const grossLine =
    estimate != null
      ? formatSatsLine(
          wallet,
          estimate.grossAmountSats,
          exchangeRates,
          defaultIsoFiat
        )
      : undefined
  const feeLine =
    estimate != null
      ? formatSatsLine(
          wallet,
          estimate.estimatedFeeSats,
          exchangeRates,
          defaultIsoFiat
        )
      : undefined
  const netLine =
    estimate != null
      ? formatSatsLine(
          wallet,
          estimate.netAmountSats,
          exchangeRates,
          defaultIsoFiat
        )
      : undefined

  const feePercent =
    estimate != null ? toFixed(String(estimate.feeRatio * 100), 0, 1) : '0'

  const timelockBlocks = estimate?.timelockBlocks ?? 144

  return (
    <EdgeModal
      bridge={bridge}
      warning
      title={lstrings.arkade_exit_title}
      onCancel={handleCancel}
      scroll
    >
      <Paragraph>{lstrings.arkade_exit_body}</Paragraph>

      <EdgeCard marginRem={[1, 0]}>
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <EdgeText style={styles.summaryLabel}>
              {lstrings.arkade_exit_gross_label}
            </EdgeText>
            {isCalculatingFee ? (
              <EdgeText style={styles.summaryValue}>
                {lstrings.arkade_exit_calculating_fees}
              </EdgeText>
            ) : grossLine != null ? (
              <View style={styles.summaryValueCol}>
                <EdgeText style={styles.summaryValue}>
                  {grossLine.crypto}
                </EdgeText>
                {grossLine.fiat !== '' ? (
                  <EdgeText style={styles.summaryFiat}>
                    {grossLine.fiat}
                  </EdgeText>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.summaryRow}>
            <EdgeText style={styles.summaryLabel}>
              {lstrings.arkade_exit_fee_label}
            </EdgeText>
            {isCalculatingFee ? (
              <EdgeText style={styles.summaryValue}>
                {lstrings.arkade_exit_calculating_fees}
              </EdgeText>
            ) : feeLine != null && estimate != null ? (
              <View style={styles.summaryValueCol}>
                <EdgeText style={styles.summaryValue}>
                  {`- ${feeLine.crypto}`}
                </EdgeText>
                <EdgeText style={styles.summaryDetail}>
                  {sprintf(
                    lstrings.arkade_exit_fee_detail_2s,
                    String(estimate.vBytes),
                    String(estimate.feeRateSatvB)
                  )}
                </EdgeText>
              </View>
            ) : null}
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <EdgeText style={styles.netLabel}>
              {lstrings.arkade_exit_net_label}
            </EdgeText>
            {isCalculatingFee ? (
              <EdgeText style={styles.netValue}>
                {lstrings.arkade_exit_calculating_fees}
              </EdgeText>
            ) : netLine != null ? (
              <View style={styles.summaryValueCol}>
                <EdgeText style={styles.netValue}>{netLine.crypto}</EdgeText>
                {netLine.fiat !== '' ? (
                  <EdgeText style={styles.summaryFiat}>{netLine.fiat}</EdgeText>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </EdgeCard>

      {feeError != null ? (
        <AlertCardUi4
          type="error"
          title={lstrings.arkade_exit_uneconomical_title}
          body={feeError}
          marginRem={[0.5, 0]}
        />
      ) : null}

      {!isCalculatingFee && estimate?.highFeeImpact === true ? (
        <AlertCardUi4
          type="warning"
          title={lstrings.arkade_exit_high_fee_title}
          body={sprintf(lstrings.arkade_exit_high_fee_body_1s, feePercent)}
          marginRem={[0.5, 0]}
        />
      ) : null}

      {!isCalculatingFee && uneconomical ? (
        <AlertCardUi4
          type="error"
          title={lstrings.arkade_exit_uneconomical_title}
          body={lstrings.arkade_exit_uneconomical_body}
          marginRem={[0.5, 0]}
        />
      ) : null}

      <WarningCard
        title={lstrings.arkade_exit_warning_title}
        points={[
          sprintf(
            lstrings.arkade_exit_timelock_bullet_1s,
            String(timelockBlocks)
          ),
          lstrings.arkade_exit_emergency_bullet,
          lstrings.arkade_exit_cpfp_fund_bullet
        ]}
        marginRem={[1, 0.5]}
      />

      <EdgeCard marginRem={[0.5, 0]}>
        {loadingFeeAddress ? (
          <EdgeText style={styles.feeAddressHint}>
            {lstrings.arkade_exit_fee_address_loading}
          </EdgeText>
        ) : feeAddressError != null ? (
          <EdgeText style={styles.feeAddressError}>{feeAddressError}</EdgeText>
        ) : feeAddress !== '' ? (
          <EdgeRow
            title={lstrings.arkade_exit_fee_address_label}
            body={feeAddress}
            maximumHeight="large"
            rightButtonType="none"
            onPress={handleCopyFeeAddress}
          />
        ) : null}
      </EdgeCard>

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

      <View style={styles.slider}>
        <SafeSlider
          disabled={!canConfirm}
          onSlidingComplete={handleConfirm}
          confirmText={lstrings.send_confirmation_slide_to_confirm}
          disabledText={lstrings.send_confirmation_slide_to_confirm}
        />
      </View>
    </EdgeModal>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  summary: {
    gap: theme.rem(0.75)
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.rem(0.5)
  },
  summaryLabel: {
    color: theme.secondaryText,
    flex: 1,
    fontSize: theme.rem(0.75)
  },
  summaryValueCol: {
    flex: 1,
    alignItems: 'flex-end'
  },
  summaryValue: {
    color: theme.primaryText,
    fontSize: theme.rem(0.75),
    textAlign: 'right'
  },
  summaryFiat: {
    color: theme.secondaryText,
    fontSize: theme.rem(0.65),
    textAlign: 'right',
    marginTop: theme.rem(0.15)
  },
  summaryDetail: {
    color: theme.secondaryText,
    fontSize: theme.rem(0.65),
    textAlign: 'right',
    marginTop: theme.rem(0.15)
  },
  divider: {
    height: 1,
    backgroundColor: theme.lineDivider,
    marginVertical: theme.rem(0.25)
  },
  netLabel: {
    color: theme.primaryText,
    flex: 1,
    fontFamily: theme.fontFaceBold,
    fontSize: theme.rem(0.85)
  },
  netValue: {
    color: theme.primaryText,
    fontFamily: theme.fontFaceBold,
    fontSize: theme.rem(0.85),
    textAlign: 'right'
  },
  feeAddressHint: {
    color: theme.secondaryText,
    fontSize: theme.rem(0.75),
    padding: theme.rem(0.5)
  },
  feeAddressError: {
    color: theme.dangerText,
    fontSize: theme.rem(0.75),
    padding: theme.rem(0.5)
  },
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
  slider: {
    marginVertical: theme.rem(1)
  }
}))
