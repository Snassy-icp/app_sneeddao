/// Mock of the subset of an ICPSwap pool that sneed_lock and the frontend use:
/// position ownership and transfer, claiming accrued fees to a subaccount,
/// the deposit / unused-balance / increaseLiquidity / withdrawToSubaccount
/// cycle. Token movements go through the mock ledgers so balances are real.
///
/// Semantics mirror ICPSwap as sneed_lock relies on them:
///  - `deposit` takes `amount` from the caller's deposit subaccount on this
///    pool and credits `amount - fee` to the caller's unused balance
///  - `claimToSubaccount` delivers `owed - fee` per side to the subaccount when
///    `owed > fee`, otherwise credits the dust to the caller's unused balance
///  - `withdrawToSubaccount` debits `amount` and delivers `amount - fee`
///  - `increaseLiquidity` uses `use_percent` of the desired amounts (default
///    100 %), leaving the rest in the unused balance, and can be told to fail
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import HashMap "mo:base/HashMap";
import Hash "mo:base/Hash";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Char "mo:base/Char";
import Principal "mo:base/Principal";

shared ({ caller = deployer }) persistent actor class MockSwapPool(init : { token0 : Principal; token1 : Principal; fee : Nat }) = this {

  public type Account = { owner : Principal; subaccount : ?Blob };
  public type Error = { #CommonError; #InternalError : Text; #UnsupportedToken : Text; #InsufficientFunds };
  public type Position = { var owner : Principal; var liquidity : Nat; var owed0 : Nat; var owed1 : Nat };

  type Ledger = actor {
    icrc1_fee : () -> async Nat;
    icrc1_balance_of : (Account) -> async Nat;
    icrc1_transfer : ({ from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : { #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat }; #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text } } };
  };

  transient let positions = HashMap.HashMap<Nat, Position>(16, Nat.equal, Hash.hash);
  transient let unused = HashMap.HashMap<Principal, (Nat, Nat)>(16, Principal.equal, Principal.hash);
  transient var use_percent : Nat = 100;
  transient var fail_increase : Bool = false;

  func self() : Principal = Principal.fromActor(this);

  func principalToSubaccount(p : Principal) : Blob {
    let pa = Principal.toBlob(p);
    let size = pa.size();
    let arr_size = if (size < 31) { 31 } else { size };
    let a = Array.init<Nat8>(arr_size + 1, 0);
    a[0] := Nat8.fromNat(size);
    var pos = 1;
    for (x in pa.vals()) { a[pos] := x; pos += 1 };
    Blob.fromArray(Array.freeze(a));
  };

  func ledgerOf(token : Text) : ?(Ledger, Nat) {
    if (token == Principal.toText(init.token0)) { ?(actor (token) : Ledger, 0) }
    else if (token == Principal.toText(init.token1)) { ?(actor (token) : Ledger, 1) }
    else { null };
  };

  func getUnused(p : Principal) : (Nat, Nat) {
    switch (unused.get(p)) { case (?u) u; case null (0, 0) };
  };

  func addUnused(p : Principal, side : Nat, amount : Nat) {
    let (a, b) = getUnused(p);
    unused.put(p, if (side == 0) { (a + amount, b) } else { (a, b + amount) });
  };

  func subUnused(p : Principal, side : Nat, amount : Nat) : Bool {
    let (a, b) = getUnused(p);
    if (side == 0) { if (a < amount) { return false }; unused.put(p, (a - amount, b)) }
    else { if (b < amount) { return false }; unused.put(p, (a, b - amount)) };
    true;
  };

  // ---- ICPSwap-shaped interface ----

  public query func metadata() : async { #ok : { token0 : { address : Text; standard : Text }; token1 : { address : Text; standard : Text }; fee : Nat; key : Text; sqrtPriceX96 : Nat; tick : Int; liquidity : Nat; maxLiquidityPerTick : Nat; nextPositionId : Nat }; #err : Error } {
    #ok({
      token0 = { address = Principal.toText(init.token0); standard = "ICRC1" };
      token1 = { address = Principal.toText(init.token1); standard = "ICRC1" };
      fee = init.fee;
      key = Principal.toText(init.token0) # "_" # Principal.toText(init.token1) # "_" # Nat.toText(init.fee);
      sqrtPriceX96 = 79228162514264337593543950336;
      tick = 0;
      liquidity = 0;
      maxLiquidityPerTick = 0;
      nextPositionId = positions.size() + 1;
    });
  };

  public query func getUserPositionIdsByPrincipal(p : Principal) : async { #ok : [Nat]; #err : Error } {
    let ids = Iter.toArray(Iter.map<(Nat, Position), Nat>(Iter.filter<(Nat, Position)>(positions.entries(), func((_, pos)) { pos.owner == p }), func((id, _)) { id }));
    #ok(Array.sort<Nat>(ids, Nat.compare));
  };

  public query func getUserPosition(positionId : Nat) : async { #ok : { tokensOwed0 : Nat; tokensOwed1 : Nat; liquidity : Nat; feeGrowthInside0LastX128 : Nat; feeGrowthInside1LastX128 : Nat; tickLower : Int; tickUpper : Int }; #err : Error } {
    switch (positions.get(positionId)) {
      case (?p) { #ok({ tokensOwed0 = p.owed0; tokensOwed1 = p.owed1; liquidity = p.liquidity; feeGrowthInside0LastX128 = 0; feeGrowthInside1LastX128 = 0; tickLower = -100; tickUpper = 100 }) };
      case null { #err(#InternalError("position not found")) };
    };
  };

  public shared ({ caller }) func transferPosition(from : Principal, to : Principal, positionId : Nat) : async { #ok : Bool; #err : Error } {
    switch (positions.get(positionId)) {
      case null { #err(#InternalError("position not found")) };
      case (?p) {
        if (caller != from or p.owner != from) { return #err(#InternalError("caller does not own the position")) };
        p.owner := to;
        #ok(true);
      };
    };
  };

  public query func getUserUnusedBalance(p : Principal) : async { #ok : { balance0 : Nat; balance1 : Nat }; #err : Error } {
    let (a, b) = getUnused(p);
    #ok({ balance0 = a; balance1 = b });
  };

  public shared ({ caller }) func claimToSubaccount(args : { positionId : Nat; subaccount : Blob }) : async { #ok : { amount0 : Nat; amount1 : Nat }; #err : Error } {
    let p = switch (positions.get(args.positionId)) { case (?p) p; case null { return #err(#InternalError("position not found")) } };
    if (p.owner != caller) { return #err(#InternalError("caller does not own the position")) };
    let amount0 = p.owed0; let amount1 = p.owed1;
    p.owed0 := 0; p.owed1 := 0;
    let to : Account = { owner = caller; subaccount = ?args.subaccount };
    for ((token, side, amount) in [(init.token0, 0, amount0), (init.token1, 1, amount1)].vals()) {
      if (amount > 0) {
        let ledger : Ledger = actor (Principal.toText(token));
        let fee = await ledger.icrc1_fee();
        if (amount > fee) {
          switch (await ledger.icrc1_transfer({ from_subaccount = null; to; amount = amount - fee; fee = ?fee; memo = null; created_at_time = null })) {
            case (#Ok(_)) {};
            case (#Err(e)) { return #err(#InternalError("delivery failed: " # debug_show(e))) };
          };
        } else {
          addUnused(caller, side, amount);
        };
      };
    };
    #ok({ amount0; amount1 });
  };

  public shared ({ caller }) func deposit(args : { token : Text; amount : Nat; fee : Nat }) : async { #ok : Nat; #err : Error } {
    let (ledger, side) = switch (ledgerOf(args.token)) { case (?x) x; case null { return #err(#UnsupportedToken(args.token)) } };
    if (args.amount <= args.fee) { return #err(#InsufficientFunds) };
    let from_sub = principalToSubaccount(caller);
    let held = await ledger.icrc1_balance_of({ owner = self(); subaccount = ?from_sub });
    if (held < args.amount) { return #err(#InsufficientFunds) };
    let credited = args.amount - args.fee;
    switch (await ledger.icrc1_transfer({ from_subaccount = ?from_sub; to = { owner = self(); subaccount = null }; amount = credited; fee = ?args.fee; memo = null; created_at_time = null })) {
      case (#Ok(_)) {};
      case (#Err(e)) { return #err(#InternalError("deposit transfer failed: " # debug_show(e))) };
    };
    addUnused(caller, side, credited);
    #ok(credited);
  };

  public shared ({ caller }) func increaseLiquidity(args : { positionId : Nat; amount0Desired : Text; amount1Desired : Text }) : async { #ok : Nat; #err : Error } {
    if (fail_increase) { return #err(#InternalError("increase refused by test configuration")) };
    let p = switch (positions.get(args.positionId)) { case (?p) p; case null { return #err(#InternalError("position not found")) } };
    if (p.owner != caller) { return #err(#InternalError("caller does not own the position")) };
    let (u0, u1) = getUnused(caller);
    let d0 = parseNat(args.amount0Desired); let d1 = parseNat(args.amount1Desired);
    let use0 = Nat.min(d0, u0) * use_percent / 100;
    let use1 = Nat.min(d1, u1) * use_percent / 100;
    ignore subUnused(caller, 0, use0);
    ignore subUnused(caller, 1, use1);
    p.liquidity += use0 + use1;
    #ok(args.positionId);
  };

  public shared ({ caller }) func withdrawToSubaccount(args : { token : Text; amount : Nat; fee : Nat; subaccount : Blob }) : async { #ok : Nat; #err : Error } {
    let (ledger, side) = switch (ledgerOf(args.token)) { case (?x) x; case null { return #err(#UnsupportedToken(args.token)) } };
    if (args.amount <= args.fee) { return #err(#InsufficientFunds) };
    if (not subUnused(caller, side, args.amount)) { return #err(#InsufficientFunds) };
    let delivered = args.amount - args.fee;
    switch (await ledger.icrc1_transfer({ from_subaccount = null; to = { owner = caller; subaccount = ?args.subaccount }; amount = delivered; fee = ?args.fee; memo = null; created_at_time = null })) {
      case (#Ok(_)) { #ok(delivered) };
      case (#Err(e)) { addUnused(caller, side, args.amount); #err(#InternalError("withdraw transfer failed: " # debug_show(e))) };
    };
  };

  func parseNat(t : Text) : Nat {
    var n = 0;
    for (c in t.chars()) {
      let d = Nat32.toNat(Char.toNat32(c));
      if (d >= 48 and d <= 57) { n := n * 10 + (d - 48) };
    };
    n;
  };

  // ---- test helpers ----

  public shared func mint_position(owner : Principal, positionId : Nat, liquidity : Nat) : async () {
    positions.put(positionId, { var owner; var liquidity; var owed0 = 0; var owed1 = 0 });
  };
  public shared func set_tokens_owed(positionId : Nat, owed0 : Nat, owed1 : Nat) : async () {
    switch (positions.get(positionId)) { case (?p) { p.owed0 := owed0; p.owed1 := owed1 }; case null {} };
  };
  public shared func set_use_percent(p : Nat) : async () { use_percent := p };
  public shared func set_fail_increase(f : Bool) : async () { fail_increase := f };
  public query func position_owner(positionId : Nat) : async ?Principal {
    switch (positions.get(positionId)) { case (?p) ?p.owner; case null null };
  };
  public query func position_liquidity(positionId : Nat) : async ?Nat {
    switch (positions.get(positionId)) { case (?p) ?p.liquidity; case null null };
  };
};
