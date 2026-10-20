# Sneed Forum canister API

The Sneed Forum is the discussion canister behind the forum on Sneed Hub. One canister holds a forum for every SNS that wants one: topics, threads, posts, replies, polls, tips, @-mentions and read state. Voting on posts and polls is done with the SNS neurons the caller can reach, weighted by their voting power, so a forum's scores reflect the stake of the DAO that owns it. Anyone can read everything, and anyone can integrate: the canister authorises calls by the calling principal only, so a wallet, a DAO dashboard or a script can post, vote and tip for its users on the same terms as Sneed Hub.

| | |
|---|---|
| Production canister | `mcigm-4aaaa-aaaad-qhlkq-cai` |
| Staging canister | `nrtf2-wiaaa-aaaad-aankq-cai` (separate state, same code line; use it to test) |
| Candid interface | [sneed_sns_forum.did](/api-docs/sneed_sns_forum.did) · [JavaScript IDL factory](/api-docs/sneed_sns_forum.did.js) |
| Source | [src/sneed_sns_forum/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_sns_forum/main.mo) · [lib.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_sns_forum/lib.mo) · [Types.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_sns_forum/Types.mo) · [Mentions.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_sns_forum/Mentions.mo) · [TipVerify.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_sns_forum/TipVerify.mo) |
| Reference frontend | [app.sneeddao.com/forum](https://app.sneeddao.com/forum) ([source](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend)) |
| This document | [rendered](/api/sneed_sns_forum) · [raw Markdown](/api-docs/sneed_sns_forum.md) · short agent guide on-chain: `get_api_doc()` |

Upgrades are decided by Sneed DAO proposals; the production canister is controlled by the Sneed SNS. The method set below matches the source on `main` and the interface the production and staging canisters publish.

---

## 1. Mental model

### 1.1 The hierarchy

```
Forum            one per SNS (sns_root_canister_id)
└─ Topic         may have subtopics (parent_topic_id), any depth
   └─ Thread     title optional, body required
      └─ Post    reply_to_post_id = null: a reply to the thread; otherwise a reply to that post
         ├─ Votes  one per (post, neuron): upvote or downvote, weighted by voting power
         ├─ Tips   ICRC-1 transfers to the post's author, checked on the token's ledger
         └─ Poll   at most one per post
      └─ Poll      at most one per thread
```

| Level | Who creates it | Who edits it | Who deletes it |
|---|---|---|---|
| Forum | Admins (or anyone, through `create_sns_forum_setup` / `create_proposal_thread_with_auto_setup` for an SNS that has none yet) | Admins | Admins |
| Topic | Admins; the standard topics (`General`, `Governance`, `Preproposals`, `Proposals`) can be created by any signed-in caller (section 3.7) | Admins | Admins |
| Thread | Any signed-in principal | The author or an admin | Admins |
| Post | Any signed-in principal | The author or an admin | The author or an admin |
| Poll | The author of the thread or post it belongs to | — | — |
| Tip | Any signed-in principal, for a transfer it made to the post's author (checked on the ledger) | — | — |

### 1.2 One id counter for everything

Forums, topics, threads, posts, polls and tips all draw their ids from **one** counter. Ids are unique across kinds and increase with time, so a higher id is a newer item. `get_current_counter()` returns the next id to be handed out; a client that remembers it can tell cheaply whether anything new exists. `get_feed` walks this counter downwards (section 3.9), and "activity" of a thread is its highest post id.

### 1.3 Every forum belongs to an SNS

A forum's `sns_root_canister_id` names the SNS whose neurons vote in it. A forum created without one is given Sneed DAO's root, `fp274-iaaaa-aaaaq-aacha-cai`. To act on a post the canister resolves post → thread → topic → forum → SNS root → SNS governance, using a list of deployed SNSes it reads from the NNS SNS-W canister (`qaa6y-5yaaa-aaaaa-aaafa-cai`) and caches for 24 hours. The cache lives in memory and starts empty after an upgrade, so the first call after one, or for an SNS launched since the last refresh, waits for SNS-W.

Creating a post also goes through this lookup: posting in a forum whose SNS root is not in the SNS-W list fails with `InternalError("No SNS governance canister found")`. You do not need a neuron to post.

### 1.4 Voting power

Votes on posts and polls are cast by **neurons**, not by principals. The neurons a caller can use are its **reachable neurons** in the forum's SNS:

1. every neuron that lists the caller in its permissions (`list_neurons { of_principal = caller; limit = 100 }` on SNS governance), and
2. for each of those neurons' owners (the permission entry with more than 7 permission types), that owner's neurons too.

So a hotkey on any one of a member's neurons reaches all of that member's neurons. Each neuron's voting power is computed the way SNS governance computes it: stake plus staked maturity, a dissolve-delay bonus and an age bonus from the SNS's own `NervousSystemParameters`, times `voting_power_percentage_multiplier`. Neurons below the SNS's minimum dissolve delay to vote, or with zero stake, have zero power and are skipped. The power is recorded when the vote is cast; it is not refreshed later unless the neuron votes again.

A post's `upvote_score` and `downvote_score` are the sums of the voting power recorded by its up- and downvotes.

### 1.5 Time and amounts

Timestamps (`created_at`, `updated_at`, `end_timestamp`, the "seen up to" marks) are `int` nanoseconds since the Unix epoch, the unit of `Time.now()` in Motoko and `BigInt(Date.now()) * 1_000_000n` in JavaScript. Tip amounts are base units of the token's ledger as `nat`. Voting power is in the SNS's e8s-scale units as `nat`.

### 1.6 Soft deletion

Nothing is ever erased. Deleting a forum, topic, thread or post sets its `deleted` flag; admins can undelete. Public queries hide deleted items (exceptions are listed per method); the `*_admin` queries show them to admins and answer empty to everyone else.

### 1.7 Public, permissionless, not anonymous

Every forum, thread, post, vote, poll vote, tip, mention and read mark is readable by anyone, together with the principal that made it and, for votes, the neuron id. The canister refuses the anonymous principal for anything that writes content. A user who signs in to your product with a different principal than on Sneed Hub is a different author with different reachable neurons.

### 1.8 Calls the canister refuses at ingress

Before it accepts an update call from outside the IC, the canister checks it (its `inspect_message`), and a refused call costs nobody anything:

- **Query methods only answer query calls.** Calling one as an update call is refused. Use the generated declarations, or `--query` with dfx.
- **Texts are checked against the text limits.** `create_forum`, `update_forum`, `create_topic`, `update_topic`, `create_thread`, `update_thread`, `create_post`, `update_post` and `create_poll` are refused when a title, description or body is longer than the current limit (a body may be as long as the premium limit when premium is configured; the method itself then decides whether the caller is premium). The whole argument may be at most 4 KiB plus 4 bytes per allowed character.
- **Neuron lists are capped.** `vote_on_post_with_neurons`, `retract_vote_with_neurons` and `vote_on_poll_with_neurons` take at most 1,000 neuron ids and a 64 KiB argument. A poll has at most 100 options.
- **Everything else** takes at most 4 KiB of argument.

Canisters calling the forum are not affected: the check only applies to calls from outside the IC.

---

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './sneed_sns_forum.did.js'; // https://app.sneeddao.com/api-docs/sneed_sns_forum.did.js

const FORUM = 'mcigm-4aaaa-aaaad-qhlkq-cai';

export function forumActor(identity) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId: FORUM });
}
```

With dfx:

```bash
dfx canister --network ic call mcigm-4aaaa-aaaad-qhlkq-cai get_forums '()' --query
```

### 2.2 Find a DAO's forum and read it

```js
import { Principal } from '@dfinity/principal';

const SNEED_ROOT = Principal.fromText('fp274-iaaaa-aaaaq-aacha-cai');

async function readForum(forum) {
  const [f] = await forum.get_forum_by_sns_root(SNEED_ROOT);   // opt ForumResponse
  if (!f) return null;
  const topics = await forum.get_topics_by_forum(f.id);         // root topics and subtopics
  const roots = topics.filter((t) => t.parent_topic_id.length === 0);

  // Threads of the first topic, most recently active first, 20 per page
  const page = await forum.get_threads_by_activity(roots[0].id, [], 20n, true);
  const thread = page.threads[0];
  const posts = await forum.get_posts_by_thread(thread.id);     // flat, in creation order
  return { f, roots, page, thread, posts };
}
```

Build the reply tree yourself from `reply_to_post_id`: posts with `[]` answer the thread, the others answer the post they name.

### 2.3 Post, reply and edit

```js
async function postReply(forum, threadId, replyToPostId, body) {
  const r = await forum.create_post(
    threadId,
    replyToPostId === null ? [] : [replyToPostId],
    [],               // optional title
    body,
  );
  if ('err' in r) throw new Error(Object.entries(r.err)[0].join(': '));
  return r.ok;        // the new post id
}

// Edits replace title and body; pass the title again to keep it.
await forum.update_post(postId, [], 'Edited text');
```

Read `get_text_limits()` first and check lengths client-side; production limits differ from the defaults (section 4).

### 2.4 Vote on a post with SNS neurons

```js
// All reachable neurons with voting power, upvote:
const r = await forum.vote_on_post(postId, { upvote: null });

// Or only some neurons (e.g. the ones the user ticked):
const r2 = await forum.vote_on_post_with_neurons(postId, { downvote: null }, [{ id: neuronIdBytes }]);

// What did my neurons vote in this thread?
const mine = await forum.get_thread_votes_for_neurons(threadId, myNeuronIds);
```

`neuronIdBytes` is the SNS neuron id blob (`Uint8Array`), the same `id` that SNS governance returns.

### 2.5 Tip a post

A tip is two steps: the client transfers the tokens from the tipper's main account to the author's main account with an ordinary ICRC-1 transfer, then records the tip with the block index. The forum never moves funds, but it reads that block on the ledger before recording the tip (3.11). The transfer is irreversible: if `create_tip` fails, the tokens were still sent, so never repeat the transfer; retry only `create_tip`.

```js
async function tipPost({ identity, forum, ledgerActor, ledgerId, post, amount }) {
  const t = await ledgerActor.icrc1_transfer({
    to: { owner: post.created_by, subaccount: [] },
    amount, fee: [], memo: [], from_subaccount: [], created_at_time: [],
  });
  if ('Err' in t) throw new Error(JSON.stringify(t.Err));
  const r = await forum.create_tip(post.created_by, post.id, Principal.fromText(ledgerId), amount, [t.Ok]);
  if ('err' in r) throw new Error(JSON.stringify(r.err));
  return r.ok; // tip id
}
```

---

## 3. Flows in detail

### 3.1 Reading structure

- `get_forums()` lists forums; `get_forum(id)` and `get_forum_by_sns_root(root)` fetch one (`get_forum_by_sns_root` only finds live forums).
- `get_topics_by_forum(forum_id)` returns all topics of the forum, root topics and subtopics alike; `get_subtopics(topic_id)` returns the direct children of one.
- `get_thread_context(thread_id)` returns `{ thread_id; topic_id; forum_id; sns_root_canister_id }` in one call, handy for deep links to a thread.
- `get_topic_statistics(topic_id)` returns the number of live threads and the caller's unread post count across them.

For admins (`is_admin(caller)`), `get_forum`, `get_forums`, `get_topic`, `get_topics_by_forum`, `get_subtopics`, `get_thread`, `get_threads_by_topic` and `get_threads_by_activity` include deleted items; for everyone else they do not. `get_post`, `get_posts_by_thread` and `get_post_replies` never include deleted posts, not even for admins; use the `*_admin` variants.

### 3.2 Listing threads

| Method | Order | Paging | Extra |
|---|---|---|---|
| `get_threads_by_topic(topic_id)` | creation order | none | — |
| `get_threads_by_topic_with_unread_counts(topic_id)` | creation order | none | `unread_posts_count`, `total_posts_count` for the caller; **includes deleted threads** (filter on `deleted`) |
| `get_threads_by_activity(topic_id, start_from, length, reverse)` | by highest post id (threads without posts count as 0); `reverse = true` puts the most recent activity first | `start_from` is an index into the sorted list; the reply carries `has_more` and `next_start_from` | — |
| `get_threads_by_activity_with_unread_counts(...)` | as above | as above | unread and total counts for the caller |
| `get_threads_by_user(user)` | newest first | none | live threads only |

Unread counts are relative to the caller's read marks (3.10), so call these with the user's identity; with an unsigned query every post is unread. In `ThreadResponse` the two count fields are `[]` when the method does not compute them.

### 3.3 Posting

`create_thread({ topic_id; title; body })` and `create_post(thread_id, reply_to_post_id, title, body)` return the new id. Rules:

- The caller must not be anonymous.
- Titles (optional) and bodies (required, non-empty) are measured in characters against `get_text_limits()`. Callers who are Sneed Premium members get the premium body limits from `get_premium_config()` instead (the forum asks the configured Sneed Premium canister, with a cache).
- A post's thread must exist and not be deleted; a reply target must exist and be in the same thread. A thread's topic must exist.
- After a successful save, the forum records new @-mentions (3.5) and hands notifications to Sneed Notifications (3.6). Neither can make the save fail.

`update_thread(id, title, body)` and `update_post(id, title, body)` **replace** both fields: pass `[]` as title and the title is removed. Only the author or an admin may edit; the same limits apply. Edits record mentions that are new in the edited text.

`delete_post(id)` is allowed to the author and admins; `delete_thread` is admin-only.

### 3.4 Voting on posts

| Method | Neurons used |
|---|---|
| `vote_on_post(post_id, vote_type)` | every reachable neuron with voting power |
| `vote_on_post_with_neurons(post_id, vote_type, neuron_ids)` | the listed neurons that are also reachable; others are silently ignored |
| `retract_vote(post_id)` | every reachable neuron's vote on the post |
| `retract_vote_with_neurons(post_id, neuron_ids)` | the listed reachable neurons' votes |

A neuron has at most one vote per post. Voting again replaces it (switching up/down moves its power between the two scores; voting the same way refreshes the power). The vote records the caller as `voter_principal`. Voting does not check `deleted`, and it changes the post's `updated_at`.

Errors: `Unauthorized("No accessible neurons found")` when the caller reaches no neuron in the SNS, `NotFound("No votes found to retract")` when nothing could be retracted, `InternalError(...)` when the SNS governance call failed (retry), `NotFound("Post not found")`. `vote_on_post_with_neurons` returns `ok` even when none of the listed neurons was reachable or had power: compare `get_post_votes_for_neurons` afterwards if you need to know.

Reading votes: `get_post_votes(post_id)` returns every vote on a post with neuron id, principal, type and power; `get_post_votes_for_neurons(post_id, neuron_ids)` and `get_thread_votes_for_neurons(thread_id, neuron_ids)` return what given neurons voted (the latter for every post of a thread that has such a vote).

### 3.5 @-mentions

A mention is a Markdown link whose text starts with `@` and whose target is a Sneed Hub principal page:

```markdown
[@Mr Sneed](https://app.sneeddao.com/principal?id=tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae)
```

The link text is only how it reads; the principal in the URL is who is meant, so names may contain spaces and renames never break a mention. The parser accepts the targets `https://app.sneeddao.com/principal?id=<principal>` and `/principal?id=<principal>`, link texts of 1 to 64 characters without `]` or line breaks, and only canonical, checksum-valid principal text. Plain `@name` text is ignored. At most 10 distinct principals count per thread or post body, in order of first appearance.

On every successful `create_thread`, `update_thread`, `create_post` and `update_post` the forum records, per mentioned principal, `{ thread_id; post_id; by; at }`, unless that principal was already recorded for the same thread body or post, is the author, or is anonymous. Edits therefore only add newly mentioned members.

| Method | Purpose |
|---|---|
| `get_mentions_of_user(user, before, limit)` | Newest first. `limit` 1..100 (0 or more than 100 means 100). `before` is an `index` from a previous page (exclusive). Mentions whose thread or post has since been deleted are skipped (at most 1,000 are scanned per call). The reply's `next` is the `before` for the next page, `[]` when done. |
| `get_recent_mentions_count(user)` | Live mentions newer than the user's seen mark. |
| `mark_mentions_seen_up_to(timestamp)` | Sets the caller's seen mark (ns). Ignored for the anonymous caller. |
| `get_last_seen_mentions_timestamp(user)` | The mark, or `[]`. |
| `set_mention_sms(on)` / `get_mention_sms(user)` | The user's opt-in to a Sneed SMS when mentioned. |
| `get_mention_sms_opted_in(users)` | Which of the given principals opted in (at most 10 returned). |

**Mention SMS** is sent by the poster's own client, not by the forum: after a save, Sneed Hub calls `get_mention_sms_opted_in` with the principals it just mentioned and sends each one Sneed SMS from the poster's principal (excerpt plus link). SMS rate limits apply to the poster as usual. An integrating client should do the same, or nothing; the forum never sends SMS itself.

### 3.6 Notifications hook

When an admin has set a notifications canister (`get_notifications_canister()`; production points at Sneed Notifications `vuy7a-iaaaa-aaaay-aaduq-cai`, staging at `uqvqs-raaaa-aaaay-aadsq-cai`), the forum hands it a batch with `notify_batch` after:

| Event | Recipient | Topic | Link |
|---|---|---|---|
| New post | Author of the post replied to, or of the thread for a root-level post; not the poster, not someone mentioned in the same post | `reply` | `https://app.sneeddao.com/post?postid=<id>` |
| New mention (thread or post, created or edited) | Each newly mentioned principal | `mention` | the post, or `https://app.sneeddao.com/thread?threadid=<id>` |
| Tip the ledger confirmed (3.11) | The tip's `to_principal`, unless it is the tipper | `tip` | the post |

The call is fire-and-forget with a 60-second bounded wait: the forum never waits for or depends on the answer, and Sneed Notifications decides, by the member's own settings, whether anything is delivered. See the Sneed Notifications API document for how members allow and receive these.

### 3.7 Proposal threads and standard topics

Each forum can have one **proposals topic**, where each SNS proposal gets its own discussion thread, titled `<forum title> Proposal #<id>`.

- `create_sns_forum_setup(sns_root)` makes sure the SNS has a forum (titled `<SNS name> Forum`, created if missing), a root topic `Governance` and under it `Proposals`, and registers `Proposals` as the proposals topic. Returns the proposals topic id. The SNS root must be in the SNS-W list (`NotFound("SNS governance canister not found")`). Any signed-in caller may run it; it only creates what is missing.
- `create_proposal_thread({ proposal_id; sns_root_canister_id })` creates the thread for a proposal when the forum and proposals topic exist. Errors: `AlreadyExists("Thread for this proposal already exists")`, `NotFound("No forum found for this SNS")`, `InvalidInput("No proposals topic set for this SNS")`.
- `create_proposal_thread_with_auto_setup(input)` does the same and first runs the setup above when the forum or its proposals topic is missing. This is what Sneed Hub calls when someone opens the discussion of a proposal that has none.
- `get_proposal_thread(sns_root, proposal_id)` finds the thread of a proposal; `get_thread_proposal_id(thread_id)` goes the other way (the first element is an internal index of the SNS root, not a principal; use `get_thread_context` for the root).
- `get_proposals_topic(forum_id)` / `get_proposals_topic_by_sns_root(root)` return the registered topic.

The canister does not check that the proposal exists in SNS governance; it maps `(sns_root, proposal_id)` to one thread, first come first served.

`create_special_topic({ sns_root_canister_id; special_topic_type })` lets any signed-in caller add a standard topic to an SNS's existing forum: `#General` (root), `#Governance` (root) or `#Preproposals` (under `Governance`, creating that first if needed). Each fails with `AlreadyExists("<Name> topic already exists")` if present, and with `NotFound("Forum not found for this SNS")` when the SNS has no live forum.

### 3.8 Polls

A thread can carry one poll and each post one poll, created by that thread's or post's author with `create_poll`:

```js
const r = await forum.create_poll({
  thread_id: threadId,
  post_id: [],                         // [postId] for a poll on a post
  title: 'Which logo?',
  body: 'Vote with your neurons.',
  options: [{ title: 'A', body: [] }, { title: 'B', body: [] }],
  vp_power: [],                        // default 1.0 (see below)
  end_timestamp: BigInt(Date.now() + 7 * 86400_000) * 1_000_000n,
  allow_vote_changes: [],              // default true
});
```

- At least 2 options (`InvalidInput("Poll must have at least 2 options")`), at most 100 (ingress). Titles use the post title limit, bodies the post body limit (no premium extension). Option ids are `0, 1, 2, ...` in the order given.
- `end_timestamp` must be in the future. Voting stops at it; `PollResponse.has_ended` tells you.
- **`vp_power`** shapes the weight of each neuron's vote: weight = voting_power ^ `vp_power`. `1.0` is plain voting power, `0.0` makes every neuron count 1, `0.5` is the square root. Negative values are refused.
- Errors: `Unauthorized("Only the thread creator can create a poll for it")` / `("Only the post creator can create a poll for it")`, `AlreadyExists("A poll already exists for this thread")` / `("... for this post")`, `InvalidInput("Post does not belong to the specified thread")`, `NotFound(...)`.

`vote_on_poll_with_neurons(poll_id, option_id, neuron_ids)` votes with the listed reachable neurons, one vote per neuron per poll. With `allow_vote_changes = false` a neuron's second vote fails with `InvalidInput("Vote changes are not allowed for this poll")`. Other errors: `NotFound("Poll not found")`, `InvalidInput("Poll has ended")`, `NotFound("Poll option not found")`, `Unauthorized("No accessible neurons found")`. There is no "vote with all neurons" variant for polls; pass the neuron ids. Each option carries `vote_count` (neurons) and `total_voting_power` (weighted).

Read with `get_poll(id)`, `get_polls_by_thread(thread_id)` (the thread's own poll), `get_polls_by_post(post_id)` and `get_poll_votes(poll_id)`.

### 3.9 The feed

`get_feed({ start_id; length; filter })` walks the id counter downwards from `start_id` (that id included; `[]` starts at the newest id) and returns live forums, topics, threads and posts as `FeedItem`s with their context (forum, topic and thread titles, the SNS root, the poll id, and for replies the post replied to). Tips and polls occupy ids but are not feed items.

`filter` narrows by `sns_root_canister_ids`, `topic_ids`, `creator_principals` and a case-insensitive (ASCII) `search_text` in title or body. A call checks at most `length × 10` ids, so a narrow filter can return fewer than `length` items, even none, with `has_more = true`; keep paging with `next_start_id`. Stop when `has_more` is false.

```js
async function* feed(forum, filter = []) {
  let start = [];
  for (;;) {
    const page = await forum.get_feed({ start_id: start, length: 20n, filter });
    yield* page.items;
    if (!page.has_more) return;
    start = page.next_start_id;
  }
}
```

### 3.10 Read state and the notification counters

Read state is per principal and per thread: the id of the last post read.

- `set_last_read_post({ thread_id; last_read_post_id })` stores it for the caller (replies `{ success = true; message }`). Posts with a higher id count as unread. The canister does not check the thread or the post id, and accepts lower values (mark as unread).
- `get_last_read_post({ thread_id })` and `get_user_thread_reads_for_topic(topic_id)` (pairs `(thread_id, last_read_post_id)`, 0 where never read) read the caller's marks; they are queries that use the caller, so sign them.

Three "since last seen" counters power the header chips on Sneed Hub. Each has a mark the user moves forward:

| Kind | Count | List | Mark |
|---|---|---|---|
| Replies | `get_recent_replies_count(user)`: live replies to the user's live posts, plus live root-level posts by others in the user's live threads, newer than the mark | `get_replies_to_user(user)` (all, not only recent) | `mark_replies_seen_up_to(ts)`, `get_last_seen_replies_timestamp(user)` |
| Tips | `get_recent_tips_count(user)` | `get_recent_tips_received(user)`, `get_tips_received_since(user, ts)` | `mark_tips_seen_up_to(ts)`, `get_last_seen_tip_timestamp(user)` |
| Mentions | `get_recent_mentions_count(user)` | `get_mentions_of_user(user, before, limit)` | `mark_mentions_seen_up_to(ts)`, `get_last_seen_mentions_timestamp(user)` |

Without a mark, everything counts as new. The `mark_*` methods set the caller's own mark only and return nothing.

### 3.11 Tips

`create_tip(to_principal, post_id, token_ledger_principal, amount, transaction_block_index)` records a tip against a post and returns its id. The tipper must already have sent the tokens. Before recording, the forum reads block `transaction_block_index` on `token_ledger_principal`, once:

- ICRC ledgers: ICRC-3 `icrc3_get_blocks`; a ledger without it is read with the ledger suite's `get_transactions`. The ICP ledger (`ryjl3-tyaaa-aaaaa-aaaba-cai`): `query_blocks` with account identifiers. A block that has moved to an archive is read through the archive callback the ledger returns. That is one call to the ledger, plus one to an archive when needed; every call is a bounded-wait call.
- The block must be a plain transfer (not a mint, burn, approval or a transfer made with an approval) from the caller's main account (no subaccount) to `to_principal`'s main account, of exactly `amount` (the fee is separate), and `to_principal` must be the author of the post.
- Each `(ledger, block)` pair backs one tip only. The block is reserved before the ledger is asked, so two calls racing for the same block cannot both record it.

| Outcome | Result | Recorded |
|---|---|---|
| The block confirms the tip | `ok(tip_id)` | yes, `verified = ?true`; the author is notified (3.6) |
| The block contradicts it (no such block, another sender, recipient or amount, not a plain transfer) | `InvalidInput("Tip not recorded: <reason>")` | no |
| `to_principal` is not the post's author | `InvalidInput("A tip goes to the post's author: ...")` | no |
| The block is already used by a tip, or being checked by another call | `AlreadyExists("Block <n> of this ledger is already the transfer of tip <id>")` / `("... is being registered by another call")` | no |
| The block could not be read (no block index given, the ledger did not answer or has neither method) | `ok(tip_id)` | yes, `verified = ?false` with the reason in `verification_note`; no notification |

`verify_tip(tip_id)` (any signed-in caller) reads the block again for a tip that is not verified yet: one recorded unverified, or one recorded before the forum checked tips. It answers `ok(true)` when the tip is now verified and `ok(false)` otherwise (reason in `verification_note`); a verified or rejected tip is final. A tip verified later sends no notification.

`TipResponse.verified` is `?true` (the ledger confirmed it), `?false` (not confirmed; see `verification_note`) or null (recorded before the forum checked tips, not checked since). Tips recorded before the upgrade keep their blocks: the first tip that named a block owns it.

**What counts.** `get_tip_stats`, `get_tip_tokens_received_by_user`, `get_recent_tips_count`, `get_recent_tips_received` and `get_tips_received_since` count verified tips only. `get_tip`, `get_tips_by_post`, `get_tips_by_thread`, `get_tips_given_by_user` and `get_tips_received_by_user` list every tip with its `verified` flag: show or count only `verified = ?true` (Sneed Hub does).

"Verified" means the token's own ledger, the one the tipper named, records the transfer. It says nothing about what the token is worth: anyone can make a ledger.

---

## 4. Limits

`get_text_limits()` returns the live limits, in characters:

| Field | Default in code | Production on 2026-10-20 |
|---|---|---|
| `forum_title_max_length` / `forum_description_max_length` | 100 / 1,000 | 100 / 1,000 |
| `topic_title_max_length` / `topic_description_max_length` | 100 / 1,000 | 100 / 1,000 |
| `thread_title_max_length` / `thread_body_max_length` | 200 / 10,000 | 200 / 4,000 |
| `post_title_max_length` / `post_body_max_length` | 200 / 10,000 | 100 / 4,000 |

Sneed Premium members get `premium_thread_body_max_length` and `premium_post_body_max_length` from `get_premium_config()` (defaults 50,000; production 12,000) while `sneed_premium_canister_id` is set. `check_user_premium_status(user)` (an update call, since it may ask Sneed Premium) tells you whether a user qualifies. Admins change the limits; always read them rather than hard-coding.

Other bounds: 10 counted mentions per text, 100 mentions per `get_mentions_of_user` page, 100 poll options, 1,000 neuron ids per call, and the reachable-neuron lookup reads at most 100 neurons per principal from SNS governance.

---

## 5. Concurrency, errors and retries

**Result shapes.** Updates return `Result = variant { ok; err : ForumError }` or `Result_1 = variant { ok : nat; err : ForumError }` (the new id). `ForumError` is `variant { NotFound : text; Unauthorized : text; InvalidInput : text; AlreadyExists : text; InternalError : text }`; the texts are the messages quoted in this document. `set_last_read_post` returns a record, the `mark_*` methods return nothing.

**Validation messages.** Text checks produce `InvalidInput("<Field> cannot be empty")` and `InvalidInput("<Field> cannot exceed <n> characters")`, where Field is `Title`, `Body`, `Description`, `Option title` or `Option body`.

**Inter-canister calls.** Posting, voting, poll voting and the proposal setup may call SNS-W and SNS governance; editing and posting may call Sneed Premium. A failure there surfaces as `InternalError(...)` (voting) or as the default limits being applied (premium), and nothing is written. These calls are safe to retry.

**Idempotency.** `create_thread`, `create_post` and `create_poll` are not idempotent: two successful calls make two items. `create_tip` with a block index is: a second call for the same block answers `AlreadyExists` naming the tip. After a timeout, look for the item (`get_posts_by_user`, `get_tips_given_by_user`, `get_polls_by_thread`) before retrying. Votes, retractions, read marks, seen marks, the SMS opt-in and the proposal setup are idempotent. `create_proposal_thread*` refuses a second thread for the same proposal.

**Interleaving.** Each update runs to completion between its awaits; `create_tip` reserves its `(ledger, block)` before asking the ledger, so a concurrent call for the same block is refused; a vote computed from SNS governance is written in one step after the awaits. Two votes by the same neuron in flight at once both succeed, and the later write wins.

---

## 6. Method reference

Types are in section 7. "Caller" means the principal signing the call. Methods marked *query* can be called without a signature, but those that use the caller only make sense signed.

### 6.1 Forums and topics (reads)

| Method | Returns | Notes |
|---|---|---|
| `get_forums()` *query* | `vec ForumResponse` | Deleted ones only for admins. |
| `get_forum(id)` *query* | `opt ForumResponse` | Deleted only for admins. |
| `get_forum_by_sns_root(root)` *query* | `opt ForumResponse` | Live forums only. |
| `get_topics_by_forum(forum_id)` *query* | `vec TopicResponse` | All levels. |
| `get_subtopics(topic_id)` *query* | `vec TopicResponse` | Direct children. |
| `get_topic(id)` *query* | `opt TopicResponse` | |
| `get_topic_statistics(topic_id)` *query, caller* | `TopicStatistics` | Live threads and the caller's unread posts. |
| `get_thread_context(thread_id)` *query* | `opt ThreadContextResponse` | Topic, forum and SNS root of a thread. |
| `get_stats()` *query* | `ForumStats` | Totals of forums, topics, threads, posts, votes (deleted included). |
| `get_current_counter()` *query* | `nat` | The next id. |
| `get_text_limits()` *query* | `TextLimits` | |
| `get_premium_config()` *query* | `PremiumConfig` | |
| `health_check()` *query* | `bool` | Always `true`. |

### 6.2 Threads and posts (reads)

| Method | Returns | Notes |
|---|---|---|
| `get_thread(id)` *query* | `opt ThreadResponse` | Deleted only for admins. |
| `get_threads_by_topic(topic_id)` *query* | `vec ThreadResponse` | 3.2. |
| `get_threads_by_topic_with_unread_counts(topic_id)` *query, caller* | `vec ThreadResponse` | Includes deleted. |
| `get_threads_by_activity(topic_id, start_from : opt nat, length : nat, reverse : bool)` *query* | `GetThreadsByActivityResponse` | Paged, 3.2. |
| `get_threads_by_activity_with_unread_counts(...)` *query, caller* | `GetThreadsByActivityResponse` | Paged, with counts. |
| `get_threads_by_user(user)` *query* | `vec ThreadResponse` | Live, newest first. |
| `get_post(id)` *query* | `opt PostResponse` | Never deleted posts. |
| `get_posts_by_thread(thread_id)` *query* | `vec PostResponse` | Live posts, creation order. |
| `get_post_replies(post_id)` *query* | `vec PostResponse` | Direct live replies. |
| `get_posts_by_user(user)` *query* | `vec PostResponse` | Live, newest first. |
| `get_replies_to_user(user)` *query* | `vec PostResponse` | Live replies to the user's posts and root posts by others in the user's threads. |
| `get_feed(GetFeedInput)` *query* | `GetFeedResponse` | 3.9. |

### 6.3 Writing content (updates)

**`create_thread(CreateThreadInput) → Result_1`** — new thread id. Errors: `Unauthorized("Authentication required to create threads")`, `NotFound("Topic not found")`, text validation.

**`update_thread(id : nat, title : opt text, body : text) → Result`** — replaces title and body. Errors: `NotFound("Thread not found")`, `Unauthorized("Only admins or thread owners can edit threads")`, text validation.

**`create_post(thread_id : nat, reply_to_post_id : opt nat, title : opt text, body : text) → Result_1`** — new post id. Errors: `Unauthorized("Authentication required to create posts")`, `NotFound("Thread not found")`, `InvalidInput("Cannot post in a deleted thread")`, `NotFound("Reply target post not found")`, `InvalidInput("Reply target must be in the same thread")`, `InternalError("No SNS governance canister found")`, text validation.

**`update_post(id : nat, title : opt text, body : text) → Result`** — errors: `NotFound("Post not found")`, `Unauthorized("Only admins or post owners can edit posts")`, text validation.

**`delete_post(id) → Result`** — soft delete by the author or an admin. Error: `Unauthorized("Only admins or post owners can delete posts")`, `NotFound("Post not found")`.

### 6.4 Votes

| Method | Kind | Returns |
|---|---|---|
| `vote_on_post(post_id, VoteType)` | update | `Result` |
| `vote_on_post_with_neurons(post_id, VoteType, vec NeuronId)` | update | `Result` |
| `retract_vote(post_id)` | update | `Result` |
| `retract_vote_with_neurons(post_id, vec NeuronId)` | update | `Result` |
| `get_post_votes(post_id)` | query | `vec VoteResponse` |
| `get_post_votes_for_neurons(post_id, vec NeuronId)` | query | `opt ThreadVoteResponse` (`[]` when none of them voted) |
| `get_thread_votes_for_neurons(thread_id, vec NeuronId)` | query | `vec ThreadVoteResponse` (posts where any of them voted) |

### 6.5 Polls

| Method | Kind | Returns |
|---|---|---|
| `create_poll(CreatePollInput)` | update | `Result_1` (poll id) |
| `vote_on_poll_with_neurons(poll_id, option_id, vec NeuronId)` | update | `Result` |
| `get_poll(id)` | query | `opt PollResponse` |
| `get_polls_by_thread(thread_id)` / `get_polls_by_post(post_id)` | query | `vec PollResponse` |
| `get_poll_votes(poll_id)` | query | `vec PollVoteResponse` |

### 6.6 Tips

| Method | Kind | Returns |
|---|---|---|
| `create_tip(to_principal, post_id, token_ledger_principal, amount, transaction_block_index : opt nat)` | update | `Result_1` (tip id). Errors: `Unauthorized("Authentication required to create tips")`, `NotFound("Post not found")`, and the ledger check's (3.11). |
| `verify_tip(tip_id)` | update | `variant { ok : bool; err : ForumError }`: whether the tip is verified now. `Unauthorized("Authentication required")`, `NotFound("Tip not found")`. |
| `get_tip(id)` | query | `opt TipResponse` |
| `get_tips_by_post(post_id)` / `get_tips_by_thread(thread_id)` | query | `vec TipResponse` |
| `get_tips_given_by_user(user)` / `get_tips_received_by_user(user)` | query | `vec TipResponse` |
| `get_tips_received_since(user, since : int)` | query | `vec TipResponse` (strictly newer; verified only) |
| `get_recent_tips_received(user)` / `get_recent_tips_count(user)` | query | since the user's tip mark; verified only |
| `get_tip_tokens_received_by_user(user)` | query | `vec TipTokenSummary` (verified only) |
| `get_tip_stats()` | query | `TipStats` (verified only) |

### 6.7 Mentions, read state and seen marks

| Method | Kind | Returns |
|---|---|---|
| `get_mentions_of_user(user, before : opt nat, limit : nat)` | query | `MentionsPage` |
| `get_recent_mentions_count(user)` | query | `nat` |
| `mark_mentions_seen_up_to(timestamp : int)` | update | `()` |
| `get_last_seen_mentions_timestamp(user)` | query | `opt int` |
| `set_mention_sms(on : bool)` | update | `Result`; `Unauthorized("Log in to change this setting")` for the anonymous caller |
| `get_mention_sms(user)` | query | `bool` |
| `get_mention_sms_opted_in(users : vec principal)` | query | `vec principal` |
| `get_recent_replies_count(user)` | query | `nat` |
| `mark_replies_seen_up_to(timestamp)` / `get_last_seen_replies_timestamp(user)` | update / query | `()` / `opt int` |
| `mark_tips_seen_up_to(timestamp)` / `get_last_seen_tip_timestamp(user)` | update / query | `()` / `opt int` |
| `set_last_read_post(SetLastReadPostRequest)` | update | `SetLastReadPostResponse` |
| `get_last_read_post(GetLastReadPostRequest)` | query, caller | `GetLastReadPostResponse` |
| `get_user_thread_reads_for_topic(topic_id)` | query, caller | `vec record { nat; nat }` |

### 6.8 Proposals and standard topics

| Method | Kind | Returns |
|---|---|---|
| `create_sns_forum_setup(sns_root)` | update | `Result_1` (proposals topic id); `Unauthorized("Authentication required to create an SNS forum setup")` |
| `create_proposal_thread(CreateProposalThreadInput)` | update | `Result_1` (thread id); `Unauthorized("Authentication required to create proposal threads")` |
| `create_proposal_thread_with_auto_setup(CreateProposalThreadInput)` | update | `Result_1`; also `InternalError("Forum creation failed")` / `("Proposals topic creation failed")` |
| `create_special_topic(CreateSpecialTopicInput)` | update | `Result_1` (topic id); `Unauthorized("Authentication required to create special topics")` |
| `get_proposal_thread(sns_root, proposal_id)` | query | `opt ProposalThreadMappingResponse` |
| `get_thread_proposal_id(thread_id)` | query | `opt record { nat32; nat }` (internal root index, proposal id) |
| `get_proposals_topic(forum_id)` / `get_proposals_topic_by_sns_root(root)` | query | `opt ProposalTopicMappingResponse` |

### 6.9 Other

| Method | Kind | Returns |
|---|---|---|
| `get_api_doc()` | query | `text`: a short Markdown guide for AI agents (units, authentication, irreversible actions, polling, pitfalls) linking this document and `https://app.sneeddao.com/llms.txt` |
| `check_user_premium_status(user)` | update | `bool` |
| `get_notifications_canister()` | query | `opt principal` |
| `get_admins()` | query | `vec AdminInfo` (the listed admins; Sneed governance and the controllers are admins without being listed) |
| `is_admin(principal)` | query | `bool` |

### 6.10 Admin methods

Admins are Sneed DAO's governance canister (`fi3zi-fyaaa-aaaaq-aachq-cai`), the canister's controllers and the principals in `get_admins()`. Unauthorised calls get `Unauthorized("Admin access required")` (or the message noted).

| Method | What it does |
|---|---|
| `add_admin(p)` / `remove_admin(p)` | Manage the admin list (`Only admins can add new admins`, `Cannot remove the last admin`). |
| `create_forum(CreateForumInput)` / `update_forum(id, input)` | Create or edit a forum. |
| `create_topic(CreateTopicInput)` / `update_topic(id, input)` | Create or edit a topic; a topic cannot become its own ancestor. |
| `delete_forum` / `delete_topic` / `delete_thread(id)` | Soft delete. |
| `undelete_forum` / `undelete_topic` / `undelete_thread` / `undelete_post(id)` | Restore. |
| `get_forum_admin`, `get_forums_admin`, `get_topic_admin`, `get_topics_by_forum_admin`, `get_thread_admin`, `get_threads_by_topic_admin`, `get_post_admin`, `get_posts_by_thread_admin`, `get_post_replies_admin` | Reads that include deleted items; empty or null for non-admins. |
| `set_proposals_topic({ forum_id; topic_id })` / `remove_proposals_topic(forum_id)` | Register or clear a forum's proposals topic. |
| `update_text_limits(UpdateTextLimitsInput)` | Change limits; `[]` fields keep their value. |
| `update_premium_config(UpdatePremiumConfigInput)` | Premium canister and premium body limits (`sneed_premium_canister_id`: `[]` no change, `[[]]` clear, `[[id]]` set). |
| `admin_set_notifications(opt principal)` | Where notifications go (`Admins only`). |

---

## 7. Types

```candid
type NeuronId = record { id : blob };
type VoteType = variant { upvote; downvote };

type ForumError = variant {
  NotFound : text; Unauthorized : text; InvalidInput : text;
  AlreadyExists : text; InternalError : text;
};
type Result = variant { ok; err : ForumError };
type Result_1 = variant { ok : nat; err : ForumError };

type CreateForumInput = record { title : text; description : text; sns_root_canister_id : opt principal };
type CreateTopicInput = record { forum_id : nat; parent_topic_id : opt nat; title : text; description : text };
type CreateThreadInput = record { topic_id : nat; title : opt text; body : text };

type ForumResponse = record {
  id : nat; title : text; description : text; sns_root_canister_id : opt principal;
  created_by : principal; created_at : int; updated_by : principal; updated_at : int; deleted : bool;
};
type TopicResponse = record {
  id : nat; forum_id : nat; parent_topic_id : opt nat; title : text; description : text;
  created_by : principal; created_at : int; updated_by : principal; updated_at : int; deleted : bool;
};
type ThreadResponse = record {
  id : nat; topic_id : nat; title : opt text; body : text;
  created_by : principal; created_at : int; updated_by : principal; updated_at : int; deleted : bool;
  unread_posts_count : opt nat;   // only from the *_with_unread_counts methods
  total_posts_count : opt nat;
};
type PostResponse = record {
  id : nat; thread_id : nat; reply_to_post_id : opt nat; title : opt text; body : text;
  upvote_score : nat; downvote_score : nat;          // sums of voting power
  created_by : principal; created_at : int; updated_by : principal; updated_at : int; deleted : bool;
};
type ThreadContextResponse = record { thread_id : nat; topic_id : nat; forum_id : nat; sns_root_canister_id : opt principal };
type GetThreadsByActivityResponse = record { threads : vec ThreadResponse; has_more : bool; next_start_from : opt nat };

type VoteResponse = record {
  post_id : nat; neuron_id : NeuronId; voter_principal : principal; vote_type : VoteType;
  voting_power : nat; created_at : int; updated_at : int;
};
type NeuronVote = record { neuron_id : NeuronId; vote_type : VoteType; voting_power : nat; created_at : int; updated_at : int };
type ThreadVoteResponse = record { post_id : nat; neuron_votes : vec NeuronVote };

type CreatePollOptionInput = record { title : text; body : opt text };
type CreatePollInput = record {
  thread_id : nat; post_id : opt nat; title : text; body : text;
  options : vec CreatePollOptionInput;
  vp_power : opt float64;          // default 1.0; weight = voting_power ^ vp_power
  end_timestamp : int;             // ns
  allow_vote_changes : opt bool;   // default true
};
type PollOptionResponse = record { id : nat; title : text; body : opt text; vote_count : nat; total_voting_power : nat };
type PollResponse = record {
  id : nat; thread_id : nat; post_id : opt nat; title : text; body : text;
  options : vec PollOptionResponse; vp_power : float64; end_timestamp : int; allow_vote_changes : bool;
  created_by : principal; created_at : int; updated_by : principal; updated_at : int; deleted : bool;
  has_ended : bool;
};
type PollVoteResponse = record {
  poll_id : nat; option_id : nat; neuron_id : NeuronId; voter_principal : principal;
  voting_power : nat; created_at : int; updated_at : int;
};

type TipResponse = record {
  id : nat; from_principal : principal; to_principal : principal; post_id : nat; thread_id : nat;
  token_ledger_principal : principal; amount : nat; transaction_block_index : opt nat;
  created_at : int; created_by : principal;
  verified : opt bool;            // true: confirmed on the ledger; false: not confirmed; null: recorded before tips were checked
  verification_note : opt text;   // why it is not verified
};
type TipTokenSummary = record { token_ledger_principal : principal; total_amount : nat; tip_count : nat };
type TipStats = record { total_tips : nat; total_tip_amount_by_token : vec record { principal; nat } };

type MentionResponse = record {
  index : nat;                 // position in the user's list, for paging
  thread_id : nat; post_id : opt nat;   // post_id = null: the thread's own text
  by : principal; created_at : int;
  thread_title : opt text; title : opt text; excerpt : text;   // excerpt: first 200 characters
};
type MentionsPage = record { items : vec MentionResponse; next : opt nat };

type FeedItemType = variant { forum; topic; thread; post };
type FeedItem = record {
  id : nat; item_type : FeedItemType; title : opt text; body : opt text;
  created_by : principal; created_at : int;
  sns_root_canister_id : opt principal; forum_id : opt nat; forum_title : opt text;
  topic_id : opt nat; topic_title : opt text; thread_id : opt nat; thread_title : opt text;
  poll_id : opt nat;
  replied_to_post : opt record { id : nat; title : opt text; body : text };
};
type FeedFilter = record {
  sns_root_canister_ids : opt vec principal; topic_ids : opt vec nat;
  creator_principals : opt vec principal; search_text : opt text;
};
type GetFeedInput = record { start_id : opt nat; length : nat; filter : opt FeedFilter };
type GetFeedResponse = record { items : vec FeedItem; has_more : bool; next_start_id : opt nat };

type SetLastReadPostRequest = record { thread_id : nat; last_read_post_id : nat };
type SetLastReadPostResponse = record { success : bool; message : text };
type GetLastReadPostRequest = record { thread_id : nat };
type GetLastReadPostResponse = record { last_read_post_id : opt nat };
type TopicStatistics = record { topic_id : nat; thread_count : nat; total_unread_posts : nat };

type CreateProposalThreadInput = record { proposal_id : nat; sns_root_canister_id : principal };
type ProposalThreadMappingResponse = record {
  thread_id : nat; proposal_id : nat; sns_root_canister_id : principal; created_by : principal; created_at : int;
};
type ProposalTopicMappingResponse = record { forum_id : nat; proposals_topic_id : nat; set_by : principal; set_at : int };
type SpecialTopicType = variant { General; Governance; Preproposals };
type CreateSpecialTopicInput = record { sns_root_canister_id : principal; special_topic_type : SpecialTopicType };

type TextLimits = record {
  post_title_max_length : nat; post_body_max_length : nat;
  thread_title_max_length : nat; thread_body_max_length : nat;
  topic_title_max_length : nat; topic_description_max_length : nat;
  forum_title_max_length : nat; forum_description_max_length : nat;
};
type PremiumConfig = record {
  sneed_premium_canister_id : opt principal;
  premium_post_body_max_length : nat; premium_thread_body_max_length : nat;
};
type ForumStats = record { total_forums : nat; total_topics : nat; total_threads : nat; total_posts : nat; total_votes : nat };
type AdminInfo = record { "principal" : principal; added_by : nat32; added_at : int };
```

The Candid file names some of these differently (`Result_1` and friends are generated); the shapes are the same. In JavaScript, `opt T` arrives as `[]` or `[value]`, `nat` and `int` as `BigInt`, variants as objects with one key (`{ upvote: null }`, `{ ok: 42n }`, `{ err: { NotFound: '...' } }`).

---

## 8. Integration checklist

- [ ] Use the **staging** canister `nrtf2-wiaaa-aaaad-aankq-cai` first. It runs the same code with its own state against the real SNS canisters, so votes use real neurons.
- [ ] Find a DAO's forum with `get_forum_by_sns_root`; if there is none, `create_sns_forum_setup` makes the standard structure.
- [ ] Read `get_text_limits()` (and `get_premium_config()`) and check lengths before sending; production limits are lower than the code defaults.
- [ ] Sign query calls that use the caller (unread counts, read marks), or every post looks unread.
- [ ] Build reply trees from `reply_to_post_id`; hide or grey out `deleted` items where a method may return them.
- [ ] Vote with neurons: show users which reachable neurons will vote (`get_thread_votes_for_neurons` for their current votes) and pass explicit ids for polls.
- [ ] For tips, transfer from the user's main account to the author's main account first, then `create_tip` with the block index; if it fails, never repeat the transfer. Show and count only tips with `verified = ?true`.
- [ ] Write mentions as `[@Name](https://app.sneeddao.com/principal?id=<principal>)`; if you send mention SMS, ask `get_mention_sms_opted_in` and send them from the poster's principal.
- [ ] Move the seen marks (`mark_*_seen_up_to`) when the user has seen replies, tips and mentions; set read marks with `set_last_read_post`.
- [ ] Link to `https://app.sneeddao.com/thread?threadid=<id>` and `https://app.sneeddao.com/post?postid=<id>` for the public views.
- [ ] Remember everything you write is public and permanent: deletion only hides.

Questions, bugs, or an integration you would like listed here: open an issue on [GitHub](https://github.com/Snassy-icp/app_sneeddao/issues) or post in the Sneed DAO forum at [app.sneeddao.com/forum](https://app.sneeddao.com/forum).
