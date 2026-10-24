/// The text get_api_doc returns: a short guide for agents (full reference in public/api-docs/sneed_sns_forum.md).
module {
  public let text : Text = "# Sneed Forum (canister sneed_sns_forum)

The discussion canister behind the forum on Sneed Hub, also used by other DAOs (TACO DAO). One forum per SNS: topics (nested), threads, posts and replies, polls, tips, @-mentions and read state. Votes on posts and polls are cast with the SNS neurons the caller can reach, weighted by voting power. Calls are authorised by the calling principal only, so any client can post, vote and tip on the same terms as Sneed Hub.

- Production: `mcigm-4aaaa-aaaad-qhlkq-cai` (controlled by the Sneed SNS; upgrades by DAO proposal)
- Staging: `nrtf2-wiaaa-aaaad-aankq-cai` (separate state, same code line; use it to test)

## Units and encoding
- Forums, topics, threads, posts, polls and tips share ONE id counter (`nat`): higher id = newer. `get_current_counter()` is the next id.
- Timestamps (`created_at`, `end_timestamp`, seen marks) are `int` nanoseconds since the Unix epoch.
- Tip amounts are base units of the token's ledger (`nat`); voting power is in the SNS's e8s-scale units.
- Updates return `variant { ok : nat; err : ForumError }` (or `ok` without a value); `ForumError = variant { NotFound; Unauthorized; InvalidInput; AlreadyExists; InternalError }`, each with text for people. Branch on the tag.
- Lengths count characters against `get_text_limits()` (production limits are lower than the code defaults; Sneed Premium members get longer bodies, `get_premium_config()`).
- Neuron ids are `record { id : blob }`, the SNS governance neuron id.

## Authentication
- Writing (threads, posts, votes, polls, tips, read marks) is a signed update; the anonymous principal is refused.
- Everything is public: every post, vote (with neuron id), poll vote, tip, mention and read mark is readable by anyone with the principal that made it. Nothing is anonymous; deletion only hides (`deleted` flag).
- Votes use the caller's reachable neurons in the forum's SNS (neurons listing the caller, plus their owners' other neurons). No neuron is needed to post.
- Admins: Sneed governance, the controllers and `get_admins()`; they manage forums and topics and see deleted items through the `*_admin` queries.

## Fees, transfers and irreversible actions
- The forum charges nothing and never moves tokens.
- **Tips move real tokens and cannot be undone.** A tip is two steps: (1) the tipper's wallet sends an ordinary ICRC-1 transfer (`icrc1_transfer`, no subaccount on either side) of exactly `amount` to the post author's main account; (2) `create_tip(to_principal = post author, post_id, token_ledger_principal, amount, opt block_index)`.
- The forum reads that block on the token's ledger once (ICRC-3 `icrc3_get_blocks`, else `get_transactions`; ICP: `query_blocks`, following archives) and records the tip only if it is a plain transfer of that amount from the caller to the author. A contradicting block, a mint/burn/approval, a block another tip already used, or a recipient other than the post's author is refused (`InvalidInput` / `AlreadyExists`): the tokens were still sent. A block that cannot be read (no index given, ledger did not answer) is recorded unverified; `verify_tip(tip_id)` retries.
- `TipResponse.verified`: `?true` confirmed on the ledger, `?false` not confirmed (`verification_note` says why), null recorded before the forum checked tips. Only verified tips notify the author and count in `get_tip_stats`, `get_tip_tokens_received_by_user` and the recent-tips counters. \"Verified\" means the token's own ledger records the transfer, not that the token has value.
- Posting and editing are public and permanent (edits replace title and body; deletion only hides).

## Asynchronous lifecycle and polling
- Every write is one update returning its result; nothing to poll afterwards.
- Voting and posting may wait on SNS governance; tips on the ledger.
- For new activity poll the cheap queries `get_current_counter()`, `get_recent_replies_count(me)`, `get_recent_tips_count(me)`, `get_recent_mentions_count(me)`; move marks with `mark_*_seen_up_to(ns)`.
- `get_feed` walks ids downwards; it may return fewer items than asked (even none) with `has_more = true`: keep paging with `next_start_id` until `has_more` is false. A page holds at most 500 items and about 1.5 MB (always at least one item), and stops early on long text searches.
- A user's posts, threads, replies to them and tips page with `get_posts_by_user_page`, `get_threads_by_user_page`, `get_replies_to_user_page`, `get_tips_given_by_user_page`, `get_tips_received_by_user_page` `(user, before, limit)`: newest first, at most 100 items and about 1.5 MB a page; pass the page's `next` as `before` until it is null. The unpaged `get_*_by_user` lists can outgrow a reply for a busy user.

## Errors, retries and Busy
- `create_thread`, `create_post`, `create_poll` and `create_tip` are NOT idempotent. After a timeout, look for the item (`get_posts_by_user`, `get_tips_given_by_user`, `get_polls_by_thread`) before retrying. Never repeat the token transfer of a tip: retry only `create_tip` with the same block index (a used block answers `AlreadyExists` naming the tip).
- `InternalError` from SNS calls (voting) wrote nothing and is safe to retry.
- Votes, retractions, read marks and seen marks are idempotent.
- Writing is rate limited per caller (`get_rate_limits()`; defaults: threads 10 in a row then 2 a minute, posts and edits 10 then 4 a minute, polls 5 then 1, tips 10 then 3, votes 30 then 10, reactions 30 then 20). Over the limit a call is refused at ingress, or answers `InvalidInput(\"Rate limited: ...\")` (calls from canisters): wait a minute and retry. Admins, the SNS canisters the forum knows and the principals on `get_rate_limit_exempt()` are not limited: an integrator whose canister or bot writes in bursts asks Sneed DAO to be put on that list (`admin_set_rate_limit_exempt`). Admins change the limits with `admin_set_rate_limit`.

## Reactions, thread votes and thread tips
- `react(target, emoji, on)`, `set_reactions(target, emojis)`; `target = variant { post; thread }`; up to 10 single emojis each. Read: `get_reactions`, `get_reactions_of_user` (200 targets).
- A thread's own text has votes (`vote_on_thread*`, `get_thread_scores`) and tips (`create_thread_tip`, `get_tips_on_thread_page`) apart from its posts'.

## Common pitfalls
- Query methods sent as update calls are refused by the ingress guard (`inspect`); call them as queries.
- Arguments are capped at ingress: texts by the text limits, 1,000 neuron ids, 100 poll options, 4 KiB otherwise.
- Unread counts and read marks use the caller: sign those queries.
- Build reply trees from `reply_to_post_id`; `get_posts_by_thread` is flat.
- Posting in a forum whose SNS is not in SNS-W fails with `InternalError(\"No SNS governance canister found\")`.
- Mentions are Markdown links `[@Name](https://app.sneeddao.com/principal?id=<principal>)`; plain `@name` is ignored.

## Activity log (ICRC-3)
- Verified tips (with the ledger block; post and thread tips), moderation (admin deletes, undeletes and edits of others' content: ids and SHA-256 of texts), admin and config changes, forums and topics created or changed, and proposal threads are blocks of a certified, hash-chained ICRC-3 log: `icrc3_get_blocks`, `icrc3_get_archives`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`, `icrc3_log_status` (queries). Block types (`sneedforum_*`): https://app.sneeddao.com/api/sneed_sns_forum#block-types
- Ordinary threads, posts, votes, reactions and polls are not logged (public already). Old blocks move to archives co-controlled by the Sneed SNS root.

## Start with these methods
`get_forum_by_sns_root`, `get_topics_by_forum`, `get_threads_by_activity`, `get_threads_by_hot`, `get_posts_by_thread`, `get_text_limits`, `create_thread`, `create_post`, `vote_on_post`, `create_tip`, `get_tips_by_post`, `get_feed`.

## Full reference
- https://app.sneeddao.com/api-docs/sneed_sns_forum.md
- Candid: https://app.sneeddao.com/api-docs/sneed_sns_forum.did
- All Sneed APIs: https://app.sneeddao.com/llms.txt
";
};
