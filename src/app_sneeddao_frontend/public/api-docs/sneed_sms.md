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
| Admins of the canister | **Every message**, through `get_all_messages_admin`. Admins are the Sneed DAO governance canister (`fi3zi-fyaaa-aaaaq-aachq-cai`), the canister's controllers (the SNS root) and the principals in `get_admins()`. |
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

Lengths count Unicode characters (`Text.size`). Subject and body must not be empty. Admins are exempt from the rate limit.

### 1.4 Leaving a message

`remove_self_from_message(id)` takes the caller off a message:
- A **recipient** who leaves is removed from the recipient list and loses access.
- A **sender** who leaves loses access; from then on the message shows the anonymous principal `2vxsx-fae` as its sender to everyone, including admins. The canister keeps the original sender's index internally; leaving only hides it from the replies of the API.
- When nobody is left on a message (the sender has left and no recipients remain), the message is deleted.

There is no other way to delete a message.

### 1.5 System messages

Canisters on the canister's `authorized_senders` list may call `send_system_notification` to write to users without the rate limit and with the premium size limits. Such a message shows `get_system_sender_principal()` as its sender (the calling canister when none is set). Sneed Notifications delivers its "Sneed SMS" channel this way.

### 1.6 Time and ids

Timestamps (`created_at`, `updated_at`, last-seen marks) are `int` nanoseconds since the Unix epoch, as `Time.now()` in Motoko and `BigInt(Date.now()) * 1_000_000n` in JavaScript. Message ids are `nat`.

### 1.7 Calls the canister refuses at ingress

Before it accepts an update call from outside the IC the canister checks it (`inspect`), and a refused call costs nobody anything:

- **Query methods only answer query calls.** Calling one as an update is refused.
- **`send_message`** is refused when `reply_to` names more than 100 ids, when there are more recipients than the larger of the plain and premium recipient limits, or when the subject or body is longer than the larger of the two limits. The method itself then applies the caller's own limits.
- **`send_system_notification`** is held to the premium limits.
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
    sms.get_received_messages(),                 // oldest first
    sms.get_last_seen_messages_timestamp(me),    // [] or [ns]
    sms.get_recent_messages_count(me),
  ]);
  received.sort((a, b) => Number(b.created_at - a.created_at));   // newest first
  return { received, lastSeen: lastSeen[0] ?? 0n, unread };
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
2. Premium lookup (an inter-canister call, cached), which chooses the limits.
3. Rate limit → `RateLimited("Must wait N more minutes before sending another message")`. Minutes are whole minutes since the caller's last message.
4. Subject and body → `InvalidInput("Subject cannot be empty")`, `InvalidInput("Subject exceeds maximum length of N characters")`, and the same for `Body`.
5. Recipients → `InvalidInput("At least one recipient is required")`, `InvalidInput("Too many recipients. Maximum is N")`.
6. Each `reply_to` id → `NotFound("Reply message N not found")`, or `Unauthorized("Cannot reply to message N - access denied")` when the caller cannot read it.

On success the message is stored, indexed for the sender and each recipient, the caller's rate-limit clock is reset, and the id is returned. Recipients are not checked or de-duplicated: list each principal once (a principal listed twice gets the message twice in its received list). Any principal can be a recipient, including canisters and principals that never used Sneed SMS. The sender may include themselves.

### 3.2 Reading

`get_sent_messages`, `get_received_messages` and `get_all_messages` return every matching message in one reply, oldest first (`get_all_messages`: sent first, then received ones not sent by the caller). There is no paging. `get_message(id)` returns `null` both for a message that does not exist and for one the caller cannot read.

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

### 5.4 System messages (authorised canisters)

**`send_system_notification({ recipients : vec principal; subject : text; body : text }) → Result<nat, SMSError>`**
Only for principals on the authorised-sender list (`Unauthorized("Caller is not authorized to send system notifications")`). No rate limit. Errors: `InvalidInput("Subject too long. Maximum is N")`, `InvalidInput("Body too long. Maximum is N")`, `InvalidInput("At least one recipient is required")`, `InvalidInput("Too many recipients. Maximum is N")`, all against the premium limits. Empty subjects and bodies are allowed here. Returns the message id. To get on the list, ask Sneed DAO (an admin call, usually by proposal).

### 5.5 Admin methods

Restricted to admins (governance, controllers, listed admins) unless noted. Integrators do not call them.

| Method | What it does |
|---|---|
| `add_admin(p)`, `remove_admin(p)` | Edit the admin list. |
| `update_config(opt rate_limit_minutes, opt max_subject_length, opt max_body_length, opt max_recipients)` | Change the plain limits (null = unchanged). |
| `update_premium_config(opt opt premium_canister, opt …)` | Change the premium canister (`[]` unchanged, `[[]]` clear) and limits. |
| `get_authorized_senders()`, `add_authorized_sender(p)`, `remove_authorized_sender(p)` | The canisters allowed to call `send_system_notification`. |
| `set_system_sender_principal(opt p)` | The sender shown on system messages. |
| `get_all_messages_admin()` | Every message (empty for non-admins). |
| `import_admins(vec AdminInfo)`, `import_messages(vec MessageResponse)` | Controllers only: restore data after a migration. |

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

type AdminInfo = record { principal : principal; added_by : nat32; added_at : int };

type SMSError = variant {
  Unauthorized : text; NotFound : text; InvalidInput : text; RateLimited : text; AlreadyExists : text;
};
```

`Result<T, SMSError>` is `variant { ok : T; err : SMSError }` (lowercase tags).

---

## 7. Integration checklist

- Tell users that messages are readable by the canister's admins and stored unencrypted; do not let them send secrets.
- Read `get_config()` and `get_premium_config()` at run time to show limits; do not hard-code them.
- Handle `RateLimited` by showing the wait; do not retry in a loop.
- List each recipient once.
- Sort replies yourself; lists come oldest first and unpaged.
- Use `reply_to` with ids the sender can read, or the call fails.
- Call `mark_messages_seen_up_to` with the newest `created_at` the user has seen, not with the local clock.
- For notifications from your own canister to users, use [Sneed Notifications](/api/sneed_notifications) rather than asking to become an authorised sender: users then choose channels and caps.
