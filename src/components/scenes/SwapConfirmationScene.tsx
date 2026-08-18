import { useIsFocused } from '@react-navigation/native'
import { add, div, gt, gte, lte, sub, toFixed } from 'biggystring'
import type { EdgeSwapQuote, EdgeSwapResult } from 'edge-core-js'
import React, { useState } from 'react'
import { SectionList, type ViewStyle } from 'react-native'
import { sprintf } from 'sprintf-js'

import { requestMultisigSwapSpend } from '../../actions/MultisigActions'
import { updateSwapCount } from '../../actions/RequestReviewActions'
import { useSwapRequestOptions } from '../../hooks/swap/useSwapRequestOptions'
import { useHandler } from '../../hooks/useHandler'
import { useMount } from '../../hooks/useMount'
import { useRowLayout } from '../../hooks/useRowLayout'
import { useUnmount } from '../../hooks/useUnmount'
import { formatNumber } from '../../locales/intl'
import { lstrings } from '../../locales/strings'
import {
  getExchangeDenom,
  selectDisplayDenom
} from '../../selectors/DenominationSelectors'
import { convertCurrency } from '../../selectors/WalletSelectors'
import { useDispatch, useSelector } from '../../types/reactRedux'
import type { ThunkAction } from '../../types/reduxTypes'
import type { SwapTabSceneProps } from '../../types/routerTypes'
import type { GuiSwapInfo } from '../../types/types'
import { restoreSwapQuotesForUi } from '../../util/arkade'
import { getSwapPluginIconUri } from '../../util/CdnUris'
import { CryptoAmount } from '../../util/CryptoAmount'
import { logActivity } from '../../util/logger'
import {
  getMultisigProposalByWalletId,
  loadMultisigStore
} from '../../util/multisig/store'
import { logEvent } from '../../util/tracking'
import { convertNativeToExchange, DECIMAL_PRECISION } from '../../util/utils'
import { AlertCardUi4 } from '../cards/AlertCard'
import { EdgeCard } from '../cards/EdgeCard'
import { PoweredByCard } from '../cards/PoweredByCard'
import {
  EdgeAnim,
  fadeInDown30,
  fadeInDown60,
  fadeInDown90,
  fadeInDown120,
  fadeInUp30,
  fadeInUp60
} from '../common/EdgeAnim'
import { SceneWrapper } from '../common/SceneWrapper'
import { SceneContainer } from '../layout/SceneContainer'
import { ButtonsModal } from '../modals/ButtonsModal'
import { EdgeModal } from '../modals/EdgeModal'
import { swapVerifyTerms } from '../modals/SwapVerifyTermsModal'
import { CircleTimer } from '../progress-indicators/CircleTimer'
import { SwapProviderRow } from '../rows/SwapProviderRow'
import { Airship, showError } from '../services/AirshipInstance'
import { cacheStyles, type Theme, useTheme } from '../services/ThemeContext'
import { ExchangeQuote } from '../themed/ExchangeQuoteComponent'
import { LineTextDivider } from '../themed/LineTextDivider'
import { ModalFooter } from '../themed/ModalParts'
import { SafeSlider } from '../themed/SafeSlider'
import { WalletListSectionHeader } from '../themed/WalletListSectionHeader'

const PRICE_IMPACT_WARNING_THRESHOLD = 0.05

/** Thrown by the makeSpend proxy to capture the deposit address without completing the spend. */
class MultisigDepositAddressCaptured extends Error {
  readonly depositAddress: string
  readonly nativeAmount: string
  constructor(depositAddress: string, nativeAmount: string) {
    super('multisig-deposit-address-captured')
    this.depositAddress = depositAddress
    this.nativeAmount = nativeAmount
  }
}

export interface SwapConfirmationParams {
  selectedQuote: EdgeSwapQuote
  quotes: EdgeSwapQuote[]
  onApprove: () => void
}

interface Props extends SwapTabSceneProps<'swapConfirmation'> {}

interface Section {
  title: { title: string; rightTitle: string }
  data: EdgeSwapQuote[]
}

export const SwapConfirmationScene: React.FC<Props> = (props: Props) => {
  const { route, navigation } = props
  const { onApprove } = route.params

  const dispatch = useDispatch()
  const theme = useTheme()
  const styles = getStyles(theme)

  const account = useSelector(state => state.core.account)
  const defaultIsoFiat = useSelector(state => state.ui.settings.defaultIsoFiat)
  const exchangeRates = useSelector(state => state.exchangeRates)

  const quotes = React.useMemo(
    () => restoreSwapQuotesForUi(route.params.quotes, account),
    [account, route.params.quotes]
  )

  const [pending, setPending] = useState(false)

  const swapRequestOptions = useSwapRequestOptions()

  const isFocused = useIsFocused()

  const termsCheckPending = React.useRef(false)
  const timerExpiredDuringTerms = React.useRef(false)

  const pickBestQuoteWithPreference = (
    allQuotes: EdgeSwapQuote[]
  ): EdgeSwapQuote => {
    const { preferType } = swapRequestOptions
    if (preferType != null) {
      const wantDex = preferType === 'DEX'
      const preferredQuotes = allQuotes.filter(q => {
        const isDex = q.swapInfo.isDex === true
        return isDex === wantDex
      })
      if (preferredQuotes.length > 0) {
        return pickBestQuote(preferredQuotes)
      }
    }
    return pickBestQuote(allQuotes)
  }

  const [selectedQuote, setSelectedQuote] = useState(() => {
    const initial =
      route.params.selectedQuote != null
        ? restoreSwapQuotesForUi([route.params.selectedQuote], account)[0]
        : undefined
    if (initial != null) return initial
    return pickBestQuoteWithPreference(quotes)
  })
  const [calledApprove, setCalledApprove] = useState(false)

  const feeFiat = useSelector(state =>
    convertCurrency(
      state.exchangeRates,
      selectedQuote.pluginId,
      selectedQuote.networkFee.tokenId,
      state.ui.settings.defaultIsoFiat,
      selectedQuote.networkFee.nativeAmount
    )
  )

  const { request } = selectedQuote
  const { quoteFor } = request

  // Detect complete multisig from-wallet for warning banner and slide intercept.
  const isSwapFromMultisig = React.useMemo(() => {
    const fromWalletId = selectedQuote.request?.fromWallet?.id
    const fromTokenId = selectedQuote.request?.fromTokenId
    if (fromWalletId == null || fromTokenId !== null) return false
    const proposal = getMultisigProposalByWalletId(fromWalletId)
    return proposal?.status === 'complete'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuote.request?.fromWallet?.id, account.id])

  const priceImpact = React.useMemo(() => {
    const { fromWallet, fromTokenId, toWallet, toTokenId } = request

    const fromExchangeDenom = getExchangeDenom(
      fromWallet.currencyConfig,
      fromTokenId
    )
    const toExchangeDenom = getExchangeDenom(toWallet.currencyConfig, toTokenId)

    const fromExchangeAmount = convertNativeToExchange(
      fromExchangeDenom.multiplier
    )(selectedQuote.fromNativeAmount)
    const toExchangeAmount = convertNativeToExchange(
      toExchangeDenom.multiplier
    )(selectedQuote.toNativeAmount)

    const fromFiatValue = convertCurrency(
      exchangeRates,
      fromWallet.currencyInfo.pluginId,
      fromTokenId,
      defaultIsoFiat,
      fromExchangeAmount
    )
    const toFiatValue = convertCurrency(
      exchangeRates,
      toWallet.currencyInfo.pluginId,
      toTokenId,
      defaultIsoFiat,
      toExchangeAmount
    )

    if (lte(fromFiatValue, '0')) return undefined

    const impact = parseFloat(
      div(sub(fromFiatValue, toFiatValue), fromFiatValue, 8)
    )
    return impact > 0 ? impact : undefined
  }, [selectedQuote, exchangeRates, defaultIsoFiat, request])

  const showPriceImpact =
    priceImpact != null && priceImpact >= PRICE_IMPACT_WARNING_THRESHOLD

  const scrollPadding = React.useMemo<ViewStyle>(
    () => ({
      paddingBottom: theme.rem(ModalFooter.bottomRem)
    }),
    [theme]
  )

  const sectionList = React.useMemo(() => {
    const rightTitle =
      quoteFor === 'to'
        ? lstrings.quote_exchange_cost
        : lstrings.quote_payout_amount
    return [
      {
        title: { title: lstrings.quote_selected_quote, rightTitle },
        data: [selectedQuote]
      },
      {
        title: { title: lstrings.quote_fixed_quotes, rightTitle },
        data: [...quotes.filter((quote: EdgeSwapQuote) => !quote.isEstimate)]
      },
      {
        title: { title: lstrings.quote_variable_quotes, rightTitle },
        data: [...quotes.filter((quote: EdgeSwapQuote) => quote.isEstimate)]
      }
    ].filter(section => section.data.length > 0)
  }, [quoteFor, quotes, selectedQuote])

  const { pluginId } = selectedQuote

  const swapConfig = account.swapConfig[pluginId]
  const exchangeName = swapConfig?.swapInfo.displayName ?? '' // HACK: for unit tests to run
  const feePercent = div(
    selectedQuote.networkFee.nativeAmount,
    selectedQuote.fromNativeAmount,
    2
  )
  const showFeeWarning = gt(feeFiat, '0.01') && gte(feePercent, '0.05')

  const handleExchangeTimerExpired = useHandler(() => {
    if (!isFocused) return
    if (termsCheckPending.current) {
      timerExpiredDuringTerms.current = true
      return
    }

    navigation.replace('swapProcessing', {
      swapRequest: selectedQuote.request,
      swapRequestOptions,
      onCancel: () => {
        navigation.navigate('swapTab', { screen: 'swapCreate' })
      },
      onDone: refreshedQuotes => {
        const normalized = restoreSwapQuotesForUi(refreshedQuotes, account)
        if (normalized.length === 0) return
        navigation.replace('swapConfirmation', {
          selectedQuote: normalized[0],
          quotes: normalized,
          onApprove
        })
      }
    })
  })

  useMount(() => {
    const swapConfig = account.swapConfig[pluginId]

    dispatch(logEvent('Exchange_Shift_Quote'))
    termsCheckPending.current = true
    swapVerifyTerms(swapConfig)
      .then(async result => {
        termsCheckPending.current = false
        if (!result || timerExpiredDuringTerms.current) {
          handleExchangeTimerExpired()
        }
      })
      .catch((err: unknown) => {
        termsCheckPending.current = false
        showError(err)
        if (timerExpiredDuringTerms.current) {
          handleExchangeTimerExpired()
        }
      })
  })

  // Close the quote if the component unmounts
  useUnmount(() => {
    if (!calledApprove)
      selectedQuote.close().catch((err: unknown) => {
        showError(err)
      })
  })

  const handleSlideComplete = async (reset: () => void): Promise<void> => {
    setCalledApprove(true)
    setPending(true)

    try {
      const {
        fromDisplayAmount,
        fee,
        fromFiat,
        fromTotalFiat,
        toDisplayAmount,
        toFiat
      } = await dispatch(getSwapInfo(selectedQuote))
      const {
        isEstimate,
        fromNativeAmount,
        toNativeAmount,
        networkFee,
        pluginId,
        expirationDate,
        request
      } = selectedQuote
      // Both fromCurrencyCode and toCurrencyCode will exist, since we set them:
      const { toWallet, toTokenId, fromWallet, fromTokenId } = request

      // Multisig P2WSH swap path: intercept the deposit address that the
      // exchange plugin would pass to makeSpend, then route through the
      // PSBT→Nostr cosigner flow with a 5-minute expiry.
      await loadMultisigStore(account)
      const multisigProposal = getMultisigProposalByWalletId(fromWallet.id)
      const isCompleteMultisig =
        multisigProposal != null && multisigProposal.status === 'complete'

      if (isCompleteMultisig && fromTokenId == null) {
        // Proxy makeSpend to capture the deposit address, then abort.
        const originalMakeSpend = fromWallet.makeSpend.bind(fromWallet)
        ;(fromWallet as any).makeSpend = async (spendInfo: any) => {
          const target = spendInfo?.spendTargets?.[0]
          if (target?.publicAddress != null) {
            throw new MultisigDepositAddressCaptured(
              target.publicAddress,
              target.nativeAmount ?? fromNativeAmount
            )
          }
          return await originalMakeSpend(spendInfo)
        }

        let depositAddress: string | undefined
        let spendNativeAmount: string = fromNativeAmount
        try {
          await selectedQuote.approve()
        } catch (err: unknown) {
          if (err instanceof MultisigDepositAddressCaptured) {
            depositAddress = err.depositAddress
            spendNativeAmount = err.nativeAmount
          } else {
            throw err
          }
        } finally {
          // Restore original makeSpend regardless of outcome
          ;(fromWallet as any).makeSpend = originalMakeSpend
        }

        if (depositAddress == null) {
          throw new Error('Could not capture exchange deposit address')
        }

        const privateKeyMaterial = await account.getDisplayPrivateKey(
          fromWallet.id
        )
        dispatch(logEvent('Exchange_Shift_Start'))
        const spend = await dispatch(
          requestMultisigSwapSpend({
            walletId: fromWallet.id,
            destAddress: depositAddress,
            amountNative: spendNativeAmount,
            privateKeyMaterial
          })
        )

        await selectedQuote.close()

        if (spend.status === 'broadcast') {
          navigation.push('swapSuccess', {
            edgeTransaction: {
              blockHeight: 0,
              date: Date.now() / 1000,
              nativeAmount: '-' + spend.amountNative,
              networkFee: spend.feeNative,
              ourReceiveAddresses: [],
              signedTx: '',
              txid: spend.txid ?? '',
              isSend: true,
              walletId: fromWallet.id,
              currencyCode: fromWallet.currencyInfo.currencyCode,
              tokenId: null,
              metadata: {}
            } as any,
            walletId: fromWallet.id
          })
          onApprove()
          await dispatch(updateSwapCount())
        } else {
          navigation.replace('multisigSpendPending', { spendId: spend.id })
        }
        return
      }

      try {
        dispatch(logEvent('Exchange_Shift_Start'))
        const result: EdgeSwapResult = await selectedQuote.approve()

        logActivity(`Swap Exchange Executed: ${account.username}`)
        logActivity(`
    fromDisplayAmount: ${fromDisplayAmount}
    fee: ${fee}
    fromFiat: ${fromFiat}
    fromTotalFiat: ${fromTotalFiat}
    toDisplayAmount: ${toDisplayAmount}
    toFiat: ${toFiat}
    quote:
      pluginId: ${pluginId}
      isEstimate: ${isEstimate.toString()}
      fromNativeAmount: ${fromNativeAmount}
      toNativeAmount: ${toNativeAmount}
      expirationDate: ${
        expirationDate != null ? expirationDate.toISOString() : 'no expiration'
      }
      networkFee:
        tokenId ${String(networkFee.tokenId)}
        nativeAmount ${networkFee.nativeAmount}
`)

        navigation.push('swapSuccess', {
          edgeTransaction: result.transaction,
          walletId: request.fromWallet.id
        })

        // Dispatch the success action and callback
        onApprove()

        await dispatch(updateSwapCount())

        dispatch(
          logEvent('Exchange_Shift_Success', {
            conversionValues: {
              conversionType: 'swap',
              destAmount: new CryptoAmount({
                nativeAmount: toNativeAmount,
                tokenId: toTokenId,
                currencyConfig: toWallet.currencyConfig
              }),
              sourceAmount: new CryptoAmount({
                nativeAmount: fromNativeAmount,
                tokenId: fromTokenId,
                currencyConfig: fromWallet.currencyConfig
              }),
              isBuiltInAsset:
                (toTokenId == null ||
                  toWallet.currencyConfig.builtinTokens[toTokenId] != null) &&
                (fromTokenId == null ||
                  fromWallet.currencyConfig.builtinTokens[fromTokenId] != null),
              orderId: result.orderId,
              swapProviderId: pluginId
            }
          })
        )
      } catch (error: any) {
        dispatch(logEvent('Exchange_Shift_Failed', { error: String(error) })) // TODO: Do we need to parse/clean all causes?
        setTimeout(() => {
          showError(error)
        }, 1)
      }

      await selectedQuote.close()
    } finally {
      setPending(false)
      reset()
    }
  }

  const renderTimer = (): React.ReactElement | null => {
    const { expirationDate } = selectedQuote
    if (expirationDate == null) return null
    return (
      <CircleTimer
        timeExpired={handleExchangeTimerExpired}
        expiration={expirationDate}
      />
    )
  }

  const renderRow = useHandler(
    (item: { item: EdgeSwapQuote; section: Section; index: number }) => {
      const quote = item.item
      return (
        <EdgeCard
          onPress={() => {
            setSelectedQuote(quote)
            Airship.clear()
          }}
        >
          <SwapProviderRow quote={quote} />
        </EdgeCard>
      )
    }
  )

  const renderSectionHeader = useHandler((sectionObj: { section: Section }) => {
    return (
      <WalletListSectionHeader
        title={sectionObj.section.title.title}
        rightTitle={sectionObj.section.title.rightTitle}
      />
    )
  })

  const handleItemLayout = useRowLayout()

  const handlePoweredByTap = useHandler(async (): Promise<void> => {
    await Airship.show(bridge => (
      <EdgeModal
        bridge={bridge}
        onCancel={() => {
          bridge.resolve()
        }}
        title={lstrings.quote_swap_provider}
        scroll
      >
        <SectionList
          style={styles.container}
          contentContainerStyle={scrollPadding}
          getItemLayout={handleItemLayout}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item, index) => item.swapInfo.displayName + index}
          renderItem={renderRow}
          renderSectionHeader={renderSectionHeader}
          sections={sectionList}
        />
      </EdgeModal>
    ))
  })

  const handleCanBePartialExplanation = async (): Promise<void> => {
    const { canBePartial, maxFulfillmentSeconds } = selectedQuote
    let canBePartialString: string | undefined
    if (canBePartial === true) {
      if (maxFulfillmentSeconds != null) {
        const t = Math.ceil(maxFulfillmentSeconds / 60)
        canBePartialString = sprintf(
          lstrings.can_be_partial_quote_with_max_body,
          t.toString()
        )
      } else {
        canBePartialString = lstrings.can_be_partial_quote_body
      }
    }
    await Airship.show<'ok' | undefined>(bridge => (
      <ButtonsModal
        bridge={bridge}
        title={lstrings.can_be_partial_quote_title}
        message={canBePartialString}
        buttons={{ ok: { label: lstrings.string_ok } }}
      />
    ))
  }
  return (
    <SceneWrapper hasTabs hasNotifications scroll>
      <SceneContainer headerTitle={lstrings.title_exchange}>
        {showPriceImpact && showFeeWarning ? (
          <EdgeAnim enter={fadeInUp60}>
            <AlertCardUi4
              title={lstrings.swap_price_impact_fee_warning_title}
              body={lstrings.swap_price_impact_fee_warning_body}
              type="warning"
            />
          </EdgeAnim>
        ) : showPriceImpact ? (
          <EdgeAnim enter={fadeInUp60}>
            <AlertCardUi4
              title={lstrings.swap_price_impact_warning_title}
              body={lstrings.swap_price_impact_warning_body}
              type="warning"
            />
          </EdgeAnim>
        ) : showFeeWarning ? (
          <EdgeAnim enter={fadeInUp60}>
            <AlertCardUi4
              title={lstrings.transaction_details_fee_warning}
              type="warning"
            />
          </EdgeAnim>
        ) : null}

        <EdgeAnim enter={fadeInUp30}>
          <ExchangeQuote
            quote={selectedQuote}
            fromTo="from"
            showFeeWarning={showFeeWarning}
          />
        </EdgeAnim>
        <EdgeAnim>
          <LineTextDivider title={lstrings.string_to_capitalize} lowerCased />
        </EdgeAnim>
        <EdgeAnim enter={fadeInDown30}>
          <ExchangeQuote
            quote={selectedQuote}
            fromTo="to"
            priceImpact={priceImpact}
          />
        </EdgeAnim>
        <EdgeAnim enter={fadeInDown60}>
          <PoweredByCard
            iconUri={getSwapPluginIconUri(selectedQuote.pluginId, theme)}
            poweredByText={exchangeName}
            onPress={handlePoweredByTap}
          />
        </EdgeAnim>
        {selectedQuote.isEstimate && !showPriceImpact ? (
          <EdgeAnim enter={fadeInDown90}>
            <AlertCardUi4
              title={lstrings.estimated_quote}
              body={lstrings.estimated_exchange_message}
              type="warning"
            />
          </EdgeAnim>
        ) : null}
        {selectedQuote.canBePartial === true ? (
          <EdgeAnim enter={fadeInDown90}>
            <AlertCardUi4
              title={lstrings.can_be_partial_quote_title}
              body={lstrings.can_be_partial_quote_message}
              type="warning"
              button={{
                label: lstrings.learn_more,
                onPress: handleCanBePartialExplanation
              }}
            />
          </EdgeAnim>
        ) : null}

        {isSwapFromMultisig ? (
          <EdgeAnim enter={fadeInDown120}>
            <AlertCardUi4
              title={lstrings.multisig_swap_cosign_required_title}
              body={lstrings.multisig_swap_cosign_required_body}
              type="warning"
            />
          </EdgeAnim>
        ) : null}

        <EdgeAnim enter={fadeInDown120}>
          <SafeSlider
            parentStyle={styles.slider}
            onSlidingComplete={handleSlideComplete}
            disabled={pending}
          />
        </EdgeAnim>
        {renderTimer()}
      </SceneContainer>
    </SceneWrapper>
  )
}

const getStyles = cacheStyles((theme: Theme) => ({
  container: {
    paddingTop: theme.rem(1)
  },
  header: {
    marginLeft: -theme.rem(0.5),
    width: '100%',
    marginBottom: theme.rem(1)
  },
  slider: {
    marginTop: theme.rem(1),
    marginBottom: theme.rem(3)
  }
}))

// TODO: Use new hooks and utility methods for all conversions here
const getSwapInfo = (
  quote: EdgeSwapQuote
): ThunkAction<Promise<GuiSwapInfo>> => {
  return async (_dispatch, getState) => {
    const state = getState()
    const { defaultFiat, defaultIsoFiat } = state.ui.settings

    // Currency conversion tools:
    // Both fromCurrencyCode and toCurrencyCode will exist, since we set them:
    const { request } = quote
    const { fromWallet, toWallet, fromTokenId, toTokenId } = request

    // Format from amount:
    const fromDisplayDenomination = selectDisplayDenom(
      state,
      fromWallet.currencyConfig,
      fromTokenId
    )
    const fromDisplayAmountTemp = div(
      quote.fromNativeAmount,
      fromDisplayDenomination.multiplier,
      DECIMAL_PRECISION
    )
    const fromDisplayAmount = toFixed(fromDisplayAmountTemp, 0, 8)

    // Format from fiat:
    const fromExchangeDenomination = getExchangeDenom(
      fromWallet.currencyConfig,
      fromTokenId
    )
    const fromBalanceInCryptoDisplay = convertNativeToExchange(
      fromExchangeDenomination.multiplier
    )(quote.fromNativeAmount)
    const fromBalanceInFiatRaw = parseFloat(
      convertCurrency(
        state.exchangeRates,
        fromWallet.currencyInfo.pluginId,
        fromTokenId,
        defaultIsoFiat,
        fromBalanceInCryptoDisplay
      )
    )
    const fromFiat = formatNumber(fromBalanceInFiatRaw ?? 0, { toFixed: 2 })

    // Format crypto fee:
    const feeDenomination = selectDisplayDenom(
      state,
      fromWallet.currencyConfig,
      null
    )
    const feeNativeAmount = quote.networkFee.nativeAmount
    const feeTempAmount = div(
      feeNativeAmount,
      feeDenomination.multiplier,
      DECIMAL_PRECISION
    )
    const feeDisplayAmount = toFixed(feeTempAmount, 0, 6)

    // Format fiat fee:
    const { multiplier } = getExchangeDenom(fromWallet.currencyConfig, null)
    const feeDenominatedAmount = div(
      feeNativeAmount,
      multiplier,
      multiplier.length
    )
    const feeFiatAmountRaw = parseFloat(
      convertCurrency(
        state.exchangeRates,
        request.fromWallet.currencyInfo.pluginId,
        quote.networkFee.tokenId,
        defaultIsoFiat,
        feeDenominatedAmount
      )
    )
    const feeFiatAmount = formatNumber(feeFiatAmountRaw ?? 0, { toFixed: 2 })
    const fee = `${feeDisplayAmount} ${feeDenomination.name} (${feeFiatAmount} ${defaultFiat})`
    const fromTotalFiat = formatNumber(
      add(
        fromBalanceInFiatRaw.toFixed(DECIMAL_PRECISION),
        feeFiatAmountRaw.toFixed(DECIMAL_PRECISION)
      ),
      { toFixed: 2 }
    )

    // Format to amount:
    const toDisplayDenomination = selectDisplayDenom(
      state,
      toWallet.currencyConfig,
      toTokenId
    )
    const toDisplayAmountTemp = div(
      quote.toNativeAmount,
      toDisplayDenomination.multiplier,
      DECIMAL_PRECISION
    )
    const toDisplayAmount = toFixed(toDisplayAmountTemp, 0, 8)

    // Format to fiat:
    const toExchangeDenomination = getExchangeDenom(
      toWallet.currencyConfig,
      toTokenId
    )
    const toBalanceInCryptoDisplay = convertNativeToExchange(
      toExchangeDenomination.multiplier
    )(quote.toNativeAmount)
    const toBalanceInFiatRaw = parseFloat(
      convertCurrency(
        state.exchangeRates,
        toWallet.currencyInfo.pluginId,
        toTokenId,
        defaultIsoFiat,
        toBalanceInCryptoDisplay
      )
    )
    const toFiat = formatNumber(toBalanceInFiatRaw ?? 0, { toFixed: 2 })

    const swapInfo: GuiSwapInfo = {
      fee,
      fromDisplayAmount,
      fromFiat,
      fromTotalFiat,
      toDisplayAmount,
      toFiat
    }
    return swapInfo
  }
}

const getBetterQuoteRate = (
  quoteA: EdgeSwapQuote,
  quoteB: EdgeSwapQuote
): EdgeSwapQuote => {
  const aRate = div(
    quoteA.toNativeAmount,
    quoteA.fromNativeAmount,
    DECIMAL_PRECISION
  )
  const bRate = div(
    quoteB.toNativeAmount,
    quoteB.fromNativeAmount,
    DECIMAL_PRECISION
  )
  return gte(aRate, bRate) ? quoteA : quoteB
}

export const pickBestQuote = (quotes: EdgeSwapQuote[]): EdgeSwapQuote => {
  if (!Array.isArray(quotes) || quotes.length === 0) {
    throw new Error('Expected at least one swap quote')
  }
  if (quotes.length === 1) return quotes[0]

  const best = quotes.reduce((bestQuote, quote) => {
    const { swapInfo, isEstimate } = quote
    if (swapInfo == null) return bestQuote
    const { isDex = false } = swapInfo
    const { isEstimate: isBestQuoteEstimate } = bestQuote
    const isBestQuoteDex = bestQuote.swapInfo.isDex === true

    // If the quote isDex and has a better rate, pick the quote
    if (isDex) {
      return getBetterQuoteRate(quote, bestQuote)
    }

    // If best quote isDex and new quote is fixed. Pick the better rate
    if (isBestQuoteDex) {
      if (!isEstimate) {
        return getBetterQuoteRate(quote, bestQuote)
      }
      return bestQuote
    }

    // Neither quotes are isDex. If both quotes are estimates or fixed,
    // pick the better rate
    if (
      (!isEstimate && !isBestQuoteEstimate) ||
      (isEstimate && isBestQuoteEstimate)
    ) {
      return getBetterQuoteRate(quote, bestQuote)
    }

    // Pick the fixed quote
    if (!isEstimate) {
      return quote
    } else {
      // This has to be a fixed quote
      return bestQuote
    }
  })

  return best
}
