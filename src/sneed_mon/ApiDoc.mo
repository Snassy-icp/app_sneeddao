/// The text get_api_doc returns: a short guide for agents (full reference in public/api-docs/sneed_mon.md).
module {
  public let text : Text = "# Sneed Mon (canister sneed_mon)

Sneed Hub's watcher: it tells users, through Sneed Notifications (app \"Sneed Hub\", topic `proposals`), when a proposal appears in an SNS they watch that one of their neurons can vote on, and once more about a day before voting closes if that neuron still hasn't voted. Users opt in per SNS; the canister checks on a timer (every 10 minutes by default), so the browser can be closed. Step 1 covers SNS proposals only; low cycles and rewards are planned topics.

- Production: not deployed yet
- Staging: not deployed yet

## Units and encoding
- Proposal ids and deadlines are `nat64` (deadlines in seconds since the Unix epoch); other times are `int` nanoseconds.
- Updates return `variant { ok : text; err : text }` (or `ok : nat`), lowercase tags. Branch on the tag, not the text.
- Watches carry a `topic` (`variant { proposals }`); more tags will be added.

## Authentication
- `watch_sns(root)`, `unwatch_sns(root)` and `get_my_watches()` act for the caller; the anonymous principal is refused.
- `admin_*` methods need a controller of the canister or a listed admin (`get_admins`).
- Nothing is anonymous: Sneed Notifications sees which principal it messages; sneed_mon publishes counts of watchers per SNS (`get_snses`), never who they are.

## Fees, transfers and irreversible actions
- Watching is free. sneed_mon moves no tokens.
- Messages are sent by Sneed Notifications under its rules: the user must **allow the app \"Sneed Hub\"** in the notification centre (https://app.sneeddao.com/notifications); `watch_sns` asks for that permission on the user's behalf. Deliveries to paid channels are charged to the user's notification balance unless `get_config().sponsored` is true. Sneed SMS (the inbox) is free.
- A sent notification can't be taken back.

## Asynchronous lifecycle and polling
- `watch_sns` checks the root with SNS-W (the NNS registry of SNSes) and resolves its governance canister. A root SNS-W does not list is refused; a brand-new SNS may need a minute.
- Each round (`get_config().interval_s`) reads the open proposals of every watched SNS (`list_proposals`), fetches the ballots of a new or soon-closing proposal once (`get_proposal`), and for each watcher reads their neurons (`list_neurons` of the principal, vote permission = 4). A neuron counts when its ballot on the proposal has `vote = 0`. Neurons without a ballot can't vote and are ignored.
- One message per user and proposal (dedupe key `prop:<root>:<id>`), and one reminder (`propdl:<root>:<id>`) when the deadline is within a day. A proposal first seen inside that window gets one message only. Someone who starts watching an SNS later is not told about its proposals announced before, only reminded.
- Work per tick is capped (`max_calls_per_tick`); a round goes on in follow-up ticks and resumes where it stopped after an upgrade.
- Poll `get_status()` (counts, last round, last error) and `get_snses()` (per SNS: open proposals and whether each pass is done). Users read `get_my_watches()`.

## Common pitfalls
- No message arrives: the user has not allowed \"Sneed Hub\" in Sneed Notifications (counted in `skipped_not_allowed`), has reached the app's daily cap (`skipped_rate_limited`), holds no vote permission on a neuron with a ballot, or has voted already.
- Each user may watch at most `max_watches_per_user` SNSes (default 10); the canister has global caps on users and SNSes.
- Every query is free as a query; the ingress guard refuses queries sent as update calls.
- NNS proposals are not watched (yet).

Full reference: https://app.sneeddao.com/api-docs/sneed_mon.md
All Sneed APIs for agents: https://app.sneeddao.com/llms.txt
";
};
