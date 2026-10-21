/// The text get_api_doc returns: a short guide for agents (full reference in public/api-docs/sneed_mon.md).
module {
  public let text : Text = "# Sneed Monitor (canister sneed_mon)

Sneed Hub's watcher, registered with Sneed Notifications as the app \"Sneed Monitor\". A user watches SNSes or the NNS; sneed_mon tells them, through Sneed Notifications, when one of their neurons can vote on a proposal and hasn't (topic `proposals`), and again before voting closes (topic `proposal_deadlines`, urgent). Several proposals due at once come as one digest per topic. Each check of a watch is charged from the user's prepaid ICP balance at the watch's frequency tier.

- Production: not deployed yet
- Staging: v53u4-6iaaa-aaaay-aadva-cai

## Units and encoding
- Proposal ids and deadlines are `nat64` (deadlines in seconds since the Unix epoch); other times are `int` nanoseconds. Amounts are ICP e8s (`nat`).
- A target is `variant { sns : principal (the SNS root); nns }`.
- Updates return `variant { ok : text; err : text }` (or `ok : nat`), lowercase tags. Branch on the tag, not the text.

## Authentication
- User methods act for the caller; the anonymous principal is refused. `admin_*` methods need a controller or a listed admin (`get_admins`).
- Nothing is anonymous: Sneed Notifications sees which principal it messages. sneed_mon publishes counts of watchers per target (`get_targets`), never who they are.

## Quick start (casual: one call)
1. `get_deposit_account()` -> send ICP there -> `credit_deposit()` (moves it into your balance, less one ledger fee; safe to repeat).
2. `watch(variant { sns = principal \"<root>\" })` or `watch(variant { nns })`. Defaults (`get_config().tuning.defaults`): all topics, checked hourly, new proposals and reminders a day before the deadline.
3. Allow \"Sneed Monitor\" in the notification centre (https://app.sneeddao.com/notifications); `watch` asks on your behalf.
4. NNS only: `set_nns_neurons(vec { <neuron id> })` (public info is read; never give a hotkey).

## Pro settings
- `update_watch(target, record { every_min; topics; new_proposals; reminders; reminder_window_s })`, each field optional. `every_min` is a tier of `get_tiers()` (10, 60, 180, 1440); `reminder_window_s` is 3600, 14400, 43200, 86400 or 172800 and at least the check interval; `topics` is `all` or `only` keys from `list_target_topics(target)` (SNS topic names, `fn:<id>` for an SNS without topics, NNS topic numbers).
- `refresh_my_neurons(target)` after adding an SNS neuron (at most every 10 minutes); otherwise neurons are re-read every 6 hours (or the check interval, if longer).
- Reads: `get_my_watches`, `get_watch(target)`, `get_my_balance`, `get_my_charges(start, len)`, `get_my_nns_neurons`, `get_target_topics(target)`.

## Fees, transfers and irreversible actions
- Per check, at the watch's tier (defaults: base 144,000 e8s a day; daily ×1 = 144,000 e8s per check, 3-hourly ×2 = 36,000, hourly ×3 = 18,000, 10-minute ×6 = 6,000; `get_tiers()` is authoritative). Charges are bookkeeping on your balance, not ledger transfers; each shows in `get_my_charges` with its outcome.
- Special prices (https://app.sneeddao.com/api-docs/sneed_mon.md#special-prices): an admin price (people on the admin list) and partner prices (per principal, public label, optional expiry), each an override of `base_daily_price_e8s` with the tier multipliers on top. Each check is charged the lowest of the regular, admin and partner per-check prices (no premium price here). Public: `get_special_prices()`, `get_special_prices_for(principal)`; `get_my_watches` and `get_my_balance` already show your price; `get_my_charges_with_tier` gives each check's `price_tier` (`regular`, `admin`, `partner`). Admins set them with `set_admin_prices`, `set_partner_prices`, `remove_partner_prices` (`variant { ok; err : text }`).
- A check the balance can't pay is not made: your watches pause (kept), you get one message (topic `account`), and `credit_deposit` resumes them once the balance pays one check of each watch. A user with no watches is never charged.
- `withdraw_balance(amount_e8s, account)` returns unspent balance (you receive amount less the ledger fee).
- Collected fees are forwarded in one transfer once they reach `fee_sweep_threshold_e8s` (0.1 ICP) to `fee_destination` (default: the RLL's ICP splitter). `get_accounting()` shows what sneed_mon owes; its ledger account holds at least `obligations_e8s`.
- Messages are sent by Sneed Notifications under its rules (`sponsored = false`: paid channels charge your notification balance there; Sneed SMS is free). A sent notification can't be taken back.

## Asynchronous lifecycle and polling
- A timer runs a round every 10 minutes. A target is polled as often as its most frequent active (paid-up) watcher wants, never when it has none. A new proposal's ballots are read once (`get_proposal`) and matched against every watcher's cached neurons; the reminder reads them once more per reminder window in use. NNS candidates are checked with `get_neuron_info` of your registered neurons when your check is due.
- Each watch is checked when due: its waiting proposals go out, one message per topic. Someone who starts watching an SNS later is not told about proposals announced before, only reminded.
- Poll `get_status()` (counts, backlog, round duration, economics: revenue, checks and cycles burned, total / 24 h / 30 days) and `get_targets()`.

## Common pitfalls
- No message: \"Sneed Monitor\" not allowed in Sneed Notifications (`skipped_not_allowed`), the app's daily cap there, no vote permission on a neuron with a ballot, a vote already cast, a topic filter, or a paused balance.
- NNS: a private neuron hides its ballots, so it counts for new proposals but not reminders; register only neurons with six months' dissolve delay.
- Every query is free as a query; the ingress guard refuses queries sent as update calls.

Full reference: https://app.sneeddao.com/api-docs/sneed_mon.md
All Sneed APIs for agents: https://app.sneeddao.com/llms.txt
";
};
