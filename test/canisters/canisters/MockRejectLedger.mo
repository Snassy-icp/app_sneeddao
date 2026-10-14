/// Minimal ICRC-1 ledger whose `icrc1_transfer` can answer with a reject
/// (Error.reject, reject code CANISTER_REJECT) instead of a reply: before
/// moving the tokens (the transfer did not happen) or after (it did, and the
/// caller cannot tell). Used to drive the reward loop's claim incident path.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Error "mo:base/Error";
import HashMap "mo:base/HashMap";
import Principal "mo:base/Principal";
import Text "mo:base/Text";

persistent actor class MockRejectLedger(init : { fee : Nat; symbol : Text; decimals : Nat8 }) {
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type TransferArgs = { from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  public type Mode = { #normal; #reject_before; #reject_after };
  public type Tx = { from : Account; to : Account; amount : Nat; memo : ?Blob };

  transient let balances = HashMap.HashMap<Text, Nat>(16, Text.equal, Text.hash);
  transient let txs = Buffer.Buffer<Tx>(16);
  transient var mode : Mode = #normal;

  func key(a : Account) : Text {
    let zero = Blob.fromArray(Array.freeze(Array.init<Nat8>(32, 0)));
    let sub = switch (a.subaccount) { case (?s) { if (s == zero) "" else debug_show (s) }; case null "" };
    Principal.toText(a.owner) # "|" # sub;
  };
  func balance(a : Account) : Nat { switch (balances.get(key(a))) { case (?b) b; case null 0 } };

  public query func icrc1_name() : async Text { init.symbol # " reject mock" };
  public query func icrc1_symbol() : async Text { init.symbol };
  public query func icrc1_fee() : async Nat { init.fee };
  public query func icrc1_decimals() : async Nat8 { init.decimals };
  public query func icrc1_balance_of(a : Account) : async Nat { balance(a) };

  public shared ({ caller }) func icrc1_transfer(args : TransferArgs) : async { #Ok : Nat; #Err : TransferError } {
    if (mode == #reject_before) { throw Error.reject("ledger rejected the call") };
    let from : Account = { owner = caller; subaccount = args.from_subaccount };
    let b = balance(from);
    if (b < args.amount + init.fee) { return #Err(#InsufficientFunds({ balance = b })) };
    balances.put(key(from), b - args.amount - init.fee);
    balances.put(key(args.to), balance(args.to) + args.amount);
    txs.add({ from; to = args.to; amount = args.amount; memo = args.memo });
    if (mode == #reject_after) { throw Error.reject("ledger rejected the reply") };
    #Ok(txs.size() - 1);
  };

  // ---- test helpers ----
  public shared func mint(to : Account, amount : Nat) : async () { balances.put(key(to), balance(to) + amount) };
  public shared func set_mode(m : Mode) : async () { mode := m };
  public query func get_transactions() : async [Tx] { Buffer.toArray(txs) };
};
