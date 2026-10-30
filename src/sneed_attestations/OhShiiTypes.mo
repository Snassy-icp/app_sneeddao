import Array "mo:base/Array";
import Nat64 "mo:base/Nat64";
import Text "mo:base/Text";
import T "Types";

/// PLANNED INTERFACE: VERIFY WHEN OHSHII SHIPS.
///
/// OhShii's planned read methods on ONS and every SONS governance canister, from their comment on
/// PR #18 and spec/proposal_attestations.md v3 ("Reading proposals"). The exact Candid isn't
/// published yet, so these are our expected types:
/// - only what the adapter needs is required (the step list, each step's target, the wasm
///   `module_hash`, `batch_id` + `evidence`, the failure error);
/// - every other field is `opt`, so a missing field reads as null, and a field of another type
///   (say `nat32` where we expect `nat`) also reads as null (Candid's opt rule) instead of failing
///   the whole reply;
/// - the variants (artifact, execution) sit inside `opt` for the same reason: a tag added later
///   reads as null (shown as "unknown") instead of failing the reply.
/// When OhShii publishes its .did: compare, adjust here, and keep the essentials required.
module {

  public type Artifact = {
    #wasm : { module_hash : Blob; size_bytes : ?Nat64; chunked : ?Bool; upgrade_arg_sha256 : ?Blob };
    #asset_batch : { batch_id : Nat; evidence : Blob };
    #snapshot_restore : { snapshot_id : ?Blob };
  };

  /// Each text capped at 8 KiB by OhShii, with `truncated` set when one was cut.
  public type Source = {
    git_repo_url : ?Text;
    git_commit_hash : ?Text;
    build_instructions : ?Text;
    truncated : ?Bool;
  };

  public type Execution = {
    #pending;
    #not_executed;
    #in_progress;
    #executed : Nat64;
    #skipped : Nat64;
    #failed : { at : Nat64; error : Text };
  };

  public type Step = {
    index : ?Nat; // null (or another type): the step's position in `steps` is used
    target : Principal;
    is_self : ?Bool; // the governance canister upgrading itself, always the last step
    role : ?Text;
    artifact : ?Artifact;
    source : ?Source;
    execution : ?Execution;
  };

  public type ProposalUpgradeSteps = {
    proposal_id : ?Nat64;
    kind : ?Text; // the proposal kind (type unknown yet: a variant reads as null)
    status : ?Text; // the proposal status (same)
    executed_at : ?Nat64;
    steps : [Step];
  };

  public type ListArgs = { after : ?Nat64; limit : Nat32 };
  public type ProposalListItem = {
    id : Nat64;
    kind : ?Text;
    status : ?Text;
    step_count : ?Nat;
    finished_steps : ?Nat;
  };
  public type ListResult = { items : [ProposalListItem]; next : ?Nat64 };

  /// The reads, as the registry calls them (both are queries, called as replicated calls).
  public type Governance = actor {
    get_proposal_upgrade_steps : shared query Nat64 -> async ?ProposalUpgradeSteps;
    list_upgrade_proposals : shared query ListArgs -> async ListResult; // not called yet (fleet listing later)
  };

  // ---------------------------------------------------------------------------------------------
  // Mapping onto the registry's terms (spec: Subject step = index, module_hash = proposed_sha256)
  // ---------------------------------------------------------------------------------------------

  func artifactOf(a : ?Artifact) : T.ProposedArtifact = switch a {
    case (?#wasm(w)) #wasm({ module_hash = ?w.module_hash; upgrade_arg_sha256 = w.upgrade_arg_sha256; chunked = w.chunked; size_bytes = switch (w.size_bytes) { case (?n) ?Nat64.toNat(n); case null null } });
    case (?#asset_batch(b)) #asset_batch({ batch_id = ?b.batch_id; evidence = ?b.evidence });
    case (?#snapshot_restore(s)) #snapshot_restore({ snapshot_id = s.snapshot_id });
    case null #unknown("the governance canister reported no artifact this registry can read");
  };

  func executionOf(e : ?Execution) : T.Execution = switch e {
    case (?#pending) #pending;
    case (?#not_executed) #not_executed;
    case (?#in_progress) #in_progress;
    case (?#executed(t)) #executed(t);
    case (?#skipped(t)) #skipped(t);
    case (?#failed(f)) #failed(f);
    case null #unknown;
  };

  func clip(t : ?Text, max : Nat) : (?Text, Bool) = switch t {
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
          ?{ repo; commit; instructions; truncated = t1 or t2 or t3 or (switch (src.truncated) { case (?b) b; case null false }) };
        };
        case null null;
      };
      {
        index = switch (s.index) { case (?x) x; case null i };
        target = ?s.target;
        is_self = switch (s.is_self) { case (?b) b; case null false };
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
