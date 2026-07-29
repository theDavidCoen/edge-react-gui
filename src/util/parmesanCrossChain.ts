/**
 * Parmesan cross-chain address helpers (BTC / Arkade / Rootstock).
 */

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const BTC_SEGWIT_RE =
  /^(bc1|tb1|bcrt1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87}$/i
const BTC_LEGACY_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
const ARK_ADDRESS_RE = /^ark1[a-z0-9]+$/i

export const isEvmAddress = (value: string): boolean =>
  EVM_ADDRESS_RE.test(value.trim())

export const isBtcOnchainAddress = (value: string): boolean => {
  const v = value.trim()
  return BTC_SEGWIT_RE.test(v) || BTC_LEGACY_RE.test(v)
}

export const isArkadeAddress = (value: string): boolean =>
  ARK_ADDRESS_RE.test(value.trim())

/** Bitcoin / Arkade wallets that can send to Rootstock via Boltz. */
export const canWarnEvmAsRootstock = (pluginId: string): boolean =>
  pluginId === 'bitcoin' || pluginId === 'ark' + 'ade'

/** Strip rsk:/rbtc: URI prefix to a bare 0x address when present. */
export const normalizeRskUri = (value: string): string => {
  const trimmed = value.trim()
  const m = /^(?:rsk|rbtc):([^?]+)/i.exec(trimmed)
  if (m != null) return m[1].trim()
  return trimmed
}
