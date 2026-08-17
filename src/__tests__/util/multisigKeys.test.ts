import { describe, expect, it } from '@jest/globals'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'

import {
  deriveBip48AccountFromPrivateMaterial,
  deriveBip48AccountNode,
  deriveLegacyBip49AccountFromPrivateMaterial,
  isBip48NativeSegwitAccountXpub,
  walletSeedFromPrivateKeys
} from '../../util/multisig/multisigKeys'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('multisigKeys BIP-48 from shell seed', () => {
  it('extracts bitcoinKey from Edge raw keys', () => {
    expect(
      walletSeedFromPrivateKeys({
        format: 'bip49',
        bitcoinKey: MNEMONIC,
        coinType: 0
      })
    ).toBe(MNEMONIC)
  })

  it("derives m/48'/0'/0'/2' (depth 4, index 2') from the mnemonic", () => {
    const info = deriveBip48AccountFromPrivateMaterial(MNEMONIC)
    const node = HDKey.fromExtendedKey(info.xpub)
    expect(node.depth).toBe(4)
    expect(node.index).toBe(0x80000002)
    expect(info.keyOrigin).toBe('bip48')
    expect(isBip48NativeSegwitAccountXpub(info.xpub)).toBe(true)

    const expected = deriveBip48AccountNode(
      HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC))
    ).publicExtendedKey
    expect(info.xpub).toBe(expected)
  })

  it('BIP-48 xpub is not the BIP-49 shell account xpub', () => {
    const bip48 = deriveBip48AccountFromPrivateMaterial(MNEMONIC)
    const bip49 = deriveLegacyBip49AccountFromPrivateMaterial(MNEMONIC)
    expect(bip48.xpub).not.toBe(bip49.xpub)
    expect(isBip48NativeSegwitAccountXpub(bip49.xpub)).toBe(false)
  })

  it("matches HDKey.derive(m/48'/0'/0'/2') not the origin label", () => {
    const info = deriveBip48AccountFromPrivateMaterial(MNEMONIC)
    const viaPath = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC)).derive(
      "m/48'/0'/0'/2'"
    ).publicExtendedKey
    const viaBip49 = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC)).derive(
      "m/49'/0'/0'"
    ).publicExtendedKey
    expect(info.xpub).toBe(viaPath)
    expect(info.xpub).not.toBe(viaBip49)
  })
})
