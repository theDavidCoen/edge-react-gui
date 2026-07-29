# Parmesan (`app.edge.parmesan`)

Demo build branched from Grana with **BTC ↔ Arkade ↔ Rootstock (RBTC)** Myself pairings and Boltz chain swaps.

## Identità

| | |
|--|--|
| App name | **Edge Parmesan** |
| applicationId | `app.edge.parmesan` |
| versionCode | `26072801` |
| versionName | `4.50.0` |
| Branch GUI | `parmesan-4.50.0-26072801` (da `grana-4.50.0-26072701`) |
| Branch plugins | `edge-currency-plugins-master` → `feature/parmesan-rbtc-boltz` |
| Branch accountbased | `edge-currency-accountbased` → `feature/parmesan-rbtc-boltz` |

Installa side-by-side con Grana (`app.edge.grana`): i due `applicationId` sono distinti.

---

## Come ricompilare

```bash
# 1. Rebuild accountbased (se modificato)
cd ~/Documenti/Edge/edge-currency-accountbased
git checkout feature/parmesan-rbtc-boltz
yarn webpack

# 2. Rebuild plugins (se modificato)
cd ~/Documenti/Edge/edge-currency-plugins-master
git checkout feature/parmesan-rbtc-boltz
yarn webpack

# 3. Sincronizza asset nella GUI
GUI=~/Documenti/Edge/edge-react-gui
AB=~/Documenti/Edge/edge-currency-accountbased
PLUGIN=~/Documenti/Edge/edge-currency-plugins-master

cp "$AB/android/src/main/assets/edge-currency-accountbased/edge-currency-accountbased.js" \
   "$GUI/android/app/src/main/assets/edge-currency-accountbased/edge-currency-accountbased.js"
cp "$AB/android/src/main/assets/edge-currency-accountbased/edge-currency-accountbased.js" \
   "$GUI/node_modules/edge-currency-accountbased/android/src/main/assets/edge-currency-accountbased/edge-currency-accountbased.js"
rsync -a "$AB/lib/" "$GUI/node_modules/edge-currency-accountbased/lib/"

cp "$PLUGIN/android/src/main/assets/edge-currency-plugins/edge-currency-plugins.js" \
   "$GUI/android/app/src/main/assets/edge-currency-plugins/edge-currency-plugins.js"

# 4. Assemble release APK
cd "$GUI/android"
JAVA_HOME=/usr/lib/jvm/java-17-openjdk \
  ./gradlew :app:assembleRelease --no-daemon

# 5. Installa sul device (Xiaomi: abilita Developer options → Install via USB)
adb install -r "$GUI/android/app/build/outputs/apk/release/app-release.apk"
```

Output APK: `edge-react-gui/android/app/build/outputs/apk/release/app-release.apk`  
Copia flat: `~/Documenti/Edge/parmesan-4.50.0-26072801.apk`

> **Xiaomi/HyperOS:** Developer options → **Install via USB** deve essere attivo (confermare il prompt MIUI) prima di `adb install`.

---

## Myself — triangolo completo

`AddressTile2.tsx` esteso con `canSelfTransfer` + `allowedAssets`:

| Wallet sorgente | Destinazioni Myself disponibili |
|---|---|
| Bitcoin | Arkade, Rootstock (RBTC) |
| Arkade | Bitcoin, Rootstock (RBTC) |
| Rootstock (RBTC) | Bitcoin, Arkade |

Selezione indirizzo:
- Target **Arkade**: `boardingAddress` / `segwitAddress` (mai `ark1` onchain come destinazione diretta)
- Target **Bitcoin**: `segwitAddress ?? publicAddress`
- Target **Rootstock**: `publicAddress` (`0x…`)

---

## Scan / parseUri cross-chain

### BTC / Arkade → bare `0x…`

Se l'utente scansiona o incolla un indirizzo EVM da un wallet Bitcoin o Arkade, il parse normale fallisce.  
`parmesanCrossChain.ts` intercetta `/^0x[0-9a-fA-F]{40}$/`, mostra un warning modale ("Indirizzo EVM scansionato — sei su Rootstock?") e su conferma costruisce un `parsedUri` sintetico verso il wallet RSK.

Stringhe localizzate aggiunte: `scan_evm_address_warning_title`, `scan_evm_address_warning_body`.

### RSK → BTC / Arkade

`EthereumTools.ts` (gated su `pluginId === 'rsk'`): `parseUri` accetta indirizzi Bitcoin onchain (`bc1…`, `1…`, `3…`) e li restituisce come `publicAddress` con metadata `boltz_rbtc_btc`, per poi essere consumati da `makeSpend`.

---

## Spend + fee via Boltz

Tutte le path Boltz usano **Boltz API v2 chain swaps** (`https://api.boltz.exchange/v2/swap/chain`).  
`networkFee` in Send = fee Boltz (percentage + miner server/user) + network fee stimata.

### Tabella path

| Da → A | Meccanismo | File engine |
|--------|------------|-------------|
| Bitcoin → RBTC (`0x`) | Chain swap BTC→RBTC; `signTx` crea swap + firma lock verso lockup address | `UtxoEngine.ts` |
| RBTC → Bitcoin (`bc1`/`1`/`3`) | `makeSpend` quota; `signTx` crea swap RBTC→BTC, genera chiavi ephemeral, chiama `EtherSwap.lock(preimageHash, boltzClaimAddress, timelock)` via calldata ABI; broadcast EVM tx | `EthereumEngine.ts` |
| Arkade → Bitcoin | Esistente (`arkToBtc` / settle via `@arkade-os/boltz-swap`) | `ArkadeEngine.ts` |
| Bitcoin → Arkade | Esistente (boarding deposit) | `ArkadeEngine.ts` |
| Arkade → RBTC (`0x`) | Composizione: crea chain swap BTC→RBTC (claimAddress = `0x` utente) → `arkToBtc` verso lockup BTC Boltz; fee = somma arkToBtc + BTC→RBTC | `ArkadeEngine.ts` |
| RBTC → Arkade | RBTC→BTC con claim = boarding address Arkade | `EthereumEngine.ts` |

### Unità

- Edge Bitcoin/Arkade: **satoshi**
- Edge RBTC: **wei** (1 RBTC = 1e18 wei; 1 sat = 1e10 wei)
- Boltz API: sempre **satoshi** per entrambi i lati

La conversione wei↔sats è gestita in `EthereumEngine.ts` (`WEI_PER_SAT = 1e10`).

### Persistenza swap (disklet)

Ogni swap pendente viene scritto su `walletLocalDisklet` come `parmesan-boltz-<id>.json` con:

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

Il claim BTC cooperativo dopo il lockup del server è ancora manuale (chiavi sul disklet).

### Moduli Boltz

| File | Posizione |
|------|-----------|
| Quote/create chain swap | `edge-currency-plugins-master/src/common/boltz/boltzChainSwap.ts` |
| Quote/create chain swap (copia) | `edge-currency-accountbased/src/common/boltzChainSwap.ts` |
| `encodeEtherSwapLockCalldata` | `boltzChainSwap.ts` (selector `0x0899146b`) |
| Contratto EtherSwap RSK | `0xe761e1354097757c019855637746e7dd1bef1654` (v5/v6, chainId 30) — via `GET /v2/chain/RBTC/contracts` |

---

## File toccati (rispetto a Grana)

### `edge-react-gui` (`parmesan-4.50.0-26072801`)

| File | Modifica |
|------|----------|
| `android/app/build.gradle` | `applicationId`, `versionCode`, skip Firebase per `app.edge.parmesan` |
| `android/app/src/main/res/values/strings.xml` | `app_name` → **Edge Parmesan** |
| `src/components/tiles/AddressTile2.tsx` | `canSelfTransfer` + `allowedAssets` triangolo |
| `src/util/parmesanCrossChain.ts` | Helper `isEvmAddress`, warning modale EVM |
| `src/locales/en_US.ts` + `enUS.json` | Stringhe `scan_evm_address_warning_*` |

### `edge-currency-plugins-master` (`feature/parmesan-rbtc-boltz`)

| File | Modifica |
|------|----------|
| `src/common/boltz/boltzChainSwap.ts` | Modulo chain swap BTC↔RBTC quote/create |
| `src/common/utxobased/engine/UtxoEngine.ts` | `makeSpend`/`signTx` BTC→RBTC via Boltz |
| `src/common/arkade/arkadeTools.ts` | `parseUri` accetta `0x` da Arkade |
| `src/common/arkade/ArkadeEngine.ts` | `makeSpend` Arkade→RBTC (composizione), `broadcastTx` |

### `edge-currency-accountbased` (`feature/parmesan-rbtc-boltz`)

| File | Modifica |
|------|----------|
| `src/common/boltzChainSwap.ts` | Copia helper + `encodeEtherSwapLockCalldata`, `fetchRskEtherSwapAddress` |
| `src/ethereum/EthereumTools.ts` | `parseUri` RSK accetta indirizzi BTC |
| `src/ethereum/EthereumEngine.ts` | `makeSpend` RBTC→BTC (quota wei↔sats), `signTx` EtherSwap.lock, `broadcastTx` persistenza disklet |

---

## Limitazioni note (Parmesan demo)

- **BTC claim dopo RBTC→BTC**: il lock EVM viene broadcasted, ma il claim BTC cooperativo richiede un helper separato che legga `parmesan-boltz-*.json` dal disklet e firmi la transazione BTC di claim. Non ancora automatizzato nell'app.
- **RBTC→BTC broadcast**: EtherSwap.lock funziona; il BTC lato Boltz viene sbloccato solo dopo che il claim viene rivelato onchain (o cooperativo via API Boltz).
- **Grana intatto**: nessun commit su `grana-*` o `feature/arkade-integration`.
