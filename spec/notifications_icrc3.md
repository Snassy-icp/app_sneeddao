# Sneed Notifications activity log (ICRC-3)

Design for a hash-chained, certified activity log in the `sneed_notifications` canister
(production `vuy7a-iaaaa-aaaay-aaduq-cai`, staging `uqvqs-raaaa-aaaay-aadsq-cai`), exposed through
the ICRC-3 block log interface, with archive canisters. Written 2026-10-22. The log uses the
shared library `src/icrc3` as the forum does (enhanced orthogonal persistence; recipe:
`src/icrc3/README.md`; closest sibling: [spec/forum_icrc3.md](forum_icrc3.md)). This document
records what is specific to Sneed Notifications: what is logged and what deliberately is not, the
block catalogue, where each block is appended, and the release.

**Status (2026-10-22): implemented, not deployed.** Tests: `test/canisters/tests/notifications-icrc3.test.js`.

## What the log is for

Sneed Notifications holds other people's ICP (user and app balances), earns DAO revenue from it
and forwards that revenue to the RLL splitter; admins set the prices and register DAO apps. The
log makes exactly that auditable:

- **Money.** Every top-up (with the ledger block that brought the ICP in), every refund of a
  finally failed paid delivery, every fee forward (amount, destination, ledger block), the first
  measurement of the fee backlog and any re-measurement of the books against the ledger.
- **Governance.** Apps registered, changed, verified and removed (who may notify, under which
  topics); the admin list; every configuration value (prices, relays, relay public keys, the fee
  destination and threshold, the log's own settings).

## What is not logged, and why

**Never what was sent to whom.** Notifications are private between an app and its user: a public,
append-only log of them would be a permanent public record of who gets messages from which app,
when. So no block carries a notification's title, body or link, a channel's name, kind or
(encrypted) address, a verification code, a delivery, a receipt, or the user of a delivery.

- **Refunds** carry the amount and who paid (`user` or `app`) only, plus the running total of
  refunds, never the user, the app, the notification or the job. The total matches
  `get_fee_forwarding().refunded_e8s`.
- **Notifications, deliveries, retries, leases, pruning:** not logged at all.
- **Users' channels, settings, permissions, requests, low-balance alerts:** per-user bookkeeping,
  not logged.
- **Refused calls and calls that change nothing** (an update with the same app data, adding an
  admin already on the list, setting a value it already has, a fee check below the threshold).
- **The ledger fee learnt from a `BadFee` answer** (not an admin decision; visible in
  `get_fee_forwarding().ledger_fee_e8s`).

A top-up names its caller (the payer) and the ledger block: that transfer is public on the ICP
ledger already. An app top-up names the app (app balances are public, `get_app_balance`).

## Block format

As in the other Sneed logs: `Map { btype; ts; phash; tx }`. Inside `tx`: principals as `Blob`,
accounts as `Array [owner, subaccount?]`, ids, amounts (ICP e8s) and ledger block indexes as
`Nat`, flags as `Nat` 0 / 1. First field: `caller` (the calling principal), or `via` = `"timer"`
for what the canister's own timer did (fee checks, Sneed SMS delivery, lapsed relay leases) and
`via` = `"upgrade"` for what an upgrade did. No `cid`: the text log `get_log` holds only the log's
own spill and archive messages.

## Block type catalogue

Prefix `sneednotif_`; `icrc3_supported_block_types` reports every type with the url
`https://app.sneeddao.com/api/sneed_notifications#block-types` (public API doc, section 8.3).

| btype | appended by | tx fields |
|---|---|---|
| `sneednotif_top_up` | `top_up`, after the ledger accepted the ICRC-2 pull | `caller`, `amount_e8s`, `ledger_block` |
| `sneednotif_app_top_up` | `top_up_app`, likewise | `caller`, `app_id`, `amount_e8s`, `ledger_block`, `app_balance_e8s` (after) |
| `sneednotif_refund` | a paid delivery failed finally (`relay_ack`, `relay_pull` for a removed channel, the timer) and its price went back | `caller` (the relay) or `via`, `amount_e8s`, `paid_by` (`user` / `app`), `refunded_e8s` (total refunds after this one) |
| `sneednotif_fee_forward` | the ledger accepted a fee forward (the timer's check or `admin_forward_fees_now`; also a deduplicated retry) | `caller` or `via`, `amount_e8s` (received by the destination), `fee_e8s` (ledger fee), `to` (account), `ledger_block`, `forwards` (count after), `forwarded_e8s` (total after) |
| `sneednotif_fee_backlog` | the first fee check measured the books | `caller` or `via`, `balance_e8s` (ledger), `liabilities_e8s`, `free_e8s`, `backlog_e8s` |
| `sneednotif_fee_remeasure` | a fee check found less free ICP on the ledger than the books said, and measured again | `caller` or `via`, `books_e8s`, `balance_e8s`, `liabilities_e8s`, `free_e8s` |
| `sneednotif_app_register` | `register_app`, `admin_register_app` | `caller`, `app_id`, `name`, `owner`, `canisters` (Array of Blob), `topics` (Array of `Map { id; title; level }`), `verified` |
| `sneednotif_app_update` | `update_app`, when something changed | `caller`, the fields of `app_register` after the change (no `verified`), `changed` (Array of Text: `name`, `logo`, `description`, `canisters`, `topics`), and `old_name`, `old_canisters`, `old_topics` for those that changed. Logo and description texts are not logged |
| `sneednotif_app_verify` | `admin_set_app_verified`, when the flag changed | `caller`, `app_id`, `name`, `verified` |
| `sneednotif_app_remove` | `admin_remove_app` | `caller`, `app_id`, `name`, `owner`, `canisters` |
| `sneednotif_admin_add`, `sneednotif_admin_remove` | `admin_add_admin`, `admin_remove_admin`, when the list changed; the one-time bootstrap in `postupgrade` (`via` = `"upgrade"`) | `caller` or `via`, `principal` |
| `sneednotif_config_update` | a setting changed: one block per value | `caller`, `key`, `old_value`, `value` |

`sneednotif_config_update` keys: the `Config` fields from `admin_set_config` (`icp_ledger`,
`sneed_sms`, `sns_wasm` Blob; `prices_e8s` Map kind -> Nat; `notify_price_e8s`,
`dedupe_window_ns`, `retention_ns`, `default_daily_cap`, `default_daily_spend_cap_e8s`,
`max_title`, `max_body`, `relay_lease_ns`, `max_attempts` Nat; `relays` Array of `[Blob, kind]`);
`relay_key` with an extra `kind` field, the relay kind's public key document as Text (`none` when
removed; it is what clients encrypt to, public in `get_relay_keys`, and relays keep their private
keys); `fee_destination` (account or Text `none`), `fee_sweep_threshold_e8s`; the log settings
`icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`,
`icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`.

## Endpoints

```
icrc3_get_blocks, icrc3_get_archives, icrc3_get_tip_certificate, icrc3_supported_block_types,
icrc10_supported_standards, icrc3_log_status                                     (queries)
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers   (admins)
get_log(start, length)                                         (admin query: operational messages)
```

All additive Candid. The ingress guard refuses the queries as update calls and the three admin
methods from non-admins (`SMALL_ARG`). No automatic SNS registration of archives (as the forum):
an archive is registered by an ordinary `RegisterDappCanisters` proposal.

## Archives and cycles

- Archives are created with `archive_initial_cycles` (default 1.5 T, of which the subnet keeps the
  0.5 T creation fee) and are controlled by the canister and the Sneed SNS root
  `fp274-iaaaa-aaaaq-aacha-cai` (registration makes root the sole controller).
- `cycle_reserve` = 2 T: creating an archive needs 3.5 T in the canister, a top-up 2.5 T;
  otherwise the 15-minute spill check logs an error (`get_log`) and the live store keeps growing.
- Volume: a few blocks a day (top-ups, refunds, at most one forward a check), so with 2,000 live
  blocks the first archive is months away.

## Release

- Enhanced orthogonal persistence: the log's state (`icrc3`, `icrc3_textlog`) is new stable
  variables, so the upgrade starts an empty log. No stable type changes (`moc
  --stable-compatible` against the 5f62b7d5 build passes); Candid only adds methods.
- **The upgrade proposal must set `wasm_memory_persistence = keep`**; verify the module hash after.
- Production and staging run module hash `7dae6ac1…` (fee forwarding, proposal #448 (notifications
  fee forwarding)), which is `dfx +0.28.0 build --network ic sneed_notifications` of
  `src/sneed_notifications` at 5f62b7d5 (unchanged since 33b57966) at `/home/snassy/app_sneeddao`.
  The test suite builds that source as `sneed_notifications_preicrc3.wasm`, runs the log tests
  against it (they fail: no log) and upgrades from it with keep (apps, balances, admins and the fee
  books stay; the log starts empty).
- Production measured its fee backlog at the first check after #448, so no `fee_backlog` block
  will appear there; the first blocks will be top-ups, refunds and forwards.
- The bootstrap hook (d7zib on the admin list) is a no-op on production and staging (it is there);
  on a fresh install it adds the entry at the first upgrade and logs it with `via` = `"upgrade"`.
- Staging first; then update the public `.did` (frontend prebuild) and point
  `/tools/icrc3?canister=vuy7a-iaaaa-aaaay-aaduq-cai` at it.
