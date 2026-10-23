# Sneed SMS canister API

Sneed SMS is the direct-message canister of Sneed DAO on the Internet Computer: short messages ("SMS") from one principal to one or more others, with a subject, a body and optional replies to earlier messages. Sneed Hub's inbox, the forum's mention alerts and Sneed Notifications all deliver through it. Any principal can send and read its own messages through any front end; the canister authorises calls by the calling principal only.

| | |
|---|---|
| Production canister | `zelpl-7yaaa-aaaad-abtcq-cai` |
| Staging canister | `v33jy-4qaaa-aaaad-absna-cai` (separate state, same code line; use it to test) |
| Candid interface | [sneed_sms.did](/api-docs/sneed_sms.did) · [JavaScript IDL factory](/api-docs/sneed_sms.did.js) |
| Source | [src/sneed_sms/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_sms/main.mo) |
| Reference frontend | [app.sneeddao.com/sms](https://app.sneeddao.com/sms) ([source](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend)) |
| This document | [rendered](/api/sneed_sms) · [raw Markdown](/api-docs/sneed_sms.md) |

The production canister is controlled by the Sneed DAO SNS (root `fp274-iaaaa-aaaaq-aacha-cai`); upgrades are decided by proposals. The method set below matches the source on `main` and the deployed interface.

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister (units and encoding, authentication, fees, transfers and irreversible actions, asynchronous flows and polling, common pitfalls) that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 Messages

A message has an id (a global counter starting at 1), one sender, a list of recipients, a `subject`, a `body`, an optional list of message ids it replies to (`reply_to`), and `created_at` / `updated_at` timestamps. Messages cannot be edited. `updated_at` changes only when someone leaves the message (1.4).

Every recipient sees the full recipient list; there is no blind copy.

### 1.2 Who can read a message

Read this before you build on Sneed SMS. **Messages are not encrypted.** The subject and body are stored as plain text in the canister's memory.

| Who | What they can read |
|---|---|
| The sender | The message, through `get_message`, `get_sent_messages`, `get_all_messages`, until they remove themselves from it |
| Each current recipient | The message, through `get_message`, `get_received_messages`, `get_all_messages`, until they remove themselves from it |
| Admins of the canister | **Every message**, through `get_all_messages_admin` and `admin_get_messages_page`. Admins are the Sneed DAO governance canister (`fi3zi-fyaaa-aaaaq-aachq-cai`), the canister's controllers (the SNS root) and the principals in `get_admins()`. |
| Anyone | No message content. Anyone can read the totals (`get_stats`), and for **any** principal how many received messages are newer than their last-seen mark (`get_recent_messages_count`) and that mark itself (`get_last_seen_messages_timestamp`). |
| The subnet's node machines | The canister's state lives on the machines of its subnet, like every canister's. Do not put secrets in a message. |

Sending a message is a signed update call from the sender's principal. Who sent what to whom is recorded with the principals themselves; nothing about it is anonymous.

### 1.3 Limits and premium

Each message is checked against the plain limits (`get_config()`) or, for Sneed Premium members, the premium limits (`get_premium_config()`). Membership is read from the Sneed Premium canister named in the premium config (`7gump-4aaaa-aaaal-qtyka-cai` on production) and cached; if it cannot be reached, the plain limits apply. Values on production on 2026-10-20 (read them at run time, the DAO can change them):

| | Plain | Premium |
|---|---|---|
| Minutes between two messages of one sender | 10 | 1 |
| Subject length (characters) | 100 | 200 |
| Body length (characters) | 2,000 | 12,000 |
| Recipients per message | 5 | 50 |

Lengths count Unicode characters (`Text.size`). Subject and body must not be empty. Admins and the principals on the exempt list (below) are exempt from the rate limit.

On top of the minutes between messages, each sender has a **burst limit** (`get_send_rate_limit()`, a token bucket: `capacity` messages in a row, refilled at `per_minute` a minute; default 10 and 2, capacity 0 turns it off). It stops a flood at ingress, before the premium lookup and before any work. Over it, `send_message` from outside the IC is refused at ingress; a call that gets through anyway (or comes from a canister) answers `RateLimited("Too many messages in a row: at most N, then M a minute. Please try again in a minute.")` and stores nothing. Admins and the principals on the exempt list (`get_rate_limit_exempt()`) are exempt from the burst limit and from the minutes between messages: an integrator whose canister or bot sends in bursts asks Sneed DAO to put its principal on that list instead of raising the limits for everyone. Rules are capped at 100,000 for `capacity` and `per_minute`. The buckets live in memory, so an upgrade refills them.

### 1.4 Leaving a message

`remove_self_from_message(id)` takes the caller off a message:
- A **recipient** who leaves is removed from the recipient list and loses access.
- A **sender** who leaves loses access; from then on the message shows the anonymous principal `2vxsx-fae` as its sender to everyone, including admins. The canister keeps the original sender's index internally; leaving only hides it from the replies of the API.
- When nobody is left on a message (the sender has left and no recipients remain), the message is deleted.

There is no other way to delete a message.

### 1.5 System messages

Canisters on the canister's `authorized_senders` list may call `send_system_notification` to write to users without the rate limit and with the premium size limits. Such a message shows `get_system_sender_principal()` as its sender (the calling canister when none is set). Sneed Notifications delivers its "Sneed SMS" channel this way. System messages never trigger a notification (§1.6).

### 1.6 Notifications for new messages

When admins have set a Sneed Notifications canister (`get_notifications_canister()`), each message sent with `send_message` also gives every recipient a heads-up through [Sneed Notifications](/api/sneed_notifications): app Sneed Hub (it must be allowed by the recipient), topic `direct_message` (level normal), title `New message from abcde…xyz` (the sender's principal, shortened), body the message **subject** (up to 200 characters) and, on the next line, the **start of the text, at most 100 characters**: cut at the last space before the limit (a single word longer than that is cut at 100), never inside a link (a word with `http://` or `https://` in it that the limit would cut is left out whole), with `…` when anything was cut; link `https://app.sneeddao.com/msg/<id>`, dedupe key `sms-<id>`, not sponsored (the recipient pays their own paid channels, as for forum notifications). **A recipient can turn the preview off** with `set_notification_preview(false)` (read it with the query `get_notification_preview()`, default on); then only the subject is sent. The preview passes through the relays: Discord can read DMs, and phone notifications show on the lock screen (web push itself is end-to-end encrypted to the device). Each recipient once (duplicates folded, never the sender, at most 100). The call is fire-and-forget with a bounded wait: sending never waits on it and never fails because of it. Unset, nothing is sent.

No loop: only `send_message` notifies, never `send_system_notification` (which is how Sneed Notifications copies every notification into the user's inbox), and Sneed Notifications never delivers anything this canister sends to Sneed SMS channels. The heads-up therefore goes to the recipient's other channels (push, Discord…) only.

### 1.7 Time and ids

Timestamps (`created_at`, `updated_at`, last-seen marks) are `int` nanoseconds since the Unix epoch, as `Time.now()` in Motoko and `BigInt(Date.now()) * 1_000_000n` in JavaScript. Message ids are `nat`.

### 1.8 Calls the canister refuses at ingress

Before it accepts an update call from outside the IC the canister checks it (`inspect`), and a refused call costs nobody anything:

- **Query methods only answer query calls.** Calling one as an update is refused.
- **`send_message`** is refused when the sender has used up the burst limit (§1.3), when `reply_to` names more than 100 ids, when there are more recipients than the larger of the plain and premium recipient limits, or when the subject or body is longer than the larger of the two limits. The method itself then applies the caller's own limits.
- **`send_system_notification`** is held to the premium limits.
- **The activity log's admin methods** (`admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`) are refused unless the caller is an admin.
- **Every other update** takes at most 4 KiB of arguments; `import_admins` and `import_messages` are accepted only from controllers.

---

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './sneed_sms.did.js'; // https://app.sneeddao.com/api-docs/sneed_sms.did.js

const SNEED_SMS = 'zelpl-7yaaa-aaaad-abtcq-cai';

export function smsActor(identity) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId: SNEED_SMS });
}
```

With dfx:

```bash
dfx canister --network ic call zelpl-7yaaa-aaaad-abtcq-cai get_config '()' --query
```

### 2.2 Send a message

```js
import { Principal } from '@dfinity/principal';

async function sendSms(identity, toText, subject, body, replyTo = []) {
  const sms = smsActor(identity);
  const r = await sms.send_message({
    recipients: [Principal.fromText(toText)],
    subject,
    body,
    reply_to: replyTo.length ? [replyTo.map(BigInt)] : [],   // opt vec nat
  });
  if ('err' in r) {
    const [kind, message] = Object.entries(r.err)[0];       // e.g. ['RateLimited', 'Must wait 7 more minutes ...']
    throw new Error(`${kind}: ${message}`);
  }
  return r.ok;                                              // the new message id
}
```

### 2.3 Read the inbox and count unread

```js
async function inbox(identity) {
  const sms = smsActor(identity);
  const me = identity.getPrincipal();
  const [received, lastSeen, unread] = await Promise.all([
    sms.get_received_messages_page({ before: [], after: [], limit: 50n }), // newest first
    sms.get_last_seen_messages_timestamp(me),    // [] or [ns]
    sms.get_recent_messages_count(me),
  ]);
  return { received: received.messages, more: received.has_more, lastSeen: lastSeen[0] ?? 0n, unread };
}

// When the user has looked at the inbox:
async function markSeen(identity, received) {
  const newest = received.reduce((m, x) => (x.created_at > m ? x.created_at : m), 0n);
  if (newest > 0n) await smsActor(identity).mark_messages_seen_up_to(newest);
}
```

### 2.4 Leave a message

```js
const r = await smsActor(identity).remove_self_from_message(42n);
if ('err' in r) console.error(r.err);
```

---

## 3. Flows in detail

### 3.1 Sending

`send_message(input)` runs these checks in order and returns the first failure:

1. Anonymous caller → `Unauthorized("Anonymous callers cannot send messages")`.
2. Burst limit (§1.3) → `RateLimited("Too many messages in a row: ...")`. A refused call still counts as an attempt.
3. Premium lookup (an inter-canister call, cached), which chooses the limits.
4. Rate limit → `RateLimited("Must wait N more minutes before sending another message")`. Minutes are whole minutes since the caller's last message.
5. Subject and body → `InvalidInput("Subject cannot be empty")`, `InvalidInput("Subject exceeds maximum length of N characters")`, and the same for `Body`.
6. Recipients → `InvalidInput("At least one recipient is required")`, `InvalidInput("Too many recipients. Maximum is N")`.
7. Each `reply_to` id → `NotFound("Reply message N not found")`, or `Unauthorized("Cannot reply to message N - access denied")` when the caller cannot read it.

On success the message is stored, indexed for the sender and each recipient, the caller's rate-limit clock is reset, the recipients are notified when Sneed Notifications is set (§1.6, best effort), and the id is returned. Recipients are not checked or de-duplicated: list each principal once (a principal listed twice gets the message twice in its received list). Any principal can be a recipient, including canisters and principals that never used Sneed SMS. The sender may include themselves.

### 3.2 Reading

`get_sent_messages`, `get_received_messages` and `get_all_messages` return every matching message in one reply, oldest first (`get_all_messages`: sent first, then received ones not sent by the caller). They are kept for compatibility; for an inbox prefer the paged reads below. `get_message(id)` returns `null` both for a message that does not exist and for one the caller cannot read.

**Paged reads.** `get_received_messages_page(args)` and `get_sent_messages_page(args)` take `record { before : opt nat; after : opt nat; limit : nat }` and return a `MessagePage` (§6) of the caller's own list:

| `after` | `before` | Messages | Order |
|---|---|---|---|
| null | null | the newest | **descending** (newest first) |
| null | `b` | ids below `b` (older pages: pass the lowest id you hold) | **descending** |
| `a` | null | ids above `a` (what is new since `a`: pass the highest id you hold) | **ascending** |
| `a` | `b` | ids between them | **ascending** |

- At most `min(limit, 100)` messages and about 1 MB of subject and text per reply (always at least one). `has_more` says more messages lie further in the page's direction; continue from the last id of the page.
- `limit = 0` returns no messages, only the markers: a cheap "did anything change?" check.
- `total` (how many distinct messages the caller's list holds now) and `last_updated` (the greatest `updated_at` in it, `0` when empty) describe the whole list, whatever the page. A client that caches the newest messages keeps both: after reading what is new, `total` lower than the old `total` plus the new messages means something was removed, and `last_updated` above the newest `updated_at` it has seen means a message changed (someone left it; the sender shows as `2vxsx-fae` once they leave). Then reload the newest page.
- A message whose recipient list names the caller twice appears once.
- Canisters older than these methods reject the call with "method not found": fall back to the full lists.

```js
// Newest 50, then older on demand, then poll for new ones
const first = await sms.get_received_messages_page({ before: [], after: [], limit: 50n });
const older = await sms.get_received_messages_page({ before: [first.messages.at(-1).id], after: [], limit: 50n });
const fresh = await sms.get_received_messages_page({ before: [], after: [first.messages[0].id], limit: 100n });
```

Each `MessageResponse` carries `can_remove_self`, true when the caller is a current recipient or the sender who has not left.

### 3.3 Unread counts

The canister keeps one "last seen" timestamp per principal. `get_recent_messages_count(user)` counts the messages `user` has received with `created_at` greater than it. `mark_messages_seen_up_to(ts)` sets it for the caller (any value; it is not checked against the clock and may move backwards). It does nothing for a principal the canister has never seen as a sender or recipient.

### 3.4 Leaving

`remove_self_from_message(id)` errors: `NotFound("Message not found")`, `Unauthorized("Cannot access this message")` (not a current participant), `InvalidInput("You are not associated with this message")`. See 1.4 for the effects.

---

## 4. Concurrency, errors and retries

**Result shapes.** Updates return `variant { ok; err : SMSError }`, where

```candid
type SMSError = variant {
  Unauthorized : text; NotFound : text; InvalidInput : text; RateLimited : text; AlreadyExists : text;
};
```

The text is meant for people; branch on the variant tag.

**Retries.** `send_message` is not idempotent: two successful calls send two messages. Its only await is the premium lookup, which happens before any state is read or written, so a rejected call has stored nothing. After a timeout, list `get_sent_messages()` and look for the message before sending again; a retry inside the rate-limit window gets `RateLimited` if the first call went through.

**`remove_self_from_message`** has no awaits; calling it again after success returns `Unauthorized("Cannot access this message")` or `NotFound`.

---

## 5. Method reference

"Caller" means the principal signing the call. Methods marked *query* can be called without a signature, but the caller-scoped ones then answer for the anonymous principal.

### 5.1 Messages

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `send_message(CreateMessageInput)` | update | `Result<nat, SMSError>` | 3.1. Returns the message id. |
| `get_message(id : nat)` | query | `opt MessageResponse` | Null if missing or not readable by the caller. |
| `get_sent_messages()` | query | `vec MessageResponse` | Messages the caller sent and has not left. |
| `get_received_messages()` | query | `vec MessageResponse` | Messages the caller receives and has not left. |
| `get_all_messages()` | query | `vec MessageResponse` | Both, without duplicates. |
| `get_received_messages_page(PageArgs)` | query | `MessagePage` | Received, paged: newest first, or ascending after an id (3.2). |
| `get_sent_messages_page(PageArgs)` | query | `MessagePage` | Sent, paged the same way (3.2). |
| `remove_self_from_message(id : nat)` | update | `Result<(), SMSError>` | 1.4, 3.4. |

### 5.2 Unread counts

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `get_recent_messages_count(user : principal)` | query | `nat` | Received messages of `user` newer than their last-seen mark. Answers for any principal. |
| `mark_messages_seen_up_to(timestamp : int)` | update | `()` | Sets the caller's mark (ns). |
| `get_last_seen_messages_timestamp(user : principal)` | query | `opt int` | `user`'s mark, if any. |

### 5.3 Configuration and statistics (public)

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `get_config()` | query | `{ rate_limit_minutes; max_subject_length; max_body_length; max_recipients }` | Plain limits (all `nat`). |
| `get_premium_config()` | query | `{ sneed_premium_canister_id : opt principal; premium_max_subject_length; premium_max_body_length; premium_rate_limit_minutes; premium_max_recipients }` | Premium limits. |
| `get_stats()` | query | `{ total_messages : nat; total_users : nat }` | `total_users` counts every principal ever indexed (senders, recipients and admin adders). |
| `get_system_sender_principal()` | query | `opt principal` | Shown as sender of system messages. |
| `get_admins()` | query | `vec AdminInfo` | The admin list (governance and controllers are admins without being listed). |
| `is_admin_query(p : principal)` | query | `bool` | Whether `p` is an admin. |
| `get_rate_limit_exempt()` | query | `vec principal` | Principals exempt from the rate limits (§1.3). |
| `get_send_rate_limit()` | query | `RateRule = record { capacity : nat; per_minute : nat }` | The burst limit per sender (§1.3). |

### 5.4 System messages (authorised canisters)

**`send_system_notification({ recipients : vec principal; subject : text; body : text }) → Result<nat, SMSError>`**
Only for principals on the authorised-sender list (`Unauthorized("Caller is not authorized to send system notifications")`). No rate limit. Errors: `InvalidInput("Subject too long. Maximum is N")`, `InvalidInput("Body too long. Maximum is N")`, `InvalidInput("At least one recipient is required")`, `InvalidInput("Too many recipients. Maximum is N")`, all against the premium limits. Empty subjects and bodies are allowed here. Never sends a notification (§1.6). Returns the message id. To get on the list, ask Sneed DAO (an admin call, usually by proposal).

### 5.5 Admin methods

Restricted to admins (governance, controllers, listed admins) unless noted. Integrators do not call them.

| Method | What it does |
|---|---|
| `add_admin(p)`, `remove_admin(p)` | Edit the admin list. |
| `update_config(opt rate_limit_minutes, opt max_subject_length, opt max_body_length, opt max_recipients)` | Change the plain limits (null = unchanged). |
| `update_premium_config(opt opt premium_canister, opt …)` | Change the premium canister (`[]` unchanged, `[[]]` clear) and limits. |
| `get_authorized_senders()`, `add_authorized_sender(p)`, `remove_authorized_sender(p)` | The canisters allowed to call `send_system_notification`. |
| `set_system_sender_principal(opt p)` | The sender shown on system messages. |
| `admin_set_notifications(opt p) → Result<(), SMSError>` | The Sneed Notifications canister told of new messages (§1.6); `[]` turns it off. `get_notifications_canister() → opt principal` is a public query. |
| `get_all_messages_admin()` | Every message (empty for non-admins). Unpaged: use `admin_get_messages_page`. |
| `admin_get_messages_page(before : opt nat, limit : nat) → AdminMessagePage` | Every message, newest first: ids below `before` (`[]` for the newest), at most 100 messages and about 1 MB a page (always at least one), at most 10,000 ids looked at. `record { messages : vec MessageResponse; total : nat; next_before : opt nat }`: pass `next_before` as `before` until it is `[]`; a page may hold fewer messages than asked, even none, while `next_before` is set. Query; empty for non-admins. |
| `admin_set_rate_limit_exempt(principal, exempt : bool) → Result<(), SMSError>` | Put a principal on the exempt list or take it off. Logged as `config_update` with key `rate_limit_exempt`, `principal`, and `old_value` / `value` 1 (exempt) or 0. |
| `admin_set_send_rate_limit(RateRule) → Result<(), SMSError>` | Set the burst limit per sender (`per_minute` at least 1 unless `capacity` is 0, which turns it off). Logged as `config_update` with key `send_rate_limit`. |
| `import_admins(vec AdminInfo)`, `import_messages(vec MessageResponse)` | Controllers only: restore data after a migration. |
| `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`, `get_log(start, length)` | The activity log's settings, archiving and operational messages ([7](#7-activity-log-icrc-3)). |

---

## 6. Types

```candid
type CreateMessageInput = record {
  recipients : vec principal;
  subject : text;
  body : text;
  reply_to : opt vec nat;          // ids of messages this one answers
};

type MessageResponse = record {
  id : nat;
  sender : principal;              // 2vxsx-fae once the sender has left the message
  recipients : vec principal;      // current recipients
  subject : text;
  body : text;
  reply_to : opt vec nat;
  created_at : int;                // ns since the Unix epoch
  updated_at : int;                // changes when someone leaves
  can_remove_self : bool;          // the caller is still on the message
};

type PageArgs = record {
  before : opt nat;                // only ids below this
  after : opt nat;                 // only ids above this; set: ascending, null: descending
  limit : nat;                     // at most 100 per reply; 0 = markers only
};

type MessagePage = record {
  messages : vec MessageResponse;  // ascending with `after`, otherwise descending
  total : nat;                     // distinct messages in the caller's list now
  last_updated : int;              // greatest updated_at in the caller's list (0 if empty)
  has_more : bool;                 // more messages further in the page's direction
};

type AdminMessagePage = record {   // admin_get_messages_page
  messages : vec MessageResponse;  // descending ids
  total : nat;                     // all messages in the canister
  next_before : opt nat;           // `before` of the next page; null at the end
};

type RateRule = record { capacity : nat; per_minute : nat };

type AdminInfo = record { principal : principal; added_by : nat32; added_at : int };

type SMSError = variant {
  Unauthorized : text; NotFound : text; InvalidInput : text; RateLimited : text; AlreadyExists : text;
};
```

`Result<T, SMSError>` is `variant { ok : T; err : SMSError }` (lowercase tags).

---

## 7. Activity log (ICRC-3)

Admin and configuration acts are recorded as blocks in a hash-chained, certified log, readable through the standard [ICRC-3](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3) interface: who was made an admin or removed, which canisters may send system messages, the system sender, the notifications canister, the limits and premium settings, data imports and the log's own settings. Each block carries the hash of the previous block (`phash`), and the canister certifies the index and hash of the latest block, so anyone can download the history and prove it complete and untampered. Old blocks move to archive canisters that Sneed SMS creates.

**Messages are never logged.** No block holds a subject, a text, a sender or a recipient of a message, nor anything a user does with their own messages or settings (sending, reading, leaving a message, read marks, the preview switch). The log is about who holds power over the canister and how they use it; the messages themselves stay where they are (§1.2).

The log uses the same library as [Sneed Lock's log](/api/sneed_lock#8-activity-log-icrc-3) ([src/icrc3](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/icrc3)); the design, including what is deliberately not logged, is in [spec/sms_icrc3.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sms_icrc3.md). It starts empty with the release that introduced it; nothing from before is imported.

### 7.1 Endpoints

| Method | Type | Returns |
|---|---|---|
| `icrc3_get_blocks(vec record { start : nat; length : nat })` | query | `{ log_length; blocks : vec { id; block }; archived_blocks : vec { args; callback } }`. Live blocks come back directly; for archived ranges call `callback` (that archive's own `icrc3_get_blocks`) with `args`. |
| `icrc3_get_archives(record { from : opt principal })` | query | Every archive canister with the first and last block index it holds. |
| `icrc3_get_tip_certificate()` | query | `opt { certificate; hash_tree }` with `last_block_index` and `last_block_hash`. Null until the first block exists. |
| `icrc3_supported_block_types()` | query | Every `btype` below, each with the url of [7.3](#73-block-types). |
| `icrc10_supported_standards()` | query | ICRC-3 and ICRC-10. |
| `icrc3_log_status()` | query | Log length, live blocks, hash of the last block, archives, spill settings. `history_imported` is always false. |

Admin only: `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers` (as on Sneed Lock) and `get_log(start, length)`, the log's operational messages (spills, archives created, failures). Archives are controlled by Sneed SMS and the Sneed SNS root (`fp274-iaaaa-aaaaq-aacha-cai`) until a `RegisterDappCanisters` proposal hands them to SNS root alone.

### 7.2 Block format

A block is a `Map` with `btype` (Text), `ts` (Nat, ns since epoch: when the action happened), `phash` (Blob, absent on block 0) and `tx` (Map). Inside `tx`: principals are `Blob` (raw principal bytes), numbers `Nat`; `caller` is the principal that made the call; optional fields are omitted when absent. A principal setting that is not set is the Text `none` in `config_update` values.

### 7.3 Block types

All types carry the `sneedsms_` prefix. A block is appended in the message that made the change; a refused call, and a call that changes nothing (setting a value it already has, adding what is there), appends nothing.

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedsms_admin_add` | `add_admin`, or `import_admins` adding an admin (then `source` = `import_admins`). | `caller`, `principal`, `source` |
| `sneedsms_admin_remove` | `remove_admin` | `caller`, `principal` |
| `sneedsms_authorized_sender_add` / `sneedsms_authorized_sender_remove` | `add_authorized_sender` / `remove_authorized_sender`: the canisters that may call `send_system_notification`. | `caller`, `principal` |
| `sneedsms_config_update` | A setting changed. | `caller`, `key`, `old_value`, `value` |
| `sneedsms_messages_import` | `import_messages` stored at least one message (controllers, restoring data). Only how many: never the messages. | `caller`, `count`, `next_id` (the id counter afterwards) |

`sneedsms_config_update` keys: `rate_limit_exempt` (with a `principal` field; values 1 exempt, 0 not); the burst limit `send_rate_limit` (`admin_set_send_rate_limit`; values are Maps `{ capacity; per_minute }`); the limits `rate_limit_minutes`, `max_subject_length`, `max_body_length`, `max_recipients` (`update_config`); the premium settings `sneed_premium_canister_id`, `premium_max_subject_length`, `premium_max_body_length`, `premium_rate_limit_minutes`, `premium_max_recipients` (`update_premium_config`); `system_sender_principal` (`set_system_sender_principal`); `notifications_canister` (`admin_set_notifications`); and the log settings `icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`.

There is no moderation in Sneed SMS: admins can read every message (`get_all_messages_admin`, `admin_get_messages_page`) but cannot delete, edit or block anything, so there are no moderation blocks. Reading is not logged (queries cannot write).

Not logged: messages sent (`send_message`, `send_system_notification`), messages left (`remove_self_from_message`, also when that deletes the message), read marks (`mark_messages_seen_up_to`), each user's preview switch (`set_notification_preview`; the default, on, is fixed in the code), the premium membership cache, and the one-off data repairs an upgrade runs.

### 7.4 Verifying and using the log

- **Verify it:** the procedure and the Node.js script of [Sneed Lock's 8.4](/api/sneed_lock#84-verifying-the-log) work unchanged with the canister id `zelpl-7yaaa-aaaad-abtcq-cai` (or staging `v33jy-4qaaa-aaaad-absna-cai`).
- **Browse it:** [app.sneeddao.com/tools/icrc3?canister=zelpl-7yaaa-aaaad-abtcq-cai](https://app.sneeddao.com/tools/icrc3?canister=zelpl-7yaaa-aaaad-abtcq-cai), the generic ICRC-3 browser.
- **Audit power:** `sneedsms_admin_*` blocks show who may read every message; `sneedsms_authorized_sender_*` who may write to anyone without limits, and under which sender (`system_sender_principal`).

---

## 8. Integration checklist

- Tell users that messages are readable by the canister's admins and stored unencrypted; do not let them send secrets.
- Read `get_config()` and `get_premium_config()` at run time to show limits; do not hard-code them.
- Handle `RateLimited` by showing the wait; do not retry in a loop.
- List each recipient once.
- Read inboxes with the paged reads (newest page first, `after` for new ones, `before` for older ones); the full lists come oldest first and unpaged.
- Use `reply_to` with ids the sender can read, or the call fails.
- Call `mark_messages_seen_up_to` with the newest `created_at` the user has seen, not with the local clock.
- For notifications from your own canister to users, use [Sneed Notifications](/api/sneed_notifications) rather than asking to become an authorised sender: users then choose channels and caps.
