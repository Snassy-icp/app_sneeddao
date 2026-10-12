/// Test double for the SNS governance canister's `manage_neuron`, with a
/// deliberately wider Candid interface than the library declares, so the
/// reduced request/response types in src/icrc3/SnsRegister.mo are exercised
/// against variants with tags they do not know.
///
/// A proposal is accepted when the caller is a hotkey of the neuron. Test
/// helpers switch the behaviour: unknown reply tag, no proposal id, or a trap.
import Array "mo:base/Array";
import Debug "mo:base/Debug";

persistent actor MockSnsGovernance {
  public type Motion = { motion_text : Text };
  public type RegisterDappCanisters = { canister_ids : [Principal] };
  public type Action = {
    #RegisterDappCanisters : RegisterDappCanisters;
    #Motion : Motion;
    #UpgradeSnsControlledCanister : { canister_id : ?Principal; new_canister_wasm : Blob };
  };
  public type Proposal = { title : Text; url : Text; summary : Text; action : ?Action };
  public type Command = {
    #MakeProposal : Proposal;
    #Follow : { function_id : Nat64; followees : [{ id : Blob }] };
    #Disburse : { to_account : ?{ owner : ?Principal; subaccount : ?{ subaccount : Blob } }; amount : ?{ e8s : Nat64 } };
  };
  public type ManageNeuron = { subaccount : Blob; command : ?Command };
  public type GovernanceError = { error_message : Text; error_type : Int32 };
  public type Command_1 = {
    #Error : GovernanceError;
    #MakeProposal : { proposal_id : ?{ id : Nat64 } };
    #Follow : {};
    #Disburse : { transfer_block_height : Nat64 };
  };
  public type ManageNeuronResponse = { command : ?Command_1 };

  public type ProposalRecord = {
    id : Nat64;
    proposer : Principal;
    neuron : Blob;
    title : Text;
    url : Text;
    summary : Text;
    canister_ids : [Principal];
  };
  public type Mode = { #normal; #unknown_reply; #no_id; #trap };

  stable var hotkeys : [(Blob, Principal)] = [];
  stable var proposals : [ProposalRecord] = [];
  stable var next_id : Nat64 = 100;
  stable var mode : Mode = #normal;

  public shared ({ caller }) func manage_neuron(req : ManageNeuron) : async ManageNeuronResponse {
    switch (mode) {
      case (#trap) { Debug.trap("governance is down") };
      case (#unknown_reply) { return { command = ?#Follow({}) } };
      case _ {};
    };
    let authorized = Array.find<(Blob, Principal)>(hotkeys, func((n, p)) { n == req.subaccount and p == caller }) != null;
    if (not authorized) {
      return { command = ?#Error({ error_message = "Caller is not authorized to perform this operation on the neuron"; error_type = 3 }) };
    };
    switch (req.command) {
      case (?#MakeProposal(p)) {
        if (mode == #no_id) { return { command = ?#MakeProposal({ proposal_id = null }) } };
        let id = next_id;
        next_id += 1;
        let canister_ids = switch (p.action) { case (?#RegisterDappCanisters(r)) { r.canister_ids }; case _ { [] } };
        proposals := Array.append(proposals, [{ id; proposer = caller; neuron = req.subaccount; title = p.title; url = p.url; summary = p.summary; canister_ids }]);
        { command = ?#MakeProposal({ proposal_id = ?{ id } }) };
      };
      case _ { { command = ?#Error({ error_message = "unsupported command"; error_type = 1 }) } };
    };
  };

  // ---- test helpers ----
  public shared func add_hotkey(neuron : Blob, p : Principal) : async () { hotkeys := Array.append(hotkeys, [(neuron, p)]) };
  public shared func clear_hotkeys() : async () { hotkeys := [] };
  public shared func set_mode(m : Mode) : async () { mode := m };
  public query func list_proposals() : async [ProposalRecord] { proposals };
};
