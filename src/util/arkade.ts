import { asBoolean, asObject, asOptional, asString } from 'cleaners'
import type {
  EdgeAccount,
  EdgeAddress,
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgeSwapQuote,
  EdgeSwapRequest
} from 'edge-core-js'

import {
  DEFAULT_ARK_SERVER_URL,
  DEFAULT_DELEGATOR_URL,
  DEFAULT_LNURL_SERVER_URL
} from './arkadeDefaults'

/**
 * Arkade Asset Settings shape (must match plugin `defaultSettings` so
 * `maybeCurrencySetting` shows the section).
 */
export const asArkadeUserSettings = asObject({
  arkServerUrl: asOptional(asString, DEFAULT_ARK_SERVER_URL),
  lnurlServerUrl: asOptional(asString, DEFAULT_LNURL_SERVER_URL),
  enableCustomArkServer: asOptional(asBoolean, false),
  customArkServerUrl: asOptional(asString, ''),
  enableDelegate: asOptional(asBoolean, true),
  enableCustomDelegate: asOptional(asBoolean, false),
  customDelegatorUrl: asOptional(asString, ''),
  defaultDelegatorUrl: asOptional(asString, DEFAULT_DELEGATOR_URL)
})

export type ArkadeUserSettings = ReturnType<typeof asArkadeUserSettings>

export const ARKADE_PLUGIN_ID = 'ark' + 'ade'

const BITCOIN_PLUGIN_ID = 'bitcoin'
const BITCOIN_WALLET_TYPE = 'wallet:bitcoin'

export interface ArkadeOnchainSwapEligibility {
  eligible: boolean
  code: string
  message: string
}

export class ArkadeOnchainSwapIneligibleError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'ArkadeOnchainSwapIneligibleError'
    this.code = code
  }
}

export const isArkadeWallet = (wallet: {
  currencyInfo: { pluginId: string }
}): boolean => wallet.currencyInfo.pluginId === ARKADE_PLUGIN_ID

export const isArkadeOnchainSwapIneligibleError = (
  error: unknown
): error is ArkadeOnchainSwapIneligibleError =>
  error instanceof ArkadeOnchainSwapIneligibleError

/**
 * Arkade → other asset swaps need an onchain BTC leg.
 * Engine prefers Boltz ARK→BTC (Arkade Wallet); settles via ASP only as fallback.
 */
export const checkArkadeOnchainSwapEligibility = async (
  wallet: EdgeCurrencyWallet,
  nativeAmount?: string
): Promise<ArkadeOnchainSwapEligibility> => {
  const otherMethods = wallet.otherMethods as {
    arkadeCheckOnchainSwapEligibility?: (params?: {
      nativeAmount?: string
    }) => Promise<ArkadeOnchainSwapEligibility>
  }

  if (otherMethods.arkadeCheckOnchainSwapEligibility == null) {
    return {
      eligible: true,
      code: 'ok',
      message: ''
    }
  }

  return await otherMethods.arkadeCheckOnchainSwapEligibility({
    nativeAmount
  })
}

export const assertArkadeOnchainSwapEligible = async (
  wallet: EdgeCurrencyWallet,
  nativeAmount?: string
): Promise<void> => {
  const result = await checkArkadeOnchainSwapEligibility(wallet, nativeAmount)
  if (!result.eligible) {
    throw new ArkadeOnchainSwapIneligibleError(result.message, result.code)
  }
}

const isArkadeWalletInternal = (wallet: EdgeCurrencyWallet): boolean =>
  isArkadeWallet(wallet)

export const getSwapWalletPluginId = (wallet: {
  currencyInfo: { pluginId: string }
}): string =>
  wallet.currencyInfo.pluginId === ARKADE_PLUGIN_ID
    ? BITCOIN_PLUGIN_ID
    : wallet.currencyInfo.pluginId

const makeSwapCurrencyInfo = (
  currencyInfo: EdgeCurrencyInfo
): EdgeCurrencyInfo => ({
  ...currencyInfo,
  pluginId: BITCOIN_PLUGIN_ID,
  walletType: BITCOIN_WALLET_TYPE
})

const pickSwapAddress = (addresses: EdgeAddress[]): EdgeAddress | undefined =>
  addresses.find(address => address.addressType === 'boardingAddress') ??
  addresses.find(address => address.addressType === 'segwitAddress') ??
  addresses[0]

const normalizeSwapAddresses = (addresses: EdgeAddress[]): EdgeAddress[] => {
  const preferred = pickSwapAddress(addresses)
  if (preferred == null) return addresses

  // Some swap providers use the first address or `getReceiveAddress()` directly.
  // Present the onchain BTC boarding address as the primary swap address.
  return [
    {
      ...preferred,
      addressType: 'publicAddress',
      publicAddress: preferred.publicAddress
    },
    ...addresses
  ]
}

const makeSwapWalletAlias = (
  wallet: EdgeCurrencyWallet
): EdgeCurrencyWallet => {
  if (!isArkadeWalletInternal(wallet)) return wallet

  const aliasedCurrencyInfo = makeSwapCurrencyInfo(wallet.currencyInfo)
  const aliasedCurrencyConfig = {
    ...wallet.currencyConfig,
    currencyInfo: makeSwapCurrencyInfo(wallet.currencyConfig.currencyInfo)
  }

  return new Proxy(wallet, {
    get(target, prop, _receiver) {
      if (prop === 'currencyInfo') return aliasedCurrencyInfo
      if (prop === 'currencyConfig') return aliasedCurrencyConfig
      if (prop === 'type') return BITCOIN_WALLET_TYPE
      if (prop === 'getAddresses') {
        return async (...args: unknown[]) => {
          const addresses = await (
            target.getAddresses as (
              ...args: unknown[]
            ) => Promise<EdgeAddress[]>
          )(...args)
          return normalizeSwapAddresses(addresses)
        }
      }
      if (prop === 'getReceiveAddress' || prop === 'getFreshAddress') {
        return async (...args: unknown[]) => {
          const value = Reflect.get(target, prop, target)
          const addressInfo = await value(...args)
          const addresses = await target.getAddresses({ tokenId: null })
          const preferred = pickSwapAddress(addresses)
          if (preferred == null) return addressInfo
          return {
            ...addressInfo,
            publicAddress: preferred.publicAddress,
            segwitAddress: addressInfo.segwitAddress ?? preferred.publicAddress
          }
        }
      }

      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

/**
 * Arkade holds BTC-denominated funds, but swap routing only knows bitcoin.
 * Present Arkade wallets as bitcoin to swap providers while delegating all
 * wallet calls to the real Arkade wallet instance.
 */
/**
 * Swap quotes may carry Arkade swap-alias Proxy wallets. Restore real wallet
 * instances from the account before UI navigation or confirmation rendering.
 */
export const restoreSwapQuoteWallets = (
  quote: EdgeSwapQuote,
  account: EdgeAccount
): EdgeSwapQuote => {
  const { fromWallet, toWallet, ...rest } = quote.request
  const resolvedFrom = account.currencyWallets[fromWallet.id] ?? fromWallet
  const resolvedTo = account.currencyWallets[toWallet.id] ?? toWallet

  if (resolvedFrom === fromWallet && resolvedTo === toWallet) {
    return quote
  }

  return {
    ...quote,
    request: {
      ...rest,
      fromWallet: resolvedFrom,
      toWallet: resolvedTo
    }
  }
}

export const restoreSwapQuotesForUi = (
  quotes: EdgeSwapQuote[] | undefined,
  account: EdgeAccount
): EdgeSwapQuote[] => {
  if (!Array.isArray(quotes) || quotes.length === 0) return []
  return quotes.map(quote => restoreSwapQuoteWallets(quote, account))
}

export const aliasArkadeSwapRequest = (
  swapRequest: EdgeSwapRequest
): EdgeSwapRequest => {
  const fromWallet = makeSwapWalletAlias(swapRequest.fromWallet)
  const toWallet = makeSwapWalletAlias(swapRequest.toWallet)

  if (
    fromWallet === swapRequest.fromWallet &&
    toWallet === swapRequest.toWallet
  ) {
    return swapRequest
  }

  return {
    ...swapRequest,
    fromWallet,
    toWallet
  }
}
