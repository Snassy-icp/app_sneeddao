export const idlFactory = ({ IDL }) => {
  const ProposalId = IDL.Record({ 'id' : IDL.Nat64 });
  const GovernanceError = IDL.Record({
    'error_message' : IDL.Text,
    'error_type' : IDL.Int32,
  });
  const Ballot = IDL.Record({
    'vote' : IDL.Int32,
    'cast_timestamp_seconds' : IDL.Nat64,
    'voting_power' : IDL.Nat64,
  });
  const Percentage = IDL.Record({ 'basis_points' : IDL.Opt(IDL.Nat64) });
  const Tally = IDL.Record({
    'no' : IDL.Nat64,
    'yes' : IDL.Nat64,
    'total' : IDL.Nat64,
    'timestamp_seconds' : IDL.Nat64,
  });
  const NeuronId = IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) });
  const Followees = IDL.Record({ 'followees' : IDL.Vec(NeuronId) });
  const DefaultFollowees = IDL.Record({
    'followees' : IDL.Vec(IDL.Tuple(IDL.Nat64, Followees)),
  });
  const NeuronPermissionList = IDL.Record({
    'permissions' : IDL.Vec(IDL.Int32),
  });
  const VotingRewardsParameters = IDL.Record({
    'final_reward_rate_basis_points' : IDL.Opt(IDL.Nat64),
    'initial_reward_rate_basis_points' : IDL.Opt(IDL.Nat64),
    'reward_rate_transition_duration_seconds' : IDL.Opt(IDL.Nat64),
    'round_duration_seconds' : IDL.Opt(IDL.Nat64),
  });
  const NervousSystemParameters = IDL.Record({
    'default_followees' : IDL.Opt(DefaultFollowees),
    'max_dissolve_delay_seconds' : IDL.Opt(IDL.Nat64),
    'max_dissolve_delay_bonus_percentage' : IDL.Opt(IDL.Nat64),
    'max_followees_per_function' : IDL.Opt(IDL.Nat64),
    'neuron_claimer_permissions' : IDL.Opt(NeuronPermissionList),
    'neuron_minimum_stake_e8s' : IDL.Opt(IDL.Nat64),
    'max_neuron_age_for_age_bonus' : IDL.Opt(IDL.Nat64),
    'initial_voting_period_seconds' : IDL.Opt(IDL.Nat64),
    'neuron_minimum_dissolve_delay_to_vote_seconds' : IDL.Opt(IDL.Nat64),
    'reject_cost_e8s' : IDL.Opt(IDL.Nat64),
    'max_proposals_to_keep_per_action' : IDL.Opt(IDL.Nat32),
    'wait_for_quiet_deadline_increase_seconds' : IDL.Opt(IDL.Nat64),
    'max_number_of_neurons' : IDL.Opt(IDL.Nat64),
    'transaction_fee_e8s' : IDL.Opt(IDL.Nat64),
    'max_number_of_proposals_with_ballots' : IDL.Opt(IDL.Nat64),
    'max_age_bonus_percentage' : IDL.Opt(IDL.Nat64),
    'neuron_grantable_permissions' : IDL.Opt(NeuronPermissionList),
    'voting_rewards_parameters' : IDL.Opt(VotingRewardsParameters),
    'maturity_modulation_disabled' : IDL.Opt(IDL.Bool),
    'max_number_of_principals_per_neuron' : IDL.Opt(IDL.Nat64),
  });
  const GenericNervousSystemFunction = IDL.Record({
    'validator_canister_id' : IDL.Opt(IDL.Principal),
    'target_canister_id' : IDL.Opt(IDL.Principal),
    'validator_method_name' : IDL.Opt(IDL.Text),
    'target_method_name' : IDL.Opt(IDL.Text),
  });
  const FunctionType = IDL.Variant({
    'NativeNervousSystemFunction' : IDL.Record({}),
    'GenericNervousSystemFunction' : GenericNervousSystemFunction,
  });
  const NervousSystemFunction = IDL.Record({
    'id' : IDL.Nat64,
    'name' : IDL.Text,
    'description' : IDL.Opt(IDL.Text),
    'function_type' : IDL.Opt(FunctionType),
  });
  const RegisterDappCanisters = IDL.Record({
    'canister_ids' : IDL.Vec(IDL.Principal),
  });
  const Subaccount = IDL.Vec(IDL.Nat8);
  const TransferSnsTreasuryFunds = IDL.Record({
    'from_treasury' : IDL.Int32,
    'to_principal' : IDL.Opt(IDL.Principal),
    'to_subaccount' : IDL.Opt(Subaccount),
    'memo' : IDL.Opt(IDL.Nat64),
    'amount_e8s' : IDL.Nat64,
  });
  const UpgradeSnsControlledCanister = IDL.Record({
    'new_canister_wasm' : IDL.Vec(IDL.Nat8),
    'mode' : IDL.Opt(IDL.Int32),
    'canister_id' : IDL.Opt(IDL.Principal),
    'canister_upgrade_arg' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const DeregisterDappCanisters = IDL.Record({
    'canister_ids' : IDL.Vec(IDL.Principal),
    'new_controllers' : IDL.Vec(IDL.Principal),
  });
  const MintSnsTokens = IDL.Record({
    'to_principal' : IDL.Opt(IDL.Principal),
    'to_subaccount' : IDL.Opt(Subaccount),
    'memo' : IDL.Opt(IDL.Nat64),
    'amount_e8s' : IDL.Opt(IDL.Nat64),
  });
  const ManageSnsMetadata = IDL.Record({
    'url' : IDL.Opt(IDL.Text),
    'logo' : IDL.Opt(IDL.Text),
    'name' : IDL.Opt(IDL.Text),
    'description' : IDL.Opt(IDL.Text),
  });
  const ExecuteGenericNervousSystemFunction = IDL.Record({
    'function_id' : IDL.Nat64,
    'payload' : IDL.Vec(IDL.Nat8),
  });
  const ManageLedgerParameters = IDL.Record({
    'transfer_fee' : IDL.Opt(IDL.Nat64),
  });
  const Motion = IDL.Record({ 'motion_text' : IDL.Text });
  const Action = IDL.Variant({
    'ManageNervousSystemParameters' : NervousSystemParameters,
    'AddGenericNervousSystemFunction' : NervousSystemFunction,
    'RemoveGenericNervousSystemFunction' : IDL.Nat64,
    'UpgradeSnsToNextVersion' : IDL.Record({}),
    'RegisterDappCanisters' : RegisterDappCanisters,
    'TransferSnsTreasuryFunds' : TransferSnsTreasuryFunds,
    'UpgradeSnsControlledCanister' : UpgradeSnsControlledCanister,
    'DeregisterDappCanisters' : DeregisterDappCanisters,
    'MintSnsTokens' : MintSnsTokens,
    'Unspecified' : IDL.Record({}),
    'ManageSnsMetadata' : ManageSnsMetadata,
    'ExecuteGenericNervousSystemFunction' : ExecuteGenericNervousSystemFunction,
    'ManageLedgerParameters' : ManageLedgerParameters,
    'Motion' : Motion,
  });
  const Proposal = IDL.Record({
    'url' : IDL.Text,
    'title' : IDL.Text,
    'action' : IDL.Opt(Action),
    'summary' : IDL.Text,
  });
  const WaitForQuietState = IDL.Record({
    'current_deadline_timestamp_seconds' : IDL.Nat64,
  });
  const ProposalData = IDL.Record({
    'id' : IDL.Opt(ProposalId),
    'payload_text_rendering' : IDL.Opt(IDL.Text),
    'action' : IDL.Nat64,
    'failure_reason' : IDL.Opt(GovernanceError),
    'ballots' : IDL.Vec(IDL.Tuple(IDL.Text, Ballot)),
    'minimum_yes_proportion_of_total' : IDL.Opt(Percentage),
    'reward_event_round' : IDL.Nat64,
    'failed_timestamp_seconds' : IDL.Nat64,
    'reward_event_end_timestamp_seconds' : IDL.Opt(IDL.Nat64),
    'proposal_creation_timestamp_seconds' : IDL.Nat64,
    'initial_voting_period_seconds' : IDL.Nat64,
    'reject_cost_e8s' : IDL.Nat64,
    'latest_tally' : IDL.Opt(Tally),
    'wait_for_quiet_deadline_increase_seconds' : IDL.Nat64,
    'decided_timestamp_seconds' : IDL.Nat64,
    'proposal' : IDL.Opt(Proposal),
    'proposer' : IDL.Opt(NeuronId),
    'wait_for_quiet_state' : IDL.Opt(WaitForQuietState),
    'minimum_yes_proportion_of_exercised' : IDL.Opt(Percentage),
    'is_eligible_for_rewards' : IDL.Bool,
    'executed_timestamp_seconds' : IDL.Nat64,
  });
  const Result = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const NeuronPermission = IDL.Record({
    'principal' : IDL.Opt(IDL.Principal),
    'permission_type' : IDL.Vec(IDL.Int32),
  });
  const DissolveState = IDL.Variant({
    'DissolveDelaySeconds' : IDL.Nat64,
    'WhenDissolvedTimestampSeconds' : IDL.Nat64,
  });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(Subaccount),
  });
  const DisburseMaturityInProgress = IDL.Record({
    'timestamp_of_disbursement_seconds' : IDL.Nat64,
    'amount_e8s' : IDL.Nat64,
    'account_to_disburse_to' : IDL.Opt(Account),
    'finalize_disbursement_timestamp_seconds' : IDL.Opt(IDL.Nat64),
  });
  const Neuron = IDL.Record({
    'id' : IDL.Opt(NeuronId),
    'staked_maturity_e8s_equivalent' : IDL.Opt(IDL.Nat64),
    'permissions' : IDL.Vec(NeuronPermission),
    'maturity_e8s_equivalent' : IDL.Nat64,
    'cached_neuron_stake_e8s' : IDL.Nat64,
    'created_timestamp_seconds' : IDL.Nat64,
    'source_nns_neuron_id' : IDL.Opt(IDL.Nat64),
    'auto_stake_maturity' : IDL.Opt(IDL.Bool),
    'aging_since_timestamp_seconds' : IDL.Nat64,
    'dissolve_state' : IDL.Opt(DissolveState),
    'voting_power_percentage_multiplier' : IDL.Nat64,
    'vesting_period_seconds' : IDL.Opt(IDL.Nat64),
    'disburse_maturity_in_progress' : IDL.Vec(DisburseMaturityInProgress),
    'followees' : IDL.Vec(IDL.Tuple(IDL.Nat64, Followees)),
    'neuron_fees_e8s' : IDL.Nat64,
  });
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
  const ClaimStatus = IDL.Variant({
    'Failed' : IDL.Null,
    'Success' : IDL.Null,
    'Pending' : IDL.Null,
  });
  const ClaimEvent = IDL.Record({
    'fee' : IDL.Nat,
    'status' : ClaimStatus,
    'tx_index' : IDL.Opt(IDL.Nat),
    'token_id' : IDL.Principal,
    'sequence_number' : IDL.Nat,
    'error_message' : IDL.Opt(IDL.Text),
    'timestamp' : Timestamp,
    'hotkey' : IDL.Principal,
    'amount' : IDL.Nat,
  });
  const DistributionEvent = IDL.Record({
    'token_id' : IDL.Principal,
    'proposal_range' : IDL.Record({ 'first' : IDL.Nat64, 'last' : IDL.Nat64 }),
    'timestamp' : IDL.Int,
    'amount' : IDL.Nat,
  });
  const TokenMetadata = IDL.Record({
    'fee' : IDL.Nat,
    'decimals' : IDL.Nat8,
    'name' : IDL.Text,
    'symbol' : IDL.Text,
  });
  const UserDistributionEvent = IDL.Record({
    'token_id' : IDL.Principal,
    'user' : IDL.Principal,
    'proposal_range' : IDL.Record({ 'first' : IDL.Nat64, 'last' : IDL.Nat64 }),
    'timestamp' : IDL.Int,
    'amount' : IDL.Nat,
  });
  const SneedRLL = IDL.Service({
    'acceptsVote' : IDL.Func([ProposalData, IDL.Nat64], [IDL.Bool], ['query']),
    'add_admin' : IDL.Func([IDL.Principal], [Result], []),
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
    'balances_of_hotkey_neurons' : IDL.Func(
        [IDL.Vec(Neuron)],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat))],
        ['query'],
      ),
    'caller_is_admin' : IDL.Func([], [IDL.Bool], ['query']),
    'check_whitelisted_token_balances' : IDL.Func([], [Result], []),
    'claim_full_balance_of_hotkey' : IDL.Func(
        [IDL.Principal, IDL.Nat],
        [TransferResult],
        [],
      ),
    'clear_all_balances_and_distributions' : IDL.Func([], [], []),
    'clear_balances' : IDL.Func([], [], []),
    'clear_claim_events' : IDL.Func([], [], []),
    'clear_distribution_events' : IDL.Func([], [], []),
    'clear_imported_neurons' : IDL.Func([], [], []),
    'clear_imported_owners' : IDL.Func([], [], []),
    'clear_imported_props' : IDL.Func([], [], []),
    'clear_known_tokens' : IDL.Func([], [], []),
    'clear_total_distributions' : IDL.Func([], [], []),
    'clear_user_distribution_events' : IDL.Func([], [], []),
    'clear_user_distributions' : IDL.Func([], [], []),
    'clear_whitelisted_tokens' : IDL.Func([], [], []),
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
    'get_empty_ballot_proposals' : IDL.Func(
        [],
        [
          IDL.Record({
            'proposal_ids' : IDL.Vec(IDL.Nat64),
            'total_count' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_highest_closed_proposal_id' : IDL.Func([], [IDL.Nat64], ['query']),
    'get_hotkey_voting_power' : IDL.Func(
        [IDL.Vec(Neuron)],
        [
          IDL.Record({
            'distribution_voting_power' : IDL.Nat64,
            'neurons_by_owner' : IDL.Vec(
              IDL.Tuple(IDL.Principal, IDL.Vec(Neuron))
            ),
            'total_voting_power' : IDL.Nat64,
          }),
        ],
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
    'get_main_loop_status' : IDL.Func(
        [],
        [
          IDL.Record({
            'last_stopped' : IDL.Opt(IDL.Int),
            'last_cycle_ended' : IDL.Opt(IDL.Int),
            'last_cycle_started' : IDL.Opt(IDL.Int),
            'frequency_seconds' : IDL.Nat,
            'current_time' : IDL.Int,
            'is_running' : IDL.Bool,
            'next_scheduled' : IDL.Opt(IDL.Int),
            'last_started' : IDL.Opt(IDL.Int),
          }),
        ],
        ['query'],
      ),
    'get_neuron_import_status' : IDL.Func([], [Result], ['query']),
    'get_proposal_import_status' : IDL.Func([], [Result], ['query']),
    'get_token_balance_check_status' : IDL.Func(
        [],
        [
          IDL.Record({
            'ticks' : IDL.Nat,
            'total' : IDL.Nat,
            'is_running' : IDL.Bool,
            'processed' : IDL.Nat,
          }),
        ],
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
    'get_whitelisted_tokens' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, TokenMetadata))],
        ['query'],
      ),
    'import_all_neurons' : IDL.Func([], [Result], []),
    'import_all_new_neurons' : IDL.Func([], [Result], []),
    'import_all_new_proposals' : IDL.Func([], [Result], []),
    'import_all_proposals' : IDL.Func([], [Result], []),
    'import_whitelisted_tokens_from_swaprunner' : IDL.Func([], [], []),
    'imported_neurons_count' : IDL.Func([], [IDL.Nat], ['query']),
    'imported_owners_count' : IDL.Func([], [IDL.Nat], ['query']),
    'imported_props_count' : IDL.Func([], [IDL.Nat], ['query']),
    'list_admins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'principal_is_admin' : IDL.Func([IDL.Principal], [IDL.Bool], ['query']),
    'remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'remove_known_token' : IDL.Func([IDL.Principal], [], []),
    'start_distribution_cycle' : IDL.Func([], [Result], []),
    'start_rll_main_loop' : IDL.Func([], [Result], []),
    'stop_distribution_cycle' : IDL.Func([], [Result], []),
    'stop_neuron_import' : IDL.Func([], [Result], []),
    'stop_proposal_import' : IDL.Func([], [Result], []),
    'stop_rll_main_loop' : IDL.Func([], [Result], []),
    'stop_token_balance_check' : IDL.Func([], [Result], []),
    'total_balance' : IDL.Func([IDL.Principal], [IDL.Nat], ['query']),
  });
  return SneedRLL;
};
export const init = ({ IDL }) => { return []; };
