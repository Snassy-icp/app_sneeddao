# sneed_notifications (draft)

A notification service for the Internet Computer. Users set up delivery channels once (Sneed SMS,
phone push, Discord, Telegram, email, later real SMS) and decide which app may tell them what,
where and when. Any dapp (Sneed Hub, Unicycle, bots, Sneed Lock, Sneedex...) sends with one call,
and never sees anyone's contact details.

Status: draft for discussion between Sneed DAO and Unicycle. Open questions are marked **Q**.

## 1. Goals

- **For users:** one place to control every notification from every app, on every channel, with
  quiet hours and digests. Nothing arrives that they didn't allow.
- **For dapps:** `notify(user, topic, message)`, with receipts, without running mail servers, bot
  tokens or push keys.
- **Trust:** permissions, consent, queue, receipts and billing live on-chain from day one.
  Delivery runs in relays, which start partly off-chain and move on-chain channel by channel.

## 2. What users control

### 2.1 Concepts

- **Channel:** a place the user receives messages. Kinds: `#inbox` (always there: the in-app
  bell, readable only by the user), `#sneed_sms`, `#push` (one per device), `#discord`,
  `#telegram`, `#email`, later `#sms`. Each channel except inbox and Sneed SMS is **verified**
  (a code sent to it) before use.
- **App:** a sender, registered by the controller of its canister (checked like the naming
  service checks controllers). Shown with its name, logo and verification.
- **Topic:** a kind of message an app sends, declared at registration, e.g. Unicycle "Cycles
  running low", Sneedex "Your offer sold", Sneed Hub "New reply". Each topic has a declared
  **level** and a description.
- **Level:** `#urgent` (needs action soon: low cycles, a vote ending, funds received),
  `#normal` (activity: replies, sales, mentions), `#info` (news, digests, announcements).

### 2.2 The rules, in three layers

Thirty apps times ten topics times six channels is a grid nobody fills in. So users set
**defaults by level**, and override only where they care:

1. **Defaults by level** (one small grid: 3 levels by the user's channels). Suggested starting
   point:

   | Level | Inbox | Push | Discord | Email |
   |---|---|---|---|---|
   | Urgent | yes | yes | yes | no |
   | Normal | yes | yes | no | no |
   | Info | yes | no | no | daily digest |

2. **Per app:** on, off, or "customize". An app can be demoted (all its topics one level down)
   or limited to the inbox.
3. **Per topic:** mute, change the level, or pick channels explicitly.

Plus:
- **Quiet hours** in the user's time zone: only `#urgent` gets through (setting), the rest waits
  until morning or goes into the digest.
- **Digests:** any channel can take a batched summary (hourly, daily) instead of one message per
  event.
- **Snooze:** pause an app or everything for 1 hour / 1 day / until turned back on.
- **Rate cap** per app per day, set by the user (default e.g. 20 push messages per app).

### 2.3 Consent and abuse

- A new app reaches nobody until the user allows it. Allowing can be one tap from the app's own
  page ("Get notified about your bot" calls `request_permission`, and the user approves in the
  notification centre).
- Users can **demote** a topic: an app that marks everything urgent loses that power with them.
- Every message lands in the inbox with its app, topic and level, so users can see who sent what
  and switch it off from there.
- A user can **block** an app; a DAO-run list can flag abusive apps (**Q**: who maintains it).

### 2.4 The notification centre in Sneed Hub (and any other frontend)

- **Settings → Notifications:** channels (add, verify, test, remove), the level grid, quiet
  hours, digests.
- **Apps:** each allowed app with its topics and switches.
- **Inbox / bell:** the latest messages, read and unread, with links back into the app that sent
  them.

## 3. For dapps

```
register_app({ name; logo; canisters : [Principal]; topics : [{ id : Text; title : Text; description : Text; level : Level }] })
request_permission(user)               // shows up in the user's centre
notify({ user : Principal; topic : Text; title : Text; body : Text; link : ?Text; dedupe : ?Text })
  -> { #queued : Nat; #not_allowed; #rate_limited; #no_funds }
notify_batch(vec ...)
get_receipts(ids)                      // queued, delivered per channel, failed, suppressed (quiet hours, muted)
```

- Called only from a registered canister (or its controllers, for testing).
- `dedupe` folds repeats (e.g. "cycles low" every hour → one message until it changes).
- The dapp never learns a user's channels or contact details, only whether a message was
  delivered somewhere.

## 4. Delivery: relays

The canister keeps the queue. **Relays** take jobs for one channel kind, deliver them, and report
a receipt. A relay is registered by the DAO (or by governance of the service).

| Channel | First relay | Later |
|---|---|---|
| Inbox, Sneed SMS | the canister itself | — |
| Push (web push) | off-chain worker (VAPID P-256 key, payload encryption) | on-chain relay on a confidential subnet, non-replicated HTTPS outcalls |
| Discord, Telegram | off-chain worker (bot token) | on-chain relay, same |
| Email | off-chain worker + a mail provider (deliverability needs SPF/DKIM on a domain) | on-chain relay calling the provider's API |
| Real SMS | paid provider; needs billing first (**Q**) | — |

Why both: an HTTPS outcall from an ordinary subnet is made by every replica (13 POSTs = 13
messages) and every secret in canister memory is readable by node providers. Non-replicated
outcalls send once; a confidential (SEV-SNP) subnet keeps memory from node providers. Mr Sneed's
canister already runs on one (re2t4). Each channel moves on-chain when its relay is proven there.

**Cost note:** an outcall's price is dominated by its response size limit. Left at the 2 MB
default it costs about 21B cycles on a 13-node subnet (roughly $0.03); with a 2 KB limit and a
small request about 75M cycles (roughly $0.0001). A non-replicated call costs less again.

## 5. Contact details and secrets

Contact details (email addresses, phone numbers, Discord ids, webhook URLs, push subscriptions)
are private:

- **Never in a query anyone else can call.** The user can read their own; dapps never can.
- **The service runs on a confidential (TEE) subnet**, so its memory is not readable by node
  providers.
- **vetKeys:** contact details are stored encrypted under a key derived per user and per relay
  (vetKD). The off-chain relay gets only the details of the jobs it delivers, decryptable only by
  that relay; the on-chain relay decrypts inside the TEE. Bot tokens and provider keys live only
  in the relay that uses them.
- **What we tell users, plainly:** the service is built so that no node provider, dapp or other
  user can read your contact details, and only the relay that delivers a message sees the address
  it delivers to. It relies on AMD SEV-SNP hardware and on vetKeys; both are strong but not
  perfect (hardware TEEs have had vulnerabilities). If a channel is too sensitive, don't add it:
  the inbox and Sneed SMS need no contact details at all.
- Removing a channel deletes its details (and the relay forgets them).

## 6. Paying for it

- **Dapps pay** per message in cycles from a prepaid balance (Unicycle can top it up like any
  canister). Inbox and Sneed SMS cost almost nothing; outcall channels cost per send.
- **Users pay** for costly channels they want (real SMS), or they come with Sneed Premium (**Q**).
- Prices are set by the service's governance and shown in the dapp docs.

## 7. Built on it, first

- **Sneed Hub:** replies, mentions, tips, Sneed SMS, votable proposals, low cycles, bot health:
  the header notification bar today becomes topics of the "Sneed Hub" app, with push to the
  installed app on iPhone and Android.
- **Unicycle:** cycles running low, top-ups done, drain alerts.
- **Mr Sneed:** go-ahead requests to the DAO's operators (today: Sneed SMS plus a Discord DM).

## 8. Questions

1. **Governance:** a Sneed DAO canister, a joint one with Unicycle, or its own SNS later?
2. **Real SMS:** in scope at all (cost, phone-number privacy), and who pays?
3. **Abuse list:** who flags spammy apps?
4. **Inbox vs Sneed SMS:** should the inbox simply be Sneed SMS (one inbox for everything), or a
   lighter separate store with SMS as one channel?
5. **Email domain:** which sending domain, and who manages its DNS (SPF/DKIM)?

## 9. Build order

1. Canister: apps, topics, channels (inbox, Sneed SMS), rules (levels, overrides, quiet hours,
   digests), consent, `notify`, receipts, billing; tests (PocketIC).
2. Sneed Hub notification centre; Sneed Hub's own notifications as the first app.
3. Off-chain relay for push and Discord (the VPS), with vetKD-encrypted contacts.
4. Unicycle integration.
5. On-chain relay on the confidential subnet, channel by channel; email; real SMS if decided.
