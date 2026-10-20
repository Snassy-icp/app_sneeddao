---
name: sneed-sms
description: Send and read Sneed SMS direct messages on the Internet Computer (zelpl-7yaaa-aaaad-abtcq-cai), the principal-to-principal messaging canister behind Sneed Hub's /sms page. Covers sending a message (subject, body, up to a few recipients, reply chains), reading the inbox and sent box, leaving a conversation, unread counts, rate limits and the longer limits for Sneed Premium members. Use when a user or developer wants to message an Internet Computer principal, read their Sneed messages, or show an unread-message badge.
license: MIT
metadata:
  publisher: Sneed DAO
  canister: zelpl-7yaaa-aaaad-abtcq-cai
  staging-canister: v33jy-4qaaa-aaaad-absna-cai
  full-reference: https://app.sneeddao.com/api-docs/sneed_sms.md
  source: https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_sms/main.mo
---

# Sneed SMS integration skill

Sneed SMS delivers short messages from one Internet Computer principal to others. Read the full reference at https://app.sneeddao.com/api-docs/sneed_sms.md for every method and type. Production `zelpl-7yaaa-aaaad-abtcq-cai`, staging `v33jy-4qaaa-aaaad-absna-cai` (same code, separate state). Sending is free; there is no fee.

**Not encrypted, not anonymous.** Messages are stored as plaintext in canister memory. The query methods only return a message to its sender and recipients, but anyone who can read the canister's state (its controllers, the subnet's node machines) could see it, and query replies are not certified. Every message names its sender's principal. Tell users: do not send seed phrases, passwords or anything private through Sneed SMS.

## Core facts to keep straight

1. **A message** = `{id; sender; recipients : vec principal; subject; body; reply_to : opt vec nat; created_at; updated_at (ns)}`. The caller sees `can_remove_self` too.
2. **Access.** Only the sender and the current recipients can read a message (`get_message` returns `null` for anyone else). Anonymous callers cannot send.
3. **Limits** come from `get_config()` and, for Sneed Premium members, `get_premium_config()`. Production on 2026-10-20: subject 100 chars, body 2_000, 5 recipients, one message per 10 minutes; Premium: subject 200, body 12_000, 50 recipients, one per minute. Premium is checked live against the Sneed Premium canister (`7gump-4aaaa-aaaal-qtyka-cai`); if it is unreachable the plain limits apply. Read the config rather than hard-coding.
4. **Rate limit** counts from the caller's last sent message: `RateLimited("Must wait N more minutes …")`. Empty subject or body, no recipients, too many recipients, or text too long → `InvalidInput`.
5. **Replies** list the message ids they answer in `reply_to`; the caller must have access to each (else `Unauthorized`, or `NotFound` if gone).
6. **Leaving.** `remove_self_from_message(id)` removes the caller (sender or recipient). When the sender leaves, the others still see the message with the sender shown as the anonymous principal `2vxsx-fae`; when nobody is left the message is deleted. There is no edit and no recall: once sent, recipients keep it.
7. **System notifications.** `send_system_notification` is only for authorised canisters (forum mention SMSes are not system notifications: the poster's own client sends them with `send_message`). Its sender is shown as `get_system_sender_principal()`.
8. **Errors**: `variant { AlreadyExists; InvalidInput; NotFound; RateLimited; Unauthorized : text }` inside `Result` (`ok : nat` = new message id). Queries called as update calls are refused by the ingress guard; call them as queries.

## Procedures

### Send a message
1. Optional: `get_config()` / `get_premium_config()` to size the text.
2. `send_message({recipients = vec { principal "…" }; subject = "…"; body = "…"; reply_to = null})` → `ok id`.
3. Reply: `reply_to = opt vec { original_id }`, recipients = the original sender (and others), subject conventionally `Re: …`.

### Read
- `get_received_messages()`, `get_sent_messages()`, `get_all_messages()` (both, deduplicated) – all for the caller, unpaged; sort by `created_at` yourself.
- `get_message(id)` → `opt MessageResponse`.
- Unread badge: `get_recent_messages_count(p)` counts received messages newer than the last-seen mark; `mark_messages_seen_up_to(ns)` (caller) sets the mark; `get_last_seen_messages_timestamp(p)`.
- Totals: `get_stats()` → `{total_messages; total_users}`.

## Sneed Hub pages

- Inbox and compose: `https://app.sneeddao.com/sms`.
- Compose to someone: `https://app.sneeddao.com/sms?recipient=<principal>`; reply to a message: `/sms?reply=<message_id>`.
- One message (thread view): `https://app.sneeddao.com/msg/<message_id>`.
- A principal's public page: `/principal?id=<principal>`. Mention-SMS opt-in (forum): `/me`.

## Minimal JavaScript setup

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory } from './sneed_sms.did.js'; // src/declarations/sneed_sms in the repo

const agent = new HttpAgent({ identity, host: 'https://icp-api.io' }); // the user's own identity: messages are per caller
const sms = Actor.createActor(idlFactory, { agent, canisterId: 'zelpl-7yaaa-aaaad-abtcq-cai' });
const r = await sms.send_message({ recipients: [Principal.fromText(to)], subject: 'Hello', body: 'Hi there', reply_to: [] });
if ('err' in r) console.error(r.err); else console.log('sent message', r.ok);
const inbox = await sms.get_received_messages();
```

## dfx examples

```bash
dfx canister --network ic call zelpl-7yaaa-aaaad-abtcq-cai get_config --query
dfx canister --network ic call zelpl-7yaaa-aaaad-abtcq-cai get_premium_config --query
dfx canister --network ic call zelpl-7yaaa-aaaad-abtcq-cai get_received_messages --query   # as your own identity
dfx canister --network ic call zelpl-7yaaa-aaaad-abtcq-cai send_message '(record { recipients = vec { principal "<recipient-principal>" }; subject = "Hello"; body = "Hi"; reply_to = null })'
```

## Reference implementation

Sneed Hub's messaging page `src/app_sneeddao_frontend/src/pages/SMS.jsx` under https://github.com/Snassy-icp/app_sneeddao.
