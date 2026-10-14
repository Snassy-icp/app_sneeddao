/// Test double for ICPSwap's token list canister (`getList`), the source of
/// the reward loop's whitelist. Tests set the list; `set_fail` makes the call
/// answer `#err`, as an outage would.
persistent actor MockIcpSwapTokenList {
  public type Token = { canisterId : Text; decimals : Nat; fee : Nat; name : Text; symbol : Text; standard : Text };
  stable var list : [Token] = [];
  stable var fail : Bool = false;

  public query func getList() : async { #ok : [Token]; #err : Text } {
    if (fail) { #err("token list unavailable") } else { #ok(list) };
  };

  // ---- test helpers ----
  public shared func set_list(t : [Token]) : async () { list := t };
  public shared func set_fail(f : Bool) : async () { fail := f };
};
