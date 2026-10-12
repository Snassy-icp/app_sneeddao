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

`get_info_id_range()`, `get_error_id_range()`, `get_info_entries(start, length)`, `get_error_entries(start, length)` expose the canister's circular logs (`BufferEntry { id; timestamp; caller; correlation_id; content }`). Every update logs under a `correlation_id`; error messages that mention one can be looked up here. These are update calls.

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

## 8. Integration checklist

- [ ] Use the **staging** canister `25fsc-7yaaa-aaaal-qjt5q-cai` first. It runs the same code with its own state; the ICPSwap pools and ledgers are the real mainnet ones.
- [ ] Derive the Sneed wallet account with `principalToSubAccount`; fetch the payment subaccount from the canister.
- [ ] Show users all three balances for a token (frontend, Sneed wallet, locked) or at least "available to lock" and "available to withdraw".
- [ ] For positions: claim → transfer → lock, in that order, and pass the pool's `token0`/`token1`.
- [ ] Check `getEffectiveLockFee` before a lock and fund the payment subaccount when needed; account for the 10_000 e8s ICP ledger fee on each transfer.
- [ ] Treat `Busy:` and `error_code = 2` as retry-after-a-moment, not as failures.
- [ ] Read lock state with `get_active_*` or `get_claimed_positions_for_principal`; never cache "locked" across the expiry.
- [ ] Link users to `https://app.sneeddao.com/lock/<lock_id>` for a public view of any lock, and to `https://app.sneeddao.com/sneedlock_info` for the overview.

Questions, bugs, or an integration you would like listed here: open an issue on [GitHub](https://github.com/Snassy-icp/app_sneeddao/issues) or find Sneed DAO on [OpenChat](https://oc.app).
