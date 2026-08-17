/**
 * Manual BIP174 PSBT v0 encode/decode for P2WSH multisig.
 *
 * Avoids `@scure/btc-signer` `toPSBT` / `fromPSBT`, which go through
 * micro-packed `P.magic(P.string…)` and break on Hermes (TextEncoder).
 */
import * as btc from '@scure/btc-signer'

const PSBT_MAGIC = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff])

const PSBT_GLOBAL_UNSIGNED_TX = 0x00
const PSBT_IN_WITNESS_UTXO = 0x01
const PSBT_IN_PARTIAL_SIG = 0x02
const PSBT_IN_SIGHASH_TYPE = 0x03
const PSBT_IN_WITNESS_SCRIPT = 0x05

const concat = (chunks: Uint8Array[]): Uint8Array => {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Uint8Array(len)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

const writeCompactSize = (n: number): Uint8Array => {
  if (n < 0 || !Number.isInteger(n)) {
    throw new Error(`Invalid compact size ${n}`)
  }
  if (n < 0xfd) return new Uint8Array([n])
  if (n <= 0xffff) {
    const out = new Uint8Array(3)
    out[0] = 0xfd
    out[1] = n & 0xff
    out[2] = (n >> 8) & 0xff
    return out
  }
  if (n <= 0xffffffff) {
    const out = new Uint8Array(5)
    out[0] = 0xfe
    out[1] = n & 0xff
    out[2] = (n >> 8) & 0xff
    out[3] = (n >> 16) & 0xff
    out[4] = (n >> 24) & 0xff
    return out
  }
  throw new Error(`Compact size too large: ${n}`)
}

const writeBytes = (bytes: Uint8Array): Uint8Array =>
  concat([writeCompactSize(bytes.length), bytes])

const writeKv = (key: Uint8Array, value: Uint8Array): Uint8Array =>
  concat([writeBytes(key), writeBytes(value)])

const writeU32Le = (n: number): Uint8Array => {
  const out = new Uint8Array(4)
  out[0] = n & 0xff
  out[1] = (n >> 8) & 0xff
  out[2] = (n >> 16) & 0xff
  out[3] = (n >> 24) & 0xff
  return out
}

const writeU64Le = (n: bigint): Uint8Array => {
  const out = new Uint8Array(8)
  let x = n
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

const encodeWitnessUtxo = (utxo: {
  amount: bigint
  script: Uint8Array
}): Uint8Array => concat([writeU64Le(utxo.amount), writeBytes(utxo.script)])

interface Reader {
  bytes: Uint8Array
  o: number
}

const readCompactSize = (r: Reader): number => {
  if (r.o >= r.bytes.length) throw new Error('Unexpected EOF (compact size)')
  const first = r.bytes[r.o++]
  if (first < 0xfd) return first
  if (first === 0xfd) {
    if (r.o + 2 > r.bytes.length) throw new Error('Unexpected EOF (u16)')
    const n = r.bytes[r.o] | (r.bytes[r.o + 1] << 8)
    r.o += 2
    return n
  }
  if (first === 0xfe) {
    if (r.o + 4 > r.bytes.length) throw new Error('Unexpected EOF (u32)')
    const n =
      r.bytes[r.o] |
      (r.bytes[r.o + 1] << 8) |
      (r.bytes[r.o + 2] << 16) |
      (r.bytes[r.o + 3] << 24)
    r.o += 4
    return n >>> 0
  }
  throw new Error('Compact size u64 not supported')
}

const readBytes = (r: Reader): Uint8Array => {
  const len = readCompactSize(r)
  if (r.o + len > r.bytes.length) throw new Error('Unexpected EOF (bytes)')
  const slice = r.bytes.subarray(r.o, r.o + len)
  r.o += len
  return slice
}

const readU32Le = (bytes: Uint8Array): number => {
  if (bytes.length !== 4) throw new Error('Expected 4-byte u32')
  return (
    (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0
  )
}

const readU64Le = (bytes: Uint8Array): bigint => {
  if (bytes.length !== 8) throw new Error('Expected 8-byte u64')
  let n = 0n
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i])
  return n
}

const decodeWitnessUtxo = (
  value: Uint8Array
): { amount: bigint; script: Uint8Array } => {
  if (value.length < 9) throw new Error('Invalid witness UTXO')
  const amount = readU64Le(value.subarray(0, 8))
  const r: Reader = { bytes: value, o: 8 }
  const script = readBytes(r)
  if (r.o !== value.length) throw new Error('Trailing bytes in witness UTXO')
  return { amount, script }
}

const readMap = (r: Reader): Array<{ key: Uint8Array; value: Uint8Array }> => {
  const entries: Array<{ key: Uint8Array; value: Uint8Array }> = []
  for (;;) {
    const key = readBytes(r)
    if (key.length === 0) break
    const value = readBytes(r)
    entries.push({ key, value })
  }
  return entries
}

/** Serialize a Transaction to PSBT v0 bytes (no TextEncoder / string magic). */
export const serializePsbtV0 = (tx: btc.Transaction): Uint8Array => {
  const unsignedTx = tx.unsignedTx
  const chunks: Uint8Array[] = [
    PSBT_MAGIC,
    writeKv(new Uint8Array([PSBT_GLOBAL_UNSIGNED_TX]), unsignedTx),
    new Uint8Array([0x00])
  ]

  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i)
    if (input.witnessUtxo != null) {
      chunks.push(
        writeKv(
          new Uint8Array([PSBT_IN_WITNESS_UTXO]),
          encodeWitnessUtxo({
            amount: input.witnessUtxo.amount,
            script: input.witnessUtxo.script
          })
        )
      )
    }
    if (input.partialSig != null) {
      for (const [pubkey, signature] of input.partialSig) {
        chunks.push(
          writeKv(
            concat([new Uint8Array([PSBT_IN_PARTIAL_SIG]), pubkey]),
            signature
          )
        )
      }
    }
    if (input.sighashType != null) {
      chunks.push(
        writeKv(
          new Uint8Array([PSBT_IN_SIGHASH_TYPE]),
          writeU32Le(input.sighashType)
        )
      )
    }
    if (input.witnessScript != null) {
      chunks.push(
        writeKv(new Uint8Array([PSBT_IN_WITNESS_SCRIPT]), input.witnessScript)
      )
    }
    chunks.push(new Uint8Array([0x00]))
  }

  for (let i = 0; i < tx.outputsLength; i++) {
    chunks.push(new Uint8Array([0x00]))
  }

  return concat(chunks)
}

/** Parse PSBT v0 bytes into a Transaction (no TextEncoder / string magic). */
export const parsePsbtV0 = (psbt: Uint8Array): btc.Transaction => {
  const r: Reader = { bytes: psbt, o: 0 }
  for (const byte of PSBT_MAGIC) {
    if (r.bytes[r.o++] !== byte) {
      throw new Error('Invalid PSBT magic')
    }
  }

  const global = readMap(r)
  let unsignedRaw: Uint8Array | undefined
  for (const { key, value } of global) {
    if (key.length === 1 && key[0] === PSBT_GLOBAL_UNSIGNED_TX) {
      unsignedRaw = value
    }
  }
  if (unsignedRaw == null) {
    throw new Error('PSBT missing unsigned tx')
  }

  const tx = btc.Transaction.fromRaw(unsignedRaw)
  const inputCount = tx.inputsLength
  const outputCount = tx.outputsLength

  for (let i = 0; i < inputCount; i++) {
    const entries = readMap(r)
    const update: {
      witnessUtxo?: { amount: bigint; script: Uint8Array }
      witnessScript?: Uint8Array
      sighashType?: number
      partialSig?: Array<[Uint8Array, Uint8Array]>
    } = {}
    const partialSig: Array<[Uint8Array, Uint8Array]> = []
    for (const { key, value } of entries) {
      if (key.length === 0) continue
      const type = key[0]
      if (type === PSBT_IN_WITNESS_UTXO && key.length === 1) {
        update.witnessUtxo = decodeWitnessUtxo(value)
      } else if (type === PSBT_IN_SIGHASH_TYPE && key.length === 1) {
        update.sighashType = readU32Le(value)
      } else if (type === PSBT_IN_WITNESS_SCRIPT && key.length === 1) {
        update.witnessScript = value
      } else if (type === PSBT_IN_PARTIAL_SIG && key.length > 1) {
        partialSig.push([key.subarray(1), value])
      }
    }
    if (partialSig.length > 0) update.partialSig = partialSig
    if (Object.keys(update).length > 0) {
      tx.updateInput(i, update, true)
    }
  }

  for (let i = 0; i < outputCount; i++) {
    readMap(r)
  }

  return tx
}
