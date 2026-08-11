/**
 * Extended UTXO import modes exposed in CreateWalletImportScene.
 */
export type UtxoImportMode =
  | 'auto'
  | 'bip39'
  | 'electrum'
  | 'aezeed'
  | 'slip39'
  | 'xpub'

export const UTXO_IMPORT_MODE_LABELS: Record<UtxoImportMode, string> = {
  auto: 'Auto-detect',
  bip39: 'BIP39 seed',
  electrum: 'Electrum seed',
  aezeed: 'aezeed (LND)',
  slip39: 'SLIP39 shares',
  xpub: 'Watch-only (xpub)'
}

export const UTXO_IMPORT_MODE_HINTS: Record<UtxoImportMode, string> = {
  auto: 'Detect BIP39, Electrum, aezeed, SLIP39, or xpub automatically.',
  bip39: 'Standard 12/24-word recovery phrase (BIP39).',
  electrum: 'Electrum seed version 2+ (legacy, segwit, or 2FA prefixes).',
  aezeed:
    'Lightning Labs aezeed cipher seed (23 words) with optional password.',
  slip39: 'Enter Shamir shares one at a time until the threshold is met.',
  xpub: 'Extended public key only — balances visible, sending disabled.'
}
