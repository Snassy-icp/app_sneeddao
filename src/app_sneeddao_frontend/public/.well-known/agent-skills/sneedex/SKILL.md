---
name: sneedex
description: Integrate Sneedex, Sneed DAO's on-chain escrow marketplace on the Internet Computer (7bvk3-ryaaa-aaaal-qtykq-cai), where canisters (including Sneed staking and trading bots), SNS neurons, ICRC-1 tokens, ICRC-7 NFTs, EXT NFTs (e.g. Sneed Diamond Club cards) and Sneed Lock locks are sold by auction or buyout for any ICRC-1 token. Use when a user or developer wants to list an asset, bid, buy out, accept a bid, claim, reclaim or refund on Sneedex, read offers and bids, audit the market through its ICRC-3 log, or understand how Sneedex escrow works.
license: MIT
metadata:
  publisher: Sneed DAO
  canister: 7bvk3-ryaaa-aaaal-qtykq-cai
  staging-canister: igm46-laaaa-aaaae-qgwra-cai
  full-reference: https://app.sneeddao.com/api-docs/sneedex.md
  source: https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneedex
---

# Sneedex integration skill

Sneedex is an escrow marketplace. A seller puts one or more assets into escrow in the canister, sets a price token and a buyout price and/or an expiration (auction), and Sneedex hands the assets to the winning bidder and the payment to the seller. Every call is authorised by the calling principal; there is no off-chain matching. Full reference (every method, error, type): https://app.sneeddao.com/api-docs/sneedex.md. Candid: `src/declarations/sneedex/sneedex.did` in the repo.

Canisters: production `7bvk3-ryaaa-aaaal-qtykq-cai`, staging `igm46-laaaa-aaaae-qgwra-cai` (same code, separate state; real tokens on both). ICP ledger `ryjl3-tyaaa-aaaaa-aaaba-cai` (fee 10_000 e8s).

## Core facts to keep straight

1. **Asset kinds** (`getAssetTypes()`): `Canister` (0), `SNSNeuron` (1), `ICRC1Token` (2), `ICRC7NFT` (3), `SneedLock` (4), `EXTNFT` (5, `{collection_canister_id; token_indices : vec nat32}`). Canister kinds (`getCanisterKinds()`): 0 Unknown, 1 ICP Staking Bot, 2 Trading Bot. Up to `getConfig().max_assets_per_offer` (default 10) assets per offer; at most 50 token ids / indices per NFT asset. Older Candid bindings cannot decode offers with `EXTNFT` assets: use the current `sneedex.did`.
2. **Offer lifecycle** (`OfferState`): `Draft` (add assets) → `finalizeAssets` → `PendingEscrow` (escrow each asset) → `activateOffer` → `Active` (bids) → `Completed{winning_bid_id}` → `Claimed`; or `Expired` / `Cancelled` → `Reclaimed`. Only the creator manages the offer.
3. **An offer needs a buyout price or an expiration** (`OfferMustHaveBuyoutOrExpiration`). Expiration is `int` nanoseconds since epoch and must be at least `config.min_offer_duration_ns` (default 1 hour) ahead. `min_bid_price`, if set, is > 0 and ≤ buyout; without it the minimum bid is the buyout. All prices are base units of `price_token_ledger`.
4. **Escrow is per-offer subaccount of Sneedex.** Never compute subaccounts; ask `getOfferEscrowSubaccount(creator, offerId)`, `getBidEscrowSubaccount(bidder, bidId)`, `getOfferCreationPaymentSubaccount(user)`.
5. **Fees.** Offer creation fee in ICP: `getEffectiveOfferCreationFee(P)` (lower or zero for Sneed Premium members); deposit it to `{owner: sneedex, subaccount: getOfferCreationPaymentSubaccount(P)}` before `createOffer`, else `InsufficientFunds`. Leftover: `withdrawOfferCreationPayment()`. Marketplace cut: `fee_rate_bps` is locked into the offer at creation (premium rate if the creator is premium) and taken from the winning bid; a cut not above one ledger fee is not taken. `getFeeConfig()` returns the current rates.
6. **Bids escrow tokens first.** `reserveBid` gives a bid id, the bidder sends tokens to that bid's subaccount, `confirmBid(bidId, amount)` checks the balance. A bid ≥ buyout is capped at the buyout and completes the offer at once (excess refunded). Each new bid must beat the highest by `min_bid_increment_fee_multiple × price-ledger fee` (default 1 base unit), else `BidIncrementTooSmall{minimum_next}`.
7. **Settlement is automatic, with manual fallbacks.** On completion Sneedex schedules delivery to buyer and seller and refunds losing bids by timer. If something did not arrive: buyer `claimAssets(offerId)`, seller `claimWinningBid(offerId)`, loser `refundBid(bidId)`, seller after expiry/cancel `reclaimAssets(offerId)`.
8. **`processExpiration(offerId)` is permissionless**: after the expiration it completes the offer with the highest bid, or marks it `Expired` and returns the assets. While the expiration timer runs (`isExpirationTimerRunning()`), Sneedex also does this itself.
9. **Private offers**: `approved_bidders = [vec principal]`; only those (and the creator) can bid; they are notified on activation. Public offers have `approved_bidders = null`.
10. **`cancelOffer`** works in Draft, PendingEscrow and Active; confirmed bids are marked Lost and refunded, assets return to the seller.
11. **`note_to_buyer`** is visible only to the creator and, once won, the winning bidder; `public_note` to everyone. Max 4000 chars each.
12. **Every market action is logged as an ICRC-3 block** (`btype` prefixed `sneedex_`, hash-chained via `phash`, tip certified): offers, escrow, bids, each asset handed over, cuts, seller payments, refunds, creation fees, admin changes. Transfers carry their ledger block (`ledger_tx` / `icp_tx`); timer-driven steps have `via = "timer"` instead of `caller`. `note_to_buyer` is never logged. The log starts with the release that added it (no import of older offers). Catalogue: https://app.sneeddao.com/api-docs/sneedex.md section 8.

## Procedures

### List an asset (seller P)
1. Pay the creation fee (fact 5) if `getEffectiveOfferCreationFee(P) > 0`.
2. `createOffer({price_token_ledger, buyout_price, min_bid_price, expiration, min_bid_increment_fee_multiple, approved_bidders, public_note, note_to_buyer})` → `ok(offerId)`.
3. `addAsset({offer_id, asset})` per asset (Draft only; duplicates refused). Then `finalizeAssets(offerId)`.
4. Escrow each asset by index (`assetIndex` = position in `offer.assets`):
   - **ICRC-1 tokens**: `icrc1_transfer` `amount + ledger fee` to `{owner: sneedex, subaccount: getOfferEscrowSubaccount(P, offerId)}`, then `escrowICRC1Tokens(offerId, i)` (needs balance ≥ amount; the buyer later receives the escrow balance less one fee).
   - **Canister**: add Sneedex as a controller (P must be a controller too), then `escrowCanister(offerId, i)`. Sneedex becomes the sole controller and keeps a snapshot of the old controllers for a reclaim. For staking and trading bots it also snapshots and clears their bot permissions (restored on a reclaim; a buyer gets the bot clean).
   - **SNS neuron**: give Sneedex full owner permissions on the neuron (P must have them), then `escrowSNSNeuron(offerId, i)`. Sneedex removes every other principal's permissions and records them for a reclaim.
   - **ICRC-7 NFTs**: either `icrc7_transfer` each token to the offer escrow subaccount and call `escrowICRC7NFTs(offerId, i)`, or approve Sneedex via ICRC-37 and call `escrowICRC7NFTsByApproval(offerId, i)` (Sneedex pulls them). Verified with `icrc7_owner_of`. A collection that ignores `to.subaccount` will not work; test with a self-transfer first.
   - **EXT NFTs** (`#EXTNFT`): at `addAsset` every card must be held by P's default account (`bearer(tokenIdentifier) == accountId(P)`) or already be in the offer's escrow account. Get the escrow account id with `getOfferEscrowAccountId(P, offerId)`, then call the collection's `transfer({from: {principal: P}, to: {address: escrowAid}, token: tid, amount: 1, memo: [], notify: false, subaccount: []})` per card, then `escrowEXTNFTs(offerId, i)` (checks `bearer == escrowAid`). Send to the account id (`address`), never to Sneedex's principal (that is its default account; only an admin can return a card from there). Delivery uses `from = address(escrowAid)` with `subaccount = escrow subaccount` and is recorded only once `bearer` shows the buyer.
   - **Sneed Lock lock** (`#SneedLock{lock_id, lock}`; `addAsset` re-reads the lock and refuses one that is not P's, expired, or expires before the offer): move ownership to Sneedex in Sneed Lock (`transfer_token_lock_ownership(sneedex, ledger, lockId)` or `transfer_position_ownership(sneedex, pool, positionId)`), then `escrowSneedLock(offerId, i)`. For a token lock Sneedex needs one ledger fee free in its own Sneed Lock wallet (`{owner: sneed_lock, subaccount: principalToSubAccount(sneedex)}`); anyone may send it. Sneed Lock lock NFTs can also be listed as an `ICRC7NFT` asset of collection `pqsms-lqaaa-aaaal-ajjza-cai` (same expiry rule; a token lock's gas tank must hold 2 fees).
5. `activateOffer(offerId)` once every `assets[i].escrowed` is true.

### Bid or buy out (bidder B)
1. `queryOffer(offerId)` / `getOfferView(offerId)` → state Active, price ledger, highest bid.
2. `reserveBid(offerId)` → `ok(bidId)`; `sub = getBidEscrowSubaccount(B, bidId)`.
3. `icrc1_transfer` exactly the bid amount to `{owner: sneedex, subaccount: sub}` (ledger fee paid on top by B).
4. `confirmBid(bidId, amount)`. Errors: `BidTooLow{minimum}`, `BidIncrementTooSmall{...}`, `OfferExpired`, `InvalidState`.
5. Before confirming B may take funds back with `withdrawBidEscrow(bidId, amount)`; after confirming only the excess above bid + one fee. `getBidEscrowBalance(bidId)` shows the balance.

### Seller decisions
`acceptBid(offerId)` completes with the current highest bid before expiry. `cancelOffer(offerId)` (fact 10).

### Audit the history (ICRC-3 activity log)
- `icrc3_log_status()` → `log_length`, archives. `icrc3_get_blocks([{start; length}])` → live blocks plus `archived_blocks` callbacks for older ranges (max 1000 blocks per response).
- Verify `icrc3_get_tip_certificate` and walk `phash` (the verifier script in the Sneed Lock reference, section 8.4, works with Sneedex's canister id). History of an offer: blocks whose `tx.offer_id` matches.

### Read state
- `getOfferFeed({start_id, length, filter: [{states, asset_types, creator, has_bids, public_only, viewer}]})` → `{offers, has_more, next_start_id}`, newest first; continue with `start_id = next_start_id`.
- `getPublicOffers()`, `getActiveOffers()`, `getOffersByCreator(P)`, `getPrivateOffersFor(P)`, `getBidsByBidder(P)`, `queryBid(bidId)`, `getMarketStats()`, `getPaymentStats()`.
- Escrowed bots: `getNeuronManagerInfo(canister)` (cached `getCachedNeuronManagerInfoQuery`), `getCanisterInfo(offerId, i)`.
- Notification preferences (via Sneed SMS): `getMyNotificationSettings()` / `setMyNotificationSettings(...)`.

## Minimal JavaScript setup

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory } from './sneedex.did.js'; // src/declarations/sneedex/sneedex.did.js

const SNEEDEX = Principal.fromText('7bvk3-ryaaa-aaaal-qtykq-cai');
const agent = await HttpAgent.create({ identity, host: 'https://icp-api.io' });
const sneedex = Actor.createActor(idlFactory, { agent, canisterId: SNEEDEX });
const feed = await sneedex.getOfferFeed({ start_id: [], length: 20n, filter: [{ states: [[{ Active: null }]], asset_types: [], creator: [], has_bids: [], public_only: [true], viewer: [] }] });
```

## dfx examples

```bash
dfx canister --network ic call 7bvk3-ryaaa-aaaal-qtykq-cai getOfferFeed '(record { start_id = null; length = 20 : nat; filter = opt record { states = opt vec { variant { Active } }; asset_types = null; creator = null; has_bids = null; public_only = opt true; viewer = null } })' --query
dfx canister --network ic call 7bvk3-ryaaa-aaaal-qtykq-cai getOfferView '(1 : nat)' --query
dfx canister --network ic call 7bvk3-ryaaa-aaaal-qtykq-cai getFeeConfig '()' --query
```

## In Sneed Hub

Marketplace https://app.sneeddao.com/sneedex, browse https://app.sneeddao.com/sneedex_offers, one offer https://app.sneeddao.com/sneedex_offer/<offerId>, create wizard https://app.sneeddao.com/sneedex_create (does the escrow steps above, including the NFT self-transfer test and Sneed Lock fee funding), your offers and bids https://app.sneeddao.com/sneedex_my, help https://app.sneeddao.com/help/sneedex. Reference implementation: `src/app_sneeddao_frontend/src/pages/SneedexCreate.jsx` and `SneedexOffer.jsx`.
