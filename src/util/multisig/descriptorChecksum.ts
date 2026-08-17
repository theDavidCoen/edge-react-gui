/**
 * BIP-380 descriptor checksum (descsum).
 * Uses BigInt because the polymod state is 40-bit.
 */

const INPUT_CHARSET =
  '0123456789()[],\'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ '
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [
  0xf5dee51989n,
  0xa9fdca3312n,
  0x1bab10e32dn,
  0x3706b1677an,
  0x644d626ffdn
]

const descsumPolymod = (symbols: number[]): bigint => {
  let chk = 1n
  for (const value of symbols) {
    const top = chk >> 35n
    chk = ((chk & 0x7ffffffffn) << 5n) ^ BigInt(value)
    for (let i = 0; i < 5; i++) {
      if (((top >> BigInt(i)) & 1n) !== 0n) chk ^= GENERATOR[i]
    }
  }
  return chk
}

const descsumExpand = (s: string): number[] => {
  const groups: number[] = []
  const symbols: number[] = []
  for (const char of s) {
    const idx = INPUT_CHARSET.indexOf(char)
    if (idx < 0) {
      throw new Error('Invalid descriptor character')
    }
    symbols.push(idx & 31)
    groups.push(idx >> 5)
    if (groups.length === 3) {
      symbols.push(groups[0] * 9 + groups[1] * 3 + groups[2])
      groups.length = 0
    }
  }
  if (groups.length === 1) {
    symbols.push(groups[0])
  } else if (groups.length === 2) {
    symbols.push(groups[0] * 3 + groups[1])
  }
  return symbols
}

export const stripDescriptorChecksum = (descriptor: string): string => {
  const trimmed = descriptor.trim()
  const hash = trimmed.lastIndexOf('#')
  if (hash < 0) return trimmed
  if (trimmed.length - hash - 1 !== 8) return trimmed
  return trimmed.slice(0, hash)
}

export const addDescriptorChecksum = (descriptor: string): string => {
  const script = stripDescriptorChecksum(descriptor)
  const symbols = [...descsumExpand(script), 0, 0, 0, 0, 0, 0, 0, 0]
  const checksum = descsumPolymod(symbols) ^ 1n
  let suffix = ''
  for (let i = 0; i < 8; i++) {
    suffix += CHECKSUM_CHARSET[Number((checksum >> BigInt(5 * (7 - i))) & 31n)]
  }
  return `${script}#${suffix}`
}
