import type { NostrEvent } from './events'
import { DEFAULT_NOSTR_RELAYS } from './relayPool'

/**
 * One-shot relay query used for profiles (kind 0) without touching the
 * long-lived multisig inbox subscription.
 */
export const queryRelays = async (
  filters: Array<Record<string, unknown>>,
  waitMs: number = 3000,
  urls: string[] = DEFAULT_NOSTR_RELAYS
): Promise<NostrEvent[]> => {
  const events = new Map<string, NostrEvent>()
  const sockets: WebSocket[] = []
  const subId = `q-${Date.now().toString(16)}`

  for (const url of urls) {
    try {
      const ws = new WebSocket(url)
      sockets.push(ws)
      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', subId, ...filters]))
      }
      ws.onmessage = message => {
        try {
          const parsed = JSON.parse(String(message.data)) as unknown
          if (!Array.isArray(parsed) || parsed[0] !== 'EVENT') return
          const event = (
            parsed.length === 3 ? parsed[2] : parsed[1]
          ) as NostrEvent
          if (event?.id == null) return
          const existing = events.get(event.id)
          if (
            existing == null ||
            (event.created_at ?? 0) > (existing.created_at ?? 0)
          ) {
            events.set(event.id, event)
          }
        } catch {}
      }
      ws.onerror = () => {}
    } catch {}
  }

  await sleep(waitMs)

  for (const ws of sockets) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['CLOSE', subId]))
      }
      ws.close()
    } catch {}
  }

  return [...events.values()]
}

export const publishToRelays = async (
  event: NostrEvent,
  urls: string[] = DEFAULT_NOSTR_RELAYS
): Promise<void> => {
  const payload = JSON.stringify(['EVENT', event])
  const results = await Promise.all(
    urls.map(async url => {
      try {
        const ws = new WebSocket(url)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('timeout'))
          }, 8000)
          ws.onopen = () => {
            ws.send(payload)
            clearTimeout(timer)
            resolve()
          }
          ws.onerror = () => {
            clearTimeout(timer)
            reject(new Error('ws error'))
          }
        })
        ws.close()
        return true
      } catch {
        return false
      }
    })
  )
  if (!results.some(ok => ok)) {
    throw new Error('Could not publish Nostr event to any relay')
  }
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms))
}
