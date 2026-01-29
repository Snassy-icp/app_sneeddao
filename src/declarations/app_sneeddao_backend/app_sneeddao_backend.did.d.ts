import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface AppSneedDaoBackend {
  'add_admin' : ActorMethod<[Principal], undefined>,
  'add_authorized_for_caller' : ActorMethod<[Principal], undefined>,
  'add_blacklisted_word' : ActorMethod<[string], Result_2>,
  'add_partner' : ActorMethod<
    [string, string, string, Array<PartnerLink>, [] | [bigint]],
    Result
  >,
  'add_project' : ActorMethod<
    [
      string,
      [] | [string],
      string,
      ProjectType,
      Array<ProjectLink>,
      [] | [bigint],
    ],
    Result
  >,
  'add_whitelisted_token' : ActorMethod<[WhitelistedToken], undefined>,
  'ban_user' : ActorMethod<[Principal, bigint, string], Result_2>,
  'caller_is_admin' : ActorMethod<[], boolean>,
  'check_ban_status' : ActorMethod<[Principal], Result_2>,
  'delete_canister_groups' : ActorMethod<[], undefined>,
  'delete_jailbreak_config' : ActorMethod<[bigint], Result_2>,
  'get_admins' : ActorMethod<[], Array<Principal>>,
  'get_all_jailbreak_configs_count' : ActorMethod<[], Result>,
  'get_all_neuron_names' : ActorMethod<
    [],
    Array<[NeuronNameKey, [string, boolean]]>
  >,
  'get_all_neuron_nicknames' : ActorMethod<[], Array<[NeuronNameKey, string]>>,
  'get_all_principal_names' : ActorMethod<
    [],
    Array<[Principal, [string, boolean]]>
  >,
  'get_all_principal_nicknames' : ActorMethod<[], Array<[Principal, string]>>,
  'get_authorized_for_callers' : ActorMethod<[], Array<Principal>>,
  'get_ban_log' : ActorMethod<[], Result_5>,
  'get_banned_users' : ActorMethod<[], Result_9>,
  'get_blacklisted_words' : ActorMethod<[], Array<string>>,
  'get_cached_token_meta' : ActorMethod<[Principal], [] | [TokenMeta]>,
  'get_canister_groups' : ActorMethod<[], [] | [CanisterGroupsRoot]>,
  'get_canister_groups_limits_config' : ActorMethod<
    [],
    {
      'premium_max_canisters_per_group' : bigint,
      'premium_max_total_grouped_canisters' : bigint,
      'max_canisters_per_group' : bigint,
      'max_total_grouped_canisters' : bigint,
      'premium_max_canister_groups' : bigint,
      'max_canister_groups' : bigint,
    }
  >,
  'get_canister_info' : ActorMethod<[Principal], Result_8>,
  'get_jailbreak_fee_settings' : ActorMethod<
    [],
    {
      'fee_account_subaccount' : [] | [Uint8Array | number[]],
      'fee_premium_e8s' : bigint,
      'fee_regular_e8s' : bigint,
      'fee_account_owner' : [] | [Principal],
    }
  >,
  'get_jailbreak_payment_balance' : ActorMethod<[], bigint>,
  'get_jailbreak_payment_logs' : ActorMethod<[bigint, bigint], Result_7>,
  'get_jailbreak_payment_stats' : ActorMethod<[], Result_6>,
  'get_jailbreak_payment_subaccount' : ActorMethod<[], Uint8Array | number[]>,
  'get_ledger_canister_ids' : ActorMethod<[], Array<Principal>>,
  'get_my_canister_groups_usage' : ActorMethod<
    [],
    {
      'total_limit' : bigint,
      'is_premium' : boolean,
      'max_in_single_group' : bigint,
      'per_group_limit' : bigint,
      'ungrouped_count' : bigint,
      'group_count' : bigint,
      'group_limit' : bigint,
      'total_canisters' : bigint,
    }
  >,
  'get_my_jailbreak_configs' : ActorMethod<[], Array<JailbreakConfig>>,
  'get_my_jailbreak_fee' : ActorMethod<[], bigint>,
  'get_my_nickname_usage' : ActorMethod<
    [],
    {
      'neuron_nickname_count' : bigint,
      'is_premium' : boolean,
      'neuron_nickname_limit' : bigint,
      'principal_nickname_count' : bigint,
      'principal_nickname_limit' : bigint,
    }
  >,
  'get_neuron_name' : ActorMethod<
    [Principal, NeuronId],
    [] | [[string, boolean]]
  >,
  'get_neuron_nickname' : ActorMethod<[Principal, NeuronId], [] | [string]>,
  'get_nickname_limits_config' : ActorMethod<
    [],
    {
      'premium_max_neuron_nicknames' : bigint,
      'premium_max_principal_nicknames' : bigint,
      'sneed_premium_canister_id' : [] | [Principal],
      'max_principal_nicknames' : bigint,
      'max_neuron_nicknames' : bigint,
    }
  >,
  'get_partner' : ActorMethod<[bigint], [] | [Partner]>,
  'get_partners' : ActorMethod<[], Array<Partner>>,
  'get_principal_name' : ActorMethod<[Principal], [] | [[string, boolean]]>,
  'get_principal_nickname' : ActorMethod<[Principal], [] | [string]>,
  'get_project' : ActorMethod<[bigint], [] | [Project]>,
  'get_projects' : ActorMethod<[], Array<Project>>,
  'get_swap_canister_ids' : ActorMethod<[], Array<Principal>>,
  'get_tracked_canisters' : ActorMethod<[], Array<Principal>>,
  'get_user_ban_history' : ActorMethod<[Principal], Result_5>,
  'get_user_neurons' : ActorMethod<[], Result_4>,
  'get_user_tokens' : ActorMethod<[], Array<Principal>>,
  'get_whitelisted_tokens' : ActorMethod<[], Array<WhitelistedToken>>,
  'import_whitelist_from_swaprunner' : ActorMethod<[], undefined>,
  'is_token_whitelisted' : ActorMethod<[Principal], boolean>,
  'refresh_all_token_metadata' : ActorMethod<
    [],
    { 'errors' : Array<string>, 'success' : bigint, 'failed' : bigint }
  >,
  'refresh_token_metadata' : ActorMethod<[Principal], Result_3>,
  'register_ledger_canister_id' : ActorMethod<[Principal], undefined>,
  'register_swap_canister_id' : ActorMethod<[Principal], undefined>,
  'register_tracked_canister' : ActorMethod<[Principal], undefined>,
  'register_tracked_canister_for' : ActorMethod<
    [Principal, Principal],
    undefined
  >,
  'register_user_token' : ActorMethod<[Principal], undefined>,
  'register_user_token_for' : ActorMethod<[Principal, Principal], undefined>,
  'remove_admin' : ActorMethod<[Principal], undefined>,
  'remove_authorized_for_caller' : ActorMethod<[Principal], undefined>,
  'remove_blacklisted_word' : ActorMethod<[string], Result_2>,
  'remove_partner' : ActorMethod<[bigint], Result_2>,
  'remove_project' : ActorMethod<[bigint], Result_2>,
  'remove_whitelisted_token' : ActorMethod<[Principal], undefined>,
  'save_jailbreak_config' : ActorMethod<[Principal, string, Principal], Result>,
  'send_tokens' : ActorMethod<[Principal, bigint, Principal], TransferResult>,
  'set_cached_token_meta' : ActorMethod<[Principal, TokenMeta], undefined>,
  'set_canister_groups' : ActorMethod<[CanisterGroupsRoot], Result_2>,
  'set_canister_name' : ActorMethod<[Principal, string], Result_1>,
  'set_jailbreak_fee_settings' : ActorMethod<
    [
      [] | [bigint],
      [] | [bigint],
      [] | [[] | [Principal]],
      [] | [[] | [Uint8Array | number[]]],
    ],
    Result_2
  >,
  'set_neuron_name' : ActorMethod<[Principal, NeuronId, string], Result_1>,
  'set_neuron_nickname' : ActorMethod<[Principal, NeuronId, string], Result_1>,
  'set_nickname_premium_canister' : ActorMethod<[[] | [Principal]], Result_2>,
  'set_principal_name' : ActorMethod<[string], Result_1>,
  'set_principal_name_for' : ActorMethod<
    [Principal, string, [] | [Principal]],
    Result_1
  >,
  'set_principal_nickname' : ActorMethod<[Principal, string], Result_1>,
  'test_calculate_ban_duration' : ActorMethod<[Principal], bigint>,
  'transfer_position' : ActorMethod<
    [Principal, Principal, bigint],
    TransferPositionResult
  >,
  'unban_user' : ActorMethod<[Principal], Result_2>,
  'unregister_ledger_canister_id' : ActorMethod<[Principal], undefined>,
  'unregister_swap_canister_id' : ActorMethod<[Principal], undefined>,
  'unregister_tracked_canister' : ActorMethod<[Principal], undefined>,
  'unregister_tracked_canister_for' : ActorMethod<
    [Principal, Principal],
    undefined
  >,
  'unregister_user_token' : ActorMethod<[Principal], undefined>,
  'unregister_user_token_for' : ActorMethod<[Principal, Principal], undefined>,
  'unverify_neuron_name' : ActorMethod<[Principal, NeuronId], Result_1>,
  'unverify_principal_name' : ActorMethod<[Principal], Result_1>,
  'update_canister_groups_limits' : ActorMethod<
    [
      [] | [bigint],
      [] | [bigint],
      [] | [bigint],
      [] | [bigint],
      [] | [bigint],
      [] | [bigint],
    ],
    Result_2
  >,
  'update_nickname_limits' : ActorMethod<
    [[] | [bigint], [] | [bigint], [] | [bigint], [] | [bigint]],
    Result_2
  >,
  'update_partner' : ActorMethod<
    [bigint, string, string, string, Array<PartnerLink>, [] | [bigint]],
    Result_2
  >,
  'update_project' : ActorMethod<
    [
      bigint,
      string,
      [] | [string],
      string,
      ProjectType,
      Array<ProjectLink>,
      [] | [bigint],
    ],
    Result_2
  >,
  'verify_neuron_name' : ActorMethod<[Principal, NeuronId], Result_1>,
  'verify_principal_name' : ActorMethod<[Principal], Result_1>,
  'withdraw_jailbreak_payment' : ActorMethod<[bigint], Result>,
}
export type Balance = bigint;
export interface BanLogEntry {
  'admin' : Principal,
  'user' : Principal,
  'expiry_timestamp' : bigint,
  'reason' : string,
  'ban_timestamp' : bigint,
}
export interface CanisterGroup {
  'id' : string,
  'name' : string,
  'canisters' : Array<Principal>,
  'subgroups' : Array<CanisterGroup>,
}
export interface CanisterGroupsRoot {
  'groups' : Array<CanisterGroup>,
  'ungrouped' : Array<Principal>,
}
export interface JailbreakConfig {
  'id' : bigint,
  'sns_root_canister_id' : Principal,
  'target_principal' : Principal,
  'created_at' : bigint,
  'neuron_id_hex' : string,
}
export interface JailbreakPaymentLog {
  'id' : bigint,
  'sns_root_canister_id' : Principal,
  'is_premium' : boolean,
  'target_principal' : Principal,
  'user' : Principal,
  'amount_e8s' : bigint,
  'timestamp' : bigint,
  'neuron_id_hex' : string,
  'config_id' : bigint,
}
export interface Neuron {
  'id' : [] | [NeuronId],
  'permissions' : Array<[Principal, Int32Array | number[]]>,
}
export interface NeuronId { 'id' : Uint8Array | number[] }
export interface NeuronNameKey {
  'sns_root_canister_id' : Principal,
  'neuron_id' : NeuronId,
}
export interface Partner {
  'id' : bigint,
  'updated_at' : bigint,
  'name' : string,
  'description' : string,
  'created_at' : bigint,
  'links' : Array<PartnerLink>,
  'logo_url' : string,
  'index' : [] | [bigint],
}
export interface PartnerLink { 'url' : string, 'title' : string }
export interface Project {
  'id' : bigint,
  'updated_at' : bigint,
  'name' : string,
  'description' : string,
  'created_at' : bigint,
  'links' : Array<ProjectLink>,
  'logo_url' : [] | [string],
  'index' : [] | [bigint],
  'project_type' : ProjectType,
}
export interface ProjectLink { 'url' : string, 'title' : string }
export type ProjectType = { 'fork' : null } |
  { 'product' : null } |
  { 'project' : null };
export type Result = { 'ok' : bigint } |
  { 'err' : string };
export type Result_1 = { 'ok' : string } |
  { 'err' : string };
export type Result_2 = { 'ok' : null } |
  { 'err' : string };
export type Result_3 = { 'ok' : WhitelistedToken } |
  { 'err' : string };
export type Result_4 = { 'ok' : Array<Neuron> } |
  { 'err' : string };
export type Result_5 = { 'ok' : Array<BanLogEntry> } |
  { 'err' : string };
export type Result_6 = {
    'ok' : {
      'total_scripts_created' : bigint,
      'premium_revenue_e8s' : bigint,
      'total_premium_payments' : bigint,
      'regular_revenue_e8s' : bigint,
      'total_regular_payments' : bigint,
      'unique_users' : bigint,
      'total_revenue_e8s' : bigint,
    }
  } |
  { 'err' : string };
export type Result_7 = {
    'ok' : { 'total' : bigint, 'logs' : Array<JailbreakPaymentLog> }
  } |
  { 'err' : string };
export type Result_8 = {
    'ok' : {
      'controllers' : Array<Principal>,
      'module_hash' : [] | [Uint8Array | number[]],
    }
  } |
  { 'err' : string };
export type Result_9 = { 'ok' : Array<[Principal, bigint]> } |
  { 'err' : string };
export type Timestamp = bigint;
export interface TokenMeta {
  'token0' : Array<[string, TokenMetaValue]>,
  'token1' : Array<[string, TokenMetaValue]>,
}
export type TokenMetaValue = { 'Int' : bigint } |
  { 'Nat' : bigint } |
  { 'Blob' : Uint8Array | number[] } |
  { 'Text' : string };
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
export type TransferPositionError = { 'CommonError' : null } |
  { 'InternalError' : string } |
  { 'UnsupportedToken' : string } |
  { 'InsufficientFunds' : null };
export type TransferPositionResult = { 'ok' : boolean } |
  { 'err' : TransferPositionError };
export type TransferResult = { 'Ok' : TxIndex } |
  { 'Err' : TransferError };
export type TxIndex = bigint;
export interface WhitelistedToken {
  'fee' : bigint,
  'decimals' : number,
  'name' : string,
  'ledger_id' : Principal,
  'standard' : string,
  'symbol' : string,
}
export interface _SERVICE extends AppSneedDaoBackend {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
