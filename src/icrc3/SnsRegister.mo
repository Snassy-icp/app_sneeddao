/// Optional SNS registration of archive canisters (shared library, see Log.mo).
///
/// Only a canister that SNS root controls alone, and that is registered with
/// the SNS by a `RegisterDappCanisters` proposal, can be upgraded by proposal.
/// This module submits that proposal for every archive the log creates,
/// through an SNS neuron that lists the logging canister as a hotkey (the
/// `SubmitProposal` permission). It is best effort by design:
///
/// - no neuron configured: the step is skipped, nothing is logged;
/// - a failed submission (wrong neuron, too little stake, governance down) is
///   retried on later runs, at most `MAX_ATTEMPTS` times per archive, then
///   left alone until the neuron is changed or the registration is reset;
/// - the response is read defensively: anything governance says that this
///   module does not understand counts as a failed attempt, never a trap.
///
/// The log keeps working whatever happens here: appending is gated by the
/// archive's parent principal, not by controllers.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Int32 "mo:base/Int32";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";

import T "Types";

module {
  public let MAX_ATTEMPTS : Nat = 5;

  public type Registration = {
    canister_id : Principal;
    start : Nat; // first block index held by the archive
    proposal_id : ?Nat64; // set once governance accepted the proposal
    attempts : Nat; // failed submissions since the last neuron change / reset
    last_error : ?Text;
  };

  /// Stable state. Keep as `stable var` in the owning canister.
  public type State = {
    var neuron : ?Blob; // SNS neuron id (32-byte subaccount); null disables the step
    var registrations : [Registration];
  };

  /// Transient state.
  public type Runtime = { var running : Bool };

  public type Status = {
    governance : Principal;
    neuron : ?Blob;
    registrations : [Registration];
  };

  public type Environment = {
    governance : Principal; // the SNS governance canister
    name : Text; // how the logging canister calls itself in proposals ("Sneed Lock")
    doc_url : Text; // documentation of the log; also the proposal url
    new_correlation_id : () -> Nat;
    log_info : (Nat, Text) -> ();
    log_error : (Nat, Text) -> ();
    /// Optional: the proposal text for a canister; null means the archive wording below.
    describe : ?((Principal, Nat) -> { title : Text; summary : Text });
  };

  // SNS governance reduced to what is sent and read. Variants with fewer tags
  // are valid Candid subtypes on the way out; on the way back `command` is an
  // option, so a tag this module does not know decodes to null instead of
  // failing the call.
  type Proposal = {
    title : Text;
    url : Text;
    summary : Text;
    action : ?{ #RegisterDappCanisters : { canister_ids : [Principal] } };
  };
  type ManageNeuron = { subaccount : Blob; command : ?{ #MakeProposal : Proposal } };
  type ManageNeuronResponse = {
    command : ?{
      #MakeProposal : { proposal_id : ?{ id : Nat64 } };
      #Error : { error_message : Text; error_type : Int32 };
    };
  };
  type Governance = actor { manage_neuron : shared ManageNeuron -> async ManageNeuronResponse };

  public func init() : State { { var neuron = null; var registrations = [] } };
  public func runtime() : Runtime { { var running = false } };

  /// Configure the neuron (a 32-byte subaccount) or disable the step with null.
  /// Registrations without a proposal get a fresh set of attempts.
  public func setNeuron(state : State, neuron : ?Blob) : { #Ok; #Err : Text } {
    switch (neuron) {
      case (?n) { if (n.size() != 32) { return #Err("an SNS neuron id is a 32-byte subaccount, got " # Nat.toText(n.size()) # " bytes") } };
      case null {};
    };
    state.neuron := neuron;
    state.registrations := Array.map<Registration, Registration>(state.registrations, func(r) {
      if (r.proposal_id == null) { { r with attempts = 0; last_error = null } } else { r };
    });
    #Ok;
  };

  /// Forget the proposal and attempts of one archive so that the next run
  /// submits a new proposal (after a rejected one, for instance). False if the
  /// archive is unknown.
  public func reset(state : State, canister_id : Principal) : Bool {
    var found = false;
    state.registrations := Array.map<Registration, Registration>(state.registrations, func(r) {
      if (r.canister_id == canister_id) { found := true; { r with proposal_id = null; attempts = 0; last_error = null } } else { r };
    });
    found;
  };

  public func status(state : State, env : Environment) : Status {
    { governance = env.governance; neuron = state.neuron; registrations = state.registrations };
  };

  /// Make sure every archive has a registration entry (in archive order).
  func sync(state : State, archives : [T.ArchiveInfo]) {
    for (a in archives.vals()) {
      if (Array.find<Registration>(state.registrations, func(r) { r.canister_id == a.canister_id }) == null) {
        state.registrations := Array.append(state.registrations, [{ canister_id = a.canister_id; start = a.start; proposal_id = null; attempts = 0; last_error = null }]);
      };
    };
  };

  func update(state : State, canister_id : Principal, f : Registration -> Registration) {
    state.registrations := Array.map<Registration, Registration>(state.registrations, func(r) {
      if (r.canister_id == canister_id) { f(r) } else { r };
    });
  };

  /// Submit a registration proposal for every archive that has none yet.
  /// Returns the number of proposals governance accepted. Skips silently
  /// when no neuron is configured or a run is already in progress.
  public func registerMissing(state : State, rt : Runtime, archives : [T.ArchiveInfo], env : Environment) : async* Nat {
    sync(state, archives);
    let neuron = switch (state.neuron) { case null { return 0 }; case (?n) { n } };
    if (rt.running) { return 0 };
    let pending = Array.filter<Registration>(state.registrations, func(r) { r.proposal_id == null and r.attempts < MAX_ATTEMPTS });
    if (pending.size() == 0) { return 0 };
    rt.running := true;
    let governance : Governance = actor (Principal.toText(env.governance));
    let cid = env.new_correlation_id();
    var submitted = 0;
    for (r in pending.vals()) {
      switch (await* submit(governance, neuron, r, env)) {
        case (#Ok(id)) {
          update(state, r.canister_id, func(x) { { x with proposal_id = ?id; last_error = null } });
          submitted += 1;
          env.log_info(cid, "ICRC-3: submitted proposal " # Nat64.toText(id) # " to register archive " # Principal.toText(r.canister_id) # " with the SNS");
        };
        case (#Err(e)) {
          let attempts = r.attempts + 1;
          update(state, r.canister_id, func(x) { { x with attempts = attempts; last_error = ?e } });
          env.log_error(cid, "ICRC-3: could not submit the proposal to register archive " # Principal.toText(r.canister_id) # " (attempt " # Nat.toText(attempts) # " of " # Nat.toText(MAX_ATTEMPTS) # "): " # e # (if (attempts >= MAX_ATTEMPTS) { ". Giving up until the neuron is changed or the registration is reset" } else { "" }));
        };
      };
    };
    rt.running := false;
    submitted;
  };

  func submit(governance : Governance, neuron : Blob, r : Registration, env : Environment) : async* { #Ok : Nat64; #Err : Text } {
    let id = Principal.toText(r.canister_id);
    let text = switch (env.describe) {
      case (?d) { d(r.canister_id, r.start) };
      case null {
        {
          title = "Register ICRC-3 archive " # id # " of " # env.name;
          summary = env.name # " created the canister `" # id # "` as an archive of its ICRC-3 activity log. It holds the blocks from index " # Nat.toText(r.start) # " onwards.\n\n"
            # "Adopting this proposal registers the archive as a dapp canister of the DAO: SNS root becomes its sole controller, so the DAO can inspect and upgrade it by proposal. "
            # env.name # " keeps writing to it as the archive's parent and tops up its cycles from its own balance.\n\n"
            # "This proposal was submitted automatically by " # env.name # " through a hotkeyed neuron when the archive was created.\n\n"
            # "Operator checklist: add `" # id # "` to the DAO's cycle monitoring.\n\n"
            # "Documentation: " # env.doc_url;
        };
      };
    };
    let proposal : Proposal = { title = text.title; url = env.doc_url; summary = text.summary; action = ?#RegisterDappCanisters({ canister_ids = [r.canister_id] }) };
    try {
      let res = await governance.manage_neuron({ subaccount = neuron; command = ?#MakeProposal(proposal) });
      switch (res.command) {
        case (?#MakeProposal({ proposal_id = ?{ id } })) { #Ok(id) };
        case (?#MakeProposal(_)) { #Err("governance returned no proposal id") };
        case (?#Error(e)) { #Err("governance error " # Int32.toText(e.error_type) # ": " # e.error_message) };
        case null { #Err("unexpected response from governance") };
      };
    } catch (e) {
      #Err(Error.message(e));
    };
  };
};
