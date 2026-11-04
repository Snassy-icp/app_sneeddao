/// Test double for an ICRC-1 ledger with an ICRC-3 block log, for sneed_nft's proof by payment:
/// test helpers write the blocks a user's wallet would (plain transfers, legacy "op" blocks,
/// transfers made with an approval, approvals), icrc3_get_blocks serves them (the ones below
/// `archived_upto` through an archive callback), and icrc1_transfer (the refund) moves balances,
/// deduplicates like the real ledger (same caller and arguments with created_at_time) and can be
/// made to fail: an error, a trap (outcome unknown to the caller), or a trap *after* the transfer
/// was recorded (the outcome the caller cannot see, then a retry the ledger must deduplicate).
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Int "mo:base/Int";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Time "mo:base/Time";

persistent actor class MockProofLedger() = this {
  type Account = { owner : Principal; subaccount : ?Blob };
  type Value = { #Blob : Blob; #Text : Text; #Nat : Nat; #Int : Int; #Array : [Value]; #Map : [(Text, Value)] };
  type TransferArgs = { from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 };
  type TransferError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  type BlocksArgs = [{ start : Nat; length : Nat }];
  type BlocksResult = {
    log_length : Nat;
    blocks : [{ id : Nat; block : Value }];
    archived_blocks : [{ args : BlocksArgs; callback : shared query BlocksArgs -> async BlocksResult }];
  };
  type Mode = { #ok; #error; #trap; #trap_after };

  var blocks : [Value] = [];
  var archived_upto : Nat = 0;
  var balances : [(Account, Nat)] = [];
  var fee : Nat = 10_000;
  var mode : Mode = #ok;
  var seen : [(Principal, TransferArgs, Nat)] = []; // deduplication: (caller, args, block)
  var refunds : [(Principal, TransferArgs, Nat)] = []; // every icrc1_transfer recorded

  func norm(s : ?Blob) : ?Blob {
    switch (s) { case null null; case (?b) { for (x in b.vals()) if (x != 0) return ?b; null } };
  };
  func same(a : Account, b : Account) : Bool = a.owner == b.owner and norm(a.subaccount) == norm(b.subaccount);
  func balance(a : Account) : Nat {
    for ((k, v) in balances.vals()) if (same(k, a)) return v;
    0;
  };
  func setBalance(a : Account, v : Nat) {
    balances := Array.append(Array.filter<(Account, Nat)>(balances, func((k, _)) = not same(k, a)), [(a, v)]);
  };
  func acct(a : Account) : Value {
    switch (a.subaccount) { case (?s) #Array([#Blob(Principal.toBlob(a.owner)), #Blob(s)]); case null #Array([#Blob(Principal.toBlob(a.owner))]) };
  };
  func now() : Nat = Int.abs(Time.now());
  func push(b : Value) : Nat {
    blocks := Array.append(blocks, [b]);
    blocks.size() - 1;
  };
  func xferBlock(btype : ?Text, from : Account, to : Account, amount : Nat, spender : ?Account) : Value {
    let tx = Buffer.Buffer<(Text, Value)>(5);
    if (btype == null) tx.add(("op", #Text("xfer")));
    tx.add(("from", acct(from)));
    tx.add(("to", acct(to)));
    tx.add(("amt", #Nat(amount)));
    switch (spender) { case (?s) tx.add(("spender", acct(s))); case null {} };
    let fields = Buffer.Buffer<(Text, Value)>(4);
    switch (btype) { case (?t) fields.add(("btype", #Text(t))); case null {} };
    fields.add(("ts", #Nat(now())));
    fields.add(("fee", #Nat(fee)));
    fields.add(("tx", #Map(Buffer.toArray(tx))));
    #Map(Buffer.toArray(fields));
  };

  // ---- what a user's wallet does (test helpers): blocks with the real ledger's shapes ----
  /// a plain transfer (btype 1xfer); credits `to`
  public shared func test_transfer(from : Account, to : Account, amount : Nat) : async Nat {
    setBalance(to, balance(to) + amount);
    push(xferBlock(?"1xfer", from, to, amount, null));
  };
  /// the same as a legacy block (no btype, tx.op = "xfer")
  public shared func test_transfer_legacy(from : Account, to : Account, amount : Nat) : async Nat {
    setBalance(to, balance(to) + amount);
    push(xferBlock(null, from, to, amount, null));
  };
  /// a transfer made by an approved spender (btype 2xfer, with `spender`)
  public shared func test_transfer_from(from : Account, to : Account, spender : Account, amount : Nat) : async Nat {
    setBalance(to, balance(to) + amount);
    push(xferBlock(?"2xfer", from, to, amount, ?spender));
  };
  public shared func test_approve(from : Account, spender : Account) : async Nat {
    push(#Map([("btype", #Text("2approve")), ("ts", #Nat(now())), ("tx", #Map([("from", acct(from)), ("spender", acct(spender)), ("amt", #Nat(1))]))]));
  };
  public shared func set_mode(m : Mode) : async () { mode := m };
  public shared func set_fee(f : Nat) : async () { fee := f };
  public shared func set_archived_upto(n : Nat) : async () { archived_upto := n };
  public query func balance_of(a : Account) : async Nat { balance(a) };
  public query func get_refunds() : async [(Principal, TransferArgs, Nat)] { refunds };

  // ---- ICRC-1 ----
  public query func icrc1_fee() : async Nat { fee };
  public query func icrc1_balance_of(a : Account) : async Nat { balance(a) };

  public shared ({ caller }) func icrc1_transfer(args : TransferArgs) : async { #Ok : Nat; #Err : TransferError } {
    switch (mode) {
      case (#error) return #Err(#TemporarilyUnavailable);
      case (#trap) assert false;
      case _ {};
    };
    if (args.created_at_time != null) {
      for ((c, a, i) in seen.vals()) if (c == caller and a == args) return #Err(#Duplicate({ duplicate_of = i }));
      switch (args.created_at_time) {
        case (?t) if (Nat64.toNat(t) + 86_400_000_000_000 + 120_000_000_000 < now()) return #Err(#TooOld);
        case null {};
      };
    };
    switch (args.fee) { case (?f) if (f != fee) return #Err(#BadFee({ expected_fee = fee })); case null {} };
    let from : Account = { owner = caller; subaccount = args.from_subaccount };
    let have = balance(from);
    if (have < args.amount + fee) return #Err(#InsufficientFunds({ balance = have }));
    setBalance(from, have - args.amount - fee);
    setBalance(args.to, balance(args.to) + args.amount);
    let i = push(xferBlock(?"1xfer", from, args.to, args.amount, null));
    if (args.created_at_time != null) seen := Array.append(seen, [(caller, args, i)]);
    refunds := Array.append(refunds, [(caller, args, i)]);
    if (mode == #trap_after) {
      // the transfer is recorded, but the reply is lost (a trap after a self-call commits it)
      await wait();
      assert false;
    };
    #Ok(i);
  };
  public shared func wait() : async () {};

  // ---- ICRC-3 ----
  func range(start : Nat, length : Nat, from : Nat, upto : Nat) : [{ id : Nat; block : Value }] {
    let s = if (start < from) from else start;
    let e = if (start + length > upto) upto else start + length;
    if (s >= e) return [];
    Array.tabulate<{ id : Nat; block : Value }>(e - s, func(i) = { id = s + i; block = blocks[s + i] });
  };
  public query func icrc3_get_blocks(args : BlocksArgs) : async BlocksResult {
    let live = Buffer.Buffer<{ id : Nat; block : Value }>(4);
    let old = Buffer.Buffer<{ start : Nat; length : Nat }>(1);
    for (a in args.vals()) {
      for (b in range(a.start, a.length, archived_upto, blocks.size()).vals()) live.add(b);
      if (a.start < archived_upto) old.add({ start = a.start; length = if (a.start + a.length > archived_upto) archived_upto - a.start else a.length });
    };
    {
      log_length = blocks.size();
      blocks = Buffer.toArray(live);
      archived_blocks = if (old.size() == 0) [] else [{ args = Buffer.toArray(old); callback = archive_get_blocks }];
    };
  };
  public query func archive_get_blocks(args : BlocksArgs) : async BlocksResult {
    let out = Buffer.Buffer<{ id : Nat; block : Value }>(4);
    for (a in args.vals()) for (b in range(a.start, a.length, 0, archived_upto).vals()) out.add(b);
    { log_length = blocks.size(); blocks = Buffer.toArray(out); archived_blocks = [] };
  };
};
