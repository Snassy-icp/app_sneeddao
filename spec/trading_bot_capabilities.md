# Sneed Trading Bot — Comprehensive Feature & Capability List

## Overview

The **Sneed Trading Bot** is a fully on-chain, autonomous trading bot running as a canister (smart contract) on the **Internet Computer (ICP)** blockchain. It is non-custodial — each user deploys their own bot canister that they control. The bot executes token swaps, portfolio rebalancing, fund movements, and distributions on supported DEXes, all automated via a recurring task scheduling system.

**Platform**: Internet Computer (ICP) blockchain
**Language**: Motoko (backend), React (frontend)
**Architecture**: Each user owns their own canister instance — no shared custody, no centralized server.

---

## 1. Supported DEXes

- **ICPSwap** (V3 concentrated liquidity AMM) — pool-based swaps via factory discovery
- **KongSwap** (hybrid orderbook/AMM) — single swap canister
- DEX aggregation: the bot queries all enabled DEXes for quotes and selects the best price automatically
- Users can enable/disable individual DEXes
- Future DEXes can be added without changing the chore logic

---

## 2. Token Support

- Supports any **ICRC-1 / ICRC-2 compliant** token on the Internet Computer
- **Token Registry**: users add tokens by ledger canister ID; the bot fetches and stores symbol, decimals, and fee metadata automatically
- **Auto-refresh metadata**: token fee and decimal metadata can be refreshed from the ledger on demand or automatically during chore runs
- **Well-known tokens** built in: ICP, ckUSDC, ckBTC, ckETH, SNEED
- **Token reordering**: users can reorder the token registry for display preference

---

## 3. Trade Chore (Conditional Automated Trading)

Each Trade Chore instance contains an **ordered list of actions** that execute sequentially on a recurring schedule.

### 3.1 Trade Action (Swap)

- Swap any registered token pair on any enabled DEX
- **Configurable trade size**: min/max amount range (random amount within range for unpredictability)
- **Amount modes**:
  - Fixed range: random amount between min and max
  - Percentage of balance: trade a percentage (in basis points) of the current token balance, clamped by min/max
- **Preferred DEX selection**: choose a specific DEX or let the bot pick the best quote across all enabled DEXes
- **Trade size denomination**: express trade sizes in any registered token (e.g., "trade $50 worth" using ckUSDC denomination)

### 3.2 Trade Conditions (all optional per action)

- **Balance conditions**: only trade if the input token balance is above a minimum or below a maximum, with optional denomination in any token
- **Price conditions**: only trade if the spot price of the output token is within a min/max range, with optional denomination (e.g., "only buy if SNEED < 50 ckUSDC")
- **Frequency control**: min and max seconds between executions of each individual action (independent of the chore interval)
- **Max price impact**: reject trades where price impact exceeds a configurable threshold (in basis points)
- **Max slippage**: reject trades where expected slippage exceeds a configurable threshold (in basis points)

### 3.3 Execution Limits & Auto-Halt

- **Halt after execution**: optionally stop the entire chore after a specific action fires once
- **Max cumulative input**: budget cap — chore halts when total input spent across all runs reaches the limit
- **Max cumulative output**: output cap — chore halts when total output received reaches the limit
- **Max executions**: execution count cap — chore halts after N successful executions
- **Cumulative tracking**: the bot tracks cumulative input spent, output received, and execution count per action across all runs
- **Reset stats**: cumulative counters can be reset per action via the API

### 3.4 Fund Purse Action

- Move tokens from the main purse into a chore's isolated purse (virtual bookkeeping, no on-chain transfer)

### 3.5 Reclaim Action

- Move tokens from a chore's purse back to the main purse

### 3.6 Send Action

- Send tokens from the bot's main account or a chore purse to any external ICRC-1 account
- Configurable destination (owner + optional subaccount)
- Balance conditions and frequency control apply

### 3.7 Multi-Instance Support

- Users can create **multiple Trade Chore instances**, each with its own action list, schedule, and isolated purse
- Each instance can be independently started, stopped, paused, and configured
- Instances can be renamed and deleted

### 3.8 Action Ordering

- Actions within a chore execute in a user-defined order
- Drag-and-drop reordering in the frontend
- API supports reordering by action ID list

---

## 4. Rebalance Chore (Portfolio Rebalancing)

Automatically maintains a portfolio at target allocations by trading between overweight and underweight tokens.

### 4.1 Configuration

- **Target allocations**: per-token allocation targets in basis points (10000 = 100%)
- **Denomination token**: portfolio values calculated in any token (default: ICP)
- **Threshold**: minimum deviation in basis points before a rebalance trade triggers
- **Trade size limits**: min and max trade size per rebalance cycle
- **Price impact / slippage limits**: per-rebalancer configurable maximums
- **Per-token pause**: individual tokens can be paused within the rebalancer without affecting other chores

### 4.2 Rebalance Algorithm

- Values all target tokens using live DEX quotes in the denomination token
- Calculates current allocation vs. target allocation for each token
- Uses **weighted random pair selection**: tokens further from their target have a higher probability of being selected for trading
- Trades one overweight→underweight pair per cycle to minimize price impact
- Trade size capped to avoid overshooting the target allocation

### 4.3 Fallback Routing (Multi-Hop Trades)

- Configurable **fallback route tokens** (intermediary tokens) for illiquid pairs
- If a direct swap has insufficient liquidity or excessive price impact, the bot automatically tries two-leg routes through intermediary tokens (e.g., TokenA → ICP → TokenB)
- Ordered list of fallback tokens tried sequentially
- Paused/frozen intermediary tokens are automatically skipped

### 4.4 Multi-Instance Support

- Multiple rebalancer instances can manage separate portfolios
- Each instance has its own targets, settings, and optional isolated purse

---

## 5. Move Funds Chore (Scheduled Fund Movements)

A lightweight chore for scheduled fund movements without trading.

- Supports: Fund Purse, Reclaim, and Send actions (same as Trade Chore but no swaps)
- Multi-instance support
- Independent schedule, conditions, and frequency controls per action
- Useful for scheduled payouts, treasury management, or automated fund movements

---

## 6. Distribute Funds Chore (Percentage-Based Distribution)

Automatically distributes funds to multiple recipients based on configurable percentage splits.

### 6.1 Distribution Lists

- Multiple distribution lists per chore instance
- Each list specifies: source token, threshold amount (minimum balance to trigger), max distribution amount per round
- **Distribution targets**: multiple recipients with configurable basis point allocations
- **Auto-split**: targets without assigned percentages evenly split the remainder
- **Renormalization**: if assigned percentages exceed 100%, they are proportionally scaled down
- **Hard minimum**: distributions are skipped if the smallest recipient would receive less than one transaction fee
- Amount mode support: fixed amount or percentage of balance

### 6.2 Multi-Instance Support

- Multiple Distribute Funds chore instances, each with their own lists and schedule

---

## 7. Snapshot Chore (Periodic Data Collection)

A dedicated chore for continuous data collection even when trading chores are inactive.

### 7.1 Pipeline

- **Phase 0**: Refresh token metadata for all registered tokens
- **Phase 1**: Fetch prices for all registered token pairs
- **Phase 2**: Take balance snapshots for all tokens across main account
- **Phase 3**: Archive daily summaries (OHLC aggregation)

### 7.2 Purpose

- Ensures portfolio value history and price data accumulate continuously
- Provides data for charts and P&L even when trade/rebalance chores are paused
- Multi-instance support

---

## 8. Chore Scheduling System (Bot Chores Framework)

A reusable, three-level timer hierarchy for safe execution of long-running tasks on the Internet Computer.

### 8.1 Architecture

- **Scheduler (Level 1)**: fires on a recurring schedule, starts the Conductor
- **Conductor (Level 2)**: orchestrates execution, manages task lifecycle via polling
- **Task (Level 3)**: performs discrete units of work, self-splits across timer invocations to stay within IC instruction limits

### 8.2 Chore Lifecycle States

- **Stopped → Running → Paused** with full state machine controls:
  - Start (run immediately + schedule next)
  - Schedule Start (enable + first run at a user-specified future time)
  - Pause (suspend schedule, preserve next run time)
  - Resume (re-activate preserved schedule; run immediately if overdue)
  - Stop (cancel all, clear schedule)
  - Trigger / Run Now (manual one-off execution without changing schedule)
  - Run Once (fire once from stopped state without enabling recurring schedule)
  - Stop All Chores (emergency halt of all chore instances)

### 8.3 Interval Randomization

- Optional `maxIntervalSeconds` for each chore — the scheduler picks a random time within `[intervalSeconds, maxIntervalSeconds]` each cycle
- Prevents predictable/regular scheduling patterns (important for trading bots)

### 8.4 Task Timeout & Recovery

- Configurable task timeout per chore (default: 5 minutes)
- Automatic detection of hung/trapped tasks
- Conductor recovers from stuck tasks and can retry or skip

### 8.5 Upgrade Resilience

- All timer state persisted in stable storage
- Timers resume correctly after canister upgrades
- In-progress trades interrupted by upgrade are retried on the next cycle (trades are idempotent)
- Missed scheduled runs fire immediately after upgrade

### 8.6 Safety: Emergency Stop

- Double safety mechanism: stop flag + timer cancellation
- Prevents runaway self-rescheduling loops that could drain cycles

---

## 9. Chore Purses (Isolated Per-Chore Balances)

A virtual accounting layer that tracks per-chore token balances, enabling complete fund isolation between chores.

### 9.1 Concepts

- **Purse**: virtual balance sheet per chore instance — all tokens physically remain on-chain, but the purse tracks "how much belongs to each chore"
- **Main Purse**: computed balance = on-chain balance minus all chore purse allocations. Chores without their own purse share the main purse.
- **Fund**: move tokens from main purse into a chore's purse (bookkeeping only, no on-chain transfer)
- **Reclaim**: move tokens from a chore's purse back to main purse

### 9.2 Features

- New chore instances have purses enabled by default
- Purse can be disabled only when all balances are zero (must reclaim first)
- Overcommit detection: warns if chore purse sum exceeds on-chain balance
- Detected inflows/outflows automatically adjust the main purse
- Complete accounting identity: `on-chain = main purse + Σ chore purses`
- Non-negative chore purse balances enforced (operations that would underflow are rejected)

### 9.3 Integration

- All chore types (Trade, Rebalance, Move Funds, Distribute) respect purse boundaries
- Swap results (input deducted, output credited) tracked precisely in the executing chore's purse
- On-chain sufficiency verified before every actual transfer

---

## 10. Circuit Breaker (Automated Safety System)

An automated safety system that can pause or stop bot activities when configurable conditions are met.

### 10.1 Rules & Conditions

- Independent rules, each with multiple conditions and multiple actions
- Top-level operator per rule: AND (all conditions must be true) or OR (any condition triggers)
- **Condition types**:
  - **Price**: monitor a token pair's spot price
  - **Value**: monitor the total value of tokens (specific token, all tokens in a rebalancer, or all tokens in an account)
  - **Balance**: monitor a specific token's balance in a specific purse or the main account
  - **AND/OR groups**: nested logical groups of conditions for complex expressions

### 10.2 Operators

- Greater than / Less than a threshold
- Inside range / Outside range
- **Percentage change**: compare current value against historical data over a configurable lookback period, with direction (up / down / either)

### 10.3 Actions When Triggered

- Pause token in rebalance chore
- Pause token globally (across all chores)
- Freeze token globally (no trading AND no movement)
- Stop or pause a specific chore instance
- Stop or pause all chores of a specific type
- Stop or pause ALL chores (emergency halt)

### 10.4 Integration

- Evaluated once per chore run, before trade execution
- Trade and rebalance chore pipelines augment their price/metadata fetch phases with circuit breaker data requirements
- Manual reset required: affected chores/tokens stay paused/stopped until the user explicitly resumes

### 10.5 Event Log

- All trigger events recorded with timestamps, rule info, condition summaries, and actions taken
- Queryable and filterable event log with configurable max size (circular buffer)

---

## 11. Global Token Pause & Freeze

Independent of the circuit breaker, tokens can be manually paused or frozen at the account level:

- **Paused**: token will not be traded by any rebalancer or trade action; deposits, withdraws, sends, and distributions still allowed
- **Frozen**: token will not be traded AND not be moved — no trades, deposits, withdraws, sends, or distributions
- Frozen implies paused
- Fallback routing automatically skips paused/frozen intermediary tokens

---

## 12. Denomination System

Conditions, trade sizes, and rebalancer targets can be denominated in any registered ICRC-1 token:

- Price conditions denominated in any token (e.g., "buy when price < 50 ckUSDC")
- Balance conditions denominated in any token (e.g., "only trade if balance > $1000 in ckUSDC terms")
- Trade sizes denominated in any token (e.g., "trade $100 worth of ICP")
- Rebalancer portfolio values in configurable denomination token
- Real-time conversion using live DEX spot prices at evaluation time

---

## 13. DEX Aggregator

Built-in backend DEX aggregator for quoting and executing swaps:

- **Quote aggregation**: fetch quotes from all enabled DEXes, sorted by output amount (best first)
- **Best-quote selection**: automatically picks the DEX offering the best price
- **Single-DEX mode**: optionally restrict to a preferred DEX per action
- **Spot price queries**: for condition evaluation and portfolio valuation
- **Pool discovery & caching**: ICPSwap pool canister IDs discovered via factory and cached
- **Dual swap paths**: supports both ICRC-2 (approve + transferFrom, preferred) and ICRC-1 (transfer + deposit) swap flows for both ICPSwap and KongSwap
- **Default slippage**: configurable global default slippage tolerance (default: 1%)
- **Default max price impact**: configurable global default (default: 3%)

---

## 14. Logging & Monitoring

### 14.1 Bot Log (Activity Log)

- Comprehensive structured logging of all API calls and chore activities
- Log levels: Off, Error, Warning, Info (default), Debug, Trace
- Filterable by: level, source, caller, time range, ID range
- Paginated queries
- Configurable max entries (circular buffer, default: 10,000)
- Per-chore logging overrides

### 14.2 Trade Log

- Every trade, deposit, withdraw, send, detected inflow, and detected outflow is recorded
- Fields: timestamp, chore/action source, action type, tokens, amounts, price, price impact, slippage, DEX, status, error message, transaction ID, destination
- Filterable by: chore, action type, token pair, status, time range
- Paginated queries
- Configurable max entries (circular buffer, default: 10,000)

### 14.3 Portfolio Snapshot Log

- Periodic portfolio snapshots capturing: balance, price (in ICP, USD, and denomination token), and computed value for every registered token
- Before/after snapshots around trades
- Linked to trade log entries
- Configurable max entries (circular buffer, default: 5,000)

### 14.4 Daily OHLC Aggregation

- **Daily portfolio value summaries**: open/high/low/close in both ICP and USD, with closing token breakdown
- **Daily price candles**: per-token-pair OHLC price data
- Historical data accumulates over time for charting

### 14.5 Price History

- Ring buffer of all fetched price quotes
- Queryable by pair, with pagination
- Configurable max size (default: 5,000)
- Last known prices persisted across upgrades
- Configurable staleness thresholds for price and metadata refresh

### 14.6 Log Alert Summary

- API for checking new warnings/errors since a given log ID
- Used by the frontend for notification badges

---

## 15. Capital Tracking & P&L

- **Net capital deployed**: tracks total capital inflows and outflows in both ICP and USD terms
- **Per-token capital flows**: tracks native-amount inflows and outflows per token
- **Balance reconciliation**: detects untracked inflows (someone sends tokens to the bot) and outflows (unexpected balance decreases), logs them as detected events, and adjusts capital tracking accordingly
- **P&L computation**: current portfolio value minus net capital deployed (computed from snapshot data and capital tracking)

---

## 16. Permission System (Botkeys)

Fine-grained, role-based access control for delegated bot management.

### 16.1 Permission Types

| ID | Permission | Description |
|----|-----------|-------------|
| 0 | Full Permissions | Grants all permissions including future additions |
| 1 | Manage Permissions | Add/remove botkey principals |
| 2 | View Chores | View chore statuses and configurations |
| 3 | View Logs | Read log entries |
| 4 | Manage Logs | Set log level, clear logs |
| 200 | View Portfolio | View balances, purses, portfolio state |
| 202 | Manage Trades | Configure trade chore actions |
| 203 | Manage Rebalancer | Configure rebalancer targets and parameters |
| 204 | Manage Trade Chore | Start/stop/pause/resume/trigger trade chores |
| 205 | Manage Rebalance Chore | Start/stop/pause/resume/trigger rebalance chores |
| 206 | Manage Move Funds Chore | Start/stop/pause/resume/trigger move funds chores |
| 207 | Manage Token Registry | Add/remove supported tokens |
| 208 | Manage DEX Settings | Configure DEX parameters |
| 209 | Withdraw Funds | Send tokens from bot to external accounts |
| 210 | Configure Distribution | Add/update/remove distribution lists |
| 211 | Manage Distribute Funds | Start/stop/pause/resume/trigger distribution chores |
| 212 | Manage Snapshot Chore | Start/stop/pause/resume/trigger snapshot chores |
| 213 | Manage Circuit Breaker | Configure circuit breaker rules |
| 214 | Manage Purses | Enable/disable chore purses, fund/reclaim |

### 16.2 Features

- Controllers always have full access
- Botkey principals can be granted any combination of permissions
- Permissions can be added/removed individually
- Caller can query their own permissions
- Escrow snapshot/restore for backup

---

## 17. Frontend (Web UI)

### 17.1 Setup Wizard

- Guided multi-step wizard for initial bot configuration
- Steps: register tokens, fund the bot, create a trade or rebalance chore, configure actions
- Animated wizard character with sparkle effects

### 17.2 Bot Management Panel (Shared Component)

- **Info tab**: canister ID, version, cycle balance, controllers
- **Botkeys tab**: manage delegated access permissions
- **Chores tab**: view all chore instances, status lamps, start/stop/pause/resume/trigger controls
- **Log tab**: filterable activity log viewer with pagination

### 17.3 Trading-Bot-Specific UI

- **Portfolio overview**: token balances with USD/ICP values, main purse vs. chore purse breakdown
- **Portfolio value chart**: area chart of portfolio value over time (detailed snapshots + daily OHLC)
- **Price charts**: per-token-pair price history and daily OHLC candles
- **Trade Chore configuration**: action list with drag-and-drop reordering, per-action forms for all parameters
- **Rebalancer configuration**: target allocation management, portfolio status visualization with current vs. target allocations, deviation indicators
- **Move Funds configuration**: action list for scheduled fund movements
- **Distribution configuration**: distribution list management with target recipient rows
- **Circuit Breaker tab**: rule builder with condition/action forms, event log, global enable/disable
- **Token Registry management**: add/remove tokens, reorder, refresh metadata, pause/freeze controls
- **DEX Settings**: enable/disable DEXes, slippage/price impact defaults
- **Trade Log viewer**: filterable, paginated trade history
- **Purse management**: per-chore purse balances, fund/reclaim controls, overcommit warnings
- **Chore health indicators**: three-level status lamp system (Scheduler/Conductor/Task) with color-coded health states (Off, OK, Active, Overdue, Error) and worst-wins rollup

### 17.4 Status Lamp System

Visual health monitoring at multiple granularities:
- Per-timer-level lamps (Scheduler, Conductor, Task)
- Per-chore summary lamps
- All-chores summary lamp
- Color states: Gray (off), Green (OK/Active with pulse), Amber (overdue), Red (error)

---

## 18. Canister Management & Safety

### 18.1 Upgrade Safety

- All state in individual stable variables (no config records to migrate)
- Transient caches/closures re-created on every canister start
- Chore timers resume correctly after upgrades
- In-progress trades interrupted by upgrade are idempotent (retried safely)

### 18.2 Error Handling

- All trades wrapped in try/catch — a failed trade logs the error and continues to the next action
- Quote staleness: quotes fetched immediately before execution
- Balance validation: re-checked before every transfer/swap
- Non-negative purse balance enforcement (operations that would underflow are rejected, not clamped)
- On-chain sufficiency check before every actual transfer (even when purse balance is sufficient)

### 18.3 Cycle Management

- Bot monitors its own cycle balance
- Low-cycle warnings logged
- Canister status queryable (memory, cycles, controller list)

### 18.4 Escrow Support

- Botkey state snapshot/restore for escrow backup integration with the Sneedex verification system

---

## 19. Integration Points

- **Sneedex**: trading bot canister verification, escrow snapshot/restore for listing verification
- **Sneedapp Factory**: canister creation/deployment through the SneedDAO app ecosystem
- **Wallet integration**: trading bots displayed in the user's wallet alongside other bot types
- **ICRC-1 / ICRC-2 standard**: full compatibility with the Internet Computer token standards

---

## 20. Deployment Model

- **Self-sovereign**: each user deploys their own canister — no shared state, no centralized risk
- **On-chain execution**: all logic runs on the Internet Computer blockchain — no off-chain servers, no API keys, no centralized infrastructure
- **Open source**: part of the SneedDAO application ecosystem
- **Canister-to-canister**: the bot directly calls DEX canisters and token ledgers via inter-canister messages — no oracles, no bridges for on-chain assets

---

## Summary of Chore Types

| Chore Type | ID | Default Interval | Multi-Instance | Description |
|---|---|---|---|---|
| Trade | `trade` | 5 min | Yes | Conditional trades with action lists |
| Rebalance | `rebalance` | 1 hour | Yes | Portfolio rebalancing toward targets |
| Move Funds | `move-funds` | 1 hour | Yes | Scheduled fund movements (no trading) |
| Distribute Funds | `distribute-funds` | 1 day | Yes | Percentage-based fund distribution |
| Snapshot | `snapshot` | 1 hour | Yes | Periodic data collection and archival |
