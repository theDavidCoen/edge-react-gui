import type { EdgeAccount } from 'edge-core-js'
import * as React from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useHandler } from '../../hooks/useHandler'
import {
  resetEdgeContactsStore,
  syncAndReloadEdgeContacts
} from '../../util/contacts/store'

interface Props {
  account: EdgeAccount
}

/**
 * Keeps the private Edge contacts cache in sync with the encrypted account
 * repo — load on login, refresh after account sync / foreground, clear on logout.
 */
export const EdgeContactsService: React.FC<Props> = props => {
  const { account } = props

  useAsyncEffect(
    async () => {
      await syncAndReloadEdgeContacts(account)
      return () => {
        resetEdgeContactsStore()
      }
    },
    [account],
    'EdgeContactsService:load'
  )

  React.useEffect(() => {
    return account.watch('loggedIn', () => {
      if (!account.loggedIn) resetEdgeContactsStore()
    })
  }, [account])

  const handleReload = useHandler(async () => {
    await syncAndReloadEdgeContacts(account)
  })

  // Account repo sync updates wallet state; use that as a contacts refresh cue.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = account.watch('currencyWallets', () => {
      if (timer != null) clearTimeout(timer)
      timer = setTimeout(() => {
        handleReload().catch(() => {})
      }, 500)
    })
    return () => {
      cleanup()
      if (timer != null) clearTimeout(timer)
    }
  }, [account, handleReload])

  React.useEffect(() => {
    let previous: AppStateStatus = AppState.currentState
    const subscription = AppState.addEventListener('change', next => {
      if (/inactive|background/.exec(previous) != null && next === 'active') {
        handleReload().catch(() => {})
      }
      previous = next
    })
    return () => {
      subscription.remove()
    }
  }, [handleReload])

  return null
}
