import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface Account {
  'owner' : Principal,
  'subaccount' : [] | [Uint8Array | number[]],
}
export interface Achievement {
  'id' : string,
  'name' : string,
  'description' : string,
  'condition_usages' : Array<ConditionUsage>,
  'logo_url' : [] | [string],
  'criteria' : string,
  'predicate' : [] | [PredicateExpression],
}
export interface AddSubaccountArgs {
  'token_id' : Principal,
  'name' : string,
  'subaccount' : Uint8Array | number[],
}
export interface AddTokenArgs {
  'metadata' : TokenMetadata,
  'logo' : [] | [string],
  'canisterId' : Principal,
}
export interface Allocation {
  'id' : string,
  'creator' : Principal,
  'token' : {
    'per_user' : { 'min_e8s' : bigint, 'max_e8s' : bigint },
    'canister_id' : Principal,
    'total_amount_e8s' : bigint,
  },
  'created_at' : bigint,
  'achievement_id' : string,
}
export interface AllocationClaim {
  'claimed_at' : bigint,
  'allocation_id' : string,
  'user' : Principal,
  'amount_e8s' : bigint,
}
export interface AllocationFeeConfig {
  'icp_fee_e8s' : bigint,
  'cut_basis_points' : bigint,
}
export type AllocationStatus = { 'Active' : null } |
  { 'Draft' : null } |
  { 'Cancelled' : null } |
  { 'Depleted' : null };
export interface Condition {
  'key' : string,
  'name' : string,
  'description' : string,
  'parameter_specs' : Array<
    {
      'name' : string,
      'param_type' : { 'Nat' : null } |
        { 'Text' : null } |
        { 'Principal' : null },
      'default_value' : [] | [string],
    }
  >,
}
export interface ConditionUsage {
  'parameters' : Array<
    { 'Nat' : bigint } |
      { 'Text' : string } |
      { 'Principal' : Principal }
  >,
  'condition_key' : string,
}
export interface CreateAllocationArgs {
  'per_user_max_e8s' : bigint,
  'token_canister_id' : Principal,
  'total_amount_e8s' : bigint,
  'achievement_id' : string,
  'per_user_min_e8s' : bigint,
}
export interface CreateUserProfileArgs {
  'principal' : Principal,
  'name' : string,
  'description' : string,
  'logo_url' : [] | [string],
  'social_links' : Array<SocialLink>,
}
export interface DonationEvent {
  'tx_id' : string,
  'token_ledger_id' : Principal,
  'amount_e8s' : bigint,
  'usd_value' : number,
  'timestamp' : bigint,
  'donor' : Principal,
}
export interface GlobalStats {
  'total_sends' : bigint,
  'total_swaps' : bigint,
  'total_deposits' : bigint,
  'icpswap_swaps' : bigint,
  'total_withdrawals' : bigint,
  'kong_swaps' : bigint,
  'split_swaps' : bigint,
}
export interface ImportProgress {
  'skipped_count' : bigint,
  'imported_count' : bigint,
  'processed_count' : bigint,
  'last_processed' : [] | [string],
  'is_running' : boolean,
  'total_tokens' : bigint,
  'failed_count' : bigint,
}
export interface MetadataDiscrepancy {
  'new_metadata' : TokenMetadata,
  'ledger_id' : Principal,
  'old_metadata' : TokenMetadata,
  'timestamp' : bigint,
}
export interface MetadataRefreshProgress {
  'skipped_count' : bigint,
  'updated_count' : bigint,
  'processed_count' : bigint,
  'last_processed' : [] | [Principal],
  'is_running' : boolean,
  'total_tokens' : bigint,
  'failed_count' : bigint,
}
export interface NamedSubaccount {
  'name' : string,
  'subaccount' : Uint8Array | number[],
  'created_at' : bigint,
}
export interface PaginatedLogosResponse {
  'total' : bigint,
  'items' : Array<[Principal, [] | [string]]>,
  'start_index' : bigint,
}
export interface PoolMetadata {
  'fee' : bigint,
  'key' : string,
  'token0' : Token,
  'token1' : Token,
}
export type PredicateExpression = {
    'OR' : [PredicateExpression, PredicateExpression]
  } |
  { 'AND' : [PredicateExpression, PredicateExpression] } |
  { 'NOT' : PredicateExpression } |
  { 'REF' : bigint };
export type ProfileError = { 'InvalidInput' : string } |
  { 'NotFound' : null } |
  { 'NotAuthorized' : null } |
  { 'AlreadyExists' : null };
export interface RegisterTokenResponse {
  'metadata' : TokenMetadata,
  'logo' : [] | [string],
}
export interface RemoveSubaccountArgs {
  'token_id' : Principal,
  'subaccount' : Uint8Array | number[],
}
export type Result = { 'ok' : bigint } |
  { 'err' : string };
export type Result_1 = { 'ok' : null } |
  { 'err' : string };
export type Result_10 = { 'ok' : Array<UserTokenSubaccounts> } |
  { 'err' : string };
export type Result_11 = { 'ok' : Achievement } |
  { 'err' : string };
export type Result_12 = { 'ok' : null } |
  { 'err' : ProfileError };
export type Result_13 = { 'ok' : Allocation } |
  { 'err' : string };
export type Result_2 = { 'ok' : string } |
  { 'err' : string };
export type Result_3 = { 'ok' : UserProfile } |
  { 'err' : ProfileError };
export type Result_4 = { 'ok' : RegisterTokenResponse } |
  { 'err' : string };
export type Result_5 = { 'ok' : TokenMetadata } |
  { 'err' : string };
export type Result_6 = { 'ok' : Array<NamedSubaccount> } |
  { 'err' : string };
export type Result_7 = {
    'ok' : Array<{ 'status' : AllocationStatus, 'allocation' : Allocation }>
  } |
  { 'err' : string };
export type Result_8 = { 'ok' : Uint8Array | number[] } |
  { 'err' : string };
export type Result_9 = {
    'ok' : { 'status' : AllocationStatus, 'allocation' : Allocation }
  } |
  { 'err' : string };
export interface SocialLink { 'url' : string, 'platform' : string }
export interface SponsorInfo {
  'principal' : Principal,
  'name' : string,
  'logo_url' : [] | [string],
}
export type SuspendedStatus = { 'Temporary' : string } |
  { 'Permanent' : string };
export interface SwapRunner {
  'activate_allocation' : ActorMethod<[bigint], Result_1>,
  'add_achievement' : ActorMethod<[Achievement], Result_1>,
  'add_admin' : ActorMethod<[Principal], Result_1>,
  'add_named_subaccount' : ActorMethod<[AddSubaccountArgs], Result_1>,
  'add_pool' : ActorMethod<[Principal], Result_1>,
  'add_pool_for' : ActorMethod<[Principal, Principal], Result_1>,
  'add_token' : ActorMethod<[AddTokenArgs], Result_1>,
  'add_wallet_token' : ActorMethod<[string], boolean>,
  'cancel_allocation' : ActorMethod<[bigint], Result_1>,
  'cancel_top_up' : ActorMethod<[bigint], Result_1>,
  'claim_allocation' : ActorMethod<[bigint], Result>,
  'claim_and_withdraw_allocation' : ActorMethod<[bigint], Result>,
  'clear_icpswap_tokens' : ActorMethod<[], Result_1>,
  'clear_logo_cache' : ActorMethod<[], Result_1>,
  'clear_metadata_discrepancies' : ActorMethod<[], undefined>,
  'clear_user_token_savings_stats' : ActorMethod<[], undefined>,
  'clear_whitelist' : ActorMethod<[], Result_1>,
  'copy_icpswap_trusted_tokens' : ActorMethod<[], Result_2>,
  'createUserProfile' : ActorMethod<[CreateUserProfileArgs], Result_3>,
  'create_allocation' : ActorMethod<[CreateAllocationArgs], Result_13>,
  'deleteUserProfile' : ActorMethod<[Principal], Result_12>,
  'getUserProfile' : ActorMethod<[Principal], Result_3>,
  'getUserProfileCount' : ActorMethod<[], bigint>,
  'get_achievement_allocations' : ActorMethod<
    [string],
    Array<{ 'status' : AllocationStatus, 'allocation' : Allocation }>
  >,
  'get_achievement_details' : ActorMethod<[string], Result_11>,
  'get_actual_server_balance' : ActorMethod<[Principal], bigint>,
  'get_admins' : ActorMethod<[], Array<Principal>>,
  'get_all_achievements' : ActorMethod<[], Array<Achievement>>,
  'get_all_allocation_claims' : ActorMethod<[], Array<AllocationClaim>>,
  'get_all_allocation_creators' : ActorMethod<[], Array<Principal>>,
  'get_all_conditions' : ActorMethod<[], Array<Condition>>,
  'get_all_custom_tokens' : ActorMethod<[], Array<[Principal, TokenMetadata]>>,
  'get_all_donations' : ActorMethod<[], Array<DonationEvent>>,
  'get_all_named_subaccounts' : ActorMethod<[], Result_10>,
  'get_all_suspended_principals' : ActorMethod<
    [],
    Array<[Principal, SuspendedStatus]>
  >,
  'get_all_token_allocation_stats' : ActorMethod<
    [],
    Array<[string, TokenAllocationStats]>
  >,
  'get_all_token_savings_stats' : ActorMethod<
    [],
    Array<[string, TokenSavingsStats]>
  >,
  'get_all_token_stats' : ActorMethod<[], Array<[string, TokenStats]>>,
  'get_all_tokens' : ActorMethod<[], Array<[Principal, TokenMetadata]>>,
  'get_all_user_allocations' : ActorMethod<
    [],
    Array<{ 'status' : AllocationStatus, 'allocation' : Allocation }>
  >,
  'get_all_user_logins' : ActorMethod<[], Array<[string, bigint]>>,
  'get_all_user_stats' : ActorMethod<[], Array<[string, UserStats]>>,
  'get_allocation' : ActorMethod<[string], Result_9>,
  'get_allocation_balance' : ActorMethod<[bigint, Principal], bigint>,
  'get_allocation_claims' : ActorMethod<
    [string],
    Array<{ 'claimed_at' : bigint, 'user' : Principal, 'amount_e8s' : bigint }>
  >,
  'get_allocation_fee_config' : ActorMethod<[], AllocationFeeConfig>,
  'get_available_claims' : ActorMethod<
    [],
    Array<
      {
        'allocation_id' : string,
        'token_canister_id' : Principal,
        'claimable_amount' : { 'min_e8s' : bigint, 'max_e8s' : bigint },
        'achievement_id' : string,
      }
    >
  >,
  'get_available_claims_with_sponsors' : ActorMethod<
    [],
    Array<
      {
        'allocation_id' : string,
        'token_canister_id' : Principal,
        'claimable_amount' : { 'min_e8s' : bigint, 'max_e8s' : bigint },
        'sponsor' : SponsorInfo,
        'achievement_id' : string,
      }
    >
  >,
  'get_cached_logo_count' : ActorMethod<[], bigint>,
  'get_custom_tokens' : ActorMethod<[], Array<[Principal, TokenMetadata]>>,
  'get_cut_account' : ActorMethod<[], [] | [Account]>,
  'get_cycle_balance' : ActorMethod<[], bigint>,
  'get_derived_subaccount' : ActorMethod<[Principal, bigint], Result_8>,
  'get_global_stats' : ActorMethod<[], GlobalStats>,
  'get_icpswap_token_count' : ActorMethod<[], bigint>,
  'get_icpswap_tokens' : ActorMethod<[], Array<[Principal, TokenMetadata]>>,
  'get_import_progress' : ActorMethod<[], ImportProgress>,
  'get_logo_update_progress' : ActorMethod<
    [],
    {
      'skipped_count' : bigint,
      'updated_count' : bigint,
      'processed_count' : bigint,
      'last_processed' : [] | [Principal],
      'is_running' : boolean,
      'total_tokens' : bigint,
      'failed_count' : bigint,
    }
  >,
  'get_metadata_discrepancies' : ActorMethod<[], Array<MetadataDiscrepancy>>,
  'get_metadata_refresh_progress' : ActorMethod<[], MetadataRefreshProgress>,
  'get_my_created_allocations' : ActorMethod<[], Result_7>,
  'get_my_token_savings_stats' : ActorMethod<
    [],
    Array<[string, TokenSavingsStats]>
  >,
  'get_my_token_stats' : ActorMethod<[], Array<[string, UserTokenStats]>>,
  'get_named_subaccounts' : ActorMethod<[Principal], Result_6>,
  'get_next_user_index' : ActorMethod<[], number>,
  'get_paginated_logos' : ActorMethod<[bigint], PaginatedLogosResponse>,
  'get_panic_mode' : ActorMethod<[], boolean>,
  'get_payment_account' : ActorMethod<[], [] | [Account]>,
  'get_pool_metadata' : ActorMethod<[Principal], [] | [PoolMetadata]>,
  'get_popular_tokens' : ActorMethod<
    [bigint],
    Array<[Principal, TokenMetadata]>
  >,
  'get_psa_message' : ActorMethod<[], string>,
  'get_server_balance' : ActorMethod<[Principal], bigint>,
  'get_token_logo' : ActorMethod<[Principal], [] | [string]>,
  'get_token_metadata' : ActorMethod<[Principal], [] | [TokenMetadata]>,
  'get_token_savings_stats' : ActorMethod<[string], [] | [TokenSavingsStats]>,
  'get_token_stats' : ActorMethod<[string], [] | [TokenStats]>,
  'get_unique_trader_count' : ActorMethod<[], bigint>,
  'get_unique_user_count' : ActorMethod<[], bigint>,
  'get_user_achievements' : ActorMethod<[], Array<UserAchievement>>,
  'get_user_balance' : ActorMethod<[Principal], bigint>,
  'get_user_claim' : ActorMethod<[string, Principal], [] | [AllocationClaim]>,
  'get_user_claims' : ActorMethod<
    [],
    Array<{ 'claim' : AllocationClaim, 'allocation' : Allocation }>
  >,
  'get_user_claims_with_sponsors' : ActorMethod<
    [],
    Array<
      {
        'claim' : AllocationClaim,
        'sponsor' : SponsorInfo,
        'allocation' : Allocation,
      }
    >
  >,
  'get_user_donations' : ActorMethod<[Principal], Array<DonationEvent>>,
  'get_user_pools' : ActorMethod<
    [],
    Array<{ 'metadata' : [] | [PoolMetadata], 'canisterId' : Principal }>
  >,
  'get_user_stats' : ActorMethod<[Principal], [] | [UserStats]>,
  'get_user_token_allocation_stats' : ActorMethod<
    [string],
    Array<[string, UserTokenAllocationStats]>
  >,
  'get_wallet_tokens' : ActorMethod<[], Array<string>>,
  'get_whitelisted_tokens' : ActorMethod<[], Array<[Principal, TokenMetadata]>>,
  'init_admin' : ActorMethod<[], Result_1>,
  'is_admin' : ActorMethod<[], boolean>,
  'is_suspended' : ActorMethod<[Principal], [] | [SuspendedStatus]>,
  'listUserProfiles' : ActorMethod<[bigint, bigint], Array<UserProfile>>,
  'record_deposit' : ActorMethod<
    [Principal, string, bigint, Principal],
    undefined
  >,
  'record_donation' : ActorMethod<
    [bigint, Principal, number, string],
    Result_1
  >,
  'record_icpswap_swap' : ActorMethod<
    [Principal, string, bigint, string, bigint, bigint, Principal],
    undefined
  >,
  'record_kong_swap' : ActorMethod<
    [Principal, string, bigint, string, bigint, bigint],
    undefined
  >,
  'record_login' : ActorMethod<[Principal], undefined>,
  'record_send' : ActorMethod<[Principal, string, bigint], undefined>,
  'record_split_swap' : ActorMethod<
    [
      Principal,
      string,
      bigint,
      bigint,
      string,
      bigint,
      bigint,
      bigint,
      Principal,
    ],
    undefined
  >,
  'record_transfer' : ActorMethod<
    [Principal, string, bigint, Principal],
    undefined
  >,
  'record_withdrawal' : ActorMethod<
    [Principal, string, bigint, Principal],
    undefined
  >,
  'refresh_token_metadata' : ActorMethod<[Principal], Result_5>,
  'register_custom_token' : ActorMethod<[Principal], Result_4>,
  'remove_achievement' : ActorMethod<[string], Result_1>,
  'remove_admin' : ActorMethod<[Principal], Result_1>,
  'remove_custom_token' : ActorMethod<[Principal], boolean>,
  'remove_named_subaccount' : ActorMethod<[RemoveSubaccountArgs], Result_1>,
  'remove_pool' : ActorMethod<[Principal], Result_1>,
  'remove_token' : ActorMethod<[Principal], Result_1>,
  'remove_wallet_token' : ActorMethod<[string], boolean>,
  'resume_metadata_refresh' : ActorMethod<[bigint], Result_1>,
  'scan_for_new_achievements' : ActorMethod<
    [],
    {
      'new_achievements' : Array<UserAchievement>,
      'available_claims' : Array<
        {
          'allocation_id' : string,
          'claimable_amount' : { 'min_e8s' : bigint, 'max_e8s' : bigint },
          'achievement_id' : string,
        }
      >,
    }
  >,
  'searchUserProfiles' : ActorMethod<[string], Array<UserProfile>>,
  'set_panic_mode' : ActorMethod<[boolean], Result_1>,
  'set_psa_message' : ActorMethod<[string], Result_1>,
  'set_token_logo' : ActorMethod<[Principal, string], Result_1>,
  'start_icpswap_import' : ActorMethod<[bigint], Result_1>,
  'start_metadata_refresh' : ActorMethod<[bigint], Result_1>,
  'stop_icpswap_import' : ActorMethod<[], Result_1>,
  'stop_logo_update' : ActorMethod<[], Result_1>,
  'stop_metadata_refresh' : ActorMethod<[], Result_1>,
  'suspend_principal' : ActorMethod<[Principal, SuspendedStatus], Result_1>,
  'top_up_allocation' : ActorMethod<[bigint, bigint], Result_1>,
  'transfer_allocation' : ActorMethod<[bigint, Principal], Result_1>,
  'unsuspend_principal' : ActorMethod<[Principal], Result_1>,
  'updateUserProfile' : ActorMethod<
    [Principal, UpdateUserProfileArgs],
    Result_3
  >,
  'update_achievement' : ActorMethod<[Achievement], Result_1>,
  'update_allocation_fee_config' : ActorMethod<[AllocationFeeConfig], Result_1>,
  'update_cut_account' : ActorMethod<[Account], Result_1>,
  'update_icpswap_token_logos' : ActorMethod<[bigint], Result_2>,
  'update_payment_account' : ActorMethod<[Account], Result_1>,
  'update_pool_metadata' : ActorMethod<[Principal, PoolMetadata], Result_1>,
  'withdraw_from_balance' : ActorMethod<[Principal, bigint], Result>,
}
export interface Token { 'address' : string, 'standard' : string }
export interface TokenAllocationStats {
  'total_claimed_e8s' : bigint,
  'claim_count' : bigint,
  'total_allocated_e8s' : bigint,
  'allocation_count' : bigint,
  'total_cuts_paid_e8s' : bigint,
  'total_fees_paid_e8s' : bigint,
}
export interface TokenMetadata {
  'fee' : [] | [bigint],
  'decimals' : [] | [number],
  'hasLogo' : boolean,
  'name' : [] | [string],
  'standard' : string,
  'symbol' : [] | [string],
}
export interface TokenSavingsStats {
  'split_savings_e8s' : bigint,
  'icpswap_savings_e8s' : bigint,
  'kong_savings_e8s' : bigint,
}
export interface TokenStats {
  'total_sends' : bigint,
  'total_swaps' : bigint,
  'volume_e8s' : bigint,
  'total_deposits' : bigint,
  'icpswap_swaps' : bigint,
  'total_withdrawals' : bigint,
  'withdrawals_volume_e8s' : bigint,
  'kong_swaps' : bigint,
  'sends_volume_e8s' : bigint,
  'split_swaps' : bigint,
  'deposits_volume_e8s' : bigint,
}
export interface UpdateUserProfileArgs {
  'verified' : [] | [boolean],
  'name' : [] | [string],
  'description' : [] | [string],
  'logo_url' : [] | [string],
  'social_links' : [] | [Array<SocialLink>],
}
export interface UserAchievement {
  'user' : Principal,
  'achievement_id' : string,
  'discovered_at' : bigint,
}
export interface UserProfile {
  'updated_at' : bigint,
  'principal' : Principal,
  'verified' : boolean,
  'name' : string,
  'description' : string,
  'created_at' : bigint,
  'created_by' : Principal,
  'logo_url' : [] | [string],
  'social_links' : Array<SocialLink>,
}
export interface UserStats {
  'total_sends' : bigint,
  'total_swaps' : bigint,
  'total_deposits' : bigint,
  'icpswap_swaps' : bigint,
  'total_withdrawals' : bigint,
  'kong_swaps' : bigint,
  'split_swaps' : bigint,
}
export interface UserTokenAllocationStats {
  'total_claimed_e8s' : bigint,
  'claim_count' : bigint,
  'total_allocated_e8s' : bigint,
  'allocation_count' : bigint,
  'total_cuts_paid_e8s' : bigint,
  'total_fees_paid_e8s' : bigint,
}
export interface UserTokenStats {
  'swaps_as_output_icpswap' : bigint,
  'total_sends' : bigint,
  'output_volume_e8s_icpswap' : bigint,
  'input_volume_e8s_icpswap' : bigint,
  'swaps_as_input_split' : bigint,
  'total_deposits' : bigint,
  'total_withdrawals' : bigint,
  'savings_as_output_split_e8s' : bigint,
  'input_volume_e8s_kong' : bigint,
  'swaps_as_input_kong' : bigint,
  'savings_as_output_kong_e8s' : bigint,
  'swaps_as_output_kong' : bigint,
  'savings_as_output_icpswap_e8s' : bigint,
  'swaps_as_input_icpswap' : bigint,
  'swaps_as_output_split' : bigint,
  'output_volume_e8s_kong' : bigint,
  'output_volume_e8s_split' : bigint,
  'input_volume_e8s_split' : bigint,
}
export interface UserTokenSubaccounts {
  'subaccounts' : Array<NamedSubaccount>,
  'token_id' : Principal,
}
export interface _SERVICE extends SwapRunner {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
