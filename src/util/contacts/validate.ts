import type { EdgeAccount, EdgeCurrencyWallet } from 'edge-core-js'

import { checkPubAddress } from '../FioAddressUtils'

export type RecipientPurpose = 'send' | 'request'

export const validateRecipientInput = async (
  input: string,
  opts: {
    account: EdgeAccount
    coreWallet: EdgeCurrencyWallet
    currencyCode: string
    purpose: RecipientPurpose
  }
): Promise<boolean> => {
  const trimmed = input.trim()
  if (trimmed === '') return false

  const { account, coreWallet, currencyCode, purpose } = opts
  const fioPlugin = account.currencyConfig.fio

  if (purpose === 'request') {
    if (fioPlugin == null) return false
    return await Promise.resolve(
      fioPlugin.otherMethods.isFioAddressValid(trimmed)
    )
  }

  if (fioPlugin != null) {
    try {
      await checkPubAddress(
        fioPlugin,
        trimmed.toLowerCase(),
        coreWallet.currencyInfo.currencyCode,
        currencyCode
      )
      return true
    } catch {
      // Not a FIO handle for this asset.
    }
  }

  try {
    const parsed = await coreWallet.parseUri(trimmed, currencyCode)
    return parsed.publicAddress != null && parsed.publicAddress !== ''
  } catch {
    return false
  }
}
