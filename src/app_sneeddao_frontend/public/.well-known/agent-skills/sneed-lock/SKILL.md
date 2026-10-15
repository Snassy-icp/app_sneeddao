---
name: sneed-lock
description: Integrate the Sneed Lock canister on the Internet Computer (pqsms-lqaaa-aaaal-ajjza-cai): time-lock ICRC-1 tokens and ICPSwap liquidity positions for a user, read who has what locked and until when, claim trading fees from locked positions, add liquidity to a locked position, transfer locked assets, pay the ICP lock fee, and withdraw after expiry. Use when a user or developer mentions Sneed Lock, SneedLock, locking LP positions or tokens on ICP, lock proofs for a token launch, or liquid locking.
license: MIT
metadata:
  publisher: Sneed DAO
  canister: pqsms-lqaaa-aaaal-ajjza-cai
  staging-canister: 25fsc-7yaaa-aaaal-qjt5q-cai
  full-reference: https://app.sneeddao.com/api-docs/sneed_lock.md
  candid: https://app.sneeddao.com/api-docs/sneed_lock.did
  source: https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_lock/main.mo
---

# Sneed Lock integration skill

Sneed Lock is a permissionless canister: it authorises every call by the calling principal only, so any front end, script or canister can use it for its users. Read the full reference at https://app.sneeddao.com/api-docs/sneed_lock.md (Markdown) when you need exact error strings, every method, or the types. The Candid interface is at https://app.sneeddao.com/api-docs/sneed_lock.did and a ready JavaScript IDL factory at https://app.sneeddao.com/api-docs/sneed_lock.did.js.

Canisters: production `pqsms-lqaaa-aaaal-ajjza-cai`, staging `25fsc-7yaaa-aaaal-qjt5q-cai` (same code, separate state; test there first). ICP ledger `ryjl3-tyaaa-aaaaa-aaaba-cai`, ICP ledger fee 10_000 e8s.

## Core facts to keep straight

1. **Three accounts per user principal P.** Frontend wallet `{owner: P}`. Sneed wallet `{owner: sneed_lock, subaccount: principalToSubAccount(P)}` (from `@dfinity/utils`; byte 0 = principal length, then principal bytes, zero padded to 32). Payment subaccount: never compute it, call `getPaymentSubaccount(P)`.
2. **Token locks are balance based.** Tokens sit in the user's Sneed wallet; the canister records `{lock_id, amount, expiry}` and `transfer_tokens` only releases `balance − sum(active locks) − ledger fee`.
3. **Position locks hold the ICPSwap position in the canister.** The user's "claim" maps the position to them. Order is strict: `claim_position` while the user still owns it on ICPSwap → pool `transferPosition(user, sneed_lock, id)` → `create_position_lock`.
4. **Expiry is nat64 nanoseconds since epoch.** JS: `BigInt(Date.now()) * 1_000_000n`. Minimum 5 seconds ahead; maximum set by governance (`Maximum lock time exceeded.`).
5. **Amounts are base units** (`nat`), never decimal-scaled.
6. **Locks never shorten or cancel.** Position lock expiry can be extended (`update_position_lock`). Ownership of either kind can be transferred while locked (liquid locking).
7. **Lock fee in ICP** may apply to `create_lock` and `create_position_lock`. Ask `getEffectiveLockFee(P, isPositionLock)`; deposit `fee_e8s − getPaymentBalance(P)` into the payment subaccount before locking. Exactly `fee_e8s` leaves the subaccount; surplus stays for next time.
8. **`Busy:` errors and `GenericError{error_code = 2}` mean retry in a few seconds**, not failure. Per-caller mutex on token operations, per-pool mutex on fee claims and add-liquidity.
9. **`dex` is always `1`** (ICPSwap). `token0`/`token1` passed to `create_position_lock` must be the pool's `metadata().token0.address` / `token1.address` in pool order; the canister stores them unverified and uses them for fee claims and add-liquidity.
10. **Every state change is logged as an ICRC-3 block** (`btype` prefixed `sneedlock_`, hash-chained via `phash`, tip certified). Read with `icrc3_get_blocks` / `icrc3_get_archives`, verify from `icrc3_get_tip_certificate`. Block catalogue and a verifier script: https://app.sneeddao.com/api-docs/sneed_lock.md section 8.

## Procedures

### Lock tokens
1. `balance = ledger.icrc1_balance_of(sneedWallet)`, `locked = get_summed_locks()` entry for the ledger (caller-scoped query), `free = balance − locked`.
2. If `amount > free`, `icrc1_transfer` the shortfall from the frontend wallet to `sneedWallet` (ledger fee on top).
3. Ensure the fee (see fact 7).
4. `create_lock(amount, ledger, expiresAtNs, [])` → `Ok(lock_id)` or `Err{message}` (last argument: optional dissolve delay in ns; with one, `expiresAtNs` is the end of the lock period and may be 0).

### Lock an ICPSwap position
1. `meta = pool.metadata()`; `token0/1 = Principal.fromText(meta.ok.token0.address / token1.address)`.
2. `claim_position(pool, positionId)` must return `true` (checks the pool says P owns it).
3. `pool.transferPosition(P, sneed_lock, positionId)` → `{ok: true}`.
4. Ensure the fee; `create_position_lock(pool, 1n, positionId, expiresAtNs, token0, token1, [])` → `Ok(lock_id)` (last argument: optional dissolve delay in ns). The position's NFT (ICRC-7, id = this lock id) is minted.
If step 4 fails, the position is in Sneed Lock, claimed and unlocked: fix the cause and retry, or `transfer_position(P, pool, positionId)` to take it back.

### Read locks
- Lists are paged: `get_lock_states_page({owner, ledger, swap_canister_id, token, kind, status, include_archived, prev, take})` → `vec LockState`, ascending lock id, ≤ 500 per call; continue with `prev = [last.lock_id]` until a page is short. `status: [{Active: null}]` = currently locked; `token` = token locks of that ledger plus position locks with it on either side. (The old `get_all_*` / `get_active_*` / `get_expired_*` / `get_ledger_token_locks` / `get_swap_position_locks` / `get_token_position_locks` were removed.)
- One lock: `get_lock_state(lock_id)` → `LockState` with `lock_end`, `dissolve_delay`, `dissolving_until`, `expiry` (effective; max nat64 = until it dissolves), `earliest_unlock`, `created_at`, `locked`, `archived`, `owner_subaccount` (NFT label). Also `get_lock_by_id(lock_id)` → the raw record.
- Dissolve delays (owner only): `start_dissolving(id)`, `stop_dissolving(id)`, `increase_dissolve_delay(id, ns)`, `extend_lock(id, new_lock_end)` → `Ok(LockState)` | `Err(NotFound | NotOwner | InProgress | Invalid text)`.
- Locked positions are ICRC-7 / ICRC-37 NFTs on this canister: `get_position_nft(pool, positionId)`, `icrc7_owner_of`, `icrc7_transfer`, `icrc37_approve_tokens`, `icrc37_transfer_from`. Transferring the NFT moves the position, its lock and unclaimed fees.
- A user's positions in Sneed Lock: `get_claimed_positions_for_principal(P)` → `{owner, swap_canister_id, position_id, position_lock: [] | [lock]}`.
- Caller's own: `get_token_locks()`, `get_summed_locks()`, `get_position_ownerships()`.
- Public pages: `https://app.sneeddao.com/lock/<lock_id>`, `https://app.sneeddao.com/sneedlock_info`.

### Claim trading fees of a locked position
`claim_position_fees(pool, positionId)` → `Ok{amount0, amount1, token0, token1}` (gross). The pool itself delivers `amount − ledger fee` per side to the user's Sneed wallet, asynchronously, a side at or below the fee is dropped. Fails with `Insufficient rewards to claim...` when neither side exceeds its ledger fee. Then optionally forward with `transfer_tokens(P, null, ledger, amount − fee)`.

### Add liquidity to a locked position
Fund the Sneed wallet with `amount + ledger fee` per token. `add_liquidity_to_locked_position(pool, positionId, amount0, amount1)`; each non-zero amount must exceed 2× its ledger fee; pass `0` for a side the (out-of-range) position cannot take. Result `{credited0/1, used0/1, returned0/1, increase_error}`; leftovers return to the Sneed wallet; `increase_error` non-null means the pool refused and everything came back.

### Transfer locked assets (liquid locking)
`transfer_token_lock_ownership(to, ledger, lock_id)` (caller's Sneed wallet needs one free ledger fee). `transfer_position_ownership(to, pool, positionId)`. The recipient needs no prior setup.

### Withdraw
Tokens: `transfer_tokens(to, toSubaccountOpt, ledger, amount)` from the Sneed wallet (unlocked part only). Positions: after expiry, `transfer_position(to, pool, positionId)` moves the position to `to` on ICPSwap and clears the claim; refused while the lock is active.

### Housekeeping
`has_expired_locks()` / `clear_expired_locks()`, `has_expired_position_locks()` / `clear_expired_position_locks()` archive the caller's expired locks. Most updates do this implicitly.

### Audit the history (ICRC-3 activity log)
- `icrc3_log_status()` → `log_length`, archives, settings. `icrc3_get_blocks([{start; length}])` → live blocks plus `archived_blocks` callbacks to call on the archive canisters for older ranges (max 1000 blocks per response). `icrc3_get_archives({from = null})` lists archives.
- Block = `Map { btype; ts; phash; tx }`; principals are `Blob`, accounts `Array [owner, subaccount?]`, numbers `Nat`. `tx.cid` joins with the text logs. One lock's history = blocks whose `tx.lock_id` matches.
- To prove a lock: verify `icrc3_get_tip_certificate` (IC certificate + hash tree with `last_block_index`, `last_block_hash`), then walk `phash` from the tip; the create block proves when it was locked, the absence of a later `sneedlock_position_withdraw` / withdrawal block proves it is still held.

## Minimal JavaScript setup

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import { idlFactory } from './sneed_lock.did.js'; // https://app.sneeddao.com/api-docs/sneed_lock.did.js

const SNEED_LOCK = Principal.fromText('pqsms-lqaaa-aaaal-ajjza-cai');
const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
const sneedLock = Actor.createActor(idlFactory, { agent, canisterId: SNEED_LOCK });
const sneedWallet = (p) => ({ owner: SNEED_LOCK, subaccount: [principalToSubAccount(p)] });
```

## dfx examples

```bash
dfx canister --network ic call pqsms-lqaaa-aaaal-ajjza-cai get_lock_states_page '(record { owner = null; ledger = null; swap_canister_id = null; token = null; kind = opt variant { PositionLock }; status = opt variant { Active }; include_archived = false; prev = null; take = opt (100 : nat) })' --query
dfx canister --network ic call pqsms-lqaaa-aaaal-ajjza-cai get_lock_by_id '(413 : nat)' --query
dfx canister --network ic call pqsms-lqaaa-aaaal-ajjza-cai getEffectiveLockFee '(principal "aaaaa-aa", true)'
```

## Reference implementation

The Sneed wallet is open source and calls every method above: lock wizard `src/app_sneeddao_frontend/src/pages/LockWizard.jsx`, wallet `src/Wallet.jsx` (`handleAddLiquidityToLockedPosition`, `handleClaimLockedPositionFees`), fee forwarding `src/utils/FeeForwarding.js`, positions loader `src/contexts/WalletContext.jsx`, all under https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend.
