import { describe, expect, it } from '@jest/globals'

import {
  clearOrphanInbox,
  stashOrphanMultisigMessage,
  takeOrphanMultisigMessages
} from '../../util/multisig/orphanInbox'

describe('orphanInbox', () => {
  it('replays stashed messages once per proposal', () => {
    clearOrphanInbox()
    stashOrphanMultisigMessage('p1', '{"type":"edge-multisig-accept"}')
    stashOrphanMultisigMessage('p1', '{"type":"edge-multisig-complete"}')
    stashOrphanMultisigMessage('p1', '{"type":"edge-multisig-accept"}')
    stashOrphanMultisigMessage('p2', '{"type":"other"}')

    expect(takeOrphanMultisigMessages('p1')).toEqual([
      '{"type":"edge-multisig-accept"}',
      '{"type":"edge-multisig-complete"}'
    ])
    expect(takeOrphanMultisigMessages('p1')).toEqual([])
    expect(takeOrphanMultisigMessages('p2')).toEqual(['{"type":"other"}'])
  })
})
