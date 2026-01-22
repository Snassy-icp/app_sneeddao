Sneed Premium

The idea is that users of our app can register as sneed premium members and other services can check for premium membership to gate access or provide discounts. 

The core architecture is that a we have a registry of principals who have a membership and the expiration date for the membership. Other canisters can call to check for membership for a principal, and will then get back the expiration date if they have a membership. The other canister will then be allowed to cache the fact that the principal has a membership until the expiration date, and will not have to ask the premium canister again until that timestamp has expired. 

There are (for now) two main ways for a user to obtain a premium membership: 

1) By paying a fee in ICP. This will be done by sending the amount of ICP to the user's subaccount (generated from the user's principal according to a standard method) on the premium canister, that the method to buy membership on the premium canister can then verify and send on as payment to a target ICRC1 account. 

The premium canister should contain a dynamic list (managable by admins) of how long duration of premium membership different levels of ICP will buy. If the user buys say 1 month of membership but already has 2 weeks, they will then have 1 month and 2 weeks. 

2) By staking Sneed. A user can request membership by proving that they are staking Sneed tokens. By calling the Sneed SNS Governance canister requesting the neurons owned or hotkeyed to the principal, we can obtain the user's oting power (VP) and award membership of appropriate duration. 

The premium canister should contain a dynamic list (managable by admins) of how long duration of premium membership different levels of VP will grant. If the user is granted say 1 month of membership but already has 2 weeks, they will then have 1 month and 2 weeks. 

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

### Pending Features (Future ⏳)
- [ ] Integration with other services (discounts, gated features)
- [ ] Premium-only features and content gating
- [ ] Add premium badge to forum posts/threads (optional enhancement)
