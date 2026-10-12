# Sneed Lock canister API

Sneed Lock is the time-locking canister of Sneed DAO on the Internet Computer. It holds ICRC-1 tokens and ICPSwap liquidity positions on behalf of their owners and refuses to release them before a chosen expiry. Anyone can read every lock, and anyone can integrate: the canister authorises calls by the calling principal only, so a wallet, a DEX or a script can lock, claim fees, add liquidity and withdraw for its users without asking Sneed DAO for permission. We like it that way.

| | |
|---|---|
| Production canister | `pqsms-lqaaa-aaaal-ajjza-cai` |
| Staging canister | `25fsc-7yaaa-aaaal-qjt5q-cai` (separate state, same code line; use it to test) |
| Candid interface | [sneed_lock.did](/api-docs/sneed_lock.did) · [JavaScript IDL factory](/api-docs/sneed_lock.did.js) |
| Source | [src/sneed_lock/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_lock/main.mo) · [Types.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_lock/Types.mo) |
| Reference frontend | [app.sneeddao.com](https://app.sneeddao.com) ([source](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend)) |
| This document | [rendered](/api/sneed_lock) · [raw Markdown](/api-docs/sneed_lock.md) · [agent skill](/.well-known/agent-skills/sneed-lock/SKILL.md) |

Upgrades are decided by Sneed DAO proposals; the canister is controlled by the SNS. The method set below matches the source on `main`.

---

## 1. Mental model

### 1.1 Three accounts per user

Everything revolves around three ICRC-1 accounts that belong to one user principal `P`:

| Name used here | Account | Who controls it | Purpose |
|---|---|---|---|
| **Frontend wallet** | `{ owner = P; subaccount = null }` | The user's key | Ordinary balance, untouched by Sneed Lock |
| **Sneed wallet** (also "backend wallet") | `{ owner = sneed_lock; subaccount = wallet_subaccount(P) }` | Sneed Lock, on `P`'s instructions | Tokens that can be locked, locked tokens, claimed fees, add-liquidity funding and refunds |
| **Payment subaccount** | `{ owner = sneed_lock; subaccount = payment_subaccount(P) }` | Sneed Lock | ICP deposited to pay lock fees |

`wallet_subaccount(P)` is the 32-byte layout also produced by `principalToSubAccount` in `@dfinity/utils`: byte 0 is the length of the principal's bytes, bytes 1..n are the principal's bytes, the rest are zero.

```js
import { principalToSubAccount } from '@dfinity/utils';
const sneedWallet = { owner: SNEED_LOCK, subaccount: [principalToSubAccount(userPrincipal)] };
```

`payment_subaccount(P)` has a different layout (a marker byte at position 23). Do not compute it; ask the canister with the `getPaymentSubaccount(P)` query.

Anyone can deposit into either Sneed Lock account with a plain ICRC-1 transfer. Only `P` can move funds out, and only the unlocked part (see `transfer_tokens`).

### 1.2 Two kinds of locks

| | Token lock | Position lock |
|---|---|---|
| What is locked | An amount of one ICRC-1 token | One ICPSwap liquidity position (an NFT-like position id inside a pool canister) |
| Where the asset sits | In `P`'s Sneed wallet. The canister tracks lock records and never lets the sum of active locks leave the subaccount. | Owned by the Sneed Lock canister on ICPSwap. The canister tracks who may act on it. |
| Identified by | `lock_id` (global counter shared by both kinds) | `lock_id` plus `(swap_canister_id, position_id)` |
| Several per asset? | Yes. Locks on the same token add up; each has its own expiry. | One lock per position. `update_position_lock` extends it. |
| Change after creation | Never shortened or cancelled. Ownership can be transferred. | Expiry can only be extended. Ownership can be transferred. Liquidity can be added. Trading fees can be claimed. |
| After expiry | Tokens become transferable again. The lock record is archived lazily. | The owner withdraws the position to any ICPSwap principal with `transfer_position`. |

### 1.3 Time

Expiries are `nat64` nanoseconds since the Unix epoch, the same unit as `Time.now()` in Motoko and `BigInt(Date.now()) * 1_000_000n` in JavaScript. A lock must end at least 5 seconds in the future and no later than the maximum set by Sneed governance (the canister answers `Maximum lock time exceeded.` otherwise).

### 1.4 Amounts

All amounts are base units of the ledger (`e8s` for ICP) as `nat`. Nothing is scaled by decimals inside the canister.

### 1.5 Permissionless, but not anonymous

The canister identifies users only by the principal that signs the call. Any front end that can produce a signed call for the user, Internet Identity, Plug, OISY, NFID, a hardware wallet, a dfx identity, is a first-class client. The caveat for integrators is the flip side: a lock belongs to the principal that created it, so a user who logs into your product with a different principal than they use elsewhere will see different locks.

---

## 2. Quick start

### 2.1 Create an actor

Generate declarations from the Candid file, or copy the ready-made JavaScript IDL factory published next to this document.

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './sneed_lock.did.js'; // https://app.sneeddao.com/api-docs/sneed_lock.did.js

const SNEED_LOCK = 'pqsms-lqaaa-aaaal-ajjza-cai';

export function sneedLockActor(identity) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId: SNEED_LOCK });
}
```

With dfx:

```bash
dfx canister --network ic call pqsms-lqaaa-aaaal-ajjza-cai get_active_token_locks '()' --query
```

### 2.2 Lock tokens, end to end

1. Send the tokens to the user's Sneed wallet (frontend wallet → Sneed Lock subaccount).
2. Make sure the lock fee is covered (section 4).
3. Call `create_lock`.

```js
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';

async function lockTokens({ identity, ledgerActor, ledgerId, amount, expiresAtNs }) {
  const me = identity.getPrincipal();
  const sneedLock = sneedLockActor(identity);
  const sneedWallet = { owner: Principal.fromText(SNEED_LOCK), subaccount: [principalToSubAccount(me)] };

  // 1. How much is already in the Sneed wallet and not locked?
  const [balance, locks] = await Promise.all([
    ledgerActor.icrc1_balance_of(sneedWallet),
    sneedLock.get_summed_locks(),                      // caller-scoped: [(ledger, lockedSum)]
  ]);
  const locked = locks.find(([l]) => l.toText() === ledgerId)?.[1] ?? 0n;
  const free = balance > locked ? balance - locked : 0n;

  // 2. Top up the shortfall from the frontend wallet (the ledger fee is paid on top).
  if (amount > free) {
    const r = await ledgerActor.icrc1_transfer({
      to: sneedWallet, amount: amount - free,
      fee: [], memo: [], from_subaccount: [], created_at_time: [],
    });
    if ('Err' in r) throw new Error(`Deposit failed: ${JSON.stringify(r.Err)}`);
  }

  // 3. Lock. The fee (if any) is taken from the payment subaccount, see section 4.
  const result = await sneedLock.create_lock(amount, Principal.fromText(ledgerId), expiresAtNs);
  if ('Err' in result) throw new Error(result.Err.message);
  return result.Ok; // lock_id
}
```

The reference implementation is `executeTokenLock` in [LockWizard.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/pages/LockWizard.jsx).

### 2.3 Lock an ICPSwap position, end to end

The order matters. The claim must be recorded **while the user still owns the position on ICPSwap**, the position is transferred to Sneed Lock **second**, and the lock is created **third**.

```js
const DEX_ICPSWAP = 1n;

async function lockPosition({ identity, poolActor, poolId, positionId, expiresAtNs }) {
  const me = identity.getPrincipal();
  const sneedLock = sneedLockActor(identity);
  const pool = Principal.fromText(poolId);

  // Pool tokens, in the pool's own order. They are stored on the lock and used later
  // for fee claims and add-liquidity, so they must be the pool's token0/token1.
  const meta = await poolActor.metadata();
  const token0 = Principal.fromText(meta.ok.token0.address);
  const token1 = Principal.fromText(meta.ok.token1.address);

  // 1. Claim: Sneed Lock checks with the pool that `me` owns the position right now.
  if (!(await sneedLock.claim_position(pool, positionId))) throw new Error('Not the owner of this position');

  // 2. Hand the position to Sneed Lock on ICPSwap.
  const t = await poolActor.transferPosition(me, Principal.fromText(SNEED_LOCK), positionId);
  if ('err' in t) throw new Error(`transferPosition failed: ${JSON.stringify(t.err)}`);

  // 3. Lock it.
  const r = await sneedLock.create_position_lock(pool, DEX_ICPSWAP, positionId, expiresAtNs, token0, token1);
  if ('Err' in r) throw new Error(r.Err.message);
  return r.Ok; // lock_id
}
```

If step 3 fails (for example the fee was not deposited), nothing is lost: the position sits in Sneed Lock with the user's claim on it, unlocked. The user can retry `create_position_lock` after fixing the cause, or take it back with `transfer_position`.

Reference: `executePositionLock` in [LockWizard.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/pages/LockWizard.jsx).

### 2.4 Read locks

```js
// Everything that is currently locked, across all users (query, no identity needed)
const tokenLocks = await sneedLock.get_active_token_locks();      // [(owner, ledger, { lock_id, amount, expiry })]
const positionLocks = await sneedLock.get_active_position_locks(); // [(owner, pool, { lock_id, position_id, expiry, token0, token1, dex })]

// One token's locks, active and archived
const sneedLocks = await sneedLock.get_ledger_token_locks(Principal.fromText('hvgxa-wqaaa-aaaaq-aacia-cai'));

// One user's positions held by Sneed Lock, with their lock if any
const mine = await sneedLock.get_claimed_positions_for_principal(me);
// [{ owner, swap_canister_id, position_id, position_lock: [] | [lock] }]
```

`get_active_*` queries are the right source for "is this still locked?": they compare expiry against the canister's clock at query time.

---

## 3. Flows in detail

### 3.1 Token locks

**Deposit.** Transfer to the Sneed wallet account. Any sender works, including another canister, an exchange withdrawal or a direct ledger call.

**Lock.** `create_lock(amount, ledger, expires_at)` checks, in order: expiry within bounds; Sneed wallet balance ≥ `amount`; balance ≥ existing active locks on that ledger + `amount`; fee deposit sufficient (section 4). It then records the lock and finally charges the fee. A lock that was recorded but whose fee transfer failed stays valid (the failure is logged for the DAO).

**While locked.** The tokens stay in the user's subaccount. `transfer_tokens` lets the user move only `balance − sum(active locks) − ledger fee`. Nothing else in the canister can move them.

**Expiry and housekeeping.** Expired locks are archived lazily: `create_lock`, `transfer_tokens`, `transfer_token_lock_ownership` and `clear_expired_locks` all archive the caller's expired token locks first. `has_expired_locks` tells a front end whether a `clear_expired_locks` call would do anything. Until archived, an expired lock still shows up in `get_all_token_locks` and `get_token_locks`, but it no longer blocks a transfer, because the transfer path archives it first. Archived locks remain readable through `get_token_lock_by_id`, `get_ledger_token_locks` and `get_expired_token_locks`.

**Withdraw.** `transfer_tokens(to_principal, to_subaccount, ledger, amount)` sends from the Sneed wallet to any account. The ledger fee is paid by the Sneed wallet on top of `amount`.

### 3.2 Position locks

**Prerequisite: the position is in the user's Sneed wallet.** For Sneed Lock, a position is "in the wallet" when the Sneed Lock canister owns it on ICPSwap **and** the user has a recorded claim on it. The claim is what maps the position back to its user; ICPSwap only sees the canister. The claim is recorded by `claim_position`, which asks the pool whether the caller owns the position at that moment. Hence the order in 2.3: claim, then transfer, then lock.

What if a position is transferred to Sneed Lock without a claim? Nobody can act on it through the public API, because every position method requires the caller's claim. The DAO can recover it by proposal, but avoid the situation: claim first.

**Lock.** `create_position_lock(pool, dex, position_id, expires_at, token0, token1)`:
- `dex` must be `1` (ICPSwap). No other DEX is supported.
- The caller must have the claim and the pool must report Sneed Lock as the owner.
- `token0` and `token1` are **not validated** against the pool. They are stored on the lock and used by `claim_position_fees` and `add_liquidity_to_locked_position` to talk to the right ledgers. Pass the pool's `metadata().token0.address` and `token1.address`, in that order.
- Fee handling is the same as for token locks.
- Calling it for a position that already has a lock behaves like `update_position_lock`.

**Extend.** `update_position_lock(pool, position_id, expires_at)` moves the expiry later. An earlier expiry is refused (`New expiry is before current expiry.`). No fee.

**Withdraw after expiry.** `transfer_position(to, pool, position_id)` makes Sneed Lock call the pool's `transferPosition` to `to` and clears the claim. While the position's lock is active the call is refused with an `InternalError` that names the expiry. (This guard is part of the upgrade that accompanies this documentation; earlier builds relied on the front end alone.) `to` may be the user's own principal or anyone else's.

**Housekeeping.** `has_expired_position_locks` / `clear_expired_position_locks` mirror the token versions. `transfer_position` and the lock calls archive expired position locks for the caller first.

### 3.3 Claiming trading fees from a locked position

A locked position keeps earning swap fees. `claim_position_fees(pool, position_id)`:

1. Requires the caller's claim and a lock record on the position.
2. Reads both ledger fees and the position's `tokensOwed0/1` from the pool. If neither side exceeds its ledger fee the call fails with `Insufficient rewards to claim...` and nothing happens (the pool would swallow such amounts).
3. Calls the pool's `claimToSubaccount` with the caller's `wallet_subaccount`. ICPSwap then transfers the fees to the user's Sneed wallet itself, from its own delivery queue, usually within a second or two. Sneed Lock never holds the fees.
4. Returns `{ request_id, amount0, amount1, token0, token1 }` with the **gross** amounts. What arrives is `amount − ledger fee` per side; a side at or below its fee is not delivered at all.

Because delivery is asynchronous, poll the user's Sneed wallet balance after the call if you want to show the arrival, then optionally forward the fees to the frontend wallet with `transfer_tokens`. That is what the Sneed wallet does: see [FeeForwarding.js](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/utils/FeeForwarding.js) and `handleClaimLockedPositionFees` in [Wallet.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/Wallet.jsx).

After the lock expires, withdraw the position with `transfer_position` and claim on ICPSwap directly.

### 3.4 Adding liquidity to a locked position

`add_liquidity_to_locked_position(pool, position_id, amount0, amount1)` grows a locked position from the user's Sneed wallet:

- Only the lock's current owner may call, and only while the lock is active.
- Amounts are base units of `token0` / `token1`. Either may be `0`, and each non-zero amount must exceed **twice** its ledger fee (one fee to move it into the pool, one inside the pool's deposit). The Sneed wallet must hold the amount plus one ledger fee, beyond any locked sum of that token.
- The canister moves the tokens into the pool, calls `increaseLiquidity` within the position's existing price range, measures what the pool did not use, and returns the leftovers to the Sneed wallet (minus the pool's delivery fee). Leftovers at or below a ledger fee cannot be returned and stay in the pool as dust.
- Result: `credited0/1` (what reached the pool), `used0/1` (what became liquidity), `returned0/1` (what came back), and `increase_error` which is non-null when the pool refused to add, in which case everything was returned.

An out-of-range position accepts only one token; pass `0` for the other. The Sneed wallet's dialog is in [AddLiquidityModal.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/AddLiquidityModal.jsx) and the call in `handleAddLiquidityToLockedPosition` in [Wallet.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/Wallet.jsx).

### 3.5 Liquid locking: transferring locked assets

A lock can change hands without ending. This lets locked positions and tokens be sold, gifted or used as collateral while the commitment stays intact.

- `transfer_token_lock_ownership(to, ledger, lock_id)` moves the lock record to `to` and transfers the locked amount from the caller's Sneed wallet to `to`'s Sneed wallet. The caller's Sneed wallet must hold one ledger fee of free balance. The lock is recorded on the recipient before the ledger call, so the recipient can never see the tokens arrive unlocked.
- `transfer_position_ownership(to, pool, position_id)` moves the claim and the lock (if any) to `to`. No ICPSwap call is made; the canister stays the owner on the pool.

The recipient does not need to have used Sneed Lock before.

### 3.6 Reading the Sneed wallet the way the reference wallet does

For a token the Sneed wallet shows:

- frontend balance: `icrc1_balance_of({ owner: P })`
- Sneed wallet balance: `icrc1_balance_of({ owner: sneed_lock, subaccount: wallet_subaccount(P) })`
- locked: `get_summed_locks()` entry for the ledger (caller-scoped)
- available to lock: frontend + Sneed wallet − locked
- available to withdraw: Sneed wallet − locked − one fee

For positions it calls `get_claimed_positions_for_principal(P)`, then asks each pool for the position's amounts. See `fetchBalancesAndLocks` in [Wallet.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/Wallet.jsx) and the positions loader in [WalletContext.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/contexts/WalletContext.jsx).

---

## 4. Lock fees and payment

Creating a lock may cost a fee in ICP, set by Sneed governance and lower for Sneed Premium members. Extending a position lock, transferring ownership, claiming fees and adding liquidity are free (ledger fees aside).

**Find out the fee.** `getEffectiveLockFee(user, is_position_lock)` returns `{ fee_e8s, is_premium }` and is authoritative (it checks premium status with the premium canister; it is an update call). `get_lock_fees_icp()` is a query with the whole fee table.

**Pay.** The fee is taken from the user's payment subaccount, `getPaymentSubaccount(user)`. Deposit ICP there with an ordinary ICRC-1 transfer from any account; `getPaymentBalance(user)` reads what is there. When a lock is created the canister verifies `balance ≥ fee_e8s` first, records the lock, then transfers the fee out (`fee_e8s − 10_000` plus the 10_000 e8s ICP ledger fee, so exactly `fee_e8s` leaves the subaccount). Any surplus stays for the next lock.

**From the Sneed wallet.** If the user keeps ICP in their Sneed wallet, move it with `transfer_tokens(sneed_lock, ?payment_subaccount, icp_ledger, amount)`; the Sneed wallet pays the ledger fee. The Sneed wallet's lock wizard uses ICP from the Sneed wallet first and the frontend wallet for the rest: `computeFeePlan` and `payLockFee` in [LockWizard.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/pages/LockWizard.jsx).

```js
async function ensureLockFee({ identity, icpLedger, isPositionLock }) {
  const me = identity.getPrincipal();
  const sneedLock = sneedLockActor(identity);
  const { fee_e8s } = await sneedLock.getEffectiveLockFee(me, isPositionLock);
  if (fee_e8s === 0n) return;
  const paid = await sneedLock.getPaymentBalance(me);
  if (paid >= fee_e8s) return;
  const subaccount = await sneedLock.getPaymentSubaccount(me);
  const r = await icpLedger.icrc1_transfer({
    to: { owner: Principal.fromText(SNEED_LOCK), subaccount: [subaccount] },
    amount: fee_e8s - paid, fee: [], memo: [], from_subaccount: [], created_at_time: [],
  });
  if ('Err' in r) throw new Error(`Fee deposit failed: ${JSON.stringify(r.Err)}`);
}
```

A `create_lock` or `create_position_lock` without enough deposit fails with `ICP payment verification failed: Insufficient ICP payment. Required: N e8s, Available: M e8s` and changes nothing.

---

## 5. Concurrency, errors and retries

**Per-caller token mutex.** `transfer_tokens`, `transfer_token_lock_ownership` and `add_liquidity_to_locked_position` serialise on the caller. A second call during the first returns a `GenericError` with `error_code = 2` (`A token operation is already in progress...`). Retry after the first completes.

**Per-pool mutex.** `claim_position_fees` and `add_liquidity_to_locked_position` serialise on the pool. The loser gets `Busy: another operation is in progress on this pool; please retry in a few seconds`. `add_liquidity_to_locked_position` additionally refuses with `Busy: a fee delivery from this pool is still in transit...` while a claimed fee delivery is pending in the pool. Both are safe to retry after a few seconds.

**Result shapes.** Most updates return `variant { Ok; Err }` with an `Err` record `{ message : text; transfer_error : opt TransferError }` or a plain `text`. `transfer_position` uses ICPSwap's lowercase `variant { ok : bool; err : ... }`. `claim_position` returns a bare `bool`. Always branch on the variant; never assume a thrown error means nothing happened.

**Thrown errors.** A rejected call (trap, canister unreachable) means the state did not change, except after a cross-canister await. The canister handles its own awaits carefully (ledger calls are classified by error code, and ownership moves are recorded before transfers), so a client needs no compensation logic: re-read state with the queries and retry.

**Idempotency.** `claim_position` is idempotent. `create_lock` is not: two successful calls create two locks. Use the returned `lock_id` to avoid double submission on retries after a timeout: list `get_token_locks()` and compare.

---

## 6. Method reference

Types are in section 7. "Caller" means the principal signing the call. Methods marked *query* can be called without a signature.

### 6.1 Reading locks (public queries)

| Method | Returns | Notes |
|---|---|---|
| `get_all_token_locks()` | `vec FullyQualifiedLock` | Every token lock record in live state, including expired ones not yet archived. |
| `get_active_token_locks()` | `vec FullyQualifiedLock` | Live records with `expiry > now`. Use this for "currently locked". |
| `get_expired_token_locks()` | `vec FullyQualifiedLock` | Expired live records plus all archived token locks. |
| `get_ledger_token_locks(ledger)` | `vec FullyQualifiedLock` | All records for one ledger, live and archived. Filter by expiry yourself. |
| `get_all_position_locks()` | `vec FullyQualifiedPositionLock` | Every position lock record in live state. |
| `get_active_position_locks()` | `vec FullyQualifiedPositionLock` | Live records with `expiry > now`. |
| `get_expired_position_locks()` | `vec FullyQualifiedPositionLock` | Expired live records plus archived. |
| `get_swap_position_locks(pool)` | `vec FullyQualifiedPositionLock` | All records for one pool, live and archived. |
| `get_token_position_locks(ledger)` | `vec FullyQualifiedPositionLock` | Live position locks whose `token0` or `token1` is `ledger`. |
| `get_lock_by_id(lock_id)` | `opt LockInfo` | Either kind, archived first then live. |
| `get_token_lock_by_id(lock_id)` | `opt FullyQualifiedLock` | Archived first, then live. |
| `get_position_lock_by_id(lock_id)` | `opt FullyQualifiedPositionLock` | Archived first, then live. |
| `get_lock_type(lock_id)` | `opt LockType` | `TokenLock` or `PositionLock`. |
| `get_claimed_positions_for_principal(owner)` | `vec ClaimedPosition` | Positions `owner` has a claim on, each with `position_lock` (`[]` when not locked; an expired lock stays until archived). |

`FullyQualifiedLock` is the tuple `(owner, ledger, Lock)`; `FullyQualifiedPositionLock` is `(owner, pool, PositionLock)`. In JavaScript these arrive as arrays `[owner, ledger, lock]`.

### 6.2 Caller-scoped queries

| Method | Returns | Notes |
|---|---|---|
| `get_summed_locks()` | `vec (ledger, Balance)` | Sum of the caller's live token locks per ledger (expired-but-unarchived locks count until archived). |
| `get_token_locks()` | `vec (LockId, ledger, Balance, Expiry)` | The caller's live token lock records. |
| `get_position_ownerships()` | `vec (pool, PositionId)` | Positions the caller has a claim on. |
| `has_expired_locks()` | `bool` | True if `clear_expired_locks` would archive something. |
| `has_expired_position_locks()` | `bool` | Same for position locks. |
| `get_my_claim_history()` | `vec ClaimRequest` | Completed and failed fee-claim records of the caller (see 6.9). |

### 6.3 Token locks (updates)

**`create_lock(amount : nat, icrc1_ledger_canister_id : principal, expires_at : Expiry) → CreateLockResult`**
Locks `amount` of the token in the caller's Sneed wallet until `expires_at`. Returns `Ok(lock_id)`. Errors (`Err.message`): `Minimum lock time not fulfilled.`, `Maximum lock time exceeded.`, `Insufficient balance to lock ...`, `Insufficient unlocked balance to lock ...`, `ICP payment verification failed: ...`. Side effects: archives the caller's expired token locks; charges the fee from the payment subaccount after recording the lock.

**`transfer_tokens(to_principal : principal, to_subaccount : opt blob, icrc1_ledger_canister_id : principal, amount : nat) → TransferResult`**
Sends `amount` from the caller's Sneed wallet to `{ to_principal; to_subaccount }`; the Sneed wallet also pays the ledger fee. Refuses when `balance < amount + fee + sum(active locks)` (`GenericError`, `error_code = 1`) or when another token operation of the caller is running (`error_code = 2`). Returns the ledger block index on success. Also used to withdraw claimed fees and add-liquidity refunds, and to fund the payment subaccount from the Sneed wallet.

**`transfer_token_lock_ownership(to_principal : principal, token_type : principal, lock_id : nat) → TransferTokenLockOwnershipResult`**
Liquid locking for tokens, see 3.5. Errors: lock not found, lock expired, inconsistent state, `Insufficient unlocked balance to cover transfer fee ...`, or a ledger `transfer_error`. If the ledger call fails with an unknown outcome the lock is kept on both parties until the DAO reconciles; the message says so.

**`clear_expired_locks() → ()`** archives the caller's expired token locks.

### 6.4 Positions (updates)

**`claim_position(swap_canister_id : principal, position_id : nat) → bool`**
Records that the caller owns `position_id` in `swap_canister_id`, after confirming it with the pool's `getUserPositionIdsByPrincipal(caller)`. Idempotent. `false` means the pool did not list the caller as owner (or could not be reached).

**`create_position_lock(swap_canister_id : principal, dex : nat, position_id : nat, expires_at : Expiry, token0 : principal, token1 : principal) → CreateLockResult`**
See 3.2. `dex` must be `1`. Errors: lock time bounds, `Position not claimed by caller.`, `Position is not transferred to this canister.`, `Dex not supported.`, `ICP payment verification failed: ...`. If the position already has a lock, behaves as `update_position_lock`.

**`update_position_lock(swap_canister_id : principal, position_id : nat, expires_at : Expiry) → CreateLockResult`**
Extends an existing lock. Errors as above plus `New expiry is before current expiry.`. No fee. Returns the existing `lock_id`.

**`transfer_position(to : principal, swap_canister_id : principal, position_id : nat) → TransferPositionResult`**
Withdraws the position from Sneed Lock to `to` on ICPSwap and clears the caller's claim. Refused while the lock is active (`err.InternalError` naming the expiry). Also refused when the caller has no claim or the pool does not list Sneed Lock as the owner. The pool's own error is passed through on failure.

**`transfer_position_ownership(to_principal : principal, swap_canister_id : principal, position_id : nat) → TransferPositionOwnershipResult`**
Liquid locking for positions, see 3.5. Error: `Caller is not the owner of position ...`.

**`clear_expired_position_locks() → ()`** archives the caller's expired position locks.

### 6.5 Fees of locked positions

**`claim_position_fees(swap_canister_id : principal, position_id : nat) → ClaimFeesResult`**
See 3.3. `Ok { request_id; amount0; amount1; token0; token1 }` with gross amounts. Errors (text): `Caller does not own position ...`, `Position ... is not locked`, `Busy: ...`, `Insufficient rewards to claim. Token0: a (need > fee0), Token1: b (need > fee1)`, `Claim failed: ...`, `Claim call failed with unknown outcome: ...` (the pool either rolled back or will still deliver to the user's Sneed wallet; nothing is held by Sneed Lock).

### 6.6 Liquidity

**`add_liquidity_to_locked_position(swap_canister_id : principal, position_id : nat, amount0 : nat, amount1 : nat) → AddLiquidityResult`**
See 3.4. Errors (text) include `Caller does not own position ...`, `Position ... is not locked`, `The lock on this position has expired; ...`, `Nothing to add`, `amount0 must exceed twice the ledger fee (f)`, `Busy: ...`, `Insufficient balance ...`, and messages prefixed `ADMIN ACTION:` when a refund failed after the pool was credited (the DAO can return the funds with an admin call; the pool stays flagged busy for add-liquidity until then).

### 6.7 Fees and payment

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `getEffectiveLockFee(user, is_position_lock)` | update | `{ fee_e8s : nat64; is_premium : bool }` | Authoritative fee for `user`. |
| `get_lock_fees_icp()` | query | fee table and recipient | `token_lock_fee_icp_e8s`, `position_lock_fee_icp_e8s`, `premium_*`, `fee_recipient_*`, `sneed_premium_canister_id`. |
| `getPaymentSubaccount(user)` | query | `blob` | The user's payment subaccount on Sneed Lock. |
| `getPaymentBalance(user)` | update | `nat` | ICP e8s currently deposited (reads the ledger). |
| `get_lock_fee_stats()` | query | totals collected | For dashboards. |

### 6.8 Logs

`get_info_id_range()`, `get_error_id_range()`, `get_info_entries(start, length)`, `get_error_entries(start, length)` expose the canister's circular text logs (`BufferEntry { id; timestamp; caller; correlation_id; content }`). Every update logs under a `correlation_id`; error messages that mention one can be looked up here. These are update calls, the buffers hold the last 10,000 entries each, and they record failures as well as successes.

The structured, permanent and verifiable record of what actually happened is the ICRC-3 activity log in [section 8](#8-activity-log-icrc-3); its blocks carry the same `correlation_id` as `cid`, so the two can be joined.

### 6.9 Compatibility and retired methods

The fee-claim queue of earlier versions is gone; claims are synchronous now. These remain for older clients:

| Method | Behaviour today |
|---|---|
| `request_claim_and_withdraw(pool, position_id)` | Performs `claim_position_fees` and returns `Ok(request_id)`. |
| `get_claim_request_status(request_id)` | `Completed` or `Failed` record for a request id, or null. Never `Active`. |
| `get_completed_claim_request(id)`, `get_failed_claim_request(id)` | Lookups in the history. |
| `get_all_completed_claim_requests()`, `get_all_failed_claim_requests()` | Whole history. |
| `get_all_active_claim_requests()` | Always empty. |

New integrations should use `claim_position_fees`.

### 6.10 Admin and governance

Methods prefixed `admin_` and `set_max_lock_length_days` are restricted to Sneed governance, the canister's controllers and listed admins (`get_admin_list()`). They exist for recovery (returning stranded tokens, pool balances), fee configuration and premium wiring. Integrators never call them; they are listed in the Candid file for transparency.

---

## 7. Types

```candid
type Expiry = nat64;          // ns since Unix epoch
type LockId = nat;
type PositionId = nat;
type Balance = nat;
type TokenType = principal;   // an ICRC-1 ledger canister
type SwapCanisterId = principal; // an ICPSwap pool canister
type Dex = nat;               // 1 = ICPSwap

type Lock = record { lock_id : LockId; amount : Balance; expiry : Expiry };
type PositionLock = record {
  lock_id : LockId; position_id : PositionId; expiry : Expiry;
  dex : Dex; token0 : TokenType; token1 : TokenType;
};
type FullyQualifiedLock = record { principal; TokenType; Lock };                 // (owner, ledger, lock)
type FullyQualifiedPositionLock = record { principal; SwapCanisterId; PositionLock }; // (owner, pool, lock)
type LockInfo = variant { TokenLock : FullyQualifiedLock; PositionLock : FullyQualifiedPositionLock };
type LockType = variant { TokenLock; PositionLock };

type ClaimedPosition = record {
  owner : principal; swap_canister_id : SwapCanisterId; position_id : PositionId;
  position_lock : opt PositionLock;
};

type CreateLockError = record { message : text; transfer_error : opt TransferError };
type CreateLockResult = variant { Ok : LockId; Err : CreateLockError };

type TransferResult = variant { Ok : nat; Err : TransferError };   // ICRC-1 result
type TransferPositionResult = variant { ok : bool; err : TransferPositionError }; // ICPSwap shape
type TransferPositionError = variant { CommonError; InsufficientFunds; InternalError : text; UnsupportedToken : text };
type TransferPositionOwnershipResult = variant { Ok; Err : record { message : text } };
type TransferTokenLockOwnershipResult = variant { Ok; Err : record { message : text; transfer_error : opt TransferError } };

type ClaimFeesResult = variant {
  Ok : record { request_id : nat; amount0 : nat; amount1 : nat; token0 : TokenType; token1 : TokenType };
  Err : text;
};
type AddLiquidityResult = variant {
  Ok : record {
    position_id : PositionId;
    credited0 : nat; credited1 : nat;   // reached the pool account
    used0 : nat; used1 : nat;           // became liquidity
    returned0 : nat; returned1 : nat;   // sent back to the Sneed wallet
    increase_error : opt text;          // set when the pool refused; everything was returned
  };
  Err : text;
};
```

The full interface, including admin and log types, is in [sneed_lock.did](/api-docs/sneed_lock.did).

---

## 8. Activity log (ICRC-3)

Every action that changes state in Sneed Lock is recorded as a block in a hash-chained, certified log, readable through the standard [ICRC-3](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3) interface. Each block carries the hash of the previous block (`phash`), and the canister certifies the index and hash of the latest block with the Internet Computer's certification mechanism. A client can therefore download the whole history and prove it is complete and untampered without trusting Sneed DAO, this app, or the node that answered. Old blocks move to archive canisters that the lock canister creates and controls; the chain of archives grows on its own when one fills up.

This is not a token ledger: there are no balances and no ICRC-1 blocks. Think of it as the canister's audit trail. The design, including storage and the archive protocol, is in [spec/sneed_lock_icrc3.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sneed_lock_icrc3.md); the implementation is the shared library [src/icrc3](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/icrc3) (`Log.mo`, `Hash.mo`, `Archive.mo`, `Types.mo`), with no third-party ledger library involved. The same library is meant to give every Sneed DAO canister its own log.

### 8.1 Endpoints

| Method | Type | Returns |
|---|---|---|
| `icrc3_get_blocks(vec record { start : nat; length : nat })` | query | `{ log_length; blocks : vec { id; block }; archived_blocks : vec { args; callback } }`. Blocks still held by the lock canister come back directly. For ranges that live in an archive, call `callback` (that archive's own `icrc3_get_blocks`) with `args`. |
| `icrc3_get_archives(record { from : opt principal })` | query | Every archive canister with the first and last block index it holds, in index order. With `from`, only the archives after that one. |
| `icrc3_get_tip_certificate()` | query | `opt { certificate : blob; hash_tree : blob }`: the IC certificate over the canister's certified data, and the CBOR-encoded hash tree with the two leaves `last_block_index` (unsigned LEB128) and `last_block_hash`. Null until the first block exists. |
| `icrc3_supported_block_types()` | query | Every `btype` the log can contain, each linking to [8.3](#83-block-types). |
| `icrc10_supported_standards()` | query | Lists ICRC-3 and ICRC-10. |
| `icrc3_log_status()` | query | Log length, number and first index of live blocks, hash of the last block, the archives with their ranges, the spill settings and whether the one-time history import has run. Sneed Lock specific. |

A `icrc3_get_blocks` response is capped at 1000 blocks or about 1.5 MB, whichever comes first; page with `start`. Block indexes are global and never change: block `n` is the same block whether it is served live or from an archive.

### 8.2 Block format

A block is an ICRC-3 `Value` of variant `Map` with these fields:

| Field | Type | Meaning |
|---|---|---|
| `btype` | Text | The block type, see [8.3](#83-block-types). |
| `ts` | Nat | When the block was appended, nanoseconds since epoch. |
| `phash` | Blob | SHA-256 hash of the previous block. Absent on block 0 only. |
| `tx` | Map | The action's data; fields depend on `btype`. |

Conventions inside `tx`:

- Principals (owners, ledgers, pools) are `Blob` values holding the raw principal bytes, as ICRC-3 represents account owners. Decode with `Principal.fromUint8Array`.
- ICRC-1 accounts are `Array [Blob owner, Blob subaccount]`, with the subaccount element omitted for the default subaccount.
- Amounts, ids, expiries and timestamps are `Nat` (base units; nanoseconds since epoch). Nothing is decimal-scaled.
- `cid` is the correlation id of the call that produced the block, the same number the text logs use.
- `caller` is the principal that made the call. For user actions it equals the owner; for admin actions it is the admin or governance principal.
- Optional fields are omitted when absent, never encoded as empty values.

The hash of a block is the ICRC-3 representation-independent hash: `Nat` hashed as its unsigned LEB128 bytes, `Int` as signed LEB128, `Text` as UTF-8, `Blob` as is, `Array` as the concatenation of its elements' hashes, `Map` as the concatenation of the bytewise-sorted `hash(key) ‖ hash(value)` pairs, every step wrapped in SHA-256. It is the same construction as IC request ids. A JavaScript implementation is in [8.4](#84-verifying-the-log).

### 8.3 Block types

All types carry the `sneedlock_` prefix. ICRC numbers are reserved for ICRC standards, so a letter prefix cannot collide with any of them. Housekeeping (archiving expired locks) is not logged: expiry follows from the `expiry` field of the create block.

Lifecycle of the log itself:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedlock_log_start` | First block ever, written by the one-time history import. | `canister`, `current_lock_id`, `active_token_locks`, `active_position_locks`, `archived_token_locks`, `archived_position_locks`, `total_token_lock_fees_e8s`, `total_position_lock_fees_e8s` |
| `sneedlock_import_token_lock` | One per token lock that existed when the log started. | `owner`, `ledger`, `lock_id`, `amount`, `expiry`, `status` (`active` or `expired`) |
| `sneedlock_import_position_lock` | One per position lock that existed when the log started. | `owner`, `pool`, `position_id`, `lock_id`, `expiry`, `token0`, `token1`, `dex`, `status` |
| `sneedlock_import_position_claim` | One per claimed position without a lock when the log started. | `owner`, `pool`, `position_id` |

Import blocks describe state, not observed actions: they have no `cid` or `caller`, and the original creation times of those locks are not known to the log.

Token locks:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedlock_token_lock_create` | `create_lock` succeeded. | `cid`, `caller`, `owner`, `ledger`, `lock_id`, `amount`, `expiry` |
| `sneedlock_token_lock_transfer` | `transfer_token_lock_ownership` moved the lock and its tokens. | `cid`, `caller`, `from`, `to`, `ledger`, `lock_id`, `amount`, `expiry`, `ledger_tx` (ledger block index), `outcome` = `ok`. When the ledger call threw with an ambiguous code the block has `outcome` = `uncertain` and no `ledger_tx`: the lock is then held for both parties until reconciled. |
| `sneedlock_token_withdraw` | `transfer_tokens` moved tokens out of the caller's Sneed wallet. | `cid`, `caller`, `ledger`, `amount`, `to` (account), `ledger_tx` |

Positions:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedlock_position_claim` | `claim_position` verified ownership on ICPSwap and mapped the position to the caller. | `cid`, `caller`, `owner`, `pool`, `position_id` |
| `sneedlock_position_lock_create` | `create_position_lock` succeeded. | `cid`, `caller`, `owner`, `pool`, `position_id`, `lock_id`, `expiry`, `token0`, `token1`, `dex` |
| `sneedlock_position_lock_extend` | `update_position_lock` moved the expiry later. | `cid`, `caller`, `owner`, `pool`, `position_id`, `lock_id`, `old_expiry`, `expiry` |
| `sneedlock_position_transfer` | `transfer_position_ownership` succeeded (liquid locking). | `cid`, `caller`, `from`, `to`, `pool`, `position_id`; plus `lock_id` and `expiry` when a lock moved with the position |
| `sneedlock_position_withdraw` | `transfer_position` moved the position out to ICPSwap. | `cid`, `caller`, `owner`, `to`, `pool`, `position_id` |
| `sneedlock_fees_claim` | `claim_position_fees` (or `request_claim_and_withdraw`) succeeded. | `cid`, `caller`, `owner`, `pool`, `position_id`, `token0`, `token1`, `amount0`, `amount1` (gross claimed), `delivered0`, `delivered1` (net of the ledger fee, what the pool delivers), `request_id` |
| `sneedlock_liquidity_add` | `add_liquidity_to_locked_position` returned `Ok`. | `cid`, `caller`, `owner`, `pool`, `position_id`, `token0`, `token1`, `amount0`, `amount1` (requested), `credited0`, `credited1`, `used0`, `used1`, `returned0`, `returned1`; `increase_error` (Text) when the pool refused and everything was returned |

Fees:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedlock_fee_pay` | The ICP lock fee was transferred out of the payer's payment subaccount. | `cid`, `caller`, `payer`, `lock_type` (`token` or `position`), `fee_e8s` (fee charged), `amount_e8s` (amount transferred: the fee minus the ICP ledger fee), `to` (account), `icp_tx` (ICP ledger block index) |

Admin and governance (only admins, governance or controllers can trigger these):

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedlock_admin_token_return` | `admin_return_token` or `admin_return_token_from_failed_request` succeeded. | `cid`, `caller`, `ledger`, `from` (account), `to` (account), `amount`, `ledger_tx` |
| `sneedlock_admin_token_rescue` | `admin_rescue_stuck_tokens` succeeded. | `cid`, `caller`, `ledger`, `to` (account), `amount`, `ledger_tx` |
| `sneedlock_admin_pool_deposit` | `admin_pool_deposit` succeeded. | `cid`, `caller`, `pool`, `ledger`, `amount`, `credited` |
| `sneedlock_admin_pool_withdraw` | `admin_withdraw_pool_balance_to_user` succeeded. | `cid`, `caller`, `pool`, `ledger`, `amount`, `user`, `accepted` |
| `sneedlock_config_update` | A setting changed. | `cid`, `caller`, `key`, `value` (Text or Nat), `old_value` when known |

`sneedlock_config_update` keys: `max_lock_length_ns`, `token_lock_fee_icp_e8s`, `position_lock_fee_icp_e8s`, `premium_token_lock_fee_icp_e8s`, `premium_position_lock_fee_icp_e8s`, `icp_fee_recipient`, `sneed_premium_canister_id`, `admin_added`, `admin_removed`, `claim_history_cleared`, `failed_claim_history_cleared`, and the log's own settings `icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`.

### 8.4 Verifying the log

1. Call `icrc3_get_tip_certificate`. Verify `certificate` against the IC root key for the lock canister (agent libraries do this: `Certificate.create` in `@dfinity/agent`). Look up `/canister/<canister_id>/certified_data` in it and check that it equals the root hash of `hash_tree`. Read `last_block_index` and `last_block_hash` from the tree.
2. Download blocks `0 … last_block_index` with `icrc3_get_blocks`, following `archived_blocks` callbacks for the archived ranges.
3. Recompute every block's hash. Block `i + 1` must carry `phash` equal to the hash of block `i`, and the hash of the last block must equal `last_block_hash`. Every `btype` must be one of `icrc3_supported_block_types`.

Everything a verifier needs is in the responses; no Sneed DAO service is involved. The following script does all three steps with its own hash implementation (Node.js, `@dfinity/agent` 2.x):

```js
import { createHash } from 'node:crypto';
import { HttpAgent, Actor, Certificate, Cbor, reconstruct, lookup_path, lookupResultToBuffer } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';

const SNEED_LOCK = Principal.fromText('pqsms-lqaaa-aaaal-ajjza-cai');
const Value = IDL.Rec();
Value.fill(IDL.Variant({ Blob: IDL.Vec(IDL.Nat8), Text: IDL.Text, Nat: IDL.Nat, Int: IDL.Int, Array: IDL.Vec(Value), Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)) }));
const GetBlocksArgs = IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat }));
const GetBlocksResult = IDL.Rec();
GetBlocksResult.fill(IDL.Record({
  log_length: IDL.Nat,
  blocks: IDL.Vec(IDL.Record({ id: IDL.Nat, block: Value })),
  archived_blocks: IDL.Vec(IDL.Record({ args: GetBlocksArgs, callback: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']) })),
}));
const idl = ({ IDL }) => IDL.Service({
  icrc3_get_blocks: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
  icrc3_get_tip_certificate: IDL.Func([], [IDL.Opt(IDL.Record({ certificate: IDL.Vec(IDL.Nat8), hash_tree: IDL.Vec(IDL.Nat8) }))], ['query']),
});

// ICRC-3 representation-independent hash
const sha256 = (b) => createHash('sha256').update(b).digest();
const leb128 = (n) => { n = BigInt(n); const out = []; do { let byte = Number(n & 0x7fn); n >>= 7n; if (n !== 0n) byte |= 0x80; out.push(byte); } while (n !== 0n); return Buffer.from(out); };
const sleb128 = (n) => { n = BigInt(n); const out = []; for (;;) { let byte = Number(n & 0x7fn); n >>= 7n; const sign = (byte & 0x40) !== 0; if ((n === 0n && !sign) || (n === -1n && sign)) { out.push(byte); return Buffer.from(out); } out.push(byte | 0x80); } };
function hashValue(v) {
  if ('Blob' in v) return sha256(Buffer.from(v.Blob));
  if ('Text' in v) return sha256(Buffer.from(v.Text, 'utf8'));
  if ('Nat' in v) return sha256(leb128(v.Nat));
  if ('Int' in v) return sha256(sleb128(v.Int));
  if ('Array' in v) return sha256(Buffer.concat(v.Array.map(hashValue)));
  const pairs = v.Map.map(([k, val]) => Buffer.concat([sha256(Buffer.from(k, 'utf8')), hashValue(val)]));
  pairs.sort(Buffer.compare);
  return sha256(Buffer.concat(pairs));
}
const field = (map, key) => map.Map.find(([k]) => k === key)?.[1];

const agent = await HttpAgent.create({ host: 'https://icp-api.io' });
const lock = Actor.createActor(idl, { agent, canisterId: SNEED_LOCK });

// 1. certified tip
const [tip] = await lock.icrc3_get_tip_certificate();
const cert = await Certificate.create({ certificate: new Uint8Array(tip.certificate).buffer, rootKey: agent.rootKey, canisterId: SNEED_LOCK });
const certified = Buffer.from(lookupResultToBuffer(cert.lookup(['canister', SNEED_LOCK.toUint8Array(), 'certified_data'])));
const tree = Cbor.decode(new Uint8Array(tip.hash_tree));
if (!certified.equals(Buffer.from(await reconstruct(tree)))) throw new Error('hash_tree does not match the certificate');
let lastIndex = 0n, shift = 0n;
for (const b of Buffer.from(lookupResultToBuffer(lookup_path(['last_block_index'], tree)))) { lastIndex |= BigInt(b & 0x7f) << shift; shift += 7n; }
const lastHash = Buffer.from(lookupResultToBuffer(lookup_path(['last_block_hash'], tree)));

// 2. all blocks, live and archived
const blocks = new Map();
const res = await lock.icrc3_get_blocks([{ start: 0n, length: lastIndex + 1n }]);
for (const b of res.blocks) blocks.set(b.id, b.block);
for (const { args, callback: [archiveId, method] } of res.archived_blocks) {
  const archive = Actor.createActor(({ IDL }) => IDL.Service({ [method]: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']) }), { agent, canisterId: archiveId });
  for (const b of (await archive[method](args)).blocks) blocks.set(b.id, b.block);
}

// 3. the chain
let prev = null;
for (let i = 0n; i <= lastIndex; i++) {
  const block = blocks.get(i);
  const phash = field(block, 'phash');
  if (i > 0n && !Buffer.from(phash.Blob).equals(prev)) throw new Error(`chain broken at block ${i}`);
  prev = hashValue(block);
}
if (!prev.equals(lastHash)) throw new Error('last block does not match the certified hash');
console.log(`verified ${lastIndex + 1n} blocks`);
```

The ranges above assume the whole log fits the response caps; for a long log, page `icrc3_get_blocks` in windows of 1000.

### 8.5 Using the log

- **Browse it:** [app.sneeddao.com/tools/icrc3?canister=pqsms-lqaaa-aaaal-ajjza-cai](https://app.sneeddao.com/tools/icrc3?canister=pqsms-lqaaa-aaaal-ajjza-cai) is a generic ICRC-3 browser with a purpose-built view for these blocks, pagination, tip verification and a raw view. It works for any ICRC-3 canister.

- **History of one lock:** scan the blocks and keep those whose `tx.lock_id` matches (create, extend, transfer, fee claims, liquidity additions, withdrawal). There is no server-side index; the log is small enough to fetch once and index client-side, and new blocks only ever append.
- **Proof for a token launch:** the create block, the certified tip and the chain between them prove when a lock was made and that it has not been withdrawn (a withdrawal would be a later block).
- **Monitoring:** poll `icrc3_log_status().log_length` and fetch only the new blocks since the last index you processed.
- **Joining with the text logs:** every action block's `tx.cid` is the `correlation_id` of the text log entries of the same call.

The log starts with this release; nothing before it is reconstructed except the import blocks that snapshot every lock that existed at that moment.

---

## 9. Integration checklist

- [ ] Use the **staging** canister `25fsc-7yaaa-aaaal-qjt5q-cai` first. It runs the same code with its own state; the ICPSwap pools and ledgers are the real mainnet ones.
- [ ] Derive the Sneed wallet account with `principalToSubAccount`; fetch the payment subaccount from the canister.
- [ ] Show users all three balances for a token (frontend, Sneed wallet, locked) or at least "available to lock" and "available to withdraw".
- [ ] For positions: claim → transfer → lock, in that order, and pass the pool's `token0`/`token1`.
- [ ] Check `getEffectiveLockFee` before a lock and fund the payment subaccount when needed; account for the 10_000 e8s ICP ledger fee on each transfer.
- [ ] Treat `Busy:` and `error_code = 2` as retry-after-a-moment, not as failures.
- [ ] Read lock state with `get_active_*` or `get_claimed_positions_for_principal`; never cache "locked" across the expiry.
- [ ] Link users to `https://app.sneeddao.com/lock/<lock_id>` for a public view of any lock, and to `https://app.sneeddao.com/sneedlock_info` for the overview.
- [ ] For audits or proofs, read the ICRC-3 activity log (section 8) and verify it from the certified tip rather than trusting any single response.

Questions, bugs, or an integration you would like listed here: open an issue on [GitHub](https://github.com/Snassy-icp/app_sneeddao/issues) or find Sneed DAO on [OpenChat](https://oc.app).
