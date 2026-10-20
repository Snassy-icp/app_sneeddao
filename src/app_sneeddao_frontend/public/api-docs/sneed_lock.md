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

Expiries are `nat64` nanoseconds since the Unix epoch, the same unit as `Time.now()` in Motoko and `BigInt(Date.now()) * 1_000_000n` in JavaScript. A lock must last at least the minimum and at most the maximum set by Sneed governance (`get_lock_limits()`; the canister answers `Minimum lock time not fulfilled.` or `Maximum lock time exceeded.` otherwise). For a lock with a dissolve delay the limits apply to lock period + delay.

### 1.4 Amounts

All amounts are base units of the ledger (`e8s` for ICP) as `nat`. Nothing is scaled by decimals inside the canister.

### 1.5 Dissolve delays

A lock may have a **dissolve delay**, like an NNS neuron. Its **lock period** (`lock_end`) is the earliest moment dissolving can start; once it has passed, the owner calls `start_dissolving`, and the lock is free when the delay has run out. Dissolving can be stopped (the time left becomes the delay again) and the delay can only grow. Three shapes:

| Lock period | Dissolve delay | Behaves like |
|---|---|---|
| y | 0 | A classic lock: free at `lock_end`. |
| 0 | x | A neuron: free x after the owner starts dissolving. |
| y | x | Vesting: no dissolving before `lock_end`, then x more. |

A lock with a delay that is not dissolving has no unlock time of its own: its record's `expiry` (the **effective expiry**, what every "is it locked?" check compares) is `18446744073709551615` (the largest `nat64`) until dissolving starts, and the dissolve end after. Show `earliest_unlock` from `get_lock_state` instead: the soonest the lock can be free (`max(lock_end, now) + delay` while not dissolving).

### 1.6 Locks are NFTs (ICRC-7, ICRC-37)

Every lock is an NFT in the Sneed Lock collection, on this same canister:
- **Position locks:** one NFT per position Sneed Lock holds that has been locked at least once; its token id is the lock id of the position's first lock (re-locking keeps it). Transferring it transfers the position, its lock and its unclaimed fees.
- **Token locks:** every live token lock; its token id is its lock id. Transferring it moves the locked tokens between Sneed wallets, which costs one ledger fee: from the owner's free balance in Sneed Lock, else from the lock's **gas tank**, an account anyone can top up (section 3.9).

The owner is the principal that owns the lock in Sneed Lock, plus a subaccount label, so NFT wallets and marketplaces can hold it in any account. Section 3.8 has the details.

### 1.7 Permissionless, but not anonymous

The canister identifies users only by the principal that signs the call. Any front end that can produce a signed call for the user, Internet Identity, Plug, OISY, NFID, a hardware wallet, a dfx identity, is a first-class client. The caveat for integrators is the flip side: a lock belongs to the principal that created it, so a user who logs into your product with a different principal than they use elsewhere will see different locks.

### 1.8 Calls the canister refuses at ingress

Before it accepts an update call from outside the IC, the canister checks it (its `inspect_message`), and a refused call costs nobody anything:

- **Query methods only answer query calls.** Calling one as an update call (for example `dfx canister call` with `--update`, or an IDL without the `query` annotation) is refused. Use the generated declarations, or `--query` with dfx.
- **Arguments are capped in size.** An update call's whole argument may be at most 4 KiB, far more than any real call needs. The ICRC-7/37 batch methods instead take at most `icrc7_max_update_batch_size` items (a canister calling with more gets `GenericBatchError`, as the standard says).

Canisters calling Sneed Lock are not affected: the check only applies to calls from outside the IC.

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
dfx canister --network ic call pqsms-lqaaa-aaaal-ajjza-cai get_lock_limits '()' --query
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
  const result = await sneedLock.create_lock(amount, Principal.fromText(ledgerId), expiresAtNs, []); // [] = no dissolve delay
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
  const r = await sneedLock.create_position_lock(pool, DEX_ICPSWAP, positionId, expiresAtNs, token0, token1, []);
  if ('Err' in r) throw new Error(r.Err.message);
  return r.Ok; // lock_id
}
```

If step 3 fails (for example the fee was not deposited), nothing is lost: the position sits in Sneed Lock with the user's claim on it, unlocked. The user can retry `create_position_lock` after fixing the cause, or take it back with `transfer_position`.

Reference: `executePositionLock` in [LockWizard.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/pages/LockWizard.jsx).

### 2.4 Read locks

Lists are paged: `get_lock_states_page` answers one `LockState` per lock, in ascending lock id, filtered by any of owner, ledger, pool, token, kind and status, at most 500 per call. Continue with `prev` = the last id until a page comes back short.

```js
// Every lock that is currently held, both kinds (query, no identity needed)
async function allLocks(filter = {}) {
  const out = [];
  let prev = [];
  for (;;) {
    const page = await sneedLock.get_lock_states_page({
      owner: [], ledger: [], swap_canister_id: [], token: [], kind: [], status: [{ Active: null }],
      include_archived: false, prev, take: [500n], ...filter,
    });
    out.push(...page);
    if (page.length < 500) return out;
    prev = [page[page.length - 1].lock_id];
  }
}
const held = await allLocks();

// One token: token locks of that ledger and position locks with it on either side, including history
const sneed = await allLocks({ token: [Principal.fromText('hvgxa-wqaaa-aaaaq-aacia-cai')], status: [], include_archived: true });

// One lock
const [state] = await sneedLock.get_lock_state(42n); // [] when there is no such lock
// { lock_id, kind, owner, owner_subaccount, ledger, amount, swap_canister_id, position_id, dex, token0, token1,
//   lock_end, dissolve_delay, dissolving_until, expiry, earliest_unlock, created_at, locked, archived }

// One user's positions held by Sneed Lock, with their lock if any
const mine = await sneedLock.get_claimed_positions_for_principal(me);
// [{ owner, swap_canister_id, position_id, position_lock: [] | [lock] }]
```

`locked` and the `Active` filter compare the effective expiry with the canister's clock at query time: the right source for "is this still locked?".

---

## 3. Flows in detail

### 3.1 Token locks

**Deposit.** Transfer to the Sneed wallet account. Any sender works, including another canister, an exchange withdrawal or a direct ledger call.

**Lock.** `create_lock(amount, ledger, expires_at, dissolve_delay)` checks, in order: expiry within bounds; Sneed wallet balance ≥ `amount`; balance ≥ existing active locks on that ledger + `amount`; fee deposit sufficient (section 4). It then records the lock and finally charges the fee. A lock that was recorded but whose fee transfer failed stays valid (the failure is logged for the DAO).

**While locked.** The tokens stay in the user's subaccount. `transfer_tokens` lets the user move only `balance − sum(active locks) − ledger fee`. Nothing else in the canister can move them.

**Expiry and housekeeping.** Expired locks are archived lazily: `create_lock`, `transfer_tokens`, `transfer_token_lock_ownership` and `clear_expired_locks` all archive the caller's expired token locks first. `has_expired_locks` tells a front end whether a `clear_expired_locks` call would do anything. Until archived, an expired lock still shows up in `get_token_locks` and in `get_lock_states_page` without `include_archived` (with `locked = false`), but it no longer blocks a transfer, because the transfer path archives it first. Archived locks remain readable through `get_lock_state`, `get_token_lock_by_id` and `get_lock_states_page` with `include_archived = true`.

**Withdraw.** `transfer_tokens(to_principal, to_subaccount, ledger, amount)` sends from the Sneed wallet to any account. The ledger fee is paid by the Sneed wallet on top of `amount`.

### 3.2 Position locks

**Prerequisite: the position is in the user's Sneed wallet.** For Sneed Lock, a position is "in the wallet" when the Sneed Lock canister owns it on ICPSwap **and** the user has a recorded claim on it. The claim is what maps the position back to its user; ICPSwap only sees the canister. The claim is recorded by `claim_position`, which asks the pool whether the caller owns the position at that moment. Hence the order in 2.3: claim, then transfer, then lock.

A position has **one** claimant. A successful `claim_position` removes any claim another principal holds on the same position (the pool has just said the caller owns it, so such a claim is left over from an earlier owner), and every position method requires the caller to be the only claimant.

What if a position is transferred to Sneed Lock without a claim? Nobody can act on it through the public API, because every position method requires the caller's claim. The DAO can recover it by proposal, but avoid the situation: claim first.

**Lock.** `create_position_lock(pool, dex, position_id, expires_at, token0, token1, dissolve_delay)`:
- `dex` must be `1` (ICPSwap). No other DEX is supported.
- The caller must have the claim and the pool must report Sneed Lock as the owner.
- `token0` and `token1` are **not validated** against the pool. They are stored on the lock and used by `claim_position_fees` and `add_liquidity_to_locked_position` to talk to the right ledgers. Pass the pool's `metadata().token0.address` and `token1.address`, in that order.
- Fee handling is the same as for token locks.
- Calling it for a position that already has a lock behaves like `update_position_lock`.

**Extend.** `update_position_lock(pool, position_id, expires_at)` moves the expiry later. An earlier expiry is refused (`New expiry is before current expiry.`). No fee.

**Withdraw after expiry.** `transfer_position(to, pool, position_id)` makes Sneed Lock call the pool's `transferPosition` to `to`, clears the claim and burns the position's NFT. While any lock on the position is active the call is refused with an `InternalError`. `to` may be the user's own principal or anyone else's.

**Housekeeping.** `has_expired_position_locks` / `clear_expired_position_locks` mirror the token versions. `transfer_position` and the lock calls archive expired position locks for the caller first.

### 3.3 Claiming trading fees from a locked position

A locked position keeps earning swap fees. `claim_position_fees(pool, position_id)`:

1. Requires the caller's claim and a lock record on the position. An expired lock still has its record until it is archived (`clear_expired_position_locks`, or the caller's next lock call or `transfer_position`), so its owner can still claim through Sneed Lock until then; the fees go only to the owner's own Sneed wallet, which they could take anyway.
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
- `transfer_position_ownership(to, pool, position_id)` moves the claim and the lock (if any) to `to`, and the position's NFT to `to`'s default account. No ICPSwap call is made; the canister stays the owner on the pool. Refused while a withdrawal of the position is in flight.
- A locked position can also move as an NFT, with `icrc7_transfer` or `icrc37_transfer_from` (3.8), to any account including a subaccount.
- A lock's dissolve state (lock period, delay, dissolving) belongs to the lock and moves with it.

The recipient does not need to have used Sneed Lock before.

### 3.6 Reading the Sneed wallet the way the reference wallet does

For a token the Sneed wallet shows:

- frontend balance: `icrc1_balance_of({ owner: P })`
- Sneed wallet balance: `icrc1_balance_of({ owner: sneed_lock, subaccount: wallet_subaccount(P) })`
- locked: `get_summed_locks()` entry for the ledger (caller-scoped)
- available to lock: frontend + Sneed wallet − locked
- available to withdraw: Sneed wallet − locked − one fee

For positions it calls `get_claimed_positions_for_principal(P)`, then asks each pool for the position's amounts. See `fetchBalancesAndLocks` in [Wallet.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/Wallet.jsx) and the positions loader in [WalletContext.jsx](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/contexts/WalletContext.jsx).

### 3.7 Dissolve delays

- **Create:** `create_lock` and `create_position_lock` take a last argument `dissolve_delay : opt nat64` (ns). With a delay, `expires_at` is the end of the lock period and may be `0` or in the past (no lock period). The limits apply to lock period + delay.
- **Start / stop:** `start_dissolving(lock_id)` once the lock period has ended; `stop_dissolving(lock_id)` turns the time left back into the delay.
- **Grow:** `increase_dissolve_delay(lock_id, additional_ns)` adds to the delay, also while dissolving (the end moves out); a plain lock can be given a delay this way. `extend_lock(lock_id, new_lock_end)` moves the lock period later, for token locks too; not while dissolving.
- **Owner only.** Each returns `Ok(LockState)` or `Err(LockOpError)`: `NotFound`, `NotOwner`, `InProgress` (a transfer of the lock is waiting on the ledger; retry), `Invalid(text)`.
- `update_position_lock` on a delay lock extends its lock period by the same rules.

### 3.8 Locked positions as NFTs (ICRC-7, ICRC-37)

The canister implements [ICRC-7](https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md) and [ICRC-37](https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md) for locks of both kinds (`icrc10_supported_standards` lists both).

- **Which tokens:** positions: one per position held that has been locked at least once; id = the position's first lock id; minted on the first lock (`7mint`), burned when the position is withdrawn (`7burn`); `get_position_nft(pool, position_id)` answers a position's token id. Token locks: every live token lock, id = its lock id; minted by `create_lock`, burned when the lock is archived after it unlocks (an unlocked lock that is not yet archived still has an owner but refuses to move, `GenericError` code 8).
- **Owner:** the position's claimant, plus a subaccount label. `icrc7_owner_of`, `icrc7_balance_of` and `icrc7_tokens_of` are per account. Every other method (claim fees, add liquidity, dissolve, withdraw) acts for the principal, whichever of its accounts holds the NFT.
- **Transfer:** `icrc7_transfer` from the holding account (`from_subaccount` must match the label). The position, its lock, its dissolve state and its **unclaimed fees** go with it. Free. Answers the ICRC-3 block index.
- **Approvals:** `icrc37_approve_tokens`, `icrc37_approve_collection`, the revokes, `icrc37_is_approved`, `icrc37_get_token_approvals`, `icrc37_get_collection_approvals`, `icrc37_transfer_from`. Token approvals are cleared by every transfer. A marketplace can be approved and pull the NFT into an escrow subaccount of its own in one call.
- **Refused while busy** (`GenericError`, code 3): a withdrawal of the position, or a fee claim or liquidity addition on its pool, is in flight; for a token lock, another token operation of its owner.
- **Token locks need gas** (`GenericError`, code 7, when neither the owner's free balance nor the lock's gas tank covers the ledger fee; nothing moves). A move between two accounts of one principal only changes the label and needs no gas. `transfer_token_lock_ownership` uses the same rules.
- **`created_at_time`:** within 24 h (+ 2 min drift); repeats within the window answer `Duplicate`.
- **Limits:** 10 updates per call, 100 ids per query, `take` up to 500, memo up to 32 bytes, 10 approvals per token and per account.
- **Metadata:** `icrc7:name` (`AAA/BBB LP lock`, or `1,000 SNEED lock`), `icrc7:description`, `icrc7:image` (an SVG data URL drawn on the fly), and `sneedlock:*` fields: `kind` (`position` or `token`), then `swap`, `position_id`, `token0`, `token1`, `dex`, `minted_at` for positions, or `ledger`, `amount`, `gas_owner`, `gas_subaccount`, `transfer_fee` for token locks, and for both `lock_id`, `lock_end`, `dissolve_delay`, `dissolving_until`, `earliest_unlock`, `locked`.

### 3.9 Gas for token-lock NFTs

- **The fee:** moving a token lock to another principal is a ledger transfer of its amount between Sneed wallets; the ledger charges one fee to the sender. Sneed Lock takes it from the owner's **free balance** (Sneed wallet beyond everything locked there), else from the lock's **gas tank**, which first sends one fee to the owner's wallet (so the tank pays two fees per transfer). With neither the transfer is refused. The locked amount never changes.
- **The gas tank** is `{ owner = sneed_lock; subaccount = gas_subaccount(lock_id) }`: byte 0 = `0xFE`, bytes 1-3 = `"GAS"`, bytes 24-31 = the lock id big-endian, zero elsewhere. `get_lock_gas(lock_id)` answers `{ account; ledger; transfer_fee }`.
- **Anyone can top it up**, owner or not, with a plain `icrc1_transfer` of the lock's token to that account, like topping up a canister's cycles. Gas is a gift to the lock's current owner; it travels with the lock.
- **Taking it back:** `withdraw_lock_gas(lock_id, to)`, the owner only (the last owner once the lock is archived), sends the tank's balance less one fee.

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
| `get_lock_states_page(LockPageQuery)` | `vec LockState` | Every lock list, paged: filter by `owner`, `ledger`, `swap_canister_id`, `token` (a ledger: token locks of it, position locks with it as `token0` or `token1`), `kind`, `status` (`Active` = held and not archived; `Expired` = archived or no longer held), `include_archived`. Ascending lock id after `prev`, `take` 100 by default, 500 at most. |
| `get_lock_state(lock_id)` | `opt LockState` | One lock, live or archived, with its dissolve state, `earliest_unlock` and `created_at`. |
| `get_lock_states(vec lock_id)` | `vec opt LockState` | Up to 100 at once. |
| `get_lock_limits()` | `LockLimits` | Minimum and maximum of lock period + delay, in ns. |
| `get_lock_by_id(lock_id)` | `opt LockInfo` | Either kind, archived first then live (the record, without dissolve state). |
| `get_token_lock_by_id(lock_id)` | `opt FullyQualifiedLock` | Archived first, then live. |
| `get_position_lock_by_id(lock_id)` | `opt FullyQualifiedPositionLock` | Archived first, then live. |
| `get_lock_type(lock_id)` | `opt LockType` | `TokenLock` or `PositionLock`. |
| `get_claimed_positions_for_principal(owner)` | `vec ClaimedPosition` | Positions `owner` has a claim on, each with `position_lock` (`[]` when not locked; an expired lock stays until archived). |
| `get_position_nft(pool, position_id)` | `opt nat` | The position's NFT id. |
| `get_lock_gas(lock_id)` | `opt record { account; ledger; transfer_fee : opt nat }` | A token lock's gas tank (3.9). |

`FullyQualifiedLock` is the tuple `(owner, ledger, Lock)`; `FullyQualifiedPositionLock` is `(owner, pool, PositionLock)`. In JavaScript these arrive as arrays `[owner, ledger, lock]`.

### 6.2 Caller-scoped queries

| Method | Returns | Notes |
|---|---|---|
| `get_summed_locks()` | `vec (ledger, Balance)` | Sum of the caller's live token locks per ledger (expired-but-unarchived locks count until archived). |
| `get_token_locks()` | `vec (LockId, ledger, Balance, Expiry)` | The caller's live token lock records. |
| `get_position_ownerships()` | `vec (pool, PositionId)` | Positions the caller has a claim on. |
| `has_expired_locks()` | `bool` | True if `clear_expired_locks` would archive something. |
| `has_expired_position_locks()` | `bool` | Same for position locks. |
| `get_my_claim_history()` | `vec ClaimRequest` | Completed and failed fee-claim records of the caller (see 6.11). |

### 6.3 Token locks (updates)

**`create_lock(amount : nat, icrc1_ledger_canister_id : principal, expires_at : Expiry, dissolve_delay : opt nat64) → CreateLockResult`**
Locks `amount` of the token in the caller's Sneed wallet until `expires_at`, or with a dissolve delay (3.7). Returns `Ok(lock_id)`. Errors (`Err.message`): `Minimum lock time not fulfilled.`, `Maximum lock time exceeded.`, `Insufficient balance to lock ...`, `Insufficient unlocked balance to lock ...`, `ICP payment verification failed: ...`. Side effects: archives the caller's expired token locks; charges the fee from the payment subaccount after recording the lock.

**`transfer_tokens(to_principal : principal, to_subaccount : opt blob, icrc1_ledger_canister_id : principal, amount : nat) → TransferResult`**
Sends `amount` from the caller's Sneed wallet to `{ to_principal; to_subaccount }`; the Sneed wallet also pays the ledger fee. Refuses when `balance < amount + fee + sum(active locks)` (`GenericError`, `error_code = 1`) or when another token operation of the caller is running (`error_code = 2`). Returns the ledger block index on success. Also used to withdraw claimed fees and add-liquidity refunds, and to fund the payment subaccount from the Sneed wallet.

**`transfer_token_lock_ownership(to_principal : principal, token_type : principal, lock_id : nat) → TransferTokenLockOwnershipResult`**
Liquid locking for tokens, see 3.5. Errors: `A token operation is already in progress for ...`, `Lock N not found for ...`, `Lock N has expired. ...`, `Inconsistent lock state. ...`, `This lock needs gas: ...` (neither the caller's free balance nor the lock's gas tank covers the ledger fee, 3.9), or a ledger `transfer_error`. If the ledger call fails with an unknown outcome the lock is kept on both parties until the DAO reconciles; the message says so.

**`clear_expired_locks() → ()`** archives the caller's expired token locks.

### 6.4 Positions (updates)

**`claim_position(swap_canister_id : principal, position_id : nat) → bool`**
Records that the caller owns `position_id` in `swap_canister_id`, after confirming it with the pool's `getUserPositionIdsByPrincipal(caller)`, and removes any other principal's claim on it (3.2). Idempotent. `false` means the pool did not list the caller as owner (or could not be reached).

**`create_position_lock(swap_canister_id : principal, dex : nat, position_id : nat, expires_at : Expiry, token0 : principal, token1 : principal, dissolve_delay : opt nat64) → CreateLockResult`**
See 3.2 and 3.7. Mints the position's NFT on its first lock. `dex` must be `1`. Errors: lock time bounds, `Position not claimed by caller.`, `Position is not transferred to this canister.`, `Dex not supported.`, `ICP payment verification failed: ...`. If the position already has a lock, behaves as `update_position_lock`; passing a dissolve delay for a position that is already locked is refused (`This position is already locked; use increase_dissolve_delay ...`).

**`update_position_lock(swap_canister_id : principal, position_id : nat, expires_at : Expiry) → CreateLockResult`**
Extends an existing lock. Errors as above plus `New expiry is before current expiry.`. No fee. Returns the existing `lock_id`.

**`transfer_position(to : principal, swap_canister_id : principal, position_id : nat) → TransferPositionResult`**
Withdraws the position from Sneed Lock to `to` on ICPSwap, clears the caller's claim and burns its NFT. Refused while any lock on the position is active (`err.InternalError`). Also refused when the caller has no claim or the pool does not list Sneed Lock as the owner. The pool's own error is passed through on failure.

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

### 6.8 Dissolve delays and gas

All are updates for the lock's owner and return `LockOpResult` (`Ok(LockState)` or `Err(LockOpError)`), except `withdraw_lock_gas`. See 3.7 and 3.9.

| Method | Notes |
|---|---|
| `start_dissolving(lock_id)` | Refused (`Invalid`) with `The lock has no dissolve delay.`, `The lock is already dissolving.`, `Dissolving can start when the lock period ends.` |
| `stop_dissolving(lock_id)` | The time left becomes the delay again. `Invalid`: `The lock is not dissolving.`, `The lock has finished dissolving.` |
| `increase_dissolve_delay(lock_id, additional_ns : nat64)` | Also while dissolving. `Invalid`: `The increase must be more than zero.`, `The lock is no longer locked.`, `Maximum lock time exceeded.` |
| `extend_lock(lock_id, new_lock_end : Expiry)` | Moves the lock period's end later, either kind. `Invalid`: `A dissolving lock cannot be extended; stop dissolving first.`, `New expiry is not after the current one.`, `The lock period cannot end in the past.`, `Maximum lock time exceeded.` |
| `get_lock_gas(lock_id)` *query* | A token lock's gas tank account, ledger and last seen ledger fee; null for other ids. |
| `withdraw_lock_gas(lock_id, to : Account) → variant { Ok : nat; Err : text }` | Sends the tank's balance less one ledger fee to `to`; answers the ledger block index. Errors: `No such token lock`, `Only the lock's owner can take its gas back`, `A token operation is in progress; try again shortly`, `A transfer of this lock is awaiting reconciliation`, `The gas tank holds N, not more than one ledger fee (F)`, `The ledger refused: ...`, `The ledger call failed: ...`. |

`InProgress` means a transfer of the lock is waiting on the ledger; retry shortly.

### 6.9 NFT methods (ICRC-7, ICRC-37)

The standard methods, with the semantics in 3.8. Queries: `icrc7_name`, `icrc7_symbol`, `icrc7_description`, `icrc7_logo`, `icrc7_collection_metadata`, `icrc7_total_supply`, `icrc7_supply_cap`, `icrc7_max_query_batch_size` (100), `icrc7_max_update_batch_size` (10), `icrc7_default_take_value` (100), `icrc7_max_take_value` (500), `icrc7_max_memo_size` (32), `icrc7_atomic_batch_transfers`, `icrc7_tx_window` (24 h), `icrc7_permitted_drift` (2 min), `icrc7_token_metadata(ids)`, `icrc7_owner_of(ids)`, `icrc7_balance_of(accounts)`, `icrc7_tokens(prev, take)`, `icrc7_tokens_of(account, prev, take)`, `icrc37_metadata`, `icrc37_max_approvals_per_token_or_collection` (10), `icrc37_max_revoke_approvals` (10), `icrc37_is_approved(args)`, `icrc37_get_token_approvals(token_ids, prev, take)`, `icrc37_get_collection_approvals(owner, prev, take)`, `icrc10_supported_standards`. Updates: `icrc7_transfer`, `icrc37_approve_tokens`, `icrc37_approve_collection`, `icrc37_revoke_token_approvals`, `icrc37_revoke_collection_approvals`, `icrc37_transfer_from`.

Sneed Lock's `GenericError` codes on transfers: `3` busy (a withdrawal, fee claim or liquidity addition in flight, or another token operation of the owner), `7` a token lock needs gas, `8` the lock has unlocked and can no longer be transferred, `9` lock not found or a ledger failure while moving a token lock. A memo over 32 bytes answers `GenericError` code `2`; more than 10 items per call answers `GenericBatchError` code `1`.

### 6.10 Logs

`get_info_id_range()`, `get_error_id_range()`, `get_info_entries(start, length)`, `get_error_entries(start, length)` expose the canister's circular text logs (`BufferEntry { id; timestamp; caller; correlation_id; content }`). Every update logs under a `correlation_id`; error messages that mention one can be looked up here. These are update calls, the buffers hold the last 10,000 entries each, and they record failures as well as successes.

The structured, permanent and verifiable record of what actually happened is the ICRC-3 activity log in [section 8](#8-activity-log-icrc-3); its blocks carry the same `correlation_id` as `cid`, so the two can be joined.

### 6.11 Compatibility and retired methods

The fee-claim queue of earlier versions is gone; claims are synchronous now. These remain for older clients:

| Method | Behaviour today |
|---|---|
| `request_claim_and_withdraw(pool, position_id)` | Performs `claim_position_fees` and returns `Ok(request_id)`. |
| `get_claim_request_status(request_id)` | `Completed` or `Failed` record for a request id, or null. Never `Active`. |
| `get_completed_claim_request(id)`, `get_failed_claim_request(id)` | Lookups in the history. |
| `get_claim_requests_page({ failed; prev; take })` | The completed (or failed) history, paged by request id. |

New integrations should use `claim_position_fees`.

**Removed in v2** (their replies grew with every lock; there were no integrators yet): `get_all_token_locks`, `get_active_token_locks`, `get_expired_token_locks`, `get_ledger_token_locks`, `get_all_position_locks`, `get_active_position_locks`, `get_expired_position_locks`, `get_swap_position_locks`, `get_token_position_locks`, `get_all_active_claim_requests`, `get_all_completed_claim_requests`, `get_all_failed_claim_requests`. Use `get_lock_states_page` and `get_claim_requests_page`. `get_info_entries` / `get_error_entries` answer at most 500 entries per call.

### 6.12 Admin and governance

Restricted to Sneed governance, the canister's controllers and listed admins (`get_admin_list()`, a public query). They exist for recovery, fee configuration, premium wiring and log maintenance; integrators never call them. Each is listed here with what it does:

| Method | Purpose |
|---|---|
| `set_max_lock_length_days(days)` | Sets the maximum lock length (traps for non-admins). |
| `admin_add_admin(p)`, `admin_remove_admin(p)` | Manage the admin list. |
| `admin_set_lock_fees_icp(token, position, premium_token, premium_position)` | Set the ICP lock fees (each `opt nat64`, null keeps the value). |
| `admin_set_icp_fee_recipient(principal, subaccount)` | Where collected lock fees go (null: this canister). |
| `admin_set_sneed_premium_canister_id(opt principal)` | The Sneed Premium canister used for premium fees. |
| `admin_get_payment_log(offset, limit)`, `admin_get_payment_log_count()` | Read the fee payment log. |
| `admin_return_token(ledger, amount, user)` | Send `amount` from `user`'s Sneed wallet to `user`'s default account. |
| `admin_return_token_from_failed_request(ledger, amount, recipient)` | Send `amount` from the canister's main account to `recipient`'s default account. |
| `admin_rescue_stuck_tokens(ledger, recipient)` | Send the canister main account's balance of a token (stuck outside any user's wallet) to `recipient`. |
| `admin_get_pool_unused_balance(pool)`, `admin_pool_deposit(pool, ledger, amount)`, `admin_withdraw_pool_balance_to_user(pool, ledger, amount, user)` | Inspect and move the canister's unused balances inside an ICPSwap pool (refunds after a failed add-liquidity). |
| `admin_clear_completed_claim_requests()`, `admin_clear_failed_claim_requests()` | Clear the fee-claim history. |
| `admin_set_icrc3_settings(SettingsUpdate)` | Tune the ICRC-3 log (live block cap, spill batch, archive size and cycles). |
| `admin_icrc3_spill_now()` | Move old blocks to archives now. |
| `admin_icrc3_import_history()` | The one-time import of pre-log state (no-op once done). |
| `admin_set_icrc3_proposal_neuron(opt blob)` | The SNS neuron that submits archive registration proposals. |
| `admin_icrc3_register_archives_now()`, `admin_icrc3_reset_archive_registration(archive)`, `admin_icrc3_repair_archive_controllers()` | Archive registration with the SNS and controller repair. |

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

// v2
type LockState = record {
  lock_id : LockId; kind : LockType; owner : principal;
  owner_subaccount : opt blob;           // the NFT's subaccount label (null = default account)
  ledger : opt TokenType; amount : opt Balance;                       // token locks
  swap_canister_id : opt SwapCanisterId; position_id : opt PositionId; dex : opt Dex;
  token0 : opt TokenType; token1 : opt TokenType;                     // position locks
  lock_end : Expiry;                     // end of the lock period
  dissolve_delay : nat64;                // 0 = none
  dissolving_until : opt Expiry;         // set while dissolving or once dissolved
  expiry : Expiry;                       // the effective expiry (max nat64 = until it dissolves)
  earliest_unlock : Expiry;              // the soonest it can be free
  created_at : opt nat64;                // null for locks older than the activity log
  locked : bool; archived : bool;
};
type LockStatusFilter = variant { Active; Expired };
type LockPageQuery = record {
  owner : opt principal; ledger : opt TokenType; swap_canister_id : opt SwapCanisterId;
  token : opt TokenType; kind : opt LockType; status : opt LockStatusFilter;
  include_archived : bool; prev : opt LockId; take : opt nat;
};
type LockLimits = record { min_lock_length_ns : nat64; max_lock_length_ns : nat64 };
type LockOpError = variant { NotFound; NotOwner; InProgress; Invalid : text };
type LockOpResult = variant { Ok : LockState; Err : LockOpError };
type ClaimRequestPageQuery = record { failed : bool; prev : opt nat; take : opt nat };
```

The ICRC-7 and ICRC-37 types are the standards' own. The full interface, including admin and log types, is in [sneed_lock.did](/api-docs/sneed_lock.did).

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
| `icrc3_registration_status()` | query | Per archive, the id of the SNS proposal that registered it as a DAO canister (Sneed Lock submits one automatically through a hotkeyed neuron), or the failed attempts so far. Sneed Lock specific. |

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

Sneed Lock's own types carry the `sneedlock_` prefix. ICRC numbers are reserved for ICRC standards, so a letter prefix cannot collide with any of them. The NFT blocks use the standard ICRC-7 and ICRC-37 types (see the end of this section). Housekeeping (archiving expired locks) is not logged: expiry follows from the `expiry` field of the create block.

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
| `sneedlock_token_lock_create` | `create_lock` succeeded. | `cid`, `caller`, `owner`, `ledger`, `lock_id`, `amount`, `expiry` (the lock period's end as given); `dissolve_delay` when it has one |
| `sneedlock_token_lock_transfer` | `transfer_token_lock_ownership` or an NFT transfer moved the lock and its tokens. | `cid`, `caller`, `from`, `to`, `ledger`, `lock_id`, `amount`, `expiry`, `ledger_tx` (ledger block index), `outcome` = `ok`, `gas_source` (`owner` or `tank`), `fee`. When the ledger call threw with an ambiguous code the block has `outcome` = `uncertain` and no `ledger_tx`: the lock is then held for both parties until reconciled. |
| `sneedlock_token_withdraw` | `transfer_tokens` moved tokens out of the caller's Sneed wallet. | `cid`, `caller`, `ledger`, `amount`, `to` (account), `ledger_tx` |

Positions:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedlock_position_claim` | `claim_position` verified ownership on ICPSwap and mapped the position to the caller. | `cid`, `caller`, `owner`, `pool`, `position_id`; `removed_claims` (array of principals) when it replaced claims left by earlier owners |
| `sneedlock_position_lock_create` | `create_position_lock` succeeded. | `cid`, `caller`, `owner`, `pool`, `position_id`, `lock_id`, `expiry`, `token0`, `token1`, `dex`; `dissolve_delay` when it has one |
| `sneedlock_position_lock_extend` | `update_position_lock` moved the expiry later. | `cid`, `caller`, `owner`, `pool`, `position_id`, `lock_id`, `old_expiry`, `expiry` |
| `sneedlock_position_transfer` | `transfer_position_ownership` succeeded (liquid locking). | `cid`, `caller`, `from`, `to`, `pool`, `position_id`; plus `lock_id` and `expiry` when a lock moved with the position |
| `sneedlock_position_withdraw` | `transfer_position` moved the position out to ICPSwap. | `cid`, `caller`, `owner`, `to`, `pool`, `position_id` |
| `sneedlock_fees_claim` | `claim_position_fees` (or `request_claim_and_withdraw`) succeeded. | `cid`, `caller`, `owner`, `pool`, `position_id`, `token0`, `token1`, `amount0`, `amount1` (gross claimed), `delivered0`, `delivered1` (net of the ledger fee, what the pool delivers), `request_id` |
| `sneedlock_liquidity_add` | `add_liquidity_to_locked_position` returned `Ok`. | `cid`, `caller`, `owner`, `pool`, `position_id`, `token0`, `token1`, `amount0`, `amount1` (requested), `credited0`, `credited1`, `used0`, `used1`, `returned0`, `returned1`; `increase_error` (Text) when the pool refused and everything was returned |

Dissolve delays (one block per change, logged by the canister):

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedlock_dissolve_start` | `start_dissolving` | `cid`, `caller`, `owner`, `lock_id`, `kind` (`token` or `position`), `ledger` or `pool`, `old_expiry` and `expiry` (the effective expiry before and after), `lock_end`, `dissolve_delay`; `dissolving_until` while dissolving |
| `sneedlock_dissolve_stop` | `stop_dissolving` | same fields |
| `sneedlock_dissolve_delay_increase` | `increase_dissolve_delay` | same fields |
| `sneedlock_token_lock_extend` | `extend_lock` on a token lock | same fields (`extend_lock` on a position lock logs `sneedlock_position_lock_extend`) |
| `sneedlock_gas_withdraw` | `withdraw_lock_gas` | `cid`, `caller`, `lock_id`, `ledger`, `amount`, `to` (account), `ledger_tx` |

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

`sneedlock_config_update` keys: `max_lock_length_ns`, `token_lock_fee_icp_e8s`, `position_lock_fee_icp_e8s`, `premium_token_lock_fee_icp_e8s`, `premium_position_lock_fee_icp_e8s`, `icp_fee_recipient`, `sneed_premium_canister_id`, `admin_added`, `admin_removed`, `claim_history_cleared`, `failed_claim_history_cleared`, `icrc3_proposal_neuron` (the SNS neuron that submits archive registration proposals; value is its 32-byte id as a Blob, or the text `none`), and the log's own settings `icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`.

NFTs (the standard block types of [ICRC-7](https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md) and [ICRC-37](https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md); accounts as `[owner, subaccount?]`):

| `btype` | When | `tx` fields |
|---|---|---|
| `7mint` | A lock's NFT was created: a position's first lock or a new token lock, or once for every lock when NFTs were introduced. | `tid`, `to`, `meta` (`sneedlock:kind`, `sneedlock:swap` and `sneedlock:position_id` or `sneedlock:ledger`, `sneedlock:minted_by` = `lock` or `activation`) |
| `7burn` | The position was withdrawn, or the token lock was archived after unlocking. | `tid`, `from` |
| `7xfer` | `icrc7_transfer`, or `transfer_position_ownership` / `transfer_token_lock_ownership` of a lock (which also log their own `sneedlock_*` block first). | `tid`, `from`, `to`; `memo`, `ts` when given |
| `37approve` / `37approve_coll` | A token / collection approval. | `tid` (token only), `from`, `spender`, `ts`; `exp` when given |
| `37revoke` / `37revoke_coll` | A revocation. | `tid` (token only), `from`; `spender` when one was named |
| `37xfer` | `icrc37_transfer_from`. | `tid`, `spender`, `from`, `to`; `memo`, `ts` when given |

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
- [ ] Read lock state with `get_lock_state` / `get_lock_states_page` (paged) or `get_claimed_positions_for_principal`; never cache "locked" across the expiry, and show `earliest_unlock` for locks with a dissolve delay.
- [ ] Link users to `https://app.sneeddao.com/lock/<lock_id>` for a public view of any lock, and to `https://app.sneeddao.com/sneedlock_info` for the overview.
- [ ] For audits or proofs, read the ICRC-3 activity log (section 8) and verify it from the certified tip rather than trusting any single response.

Questions, bugs, or an integration you would like listed here: open an issue on [GitHub](https://github.com/Snassy-icp/app_sneeddao/issues) or find Sneed DAO on [OpenChat](https://oc.app).
