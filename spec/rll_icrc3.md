# RLL activity log (ICRC-3)

Design for a hash-chained, certified activity log in the RLL rewards canister (`rll`,
`src/sneed_rewards`), exposed through the ICRC-3 block log interface, with archive
canisters. Written 2026-10-21. The log uses the shared library `src/icrc3` exactly as
`sneed_lock` and `sneedex` do (recipe: `src/icrc3/README.md`; designs:
[sneed_lock_icrc3.md](sneed_lock_icrc3.md), [sneedex_icrc3.md](sneedex_icrc3.md)). This
document records what is specific to RLL: the block catalogue, the volume decision, where
each block is appended, and the release.

**Status (2026-10-21): implemented, not deployed.** Tests: `test/canisters/tests/rll-icrc3.test.js`.

## Goals and rules

- Every state change that moves or reassigns value produces a block: each daily
  distribution of a token (a summary plus one credit per owner), each claim that paid out,
  each claim whose outcome is unknown (an incident) and its resolution, and the per-token
  balance reconciliation every cycle performs. Every admin action that changes who gets
  what (admins, known tokens, the whitelist, per-token minimums and maximums, the main
  loop, distribution cycles, imports, and the reset tools) is logged too.
- A block is appended only once the change is final, in the message that commits it:
  a claim's block after the ledger answered `Ok`; a distribution's blocks after every
  owner was credited (one message, no await in between). A claim that changes nothing
  (under the fee, a ledger `Err`, a call that provably never executed: the balances are
  restored) appends nothing. Failures stay in the existing `ClaimEvent` list.
- Privacy: everything logged is already public (`balance_of`, `get_all_user_balances`,
  `get_claim_events`, `get_user_distribution_events`, `list_admins`, ...). Principals and
  amounts are logged as they are; nothing on the IC is anonymous.
- The log starts empty with this release. Existing balances, distributions and claims are
  not imported; their history stays in the existing event queries.

## Block format

As in Sneed Lock and Sneedex: `Map { btype; ts; phash; tx }`. Inside `tx`:

- principals as `Blob`; accounts as `Array [owner, subaccount?]`
- amounts in the token's base units, ids, voting power, timestamps (ns) as `Nat`
- `token`: the ICRC-1 ledger principal
- `caller`: the principal that made the call; blocks written by the canister's own timers
  (the distribution cycle, the balance check it runs) carry `via` = `"cycle"` instead
- flags as `Nat` 0 / 1; optional fields omitted when absent
- no `cid`: RLL has no text log to correlate with

## Block type catalogue

Prefix `rll_`; `icrc3_supported_block_types` reports every type with the url
`https://app.sneeddao.com/api/rll#block-types`.

| btype | when | tx fields |
|---|---|---|
| `rll_reconciliation` | the cycle's distribution stage read a known token's ledger balance (one per known token per cycle, before any distribution of it) | `token`, `ledger_balance` (main account), `claimable` (sum of all owner balances), `reserved` (claims awaiting the ledger + unresolved incidents), `undistributed` (ledger − claimable − reserved, or 0), `underflow` (claimable + reserved − ledger, or 0), `to_distribute` (what the cycle shares now: 0 under the token's minimum, capped at its maximum); `via` |
| `rll_distribution` | a token was shared out | `token`, `amount` (total credited), `requested` (what the cycle set out to share; the difference is rounding dust that stays undistributed), `owners` (owners credited a non-zero amount), `neurons` (neurons whose cast votes counted), `voting_power` (their total: the basis of every share), `first_proposal`, `last_proposal`; `via` |
| `rll_credit` | one owner's balance grew in that distribution (non-zero only) | `owner`, `token`, `amount`, `voting_power` (the owner's neurons' cast voting power in the range), `distribution` (index of the `rll_distribution` block) |
| `rll_claim` | a claim's transfer answered `Ok` | `caller`, `token`, `amount` (sent, net of fee), `fee`, `total` (debited from the owners), `owners` (Array of Map `owner`, `amount`: whose balances paid), `to` (account), `ledger_tx`, `seq` (`ClaimEvent.sequence_number`; the transfer memo is `rll-claim:<seq>`) |
| `rll_claim_incident` | a claim's transfer outcome is unknown: the owners stay debited and an incident is recorded | `incident_id`, `caller`, `token`, `total`, `amount`, `fee`, `owners`, `seq`, `memo` (Blob), `created_at_time`, `error` |
| `rll_claim_incident_resolve` | an admin resolved an incident (`resolve_claim_incident`) | `caller`, `incident_id`, `token`, `landed` (1: the transfer landed, nothing re-credited; 0: it never landed), `recredited` (amount restored), `owners` (who got it back, when `landed` = 0) |
| `rll_config_update` | a setting changed | `caller` or `via`, `key`, `value`; `old_value` when there was one |
| `rll_admin_action` | an admin started or stopped a process or used a reset tool | `caller`, `action`, plus the fields of the action below |

`rll_config_update` keys and values:

| key | value (and `old_value`) |
|---|---|
| `admin_added`, `admin_removed` | Blob |
| `known_token_added` | Map `ledger`, `symbol`, `decimals`, `fee`; `balance` when the cycle's balance check added it (`via` = `"cycle"`) |
| `known_token_removed` | Blob (only when it was known) |
| `known_tokens_cleared`, `whitelist_cleared` | Nat: how many were removed |
| `whitelist_tokens_added` | Array of Blob: ledgers the ICPSwap list import added (at most 100 per block; more make several blocks); `caller` for a manual import, `via` for the cycle's |
| `token_min_distribution` | Map `ledger`, `amount`; without `amount` = none set (the default 10 × fee); `old_value` always present, in the same shape |
| `token_max_distribution` | Map `ledger`, `amount`; without `amount` = none set (no maximum); `old_value` always present, in the same shape |
| `main_loop` | Text `on` / `off` |
| `icrc3_proposal_neuron` | Blob, or Text `none` |
| `icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount` | Nat |

`rll_admin_action` actions:

| action | extra fields |
|---|---|
| `distribution_cycle_start`, `distribution_cycle_stop` | |
| `neuron_import_start` | `mode` (`all`, `new`) |
| `proposal_import_start` | `mode` (`all`, `new`), `from_proposal` |
| `neuron_import_stop`, `proposal_import_stop` | |
| `clear_balances` | `owners` (records removed), `totals` (Array of Map `ledger`, `amount`: what was owed and becomes undistributed) |
| `clear_all_balances_and_distributions` | `owners`, `totals`, `distribution_events`, `user_distribution_events`, `claim_events` (counts removed) |
| `clear_total_distributions` | `totals` |
| `clear_user_distributions`, `clear_user_distribution_events`, `clear_distribution_events`, `clear_claim_events`, `clear_imported_neurons`, `clear_imported_owners`, `clear_imported_props` | `count` |

Not logged: reads; `balance_reconciliation()` (an update anyone may call; it changes
nothing, and logging it would let anyone grow the log; the cycle's own reconciliation is
logged instead); the stages of a cycle and its neuron/proposal imports (inputs; the
distribution block records the proposal range, neurons and voting power it used);
automatic cycles started by the main loop (their effects are logged); the whitelist and
wallet balance scans' starts and stops (their effect on known tokens is logged; wallet
known tokens decide nothing); claims that change nothing.

## Volume decision: one summary block per distribution plus one block per credited owner

Production (2026-10-21): 828 owners hold a balance, 7 known tokens, 517 distributions since
May 2025 (about one a day: 35 in the last 30 days). Every distribution shares by all votes
cast since proposal 1, so it credits nearly every owner who ever voted: some 800 owners.

- Per-owner blocks: about 800 `rll_credit` + 8 other blocks a day, some 300,000 a year.
  The live store (2,000) fills every two to three days; the 15-minute spill check moves
  500 blocks per `append_blocks` call (about 250 bytes each: some 125 KB per call). An
  archive (1,000,000 blocks) lasts about three years, some 75 MB of stable memory a year:
  storage well under a dollar's worth of cycles a year, plus 1.5 T for each new archive.
  Appending 800 blocks (hash and certify each) in the distribution message adds a few
  hundred million instructions to a message that already scans every ballot.
- One block per distribution carrying all credits was rejected: it would be about 40 KB
  and grow with every new voter, and the library spills by block count, so 500 such blocks
  (some 20 MB) would exceed the 2 MB inter-canister message limit and stall spilling unless
  `spill_batch_size` were tuned and kept tuned. Batches of N credits have the same problem
  at a smaller scale and give readers nothing per-owner blocks do not.
- Per-owner blocks match the existing `UserDistributionEvent`s one to one, keep every block
  small and the same shape, and let a wallet or explorer follow one owner's credits.
  Zero credits (shares floored to 0) are not logged; `rll_distribution.owners` counts the
  non-zero ones.

## Appending points

| Code path | Blocks |
|---|---|
| `distribute_tokens_tick` (the cycle's distribution stage), per known token, after reading the ledger balance | `rll_reconciliation`; then, when something is shared, `rll_distribution` and its `rll_credit`s from `distribute_to_local_balances` after every owner was credited |
| `claim_hotkey_balance` (`claim_full_balance_of_hotkey`) | `rll_claim` on ledger `Ok`; `rll_claim_incident` on an unknown outcome; nothing otherwise |
| `resolve_claim_incident` | `rll_claim_incident_resolve` |
| `add_admin`, `remove_admin` | `rll_config_update` |
| `add_known_token`, `remove_known_token`, `clear_known_tokens`, the balance check (`check_token_balances_tick`) | `rll_config_update` |
| `import_whitelisted_tokens_from_*` and the cycle's whitelist stage, `clear_whitelisted_tokens` | `rll_config_update` (`whitelist_tokens_added` only when something was added) |
| `set_/remove_token_min_distribution`, `set_/remove_token_max_distribution` | `rll_config_update` |
| `start_rll_main_loop`, `stop_rll_main_loop` | `rll_config_update` `main_loop` |
| `start_distribution_cycle`, `stop_distribution_cycle`, `import_all_*`, `stop_*_import`, the `clear_*` tools | `rll_admin_action` |
| ICRC-3 settings and proposal neuron | `rll_config_update` |

The share computation was split so the distribution can report the voting power behind
every share (`calc_distribution`); the shares are computed exactly as before.

## Endpoints

The same as Sneed Lock and Sneedex (library one-liners):

```
icrc3_get_blocks, icrc3_get_archives, icrc3_get_tip_certificate, icrc3_supported_block_types,
icrc10_supported_standards, icrc3_log_status, icrc3_registration_status            (queries)
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers,
admin_set_icrc3_proposal_neuron, admin_icrc3_register_archives_now,
admin_icrc3_reset_archive_registration                                             (admin updates)
```

No import, so `icrc3_log_status().history_imported` stays `false`. Every new method is in
the ingress guard: the queries are refused as update calls, the updates take small
arguments (`SMALL_ARG`). Admins are RLL's (controllers, Sneed governance, `list_admins()`).

## Archives, controllers, registration, cycles

- Archives are created by RLL (actor class `src/icrc3/Archive.mo`) with
  `archive_initial_cycles` (1.5 T; the subnet keeps the 0.5 T creation fee) when the live
  store reaches `max_live_blocks` (2000), checked every 15 minutes by a timer.
- Controllers: RLL and SNS root `fp274-iaaaa-aaaaq-aacha-cai`, set right after creation.
- SNS registration: `SnsRegister.mo` with Sneed governance `fi3zi-fyaaa-aaaaq-aachq-cai`,
  name "RLL". Skipped until `admin_set_icrc3_proposal_neuron` names a neuron that has RLL
  as a hotkey (`SubmitProposal`), the minimum dissolve delay to vote and a stake covering
  the reject cost. Registering makes SNS root the archive's sole controller.
- Cycle reserve: 2 T. RLL never spends its balance below that on archives; with less it
  prints an error (canister log) every check and the live store keeps growing on the heap.
  RLL needs 3.5 T to create its first archive, within the first days after the upgrade.

## Persistence and upgrade

RLL is a `persistent actor class` under classic persistence (no EOP flag in dfx.json).
`icrc3 : Log.State` and `icrc3_sns : SnsRegister.State` are new stable fields (additive);
the runtimes are `transient`; no existing field is removed or retyped. `postupgrade`
re-certifies the tip and starts the spill timer (also started from the actor body; the
runtime guard makes it run once); the existing timer recovery is unchanged. Candid changes
are additive (new methods only).

Production runs the build of commit 75cef0a7 (module hash `2d7e3f23e341…`, `src/sneed_rewards`
unchanged since 25b88246); the upgrade test installs that code, fills it, upgrades to this
release and checks every balance, event, token, limit, incident and the main loop.

Upgrade proposal: `UpgradeSnsControlledCanister` with the release build of `src/sneed_rewards`
(`dfx +0.28.0 build --network ic rll` at `/home/snassy/app_sneeddao`); no
`wasm_memory_persistence` (classic). Staging first. After the upgrade:
`icrc3_log_status()` shows `log_length = 0`; the next cycle writes the first blocks. Check
the canister holds well over 3.5 T cycles. To have archives registered automatically,
set a hotkeyed neuron with `admin_set_icrc3_proposal_neuron`; otherwise register each
archive by a `RegisterDappCanisters` proposal when it appears, and add it to the
ic-unicycle cycle monitoring.

## Follow-ups

- `/rll_info` and `/revenue` could link the log (or show recent `rll_distribution` and
  `rll_claim` blocks) once deployed.
- The heap event lists (`user_distribution_events` above all) keep growing and already
  push `get_event_statistics` over the query instruction limit on production; with the
  log in place they could later be capped or dropped (a separate decision).
