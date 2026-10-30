import Array "mo:base/Array";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Text "mo:base/Text";
import T "Types";

/// OhShii's read interface on ONS and every SONS governance canister, and the fleet list on
/// `dao_storage`: exactly the Candid OhShii published on PR #20 (2026-10-30, "match the canisters'
/// .did field for field"). Live with OhShii's next upgrade of those canisters; then also in their
/// `candid:service` metadata. OhShii keeps changes additive (new methods, new `opt` fields at the
/// end of a record, new variant arms only on variants reached through `opt`), so these types keep
/// decoding later replies: unknown fields are ignored, and an unknown artifact or execution arm
/// reads as null (shown as "unknown").
module {
  public type Artifact = {
    #wasm : { module_hash : Blob; size_bytes : Nat64; chunked : Bool; upgrade_arg_sha256 : ?Blob };
    #asset_batch : { batch_id : Nat; evidence : Blob };
    #snapshot_restore : { snapshot_id : Blob };
  };
  /// Each text capped at 8 KiB by OhShii, with `truncated` set when one was cut. A SONS index-canister
  /// upgrade carries no source text (empty texts, `size_bytes` 0).
  public type Source = {
    git_repo_url : Text;
    git_commit_hash : Text;
    build_instructions : Text;
    truncated : Bool;
  };
  public type Execution = {
    #pending;
    #not_executed;
    #in_progress;
    #executed : Nat64;
    #skipped : Nat64;
    #failed : { at : ?Nat64; error : Text };
  };
  public type Step = {
    index : Nat32;
    target : Principal;
    is_self : Bool; // the governance canister upgrading itself, always the last step
    role : ?Text;
    artifact : ?Artifact;
    source : ?Source;
    execution : ?Execution;
  };
  public type ProposalUpgradeSteps = {
    governance : Principal;
    proposal_id : Nat64;
    kind : Text;
    status : Text;
    executed_at : ?Nat64;
    steps : [Step];
  };
  public type ListArgs = { after : ?Nat64; limit : Nat32 };
  public type ProposalListItem = {
    proposal_id : Nat64;
    kind : Text;
    status : Text;
    step_count : Nat32;
    finished_steps : Nat32;
    executed_at : ?Nat64;
  };
  public type ListResult = { items : [ProposalListItem]; next : ?Nat64 };
  public type DeployedSource = {
    git_repo_url : Text;
    git_commit_hash : Text;
    proposal_id : Nat64;
    wasm_module_hash : Blob;
    recorded_at : Nat64;
  };

  /// The reads, as the registry calls them (queries, called as replicated calls; OhShii admits only
  /// the registry's two principals, and only on these reads).
  public type Governance = actor {
    get_proposal_upgrade_steps : shared query Nat64 -> async ?ProposalUpgradeSteps;
    list_upgrade_proposals : shared query ListArgs -> async ListResult; // not called yet
    get_deployed_source : shared query Principal -> async ?DeployedSource; // not called yet
    list_deployed_sources : shared query () -> async [(Principal, DeployedSource)]; // not called yet
  };
  public type GovernanceCanisterEntry = { governance : Principal; campaign_id : Text; state : Text };
  public type GovernanceCanisterPage = { items : [GovernanceCanisterEntry]; next : ?Text };
  /// `dao_storage`: the SONS fleet, paged by campaign id (limit clamped to 1..200; keep paging
  /// while `next` is set). Not called yet.
  public type DaoStorage = actor {
    list_governance_canisters : shared query (?Text, Nat32) -> async GovernanceCanisterPage;
  };

  // ---------------------------------------------------------------------------------------------
  // Mapping onto the registry's terms (spec: Subject step = index, module_hash = proposed_sha256)
  // ---------------------------------------------------------------------------------------------

  func artifactOf(a : ?Artifact) : T.ProposedArtifact = switch a {
    case (?#wasm(w)) #wasm({ module_hash = ?w.module_hash; upgrade_arg_sha256 = w.upgrade_arg_sha256; chunked = ?w.chunked; size_bytes = ?Nat64.toNat(w.size_bytes) });
    case (?#asset_batch(b)) #asset_batch({ batch_id = ?b.batch_id; evidence = ?b.evidence });
    case (?#snapshot_restore(s)) #snapshot_restore({ snapshot_id = ?s.snapshot_id });
    case null #unknown("the governance canister reported no artifact this registry can read");
  };

  func executionOf(e : ?Execution) : T.Execution = switch e {
    case (?#pending) #pending;
    case (?#not_executed) #not_executed;
    case (?#in_progress) #in_progress;
    case (?#executed(t)) #executed(t);
    case (?#skipped(t)) #skipped(t);
    case (?#failed(f)) #failed({ at = switch (f.at) { case (?t) t; case null 0 }; error = f.error }); // 0: OhShii gave no time
    case null #unknown;
  };

  func clip(t : Text, max : Nat) : (?Text, Bool) = switch (if (t == "") null else ?t) {
    case (?s) if (s.size() > max) {
      var out = "";
      var n = 0;
      label c for (ch in s.chars()) { if (n >= max) break c; out #= Text.fromChar(ch); n += 1 };
      (?out, true);
    } else (?s, false);
    case null (null, false);
  };

  /// The steps in the registry's terms. `maxText` caps each source text kept (OhShii already caps
  /// them at 8 KiB; the registry keeps at most this much and marks the source truncated).
  public func steps(p : ProposalUpgradeSteps, maxSteps : Nat, maxText : Nat) : [T.ProposalStep] {
    let n = if (p.steps.size() > maxSteps) maxSteps else p.steps.size();
    Array.tabulate<T.ProposalStep>(n, func(i) {
      let s = p.steps[i];
      let source : ?T.ProposedSource = switch (s.source) {
        case (?src) {
          let (repo, t1) = clip(src.git_repo_url, maxText);
          let (commit, t2) = clip(src.git_commit_hash, maxText);
          let (instructions, t3) = clip(src.build_instructions, maxText);
          ?{ repo; commit; instructions; truncated = t1 or t2 or t3 or src.truncated };
        };
        case null null;
      };
      {
        index = Nat32.toNat(s.index);
        target = ?s.target;
        is_self = s.is_self;
        role = s.role;
        artifact = artifactOf(s.artifact);
        source;
        execution = executionOf(s.execution);
      };
    });
  };

  /// "open" / "executing" / "final": what the registry polls for. Final when every step is.
  public func overall(steps : [T.ProposalStep]) : { #open; #executing; #final } {
    var anyPending = false;
    var anyRunning = false;
    for (s in steps.vals()) switch (s.execution) {
      case (#pending or #unknown) anyPending := true;
      case (#in_progress) anyRunning := true;
      case _ {};
    };
    if (anyRunning) #executing else if (anyPending) {
      // some steps final and some pending: the proposal is executing
      if (Array.find<T.ProposalStep>(steps, func(s) = switch (s.execution) { case (#pending or #unknown) false; case _ true }) != null) #executing else #open;
    } else #final;
  };
};
