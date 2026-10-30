import Array "mo:base/Array";
import Error "mo:base/Error";
import IC "mo:base/ExperimentalInternetComputer";
import Int "mo:base/Int";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";

/// Stands in for SNS governance (and, as a second instance, SNS root) for sneed_attestations'
/// tests (spec/proposal_attestations.md).
///
/// - Answers `get_proposal` and `list_nervous_system_functions` with SNS's shapes, including fields
///   and action variants the registry doesn't read (Motion, a topic field), so the registry's
///   reduced types are tested against a fuller reply. Both are update methods here, so the mock
///   can count the registry's calls (on the wire a caller can't tell).
/// - Installs code into canisters it controls (`install`, `execute_upgrade`), as root does for an
///   SNS's dapp canisters, so canister_info shows it as the installer.
/// - `call_raw` calls any method with raw Candid, as governance does for a generic function.
persistent actor class MockAttSnsGov() = this {
  type ProposalId = { id : Nat64 };
  type GovernanceError = { error_message : Text; error_type : Int32 };
  type ChunkedWasm = { wasm_module_hash : Blob; store_canister_id : ?Principal; chunk_hashes_list : [Blob] };
  type Upgrade = {
    canister_id : ?Principal;
    new_canister_wasm : Blob;
    canister_upgrade_arg : ?Blob;
    mode : ?Int32;
    chunked_canister_wasm : ?ChunkedWasm;
  };
  type Action = {
    #Motion : { motion_text : Text };
    #UpgradeSnsControlledCanister : Upgrade;
    #ExecuteGenericNervousSystemFunction : { function_id : Nat64; payload : Blob };
    #ManageNervousSystemParameters : { reject_cost_e8s : ?Nat64 };
  };
  type ProposalData = {
    id : ?ProposalId;
    action : Nat64;
    topic : ?{ #DappCanisterManagement; #Governance };
    proposal : ?{ title : Text; summary : Text; url : Text; action : ?Action };
    proposer : ?{ id : Blob };
    payload_text_rendering : ?Text;
    decided_timestamp_seconds : Nat64;
    executed_timestamp_seconds : Nat64;
    failed_timestamp_seconds : Nat64;
    failure_reason : ?GovernanceError;
    proposal_creation_timestamp_seconds : Nat64;
    initial_voting_period_seconds : Nat64;
    wait_for_quiet_state : ?{ current_deadline_timestamp_seconds : Nat64 };
    reject_cost_e8s : Nat64;
  };
  type GenericFunction = {
    target_canister_id : ?Principal;
    target_method_name : ?Text;
    validator_canister_id : ?Principal;
    validator_method_name : ?Text;
    topic : ?{ #DappCanisterManagement; #ApplicationBusinessLogic };
  };
  type FunctionType = { #NativeNervousSystemFunction : {}; #GenericNervousSystemFunction : GenericFunction };
  type NervousSystemFunction = { id : Nat64; name : Text; description : ?Text; function_type : ?FunctionType };

  type InstallMode = { #install; #reinstall; #upgrade : ?{ skip_pre_upgrade : ?Bool } };
  type Mgmt = actor {
    install_code : shared ({ mode : InstallMode; canister_id : Principal; wasm_module : Blob; arg : Blob; sender_canister_version : ?Nat64 }) -> async ();
  };
  transient let mgmt : Mgmt = actor ("aaaaa-aa");

  var proposals : [(Nat64, ProposalData)] = [];
  var functions : [NervousSystemFunction] = [];
  var proposal_calls : Nat = 0;
  var function_calls : Nat = 0;
  var fail_reads : Bool = false;

  func hex(b : Blob) : Text {
    let d = Text.toArray("0123456789abcdef");
    var out = "";
    for (x in b.vals()) { let n = Nat8.toNat(x); out #= Text.fromChar(d[n / 16]) # Text.fromChar(d[n % 16]) };
    out;
  };

  func nowS() : Nat64 = Nat64.fromNat(Int.abs(Time.now()) / 1_000_000_000);

  func base(id : Nat64, actionId : Nat64, action : Action, rendering : Text) : ProposalData {
    {
      id = ?{ id };
      action = actionId;
      topic = ?#DappCanisterManagement;
      proposal = ?{ title = "Proposal " # Nat64.toText(id); summary = "test"; url = ""; action = ?action };
      proposer = null;
      payload_text_rendering = ?rendering;
      decided_timestamp_seconds = 0;
      executed_timestamp_seconds = 0;
      failed_timestamp_seconds = 0;
      failure_reason = null;
      proposal_creation_timestamp_seconds = nowS();
      initial_voting_period_seconds = 4 * 86_400;
      wait_for_quiet_state = ?{ current_deadline_timestamp_seconds = nowS() + 4 * 86_400 };
      reject_cost_e8s = 100_000_000;
    };
  };

  func put(id : Nat64, p : ProposalData) {
    proposals := Array.append(Array.filter<(Nat64, ProposalData)>(proposals, func((i, _)) = i != id), [(id, p)]);
  };
  func get(id : Nat64) : ?ProposalData = switch (Array.find<(Nat64, ProposalData)>(proposals, func((i, _)) = i == id)) {
    case (?(_, p)) ?p;
    case null null;
  };

  /// An UpgradeSnsControlledCanister proposal as get_proposal shows it: the wasm stripped, its hash
  /// rendered in the text (or carried by a chunked upgrade).
  public func put_upgrade(id : Nat64, canister_id : Principal, wasm_hash : Blob, arg : ?Blob, chunked : Bool) : async () {
    let rendering = "# Proposal to upgrade SNS controlled canister:\n\n## Canister id: " # Principal.toText(canister_id) # "\n\n## Canister wasm: Embedded module with 123456 bytes and SHA256 `" # hex(wasm_hash) # "`.\n\n## Mode: Upgrade";
    put(id, base(id, 3, #UpgradeSnsControlledCanister({ canister_id = ?canister_id; new_canister_wasm = ""; canister_upgrade_arg = arg; mode = ?1; chunked_canister_wasm = if (chunked) ?{ wasm_module_hash = wasm_hash; store_canister_id = null; chunk_hashes_list = [] } else null }), if (chunked) "chunked upgrade" else rendering));
  };

  public func put_gnsf(id : Nat64, function_id : Nat64, payload : Blob) : async () {
    put(id, base(id, function_id, #ExecuteGenericNervousSystemFunction({ function_id; payload }), "generic function " # Nat64.toText(function_id)));
  };

  public func put_motion(id : Nat64) : async () {
    put(id, base(id, 1, #Motion({ motion_text = "hello" }), "motion"));
  };

  public func add_function(id : Nat64, target : Principal, method : Text) : async () {
    functions := Array.append(Array.filter<NervousSystemFunction>(functions, func(f) = f.id != id), [{
      id;
      name = "fn " # Nat64.toText(id);
      description = null;
      function_type = ?#GenericNervousSystemFunction({ target_canister_id = ?target; target_method_name = ?method; validator_canister_id = ?target; validator_method_name = ?("validate_" # method); topic = null });
    }]);
  };

  /// Sets the proposal's timestamps (seconds; 0 = not yet) and failure reason.
  public func set_state(id : Nat64, decided : Nat64, executed : Nat64, failed : Nat64, failure : ?Text) : async () {
    switch (get(id)) {
      case (?p) put(id, { p with decided_timestamp_seconds = decided; executed_timestamp_seconds = executed; failed_timestamp_seconds = failed; failure_reason = switch failure { case (?m) ?{ error_message = m; error_type = 15 : Int32 }; case null null } });
      case null {};
    };
  };

  public func set_deadline(id : Nat64, deadline : Nat64) : async () {
    switch (get(id)) { case (?p) put(id, { p with wait_for_quiet_state = ?{ current_deadline_timestamp_seconds = deadline } }); case null {} };
  };

  public func set_fail_reads(f : Bool) : async () { fail_reads := f };

  /// Installs code into a canister this mock controls. Returns the error text on failure.
  public func install(canister_id : Principal, wasm : Blob, mode : { #install; #reinstall; #upgrade }) : async ?Text {
    let m : InstallMode = switch mode { case (#install) #install; case (#reinstall) #reinstall; case (#upgrade) #upgrade(null) };
    try { await mgmt.install_code({ mode = m; canister_id; wasm_module = wasm; arg = ""; sender_canister_version = null }); null } catch (e) ?Error.message(e);
  };

  /// Executes an upgrade proposal: installs the wasm into its canister and marks it executed now.
  public func execute_upgrade(id : Nat64, wasm : Blob) : async ?Text {
    let p = switch (get(id)) { case (?p) p; case null return ?"no such proposal" };
    let target = switch (p.proposal) { case (?{ action = ?#UpgradeSnsControlledCanister(u) }) u.canister_id; case _ null };
    let c = switch target { case (?c) c; case null return ?"not an upgrade" };
    try { await mgmt.install_code({ mode = #upgrade(null); canister_id = c; wasm_module = wasm; arg = ""; sender_canister_version = null }) } catch (e) {
      put(id, { p with decided_timestamp_seconds = nowS(); failed_timestamp_seconds = nowS(); failure_reason = ?{ error_message = Error.message(e); error_type = 15 : Int32 } });
      return ?Error.message(e);
    };
    put(id, { p with decided_timestamp_seconds = nowS(); executed_timestamp_seconds = nowS() });
    null;
  };

  public func call_raw(canister : Principal, method : Text, arg : Blob) : async { #ok : Blob; #err : Text } {
    try { #ok(await IC.call(canister, method, arg)) } catch (e) #err(Error.message(e));
  };

  // ---- SNS governance's reads (update methods here, to count them) ----

  public shared func get_proposal(args : { proposal_id : ?ProposalId }) : async { result : ?{ #Error : GovernanceError; #Proposal : ProposalData } } {
    proposal_calls += 1;
    if (fail_reads) throw Error.reject("governance is busy");
    let id = switch (args.proposal_id) { case (?x) x.id; case null return { result = ?#Error({ error_message = "no id"; error_type = 3 }) } };
    switch (get(id)) {
      case (?p) ({ result = ?#Proposal(p) });
      case null ({ result = ?#Error({ error_message = "No proposal for given ProposalId."; error_type = 3 }) });
    };
  };

  public shared func list_nervous_system_functions() : async { functions : [NervousSystemFunction]; reserved_ids : [Nat64] } {
    function_calls += 1;
    { functions; reserved_ids = [] };
  };

  public query func calls() : async { proposals : Nat; functions : Nat } { { proposals = proposal_calls; functions = function_calls } };
  public func reset_calls() : async () { proposal_calls := 0; function_calls := 0 };
  public query func self_id() : async Principal { Principal.fromActor(this) };
};
