# Sneed Monitor canister API

Sneed Monitor (`sneed_mon`) is Sneed Hub's watcher. It does on-chain, on a timer, what the notification bar in the Sneed Hub header does in the browser, so users hear about proposals while the browser is closed. It sends through [Sneed Notifications](/api-docs/sneed_notifications.md) as the app **"Sneed Monitor"**, so each user's channels, levels, quiet hours and caps apply (Sneed SMS inbox, phone push, Discord...).

A user watches **SNSes or the NNS**. They are told when one of their neurons can vote on a proposal and hasn't, and again before voting closes if it still hasn't. Each check of a watch is charged from the user's **prepaid ICP balance**, at the watch's frequency tier.

| | |
|---|---|
| Production canister | not deployed yet |
| Staging canister | `v53u4-6iaaa-aaaay-aadva-cai` |
| Candid interface | [sneed_mon.did](/api-docs/sneed_mon.did) · [JavaScript IDL factory](/api-docs/sneed_mon.did.js) |
| Source | [src/sneed_mon/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_mon/main.mo) · [Types.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_mon/Types.mo) |
| Design notes | [spec/sneed_mon.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sneed_mon.md) |
| This document | [raw Markdown](/api-docs/sneed_mon.md) |

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 The parts

| Concept | What it is |
|---|---|
| **Target** | `variant { sns : principal; nns }`: an SNS by its root canister (listed by SNS-W), or the NNS. |
| **Watch** | A user's opt-in for one target, with settings: `every_min` (how often it is checked: a tier), a topic filter, new-proposal messages on/off, reminders on/off, the reminder window. At most 10 per user. |
| **Tier** | A check frequency with its price: 10 minutes, 1 hour, 3 hours or 1 day (`get_tiers`). |
| **Round** | Every 10 minutes: poll the targets that are due, match new proposals against the watchers, check the watches that are due. |
| **Check** | A watch comes due: it is charged, and the proposals waiting for it are sent, one message per topic. |
| **Balance** | The user's prepaid ICP in sneed_mon, filled through a deposit subaccount. |

### 1.2 Who is told

A watcher is told about a proposal when at least one neuron of theirs can vote on it and hasn't:

- **SNS:** the neuron lists them with **permission type 4 (vote)** and has a **ballot** on the proposal with `vote = 0`. A neuron without a ballot can't vote on that proposal (SNS ballots are fixed when the proposal is made). sneed_mon reads the ballots once per proposal (`get_proposal`) and matches them against every watcher's cached neurons (`list_neurons` of the principal, re-read every 6 hours, or at once with `refresh_my_neurons`).
- **NNS:** the user registers neuron ids with `set_nns_neurons` (at most 20; NNS `list_neurons` only shows a caller's own neurons, and sneed_mon never needs a hotkey). At the user's check sneed_mon reads `get_neuron_info` of each: a neuron counts when it has voting power, a dissolve delay of at least six months, was created before the proposal, and has no vote on it in `recent_ballots`. A **private** neuron hides its ballots, so it counts for new proposals but not for reminders.

And the proposal passes the watch's **topic filter** (`all`, or `only` keys from `list_target_topics`).

### 1.3 The messages

| Topic (level) | One proposal | Several at one check | Dedupe key |
|---|---|---|---|
| `proposals` (normal) | `<name> proposal #<id>: you can vote` | `<n> proposals to vote on in <name>` | `prop:<target>:<id>` / `propd:…` |
| `proposal_deadlines` (urgent) | `<name> proposal #<id> closes soon` | `<n> proposals in <name> close soon` | `propdl:<target>:<id>` / `propdld:…` |
| `account` (normal) | `Monitoring paused: top up` | | none |

`<name>` is the SNS's name (governance metadata) or `NNS`. The body has the title, how many of the user's neurons can vote, and when voting closes; a digest lists up to 10 proposals. Links: SNS `https://app.sneeddao.com/proposal?proposalid=<id>&sns=<root>` (digest `/proposals?sns=<root>`), NNS `https://app.sneeddao.com/icp_proposal?proposalid=<id>` (digest `/icp_proposals`).

A "you can vote" message is sent once per user and proposal; a reminder once, when the deadline comes within the watch's `reminder_window_s` (default a day). A proposal first seen inside the window gets the first message only. Someone who starts watching an SNS later is not told about proposals announced before, only reminded.

### 1.4 What Sneed Notifications decides

sneed_mon only sends; the user's settings in Sneed Notifications decide where a message goes. A user who has **not allowed** "Sneed Monitor" gets nothing (`skipped_not_allowed`); `watch` asks for the permission on their behalf. Past the user's daily cap for the app the message is dropped (`skipped_rate_limited`). Neither is retried. Messages are not sponsored: paid channels (push, Discord) charge the user's notification balance there; Sneed SMS is free.

### 1.5 Polling and bounded work

A target is polled as often as its most frequent **active** (paid-up) watcher wants, and not at all when it has none (it then forgets its proposals, and starts afresh when a watcher returns). The calls per proposal don't depend on the number of watchers. A round makes at most `max_calls_per_tick` calls a tick (200); a bigger round goes on in follow-up ticks, and a new round never starts while one is open. Independent calls are issued in parallel (`tuning.parallel_calls`, 20). `get_status().backlog` and `last_round_duration_ns` show how far behind it is.

### 1.6 Billing

| | |
|---|---|
| Deposit | Send ICP to `get_deposit_account()` (your own subaccount of sneed_mon), then `credit_deposit()`: it moves the ICP to sneed_mon's main account, less one ledger fee, and credits your balance. Safe to repeat; nothing is counted twice. |
| Charges | Per check, at the watch's tier: per check = floor(daily price × every_min / 1440), daily price = `base_daily_price_e8s` × multiplier. Bookkeeping only, no ledger transfer. History: `get_my_charges`. |
| Default prices | base 144,000 e8s a day: daily ×1 = 144,000 e8s a check; 3-hourly ×2 = 36,000; hourly ×3 = 18,000 (432,000 e8s a day); 10-minute ×6 = 6,000 (a day of 10-minute checks: 864,000 e8s). A deployed canister keeps its stored tiers; `get_tiers` is authoritative. |
| Special prices | An admin price and partner prices ([§1.6a](#special-prices)): the lowest applicable per-check price is charged. |
| Pause | A check the balance can't pay is not made: the user's watches pause (kept), one `account` message says so, and `credit_deposit` resumes them once the balance pays one check of each watch. No watches, no charge. |
| Withdraw | `withdraw_balance(amount_e8s, to)`: `to` receives the amount less the ledger fee (10,000 e8s). |
| Fees | Forwarded in one transfer (less the ledger fee) to `fee_destination` once they reach `fee_sweep_threshold_e8s` (0.1 ICP), at most once a round. Default destination: the account Sneed Premium pays into, the Neutrinite pylon's ICP splitter `6jvpj-sqaaa-aaaaj-azwnq-cai` with subaccount `0100000000060000000000000000000000000000000000000000000000000000`, which feeds the RLL. |
| Solvency | `get_accounting()`: user balances + fees not yet forwarded = `obligations_e8s`; sneed_mon's main ICP account holds at least that. |

<a id="special-prices"></a>
### 1.6a Special prices (admin and partner)

Next to the regular price (sneed_mon has no premium price) there are two kinds of special price
([spec/special_prices.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/special_prices.md)):

- **Admin price**: for callers on sneed_mon's admin list (controllers and `get_admins`) who are
  people (self-authenticating principals; a canister admin never gets it). Default: unset.
- **Partner prices**: per principal (usually a partner canister that integrates with sneed_mon),
  with a public `label` and an optional expiry (`expires_at`, ns since 1970).

Both are `MonPrices = record { base_daily_price_e8s : opt nat }`: an override of the base daily
price, with the tier multipliers applied on top as for the regular price. Each check is charged
the **lowest** per-check price among regular, admin (admins) and partner (an entry that has not
expired), floor(base × multiplier × every_min / 1440) each; on a tie the regular price is
reported. Unset overrides change nothing. `get_my_watches().price_per_check_e8s` and
`get_my_balance()` show the price that applies to the caller; `get_tiers()` stays the regular table.
Every check records its tier (`get_my_charges_with_tier`: `price_tier` = `regular`, `admin` or
`partner`; checks from before special prices are `regular`). sneed_mon has no ICRC-3 log; the
special prices are public through `get_special_prices()`.

### 1.7 Failures

| What fails | What sneed_mon does |
|---|---|
| `list_proposals` | The target is skipped this round (error recorded on it). |
| `get_proposal` | Retried next poll; given up after 3 failures. |
| `list_neurons` | The old cache stays; retried in an hour. |
| `notify_batch` fails, or answers `not_registered` / `unknown_topic` | No more checks that round; the check is refunded and its proposals kept. Run `admin_register_with_notifications` or `admin_update_notifications_app`. |
| `not_allowed`, `rate_limited`, `no_funds`, `invalid` for one user | That message is dropped (the check is still charged). |
| Ledger (deposit, withdrawal, fee forward) | Nothing is credited or debited unless the ledger accepted. |

### 1.8 Calls the canister refuses at ingress

Queries sent as update calls; the anonymous principal for user updates; every `admin_*` method from anyone but a controller or listed admin; arguments over 4 KB (16 KB for `update_watch` and `admin_set_tuning`).

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './sneed_mon.did.js'; // https://app.sneeddao.com/api-docs/sneed_mon.did.js

export function monActor(identity, canisterId) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId });
}
```

### 2.2 Casual: top up and watch

```js
const mon = monActor(identity, SNEED_MON);
const dep = await mon.get_deposit_account();         // { owner, subaccount: [Uint8Array] }
// send e.g. 0.01 ICP to dep with the ICP ledger (icrc1_transfer), then:
await mon.credit_deposit();                           // { ok: { credited_e8s, balance_e8s, paused } }
await mon.watch({ sns: Principal.fromText('fp274-iaaaa-aaaaq-aacha-cai') }); // Sneed DAO
await mon.watch({ nns: null });
await mon.set_nns_neurons([123456789n]);              // NNS: your neuron ids (public info only)
// then allow "Sneed Monitor" in https://app.sneeddao.com/notifications (the request is waiting there)
```

`watch` answers `ok`: `Watching; …` or `Already watching`; `err`: `Please sign in`, `Top up first: …`, `At most 10 watches per user`, `sneed_mon is full (watcher limit); try again later`, `sneed_mon watches as many SNSes as it may; try again later`, `Not the root of an SNS listed by SNS-W (try again in a minute if it is new)`, `SNS-W did not answer: …`.

### 2.3 Pro: tune a watch

```js
const opt = (v) => (v === undefined ? [] : [v]);
const topics = await mon.list_target_topics({ sns: root }); // { ok: [{ key, name, description }] }
await mon.update_watch({ sns: root }, {
  every_min: opt(10n), topics: opt({ only: ['Governance'] }), new_proposals: opt(), reminders: opt(true), reminder_window_s: opt(14_400n),
});
await mon.get_my_watches();      // settings, price per check, next check, pending, neurons found
await mon.get_my_charges(0n, 20n); // { total, entries: [{ at, target, every_min, price_e8s, outcome }] }, newest first
await mon.refresh_my_neurons({ sns: root }); // after adding a neuron
```

### 2.4 For an operator

```bash
dfx canister --network ic call sneed_mon admin_register_with_notifications   # the app "Sneed Monitor"
dfx canister --network ic call sneed_mon admin_update_notifications_app      # after an upgrade: name and topics, same app id
dfx canister --network ic call sneed_mon get_config --query
dfx canister --network ic call sneed_mon get_status --query
```

## 3. Method reference

### 3.1 Users

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `watch(Target)` | update | `Result` | 2.2. Default settings. |
| `unwatch(Target)` | update | `Result` | The last watcher leaving drops the target. |
| `update_watch(Target, WatchSettingsInput)` | update | `Result` | Only the fields given change. `every_min`: a tier; `reminder_window_s`: 3600, 14400, 43200, 86400 or 172800, at least the check interval; `topics`: `all` or `only` 1 to 50 keys. |
| `refresh_my_neurons(Target)` | update | `ResultNat` | SNS: re-reads your vote neurons (at most every 10 min); returns how many. |
| `set_nns_neurons(vec nat64)` | update | `Result` | At most 20; empty clears. |
| `list_target_topics(Target)` | update | `variant { ok : vec TopicOption; err : text }` | Read from governance, cached a day. |
| `credit_deposit()` | update | `CreditResult` | 1.6. |
| `withdraw_balance(nat, Account)` | update | `ResultNat` | The ledger block. |
| `get_my_watches()` / `get_watch(Target)` | query | `vec MyWatch` / `opt MyWatch` | |
| `get_my_nns_neurons()` | query | `vec nat64` | |
| `get_target_topics(Target)` | query | `opt vec TopicOption` | The cached `list_target_topics` answer. |
| `get_deposit_account()` | query | `Account` | |
| `get_my_balance()` | query | `MyBalance` | Balance, paused, watches, one round of checks and a day's cost at your tiers, totals. |
| `get_my_charges(start : nat, len : nat)` | query | `record { total : nat; entries : vec ChargeEntry }` | Newest first, at most 100 per call, the last 200 kept. |
| `get_my_charges_with_tier(start : nat, len : nat)` | query | `record { total : nat; entries : vec ChargeEntryTiered }` | The same entries with `price_tier`. |

### 3.2 Public reads

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `get_status()` | query | `Status` | Counts, rounds, calls, sent / skipped, errors, `backlog`, `last_round_duration_ns`, `economics` (revenue, checks, rounds, cycles burned: total, last 24 h, last 30 days). |
| `get_targets()` | query | `vec TargetInfo` | Per target: name, watchers (count only), active watchers, poll interval, open proposals with their topic and match state. |
| `get_config()` | query | `record { core; tuning; billing; tiers }` | Every setting. |
| `get_tuning()` / `get_billing_config()` | query | | Parts of `get_config`. |
| `get_tiers()` | query | `record { base_daily_price_e8s; tiers : vec TierPrice }` | With per-check and daily prices. |
| `get_accounting()` | query | `Accounting` | Totals only. |
| `get_special_prices()` | query | `record { admin_prices : MonPrices; partners : vec record { principal; label; prices : MonPrices; expires_at : opt int } }` | Expired partners are listed too. |
| `get_special_prices_for(principal)` | query | `record { admin_prices : opt MonPrices; partner : opt MonPartner }` | What applies to that principal now. |
| `get_topics()` | query | `vec NTopic` | What is registered with Sneed Notifications. |
| `get_admins()` / `get_api_doc()` | query | | |

### 3.3 Admin methods (controllers and listed admins)

| Method | Notes |
|---|---|
| `admin_set_config(Config)` | Core: notifications canister, SNS-W, interval (≥ 60 s), caps, call budget, batch size, pages. |
| `admin_set_tuning(Tuning)` | Watch defaults, NNS governance, neuron refresh, parallel calls, NNS neuron cap, topic cache. |
| `admin_set_tiers(TierTable)` | Base daily price and tiers (every_min ≥ 10 dividing 1440; a tier in use can't be removed). |
| `admin_set_billing(BillingConfig)` | Ledger (not while balances are held), ledger fee, fee destination and threshold. |
| `admin_set_fee_destination(opt Account)` / `admin_set_fee_sweep_threshold(nat)` | `null` keeps fees in the canister. |
| `admin_withdraw_fees(nat, Account)` | At most the fees not yet forwarded; never user balances. |
| `admin_set_notifications_canister(opt principal)` | Clears the app id. |
| `admin_register_with_notifications()` | `register_app` ("Sneed Monitor", this canister, three topics); records the app id. |
| `admin_update_notifications_app()` | `update_app(app_id, …)`: name, description and topics as this build has them, same id. |
| `admin_set_app_id(opt nat)` | |
| `admin_pause()` / `admin_resume()` / `admin_set_interval(nat)` / `admin_run_now()` | `admin_run_now` starts a round (or goes on with the open one) and returns after its first tick. |
| `admin_add_admin(principal)` / `admin_remove_admin(principal)` | |
| `set_admin_prices(MonPrices)` | The admin price (`null` field: none). Returns `variant { ok; err : text }`. |
| `set_partner_prices(principal, MonPartner)` | Add or replace a partner: label 1–100 characters, expiry in the future or none, at most 200 partners, not the anonymous principal. |
| `remove_partner_prices(principal)` | Refuses a principal without an entry. |

## 4. Types

```candid
type Target = variant { sns : principal; nns };
type TopicFilter = variant { all; only : vec text };
type WatchSettings = record { every_min : nat; topics : TopicFilter; new_proposals : bool; reminders : bool; reminder_window_s : nat };
type MyWatch = record {
  target : Target; topic : variant { proposals }; governance : principal; name : text; settings : WatchSettings;
  price_per_check_e8s : nat; next_check_at : int; pending : nat; neurons : opt nat; neurons_at : int;
};
type ChargeEntry = record { at : int; target : Target; every_min : nat; price_e8s : nat; outcome : text };
type ChargeEntryTiered = record { at : int; target : Target; every_min : nat; price_e8s : nat; outcome : text; price_tier : text };
type MonPrices = record { base_daily_price_e8s : opt nat };
type MonPartner = record { label : text; prices : MonPrices; expires_at : opt int };
type Account = record { owner : principal; subaccount : opt blob };
type BillingConfig = record { icp_ledger : principal; ledger_fee_e8s : nat; fee_destination : opt Account; fee_sweep_threshold_e8s : nat };
type TierTable = record { base_daily_price_e8s : nat; tiers : vec record { every_min : nat; daily_multiplier : nat } };
```

`Status`, `Tuning`, `Accounting` and the rest are in [sneed_mon.did](/api-docs/sneed_mon.did). Times are `int` nanoseconds except `deadline_s` (seconds).

## 5. Limits

- Proposals only; low cycles and rewards are planned.
- A daily watch's reminder arrives within a day of the window opening; choose a 48-hour window for a daily watch to be safe.
- The SNS name comes from its governance metadata when the first user watched it.
