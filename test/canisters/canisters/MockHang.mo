/// A canister that does not answer (Sneed Lock audit M1): the ledger and pool methods Sneed Lock
/// calls on caller-supplied canisters, as update methods that wait in a self-call loop until the
/// test calls `release` (or a cap of rounds passes). While one of its calls is open, a caller that
/// waits for it without a timeout cannot be stopped, so cannot be upgraded.
import Principal "mo:base/Principal";

persistent actor class MockHang() {
  public type Error = { #CommonError; #InternalError : Text; #UnsupportedToken : Text; #InsufficientFunds };
  public type Account = { owner : Principal; subaccount : ?Blob };

  transient var hanging : Bool = true;
  transient var spins : Nat = 0;
  transient var calls : Nat = 0;

  func wait() : async* () {
    calls += 1;
    var n = 0;
    while (hanging and n < 1_000_000) { await async {}; n += 1; spins += 1 };
  };

  // ICPSwap pool shape
  public shared func getUserPositionIdsByPrincipal(_p : Principal) : async { #ok : [Nat]; #err : Error } { await* wait(); #ok([1, 2, 3]) };
  public shared func metadata() : async { #ok : { token0 : { address : Text; standard : Text }; token1 : { address : Text; standard : Text }; fee : Nat }; #err : Error } {
    await* wait();
    #err(#CommonError);
  };
  // ICRC-1 ledger shape
  public shared func icrc1_fee() : async Nat { await* wait(); 1 };
  public shared func icrc1_balance_of(_a : Account) : async Nat { await* wait(); 1_000_000_000 };

  // ---- test helpers ----
  public shared func release() : async () { hanging := false };
  public shared func hang() : async () { hanging := true };
  public query func stats() : async { calls : Nat; spins : Nat; hanging : Bool } { { calls; spins; hanging } };
};
