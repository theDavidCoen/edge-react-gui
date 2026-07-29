/**
 * Parmesan — auto-claim RBTC for pending BTC→RBTC Boltz chain swaps.
 *
 * Polls BTC wallet disklet records (`parmesan-boltz-*.json`). When Boltz
 * reaches transaction.server.confirmed, broadcasts EtherSwap.claim from the
 * matching RSK wallet using the stored preimage.
 *
 * Temporary orchestration until a dedicated swap UI exists.
 */

import type { EdgeAccount, EdgeCurrencyWallet } from 'edge-core-js'
import * as React from 'react'

import { useWatch } from '../../hooks/useWatch'
import {
  BOLTZ_SERVER_LOCK_READY_STATES,
  claimBoltzRbtcSwap,
  fetchBoltzSwapStatus,
  findRskWalletForClaim,
  listParmesanSwapsOnWallet,
  type ParmesanSwapRecord,
  saveParmesanSwap
} from '../../util/parmesanBoltzClaim'
import { makePeriodicTask } from '../../util/PeriodicTask'
import { showToast } from './AirshipInstance'

const POLL_MS = 20_000
const START_DELAY_MS = 3_000

interface Props {
  account: EdgeAccount
}

export const ParmesanBoltzClaimService = (props: Props): null => {
  const { account } = props
  // Keep a live ref so the poll loop does not restart on every wallet update
  // (sync progress would otherwise cancel the initial timer forever).
  const currencyWallets = useWatch(account, 'currencyWallets')
  const walletsRef = React.useRef(currencyWallets)
  walletsRef.current = currencyWallets

  const claiming = React.useRef<Set<string>>(new Set())
  const warnedMissing = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    const tick = async (): Promise<void> => {
      const wallets = Object.values(walletsRef.current)
      const btcWallets = wallets.filter(
        (w: EdgeCurrencyWallet) => w.currencyInfo.pluginId === 'bitcoin'
      )

      if (btcWallets.length === 0) return

      let foundPending = 0
      for (const btcWallet of btcWallets) {
        let swaps: Awaited<ReturnType<typeof listParmesanSwapsOnWallet>> = []
        try {
          swaps = await listParmesanSwapsOnWallet(btcWallet)
        } catch (e) {
          console.warn(
            `[Parmesan] disklet list failed on ${btcWallet.id}: ${String(e)}`
          )
          continue
        }

        for (const { record } of swaps) {
          if (record.direction !== 'btc_rbtc') continue
          if (
            record.status !== 'locked_awaiting_claim' &&
            record.status !== 'rbtc_claim_ready'
          ) {
            continue
          }
          foundPending += 1
          if (claiming.current.has(record.id)) continue

          try {
            const statusData = await fetchBoltzSwapStatus(record.id)
            const rawStatus = statusData.status
            const state = typeof rawStatus === 'string' ? rawStatus : ''
            const serverTx = statusData.transaction as
              | { id?: string }
              | undefined

            console.warn(
              `[Parmesan] poll swap ${record.id} boltz=${state} disklet=${record.status}`
            )

            if (
              state === 'transaction.claimed' ||
              state === 'transaction.claim.pending'
            ) {
              await saveParmesanSwap(btcWallet, {
                ...record,
                status: 'completed'
              })
              continue
            }

            if (!BOLTZ_SERVER_LOCK_READY_STATES.has(state)) continue

            let next: ParmesanSwapRecord = {
              ...record,
              status: 'rbtc_claim_ready',
              serverLockTxid: serverTx?.id ?? record.serverLockTxid
            }
            await saveParmesanSwap(btcWallet, next)

            if (next.preimage == null || next.preimage === '') {
              if (!warnedMissing.current.has(next.id)) {
                warnedMissing.current.add(next.id)
                showToast(
                  `Boltz ${next.id}: preimage missing — cannot claim`,
                  6000
                )
                console.warn(
                  `[Parmesan] swap ${next.id} ready to claim but preimage missing on disklet`
                )
              }
              continue
            }

            const claimAddress = next.claimAddress
            if (claimAddress == null) {
              console.warn(`[Parmesan] swap ${next.id} missing claimAddress`)
              continue
            }

            const rskWallet = await findRskWalletForClaim(
              walletsRef.current,
              claimAddress
            )
            if (rskWallet == null) {
              if (!warnedMissing.current.has(`rsk-${next.id}`)) {
                warnedMissing.current.add(`rsk-${next.id}`)
                showToast(`Boltz ${next.id}: no RSK wallet found`, 5000)
              }
              continue
            }

            claiming.current.add(next.id)
            showToast(`Claiming Boltz RBTC for swap ${next.id}…`, 4000)
            try {
              const txid = await claimBoltzRbtcSwap(rskWallet, next)
              next = { ...next, status: 'completed' }
              await saveParmesanSwap(btcWallet, next)
              showToast(`RBTC claimed (${txid.slice(0, 10)}…)`, 5000)
              console.warn(
                `[Parmesan] claimed RBTC for swap ${next.id}: ${txid}`
              )
            } catch (e) {
              next = { ...next, status: 'rbtc_claim_ready' }
              await saveParmesanSwap(btcWallet, next)
              console.warn(
                `[Parmesan] RBTC claim failed for ${next.id}: ${String(e)}`
              )
              showToast(`Boltz RBTC claim failed: ${String(e)}`, 6000)
            } finally {
              claiming.current.delete(next.id)
            }
          } catch (e) {
            console.warn(
              `[Parmesan] claim poll error for ${record.id}: ${String(e)}`
            )
          }
        }
      }

      if (foundPending === 0) {
        console.warn(
          `[Parmesan] claim poll: no pending btc_rbtc disklet records on ${btcWallets.length} BTC wallet(s)`
        )
      }
    }

    // Stable effect (account only): wallet updates must not reset the timer.
    const task = makePeriodicTask(() => {
      tick().catch(() => undefined)
    }, POLL_MS)
    task.start({ wait: START_DELAY_MS })

    return () => {
      task.stop()
    }
  }, [account])

  return null
}
