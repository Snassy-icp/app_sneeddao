# Sneed forum activity log (ICRC-3)

Design for a hash-chained, certified activity log in the `sneed_sns_forum` canister
(production `mcigm-4aaaa-aaaad-qhlkq-cai`, staging `nrtf2-wiaaa-aaaad-aankq-cai`), exposed
through the ICRC-3 block log interface, with archive canisters. Written 2026-10-21. The log uses
the shared library `src/icrc3` as `sneed_pid_names` and `sneed_profiles` do (enhanced orthogonal
persistence; recipe: `src/icrc3/README.md`). This document records what is specific to the
forum: what is logged and what deliberately is not, the block catalogue, where each block is
appended, and the release.

**Status (2026-10-21): implemented, not deployed.** Tests: `test/canisters/tests/forum-icrc3.test.js`.

## What the log is for

The forum is a public API that other dapps read and write (TACO DAO uses it as its site). Its
content is public already: every thread, post, vote and tip record can be read with the
principal that made it. What a reader cannot see from the current state is *who did what to
whose content, and when*, and whether the record of money that changed hands is complete. The
log covers exactly that:

- **Tips confirmed on the ledger.** Tips move real tokens; a tip's block names the ledger block
  that backs it, so a tip history can be checked against the token's own ledger.
- **Moderation.** Admins can delete, restore and edit anyone's content. Each such act is a
  block naming the moderator, the author and the item.
- **Who holds power.** Additions to and removals from the admin list.
- **Configuration.** Text limits, the premium settings, the notifications canister, the log's
  own settings.
- **Structure.** Forums and topics created, changed, deleted and restored, a forum's proposals
  topic, and proposal discussion threads (they tie an SNS proposal to the place it is
  discussed).

## What is not logged, and why

- **Ordinary threads, posts and replies.** They are the bulk of all calls (one block per post
  would make the log mostly a copy of the content), they are public in the canister already,
  each carries its author and creation time, and the shared id counter orders them. Logging
  them adds no accountability that the state does not give.
- **Votes on posts, polls and poll votes.** High volume, public per neuron (`get_post_votes`,
  `get_poll_votes`), and re-votes and retractions would add more blocks than there are votes.
- **An author's edits and deletions of their own content.** Deleting your own post is a
  retraction, not moderation: it is the author's decision about their own words, recorded on
  the post already (`deleted`, `updated_by`, `updated_at`), and the text stays in the canister
  (deletion only hides it). Putting a hash of every self-retracted text into an append-only log
  forever would work against the author's ability to retract, for no gain in accountability:
  nobody else acted. The same holds for edits of one's own posts. What *is* logged is any delete
  or edit by someone other than the author, which only admins can do. Undeletes are admin-only
  and always logged.
- **Texts.** No post or thread title or body appears in any block: they are public in the
  canister anyway and would bloat the log. Moderation blocks carry the SHA-256 of the UTF-8
  bytes of the body and title instead (on edits: before and after). That is 32 bytes per text
  and pins *which* text was moderated: anyone holding a copy (a screenshot's text, an archived
  page, the author's own draft) can prove that it is the text an admin removed or replaced, and
  an admin cannot later claim a different text was removed. Forum and topic titles are logged as
  text: they are short, structural and public.
- **Unverified tips.** A tip whose ledger block could not be read is recorded but counts
  nowhere (stats, totals, notifications). It is logged when `verify_tip` settles it, as
  `tip_verified` or `tip_rejected`. Tips refused outright by `create_tip` (wrong amount, used
  block, not the author) are not recorded at all, and not logged: "log what happened, not what
  failed".
- **Mentions, read marks, seen marks, mention-SMS settings.** Per-user bookkeeping.
- **Refused calls and calls that change nothing** (deleting what is deleted, setting a value it
  already has, re-running the SNS setup).

There is no ban feature in the forum, so there is nothing to log for bans.

## Block format

As in the other Sneed logs: `Map { btype; ts; phash; tx }`. Inside `tx`: principals as `Blob`,
ids, amounts and ledger block indexes as `Nat`; `caller` (the calling principal) first;
optional fields omitted when absent. No `cid`: the forum's business calls have no text log to
correlate with (the text log `get_log` holds only the log's own spill and archive messages).

## Block type catalogue

Prefix `sneedforum_`; `icrc3_supported_block_types` reports every type with the url
`https://app.sneeddao.com/api/sneed_sns_forum#block-types` (public API doc, section 8.3, where
the fields are listed).

| btype | appended by |
|---|---|
| `sneedforum_tip` | `create_tip`, when the ledger confirmed the transfer |
| `sneedforum_tip_verified` | `verify_tip`, when it confirms a tip recorded unverified (or before tips were checked) |
| `sneedforum_tip_rejected` | `verify_tip`, when it rejects a tip (contradicting block, block used by another tip, recipient not the post's author); final |
| `sneedforum_delete` | `delete_forum`, `delete_topic`; `delete_thread`, `delete_post` when the caller is not the author; only when the item was not deleted |
| `sneedforum_undelete` | `undelete_*`, only when the item was deleted |
| `sneedforum_edit` | `update_thread`, `update_post` by someone other than the author |
| `sneedforum_forum_create` | `create_forum`, and the SNS setup (`create_sns_forum_setup`, `create_proposal_thread_with_auto_setup`) through lib.mo's `create_forum_internal` |
| `sneedforum_forum_update` | `update_forum` |
| `sneedforum_topic_create` | `create_topic`, `create_special_topic`, the SNS setup (through `create_topic_internal`) |
| `sneedforum_topic_update` | `update_topic` |
| `sneedforum_proposals_topic_set` | `set_proposals_topic`, the SNS setup; only when the topic changed |
| `sneedforum_proposals_topic_remove` | `remove_proposals_topic` |
| `sneedforum_proposal_thread_create` | `create_proposal_thread`, `create_proposal_thread_with_auto_setup` |
| `sneedforum_admin_add`, `sneedforum_admin_remove` | `add_admin`, `remove_admin` |
| `sneedforum_config_update` | `update_text_limits`, `update_premium_config`, `admin_set_notifications`, `admin_set_icrc3_settings`: one block per setting that changed, with `key`, `old_value`, `value` |

Structure created inside `lib.mo` (forums and topics made by the SNS setup and special topics)
is logged where it is committed, through a `log` callback in the transient `ForumState`
(`T.ForumState.log`), so the block names the real caller and no interleaving call can be
attributed wrongly. Everything else is appended in `main.mo` after the `lib.mo` call returned
`#ok`, comparing with the state read just before it.

## Endpoints

```
icrc3_get_blocks, icrc3_get_archives, icrc3_get_tip_certificate, icrc3_supported_block_types,
icrc10_supported_standards, icrc3_log_status                                     (queries)
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers   (admins)
get_log(start, length)                                         (admin query: operational messages)
```

All are additive Candid. The ingress guard refuses the queries as update calls and the three
admin methods from non-admins (the guard now reads `caller`; every existing method keeps its
previous check). No SNS registration through a hotkeyed neuron (`SnsRegister.mo`): neither
`sneed_pid_names` nor `sneed_profiles` uses it; archives are registered by an ordinary
`RegisterDappCanisters` proposal.

## Archives and cycles

- Archives are created by the forum with `archive_initial_cycles` (default 1.5 T, of which the
  subnet keeps the 0.5 T creation fee) and are controlled by the forum and the Sneed SNS root
  `fp274-iaaaa-aaaaq-aacha-cai` (hard-coded: production is a Sneed SNS canister; on staging
  the root is a co-controller too, harmless). Registering an archive with the SNS makes root
  the sole controller.
- `cycle_reserve` = 2 T: the forum never spends below it. Creating an archive needs 3.5 T in
  the forum, a top-up 2.5 T; otherwise the spill check logs an error every 15 minutes and the
  live store keeps growing on the heap. Keep the forum above that in ic-unicycle.
- With the default 2,000 live blocks and the low volume of this catalogue (tips, moderation
  and admin acts), the first archive is months away.

## Release

- Enhanced orthogonal persistence: the log's state (`icrc3`, `icrc3_textlog`) is new stable
  variables, so the upgrade starts an empty log. No stable type changes (`moc
  --stable-compatible` against the production build passes); Candid is a subtype of
  production's.
- **The upgrade proposal must set `wasm_memory_persistence = keep`**; without it the upgrade of
  an EOP canister fails (on an SNS, silently). Verify the module hash afterwards.
- Production and staging run `b483932c` (upgrade #423, module hash `89d0f0e7…`, reproduced by
  `dfx build --network ic sneed_sns_forum` at `/home/snassy/app_sneeddao`). The test suite
  builds that source as `sneed_sns_forum_prod.wasm` and upgrades from it with keep.
- Staging first; then update the public `.did` (frontend prebuild) and point
  `/tools/icrc3?canister=mcigm-4aaaa-aaaad-qhlkq-cai` at it.
