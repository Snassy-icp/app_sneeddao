# Sneed Mon canister API

Sneed Mon (`sneed_mon`) is Sneed Hub's watcher. It does on-chain, on a timer, what the notification bar in the Sneed Hub header does in the browser, so users hear about things while the browser is closed. It sends through [Sneed Notifications](/api-docs/sneed_notifications.md) as the app **"Sneed Hub"**, so each user's channels, levels, quiet hours and caps apply (Sneed SMS inbox, phone push, Discord...).

Step 1 watches **SNS proposals**: a user who watches an SNS is told when a proposal appears that one of their neurons can vote on, and once more about a day before voting closes if that neuron still hasn't voted. Low cycles and unclaimed rewards are planned topics.

| | |
|---|---|
| Production canister | not deployed yet |
| Staging canister | not deployed yet |
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
| **Watch** | A user's opt-in for one SNS (`watch_sns(root)`), with a topic (`proposals` today). At most `max_watches_per_user` (default 10) per user. |
| **Watched SNS** | An SNS at least one user watches: its root, its governance canister (from SNS-W), its name (governance `get_metadata`), its sorted watcher list and its open proposals. |
| **Round** | Every `interval_s` (default 600 s): for each watched SNS one `list_proposals`, then the passes that are due. |
| **Pass** | One walk over an SNS's watchers for one proposal: the **new** pass (once per proposal) and the **reminder** pass (once, when the deadline is within `reminder_window_s`, default 24 h). Each pass fetches the proposal's ballots once (`get_proposal`) and each watcher's neurons (`list_neurons` with `of_principal`, cached for `neuron_cache_s`). |

### 1.2 Who is told

A watcher is told about a proposal when at least one neuron of theirs:

- lists them with **permission type 4 (vote)**, and
- has a **ballot** on the proposal with `vote = 0` (not voted yet).

A neuron without a ballot can't vote on that proposal (SNS ballots are fixed when the proposal is made), so it doesn't count. This is the same check the header bar makes in the browser (`VotableProposalsUtils.js`), with the ballots as the measure of voting power.

`list_proposals` on SNS governance only returns the ballots of the caller's own neurons, so sneed_mon reads the ballots with `get_proposal`: once for the new pass, once for the reminder.

### 1.3 The messages

| | Title | Dedupe key | When |
|---|---|---|---|
| New | `<SNS name> proposal #<id>: you can vote` | `prop:<root>:<id>` | The first round that sees the proposal open (on the first listing of a newly watched SNS: every open proposal). |
| Reminder | `<SNS name> proposal #<id> closes soon` | `propdl:<root>:<id>` | The deadline (wait-for-quiet included) is within `reminder_window_s`, and the neuron still hasn't voted. Not sent if the proposal was first announced inside that window. |

Both use topic `proposals` (level `normal`), link `https://app.sneeddao.com/proposal?proposalid=<id>&sns=<root>`, and a body with the proposal's title, how many of the user's neurons can vote, and when voting closes. `sponsored` is `get_config().sponsored` (default `false`: the user's notification balance pays for paid channels; Sneed SMS is free).

Each user gets each message at most once: the passes keep their place (a cursor into the sorted watcher list) in stable state, and Sneed Notifications folds a repeated dedupe key within an hour as a second guard. Someone who starts watching an SNS after a proposal was announced is not told about it, only reminded.

### 1.4 What Sneed Notifications decides

sneed_mon only sends; the user's settings in Sneed Notifications decide where a message goes. A user who has **not allowed** the app "Sneed Hub" gets nothing (`not_allowed`, counted in `skipped_not_allowed`); `watch_sns` asks for the permission on their behalf (`request_permission`, shown in the notification centre). Past the user's daily cap for the app the message is dropped (`skipped_rate_limited`). Neither is retried.

### 1.5 Bounded work

A tick makes at most `max_calls_per_tick` inter-canister calls (default 200). A round that needs more goes on in follow-up ticks one second apart, up to `max_continuations` (default 10); the rest waits for the next round, and the passes resume where they stopped, also after an upgrade. `list_proposals` reads at most `proposal_pages` pages of 50, `list_neurons` at most `neuron_pages` pages of 100 per user. `notify_batch` sends `batch_size` messages at a time (default 50).

Global caps: `max_users` watching users (default 1,000) and `max_snses` watched SNSes (default 100).

### 1.6 Failures

| What fails | What sneed_mon does |
|---|---|
| `list_proposals` | The SNS is skipped this round (error recorded on it). |
| `get_proposal` | The pass waits for the next round; after 3 failures it is given up. |
| `list_neurons` | The pass stops before that user and resumes next round. |
| `notify_batch` call fails, or answers `not_registered` / `unknown_topic` | Nothing is marked sent; no more passes this round; tried again next round. Run `admin_register_with_notifications` (or fix the app in Sneed Notifications). |
| `not_allowed`, `rate_limited`, `no_funds`, `invalid` for one user | That user is skipped for that message, not retried. |

Errors are counted and the last one kept, in `get_status()` and per SNS in `get_snses()`.

### 1.7 Calls the canister refuses at ingress

Queries sent as update calls; the anonymous principal for `watch_sns` / `unwatch_sns`; every `admin_*` method from anyone but a controller or listed admin; arguments over 4 KB.

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

### 2.2 For a user: watch an SNS

```js
const mon = monActor(identity, SNEED_MON);
await mon.watch_sns(Principal.fromText('fp274-iaaaa-aaaaq-aacha-cai')); // Sneed DAO's SNS root
// then allow "Sneed Hub" in https://app.sneeddao.com/notifications (the request is waiting there)
await mon.get_my_watches(); // [{ topic: { proposals: null }, root, governance, name }]
await mon.unwatch_sns(root);
```

`watch_sns` answers `ok`: `Watching` or `Already watching`; `err`: `Please sign in`, `At most 10 SNSes per user`, `sneed_mon is full (watcher limit); try again later`, `sneed_mon watches as many SNSes as it may; try again later`, `Not the root of an SNS listed by SNS-W (try again in a minute if it is new)`, `SNS-W did not answer: …`. `unwatch_sns` answers `Stopped watching` or `Not watching`.

### 2.3 For an operator: connect to Sneed Notifications

```bash
dfx canister --network ic call sneed_mon admin_set_notifications_canister '(opt principal "vuy7a-iaaaa-aaaay-aaduq-cai")'
dfx canister --network ic call sneed_mon admin_register_with_notifications   # registers the app "Sneed Hub" for this canister
dfx canister --network ic call sneed_mon get_status --query
```

Instead of a separate app, an admin of Sneed Notifications can add this canister and the `proposals` topic (`get_topics()`) to the existing "Sneed Hub" app with `update_app`, then record the id here with `admin_set_app_id`.

## 3. Method reference

### 3.1 Users

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `watch_sns(root : principal)` | update | `Result` | 2.2. Checks the root with SNS-W. |
| `unwatch_sns(root : principal)` | update | `Result` | The last watcher leaving drops the SNS and its proposals. |
| `get_my_watches()` | query | `vec MyWatch` | The caller's watches. |

### 3.2 Public reads

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `get_status()` | query | `Status` | Counts (users, watches, SNSes, open proposals), rounds, calls, sent / deduplicated / skipped, errors, the notifications canister, the app id, cycles. `running` is true while a round is under way. |
| `get_snses()` | query | `vec SnsInfo` | Per watched SNS: governance, name, number of watchers (never who), open proposals with their deadlines and whether each pass is done, last error. |
| `get_config()` | query | `Config` | |
| `get_topics()` | query | `vec NTopic` | What `admin_register_with_notifications` registers. |
| `get_admins()` | query | `vec principal` | The admin list (controllers are admins too). |
| `get_api_doc()` | query | `text` | |

### 3.3 Admin methods (controllers and listed admins)

| Method | Returns | Notes |
|---|---|---|
| `admin_set_config(Config)` | `Result` | `interval_s` at least 60, `batch_size` 1 to 100, `max_calls_per_tick` at least 1. A new interval restarts the timer. |
| `admin_set_notifications_canister(opt principal)` | `Result` | Clears the recorded app id. |
| `admin_register_with_notifications()` | `ResultNat` | Calls `register_app` on Sneed Notifications (name "Sneed Hub", this canister, topic `proposals`); records the app id. Returns Sneed Notifications' answer. |
| `admin_set_app_id(opt nat)` | `Result` | When the canister was added to an existing app instead. |
| `admin_pause()` / `admin_resume()` | `Result` | A paused canister starts no rounds. |
| `admin_set_interval(nat)` | `Result` | Seconds, at least 60. |
| `admin_run_now()` | `Result` | Starts a round (or goes on with the current one) and returns after its first tick. `err`: `Paused`, `A tick is running`. |
| `admin_add_admin(principal)` / `admin_remove_admin(principal)` | `Result` | |

## 4. Types

```candid
type MonTopic = variant { proposals };
type MyWatch = record { topic : MonTopic; root : principal; governance : principal; name : text };
type SnsInfo = record {
  root : principal; governance : principal; name : text; watchers : nat;
  open : vec record { id : nat64; title : text; deadline_s : nat64; new_done : bool; reminder_done : bool };
  listed_at : int; last_error : opt record { int; text }; errors : nat;
};
type Config = record {
  notifications : opt principal; sns_wasm : principal; interval_s : nat; paused : bool; sponsored : bool;
  max_users : nat; max_watches_per_user : nat; max_snses : nat;
  max_calls_per_tick : nat; max_continuations : nat; reminder_window_s : nat; batch_size : nat;
  neuron_pages : nat; proposal_pages : nat; neuron_cache_s : nat;
};
```

`Status` and the rest are in [sneed_mon.did](/api-docs/sneed_mon.did). Times in `Status` and `SnsInfo` (`last_round_start`, `listed_at`, the error times) are `int` nanoseconds; `deadline_s` is seconds.

## 5. Limits of step 1

- SNS proposals only; NNS proposals, low cycles and rewards are planned.
- No per-user choice of which proposal topics or types to hear about yet.
- The SNS name comes from its governance metadata at the time the first user watched it.
