import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface Account {
  'owner' : Principal,
  'subaccount' : [] | [Subaccount],
}
export type Action = {
    'ManageNervousSystemParameters' : NervousSystemParameters
  } |
  { 'AddGenericNervousSystemFunction' : NervousSystemFunction } |
  { 'RemoveGenericNervousSystemFunction' : bigint } |
  { 'UpgradeSnsToNextVersion' : {} } |
  { 'RegisterDappCanisters' : RegisterDappCanisters } |
  { 'TransferSnsTreasuryFunds' : TransferSnsTreasuryFunds } |
  { 'UpgradeSnsControlledCanister' : UpgradeSnsControlledCanister } |
  { 'DeregisterDappCanisters' : DeregisterDappCanisters } |
  { 'MintSnsTokens' : MintSnsTokens } |
  { 'Unspecified' : {} } |
  { 'ManageSnsMetadata' : ManageSnsMetadata } |
  {
    'ExecuteGenericNervousSystemFunction' : ExecuteGenericNervousSystemFunction
  } |
  { 'ManageLedgerParameters' : ManageLedgerParameters } |
  { 'Motion' : Motion };
export type Balance = bigint;
export interface Ballot {
  'vote' : number,
  'cast_timestamp_seconds' : bigint,
  'voting_power' : bigint,
}
export interface ClaimEvent {
  'fee' : bigint,
  'status' : ClaimStatus,
  'tx_index' : [] | [bigint],
  'token_id' : Principal,
  'sequence_number' : bigint,
  'error_message' : [] | [string],
  'timestamp' : Timestamp,
  'hotkey' : Principal,
  'amount' : bigint,
}
export type ClaimStatus = { 'Failed' : null } |
  { 'Success' : null } |
  { 'Pending' : null };
export interface DefaultFollowees { 'followees' : Array<[bigint, Followees]> }
export interface DeregisterDappCanisters {
  'canister_ids' : Array<Principal>,
  'new_controllers' : Array<Principal>,
}
export interface DisburseMaturityInProgress {
  'timestamp_of_disbursement_seconds' : bigint,
  'amount_e8s' : bigint,
  'account_to_disburse_to' : [] | [Account],
  'finalize_disbursement_timestamp_seconds' : [] | [bigint],
}
export type DissolveState = { 'DissolveDelaySeconds' : bigint } |
  { 'WhenDissolvedTimestampSeconds' : bigint };
export interface DistributionEvent {
  'token_id' : Principal,
  'proposal_range' : { 'first' : bigint, 'last' : bigint },
  'timestamp' : bigint,
  'amount' : bigint,
}
export interface ExecuteGenericNervousSystemFunction {
  'function_id' : bigint,
  'payload' : Uint8Array | number[],
}
export interface Followees { 'followees' : Array<NeuronId> }
export type FunctionType = { 'NativeNervousSystemFunction' : {} } |
  { 'GenericNervousSystemFunction' : GenericNervousSystemFunction };
export interface GenericNervousSystemFunction {
  'validator_canister_id' : [] | [Principal],
  'target_canister_id' : [] | [Principal],
  'validator_method_name' : [] | [string],
  'target_method_name' : [] | [string],
}
export interface GovernanceError {
  'error_message' : string,
  'error_type' : number,
}
export interface ManageLedgerParameters { 'transfer_fee' : [] | [bigint] }
export interface ManageSnsMetadata {
  'url' : [] | [string],
  'logo' : [] | [string],
  'name' : [] | [string],
  'description' : [] | [string],
}
export interface MintSnsTokens {
  'to_principal' : [] | [Principal],
  'to_subaccount' : [] | [Subaccount],
  'memo' : [] | [bigint],
  'amount_e8s' : [] | [bigint],
}
export interface Motion { 'motion_text' : string }
export interface NervousSystemFunction {
  'id' : bigint,
  'name' : string,
  'description' : [] | [string],
  'function_type' : [] | [FunctionType],
}
export interface NervousSystemParameters {
  'default_followees' : [] | [DefaultFollowees],
  'max_dissolve_delay_seconds' : [] | [bigint],
  'max_dissolve_delay_bonus_percentage' : [] | [bigint],
  'max_followees_per_function' : [] | [bigint],
  'neuron_claimer_permissions' : [] | [NeuronPermissionList],
  'neuron_minimum_stake_e8s' : [] | [bigint],
  'max_neuron_age_for_age_bonus' : [] | [bigint],
  'initial_voting_period_seconds' : [] | [bigint],
  'neuron_minimum_dissolve_delay_to_vote_seconds' : [] | [bigint],
  'reject_cost_e8s' : [] | [bigint],
  'max_proposals_to_keep_per_action' : [] | [number],
  'wait_for_quiet_deadline_increase_seconds' : [] | [bigint],
  'max_number_of_neurons' : [] | [bigint],
  'transaction_fee_e8s' : [] | [bigint],
  'max_number_of_proposals_with_ballots' : [] | [bigint],
  'max_age_bonus_percentage' : [] | [bigint],
  'neuron_grantable_permissions' : [] | [NeuronPermissionList],
  'voting_rewards_parameters' : [] | [VotingRewardsParameters],
  'maturity_modulation_disabled' : [] | [boolean],
  'max_number_of_principals_per_neuron' : [] | [bigint],
}
export interface Neuron {
  'id' : [] | [NeuronId],
  'staked_maturity_e8s_equivalent' : [] | [bigint],
  'permissions' : Array<NeuronPermission>,
  'maturity_e8s_equivalent' : bigint,
  'cached_neuron_stake_e8s' : bigint,
  'created_timestamp_seconds' : bigint,
  'source_nns_neuron_id' : [] | [bigint],
  'auto_stake_maturity' : [] | [boolean],
  'aging_since_timestamp_seconds' : bigint,
  'dissolve_state' : [] | [DissolveState],
  'voting_power_percentage_multiplier' : bigint,
  'vesting_period_seconds' : [] | [bigint],
  'disburse_maturity_in_progress' : Array<DisburseMaturityInProgress>,
  'followees' : Array<[bigint, Followees]>,
  'neuron_fees_e8s' : bigint,
}
export interface NeuronId { 'id' : Uint8Array | number[] }
export interface NeuronPermission {
  'principal' : [] | [Principal],
  'permission_type' : Int32Array | number[],
}
export interface NeuronPermissionList { 'permissions' : Int32Array | number[] }
export interface Percentage { 'basis_points' : [] | [bigint] }
export interface Proposal {
  'url' : string,
  'title' : string,
  'action' : [] | [Action],
  'summary' : string,
}
export interface ProposalData {
  'id' : [] | [ProposalId],
  'payload_text_rendering' : [] | [string],
  'action' : bigint,
  'failure_reason' : [] | [GovernanceError],
  'ballots' : Array<[string, Ballot]>,
  'minimum_yes_proportion_of_total' : [] | [Percentage],
  'reward_event_round' : bigint,
  'failed_timestamp_seconds' : bigint,
  'reward_event_end_timestamp_seconds' : [] | [bigint],
  'proposal_creation_timestamp_seconds' : bigint,
  'initial_voting_period_seconds' : bigint,
  'reject_cost_e8s' : bigint,
  'latest_tally' : [] | [Tally],
  'wait_for_quiet_deadline_increase_seconds' : bigint,
  'decided_timestamp_seconds' : bigint,
  'proposal' : [] | [Proposal],
  'proposer' : [] | [NeuronId],
  'wait_for_quiet_state' : [] | [WaitForQuietState],
  'minimum_yes_proportion_of_exercised' : [] | [Percentage],
  'is_eligible_for_rewards' : boolean,
  'executed_timestamp_seconds' : bigint,
}
export interface ProposalId { 'id' : bigint }
export interface RegisterDappCanisters { 'canister_ids' : Array<Principal> }
export type Result = { 'ok' : string } |
  { 'err' : string };
export type Result_1 = { 'ok' : Array<ClaimEvent> } |
  { 'err' : string };
export interface SneedRLL {
  'acceptsVote' : ActorMethod<[ProposalData, bigint], boolean>,
  'add_admin' : ActorMethod<[Principal], Result>,
  'add_known_token' : ActorMethod<[Principal], undefined>,
  'all_token_balances' : ActorMethod<[], Array<[Principal, bigint]>>,
  'balance_of' : ActorMethod<[Principal, Principal], bigint>,
  'balance_reconciliation' : ActorMethod<
    [],
    Array<
      {
        'token_id' : Principal,
        'underflow' : bigint,
        'local_total' : bigint,
        'remaining' : bigint,
        'server_balance' : bigint,
      }
    >
  >,
  'balance_reconciliation_from_balances' : ActorMethod<
    [Array<[Principal, bigint]>],
    Array<
      {
        'token_id' : Principal,
        'underflow' : bigint,
        'local_total' : bigint,
        'remaining' : bigint,
        'server_balance' : bigint,
      }
    >
  >,
  'balances_count' : ActorMethod<[], bigint>,
  'balances_of_hotkey' : ActorMethod<[], Array<[Principal, bigint]>>,
  'balances_of_hotkey_neurons' : ActorMethod<
    [Array<Neuron>],
    Array<[Principal, bigint]>
  >,
  'caller_is_admin' : ActorMethod<[], boolean>,
  'check_wallet_token_balances' : ActorMethod<[Principal], Result>,
  'check_whitelisted_token_balances' : ActorMethod<[], Result>,
  'claim_full_balance_of_hotkey' : ActorMethod<
    [Principal, bigint],
    TransferResult
  >,
  'clear_all_balances_and_distributions' : ActorMethod<[], undefined>,
  'clear_balances' : ActorMethod<[], undefined>,
  'clear_claim_events' : ActorMethod<[], undefined>,
  'clear_distribution_events' : ActorMethod<[], undefined>,
  'clear_imported_neurons' : ActorMethod<[], undefined>,
  'clear_imported_owners' : ActorMethod<[], undefined>,
  'clear_imported_props' : ActorMethod<[], undefined>,
  'clear_known_tokens' : ActorMethod<[], undefined>,
  'clear_total_distributions' : ActorMethod<[], undefined>,
  'clear_user_distribution_events' : ActorMethod<[], undefined>,
  'clear_user_distributions' : ActorMethod<[], undefined>,
  'clear_whitelisted_tokens' : ActorMethod<[], undefined>,
  'get_all_token_max_distributions' : ActorMethod<
    [],
    Array<[Principal, bigint]>
  >,
  'get_all_token_min_distributions' : ActorMethod<
    [],
    Array<[Principal, bigint]>
  >,
  'get_all_user_balances' : ActorMethod<
    [],
    Array<[Principal, Array<[Principal, bigint]>]>
  >,
  'get_claim_events' : ActorMethod<[], Array<ClaimEvent>>,
  'get_claim_events_for_hotkey' : ActorMethod<[Principal], Array<ClaimEvent>>,
  'get_distribution_events' : ActorMethod<[], Array<DistributionEvent>>,
  'get_empty_ballot_proposals' : ActorMethod<
    [],
    { 'proposal_ids' : BigUint64Array | bigint[], 'total_count' : bigint }
  >,
  'get_error_claim_events' : ActorMethod<[], Result_1>,
  'get_event_statistics' : ActorMethod<
    [],
    {
      'all_time' : {
        'claims' : {
          'total' : bigint,
          'pending' : bigint,
          'per_token' : Array<[Principal, bigint]>,
          'unique_users' : bigint,
          'successful' : bigint,
          'failed' : bigint,
        },
        'server_distributions' : {
          'total' : bigint,
          'per_token' : Array<[Principal, bigint]>,
        },
        'user_distributions' : {
          'total' : bigint,
          'per_token' : Array<[Principal, bigint]>,
          'unique_users' : bigint,
        },
      },
      'last_24h' : {
        'claims' : {
          'total' : bigint,
          'pending' : bigint,
          'per_token' : Array<[Principal, bigint]>,
          'unique_users' : bigint,
          'successful' : bigint,
          'failed' : bigint,
        },
        'server_distributions' : {
          'total' : bigint,
          'per_token' : Array<[Principal, bigint]>,
        },
        'user_distributions' : {
          'total' : bigint,
          'per_token' : Array<[Principal, bigint]>,
          'unique_users' : bigint,
        },
      },
    }
  >,
  'get_highest_closed_proposal_id' : ActorMethod<[], bigint>,
  'get_hotkey_claimed_amounts' : ActorMethod<
    [Principal],
    Array<[Principal, bigint]>
  >,
  'get_hotkey_voting_power' : ActorMethod<
    [Array<Neuron>],
    {
      'distribution_voting_power' : bigint,
      'neurons_by_owner' : Array<[Principal, Array<Neuron>]>,
      'total_voting_power' : bigint,
    }
  >,
  'get_import_next_neuron_id' : ActorMethod<[], [] | [NeuronId]>,
  'get_import_stage' : ActorMethod<[], string>,
  'get_imported_proposal_max' : ActorMethod<[], bigint>,
  'get_known_tokens' : ActorMethod<[], Array<[Principal, TokenMetadata]>>,
  'get_main_loop_status' : ActorMethod<
    [],
    {
      'last_stopped' : [] | [bigint],
      'last_cycle_ended' : [] | [bigint],
      'last_cycle_started' : [] | [bigint],
      'frequency_seconds' : bigint,
      'current_time' : bigint,
      'is_running' : boolean,
      'next_scheduled' : [] | [bigint],
      'last_started' : [] | [bigint],
    }
  >,
  'get_neuron_import_status' : ActorMethod<[], Result>,
  'get_neuron_statistics' : ActorMethod<
    [],
    {
      'permissions' : {
        'multi_hotkey_neurons' : bigint,
        'total_hotkeys' : bigint,
      },
      'total_stake' : bigint,
      'dissolve_times' : {
        'max_dissolve_delay_seconds' : [] | [bigint],
        'max_delay_neurons' : {
          'count' : bigint,
          'total_voting_power' : bigint,
        },
        'min_dissolve_delay_seconds' : [] | [bigint],
        'avg_dissolve_delay_seconds' : number,
        'min_delay_neurons' : {
          'count' : bigint,
          'total_voting_power' : bigint,
        },
      },
      'active_neurons' : bigint,
      'total_neurons' : bigint,
      'dissolve_state' : {
        'not_dissolving' : bigint,
        'dissolved_stake' : bigint,
        'dissolving_stake' : bigint,
        'not_dissolving_stake' : bigint,
        'dissolved' : bigint,
        'dissolving' : bigint,
      },
      'voting_power' : {
        'avg' : number,
        'max' : bigint,
        'min' : bigint,
        'total' : bigint,
      },
    }
  >,
  'get_neuron_voting_history' : ActorMethod<
    [Uint8Array | number[]],
    Array<
      {
        'vote' : number,
        'proposal_title' : [] | [string],
        'proposal_id' : bigint,
        'timestamp' : bigint,
        'proposal_action' : bigint,
        'voting_power' : bigint,
      }
    >
  >,
  'get_proposal_ballots' : ActorMethod<[bigint], Array<[string, Ballot]>>,
  'get_proposal_import_status' : ActorMethod<[], Result>,
  'get_token_balance_check_status' : ActorMethod<
    [],
    {
      'ticks' : bigint,
      'total' : bigint,
      'is_running' : boolean,
      'processed' : bigint,
    }
  >,
  'get_token_distribution_events' : ActorMethod<
    [Principal],
    Array<DistributionEvent>
  >,
  'get_token_max_distribution' : ActorMethod<[Principal], [] | [bigint]>,
  'get_token_metadata' : ActorMethod<[Principal], [] | [TokenMetadata]>,
  'get_token_min_distribution' : ActorMethod<[Principal], [] | [bigint]>,
  'get_token_total_distribution' : ActorMethod<[Principal], bigint>,
  'get_total_distributions' : ActorMethod<[], Array<[Principal, bigint]>>,
  'get_unmatched_pending_claims' : ActorMethod<[], Result_1>,
  'get_user_distribution_events' : ActorMethod<
    [],
    Array<UserDistributionEvent>
  >,
  'get_user_distributions' : ActorMethod<
    [Principal],
    Array<[Principal, bigint]>
  >,
  'get_user_specific_distribution_events' : ActorMethod<
    [Principal],
    Array<UserDistributionEvent>
  >,
  'get_user_token_distribution' : ActorMethod<[Principal, Principal], bigint>,
  'get_user_token_distribution_events' : ActorMethod<
    [Principal, Principal],
    Array<UserDistributionEvent>
  >,
  'get_user_voting_history' : ActorMethod<
    [Principal],
    Array<
      {
        'vote' : number,
        'proposal_title' : [] | [string],
        'proposal_id' : bigint,
        'timestamp' : bigint,
        'proposal_action' : bigint,
        'neuron_votes' : Array<
          {
            'vote' : number,
            'timestamp' : bigint,
            'voting_power' : bigint,
            'neuron_id' : string,
          }
        >,
        'voting_power' : bigint,
      }
    >
  >,
  'get_wallet_known_tokens' : ActorMethod<
    [Principal],
    Array<[Principal, TokenMetadata]>
  >,
  'get_wallet_token_check_status' : ActorMethod<
    [],
    {
      'ticks' : bigint,
      'total' : bigint,
      'wallet' : [] | [Principal],
      'is_running' : boolean,
      'processed' : bigint,
    }
  >,
  'get_whitelisted_tokens' : ActorMethod<[], Array<[Principal, TokenMetadata]>>,
  'import_all_neurons' : ActorMethod<[], Result>,
  'import_all_new_neurons' : ActorMethod<[], Result>,
  'import_all_new_proposals' : ActorMethod<[], Result>,
  'import_all_proposals' : ActorMethod<[], Result>,
  'import_whitelisted_tokens_from_swaprunner' : ActorMethod<[], undefined>,
  'imported_neurons_count' : ActorMethod<[], bigint>,
  'imported_owners_count' : ActorMethod<[], bigint>,
  'imported_props_count' : ActorMethod<[], bigint>,
  'list_admins' : ActorMethod<[], Array<Principal>>,
  'principal_is_admin' : ActorMethod<[Principal], boolean>,
  'remove_admin' : ActorMethod<[Principal], Result>,
  'remove_known_token' : ActorMethod<[Principal], undefined>,
  'remove_token_max_distribution' : ActorMethod<[Principal], Result>,
  'remove_token_min_distribution' : ActorMethod<[Principal], Result>,
  'set_token_max_distribution' : ActorMethod<[Principal, bigint], Result>,
  'set_token_min_distribution' : ActorMethod<[Principal, bigint], Result>,
  'start_distribution_cycle' : ActorMethod<[], Result>,
  'start_rll_main_loop' : ActorMethod<[], Result>,
  'stop_distribution_cycle' : ActorMethod<[], Result>,
  'stop_neuron_import' : ActorMethod<[], Result>,
  'stop_proposal_import' : ActorMethod<[], Result>,
  'stop_rll_main_loop' : ActorMethod<[], Result>,
  'stop_token_balance_check' : ActorMethod<[], Result>,
  'stop_wallet_token_check' : ActorMethod<[], Result>,
  'total_balance' : ActorMethod<[Principal], bigint>,
}
export type Subaccount = Uint8Array | number[];
export interface Tally {
  'no' : bigint,
  'yes' : bigint,
  'total' : bigint,
  'timestamp_seconds' : bigint,
}
export type Timestamp = bigint;
export interface TokenMetadata {
  'fee' : bigint,
  'decimals' : number,
  'name' : string,
  'symbol' : string,
}
export type TransferError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'TemporarilyUnavailable' : null } |
  { 'BadBurn' : { 'min_burn_amount' : Balance } } |
  { 'Duplicate' : { 'duplicate_of' : TxIndex } } |
  { 'BadFee' : { 'expected_fee' : Balance } } |
  { 'CreatedInFuture' : { 'ledger_time' : Timestamp } } |
  { 'TooOld' : null } |
  { 'InsufficientFunds' : { 'balance' : Balance } };
export type TransferResult = { 'Ok' : TxIndex } |
  { 'Err' : TransferError };
export interface TransferSnsTreasuryFunds {
  'from_treasury' : number,
  'to_principal' : [] | [Principal],
  'to_subaccount' : [] | [Subaccount],
  'memo' : [] | [bigint],
  'amount_e8s' : bigint,
}
export type TxIndex = bigint;
export interface UpgradeSnsControlledCanister {
  'new_canister_wasm' : Uint8Array | number[],
  'mode' : [] | [number],
  'canister_id' : [] | [Principal],
  'canister_upgrade_arg' : [] | [Uint8Array | number[]],
}
export interface UserDistributionEvent {
  'token_id' : Principal,
  'user' : Principal,
  'proposal_range' : { 'first' : bigint, 'last' : bigint },
  'timestamp' : bigint,
  'amount' : bigint,
}
export interface VotingRewardsParameters {
  'final_reward_rate_basis_points' : [] | [bigint],
  'initial_reward_rate_basis_points' : [] | [bigint],
  'reward_rate_transition_duration_seconds' : [] | [bigint],
  'round_duration_seconds' : [] | [bigint],
}
export interface WaitForQuietState {
  'current_deadline_timestamp_seconds' : bigint,
}
export interface _SERVICE extends SneedRLL {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
