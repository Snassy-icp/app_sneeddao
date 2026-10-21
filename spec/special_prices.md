# Special prices: admin prices and partner prices

Status: implemented 2026-10-21 (not yet released). Shared code: `src/SpecialPrices.mo`
(canisters), `src/app_sneeddao_frontend/src/utils/specialPrices.js`,
`components/SpecialPricesCard.jsx` and `components/PriceTierBadge.jsx` (frontend).

## 1. What it is

Every Sneed canister that charges users has a **regular** price and a **premium** price (for
Sneed Premium members) per fee. Next to them, each such canister now has:

1. **Admin price.** Applies when the caller is on *that canister's own* admin list and is a
   person (a self-authenticating principal). Canisters on an admin list, such as SNS governance
   or the planned proposal proxy (spec/sneed_proxy.md §9.5), never buy anything and never get
   it. Default: unset, which has no effect. Use case: cheap testing on staging, where admin
   prices are set tiny (not 0, so the payment paths stay exercised).
2. **Partner prices.** A map from principal to price overrides, for named partners (usually a
   partner canister that integrates with ours, for example a partner game canister that creates
   Sneedex offers). Each entry has a **label** (free text, shown publicly), the **overrides**
   (one optional value per fee the canister charges) and an optional **expiry** (nanoseconds
   since 1970).

## 2. The rule

The price charged is the **lowest applicable** one among:

| tier | applies when |
|---|---|
| `regular` | always |
| `premium` | the caller is a Sneed Premium member (as before) |
| `admin` | the caller is on the canister's admin list, is a person, and the admin override for this fee is set |
| `partner` | the caller has a partner entry that has not expired, and its override for this fee is set |

On a tie the earlier tier in that order is reported, so a purchase is recorded as `admin` or
`partner` only when that tier made it cheaper. For percentage cuts (the Sneedex auction cut in
basis points) the same rule applies to the bps value.

Unset overrides change nothing: with no admin prices and no partners every canister charges
exactly what it charged before.

An override is validated like the regular price it stands for (for example, a Sneedapp mint
price must still cover the cycles the mint spends).

## 3. Interface (the same in every charging canister)

`Prices` is a record with one `opt nat` per fee the canister charges (field names per canister
in §5).

```candid
type PartnerPrices = record { label : text; prices : Prices; expires_at : opt int };

set_admin_prices : (Prices) -> (variant { ok; err : text });                         // admin
set_partner_prices : (principal, PartnerPrices) -> (variant { ok; err : text });     // admin
remove_partner_prices : (principal) -> (variant { ok; err : text });                 // admin
get_special_prices : () -> (record {
  admin_prices : Prices;
  partners : vec record { principal : principal; label : text; prices : Prices; expires_at : opt int };
}) query;                                                                             // public
get_special_prices_for : (principal) -> (record {
  admin_prices : opt Prices;                  // set when the principal gets the admin price
  partner : opt PartnerPrices;                // set when it has a partner entry that has not expired
}) query;                                                                             // public
```

- The setters are admin-only, and accept SNS governance where the canister already accepts
  governance as an admin. Anyone else gets `err`. They are narrow (one concern each) so that the
  proposal proxy can map them to the business-logic topic (spec/sneed_proxy.md §5: prices are a
  `B` entry).
- `set_partner_prices` adds or replaces one entry. It refuses the anonymous principal, an empty
  label, a label over 100 characters, an expiry in the past, and a 201st partner.
- `remove_partner_prices` refuses a principal without an entry.
- `get_special_prices` is public and lists expired entries too, with their expiry.

## 4. Transparency and records

- The special prices are part of the canister's public configuration (`get_special_prices`).
- Every change is a config-change block in the canister's ICRC-3 log, where it has one, through
  the canister's existing config-change helper: key `admin_prices` (value: a map of the set
  overrides; `old_value` the previous map) or `partner_prices` (with `partner` = the principal,
  value: `{ label; prices; expires_at? }`, or the text `removed`).
- Every purchase record and fee block gains an additive `price_tier` field: `regular`,
  `premium`, `admin` or `partner`. Stable record types never change: canisters keep the tier in
  a separate map keyed by the record's id where the stored record cannot take a new field.

## 5. Per canister

Each canister's `get_api_doc` and `public/api-docs/<canister>.md` describe its fields; sneed_pad
and sneed_guardian, which have neither, are documented in spec/token_safety.md and
spec/custody.md. All amounts are e8s ICP unless noted.

| canister | persistence, log | `Prices` fields | admin (people only) | tier recorded in | notes |
|---|---|---|---|---|---|
| sneedex | classic, ICRC-3 | `offer_creation_fee_e8s` (0 or ≥ 10_000), `auction_cut_bps` (≤ 5000) | controllers + `config.admins` | `get_offer_price_tiers(offer)`; `price_tier` on `sneedex_creation_fee_pay`, `sneedex_cut_pay`; `price_tier` + `cut_price_tier` on `sneedex_offer_create` | the cut is decided at `createOffer` (seller) and locked into the offer's `fee_rate_bps`, as the premium cut is; `getEffectiveOfferCreationFee` includes special prices |
| sneedapp | classic, ICRC-3 | `mint_fee_e8s` | Sneedapp admins (setters: admins + SNS governance) | `price_tier` on `sneedapp_mint`, `sneedapp_mint_refund` | applies to Sneed DAO apps (publisher 0) and `createNeuronManager`; third-party publishers' prices are never overridden; a price that does not cover the mint's cycles is refused at mint time, as a regular one is; `getAppMintPrice().applicable` includes special prices |
| sneed_lock | classic, ICRC-3 | `token_lock_fee_icp_e8s`, `position_lock_fee_icp_e8s` | controllers, Sneed governance, `admin_list` | `price_tier` on `sneedlock_fee_pay`; `admin_get_payment_price_tiers(ids)` | `getEffectiveLockFee` includes special prices |
| sneed_premium | classic, ICRC-3 | `icp_tier_price_bps` (1–10_000; share of every ICP tier's price) | controllers + `config.admins` | `price_tier` on `premium_icp_purchase`; `get_icp_payment_price_tier(id)` | no premium price for buying premium; a deposit equal to a tier's special price buys it (the regular amount still buys it as regular); `get_icp_tier_prices_for(p)` gives the amounts to deposit; voting-power claims and promo codes are free |
| app_sneeddao_backend | EOP, no log | `jailbreak_fee_e8s` | `is_admin` (admin list, deployer, controllers) | `get_jailbreak_payment_price_tiers(ids)` (admin, like the payment log) | `get_my_jailbreak_fee` returns the lowest price; `get_my_jailbreak_price` adds the tier; distinct from the public /partners list (`add/update/remove_partner`) |
| sneed_pad | classic, ICRC-3 | `creation_fee_e8s`, `index_creation_fee_e8s`, `sneed_dao_control_fee_e8s` | governance, controllers, admins | `get_launch_price_tiers(id)`, `get_index_launch_price_tiers(id)`; `price_tier` + `control_price_tier` on `sneedpad_token_create`, `sneedpad_index_create` | quotes return the effective fees; the handover override applies only when a handover fee is charged |
| sneed_guardian | classic, ICRC-3 | `op_fee_e8s` | `isAdmin` (admins, controllers) | `get_op_price_tier(id)`; `price_tier` on `guardian_op_stage`, `guardian_op_fee` | applies to ops the caller stages and pays for itself; ops on the guardian itself stay free. Setters: admins, or the approver when it alone is the threshold — the ones who can change the fee alone today. Not a new op kind, which would have changed the Candid of `stage_op`/`get_op`/`list_ops` |
| sneed_mon | EOP, no log | `base_daily_price_e8s` (the frequency-tier multipliers apply on top) | controllers + admin list | `get_my_charges_with_tier` (per charge) | no premium price; each check charges the lowest of the regular, admin and partner per-check prices of the watch's owner; `get_my_watches` / `get_my_balance` show the effective price, `get_tiers` stays the regular table |

Not covered:
- **sneed_notifications**: per-channel delivery prices are deducted from user or app balances
  per message, partly paid by apps; a special price there needs its own design (who is the
  customer: the app or the user) and is left for later.
- **sneed_sns_forum, sneed_sms, rll, naming canisters**: they charge no fees (forum tips go
  from user to user).

## 6. Frontend

- Each canister's admin page has an **Admin & partner prices** card
  (`components/SpecialPricesCard.jsx`): edit the admin prices, list, add, edit and remove
  partners (principal through PrincipalInput, label, overrides, expiry).
- Where the app shows a price to a user who gets a special price, a small **Admin price** or
  **Partner price** badge (`components/PriceTierBadge.jsx`) appears next to it. Pages read
  `get_special_prices_for(user)` and compute the effective price with
  `utils/specialPrices.js#effectivePrice`; against a canister without the methods they fall back
  to the regular and premium prices.
