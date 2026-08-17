import { describe, expect, it } from '@jest/globals'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'

import {
  buildMultisigDescriptor,
  extractParentFingerprint,
  validateCosignerXpubs
} from '../../util/multisig/bitcoinP2wsh'
import {
  buildMultisigBsmsText,
  buildMultisigExportFilename,
  buildMultisigExportPayload,
  buildMultisigExportText,
  resolveMultisigExportFields
} from '../../util/multisig/exportInfo'
import type { MultisigProposal } from '../../util/multisig/types'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const bip48XpubAt = (accountIndex: number): string =>
  HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC))
    .derive(`m/48'/0'/${accountIndex}'/2'`)
    .wipePrivateData().publicExtendedKey

const completeProposal = (
  overrides: Partial<MultisigProposal> = {}
): MultisigProposal => ({
  id: 'test-proposal',
  createdAt: 1,
  role: 'initiator',
  requiredSignatures: 2,
  totalCosigners: 2,
  walletName: 'Test Multisig',
  walletId: 'wallet-1',
  initiatorNpub: 'npub1test',
  status: 'complete',
  keyOrigin: 'bip48',
  cosigners: [],
  ...overrides
})

describe('multisig exportInfo', () => {
  it('builds export payload with descriptor when xpubs are valid', () => {
    const xpubA = bip48XpubAt(0)
    const xpubB = bip48XpubAt(1)
    const descriptor = buildMultisigDescriptor(2, [
      { xpub: xpubA, fingerprint: extractParentFingerprint(xpubA) },
      { xpub: xpubB, fingerprint: extractParentFingerprint(xpubB) }
    ])
    const proposal = completeProposal({
      descriptor,
      cosigners: [
        {
          npub: 'npub1a',
          xpub: xpubA,
          status: 'local',
          parentFingerprint: extractParentFingerprint(xpubA)
        },
        {
          npub: 'npub1b',
          xpub: xpubB,
          status: 'accepted',
          parentFingerprint: extractParentFingerprint(xpubB)
        }
      ]
    })
    const payload = buildMultisigExportPayload(proposal)
    expect(payload.format).toBe('edge-multisig-export')
    expect(payload.descriptor).toBe(descriptor)
    expect(payload.cosigners).toHaveLength(2)
    expect(payload.cosigners.every(c => !('npub' in c))).toBe(true)
    const text = buildMultisigExportText(proposal)
    expect(text).toBe(descriptor)
    expect(text).toMatch(/^wsh\(sortedmulti\(/)
    expect(text).toMatch(/#[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8}$/)
    expect(buildMultisigExportFilename(proposal)).toBe('Test_Multisig.txt')
    expect(buildMultisigExportFilename(proposal, 'bsms')).toBe(
      'Test_Multisig.bsms'
    )
    const bsms = buildMultisigBsmsText(proposal)
    expect(bsms.startsWith('BSMS 1.0\n')).toBe(true)
    expect(bsms).toContain('/**')
    expect(bsms).toContain('/0/*,/1/*')
    expect(bsms).toMatch(/bc1[a-z0-9]+$/m)
  })

  it('resolves missing descriptor from stored xpubs', () => {
    const xpubA = bip48XpubAt(0)
    const xpubB = bip48XpubAt(1)
    validateCosignerXpubs([xpubA, xpubB])
    const proposal = completeProposal({
      cosigners: [
        { npub: 'npub1a', xpub: xpubA, status: 'local' },
        { npub: 'npub1b', xpub: xpubB, status: 'accepted' }
      ]
    })
    const fields = resolveMultisigExportFields(proposal)
    expect(fields.descriptor).toMatch(/^wsh\(sortedmulti\(/)
    expect(fields.p2wshAddress).toMatch(/^bc1/)
  })
})
