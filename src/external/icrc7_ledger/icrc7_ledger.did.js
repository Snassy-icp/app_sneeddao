export const idlFactory = ({ IDL }) => {
  const Value = IDL.Rec();
  const Standard = IDL.Record({ 'url' : IDL.Text, 'name' : IDL.Text });
  const Subaccount = IDL.Vec(IDL.Nat8);
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(Subaccount),
  });
  Value.fill(
    IDL.Variant({
      'Int' : IDL.Int,
      'Map' : IDL.Vec(IDL.Tuple(IDL.Text, Value)),
      'Nat' : IDL.Nat,
      'Blob' : IDL.Vec(IDL.Nat8),
      'Text' : IDL.Text,
      'Array' : IDL.Vec(Value),
    })
  );
  const TransferArg = IDL.Record({
    'to' : Account,
    'token_id' : IDL.Nat,
    'memo' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'from_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'created_at_time' : IDL.Opt(IDL.Nat64),
  });
  const TransferError = IDL.Variant({
    'GenericError' : IDL.Record({
      'message' : IDL.Text,
      'error_code' : IDL.Nat,
    }),
    'Duplicate' : IDL.Record({ 'duplicate_of' : IDL.Nat }),
    'NonExistingTokenId' : IDL.Null,
    'Unauthorized' : IDL.Null,
    'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }),
    'InvalidRecipient' : IDL.Null,
    'GenericBatchError' : IDL.Record({
      'message' : IDL.Text,
      'error_code' : IDL.Nat,
    }),
    'TooOld' : IDL.Null,
  });
  const TransferResult = IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : TransferError });
  const ApprovalInfo = IDL.Record({ 'spender' : Account, 'from_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)), 'expires_at' : IDL.Opt(IDL.Nat64), 'memo' : IDL.Opt(IDL.Vec(IDL.Nat8)), 'created_at_time' : IDL.Nat64 });
  const TokenApproval = IDL.Record({ 'token_id' : IDL.Nat, 'approval_info' : ApprovalInfo });
  const GenericErr = IDL.Record({ 'error_code' : IDL.Nat, 'message' : IDL.Text });
  const ApproveTokenError = IDL.Variant({ 'InvalidSpender' : IDL.Null, 'Unauthorized' : IDL.Null, 'NonExistingTokenId' : IDL.Null, 'TooOld' : IDL.Null, 'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }), 'GenericError' : GenericErr, 'GenericBatchError' : GenericErr });
  const ApproveCollectionError = IDL.Variant({ 'InvalidSpender' : IDL.Null, 'TooOld' : IDL.Null, 'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }), 'GenericError' : GenericErr, 'GenericBatchError' : GenericErr });
  const RevokeTokenApprovalError = IDL.Variant({ 'ApprovalDoesNotExist' : IDL.Null, 'TooOld' : IDL.Null, 'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }), 'NonExistingTokenId' : IDL.Null, 'Unauthorized' : IDL.Null, 'GenericError' : GenericErr, 'GenericBatchError' : GenericErr });
  const RevokeCollectionApprovalError = IDL.Variant({ 'ApprovalDoesNotExist' : IDL.Null, 'TooOld' : IDL.Null, 'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }), 'GenericError' : GenericErr, 'GenericBatchError' : GenericErr });
  const TransferFromError = IDL.Variant({ 'InvalidRecipient' : IDL.Null, 'Unauthorized' : IDL.Null, 'NonExistingTokenId' : IDL.Null, 'TooOld' : IDL.Null, 'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }), 'Duplicate' : IDL.Record({ 'duplicate_of' : IDL.Nat }), 'GenericError' : GenericErr, 'GenericBatchError' : GenericErr });
  return IDL.Service({
    'icrc10_supported_standards' : IDL.Func([], [IDL.Vec(Standard)], ['query']),
    'icrc37_max_approvals_per_token_or_collection' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    'icrc37_max_revoke_approvals' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    'icrc37_is_approved' : IDL.Func([IDL.Vec(IDL.Record({ 'spender' : Account, 'from_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)), 'token_id' : IDL.Nat }))], [IDL.Vec(IDL.Bool)], ['query']),
    'icrc37_get_token_approvals' : IDL.Func([IDL.Vec(IDL.Nat), IDL.Opt(TokenApproval), IDL.Opt(IDL.Nat)], [IDL.Vec(TokenApproval)], ['query']),
    'icrc37_get_collection_approvals' : IDL.Func([Account, IDL.Opt(ApprovalInfo), IDL.Opt(IDL.Nat)], [IDL.Vec(ApprovalInfo)], ['query']),
    'icrc37_approve_tokens' : IDL.Func([IDL.Vec(TokenApproval)], [IDL.Vec(IDL.Opt(IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : ApproveTokenError })))], []),
    'icrc37_approve_collection' : IDL.Func([IDL.Vec(IDL.Record({ 'approval_info' : ApprovalInfo }))], [IDL.Vec(IDL.Opt(IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : ApproveCollectionError })))], []),
    'icrc37_revoke_token_approvals' : IDL.Func([IDL.Vec(IDL.Record({ 'spender' : IDL.Opt(Account), 'from_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)), 'token_id' : IDL.Nat, 'memo' : IDL.Opt(IDL.Vec(IDL.Nat8)), 'created_at_time' : IDL.Opt(IDL.Nat64) }))], [IDL.Vec(IDL.Opt(IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : RevokeTokenApprovalError })))], []),
    'icrc37_revoke_collection_approvals' : IDL.Func([IDL.Vec(IDL.Record({ 'spender' : IDL.Opt(Account), 'from_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)), 'memo' : IDL.Opt(IDL.Vec(IDL.Nat8)), 'created_at_time' : IDL.Opt(IDL.Nat64) }))], [IDL.Vec(IDL.Opt(IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : RevokeCollectionApprovalError })))], []),
    'icrc37_transfer_from' : IDL.Func([IDL.Vec(IDL.Record({ 'spender_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)), 'from' : Account, 'to' : Account, 'token_id' : IDL.Nat, 'memo' : IDL.Opt(IDL.Vec(IDL.Nat8)), 'created_at_time' : IDL.Opt(IDL.Nat64) }))], [IDL.Vec(IDL.Opt(IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : TransferFromError })))], []),
    'icrc7_atomic_batch_transfers' : IDL.Func(
        [],
        [IDL.Opt(IDL.Bool)],
        ['query'],
      ),
    'icrc7_balance_of' : IDL.Func(
        [IDL.Vec(Account)],
        [IDL.Vec(IDL.Nat)],
        ['query'],
      ),
    'icrc7_collection_metadata' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, Value))],
        ['query'],
      ),
    'icrc7_default_take_value' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    'icrc7_description' : IDL.Func([], [IDL.Opt(IDL.Text)], ['query']),
    'icrc7_logo' : IDL.Func([], [IDL.Opt(IDL.Text)], ['query']),
    'icrc7_max_memo_size' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    'icrc7_max_query_batch_size' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    'icrc7_max_take_value' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    'icrc7_max_update_batch_size' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    'icrc7_name' : IDL.Func([], [IDL.Text], ['query']),
    'icrc7_owner_of' : IDL.Func(
        [IDL.Vec(IDL.Nat)],
        [IDL.Vec(IDL.Opt(Account))],
        ['query'],
      ),
    'icrc7_permitted_drift' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    'icrc7_supply_cap' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    'icrc7_symbol' : IDL.Func([], [IDL.Text], ['query']),
    'icrc7_token_metadata' : IDL.Func(
        [IDL.Vec(IDL.Nat)],
        [IDL.Vec(IDL.Opt(IDL.Vec(IDL.Tuple(IDL.Text, Value))))],
        ['query'],
      ),
    'icrc7_tokens' : IDL.Func(
        [IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat)],
        [IDL.Vec(IDL.Nat)],
        ['query'],
      ),
    'icrc7_tokens_of' : IDL.Func(
        [Account, IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat)],
        [IDL.Vec(IDL.Nat)],
        ['query'],
      ),
    'icrc7_total_supply' : IDL.Func([], [IDL.Nat], ['query']),
    'icrc7_transfer' : IDL.Func(
        [IDL.Vec(TransferArg)],
        [IDL.Vec(IDL.Opt(TransferResult))],
        [],
      ),
    'icrc7_tx_window' : IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
  });
};
export const init = ({ IDL }) => { return []; };
