import { describe, expect, it } from '@jest/globals'

import {
  isWalletWaitingCosigners,
  mergeProposalLists,
  type MultisigProposal,
  withLocalCosignerAccepted
} from '../../util/multisig/types'

const localNpub = 'npub1you'
const initiator = 'npub1init'

const proposal = (
  overrides: Partial<MultisigProposal> &
    Pick<MultisigProposal, 'id' | 'createdAt' | 'status'>
): MultisigProposal => ({
  role: 'cosigner',
  requiredSignatures: 2,
  totalCosigners: 3,
  walletName: 'Bitcoin Multisig 2-of-3',
  walletId: undefined,
  localXpub: undefined,
  localParentFingerprint: undefined,
  keyOrigin: undefined,
  p2wshAddress: undefined,
  witnessScriptHex: undefined,
  descriptor: undefined,
  initiatorNpub: initiator,
  cosigners: [
    {
      npub: initiator,
      xpub: 'xpubA',
      nip05: undefined,
      status: 'accepted',
      parentFingerprint: undefined
    },
    {
      npub: localNpub,
      xpub: undefined,
      nip05: undefined,
      status: 'pending',
      parentFingerprint: undefined
    }
  ],
  ...overrides
})

describe('mergeProposalLists', () => {
  it('does not let a stale pending disk snapshot drop a complete wallet', () => {
    const complete = proposal({
      id: 'first',
      createdAt: 1,
      status: 'complete',
      walletId: 'w1'
    })
    const stale = proposal({
      id: 'first',
      createdAt: 1,
      status: 'pending',
      walletId: 'w1'
    })
    const merged = mergeProposalLists([stale], [complete])
    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('complete')
  })

  it('keeps a newer second wallet alongside the first', () => {
    const first = proposal({
      id: 'first',
      createdAt: 1,
      status: 'complete',
      walletId: 'w1'
    })
    const second = proposal({
      id: 'second',
      createdAt: 2,
      status: 'pending',
      walletId: 'w2'
    })
    const merged = mergeProposalLists([first], [first, second])
    expect(merged.map(item => item.id).sort()).toEqual(['first', 'second'])
    expect(merged.find(item => item.id === 'first')?.status).toBe('complete')
  })
})

describe('isWalletWaitingCosigners', () => {
  it('does not mark a complete wallet waiting when a pending proposal reused its id', () => {
    const proposals = [
      proposal({
        id: 'done',
        createdAt: 1,
        status: 'complete',
        walletId: 'w1'
      }),
      proposal({
        id: 'new',
        createdAt: 2,
        status: 'pending',
        walletId: 'w1'
      })
    ]
    expect(isWalletWaitingCosigners(proposals, 'w1')).toBe(false)
  })
})

describe('withLocalCosignerAccepted', () => {
  it('promotes You from pending after a wallet shell exists', () => {
    const pendingYou = proposal({
      id: 'p',
      createdAt: 1,
      status: 'pending',
      walletId: 'w3',
      localXpub: 'xpubYou'
    })
    const next = withLocalCosignerAccepted(pendingYou, localNpub)
    expect(next.cosigners.find(item => item.npub === localNpub)?.status).toBe(
      'accepted'
    )
  })
})
