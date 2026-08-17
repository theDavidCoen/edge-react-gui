import type { NostrEvent } from './events'

export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net'
]

type RelayHandler = (event: NostrEvent) => void

interface RelaySocket {
  url: string
  ws: WebSocket | null
  ready: boolean
}

const PUBLISH_TIMEOUT_MS = 12000
const RECONNECT_MS = 8000

/**
 * Minimal Nostr relay pool for NIP-17 gift wraps (kind 1059).
 */
export class NostrRelayPool {
  private readonly relays: RelaySocket[]
  private eventSeenChecker: ((eventId: string) => boolean) | null = null
  private subId: string | null = null
  private filterPubkey: string | null = null
  private onEvent: RelayHandler | null = null
  private closed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private eoseWaiters: Array<() => void> = []
  private eoseCount = 0

  private reconnectDelayMs = 1000

  constructor(urls: string[] = DEFAULT_NOSTR_RELAYS) {
    this.relays = urls.map(url => ({ url, ws: null, ready: false }))
  }

  subscribe(pubkeyHex: string, onEvent: RelayHandler): void {
    this.filterPubkey = pubkeyHex
    this.onEvent = onEvent
    this.subId = `msig-${pubkeyHex.slice(0, 8)}`
    this.connectAll()
  }

  setEventDedupChecker(isSeen: (eventId: string) => boolean): void {
    this.eventSeenChecker = isSeen
  }

  stop(): void {
    this.closed = true
    if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer)
    for (const relay of this.relays) {
      relay.ws?.close()
      relay.ws = null
      relay.ready = false
    }
  }

  async publish(event: NostrEvent): Promise<void> {
    this.connectAll()
    const payload = JSON.stringify(['EVENT', event])
    // Return as soon as one relay accepts the EVENT. Waiting on allSettled
    // blocked Join for up to PUBLISH_TIMEOUT_MS on a single dead socket.
    const ok = await firstFulfilledTrue(
      this.relays.map(async relay => await this.sendToRelay(relay, payload))
    )
    if (!ok) {
      throw new Error('Could not publish Nostr event to any relay')
    }
  }

  /**
   * Re-query relays for gift wraps addressed to the current subscription pubkey.
   * Reuses the live onEvent handler so callers must not subscribe() again.
   */
  async pollInbox(waitMs: number = 2000): Promise<void> {
    if (this.filterPubkey == null || this.onEvent == null) return
    const started = Date.now()
    this.connectAll()
    await this.waitForAnyRelay(waitMs)
    const remaining = Math.max(250, waitMs - (Date.now() - started))
    // Fresh sub id so relays re-deliver matching stored events.
    this.subId = `msig-poll-${Date.now().toString(16)}`
    this.eoseCount = 0
    const eose = new Promise<void>(resolve => {
      this.eoseWaiters.push(resolve)
    })
    for (const relay of this.relays) {
      this.sendReq(relay)
    }
    await Promise.race([eose, sleep(remaining)])
    this.eoseWaiters = []
    // Restore steady-state subscription id for ongoing listen.
    this.subId = `msig-${this.filterPubkey.slice(0, 8)}`
    for (const relay of this.relays) {
      this.sendReq(relay)
    }
  }

  private async waitForAnyRelay(timeoutMs: number): Promise<void> {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (this.closed) return
      if (this.relays.some(relay => relay.ready)) return
      this.connectAll()
      await sleep(100)
    }
  }

  private isEventDuplicate(eventId: string): boolean {
    return this.eventSeenChecker?.(eventId) ?? false
  }

  private connectAll(): void {
    if (this.closed) return
    for (const relay of this.relays) {
      if (relay.ws != null && relay.ws.readyState <= WebSocket.OPEN) continue
      this.openRelay(relay)
    }
  }

  private openRelay(relay: RelaySocket): void {
    try {
      const ws = new WebSocket(relay.url)
      relay.ws = ws
      ws.onopen = () => {
        relay.ready = true
        this.reconnectDelayMs = 1000
        this.sendReq(relay)
      }
      ws.onmessage = message => {
        this.handleMessage(String(message.data))
      }
      ws.onerror = () => {}
      ws.onclose = () => {
        relay.ready = false
        relay.ws = null
        this.scheduleReconnect()
      }
    } catch {
      this.scheduleReconnect()
    }
  }

  private sendReq(relay: RelaySocket): void {
    if (
      relay.ws == null ||
      relay.ws.readyState !== WebSocket.OPEN ||
      this.subId == null ||
      this.filterPubkey == null
    ) {
      return
    }
    const req = JSON.stringify([
      'REQ',
      this.subId,
      { kinds: [1059], '#p': [this.filterPubkey] }
    ])
    relay.ws.send(req)
  }

  private async sendToRelay(
    relay: RelaySocket,
    payload: string
  ): Promise<boolean> {
    const started = Date.now()
    while (Date.now() - started < PUBLISH_TIMEOUT_MS) {
      if (relay.ws != null && relay.ws.readyState === WebSocket.OPEN) {
        relay.ws.send(payload)
        return true
      }
      await sleep(250)
    }
    return false
  }

  private handleMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed) || parsed.length < 1) return
      if (parsed[0] === 'EOSE') {
        this.eoseCount += 1
        if (this.eoseCount >= 1) {
          const waiters = this.eoseWaiters
          this.eoseWaiters = []
          for (const waiter of waiters) waiter()
        }
        return
      }
      if (parsed[0] !== 'EVENT') return
      const event = (parsed.length === 3 ? parsed[2] : parsed[1]) as NostrEvent
      if (event?.id == null || this.isEventDuplicate(event.id)) return
      this.onEvent?.(event)
    } catch {}
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer != null) return
    const delay = this.reconnectDelayMs
    this.reconnectDelayMs = Math.min(RECONNECT_MS, this.reconnectDelayMs * 2)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connectAll()
    }, delay)
  }
}

const firstFulfilledTrue = async (
  promises: Array<Promise<boolean>>
): Promise<boolean> =>
  await new Promise(resolve => {
    let remaining = promises.length
    if (remaining === 0) {
      resolve(false)
      return
    }
    for (const promise of promises) {
      promise
        .then(value => {
          if (value) {
            resolve(true)
            return
          }
          remaining -= 1
          if (remaining === 0) resolve(false)
        })
        .catch(() => {
          remaining -= 1
          if (remaining === 0) resolve(false)
        })
    }
  })

const sleep = async (ms: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms))
}
