# Sneed attestation registry API

The attestation registry (`sneed_attestations`) is an on-chain record of **who rebuilt what** for each step of a governance proposal, next to the registry's **own check of the module that actually went live**. Upgrade proposals ask voters to trust that a wasm (or a frontend batch) was built from the commit the summary names. Independent builders rebuild it wherever they like and attest the result here; any DAO frontend reads the same results.

- **Builds stay off-chain.** A builder is any principal; the IC's signature on its `attest` call is the attestation.
- **The canister checks what it can.** After a step executes it reads the target's live module hash and the installer with the management canister's `canister_info`, and for a frontend step the asset tree from the asset canister's `list`. Those checks need no permission and no trust in any builder.
- **Per builder, never one score.** Results are shown per builder. Which builders a DAO trusts is that DAO's choice (its known-builders list, set by its governance), and it changes only highlighting.
- **Informational, not a gate.** No DAO's upgrade path depends on the registry being up.

Governance kinds: SNS governance (`get_proposal`) and OhShii's ONS and SONS (`get_proposal_upgrade_steps`, OhShii's planned read interface, to be confirmed when OhShii ships it). The registry also takes `#release` subjects: installs that are not proposals (for example a controller install during a DAO handover), identified by target and module hash.

| | |
|---|---|
| Production canister | `a5rqn-baaaa-aaaac-bghua-cai` (reserved, not deployed yet) |
| Staging canister | `xrnbc-uaaaa-aaaac-qhm7a-cai` (reserved, not deployed yet) |
| Candid interface | [sneed_attestations.did](/api-docs/sneed_attestations.did) · [JavaScript IDL factory](/api-docs/sneed_attestations.did.js) |
| Source | [src/sneed_attestations](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_attestations) (`main.mo`, `Types.mo`, `SnsGov.mo`, `OhShiiTypes.mo`, `Live.mo`) |
| Design notes | [spec/proposal_attestations.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/proposal_attestations.md) |
| This document | [rendered](/api/sneed_attestations) · [raw Markdown](/api-docs/sneed_attestations.md) |

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide that links back here. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 Subjects and artifacts

```candid
type Subject = variant {
  proposal : record { governance : principal; proposal_id : nat64; step : nat };  // step 0 for single-action proposals
  release  : record { target : principal; module_hash : blob };                  // an install that is not a proposal
};
type Artifact = variant {
  wasm : record {
    target : principal; proposed_sha256 : blob; built_raw_sha256 : blob; built_gz_sha256 : opt blob;
    embedded : vec record { name : text; sha256 : blob }; upgrade_arg_sha256 : opt blob };
  asset_batch : record {
    target : principal; batch_id : nat; proposed_evidence : blob; built_evidence : opt blob; tree_sha256 : blob };
};
type Verdict = variant { match; mismatch; cannot_verify : text };   // the builder's own comparison
```

All hashes are 32-byte sha256 blobs. `proposed_sha256` / `proposed_evidence` are what the builder read from the proposal; the registry flags a step whose builders read it differently (`proposed_disagree`) and says per attestation whether it agrees with what the registry itself read (`proposal_agrees`).

A builder may attest the same subject again (after fixing a recipe): the newest counts, `versions` says how many it made, the older ones stay in state (up to `max_versions_per_builder`) and in the ICRC-3 log forever.

### 1.2 What the registry reads (adapters)

- **SNS governance, `get_proposal`.** One step (0). `UpgradeSnsControlledCanister`: the target is the action's `canister_id`; the wasm hash is `chunked_canister_wasm.wasm_module_hash` or the hash rendered in `payload_text_rendering` (the first `SHA256` followed by 64 hex characters); `upgrade_arg_sha256` is the sha256 of `canister_upgrade_arg`. `ExecuteGenericNervousSystemFunction` whose function (from `list_nervous_system_functions`) targets `commit_proposed_batch`: the payload is decoded as `record { batch_id : nat; evidence : blob }` and the target is the function's `target_canister_id`. Execution: `executed_timestamp_seconds`, `failed_timestamp_seconds` with `failure_reason`; decided over an hour ago with neither means not executed (rejected). Any other action is "not an upgrade proposal".
- **ONS and SONS, `get_proposal_upgrade_steps(nat64)`.** The steps in proposal order: index, target, `is_self`, role, artifact (`wasm { module_hash; size_bytes; chunked; upgrade_arg_sha256 }`, `asset_batch { batch_id; evidence }`, `snapshot_restore { snapshot_id }`), source (`git_repo_url`, `git_commit_hash`, `build_instructions`, `truncated`) and execution (`pending`, `not_executed`, `in_progress`, `executed`, `skipped`, `failed { at; error }`). `null` means not an upgrade proposal. Every non-essential field is read as optional, so a field OhShii adds or types differently doesn't break the read. A governance canister without the method (an older module) shows "cannot read proposal".
- A governance canister's kind is found by probing (the OhShii read first, then SNS's `get_proposal`) and kept; controllers can set it.

### 1.3 What the registry checks itself

After a step is final, promptly (the IC keeps only a canister's 20 most recent changes):

| Step | Check | Result |
|---|---|---|
| wasm, executed | `canister_info` of the target | `live_match` if the live module hash equals the proposal's hash (else the hash all its builders read), otherwise `live_mismatch` saying whether the proposed module was installed and later replaced, or never appears in the history. `installed_by`: the code deployment that put the compared module there, with its role: `governance`, `dao_root` (an SNS's dapp canisters are installed by SNS root, learned from SNS-W), `other_canister` or `user`. |
| wasm, skipped | the same | `live_match` when the hash is live, `skipped = true`, `installed_by` = the earlier install. |
| snapshot restore | `canister_info` | `snapshot_restored { before; after; snapshot_id }`: the module before the restore (the newest deployment before it in the history) and after it. Nothing is proposed to rebuild, so builders don't attest it. |
| asset batch, executed | the asset canister's `list`, paged | `asset_tree { tree_sha256; identity_tree_sha256; assets; encodings }`. |
| failed | none | `not_checked`, with the governance's error. |
| not executed | none | `not_checked`. |

Per attestation, `live_agrees` says whether the live module equals the builder's `built_raw_sha256` or `built_gz_sha256`, or the live tree equals its `tree_sha256`.

A `#release` is checked as soon as its first attestation arrives: is the module live (or in the recent history, and replaced since), and who installed it.

### 1.4 The asset tree hash

`tree_sha256` is sha256 of the UTF-8 text made of one line per (asset, encoding) in `list`'s output:

```
key "\t" content_encoding "\t" sha256
```

where `sha256` is the encoding's sha256 in lower-case hex (`-` when `list` gives none). The lines are sorted in ascending Unicode code point order (the byte order of their UTF-8) and joined by `\n`, with no trailing newline. `identity_tree_sha256` is the same over the `identity` encodings only, which a rebuilt dist folder gives without knowing the canister's compression; a builder agrees when its `tree_sha256` equals either. `get_tree_hash_format()` returns this definition. Batch evidence can't be recomputed after a commit; the tree hash can. A frontend step checked after a later release shows that release's tree.

## 2. Quick start

### 2.1 Attest

```bash
dfx canister --network ic call a5rqn-baaaa-aaaac-bghua-cai attest '(record {
  subject = variant { proposal = record { governance = principal "fi3zi-fyaaa-aaaaq-aachq-cai"; proposal_id = 480 : nat64; step = 0 } };
  artifact = variant { wasm = record {
    target = principal "<canister>"; proposed_sha256 = blob "<32 bytes>"; built_raw_sha256 = blob "<32 bytes>";
    built_gz_sha256 = opt blob "<32 bytes>"; embedded = vec {}; upgrade_arg_sha256 = null } };
  source = record { repo = "https://github.com/Snassy-icp/app_sneeddao"; commit = "<full sha>";
    recipe = "tools/release-build.sh --commit <sha> sneed_sns_forum"; environment = opt "<image digest>" };
  verdict = variant { match };
  log_url = opt "<forum post or CI run>";
})'
```

Returns `variant { ok = record { id; block } }` (the attestation's id and its ICRC-3 block) or `err` with the reason.

### 2.2 Read

- `get_proposal_status(governance, proposal_id) -> opt ProposalStatus`: the registry's read of the proposal (`read`, or `read_error`), `watch` (`watching`, `done`, `stopped : text`), `next_check_at`, and per step: the proposed artifact, `builders_match` / `builders_mismatch` / `builders_cannot`, the same counting only known builders, `proposed_disagree`, `builders_live_agree` / `builders_live_disagree`, `live` (`live_match` / `live_mismatch`), the full `live_check` and `installed_by`.
- `get_attestations(subject) -> vec AttestationView`: the newest attestation of each builder with `known_builder`, `versions`, `proposal_agrees`, `target_agrees`, `live_agrees`.
- `get_attestation_history(subject, builder)`: that builder's versions still in state.
- `get_proposal_summaries(governance, vec nat64)` (at most 100) for proposal lists; `list_proposals(start, limit)`; `get_release_status(target, module_hash)`.

## 3. Builders and known builders

- `set_builder_profile(record { name; contact : opt text; repo : opt text; description : opt text })`: optional, public. `get_builder(principal)`, `list_builders(start, limit)`.
- `set_known_builders(record { builders : vec record { builder : principal; note : opt text } }) -> (text)` replaces the known-builders list **of the calling canister**: a DAO's governance canister calling for itself. An SNS adds it as a generic nervous system function with target method `set_known_builders` and validator `validate_set_known_builders` (a query that renders the list and the additions and removals against the current one, and refuses duplicates or more than `max_known_builders`). Ingress calls are refused. `get_known_builders(governance)`.
- The list changes only how frontends highlight builders (`known_builder`, the `known_*` counts) and which proposals are read first when a DAO's call budget is tight. It never changes what is recorded.

## 4. Polling and the call budget

The registry watches only proposals with at least one attestation. A timer (every `tick_s`, default 60 s; no heartbeat) runs rounds of at most `max_in_flight` (3) calls, up to `max_calls_per_tick`:

1. live checks of executed steps (`canister_info`: the management canister, not billed to the DAO), releases;
2. proposal reads that are due: hourly while voting is open (`poll_open_s`, and a minute after an SNS proposal's deadline), every `poll_executing_s` (300 s) once adopted, until every step is final. Proposals attested by a DAO's known builders are read first.

Some DAOs (OhShii among them) bill replicated reads to themselves and admit only a capped set of readers. The registry keeps to a published budget in code: at most `calls_per_hour_per_dao` billed calls (proposal reads, function lists, asset list pages) per DAO per hour. Over it, that DAO is skipped until the next hour, then twice as long each consecutive time, up to `max_backoff_s`. `get_call_budget()` publishes the registry's principals (mainnet and staging), every method it calls with when and whether it is billed, an estimate, and each DAO's use (`calls_this_hour`, `throttled_hours`, `backoff_until`).

A read that fails is retried with back-off (5 minutes, doubling, at most 6 hours) and given up after `max_read_failures`; a definitive answer (no such proposal, not an upgrade proposal) stops at once. Proposals still not final after `max_watch_s` (30 days) are no longer watched. Controllers can `admin_recheck` a proposal.

## 5. Limits

- Per-builder rate limits (`get_rate_limits`): `attest` 30 at once, 5 a minute; `new_subject` (an attestation that opens a subject) 20 at once, 1 a minute; `profile` 5, 1 a minute.
- Text and blob caps (`get_limits`): repo 512, commit 128, recipe 2,000, environment 512, URLs 512, reasons 1,000, names 100, descriptions 1,000 characters; at most 16 embedded modules; hashes exactly 32 bytes.
- Storage (`get_config`): `max_subjects` (20,000), `max_attestations` stored (200,000), `max_builders_per_subject` (64; the DAO's known builders are always admitted), `max_versions_per_builder` (5), `max_steps` (50), `max_asset_entries` (20,000) and `max_asset_pages` (100).

## 6. Activity log (ICRC-3)

The block format, hashing, archives and verification are those of the shared library [src/icrc3](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/icrc3), described in [Sneed Lock's section 8](/api/sneed_lock#8-activity-log-icrc-3). Principals inside `tx` are `Blob`s, numbers are `Nat`, optional fields are omitted. Every `tx` has `caller`.

### Block types

| `btype` | Appended by | `tx` fields |
|---|---|---|
| `sneedatt_attest` | `attest` | `caller` (the builder), `id`, `subject` (map: `kind`, `governance`, `proposal_id`, `step` / `target`, `module_hash`), `artifact` (map: `kind` `wasm` or `asset_batch` and its fields), `source` (map: `repo`, `commit`, `recipe`, `environment`?), `verdict` (`match`/`mismatch`/`cannot_verify`), `reason`?, `log_url`? |
| `sneedatt_live_check` | the registry, after a step is final or a release is attested | `caller` (the registry), `subject`, `target`?, `result` (`live_match`/`live_mismatch`/`asset_tree`/`snapshot_restored`/`not_checked`), `reason`?, `tree_sha256`?, `identity_tree_sha256`?, `assets`?, `encodings`?, `before`?, `after`?, `snapshot_id`?, `compared_with`?, `module_hash`?, `installed_by`?, `installer_role`?, `installed_at`? (ns), `skipped`? (1) |
| `sneedatt_proposal_final` | the registry, when a proposal is done or no longer watched | `governance`, `proposal_id`, `outcome` (`done` or `stopped: <why>`), `steps` (array of maps: `step`, `target`?, `execution`, `module_hash`? / `evidence`? / `snapshot_id`?) |
| `sneedatt_known_builders` | `set_known_builders` | `caller` (the governance), `builders` (array of maps: `builder`, `note`?) |
| `sneedatt_builder_profile` | `set_builder_profile` | `caller`, `name`, `contact`?, `repo`?, `description`? |
| `sneedatt_governance_kind` | the registry (probe) or a controller | `governance`, `kind` (`sns`/`ohshii`/`unknown`), `how` |
| `sneedatt_config` | `admin_set_config`, `admin_set_icrc3_settings` | `caller`, `key`, `old`, `new` |

The text log (`get_log(start, length)`, public) explains every read, check, failure and back-off.

## 7. Administration

Controllers only, for maintenance: `admin_set_config` (pause polling, caps, intervals, the SNS-W id, archive controllers), `admin_set_rate_limit`, `admin_set_governance_kind`, `admin_recheck`, `admin_recheck_release`, `admin_run_now`, `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`. No method changes or removes an attestation. Hosting is meant to become neutral (several DAOs together, or no controller), see the design notes.

## 8. Integration checklist

- Show results per builder, highlighted by the DAO's known builders; never as one score.
- Show `proposed_disagree` and `proposal_agrees = false` prominently: a builder read another hash than the proposal has.
- Show `installed_by` with its role; an install not by the DAO's governance (or SNS root) deserves a warning.
- A `read_error` means the registry can't read that DAO's proposals (not admitted, or an older governance module); attestations are still recorded.
