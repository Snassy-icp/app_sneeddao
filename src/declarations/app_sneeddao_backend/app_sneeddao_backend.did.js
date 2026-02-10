export const idlFactory = ({ IDL }) => {
  const CanisterGroup = IDL.Rec();
  const Result_2 = IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text });
  const PartnerLink = IDL.Record({ 'url' : IDL.Text, 'title' : IDL.Text });
  const Result = IDL.Variant({ 'ok' : IDL.Nat, 'err' : IDL.Text });
  const ProjectType = IDL.Variant({
    'fork' : IDL.Null,
    'product' : IDL.Null,
    'project' : IDL.Null,
  });
  const ProjectLink = IDL.Record({ 'url' : IDL.Text, 'title' : IDL.Text });
  const WhitelistedToken = IDL.Record({
    'fee' : IDL.Nat,
    'decimals' : IDL.Nat8,
    'name' : IDL.Text,
    'ledger_id' : IDL.Principal,
    'standard' : IDL.Text,
    'symbol' : IDL.Text,
  });
  const NeuronId = IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) });
  const NeuronNameKey = IDL.Record({
    'sns_root_canister_id' : IDL.Principal,
    'neuron_id' : NeuronId,
  });
  const BanLogEntry = IDL.Record({
    'admin' : IDL.Principal,
    'user' : IDL.Principal,
    'expiry_timestamp' : IDL.Int,
    'reason' : IDL.Text,
    'ban_timestamp' : IDL.Int,
  });
  const Result_6 = IDL.Variant({
    'ok' : IDL.Vec(BanLogEntry),
    'err' : IDL.Text,
  });
  const Result_10 = IDL.Variant({
    'ok' : IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Int)),
    'err' : IDL.Text,
  });
  const TokenMetaValue = IDL.Variant({
    'Int' : IDL.Int,
    'Nat' : IDL.Nat,
    'Blob' : IDL.Vec(IDL.Nat8),
    'Text' : IDL.Text,
  });
  const TokenMeta = IDL.Record({
    'token0' : IDL.Vec(IDL.Tuple(IDL.Text, TokenMetaValue)),
    'token1' : IDL.Vec(IDL.Tuple(IDL.Text, TokenMetaValue)),
  });
  CanisterGroup.fill(
    IDL.Record({
      'id' : IDL.Text,
      'name' : IDL.Text,
      'canisters' : IDL.Vec(IDL.Principal),
      'subgroups' : IDL.Vec(CanisterGroup),
    })
  );
  const CanisterGroupsRoot = IDL.Record({
    'groups' : IDL.Vec(CanisterGroup),
    'ungrouped' : IDL.Vec(IDL.Principal),
  });
  const Result_9 = IDL.Variant({
    'ok' : IDL.Record({
      'controllers' : IDL.Vec(IDL.Principal),
      'module_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    }),
    'err' : IDL.Text,
  });
  const JailbreakPaymentLog = IDL.Record({
    'id' : IDL.Nat,
    'sns_root_canister_id' : IDL.Principal,
    'is_premium' : IDL.Bool,
    'target_principal' : IDL.Principal,
    'user' : IDL.Principal,
    'amount_e8s' : IDL.Nat,
    'timestamp' : IDL.Int,
    'neuron_id_hex' : IDL.Text,
    'config_id' : IDL.Nat,
  });
  const Result_8 = IDL.Variant({
    'ok' : IDL.Record({
      'total' : IDL.Nat,
      'logs' : IDL.Vec(JailbreakPaymentLog),
    }),
    'err' : IDL.Text,
  });
  const Result_7 = IDL.Variant({
    'ok' : IDL.Record({
      'total_scripts_created' : IDL.Nat,
      'premium_revenue_e8s' : IDL.Nat,
      'total_premium_payments' : IDL.Nat,
      'regular_revenue_e8s' : IDL.Nat,
      'total_regular_payments' : IDL.Nat,
      'unique_users' : IDL.Nat,
      'total_revenue_e8s' : IDL.Nat,
    }),
    'err' : IDL.Text,
  });
  const JailbreakConfig = IDL.Record({
    'id' : IDL.Nat,
    'sns_root_canister_id' : IDL.Principal,
    'target_principal' : IDL.Principal,
    'created_at' : IDL.Int,
    'neuron_id_hex' : IDL.Text,
  });
  const UserSettings = IDL.Record({
    'expand_quick_links_on_desktop' : IDL.Bool,
    'canister_manager_cycle_threshold_orange' : IDL.Nat,
    'principal_color_coding' : IDL.Bool,
    'frontend_auto_update_enabled' : IDL.Bool,
    'show_vp_bar' : IDL.Bool,
    'neuron_manager_cycle_threshold_red' : IDL.Nat,
    'neuron_color_coding' : IDL.Bool,
    'particle_effects_enabled' : IDL.Bool,
    'swap_slippage_tolerance' : IDL.Float64,
    'canister_manager_cycle_threshold_red' : IDL.Nat,
    'frontend_update_countdown_sec' : IDL.Nat,
    'frontend_update_check_interval_sec' : IDL.Nat,
    'show_header_notifications' : IDL.Bool,
    'collectibles_threshold' : IDL.Float64,
    'neuron_manager_cycle_threshold_orange' : IDL.Nat,
  });
  const Partner = IDL.Record({
    'id' : IDL.Nat,
    'updated_at' : IDL.Int,
    'name' : IDL.Text,
    'description' : IDL.Text,
    'created_at' : IDL.Int,
    'links' : IDL.Vec(PartnerLink),
    'logo_url' : IDL.Text,
    'index' : IDL.Opt(IDL.Nat),
  });
  const Project = IDL.Record({
    'id' : IDL.Nat,
    'updated_at' : IDL.Int,
    'name' : IDL.Text,
    'description' : IDL.Text,
    'created_at' : IDL.Int,
    'links' : IDL.Vec(ProjectLink),
    'logo_url' : IDL.Opt(IDL.Text),
    'index' : IDL.Opt(IDL.Nat),
    'project_type' : ProjectType,
  });
  const RefreshAllProgress = IDL.Record({
    'total' : IDL.Nat,
    'errors' : IDL.Vec(IDL.Text),
    'success' : IDL.Nat,
    'current_token' : IDL.Text,
    'is_running' : IDL.Bool,
    'processed' : IDL.Nat,
    'failed' : IDL.Nat,
  });
  const Neuron = IDL.Record({
    'id' : IDL.Opt(NeuronId),
    'permissions' : IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(IDL.Int32))),
  });
  const Result_5 = IDL.Variant({ 'ok' : IDL.Vec(Neuron), 'err' : IDL.Text });
  const Result_4 = IDL.Variant({ 'ok' : WhitelistedToken, 'err' : IDL.Text });
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
  const Result_1 = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const UserSettingsUpdate = IDL.Record({
    'expand_quick_links_on_desktop' : IDL.Opt(IDL.Bool),
    'canister_manager_cycle_threshold_orange' : IDL.Opt(IDL.Nat),
    'principal_color_coding' : IDL.Opt(IDL.Bool),
    'frontend_auto_update_enabled' : IDL.Opt(IDL.Bool),
    'show_vp_bar' : IDL.Opt(IDL.Bool),
    'neuron_manager_cycle_threshold_red' : IDL.Opt(IDL.Nat),
    'neuron_color_coding' : IDL.Opt(IDL.Bool),
    'particle_effects_enabled' : IDL.Opt(IDL.Bool),
    'swap_slippage_tolerance' : IDL.Opt(IDL.Float64),
    'canister_manager_cycle_threshold_red' : IDL.Opt(IDL.Nat),
    'frontend_update_countdown_sec' : IDL.Opt(IDL.Nat),
    'frontend_update_check_interval_sec' : IDL.Opt(IDL.Nat),
    'show_header_notifications' : IDL.Opt(IDL.Bool),
    'collectibles_threshold' : IDL.Opt(IDL.Float64),
    'neuron_manager_cycle_threshold_orange' : IDL.Opt(IDL.Nat),
  });
  const Result_3 = IDL.Variant({ 'ok' : UserSettings, 'err' : IDL.Text });
  const TransferPositionError = IDL.Variant({
    'CommonError' : IDL.Null,
    'InternalError' : IDL.Text,
    'UnsupportedToken' : IDL.Text,
    'InsufficientFunds' : IDL.Null,
  });
  const TransferPositionResult = IDL.Variant({
    'ok' : IDL.Bool,
    'err' : TransferPositionError,
  });
  const AppSneedDaoBackend = IDL.Service({
    'add_admin' : IDL.Func([IDL.Principal], [], []),
    'add_authorized_for_caller' : IDL.Func([IDL.Principal], [], []),
    'add_blacklisted_word' : IDL.Func([IDL.Text], [Result_2], []),
    'add_partner' : IDL.Func(
        [IDL.Text, IDL.Text, IDL.Text, IDL.Vec(PartnerLink), IDL.Opt(IDL.Nat)],
        [Result],
        [],
      ),
    'add_project' : IDL.Func(
        [
          IDL.Text,
          IDL.Opt(IDL.Text),
          IDL.Text,
          ProjectType,
          IDL.Vec(ProjectLink),
          IDL.Opt(IDL.Nat),
        ],
        [Result],
        [],
      ),
    'add_whitelisted_token' : IDL.Func([WhitelistedToken], [], []),
    'ban_user' : IDL.Func([IDL.Principal, IDL.Nat, IDL.Text], [Result_2], []),
    'caller_is_admin' : IDL.Func([], [IDL.Bool], ['query']),
    'check_ban_status' : IDL.Func([IDL.Principal], [Result_2], ['query']),
    'delete_canister_groups' : IDL.Func([], [], []),
    'delete_jailbreak_config' : IDL.Func([IDL.Nat], [Result_2], []),
    'get_admins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_all_jailbreak_configs_count' : IDL.Func([], [Result], ['query']),
    'get_all_neuron_names' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(NeuronNameKey, IDL.Tuple(IDL.Text, IDL.Bool)))],
        ['query'],
      ),
    'get_all_neuron_nicknames' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(NeuronNameKey, IDL.Text))],
        ['query'],
      ),
    'get_all_principal_names' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Tuple(IDL.Text, IDL.Bool)))],
        ['query'],
      ),
    'get_all_principal_nicknames' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Text))],
        ['query'],
      ),
    'get_authorized_for_callers' : IDL.Func(
        [],
        [IDL.Vec(IDL.Principal)],
        ['query'],
      ),
    'get_ban_log' : IDL.Func([], [Result_6], ['query']),
    'get_banned_users' : IDL.Func([], [Result_10], ['query']),
    'get_blacklisted_words' : IDL.Func([], [IDL.Vec(IDL.Text)], ['query']),
    'get_cached_token_meta' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(TokenMeta)],
        ['query'],
      ),
    'get_canister_groups' : IDL.Func(
        [],
        [IDL.Opt(CanisterGroupsRoot)],
        ['query'],
      ),
    'get_canister_groups_limits_config' : IDL.Func(
        [],
        [
          IDL.Record({
            'premium_max_canisters_per_group' : IDL.Nat,
            'premium_max_total_grouped_canisters' : IDL.Nat,
            'max_canisters_per_group' : IDL.Nat,
            'max_total_grouped_canisters' : IDL.Nat,
            'premium_max_canister_groups' : IDL.Nat,
            'max_canister_groups' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_canister_info' : IDL.Func([IDL.Principal], [Result_9], []),
    'get_jailbreak_fee_settings' : IDL.Func(
        [],
        [
          IDL.Record({
            'fee_account_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
            'fee_premium_e8s' : IDL.Nat,
            'fee_regular_e8s' : IDL.Nat,
            'fee_account_owner' : IDL.Opt(IDL.Principal),
          }),
        ],
        ['query'],
      ),
    'get_jailbreak_payment_balance' : IDL.Func([], [IDL.Nat], []),
    'get_jailbreak_payment_logs' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [Result_8],
        ['query'],
      ),
    'get_jailbreak_payment_stats' : IDL.Func([], [Result_7], ['query']),
    'get_jailbreak_payment_subaccount' : IDL.Func(
        [],
        [IDL.Vec(IDL.Nat8)],
        ['query'],
      ),
    'get_ledger_canister_ids' : IDL.Func(
        [],
        [IDL.Vec(IDL.Principal)],
        ['query'],
      ),
    'get_my_canister_groups_usage' : IDL.Func(
        [],
        [
          IDL.Record({
            'total_limit' : IDL.Nat,
            'is_premium' : IDL.Bool,
            'max_in_single_group' : IDL.Nat,
            'per_group_limit' : IDL.Nat,
            'ungrouped_count' : IDL.Nat,
            'group_count' : IDL.Nat,
            'group_limit' : IDL.Nat,
            'total_canisters' : IDL.Nat,
          }),
        ],
        [],
      ),
    'get_my_jailbreak_configs' : IDL.Func(
        [],
        [IDL.Vec(JailbreakConfig)],
        ['query'],
      ),
    'get_my_jailbreak_fee' : IDL.Func([], [IDL.Nat], []),
    'get_my_nickname_usage' : IDL.Func(
        [],
        [
          IDL.Record({
            'neuron_nickname_count' : IDL.Nat,
            'is_premium' : IDL.Bool,
            'neuron_nickname_limit' : IDL.Nat,
            'principal_nickname_count' : IDL.Nat,
            'principal_nickname_limit' : IDL.Nat,
          }),
        ],
        [],
      ),
    'get_my_settings' : IDL.Func([], [UserSettings], ['query']),
    'get_neuron_name' : IDL.Func(
        [IDL.Principal, NeuronId],
        [IDL.Opt(IDL.Tuple(IDL.Text, IDL.Bool))],
        ['query'],
      ),
    'get_neuron_nickname' : IDL.Func(
        [IDL.Principal, NeuronId],
        [IDL.Opt(IDL.Text)],
        ['query'],
      ),
    'get_nickname_limits_config' : IDL.Func(
        [],
        [
          IDL.Record({
            'premium_max_neuron_nicknames' : IDL.Nat,
            'premium_max_principal_nicknames' : IDL.Nat,
            'sneed_premium_canister_id' : IDL.Opt(IDL.Principal),
            'max_principal_nicknames' : IDL.Nat,
            'max_neuron_nicknames' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_partner' : IDL.Func([IDL.Nat], [IDL.Opt(Partner)], ['query']),
    'get_partners' : IDL.Func([], [IDL.Vec(Partner)], ['query']),
    'get_principal_name' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(IDL.Tuple(IDL.Text, IDL.Bool))],
        ['query'],
      ),
    'get_principal_nickname' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(IDL.Text)],
        ['query'],
      ),
    'get_project' : IDL.Func([IDL.Nat], [IDL.Opt(Project)], ['query']),
    'get_projects' : IDL.Func([], [IDL.Vec(Project)], ['query']),
    'get_refresh_all_progress' : IDL.Func([], [RefreshAllProgress], ['query']),
    'get_swap_canister_ids' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_tracked_canisters' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_user_ban_history' : IDL.Func([IDL.Principal], [Result_6], ['query']),
    'get_user_neurons' : IDL.Func([], [Result_5], []),
    'get_user_tokens' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_whitelisted_tokens' : IDL.Func(
        [],
        [IDL.Vec(WhitelistedToken)],
        ['query'],
      ),
    'import_whitelist_from_swaprunner' : IDL.Func([], [], []),
    'is_token_whitelisted' : IDL.Func([IDL.Principal], [IDL.Bool], ['query']),
    'refresh_token_metadata' : IDL.Func([IDL.Principal], [Result_4], []),
    'register_ledger_canister_id' : IDL.Func([IDL.Principal], [], []),
    'register_swap_canister_id' : IDL.Func([IDL.Principal], [], []),
    'register_tracked_canister' : IDL.Func([IDL.Principal], [], []),
    'register_tracked_canister_for' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [],
        [],
      ),
    'register_user_token' : IDL.Func([IDL.Principal], [], []),
    'register_user_token_for' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [],
        [],
      ),
    'remove_admin' : IDL.Func([IDL.Principal], [], []),
    'remove_authorized_for_caller' : IDL.Func([IDL.Principal], [], []),
    'remove_blacklisted_word' : IDL.Func([IDL.Text], [Result_2], []),
    'remove_partner' : IDL.Func([IDL.Nat], [Result_2], []),
    'remove_project' : IDL.Func([IDL.Nat], [Result_2], []),
    'remove_whitelisted_token' : IDL.Func([IDL.Principal], [], []),
    'save_jailbreak_config' : IDL.Func(
        [IDL.Principal, IDL.Text, IDL.Principal],
        [Result],
        [],
      ),
    'send_tokens' : IDL.Func(
        [IDL.Principal, IDL.Nat, IDL.Principal],
        [TransferResult],
        [],
      ),
    'set_cached_token_meta' : IDL.Func([IDL.Principal, TokenMeta], [], []),
    'set_canister_groups' : IDL.Func([CanisterGroupsRoot], [Result_2], []),
    'set_canister_name' : IDL.Func([IDL.Principal, IDL.Text], [Result_1], []),
    'set_jailbreak_fee_settings' : IDL.Func(
        [
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Opt(IDL.Principal)),
          IDL.Opt(IDL.Opt(IDL.Vec(IDL.Nat8))),
        ],
        [Result_2],
        [],
      ),
    'set_my_settings' : IDL.Func([UserSettingsUpdate], [Result_3], []),
    'set_neuron_name' : IDL.Func(
        [IDL.Principal, NeuronId, IDL.Text],
        [Result_1],
        [],
      ),
    'set_neuron_nickname' : IDL.Func(
        [IDL.Principal, NeuronId, IDL.Text],
        [Result_1],
        [],
      ),
    'set_nickname_premium_canister' : IDL.Func(
        [IDL.Opt(IDL.Principal)],
        [Result_2],
        [],
      ),
    'set_principal_name' : IDL.Func([IDL.Text], [Result_1], []),
    'set_principal_name_for' : IDL.Func(
        [IDL.Principal, IDL.Text, IDL.Opt(IDL.Principal)],
        [Result_1],
        [],
      ),
    'set_principal_nickname' : IDL.Func(
        [IDL.Principal, IDL.Text],
        [Result_1],
        [],
      ),
    'start_refresh_all_token_metadata' : IDL.Func([], [Result_2], []),
    'stop_refresh_all_token_metadata' : IDL.Func([], [], []),
    'test_calculate_ban_duration' : IDL.Func([IDL.Principal], [IDL.Nat], []),
    'transfer_position' : IDL.Func(
        [IDL.Principal, IDL.Principal, IDL.Nat],
        [TransferPositionResult],
        [],
      ),
    'unban_user' : IDL.Func([IDL.Principal], [Result_2], []),
    'unregister_ledger_canister_id' : IDL.Func([IDL.Principal], [], []),
    'unregister_swap_canister_id' : IDL.Func([IDL.Principal], [], []),
    'unregister_tracked_canister' : IDL.Func([IDL.Principal], [], []),
    'unregister_tracked_canister_for' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [],
        [],
      ),
    'unregister_user_token' : IDL.Func([IDL.Principal], [], []),
    'unregister_user_token_for' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [],
        [],
      ),
    'unverify_neuron_name' : IDL.Func(
        [IDL.Principal, NeuronId],
        [Result_1],
        [],
      ),
    'unverify_principal_name' : IDL.Func([IDL.Principal], [Result_1], []),
    'update_canister_groups_limits' : IDL.Func(
        [
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
        ],
        [Result_2],
        [],
      ),
    'update_nickname_limits' : IDL.Func(
        [
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
        ],
        [Result_2],
        [],
      ),
    'update_partner' : IDL.Func(
        [
          IDL.Nat,
          IDL.Text,
          IDL.Text,
          IDL.Text,
          IDL.Vec(PartnerLink),
          IDL.Opt(IDL.Nat),
        ],
        [Result_2],
        [],
      ),
    'update_project' : IDL.Func(
        [
          IDL.Nat,
          IDL.Text,
          IDL.Opt(IDL.Text),
          IDL.Text,
          ProjectType,
          IDL.Vec(ProjectLink),
          IDL.Opt(IDL.Nat),
        ],
        [Result_2],
        [],
      ),
    'verify_neuron_name' : IDL.Func([IDL.Principal, NeuronId], [Result_1], []),
    'verify_principal_name' : IDL.Func([IDL.Principal], [Result_1], []),
    'withdraw_jailbreak_payment' : IDL.Func([IDL.Nat], [Result], []),
  });
  return AppSneedDaoBackend;
};
export const init = ({ IDL }) => { return []; };
