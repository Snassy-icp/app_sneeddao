import Error "mo:base/Error";
import Principal "mo:base/Principal";

/// Stands in for Sneed SNS governance executing mr_sneed's GNSFs: it calls the target methods
/// inter-canister, as governance does when a proposal is adopted, and reports a trap as #err.
persistent actor MockMrSneedGov {
  type SetPersonalityArgs = { text : Text; reason : Text; expected_version : ?Nat };
  type Limits = { writes_per_day : Nat; max_pinned : Nat; max_active : Nat; max_bytes : Nat };
  type MrSneed = actor {
    set_personality : SetPersonalityArgs -> async Nat;
    set_writers : [Principal] -> async ();
    set_limits : Limits -> async ();
    remove_memory : (Nat, Text) -> async ();
    end_operator : () -> async { #ok : Text; #err : Text };
  };
  func target(p : Principal) : MrSneed = actor (Principal.toText(p));

  public shared func set_personality(t : Principal, a : SetPersonalityArgs) : async { #ok : Nat; #err : Text } {
    try { #ok(await target(t).set_personality(a)) } catch (e) { #err(Error.message(e)) };
  };
  public shared func set_writers(t : Principal, ps : [Principal]) : async { #ok; #err : Text } {
    try { await target(t).set_writers(ps); #ok } catch (e) { #err(Error.message(e)) };
  };
  public shared func set_limits(t : Principal, l : Limits) : async { #ok; #err : Text } {
    try { await target(t).set_limits(l); #ok } catch (e) { #err(Error.message(e)) };
  };
  public shared func remove_memory(t : Principal, id : Nat, reason : Text) : async { #ok; #err : Text } {
    try { await target(t).remove_memory(id, reason); #ok } catch (e) { #err(Error.message(e)) };
  };
  public shared func end_operator(t : Principal) : async { #ok : Text; #err : Text } {
    try { await target(t).end_operator() } catch (e) { #err(Error.message(e)) };
  };
};
