# Handing the Sneed Hub frontend to Sneed DAO

Runbook for moving the production frontend asset canister under SNS control and releasing it by
proposal from then on. Rehearsed on staging on 2026-10-22 (section 6 has the log).

| | |
|---|---|
| Production frontend | `pxtkg-giaaa-aaaal-ajjzq-cai` (`canister_ids.json` → `app_sneeddao_frontend.ic`) |
| Staging frontend | `2icdp-6qaaa-aaaal-qjt6a-cai` |
| SNS governance | `fi3zi-fyaaa-aaaaq-aachq-cai` |
| SNS root | `fp274-iaaaa-aaaaq-aacha-cai` |
| Mr Sneed (identity `mr_sneed`) | `tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae`, neuron `4a0d7df0…` |
| Asset canister wasm | dfx 0.31.0's, module hash `04e565b3425fe7510ee16b02adcfe3f01abc9a2725c82a21cb08969241debd62` (both canisters) |
| GNSF ids (proposed) | 7000 `commit_proposed_batch`; optional 7001 `grant_permission`, 7002 `revoke_permission` |
| Encoders | `~/.config/mr-sneed/tools/encode_commit_batch.cjs`, `encode_register.cjs`, `encode_upgrade.cjs` (`ARG_HEX`) |
| Verifier | `~/.config/mr-sneed/tools/verify_frontend_assets.cjs <canister> <dist>` (appendix A) |

## How the asset canister does releases by proposal

The asset canister (Candid: `dfx canister --network ic metadata <id> candid:service`) has three
permissions:

- **Prepare**: `create_batch`, `create_chunk(s)`, `propose_commit_batch`, `compute_evidence`,
  `delete_batch`. It can upload and propose, never publish.
- **Commit**: everything Prepare can do, plus `commit_batch` (publish directly) and
  `commit_proposed_batch` (publish a proposed batch).
- **ManagePermissions**: `grant_permission` and `revoke_permission`.

A controller has ManagePermissions implicitly, but **not** Commit. The rehearsal checked this: the
reject for Commit reads "Caller does not have Commit permission", while the ManagePermissions reject
adds "and is not a controller". A controller can still grant itself Commit or install new code, so
only SNS root may stay a controller.

`dfx deploy --by-proposal` builds, uploads the changed assets into a new batch, calls
`propose_commit_batch`, and computes the evidence: a sha256 over the batch's operations. Those
operations are CreateAsset, SetAssetContent with each encoding's sha256, SetAssetProperties (headers,
including the CSP), and DeleteAsset. dfx then prints the batch id and the evidence. Nothing is served
until someone with Commit calls `commit_proposed_batch {batch_id, evidence}`. That call publishes only
if the evidence matches. `validate_commit_proposed_batch` runs the same check without changing
anything, and anyone may call it. It is the GNSF validator.

The evidence is computed against the canister's current content, because dfx uploads only the assets
that differ. While a batch is proposed, no other batch can be created ("Batch N is already proposed.
Delete or execute it to propose another."), and nobody else can commit. So the canister cannot change
under a pending proposal, and anyone who rebuilds the same commit recomputes the same evidence with
`dfx deploy --compute-evidence`. The rehearsal did this anonymously.

## 1. Preconditions and permission setup (production)

### 1.1 Before anything touches production

1. **Make the frontend build reproducible. This is done in the working tree but not committed yet;
   it must be committed and pushed.** Before the fix, two builds of one commit differed:
   - `version.json` held `Date.now()` plus a random value. It now holds a hash of the rest of `dist/`.
   - dfx gives every canister that has no id on the target network a **random** made-up 8-byte id in
     `CANISTER_ID_*`. On staging that was `sneed_proxy`, `sneed_guardian_blackhole` and
     `sneed_guardian_multidao`. On ic it is also `sneed_pad`, `sneed_mon`, `icrc7_demo` and
     `sneed_guardian`. These ids were baked into the bundle and changed the chunk hashes.
     `vite.config.js` now replaces each one with an 8-byte id derived from the variable name. That id
     is still not a canister id, so `realCanisterId()` and the guardian list treat it as missing,
     exactly as before.

   With the fix, two builds gave byte-identical `dist/` trees and the same evidence (section 6).
2. **Commit `package-lock.json`.** It is currently ignored (`.gitignore`: `**/package-lock.json`).
   Without it, a voter's `npm install` resolves the caret ranges to other versions and the bundle
   differs. Remove the ignore line, commit the lock file, and have voters run `npm ci`. Also pin the
   Node major version in an `.nvmrc` or `engines` field. The release builds used Node v24.17.0 and
   npm 11.13.0.
3. **Toolchain.** Frontend releases use `dfx +0.31.0`. Its bundled asset wasm is the one installed
   (04e565b3…), so `dfx deploy` does not try to upgrade the canister's code. A newer dfx with a
   different asset wasm would try `install_code` during `--by-proposal`, and that fails without
   controller rights. Keep 0.31.0 until the wasm itself is upgraded by proposal (section 4). The
   prebuild runs `dfx generate`, which compiles every Motoko canister for its Candid. Voters need the
   same compiler setup: `DFX_MOC_PATH=moc-wrapper` (mops-pinned moc 0.14.13, see `mops.toml`).
   Build at `/home/snassy/app_sneeddao`. The frontend bundle holds no absolute paths (checked), but
   only that path was rehearsed.
4. **Staging matches production.** Repeat section 6 on staging with the exact release commit. Also
   rehearse the `UpgradeSnsControlledCanister` argument from section 4 on staging, with the owner's
   go-ahead. It was not run in this rehearsal (see section 6).
5. **Know every controller.** Today's prod controllers are `4pray-…-vae`, `cynex-…-nae`,
   `d7zib-…-crbkz-nae`, `seabo-…-nae` and the canister `ysnig-haaaa-aaaal-ad3rq-cai` (module
   b944b1e5…, controlled by cynex, probably a cycles wallet). Registration with the SNS removes them
   all. If anything relies on being a controller of the frontend (cycles monitoring, `canister_status`
   readers), move it first. Top-ups keep working for anyone.

### 1.2 Target permission state

| Permission | Holders after handover | Why |
|---|---|---|
| Prepare | Mr Sneed `tksci-…-aae` (optionally named developers) | Upload and propose releases. Can delete a pending batch, so it can delay releases but cannot publish. |
| Commit | **only** SNS governance `fi3zi-fyaaa-aaaaq-aachq-cai` | Called by GNSF 7000 when a release proposal executes. |
| ManagePermissions | **only** SNS governance `fi3zi-…` | For GNSF 7001/7002, if they are added. SNS root, as the sole controller, has it implicitly anyway. |
| Controller | **only** SNS root `fp274-iaaaa-aaaaq-aacha-cai` | Code upgrades by `UpgradeSnsControlledCanister`. |

Prod today: Commit = `cynex-…`, `4pray-…`, `d7zib-…`; Prepare and ManagePermissions are empty. Each
of those Commit holders could publish anything with `commit_batch` even after the SNS takes control,
because permissions live in the canister's state and not in its controller list. **They must be
revoked**, and while the owner is still a controller, because only a controller or a
ManagePermissions holder can revoke.

### 1.3 Commands (the owner runs these with a prod controller identity; agents do not)

```bash
FE=pxtkg-giaaa-aaaal-ajjzq-cai; GOV=fi3zi-fyaaa-aaaaq-aachq-cai; MRS=tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae
call() { dfx +0.31.0 canister --network ic call $FE "$@"; }
# grant
call grant_permission "(record { to_principal = principal \"$GOV\"; permission = variant { Commit } })"
call grant_permission "(record { to_principal = principal \"$GOV\"; permission = variant { ManagePermissions } })"
call grant_permission "(record { to_principal = principal \"$MRS\"; permission = variant { Prepare } })"
# revoke human Commit
for p in cynex-3ipav-gd6hh-faroh-3smak-vj7o7-fvpui-kkd4k-ommdw-i4ydu-nae \
         4pray-6ardh-7plm3-wwqvs-gyofv-bfkrq-ds4fg-grawp-gtgmi-ynlwi-vae \
         d7zib-qo5mr-qzmpb-dtyof-l7yiu-pu52k-wk7ng-cbm3n-ffmys-crbkz-nae; do
  call revoke_permission "(record { of_principal = principal \"$p\"; permission = variant { Commit } })"
done
# check: Commit = [fi3zi], ManagePermissions = [fi3zi], Prepare = [tksci]
for p in Prepare Commit ManagePermissions; do call list_permitted "(record { permission = variant { $p } })"; done
```

From here until the SNS executes the first release, the frontend cannot be released except by a
controller granting itself Commit again. Freeze frontend changes for that window, or run 2.1 and 2.2
on the same day.

## 2. The SNS side

### 2.1 Order

1. Section 1.3: grants and revokes, run by the owner.
2. **The owner adds SNS root as a controller by hand.** Agents never change controllers.
   ```bash
   dfx +0.31.0 canister --network ic update-settings pxtkg-giaaa-aaaal-ajjzq-cai --add-controller fp274-iaaaa-aaaaq-aacha-cai
   dfx +0.31.0 canister --network ic info pxtkg-giaaa-aaaal-ajjzq-cai   # fp274 must be listed
   ```
   `RegisterDappCanisters` fails if root is not already a controller when the proposal executes. Do
   this before submitting the proposal. Do not remove the owner's own controllers here: if the
   proposal is rejected, the owner keeps control.
3. **The `RegisterDappCanisters` proposal** for `pxtkg-giaaa-aaaal-ajjzq-cai`:
   ```bash
   T=~/.config/mr-sneed/tools; NEURON=4a0d7df0c5bbedeac5d5ff141c4bc97992d1f21ad1b5be0b3cea8dca340fe0c4 \
   node $T/encode_register.cjs $T/gov_idl.cjs /tmp/reg_fe.hex "Register the Sneed Hub frontend with Sneed DAO" summary_register.md pxtkg-giaaa-aaaal-ajjzq-cai
   DFX_WARNING=-mainnet_plaintext_identity dfx canister --network ic --identity mr_sneed call fi3zi-fyaaa-aaaaq-aachq-cai manage_neuron --type raw --argument-file /tmp/reg_fe.hex
   ```
   On execution, root makes itself the **sole** controller. Afterwards,
   `dfx canister --network ic info pxtkg…` must show only `fp274-iaaaa-aaaaq-aacha-cai`. If any other
   controller is left, remove it with a `ManageDappCanisterSettings` proposal.
4. **The `AddGenericNervousSystemFunction` proposal** for id 7000, and optionally 7001/7002 as
   separate proposals. It can be submitted together with step 3, but Commit by proposal only means
   something once step 3 has executed. Recommendation: submit it after step 3 executes.
5. **The first release by proposal** (section 3), as an end-to-end check on production. It can be a
   rebuild of the commit the owner last deployed, which is then an almost empty batch (only
   `version.json`, `index.html` and the chunks that change with the new deterministic ids).

### 2.2 The GNSF

| Field | Value |
|---|---|
| id | `7000`. Free: Sneed uses 0–19 native, 2000–2006, 3000–3005, 4000–4013 and 5000; the proxy plan reserves 6000–6099. |
| name | `Sneed Hub frontend: commit proposed batch` |
| target | `pxtkg-giaaa-aaaal-ajjzq-cai` . `commit_proposed_batch` |
| validator | `pxtkg-giaaa-aaaal-ajjzq-cai` . `validate_commit_proposed_batch` |
| topic | **`DappCanisterManagement`** (recommended) |
| payload of each Execute proposal | Candid `(record { batch_id : nat; evidence : blob })` |

**Why DappCanisterManagement and not CriticalDappOperations.** A malicious frontend is dangerous: it
runs as every user's Sneed Hub principal and could sign transfers. But an upgrade of
`sneed_lock`, `sneedex` or the backend is just as dangerous, and those go by
`UpgradeSnsControlledCanister`, which is on DappCanisterManagement. The asset canister's own
`UpgradeSnsControlledCanister` (section 4) can also reset every permission through its upgrade
argument. A Critical topic for releases would make every frontend release slower (higher threshold,
longer voting) than a backend upgrade without closing that route. Use CriticalDappOperations only if
the DAO wants frontend releases to be rarer and more scrutinised than backend upgrades.
`SetTopicsForCustomProposals` can change the topic later.

For 7001/7002 (`grant_permission`/`revoke_permission`, validators
`validate_grant_permission`/`validate_revoke_permission`), the encoder defaults to
`CriticalDappOperations`, since granting Commit bypasses the release vote. They are optional: an
upgrade proposal with `set_permissions` does the same (section 4).

Encode the proposals. This writes files only; nothing is submitted:

```bash
T=~/.config/mr-sneed/tools
node $T/encode_commit_batch.cjs $T/gov_idl.cjs add-gnsf /tmp/gnsf7000.hex "Add GNSF 7000: commit Sneed Hub frontend releases" summary_gnsf.md
#  → id 7000, topic DappCanisterManagement, target pxtkg….commit_proposed_batch, validator pxtkg….validate_commit_proposed_batch
node $T/encode_commit_batch.cjs $T/gov_idl.cjs add-gnsf /tmp/gnsf7001.hex "Add GNSF 7001: frontend grant_permission"  summary.md 7001 grant_permission
node $T/encode_commit_batch.cjs $T/gov_idl.cjs add-gnsf /tmp/gnsf7002.hex "Add GNSF 7002: frontend revoke_permission" summary.md 7002 revoke_permission
# submit (Mr Sneed's neuron is the default NEURON):
DFX_WARNING=-mainnet_plaintext_identity dfx canister --network ic --identity mr_sneed call fi3zi-fyaaa-aaaaq-aachq-cai manage_neuron --type raw --argument-file /tmp/gnsf7000.hex
```

The `AddGenericNervousSystemFunction` record, as the encoder builds it:

```candid
variant { AddGenericNervousSystemFunction = record {
  id = 7_000 : nat64;
  name = "Sneed Hub frontend: commit proposed batch";
  description = opt "Publishes a frontend release: commits the asset batch that a Prepare principal proposed on the Sneed Hub frontend asset canister, after the validator checks that batch id and evidence match the proposed batch. Canister pxtkg-giaaa-aaaal-ajjzq-cai.";
  function_type = opt variant { GenericNervousSystemFunction = record {
    topic = opt variant { DappCanisterManagement };
    target_canister_id = opt principal "pxtkg-giaaa-aaaal-ajjzq-cai";
    target_method_name = opt "commit_proposed_batch";
    validator_canister_id = opt principal "pxtkg-giaaa-aaaal-ajjzq-cai";
    validator_method_name = opt "validate_commit_proposed_batch";
  } };
} }
```

## 3. Each release afterwards

### 3.1 Prepare (Mr Sneed, Prepare-only, never a controller)

```bash
cd /home/snassy/app_sneeddao
git status --short            # must be clean apart from untracked notes; release = a pushed commit
git rev-parse HEAD            # → <commit>
npm ci
export DFX_WARNING=-mainnet_plaintext_identity
yes | dfx +0.31.0 deploy app_sneeddao_frontend --network ic --by-proposal --identity mr_sneed
#  → "Proposed commit of batch <N> with evidence <E>.  Either commit it by proposal, or delete it."
git checkout -- src/declarations    # the prebuild's dfx generate rewrites them
```

Before proposing, list what changes (read-only, anonymous):

```bash
node ~/.config/mr-sneed/tools/verify_frontend_assets.cjs pxtkg-giaaa-aaaal-ajjzq-cai src/app_sneeddao_frontend/dist
#  DIFFERS/MISSING lines = assets this batch changes or adds; EXTRA = assets it deletes
```

Check the batch the way the GNSF will (anyone can call this):

```bash
EV=$(python3 -c "import sys;print(''.join('\\\\%02x'%b for b in bytes.fromhex(sys.argv[1])))" <E>)
dfx +0.31.0 canister --network ic --identity anonymous call pxtkg-giaaa-aaaal-ajjzq-cai validate_commit_proposed_batch "(record { batch_id = <N>; evidence = blob \"$EV\" })"
#  → variant { Ok = "commit proposed batch <N> with evidence <E>" }
```

### 3.2 Propose

```bash
T=~/.config/mr-sneed/tools
node $T/encode_commit_batch.cjs $T/gov_idl.cjs commit /tmp/fe_release.hex "Sneed Hub frontend release <short commit>" summary_release.md <N> <E>
#  prints the decoded payload: function_id 7000, batch_id <N>, evidence <E>, payload_hex
DFX_WARNING=-mainnet_plaintext_identity dfx canister --network ic --identity mr_sneed call fi3zi-fyaaa-aaaaq-aachq-cai manage_neuron --type raw --argument-file /tmp/fe_release.hex
```

At submission, governance calls the validator. A wrong or deleted batch fails it, and the proposal is
not created. Mr Sneed's neuron is counted as voting yes on its own proposal, so the text must not
promise otherwise.

**The proposal text must contain:**
- git commit (full hash), the GitHub link, and the changes since the last frontend release
- batch id `<N>`, evidence `<E>`, and the payload hex printed by the encoder
- toolchain: dfx 0.31.0, `DFX_MOC_PATH=moc-wrapper` (moc 0.14.13), Node and npm versions,
  `npm ci`, build path `/home/snassy/app_sneeddao`
- the list of changed, added and deleted assets (verifier output)
- whether `.ic-assets.json5` (headers, CSP) changed
- reproduction steps (3.3)

### 3.3 What voters check (reproduction)

```bash
git clone https://github.com/Snassy-icp/app_sneeddao /home/snassy/app_sneeddao && cd /home/snassy/app_sneeddao
git checkout <commit>
npm ci
export DFX_MOC_PATH=moc-wrapper        # mops-pinned moc, as for canister releases
yes | dfx +0.31.0 deploy app_sneeddao_frontend --network ic --compute-evidence --identity anonymous
#  last line: <E'>  — must equal <E> in the proposal
```

`--compute-evidence` builds, diffs against the live canister and prints the evidence. It uploads
nothing and needs no permission; the rehearsal ran it as `anonymous`. It is only meaningful while the
proposal is open, because after the commit the canister already holds the new content. After
execution, check instead that the served content equals the build:

```bash
node ~/.config/mr-sneed/tools/verify_frontend_assets.cjs pxtkg-giaaa-aaaal-ajjzq-cai src/app_sneeddao_frontend/dist   # 0 mismatches
```

Voters also check:
- that the payload decodes to the stated batch and evidence:
  `didc decode -d asset.did -t '(CommitProposedBatchArguments)' <payload_hex>`, with `asset.did` from
  `dfx canister --network ic metadata pxtkg… candid:service`. Compare the decoded text, not the bytes:
  the JS encoder and didc order the type table differently.
- that `validate_commit_proposed_batch` returns `Ok` for that batch and evidence
- the diff of the release commit, especially `public/.ic-assets.json5` (CSP), `index.html`,
  `sw.js`, and anything that builds or sends ledger transactions

### 3.4 After execution

- `curl -s https://pxtkg-giaaa-aaaal-ajjzq-cai.icp0.io/version.json` shows the new build id
  (= `dist/version.json`), and the verifier reports 0 mismatches.
- `curl -sI https://pxtkg-giaaa-aaaal-ajjzq-cai.icp0.io/ | grep -i content-security-policy` shows the
  CSP from `.ic-assets.json5`.
- Announce in forum topic 899.

### 3.5 Failure, supersession, rollback

- **The proposal is rejected or abandoned.** Mr Sneed deletes the batch, which frees the canister for
  the next one:
  `dfx +0.31.0 canister --network ic --identity mr_sneed call pxtkg… delete_batch "(record { batch_id = <N> })"`.
  Then `validate_commit_proposed_batch` gives `Err "batch not found"`, so a late adoption cannot
  publish anything.
- **A newer build should replace a pending one.** Only one batch can be proposed at a time; the
  second `create_batch` traps. Delete the old batch first. Its open proposal can then only fail
  ("batch not found") if adopted, so say so in that proposal's thread and vote it down. Then run
  `--by-proposal` again. Batch ids only increase, so the new batch gets a new id and needs a new
  proposal. A proposal never points at content other than what its evidence fixes.
- **Execution failed.** The batch was deleted, or the evidence did not match. Nothing changed: the
  call is all or nothing. Prepare again and propose again.
- **Expiry.** An unproposed batch expires after a few minutes without uploads. A proposed batch with
  computed evidence was still committable more than 8 minutes after it was proposed, which is past
  the plain-batch expiry. Before submitting, and again before voting closes, call the validator.
- **Rollback** is a normal release of an older commit: check out the last good commit, run
  `--by-proposal`, and propose. There is no faster path once nobody but governance holds Commit.
  Hotfixes wait for a vote; `DappCanisterManagement` proposals can pass early with an absolute
  majority.
- **The Prepare principal is lost or compromised.** It can only delay releases (upload junk, delete
  pending batches); it cannot publish. Revoke it by GNSF 7002, or by an upgrade with
  `set_permissions`, and grant a new one.

## 4. Upgrading the asset canister's wasm

The asset canister's code (not its content) is upgraded by `UpgradeSnsControlledCanister`, the same
as the other dapp canisters:

- Wasm: the `assetstorage.wasm.gz` of the target dfx release. Take it from
  `.dfx/ic/canisters/app_sneeddao_frontend/assetstorage.wasm.gz` after a `dfx +<ver> build --network ic app_sneeddao_frontend`.
  Its sha256 must be the module hash in the dfx changelog or release notes (0.31.0: `04e565b3…`).
  Voters compare the proposal's wasm hash with the hash of that dfx release.
- Mode: upgrade. It is a Rust canister, so no `wasm_memory_persistence` option. Content and
  permissions survive in stable memory.
- **The upgrade argument must be valid Candid.** The rehearsal ran an upgrade with an empty argument
  on staging: it trapped in `post_upgrade` ("binary parser error: io error"), and the canister rolled
  back unharmed. Use `()` = `4449444c0000`, or
  `(opt variant { Upgrade = record { set_permissions = null } })` to say explicitly that permissions
  stay. `encode_upgrade.cjs` takes it as `ARG_HEX`:
  ```bash
  ARG_HEX=4449444c0000 node $T/encode_upgrade.cjs $T/gov_idl.cjs /tmp fe_wasm pxtkg-giaaa-aaaal-ajjzq-cai .dfx/ic/canisters/app_sneeddao_frontend/assetstorage.wasm.gz "Upgrade Sneed Hub frontend asset canister to dfx <ver>" summary.md
  ```
  Voters must decode the argument. `Upgrade = record { set_permissions = opt record { prepare; commit; manage_permissions } }`
  **replaces all three permission lists**, so it can hand Commit to anyone. It is a permissions
  proposal in disguise, and should be the only reason a non-trivial argument is used.
- **Order.** Upgrade the canister's wasm first. Only then move the release toolchain to that dfx
  version; otherwise `dfx deploy --by-proposal` tries to install the newer wasm itself and fails.
- **Headers and CSP.** Asset headers live in the canister's state and survive the upgrade.
  `.ic-assets.json5` is applied at upload: each release's CreateAsset and SetAssetProperties
  operations carry the headers, and the evidence covers them. A release with a changed
  `.ic-assets.json5` therefore shows up in the evidence and must be called out in the proposal. The
  CSP's `script-src` pins the inline script's hash (`sha256-ZWpz…`). If `index.html`'s inline script
  changes, that hash must change in the same commit, or the site breaks. Check the CSP after every
  release and after every wasm upgrade (3.4). Rehearse each wasm upgrade on staging first.

## 5. Risks and how the rehearsal covered them

| Risk | Mitigation | Covered |
|---|---|---|
| Voters cannot reproduce the evidence | Deterministic build (vite fix), committed lock file, pinned toolchain | Fixed and shown: two builds identical, anonymous `--compute-evidence` = proposed evidence. Lock file still to commit. |
| A human keeps a way to publish | Revoke human Commit before registration; root sole controller | Shown that Commit holders publish without being controllers, that controllers lack Commit but have ManagePermissions, and that a ManagePermissions holder revokes |
| Prepare principal publishes | Prepare cannot `commit_batch` or `commit_proposed_batch`, and cannot grant | Shown (Commit permission rejects) |
| Wrong batch or evidence adopted | Validator checks at submission; commit checks again | Shown: wrong evidence → Err with both hashes; wrong id → Err "batch not found" |
| Stale proposal executed after a replacement | Deleted batch → validator Err; commit traps "batch not found" | Shown |
| Two releases race | Only one proposed batch at a time | Shown: `create_batch` traps "Batch 5178 is already proposed" (for Prepare and Commit callers) |
| Batch expires during the vote | Proposed batches with evidence stay | Partly: committed after more than 8 minutes. Not tested over a multi-day vote; validate before the vote ends. |
| Site breaks after commit | Verifier and CSP check | Shown: served bytes = build (0 mismatches over 108 assets), CSP intact, commit took about 2 s |
| Asset wasm upgrade bricks | Valid Candid argument, staging first | Empty argument traps (rolled back, state intact). The `()` upgrade on staging was **not run**: the session's permission guard stopped it. Do it with the owner's go-ahead before the first prod wasm upgrade. |
| Newer dfx tries to install code | Pin dfx 0.31.0 until the wasm is upgraded | Checked: 0.31's asset wasm = installed hash, `--by-proposal` skipped install |
| A canister controller (ysnig…) loses access | Find out what it is before registration | Open: owner to confirm |
| GNSF on the wrong topic | DappCanisterManagement, changeable via SetTopicsForCustomProposals | Decision for the DAO |

## 6. Staging rehearsal log (2026-10-22)

Canister `2icdp-6qaaa-aaaal-qjt6a-cai`, dfx 0.31.0. Stand-ins:

| Role | Identity | Principal | Permissions |
|---|---|---|---|
| Developer | `fe_prepare_rehearsal` (new plaintext identity) | `eyvrn-v26vv-udjgt-g4jop-owbdx-sofcs-zo4tg-qufjw-jbnue-robkf-eae` | Prepare only |
| SNS governance | `claude` | `xda3q-…-nae` | Commit + ManagePermissions |

Steps, in order:

1. **Setup.** `list_permitted` showed Prepare=[], ManagePermissions=[], and Commit = tksci, cynex,
   l6svl, d7zib. `claude` calling `grant_permission` was rejected ("does not have ManagePermissions
   permission and is not a controller"). `validate_grant_permission` works for anyone. As mr_sneed
   (controller): Prepare granted to `eyvrn`, Commit and ManagePermissions to `xda3q`.
2. **Reproducibility before the fix.** Two `dfx +0.31.0 build --network staging` runs of HEAD
   540cb973 differed in `version.json`, `index.html` and 5 JS chunks. The causes were the random
   `buildId` and dfx's random placeholder ids for `sneed_proxy` and `sneed_guardian_{blackhole,multidao}`.
3. **Proposal 1 (pre-fix build).** `dfx +0.31.0 deploy app_sneeddao_frontend --network staging --by-proposal --identity fe_prepare_rehearsal`
   gave `Proposed commit of batch 5_178 with evidence cdf0ffd5…590e`.
   - `validate_commit_proposed_batch` as anonymous: with the right evidence `Ok`; with a wrong
     evidence `Err "batch computed evidence cdf0… does not match presented evidence …"`; with a wrong
     id `Err "batch not found"`.
   - `eyvrn` (Prepare): `commit_proposed_batch`, `commit_batch` and `grant_permission` were all
     rejected. `compute_evidence` returned the evidence.
   - Anonymous `create_batch`: rejected ("does not have Prepare permission").
   - Second proposal while pending: `create_batch` by `eyvrn` and by `xda3q` trapped with "Batch 5_178
     is already proposed. Delete or execute it to propose another."
   - Abandonment: `delete_batch 5178` by `eyvrn` returned `()`. After that the validator gave
     `Err "batch not found"`, and `commit_proposed_batch` by `xda3q` trapped "batch not found". The
     site was unchanged (old `buildId`).
4. **Determinism fix** in `src/app_sneeddao_frontend/vite.config.js` (uncommitted).
5. **Proposal 2.** `--by-proposal` as `eyvrn` gave `batch 5_179 with evidence 60bcf0f8b9fbb3ec6ca839dac6ef450401cfdc7d5185509efb503c0c1333f5ef`.
   A separate rebuild with `dfx +0.31.0 deploy … --compute-evidence --identity anonymous` printed
   the **same evidence**, and the two `dist/` trees were byte-identical.
6. **Commit.** At 00:03 UTC, more than 8 minutes after the proposal, the validator returned `Ok`.
   `commit_proposed_batch {5179, evidence}` by `xda3q` (Commit only, not a controller) returned `()`
   in about 2 s. The validator then gave `Err "batch not found"`. The site served
   `{"buildId":"6610404f6ccf6955"}` (= local `dist/version.json`), the `index.html` sha256 matched
   the local build (3a103c13…), the verifier reported 0 mismatches over 108 assets, and the CSP,
   HSTS and X-Frame-Options headers were intact.
7. **Asset wasm upgrade argument.** As mr_sneed, `install --mode upgrade` with the same 0.31.0 wasm
   and an **empty** argument trapped in `post_upgrade` (Candid parser) and rolled back: module hash,
   permissions and content were all unchanged (verifier: 0 mismatches). The follow-up upgrade with
   `()` was not run (blocked by the session's permission guard).
8. **Cleanup.** `xda3q` (ManagePermissions, not a controller) revoked `eyvrn`'s Prepare. mr_sneed
   revoked `xda3q`'s Commit and ManagePermissions. Permissions are back to the original state.
   `git checkout -- src/declarations`. Staging now serves the build of 540cb973 plus the vite fix.

## Appendix A: verifier

`~/.config/mr-sneed/tools/verify_frontend_assets.cjs <canisterId> <distDir>` lists the canister's
assets anonymously. It compares each asset's identity-encoding sha256 with the local file. For assets
dfx stored gzip-only (for example `sw.js` and the large chunks), it downloads, gunzips and hashes
them. It prints `MISSING`/`DIFFERS`/`EXTRA` lines and exits 0 only when all match. Run it against the
live canister before a release to list what the batch will change. Run it after execution to prove
the canister serves the reviewed build.
