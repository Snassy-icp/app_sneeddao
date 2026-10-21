/// The MockLedger (ICRC-1/ICRC-2 with subaccounts, a free `mint`, a
/// transaction record) plus failure rules, so tests can make one specific
/// transfer of a multi-step payment fail and watch the rollback:
///   set_fail_to(owners)        transfers TO any of these owners fail
///   set_fail_from_main(owners) transfers FROM the default (main) account of
///                              any of these owners fail
///   set_reject_to(accounts)    transfers TO exactly these accounts are
///                              rejected (Error.reject: the call throws at the
///                              caller) and move nothing
///   set_hold_to(owners)        transfers TO any of these owners wait (a
///                              self-call per round) until the rule is lifted
/// Failed transfers answer GenericError and move nothing. Used by the
/// sneedapp tests at the real ICP ledger id.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import HashMap "mo:base/HashMap";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Error "mo:base/Error";

shared ({ caller = deployer }) persistent actor class MockLedgerFaulty(init : { fee : Nat; symbol : Text; decimals : Nat8 }) = this {

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
  transient var failTo : [Principal] = [];
  transient var failFromMain : [Principal] = [];
  transient var rejectTo : [Account] = [];
  transient var holdTo : [Principal] = [];

  func zeroSub() : Blob { Blob.fromArray(Array.freeze(Array.init<Nat8>(32, 0))) };

  func key(a : Account) : Text {
    let sub = switch (a.subaccount) { case null { zeroSub() }; case (?s) { s } };
    Principal.toText(a.owner) # "|" # (if (sub == zeroSub()) { "" } else { debug_show(sub) });
  };

  func balance(a : Account) : Nat {
    switch (balances.get(key(a))) { case (?b) b; case null 0 };
  };

  func isMain(sub : ?Blob) : Bool {
    switch (sub) { case null { true }; case (?s) { s == zeroSub() } };
  };

  func blocked(from : Account, to : Account) : Bool {
    if (Array.find<Principal>(failTo, func(p) { p == to.owner }) != null) { return true };
    if (isMain(from.subaccount) and Array.find<Principal>(failFromMain, func(p) { p == from.owner }) != null) { return true };
    false;
  };

  public query func icrc1_fee() : async Nat { fee };
  public query func icrc1_symbol() : async Text { init.symbol };
  public query func icrc1_name() : async Text { init.symbol # " mock" };
  public query func icrc1_decimals() : async Nat8 { init.decimals };
  public query func icrc1_balance_of(a : Account) : async Nat { balance(a) };
  public query func icrc1_metadata() : async [(Text, { #Nat : Nat; #Int : Int; #Text : Text; #Blob : Blob })] {
    [("icrc1:symbol", #Text(init.symbol)), ("icrc1:name", #Text(init.symbol # " mock")), ("icrc1:decimals", #Nat(Nat8.toNat(init.decimals))), ("icrc1:fee", #Nat(fee))];
  };

  public shared func wait_round() : async () {};

  public shared ({ caller }) func icrc1_transfer(args : TransferArgs) : async TransferResult {
    while (Array.find<Principal>(holdTo, func(p) { p == args.to.owner }) != null) { await wait_round() };
    if (Array.find<Account>(rejectTo, func(a) { key(a) == key(args.to) }) != null) { throw Error.reject("mock: transfer rejected by rule") };
    if (paused) { return #Err(#TemporarilyUnavailable) };
    switch (args.fee) {
      case (?f) { if (f != fee) { return #Err(#BadFee({ expected_fee = fee })) } };
      case null {};
    };
    let from : Account = { owner = caller; subaccount = args.from_subaccount };
    if (blocked(from, args.to)) { return #Err(#GenericError({ error_code = 99; message = "mock: transfer refused by rule" })) };
    let b = balance(from);
    if (b < args.amount + fee) { return #Err(#InsufficientFunds({ balance = b })) };
    balances.put(key(from), b - args.amount - fee);
    balances.put(key(args.to), balance(args.to) + args.amount);
    let index = txs.size();
    txs.add({ index; from; to = args.to; amount = args.amount; fee });
    #Ok(index);
  };

  // ---- ICRC-2: approvals and transfer_from ----
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
  public shared func set_fail_to(owners : [Principal]) : async () { failTo := owners };
  public shared func set_fail_from_main(owners : [Principal]) : async () { failFromMain := owners };
  public shared func set_reject_to(accounts : [Account]) : async () { rejectTo := accounts };
  public shared func set_hold_to(owners : [Principal]) : async () { holdTo := owners };
  public query func get_transactions() : async [Tx] { Buffer.toArray(txs) };
};
