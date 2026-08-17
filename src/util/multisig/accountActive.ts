import type { EdgeAccount } from 'edge-core-js'

export const isAccountDataStoreActive = (account: EdgeAccount): boolean =>
  account.loggedIn

export const isClosedDataStoreError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('closed proxy')
}
