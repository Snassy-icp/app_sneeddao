export const idlFactory = ({ IDL }) => {
  const PredicateExpression = IDL.Rec();
  const Result_1 = IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text });
  const ConditionUsage = IDL.Record({
    'parameters' : IDL.Vec(
      IDL.Variant({
        'Nat' : IDL.Nat,
        'Text' : IDL.Text,
        'Principal' : IDL.Principal,
      })
    ),
    'condition_key' : IDL.Text,
  });
  PredicateExpression.fill(
    IDL.Variant({
      'OR' : IDL.Tuple(PredicateExpression, PredicateExpression),
      'AND' : IDL.Tuple(PredicateExpression, PredicateExpression),
      'NOT' : PredicateExpression,
      'REF' : IDL.Nat,
    })
  );
  const Achievement = IDL.Record({
    'id' : IDL.Text,
    'name' : IDL.Text,
    'description' : IDL.Text,
    'condition_usages' : IDL.Vec(ConditionUsage),
    'logo_url' : IDL.Opt(IDL.Text),
    'criteria' : IDL.Text,
    'predicate' : IDL.Opt(PredicateExpression),
  });
  const AddSubaccountArgs = IDL.Record({
    'token_id' : IDL.Principal,
    'name' : IDL.Text,
    'subaccount' : IDL.Vec(IDL.Nat8),
  });
  const TokenMetadata = IDL.Record({
    'fee' : IDL.Opt(IDL.Nat),
    'decimals' : IDL.Opt(IDL.Nat8),
    'hasLogo' : IDL.Bool,
    'name' : IDL.Opt(IDL.Text),
    'standard' : IDL.Text,
    'symbol' : IDL.Opt(IDL.Text),
  });
  const AddTokenArgs = IDL.Record({
    'metadata' : TokenMetadata,
    'logo' : IDL.Opt(IDL.Text),
    'canisterId' : IDL.Principal,
  });
  const Result = IDL.Variant({ 'ok' : IDL.Nat, 'err' : IDL.Text });
  const Result_2 = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const SocialLink = IDL.Record({ 'url' : IDL.Text, 'platform' : IDL.Text });
  const CreateUserProfileArgs = IDL.Record({
    'principal' : IDL.Principal,
    'name' : IDL.Text,
    'description' : IDL.Text,
    'logo_url' : IDL.Opt(IDL.Text),
    'social_links' : IDL.Vec(SocialLink),
  });
  const UserProfile = IDL.Record({
    'updated_at' : IDL.Int,
    'principal' : IDL.Principal,
    'verified' : IDL.Bool,
    'name' : IDL.Text,
    'description' : IDL.Text,
    'created_at' : IDL.Int,
    'created_by' : IDL.Principal,
    'logo_url' : IDL.Opt(IDL.Text),
    'social_links' : IDL.Vec(SocialLink),
  });
  const ProfileError = IDL.Variant({
    'InvalidInput' : IDL.Text,
    'NotFound' : IDL.Null,
    'NotAuthorized' : IDL.Null,
    'AlreadyExists' : IDL.Null,
  });
  const Result_3 = IDL.Variant({ 'ok' : UserProfile, 'err' : ProfileError });
  const CreateAllocationArgs = IDL.Record({
    'per_user_max_e8s' : IDL.Nat,
    'token_canister_id' : IDL.Principal,
    'total_amount_e8s' : IDL.Nat,
    'achievement_id' : IDL.Text,
    'per_user_min_e8s' : IDL.Nat,
  });
  const Allocation = IDL.Record({
    'id' : IDL.Text,
    'creator' : IDL.Principal,
    'token' : IDL.Record({
      'per_user' : IDL.Record({ 'min_e8s' : IDL.Nat, 'max_e8s' : IDL.Nat }),
      'canister_id' : IDL.Principal,
      'total_amount_e8s' : IDL.Nat,
    }),
    'created_at' : IDL.Int,
    'achievement_id' : IDL.Text,
  });
  const Result_13 = IDL.Variant({ 'ok' : Allocation, 'err' : IDL.Text });
  const Result_12 = IDL.Variant({ 'ok' : IDL.Null, 'err' : ProfileError });
  const AllocationStatus = IDL.Variant({
    'Active' : IDL.Null,
    'Draft' : IDL.Null,
    'Cancelled' : IDL.Null,
    'Depleted' : IDL.Null,
  });
  const Result_11 = IDL.Variant({ 'ok' : Achievement, 'err' : IDL.Text });
  const AllocationClaim = IDL.Record({
    'claimed_at' : IDL.Int,
    'allocation_id' : IDL.Text,
    'user' : IDL.Principal,
    'amount_e8s' : IDL.Nat,
  });
  const Condition = IDL.Record({
    'key' : IDL.Text,
    'name' : IDL.Text,
    'description' : IDL.Text,
    'parameter_specs' : IDL.Vec(
      IDL.Record({
        'name' : IDL.Text,
        'param_type' : IDL.Variant({
          'Nat' : IDL.Null,
          'Text' : IDL.Null,
          'Principal' : IDL.Null,
        }),
        'default_value' : IDL.Opt(IDL.Text),
      })
    ),
  });
  const DonationEvent = IDL.Record({
    'tx_id' : IDL.Text,
    'token_ledger_id' : IDL.Principal,
    'amount_e8s' : IDL.Nat,
    'usd_value' : IDL.Float64,
    'timestamp' : IDL.Int,
    'donor' : IDL.Principal,
  });
  const NamedSubaccount = IDL.Record({
    'name' : IDL.Text,
    'subaccount' : IDL.Vec(IDL.Nat8),
    'created_at' : IDL.Int,
  });
  const UserTokenSubaccounts = IDL.Record({
    'subaccounts' : IDL.Vec(NamedSubaccount),
    'token_id' : IDL.Principal,
  });
  const Result_10 = IDL.Variant({
    'ok' : IDL.Vec(UserTokenSubaccounts),
    'err' : IDL.Text,
  });
  const SuspendedStatus = IDL.Variant({
    'Temporary' : IDL.Text,
    'Permanent' : IDL.Text,
  });
  const TokenAllocationStats = IDL.Record({
    'total_claimed_e8s' : IDL.Nat,
    'claim_count' : IDL.Nat,
    'total_allocated_e8s' : IDL.Nat,
    'allocation_count' : IDL.Nat,
    'total_cuts_paid_e8s' : IDL.Nat,
    'total_fees_paid_e8s' : IDL.Nat,
  });
  const TokenSavingsStats = IDL.Record({
    'split_savings_e8s' : IDL.Nat,
    'icpswap_savings_e8s' : IDL.Nat,
    'kong_savings_e8s' : IDL.Nat,
  });
  const TokenStats = IDL.Record({
    'total_sends' : IDL.Nat,
    'total_swaps' : IDL.Nat,
    'volume_e8s' : IDL.Nat,
    'total_deposits' : IDL.Nat,
    'icpswap_swaps' : IDL.Nat,
    'total_withdrawals' : IDL.Nat,
    'withdrawals_volume_e8s' : IDL.Nat,
    'kong_swaps' : IDL.Nat,
    'sends_volume_e8s' : IDL.Nat,
    'split_swaps' : IDL.Nat,
    'deposits_volume_e8s' : IDL.Nat,
  });
  const UserStats = IDL.Record({
    'total_sends' : IDL.Nat,
    'total_swaps' : IDL.Nat,
    'total_deposits' : IDL.Nat,
    'icpswap_swaps' : IDL.Nat,
    'total_withdrawals' : IDL.Nat,
    'kong_swaps' : IDL.Nat,
    'split_swaps' : IDL.Nat,
  });
  const Result_9 = IDL.Variant({
    'ok' : IDL.Record({
      'status' : AllocationStatus,
      'allocation' : Allocation,
    }),
    'err' : IDL.Text,
  });
  const AllocationFeeConfig = IDL.Record({
    'icp_fee_e8s' : IDL.Nat,
    'cut_basis_points' : IDL.Nat,
  });
  const SponsorInfo = IDL.Record({
    'principal' : IDL.Principal,
    'name' : IDL.Text,
    'logo_url' : IDL.Opt(IDL.Text),
  });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Result_8 = IDL.Variant({ 'ok' : IDL.Vec(IDL.Nat8), 'err' : IDL.Text });
  const GlobalStats = IDL.Record({
    'total_sends' : IDL.Nat,
    'total_swaps' : IDL.Nat,
    'total_deposits' : IDL.Nat,
    'icpswap_swaps' : IDL.Nat,
    'total_withdrawals' : IDL.Nat,
    'kong_swaps' : IDL.Nat,
    'split_swaps' : IDL.Nat,
  });
  const ImportProgress = IDL.Record({
    'skipped_count' : IDL.Nat,
    'imported_count' : IDL.Nat,
    'processed_count' : IDL.Nat,
    'last_processed' : IDL.Opt(IDL.Text),
    'is_running' : IDL.Bool,
    'total_tokens' : IDL.Nat,
    'failed_count' : IDL.Nat,
  });
  const MetadataDiscrepancy = IDL.Record({
    'new_metadata' : TokenMetadata,
    'ledger_id' : IDL.Principal,
    'old_metadata' : TokenMetadata,
    'timestamp' : IDL.Int,
  });
  const MetadataRefreshProgress = IDL.Record({
    'skipped_count' : IDL.Nat,
    'updated_count' : IDL.Nat,
    'processed_count' : IDL.Nat,
    'last_processed' : IDL.Opt(IDL.Principal),
    'is_running' : IDL.Bool,
    'total_tokens' : IDL.Nat,
    'failed_count' : IDL.Nat,
  });
  const Result_7 = IDL.Variant({
    'ok' : IDL.Vec(
      IDL.Record({ 'status' : AllocationStatus, 'allocation' : Allocation })
    ),
    'err' : IDL.Text,
  });
  const UserTokenStats = IDL.Record({
    'swaps_as_output_icpswap' : IDL.Nat,
    'total_sends' : IDL.Nat,
    'output_volume_e8s_icpswap' : IDL.Nat,
    'input_volume_e8s_icpswap' : IDL.Nat,
    'swaps_as_input_split' : IDL.Nat,
    'total_deposits' : IDL.Nat,
    'total_withdrawals' : IDL.Nat,
    'savings_as_output_split_e8s' : IDL.Nat,
    'input_volume_e8s_kong' : IDL.Nat,
    'swaps_as_input_kong' : IDL.Nat,
    'savings_as_output_kong_e8s' : IDL.Nat,
    'swaps_as_output_kong' : IDL.Nat,
    'savings_as_output_icpswap_e8s' : IDL.Nat,
    'swaps_as_input_icpswap' : IDL.Nat,
    'swaps_as_output_split' : IDL.Nat,
    'output_volume_e8s_kong' : IDL.Nat,
    'output_volume_e8s_split' : IDL.Nat,
    'input_volume_e8s_split' : IDL.Nat,
  });
  const Result_6 = IDL.Variant({
    'ok' : IDL.Vec(NamedSubaccount),
    'err' : IDL.Text,
  });
  const PaginatedLogosResponse = IDL.Record({
    'total' : IDL.Nat,
    'items' : IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Opt(IDL.Text))),
    'start_index' : IDL.Nat,
  });
  const Token = IDL.Record({ 'address' : IDL.Text, 'standard' : IDL.Text });
  const PoolMetadata = IDL.Record({
    'fee' : IDL.Nat,
    'key' : IDL.Text,
    'token0' : Token,
    'token1' : Token,
  });
  const UserAchievement = IDL.Record({
    'user' : IDL.Principal,
    'achievement_id' : IDL.Text,
    'discovered_at' : IDL.Int,
  });
  const UserTokenAllocationStats = IDL.Record({
    'total_claimed_e8s' : IDL.Nat,
    'claim_count' : IDL.Nat,
    'total_allocated_e8s' : IDL.Nat,
    'allocation_count' : IDL.Nat,
    'total_cuts_paid_e8s' : IDL.Nat,
    'total_fees_paid_e8s' : IDL.Nat,
  });
  const Result_5 = IDL.Variant({ 'ok' : TokenMetadata, 'err' : IDL.Text });
  const RegisterTokenResponse = IDL.Record({
    'metadata' : TokenMetadata,
    'logo' : IDL.Opt(IDL.Text),
  });
  const Result_4 = IDL.Variant({
    'ok' : RegisterTokenResponse,
    'err' : IDL.Text,
  });
  const RemoveSubaccountArgs = IDL.Record({
    'token_id' : IDL.Principal,
    'subaccount' : IDL.Vec(IDL.Nat8),
  });
  const UpdateUserProfileArgs = IDL.Record({
    'verified' : IDL.Opt(IDL.Bool),
    'name' : IDL.Opt(IDL.Text),
    'description' : IDL.Opt(IDL.Text),
    'logo_url' : IDL.Opt(IDL.Text),
    'social_links' : IDL.Opt(IDL.Vec(SocialLink)),
  });
  const SwapRunner = IDL.Service({
    'activate_allocation' : IDL.Func([IDL.Nat], [Result_1], []),
    'add_achievement' : IDL.Func([Achievement], [Result_1], []),
    'add_admin' : IDL.Func([IDL.Principal], [Result_1], []),
    'add_named_subaccount' : IDL.Func([AddSubaccountArgs], [Result_1], []),
    'add_pool' : IDL.Func([IDL.Principal], [Result_1], []),
    'add_pool_for' : IDL.Func([IDL.Principal, IDL.Principal], [Result_1], []),
    'add_token' : IDL.Func([AddTokenArgs], [Result_1], []),
    'add_wallet_token' : IDL.Func([IDL.Text], [IDL.Bool], []),
    'cancel_allocation' : IDL.Func([IDL.Nat], [Result_1], []),
    'cancel_top_up' : IDL.Func([IDL.Nat], [Result_1], []),
    'claim_allocation' : IDL.Func([IDL.Nat], [Result], []),
    'claim_and_withdraw_allocation' : IDL.Func([IDL.Nat], [Result], []),
    'clear_icpswap_tokens' : IDL.Func([], [Result_1], []),
    'clear_logo_cache' : IDL.Func([], [Result_1], []),
    'clear_metadata_discrepancies' : IDL.Func([], [], []),
    'clear_user_token_savings_stats' : IDL.Func([], [], []),
    'clear_whitelist' : IDL.Func([], [Result_1], []),
    'copy_icpswap_trusted_tokens' : IDL.Func([], [Result_2], []),
    'createUserProfile' : IDL.Func([CreateUserProfileArgs], [Result_3], []),
    'create_allocation' : IDL.Func([CreateAllocationArgs], [Result_13], []),
    'deleteUserProfile' : IDL.Func([IDL.Principal], [Result_12], []),
    'getUserProfile' : IDL.Func([IDL.Principal], [Result_3], ['query']),
    'getUserProfileCount' : IDL.Func([], [IDL.Nat], ['query']),
    'get_achievement_allocations' : IDL.Func(
        [IDL.Text],
        [
          IDL.Vec(
            IDL.Record({
              'status' : AllocationStatus,
              'allocation' : Allocation,
            })
          ),
        ],
        ['query'],
      ),
    'get_achievement_details' : IDL.Func([IDL.Text], [Result_11], ['query']),
    'get_actual_server_balance' : IDL.Func([IDL.Principal], [IDL.Nat], []),
    'get_admins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_all_achievements' : IDL.Func([], [IDL.Vec(Achievement)], ['query']),
    'get_all_allocation_claims' : IDL.Func(
        [],
        [IDL.Vec(AllocationClaim)],
        ['query'],
      ),
    'get_all_allocation_creators' : IDL.Func(
        [],
        [IDL.Vec(IDL.Principal)],
        ['query'],
      ),
    'get_all_conditions' : IDL.Func([], [IDL.Vec(Condition)], ['query']),
    'get_all_custom_tokens' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, TokenMetadata))],
        ['query'],
      ),
    'get_all_donations' : IDL.Func([], [IDL.Vec(DonationEvent)], ['query']),
    'get_all_named_subaccounts' : IDL.Func([], [Result_10], ['query']),
    'get_all_suspended_principals' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, SuspendedStatus))],
        ['query'],
      ),
    'get_all_token_allocation_stats' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, TokenAllocationStats))],
        ['query'],
      ),
    'get_all_token_savings_stats' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, TokenSavingsStats))],
        ['query'],
      ),
    'get_all_token_stats' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, TokenStats))],
        ['query'],
      ),
    'get_all_tokens' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, TokenMetadata))],
        ['query'],
      ),
    'get_all_user_allocations' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Record({
              'status' : AllocationStatus,
              'allocation' : Allocation,
            })
          ),
        ],
        ['query'],
      ),
    'get_all_user_logins' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, IDL.Nat))],
        ['query'],
      ),
    'get_all_user_stats' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, UserStats))],
        ['query'],
      ),
    'get_allocation' : IDL.Func([IDL.Text], [Result_9], ['query']),
    'get_allocation_balance' : IDL.Func(
        [IDL.Nat, IDL.Principal],
        [IDL.Nat],
        ['query'],
      ),
    'get_allocation_claims' : IDL.Func(
        [IDL.Text],
        [
          IDL.Vec(
            IDL.Record({
              'claimed_at' : IDL.Int,
              'user' : IDL.Principal,
              'amount_e8s' : IDL.Nat,
            })
          ),
        ],
        ['query'],
      ),
    'get_allocation_fee_config' : IDL.Func(
        [],
        [AllocationFeeConfig],
        ['query'],
      ),
    'get_available_claims' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Record({
              'allocation_id' : IDL.Text,
              'token_canister_id' : IDL.Principal,
              'claimable_amount' : IDL.Record({
                'min_e8s' : IDL.Nat,
                'max_e8s' : IDL.Nat,
              }),
              'achievement_id' : IDL.Text,
            })
          ),
        ],
        ['query'],
      ),
    'get_available_claims_with_sponsors' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Record({
              'allocation_id' : IDL.Text,
              'token_canister_id' : IDL.Principal,
              'claimable_amount' : IDL.Record({
                'min_e8s' : IDL.Nat,
                'max_e8s' : IDL.Nat,
              }),
              'sponsor' : SponsorInfo,
              'achievement_id' : IDL.Text,
            })
          ),
        ],
        ['query'],
      ),
    'get_cached_logo_count' : IDL.Func([], [IDL.Nat], ['query']),
    'get_custom_tokens' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, TokenMetadata))],
        ['query'],
      ),
    'get_cut_account' : IDL.Func([], [IDL.Opt(Account)], ['query']),
    'get_cycle_balance' : IDL.Func([], [IDL.Nat], ['query']),
    'get_derived_subaccount' : IDL.Func(
        [IDL.Principal, IDL.Nat],
        [Result_8],
        [],
      ),
    'get_global_stats' : IDL.Func([], [GlobalStats], ['query']),
    'get_icpswap_token_count' : IDL.Func([], [IDL.Nat], ['query']),
    'get_icpswap_tokens' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, TokenMetadata))],
        ['query'],
      ),
    'get_import_progress' : IDL.Func([], [ImportProgress], ['query']),
    'get_logo_update_progress' : IDL.Func(
        [],
        [
          IDL.Record({
            'skipped_count' : IDL.Nat,
            'updated_count' : IDL.Nat,
            'processed_count' : IDL.Nat,
            'last_processed' : IDL.Opt(IDL.Principal),
            'is_running' : IDL.Bool,
            'total_tokens' : IDL.Nat,
            'failed_count' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_metadata_discrepancies' : IDL.Func(
        [],
        [IDL.Vec(MetadataDiscrepancy)],
        ['query'],
      ),
    'get_metadata_refresh_progress' : IDL.Func(
        [],
        [MetadataRefreshProgress],
        ['query'],
      ),
    'get_my_created_allocations' : IDL.Func([], [Result_7], ['query']),
    'get_my_token_savings_stats' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, TokenSavingsStats))],
        ['query'],
      ),
    'get_my_token_stats' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, UserTokenStats))],
        ['query'],
      ),
    'get_named_subaccounts' : IDL.Func([IDL.Principal], [Result_6], ['query']),
    'get_next_user_index' : IDL.Func([], [IDL.Nat16], ['query']),
    'get_paginated_logos' : IDL.Func(
        [IDL.Nat],
        [PaginatedLogosResponse],
        ['query'],
      ),
    'get_panic_mode' : IDL.Func([], [IDL.Bool], ['query']),
    'get_payment_account' : IDL.Func([], [IDL.Opt(Account)], ['query']),
    'get_pool_metadata' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(PoolMetadata)],
        ['query'],
      ),
    'get_popular_tokens' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(IDL.Tuple(IDL.Principal, TokenMetadata))],
        ['query'],
      ),
    'get_psa_message' : IDL.Func([], [IDL.Text], ['query']),
    'get_server_balance' : IDL.Func([IDL.Principal], [IDL.Nat], ['query']),
    'get_token_logo' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(IDL.Text)],
        ['query'],
      ),
    'get_token_metadata' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(TokenMetadata)],
        ['query'],
      ),
    'get_token_savings_stats' : IDL.Func(
        [IDL.Text],
        [IDL.Opt(TokenSavingsStats)],
        ['query'],
      ),
    'get_token_stats' : IDL.Func([IDL.Text], [IDL.Opt(TokenStats)], ['query']),
    'get_unique_trader_count' : IDL.Func([], [IDL.Nat], ['query']),
    'get_unique_user_count' : IDL.Func([], [IDL.Nat], ['query']),
    'get_user_achievements' : IDL.Func(
        [],
        [IDL.Vec(UserAchievement)],
        ['query'],
      ),
    'get_user_balance' : IDL.Func([IDL.Principal], [IDL.Nat], ['query']),
    'get_user_claim' : IDL.Func(
        [IDL.Text, IDL.Principal],
        [IDL.Opt(AllocationClaim)],
        ['query'],
      ),
    'get_user_claims' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Record({ 'claim' : AllocationClaim, 'allocation' : Allocation })
          ),
        ],
        ['query'],
      ),
    'get_user_claims_with_sponsors' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Record({
              'claim' : AllocationClaim,
              'sponsor' : SponsorInfo,
              'allocation' : Allocation,
            })
          ),
        ],
        ['query'],
      ),
    'get_user_donations' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(DonationEvent)],
        ['query'],
      ),
    'get_user_pools' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Record({
              'metadata' : IDL.Opt(PoolMetadata),
              'canisterId' : IDL.Principal,
            })
          ),
        ],
        ['query'],
      ),
    'get_user_stats' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(UserStats)],
        ['query'],
      ),
    'get_user_token_allocation_stats' : IDL.Func(
        [IDL.Text],
        [IDL.Vec(IDL.Tuple(IDL.Text, UserTokenAllocationStats))],
        ['query'],
      ),
    'get_wallet_tokens' : IDL.Func([], [IDL.Vec(IDL.Text)], ['query']),
    'get_whitelisted_tokens' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, TokenMetadata))],
        ['query'],
      ),
    'init_admin' : IDL.Func([], [Result_1], []),
    'is_admin' : IDL.Func([], [IDL.Bool], ['query']),
    'is_suspended' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(SuspendedStatus)],
        ['query'],
      ),
    'listUserProfiles' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [IDL.Vec(UserProfile)],
        ['query'],
      ),
    'record_deposit' : IDL.Func(
        [IDL.Principal, IDL.Text, IDL.Nat, IDL.Principal],
        [],
        [],
      ),
    'record_donation' : IDL.Func(
        [IDL.Nat, IDL.Principal, IDL.Float64, IDL.Text],
        [Result_1],
        [],
      ),
    'record_icpswap_swap' : IDL.Func(
        [
          IDL.Principal,
          IDL.Text,
          IDL.Nat,
          IDL.Text,
          IDL.Nat,
          IDL.Nat,
          IDL.Principal,
        ],
        [],
        [],
      ),
    'record_kong_swap' : IDL.Func(
        [IDL.Principal, IDL.Text, IDL.Nat, IDL.Text, IDL.Nat, IDL.Nat],
        [],
        [],
      ),
    'record_login' : IDL.Func([IDL.Principal], [], []),
    'record_send' : IDL.Func([IDL.Principal, IDL.Text, IDL.Nat], [], []),
    'record_split_swap' : IDL.Func(
        [
          IDL.Principal,
          IDL.Text,
          IDL.Nat,
          IDL.Nat,
          IDL.Text,
          IDL.Nat,
          IDL.Nat,
          IDL.Nat,
          IDL.Principal,
        ],
        [],
        [],
      ),
    'record_transfer' : IDL.Func(
        [IDL.Principal, IDL.Text, IDL.Nat, IDL.Principal],
        [],
        [],
      ),
    'record_withdrawal' : IDL.Func(
        [IDL.Principal, IDL.Text, IDL.Nat, IDL.Principal],
        [],
        [],
      ),
    'refresh_token_metadata' : IDL.Func([IDL.Principal], [Result_5], []),
    'register_custom_token' : IDL.Func([IDL.Principal], [Result_4], []),
    'remove_achievement' : IDL.Func([IDL.Text], [Result_1], []),
    'remove_admin' : IDL.Func([IDL.Principal], [Result_1], []),
    'remove_custom_token' : IDL.Func([IDL.Principal], [IDL.Bool], []),
    'remove_named_subaccount' : IDL.Func(
        [RemoveSubaccountArgs],
        [Result_1],
        [],
      ),
    'remove_pool' : IDL.Func([IDL.Principal], [Result_1], []),
    'remove_token' : IDL.Func([IDL.Principal], [Result_1], []),
    'remove_wallet_token' : IDL.Func([IDL.Text], [IDL.Bool], []),
    'resume_metadata_refresh' : IDL.Func([IDL.Nat], [Result_1], []),
    'scan_for_new_achievements' : IDL.Func(
        [],
        [
          IDL.Record({
            'new_achievements' : IDL.Vec(UserAchievement),
            'available_claims' : IDL.Vec(
              IDL.Record({
                'allocation_id' : IDL.Text,
                'claimable_amount' : IDL.Record({
                  'min_e8s' : IDL.Nat,
                  'max_e8s' : IDL.Nat,
                }),
                'achievement_id' : IDL.Text,
              })
            ),
          }),
        ],
        [],
      ),
    'searchUserProfiles' : IDL.Func(
        [IDL.Text],
        [IDL.Vec(UserProfile)],
        ['query'],
      ),
    'set_panic_mode' : IDL.Func([IDL.Bool], [Result_1], []),
    'set_psa_message' : IDL.Func([IDL.Text], [Result_1], []),
    'set_token_logo' : IDL.Func([IDL.Principal, IDL.Text], [Result_1], []),
    'start_icpswap_import' : IDL.Func([IDL.Nat], [Result_1], []),
    'start_metadata_refresh' : IDL.Func([IDL.Nat], [Result_1], []),
    'stop_icpswap_import' : IDL.Func([], [Result_1], []),
    'stop_logo_update' : IDL.Func([], [Result_1], []),
    'stop_metadata_refresh' : IDL.Func([], [Result_1], []),
    'suspend_principal' : IDL.Func(
        [IDL.Principal, SuspendedStatus],
        [Result_1],
        [],
      ),
    'top_up_allocation' : IDL.Func([IDL.Nat, IDL.Nat], [Result_1], []),
    'transfer_allocation' : IDL.Func([IDL.Nat, IDL.Principal], [Result_1], []),
    'unsuspend_principal' : IDL.Func([IDL.Principal], [Result_1], []),
    'updateUserProfile' : IDL.Func(
        [IDL.Principal, UpdateUserProfileArgs],
        [Result_3],
        [],
      ),
    'update_achievement' : IDL.Func([Achievement], [Result_1], []),
    'update_allocation_fee_config' : IDL.Func(
        [AllocationFeeConfig],
        [Result_1],
        [],
      ),
    'update_cut_account' : IDL.Func([Account], [Result_1], []),
    'update_icpswap_token_logos' : IDL.Func([IDL.Nat], [Result_2], []),
    'update_payment_account' : IDL.Func([Account], [Result_1], []),
    'update_pool_metadata' : IDL.Func(
        [IDL.Principal, PoolMetadata],
        [Result_1],
        [],
      ),
    'withdraw_from_balance' : IDL.Func([IDL.Principal, IDL.Nat], [Result], []),
  });
  return SwapRunner;
};
export const init = ({ IDL }) => { return []; };
