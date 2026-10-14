/// Mock of the ICPSwap pool surface the trading bot swaps through: `quote`,
/// `depositAndSwap` (ICRC-1 path: the bot first transfers to its subaccount on
/// the pool), `depositFromAndSwap` (ICRC-2 path: the bot approves the pool),
/// `metadata`, and the `deposit` / `getUserUnusedBalance` / `withdraw` trio the
/// bot's `recoverPoolFunds` uses. Token movements go through the mock ledgers.
///
/// Price: a constant rate `num/den` of token1 per token0 (inverse the other
/// way). `set_swap_bps` makes execution pay a fraction of the quoted output so
/// slippage protection can be tested; `set_fail` makes swaps fail after the
/// deposit, leaving the input in the caller's unused balance (as ICPSwap does).
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import HashMap "mo:base/HashMap";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Char "mo:base/Char";
import Principal "mo:base/Principal";

shared ({ caller = deployer }) persistent actor class MockDexPool(init : { token0 : Principal; token1 : Principal }) = this {

  public type Account = { owner : Principal; subaccount : ?Blob };
  public type Error = { #CommonError; #InternalError : Text; #UnsupportedToken : Text; #InsufficientFunds };
  public type SwapArgs = { amountIn : Text; zeroForOne : Bool; amountOutMinimum : Text; tokenInFee : Nat; tokenOutFee : Nat };
  public type Swap = { caller : Principal; zeroForOne : Bool; amountIn : Nat; amountOut : Nat; path : Text };

  type TransferError = { #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat }; #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text } };
  type Ledger = actor {
    icrc1_balance_of : (Account) -> async Nat;
    icrc1_transfer : ({ from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : TransferError };
    icrc2_transfer_from : ({ spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : { #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat }; #InsufficientAllowance : { allowance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat }; #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text } } };
  };

  transient var num : Nat = 1;
  transient var den : Nat = 1;
  transient var swap_bps : Nat = 10_000;
  transient var fail_swap : Bool = false;
  transient let unused = HashMap.HashMap<Principal, (Nat, Nat)>(16, Principal.equal, Principal.hash);
  transient let swaps = Buffer.Buffer<Swap>(8);

  func self() : Principal = Principal.fromActor(this);
  func ledger0() : Ledger = actor (Principal.toText(init.token0));
  func ledger1() : Ledger = actor (Principal.toText(init.token1));

  /// The subaccount ICPSwap (and the bot) derive from a principal: length byte, bytes, zero padding to 32.
  func principalToSubaccount(p : Principal) : Blob {
    let bytes = Blob.toArray(Principal.toBlob(p));
    Blob.fromArray(Array.tabulate<Nat8>(32, func(i) { if (i == 0) { Nat8.fromNat(bytes.size()) } else if (i <= bytes.size()) { bytes[i - 1] } else { 0 } }));
  };

  func parseNat(t : Text) : Nat {
    var n = 0;
    for (c in t.chars()) { let d = Nat32.toNat(Char.toNat32(c)); if (d >= 48 and d <= 57) { n := n * 10 + (d - 48) } };
    n;
  };

  func quoteOut(amountIn : Nat, zeroForOne : Bool) : Nat {
    if (zeroForOne) { amountIn * num / den } else { amountIn * den / num };
  };

  func getUnused(p : Principal) : (Nat, Nat) { switch (unused.get(p)) { case (?u) u; case null (0, 0) } };
  func addUnused(p : Principal, side : Nat, amount : Nat) {
    let (a, b) = getUnused(p);
    unused.put(p, if (side == 0) { (a + amount, b) } else { (a, b + amount) });
  };
  func subUnused(p : Principal, side : Nat, amount : Nat) : Bool {
    let (a, b) = getUnused(p);
    if (side == 0) { if (a < amount) { return false }; unused.put(p, (a - amount, b)) } else { if (b < amount) { return false }; unused.put(p, (a, b - amount)) };
    true;
  };
  func sideOf(token : Text) : ?Nat {
    if (token == Principal.toText(init.token0)) { ?0 } else if (token == Principal.toText(init.token1)) { ?1 } else { null };
  };
  func ledgerOf(side : Nat) : Ledger = if (side == 0) { ledger0() } else { ledger1() };

  // ---- ICPSwap-shaped interface ----

  public query func metadata() : async { #ok : { sqrtPriceX96 : Nat; token0 : { address : Text; standard : Text }; token1 : { address : Text; standard : Text }; fee : Nat; key : Text; tick : Int; liquidity : Nat; maxLiquidityPerTick : Nat; nextPositionId : Nat }; #err : Error } {
    #ok({
      sqrtPriceX96 = 79228162514264337593543950336;
      token0 = { address = Principal.toText(init.token0); standard = "ICRC1" };
      token1 = { address = Principal.toText(init.token1); standard = "ICRC1" };
      fee = 3000; key = ""; tick = 0; liquidity = 0; maxLiquidityPerTick = 0; nextPositionId = 1;
    });
  };

  public shared func quote(args : { amountIn : Text; zeroForOne : Bool; amountOutMinimum : Text }) : async { #ok : Nat; #err : Error } {
    #ok(quoteOut(parseNat(args.amountIn), args.zeroForOne));
  };

  /// After the input sits in the caller's unused balance: swap it and deliver the output.
  func swapFromUnused(caller : Principal, args : SwapArgs, path : Text) : async* { #ok : Nat; #err : Error } {
    let amountIn = parseNat(args.amountIn);
    let inSide = if (args.zeroForOne) { 0 } else { 1 };
    let outSide = 1 - inSide;
    if (fail_swap) { return #err(#InternalError("swap refused by test configuration")) };
    let out = quoteOut(amountIn, args.zeroForOne) * swap_bps / 10_000;
    if (out < parseNat(args.amountOutMinimum)) { return #err(#InternalError("slippage: output " # Nat.toText(out) # " below minimum " # args.amountOutMinimum)) };
    if (not subUnused(caller, inSide, amountIn)) { return #err(#InsufficientFunds) };
    if (out <= args.tokenOutFee) { return #err(#InternalError("output below withdrawal fee")) };
    switch (await ledgerOf(outSide).icrc1_transfer({ from_subaccount = null; to = { owner = caller; subaccount = null }; amount = out - args.tokenOutFee; fee = ?args.tokenOutFee; memo = null; created_at_time = null })) {
      case (#Ok(_)) {};
      case (#Err(e)) { addUnused(caller, inSide, amountIn); return #err(#InternalError("output delivery failed: " # debug_show(e))) };
    };
    swaps.add({ caller; zeroForOne = args.zeroForOne; amountIn; amountOut = out; path });
    #ok(out);
  };

  /// ICRC-1 path: the caller already transferred `amountIn + tokenInFee` to its subaccount on this pool.
  public shared ({ caller }) func depositAndSwap(args : SwapArgs) : async { #ok : Nat; #err : Error } {
    let amountIn = parseNat(args.amountIn);
    let inSide = if (args.zeroForOne) { 0 } else { 1 };
    let sub = principalToSubaccount(caller);
    let held = await ledgerOf(inSide).icrc1_balance_of({ owner = self(); subaccount = ?sub });
    if (held < amountIn + args.tokenInFee) { return #err(#InsufficientFunds) };
    switch (await ledgerOf(inSide).icrc1_transfer({ from_subaccount = ?sub; to = { owner = self(); subaccount = null }; amount = amountIn; fee = ?args.tokenInFee; memo = null; created_at_time = null })) {
      case (#Ok(_)) {};
      case (#Err(e)) { return #err(#InternalError("deposit failed: " # debug_show(e))) };
    };
    addUnused(caller, inSide, amountIn);
    await* swapFromUnused(caller, args, "icrc1");
  };

  /// ICRC-2 path: the caller approved this pool for `amountIn + tokenInFee`.
  public shared ({ caller }) func depositFromAndSwap(args : SwapArgs) : async { #ok : Nat; #err : Error } {
    let amountIn = parseNat(args.amountIn);
    let inSide = if (args.zeroForOne) { 0 } else { 1 };
    switch (await ledgerOf(inSide).icrc2_transfer_from({ spender_subaccount = null; from = { owner = caller; subaccount = null }; to = { owner = self(); subaccount = null }; amount = amountIn; fee = ?args.tokenInFee; memo = null; created_at_time = null })) {
      case (#Ok(_)) {};
      case (#Err(e)) { return #err(#InternalError("transfer_from failed: " # debug_show(e))) };
    };
    addUnused(caller, inSide, amountIn);
    await* swapFromUnused(caller, args, "icrc2");
  };

  public query func getUserUnusedBalance(p : Principal) : async { #ok : { balance0 : Nat; balance1 : Nat }; #err : Error } {
    let (a, b) = getUnused(p);
    #ok({ balance0 = a; balance1 = b });
  };

  public shared ({ caller }) func deposit(args : { token : Text; amount : Nat; fee : Nat }) : async { #ok : Nat; #err : Error } {
    let side = switch (sideOf(args.token)) { case (?s) s; case null { return #err(#UnsupportedToken(args.token)) } };
    if (args.amount <= args.fee) { return #err(#InsufficientFunds) };
    let sub = principalToSubaccount(caller);
    let held = await ledgerOf(side).icrc1_balance_of({ owner = self(); subaccount = ?sub });
    if (held < args.amount) { return #err(#InsufficientFunds) };
    let credited = args.amount - args.fee;
    switch (await ledgerOf(side).icrc1_transfer({ from_subaccount = ?sub; to = { owner = self(); subaccount = null }; amount = credited; fee = ?args.fee; memo = null; created_at_time = null })) {
      case (#Ok(_)) {};
      case (#Err(e)) { return #err(#InternalError("deposit transfer failed: " # debug_show(e))) };
    };
    addUnused(caller, side, credited);
    #ok(credited);
  };

  public shared ({ caller }) func withdraw(args : { token : Text; amount : Nat; fee : Nat }) : async { #ok : Nat; #err : Error } {
    let side = switch (sideOf(args.token)) { case (?s) s; case null { return #err(#UnsupportedToken(args.token)) } };
    if (args.amount <= args.fee) { return #err(#InsufficientFunds) };
    if (not subUnused(caller, side, args.amount)) { return #err(#InsufficientFunds) };
    let delivered = args.amount - args.fee;
    switch (await ledgerOf(side).icrc1_transfer({ from_subaccount = null; to = { owner = caller; subaccount = null }; amount = delivered; fee = ?args.fee; memo = null; created_at_time = null })) {
      case (#Ok(_)) { #ok(delivered) };
      case (#Err(e)) { addUnused(caller, side, args.amount); #err(#InternalError("withdraw transfer failed: " # debug_show(e))) };
    };
  };

  // ---- test helpers ----

  /// token1 per token0 = num / den
  public shared func set_rate(n : Nat, d : Nat) : async () { num := n; den := d };
  /// Execution pays this fraction (in bps) of the quoted output.
  public shared func set_swap_bps(bps : Nat) : async () { swap_bps := bps };
  public shared func set_fail(f : Bool) : async () { fail_swap := f };
  public query func get_swaps() : async [Swap] { Buffer.toArray(swaps) };
};
