# Parmesan

Parmesan is a demo build of the Edge wallet that explores **BTC ↔ Arkade ↔ Rootstock (RBTC)** cross-chain UX within the native Edge send flow. The goal is to validate that users can self-transfer between all three wallet types — Bitcoin, Arkade, and RBTC — using familiar UI patterns (Your Wallets / Myself), with fees transparently shown in a single Send screen. Boltz chain swaps power every path under the hood; no exchange plugin, no extra confirmation steps.

---

## Myself — full triangle

`AddressTile2.tsx` extended with `canSelfTransfer` + `allowedAssets`:

| Source wallet | Available Myself destinations |
|---|---|
| Bitcoin | Arkade, Rootstock (RBTC) |
| Arkade | Bitcoin, Rootstock (RBTC) |
| Rootstock (RBTC) | Bitcoin, Arkade |

Address selection per target:
- **Arkade**: `boardingAddress` / `segwitAddress` (never `ark1` as a direct onchain destination)
- **Bitcoin**: `segwitAddress ?? publicAddress`
- **Rootstock**: `publicAddress` (`0x…`)

---

## Scan / parseUri cross-chain

### BTC / Arkade → bare `0x…`

If the user scans or pastes an EVM address from a Bitcoin or Arkade wallet, normal URI parsing fails. `parmesanCrossChain.ts` detects `/^0x[0-9a-fA-F]{40}$/`, shows a warning modal ("EVM address scanned — are you sure this is Rootstock?"), and on confirmation builds a synthetic `parsedUri` targeting the RSK wallet.

Locale strings added: `scan_evm_address_warning_title`, `scan_evm_address_warning_body`.

### RSK → BTC / Arkade

`EthereumTools.ts` (gated on `pluginId === 'rsk'`): `parseUri` accepts Bitcoin onchain addresses (`bc1…`, `1…`, `3…`) and returns them as `publicAddress` with metadata `boltz_rbtc_btc`, consumed by `makeSpend`.

---

## Spend + fees via Boltz

All cross-chain paths use **Boltz API v2 chain swaps** (`https://api.boltz.exchange/v2/swap/chain`). The `networkFee` shown in the Edge Send screen equals Boltz percentage fee + miner fees (server + user lockup/claim) + estimated network fee.

### Path table

| From → To | Mechanism | Engine file |
|-----------|-----------|-------------|
| Bitcoin → RBTC (`0x`) | Chain swap BTC→RBTC; `signTx` creates swap + signs lock to Boltz lockup address | `UtxoEngine.ts` |
| RBTC → Bitcoin (`bc1`/`1`/`3`) | `makeSpend` quotes; `signTx` creates RBTC→BTC swap, generates ephemeral keys, calls `EtherSwap.lock(preimageHash, boltzClaimAddress, timelock)` via ABI calldata; broadcasts EVM tx | `EthereumEngine.ts` |
| Arkade → Bitcoin | Existing (`arkToBtc` / settle via `@arkade-os/boltz-swap`) | `ArkadeEngine.ts` |
| Bitcoin → Arkade | Existing (boarding deposit) | `ArkadeEngine.ts` |
| Arkade → RBTC (`0x`) | Composed: create BTC→RBTC chain swap (claimAddress = user `0x`) → `arkToBtc` to Boltz BTC lockup; fee = sum of arkToBtc + BTC→RBTC | `ArkadeEngine.ts` |
| RBTC → Arkade | RBTC→BTC with claim = Arkade boarding address | `EthereumEngine.ts` |

### Units

- Edge Bitcoin / Arkade: **satoshi**
- Edge RBTC: **wei** (1 RBTC = 1e18 wei; 1 sat = 1e10 wei)
- Boltz API: always **satoshi** on both sides

Conversion wei↔sats is handled in `EthereumEngine.ts` (`WEI_PER_SAT = 1e10`).

### Pending swap persistence (disklet)

Each pending swap is written to `walletLocalDisklet` as `parmesan-boltz-<id>.json`:

```json
{
  "id": "...",
  "direction": "rbtc_btc",
  "to": "bc1...",
  "preimage": "hex",
  "preimageHash": "hex",
  "claimPriv": "hex",
  "claimPub": "hex",
  "lockTxid": "0x...",
  "status": "locked_awaiting_btc_claim"
}
```

Cooperative BTC claim after server lockup is still manual (keys available on disklet).

### Boltz modules

| File | Location |
|------|----------|
| Quote / create chain swap | `edge-currency-plugins-master/src/common/boltz/boltzChainSwap.ts` |
| Quote / create chain swap (copy) | `edge-currency-accountbased/src/common/boltzChainSwap.ts` |
| `encodeEtherSwapLockCalldata` | `boltzChainSwap.ts` (selector `0x0899146b`) |
| EtherSwap contract (RSK) | `0xe761e1354097757c019855637746e7dd1bef1654` (v5/v6, chainId 30) — via `GET /v2/chain/RBTC/contracts` |

---

## Changed files

### `edge-react-gui`

| File | Change |
|------|--------|
| `android/app/build.gradle` | `applicationId`, `versionCode`, Firebase skip |
| `android/app/src/main/res/values/strings.xml` | `app_name` → **Edge Parmesan** |
| `src/components/tiles/AddressTile2.tsx` | `canSelfTransfer` + `allowedAssets` triangle |
| `src/util/parmesanCrossChain.ts` | `isEvmAddress` helper, EVM warning modal |
| `src/locales/en_US.ts` + `enUS.json` | `scan_evm_address_warning_*` strings |

### `edge-currency-plugins-master`

| File | Change |
|------|--------|
| `src/common/boltz/boltzChainSwap.ts` | Chain swap BTC↔RBTC quote / create module |
| `src/common/boltz/boltzSwapMonitor.ts` | Silent background poller for pending swaps (temporary) |
| `src/common/utxobased/engine/UtxoEngine.ts` | `makeSpend` / `signTx` BTC→RBTC via Boltz; swap monitor start/stop |
| `src/common/arkade/arkadeTools.ts` | `parseUri` accepts `0x` from Arkade |
| `src/common/arkade/ArkadeEngine.ts` | `makeSpend` Arkade→RBTC (composed path), `broadcastTx` |

### `edge-currency-accountbased`

| File | Change |
|------|--------|
| `src/common/boltzChainSwap.ts` | Helper copy + `encodeEtherSwapLockCalldata`, `fetchRskEtherSwapAddress` |
| `src/common/boltzSwapMonitor.ts` | Silent background poller for pending swaps (temporary) |
| `src/ethereum/EthereumTools.ts` | `parseUri` RSK accepts BTC addresses |
| `src/ethereum/EthereumEngine.ts` | `makeSpend` RBTC→BTC (wei↔sats quote), `signTx` EtherSwap.lock, `broadcastTx` disklet persistence; swap monitor start/stop |

---

## Known limitations

### Swap monitoring (temporary solution)

Both engines (`UtxoEngine` for BTC→RBTC, `EthereumEngine` for RBTC→BTC) run a **silent background poller** (`boltzSwapMonitor.ts`) that checks Boltz swap status every 60 seconds after engine start.

- If Boltz completes the swap, the disklet record is updated to `completed` and a log line is emitted.
- If the swap expires (`swap.expired`), the disklet record is updated to `refund_needed` and a `warn` log is emitted with instructions.

**This is a temporary, developer-facing solution.** There is no in-app UI for:
- Surfacing pending or failed swaps to the user
- Initiating a refund transaction from within the wallet
- Showing a swap history screen

A proper implementation would include a dedicated swap status screen (or inline wallet banner) that reads the disklet records and lets the user trigger a refund with one tap. Until then, a user whose swap expires must use the [Boltz web app](https://boltz.exchange) and the wallet's `refundPublicKey` (derived at `m/<format>/0/0`) to manually broadcast a refund.

### BTC claim after RBTC→BTC

The EVM lock is broadcast successfully. The cooperative BTC claim is handled by Boltz automatically in the normal flow; the `claimPriv`/`claimPub` keys saved in the disklet are a fallback for manual recovery only.

### RBTC→BTC settlement timing

The BTC side unlocks only after the claim preimage is revealed on-chain or via the cooperative Boltz API.
