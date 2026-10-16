import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";

import SnsDirectory "SnsDirectory";
import T "Types";

/// Who controls a canister: its controllers, read with the management canister's canister_info,
/// or the governance canister of a deployed SNS whose root is a controller.
module {
  type IC = actor {
    canister_info : shared { canister_id : Principal; num_requested_changes : ?Nat64 } -> async { controllers : [Principal] };
  };

  public func controls(sns : SnsDirectory.State, snsw : Principal, caller : Principal, canister : Principal) : async* { #ok; #err : Text } {
    let ic : IC = actor "aaaaa-aa";
    let info = try {
      await ic.canister_info({ canister_id = canister; num_requested_changes = null });
    } catch (e) {
      return #err("Could not read the canister's controllers: " # Error.message(e));
    };
    if (Array.find<Principal>(info.controllers, func(c) = c == caller) != null) return #ok;
    if (T.isCanisterId(caller)) {
      try { await* SnsDirectory.ensureFresh(sns, snsw) } catch (_) {};
      switch (SnsDirectory.rootOfGovernance(sns, caller)) {
        case (?root) if (Array.find<Principal>(info.controllers, func(c) = c == root) != null) return #ok;
        case null {};
      };
    };
    #err("You are not a controller of this canister");
  };
};
