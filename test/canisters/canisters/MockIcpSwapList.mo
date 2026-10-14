/// Test double for ICPSwap's token list canister (`getList`), the source of
/// the Sneed Hub token whitelist. The reply carries more fields than the
/// backend reads, as the real one does. Tests load it with `set_tokens` and
/// can make it answer an error.
import Array "mo:base/Array";

persistent actor MockIcpSwapList {
  public type Input = { canisterId : Text; decimals : Nat; fee : Nat; name : Text; symbol : Text; standard : Text };
  public type Token = {
    canisterId : Text; decimals : Nat; fee : Nat; name : Text; symbol : Text; standard : Text;
    totalSupply : Nat; rank : Nat32; configs : [{ name : Text; value : Text }];
  };
  stable var tokens : [Token] = [];
  stable var error : ?Text = null;

  public shared func set_tokens(ts : [Input]) : async () {
    tokens := Array.map<Input, Token>(ts, func(t) {
      { canisterId = t.canisterId; decimals = t.decimals; fee = t.fee; name = t.name; symbol = t.symbol; standard = t.standard; totalSupply = 0; rank = 0; configs = [] };
    });
  };
  public shared func set_error(e : ?Text) : async () { error := e };
  public query func getList() : async { #ok : [Token]; #err : Text } {
    switch (error) { case (?e) #err(e); case null #ok(tokens) };
  };
};
