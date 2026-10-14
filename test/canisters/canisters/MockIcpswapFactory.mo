/// Mock of the ICPSwap factory as the trading bot uses it: `getPool` answers
/// from a table the test fills with `set_pool`. The standards it reports
/// decide which ICPSwap swap path the bot takes (ICRC1 transfer+depositAndSwap
/// or ICRC2 approve+depositFromAndSwap), exactly as on mainnet.
import Buffer "mo:base/Buffer";
import Principal "mo:base/Principal";

persistent actor class MockIcpswapFactory() {

  public type TokenInfo = { address : Text; standard : Text };
  public type Error = { #CommonError; #InternalError : Text; #UnsupportedToken : Text; #InsufficientFunds };
  public type PoolData = { canisterId : Principal; token0 : TokenInfo; token1 : TokenInfo; fee : Nat };

  transient let pools = Buffer.Buffer<PoolData>(4);

  public query func getPool(args : { token0 : TokenInfo; token1 : TokenInfo; fee : Nat }) : async { #ok : PoolData; #err : Error } {
    for (p in pools.vals()) {
      if (p.token0.address == args.token0.address and p.token1.address == args.token1.address and p.fee == args.fee) { return #ok(p) };
    };
    #err(#CommonError);
  };

  // ---- test helpers ----

  /// Register a pool; token0/token1 must be given in ICPSwap order (sorted by principal text).
  public shared func set_pool(token0 : Principal, token1 : Principal, standard0 : Text, standard1 : Text, pool : Principal) : async () {
    pools.add({
      canisterId = pool;
      token0 = { address = Principal.toText(token0); standard = standard0 };
      token1 = { address = Principal.toText(token1); standard = standard1 };
      fee = 3000;
    });
  };
  public shared func clear_pools() : async () { pools.clear() };
};
