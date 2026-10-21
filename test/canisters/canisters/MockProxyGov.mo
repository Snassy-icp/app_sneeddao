import Array "mo:base/Array";
import Error "mo:base/Error";
import IC "mo:base/ExperimentalInternetComputer";
import Principal "mo:base/Principal";

/// Stands in for SNS governance (and SNS root) for sneed_proxy's tests (spec/sneed_proxy.md §8).
///
/// - It holds generic nervous system functions (target + validator canister and method).
/// - `submit` calls the validator inter-canister with the raw payload, as governance does when a
///   proposal is made: `Err` refuses the proposal, `Ok` text is stored as its rendering.
/// - `adopt` calls the target with the raw payload, as governance does when a proposal is
///   adopted: any reply means executed, a reject or trap means failed with the reject message.
/// - `list_sns_canisters` answers as SNS root would, from a list the test sets.
persistent actor MockProxyGov {
  type Fn = { target : Principal; target_method : Text; validator : Principal; validator_method : Text };
  type Status = { #open; #executed : Text; #failed : Text };
  type Proposal = { id : Nat; function_id : Nat; payload : Blob; rendering : Text; status : Status };
  type SnsCanisters = {
    root : ?Principal;
    swap : ?Principal;
    ledger : ?Principal;
    index : ?Principal;
    governance : ?Principal;
    dapps : [Principal];
    archives : [Principal];
  };

  var functions : [(Nat, Fn)] = [];
  var proposals : [Proposal] = [];
  var sns : SnsCanisters = { root = null; swap = null; ledger = null; index = null; governance = null; dapps = []; archives = [] };

  public func add_function(id : Nat, f : Fn) : async () {
    functions := Array.append(Array.filter<(Nat, Fn)>(functions, func((i, _)) = i != id), [(id, f)]);
  };

  func fnOf(id : Nat) : ?Fn = switch (Array.find<(Nat, Fn)>(functions, func((i, _)) = i == id)) {
    case (?(_, f)) ?f;
    case null null;
  };

  /// Make a proposal: the validator decides whether it can be submitted.
  public func submit(function_id : Nat, payload : Blob) : async { #ok : (Nat, Text); #err : Text } {
    let f = switch (fnOf(function_id)) { case (?f) f; case null return #err("no such function") };
    let reply = try { await IC.call(f.validator, f.validator_method, payload) } catch (e) {
      return #err("validator rejected: " # Error.message(e));
    };
    let r : ?{ #Ok : Text; #Err : Text } = from_candid (reply);
    switch (r) {
      case (?#Ok(t)) {
        let id = proposals.size() + 1;
        proposals := Array.append(proposals, [{ id; function_id; payload; rendering = t; status = #open }]);
        #ok(id, t);
      };
      case (?#Err(e)) #err(e);
      case null #err("validator reply is not variant { Ok : text; Err : text }");
    };
  };

  func setStatus(id : Nat, s : Status) {
    proposals := Array.map<Proposal, Proposal>(proposals, func(p) = if (p.id == id) { { p with status = s } } else p);
  };

  /// Execute an adopted proposal: one call to the target with the payload, never retried.
  public func adopt(id : Nat) : async Status {
    let p = switch (Array.find<Proposal>(proposals, func(p) = p.id == id)) { case (?p) p; case null return #failed("no such proposal") };
    let f = switch (fnOf(p.function_id)) { case (?f) f; case null return #failed("no such function") };
    let s : Status = try {
      let reply = await IC.call(f.target, f.target_method, p.payload);
      let t : ?Text = from_candid (reply);
      #executed(switch t { case (?x) x; case null "" });
    } catch (e) {
      #failed(Error.message(e));
    };
    setStatus(id, s);
    s;
  };

  /// Submit and adopt at once (when the test does not look at the open proposal).
  public func pass(function_id : Nat, payload : Blob) : async { #ok : (Nat, Status); #err : Text } {
    switch (await submit(function_id, payload)) {
      case (#ok(id, _)) #ok(id, await adopt(id));
      case (#err(e)) #err(e);
    };
  };

  /// Call any canister method with a raw argument (to test callers other than governance).
  public func call_raw(canister : Principal, method : Text, arg : Blob) : async { #ok : Blob; #err : Text } {
    try { #ok(await IC.call(canister, method, arg)) } catch (e) { #err(Error.message(e)) };
  };

  public query func get_proposal(id : Nat) : async ?Proposal { Array.find<Proposal>(proposals, func(p) = p.id == id) };

  public func set_sns_canisters(s : SnsCanisters) : async () { sns := s };
  public query func list_sns_canisters(_ : {}) : async SnsCanisters { sns };
};
