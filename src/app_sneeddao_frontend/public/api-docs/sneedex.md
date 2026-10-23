# Sneedex canister API

Sneedex is the escrow marketplace of Sneed DAO on the Internet Computer. A seller bundles one or more assets into an **offer**: canisters, SNS neurons, ICRC-1 tokens, ICRC-7 NFTs, EXT NFTs (e.g. Sneed Diamond Club cards) and Sneed Lock locks. Sneedex takes them into escrow, buyers bid in one ICRC-1 token, and when the offer settles every asset changes hands at once, by a single state change. Auctions (minimum bid, optional buyout, expiry), fixed-price listings (buyout only) and private offers (a list of approved bidders) are all the same offer with different settings. The canister authorises calls by the calling principal only, so any wallet, dashboard or script can list, bid and settle for its users without asking Sneed DAO first.

| | |
|---|---|
| Production canister | `7bvk3-ryaaa-aaaal-qtykq-cai` |
| Staging canister | `igm46-laaaa-aaaae-qgwra-cai` (separate state, same code line; its Sneed Lock is the staging Sneed Lock `25fsc-7yaaa-aaaal-qjt5q-cai`) |
| Candid interface | [sneedex.did](/api-docs/sneedex.did) · [JavaScript IDL factory](/api-docs/sneedex.did.js) |
| Source | [src/sneedex/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneedex/main.mo) · [Types.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneedex/Types.mo) · [AssetHandlers.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneedex/AssetHandlers.mo) · [Utils.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneedex/Utils.mo) |
| Reference frontend | [app.sneeddao.com/sneedex](https://app.sneeddao.com/sneedex) ([source](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend)) |
| This document | [rendered](/api/sneedex) · [raw Markdown](/api-docs/sneedex.md) |

The production canister is controlled by the Sneed SNS (root `fp274-iaaaa-aaaaq-aacha-cai`); upgrades are decided by Sneed DAO proposals. The method set below matches the source on `main` and the deployed canisters.

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister (units and encoding, authentication, fees, transfers and irreversible actions, asynchronous flows and polling, common pitfalls) that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 Offers, assets, bids

- An **offer** (`OfferId`, a global counter from 0) has one creator (the seller), a list of assets, a **price token** (`price_token_ledger`, any ICRC-1 ledger), and up to three price terms: `min_bid_price`, `buyout_price`, `expiration`.
- An **asset entry** is `{ asset; escrowed : bool }`. Assets are addressed by their index in `offer.assets` (`assetIndex`, from 0, in the order they were added).
- A **bid** (`BidId`, a second global counter) belongs to one bidder and one offer. A bid is first *reserved* (an id, so the bidder knows where to send tokens), then *confirmed* once the tokens sit in the bid's escrow subaccount.

Price rules (checked by `createOffer`):

| Setting | Meaning |
|---|---|
| `buyout_price` or `expiration` | At least one of them must be set (`OfferMustHaveBuyoutOrExpiration`). |
| `min_bid_price` | Lowest acceptable bid. Must be > 0 when set and ≤ `buyout_price`. When unset, the buyout price is the minimum, so the offer is a fixed-price listing. |
| `buyout_price` | A confirmed bid of at least this amount ends the offer immediately; bids above it are capped at it and the excess is refunded. |
| `expiration` | When the offer ends. With bids, the highest wins; without, the offer expires and the assets go back. Must be at least `config.min_offer_duration_ns` in the future (one hour on production). |
| `min_bid_increment_fee_multiple` | Each new bid must beat the highest by `multiple × price-ledger fee`. When unset the increment is 1 base unit. |
| `approved_bidders` | When set, only these principals (and the creator) may reserve bids: a private offer. |

| Shape | Settings |
|---|---|
| English auction | `min_bid_price`, `expiration`, optional `buyout_price` |
| Fixed price ("buy now") | `buyout_price` only, optional `expiration` |
| Auction without an end time | `min_bid_price` + `buyout_price`, no `expiration` (ends by buyout, accept or cancel) |

### 1.2 Offer states

```
Draft ──finalizeAssets──▶ PendingEscrow ──activateOffer──▶ Active
  │                            │                             │
  │                            │            buyout / acceptBid / expiry with bids
  │                            │                             ▼
  │                            │                  Completed { winning_bid_id } ──assets delivered──▶ Claimed
  │                            │                             │
  │                            │                    expiry without bids
  │                            │                             ▼
  └─────────cancelOffer────────┴──────cancelOffer──────▶ Cancelled / Expired ──assets returned──▶ Reclaimed
```

| State | Who can do what |
|---|---|
| `Draft` | Creator adds assets (`addAsset`), then `finalizeAssets`. |
| `PendingEscrow` | Creator escrows each asset (`escrow*`), then `activateOffer`. |
| `Active` | Anyone allowed reserves and confirms bids. Creator may `acceptBid` or `cancelOffer`. Anyone may `processExpiration` after the expiry. |
| `Completed` | The winner is fixed. Assets go to the winner, payment to the seller (automatically, else `claimAssets` / `claimWinningBid`). The offer stays `Completed` until every asset has been delivered. |
| `Claimed` | Every asset has been delivered to the winner. The seller can still `claimWinningBid` if the payment has not gone out. |
| `Expired`, `Cancelled` | The escrowed assets go back to the seller (automatically, else `reclaimAssets`). The offer stays here until every escrowed asset is back. |
| `Reclaimed` | Final: every escrowed asset is back with the seller. |

State changes that move ownership (`Active → Completed`, `Active → Expired`, `→ Cancelled`) are a single write with no `await` in between, so every asset of an offer changes hands together: the winner owns all of them or none.

### 1.3 Bid states

| State | Meaning |
|---|---|
| `Pending` | Reserved (`tokens_escrowed = false`, `amount = 0`) or confirmed and still in the race (`tokens_escrowed = true`). |
| `Lost` | Outbid, or the offer ended or was cancelled. Confirmed lost bids are refunded automatically one second later; `refundBid` does it by hand. |
| `Refunded` | Refunded (bid amount less one ledger fee). |
| `Won` | The winning bid. Its escrow pays the seller. |
| `ClaimedBySeller` | The seller has been paid. |

### 1.4 Escrow accounts

Sneedex holds tokens in subaccounts of its own principal. All three use the same 32-byte layout: byte 0 is the length of the principal's bytes, bytes 1..n are those bytes, byte 23 is a type marker, bytes 24..31 an id as a big-endian `u64` (zero for payments).

| Account | Owner and subaccount | Marker | Ask the canister |
|---|---|---|---|
| Offer escrow | Sneedex, `(creator, offer_id)` | `0x4F` (`O`) | `getOfferEscrowSubaccount(creator, offerId)` |
| Bid escrow | Sneedex, `(bidder, bid_id)` | `0x42` (`B`) | `getBidEscrowSubaccount(bidder, bidId)` |
| Creation-fee payment | Sneedex, `(user)` | `0x50` (`P`) | `getOfferCreationPaymentSubaccount(user)` |

Prefer asking the canister (all three are free queries) over computing them.

EXT collections know holders only as ICP-style **account identifiers** (64 hex characters). The offer escrow as an account id, where EXT NFTs are escrowed, is `getOfferEscrowAccountId(creator, offerId)` (free query): the account id of Sneedex's principal with the offer escrow subaccount.

### 1.5 Time and amounts

- `expiration`, `created_at`, `activated_at` and `completion_time` are `int` nanoseconds since the Unix epoch (Motoko `Time.now()`, JavaScript `BigInt(Date.now()) * 1_000_000n`). Log timestamps (`Timestamp`) are `nat64` ns. Sneed Lock expiries inside a `SneedLock` asset are `nat64` ns.
- All amounts are base units of their ledger as `nat` (`e8s` for ICP). Creation fees are ICP e8s as `nat64`. Rates are basis points (100 = 1%).

### 1.6 Private offers are restricted, not hidden

`approved_bidders` restricts who may bid. It does not hide the offer: every offer, including its `approved_bidders` list, can be read by anyone with `queryOffer`, `getOfferFeed`, `getPrivateOffersFor(any principal)` or `debugGetAllOffers`. Bids, bidders and amounts are public too. The only field that queries withhold is `note_to_buyer`, which is returned to the creator and, once the offer is `Completed` or `Claimed`, to the winning bidder; everyone else gets `null`. It is stored in canister state, not encrypted, so do not put secrets in it.

### 1.7 Calls the canister refuses at ingress

Before it accepts an update call from outside the IC the canister checks it (`inspect_message`); a refused call costs nobody anything:

- **Query methods only answer query calls.** Calling one as an update call is refused. Use the generated declarations, or `--query` with dfx.
- **Arguments are capped.** `createOffer`: at most 200 `approved_bidders`, each note at most 4,000 characters. `addAsset`: canister title at most 100 and description at most 4,000 characters, at most 50 NFT token ids. Every other method: 4 KiB of argument. `addAssetType` and `updateConfig` are refused at ingress for non-admins.
- **Rate limits.** `createOffer`, `reserveBid`, `confirmBid` and `cancelOffer` are limited per caller with a token bucket: by default 100 `createOffer` and 100 `cancelOffer` calls at once, and 60 `reserveBid` and 60 `confirmBid` calls at once, each refilled at 20 a minute. A caller whose bucket is empty is refused at ingress; a call that reaches the method anyway (from another canister) gets `InvalidState("Rate limited: ...")`. `getRateLimits()` answers the rules in force; admins change them with `setRateLimit` (6.6). The buckets live in memory and are full again after an upgrade.

Canisters calling Sneedex are not affected; the check only applies to calls from outside the IC.

---

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './sneedex.did.js'; // https://app.sneeddao.com/api-docs/sneedex.did.js

const SNEEDEX = '7bvk3-ryaaa-aaaal-qtykq-cai';

export function sneedexActor(identity) {
  const agent = HttpAgent.createSync({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId: SNEEDEX });
}

// Sneedex returns variant { ok; err : SneedexError }
export function unwrap(r) {
  if ('err' in r) throw new Error(JSON.stringify(r.err, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  return r.ok;
}
```

With dfx:

```bash
dfx canister --network ic call 7bvk3-ryaaa-aaaal-qtykq-cai getOfferFeed '(record { start_id = null; length = 20; filter = opt record { states = opt vec { variant { Active } }; asset_types = null; creator = null; has_bids = null; public_only = opt true; viewer = null } })' --query
```

### 2.2 Browse offers

```js
async function activePublicOffers(sneedex, pageSize = 50n) {
  const out = [];
  let start = [];                         // opt OfferId: none = newest first
  for (;;) {
    const page = await sneedex.getOfferFeed({
      start_id: start,
      length: pageSize,
      filter: [{ states: [[{ Active: null }]], asset_types: [], creator: [], has_bids: [], public_only: [true], viewer: [] }],
    });
    out.push(...page.offers);
    if (!page.has_more) return out;
    start = page.next_start_id;            // exclusive: the next page has smaller ids
  }
}

// One offer with its confirmed bids and the current highest bid
const [view] = await sneedex.getOfferView(42n);   // [] when there is no such offer
```

### 2.3 Sell ICRC-1 tokens for a fixed price, end to end

```js
import { Principal } from '@dfinity/principal';

async function listTokens({ identity, sneedex, icpLedger, tokenLedger, tokenLedgerId, amount, priceLedgerId, price }) {
  const me = identity.getPrincipal();
  const SNEEDEX_P = Principal.fromText(SNEEDEX);

  // 0. Creation fee (ICP), if any: deposit it into my payment subaccount on Sneedex
  const fee = await sneedex.getEffectiveOfferCreationFee(me);          // update call; nat64 e8s
  if (fee > 0n) {
    const paySub = await sneedex.getOfferCreationPaymentSubaccount(me);
    const have = await sneedex.getUserOfferCreationBalance(me);
    if (have < fee) {
      const r = await icpLedger.icrc1_transfer({ to: { owner: SNEEDEX_P, subaccount: [paySub] }, amount: fee - have,
        fee: [], memo: [], from_subaccount: [], created_at_time: [] });
      if ('Err' in r) throw new Error(JSON.stringify(r.Err));
    }
  }

  // 1. Draft: price terms (buyout only = fixed price), no expiry
  const offerId = unwrap(await sneedex.createOffer({
    price_token_ledger: Principal.fromText(priceLedgerId),
    buyout_price: [price], min_bid_price: [], expiration: [],
    min_bid_increment_fee_multiple: [], approved_bidders: [],
    public_note: ['200 tokens, fixed price'], note_to_buyer: [],
  }));

  // 2. Declare the asset and close the list
  unwrap(await sneedex.addAsset({ offer_id: offerId, asset: { ICRC1Token: { ledger_canister_id: Principal.fromText(tokenLedgerId), amount } } }));
  unwrap(await sneedex.finalizeAssets(offerId));

  // 3. Escrow: send the tokens to the offer's escrow subaccount, then let Sneedex verify.
  //    The buyer later receives the subaccount's balance less one ledger fee, so add one fee.
  const sub = await sneedex.getOfferEscrowSubaccount(me, offerId);
  const ledgerFee = await tokenLedger.icrc1_fee();
  const t = await tokenLedger.icrc1_transfer({ to: { owner: SNEEDEX_P, subaccount: [sub] }, amount: amount + ledgerFee,
    fee: [], memo: [], from_subaccount: [], created_at_time: [] });
  if ('Err' in t) throw new Error(JSON.stringify(t.Err));
  unwrap(await sneedex.escrowICRC1Tokens(offerId, 0n));

  // 4. Go live
  unwrap(await sneedex.activateOffer(offerId));
  return offerId;
}
```

### 2.4 Bid, end to end

```js
async function placeBid({ identity, sneedex, priceLedger, offerId, amount }) {
  const me = identity.getPrincipal();

  // 1. Reserve a bid id; it names the escrow subaccount
  const bidId = unwrap(await sneedex.reserveBid(offerId));
  const sub = await sneedex.getBidEscrowSubaccount(me, bidId);

  // 2. Send exactly the bid amount there (your wallet pays the transfer fee)
  const t = await priceLedger.icrc1_transfer({ to: { owner: Principal.fromText(SNEEDEX), subaccount: [sub] }, amount,
    fee: [], memo: [], from_subaccount: [], created_at_time: [] });
  if ('Err' in t) throw new Error(JSON.stringify(t.Err));

  // 3. Confirm. A bid at or above the buyout price completes the offer right here.
  const r = await sneedex.confirmBid(bidId, amount);
  if ('err' in r) {
    // The tokens stay in the bid escrow; get them back with withdrawBidEscrow (section 3.6)
    throw new Error(JSON.stringify(r.err, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  }
  return bidId;
}
```

After a win the assets arrive by themselves about two seconds after completion (section 3.7). Poll `queryOffer(offerId)` until the state is `Claimed`, or call `claimAssets(offerId)` yourself.

---

## 3. Flows in detail

### 3.1 Creating an offer

1. **`createOffer(CreateOfferRequest)`** validates the price terms and notes, charges the creation fee (section 4.1), locks in the marketplace cut for this offer (`fee_rate_bps`: the premium rate if the creator is a Sneed Premium member and a premium rate is set, else the regular rate), and stores a `Draft`. Returns `ok(offerId)`. `price_token_ledger` is not checked; make sure it is a working ICRC-1 ledger.
2. **`addAsset({ offer_id; asset })`**, once per asset, while `Draft` (section 3.2 has the per-type rules). At most `config.max_assets_per_offer` (10 on production). The same asset cannot be listed twice in one offer: one canister, one neuron, one entry per ICRC-1 ledger, no overlapping NFT token ids, one entry per lock id.
3. **`finalizeAssets(offerId)`** closes the asset list (`Draft → PendingEscrow`). At least one asset is required.
4. Escrow every asset (section 3.2).
5. **`activateOffer(offerId)`**: all assets must be escrowed and the expiry not passed. Records `activated_at`, schedules a background read of neuron stakes for display (`cached_stake_e8s`, `cached_total_stake_e8s`), and sends private-offer invitations (section 3.10).

A draft or pending offer can be abandoned with `cancelOffer`; anything already escrowed is returned. The creation fee is not refunded.

### 3.2 Escrowing each asset type

Every `escrow*` method takes `(offerId, assetIndex)`, may only be called by the creator while the offer is `PendingEscrow`, and fails with `Asset index out of bounds`, `Asset already escrowed`, or `Asset at index is not a …` when used on the wrong entry. They are safe to call again after an error.

#### Canister (`Canister`, asset type 0)

```js
{ Canister: { canister_id, canister_kind: [], title: ['My app'], description: [],
              controllers_snapshot: [], cached_total_stake_e8s: [] } }
```

1. Add Sneedex as a **controller** of the canister (keep yourself; `dfx canister update-settings --add-controller 7bvk3-ryaaa-aaaal-qtykq-cai <canister>`).
2. Call `escrowCanister(offerId, i)`. Sneedex reads the canister status, checks that both the caller and Sneedex are controllers, records the other controllers in `controllers_snapshot`, and makes itself the only controller.

Errors (`CanisterError`): `Caller is not a controller of the canister`, `Sneedex canister is not a controller. Please add it first.`, `Failed to get canister status. Ensure you are a controller.`, `Failed to update canister controllers`; `InvalidAsset("This canister is already escrowed in another offer")`. At `addAsset` a title over 100 or a description over 4,000 characters is refused.

On delivery the buyer becomes the canister's only controller. On a return the snapshot is restored.

`canister_kind` marks known Sneed app canisters (`getCanisterKinds()`): `0` unknown, `1` ICP Staking Bot (ICP neuron manager), `2` Trading Bot. Use `verifyICPNeuronManager(canister)` / `verifyTradingBot(canister)` to check a canister answers like one (they call its `getVersion()`). For kinds 1 and 2 Sneedex, one second after escrow, snapshots and clears the bot's botkeys (and, for a staking bot, every neuron's hotkeys), so the seller keeps no hidden access during the sale. A buyer receives the canister clean; on a return the snapshot is put back before the controllers are restored. Escrowed and delivered canisters are also deregistered from the seller's and registered in the buyer's Sneed wallet (best effort).

#### SNS neuron (`SNSNeuron`, asset type 1)

```js
{ SNSNeuron: { governance_canister_id, neuron_id: { id: neuronIdBytes }, hotkeys_snapshot: [], cached_stake_e8s: [] } }
```

1. Give Sneedex **full owner permissions** on the neuron (all of permissions 1 to 10: configure dissolve state, manage principals, submit proposal, vote, disburse, split, merge maturity, disburse maturity, stake maturity, manage voting permission) with the SNS governance's `AddNeuronPermissions`.
2. Call `escrowSNSNeuron(offerId, i)`. Sneedex checks that both the caller and Sneedex hold full owner permissions, removes every other principal's permissions (exactly the ones each had), records the principals in `hotkeys_snapshot` and each principal's permissions internally, and verifies that only Sneedex is left. If a removal fails part-way, the permissions already removed are added back, the call returns `GovernanceError("Failed to remove permissions: …")`, and the details go to the support log (op `snsNeuron`), as do Sneedex's own failures to remove itself after a hand-over.

Errors (`GovernanceError`): `Caller does not have owner permissions on the neuron`, `Sneedex canister does not have owner permissions. Please add it as a hotkey first.`, `Neuron not found`, `Failed to query neuron`, `Failed to remove permissions: …`, `Failed to remove permissions from hotkey`, `Failed to fully escrow neuron - other principals still have permissions`, or the governance's own error message.

On delivery the buyer gets full owner permissions and Sneedex removes its own. On a return every principal gets back exactly the permissions it had (for neurons escrowed before permissions were recorded: the creator full owner permissions, everyone else submit-proposal and vote only).

#### ICRC-1 tokens (`ICRC1Token`, asset type 2)

```js
{ ICRC1Token: { ledger_canister_id, amount } }
```

1. Transfer the tokens to `{ owner = Sneedex; subaccount = getOfferEscrowSubaccount(creator, offerId) }`.
2. Call `escrowICRC1Tokens(offerId, i)`. Sneedex checks the subaccount holds at least `amount`.

Errors: `InsufficientFunds { required; available }`, `TransferFailed("Failed to check token balance")`.

On delivery or return Sneedex sends the **whole balance** of that ledger in the offer subaccount, less one ledger fee. Deposit `amount + fee` if the buyer should receive exactly `amount`. Several ledgers share the offer's one escrow subaccount; each is moved separately.

#### ICRC-7 NFTs (`ICRC7NFT`, asset type 3)

```js
{ ICRC7NFT: { collection_canister_id, token_ids: [12n, 13n] } }
```

1 to 50 token ids of one collection per asset, no duplicates. Two ways to escrow:

- **By approval (ICRC-37, preferred where the collection supports it).** Approve Sneedex for each token (`icrc37_approve_tokens`, spender `{ owner = Sneedex; subaccount = null }`) or for the collection, then call `escrowICRC7NFTsByApproval(offerId, i)`. Sneedex pulls the tokens from the creator's default account (`{ owner = creator; subaccount = null }`) into the offer escrow subaccount with `icrc37_transfer_from`. Error when the pull fails: `TransferFailed("Failed to pull NFTs (does the collection implement ICRC-37, and is Sneedex approved?)")` or `TransferFailed("NFT <id>: <reason>")`.
- **By transfer.** `icrc7_transfer` each token to `{ owner = Sneedex; subaccount = getOfferEscrowSubaccount(creator, offerId) }`, then call `escrowICRC7NFTs(offerId, i)`.

Either way Sneedex then checks with `icrc7_owner_of` that every token is in the escrow subaccount: `InvalidAsset("Token <id> is not in the escrow account")`, `InvalidAsset("Token <id> does not exist")`, `TransferFailed("Failed to check NFT owners")`.

A collection that ignores the subaccount on `icrc7_transfer` (not ICRC-7 compliant) would put the token in Sneedex's default account, where no offer can claim it. The reference frontend first moves one token into one of the seller's own subaccounts and checks it landed there before depositing. Tokens stranded that way can only be returned by an admin (`adminReturnMisplacedNft`).

**Sneed Lock NFTs.** Every Sneed Lock lock is an NFT of the Sneed Lock canister's own ICRC-7 collection (see the [Sneed Lock API](/api/sneed_lock), section 3.8). Listing one is the usual way to sell a lock. For tokens of that collection Sneedex also checks, at `addAsset` and again at escrow, that each lock still exists and is still locked, and that it unlocks after the offer's `expiration`: `InvalidAsset("Sneed Lock NFT <id> does not exist (an unlocked lock is no longer an NFT)")`, `… has no current lock`, `Lock <id> has expired`, `Lock <id> unlocks before the offer ends; a lock must outlive the offer`. At escrow a token lock must also be able to pay the ledger fee of its delivery: two fees in its gas tank, or one free fee in Sneedex's own Sneed Lock wallet, else `InvalidAsset("Lock <id> needs gas to be delivered: add at least <n> more of its token to its gas account (anyone can, from the lock or NFT page)")`.

#### EXT NFTs (`EXTNFT`, asset type 5)

```js
{ EXTNFT: { collection_canister_id, token_indices: [7, 42] } }   // vec nat32
```

EXT is the Toniq / Entrepot NFT standard (for example the Sneed Diamond Club, `gjv36-laaaa-aaaah-adyza-cai`). A token is addressed by its index; its TokenIdentifier is the principal-text encoding of `"\x0Atid"` ++ collection bytes ++ the 4-byte big-endian index. A holder is an account identifier. 1 to 50 indices of one collection per asset, none twice. EXT has no common approval flow, so escrow is always by transfer:

1. `createOffer`, then `addAsset`. Sneedex reads `bearer(tokenIdentifier)` for every token: each must be held by the **caller's default account** (`accountId(caller)`), or already sit in this offer's escrow account. Errors: `InvalidAsset("EXT token <i> is not yours: it is held by account <aid>, not by your account <aid>")`, `InvalidAsset("EXT token <i> does not exist in this collection")`, `TransferFailed("Failed to read the holder of EXT token <i> (is this an EXT collection?)")`, `List at least one token index`, `At most 50 tokens of one collection per asset`, `Token index <i> is listed twice`, `An EXT token of this asset is already listed in offer <id>`. A token counts as already listed when another open offer (Draft, PendingEscrow, Active) of the same seller lists it, or when any offer holds it in escrow and has not handed it over yet; a previous holder's stale draft does not block a new holder.
2. `finalizeAssets(offerId)`.
3. `getOfferEscrowAccountId(creator, offerId)`: the escrow account id.
4. For each card, call the **collection's** `transfer`:
   ```candid
   transfer(record { from = variant { principal = <seller> }; to = variant { address = "<escrow account id>" };
                     token = "<tokenIdentifier(collection, index)>"; amount = 1; memo = blob ""; notify = false; subaccount = null })
   ```
   Send to the escrow **account id** (`address`), not to Sneedex's principal: `principal = Sneedex` names Sneedex's default account, where no offer can claim it.
5. `escrowEXTNFTs(offerId, assetIndex)`: Sneedex checks with `bearer` that every token is held by the escrow account id. Errors: `InvalidAsset("EXT token <i> is not in the escrow account <aid> (it is held by account <aid>)")`, `Asset at index is not an EXT NFT`.
6. `activateOffer(offerId)` once every asset is escrowed.

**Delivery.** Sneedex moves each card out of the escrow account with `transfer({ from = variant { address = <escrow account id> }; to = variant { principal = <recipient> }; amount = 1; notify = false; subaccount = opt <escrow subaccount>; … })`. The EXT reference implementation, and the Sneed Diamond Club, take the owner from `from` and the spender from the caller's principal plus `subaccount`, and require both to be the holder; `from = principal Sneedex` would name Sneedex's default account and be refused (`Unauthorized`). This was confirmed on the Diamond Club on mainnet with calls that were refused by design and moved nothing. All calls to the collection are bounded-wait calls; whatever the answer (including a lost one), Sneedex reads `bearer` afterwards and records the card as delivered only once the recipient's default account holds it. A retry moves only the cards still in the escrow account, so no card is sent twice.

**Cancellation and expiry** return escrowed cards to the seller like every other asset. In addition, a card that sits in the escrow account but whose asset was never marked escrowed (sent, but `escrowEXTNFTs` not called before the offer was cancelled or expired) is returned best effort; a block with `escrowed` = 0 records it. A card stranded elsewhere in Sneedex (its default account, or an escrow account no offer holds it for) can only be returned by an admin (`adminReturnMisplacedExtNft`).

#### Sneed Lock by ownership (`SneedLock`, asset type 4)

```js
{ SneedLock: { lock_id, lock: { Token: { ledger_canister_id, amount: 0n, expiry: 0n } } } }
// or { Position: { swap_canister_id, position_id, expiry: 0n } }
```

The other way to sell a lock: Sneedex becomes its owner inside Sneed Lock.

1. `addAsset`: Sneedex reads the lock from Sneed Lock (`get_lock_by_id`) and replaces what you sent with the live record. The lock must belong to the caller and be of the kind and ledger/position you describe. It must not be listed in another open offer, must not have expired, and must outlive the offer's expiry. Errors: `Lock <id> does not exist in Sneed Lock`, `Lock <id> is not yours`, `Lock <id> is not the lock you described`, `Lock <id> is already listed in an open offer`, `Lock <id> has expired`, `The lock expires before the offer does; a lock must outlive the offer`, `TransferFailed("Failed to read the lock from Sneed Lock")`.
2. Transfer the lock's ownership to Sneedex in Sneed Lock: `transfer_token_lock_ownership(SNEEDEX, ledger, lock_id)` (costs one ledger fee from your free Sneed Lock balance) or `transfer_position_ownership(SNEEDEX, pool, position_id)`.
3. `escrowSneedLock(offerId, i)`: Sneedex checks it now owns the lock and that it still matches (same ledger and amount, or same pool and position). For a token lock it also needs one ledger fee free in **its own** Sneed Lock wallet, to pass the lock on later. Anyone can top that up by sending the fee to `{ owner = Sneed Lock; subaccount = principalToSubAccount(SNEEDEX) }`. Errors: `Lock <id> has not been transferred to Sneedex`, `Lock <id> no longer matches the listed asset`, `Sneedex needs <fee> free units of this token in its Sneed Lock wallet to pass the lock on (it has <free>); send the fee to Sneed Lock's subaccount for Sneedex and try again`, `TransferFailed("Failed to read Sneedex's balance in Sneed Lock")`.

On delivery or return Sneedex calls the same Sneed Lock ownership transfer to the buyer or the seller.

### 3.3 Bidding

1. **`reserveBid(offerId) → ok(bidId)`**. The offer must be `Active` and not past its expiry. For a private offer the caller must be in `approved_bidders` (or be the creator), else `NotAuthorized`. Creates a `Pending` bid with `amount = 0` and `tokens_escrowed = false`. Reservations are free and never expire.
2. Transfer the bid amount in the price token to `{ owner = Sneedex; subaccount = getBidEscrowSubaccount(caller, bidId) }`.
3. **`confirmBid(bidId, amount)`**. Checks, in order: the caller is the bidder; the bid is not confirmed yet (`Bid already confirmed`); the offer is `Active` and not expired; `amount > 0`; `amount ≥ min_bid_price` (or the buyout price when there is no minimum) else `BidTooLow { minimum }`; `amount ≥ highest + increment` else `BidIncrementTooSmall { current_highest; minimum_next; required_increment }`. The bid is capped at the buyout price. Sneedex then checks that the escrow holds at least the (capped) amount (`InsufficientFunds`) and refunds any balance above it, less one fee, when that excess is larger than a fee.

On success the bid is confirmed with the capped amount, every lower confirmed `Pending` bid becomes `Lost` (refunded one second later, and its bidder told by Sneed SMS), and the seller is told of the new bid. If the amount reaches the buyout price the offer completes in the same call (section 3.4).

If the offer stopped being active while `confirmBid` waited on the ledger, the bid is marked `Lost`, refunded automatically, and the call answers `InvalidState("Offer is no longer active; your escrowed tokens will be refunded")`.

`getHighestBid` semantics: the highest is the largest confirmed `Pending` bid. Since each bid must beat it, two confirmed bids never tie.

### 3.4 Buyout

A confirmed bid with `amount ≥ buyout_price` is recorded at exactly `buyout_price` and completes the offer at once: state `Completed { winning_bid_id; completion_time }`, the bid `Won`, every other `Pending` bid `Lost` (confirmed ones refunded), deliveries scheduled. Two buyouts racing: the first to complete wins; the other bid is marked `Lost`, refunded, and its call answers `InvalidState("Offer was already completed by another buyer; your bid was marked lost and will be refunded")`.

### 3.5 Accepting a bid early

**`acceptBid(offerId)`** lets the creator end an `Active` offer at any time with the current highest confirmed bid. Errors: `NotAuthorized`, `Offer is not active`, `No bids to accept`. The effect is the same as a buyout.

### 3.6 Refunds and withdrawals of bid escrows

- **Automatic**: a confirmed bid that becomes `Lost` (outbid, offer completed by another bid, cancelled) is refunded one second later: `amount − fee` to the bidder's default account, then `Refunded`.
- **`refundBid(bidId)`**: the same by hand, for the bidder, when the automatic refund failed. Requires `Lost` and `tokens_escrowed` (`Can only refund lost bids`, `No tokens escrowed`). Returns `InsufficientFunds` if the amount does not cover the fee.
- **`retryRefund(bidId) → ok(block_index)`**: the same refund, callable by **anyone** (support, a bot, the bidder from another device). The money goes only to the bidder the bid records, never to the caller; once paid the bid is `Refunded` and a repeat answers `Can only refund lost bids`. The hourly expiration worker also retries every `Lost` bid that still holds its escrow (section 3.8).
- **`withdrawBidEscrow(bidId, amount) → ok(block_index)`**: sends `amount` from the bid escrow to the bidder; the escrow pays the ledger fee on top. Refused for `Won` bids (`Cannot withdraw from a won bid`). Before confirmation everything less the withdrawal's own fee may be withdrawn; after confirmation `bid.amount` must stay after that fee (the refund or the seller payout takes exactly `bid.amount`, its own ledger fees included), so the most is `balance − bid.amount − fee`. Once the bid is paid out (`Refunded`, or `ClaimedBySeller`: the seller has its payment) nothing is reserved, so whatever is left or arrives later can be withdrawn. Returns `InsufficientFunds { available; required }` with the most that may be withdrawn. This is how a bidder recovers tokens sent to a reservation that was never confirmed (including after the offer ended): read `getBidEscrowBalance(bidId)` and withdraw `balance − fee`.
- **`getBidEscrowBalance(bidId) → ok(nat)`** reads the ledger (update call).

### 3.7 Settlement: delivery and payment

When an offer completes Sneedex schedules two timers:

- after 2 s, **asset delivery** to the winner: canisters (winner becomes sole controller), neurons (winner gets full owner permissions, Sneedex leaves), ICRC-1 balances (less one fee each), NFTs (ICRC-7 and EXT, to the winner's default account), Sneed Locks (ownership transfer). Once every asset has arrived the offer becomes `Claimed`, and canisters and tokens are registered in the winner's Sneed wallet (best effort).
- after 3 s, **payment** to the seller from the winning bid's escrow: the marketplace cut to the fee recipient (section 4.2), the rest less one ledger fee to the seller's default account. Then the bid becomes `ClaimedBySeller`.

The manual equivalents:

- **`claimAssets(offerId)`**, winner only, while `Completed`. While the seller is still owed (`Won`), it first checks the winning escrow still holds what the seller is due, the bid less any marketplace cut already paid (`Winning bid escrow no longer holds the full bid amount; assets cannot be released`). It hands over only the assets not delivered yet; if one fails it returns `TransferFailed("Not every asset could be handed over (asset <i>: <reason>; …). …")`, the offer stays `Completed`, and calling again retries just those. `InvalidState("A hand-over of this offer's assets is already in progress; try again shortly")` while the delivery timer or another call is handing the same offer over. Other states answer with `InvalidState`: `Offer is Active (not yet completed). Seller must accept a bid first.`, `Assets already claimed`, `Assets were reclaimed by seller`, `Offer has expired`, `Offer was cancelled`, `Offer is in Draft state, not completed`, `Offer is in PendingEscrow state, not completed`.
- **`claimWinningBid(offerId)`**, creator only, while `Completed` or `Claimed`. Errors: `Offer is not completed`, `Bid is not in won state` (already paid), `An escrow operation is already in progress for this bid`, `InsufficientFunds`, `TransferFailed(...)`. If the cut went out but the transfer to the seller failed, the bid stays `Won` and a retry pays only the seller; the cut is never paid twice.

**`settleOffer(offerId) → ok(text)`**, **anyone**: finishes whatever settlement is still undone, paying only the recipients the offer records. `Completed`: the assets to the winner (as `claimAssets`) and the payment to the seller (as `claimWinningBid`); `Claimed` with the seller unpaid: the payment; `Expired` / `Cancelled`: the assets back to the seller (as `reclaimAssets`). The answer says what was done; if a part fails it is `TransferFailed("Offer #<id>: assets: …; seller payment: …")` and calling again retries only that part. Other states, or nothing left to do: `InvalidState("Nothing to settle: …")`. The caller receives nothing; it is for support and for parties who cannot or do not act. The hourly expiration worker does the same for every unsettled offer (section 3.8), so settlement no longer depends on the 2 s / 3 s timers surviving (they do not survive an upgrade).

**A failed hand-over is retried, never repeated.** Delivery (automatic or `claimAssets`) and return (automatic or `reclaimAssets`) record each asset that reached its recipient and set `Claimed` or `Reclaimed` only when all of them have. A failed transfer (an unreachable ledger, a governance or Sneed Lock refusal) leaves the offer `Completed` (or `Expired` / `Cancelled`) with that asset still in escrow, and the automatic attempt is not repeated: the winner calls `claimAssets` (the seller `reclaimAssets`) again, which hands over only what is missing. Assets already delivered are never sent twice, and NFTs (ICRC-7 and EXT) are moved only while they are still in the offer's escrow account. Hand-overs of one offer are serialized, so the timer and a manual call cannot run at once.

Offers settled by earlier versions of Sneedex could be marked `Claimed` or `Reclaimed` although a transfer had failed. For those, `claimAssets` on a `Claimed` offer (winner only) and `reclaimAssets` on a `Reclaimed` offer (creator only) hand over whatever is provably still held for that offer: token balances in its escrow subaccount (to the winner only while the escrow still holds the full listed amount), NFTs (ICRC-7 and EXT) still in its escrow account, and canisters, neurons and locks of which Sneedex is still the sole controller / sole permission holder / owner and that no other offer lists. With nothing left they answer as before (`Assets already claimed`, `Can only reclaim from expired or cancelled offers`). Anything this cannot prove (for example a canister also listed in a later offer) is left to an admin.

### 3.8 Expiry

An `Active` offer with an `expiration` in the past is settled by **`processExpiration(offerId)`**, which anyone may call:

- with at least one confirmed bid: completes with the highest (as a buyout would);
- without: `Expired`, seller told by Sneed SMS, assets returned after 2 s.

Errors: `Offer is not active`, `Offer has no expiration`, `Offer has not expired yet`. A recurring timer (every `getExpirationCheckInterval()` seconds, 3,600 on production; `isExpirationTimerRunning()`) does the same for every expired offer, one at a time, so most integrations never need to call it. Until one of them runs, an expired offer stays `Active` but refuses new bids (`OfferExpired`).

The same worker then **sweeps what settlement left undone**: offers `Completed`, `Expired` or `Cancelled`, `Claimed` offers whose seller is unpaid (each as `settleOffer`), and `Lost` bids still holding their escrow (as `retryRefund`). At most 20 offers and 50 bids per run, rotating, so one that keeps failing cannot hold up the rest; a failure is written once to the support log (`getSupportLog`, op `settlementSweep` / `refundSweep`) and retried every run. `isExpirationWorkerRunning()` is true while a run is in progress; a run that dies is restarted by the next tick.

### 3.9 Cancellation and reclaiming

**`cancelOffer(offerId)`**, creator only, in `Draft`, `PendingEscrow` or `Active`, **also with bids**. Every confirmed `Pending` bid becomes `Lost`, is refunded, and its bidder is told. The escrowed assets are returned after 2 s (`Cancelled → Reclaimed` once all are back). Tokens and NFTs (ICRC-1, ICRC-7, EXT) that reached the offer's escrow account but were never marked escrowed (too little sent, `escrow*` never called) go back to the creator too, best effort: whatever is in the escrow account (ICRC-1 less one fee); a ledger or collection that cannot answer is written to the support log and does not hold up `Reclaimed` (`reclaimAssets` retries it later). The same happens on expiry. Error: `Offer cannot be cancelled in current state`.

**`reclaimAssets(offerId)`**, creator only, in `Expired` or `Cancelled`: returns the escrowed assets not returned yet (canister controllers from the snapshot, neuron permissions as recorded, token balances less one fee, NFTs and locks to the creator; EXT cards also when sent but never marked escrowed, section 3.2) and sets `Reclaimed` once all are back. If one fails: `TransferFailed("Not every asset could be handed over (…)")`, the state stays, and calling again retries the rest (section 3.7). Errors: `Can only reclaim from expired or cancelled offers`, `A hand-over of this offer's assets is already in progress; try again shortly`.

### 3.10 Notifications

Sneedex sends Sneed SMS system messages (from the Sneed SMS canister configured with `getSneedSmsCanisterId()`) for: a new bid (to the seller), being outbid, a sale (seller), a win (winner), expiry without bids (seller), cancellation (bidders), and an invitation to a private offer (approved bidders, at activation). All are on by default; each user chooses with **`setMyNotificationSettings(NotificationSettings)`** and reads them with **`getMyNotificationSettings()`** (query, caller's own). Delivery is best effort and never affects the offer.

### 3.11 ICP Staking Bot information during a sale

Escrowed ICP Staking Bots only answer neuron details to their controllers, which during escrow is only Sneedex. Sneedex proxies them for buyers:

- **`getCachedNeuronManagerInfoQuery(canister) → opt NeuronManagerInfo`** (query): the cached copy if fresher than `getNeuronInfoCacheStaleness()` seconds, else null.
- **`getNeuronManagerInfo(canister) → variant { Ok : NeuronManagerInfo; Err : text }`** (update): the cache, or a fresh read from the bot (version, every neuron's stake, dissolve delay, state, age, voting power, maturity, staked maturity, hotkeys). Only for canisters escrowed in a `PendingEscrow` or `Active` offer: `Canister is not in escrow`, `Failed to get staking bot info`.

Call the query first and fall back to the update. **`getCanisterInfo(offerId, assetIndex) → ok(CanisterInfo)`** (update) returns the management canister's status (status, controllers, memory, cycles, module hash, settings) of an escrowed canister asset: `Asset is not escrowed - cannot query canister info`, `Asset is not a canister`, `CanisterError("Failed to get canister status - may not have controller access")`.

---

## 4. Fees and payment

### 4.1 Offer creation fee (ICP)

| Method | Kind | Returns |
|---|---|---|
| `getEffectiveOfferCreationFee(user)` | update | `nat64` e8s: the premium fee if `user` is a Sneed Premium member, else the regular fee (0 when the regular fee is 0), lowered by an admin or partner price when one applies (section 4.4). Authoritative. |
| `getFeeConfig()` | query | `{ regularCreationFeeE8s; premiumCreationFeeE8s; regularAuctionCutBps; premiumAuctionCutBps }` |
| `getOfferCreationFee()`, `getPremiumOfferCreationFee()` | query | `nat64` e8s |
| `getOfferCreationPaymentSubaccount(user)` | query | `blob` |
| `getUserOfferCreationBalance(user)` | update | `nat` e8s deposited (reads the ICP ledger) |
| `withdrawOfferCreationPayment()` | update | `ok(amount)`: sends the caller's whole deposit less 0.0001 ICP back to their default account. `InsufficientFunds` when the balance does not exceed the fee. |

Before creating an offer, deposit at least the effective fee into `{ owner = Sneedex; subaccount = getOfferCreationPaymentSubaccount(caller) }` on the ICP ledger (`ryjl3-tyaaa-aaaaa-aaaba-cai`). `createOffer` checks the balance (`InsufficientFunds { required; available }`), sends the fee less the 0.0001 ICP ledger fee to the ICP fee recipient (`TransferFailed(...)` on a ledger error), records it in the creation-fee log, and only then creates the offer. Whatever is left in the subaccount stays the user's.

At the time of writing production charges 0.01 ICP (1,000,000 e8s) per offer, and nothing for Sneed Premium members. Read the live values; admins can change them.

### 4.2 Marketplace cut (price token)

Each offer records `fee_rate_bps` at creation: the premium cut if a premium rate is set and the creator is a Sneed Premium member, otherwise the regular rate, lowered by an admin or partner cut when one applies (section 4.4) (`getMarketplaceFeeRate()`; at the time of writing 250 bps regular, 175 bps premium). When the winning bid is paid out:

```
rawCut     = bid.amount × fee_rate_bps / 10_000
cut        = rawCut  if rawCut > ledger fee, else 0
fee recipient receives  cut − fee            (the transfer costs one fee)
seller receives         bid.amount − cut − fee
```

The cut goes to the fee recipient of the price ledger: a per-ledger override (`getLedgerFeeRecipients()`) or the default `getFeeRecipient()`. Totals are public: **`getPaymentStats()`** returns `total_creation_fees_collected_e8s`, `total_creation_fee_payments`, `total_cut_payments` and `cuts_by_ledger`. The individual payment logs are admin-only.

### 4.3 Ledger fees, summarised

| Movement | Who bears the ledger fee |
|---|---|
| Deposit to an offer, bid or payment subaccount | The sender (normal ICRC-1 transfer) |
| ICRC-1 asset to the buyer or back to the seller | The offer subaccount: recipient gets balance − fee |
| Refund of a lost bid | The bid escrow: bidder gets amount − fee |
| Excess above a capped bid | The bid escrow: excess − fee, only when excess > fee |
| `withdrawBidEscrow(amount)` | The bid escrow, on top of `amount` |
| Seller payout and cut | The winning bid escrow, one fee each |
| Creation fee to the recipient | The payment subaccount (0.0001 ICP) |

---

### 4.4 Special prices: admin and partner prices

Next to the regular and premium prices, Sneedex has an **admin price** (for principals on its admin list that are people, i.e. self-authenticating; canisters such as SNS governance never get it) and **partner prices** (per principal, usually a partner canister that integrates with Sneedex, for example a partner game canister that lists items; each with a public label and an optional expiry). Both cover the two fees:

```candid
type SpecialPriceOverrides = record {
  offer_creation_fee_e8s : opt nat;   // ICP e8s; 0 or at least 10_000 (one ICP ledger fee)
  auction_cut_bps : opt nat;          // at most 5000
};
type PartnerPrices = record { label : text; prices : SpecialPriceOverrides; expires_at : opt int };  // ns since 1970
```

**Rule.** For each fee the caller pays the lowest applicable value among regular, premium (members, exactly as before), admin (when it applies and the override is set) and partner (when the caller's entry exists, has not expired, and the override is set). On a tie the earlier of regular, premium, admin, partner is reported. Unset overrides change nothing. The cut is decided once, at `createOffer`, and locked in as the offer's `fee_rate_bps`; `getEffectiveOfferCreationFee(user)` returns the fee including special prices.

| method | kind | description |
|---|---|---|
| `get_special_prices()` | query | `{ admin_prices; partners : vec { principal; label; prices; expires_at } }`, expired entries included. Public. |
| `get_special_prices_for(principal)` | query | `{ admin_prices : opt …; partner : opt PartnerPrices }`: what applies to that principal now. |
| `get_offer_price_tiers(offerId)` | query | `opt { creation_fee : opt PriceTier; cut : PriceTier }` with `PriceTier = variant { regular; premium; admin; partner }`; null for offers created before special prices. |
| `set_admin_prices(SpecialPriceOverrides)` | update, admin | Replaces the admin overrides. `variant { ok; err : text }`. |
| `set_partner_prices(principal, PartnerPrices)` | update, admin | Adds or replaces an entry. Refuses the anonymous principal, an empty label or one over 100 characters, a past expiry, a 201st partner, and overrides the regular setters would refuse. |
| `remove_partner_prices(principal)` | update, admin | Removes an entry (`err` when there is none). |

Every change is a `sneedex_config_update` block (`admin_prices` / `partner_prices`); the fee and cut blocks carry `price_tier` (section 8).

## 5. Concurrency, errors and retries

**Result shapes.** Almost every method returns `variant { ok : T; err : SneedexError }` (lowercase). `verifyICPNeuronManager`, `verifyTradingBot` and `getNeuronManagerInfo` return `variant { Ok : T; Err : text }`. `getCreationFeePaymentLog`, `getCutPaymentLog` and their `…Count` methods trap for non-admins.

**`SneedexError`.** `NotAuthorized` (not the creator, bidder or an admin; or not an approved bidder), `OfferNotFound`, `BidNotFound`, `InvalidState(text)`, `InvalidAsset(text)`, `InvalidPrice(text)`, `InvalidInput(text)`, `InvalidExpiration`, `OfferExpired`, `OfferMustHaveBuyoutOrExpiration`, `BidTooLow { minimum }`, `BidIncrementTooSmall { … }`, `InsufficientFunds { available; required }`, `TransferFailed(text)`, `CanisterError(text)`, `GovernanceError(text)`. `AssetTypeNotSupported`, `CannotCancelWithBids` and `EscrowFailed` exist in the type but are not returned by the current code.

**Per-bid escrow lock.** `confirmBid`, `refundBid`, `retryRefund`, `withdrawBidEscrow`, the automatic refund and the seller payout serialise on the bid. A second call while one runs gets `InvalidState("An escrow operation is already in progress for this bid")`; retry after a few seconds.

**Offers change during awaits.** The escrow methods re-read the offer after their cross-canister calls and refuse with `InvalidState("Offer changed while escrowing")` if it moved on (for example a cancel in between). Settlement checks `Active` and writes the new state without an `await` in between, so concurrent buyouts, `acceptBid` and expiry cannot both win.

**Retrying.** The `escrow*` methods verify the current on-chain situation, so repeating one after a timeout is safe. `createOffer` is not idempotent: two calls make two drafts and charge two fees; after a timeout check `getOffersByCreator(me)` first. `reserveBid` is cheap to repeat but each call makes a new bid id with its own escrow subaccount; send tokens only to the id you are going to confirm. `processExpiration`, `claimAssets`, `reclaimAssets`, `claimWinningBid`, `settleOffer` and `retryRefund` refuse a second run once they have succeeded; after a `TransferFailed` they are meant to be called again and only redo what failed.

**Thrown errors.** A rejected call means nothing changed, except after a cross-canister await. Re-read with `queryOffer` / `queryBid` / `getOfferView` and continue from the state you find.

---

## 6. Method reference

Types are in section 7. "Caller" is the principal signing the call. Methods marked *query* can be called without a signature.

### 6.1 Offers: reading (queries)

| Method | Returns | Notes |
|---|---|---|
| `getOfferFeed({ start_id : opt OfferId; length : nat; filter : opt OfferFeedFilter })` | `{ offers; has_more; next_start_id }` | Newest first. Offers with id `< start_id` (all when null). `filter`: `states` (any of), `asset_types` (offer has at least one asset of any of these types), `creator`, `has_bids` (any bid, reservations included), `public_only` (`true`: public only; `false`: private offers that `viewer` created or may bid on, not their drafts unless creator). Pass `next_start_id` as the next `start_id` while `has_more`. A page holds at most 100 offers whatever `length` asks, and ends early (with `has_more = true`) before its reply would pass about 1.5 MB, so offers with long notes come in smaller pages. |
| `queryOffer(offerId)` | `opt Offer` | `note_to_buyer` filtered (1.6). |
| `getOfferView(offerId)` | `opt OfferView` | The offer, its confirmed bids (any state) and the current highest bid. |
| `getActiveOffers()` | `vec Offer` | `Active` offers, public and private, in ascending id order: the newest 500 at most, fewer when the reply would pass about 1.5 MB. For more, page `getOfferFeed`. |
| `getPublicOffers()` | `vec Offer` | `Active` offers without `approved_bidders`; the same limits. |
| `getPrivateOffersFor(viewer)` | `vec Offer` | Private offers created by `viewer` (any state) or open to `viewer` (not `Draft`/`PendingEscrow`); the same limits. |
| `getOffersByCreator(creator)` | `vec Offer` | Every state; the same limits. |
| `debugGetAllOffers()` | `vec { id; creator; state; approved_bidders }` | Every offer, compact. |
| `getNextOfferId()` | `OfferId` | The id the next `createOffer` gets. |
| `getMarketStats()` | `MarketStats` | `total_offers`, `active_offers`, `completed_offers` (`Completed` + `Claimed`), `total_bids` (reservations included). `total_volume_by_token` is always empty (not implemented). |
| `getOfferEscrowSubaccount(creator, offerId)` | `blob` | 1.4. |
| `getOfferEscrowAccountId(creator, offerId)` | `text` | The offer escrow as an account identifier (64 hex), where EXT NFTs are escrowed (1.4, 3.2). |

### 6.2 Offers: creating and managing (updates)

**`createOffer(CreateOfferRequest) → variant { ok : OfferId; err }`**
Section 3.1. Errors: `OfferMustHaveBuyoutOrExpiration`, `InvalidExpiration` (expiry sooner than `min_offer_duration_ns` from now), `InvalidPrice("Minimum bid must be greater than 0 (leave it unset for buyout-only offers)")`, `InvalidPrice("Minimum bid cannot exceed buyout price")`, `InvalidInput("Public note exceeds maximum length of 4000 characters")`, `InvalidInput("Note to buyer exceeds maximum length of 4000 characters")`, `InsufficientFunds` (creation fee), `TransferFailed(...)`.

**`addAsset({ offer_id; asset }) → variant { ok; err }`**
Creator, `Draft`. Section 3.2. General errors: `InvalidAsset("This asset type is not currently accepted")` (type deactivated), `OfferNotFound`, `NotAuthorized`, `InvalidState("Offer must be in Draft state to add assets")`, `InvalidAsset("Maximum number of assets reached")`, `InvalidAsset("This asset has already been added to the offer")`; NFT: `List at least one token id`, `At most 50 tokens of one collection per asset`, `Token id <id> is listed twice`; EXT: see section 3.2. Assets cannot be removed; cancel the draft and start again.

**`finalizeAssets(offerId) → variant { ok; err }`**
Creator, `Draft → PendingEscrow`. Errors: `Offer must be in Draft state`, `InvalidAsset("Offer must have at least one asset")`.

**`escrowCanister`, `escrowSNSNeuron`, `escrowICRC1Tokens`, `escrowICRC7NFTs`, `escrowICRC7NFTsByApproval`, `escrowEXTNFTs`, `escrowSneedLock` `(offerId, assetIndex) → variant { ok; err }`**
Creator, `PendingEscrow` (`Offer must be in PendingEscrow state`). Section 3.2.

**`activateOffer(offerId) → variant { ok; err }`**
Creator, `PendingEscrow → Active`. Errors: `All assets must be escrowed before activation`, `OfferExpired`.

**`cancelOffer(offerId) → variant { ok; err }`** Creator. Section 3.9.

**`acceptBid(offerId) → variant { ok; err }`** Creator. Section 3.5.

**`processExpiration(offerId) → variant { ok; err }`** Anyone. Section 3.8.

**`claimAssets(offerId) → variant { ok; err }`** Winner. Section 3.7.

**`claimWinningBid(offerId) → variant { ok; err }`** Creator. Section 3.7.

**`reclaimAssets(offerId) → variant { ok; err }`** Creator. Section 3.9.

**`settleOffer(offerId) → variant { ok : text; err }`** Anyone; pays only the recorded recipients. Section 3.7.

**`getCanisterInfo(offerId, assetIndex) → variant { ok : CanisterInfo; err }`** Update. Section 3.11.

### 6.3 Bids

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `reserveBid(offerId)` | update | `ok(BidId)` | 3.3. Errors: `Offer is not active`, `NotAuthorized`, `OfferExpired`, `InvalidState("Too many unconfirmed bid reservations …")` (at most 10 unconfirmed reservations per principal per open offer, 50 in all: confirm one or reuse one from `getBidsByBidderAll`). |
| `getBidEscrowSubaccount(bidder, bidId)` | query | `blob` | 1.4. |
| `confirmBid(bidId, amount)` | update | `ok` | 3.3, 3.4. |
| `refundBid(bidId)` | update | `ok` | 3.6. Bidder. |
| `retryRefund(bidId)` | update | `ok(block_index)` | 3.6. Anyone; refunds only the bidder. |
| `withdrawBidEscrow(bidId, amount)` | update | `ok(block_index)` | 3.6. Error: `Cannot withdraw from a won bid`. |
| `getBidEscrowBalance(bidId)` | update | `ok(nat)` | 3.6. |
| `queryBid(bidId)` | query | `opt Bid` | Any bid, reservations included. |
| `getBidsByBidder(bidder)` | query | `vec Bid` | Confirmed bids only (any state). |
| `getBidsByBidderAll(bidder)` | query | `vec Bid` | Every bid, unconfirmed reservations included (to find a deposit that was never confirmed). |
| `getNextBidId()` | query | `BidId` | |

### 6.4 Registries and helpers

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `getAssetTypes()` | query | `vec AssetType` | `0` Canister, `1` SNS Neuron, `2` ICRC1 Token, `3` ICRC-7 NFT, `4` Sneed Lock, `5` EXT NFT, each with `active`. A deactivated type cannot be added to new offers. |
| `getCanisterKinds()` | query | `vec CanisterKind` | `0` Unknown, `1` ICP Staking Bot, `2` Trading Bot. |
| `verifyICPNeuronManager(canister)` | update | `variant { Ok : NeuronManagerVersion; Err : text }` | `Failed to verify canister as ICP Staking Bot. getVersion() call failed.` |
| `verifyTradingBot(canister)` | update | `variant { Ok : TradingBotVersion; Err : text }` | `Failed to verify canister as Trading Bot. getVersion() call failed.` |
| `getNeuronManagerInfo(canister)` | update | `variant { Ok : NeuronManagerInfo; Err : text }` | 3.11. |
| `getCachedNeuronManagerInfoQuery(canister)` | query | `opt NeuronManagerInfo` | 3.11. |
| `getNeuronInfoCacheStaleness()` | query | `nat` seconds | |
| `getConfig()` | query | `Config` | `max_assets_per_offer`, `min_offer_duration_ns`, the admin list, and the frontend's minimum-increment hints. |
| `getMinIncrementSettings()` | query | `{ usd_range_min; usd_range_max; usd_target; fallback_tokens }` | Hints the reference frontend uses to suggest `min_bid_increment_fee_multiple` (USD values in cents, `fallback_tokens` in base units). The canister does not enforce them. |
| `getExpirationCheckInterval()`, `isExpirationTimerRunning()`, `isExpirationWorkerRunning()` | query | `nat` / `bool` | 3.8. |
| `getSneedLockCanisterId()`, `getSneedPremiumCanisterId()`, `getSneedSmsCanisterId()`, `getBackendCanisterId()`, `getNeuronManagerFactoryCanisterId()` | query | `principal` / `opt principal` | The canisters Sneedex works with. |

### 6.4a Support lookups (queries, anyone)

| Method | Returns | Notes |
|---|---|---|
| `getSettlement(offerId)` | `opt record { state; winning_bid : opt Bid; delivered_asset_indices : vec nat; settlement_in_progress : bool }` | Where an offer's settlement stands: the assets already handed over by a settlement still in progress, and whether a hand-over runs now. |
| `getSupportLog(before : opt nat, limit : nat)` | `vec SupportLogEntry` | Newest first, at most 100; `before` pages back (ids below it). A ring of the last 500 errors swallowed by background work (timers, the sweep, notifications, wallet registration, bot botkey snapshots and restores, failed excess-bid refunds, unescrowed returns) and admin interventions. |
| `getSupportLogFor(p)` | `vec SupportLogEntry` | The entries that name `p` (as party or admin). |
| `getCreationFeePaymentsFor(p, before : opt nat, limit : nat)` | `vec CreationFeePaymentLogEntry` | Creation fees `p` paid, newest first, at most 100. |
| `getCutPaymentsFor(p, before : opt nat, limit : nat)` | `vec CutPaymentLogEntry` | Marketplace cuts of sales `p` took part in (seller or buyer), newest first, at most 100. |

`SupportLogEntry = record { id : nat; time : int; kind : text ("error" or "admin"); op : text; principal : opt principal; offer_id : opt nat; bid_id : opt nat; text : text }`. The text is at most 500 characters. Nothing in it is private: the same principals, ids and amounts are on the ledgers and in the activity log.

### 6.5 Fees, payment and notifications

`getEffectiveOfferCreationFee`, `getFeeConfig`, `getOfferCreationFee`, `getPremiumOfferCreationFee`, `getPremiumAuctionCutBps`, `getMarketplaceFeeRate`, `getFeeRecipient`, `getLedgerFeeRecipients`, `getOfferCreationPaymentSubaccount`, `getUserOfferCreationBalance`, `withdrawOfferCreationPayment`, `getPaymentStats`: section 4. `get_special_prices`, `get_special_prices_for`, `get_offer_price_tiers`, `set_admin_prices`, `set_partner_prices`, `remove_partner_prices`: section 4.4. `getMyNotificationSettings`, `setMyNotificationSettings`: section 3.10.

### 6.6 Admin methods

Restricted to the canister's controllers (the Sneed SNS on production) and `config.admins`; they return `NotAuthorized` (or trap, for the log queries) for anyone else. Integrators never need them.

| Method | Purpose |
|---|---|
| `updateConfig(Config)`, `addAdmin(p)`, `removeAdmin(p)` | Replace the configuration; manage the admin list. |
| `setMinIncrementSettings(min, max, target, fallback)` | Frontend increment hints (`Target must be between range min and max`). |
| `addAssetType(name, description)`, `deactivateAssetType(id)`, `reactivateAssetType(id)` | Asset type registry. |
| `setMarketplaceFeeRate(bps)`, `setPremiumAuctionCutBps(bps)` | Regular and premium cut, at most 5,000 bps. |
| `setOfferCreationFee(e8s)`, `setPremiumOfferCreationFee(e8s)` | Creation fees: 0 (free) or at least the ICP ledger fee, 10_000 e8s (smaller fees are refused). |
| `setFeeRecipient(account)`, `setLedgerFeeRecipient(ledger, account)`, `removeLedgerFeeRecipient(ledger)` | Where fees go. |
| `setSneedPremiumCanisterId`, `setSneedSmsCanisterId`, `setBackendCanisterId`, `setNeuronManagerFactoryCanisterId`, `setSneedLockCanisterId` | Wiring to other Sneed canisters. |
| `startExpirationTimer()`, `stopExpirationTimer()`, `setExpirationCheckInterval(seconds)`, `triggerExpirationCheck()` | The expiry timer (interval at least 60 s); `triggerExpirationCheck` starts a run now (expired offers and the settlement sweep, 3.8). |
| `setNeuronInfoCacheStaleness(seconds)`, `clearNeuronInfoCache()`, `clearNeuronInfoCacheFor(canister)` | Staking-bot info cache. |
| `getCreationFeePaymentLog(offset, limit)`, `getCutPaymentLog(offset, limit)`, `getCreationFeePaymentLogCount()`, `getCutPaymentLogCount()` | Payment logs, newest first, at most 1,000 per page. |
| `adminReclaimStuckTokens(offerId)`, `adminReclaimStuckTokensWithReason(offerId, reason)` | Retries returning every escrowed asset of an offer to its creator and reports each result as text (ICRC-7 and EXT NFTs: only those still in the offer's escrow account). Only for `PendingEscrow`, `Cancelled`, `Expired` or `Reclaimed` offers without a winning bid. Every call, refused or not, is written to the support log with its reason (at most 500 characters). |
| `adminReturnMisplacedNft(collection, tokenId, to)` | Returns an NFT a non-compliant collection put in Sneedex's default account. Refused while any open offer has the token escrowed. |
| `adminReturnMisplacedExtNft(collection, tokenIndex, fromOffer, to)` | Returns an EXT token from Sneedex's default account (`fromOffer` null) or from an offer's escrow account (`opt offerId`) that no offer holds it for, to `to`'s default account. Refused while an offer waiting for its escrow lists the token, or an offer holds it escrowed and has not handed it over. |
| `setRateLimit(action, opt { capacity; per_minute })` | The rate limit of `createOffer`, `reserveBid`, `confirmBid` or `cancelOffer` (1.7): `capacity` calls at once, refilled at `per_minute` a minute; `capacity = 0` means no limit, `null` restores the default. `getRateLimits()` (query, anyone) lists the rules in force. |
| `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`, `admin_set_icrc3_proposal_neuron`, `admin_icrc3_register_archives_now`, `admin_icrc3_reset_archive_registration` | The activity log's archives and their SNS registration (section 8). |

---

## 7. Types

```candid
type OfferId = nat;
type BidId = nat;
type AssetTypeId = nat;      // 0 Canister, 1 SNSNeuron, 2 ICRC1Token, 3 ICRC7NFT, 4 SneedLock, 5 EXTNFT
type CanisterKindId = nat;   // 0 unknown, 1 ICP Staking Bot, 2 Trading Bot
type Time = int;             // ns since Unix epoch
type Timestamp = nat64;      // ns since Unix epoch (payment logs)
type Account = record { owner : principal; subaccount : opt blob };

type CreateOfferRequest = record {
  price_token_ledger : principal;
  min_bid_price : opt nat;
  buyout_price : opt nat;
  expiration : opt Time;
  min_bid_increment_fee_multiple : opt nat;
  approved_bidders : opt vec principal;   // set = private offer (at most 200)
  public_note : opt text;                 // at most 4,000 characters
  note_to_buyer : opt text;               // at most 4,000 characters; shown to the winner only
};

type Asset = variant {
  Canister : record {
    canister_id : principal;
    canister_kind : opt CanisterKindId;
    title : opt text;                      // at most 100 characters
    description : opt text;                // at most 4,000 characters
    controllers_snapshot : opt vec principal;  // set by escrowCanister
    cached_total_stake_e8s : opt nat64;        // staking bots, set after activation
  };
  SNSNeuron : record {
    governance_canister_id : principal;
    neuron_id : record { id : blob };
    hotkeys_snapshot : opt vec principal;  // set by escrowSNSNeuron
    cached_stake_e8s : opt nat64;          // set after activation
  };
  ICRC1Token : record { ledger_canister_id : principal; amount : nat };
  ICRC7NFT : record { collection_canister_id : principal; token_ids : vec nat };   // 1..50 ids
  SneedLock : record {
    lock_id : nat;
    lock : variant {
      Token : record { ledger_canister_id : principal; amount : nat; expiry : nat64 };
      Position : record { swap_canister_id : principal; position_id : nat; expiry : nat64 };
    };
  };
  EXTNFT : record { collection_canister_id : principal; token_indices : vec nat32 };   // 1..50 indices
};
// The Asset variant gained the EXTNFT case after the others: regenerate your bindings (from
// sneedex.did) to decode offers that contain EXT assets; older bindings fail on such offers.
type AssetEntry = record { asset : Asset; escrowed : bool };
type AddAssetRequest = record { offer_id : OfferId; asset : Asset };

type OfferState = variant {
  Draft; PendingEscrow; Active;
  Completed : record { winning_bid_id : BidId; completion_time : Time };
  Claimed; Expired; Cancelled; Reclaimed;
};

type Offer = record {
  id : OfferId;
  creator : principal;
  price_token_ledger : principal;
  min_bid_price : opt nat;
  buyout_price : opt nat;
  expiration : opt Time;
  min_bid_increment_fee_multiple : opt nat;
  approved_bidders : opt vec principal;
  assets : vec AssetEntry;
  state : OfferState;
  fee_rate_bps : nat;          // marketplace cut locked in at creation
  public_note : opt text;
  note_to_buyer : opt text;    // null unless the caller may see it
  created_at : Time;
  activated_at : opt Time;
};

type BidState = variant { Pending; Lost; Refunded; Won; ClaimedBySeller };
type Bid = record {
  id : BidId; offer_id : OfferId; bidder : principal;
  amount : nat;                // 0 until confirmed
  state : BidState;
  created_at : Time;
  tokens_escrowed : bool;      // true once confirmed
};
type OfferView = record { offer : Offer; bids : vec Bid; highest_bid : opt Bid };

type OfferFeedFilter = record {
  states : opt vec OfferState;
  asset_types : opt vec AssetTypeId;
  creator : opt principal;
  has_bids : opt bool;
  public_only : opt bool;
  viewer : opt principal;
};
type GetOfferFeedInput = record { start_id : opt OfferId; length : nat; filter : opt OfferFeedFilter };
type GetOfferFeedResponse = record { offers : vec Offer; has_more : bool; next_start_id : opt OfferId };

type NotificationSettings = record {
  notify_on_bid : bool; notify_on_outbid : bool; notify_on_sale : bool; notify_on_win : bool;
  notify_on_expiration : bool; notify_on_cancellation : bool; notify_on_private_invite : bool;
};

type Config = record {
  admins : vec principal;
  max_assets_per_offer : nat;
  min_offer_duration_ns : nat;
  min_increment_usd_range_min : nat;
  min_increment_usd_range_max : nat;
  min_increment_usd_target : nat;
  min_increment_fallback_tokens : nat;
};
```

`SneedexError`, `CanisterInfo`, `NeuronManagerInfo`, `ICPNeuronInfo`, `MarketStats` and the payment log entries are in [sneedex.did](/api-docs/sneedex.did). In JavaScript an `opt T` is `[]` or `[value]`, a variant is an object with one key (`{ Active: null }`), and `nat`/`int`/`nat64` are `BigInt`.

---

## 8. Activity log (ICRC-3)

Every action that changes the market is recorded as a block in a hash-chained, certified log, readable through the standard [ICRC-3](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3) interface: offers, assets and their escrow, bids, every asset handed over, every payment out of an escrow, creation fees, and every admin action that moves assets or changes fees and settings. Each block carries the hash of the previous block (`phash`), and the canister certifies the index and hash of the latest block, so anyone can download the history and prove it complete and untampered without trusting Sneed DAO or this app. Old blocks move to archive canisters that Sneedex creates; the chain of archives grows on its own.

The log is an audit trail, not a ledger: amounts in it are what Sneedex moved, and each transfer names its ledger block (`ledger_tx`, `icp_tx`) so it can be checked on the token's own ledger. It uses the same library as [Sneed Lock's log](/api/sneed_lock#8-activity-log-icrc-3) ([src/icrc3](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/icrc3)); the design is in [spec/sneedex_icrc3.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sneedex_icrc3.md). The log starts empty with the release that introduced it; offers and bids from before are not imported (their state is in `queryOffer`, `getOfferView` and `queryBid`).

### 8.1 Endpoints

| Method | Type | Returns |
|---|---|---|
| `icrc3_get_blocks(vec record { start : nat; length : nat })` | query | `{ log_length; blocks : vec { id; block }; archived_blocks : vec { args; callback } }`. Live blocks come back directly; for archived ranges call `callback` (that archive's own `icrc3_get_blocks`) with `args`. At most 1000 blocks or about 1.5 MB per response. |
| `icrc3_get_archives(record { from : opt principal })` | query | Every archive canister with the first and last block index it holds, in index order. |
| `icrc3_get_tip_certificate()` | query | `opt { certificate; hash_tree }`: the IC certificate over the canister's certified data and the CBOR hash tree with `last_block_index` (unsigned LEB128) and `last_block_hash`. Null until the first block exists. |
| `icrc3_supported_block_types()` | query | Every `btype` below, each with the url of [8.3](#83-block-types). |
| `icrc10_supported_standards()` | query | ICRC-3 and ICRC-10. |
| `icrc3_log_status()` | query | Log length, live blocks, hash of the last block, archives with their ranges, spill settings. `history_imported` is always false (there is no import). |
| `icrc3_registration_status()` | query | Per archive, the SNS proposal that registered it as a DAO canister (submitted automatically through a hotkeyed neuron once one is configured). |

Admin only: `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`, `admin_set_icrc3_proposal_neuron`, `admin_icrc3_register_archives_now`, `admin_icrc3_reset_archive_registration` (as on Sneed Lock). Archives are controlled by Sneedex and the Sneed SNS root until a `RegisterDappCanisters` proposal hands them to SNS root alone.

### 8.2 Block format

A block is a `Map` with `btype` (Text), `ts` (Nat, ns since epoch: when the block was appended, which is when the action happened), `phash` (Blob, absent on block 0) and `tx` (Map). Inside `tx`:

- Principals are `Blob` (raw principal bytes); ICRC-1 accounts are `Array [owner, subaccount?]`.
- Amounts are `Nat` in the token's base units; ids and expirations are `Nat`.
- `caller` is the principal that made the call. Actions done by a Sneedex timer (auto-delivery, auto-payment, auto-refund, auto-reclaim, the expiration worker) have no `caller` but `via` = `"timer"`.
- Flags are `Nat` 0 or 1. Optional fields are omitted when absent.
- `asset` describes one asset as listed: a `Map` with `type` and its fields: `canister` (`canister_id`, `canister_kind`, `controllers_snapshot` once escrowed), `sns_neuron` (`governance`, `neuron_id`, `hotkeys_snapshot` once escrowed), `icrc1` (`ledger`, `amount`), `icrc7` (`collection`, `token_ids`), `ext` (`collection`, `token_indices` (Array of Nat), `token_identifiers` (Array of Text)), `sneed_lock` (`lock_id`, `kind` = `token` or `position`, `ledger` and `amount` or `pool` and `position_id`, `expiry`).
- Nothing private is logged: `note_to_buyer` never appears. Public notes and canister titles and descriptions are left out too. Everything in the log is already public through the queries; nothing on the IC is anonymous.

The block hash is the ICRC-3 representation-independent hash, as in [Sneed Lock's 8.2](/api/sneed_lock#82-block-format).

### 8.3 Block types

All types carry the `sneedex_` prefix. A block is appended only once its action is final, in the message that records it: after the ledger, governance or Sneed Lock call succeeded. A failed transfer appends nothing; its retry appends the block. Flows with several steps log each step that completed.

Offers:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedex_offer_create` | `createOffer` recorded a Draft offer. | `caller`, `offer_id`, `price_ledger`, `fee_rate_bps` (cut locked in); `min_bid`, `buyout`, `expiration`, `min_increment_fee_multiple` when set; `approved_bidders` (private offer); `creation_fee_e8s`, `creation_fee_icp_tx`, `price_tier` when a fee was paid; `cut_price_tier` (section 4.4) |
| `sneedex_asset_add` | `addAsset` | `caller`, `offer_id`, `asset_index`, `asset` |
| `sneedex_offer_finalize` | `finalizeAssets` (to PendingEscrow) | `caller`, `offer_id`, `asset_count` |
| `sneedex_asset_escrow` | An `escrow*` call confirmed custody of one asset. | `caller`, `offer_id`, `asset_index`, `asset` (with snapshots); `pulled` (1 when Sneedex pulled NFTs through an ICRC-37 approval); EXT: `account_id` (Text, the escrow account id) |
| `sneedex_offer_activate` | `activateOffer` | `caller`, `offer_id` |
| `sneedex_offer_cancel` | `cancelOffer` | `caller`, `offer_id`, `from_state` (`draft`, `pending_escrow`, `active`) |
| `sneedex_offer_expire` | An Active offer passed its expiration without bids (`processExpiration` by anyone, or the expiration worker). | `offer_id`; `caller` or `via` |
| `sneedex_offer_complete` | The offer got its winner (the bid becomes Won). | `offer_id`, `bid_id`, `buyer`, `price_ledger`, `amount`, `reason` (`buyout`, `accept`, `expiry`); `caller` or `via` |
| `sneedex_asset_deliver` | One asset reached its recipient. | `offer_id`, `asset_index`, `asset`, `to`, `side` (`buyer` or `seller`); for tokens `amount` and `ledger_tx` when a transfer happened; for NFTs (ICRC-7 and EXT) `moved` (tokens moved); `escrowed` = 0 when an asset that was never marked escrowed (ICRC-1, ICRC-7 or EXT) was returned best effort on cancel or expiry; `recovered` = 1 when handed over from an offer already Claimed / Reclaimed; `caller` or `via` |
| `sneedex_offer_settle` | Every asset arrived; the offer is now Claimed or Reclaimed. | `offer_id`, `outcome` (`claimed` or `reclaimed`), `to`; `caller` or `via` |

Bids and payments:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedex_bid_reserve` | `reserveBid` | `caller`, `bid_id`, `offer_id` |
| `sneedex_bid_excess_refund` | `confirmBid` sent back what the escrow held above the effective bid. | `caller`, `bid_id`, `offer_id`, `ledger`, `amount`, `to`, `ledger_tx` |
| `sneedex_bid_confirm` | `confirmBid` recorded the bid. | `caller`, `bid_id`, `offer_id`, `ledger`, `amount` (effective bid, capped at the buyout) |
| `sneedex_bid_lost` | A bid became Lost. A reservation never confirmed becomes Lost with its offer's completion without a block of its own (it held no escrow; the `sneedex_offer_complete` block covers it). | `bid_id`, `offer_id`, `bidder`, `amount`, `escrowed` (0 for a reservation never confirmed, from blocks written before 2026-10-22), `reason` (`outbid`, `offer_completed`, `offer_cancelled`, `offer_closed`: confirmed after the offer closed, `buyout_race`: another buyout won) |
| `sneedex_bid_refund` | A Lost bid's escrow went back to the bidder (`refundBid`, `retryRefund`, the auto-refund or the sweep). | `bid_id`, `offer_id`, `bidder`, `ledger`, `amount`, `to`, `ledger_tx`; `caller` or `via` |
| `sneedex_bid_escrow_withdraw` | `withdrawBidEscrow` | `caller`, `bid_id`, `offer_id`, `ledger`, `amount`, `to`, `ledger_tx` |
| `sneedex_cut_pay` | The marketplace cut left the winning escrow. | `offer_id`, `bid_id`, `ledger`, `cut` (charged), `amount` (transferred: cut less one ledger fee), `fee_rate_bps`, `to`, `ledger_tx`; `caller` or `via`; `price_tier` (tier of the cut, offers created since special prices) |
| `sneedex_seller_pay` | The seller was paid (the bid becomes ClaimedBySeller). | `offer_id`, `bid_id`, `seller`, `ledger`, `bid_amount`, `cut`, `amount`, `to`, `ledger_tx`; `caller` or `via` |
| `sneedex_creation_fee_pay` | The offer creation fee left the payer's payment subaccount. | `caller`, `payer`, `fee_e8s`, `amount_e8s` (transferred), `to`, `icp_tx`, `price_tier` |
| `sneedex_creation_payment_withdraw` | `withdrawOfferCreationPayment` | `caller`, `amount_e8s`, `to`, `icp_tx` |

Admin (controllers and admins only):

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedex_admin_asset_return` | `adminReclaimStuckTokens` handed one escrowed asset back to the seller. | `caller`, `offer_id`, `asset_index`, `asset`, `to`; for tokens `amount`, `ledger_tx`; for NFTs (ICRC-7 and EXT) `moved` |
| `sneedex_admin_nft_return` | `adminReturnMisplacedNft` | `caller`, `collection`, `token_id`, `to` (account) |
| `sneedex_admin_ext_return` | `adminReturnMisplacedExtNft` | `caller`, `collection`, `token_index`, `token_identifier`, `from_offer_id` when given, `from_account_id` (Text), `to` (principal) |
| `sneedex_config_update` | A setting changed. | `caller`, `key`, `value`; `old_value` when known |

`sneedex_config_update` keys: `admin_prices` (Map of the set overrides; `old_value` the previous Map), `partner_prices` (with `partner`; value Map `label`, `prices`, `expires_at` when set, or Text `removed`); `admin_added`, `admin_removed`; one block per changed field of the configuration (`admins`, `min_offer_duration_ns`, `max_assets_per_offer`, `min_increment_usd_range_min`, `min_increment_usd_range_max`, `min_increment_usd_target`, `min_increment_fallback_tokens`); `marketplace_fee_rate_bps`, `premium_auction_cut_bps`, `offer_creation_fee_e8s`, `premium_offer_creation_fee_e8s`, `fee_recipient` (account), `ledger_fee_recipient` (Map `ledger`, `account`), `ledger_fee_recipient_removed`; `sneed_premium_canister_id`, `backend_canister_id`, `neuron_manager_factory_canister_id`, `sneed_sms_canister_id` (principal, or Text `none`), `sneed_lock_canister_id`; `asset_type_added` (Map `id`, `name`), `asset_type_deactivated`, `asset_type_reactivated`; `expiration_timer` (`on` / `off`), `expiration_check_interval_seconds`, `neuron_info_cache_staleness_seconds`; `icrc3_proposal_neuron` and the log settings `icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`; `rate_limit.<action>` (Map `capacity`, `per_minute`: the rule in force after and before the change).

Not logged: notification settings, the staking-bot info cache, cached stakes, wallet registration in Sneed Hub, and reads.

### 8.4 Verifying the log

The procedure and the Node.js script of [Sneed Lock's 8.4](/api/sneed_lock#84-verifying-the-log) work unchanged for Sneedex: set the canister id to `7bvk3-ryaaa-aaaal-qtykq-cai` (or staging `igm46-laaaa-aaaae-qgwra-cai`). In short: verify `icrc3_get_tip_certificate` against the IC root key and read `last_block_index` and `last_block_hash`; download every block, following `archived_blocks` callbacks; recompute each hash and check every `phash` link and the certified last hash; check every `btype` against `icrc3_supported_block_types`. No Sneed DAO service is involved.

### 8.5 Using the log

- **Browse it:** [app.sneeddao.com/tools/icrc3?canister=7bvk3-ryaaa-aaaal-qtykq-cai](https://app.sneeddao.com/tools/icrc3?canister=7bvk3-ryaaa-aaaal-qtykq-cai), the generic ICRC-3 browser.
- **History of one offer:** keep the blocks whose `tx.offer_id` matches; for a bid, `tx.bid_id`.
- **Check a payment on its ledger:** every transfer block has the ledger (`ledger`, or ICP for `icp_tx`) and the block index there.
- **Monitoring:** poll `icrc3_log_status().log_length` and fetch only the new blocks.

---

## 9. Integration checklist

- Read state with `getOfferFeed` (paged) rather than the unpaged lists once you show more than a handful of offers.
- Before `createOffer`, show the user `getEffectiveOfferCreationFee(me)` and top up `getOfferCreationPaymentSubaccount(me)`; after a timeout, look for the draft with `getOffersByCreator(me)` before retrying.
- Escrow subaccounts come from `getOfferEscrowSubaccount(creator, offerId)` and `getBidEscrowSubaccount(bidder, bidId)`: always the creator's or bidder's principal plus the id.
- ICRC-1 assets: deposit `amount + fee` so the buyer receives `amount`.
- Canisters: add Sneedex as a controller; neurons: give Sneedex all owner permissions (1–10). Sneedex removes everyone else.
- NFTs: prefer ICRC-37 approval with `escrowICRC7NFTsByApproval`; for plain ICRC-7 make sure the collection honours subaccounts.
- EXT NFTs: list only cards the seller's default account holds; send each to `getOfferEscrowAccountId(creator, offerId)` as `to = variant { address = … }`, then call `escrowEXTNFTs`. Regenerate bindings so offers with `EXTNFT` assets decode.
- Sneed Lock NFTs and `SneedLock` assets must stay locked past the offer's `expiration`; token locks need gas (two fees in the gas tank, or one free fee in Sneedex's Sneed Lock wallet).
- Bids: reserve, send exactly the amount, confirm. Handle `BidTooLow` and `BidIncrementTooSmall` by showing `minimum` / `minimum_next`. If confirmation fails, offer `withdrawBidEscrow(bidId, balance − fee)`.
- After completion wait for `Claimed` and `ClaimedBySeller`; offer `claimAssets` / `claimWinningBid` buttons if they do not come within a minute (an offer that stays `Completed` has an asset whose hand-over failed; `claimAssets` retries it and its error says which).
- Private offers restrict bidding, they do not hide anything; everything except `note_to_buyer` is public.
- To audit or index the market, read the ICRC-3 log (section 8) and verify its tip certificate instead of polling every offer.
- Test on staging (`igm46-laaaa-aaaae-qgwra-cai`) first; it uses real tokens.
