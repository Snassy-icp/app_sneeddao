/// A stand-in for the ckETH minter (sv3dd-oaaaa-aaaar-qacoa-cai) with the methods Sneed Hub's
/// /convert page calls, in the live minter's Candid shapes. It is the minting account of real
/// ICRC ledgers in the tests (ckETH and one ckERC20): withdraw_eth burns ckETH, withdraw_erc20
/// burns the gas in ckETH and then the token, both with icrc2_transfer_from as the real minter
/// does. Ethereum itself is simulated (test_set_status moves a withdrawal along).
import Array "mo:base/Array";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";

persistent actor class MockCkEthMinter(init : { cketh_ledger : Principal; ckerc20_ledger : Principal; ckerc20_symbol : Text; erc20_address : Text }) = this {
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type CkErc20Token = { ckerc20_token_symbol : Text; erc20_contract_address : Text; ledger_canister_id : Principal };
  public type EthTransaction = { transaction_hash : Text };
  public type TxFinalizedStatus = {
    #Success : { transaction_hash : Text; effective_transaction_fee : ?Nat };
    #Reimbursed : { transaction_hash : Text; reimbursed_amount : Nat; reimbursed_in_block : Nat };
    #PendingReimbursement : EthTransaction;
  };
  public type WithdrawalStatus = { #Pending; #TxCreated; #TxSent : EthTransaction; #TxFinalized : TxFinalizedStatus };
  public type WithdrawalDetail = {
    token_symbol : Text; withdrawal_amount : Nat; max_transaction_fee : ?Nat; withdrawal_id : Nat64;
    from : Principal; from_subaccount : ?Blob; recipient_address : Text; status : WithdrawalStatus;
  };
  public type LedgerError = {
    #InsufficientFunds : { balance : Nat; failed_burn_amount : Nat; token_symbol : Text; ledger_id : Principal };
    #InsufficientAllowance : { allowance : Nat; failed_burn_amount : Nat; token_symbol : Text; ledger_id : Principal };
    #AmountTooLow : { minimum_burn_amount : Nat; failed_burn_amount : Nat; token_symbol : Text; ledger_id : Principal };
    #TemporarilyUnavailable : Text;
  };
  public type WithdrawalError = {
    #AmountTooLow : { min_withdrawal_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #InsufficientAllowance : { allowance : Nat }; #RecipientAddressBlocked : { address : Text }; #TemporarilyUnavailable : Text;
  };
  public type WithdrawErc20Error = {
    #TokenNotSupported : { supported_tokens : [CkErc20Token] }; #RecipientAddressBlocked : { address : Text };
    #CkEthLedgerError : { error : LedgerError }; #CkErc20LedgerError : { cketh_block_index : Nat; error : LedgerError };
    #TemporarilyUnavailable : Text;
  };
  public type Price = { gas_limit : Nat; max_fee_per_gas : Nat; max_priority_fee_per_gas : Nat; max_transaction_fee : Nat; timestamp : ?Nat64 };
  type TransferFromError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #InsufficientAllowance : { allowance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  type Ledger = actor {
    icrc2_transfer_from : ({ spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : TransferFromError };
  };

  let MIN_WITHDRAWAL : Nat = 5_000_000_000_000_000; // 0.005 ETH, as on mainnet
  let MAX_FEE_PER_GAS : Nat = 2_000_000_000;
  let PRIORITY : Nat = 1_500_000_000;
  let BLOCKED = "0x000000000000000000000000000000000000dEaD";

  var withdrawals : [WithdrawalDetail] = [];
  var calls : [Text] = [];
  var gasBump : Nat = 0; // test helper: the gas price rises after the user's estimate
  func log(t : Text) { calls := Array.append(calls, [t]) };

  func token() : CkErc20Token { { ckerc20_token_symbol = init.ckerc20_symbol; erc20_contract_address = init.erc20_address; ledger_canister_id = init.ckerc20_ledger } };
  func price(gasLimit : Nat) : Price {
    let f = MAX_FEE_PER_GAS + gasBump;
    { gas_limit = gasLimit; max_fee_per_gas = f; max_priority_fee_per_gas = PRIORITY; max_transaction_fee = gasLimit * f; timestamp = null };
  };

  public query func get_minter_info() : async {
    minter_address : ?Text; eth_helper_contract_address : ?Text; erc20_helper_contract_address : ?Text;
    deposit_with_subaccount_helper_contract_address : ?Text; supported_ckerc20_tokens : ?[CkErc20Token];
    minimum_withdrawal_amount : ?Nat; last_observed_block_number : ?Nat;
    last_gas_fee_estimate : ?{ max_fee_per_gas : Nat; max_priority_fee_per_gas : Nat; timestamp : Nat64 };
    minimum_deposit_amounts : ?[{ erc20_contract_address : Text; minimum_deposit_amount : Nat }];
    minimum_eth_deposit_amount : ?Nat; cketh_ledger_id : ?Principal;
  } {
    {
      minter_address = ?"0xb25eA1D493B49a1DeD42aC5B1208cC618f9A9B80";
      eth_helper_contract_address = ?"0x7574eB42cA208A4f6960ECCAfDF186D627dCC175";
      erc20_helper_contract_address = ?"0x6abDA0438307733FC299e9C229FD3cc074bD8cC0";
      deposit_with_subaccount_helper_contract_address = ?"0x18901044688D3756C35Ed2b36D93e6a5B8e00E68";
      supported_ckerc20_tokens = ?[token()];
      minimum_withdrawal_amount = ?MIN_WITHDRAWAL;
      last_observed_block_number = ?26_243_072;
      last_gas_fee_estimate = ?{ max_fee_per_gas = MAX_FEE_PER_GAS; max_priority_fee_per_gas = PRIORITY; timestamp = 0 };
      minimum_deposit_amounts = ?[{ erc20_contract_address = init.erc20_address; minimum_deposit_amount = 10_000_000 }];
      minimum_eth_deposit_amount = ?MIN_WITHDRAWAL;
      cketh_ledger_id = ?init.cketh_ledger;
    };
  };

  public query func eip_1559_transaction_price(arg : ?{ ckerc20_ledger_id : Principal }) : async Price {
    switch arg { case null price(21_000); case (?_) price(65_000) };
  };

  public query func is_address_blocked(a : Text) : async Bool { a == BLOCKED };

  func burn(ledgerId : Principal, from : Account, amount : Nat) : async { #Ok : Nat; #Err : TransferFromError } {
    let l : Ledger = actor (Principal.toText(ledgerId));
    await l.icrc2_transfer_from({ spender_subaccount = null; from; to = { owner = Principal.fromActor(this); subaccount = null }; amount; fee = null; memo = null; created_at_time = null });
  };

  public shared ({ caller }) func withdraw_eth(arg : { recipient : Text; amount : Nat; from_subaccount : ?Blob }) : async { #Ok : { block_index : Nat }; #Err : WithdrawalError } {
    log("withdraw_eth");
    if (arg.recipient == BLOCKED) return #Err(#RecipientAddressBlocked({ address = arg.recipient }));
    if (arg.amount < MIN_WITHDRAWAL) return #Err(#AmountTooLow({ min_withdrawal_amount = MIN_WITHDRAWAL }));
    let from : Account = { owner = caller; subaccount = arg.from_subaccount };
    switch (await burn(init.cketh_ledger, from, arg.amount)) {
      case (#Ok(b)) {
        withdrawals := Array.append(withdrawals, [{ token_symbol = "ckETH"; withdrawal_amount = arg.amount; max_transaction_fee = ?price(21_000).max_transaction_fee; withdrawal_id = Nat64.fromNat(b); from = caller; from_subaccount = arg.from_subaccount; recipient_address = arg.recipient; status = #Pending }]);
        #Ok({ block_index = b });
      };
      case (#Err(#InsufficientAllowance({ allowance }))) #Err(#InsufficientAllowance({ allowance }));
      case (#Err(#InsufficientFunds({ balance }))) #Err(#InsufficientFunds({ balance }));
      case (#Err(_)) #Err(#TemporarilyUnavailable("ledger error"));
    };
  };

  func ledgerError(e : TransferFromError, amount : Nat, symbol : Text, id : Principal) : LedgerError {
    switch e {
      case (#InsufficientAllowance({ allowance })) #InsufficientAllowance({ allowance; failed_burn_amount = amount; token_symbol = symbol; ledger_id = id });
      case (#InsufficientFunds({ balance })) #InsufficientFunds({ balance; failed_burn_amount = amount; token_symbol = symbol; ledger_id = id });
      case (_) #TemporarilyUnavailable("ledger error");
    };
  };

  public shared ({ caller }) func withdraw_erc20(arg : { amount : Nat; ckerc20_ledger_id : Principal; recipient : Text; from_cketh_subaccount : ?Blob; from_ckerc20_subaccount : ?Blob }) : async { #Ok : { cketh_block_index : Nat; ckerc20_block_index : Nat }; #Err : WithdrawErc20Error } {
    log("withdraw_erc20");
    if (arg.ckerc20_ledger_id != init.ckerc20_ledger) return #Err(#TokenNotSupported({ supported_tokens = [token()] }));
    if (arg.recipient == BLOCKED) return #Err(#RecipientAddressBlocked({ address = arg.recipient }));
    let gas = price(65_000).max_transaction_fee;
    let ethBurn = await burn(init.cketh_ledger, { owner = caller; subaccount = arg.from_cketh_subaccount }, gas);
    let ethBlock = switch ethBurn { case (#Ok(b)) b; case (#Err(e)) return #Err(#CkEthLedgerError({ error = ledgerError(e, gas, "ckETH", init.cketh_ledger) })) };
    switch (await burn(init.ckerc20_ledger, { owner = caller; subaccount = arg.from_ckerc20_subaccount }, arg.amount)) {
      case (#Ok(b)) {
        withdrawals := Array.append(withdrawals, [{ token_symbol = init.ckerc20_symbol; withdrawal_amount = arg.amount; max_transaction_fee = ?gas; withdrawal_id = Nat64.fromNat(ethBlock); from = caller; from_subaccount = arg.from_ckerc20_subaccount; recipient_address = arg.recipient; status = #Pending }]);
        #Ok({ cketh_block_index = ethBlock; ckerc20_block_index = b });
      };
      case (#Err(e)) #Err(#CkErc20LedgerError({ cketh_block_index = ethBlock; error = ledgerError(e, arg.amount, init.ckerc20_symbol, init.ckerc20_ledger) }));
    };
  };

  public query func withdrawal_status(p : { #ByRecipient : Text; #BySenderAccount : Account; #ByWithdrawalId : Nat64 }) : async [WithdrawalDetail] {
    Array.filter<WithdrawalDetail>(withdrawals, func(w) = switch p {
      case (#ByRecipient(r)) w.recipient_address == r;
      case (#BySenderAccount(a)) w.from == a.owner and w.from_subaccount == a.subaccount;
      case (#ByWithdrawalId(i)) w.withdrawal_id == i;
    });
  };

  public shared ({ caller }) func deposit_eth(_ : { mode : { #Unsponsored : { subaccount : ?Blob } } }) : async {
    #Ok : { address : Text; minimum_deposit_amount : Nat; status : { #Scanning : { valid_until : Nat64; last_scanned_block : ?Nat; scan_count : Nat64 }; #AwaitingSweep : { scanned_balance : Nat; detected_at_block : Nat } } };
    #Err : { #TooManyTokensForAccount; #TooManyActiveDeposits; #TemporarilyUnavailable : Text };
  } {
    log("deposit_eth");
    ignore caller;
    #Ok({ address = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"; minimum_deposit_amount = MIN_WITHDRAWAL; status = #Scanning({ valid_until = 1_800_000_000_000_000_000; last_scanned_block = null; scan_count = 0 }) });
  };

  // ---- test helpers ----
  public func test_set_status(id : Nat64, s : WithdrawalStatus) : async () {
    withdrawals := Array.map<WithdrawalDetail, WithdrawalDetail>(withdrawals, func(w) = if (w.withdrawal_id == id) { { w with status = s } } else w);
  };
  public func test_bump_gas(by : Nat) : async () { gasBump := by };
  public query func test_calls() : async [Text] { calls };
};
