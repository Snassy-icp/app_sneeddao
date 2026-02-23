# Sneed Trading Bot — Specification

## 1. Overview

The **Sneed Trading Bot** is an autonomous trading canister on the Internet Computer that executes token swaps on supported DEXes (ICPSwap, KongSwap, and future additions). It reuses the shared bot infrastructure — **Botkeys** (fine-grained permissions), **Bot Chores** (recurring scheduled work), and **Botlog** (structured logging) — established by the Sneed ICP Staking Bot.

### Core Capabilities

1. **Trade Chore** — Execute a configurable list of conditional trades (with fund-purse/reclaim/send actions) on a recurring schedule.
2. **Rebalance Chore** — Automatically rebalance a portfolio toward user-defined target allocations by picking weighted-random over/underweight token pairs and trading them.
3. **Move Funds Chore** — Execute fund-purse/reclaim/send actions on a recurring schedule (no trading).
4. **Distribute Funds Chore** — Distribute funds from a source purse to target purses or external accounts based on configured percentages/shares.
5. **Snapshot Chore** — Take periodic portfolio snapshots for historical tracking.
6. **DEX Aggregator** — Backend library for quoting and executing swaps across multiple DEXes, with impact-aware quote selection.
7. **Chore Purses** — Virtual accounting layer for isolated per-chore token balances (see Section 16).
8. **Circuit Breakers** — Automated safety rules that can pause/stop chores when configurable conditions are met.

### Design Principles

- **Reuse shared infrastructure**: Botkeys, Bot Chores, Botlog — same integration pattern as the staking bot.
- **No enums in stable vars**: All enumerations are stored as numeric indexes with transient runtime maps to variants (per `motoko_pnp.md`).
- **Individual stable vars**: No config record objects — each setting is its own stable var to avoid upgrade migrations.
- **Multi-instance chores**: Trade chores and Move Funds chores support multiple instances. The rebalancer is single-instance by default but supports multi-instance for managing multiple portfolios.
- **Main account only**: All on-chain operations (swaps, sends) use the canister's main ICRC-1 account (null subaccount). There are no named subaccounts. Fund isolation is achieved through the **Purse** system (virtual accounting).
- **`async*` for internal calls**: All private asynchronous functions use the `async*`/`await*` pattern to avoid IC self-call message queue saturation (see `motoko_pnp.md`).

---

## 2. Permission System

### Permission ID Range: 200–299 (Trading Bot)

The Trading Bot uses the shared base permissions (0–99) plus its own bot-specific range (200–299).

| ID  | Variant                  | Description |
|-----|--------------------------|-------------|
| 0   | `#FullPermissions`       | Grants all permissions |
| 1   | `#ManagePermissions`     | Add/remove botkey principals |
| 2   | `#ViewChores`            | View chore statuses |
| 3   | `#ViewLogs`              | Read log entries |
| 4   | `#ManageLogs`            | Set log level, clear logs |
| 5   | `#ManageEvents`          | Full control over event system: manage listeners, subscriptions, reaction rules |
| 6   | `#ViewEvents`            | View event listeners, subscriptions, reaction rules, and event logs |
| 200 | `#ViewPortfolio`         | View balances, purses, portfolio state |
| 202 | `#ManageTrades`          | Configure trade chore actions (add/edit/remove trades) |
| 203 | `#ManageRebalancer`      | Configure rebalancer targets and parameters |
| 204 | `#ManageTradeChore`      | Start/stop/pause/resume/trigger trade chores |
| 205 | `#ManageRebalanceChore`  | Start/stop/pause/resume/trigger rebalance chore |
| 206 | `#ManageMoveFundsChore`  | Start/stop/pause/resume/trigger move funds chores |
| 207 | `#ManageTokenRegistry`   | Add/remove supported tokens |
| 208 | `#ManageDexSettings`     | Configure DEX parameters (slippage, enabled DEXes) |
| 209 | `#WithdrawFunds`         | Send tokens from the bot to external accounts |
| 210 | `#ConfigureDistribution` | Add/update/remove distribution lists |
| 211 | `#ManageDistributeFunds` | Start/stop/pause/resume/trigger distribute-funds chore |
| 213 | `#ManageCircuitBreaker`  | Create/update/delete/enable CB rules and global toggle |
| 214 | `#ManagePurses`          | Enable/disable chore purses; fund and reclaim operations |

---

## 3. Token Registry

The bot maintains a list of **supported tokens** (ICRC-1 ledger canisters). Each registered token stores:

```
Stable var per token (stored as array of records):
  tokenLedgerCanisterId: Principal  — The ledger canister
  symbol: Text                      — e.g. "ICP", "SNEED", "ckUSDC"
  decimals: Nat8                    — e.g. 8
  fee: Nat                          — Transfer fee in smallest unit
```

The token registry is stored as a single stable var: `var tokenRegistry: [TokenRegistryEntry]`.

Tokens can be added and removed via admin API. The bot needs token metadata (symbol, decimals, fee) for proper amount calculations, display, and fee deduction.

### Scan for Tokens

The frontend provides a "Scan for Tokens" button in the Wallet tab. It iterates through whitelisted tokens (well-known IC tokens), checks on-chain balances, and automatically adds any token with a non-zero balance to the registry.

### Global Token Pause & Freeze

Tokens can be **paused** or **frozen** globally (across all chores):

- **Paused** (`pausedTokens: [Principal]`): The token will **not be traded** by any rebalancer chore or trade action in any trade chore. Fund-purse, reclaim, send, and distribution actions are still allowed.
- **Frozen** (`frozenTokens: [Principal]`): The token will **not be traded AND not be moved** — no trades, fund-purse, reclaim, sends, or distributions involving this token will execute. This is a superset of paused.

A frozen token is implicitly paused (no need to add it to both lists). The checks are:
- **Trade actions** (swap): Skip if input or output token is paused or frozen.
- **Rebalancer**: Exclude paused/frozen tokens from active targets.
- **Fund-purse/Reclaim/Send actions**: Skip if the token is frozen.
- **Distribution chore**: Skip distribution lists whose token is frozen.
- **Fallback routing**: Skip paused/frozen intermediary tokens.

#### API

```motoko
getPausedTokens() : async [Principal]
getFrozenTokens() : async [Principal]
pauseToken(token: Principal) : async ()
unpauseToken(token: Principal) : async ()
freezeToken(token: Principal) : async ()
unfreezeToken(token: Principal) : async ()
```

### Circuit Breaker

The circuit breaker is an automated safety system that can pause or stop bot activities when configurable conditions are met.

#### Concepts

- **Rules**: Independent circuit breaker rules, each with conditions (AND-gated) and actions.
- **Conditions**: Three types — Price (token pair), Value (sum of multiple sources), Balance (specific token in account/purse).
- **Operators**: Greater than, Less than, Inside range, Outside range, Percentage change.
- **Percentage Change**: Compares current value against historical data from a specified lookback period. Supports up/down/either direction.
- **Value Sources**: Specific token in account, all tokens in a chore's purse, all tokens in an account. Multiple sources are de-duplicated by token and summed.
- **Balance Sources**: Purse-aware. Can reference:
  - **Full on-chain balance** of the main account (actual ICRC-1 balance).
  - **Main purse balance** (on-chain minus all chore purse allocations).
  - **A specific chore's purse balance**.
- **Actions**: Pause token in rebal chore, pause/freeze token globally, stop/pause/start chore, stop/pause/start all chores by type, stop/pause/start all chores.
- **Start Actions**: Start actions enable stopped chores or resume paused ones. The actual timer scheduling is deferred to the next conductor tick via the choreEngine's `queueStart` mechanism (since circuit breaker evaluation runs in a context without timer capabilities). This means a started chore will begin within seconds of the circuit breaker triggering.
- **Manual Reset**: When a circuit breaker triggers, affected chores/tokens remain paused/stopped until manually resumed by the user (or by a circuit breaker start action).
- **Event Log**: All trigger events are recorded with timestamps, rule info, condition summaries, and actions taken.

#### Pipeline Integration

The circuit breaker check runs **once per chore run**:
- **Trade chore**: After price fetch (Phase 1), before the first trade action.
- **Rebalance chore**: After the before-snapshot (Phase 2), before the rebalance execution.

Both conductors augment their metadata/price fetch phases with tokens and pairs required by enabled CB rules, ensuring fresh data is available for condition evaluation.

If any rule triggers, the current chore run is aborted (returns `#Done`), and the specified actions execute.

#### Data Model

```motoko
// Condition types: 0=price, 1=value, 2=balance
// Operators: 0=greaterThan, 1=lessThan, 2=insideRange, 3=outsideRange, 4=percentChange
// Change directions: 0=up, 1=down, 2=either
// Value source types: 0=specificToken, 1=allTokensInPurse, 2=allTokensInAccount
// Action types: 0=pauseTokenInRebalChore, 1=pauseTokenGlobally, 2=freezeTokenGlobally,
//   3=stopChore, 4=pauseChore, 5=stopAllChoresByType, 6=pauseAllChoresByType,
//   7=stopAllChores, 8=pauseAllChores, 9=startChore, 10=startAllChoresByType,
//   11=startAllChores
```

See `Types.mo` for full type definitions: `CircuitBreakerCondition`, `CircuitBreakerActionConfig`, `CircuitBreakerRule`, `CircuitBreakerEvent`, `CBValueSource`, `CBLogQuery`, `CBLogResult`.

#### Stable Variables

| Variable | Type | Description |
|----------|------|-------------|
| `circuitBreakerEnabled` | `Bool` | Global enable/disable for all CB evaluation |
| `circuitBreakerRules` | `[CircuitBreakerRule]` | All configured rules |
| `circuitBreakerNextRuleId` | `Nat` | Auto-increment counter for rule IDs |
| `circuitBreakerLog` | `[CircuitBreakerEvent]` | Event log (circular buffer) |
| `circuitBreakerLogNextId` | `Nat` | Auto-increment counter for event IDs |
| `circuitBreakerMaxLogEntries` | `Nat` | Max log size (default: 1000) |

#### API

```motoko
getCircuitBreakerRules() : async [CircuitBreakerRule]
addCircuitBreakerRule(input: CircuitBreakerRuleInput) : async Nat
updateCircuitBreakerRule(id: Nat, input: CircuitBreakerRuleInput) : async ()
removeCircuitBreakerRule(id: Nat) : async ()
enableCircuitBreakerRule(id: Nat, enabled: Bool) : async ()

getCircuitBreakerEnabled() : async Bool
setCircuitBreakerEnabled(enabled: Bool) : async ()

getCircuitBreakerLog(q: CBLogQuery) : async CBLogResult
clearCircuitBreakerLog() : async ()
```

### Well-Known Token Constants

```
ICP_LEDGER    = "ryjl3-tyaaa-aaaaa-aaaba-cai"
CKUSDC_LEDGER = "xevnm-gaaaa-aaaar-qafnq-cai"
CKBTC_LEDGER  = "mxzaz-hqaaa-aaaar-qaada-cai"
CKETH_LEDGER  = "ss2fx-dyaaa-aaaar-qacoq-cai"
SNEED_LEDGER  = "hvgxa-wqaaa-aaaaq-aacia-cai"
```

---

## 4. DEX Aggregator (Backend)

### Architecture

The backend DEX aggregator mirrors the frontend library's adapter + aggregator pattern, implemented in Motoko as actor interfaces and helper modules.

### Supported DEXes

| DEX ID (Nat) | Name     | Swap Canister |
|--------------|----------|---------------|
| 0            | ICPSwap  | Pool canisters (discovered via factory `4mmnk-kiaaa-aaaag-qbllq-cai`) |
| 1            | KongSwap | `2ipq2-uqaaa-aaaar-qailq-cai` |

DEX IDs are stored as Nat (not enums) in stable vars.

### Actor Interfaces

#### ICRC-1 Ledger (reused)
```motoko
type LedgerActor = actor {
    icrc1_balance_of: shared query (Account) -> async Nat;
    icrc1_transfer: shared (TransferArg) -> async TransferResult;
    icrc1_fee: shared query () -> async Nat;
    icrc2_approve: shared (ApproveArg) -> async ApproveResult;
    icrc2_allowance: shared query (AllowanceArg) -> async AllowanceResult;
};
```

#### ICPSwap Factory
```motoko
type ICPSwapFactoryActor = actor {
    getPool: shared query (GetPoolArgs) -> async { #ok: PoolData; #err: Text };
};
```

#### ICPSwap Pool
```motoko
type ICPSwapPoolActor = actor {
    quote: shared query (QuoteArgs) -> async { #ok: Nat; #err: Text };
    depositAndSwap: shared (SwapArgs) -> async { #ok: Nat; #err: Text };
    depositFromAndSwap: shared (SwapArgs) -> async { #ok: Nat; #err: Text };
    metadata: shared query () -> async { #ok: PoolMetadata; #err: Text };
};
```

#### KongSwap
```motoko
type KongSwapActor = actor {
    swap_amounts: shared query (Text, Nat, Text) -> async { #Ok: SwapAmountsReply; #Err: Text };
    swap: shared (SwapArgs) -> async { #Ok: SwapReply; #Err: Text };
};
```

### Aggregator API

The bot exposes these **internal functions** (not public API — called by chore logic):

```
getQuote(dexId: Nat, inputToken: Principal, outputToken: Principal, amount: Nat) : async* ?SwapQuote
getAllQuotes(inputToken: Principal, outputToken: Principal, amount: Nat) : async* [SwapQuote]
getBestQuote(inputToken: Principal, outputToken: Principal, amount: Nat) : async* ?SwapQuote
executeSwap(quote: SwapQuote, slippageBps: Nat) : async* SwapResult
getSpotPrice(dexId: Nat, inputToken: Principal, outputToken: Principal) : async* ?Nat
```

### Impact-Aware Quote Selection

When a trade action specifies `maxPriceImpactBps`, the bot filters **all** available quotes by price impact tolerance *first*, then selects the best among the eligible ones. This prevents the scenario where the absolute best quote is rejected for high impact while an almost-as-good quote from another DEX would pass the check.

### SwapQuote Type

```
SwapQuote = {
    dexId: Nat;
    inputToken: Principal;
    outputToken: Principal;
    inputAmount: Nat;
    effectiveInputAmount: Nat;
    expectedOutput: Nat;
    spotPrice: Nat;
    priceImpactBps: Nat;
    dexFeeBps: Nat;
    inputFeesTotal: Nat;
    outputFeesTotal: Nat;
    poolCanisterId: ?Principal;
    timestamp: Int;
}
```

### SwapResult Type

```
SwapResult = {
    #Ok: { amountOut: Nat; txId: ?Nat };
    #Err: Text;
}
```

### DEX Settings (Stable Vars)

```
var enabledDexes: [Nat]
var defaultSlippageBps: Nat
var defaultMaxPriceImpactBps: Nat
var icpswapPoolCache: [(Text, Principal)]
```

---

## 5. Denomination System

Trade conditions and rebalancer targets can be denominated in any registered ICRC-1 token. This allows expressing conditions like "trade when SNEED price < 50 USD" or "target 30% of portfolio value in ICP terms."

### How It Works

- Each condition amount has an optional `denominationToken: ?Principal` field.
- When `null`, the amount is in the condition's own token (native denomination).
- When set, the bot converts using the DEX aggregator's spot price at evaluation time.
- Example: A price range of 1–50 with `denominationToken = ckUSDC` means "1 to 50 ckUSDC per token."

### Common Denominations

- **Native** (`null`): Amount in the token itself. E.g., "min balance 100 ICP" means 100 ICP.
- **ICP**: The default denomination for portfolio rebalancing.
- **ckUSDC**: For USD-denominated conditions.

---

## 6. Trade Chore

### Overview

A Trade Chore instance contains an ordered list of **actions** that execute sequentially when the chore fires. Each action is independent — a failed action is logged and skipped; subsequent actions still run.

Chore type ID: `"trade"`

Default interval: 300 seconds (5 minutes), with `maxIntervalSeconds` for randomization.

### Action Types

Actions are stored with a numeric `actionType` field (not an enum):

| Type ID | Name       | Description |
|---------|------------|-------------|
| 0       | Trade      | Execute a token swap on a DEX |
| 1       | Fund Purse | Move tokens from source purse (or main purse) to target chore's purse (bookkeeping only) |
| 2       | Reclaim    | Move tokens from source chore's purse to target purse (or main purse) (bookkeeping only) |
| 3       | Send       | Send tokens from source purse to any external ICRC-1 address (on-chain transfer) |

### Unified Action Storage

All action types are stored in a single unified record type to avoid enum-in-stable-var issues:

```
ActionConfig = {
    id: Nat;
    actionType: Nat;                    // 0=Trade, 1=FundPurse, 2=Reclaim, 3=Send
    enabled: Bool;

    // Token(s) - Trade uses both, others use inputToken only
    inputToken: Principal;
    outputToken: ?Principal;            // Only for Trade

    // Amount range
    minAmount: Nat;
    maxAmount: Nat;

    // Amount mode: 0 = random in [min,max] range (default), 1 = percentage of balance
    amountMode: Nat;
    // When amountMode=1: percentage in basis points (0-10000 = 0-100%), capped by min/max
    balancePercent: ?Nat;

    // DEX preference (Trade only)
    preferredDex: ?Nat;

    // Purse references (FundPurse / Reclaim / Send)
    sourcePurseId: ?Text;              // Reclaim: source purse, Send: source purse (null=main purse)
    targetPurseId: ?Text;              // FundPurse: target purse

    // Destination (Send only — external ICRC-1 account)
    destinationOwner: ?Principal;
    destinationSubaccount: ?Blob;

    // Balance conditions
    minBalance: ?Nat;
    maxBalance: ?Nat;
    balanceDenominationToken: ?Principal;

    // Price conditions (Trade only)
    minPrice: ?Nat;
    maxPrice: ?Nat;
    priceDenominationToken: ?Principal;

    // Risk parameters (Trade only)
    maxPriceImpactBps: ?Nat;
    maxSlippageBps: ?Nat;

    // Frequency control (seconds)
    minFrequencySeconds: ?Nat;
    maxFrequencySeconds: ?Nat;

    // Trade size denomination (Trade only)
    tradeSizeDenominationToken: ?Principal;

    // Post-execution behavior (halt & cumulative limits)
    haltChoreAfterExecution: Bool;      // If true, stop the chore after this action executes
    maxCumulativeInput: ?Nat;           // Cumulative input budget; chore stops when reached
    maxCumulativeOutput: ?Nat;          // Cumulative output target; chore stops when reached
    maxExecutions: ?Nat;                // Execution count cap; chore stops when reached

    // Runtime state (tracked per action)
    lastExecutedAt: ?Int;
    cumulativeInputSpent: Nat;
    cumulativeOutputReceived: Nat;
    executionCount: Nat;
}
```

### ActionConfigInput

The input type for creating/updating actions omits runtime state fields:

```
ActionConfigInput = {
    actionType: Nat;
    enabled: Bool;
    inputToken: Principal;
    outputToken: ?Principal;
    minAmount: Nat;
    maxAmount: Nat;
    amountMode: Nat;
    balancePercent: ?Nat;
    preferredDex: ?Nat;
    sourcePurseId: ?Text;
    targetPurseId: ?Text;
    destinationOwner: ?Principal;
    destinationSubaccount: ?Blob;
    minBalance: ?Nat;
    maxBalance: ?Nat;
    balanceDenominationToken: ?Principal;
    minPrice: ?Nat;
    maxPrice: ?Nat;
    priceDenominationToken: ?Principal;
    maxPriceImpactBps: ?Nat;
    maxSlippageBps: ?Nat;
    minFrequencySeconds: ?Nat;
    maxFrequencySeconds: ?Nat;
    tradeSizeDenominationToken: ?Principal;
    haltChoreAfterExecution: Bool;
    maxCumulativeInput: ?Nat;
    maxCumulativeOutput: ?Nat;
    maxExecutions: ?Nat;
}
```

### Action Halt & Cumulative Limits

Actions support post-execution behavior flags that can automatically stop the parent chore:

- **`haltChoreAfterExecution`**: If `true`, the chore is stopped immediately after this action successfully executes. Primary use case: stop-loss / stop-buy actions that should fire once and halt all further trading.
- **`maxCumulativeInput`**: When the action's `cumulativeInputSpent` reaches this threshold, the chore is stopped. Use case: "DCA until 100 ICP spent."
- **`maxCumulativeOutput`**: When the action's `cumulativeOutputReceived` reaches this threshold, the chore is stopped. Use case: "Buy until I have 1 BTC."
- **`maxExecutions`**: When the action's `executionCount` reaches this threshold, the chore is stopped. Use case: "Execute at most 50 trades."

Pre-checks at the start of `executeTradeAction` skip the action entirely if its cumulative limits are already met, preventing wasted work. Skipped-due-to-limit entries are recorded in the trade log with a `#Skipped` status.

After each successful execution, `updateActionStats` atomically updates `lastExecutedAt`, `cumulativeInputSpent`, `cumulativeOutputReceived`, and `executionCount`. The chore conductor then checks all halt/limit conditions and stops the chore if any are triggered.

Additionally, after all actions in a chore run have been processed, the conductor calls `_allActionsAtLimits` to check whether **every** enabled action in the chore has reached at least one of its cumulative limits. If so, the chore is automatically stopped and a `ChoreHalted` event is emitted. This prevents indefinite scheduling of a chore that can no longer make progress.

`resetActionStats` API allows resetting cumulative stats for a specific action to re-enable a halted chore.

### Trade Chore Storage

```
Stable var:
  var tradeChoreActions: [(Text, [ActionConfig])]  — keyed by instanceId
  var tradeChoreNextActionId: [(Text, Nat)]        — keyed by instanceId
```

### Trade Chore Execution Flow

When a Trade Chore instance fires:

1. **Conductor (tick 0)**: Loads the action list for this instance. Filters to enabled actions.
2. For each action (sequentially, as Level 3 tasks):
   a. Check **cumulative limits**: If `maxCumulativeInput` or `maxExecutions` already met, skip.
   b. Check **frequency**: If `lastExecutedAt + minFrequencySeconds > now`, skip.
   c. Check **balance conditions**: Query the relevant purse balance. Skip if outside range.
   d. For **Trade** actions:
      - Check **price conditions**: Get spot price, convert denomination if needed. Skip if outside range.
      - Calculate trade size: Pick amount based on `amountMode` (random in range or % of balance), adjusted for denomination.
      - Get quotes from all enabled DEXes. **Filter by `maxPriceImpactBps` first**, then select best eligible quote.
      - Check **slippage** tolerance.
      - Execute the swap. Returns `(success, inputSpent, outputReceived)`.
      - On success: update chore purse balances (debit input, credit output) if chore has its own purse.
   e. For **Fund Purse** actions:
      - Move tokens from source purse to target chore's purse (bookkeeping only, no on-chain transfer).
   f. For **Reclaim** actions:
      - Move tokens from source chore's purse back to target purse or main purse (bookkeeping only).
   g. For **Send** actions:
      - Execute ICRC-1 transfer from the bot's main account. Debit the source purse.
   h. Update `lastExecutedAt` and cumulative stats via `updateActionStats`.
   i. Check halt/limit conditions. Stop chore if triggered.
   j. Log the result (including skipped trades with `#Skipped` status).
3. **Conductor (done)**: Return `#Done`.

### Trade Log

**Every** trade attempt, skip, and failure is logged to the trade log — nothing is silent. The trade log supports page-based pagination via `getTradeLog(query)` with page/pageSize parameters.

Entries use three statuses:

- **`#Success`**: The action executed successfully. Includes trade amounts, DEX used, prices, and detected inflows/outflows.
- **`#Skipped`**: The action was skipped due to an unmet condition. Includes a human-readable reason (e.g., "Price impact 30% exceeds max 3%", "Cumulative input limit reached", "Purse locked", "Token frozen").
- **`#Failed`**: The action attempted execution but failed. Includes the error message (e.g., swap execution error, transfer failure, internal error).

This comprehensive logging covers all paths: cumulative limit skips, frequency limit skips, purse lock skips, token pause/freeze skips, balance/price condition skips, trailing stop non-triggers, no-route failures, swap failures, send failures, rebalancer skips, and unexpected exceptions in catch blocks.

### Frequency Warnings

If an action's `minFrequencySeconds` is less than the chore's `intervalSeconds`, the admin API should return a warning (in the action status). The action will simply run every chore cycle in this case.

---

## 7. Rebalance Chore

### Overview

The Rebalance Chore maintains a portfolio at target allocations by identifying over/underweight tokens and trading between them.

Chore type ID: `"rebalance"`

Default interval: 3600 seconds (1 hour), with `maxIntervalSeconds` for randomization.

### Portfolio Targets

```
Stable var:
  var rebalanceTargets: [(Text, [RebalanceTarget])]
  var rebalanceDenominationToken: [(Text, Principal)]
  var rebalanceMaxTradeSize: [(Text, Nat)]
  var rebalanceMinTradeSize: [(Text, Nat)]
  var rebalanceMaxPriceImpactBps: [(Text, Nat)]
  var rebalanceMaxSlippageBps: [(Text, Nat)]
  var rebalanceThresholdBps: [(Text, Nat)]
```

```
RebalanceTarget = {
    token: Principal;
    targetBps: Nat;           // Target allocation in basis points (10000 = 100%)
}
```

The sum of all `targetBps` should equal 10000. The API should warn if it doesn't.

### Rebalance Execution Algorithm

When the Rebalance Chore fires:

1. **Value Portfolio**: For each token in the target list, get the effective balance (chore purse or main purse, via `getEffectiveBalance`) and the spot price in the denomination token. Calculate total portfolio value.

2. **Calculate Deviations**: For each token, compute:
   - `currentBps = (tokenValue / totalValue) * 10000`
   - `deviationBps = currentBps - targetBps`
   - Overweight tokens: `deviationBps > thresholdBps`
   - Underweight tokens: `deviationBps < -thresholdBps`

3. **Weighted Random Pair Selection**: Pick one overweight token and one underweight token, weighted by their absolute deviation.

4. **Calculate Trade Size**: Determine how much of the overweight token to sell, clamped to `[rebalanceMinTradeSize, rebalanceMaxTradeSize]` and to available balance minus transfer fees.

5. **Get Quote & Validate**: Get best quote for the pair (impact-aware). Check price impact and that the expected output moves the underweight token closer to (not past) its target.

6. **Execute Trade**: If all checks pass, execute the swap. Update chore purse balances if the chore has its own purse.

7. **Log Result**: Record the trade details including deviation before/after.

### Rebalance API

```motoko
getRebalanceTargets(instanceId: Text) : async [RebalanceTarget]
setRebalanceTargets(instanceId: Text, targets: [RebalanceTarget]) : async ()
getRebalanceDenominationToken(instanceId: Text) : async Principal
setRebalanceDenominationToken(instanceId: Text, token: Principal) : async ()
getRebalanceSettings(instanceId: Text) : async RebalanceSettings
setRebalanceMaxTradeSize(instanceId: Text, amount: Nat) : async ()
setRebalanceMinTradeSize(instanceId: Text, amount: Nat) : async ()
setRebalanceMaxPriceImpactBps(instanceId: Text, bps: Nat) : async ()
setRebalanceMaxSlippageBps(instanceId: Text, bps: Nat) : async ()
setRebalanceThresholdBps(instanceId: Text, bps: Nat) : async ()
getPortfolioStatus(instanceId: Text) : async PortfolioStatus
```

### PortfolioStatus Type

```
PortfolioStatus = {
    denominationToken: Principal;
    totalValueInDenomination: Nat;
    tokens: [{
        token: Principal;
        symbol: Text;
        balance: Nat;
        valueInDenomination: Nat;
        currentBps: Nat;
        targetBps: Nat;
        deviationBps: Int;
    }];
}
```

---

## 8. Move Funds Chore

### Overview

A lightweight chore for scheduled fund movements without trading. Supports Fund Purse, Reclaim, and Send actions (action types 1, 2, 3 — same as in Trade Chore).

Move Funds chores do **not** have their own purses — they operate on other chores' purses and the main purse.

Chore type ID: `"move-funds"`

Default interval: 3600 seconds (1 hour).

### Storage

```
Stable var:
  var moveFundsActions: [(Text, [ActionConfig])]
  var moveFundsNextActionId: [(Text, Nat)]
```

Uses the same `ActionConfig` type as Trade Chore, but only action types 1, 2, 3 are valid.

### Execution

Same pattern as Trade Chore but restricted to non-trade action types.

---

## 9. Distribute Funds Chore

### Overview

Distributes funds from a source purse to target purses or external accounts based on configured shares.

Distribute Funds chores do **not** have their own purses — they source from a specified purse (or main purse) and distribute to other chores' purses or external accounts.

Chore type ID: `"distribute-funds"`

### Distribution List

```
DistributionList = {
    id: Nat;
    name: Text;
    tokenLedgerCanisterId: Principal;
    thresholdAmount: Nat;               // Min balance before distribution triggers
    maxDistributionAmount: Nat;         // Max amount to distribute per round
    minDistributionAmount: Nat;         // Min amount (for random mode lower bound)
    targets: [DistributionTarget];
    sourcePurseId: ?Text;               // null = main purse, else chore instanceId
    amountMode: Nat;                    // 0 = random in [min, max], 1 = % of balance
    balancePercent: ?Nat;               // When amountMode=1: bps (0-10000)
}
```

### Distribution Targets

Each target is either an **internal purse credit** or an **external ICRC-1 transfer**:

```
DistributionTarget = {
    account: Account;                   // ICRC-1 account (used for external targets)
    basisPoints: ?Nat;                  // Share in bps; null = auto-split remainder
    choreInstanceId: ?Text;            // If set, credit this chore's purse (no on-chain transfer)
}
```

When `choreInstanceId` is set, the distribution credits the target chore's purse (bookkeeping only — no transfer fee). When `choreInstanceId` is null, the distribution executes an on-chain ICRC-1 transfer to the specified `account`.

### Execution Flow

1. Check source purse (or main purse) balance for the distribution token.
2. If balance >= `thresholdAmount`, calculate distribution amount based on `amountMode`.
3. For each target (in order):
   - Calculate target share: `distributionAmount * targetBps / 10000` (or auto-split remainder).
   - If target has `choreInstanceId`: credit that chore's purse, debit source purse (bookkeeping).
   - If target is external: execute ICRC-1 transfer, debit source purse by `(amount + fee)`.

---

## 10. Snapshot Chore

Takes periodic portfolio snapshots for historical tracking. Snapshot chores do **not** have their own purses. In addition to the main account snapshot, the snapshot chore also captures per-purse snapshots for every enabled chore purse, using cached prices and the chore's virtual balance accounting.

Chore type ID: `"snapshot"`

---

## 11. Stable Variables Summary

Each setting is its own stable var to avoid migration issues:

```motoko
// Core
var createdAt: Int
var hotkeyPermissions: [(Principal, [Nat])]

// Token Registry
var tokenRegistry: [TokenRegistryEntry]
var pausedTokens: [Principal]
var frozenTokens: [Principal]

// DEX Settings
var enabledDexes: [Nat]
var defaultSlippageBps: Nat
var defaultMaxPriceImpactBps: Nat
var icpswapPoolCache: [(Text, Principal)]

// Bot Chores (shared framework)
var choreConfigs: [(Text, BotChoreTypes.ChoreConfig)]
var choreStates: [(Text, BotChoreTypes.ChoreRuntimeState)]
var choreInstances: [(Text, BotChoreTypes.ChoreInstanceInfo)]

// Trade Chore
var tradeChoreActions: [(Text, [ActionConfig])]
var tradeChoreNextActionId: [(Text, Nat)]

// Rebalance Chore (per-instance)
var rebalanceTargets: [(Text, [RebalanceTarget])]
var rebalanceDenominationToken: [(Text, Principal)]
var rebalanceMaxTradeSize: [(Text, Nat)]
var rebalanceMinTradeSize: [(Text, Nat)]
var rebalanceMaxPriceImpactBps: [(Text, Nat)]
var rebalanceMaxSlippageBps: [(Text, Nat)]
var rebalanceThresholdBps: [(Text, Nat)]

// Move Funds Chore
var moveFundsActions: [(Text, [ActionConfig])]
var moveFundsNextActionId: [(Text, Nat)]

// Distribution (shared pattern from staking bot)
var distributionSettings: [(Text, { lists: [DistributionTypes.DistributionList]; nextListId: Nat })]

// Bot Log
var botLogEntries: [BotLogTypes.LogEntry]
var botLogNextId: Nat
var botLogLevel: Nat
var botLogMaxEntries: Nat

// Trade Log
var tradeLog: [TradeLogEntry]
var tradeLogNextId: Nat
var tradeLogMaxEntries: Nat

// Circuit Breaker
var circuitBreakerEnabled: Bool
var circuitBreakerRules: [CircuitBreakerRule]
var circuitBreakerNextRuleId: Nat
var circuitBreakerLog: [CircuitBreakerEvent]
var circuitBreakerLogNextId: Nat
var circuitBreakerMaxLogEntries: Nat

// Chore Purses (isolated chore balances)
var chorePurseEnabled: [(Text, Bool)]                     // instanceId → enabled
var chorePurseBalances: [(Text, [(Text, Nat)])]           // instanceId → [(balanceKey, amount)]
// balanceKey format: "<tokenPrincipal>" (main account only, no subaccount component)

// Per-purse portfolio snapshots
var purseSnapshots: [(Text, PortfolioSnapshot)]           // (purseId, snapshot) pairs
var purseSnapshotNextId: Nat
var purseSnapshotMaxEntries: Nat

// Event System — Source side
var eventListenerRegistrations: [BotEventTypes.EventListenerRegistration]
var eventListenerNextId: Nat
var eventEmissionEnabled: Bool
var eventLog: [BotEventTypes.BotEvent]
var eventLogNextId: Nat
var eventLogMaxEntries: Nat                               // Default: 500

// Event System — Listener side
var eventSubscriptions: [BotEventTypes.EventSubscription]
var eventSubscriptionNextId: Nat
var eventReactionRules: [BotEventTypes.EventReactionRule]
var eventReactionNextId: Nat
var eventReactionLog: [BotEventTypes.EventReactionLogEntry]
var eventReactionLogNextId: Nat
var eventReactionLogMaxEntries: Nat                       // Default: 500
```

---

## 12. Public API Summary

### Canister Info
```motoko
getVersion() : async Version
getCanisterPrincipal() : async Principal
```

### Permission Management (shared pattern)
```motoko
getHotkeyPermissions() : async [HotkeyPermissionInfo]
addHotkeyPermissions(principal: Principal, permissions: [TradingPermissionType]) : async ()
removeHotkeyPermissions(principal: Principal, permissions: [TradingPermissionType]) : async ()
removeHotkey(principal: Principal) : async ()
listPermissionTypes() : async [(Nat, TradingPermissionType)]
getCallerPermissions() : async [TradingPermissionType]
```

### Token Registry
```motoko
getTokenRegistry() : async [TokenRegistryEntry]
addToken(entry: TokenRegistryEntry) : async ()
removeToken(ledgerCanisterId: Principal) : async ()
refreshTokenMetadata(ledgerCanisterId: Principal) : async ()
```

### Portfolio & Balances
```motoko
getBalances() : async [TokenBalance]                // On-chain balances for main account
getPortfolioStatus(instanceId: Text) : async PortfolioStatus
```

### DEX
```motoko
getQuote(dexId: ?Nat, inputToken: Principal, outputToken: Principal, amount: Nat) : async [SwapQuote]
getEnabledDexes() : async [Nat]
setEnabledDexes(dexIds: [Nat]) : async ()
setDefaultSlippage(bps: Nat) : async ()
setDefaultMaxPriceImpact(bps: Nat) : async ()
```

### Trade Chore Actions
```motoko
getTradeActions(instanceId: Text) : async [ActionConfig]
addTradeAction(instanceId: Text, config: ActionConfigInput) : async Nat
updateTradeAction(instanceId: Text, id: Nat, config: ActionConfigInput) : async Bool
removeTradeAction(instanceId: Text, id: Nat) : async Bool
reorderTradeActions(instanceId: Text, actionIds: [Nat]) : async Bool
resetActionStats(instanceId: Text, actionId: Nat) : async Bool
```

### Move Funds Actions
```motoko
getMoveFundsActions(instanceId: Text) : async [ActionConfig]
addMoveFundsAction(instanceId: Text, config: ActionConfigInput) : async Nat
updateMoveFundsAction(instanceId: Text, id: Nat, config: ActionConfigInput) : async Bool
removeMoveFundsAction(instanceId: Text, id: Nat) : async Bool
```

### Rebalancer
```motoko
getRebalanceTargets(instanceId: Text) : async [RebalanceTarget]
setRebalanceTargets(instanceId: Text, targets: [RebalanceTarget]) : async ()
getRebalanceSettings(instanceId: Text) : async RebalanceSettings
setRebalanceDenominationToken(instanceId: Text, token: Principal) : async ()
setRebalanceMaxTradeSize(instanceId: Text, amount: Nat) : async ()
setRebalanceMinTradeSize(instanceId: Text, amount: Nat) : async ()
setRebalanceMaxPriceImpactBps(instanceId: Text, bps: Nat) : async ()
setRebalanceMaxSlippageBps(instanceId: Text, bps: Nat) : async ()
setRebalanceThresholdBps(instanceId: Text, bps: Nat) : async ()
```

### Distribution (shared pattern)
```motoko
getDistributionLists(instanceId: Text) : async [DistributionList]
addDistributionList(instanceId: Text, input: DistributionListInput) : async Nat
updateDistributionList(instanceId: Text, id: Nat, input: DistributionListInput) : async ()
removeDistributionList(instanceId: Text, id: Nat) : async ()
```

### Chore Management (shared pattern)
```motoko
getChoreStatuses() : async [ChoreStatus]
getChoreStatus(choreId: Text) : async ?ChoreStatus
createChoreInstance(typeId: Text, instanceId: Text, label: Text) : async Bool
deleteChoreInstance(instanceId: Text) : async Bool
renameChoreInstance(instanceId: Text, newLabel: Text) : async Bool
listChoreInstances(typeIdFilter: ?Text) : async [(Text, ChoreInstanceInfo)]
startChore(choreId: Text) : async ()
scheduleStartChore(choreId: Text, timestampNanos: Int) : async ()
pauseChore(choreId: Text) : async ()
resumeChore(choreId: Text) : async ()
stopChore(choreId: Text) : async ()
stopAllChores() : async ()
triggerChore(choreId: Text) : async ()
setChoreInterval(choreId: Text, seconds: Nat) : async ()
setChoreMaxInterval(choreId: Text, seconds: ?Nat) : async ()
setChoreTaskTimeout(choreId: Text, seconds: Nat) : async ()
setChoreNextRun(choreId: Text, timestampNanos: Int) : async ()
```

### Chore Purses
```motoko
isPurseEnabled(instanceId: Text) : async Bool
enablePurse(instanceId: Text) : async ()
disablePurse(instanceId: Text) : async { #Ok; #Err: Text }
getPurseBalances(instanceId: Text) : async [PurseBalance]
getPurseBalance(instanceId: Text, token: Principal) : async Nat
getAllPurseAllocations() : async [(Text, [(Text, Nat)])]    // Fast query: all purses
getMainPurseBalances() : async [MainPurseBalance]
getMainPurseBalance(token: Principal) : async { balance: Nat; overcommitted: Bool }
fundPurse(instanceId: Text, token: Principal, amount: Nat) : async { #Ok; #Err: Text }
reclaimFromPurse(instanceId: Text, token: Principal, amount: Nat) : async { #Ok; #Err: Text }
manualSend(token: Principal, to: Account, amount: Nat, sourcePurseId: ?Text) : async { #Ok: Nat; #Err: Text }

// Cross-chore purse sharing
setTradingPurseId(instanceId: Text, purseId: ?Text) : async { #Ok; #Err: Text }
getTradingPurseId(instanceId: Text) : async ?Text            // Raw override (null = no override)
getResolvedPurseId(instanceId: Text) : async ?Text           // Fully resolved: override > own purse > null (main)
```

### Trade Log
```motoko
getTradeLog(query: TradeLogQuery) : async TradeLogResult   // Paginated
```

### Log (shared pattern)
```motoko
getLogs(filter: LogFilter) : async LogResult
getLogConfig() : async LogConfig
setLogLevel(level: LogLevel) : async ()
clearLogs() : async ()
```

### Event System (shared pattern)
```motoko
// Source side
registerEventListener(req: RegisterListenerRequest) : async { #Ok: Nat; #Err: Text }
unregisterEventListener(listenerId: Nat) : async ()
updateEventListenerTypes(listenerId: Nat, newEventTypeIds: [Nat]) : async { #Ok; #Err: Text }
getEventListeners() : async [EventListenerRegistration]
setEventEmissionEnabled(enabled: Bool) : async ()
getEventLog(query: EventLogQuery) : async EventLogResult
getEventTypes() : async [(Nat, Text)]

// Listener side
addEventSubscription(sourceBotId: Principal, eventTypeIds: [Nat]) : async { #Ok: Nat; #Err: Text }
removeEventSubscription(id: Nat) : async ()
updateEventSubscription(id: Nat, newEventTypeIds: [Nat]) : async { #Ok; #Err: Text }
getEventSubscriptions() : async [EventSubscription]
addEventReaction(input: EventReactionRuleInput) : async Nat
updateEventReaction(id: Nat, input: EventReactionRuleInput) : async ()
removeEventReaction(id: Nat) : async ()
getEventReactions() : async [EventReactionRule]
getEventReactionLog(query: EventReactionLogQuery) : async EventReactionLogResult
getAvailableReactionActions() : async [(Nat, Text)]
onBotEvent(event: BotEvent) : async { #Ok; #Err: Text }
```

---

## 13. ICPSwap Swap Flow (Backend)

Since the bot canister is the caller (not a browser user), the flow is simpler:

### ICRC-2 Path (preferred)
1. **Approve**: Call `icrc2_approve` on the input token ledger, granting the pool canister an allowance.
2. **depositFromAndSwap**: Call the pool's `depositFromAndSwap` which does `transferFrom` + swap + withdraw in one call.

### ICRC-1 Path (fallback)
1. **Transfer**: Transfer input tokens to the pool's subaccount for the bot's principal.
2. **depositAndSwap**: Call the pool's `depositAndSwap` which deposits from subaccount + swaps + withdraws.

The bot should prefer ICRC-2 when the token supports it, falling back to ICRC-1.

---

## 14. KongSwap Swap Flow (Backend)

### ICRC-2 Path
1. **Approve**: Call `icrc2_approve` granting Kong swap canister allowance.
2. **swap**: Call Kong's `swap` with empty `pay_tx_id` (Kong calls `transferFrom`).

### ICRC-1 Path
1. **Transfer**: Transfer tokens to Kong swap canister.
2. **swap**: Call Kong's `swap` with `pay_tx_id = [#BlockIndex(blockIndex)]`.

---

## 15. Error Handling & Safety

### Trade Execution Safety
- All trades are wrapped in try/catch. A failed trade logs the error and continues to the next action.
- Quote staleness: Quotes are fetched immediately before execution. If the quote is worse than tolerance, the trade is skipped.
- Balance validation: Always re-check balance before executing to avoid insufficient funds errors.
- Pre-adjustment of `lastKnownBalance` for input tokens before `await* executeSwap` calls prevents false "Detected Outflow" entries from concurrent `reconcileBalance` calls during active trades.

### Cycle Management
- The bot should monitor its own cycle balance and log warnings when low.
- Inter-canister calls (DEX quotes, swaps) consume cycles. The bot should avoid unnecessary calls.

### Conductor Resilience
- The conductor reschedules on error (prevents stuck conductors after transient failures).
- `triggerChore` force-resets stuck conductors where `conductorActive` is `true` but no progress is being made.

### Upgrade Safety
- All conductor/task closures are transient and re-created on every canister start.
- The chore engine handles timer resumption after upgrades.
- In-progress trades that were interrupted by an upgrade are simply retried on the next chore cycle (trades are idempotent — executing the same trade twice is safe because conditions are re-evaluated).

---

## 16. Chore Purses (Isolated Chore Balances)

### Overview

By default, all chores share the same token balances in the main account. A DCA chore buying SNEED and a range-trading chore trading TACO both draw from and contribute to the same ICP balance. While this comingled model is sometimes desirable (and remains available), most users expect **isolated balances per chore**.

**Chore Purses** are a virtual accounting layer that tracks per-chore token balances. All tokens physically remain in the canister's main on-chain account, but the purse system tracks "how much of each token belongs to each chore."

The term **"Purse"** is deliberately chosen to avoid overloading "Account" (ICRC-1 concept) or "Wallet" (user wallet).

### Concepts

| Term | Meaning |
|------|---------|
| **Purse** | A virtual balance sheet tracking token balances for a chore. Each chore instance can have its own purse. |
| **Main Purse** | The default purse holding all on-chain funds not allocated to any chore-specific purse. Its balance is always **computed**: `main purse = on-chain balance − Σ chore purse balances`. Chores without their own purse share the main purse. Detected inflows and outflows are automatically reflected in the main purse. |
| **Fund** | Move tokens from a source purse (or main purse) into a target chore's purse. No on-chain transfer occurs — this is purely bookkeeping. |
| **Reclaim** | Move tokens from a chore's purse back to a target purse (or main purse). No on-chain transfer occurs. |
| **Trading Purse Override** | A setting that makes a chore trade from **another chore's purse** instead of its own or the main purse. Used for multi-strategy compositions (e.g., a stop-loss chore guarding a range-trader's purse). |

Every token in the on-chain account is accounted for: it belongs either to the **main purse** or to a **chore's purse**. Multiple chores can share the same purse via the trading purse override.

### Which Chores Get Purses

- **Trade chores**: Can have their own purse (default: enabled for new chores).
- **Rebalance chores**: Can have their own purse.
- **Move-funds chores**: Do **not** have their own purse. They operate on other chores' purses and the main purse.
- **Distribute-funds chores**: Do **not** have their own purse. They source from a specified purse and distribute to other purses or external accounts.
- **Snapshot chores**: Do **not** have their own purse.

### Behavior by Purse State

| Chore Purse State | Balance Used for Trading | Inflows / Outflows | Fund/Reclaim |
|---|---|---|---|
| **Disabled** (default for existing chores) | **Main purse** balance (shared with other purse-disabled chores) | Go to / come from the main purse | N/A |
| **Enabled** (default for new chores) | **Chore's own purse** balance only | Go to / come from the main purse (user must Fund) | Available |
| **Trading purse override set** | **Referenced chore's purse** balance | Post-trade adjustments applied to the referenced purse | Own purse managed separately (if enabled) |

The **trading purse override** takes highest priority: if set, the chore trades from the referenced purse regardless of whether its own purse is enabled. If not set, the chore uses its own purse (if enabled) or the main purse.

When no chore-specific purses exist (or none are funded), the main purse equals the full on-chain balance, so the system behaves identically to the pre-purse era.

### Data Model

```motoko
var chorePurseEnabled: [(Text, Bool)]                     // instanceId → enabled
var chorePurseBalances: [(Text, [(Text, Nat)])]           // instanceId → [(balanceKey, amount)]
var choreTradingPurseId: [(Text, Text)]                   // instanceId → purseId (cross-chore override)

// Transient (cleared on canister upgrade):
transient var _purseLocks: [(Text, Text, Int)]            // purseId → (lockingInstanceId, lockTimeNanos)
```

The `balanceKey` is simply the token principal as text: `"<tokenPrincipal>"`. There are no subaccounts.

### Defaults

- **New chore instances** (created via wizard): Purse enabled by default. The user can opt out in the wizard.
- **Existing chore instances** (created before purse feature): Not present in `chorePurseEnabled`, treated as **disabled**.

### Fund & Reclaim Mechanics

#### Fund (Source Purse → Target Purse)

```
fundPurse(instanceId, token, amount):
  1. Verify purse is enabled for the target chore
  2. Get actual on-chain balance for the token
  3. Calculate main purse balance = on-chain − Σ all chore purse balances for this token
  4. Verify amount ≤ main purse balance (when funding from main purse)
  5. Increase target chore's purse balance for this token by amount
```

No ICRC-1 transfer occurs. The main purse shrinks and the chore's purse grows by the same amount.

#### Reclaim (Chore Purse → Main Purse)

```
reclaimFromPurse(instanceId, token, amount):
  1. Verify purse is enabled for this chore
  2. Get purse balance for this token for this chore
  3. Verify amount ≤ purse balance
  4. Decrease this chore's purse balance for this token by amount
```

No ICRC-1 transfer occurs. The chore's purse shrinks and the main purse grows.

### Integration with Trade Chores

#### Helper: `getEffectivePurseId(instanceId)` and `getEffectiveBalance(instanceId, token)`

Two internal helpers resolve which purse a chore trades from and the corresponding balance:

```
getEffectivePurseId(instanceId):
    if choreTradingPurseId(instanceId) is set:
        return that purseId                      // Cross-chore override (highest priority)
    else if chorePurseEnabled(instanceId):
        return instanceId                        // Own purse
    else:
        return null                              // Main purse

getEffectiveBalance(instanceId, token):
    match getEffectivePurseId(instanceId):
        ?purseId → min(chorePurseBalance(purseId, token), onChainBalance)
        null     → min(mainPurseBalance(token), onChainBalance)
```

These helpers are used in all chore execution paths (trade, rebalance, send, distribution).

#### Trade Action (actionType 0 — Swap)

1. **Balance check**: Use `getEffectiveBalance(instanceId, inputToken)`.
2. **Balance conditions**: Evaluated against the effective balance.
3. **Trade size computation**: Uses the effective balance.
4. **Affordable cap**: `maxAffordable = min(effectiveBalance, on-chain balance) − fees × 3`. The on-chain check is a safety guard since the actual ICRC-1 transfer comes from the main account.
5. **Pre-swap**: Adjust `lastKnownBalance` for input token to prevent false outflow detection during the swap.
6. **Swap execution**: No change — the swap still happens from the main account via `executeSwap`.
7. **Post-swap success (chore has an effective purse — own, or referenced via trading purse override)**:
   - Decrease the effective purse balance for `inputToken` by `(inputAmount + inputFeesTotal)`
   - Increase the effective purse balance for `outputToken` by `(amountOut − outputFeesTotal)`
8. **Post-swap success (chore uses main purse)**: No explicit purse update needed. The computed main purse reflects on-chain changes.
9. **Post-swap failure**: Restore `lastKnownBalance` pre-adjustment. If fees were lost, adjust the effective purse accordingly.

#### Fund Purse Action (actionType 1)

Bookkeeping only: move tokens from source purse to target chore's purse.

#### Reclaim Action (actionType 2)

Bookkeeping only: move tokens from source chore's purse to target purse or main purse.

#### Send Action (actionType 3)

1. Execute ICRC-1 transfer from the bot's main account to the external destination.
2. Debit the source purse (specified by `sourcePurseId`, or main purse if null) by `(amount + fee)`.

### Integration with Rebalancer

The rebalancer uses `getEffectiveBalance` for all token balance reads. A rebalancer with its own purse (or a trading purse override) rebalances the funds in its effective purse; a rebalancer on the main purse rebalances the shared main purse funds.

### Inflow/Outflow Detection & Reconciliation

The existing `reconcileBalance` function operates on **on-chain balances** only. It does NOT interact with chore purse balances.

- **Detected inflows** (tokens sent to the bot's main account): The on-chain balance increases. Since no chore purse balances change, the **main purse** increases. The user can then Fund a chore's purse if desired.
- **Detected outflows** (unexpected balance decrease): The on-chain balance decreases. The **main purse** decreases accordingly.
- **Chore purse balance changes** are tracked explicitly by the chore execution logic after each operation.
- **Users cannot send funds directly to a chore purse** from their wallet. They send to the bot's main account (increasing the main purse), then Fund the chore's purse.

### Enabling/Disabling Purses

#### Enabling
- The purse starts with all balances at 0.
- The chore **cannot trade** until the user funds the purse.

#### Disabling
- **All purse balances must be 0** — the user must Reclaim all funds first.
- **No other chore may reference this purse** via a trading purse override. Remove the override first.
- If either condition is not met, the disable operation fails with an error.

### Chore Deletion

When a chore instance is deleted, its purse entries are removed from `chorePurseEnabled`, `chorePurseBalances`, and `choreTradingPurseId`. Any other chores whose `choreTradingPurseId` pointed to the deleted chore also have their override cleared. Since the main purse is computed (`on-chain − Σ chore purses`), deleting a chore's purse entries automatically returns those funds to the main purse.

### Main Purse Balance

The **main purse balance** for a given token is always computed, never stored:

```
main purse = on-chain balance − Σ (chore purse balances for ALL chores for this token)
```

- When `main purse < 0` (due to fee drift, unexpected outflows, or rounding), it is reported as `0` with an `overcommitted` flag.
- Chores sharing the main purse **cannot trade** while it is overcommitted (balance = 0).

### Fast Purse Loading

`getAllPurseAllocations()` is a fast **query** method that returns all purse balance data without making any inter-canister calls. The frontend uses this combined with on-chain balance data from the Wallet tab to compute main purse balances client-side, avoiding slow per-purse loading.

### Cross-Chore Purse Sharing

A chore can be configured to trade from **another chore's purse** instead of its own or the main purse. This enables multi-strategy compositions where multiple chores operate on the same pool of funds.

#### Motivation

A common pattern is pairing a primary trading strategy with a guardian:

- **Range trader** (runs every 60 min, has its own purse with funds)
- **Stop-loss** (runs every 10 min, no own purse — trades from the range trader's purse)

Without purse sharing, the stop-loss would need its own purse, requiring the user to split funds between the two chores and manually rebalance them. With purse sharing, the stop-loss directly monitors and trades from the range trader's purse.

#### Configuration

```
setTradingPurseId(instanceId, ?purseId):
  - ?purseId = set override (must point to an existing enabled purse; cannot be self)
  - null     = clear override (revert to default behavior)
```

#### Resolution Priority

When determining which purse a chore trades from:

1. **Trading purse override** (`choreTradingPurseId`) — highest priority
2. **Own purse** (if enabled via `chorePurseEnabled`)
3. **Main purse** — default

This is implemented by `getEffectivePurseId(instanceId)`, which returns `?Text` — the purse instance ID to use, or `null` for the main purse.

#### Purse Locks (Concurrency Safety)

When two chores share the same purse, concurrent trades could lead to inconsistent accounting (both read the same balance, both trade, the second purse adjustment underflows). A lightweight **purse lock** prevents this:

- Before executing a trade (or rebalance, distribution), the chore acquires a lock on its effective purse.
- If the lock is already held by another chore, the trade is **skipped** — the chore will retry at its next scheduled interval.
- After the trade completes (success or failure), the lock is released.
- Locks have a **5-minute TTL**: stale locks from trapped `await` calls are automatically evicted, making the system self-healing with no manual intervention.
- Locks are **transient** (stored in `transient var`), so they are also cleared on canister upgrade.

#### Validation & Safety

- A chore cannot reference its own purse as a trading purse override (use `enablePurse` instead).
- The target purse must be enabled before it can be referenced.
- A purse cannot be disabled while another chore references it.
- When a chore is deleted, all trading purse overrides pointing to it are also cleared.

#### Example Setup

1. Create trade chore `range-trader`, enable its purse, fund it with 100 ICP.
2. Create trade chore `stop-loss` (purse disabled — it doesn't need its own).
3. Call `setTradingPurseId("stop-loss", ?"range-trader")`.
4. `stop-loss` now reads from and writes to `range-trader`'s purse.
5. If both fire simultaneously, the purse lock ensures only one executes — the other skips and retries next cycle.

### API

```motoko
isPurseEnabled(instanceId: Text) : async Bool
enablePurse(instanceId: Text) : async ()
disablePurse(instanceId: Text) : async { #Ok; #Err: Text }

getPurseBalances(instanceId: Text) : async [PurseBalance]
getPurseBalance(instanceId: Text, token: Principal) : async Nat
getAllPurseAllocations() : async [(Text, [(Text, Nat)])]

getMainPurseBalances() : async [MainPurseBalance]
getMainPurseBalance(token: Principal) : async { balance: Nat; overcommitted: Bool }

fundPurse(instanceId: Text, token: Principal, amount: Nat) : async { #Ok; #Err: Text }
reclaimFromPurse(instanceId: Text, token: Principal, amount: Nat) : async { #Ok; #Err: Text }
manualSend(token: Principal, to: Account, amount: Nat, sourcePurseId: ?Text) : async { #Ok: Nat; #Err: Text }

// Cross-chore purse sharing
setTradingPurseId(instanceId: Text, purseId: ?Text) : async { #Ok; #Err: Text }
getTradingPurseId(instanceId: Text) : async ?Text
getResolvedPurseId(instanceId: Text) : async ?Text
```

### Permission

| ID  | Variant          | Description |
|-----|------------------|-------------|
| 214 | `#ManagePurses`  | Enable/disable chore purses and fund/reclaim operations |

### Invariants & Safety

1. **Fundamental accounting identity**: For every token:
   ```
   on-chain balance = main purse balance + Σ chore purse balances
   ```
   The main purse is always computed from this identity, never stored independently.

2. **Non-negative chore purse balances**: All chore purse balances are `Nat`. Operations that would cause underflow are **rejected** (not clamped to 0).

3. **On-chain sufficiency check**: Before executing an actual ICRC-1 transfer or swap, the chore verifies both the effective balance and the on-chain balance are sufficient.

4. **Overcommit detection**: If the main purse balance for any token is negative, a warning is logged and the `overcommitted` flag is set.

5. **Fee precision**: All fee deductions from chore purses mirror the existing `lastKnownBalance` update patterns.

6. **No concurrent modification risk**: IC canister message processing is sequential. Purse balance updates occur in the same synchronous block following an `await*`, before the next await point.

7. **Upgrade safety**: Purse state is in stable vars and persists across upgrades.

---

## 17. Frontend

### Wallet Tab

The frontend presents a unified **Wallet** tab (replacing the former separate "Accounts" and "Purses" tabs). It shows:

- **On-chain balances**: Actual ICRC-1 balances for all registered tokens in the main account.
- **Main purse balances**: Computed client-side from on-chain balances minus purse allocations.
- **Scan for Tokens**: Button to scan whitelisted tokens and auto-add any with non-zero balances to the registry.
- **Send**: Send tokens from the main purse (or a specific chore's purse) to an external ICRC-1 address.

### Chore Management

Each chore card shows:
- Purse enabled/disabled toggle.
- Per-token purse balance table with Fund/Reclaim controls.
- Action list with cumulative progress indicators (e.g., "42/100 ICP spent") and "Reset Stats" buttons.
- Collapsible "Limits" section in the action form for halt/cumulative limit configuration.

### Wizard

The wizard supports creating:
- **DCA chores**: With optional budget limit (`maxCumulativeInput`), purse isolation toggle (default: on), fund amount, and auto-start toggle (default: yes).
- **Range Trade chores**: With stop-loss action (`haltChoreAfterExecution: true`), configurable price ranges, impact/slippage tolerance.

### Circuit Breaker Tab

The Circuit Breaker tab provides:
- Global enable/disable toggle.
- Rule list with summary cards (conditions, actions, enable/disable, edit, delete).
- Rule builder with purse-aware balance/value source selection (main account, main purse, or specific chore purse).
- Event log table.
- Chore status lamps show an orange "CB" indicator when paused/stopped by a circuit breaker.

---

## 18. Inter-Bot Event System

### Overview

The **Event System** enables loosely-coupled communication between bot canisters. A bot emits events at key operational points (trades, circuit breaker triggers, neuron operations, etc.), and other bots — or the same bot — can register as listeners and execute configurable **reaction actions** when those events arrive.

The system is built as shared infrastructure (`BotEventTypes.mo` + `BotEventEngine.mo`) following the same reusable pattern as Botkeys, Bot Chores, and Botlog.

### Architecture

Each bot plays two roles:

- **Source** (emitter): Emits events, manages listener registrations, delivers events to listeners.
- **Listener** (receiver): Subscribes to events from other bots (or itself), stores reaction rules, executes actions when events arrive.

```
Source Bot                                Listener Bot
┌──────────────────────────┐              ┌───────────────────────────────┐
│  emitEvent() at key      │              │  eventSubscriptions (stable)  │
│  points in code          │              │  eventReactionRules (stable)  │
│          │               │              │           │                   │
│          ▼               │              │  onBotEvent(event)            │
│  eventDeliveryQueue      │              │    → match reaction rules     │
│  (transient)             │  inter-      │    → check conditions         │
│          │               │  canister    │    → check cooldown           │
│  delivery timer ─────────┼──────────────┼──► execute action             │
│  (demand-driven)         │   call       │                               │
│                          │              │                               │
│  eventListenerRegs       │              │                               │
│  (stable)                │              │                               │
└──────────────────────────┘              └───────────────────────────────┘
```

### Design Principles

- **Loose coupling**: The source bot has no knowledge of listener bot interfaces. It calls a generic `onBotEvent` endpoint.
- **Demand-driven delivery**: Events go into a transient queue. A timer is set only when the first event is queued; it self-chains until the queue drains, then stops. Zero cost when idle.
- **Self-event optimization**: When a bot listens to its own events, reactions are processed immediately inline — no inter-canister call.
- **Double permission check**: Botkey permissions are checked both at listener registration time and before each event delivery (handles revoked permissions).
- **No enums in stable vars**: All event type IDs, action IDs, condition operators, etc. are stored as Nat.
- **Event data as tags**: `[(Text, Text)]` key-value pairs, same pattern as Botlog tags.

### Permission System

#### New Shared Base Permissions (0–99)

| ID | Variant | Description |
|----|---------|-------------|
| 5  | `#ManageEvents` | Full control over event system: manage listener registrations, subscriptions, and reaction rules |
| 6  | `#ViewEvents` | View event listeners, subscriptions, reaction rules, and event logs |

These permissions control **managing the event system configuration itself**. They do NOT bypass per-feature permission checks — a principal still needs `ViewPortfolio`/`ViewNeuron`/`ViewChores` to access the corresponding event data.

#### Event-to-Permission Mapping

Each event type maps to an existing Botkey permission on the source bot. A listener must hold that permission to register for (and receive) the event:

| Event Range | Required Botkey on Source Bot |
|-------------|------------------------------|
| Shared events (0–19) | `ViewChores` (2) |
| Staking bot events (100–199) | `ViewNeuron` (116) |
| Trading bot events (200–299) | `ViewPortfolio` (200) |

### Event Type IDs

Event type IDs follow the same range convention as permission IDs. Stored as Nat, never as enums in stable vars.

#### Shared Base Events (0–99)

| ID | Name | Description | Key Data Fields |
|----|------|-------------|-----------------|
| 0  | `ChoreStarted` | A chore was started | choreId, choreTypeId |
| 1  | `ChoreStopped` | A chore was stopped | choreId, choreTypeId |
| 2  | `ChorePaused` | A chore was paused | choreId, choreTypeId |
| 3  | `ChoreResumed` | A chore was resumed | choreId, choreTypeId |
| 4  | `ChoreRunCompleted` | A single chore run finished successfully | choreId, choreTypeId |
| 5  | `ChoreRunFailed` | A single chore run failed | choreId, choreTypeId, error |
| 6  | `ChoreHalted` | Chore auto-halted by limit/halt flag | choreId, reason |
| 10 | `DistributionExecuted` | Distribution list completed | listId, listName, token, totalDistributed |
| 11 | `DistributionFailed` | Distribution failed | listId, listName, error |

#### Staking Bot Events (100–199)

| ID  | Name | Description | Key Data Fields |
|-----|------|-------------|-----------------|
| 100 | `NeuronStaked` | New neuron created/staked | neuronId, amountE8s |
| 101 | `NeuronDisbursed` | Neuron fully disbursed | neuronId, amountE8s, destination |
| 102 | `NeuronSplit` | Neuron split into two | sourceNeuronId, newNeuronId, amountE8s |
| 103 | `NeuronsMerged` | Neurons merged | targetNeuronId, sourceNeuronId |
| 110 | `DissolvingStarted` | Neuron dissolving began | neuronId |
| 111 | `DissolvingStopped` | Neuron re-locked | neuronId |
| 112 | `DissolveDelayChanged` | Dissolve delay modified | neuronId, delaySeconds |
| 120 | `MaturityCollected` | Maturity disbursed | neuronId, amountE8s, destination |
| 121 | `MaturityStaked` | Maturity staked | neuronId, percentage |
| 122 | `MaturitySpawned` | Maturity spawned to new neuron | neuronId, newNeuronId, percentage |
| 123 | `MaturityMerged` | Maturity merged into stake | neuronId, percentage |
| 130 | `StakeRefreshed` | Stake refreshed (ICP claimed) | neuronId |
| 131 | `StakeIncreased` | Additional ICP staked | neuronId, amountE8s |
| 140 | `VoteCast` | Vote submitted | neuronId, proposalId, vote |
| 141 | `FolloweesConfirmed` | Followees re-confirmed | neuronId, topicCount |
| 150 | `HotKeyAdded` | NNS hotkey added | neuronId, principal |
| 151 | `HotKeyRemoved` | NNS hotkey removed | neuronId, principal |
| 160 | `IcpWithdrawn` | ICP withdrawn from canister | amountE8s, destination |
| 161 | `TokenWithdrawn` | Token withdrawn from canister | token, amount, destination |

#### Trading Bot Events (200–299)

| ID  | Name | Description | Key Data Fields |
|-----|------|-------------|-----------------|
| 200 | `TradeExecuted` | Swap successfully executed | choreInstanceId, inputToken, outputToken, inputAmount, outputAmount, dexId |
| 201 | `TradeSkipped` | Trade action skipped (conditions unmet) | choreInstanceId, actionId, reason |
| 202 | `TradeFailed` | Swap attempt failed | choreInstanceId, inputToken, outputToken, error |
| 210 | `CircuitBreakerTriggered` | CB rule fired | ruleId, ruleName, actionsTaken |
| 211 | `CircuitBreakerEnabled` | Global CB enabled | — |
| 212 | `CircuitBreakerDisabled` | Global CB disabled | — |
| 220 | `TokenPaused` | Token paused globally | token |
| 221 | `TokenUnpaused` | Token unpaused | token |
| 222 | `TokenFrozen` | Token frozen globally | token |
| 223 | `TokenUnfrozen` | Token unfrozen | token |
| 230 | `RebalanceExecuted` | Rebalance trade executed | choreInstanceId, inputToken, outputToken, inputAmount, outputAmount |
| 231 | `RebalanceSkipped` | No rebalance needed | choreInstanceId, reason |
| 240 | `PurseFunded` | Tokens moved to chore purse | instanceId, token, amount |
| 241 | `PurseReclaimed` | Tokens reclaimed from purse | instanceId, token, amount |
| 242 | `SendExecuted` | Tokens sent externally | token, amount, destination |
| 243 | `SendFailed` | External send failed | token, error |
| 250 | `InflowDetected` | Unexpected inflow detected | token, amount |
| 251 | `OutflowDetected` | Unexpected outflow detected | token, amount |
| 252 | `OvercommitDetected` | Main purse overcommitted | token |
| 260 | `SnapshotTaken` | Portfolio snapshot taken | choreInstanceId |
| 270 | `CumulativeLimitReached` | Action hit cumulative budget | choreInstanceId, actionId, limitType |

### Reaction Action IDs

Actions a bot can take in response to an event. Stored as Nat. Parameters passed as `[(Text, Text)]` key-value pairs.

#### Shared Base Actions (0–99)

| ID | Name | Parameters | Required Permission (on self) |
|----|------|-----------|-------------------------------|
| 0  | `StartChore` | choreId | (manage permission for chore type) |
| 1  | `StopChore` | choreId | (manage permission for chore type) |
| 2  | `PauseChore` | choreId | (manage permission for chore type) |
| 3  | `ResumeChore` | choreId | (manage permission for chore type) |
| 4  | `TriggerChore` | choreId | (manage permission for chore type) |
| 5  | `StopAllChores` | — | (any manage chore permission) |

#### Staking Bot Actions (100–199)

| ID  | Name | Parameters | Required Permission |
|-----|------|-----------|---------------------|
| 100 | `StartDissolving` | neuronId (optional, null=all) | ConfigureDissolveState (100) |
| 101 | `StopDissolving` | neuronId (optional) | ConfigureDissolveState (100) |
| 102 | `DisburseNeuron` | neuronId (optional), toAccount (optional) | Disburse (103) |
| 103 | `StakeMaturity` | neuronId (optional), percentage | StakeMaturity (107) |
| 104 | `DisburseMaturity` | neuronId (optional), percentage, toAccount (optional) | DisburseMaturity (106) |
| 105 | `RefreshStake` | neuronId (optional) | StakeNeuron (111) |
| 106 | `IncreaseStake` | neuronId (optional), amountE8s | StakeNeuron (111) |

#### Trading Bot Actions (200–299)

| ID  | Name | Parameters | Required Permission |
|-----|------|-----------|---------------------|
| 200 | `PauseTokenGlobally` | token | ManageTokenRegistry (207) |
| 201 | `FreezeTokenGlobally` | token | ManageTokenRegistry (207) |
| 202 | `UnpauseToken` | token | ManageTokenRegistry (207) |
| 203 | `UnfreezeToken` | token | ManageTokenRegistry (207) |
| 204 | `EnableCircuitBreakers` | — | ManageCircuitBreaker (213) |
| 205 | `DisableCircuitBreakers` | — | ManageCircuitBreaker (213) |
| 206 | `FundPurse` | instanceId, token, amount | ManagePurses (214) |
| 207 | `ReclaimFromPurse` | instanceId, token, amount | ManagePurses (214) |
| 208 | `ManualSend` | token, toOwner, toSubaccount, amount, sourcePurseId | WithdrawFunds (209) |

### Data Model

#### Wire Format (inter-canister)

```
BotEvent = {
    sourceCanisterId: Principal;
    eventTypeId: Nat;
    timestamp: Int;
    data: [(Text, Text)];
    eventId: Nat;
};
```

#### Source Side (stored on the emitting bot)

```
EventListenerRegistration = {
    id: Nat;
    listenerCanisterId: Principal;
    eventTypeIds: [Nat];
    registeredAt: Int;
    enabled: Bool;
};
```

#### Listener Side (stored on the receiving bot)

```
EventSubscription = {
    id: Nat;
    sourceBotCanisterId: Principal;
    eventTypeIds: [Nat];
    registrationId: ?Nat;     // ID on source bot (for unregistration)
    enabled: Bool;
    createdAt: Int;
};

EventReactionRule = {
    id: Nat;
    name: Text;
    enabled: Bool;
    subscriptionId: Nat;      // Which subscription this rule applies to
    eventTypeId: Nat;         // Which event triggers this rule
    reactionActionId: Nat;    // What action to take
    actionParams: [(Text, Text)];
    conditions: [EventCondition];
    cooldownSeconds: ?Nat;
    lastTriggeredAt: ?Int;    // Runtime state
    triggerCount: Nat;        // Runtime state
};

EventCondition = {
    dataKey: Text;            // Key in event's data tags
    operator: Nat;            // 0=equals, 1=notEquals, 2=contains, 3=greaterThan, 4=lessThan
    value: Text;              // Compared as text; numeric parsing for > and <
};
```

#### Condition Operators

| Nat | Operator | Description |
|-----|----------|-------------|
| 0 | `equals` | Exact text match |
| 1 | `notEquals` | Not equal |
| 2 | `contains` | Substring match |
| 3 | `greaterThan` | Numeric comparison (parsed from text) |
| 4 | `lessThan` | Numeric comparison (parsed from text) |

### Stable Variables

Source side:

| Variable | Type | Description |
|----------|------|-------------|
| `eventListenerRegistrations` | `[EventListenerRegistration]` | Registered external listeners |
| `eventListenerNextId` | `Nat` | Auto-increment for registration IDs |
| `eventEmissionEnabled` | `Bool` | Global on/off for event emission |
| `eventLog` | `[BotEvent]` | Circular buffer of emitted events (audit) |
| `eventLogNextId` | `Nat` | Auto-increment for event IDs |
| `eventLogMaxEntries` | `Nat` | Max event log size (default: 500) |

Listener side:

| Variable | Type | Description |
|----------|------|-------------|
| `eventSubscriptions` | `[EventSubscription]` | Subscriptions to other bots' events |
| `eventSubscriptionNextId` | `Nat` | Auto-increment for subscription IDs |
| `eventReactionRules` | `[EventReactionRule]` | Reaction rules (event → action mappings) |
| `eventReactionNextId` | `Nat` | Auto-increment for reaction rule IDs |
| `eventReactionLog` | `[EventReactionLogEntry]` | Audit trail of executed reactions |
| `eventReactionLogNextId` | `Nat` | Auto-increment for reaction log IDs |
| `eventReactionLogMaxEntries` | `Nat` | Max reaction log size (default: 500) |

### Delivery Mechanism

1. `emitEvent(eventTypeId, data)` is called at key points in bot code.
2. Event is added to the `eventLog` circular buffer.
3. For each matching self-listener (same canister): reactions are processed immediately inline.
4. For external listeners: event is added to the transient `_eventDeliveryQueue`.
5. If no delivery timer is running, a 2-second timer is set.
6. The delivery timer processes queued events:
   a. For each pending delivery, re-check Botkey permission for the listener.
   b. If permission still valid, call `onBotEvent` on the listener canister.
   c. Log delivery success/failure.
7. If queue still has items, re-schedule timer. Otherwise, timer stops.

### API — Source Side

```motoko
registerEventListener(req: RegisterListenerRequest) : async { #Ok: Nat; #Err: Text }
unregisterEventListener(listenerId: Nat) : async ()
updateEventListenerTypes(listenerId: Nat, newEventTypeIds: [Nat]) : async { #Ok; #Err: Text }
getEventListeners() : async [EventListenerRegistration]
setEventEmissionEnabled(enabled: Bool) : async ()
getEventLog(query: EventLogQuery) : async EventLogResult
getEventTypes() : async [(Nat, Text)]   // List all event types this bot emits
```

### API — Listener Side

```motoko
addEventSubscription(sourceBotId: Principal, eventTypeIds: [Nat]) : async { #Ok: Nat; #Err: Text }
removeEventSubscription(id: Nat) : async ()
updateEventSubscription(id: Nat, newEventTypeIds: [Nat]) : async { #Ok; #Err: Text }
getEventSubscriptions() : async [EventSubscription]
addEventReaction(input: EventReactionRuleInput) : async Nat
updateEventReaction(id: Nat, input: EventReactionRuleInput) : async ()
removeEventReaction(id: Nat) : async ()
getEventReactions() : async [EventReactionRule]
getEventReactionLog(query: EventReactionLogQuery) : async EventReactionLogResult
getAvailableReactionActions() : async [(Nat, Text)]   // List all actions this bot supports
onBotEvent(event: BotEvent) : async { #Ok; #Err: Text }   // Called by source bots
```

### Registration Flow

1. User adds the listener bot's canister principal as a Botkey on the source bot, granting it appropriate view permission (e.g., `#ViewPortfolio`).
2. User calls `addEventSubscription` on the listener bot, specifying the source bot and desired events.
3. The listener bot calls `registerEventListener` on the source bot.
4. Source bot checks Botkeys: does the listener's principal have the required permission for each requested event type?
5. If approved, registration is stored; the registration ID is returned and saved in the subscription.
6. User then adds reaction rules on the listener bot: "When event X arrives, execute action Y with params Z."

### Example Use Cases

**Staking bot dissolves neurons when trading bot circuit breaker fires:**
1. Give staking bot's PID `#ViewPortfolio` (200) on trading bot.
2. On staking bot: `addEventSubscription(tradingBotPID, [210])` (CircuitBreakerTriggered).
3. On staking bot: `addEventReaction({ subscriptionId, eventTypeId: 210, reactionActionId: 100, actionParams: [], ... })` (StartDissolving).
4. When trading bot CB fires → event 210 emitted → delivered to staking bot → staking bot starts dissolving.

**Trading bot distributes incoming ICP from staking bot:**
1. Give trading bot's PID `#ViewChores` (2) on staking bot.
2. On trading bot: `addEventSubscription(stakingBotPID, [10])` (DistributionExecuted).
3. On trading bot: `addEventReaction({ subscriptionId, eventTypeId: 10, reactionActionId: 4, actionParams: [("choreId", "distribute-funds-1")], ... })` (TriggerChore).
4. When staking bot distributes ICP → event 10 emitted → delivered to trading bot → trading bot triggers its distribute-funds chore.

---

## Appendix A: Numeric Action Type Map

| Nat | ActionType Variant |
|-----|-------------------|
| 0   | `#Trade`          |
| 1   | `#FundPurse`      |
| 2   | `#Reclaim`        |
| 3   | `#Send`           |

These are NEVER stored as variants in stable storage — only the Nat values are stored.

## Appendix B: Numeric DEX ID Map

| Nat | DexId Variant |
|-----|---------------|
| 0   | `#ICPSwap`    |
| 1   | `#KongSwap`   |

These are NEVER stored as variants in stable storage — only the Nat values are stored.
