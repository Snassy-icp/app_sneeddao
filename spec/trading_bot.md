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
