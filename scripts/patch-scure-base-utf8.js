#!/usr/bin/env node
/**
 * Hermes may expose `typeof TextEncoder === 'function'` while `new TextEncoder()`
 * throws (`undefined is not a function`). @scure/base@2.x then picks utf8Builtin
 * at module init and PSBT encode crashes with `Writer(magic): ...`.
 *
 * Force the pure-JS utf8Fallback in every nested @scure/base@2 copy used by
 * micro-packed / @scure/btc-signer. (Top-level @scure/base may still be 1.x.)
 */
const fs = require('fs')
const path = require('path')

const OLD = `        encode: typeof TextDecoder === 'function' ? utf8Builtin.encode : utf8Fallback.encode,
        decode: typeof TextEncoder === 'function' ? utf8Builtin.decode : utf8Fallback.decode,`

const NEW = `        // Edge/Hermes: TextEncoder may be typeof 'function' but non-constructible.
        // Always use the pure-JS fallback for PSBT encode (Writer(magic) crash).
        encode: utf8Fallback.encode,
        decode: utf8Fallback.decode,`

const roots = [
  path.join(
    'node_modules',
    'micro-packed',
    'node_modules',
    '@scure',
    'base',
    'index.js'
  ),
  path.join(
    'node_modules',
    '@scure',
    'btc-signer',
    'node_modules',
    '@scure',
    'base',
    'index.js'
  ),
  path.join(
    'node_modules',
    '@scure',
    'bip32',
    'node_modules',
    '@scure',
    'base',
    'index.js'
  ),
  path.join(
    'node_modules',
    '@scure',
    'bip39',
    'node_modules',
    '@scure',
    'base',
    'index.js'
  )
]

let patched = 0
for (const rel of roots) {
  const file = path.join(__dirname, '..', rel)
  if (!fs.existsSync(file)) continue
  const text = fs.readFileSync(file, 'utf8')
  if (text.includes(NEW)) {
    console.log(`[patch-scure-base-utf8] already patched: ${rel}`)
    continue
  }
  if (!text.includes(OLD)) {
    console.log(`[patch-scure-base-utf8] pattern missing (skip): ${rel}`)
    continue
  }
  fs.writeFileSync(file, text.replace(OLD, NEW))
  console.log(`[patch-scure-base-utf8] patched: ${rel}`)
  patched++
}
if (patched === 0) {
  console.log('[patch-scure-base-utf8] nothing to patch')
}
