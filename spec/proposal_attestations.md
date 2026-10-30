# Proposal attestations (draft for discussion)

*Status: draft v3, 2026-10-30. A conversation between Sneed DAO and the OhShii DAO; nothing is built yet.
- v2 takes in OhShii's [review on PR #18](https://github.com/Snassy-icp/app_sneeddao/pull/18): release subjects,
  installer origin, a prompt live check, and caller admission. It also records the answers to the open questions.
- v3 takes in OhShii's planned read interface (`get_proposal_upgrade_steps`, `list_upgrade_proposals`). It adds
  `upgrade_arg_sha256`, the snapshot-restore and skipped steps, and the admission terms.*

## Why

Upgrade proposals ask voters to trust that the wasm (or the frontend batch) was built from the commit the summary
names. Today the check is a voter running a script, or one service posting its result
(the [Sneed Verifier](https://github.com/Snassy-icp/app_sneeddao/tree/main/tools/verifier)). Both are useful, but each result lives in
one place and depends on one party.

The idea: one on-chain registry where **independent builders** record what they rebuilt and what they got. A canister then
checks the one thing it can check itself, **the module that actually went live**. Any DAO frontend (Sneed Hub, OhShii,
the NNS dapp, anyone) reads the same results.

- **Builds stay off-chain.** Compilers don't run in canisters. Builders run them wherever they like and attest the result.
- **The canister checks what it can.** After execution it reads the live module hash itself. Its own checks need no permission
  and no trust in any builder.
- **More builders, more trust.** Results are shown per builder, never merged into one score the registry decides.
  Several independent builders agreeing is the signal.
- **Informational, not a gate.** The registry is a public record. No DAO's upgrade path depends on it being up (see open
  question 2).

## What a builder attests

A builder is any principal. An attestation is an update call from that principal, so the IC's signature on the call *is*
the attestation; there's no separate signing scheme. Builders may register a profile (name, contact, the repo with their
recipes) so frontends can show who they are.

```motoko
type Subject = {
  // a step of a governance proposal
  #proposal : {
    governance : Principal;    // SNS governance, ONS, a SONS, ...
    proposal_id : Nat64;
    step : Nat;                // 0 for single-action proposals; batches: one attestation per step, in the proposal's order
  };
  // an install that is not a proposal (e.g. a controller install while a DAO hands over), identified by what went live
  #release : { target : Principal; module_hash : Blob };
};
// A step that restores a canister snapshot changes the module, but proposes no hash, so there is nothing to rebuild.
// Builders don't attest it. The registry still runs its live check and shows "module changed by snapshot restore",
// with the hash before and after, so the step is never silently blank.

type Artifact = {
  #wasm : {
    target : Principal;               // the canister the step installs into
    proposed_sha256 : Blob;           // the hash in the proposal (or the release's module hash), as the builder read it
    built_raw_sha256 : Blob;
    built_gz_sha256 : ?Blob;          // gzip -9 -n, if the proposal ships gzipped (then the live module hash is the gz hash)
    embedded : [{ name : Text; sha256 : Blob }];   // nested modules, e.g. governance/ledger/index wasms inside a launcher
    upgrade_arg_sha256 : ?Blob;       // sha256 of the install/upgrade argument, when the proposal states one
  };
  #asset_batch : {
    target : Principal;               // the asset canister
    batch_id : Nat;
    proposed_evidence : Blob;
    built_evidence : ?Blob;           // null when it could no longer be computed (batch already committed)
    tree_sha256 : Blob;               // hash of the rebuilt asset tree, see below; checkable after execution
  };
};

type Source = {
  repo : Text;                 // URL
  commit : Text;               // full sha
  recipe : Text;               // the exact command, e.g. "tools/release-build.sh --commit <sha> sneed_sns_forum"
  environment : ?Text;         // e.g. the build image digest
};

type Verdict = { #match; #mismatch; #cannot_verify : Text };

type Attestation = {
  subject : Subject;
  artifact : Artifact;
  source : Source;
  verdict : Verdict;           // the builder's own comparison
  log_url : ?Text;             // build log, forum post, CI run ...
  builder : Principal;         // the caller, set by the canister
  at : Int;                    // set by the canister
};
```

A builder may attest again for the same subject (e.g. after fixing their recipe); the newest one counts, and the old
ones stay visible in the log.

## What the canister checks itself

1. **The live module, right after execution (wasm steps).**
   The canister watches the proposals that have attestations, and checks each executed step **promptly**. The IC
   guarantees only the 20 most recent changes in `canister_info`'s history, so a lazy check could find the history gone.
   The canister calls the management canister's `canister_info` for the target (any canister may call it for any
   canister), reads the current module hash and the recent changes, and records:
   - `#live_match` if the installed module hash equals the attested hash (gz when the proposal shipped gz, raw for a raw
     install);
   - `#live_mismatch` otherwise, or if a later install already replaced it (the history says which);
   - **who installed it**: the change's origin (`from_user` or `from_canister`, with the principal). An install that did
     not come from the DAO's governance canister is shown as such. Voters most want to see exactly that.

   - **A skipped step** (the target already ran that hash, so nothing was installed): `#live_match` if the hash
     matches, with `installed_by` taken from the earlier install that put it there, and marked as skipped. The
     installer is not the proposal.
   - **A failed step**: no live check, and the governance canister's error is shown.

   For `#release` subjects the same check runs as soon as the attestation arrives: is that module live (or in the
   recent history) on the target, and who installed it.
2. **The live asset tree, after execution (frontend steps).**
   Batch evidence can't be recomputed after commit. The asset canister's `list` does return every asset's key,
   encodings and sha256, though. The registry computes `tree_sha256` from it and compares that with the builders'
   value. The tree hash is sha256 over the sorted lines `key \t content_encoding \t sha256`; the exact format is still
   to be checked against `list`'s output.
3. **Consistency across builders.**
   The canister flags subjects where builders disagree on `proposed_sha256` or `proposed_evidence`, i.e. read the
   proposal differently, separately from builders disagreeing on what they built.

**Reading proposals: one adapter per governance kind.**
- **SNS governance:** `get_proposal` strips the wasm, but renders its hash in the text.
- **ONS and SONS:** one adapter covers both, since every OhShii governance canister has the same two reads
  (planned):
  - `get_proposal_upgrade_steps : (nat64) -> (opt ProposalUpgradeSteps) query` returns the steps in proposal order,
    with each step's `index` and `target`, `is_self` (the governance canister upgrading itself, always last), an
    optional `role`, and three more fields:
    - the **artifact**: `wasm { module_hash; size_bytes; chunked; upgrade_arg_sha256 }`,
      `asset_batch { batch_id; evidence }`, or `snapshot_restore { snapshot_id }`;
    - the **source**: `git_repo_url`, `git_commit_hash`, `build_instructions`, each capped at 8 KiB, plus a
      `truncated` flag;
    - the **execution**: `pending`, `not_executed`, `in_progress`, `executed : nat64`, `skipped : nat64` or
      `failed { at; error }`.

    It also returns the proposal's `kind`, `status` and `executed_at`, and `null` for proposals that aren't upgrades.
  - `list_upgrade_proposals : (record { after : opt nat64; limit : nat32 }) -> (record { items; next : opt nat64 })
    query` returns compact summaries: id, kind, status, step count and finished steps. Keep paging while `next` is
    set, even past an empty page.
  - New fields and variants arrive only as `opt`. A canister still on an older module has neither method, so the
    adapter falls back to `get_proposal` (ONS) or `get_proposal_by_id` (SONS).
  - These map one to one onto `Subject` (`#proposal { governance; proposal_id; step = index }`) and `Artifact`:
    - `module_hash` becomes `proposed_sha256`;
    - `upgrade_arg_sha256` is copied as it is;
    - a `truncated` source is shown as truncated; the registry never guesses the rest.

## What frontends read

```motoko
get_attestations : query (Subject) -> async [Attestation];      // newest per builder, plus older ones on request
get_proposal_status : query (governance : Principal, proposal_id : Nat64) -> async {
  steps : [{ step : Nat; builders_match : Nat; builders_mismatch : Nat; builders_cannot : Nat;
             live : ?{ #live_match; #live_mismatch : Text }; installed_by : ?Principal }];
};
get_builder : query (Principal) -> async ?BuilderProfile;
```

Sneed Hub would show it on the proposal page and in proposal lists: "✅ 3 builders reproduced · ✅ live module matches",
each builder clickable. **Which builders a DAO trusts is the DAO's choice:** a per-DAO list of known builders, set by that
DAO's governance, decides only how a frontend highlights them, never what gets recorded.

## Calls to other DAOs' canisters

Some DAOs, OhShii among them, refuse replicated queries (update calls, or calls from other canisters) from callers
that aren't admitted: such a call is billed to the callee. Sneed's canisters do the same through their ingress guard.
Builders querying from outside aren't affected. For the registry to read proposals on-chain, each such DAO admits its
canister id(s). For that, the registry publishes:

- its canister ids (mainnet and staging);
- the methods it calls and a call budget per DAO. A rough estimate: one proposal read per attested proposal while it is
  open (at most once an hour), one status read per step until it has executed, then one `canister_info` per step, which
  goes to the management canister and is not billed to the DAO. Plus one fleet listing a day.

**OhShii's admission terms (planned).** Each OhShii governance canister, and `dao_storage`, admits a small, capped
set of external readers:
- An admitted reader may call only the attestation reads: the steps, the list, the deployed-source record and a paged
  fleet list.
- During the handover, the list is changed by direct install. After it, a change takes a vote: on ONS a critical
  proposal, on each SONS that DAO's own vote. So removing a reader also takes days.
- Replicated reads are billed to OhShii. A reader far over its published budget can be removed, so the registry
  keeps to its budget in code: per-DAO call caps, with a back-off when over.
- The registry must send the principals it calls from, mainnet and staging. A placeholder holds the slot until
  then. **So the registry canister ids are needed early**, before the code is ready.

What OhShii offered on its side, while its handover lasts and changes can still ship without a vote:
1. **Admit the registry** on ONS, SONS and `dao_storage`. → Yes, needed.
2. **One common read method on ONS and SONS:** per proposal, the steps in this spec's terms: index, target, wasm or
   asset, the proposed hash or `batch_id` + evidence, git repo, commit and build instructions, and each step's
   execution status. → Yes. It is the most useful one: one adapter instead of two, and the shape maps straight onto
   `Subject` and `Artifact`.
3. **A deployed-source record on SONS**, like ONS's `get_deployed_source`. → Useful for "what's running vs. what's
   proposed" on the proposal card. Not required.
4. **Listing the SONS fleet in one call.** → Useful: it lets the registry find every SONS governance to watch. Not
   required.

## Abuse and cost

- **Open but bounded.** Anyone may attest. Per-builder rate limits and size caps apply, with an ingress guard on all
  methods. Optionally, a small fee per attestation later.
- **Spam can't fake trust.** Results are per builder, and frontends highlight the builders a DAO lists.
- **Polling and cycles.** The canister polls only proposals that have attestations, using timers rather than
  heartbeats, and at most a few calls in flight at a time.
- **Public log.** Every attestation and live check is appended to an ICRC-3 style log, so the history is
  public and can be checked independently.

## Fit with what exists

- **Sneed Verifier.** Already rebuilds every Sneed upgrade and frontend proposal and posts in the proposal's forum thread.
  It would also attest here. Raw/gzip and asset evidence already work.
- **OhShii.**
  - `verify-proposal.sh` (pre-vote) and `verify-hash.sh` (post-deploy) already produce these facts. An OhShii builder
    attests them.
  - ONS and SONS already check the staged hash and exports before install, and the module hash after it. The registry
    doesn't replace those checks. It is the independent public record next to them.
  - Batch steps become one attestation each, and the launcher's embedded modules go in `embedded`. A child canister
    keeps reporting its embedded `.wasm.gz` hash until it is upgraded, so `canister_info` on the children works.
  - Third-party builds of OhShii modules wait until its repositories are public.
  - A deployed-source record exists only for upgrades executed by a proposal, not for direct installs.
  - OhShii doesn't check asset steps after commit: `executed` means the commit was accepted. The registry's tree hash
    is that check.
- **Running others' recipes.** The Sneed Verifier could also run a project's own recipe (e.g. `verify-proposal.sh`),
  but only on a separate, empty machine, never next to any DAO keys. Builds run rootless in a container with no secrets
  and no network for the compile step.

## Open questions, with the answers so far

1. **SONS governance.** *Answered:* one interface for the whole fleet, twin types of ONS, but different method names
   today. Each SONS upgrades on its own, so the adapter tolerates `opt` fields. The common read method (offer 2 above)
   makes it one adapter.
2. **A gate in governance.** *Agreed:* informational at first. A gate would put an external canister on every upgrade's
   path, emergency fixes included, so a registry outage or a captured builder list would stall the DAO. If an opt-in gate
   still looks right after a trial, its hook is easier to add before OhShii's handover ends than after.
3. **Hosting.** *Agreed direction:* neutral. A canister no single DAO controls (several DAOs together, or no
   controller), with the public log. Open: which of the two, and how its upgrades are approved.
4. **Nested modules.** *Answered:* worth it. OhShii's launcher embeds four modules: SONS governance, DFINITY's ICRC
   ledger and index (pinned to DFINITY's release hashes), and a token migrator.
5. **Naming.** No preference on either side yet; placeholders stay.
6. **Registry ids, early.** OhShii needs the registry's principals to fill its reader slot. So we reserve the
   canisters (mainnet + staging) before the code exists: empty canisters, with interim controllers until the neutral
   hosting of question 3 is settled. Their ids don't change when control moves later.
   *Reserved 2026-10-30:* mainnet `a5rqn-baaaa-aaaac-bghua-cai` (controllers SNS root fp274 + d7zib), staging
   `xrnbc-uaaaa-aaaac-qhm7a-cai`. Plan for neutral control: sneed_guardian_multidao as sole controller (DAO-approved
   hashes only, a veto council per participating DAO).

## Phases (suggested)

1. Agree on the attestation format (this doc).
2. Build the registry canister, plus the proposal-page badge in Sneed Hub; the Sneed Verifier attests Sneed proposals.
3. OhShii admits the registry and ships the common read method. OhShii builders attest ONS/SONS proposals (and
   `#release` installs during its handover).
4. Open it to any DAO and builder; settle the neutral hosting; optionally, an opt-in gate.
