# sneed_mon: Sneed Hub's watcher (draft)

Sneed Hub shows a notification bar in the header (votable proposals, low cycles, rewards to
claim), computed in the browser (`src/app_sneeddao_frontend/src/hooks/useVotableProposalsNotifications.js`
with `utils/VotableProposalsUtils.js`, `useLowCyclesNotification.js`, `useRewardsCache.js`). Users
want the same alerts on their phone or Discord when the browser is closed. Delivery exists already
(Sneed Notifications, `spec/sneed_notifications.md`); what's missing is something on-chain that
watches and decides when to send. That is sneed_mon: a DAO-owned canister registered with Sneed
Notifications as the app "Sneed Hub".

Status (2026-10-21): step 1 (topic `proposals`) is built and tested on PocketIC
(`test/canisters/tests/sneed-mon.test.js`), not deployed. API: `src/app_sneeddao_frontend/public/api-docs/sneed_mon.md`.

## 1. Step 1: proposals

- **Opt in per SNS.** `watch_sns(root)` / `unwatch_sns(root)` / `get_my_watches()`. The anonymous
  principal is refused. The root must be listed by SNS-W (the governance canister comes from there,
  so a made-up "root" can't point sneed_mon at a canister of the caller's choosing). The SNS name
  comes from governance `get_metadata`. `watch_sns` also calls `request_permission` on Sneed
  Notifications so the user finds "Sneed Hub" waiting in the notification centre.
- **State:** user → SNS roots; root → { governance, name, sorted watchers, open proposals with
  their two pass states, highest proposal id seen, last error }. Nothing about neurons or votes is
  kept between rounds except a transient neuron cache.
- **Caps:** 10 SNSes per user, 1,000 users, 100 SNSes (all in the config).
- **Rounds** (timer, every 10 minutes): per SNS one `list_proposals` (reward status ACCEPT_VOTES only, newest
  first, up to 3 pages of 50); open = now < deadline (wait-for-quiet deadline, or creation +
  initial voting period), as `isProposalAcceptingVotes` does in the frontend.
- **Passes:** per open proposal a "new" pass once, and a "reminder" pass once its deadline is
  within 24 h. A pass fetches the ballots with `get_proposal` (because `list_proposals` returns only
  the caller's own ballots) and walks the watchers: `list_neurons { of_principal = user }` (paged,
  at most 3 × 100, cached for an hour), keeps neurons where the user holds permission 4 (vote),
  and counts those whose ballot has `vote = 0`. Neurons without a ballot can't vote on the
  proposal and don't count. This mirrors `hasEligibleNeurons` in `VotableProposalsUtils.js` (which
  instead skips neurons with no voting power).
- **Messages:** through `notify_batch` (50 per call), topic `proposals`, level `normal`, link
  `https://app.sneeddao.com/proposal?proposalid=<id>&sns=<root>` (the frontend route), dedupe keys
  `prop:<root>:<id>` and `propdl:<root>:<id>`. A proposal first seen inside the 24 h window gets
  the "new" message only (it says when voting closes).
- **Once only:** the pass cursor (the last watcher done, in sorted order) is stable state and
  moves only after the batch holding that watcher was accepted. Sneed Notifications' dedupe
  window (1 h) is a second guard, not the main one.
- **Errors:** `not_allowed`, `rate_limited`, `no_funds`, `invalid` → that user is skipped for that
  message, no retry. A failed `notify_batch` call or `not_registered` / `unknown_topic` → nothing is
  marked done, no further passes that round, retried next round. A failing `get_proposal` is given
  up after 3 tries; a failing `list_neurons` stops the pass until the next round.
- **Bounded work:** at most 200 calls a tick; a round goes on in up to 10 follow-up ticks, then
  waits for the next round; cursors keep the place across ticks and upgrades.
- **Admin:** controllers plus an admin list (as in sneed_notifications); `admin_set_config`,
  `admin_set_notifications_canister`, `admin_register_with_notifications` (register_app with this
  canister and the topic list), `admin_set_app_id`, `admin_pause` / `admin_resume`,
  `admin_set_interval`, `admin_run_now`; `get_status`, `get_snses` (counts only, never who watches).
- **Conventions:** ingress guard (`system func inspect`: queries refused as updates, admin methods
  only from admins, 4 KB argument cap); `get_api_doc`; enhanced orthogonal persistence like
  sneed_notifications (so upgrade proposals must set `wasm_memory_persistence = keep`); no ICRC-85.

## 2. Cost

Assumptions for a rough estimate (13-node subnet: about 0.26 B cycles per inter-canister call plus
about 1,000 cycles per byte sent or received; 1 T cycles ≈ $1.35):

- **Listing, every round:** one `list_proposals` per SNS, filtered to reward status ACCEPT_VOTES
  (`include_reward_status = [1]`), so only open proposals come back (a few KB each, payload
  rendering included). 100 SNSes × 144 rounds a day × (0.26 B + ~10 KB × 1,000) ≈ 0.2 T cycles a
  day. This dominates when nothing happens.
- **Per proposal:** 2 `get_proposal` calls with every ballot (about 90 bytes per neuron: ~0.45 B
  cycles for an SNS of 5,000 neurons) plus, per watcher, up to 2 `list_neurons` calls (fewer with
  the one-hour cache; ~0.3 B cycles each for a user with a few neurons) and a share of a
  `notify_batch` (50 messages ≈ 0.3 B). 1,000 watchers on one proposal ≈ 0.7 T cycles; 10 users ≈ 7 B.
- Instructions per tick are small (decoding the ballots of a big SNS once, then map lookups).

**Q**: measure on staging (`get_status().calls_total` and the cycle balance across a few days).
The levers are the interval, the caps, and `neuron_cache_s`.

## 3. Who pays

`sponsored = false` by default: Sneed Notifications charges paid deliveries (push, Discord) to the
user's balance, Sneed SMS is free, as for the forum's messages. **Q**: should the DAO sponsor
reminders (fund the app with `top_up_app` and set `sponsored = true`)? sneed_mon itself pays only
cycles.

## 4. Questions

1. **One app or two?** The forum is already registered as "Sneed Hub". Either sneed_mon is added
   to that app (an admin of Sneed Notifications: `update_app` with this canister and the
   `proposals` topic, then `admin_set_app_id` here), or it registers its own app with
   `admin_register_with_notifications`, and users see two "Sneed Hub" apps. The first is cleaner;
   note the daily cap (20 by default) is per app, so forum messages and proposal messages share it.
2. **Reminder level:** `normal` for both messages. A deadline is the spec's example of `urgent`;
   a second topic (`proposal_deadlines`, urgent) would let users route reminders separately.
3. **Watch by default?** Today users opt in per SNS. Sneed Hub could offer "watch all SNSes where
   I have neurons" (the frontend knows them) as one click.
4. **NNS proposals:** not in step 1 (NNS `list_proposals` returns ballots differently and neurons
   are found by hotkey).

## 5. Later topics (not built)

The watch list carries a topic (`MonTopic`, today only `#proposals`) so later steps add tags:
- `#cycles`: low cycles for canisters the user watches (as `useLowCyclesNotification.js`), probably
  via the blackhole or the canister's own status method.
- `#rewards`: unclaimed RLL rewards (as `useRewardsCache.js`).
Each would get its own watch map and pass, and a topic in the registration.
