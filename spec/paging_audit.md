# Paging and growth audit (2026-10-22)

Question: do our canister methods page, or will some start failing as data grows?

The audit was read-only: code review plus anonymous `--query` calls to mainnet (staging for pad, guardian and sneed_mon).

Limits used:
- Query reply: 3 MiB.
- Update and inter-canister reply: about 2 MiB.
- Instructions: 5B per query, 20B per update or timer message, about 300B per upgrade.

Line numbers refer to `main` at 11416b2e, plus the uncommitted `src/sneed_sms/main.mo` change.

TACO DAO uses the backend, the forum and SMS. Their existing methods must not be removed or changed in shape; only additive paged variants and internal caps or indexes are allowed.

## Summary

Two methods are **already broken on mainnet**. Both are in rll, and nothing in our current source calls either one.

Every other method still works at today's sizes. Four kinds of problem remain:
- Griefable inboxes and lists that anyone can grow for someone else.
- Page sizes with no cap, where the frontend asks for 1000 or more.
- Scans in rll that are a few times away from their limit.
- O(n²) scans in the forum, Sneedex and sneed_lock, which are fine for years at the current growth rate.

Several trading-bot getters return the **oldest** rows. That makes charts go stale long before any size limit is reached, so it is a correctness bug as well as a scaling one.

## Live sizes (2026-10-22)

| canister | size |
|---|---|
| rll | 418,921 user distribution events (about 800 a day), 520 distributions, 2,947 claims, 829 balance owners, 2,451 neurons, 458 proposals with 211,960 ballots (70,729 cast). postupgrade costs 12.25B instructions |
| forum | 34 forums, 119 topics, 136 threads, 513 posts, 2,964 post votes, 15 polls, 56 tips. Biggest thread: 47 posts / 21 KB. Busiest poster: 87 posts |
| sms | 231 messages, 50 users |
| notifications | 24 notifications, 2 users, 1 app |
| backend | 255 whitelisted tokens, 153 names (frozen), 4 donations, 16 jailbreak payment logs |
| sneed_lock | 55 active + 50 archived locks, 55 NFTs, 194 ICRC-3 blocks |
| sneedex | 67 offers (9 active), 73 bids |
| premium | about 17 active members, 45 claims, 12 ICP payments |
| sneedapp | 15 mints, 20 users, 36 wallet registrations |
| pid_names | 141 accounts, 157 names, `changes_since` full sync about 14 KB |
| mr_sneed | 52 memories, `session_brief(100)` about 44 KB |
| pad (staging) | 3 launches, `list_launches` about 222 KB (about 74 KB per launch, because logos are inline) |
| guardian (staging) | 0 ops, 0 children |

## Urgency ranking

### URGENT: broken now

| # | canister | method (file:line) | kind | what grows | now | paged alt? | callers | fix |
|---|---|---|---|---|---|---|---|---|
| U1 | rll | `get_user_distribution_events` (src/sneed_rewards/main.mo:2478) | reply size | user distribution events, about 70 B each | **29.2 MB reply, IC0504**. It broke at about 45k events; there are now 419k | yes, `get_user_distribution_events_page` (3499, capped at 2000) | no src caller; only the old dist bundle and the IDLs (mcp/sneed-hub/src/idl, src/external/rll) | Make it trap with a message that points to the paged method (or remove it, since rll is not TACO-facing). Drop it from ApiDoc and the IDLs. |
| U2 | rll | `get_user_voting_history(user)` (main.mo:3575) | instructions | every ballot of every proposal, plus `hex_text_to_blob` per ballot and a scan of all neurons | **IC0522, over 5B now** | no | no src caller (dist bundle and IDLs only) | Retire it, or back it with a neuron → votes index built at proposal import. At minimum compare hex text instead of converting each ballot (as `get_neuron_voting_history` already does). |

### SOON: within about 2–10x growth, or anyone can trigger it today

| # | canister | method (file:line) | kind | what grows | now | breaks at | paged alt? | callers | fix |
|---|---|---|---|---|---|---|---|---|---|
| S1 | rll | `get_hotkey_voting_power(neurons)` (2782) → `index_proposal_votes_between` (1842) | instructions | walks all 212k ballots and hex-decodes the 71k cast ones on every call | works today (est. 1.5–2.5B) | about 2–3x the cast ballots (several years at the current rate; sooner if turnout rises) | no | **frontend RLL.jsx:239 on every rewards page load** | Keep a cached per-neuron voting-power index. Update it incrementally when a proposal is imported, and store neuron ids as Blobs at import. |
| S2 | rll | timer `distribute_tokens_tick` → `distribute_to_local_balances` → `calc_distribution` (883/1445/1595) | instructions (timer, 20B) | the same full ballot index on every token tick, plus about 800 owners × (balance update + user event + ICRC-3 block with a Motoko SHA-256 hash) | est. 2–4B per tick | about 5–10x in ballots and owners together | n/a | daily main loop | Use the S1 cached index. Split crediting and block-writing across ticks (cursor) when owners grow. |
| S3 | sms | `get_received_messages` (src/sneed_sms/main.mo:1005), `get_all_messages` (1114), `get_sent_messages` (981) | reply size | one user's whole inbox, 0.3–20 KB per message | at most a few hundred KB | 3 MiB, about 3–6k typical or about 150 premium-size messages. **Griefable**: a premium sender (1-minute rate limit, 50 recipients) can break a victim's inbox in about 2.5 h | `get_received_messages_page` / `get_sent_messages_page` (main.mo:1106; ≤100, ≤1 MB) exist only as an **uncommitted, undeployed** local change | SMS.jsx:189-206 (fetches both full lists just for counts), Message.jsx:293,417 (fetches all to find replies), MCP reads.js:74,84; TACO | Ship the paged methods (additive). Switch SMS.jsx to page totals, Message.jsx to `get_message` plus `reply_to`, and MCP to pages. Consider retention for system messages. |
| S4 | sms | `get_all_messages_admin` (1244) | reply size + instructions | every message | 231 (about 100–250 KB) | about 3–6k messages | no | MCP IDL / old bundle only | Add `admin_get_messages_page(start, limit)`. |
| S5 | forum | `get_feed` (main.mo:1177 → lib.mo:4243) | reply size + instructions | `length` is uncapped; each item carries its body plus the parent body (about 508 B); `max_checks = length*10`; `search_text` lowercases every scanned item | length ≥1000 returns the whole forum: about 407 KB | about 4–6k live items for a large-length caller (5–7x) | paged (`start_id`), but no cap | Feed.jsx (20), Hub.jsx (10), MCP (≤50); TACO may pass anything | Clamp inside lib: `len = min(length, 100)`, `max_checks = min(len*10, 2000)`. No API change. |
| S6 | sneedex | `getOfferFeed` (src/sneedex/main.mo:4343) | reply size + instructions | `length` is uncapped and `Buffer(length)` preallocates (`length=1e9` traps on prod); every offer is sorted on each call; the `has_bids` filter (4440) is O(offers × bids) | all 67 offers: 14.8 KB | about 14k average offers, or **about 300 spam offers with 4 KB notes (about 3 ICP to grief)** | paged (`start_id`), but SneedexOffers.jsx:396 asks for 1000 | SneedexOffers.jsx, Feed.jsx, Hub.jsx, SwapWidget.jsx:1143, MCP sneedex.js | Cap at 100, size the Buffer with min(), iterate in reverse id order instead of sorting, page in SneedexOffers.jsx, keep a bid count per offer. |
| S7 | sneedex | `getPublicOffers` (4302), `getActiveOffers` (4295) | reply size | every active offer, unpaged | 2.4 KB (9) | same spam limit as S6 | `getOfferFeed` | health/checks.js:563, SneedexOffers.jsx:414 fallback | Add a cap; give the health check a count / next-expiry query. |
| S8 | trading bot | `getPortfolioSnapshots` (src/sneed_bots/sneed_trading_bot/main.mo:9123) | reply size + **returns the oldest rows** | snapshots (cap 5000, settable with no cap) × tokens | per bot, unknown (getters need a permission) | 3 MiB at about 65 tokens with limit 500; **charts go stale once there are more than 500 snapshots** | startId/fromTime, limit uncapped | TradingBot.jsx:5519 (500, inside one Promise.all, so one failure blanks the tab), :3098, :3526 | Cap the limit (200), add newest-first, page. |
| S9 | trading bot | `getDailyPortfolioSummaries` (9321), `getDailyPriceCandles` (9349), `getPursePortfolioSnapshots` (9161) | stale data + reply size; never trimmed | 1 summary a day (with tokens); pairs × days candles | per bot | frontend asks for the oldest 1000: summaries go stale after 1000 days, candles after about 100 days with 10 pairs | offset/limit, uncapped | TradingBot.jsx:5524-5576 | Newest first or a date window; cap the limit; trim or drop `closeTokens` in list replies. |
| S10 | trading bot | `evaluateCircuitBreakerRules` (1573) / `evaluatePriceCondition` PercentChange (1250) from the chore timers | instructions | scans the whole priceHistory (5000, settable with no cap) and calls `pairKey()` (2× Principal.toText) per entry | about 50–75M per condition | about 300 percent-change evaluations per message at 5000 entries; about 30 at 50k | n/a | chore timers | Compute the pair key once and compare principals; cap `priceHistoryMaxSize` (20k). |
| S11 | bots (shared) | `BotLogEngine.add` → `sync` + `trimIfNeeded` (src/sneed_bots/BotLogEngine.mo:50-66,127) | O(n) per log line → O(n²) per message | each log line copies the whole log (10k) | about 0.5M instructions per line | staking `setMaxLogEntries` (staking main.mo:1709) has no cap: at 1M entries about 400 lines hit 20B | n/a | every bot method | Real ring buffer (`var` array + head); cap `setMaxLogEntries` (≤50k). |
| S12 | guardian (staging) | `list_ops(open, limit)` (src/sneed_guardian/main.mo:726), `list_ops_for` (734); `stage_op` (338) | reply size + abuse | ops are **free for any signed-in user** to stage, and `#install` carries an arg of up to 1 MiB; `limit = 0` means "all" | 0 | **3 ops with 1 MiB args** break both lists | `limit`, uncapped; `list_ops_for` none | Guardian.jsx:75 (200), guardianIdl.js | Cap the limit (0 = default); return the arg as size + hash only (full arg via `get_op`); page `list_ops_for`; charge or cap pending ops per caller; prune old ops. Fix before prod. |
| S13 | pad (staging) | `list_launches(start, length)` (src/sneed_pad/main.mo:667), `get_launches_by_creator` (672) | reply size | each launch inlines a logo (≤200 KB) and up to 1000 allocations | 222 KB / 3 | about 40 typical launches (about 11 worst case) at the admin page's length=200 | offset, uncapped; by-creator none | SneedPadAdmin.jsx:60 (200), SneedApp.jsx:137, SneedPad.jsx:74 | Cap the length (20); return a summary view without logo or allocations, with full data via `get_launch`; page by creator using an index. Fix before prod. |
| S14 | pid_names | `my_hotkey_accounts()` (src/sneed_pid_names/main.mo:693) | reply size, **griefable** | anyone can add any principal as a hotkey of their own account (`add_hotkey` 657, nothing to accept); about 0.3–1 KB per account | about 0 | about 3–10k scripted accounts pointing at one victim break their AccountPanel | none | AccountPanel.jsx:33 via NamingService.myHotkeyAccounts | Cap hotkey accounts per principal (50) or require the hotkey to accept; add a paged variant. |
| S15 | sneed_lock | `icrc7_balance_of` (src/sneed_lock/main.mo:3033), `icrc7_tokens_of` (3038) → `nft_ids_of` (3030) → `nft_owner` | O(NFTs × locks) per account, ×100 accounts | for each NFT, a scan of all active locks or claimants | 55 × 55 | a 100-account `balance_of` at about 500 NFTs / 500 locks (5–10x); one account at about 5k × 5k | `tokens_of` has a take, but the full list is built first | NftUtils.js, CharacterPanel.jsx, wallets / indexers | Keep a lock_id → owner index (and position → claimant), and index NFTs by owner. The same index also fixes T-lock below. |

### THEORETICAL: fine for years, fix when you are next in the file

**rll**
- `get_claim_events` (2529, 197 KB, breaks at about 31–47k claims). The paged `get_claim_events_page` exists; switch health/checks.js:802 and admin/Rewards.jsx:542 to it.
- `get_all_user_balances` (2430, 98 KB, about 26k owners). Add a page; caller admin/Rewards.jsx:480.
- `get_distribution_events` / `get_token_distribution_events` (2462/2467). Paged versions exist; switch health/checks.js:179 and admin/Rewards.jsx:526.
- Pre/postupgrade copies every log into arrays (12.25B postupgrade; about 10M user events before 300B). Make the logs real stable structures.
- `get_claim_events_for_hotkey` and `get_hotkey_claimed_amounts` scan every claim. Index claims by hotkey eventually.

**forum** (all internal or additive, so TACO-safe)
- `get_recent_replies_count` (main.mo:726 → lib.mo:2513) is O(newer posts × user's posts), with `Buffer.toArray` inside the loop. It is **polled on every page by every logged-in user** (useReplyNotifications.js) and reaches 5B at about 35–40k posts, or about 20k if one poster owns half of them.
  - Fix: add per-author post and thread indexes (or a per-user reply inbox like mentions), and hoist toArray out of the loop now.
  - This is the forum item to do first after S5.
- `get_replies_to_user` (lib.mo:2701): the same O(n²), with no since filter. `get_posts_by_user` (2675) and `get_threads_by_user` (2779) do full scans and return unpaged lists with bodies (about 6–8k posts by one author).
  - Fix: the same indexes, plus additive `_page(user, before, limit≤100)` variants.
- `get_thread_votes_for_neurons` (lib.mo:1562) is O(votes × (posts + neurons)) on every thread view. `get_post_votes*` (1530/1635) and `get_poll_votes` (2199) scan every vote. Fix: per-post and per-poll vote indexes.
- `get_threads_by_topic*` and `get_posts_by_thread*` are unpaged within one topic or thread (about 5k threads or posts). The activity variants are paged but uncapped.
  - Fix: clamp `length` to 100; add `get_posts_by_thread_page`.
- `get_topic_statistics`: precompute `Principal.toText` once per call.
- `get_recent_mentions_count`: cap the walk at 1000 and return "999+".
- The tip lists are unpaged (about 10k per user). `get_tip_stats` scans every tip.

**sms / notifications / mon / backend**
- sms: postupgrade `mark_legacy_removed_senders` walks every message on each upgrade; make it one-shot.
- notifications:
  - `tickBody` (every 30 s) and `relay_pull` scan all of `pending`; use a due-queue per kind.
  - `feeTick` sums every balance; keep running totals.
  - `prune` walks all notifications and dedupes; stop at the first non-old entry.
  - `record` uses Array.append (bounded at about 600 per user per app).
- sneed_mon: `get_targets` (about 1.8 MB at 50 targets × 100 open proposals) and the `get_status` backlog scan.
- backend:
  - Pre/postupgrade copies about 30 HashMaps on every upgrade, even under EOP.
  - `get_jailbreak_payment_logs` has an uncapped `limit`; cap it at 100.
  - `get_ban_log` / `get_banned_users` are unpaged.
  - Per-user registries (`register_*`, `mark_logs_seen`) have no per-user caps. This is self-DoS plus a memory-abuse vector; add premium-tiered caps.
  - `get_donation_totals` is O(n²); keep running totals.

**sneedex / premium**
- sneedex:
  - `getPrivateOffersFor`, `getOffersByCreator` and `getBidsByBidder*` are unpaged full scans. `canSeeNoteToBuyer` → `findWinningBid` filters every bid for each offer.
  - `debugGetAllOffers` should be deleted or paged.
  - Every write copies whole `offers` / `bids` arrays: O(n) per write, O(n²) in total. Move to maps.
  - The payment-log pagers use Array.append in a loop.
- premium:
  - `getActivePremiumMembers` (451) is **loaded on every page** by PremiumContext.jsx and breaks at about 100k members. Page it, or have clients call `checkMembership` per principal shown.
  - `checkMembership` is a linear assoc-array scan on the hot inter-canister path (src/PremiumClient.mo). Move it to a Map.
  - `getAllMemberships` and the promo lists are admin-only and unpaged.

**sneed_lock** (T-lock)
- `get_lock_states`, `get_lock_by_id` and related getters scan all active locks per id, and sneedex AssetHandlers.mo calls them inter-canister.
- `get_lock_states_page` builds and sorts every LockState before taking ≤500.
- The payment log uses Array.append per payment and in the admin pager.
- Pre/postupgrade copies.
- The S15 owner index fixes most of these.

**sneedapp**
- `getMergedLog` (src/sneedapp/main.mo:4287) does page × whole financialLog.
- `getAllWallets` / `getAllRegistrations` are unpaged (about 25k entries), and any caller can add entries.
- Logs are copied on every mint.

**bots**
- `getTradeLog` (9023): DuplicateCleanupDialog.jsx:72 asks for **limit 100000**. Cap it at 500 and page.
- `getPriceHistory` (9287) gets limit 5000 from the frontend (about 1.15 MB). Cap it.
- `getLogs` (BotLogEngine.mo:185): the activity "load more" in TradingBot.jsx keeps raising the limit. Cap it at 500.
- `updateDailyPriceCandle` maps over all candles per quote; use a Map.
- `processDeliveryBatch` in BotEventEngine does O(n²) dequeues.
- Each append copies the whole log (trade log, snapshots, price ring).

**naming / mr_sneed / proxy**
- `changes_since` (pid_names main.mo:558) is paged at 500 but has no byte budget. A large `max_members` (settable up to 1000) could exceed the limit; add a byte budget or cap `max_members` at 100.
- The `sneed_names_mirror_v1` frontend mirror is in localStorage (about 5 MB, roughly 30k names). Once full, `save` fails silently and every load re-syncs from 0. Move it to IndexedDB.
- `NameIndex.page` should cap `limit` itself; all current callers already do.
- avatars: `max_held_premium` has no upper bound. profiles: the `list_dapps` hidden-skip walk has no step cap.
- mr_sneed:
  - `search_memories` (590) scans up to `SCAN_MAX` 20k memories at about 250k instructions each, which is about 5B. Lower the cap and return a cursor.
  - `session_brief`'s 2.5 MB budget ignores links, tags and path, and `max_pinned` has no cap. Count the full view and cap pins at 200.
  - The `by_tag` / `by_member` appends are O(n²).
- proxy (not deployed): the DAO-only lists have no cap. Fine.

**icrc3 library** (all canisters)
- Safe: `getBlocks` and the archive are capped at 1000 blocks / 1.5 MB, and spill is bounded.
- Minor issues:
  - `spill` batches by count only, with no byte cap on `append_blocks`; cut batches at about 1.5 MB.
  - A query with very many ranges grows the archived sub-ranges; cap `args.size()` at 100.
  - If spilling stalls (no cycles to create an archive), the live store grows in heap.

## Correctness bugs found along the way (not limits)

1. **Trading bot daily summaries get corrupted once the snapshot log is full** (trading main.mo:2897-2903). Each new snapshot re-applies the trimmed oldest snapshot to its day: `snapshotCount` is counted twice and the close is overwritten with a stale value.
2. **Trading bot Performance charts go stale.** Snapshots, daily summaries, candles and purse snapshots all return the oldest `limit` rows (see S8/S9).
3. Sneedex `getOfferFeed` with a huge `length` traps on preallocation (confirmed on prod).

## Safe by design (checked)

These were checked and are bounded:
- The ICRC-3 endpoints everywhere.
- The naming service: `get_names`, `search` (50 results / 2000 steps), `list_*` (500), the nickname pages, and avatars `get_images` (20).
- Notifications history (≤200), receipts and requests.
- rll per-owner event lists (≤ about 520), its `*_page` methods and import ticks.
- The sneed_lock log pagers and `get_stranded`.
- The forum's keyed getters and `get_mentions_of_user`.
- sneedapp catalogue getters and `getRecentCreations`.
- The bot event and reaction logs (fixed at 500) and the circuit-breaker log (1000).
- The backend `get_whitelisted_tokens` (9.6 KB).
- The frozen backend name maps.

## Recommended order

1. **rll U1/U2**: trap with a pointer to the paged method (or remove), and clean the IDLs. One small proposal.
2. **SMS S3/S4**: commit and ship the paged inbox methods (additive, TACO-safe), then switch SMS.jsx, Message.jsx and MCP reads.js to them.
3. **rll S1/S2**: an incremental, cached vote index. It drives the rewards page and the daily distribution, and both are a few times from the limit. Ship it in the same rll proposal as step 1 if possible.
4. **Uncapped page sizes**, one-line clamps with no API change: forum `get_feed` (S5) and the activity lists, sneedex `getOfferFeed` (S6) plus paging in SneedexOffers.jsx, and the bot getters (S8/S9/getTradeLog/getLogs/getPriceHistory), with newest-first where needed.
5. **Abuse vectors**: pid_names hotkey-account cap (S14), plus guardian (S12) and pad (S13) before they go to prod.
6. **Indexes for O(n²) scans**: the forum per-author index (`get_recent_replies_count`, polled on every page), sneed_lock owner index (S15), sneedex maps, premium Map, bot ring buffers (S11).
7. The rest, when next touching each canister.
