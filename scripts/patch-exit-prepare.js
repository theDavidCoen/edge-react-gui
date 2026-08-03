#!/usr/bin/env node
/* eslint-disable no-template-curly-in-string -- matches minified bundle snippets */
'use strict'

/**
 * Surgical patches for Grana's prebuilt edge-currency-plugins.js asset:
 * 1) Bypass SDK uneconomic skip/throw so Save JSON works when fees > VTXO.
 * 2) Replace prepareUnilateralExitPackage with wrap+prefetch+per-id indexer
 *    recovery + feeRate fallback + diagnostics.
 */
const fs = require('fs')
const { execSync } = require('child_process')

const assetPath =
  '/home/david/Documenti/Edge/edge-react-gui/android/app/src/main/assets/edge-currency-plugins/edge-currency-plugins.js'

let s = fs.readFileSync(assetPath, 'utf8')

// --- 1) Uneconomic: include sweeps even when value <= sweep fee + dust ---
const uneconomicSkip =
  'if(Pt.value-sr<sx){Ae.push({outpoint:$t,value:Pt.value,skipped:`uneconomic: value ${Pt.value} <= sweep fee + dust`});continue}'
const uneconomicSkipFixed =
  'if(false&&Pt.value-sr<sx){Ae.push({outpoint:$t,value:Pt.value,skipped:`uneconomic: value ${Pt.value} <= sweep fee + dust`});continue}'
if (s.includes(uneconomicSkipFixed)) {
  console.log('uneconomic_skip already patched')
} else if (s.includes(uneconomicSkip)) {
  s = s.replace(uneconomicSkip, uneconomicSkipFixed)
  console.log('uneconomic_skip patched')
} else {
  console.error('uneconomic skip marker not found')
  process.exit(1)
}

const uneconomicThrow =
  'if($<BigInt(au))throw new Error(`uneconomic vtxo ${e.txid}:${e.vout}: value ${e.value} - fee ${R} < dust`)'
const uneconomicThrowFixed =
  'if($<BigInt(au)){$=e.value>au?BigInt(au):BigInt(Math.max(0,e.value));R=Number(BigInt(e.value)-$)}'
if (s.includes(uneconomicThrowFixed)) {
  console.log('uneconomic_throw already patched')
} else if (s.includes(uneconomicThrow)) {
  s = s.replace(uneconomicThrow, uneconomicThrowFixed)
  console.log('uneconomic_throw patched')
} else {
  console.error('uneconomic throw marker not found')
  process.exit(1)
}

// --- 2) Replace prepareUnilateralExitPackage ---
const startMarker = 'async prepareUnilateralExitPackage(e){'
const start = s.indexOf(startMarker)
if (start < 0) {
  console.error('start marker not found')
  process.exit(1)
}

const afterStart = start + startMarker.length
const endMarkers = [
  'async getUnrollFeeAddress(){',
  'async runUnilateralExitToAddress(e){'
]
let end = -1
let endMarker = ''
for (const m of endMarkers) {
  const i = s.indexOf(m, afterStart)
  if (i >= 0 && (end < 0 || i < end)) {
    end = i
    endMarker = m
  }
}
if (end < 0) {
  console.error('end marker not found')
  process.exit(1)
}

console.log('OLD_LEN', end - start)
console.log('OLD_HEAD', s.slice(start, start + 180))
console.log('END_MARKER', endMarker)

// Symbols kept readable in this asset: WR=UnilateralExit, du=OnchainWallet,
// wrapIndexerWithUnrollCacheImpl, this.unrollCache, this.prefetchUnrollArtifacts,
// n._signerRouter (HD InputSignerRouter).
const newMethod = `async prepareUnilateralExitPackage(e){const n=await this.waitForWalletReady(8e3).catch(()=>this.wallet);if(n==null)throw new Error("Engine not started");const a=await du.create(n.identity,n.networkName,n.onchainProvider);const h=n.networkName!=null?n.networkName:n.network&&n.network.bech32==="bc"?"bitcoin":n.network&&n.network.bech32==="bcrt"?"regtest":"testnet";const rawIndexer=n.indexerProvider;const cacheWrapped=wrapIndexerWithUnrollCacheImpl(rawIndexer,this.unrollCache);n.indexerProvider=new Proxy(cacheWrapped,{get(t,p,r){if(p==="getVirtualTxs")return async(txids,opts)=>{const ids=Array.isArray(txids)?txids:[],txs=[];for(const id of ids){try{let one=await cacheWrapped.getVirtualTxs([id],opts),tx=one&&one.txs&&one.txs[0];if(!(typeof tx=="string"&&tx.length>0)){one=await rawIndexer.getVirtualTxs([id],opts);tx=one&&one.txs&&one.txs[0]}if(typeof tx=="string"&&tx.length>0)txs.push(tx)}catch{}}return{txs,page:null}};const v=Reflect.get(t,p,r);return typeof v=="function"?v.bind(t):v}});const identity=n.identity,originalSign=identity.sign.bind(identity),signerRouter=n._signerRouter;if(signerRouter!=null&&typeof signerRouter.sign=="function"){identity.sign=async(tx,inputIndexes)=>{if(inputIndexes!=null)return await originalSign(tx,inputIndexes);const jobs=[];for(let i=0;i<Number(tx.inputsLength||0);i++){const inp=tx.getInput(i),script=inp&&inp.witnessUtxo&&inp.witnessUtxo.script;if(script!=null)jobs.push({index:i,lookupScript:script})}return jobs.length===0?await originalSign(tx):await signerRouter.sign(tx,jobs)}}const b={wallet:n,onchainWallet:a,sweepAddress:e,mode:"graph",networkName:h};const isUneconomic=R=>R!=null&&/uneconomic/i.test(R);const summarizeSkipped=R=>{const $=[...new Set(R.map(Q=>Q.skipped).filter(Q=>Q!=null&&Q!==""))];return $.length===0?"All VTXOs were skipped (no unilateral exit path available).":"All VTXOs were skipped: "+$.join("; ")};const summarizeActive=R=>R.filter(Q=>Q.skipped==null||Q.skipped==="").map(Q=>{const re=Q.outpoint!=null?Q.outpoint:"?",ae=Q.value!=null?Q.value:"?",ge=Q.path!=null?Q.path:"?",Ae=Q.sweepFee!=null?Q.sweepFee:"?";return re+" value="+ae+" path="+ge+" sweepFee="+Ae}).join("; ");let estimateInfos=[],estimateFeeRate;try{this.unrollPrefetchAt=0;try{await this.prefetchUnrollArtifacts(n)}catch(R){console.warn("[arkade] exit-package prefetch failed",R)}const R=await WR.estimate(b);estimateInfos=Array.isArray(R.vtxos)?R.vtxos:[];estimateFeeRate=typeof R.feeRate=="number"?R.feeRate:void 0;if(estimateInfos.length===0)throw new Error("No funds available to exit");const allSkipped=estimateInfos.every(Q=>Q.skipped!=null&&Q.skipped!==""),onlyUneconomic=allSkipped&&estimateInfos.every(Q=>isUneconomic(Q.skipped));if(allSkipped&&!onlyUneconomic)throw new Error(summarizeSkipped(estimateInfos));const feeRates=[];if(estimateFeeRate!=null)feeRates.push(Math.ceil(estimateFeeRate));if(!feeRates.includes(1))feeRates.push(1);let pkg,lastErr;for(const feeRate of feeRates){try{pkg=await WR.prepare(Object.assign({},b,{feeRate}));lastErr=void 0;break}catch(Q){lastErr=Q;const re=Q instanceof Error?Q.message:String(Q);if(/uneconomic|no exitable vtxos \\(all skipped\\)/i.test(re)&&feeRate>1)continue;throw Q}}if(pkg==null)throw lastErr instanceof Error?lastErr:new Error(String(lastErr!=null?lastErr:"prepare failed"));const $=JSON.stringify(pkg),Q=new Date().toISOString().replace(/[:.]/g,"-");return{json:$,filename:\`edge-arkade-exit-\${Q}.json\`,executorUrl:"https://thedavidcoen.github.io/arkade-unilateral-exit/",mode:"graph",sweepAddress:e}}catch(R){const $=R instanceof Error?R.message:String(R);if($.includes(UNROLL_CACHE_MISS_MSG))throw R;if(/^All VTXOs were skipped|^No funds available/i.test($))throw R;if(/no exitable vtxos \\(all skipped\\)/i.test($)){const re=summarizeActive(estimateInfos),ae=[...new Set(estimateInfos.map(ge=>ge.skipped).filter(ge=>ge!=null&&ge!==""))],ge=["All VTXOs were skipped while building the exit package (sign/sweep failed after estimate)."];if(re!=="")ge.push("Estimated OK then failed: "+re+".");if(ae.length>0)ge.push("Already skipped at estimate: "+ae.join("; ")+".");if(estimateFeeRate!=null)ge.push("feeRate="+estimateFeeRate+" sat/vB.");ge.push("Typical causes: HD signing failed for rotated receive keys, exit path requires additional signers, or finalize failed.");throw new Error(ge.join(" "))}if(/not found|indexer|fetch|ECONN|timeout|Unroll data not cached|no vtxos to exit/i.test($))throw new Error("Could not build the exit package. Open the wallet online once so Arkade can cache exit data, then try again. ("+$+")");throw R}finally{identity.sign=originalSign;n.indexerProvider=rawIndexer}}`

const out = s.slice(0, start) + newMethod + s.slice(end)
fs.writeFileSync(assetPath, out)
execSync('node --check ' + JSON.stringify(assetPath), { stdio: 'inherit' })
console.log('PATCH_OK')
console.log('has_estimate', out.includes('WR.estimate'))
console.log('has_per_id', out.includes('rawIndexer.getVirtualTxs([id]'))
console.log('has_prefetch', out.includes('prefetchUnrollArtifacts(n)'))
console.log('has_uneconomic_bypass', out.includes('onlyUneconomic'))
console.log('has_feeRate_fallback', out.includes('feeRates.push(1)'))
console.log(
  'has_hd_signer',
  out.includes('_signerRouter') && out.includes('signerRouter.sign')
)
console.log('uneconomic_skip_fixed', out.includes(uneconomicSkipFixed))
console.log('uneconomic_throw_fixed', out.includes(uneconomicThrowFixed))
