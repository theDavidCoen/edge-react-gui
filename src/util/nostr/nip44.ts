import 'react-native-get-random-values'

import { chacha20 } from '@noble/ciphers/chacha'
import { secp256k1 } from '@noble/curves/secp256k1'
import {
  expand as hkdfExpand,
  extract as hkdfExtract
} from '@noble/hashes/hkdf'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils'

import { hexToBytes } from './bech32Keys'

const SALT = utf8ToBytes('nip44-v2')
const VERSION = 0x02
const MIN_PLAINTEXT = 1
const MAX_PLAINTEXT = 65535

const u8ToB64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

const b64ToU8 = (b64: string): Uint8Array => {
  const binary = globalThis.atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const paddedLen = (unpaddedLen: number): number => {
  if (unpaddedLen < MIN_PLAINTEXT || unpaddedLen > MAX_PLAINTEXT) {
    throw new Error('Invalid NIP-44 plaintext length')
  }
  if (unpaddedLen <= 32) return 32
  const nextPower = 1 << (32 - Math.clz32(unpaddedLen - 1))
  const chunk = nextPower <= 256 ? 32 : nextPower / 8
  return chunk * Math.floor((unpaddedLen - 1) / chunk) + chunk
}

const pad = (plaintext: Uint8Array): Uint8Array => {
  const unpaddedLen = plaintext.length
  const padded = paddedLen(unpaddedLen)
  const out = new Uint8Array(2 + padded)
  out[0] = (unpaddedLen >> 8) & 0xff
  out[1] = unpaddedLen & 0xff
  out.set(plaintext, 2)
  return out
}

const unpad = (padded: Uint8Array): Uint8Array => {
  if (padded.length < 3) throw new Error('Invalid NIP-44 padding')
  const unpaddedLen = (padded[0] << 8) | padded[1]
  if (
    unpaddedLen < MIN_PLAINTEXT ||
    unpaddedLen > MAX_PLAINTEXT ||
    unpaddedLen > padded.length - 2
  ) {
    throw new Error('Invalid NIP-44 padding length')
  }
  const expected = 2 + paddedLen(unpaddedLen)
  if (padded.length !== expected) {
    throw new Error('Invalid NIP-44 padded payload')
  }
  return padded.slice(2, 2 + unpaddedLen)
}

const conversationKey = (
  seckey: Uint8Array,
  pubkey: Uint8Array
): Uint8Array => {
  const compressed = concatBytes(Uint8Array.of(0x02), pubkey)
  const shared = secp256k1.getSharedSecret(seckey, compressed, true)
  const sharedX = shared.slice(1)
  return hkdfExtract(sha256, sharedX, SALT)
}

const messageKeys = (
  convKey: Uint8Array,
  nonce: Uint8Array
): { encKey: Uint8Array; nonceChaCha: Uint8Array; hmacKey: Uint8Array } => {
  const okm = hkdfExpand(sha256, convKey, nonce, 76)
  return {
    encKey: okm.slice(0, 32),
    nonceChaCha: okm.slice(32, 44),
    hmacKey: okm.slice(44, 76)
  }
}

/**
 * NIP-44 v2 encrypt. `seckey`/`pubkey` are 32-byte hex or raw bytes.
 */
export const nip44Encrypt = (
  plaintext: string,
  seckey: Uint8Array | string,
  pubkey: Uint8Array | string
): string => {
  const sk = typeof seckey === 'string' ? hexToBytes(seckey) : seckey
  const pk = typeof pubkey === 'string' ? hexToBytes(pubkey) : pubkey
  const convKey = conversationKey(sk, pk)
  const nonce = randomBytes(32)
  const { encKey, nonceChaCha, hmacKey } = messageKeys(convKey, nonce)
  const padded = pad(utf8ToBytes(plaintext))
  const ciphertext = chacha20(encKey, nonceChaCha, padded)
  const mac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext))
  return u8ToB64(concatBytes(Uint8Array.of(VERSION), nonce, ciphertext, mac))
}

export const nip44Decrypt = (
  payload: string,
  seckey: Uint8Array | string,
  pubkey: Uint8Array | string
): string => {
  const sk = typeof seckey === 'string' ? hexToBytes(seckey) : seckey
  const pk = typeof pubkey === 'string' ? hexToBytes(pubkey) : pubkey
  const raw = b64ToU8(payload)
  if (raw.length < 99 || raw[0] !== VERSION) {
    throw new Error('Unsupported NIP-44 payload')
  }
  const nonce = raw.slice(1, 33)
  const mac = raw.slice(raw.length - 32)
  const ciphertext = raw.slice(33, raw.length - 32)
  const convKey = conversationKey(sk, pk)
  const { encKey, nonceChaCha, hmacKey } = messageKeys(convKey, nonce)
  const expected = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext))
  if (expected.length !== mac.length) throw new Error('NIP-44 MAC mismatch')
  let diff = 0
  for (let i = 0; i < mac.length; i++) diff |= expected[i] ^ mac[i]
  if (diff !== 0) throw new Error('NIP-44 MAC mismatch')
  const padded = chacha20(encKey, nonceChaCha, ciphertext)
  const plaintext = unpad(padded)
  return new TextDecoder().decode(plaintext)
}
