/// A stand-in for the ckBTC minter (mqygn-kiaaa-aaaar-qaadq-cai) with the methods Sneed Hub's
/// /convert page calls, in the live minter's Candid shapes. It is the minting account of a real
/// ICRC ledger in the tests: update_balance mints with icrc1_transfer, retrieve_btc_with_approval
/// burns with icrc2_transfer_from, exactly as the real minter does. Bitcoin itself is simulated:
/// tests add deposits (test_add_utxo) and move withdrawals along (test_set_status).
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";

persistent actor class MockCkBtcMinter(init : { ledger : Principal }) = this {
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type Utxo = { outpoint : { txid : [Nat8]; vout : Nat32 }; value : Nat64; height : Nat32 };
  public type PendingUtxo = { outpoint : { txid : [Nat8]; vout : Nat32 }; value : Nat64; confirmations : Nat32 };
  public type SuspendedUtxo = { utxo : Utxo; reason : { #ValueTooSmall; #Quarantined }; earliest_retry : Nat64 };
  public type UtxoStatus = {
    #ValueTooSmall : Utxo; #Tainted : Utxo; #Checked : Utxo;
    #Minted : { block_index : Nat64; minted_amount : Nat64; utxo : Utxo };
  };
  public type UpdateBalanceError = {
    #NoNewUtxos : { current_confirmations : ?Nat32; required_confirmations : Nat32; pending_utxos : ?[PendingUtxo]; suspended_utxos : ?[SuspendedUtxo] };
    #AlreadyProcessing; #TemporarilyUnavailable : Text; #GenericError : { error_message : Text; error_code : Nat64 };
  };
  public type RetrieveBtcWithApprovalError = {
    #MalformedAddress : Text; #AlreadyProcessing; #AmountTooLow : Nat64; #InsufficientFunds : { balance : Nat64 };
    #InsufficientAllowance : { allowance : Nat64 }; #TemporarilyUnavailable : Text; #GenericError : { error_message : Text; error_code : Nat64 };
  };
  public type ReimbursementReason = { #CallFailed; #TaintedDestination : { kyt_fee : Nat64; kyt_provider : Principal } };
  public type RetrieveBtcStatusV2 = {
    #Unknown; #Pending; #Signing; #Sending : { txid : Blob }; #Submitted : { txid : Blob }; #AmountTooLow; #Confirmed : { txid : Blob };
    #Reimbursed : { account : Account; mint_block_index : Nat64; amount : Nat64; reason : ReimbursementReason };
    #WillReimburse : { account : Account; amount : Nat64; reason : ReimbursementReason };
  };
  type TransferError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  type TransferFromError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #InsufficientAllowance : { allowance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  type Ledger = actor {
    icrc1_transfer : ({ from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : TransferError };
    icrc2_transfer_from : ({ spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : TransferFromError };
  };
  transient let ledger : Ledger = actor (Principal.toText(init.ledger));

  let MIN_CONFIRMATIONS : Nat32 = 4;
  let RETRIEVE_MIN : Nat64 = 50_000;
  let CHECK_FEE : Nat64 = 100;

  // deposits: (owner text, utxo, confirmations, minted)
  var utxos : [(Text, Utxo, Nat32, Bool)] = [];
  // withdrawals: (block index, account, address, amount, status)
  var requests : [(Nat64, Account, Text, Nat64, RetrieveBtcStatusV2)] = [];
  // every call made, for the tests to assert the sequence
  var calls : [Text] = [];
  func log(t : Text) { calls := Array.append(calls, [t]) };

  public query func get_minter_info() : async { min_confirmations : Nat32; retrieve_btc_min_amount : Nat64; kyt_fee : Nat64; deposit_btc_min_amount : ?Nat64 } {
    { min_confirmations = MIN_CONFIRMATIONS; retrieve_btc_min_amount = RETRIEVE_MIN; kyt_fee = CHECK_FEE; deposit_btc_min_amount = ?300 };
  };
  public query func get_deposit_fee() : async Nat64 { CHECK_FEE };
  public query func estimate_withdrawal_fee(_ : { amount : ?Nat64 }) : async { bitcoin_fee : Nat64; minter_fee : Nat64 } {
    { bitcoin_fee = 639; minter_fee = 300 };
  };

  func ownerOf(caller : Principal, owner : ?Principal) : Principal { switch owner { case (?o) o; case null caller } };

  public shared ({ caller }) func get_btc_address(arg : { owner : ?Principal; subaccount : ?Blob }) : async Text {
    log("get_btc_address");
    let o = ownerOf(caller, arg.owner);
    // a fixed valid P2WPKH address per owner is enough for the UI; the real one is derived by tECDSA
    if (Principal.isAnonymous(o)) { "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" } else { "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" };
  };

  public query ({ caller }) func get_known_utxos(arg : { owner : ?Principal; subaccount : ?Blob }) : async [Utxo] {
    let o = Principal.toText(ownerOf(caller, arg.owner));
    Array.mapFilter<(Text, Utxo, Nat32, Bool), Utxo>(utxos, func((k, u, _, m)) = if (k == o and m) ?u else null);
  };

  public shared ({ caller }) func update_balance(arg : { owner : ?Principal; subaccount : ?Blob }) : async { #Ok : [UtxoStatus]; #Err : UpdateBalanceError } {
    log("update_balance");
    let owner = ownerOf(caller, arg.owner);
    let o = Principal.toText(owner);
    let out = Buffer.Buffer<UtxoStatus>(4);
    let pending = Buffer.Buffer<PendingUtxo>(4);
    let next = Buffer.Buffer<(Text, Utxo, Nat32, Bool)>(utxos.size());
    for ((k, u, c, minted) in utxos.vals()) {
      if (k != o or minted) { next.add((k, u, c, minted)) }
      else if (c < MIN_CONFIRMATIONS) { pending.add({ outpoint = u.outpoint; value = u.value; confirmations = c }); next.add((k, u, c, false)) }
      else if (u.value <= CHECK_FEE) { out.add(#ValueTooSmall(u)); next.add((k, u, c, true)) }
      else {
        let amount = u.value - CHECK_FEE;
        switch (await ledger.icrc1_transfer({ from_subaccount = null; to = { owner; subaccount = arg.subaccount }; amount = Nat64.toNat(amount); fee = null; memo = null; created_at_time = null })) {
          case (#Ok(b)) { out.add(#Minted({ block_index = Nat64.fromNat(b); minted_amount = amount; utxo = u })); next.add((k, u, c, true)) };
          case (#Err(_)) { out.add(#Checked(u)); next.add((k, u, c, false)) };
        };
      };
    };
    utxos := Buffer.toArray(next);
    if (out.size() == 0) {
      return #Err(#NoNewUtxos({ current_confirmations = null; required_confirmations = MIN_CONFIRMATIONS; pending_utxos = ?Buffer.toArray(pending); suspended_utxos = ?[] }));
    };
    #Ok(Buffer.toArray(out));
  };

  public shared ({ caller }) func retrieve_btc_with_approval(arg : { address : Text; amount : Nat64; from_subaccount : ?Blob }) : async { #Ok : { block_index : Nat64 }; #Err : RetrieveBtcWithApprovalError } {
    log("retrieve_btc_with_approval");
    if (not (Text.startsWith(arg.address, #text "bc1") or Text.startsWith(arg.address, #text "1") or Text.startsWith(arg.address, #text "3"))) {
      return #Err(#MalformedAddress("not a mainnet address"));
    };
    if (arg.amount < RETRIEVE_MIN) { return #Err(#AmountTooLow(RETRIEVE_MIN)) };
    let from : Account = { owner = caller; subaccount = arg.from_subaccount };
    // a burn: transfer_from to the minting account (this canister)
    switch (await ledger.icrc2_transfer_from({ spender_subaccount = null; from; to = { owner = Principal.fromActor(this); subaccount = null }; amount = Nat64.toNat(arg.amount); fee = null; memo = null; created_at_time = null })) {
      case (#Ok(b)) {
        let bi = Nat64.fromNat(b);
        requests := Array.append(requests, [(bi, from, arg.address, arg.amount, #Pending : RetrieveBtcStatusV2)]);
        #Ok({ block_index = bi });
      };
      case (#Err(#InsufficientAllowance({ allowance }))) { #Err(#InsufficientAllowance({ allowance = Nat64.fromNat(allowance) })) };
      case (#Err(#InsufficientFunds({ balance }))) { #Err(#InsufficientFunds({ balance = Nat64.fromNat(balance) })) };
      case (#Err(e)) { #Err(#GenericError({ error_message = debug_show (e); error_code = 1 })) };
    };
  };

  public query func retrieve_btc_status_v2(arg : { block_index : Nat64 }) : async RetrieveBtcStatusV2 {
    for ((b, _, _, _, s) in requests.vals()) { if (b == arg.block_index) return s };
    #Unknown;
  };

  public query ({ caller }) func retrieve_btc_status_v2_by_account(acc : ?Account) : async [{ block_index : Nat64; status_v2 : ?RetrieveBtcStatusV2 }] {
    let a : Account = switch acc { case (?a) a; case null ({ owner = caller; subaccount = null }) };
    Array.mapFilter<(Nat64, Account, Text, Nat64, RetrieveBtcStatusV2), { block_index : Nat64; status_v2 : ?RetrieveBtcStatusV2 }>(requests, func((b, f, _, _, s)) =
      if (f.owner == a.owner and f.subaccount == a.subaccount) ?{ block_index = b; status_v2 = ?s } else null);
  };

  // ---- test helpers ----
  public func test_add_utxo(owner : Principal, value : Nat64, confirmations : Nat32, tag : Nat8) : async () {
    let u : Utxo = { outpoint = { txid = Array.tabulate<Nat8>(32, func(i) = if (i == 0) tag else Nat8.fromNat(i)); vout = 0 }; value; height = 900_000 };
    utxos := Array.append(utxos, [(Principal.toText(owner), u, confirmations, false)]);
  };
  public func test_confirm_all(confirmations : Nat32) : async () {
    utxos := Array.map<(Text, Utxo, Nat32, Bool), (Text, Utxo, Nat32, Bool)>(utxos, func((k, u, _, m)) = (k, u, confirmations, m));
  };
  public func test_set_status(block_index : Nat64, status : RetrieveBtcStatusV2) : async () {
    requests := Array.map<(Nat64, Account, Text, Nat64, RetrieveBtcStatusV2), (Nat64, Account, Text, Nat64, RetrieveBtcStatusV2)>(requests, func(r) = if (r.0 == block_index) (r.0, r.1, r.2, r.3, status) else r);
  };
  public query func test_calls() : async [Text] { calls };
  public query func test_requests() : async [(Nat64, Text, Nat64)] {
    Array.map<(Nat64, Account, Text, Nat64, RetrieveBtcStatusV2), (Nat64, Text, Nat64)>(requests, func((b, _, a, n, _)) = (b, a, n));
  };
};
