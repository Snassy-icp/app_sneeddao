export const idlFactory = ({ IDL }) => {
  const GetBlocksResult = IDL.Rec();
  const Value = IDL.Rec();
  const SwapCanisterId = IDL.Principal;
  const PositionId = IDL.Nat;
  const AddLiquidityResult = IDL.Variant({
    'Ok' : IDL.Record({
      'returned0' : IDL.Nat,
      'returned1' : IDL.Nat,
      'credited0' : IDL.Nat,
      'credited1' : IDL.Nat,
      'used0' : IDL.Nat,
      'used1' : IDL.Nat,
      'increase_error' : IDL.Opt(IDL.Text),
      'position_id' : PositionId,
    }),
    'Err' : IDL.Text,
  });
  const Timestamp = IDL.Nat64;
  const LockType = IDL.Variant({
    'PositionLock' : IDL.Null,
    'TokenLock' : IDL.Null,
  });
  const PaymentLogEntry = IDL.Record({
    'id' : IDL.Nat,
    'amount_e8s' : IDL.Nat,
    'icp_transaction_id' : IDL.Nat,
    'timestamp' : Timestamp,
    'lock_type' : LockType,
    'payer' : IDL.Principal,
    'correlation_id' : IDL.Nat,
  });
  const TokenType = IDL.Principal;
  const TxIndex = IDL.Nat;
  const Balance = IDL.Nat;
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
  const SettingsUpdate = IDL.Record({
    'archive_top_up_threshold' : IDL.Opt(IDL.Nat),
    'archive_max_blocks' : IDL.Opt(IDL.Nat),
    'max_live_blocks' : IDL.Opt(IDL.Nat),
    'archive_initial_cycles' : IDL.Opt(IDL.Nat),
    'spill_batch_size' : IDL.Opt(IDL.Nat),
    'archive_top_up_amount' : IDL.Opt(IDL.Nat),
  });
  const Settings = IDL.Record({
    'archive_top_up_threshold' : IDL.Nat,
    'archive_max_blocks' : IDL.Nat,
    'max_live_blocks' : IDL.Nat,
    'archive_initial_cycles' : IDL.Nat,
    'spill_batch_size' : IDL.Nat,
    'archive_top_up_amount' : IDL.Nat,
  });
  const ClaimRequestId = IDL.Nat;
  const ClaimFeesResult = IDL.Variant({
    'Ok' : IDL.Record({
      'request_id' : ClaimRequestId,
      'amount0' : IDL.Nat,
      'amount1' : IDL.Nat,
      'token0' : TokenType,
      'token1' : TokenType,
    }),
    'Err' : IDL.Text,
  });
  const Expiry = IDL.Nat64;
  const LockId = IDL.Nat;
  const CreateLockError = IDL.Record({
    'transfer_error' : IDL.Opt(TransferError),
    'message' : IDL.Text,
  });
  const CreateLockResult = IDL.Variant({
    'Ok' : LockId,
    'Err' : CreateLockError,
  });
  const Dex = IDL.Nat;
  const PositionLock = IDL.Record({
    'dex' : Dex,
    'lock_id' : LockId,
    'token0' : TokenType,
    'token1' : TokenType,
    'expiry' : Expiry,
    'position_id' : PositionId,
  });
  const FullyQualifiedPositionLock = IDL.Tuple(
    IDL.Principal,
    SwapCanisterId,
    PositionLock,
  );
  const Lock = IDL.Record({
    'lock_id' : LockId,
    'expiry' : Expiry,
    'amount' : Balance,
  });
  const FullyQualifiedLock = IDL.Tuple(IDL.Principal, TokenType, Lock);
  const ClaimRequestStatus = IDL.Variant({
    'Failed' : IDL.Text,
    'ClaimVerified' : IDL.Record({
      'balance1_before' : Balance,
      'amount1_claimed' : Balance,
      'amount0_claimed' : Balance,
      'balance0_before' : Balance,
    }),
    'Withdrawn' : IDL.Record({
      'amount1_claimed' : Balance,
      'amount0_claimed' : Balance,
    }),
    'ClaimAttempted' : IDL.Record({
      'balance1_before' : Balance,
      'claim_attempt' : IDL.Nat,
      'balance0_before' : Balance,
    }),
    'Processing' : IDL.Null,
    'TimedOut' : IDL.Null,
    'Completed' : IDL.Record({
      'amount1_claimed' : Balance,
      'transfer1_tx_id' : IDL.Opt(IDL.Nat),
      'amount0_claimed' : Balance,
      'amount0_transferred' : Balance,
      'transfer0_tx_id' : IDL.Opt(IDL.Nat),
      'amount1_transferred' : Balance,
    }),
    'Pending' : IDL.Null,
    'BalanceRecorded' : IDL.Record({
      'balance1_before' : Balance,
      'balance0_before' : Balance,
    }),
  });
  const ClaimRequest = IDL.Record({
    'request_id' : ClaimRequestId,
    'status' : ClaimRequestStatus,
    'retry_count' : IDL.Nat,
    'started_processing_at' : IDL.Opt(Timestamp),
    'created_at' : Timestamp,
    'token0' : TokenType,
    'token1' : TokenType,
    'caller' : IDL.Principal,
    'swap_canister_id' : SwapCanisterId,
    'last_attempted_at' : IDL.Opt(Timestamp),
    'completed_at' : IDL.Opt(Timestamp),
    'position_id' : PositionId,
  });
  const ClaimedPosition = IDL.Record({
    'owner' : IDL.Principal,
    'swap_canister_id' : SwapCanisterId,
    'position_lock' : IDL.Opt(PositionLock),
    'position_id' : PositionId,
  });
  const BufferEntry = IDL.Record({
    'id' : IDL.Nat,
    'content' : IDL.Text,
    'timestamp' : IDL.Int,
    'caller' : IDL.Principal,
    'correlation_id' : IDL.Nat,
  });
  const LockInfo = IDL.Variant({
    'PositionLock' : FullyQualifiedPositionLock,
    'TokenLock' : FullyQualifiedLock,
  });
  const SupportedStandard = IDL.Record({ 'url' : IDL.Text, 'name' : IDL.Text });
  const GetArchivesArgs = IDL.Record({ 'from' : IDL.Opt(IDL.Principal) });
  const ArchiveRange = IDL.Record({
    'end' : IDL.Nat,
    'canister_id' : IDL.Principal,
    'start' : IDL.Nat,
  });
  const GetArchivesResult = IDL.Vec(ArchiveRange);
  const BlockRange = IDL.Record({ 'start' : IDL.Nat, 'length' : IDL.Nat });
  const GetBlocksArgs = IDL.Vec(BlockRange);
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
  const Block = IDL.Record({ 'id' : IDL.Nat, 'block' : Value });
  const ArchivedBlocks = IDL.Record({
    'args' : GetBlocksArgs,
    'callback' : IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
  });
  GetBlocksResult.fill(
    IDL.Record({
      'log_length' : IDL.Nat,
      'blocks' : IDL.Vec(Block),
      'archived_blocks' : IDL.Vec(ArchivedBlocks),
    })
  );
  const DataCertificate = IDL.Record({
    'certificate' : IDL.Vec(IDL.Nat8),
    'hash_tree' : IDL.Vec(IDL.Nat8),
  });
  const ArchiveInfo = IDL.Record({
    'canister_id' : IDL.Principal,
    'start' : IDL.Nat,
    'length' : IDL.Nat,
    'max_blocks' : IDL.Nat,
  });
  const LogStatus = IDL.Record({
    'live_blocks' : IDL.Nat,
    'live_first_index' : IDL.Nat,
    'history_imported' : IDL.Bool,
    'spilling' : IDL.Bool,
    'settings' : Settings,
    'log_length' : IDL.Nat,
    'last_block_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'archives' : IDL.Vec(ArchiveInfo),
  });
  const Registration = IDL.Record({
    'last_error' : IDL.Opt(IDL.Text),
    'canister_id' : IDL.Principal,
    'attempts' : IDL.Nat,
    'start' : IDL.Nat,
    'proposal_id' : IDL.Opt(IDL.Nat64),
  });
  const Status = IDL.Record({
    'neuron' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'registrations' : IDL.Vec(Registration),
    'governance' : IDL.Principal,
  });
  const BlockType = IDL.Record({ 'url' : IDL.Text, 'block_type' : IDL.Text });
  const ClaimAndWithdrawResult = IDL.Variant({
    'Ok' : ClaimRequestId,
    'Err' : IDL.Text,
  });
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
  const TransferPositionOwnershipError = IDL.Record({ 'message' : IDL.Text });
  const TransferPositionOwnershipResult = IDL.Variant({
    'Ok' : IDL.Null,
    'Err' : TransferPositionOwnershipError,
  });
  const TransferTokenLockOwnershipError = IDL.Record({
    'transfer_error' : IDL.Opt(TransferError),
    'message' : IDL.Text,
  });
  const TransferTokenLockOwnershipResult = IDL.Variant({
    'Ok' : IDL.Null,
    'Err' : TransferTokenLockOwnershipError,
  });
  const Subaccount = IDL.Vec(IDL.Nat8);
  const SneedLock = IDL.Service({
    'add_liquidity_to_locked_position' : IDL.Func(
        [SwapCanisterId, PositionId, IDL.Nat, IDL.Nat],
        [AddLiquidityResult],
        [],
      ),
    'admin_add_admin' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text })],
        [],
      ),
    'admin_clear_completed_claim_requests' : IDL.Func([], [IDL.Nat], []),
    'admin_clear_failed_claim_requests' : IDL.Func([], [IDL.Nat], []),
    'admin_get_payment_log' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [
          IDL.Record({
            'payments' : IDL.Vec(PaymentLogEntry),
            'total_count' : IDL.Nat,
            'has_more' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
    'admin_get_payment_log_count' : IDL.Func([], [IDL.Nat], ['query']),
    'admin_get_pool_unused_balance' : IDL.Func(
        [SwapCanisterId],
        [
          IDL.Variant({
            'Ok' : IDL.Record({ 'balance0' : IDL.Nat, 'balance1' : IDL.Nat }),
            'Err' : IDL.Text,
          }),
        ],
        [],
      ),
    'admin_icrc3_import_history' : IDL.Func(
        [],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'admin_icrc3_register_archives_now' : IDL.Func(
        [],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'admin_icrc3_repair_archive_controllers' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Tuple(
              IDL.Principal,
              IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text }),
            )
          ),
        ],
        [],
      ),
    'admin_icrc3_reset_archive_registration' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Bool, 'Err' : IDL.Text })],
        [],
      ),
    'admin_icrc3_spill_now' : IDL.Func(
        [],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'admin_pool_deposit' : IDL.Func(
        [SwapCanisterId, TokenType, IDL.Nat],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'admin_remove_admin' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text })],
        [],
      ),
    'admin_rescue_stuck_tokens' : IDL.Func(
        [TokenType, IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text })],
        [],
      ),
    'admin_return_token' : IDL.Func(
        [IDL.Principal, IDL.Nat, IDL.Principal],
        [TransferResult],
        [],
      ),
    'admin_return_token_from_failed_request' : IDL.Func(
        [IDL.Principal, IDL.Nat, IDL.Principal],
        [TransferResult],
        [],
      ),
    'admin_set_icp_fee_recipient' : IDL.Func(
        [IDL.Opt(IDL.Principal), IDL.Opt(IDL.Vec(IDL.Nat8))],
        [IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text })],
        [],
      ),
    'admin_set_icrc3_proposal_neuron' : IDL.Func(
        [IDL.Opt(IDL.Vec(IDL.Nat8))],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'admin_set_icrc3_settings' : IDL.Func(
        [SettingsUpdate],
        [IDL.Variant({ 'Ok' : Settings, 'Err' : IDL.Text })],
        [],
      ),
    'admin_set_lock_fees_icp' : IDL.Func(
        [
          IDL.Opt(IDL.Nat64),
          IDL.Opt(IDL.Nat64),
          IDL.Opt(IDL.Nat64),
          IDL.Opt(IDL.Nat64),
        ],
        [IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text })],
        [],
      ),
    'admin_set_sneed_premium_canister_id' : IDL.Func(
        [IDL.Opt(IDL.Principal)],
        [IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text })],
        [],
      ),
    'admin_withdraw_pool_balance_to_user' : IDL.Func(
        [SwapCanisterId, TokenType, IDL.Nat, IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'claim_position' : IDL.Func([IDL.Principal, PositionId], [IDL.Bool], []),
    'claim_position_fees' : IDL.Func(
        [SwapCanisterId, PositionId],
        [ClaimFeesResult],
        [],
      ),
    'clear_expired_locks' : IDL.Func([], [], []),
    'clear_expired_position_locks' : IDL.Func([], [], []),
    'create_lock' : IDL.Func(
        [IDL.Nat, IDL.Principal, Expiry],
        [CreateLockResult],
        [],
      ),
    'create_position_lock' : IDL.Func(
        [IDL.Principal, Dex, PositionId, Expiry, TokenType, TokenType],
        [CreateLockResult],
        [],
      ),
    'getEffectiveLockFee' : IDL.Func(
        [IDL.Principal, IDL.Bool],
        [IDL.Record({ 'is_premium' : IDL.Bool, 'fee_e8s' : IDL.Nat64 })],
        [],
      ),
    'getPaymentBalance' : IDL.Func([IDL.Principal], [IDL.Nat], []),
    'getPaymentSubaccount' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(IDL.Nat8)],
        ['query'],
      ),
    'get_active_position_locks' : IDL.Func(
        [],
        [IDL.Vec(FullyQualifiedPositionLock)],
        ['query'],
      ),
    'get_active_token_locks' : IDL.Func(
        [],
        [IDL.Vec(FullyQualifiedLock)],
        ['query'],
      ),
    'get_admin_list' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_all_active_claim_requests' : IDL.Func(
        [],
        [IDL.Vec(ClaimRequest)],
        ['query'],
      ),
    'get_all_completed_claim_requests' : IDL.Func(
        [],
        [IDL.Vec(ClaimRequest)],
        ['query'],
      ),
    'get_all_failed_claim_requests' : IDL.Func(
        [],
        [IDL.Vec(ClaimRequest)],
        ['query'],
      ),
    'get_all_position_locks' : IDL.Func(
        [],
        [IDL.Vec(FullyQualifiedPositionLock)],
        ['query'],
      ),
    'get_all_token_locks' : IDL.Func(
        [],
        [IDL.Vec(FullyQualifiedLock)],
        ['query'],
      ),
    'get_claim_request_status' : IDL.Func(
        [ClaimRequestId],
        [
          IDL.Opt(
            IDL.Variant({
              'Failed' : ClaimRequest,
              'Active' : ClaimRequest,
              'Completed' : ClaimRequest,
            })
          ),
        ],
        ['query'],
      ),
    'get_claimed_positions_for_principal' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(ClaimedPosition)],
        ['query'],
      ),
    'get_completed_claim_request' : IDL.Func(
        [ClaimRequestId],
        [IDL.Opt(ClaimRequest)],
        ['query'],
      ),
    'get_error_entries' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [IDL.Vec(IDL.Opt(BufferEntry))],
        [],
      ),
    'get_error_id_range' : IDL.Func(
        [],
        [IDL.Opt(IDL.Tuple(IDL.Nat, IDL.Nat))],
        [],
      ),
    'get_expired_position_locks' : IDL.Func(
        [],
        [IDL.Vec(FullyQualifiedPositionLock)],
        ['query'],
      ),
    'get_expired_token_locks' : IDL.Func(
        [],
        [IDL.Vec(FullyQualifiedLock)],
        ['query'],
      ),
    'get_failed_claim_request' : IDL.Func(
        [ClaimRequestId],
        [IDL.Opt(ClaimRequest)],
        ['query'],
      ),
    'get_info_entries' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [IDL.Vec(IDL.Opt(BufferEntry))],
        [],
      ),
    'get_info_id_range' : IDL.Func(
        [],
        [IDL.Opt(IDL.Tuple(IDL.Nat, IDL.Nat))],
        [],
      ),
    'get_ledger_token_locks' : IDL.Func(
        [TokenType],
        [IDL.Vec(FullyQualifiedLock)],
        ['query'],
      ),
    'get_lock_by_id' : IDL.Func([LockId], [IDL.Opt(LockInfo)], ['query']),
    'get_lock_fee_stats' : IDL.Func(
        [],
        [
          IDL.Record({
            'total_position_lock_fees_collected_e8s' : IDL.Nat,
            'total_fees_collected_e8s' : IDL.Nat,
            'total_token_lock_fees_collected_e8s' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_lock_fees_icp' : IDL.Func(
        [],
        [
          IDL.Record({
            'fee_recipient_principal' : IDL.Opt(IDL.Principal),
            'premium_position_lock_fee_icp_e8s' : IDL.Nat64,
            'token_lock_fee_icp_e8s' : IDL.Nat64,
            'sneed_premium_canister_id' : IDL.Opt(IDL.Principal),
            'premium_token_lock_fee_icp_e8s' : IDL.Nat64,
            'position_lock_fee_icp_e8s' : IDL.Nat64,
            'fee_recipient_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
          }),
        ],
        ['query'],
      ),
    'get_lock_type' : IDL.Func([LockId], [IDL.Opt(LockType)], ['query']),
    'get_my_claim_history' : IDL.Func([], [IDL.Vec(ClaimRequest)], ['query']),
    'get_position_lock_by_id' : IDL.Func(
        [LockId],
        [IDL.Opt(FullyQualifiedPositionLock)],
        ['query'],
      ),
    'get_position_ownerships' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(SwapCanisterId, PositionId))],
        ['query'],
      ),
    'get_summed_locks' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(TokenType, Balance))],
        ['query'],
      ),
    'get_swap_position_locks' : IDL.Func(
        [SwapCanisterId],
        [IDL.Vec(FullyQualifiedPositionLock)],
        ['query'],
      ),
    'get_token_lock_by_id' : IDL.Func(
        [LockId],
        [IDL.Opt(FullyQualifiedLock)],
        ['query'],
      ),
    'get_token_locks' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(LockId, TokenType, Balance, Expiry))],
        ['query'],
      ),
    'get_token_position_locks' : IDL.Func(
        [TokenType],
        [IDL.Vec(FullyQualifiedPositionLock)],
        ['query'],
      ),
    'has_expired_locks' : IDL.Func([], [IDL.Bool], ['query']),
    'has_expired_position_locks' : IDL.Func([], [IDL.Bool], ['query']),
    'icrc10_supported_standards' : IDL.Func(
        [],
        [IDL.Vec(SupportedStandard)],
        ['query'],
      ),
    'icrc3_get_archives' : IDL.Func(
        [GetArchivesArgs],
        [GetArchivesResult],
        ['query'],
      ),
    'icrc3_get_blocks' : IDL.Func(
        [GetBlocksArgs],
        [GetBlocksResult],
        ['query'],
      ),
    'icrc3_get_tip_certificate' : IDL.Func(
        [],
        [IDL.Opt(DataCertificate)],
        ['query'],
      ),
    'icrc3_log_status' : IDL.Func([], [LogStatus], ['query']),
    'icrc3_registration_status' : IDL.Func([], [Status], ['query']),
    'icrc3_supported_block_types' : IDL.Func(
        [],
        [IDL.Vec(BlockType)],
        ['query'],
      ),
    'request_claim_and_withdraw' : IDL.Func(
        [SwapCanisterId, PositionId],
        [ClaimAndWithdrawResult],
        [],
      ),
    'set_max_lock_length_days' : IDL.Func([IDL.Nat64], [], []),
    'transfer_position' : IDL.Func(
        [IDL.Principal, IDL.Principal, PositionId],
        [TransferPositionResult],
        [],
      ),
    'transfer_position_ownership' : IDL.Func(
        [IDL.Principal, SwapCanisterId, PositionId],
        [TransferPositionOwnershipResult],
        [],
      ),
    'transfer_token_lock_ownership' : IDL.Func(
        [IDL.Principal, TokenType, LockId],
        [TransferTokenLockOwnershipResult],
        [],
      ),
    'transfer_tokens' : IDL.Func(
        [IDL.Principal, IDL.Opt(Subaccount), IDL.Principal, Balance],
        [TransferResult],
        [],
      ),
    'update_position_lock' : IDL.Func(
        [IDL.Principal, PositionId, Expiry],
        [CreateLockResult],
        [],
      ),
  });
  return SneedLock;
};
export const init = ({ IDL }) => { return []; };
