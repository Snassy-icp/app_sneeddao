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
| 215 | `#ExecuteOneOffTrade`    | Submit, view, and cancel one-off trades |

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

// One-Off Trades
var oneOffTradeQueue: [OneOffTradeEntry]
var oneOffTradeNextId: Nat
var oneOffTradeMaxEntries: Nat                                // Default: 50

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

### One-Off Trades
```motoko
submitOneOffTrade(input: OneOffTradeInput) : async { #Ok: Nat; #Err: Text }
getOneOffTradeQueue() : async [OneOffTradeEntry]
cancelOneOffTrade(id: Nat) : async { #Ok; #Err: Text }
clearOneOffTradeHistory() : async ()
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
| 280 | `OneOffTradeExecuted` | One-off trade completed | tradeId, inputToken, outputToken, inputAmount, outputAmount, dexId |
| 281 | `OneOffTradeFailed`   | One-off trade failed | tradeId, inputToken, outputToken, error |

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

## 19. One-Off Trades

### Overview

One-Off Trades allow users to submit ad-hoc token swaps to the bot for immediate execution, without configuring a recurring chore. The trade is placed in a queue, processed by a demand-driven timer (one trade at a time), and follows the same execution pipeline as chore-based trades — including metadata fetch, quote aggregation, pre/post-trade snapshots, and trade logging.

One-off trades default to the **main purse** but can optionally target any enabled chore purse via the `sourcePurseId` parameter. When a chore purse is specified, the trade acquires a purse lock, uses the purse balance for sufficiency checks, and performs full debit/credit bookkeeping after execution (matching the pattern used by trade chore actions). Circuit breaker rules are evaluated before each queued trade executes — if CB actions freeze the involved tokens, the trade fails.

### Permission

| ID  | Variant                | Description |
|-----|------------------------|-------------|
| 215 | `#ExecuteOneOffTrade`  | Submit, view, and cancel one-off trades |

### Input Type

```
OneOffTradeInput = {
    inputToken: Principal;
    outputToken: Principal;
    inputAmount: Nat;
    minOutputAmount: ?Nat;         // Minimum acceptable output; trade rejected if best quote is below this
    maxSlippageBps: ?Nat;          // Slippage tolerance; null = use defaultSlippageBps
    maxPriceImpactBps: ?Nat;       // Price impact limit; null = use defaultMaxPriceImpactBps
    preferredDex: ?Nat;            // null = auto (quote all enabled DEXes, pick best); 0 = ICPSwap; 1 = KongSwap
    sourcePurseId: ?Text;          // null = main purse; else chore instanceId whose purse to trade from
}
```

### Queue Entry Type

```
OneOffTradeEntry = {
    id: Nat;
    inputToken: Principal;
    outputToken: Principal;
    inputAmount: Nat;
    minOutputAmount: ?Nat;
    maxSlippageBps: ?Nat;
    maxPriceImpactBps: ?Nat;
    preferredDex: ?Nat;
    sourcePurseId: ?Text;          // null = main purse; else chore instanceId
    submittedBy: Principal;
    submittedAt: Int;
    status: Nat;                   // 0=Pending, 1=Processing, 2=Completed, 3=Failed, 4=Cancelled
    outputAmount: ?Nat;            // Actual output received (set on completion)
    dexUsed: ?Nat;                 // DEX that executed the trade
    errorMessage: ?Text;           // Error details (set on failure)
    completedAt: ?Int;             // Timestamp of completion/failure
    tradeLogId: ?Nat;              // Reference to the trade log entry
}
```

Status values (stored as Nat, not enum):

| Nat | Status     |
|-----|------------|
| 0   | Pending    |
| 1   | Processing |
| 2   | Completed  |
| 3   | Failed     |
| 4   | Cancelled  |

### Stable Variables

```
var oneOffTradeQueue: [OneOffTradeEntry]     // All entries (pending, processing, completed, failed, cancelled)
var oneOffTradeNextId: Nat                   // Auto-increment counter
var oneOffTradeMaxEntries: Nat               // Max entries retained (default: 50); oldest completed/failed are pruned
```

### Execution Flow

When a trade is submitted via `submitOneOffTrade`:

1. Validate inputs: both tokens must be in the registry, input amount > 0, tokens not paused/frozen.
2. If `sourcePurseId` is specified, verify the purse exists and is enabled.
3. Create a `OneOffTradeEntry` with `status = 0` (Pending), append to queue.
4. If no processing timer is active, start one (2-second delay).
5. Return the entry ID immediately (the caller does not wait for execution).

The **processing timer** (demand-driven, same pattern as event delivery):

1. Find the first entry with `status = 0` (Pending). If none, stop (no reschedule).
2. Mark it `status = 1` (Processing).
3. **Phase 0 — Metadata refresh**: Fetch token metadata for both trade tokens AND all tokens referenced by circuit breaker conditions.
4. **Phase 0b — CB price fetch**: For each token pair referenced by enabled CB rules, fetch a price quote (if not already cached) so CB conditions have fresh data.
5. **Phase 1 — Circuit breaker evaluation**: Run `evaluateCircuitBreakerRules` (same function used by the trade/rebalance conductors). If CB actions freeze either trade token, the trade fails.
6. **Phase 2 — Purse lock**: If `sourcePurseId` is set, verify the purse is still enabled and acquire a purse lock. If the lock is held by another operation, fail the trade. (Main purse trades skip this phase.)
7. **Phase 3 — Balance check**: Resolve the effective balance from the specified purse (`getChorePurseBalance`) or main purse (`computeMainPurseBalance`). Verify sufficiency.
8. **Pre-trade snapshot**: Take a portfolio snapshot of `[inputToken, outputToken]` with phase `#Before`.
9. **Quote & execute**: Follow the same logic as `executeTradeSwap`:
   - Get quotes (all DEXes or preferred DEX). Apply impact-aware selection.
   - Check `minOutputAmount`: if best quote's `expectedOutput < minOutputAmount`, fail the trade.
   - Compute slippage tolerance, execute swap via `executeSwap`.
10. **Purse bookkeeping** (if trading from a chore purse):
    - On success: debit `actualTradeSize` of input token, credit `netAmountOut` of output token (fees come out of main purse via balance reconciliation, matching trade chore behavior).
    - On failure: debit lost fees from the purse.
11. **Post-trade snapshot**: Take snapshot with phase `#After`.
12. **Purse unlock**: Release the purse lock (if acquired).
13. **Update entry**: Set `status = 2` (Completed) or `3` (Failed), fill in `outputAmount`, `dexUsed`, `errorMessage`, `completedAt`, `tradeLogId`.
14. **Log**: Append to the trade log with `choreId = null`, `choreTypeId = ?"one-off"`, `actionId = ?id`.
15. **Emit event**: `OneOffTradeExecuted` (280) or `OneOffTradeFailed` (281) with appropriate data tags.
16. **Prune**: If queue size exceeds `oneOffTradeMaxEntries`, remove oldest completed/failed/cancelled entries.
17. **Reschedule**: If more pending entries exist, set a 2-second timer for the next trade. Otherwise, stop.

### Error Handling

- If any step (metadata fetch, quote, swap) throws, the trade is marked `status = 3` (Failed) with the error message. Processing continues to the next pending trade.
- Token pause/freeze is checked at submission time and again at execution time. The CB evaluation phase may freeze tokens between submission and execution.
- Circuit breaker rules are evaluated fresh before each queued trade. If CB actions freeze either token, the trade fails immediately with a message noting the CB trigger.
- If `sourcePurseId` is specified but the purse is no longer enabled at execution time, or the purse lock cannot be acquired, the trade fails.
- Insufficient balance (main purse or specified chore purse) at execution time → trade fails with an explanatory message.
- Purse locks have a TTL safety net: if a trade traps unexpectedly after acquiring the lock, the lock auto-expires (same pattern as chore conductors).

### API

```motoko
submitOneOffTrade(input: OneOffTradeInput) : async { #Ok: Nat; #Err: Text }
getOneOffTradeQueue() : async [OneOffTradeEntry]
cancelOneOffTrade(id: Nat) : async { #Ok; #Err: Text }
clearOneOffTradeHistory() : async ()
```

### Event

| ID  | Name                  | Description | Key Data Fields |
|-----|-----------------------|-------------|-----------------|
| 280 | `OneOffTradeExecuted` | One-off trade completed | tradeId, inputToken, outputToken, inputAmount, outputAmount, dexId |
| 281 | `OneOffTradeFailed`   | One-off trade failed | tradeId, inputToken, outputToken, error |

### Frontend

The trading bot page includes a **Quick Trade** panel (visible when the user has `ExecuteOneOffTrade` permission) with:

- **Input token** selector (from token registry)
- **Output token** selector (from token registry)
- **Input amount** field (with token decimals formatting)
- **Min output amount** field (optional)
- **Slippage tolerance** field (optional, default shown from bot settings)
- **Max price impact** field (optional)
- **DEX selector**: Auto (best quote) / ICPSwap / KongSwap
- **Source purse** selector: Main Purse (default) or any enabled chore purse
- **Submit** button
- **Queue display**: Table/list showing pending, processing, and recent completed/failed trades with status indicators, source purse label, DEX used, and results.

---

## 18. Configuration DSL

### Overview

The Configuration DSL ("SneedScript") is a human-readable domain-specific language for declaratively configuring the trading bot. It provides two complementary capabilities:

1. **Serialization (Export)**: Produces a complete, human-readable text snapshot of the bot's current configuration and key runtime stats.
2. **DSL Programs (Import)**: Accepts a text program of idempotent configuration statements that resolve into a list of canister operations for review and execution.

Both serialization and DSL parsing happen entirely in the frontend (no Motoko changes needed for the DSL itself). The serialization queries the canister for all configuration state and stitches it into a valid DSL document, enriched with stats as comments.

### Workflow

The primary use case is LLM-assisted configuration:

1. **Export**: User clicks "Export" → frontend queries all bot state → produces DSL text.
2. **Prompt**: User pastes the DSL text + their trading objectives into an LLM.
3. **Generate**: LLM produces a DSL program with the desired changes.
4. **Parse**: User pastes the DSL program into the frontend editor → parser produces an AST.
5. **Resolve**: Resolver maps AST statements → ordered list of canister operations, diffing against current state where possible.
6. **Review**: User sees every operation that will be executed, with human-readable descriptions.
7. **Execute**: User approves → operations execute sequentially against the canister.

### Backend Change: Action Key Field

To support idempotent `ensure`/`remove` on trade actions and move-funds actions (which lack a natural key), add a `key: Text` field to `ActionConfig` and `ActionConfigInput`.

**Auto-generation**: When `key` is empty on `addTradeAction` / `addMoveFundsAction`, the canister generates one from the action properties: `"trade-ICP-SNEED"`, `"fund-ICP"`, `"reclaim-SNEED"`, `"send-ICP"`. On collision within the same chore instance, append `-2`, `-3`, etc.

**Uniqueness**: Enforced within the chore instance scope. The `addTradeAction`/`updateTradeAction`/`addMoveFundsAction`/`updateMoveFundsAction` endpoints reject duplicate keys within the same instance.

**Migration**: Existing keyless actions receive auto-generated keys on the next `postupgrade`.

### DSL Syntax

#### Comments

Lines starting with `#` are comments. They are ignored by the parser but are used extensively in the serialized export to embed read-only stats.

```
# This is a comment
# Balance: 125.50 ICP | Price: $12.34 USD
```

#### Literals

| Type | Examples | Notes |
|------|----------|-------|
| Integer | `100`, `10_000_000` | Underscores ignored |
| Decimal | `1.5`, `0.0001` | Converted to raw units using token decimals |
| Amount | `1.5 ICP`, `0.0001 SNEED` | Decimal + token symbol → raw units |
| Basis points | `100 bps`, `500 bps` | Passed as-is (already Nat) |
| Duration | `300s`, `5m`, `1h` | Converted to seconds |
| Boolean | `true`, `false` | |
| String | `"hello"` | Double-quoted |
| Principal | `"ryjl3-tyaaa-aaaaa-aaaba-cai"` | Double-quoted, validated |
| None | `none` | Represents null/absent optional value |
| List | `[ICP, SNEED, ckUSDC]` | Square brackets, comma-separated |

#### Token References

Tokens are referenced by symbol (unquoted identifier) or by explicit principal (quoted string).

```
ICP                                    # Symbol lookup from token registry
"ryjl3-tyaaa-aaaaa-aaaba-cai"        # Explicit principal
```

**Resolution rules** (in order):
1. If only one token with that symbol is registered to the bot → use it.
2. If multiple registered tokens share the symbol → error (require explicit principal).
3. If no registered token matches but exactly one is known from the metadata cache → use it (for `ensure token` statements that are about to register it).
4. Otherwise → error.

#### Statements

There are four statement types:

**`ensure`** — Idempotent upsert. If the entity exists (matched by key), update it. If not, create it.

```
ensure <entity_type> <key> [in <scope>] {
  <property>: <value>
  ...
}
```

**`remove`** — Idempotent delete. If the entity exists, remove it. If not, no-op.

```
remove <entity_type> <key> [from <scope>]
```

**`set`** — Set a specific value. Idempotent (setting to current value is a no-op).

```
set <target> <property>: <value>
```

**`submit`** — Imperative action (not idempotent). Used for quick trades, withdrawals, fund/reclaim operations.

```
submit <action_type> {
  <property>: <value>
  ...
}
```

### Entity Reference

#### token

Key: token symbol or principal.

```
ensure token ICP {
  ledger: "ryjl3-tyaaa-aaaaa-aaaba-cai"
  symbol: "ICP"
  decimals: 8
  fee: 0.0001 ICP
}

remove token SNEED

set token ICP paused: true
set token ICP frozen: true
set token ICP paused: false
set token ICP frozen: false
```

The `ensure` resolves to `addToken` if not in registry, or no-op if already registered with matching properties. `remove` resolves to `removeToken`. Pause/freeze `set` statements resolve to `pauseToken`/`unpauseToken`/`freezeToken`/`unfreezeToken`.

#### chore

Key: chore instance ID (string).

```
ensure chore "trade-1" {
  type: trade
  label: "Main Trading Chore"
}

set chore "trade-1" interval: 300s
set chore "trade-1" max_interval: 600s
set chore "trade-1" task_timeout: 120s
set chore "trade-1" status: running
set chore "trade-1" status: paused
set chore "trade-1" status: stopped

remove chore "trade-1"
```

`ensure` resolves to `createChoreInstance` if not found, or `renameChoreInstance` if label changed. `set status` resolves to `startChore`/`pauseChore`/`resumeChore`/`stopChore` depending on current state. `remove` resolves to `deleteChoreInstance`.

#### action

Key: action key (string), scoped to a chore instance. Used for both trade chore actions and move-funds chore actions.

```
ensure action "buy-sneed-dip" in "trade-1" {
  type: trade
  enabled: true
  input: ICP
  output: SNEED
  min_amount: 0.1 ICP
  max_amount: 1.0 ICP
  amount_mode: range
  balance_percent: none
  preferred_dex: auto
  min_balance: 5.0 ICP
  max_balance: none
  balance_denomination: ICP
  min_price: none
  max_price: 0.001 ICP
  price_denomination: ICP
  max_price_impact: 300 bps
  max_slippage: 100 bps
  min_frequency: 300s
  max_frequency: 600s
  trade_size_denomination: ICP
  trailing_stop: 500 bps
  trailing_stop_direction: stop_loss
  trailing_stop_reset: on_exec
  halt_chore_after: false
  max_cumulative_input: 100.0 ICP
  max_cumulative_output: none
  max_executions: 50
}

ensure action "fund-trade-purse" in "mover-1" {
  type: fund_purse
  enabled: true
  input: ICP
  target_purse: "trade-1"
  min_amount: 1.0 ICP
  max_amount: 5.0 ICP
}

remove action "buy-sneed-dip" from "trade-1"
```

The resolver determines whether the scope is a trade chore or move-funds chore from the chore's type and uses the corresponding API (`addTradeAction`/`updateTradeAction` or `addMoveFundsAction`/`updateMoveFundsAction`). Matching is by the `key` field.

When creating a new action, the DSL key becomes the action's `key` field. When updating, the resolver matches by key and uses the existing numeric `id`.

`reset_stats action "buy-sneed-dip" in "trade-1"` can be used to reset cumulative stats (`resetActionStats`).

#### rebalance_target

Key: token symbol/principal, scoped to a rebalance chore instance.

```
ensure rebalance_target ICP in "rebalance-1" {
  target: 5000 bps
  paused: false
}

remove rebalance_target SNEED from "rebalance-1"
```

Since rebalance targets are set as a complete list (`setRebalanceTargets`), the resolver collects all `ensure`/`remove` target statements for the same instance, diffs against current targets, and emits a single `setRebalanceTargets` call.

#### rebalance settings

Set-only (no ensure/remove — these are scalar settings, not entities).

```
set rebalance "rebalance-1" denomination: ICP
set rebalance "rebalance-1" max_trade_size: 10.0 ICP
set rebalance "rebalance-1" min_trade_size: 0.1 ICP
set rebalance "rebalance-1" threshold: 500 bps
set rebalance "rebalance-1" max_slippage: 100 bps
set rebalance "rebalance-1" max_price_impact: 300 bps
set rebalance "rebalance-1" fallback_route_tokens: [ICP, ckUSDC]
```

Each `set` resolves to the corresponding setter (`setRebalanceDenominationToken`, etc.). The resolver skips calls where the value already matches current state.

#### distribution

Key: distribution list name, scoped to a distribute-funds chore instance.

```
ensure distribution "team-pay" in "dist-1" {
  token: ICP
  threshold: 1.0 ICP
  max_amount: 10.0 ICP
  min_amount: 0.5 ICP
  amount_mode: range
  balance_percent: none
  source_purse: none
  targets: [
    { account: "aaaaa-bbbbb-ccccc-ddddd-cai", share: 5000 bps }
    { account: "eeeee-fffff-ggggg-hhhhh-cai", share: 3000 bps }
    { purse: "trade-1", share: 2000 bps }
  ]
}

remove distribution "team-pay" from "dist-1"
```

Matched by name. `ensure` resolves to `addDistributionList` or `updateDistributionList`. `remove` resolves to `removeDistributionList`.

#### circuit_breaker

Key: rule name.

```
set circuit_breaker_enabled: true

ensure circuit_breaker "crash-protection" {
  enabled: true
  when ALL {
    price ICP/ckUSDC < 5.0 ckUSDC
    balance ICP in main > 10.0 ICP
  }
  then {
    stop chore "trade-1"
    freeze token SNEED
  }
}

ensure circuit_breaker "whale-alert" {
  enabled: true
  when ANY {
    balance ICP in "trade-1" < 1.0 ICP
    value ALL in main denominated_in ICP < 50.0 ICP
  }
  then {
    pause all chores
  }
}

remove circuit_breaker "crash-protection"
```

Condition syntax within `when ALL { ... }` / `when ANY { ... }` blocks:

| Condition | Syntax |
|-----------|--------|
| Price threshold | `price TOKEN1/TOKEN2 <OP> <amount>` |
| Balance threshold | `balance TOKEN in <purse> <OP> <amount>` |
| Value threshold | `value <sources> denominated_in TOKEN <OP> <amount>` |
| Percent change | `price TOKEN1/TOKEN2 changed <dir> <bps> in <duration>` |
| Nested AND | `ALL { ... }` |
| Nested OR | `ANY { ... }` |

Operators: `>`, `<`, `in_range(<min>, <max>)`, `outside_range(<min>, <max>)`.
Purse references: `main`, `"chore-id"`, or `__main__` (full on-chain).
Value sources: `TOKEN in <purse>`, `ALL in <purse>`, `ALL in account`.
Change directions: `up`, `down`, `either`.

Action syntax within `then { ... }` blocks:

| Action | Syntax |
|--------|--------|
| Stop chore | `stop chore "id"` |
| Pause chore | `pause chore "id"` |
| Start chore | `start chore "id"` |
| Stop all by type | `stop all TYPE chores` |
| Pause all by type | `pause all TYPE chores` |
| Start all by type | `start all TYPE chores` |
| Stop all | `stop all chores` |
| Pause all | `pause all chores` |
| Pause token in rebal | `pause token TOKEN in "rebal-id"` |
| Pause token globally | `pause token TOKEN` |
| Freeze token | `freeze token TOKEN` |

Matched by `name`. `ensure` resolves to `addCircuitBreakerRule` or `updateCircuitBreakerRule`. `remove` resolves to `removeCircuitBreakerRule`.

#### DEX settings

Set-only.

```
set dex ICPSwap enabled: true
set dex KongSwap enabled: false
set default_slippage: 100 bps
set default_max_price_impact: 300 bps
```

#### Purse management

```
set purse "trade-1" enabled: true
set purse "trade-1" enabled: false
set purse "trade-1" trading_purse: "rebalance-1"
set purse "trade-1" trading_purse: none
```

`set purse ... enabled: true` → `enablePurse`. `set purse ... enabled: false` → `disablePurse`. `set purse ... trading_purse` → `setTradingPurseId`.

Fund and reclaim are imperative:

```
submit fund_purse { purse: "trade-1", token: ICP, amount: 5.0 ICP }
submit reclaim { purse: "trade-1", token: ICP, amount: 2.0 ICP }
```

#### Event system

**Subscriptions** — keyed by source bot principal (one subscription per source bot):

```
ensure event_subscription to "aaaaa-bbbbb-ccccc-ddddd-cai" {
  event_types: [ChoreStarted, ChoreStopped, TradeExecuted]
}

remove event_subscription to "aaaaa-bbbbb-ccccc-ddddd-cai"
```

The resolver looks up existing subscriptions by source principal. If found, updates event types via `updateEventSubscription`. If not, creates via `addEventSubscription`. Remove calls `removeEventSubscription`.

**Reactions** — keyed by rule name:

```
ensure event_reaction "stop-on-staker-fail" {
  enabled: true
  subscription: "aaaaa-bbbbb-ccccc-ddddd-cai"
  event_type: ChoreRunFailed
  action: stop_chore
  action_params: {
    choreInstanceId: "trade-1"
  }
  conditions: [
    { key: "choreId", op: equals, value: "unstake" }
  ]
  cooldown: 300s
}

remove event_reaction "stop-on-staker-fail"
```

`subscription` references a subscription by its source bot principal. The resolver maps this to the numeric subscription ID. Matched by `name`. `ensure` resolves to `addEventReaction` or `updateEventReaction`. `remove` resolves to `removeEventReaction`.

**Event emission**:

```
set event_emission: true
set event_emission: false
```

#### Logging settings

```
set logging trade_log: true
set logging portfolio_log: true
set logging max_trade_log_entries: 10000
set logging max_portfolio_log_entries: 5000

set chore_logging "trade-1" trade_log: true
set chore_logging "trade-1" portfolio_log: false

remove chore_logging "trade-1"
```

`set logging` resolves to `setLoggingSettings`. `set chore_logging` resolves to `setChoreLoggingOverride`. `remove chore_logging` resolves to `removeChoreLoggingOverride`.

#### Price and metadata settings

```
set price_staleness: 300s
set metadata_staleness: 3600s
set price_history_max_size: 5000
```

#### Fallback route tokens

```
set trade "trade-1" fallback_route_tokens: [ICP, ckUSDC]
```

Resolves to `setTradeFallbackRouteTokens`.

### Imperative Operations (submit)

#### Quick trade

```
submit trade {
  input: ICP
  output: SNEED
  amount: 1.5 ICP
  min_output: none
  slippage: 100 bps
  max_price_impact: 300 bps
  dex: auto
  source_purse: none
}
```

Resolves to `submitOneOffTrade`.

#### Withdraw

```
submit withdraw {
  token: ICP
  to: "aaaaa-bbbbb-ccccc-ddddd-cai"
  amount: 10.0 ICP
}
```

Resolves to `withdrawToken`.

#### Send

```
submit send {
  token: ICP
  to: "aaaaa-bbbbb-ccccc-ddddd-cai"
  amount: 5.0 ICP
  source_purse: "trade-1"
}
```

Resolves to `manualSend`.

### Serialization (Export)

The serializer runs entirely in the frontend. It queries all relevant canister endpoints and produces a valid DSL document that, if executed against an empty bot, would recreate the current configuration.

Read-only stats (balances, execution counts, prices, timestamps) appear as `#` comments above the relevant blocks, providing context to the LLM without affecting parseability.

**Export structure** (in order):

```
# ==========================================
# Sneed Trading Bot Configuration Export
# Exported: <timestamp>
# Canister: <principal>
# Version: <major>.<minor>.<patch>
# ==========================================

# ---- Token Registry ----
# <per-token: balance, price, paused/frozen status>
ensure token ... { ... }

# ---- DEX Settings ----
set dex ...
set default_slippage: ...
set default_max_price_impact: ...

# ---- Global Settings ----
set circuit_breaker_enabled: ...
set price_staleness: ...
set metadata_staleness: ...
set event_emission: ...

# ---- Logging ----
set logging ...

# ---- Chore Instances ----
# <per-chore: status, run stats, next run>
ensure chore ... { ... }
set chore ... interval: ...
set chore ... status: ...

# ---- Trade Actions (per trade chore) ----
# <per-action: execution count, cumulative amounts, last exec time>
ensure action ... in ... { ... }

# ---- Move Funds Actions (per move-funds chore) ----
ensure action ... in ... { ... }

# ---- Rebalance Configuration (per rebalance chore) ----
set rebalance ... denomination: ...
# ... other settings ...
ensure rebalance_target ... in ... { ... }

# ---- Distribution Lists (per distribute-funds chore) ----
ensure distribution ... in ... { ... }

# ---- Circuit Breaker Rules ----
ensure circuit_breaker ... { ... }

# ---- Purse Configuration ----
# <per-purse: balances>
set purse ... enabled: ...

# ---- Event System ----
ensure event_subscription ... { ... }
ensure event_reaction ... { ... }

# ---- Per-Chore Logging Overrides ----
set chore_logging ... ...
```

**Queries made by the serializer** (all read-only):

- `getTokenRegistry()`, `getPausedTokens()`, `getFrozenTokens()`
- `getEnabledDexes()`, `getSupportedDexes()`
- `getCircuitBreakerEnabled()`, `getCircuitBreakerRules()`
- `getChoreStatuses()`, `listChoreInstances()`
- `getTradeActions(id)`, `getMoveFundsActions(id)` (per chore)
- `getTradeFallbackRouteTokens(id)` (per trade chore)
- `getRebalanceSettings(id)`, `getRebalanceTargets(id)` (per rebalance chore)
- `getDistributionLists(id)` (per distribute-funds chore)
- `getAllPurseAllocations()`, `getMainPurseBalances()`
- `getTradingPurseId(id)` (per chore)
- `getEventSubscriptions()`, `getEventReactions()`
- `getLoggingSettings()`, `getChoreLoggingOverrides()`
- `getLastKnownPrices()`, `getPriceStaleness()`, `getMetadataStaleness()`
- `getPriceHistoryMaxSize()`

Stats included as comments (enrichment queries):

- `getCapitalFlows()` — capital deployed, per-token flows
- `getTradeLogStats()` — total trade entries
- `getLastKnownPrices()` — current price for each token pair

### Resolver

The resolver takes the parsed AST and the current bot state (fetched at resolve time) and produces an ordered list of operations. Each operation is a record:

```javascript
{
  type: "call",                     // or "no-op" for unchanged state
  method: "addTradeAction",         // canister method name
  args: [...],                      // method arguments
  description: "Add trade action 'buy-sneed-dip' to chore 'trade-1'",
  category: "trade_actions",        // for grouping in the review UI
  sourceStatement: { line: 42, ... } // back-reference to DSL source
}
```

**Resolver behaviors**:

- **Idempotent skipping**: If `ensure` would result in no changes (all properties match current state), emit a `no-op` operation instead of a call. Show these as "already up to date" in the review UI.
- **Statement ordering**: `ensure token` statements are processed first (tokens must exist before referencing them). Then chore instances, then actions/targets/settings, then circuit breakers, then event system. `submit` statements go last.
- **Rebalance target batching**: All `ensure rebalance_target` and `remove rebalance_target` for the same instance are batched into a single `setRebalanceTargets` call.
- **Validation**: The resolver validates token references, chore instance references, and key uniqueness before producing operations. Errors are reported with line numbers.

### Frontend Implementation

The DSL feature is implemented as a new **"Script"** tab in the trading bot page, available to users with appropriate permissions. Components:

1. **Editor panel**: Text editor (monospace, syntax-highlighted) for writing/pasting DSL programs.
2. **Export button**: Queries all state and populates the editor with the serialized export.
3. **Parse button**: Parses the editor contents and shows the resolved operation list.
4. **Operation review panel**: Shows each resolved operation with description, category, and current→new value diffs. No-ops shown as greyed out. User can toggle individual operations on/off.
5. **Execute button**: Runs the approved operations sequentially, showing progress and results.

The implementation lives in:
- `src/app_sneeddao_frontend/src/dsl/parser.js` — Tokenizer + recursive descent parser
- `src/app_sneeddao_frontend/src/dsl/serializer.js` — State-to-DSL-text serializer
- `src/app_sneeddao_frontend/src/dsl/resolver.js` — AST-to-operations resolver
- `src/app_sneeddao_frontend/src/components/TradingBotDSLPanel.jsx` — UI component

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
