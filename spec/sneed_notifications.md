# sneed_notifications (draft)

A notification service for the Internet Computer. Users set up delivery channels once (Sneed SMS,
phone push, Discord, Telegram, email, later real SMS) and decide which app may tell them what,
where and when. Any dapp (Sneed Hub, Unicycle, bots, Sneed Lock, Sneedex...) sends with one call,
and never sees anyone's contact details.

Status: draft for discussion between Sneed DAO and Unicycle. Open questions are marked **Q**.
Decided 2026-10-19 (Snassy): Sneed DAO governs it (perhaps later the multi-DAO guardian); **users pay
for their own notifications**; real SMS only as a proof of concept until payments are worked out;
the inbox is a configurable "always copy to" channel, Sneed SMS by default.

**Status (2026-10-20):** step 1 is built and deployed: the canister `src/sneed_notifications`
(production `vuy7a-iaaaa-aaaay-aaduq-cai` on the confidential subnet re2t4, controllers include the
Sneed DAO SNS root; staging `uqvqs-raaaa-aaaay-aadsq-cai`), the notification centre at
app.sneeddao.com/notifications, and an off-chain relay for Discord and push
(`relays/notifications/relay.mjs`). The forum (Sneed Hub) sends replies, mentions and tips through
it. The API as built is documented in `src/app_sneeddao_frontend/public/api-docs/sneed_notifications.md`;
where this spec and the code differ, the code is what runs.

## 1. Goals

- **For users:** one place to control every notification from every app, on every channel, with
  quiet hours and digests. Nothing arrives that they didn't allow.
- **For dapps:** `notify(user, topic, message)`, with receipts, without running mail servers, bot
  tokens or push keys.
- **Trust:** permissions, consent, queue, receipts and billing live on-chain from day one.
  Delivery runs in relays, which start partly off-chain and move on-chain channel by channel.

## 2. What users control

### 2.1 Concepts

- **Channel:** a place the user receives messages. Kinds: `#sneed_sms`, `#push` (one per device), `#discord`,
  `#telegram`, `#email`, later `#sms`. Each channel except Sneed SMS (the inbox) is **verified**
  (a 6-digit code sent to it, valid one day) before use. A user has at most 20 channels.
  Status (2026-10-20): all six kinds exist in the canister; relays run for Discord and push only,
  so Telegram, email and SMS channels can be added but nothing delivers to them (not even their
  verification code).
- **App:** a sender, registered by the controller of its canister (checked like the naming
  service checks controllers: a controller of the canister, the governance of an SNS whose root
  controls it, or the canister itself). Shown with its name, logo (an https link), description and
  verification (a checkmark set by admins). Admins can also register an app for DAO-controlled
  canisters with any owner (`admin_register_app`, verified from the start), and the owner can
  change the app later (`update_app`). App id 0 is the service itself, which sends verification
  codes.
- **Always copy to:** one channel every message also goes to, whatever the rules say, so nothing
  is ever only in a push banner. Default: Sneed SMS (it is the inbox: the bell in Sneed Hub and
  any client). Users may pick another channel or none. A per-topic mute is the one rule that
  drops the copy too.
- **Topic:** a kind of message an app sends, declared at registration, e.g. Unicycle "Cycles
  running low", Sneedex "Your offer sold", Sneed Hub "New reply". Each topic has a declared
  **level** and a description. At most 50 topics per app.
- **Level:** `#urgent` (needs action soon: low cycles, a vote ending, funds received),
  `#normal` (activity: replies, sales, mentions), `#info` (news, digests, announcements).

### 2.2 The rules, in three layers

Thirty apps times ten topics times six channels is a grid nobody fills in. So users set
**defaults by level**, and override only where they care:

1. **Defaults by level** (one small grid: 3 levels by the user's channels). Suggested starting
   point:

   | Level | Push | Discord | Email |
   |---|---|---|---|
   | Urgent | yes | yes | no |
   | Normal | yes | no | no |
   | Info | no | no | daily digest |

   (plus the "always copy to" channel, Sneed SMS by default)

   Status (2026-10-20): built as `settings.defaults` (a channel list per level). The canister's
   default is empty for every level, so a user who changes nothing gets every allowed message in
   Sneed SMS only; the table above is only a suggestion. Digests are not built.

2. **Per app:** on, off, or "customize". An app can be demoted (all its topics one level down)
   or limited to the inbox (`copy_only`: only the "always copy to" channel).
3. **Per topic:** mute, change the level, or pick channels explicitly.

Plus:
- **Quiet hours** in the user's time zone (start and end in minutes after local midnight, UTC
  offset within ±14 h): only `#urgent` gets through if the user sets `urgent_passes`; the rest
  waits until the quiet hours end. Sneed SMS is never held back.
  Changed from the original plan: held messages are delivered when quiet hours end, never folded
  into a digest.
- **Digests:** any channel can take a batched summary (hourly, daily) instead of one message per
  event. Status (2026-10-20): planned, not built.
- **Snooze:** pause everything (`settings.snooze_until`) or one app (`permission.muted_until`)
  until a time the user picks; while snoozed, messages still go to the "always copy to" channel.
  The centre offers fixed durations.
- **Rate cap** per app per day, set by the user: `daily_cap` messages a day from an app, counted
  per message (not per channel), per UTC day; default 20.
  Changed from the original plan: past the cap `notify` is refused with `#rate_limited`, the
  message does not go to the "always copy to" channel either.

### 2.3 Consent and abuse

- A new app reaches nobody until the user allows it. Allowing can be one tap from the app's own
  page ("Get notified about your bot" calls `request_permission`, and the user approves in the
  notification centre). A user may also allow any app directly. At most 50 open requests per
  user.
- Users can **demote** a topic: an app that marks everything urgent loses that power with them.
- **Spending caps.** Users pay for their notifications (§6), so an app could cost them money.
  Each allowed app gets a daily message cap (default 20) and a daily spending cap (default
  100,000 e8s = 0.001 ICP) the user sets. Past the spending cap, deliveries that cost something
  are suppressed and free ones (Sneed SMS) still go out.
  Changed from the original plan: past the message cap the message is refused entirely (§2.2).
- Every message lands in the "always copy to" channel with its app, topic and level, so users can see who sent what
  and switch it off from there. One exception, **no echoes**: a message from the canister that
  delivers a channel kind never goes to channels of that kind. Today that is Sneed SMS: whatever
  the configured `sneed_sms` canister sends through `notify`/`notify_batch` (its "new direct
  message" notices) skips `#sneed_sms` channels, chosen or always-copy (`echoKind` in main.mo). The
  message is in the inbox already, and Sneed SMS itself only notifies for messages people send
  (`send_message`), never for system messages (`send_system_notification`, how this canister
  copies into inboxes), so there are two independent guards against a loop.
- A user can **block** an app (`allow_app(app, false)`); a DAO-run list can flag abusive apps (**Q**: who maintains it).
  Status (2026-10-20): no shared list; admins can remove an abusive app (`admin_remove_app`), after
  which it can notify nobody, and mark apps verified.
- **Abuse of verification codes:** a code goes to whatever address the user typed, so a code ends
  after 5 wrong entries (remove the channel and add it again), and a user may add at most 5 new
  channels a day. Codes are free.

### 2.4 The notification centre in Sneed Hub (and any other frontend)

Status (2026-10-20): built at app.sneeddao.com/notifications (also in the Sneed Me menu).

- **Settings → Notifications:** channels (add, verify, test, remove), the level grid, quiet
  hours, digests (not built).
- **Apps:** each allowed app with its topics and switches; open requests.
- **Balance:** what the user's notifications cost, top up, per-app spending.
- **Inbox / bell:** the latest messages, read and unread, with links back into the app that sent
  them. As built: a history (`get_my_history`, newest first, up to 200, with what happened on each
  channel); the Sneed SMS inbox remains the bell.

## 3. For dapps

As built (Status 2026-10-20):

```
register_app({ name; logo : ?Text; description; canisters : [Principal]; topics : [{ id : Text; title : Text; description : Text; level : Level }] }) -> #ok(app id)
update_app(id, input)                  // owner or admin
request_permission(user)               // shows up in the user's centre
notify({ user : Principal; topic : Text; title : Text; body : Text; link : ?Text; dedupe : ?Text; sponsored : Bool })
  -> #ok { id; deliveries : Nat; deduplicated : Bool }
   | #err { #not_registered; #unknown_topic; #not_allowed; #rate_limited; #no_funds; #invalid : Text }
notify_batch(vec ...)                  // at most 100
get_receipts(ids)                      // per message: pending, delivered, suppressed (reason), failed (reason), expired
top_up_app(id, amount_e8s)             // anyone may fund an app, ICP by ICRC-2
```

Changed from the original plan: `notify` returns `#ok { id; deliveries; deduplicated }` (the
number of deliveries queued) instead of `#queued : Nat`; receipts give one summary state per
message (delivered if any channel delivered), not one per channel.

- Called only from a registered canister, never by ingress.
  Changed from the original plan: controllers cannot call `notify` for testing; they register a
  canister they control (or test on staging).
- Limits: title 1 to 200 characters, body up to 2,000, links https and up to 512 characters.
- `sponsored = true`: the dapp pays for this message from its own balance (top up like any
  balance), e.g. for its own important alerts. If the dapp's balance can't cover all of it, the call
  fails with `#no_funds` rather than falling back to the user. Otherwise the user's balance pays.
  Spending caps still apply to what the *user* pays; sponsored messages count only toward the
  per-app message cap.
- `dedupe` folds repeats (e.g. "cycles low" every hour → one message): the same key for the same
  user and app within the dedupe window (1 hour) answers `#ok { id = 0; deliveries = 0;
  deduplicated = true }` and sends nothing. A refused message does not start the window.
- The dapp never learns a user's channels or contact details, only whether a message was
  delivered somewhere.

## 4. Delivery: relays

A dapp calls the sneed_notifications canister directly. The message **sits in the canister until
it is delivered** (or expires): relays never receive messages from dapps directly, and a relay that
is offline delays delivery but loses nothing. **Relays** take jobs for one channel kind, deliver them, and report
a receipt. A relay is registered by the DAO (or by governance of the service).

As built (Status 2026-10-20): a relay is a principal listed with its kind in the config (set by
admins or controllers, `admin_set_config`). It calls `relay_pull(max)` (up to 100 due jobs of its
kind) and `relay_ack`. A pulled job is leased for 10 minutes; if not acknowledged it goes back to
the queue. A failed delivery is retried with a growing delay (1 minute times the attempt), at most
5 attempts; a delivery that finally fails is refunded to whoever paid. Sneed SMS is delivered by the
canister itself on a 30-second timer (and right after each `notify`), through Sneed SMS's
`send_system_notification`. Messages and their jobs are deleted after 30 days.

| Channel | First relay | Later |
|---|---|---|
| Sneed SMS | the canister itself (built) | — |
| Push (web push) | off-chain worker (VAPID P-256 key, payload encryption) (built: `relay.mjs`) | on-chain relay on a confidential subnet, non-replicated HTTPS outcalls |
| Discord, Telegram | off-chain worker (bot token) (Discord built: DMs from Mr Sneed's bot, the user must share a server with it; Telegram not built) | on-chain relay, same |
| Email | off-chain worker + a mail provider (deliverability needs SPF/DKIM on a domain) (not built) | on-chain relay calling the provider's API |
| Real SMS | proof of concept only, through a paid provider, until payments are worked out (not built) | — |

Why both: an HTTPS outcall from an ordinary subnet is made by every replica (13 POSTs = 13
messages) and every secret in canister memory is readable by node providers. Non-replicated
outcalls send once; a confidential (SEV-SNP) subnet keeps memory from node providers. Mr Sneed's
canister already runs on one (re2t4), and so does this service. Each channel moves on-chain when its relay is proven there.

**Cost note:** an outcall's price is dominated by its response size limit. Left at the 2 MB
default it costs about 21B cycles on a 13-node subnet (roughly $0.03); with a 2 KB limit and a
small request about 75M cycles (roughly $0.0001). A non-replicated call costs less again.

## 5. Contact details and secrets

Contact details (email addresses, phone numbers, Discord ids, webhook URLs, push subscriptions)
are private:

- **Never in a query anyone else can call.** The user can read their own (as the encrypted blob
  only); dapps never can.
- **The service runs on a confidential (TEE) subnet** (re2t4), so its memory is not readable by
  node providers.
- **Encrypted to the relay:** the user's browser encrypts each address to the public key of the
  relay for that channel kind (hybrid: RSA-OAEP-256 wraps a fresh AES-256-GCM key), which admins
  publish with `admin_set_relay_key` and clients read with `get_relay_keys`. The canister stores
  only the opaque blob (at most 2,048 bytes) and hands it to the relay with each job; only the relay
  holding the private key can open it. Bot tokens, VAPID keys and the relay's private key live only
  in the relay, outside the repository.
  Changed from the original plan: no vetKeys (vetKD); a per-kind RSA key held by the relay. The
  planned on-chain relay would decrypt inside the TEE.
- **What we tell users, plainly:** the service is built so that no node provider, dapp or other
  user can read your contact details, and only the relay that delivers a message sees the address
  it delivers to. It relies on AMD SEV-SNP hardware and on encryption in your browser; both are
  strong but not perfect (hardware TEEs have had vulnerabilities, and the relay is an off-chain
  machine). If a channel is too sensitive, don't add it: the inbox and Sneed SMS need no contact
  details at all.
- Message titles, bodies and links are stored in plain text and seen by the delivering relay and
  by Sneed SMS; apps should not send secrets.
- Removing a channel deletes its details (the relay keeps none: it decrypts per job). Jobs still
  queued for it fail and are refunded.

## 6. Paying for it

**Users pay for their own notifications.** Nobody (least of all one person or the DAO's treasury)
pays for every member getting a real SMS whenever a canister runs low.

- **The user's balance:** each user tops up a notification balance in ICP (`top_up`, by ICRC-2
  approval). Each delivery is charged to it at the channel's price. Prices on 2026-10-20 (e8s per
  delivery, set in the config): Sneed SMS 0; push, Discord and Telegram 100; email 1,000; real SMS
  1,000,000 (0.01 ICP).
  Changed from the original plan: balances are in ICP, not cycles. There is no withdraw method:
  what is topped up can only be spent on notifications.
- **Even the `notify` call is charged to the user**, not the dapp: the cost of queueing and
  delivering lands on the account of the person who chose to receive it. A dapp may *sponsor*
  a message instead: `notify` with `sponsored = true` charges the dapp's own balance (§3).
  Status (2026-10-20): the per-call price (`notify_price_e8s`) exists and is 0; it is taken only if
  the user's balance and cap allow it.
- **Empty balance:** messages still go to the "always copy to" channel (Sneed SMS), which the
  service carries at near-zero cost.
  Changed from the original plan: deliveries to paid channels that the balance (or the app's
  spending cap) can't cover are suppressed ("not enough balance"), not held until the user tops
  up.
- **Shared plans (Q):** a bundle sold by the DAO (e.g. "1,000 push messages a month") or included
  in Sneed Premium. Status (2026-10-20): not built.
- Prices are set by the service's governance and shown in the notification centre and the dapp
  docs. As built: by admins or controllers (the Sneed DAO SNS root among them) through
  `admin_set_config`, readable with `get_config`.
- **Revenue** (added 2026-10-21; before it, spent ICP stayed in the canister with no way out):
  - Counters: `fees_earned_e8s` grows whenever a price is deducted (user-paid and app-paid
    deliveries, the per-call price); `fees_refunded_e8s` when a finally failed delivery is
    refunded; `fees_forwarded_e8s` and the ledger fees paid when ICP leaves.
  - Liabilities: every user balance, every app balance, every paid delivery not final yet (it may
    still be refunded) and top-ups the ledger moved but the canister hasn't credited yet.
  - Books: at the first check (lazily, since it needs the ledger balance) the canister measures
    free = ledger balance − liabilities (0 if the liabilities are larger, logged), and records
    the part its counters don't explain as `fees_backlog_e8s` (the ICP spent before forwarding
    existed; never more than free). From then on, unforwarded = free at that point + fees earned
    − refunded − forwarded (and fees) − change in the refundable deliveries. ICP sent to the
    canister by mistake is never counted. If the ledger later shows less free ICP than the books,
    the books are measured again from the ledger.
  - Forwarding: a check from the existing delivery timer, at most every 5 minutes. If unforwarded
    ≥ `fee_sweep_threshold_e8s` (0.1 ICP), one `icrc1_transfer` of unforwarded − ledger fee to
    `fee_destination` (default the RLL ICP splitter, `6jvpj-sqaaa-aaaaj-azwnq-cai` subaccount
    `01 00 00 00 00 06` + 26 zeros, where Sneed Premium, Sneedex and Sneed Lock pay), with a memo
    and `created_at_time`; one at a time. Just before it the ledger balance is read again and the
    transfer must leave at least the liabilities, else it is skipped and logged. Counters change
    only once the ledger accepts. A refusal leaves everything for the next check (`last_error`);
    a call whose outcome is unknown is retried with the same arguments, which the ledger
    deduplicates.
  - Admin: `admin_set_fee_destination` (null keeps fees in the canister),
    `admin_set_fee_sweep_threshold`, `admin_forward_fees_now` (any amount above the ledger fee).
    Public: `get_fee_forwarding` (revenue is DAO information).

## 7. Built on it, first

- **Sneed Hub:** replies, mentions, tips, Sneed SMS, votable proposals, low cycles, bot health:
  the header notification bar today becomes topics of the "Sneed Hub" app, with push to the
  installed app on iPhone and Android.
  Status (2026-10-20): partly built: the forum sends replies, mentions and tips (`notify_batch`,
  best effort); Sneed SMS sends `direct_message` ("New message from <short principal>", the
  subject plus the first 100 characters of the text, or the subject only for recipients who turn previews off; link to /msg/<id>; dedupe per message; not sponsored), once per
  recipient, when `admin_set_notifications` is set on sneed_sms; the other topics are not wired.
- **Unicycle:** cycles running low, top-ups done, drain alerts. Status (2026-10-20): not started.
- **Mr Sneed:** go-ahead requests to the DAO's operators (today: Sneed SMS plus a Discord DM).
  Status (2026-10-20): not wired.

## 8. Questions

1. **Shared plans:** bundles sold by the DAO, included in Sneed Premium, or neither at first?
2. **Abuse:** users pay and set caps per app, so each user protects themselves. Should there also
   be a shared "reported apps" list (a warning when allowing one), and who keeps it?
3. **Email:** sending email that doesn't land in spam needs a domain we control, with DNS records
   (SPF, DKIM, DMARC) saying who may send for it, and a sending provider with an HTTPS API (e.g.
   Postmark, Resend, Amazon SES; around $0.0001-0.001 per email). Which domain (e.g.
   notify.sneeddao.com), and who manages its DNS?
4. **Real SMS payments:** after the proof of concept, which provider, and how users pay the much
   higher price (per message, or a monthly plan)?

## 9. Known issues (2026-10-20)

- **Verification codes are readable in the user's own history.** `add_channel` records the code
  in the title of a notification to the user (`main.mo:513`), and `get_my_history`
  (`main.mo:618-628`) returns it. A user can therefore "verify" an address they don't own (someone
  else's Discord id or push subscription) without receiving the code, and then send it messages
  within their caps. The verification job should be left out of the history, or its title should
  not carry the code.
- Duplicates are checked after the daily cap, so a repeat past the cap answers `#rate_limited`
  rather than `deduplicated` (`main.mo:343-349`). Minor.

## 10. Build order

1. Canister: apps, topics, channels (Sneed SMS, "always copy to"), rules (levels, overrides, quiet
   hours, digests), consent, `notify`, the queue, receipts, user balances, spending caps; tests
   (PocketIC). Status (2026-10-20): built and deployed, except digests.
2. Sneed Hub notification centre; Sneed Hub's own notifications as the first app. Status: built
   (forum replies, mentions, tips; Sneed SMS direct messages).
3. Off-chain relay for push and Discord (the VPS), with encrypted contacts. Status: built
   (`relays/notifications/relay.mjs`, RSA-OAEP + AES-GCM instead of vetKD).
4. Unicycle integration. Status: not started.
5. On-chain relay on the confidential subnet, channel by channel; email; real SMS if decided.
   Status: not started.
