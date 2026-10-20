Sneedex Marketplace

Status (2026-10-20): built and live (production `7bvk3-ryaaa-aaaal-qtykq-cai`, staging `igm46-laaaa-aaaae-qgwra-cai`). The design below is the original brief; notes marked "Changed from the original plan" or "Status" record where the code went another way or further. The integrator reference with every method and error is src/app_sneeddao_frontend/public/api-docs/sneedex.md.

Activity log: every market action is recorded in an ICRC-3 block log with archive canisters; design and block catalogue in spec/sneedex_icrc3.md.

We're going to build a marketplace called Sneedex. It will be based on offers that can hold one or more assets, and bids. The assets will be held in escrow in the marketplace canister. 

The core of an offer is these three fields: minimum bid price, buyout price, expiration date. 
Every offer must have either a buyout price or an expiration date - it can have both. 
If an offer does not have a minimum bid, the buyout price is considered the minimum bid. 
The offer must also contain the ledger PID of an ICRC1 token that the price is given in. All prices are in e8s. 

Note: prices are in base units of the price token's ledger (e8s for 8-decimal tokens). A minimum bid, when set, must be > 0 and ≤ the buyout price; an expiration must be at least `config.min_offer_duration_ns` in the future. An offer may also set `min_bid_increment_fee_multiple` (each new bid must beat the highest by that many ledger fees; otherwise by 1 base unit), a `public_note` and a `note_to_buyer` (shown only to the creator and, after the sale, the winner).

This construction allows for auctions (have a min bid and eiter a buyout and/or an expiration date),
as well as for limit orders (no min bid, but a buyout and optionally an expiration date) 

The assets that an offer can list include: Canisters, SNS Neurons, ICRC1 Tokens. The bids must be in the specified ICRC1 token. 

Status (2026-10-20): built, plus two more asset types: ICRC-7 NFTs (type 3; 1 to 50 token ids of one collection per asset, escrowed by ICRC-37 approval or by transfer) and Sneed Lock locks (type 4; Sneedex becomes the lock's owner inside Sneed Lock). Sneed Lock locks can also be sold as ICRC-7 NFTs of Sneed Lock's own collection. Locks listed either way must stay locked past the offer's expiration. Canister assets may carry a `canister_kind` (ICP Staking Bot, Trading Bot); for those Sneedex also clears the bot's botkeys (and a staking bot's neuron hotkeys) during escrow and restores them on a return. An offer holds at most `config.max_assets_per_offer` assets (10 on production), each asset at most once.

The list of supported asset types can grow over time, and we must support this while respecting stable canister state. 
Thus we will have a list of asset type ids and names that we can add and remove to, and all references to asset types will be via this id. 

Status (2026-10-20): built. Admins add types (`addAssetType`) and deactivate/reactivate them; types are never removed, a deactivated type just cannot be added to new offers. Ids: 0 Canister, 1 SNS Neuron, 2 ICRC1 Token, 3 ICRC-7 NFT, 4 Sneed Lock, 5 EXT NFT (see "EXT NFTs" below; added to the registry on upgrade).

When we need to do something with an asset, we will call a central API where we can register handlers for the asset types we support. 

Status (2026-10-20): the handlers live in src/sneedex/AssetHandlers.mo and are selected by the asset variant, not registered at runtime.

We want to use the new persistent actors for this. 

Each offer gets a unique Nat id from a counter, starting at 0. 

(Bids get ids from a second counter, also starting at 0.)

To register assets into escrow:

for canisters: 1) Add the sneedex canister as a controller (but do not remove yourself). 2) call the sneedex canister, 3) sneedex canister will verify that the caller and itself are in the list of controllers for the canister (and that the caller is the creator of the offer and that the canister is listed as an asset in the offer). 4) if so it will make a snapshot of the list of controllers (except itself) and store it in the offer and then remove all controllers except itself. We now have the canister safely in escrow, and we have recorded who it belongs to in the offer creator field as well as in the controller list snapshot. 

For SNS Neurons: SNS Neurons have a list of hotkeys that can have full permissions to be considered owners (like controllers). We do the same general process, we verify both caller and the sneedex canister have owner hotkeys, take a snapshot of all hotkeys, clear all hotkeys except sneedex canister. 

Note: "owner" means holding all SNS neuron permissions 1 to 10. Sneedex also records each principal's exact permissions, so a return gives everyone back exactly what they had (not just owner rights to the creator). On a sale the buyer gets full owner permissions and Sneedex removes its own.

For ICRC1 tokens: 1) The user sends the token to a subaccount on the sneedex canister that is generated from the user's principal and the offer id. 2) The sneedex canister verifies that the amount declared in the offer is present in the subaccount generated from the caller (who is also verified to be the offer creator) and the offer id. When ICRC1 tokens are sent to a bid, the bid id is used instead of the offer id. 

Note: the subaccounts are 32 bytes: principal length, principal bytes, a type marker at byte 23 (`O` offer, `B` bid, `P` creation-fee payment), and the id as a big-endian u64 in bytes 24..31. The canister answers them with `getOfferEscrowSubaccount` / `getBidEscrowSubaccount`. Escrow checks that the subaccount holds at least the declared amount.

Changed from the original plan: when an ICRC-1 asset is delivered to the buyer or returned to the seller, Sneedex sends the whole balance of that ledger in the offer subaccount minus one ledger fee, not the declared amount. A seller who wants the buyer to receive exactly `amount` deposits `amount + fee`; anything deposited above that also goes to the recipient.

The user creates a new offer, which has an offer id. Then the user declares the assets (canisters, SNS Neurons, ICRC1 Tokens) they want to bundle into the offer.
Then they make the assets available to the sneedex canister (add sneedex as controller, owner hotkey, or send ICRC1 tokens to caller+offer_id subaccount).
Then they activate the offer, at which time the sneedex canister gains exclusive access to the assets in the offer. 

Note: as built the steps are `createOffer` (state `Draft`), `addAsset` per asset, `finalizeAssets` (`PendingEscrow`), one `escrow*` call per asset (Sneedex takes exclusive access at that call, not at activation), then `activateOffer` (`Active`), which requires every asset escrowed and the expiry not passed. Assets cannot be removed from a draft; the creator cancels and starts again.

Status (2026-10-20): `createOffer` charges an ICP creation fee from a per-user payment subaccount (lower or zero for Sneed Premium members; 0.01 ICP regular, free for premium on production at the time of writing), and each offer locks in a marketplace cut (`fee_rate_bps`, regular or premium rate) taken from the winning bid at payout and sent to a fee recipient (per price ledger, or the default). Neither was in the original brief.

Then users can make bids until the offer resolves, either via buyout or expiration - or by being cancelled (possible until there are bids). 

Note: a bid is placed in three steps: `reserveBid` (gets a bid id, hence the escrow subaccount), a transfer of the amount to that subaccount, and `confirmBid`, which checks the minimum, the increment and the balance. A bid above the buyout price is capped at it and the excess refunded. A confirmed bid at or above the buyout price completes the offer in the same call.

Changed from the original plan: the creator can cancel an offer in `Draft`, `PendingEscrow` or `Active`, also after bids have arrived. Every confirmed bid then becomes `Lost` and is refunded automatically (bid amount minus one ledger fee), the bidders are told by Sneed SMS, and the assets go back to the seller. (The `CannotCancelWithBids` error variant still exists in Types.mo but is never returned.)

If the offer expires without bids it fails, and the creator/seller can reclaim their assets (this can be done automatically, but if it fails the seller can also reclaim them with a call to a function). If there is at least one bid at the expiration date, or there is a bid matching the buyout price, the best bid wins and the auction succeeds, which means that now the buyer with the winning bid may claim the assets in the offer and the offer creator/seller may claim the tokens in the winning bid. 

Status (2026-10-20): built. Expiry is settled by `processExpiration`, which anyone may call, and by a recurring timer (hourly on production); until then an expired offer stays `Active` but refuses bids. After completion Sneedex delivers the assets to the winner (after about 2 s) and pays the seller (after about 3 s) by timer; `claimAssets` (winner), `claimWinningBid` (seller) and `reclaimAssets` (seller, for expired or cancelled offers) are the manual fallbacks. Lost bids are refunded by timer, with `refundBid` and `withdrawBidEscrow` as fallbacks (the latter also recovers tokens sent to a bid that was never confirmed). Settlement is meant to work like this: an offer is finished (`Claimed` / `Reclaimed`) only when every transfer succeeded, and failed parts can be retried.

Known issue (being fixed 2026-10-20): the current code marks an offer `Claimed` or `Reclaimed` after attempting every asset transfer even when one of them failed, so an asset can stay in Sneedex while the offer looks settled. Admins can retry a return to the seller with `adminReclaimStuckTokens`.

At any point before the expiration date, and before a buyout is reached, and there is at least one bid, the offer creator can decide to accept the best bid and close the offer with the best bid at the time winning it. 

Note: `acceptBid` checks only that the offer is `Active` and has a confirmed bid, so it also works after the expiration date as long as the expiry has not been processed yet; the outcome is the same as processing the expiry (the highest bid wins).

The state of the auction is represented by a single state enum from which all asset ownership (claimability) derives, and that can only transition atomically, 
which makes all assets in escrow change hands atomically. 

Status (2026-10-20): built. Offer states: `Draft`, `PendingEscrow`, `Active`, `Completed { winning_bid_id; completion_time }`, `Claimed`, `Expired`, `Cancelled`, `Reclaimed`. Bid states: `Pending`, `Lost`, `Refunded`, `Won`, `ClaimedBySeller`. The ownership-deciding transitions (`Active → Completed / Expired / Cancelled`) are a single write with no `await` in between, so concurrent buyouts, `acceptBid` and expiry cannot both win. Confirm, refund, withdraw and payout serialise on a per-bid lock.

Use the file src/sneedex/main.mo for the main actor interface, src/sneedex/Types.mo for all type declarations, and create any additional files in the same directory as needed for the implementation. 

(As built: main.mo, Types.mo, AssetHandlers.mo, Utils.mo.)

---

## Built beyond the original brief (Status 2026-10-20)

- **Private offers.** `approved_bidders` limits who may reserve bids (the creator always may); approved bidders get a Sneed SMS invitation at activation. Private offers are unlisted, not secret: every offer, its `approved_bidders`, bids, bidders and amounts can be read by anyone through `queryOffer`, `getOfferFeed`, `getPrivateOffersFor(any principal)` and `debugGetAllOffers`. Only `note_to_buyer` is withheld from others, and it is stored unencrypted.
- **Notifications.** Sneed SMS system messages for a new bid, outbid, sale, win, expiry without bids, cancellation and private invitations; each user can switch them off (`setMyNotificationSettings`). Best effort, never affects the offer.
- **Reading.** Paged `getOfferFeed` with filters, `getOfferView`, staking-bot neuron info proxied for buyers (`getNeuronManagerInfo`, cached), `getCanisterInfo` for escrowed canisters, `getMarketStats` (its `total_volume_by_token` is not implemented and always empty), public `getPaymentStats`.
- **Ingress guard.** `inspect_message` refuses queries called as updates and caps argument sizes.
- **Admin rescue.** `adminReclaimStuckTokens(offerId)` and `adminReturnMisplacedNft` (for NFTs a non-compliant collection put in Sneedex's default account); `adminReturnMisplacedExtNft` for EXT tokens (below).

## EXT NFTs (step 3 of proposal #416)

Status (2026-10-21): implemented, not deployed. Tests: `test/canisters/tests/sneedex-ext.test.js`.

EXT (Toniq / Entrepot) NFTs, e.g. Sneed Diamond Club cards (`gjv36-laaaa-aaaah-adyza-cai`), are listed, escrowed and sold like ICRC-7 NFTs, every step in the ICRC-3 log (spec/sneedex_icrc3.md: asset `type` = `ext`).

- **Asset and storage.** `#EXTNFT { collection_canister_id : Principal; token_indices : [Nat32] }` (asset type 5; 1 to 50 indices of one collection, none twice) is a new case of the `Asset` variant stored in `offers`. A variant with one more case is a supertype of the old one, so the stable state stays compatible: `moc --stable-compatible` of the production stable signature (commit 0775f9ac, Wasm c20305b8) against the new one passes, and the only difference is the new case; a PocketIC test upgrades the production build with live offers. Candid: the new case appears in query results, so older client bindings cannot decode an offer that contains an EXT asset (the same as when `ICRC7NFT` and `SneedLock` were added); new methods are additive (`escrowEXTNFTs`, `getOfferEscrowAccountId`, `adminReturnMisplacedExtNft`).
- **Identifiers.** EXT addresses holders by ICP-style account identifiers. TokenIdentifier and account id (also of a subaccount) come from `src/sneed_names/Ext.mo` (shared with `sneed_pid_names`; vectors in `test/canisters/motoko/ext.test.mo`).
- **Escrow model.** EXT has no common approval flow, so escrow is by transfer only. The offer's escrow account is the account id of (Sneedex, the offer escrow subaccount), answered by `getOfferEscrowAccountId(creator, offerId)`. The seller sends each card there (`to = address`) and calls `escrowEXTNFTs(offerId, i)`, which checks `bearer(tid)` == that account id for every card. The offer activates only once every asset is escrowed.
- **Delivery: `from` / `subaccount`.** Sneedex calls `transfer` with `from = #address(escrow account id)`, `subaccount = ?escrow subaccount`, `to = #principal(recipient)`. The EXT reference implementation (and the Diamond Club) take the owner from `from` (a `#principal` names that principal's default account) and the spender from the caller plus `subaccount`, and require both to equal the holder. Evidence: calls to the Diamond Club on mainnet, made as the anonymous principal and refused by design (nothing moved): `from = address(holder)`, `subaccount = [sub7]` answered `Unauthorized(aid(anonymous, sub7))` (the spender), and `from = principal(anonymous)`, `subaccount = [sub7]` answered `Unauthorized(aid(anonymous))` (the owner, ignoring `subaccount`). So `from = #principal(Sneedex)` would be refused. `test/canisters/canisters/MockExt.mo` implements the same rules.
- **Truth is `bearer`.** Calls to collections are bounded-wait (30 s reads, 60 s transfers). After every transfer, whatever the answer (a lost answer may hide a done transfer), Sneedex reads `bearer` and records the card as delivered only when the recipient's default account holds it. Delivery goes through `settleAssets`, its per-offer lock and per-asset bookkeeping: a retry moves only cards still in the escrow account, a card the recipient already holds counts as delivered, and a card held by anyone else left escrow earlier (only Sneedex can move it out, only to this offer's recipient).
- **Listing rules.** `addAsset` reads `bearer` for each card: it must be held by the caller's default account, or already sit in this offer's escrow account. Duplicates are refused when another open offer (Draft, PendingEscrow, Active) of the same seller lists the card, or any offer holds it escrowed and has not handed it over; a previous holder's stale draft does not block a new holder.
- **Returns.** Cancel and expiry return escrowed cards like any asset. In addition a card that sits in the escrow account but was never marked escrowed (sent, then the offer was cancelled or expired before `escrowEXTNFTs`) is returned best effort (block with `escrowed` = 0); a collection that cannot answer does not block the hand-back. `recoverAsset` and `adminReclaimStuckTokens` move only cards still in the offer's escrow account (`adminReclaimStuckTokens` now also covers ICRC-7 assets, on which it used to trap). `adminReturnMisplacedExtNft(collection, index, fromOffer, to)` returns a card from Sneedex's default account or from an escrow account no offer holds it for; refused while an offer waiting for escrow lists it or an offer holds it escrowed and undelivered.
- **Frontend.** The create wizard lists the user's EXT cards (ExtUtils), sends a card to the escrow account id after a confirm screen, then calls `escrowEXTNFTs`; offer pages show EXT cards with an EXT badge; "Sell on Sneedex" on EXT NFT cards.

## Known issues (2026-10-20)

- Settlement marks an offer `Claimed` / `Reclaimed` even when a transfer failed (see above); being fixed.
- The error variants `CannotCancelWithBids`, `AssetTypeNotSupported` and `EscrowFailed` are declared in Types.mo but never returned (a deactivated asset type answers `InvalidAsset("This asset type is not currently accepted")`).
