# Proposal attestations (draft for discussion)

*Status: draft, 2026-10-29. Written for a conversation between Sneed DAO and OHSHII Labs; nothing is built yet.*

## Why

Upgrade proposals ask voters to trust that the wasm (or the frontend batch) was built from the commit the summary
names. Today the check is a voter running a script, or one service posting its result
(the [Sneed Verifier](https://github.com/Snassy-icp/app_sneeddao/tree/main/tools/verifier)). Both are useful, but each result lives in
one place and depends on one party.

The idea: one on-chain registry where **independent builders** record what they rebuilt and what they got. A canister then
checks the one thing it can check itself, **the module that actually went live**. Any DAO frontend (Sneed Hub, OHSHII,
the NNS dapp, anyone) reads the same results.

- **Builds stay off-chain.** Compilers don't run in canisters. Builders run them wherever they like and attest the result.
- **The canister checks what it can.** After execution it reads the live module hash itself. Its own checks need no permission
  and no trust in any builder.
- **More builders, more trust.** Results are shown per builder, never merged into one score the registry decides.
  Several independent builders agreeing is the signal.

## What a builder attests

A builder is any principal. An attestation is an update call from that principal, so the IC's signature on the call *is*
the attestation; there's no separate signing scheme. Builders may register a profile (name, contact, the repo with their
recipes) so frontends can show who they are.

```motoko
type Subject = {
  governance : Principal;      // SNS governance, a SONS governance canister, ...
  proposal_id : Nat64;
  step : Nat;                  // 0 for single-action proposals; batch proposals: one attestation per step
};

type Artifact = {
  #wasm : {
    target : Principal;               // the canister the step installs into
    proposed_sha256 : Blob;           // the hash in the proposal, as the builder read it
    built_raw_sha256 : Blob;
    built_gz_sha256 : ?Blob;          // gzip -n -9 (or the project's own compression), if the proposal ships gzipped
    embedded : [{ name : Text; sha256 : Blob }];   // nested modules, e.g. a ledger/governance wasm inside a factory
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

1. **The live module, after execution (wasm steps).**
   The canister watches the proposals that have attestations. Once a proposal has executed, it calls the management
   canister's `canister_info` for the target. Any canister may call this for any canister. It reads the
   current module hash and the recent code deployments, then records:
   - `#live_match` if the module hash that was installed equals the attested hash (raw or gz, whichever was proposed);
   - `#live_mismatch` otherwise, or if a later install already replaced it (the deployment history says which).

   This is the check nobody has to trust anyone for: what is running now is what the builders rebuilt.
2. **The live asset tree, after execution (frontend steps).**
   Batch evidence can't be recomputed after commit. The asset canister's `list` does return every asset's key, encodings and
   sha256, though. The registry computes `tree_sha256` from it and compares that with the builders' value. The
   tree hash is sha256 over the sorted lines `key \t content_encoding \t sha256`.
3. **Consistency across builders.**
   The canister flags subjects where builders disagree on `proposed_sha256` or `proposed_evidence`, i.e. read the
   proposal differently, separately from builders disagreeing on what they built.

Reading the proposal itself (the hash it carries) depends on the governance type. SNS governance's `get_proposal` strips the wasm
but renders its hash in text; SONS has its own interface. That's one adapter per governance kind, and part of the
discussion below.

## What frontends read

```motoko
get_attestations : query (Subject) -> async [Attestation];      // newest per builder, plus older ones on request
get_proposal_status : query (governance : Principal, proposal_id : Nat64) -> async {
  steps : [{ step : Nat; builders_match : Nat; builders_mismatch : Nat; builders_cannot : Nat;
             live : ?{ #live_match; #live_mismatch : Text } }];
};
get_builder : query (Principal) -> async ?BuilderProfile;
```

Sneed Hub would show it on the proposal page and in proposal lists: "✅ 3 builders reproduced · ✅ live module matches",
each builder clickable. **Which builders a DAO trusts is the DAO's choice:** a per-DAO list of known builders, set by that
DAO's governance, decides only how a frontend highlights them, never what gets recorded.

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
- **OHSHII.** `verify-proposal.sh` (pre-vote) and `verify-hash.sh` (post-deploy) already produce exactly these facts. An
  OHSHII builder attests them. Batch proposals with mixed code and asset steps become one attestation per step, and the
  embedded modules go in `embedded`. Your own on-chain checks (staged hash before install, module hash after) stay
  where they are; this registry is the shared, public record of them.
- **Running others' recipes.** The Sneed Verifier could also run a project's own recipe (e.g. `verify-proposal.sh`),
  but only on a separate, empty machine, never next to any DAO keys. Builds run rootless in a container with no secrets
  and no network for the compile step.

## Open questions

1. **SONS governance.** How do we list proposals, read the proposed hashes per step, and see execution status?
   Is there one interface for the whole SONS fleet?
2. **A gate in governance.** Should a governance canister be able to *require* N attestations from its listed builders
   before it executes an install? Your staged-hash check suggests a natural hook. That would make it enforcement, not
   just information.
3. **Hosting.** One registry for all DAOs (simplest for frontends) or one per ecosystem? Who controls it: an SNS,
   a blackholed canister, or several DAOs together?
4. **Nested modules.** Is the list of embedded hashes enough, or should the registry also record which embedded modules
   each child canister later runs? With `canister_info` on the children, a factory's launched DAOs could be checked too.
5. **Naming.** The registry, the API names and the tree-hash format are all placeholders.

## Phases (suggested)

1. Agree on the attestation format (this doc).
2. Build the registry canister, plus the proposal-page badge in Sneed Hub; the Sneed Verifier attests Sneed proposals.
3. OHSHII builders attest SONS proposals; add the SONS adapter.
4. Open it to any DAO and builder; optionally, the governance gate.
