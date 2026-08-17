import { describe, expect, it } from '@jest/globals'

import { addDescriptorChecksum } from '../../util/multisig/descriptorChecksum'

describe('BIP-380 descriptor checksum', () => {
  it('matches Bitcoin Core descsum_create', () => {
    expect(
      addDescriptorChecksum(
        'wpkh(02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5)'
      )
    ).toBe(
      'wpkh(02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5)#wg9vgf99'
    )
  })

  it('is idempotent when a checksum is already present', () => {
    const withSum =
      'wpkh(02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5)#wg9vgf99'
    expect(addDescriptorChecksum(withSum)).toBe(withSum)
  })
})
