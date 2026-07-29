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

### Pending swap persistence (`wallet.localDisklet`)

Each pending swap is written to the engine **`walletLocalDisklet`** (= Edge `wallet.localDisklet`, **not** the synced `wallet.disklet`) as `parmesan-boltz-<id>.json`:

```json
{
  "id": "...",
  "direction": "btc_rbtc",
  "preimage": "hex",
  "preimageHash": "hex",
  "claimAddress": "0x...",
  "amount": "31085",
  "status": "locked_awaiting_claim",
  "serverLockTxid": "0x...",
  "claimAmountWei": "...",
  "refundAddress": "0x...",
  "timelock": 9107493
}
```

Statuses include: `locked_awaiting_claim` / `locked_awaiting_btc_claim` → `rbtc_claim_ready` → `completed` / `refund_needed`.

### BTC→RBTC lifecycle (important)

Boltz does **not** auto-deliver RBTC. After the user locks BTC:

1. `transaction.mempool` / `transaction.confirmed` — user lock seen  
2. `transaction.server.mempool` / `transaction.server.confirmed` — Boltz locked RBTC in `EtherSwap`  
3. **Client must** call `EtherSwap.claim(preimage, amount, refundAddress, timelock)` from the RSK claim address  
4. `transaction.claim.pending` / `transaction.claimed` — Boltz claims the BTC lock using the revealed preimage  

`refundPublicKey` for BTC→RBTC is the sending wallet HD pubkey at `m/<format>/0/0` (not an ephemeral key), so a timeout refund remains under user control.

### Boltz modules

| File | Location |
|------|----------|
| Quote / create / claim calldata | `edge-currency-plugins/src/common/boltz/boltzChainSwap.ts` |
| Same helpers (accountbased copy) | `edge-currency-accountbased/src/common/boltzChainSwap.ts` |
| Swap status poller | `boltzSwapMonitor.ts` |
| `encodeEtherSwapLockCalldata` | selector `0x0899146b` |
| `encodeEtherSwapClaimCalldata` | selector `0xc3c37fbc` |
| EtherSwap (RSK) | `0xe761e1354097757c019855637746e7dd1bef1654` — via `GET /v2/chain/RBTC/contracts` |

---

## Changed files

### `edge-react-gui`

| File | Change |
|------|--------|
| `android/app/build.gradle` | `applicationId` `app.edge.parmesan`, `versionCode`, Firebase skip |
| `android/app/src/main/res/values/strings.xml` | `app_name` → **Edge Parmesan** |
| `src/components/tiles/AddressTile2.tsx` | `canSelfTransfer` + `allowedAssets` triangle |
| `src/util/parmesanCrossChain.ts` | `isEvmAddress` helper, EVM warning modal |
| `src/util/parmesanBoltzClaim.ts` | Claim helpers; reads/writes **`wallet.localDisklet`** |
| `src/components/services/ParmesanBoltzClaimService.tsx` | Auto `EtherSwap.claim` after `transaction.server.confirmed` |
| `src/components/services/Services.tsx` | Mounts claim service |
| `src/components/scenes/TransactionDetailsScene.tsx` | Copyable **Boltz Swap ID** row |
| `src/locales/en_US.ts` + `enUS.json` | `scan_evm_address_warning_*` strings |

### `edge-currency-plugins`

| File | Change |
|------|--------|
| `src/common/boltz/boltzChainSwap.ts` | Chain swap quote/create + claim calldata helpers |
| `src/common/boltz/boltzSwapMonitor.ts` | Poller; sets `rbtc_claim_ready` on server lock |
| `src/common/utxobased/engine/UtxoEngine.ts` | BTC→RBTC spend/sign/broadcast; wallet HD `refundPublicKey`; metadata notes with swap ID |
| `src/common/arkade/arkadeTools.ts` | `parseUri` accepts `0x` from Arkade |
| `src/common/arkade/ArkadeEngine.ts` | Arkade→RBTC composed path |

### `edge-currency-accountbased`

| File | Change |
|------|--------|
| `src/common/boltzChainSwap.ts` | Helpers + `encodeEtherSwapLock/ClaimCalldata`, `fetchRskEtherSwapAddress` |
| `src/common/boltzSwapMonitor.ts` | Poller for RBTC→BTC pending swaps |
| `src/ethereum/EthereumTools.ts` | `parseUri` RSK accepts BTC addresses |
| `src/ethereum/EthereumEngine.ts` | RBTC→BTC quote/lock/broadcast; disklet; swap ID in notes |
| `src/ethereum/info/rskInfo.ts` | Blockscout → `https://rootstock.blockscout.com` (avoids sync stuck ~50%) |

---

## Known limitations

### Swap monitoring & RBTC claim (temporary)

Engines poll Boltz every ~60s; the GUI claim service every ~20s. For **BTC→RBTC**, when status is `transaction.server.confirmed`, `ParmesanBoltzClaimService` broadcasts `EtherSwap.claim` from the RSK wallet using the preimage on **`localDisklet`**.

This is a temporary cross-wallet orchestrator — not a proper swap history / refund UI. The RSK claim address needs a small RBTC balance for gas (Boltz does not prepay miner fee on this path).

Refunds after expiry still need the [Boltz web app](https://boltz.exchange) (or a future in-app flow) with the wallet `refundPublicKey` at `m/<format>/0/0`.

### RSK history sync

If the RSK wallet UI stays at ~50% sync, on-chain balance/txs may still be correct (check Blockscout) while Edge history lags. Prefer **Resync Blockchain**; explorer base URL must be `rootstock.blockscout.com`.

### RBTC→BTC

EVM lock is automated; Boltz normally claims BTC. `claimPriv`/`claimPub` on disklet are a manual-recovery fallback only.
