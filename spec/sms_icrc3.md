# Sneed SMS activity log (ICRC-3)

Design for a hash-chained, certified activity log in the `sneed_sms` canister (production
`zelpl-7yaaa-aaaad-abtcq-cai`, staging `v33jy-4qaaa-aaaad-absna-cai`), exposed through the ICRC-3
block log interface, with archive canisters. Written 2026-10-22. The log uses the shared library
`src/icrc3` as the forum does (enhanced orthogonal persistence; recipe: `src/icrc3/README.md`;
the forum's design: `spec/forum_icrc3.md`). This document records what is specific to Sneed SMS:
what is logged, what deliberately is not, the block catalogue and the release.

**Status (2026-10-22): implemented, not deployed.** Tests: `test/canisters/tests/sms-icrc3.test.js`.

## What the log is for

Sneed SMS is a public API (TACO DAO uses it) whose messages are private: readable by their
sender and recipients, and by the canister's admins. That last point is the reason for the log.
Admins can read every message, authorised canisters can write to anyone without a rate limit and
under a sender of the admins' choosing, and the limits decide who can say how much. None of that
is visible in the state's history. The log records exactly these acts of power:

- **Who holds power.** Additions to and removals from the admin list (also through
  `import_admins`).
- **Who may write as the system.** The authorised system senders (added, removed) and the system
  sender principal shown on their messages.
- **Configuration.** The plain limits, the premium canister and premium limits, the
  notifications canister, the log's own settings.
- **Data imports.** `import_messages` by a controller: how many messages, never which.

## What is not logged, and why

- **Messages, in any form.** No subject, no text, no hash of either, no sender, no recipient, no
  message id of a person-to-person message. A block is public and permanent; a hash of a short
  private text can be confirmed by guessing, and who wrote to whom when is itself private. This
  covers `send_message`, `send_system_notification`, `remove_self_from_message` (also when it
  deletes the message) and `import_messages` beyond its count.
- **What users do with their own account.** Read marks (`mark_messages_seen_up_to`), the preview
  switch (`set_notification_preview`), the premium membership cache.
- **Moderation.** There is none to log: admins can read every message (`get_all_messages_admin`)
  but no method lets anyone delete, edit or block another person's message or account. Reading is
  a query and cannot be logged. Should moderation ever be added, its blocks must carry the message
  id and the reason, never the content or the parties.
- **Preview defaults.** The preview is on unless a recipient turns it off; the default is fixed
  in the code, not a setting, so there is nothing to log.
- **The upgrade-time data repair** (`mark_legacy_removed_senders`): it runs in `postupgrade`, with
  no caller, and touches message records only.
- **Refused calls and calls that change nothing** (adding an existing admin or sender, setting a
  value it already has, an import that stored nothing).

## Block format

As in the other Sneed logs: `Map { btype; ts; phash; tx }`. Inside `tx`: principals as `Blob`,
numbers as `Nat`; `caller` (the calling principal) first; optional fields omitted when absent; a
principal setting that is unset is the Text `none` in `config_update` values. No `cid`: there is
no business text log to correlate with (the text log `get_log` holds only the log's own spill and
archive messages).

## Block type catalogue

Prefix `sneedsms_`; `icrc3_supported_block_types` reports every type with the url
`https://app.sneeddao.com/api/sneed_sms#block-types` (public API doc, section 7.3, where the
fields are listed).

| btype | appended by | tx |
|---|---|---|
| `sneedsms_admin_add` | `add_admin`; `import_admins` for each admin it adds (`source` = `import_admins`) | `caller`, `principal`, `source` |
| `sneedsms_admin_remove` | `remove_admin` | `caller`, `principal` |
| `sneedsms_authorized_sender_add` | `add_authorized_sender` | `caller`, `principal` |
| `sneedsms_authorized_sender_remove` | `remove_authorized_sender` | `caller`, `principal` |
| `sneedsms_config_update` | `update_config`, `update_premium_config`, `set_system_sender_principal`, `admin_set_notifications`, `admin_set_icrc3_settings`: one block per setting that changed | `caller`, `key`, `old_value`, `value` |
| `sneedsms_messages_import` | `import_messages`, when it stored at least one message | `caller`, `count`, `next_id` |

Keys of `sneedsms_config_update`: `rate_limit_minutes`, `max_subject_length`, `max_body_length`,
`max_recipients`, `sneed_premium_canister_id`, `premium_max_subject_length`,
`premium_max_body_length`, `premium_rate_limit_minutes`, `premium_max_recipients`,
`system_sender_principal`, `notifications_canister`, and `icrc3_max_live_blocks`,
`icrc3_spill_batch_size`, `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`,
`icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`.

Every block is appended in `main.mo` in the same message that commits the change, after it was
made, comparing with the value read just before. None of these methods awaits, so no other call
can interleave.

## Endpoints

```
icrc3_get_blocks, icrc3_get_archives, icrc3_get_tip_certificate, icrc3_supported_block_types,
icrc10_supported_standards, icrc3_log_status                                     (queries)
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers   (admins)
get_log(start, length)                                         (admin query: operational messages)
```

All are additive Candid (`didc check` of the new interface against production's passes). The
ingress guard refuses the queries as update calls and the three admin methods from non-admins;
every existing method keeps its previous check. No SNS registration through a hotkeyed neuron:
archives are registered by an ordinary `RegisterDappCanisters` proposal.

## Archives and cycles

- Archives are created by Sneed SMS with `archive_initial_cycles` (default 1.5 T, of which the
  subnet keeps the 0.5 T creation fee) and are controlled by Sneed SMS and the Sneed SNS root
  `fp274-iaaaa-aaaaq-aacha-cai` (hard-coded; on staging the root is a co-controller too,
  harmless). Registering an archive with the SNS makes root the sole controller.
- `cycle_reserve` = 2 T: the canister never spends below it. Creating an archive needs 3.5 T, a
  top-up 2.5 T; otherwise the spill check logs an error every 15 minutes and the live store keeps
  growing on the heap. With the default 2,000 live blocks and a catalogue of rare admin acts, the
  first archive is years away.
- The 15-minute spill check is a timer started on install and after every upgrade; it is cheap
  when there is nothing to spill.

## Release

- Enhanced orthogonal persistence: the log's state (`icrc3`, `icrc3_textlog`) is new stable
  variables, so the upgrade starts an empty log. No stable type changes (`moc
  --stable-compatible` against the production build's `.most` passes); Candid is a subtype of
  production's. The wasm grows from 540 KB to about 1.27 MB (the library and the archive class).
- **The upgrade proposal must set `wasm_memory_persistence = keep`**; without it the upgrade of
  an EOP canister fails (on an SNS, silently). Verify the module hash afterwards.
- Production runs `e832eeac` (module hash `de51e8a5…`, reproduced by `dfx +0.28.0 build
  --network ic sneed_sms` at `/home/snassy/app_sneeddao`; src/sneed_sms and its imports are
  unchanged from there to `5f62b7d5`). The test suite builds that source as
  `sneed_sms_prod.wasm` and upgrades from it with keep: every message, mailbox, setting, admin,
  authorised sender, read mark and preview switch stays, and the log starts empty.
- The same release fixes the notification preview, which cut links in half (seen live as
  `…https://app.sneeddao.com/post?…`): `clip` now cuts at the last whitespace before 100
  characters and drops a cut token holding `http://` or `https://` whole
  (`tests/sms-notifications.test.js`, which fails against `sneed_sms_prod`).
- Staging first; then the public `.did` is regenerated by the frontend prebuild; point
  `/tools/icrc3?canister=zelpl-7yaaa-aaaad-abtcq-cai` at it.
