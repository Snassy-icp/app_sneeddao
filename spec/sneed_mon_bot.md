# sneed_mon_bot: Sneed Mon Bot, the programmable watcher you own (draft)

Sneed Monitor (`sneed_mon`, spec/sneed_mon.md) is one shared canister that watches proposals for
everyone and bills each check. It is meant for the simple Sneed Hub cases: proposals to vote on,
low cycles, later account balances and top-ups (spec/programmable_accounts.md §8). The full
version of the idea is "monitor this, do that":

- watch many kinds of things and connect them to many kinds of actions;
- run actions on a schedule, whether or not anything is watched ("every 10 minutes, call this
  method");
- in the north star, feed the parameters of one call from the results of earlier calls.

A shared canister cannot run that safely. It would have to meter every user's gas, and one
user's workflow could starve everyone else's. **sneed_mon_bot** is a new bot app minted through
Sneedapp, like the ICP staking bot (`src/sneed_bots/sneed_icp_staking_bot`) and the trading bot
(`src/sneed_bots/sneed_trading_bot`). Each user owns their own canister, and the canister pays for
its own cycles. **Gas is solved by ownership.** We don't measure gas. The bot burns its own
cycles, the owner tops it up, and Sneed Monitor or a sneed_vault funding tree can keep it fuelled.
We bound the work per run so that a mistake costs a known maximum; we don't bill it.

For the user there is still **one Sneed Monitor**: one GUI and one balance. Simple monitors run on
the shared canister. The first advanced one mints the user's bot behind the scenes and hooks it up
(§1, the centre of this design).

Status (2026-10-21): spec only, nothing built. Open questions are marked **Q** and collected in
§16.

## 1. One Sneed Monitor, two engines

This section is the centre of the design. Everything else in the spec serves it.

**Sneed Monitor is one service with one GUI** (the Sneed Monitor page in Sneed Hub). It covers
everything from "remind me to vote" to "every 10 minutes read X, compute Y, call Z". It runs on
two engines:

- **the shared engine:** `sneed_mon` (spec/sneed_mon.md), for the simple things. It is billed
  per check from the user's Sneed Monitor balance;
- **the user's own engine:** a `sneed_mon_bot` canister owned by the user, for anything advanced.
  It burns its own cycles, which Sneed Monitor keeps topped up from the same balance.

The user sees one list of "monitors" and one balance. The first time they configure something
the shared engine can't do, Sneed Monitor asks once for the bot's price and a custody choice
(§1.3). It then mints their bot through Sneedapp, hooks it up (§1.4), and the user carries on
editing what they were editing. A new Sneed bot appears in their apps wallet; they don't need to
notice or care. From then on, all they need to know from Sneed Monitor is **when to top up**
(§1.5).

The bot is also an ordinary Sneedapp bot. It can be minted directly on `/sneedapp` like the
staking and trading bots, and it has its own management page like they do (§11). Sneed Monitor
can adopt a bot minted that way (§1.4, step 0).

### 1.1 Which engine runs what

| | shared `sneed_mon` | the user's `sneed_mon_bot` |
|---|---|---|
| what | the fixed watch kinds: proposals and reminders; later low cycles, balances, top-ups and funding trees (spec/programmable_accounts.md §8) | any trigger → any workflow of reads and actions, with dataflow between steps (§4–§8) |
| who pays | per check from the Sneed Monitor balance (bookkeeping) | the bot's own cycles, refilled from the same balance (§1.5); the mint price once |
| holds funds | service balances only | its own tokens, allowances given to it, vault grants to it |
| acts as | sneed_mon (reads, notifications) | the bot principal: transfers, votes as hotkey, calls any method |
| upgrade | DAO proposal | the owner (or, with shared custody, the custodian: §1.3), through every published version |
| GUI | Sneed Monitor | Sneed Monitor, and the bot's own page |

**The routing rule.** The Monitor GUI knows which settings each engine can serve. If a monitor
fits the shared engine's watch kinds, it runs there, even for a user who has a bot. That is
cheaper for small things, because there is no per-user polling. A monitor becomes a bot workflow
when it uses anything the shared engine lacks:

- a custom schedule (cron, under 10 minutes, `once`);
- an action other than notify or top-up;
- a generic read or call;
- a binding or expression beyond a threshold;
- a chain of steps;
- spending from the bot's own funds.

The GUI labels each monitor with a small badge ("shared", "your bot") and explains it on hover.
Nothing else changes for the user.

### 1.2 The moment it gets advanced

1. While the user edits a monitor, the GUI notices the first advanced setting and shows an inline
   card: "This needs your own Sneed Mon Bot. It runs your automations on its own, paid from your
   Sneed Monitor balance. One-time price: <price> (`useDenomination` value)." The card links to
   "what is this?", the help page.
2. The card has one choice: custody (§1.3), default **sole custody**. It also shows a
   summary of the gas setup (§1.5).
3. "Get my bot and continue" pays, mints and hooks up (§1.4) while the editor stays open. The
   monitor being edited is saved to the new bot as the last step.
4. "Not now" keeps the draft in the browser (local storage, try/catch) and reverts the setting.

A user who already has a bot never sees the card. Advanced monitors go straight to their bot (the
"primary" bot if they have several: **Q19**).

### 1.3 Custody: the user's explicit choice

The choice is shown as three options in plain words. Nothing is preselected except sole custody.
It can be changed later on the bot's page, and the change is logged in the bot's ICRC-3 log
(`smb_perm`, `smb_custody`).

| option | what Sneed gets | what it allows Sneed to do | what it can't do | risks for the user |
|---|---|---|---|---|
| **Sole custody** (default) | nothing | nothing. Sneed Monitor still reads the bot's public status (cycles, version) and tops it up, because topping up needs no rights | anything | if the user loses their login, nobody can upgrade, repair or recover the bot or the funds in it; upgrades wait for the user (Sneed Monitor prompts with one click) |
| **Operator** (a botkey) | the Sneed **operator** principal gets a fixed botkey bundle: ViewWorkflows, ViewRuns, ViewLogs, ViewChores, Simulate, KillSwitch | read the bot's setup and runs to give support; run simulations; **pause** workflows, for example when a bug is found in a version and the DAO pauses affected bots before the fix | edit workflows, change budgets or allowlists, move funds, upgrade, add permissions | a compromised operator could read the bot's configuration (public in substance anyway, §9.7) and pause it (denial of service, never theft); support can see but not fix |
| **Shared custody** (co-controller) | the Sneed **bot custodian** canister becomes a second controller next to the user | everything the operator can; plus **upgrade** the bot along the published path (auto-upgrades, security fixes), reinstall it after a trap, and change its freezing threshold | anything the custodian's code doesn't allow: it upgrades only to wasm hashes Sneedapp lists as published versions of this app, in path order, and can't move funds itself, add other controllers or remove the user | the custodian's power is the power of **whatever Sneed publishes**: a malicious or buggy published version, or a bug in the custodian, could reach the bot's funds. The DAO governs what is published (by proposal), so the user trusts the DAO's release process instead of only themselves. The user can remove the custodian at any time (they remain a controller) |

Rules:

- **No human principal** is ever offered as operator or controller. The operator is a DAO-owned
  canister principal: the shared `sneed_mon`, or a dedicated `sneed_ops` canister (**Q20**) whose
  pause calls are themselves DAO-governed or admin-with-log.
- The custodian is a canister in the custody family (spec/custody.md: `sneed_guardian`,
  blessed-hash-only controllers with DAO-approved operations). Recommendation: a small
  **`sneed_bot_custodian`** controlled by SNS root. Its only methods:
  - `upgrade_bot(bot)`: reads the bot's module hash, computes the next published version of
    the app from Sneedapp, and installs it; callable by the bot's owner or on a DAO-approved
    "push release" schedule;
  - `reinstall_bot(bot)`: same version, keep memory, only on the owner's request;
  - `set_freezing_threshold(bot, ≥ 30 days)`.

  The user's opt-in is recorded on the custodian (`opt_in(bot)` signed by the user). A custodian
  that is a controller without that record does nothing. **Q21**: build it, or launch with
  sole custody and operator only?
- "Help me" from support never needs custody. A user in trouble can grant the operator bundle for
  a day, as a botkey, and revoke it after.
- Funds sit in the bot only as far as workflows need them. The GUI recommends vault grants
  (§12.2) for larger amounts under any custody option, so the worst case of any option is capped
  by the grant.

### 1.4 Mint and hook-up (automatic, resumable)

The frontend runs these steps as the user, as a checklist that survives a closed tab. The state
lives on the shared `sneed_mon` (`get_my_bot_setup`), and each step is idempotent:

0. **Adopt instead of mint** (if the wallet already lists a `sneed-mon-bot` the user controls):
   "Use your existing bot <name>?" Then skip to step 3.
1. **Pay.** The mint is paid through Sneedapp's normal flow:
   - **from the Sneed Monitor balance** (default when it covers the price):
     `sneed_mon.pay_bot_mint()` moves the price from the user's balance to the user's Sneedapp
     deposit subaccount (an ICP transfer from sneed_mon's main account, counted as a withdrawal);
   - **or from the wallet**, as on `/sneedapp`.

   Special prices apply as in Sneedapp (premium, admin, partner).
2. **Mint.** Sneedapp `mint` as the user creates the canister, installs the current version,
   hands it to the user (sole controller), and adds it to the user's apps wallet.
3. **Link.** `sneed_mon.link_bot(bot)` checks that:
   - the caller controls the bot (`canister_info`);
   - its module hash is a published version of `sneed-mon-bot` in Sneedapp.

   It then records the bot as the user's (several are allowed; the first is primary) and adds it
   to Sneed Notifications as a scoped canister of the "Sneed Monitor" app (§12.6).
4. **Custody.** For operator: `add_botkey(operator, bundle)`. For shared custody:
   `update_settings` adding the custodian, then `custodian.opt_in(bot)`. Sole: nothing.
5. **Gas monitor** (§1.5): a cycles watch on the bot in `sneed_mon`, with its refill source.
6. **The bot's own setup:** freezing threshold 30 days (if Sneedapp didn't set it, **Q10**), the
   `min_reserve_cycles` default, the notification link.
7. **Save the workflow** the user was editing (from step 1.2), live or dry-run as they chose.

Failures stop the checklist at that step with a clear retry. A paid but unminted state is
Sneedapp's existing case: the payment stays in the deposit subaccount and the next mint uses it.

### 1.5 Gas: one balance, one alert

- **On mint, a gas monitor is always set up.** It is a `sneed_mon` cycles watch on the bot,
  hourly, with "below `refill_below` (default 2 T) top up `refill_amount` (default 1 T)". The
  bot's cycles are read through the bot's public `get_cycles` (unverified, but a lie only hurts
  the bot's own refills) or through the custodian or blackhole when one is a controller.
- **Refill sources**, in the user's order of preference:
  1. **the Sneed Monitor balance** (default): sneed_mon converts ICP to cycles through the CMC
     for the bot. It debits the balance by the ICP used plus the ledger fee, and logs a charge
     (`kind = "bot_gas"`). This is a new sneed_mon feature: the balance pays for cycles,
     not only checks;
  2. **an ICRC-2 auto top-up** from a wallet subaccount (sneed_mon §3, extended to cycles);
  3. **a sneed_vault grant** to sneed_mon with the condition "only when the bot is below X"
     (spec/programmable_accounts.md §7.2).
- **What the user sees:** one balance and one "days left" figure. It combines the shared checks'
  daily cost and the bot's burn rate (§8.8, read from the bot), converted to ICP.
- Low balance raises Sneed Monitor's existing "top up" alert (topic `account`), and the existing
  auto top-up of the Monitor balance can refill it in turn. That is the whole funding tree, set up
  without the user drawing it.
- The bot's own reserve (§9.5) is the last line: a bot that is never refilled pauses itself
  before it freezes, and says so.

### 1.6 Migration between engines

- **Shared → bot:** any shared watch has "Move to my bot" (and the GUI offers it when a user
  edits the watch into something advanced). The move:
  1. creates the equivalent bot workflow from a recipe (proposal watch → "Remind me to vote" or
     "Vote alerts" recipe, same topics, intervals and reminder windows) in `dry_run`;
  2. runs it once to set its baseline (proposals seen);
  3. switches it to `live` and calls `unwatch` on the shared watch, in that order.

  Proposals already announced by the shared watch are passed into the bot's seen-set, so nothing
  is announced twice. Dedupe keys differ between the engines, so the hand-over order is what
  prevents duplicates. Simple watches may also **stay** on the shared engine forever; nothing
  forces a move.
- **Bot → shared:** a bot workflow that turns out to be simple (it matches a shared watch kind
  exactly) offers "Run this on the shared service instead" (cheaper when the user has few
  advanced monitors). The bot workflow is paused, not deleted.
- **Leaving:** a user can unlink the bot (`sneed_mon.unlink_bot`). The gas monitor stops, the
  scoped notification canister is removed, and the bot keeps running on its own cycles as an
  ordinary Sneedapp bot.
- **Shared watches and the balance** are untouched by any of this. One balance pays for both
  engines.

### 1.7 What `sneed_mon` needs for this

- New state: per user, linked bots (verified as in §1.4 step 3), the primary bot, and the setup
  checklist.
- New methods: `link_bot`, `unlink_bot`, `set_primary_bot`, `get_my_bots`, `get_my_bot_setup`,
  `pay_bot_mint`, `move_watch_to_bot` (the frontend does the bot side; sneed_mon only records the
  seen-set export and the unwatch).
- Cycles top-ups from the balance (§1.5): a CMC transfer and `notify_top_up` with a pending list,
  as in sneed_vault §5.3.
- Notification wiring as the owner of the "Sneed Monitor" app (§12.6).
- Accounting: `bot_gas` charges, and mint payments as withdrawals, under the existing invariant
  (sneed_mon §3).

## 2. Words

- **Workflow:** a named unit of automation: one **trigger** plus a DAG of **steps**. It is
  versioned (§8.12) and carries its own **budget** (§8.8) and **allowlist** (§9.2).
- **Trigger:** what starts a **run**: a schedule, a condition over a watched value, an event from
  another bot, a call from a permitted principal, or "Run now".
- **Step:** one node of the DAG. It is either a **read** (a query whose result is data), an
  **action** (something with effects: a transfer, a vote, a call to an update method), or
  **logic** (a guard, a for-each, setting a variable, calling a sub-workflow).
- **Binding:** where a step parameter gets its value: a constant, a **selector** over an earlier
  step's output, a text **template**, or an **expression** (§6).
- **Connection:** a stored method signature (`canister`, `method`, argument and result types) that
  generic reads and calls use to encode and decode Candid (§7).
- **Run:** one execution of a workflow version. It has a trace of step results, kept in the run
  history and summarised in the bot log.
- **Recipe (template):** a parameterised workflow with a casual form on top ("keep canister X
  above 2T cycles"). Filling it in produces an ordinary workflow, which the pro editor can open.

## 3. The bot canister

### 3.1 Shape

- `src/sneed_bots/sneed_mon_bot/{main.mo, Types.mo, ApiDoc.mo}`: a persistent actor with
  enhanced orthogonal persistence, built with the release toolchain (dfx 0.28.0, moc 0.14.13).
- It reuses the shared bot modules unchanged where possible:
  - `BotkeyPermissions.mo` / `BotkeyTypes.mo`: permissions (§9.1);
  - `BotLogEngine.mo`: the human-readable log, read by `useBotLogNotification`;
  - `BotChoreEngine.mo`: scheduling. Each workflow is an instance of one chore type, `workflow`
    (§8.1). Status lamps, `BotChoreHealthDialog` and `useBotChoreNotification` then work
    without changes;
  - `BotEventEngine.mo`: event triggers from other bots, and events this bot emits (§4.4).
- `CURRENT_VERSION` in Types.mo is bumped on every release. Every published version stays
  published, because bots upgrade through each one in turn (`utils/upgradePath.js`). A
  migration only handles the previous version.
- ID ranges: botkey permissions **300–399** and event type IDs **300–399** (staking 100–199,
  trading 200–299).

### 3.2 Ownership

Sneedapp creates the canister, installs the wasm and hands it over: the minter becomes the only
controller (`handOver` in `src/sneedapp/main.mo`). Controllers have every permission. Botkeys
grant narrower rights (§9.1). The bot never adds itself or Sneedapp as a controller, and it holds
no admin list of Sneed's. Sneed gets rights over a bot only by the owner's explicit custody
choice (§1.3): an operator botkey, or the `sneed_bot_custodian` as a second controller.

### 3.3 What the bot can act with

Everything a workflow does, it does **as the bot's principal**:

- tokens in the bot's own accounts (main and subaccounts);
- ICRC-2 allowances that others gave the bot (`transfer_from`);
- sneed_vault grants that name the bot as grantee (`request_funds`);
- SNS neurons that list the bot with permissions (vote; submit proposal only if granted), and NNS
  neurons that list the bot as a hotkey (vote);
- botkey permissions that other Sneed bots gave this bot (pause a trading chore, and so on);
- its own cycles.

So every workflow on a bot shares one set of powers. That is why the allowlists (§9.2) and
budgets (§9.3) are per workflow.

## 4. Triggers

Each workflow has exactly one trigger. Several workflows may share a source; reads are cached
per round (§8.2).

### 4.1 Schedule

- `every { seconds; jitter_s }`: at least 60 s (**Q1**: a lower floor for pros?). An optional
  jitter spreads the runs, as the chore engine's `maxIntervalSeconds` does.
- `cron { minute; hour; day_of_month; month; day_of_week; utc_offset_min }`: a subset of cron.
  Each field is `*`, a list, a range or a step (`*/15`). Times are in UTC with a fixed offset.
  Daylight saving is not modelled (**Q2**). The next fire time is computed on-chain from the
  fields and shown in the UI.
- `once { at }`: a single run at a time (reminders, a delayed action).
- Missed fires are not replayed. After an upgrade or a pause, the next fire is the next future
  slot, and the run log notes "skipped N".

### 4.2 Condition (polled)

A condition is a **read** plus a **test**, evaluated on its own poll schedule (an `every` or
`cron` as above, default every 10 minutes). The workflow runs when the test **fires**:

| mode | fires when | use |
|---|---|---|
| `crosses { dir }` | the value moves from one side of the threshold to the other (`up`, `down`, `either`) | "cycles fell below 2T" |
| `level { rearm }` | the test is true; it fires once and re-arms only after the test was false (with optional hysteresis: `rearm` is a second threshold) | "balance below 1 ICP" without repeating every poll |
| `changes { min_delta }` | the value differs from the last reading by at least `min_delta` (absolute or percent) | "pool price moved 10% since the last alert" |
| `new_items { key }` | a list read returns items whose key was not seen before | new proposals, new ICRC-3 blocks, new mentions |
| `always` | each poll | a read whose result only feeds the steps |

The test is an expression over the read's output (§6), for example
`out.e8s < 200_000_000_000`. The first reading only records a baseline, so `crosses` and
`changes` never fire on it, and `new_items` treats what is there as seen. **Q3**: offer "count
what is there now as new" for `new_items`? A `cooldown_s` stops a flapping value from firing more
than once a period.

The condition state is kept per workflow: the last value, whether it is armed, the last fire time
and the seen-keys set (capped at 2,000 keys, oldest dropped first). Editing the read or the test
resets the baseline.

### 4.3 Sources (built-in reads)

Built-in sources are **typed** calls compiled into the bot (Motoko actor types), so they need no
generic Candid (§7). Each produces a typed output the selectors can address.

| source | call | output | notes |
|---|---|---|---|
| ICRC-1 balance | `icrc1_balance_of(account)` on a ledger | `nat` | any account, not only the bot's |
| ICP account (legacy) | `account_balance` on the ICP ledger | `{ e8s }` | for 64-hex account ids |
| canister cycles | `canister_status` (bot is a controller), a trusted blackhole (`e3mmv-5qaaa-aaaah-aadma-cai`, `sneed_guardian_blackhole`), or the target's own query ("unverified") | `{ cycles; memory; status; module_hash? }` | the same three ways as spec/programmable_accounts.md §6.4 |
| own cycles | `Cycles.balance()` | `nat` | no call |
| canister info | `canister_info` (management canister, callable by any canister) | `{ module_hash; controllers }` | "alert me when canister X is upgraded or its controllers change" |
| SNS proposals | governance `list_proposals` (open ones, up to 3 pages) | list of proposals | `new_items` by id; filters: topic, type, "closes within" |
| SNS unvoted | `get_proposal` ballots matched against neurons the bot reads or is given | list `{ proposal; neurons }` | as sneed_mon §2 phase 3 |
| NNS proposals | `list_proposals` on `rrkah-…` | list | |
| SNS neuron | `get_neuron` / `list_neurons` | neuron | dissolve state, stake, maturity, followees |
| NNS neuron | `get_neuron_info` (public); `get_full_neuron` when the bot is a hotkey or controller | neuron info | **Q4**: confirm what a hotkey may read on mainnet |
| pool price | ICPSwap pool `metadata` (sqrtPriceX96) or `quote`; Kong `swap_amounts` | `{ price; inverse; liquidity? }` | the trading bot's DEX code, moved into a shared module (§3.1) |
| ICRC-3 blocks | `icrc3_get_blocks` from a cursor | list of blocks | `new_items` by index; filter by `btype` and fields. Covers Sneedex, the forum, Sneed Lock, sneedapp, premium, RLL and any ICRC-3 canister |
| forum mentions | the forum's mentions of a principal | list | or the forum's ICRC-3 log |
| Sneed SMS inbox | the bot's own SMS inbox | list | messages sent **to the bot** |
| bot status | another Sneed bot's chore statuses and log alert summary | statuses | "my trading bot's chores turned red" |
| generic query | any `query` method with a connection (§7) | decoded Candid value | v0.3 (§15) |

All reads are inter-canister calls made from a replicated update context. They cost cycles like
any call, and composite queries cannot be called this way. The cost table (§10) applies.

### 4.4 Event (pushed, no polling)

The bot subscribes to other Sneed bots through `BotEventEngine` (it registers as a listener on
the source bot, which needs the `ViewEvents` botkey permission on that bot). A matching
`BotEvent` (type ID plus `data` key/value filters, the existing `EventCondition` operators) starts
the workflow, with the event as the trigger output. Examples: "trade executed" (trading bot,
200+), "chore failed" (any bot, base 5). This costs nothing until an event arrives.

The bot also **emits** events (300–399): `WorkflowRunCompleted`, `WorkflowRunFailed`,
`WorkflowPaused`, `ConditionFired`, `BudgetExhausted`, `LowCycles`. Other bots, and other mon
bots, can react to them.

### 4.5 Invoke (called)

`run_workflow(id, inputs : vec record { text; Value })` by a principal with the `RunWorkflows`
permission. This is the "Run now" button, the MCP's `monbot_run` (§12.4), and a way for another
canister (with a botkey) to use a workflow as a remote procedure. Declared inputs are typed. The
trigger output is the inputs record.

### 4.6 Trigger output

Every trigger produces one value, `trigger`, which the steps can bind to: the schedule's fire
time; the condition's read output plus `{ previous; fired_by }`; the event; the inputs. A
`new_items` trigger runs once per new item (each run sees one item), up to `max_fanout` items a
poll (§9.4). The rest wait for the next poll, oldest first.

## 5. Actions and logic steps

### 5.1 Actions

| action | what it does | spends | budgeted by |
|---|---|---|---|
| `notify` | Sneed Notifications `notify` to the owner (as a scoped canister of the "Sneed Monitor" app, §12.6): a bot topic (which sets the level), title, body, link, dedupe; an unlinked bot with its own app may also notify allowlisted recipients | delivery price, paid by the recipient | message cap per day |
| `sms` | Sneed SMS message from the bot's principal to listed recipients | SMS's price, if any | message cap per day |
| `transfer` | `icrc1_transfer` from a bot subaccount (fee read with `icrc1_fee`, `created_at_time` and memo derived from the run, §8.5) | amount + fee | token budget |
| `approve` | `icrc2_approve` from a bot subaccount, always with `expected_allowance` and an expiry | the approval amount counts as "at risk" + fee | token budget |
| `transfer_from` | `icrc2_transfer_from` from an account that approved the bot, to an allowed destination | amount + fee of the payer's allowance | token budget (counted as the payer's) |
| `top_up_cycles` | ICP → CMC (`icrc1_transfer` to `{ CMC; owned(C, 0) }` memo `TPUP`, then `notify_top_up`, pending list retried) or cycles ledger `withdraw` | ICP or cycles | token budget |
| `deposit_cycles` | management `deposit_cycles` from the bot's own cycles | the bot's cycles | per-day cycles cap, never below the reserve (§9.5) |
| `vault_request` | sneed_vault `request_funds(grant, amount, dest)` (spec/programmable_accounts.md §7) | the vault grant | the vault's own limits, plus the token budget |
| `vote` | SNS `manage_neuron` `RegisterVote`, NNS `manage_neuron` `RegisterVote`, as hotkey | nothing | allowlist of neurons per workflow |
| `swap` | ICPSwap or Kong through the shared DEX module: quote, slippage, max price impact, ICRC-2 path preferred | input amount + fees | token budget; slippage and impact caps |
| `propose` | SNS `manage_neuron` `MakeProposal` as a hotkey with SubmitProposal (§12.3) | the rejection fee if rejected | proposals per period; off unless the controller enables it |
| `bot_command` | a typed call to another Sneed bot: start, stop, pause or trigger a chore; pause a token | nothing | allowlist |
| `call` | any update method with a connection (§7) and encoded arguments | attached cycles (default 0, capped) | allowlist; calls per day |
| `emit` | a `BotEvent` from this bot | nothing | |

### 5.2 Logic

| step | meaning |
|---|---|
| guard | `when <expr>` on any step: false means the step is skipped, and so are the steps that depend only on it |
| `branch` | named outcomes: `if <expr> then A else B` routes to edges |
| `for_each` | runs a sub-DAG for each item of a list (`select` + `limit`, at most `max_fanout`); outputs are a list |
| `set_var` | writes a workflow variable that persists across runs (`vars.last_price`) |
| `wait` | waits N seconds (a timer; the run stays open; at most `max_run_s`) |
| `sub_workflow` | runs another workflow of the same bot with inputs; depth at most 3; the call graph must be acyclic |
| `fail` / `stop` | ends the run as failed or done, with a message |

## 6. Dataflow

The north star: a step's parameters come from what earlier steps returned. The bot carries a small
**typed** value model and a **safe expression language**, not general code.

### 6.1 Values

A value is a decoded Candid value (the `Value` variant of §7.2: nat, int, the fixed-width ints,
float, bool, text, blob, principal, null, opt, vec, record, variant). Records and variants keep
their field **names**, which come from the stored type, not from the wire, where only hashes are
sent. In JSON (export, the MCP, the UI), `nat`/`int` are strings so they never lose precision;
principals are text; blobs are hex.

The scope of a run:

- `trigger`: the trigger output (§4.6);
- `steps.<id>.out`: the output of each completed step, and `steps.<id>.status` (`ok`, `failed`,
  `skipped`);
- `vars.<name>`: persistent workflow variables;
- `const.<name>`: constants of the workflow (`const.my_canister`);
- `bot`: `{ id; cycles; now }`.

### 6.2 Selectors

A path with a JSONPath-like syntax, and no filters or recursion:

```
steps.bal.out                       // the whole value
steps.status.out.cycles             // a record field
steps.props.out.proposals[0].id     // an index
steps.props.out.proposals[*].id     // all items (only where a list is expected: for_each, sum, len)
steps.res.out.Ok                    // a variant case: the payload if the tag is Ok, else the step fails or the guard is false
steps.res.out.?                     // unwrap an opt: null fails, unless wrapped in coalesce()
```

Selectors are type-checked when the workflow is saved, against the output type of the step they
point at (§6.5), and compiled to field hashes. A selector that can't match is refused at save time,
not at 3 a.m.

### 6.3 Bindings

Each parameter of a step has one binding:

- `const`: a typed literal;
- `select`: a selector;
- `template`: text with `{{ selector-or-expr }}` holes, for titles and bodies ("{{fmt_amount(steps.bal.out, 8)}} ICP left on {{const.name}}");
- `expr`: an expression.

### 6.4 SneedExpr, the expression language

Small, total and deterministic. It is always parsed in the frontend (and the MCP), and **stored
on-chain as an AST** (a Candid variant), so the canister never parses text. The canister
type-checks the AST when the workflow is saved and evaluates it with a step counter.

- **Literals:** integers (with `_` separators), decimals (exact, stored as a scaled integer),
  text, bool, `null`, principals (`principal "aaaaa-aa"`), accounts.
- **Operators:** `+ - * / %` (integer division, explicit `div_round`), comparisons, `and or not`,
  `if a then b else c`, `??` (coalesce).
- **Functions** (fixed list): `min max abs len sum count` (on lists), `contains starts_with
  ends_with lower`, `to_text to_nat to_int` (fails on a negative or invalid value), `scale(x, from,
  to)` (decimal places), `fmt_amount(x, decimals)`, `pct_change(a, b)` (basis points),
  `now()` (ns, the run's start time), `days(n) hours(n) minutes(n)`, `sqrt_price_to_price(sqrtX96,
  dec0, dec1)` (an exact rational, then a decimal).
- **No** user functions, loops, recursion, assignment (except `set_var` steps), randomness,
  floats in amounts (floats only from Candid `float` values, converted explicitly), or I/O.
- **Limits:** an AST of at most 256 nodes and depth 16; text values of at most 4 KB; at most
  10,000 evaluation steps per expression. Exceeding one fails the step.
- The frontend has the same evaluator in JS, and both run one shared test-vector file, so the
  builder's preview (§10.3) matches the canister.

### 6.5 Typing

Every step's output type is known at save time: built-in sources and actions have fixed types,
and generic calls take theirs from the connection. Bindings are checked against the parameter's
type. Allowed implicit conversions: nat → int; natN → nat; a literal into any int type that fits.
Narrowing (int → nat, nat → nat64) is explicit (`to_nat`) and checked at run time. A
mismatch refuses the save, with the step and parameter named.

### 6.6 The DAG

- Steps list their `after` edges. Data dependencies (selectors) add implicit edges. The graph must
  be acyclic, which is checked at save time.
- Independent steps run in parallel, up to `max_parallel` (§8.6).
- A failed step fails the run unless it has `on_error = continue` (its dependants see
  `status = failed` and may guard on it) or `on_error = goto <step>` (a failure branch, for
  example "notify me and stop").

## 7. Candid on-chain

### 7.1 The problem

Motoko's types are fixed at compile time. Built-in sources and actions (§4.3, §5.1) use typed
actor references and need nothing new. The generic `call` and generic query need three things:

1. calling a method that is known only at run time;
2. encoding its arguments, some of which come from bindings;
3. decoding its reply into a `Value`, so selectors can address it.

(1) is solved: `await (with timeout = n) IC.call(canister, method, argBlob)` with moc 0.14.13
(spec/sneed_proxy.md §1.4). (2) and (3) need a Candid codec driven by a type known only at run
time.

### 7.2 Options

| option | how | for | against |
|---|---|---|---|
| **A. Pre-encoded args, raw replies** | the frontend encodes the whole argument with `@dfinity/candid` and the bot stores the blob; replies are stored raw and decoded in the frontend for display | no codec on-chain; works for every type; v0.1-ready | no bindings; the bot can't read a reply, so it can't tell `Ok` from `Err` (only reply vs reject) |
| **B. Splice into fixed slots** | the frontend encodes a template and records the byte offsets of fixed-width slots (nat64, int64, natN, bool, float64); the bot overwrites those bytes | tiny, no library | Candid `nat`/`int` are LEB128 and change length, and ICRC amounts are `nat`, so the most useful slots don't fit; principals and text change length too. Too narrow to be worth it |
| **C. Encoder only, typed holes** | the frontend sends the argument as a type table plus a value tree with holes; the bot fills the holes from bindings and encodes | bindings into arguments; an encoder is small (~500 lines) and easy to test | replies are still opaque |
| **D. Full codec** | an encoder plus a decoder that checks the reply against the expected type (subtyping: extra fields skipped, missing `opt` fields → null, unknown variant cases → fail) | the complete north star: conditions on any query, `Ok`/`Err` routing, values passed between generic calls | the decoder is the risky part: untrusted bytes from any canister, recursion, the instruction limit |

Libraries checked on 2026-10-21 (versions in the local mops cache; re-check the latest on mops
before choosing):

| package | what | deps | ICRC-85 / OVS |
|---|---|---|---|
| `candid` 1.1.1 (edjcase/motoko_candid, MIT) | `Value`, `Type`, `Arg { value; type_ }`, `Encoder.encode([Arg])`, `Decoder.decode(blob) : ?[Arg]` (returns the types from the wire's type table), `Tag` (`#name` / `#hash`) | `base` 0.11.1, `xtended-numbers` | none found (grep for icrc85, ovs, cycle sharing) |
| `serde` 3.2.1 (NatLabs, MIT) | Candid, JSON, CBOR and URL-encoded; Candid encoding with type options; `ICRC3Value` conversions; text parsing | `candid` 1.1.1, `itertools`, `map`, `sha2`, `cbor`, `xtended-numbers`, and two GitHub deps (`json.mo` on a branch, `parser-combinators`) | none found |

Neither carries ICRC-85, so both are allowed by the "no OVS libraries" rule. `serde` is much
larger, and its GitHub-branch dependencies make builds harder to reproduce, which matters for
release hashes. `candid` is the smaller base. A decoder for untrusted input has to be audited
either way.

### 7.3 Recommendation: staged

1. **v0.1: option A.** `call` steps carry a pre-encoded `arg : blob`. Replies are stored truncated
   (§8.10) and decoded by the frontend. Success means "replied". A workflow can still notify on a
   reject.
2. **v0.2 (conditions):** conditions use the built-in typed sources (§4.3), so still no generic
   codec.
3. **v0.3 (dataflow): option D, as a stripped, vendored fork** of edjcase `candid`, in
   `src/sneed_bots/candid/` with its MIT licence and a note of the upstream commit. It is
   pinned, reviewed line by line, and given the repo's limits:
   - a reply size cap;
   - a type-table cap (256 entries);
   - a nesting-depth cap (32);
   - a vector-length cap;
   - an instruction-budget check (`Prim.performanceCounter`) that fails the step instead of
     trapping the round.
   It is tested against `@dfinity/candid` round-trips and the Candid spec's test suite (the
   `test/*.test.did` vectors of dfinity/candid), plus a fuzz run. Option C comes for free as the
   encoder half. **Q5:** vendor edjcase `candid`, or write our own `SneedCandid.mo` (as the repo
   did for ICRC-3)?
4. The decoder always decodes **against the connection's expected type**, never only by what the
   wire says. Field names then come from our type, and a target that changed its interface fails
   cleanly.

### 7.4 Connections (method signatures)

The bot cannot read another canister's Candid interface on-chain. The `candid:service` metadata
is only readable through `read_state`, which canisters can't call. So the **frontend** supplies
the signatures:

1. It reads `candid:service` (agent `CanisterStatus` with `candid`), or falls back to
   `__get_candid_interface_tmp_hack`, or takes a pasted `.did`.
2. It parses it (the didjs canister `did_to_js`, as Candid UI does, or a JS Candid parser) into
   our **type table**.
3. It stores the connection on the bot:

```candid
type TypeRef = nat32;                        // index into table, or a primitive code
type TypeDef = variant {
  opt : TypeRef; vec : TypeRef;
  record : vec record { name : text; id : nat32; t : TypeRef };
  variant : vec record { name : text; id : nat32; t : TypeRef };
  principal; blob; /* primitives by code */ ...
};
type Connection = record {
  id : nat;
  canister : principal;
  method : text;
  mode : variant { query; update };          // composite_query refused: not callable from an update
  table : vec TypeDef;
  args : vec TypeRef;
  rets : vec TypeRef;
  did_hash : blob;                           // sha256 of the .did text the frontend used
  module_hash : opt blob;                    // canister_info at save time
  label : text;
};
```

- **Upgrade watch:** at most hourly, the bot reads the target's `canister_info().module_hash`.
  If it changed, the workflows using that connection pause with a notice ("<canister> was
  upgraded; check the method before resuming"), unless the connection is set to
  `follow_upgrades` (**Q6**: which default?).
- A wrong signature can't do harm beyond the call itself: the bot encodes what the owner
  described and decodes against it, and a mismatch fails the step.
- Connections are shared by workflows on the bot. Deleting one that is in use is refused.

## 8. Execution

### 8.1 Timers only

- No heartbeat. Each workflow is an instance of the chore type `workflow` in `BotChoreEngine`,
  with the existing scheduler, conductor and task levels and a configurable task timeout.
- The engine gains one hook: a `nextRunAt` callback, so `cron` and `once` schedules can set the
  next fire time instead of a fixed interval. Condition triggers use the poll schedule as the
  chore's schedule.
- Event and invoke triggers queue a run, and the conductor picks it up within seconds, as the
  trading bot's deferred circuit-breaker starts do.
- Timer IDs are stale after an upgrade. The chore engine's resume logic re-arms them. Runs open
  at the upgrade continue from their last committed step (§8.2).

### 8.2 A run

```
Run = { id; workflow_id; version; trigger : Value; started_at; deadline;
        steps : vec StepState; status : running | done | failed | cancelled }
StepState = { id; status : pending | ready | in_flight | done | failed | skipped | unknown;
              attempts; started_at; ended_at; out : opt Value (truncated); error : opt text;
              spent : vec record { ledger; amount } }
```

- The conductor computes the ready steps: their dependencies are done and their guards true.
  It starts up to `max_parallel` of them as tasks.
- Each `await` is a commit point. A step's state is written before the call (`in_flight`) and
  after it.
- A trap or upgrade during a step leaves it `in_flight`. On resume:
  - a read is retried;
  - a ledger action is retried with the same `created_at_time` and memo (the ledger's dedup
    answers `Duplicate`, which counts as done);
  - any other action becomes `unknown`, which is never retried blindly (§8.4).
- Reads within one run are cached per `(canister, method, arg)`. Workflows of the same bot polled
  in the same tick share the cache, so ten workflows watching one balance make one call.

### 8.3 Calls

- Every outgoing call is **bounded-wait**: `(with timeout = step.timeout_s)`, default 60 s,
  at most 300 s.
- A user-owned canister must be able to stop for an upgrade. An unbounded call to a stuck or
  malicious callee would block that, so unbounded waits are not used at all.
- A timeout throws `#system_unknown` (`Error.isRetryPossible` separates it from a definite
  reject). The outcome is then **unknown**.

### 8.4 Retries and backoff

- `retry { max; base_s; factor }` per step: default 2 retries, 10 s base, factor 4. It always ends
  before the run's deadline (`max_run_s`, default 15 minutes).
- Retried: definite rejects marked transient (`SYS_TRANSIENT`, `CANISTER_ERROR` before
  execution), reads, and ledger actions (dedup by `created_at_time` within the ledger's window).
- **Not** retried: an `unknown` outcome of a generic `call`, a vote, a swap, or a proposal. The
  run takes the step's `on_error` path, and the owner is told. **Q7**: let the owner mark a
  generic method "idempotent" so it may be retried?

### 8.5 Idempotency

- Ledger actions: `created_at_time` = the run's start time, and memo = `sha224(bot, workflow,
  version, run, step, item)` truncated to 32 bytes. A retry is therefore a duplicate, never a
  second payment.
- Notifications: `dedupe = "smb:<workflow>:<run>:<step>"`. Condition alerts use
  `"smb:<workflow>:cond:<crossing-n>"`, so a crossing is announced once even across a retry.
- Votes: before voting, the bot reads the neuron's ballot when it is cheap (SNS proposal ballots).
  A neuron that already voted counts as done.
- CMC top-ups: the block index waits in a pending list until `notify_top_up` answers. That call
  is idempotent per block.

### 8.6 Concurrency

- Per workflow, `overlap`: `skip` (default: a trigger while a run is open is dropped and counted)
  or `queue` (at most 1 waiting).
- Per bot: at most `max_concurrent_runs` (5), at most `max_inflight_calls` (20), at most
  `max_parallel` steps per run (5).
- A per-target rate limit (calls per minute per canister, default 30) protects others' canisters
  from a bot gone wrong.

### 8.7 Failures

- A failed run is logged (bot log at `Error`, run history, ICRC-3) and, if the workflow says so,
  notified (topic `failures`).
- After `max_consecutive_failures` (default 5), the workflow **auto-pauses**, like a circuit
  breaker. Resuming is manual, or done by another workflow through `bot_command`.
- A `failures` notification is deduped per streak, so a broken workflow doesn't flood the owner.

### 8.8 Budgets

Gas isn't billed, but it is bounded. Each workflow carries:

| budget | default | counts |
|---|---|---|
| `max_steps_per_run` | 50 | steps started, including `for_each` iterations |
| `max_calls_per_run` | 50 | outgoing calls |
| `max_runs_per_day` | 288 (every 5 min) | runs started |
| `max_calls_per_day` | 2,000 | outgoing calls |
| `max_attached_cycles_per_day` | 0 | cycles attached to `call`s |
| `cycles_per_day` (estimate) | none | estimated at 0.26 B per call + 1,000 per byte (sneed_mon §4); shown, and a cap may be set |
| token limits | none: spending actions refuse to save until set | per ledger: amount per period (hour, day, week, 30 days), counted as amount + fee |

- Cycles per workflow are an **estimate**: runs interleave, so balance deltas can't be split
  exactly.
- The bot also reports the true total burn (`Cycles.balance` sampled each hour) and a 24-hour and
  30-day burn rate, so the UI can say "about 12 days of fuel left".
- The caps on calls and steps are what actually bounds cost.

### 8.9 Kill switch

- `pause_workflow(id)` and `resume_workflow(id)`.
- `pause_all()` stops all scheduling and refuses new steps. In-flight calls finish, because a
  bounded wait ends anyway.
- `pause_all` needs only the `KillSwitch` permission, which can be given to a second device or a
  trusted friend who can stop the bot but never edit it or move funds (§9.1).
- `resume_all` needs `RunWorkflows`.

### 8.10 Logs

- **Bot log** (`BotLogEngine`): human-readable. Each run is one `Info` line ("Keep X fuelled:
  topped up 0.5 ICP → 2.1T cycles"); failures are `Error`; budget refusals `Warning`. This feeds
  `useBotLogNotification` and the header bar as for the other bots.
- **Run history:** the last 1,000 runs, ring buffer. Step outputs are truncated to 2 KB each in
  the record; the full raw reply of the last run of each workflow is kept for the builder.
  Queries: `get_runs({ workflow; status; from; limit })`, `get_run(id)`.
- **ICRC-3 log:** effects only (what a third party may want to audit). It is our own
  implementation, as in the other Sneed logs: `Map { btype; ts; phash; tx }`, with the btypes
  named in the style of spec/sneedex_icrc3.md:
  - `smb_transfer`, `smb_approve`, `smb_transfer_from`, `smb_topup`, `smb_vault_request`,
    `smb_swap`, `smb_vote`, `smb_propose`, `smb_call` (canister, method, arg hash, reply/reject,
    attached cycles);
  - `smb_wf_set` (workflow saved: id, version, definition hash), `smb_wf_state` (paused, resumed,
    auto-paused), `smb_perm` (botkey changes), `smb_budget`.
- A user bot can't afford archive canisters by default. The log keeps the last 10,000 blocks
  in the canister, and `icrc3_get_archives` is empty. **Q8**: an archive that the owner opts
  into and pays for, or is the tip enough?

### 8.11 Dry run and simulate

- **In the browser (default, free):** the builder runs the workflow in JS. Reads are real query
  calls by the agent (anonymous, or as the user). Actions are shown, not sent: the decoded
  arguments, the budget they would use, and the token amounts with `useDenomination` values.
- **On the bot:** `simulate(workflow_def or id, inputs)` is an update call that costs the bot
  cycles and needs `Simulate`. It runs the real reads as the bot (which can differ: hotkey reads,
  the bot's balances) and returns the trace without sending any action. It is capped at one
  simulation per minute.
- **Dry-run mode** per workflow: `mode = live | dry_run`. In `dry_run`, scheduled runs execute
  reads and log what the actions would have done. This lets a new workflow be watched for a day
  before it is switched to live. New workflows from the pro editor start in `dry_run`; recipes
  start `live` once the user has confirmed them.

### 8.12 Versions

- Each save makes a new version (`version += 1`). The definition is stored whole, with its
  sha256. The last 20 versions are kept, and the ICRC-3 log has the hash of each.
- A run records its version. An edit doesn't touch a run in progress.
- `revert_workflow(id, version)` saves a copy of an old version as the newest.
- The definition schema has its own `schema_version`. An upgrade migrates stored definitions
  from the previous schema only (bot upgrade path rule).

### 8.13 Import and export

- JSON, `{"$schema": "sneed-mon-bot/workflow@1", workflow, connections, recipe?}`: the
  definition, the connections it uses (type tables included), budgets and allowlists, with
  principals as text and numbers as strings.
- Import validates exactly as a save does. The UI shows what it would do in plain words ("sends
  up to 10 ICP a day to …") and the budget and allowlist **diff**, and needs confirmation.
- An imported workflow always starts `dry_run`.
- Export never includes secrets, because there are none: the bot has no API keys and no HTTPS
  outcalls (§14).
- Text form: a readable script syntax for review and LLM use, in the spirit of the trading bot's
  SneedScript DSL (`src/app_sneeddao_frontend/src/dsl`), with an LLM guide. It is parsed in the
  frontend into the same JSON. The JSON is canonical.

### 8.14 Recipes (templates)

| recipe | trigger | steps | needs |
|---|---|---|---|
| Keep canister X above 2T cycles from subaccount Y | condition: cycles of X `level` < 2T (poll 1 h) | `top_up_cycles` (ICP from bot subaccount Y, amount = expr from target and ICP/XDR rate) → `notify` | cycles read path for X; ICP budget |
| Keep canister X above 2T cycles from a vault grant | same | `vault_request` (dest `canister_cycles(X)`) → `notify` | a vault grant to the bot |
| Vote with my neurons like neuron Z | condition: SNS proposals `new_items`, then for each the ballot of Z (poll 30 min until the deadline) | `for_each` my neurons: `vote` the same way as Z; skip if Z hasn't voted 2 h before the deadline → `notify` | the bot is a hotkey (vote) on my neurons |
| Remind me to vote | condition: SNS unvoted, closes within 24 h | `notify` (urgent) | none (the shared engine serves it, §1.1) |
| DCA: swap 1 ICP to SNEED every day | `cron` daily | `swap` 1 ICP → SNEED, slippage 1%, max impact 3% → `notify` | ICP in the bot; ICP budget 1.1/day |
| Alert me when the SNEED/ICP price moves 10% | condition: pool price `changes { min_delta = 10% }` | `notify` with old and new price, `set_var last_alert_price` | none |
| Low balance alert | condition: ICRC-1 balance of any account `crosses down` | `notify` | none |
| Canister upgraded | condition: `canister_info` module hash `changes` | `notify` with old and new hash | none |
| Sneedex: tell me about new offers for collection C | condition: Sneedex ICRC-3 `new_items`, btype = offer created, field asset = C | `notify` with a link | none |
| Forum: mentions to Discord | condition: mentions of me `new_items` | `notify` (my Discord channel) | none |
| Sweep my bot's earnings | `cron` weekly | `transfer` of balance − reserve to my wallet | token budget |
| Pause my trading bot if SNEED crashes | condition: price `crosses down` | `bot_command` pause chores → `notify` | a botkey on the trading bot |
| Call method M every 10 minutes | `every 600` | `call` (pre-encoded) | a connection; allowlist |

Recipes are versioned JSON shipped with the frontend (and readable by the MCP). A recipe declares
its parameters with input kinds: `PrincipalInput` for principals and canisters, `TokenSelector`
for tokens, amounts, durations, accounts. **Q9**: can the community publish recipes, for example
as forum posts or a recipes canister?

## 9. Security

### 9.1 Permissions

Controllers have every permission. Botkeys use the shared engine, with base IDs 0–6 (Full,
ManagePermissions, ViewChores, ViewLogs, ManageLogs, ManageEvents, ViewEvents) plus:

| ID | permission | allows |
|---|---|---|
| 300 | ViewWorkflows | read definitions, connections, budgets |
| 301 | ViewRuns | run history, outputs, ICRC-3 is public anyway |
| 302 | EditWorkflows | create and edit workflows **within** the existing budgets and allowlists; new or changed workflows start `dry_run` |
| 303 | GoLive | switch a workflow from `dry_run` to `live` |
| 304 | RunWorkflows | run now, pause, resume, resume all, `run_workflow` with inputs |
| 305 | ManageBudgets | set or raise budgets and token limits |
| 306 | ManageAllowlists | add callable `(canister, method)`, recipients, neurons, destinations |
| 307 | ManageConnections | add or replace signatures |
| 308 | Simulate | `simulate` on the bot |
| 309 | KillSwitch | `pause_all` and `pause_workflow` only |
| 310 | WithdrawFunds | send the bot's tokens out (outside workflows) |

The separation matters:

- An editor can't raise what a workflow may spend or call. Spending more needs ManageBudgets.
- A compromised editor key can at worst rearrange work inside limits the owner already set.
- `KillSwitch` alone is the "second device" stop (as sneed_vault **Q6** asks for the vault).

### 9.2 Allowlists

The bot has a global allowlist. Each workflow has its own, and an action needs both. Entries:

- `(canister, method)` for `call` and generic reads;
- ledgers and destination accounts for transfers;
- neurons for `vote`;
- recipients for `notify` and `sms` (default: the owner only);
- bots for `bot_command`;
- DEX pools for `swap`.

Refused or restricted whatever the allowlist says:

- **The bot itself** (`call` to its own methods): no self-editing, no loops. Sub-workflows are the
  only way to compose.
- **The management canister** through `call`. The typed actions (`deposit_cycles`,
  `canister_status` of a controlled canister) are the only way in.
- **Ledger spending methods through the generic `call`** (`icrc1_transfer`, `icrc2_approve`,
  `icrc2_transfer_from`, `transfer`, `send_dfx`, `approve`), **governance `manage_neuron`**, and
  the CMC `notify_*`. These must use the typed actions, so the token budgets and logs apply. A
  controller may override this for one connection, with a red warning ("budgets will not see this
  call").
- The bot can't recognise every ledger, so the list is a seatbelt, not a wall. The real cap on
  funds is what the bot holds and what was approved to it (§9.6).
- Attached cycles on `call`: 0 unless the workflow sets a cap, and always within the per-day cap.

### 9.3 Spending limits

- Per ledger, per period, per workflow, and per bot. Both must pass.
- A limit counts **amount + fee**, and an `approve` counts its allowance.
- A spending step **reserves** before the call. A definite failure releases the reservation. A
  success or an `unknown` outcome keeps it, so an unknown outcome counts as spent.
- Rolling windows, as sneed_vault §6.1.
- `swap` also has a slippage cap and a max price impact. The quote is fetched right before the
  swap (the trading bot's rule).
- A workflow that can spend can't be saved without limits for every ledger it touches.

### 9.4 Loops, fan-out, reentrancy

- `max_steps_per_run`, `max_calls_per_run` (§8.8); `max_fanout` 50 per `for_each` and per
  `new_items` poll; sub-workflow depth 3 with an acyclic call graph; `wait` within `max_run_s`.
- Event loops:
  - a workflow can't trigger on events this bot emits for that same workflow;
  - event and invoke triggers have `max_runs_per_hour` (default 12) and the cooldown;
  - two bots triggering each other are bounded by those caps and by `overlap = skip`.
- Reentrancy:
  - every await is a commit point. A run's state is written before and after each call, under a
    per-run lock;
  - `set_var` writes are applied at the step, and workflows with `overlap = skip` never race on
    their own variables;
  - shared bot state (budgets, reservations) changes only synchronously around awaits, so no
    reservation can be counted twice (the CallerGuard and saga pattern).

### 9.5 Cycles drain

- **Reserve:** `min_reserve_cycles` (default 1 T). Below it, all workflows pause except those
  tagged `keeps_bot_alive` (the bot's own top-up recipe). The bot emits `LowCycles` and notifies
  the owner once per episode.
- **Freezing threshold:** the mint sets 30 days (Sneedapp `freezing_threshold`; **Q10**: does
  Sneedapp set it today?). The UI shows it and warns if it is lowered.
- **Ingress guard** (`system func inspect`, `src/IngressGuard.mo`):
  - queries arriving as updates are refused;
  - the anonymous principal is refused;
  - callers who are neither controllers nor botkeys are refused on every update except the
    `BotEventEngine` delivery endpoint, where the source bot is checked in the method;
  - every method is in the `msg` variant;
  - argument caps: 4 KB by default; `save_workflow` and `import` 256 KB; `save_connection`
    128 KB.
- Inter-canister callers skip `inspect`, so the same checks run in the methods.
- **Public queries:** status, version, `get_cycles`, and the ICRC-3 log. Run data and definitions
  need ViewRuns or ViewWorkflows.
- **Expensive outgoing work** happens only on timers the owner configured. No method lets an
  outsider make the bot call out.

### 9.6 Others' funds

- The bot moves only:
  - its own accounts;
  - allowances explicitly given to it, from accounts the workflow lists, to destinations the
    workflow lists;
  - vault grants made to it.
- It never sweeps tokens sent to it into a "found money" flow: incoming tokens belong to the
  owner, as for every bot. It never pulls from an allowance that a workflow doesn't name.
- `transfer_from` recipes say in the UI: "this pulls from <account>, which approved this bot for
  <amount> until <expiry>."

### 9.7 Privacy

- Everything on-chain is public in substance. Node providers can read canister state; the ICRC-3
  log, calls, votes and transfers are public; notification content passes through Sneed
  Notifications.
- Run history and definitions are permission-gated **for convenience, not secrecy**. The UI
  says so.
- No option is labelled private or anonymous. The bot's principal is shown wherever it acts.

### 9.8 Upgrades and sale

- The owner upgrades from the wallet through every published version. Runs open at the upgrade
  resume (§8.1). Timers are re-armed by the chore engine.
- Selling the bot on Sneedex: escrow snapshot/restore of botkeys, as the trading bot does. While
  escrowed, all workflows are paused, because the seller's workflows must not spend the buyer's
  bot. **Q11**: what else does Sneedex's bot verification need to show (workflows, connections,
  allowances given to the bot)?

## 10. Costs (for the UI's fuel gauge)

Assumptions as in sneed_mon §4 (13-node subnet, about 0.26 B cycles per inter-canister call plus
about 1,000 cycles per byte; 1 T ≈ $1.35):

| workflow | calls a day | cycles a day | $ a month |
|---|---|---|---|
| balance alert, polled hourly | 24 | ≈ 6.5 B | ≈ $0.26 |
| canister kept above 2T, hourly, through a blackhole | 24 + rare top-ups | ≈ 7 B | ≈ $0.28 |
| copy-voting on one SNS, every 30 min, 5 proposals a day | 48 + 5 ballot reads + votes | ≈ 20 B | ≈ $0.80 |
| a generic call every 10 min | 144 | ≈ 40 B | ≈ $1.60 |
| DCA daily | quote + swap ≈ 6 | ≈ 2 B | ≈ $0.08 |

Plus idle cost (memory and timers: small), and the decoder's instructions for generic reads
(measured in v0.3). The bot page shows the real burn rate (§8.8).

## 11. Frontend

### 11.1 Place

- **Sneed Monitor's page is the main GUI** (§1). Its monitor list, editor, recipe gallery and
  balance cover both engines. The bot-only features below (builder, runs, connections) appear
  inside it for monitors that run on the bot, and link to the bot's own page for the full view.
- The bot's own page is `/sneed_mon_bot?canisterId=…`, like `TradingBot.jsx`.
- It has the shared `BotManagementPanel` tabs (Info, Botkeys, Chores, Log) plus:
  - **Workflows**;
  - **Runs**;
  - **Budgets & allowlists**;
  - **Connections**;
  - **Fuel**: cycles, burn rate, days left, and "keep fuelled" (§1.5);
  - **Script**: JSON and text, import and export, the LLM guide.
- The wallet lists the bot with the other bots. `useOutdatedBotsNotification`,
  `useBotChoreNotification` and `useBotLogNotification` include it. `UpgradeBotsDialog` upgrades it
  along the path.
- The help page is `HelpMonBot.jsx`, and API docs go in `public/api-docs/sneed_mon_bot.md`
  (`get_api_doc` on the bot).

### 11.2 Casual (on top)

- A recipe gallery of cards ("Keep a canister fuelled", "Copy a neuron's votes", "Daily DCA",
  "Price alert", …).
- A card opens a short form with `PrincipalInput` and `TokenSelector`. Amounts show their value
  through `useDenomination().formatValue` (never a hard-coded `$`).
- The form shows a plain-words summary and the budget it sets ("may send up to 1.1 ICP a day").
  One button: "Create and start".
- When the bot isn't yet a hotkey or doesn't hold the needed funds, the recipe says what is
  missing and offers the step ("Add this bot as a hotkey on your neurons", "Send 5 ICP to the
  bot").
- Workflows show as cards: status lamp, last run, next run, pause switch, "Run now".

### 11.3 Pro (Advanced)

- A node-and-edge editor. Palette: triggers, reads, actions, logic.
- Each parameter has a **binding panel**:
  - constant;
  - "from a step": a tree browser over the step's last real or simulated output, where clicking a
    field writes the selector;
  - template;
  - expression, with live type-checking and a preview value.
- Live preview: browser simulation (§8.11) on every change, debounced. Errors are pinned to the
  node and parameter.
- Connections: "Add a method" takes a canister ID (`PrincipalInput`), lists its methods from
  `candid:service`, and shows the argument form generated from the types (as Candid UI does). It
  stores the connection. For v0.1, the form encodes the argument to a blob.
- Version history with diff and revert. Dry-run and live switch.
- New dependency: a graph editor library (`@xyflow/react`), lazy-loaded on the Advanced tab only.
  **Q12**: or keep a list-based editor and draw the graph only as a view?
- Select elements use explicit dark-mode colours (repo rule).

### 11.4 Mobile

- Recipes, workflow cards, pause and run-now, run history and the fuel gauge all fit a phone.
- The graph editor on mobile becomes a vertical step list with indented branches. Binding panels
  open as sheets. Editing works, though not as comfortably as on desktop.

## 12. Relations

### 12.1 Sneed Monitor (shared `sneed_mon`)

- **One service, two engines:** see §1 (the routing rule, the mint at the first advanced
  monitor, custody, gas, migration).
- **The bot's fuel:** linked bots get the gas monitor on mint (§1.5). A bot minted directly
  on `/sneedapp` gets the same from its Fuel tab ("Keep this bot fuelled", which links it to Sneed
  Monitor), or uses its own `keeps_bot_alive` recipe without Sneed Monitor. Both can exist; the
  vault's conditions stop double refills.
- **Shared catalogue:** Sneed Monitor's watch kinds and the bot's built-in sources use the same
  read code where possible (a shared Motoko module for SNS and NNS proposals and ballots) and the
  same notification topics' wording.
- **Graduation:** shared watches move to the bot and back as in §1.6. **Q13**: offer "move to
  my bot" proactively, or only when the user edits a watch into something advanced?

### 12.2 sneed_vault (spec/programmable_accounts.md)

- Recommended custody for bot money: the owner keeps funds in vault subaccounts and gives the bot
  **grants** (limits, destinations, conditions). The bot asks with `vault_request`.
- A bug in a workflow or a stolen botkey can then take at most what the grant allows, and the
  vault's own conditions ("only when the target is low") hold even if the bot lies.
- The bot can also be a node of a funding tree: a vault grant keeps the bot fuelled, and the bot
  keeps other canisters fuelled.

### 12.3 sneed_proxy (spec/sneed_proxy.md)

- The bot can **prepare** proposals: a `propose` action as a hotkey with SubmitProposal on a
  neuron, with an `ExecuteGenericNervousSystemFunction` payload for the proxy's GNSFs (a
  `ProxyCall` encoded by the frontend from the governance registry), or a motion.
- It can never **execute** them. The proxy's execute methods accept governance only, and that is
  checked at ingress too.
- `propose` is off by default; only a controller can enable it, per workflow. Limits: at most
  N proposals per period (default 1 a week). The SNS rejection fee counts against the token
  budget. A `notify` to the owner with the proposal link follows every proposal.
- **Q14**: allow it at all in v1? A bot that floods a DAO with proposals harms the DAO, even
  when it pays the rejection fees.

### 12.4 The MCP server (`mcp/sneed-hub`)

Tools, with writes off by default, previewed, and run only after one-time confirmation, as for
every MCP write:

- reads: `monbot_list` (the user's bots from the wallet), `monbot_workflows`, `monbot_runs`,
  `monbot_status`, `monbot_recipes`;
- writes: `monbot_create_from_recipe`, `monbot_save_workflow` (JSON, validated locally first with
  the same evaluator and type checker), `monbot_simulate` (the free browser-style simulation
  runs locally in the MCP), `monbot_set_mode` (`dry_run` / `live`), `monbot_run`,
  `monbot_pause` / `monbot_pause_all`.
- "Act as me" delegations need the bot's canister in scope. The connect page offers "my Sneed Mon
  bots" as a scope.
- An agent can also hold a **botkey** on the bot with only EditWorkflows and Simulate, so it can
  draft workflows that the owner takes live (GoLive).
- The text script form and the LLM guide (§8.13) are what the MCP hands an agent.

### 12.5 Other bots

- Event triggers from staking and trading bots (§4.4).
- `bot_command` to control them, using botkeys that they grant to the mon bot.
- Their status lamps as a source.
- The mon bot is the "glue" bot: it doesn't trade or stake itself, except DCA through the shared
  DEX module.

### 12.6 Sneed Notifications

How Sneed Notifications works today (`src/sneed_notifications/main.mo`, read 2026-10-21):

- **Apps and canisters.** Only a canister listed in a registered app may call `notify`,
  `notify_batch` or `request_permission` (`app_of_canister`, `appOfCaller`).
  - `register_app` needs the caller to control each listed canister, or to be the canister.
  - `update_app` is allowed to the app's owner or an admin. A new canister must again be
    controlled by the caller (admins exempt).
  - An app has **1 to 20 canisters** (`MAX_CANISTERS = 20`) and 1 to 50 topics.
  - A canister belongs to at most one app.
- **Consent is per (user, app):**
  - `Permission { allowed; demote; copy_only; muted_until; daily_cap (messages, default 20);
    daily_spend_cap_e8s (default 100,000); topics }`;
  - without `allowed`, `notify` returns `#not_allowed`. Past the cap: `#rate_limited`;
  - `request_permission` puts at most 50 open requests in a user's centre.
- **Topics** belong to the app. An unknown topic is `#unknown_topic`. The level comes from the
  topic, and the user may demote it.
- **Payment.** By default the user pays per delivery, per channel, within their spending cap.
  With `sponsored = true` the app's balance pays (all or nothing, `#no_funds`).
- **Always copy:** every message also goes to the user's always-copy channel (Sneed SMS by
  default), with the app's name.
- **Dedupe** is per user, app and key, within a window (1 h by default).

The options for bots:

| | (a) one app "Sneed Monitor", bots added to its canister list | (b) each bot registers its own app | (c) bots relay through the shared `sneed_mon` |
|---|---|---|---|
| who adds the bot | sneed_mon as the app's owner, via `update_app`, at `link_bot`; or Sneedapp at mint (it is a controller until hand-over, but not the app's owner) | the bot itself (`register_app` with itself as the canister needs no controller check) | nobody; sneed_mon's `relay_notify` checks the link |
| limits | **20 canisters per app**: fails at the 21st bot | none (one app per bot) | none |
| consent | the user's existing permission for "Sneed Monitor" covers their bot: transparent | the owner must allow each bot's app (one tap, but visible) | transparent: messages are sneed_mon's |
| spam | **any** listed bot could notify **anyone** who allowed Sneed Monitor; a hostile bot owner could message every Monitor user (within their caps) | like any app: a bot can only reach users who allowed it, but it can file `request_permission` with strangers (up to their 50 open requests) | sneed_mon sends only to the bot's linked owner: no spam |
| who pays | user-paid: the recipient pays per delivery; `sponsored` would spend Sneed Monitor's app balance, so it must be refused for bots | user-paid, or the bot's own app balance (`sponsored`) | user-paid; sneed_mon pays the relay call's cycles (a few hundred thousand cycles a message; can be charged to the Monitor balance) |
| topics | the app's topics, shared by all bots | the bot chooses its own (up to 50) | sneed_mon's topics |
| the user's caps | one daily cap shared with the shared engine's alerts: a chatty bot can starve proposal reminders | separate per bot | shared, as (a) |
| change to Sneed Notifications | yes: scoped, unbounded canister lists (below) | none | none |
| extra hop | no | no | yes: bot → sneed_mon → notifications (latency, a second failure point) |

**Recommendation: (a) with an additive change, "scoped canisters"; (c) as the interim; (b) for
bots outside Sneed Monitor.**

The additive change to Sneed Notifications:

- An app may have **scoped canisters** besides its ordinary ones, in a separate map
  `scoped_of_canister : principal → { app; recipients : [principal] }`. The limit is large (for
  example 100,000 per app), because they are only senders.
- A scoped canister may call `notify` and `notify_batch` **only for its listed recipients** (its
  owner; at most 5, for co-owners). Anything else returns `#not_allowed`.
  - It may **not** use `sponsored = true` (no spending the app's balance).
  - It may **not** call `request_permission`.
  - The user's existing permission for the app applies.
- `add_scoped_canister(app, canister, recipients)` and `remove_scoped_canister(app, canister)`,
  by the app's owner (or admins). Sneed Notifications doesn't check control here, because
  recipients can only be people who allowed the app anyway. The app owner (sneed_mon) has verified
  ownership before adding (§1.4 step 3).
- **Separate counting:** the per-user daily cap and dedupe for a scoped canister are keyed by
  `(user, app, canister)` against the same `daily_cap` value, so a chatty bot can't starve the
  shared engine's alerts. Spending is still capped once per app.
- **Sender label:** the stored message records the sending canister. The centre and the
  always-copy entry say "Sneed Monitor · via <bot name or canister id>", so the user can trace and
  mute a bot. The bot name comes from the naming service (spec/sneed_names.md) if set.
- **Per-bot mute:** a user may mute one scoped canister without muting the app
  (`set_scoped_mute(app, canister, until)`).

Topics: the "Sneed Monitor" app gains bot topics:

- `bot_alerts` (normal);
- `bot_urgent` (urgent);
- `bot_info` (info);
- `bot_failures` (normal: a workflow failed or auto-paused);
- `bot_fuel` (normal: low cycles, paused for lack of gas).

A workflow's `notify` step picks one of these, which sets its level (§5.1). The title and body
are free (with the service's length limits). Custom topics are not offered under (a), so that the
user's per-topic rules stay understandable; **Q22**.

Payment and copy:

- Bot messages are **user-paid**. The recipient is the owner, who pays per delivery as for any
  app, within their spending cap for Sneed Monitor. There is no new pricing.
- The Sneed SMS copy works unchanged (Sneed SMS deliveries cost 0), with the "via <bot>" label.

Until the change ships:

- **(c), relay:** `sneed_mon.relay_notify(input)` accepts calls from linked bots only, and only
  for that bot's owner. It forwards with sneed_mon's own app identity, dedupe prefix
  `bot:<canister>:`, and the bot topics above. The cycles of the hop are charged to the owner's
  Monitor balance as a small per-message charge. **Q23**: is it worth building as an interim, or
  should v0.1 wait for scoped canisters?

Bots that aren't linked to Sneed Monitor (minted directly and never adopted) use **(b)**:

- The bot's page offers "Register for notifications". The bot calls `register_app` for itself
  (name "<bot name> (Sneed Mon Bot)", its own topics) and `request_permission(owner)`. The owner
  approves.
- The bot refuses `request_permission` for anyone but its owner and principals the owner put on
  its recipient allowlist (§9.2). Without a change to Sneed Notifications, the bot polices itself
  here; a bot can't prove to the service who its owner is.
- When such a bot is later adopted (§1.4 step 0), it switches to the Sneed Monitor scoped
  canister, and its own app is left registered but idle (**Q24**: deregister it?).

## 13. Pricing and revenue

- **Mint** through Sneedapp, either directly or from Sneed Monitor at the first advanced monitor
  (§1.2). There, it is paid from the Sneed Monitor balance by default (§1.4): app `sneed-mon-bot`, publisher 0 (Sneed DAO). The DAO cut is 100%
  (publisher 0's default) and goes to the RLL ICP splitter (the Sneedapp payment flow, §14 of
  spec/sneedapp.md).
- Mint price: **Q15**. Suggestion: the same as the trading bot, with a premium price for Sneed
  Premium members.
- Special prices (spec/special_prices.md): admin and partner prices through Sneedapp's existing
  mechanism.
- The mint includes the creation cycles (Sneedapp's `canisterCreationCycles`), which come out of
  the payment.
- **No per-execution fee.** Gas is the bot's own cycles. Sneed services the bot uses charge as
  usual: notification deliveries, vault request fees.
- **Gas from the Monitor balance** (§1.5) is passed through at cost: the ICP the CMC turned into
  cycles plus ledger fees. **Q25**: add a small margin (revenue to the RLL), or keep it at cost
  so the bot stays "no per-execution fee"?
- `/revenue` shows the mints in Sneedapp's per-app stats.

## 14. Not in scope (v1)

- HTTPS outcalls (webhooks, web prices). They need secrets that would be public on-chain, and
  cost a lot. **Q16**: a later "fetch URL" read with a public URL and a fixed response cap?
- EVM and Bitcoin actions (chain-key signing). Later, if wanted.
- General code (Wasm plug-ins, scripts with loops). The expression language stays small on
  purpose.
- A shared marketplace of paid workflows.

## 15. Rollout

Each phase is a published version (bots upgrade through every one). Each phase gets PocketIC tests
(`test/canisters/tests/sneed-mon-bot*.test.js`) with mocks for the ledgers, governance, CMC and
DEXes, as the trading bot's tests have. Each phase is tried on staging (a minted bot) before it is
published.

| version | contents |
|---|---|
| **0.1** | **Sneed Monitor integration** (§1): `link_bot`, the setup checklist, `pay_bot_mint`, the gas monitor with refills from the Monitor balance, the routing rule in the Monitor GUI, sole and operator custody; notifications through the relay (c) or scoped canisters, if Sneed Notifications has them by then (§12.6); Sneedapp app; shared bot modules; workflows with `every` / `cron` / `once` / invoke triggers; actions `notify`, `transfer`, `top_up_cycles`, `deposit_cycles`, `call` with **pre-encoded args** (option A); linear steps (no dataflow); budgets, allowlists, kill switch, reserve, runs, bot log, ICRC-3 log; recipes "call M every N minutes", "sweep earnings", "keep my bot alive"; frontend recipe gallery, workflow cards, run history, connections with a Candid-UI-style arg form |
| **0.2** | condition triggers over the built-in typed sources (§4.3) and the four fire modes; event triggers (`BotEventEngine`); `vote`, `swap` (shared DEX module), `vault_request`, `bot_command`, `approve`, `transfer_from`; guards with SneedExpr over typed outputs; recipes: cycles keeper, price alert, DCA, copy-voting, Sneedex/forum ICRC-3 alerts; `dry_run` mode and browser simulation |
| **0.3** | **dataflow**: the vendored Candid codec (§7.3), generic query reads, bindings from any step into generic calls, the DAG with parallel steps, `for_each`, `branch`, `set_var`, `sub_workflow`, `on_error` paths; `simulate` on the bot; upgrade watch on connections |
| **0.4** | the visual builder (Advanced): node editor, binding panel with output browser, live preview, version diff; script text form and LLM guide; MCP tools |
| **0.2–0.3 (services)** | Sneed Notifications scoped canisters (additive release); `move_watch_to_bot`; `sneed_bot_custodian` and shared custody, if **Q21** says yes |
| later | `propose` (if **Q14** says yes), recipe sharing, opt-in ICRC-3 archive, HTTPS reads |

## 16. Open questions

1. **Q1** Minimum schedule interval: 60 s for everyone, or lower for pros (the bot pays anyway)?
2. **Q2** Cron and time zones: UTC with a fixed offset (no daylight saving), or a small on-chain
   table of DST rules for a few zones (Europe/Malta among them)?
3. **Q3** `new_items`: on the first poll, count the existing items as seen (current proposal), or
   offer "include what is there now"?
4. **Q4** NNS: may a hotkey read `get_full_neuron` on mainnet (maturity, followees)? Check on
   staging and mainnet before the neuron recipes rely on it.
5. **Q5** Candid codec: vendor and strip edjcase `candid` (MIT, small deps), or write our own
   `SneedCandid.mo`? `serde` is ruled out as too large, with GitHub-branch deps.
6. **Q6** When a connected canister's module hash changes: pause the workflows using it (safe
   default), or follow upgrades silently?
7. **Q7** Let the owner mark a generic update method as idempotent, so an unknown outcome is
   retried?
8. **Q8** ICRC-3 on a user bot: the tip only (10,000 blocks), or an archive the owner opts into
   and pays for?
9. **Q9** Community recipes: shared how (forum posts with JSON, a recipes canister, a Sneedapp
   publisher)?
10. **Q10** Does Sneedapp set a freezing threshold at mint? If not, should it, for all bots?
11. **Q11** Sneedex sale of a mon bot: what must verification show, and does escrow pause the
    workflows automatically?
12. **Q12** Graph editor: add `@xyflow/react` (lazy), or a list editor with a read-only graph
    view?
13. **Q13** Offer "graduate" from a Sneed Monitor watch to a bot recipe?
14. **Q14** `propose` action: allow it (with strict caps), or leave it out of v1?
15. **Q15** Mint price (and premium price) of the bot.
16. **Q16** HTTPS reads later, or never?
17. **Q17** Name: `sneed_mon_bot` and "Sneed Mon Bot", or a product name such as "Sneed
    Autopilot" with `sneed_mon_bot` as the canister name?
18. **Q18** Notifications to others than the owner: only principals who allowed the bot's app
    (the current consent model), or also Sneed SMS to anyone (SMS has its own spam rules)?
19. **Q19** Several bots per user: allowed, with one primary for new advanced monitors? Or exactly
    one bot per user in Sneed Monitor?
20. **Q20** The operator principal: the shared `sneed_mon` itself, or a dedicated `sneed_ops`
    canister? Who may trigger a "pause bots of version X" (DAO proposal only, or admins with a
    log)?
21. **Q21** Build `sneed_bot_custodian` for shared custody (auto-upgrades along the published
    path), or launch with sole custody and operator only?
22. **Q22** Bot topics under the shared app: the fixed five, or let a bot add custom topics (they
    would show for every Monitor user, so probably not)?
23. **Q23** Interim notifications through the sneed_mon relay (c), or wait for scoped canisters
    in Sneed Notifications?
24. **Q24** When a bot with its own app is adopted by Sneed Monitor, deregister its own app?
25. **Q25** Gas from the Monitor balance at cost, or with a margin?
