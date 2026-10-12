/// Minimal ICRC-1 ledger for tests: fee-charging transfers between accounts
/// (owner + optional subaccount), a free `mint`, and a transaction record so
/// tests can assert what moved. Not a real ledger: no dedup, no time checks.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import HashMap "mo:base/HashMap";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";

shared ({ caller = deployer }) persistent actor class MockLedger(init : { fee : Nat; symbol : Text; decimals : Nat8 }) = this {

  public type Account = { owner : Principal; subaccount : ?Blob };
  public type TransferArgs = {
    from_subaccount : ?Blob;
    to : Account;
    amount : Nat;
    fee : ?Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
  };
  public type TransferError = {
    #BadFee : { expected_fee : Nat };
    #BadBurn : { min_burn_amount : Nat };
    #InsufficientFunds : { balance : Nat };
    #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError : { error_code : Nat; message : Text };
  };
  public type TransferResult = { #Ok : Nat; #Err : TransferError };
  public type Tx = { index : Nat; from : Account; to : Account; amount : Nat; fee : Nat };

  transient var fee : Nat = init.fee;
  transient let balances = HashMap.HashMap<Text, Nat>(64, Text.equal, Text.hash);
  transient let txs = Buffer.Buffer<Tx>(64);
  transient var paused : Bool = false;

  func key(a : Account) : Text {
    let sub = switch (a.subaccount) {
      case null { Blob.fromArray(Array.freeze(Array.init<Nat8>(32, 0))) };
      case (?s) { s };
    };
    let zero = Blob.fromArray(Array.freeze(Array.init<Nat8>(32, 0)));
    Principal.toText(a.owner) # "|" # (if (sub == zero) { "" } else { debug_show(sub) });
  };

  func balance(a : Account) : Nat {
    switch (balances.get(key(a))) { case (?b) b; case null 0 };
  };

  public query func icrc1_fee() : async Nat { fee };
  public query func icrc1_symbol() : async Text { init.symbol };
  public query func icrc1_name() : async Text { init.symbol # " mock" };
  public query func icrc1_decimals() : async Nat8 { init.decimals };
  public query func icrc1_balance_of(a : Account) : async Nat { balance(a) };
  public query func icrc1_metadata() : async [(Text, { #Nat : Nat; #Int : Int; #Text : Text; #Blob : Blob })] {
    [("icrc1:symbol", #Text(init.symbol)), ("icrc1:name", #Text(init.symbol # " mock")), ("icrc1:decimals", #Nat(Nat8.toNat(init.decimals))), ("icrc1:fee", #Nat(fee))];
  };

  public shared ({ caller }) func icrc1_transfer(args : TransferArgs) : async TransferResult {
    if (paused) { return #Err(#TemporarilyUnavailable) };
    switch (args.fee) {
      case (?f) { if (f != fee) { return #Err(#BadFee({ expected_fee = fee })) } };
      case null {};
    };
    let from : Account = { owner = caller; subaccount = args.from_subaccount };
    let b = balance(from);
    if (b < args.amount + fee) { return #Err(#InsufficientFunds({ balance = b })) };
    balances.put(key(from), b - args.amount - fee);
    balances.put(key(args.to), balance(args.to) + args.amount);
    let index = txs.size();
    txs.add({ index; from; to = args.to; amount = args.amount; fee });
    #Ok(index);
  };

  // ---- ICRC-2: approvals and transfer_from (owner-level, default subaccount only) ----
  public type ApproveArgs = { from_subaccount : ?Blob; spender : Account; amount : Nat; expected_allowance : ?Nat; expires_at : ?Nat64; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferFromArgs = { spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferFromError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #InsufficientAllowance : { allowance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  transient let allowances = HashMap.HashMap<Text, Nat>(16, Text.equal, Text.hash);
  func allowanceKey(owner : Account, spender : Account) : Text { key(owner) # ">" # key(spender) };

  public shared ({ caller }) func icrc2_approve(args : ApproveArgs) : async { #Ok : Nat; #Err : TransferError } {
    let from : Account = { owner = caller; subaccount = args.from_subaccount };
    let b = balance(from);
    if (b < fee) { return #Err(#InsufficientFunds({ balance = b })) };
    balances.put(key(from), b - fee);
    allowances.put(allowanceKey(from, args.spender), args.amount);
    let index = txs.size();
    txs.add({ index; from; to = from; amount = 0; fee });
    #Ok(index);
  };
  public query func icrc2_allowance(args : { account : Account; spender : Account }) : async { allowance : Nat; expires_at : ?Nat64 } {
    { allowance = switch (allowances.get(allowanceKey(args.account, args.spender))) { case (?a) a; case null 0 }; expires_at = null };
  };
  public shared ({ caller }) func icrc2_transfer_from(args : TransferFromArgs) : async { #Ok : Nat; #Err : TransferFromError } {
    if (paused) { return #Err(#TemporarilyUnavailable) };
    let spender : Account = { owner = caller; subaccount = args.spender_subaccount };
    let k = allowanceKey(args.from, spender);
    let allowance = switch (allowances.get(k)) { case (?a) a; case null 0 };
    if (allowance < args.amount + fee) { return #Err(#InsufficientAllowance({ allowance })) };
    let b = balance(args.from);
    if (b < args.amount + fee) { return #Err(#InsufficientFunds({ balance = b })) };
    balances.put(key(args.from), b - args.amount - fee);
    balances.put(key(args.to), balance(args.to) + args.amount);
    allowances.put(k, allowance - args.amount - fee);
    let index = txs.size();
    txs.add({ index; from = args.from; to = args.to; amount = args.amount; fee });
    #Ok(index);
  };

  // ---- test helpers ----

  public shared func mint(to : Account, amount : Nat) : async Nat {
    balances.put(key(to), balance(to) + amount);
    let index = txs.size();
    txs.add({ index; from = { owner = Principal.fromActor(this); subaccount = null }; to; amount; fee = 0 });
    index;
  };

  public shared func set_fee(f : Nat) : async () { fee := f };
  public shared func set_paused(p : Bool) : async () { paused := p };
  public query func get_transactions() : async [Tx] { Buffer.toArray(txs) };
};
