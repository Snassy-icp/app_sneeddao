# Support audit: can we always find out what happened, and fix it?

Read-only audit, 2026-10-21, of the working tree at 94101f93 plus uncommitted bot-cycles and sneed_mon changes. Mainnet facts come from `--query` calls made as mr_sneed.

**The standard.** For every user request we can find out exactly what happened and fix it when possible. Where funds cannot be recovered by design, we can explain precisely why. Recovery only ever goes to the rightful owner, and we never sweep other users' funds.

**How to read it.** Line numbers are `main.mo:N` of the canister being discussed unless stated otherwise. Severity:
- **C**: funds stuck, or their fate unknown.
- **H**: high.
- **M**: medium.
- **L**: low.

---

## 0. Summary: top critical and high gaps

| # | Sev | Canister | Gap |
|---|---|---|---|
| 1 | C | sneedex | `cacheAssetStakes` (main.mo:1524-1640) writes back `state = offer.state` read *before* its governance and bot awaits (line 1637). It runs 1 s after activation. A buyout, accept or cancel inside that window is reverted to `#Active`:<br>• the winning bid stays `#Won`;<br>• auto-deliver and auto-pay both no-op;<br>• `refundBid` and `withdrawBidEscrow` refuse a Won bid, so the buyer's tokens are stuck;<br>• a second buyer can buy the same assets.<br>Untested. Not observed on prod (no Won bids today). |
| 2 | C | sneedex | `adminReclaimStuckTokens` (main.mo:5138) has no offer-state guard. Used on an Active or Completed offer, it returns escrow to the seller while the buyer's bid also pays the seller: a wrong-party payout. |
| 3 | C | sneedapp | Paid mint, step 5 `handOver` fails: the canister is recorded as an orphan (`sneedapp_orphan_canister`). **No method hands it over or deletes it** without a factory upgrade. The user has paid and gets `#Err`. |
| 4 | C | frontend | CMC cycle top-ups (7 copies: Wallet.jsx:2659/2777, TopUpCyclesDialog.jsx:385, Canister.jsx:890, IcpNeuronManager.jsx:1166, BotManagementPanel.jsx:1306, CreateIcpNeuronWizard.jsx:293).<br>• The block index is discarded, so ICP sits at the CMC unnotified when `notify_top_up` fails or the tab closes.<br>• "Try again" sends a *second* transfer.<br>• No UI accepts a block index to re-notify.<br>• SneedAppMint.jsx:256-276 never checks the notify result. |
| 5 | C | sneed_lock | A lock-ownership transfer with an ambiguous ledger outcome keeps the lock on *both* parties. ICRC-3 records `outcome="uncertain"` (main.mo:1272), but there is no reconcile method. `change_lock` returns `#InProgress` while two records exist (main.mo:2017), so a dissolve-delay lock (expiry = NEVER) can never start dissolving. |
| 6 | H | sneedapp | Step 6 `topUpSelfWithCycles` (main.mo:3304, also 2195) runs after hand-over with no try/catch. If the CMC rejects, the user owns a paid canister but sees an error, and the mint log, wallet entry, `sneedapp_mint` block and financial log are all skipped. Ledger throws at steps 2 and 4 skip the refund; step 4 also leaves an unrecorded factory-controlled canister. |
| 7 | H | sneedex | `escrowCanister`, `escrowSNSNeuron` and `escrowICRC1Tokens` write back the offer read before their await (main.mo:2632, 2757, 2838). A concurrent escrow loses another asset's `escrowed` flag, and a cancel is reverted. A canister or neuron under sneedex with `escrowed=false` has no way back. `AssetHandlers.escrowNeuron` (191-262) can leave a neuron partly stripped. |
| 8 | H | sneedex | ICRC-1 or ICRC-7 tokens sent to an offer escrow but never marked escrowed (too little sent, user quit) are not returned on cancel or expiry. Only EXT is (main.mo:1251-1265). |
| 9 | H | sneedex | One-shot settlement timers (auto refund, deliver, pay) are lost on upgrade. `claimAssets`, `claimWinningBid`, `reclaimAssets` and `refundBid` are caller-gated, so support cannot push a stuck payout to its rightful owner. There is no error log, and failures are swallowed (~977, 1345, 1573, 1590). |
| 10 | H | rll | `claim_hotkey_balance` reaches only owners derived from the caller's live neurons (main.mo:1387). An owner whose neurons are gone can never claim their `balance_of`, so those rewards are stranded. `clear_balances` and `clear_all_balances_and_distributions` (2108/2154) let an admin wipe owners' balances, which the next cycle redistributes. That is a sweep. |
| 11 | H | backend | `save_jailbreak_config` (main.mo:3247) can double-charge 1–5 ICP. The duplicate check (3257) runs before its awaits, `created_at_time = null` (3317), and there is no refund method. |
| 12 | H | sneed_notifications | `pull` (main.mo:725-736): a ledger timeout returns "The ledger did not answer", but the ICP may have moved and the user is never credited. The block is discarded, and there is no admin credit method. |
| 13 | H | sneed_lock | No refund of the ICP payment subaccount. A position sent before `claim_position` can never be claimed. `token0`/`token1` are not validated. Add-liquidity strandings are recorded only as free text in the 10k ring `error_log`, and the pool quiescent balance re-baselines them away after an upgrade. |
| 14 | H | trading bot | `enabledDexes` defaults to `[0,1]`, which includes Kong. Kong is gone, but its canister is still installed. A swap that fails after transferring to Kong cannot be recovered. |
| 15 | H | cross-cutting | **Support is blind by principal.** There is no ICRC-3 index by principal or ledger block anywhere, and these canisters are *empty or partial* on prod:<br>• sneedex, sneedapp, premium and forum: `log_length 0` / no history import.<br>• Payment logs are admin-only with no principal filter.<br>• sneed_lock logs are update-only, so `--query` cannot read them.<br>mr_sneed is **not admin** on sneed_lock, sneedex or rll. |
| 16 | H | cross-cutting | **No cycles monitoring** of Sneed's own canisters. sneed_mon watches proposals only; its `#cycles` topic exists only in the spec (spec/sneed_mon.md:224). The frontend health page covers naming, premium and rll pings, but not mr_sneed. Most canisters expose no cycles query. |

---

## 1. Facts support needs

### 1.1 Persistence and admins

**Persistence.** It comes from dfx.json, not from the `persistent actor` keyword:
- **EOP** (upgrades need `wasm_memory_persistence = 1`, KEEP): backend, forum, sms, the six naming canisters, notifications, sneed_mon, mr_sneed, sneed_proxy.
- **Classic** (stable-var serialisation): sneed_lock, sneedex, sneedapp, both bots, premium, rll, pad, guardian.

Some sub-reports said "EOP" for sneedapp, the bots, premium and rll. dfx.json shows them as classic.

| Canister | Admin check | mr_sneed (tksci-…) admin? |
|---|---|---|
| sneed_lock | controller, `fi3zi` governance, `get_admin_list` (n4lvd, seabo, d7zib) | **no** |
| sneedex | controller + `getConfig().admins` (seabo, n4lvd) | **no** |
| sneedapp | `getAdmins` | yes (`getOrphanCanisters` works) |
| premium | admins (seabo, n4lvd, tksci) + controllers | yes |
| rll | `list_admins` (governance, d7zib, seabo) | **no** (`list_claim_incidents` traps) |
| backend | `get_admins` (n4lvd, tksci, seabo, d7zib) | yes |
| forum | governance, controllers, 3 listed | (check `get_admins`) |
| sms | fi3zi, n4lvd, seabo, tksci | yes |
| notifications | controllers, d7zib, tksci | yes |
| naming ×6 | d7zib, seabo, tksci, n4lvd | yes |
| sneed_mon (staging only) | controllers, `admins` (empty) | controller-only |

Becoming admin on lock, sneedex or rll would grow mr_sneed's powers, which needs a decision by the user or a proposal (see the memory note on admin rights). The fix list below prefers **public, principal-filtered read queries**, so support needs no admin rights to look things up.

### 1.2 Where a user's funds sit (subaccount derivations)

`S(p)` is `[len(p)] ++ bytes(p)`, zero-padded to 32 bytes.

| Canister | Account | Derivation | Public query |
|---|---|---|---|
| sneed_lock | user wallet | `S(p)` (main.mo:1950) | — |
| sneed_lock | ICP fee payment | `S(p)` with byte 23 = `0x50` (main.mo:3424). **Collides with the wallet when p's byte 22 is already 0x50 (~1/256).** | `getPaymentSubaccount(p)` |
| sneed_lock | lock gas tank | `FE 47 41 53` + zeros + lock id (BE) in bytes 24..31 (main.mo:192) | `get_lock_gas(id)` |
| sneedex | creation fee | `S(p)`, byte 23 = `0x50` (Utils.mo:29-115) | `getOfferCreationPaymentSubaccount(p)` |
| sneedex | offer escrow | `S(creator)`, byte 23 = `0x4F`, bytes 24..31 = offerId | `getOfferEscrowSubaccount`, `getOfferEscrowAccountId` |
| sneedex | bid escrow | `S(bidder)`, byte 23 = `0x42`, bytes 24..31 = bidId | `getBidEscrowSubaccount` |
| sneedapp | payment | `S(p)` (main.mo:1681) | `getPaymentSubaccount(p)` |
| premium | deposit | `S(p)` (Utils.mo:22) | `getDepositAccount(p)` |
| backend | jailbreak payment | see backend-admin.test.js:25 | `get_jailbreak_payment_subaccount()` (caller) |
| sneed_mon | deposit | per user | `deposit_account` |
| guardian | op fee | per op | `get_op_payment(op)` |
| CMC | top-up | `{CMC, S(target canister)}`, memo `TPUP` | — |
| ICPSwap pool | user deposit | `{pool, S(p)}` (frontend services/dex/types.js:156) | pool `getUserUnusedBalance(p)` |
| NNS (staking bot) | neuron stake | governance subaccount(bot, memo = `Time.now()` ns); icrc1 memo is the 8-byte BE memo | bot `getStakeAccount(memo)` |
| SNS | neuron stake | `SHA256(0x0c,"neuron-stake",p,nonce_be)`, nonce 0..99 (TokenCard.jsx:781) | — |

---

## 2. Per-canister findings

### 2.1 sneed_lock (`pqsms-…`)

Classic persistence. Locks are copied through pre/postupgrade (main.mo:4537/4636). The following are stable:
- `error_log` and `info_log` (main.mo:112-113), 10k rings each;
- the claim history (1000 completed and 1000 failed);
- `payment_log`;
- ICRC-3 (182 blocks, history imported).

Mutexes and `pool_quiescent_balances` are transient. Nothing watches the canister's cycles.

**Flows.** "Record" lists what exists afterwards; "Recovery" lists the methods that can repair it.

**1. Token lock** (`create_lock`, main.mo:1360)
- Failure modes:
  - No `token_op` mutex, and no re-check after awaiting `verifyLockFeeIcp`. A concurrent `transfer_tokens` can leave an **unbacked lock** (M).
  - If the fee charge fails after the lock exists, the lock is free, and this is logged only in `error_log`.
- Record: ICRC-3 `sneedlock_token_lock_create` and `sneedlock_fee_pay`.
- Recovery: if the create fails, the tokens stay in the user's wallet and `transfer_tokens` returns them.

**2. ICP lock fee**
- Failure modes:
  - An overpayment or an abandoned lock leaves ICP in the payment subaccount **forever** (H).
  - The subaccount collision above (M).
- Record: `admin_get_payment_log` (admin, no filter).
- Recovery: **none**.

**3. Withdraw unlocked tokens** (`transfer_tokens`, main.mo:784)
- Failure mode: `created_at_time=null`, so a retry can double-send (L, the user's own funds).
- Record: ICRC-3 `sneedlock_token_withdraw` (ledger_tx).
- Recovery: none needed.

**4. Lock ownership transfer** (main.mo:1119 `token_lock_move`)
- Failure mode: an ambiguous outcome locks both parties (**C**, #5 above).
- Record: `sneedlock_token_lock_transfer` (outcome).
- Recovery: **none**.

**5. Gas tank withdraw** (`withdraw_lock_gas`, main.mo:2603)
- Record: `sneedlock_gas_withdraw`.
- Recovery: tested (sneed-lock-token-nft).

**6. Position lock** (`claim_position` main.mo:750, then transfer, then `create_position_lock` main.mo:1491)
- Failure modes:
  - A position transferred before `claim_position` is unclaimable (H).
  - `token0`/`token1` are not validated (H).
  - Duplicate lock or fee under races (M).
- Record: ICRC-3 `position_claim`, `position_lock_create`.
- Recovery: none for an unclaimed position (the API doc says "DAO proposal").

**7. Withdraw position** (`transfer_position`, main.mo:863)
- Failure mode: an unknown outcome leaves a stale claim.
- Record: `sneedlock_position_withdraw`.
- Recovery: the new owner's claim clears stale claims (sneed-lock-stale-claim.test.js).

**8. Fee claim** (`request_claim_and_withdraw`, main.mo:4009)
- Failure modes:
  - An unknown outcome is recorded as `#Failed` although the pool may still deliver (M).
  - Dust at or below the fee stays in the pool account.
- Record: `completed_claim_requests` and `failed_claim_requests` (public pages, **no owner filter**); `get_my_claim_history` is caller-only.
- Recovery: check the ledger.

**9. Add liquidity** (main.mo:4261)
- Failure mode: funds stranded in the pool account or deposit subaccount (H).
- Record: "ADMIN ACTION" text in `error_log` only; **no ICRC-3 block**.
- Recovery: `admin_pool_deposit` and `admin_withdraw_pool_balance_to_user`. Both pay only the named user's wallet, but the amount is unchecked, and they are **untested**.

**10. Dissolve/extend** (`start_dissolving` etc.)
- Synchronous, with ICRC-3 blocks and tests.

**Admin money methods**
- `admin_return_token(ledger, amt, user)` (3334): user wallet → user. It **ignores locks**. Untested.
- `admin_return_token_from_failed_request` (3371): main account → **any principal, any amount**. Untested.
- `admin_rescue_stuck_tokens(ledger, any)` (4371): sweeps the **entire** main account to anyone, mixing all users' misdirected deposits.

**Lookup**
- Public, by principal: `get_lock_states_page({owner=?P, include_archived=true})`, `get_claimed_positions_for_principal`, `icrc7_tokens_of`.
- `get_error_entries` and `get_info_entries` are public **update** methods: the ingress guard refuses `--query`, and there is no principal filter.

### 2.2 sneedex (`7bvk3-…`)

Classic persistence. Live state:
- 67 offers: 9 Active, 1 Draft, 1 PendingEscrow.
- 73 bids. All 17 unconfirmed bid escrows hold 0.
- ICRC-3 log length 0, and there will be no import (spec/sneedex_icrc3.md:175).
- The **default account holds 0.36652460 ICP**, with no code path that uses it. It is probably a misplaced deposit; find the sender in the ICP index.
- Active offers 18 and 19 (creator `5mvpt-…`) list ICRC-1 ledgers that no longer have a wasm (offer 5 likewise). They can never reach Claimed or Reclaimed.

**Flows**

**1. Offer creation fee** (`createOffer`, 2081)
- Failure modes: if premium rejects after the fee is paid, the fee stays with no offer (L); the fee log's `offer_id` can be wrong under concurrency (L).
- Record: `creationFeePaymentLog` (admin) and ICRC-3 `sneedex_creation_fee_pay`.
- Recovery: `withdrawOfferCreationPayment` (caller).

**2. Escrow** (canister 2548, neuron 2667, ICRC-1 2774, EXT, NFT, SneedLock)
- Failure modes:
  - Stale writes at 2632/2757/2838 (H).
  - A neuron left partly stripped (H).
  - Unescrowed ICRC-1 or ICRC-7 is not returned on cancel (H).
- Record: offer state.
- Recovery: `reclaimAssets` covers escrowed assets only. `adminReturnMisplacedNft` covers the default account only (tested in sneedex-admin:390). `adminReturnMisplacedExtNft` is tested in sneedex-ext:273.

**3. Bid** (`reserveBid`, deposit, `confirmBid` 3155)
- Failure modes:
  - Excess is refunded best-effort.
  - The race is handled (tested in sneedex-core "two buyers racing").
  - Residue arriving after Refunded or ClaimedBySeller is stuck (M).
- Record: bid state. `getBidsByBidder` **hides unconfirmed reservations** (4392) (M).
- Recovery: `withdrawBidEscrow` (3901) and `refundBid` (bidder only).

**4. Settlement** (`completeOfferInternal` 3426, then timers at 1/2/3 s)
- Failure modes: timers are lost on upgrade, and the payout methods are caller-gated (H).
- Record: no error log, and no query for `settlementDelivered`.
- Recovery: the parties call `claimAssets`, `claimWinningBid` and `reclaimAssets`. Tested in sneedex-settlement.test.js.

**5. Stake caching** (1524-1640)
- Failure mode: state reverted (**C**).

**6. Expiration** (`processExpiration` 3548, worker 1673)
- Failure mode: `ignore await completeOfferInternal` has no try/catch. A reject leaves `expirationWorkerRunning=true` forever (M).
- Recovery: only an upgrade (tested in sneedex-core:1017).

**Lookup**
- Public: `getOffersByCreator`, `getBidsByBidder`, `queryOffer`, `queryBid`, `debugGetAllOffers`.
- `getBidEscrowBalance` is an update call; query the ledger directly instead.
- Admin-only, no principal filter: `getCreationFeePaymentLog`, `getCutPaymentLog`.

### 2.3 sneedapp factory (`sfamc-…`) and bots

**sneedapp state (2026-10-21):**
- 20.9T cycles.
- `getMintLogCount` = 15.
- `getOrphanCanisters` = `[]`.
- Fee 5 ICP, sent to `6jvpj-…` subaccount `01…06`.
- `icrc3_log_status` length 0, so the 15 older mints are only in `getMintLog`.

**Paid mint** (`mintCanister` 3063, legacy `createNeuronManager` 2030). The user deposits to `getPaymentSubaccount`, which is guarded by a per-caller payment lock.

| Step | Failure | Outcome | Sev |
|---|---|---|---|
| Deposit | too little / wrong principal | `#InsufficientPayment`; `withdrawUserPayment` (1745) works (tested: sneedapp-mint.test.js:278/295) | — |
| Deposit | wrong token | **No method withdraws it** (ICP only) | M |
| Deposit | to the factory's main account | `adminWithdrawIcp(amount, to)` (3911), with `to` unchecked | M |
| 1. cycles ICP → main account | Err/throw | clean | — |
| 2. publisher share (3214) | `#Err` | refunded (`sneedapp_mint_refund`) | — |
| 2. | **throw** | step 1 ICP stays in the main account; no log | H |
| 3. create/install | fails | discarded, refunded | — |
| 4. DAO cut (3251) | **throw** | a factory-controlled canister is left unrecorded; steps 1–2 are not refunded | H |
| 5. hand-over (1996) | fails | recorded as an orphan; **no settle method** | **C** |
| 6. top-up (1857/3304) | CMC rejects | after hand-over, and **no record of the mint at all** | H |
| 6. | notify `#Err` | ICP at the CMC; block index not logged | L |

**Staking bot** (user-owned; the minter is the sole controller; botkeys):
- `stakeNeuron` (704): if the claim *throws*, the memo is neither logged nor returned. It can be recovered from the bot's ICP transfer memo, then `claimNeuronFromDeposit(memo)` (tested in staking-bot.test.js:309) (M).
- The frontend keeps the memo only in JS memory (CreateIcpNeuronWizard.jsx:333-370) (H on the frontend side).
- Logs (`getLogs`, `getEventLog`) are stable, 10k entries, and **need a ViewLogs botkey**, so support sees nothing unless the user grants one.
- `BotLogEngine.sync()` costs O(n) per write.

**Trading bot:**
- ICPSwap failure after deposit: `recoverPoolFunds(t0,t1)` (8211) pays only the bot itself and is idempotent (tested in trading-bot.test.js:629). The trade log lacks the pool id (M).
- Kong is enabled by default and unrecoverable (H, see #14).
- A two-leg route whose leg 2 fails leaves the intermediate token in the bot (logged).

**Out of cycles:** the bot is frozen, then uninstalled. Its principal keeps the neurons and funds, and the controller can reinstall. Logs and botkeys are lost.

**Uncommitted:** `getCyclesBalance` / `wallet_balance128` (BotCycles.mo) and frontend display. Prod bots don't have them yet.

### 2.4 sneed_premium (`7gump-…`)

State: 12 ICP payments (26.4 ICP), 27 VP claims, 6 promo claims. ICRC-3 length 0, not imported.

| Flow | Failure modes | Record | Recovery |
|---|---|---|---|
| `purchaseWithIcp` (477/536-639) | Deposit ≠ an exact tier price (or the special price expired), giving `#InvalidTier`, **not logged**. Ledger `#Err`: deposit kept (tested). A trap after the transfer (565→587) would leave the ICP paid with no membership (theoretical). | `getIcpPaymentLog` (admin, has `icpTransactionId`, no filter); ICRC-3 `premium_icp_purchase` | `withdrawDeposit` (490, caller, tested); **the frontend never calls it** |
| `claimWithVotingPower` (642) | `list_neurons` capped at 100 | `getClaimLog` (admin) | admin `setMembershipAdmin`/`extend`/`revoke` (ICRC-3) |
| `claimPromoCode` (777) | case-sensitive (L) | `getPromoCodeClaims` (admin) | — |

**Stuck by design (needs code):** ICP in the default account, and non-ICP tokens in a deposit subaccount.

**PremiumClient caching:** positive results stay cached until expiry, so a revocation is not seen elsewhere until then. Callers without try/catch fail closed (sneedex:875/2197, lock:3618, sneedapp:2093, backend:460), and all of them check before funds move.

### 2.5 rll (`lvc4n-…`)

State:
- 2,943 claim events: 202 Failed (all InsufficientFunds), 0 unmatched Pending.
- 828 balance owners.
- ICRC-3 has 1,660 of 2,000 live blocks, so it is near its first archive spill (1.5T cycles).
- Postupgrade costs 12.25B instructions and grows.

**Claim** (`claim_full_balance_of_hotkey` 443, then 1161-1290): debit the owners, log Pending, put the amount in flight, then transfer with memo `rll-claim:<seq>`.
- `#Err` re-credits the owners.
- A throw with an unknown outcome creates an **incident**. `resolve_claim_incident(id, landed)` (1304, admin) re-credits exactly the recorded owners. Tested in rll.test.js.

**Gaps:**
- H: stranded owners (1387).
- H: the `clear_*` sweeps (2108/2154).
- M: any principal listed on a neuron can claim the owner's balance.
- M: `get_neuron_owner` (1907) falls back to the last principal.
- M: a continuation trap after `#Err` leaves the owners debited with no incident.
- M: tokens sent to rll's default account are shared out to voters within 24 h. A non-whitelisted token sits there forever (explain to users).
- M: `get_user_distribution_events()` returns all 418k events and exceeds query limits.

**Lookup (public):** `balance_of`, `get_user_specific_distribution_events`, `get_claim_events_for_hotkey`, `get_hotkey_claimed_amounts`, ICRC-3. Claim events record the hotkey but not the owners; the owners appear only in the `rll_claim` block.

### 2.6 app_sneeddao_backend (`g7s5u-…`)

**Jailbreak payment:** see #11. `JailbreakPaymentLog` has no block index (`#Ok(_)` discarded at 3321). `get_jailbreak_payment_logs` is admin-only with no principal filter. Admins cannot read another user's configs. `withdraw_jailbreak_payment` (3684) is safe but untested. Nothing can move funds out of the backend's default account (the fallback fee recipient, 3305).

**Donations:** ledger-verified and deduplicated, with the block stored (donations.test.js). No lookup by donor or by block.

**Moderation:** bans are logged (`get_user_ban_history`). The following are **not logged**:
- `admin_clear_avatar`
- blacklist edits
- admin changes
- fee settings
- `send_tokens` (1499)
- `transfer_position` (1524)

**Upgrade risk:** most state is transient and copied through pre/postupgrade (3752/3913) with uncapped logs. Upgrades can eventually hit the instruction limit (M).

### 2.7 sneed_sns_forum, sneed_sms

**Forum tips:** the client transfers, then calls `create_tip(…, ?block)` (570).
- If that call fails, the tipper can call `create_tip` again with the same block; there is no time limit.
- `verify_tip` is idempotent and tested (forum-tips.test.js:179/249).
- Lookup by principal: `get_tips_given_by_user` and `get_tips_received_by_user`. There is **no lookup by block**: `stable_tip_blocks` exists but nothing reads it.
- Unchecked tips write no ICRC-3 block. The prod ICRC-3 log has 0 blocks; the 56 existing tips predate it.
- Admin moderation of posts is in ICRC-3, with hashes.

**SMS:**
- Holds no funds and keeps **no log of any kind**.
- `remove_self_from_message` hard-deletes a message once nobody is left on it (1006).
- `get_all_messages_admin` is not paginated.
- Admins have no lookup by principal and cannot block a sender.

### 2.8 sneed_notifications (`vuy7a-…`) and relay

**Balances:**
- `get_fee_forwarding` shows liabilities of 1.01 ICP.
- Users and apps **cannot withdraw** their balances, by design (spec/sneed_notifications.md:240). Support must explain this.

**Top-ups:** the unknown-outcome issue is #12. There is no per-user top-up history.

**Charges and refunds:** charged when queued. A `#failed` job is refunded to the payer (tested: notifications.test.js:181/193).

**Records:** `get_my_history`, `get_my_settings` and `get_my_apps` are caller-only, so admins have no lookup by principal.

**Other gaps:**
- M: the transient `ticking` flag (1062) can stick after a trap, silently halting deliveries.
- M: `admin_remove_app` (1155) strands the app's balance and is unlogged.
- L: the 30-day prune drops pending paid jobs without refunding them.

**Relay** (relays/notifications/relay.mjs):
- If the ack is lost (94), the job is redelivered.
- Logs go to stdout only, with no job ids and no alerting.

### 2.9 sneed_mon (staging only, `v53u4-…`)

**Funds flows:**
- `credit_deposit` (835) and `withdraw_balance` (872, debit then undo) are correct and tested.
- Auto top-up (`topUpResult` 1116) stores `last_block`.
- Per-check charges are refunded on a send failure (tested).
- Fees can only spend collected fees.

**Gaps:**
- H: no admin lookup by principal; everything is `get_my_*`.
- M: deposit and withdraw blocks are not stored.
- M: `noteError(null, …)` drops the principal.
- M: there is no "ledger balance minus obligations" surplus figure, so misdirected ICP is invisible.

**Ops:**
- Staging has never delivered anything (`sent=0`, "could not perform remote call").
- The uncommitted fix adds call budgeting plus a stable `recent_errors` (30) and `get_recent_errors`.
- `send_failures` is not exposed.
- The new low-cycles test has 1 case and leaves several branches untested.
- 1.45T cycles left after burning 9.1T: watch it.

### 2.10 Naming (6 canisters), avatars, profiles

- **No money.** Premium only raises limits.
- **Records:**
  - ICRC-3 `sneednames_*` blocks carry the caller, including on admin actions (no reason field). pid_names has 464 blocks.
  - Public lookup by principal: `get_name`, `get_account_of`, `changes_since`.
  - The admin `get_log` (TextLog, 2,000-entry ring) is empty on prod.
- **Irreversible by design:** `merge_account` (879) deletes the source's NFT avatar, and frees the source name when the destination already has one. A name freed by a rename can be claimed by anyone.
- **sneed_avatars:** `admin_remove` (289) is **unlogged**. There is no query for the blocked set and no unblock (M).
- **Common user mistake:** an EXT avatar NFT must sit in the principal's default account.

### 2.11 sneed_pad, sneed_guardian (staging only), sneed_proxy, mr_sneed

**sneed_pad** (`create_token` 325, `create_index` 549): an ICRC-2 pull of the full quote.

| Failure | Result | Sev |
|---|---|---|
| Cycles precheck (338) races with concurrent launches | `create_canister` fails *after payment* | H |
| Callback traps after the pull | ICP taken and no launch record (`putLaunch` comes after the await) | M |
| Failure at steps 4–6 | `#failed` plus `sneedpad_launch_failed`, but the fee has already gone to RLL, the cycles are minted, and **there is no refund or resume** | H |
| Any transfer | block indices are not stored (356/383) | H |

- `admin_withdraw_icp` (902) is **unlogged and untested**.
- `admin_set_canister_controllers` (890) is tested on its error paths only.
- `LaunchStatus` cannot tell success from stuck.
- Lookups `get_launches_by_creator(p)` and `get_text_log` are public.

**sneed_guardian:**
- `stage_op`, then payment to `get_op_payment`, then approve, veto window, `execute_op` (477). The fee is swept first and kept even if the op fails, by design (489).
- `refund_op` (396) is callable by anyone and pays `op.payer` (tested at :115/:173).
- ICP sent to the guardian's default account cannot be moved. **On sneed_guardian_blackhole it is lost by design**, so say so in the UI.
- No lookup by payer or stager. Block indices are discarded (404/494).

**sneed_proxy:** governance-only. `forwarded` ICRC-3 blocks record the outcome and are tested.

**mr_sneed canister:**
- Holds no funds. Tips come from the mr_sneed dfx *identity*, so the token ledger is the only record of them.
- `memories_about(p)` and `forget_about_me` exist.
- Missing from frontend health/checks.js.

**IngressGuard:** queries sent as updates, non-admins calling admin methods, and oversized arguments all fail with an opaque "canister rejected the message". The playbook needs that mapping.

### 2.12 Frontend fund flows (src/app_sneeddao_frontend/src)

**Cross-cutting:**
- **None** of the 69 `icrc1_transfer` calls sets `created_at_time`, so a retry after an unknown outcome can pay twice.
- Block indexes are almost never shown to the user.
- Only donations keep a pending-op journal (utils/donations.js:72-79).

| Flow | Gap | Sev |
|---|---|---|
| CMC top-ups (7 copies) | see #4 | **C** |
| SneedAppMint gas top-up (256-276) | notify result unchecked, errors swallowed | H |
| ICPSwap ICRC-1 swap (ICPSwapDex.js:544-578) | funds in the pool subaccount or unused balance; the subaccount balance is never shown | H |
| Premium purchase (Premium.jsx:497-555) | no deposit balance, "complete" or `withdrawDeposit` UI | H |
| SneedApp mint (SneedAppMint.jsx) | no `withdrawUserPayment` UI | H |
| Staking bot stake (CreateIcpNeuronWizard.jsx:333-370) | memo only in memory | H |
| Sneedex bid | `pendingBid` only in React state (SneedexOffer.jsx:1478); SneedexMy offers withdraw/refund | M |
| Pad, index, notifications, GLDT approvals | no expiry | M/L |
| CyclePay `requestId` | not shown or persisted | M |
| Kong still registered (SwapWidget.jsx:1016) | remove it | M |
| Sneed Lock wallet balance | shown only for registered tokens | M |

**Existing support surfaces:**
- `/principal` (Principal.jsx)
- `/scan_wallet`
- `/tools/money` (FollowMoney.jsx)
- `/tools/account`
- admin pages: SneedLock, SneedPremium, Sneedex, SneedMon, SneedAppAdmin, IcpNeuronManagerFactory, Donations, Feedback, AdminSnsJailbreak

**Missing:** one page showing a principal's funds in deposit subaccounts across all canisters.

---

## 3. Cross-cutting gaps

1. **Lookup by principal.** No canister indexes ICRC-3 blocks by principal or by ledger block, so support must scan. Payment logs are admin-only and unfiltered (premium, sneedex, sneed_lock, backend). Many views are caller-only:
   - notifications, sneed_mon and SMS: everything;
   - sneed_lock: `get_my_claim_history`;
   - premium: logs.
2. **Partial history.** ICRC-3 is empty on prod for sneedex, sneedapp, premium and forum (no import), so older history lives in admin logs and state.
3. **Unreadable logs.** sneed_lock `get_error_entries` is an update (refused as a query). Error rings are small or missing:
   - sneedex: none;
   - SMS: none;
   - sneed_mon: 30 entries, without the principal;
   - pad and guardian: 500-line text logs at O(n) per append.
4. **Lost on upgrade:** sneedex timers; transient mutexes (lock, forum `pending_tip_blocks`, notifications `ticking`); the sneed_lock quiescent baseline; the rll in-flight amount after a continuation trap.
5. **Cycles.** Nothing monitors Sneed's own canisters:
   - sneed_mon watches proposals only.
   - health/checks.js pings some canisters and omits mr_sneed.
   - Only sneedapp, pad, guardian, sneed_mon and (uncommitted) the bots expose cycles.
   - The SNS root `get_sns_canisters_summary` covers SNS-controlled canisters, but it is an update call.
6. **Unsafe admin powers that contradict "never sweep":**
   - sneed_lock `admin_rescue_stuck_tokens`, `admin_return_token_from_failed_request`, `admin_return_token` (ignores locks);
   - sneedex `adminReclaimStuckTokens` (no state guard);
   - sneedapp `adminWithdrawIcp` (any `to`);
   - pad `admin_withdraw_icp` (unlogged);
   - rll `clear_*`.
7. **No `created_at_time`** on most canister-side and all frontend `icrc1_transfer` calls, so retries are not deduplicated.

---

## 4. Prioritized fix list

Each fix is small and additive, and ships with a test that fails on the old code and passes on the fix. "EOP" means the upgrade proposal needs KEEP.

### P0: funds stuck or wrong-party payout

1. **sneedex** (classic): `cacheAssetStakes`:
   - Re-read the offer after the awaits and return unless it is still `#Active`.
   - Write only the cached asset fields.
   - Test: a delayed mock governance, with a buyout during the window.
2. **sneedex**: `adminReclaimStuckTokens` allowed only on Expired, Cancelled or Reclaimed. Test: refused on Active and on Completed.
3. **sneedex**: the three escrow methods re-read and re-check `PendingEscrow` and not-escrowed before writing, like EXT at 2885. Tests: concurrent escrow of two indices; a cancel during escrow.
4. **sneedapp** (classic):
   - Wrap steps 2, 4 and 6 in try/catch. Steps 2 and 4 go to `refundPayment`/`discardCanister`; a step-6 failure still records the mint, logging `cmc_tx`.
   - Add `adminSettleOrphan(canisterId, #HandOver|#Delete)` that hands over only to the recorded `minter`, then writes `sneedapp_orphan_settled`. Idempotent.
5. **sneed_lock** (classic): `reconcile_token_lock(lock_id)`, permissionless. It compares both wallets' balances with their summed locks, keeps the lock on whichever side holds the tokens, and writes an ICRC-3 block. It can only reduce over-locking.
6. **frontend**: a shared `utils/cmcTopUp.js` replacing the 7 copies:
   - set `created_at_time`;
   - journal `{canister, block, amount}` before notify;
   - retry notify on `Processing`;
   - show the block;
   - a "notify block #" field plus a pending banner.
   - Also fix SneedAppMint.jsx:272.
7. **backend** (EOP): `save_jailbreak_config` takes a per-caller in-flight lock, sets `created_at_time`, and stores `block_index` in `JailbreakPaymentLog`. Test: two simultaneous calls.
8. **notifications** (EOP): `pull` sets `created_at_time` and a memo, and stores the block per top-up. Add `admin_credit(p, amount, block)`, which verifies the block on the ledger (from p, to the canister) and dedupes by block.

### P1: blindness and self-service recovery

9. **Support read queries, public or caller-or-admin, principal-filtered and paged.** Each is a small additive method:
   - sneed_lock: make `get_error_entries`, `get_info_entries` and the range methods `query` (update the inspect variant); add `get_log_entries_for(p)`, `get_payment_log_for(p)`, and an owner filter on `get_claim_requests_page`.
   - sneedex: `getBidsByBidderAll(p)` (including reservations), `getSettlement(offerId)`, payment logs filtered by principal.
   - premium: `getClaimLogFor(p)`, `getIcpPaymentLogFor(p)`.
   - sneedapp: `lookupLedgerTx(n)`.
   - backend: `admin_get_jailbreak_payments_for(p)`, `admin_get_jailbreak_configs_for(p)`, `admin_get_donations_by(p)`.
   - forum: `get_tip_by_block(ledger, block)`.
   - notifications: `admin_get_user(p)`.
   - sneed_mon: `admin_get_user(p)`.
   - sms: `get_messages_of_user_admin(p, start, len)`.
   - rll: `get_claim_events_for_owner(owner)`, plus paging on the 418k-event list.
   - guardian: `list_ops_by_payer` and `list_ops_by_stager`.
10. **ICRC-3 principal index.** Add a stable `Map<Principal, [blockIdx]>` and `icrc3_blocks_by_principal(p, start, limit)` to the shared Icrc3Log module. That one change covers lock, sneedex, sneedapp, premium, rll, names, pad and guardian.
11. **Error rings, stable and bounded (~500 entries, with principal, op, id and text):**
    - sneedex: write one in every swallowed `#err`.
    - sneed_mon: add the principal to `noteError`.
    - sms: a moderation log.
    - backend, sms, notifications, sneed_mon: an admin-action log.
12. **Self-service withdrawals, to the caller's own account only:**
    - sneed_lock `withdraw_payment_balance` (refused while a create is in flight);
    - premium `withdrawDepositToken(ledger)`;
    - sneedapp `withdrawUserToken(ledger)`;
    - rll `claim_own_balance(token, fee)` (owners = [caller]), which fixes the stranded owners.
13. **sneedex settlement and refund:**
    - Permissionless `settleOffer(offerId)` and `retryRefund(bidId)` that pay the **recorded** recipients only.
    - The expiration worker sweeps unsettled Completed, Expired and Cancelled offers and Lost+escrowed bids.
    - Wrap the worker in try/catch so the flag always clears.
    - On cancel or expiry, return unescrowed ICRC-1 and ICRC-7 tokens from the offer escrow to the creator.
    - `withdrawBidEscrow` reserves 0 for Refunded and ClaimedBySeller bids.
14. **sneed_lock:**
    - Validate `token0`/`token1` against pool `metadata()`.
    - Take the mutex and re-check in both create paths.
    - Write a `sneedlock_stranded` ICRC-3 block and a stable `stranded` map on every add-liquidity "ADMIN ACTION" path. `admin_withdraw_pool_balance_to_user` then takes a `stranded_id` and pays only the recorded owner and amount, idempotently.
    - Add `admin_assign_position_claim`, allowed only when the pool's transaction log shows the claimed owner as the transferrer.
15. **Frontend:**
    - Deposit-balance, "complete" and "withdraw" UI for premium and sneedapp.
    - A staking memo journal.
    - A `/tools/recover` page (see 5.2).
    - `created_at_time` on all transfers.
    - Expiries on the pad, notifications and GLDT approvals.
    - Remove Kong.
16. **Trading bot:**
    - Drop Kong from the default `enabledDexes` and log a warning when a bot still has it.
    - Put the pool id in the trade log.
    - Auto-recover the input after an ICPSwap failure.
    - **Staking bot:** log the stake memo before the transfer.
    - **Both bots:** a public `getHealth()` and a "support viewer" botkey preset that users can grant to mr_sneed.

### P2: tighten admin powers

17. Narrow the unsafe admin powers to "only the recorded owner, only the recorded amount, with an ICRC-3 block and a reason":
    - sneed_lock: `admin_rescue_stuck_tokens` and `admin_return_token_from_failed_request` take an explicit amount, a reference tx and a reason; `admin_return_token` respects `sum_locked`.
    - sneedapp: `adminWithdrawIcp` gets a variant restricted to `getPaymentSubaccount(user)`, capped at that user's logged `stuck_e8s`.
    - pad: `admin_withdraw_icp` writes a log entry.
    - rll: remove or guard `clear_*`.
    - sneedex: add `adminReturnDefaultAccountTokens` (currently 0.3665 ICP is stranded), used only once the sender is established from the ICP index.
18. **Pad, before mainnet:**
    - store block indices and write a `sneedpad_paid` block;
    - reserve cycles;
    - forward the fee only after `controllers_set`, plus `admin_refund_launch(id)` paying `launch.creator` only;
    - a derived `get_launch_state`.
19. **Notifications:**
    - try/finally around `ticking`, plus `last_tick_at`;
    - prune refunds pending paid jobs;
    - a logged `admin_remove_app` that leaves the balance claimable.
    **Relay:** job-id logging and dedupe of acked jobs.
20. **Avatars:** `admin_remove_with_reason`, `is_blocked`, `admin_unblock`.
21. **Cycles:** add a `cycles_balance()` query to every canister that lacks one. Mr Sneed's loop or sneed_mon's `#cycles` topic polls them all. Add mr_sneed to health/checks.js.
22. Backfill ICRC-3 history imports where feasible: premium and sneedapp have admin logs to import from.

---

## 5. Support toolkit design

### 5.1 CLI (`~/.config/mr-sneed/tools/support/`, Node + @dfinity/agent, read-only by default)

Shared pieces:
- `lib/ids.mjs`: canister ids (ic + staging) and well-known ledgers.
- `lib/accounts.mjs`: every derivation from 1.2, ported from Utils.mo and the frontend.
- `lib/icrc3.mjs`: block decoding and paged scans with a local cache (`~/.cache/mr-sneed/icrc3/<canister>.jsonl`).

**`whois <principal> [--network ic|staging] [--json]`** reports everything about P:
- **Identity:** name and verification (pid_names `get_name`, `get_account_of`), profile, avatar, premium (`getMembershipDetails`), bans (`check_ban_status`, plus `get_user_ban_history` as admin).
- **Balances in every known Sneed account of P, across the ICP, SNEED and registered ledgers:**
  - sneed_lock wallet and payment subaccounts;
  - sneedex creation-fee subaccount;
  - sneedapp payment subaccount;
  - premium deposit;
  - jailbreak payment subaccount;
  - sneed_mon deposit;
  - CMC subaccount for each of P's canisters;
  - ICPSwap `getUserUnusedBalance` over the known pools.
  Any non-zero amount is flagged as a "pending deposit".
- **Locks:** `get_lock_states_page({owner=P, include_archived})`, positions, gas tanks.
- **Sneedex:** offers by creator; bids by bidder, including a scan of reservations; escrow balances per offer and bid.
- **sneedapp:** `getMintLog({minterFilter=P})`, wallet (admin), orphans whose minter is P.
- **rll:** `balance_of` per token, claim events for P as hotkey, and owners derived from P's neurons.
- **Forum:** tips given and received. **Notifications and sneed_mon:** `admin_get_user` once added. **SMS:** message count (admin).
- **ICRC-3:** all blocks mentioning P in every canister (from the cache or `icrc3_blocks_by_principal`), shown as a timeline.
- **Ledger activity:** recent ICP/SNEED transactions from P's account via the index canisters, each tagged by counterparty (sneed_lock, sneedex escrow, CMC TPUP, premium deposit, …).

**`tx <ledger> <block>`** explains a ledger transaction in Sneed terms:
- decode from, to, memo, subaccount;
- match against every derivation, e.g. "sneedex bid escrow of bidder X, bid 42", "CMC top-up for canister Y", "rll-claim:<seq>", "staking-bot neuron memo";
- find the ICRC-3 block or log entry that references it (`ledger_tx`, `icp_tx`, `block_index`);
- say what should have happened next and whether it did.

**`stuck [--canister c]`** scans for funds with no matching record:
- sneedex: escrow subaccounts of closed offers and bids, and the default account;
- sneed_lock: the main account and payment subaccounts with balances but no pending lock; pool unused balances against `stranded` records;
- sneedapp, premium, backend: main and default accounts, payment subaccounts above the fee;
- CMC subaccounts of Sneed canisters (unnotified top-ups);
- sneedapp orphans; pad launches not at `controllers_set`;
- rll unresolved incidents and owners with a balance but no neurons;
- notifications liabilities against the ledger balance.

The output is a list of candidates (account, amount, probable owner, method to fix it). The tool never moves anything.

**`health`** reports:
- cycles for every canister (public queries plus `canister_status` where mr_sneed is a controller);
- ICRC-3 archive headroom;
- timer and worker flags (sneedex `expirationWorkerRunning`, notifications `last_tick_at`, rll loop, sneed_mon `last_error`);
- error-ring sizes.

**`fix <playbook-step> …`** (later) prints the exact dfx command for an owner-only recovery for a human to approve. It never runs a sweep.

### 5.2 `/admin/support` and `/tools/recover` pages

- **`/tools/recover`** (any user, for their own principal): the same balances and pending items as `whois`, each with its self-service button:
  - `withdrawDeposit`, `withdrawUserPayment`, `withdraw_jailbreak_payment`, `withdrawOfferCreationPayment`, `withdrawBidEscrow`, `transfer_tokens`;
  - ICPSwap `withdraw`;
  - CMC notify by block;
  - claim staking memo;
  - revoke allowance.
- **`/admin/support`**: a principal search box that renders `whois` and the timeline, plus a `tx` lookup.

---

## 6. Support playbook outline

Every case begins the same way: get the user's principal, the ledger and block index if they have one, the time, and the page used. Run `whois` and `tx`. Never ask for seeds or keys. Payouts go only to the recorded owner.

| Request | Steps | Tools / methods |
|---|---|---|
| "I paid but nothing happened" (premium, sneedapp, lock fee, jailbreak, sneedex fee) | `tx` the payment, then check the deposit subaccount balance. If it is still there, guide the user to complete or withdraw. If it was consumed, find the ICRC-3 block or log entry. | `withdrawDeposit`, `withdrawUserPayment`, `withdraw_jailbreak_payment`, `withdrawOfferCreationPayment`; lock fee has no refund yet (P1-12) |
| "Cycles top-up didn't arrive" | Find the TPUP transfer to `{CMC, S(canister)}`, then call `notify_top_up(block)` (anyone may, and the CMC dedups) | `tx`; CMC notify |
| "My bot mint failed" | `getMintLog` and `getOrphanCanisters` for the principal; ICRC-3 `sneedapp_mint_refund` (`stuck_e8s`) | `withdrawUserPayment`; orphan needs P0-4 |
| "My swap failed / tokens missing after swap" | ICPSwap pool subaccount and `getUserUnusedBalance` for the user (or for the bot) | user `deposit`/`withdraw` via `/tools/recover`; bot `recoverPoolFunds`; Kong is unrecoverable, so explain |
| "My bid / escrow is stuck" | `queryBid`, `getSettlement`, escrow balance | `withdrawBidEscrow`, `refundBid`, `claimAssets`, `claimWinningBid`, `reclaimAssets`, `processExpiration` |
| "I sent an NFT or token to sneedex by mistake" | Default account or escrow? Verify ownership from the ledger or EXT history | `adminReturnMisplacedNft`, `adminReturnMisplacedExtNft` (admin: seabo/n4lvd) |
| "My lock / position is wrong" | `get_lock_states_page(owner)`, ICRC-3 lock blocks, claim requests | `transfer_tokens`, `withdraw_lock_gas`, `claim_position`; uncertain transfer needs P0-5 |
| "LP fees not received" | Claim request status, then the ledger at the owner's sneed_lock wallet | `get_claim_request_status`; resend via `transfer_tokens` |
| "Can't claim my RLL rewards" | `balance_of`, the neurons and hotkeys of P, claim events, incidents | user calls `claim_full_balance_of_hotkey` from a hotkey; stranded owner needs P1-12; incidents need an rll admin |
| "My neuron stake vanished" (staking bot) | Find the bot's ICP transfer to governance and read the 8-byte memo | `claimNeuronFromDeposit(memo)` (user or a botkey holder) |
| "Notifications balance / not delivered" | `get_receipts`, `admin_get_user` (P1), relay logs | refund is automatic on `#failed`; balance cannot be withdrawn by design, so explain |
| "Premium not recognised" | `getMembershipDetails`; the PremiumClient cache in the calling canister | `extendMembershipAdmin` if paid; wait out the cache |
| "Name / avatar gone" | ICRC-3 `sneednames_*` for P (merge, admin clear, NFT no longer owned) | `refresh_nft_avatar`, `admin_set_name`; a merged name is irreversible, so explain |
| "Canister rejected the message" | Explain the IngressGuard causes: query sent as update, admin-only method, argument too large | — |
| "Sent ICP to a canister's main or default account" | `tx` to establish the sender | sneedex, lock, sneedapp have admin returns (verify the sender first). Stuck by design: premium, backend, guardian. Lost: guardian_blackhole. Shared out to voters: rll. Explain each case. |

**Escalation:** anything that needs an admin Mr Sneed doesn't hold (lock, sneedex, rll), or any payout from a pooled account, goes to the user, or to a proposal through the Sneed proxy, with the `whois` and `tx` evidence attached.
