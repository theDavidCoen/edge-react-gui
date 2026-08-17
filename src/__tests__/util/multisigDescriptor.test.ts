import { describe, expect, it } from '@jest/globals'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'

import {
  buildMultisigDescriptor,
  deriveBitcoinMultisigFromDescriptor,
  descriptorOriginsMatchXpubs,
  extractParentFingerprint,
  isBip48NativeSegwitAccountXpub,
  parseMultisigDescriptor,
  readExtendedKeyBip32,
  validateCosignerXpubs
} from '../../util/multisig/bitcoinP2wsh'
import { addDescriptorChecksum } from '../../util/multisig/descriptorChecksum'
import { deriveBip48AccountFromPrivateMaterial } from '../../util/multisig/multisigKeys'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow'

const rootFrom = (mnemonic: string): HDKey =>
  HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic))

const bip48XpubAt = (mnemonic: string, accountIndex: number): string =>
  rootFrom(mnemonic).derive(`m/48'/0'/${accountIndex}'/2'`).publicExtendedKey

const bip49AccountXpub = (mnemonic: string): string =>
  rootFrom(mnemonic).derive("m/49'/0'/0'").publicExtendedKey

describe('multisig output descriptors', () => {
  it('builds and parses BIP-380 sortedmulti descriptors', () => {
    const xpubA = bip48XpubAt(MNEMONIC, 0)
    const xpubB = bip48XpubAt(OTHER_MNEMONIC, 0)

    const descriptor = buildMultisigDescriptor(2, [
      { xpub: xpubA, fingerprint: extractParentFingerprint(xpubA) },
      { xpub: xpubB, fingerprint: extractParentFingerprint(xpubB) }
    ])
    expect(descriptor.startsWith('wsh(sortedmulti(2,')).toBe(true)
    expect(descriptor).toContain('/<0;1>/*')
    expect(descriptor).toMatch(/#[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8}$/)

    const parsed = parseMultisigDescriptor(descriptor)
    expect(parsed?.requiredSignatures).toBe(2)
    expect(parsed?.cosignerKeys).toHaveLength(2)

    const onChain = deriveBitcoinMultisigFromDescriptor({ descriptor })
    expect(onChain.p2wshAddress.startsWith('bc1')).toBe(true)
  })

  it("embeds xpubs that are actually m/48'/0'/0'/2', not only labeled", () => {
    const fromSeed = deriveBip48AccountFromPrivateMaterial(MNEMONIC)
    const fromPath = bip48XpubAt(MNEMONIC, 0)
    const bip49 = bip49AccountXpub(MNEMONIC)
    expect(fromSeed.xpub).toBe(fromPath)
    expect(fromSeed.xpub).not.toBe(bip49)

    const header = readExtendedKeyBip32(fromSeed.xpub)
    expect(header.depth).toBe(4)
    expect(header.childIndex).toBe(0x80000002)
    expect(isBip48NativeSegwitAccountXpub(fromSeed.xpub)).toBe(true)
    expect(readExtendedKeyBip32(bip49)).toEqual({
      depth: 3,
      childIndex: 0x80000000
    })

    const other = deriveBip48AccountFromPrivateMaterial(OTHER_MNEMONIC)
    const descriptor = buildMultisigDescriptor(2, [
      { xpub: fromSeed.xpub },
      { xpub: other.xpub }
    ])
    const parsed = parseMultisigDescriptor(descriptor)
    expect(parsed).not.toBeNull()
    if (parsed == null) return
    expect(descriptorOriginsMatchXpubs(descriptor)).toBe(true)
    for (const key of parsed.cosignerKeys) {
      expect(key.originPath).toBe("48'/0'/0'/2'")
      const meta = readExtendedKeyBip32(key.xpub)
      expect(meta.depth).toBe(4)
      expect(meta.childIndex).toBe(0x80000002)
    }
    expect(parsed.cosignerKeys.map(key => key.xpub)).toEqual(
      expect.arrayContaining([fromSeed.xpub, other.xpub])
    )
    expect(descriptor).not.toContain(bip49)
  })

  it("refuses to stamp 48'/0'/0'/2' on a BIP-49 account xpub", () => {
    const bip48 = bip48XpubAt(MNEMONIC, 0)
    const bip49 = bip49AccountXpub(OTHER_MNEMONIC)
    expect(() =>
      buildMultisigDescriptor(2, [{ xpub: bip48 }, { xpub: bip49 }])
    ).toThrow(/BIP-48/)
  })

  it('detects a descriptor that only labels BIP-49 keys as BIP-48', () => {
    const a = bip49AccountXpub(MNEMONIC)
    const b = bip49AccountXpub(OTHER_MNEMONIC)
    const fake = addDescriptorChecksum(
      `wsh(sortedmulti(2,[${extractParentFingerprint(
        a
      )}/48'/0'/0'/2']${a}/<0;1>/*,[${extractParentFingerprint(
        b
      )}/48'/0'/0'/2']${b}/<0;1>/*))`
    )
    const parsed = parseMultisigDescriptor(fake)
    expect(parsed?.cosignerKeys[0]?.originPath).toBe("48'/0'/0'/2'")
    expect(
      readExtendedKeyBip32(parsed?.cosignerKeys[0]?.xpub ?? '').depth
    ).toBe(3)
    expect(descriptorOriginsMatchXpubs(fake)).toBe(false)
  })

  it('rejects duplicate cosigner account keys', () => {
    const xpub = bip48XpubAt(MNEMONIC, 0)
    expect(() => validateCosignerXpubs([xpub, xpub])).toThrow(/distinct/i)
  })
})
