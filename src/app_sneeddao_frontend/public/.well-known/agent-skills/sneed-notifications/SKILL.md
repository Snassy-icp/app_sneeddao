---
name: sneed-notifications
description: Use Sneed Notifications (vuy7a-iaaaa-aaaay-aaduq-cai), the Sneed DAO notification canister on the Internet Computer - as a user, allow or block apps, choose channels (Sneed SMS, phone push, Discord), set per-topic rules, quiet hours and snooze, top up the ICP delivery balance and read your history; as a dapp developer, register an app with topics, ask users for permission, send notify / notify_batch from your canisters and read delivery receipts. Use when someone wants on-chain alerts from Sneed Hub or another IC dapp (forum replies, mentions, tips) or wants to send notifications to IC users.
license: MIT
metadata:
  publisher: Sneed DAO
  canister: vuy7a-iaaaa-aaaay-aaduq-cai
  staging-canister: uqvqs-raaaa-aaaay-aadsq-cai
  full-reference: https://app.sneeddao.com/api-docs/sneed_notifications.md
  source: https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_notifications/main.mo
---

# Sneed Notifications skill

Sneed Notifications is a message hub: apps declare topics, users allow apps and pick channels and rules, the apps' canisters call `notify`, and messages wait in the canister until delivered: Sneed SMS by the canister itself, every other channel by relays that pull jobs and report back. Users pay for their own deliveries on paid channels; an app may sponsor a message. Full reference: https://app.sneeddao.com/api-docs/sneed_notifications.md. Candid: `src/declarations/sneed_notifications/sneed_notifications.did`.

Canisters: production `vuy7a-iaaaa-aaaay-aaduq-cai` (live; early: one app registered so far, Sneed Hub's forum), staging `uqvqs-raaaa-aaaay-aadsq-cai`. User page: https://app.sneeddao.com/notifications, help: https://app.sneeddao.com/help/notifications. Payments in ICP, ledger `ryjl3-tyaaa-aaaaa-aaaba-cai`, fee 10_000 e8s.

## Core facts to keep straight

1. **Nothing arrives until the user allows the app.** `notify` answers `err(not_allowed)` when the user has no permission record for the app or blocked it. Apps ask with `request_permission(user)`; the request shows in the user's notification centre; the user decides with `allow_app(app, true|false)` (allowing applies default caps).
2. **Sneed SMS is always there and free.** Every user has a verified `sneed_sms` channel, and by default `always_copy` points at it, so every allowed notification is also copied to the user's Sneed SMS inbox. Removing that copy is the user's choice.
3. **Other channels need a running relay and verification.** Production has relays for `discord` and `push` (phone push, installed app); `telegram`, `email` and `sms` have none yet. `get_relay_keys()` lists the kinds that work. A channel address is encrypted in the client to the relay's key (RSA-OAEP-256 wrapping AES-256-GCM, see `NotificationsService.js`), so the canister and apps cannot read it. `add_channel` sends a 6-digit code through the relay; `verify_channel(id, code)` within 24 hours.
4. **Prices** (`get_config().prices_e8s`, production now): Sneed SMS 0, push 100, Discord 100, Telegram 100, email 1_000, SMS 1_000_000 e8s per delivery; `notify_price_e8s` is 0. The user's balance pays unless the app sends `sponsored = true`, then the app's balance pays all or nothing (`err(no_funds)`). Top-ups cannot be withdrawn.
5. **Caps protect the user.** Per app: `daily_cap` messages (default 20) and `daily_spend_cap_e8s` (default 100_000); over the message cap → `err(rate_limited)`; a paid delivery over balance or spend cap is recorded as `suppressed`.
6. **Levels** `urgent | normal | info` come from the app's topic; the user routes each level to channels (`settings.defaults`), may mute, re-level or re-route a topic (`TopicRule`), `demote` an app, set `copy_only`, mute an app until a time, snooze everything (`snooze_until`) and set quiet hours (`QuietHours`, minutes of the day plus UTC offset; `urgent_passes` lets urgent through). During quiet hours deliveries are held, except Sneed SMS.
7. **Limits**: title 1-200 chars, body ≤ 2000, link `https://` ≤ 512, `dedupe` key folds repeats within 1 hour (`deduplicated = true`), at most 20 channels per user. Notifications are kept 30 days.
8. **Only registered app canisters may call `notify` / `notify_batch` / `request_permission`.** `register_app` requires the caller to control every listed canister (or be the governance of an SNS whose root controls it); a canister belongs to one app.
9. **Never act for a user without their signature.** User methods are caller-scoped; the user signs in Sneed Hub. Do not ask for keys or seed phrases.
10. **Activity log (ICRC-3, once deployed).** Top-ups (with their ledger block), refunds of failed deliveries (amount only), fee forwards to the RLL splitter, apps registered, changed, verified or removed, admin and config changes are blocks of a certified, hash-chained log: `icrc3_get_blocks`, `icrc3_get_tip_certificate`, `icrc3_get_archives`, `icrc3_supported_block_types` (`sneednotif_*`, documented at https://app.sneeddao.com/api/sneed_notifications#block-types). What was sent to whom is never logged.

## Procedures (user)

### Get notifications from an app
1. `get_my_requests()` → apps that asked; `list_apps(start, limit)` / `get_app(id)` to inspect (check `verified`, `owner`, `canisters`).
2. `allow_app(appId, true)`; fine-tune with `set_permission(appId, Permission)`. `get_my_apps()` → `vec (App, Permission)`.

### Add a channel
1. `get_relay_keys()`; if the kind is missing, it is not available yet.
2. Encrypt the address to the relay key in the client; `add_channel(kind, label, addressBlob)` → `ok(channelId)`.
3. Read the code from that channel; `verify_channel(channelId, code)`. `remove_channel(id)` deletes the address.

### Routing, quiet hours, snooze
`get_my_settings()` → `{settings, channels, balance_e8s}`. Change and send back the whole record with `set_settings(Settings)` (channel ids must be the user's own).

### Pay for deliveries
`icrc2_approve` the ICP ledger for `amount + 10_000` with spender `{owner = vuy7a-iaaaa-aaaay-aaduq-cai}`, then `top_up(amount_e8s)` → `ok(newBalance)`.

### History
`get_my_history(limit)` → newest first, each with `deliveries` (`queued | sending | delivered | failed | suppressed`).

## Procedures (dapp developer)

1. `register_app({name; description; logo; canisters; topics = vec {record {id; title; description; level}}})` → `ok(appId)` (sign in as a controller of each canister). `update_app(id, input)` later. Apps start unverified; Sneed DAO admins set the checkmark.
2. From an app canister: `request_permission(user)` → `ok("Asked" | "Already asked" | "Already decided by the user")`.
3. From an app canister: `notify({user; topic; title; body; link; dedupe; sponsored})` → `ok{id; deliveries; deduplicated}` or `err(not_registered | not_allowed | unknown_topic | rate_limited | no_funds | invalid text)`. Up to many users at once: `notify_batch(vec NotifyInput)`.
4. Sponsoring: anyone may fund an app with `top_up_app(appId, amount_e8s)` after an ICRC-2 approval; `get_app_balance(appId)`.
5. Outcome per message (never where it went): `get_receipts(vec id)` → `pending | delivered | expired | failed | suppressed`.

## dfx examples

```bash
dfx canister --network ic --identity anonymous call vuy7a-iaaaa-aaaay-aaduq-cai list_apps '(0 : nat, 20 : nat)' --query
dfx canister --network ic --identity anonymous call vuy7a-iaaaa-aaaay-aaduq-cai get_config --query
dfx canister --network ic call vuy7a-iaaaa-aaaay-aaduq-cai get_my_settings --query
```

## Reference implementation

User side: `src/app_sneeddao_frontend/src/utils/NotificationsService.js` (top-up, channel encryption) and `src/pages/Notifications.jsx`. App side: the forum canister `src/sneed_sns_forum` sends replies, mentions and tips. Spec: `spec/sneed_notifications.md`. All under https://github.com/Snassy-icp/app_sneeddao.
