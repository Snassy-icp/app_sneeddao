import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Error "mo:base/Error";

/// A target canister for sneed_proxy's tests: methods that reply `()`, reply `#ok`/`#Ok`, reply
/// `#err` with text or a variant, trap, reject, sleep past the proxy's 300 s timeout (a self-call
/// loop until `wake`), and check that the caller is an admin.
persistent actor class MockProxyTarget() = this {
  var admins : [Principal] = [];
  var value : Nat = 0;
  var calls : Nat = 0;
  var last_caller : ?Principal = null;
  var sleeping : Nat = 0;
  var release : Bool = false;

  func touch(caller : Principal) { calls += 1; last_caller := ?caller };

  public shared func add_admin(p : Principal) : async () { admins := Array.append(admins, [p]) };

  public shared ({ caller }) func set_unit(n : Nat) : async () { touch(caller); value := n };
  public shared ({ caller }) func set_ok(n : Nat) : async { #ok; #err : Text } { touch(caller); value := n; #ok };
  public shared ({ caller }) func set_Ok(n : Nat) : async { #Ok : Text; #Err : Text } { touch(caller); value := n; #Ok("set to value") };
  public shared ({ caller }) func fail_text(m : Text) : async { #ok; #err : Text } { touch(caller); #err(m) };
  public shared ({ caller }) func fail_Text(m : Text) : async { #Ok : Nat; #Err : Text } { touch(caller); #Err(m) };
  public shared ({ caller }) func fail_variant() : async { #ok; #err : { #NotAuthorized; #Other : Text } } { touch(caller); #err(#NotAuthorized) };
  public shared ({ caller }) func trap_now(m : Text) : async () { touch(caller); value := 999; Debug.trap(m) };
  public shared ({ caller }) func reject_now(m : Text) : async () { touch(caller); throw Error.reject(m) };
  public shared ({ caller }) func big_reply(n : Nat) : async Blob { touch(caller); Blob.fromArray(Array.tabulate<Nat8>(n, func(_) = 7)) };

  /// Replies only after `wake` (a self-call loop, so the target stays busy without blocking).
  public shared ({ caller }) func sleep(n : Nat) : async () {
    touch(caller);
    sleeping += 1;
    while (not release) { await noop() };
    sleeping -= 1;
    if (sleeping == 0) release := false;
    value := n;
  };
  public shared func noop() : async () {};
  public shared func wake() : async () { release := true };

  public shared ({ caller }) func admin_set(n : Nat) : async { #Ok : Text; #Err : Text } {
    touch(caller);
    if (Array.find<Principal>(admins, func(a) = a == caller) == null) return #Err("Only admins can set the value");
    value := n;
    #Ok("Value set");
  };

  public query func get() : async { value : Nat; calls : Nat; last_caller : ?Principal; sleeping : Nat } {
    { value; calls; last_caller; sleeping };
  };
};
