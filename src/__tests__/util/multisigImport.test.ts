import { describe, expect, it } from '@jest/globals'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'

import {
  getExclusiveMultisigCreateItem,
  type WalletCreateItem
} from '../../selectors/getCreateWalletList'
import {
  buildMultisigDescriptor,
  deriveBitcoinMultisigFromDescriptor,
  extractParentFingerprint
} from '../../util/multisig/bitcoinP2wsh'
import {
  addDescriptorChecksum,
  stripDescriptorChecksum
} from '../../util/multisig/descriptorChecksum'
import {
  matchImportedMultisigSeed,
  parseImportedMultisigText
} from '../../util/multisig/parseImport'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow'

const bip48Xpub = (mnemonic: string, accountIndex: number = 0): string =>
  HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic))
    .derive(`m/48'/0'/${accountIndex}'/2'`)
    .wipePrivateData().publicExtendedKey

const walletCreate = (
  overrides: Partial<WalletCreateItem> = {}
): WalletCreateItem => ({
  type: 'create',
  key: 'create-wallet:bitcoin-bip49-bitcoin',
  currencyCode: 'BTC',
  displayName: 'Bitcoin',
  pluginId: 'bitcoin',
  tokenId: null,
  walletType: 'wallet:bitcoin-bip49',
  keyOptions: { format: 'bip49' },
  ...overrides
})

describe('parseImportedMultisigText', () => {
  const xpubA = bip48Xpub(MNEMONIC, 0)
  const xpubB = bip48Xpub(OTHER_MNEMONIC, 0)
  const descriptor = buildMultisigDescriptor(2, [
    { xpub: xpubA, fingerprint: extractParentFingerprint(xpubA) },
    { xpub: xpubB, fingerprint: extractParentFingerprint(xpubB) }
  ])

  it('parses a raw BIP-380 descriptor', () => {
    const result = parseImportedMultisigText(descriptor)
    expect(result.kind).toBe('wallet')
    if (result.kind !== 'wallet') return
    expect(result.parsed.requiredSignatures).toBe(2)
    expect(result.parsed.cosignerKeys).toHaveLength(2)
    expect(result.descriptor).toMatch(/^wsh\(sortedmulti\(/)
  })

  it('parses wallet BSMS including first address', () => {
    const onChain = deriveBitcoinMultisigFromDescriptor({ descriptor })
    const template = addDescriptorChecksum(
      stripDescriptorChecksum(descriptor).replace(/\/<0;1>\/\*/g, '/**')
    )
    const bsms = ['BSMS 1.0', template, '/0/*,/1/*', onChain.p2wshAddress].join(
      '\n'
    )
    const result = parseImportedMultisigText(bsms)
    expect(result.kind).toBe('wallet')
    if (result.kind !== 'wallet') return
    expect(result.parsed.requiredSignatures).toBe(2)
    expect(result.firstAddress).toBe(onChain.p2wshAddress)
    expect(result.descriptor).toContain('/<0;1>/*')
  })

  it('rejects single-keystore signer BSMS', () => {
    const signer = ['BSMS 1.0', '00', xpubA, 'Keystore 1'].join('\n')
    expect(parseImportedMultisigText(signer).kind).toBe('signer')
  })

  it('rejects empty or garbage text', () => {
    expect(parseImportedMultisigText('').kind).toBe('invalid')
    expect(parseImportedMultisigText('not a descriptor').kind).toBe('invalid')
  })
})

describe('matchImportedMultisigSeed', () => {
  const xpubA = bip48Xpub(MNEMONIC, 0)
  const xpubB = bip48Xpub(OTHER_MNEMONIC, 0)
  const descriptor = buildMultisigDescriptor(2, [
    { xpub: xpubA, fingerprint: extractParentFingerprint(xpubA) },
    { xpub: xpubB, fingerprint: extractParentFingerprint(xpubB) }
  ])
  const parsed = parseImportedMultisigText(descriptor)
  if (parsed.kind !== 'wallet') {
    throw new Error('expected wallet descriptor')
  }

  it('matches the local BIP-48 cosigner', () => {
    const match = matchImportedMultisigSeed(parsed.parsed, MNEMONIC)
    expect(match?.keyOrigin).toBe('bip48')
    expect(match?.local.xpub).toBe(xpubA)
  })

  it('rejects a seed that is not a cosigner', () => {
    const outsider = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'
    expect(matchImportedMultisigSeed(parsed.parsed, outsider)).toBeUndefined()
  })

  it('does not treat a 48-origin label as BIP-48 when xpubs are BIP-49', () => {
    const bip49A = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC)).derive(
      "m/49'/0'/0'"
    ).publicExtendedKey
    const bip49B = HDKey.fromMasterSeed(
      mnemonicToSeedSync(OTHER_MNEMONIC)
    ).derive("m/49'/0'/0'").publicExtendedKey
    const fake = addDescriptorChecksum(
      `wsh(sortedmulti(2,[${extractParentFingerprint(
        bip49A
      )}/48'/0'/0'/2']${bip49A}/<0;1>/*,[${extractParentFingerprint(
        bip49B
      )}/48'/0'/0'/2']${bip49B}/<0;1>/*))`
    )
    const result = parseImportedMultisigText(fake)
    expect(result.kind).toBe('wallet')
    if (result.kind !== 'wallet') return
    const match = matchImportedMultisigSeed(result.parsed, MNEMONIC)
    expect(match?.keyOrigin).toBe('bip49')
    expect(match?.local.xpub).toBe(bip49A)
  })
})

describe('getExclusiveMultisigCreateItem', () => {
  const multisig = walletCreate({
    key: 'create-wallet:bitcoin-bip49-multisig-bitcoin',
    displayName: 'Bitcoin (Multisig)',
    isMultisig: true
  })
  const bitcoin = walletCreate()

  it('returns the sole multisig item', () => {
    expect(getExclusiveMultisigCreateItem([multisig])).toEqual({
      mixed: false,
      item: multisig
    })
  })

  it('rejects mixing multisig with another wallet', () => {
    expect(getExclusiveMultisigCreateItem([bitcoin, multisig])).toEqual({
      mixed: true
    })
  })

  it('ignores lists without multisig', () => {
    expect(getExclusiveMultisigCreateItem([bitcoin])).toBeUndefined()
  })
})
