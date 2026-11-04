// Proof by payment (spec/diamond_club_icrc7.md §3.3.1): reading one payment from an allow-listed
// ledger, and refunding it. The ledger is read by this canister itself, so the payment cannot be
// faked by the caller; it is only as honest as the ledger, which is why ledgers are allow-listed.
//
// - ICRC-3 ledgers (SNEED, ckBTC, ...): icrc3_get_blocks, archives followed. A plain transfer only:
//   btype "1xfer", or a legacy block whose tx.op is "xfer", with no `spender`. A transfer made with
//   an ICRC-2 approval is refused: the approved spender, not the key holder, would have made it.
//   The sender is the block's ICRC-1 account.
// - The ICP ledger: query_blocks (archives followed). A Transfer with no spender. The sender is an
//   account identifier, which cannot be turned back into a principal; it does not need to be: an
//   EXT holder *is* an account identifier, so the cards are those whose bearer is exactly that
//   identifier, and the refund goes back to it with the ledger's `transfer`.
//
// Every call is a bounded-wait call, so a ledger that never answers cannot hold the canister up.
// Refunds are deduplicated by the ledger: every attempt for a payment sends the same arguments
// (amount, fee, memo, created_at_time), so a retry after an unknown outcome cannot pay twice.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Error "mo:base/Error";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";

import T "Types";

module {
  public type Account = T.Account;
  public let TIMEOUT : Nat32 = 30; // seconds, for every ledger and archive call

  public type Payment = { sender : T.Sender; amount : Nat; ts : Nat };

  // ---- ICRC-3 ledgers ----
  type Value = T.Value;
  type BlocksArgs = [{ start : Nat; length : Nat }];
  type BlocksResult = {
    blocks : [{ id : Nat; block : Value }];
    archived_blocks : [{ args : BlocksArgs; callback : shared query BlocksArgs -> async BlocksResult }];
  };
  type Icrc3Ledger = actor { icrc3_get_blocks : shared query BlocksArgs -> async BlocksResult };

  // ---- the ICP ledger (only the fields read here) ----
  type Tokens = { e8s : Nat64 };
  type IcpOperation = {
    #Mint : {};
    #Burn : {};
    #Approve : {};
    #Transfer : { from : Blob; to : Blob; amount : Tokens; spender : ?[Nat8] };
  };
  type IcpBlock = { transaction : { operation : ?IcpOperation }; timestamp : { timestamp_nanos : Nat64 } };
  type IcpBlocksArgs = { start : Nat64; length : Nat64 };
  type IcpArchiveResult = { #Ok : { blocks : [IcpBlock] }; #Err : { #BadFirstBlockIndex : {}; #Other : {} } };
  type IcpQueryBlocksResponse = {
    blocks : [IcpBlock];
    first_block_index : Nat64;
    archived_blocks : [{ start : Nat64; length : Nat64; callback : shared query IcpBlocksArgs -> async IcpArchiveResult }];
  };
  type IcpLedger = actor { query_blocks : shared query IcpBlocksArgs -> async IcpQueryBlocksResponse };

  // ---- fees and refunds ----
  public type Icrc1TransferError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  type Icrc1 = actor {
    icrc1_fee : shared query () -> async Nat;
    icrc1_transfer : shared ({ from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : Icrc1TransferError };
  };
  public type IcpTransferError = {
    #BadFee : { expected_fee : Tokens }; #InsufficientFunds : { balance : Tokens }; #TxTooOld : { allowed_window_nanos : Nat64 };
    #TxCreatedInFuture; #TxDuplicate : { duplicate_of : Nat64 };
  };
  type IcpTransfer = actor {
    transfer : shared ({ memo : Nat64; amount : Tokens; fee : Tokens; from_subaccount : ?Blob; to : Blob; created_at_time : ?{ timestamp_nanos : Nat64 } }) -> async { #Ok : Nat64; #Err : IcpTransferError };
  };

  func field(v : Value, name : Text) : ?Value {
    switch (v) {
      case (#Map entries) { for ((k, x) in entries.vals()) if (k == name) return ?x; null };
      case _ null;
    };
  };
  func textOf(v : ?Value) : ?Text { switch (v) { case (?#Text t) ?t; case _ null } };
  func natOf(v : ?Value) : ?Nat { switch (v) { case (?#Nat n) ?n; case _ null } };
  func accountOf(v : ?Value) : ?Account {
    let ?#Array(parts) = v else return null;
    if (parts.size() == 0 or parts.size() > 2) return null;
    let #Blob(owner) = parts[0] else return null;
    if (owner.size() > 29) return null;
    if (parts.size() == 1) return ?{ owner = Principal.fromBlob(owner); subaccount = null };
    let #Blob(sub) = parts[1] else return null;
    if (sub.size() != 32) return null;
    ?{ owner = Principal.fromBlob(owner); subaccount = ?sub };
  };

  /// A subaccount of 32 zero bytes is the default account, the same as none.
  public func normSub(s : ?Blob) : ?Blob {
    switch (s) {
      case null null;
      case (?b) { for (x in b.vals()) { if (x != 0) { return ?b } }; null };
    };
  };
  public func sameAccount(a : Account, b : Account) : Bool = a.owner == b.owner and normSub(a.subaccount) == normSub(b.subaccount);

  func icrc3Block(ledger : Principal, index : Nat) : async* ?Value {
    let l : Icrc3Ledger = actor (Principal.toText(ledger));
    let args = [{ start = index; length = 1 }];
    let r = await (with timeout = TIMEOUT) l.icrc3_get_blocks(args);
    for (b in r.blocks.vals()) if (b.id == index) return ?b.block;
    for (a in r.archived_blocks.vals()) {
      let ar = await (with timeout = TIMEOUT) a.callback(a.args);
      for (b in ar.blocks.vals()) if (b.id == index) return ?b.block;
    };
    null;
  };

  func icpBlock(ledger : Principal, index : Nat) : async* ?IcpBlock {
    let l : IcpLedger = actor (Principal.toText(ledger));
    let args = { start = Nat64.fromNat(index); length = 1 : Nat64 };
    let r = await (with timeout = TIMEOUT) l.query_blocks(args);
    if (r.blocks.size() > 0 and Nat64.toNat(r.first_block_index) == index) return ?r.blocks[0];
    for (a in r.archived_blocks.vals()) {
      if (Nat64.toNat(a.start) <= index and index < Nat64.toNat(a.start + a.length)) {
        switch (await (with timeout = TIMEOUT) a.callback(args)) {
          case (#Ok { blocks }) if (blocks.size() > 0) return ?blocks[0];
          case _ {};
        };
      };
    };
    null;
  };

  /// Reads block `index` of `ledger` and checks it is a plain transfer to `to` (ICRC-3) or to the
  /// account identifier `toAid` (ICP). Returns its sender and amount.
  public func readPayment(kind : T.LedgerKind, ledger : Principal, index : Nat, to : Account, toAid : Blob) : async* { #ok : Payment; #err : Text } {
    let at = "Block " # Nat.toText(index);
    try {
      switch kind {
        case (#icp) {
          let ?b = await* icpBlock(ledger, index) else return #err("The ledger has no block " # Nat.toText(index));
          switch (b.transaction.operation) {
            case (?#Transfer t) {
              if (t.spender != null) return #err(at # " was made with an approval (transfer_from): only a transfer the holder made themself counts");
              if (t.to != toAid) return #err(at # " was not sent to this recipient's proof address");
              if (t.from.size() != 32) return #err(at # " has no valid sender");
              #ok({ sender = #account_id(t.from); amount = Nat64.toNat(t.amount.e8s); ts = Nat64.toNat(b.timestamp.timestamp_nanos) });
            };
            case _ #err(at # " is not a transfer");
          };
        };
        case (#icrc3) {
          let ?b = await* icrc3Block(ledger, index) else return #err("The ledger has no block " # Nat.toText(index));
          let ?tx = field(b, "tx") else return #err(at # " is not a transfer");
          let btype = textOf(field(b, "btype"));
          let xfer = btype == ?"1xfer" or btype == ?"2xfer" or (btype == null and textOf(field(tx, "op")) == ?"xfer");
          if (not xfer) return #err(at # " is not a transfer");
          if (btype == ?"2xfer" or field(tx, "spender") != null) return #err(at # " was made with an approval (transfer_from): only a transfer the holder made themself counts");
          let ?f = accountOf(field(tx, "from")) else return #err(at # " has no valid sender");
          let ?t = accountOf(field(tx, "to")) else return #err(at # " has no valid recipient");
          let ?amount = natOf(field(tx, "amt")) else return #err(at # " has no amount");
          if (not sameAccount(t, to)) return #err(at # " was not sent to this recipient's proof address");
          let ts = switch (natOf(field(b, "ts"))) { case (?x) x; case null 0 };
          #ok({ sender = #account({ owner = f.owner; subaccount = normSub(f.subaccount) }); amount; ts });
        };
      };
    } catch (e) {
      #err("Could not read the ledger: " # Error.message(e));
    };
  };

  public func fee(ledger : Principal) : async* { #ok : Nat; #err : Text } {
    let l : Icrc1 = actor (Principal.toText(ledger));
    try { #ok(await (with timeout = TIMEOUT) l.icrc1_fee()) } catch (e) { #err("Could not read the ledger fee: " # Error.message(e)) };
  };

  public type RefundOutcome = {
    #done : Nat; // the refund's block (also when the ledger reports it as a duplicate of an earlier attempt)
    #failed : Text; // nothing was paid, or the outcome is unknown: retry with the same arguments
    #needs_admin : Text; // the ledger will not take these arguments again
  };

  /// One refund attempt. `memo` is 32 bytes; the ICP ledger takes its first 8 as the Nat64 memo.
  public func refund(kind : T.LedgerKind, ledger : Principal, fromSub : Blob, to : T.Sender, amount : Nat, fee_ : Nat, memo : Blob, createdAt : Nat64) : async* RefundOutcome {
    switch (kind, to) {
      case (#icrc3, #account(acct)) {
        let l : Icrc1 = actor (Principal.toText(ledger));
        let r = try {
          await (with timeout = TIMEOUT) l.icrc1_transfer({ from_subaccount = ?fromSub; to = acct; amount; fee = ?fee_; memo = ?memo; created_at_time = ?createdAt });
        } catch (e) { return #failed("Outcome unknown (" # Error.message(e) # "); retrying sends the same transfer, which the ledger deduplicates") };
        switch r {
          case (#Ok i) #done(i);
          case (#Err(#Duplicate { duplicate_of })) #done(duplicate_of);
          case (#Err(#TooOld)) #needs_admin("The ledger refuses the refund as too old (its deduplication window has passed): check the ledger for an earlier refund before resetting it");
          case (#Err(#BadFee { expected_fee })) #needs_admin("The ledger fee changed to " # Nat.toText(expected_fee) # ": check the ledger for an earlier refund before resetting it");
          case (#Err(e)) #failed(debug_show e);
        };
      };
      case (#icp, #account_id(aid)) {
        let l : IcpTransfer = actor (Principal.toText(ledger));
        let m = Blob.toArray(memo);
        var memo64 : Nat64 = 0;
        for (i in Array.tabulate<Nat>(8, func(i) = i).vals()) memo64 := memo64 * 256 + Nat64.fromNat(Nat8.toNat(m[i]));
        let r = try {
          await (with timeout = TIMEOUT) l.transfer({ memo = memo64; amount = { e8s = Nat64.fromNat(amount) }; fee = { e8s = Nat64.fromNat(fee_) }; from_subaccount = ?fromSub; to = aid; created_at_time = ?{ timestamp_nanos = createdAt } });
        } catch (e) { return #failed("Outcome unknown (" # Error.message(e) # "); retrying sends the same transfer, which the ledger deduplicates") };
        switch r {
          case (#Ok i) #done(Nat64.toNat(i));
          case (#Err(#TxDuplicate { duplicate_of })) #done(Nat64.toNat(duplicate_of));
          case (#Err(#TxTooOld _)) #needs_admin("The ledger refuses the refund as too old (its deduplication window has passed): check the ledger for an earlier refund before resetting it");
          case (#Err(#BadFee { expected_fee })) #needs_admin("The ledger fee changed to " # Nat64.toText(expected_fee.e8s) # ": check the ledger for an earlier refund before resetting it");
          case (#Err(e)) #failed(debug_show e);
        };
      };
      case _ #needs_admin("The payment's sender does not match the ledger kind");
    };
  };
};
