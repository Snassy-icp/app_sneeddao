# SneedLock Claim and Withdraw API

## Overview

The SneedLock canister provides a queue-based system for claiming and withdrawing trading fees from locked ICPSwap positions. This system ensures safe, sequential processing to prevent fund commingling while allowing position owners to claim their rewards even while positions remain locked.

## Key Features

- ✅ **Sequential Processing** - Processes one claim at a time to avoid fund commingling on ICPSwap
- ✅ **Automatic Withdrawals** - Claims rewards AND withdraws them to user's subaccount on SneedLock backend
- ✅ **Fee Management** - Automatically deducts transaction fees from withdrawn amounts
- ✅ **Smart Validation** - Checks if rewards are worth claiming before processing
- ✅ **Comprehensive Tracking** - Full status visibility through request lifecycle
- ✅ **Persistent State** - All state survives canister upgrades
- ✅ **Circular Buffer** - Maintains last 1000 completed requests for history

## Prerequisites

Before you can claim rewards:
1. Position must be **locked** (have a position lock)
2. Position must be **owned by the SneedLock backend** on ICPSwap
3. Caller must be the **registered owner** in SneedLock's internal records
4. Each token must have at least **2x its transaction fee** in claimable rewards

## API Methods

### 1. Request Claim and Withdraw

Submit a request to claim and withdraw rewards from a locked position.

```motoko
public shared ({ caller }) func request_claim_and_withdraw(
  swap_canister_id : Principal,
  position_id : Nat
) : async {
  #Ok : Nat;  // Returns request_id
  #Err : Text; // Error message
}
```

**Example:**
```motoko
let swap_canister = Principal.fromText("...");
let position_id = 42;

let result = await sneed_lock.request_claim_and_withdraw(swap_canister, position_id);

switch (result) {
  case (#Ok(request_id)) {
    // Store request_id to track status
    Debug.print("Request submitted: " # debug_show(request_id));
  };
  case (#Err(msg)) {
    Debug.print("Failed: " # msg);
  };
};
```

**Validation performed:**
- Caller owns the position in SneedLock records
- Position is locked
- Token0 and token1 info retrieved from position lock

### 2. Query Request Status

Get the current status of a request (searches both active and completed).

```motoko
public query func get_claim_request_status(
  request_id : Nat
) : async ?{
  #Active : ClaimRequest;
  #Completed : Text;
}
```

**Example:**
```motoko
let status = await sneed_lock.get_claim_request_status(request_id);

switch (status) {
  case (?#Active(request)) {
    // Request is still processing
    switch (request.status) {
      case (#Pending) { "Waiting in queue" };
      case (#Processing) { "Processing started" };
      case (#BalanceRecorded(_)) { "Recording balances..." };
      case (#ClaimAttempted(_)) { "Claiming rewards..." };
      case (#ClaimVerified(_)) { "Claim verified, withdrawing..." };
      case (_) { "Processing..." };
    };
  };
  case (?#Completed(text)) {
    // Request finished - parse text for details
    Debug.print("Completed: " # text);
  };
  case (null) {
    // Request not found
  };
};
```

### 3. Get User's Active Requests

Get all active (pending/processing) requests for the caller.

```motoko
public query ({ caller }) func get_my_active_claim_requests() : async [ClaimRequest]
```

**Example:**
```motoko
let my_requests = await sneed_lock.get_my_active_claim_requests();

for (request in my_requests.vals()) {
  Debug.print("Request #" # debug_show(request.request_id) # 
              " for position " # debug_show(request.position_id) # 
              " - Status: " # debug_show(request.status));
};
```

### 4. Get Queue Status

Get overall queue statistics.

```motoko
public query func get_claim_queue_status() : async {
  processing_state : { #Active; #Paused : Text };
  pending_count : Nat;
  processing_count : Nat;
  active_total : Nat;
  completed_buffer_count : Nat;
}
```

**Example:**
```motoko
let stats = await sneed_lock.get_claim_queue_status();

Debug.print("Queue state: " # debug_show(stats.processing_state));
Debug.print("Pending: " # debug_show(stats.pending_count));
Debug.print("Processing: " # debug_show(stats.processing_count));
Debug.print("Completed (last 1000): " # debug_show(stats.completed_buffer_count));
```

## Request Lifecycle

### Status Flow

```
#Pending
  ↓
#Processing (30 min timeout starts)
  ↓
#BalanceRecorded { balance0_before, balance1_before }
  ↓
#ClaimAttempted { balance0_before, balance1_before, claim_attempt }
  ↓
#ClaimVerified { balance0_before, balance1_before, amount0_claimed, amount1_claimed }
  ↓
#Withdrawn { amount0_claimed, amount1_claimed }
  ↓
#Completed
```

**Terminal States:**
- `#Completed` - Success
- `#Failed(Text)` - Permanent failure
- `#TimedOut` - Request exceeded 30 minutes (queue pauses)

### Processing Details

#### Step 0: Validation
- Get token fees for both tokens
- Check position's `tokensOwed0` and `tokensOwed1`
- Verify at least ONE token has >= 2x its fee in rewards
- Fail early if both tokens have insufficient rewards

#### Step 1: Record Balance
- Query backend's balance on swap canister before claiming
- Records `balance0_before` and `balance1_before`

#### Step 2: Claim
- Call `claim()` on ICPSwap swap canister
- If claim returns error, check if balance changed anyway
- Verify claim succeeded by comparing balances

#### Step 3: Withdraw
- For each token where `amount_claimed > fee`:
  - Withdraw `amount_claimed - fee` to caller's subaccount
  - Uses `withdrawToSubaccount()` on ICPSwap
- Tokens are now in caller's subaccount on SneedLock backend
- Skip withdrawal if amount <= fee (log reason)

## Fee Handling

### Transaction Fees

Each token has a transaction fee that must be accounted for:

```
Token0 Fee: 10 tokens
Claimed: 1000 tokens

Withdrawal:
- Amount withdrawn: 990 tokens
- Fee charged: 10 tokens
- Total deducted from swap canister: 1000 tokens ✓
- User receives: 990 tokens in their subaccount
```

### Minimum Claimable Amount

Each token needs at least **2x its transaction fee**:
- 1x fee - consumed during claim operation
- 1x fee - needed for withdrawal

**Examples:**

✅ **Sufficient:**
```
Token0: 1000 owed, fee = 10 (1000 >= 20) → Will withdraw 990
Token1: 500 owed, fee = 5 (500 >= 10) → Will withdraw 495
```

✅ **One token insufficient:**
```
Token0: 1000 owed, fee = 10 (1000 >= 20) → Will withdraw 990
Token1: 8 owed, fee = 5 (8 < 10) → Will skip, log reason
Status: Success (claimed token0)
```

❌ **Both insufficient:**
```
Token0: 15 owed, fee = 10 (15 < 20) → Cannot withdraw
Token1: 8 owed, fee = 5 (8 < 10) → Cannot withdraw
Status: Immediate failure, request not processed
```

## Queue Processing

### Automatic Processing

- Processes oldest request first (FIFO)
- Zero-second timer for immediate processing
- Handles up to **10 requests** per batch
- After 10 requests, pauses for **10 minutes**
- Continues until queue is empty

### Timeout Handling

If a request takes longer than **30 minutes**:
1. Request marked as `#TimedOut`
2. Queue state changes to `#Paused`
3. Processing stops
4. Admin must investigate and resume

### Sequential Processing (Anti-Commingling)

Requests are processed **one at a time** because:
1. All locked positions share the same backend principal on ICPSwap
2. Claiming rewards increases the backend's balance on the swap canister
3. Without sequential processing, we couldn't tell which rewards belong to which position
4. Balance tracking before/after each claim ensures accurate attribution

### Zero Balance Safety Check

**Default: Enabled**

Before processing each claim, the system checks if the backend's balance on the swap canister is zero:

```
✅ Balance = 0 → Safe to proceed (previous claims fully withdrawn)
❌ Balance ≠ 0 → Fail and pause queue (incomplete withdrawal detected)
```

**Why this matters:**
- If processing is truly sequential and all withdrawals succeed
- Then the balance should always be 0 before the next claim
- Non-zero balance indicates something went wrong with a previous claim
- Could mean partial withdrawal, failed withdrawal, or processing error

**When check fails:**
1. Request marked as `#Failed` with detailed error
2. Queue automatically pauses
3. Admin must investigate and resolve
4. Admin can then resume queue

**Admin controls:**
```motoko
// Disable check temporarily (e.g., during recovery)
await admin_set_enforce_zero_balance_before_claim(false);

// Re-enable check
await admin_set_enforce_zero_balance_before_claim(true);

// Query current status
let enabled = await get_enforce_zero_balance_before_claim();
```

**When to disable:**
- During recovery operations
- When manually resolving stuck funds
- Temporary workarounds (re-enable ASAP)

## Error Handling

### Common Errors

**"Caller does not own position"**
- Position not registered to caller in SneedLock
- Solution: Call `claim_position()` first

**"Position X is not locked"**
- Position doesn't have a position lock
- Solution: Create a position lock first

**"Insufficient rewards to claim"**
- Both tokens have < 2x their fee in rewards
- Wait for more trading fees to accumulate

**"Safety check failed: Backend balance is not zero before claim"**
- Previous claim's withdrawal incomplete
- Queue automatically pauses to prevent commingling
- Admin must investigate, resolve stuck funds, then resume
- If check is incorrect, admin can temporarily disable it

**"Failed to get position info"**
- ICPSwap query failed
- May be transient, request can be retried by admin

**"Failed to withdraw tokenX"**
- Withdrawal transaction failed
- Tokens may be stuck on swap canister
- Admin can investigate and resolve

**Request timed out**
- Request took > 30 minutes
- Queue automatically pauses
- Admin must investigate and resume

## Admin Functions

### Resume Queue (After Timeout/Pause)

```motoko
public shared ({ caller }) func admin_resume_claim_queue() : async ()
```

Resumes processing from the oldest pending request.

### Pause Queue

```motoko
public shared ({ caller }) func admin_pause_claim_queue(reason : Text) : async ()
```

Manually pause processing with a reason.

### Clear Completed Buffer

```motoko
public shared ({ caller }) func admin_clear_completed_claim_requests_buffer() : async Nat
```

Clears the circular buffer of completed requests (returns count cleared).

### Remove Active Request

```motoko
public shared ({ caller }) func admin_remove_active_claim_request(request_id : Nat) : async Bool
```

Removes a pending/processing request from the queue.

### Set Zero Balance Enforcement

```motoko
public shared ({ caller }) func admin_set_enforce_zero_balance_before_claim(enforce : Bool) : async ()
```

Enable or disable the zero balance safety check. Default is `true` (enabled).

**Use cases:**
- Disable temporarily during recovery operations
- Disable if stuck funds need manual resolution
- Re-enable after issue is resolved

**Important:** Always re-enable after resolving issues to maintain safety.

## Best Practices

### For Users

1. **Check queue status** before submitting to see if processing is active
2. **Store request_id** immediately after successful submission
3. **Poll status periodically** (every few seconds while active)
4. **Handle all terminal states** (#Completed, #Failed, #TimedOut)
5. **Verify rewards in subaccount** after completion

### For Integrators

1. **Show clear status** to users based on request.status
2. **Implement retry logic** for transient failures
3. **Display estimated time** based on queue position
4. **Alert on timeout** if request exceeds expected time
5. **Provide feedback** on insufficient rewards (show required amounts)

### For Frontend

```typescript
// Example status display mapping
const statusDisplay = {
  Pending: "⏳ Waiting in queue...",
  Processing: "⚙️ Processing started",
  BalanceRecorded: "📊 Recording balances...",
  ClaimAttempted: "🎯 Claiming rewards...",
  ClaimVerified: "✓ Verified, withdrawing...",
  Completed: "✅ Completed successfully",
  Failed: "❌ Failed",
  TimedOut: "⏱️ Request timed out"
};
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
};
```

### Storage

- **Active requests**: Stored in stable array `stable_claim_requests`
- **Completed requests**: Stored in circular buffer (last 1000)
- **All state persists** through canister upgrades

### Performance

- **Query operations**: Fast, O(n) where n = active requests or buffer size
- **Processing**: Sequential, ~30-60 seconds per request (due to ICPSwap calls)
- **Batch size**: 10 requests per batch, then 10-minute pause

## Example Integration

### Complete Flow

```motoko
// 1. Submit request
let result = await sneed_lock.request_claim_and_withdraw(swap_canister, position_id);
let request_id = switch (result) {
  case (#Ok(id)) { id };
  case (#Err(msg)) { 
    Debug.print("Error: " # msg);
    return;
  };
};

// 2. Poll for status
label polling loop {
  await async_sleep(5_000_000_000); // 5 seconds
  
  let status = await sneed_lock.get_claim_request_status(request_id);
  switch (status) {
    case (?#Active(req)) {
      Debug.print("Status: " # debug_show(req.status));
      // Continue polling
    };
    case (?#Completed(text)) {
      Debug.print("Completed: " # text);
      break polling;
    };
    case (null) {
      Debug.print("Request not found");
      break polling;
    };
  };
};

// 3. Verify rewards in subaccount
// Rewards are now in caller's subaccount on SneedLock backend
// Can be transferred out using transfer_tokens()
```

## Security Considerations

1. **Only position owner** can submit claim requests
2. **Position must be locked** to prevent unauthorized claims
3. **Backend retains custody** - tokens go to user's subaccount on SneedLock
4. **No direct ICPSwap transfers** - all withdrawals to subaccounts
5. **Sequential processing** prevents fund commingling
6. **Timeout protection** prevents infinite processing

## Support

For issues or questions:
- Check queue status: `get_claim_queue_status()`
- View error logs on the canister
- Contact admin if request timeout occurs
- Verify position ownership and lock status

## Changelog

### Version 1.0
- Initial implementation
- Queue-based sequential processing
- Automatic fee handling
- Circular buffer for completed requests
- Comprehensive status tracking

