/// Test double for the Sneed Premium canister: memberships set by the tests.
import Array "mo:base/Array";
import Time "mo:base/Time";

persistent actor MockPremium {
  public type PremiumStatus = { #Active : { expiration : Time.Time }; #Expired : { expiredAt : Time.Time }; #NotFound };
  stable var members : [(Principal, Time.Time)] = [];

  public shared func set_member(p : Principal, expiration : Time.Time) : async () {
    members := Array.append(Array.filter<(Principal, Time.Time)>(members, func((m, _)) { m != p }), [(p, expiration)]);
  };
  public query func checkMembership(p : Principal) : async PremiumStatus {
    switch (Array.find<(Principal, Time.Time)>(members, func((m, _)) { m == p })) {
      case (?(_, exp)) { if (exp > Time.now()) { #Active({ expiration = exp }) } else { #Expired({ expiredAt = exp }) } };
      case null { #NotFound };
    };
  };
};
