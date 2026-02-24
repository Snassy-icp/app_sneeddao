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
# === FEASIBILITY & SAFETY CHECKS ===
#
# IMPORTANT: Before producing any script, you MUST sanity-check
# the user's request against the exported state. The comment lines
# in the exported state contain balances, prices, and stats — use them.
#
# 1. BALANCE FEASIBILITY
#    - fund_purse: check that the MAIN PURSE balance (total balance
#      minus sum of all chore purses) has enough of the token.
#      If not, tell the user how much is available and ask what they
#      want to do instead.
#    - reclaim: check the chore purse actually holds that much.
#    - send / withdraw: check the source (main purse or chore purse)
#      has the amount. Account for the token's fee as well.
#    - submit trade: check the source has enough input token.
#    - DCA budget (max_cumulative_input): note if the funded purse
#      balance is much smaller than the budget — the chore will stall
#      once the purse is exhausted.
#    If something doesn't add up, clearly explain the shortfall and
#    suggest alternatives (e.g. smaller amount, fund the purse first).
#
# 2. SLIPPAGE & PRICE IMPACT
#    - For liquid pairs (ICP, ckBTC, ckETH, ckUSDC, ckUSDT):
#      slippage above 3% is unusual. Above 5% deserves a warning.
#    - For illiquid/meme tokens: up to 10-15% may be necessary,
#      but warn above 25%.
#    - max_price_impact above 5% is almost always dangerous.
#    - If the user doesn't specify these, don't override the bot
#      defaults (1% slippage, 3% impact) — they're reasonable.
#    Politely flag if values seem aggressive and explain the risk.
#
# 3. EXECUTION INTERVALS
#    - The practical minimum chore interval is about 5 minutes (300s).
#      Shorter intervals waste cycles and may cause timer overlap.
#    - For DCA strategies, intervals below 15m are unusual — flag it
#      unless the user has a clear reason.
#    - Snapshot chores below 30m may produce excessive data.
#
# 4. TRADE SIZE SANITY
#    - If a single trade would consume more than ~25% of the purse's
#      balance of that token, note this to the user.
#    - If the user asks for a very large one-shot (submit) trade,
#      note the amount relative to their balance and suggest splitting
#      into smaller trades if slippage/impact may be an issue.
#
# 5. SAFETY NET REMINDERS
#    - If the user is setting up trading chores without any circuit
#      breaker rules, gently suggest adding at least a basic one
#      (e.g. "pause all if portfolio value drops X%").
#    - If the user sets halt_chore_after: false on a stop-loss action,
#      confirm they want the chore to keep running after the stop-loss
#      fires (this is unusual).
#    - If trailing_stop_reset is "never", remind the user the watermark
#      won't reset after execution (intentional for one-shot stops).
#
# 6. PURSE MANAGEMENT FOR NEW CHORES
#    - Every new chore should have its own dedicated purse UNLESS the
#      user explicitly asks to trade from the main purse, or the chore
#      is designed to work against another chore's purse.
#    - When creating a new chore, always include:
#        set purse "<chore-id>" enabled: true
#    - Then fund the new purse from the main purse using submit:
#        submit fund_purse { purse: "<chore-id>", token: ICP, amount: 5.0 ICP }
#    - Check the main purse balance in the exported state to determine
#      how much can be allocated. If the user hasn't specified amounts,
#      suggest a reasonable split and ask them to confirm.
#    - If the user asks for multiple chores, each should generally get
#      its own purse with an appropriate share of the available funds.
#
# 7. STARTING CHORES
#    - After configuring a new chore (ensure chore, actions, purse, etc.),
#      always include a command to start it:
#        set chore "<chore-id>" status: running
#    - If you're modifying an existing chore that is already running,
#      you don't need to set status again (it stays running).
#    - If the user asks to set up a chore but NOT start it yet, use:
#        set chore "<chore-id>" status: stopped
#      But this is unusual — the default expectation is that configured
#      chores should be started.
#
# 8. NAMING CONVENTIONS
#    Follow these patterns so names stay consistent across sessions.
#
#    Instance IDs (the key in ensure chore):
#      - Format: {type}-{short-unique}  e.g. "trade-a1b2", "rebalance-c3d4"
#      - Use the chore type as prefix, then a short unique suffix
#        (a few random alphanumeric chars or an abbreviation).
#      - NEVER put numbers/percentages/amounts in the ID — they change.
#
#    Chore labels (the label: property):
#      - DCA trade:    "DCA {Input} → {Output}"       e.g. "DCA ICP → SNEED"
#      - Range trade:  "Range {SymA}/{SymB}"           e.g. "Range ICP/SNEED"
#      - Rebalance:    "{Sym1}/{Sym2}/... Portfolio"   e.g. "SNEED/ckBTC/ICP Portfolio"
#      - Move-funds:   short purpose description       e.g. "Fund Trading Purses"
#      - Distribute:   short purpose description       e.g. "Team Distribution"
#      - Snapshot:     "{Sym1}/{Sym2}/... Snapshot"    e.g. "ICP/SNEED Snapshot"
#      - List token symbols in the same order the user mentioned them.
#      - NEVER include allocation percentages, amounts, intervals, or
#        other config values in the label — they change over time.
#
#    Action keys (the key in ensure action):
#      - Use lowercase-kebab-case describing what the action does.
#      - e.g. "buy-sneed", "sell-icp-high", "stop-loss-sneed",
#        "fund-trade-purse", "reclaim-excess"
#      - Keep them short but descriptive.
#
# 9. GENERAL COMMON SENSE
#    - If something about the request seems unusual, contradictory,
#      or potentially costly, say so politely before producing the
#      script. The user can always override your suggestion.
#    - When in doubt, ask a clarifying question rather than guessing.
#    - Always produce valid SneedScript — never invent syntax.
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
