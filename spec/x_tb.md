# Sneed Trading Bot — X Post

---

We built what we believe is the most feature-complete on-chain trading bot on the Internet Computer. Fully autonomous, fully on-chain, fully yours.

Here's everything it can do:

**Automated Trading**
Configure trade actions with conditions for when to execute: price thresholds, balance conditions, frequency windows. Set min/max amounts or trade a percentage of your balance. Choose your preferred DEX (ICPSwap or KongSwap) or let the bot auto-select the best quote. Set slippage limits and max price impact per action. Chain multiple actions in a single chore — each runs in sequence, on a configurable timer with randomized intervals.

**Trailing Stops & Take Profits**
Built-in trailing stop loss and trailing take profit. The bot tracks watermark prices and triggers when the price drops from peak (stop loss) or rises from trough (take profit). Choose whether to reset the watermark after execution or let it ride.

**Budget Limits & Auto-Halt**
Set cumulative input budgets, output budgets, and maximum execution counts per action. When a limit is hit, the chore stops automatically. Useful for DCA strategies with a fixed total budget.

**Portfolio Rebalancing**
Set target allocations in basis points across any number of tokens. The rebalancer computes deviations and trades overweight tokens into underweight ones, using weighted random pair selection. Configure deviation thresholds, min/max trade sizes, slippage, and impact limits.

**Fund Movement & Distribution**
Schedule recurring fund movements: fund purses, reclaim from purses, or send tokens to external accounts. Set up distribution lists that automatically split tokens across multiple recipients (external wallets or internal purses) with configurable thresholds and share allocations.

**Chore Purses — Isolated Balances**
Virtual accounting layer that gives each chore its own isolated balance. Fund a trading chore with exactly 10 ICP and it can only trade with that 10 ICP. Purses support cross-chore sharing — a rebalance chore can trade from a trade chore's purse. Includes overcommit detection and automatic lock management.

**Circuit Breakers**
Automated safety rules with complex conditions. Combine price thresholds, balance conditions, value monitoring, and percentage changes with AND/OR logic, nested as deep as you want. When conditions trigger, the bot can: stop or pause chores, freeze tokens, pause tokens in rebalance, or stop everything. Full event log for every trigger.

**DEX Aggregation**
Quotes from ICPSwap and KongSwap, automatically selects the best output. Filters quotes by price impact before ranking. Supports ICRC-2 approval path and ICRC-1 transfer fallback. Pool discovery and caching for ICPSwap.

**Quick Trades**
One-off manual trades through the bot with full control: pick your tokens, amount, DEX, slippage, impact limits. Queue management with status tracking and cancellation.

**Performance Analytics**
Equity curve chart tracking your portfolio value over time in ICP or USD. Daily OHLC portfolio summaries, price candles per token pair, capital flow breakdown per token, and per-purse performance tracking. Net capital deployed and P&L calculation with percentage returns.

**Comprehensive Logging**
Every trade attempt is logged: successes, skips, and failures with full error details. Portfolio snapshots before and after trades. Per-purse snapshots. Configurable log sizes, per-chore logging overrides, and filterable log queries.

**Inter-Bot Event System**
Bots can subscribe to events from other bots and execute reaction rules when events arrive. Set up a staking bot that pauses your trading bot when a chore fails. Configure conditions, cooldown periods, and choose from a library of reaction actions. Full audit log of every reaction.

**Token Management**
Add tokens, refresh metadata, scan for tokens with non-zero balances. Pause tokens (blocks trading but allows fund operations) or freeze them (blocks everything). Per-token controls across all chores.

**Fine-Grained Permissions**
22 distinct permission types. Give a hotkey access to view portfolio but not execute trades. Let a collaborator manage the rebalancer but not withdraw funds. Every API call is permission-checked.

**SneedScript — AI-Powered Configuration DSL**
Export your entire bot configuration to a human-readable script. Paste it into your favorite LLM along with your trading objectives. The LLM writes a configuration program. Paste it back — the bot parses it, shows you exactly what will change, and you approve before execution. Idempotent operations mean you can safely re-apply scripts without duplicating anything. Supports everything: tokens, chores, actions, rebalance targets, distributions, circuit breakers, event subscriptions, purse management, and more.

**Multiple Chore Instances**
Run multiple instances of any chore type simultaneously. Three different trading strategies, two rebalancers, a fund mover, and a distributor — all running independently on their own timers with their own purses.

**Manual Operations**
Send tokens, withdraw to external accounts, fund and reclaim from purses, recover stuck funds from DEX pools — all from the UI.

**Fully On-Chain**
The bot runs as an Internet Computer canister. No servers, no API keys, no custody risk. Your keys, your bot, your trades. Upgradeable with stable variable migration.

All of this is live today. We're just getting started.
