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

`principalToSubAccount` is the standard 32-byte layout (byte 0 = length of the principal's bytes, then the bytes, then zeros), the same as in `@dfinity/utils`. `getDepositAccount(user)` returns it, so you never need to compute it yourself.

### 1.5 Public, not private

Membership is public data. `checkMembership` answers for any principal, `getActivePremiumMembers()` lists every current member (the Sneed app uses it to show crown badges next to names), and every purchase or claim is recorded in logs the admins can read. Only `getMembershipDetails` is limited to the principal itself (or an admin), and it only adds `lastUpdated`.

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

The canister matches the **whole balance** of the deposit account against the active tiers. If the balance equals no tier amount (you sent too little, too much, or two deposits that add up to something else), the call returns `InvalidTier` and the ICP stays in the deposit account. Top it up until it equals a tier amount and call again. There is no refund method.

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

---

## 3. Flows in detail

### 3.1 Purchase with ICP

`purchaseWithIcp()`:

1. Refuses the anonymous principal (`NotAuthorized`).
2. Reads the ICP balance of the caller's deposit account.
3. Finds the active ICP tier whose `amountE8s` equals that balance (the longest one if several are equal). None: `InvalidTier`.
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

Admins create codes (8 random capital letters) with a duration, a maximum number of claims and an optional expiry. `claimPromoCode(code)` refuses the anonymous principal, unknown codes (`InvalidCode`), deactivated codes (`CodeInactive`), codes past their expiry (`CodeExpired`), codes that reached `maxClaims` (`CodeFullyClaimed`) and a second claim of the same code by the same principal (`AlreadyClaimed`). Otherwise it adds the code's duration to the membership.

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

## 4. Concurrency, errors and retries

**Result shapes.** User updates return `variant { ok : Membership; err : … }` with a variant error per method (section 6). Admin methods return `AdminResult` (`ok` or `err : AdminError`, where `AdminError` is `NotAuthorized`, `NotFound` or `InvalidInput(text)`).

**Purchases.** `purchaseWithIcp` consumes the whole deposit balance in one ledger transfer. Retrying after a timeout is safe: if the first call went through, the deposit account is empty and the retry returns `InvalidTier` (or `InsufficientPayment`) without charging anything; check `checkMembership` to see the new expiry. Two simultaneous calls cannot both succeed: the second transfer fails on the ledger and returns `TransferFailed`.

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

### 5.3 Getting membership (updates)

**`purchaseWithIcp() → PurchaseResult`**
See 3.1. Errors: `NotAuthorized` (anonymous caller), `InvalidTier` (deposit balance matches no active tier), `InsufficientPayment { required; received }` (balance not above the ledger fee), `TransferFailed(text)` (`Temporarily unavailable`, `Insufficient funds`, `Bad fee`, … or the ledger's generic message). The Candid also lists `TierNotActive` and `InternalError`; the current code does not return them.

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
| `createPromoCode`, `deactivatePromoCode`, `reactivatePromoCode`, `deletePromoCode` | Promo codes. |
| `getPromoCodes()`, `getPromoCodeClaims(code)` | Read promo codes and their claims (`err NotAuthorized` for others). |
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

## 7. Integration checklist

- Gate features with `checkMembership` (or `getActivePremiumMembers` for lists), and cache until `expiration`.
- Read tiers from `getIcpTiers()` / `getVotingPowerTiers()` every time you show them; they are DAO-managed.
- For ICP purchases, deposit **exactly** one tier amount to `getDepositAccount(user)` before calling `purchaseWithIcp`; anything else returns `InvalidTier` and waits in the deposit account.
- After a timeout, read `checkMembership` before retrying a purchase; a retry never charges twice.
- Show `nextClaimTime` when a voting power claim returns `AlreadyClaimedRecently`, and tell users that claims refresh, they do not stack.
- Use the staging canister `sf5tm-dqaaa-aaaae-qgyla-cai` to test; it has its own tiers and members.
