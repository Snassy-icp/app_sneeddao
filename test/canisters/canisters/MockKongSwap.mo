/// Mock of the KongSwap backend as the trading bot uses it: `swap_amounts`
/// quotes from a rate table the test fills with `set_rate`, `swap` (ICRC-1
/// path: the bot transfers the input to this canister first and passes the
/// block index) pays the output from this canister's own balance on the output
/// ledger. `set_slippage` sets the price impact the quote reports (percent),
/// `set_swap_bps` makes execution pay a fraction of the quote, `set_fail`
/// refuses swaps after the input has been taken.
import Buffer "mo:base/Buffer";
import Float "mo:base/Float";
import HashMap "mo:base/HashMap";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Text "mo:base/Text";

persistent actor class MockKongSwap() = this {

  public type Account = { owner : Principal; subaccount : ?Blob };
  public type SwapTx = { pay_address : Text; pay_amount : Nat; receive_address : Text; receive_amount : Nat; lp_fee : Nat };
  public type SwapAmountsReply = { pay_amount : Nat; receive_amount : Nat; mid_price : Float; price : Float; slippage : Float; txs : [SwapTx] };
  public type SwapArgs = { pay_token : Text; pay_amount : Nat; receive_token : Text; receive_amount : ?Nat; receive_address : ?Text; pay_tx_id : ?{ #BlockIndex : Nat }; max_slippage : ?Float; referred_by : ?Text };
  public type SwapReply = { tx_id : Nat64; pay_amount : Nat; receive_amount : Nat; status : Text; mid_price : Float; price : Float; slippage : Float };
  public type Swap = { caller : Principal; pay_token : Text; pay_amount : Nat; receive_token : Text; receive_amount : Nat; pay_tx_id : ?Nat };

  type Ledger = actor {
    icrc1_transfer : ({ from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : { #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat }; #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text } } };
    icrc1_fee : () -> async Nat;
  };

  transient let rates = HashMap.HashMap<Text, (Nat, Nat)>(8, Text.equal, Text.hash); // "pay>receive" -> (num, den)
  transient var slippage_pct : Float = 0.0;
  transient var swap_bps : Nat = 10_000;
  transient var fail_swap : Bool = false;
  transient var next_tx : Nat64 = 1;
  transient let swaps = Buffer.Buffer<Swap>(8);

  func key(pay : Text, receive : Text) : Text = pay # ">" # receive;

  public query func swap_amounts(pay_token : Text, pay_amount : Nat, receive_token : Text) : async { #Ok : SwapAmountsReply; #Err : Text } {
    switch (rates.get(key(pay_token, receive_token))) {
      case null { #Err("Pool not found: " # pay_token # " -> " # receive_token) };
      case (?(n, d)) {
        let receive = pay_amount * n / d;
        let price = Float.fromInt(n) / Float.fromInt(d);
        #Ok({ pay_amount; receive_amount = receive; mid_price = price; price; slippage = slippage_pct; txs = [{ pay_address = pay_token; pay_amount; receive_address = receive_token; receive_amount = receive; lp_fee = 0 }] });
      };
    };
  };

  public shared ({ caller }) func swap(args : SwapArgs) : async { #Ok : SwapReply; #Err : Text } {
    let (n, d) = switch (rates.get(key(args.pay_token, args.receive_token))) { case (?r) r; case null { return #Err("Pool not found") } };
    if (fail_swap) { return #Err("swap refused by test configuration") };
    let receive = args.pay_amount * n / d * swap_bps / 10_000;
    switch (args.receive_amount) { case (?min) { if (receive < min) { return #Err("Slippage exceeded: " # Nat.toText(receive) # " < " # Nat.toText(min)) } }; case null {} };
    let ledger : Ledger = actor (args.receive_token);
    let fee = await ledger.icrc1_fee();
    switch (await ledger.icrc1_transfer({ from_subaccount = null; to = { owner = caller; subaccount = null }; amount = receive; fee = ?fee; memo = null; created_at_time = null })) {
      case (#Ok(_)) {};
      case (#Err(e)) { return #Err("output delivery failed: " # debug_show(e)) };
    };
    let tx_id = next_tx; next_tx += 1;
    swaps.add({ caller; pay_token = args.pay_token; pay_amount = args.pay_amount; receive_token = args.receive_token; receive_amount = receive; pay_tx_id = switch (args.pay_tx_id) { case (?#BlockIndex(i)) ?i; case null null } });
    let price = Float.fromInt(n) / Float.fromInt(d);
    #Ok({ tx_id; pay_amount = args.pay_amount; receive_amount = receive; status = "Success"; mid_price = price; price; slippage = slippage_pct });
  };

  // ---- test helpers ----

  /// receive per pay = num / den (one direction; set both for a two-way market)
  public shared func set_rate(pay : Principal, receive : Principal, n : Nat, d : Nat) : async () {
    rates.put(key(Principal.toText(pay), Principal.toText(receive)), (n, d));
  };
  public shared func clear_rates() : async () { for (k in rates.keys()) { rates.delete(k) } };
  public shared func set_slippage(pct : Float) : async () { slippage_pct := pct };
  public shared func set_swap_bps(bps : Nat) : async () { swap_bps := bps };
  public shared func set_fail(f : Bool) : async () { fail_swap := f };
  public query func get_swaps() : async [Swap] { Buffer.toArray(swaps) };
};
