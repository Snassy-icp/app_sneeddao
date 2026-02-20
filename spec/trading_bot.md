# Sneed Trading Bot — Specification

## 1. Overview

The **Sneed Trading Bot** is an autonomous trading canister on the Internet Computer that executes token swaps on supported DEXes (ICPSwap, KongSwap, and future additions). It reuses the shared bot infrastructure — **Botkeys** (fine-grained permissions), **Bot Chores** (recurring scheduled work), and **Botlog** (structured logging) — established by the Sneed ICP Staking Bot.

### Core Capabilities

1. **Trade Chore** — Execute a configurable list of conditional trades (with deposit/withdraw/send actions) on a recurring schedule.
2. **Rebalance Chore** — Automatically rebalance a portfolio toward user-defined target allocations by picking weighted-random over/underweight token pairs and trading them.
3. **Move Funds Chore** — Execute deposit/withdraw/send actions on a recurring schedule (no trading).
4. **DEX Aggregator** — Backend library for quoting and executing swaps across multiple DEXes, mirroring the frontend `DexAggregator` API pattern.
5. **Named Subaccounts** — User-managed named subaccounts for organizing funds, with deposit/withdraw/send between them.

### Design Principles

- **Reuse shared infrastructure**: Botkeys, Bot Chores, Botlog — same integration pattern as the staking bot.
- **No enums in stable vars**: All enumerations are stored as numeric indexes with transient runtime maps to variants (per `motoko_pnp.md`).
- **Individual stable vars**: No config record objects — each setting is its own stable var to avoid upgrade migrations.
- **Multi-instance chores**: Trade chores and Move Funds chores support multiple instances. The rebalancer is single-instance by default but supports multi-instance for managing multiple portfolios.
- **Trades only from main account**: DEX APIs (ICPSwap, Kong) do not support swapping from subaccounts, so all actual swaps operate on the canister's main account (null subaccount). Deposit/Withdraw/Send actions move funds between subaccounts and the main account.

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
| 200 | `#ViewPortfolio`         | View balances, subaccounts, portfolio state |
| 201 | `#ManageSubaccounts`     | Create/rename/delete named subaccounts |
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

### Global Token Pause & Freeze

Tokens can be **paused** or **frozen** at the account level (globally, across all chores):

- **Paused** (`pausedTokens: [Principal]`): The token will **not be traded** by any rebalancer chore or trade action in any trade chore. Deposit, withdraw, send, and distribution actions are still allowed.
- **Frozen** (`frozenTokens: [Principal]`): The token will **not be traded AND not be moved** — no trades, deposits, withdraws, sends, or distributions involving this token will execute. This is a superset of paused.

A frozen token is implicitly paused (no need to add it to both lists). The checks are:
- **Trade actions** (swap): Skip if input or output token is paused or frozen.
- **Rebalancer**: Exclude paused/frozen tokens from active targets (same as per-target pause, but global).
- **Deposit/Withdraw/Send actions**: Skip if the token is frozen.
- **Distribution chore**: Skip distribution lists whose token is frozen.
- **Fallback routing**: Skip paused/frozen intermediary tokens.

#### API

```motoko
getPausedTokens() : async [Principal]
getFrozenTokens() : async [Principal]
pauseToken(token: Principal) : async ()     // Requires ManageTokenRegistry
unpauseToken(token: Principal) : async ()   // Requires ManageTokenRegistry
freezeToken(token: Principal) : async ()    // Requires ManageTokenRegistry
unfreezeToken(token: Principal) : async ()  // Requires ManageTokenRegistry
```

### Circuit Breaker

The circuit breaker is an automated safety system that can pause or stop bot activities when configurable conditions are met.

#### Concepts

- **Rules**: Independent circuit breaker rules, each with conditions (AND-gated) and actions.
- **Conditions**: Three types — Price (token pair), Value (sum of multiple sources), Balance (specific token in account).
- **Operators**: Greater than, Less than, Inside range, Outside range, Percentage change.
- **Percentage Change**: Compares current value against historical data from a specified lookback period. Supports up/down/either direction.
- **Value Sources**: Specific token in account, all tokens in a rebalancing chore, all tokens in an account. Multiple sources are de-duplicated by (token, subaccount) and summed.
- **Actions**: Pause token in rebal chore, pause/freeze token globally, stop/pause chore, stop/pause all chores by type, stop/pause all chores.
- **Manual Reset**: When a circuit breaker triggers, affected chores/tokens remain paused/stopped until manually resumed by the user.
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
// Value source types: 0=specificToken, 1=rebalChoreTokens, 2=allTokensInAccount
// Action types: 0=pauseTokenInRebalChore, 1=pauseTokenGlobally, 2=freezeTokenGlobally,
//   3=stopChore, 4=pauseChore, 5=stopAllChoresByType, 6=pauseAllChoresByType,
//   7=stopAllChores, 8=pauseAllChores
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
// Rules CRUD
getCircuitBreakerRules() : async [CircuitBreakerRule]              // query, ViewChores
addCircuitBreakerRule(input: CircuitBreakerRuleInput) : async Nat  // ManageCircuitBreaker
updateCircuitBreakerRule(id: Nat, input: CircuitBreakerRuleInput) : async ()  // ManageCircuitBreaker
removeCircuitBreakerRule(id: Nat) : async ()                       // ManageCircuitBreaker
enableCircuitBreakerRule(id: Nat, enabled: Bool) : async ()        // ManageCircuitBreaker

// Global toggle
getCircuitBreakerEnabled() : async Bool                            // query, ViewChores
setCircuitBreakerEnabled(enabled: Bool) : async ()                 // ManageCircuitBreaker

// Event log
getCircuitBreakerLog(q: CBLogQuery) : async CBLogResult            // query, ViewLogs
clearCircuitBreakerLog() : async ()                                // ManageLogs
```

#### Permission

Permission ID `213` — `ManageCircuitBreaker`: Required for creating, updating, deleting, and enabling/disabling rules and the global CB toggle.

#### Frontend

The Circuit Breaker tab in the TradingBotLogs section provides:
- Global enable/disable toggle
- Rule list with summary cards (conditions, actions, enable/disable, edit, delete)
- Rule builder form with type-specific condition/action fields
- Event log table with time, rule, conditions, and actions taken
- Chore status lamps show an orange "CB" indicator when a chore is paused/stopped by a circuit breaker rule

### Well-Known Token Constants

```
ICP_LEDGER    = "ryjl3-tyaaa-aaaaa-aaaba-cai"
CKUSDC_LEDGER = "xevnm-gaaaa-aaaar-qafnq-cai"
CKBTC_LEDGER  = "mxzaz-hqaaa-aaaar-qaada-cai"
CKETH_LEDGER  = "ss2fx-dyaaa-aaaar-qacoq-cai"
SNEED_LEDGER  = "hvgxa-wqaaa-aaaaq-aacia-cai"
```

---

## 4. Named Subaccounts

### Data Model

```
Stable var:
  var namedSubaccounts: [(Nat, Text)]  — (subaccount number, name)
  var nextSubaccountNumber: Nat        — Next number to assign (starts at 1)
```

Subaccount 0 (null subaccount) is always the **main account** and is not stored in the list — it is implicitly available as "Main Account".

When a user creates a subaccount, the next sequential number is assigned and converted to a 32-byte blob by encoding the Nat as big-endian bytes in a 32-byte array (e.g., 1 → `0x00...0001`, 2 → `0x00...0002`).

### API

```motoko
getSubaccounts() : async [(Nat, Text, Blob)]  // (number, name, 32-byte subaccount blob)
createSubaccount(name: Text) : async { number: Nat; subaccount: Blob }
renameSubaccount(number: Nat, name: Text) : async Bool
deleteSubaccount(number: Nat) : async Bool  // Only if balance is zero
getBalances(subaccountNumber: ?Nat) : async [{ token: Principal; balance: Nat }]  // null = all
getAllBalances() : async [{ subaccountNumber: Nat; name: Text; balances: [{ token: Principal; balance: Nat }] }]
```

---

## 5. DEX Aggregator (Backend)

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
    depositAndSwap: shared (SwapArgs) -> async { #ok: Nat; #err: Text };       // ICRC1
    depositFromAndSwap: shared (SwapArgs) -> async { #ok: Nat; #err: Text };   // ICRC2
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
// Get a quote from a specific DEX
getQuote(dexId: Nat, inputToken: Principal, outputToken: Principal, amount: Nat) : async ?SwapQuote

// Get quotes from all supported DEXes, sorted by output (best first)
getAllQuotes(inputToken: Principal, outputToken: Principal, amount: Nat) : async [SwapQuote]

// Get the best quote across all DEXes
getBestQuote(inputToken: Principal, outputToken: Principal, amount: Nat) : async ?SwapQuote

// Execute a swap using a quote
executeSwap(quote: SwapQuote, slippageBps: Nat) : async SwapResult

// Get spot price from a specific DEX (output per 1 input, in raw units)
getSpotPrice(dexId: Nat, inputToken: Principal, outputToken: Principal) : async ?Nat
```

### SwapQuote Type

```
SwapQuote = {
    dexId: Nat;                     // 0=ICPSwap, 1=Kong
    inputToken: Principal;
    outputToken: Principal;
    inputAmount: Nat;               // User's input (before fees)
    effectiveInputAmount: Nat;      // After transfer/deposit fees
    expectedOutput: Nat;            // After DEX fee, before slippage
    spotPrice: Nat;                 // Spot price in raw units (output per 1e(inputDecimals) input)
    priceImpactBps: Nat;            // Price impact in basis points (100 = 1%)
    dexFeeBps: Nat;                 // DEX trading fee in basis points
    inputFeesTotal: Nat;            // Total input fees (transfer + deposit)
    outputFeesTotal: Nat;           // Total output fees (withdrawal)
    poolCanisterId: ?Principal;     // ICPSwap pool canister (null for Kong)
    timestamp: Int;                 // Time.now() when quote was fetched
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
var enabledDexes: [Nat]                  — Which DEXes are enabled (default: [0, 1])
var defaultSlippageBps: Nat              — Default slippage tolerance in bps (default: 100 = 1%)
var defaultMaxPriceImpactBps: Nat        — Default max price impact in bps (default: 300 = 3%)
var icpswapPoolCache: [(Text, Principal)] — Cached pool canister lookups (pairKey → canisterId)
```

---

## 6. Denomination System

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

## 7. Trade Chore

### Overview

A Trade Chore instance contains an ordered list of **actions** that execute sequentially when the chore fires. Each action is independent — a failed action is logged and skipped; subsequent actions still run.

Chore type ID: `"trade"`

Default interval: 300 seconds (5 minutes), with `maxIntervalSeconds` for randomization.

### Action Types

Actions are stored with a numeric `actionType` field (not an enum):

| Type ID | Name     | Description |
|---------|----------|-------------|
| 0       | Trade    | Execute a token swap on a DEX |
| 1       | Deposit  | Send tokens from main account to a named subaccount |
| 2       | Withdraw | Send tokens from a named subaccount to main account |
| 3       | Send     | Send tokens from main or subaccount to any ICRC-1 address |

### Trade Action Parameters

```
TradeActionConfig = {
    id: Nat;                            // Unique within the chore instance
    actionType: Nat;                    // 0 = Trade
    enabled: Bool;

    // Token pair
    inputToken: Principal;
    outputToken: Principal;

    // Trade size (of input token, in native units)
    minTradeSize: Nat;                  // Minimum input amount
    maxTradeSize: Nat;                  // Maximum input amount

    // Which DEX to use (null = best quote from all enabled)
    preferredDex: ?Nat;

    // --- Optional conditions ---

    // Balance conditions (on main account by default)
    minInputBalance: ?Nat;              // Only trade if input token balance >= this
    maxInputBalance: ?Nat;              // Only trade if input token balance <= this

    // Price conditions (output token price)
    minPrice: ?Nat;                     // Only trade if output price >= this (per 1 input)
    maxPrice: ?Nat;                     // Only trade if output price <= this (per 1 input)
    priceDenominationToken: ?Principal; // Denomination for price conditions (null = native)

    // Balance denomination (null = native token units)
    balanceDenominationToken: ?Principal;

    // Risk parameters
    maxPriceImpactBps: ?Nat;            // Max price impact in bps (null = use global default)
    maxSlippageBps: ?Nat;               // Max slippage in bps (null = use global default)

    // Frequency control (seconds)
    minFrequencySeconds: ?Nat;          // Min time between executions of this action
    maxFrequencySeconds: ?Nat;          // Max time between executions (null = run every chore cycle)

    // Trade size denomination (null = native input token units)
    tradeSizeDenominationToken: ?Principal;
}
```

### Deposit Action Parameters

```
DepositActionConfig = {
    id: Nat;
    actionType: Nat;                    // 1 = Deposit
    enabled: Bool;

    token: Principal;                   // Token to deposit
    targetSubaccount: Nat;              // Subaccount number to deposit TO (from main)

    // Amount range
    minAmount: Nat;
    maxAmount: Nat;

    // Balance condition (on main account)
    minBalance: ?Nat;                   // Only deposit if main balance >= this
    maxBalance: ?Nat;                   // Only deposit if main balance <= this

    // Frequency control
    minFrequencySeconds: ?Nat;
    maxFrequencySeconds: ?Nat;
}
```

### Withdraw Action Parameters

```
WithdrawActionConfig = {
    id: Nat;
    actionType: Nat;                    // 2 = Withdraw
    enabled: Bool;

    token: Principal;                   // Token to withdraw
    sourceSubaccount: Nat;              // Subaccount number to withdraw FROM (to main)

    // Amount range
    minAmount: Nat;
    maxAmount: Nat;

    // Balance condition (on source subaccount)
    minBalance: ?Nat;                   // Only withdraw if subaccount balance >= this
    maxBalance: ?Nat;                   // Only withdraw if subaccount balance <= this

    // Frequency control
    minFrequencySeconds: ?Nat;
    maxFrequencySeconds: ?Nat;
}
```

### Send Action Parameters

```
SendActionConfig = {
    id: Nat;
    actionType: Nat;                    // 3 = Send
    enabled: Bool;

    token: Principal;                   // Token to send
    sourceSubaccount: ?Nat;             // null = main account, else subaccount number
    destinationOwner: Principal;        // ICRC-1 destination owner
    destinationSubaccount: ?Blob;       // ICRC-1 destination subaccount

    // Amount range
    minAmount: Nat;
    maxAmount: Nat;

    // Balance condition (on source)
    minBalance: ?Nat;
    maxBalance: ?Nat;

    // Frequency control
    minFrequencySeconds: ?Nat;
    maxFrequencySeconds: ?Nat;
}
```

### Unified Action Storage

All action types are stored in a single unified record type to avoid enum-in-stable-var issues:

```
ActionConfig = {
    id: Nat;
    actionType: Nat;                    // 0=Trade, 1=Deposit, 2=Withdraw, 3=Send
    enabled: Bool;

    // Token(s) - Trade uses both, others use token only (stored as inputToken)
    inputToken: Principal;
    outputToken: ?Principal;            // Only for Trade

    // Amount range
    minAmount: Nat;                     // Trade: minTradeSize, others: minAmount
    maxAmount: Nat;                     // Trade: maxTradeSize, others: maxAmount

    // DEX preference (Trade only)
    preferredDex: ?Nat;

    // Subaccount references
    sourceSubaccount: ?Nat;             // Withdraw: source, Send: source (null=main)
    targetSubaccount: ?Nat;             // Deposit: target

    // Destination (Send only)
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

    // Frequency control
    minFrequencySeconds: ?Nat;
    maxFrequencySeconds: ?Nat;

    // Trade size denomination (Trade only)
    tradeSizeDenominationToken: ?Principal;

    // Runtime state (tracked per action)
    lastExecutedAt: ?Int;               // Timestamp of last execution
}
```

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
   a. Check **frequency**: If `lastExecutedAt + minFrequencySeconds > now`, skip.
   b. Check **balance conditions**: Query the relevant account balance. Skip if outside range.
   c. For **Trade** actions:
      - Check **price conditions**: Get spot price, convert denomination if needed. Skip if outside range.
      - Calculate trade size: Pick a random amount in [minAmount, maxAmount], adjusted for balance and denomination.
      - Get quote(s) from preferred DEX or best across all.
      - Check **price impact** and **slippage** tolerances.
      - Execute the swap.
   d. For **Deposit/Withdraw** actions:
      - Calculate amount in [minAmount, maxAmount], adjusted for balance.
      - Execute the ICRC-1 transfer.
   e. For **Send** actions:
      - Calculate amount, execute the transfer.
   f. Update `lastExecutedAt` on the action.
   g. Log the result.
3. **Conductor (done)**: Return `#Done`.

### Frequency Warnings

If an action's `minFrequencySeconds` is less than the chore's `intervalSeconds`, the admin API should return a warning (in the action status). The action will simply run every chore cycle in this case.

---

## 8. Rebalance Chore

### Overview

The Rebalance Chore maintains a portfolio at target allocations by identifying over/underweight tokens and trading between them.

Chore type ID: `"rebalance"`

Default interval: 3600 seconds (1 hour), with `maxIntervalSeconds` for randomization.

### Portfolio Targets

```
Stable var:
  var rebalanceTargets: [(Text, [RebalanceTarget])]  — keyed by instanceId
  var rebalanceDenominationToken: [(Text, Principal)] — keyed by instanceId (default: ICP ledger)
  var rebalanceMaxTradeSize: [(Text, Nat)]            — keyed by instanceId
  var rebalanceMinTradeSize: [(Text, Nat)]            — keyed by instanceId
  var rebalanceMaxPriceImpactBps: [(Text, Nat)]       — keyed by instanceId
  var rebalanceMaxSlippageBps: [(Text, Nat)]           — keyed by instanceId
  var rebalanceThresholdBps: [(Text, Nat)]             — keyed by instanceId (min deviation to trade)
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

1. **Value Portfolio**: For each token in the target list, get the balance on the main account and the spot price in the denomination token. Calculate total portfolio value.

2. **Calculate Deviations**: For each token, compute:
   - `currentBps = (tokenValue / totalValue) * 10000`
   - `deviationBps = currentBps - targetBps`
   - Overweight tokens: `deviationBps > thresholdBps`
   - Underweight tokens: `deviationBps < -thresholdBps`

3. **Weighted Random Pair Selection**: Pick one overweight token and one underweight token, weighted by their absolute deviation. Tokens further from target have higher probability of being selected:
   - Weight = `|deviationBps|` for each token
   - Use `Time.now()` nanoseconds as entropy for randomization (same pattern as chore interval randomization)

4. **Calculate Trade Size**: Determine how much of the overweight token to sell:
   - Maximum that would bring the overweight token to target
   - Clamped to `[rebalanceMinTradeSize, rebalanceMaxTradeSize]`
   - Clamped to available balance minus transfer fees

5. **Get Quote & Validate**: Get best quote for the pair. Check:
   - Price impact <= `rebalanceMaxPriceImpactBps`
   - Expected output moves the underweight token closer to (not past) its target

6. **Execute Trade**: If all checks pass, execute the swap.

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
getPortfolioStatus(instanceId: Text) : async PortfolioStatus  // Current allocations vs targets
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
        deviationBps: Int;     // positive = overweight, negative = underweight
    }];
}
```

---

## 9. Move Funds Chore

### Overview

A lightweight chore for scheduled fund movements without trading. Supports Deposit, Withdraw, and Send actions (action types 1, 2, 3 — same as in Trade Chore).

Chore type ID: `"move-funds"`

Default interval: 3600 seconds (1 hour).

### Storage

```
Stable var:
  var moveFundsActions: [(Text, [ActionConfig])]   — keyed by instanceId
  var moveFundsNextActionId: [(Text, Nat)]         — keyed by instanceId
```

Uses the same `ActionConfig` type as Trade Chore, but only action types 1, 2, 3 are valid.

### Execution

Same pattern as Trade Chore but restricted to non-trade action types.

---

## 10. Distribute Funds Chore

Reused from the staking bot pattern — distributes funds based on percentage-based distribution lists. Same implementation as in the staking bot, using the shared `DistributionTypes.mo`.

Chore type ID: `"distribute-funds"`

---

## 11. Stable Variables Summary

Each setting is its own stable var to avoid migration issues:

```motoko
// Core
var createdAt: Int
var hotkeyPermissions: [(Principal, [Nat])]

// Token Registry
var tokenRegistry: [TokenRegistryEntry]
var pausedTokens: [Principal]           // Globally paused (no trading)
var frozenTokens: [Principal]           // Globally frozen (no trading or movement)

// Subaccounts
var namedSubaccounts: [(Nat, Text)]
var nextSubaccountNumber: Nat

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
refreshTokenMetadata(ledgerCanisterId: Principal) : async ()  // Re-fetch fee/decimals from ledger
```

### Subaccounts
```motoko
getSubaccounts() : async [SubaccountInfo]
createSubaccount(name: Text) : async SubaccountInfo
renameSubaccount(number: Nat, name: Text) : async Bool
deleteSubaccount(number: Nat) : async Bool
```

### Portfolio & Balances
```motoko
getBalances(subaccountNumber: ?Nat) : async [TokenBalance]
getAllBalances() : async [SubaccountBalances]
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
addTradeAction(instanceId: Text, config: ActionConfigInput) : async Nat  // returns action id
updateTradeAction(instanceId: Text, id: Nat, config: ActionConfigInput) : async Bool
removeTradeAction(instanceId: Text, id: Nat) : async Bool
reorderTradeActions(instanceId: Text, actionIds: [Nat]) : async Bool
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
getPurseBalance(instanceId: Text, token: Principal, subaccountNumber: ?Nat) : async Nat
getMainPurseBalances() : async [MainPurseBalance]
getMainPurseBalance(token: Principal, subaccountNumber: ?Nat) : async { balance: Nat; overcommitted: Bool }
fundPurse(instanceId: Text, token: Principal, amount: Nat) : async { #Ok; #Err: Text }
reclaimFromPurse(instanceId: Text, token: Principal, amount: Nat) : async { #Ok; #Err: Text }
```

### Log (shared pattern)
```motoko
getLogs(filter: LogFilter) : async LogResult
getLogConfig() : async LogConfig
setLogLevel(level: LogLevel) : async ()
clearLogs() : async ()
```

---

## 13. ICPSwap Swap Flow (Backend)

Since the bot canister is the caller (not a browser user), the flow is simpler:

### ICRC-2 Path (preferred — no subaccount management)
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

### Cycle Management
- The bot should monitor its own cycle balance and log warnings when low.
- Inter-canister calls (DEX quotes, swaps) consume cycles. The bot should avoid unnecessary calls.

### Upgrade Safety
- All conductor/task closures are transient and re-created on every canister start.
- The chore engine handles timer resumption after upgrades.
- In-progress trades that were interrupted by an upgrade are simply retried on the next chore cycle (trades are idempotent — executing the same trade twice is safe because conditions are re-evaluated).

---

## 16. Implementation Plan

### Phase 1: Types.mo
- Define all types: permissions, token registry, action configs, rebalance targets, DEX types, swap quotes.
- Follow the staking bot's pattern for permission ID ranges and numeric-to-variant maps.

### Phase 2: main.mo — Core Infrastructure
- Stable var declarations (individual vars, no config records).
- Permission engine setup (PERMISSION_MAP, variant↔id conversions).
- Log engine setup.
- Chore engine setup.
- Basic canister info API (version, principal).
- Permission management API.

### Phase 3: Token Registry & Subaccounts
- Token registration/removal.
- Named subaccount management.
- Balance queries.

### Phase 4: DEX Aggregator
- Actor interfaces for ICPSwap and Kong.
- Quote fetching (single DEX, all DEXes, best quote).
- Swap execution (ICRC-1 and ICRC-2 paths).
- Pool discovery and caching.

### Phase 5: Trade Chore
- Action CRUD API.
- Conductor logic: iterate actions, evaluate conditions, execute.
- Task logic: execute individual trades/deposits/withdraws/sends.
- Frequency tracking and validation.

### Phase 6: Rebalance Chore
- Target management API.
- Portfolio valuation.
- Deviation calculation.
- Weighted random pair selection.
- Trade sizing and execution.

### Phase 7: Move Funds Chore
- Action CRUD (restricted to deposit/withdraw/send).
- Conductor logic (subset of trade chore).

### Phase 8: Distribute Funds Chore
- Reuse pattern from staking bot.

---

## 17. Chore Purses (Isolated Chore Balances)

### Overview

By default, all chores share the same token balances in the main account (and subaccounts). A DCA chore buying SNEED and a range-trading chore trading TACO both draw from and contribute to the same ICP balance. While this comingled model is sometimes desirable (and remains available), most users expect **isolated balances per chore**.

**Chore Purses** are a virtual accounting layer that tracks per-chore token balances. All tokens physically remain in the canister's on-chain accounts (main account and subaccounts), but the purse system tracks "how much of each token belongs to each chore."

The term **"Purse"** is deliberately chosen to avoid overloading "Account" (ICRC-1 concept), "Subaccount" (ICRC-1 subaccount blob), or "Wallet" (user wallet).

### Concepts

| Term | Meaning |
|------|---------|
| **Purse** | A virtual balance sheet tracking token balances per (token, subaccount). Each chore instance can have its own purse. |
| **Main Purse** | The default purse holding all on-chain funds not allocated to any chore-specific purse. Its balance is always **computed**: `main purse = on-chain balance − Σ chore purse balances`. Chores without their own purse share the main purse. Detected inflows and outflows are automatically reflected in the main purse (since on-chain balance changes while chore purse balances stay the same). |
| **Fund** | Move tokens from the main purse into a chore's purse. No on-chain transfer occurs — this is purely bookkeeping. The main purse decreases and the chore's purse increases by the same amount. |
| **Reclaim** | Move tokens from a chore's purse back to the main purse. No on-chain transfer occurs. The chore's purse decreases and the main purse increases. |

Every token in the on-chain account is accounted for: it belongs either to the **main purse** or to a **chore's purse**. No chore can ever access another chore's funds.

"Fund" and "Reclaim" are deliberately distinct from the existing "Deposit" (main → subaccount ICRC-1 transfer) and "Withdraw" (subaccount → main ICRC-1 transfer) action types.

### Behavior by Purse State

| Chore Purse State | Balance Used for Trading | Inflows / Outflows | Fund/Reclaim |
|---|---|---|---|
| **Disabled** (default for existing chores) | **Main purse** balance (shared with other purse-disabled chores) | Go to / come from the main purse | N/A (chore uses main purse directly) |
| **Enabled** (default for new chores) | **Chore's own purse** balance only | Go to / come from the main purse (user must Fund to move into a chore purse) | Available |

When no chore-specific purses exist (or none are funded), the main purse equals the full on-chain balance, so the system behaves identically to the pre-purse era. The moment a user Funds a chore's purse, the main purse shrinks by that amount, and other chores (sharing the main purse) see less available balance.

### Data Model

```motoko
// NEW stable vars — additive only, no changes to any existing stable vars
var chorePurseEnabled: [(Text, Bool)]                     // instanceId → enabled
var chorePurseBalances: [(Text, [(Text, Nat)])]           // instanceId → [(balanceKey, amount)]
```

The `balanceKey` format matches the existing `lastKnownBalances` convention: `"<tokenPrincipal>:main"` for the main account (null subaccount), or `"<tokenPrincipal>:<subaccountHex>"` for named subaccounts.

### Defaults

- **New chore instances** (created after this feature is deployed): Purse enabled by default. The `createChoreInstance` flow adds `(instanceId, true)` to `chorePurseEnabled`.
- **Existing chore instances** (created before this feature): Not present in `chorePurseEnabled`, which is treated as **disabled**. The user can enable it manually.

### Fund & Reclaim Mechanics

#### Fund (Main Purse → Chore Purse)

```
fundPurse(instanceId, token, amount):
  1. Verify purse is enabled for this chore
  2. Get actual on-chain balance for (token, main account) — requires async ledger call
  3. Calculate main purse balance = on-chain − Σ chore purse balances of ALL chores for (token, main)
  4. Verify amount ≤ main purse balance (reject otherwise)
  5. Increase this chore's purse balance for (token, main) by amount
     (main purse balance automatically decreases since it is computed)
```

No ICRC-1 transfer occurs. The tokens already reside in the main account on-chain. The main purse shrinks and the chore's purse grows by the same amount.

#### Reclaim (Chore Purse → Main Purse)

```
reclaimFromPurse(instanceId, token, amount):
  1. Verify purse is enabled for this chore
  2. Get purse balance for (token, main account) for this chore
  3. Verify amount ≤ purse balance (reject otherwise)
  4. Decrease this chore's purse balance for (token, main) by amount
     (main purse balance automatically increases since it is computed)
```

No ICRC-1 transfer occurs. The chore's purse shrinks and the main purse grows.

#### Fund from Subaccount

For the initial version, Fund and Reclaim operate only on the **main account** (subaccount null) portion of purse balances. To fund from a subaccount, the user must first Withdraw (ICRC-1 transfer from subaccount → main), then Fund the purse. This keeps the API surface small while covering the primary use case.

### Integration with Trade Chores

The execution flow is determined by whether the chore has its own purse or uses the main purse.

#### Helper: `getEffectiveBalance(instanceId, token, subaccount)`

A single internal helper resolves the balance a chore should use:

```
if chorePurseEnabled(instanceId):
    return chorePurseBalance(instanceId, token, subaccount)
else:
    return mainPurseBalance(token, subaccount)
      // = on-chain balance − Σ all chore purse balances for (token, subaccount)
```

This helper replaces the current `getBalance(token, subaccount)` calls in all chore execution paths.

#### Trade Action (actionType 0 — Swap)

1. **Balance check**: Use `getEffectiveBalance(instanceId, inputToken, null)`.
2. **Balance conditions** (`minBalance`, `maxBalance`): Evaluated against the effective balance (with optional denomination conversion, same as today).
3. **Trade size computation** (`computeActionAmount`): Uses the effective balance as the `balance` parameter.
4. **Affordable cap**: `maxAffordable = min(effectiveBalance, on-chain balance) − fees × 3`. The on-chain check is a safety guard since the actual ICRC-1 transfer comes from the main account.
5. **Swap execution**: No change — the swap still happens from the main account via `executeSwap`.
6. **Post-swap success (chore has its own purse)**:
   - Decrease chore purse balance for `(inputToken, main)` by `(inputAmount + inputFeesTotal)`
   - Increase chore purse balance for `(outputToken, main)` by `(amountOut − outputFeesTotal)`
7. **Post-swap success (chore uses main purse)**: No explicit purse update needed. The on-chain balance changed, and since the main purse is computed (`on-chain − Σ chore purses`), it automatically reflects the swap result.
8. **Post-swap failure** (input fees lost to DEX):
   - If chore has its own purse: decrease purse balance for `(inputToken, main)` by `inputFeesTotal`
   - If chore uses main purse: no explicit update needed (on-chain decreased, main purse reflects it)

**Critical invariant**: For chores with their own purse, the post-swap purse deduction must exactly mirror the `lastKnownBalance` update logic that already exists. Both track the same event; the purse is an additional layer on top.

#### Deposit Action (actionType 1 — Main → Subaccount)

1. **Balance check**: Use `getEffectiveBalance(instanceId, token, null)` (main account portion).
2. **Post-transfer success (chore has its own purse)**:
   - Decrease chore purse balance for `(token, main)` by `(amount + fee)`
   - Increase chore purse balance for `(token, targetSubaccount)` by `amount`
   - This tracks that the tokens in the subaccount still belong to this chore's purse.
3. **Post-transfer success (chore uses main purse)**: No explicit purse update. The on-chain main account balance decreased and the subaccount balance increased; the main purse reflects both changes automatically.

#### Withdraw Action (actionType 2 — Subaccount → Main)

1. **Balance check**: Use `getEffectiveBalance(instanceId, token, sourceSubaccount)`.
2. **Post-transfer success (chore has its own purse)**:
   - Decrease chore purse balance for `(token, sourceSubaccount)` by `(amount + fee)`
   - Increase chore purse balance for `(token, main)` by `amount`
3. **Post-transfer success (chore uses main purse)**: No explicit purse update needed.

#### Send Action (actionType 3 — Send to External)

1. **Balance check**: Use `getEffectiveBalance(instanceId, token, source)`.
2. **Post-transfer success (chore has its own purse)**:
   - Decrease chore purse balance for `(token, source)` by `(amount + fee)`
   - No increase anywhere (tokens left the canister)
3. **Post-transfer success (chore uses main purse)**: No explicit purse update needed (on-chain decreased, main purse reflects it).

### Integration with Rebalancer

The rebalancer uses `getEffectiveBalance` for all token balance reads, so it automatically operates on the correct purse:

1. **Portfolio valuation**: For each target token, use `getEffectiveBalance(instanceId, token, null)`. A rebalancer with its own purse rebalances *its own allocated funds*; a rebalancer on the main purse rebalances the shared main purse funds.
2. **Deviation calculation**: Based on effective balances.
3. **Trade sizing**: Clamped to the effective balance (and also to the on-chain balance as a safety check).
4. **Post-trade updates**: Same as Trade Chore swap — if the chore has its own purse, decrease purse input and increase purse output. If on the main purse, no explicit update needed.
5. **Fallback routing** (two-leg trades via intermediary): Both legs update the purse if enabled. Leg 1: decrease sell token, increase intermediary. Leg 2: decrease intermediary, increase buy token.

### Integration with Move Funds Chores

Move-funds chores use `getEffectiveBalance` for all balance checks, following the same mechanics as the trade chore's Deposit/Withdraw/Send actions. Chores with their own purse get explicit post-operation updates; chores on the main purse get automatic updates via the computed main purse balance.

### Integration with Distribute Funds Chore

The distribute-funds chore also uses `getEffectiveBalance`. Each distribution list's token balance is checked against the chore's effective balance (own purse or main purse). Post-send, chores with their own purse get an explicit decrease; main-purse chores get automatic updates. This allows isolating distribution reserves from trading reserves when desired.

### Inflow/Outflow Detection & Reconciliation

The existing `reconcileBalance` function continues to operate on **on-chain balances** only. It does NOT interact with chore purse balances. This is the correct behavior because the main purse is a computed value:

- **Detected inflows** (someone sends tokens to the bot's main account): The on-chain balance increases. Since no chore purse balances change, the **main purse** balance increases by the inflow amount. The user can then Fund a chore's purse from the main purse if desired.
- **Detected outflows** (unexpected balance decrease): The on-chain balance decreases. The **main purse** balance decreases accordingly. If the main purse was already 0 or near 0, it goes negative (overcommitted — see Safety section).
- **Chore purse balance changes** are tracked explicitly by the chore execution logic after each operation. They are never inferred from on-chain balance changes.
- **Users cannot send funds directly to a chore purse** from their wallet. They send to the bot's main account (which increases the main purse), then Fund the chore's purse. The frontend can orchestrate both steps as a convenience flow.

### Enabling/Disabling Purses

#### Enabling

When a purse is enabled for a chore:
- The purse starts with all balances at 0.
- The chore **cannot trade** until the user funds the purse (a balance of 0 means no trade size is possible).
- The user must explicitly Fund the purse with the desired tokens and amounts.

#### Disabling

When disabling a purse:
- **All purse balances must be 0** — the user must Reclaim all funds first.
- If any purse balance is non-zero, the disable operation fails with an error listing the non-zero balances.

### Circuit Breaker Integration

Circuit breaker conditions that check balances should respect purses:

- **Balance condition** (`conditionType = 2`): If the condition references a token and account, and the relevant chore has a purse, the balance check uses the purse balance.
- **Value conditions** (`conditionType = 1`, source type `rebalChoreTokens`): If the referenced rebalancer chore has a purse, use purse balances for token valuation.
- **Value conditions** (source type `specificToken` or `allTokensInAccount`): These reference on-chain balances, not purses, unless the source explicitly ties to a specific chore instance.

### Main Purse Balance

The **main purse balance** for a given `(token, subaccount)` is always computed, never stored:

```
main purse = on-chain balance − Σ (chore purse balances for ALL chore-specific purses)
```

The main purse is the single source of truth for funds available to chores without their own purse, and for Fund operations.

- When `main purse < 0` (due to accumulated fee drift, unexpected outflows, or rounding), it is reported as `0` with an `overcommitted` flag. This means the sum of chore purses exceeds the actual on-chain balance.
- The overcommitted state is a **warning** — the system does not automatically reduce any chore purse's balance. The user should either add more funds to the bot or reclaim from chore purses to resolve the discrepancy.
- Chores sharing the main purse **cannot trade** while it is overcommitted (balance = 0).

### Frontend Integration

1. **Purse toggle**: Each chore card in the `BotManagementPanel` shows a Purse enabled/disabled toggle. Disabling requires all chore purse balances to be 0.

2. **Chore purse balance table**: When a chore's purse is enabled, the chore configuration panel shows a per-token balance table for the chore's purse (similar to the existing balance table but scoped to this purse).

3. **Fund/Reclaim controls**: Per-token amount input with Fund and Reclaim buttons within the chore panel. Shows the available main purse balance for context (so the user knows how much can be funded).

4. **Main purse balance view**: The portfolio/balances section shows both the total on-chain balance and the main purse balance for each token. The main purse balance is what chores without their own purse can access.

5. **Send-to-chore convenience flow**: A button on the trading bot page that orchestrates: (1) send from user's wallet to the bot's main account (increases main purse), (2) wait for balance confirmation, (3) Fund the chore's purse from the main purse. This is a frontend orchestration of two separate operations, not a single backend API call.

6. **Overcommitted warning**: If the main purse balance for any token is negative (chore purses sum to more than on-chain balance), show a warning banner with advice to add funds or reclaim from chore purses.

### API

```motoko
// Purse configuration
isPurseEnabled(instanceId: Text) : async Bool                          // query, ViewPortfolio
enablePurse(instanceId: Text) : async ()                               // ManagePurses
disablePurse(instanceId: Text) : async { #Ok; #Err: Text }            // ManagePurses

// Chore purse balance queries
getPurseBalances(instanceId: Text) : async [{
    token: Principal;
    subaccountNumber: ?Nat;     // null = main account
    balance: Nat;
}]                                                                      // query, ViewPortfolio

getPurseBalance(instanceId: Text, token: Principal, subaccountNumber: ?Nat) : async Nat  // query, ViewPortfolio

// Main purse balance queries
getMainPurseBalances() : async [{
    token: Principal;
    subaccountNumber: ?Nat;
    balance: Nat;               // 0 if overcommitted
    overcommitted: Bool;        // true if Σ chore purses > on-chain
}]                                                                      // ViewPortfolio (async — queries ledgers)

getMainPurseBalance(token: Principal, subaccountNumber: ?Nat) : async {
    balance: Nat;
    overcommitted: Bool;
}                                                                       // ViewPortfolio (async — queries ledger)

// Fund & Reclaim (main account only — subaccount null)
fundPurse(instanceId: Text, token: Principal, amount: Nat) : async { #Ok; #Err: Text }       // ManagePurses
reclaimFromPurse(instanceId: Text, token: Principal, amount: Nat) : async { #Ok; #Err: Text } // ManagePurses
```

### Permission

| ID  | Variant          | Description |
|-----|------------------|-------------|
| 214 | `#ManagePurses`  | Enable/disable chore purses and fund/reclaim operations |

### Stable Variables (additions only)

```motoko
var chorePurseEnabled: [(Text, Bool)]                     // instanceId → enabled
var chorePurseBalances: [(Text, [(Text, Nat)])]           // instanceId → [(balanceKey, amount)]
```

These are **new** stable vars added alongside the existing ones. No existing stable vars are modified.

### Invariants & Safety

1. **Fundamental accounting identity**: For every `(token, subaccount)`:
   ```
   on-chain balance = main purse balance + Σ chore purse balances
   ```
   The main purse is always computed from this identity, never stored independently.

2. **Non-negative chore purse balances**: All chore purse balances are `Nat`. Operations that would cause underflow are **rejected** (not clamped to 0). This is critical — clamping would silently lose accounting precision.

3. **On-chain sufficiency check**: Before executing an actual ICRC-1 transfer or swap, the chore verifies both:
   - The effective balance (own purse or main purse) is sufficient, AND
   - The on-chain account has sufficient actual balance.
   If the on-chain balance is insufficient (e.g., due to an external untracked outflow), the operation is skipped and logged as a warning.

4. **Overcommit detection**: After every `reconcileBalance` call, if the main purse balance for any (token, subaccount) is negative, a warning is logged. This means `Σ chore purse balances > on-chain balance`, which can happen due to fee drift or unexpected outflows. The user is alerted to resolve the discrepancy.

5. **Fee precision**: All fee deductions from chore purses mirror the existing `lastKnownBalance` update patterns. For swaps: `inputAmount + inputFeesTotal` is deducted from the input purse, `amountOut − outputFeesTotal` is added to the output purse. For ICRC-1 transfers: `amount + fee` is deducted from source, `amount` is added to destination. For chores on the main purse, no explicit purse update is needed — the computed main purse balance reflects the on-chain changes automatically.

6. **No concurrent modification risk**: IC canister message processing is sequential. Purse balance updates occur in the same synchronous block following an `await` (swap/transfer), before the next `await` point. This prevents race conditions between concurrent chore runs or API calls.

7. **Upgrade safety**: Purse state is in stable vars and persists across upgrades. In-progress trades interrupted by an upgrade are simply retried on the next chore cycle — the purse balance was not yet modified (the modification happens after the await returns, which never completes if the canister upgrades mid-call).

8. **Chore deletion**: When a chore instance is deleted, its chore purse balances are released back to the main purse (equivalent to reclaiming all balances, then removing the entry from `chorePurseEnabled` and `chorePurseBalances`). Since the main purse is computed, simply deleting the chore's purse entries automatically increases the main purse balance.

---

## Appendix A: Numeric Action Type Map

| Nat | ActionType Variant |
|-----|-------------------|
| 0   | `#Trade`          |
| 1   | `#Deposit`        |
| 2   | `#Withdraw`       |
| 3   | `#Send`           |

These are NEVER stored as variants in stable storage — only the Nat values are stored.

## Appendix B: Numeric DEX ID Map

| Nat | DexId Variant |
|-----|---------------|
| 0   | `#ICPSwap`    |
| 1   | `#KongSwap`   |

These are NEVER stored as variants in stable storage — only the Nat values are stored.
