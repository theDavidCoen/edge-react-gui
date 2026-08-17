import type { EdgeTokenId } from 'edge-core-js'

import { getCachedP2wshWatch } from './p2wshWatch'
import { isCompleteMultisigWallet } from './store'

/**
 * Native balance for UI / portfolio totals.
 * Complete multisig Bitcoin wallets use shared P2WSH (Blockbook), not bip49.
 */
export const getEffectiveNativeBalance = (
  walletId: string,
  tokenId: EdgeTokenId,
  coreBalance: string
): string => {
  if (tokenId != null) return coreBalance
  if (!isCompleteMultisigWallet(walletId)) return coreBalance
  const p2wsh = getCachedP2wshWatch(walletId)?.balanceSats
  return p2wsh ?? coreBalance
}
