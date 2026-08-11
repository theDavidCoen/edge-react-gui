import type { EdgeCurrencyWallet } from 'edge-core-js'

/**
 * True when the wallet was imported from an xpub/ypub/zpub (no private keys).
 *
 * EdgeCurrencyWallet does not expose private `keys` to the GUI — only
 * `publicWalletInfo`, which is filled by `derivePublicKey`. Watch-only imports
 * set `watchOnly: true` on that public blob.
 */
export function isWatchOnlyWallet(wallet: EdgeCurrencyWallet): boolean {
  const keys = wallet.publicWalletInfo?.keys as
    | { watchOnly?: boolean }
    | undefined
  return keys?.watchOnly === true
}

/** UTXO extended-import seed types stored on wallet keys. */
export type WalletImportSeedType = 'bip39' | 'electrum' | 'aezeed' | 'slip39'

export function getWalletImportSeedType(
  wallet: EdgeCurrencyWallet
): WalletImportSeedType | undefined {
  const keys = wallet.publicWalletInfo?.keys as
    | { seedType?: WalletImportSeedType }
    | undefined
  return keys?.seedType
}
