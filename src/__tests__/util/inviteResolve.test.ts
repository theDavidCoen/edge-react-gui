import { describe, expect, it } from '@jest/globals'

import { resolveJoinableMultisigProposalId } from '../../util/multisig/inviteResolve'
import {
  hasLocalJoinedProposal,
  type MultisigProposal
} from '../../util/multisig/types'

const localNpub = 'npub1you'
const initiator = 'npub1init'

const proposal = (
  overrides: Partial<MultisigProposal> &
    Pick<MultisigProposal, 'id' | 'createdAt' | 'initiatorNpub'>
): MultisigProposal => ({
  role: 'cosigner',
  requiredSignatures: 2,
  totalCosigners: 3,
  walletName: 'Bitcoin Multisig 2-of-3',
  walletId: undefined,
  localXpub: undefined,
  localParentFingerprint: undefined,
  status: 'pending',
  keyOrigin: undefined,
  p2wshAddress: undefined,
  witnessScriptHex: undefined,
  descriptor: undefined,
  cosigners: [
    {
      npub: overrides.initiatorNpub,
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
    },
    {
      npub: 'npub1other',
      xpub: undefined,
      nip05: undefined,
      status: 'pending',
      parentFingerprint: undefined
    }
  ],
  ...overrides
})

describe('resolveJoinableMultisigProposalId', () => {
  it('upgrades a stale invite to the newest joinable from the same initiator', () => {
    const proposals = [
      proposal({ id: 'old', createdAt: 1, initiatorNpub: initiator }),
      proposal({ id: 'new', createdAt: 2, initiatorNpub: initiator })
    ]
    expect(resolveJoinableMultisigProposalId(proposals, 'old', localNpub)).toBe(
      'new'
    )
  })

  it('keeps a requested invite that this account already joined', () => {
    const leftover = proposal({
      id: 'old',
      createdAt: 1,
      initiatorNpub: initiator
    })
    const joined = proposal({
      id: 'joined',
      createdAt: 2,
      initiatorNpub: initiator,
      walletId: 'wallet-joined',
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
          xpub: 'xpubYou',
          nip05: undefined,
          status: 'accepted',
          parentFingerprint: undefined
        },
        {
          npub: 'npub1other',
          xpub: undefined,
          nip05: undefined,
          status: 'pending',
          parentFingerprint: undefined
        }
      ]
    })
    expect(
      resolveJoinableMultisigProposalId([leftover, joined], 'joined', localNpub)
    ).toBe('joined')
  })

  it('falls back to the newest joinable invite when the stored id is missing', () => {
    const proposals = [
      proposal({ id: 'a', createdAt: 1, initiatorNpub: initiator }),
      proposal({
        id: 'b',
        createdAt: 3,
        initiatorNpub: 'npub1other-init'
      })
    ]
    expect(
      resolveJoinableMultisigProposalId(proposals, 'missing', localNpub)
    ).toBe('b')
  })
})

describe('hasLocalJoinedProposal', () => {
  it('is false until the local cosigner has a wallet', () => {
    const pending = proposal({
      id: 'p',
      createdAt: 1,
      initiatorNpub: initiator
    })
    expect(hasLocalJoinedProposal(pending, localNpub)).toBe(false)
    expect(
      hasLocalJoinedProposal(
        proposal({
          id: 'p',
          createdAt: 1,
          initiatorNpub: initiator,
          walletId: 'wallet-1'
        }),
        localNpub
      )
    ).toBe(true)
  })
})
