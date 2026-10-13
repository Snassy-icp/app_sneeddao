/// Test double for SneedApp's wallet registration: records who asked to list what.
import Array "mo:base/Array";

persistent actor MockSneedApp {
  stable var authorized : [Principal] = [];
  stable var entries : [(Principal, Principal, Text)] = []; // (user, canister, appId)

  public shared func set_authorized(ps : [Principal]) : async () { authorized := ps };
  public shared ({ caller }) func registerCanisterFor(user : Principal, canisterId : Principal, appId : Text) : async { #Ok; #Err : Text } {
    if (Array.find<Principal>(authorized, func(p) { p == caller }) == null) { return #Err("Not authorized") };
    entries := Array.append(entries, [(user, canisterId, appId)]);
    #Ok;
  };
  public query func get_entries() : async [(Principal, Principal, Text)] { entries };
};
