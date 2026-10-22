/// Test double for the part of SNS governance that Sneedex uses to escrow
/// neurons: `get_neuron` (permissions and stake) and `manage_neuron` with
/// AddNeuronPermissions / RemoveNeuronPermissions.
///
/// Authorization follows SNS governance: adding permissions, or removing
/// another principal's, needs the ManagePrincipals permission (2); a principal
/// may always remove its own. Removing a permission a principal does not hold
/// is an error, and a principal whose last permission goes is dropped from
/// the neuron. A test helper creates neurons, another makes `manage_neuron`
/// fail so escrow error handling can be exercised, and `set_hold` keeps
/// `get_neuron` / `manage_neuron` calls waiting (yielding to other messages
/// through self-calls) until released, so a test can land other calls while
/// a caller sits in its await.
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Int32 "mo:base/Int32";
import Principal "mo:base/Principal";

persistent actor MockSnsNeurons {
  public type NeuronId = { id : Blob };
  public type NeuronPermission = { principal : ?Principal; permission_type : [Int32] };
  public type DissolveState = { #DissolveDelaySeconds : Nat64; #WhenDissolvedTimestampSeconds : Nat64 };
  public type Neuron = {
    id : ?NeuronId;
    permissions : [NeuronPermission];
    cached_neuron_stake_e8s : Nat64;
    maturity_e8s_equivalent : Nat64;
    dissolve_state : ?DissolveState;
  };
  public type GovernanceError = { error_message : Text; error_type : Int32 };
  public type NeuronPermissionList = { permissions : [Int32] };
  public type ManageNeuron = {
    subaccount : Blob;
    command : ?{
      #AddNeuronPermissions : { permissions_to_add : ?NeuronPermissionList; principal_id : ?Principal };
      #RemoveNeuronPermissions : { permissions_to_remove : ?NeuronPermissionList; principal_id : ?Principal };
    };
  };
  public type ManageNeuronResponse = {
    command : ?{ #Error : GovernanceError; #AddNeuronPermission : {}; #RemoveNeuronPermission : {} };
  };

  let MANAGE_PRINCIPALS : Int32 = 2;

  stable var neurons : [(Blob, Neuron)] = [];
  stable var fail : Bool = false;
  stable var calls : [(Principal, Text)] = [];
  transient var failRemoveOf : ?Principal = null; // removing this principal's permissions fails
  transient var holdGet : Bool = false;
  transient var holdManage : Bool = false;
  transient var waiting : Nat = 0;

  /// Wait (yielding) while `held()` says so; at most ~5000 rounds so nothing spins forever.
  func waitWhile(held : () -> Bool) : async () {
    if (not held()) { return };
    waiting += 1;
    var i = 0;
    while (held() and i < 5000) { await async {}; i += 1 };
    waiting -= 1;
  };

  func find(id : Blob) : ?Neuron {
    switch (Array.find<(Blob, Neuron)>(neurons, func((n, _)) { n == id })) { case (?(_, n)) ?n; case null null };
  };
  func put(id : Blob, n : Neuron) {
    neurons := Array.map<(Blob, Neuron), (Blob, Neuron)>(neurons, func((k, v)) { if (k == id) { (k, n) } else { (k, v) } });
  };
  func permsOf(n : Neuron, p : Principal) : [Int32] {
    switch (Array.find<NeuronPermission>(n.permissions, func(e) { e.principal == ?p })) { case (?e) e.permission_type; case null [] };
  };
  func has(list : [Int32], x : Int32) : Bool { Array.find<Int32>(list, func(y) { y == x }) != null };
  func err(msg : Text) : ManageNeuronResponse { { command = ?#Error({ error_message = msg; error_type = 3 }) } };
  func withPerms(n : Neuron, perms : [NeuronPermission]) : Neuron {
    { id = n.id; permissions = perms; cached_neuron_stake_e8s = n.cached_neuron_stake_e8s; maturity_e8s_equivalent = n.maturity_e8s_equivalent; dissolve_state = n.dissolve_state };
  };

  // an update (not a query) so that it can wait while held; callers are canisters, unaffected
  public func get_neuron(req : { neuron_id : ?NeuronId }) : async { result : ?{ #Error : GovernanceError; #Neuron : Neuron } } {
    await waitWhile(func() { holdGet });
    switch (req.neuron_id) {
      case null { { result = ?#Error({ error_message = "No neuron id"; error_type = 1 }) } };
      case (?nid) {
        switch (find(nid.id)) {
          case (?n) { { result = ?#Neuron(n) } };
          case null { { result = ?#Error({ error_message = "Neuron not found"; error_type = 2 }) } };
        };
      };
    };
  };

  public shared ({ caller }) func manage_neuron(req : ManageNeuron) : async ManageNeuronResponse {
    await waitWhile(func() { holdManage });
    if (fail) { return err("governance refuses (test mode)") };
    let neuron = switch (find(req.subaccount)) { case (?n) n; case null { return err("Neuron not found") } };
    switch (req.command) {
      case (?#AddNeuronPermissions(a)) {
        if (not has(permsOf(neuron, caller), MANAGE_PRINCIPALS)) { return err("Caller is not authorized to manage principals of this neuron") };
        let target = switch (a.principal_id) { case (?p) p; case null { return err("No principal given") } };
        let toAdd = switch (a.permissions_to_add) { case (?l) l.permissions; case null [] };
        calls := Array.append(calls, [(caller, "add " # Principal.toText(target) # " " # debug_show(toAdd))]);
        let existing = permsOf(neuron, target);
        let merged = Buffer.fromArray<Int32>(existing);
        for (x in toAdd.vals()) { if (not has(Buffer.toArray(merged), x)) { merged.add(x) } };
        let others = Array.filter<NeuronPermission>(neuron.permissions, func(e) { e.principal != ?target });
        put(req.subaccount, withPerms(neuron, Array.append(others, [{ principal = ?target; permission_type = Buffer.toArray(merged) }])));
        { command = ?#AddNeuronPermission({}) };
      };
      case (?#RemoveNeuronPermissions(r)) {
        let target = switch (r.principal_id) { case (?p) p; case null { return err("No principal given") } };
        if (failRemoveOf == ?target) { return err("governance refuses to remove this principal (test mode)") };
        if (target != caller and not has(permsOf(neuron, caller), MANAGE_PRINCIPALS)) { return err("Caller is not authorized to manage principals of this neuron") };
        let toRemove = switch (r.permissions_to_remove) { case (?l) l.permissions; case null [] };
        calls := Array.append(calls, [(caller, "remove " # Principal.toText(target) # " " # debug_show(toRemove))]);
        let existing = permsOf(neuron, target);
        if (existing.size() == 0) { return err("Principal has no permissions on this neuron") };
        for (x in toRemove.vals()) { if (not has(existing, x)) { return err("Principal does not have permission " # Int32.toText(x)) } };
        let left = Array.filter<Int32>(existing, func(x) { not has(toRemove, x) });
        let others = Array.filter<NeuronPermission>(neuron.permissions, func(e) { e.principal != ?target });
        let perms = if (left.size() == 0) { others } else { Array.append(others, [{ principal = ?target; permission_type = left }]) };
        put(req.subaccount, withPerms(neuron, perms));
        { command = ?#RemoveNeuronPermission({}) };
      };
      case null { err("No command") };
    };
  };

  // ---- test helpers ----
  /// Create (or replace) a neuron whose only principal is `owner` with the given permissions.
  public shared func create_neuron(id : Blob, owner : Principal, permissions : [Int32], stake_e8s : Nat64) : async () {
    let n : Neuron = {
      id = ?{ id };
      permissions = [{ principal = ?owner; permission_type = permissions }];
      cached_neuron_stake_e8s = stake_e8s;
      maturity_e8s_equivalent = 0;
      dissolve_state = ?#DissolveDelaySeconds(2_592_000);
    };
    neurons := Array.append(Array.filter<(Blob, Neuron)>(neurons, func((k, _)) { k != id }), [(id, n)]);
  };
  public shared func set_fail(f : Bool) : async () { fail := f };
  /// make the removal of one principal's permissions fail (null: none)
  public shared func set_fail_remove_of(p : ?Principal) : async () { failRemoveOf := p };
  public shared func set_hold(get : Bool, manage : Bool) : async () { holdGet := get; holdManage := manage };
  /// how many get_neuron / manage_neuron calls are waiting now
  public query func waiting_calls() : async Nat { waiting };
  public query func permissions_of(id : Blob) : async [(Principal, [Int32])] {
    switch (find(id)) {
      case (?n) {
        Array.mapFilter<NeuronPermission, (Principal, [Int32])>(n.permissions, func(e) { switch (e.principal) { case (?p) ?(p, e.permission_type); case null null } });
      };
      case null [];
    };
  };
  public query func list_calls() : async [(Principal, Text)] { calls };
};
