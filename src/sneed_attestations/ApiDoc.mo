/// The text get_api_doc returns: a short guide for agents (full reference in public/api-docs/sneed_attestations.md).
module {
  public let text : Text = "# Sneed attestation registry (canister sneed_attestations)

An on-chain record of who rebuilt what for each step of a governance proposal (SNS governance, OhShii's ONS and SONS) or for a release (an install that is not a proposal), next to the registry's own check of the module that actually went live. Results are per builder, never merged into a score. Informational, not a gate.

- Production: a5rqn-baaaa-aaaac-bghua-cai (reserved, not deployed yet)
- Staging: xrnbc-uaaaa-aaaac-qhm7a-cai (reserved, not deployed yet)

## Units and encoding
- Hashes are 32-byte blobs (sha256). Proposal ids are `nat64`; steps are `nat` (0 for single-action proposals). Times are `int` nanoseconds, except timestamps a governance canister reports (SNS: seconds), kept as given.
- A subject is `variant { proposal : record { governance; proposal_id; step }; release : record { target; module_hash } }`.
- Updates return `variant { ok : ...; err : text }`; the GNSF validator returns `variant { Ok : text; Err : text }`.

## Authentication
- The caller of `attest` is the builder: the IC's signature on the call is the attestation. The anonymous principal is refused. Attestations are public, with your principal: nothing here is anonymous.
- `set_known_builders` takes effect only for the calling governance canister's own list (an SNS: by a generic nervous system function proposal; validator `validate_set_known_builders`). It changes highlighting only, never what is recorded.
- `admin_*` methods: canister controllers only, for maintenance (pause, caps, rechecks). No method alters or removes an attestation.

## Quick start (casual: one call)
1. Rebuild the proposal's wasm (or frontend batch) from the named commit.
2. `attest(record { subject = variant { proposal = record { governance = principal \"<gov>\"; proposal_id = <id>; step = 0 } }; artifact = variant { wasm = record { target; proposed_sha256; built_raw_sha256; built_gz_sha256 = opt <gz>; embedded = vec {}; upgrade_arg_sha256 = null } }; source = record { repo; commit; recipe; environment = null }; verdict = variant { match }; log_url = opt \"<url>\" })`.
3. Read the outcome: `get_proposal_status(governance, proposal_id)` (per step: builder counts, the registry's live check, who installed it) or `get_attestations(subject)`.

## Pro
- Frontend steps: `artifact = variant { asset_batch = record { target; batch_id; proposed_evidence; built_evidence; tree_sha256 } }`. tree_sha256 is defined by `get_tree_hash_format()`: sha256 over the sorted lines `key \\t content_encoding \\t sha256-hex` joined by `\\n`; the registry computes it from the asset canister's `list` after execution, also over the identity encodings only, and a builder agrees when either matches.
- Re-attest the same subject after fixing a recipe: your newest counts (`versions` shows how many), older ones are in `get_attestation_history(subject, builder)` and the ICRC-3 log.
- `set_builder_profile(record { name; contact; repo; description })`, `get_builder`, `list_builders(start, limit)`.
- Lists: `get_proposal_summaries(governance, vec { ids })` (at most 100), `list_proposals(start, limit)`, `get_release_status(target, module_hash)`, `get_known_builders(governance)`.

## Fees, transfers and irreversible actions
- No fees, no tokens. An attestation is permanent: it stays in the public ICRC-3 log even when a newer one replaces it.
- Limits: per-builder rate limits (`get_rate_limits`), text and blob caps (`get_limits`), at most `max_builders_per_subject` builders per subject (the DAO's known builders are always admitted), `max_versions_per_builder` versions kept in state (`get_config`).

## Asynchronous lifecycle and polling
- The registry watches only proposals with at least one attestation. A timer (every `tick_s`, 60 s) reads each one through its adapter (SNS `get_proposal`; ONS/SONS `get_proposal_upgrade_steps`, OhShii's planned interface): hourly while voting is open, every 5 minutes once adopted, until every step is final. At most 3 calls are in flight, and calls billed to a DAO stay within `calls_per_hour_per_dao`, with back-off when over (`get_call_budget`).
- Right after a step executes it reads the target with `canister_info` (the IC keeps only 20 changes): `live_match` / `live_mismatch`, and `installed_by` (governance, SNS root, another canister, or a user). A skipped step shows the earlier install, a failed one the governance's error, a snapshot restore the module before and after.
- A release is checked as soon as its first attestation arrives. Poll `get_proposal_status` (`watch`, `next_check_at`); a proposal the registry can't read shows `read_error` (\"cannot read proposal: ...\").

## Common pitfalls
- `proposal_agrees = opt false`: you read another hash or evidence than the registry read from the proposal. `proposed_disagree` on a step: builders read the proposal differently.
- A frontend step checked after a later release shows that release's tree. A proposal the governance refuses to let the registry read (not admitted) stops after a few attempts.
- Every query is free as a query; the ingress guard refuses queries sent as update calls.

## Activity log (ICRC-3)
- Every attestation, live check, finished proposal, known-builders list, builder profile and config change is a block of a certified ICRC-3 log (`icrc3_get_blocks`, `icrc3_log_status`, ...). Block types (`sneedatt_*`): https://app.sneeddao.com/api/sneed_attestations#block-types. The text log (`get_log`) explains every read, check and back-off.

Full reference: https://app.sneeddao.com/api-docs/sneed_attestations.md
All Sneed APIs for agents: https://app.sneeddao.com/llms.txt
";
};
