/// The text get_api_doc answers: a short guide to Sneedex for agents (full reference: api-docs/sneedex.md).
module {
  public let text : Text = "# Sneedex (canister sneedex)

Sneedex is Sneed DAO's escrow marketplace. A seller bundles assets into an offer (canisters, SNS neurons, ICRC-1 tokens, ICRC-7 NFTs, EXT NFTs, Sneed Lock locks), Sneedex takes them into escrow, buyers bid in one ICRC-1 price token, and at settlement every asset changes hands together. Auctions, fixed-price listings and private offers are the same offer with different settings. The canister is controlled by the Sneed DAO SNS.

- Production: `7bvk3-ryaaa-aaaal-qtykq-cai`
- Staging (same code, own state, real tokens): `igm46-laaaa-aaaae-qgwra-cai`

## Units and encoding

- Amounts are ledger base units as `nat`; creation fees are ICP e8s as `nat64`; rates are basis points (100 = 1%).
- `expiration`, `created_at`, `activated_at`, `completion_time` are `int` nanoseconds since the Unix epoch; log timestamps are `nat64` ns.
- `OfferId` and `BidId` are `nat` counters; assets are addressed by their index in `offer.assets`.
- Results are lowercase `variant { ok : T; err : SneedexError }` (`NotAuthorized`, `OfferNotFound`, `InvalidState(text)`, `BidTooLow { minimum }`, `BidIncrementTooSmall {...}`, `InsufficientFunds { available; required }`, `TransferFailed(text)`, ...). `verifyICPNeuronManager`, `verifyTradingBot` and `getNeuronManagerInfo` use `Ok`/`Err`.
- Escrow subaccounts: ask the canister (`getOfferEscrowSubaccount(creator, offerId)`, `getBidEscrowSubaccount(bidder, bidId)`, `getOfferCreationPaymentSubaccount(user)`), all free queries. EXT NFTs are escrowed at the hex account id `getOfferEscrowAccountId(creator, offerId)`.

## Authentication

Calls are authorised by the signing principal. The creator manages an offer; the bidder manages a bid; the winner claims assets; anyone may call `processExpiration`, `settleOffer` and `retryRefund` (they pay only the recorded recipients). Nothing is anonymous or hidden: offers, bids, bidders, amounts and `approved_bidders` are public. Private offers restrict who may bid, they do not hide the offer. Only `note_to_buyer` is withheld (shown to the creator and, after completion, the winner); it is stored unencrypted, so no secrets. Admin methods are for controllers and `config.admins`.

## Fees, transfers and irreversible actions

- **Creation fee (ICP):** `createOffer` charges `getEffectiveOfferCreationFee(user)` (update call; lower or zero for Sneed Premium members) from the ICP deposited at the payment subaccount, and it is not refunded on cancel. Special prices (https://app.sneeddao.com/api-docs/sneedex.md section 4.4) may lower it for Sneedex admins (people only) and for named partners: the lowest applicable price is charged. Leftover deposit can be taken back with `withdrawOfferCreationPayment`.
- **Marketplace cut:** each offer records `fee_rate_bps` at creation (`getMarketplaceFeeRate`, `getFeeConfig`; the lowest of regular, premium, admin and partner `auction_cut_bps`, see `get_special_prices_for(principal)`; `get_offer_price_tiers(offerId)` says which tier applied); at payout the cut goes to the fee recipient and the seller gets `bid - cut - ledger fee`.
- **Ledger fees** come out of escrows: ICRC-1 assets are delivered as balance minus one fee (deposit `amount + fee`), refunds are `amount - fee`, `withdrawBidEscrow` pays the fee on top.
- **Escrow is a real hand-over:** `escrowCanister` makes Sneedex the canister's only controller (staking/trading bots also lose their botkeys and hotkeys during the sale); `escrowSNSNeuron` removes every other principal's neuron permissions; tokens, NFTs and locks move to Sneedex.
- **Irreversible:** settlement (`confirmBid` at the buyout price, `acceptBid`, `processExpiration` with bids) gives every asset to the winner and the payment to the seller; after a bid is confirmed, `withdrawBidEscrow` can only take the excess above `bid.amount`, and never from a `Won` bid. `createOffer` is not idempotent (two calls = two drafts, two fees).

## Asynchronous lifecycle and polling

- Offer: `createOffer` (Draft) -> `addAsset` per asset -> `finalizeAssets` (PendingEscrow) -> deposit/approve/transfer each asset and call its `escrow*` method -> `activateOffer` (Active) -> Completed -> Claimed; or Expired / Cancelled -> Reclaimed.
- Bid: `reserveBid` -> send the price token to the bid escrow subaccount -> `confirmBid(bidId, amount)`. Outbid bids are refunded automatically about a second later.
- After completion, timers deliver assets (about 2 s) and pay the seller (about 3 s). Poll `getOfferView` / `queryOffer` for `Claimed` and `queryBid` for `ClaimedBySeller`; if they do not come within a minute, call `claimAssets` / `claimWinningBid`, or `settleOffer(offerId)` (anyone). A recurring timer (hourly on production) settles expired offers, unfinished settlements and unrefunded lost bids.

## Errors, retries and Busy

- `InvalidState(\"An escrow operation is already in progress for this bid\")` or `\"A hand-over of this offer's assets is already in progress...\"`: retry after a few seconds.
- `escrow*` methods are safe to repeat. After `TransferFailed`, `claimAssets`, `reclaimAssets` and `claimWinningBid` are meant to be called again; they only redo what failed and never deliver twice.
- After a timeout, re-read (`getOffersByCreator`, `queryBid`, `getOfferView`) before retrying `createOffer` or sending tokens.

## Common pitfalls

- Query methods only answer query calls: the ingress guard refuses a query sent as an update call.
- Arguments are capped: 4 KiB for most methods; `createOffer` at most 200 approved bidders and 4,000-character notes; `addAsset` at most 50 NFT ids, 100-character title, 4,000-character description.
- Each `reserveBid` creates a new bid id with its own escrow subaccount (at most 10 unconfirmed per offer, 50 in all): send tokens only to the one you confirm. Recover unconfirmed deposits with `withdrawBidEscrow`.
- `getBidEscrowBalance`, `getUserOfferCreationBalance` and `getEffectiveOfferCreationFee` are update calls.
- EXT NFTs (asset `EXTNFT { collection_canister_id; token_indices : vec nat32 }`): you can only list cards your default account holds. After `finalizeAssets`, send each card with the collection's `transfer` to `to = variant { address = getOfferEscrowAccountId(...) }` (the account id, not Sneedex's principal, which would be its default account), then call `escrowEXTNFTs(offerId, assetIndex)`.
- Locks listed must stay locked past the offer's `expiration`; token locks need gas to be delivered.
- `getOfferFeed` pages hold at most 100 offers: follow `next_start_id` while `has_more`.
- Per-caller rate limits (`getRateLimits`) on `createOffer`, `reserveBid`, `confirmBid`, `cancelOffer`: once spent, calls are refused at ingress for a while.

## Activity log (ICRC-3)

Every market action is a block in a hash-chained, certified ICRC-3 log: offers, escrow, bids, each asset handed over, cuts and seller payments, refunds, creation fees and admin changes (block types `sneedex_*`, documented at https://app.sneeddao.com/api/sneedex#block-types). Read `icrc3_get_blocks` (follow `archived_blocks` callbacks into the archives) and verify `icrc3_get_tip_certificate`. Transfers name their ledger block (`ledger_tx`); automatic steps carry `via = \"timer\"` instead of `caller`. Support lookups: `getBidsByBidderAll(p)` (reservations included), `getSettlement(offerId)`, `getCreationFeePaymentsFor(p, before, limit)`, `getCutPaymentsFor(p, before, limit)`, and `getSupportLog(before, limit)` / `getSupportLogFor(p)` for background errors and admin interventions.

## Start with these methods

`getOfferFeed`, `getOfferView`, `queryOffer`, `queryBid`, `getFeeConfig`, `getEffectiveOfferCreationFee`, `getOfferCreationPaymentSubaccount`, `createOffer`, `addAsset`, `reserveBid`, `getBidEscrowSubaccount`, `confirmBid`, `claimAssets`, `getConfig`, `icrc3_get_blocks`.

## Full reference

- https://app.sneeddao.com/api-docs/sneedex.md
- Candid: https://app.sneeddao.com/api-docs/sneedex.did
- All Sneed APIs: https://app.sneeddao.com/llms.txt
";
};
