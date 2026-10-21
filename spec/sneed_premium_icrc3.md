# Sneed Premium activity log (ICRC-3)

Design for a hash-chained, certified activity log in the `sneed_premium` canister, exposed
through the ICRC-3 block log interface, with archive canisters. Written 2026-10-21. The log
uses the shared library `src/icrc3` exactly as `sneed_lock`, `sneedex` and `rll` do (recipe:
`src/icrc3/README.md`; the closest sibling is [spec/sneedex_icrc3.md](sneedex_icrc3.md)).
This document records what is specific to Sneed Premium: the block catalogue, where each
block is appended, and the operations around the release.

**Status (2026-10-21): implemented, not deployed.** Tests: `test/canisters/tests/premium-icrc3.test.js`.

## Goals and rules

- Every change to a membership, to the money that pays for one, to promo codes, tiers and
  configuration produces one block: ICP purchases (with the ledger block of the payment),
  voting-power claims, promo code creation / claim / deactivation / reactivation / deletion,
  deposit withdrawals, admin set / extend / revoke, tier and config changes.
- A block is appended only once the change is final, in the message that records it: after
  the ICP ledger transfer returned `Ok` (purchase, withdrawal), after SNS governance answered
  and the membership was written (claim). A refused or failed call appends nothing; failures
  stay in the error results the caller gets.
- **Promo code texts are never logged.** A code in a public log could be claimed by anyone
  reading it, and an unsalted hash of an 8-letter code is brute-forced in minutes. Each code
  gets a sequential `code_id` instead (new stable map `promoCodeIds`, code -> id; codes that
  exist at the upgrade get ids 0, 1, ... in their list order on the first run of the new
  code). Admins map ids to codes with the new admin query `getPromoCodeIds()`. Promo code
  notes are admin-private and not logged either.
- Everything else that is logged is already public or harmless: membership is public
  (`checkMembership`, `getActivePremiumMembers`), tiers and config are public queries, and
  ICP transfers are on the ICP ledger. Nothing on the IC is anonymous: every block names the
  principal that made the call.
- The log starts empty with this release. Memberships, payments and claims that exist at
  the upgrade are not imported; their history stays in the admin-only `getClaimLog` /
  `getIcpPaymentLog`, which keep being written as before.

## Block format

As in the other Sneed logs: `Map { btype; ts; phash; tx }`. Inside `tx`:

- principals as `Blob`; ICRC-1 accounts as `Array [owner, subaccount?]`
- ICP amounts in e8s, voting power in e8s, durations and times in ns, ids: `Nat`
- `caller`: the principal that made the call (every Premium action is a call; no timers)
- no `cid`: Sneed Premium has no text log to correlate with
- flags as `Nat` 0 / 1; optional fields omitted when absent
- `previous_expiration` is the membership's expiration before the change, omitted when the
  principal had no membership record; `new_expiration` the one after

Tier descriptions (`tier`, `old_tier`): ICP tier `Map { name; amount_e8s; duration_ns; active }`,
voting power tier `Map { name; min_voting_power_e8s; duration_ns; active }`.

## Block type catalogue

Prefix `premium_`; `icrc3_supported_block_types` reports every type with the url
`https://app.sneeddao.com/api/sneed_premium#block-types`.

Memberships and money:

| btype | when | tx fields |
|---|---|---|
| `premium_icp_purchase` | `purchaseWithIcp`: the deposit was swept to the payment recipient and the membership extended | `caller`, `tier` (name), `duration_ns`, `amount_e8s` (the deposit charged, = the tier amount), `fee_e8s` (ledger fee), `to` (payment recipient account), `icp_tx` (ICP ledger block of the sweep), `previous_expiration`, `new_expiration` |
| `premium_vp_claim` | `claimWithVotingPower` granted a tier | `caller`, `voting_power` (e8s, as computed from the caller's neurons), `tier` (name), `duration_ns`, `previous_expiration`, `new_expiration` (max(current, now + duration): may equal the previous one) |
| `premium_deposit_withdraw` | `withdrawDeposit` returned the caller's deposit | `caller`, `amount_e8s` (transferred), `fee_e8s`, `to` (account), `icp_tx` |

Promo codes:

| btype | when | tx fields |
|---|---|---|
| `premium_promo_create` | `createPromoCode` | `caller`, `code_id`, `duration_ns`, `max_claims`; `code_expiration` when the code has one |
| `premium_promo_claim` | `claimPromoCode` granted the code's duration | `caller`, `code_id`, `duration_ns`, `claim_count` (after this claim), `previous_expiration`, `new_expiration` |
| `premium_promo_deactivate` | `deactivatePromoCode` | `caller`, `code_id` |
| `premium_promo_reactivate` | `reactivatePromoCode` | `caller`, `code_id` |
| `premium_promo_delete` | `deletePromoCode` | `caller`, `code_id`, `claim_count` (at deletion) |

Admin (controllers and admins only):

| btype | when | tx fields |
|---|---|---|
| `premium_admin_set` | `setMembershipAdmin` | `caller`, `principal`, `previous_expiration`, `new_expiration` |
| `premium_admin_extend` | `extendMembershipAdmin` | `caller`, `principal`, `duration_ns`, `previous_expiration`, `new_expiration` |
| `premium_admin_revoke` | `revokeMembership` removed a membership (revoking a non-member changes nothing and logs nothing) | `caller`, `principal`, `previous_expiration` |
| `premium_tier_add` | `addIcpTier`, `addVpTier` | `caller`, `kind` (`icp` or `vp`), `index`, `tier` |
| `premium_tier_update` | `updateIcpTier`, `updateVpTier` | `caller`, `kind`, `index`, `tier`, `old_tier` |
| `premium_tier_remove` | `removeIcpTier`, `removeVpTier` | `caller`, `kind`, `index`, `old_tier` |
| `premium_config_update` | a setting changed | `caller`, `key`, `value`; `old_value` when known |

`premium_config_update` keys and values: `admin_added`, `admin_removed` (Blob; only when the
list changed); `admins` (Array of Blob), `icp_ledger_id`, `sneed_governance_id` (Blob),
`payment_recipient` (account), `min_claim_interval_ns` (Nat): written by the single setters
(`setIcpLedgerId`, `setSneedGovernanceId`, `setPaymentRecipient`, `setMinClaimInterval`, one
block each, with `old_value`) and by `updateConfig` (one block per field that changed);
`icrc3_proposal_neuron` (Blob or Text `none`) and the log's own settings
`icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`,
`icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`.

Not logged: the voting-power claim times (the rate limit), the legacy claim and payment log
entries and statistics (they repeat the blocks above), promo code notes, reads.

## Appending points

| Code path | Block |
|---|---|
| `purchase` (from `purchaseWithIcp`) | `premium_icp_purchase` after the transfer's `Ok` and `setMembership` |
| `claimWithVotingPower` | `premium_vp_claim` after `setMembership` |
| `withdraw` (from `withdrawDeposit`) | `premium_deposit_withdraw` on the transfer's `Ok` |
| `createPromoCode` | `premium_promo_create` after the code is stored and given its id |
| `claimPromoCode` | `premium_promo_claim` after the claim count is updated |
| `deactivatePromoCode`, `reactivatePromoCode`, `deletePromoCode` | their block on `#ok` |
| `setMembershipAdmin`, `extendMembershipAdmin`, `revokeMembership` | their block on `#ok` |
| tier add / update / remove | `premium_tier_*` on `#ok` |
| `updateConfig`, `addAdmin`, `removeAdmin`, the four setters, `admin_set_icrc3_settings`, `admin_set_icrc3_proposal_neuron` | `premium_config_update` |

## Endpoints

The library's one-liners, as on Sneedex:

```
icrc3_get_blocks, icrc3_get_archives, icrc3_get_tip_certificate, icrc3_supported_block_types,
icrc10_supported_standards, icrc3_log_status, icrc3_registration_status            (queries)
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers,
admin_set_icrc3_proposal_neuron, admin_icrc3_register_archives_now,
admin_icrc3_reset_archive_registration                                             (admin updates)
getPromoCodeIds                                                                    (admin query)
```

No history import; `icrc3_log_status().history_imported` stays `false`. Every new method is
in the ingress guard: the queries are refused as update calls, the updates take small
arguments (`SMALL_ARG`).

## Archives, controllers, registration, cycles

- Archives (actor class `src/icrc3/Archive.mo`) are created with `archive_initial_cycles`
  (default 1.5 T; the subnet keeps the 0.5 T creation fee) when the live store reaches
  `max_live_blocks` (2000), checked every 15 minutes by a timer.
- Controllers: Sneed Premium and SNS root `fp274-iaaaa-aaaaq-aacha-cai`
  (`admin_icrc3_repair_archive_controllers` re-applies them).
- SNS registration: `SnsRegister.mo` with the governance of `getConfig().sneedGovernanceId`
  (Sneed governance `fi3zi-fyaaa-aaaaq-aachq-cai` on production), name "Sneed Premium".
  Skipped until `admin_set_icrc3_proposal_neuron` names a neuron that has the canister as a
  hotkey (`SubmitProposal`). Registering makes SNS root the archive's sole controller.
- Cycle reserve: 2 T. Archive creation needs 3.5 T on the canister; with less the spill
  check prints an error to the canister log and the live store keeps growing on the heap.
- Volume: a few blocks a day, so the first archive is years away.

## Persistence and upgrade

Classic persistence (no EOP flag in dfx.json; moc 0.14.13 via dfx 0.28.0). New stable fields
of the persistent actor (additive): `icrc3 : Log.State`, `icrc3_sns : SnsRegister.State`,
`promoCodeIds : [(Text, Nat)]`, `nextPromoCodeId : Nat`; the runtimes are `transient`.
No existing field changes type. The actor body assigns ids to codes without one and starts
the spill timer (on install and every upgrade); `postupgrade` re-certifies the tip. Candid
changes are additive (new methods only).

Production `7gump-4aaaa-aaaal-qtyka-cai` and staging `sf5tm-dqaaa-aaaae-qgyla-cai` both run
module hash `1c403b42…`, which is `dfx +0.28.0 build --network ic sneed_premium` of
`src/sneed_premium` as of commit 25b88246 (get_api_doc; unchanged since). The upgrade test
builds that source (`test/canisters/build/sneed_premium_prod.wasm`).

Upgrade proposal: `UpgradeSnsControlledCanister` with the release build of
`src/sneed_premium`; no `wasm_memory_persistence` (classic). After the upgrade:
`icrc3_log_status()` shows `log_length = 0`, `getPromoCodeIds()` lists every code with an id;
the first action writes block 0. Set a hotkeyed neuron with `admin_set_icrc3_proposal_neuron`
to register archives automatically, or register each by proposal when one appears and add it
to the ic-unicycle cycle monitoring.
