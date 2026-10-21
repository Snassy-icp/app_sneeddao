/// The get_api_doc text of sneed_premium: a short guide for agents (ICP service discoverability).
module {
  public let text : Text = "# Sneed Premium (canister sneed_premium)

Sneed Premium is the membership registry of Sneed DAO: one record per principal holding the moment its premium membership expires. Members get it by paying ICP, by proving they stake SNEED (voting power in Sneed DAO's SNS) or with a promo code. Other canisters and front ends ask `checkMembership` to unlock features or discounts; asking is free and needs no permission.

- Production: `7gump-4aaaa-aaaal-qtyka-cai`
- Staging: `sf5tm-dqaaa-aaaae-qgyla-cai` (separate state and members; use it to test)
- Controlled by Sneed DAO's SNS root; upgrades go through DAO proposals.

## Units and encoding

- Times are `int` nanoseconds since the Unix epoch; durations are `nat` nanoseconds.
- ICP amounts are e8s (`nat`); voting power is in e8s as SNS governance computes it.
- User updates return `variant { ok : Membership; err : ... }` with a per-method error variant; admin methods return `AdminResult` (`NotAuthorized`, `NotFound`, `InvalidInput(text)`).
- `checkMembership` returns `Active { expiration }`, `Expired { expiredAt }` or `NotFound`. A member is one whose `expiration > now`; there are no levels.

## Authentication

- Queries answer anyone. Updates that grant membership refuse the anonymous principal (`NotAuthorized`).
- Membership is public: `checkMembership` answers for any principal and `getActivePremiumMembers` lists every member. Only `getMembershipDetails` is limited to the principal itself or an admin. Purchases, claims and admin changes are public blocks in the activity log; the older claim and payment logs are admin only. Calls are signed by a principal that is public on-chain; nothing here is anonymous.
- Admin methods (tiers, config, promo codes, logs, set/extend/revoke memberships) are for controllers and listed admins only.

## Fees, transfers and irreversible actions

- **Buying with ICP moves tokens.** The user sends ICP to their deposit account `getDepositAccount(user)` (`{ owner = sneed_premium; subaccount = principalToSubAccount(user) }`), paying the ledger fee. `purchaseWithIcp()` then matches the **whole** deposit balance against the active ICP tiers; on an exact match it **transfers balance minus the ledger fee to the DAO's payment recipient** (`getConfig().paymentRecipient`) and extends the membership. This payment is final; the canister keeps nothing.
- A balance that matches no tier returns `InvalidTier` and the ICP stays in the deposit account. `withdrawDeposit()` sends the caller's own deposit balance **minus the ledger fee** to the caller's default account.
- ICP purchases and promo codes add time to the remaining membership; voting power claims do not stack (they set `max(current, now + duration)`).
- Tier amounts and durations are DAO-managed and change: read `getIcpTiers()` / `getVotingPowerTiers()` every time, never hard-code them.

## Asynchronous lifecycle and polling

- An ICP purchase is two steps: ledger transfer to the deposit account, then `purchaseWithIcp()`.
- `claimWithVotingPower()` calls SNS governance (`list_neurons` for the caller, owner or hotkey permission); it can refuse with `AlreadyClaimedRecently { nextClaimTime }` until `minClaimIntervalNs` (`getConfig()`) has passed.
- Cache a membership until its `expiration` (only an admin revocation shortens it). For lists, fetch `getActivePremiumMembers()` once. No need to poll faster than your UI needs.

## Errors, retries and Busy

- Retrying `purchaseWithIcp` after a timeout is safe: if the first call went through the deposit is empty and the retry returns `InvalidTier` or `InsufficientPayment` without charging; check `checkMembership` for the new expiry.
- One purchase or withdrawal runs at a time per caller: a concurrent one returns `InternalError` (purchase) or `InProgress` (withdrawal) without touching the ledger. Retrying `withdrawDeposit` after a timeout returns `NothingToWithdraw` if it already went through.
- Admin log queries (`getClaimLog`, `getIcpPaymentLog` and their counts) trap for non-admins.

## Common pitfalls

- Depositing an amount that is not exactly one tier amount (or two deposits that add up to something else): `InvalidTier`. Top up to a tier amount or withdraw.
- Promo codes are case-sensitive (generated in capitals) and can be claimed once per principal.
- Query methods sent as update calls are refused by the ingress guard. Arguments are capped (most updates 4 KiB; promo codes at most 64 characters); admin methods with free-form content are refused at ingress for non-admins.

## Activity log (ICRC-3)

- Every purchase (with its ICP ledger block), voting power claim, deposit withdrawal, promo code action, admin grant and tier or config change is a block in a public, certified ICRC-3 log (`icrc3_get_blocks`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`, `icrc3_log_status`), with archive canisters for old blocks. Block types: https://app.sneeddao.com/api/sneed_premium#block-types
- Promo codes appear by `code_id`, never by their text. A refused or failed call appends nothing.

## Start with these methods

- `checkMembership(principal)`, `getActivePremiumMembers()`, `getMembershipDetails(principal)`
- `getIcpTiers()`, `getVotingPowerTiers()`, `getConfig()`, `getDepositAccount(user)`, `getPaymentStats()`
- `purchaseWithIcp()`, `claimWithVotingPower()`, `claimPromoCode(code)`, `withdrawDeposit()`

## Full reference

- https://app.sneeddao.com/api-docs/sneed_premium.md
- Candid: https://app.sneeddao.com/api-docs/sneed_premium.did
- All Sneed DAO APIs: https://app.sneeddao.com/llms.txt
";
};
