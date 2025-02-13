export const idlFactory = ({ IDL }) => {
    const TxIndex = IDL.Nat;
    const Balance = IDL.Nat;
    const Timestamp = IDL.Nat64;
    const TransferError = IDL.Variant({
      'GenericError' : IDL.Record({
        'message' : IDL.Text,
        'error_code' : IDL.Nat,
      }),
      'TemporarilyUnavailable' : IDL.Null,
      'BadBurn' : IDL.Record({ 'min_burn_amount' : Balance }),
      'Duplicate' : IDL.Record({ 'duplicate_of' : TxIndex }),
      'BadFee' : IDL.Record({ 'expected_fee' : Balance }),
      'CreatedInFuture' : IDL.Record({ 'ledger_time' : Timestamp }),
      'TooOld' : IDL.Null,
      'InsufficientFunds' : IDL.Record({ 'balance' : Balance }),
    });
    const TransferResult = IDL.Variant({ 'Ok' : TxIndex, 'Err' : TransferError });
    const ProposalId = IDL.Record({ 'id' : IDL.Nat64 });
    const NeuronId = IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) });
    return IDL.Service({
      'balance_of' : IDL.Func(
          [IDL.Principal, IDL.Principal],
          [IDL.Nat],
          ['query'],
        ),
      'balances_of_hotkey' : IDL.Func(
          [],
          [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat))],
          [],
        ),
      'claim_full_balance_of_hotkey' : IDL.Func(
          [IDL.Principal, IDL.Nat],
          [TransferResult],
          [],
        ),
    });
  };
  export const init = ({ IDL }) => { return []; };