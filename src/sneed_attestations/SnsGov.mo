import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import Sha256 "mo:sha2/Sha256";
import T "Types";

/// The SNS governance adapter: reads one proposal with `get_proposal` and maps it onto the
/// registry's steps (an SNS proposal has one step, index 0).
///
/// - UpgradeSnsControlledCanister: `get_proposal` strips the wasm, but keeps the action's
///   `canister_id` and renders the wasm hash in `payload_text_rendering` ("... SHA256 `<hex>`");
///   a chunked upgrade carries `wasm_module_hash` itself. The upgrade argument (when present) is
///   hashed here.
/// - ExecuteGenericNervousSystemFunction whose function targets `commit_proposed_batch` (a
///   frontend release like Sneed's GNSF 7000): the payload is the Candid record
///   `{ batch_id : nat; evidence : blob }`, decoded here; the target is the function's
///   target_canister_id (from list_nervous_system_functions).
/// - Anything else is not an upgrade proposal.
///
/// The types are reduced to the fields read here. The action sits in `opt`, so actions this
/// registry doesn't know (Motion, ...) read as null instead of failing the reply.
module {

  public type ProposalId = { id : Nat64 };
  public type GovernanceError = { error_message : Text; error_type : Int32 };
  public type ChunkedWasm = { wasm_module_hash : Blob; store_canister_id : ?Principal; chunk_hashes_list : [Blob] };
  public type Upgrade = {
    canister_id : ?Principal;
    new_canister_wasm : Blob;
    canister_upgrade_arg : ?Blob;
    mode : ?Int32;
    chunked_canister_wasm : ?ChunkedWasm;
  };
  public type Gnsf = { function_id : Nat64; payload : Blob };
  public type Action = {
    #UpgradeSnsControlledCanister : Upgrade;
    #ExecuteGenericNervousSystemFunction : Gnsf;
  };
  public type Proposal = { title : Text; summary : Text; url : Text; action : ?Action };
  public type ProposalData = {
    id : ?ProposalId;
    action : Nat64;
    proposal : ?Proposal;
    payload_text_rendering : ?Text;
    decided_timestamp_seconds : Nat64;
    executed_timestamp_seconds : Nat64;
    failed_timestamp_seconds : Nat64;
    failure_reason : ?GovernanceError;
    proposal_creation_timestamp_seconds : Nat64;
    initial_voting_period_seconds : Nat64;
    wait_for_quiet_state : ?{ current_deadline_timestamp_seconds : Nat64 };
  };
  public type GetProposalResponse = { result : ?{ #Error : GovernanceError; #Proposal : ProposalData } };

  public type GenericFunction = {
    target_canister_id : ?Principal;
    target_method_name : ?Text;
    validator_canister_id : ?Principal;
    validator_method_name : ?Text;
  };
  public type FunctionType = { #NativeNervousSystemFunction : {}; #GenericNervousSystemFunction : GenericFunction };
  public type NervousSystemFunction = { id : Nat64; name : Text; function_type : ?FunctionType };
  public type ListFunctionsResponse = { functions : [NervousSystemFunction]; reserved_ids : [Nat64] };

  public type Governance = actor {
    get_proposal : shared query ({ proposal_id : ?ProposalId }) -> async GetProposalResponse;
    list_nervous_system_functions : shared query () -> async ListFunctionsResponse;
  };

  public type SnsW = actor {
    list_deployed_snses : shared query ({}) -> async { instances : [{ root_canister_id : ?Principal; governance_canister_id : ?Principal }] };
  };

  /// A generic function's target (what the adapter needs of list_nervous_system_functions).
  public type FnTarget = { id : Nat64; target : ?Principal; method : ?Text };

  public func functionTargets(r : ListFunctionsResponse) : [FnTarget] {
    Array.map<NervousSystemFunction, FnTarget>(r.functions, func(f) {
      switch (f.function_type) {
        case (?#GenericNervousSystemFunction(g)) ({ id = f.id; target = g.target_canister_id; method = g.target_method_name });
        case _ ({ id = f.id; target = null; method = null });
      };
    });
  };

  public let ACTION_UPGRADE : Nat64 = 3; // UpgradeSnsControlledCanister
  public let FRONTEND_METHOD = "commit_proposed_batch";
  public let DECIDED_NOT_EXECUTED_S : Nat64 = 3_600; // decided an hour ago, neither executed nor failed: rejected

  func hexVal(c : Char) : ?Nat {
    let n = Char.toNat32(c);
    if (n >= 48 and n <= 57) ?Nat32ToNat(n - 48) else if (n >= 97 and n <= 102) ?Nat32ToNat(n - 87) else null;
  };
  func Nat32ToNat(n : Nat32) : Nat = Nat64.toNat(Nat64.fromNat32(n));

  /// 64 lower-case hex characters as 32 bytes.
  public func hexToBlob(h : Text) : ?Blob {
    let cs = Iter.toArray(h.chars());
    if (cs.size() != 64) return null;
    let out = Array.init<Nat8>(32, 0);
    var i = 0;
    while (i < 32) {
      switch (hexVal(cs[2 * i]), hexVal(cs[2 * i + 1])) {
        case (?a, ?b) out[i] := Nat8.fromNat(a * 16 + b);
        case _ return null;
      };
      i += 1;
    };
    ?Blob.fromArray(Array.freeze(out));
  };

  /// The first "SHA256" in the rendering followed (after spaces, colons and backticks) by 64 hex
  /// characters: SNS governance renders an upgrade as "... module with N bytes and SHA256 `<hex>`".
  /// Only the first 20,000 characters are searched.
  public func wasmHashFromRendering(rendering : Text) : ?Blob {
    let cs = Iter.toArray(Text.toLowercase(rendering).chars());
    let n = Nat.min(cs.size(), 20_000);
    let key = Iter.toArray("sha256".chars());
    var i = 0;
    while (i + 6 <= n) {
      var hit = true;
      var k = 0;
      while (hit and k < 6) { if (cs[i + k] != key[k]) hit := false; k += 1 };
      if (hit) {
        var j = i + 6;
        while (j < n and (cs[j] == ' ' or cs[j] == '`' or cs[j] == ':')) j += 1;
        if (j + 64 <= n) {
          var hex = "";
          var m = 0;
          while (m < 64) { hex #= Char.toText(cs[j + m]); m += 1 };
          switch (hexToBlob(hex)) {
            case (?b) if (j + 64 == n or hexVal(cs[j + 64]) == null) return ?b;
            case null {};
          };
        };
      };
      i += 1;
    };
    null;
  };

  public type Read = {
    steps : [T.ProposalStep]; // empty: not an upgrade proposal
    proposal_kind : ?Text;
    status : Text;
    executed_at : ?Nat64;
    deadline_s : ?Nat64;
    needs_functions : ?Nat64; // a GNSF proposal whose function's target this adapter doesn't know yet
  };

  func execution(p : ProposalData, nowS : Nat64) : (T.Execution, Text) {
    if (p.executed_timestamp_seconds > 0) return (#executed(p.executed_timestamp_seconds), "executed");
    if (p.failed_timestamp_seconds > 0) {
      let e = switch (p.failure_reason) { case (?f) f.error_message; case null "failed" };
      return (#failed({ at = p.failed_timestamp_seconds; error = e }), "failed");
    };
    if (p.decided_timestamp_seconds == 0) return (#pending, "open");
    if (nowS > p.decided_timestamp_seconds + DECIDED_NOT_EXECUTED_S) return (#not_executed, "rejected");
    (#in_progress, "adopted");
  };

  /// Maps a proposal onto steps. `fns`: the governance's generic functions, when known.
  public func read(p : ProposalData, fns : ?[FnTarget], nowS : Nat64) : Read {
    let (exec, status) = execution(p, nowS);
    let deadline_s = ?(switch (p.wait_for_quiet_state) {
      case (?w) w.current_deadline_timestamp_seconds;
      case null p.proposal_creation_timestamp_seconds + p.initial_voting_period_seconds;
    });
    let executed_at = if (p.executed_timestamp_seconds > 0) ?p.executed_timestamp_seconds else null;
    let action = switch (p.proposal) { case (?pr) pr.action; case null null };
    let none = func(kind : Text) : Read = { steps = []; proposal_kind = ?kind; status; executed_at; deadline_s; needs_functions = null };
    switch action {
      case (?#UpgradeSnsControlledCanister(u)) {
        let hash = switch (u.chunked_canister_wasm) {
          case (?c) ?c.wasm_module_hash;
          case null switch (p.payload_text_rendering) { case (?r) wasmHashFromRendering(r); case null null };
        };
        let argHash = switch (u.canister_upgrade_arg) { case (?a) ?Sha256.fromBlob(#sha256, a); case null null };
        let step : T.ProposalStep = {
          index = 0;
          target = u.canister_id;
          is_self = false;
          role = null;
          artifact = #wasm({ module_hash = hash; upgrade_arg_sha256 = argHash; chunked = ?(u.chunked_canister_wasm != null); size_bytes = null });
          source = null;
          execution = exec;
        };
        { steps = [step]; proposal_kind = ?"UpgradeSnsControlledCanister"; status; executed_at; deadline_s; needs_functions = null };
      };
      case (?#ExecuteGenericNervousSystemFunction(g)) {
        let kind = "ExecuteGenericNervousSystemFunction " # Nat64.toText(g.function_id);
        let f = switch fns {
          case null { let b = none(kind); return { b with needs_functions = ?g.function_id } };
          case (?list) Array.find<FnTarget>(list, func(x) = x.id == g.function_id);
        };
        switch f {
          case (?{ target; method = ?m }) {
            if (m != FRONTEND_METHOD) return none(kind # " (" # m # ")");
            let decoded : ?{ batch_id : Nat; evidence : Blob } = from_candid (g.payload);
            let artifact : T.ProposedArtifact = switch decoded {
              case (?d) #asset_batch({ batch_id = ?d.batch_id; evidence = ?d.evidence });
              case null #unknown("the payload is not record { batch_id : nat; evidence : blob }");
            };
            let step : T.ProposalStep = { index = 0; target; is_self = false; role = ?"frontend"; artifact; source = null; execution = exec };
            { steps = [step]; proposal_kind = ?(kind # " (" # m # ")"); status; executed_at; deadline_s; needs_functions = null };
          };
          case (?_) none(kind);
          // a function the list doesn't have: ask again (it may have been added since)
          case null { let b = none(kind); { b with needs_functions = ?g.function_id } };
        };
      };
      case null none("action " # Nat64.toText(p.action));
    };
  };
};
