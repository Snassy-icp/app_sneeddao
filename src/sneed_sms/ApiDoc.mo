/// The text get_api_doc returns: a short guide for agents (full reference in public/api-docs/sneed_sms.md).
module {
  public let text : Text = "# Sneed SMS (canister sneed_sms)

Direct messages (\"SMS\") from one principal to one or more others: a subject, a body and optional replies to earlier messages. Sneed Hub's inbox, forum mention alerts and Sneed Notifications deliver through it. Calls are authorised by the calling principal only.

**Privacy: messages are not public, but they are NOT encrypted.** Subject and body are stored as plain text. The canister's admins (the Sneed DAO governance canister, the controllers and the principals in `get_admins()`) can read every message through `get_all_messages_admin`, and the state lives on the subnet's node machines. Never put secrets in a message, and never describe Sneed SMS as secure messaging.

- Production: `zelpl-7yaaa-aaaad-abtcq-cai` (controlled by the Sneed SNS; upgrades by DAO proposal)
- Staging: `v33jy-4qaaa-aaaad-absna-cai` (separate state; use it to test)

## Units and encoding
- Message ids are `nat` (a global counter from 1).
- Timestamps (`created_at`, `updated_at`, last-seen marks) are `int` nanoseconds since the Unix epoch.
- Updates return `variant { ok; err : SMSError }` with `SMSError = variant { Unauthorized; NotFound; InvalidInput; RateLimited; AlreadyExists }` (each carrying text for people); branch on the tag.
- Lengths count Unicode characters.

## Authentication
- Sending is a signed update; the anonymous principal cannot send (`Unauthorized`).
- The sender and each current recipient can read a message; every recipient sees the full recipient list (no blind copy).
- Anyone can read `get_stats`, and for any principal `get_recent_messages_count(user)` and `get_last_seen_messages_timestamp(user)`.
- `send_system_notification` only from canisters on the authorised-sender list.
- Nothing is anonymous: who sent what to whom is recorded with the principals. A sender who leaves a message is shown as `2vxsx-fae` in replies, but the canister keeps the original sender internally.

## Fees, transfers and irreversible actions
- No fees and no token transfers.
- **Sending is irreversible**: messages cannot be edited or recalled. `remove_self_from_message(id)` only takes the caller off; the message is deleted only when nobody is left on it.
- Limits (read at run time from `get_config()` and, for Sneed Premium members, `get_premium_config()`): minutes between messages, subject and body length, recipients per message. Admins are exempt from the rate limit.

## Notifications for new messages
- When admins set a Sneed Notifications canister (`get_notifications_canister()`), each `send_message` also notifies every recipient once (never the sender) through it: app Sneed Hub (the recipient must allow it), topic `direct_message`, title `New message from <short principal>`, body the subject only (never the message text), link `https://app.sneeddao.com/msg/<id>`, paid by the recipient. Fire-and-forget: sending never waits on it or fails because of it.
- `send_system_notification` never notifies, and Sneed Notifications never copies these notices back into Sneed SMS: no loop.

## Asynchronous lifecycle and polling
- `send_message` is a single update that returns the new id; nothing to poll afterwards.
- For unread counts poll `get_recent_messages_count(me)` (a cheap query); after showing the inbox call `mark_messages_seen_up_to(newest created_at seen)`.
- Lists are unpaged and oldest first; don't refetch them in tight loops.

## Errors, retries and Busy
- `send_message` is NOT idempotent: two successful calls send two messages. Its only await (the premium lookup) comes before any state change, so a rejected call stored nothing. After a timeout, look in `get_sent_messages()` before sending again.
- `RateLimited(\"Must wait N more minutes ...\")`: show the wait, don't retry in a loop.
- `reply_to` ids must exist and be readable by the sender (`NotFound` / `Unauthorized`).

## Common pitfalls
- Query methods sent as update calls are refused by the ingress guard (`inspect`).
- Arguments are capped: `send_message` is refused at ingress beyond 100 `reply_to` ids or beyond the larger of the plain and premium limits; other updates take at most 4 KiB.
- List each recipient once (duplicates are not removed).
- `get_message(id)` returns null both for a missing message and for one the caller may not read.
- For notifications from your own canister, use Sneed Notifications instead of asking to become an authorised sender.

## Start with these methods
`get_config`, `get_premium_config`, `send_message`, `get_received_messages`, `get_sent_messages`, `get_message`, `get_recent_messages_count`, `mark_messages_seen_up_to`, `remove_self_from_message`.

## Full reference
- https://app.sneeddao.com/api-docs/sneed_sms.md
- Candid: https://app.sneeddao.com/api-docs/sneed_sms.did
- All Sneed APIs: https://app.sneeddao.com/llms.txt
";
};
