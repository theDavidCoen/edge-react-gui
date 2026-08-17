import { bech32 } from 'bech32'

const NPUB_HRP = 'npub'
const NSEC_HRP = 'nsec'

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex')
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

const encodeKey = (hrp: string, key: Uint8Array): string => {
  if (key.length !== 32) {
    throw new Error('Nostr key must be 32 bytes')
  }
  return bech32.encode(hrp, bech32.toWords(key), 90)
}

const decodeKey = (hrp: string, encoded: string): Uint8Array => {
  const decoded = bech32.decode(encoded, 90)
  if (decoded.prefix !== hrp) {
    throw new Error(`Expected ${hrp}`)
  }
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words))
  if (bytes.length !== 32) {
    throw new Error('Nostr key must be 32 bytes')
  }
  return bytes
}

export const encodeNpub = (pubkey: Uint8Array): string =>
  encodeKey(NPUB_HRP, pubkey)

export const encodeNsec = (seckey: Uint8Array): string =>
  encodeKey(NSEC_HRP, seckey)

export const decodeNpub = (npub: string): Uint8Array =>
  decodeKey(NPUB_HRP, npub.trim())

export const decodeNsec = (nsec: string): Uint8Array =>
  decodeKey(NSEC_HRP, nsec.trim())

export const isValidNpub = (value: string): boolean => {
  try {
    decodeNpub(value)
    return true
  } catch {
    return false
  }
}

export const isValidNsec = (value: string): boolean => {
  try {
    decodeNsec(value)
    return true
  } catch {
    return false
  }
}
