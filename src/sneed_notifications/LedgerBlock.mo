/// Reads one block of the ICP ledger (query_blocks, with its archives) or of an ICRC-3 ledger and
/// checks it moved tokens from one account to another: a plain transfer or a transfer_from (an
/// approval's spender may have made it). For admin_credit (spec/support_audit.md P0-8).
import Principal "mo:base/Principal";
import Nat64 "mo:base/Nat64";
import Error "mo:base/Error";
import Donations "../app_sneeddao_backend/Donations";

module {
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type Transfer = { amount : Nat; ts : Nat; by_approval : Bool };

  public let ICP_LEDGER : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";

  // ---- the ICP ledger (query_blocks); only the fields read here are declared ----
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

  func icpBlock(ledger : Principal, index : Nat) : async* ?IcpBlock {
    let l : IcpLedger = actor (Principal.toText(ledger));
    let args = { start = Nat64.fromNat(index); length = 1 : Nat64 };
    let r = await l.query_blocks(args);
    if (r.blocks.size() > 0 and Nat64.toNat(r.first_block_index) == index) return ?r.blocks[0];
    for (a in r.archived_blocks.vals()) {
      if (Nat64.toNat(a.start) <= index and index < Nat64.toNat(a.start + a.length)) {
        switch (await a.callback(args)) {
          case (#Ok { blocks }) if (blocks.size() > 0) return ?blocks[0];
          case _ {};
        };
      };
    };
    null;
  };

  // ---- ICRC-3 ledgers ----
  type Value = Donations.Value;
  type BlocksArgs = [{ start : Nat; length : Nat }];
  type BlocksResult = {
    blocks : [{ id : Nat; block : Value }];
    archived_blocks : [{ args : BlocksArgs; callback : shared query BlocksArgs -> async BlocksResult }];
  };
  type Icrc3Ledger = actor { icrc3_get_blocks : shared query BlocksArgs -> async BlocksResult };

  func icrc3Block(ledger : Principal, index : Nat) : async* ?Value {
    let l : Icrc3Ledger = actor (Principal.toText(ledger));
    let args = [{ start = index; length = 1 }];
    let r = await l.icrc3_get_blocks(args);
    for (b in r.blocks.vals()) if (b.id == index) return ?b.block;
    for (a in r.archived_blocks.vals()) {
      let ar = await a.callback(a.args);
      for (b in ar.blocks.vals()) if (b.id == index) return ?b.block;
    };
    null;
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
    ?{ owner = Principal.fromBlob(owner); subaccount = ?sub };
  };

  /// Reads block `index` of `ledger` and checks it is a transfer from `from` to `to`.
  public func verifyTransfer(ledger : Principal, index : Nat, from : Account, to : Account) : async* { #ok : Transfer; #err : Text } {
    let at = "Block " # debug_show index;
    try {
      if (Principal.toText(ledger) == ICP_LEDGER) {
        let ?b = await* icpBlock(ledger, index) else return #err("The ledger has no block " # debug_show index);
        switch (b.transaction.operation) {
          case (?#Transfer t) {
            if (t.from != Donations.accountIdentifier(from)) return #err(at # " was not sent from that principal's account");
            if (t.to != Donations.accountIdentifier(to)) return #err(at # " was not sent to this canister");
            #ok({ amount = Nat64.toNat(t.amount.e8s); ts = Nat64.toNat(b.timestamp.timestamp_nanos); by_approval = t.spender != null });
          };
          case _ #err(at # " is not a transfer");
        };
      } else {
        let ?b = await* icrc3Block(ledger, index) else return #err("The ledger has no block " # debug_show index);
        let ?tx = field(b, "tx") else return #err(at # " is not a transfer");
        if (textOf(field(tx, "op")) != ?"xfer" and textOf(field(b, "btype")) != ?"1xfer" and textOf(field(b, "btype")) != ?"2xfer") return #err(at # " is not a transfer");
        let ?f = accountOf(field(tx, "from")) else return #err(at # " is not a transfer");
        let ?t = accountOf(field(tx, "to")) else return #err(at # " is not a transfer");
        let ?amount = natOf(field(tx, "amt")) else return #err(at # " is not a transfer");
        if (not Donations.sameAccount(f, from)) return #err(at # " was not sent from that principal's account");
        if (not Donations.sameAccount(t, to)) return #err(at # " was not sent to this canister");
        let ts = switch (natOf(field(b, "ts"))) { case (?x) x; case null 0 };
        #ok({ amount; ts; by_approval = field(tx, "spender") != null });
      };
    } catch (e) {
      #err("Could not read the ledger: " # Error.message(e));
    };
  };
};
