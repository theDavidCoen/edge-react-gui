import type { EdgeCurrencyWallet, EdgeTokenId } from 'edge-core-js'
import * as React from 'react'

import { useMultisigP2wshBalance } from '../util/multisig/useMultisigP2wshBalance'

/**
 * Subscribes to a specific balance within a wallet.
 * Complete multisig wallets use shared P2WSH sats for the native asset.
 */
export function useWalletBalance(
  wallet: EdgeCurrencyWallet,
  tokenId: EdgeTokenId
): string {
  const p2wshBalanceSats = useMultisigP2wshBalance(wallet.id)
  // The core still reports balances by currency code:
  const [out, setOut] = React.useState<string>(
    wallet.balanceMap.get(tokenId) ?? '0'
  )

  React.useEffect(() => {
    setOut(wallet.balanceMap.get(tokenId) ?? '0')
    return wallet.watch('balanceMap', () => {
      setOut(wallet.balanceMap.get(tokenId) ?? '0')
    })
  }, [wallet, tokenId])

  if (tokenId == null && p2wshBalanceSats != null) {
    return p2wshBalanceSats
  }
  return out
}
