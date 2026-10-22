# Sneed Hub backend activity log (ICRC-3)

Design for a hash-chained, certified activity log in `app_sneeddao_backend` (production
`g7s5u-tqaaa-aaaad-qhktq-cai`, staging `7tsda-tiaaa-aaaad-aajxa-cai`), exposed through the
ICRC-3 block log interface, with archive canisters. Written 2026-10-22. The log uses the shared
library `src/icrc3` exactly as the forum does (enhanced orthogonal persistence; recipe:
`src/icrc3/README.md`; closest siblings [spec/forum_icrc3.md](forum_icrc3.md) and
[spec/sneed_premium_icrc3.md](sneed_premium_icrc3.md)). This document records what is specific
to the backend: what is logged and what deliberately is not, the block catalogue, where each
block is appended, and the release. It closes the backend gaps of
[spec/support_audit.md](support_audit.md) §2.6 (jailbreak payments without a ledger block,
unlogged admin changes, fee settings, `send_tokens`, `transfer_position`, `admin_clear_avatar`,
blacklist edits).

**Status (2026-10-22): implemented, not deployed.** Tests: `test/canisters/tests/backend-icrc3.test.js`.

## What the log is for

The backend is a public API (TACO DAO and Sneed Hub use it) and holds money for a moment: SNS
Jailbreak fees are paid from a deposit subaccount, unused deposits are withdrawn, and admins can
move tokens and ICPSwap positions the backend holds. Donations are listed on a public wall once
their ledger block is verified. Admins decide who else is an admin, what the directories show,
what is charged and to whom it goes. The log makes all of that checkable:

- **Money.** Every jailbreak payment (payer, amount, ledger fee, price tier, recipient account,
  ICP ledger block), every deposit withdrawal, every admin `send_tokens` and `transfer_position`
  that the ledger or pool accepted, every verified donation.
- **Moderation.** Bans (with the SHA-256 of the reason), unbans, avatars an admin removed.
- **Who holds power.** Additions to and removals from the admin list and the `*_for` callers.
- **Directories.** Partners and projects added, changed and removed.
- **Configuration.** Fees and their recipient, special prices, feedback settings, the donation
  account, the naming-service settings, the nickname and folder limits, the token whitelist by
  hand, the blacklist (as a count) and the log's own settings: old value and new.

## What is not logged, and why

- **Users' own data.** Settings, nicknames, names, avatars set by their owner, wallet
  registrations (tokens, swap pools, tracked canisters, folders, layout), last-seen log marks.
  They are per-user bookkeeping; nicknames and settings are private by intent.
- **Jailbreak configurations.** The SNS, neuron id and target principal of a configuration are
  the payer's own data (`get_my_jailbreak_configs` is caller-scoped); the payment block names
  only the payer, the amount, the tier, the recipient, the ledger block and the config and
  payment ids. Deleting one's configuration is not logged.
- **Texts.** No partner or project description, logo URL, ban reason or avatar appears in a
  block: they are logged as the SHA-256 of their UTF-8 bytes (`description_sha256`,
  `logo_url_sha256`, `reason_sha256`, `avatar_sha256`). Names, link titles and link URLs of
  partners and projects are logged as text (short, public). Donation messages are not logged
  at all (they are on the wall, and an admin may hide one).
- **Blacklisted words.** The list is admin-only so it cannot be dodged, and a hash of a single
  word is guessed in seconds. A change is logged as `blacklisted_words` with the count before
  and after, which names the admin and the moment without revealing the word.
- **Automatic token maintenance.** The daily import of ICPSwap's trusted list, metadata
  refreshes (`refresh_token_metadata`, `start_refresh_all_token_metadata`) and the shared token
  metadata cache: machine-made copies of public data, high volume. Only an admin's own
  `add_whitelisted_token` / `remove_whitelisted_token` is logged.
- **Legacy naming moderation.** `verify_*_name` / `unverify_*_name` act on the frozen legacy
  name tables (production has `get_names_frozen() = true`; names live in the naming service,
  which has its own log).
- **Refused calls and calls that change nothing** (adding an admin who is one, a setting to the
  value it has, an update that changes no field, removing what is not there, a transfer the
  ledger refused). "Log what happened, not what failed."
- **Reads**, including the update-call reads (`get_my_jailbreak_fee`, `get_canister_info`, ...).

There is no refund method in the backend: an unused deposit leaves only by
`withdraw_jailbreak_payment`, logged as `sneedbackend_deposit_withdraw`.

## Block format

As in the other Sneed logs: `Map { btype; ts; phash; tx }`. Inside `tx`: principals as `Blob`,
ICRC-1 accounts as `Array [owner, subaccount?]`, ids, amounts, durations and ledger block
indexes as `Nat` (times as `Int` ns), flags as `Nat` 0 / 1; `caller` (the calling principal)
first; optional fields omitted when absent. A value that is not set is the Text `none`. No
`cid`: the backend's business calls have no text log to correlate with (the text log `get_log`
holds only the log's own spill and archive messages, and is public).

## Block type catalogue

Prefix `sneedbackend_`; `icrc3_supported_block_types` reports every type with the url
`https://app.sneeddao.com/api/app_sneeddao_backend#block-types` (public API doc, section 7.3,
where the fields are listed).

| btype | appended by | tx fields |
|---|---|---|
| `sneedbackend_jailbreak_payment` | `save_jailbreak_config`, when the fee transfer returned `Ok` | `caller` (payer), `payment_id`, `config_id`, `amount_e8s`, `fee_e8s`, `price_tier` (`regular`, `premium`, `admin`, `partner`), `to` (recipient account), `icp_tx` |
| `sneedbackend_deposit_withdraw` | `withdraw_jailbreak_payment`, on the transfer's `Ok` | `caller`, `amount_e8s`, `fee_e8s`, `to`, `icp_tx` |
| `sneedbackend_send_tokens` | `send_tokens` (admin), on `Ok` | `caller`, `ledger`, `from_subaccount`, `to`, `amount`, `ledger_tx` |
| `sneedbackend_transfer_position` | `transfer_position` (admin), on `ok` | `caller`, `swap_canister`, `to`, `position_id` |
| `sneedbackend_donation` | `register_donation`, once the ledger block is verified | `caller` (donor), `donation_id`, `ledger`, `amount`, `ledger_block`, `from`, `to` |
| `sneedbackend_donation_hidden` | `admin_set_donation_hidden`, when the flag changed | `caller`, `donation_id`, `hidden` |
| `sneedbackend_ban` | `ban_user`, and the automatic bans of `names_moderate` and the legacy name setters (`caller` is then the backend itself) | `caller`, `user`, `duration_hours`, `expires_at` (the ban's end after this ban), `reason_sha256` |
| `sneedbackend_unban` | `unban_user` of a banned user | `caller`, `user` |
| `sneedbackend_avatar_clear` | `admin_clear_avatar` of an existing avatar | `caller`, `principal`, `avatar_sha256` |
| `sneedbackend_admin_add`, `sneedbackend_admin_remove` | `add_admin`, `remove_admin`, when the list changed | `caller`, `principal` |
| `sneedbackend_partner_add`, `_update`, `_remove` | `add_partner`, `update_partner` (when a field changed), `remove_partner` | `caller`, `id`, `value` and / or `old_value`: `Map { name; logo_url_sha256; description_sha256; links; index? }` |
| `sneedbackend_project_add`, `_update`, `_remove` | the project methods, likewise | `caller`, `id`, `value` / `old_value`: `Map { name; project_type; description_sha256; links; logo_url_sha256?; index? }` |
| `sneedbackend_config_update` | a setting changed | `caller`, `key`, `value`; `old_value` when there was one; extra fields per key below |

`sneedbackend_config_update` keys:

- `jailbreak_fee_premium_e8s`, `jailbreak_fee_regular_e8s` (Nat); `jailbreak_fee_recipient`
  (account, or `none`: the backend's default account keeps the fees), from
  `set_jailbreak_fee_settings`. A subaccount change while no owner is set changes no recipient
  and is not logged.
- `admin_prices` (Map of the set overrides, e.g. `{ jailbreak_fee_e8s }`) from
  `set_admin_prices`; `partner_prices` with an extra `partner` (Blob) field, value
  `{ label; prices; expires_at? }` or the Text `removed`, `old_value` the previous entry when
  there was one, from `set_partner_prices` / `remove_partner_prices` (as in Sneed Premium).
- `feedback_recipients` (Array of Blob), `feedback_bug_topic`, `feedback_idea_topic` (Nat or
  `none`) from `admin_set_feedback_config`; `donation_account` (account or `none`).
- `names_canisters` (Array of Blob), `names_frozen` (0 / 1); `sneed_premium_canister_id`
  (Blob or `none`, from `set_nickname_premium_canister`).
- `max_neuron_nicknames`, `max_principal_nicknames`, `premium_max_neuron_nicknames`,
  `premium_max_principal_nicknames`, `max_canister_groups`, `max_canisters_per_group`,
  `max_total_grouped_canisters`, `premium_max_canister_groups`,
  `premium_max_canisters_per_group`, `premium_max_total_grouped_canisters` (Nat).
- `whitelisted_token` with an extra `ledger` (Blob) field, value
  `{ symbol; name; decimals; fee; standard }` or the Text `removed`, `old_value` the previous
  entry (from `add_whitelisted_token` / `remove_whitelisted_token`).
- `authorized_for_caller_added`, `authorized_for_caller_removed` (value Blob, no `old_value`).
- `blacklisted_words` (the number of words, before and after).
- the log's own settings `icrc3_max_live_blocks`, `icrc3_spill_batch_size`,
  `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`,
  `icrc3_archive_top_up_amount`.

Every block is appended in the message that commits the change, after the state was written
(or, for transfers, after the ledger answered `Ok` and before the next await), comparing with
the state read just before it, so no interleaving call can be attributed wrongly.

## Endpoints

```
icrc3_get_blocks, icrc3_get_archives, icrc3_get_tip_certificate, icrc3_supported_block_types,
icrc10_supported_standards, icrc3_log_status                                     (queries)
get_log(start, length)                       (public query: the log's operational messages)
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers   (admins)
```

All additive Candid. The ingress guard refuses the queries as update calls and the three admin
methods from non-admins or with an argument over `SMALL_ARG`; every existing method keeps its
previous check. No SNS registration through a hotkeyed neuron: archives are registered by an
ordinary `RegisterDappCanisters` proposal, as for the forum.

## Archives and cycles

- Archives are created by the backend with `archive_initial_cycles` (default 1.5 T, of which the
  subnet keeps the 0.5 T creation fee) and are controlled by the backend and the Sneed SNS root
  `fp274-iaaaa-aaaaq-aacha-cai`. Registering an archive with the SNS makes root the sole
  controller.
- `cycle_reserve` = 2 T: the backend never spends below it. Creating an archive needs 3.5 T in
  the backend, a top-up 2.5 T; otherwise the spill check logs an error every 15 minutes (public
  `get_log`) and the live store keeps growing on the heap.
- With the default 2,000 live blocks and this catalogue (payments, donations, admin acts), the
  first archive is months away.

## Release

- Enhanced orthogonal persistence: the log's state (`icrc3`, `icrc3_textlog`) is new stable
  variables, so the upgrade starts an empty log. No existing stable variable changes type
  (`moc --stable-compatible` against the production build's `.most` passes); the Candid is a
  subtype of production's (`didc check`).
- **The upgrade proposal must set `wasm_memory_persistence = keep`**; without it the upgrade of
  an EOP canister fails (on an SNS, silently). Verify the module hash afterwards.
- Production runs `cd8d6d3e` (special prices, proposal #453; module hash `91d76948…`, reproduced
  by `dfx +0.28.0 build --network ic app_sneeddao_backend` at `/home/snassy/app_sneeddao`; HEAD's
  backend source was identical until this change). The test suite builds that source as
  `app_sneeddao_backend_prod.wasm` and upgrades from it with keep.
- The release wasm is 1,997,695 bytes (515,532 gzipped), just under 2 MB; gzip it (`gzip -n -9`) for the proposal
  to stay clear of the limit.
- Staging first; then update the public `.did` (frontend prebuild) and point
  `/tools/icrc3?canister=g7s5u-tqaaa-aaaad-qhktq-cai` at it.
