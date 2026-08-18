import * as React from 'react'

import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useSelector } from '../../types/reactRedux'
import {
  getCachedP2wshWatch,
  type P2wshWatchSnapshot,
  refreshP2wshWatch,
  watchP2wsh
} from './p2wshWatch'
import { getMultisigProposalByWalletId, useMultisigProposals } from './store'

/**
 * Shared P2WSH balance (sats as decimal string) for a complete multisig wallet.
 * Returns null when not a complete multisig / still loading / fetch failed.
 */
export const useMultisigP2wshBalance = (walletId: string): string | null => {
  const accountId = useSelector(state => state.core.account.id)
  const wallet = useSelector(
    state => state.core.account.currencyWallets[walletId]
  )
  const proposals = useMultisigProposals()
  const proposal = React.useMemo(() => {
    const found =
      proposals.find(item => item.walletId === walletId) ??
      getMultisigProposalByWalletId(walletId)
    return found?.status === 'complete' ? found : undefined
  }, [proposals, walletId])
  const proposalId = proposal?.id

  const [balanceSats, setBalanceSats] = React.useState<string | null>(
    () => getCachedP2wshWatch(walletId)?.balanceSats ?? null
  )

  React.useEffect(() => {
    if (proposalId == null) return
    return watchP2wsh(event => {
      if (event.walletId !== walletId) return
      setBalanceSats(event.snapshot?.balanceSats ?? null)
    })
  }, [walletId, proposalId])

  useAsyncEffect(
    async () => {
      if (proposal == null) {
        setBalanceSats(null)
        return
      }
      const snap = await refreshP2wshWatch(walletId, proposal, wallet)
      setBalanceSats(snap?.balanceSats ?? null)
      const timer = setInterval(() => {
        refreshP2wshWatch(walletId, proposal, wallet).catch(() => {})
      }, 15000)
      return () => {
        clearInterval(timer)
      }
    },
    [accountId, proposalId, walletId],
    'useMultisigP2wshBalance'
  )

  return proposal == null ? null : balanceSats
}

/** Full P2WSH watch snapshot (balance, address, txs). */
export const useMultisigP2wshWatch = (
  walletId: string
): P2wshWatchSnapshot | null => {
  const account = useSelector(state => state.core.account)
  const proposals = useMultisigProposals()
  const proposal = React.useMemo(() => {
    const found =
      proposals.find(item => item.walletId === walletId) ??
      getMultisigProposalByWalletId(walletId)
    return found?.status === 'complete' ? found : undefined
  }, [proposals, walletId])

  const [snapshot, setSnapshot] = React.useState(
    () => getCachedP2wshWatch(walletId) ?? null
  )

  React.useEffect(() => {
    return watchP2wsh(event => {
      if (event.walletId !== walletId) return
      setSnapshot(event.snapshot)
    })
  }, [walletId])

  useAsyncEffect(
    async () => {
      if (proposal == null) {
        setSnapshot(null)
        return
      }
      const wallet = account.currencyWallets[walletId]
      const snap = await refreshP2wshWatch(walletId, proposal, wallet)
      setSnapshot(snap)
      const timer = setInterval(() => {
        refreshP2wshWatch(walletId, proposal, wallet).catch(() => {})
      }, 15000)
      return () => {
        clearInterval(timer)
      }
    },
    [account, proposal, walletId],
    'useMultisigP2wshWatch'
  )

  return snapshot
}
