// Generates a concise but complete SneedScript DSL reference for LLM consumption.

export function generateLLMGuide() {
  return `# ==========================================
# SneedScript DSL Reference
# ==========================================
#
# SneedScript is the configuration language for Sneed Trading Bot.
# The user will paste their bot's current state (a valid DSL document) below this guide.
# Your job: produce a SneedScript program that achieves the user's objectives.
#
# IMPORTANT:
# - Lines starting with # are comments (ignored by parser). The exported state
#   uses comments to show read-only stats (balances, execution counts, prices).
# - Your output should be ONLY the DSL statements needed to make changes.
#   Do NOT repeat unchanged state. The resolver is idempotent — unchanged
#   \`ensure\` statements become no-ops, but omitting unchanged state is cleaner.
# - Do NOT invent token symbols. Only use symbols from the exported state or
#   explicit principals for new tokens.
#
# === LITERALS ===
#
# Integer:     100, 10_000_000  (underscores ignored)
# Decimal:     1.5, 0.0001     (converted to raw units using token decimals)
# Amount:      1.5 ICP, 0.0001 SNEED   (decimal + token symbol)
# Basis pts:   100 bps, 500 bps
# Duration:    300s, 5m, 1h    (converted to seconds)
# Boolean:     true, false
# String:      "hello"         (double-quoted)
# None:        none            (null/absent)
# List:        [ICP, SNEED, ckUSDC]
# Token ref:   ICP             (symbol) or "ryjl3-tyaaa-aaaaa-aaaba-cai" (principal)
#
# === STATEMENT TYPES ===
#
# 1. ensure — idempotent upsert (create or update to match)
#    ensure <entity> <key> [in <scope>] { <props> }
#
# 2. remove — idempotent delete (no-op if absent)
#    remove <entity> <key> [from <scope>]
#
# 3. set — set a specific value (no-op if already matches)
#    set <target> <property>: <value>
#
# 4. submit — imperative action (always executes, NOT idempotent)
#    submit <action_type> { <props> }
#
# 5. reset_stats — reset cumulative counters
#    reset_stats action "key" in "chore-id"
#
# === ENTITY REFERENCE ===
#
# ---- token ----
# ensure token ICP {
#   ledger: "ryjl3-tyaaa-aaaaa-aaaba-cai"
#   symbol: "ICP"
#   decimals: 8
#   fee: 0.0001 ICP
# }
# remove token SNEED
# set token ICP paused: true
# set token ICP frozen: true
# set token ICP paused: false
# set token ICP frozen: false
#
# ---- chore ----
# Types: trade, rebalance, move-funds, distribute-funds, snapshot
# ensure chore "trade-1" {
#   type: trade
#   label: "Main Trading Chore"
# }
# set chore "trade-1" interval: 300s
# set chore "trade-1" max_interval: 600s
# set chore "trade-1" task_timeout: 120s
# set chore "trade-1" status: running    (also: paused, stopped)
# remove chore "trade-1"
#
# ---- action (in trade or move-funds chore) ----
# ensure action "buy-sneed-dip" in "trade-1" {
#   type: trade              (trade | fund_purse | reclaim | send)
#   enabled: true
#   input: ICP
#   output: SNEED            (trade only)
#   min_amount: 0.1 ICP
#   max_amount: 1.0 ICP
#   amount_mode: range       (range | percent)
#   balance_percent: none    (when amount_mode=percent: 0-10000 bps)
#   preferred_dex: auto      (auto | ICPSwap | KongSwap)
#   source_purse: none       (for reclaim/send)
#   target_purse: "trade-1"  (for fund_purse)
#   destination: "principal"  (for send — external account)
#   min_balance: 5.0 ICP
#   max_balance: none
#   balance_denomination: ICP
#   min_price: none          (trade only)
#   max_price: 0.001 ICP     (trade only)
#   price_denomination: ICP
#   max_price_impact: 300 bps
#   max_slippage: 100 bps
#   min_frequency: 300s
#   max_frequency: 600s
#   trade_size_denomination: ICP
#   trailing_stop: 500 bps
#   trailing_stop_direction: stop_loss   (stop_loss | take_profit)
#   trailing_stop_reset: on_exec         (on_exec | never)
#   halt_chore_after: false
#   max_cumulative_input: 100.0 ICP
#   max_cumulative_output: none
#   max_executions: 50
# }
# remove action "buy-sneed-dip" from "trade-1"
# reset_stats action "buy-sneed-dip" in "trade-1"
#
# ---- rebalance_target (in rebalance chore) ----
# ensure rebalance_target ICP in "rebalance-1" {
#   target: 5000 bps         (50.0%)
#   paused: false
# }
# remove rebalance_target SNEED from "rebalance-1"
#
# ---- rebalance settings (set only) ----
# set rebalance "rebalance-1" denomination: ICP
# set rebalance "rebalance-1" max_trade_size: 10.0 ICP
# set rebalance "rebalance-1" min_trade_size: 0.1 ICP
# set rebalance "rebalance-1" threshold: 500 bps
# set rebalance "rebalance-1" max_slippage: 100 bps
# set rebalance "rebalance-1" max_price_impact: 300 bps
# set rebalance "rebalance-1" fallback_route_tokens: [ICP, ckUSDC]
#
# ---- distribution (in distribute-funds chore) ----
# ensure distribution "team-pay" in "dist-1" {
#   token: ICP
#   threshold: 1.0 ICP
#   max_amount: 10.0 ICP
#   min_amount: 0.5 ICP
#   amount_mode: range
#   balance_percent: none
#   source_purse: none
#   targets: [
#     { account: "aaaaa-bbbbb-...-cai", share: 5000 bps }
#     { purse: "trade-1", share: 2000 bps }
#   ]
# }
# remove distribution "team-pay" from "dist-1"
#
# ---- circuit_breaker (keyed by name) ----
# set circuit_breaker_enabled: true
# ensure circuit_breaker "crash-protection" {
#   enabled: true
#   when ALL {                           (ALL = AND, ANY = OR; nestable)
#     price ICP/ckUSDC < 5.0 ckUSDC
#     balance ICP in main > 10.0 ICP     (purse: main, "chore-id")
#   }
#   then {
#     stop chore "trade-1"
#     freeze token SNEED
#   }
# }
# remove circuit_breaker "crash-protection"
#
# CB conditions:  price T1/T2 > <amt>  |  price T1/T2 < <amt>
#                 balance TOKEN in <purse> > <amt>
#                 price T1/T2 changed up|down|either <bps> in <duration>
# CB actions:     stop|pause|start chore "id"
#                 stop|pause|start all chores
#                 stop|pause|start all TYPE chores
#                 pause token TOKEN [in "rebal-id"]
#                 freeze token TOKEN
#
# ---- DEX settings ----
# set dex ICPSwap enabled: true
# set dex KongSwap enabled: false
# set default_slippage: 100 bps
# set default_max_price_impact: 300 bps
#
# ---- purse management ----
# set purse "trade-1" enabled: true
# set purse "trade-1" trading_purse: "rebalance-1"
# set purse "trade-1" trading_purse: none
#
# ---- event system ----
# ensure event_subscription to "source-canister-principal" {
#   event_types: [0, 1, 4]
# }
# remove event_subscription to "source-canister-principal"
#
# ensure event_reaction "stop-on-fail" {
#   enabled: true
#   subscription: "source-canister-principal"
#   event_type: 5
#   action: 1
#   action_params: {
#     choreInstanceId: "trade-1"
#   }
#   conditions: [
#     { key: "choreId", op: equals, value: "unstake" }
#   ]
#   cooldown: 300s
# }
# remove event_reaction "stop-on-fail"
#
# set event_emission: true
#
# ---- logging ----
# set logging trade_log: true
# set logging portfolio_log: true
# set logging max_trade_log_entries: 10000
# set logging max_portfolio_log_entries: 5000
# set chore_logging "trade-1" trade_log: true
# remove chore_logging "trade-1"
#
# ---- price / metadata ----
# set price_staleness: 300s
# set metadata_staleness: 3600s
# set price_history_max_size: 5000
#
# ---- fallback route tokens ----
# set trade "trade-1" fallback_route_tokens: [ICP, ckUSDC]
#
# === IMPERATIVE OPERATIONS (submit) ===
#
# submit trade {
#   input: ICP
#   output: SNEED
#   amount: 1.5 ICP
#   min_output: none
#   slippage: 100 bps
#   max_price_impact: 300 bps
#   dex: auto
#   source_purse: none
# }
#
# submit withdraw {
#   token: ICP
#   to: "destination-principal"
#   amount: 10.0 ICP
# }
#
# submit send {
#   token: ICP
#   to: "destination-principal"
#   amount: 5.0 ICP
#   source_purse: "trade-1"
# }
#
# submit fund_purse { purse: "trade-1", token: ICP, amount: 5.0 ICP }
# submit reclaim { purse: "trade-1", token: ICP, amount: 2.0 ICP }
#
# === SUPPLEMENTARY CONTEXT ===
#
# The user has additional data they can copy for you from the bot's UI.
# If you need any of the following, ask the user to provide it:
#
# 1. TOKEN REGISTRY (with ledger canister IDs)
#    Ask: "Please click 'Copy All Tokens' in the LLM Context bar of the
#    Script tab and paste the result here."
#    You need this when: writing ensure token statements for new tokens,
#    or referencing tokens by principal instead of symbol.
#
# 2. TRADE LOG (recent trade executions)
#    Ask: "Please click 'Copy Trade Log' in the LLM Context bar (or the
#    Copy button on the Trade Log panel) and paste the result here."
#    You need this when: debugging why trades are failing or being skipped,
#    analyzing trading performance, or understanding execution patterns.
#
# 3. BOT LOG (activity and error log)
#    Ask: "Please click 'Copy Bot Log' in the LLM Context bar (or the
#    Copy button on the Bot Log panel) and paste it here."
#    You need this when: diagnosing errors, understanding chore behavior,
#    or investigating unexpected bot activity.
#
# 4. CIRCUIT BREAKER LOG (trigger events)
#    Ask: "Please click 'Copy CB Log' in the LLM Context bar (or the
#    Copy button on the Circuit Breaker Event Log) and paste it here."
#    You need this when: understanding why chores were stopped/paused,
#    or tuning circuit breaker conditions.
#
# 5. CHORE-SPECIFIC LOGS
#    Ask: "Please go to the chore's Logs tab, click the Copy button,
#    and paste the result here."
#    You need this when: debugging a specific chore's behavior.
#
# When the user provides an exported bot state, the # comment lines
# contain read-only stats (balances, execution counts, prices, timestamps).
# Use these to understand the bot's current situation.
#
# === END OF REFERENCE ===
`;
}
