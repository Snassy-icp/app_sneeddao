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
  const ClaimEvent = IDL.Record({
    'fee' : IDL.Nat,
    'token_id' : IDL.Principal,
    'sequence_number' : IDL.Nat,
    'error_message' : IDL.Opt(IDL.Text),
    'timestamp' : Timestamp,
    'success' : IDL.Bool,
    'hotkey' : IDL.Principal,
    'amount' : IDL.Nat,
  });
  const DistributionEvent = IDL.Record({
    'token_id' : IDL.Principal,
    'proposal_range' : IDL.Record({ 'first' : IDL.Nat64, 'last' : IDL.Nat64 }),
    'timestamp' : IDL.Int,
    'amount' : IDL.Nat,
  });
  const NeuronId = IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) });
  const TokenMetadata = IDL.Record({
    'fee' : IDL.Nat,
    'decimals' : IDL.Nat8,
    'name' : IDL.Text,
    'symbol' : IDL.Text,
  });
  const TransferEvent = IDL.Record({
    'to' : IDL.Principal,
    'fee' : IDL.Nat,
    'tx_index' : IDL.Opt(IDL.Nat),
    'token_id' : IDL.Principal,
    'sequence_number' : IDL.Nat,
    'from' : IDL.Principal,
    'timestamp' : Timestamp,
    'success' : IDL.Bool,
    'amount' : IDL.Nat,
  });
  const UserDistributionEvent = IDL.Record({
    'token_id' : IDL.Principal,
    'user' : IDL.Principal,
    'proposal_range' : IDL.Record({ 'first' : IDL.Nat64, 'last' : IDL.Nat64 }),
    'timestamp' : IDL.Int,
    'amount' : IDL.Nat,
  });
  const SneedRLL = IDL.Service({
    'add_known_token' : IDL.Func([IDL.Principal], [], []),
    'all_token_balances' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat))],
        ['query'],
      ),
    'balance_of' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [IDL.Nat],
        ['query'],
      ),
    'balance_reconciliation' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Record({
              'token_id' : IDL.Principal,
              'underflow' : IDL.Nat,
              'local_total' : IDL.Nat,
              'remaining' : IDL.Nat,
              'server_balance' : IDL.Nat,
            })
          ),
        ],
        [],
      ),
    'balances_count' : IDL.Func([], [IDL.Nat], ['query']),
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
    'clear_balances' : IDL.Func([], [], []),
    'clear_imported_neurons' : IDL.Func([], [], []),
    'clear_imported_owners' : IDL.Func([], [], []),
    'clear_imported_props' : IDL.Func([], [], []),
    'distribute_amount' : IDL.Func(
        [IDL.Nat, IDL.Principal, ProposalId, ProposalId],
        [],
        [],
      ),
    'get_claim_events' : IDL.Func([], [IDL.Vec(ClaimEvent)], ['query']),
    'get_claim_events_for_hotkey' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(ClaimEvent)],
        ['query'],
      ),
    'get_distribution_events' : IDL.Func(
        [],
        [IDL.Vec(DistributionEvent)],
        ['query'],
      ),
    'get_import_next_neuron_id' : IDL.Func([], [IDL.Opt(NeuronId)], ['query']),
    'get_import_stage' : IDL.Func([], [IDL.Text], ['query']),
    'get_imported_proposal_max' : IDL.Func([], [IDL.Nat64], ['query']),
    'get_known_tokens' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, TokenMetadata))],
        ['query'],
      ),
    'get_token_distribution_events' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(DistributionEvent)],
        ['query'],
      ),
    'get_token_metadata' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(TokenMetadata)],
        ['query'],
      ),
    'get_token_total_distribution' : IDL.Func(
        [IDL.Principal],
        [IDL.Nat],
        ['query'],
      ),
    'get_total_distributions' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat))],
        ['query'],
      ),
    'get_transfer_events' : IDL.Func([], [IDL.Vec(TransferEvent)], ['query']),
    'get_user_distribution_events' : IDL.Func(
        [],
        [IDL.Vec(UserDistributionEvent)],
        ['query'],
      ),
    'get_user_distributions' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat))],
        ['query'],
      ),
    'get_user_specific_distribution_events' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(UserDistributionEvent)],
        ['query'],
      ),
    'get_user_token_distribution' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [IDL.Nat],
        ['query'],
      ),
    'get_user_token_distribution_events' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [IDL.Vec(UserDistributionEvent)],
        ['query'],
      ),
    'import_all_neurons' : IDL.Func([], [], []),
    'import_all_new_neurons' : IDL.Func([], [], []),
    'import_all_new_proposals' : IDL.Func([], [], []),
    'import_all_proposals' : IDL.Func([], [], []),
    'imported_neurons_count' : IDL.Func([], [IDL.Nat], ['query']),
    'imported_owners_count' : IDL.Func([], [IDL.Nat], ['query']),
    'imported_props_count' : IDL.Func([], [IDL.Nat], ['query']),
    'remove_known_token' : IDL.Func([IDL.Principal], [], []),
    'start_import_cycle' : IDL.Func([], [], []),
    'test_set_balance' : IDL.Func(
        [IDL.Principal, IDL.Principal, IDL.Nat],
        [],
        [],
      ),
    'total_balance' : IDL.Func([IDL.Principal], [IDL.Nat], ['query']),
    'transfer_remaining_balances' : IDL.Func(
        [IDL.Principal],
        [
          IDL.Vec(
            IDL.Record({
              'fee' : IDL.Nat,
              'result' : TransferResult,
              'tx_index' : IDL.Opt(IDL.Nat),
              'token_id' : IDL.Principal,
              'amount' : IDL.Nat,
            })
          ),
        ],
        [],
      ),
  });
  return SneedRLL;
};
export const init = ({ IDL }) => { return []; };
