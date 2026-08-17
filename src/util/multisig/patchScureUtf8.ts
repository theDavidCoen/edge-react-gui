import { utf8 } from '@scure/base'

import { decodeUtf8Bytes, encodeUtf8Bytes } from '../ensureTextEncoding'

interface Utf8Coder {
  encode: (data: Uint8Array) => string
  decode: (str: string) => Uint8Array
}

/**
 * micro-packed PSBT magic encoding calls `@scure/base` utf8.decode → TextEncoder.
 * Hermes often has no working TextEncoder, and Metro keeps a nested @scure/base@2.x
 * for micro-packed that is separate from the app's top-level @scure/base@1.x.
 *
 * Metro resolveRequest (see metro.config.js) forces multisig / @scure / micro-packed
 * onto one @scure/base@2.x module instance; we then replace utf8 methods so PSBT
 * encode never touches TextEncoder.
 */
export const patchScureUtf8ForPsbt = (): void => {
  const coder = utf8 as Utf8Coder
  coder.decode = (str: string) => encodeUtf8Bytes(String(str))
  coder.encode = (data: Uint8Array) =>
    decodeUtf8Bytes(
      data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)
    )
}
