/**
 * Hermes often lacks a working TextEncoder. @scure/btc-signer PSBT encoding
 * uses micro-packed `P.string`, which calls `new TextEncoder().encode(...)`.
 * Without this, `toPSBT()` throws:
 * `Writer(magic): TypeError: undefined is not a function`
 */

const encodeUtf8 = (input: string): Uint8Array => {
  // Pure JS UTF-8 (ASCII-safe path covers PSBT magic "psbt").
  const bytes: number[] = []
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000
        i++
      }
    }
    if (code <= 0x7f) {
      bytes.push(code)
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code <= 0xffff) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    }
  }
  return Uint8Array.from(bytes)
}

const decodeUtf8 = (input: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < input.length; ) {
    const b0 = input[i++]
    if (b0 <= 0x7f) {
      out += String.fromCharCode(b0)
    } else if (b0 >= 0xc0 && b0 <= 0xdf && i < input.length) {
      const b1 = input[i++]
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f))
    } else if (b0 >= 0xe0 && b0 <= 0xef && i + 1 < input.length) {
      const b1 = input[i++]
      const b2 = input[i++]
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f)
      )
    } else if (b0 >= 0xf0 && b0 <= 0xf7 && i + 2 < input.length) {
      const b1 = input[i++]
      const b2 = input[i++]
      const b3 = input[i++]
      let code =
        ((b0 & 0x07) << 18) |
        ((b1 & 0x3f) << 12) |
        ((b2 & 0x3f) << 6) |
        (b3 & 0x3f)
      code -= 0x10000
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff))
    } else {
      out += '\ufffd'
    }
  }
  return out
}

/** string → bytes (scure utf8.decode naming). */
export const encodeUtf8Bytes = (input: string): Uint8Array =>
  encodeUtf8(String(input))

/** bytes → string (scure utf8.encode naming). */
export const decodeUtf8Bytes = (input: Uint8Array): string => decodeUtf8(input)

class TextEncoderPolyfill {
  encoding = 'utf-8'
  encode(input: string): Uint8Array {
    return encodeUtf8Bytes(String(input))
  }
}

class TextDecoderPolyfill {
  encoding = 'utf-8'
  fatal = false
  ignoreBOM = false
  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (input == null) return ''
    const bytes =
      input instanceof Uint8Array
        ? input
        : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    return decodeUtf8Bytes(bytes)
  }
}

const textEncoderWorks = (): boolean => {
  try {
    // Prefer globalThis — Hermes may expose a broken/partial TextEncoder.
    // eslint-disable-next-line no-undef
    const Ctor = globalThis.TextEncoder
    if (typeof Ctor !== 'function') return false
    // eslint-disable-next-line no-undef
    if (Ctor !== TextEncoderPolyfill) return false
    const encoded = new Ctor().encode('psbt')
    return (
      encoded != null &&
      typeof encoded.length === 'number' &&
      encoded.length === 4 &&
      encoded[0] === 0x70
    )
  } catch {
    return false
  }
}

/** Install TextEncoder/TextDecoder on every common global (idempotent). */
export const ensureTextEncoding = (): void => {
  // Always prefer our polyfill. Hermes / RN may expose a partial TextEncoder
  // that passes `typeof === 'function'` but throws on encode. Packages like
  // fast-text-encoding keep the native one when present (`||=`), which is wrong.
  if (textEncoderWorks()) return

  const targets: Array<Record<string, unknown>> = []
  // eslint-disable-next-line no-undef
  if (typeof globalThis !== 'undefined') targets.push(globalThis as any)
  // eslint-disable-next-line no-undef
  if (typeof global !== 'undefined') targets.push(global as any)
  const maybeWindow = (globalThis as { window?: Record<string, unknown> })
    .window
  if (maybeWindow != null) targets.push(maybeWindow)

  for (const target of targets) {
    target.TextEncoder = TextEncoderPolyfill
    target.TextDecoder = TextDecoderPolyfill
  }
}

// Side-effect for early import from index.ts
ensureTextEncoding()
