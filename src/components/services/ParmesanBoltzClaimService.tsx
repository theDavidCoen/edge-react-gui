/**
 * Parmesan — auto-claim RBTC for pending BTC→RBTC Boltz chain swaps.
 *
 * Polls BTC wallet disklet records (`parmesan-boltz-*.json`). When Boltz
 * reaches transaction.server.confirmed, broadcasts EtherSwap.claim from the
 * matching RSK wallet using the stored preimage.
 *
 * Temporary orchestration until a dedicated swap UI exists.
 */

import type { EdgeAccount } from 'edge-core-js'
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

const POLL_MS = 30_000

interface Props {
  account: EdgeAccount
}

export const ParmesanBoltzClaimService = (props: Props): null => {
  const { account } = props
  const currencyWallets = useWatch(account, 'currencyWallets')
  const claiming = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    const tick = async (): Promise<void> => {
      const wallets = Object.values(currencyWallets)
      const btcWallets = wallets.filter(
        w => w.currencyInfo.pluginId === 'bitcoin'
      )

      for (const btcWallet of btcWallets) {
        const swaps = await listParmesanSwapsOnWallet(btcWallet)
        for (const { record } of swaps) {
          if (record.direction !== 'btc_rbtc') continue
          if (
            record.status !== 'locked_awaiting_claim' &&
            record.status !== 'rbtc_claim_ready'
          ) {
            continue
          }
          if (claiming.current.has(record.id)) continue

          try {
            const statusData = await fetchBoltzSwapStatus(record.id)
            const rawStatus = statusData.status
            const state = typeof rawStatus === 'string' ? rawStatus : ''
            const serverTx = statusData.transaction as
              | { id?: string }
              | undefined

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
              console.warn(
                `[Parmesan] swap ${next.id} ready to claim but preimage missing on disklet`
              )
              continue
            }

            const claimAddress = next.claimAddress
            if (claimAddress == null) {
              console.warn(`[Parmesan] swap ${next.id} missing claimAddress`)
              continue
            }

            const rskWallet = await findRskWalletForClaim(
              currencyWallets,
              claimAddress
            )
            if (rskWallet == null) {
              console.warn(
                `[Parmesan] no RSK wallet for claimAddress ${claimAddress}`
              )
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
    }

    // Run soon after login, then periodically.
    const initial = setTimeout(() => {
      tick().catch(() => undefined)
    }, 8_000)
    const task = makePeriodicTask(() => {
      tick().catch(() => undefined)
    }, POLL_MS)
    task.start()

    return () => {
      clearTimeout(initial)
      task.stop()
    }
  }, [currencyWallets])

  return null
}
