import Array "mo:base/Array";
import Error "mo:base/Error";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Time "mo:base/Time";

/// Stands in for an OhShii governance canister (ONS or a SONS) for sneed_attestations' tests, with
/// the read methods OhShii planned (PR #18 comment, spec/proposal_attestations.md v3). The step
/// record deliberately differs a little from the registry's expected types (src/sneed_attestations/
/// OhShiiTypes.mo): `index` is a nat32 (the registry expects opt nat and falls back to the position),
/// and there is an extra field, as a newer OhShii module might send.
///
/// It controls its targets and installs into them (`install`), and restores snapshots
/// (`snapshot_cycle`), so canister_info shows real changes made by "governance".
persistent actor class MockAttOhShii() = this {
  type Artifact = {
    #wasm : { module_hash : Blob; size_bytes : Nat64; chunked : Bool; upgrade_arg_sha256 : ?Blob };
    #asset_batch : { batch_id : Nat; evidence : Blob };
    #snapshot_restore : { snapshot_id : Blob };
  };
  type Execution = {
    #pending;
    #not_executed;
    #in_progress;
    #executed : Nat64;
    #skipped : Nat64;
    #failed : { at : Nat64; error : Text };
  };
  type Step = {
    index : Nat32;
    target : Principal;
    is_self : Bool;
    role : ?Text;
    artifact : Artifact;
    source : { git_repo_url : Text; git_commit_hash : Text; build_instructions : Text; truncated : Bool };
    execution : Execution;
    staged_at : Nat64; // a field the registry doesn't know
  };
  type Steps = { proposal_id : Nat64; kind : Text; status : Text; executed_at : ?Nat64; steps : [Step] };

  type InstallMode = { #install; #reinstall; #upgrade : ?{ skip_pre_upgrade : ?Bool } };
  type Mgmt = actor {
    install_code : shared ({ mode : InstallMode; canister_id : Principal; wasm_module : Blob; arg : Blob; sender_canister_version : ?Nat64 }) -> async ();
    stop_canister : shared { canister_id : Principal } -> async ();
    start_canister : shared { canister_id : Principal } -> async ();
    take_canister_snapshot : shared { canister_id : Principal; replace_snapshot : ?Blob } -> async { id : Blob; taken_at_timestamp : Nat64; total_size : Nat64 };
    load_canister_snapshot : shared { canister_id : Principal; snapshot_id : Blob; sender_canister_version : ?Nat64 } -> async ();
  };
  transient let mgmt : Mgmt = actor ("aaaaa-aa");

  var proposals : [(Nat64, ?Steps)] = [];
  var reads : Nat = 0;
  var missing_method : Bool = false;

  public func set_steps(id : Nat64, s : ?Steps) : async () {
    proposals := Array.append(Array.filter<(Nat64, ?Steps)>(proposals, func((i, _)) = i != id), [(id, s)]);
  };

  /// Pretend to be an older module without the method (the call is rejected).
  public func set_missing_method(m : Bool) : async () { missing_method := m };

  public func install(canister_id : Principal, wasm : Blob, mode : { #install; #reinstall; #upgrade }) : async ?Text {
    let m : InstallMode = switch mode { case (#install) #install; case (#reinstall) #reinstall; case (#upgrade) #upgrade(null) };
    try { await mgmt.install_code({ mode = m; canister_id; wasm_module = wasm; arg = ""; sender_canister_version = null }); null } catch (e) ?Error.message(e);
  };

  /// Takes a snapshot of the target, installs `other` over it, then restores the snapshot: the
  /// module goes back to what it was. Returns the snapshot id.
  public func snapshot_cycle(canister_id : Principal, other : Blob) : async { #ok : Blob; #err : Text } {
    try {
      await mgmt.stop_canister({ canister_id });
      let snap = await mgmt.take_canister_snapshot({ canister_id; replace_snapshot = null });
      await mgmt.start_canister({ canister_id });
      await mgmt.install_code({ mode = #upgrade(null); canister_id; wasm_module = other; arg = ""; sender_canister_version = null });
      await mgmt.stop_canister({ canister_id });
      await mgmt.load_canister_snapshot({ canister_id; snapshot_id = snap.id; sender_canister_version = null });
      await mgmt.start_canister({ canister_id });
      #ok(snap.id);
    } catch (e) #err(Error.message(e));
  };

  // ---- OhShii's planned reads (update methods here, to count them) ----

  public shared func get_proposal_upgrade_steps(id : Nat64) : async ?Steps {
    reads += 1;
    if (missing_method) throw Error.reject("Canister has no query method 'get_proposal_upgrade_steps'");
    switch (Array.find<(Nat64, ?Steps)>(proposals, func((i, _)) = i == id)) {
      case (?(_, s)) s;
      case null null;
    };
  };

  public query func list_upgrade_proposals(args : { after : ?Nat64; limit : Nat32 }) : async { items : [{ id : Nat64; kind : Text; status : Text; step_count : Nat; finished_steps : Nat }]; next : ?Nat64 } {
    let items = Array.mapFilter<(Nat64, ?Steps), { id : Nat64; kind : Text; status : Text; step_count : Nat; finished_steps : Nat }>(proposals, func((i, s)) {
      switch (s, args.after) {
        case (?x, ?a) if (i <= a) null else ?{ id = i; kind = x.kind; status = x.status; step_count = x.steps.size(); finished_steps = 0 };
        case (?x, null) ?{ id = i; kind = x.kind; status = x.status; step_count = x.steps.size(); finished_steps = 0 };
        case _ null;
      };
    });
    { items; next = null };
  };

  public query func calls() : async Nat { reads };
  public query func self_id() : async Principal { Principal.fromActor(this) };
  public query func now_ns() : async Nat64 { Nat64.fromIntWrap(Time.now()) };
};
