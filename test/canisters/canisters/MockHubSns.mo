/// Test double for an SNS as the Sneed Hub backend sees it: it answers
/// `list_sns_canisters` as the root (naming itself, or a configured principal,
/// as governance) and `list_neurons` as governance, with neurons the tests
/// register. Neuron records have the real SNS shape (`permissions` as records
/// with `principal` and `permission_type`, no `controller` field).
///
/// `call_verify_neuron_name` / `call_unverify_neuron_name` make the mock call
/// the backend itself, so the backend sees the governance canister as caller.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Result "mo:base/Result";

persistent actor class MockHubSns() = this {
  public type NeuronId = { id : Blob };
  public type Permission = { principal : ?Principal; permission_type : [Int32] };
  public type Neuron = { id : ?NeuronId; permissions : [Permission] };

  stable var neurons : [Neuron] = [];
  stable var governance_override : ?Principal = null;

  public shared func set_neurons(ns : [{ id : Blob; permissions : [Permission] }]) : async () {
    neurons := Array.map<{ id : Blob; permissions : [Permission] }, Neuron>(ns, func(n) { { id = ?{ id = n.id }; permissions = n.permissions } });
  };
  public shared func set_governance(g : ?Principal) : async () { governance_override := g };

  // ---- SNS root ----
  public query func list_sns_canisters(_ : {}) : async {
    root : ?Principal; governance : ?Principal; ledger : ?Principal; swap : ?Principal; index : ?Principal; dapps : [Principal]; archives : [Principal];
  } {
    let self = Principal.fromActor(this);
    let governance = switch (governance_override) { case (?g) g; case null self };
    { root = ?self; governance = ?governance; ledger = null; swap = null; index = null; dapps = []; archives = [] };
  };

  // ---- SNS governance ----
  public query func list_neurons(args : { of_principal : ?Principal; limit : Nat32; start_page_at : ?NeuronId }) : async { neurons : [Neuron] } {
    switch (args.of_principal) {
      case null { { neurons } };
      case (?p) {
        { neurons = Array.filter<Neuron>(neurons, func(n) { Array.find<Permission>(n.permissions, func(perm) { perm.principal == ?p }) != null }) };
      };
    };
  };

  public query func get_neuron(args : { neuron_id : ?NeuronId }) : async { result : ?{ #Neuron : Neuron; #Error : { error_message : Text; error_type : Int32 } } } {
    switch (args.neuron_id) {
      case (?id) switch (Array.find<Neuron>(neurons, func(n) { n.id == ?id })) {
        case (?n) { { result = ?#Neuron(n) } };
        case null { { result = ?#Error({ error_message = "No neuron"; error_type = 0 }) } };
      };
      case null { { result = null } };
    };
  };

  // ---- outbound calls as the governance canister ----
  type Names = actor {
    set_canister_name : (Principal, Text) -> async { #ok : Text; #err : Text };
    verify_by_dao : (Principal, Text) -> async ();
  };
  public shared func call_set_canister_name(names : Principal, canister : Principal, name : Text) : async { #ok : Text; #err : Text } {
    await (actor (Principal.toText(names)) : Names).set_canister_name(canister, name);
  };
  public shared func call_verify_by_dao(names : Principal, p : Principal, expected : Text) : async { #ok; #err : Text } {
    try { await (actor (Principal.toText(names)) : Names).verify_by_dao(p, expected); #ok } catch (e) { #err(Error.message(e)) };
  };
  type Backend = actor {
    verify_neuron_name : (Principal, NeuronId) -> async Result.Result<Text, Text>;
    unverify_neuron_name : (Principal, NeuronId) -> async Result.Result<Text, Text>;
  };
  public shared func call_verify_neuron_name(backend : Principal, root : Principal, neuron_id : NeuronId) : async Result.Result<Text, Text> {
    await (actor (Principal.toText(backend)) : Backend).verify_neuron_name(root, neuron_id);
  };
  public shared func call_unverify_neuron_name(backend : Principal, root : Principal, neuron_id : NeuronId) : async Result.Result<Text, Text> {
    await (actor (Principal.toText(backend)) : Backend).unverify_neuron_name(root, neuron_id);
  };
};
