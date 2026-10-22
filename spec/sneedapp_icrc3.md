# Sneedapp activity log (ICRC-3)

Design for a hash-chained, certified activity log in the `sneedapp` canister (Sneed DAO's app
factory), exposed through the ICRC-3 block log interface, with archive canisters. Written
2026-10-21. The log uses the shared library `src/icrc3` exactly as `sneed_lock`, `sneedex`,
`rll` and `sneed_premium` do (recipe: `src/icrc3/README.md`; the closest sibling is
[spec/sneed_premium_icrc3.md](sneed_premium_icrc3.md)). This document records what is
specific to Sneedapp: the block catalogue, where each block is appended, the wallet decision
and the operations around the release.

**Status (2026-10-21): implemented, not deployed.** Tests: `test/canisters/tests/sneedapp-icrc3.test.js`.

## Goals and rules

Sneedapp handles two things people must be able to audit without trusting anyone:

1. **Supply chain**: which code the factory installs. Every app, version and Wasm change is a
   block, with the Wasm's SHA-256 and size and the version numbers, so the history of what was
   published (and by whom) under each app is public and tamper-evident. Every mint names the
   SHA-256 of the module it actually installed (computed from the blob at mint time).
2. **Money**: every mint with the price paid and where each part went, with the ICP ledger
   block of every transfer; refunds of aborted mints; deposit, publisher and admin withdrawals.

Rules, as in the other Sneed logs:

- A block is appended only once the change is final, in the message that records it: after
  every ledger transfer of a mint returned `Ok`, the canister was handed over and the mint log
  written. A refused or failed call appends nothing, with two exceptions where ICP or a canister
  did move: a mint that aborted after money moved (`sneedapp_mint_refund`, which records the
  money going back) and a canister left with the factory (`sneedapp_orphan_canister`).
- **A call that changes nothing appends nothing** (re-adding an admin, enabling an enabled app,
  re-registering a bookmark, setting a value to itself).
- Methods that trap (the admin `assert`s, `Debug.trap` on a hash mismatch) roll back their
  block with the rest of the message.
- Nothing logged is secret: the catalogue, publishers, versions, configuration and the mint log
  are public queries already, and transfers are on the ICP ledger. Every block names the
  principal that made the call; nothing on the IC is anonymous.
- The log starts empty with this release. Apps, versions, mints and wallets that exist at the
  upgrade are not imported; the mint log (`getMintLog`) and the admin creation / financial logs
  keep being written as before.

## Wallet bookmarks: only privileged writes are logged

The wallet is a list of bookmarks, not ownership: anyone may `registerCanister` any canister
(the frontend also bookmarks ledgers, indexes and any canister a user tracks), and
`transferManager` moves the bookmark, never the controllers. A user's own bookmark changes
carry no trust (the IC's controller list is the truth), would put every canister each user
tracks into a permanent public record, and would make the UI's bookkeeping the bulk of the log.
They are **not logged**: `registerCanister`, `deregisterCanister`, `registerManager`,
`deregisterManager` called for oneself.

Logged are the wallet writes that act on someone else's list or hand an entry to someone else:

- `transferManager` (`sneedapp_wallet_transfer`): from the caller to a new owner, as asked;
- `registerCanisterFor`, `registerManagerFor`, `deregisterCanisterFor`, `deregisterManagerFor`
  (authorised canisters such as Sneedex, and admins), `adminRegisterCanister`,
  `adminBulkRegisterCanisters` (`sneedapp_wallet_register` / `sneedapp_wallet_deregister`,
  one block per entry that changed).

The wallet entry a mint creates is part of the `sneedapp_mint` block. Volume on production
(2026-10-21): 36 bookmarks of 20 users, 15 mints; the logged wallet writes are a few per Sneedex
sale.

## Block format

As in the other Sneed logs: `Map { btype; ts; phash; tx }`. Inside `tx`:

- principals as `Blob`; ICRC-1 accounts as `Array [owner, subaccount?]`
- ICP amounts in e8s, cycles, sizes, ids, ledger block indexes: `Nat`; timestamps `Nat` ns
  (an `Int` when negative)
- flags as `Nat` 0 / 1; optional fields omitted when absent
- hashes as lowercase hex `Text` (as the API and `getOfficialVersionByHash` use them):
  `wasm_sha256` is computed by the canister from the blob; `wasm_hash` is the hash a version
  declares (equal to the blob's SHA-256 once a Wasm is uploaded, which the upload enforces)
- `caller`: the principal that made the call; no `cid` (Sneedapp has no text log)

Records:

- **app** `Map { app_id; numeric_app_id; publisher_id; name; mint_price_e8s;
  premium_mint_price_e8s; families (Array Text); enabled; view_url?; manage_url?; mint_url?;
  payment_account? (account); dao_cut_bps? }`. The description and icon are not logged (free
  text, an icon may be a data URL); they are public through `getApps`.
- **publisher** `Map { publisher_id; name; website_url?; owners (Array Blob); verified;
  families; default_payment_account (account); dao_cut_bps }`. Description, logo and links are
  not logged.
- **version** `Map { major; minor; patch; wasm_hash?; wasm_size; release_date; wasm_url?;
  source_url? }` (`wasm_hash` omitted while empty; release notes are not logged).
- **official version** `Map { major; minor; patch; wasm_hash; wasm_url; source_url }`.
- **ver** `Map { major; minor; patch }` (the version a mint installed).

## Block type catalogue

Prefix `sneedapp_`; `icrc3_supported_block_types` reports every type with the url
`https://app.sneeddao.com/api/sneedapp#block-types`.

Catalogue and supply chain:

| btype | when | tx fields |
|---|---|---|
| `sneedapp_app_add` | `addApp` | `caller`, `app` |
| `sneedapp_app_update` | `updateApp`, `setAppPricing`, `setAppPaymentAccount`, `setAppDaoCut`, `setAppFamilies`, and `removePublisherFamily` for each app that lost the family; only when a logged field changed (a description-only edit appends nothing) | `caller`, `method`, `app`, `old_app` |
| `sneedapp_app_enable` / `sneedapp_app_disable` | `setAppEnabled` changed the flag | `caller`, `app_id`, `numeric_app_id`, `publisher_id` |
| `sneedapp_app_remove` | `removeApp` (only apps nothing was minted from) | `caller`, `app`, `versions` (Array of version, removed with their Wasms) |
| `sneedapp_version_add` | `addAppVersion` | `caller`, `app_id`, `version` |
| `sneedapp_version_update` | `updateAppVersion` changed a logged field of a version | `caller`, `app_id`, `version`, `old_version` |
| `sneedapp_version_remove` | `removeAppVersion` removed one | `caller`, `app_id`, `old_version`, `had_wasm` |
| `sneedapp_wasm_upload` | `uploadAppVersionWasm` stored a Wasm (a whole module per call; there are no chunks) | `caller`, `app_id`, `version` (after the upload: `wasm_hash` = the blob's SHA-256, `wasm_size`), `wasm_sha256` |
| `sneedapp_wasm_clear` | `clearAppVersionWasm` dropped a stored Wasm | `caller`, `app_id`, `version` (before), `wasm_size` (of the dropped blob) |
| `sneedapp_official_version_set` | `addOfficialVersion`, `updateOfficialVersion`, `setOfficialVersions` added or changed an entry (`getOfficialVersions`, keyed by hash) | `caller`, `method`, `official`, `old_official` when it replaced one |
| `sneedapp_official_version_remove` | the same methods and `removeOfficialVersion` dropped an entry | `caller`, `method`, `old_official` |
| `sneedapp_manager_wasm_set` | `setManagerWasm` (the legacy `createNeuronManager` module) | `caller`, `wasm_sha256`, `wasm_size` |
| `sneedapp_manager_wasm_clear` | `clearManagerWasm` dropped it | `caller` |

Publishers:

| btype | when | tx fields |
|---|---|---|
| `sneedapp_publisher_create` | `createPublisher` | `caller`, `publisher` |
| `sneedapp_publisher_update` | `updatePublisher`, `addPublisherOwner`, `removePublisherOwner`, `addPublisherFamily`, `removePublisherFamily`, `setPublisherDaoCut` changed a logged field | `caller`, `method`, `publisher`, `old_publisher` |
| `sneedapp_publisher_verify` / `sneedapp_publisher_unverify` | `verifyPublisher` / `unverifyPublisher` changed the flag | `caller`, `publisher_id` |

Mints and money:

| btype | when | tx fields |
|---|---|---|
| `sneedapp_mint` | `mintCanister` or the legacy `createNeuronManager` completed: paid, installed, handed to the minter, mint log written | `caller` (the minter, now sole controller), `canister_id`, `app_id`, `numeric_app_id`, `publisher_id`, `ver`, `wasm_sha256`, `wasm_size`, `price_e8s` (0 when payment is off), `premium`, `price_tier` (`regular`, `premium`, `admin` or `partner`; spec/special_prices.md); when paid: `cycles_icp_e8s` + `cycles_tx` (to the factory's main account, for the CMC), `publisher_share_e8s` (+ `publisher_share_to`, `publisher_share_tx` when > 0), `dao_cut_e8s` (+ `dao_cut_to`, `dao_cut_tx` when > 0), `fees_e8s` (every ledger fee of the mint, the CMC transfer's included); `cycles_received` when the CMC top-up answered; `method` = `createNeuronManager` for the legacy flow |
| `sneedapp_mint_refund` | a paid mint aborted after ICP had left the deposit; the moved ICP was sent back to the deposit | `caller`, `app_id`, `ver`, `price_e8s`, `price_tier`, `reason`, `payment_txs` (ledger blocks of the legs that had moved), `moved_e8s`, `returned_e8s` (arrived back in the deposit), `stuck_e8s` (could not be returned; held by the factory for a manual return), `refund_txs`, `canister_id` when a canister had been created (and deleted, or see the orphan block) |
| `sneedapp_orphan_canister` | a canister of a failed mint stays with the factory (deleting it, or handing it over, failed); `getOrphanCanisters` | `caller` (minter), `canister_id`, `app_id`, `reason`; after a full payment whose hand-over failed also `ver`, `price_e8s` and the payment fields of `sneedapp_mint` (untested path: PocketIC cannot make `update_settings` or `delete_canister` fail) |
| `sneedapp_orphan_settled` | an orphaned canister was settled: `retry_handover` or `adminSettleOrphan(#HandOver)` gave it to its recorded minter (then its `sneedapp_mint` block follows, with `settled_by`, when the mint had been paid), or `adminSettleOrphan(#Delete)` deleted it | `caller`, `canister_id`, `minter`, `app_id`, `action` (`hand_over` or `delete`), `reason` (the admin's reason, or `retried by the minter` / `retried by an admin`), `mint_recorded` (1 when the paid mint is recorded now) |
| `sneedapp_top_up_retry` | `retry_top_up` finished a pending cycles purchase of a mint (`get_pending_top_ups`) | `caller`, `pending_id`, `canister_id` (the minted canister), `amount_e8s`, `top_up_tx` (ICP block of the transfer to the CMC), `outcome` (`ok` with `cycles`, or `refunded` with `reason`: the CMC sent the ICP back to the main account); a retry that fails again appends nothing |
| `sneedapp_refund_credit_claim` | `claim_refund_credit` returned at least one leg of a refund credit to the payer's payment subaccount | `caller`, `payer`, `credit_id`, `returned_e8s` (arrived), `refund_txs`, `remaining_e8s` (legs still owed; the credit stays open while above 0), `to` (the payer's payment subaccount) |
| `sneedapp_refund_credit_closed` | `adminCloseRefundCredit` closed a credit settled another way | `caller`, `payer`, `credit_id`, `amount_e8s` (what the credit still held), `reason` |
| `sneedapp_deposit_withdraw` | `withdrawUserPayment` (or `withdrawUserToken` for ICP) | `caller`, `amount_e8s`, `fee_e8s`, `to`, `icp_tx` |
| `sneedapp_deposit_token_withdraw` | `withdrawUserToken` sent a token other than ICP from the caller's payment subaccount back to the caller | `caller`, `ledger`, `amount` (transferred, the token's smallest unit), `fee`, `to`, `ledger_tx` (block on that ledger) |
| `sneedapp_publisher_withdraw` | `withdrawPublisherFunds`, `withdrawAppFunds` | `caller`, `publisher_id`, `numeric_app_id` (app funds), `amount_e8s`, `fee_e8s`, `to`, `icp_tx` |
| `sneedapp_admin_withdraw` | `adminWithdrawIcp` (from the factory's main account) | `caller`, `amount_e8s`, `fee_e8s`, `to`, `icp_tx` |
| `sneedapp_admin_stuck_return` | `adminReturnStuckIcp` returned ICP a user was owed from aborted mints to that user's payment subaccount | `caller` (the admin), `user`, `amount_e8s` (transferred), `fee_e8s`, `to` (the user's payment subaccount), `icp_tx`, `reason`, `credit_ids` (refund credits reduced), `credits_closed`, `remaining_e8s` (still owed) |
| `sneedapp_admin_top_up` | `adminTopUpCycles` converted main-account ICP to cycles | `caller`, `amount_e8s`, `cycles` |

Wallet (privileged writes only, see above):

| btype | when | tx fields |
|---|---|---|
| `sneedapp_wallet_transfer` | `transferManager` | `caller` (the old holder), `canister_id`, `app_id` (when known), `new_owner` |
| `sneedapp_wallet_register` | `registerCanisterFor`, `registerManagerFor`, `adminRegisterCanister`, `adminBulkRegisterCanisters` added or labelled an entry | `caller`, `user`, `canister_id`, `app_id` (when known) |
| `sneedapp_wallet_deregister` | `deregisterCanisterFor`, `deregisterManagerFor` removed an entry | `caller`, `user`, `canister_id` |

Configuration:

| btype | when | tx fields |
|---|---|---|
| `sneedapp_config_update` | a setting changed | `caller`, `key`, `value`, `old_value` (absent for list additions and removals) |

`sneedapp_config_update` keys: `admin_added`, `admin_removed`, `authorized_caller_added`,
`authorized_caller_removed` (Blob); `sneed_governance`, `sneed_premium_canister_id` (Blob or
Text `none`); `creation_fee_e8s`, `premium_creation_fee_e8s`, `target_cycles`,
`canister_creation_cycles` (Nat); `fee_destination` (account); `payment_required` (0/1);
`current_version` (`ver`); `admin_prices` (Map of the set overrides, `old_value` the previous
map) and `partner_prices` (with `partner`; value `{ label; prices; expires_at? }` or Text `removed`;
`old_value` the previous entry) (spec/special_prices.md); `icrc3_proposal_neuron` (Blob or Text `none`) and the log settings
`icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`,
`icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`.
`setPaymentConfig` writes one block per field that changed.

Not logged: a user's own bookmarks (above), reads, the `getAppMintPrice` premium check, release
notes, app descriptions and icons, publisher descriptions, logos and links, the premium cache,
the legacy `updateManagerNeuronId` (a no-op), and the creation / financial log entries and
statistics (they repeat the mint blocks).

## Appending points

| Code path | Block |
|---|---|
| `mintCanister` | `sneedapp_mint` after the hand-over, the top-up and `addMintLogEntry`; `sneedapp_mint_refund` in each abort branch that undoes transfers (`refundPayment`); `sneedapp_orphan_canister` from `recordOrphan` |
| `createNeuronManager` | the same, `method = createNeuronManager`, version = `getCurrentVersion()` |
| `withdrawUserPayment`, `withdrawPublisherFunds`, `withdrawAppFunds`, `adminWithdrawIcp`, `adminTopUpCycles` | on the ledger's / CMC's `Ok` |
| app, version, Wasm, publisher, official version, manager Wasm methods | after the state is written, only when it changed |
| `transferManager`, the `*For` and `admin*Register*` wallet methods | when the wallet changed |
| admin setters, `setPaymentConfig`, `admin_set_icrc3_settings`, `admin_set_icrc3_proposal_neuron` | `sneedapp_config_update` per changed value |

## Endpoints

The library's one-liners, as on Sneed Premium:

```
icrc3_get_blocks, icrc3_get_archives, icrc3_get_tip_certificate, icrc3_supported_block_types,
icrc10_supported_standards, icrc3_log_status, icrc3_registration_status            (queries)
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers,
admin_set_icrc3_proposal_neuron, admin_icrc3_register_archives_now,
admin_icrc3_reset_archive_registration                                             (admin updates)
```

Admin = `isAdminOrGovernance` (the admins, and `getSneedGovernance()` when set; Sneed
governance `fi3zi-…` is an admin on production). No history import;
`icrc3_log_status().history_imported` stays `false`. Every new method is in the ingress guard:
the queries are refused as update calls, the updates take small arguments (`SMALL_ARG`).

## Archives, controllers, registration, cycles

- Archives (actor class `src/icrc3/Archive.mo`) are created with `archive_initial_cycles`
  (default 1.5 T; the subnet keeps the 0.5 T creation fee) when the live store reaches
  `max_live_blocks` (2000), checked every 15 minutes by a timer.
- Controllers: Sneedapp and SNS root `fp274-iaaaa-aaaaq-aacha-cai`
  (`admin_icrc3_repair_archive_controllers` re-applies them).
- SNS registration: `SnsRegister.mo` with `getSneedGovernance()`, or Sneed governance
  `fi3zi-fyaaa-aaaaq-aachq-cai` while that is unset (as on production), name "Sneedapp".
  Skipped until `admin_set_icrc3_proposal_neuron` names a neuron that has the canister as a
  hotkey (`SubmitProposal`). Registering makes SNS root the archive's sole controller.
- Cycle reserve: 2 T, on top of what minting needs. Sneedapp spends its own cycles on every
  mint (`canisterCreationCycles`, 1 T by default, bought back from the mint price); archive
  creation needs 3.5 T on the canister, and with less the spill check prints an error to the
  canister log and the live store keeps growing on the heap. Mints refuse below
  `canisterCreationCycles` as before; the reserve does not change that check.
- Volume: a few blocks per mint and per catalogue change; the first archive is years away.
- Cost: each mint hashes the installed Wasm once (SHA-256 of a few MB, well under the
  instruction limit; measured in the tests).

## Persistence and upgrade

Classic persistence (no EOP flag in dfx.json; moc 0.14.13 via dfx 0.28.0). New stable fields
of the persistent actor (additive): `icrc3 : Log.State`, `icrc3_sns : SnsRegister.State`;
the runtimes are `transient`. No existing field changes type. `postupgrade` re-certifies the
tip and the actor body starts the spill timer (install and every upgrade). Candid changes are
additive (new methods only). `undoPaymentTransfers` now also returns the refund's ledger blocks
(internal).

Production `sfamc-kyaaa-aaaau-adnpq-cai` and staging `34e6r-ayaaa-aaaad-adkoa-cai` both run
module hash `96f4f055…`, which is `dfx +0.28.0 build --network ic sneedapp` of `src/sneedapp`
as of commit 25b88246 (get_api_doc; unchanged since). The upgrade test builds that source
(`test/canisters/build/sneedapp_prod.wasm`).

Upgrade proposal: `UpgradeSnsControlledCanister` with the release build of `src/sneedapp`;
no `wasm_memory_persistence` (classic). After the upgrade: `icrc3_log_status()` shows
`log_length = 0`; apps, versions, Wasms, wallets and the mint log are unchanged; the first
action writes block 0. Set a hotkeyed neuron with `admin_set_icrc3_proposal_neuron` to register
archives automatically, or register each by proposal when one appears and add it to the
ic-unicycle cycle monitoring.
