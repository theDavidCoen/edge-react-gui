# Bitcoin P2WSH multisig (WIP)

Experimental Bitcoin native-segwit multisig in the GUI. Invites and status
updates travel over Nostr (NIP-17 gift wraps to an npub or NIP-05). This is
not a general Nostr chat product.

## Current behavior

- Create a 2-of-n Bitcoin wallet (typical QA path: 2-of-3).
- Edge keeps a BIP-49 Bitcoin **shell** wallet; cosigner keys are BIP-48
  `m/48'/0'/0'/2'` (P2WSH). On-chain funds sit on the shared P2WSH script,
  not on the shell receive addresses.
- The initiator invites cosigners by npub or NIP-05. Cosigners get a
  **Multisig wallet invite** banner, open the pending scene, and slide to
  join. Whoever first has every xpub publishes `complete` (needed for
  single-device QA when the initiator is logged out).
- Completed wallets can export a BIP-380/389 output descriptor (Sparrow and
  other descriptor-aware coordinators). The descriptor is watch-only
  recovery data; the BIP-39 seed / master private key is still required to
  sign.

## Performance — must improve

The join/complete protocol works, but several waits are still too long for
product use. Treat these as open work, not polish:

1. **Invite card after login.** Target: banner visible in about **2 seconds**
   even while other wallets are still loading. Locally stored joinable
   invites should paint immediately; live Nostr dumps must not wait on a
   full relay reconnect cycle (historically 8–30+ seconds when sockets were
   not open yet). Keep subscribe stable across wallet boot (do not tear
   down the pool on every `account` object change).

2. **Loading after slide to join.** `acceptMultisigInvite` still does too
   much on the slider critical path: orphan cleanup, BIP-49 wallet
   create/resolve, BIP-48 key derivation, persist, Nostr accept/complete
   publish, notification bookkeeping, orphan replay. The slider stays busy
   until that finishes, then navigates home. Move non-essential work off
   the join gesture so the UI can leave the pending scene in ~1–2 seconds
   and finish publish/sync in the background.

3. **Cosigner status after join.** “You” / peer rows should flip to accepted
   from local state without waiting for a later inbox poll. Remote peers
   still need a faster accept/complete round-trip than the 8s pending poll.

4. **Wallet list vs P2WSH balance.** Shell BTC balances must not be mistaken
   for the multisig. P2WSH watch refresh should not block first paint of
   the list or the invite card.

5. **Relay pool.** First successful relay should be enough to show an
   invite or publish an accept. Dead relays must not stall the UI for their
   full timeout. Reconnect backoff should stay aggressive on first retry.

Do **not** “fix” latency by restarting the Nostr subscribe effect, stopping
the pool, or clearing the orphan inbox on unrelated wallet-load updates —
that reintroduces the 30s invite-card delay.

## Code map

| Area | Path |
| --- | --- |
| Create / join / ingest | `src/actions/MultisigActions.ts` |
| Background Nostr | `src/components/services/MultisigNostrService.tsx` |
| Pending join UI | `src/components/scenes/MultisigPendingScene.tsx` |
| Create UI | `src/components/scenes/CreateWalletMultisigScene.tsx` |
| Store / types | `src/util/multisig/` |
| Relays / NIP-17 | `src/util/nostr/` |
