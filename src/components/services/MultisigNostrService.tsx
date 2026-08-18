import { bytesToHex } from '@noble/hashes/utils'
import NetInfo from '@react-native-community/netinfo'
import type { EdgeAccount } from 'edge-core-js'
import type * as React from 'react'

import {
  cleanupOrphanedMultisigWallets,
  drainPendingOrphanInbox,
  flushMultisigNostrOutbox,
  getMultisigRelayPool,
  handleIncomingMultisigMessage,
  pollMultisigInbox,
  repairMultisigBip48FromWalletSeed,
  repairMultisigOnChainAddresses,
  stopMultisigRelayPool
} from '../../actions/MultisigActions'
import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { lstrings } from '../../locales/strings'
import { useDispatch } from '../../types/reactRedux'
import { isAccountDataStoreActive } from '../../util/multisig/accountActive'
import { showJoinableInviteBanners } from '../../util/multisig/notifications'
import { refreshP2wshWatch } from '../../util/multisig/p2wshWatch'
import {
  getCachedMultisigIdentity,
  getCachedMultisigProposals,
  loadMultisigStore,
  upsertMultisigProposal,
  useMultisigProposals,
  waitForNostrIdentity
} from '../../util/multisig/store'
import { formatMultisigWalletName } from '../../util/multisig/types'
import { decodeNpub, hexToBytes } from '../../util/nostr/bech32Keys'
import {
  isNostrEventSeenSync,
  loadNostrDedupStore,
  markNostrEventSeen
} from '../../util/nostr/dedupStore'
import { unwrapGift } from '../../util/nostr/nip17'
import {
  fetchNostrProfiles,
  refreshOwnNostrProfile,
  seedProfileFromIdentity
} from '../../util/nostr/profile'
import { showToast } from './AirshipInstance'

interface Props {
  account: EdgeAccount
}

/**
 * Background Nostr listener for multisig invite / accept / complete messages.
 * Messaging is limited to the Multisig protocol (not a full chat product).
 */
export const MultisigNostrService: React.FC<Props> = props => {
  const { account } = props
  const dispatch = useDispatch()
  const accountId = account.id
  const proposals = useMultisigProposals()

  useAsyncEffect(
    async () => {
      const complete = proposals.filter(
        p => p.status === 'complete' && p.walletId != null
      )
      if (complete.length === 0) return

      let cancelled = false
      const refreshAll = (): void => {
        if (cancelled || !isAccountDataStoreActive(account)) return
        for (const proposal of complete) {
          const walletId = proposal.walletId
          if (walletId == null) continue
          const wallet = account.currencyWallets[walletId]
          refreshP2wshWatch(walletId, proposal, wallet).catch(() => {})
        }
      }
      refreshAll()
      const timer = setInterval(refreshAll, 15000)
      return () => {
        cancelled = true
        clearInterval(timer)
      }
    },
    [accountId, proposals],
    'MultisigNostrService:p2wshPoll'
  )

  useAsyncEffect(
    async () => {
      const pending = proposals.filter(
        p =>
          p.status === 'pending' &&
          (p.walletId != null || p.role === 'initiator')
      )
      if (pending.length === 0) return

      let cancelled = false
      let busy = false
      const tick = (): void => {
        if (cancelled || busy || !isAccountDataStoreActive(account)) return
        busy = true
        dispatch(pollMultisigInbox())
          .catch(() => {})
          .finally(() => {
            busy = false
          })
      }
      tick()
      const timer = setInterval(tick, 8000)
      return () => {
        cancelled = true
        clearInterval(timer)
      }
    },
    [accountId, proposals, dispatch],
    'MultisigNostrService:pendingPoll'
  )

  useAsyncEffect(
    async () => {
      if (!isAccountDataStoreActive(account)) return

      let cancelled = false
      const isActive = (): boolean =>
        !cancelled && isAccountDataStoreActive(account)

      await loadMultisigStore(account)
      if (!isActive()) return
      await loadNostrDedupStore(account)
      if (!isActive()) return

      // Do not create a Nostr key or hit relays for accounts that never
      // used multisig — that opened ~9 sockets and stalled wallet sync.
      if (getCachedMultisigIdentity() == null) return
      if (getCachedMultisigProposals().length === 0) return

      await dispatch(cleanupOrphanedMultisigWallets())
      if (!isActive()) return
      await dispatch(repairMultisigOnChainAddresses())
      if (!isActive()) return
      await dispatch(repairMultisigBip48FromWalletSeed())
      if (!isActive()) return
      await dispatch(flushMultisigNostrOutbox())
      if (!isActive()) return

      const identity = getCachedMultisigIdentity()
      if (identity == null || !isActive()) return
      seedProfileFromIdentity(identity)
      refreshOwnNostrProfile(account).catch(() => {})

      const knownNpubs = new Set<string>([identity.npub])
      for (const proposal of getCachedMultisigProposals()) {
        knownNpubs.add(proposal.initiatorNpub)
        for (const cosigner of proposal.cosigners) {
          if (cosigner.npub != null) knownNpubs.add(cosigner.npub)
        }
      }
      fetchNostrProfiles([...knownNpubs]).catch(() => {})

      for (const proposal of getCachedMultisigProposals()) {
        if (!isActive()) return
        if (proposal.status !== 'complete') continue
        if (proposal.walletId == null) continue
        const wallet = account.currencyWallets[proposal.walletId]
        if (wallet == null) continue
        const cleanName = formatMultisigWalletName(
          proposal.requiredSignatures,
          proposal.totalCosigners
        )
        if (wallet.name !== cleanName) {
          await wallet.renameWallet(cleanName)
          if (!isActive()) return
          await upsertMultisigProposal(account, {
            ...proposal,
            walletName: cleanName
          })
        }
      }

      const netInfoUnsubscribe = NetInfo.addEventListener(state => {
        if (state.isConnected === true && isActive()) {
          dispatch(flushMultisigNostrOutbox()).catch(() => {})
          dispatch(pollMultisigInbox(2000)).catch(() => {})
        }
      })

      return () => {
        cancelled = true
        netInfoUnsubscribe()
      }
    },
    [accountId],
    'MultisigNostrService'
  )

  useAsyncEffect(
    async () => {
      if (!isAccountDataStoreActive(account)) return

      let cancelled = false
      const isActive = (): boolean =>
        !cancelled && isAccountDataStoreActive(account)

      await loadMultisigStore(account)
      if (!isActive()) return
      await loadNostrDedupStore(account)
      if (!isActive()) return

      // Idle until the user actually has a Nostr identity (Create Multisig
      // or Settings). Auto-creating keys on every login made the whole app
      // wait on Damus/nos.lol/Primal even for accounts with no multisig.
      const ensured =
        getCachedMultisigIdentity() ?? (await waitForNostrIdentity(isActive))
      if (ensured == null || !isActive()) return
      await showJoinableInviteBanners(account)
      if (!isActive()) return

      const pool = getMultisigRelayPool()
      pool.setEventDedupChecker(isNostrEventSeenSync)
      const pubkeyHex = bytesToHex(decodeNpub(ensured.npub))
      const seckey = hexToBytes(ensured.nsecHex)
      const inflight = new Set<string>()
      let inboxQueue: Promise<unknown> = Promise.resolve()

      pool.subscribe(pubkeyHex, event => {
        if (!isActive()) return
        if (inflight.has(event.id) || isNostrEventSeenSync(event.id)) return
        inflight.add(event.id)

        const handleEvent = async (): Promise<void> => {
          if (!isActive()) {
            inflight.delete(event.id)
            return
          }
          try {
            const rumor = unwrapGift(event, seckey)
            const result = await dispatch(
              handleIncomingMultisigMessage(
                rumor.content,
                event.created_at * 1000
              )
            )
            // Stashed accepts/completes must stay unseen so a later login
            // can replay them after the matching invite exists.
            if (result !== 'stashed') {
              await markNostrEventSeen(account, event.id)
            }
            inflight.delete(event.id)
            if (!isActive()) return
            if (result === 'invite') {
              showToast(lstrings.multisig_invite_received_toast)
            } else if (result === 'complete') {
              const waitingToJoin = getCachedMultisigProposals().some(
                item =>
                  item.role === 'cosigner' &&
                  item.status === 'pending' &&
                  item.walletId == null
              )
              if (!waitingToJoin) {
                showToast(lstrings.multisig_complete_toast)
              }
            } else if (result === 'spend-request') {
              showToast(lstrings.multisig_spend_request_toast)
            }
          } catch {
            inflight.delete(event.id)
          }
        }
        inboxQueue = inboxQueue.then(handleEvent, handleEvent)
      })

      // Do not await drain before the first relay dump — that delayed the
      // invite card until wallet repair finished.
      dispatch(drainPendingOrphanInbox()).catch(() => {})
      await pool.pollInbox(2000)
      if (!isActive()) return

      const retryPolls = async (): Promise<void> => {
        for (const delayMs of [2000, 5000, 10000]) {
          await new Promise<void>(resolve => setTimeout(resolve, delayMs))
          if (!isActive()) return
          await pool.pollInbox(2000)
        }
      }
      retryPolls().catch(() => {})

      return () => {
        cancelled = true
        stopMultisigRelayPool()
      }
    },
    [accountId, dispatch],
    'MultisigNostrService:subscribe'
  )

  return null
}
