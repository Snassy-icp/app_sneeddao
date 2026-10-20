# Sneedex activity log (ICRC-3)

Design for a hash-chained, certified activity log in the `sneedex` canister, exposed
through the ICRC-3 block log interface, with archive canisters. Written 2026-10-20. The
log uses the shared library `src/icrc3` exactly as `sneed_lock` does (design:
[spec/sneed_lock_icrc3.md](sneed_lock_icrc3.md); recipe: `src/icrc3/README.md`). This
document only records what is specific to Sneedex: the block catalogue, where each block
is appended, and the operations around the release.

**Status (2026-10-20): implemented, not deployed.** Tests: `test/canisters/tests/sneedex-icrc3.test.js`.

## Goals and rules

- Every state change of the market that matters to a participant or an auditor produces
  one block: offers (create, assets, escrow, activation, cancellation, expiry, completion,
  settlement), bids (reservation, confirmation, loss, refund, escrow withdrawal), every
  movement of value out of an escrow (asset hand-over per asset, marketplace cut, seller
  payment, refunds, creation fees) and every admin action that moves assets or changes
  fees and settings.
- A block is appended only once the change is final: after the ledger, governance,
  management-canister or Sneed Lock call that moved something has succeeded, in the same
  message that records it in Sneedex's state. A failure appends nothing (failures stay in
  the error results the caller gets). Multi-step flows log each completed step, so a
  settlement that delivers two of three assets has two `sneedex_asset_deliver` blocks and
  no `sneedex_offer_settle` block until the third arrives.
- Nothing private is logged. `note_to_buyer` is private (only the seller and the winner
  can read it) and never appears in a block. Public notes and canister titles and
  descriptions are public but not logged either: they describe, they do not change
  ownership, and they would make blocks large. Everything that is logged is already
  readable by anyone through the public queries (`queryOffer`, `getOfferView`,
  `queryBid`, `getConfig`, `getFeeConfig`, ...): a private offer's approved bidders are
  readable today, and nothing on the IC is anonymous.
- The log starts empty with this release. Offers and bids that exist at the upgrade are
  not imported; their later actions are logged as they happen, and their earlier history
  is what the public queries show.

## Block format

As in Sneed Lock: `Map { btype; ts; phash; tx }`. Inside `tx`:

- principals as `Blob`; ICRC-1 accounts as `Array [owner, subaccount?]`
- amounts in the token's base units, ids, timestamps (ns since epoch) as `Nat`
- `caller`: the principal that made the call. Omitted when the action was done by a
  Sneedex timer (auto-delivery, auto-payment, auto-refund, auto-reclaim, the expiration
  worker); those blocks carry `via` = `"timer"` instead.
- no `cid`: Sneedex has no text log to correlate with.
- flags as `Nat` 0 / 1; optional fields omitted when absent.

### Asset description (`asset`)

A `Map` describing one asset as listed, with `type` and the fields of that type:

| `type` | fields |
|---|---|
| `canister` | `canister_id`; `canister_kind` (Nat) when set; `controllers_snapshot` (Array of Blob) once escrowed |
| `sns_neuron` | `governance`, `neuron_id` (Blob); `hotkeys_snapshot` (Array of Blob) once escrowed |
| `icrc1` | `ledger`, `amount` |
| `icrc7` | `collection`, `token_ids` (Array of Nat) |
| `ext` | `collection`, `token_indices` (Array of Nat), `token_identifiers` (Array of Text, the EXT TokenIdentifiers) |
| `sneed_lock` | `lock_id`, `kind` (`token` or `position`), `ledger` and `amount` or `pool` and `position_id`, `expiry` |

## Block type catalogue

Prefix `sneedex_`; `icrc3_supported_block_types` reports every type with the url
`https://app.sneeddao.com/api/sneedex#block-types`.

Offers:

| btype | when | tx fields |
|---|---|---|
| `sneedex_offer_create` | `createOffer` recorded the offer (Draft) | `caller`, `offer_id`, `price_ledger`, `fee_rate_bps` (cut locked in for this offer); `min_bid`, `buyout`, `expiration`, `min_increment_fee_multiple` when set; `approved_bidders` (Array of Blob) for a private offer; `creation_fee_e8s` and `creation_fee_icp_tx` when a creation fee was paid |
| `sneedex_asset_add` | `addAsset` | `caller`, `offer_id`, `asset_index`, `asset` |
| `sneedex_offer_finalize` | `finalizeAssets` (Draft → PendingEscrow) | `caller`, `offer_id`, `asset_count` |
| `sneedex_asset_escrow` | an `escrow*` call verified custody of one asset | `caller`, `offer_id`, `asset_index`, `asset` (with snapshots); `pulled` = 1 when Sneedex pulled NFTs through an ICRC-37 approval; for EXT `account_id` (Text, the escrow account id the tokens were verified in) |
| `sneedex_offer_activate` | `activateOffer` (PendingEscrow → Active) | `caller`, `offer_id` |
| `sneedex_offer_cancel` | `cancelOffer` | `caller`, `offer_id`, `from_state` (`draft`, `pending_escrow`, `active`) |
| `sneedex_offer_expire` | `processExpiration` or the expiration worker found no bid (Active → Expired) | `offer_id`; `caller` or `via` |
| `sneedex_offer_complete` | an offer got its winner (Active → Completed; the bid becomes Won) | `offer_id`, `bid_id`, `buyer`, `price_ledger`, `amount`, `reason` (`buyout`, `accept`, `expiry`); `caller` or `via` |
| `sneedex_asset_deliver` | one asset reached its recipient | `offer_id`, `asset_index`, `asset`, `to` (principal), `side` (`buyer` or `seller`); `recovered` = 1 when handed over from an offer that was already Claimed / Reclaimed (offers settled by a version before per-asset tracking, whose failed hand-over `claimAssets` / `reclaimAssets` can still recover); for tokens `amount` and `ledger_tx` when a transfer happened; for NFTs (ICRC-7 and EXT) `moved` (how many of the tokens were still in escrow and moved); `escrowed` = 0 when an EXT asset that was never marked escrowed was found in the escrow account and returned to the seller, best effort, on cancel or expiry; `caller` or `via` |
| `sneedex_offer_settle` | every asset arrived and the offer became Claimed or Reclaimed | `offer_id`, `outcome` (`claimed` or `reclaimed`), `to`; `caller` or `via` |

Bids:

| btype | when | tx fields |
|---|---|---|
| `sneedex_bid_reserve` | `reserveBid` | `caller`, `bid_id`, `offer_id` |
| `sneedex_bid_excess_refund` | `confirmBid` returned escrow above the effective bid | `caller`, `bid_id`, `offer_id`, `ledger`, `amount`, `to`, `ledger_tx` |
| `sneedex_bid_confirm` | `confirmBid` recorded the bid as escrowed | `caller`, `bid_id`, `offer_id`, `ledger`, `amount` (the effective bid, capped at the buyout) |
| `sneedex_bid_lost` | a bid became Lost | `bid_id`, `offer_id`, `bidder`, `amount`, `escrowed` (0 for a reservation never confirmed), `reason` (`outbid`, `offer_completed`, `offer_cancelled`, `offer_closed` = confirmed after the offer had closed, `buyout_race` = a concurrent buyout won) |
| `sneedex_bid_refund` | a Lost bid's escrow was returned (`refundBid` or the auto-refund timer; the bid becomes Refunded) | `bid_id`, `offer_id`, `bidder`, `ledger`, `amount` (transferred), `to`, `ledger_tx`; `caller` or `via` |
| `sneedex_bid_escrow_withdraw` | `withdrawBidEscrow` | `caller`, `bid_id`, `offer_id`, `ledger`, `amount`, `to`, `ledger_tx` |
| `sneedex_cut_pay` | the marketplace cut left the winning bid's escrow | `offer_id`, `bid_id`, `ledger`, `cut` (charged), `amount` (transferred: the cut less one ledger fee), `fee_rate_bps`, `to` (account), `ledger_tx`; `caller` or `via` |
| `sneedex_seller_pay` | the seller was paid (the bid becomes ClaimedBySeller) | `offer_id`, `bid_id`, `seller`, `ledger`, `bid_amount`, `cut`, `amount` (transferred), `to`, `ledger_tx`; `caller` or `via` |

Offer creation fees (ICP):

| btype | when | tx fields |
|---|---|---|
| `sneedex_creation_fee_pay` | the fee left the payer's payment subaccount | `caller`, `payer`, `fee_e8s` (charged), `amount_e8s` (transferred), `to` (account), `icp_tx` |
| `sneedex_creation_payment_withdraw` | `withdrawOfferCreationPayment` | `caller`, `amount_e8s`, `to`, `icp_tx` |

Admin (admins and controllers only):

| btype | when | tx fields |
|---|---|---|
| `sneedex_admin_asset_return` | `adminReclaimStuckTokens` handed one escrowed asset back to the seller | `caller`, `offer_id`, `asset_index`, `asset`, `to`; tokens: `amount`, `ledger_tx` when a transfer happened; NFTs (ICRC-7 and EXT, added with the EXT release; before it an escrowed ICRC-7 asset made `adminReclaimStuckTokens` trap, its switch did not cover the case): `moved` |
| `sneedex_admin_nft_return` | `adminReturnMisplacedNft` | `caller`, `collection`, `token_id`, `to` (account) |
| `sneedex_admin_ext_return` | `adminReturnMisplacedExtNft` | `caller`, `collection`, `token_index`, `token_identifier`, `from_offer_id` when given, `from_account_id` (Text), `to` (principal) |
| `sneedex_config_update` | a setting changed | `caller`, `key`, `value`; `old_value` when known |

`sneedex_config_update` keys and values: `admin_added`, `admin_removed` (Blob);
`admins` (Array of Blob), `min_offer_duration_ns`, `max_assets_per_offer`,
`min_increment_usd_range_min`, `min_increment_usd_range_max`, `min_increment_usd_target`,
`min_increment_fallback_tokens` (Nat; written per changed field by `updateConfig`,
`addAdmin`, `removeAdmin`, `setMinIncrementSettings`); `marketplace_fee_rate_bps`,
`premium_auction_cut_bps`, `offer_creation_fee_e8s`, `premium_offer_creation_fee_e8s`
(Nat); `fee_recipient` (account); `ledger_fee_recipient` (Map `ledger`, `account`) and
`ledger_fee_recipient_removed` (Blob ledger); `sneed_premium_canister_id`,
`backend_canister_id`, `neuron_manager_factory_canister_id`, `sneed_sms_canister_id`
(Blob, or Text `none`), `sneed_lock_canister_id` (Blob); `asset_type_added` (Map `id`,
`name`), `asset_type_deactivated`, `asset_type_reactivated` (Nat id);
`expiration_timer` (Text `on` / `off`), `expiration_check_interval_seconds`,
`neuron_info_cache_staleness_seconds` (Nat); `icrc3_proposal_neuron` (Blob or Text
`none`) and the log's own settings `icrc3_max_live_blocks`, `icrc3_spill_batch_size`,
`icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`,
`icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`.

Not logged: notification settings (per user, private preference), the staking-bot info
cache and its clearing, cached stakes, the bot hotkey/botkey snapshot timers (internal to
an escrowed bot), `triggerExpirationCheck` (its effects are logged), wallet registration
in Sneed Hub (best effort, outside the market), and reads.

## Appending points

| Code path | Blocks |
|---|---|
| `createOffer` | `sneedex_creation_fee_pay` right after the ICP transfer; `sneedex_offer_create` when the offer is stored |
| `addAsset` / `addAssetSync` | `sneedex_asset_add` |
| `finalizeAssets` | `sneedex_offer_finalize` |
| `escrowCanister`, `escrowSNSNeuron`, `escrowICRC1Tokens`, `escrowICRC7NFTs(ByApproval)`, `escrowEXTNFTs`, `escrowSneedLock` | `sneedex_asset_escrow` when the asset is marked escrowed |
| `activateOffer` | `sneedex_offer_activate` |
| `reserveBid` | `sneedex_bid_reserve` |
| `confirmBid` | `sneedex_bid_excess_refund` (ledger Ok only), then `sneedex_bid_lost` (offer closed meanwhile) or `sneedex_bid_confirm` + `sneedex_bid_lost` (outbid) per lower bid; a buyout continues in `completeOfferInternal`; a lost buyout race logs `sneedex_bid_lost` |
| `completeOfferInternal` (from `confirmBid`, `acceptBid`, `processExpiration`, the expiration worker) | `sneedex_offer_complete`, then `sneedex_bid_lost` per other Pending bid |
| `processExpiration`, expiration worker | `sneedex_offer_expire` (no bids) |
| `cancelOffer` | `sneedex_offer_cancel`, then `sneedex_bid_lost` per escrowed Pending bid |
| `settleAssets` (from `claimAssets`, `reclaimAssets`, `autoDeliverAssets`, `autoReclaimAssets`) | `sneedex_asset_deliver` per asset handed over (normal, recovered, or an unescrowed EXT asset returned with `escrowed` = 0), then `sneedex_offer_settle` when the offer becomes Claimed / Reclaimed |
| `payWinningBidToSeller` (from `claimWinningBid`, the auto-payment timer) | `sneedex_cut_pay` after the cut transfer; `sneedex_seller_pay` after the seller transfer |
| `refundBid`, `autoRefundBid` | `sneedex_bid_refund` |
| `withdrawBidEscrow` | `sneedex_bid_escrow_withdraw` |
| `withdrawOfferCreationPayment` | `sneedex_creation_payment_withdraw` |
| `adminReclaimStuckTokens` | `sneedex_admin_asset_return` per successful hand-back |
| `adminReturnMisplacedNft` | `sneedex_admin_nft_return` |
| `adminReturnMisplacedExtNft` | `sneedex_admin_ext_return` |
| admin setters, `addAdmin`, `removeAdmin`, `updateConfig`, asset types, expiration timer, cache staleness, ICRC-3 settings and neuron | `sneedex_config_update` |

To carry the details of a hand-over into its block, the token sweep
(`AssetHandlers.reclaimAllTokens`) gained a twin, `sweepTokens`, that reports the amount and
the ledger block (or that nothing was moved); `reclaimAllTokens` is now a wrapper around it
with the same result as before. `deliverAsset` and `recoverAsset` return those details
instead of `()` / `Bool`; their control flow is unchanged.

## Endpoints

The same as Sneed Lock (library one-liners, `src/icrc3/README.md`):

```
icrc3_get_blocks, icrc3_get_archives, icrc3_get_tip_certificate, icrc3_supported_block_types,
icrc10_supported_standards, icrc3_log_status, icrc3_registration_status            (queries)
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers,
admin_set_icrc3_proposal_neuron, admin_icrc3_register_archives_now,
admin_icrc3_reset_archive_registration                                             (admin updates)
```

No `admin_icrc3_import_history`: there is no import. `icrc3_log_status().history_imported`
stays `false`. Every new method is in the ingress guard: the queries are refused as update
calls, the updates take small arguments (`SMALL_ARG`).

## Archives, controllers, registration, cycles

- Archives are created by Sneedex (actor class from `src/icrc3/Archive.mo`) with
  `archive_initial_cycles` (default 1.5 T; the subnet keeps the 0.5 T creation fee) when
  the live store reaches `max_live_blocks` (2000), checked every 15 minutes by a timer.
- Controllers: Sneedex and SNS root `fp274-iaaaa-aaaaq-aacha-cai`, set right after creation
  (`admin_icrc3_repair_archive_controllers` re-applies them).
- SNS registration: `SnsRegister.mo` with Sneed governance `fi3zi-fyaaa-aaaaq-aachq-cai`,
  name "Sneedex". Skipped until `admin_set_icrc3_proposal_neuron` names a neuron that has
  Sneedex as a hotkey (`SubmitProposal`), the minimum dissolve delay to vote and a stake
  covering the reject cost. Registering makes SNS root the archive's sole controller.
- Cycle reserve: 2 T. Sneedex never spends its balance below that on archives; with less
  it logs (canister log, `Debug.print`) and the live store keeps growing on the heap.
- Sneedex's rate: a full sale is about 10 to 15 blocks, so 2000 live blocks are some
  150 offers; the first archive is months away at the current volume.

## Persistence and upgrade

Sneedex uses classic persistence (no EOP flag in dfx.json). `icrc3 : Log.State` and
`icrc3_sns : SnsRegister.State` are new stable fields of the persistent actor (additive);
the runtimes are `transient`. `postupgrade` re-certifies the tip; the spill timer is started
from the actor body (which runs on every install and upgrade; the runtime guard makes it run
once). Candid changes are additive (new methods only).

Upgrade proposal: `UpgradeSnsControlledCanister` with the release build of
`src/sneedex` (dfx 0.28.0); no `wasm_memory_persistence` (classic). After the upgrade:
`icrc3_log_status()` shows `log_length = 0`; the first market action writes block 0. Nothing
needs configuring for the log to work. To have archives registered automatically, set a
hotkeyed neuron with `admin_set_icrc3_proposal_neuron` (an admin call); otherwise register
each archive by hand with a `RegisterDappCanisters` proposal when one appears, and add it to
the ic-unicycle cycle monitoring.
