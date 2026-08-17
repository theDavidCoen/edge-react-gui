import { describe, expect, it } from '@jest/globals'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import * as btc from '@scure/btc-signer'

import {
  deriveBitcoinMultisigOnChain,
  deriveCosignerPubkeyAtIndex,
  sortPubkeysBip67
} from '../../util/multisig/bitcoinP2wsh'
import { parsePsbtV0, serializePsbtV0 } from '../../util/multisig/psbtManual'
import {
  countPsbtSignatures,
  finalizeAndExtractTx,
  partialSignPsbt,
  psbtToBase64
} from '../../util/multisig/spendPsbt'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const bip48AccountAt = (accountIndex: number): HDKey =>
  HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC)).derive(
    `m/48'/0'/${accountIndex}'/2'`
  )

describe('multisig spend PSBT', () => {
  it('spend payment address matches BIP67 watch address (BIP-48)', () => {
    const xpubA = bip48AccountAt(0).wipePrivateData().publicExtendedKey
    const xpubB = bip48AccountAt(1).wipePrivateData().publicExtendedKey
    const xpubC = bip48AccountAt(2).wipePrivateData().publicExtendedKey
    const xpubs = [xpubA, xpubB, xpubC]
    const watch = deriveBitcoinMultisigOnChain({
      xpubs,
      requiredSignatures: 2
    })
    const pubkeys = sortPubkeysBip67(
      xpubs.map(xpub => deriveCosignerPubkeyAtIndex(xpub, 0, 0))
    )
    const spendAddr = btc.p2wsh(btc.p2ms(2, pubkeys)).address
    expect(spendAddr).toBe(watch.p2wshAddress)
  })

  it('partially signs and finalizes a 2-of-3 P2WSH spend (BIP-48)', () => {
    const acctA = bip48AccountAt(0)
    const acctB = bip48AccountAt(1)
    const acctC = bip48AccountAt(2)

    const childA = acctA.deriveChild(0).deriveChild(0)
    const childB = acctB.deriveChild(0).deriveChild(0)
    const childC = acctC.deriveChild(0).deriveChild(0)
    const pubs = [childA.publicKey!, childB.publicKey!, childC.publicKey!]
    const payment = btc.p2wsh(btc.p2ms(2, pubs))

    const tx = new btc.Transaction()
    tx.addInput({
      txid: '11'.repeat(32),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 100_000n },
      witnessScript: payment.witnessScript,
      sighashType: btc.SigHash.ALL
    })
    tx.addOutputAddress(payment.address, 90_000n)

    const psbt0 = psbtToBase64(tx)
    expect(countPsbtSignatures(psbt0)).toBe(0)

    const materialA = acctA.privateExtendedKey
    const materialB = acctB.privateExtendedKey
    const psbt1 = partialSignPsbt(psbt0, materialA, 0, 0, 0, false)
    expect(countPsbtSignatures(psbt1)).toBe(1)
    const psbt2 = partialSignPsbt(psbt1, materialB, 0, 0, 0, false)
    expect(countPsbtSignatures(psbt2)).toBe(2)

    const { txid, txHex } = finalizeAndExtractTx(psbt2)
    expect(txid.length).toBe(64)
    expect(txHex.length).toBeGreaterThan(0)
  })

  it('manual PSBT matches scure toPSBT for unsigned P2WSH (BIP-48)', () => {
    const childA = bip48AccountAt(0).deriveChild(0).deriveChild(0)
    const childB = bip48AccountAt(1).deriveChild(0).deriveChild(0)
    const pubs = [childA.publicKey!, childB.publicKey!]
    const payment = btc.p2wsh(btc.p2ms(2, pubs))
    const tx = new btc.Transaction()
    tx.addInput({
      txid: '11'.repeat(32),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 50_000n },
      witnessScript: payment.witnessScript,
      sighashType: btc.SigHash.ALL
    })
    tx.addOutputAddress(payment.address, 40_000n)

    const manual = serializePsbtV0(tx)
    const scure = tx.toPSBT(0)
    expect(Buffer.from(manual).equals(Buffer.from(scure))).toBe(true)

    const round = parsePsbtV0(manual)
    expect(round.inputsLength).toBe(1)
    expect(round.getInput(0).witnessScript?.length).toBe(
      payment.witnessScript.length
    )
    expect(round.getInput(0).witnessUtxo?.amount).toBe(50_000n)
  })
})
