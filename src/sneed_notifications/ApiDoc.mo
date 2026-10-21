/// The text get_api_doc returns: a short guide for agents (full reference in public/api-docs/sneed_notifications.md).
module {
  public let text : Text = "# Sneed Notifications (canister sneed_notifications)

Lets any dapp on the Internet Computer notify its users, and lets each user decide which apps may do so, through which channels, how often and at what cost. A dapp registers an app with topics and the canisters that may send; a user allows the app and sets up channels (their Sneed SMS inbox; relays deliver push, Discord and other kinds). Users pay for their own deliveries from a small ICP balance, or an app sponsors a message.

- Production: `vuy7a-iaaaa-aaaay-aaduq-cai`
- Staging: `uqvqs-raaaa-aaaay-aadsq-cai` (separate state; use it to test)

## Units and encoding
- Amounts and prices are ICP e8s as `nat`; timestamps are `int` nanoseconds since the Unix epoch.
- Most updates return `variant { ok : text; err : text }` or `variant { ok : nat; err : text }` (lowercase tags). `notify` returns `NotifyResult` with `NotifyError = variant { not_registered; unknown_topic; not_allowed; rate_limited; no_funds; invalid : text }`. Branch on tags, not texts.
- Levels: `urgent`, `normal`, `info`. Channel kinds: `sneed_sms`, `push`, `discord`, `telegram`, `email`, `sms`.

## Authentication
- `notify`, `notify_batch` and `request_permission` are accepted only as inter-canister calls from a canister listed in a registered app; ingress calls are refused.
- `register_app` needs control of each listed canister (a controller, the governance canister of an SNS whose root controls it, or the canister itself); `update_app` needs the owner or an admin (a canister new to the app needs the same control, except for admins).
- User methods (`allow_app`, `set_permission`, `set_settings`, `add_channel`, `verify_channel`, `remove_channel`, `top_up`) refuse the anonymous principal.
- `relay_pull` / `relay_ack` only from registered relays; `admin_*` only from admins.
- Nothing is anonymous: senders (app canisters) and receivers are public principals.
- Consent first: `notify` reaches only users who allowed the app; otherwise `#not_allowed`.

## Fees, transfers and irreversible actions
- **Per-delivery prices in ICP e8s per channel kind**, plus a per-call price (`get_config().prices_e8s`, `notify_price_e8s`; read at run time). Sneed SMS deliveries are free.
- User pays (`sponsored = false`): charged per delivery to the user's balance; deliveries the balance or the per-app daily spending cap cannot cover are suppressed. App pays (`sponsored = true`): the whole message is charged to the app balance, all or nothing (`#no_funds` otherwise). Finally failed deliveries are refunded; suppressed ones cost nothing.
- **`top_up(amount)` and `top_up_app(id, amount)` pull ICP through ICRC-2** (approve amount + 10,000 e8s ledger fee first). **Balances cannot be withdrawn.** Anyone may fund any app.
- **Sending a notification is irreversible.** Titles, bodies and links are stored as plain text, read by the delivering relay, and land in the user's Sneed SMS inbox (not encrypted, readable by Sneed SMS admins). Never send secrets. Channel addresses are encrypted in the client to the relay key (`get_relay_keys`).
- Notifications are deleted after the retention period (`retention_ns`).
- What is charged (less refunds) is Sneed DAO revenue, forwarded to the RLL ICP splitter once 0.1 ICP has accumulated, never touching balances; public counters in `get_fee_forwarding()`.

## Asynchronous lifecycle and polling
- `notify` returns `#ok({ id; deliveries; deduplicated })` and queues jobs; delivery happens afterwards (Sneed SMS by the canister's own timer, other kinds by relays that pull, deliver and ack; failed attempts are retried up to `max_attempts`).
- Apps poll `get_receipts(ids)` (at most 500 ids) for `pending`, `delivered`, `failed`, `suppressed`, `expired`; every minute or slower is plenty.
- Channels: `add_channel` creates an unverified channel and sends a 6-digit code (valid 24 h); the user calls `verify_channel(id, code)`. `resend_code(id)` sends a new code (same 5-a-day limit). `set_low_balance_alert(threshold_e8s)` (default 0.0001 ICP, 0 = off): one free alert when the balance falls below it.
- Users read `get_my_history(limit)` and `get_my_requests()`.

## Errors, retries and Busy
- `notify` has no awaits: a rejected call recorded nothing. It is not idempotent: give messages a `dedupe` key so a retry inside the window is folded (`deduplicated = true`). The dedupe key is recorded before the balance check, so after `#no_funds` top up and retry with a different key or after the window.
- `#rate_limited`: the user's daily message cap for the app is reached; don't retry in a loop. `#not_allowed` is normal, not an error to retry.
- Top-ups credit the balance in the same message that gets the ledger's confirmation. After a timeout read `get_my_settings().balance_e8s` (or `get_app_balance`) and the remaining allowance before calling again: a second call pulls again.

## Common pitfalls
- Query methods sent as update calls are refused by the ingress guard (`inspect`).
- Argument caps: 4 KiB by default, 64 KiB for `register_app`, `update_app`, `relay_ack` and admin config, about 13 KiB for `add_channel`, `set_settings`, `set_permission`. `notify_batch` over 100 inputs and `get_receipts` over 500 ids trap.
- A new user's default `always_copy` channel id is not stored until their first update call (`add_channel({ sneed_sms })` creates it).
- No echoes: a notification from the Sneed SMS canister itself (`get_config().sneed_sms`, e.g. Sneed Hub's `direct_message` notices) is never delivered to `sneed_sms` channels, not even the always-copy one, so it may have no delivery at all.

## Start with these methods
Dapps: `register_app`, `request_permission`, `notify`, `get_receipts`, `get_app_balance`, `top_up_app`. Users: `get_my_requests`, `allow_app`, `get_my_settings`, `add_channel`, `verify_channel`, `set_settings`, `top_up`, `get_my_history`. Public: `get_config`, `list_apps`, `get_app`, `stats`, `get_fee_forwarding`.

## Full reference
- https://app.sneeddao.com/api-docs/sneed_notifications.md
- Candid: https://app.sneeddao.com/api-docs/sneed_notifications.did
- All Sneed APIs: https://app.sneeddao.com/llms.txt
";
};
