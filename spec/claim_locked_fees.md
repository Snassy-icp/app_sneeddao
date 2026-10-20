# SneedLock Claim and Withdraw API

**Status (2026-10-20): rebuilt.** The queue described in the first version of this document
was retired on 2026-10-11 (commit ff3146c3). Claims are now one synchronous call that uses
ICPSwap's `claimToSubaccount`; the pool delivers the fees straight to the owner's Sneed wallet.
This document describes the current code (`claim_position_fees` and its helpers in
`src/sneed_lock/main.mo`). Changed from the original plan: no queue, no timer, no batch pauses,
no balance-before/after accounting, no admin queue controls; see "Changelog".

## Overview

The SneedLock canister lets the owner of a locked ICPSwap position claim the position's trading fees while it stays locked. Sneed Lock asks the pool to claim the fees **to the owner's subaccount on Sneed Lock** (the owner's Sneed wallet, also called the backend wallet), so the fees never pass through an account Sneed Lock shares with anyone. That is what makes the old sequential queue unnecessary.

## Key Features

- ✅ **One call** - `claim_position_fees` claims and answers the amounts; no polling of a request
- ✅ **Direct delivery** - the pool sends the fees to the owner's wallet subaccount on SneedLock itself, from its own withdraw queue, usually within seconds
- ✅ **No commingling** - fees never land in an account shared between positions, so no balance tracking is needed
- ✅ **Smart Validation** - refuses when neither side is worth delivering (would be swallowed by the ledger fee)
- ✅ **Per-pool serialisation** - one fee claim or liquidity addition per pool at a time; others get a "Busy" error and retry
- ✅ **Bounded history** - the last 1000 completed and the last 1000 failed claims, plus a `sneedlock_fees_claim` ICRC-3 block per claim

## Prerequisites

Before you can claim rewards:
1. Position must have a **position lock record** for the caller (active, or expired but not yet archived)
2. Position must be **owned by the SneedLock canister** on ICPSwap
3. Caller must be the **only claimant** of the position in SneedLock's records
4. At least one token must have **more than its transaction fee** in claimable rewards

## API Methods

### 1. Claim Position Fees

```motoko
public shared ({ caller }) func claim_position_fees(
  swap_canister_id : Principal,
  position_id : Nat
) : async {
  #Ok : { request_id : Nat; amount0 : Nat; amount1 : Nat; token0 : Principal; token1 : Principal };
  #Err : Text;
}
```

`amount0` / `amount1` are the gross amounts the pool claimed. What arrives in the wallet is each amount minus one ledger fee (nothing for an amount at or below the fee).

**Example:**
```motoko
switch (await sneed_lock.claim_position_fees(swap_canister, position_id)) {
  case (#Ok(r)) { Debug.print("Claimed " # debug_show(r.amount0) # " / " # debug_show(r.amount1)) };
  case (#Err(msg)) { Debug.print("Failed: " # msg) };
};
```

**Validation performed:**
- Caller is the only claimant of the position
- Caller has a lock record on the position (token0 and token1 are read from it)
- No other fee claim or liquidity addition is running on the same pool

### 2. Request Claim and Withdraw (compatibility)

```motoko
public shared ({ caller }) func request_claim_and_withdraw(
  swap_canister_id : Principal,
  position_id : Nat
) : async { #Ok : Nat; #Err : Text }
```

Kept for older frontends. It performs the same synchronous claim and answers the history id (`request_id`), which `get_claim_request_status` then reports as completed or failed.

### 3. Query Request Status

```motoko
public query func get_claim_request_status(request_id : Nat) : async ?{
  #Active : ClaimRequest;    // never answered any more; kept for interface compatibility
  #Completed : ClaimRequest;
  #Failed : ClaimRequest;
}
```

Searches the completed and failed history. Changed from the original plan: `#Completed` carries the request record, not text, and there is a `#Failed` case.

Also: `get_completed_claim_request(id)` and `get_failed_claim_request(id)`.

### 4. History

```motoko
public query ({ caller }) func get_my_claim_history() : async [ClaimRequest]   // caller's completed and failed claims
public query func get_claim_requests_page(q : {
  failed : Bool;      // the failed history, else the completed one
  prev : ?Nat;        // ascending request ids after this one
  take : ?Nat;        // default 100, at most 500
}) : async [ClaimRequest]
```

Changed from the original plan: `get_my_active_claim_requests` and `get_claim_queue_status` no longer exist.

## Request Lifecycle

### Status Flow

A claim record is created with `#Processing` and archived when the call ends, in one of two terminal states:

```
#Processing
  ↓
#Completed { amount0_claimed, amount1_claimed, amount0_transferred, amount1_transferred,
             transfer0_tx_id = null, transfer1_tx_id = null }
  or
#Failed(Text)
```

`amountN_transferred` is the amount the pool delivers (claimed minus one ledger fee, or 0). The tx ids are always null: the pool performs the ledger transfers.

The other variants of `ClaimRequestStatus` (`#Pending`, `#BalanceRecorded`, `#ClaimAttempted`, `#ClaimVerified`, `#Withdrawn`, `#TimedOut`) are kept in the type for stable compatibility and old history entries; new claims never use them.

### Processing Details

#### Step 0: Validation
- Get the ledger fee of both tokens (`icrc1_fee`)
- Read the position's `tokensOwed0` and `tokensOwed1` (`getUserPosition`)
- Fail with "Insufficient rewards to claim..." if neither side exceeds its fee

#### Step 1: Claim
- Call `claimToSubaccount({ positionId; subaccount })` on the pool, with the caller's wallet subaccount on Sneed Lock
- On `#ok`: record the claim as `#Completed`, log `sneedlock_fees_claim`, answer the amounts
- On `#err` or a thrown call: record `#Failed`. A thrown call has an unknown outcome; either way Sneed Lock never holds the funds, and the pool either rolled back or will still deliver to the owner's subaccount

#### Step 2: Delivery (by the pool)
- The pool's withdraw queue transfers each amount above the fee to the owner's wallet subaccount
- Amounts at or below the fee stay in Sneed Lock's account on the pool as dust; Sneed Lock notes them so later add-liquidity checks are not confused

## Fee Handling

### Transaction Fees

The pool charges the ledger fee on delivery:

```
Token0 Fee: 10 tokens
Claimed: 1000 tokens

Delivery:
- Amount delivered: 990 tokens
- Fee charged: 10 tokens
- User receives: 990 tokens in their Sneed wallet subaccount
```

### Minimum Claimable Amount

A side is worth claiming when it is **more than 1x its transaction fee** (one fee is consumed by the delivery). Changed from the original plan: this document said 2x (one fee for the claim, one for the withdrawal); the code never required more than 1x, and with `claimToSubaccount` only one fee is charged.

**Examples:**

✅ **Sufficient:**
```
Token0: 1000 owed, fee = 10 (1000 > 10) → delivers 990
Token1: 500 owed, fee = 5 (500 > 5) → delivers 495
```

✅ **One token insufficient:**
```
Token0: 1000 owed, fee = 10 → delivers 990
Token1: 4 owed, fee = 5 (4 <= 5) → claimed, not delivered (dust on the pool)
Status: Completed
```

❌ **Both insufficient:**
```
Token0: 10 owed, fee = 10 (10 <= 10)
Token1: 5 owed, fee = 5 (5 <= 5)
Status: Failed immediately, nothing claimed
```

## Queue Processing

Changed from the original plan: there is no queue. The retired stable variables (`stable_claim_requests`, `claim_queue_processing_state`, `enforce_zero_balance_before_claim`, the timer and batch counters) are kept with their types so the stable signature does not change, and nothing reads or writes them.

### Concurrency

- Claims and liquidity additions take a per-pool lock (`pool_op_locks`). A second operation on the same pool while one is awaiting the pool fails with `Busy: another operation is in progress on this pool; please retry in a few seconds`.
- While a pool operation is running, an NFT transfer of a position in that pool is refused (`GenericError` 3), so a sale cannot race a fee claim.
- Different pools run in parallel.

### Why no commingling check is needed

The old design claimed into Sneed Lock's own (shared) pool balance and had to attribute the increase to one position, hence the sequential queue, balance snapshots and the zero-balance safety check. With `claimToSubaccount` the pool sends each owner's fees to that owner's subaccount, so there is nothing to attribute.

## Error Handling

### Common Errors

**"Caller does not own position X on swap canister Y"**
- No claim by the caller, or another principal also holds a claim
- Solution: Call `claim_position()` first

**"Position X is not locked"**
- The caller has no lock record on the position (never locked, or the expired lock was archived)
- After expiry: withdraw the position with `transfer_position` and claim on ICPSwap directly

**"Insufficient rewards to claim. ..."**
- Neither token has more than its fee in rewards
- Wait for more trading fees to accumulate

**"Busy: another operation is in progress on this pool; please retry in a few seconds"**
- Retry shortly

**"Failed to get position info: ..." / "Failed to query fees or position: ..."**
- Pool or ledger query failed; may be transient, retry

**"Claim failed: ..." / "Claim call failed with unknown outcome: ..."**
- The pool refused, or the call threw. Check the wallet balance before retrying: after an unknown outcome the pool may still deliver

## Admin Functions

Changed from the original plan: `admin_resume_claim_queue`, `admin_pause_claim_queue`, `admin_clear_completed_claim_requests_buffer`, `admin_remove_active_claim_request` and `admin_set_enforce_zero_balance_before_claim` / `get_enforce_zero_balance_before_claim` no longer exist.

### Clear History

```motoko
public shared ({ caller }) func admin_clear_completed_claim_requests() : async Nat
public shared ({ caller }) func admin_clear_failed_claim_requests() : async Nat
```

Empty the completed or failed history (answer the count removed). Logged as `sneedlock_config_update` with key `claim_history_cleared` / `failed_claim_history_cleared`.

### Recovery

`admin_rescue_stuck_tokens`, `admin_get_pool_unused_balance`, `admin_pool_deposit` and `admin_withdraw_pool_balance_to_user` move funds left on Sneed Lock's main account or its pool balance (see `public/api-docs/sneed_lock.md`).

## Best Practices

### For Users

1. **Expect delivery a few seconds after the call** returns
2. **Verify rewards in your Sneed wallet** (backend wallet) balance
3. **Retry on "Busy"** after a few seconds

### For Integrators

1. **Snapshot the owner's wallet balance** before the call, then poll it after to show the arrival
2. **Optionally forward** the delivered fees to the user's own wallet with `transfer_tokens`
3. **Implement retry logic** for "Busy" and transient query failures
4. **Provide feedback** on insufficient rewards (show the fees)

### For Frontend

Sneed Hub does exactly this: `handleClaimLockedPositionFees` in `Wallet.jsx` and the collectibles flow in `hooks/useCollectiblesNotifications.js` call `claim_position_fees`, then `utils/FeeForwarding.js` (`readBackendWalletBaselines`, `forwardClaimedFees`, waiting up to 30 s for delivery) moves the fees on to the frontend wallet, best effort. Anything not forwarded stays in the Sneed wallet.

```typescript
// Example status display
onStatusUpdate('🎯 Claiming rewards...');
onStatusUpdate('⏳ Waiting for the pool to deliver...');
onStatusUpdate(`✅ ${describeForwarding(forwarding)}`);
```

## Technical Details

### Claim Request Structure

```motoko
type ClaimRequest = {
  request_id: Nat;
  caller: Principal;
  swap_canister_id: Principal;
  position_id: Nat;
  token0: Principal;
  token1: Principal;
  status: ClaimRequestStatus;
  created_at: Timestamp;
  started_processing_at: ?Timestamp;
  completed_at: ?Timestamp;
  retry_count: Nat;            // always 1 for synchronous claims
  last_attempted_at: ?Timestamp;
};
```

### Storage

- **Completed claims**: stable array `completed_claim_requests`, last 1000
- **Failed claims**: stable array `failed_claim_requests`, last 1000
- **Ids**: `next_claim_request_id`, one per attempt (failed attempts take an id too)
- **Retired queue state**: kept, unused (see "Queue Processing")

### Performance

- **One call**: a few inter-canister calls (two `icrc1_fee`, `getUserPosition`, `claimToSubaccount`)
- **Delivery**: by the pool, usually within seconds

## Example Integration

### Complete Flow

```motoko
// 1. Claim
let r = switch (await sneed_lock.claim_position_fees(swap_canister, position_id)) {
  case (#Ok(r)) { r };
  case (#Err(msg)) { Debug.print("Error: " # msg); return };
};

// 2. Wait for delivery: poll icrc1_balance_of on token0 / token1 for
//    { owner = sneed_lock; subaccount = wallet_subaccount(me) } until it has risen
//    by amount - fee (or give up after ~30 s; the fees still arrive).

// 3. Optionally move them out
ignore await sneed_lock.transfer_tokens(me, null, r.token0, delivered0 - fee0);
```

## Security Considerations

1. **Only the position's sole claimant** can claim
2. **A lock record is required**; unlocked positions are withdrawn and claimed on ICPSwap directly
3. **Sneed Lock never holds the fees** - the pool delivers to the owner's subaccount
4. **Per-pool lock** prevents concurrent claims and liquidity additions racing on one pool
5. **Unclaimed fees travel with the position** when its NFT or ownership is transferred: whoever owns it when the claim runs collects them

## Support

For issues or questions:
- Check the claim in `get_my_claim_history()` or `get_claim_request_status(id)`
- View error logs on the canister (`get_error_entries`), joined to the ICRC-3 block by correlation id
- Verify position ownership and lock status

## Changelog

### Version 2.0 (2026-10-11)
- Synchronous `claim_position_fees` using ICPSwap `claimToSubaccount`; delivery straight to the owner's wallet subaccount
- Queue, timer, batch pauses, timeout and zero-balance check retired (state kept for stable compatibility)
- Minimum claimable: more than 1x the ledger fee (previously at least 1x)
- `request_claim_and_withdraw` kept as a synchronous compatibility wrapper
- Later (Sneed Lock v2): `get_claim_requests_page` replaced the whole-history queries; each claim logged as `sneedlock_fees_claim` in the ICRC-3 log

### Version 1.0
- Initial implementation
- Queue-based sequential processing
- Automatic fee handling
- Circular buffer for completed requests
- Comprehensive status tracking
