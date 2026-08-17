import type { EdgeAccount, EdgeCurrencyWallet } from 'edge-core-js'

import { lstrings } from '../locales/strings'
import type { MainWalletCreateItem } from '../selectors/getCreateWalletList'
import type { Dispatch, ThunkAction } from '../types/reduxTypes'
import {
  buildMultisigDescriptor,
  deriveBitcoinMultisigFromDescriptor,
  deriveBitcoinMultisigOnChain,
  normalizeExtendedKey,
  pickEdgeAccountXpub,
  validateCosignerXpubs
} from '../util/multisig/bitcoinP2wsh'
import {
  deriveLocalMultisigAccountKey,
  isBip48NativeSegwitAccountXpub,
  type MultisigAccountKeyInfo
} from '../util/multisig/multisigKeys'
import {
  addMultisigInviteNotification,
  addMultisigSpendNotification,
  completeMultisigInviteNotification,
  completeMultisigSpendNotification
} from '../util/multisig/notifications'
import {
  clearOrphanInbox,
  stashOrphanMultisigMessage,
  takeOrphanMultisigMessages
} from '../util/multisig/orphanInbox'
import {
  matchImportedMultisigSeed,
  parseImportedMultisigText
} from '../util/multisig/parseImport'
import {
  broadcastRawTx,
  buildMultisigSpendQuote,
  countPsbtSignatures,
  finalizeAndExtractTx,
  getBlockbookBases,
  partialSignPsbt
} from '../util/multisig/spendPsbt'
import {
  ensureMultisigStoreLoaded,
  getCachedMultisigProposals,
  getMultisigProposal,
  getMultisigProposalByWalletId,
  getMultisigSpend,
  loadMultisigStore,
  upsertMultisigProposal,
  upsertMultisigSpend
} from '../util/multisig/store'
import {
  asMultisigAcceptMessage,
  asMultisigCompleteMessage,
  asMultisigInviteMessage,
  asMultisigSpendCompleteMessage,
  asMultisigSpendPartialMessage,
  asMultisigSpendRejectMessage,
  asMultisigSpendRequestMessage,
  formatMultisigWalletName,
  hasLocalJoinedProposal,
  isMultisigProposalReadyToComplete,
  mergeCosignerLists,
  MULTISIG_STORE_ID,
  type MultisigAcceptMessage,
  type MultisigCompleteMessage,
  type MultisigCosigner,
  type MultisigInviteMessage,
  type MultisigProposal,
  type MultisigSpendCompleteMessage,
  type MultisigSpendPartialMessage,
  type MultisigSpendProposal,
  type MultisigSpendRejectMessage,
  type MultisigSpendRequestMessage,
  type MultisigSpendSigner,
  npubsEqual,
  proposalUsesLegacyBip49Keys,
  spendSignedCount,
  withLocalCosignerAccepted
} from '../util/multisig/types'
import { decodeNpub, hexToBytes } from '../util/nostr/bech32Keys'
import {
  isSpendHandshakeSeen,
  markProposalHandshakeSeen,
  markSpendHandshakeSeen
} from '../util/nostr/dedupStore'
import { ensureNostrIdentity } from '../util/nostr/identity'
import { wrapGift } from '../util/nostr/nip17'
import { enqueueNostrOutbox, flushNostrOutbox } from '../util/nostr/outbox'
import { fetchNostrProfiles } from '../util/nostr/profile'
import { NostrRelayPool } from '../util/nostr/relayPool'
import { createWallet } from './CreateWalletActions'

let sharedPool: NostrRelayPool | null = null

export const getMultisigRelayPool = (): NostrRelayPool => {
  sharedPool ??= new NostrRelayPool()
  return sharedPool
}

export const stopMultisigRelayPool = (): void => {
  sharedPool?.stop()
  sharedPool = null
  clearOrphanInbox()
}

const randomProposalId = (): string =>
  `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`

const resolveMultisigWalletId = (
  account: EdgeAccount,
  proposal: MultisigProposal
): string | undefined => {
  if (
    proposal.walletId != null &&
    account.currencyWallets[proposal.walletId] != null
  ) {
    return proposal.walletId
  }
  const usedIds = new Set(
    getCachedMultisigProposals()
      .filter(item => item.id !== proposal.id && item.walletId != null)
      .map(item => item.walletId!)
  )
  const expectedName = formatMultisigWalletName(
    proposal.requiredSignatures,
    proposal.totalCosigners
  )
  const matches = Object.values(account.currencyWallets).filter(
    wallet =>
      !usedIds.has(wallet.id) &&
      (wallet.name === expectedName || wallet.name === proposal.walletName)
  )
  if (matches.length === 1) return matches[0].id
  return proposal.walletId
}

const cosignerDescriptorInputs = (
  proposal: MultisigProposal
): Array<{ xpub: string; fingerprint?: string }> => {
  const out: Array<{ xpub: string; fingerprint?: string }> = []
  for (const item of proposal.cosigners) {
    if (item.xpub == null || item.xpub.trim() === '') continue
    out.push({ xpub: item.xpub, fingerprint: item.parentFingerprint })
  }
  return out
}

const applyOnChainMultisig = (proposal: MultisigProposal): MultisigProposal => {
  const xpubs = proposal.cosigners
    .map(item => item.xpub)
    .filter((xpub): xpub is string => xpub != null && xpub.trim() !== '')
  if (xpubs.length < proposal.totalCosigners) return proposal

  try {
    let onChain
    let descriptor = proposal.descriptor
    if (descriptor != null && descriptor.trim() !== '') {
      onChain = deriveBitcoinMultisigFromDescriptor({ descriptor })
    } else {
      const validated =
        proposal.keyOrigin === 'bip49'
          ? xpubs.map(x => normalizeExtendedKey(x))
          : validateCosignerXpubs(xpubs)
      onChain = deriveBitcoinMultisigOnChain({
        xpubs: validated,
        requiredSignatures: proposal.requiredSignatures
      })
      if (proposal.keyOrigin !== 'bip49') {
        try {
          descriptor = buildMultisigDescriptor(
            proposal.requiredSignatures,
            cosignerDescriptorInputs(proposal)
          )
        } catch (error: unknown) {
          console.warn('Multisig BIP-48 descriptor skipped', error)
          descriptor = undefined
        }
      }
    }
    return {
      ...proposal,
      descriptor,
      p2wshAddress: onChain.p2wshAddress,
      witnessScriptHex: onChain.witnessScriptHex
    }
  } catch (error: unknown) {
    console.warn('Multisig P2WSH derivation failed', error)
    return proposal
  }
}

/**
 * Re-derive P2WSH for complete proposals that never got an address (e.g. Edge
 * ypub keys rejected by @scure/bip32 before normalizeExtendedKey existed),
 * and sanitize multiline xpubs from getDisplayPublicKey.
 */
export const repairMultisigOnChainAddresses = (): ThunkAction<
  Promise<number>
> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    await loadMultisigStore(account)
    let repaired = 0
    for (const proposal of getCachedMultisigProposals()) {
      if (proposal.status !== 'complete') continue

      let changed = false
      const walletId = resolveMultisigWalletId(account, proposal)
      if (walletId != null && walletId !== proposal.walletId) {
        changed = true
      }
      const cosigners = proposal.cosigners.map(cosigner => {
        if (cosigner.xpub == null || cosigner.xpub === '') return cosigner
        try {
          const cleaned =
            proposal.keyOrigin === 'bip48' || proposal.descriptor != null
              ? normalizeExtendedKey(cosigner.xpub)
              : normalizeExtendedKey(pickEdgeAccountXpub(cosigner.xpub))
          if (cleaned !== cosigner.xpub) changed = true
          return { ...cosigner, xpub: cleaned }
        } catch {
          return cosigner
        }
      })
      let localXpub = proposal.localXpub
      if (localXpub != null && localXpub !== '') {
        try {
          const cleaned =
            proposal.keyOrigin === 'bip48' || proposal.descriptor != null
              ? normalizeExtendedKey(localXpub)
              : normalizeExtendedKey(pickEdgeAccountXpub(localXpub))
          if (cleaned !== localXpub) {
            localXpub = cleaned
            changed = true
          }
        } catch {}
      }

      const sanitized = {
        ...proposal,
        walletId: walletId ?? proposal.walletId,
        cosigners,
        localXpub
      }
      const fixed = applyOnChainMultisig(sanitized)
      if (fixed.p2wshAddress == null || fixed.p2wshAddress === '') continue
      if (
        !changed &&
        fixed.p2wshAddress === proposal.p2wshAddress &&
        fixed.witnessScriptHex === proposal.witnessScriptHex &&
        fixed.descriptor === proposal.descriptor &&
        fixed.walletId === proposal.walletId
      ) {
        continue
      }
      await persistOnChainMultisig(account, fixed)
      await upsertMultisigProposal(account, fixed)
      repaired++
    }
    return repaired
  }
}

/**
 * Re-derive this device's cosigner xpub from the Bitcoin shell seed
 * (Raw Keys bitcoinKey / Master Private Key) at m/48'/0'/0'/2'.
 * Fixes wallets whose stored "BIP-48" key was actually a BIP-49 account xpub.
 */
export const repairMultisigBip48FromWalletSeed = (): ThunkAction<
  Promise<number>
> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    await loadMultisigStore(account)
    let repaired = 0
    for (const proposal of getCachedMultisigProposals()) {
      if (proposal.status !== 'complete') continue
      const walletId = resolveMultisigWalletId(account, proposal)
      if (walletId == null || account.currencyWallets[walletId] == null) {
        continue
      }
      let localKey: MultisigAccountKeyInfo
      try {
        localKey = await deriveLocalMultisigAccountKey(account, walletId)
      } catch {
        continue
      }
      const nextLocalXpub = normalizeExtendedKey(localKey.xpub)
      if (!isBip48NativeSegwitAccountXpub(nextLocalXpub)) continue

      let prevLocal: string | undefined
      if (proposal.localXpub != null && proposal.localXpub !== '') {
        try {
          prevLocal = normalizeExtendedKey(proposal.localXpub)
        } catch {
          prevLocal = proposal.localXpub
        }
      }

      const alreadyCorrect =
        prevLocal === nextLocalXpub &&
        isBip48NativeSegwitAccountXpub(nextLocalXpub) &&
        proposal.keyOrigin === 'bip48'
      if (alreadyCorrect) continue

      const originFp = localKey.rootFingerprint
      const cosigners = proposal.cosigners.map(cosigner => {
        let sameAsPrev = false
        if (
          cosigner.xpub != null &&
          cosigner.xpub !== '' &&
          prevLocal != null
        ) {
          try {
            sameAsPrev = normalizeExtendedKey(cosigner.xpub) === prevLocal
          } catch {
            sameAsPrev = cosigner.xpub === prevLocal
          }
        }
        const isLocal = cosigner.status === 'local' || sameAsPrev
        if (!isLocal) return cosigner
        return {
          ...cosigner,
          xpub: nextLocalXpub,
          status: 'local' as const,
          parentFingerprint: originFp
        }
      })

      const next = applyOnChainMultisig({
        ...proposal,
        walletId,
        localXpub: nextLocalXpub,
        localParentFingerprint: originFp,
        keyOrigin: 'bip48',
        cosigners,
        descriptor: undefined
      })
      await persistOnChainMultisig(account, next)
      await upsertMultisigProposal(account, next)
      repaired++
    }
    return repaired
  }
}

const persistOnChainMultisig = async (
  account: EdgeAccount,
  proposal: MultisigProposal
): Promise<void> => {
  if (proposal.walletId == null || proposal.p2wshAddress == null) return
  await account.dataStore.setItem(
    MULTISIG_STORE_ID,
    `onchain-${proposal.walletId}`,
    JSON.stringify({
      p2wshAddress: proposal.p2wshAddress,
      witnessScriptHex: proposal.witnessScriptHex,
      requiredSignatures: proposal.requiredSignatures,
      totalCosigners: proposal.totalCosigners,
      descriptor: proposal.descriptor
    })
  )
}

const deleteMultisigWallets = async (
  account: EdgeAccount,
  walletIds: string[]
): Promise<void> => {
  const states: Record<string, { deleted: true }> = {}
  for (const walletId of walletIds) {
    if (walletId === '') continue
    states[walletId] = { deleted: true }
  }
  if (Object.keys(states).length === 0) return
  await account.changeWalletStates(states)
}

/** Remove broken multisig wallet rows left by a failed accept/create sync. */
export const cleanupOrphanedMultisigWallets = (): ThunkAction<
  Promise<number>
> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    await loadMultisigStore(account)

    const linked = new Set<string>()
    for (const proposal of getCachedMultisigProposals()) {
      if (proposal.walletId != null) linked.add(proposal.walletId)
    }

    const toDelete: string[] = []
    for (const walletId of Object.keys(account.currencyWalletErrors)) {
      if (linked.has(walletId)) continue
      const wallet = account.currencyWallets[walletId]
      const name = wallet?.name ?? ''
      if (name.includes('Multisig')) {
        toDelete.push(walletId)
      }
    }

    await deleteMultisigWallets(account, toDelete)
    return toDelete.length
  }
}

const resolveWalletForMultisigAccept = async (
  account: EdgeAccount,
  dispatch: Dispatch,
  existing: MultisigProposal,
  walletType: string,
  walletName: string,
  fiatCurrencyCode: string,
  keyOptions: Record<string, unknown>
): Promise<{ wallet: EdgeCurrencyWallet; created: boolean }> => {
  const errors = account.currencyWalletErrors
  let walletId = existing.walletId

  if (
    walletId != null &&
    (account.currencyWallets[walletId] == null || errors[walletId] != null)
  ) {
    await deleteMultisigWallets(account, [walletId])
    walletId = undefined
  }

  if (walletId != null && account.currencyWallets[walletId] != null) {
    return { wallet: account.currencyWallets[walletId], created: false }
  }

  const wallet = await dispatch(
    createWallet(account, {
      walletType,
      name: walletName,
      fiatCurrencyCode,
      keyOptions
    })
  )
  return { wallet, created: true }
}

const publishToNpubs = async (
  account: EdgeAccount,
  content: string,
  nsecHex: string,
  npubs: string[]
): Promise<void> => {
  const seckey = hexToBytes(nsecHex)
  const pool = getMultisigRelayPool()
  const unique = [...new Set(npubs.filter(npub => npub.length > 0))]
  for (const npub of unique) {
    try {
      const event = wrapGift(content, seckey, decodeNpub(npub))
      await pool.publish(event)
    } catch {
      await enqueueNostrOutbox(account, {
        targetNpub: npub,
        content,
        nsecHex
      })
    }
  }
  await flushNostrOutbox(account, pool)
}

const finalizeMultisigProposalIfReady = async (
  account: EdgeAccount,
  proposal: MultisigProposal,
  prior: MultisigProposal
): Promise<MultisigProposal> => {
  if (proposal.status === 'complete') return proposal
  if (!isMultisigProposalReadyToComplete(proposal)) return proposal

  const next = applyOnChainMultisig({
    ...proposal,
    status: 'complete',
    walletName: formatMultisigWalletName(
      proposal.requiredSignatures,
      proposal.totalCosigners
    )
  })

  if (next.walletId != null) {
    const wallet = account.currencyWallets[next.walletId]
    if (wallet != null) {
      await wallet.renameWallet(next.walletName)
    }
    await persistOnChainMultisig(account, next)
  }

  if (prior.status !== 'complete') {
    // Whoever first assembles all xpubs must notify the others. The
    // initiator is often logged out on a single test device, so a
    // cosigner that finalizes still has to publish `complete`.
    const identity = await ensureNostrIdentity(account)
    const complete: MultisigCompleteMessage = {
      type: 'edge-multisig-complete',
      version: 1,
      proposalId: next.id,
      cosigners: next.cosigners
    }
    const targets = [
      next.initiatorNpub,
      ...next.cosigners.map(item => item.npub)
    ]
      .filter((npub): npub is string => npub != null)
      .filter(npub => npub !== identity.npub)
    await publishToNpubs(
      account,
      JSON.stringify(complete),
      identity.nsecHex,
      targets
    )
  }

  return next
}

export const flushMultisigNostrOutbox = (): ThunkAction<Promise<number>> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    await loadMultisigStore(account)
    return await flushNostrOutbox(account, getMultisigRelayPool())
  }
}

export const startMultisigWallet = (opts: {
  walletType: string
  keyOptions: Record<string, unknown>
  walletName?: string
  requiredSignatures: number
  totalCosigners: number
  mode: 'npub' | 'xpub'
  cosignerValues: string[]
  /** NIP-05 used to invite this cosigner (npub mode only). */
  cosignerNip05s?: Array<string | undefined>
}): ThunkAction<Promise<MultisigProposal>> => {
  return async (dispatch, getState) => {
    const state = getState()
    const { account } = state.core
    const fiatCurrencyCode = state.ui.settings.defaultIsoFiat
    const identity = await ensureNostrIdentity(account)
    const { requiredSignatures, totalCosigners, mode, cosignerValues } = opts
    const pending = mode === 'npub'
    const customName = opts.walletName?.trim()
    const walletName =
      customName != null && customName !== ''
        ? customName
        : formatMultisigWalletName(requiredSignatures, totalCosigners)

    const wallet = await dispatch(
      createWallet(account, {
        walletType: opts.walletType,
        name: walletName,
        fiatCurrencyCode,
        keyOptions: opts.keyOptions
      })
    )
    const localKey = await deriveLocalMultisigAccountKey(account, wallet.id)
    const localXpub = localKey.xpub

    const localCosigner: MultisigCosigner = {
      npub: identity.npub,
      xpub: localXpub,
      status: 'local',
      parentFingerprint: localKey.parentFingerprint
    }

    const others: MultisigCosigner[] = cosignerValues.map((value, index) =>
      mode === 'npub'
        ? {
            npub: value.trim(),
            xpub: undefined,
            nip05: opts.cosignerNip05s?.[index],
            status: 'pending' as const
          }
        : { npub: undefined, xpub: value.trim(), status: 'accepted' as const }
    )

    const proposal: MultisigProposal = {
      id: randomProposalId(),
      createdAt: Date.now(),
      role: 'initiator',
      requiredSignatures,
      totalCosigners,
      walletName,
      walletId: wallet.id,
      localXpub,
      localParentFingerprint: localKey.parentFingerprint,
      initiatorNpub: identity.npub,
      status: pending ? 'pending' : 'complete',
      keyOrigin: 'bip48',
      cosigners: [localCosigner, ...others],
      p2wshAddress: undefined,
      witnessScriptHex: undefined
    }

    if (!pending) {
      Object.assign(
        proposal,
        applyOnChainMultisig({
          ...proposal,
          status: 'complete'
        })
      )
      await persistOnChainMultisig(account, proposal)
    }

    await upsertMultisigProposal(account, proposal)

    if (pending) {
      const invite: MultisigInviteMessage = {
        type: 'edge-multisig-invite',
        version: 1,
        proposalId: proposal.id,
        walletName,
        requiredSignatures,
        totalCosigners,
        initiatorNpub: identity.npub,
        initiatorXpub: localXpub,
        cosignerNpubs: others
          .map(item => item.npub)
          .filter((npub): npub is string => npub != null)
      }
      await publishToNpubs(
        account,
        JSON.stringify(invite),
        identity.nsecHex,
        invite.cosignerNpubs
      )
    }

    return proposal
  }
}

export const importMultisigWallet = (opts: {
  createItem: MainWalletCreateItem
  walletName: string
  importText: string
  descriptorText: string
}): ThunkAction<Promise<MultisigProposal>> => {
  return async (dispatch, getState) => {
    const state = getState()
    const { account } = state.core
    const fiatCurrencyCode = state.ui.settings.defaultIsoFiat
    const { createItem, importText, descriptorText } = opts
    const currencyConfig = account.currencyConfig[createItem.pluginId]
    if (currencyConfig == null) {
      throw new Error(lstrings.multisig_import_invalid_descriptor)
    }

    const imported = parseImportedMultisigText(descriptorText)
    if (imported.kind === 'signer') {
      throw new Error(lstrings.multisig_import_signer_only)
    }
    if (imported.kind !== 'wallet') {
      throw new Error(lstrings.multisig_import_invalid_descriptor)
    }

    const onChain = deriveBitcoinMultisigFromDescriptor({
      descriptor: imported.descriptor
    })
    if (
      imported.firstAddress != null &&
      imported.firstAddress !== onChain.p2wshAddress
    ) {
      throw new Error(lstrings.multisig_import_address_mismatch)
    }

    await currencyConfig.importKey(importText, {
      keyOptions: createItem.keyOptions
    })

    const matched = matchImportedMultisigSeed(imported.parsed, importText)
    if (matched == null) {
      throw new Error(lstrings.multisig_import_seed_mismatch)
    }

    const identity = await ensureNostrIdentity(account)
    const requiredSignatures = imported.parsed.requiredSignatures
    const totalCosigners = imported.parsed.cosignerKeys.length
    const customName = opts.walletName.trim()
    const walletName =
      customName !== ''
        ? customName
        : formatMultisigWalletName(requiredSignatures, totalCosigners)

    let createdWalletId: string | undefined
    try {
      const wallet = await dispatch(
        createWallet(account, {
          walletType: createItem.walletType,
          name: walletName,
          fiatCurrencyCode,
          importText,
          keyOptions: createItem.keyOptions
        })
      )
      createdWalletId = wallet.id

      const seedXpub = normalizeExtendedKey(matched.local.xpub)
      let localXpub = seedXpub
      if (matched.keyOrigin === 'bip48') {
        try {
          const localKey = await deriveLocalMultisigAccountKey(
            account,
            wallet.id
          )
          localXpub = normalizeExtendedKey(localKey.xpub)
        } catch {}
      }
      const findLocalKey = (
        xpub: string
      ): (typeof imported.parsed.cosignerKeys)[number] | undefined =>
        imported.parsed.cosignerKeys.find(
          key => normalizeExtendedKey(key.xpub) === xpub
        )
      const localKeyEntry = findLocalKey(localXpub) ?? findLocalKey(seedXpub)
      if (localKeyEntry == null) {
        throw new Error(lstrings.multisig_import_seed_mismatch)
      }
      const matchXpub = normalizeExtendedKey(localKeyEntry.xpub)

      const cosigners: MultisigCosigner[] = imported.parsed.cosignerKeys.map(
        key => {
          const xpub = normalizeExtendedKey(key.xpub)
          const isLocal = xpub === matchXpub
          return {
            npub: isLocal ? identity.npub : undefined,
            xpub,
            status: isLocal ? ('local' as const) : ('accepted' as const),
            parentFingerprint: key.fingerprint
          }
        }
      )

      let proposal: MultisigProposal = {
        id: randomProposalId(),
        createdAt: Date.now(),
        role: 'cosigner',
        requiredSignatures,
        totalCosigners,
        walletName,
        walletId: wallet.id,
        localXpub: matchXpub,
        localParentFingerprint:
          matched.local.parentFingerprint ?? localKeyEntry.fingerprint,
        initiatorNpub: identity.npub,
        status: 'complete',
        keyOrigin: matched.keyOrigin,
        cosigners,
        descriptor: imported.descriptor,
        p2wshAddress: undefined,
        witnessScriptHex: undefined
      }
      proposal = applyOnChainMultisig(proposal)
      await persistOnChainMultisig(account, proposal)
      await upsertMultisigProposal(account, proposal)
      return proposal
    } catch (error: unknown) {
      if (createdWalletId != null) {
        await deleteMultisigWallets(account, [createdWalletId])
      }
      throw error
    }
  }
}

export const acceptMultisigInvite = (opts: {
  proposalId: string
  walletType: string
  keyOptions: Record<string, unknown>
}): ThunkAction<Promise<MultisigProposal>> => {
  return async (dispatch, getState) => {
    const { account } = getState().core
    const fiatCurrencyCode = getState().ui.settings.defaultIsoFiat
    const existing = getMultisigProposal(opts.proposalId)
    if (existing == null) {
      throw new Error('Multisig invite not found')
    }
    if (existing.status === 'complete') {
      return existing
    }

    const identity = await ensureNostrIdentity(account)
    const walletName = formatMultisigWalletName(
      existing.requiredSignatures,
      existing.totalCosigners
    )

    let createdWalletId: string | undefined
    try {
      await dispatch(cleanupOrphanedMultisigWallets())

      const { wallet, created } = await resolveWalletForMultisigAccept(
        account,
        dispatch,
        existing,
        opts.walletType,
        walletName,
        fiatCurrencyCode,
        opts.keyOptions
      )
      if (created) createdWalletId = wallet.id

      const localKey = await deriveLocalMultisigAccountKey(account, wallet.id)
      const localXpub = localKey.xpub

      const cosigners = existing.cosigners.map(item =>
        npubsEqual(item.npub, identity.npub)
          ? {
              ...item,
              xpub: localXpub,
              status: 'accepted' as const,
              parentFingerprint: localKey.parentFingerprint
            }
          : item
      )
      if (!cosigners.some(item => npubsEqual(item.npub, identity.npub))) {
        cosigners.push({
          npub: identity.npub,
          xpub: localXpub,
          status: 'accepted',
          parentFingerprint: localKey.parentFingerprint
        })
      }

      let proposal: MultisigProposal = {
        ...existing,
        role: 'cosigner',
        walletId: wallet.id,
        localXpub,
        localParentFingerprint: localKey.parentFingerprint,
        walletName,
        keyOrigin: 'bip48',
        cosigners
      }

      proposal = await finalizeMultisigProposalIfReady(
        account,
        proposal,
        existing
      )
      await upsertMultisigProposal(account, proposal)
      await completeMultisigInviteNotification(account, proposal.id)
      await declineOlderPendingInvites(account, proposal)
      await replayOrphanMessages(account, identity.npub, proposal.id)
      const afterOrphans = getMultisigProposal(proposal.id)
      if (afterOrphans != null) proposal = afterOrphans
      proposal = withLocalCosignerAccepted(proposal, identity.npub)
      await upsertMultisigProposal(account, proposal)

      const accept: MultisigAcceptMessage = {
        type: 'edge-multisig-accept',
        version: 1,
        proposalId: proposal.id,
        npub: identity.npub,
        xpub: localXpub
      }
      const targets = [
        proposal.initiatorNpub,
        ...proposal.cosigners
          .map(item => item.npub)
          .filter((npub): npub is string => npub != null)
      ].filter(npub => npub !== identity.npub)
      await publishToNpubs(
        account,
        JSON.stringify(accept),
        identity.nsecHex,
        targets
      )

      const joinedProposalId = proposal.id
      if (proposal.status === 'pending') {
        // Do not block Join. Retry inbox in the background so the last
        // joiner can pick up earlier accepts and publish `complete`.
        const retryComplete = async (): Promise<void> => {
          for (let attempt = 0; attempt < 3; attempt++) {
            await dispatch(pollMultisigInbox())
            await loadMultisigStore(account)
            const refreshed = getMultisigProposal(joinedProposalId)
            if (refreshed == null) return
            if (refreshed.status === 'complete') return
            const next = await finalizeMultisigProposalIfReady(
              account,
              refreshed,
              refreshed
            )
            if (next.status === 'complete') {
              await upsertMultisigProposal(account, next)
              return
            }
          }
        }
        retryComplete().catch(() => {})
      }

      await dispatch(cleanupOrphanedMultisigWallets())
      return proposal
    } catch (error) {
      if (createdWalletId != null && existing.walletId == null) {
        await deleteMultisigWallets(account, [createdWalletId])
      }
      throw error
    }
  }
}

export const declineMultisigInvite = (
  proposalId: string
): ThunkAction<Promise<void>> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    const existing = getMultisigProposal(proposalId)
    if (existing == null) {
      throw new Error('Multisig invite not found')
    }
    const identity = await ensureNostrIdentity(account)

    const proposal: MultisigProposal = {
      ...existing,
      status: 'declined',
      cosigners: existing.cosigners.map(item =>
        npubsEqual(item.npub, identity.npub)
          ? { ...item, status: 'pending' as const }
          : item
      )
    }
    await upsertMultisigProposal(account, proposal)
    // Only completes this invite's notification; future invites stay independent.
    await completeMultisigInviteNotification(account, proposalId)
  }
}

export type MultisigInboxResult =
  | 'invite'
  | 'accept'
  | 'complete'
  | 'spend-request'
  | 'spend-partial'
  | 'spend-reject'
  | 'spend-complete'
  | 'stashed'
  | null

let inboxChain: Promise<unknown> = Promise.resolve()

const enqueueInbox = async <T>(fn: () => Promise<T>): Promise<T> => {
  const run = inboxChain.then(fn, fn)
  inboxChain = run.then(
    () => undefined,
    () => undefined
  )
  return await run
}

const inboxProposalId = (parsed: unknown): string | undefined => {
  if (parsed == null || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  if (typeof record.proposalId === 'string') return record.proposalId
  if (typeof record.walletProposalId === 'string') {
    return record.walletProposalId
  }
  return undefined
}

const applyInboxContent = async (
  account: EdgeAccount,
  localNpub: string,
  rumorContent: string,
  createdAtMs?: number
): Promise<MultisigInboxResult> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(rumorContent)
  } catch {
    return null
  }

  const invite = tryClean(asMultisigInviteMessage, parsed)
  if (invite != null) {
    const ingested = await ingestInvite(account, localNpub, invite, createdAtMs)
    await replayOrphanMessages(account, localNpub, invite.proposalId)
    if (ingested == null) return null
    return ingested.notify ? 'invite' : null
  }

  const accept = tryClean(asMultisigAcceptMessage, parsed)
  if (accept != null) {
    const applied = await ingestAccept(account, accept)
    if (applied) return 'accept'
    if (getMultisigProposal(accept.proposalId) == null) {
      stashOrphanMultisigMessage(accept.proposalId, rumorContent)
      return 'stashed'
    }
    return null
  }
  const complete = tryClean(asMultisigCompleteMessage, parsed)
  if (complete != null) {
    const applied = await ingestComplete(
      account,
      localNpub,
      complete as MultisigCompleteMessage
    )
    if (applied) return 'complete'
    const existing = getMultisigProposal(complete.proposalId)
    if (existing == null || !hasLocalJoinedProposal(existing, localNpub)) {
      stashOrphanMultisigMessage(complete.proposalId, rumorContent)
      return 'stashed'
    }
    return null
  }

  const spendRequest = tryClean(asMultisigSpendRequestMessage, parsed)
  if (spendRequest != null) {
    const applied = await ingestSpendRequest(account, localNpub, spendRequest)
    if (applied) return 'spend-request'
    if (getMultisigProposal(spendRequest.walletProposalId) == null) {
      stashOrphanMultisigMessage(spendRequest.walletProposalId, rumorContent)
      return 'stashed'
    }
    return null
  }
  const spendPartial = tryClean(asMultisigSpendPartialMessage, parsed)
  if (spendPartial != null) {
    const applied = await ingestSpendPartial(account, spendPartial)
    if (applied) return 'spend-partial'
    const proposalId = inboxProposalId(parsed)
    if (proposalId != null && getMultisigProposal(proposalId) == null) {
      stashOrphanMultisigMessage(proposalId, rumorContent)
      return 'stashed'
    }
    return null
  }
  const spendReject = tryClean(asMultisigSpendRejectMessage, parsed)
  if (spendReject != null) {
    const applied = await ingestSpendReject(account, spendReject)
    if (applied) return 'spend-reject'
    const proposalId = inboxProposalId(parsed)
    if (proposalId != null && getMultisigProposal(proposalId) == null) {
      stashOrphanMultisigMessage(proposalId, rumorContent)
      return 'stashed'
    }
    return null
  }
  const spendComplete = tryClean(asMultisigSpendCompleteMessage, parsed)
  if (spendComplete != null) {
    const applied = await ingestSpendComplete(account, spendComplete)
    if (applied) return 'spend-complete'
    if (getMultisigProposal(spendComplete.walletProposalId) == null) {
      stashOrphanMultisigMessage(spendComplete.walletProposalId, rumorContent)
      return 'stashed'
    }
    return null
  }
  return null
}

const replayOrphanMessages = async (
  account: EdgeAccount,
  localNpub: string,
  proposalId: string
): Promise<void> => {
  const queued = takeOrphanMultisigMessages(proposalId)
  const existing = getMultisigProposal(proposalId)
  for (const content of queued) {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      continue
    }
    if (
      tryClean(asMultisigCompleteMessage, parsed) != null &&
      (existing == null || !hasLocalJoinedProposal(existing, localNpub))
    ) {
      stashOrphanMultisigMessage(proposalId, content)
      continue
    }
    await applyInboxContent(account, localNpub, content)
  }
}

const declineOlderPendingInvites = async (
  account: EdgeAccount,
  joined: MultisigProposal
): Promise<void> => {
  for (const other of getCachedMultisigProposals()) {
    if (other.id === joined.id) continue
    if (other.initiatorNpub !== joined.initiatorNpub) continue
    if (other.role !== 'cosigner') continue
    if (other.status !== 'pending') continue
    if (other.createdAt >= joined.createdAt) continue
    if (other.walletId != null) continue
    await upsertMultisigProposal(account, {
      ...other,
      status: 'declined'
    })
  }
}

export const drainPendingOrphanInbox = (): ThunkAction<Promise<void>> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    await loadMultisigStore(account)
    const identity = await ensureNostrIdentity(account)
    for (const proposal of getCachedMultisigProposals()) {
      if (proposal.status === 'declined') continue
      await replayOrphanMessages(account, identity.npub, proposal.id)
    }
  }
}

export const handleIncomingMultisigMessage = (
  rumorContent: string,
  createdAtMs?: number
): ThunkAction<Promise<MultisigInboxResult>> => {
  return async (_dispatch, getState) => {
    return await enqueueInbox(async () => {
      const { account } = getState().core
      const identity = await ensureNostrIdentity(account)
      return await applyInboxContent(
        account,
        identity.npub,
        rumorContent,
        createdAtMs
      )
    })
  }
}

const cosignerNpubs = (proposal: MultisigProposal): string[] =>
  proposal.cosigners
    .map(c => c.npub)
    .filter((n): n is string => n != null && n !== '')

const markSigner = (
  signers: MultisigSpendSigner[],
  npub: string,
  status: MultisigSpendSigner['status']
): MultisigSpendSigner[] => {
  const next = signers.map(s => (s.npub === npub ? { ...s, status } : s))
  if (!next.some(s => s.npub === npub)) {
    next.push({ npub, status })
  }
  return next
}

/**
 * Create a multisig spend: build PSBT, partial-sign locally, notify cosigners.
 * Broadcasts immediately only when requiredSignatures === 1.
 */
export const createMultisigSpendRequest = (opts: {
  walletId: string
  destAddress: string
  amountNative: string
  privateKeyMaterial: string
}): ThunkAction<Promise<MultisigSpendProposal>> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    await loadMultisigStore(account)
    const proposal = getMultisigProposalByWalletId(opts.walletId)
    if (proposal == null || proposal.status !== 'complete') {
      throw new Error('Multisig wallet is not ready')
    }
    const identity = await ensureNostrIdentity(account)
    const wallet = account.currencyWallets[opts.walletId]
    const bases = getBlockbookBases(wallet, account.currencyConfig.bitcoin)
    const { getCachedP2wshWatch, refreshP2wshWatch } = await import(
      '../util/multisig/p2wshWatch'
    )
    const watch =
      getCachedP2wshWatch(opts.walletId) ??
      (await refreshP2wshWatch(opts.walletId, proposal, wallet))
    const maxReceiveIndex = Math.max(0, watch?.maxUsedReceiveIndex ?? 0)

    const quote = await buildMultisigSpendQuote({
      proposal,
      destAddress: opts.destAddress,
      amountNative: opts.amountNative,
      bases,
      maxReceiveIndex
    })

    const signedPsbt = partialSignPsbt(
      quote.psbtBase64,
      opts.privateKeyMaterial,
      0,
      0,
      maxReceiveIndex,
      proposalUsesLegacyBip49Keys(proposal)
    )
    const signers: MultisigSpendSigner[] = cosignerNpubs(proposal).map(
      npub => ({
        npub,
        status:
          npub === identity.npub ? ('signed' as const) : ('pending' as const)
      })
    )

    const spendId = randomProposalId()
    let spend: MultisigSpendProposal = {
      id: spendId,
      walletProposalId: proposal.id,
      walletId: opts.walletId,
      createdAt: Date.now(),
      status: 'pending',
      requiredSignatures: proposal.requiredSignatures,
      totalCosigners: proposal.totalCosigners,
      psbtBase64: signedPsbt,
      amountNative: quote.amountNative,
      destAddress: quote.destAddress,
      feeNative: quote.feeNative,
      initiatorNpub: identity.npub,
      txid: undefined,
      signers
    }

    if (spendSignedCount(spend) >= spend.requiredSignatures) {
      const { txHex, txid } = finalizeAndExtractTx(spend.psbtBase64)
      await broadcastRawTx(txHex, bases)
      spend = {
        ...spend,
        status: 'broadcast',
        txid,
        psbtBase64: signedPsbt
      }
      await upsertMultisigSpend(account, spend)
      const completeMsg: MultisigSpendCompleteMessage = {
        type: 'edge-multisig-spend-complete',
        version: 1,
        spendId: spend.id,
        walletProposalId: proposal.id,
        txid,
        psbtBase64: spend.psbtBase64,
        signers: spend.signers
      }
      await publishToNpubs(
        account,
        JSON.stringify(completeMsg),
        identity.nsecHex,
        cosignerNpubs(proposal).filter(n => n !== identity.npub)
      )
      return spend
    }

    await upsertMultisigSpend(account, spend)
    const requestMsg: MultisigSpendRequestMessage = {
      type: 'edge-multisig-spend-request',
      version: 1,
      spendId: spend.id,
      walletProposalId: proposal.id,
      requiredSignatures: spend.requiredSignatures,
      totalCosigners: spend.totalCosigners,
      psbtBase64: spend.psbtBase64,
      amountNative: spend.amountNative,
      destAddress: spend.destAddress,
      feeNative: spend.feeNative,
      initiatorNpub: identity.npub,
      signers: spend.signers
    }
    await publishToNpubs(
      account,
      JSON.stringify(requestMsg),
      identity.nsecHex,
      cosignerNpubs(proposal).filter(n => n !== identity.npub)
    )
    return spend
  }
}

export const approveMultisigSpend = (opts: {
  spendId: string
  privateKeyMaterial: string
}): ThunkAction<Promise<MultisigSpendProposal>> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    await loadMultisigStore(account)
    const existing = getMultisigSpend(opts.spendId)
    if (existing == null) throw new Error('Spend request not found')
    if (existing.status !== 'pending') {
      throw new Error('Spend request is no longer pending')
    }
    const identity = await ensureNostrIdentity(account)
    const walletProposal = getMultisigProposal(existing.walletProposalId)
    const wallet =
      existing.walletId != null
        ? account.currencyWallets[existing.walletId]
        : walletProposal?.walletId != null
        ? account.currencyWallets[walletProposal.walletId]
        : undefined
    const bases = getBlockbookBases(wallet, account.currencyConfig.bitcoin)
    const { getCachedP2wshWatch } = await import('../util/multisig/p2wshWatch')
    const walletIdForWatch = existing.walletId ?? walletProposal?.walletId ?? ''
    const maxReceiveIndex = Math.max(
      0,
      getCachedP2wshWatch(walletIdForWatch)?.maxUsedReceiveIndex ?? 0
    )

    const signedPsbt = partialSignPsbt(
      existing.psbtBase64,
      opts.privateKeyMaterial,
      0,
      0,
      maxReceiveIndex,
      walletProposal != null
        ? proposalUsesLegacyBip49Keys(walletProposal)
        : false
    )
    const signers = markSigner(existing.signers, identity.npub, 'signed')
    let spend: MultisigSpendProposal = {
      ...existing,
      psbtBase64: signedPsbt,
      signers,
      walletId: existing.walletId ?? walletProposal?.walletId
    }

    if (spendSignedCount(spend) >= spend.requiredSignatures) {
      const { txHex, txid } = finalizeAndExtractTx(spend.psbtBase64)
      await broadcastRawTx(txHex, bases)
      spend = { ...spend, status: 'broadcast', txid }
      await upsertMultisigSpend(account, spend)
      await completeMultisigSpendNotification(account, spend.id)
      const completeMsg: MultisigSpendCompleteMessage = {
        type: 'edge-multisig-spend-complete',
        version: 1,
        spendId: spend.id,
        walletProposalId: spend.walletProposalId,
        txid,
        psbtBase64: spend.psbtBase64,
        signers: spend.signers
      }
      const targets =
        walletProposal != null
          ? cosignerNpubs(walletProposal).filter(n => n !== identity.npub)
          : spend.signers.map(s => s.npub).filter(n => n !== identity.npub)
      await publishToNpubs(
        account,
        JSON.stringify(completeMsg),
        identity.nsecHex,
        targets
      )
      return spend
    }

    await upsertMultisigSpend(account, spend)
    await completeMultisigSpendNotification(account, spend.id)
    const partialMsg: MultisigSpendPartialMessage = {
      type: 'edge-multisig-spend-partial',
      version: 1,
      spendId: spend.id,
      walletProposalId: spend.walletProposalId,
      npub: identity.npub,
      psbtBase64: spend.psbtBase64,
      signers: spend.signers
    }
    const targets =
      walletProposal != null
        ? cosignerNpubs(walletProposal).filter(n => n !== identity.npub)
        : spend.signers.map(s => s.npub).filter(n => n !== identity.npub)
    await publishToNpubs(
      account,
      JSON.stringify(partialMsg),
      identity.nsecHex,
      targets
    )
    return spend
  }
}

export const rejectMultisigSpend = (
  spendId: string
): ThunkAction<Promise<MultisigSpendProposal>> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    await loadMultisigStore(account)
    const existing = getMultisigSpend(spendId)
    if (existing == null) throw new Error('Spend request not found')
    if (existing.status !== 'pending') return existing
    const identity = await ensureNostrIdentity(account)
    const walletProposal = getMultisigProposal(existing.walletProposalId)
    const spend: MultisigSpendProposal = {
      ...existing,
      status: 'rejected',
      signers: markSigner(existing.signers, identity.npub, 'rejected')
    }
    await upsertMultisigSpend(account, spend)
    await completeMultisigSpendNotification(account, spend.id)
    const rejectMsg: MultisigSpendRejectMessage = {
      type: 'edge-multisig-spend-reject',
      version: 1,
      spendId: spend.id,
      walletProposalId: spend.walletProposalId,
      npub: identity.npub
    }
    const targets =
      walletProposal != null
        ? cosignerNpubs(walletProposal).filter(n => n !== identity.npub)
        : spend.signers.map(s => s.npub).filter(n => n !== identity.npub)
    await publishToNpubs(
      account,
      JSON.stringify(rejectMsg),
      identity.nsecHex,
      targets
    )
    return spend
  }
}

const ingestSpendRequest = async (
  account: EdgeAccount,
  localNpub: string,
  msg: MultisigSpendRequestMessage
): Promise<boolean> => {
  if (msg.initiatorNpub === localNpub) return false
  if (await isSpendHandshakeSeen(account, msg.spendId, msg.walletProposalId)) {
    const existing = getMultisigSpend(msg.spendId)
    if (existing != null && existing.status !== 'pending') return false
  }
  const existing = getMultisigSpend(msg.spendId)
  if (existing != null && existing.status !== 'pending') return false
  if (
    existing != null &&
    countPsbtSignatures(existing.psbtBase64) >=
      countPsbtSignatures(msg.psbtBase64)
  ) {
    return false
  }

  const walletProposal = getMultisigProposal(msg.walletProposalId)
  const spend: MultisigSpendProposal = {
    id: msg.spendId,
    walletProposalId: msg.walletProposalId,
    walletId: walletProposal?.walletId,
    createdAt: existing?.createdAt ?? Date.now(),
    status: 'pending',
    requiredSignatures: msg.requiredSignatures,
    totalCosigners: msg.totalCosigners,
    psbtBase64: msg.psbtBase64,
    amountNative: msg.amountNative,
    destAddress: msg.destAddress,
    feeNative: msg.feeNative,
    initiatorNpub: msg.initiatorNpub,
    txid: undefined,
    signers: msg.signers
  }
  await upsertMultisigSpend(account, spend)
  await markSpendHandshakeSeen(account, msg.spendId, msg.walletProposalId)
  if (existing == null) {
    await addMultisigSpendNotification(account, spend.id)
  }
  return existing == null
}

const ingestSpendPartial = async (
  account: EdgeAccount,
  msg: MultisigSpendPartialMessage
): Promise<boolean> => {
  const existing = getMultisigSpend(msg.spendId)
  if (existing == null) {
    // Late join: store minimal pending spend from partial
    const walletProposal = getMultisigProposal(msg.walletProposalId)
    if (walletProposal == null) return false
    const spend: MultisigSpendProposal = {
      id: msg.spendId,
      walletProposalId: msg.walletProposalId,
      walletId: walletProposal.walletId,
      createdAt: Date.now(),
      status: 'pending',
      requiredSignatures: walletProposal.requiredSignatures,
      totalCosigners: walletProposal.totalCosigners,
      psbtBase64: msg.psbtBase64,
      amountNative: '0',
      destAddress: '',
      feeNative: '0',
      initiatorNpub: msg.npub,
      txid: undefined,
      signers: msg.signers
    }
    await upsertMultisigSpend(account, spend)
    return true
  }
  if (existing.status !== 'pending') return false
  if (
    countPsbtSignatures(msg.psbtBase64) <=
    countPsbtSignatures(existing.psbtBase64)
  ) {
    return false
  }
  await upsertMultisigSpend(account, {
    ...existing,
    psbtBase64: msg.psbtBase64,
    signers: msg.signers
  })
  return true
}

const ingestSpendReject = async (
  account: EdgeAccount,
  msg: MultisigSpendRejectMessage
): Promise<boolean> => {
  const existing = getMultisigSpend(msg.spendId)
  if (existing == null || existing.status !== 'pending') return false
  await upsertMultisigSpend(account, {
    ...existing,
    status: 'rejected',
    signers: markSigner(existing.signers, msg.npub, 'rejected')
  })
  await completeMultisigSpendNotification(account, msg.spendId)
  return true
}

const ingestSpendComplete = async (
  account: EdgeAccount,
  msg: MultisigSpendCompleteMessage
): Promise<boolean> => {
  const existing = getMultisigSpend(msg.spendId)
  if (existing?.status === 'broadcast') return false
  const walletProposal = getMultisigProposal(msg.walletProposalId)
  await upsertMultisigSpend(account, {
    id: msg.spendId,
    walletProposalId: msg.walletProposalId,
    walletId: existing?.walletId ?? walletProposal?.walletId,
    createdAt: existing?.createdAt ?? Date.now(),
    status: 'broadcast',
    requiredSignatures:
      existing?.requiredSignatures ?? walletProposal?.requiredSignatures ?? 1,
    totalCosigners:
      existing?.totalCosigners ?? walletProposal?.totalCosigners ?? 1,
    psbtBase64: msg.psbtBase64,
    amountNative: existing?.amountNative ?? '0',
    destAddress: existing?.destAddress ?? '',
    feeNative: existing?.feeNative ?? '0',
    initiatorNpub: existing?.initiatorNpub ?? '',
    txid: msg.txid,
    signers: msg.signers
  })
  await completeMultisigSpendNotification(account, msg.spendId)
  return true
}

const ingestInvite = async (
  account: EdgeAccount,
  localNpub: string,
  invite: MultisigInviteMessage,
  createdAtMs?: number
): Promise<{ notify: boolean } | null> => {
  if (invite.initiatorNpub === localNpub) return null
  const existingInvite = getMultisigProposal(invite.proposalId)
  if (existingInvite != null) {
    if (
      existingInvite.status === 'pending' &&
      existingInvite.walletId == null
    ) {
      await addMultisigInviteNotification(
        account,
        existingInvite.id,
        invite.initiatorNpub,
        true
      )
    }
    return null
  }

  const incomingCreatedAt = createdAtMs ?? Date.now()
  const isFresh =
    createdAtMs == null || Date.now() - createdAtMs < 15 * 60 * 1000

  const cosigners: MultisigCosigner[] = [
    {
      npub: invite.initiatorNpub,
      xpub: invite.initiatorXpub,
      nip05: undefined,
      status: 'accepted',
      parentFingerprint: undefined
    },
    ...invite.cosignerNpubs.map(npub => ({
      npub,
      xpub: undefined,
      nip05: undefined,
      status: 'pending' as const,
      parentFingerprint: undefined
    }))
  ]

  const proposal: MultisigProposal = {
    id: invite.proposalId,
    createdAt: incomingCreatedAt,
    role: 'cosigner',
    requiredSignatures: invite.requiredSignatures,
    totalCosigners: invite.totalCosigners,
    walletName: invite.walletName,
    walletId: undefined,
    localXpub: undefined,
    localParentFingerprint: undefined,
    initiatorNpub: invite.initiatorNpub,
    status: 'pending',
    keyOrigin: undefined,
    cosigners,
    p2wshAddress: undefined,
    witnessScriptHex: undefined,
    descriptor: undefined
  }
  await upsertMultisigProposal(account, proposal)
  await markProposalHandshakeSeen(account, proposal.id)
  const notify = await addMultisigInviteNotification(
    account,
    proposal.id,
    invite.initiatorNpub,
    isFresh
  )
  fetchNostrProfiles([invite.initiatorNpub, ...invite.cosignerNpubs]).catch(
    () => {}
  )
  return { notify }
}

const ingestAccept = async (
  account: EdgeAccount,
  accept: MultisigAcceptMessage
): Promise<boolean> => {
  const existing = getMultisigProposal(accept.proposalId)
  if (existing == null) return false

  const alreadyAccepted = existing.cosigners.some(
    item =>
      npubsEqual(item.npub, accept.npub) &&
      item.status === 'accepted' &&
      item.xpub === accept.xpub
  )
  if (alreadyAccepted && existing.status === 'complete') return false

  const cosigners = existing.cosigners.map(item =>
    npubsEqual(item.npub, accept.npub)
      ? { ...item, xpub: accept.xpub, status: 'accepted' as const }
      : item
  )
  if (!cosigners.some(item => npubsEqual(item.npub, accept.npub))) {
    cosigners.push({
      npub: accept.npub,
      xpub: accept.xpub,
      status: 'accepted'
    })
  }

  let proposal: MultisigProposal = {
    ...existing,
    cosigners
  }

  proposal = await finalizeMultisigProposalIfReady(account, proposal, existing)

  if (alreadyAccepted && proposal.status === existing.status) return false

  await upsertMultisigProposal(account, proposal)
  return true
}

const ingestComplete = async (
  account: EdgeAccount,
  localNpub: string,
  complete: MultisigCompleteMessage
): Promise<boolean> => {
  const existing = getMultisigProposal(complete.proposalId)
  if (existing == null) return false
  // Already finalized — relays re-deliver this on every login/reconnect.
  if (existing.status === 'complete') return false
  // Cosigners must join first. Applying complete here skipped the invite slider
  // and toasted "wallet is ready" on login.
  if (!hasLocalJoinedProposal(existing, localNpub)) return false

  const proposal: MultisigProposal = applyOnChainMultisig(
    withLocalCosignerAccepted(
      {
        ...existing,
        cosigners: mergeCosignerLists(complete.cosigners, existing.cosigners),
        status: 'complete',
        walletName: formatMultisigWalletName(
          existing.requiredSignatures,
          existing.totalCosigners
        )
      },
      localNpub
    )
  )
  if (proposal.walletId != null) {
    const wallet = account.currencyWallets[proposal.walletId]
    if (wallet != null) {
      await wallet.renameWallet(proposal.walletName)
    }
    await persistOnChainMultisig(account, proposal)
  }
  await upsertMultisigProposal(account, proposal)
  return true
}

/**
 * Re-query relays for gift wraps using the existing live subscription.
 * Do not replace the subscribe handler — that drops seen-tracking.
 */
export const pollMultisigInbox = (
  waitMs: number = 1200
): ThunkAction<Promise<void>> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    await ensureMultisigStoreLoaded(account)
    await ensureNostrIdentity(account)
    await getMultisigRelayPool().pollInbox(waitMs)
  }
}

/**
 * Force-query Nostr relays for cosigner accept / complete messages for a
 * multisig wallet. Call alongside blockchain resync.
 */
export const refreshMultisigCosignerStatus = (
  walletId: string
): ThunkAction<Promise<void>> => {
  return async (_dispatch, getState) => {
    const { account } = getState().core
    const proposal = getMultisigProposalByWalletId(walletId)
    if (proposal == null || proposal.status !== 'pending') return

    await ensureNostrIdentity(account)
    const pool = getMultisigRelayPool()
    await pool.pollInbox(5000)
    await loadMultisigStore(account)

    const refreshed = getMultisigProposal(proposal.id)
    if (refreshed != null && refreshed.status === 'complete') {
      const wallet = account.currencyWallets[walletId]
      if (wallet != null && wallet.name !== refreshed.walletName) {
        await wallet.renameWallet(refreshed.walletName)
      }
      return
    }

    // Clean legacy "(Pending)" wallet names from earlier builds.
    const wallet = account.currencyWallets[walletId]
    const cleanName = formatMultisigWalletName(
      proposal.requiredSignatures,
      proposal.totalCosigners
    )
    if (wallet != null && wallet.name !== cleanName) {
      await wallet.renameWallet(cleanName)
      await upsertMultisigProposal(account, {
        ...proposal,
        walletName: cleanName
      })
    }
  }
}

const tryClean = <T>(
  cleaner: (raw: unknown) => T,
  raw: unknown
): T | undefined => {
  try {
    return cleaner(raw)
  } catch {
    return undefined
  }
}
