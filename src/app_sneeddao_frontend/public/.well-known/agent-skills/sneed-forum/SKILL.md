---
name: sneed-forum
description: Read and write the Sneed SNS forum on the Internet Computer (mcigm-4aaaa-aaaad-qhlkq-cai), the discussion board behind Sneed Hub's /forum pages. One forum per SNS DAO, with topics, threads, posts and replies, neuron-weighted up/down votes, neuron-weighted polls, token tips checked on the ledger, @-mentions, proposal discussion threads and an activity feed. Use when a user or developer wants to read or post in an SNS forum, vote on posts with SNS neurons, tip a post, find where someone was mentioned, or link a governance proposal to its discussion.
license: MIT
metadata:
  publisher: Sneed DAO
  canister: mcigm-4aaaa-aaaad-qhlkq-cai
  staging-canister: nrtf2-wiaaa-aaaad-aankq-cai
  full-reference: https://app.sneeddao.com/api-docs/sneed_sns_forum.md
  source: https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_sns_forum/main.mo
---

# Sneed SNS forum integration skill

The forum canister stores every forum, topic, thread, post, vote, poll and tip record of Sneed Hub's forum. Read the full reference at https://app.sneeddao.com/api-docs/sneed_sns_forum.md for every method and type. Production `mcigm-4aaaa-aaaad-qhlkq-cai`, staging `nrtf2-wiaaa-aaaad-aankq-cai` (same code, separate state).

**Everything is public and signed.** Every thread, post, vote, poll vote and tip record carries the author's principal (`created_by`, `voter_principal`, `from_principal`) and can be read by anyone. There is no anonymous posting; anonymous callers are refused for writes. Tell users this before they post.

## Core facts to keep straight

1. **Hierarchy.** Forum (one per SNS, `sns_root_canister_id`) → topics (may nest: `parent_topic_id`) → threads (`title` optional, `body`) → posts (`reply_to_post_id` makes a reply tree). Ids are `nat` from one shared counter, so a thread id and a post id never collide.
2. **Who may create what.** Forums and topics: forum admins only (`create_forum`, `create_topic`). Any logged-in principal can call `create_sns_forum_setup(sns_root)` (creates, where missing, the forum of an SNS known to SNS-W, its Governance topic and the Proposals subtopic under it; returns the Proposals topic id) and `create_special_topic({sns_root_canister_id; special_topic_type = General | Governance | Preproposals})`. Threads and posts: any non-anonymous principal; no neuron is needed to post. A post's thread must belong to a forum linked to an SNS (else `No SNS governance canister found`).
3. **Editing and deleting.** `update_thread` / `update_post`: the author or an admin. `delete_post`: the author or an admin. Deleting forums, topics and threads is admin only. Deletes are soft (`deleted = true`, hidden from normal queries; admins can `undelete_*`).
4. **Votes are per neuron.** `vote_on_post(post_id, variant {upvote} | {downvote})` asks the SNS governance canister for every neuron the caller can reach (controller or hotkey) and records one vote per neuron with its voting power at that moment. `vote_on_post_with_neurons(post_id, vote, [ {id = blob} ])` limits it to the given neurons. Re-voting replaces a neuron's vote; `retract_vote` / `retract_vote_with_neurons` remove them. No reachable neuron → `Unauthorized("No accessible neurons found")`. Post scores: `upvote_score`, `downvote_score` (summed voting power, base units).
5. **Polls.** `create_poll({thread_id; post_id = opt id | null; title; body; options (≥ 2); end_timestamp (ns, future); vp_power = opt float (default 1.0; 0 = one neuron one vote, 0.5 = square root, …); allow_vote_changes = opt bool (default true)})`. Only the thread's (or post's) author can attach a poll, one per thread and one per post. Vote with `vote_on_poll_with_neurons(poll_id, option_id, neuron_ids)` before `end_timestamp`.
6. **Tips: transfer first, then record; the forum checks the block.** The tipper sends tokens with the token ledger's own `icrc1_transfer` from their main account (`from_subaccount = null`) to the post author's main account `{owner = author; subaccount = null}`, then calls `create_tip(to = author, post_id, ledger, amount, opt block_index)`. The forum reads that block on the ledger once (ICRC-3 `icrc3_get_blocks`, else `get_transactions`; ICP `query_blocks`; archives followed) and records the tip only if it is a plain transfer of exactly `amount` from the caller to the author. Refused (`InvalidInput` / `AlreadyExists`, nothing recorded): another sender, recipient or amount, a mint, burn or approval, a block another tip already used, a `to` who is not the post's author. A block that could not be read (no index, ledger did not answer) is recorded unverified; anyone may retry with `verify_tip(tip_id)`. `TipResponse.verified`: `?true` confirmed, `?false` not confirmed (`verification_note`), `null` recorded before the forum checked tips. Only verified tips notify and count in `get_tip_stats`, `get_tip_tokens_received_by_user` and the recent-tips counters. **A transfer cannot be undone**: if `create_tip` fails, the tokens were still sent; retry only `create_tip`, never the transfer. "Verified" means the token's own ledger records it, not that the token has value.
7. **Mentions.** A mention is a Markdown link whose text starts with `@` and whose target is a Sneed Hub principal page: `[@Name](https://app.sneeddao.com/principal?id=<principal>)`. At most 10 per thread or post are recorded; the principal, not the name, is who is meant. Users opt in to an SMS on mention with `set_mention_sms(true)` (Sneed Hub: /me); that SMS is sent by the poster's own client from the poster's principal.
8. **Notifications.** New replies, mentions and tips are also handed to the Sneed Notifications canister (`get_notifications_canister()`), best effort.
9. **Text limits are configurable.** Read `get_text_limits()` and `get_premium_config()` before posting; Sneed Premium members get longer thread and post bodies (production on 2026-10-20: body 4_000 chars, premium 12_000; titles 200 for threads, 100 for posts). Too long → `InvalidInput`.
10. **Agent guide.** `get_api_doc()` (query) returns a short Markdown guide to this canister for agents, linking this reference and https://app.sneeddao.com/llms.txt.
11. **Activity log (ICRC-3).** Verified tips (with their ledger block), moderation (admin deletes, undeletes and edits of others' content, logged with SHA-256 hashes of the texts, never the texts), admin and config changes, forum/topic structure and proposal threads are blocks of a certified, hash-chained log: `icrc3_get_blocks`, `icrc3_get_tip_certificate`, `icrc3_get_archives`, `icrc3_supported_block_types` (`sneedforum_*`, documented at https://app.sneeddao.com/api/sneed_sns_forum#block-types). Ordinary posts, threads and votes are not logged. Use it to audit moderation or prove a tip; verify as in the reference, section 8.
12. **Errors** are `variant { AlreadyExists; InternalError; InvalidInput; NotFound; Unauthorized : text }` inside `Result` (`ok : nat` = new id). Query responses are not certified.

## Procedures

### Find an SNS forum and read it
1. `get_forum_by_sns_root(snsRoot)` → `opt ForumResponse` (null: no forum yet; a logged-in user can create it with `create_sns_forum_setup`).
2. `get_topics_by_forum(forum_id)`, `get_subtopics(topic_id)`.
3. Threads, newest activity first, paged: `get_threads_by_activity(topic_id, start_from, length, reverse)` → `{threads; has_more; next_start_from}`; pass `next_start_from` back as `start_from`. (`get_threads_by_topic` returns all at once.)
4. `get_thread(id)`, `get_posts_by_thread(thread_id)` (all live posts; build the tree from `reply_to_post_id`), `get_post(id)`, `get_post_replies(post_id)`, `get_thread_context(thread_id)` → forum, topic and SNS root.
5. Site-wide activity: `get_feed({start_id = null; length = 20; filter = opt {sns_root_canister_ids; topic_ids; creator_principals; search_text}})` → `{items; has_more; next_start_id}`, newest first; continue with `start_id = next_start_id`.

### Post
- New thread: `create_thread({topic_id; title = opt "…"; body})` → `ok thread_id`.
- Reply: `create_post(thread_id, opt reply_to_post_id, opt title, body)` → `ok post_id`.
- Edit: `update_thread(id, title, body)`, `update_post(id, title, body)`.

### Vote on posts and polls
`vote_on_post_with_neurons(post_id, variant { upvote }, neuron_ids)`; inspect with `get_post_votes(post_id)` or `get_thread_votes_for_neurons(thread_id, neuron_ids)`. Polls: `get_polls_by_thread`, `get_poll(id)` (options with `vote_count`, `total_voting_power`), `vote_on_poll_with_neurons`, `get_poll_votes`.

### Proposal discussions
`get_proposal_thread(sns_root, proposal_id)` → mapping or null. `create_proposal_thread_with_auto_setup({sns_root_canister_id; proposal_id})` creates the forum structure if missing and the thread. Reverse: `get_thread_proposal_id(thread_id)`.

### A user's activity
`get_threads_by_user(p)`, `get_posts_by_user(p)`, `get_replies_to_user(p)`, `get_tips_received_by_user(p)`, `get_tips_given_by_user(p)`, `get_tip_tokens_received_by_user(p)`, `get_mentions_of_user(p, before, limit ≤ 100)` → `{items; next}` (newest first; pass `next` as `before`). Unseen counts: `get_recent_replies_count`, `get_recent_tips_count`, `get_recent_mentions_count`; mark seen with `mark_replies_seen_up_to(ns)` etc. (caller only).

## Sneed Hub pages

- Forum of the selected SNS: `https://app.sneeddao.com/forum?sns=<sns_root>`; topic `https://app.sneeddao.com/topic/<topic_id>?sns=<sns_root>`.
- Thread `https://app.sneeddao.com/thread?threadid=<id>`; post `https://app.sneeddao.com/post?postid=<id>`.
- Feed `/feed`, own posts `/posts`, tips `/tips`, proposal with its discussion `/proposal?proposalid=<id>&sns=<sns_root>`, mention-SMS setting on `/me`.

## Minimal JavaScript setup

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory } from './sneed_sns_forum.did.js'; // src/declarations/sneed_sns_forum in the repo

const agent = new HttpAgent({ identity, host: 'https://icp-api.io' }); // anonymous identity is enough for queries
const forum = Actor.createActor(idlFactory, { agent, canisterId: 'mcigm-4aaaa-aaaad-qhlkq-cai' });
const f = await forum.get_forum_by_sns_root(Principal.fromText(snsRoot)); // [] or [ForumResponse]
const page = await forum.get_threads_by_activity(topicId, [], 20n, false);
```

## dfx examples

```bash
dfx canister --network ic call mcigm-4aaaa-aaaad-qhlkq-cai get_text_limits --query
dfx canister --network ic call mcigm-4aaaa-aaaad-qhlkq-cai get_feed '(record { start_id = null; length = 10 : nat; filter = null })' --query
dfx canister --network ic call mcigm-4aaaa-aaaad-qhlkq-cai get_posts_by_thread '(1 : nat)' --query
```

## Reference implementation

Sneed Hub's forum UI: `src/app_sneeddao_frontend/src/pages/Forum.jsx`, `Topic.jsx`, `Thread.jsx`, `components/ThreadViewer.jsx` (posting, voting, tipping), `utils/mentions.js`, under https://github.com/Snassy-icp/app_sneeddao.
