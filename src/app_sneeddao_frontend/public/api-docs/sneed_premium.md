# Sneed Premium canister API

Sneed Premium is the membership registry of Sneed DAO. It keeps one record per principal: the moment that principal's premium membership expires. Members get it by paying ICP, by proving they stake SNEED (voting power in Sneed DAO's SNS), or with a promo code. Any canister or front end can ask whether a principal is a member and use the answer to unlock features or discounts; Sneed Lock, Sneedex, the forum, Sneed SMS, the naming canisters and others already do. Asking costs nothing and needs no permission.

| | |
|---|---|
| Production canister | `7gump-4aaaa-aaaal-qtyka-cai` |
| Staging canister | `sf5tm-dqaaa-aaaae-qgyla-cai` (separate state and members, same code line; use it to test) |
| Candid interface | [sneed_premium.did](/api-docs/sneed_premium.did) · [JavaScript IDL factory](/api-docs/sneed_premium.did.js) |
| Source | [src/sneed_premium/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_premium/main.mo) · [Types.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_premium/Types.mo) · [Utils.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_premium/Utils.mo) · [PremiumClient.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/PremiumClient.mo) (Motoko client with cache) |
| Reference frontend | [app.sneeddao.com/premium](https://app.sneeddao.com/premium) ([source](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend)) |
| This document | [rendered](/api/sneed_premium) · [raw Markdown](/api-docs/sneed_premium.md) |

The production canister is controlled by Sneed DAO's SNS root; upgrades are decided by Sneed DAO proposals. The method set below matches the source on `main`.

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister (units and encoding, authentication, fees, transfers and irreversible actions, asynchronous flows and polling, common pitfalls) that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 One expiry per principal

A membership is `{ principal; expiration; lastUpdated }`. A principal is a member while `expiration > now`. There are no levels: every member has the same premium status, and the different ways in only decide how long it lasts.

### 1.2 Three ways in

| Way | Method | How the duration is set | Additive? |
|---|---|---|---|
| Pay ICP | `purchaseWithIcp` | The **ICP tier** whose `amountE8s` equals the deposit exactly | Yes: added to the remaining time (or to now if expired) |
| Stake SNEED | `claimWithVotingPower` | The best **voting power tier** the caller qualifies for | No: sets `now + duration` if that is later than the current expiry |
| Promo code | `claimPromoCode` | The code's `durationNs` | Yes |

Tiers are lists kept by the DAO's admins. Read the active ones with `getIcpTiers()` and `getVotingPowerTiers()`; their `name`, `amountE8s`/`minVotingPowerE8s` and `durationNs` change over time, so never hard-code them.

Voting power claims are deliberately not additive: holding SNEED keeps a membership topped up, it cannot be banked by claiming over and over. A claim also refuses while the caller's previous voting power claim is younger than `minClaimIntervalNs` (`getConfig()`).

### 1.3 Time and amounts

Times are `int` nanoseconds since the Unix epoch (`Time`, `Timestamp` in the Candid), the same unit as `Time.now()` in Motoko and `BigInt(Date.now()) * 1_000_000n` in JavaScript. Durations are `nat` nanoseconds. ICP amounts are e8s; voting power is in e8s of SNEED-equivalent voting power, as SNS governance computes it.

### 1.4 The deposit account

Each user pays from their own deposit account on the premium canister:

```
{ owner = sneed_premium; subaccount = principalToSubAccount(user) }
```

`principalToSubAccount` is the standard 32-byte layout (byte 0 = length of the principal's bytes, then the bytes, then zeros), the same as in `@dfinity/utils`. `getDepositAccount(user)` returns it, so you never need to compute it yourself. Only the user can take what is in it back out (`withdrawDeposit`, 2.6).

### 1.5 Public, not private

Membership is public data. `checkMembership` answers for any principal, `getActivePremiumMembers()` lists every current member (the Sneed app uses it to show crown badges next to names), and every purchase, claim, grant and setting change is a block in the public activity log ([section 7](#7-activity-log-icrc-3)). Only `getMembershipDetails` is limited to the principal itself (or an admin), and it only adds `lastUpdated`.

### 1.6 Calls the canister refuses at ingress

The canister's `inspect_message` checks update calls from outside the IC before accepting them:

- **Query methods only answer query calls.** Calling one as an update (for example `dfx canister call` with `--update`) is refused.
- **Arguments are capped.** Most updates take at most 4 KiB of argument. `claimPromoCode` accepts a code of at most 64 characters. Admin methods with free-form content (`addIcpTier`, `addVpTier`, `updateIcpTier`, `updateVpTier`, `createPromoCode`, `deactivatePromoCode`, `reactivatePromoCode`, `deletePromoCode`, `updateConfig`) are refused at ingress unless the caller is an admin.

Canister-to-canister calls are not affected.

---

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './sneed_premium.did.js'; // https://app.sneeddao.com/api-docs/sneed_premium.did.js

const SNEED_PREMIUM = '7gump-4aaaa-aaaal-qtyka-cai';

export function premiumActor(identity) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId: SNEED_PREMIUM });
}
```

With dfx:

```bash
dfx canister --network ic call 7gump-4aaaa-aaaal-qtyka-cai checkMembership '(principal "aaaaa-aa")' --query
dfx canister --network ic call 7gump-4aaaa-aaaal-qtyka-cai getIcpTiers '()' --query
```

### 2.2 Is this principal a member?

```js
async function isPremium(actor, principal) {
  const status = await actor.checkMembership(principal);
  if ('Active' in status) return { premium: true, until: status.Active.expiration };   // bigint ns
  if ('Expired' in status) return { premium: false, expiredAt: status.Expired.expiredAt };
  return { premium: false };                                                           // NotFound
}
```

Cache the answer until `expiration`: a membership never shrinks except when an admin revokes it. For many principals at once (badges in a list), fetch `getActivePremiumMembers()` once and test membership in a `Set`.

### 2.3 Buy membership with ICP

1. Pick an active tier from `getIcpTiers()`.
2. Send exactly `tier.amountE8s` ICP to the user's deposit account (the ledger fee is paid on top by the sender, as usual).
3. Call `purchaseWithIcp()`.

```js
import { Principal } from '@dfinity/principal';

async function buyPremium({ identity, icpLedger, tier }) {
  const premium = premiumActor(identity);
  const me = identity.getPrincipal();
  const deposit = await premium.getDepositAccount(me);   // { owner, subaccount: [blob] }

  // 2. Deposit exactly the tier amount
  const sent = await icpLedger.icrc1_transfer({
    to: deposit, amount: tier.amountE8s,
    fee: [], memo: [], from_subaccount: [], created_at_time: [],
  });
  if ('Err' in sent) throw new Error(JSON.stringify(sent.Err));

  // 3. Convert the deposit into membership
  const r = await premium.purchaseWithIcp();
  if ('err' in r) throw new Error(Object.keys(r.err)[0]);   // InvalidTier, InsufficientPayment, ...
  return r.ok;                                               // Membership with the new expiration
}
```

The canister matches the **whole balance** of the deposit account against the active tiers. If the balance equals no tier amount (you sent too little, too much, or two deposits that add up to something else), the call returns `InvalidTier` and the ICP stays in the deposit account. Top it up until it equals a tier amount and call again, or take it back with `withdrawDeposit()` (2.6).

### 2.4 Claim membership with staked SNEED

```js
const r = await premiumActor(identity).claimWithVotingPower();
if ('ok' in r) console.log('member until', r.ok.expiration);
else if ('AlreadyClaimedRecently' in r.err) console.log('next claim at', r.err.AlreadyClaimedRecently.nextClaimTime);
else if ('InsufficientVotingPower' in r.err) console.log(r.err.InsufficientVotingPower);   // { required; found }
```

### 2.5 Redeem a promo code

```js
const r = await premiumActor(identity).claimPromoCode('ABCDEFGH');
// ok: Membership | err: InvalidCode | CodeInactive | CodeExpired | CodeFullyClaimed | AlreadyClaimed | NotAuthorized | InternalError
```

### 2.6 Take back a deposit

A deposit that matches no tier (or that the user no longer wants to spend) can be taken back. `withdrawDeposit()` sends the whole balance of the caller's own deposit account, minus the ledger fee, to the caller's default account. It only ever touches the caller's own deposit account.

```js
const r = await premiumActor(identity).withdrawDeposit();
if ('ok' in r) console.log('returned', r.ok.amountE8s, 'e8s in block', r.ok.blockIndex);
else console.log(Object.keys(r.err)[0]);   // NothingToWithdraw, InProgress, TransferFailed, NotAuthorized
```

---

## 3. Flows in detail

### 3.1 Purchase with ICP

`purchaseWithIcp()`:

1. Refuses the anonymous principal (`NotAuthorized`).
2. Reads the ICP balance of the caller's deposit account.
3. Finds the active ICP tier whose price for the caller equals that balance (the longest one if several are equal): its `amountE8s`, or the caller's special price for it (see 3.5). None: `InvalidTier`.
4. Reads the ledger fee. If the balance is not larger than the fee: `InsufficientPayment { required; received }`.
5. Transfers `balance − fee` to the DAO's payment recipient (`getConfig().paymentRecipient`). A ledger error returns `TransferFailed(text)` and changes nothing.
6. Records the payment, extends the membership by the tier's duration (from the current expiry, or from now if it has passed), records the claim, and returns `ok(Membership)`.

Payments go straight to the DAO's account; the canister keeps nothing.

### 3.2 Claim with voting power

`claimWithVotingPower()`:

1. Refuses the anonymous principal (`NotAuthorized`).
2. Refuses if the caller's last voting power claim is younger than `minClaimIntervalNs`: `AlreadyClaimedRecently { lastClaimTime; intervalNs; nextClaimTime }`.
3. No active voting power tier: `NoActiveTiers`.
4. Asks Sneed SNS governance (`fi3zi-fyaaa-aaaaq-aachq-cai`) for the neurons of the caller (`list_neurons` with `of_principal = caller`, first 100). None: `NoEligibleNeurons`.
5. Adds up the voting power of every listed neuron on which the caller has a permission (owner or hotkey), computed like SNS governance does: stake plus staked maturity, dissolve delay bonus, age bonus, the neuron's voting power multiplier; neurons below the minimum dissolve delay to vote count zero.
6. Picks the active tier with the highest `minVotingPowerE8s` the total reaches. None: `InsufficientVotingPower { required; found }` (`required` is the lowest tier minimum).
7. Sets the expiry to `max(current, now + tier.durationNs)`, records the claim, and returns `ok(Membership)`.

Hotkeys count: a principal added as hotkey to someone's neuron can claim with that neuron's voting power. That is how SNS permissions work, and it lets a user claim from a different login than the one that owns the neuron.

### 3.3 Promo codes

Admins create codes (8 capital letters drawn from the IC's randomness, `raw_rand`) with a duration, a maximum number of claims and an optional expiry. `claimPromoCode(code)` refuses the anonymous principal, unknown codes (`InvalidCode`), deactivated codes (`CodeInactive`), codes past their expiry (`CodeExpired`), codes that reached `maxClaims` (`CodeFullyClaimed`) and a second claim of the same code by the same principal (`AlreadyClaimed`). Otherwise it adds the code's duration to the membership.

### 3.4 Checking membership from a canister

Motoko canisters can use [`src/PremiumClient.mo`](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/PremiumClient.mo): it calls `checkMembership` and caches each principal's expiry in a stable map, so a member is only looked up again after their membership would have run out.

```motoko
import PremiumClient "../PremiumClient";

var premiumCache = PremiumClient.emptyCache();
let SNEED_PREMIUM = Principal.fromText("7gump-4aaaa-aaaal-qtyka-cai");

public shared ({ caller }) func doSomething() : async () {
  let premium = await* PremiumClient.isPremium(premiumCache, SNEED_PREMIUM, caller);
  // ...
};
```

The direct interface is just:

```motoko
actor { checkMembership : shared query (Principal) -> async { #Active : { expiration : Int }; #Expired : { expiredAt : Int }; #NotFound } }
```

Because a cached answer can outlive an admin revocation, treat a cache as "good enough for discounts", and call `checkMembership` directly where it must be exact.

---

### 3.5 Special prices: admin and partner prices

Next to the regular tier prices the canister has an **admin price** and **partner prices** (spec/special_prices.md). Buying premium has one fee, the ICP tier price, so the override is a share of every active ICP tier's price in basis points:

```candid
type SpecialPrices = record { icp_tier_price_bps : opt nat };   // 10_000 = the regular price, 5_000 = half; null = no override
type PartnerPrices = record { label : text; prices : SpecialPrices; expires_at : opt int };   // expires_at: ns since 1970
type PriceTier = variant { regular; premium; admin; partner };
```

- The **admin price** applies to admins (controllers and `getConfig().admins`) whose principal is a person's key (self-authenticating); a canister on the admin list, such as SNS governance, never gets it.
- A **partner price** applies to one principal (usually a partner canister that integrates with Sneed Premium, for example a partner game canister buying memberships for its players), until `expires_at` if set.
- The caller's share is the lowest of 10_000 (regular), the admin share (if it applies) and the partner share (if it applies); on a tie the earlier of regular, admin, partner is reported. A tier then costs `amountE8s * bps / 10_000` (rounded down), and `purchaseWithIcp` accepts a deposit of exactly that amount, as `price_tier = admin` or `partner`. A deposit of a tier's regular `amountE8s` still buys that tier too, as `regular`. There is no premium price for buying premium. With no admin price and no partners nothing changes.
- `get_icp_tier_prices_for(principal)` lists every active tier with the amount that principal deposits for it (`price_e8s`) and the `price_tier`; partner canisters should read it before each purchase.
- Every purchase since special prices exist records its `price_tier`: `get_icp_payment_price_tier(id)` for an ICP payment log id (older payments are `regular`) and the `price_tier` field of the `premium_icp_purchase` block.
- Every change is public (`get_special_prices`) and a `premium_config_update` block (keys `admin_prices`, `partner_prices`).

## 4. Concurrency, errors and retries

**Result shapes.** User updates return `variant { ok : Membership; err : … }` with a variant error per method (section 6). Admin methods return `AdminResult` (`ok` or `err : AdminError`, where `AdminError` is `NotAuthorized`, `NotFound` or `InvalidInput(text)`).

**Purchases.** `purchaseWithIcp` consumes the whole deposit balance in one ledger transfer. Retrying after a timeout is safe: if the first call went through, the deposit account is empty and the retry returns `InvalidTier` (or `InsufficientPayment`) without charging anything; check `checkMembership` to see the new expiry. One purchase or withdrawal runs at a time per caller: a second one sent while the first is still running returns `InternalError` (purchase) or `InProgress` (withdrawal) without touching the ledger.

**Withdrawals.** `withdrawDeposit` moves the whole deposit balance minus the fee in one ledger transfer to the caller. Retrying after a timeout is safe: if the first call went through, the retry returns `NothingToWithdraw`.

**Voting power claims.** The claim interval is checked before and again after the governance calls, so concurrent claims by one principal grant at most once per interval.

**Thrown errors.** Admin-only log queries (`getClaimLog`, `getIcpPaymentLog` and their counts) trap for non-admins rather than returning an error. Other methods return their error variants.

---

## 5. Method reference

"Caller" is the principal that signs the call. Methods marked *query* can be called without a signature.

### 5.1 Membership (public queries)

| Method | Returns | Notes |
|---|---|---|
| `checkMembership(principal)` | `MembershipStatus` | `Active { expiration }`, `Expired { expiredAt }` or `NotFound`. The method other canisters call. |
| `getActivePremiumMembers()` | `vec principal` | Every principal whose membership has not expired. |
| `getMembershipDetails(principal)` | `opt Membership` | The full record, only for the principal itself or an admin; `null` for anyone else. |
| `getDepositAccount(user)` | `Account` | `{ owner = sneed_premium; subaccount = principalToSubAccount(user) }`. |
| `getPaymentStats()` | record | `total_icp_collected_e8s` (gross deposits), `total_icp_payments`, `total_vp_claims`, `total_promo_claims`, `total_claims`, `claim_log_size`, `payment_log_size`. Shown on the Sneed app's revenue page. |
| `getCanisterId()` | `principal` | The canister's own id. |

### 5.2 Tiers and configuration (public queries)

| Method | Returns | Notes |
|---|---|---|
| `getIcpTiers()` | `vec IcpTier` | Active ICP tiers. |
| `getVotingPowerTiers()` | `vec VotingPowerTier` | Active voting power tiers. |
| `getAllIcpTiers()` | `vec IcpTier` | All ICP tiers including inactive ones, in index order (the index is what the admin update/remove methods take). |
| `getAllVotingPowerTiers()` | `vec VotingPowerTier` | Same for voting power tiers. |
| `getConfig()` | `Config` | `admins`, `icpLedgerId`, `sneedGovernanceId`, `paymentRecipient`, `minClaimIntervalNs`. |
| `isCallerAdmin()` | `bool` | Controllers and listed admins are admins. |
| `get_special_prices()` | `record { admin_prices : SpecialPrices; partners : vec record { principal; label; prices; expires_at } }` | The admin price and every partner entry, expired ones too (3.5). |
| `get_special_prices_for(principal)` | `record { admin_prices : opt SpecialPrices; partner : opt PartnerPrices }` | What applies to that principal: the admin price if it is an admin and a person, its partner entry if it has not expired. |
| `get_icp_tier_prices_for(principal)` | `vec record { tier : IcpTier; price_e8s : nat; price_tier : PriceTier }` | Every active ICP tier with the amount that principal deposits for it. |
| `get_icp_payment_price_tier(id)` | `opt PriceTier` | The price tier ICP payment `id` (payment log id) paid; `null` for an unknown id; payments from before special prices are `regular`. |

### 5.3 Getting membership (updates)

**`purchaseWithIcp() → PurchaseResult`**
See 3.1. Errors: `NotAuthorized` (anonymous caller), `InvalidTier` (deposit balance matches no active tier), `InsufficientPayment { required; received }` (balance not above the ledger fee), `TransferFailed(text)` (`Temporarily unavailable`, `Insufficient funds`, `Bad fee`, … or the ledger's generic message). `InternalError(text)` when the same caller already has a purchase or withdrawal running. The Candid also lists `TierNotActive`; the current code does not return it.

**`withdrawDeposit() → WithdrawResult`**
See 2.6. Sends the caller's own deposit balance (`getDepositAccount(caller)`) minus the ledger fee to the caller's default account (`{ owner = caller; subaccount = null }`). `ok`: `{ amountE8s; blockIndex; to }`. Errors: `NotAuthorized` (anonymous caller), `NothingToWithdraw { balance; fee }` (balance not above the fee), `InProgress` (a purchase or withdrawal of the caller is running), `TransferFailed(text)`. Nobody can withdraw from another principal's deposit account.

**`claimWithVotingPower() → ClaimResult`**
See 3.2. Errors: `NotAuthorized`, `AlreadyClaimedRecently { lastClaimTime; intervalNs; nextClaimTime }`, `NoActiveTiers`, `NoEligibleNeurons`, `InsufficientVotingPower { required; found }`. `InternalError` is in the Candid but not returned today.

**`claimPromoCode(code : text) → PromoCodeResult`**
See 3.3. Errors: `NotAuthorized`, `InvalidCode`, `CodeInactive`, `CodeExpired`, `CodeFullyClaimed`, `AlreadyClaimed`. Codes are case-sensitive (they are generated in capitals).

### 5.4 Admin methods

Admins are the canister's controllers (the SNS root on production) and the principals in `getConfig().admins`. Integrators never call these.

| Method | Purpose |
|---|---|
| `addAdmin`, `removeAdmin` | Manage the admin list. |
| `updateConfig`, `setIcpLedgerId`, `setSneedGovernanceId`, `setPaymentRecipient`, `setMinClaimInterval` | Configuration. |
| `addIcpTier`, `updateIcpTier`, `removeIcpTier` | ICP tiers (amount and duration must be positive). |
| `addVpTier`, `updateVpTier`, `removeVpTier` | Voting power tiers (duration must be positive). |
| `setMembershipAdmin(principal, expirationNs)` | Set a membership's expiry directly (complimentary memberships). |
| `extendMembershipAdmin(principal, durationNs)` | Extend a membership. |
| `revokeMembership(principal)` | Remove a membership. |
| `set_admin_prices(SpecialPrices)` | The admin price (3.5); `icp_tier_price_bps` 1 to 10_000 or null. Returns `variant { ok; err : text }`. |
| `set_partner_prices(principal, PartnerPrices)` | Add or replace a partner (label 1 to 100 characters, expiry in the future, at most 200 partners, not the anonymous principal). |
| `remove_partner_prices(principal)` | Remove a partner (`err` if it has none). |
| `createPromoCode`, `deactivatePromoCode`, `reactivatePromoCode`, `deletePromoCode` | Promo codes. |
| `getPromoCodes()`, `getPromoCodeClaims(code)` | Read promo codes and their claims (`err NotAuthorized` for others). |
| `getPromoCodeIds()` | Every promo code with the `code_id` the activity log names it by (`err NotAuthorized` for others). |
| `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`, `admin_set_icrc3_proposal_neuron`, `admin_icrc3_register_archives_now`, `admin_icrc3_reset_archive_registration` | The activity log's archives and their SNS registration ([section 7](#7-activity-log-icrc-3)). |
| `getAllMemberships()` | Every membership record, expired ones included (empty for non-admins). |
| `getClaimLog(offset, limit)`, `getClaimLogCount()` | Unified log of every purchase and claim, newest first (traps for non-admins). |
| `getIcpPaymentLog(offset, limit)`, `getIcpPaymentLogCount()` | ICP payments with gross and net amounts and the ledger block index, newest first (traps for non-admins). |

---

## 6. Types

```candid
type Time = int;                       // ns since Unix epoch
type Account = record { owner : principal; subaccount : opt blob };

type Membership = record { "principal" : principal; expiration : Time; lastUpdated : Time };
type MembershipStatus = variant {
  Active : record { expiration : Time };
  Expired : record { expiredAt : Time };
  NotFound;
};

type IcpTier = record { name : text; amountE8s : nat; durationNs : nat; active : bool };
type VotingPowerTier = record { name : text; minVotingPowerE8s : nat; durationNs : nat; active : bool };

type Config = record {
  admins : vec principal;
  icpLedgerId : principal;
  sneedGovernanceId : principal;
  paymentRecipient : Account;
  minClaimIntervalNs : nat;
};

type PurchaseResult = variant { ok : Membership; err : PurchaseError };
type PurchaseError = variant {
  NotAuthorized; InvalidTier; TierNotActive;
  InsufficientPayment : record { required : nat; received : nat };
  TransferFailed : text; InternalError : text;
};

type WithdrawResult = variant { ok : Withdrawal; err : WithdrawError };
type Withdrawal = record { amountE8s : nat; blockIndex : nat; to : Account };
type WithdrawError = variant {
  NotAuthorized; InProgress; TransferFailed : text;
  NothingToWithdraw : record { balance : nat; fee : nat };
};

type ClaimResult = variant { ok : Membership; err : ClaimError };
type ClaimError = variant {
  NotAuthorized; NoActiveTiers; NoEligibleNeurons;
  InsufficientVotingPower : record { required : nat; found : nat };
  AlreadyClaimedRecently : record { lastClaimTime : Time; intervalNs : nat; nextClaimTime : Time };
  InternalError : text;
};

type PromoCodeResult = variant { ok : Membership; err : PromoCodeError };
type PromoCodeError = variant {
  NotAuthorized; InvalidCode; CodeExpired; CodeFullyClaimed; CodeInactive; AlreadyClaimed; InternalError : text;
};

type AdminError = variant { NotAuthorized; NotFound; InvalidInput : text };
```

The complete interface, with the promo code and log types, is in [sneed_premium.did](/api-docs/sneed_premium.did).

---

## 7. Activity log (ICRC-3)

Every change to a membership, to the ICP that pays for one, to promo codes, tiers and the configuration is recorded as a block in a hash-chained, certified log, readable through the standard [ICRC-3](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3) interface. Each block carries the hash of the previous block (`phash`), and the canister certifies the index and hash of the latest block, so anyone can download the history and prove it complete and untampered without trusting Sneed DAO or this app. Old blocks move to archive canisters that the premium canister creates.

The log uses the same library as [Sneed Lock's log](/api/sneed_lock#8-activity-log-icrc-3) ([src/icrc3](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/icrc3)); the design is in [spec/sneed_premium_icrc3.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sneed_premium_icrc3.md). It starts empty with the release that introduced it; memberships and payments from before are not imported (they are in the admin-only `getClaimLog` and `getIcpPaymentLog`, which are still written).

### 7.1 Endpoints

| Method | Type | Returns |
|---|---|---|
| `icrc3_get_blocks(vec record { start : nat; length : nat })` | query | `{ log_length; blocks : vec { id; block }; archived_blocks : vec { args; callback } }`. Live blocks come back directly; for archived ranges call `callback` (that archive's own `icrc3_get_blocks`) with `args`. |
| `icrc3_get_archives(record { from : opt principal })` | query | Every archive canister with the first and last block index it holds. |
| `icrc3_get_tip_certificate()` | query | `opt { certificate; hash_tree }` with `last_block_index` and `last_block_hash`. Null until the first block exists. |
| `icrc3_supported_block_types()` | query | Every `btype` below, each with the url of [7.3](#73-block-types). |
| `icrc10_supported_standards()` | query | ICRC-3 and ICRC-10. |
| `icrc3_log_status()` | query | Log length, live blocks, hash of the last block, archives, spill settings. `history_imported` is always false. |
| `icrc3_registration_status()` | query | Per archive, the SNS proposal that registered it as a DAO canister. |

Admin only: `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`, `admin_set_icrc3_proposal_neuron`, `admin_icrc3_register_archives_now`, `admin_icrc3_reset_archive_registration` (as on Sneed Lock), and `getPromoCodeIds()`. Archives are controlled by the premium canister and the Sneed SNS root until a `RegisterDappCanisters` proposal hands them to SNS root alone.

### 7.2 Block format

A block is a `Map` with `btype` (Text), `ts` (Nat, ns since epoch: when the action happened), `phash` (Blob, absent on block 0) and `tx` (Map). Inside `tx`:

- Principals are `Blob` (raw principal bytes); ICRC-1 accounts are `Array [owner, subaccount?]`.
- ICP amounts and voting power are `Nat` e8s; durations and times are `Nat` nanoseconds (an expiration an admin set before 1970 would be `Int`); flags are `Nat` 0 or 1.
- `caller` is the principal that made the call. Optional fields are omitted when absent: `previous_expiration` (the membership's expiration before the change) is left out when the principal had no membership record.
- `tier` / `old_tier`: an ICP tier is `Map { name; amount_e8s; duration_ns; active }`, a voting power tier `Map { name; min_voting_power_e8s; duration_ns; active }`.
- **Promo codes are named by `code_id`, never by their text**: a code in a public log could be claimed by anyone reading it. Admins map ids to codes with `getPromoCodeIds()`. Promo code notes are not logged either. Everything else in the log is already public (membership, tiers, configuration, ICP transfers on the ICP ledger); nothing on the IC is anonymous.

### 7.3 Block types

All types carry the `premium_` prefix. A block is appended only once its action is final, in the message that records it: after the ICP ledger transfer returned `Ok`, after SNS governance answered and the membership was written. A refused or failed call appends nothing.

| `btype` | When | `tx` fields |
|---|---|---|
| `premium_icp_purchase` | `purchaseWithIcp` swept the deposit to the payment recipient and extended the membership. | `caller`, `tier` (name), `duration_ns`, `amount_e8s` (the deposit charged), `fee_e8s` (ledger fee), `to` (payment recipient account), `icp_tx` (ICP ledger block of the sweep), `price_tier` (`regular`, `admin` or `partner`, section 3.5), `previous_expiration`, `new_expiration` |
| `premium_vp_claim` | `claimWithVotingPower` granted a tier. | `caller`, `voting_power`, `tier`, `duration_ns`, `previous_expiration`, `new_expiration` (not additive: may equal the previous one) |
| `premium_deposit_withdraw` | `withdrawDeposit` sent the caller's deposit back. | `caller`, `amount_e8s` (transferred), `fee_e8s`, `to` (account), `icp_tx` |
| `premium_promo_create` | `createPromoCode` | `caller`, `code_id`, `duration_ns`, `max_claims`; `code_expiration` when set |
| `premium_promo_claim` | `claimPromoCode` granted the code's duration. | `caller`, `code_id`, `duration_ns`, `claim_count` (after this claim), `previous_expiration`, `new_expiration` |
| `premium_promo_deactivate` | `deactivatePromoCode` | `caller`, `code_id` |
| `premium_promo_reactivate` | `reactivatePromoCode` | `caller`, `code_id` |
| `premium_promo_delete` | `deletePromoCode` | `caller`, `code_id`, `claim_count` |
| `premium_admin_set` | `setMembershipAdmin` | `caller`, `principal`, `previous_expiration`, `new_expiration` |
| `premium_admin_extend` | `extendMembershipAdmin` | `caller`, `principal`, `duration_ns`, `previous_expiration`, `new_expiration` |
| `premium_admin_revoke` | `revokeMembership` removed a membership (revoking a non-member logs nothing). | `caller`, `principal`, `previous_expiration` |
| `premium_tier_add` | `addIcpTier`, `addVpTier` | `caller`, `kind` (`icp` or `vp`), `index`, `tier` |
| `premium_tier_update` | `updateIcpTier`, `updateVpTier` | `caller`, `kind`, `index`, `tier`, `old_tier` |
| `premium_tier_remove` | `removeIcpTier`, `removeVpTier` | `caller`, `kind`, `index`, `old_tier` |
| `premium_config_update` | A setting changed. | `caller`, `key`, `value`; `old_value` when known |

`premium_config_update` keys: `admin_added`, `admin_removed` (only when the list changed); `admins`, `icp_ledger_id`, `sneed_governance_id`, `payment_recipient` (account), `min_claim_interval_ns` (from the single setters, and one block per changed field from `updateConfig`); `icrc3_proposal_neuron` and the log settings `icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`; `admin_prices` (map of the set overrides) and `partner_prices` (with a `partner` field; value `{ label; prices; expires_at }` or `removed`) for special prices (section 3.5).

Not logged: the time of each voting power claim (the rate limit), the legacy claim and payment log entries and statistics (they repeat these blocks), promo code texts and notes, and reads.

### 7.4 Verifying and using the log

- **Verify it:** the procedure and the Node.js script of [Sneed Lock's 8.4](/api/sneed_lock#84-verifying-the-log) work unchanged with the canister id `7gump-4aaaa-aaaal-qtyka-cai` (or staging `sf5tm-dqaaa-aaaae-qgyla-cai`).
- **Browse it:** [app.sneeddao.com/tools/icrc3?canister=7gump-4aaaa-aaaal-qtyka-cai](https://app.sneeddao.com/tools/icrc3?canister=7gump-4aaaa-aaaal-qtyka-cai), the generic ICRC-3 browser.
- **History of one member:** keep the blocks whose `tx.caller` or `tx.principal` is that principal.
- **Check a payment:** `icp_tx` is the block index on the ICP ledger.

---

## 8. Integration checklist

- Gate features with `checkMembership` (or `getActivePremiumMembers` for lists), and cache until `expiration`.
- Read tiers from `getIcpTiers()` / `getVotingPowerTiers()` every time you show them; they are DAO-managed.
- For ICP purchases, deposit **exactly** one tier amount to `getDepositAccount(user)` before calling `purchaseWithIcp`; anything else returns `InvalidTier` and waits in the deposit account until topped up or taken back with `withdrawDeposit`.
- After a timeout, read `checkMembership` before retrying a purchase; a retry never charges twice.
- Show `nextClaimTime` when a voting power claim returns `AlreadyClaimedRecently`, and tell users that claims refresh, they do not stack.
- Use the staging canister `sf5tm-dqaaa-aaaae-qgyla-cai` to test; it has its own tiers and members.
