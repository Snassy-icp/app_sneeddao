# sneed_mon: Sneed Monitor, Sneed Hub's watcher (draft)

Sneed Hub shows a notification bar in the header (votable proposals, low cycles, rewards to
claim), computed in the browser (`src/app_sneeddao_frontend/src/hooks/useVotableProposalsNotifications.js`
with `utils/VotableProposalsUtils.js`, `useLowCyclesNotification.js`, `useRewardsCache.js`). Users
want the same alerts on their phone or Discord when the browser is closed. Delivery exists already
(Sneed Notifications, `spec/sneed_notifications.md`); sneed_mon is the on-chain part that watches
and decides when to send. It is registered with Sneed Notifications as its own app, **"Sneed
Monitor"** (not the forum's "Sneed Hub" app), because it is paid for differently: users pay for
being monitored.

Status (2026-10-21): built and tested on PocketIC (`test/canisters/tests/sneed-mon.test.js`). The
1bbee49a build (step 1: SNS watches, free, app "Sneed Hub") runs on staging
(`v53u4-6iaaa-aaaay-aadva-cai`, app 2); this version upgrades it in place (§7). API:
`src/app_sneeddao_frontend/public/api-docs/sneed_mon.md`.

## 1. Watches

- **Targets:** `variant { sns : root; nns }`. An SNS root must be listed by SNS-W (the governance
  canister comes from there, so a made-up root can't point sneed_mon at a canister of the caller's
  choosing); its name comes from governance `get_metadata`. The NNS is governance
  `rrkah-fqaaa-aaaaa-aaaaq-cai` (`get_config().tuning.nns_governance`).
- **Casual users: one call.** `watch(target)` with the defaults in config (`tuning.defaults`: all
  topics, checked hourly, new-proposal messages and reminders a day before the deadline). It also
  asks Sneed Notifications for permission (`request_permission`) and, for an SNS, reads the user's
  neurons once. The balance must pay one check of each of the user's watches including the new one.
- **Pro users:** `update_watch(target, settings)`, every field optional: `every_min` (a tier: 10,
  60, 180 or 1440), `topics` (`all` or `only` keys), `new_proposals`, `reminders`,
  `reminder_window_s` (1 h, 4 h, 12 h, 24 h or 48 h, at least the check interval, so a reminder
  can't arrive after the deadline). `get_my_watches`, `get_watch(target)`.
- **Topic filter:** keys from `list_target_topics(target)`: an SNS with topics offers its
  `list_topics` (keys are the topic names, e.g. `Governance`; a proposal's key is its `topic`
  field); an older SNS offers its proposal types (`list_nervous_system_functions`, keys
  `fn:<id>`, matched against the proposal's `action`). A filter matches a proposal by either key.
  The NNS offers its topic numbers (`4` = Governance...). Answers are cached a day.
- **Neurons.** SNS: the neurons that list the user with permission 4 (vote), from `list_neurons {
  of_principal }` (up to 3 × 100), cached per user and SNS. NNS: `list_neurons` only returns the
  caller's own neurons, so users register neuron ids (`set_nns_neurons`, at most 20) and
  sneed_mon reads their public `get_neuron_info`. A hotkey is never needed (a hotkey can vote).
- **Caps:** 10 watches per user, 1,000 users, 100 targets.

## 2. Rounds

A timer every 10 minutes (`interval_s`, one recurring timer, no heartbeat). A round never starts
while one is open: a round over its call budget (`max_calls_per_tick`, 200) goes on in follow-up
ticks one second apart (up to `max_continuations`), then in the next timer tick. Every phase
skips what is done already, so a tick or an upgrade can stop anywhere. Independent calls are issued
together and awaited together (`tuning.parallel_calls`, 20).

1. **Poll** each target that is due: as often as its fastest *active* (not paused) watcher's
   `every_min`. A target with no active watcher is never polled, and forgets its proposals; when a
   watcher returns it starts afresh (every open proposal counts as new). One `list_proposals`
   (reward status ACCEPT_VOTES; up to 3 pages: SNS 50, NNS 100 a page); open = now < deadline
   (wait-for-quiet deadline, or creation + initial voting period; NNS `deadline_timestamp_seconds`).
2. **Missing neuron caches** (a watcher never read, e.g. after the upgrade) are read.
3. **Match** (polled targets only). SNS: a new proposal's ballots are read once with `get_proposal`
   (`list_proposals` returns only the caller's ballots) and matched, without further calls,
   against every active watcher's cached neurons: a neuron counts when its ballot has `vote = 0`.
   Once per reminder window in use (a set of five), when the deadline comes within it, the ballots
   are read and matched again for the watchers with that window. So the calls per proposal don't
   depend on the number of watchers (test: 300 watchers, 1 `get_proposal`, 0 `list_neurons`). A
   window already reached when the proposal is announced counts as done (the message says when
   voting closes). NNS: every active watcher with registered neurons gets the proposal as a
   candidate; no calls. Matches wait in the user's pending list (stable, at most 200).
4. **Checks.** Each watch whose `every_min` has passed since its last check is checked: charged
   (§3); NNS candidates are checked against the user's neurons (`get_neuron_info` of each, once a
   round: voting power, dissolve delay ≥ 6 months, created before the proposal, no non-zero vote in
   `recent_ballots`; a private neuron hides its ballots, so it counts for new proposals only); the
   waiting proposals go out, one message per topic: a single proposal as before, several as a
   digest ("3 proposals to vote on in Alpha DAO", a line each, link to the proposals page of that
   SNS). `notify_batch`, 50 messages a call, in parallel.
5. **Stale neuron caches** (older than `neuron_refresh_s`, 6 h, or the watch's interval if longer)
   are re-read, at most `max_refresh_per_round` (100) a round, spreading the load. Users call
   `refresh_my_neurons(target)` after adding a neuron (at most every 10 minutes).
6. **Fees** are forwarded when over the threshold (§3).

**Messages:** topic `proposals` (normal) for "you can vote", `proposal_deadlines` (urgent) for
"closes soon", `account` (normal) for "monitoring paused". Links: SNS
`/proposal?proposalid=<id>&sns=<root>` and `/proposals?sns=<root>`, NNS
`/icp_proposal?proposalid=<id>` and `/icp_proposals`. Dedupe keys `prop:` / `propdl:` (single),
`propd:` / `propdld:` (digest).

**Once only:** a proposal is matched once (`new_matched`) and once per window (`windows_done`),
stored with the target; a pending item leaves the list when Sneed Notifications answered for it.
`not_allowed`, `rate_limited`, `no_funds`, `invalid` → dropped (no retry). A failed `notify_batch`
call or `not_registered` / `unknown_topic` → no more checks that round, the check refunded, its
items kept.

**Errors:** a failing `list_proposals` skips the target until the next round; `get_proposal` is
given up after 3 failures; a failing `list_neurons` keeps the old cache and is retried in an hour.

## 3. Billing

Users pay for being monitored, per check; messages themselves are priced by Sneed Notifications as
usual (`sponsored = false`).

- **Deposits:** `get_deposit_account()` is the caller's subaccount of sneed_mon on the ICP ledger
  (byte 0 = principal length, then its bytes; the usual Sneed derivation). `credit_deposit()` reads
  that subaccount and moves what is there (less one ledger fee) to sneed_mon's main account, then
  credits the user's balance. With nothing there it credits nothing; a second call during the
  first is refused (a per-user lock, released in `finally`); the credit happens only after the
  ledger accepted, and the call is unbounded-wait, so a reject means nothing moved.
- **Charges are bookkeeping** (balance decrements, never ledger transfers). Each check costs the
  tier's per-check price: tiers (admin `admin_set_tiers`) are {10 min, 1 h, 3 h, 1 day} with daily
  multipliers 6, 3, 2, 1 of `base_daily_price_e8s` (144,000 e8s). Per check = floor(daily price ×
  every_min / 1440), so a day of checks never costs more than the tier's daily price: 6,000, 18,000,
  36,000 and 144,000 e8s. Each check goes into the user's charge history (`get_my_charges`, the last
  200: time, target, tier, price, outcome such as "nothing new" or "2 proposals, sent").
- **Special prices** (spec/special_prices.md): an admin price (people on the admin list, never a
  canister admin) and partner prices (per principal, public label, optional expiry), each a
  `MonPrices = { base_daily_price_e8s : ?Nat }` override of the base daily price with the tier
  multipliers on top. A check costs the lowest of the regular, admin and partner per-check prices
  for the watch's owner, decided at each charge; the tier is kept per charge in `charge_tiers`
  (aligned with `charges`, `get_my_charges_with_tier`). No premium price, no ICRC-3 log here.
  Setters: `set_admin_prices`, `set_partner_prices`, `remove_partner_prices` (admins); public
  reads `get_special_prices`, `get_special_prices_for`.
- **Pause:** a check the balance can't pay is not made: the user is paused (watches kept, no checks,
  pending proposals dropped, no charges) and told once (topic `account`). `credit_deposit` (or
  `watch`, `unwatch`, a lower price at round start) resumes them when the balance pays one check of
  each watch. A user with no watches is never charged.
- **Auto top-up (ICRC-2):** `set_auto_top_up(opt { amount_e8s; when_below_e8s; from_subaccount })`
  (null turns it off; `get_my_balance().auto_top_up` shows the settings, counters, the last refusal
  and the spender to approve). The user approves sneed_mon on the ICP ledger (`icrc2_approve`,
  optionally from a subaccount holding limited funds, with an expiry); that allowance is the hard
  cap, each pull using amount + one ledger fee of it. At the start of each round (phase 0, before
  anything is charged), a user with auto top-up on and watches whose balance is below
  `when_below_e8s`, or can't pay one check of each watch, or is paused, gets one
  `icrc2_transfer_from(from = { user; from_subaccount }, to = sneed_mon's main account, amount,
  memo "sneed_mon top-up <round>", created_at_time)`. The user's wallet pays the ledger fee; the
  balance is credited the full amount only after the ledger accepted (so the main account and the
  balances grow together and the invariant holds), counted in `deposited_e8s` / `deposits_e8s`,
  per user (`pulls`, `pulled_e8s`) and in total (`get_accounting().auto_top_ups[_e8s]`), and listed
  in the charge history as a credit (`every_min = 0`, `price_e8s` = the amount; `kind =
  "auto_top_up"` in `get_my_charges_with_tier`). At most one attempt per user per round, at most 50
  pulls a round (the rest next round), under the user's deposit/withdrawal lock. A refusal
  (`InsufficientAllowance`: used up, expired or never given; `InsufficientFunds`; `GenericError`)
  is recorded, retried after a day (or at once after a new `set_auto_top_up`), and told once per
  failure streak (topic `account`, "Auto top-up failed: <reason>"); passing trouble (a reject,
  `TemporarilyUnavailable`, clock errors, a changed fee) is retried next round without a message.
  If the balance still can't pay, the pause path applies as before. Limits: amount at least 10
  ledger fees and at most 100 ICP; threshold at most 100 ICP; a subaccount is 32 bytes.
- **Withdrawals:** `withdraw_balance(amount, to)`: the amount comes off the balance first and is put
  back if the ledger refuses; `to` receives amount less the ledger fee.
- **Fees:** `fees_collected_e8s` (all charges), `fees_withdrawn_e8s` (forwarded or withdrawn). Once
  the available fees reach `fee_sweep_threshold_e8s` (0.1 ICP), at the end of a round and at most
  once a round, they go in one transfer (less the ledger fee) to `fee_destination`: by default the
  account Sneed Premium pays into, the Neutrinite pylon's ICP splitter
  (`6jvpj-sqaaa-aaaaj-azwnq-cai`, subaccount `01 00 00 00 00 06` + 26 zero bytes), which feeds the
  RLL. The counters move only after the ledger accepted; a failure leaves the fees for the next
  round. `null` keeps them in the canister for `admin_withdraw_fees(amount, to)`, which can't take
  more than the available fees.
- **Invariant:** sneed_mon's main account holds at least `user_balances + fees_available`
  (`get_accounting().obligations_e8s`; the tests check it is exactly that).
- **Economics** (`get_status().economics`): revenue, checks, rounds and cycles burned (what the
  balance went down by during ticks), in total and for the last 24 hours and 30 days (hourly
  buckets), so `/revenue` can show whether the monitor pays for itself.

## 4. Cost

Assumptions (13-node subnet: about 0.26 B cycles per inter-canister call plus about 1,000 cycles per
byte; 1 T cycles ≈ $1.35):

- **Polling** is per target and only at the fastest active watcher's pace: an SNS whose watchers
  are all hourly costs 24 `list_proposals` a day (≈ 6 B cycles with a few KB each), a 10-minute
  watcher makes it 144 (≈ 40 B). Unwatched SNSes cost nothing.
- **Per proposal:** one `get_proposal` with every ballot (≈ 0.45 B for 5,000 neurons) plus one per
  reminder window in use, whatever the number of watchers; then a share of `notify_batch`
  (50 messages ≈ 0.3 B).
- **Per user:** a `list_neurons` per SNS every 6 hours (≈ 0.3 B each: ~1.2 B a day); NNS: one
  `get_neuron_info` per registered neuron per check that has candidates (≈ 0.27 B each).
- At the default prices an hourly watch brings 432,000 e8s a day (0.00432 ICP, about $0.02 at
  $5 an ICP; about 0.13 ICP a month), against roughly 1 to 2 B cycles a day of per-user cost
  (about $0.002), leaving room for the shared polling and per-proposal costs. (The first default,
  14,400 e8s a day, was roughly break-even; raised tenfold on 2026-10-21. A deployed canister keeps
  its stored tiers: an upgrade does not change them, `admin_set_tiers` does.)

**Q**: measure on staging with `get_status().economics` and tune `base_daily_price_e8s`; NNS
watches cost more per check (per-neuron reads) than SNS watches at the same price.

## 5. Admin

Controllers plus an admin list. Everything is readable with `get_config()` (`core`, `tuning`,
`billing`, `tiers`) and settable: `admin_set_config` (core), `admin_set_tuning` (defaults, refresh,
parallelism, caps), `admin_set_tiers`, `admin_set_billing`, `admin_set_fee_destination`,
`admin_set_fee_sweep_threshold`, `admin_set_notifications_canister`,
`admin_register_with_notifications` (`register_app`: "Sneed Monitor", this canister, the three
topics), `admin_update_notifications_app` (`update_app(app_id, AppInput)`, allowed to the app's
owner, which sneed_mon is when it registered the app: new name, description and topics, same id),
`admin_set_app_id`, `admin_withdraw_fees`, `admin_pause` / `admin_resume`, `admin_set_interval`,
`admin_run_now`, `admin_add_admin` / `admin_remove_admin`; `get_recent_errors` (admins: the last
30 errors, each with the round phase and target it happened in).

Outgoing calls and cycles: each call in flight holds the cycles reserved for its largest possible
response (~82B on a 13-node subnet), and the IC refuses to send one (`call_perform` fails, the call
expression throws "could not perform remote call") when that would take the balance under the
freezing threshold. A round sends calls only while the balance is above the level at which the last
send failed (plus one call's reservation, both measured), unless none is in flight; a call it can't
send is recorded on its target (a proposal's failed read, a target's failed listing, a stale neuron
cache, a refunded check) and the rest go in the next batch, after the ones in flight are answered.
A round never aborts on one call.

Conventions: ingress guard (`system func inspect`: queries refused as updates, `admin_*` only from
admins, user methods not from the anonymous principal, 4 KB argument cap, 16 KB for a topic
filter); `get_api_doc`; enhanced orthogonal persistence (upgrade proposals must set
`wasm_memory_persistence = keep`); no ICRC-85; no ICRC-3 log yet.

## 6. Questions

1. **Watch by default?** Sneed Hub could offer "watch all SNSes where I have neurons" as one click.
2. **Prices:** the defaults (base 144,000 e8s a day, raised tenfold from 14,400) are an estimate; tune them from staging's economics.
3. **NNS pricing:** NNS checks read each registered neuron, so they cost more cycles; same price
   for now.

## 7. Upgrade from the staging build (1bbee49a)

New stable variables only; the old `snses` / `user_watches` (and two old constants) stay declared
and are moved into the new structures in `postupgrade`, then emptied. Watches get the defaults;
open proposals whose "new" pass had started count as announced (better a missed message than a
repeat). Watchers have no balance after the upgrade, so their first check pauses them with the
notice (staging has none). After the upgrade run `admin_update_notifications_app` so app 2 becomes
"Sneed Monitor" with the three topics, and point `admin_set_billing` at the real ledger (it is by
default).

## 7a. Upgrade adding auto top-up (from 6cfabb63)

New stable state only (`auto_top_ups`, two counters; transient constants); Candid additions are
additive (`set_auto_top_up`, new fields in `MyBalance`, `Accounting`, `ChargeEntryTiered`). After
the upgrade nobody has auto top-up on. Test: `sneed-mon-auto-top-up.test.js` upgrades the
6cfabb63 build (`build/sneed_mon_preatu.wasm`). Run `admin_update_notifications_app` so the
`account` topic's description mentions failed top-ups.

## 8. Later topics (not built)

The watch carries `MonTopic` (`#proposals` today): `#cycles` (low cycles of watched canisters, as
`useLowCyclesNotification.js`) and `#rewards` (unclaimed RLL rewards, as `useRewardsCache.js`).

## 9. Activity log (ICRC-3)

Added 2026-10-22, not deployed. A hash-chained, certified log through the ICRC-3 interface, with
archive canisters, built on the shared library `src/icrc3` exactly as the forum and Sneed
Notifications ([spec/notifications_icrc3.md](notifications_icrc3.md)). Tests:
`test/canisters/tests/sneed-mon-icrc3.test.js`.

**What is logged: money and governance.** Deposits credited, withdrawals, auto top-up pulls, the
charges of each round, user pauses and resumes, fee forwards and fee withdrawals, admins, and every
configuration, tuning, billing, tier and special-price value that changed.

**What is not logged: what anyone watches.** No block names a target (SNS root, NNS), a proposal,
a topic filter, a neuron or a watch setting; `watch`, `unwatch`, `update_watch`,
`set_nns_neurons`, `refresh_my_neurons`, `list_target_topics` and `set_auto_top_up` append
nothing. Neither do messages sent through Sneed Notifications, refused calls, calls that change
nothing, or the ledger fee learnt from a `BadFee` answer.

**Charges are aggregated per round.** One check per watch per due interval would be one block per
check (with 1,000 users and 10 hourly watches each, 240,000 blocks a day). Instead the round
adds up its kept charges (checks refunded because Sneed Notifications could not take them are not
counted) and appends one `sneedmon_round_charges` block when the round ends, and only if it
charged anything. Rounds start at most every `interval_s` (≥ 60 s; 600 s by default), so the log
grows by at most one charge block per round: 144 a day at the default interval, 1,440 at the
minimum, however many users there are. The block names each user's total only while the round
charged at most 20 users (a few KB at most); above that it carries the totals only, and a user's
own history stays in `get_my_charges`. The running totals are stable variables, so a round cut
short by an upgrade is still logged, before the next round starts.

Block format as in the other Sneed logs (`Map { btype; ts; phash; tx }`; principals as Blob,
accounts as `Array [owner, subaccount?]`, amounts in ICP e8s and ledger blocks as Nat, flags as
Nat 0/1). First field `caller`, or `via` = `"timer"` for what a round did. Prefix `sneedmon_`;
url `https://app.sneeddao.com/api/sneed_mon#block-types` (public API doc §6.3).

| btype | appended by | tx fields |
|---|---|---|
| `sneedmon_deposit` | `credit_deposit` moved ICP from the caller's deposit subaccount into their balance | `caller`, `amount_e8s` (credited), `fee_e8s`, `ledger_block` |
| `sneedmon_withdraw` | `withdraw_balance`, after the ledger accepted | `caller`, `amount_e8s` (debited), `fee_e8s`, `to`, `ledger_block` |
| `sneedmon_auto_top_up` | a round pulled a top-up with `icrc2_transfer_from` | `via`, `user`, `amount_e8s` (credited), `fee_e8s` (paid by the wallet), `from` (the user's account), `ledger_block` |
| `sneedmon_round_charges` | a round that charged at least one check ended (or the next round started after it was cut short) | `via`, `round`, `checks`, `charged_e8s`, `users`; `per_user` (Array of `[user, charged_e8s, checks]`) when `users` ≤ 20 |
| `sneedmon_user_pause` | a check could not be paid: the user's watches pause | `via`, `user`, `balance_e8s`, `price_e8s` (the check it could not pay) |
| `sneedmon_user_resume` | a paused user's balance pays a check of each watch again (after a deposit, an auto top-up, a price change, an unwatch) | `caller` or `via`, `user`, `balance_e8s` |
| `sneedmon_fee_forward` | a round forwarded the collected fees | `via`, `amount_e8s` (taken off the fees; the destination receives it less `fee_e8s`), `fee_e8s`, `to`, `ledger_block`, `forwards` |
| `sneedmon_fee_withdraw` | `admin_withdraw_fees` | `caller`, `amount_e8s`, `fee_e8s`, `to`, `ledger_block` |
| `sneedmon_admin_add`, `sneedmon_admin_remove` | `admin_add_admin`, `admin_remove_admin`, when the list changed | `caller`, `principal` |
| `sneedmon_config_update` | one block per value that changed | `caller`, `key`, `old_value`, `value` (partner prices: also `partner`; `old_value` absent for a new partner, `value` Text `removed` for a removal) |

`sneedmon_config_update` keys: the core `Config` fields (`notifications` Blob or `none`,
`sns_wasm`, `interval_s`, `paused`, `sponsored`, `max_users`, `max_watches_per_user`,
`max_snses`, `max_calls_per_tick`, `max_continuations`, `reminder_window_s`, `batch_size`,
`neuron_pages`, `proposal_pages`, `neuron_cache_s`) from `admin_set_config`, `admin_pause`,
`admin_resume`, `admin_set_interval`, `admin_set_notifications_canister`; `app_id` (Nat or
`none`); the `Tuning` fields (`nns_governance`, `defaults` as `Map { every_min; topics; new_proposals;
reminders; reminder_window_s }`, `neuron_refresh_s`, `max_refresh_per_round`, `parallel_calls`,
`max_nns_neurons`, `user_refresh_min_s`, `max_pending_per_user`, `topic_cache_s`); the billing
fields (`icp_ledger`, `ledger_fee_e8s`, `fee_destination` account or `none`,
`fee_sweep_threshold_e8s`); the tier table (`base_daily_price_e8s`, `tiers` Array of
`Map { every_min; daily_multiplier }`); special prices (`admin_prices` Map of the set overrides,
`partner_prices` with `partner`, value `Map { label; prices; expires_at? }`); the log settings
`icrc3_*`.

Endpoints, archives and cycles as on Sneed Notifications: `icrc3_get_blocks`,
`icrc3_get_archives`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`,
`icrc10_supported_standards`, `icrc3_log_status` (queries, refused as updates by the ingress
guard); `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`
and the admin query `get_log` (the log's operational messages). Archives are co-controlled by
sneed_mon and SNS root `fp274-iaaaa-aaaaq-aacha-cai`; cycle reserve 2 T (3.5 T to create one).

Upgrade: new stable variables only (`icrc3`, `icrc3_textlog`, the round totals), so the log
starts empty; `moc --stable-compatible` against the 5f62b7d5 build passes; Candid only adds
methods. Upgrade with `wasm_memory_persistence = keep`. Staging (`v53u4-…`, no production yet)
runs module hash `ab310a51…` = `dfx +0.28.0 build --network staging sneed_mon` of 5f62b7d5
(unchanged since 3f668176); the tests build it as `sneed_mon_preicrc3.wasm`, run the log tests
against it (they fail) and upgrade from it with keep.
