Sneed Premium

Status (2026-10-20): built and live (production `7gump-4aaaa-aaaal-qtyka-cai`, staging `sf5tm-dqaaa-aaaae-qgyla-cai`). The integrator reference with every method and error is src/app_sneeddao_frontend/public/api-docs/sneed_premium.md.

The idea is that users of our app can register as sneed premium members and other services can check for premium membership to gate access or provide discounts. 

The core architecture is that a we have a registry of principals who have a membership and the expiration date for the membership. Other canisters can call to check for membership for a principal, and will then get back the expiration date if they have a membership. The other canister will then be allowed to cache the fact that the principal has a membership until the expiration date, and will not have to ask the premium canister again until that timestamp has expired. 

Note: as built, `checkMembership(principal)` (a free query) answers `Active { expiration }`, `Expired { expiredAt }` or `NotFound`. Motoko canisters use src/PremiumClient.mo, which caches each expiry in a stable map. A cached answer can outlive an admin revocation (`revokeMembership`). Membership is public: `getActivePremiumMembers()` lists every current member.

There are (for now) two main ways for a user to obtain a premium membership: 

1) By paying a fee in ICP. This will be done by sending the amount of ICP to the user's subaccount (generated from the user's principal according to a standard method) on the premium canister, that the method to buy membership on the premium canister can then verify and send on as payment to a target ICRC1 account. 

Note: the subaccount is the standard `principalToSubAccount` layout (`getDepositAccount(user)` returns the account). `purchaseWithIcp` forwards the whole deposit balance minus one ICP ledger fee to the configured `paymentRecipient`.

Changed from the original plan: the deposit balance must equal an active tier's `amountE8s` exactly (the tier is matched by amount, not chosen by the user); any other balance returns `InvalidTier` and the ICP stays in the deposit account until the user tops it up to a tier amount. There is no refund or withdraw method for the deposit account (see Known issues).

The premium canister should contain a dynamic list (managable by admins) of how long duration of premium membership different levels of ICP will buy. If the user buys say 1 month of membership but already has 2 weeks, they will then have 1 month and 2 weeks. 

2) By staking Sneed. A user can request membership by proving that they are staking Sneed tokens. By calling the Sneed SNS Governance canister requesting the neurons owned or hotkeyed to the principal, we can obtain the user's oting power (VP) and award membership of appropriate duration. 

The premium canister should contain a dynamic list (managable by admins) of how long duration of premium membership different levels of VP will grant. If the user is granted say 1 month of membership but already has 2 weeks, they will then have 1 month and 2 weeks. 

Changed from the original plan: voting power claims are not additive. `claimWithVotingPower` sets the expiry to `now + tier duration` only when that is later than the current expiry (otherwise nothing changes), so holding SNEED keeps a membership topped up but cannot be banked by claiming repeatedly. A claim is also refused while the caller's previous voting power claim is younger than `minClaimIntervalNs` (`AlreadyClaimedRecently`); the interval is checked before and after the governance calls. ICP purchases and promo codes stay additive.

Note: as built, the canister calls Sneed SNS governance `list_neurons` with `of_principal = caller` (first 100 neurons), counts every neuron on which the caller has any permission (owner or hotkey), and computes voting power the way SNS governance does (stake plus staked maturity, dissolve delay and age bonuses, the neuron's voting power multiplier; neurons below the minimum dissolve delay count zero). The best tier the total reaches is granted.

3) By promo code (added, not in the original plan). Admins create codes (8 capital letters, generated from the creation time) with a duration, a maximum number of claims and an optional expiry; `claimPromoCode(code)` adds the code's duration to the membership, once per principal per code. Admins can deactivate, reactivate and delete codes and see who claimed them.

Admins (canister controllers plus the `admins` list) can also set or extend a membership directly (`setMembershipAdmin`, `extendMembershipAdmin`) and revoke one. Every purchase and claim goes into an admin-readable claim log and ICP payment log; `getPaymentStats()` publishes the totals.

The admin configuration should be available under a new subpage of the /admin page on the frontend. 

We will go on to design the user facing frontend experience once this core is in place. 

---

## Implementation Status

### Backend (Completed ✅)
- [x] Types.mo - All type declarations
- [x] Utils.mo - Utility functions (subaccount generation, VP calculation, tier matching)
- [x] main.mo - Actor implementation with:
  - Membership registry with expiration tracking
  - ICP payment tiers (admin-configurable)
  - Voting power tiers (admin-configurable)
  - Purchase with ICP flow (user deposits to subaccount, canister forwards to recipient)
  - Claim with voting power flow (verifies SNS neurons, calculates VP, grants membership)
  - Admin management (add/remove admins, tiers, manual membership grants)
  - Query methods for external canisters to check membership

### Admin Frontend (Completed ✅)
- [x] Create SneedPremiumUtils.js - Actor creation utility with IDL definitions
- [x] Create pages/admin/SneedPremium.jsx - Admin interface with:
  - Configuration overview (canister IDs, payment recipient, active members count)
  - Payment recipient configuration
  - Minimum VP claim interval configuration
  - ICP tier management (add/edit/remove tiers with modal editing)
  - Voting power tier management (add/edit/remove tiers with modal editing)
  - Admin management (add/remove admins)
  - Manual membership granting (grant/extend membership for any principal)
  - Membership management (view all members, revoke memberships)
- [x] Add route in App.jsx (`/admin/premium`)
- [x] Add link in Admin.jsx dashboard

### User Frontend (Completed ✅)
- [x] Premium membership page (`/premium`) for users to:
  - View current membership status and expiration
  - See available ICP payment tiers with pricing
  - Purchase premium with ICP (deposit to unique subaccount flow)
  - See available VP tiers with minimum voting power requirements
  - Claim premium with voting power (staked Sneed neurons)
  - Premium benefits overview section
- [x] Navigation link added to Header ("Me" section)
- [x] Route added in App.jsx

### Premium Badge Integration (Completed ✅)
- [x] Created `usePremiumStatus` hook for checking premium status (with caching)
- [x] Created `PremiumBadge` component with multiple sizes (tiny, small, medium, large)
- [x] Header - Shows premium badge next to user's principal when logged in
- [x] Me page - Shows premium badge in user's profile section
- [x] Principal page - Shows premium badge when viewing another user's profile

### Global Premium Badge Integration (Completed ✅)
- [x] Added `getActivePremiumMembers` public query to sneed_premium canister
- [x] Created `PremiumContext` to load premium members on site startup
- [x] Updated `PrincipalDisplay` component to show crown badge for premium members
- [x] Crown badge appears everywhere principals are displayed across the site

### Integration with other services (Status 2026-10-20: built ✅)
- [x] Sneedex: lower (or zero) offer creation fee and lower marketplace cut for premium creators
- [x] Sneed Lock: separate premium lock fees
- [x] Sneedapp, Sneed Pad, Sneed Guardian: premium creation / operation fees
- [x] Forum: longer post and thread bodies; Sneed SMS: longer messages, more recipients, lower rate limit
- [x] Backend and naming canisters: more neuron and principal nicknames; jailbreak fee for premium; sneed_avatars: more held images
- [x] Shared Motoko client src/PremiumClient.mo (cached `checkMembership`)
- [x] Premium badge on forum posts/threads: covered by the crown in `PrincipalDisplay`

### Also built (not in the original plan)
- [x] Promo codes (see above), with admin UI
- [x] Ingress guard (`inspect_message`): queries called as updates are refused, arguments capped, admin methods with free-form content refused for non-admins
- [x] Public `getPaymentStats()` (shown on the revenue page)

### Known issues (2026-10-20)
- A deposit that matches no tier amount (too little, too much, or two deposits adding up to something else) cannot be refunded: there is no refund or withdraw method, so the user can only top it up to an exact tier amount (src/sneed_premium/Utils.mo:204 `findIcpTier` matches `amountE8s == balance`). A refund method for the deposit account would close this.
- Promo codes are not truly random: `generatePromoCode` seeds a simple LCG with `Time.now()` (src/sneed_premium/main.mo:113), so someone who knows roughly when a code was created could guess it. Secure randomness (`Random.blob`) would fix this.
- The error variants `TierNotActive` and `InternalError` (purchase) and `InternalError` (voting power claim and promo code) are declared but never returned.
