# Sneed Notifications canister API

Sneed Notifications lets any dapp on the Internet Computer notify its users, and lets each user decide which dapps may do so, through which channels, how often and at what cost. A dapp registers as an **app** with a list of **topics** and the canisters that may send. A user allows the app and sets up **channels** (their Sneed SMS inbox, and later push, Discord, Telegram, email). The app's canister calls `notify`; the message waits in this canister until it is delivered, by the canister itself for Sneed SMS and by **relays** for the other channels. Users pay for their own deliveries from a small ICP balance, and an app may sponsor a message instead.

| | |
|---|---|
| Production canister | `vuy7a-iaaaa-aaaay-aaduq-cai` |
| Staging canister | `uqvqs-raaaa-aaaay-aadsq-cai` (separate state, same code line; use it to test) |
| Candid interface | [sneed_notifications.did](/api-docs/sneed_notifications.did) · [JavaScript IDL factory](/api-docs/sneed_notifications.did.js) |
| Source | [src/sneed_notifications/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_notifications/main.mo) · [Types.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_notifications/Types.mo) |
| Design notes | [spec/sneed_notifications.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sneed_notifications.md) (draft; the code below is what runs) |
| Reference frontend | [app.sneeddao.com/notifications](https://app.sneeddao.com/notifications) ([source](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend/src/utils/NotificationsService.js)) |
| This document | [rendered](/api/sneed_notifications) · [raw Markdown](/api-docs/sneed_notifications.md) |

The production canister's controllers include the Sneed DAO SNS root (`fp274-iaaaa-aaaaq-aacha-cai`); check the current list with `dfx canister --network ic info vuy7a-iaaaa-aaaay-aaduq-cai`. The method set below matches the source on `main` and the deployed interface. This is the first version of the service: Sneed SMS delivery runs inside the canister; relays for Discord and push are registered on production (see `get_config().relays`), the other kinds have none yet.

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister (units and encoding, authentication, fees, transfers and irreversible actions, asynchronous flows and polling, common pitfalls) that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 The parts

| Concept | What it is | Who creates it |
|---|---|---|
| **App** | A name, logo, description, an owner principal, the canisters allowed to send, and its topics. `verified` is a checkmark set by admins. | The dapp (`register_app`), or Sneed DAO admins for DAO canisters (`admin_register_app`) |
| **Topic** | A kind of message of one app (`id`, `title`, `description`) with a default **level**: `urgent`, `normal` or `info`. | The app |
| **Channel** | Where a user receives messages: `sneed_sms` (their Sneed SMS inbox, needs no address), `push`, `discord`, `telegram`, `email`, `sms`. Non-SMS channels hold an address encrypted to the relay of their kind, and must be verified. | The user |
| **Permission** | One user's rules for one app: allowed or blocked, demote every topic a level, only the "always copy" channel, mute until a time, a daily message cap, a daily spending cap, and per-topic rules. | The user |
| **Settings** | One user's channels per level, the "always copy to" channel, quiet hours and a snooze. | The user |
| **Notification** | One message to one user, with one **job** per channel it goes to. | The app, by `notify` |
| **Relay** | A principal registered for one channel kind that pulls due jobs, delivers them and acknowledges. | Sneed DAO admins (`admin_set_config`) |

The app with id `0` is the service itself ("Sneed Notifications"); it sends channel verification codes.

### 1.2 Consent first

`notify` only reaches users who have **allowed** the app. Without a permission record the answer is `#not_allowed`. An app can ask with `request_permission(user)`, which puts the app in the user's list of open requests (`get_my_requests`); the user answers with `allow_app(app, true|false)`. A user can also allow any app directly. The app never learns a user's channels or addresses, only whether its messages were delivered (`get_receipts`).

### 1.3 Which channels a message goes to

For each message the canister decides, from the user's permission and settings:

1. **Level:** the topic's level, one lower if the permission has `demote`, or the level of a per-topic `#level` rule.
2. **Muted:** a per-topic `#mute` rule drops the message entirely (no channels, not even the copy).
3. **Paused:** while the user's `snooze_until` or the permission's `muted_until` is in the future, or when the permission is `copy_only`, only the "always copy to" channel gets it.
4. **Otherwise:** the channels of a per-topic `#channels` rule, else the user's default channels for the level (`settings.defaults.urgent | normal | info`), plus the "always copy to" channel.
5. Only **verified** channels are used.
6. **No echoes:** a message from the canister this service delivers Sneed SMS through (the `sneed_sms` principal of the config) never goes to `sneed_sms` channels, neither chosen ones nor the "always copy to" one. The rule keys on the calling canister, whatever its app or topic. Sneed SMS uses it for its "new direct message" notices (app Sneed Hub, topic `direct_message`): the message is in the inbox already, and a copy there would be a system message, which Sneed SMS never notifies for, so no loop is possible either way. Such a notice can therefore be recorded with no delivery at all (`deliveries = 0`) for a user who has only the Sneed SMS channel.

A user who never changed anything has no default channels and `always_copy` set to their Sneed SMS channel, so by default **every allowed message goes to the user's Sneed SMS inbox** and nowhere else.

**Quiet hours** (`settings.quiet`: start and end in minutes after local midnight, the user's UTC offset in minutes) hold back deliveries to relayed channels until the quiet period ends. Sneed SMS is never held back. With `urgent_passes`, urgent messages are not held back at all.

### 1.4 Paying

Prices are per delivery, in ICP e8s, per channel kind (`get_config().prices_e8s`), plus `notify_price_e8s` per `notify` call. On production on 2026-10-20: Sneed SMS 0, push 100, Discord 100, Telegram 100, email 1,000, SMS 1,000,000, and 0 per call. Read the config at run time.

- **User pays** (`sponsored = false`): each delivery is charged to the user's balance, channel by channel. A delivery the balance cannot cover is **suppressed** with reason `not enough balance`; one that would exceed the permission's `daily_spend_cap_e8s` for this app today is suppressed with `daily spending cap for this app`. Free channels (Sneed SMS) always go out. The per-call price is taken only if the balance and cap allow it.
- **App pays** (`sponsored = true`): the whole message (every chosen delivery plus the per-call price) is charged to the app's balance, all or nothing. If the app's balance is short, `notify` fails with `#no_funds`. The user's spending cap does not apply; the daily message cap does.
- **Refunds:** a delivery that finally fails is refunded to whoever paid. Suppressed deliveries cost nothing.
- **Balances** are topped up with ICP through ICRC-2: `top_up` for the caller, `top_up_app` for any app (anyone may fund any app). The transfer carries the memo `sneednotif:top_up` or `sneednotif:app_top_up` and a `created_at_time`; each top-up is recorded per payer with its ledger block. There is no method to withdraw a balance.
- **A removed app's balance** stays where it is when an admin removes the app: its recorded owner (or an admin for the owner) moves it to the owner's own notification balance with `claim_removed_app_balance(id)`.
- **Old notifications** are deleted after `retention_ns`; a paid delivery that never became final by then is refunded to whoever paid for it.
- **Where the money goes:** what is charged (deliveries and the per-call price, less refunds) is Sneed DAO revenue. The canister forwards it in one ICRC-1 transfer to `fee_destination` (by default the RLL ICP splitter, `6jvpj-sqaaa-aaaaj-azwnq-cai` subaccount `01 00 00 00 00 06` + 26 zero bytes, where Sneed Premium, Sneedex and Sneed Lock pay too) once `fee_sweep_threshold_e8s` (0.1 ICP) has accumulated; the ledger fee comes off the amount. A check runs from the delivery timer at most every 5 minutes. Balances are never touched: before every transfer the canister reads its ledger balance, and the transfer must leave at least every user and app balance, every paid delivery that may still be refunded, and top-ups in flight. The ICP spent before forwarding existed (the backlog) was measured once, at the first check after the upgrade, as the ledger balance minus all of that. Read it all with `get_fee_forwarding()` (5.3).

### 1.5 Caps and repeats

- **Daily message cap:** `permission.daily_cap` messages per user, per app, per UTC day (default `default_daily_cap`, 20 on production). Beyond it `notify` answers `#rate_limited`.
- **Dedupe:** a `notify` with `dedupe = ?key` within `dedupe_window_ns` (1 hour on production) of an earlier one with the same key, for the same user and app, is folded: `#ok({ id = 0; deliveries = 0; deduplicated = true })`, nothing is sent.

### 1.6 Addresses and what each party sees

Addresses of relayed channels (a Discord id, a push subscription, an email address) are encrypted **in the user's client** to the public key of the relay for that kind (`get_relay_keys`), and stored here as an opaque blob. The canister and its other callers never see them in clear; the relay that delivers to a channel decrypts it. The owner of a channel can read back only the encrypted blob (`get_my_settings`).

Titles, bodies and links of notifications are stored as plain text, readable by the user (`get_my_history`), by the relay that delivers them (`relay_pull`), and they end up in the user's Sneed SMS inbox for the Sneed SMS channel (see the [Sneed SMS API](/api/sneed_sms), whose admins can read every message). Do not send secrets. Notifications and their jobs are deleted after `retention_ns` (30 days on production).

Sending is done by the app's canister, receiving by the user's principal; both are public principals, nothing here is anonymous.

### 1.7 Time and amounts

Timestamps are `int` nanoseconds since the Unix epoch (`BigInt(Date.now()) * 1_000_000n` in JavaScript). Amounts and prices are ICP e8s (`nat`).

### 1.8 Calls the canister refuses at ingress

Before it accepts an update call from outside the IC the canister checks it (`inspect`):

- **Query methods only answer query calls.**
- **`notify`, `notify_batch` and `request_permission` are never accepted from outside the IC.** Only a canister listed in a registered app can call them, by an inter-canister call. Testing from dfx means calling through a canister of your app.
- **Admin methods** (including the activity log's `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`) are accepted only from admins; **`relay_pull` and `relay_ack`** only from registered relays.
- **Every other update** is refused from the anonymous principal. Argument size caps: 4 KiB by default, 64 KiB for `register_app`, `update_app`, `relay_ack` and admin config calls, about 13 KiB for `add_channel`, `set_settings` and `set_permission`.

---

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './sneed_notifications.did.js'; // https://app.sneeddao.com/api-docs/sneed_notifications.did.js

const NOTIFICATIONS = 'vuy7a-iaaaa-aaaay-aaduq-cai';

export function notificationsActor(identity) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId: NOTIFICATIONS });
}
```

With dfx:

```bash
dfx canister --network ic call vuy7a-iaaaa-aaaay-aaduq-cai list_apps '(0, 50)' --query
```

### 2.2 For a dapp: register, ask, notify

Register once, from a principal that controls each canister you list (or from the SNS governance canister of an SNS whose root controls them, or from the canister itself):

```js
const r = await notificationsActor(controllerIdentity).register_app({
  name: 'My Dapp',
  logo: ['https://mydapp.example/logo.png'],     // opt text, https only
  description: 'Alerts about your vaults.',
  canisters: [Principal.fromText(MY_BACKEND)],   // these may call notify
  topics: [
    { id: 'liquidation', title: 'Liquidation risk', description: 'Your vault is close to liquidation', level: { urgent: null } },
    { id: 'weekly', title: 'Weekly summary', description: 'What happened this week', level: { info: null } },
  ],
});
if ('err' in r) throw new Error(r.err);
const appId = r.ok;
```

Then, from your backend canister (Motoko):

```motoko
type Level = { #urgent; #normal; #info };
type NotifyError = { #not_registered; #unknown_topic; #not_allowed; #rate_limited; #no_funds; #invalid : Text };
type Notifications = actor {
  request_permission : shared Principal -> async { #ok : Text; #err : Text };
  notify : shared {
    user : Principal; topic : Text; title : Text; body : Text;
    link : ?Text; dedupe : ?Text; sponsored : Bool;
  } -> async { #ok : { id : Nat; deliveries : Nat; deduplicated : Bool }; #err : NotifyError };
};
let notifications : Notifications = actor "vuy7a-iaaaa-aaaay-aaduq-cai";

// once per user, e.g. when they create a vault
ignore await notifications.request_permission(user);

// when something happens
switch (await notifications.notify({
  user; topic = "liquidation";
  title = "Vault #12 is at 92% of its limit";
  body = "Add collateral or repay to stay safe.";
  link = ?"https://mydapp.example/vaults/12";
  dedupe = ?"liquidation-12";    // at most one per dedupe window
  sponsored = false;             // the user's balance pays (Sneed SMS is free)
})) {
  case (#ok r) { /* r.id: keep it for get_receipts */ };
  case (#err(#not_allowed)) { /* the user has not allowed the app */ };
  case (#err e) { /* see section 4 */ };
};
```

### 2.3 For a user: allow, add a channel, top up

```js
const n = notificationsActor(identity);

// Allow an app (default caps), or block it with false
await n.allow_app(appId, true);

// See requests and what you allowed
const requests = await n.get_my_requests();          // vec App
const mine = await n.get_my_apps();                   // vec (App, Permission)

// Top up the balance with ICP: approve amount + ledger fee first
const amount = 100_000n;                              // e8s
await icpLedger.icrc2_approve({
  spender: { owner: Principal.fromText(NOTIFICATIONS), subaccount: [] },
  amount: amount + 10_000n, from_subaccount: [], expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [],
});
const t = await n.top_up(amount);                     // { ok: newBalance } | { err: text }
```

### 2.4 Add an encrypted channel and verify it

```js
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// get_relay_keys: [(ChannelKind, text)], text = JSON { enc: base64 SPKI RSA-OAEP-256 key, vapid?: push key }
async function encryptFor(encSpkiB64, obj) {
  const rsa = await crypto.subtle.importKey('spki', unb64(encSpkiB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(obj)));
  const k = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, await crypto.subtle.exportKey('raw', aes));
  return new TextEncoder().encode(JSON.stringify({ k: b64(k), iv: b64(iv), c: b64(c) }));
}

async function addDiscord(identity, discordId) {
  const n = notificationsActor(identity);
  const keys = await n.get_relay_keys();
  const hit = keys.find(([kind]) => 'discord' in kind);
  if (!hit) throw new Error('No Discord relay yet');
  const { enc } = JSON.parse(hit[1]);
  const r = await n.add_channel({ discord: null }, 'Discord', await encryptFor(enc, { discord_id: discordId }));
  if ('err' in r) throw new Error(r.err);
  return r.ok;                    // channel id; a 6-digit code is on its way through the relay
}

// The user types the code they received:
const v = await notificationsActor(identity).verify_channel(channelId, '123456');
```

The address format inside the encrypted envelope is the relay's business. The reference frontend sends `{ discord_id }` to the Discord relay and the browser's `PushSubscription.toJSON()` to the push relay.

### 2.5 Route levels to channels

```js
const { settings, channels, balance_e8s } = await n.get_my_settings();
const sms = channels.find((c) => 'sneed_sms' in c.kind);
const discord = channels.find((c) => 'discord' in c.kind && 'verified' in c.state);
await n.set_settings({
  defaults: { urgent: [discord.id], normal: [], info: [] },
  always_copy: [sms.id],                                         // opt nat
  quiet: [{ start_min: 23n * 60n, end_min: 7n * 60n, utc_offset_min: 60n, urgent_passes: true }],
  snooze_until: [],
});
```

---

## 3. Flows in detail

### 3.1 Registering and updating an app

`register_app(input)` checks the input (section 6 limits), then for each listed canister that it does not already belong to an app, and that the caller controls it: the caller is among the canister's controllers (read with the management canister's `canister_info`), or the caller is the governance canister of an SNS (as listed by SNS-W) whose root controls it, or the canister is the caller itself. The caller becomes the app's **owner**. Errors: `Please sign in`, the input messages, `<canister> already belongs to an app`, `Could not read the canister's controllers: ...`, `You are not a controller of this canister`. Returns the app id.

`update_app(id, input)` (owner or admin) replaces name, logo, description, canisters and topics; the owner stays. Newly added canisters need the same control proof, except when an admin calls (admins may register any canister with `admin_register_app` already). Errors: `No such app`, `Only the app's owner`, `<canister> belongs to another app`, the input and control messages. Removing a topic leaves per-topic rules of users that name it in place; they no longer match.

### 3.2 Notifying

`notify(input)` (canister calls only) returns the first failure of:

1. `#not_registered`: the caller is not a canister of a registered app.
2. `#invalid("A title of 1 to N characters")`, `#invalid("The body is at most N characters")`, `#invalid("Links must be https and at most 512 characters")`.
3. `#unknown_topic`.
4. `#not_allowed`: the user has no permission record for the app, or blocked it.
5. `#rate_limited`: the daily message cap for this app is reached.
6. Dedupe (1.5): `#ok` with `deduplicated = true`.
7. `#no_funds`: sponsored and the app's balance is short.

On success it records the notification, creates the jobs (1.3, 1.4), counts one message against the cap, and returns `#ok({ id; deliveries; deduplicated = false })`, where `deliveries` is the number of jobs queued (suppressed ones not counted; `0` is possible). Delivery starts at once in a timer.

Note the order: the dedupe key is recorded before the balance check, so a sponsored message that failed with `#no_funds` blocks the same `dedupe` key for the rest of the window. Top up before you retry, or retry with a different key.

`notify_batch(inputs)` does the same for up to 100 messages (more traps) and returns one result per input, in order.

### 3.3 Receipts

`get_receipts(ids)` (at most 500 ids, more traps) answers, for each id, `null` unless the notification belongs to the caller's app (admins see all), else `{ id; created_at; state }` with `state`:

| State | Meaning |
|---|---|
| `#delivered` | At least one channel got it. |
| `#pending` | Nothing delivered yet, a job is queued or out with a relay. |
| `#failed(reason)` | Every job ended, at least one failed. |
| `#suppressed(reason)` | No job was sent (balance, spending cap, or `no channel chosen for this message` when no channel matched). |
| `#expired` | None of the above. |

Receipts disappear with the notification after the retention period. The id `0` of a folded message has no receipt.

### 3.4 Channels

- `add_channel(kind, name, address)`: for `#sneed_sms` returns the user's SMS channel id (made on first use; every user has exactly one). For other kinds: `name` up to 64 characters, `address` 1 to 2,048 bytes, at most 20 channels per user (the SMS channel counts). The new channel is `#unverified`; a 6-digit code, valid for 24 hours, goes out free through the relay of that kind as an urgent message from app 0. Returns the channel id.
- `verify_channel(id, code)`: errors `Nothing to verify`, `Not your channel`, `The code expired; remove the channel and add it again`, `Wrong code`. Returns `Verified`.
- `resend_code(id)`: sends a channel that is still waiting a new 6-digit code (the old one stops working; wrong-code count reset). Counts toward the same 5 per user per UTC day as `add_channel`. Errors `Not your channel`, `This channel needs no code`, `At most 5 codes a day; try again tomorrow`.
- `set_low_balance_alert(threshold_e8s)` / `get_low_balance_alert() -> { threshold_e8s; default_e8s }` (query): when a paid delivery takes the user's balance below the threshold, or one is skipped for lack of balance, the user gets one free notification (topic `low_balance`, from Sneed Notifications) on Sneed SMS and their urgent channels; a top-up back above the threshold arms it again. Default 10_000 e8s (0.0001 ICP); 0 turns it off.
- `remove_channel(id)`: deletes the channel and its address, its pending code, and its uses in the caller's settings. Jobs still queued for it fail (`channel removed`, refunded) when its relay next pulls. Error: `Not your channel`.

### 3.5 Relays

A relay is a principal listed in `config.relays` with one channel kind. It loops:

1. `relay_pull(max)`: up to `min(max, 100)` due jobs of its kind (queued and past `not_before`). Each moves to `#sending` and comes back as a `RelayJob` with the encrypted address, the app name, title, body, link and level. Traps with `Not a relay` for others.
2. Deliver each one.
3. `relay_ack(vec (job_id, #ok | #err text))`: `#ok` marks the job delivered; `#err` retries it after 1, 2, 3, ... minutes and fails it (with refund) after `max_attempts` (5). Acks for jobs not out with this relay are ignored.

A job not acknowledged within `relay_lease_ns` (10 minutes) goes back to the queue as a failed attempt (`relay did not answer`). Sneed SMS jobs are delivered by the canister's own timer (every 30 seconds and right after each `notify`, 20 per round) through Sneed SMS `send_system_notification`, with subject `[App name] title` and the body followed by the link and a footer that links to the notification centre.

---

## 4. Concurrency, errors and retries

**Result shapes.** Most updates return `Result = variant { ok : text; err : text }` or `ResultNat = variant { ok : nat; err : text }` (lowercase tags; `ok` text is a short confirmation such as `Saved`). `notify` returns `NotifyResult` with the `NotifyError` variant. Branch on the tag; the texts are for people.

**Traps.** `notify_batch` with more than 100 inputs, `get_receipts` with more than 500 ids, and relay methods called by non-relays trap.

**Retries.** `notify` has no awaits; a rejected call recorded nothing. It is not idempotent: give important messages a `dedupe` key so a retry after a timeout is folded instead of sent twice. `register_app` and `update_app` await the management canister; a canister claimed by a concurrent call is caught again after the awaits. `top_up` and `top_up_app` credit the balance in the same message that receives the ledger's confirmation, so a transfer that went through is always credited. If your client timed out, read `get_my_settings().balance_e8s` (or `get_app_balance`) and the remaining ICRC-2 allowance before calling again; a second call pulls again.

**A top-up whose outcome the canister never learned** (`The ledger did not answer: ...`) may still have moved the ICP. Support finds the block on the ledger (memo `sneednotif:top_up`, from the user's default account to this canister) and an admin credits it with `admin_credit(principal, amount_e8s, ledger_block)`: the canister reads the block and credits only a transfer of exactly that amount from that principal's default account to its own, at most once per block (blocks already credited by a top-up included). A block older than the canister's top-up records (they begin with the first block of the activity log) is refused, since it may have been credited without a record.

**ICP top-up errors:** `Nothing to top up`, `Approve this canister for the amount first (allowance N)`, `Not enough ICP (balance N)`, `The ledger refused the transfer`, `The ledger did not answer: ...`. The approval must cover the amount plus the ICP ledger fee (10,000 e8s), both taken from the caller's default account.

---

## 5. Method reference

"Caller" means the principal signing the call.

### 5.1 Apps

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `register_app(AppInput)` | update | `ResultNat` | 3.1. The app id. |
| `update_app(id, AppInput)` | update | `Result` | 3.1. Owner or admin. |
| `top_up_app(id, amount_e8s)` | update | `ResultNat` | Anyone; ICRC-2 pull of ICP. Errors `No such app` and the top-up errors. Returns the app's new balance. |
| `request_permission(user)` | update, canisters only | `Result` | `ok`: `Asked`, `Already asked`, `Already decided by the user`. `err`: `Not a registered app canister`, `The user has too many open requests` (50). |
| `notify(NotifyInput)` | update, canisters only | `NotifyResult` | 3.2. |
| `notify_batch(vec NotifyInput)` | update, canisters only | `vec NotifyResult` | Up to 100. |
| `get_receipts(vec nat)` | query | `vec opt Receipt` | 3.3. Answers only for the calling app's canisters. |

### 5.2 Users

All refuse the anonymous principal (`Please sign in` where the method checks it).

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `allow_app(app, allow : bool)` | update | `Result` | `Allowed` / `Blocked`. Creates the permission with the defaults, or flips `allowed` on the existing one; removes the open request. Error `No such app`. |
| `set_permission(app, Permission)` | update | `Result` | Replaces the whole permission (this also allows or blocks). Errors `No such app`, `Too many topic rules` (> 50), `Unknown topic <id>`, `Unknown channel`. |
| `set_settings(Settings)` | update | `Result` | Errors `Unknown channel`, `Quiet hours in minutes of the day (0-1439), time zone within ±14 h`. |
| `add_channel(kind, name, address : blob)` | update | `ResultNat` | 3.4. |
| `verify_channel(id, code : text)` | update | `Result` | 3.4. |
| `resend_code(id)` | update | `Result` | 3.4. |
| `set_low_balance_alert(threshold_e8s : nat)` | update | `Result` | 3.4. |
| `get_low_balance_alert()` | query | `record { threshold_e8s : nat; default_e8s : nat }` | 3.4. |
| `remove_channel(id)` | update | `Result` | 3.4. |
| `top_up(amount_e8s)` | update | `ResultNat` | The caller's new balance. |
| `claim_removed_app_balance(id)` | update | `ResultNat` | The owner of an app an admin removed (or an admin for them) moves its balance to the owner's notification balance; returns the owner's new balance. Errors `No removed app N`, `Only the app's owner`, `Nothing to claim`. |
| `get_my_settings()` | query | `{ settings; channels; balance_e8s }` | A user who never made an update call gets default settings whose `always_copy` id is not stored yet; call `add_channel({ sneed_sms: null }, '', [])` or `set_settings` once to fix it. |
| `get_my_apps()` | query | `vec (App, Permission)` | Apps the caller allowed or blocked. |
| `get_my_requests()` | query | `vec App` | Open requests. |
| `get_my_history(limit)` | query | `vec HistoryItem` | Newest first, at most 200, with each delivery's state. |

### 5.3 Public reads

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `get_app(id)` | query | `opt App` | |
| `get_app_of(canister)` | query | `opt App` | The app a canister sends for. |
| `get_app_balance(id)` | query | `nat` | e8s available for sponsored messages. |
| `list_apps(start, limit)` | query | `vec App` | Ascending id from `max(start, 1)`, at most 200. |
| `get_config()` | query | `Config` | Prices, caps, limits, relays, retention. |
| `get_relay_keys()` | query | `vec (ChannelKind, text)` | Each relay kind's key document (JSON, see 2.4). |
| `get_admins()` | query | `vec principal` | Listed admins (controllers are admins too). |
| `stats()` | query | `{ apps; users; notifications; pending; last_tick_at : int; ticking : bool }` | `users` counts principals with a channel. `last_tick_at`: when the delivery timer (every 30 s) last ran; `ticking`: a run in progress. |
| `get_fee_forwarding()` | query | `FeeForwarding` | Revenue: destination, threshold, fees earned, refunded and forwarded, the backlog, what is unforwarded and owed, the last forward and error, the last 20 events (1.4). |
| `icrc3_get_blocks`, `icrc3_get_archives`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`, `icrc10_supported_standards`, `icrc3_log_status` | query | | The activity log ([8](#8-activity-log-icrc-3)); not deployed yet. |

### 5.4 Relays

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `relay_pull(max)` | update, relays only | `vec RelayJob` | 3.5. |
| `relay_ack(vec (nat, variant { ok; err : text }))` | update, relays only | `()` | 3.5. |

### 5.5 Admin methods

Admins are the canister's controllers and the principals in `get_admins()`. All answer `Admins only` to others.

| Method | What it does |
|---|---|
| `admin_register_app(owner, AppInput)` | Registers an app with any owner (for DAO canisters), already verified, without the control check. |
| `admin_set_config(Config)` | Replaces the whole config (prices, caps, relays, ...). |
| `admin_set_relay_key(kind, key)` | Publishes (or with `""` removes) a relay kind's key document. |
| `admin_set_app_verified(id, bool)` | The checkmark. |
| `admin_remove_app(id)` | Removes an abusive app; its canisters can no longer notify. Its balance stays for the owner (`claim_removed_app_balance`). |
| `admin_get_removed_app(id)` (query) | A removed app's record (owner, canisters); its balance: `get_app_balance(id)`. |
| `admin_credit(principal, amount_e8s, ledger_block)` | Credits a top-up the canister never confirmed, after reading the block on the ledger (4). Returns the user's new balance. Errors: `... is already credited`, `... is being credited`, `... moved N e8s, not M`, `... was not sent from that principal's account`, `... was not sent to this canister`, `... is older than the top-up records ...`, `The ledger has no block N`, `Could not read the ledger: ...`. |
| `admin_get_user(principal, history_limit)` (query) | `variant { ok : AdminUserView; err : text }`: the user's balance, low-balance alert, settings, channels (addresses as stored: encrypted), apps and permissions, open requests, top-ups (newest first, at most 100, each with `ledger_block`, `amount_e8s`, `at`, `app`, `via` = `top_up`, `app_top_up` or `admin_credit`), recent history (at most `history_limit`, 200 at most; verification codes hidden as in `get_my_history`), and the deliveries not final yet with their prices. |
| `admin_add_admin(p)`, `admin_remove_admin(p)` | Edit the admin list. |
| `admin_set_fee_destination(opt Account)` | Where fees go; `null` keeps them in the canister. A subaccount must be 32 bytes. |
| `admin_set_fee_sweep_threshold(e8s)` | Forward once this much is unforwarded (default 10,000,000 = 0.1 ICP). |
| `admin_forward_fees_now()` | Forwards what is unforwarded now, whatever the threshold (still minus the ledger fee, never below the liabilities). |
| `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`, `get_log(start, length)` | The activity log's settings, archiving and operational messages ([8](#8-activity-log-icrc-3)). |

---

## 6. Types

```candid
type Level = variant { urgent; normal; info };
type ChannelKind = variant { sneed_sms; push; discord; telegram; email; sms };

type Topic = record { id : text; title : text; description : text; level : Level };
type AppInput = record {
  name : text;               // 1-64 characters
  logo : opt text;           // https, at most 512 characters
  description : text;        // at most 500
  canisters : vec principal; // 1-20, each in at most one app
  topics : vec Topic;        // 1-50; id 1-64, title <= 100, description <= 300, ids unique
};
type App = record {
  id : nat; name : text; logo : opt text; description : text; owner : principal;
  canisters : vec principal; topics : vec Topic; verified : bool; created_at : int;
};

type Channel = record {
  id : nat; kind : ChannelKind; name : text;
  address : blob;            // encrypted to the relay of its kind; empty for Sneed SMS
  state : variant { unverified; verified };
  created_at : int;
};

type TopicRule = variant { mute; level : Level; channels : vec nat };
type Permission = record {
  allowed : bool;
  demote : bool;             // every topic one level down
  copy_only : bool;          // only the "always copy to" channel
  muted_until : opt int;
  daily_cap : nat;           // messages a day from this app
  daily_spend_cap_e8s : nat; // what this app may cost the user a day
  topics : vec record { text; TopicRule };
};
type QuietHours = record { start_min : nat; end_min : nat; utc_offset_min : int; urgent_passes : bool };
type Settings = record {
  defaults : record { urgent : vec nat; normal : vec nat; info : vec nat };
  always_copy : opt nat;
  quiet : opt QuietHours;
  snooze_until : opt int;
};

type NotifyInput = record {
  user : principal; topic : text; title : text; body : text;
  link : opt text;           // https, at most 512 characters
  dedupe : opt text;
  sponsored : bool;
};
type NotifyError = variant { not_registered; unknown_topic; not_allowed; rate_limited; no_funds; invalid : text };
type NotifyResult = variant { ok : record { id : nat; deliveries : nat; deduplicated : bool }; err : NotifyError };

type JobState = variant {
  queued;
  sending : record { relay : principal; since : int };
  delivered : record { at : int };
  failed : record { reason : text };
  suppressed : record { reason : text };
};
type Receipt = record {
  id : nat; created_at : int;
  state : variant { pending; delivered; suppressed : text; failed : text; expired };
};
type HistoryItem = record {
  id : nat; app : nat; app_name : text; topic : text; level : Level;
  title : text; body : text; link : opt text; created_at : int;
  deliveries : vec record { channel : nat; kind : ChannelKind; state : JobState };
};
type RelayJob = record {
  id : nat; kind : ChannelKind; address : blob; app : text;
  title : text; body : text; link : opt text; level : Level; created_at : int;
};

type Config = record {
  icp_ledger : principal; sneed_sms : principal; sns_wasm : principal;
  prices_e8s : vec record { ChannelKind; nat }; // per delivery
  notify_price_e8s : nat;                       // per notify call
  dedupe_window_ns : nat; retention_ns : nat;
  default_daily_cap : nat; default_daily_spend_cap_e8s : nat;
  max_title : nat; max_body : nat;
  relays : vec record { principal; ChannelKind };
  relay_lease_ns : nat; max_attempts : nat;
};

type Account = record { owner : principal; subaccount : opt blob };
type FeeForwarding = record {
  destination : opt Account;      // null: fees stay in the canister
  threshold_e8s : nat;
  ledger_fee_e8s : nat;
  earned_e8s : nat;               // prices deducted from balances since forwarding existed
  refunded_e8s : nat;             // of those, refunded (deliveries that finally failed)
  forwarded_e8s : nat;            // received by the destination
  ledger_fees_paid_e8s : nat;
  forwards : nat;
  backlog_e8s : opt nat;          // spent before forwarding existed; null until the first check
  unforwarded_e8s : opt nat;      // may go out now; null until the first check
  liabilities_e8s : nat;          // balances + refundable paid deliveries + top-ups in flight
  reserved_e8s : nat;             // paid deliveries not final yet
  last_check : int;
  last_forward : opt record { at : int; amount_e8s : nat; block : nat; to : Account };
  last_error : opt text;
  retry_pending : bool;           // a transfer with an unknown outcome, retried with the same arguments
  events : vec record { int; text };
};

// one ICP payment credited to a balance (admin_get_user)
type TopUp = record {
  ledger_block : nat;
  amount_e8s : nat;
  at : int;
  app : opt nat;                  // an app top-up: the app it funded
  via : variant { top_up; app_top_up; admin_credit };
};

type AdminUserView = record {
  balance_e8s : nat;
  low_balance_alert : record { threshold_e8s : nat; alerted : bool };
  settings : Settings;
  channels : vec Channel;
  apps : vec record { App; Permission };
  requests : vec App;
  top_ups : vec TopUp;            // newest first, at most 100
  history : vec HistoryItem;      // newest first
  pending_jobs : nat;             // deliveries to this user not final yet
  reserved_e8s : nat;             // their prices
};

type Result = variant { ok : text; err : text };
type ResultNat = variant { ok : nat; err : text };
```

Default permission (from `allow_app`): allowed, no demote, not copy-only, not muted, `daily_cap = default_daily_cap`, `daily_spend_cap_e8s = default_daily_spend_cap_e8s` (100,000 e8s on production), no topic rules.

---

## 7. Integration checklist

**Dapps**
- Register from a controller of your canisters (or your SNS governance by proposal); ask Sneed DAO for the verified checkmark if you want it.
- Call `notify` from a listed canister; ingress calls are refused.
- Ask once with `request_permission`; treat `#not_allowed` as normal, not as an error to retry.
- Give alerts that can repeat a `dedupe` key.
- Keep titles short and put details behind an `https` link; never put secrets in a message.
- Store returned ids if you want `get_receipts`; they expire after the retention period.
- Sponsor only what you must, and keep `get_app_balance` funded; `#no_funds` never falls back to the user.

**Front ends for users**
- Show open requests (`get_my_requests`) and let users allow, block and set caps per app.
- Encrypt every address to the relay key in the client; never send it in clear.
- Show the balance and the prices from `get_config()`; tell users balances cannot be withdrawn.
- Make sure the user's Sneed SMS channel exists (any update call creates it) before saving its id in settings.

---

## 8. Activity log (ICRC-3)

**Status: in the source on `main`, not deployed yet.** Until the upgrade, the methods below do not exist on production or staging.

What concerns money and governance is recorded as a block in a hash-chained, certified log, readable through the standard [ICRC-3](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3) interface: top-ups of user and app balances (with the ICP ledger block), refunds of failed paid deliveries, the forwarding of the earned fees to the RLL splitter (with the ledger block), the measurement of the fee books, apps registered, changed, verified and removed, the admin list and every configuration value. Each block carries the hash of the previous block (`phash`), and the canister certifies the index and hash of the latest block, so anyone can download the history and prove it complete and untampered. Old blocks move to archive canisters that the canister creates.

**What was sent to whom is never logged.** No block carries a notification's title, body or link, a channel's name, kind or address, a verification code, a delivery or the user a message was for. A refund block says how much went back and whether a user or an app had paid, not who.

The log uses the same library as [Sneed Lock's log](/api/sneed_lock#8-activity-log-icrc-3) ([src/icrc3](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/icrc3)); the design is in [spec/notifications_icrc3.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/notifications_icrc3.md). It starts empty with the release that introduces it; nothing from before is imported.

### 8.1 Endpoints

| Method | Type | Returns |
|---|---|---|
| `icrc3_get_blocks(vec record { start : nat; length : nat })` | query | `{ log_length; blocks : vec { id; block }; archived_blocks : vec { args; callback } }`. For archived ranges call `callback` (the archive's own `icrc3_get_blocks`) with `args`. |
| `icrc3_get_archives(record { from : opt principal })` | query | Every archive canister with the first and last block index it holds. |
| `icrc3_get_tip_certificate()` | query | `opt { certificate; hash_tree }` with `last_block_index` and `last_block_hash`. Null until the first block exists. |
| `icrc3_supported_block_types()` | query | Every `btype` below, each with the url of [8.3](#83-block-types). |
| `icrc10_supported_standards()` | query | ICRC-3 and ICRC-10. |
| `icrc3_log_status()` | query | Log length, live blocks, hash of the last block, archives, spill settings. `history_imported` is always false. |

Admin only: `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers` (as on Sneed Lock) and the query `get_log(start, length)`, the log's operational messages (spills, archives created, failures). The ingress guard refuses the queries as update calls and the admin methods from others. Archives are controlled by this canister and the Sneed SNS root (`fp274-iaaaa-aaaaq-aacha-cai`) until a `RegisterDappCanisters` proposal hands them to SNS root alone.

### 8.2 Block format

A block is a `Map` with `btype` (Text), `ts` (Nat, ns since epoch), `phash` (Blob, absent on block 0) and `tx` (Map). Inside `tx`: principals are `Blob`; accounts are `Array [owner, subaccount?]`; amounts (ICP e8s), ids and ledger block indexes are `Nat`; flags are `Nat` 0 / 1. The first field is `caller` (the principal that made the call), or `via` = `"timer"` for what the canister's own timer did (fee checks, Sneed SMS delivery, lapsed relay leases) and `via` = `"upgrade"` for what an upgrade did. A value that is not set is the Text `none`.

### 8.3 Block types

All types carry the `sneednotif_` prefix. A block is appended once its action is final; a refused call, and a call that changes nothing, appends nothing.

| `btype` | When | `tx` fields |
|---|---|---|
| `sneednotif_top_up` | `top_up` credited a user balance. | `caller` (the user), `amount_e8s`, `ledger_block` |
| `sneednotif_app_top_up` | `top_up_app` credited an app balance. | `caller` (the funder), `app_id`, `amount_e8s`, `ledger_block`, `app_balance_e8s` (after) |
| `sneednotif_refund` | A paid delivery failed finally, or was pruned before it became final, and its price went back to whoever paid. | `caller` (the relay) or `via`, `amount_e8s`, `paid_by` (`user` or `app`), `refunded_e8s` (all refunds so far) |
| `sneednotif_fee_forward` | Earned fees went to the fee destination. | `caller` (`admin_forward_fees_now`) or `via`, `amount_e8s` (received), `fee_e8s` (ledger fee), `to`, `ledger_block`, `forwards`, `forwarded_e8s` (totals after) |
| `sneednotif_fee_backlog` | The first fee check measured the books (1.4). | `caller` or `via`, `balance_e8s`, `liabilities_e8s`, `free_e8s`, `backlog_e8s` |
| `sneednotif_fee_remeasure` | The ledger showed less free ICP than the books; measured again. | `caller` or `via`, `books_e8s`, `balance_e8s`, `liabilities_e8s`, `free_e8s` |
| `sneednotif_app_register` | `register_app`, `admin_register_app` | `caller`, `app_id`, `name`, `owner`, `canisters`, `topics` (Array of `Map { id; title; level }`), `verified` |
| `sneednotif_app_update` | `update_app` changed something. | `caller`, `app_id`, `name`, `owner`, `canisters`, `topics` (after), `changed` (Array of `name`, `logo`, `description`, `canisters`, `topics`), and `old_name`, `old_canisters`, `old_topics` for those that changed (logo and description texts are not logged) |
| `sneednotif_app_verify` | `admin_set_app_verified` changed the checkmark. | `caller`, `app_id`, `name`, `verified` |
| `sneednotif_app_remove` | `admin_remove_app` | `caller`, `app_id`, `name`, `owner`, `canisters`, `app_balance_e8s` (left for the owner) |
| `sneednotif_app_balance_claim` | `claim_removed_app_balance` moved a removed app's balance to its owner. | `caller`, `app_id`, `owner`, `amount_e8s`, `balance_e8s` (the owner's, after) |
| `sneednotif_admin_credit` | `admin_credit` credited a checked ledger block. | `caller` (the admin), `principal` (credited), `amount_e8s`, `ledger_block`, `balance_e8s` (after) |
| `sneednotif_admin_add` / `sneednotif_admin_remove` | The admin list changed. | `caller` (or `via` = `"upgrade"`), `principal` |
| `sneednotif_config_update` | A setting changed: one block per value. | `caller`, `key`, `old_value`, `value` |

`sneednotif_config_update` keys: from `admin_set_config` `icp_ledger`, `sneed_sms`, `sns_wasm`, `prices_e8s` (Map kind -> e8s), `notify_price_e8s`, `dedupe_window_ns`, `retention_ns`, `default_daily_cap`, `default_daily_spend_cap_e8s`, `max_title`, `max_body`, `relays` (Array of `[relay, kind]`), `relay_lease_ns`, `max_attempts`; `relay_key` with `kind` (the public key document, Text; `none` when removed); `fee_destination`, `fee_sweep_threshold_e8s`; the log settings `icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`.

Not logged: notifications and their deliveries, receipts, channels, verification codes, user settings, permissions and requests, low-balance alerts, and the ledger fee learnt from a `BadFee` answer.

### 8.4 Verifying and using the log

- **Verify it:** the procedure and the Node.js script of [Sneed Lock's 8.4](/api/sneed_lock#84-verifying-the-log) work unchanged with the canister id `vuy7a-iaaaa-aaaay-aaduq-cai` (or staging `uqvqs-raaaa-aaaay-aadsq-cai`).
- **Browse it:** [app.sneeddao.com/tools/icrc3?canister=vuy7a-iaaaa-aaaay-aaduq-cai](https://app.sneeddao.com/tools/icrc3?canister=vuy7a-iaaaa-aaaay-aaduq-cai), the generic ICRC-3 browser.
- **Check the revenue:** the `sneednotif_fee_forward` blocks add up to `get_fee_forwarding().forwarded_e8s` since the log started; each `ledger_block` is a block on the ICP ledger sending `amount_e8s` to `to`.
