# SNS: snapshot before upgrading a dapp canister (draft for the DFINITY SNS team)

Status: draft for discussion, nothing implemented. Code references are to
dfinity/ic master `9d8d74e6f4a49b8e785ebd4e077846cbca4952aa` (2026-10-24).

## 1. Motivation

An `UpgradeSnsControlledCanister` proposal that goes wrong (a `post_upgrade` that
traps, a migration that drops or mangles state, a `Reinstall` by mistake) today
leaves the DAO with:

- no copy of the pre-upgrade state, so lost data stays lost;
- a second proposal to fix forward, which has to wait out the whole voting period
  while the dapp is broken.

Canister snapshots fix both. If the upgrade proposal itself takes a snapshot of the
dapp canister right before `install_code`, one later proposal can roll the canister
back to exactly the pre-upgrade code and memory. NNS already does this for its own
canisters (`TakeCanisterSnapshot` / `LoadCanisterSnapshot` proposals). This note
proposes the SNS counterpart, reusing the same shared root code.

## 2. What exists today

### 2.1 The upgrade path

1. Validation: `validate_and_render_upgrade_sns_controlled_canister`
   (`rs/sns/governance/src/proposal.rs:1082`) checks mode, `canister_upgrade_options`,
   `canister_id` and the Wasm (`Wasm::try_from` / `Wasm::validate`, incl. chunked
   Wasm stores).
2. Execution: `perform_action` (`rs/sns/governance/src/governance.rs:2167`) →
   `perform_upgrade_sns_controlled_canister` (`:2677`). This checks for an upgrade
   already in progress (`check_no_upgrades_in_progress`), asks root for the SNS
   canister list and refuses targets that are not registered dapps. It then calls
   `upgrade_non_root_canister` (`:2734`), which builds a
   `ChangeCanisterRequest { stop_before_installing: true, mode, wasm | chunked, arg }`
   (with `canister_upgrade_options` folded into `Upgrade(Some(..))` by `assemble_mode`)
   and calls SNS root `change_canister`.
3. SNS root `change_canister` (`rs/sns/root/canister/canister.rs:217`) checks that the
   caller is governance, **spawns** the work and replies at once. The reply is only an
   acknowledgement. Root works this way so that it cannot deadlock when the target is
   governance itself.
4. The spawned work is `ic_nervous_system_root::change_canister::change_canister`
   (`rs/nervous_system/root/src/change_canister.rs:228`), which runs
   `perform_offline_canister_maintenance` (`rs/nervous_system/root/src/private.rs:151`):
   take the per-canister lock → `stop_canister` → `install_code` /
   `install_chunked_code` (`change_canister.rs:276`) → `start_canister`, whatever the
   install result, → release the lock.
5. Reporting: because of step 3, governance marks the proposal executed once root has
   *accepted* the request. A failed `install_code`, such as a trapping
   `post_upgrade`, shows up only in root's log. The existing failure test
   (`test_upgrade_canister_proposal_execution_fail`,
   `rs/sns/integration_tests/src/upgrade_canister.rs:330`) only covers root
   rejecting the call.

### 2.2 Snapshot support that already exists

- Shared root library: `rs/nervous_system/root/src/take_canister_snapshot.rs:42` and
  `load_canister_snapshot.rs:36`. Both go through `perform_offline_canister_maintenance`
  with `stop_before = true`, and both run in the background when the target is
  governance (`Optimistic` placeholder reply). Request/response types:
  `TakeCanisterSnapshotRequest { canister_id, replace_snapshot: opt blob }` →
  `Ok { id, taken_at_timestamp, total_size } | Err { code, description }`, and
  `LoadCanisterSnapshotRequest { canister_id, snapshot_id }`.
- NNS root exposes both methods, callable by governance only
  (`rs/nns/handlers/root/impl/canister/canister.rs:245,259`).
- NNS governance has `Action::TakeCanisterSnapshot { canister_id, replace_snapshot }` and
  `Action::LoadCanisterSnapshot { canister_id, snapshot_id }`
  (`rs/nns/governance/src/proposals/{take,load}_canister_snapshot.rs`). Both are
  implemented through the `CallCanister` trait, with the topic taken from
  `topic_to_manage_canister`, the same as `InstallCode`. The new snapshot id is
  returned in `ProposalData.success_value =
  SuccessfulProposalExecutionValue::TakeCanisterSnapshot { snapshot_id }`
  (`perform_call_canister`, `rs/nns/governance/src/governance.rs:4351`).
- SNS: no snapshot proposals and no snapshot methods on SNS root. The only related
  feature is `snapshot_visibility` in `ManageDappCanisterSettings`.
- `ManagementCanisterClient` (`rs/nervous_system/clients/src/management_canister_client.rs`)
  has `take_canister_snapshot` and `load_canister_snapshot`, but no `list` or `delete`.

### 2.3 How the management canister handles snapshots (`rs/execution_environment/src/canister_manager.rs:2002,2154`)

- Callers: controllers only. SNS root is the sole controller of registered dapps.
  `list_canister_snapshots` and `read_canister_snapshot_{metadata,data}` follow the
  canister's `snapshot_visibility` setting; with `Public`, anyone can list snapshots
  **and read their full memory**.
- Limit: `MAX_NUMBER_OF_SNAPSHOTS_PER_CANISTER = 10` (`rs/config/src/execution_environment.rs:171`).
  If the limit is reached and no `replace_snapshot` is given, the call fails with
  `CanisterSnapshotLimitExceeded`. `replace_snapshot` deletes the named snapshot only
  after the new one has been created.
- The canister does not have to be stopped, but the IC docs and NNS root both stop it
  first, so that no callbacks are in flight.
- A snapshot holds the Wasm module, heap, stable memory, chunk store, certified data
  and globals. It does not hold settings, controllers or the cycle balance.
- Cost, paid by the snapshotted canister: on success, a baseline instruction charge
  plus a charge proportional to the snapshot size. After that, the snapshot's bytes
  count towards the canister's memory usage (`snapshots_size` in canister status) and
  are billed as storage for as long as the snapshot exists.
- `load_canister_snapshot` replaces the code and memories, prepays and refunds cycles
  for compiling the module, and adds a `LoadSnapshot` entry to the canister history.
  It can load a snapshot that belongs to *another* canister if the caller controls
  both.
- Snapshot ids are `canister_id ++ local counter`, so they are predictable but not
  reused. Snapshots can also be *uploaded* (`upload_canister_snapshot_*`), and their
  metadata then shows `source = metadata_upload`.

## 3. Proposal

### 3.1 API (Candid; every new field is `opt`, every new action is a new variant)

```candid
// New field on UpgradeSnsControlledCanister (proto field 7).
type UpgradeSnsControlledCanister = record {
  ...existing fields...;
  // If set, take a snapshot of the target right before install_code, and abort
  // the upgrade if that fails.
  take_canister_snapshot : opt TakeSnapshotBeforeUpgrade;
};
type TakeSnapshotBeforeUpgrade = record {
  // Optional: an existing snapshot of the same canister to replace (needed once
  // there are 10 snapshots).
  replace_snapshot : opt blob;
};

// New actions (proto oneof fields 24..26, NativeAction ids 20..22).
type Action = variant { ...; TakeCanisterSnapshot : TakeCanisterSnapshot;
                             LoadCanisterSnapshot : LoadCanisterSnapshot;
                             DeleteCanisterSnapshot : DeleteCanisterSnapshot; };
type TakeCanisterSnapshot   = record { canister_id : opt principal; replace_snapshot : opt blob };
type LoadCanisterSnapshot   = record { canister_id : opt principal; snapshot_id : opt blob };
type DeleteCanisterSnapshot = record { canister_id : opt principal; snapshot_id : opt blob };

// New ProposalData field (proto field 27), mirroring NNS success_value.
type ProposalData = record { ...; success_value : opt SuccessfulProposalExecutionValue };
type SuccessfulProposalExecutionValue = variant {
  TakeCanisterSnapshot : record { snapshot_id : blob; taken_at_timestamp : nat64; total_size : nat64 };
};
```

The new actions use the same names and field shapes as NNS. `DeleteCanisterSnapshot`
has no NNS counterpart yet. It is included because the 10-snapshot limit would
otherwise leave a DAO with no way to free space except `replace_snapshot`.

SNS root gets `take_canister_snapshot`, `load_canister_snapshot` and
`delete_canister_snapshot`, each a thin wrapper around `ic_nervous_system_root` the
same way as on NNS root, gated by `assert_eq_governance_canister_id`. That means a
new `delete_canister_snapshot.rs` in the shared crate, plus `list` and `delete` in
`ManagementCanisterClient`. Root keeps trusting governance to restrict targets, as
`change_canister` does today.

### 3.2 Execution order (recommended: two root calls)

`perform_upgrade_sns_controlled_canister`, when `take_canister_snapshot` is set:

1. Run the existing checks: no upgrade in progress, and the target is a registered dapp.
2. `await` root `take_canister_snapshot { canister_id, replace_snapshot }`. Root locks
   the canister, stops it, takes the snapshot, starts it and unlocks it. This call is
   synchronous, which is safe because the target is never governance.
3. On `Err`, or if root has no such method (an old root), fail the proposal with the
   root's error and **do not upgrade**.
4. On `Ok`, store the snapshot in `ProposalData.success_value` right away (like
   `set_proposal_execution_reply` does for generic functions). Then call
   `change_canister` exactly as today.

There is no automatic load if the install fails, for two reasons: root cannot see the
install outcome synchronously, and a rollback should be a deliberate DAO decision.
Restoring takes one `LoadCanisterSnapshot` proposal using the recorded id.

Trade-off: between steps 2 and 4 the dapp runs briefly (one start/stop cycle), and
anything it does in that window would be lost by a later rollback. That is small next
to what a rollback discards anyway, which is everything since the snapshot.

**Alternative B, one root lock.** Add `snapshot_before_install : opt record { replace_snapshot : opt blob }`
to the shared `ChangeCanisterRequest`. Root would then run stop → snapshot → install →
start under one lock and record the result in root state (a new query such as
`get_last_change_canister_result`), because `change_canister` replies before the work
is done. This closes the window, but it adds root state and polling. Its main risk is
that an old root **silently ignores** the unknown opt field and upgrades without a
snapshot, so governance would also have to check root's version first. Option A fails
closed instead (method not found). We prefer A, unless the team wants
`change_canister` to become synchronous for dapp targets anyway, which would also fix
§2.1 point 5.

### 3.3 Validation and rendering

- `TakeCanisterSnapshot`, `LoadCanisterSnapshot` and `DeleteCanisterSnapshot` accept only
  registered **dapp** canisters, not root, governance, ledger, swap, index or archives,
  using the same check as the upgrade path. (Open question: should registered
  extensions be allowed as well?)
- `snapshot_id` must parse as `SnapshotId` **and its embedded canister id must equal
  `canister_id`**. Without this check, root (which controls every dapp) could be told
  to load one dapp's snapshot into another.
- `replace_snapshot` must also belong to the target canister.
- The rendering of `LoadCanisterSnapshot` should state plainly that all state written
  after the snapshot will be lost, and should show the snapshot's `taken_at_timestamp`,
  `canister_version`, `source` and size. Governance can read these during validation
  through a root call to `read_canister_snapshot_metadata` or `list_canister_snapshots`.
  Optionally it can show the proposal id that created the snapshot (§3.5).
- `UpgradeSnsControlledCanister` rendering gains a line: "A snapshot will be taken
  before installing (replacing snapshot X)".

### 3.4 Topic, criticality and other classification

- All three new actions go in `Topic::DappCanisterManagement`, next to
  `UpgradeSnsControlledCanister` (`rs/sns/governance/src/topics.rs:92`), so they are
  non-critical. Loading a snapshot is equivalent to an upgrade that installs the old
  code and memory, so it should not be harder to pass than the upgrade it reverts.
  NNS made the same choice (`topic_to_manage_canister`).
- `LoadCanisterSnapshot` (and `TakeCanisterSnapshot`) count as upgrades in
  `is_upgrade_proposal` (`proposal.rs:2612`), so they serialise with other upgrades.
- `LoadCanisterSnapshot` is added to `allowed_when_resources_are_low`
  (`types.rs:1752`), because it is the emergency rollback.
- Every new action also needs: a `NativeAction` id, an `impl From<Action> for
  NervousSystemFunction` entry, an `Action → u64` mapping, and entries in
  `limited_for_get_proposal` / `limited_for_list_proposals`, the `api` crate types,
  `pb/conversions.rs` and `governance.did`. `ManageDappCanisterSettings` and
  `AdvanceSnsTargetVersion` are the most recent examples of the full checklist. During
  review the feature can stay behind the `#[cfg(feature = "test")]` preview flag
  described in `rs/nervous_system/feature_test.md`.

### 3.5 Where the snapshot id lives

- Primary: `ProposalData.success_value`, for both `TakeCanisterSnapshot` and the
  upgrade-with-snapshot proposal. It can be read with `get_proposal` and
  `list_proposals`, and it is the same place NNS uses.
- Open question: should governance also keep a small map
  `canister_id → [(snapshot_id, proposal_id)]` of snapshots it took? That would let
  `LoadCanisterSnapshot` warn about, or refuse, snapshots that no SNS proposal created
  (§4) and would make "replace my last pre-upgrade snapshot" a one-flag option.

### 3.6 Versioning and the SNS-W upgrade path

- Root must be upgraded before governance. Because SNS-W publishes one canister type
  per step, DFINITY can make sure root's Wasm is published before governance's.
- With option A, a new governance talking to an old root fails closed: the method is
  missing, the proposal fails, and no upgrade happens. A new root with an old
  governance is unaffected.
- Candid: only `opt` fields and new variants are added, so old clients keep decoding
  (the NNS dapp, `sns-cli` and quill need the new variants to *render* these
  proposals, which is the usual situation for new actions). `ProposalData`
  stays decodable.
- The upgrade-with-snapshot proposal and its later load are both governed actions, so
  no new trust in root is introduced.

## 4. Security considerations

- **Unreviewed snapshots.** Snapshots that existed before the canister was registered
  with the SNS stay on the canister, for example ones a developer took before handing
  it over. A load proposal could then install code and state the DAO never reviewed.
  Mitigations: render `source`, `taken_at_timestamp` and `canister_version`; optionally
  allow loading only snapshots that governance recorded (§3.5); and/or have
  `RegisterDappCanisters` list existing snapshots and render them. Today only root can
  take or upload new snapshots.
- **Data exposure.** If `snapshot_visibility = Public`, anyone can download the full
  memory of every snapshot. Proposal rendering should repeat the current visibility.
- **Rolling back external effects.** A rollback discards state, but effects outside the
  canister do not roll back: ledger transfers, outgoing calls, or ckBTC/ICP sent
  elsewhere. A dapp that keeps balances can create double-spend or accounting bugs
  after a load. This calls for warning text, not a code change.
- **Cycles.** The snapshotted canister pays for snapshot creation and for storing it.
  A large dapp could get close to its freezing threshold, and a failed take (out of
  cycles) aborts the upgrade, which is the safe outcome.
- **Locking.** Root's per-canister lock (`CANISTER_LOCK_ACQUISITIONS`) already rejects
  overlapping change, snapshot and load operations on one canister.
  `check_no_upgrades_in_progress` serialises them at the governance level.

## 5. Test plan

- Unit tests (governance): validation of each new action, including a foreign-canister
  snapshot id, a non-dapp target, and empty or malformed ids; topic and
  `is_upgrade_proposal` classification; rendering; execution with a mocked
  `Environment` that checks the root calls happen in order (snapshot, then
  `change_canister`) and that a failed snapshot means no `change_canister` call.
- Unit tests (root): `MockManagementCanisterClient` call sequences for take, load and
  delete, like the existing `manage_dapp_canister_settings` tests in
  `rs/sns/root/src/lib.rs`.
- PocketIC integration test, modelled on
  `rs/nervous_system/integration_tests/tests/upgrade_sns_controlled_canister_with_options.rs`
  (a WAT dapp that writes a sentinel):
  1. upgrade with `take_canister_snapshot` to a Wasm that wipes the sentinel or traps
     in `post_upgrade`;
  2. assert that `success_value` carries the id and that `list_canister_snapshots`
     (called as root) contains it;
  3. submit `LoadCanisterSnapshot` and assert the old module hash and sentinel are back;
  4. hit the 10-snapshot limit, check that the next upgrade fails closed with the
     module hash unchanged, then succeed with `replace_snapshot`;
  5. a new governance with an old root: the snapshot upgrade fails and the code is
     unchanged.
- State-machine test in `rs/sns/integration_tests/src/upgrade_canister.rs` for the
  `Reinstall` case, the strongest argument for the feature.
- Add the new methods and actions to the `rs/sns/*/unreleased_changelog.md` files.

## 6. Open questions for DFINITY

1. Option A (two root calls) or B (one lock, `ChangeCanisterRequest` field)? Or should
   `change_canister` become synchronous for dapp targets?
2. Include `DeleteCanisterSnapshot` now, or keep parity with NNS and rely on
   `replace_snapshot`?
3. Should `LoadCanisterSnapshot` be restricted to snapshots recorded by governance?
4. Default snapshot behaviour: always off (opt-in per proposal), or an SNS parameter
   that turns it on by default for dapp upgrades?
5. Should extensions (`UpgradeExtension`) get the same option?
6. Proto field and action id numbers are as shown above unless they collide with
   in-flight work.
