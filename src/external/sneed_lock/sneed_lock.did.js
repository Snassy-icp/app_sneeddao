export const idlFactory = ({ IDL }) => {
  const ClaimRequestId = IDL.Nat;
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
  const PositionId = IDL.Nat;
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
  const TokenType = IDL.Principal;
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
    'Completed' : IDL.Null,
    'Pending' : IDL.Null,
    'BalanceRecorded' : IDL.Record({
      'balance1_before' : Balance,
      'balance0_before' : Balance,
    }),
  });
  const SwapCanisterId = IDL.Principal;
  const ClaimRequest = IDL.Record({
    'request_id' : ClaimRequestId,
    'status' : ClaimRequestStatus,
    'started_processing_at' : IDL.Opt(Timestamp),
    'created_at' : Timestamp,
    'token0' : TokenType,
    'token1' : TokenType,
    'caller' : IDL.Principal,
    'swap_canister_id' : SwapCanisterId,
    'completed_at' : IDL.Opt(Timestamp),
    'position_id' : PositionId,
  });
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
  const QueueProcessingState = IDL.Variant({
    'Paused' : IDL.Text,
    'Active' : IDL.Null,
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
  const ClaimAndWithdrawResult = IDL.Variant({
    'Ok' : ClaimRequestId,
    'Err' : IDL.Text,
  });
  const SetLockFeeResult = IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text });
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
    'admin_clear_completed_claim_requests_buffer' : IDL.Func([], [IDL.Nat], []),
    'admin_emergency_stop_timer' : IDL.Func([], [], []),
    'admin_pause_claim_queue' : IDL.Func([IDL.Text], [], []),
    'admin_remove_active_claim_request' : IDL.Func(
        [ClaimRequestId],
        [IDL.Bool],
        [],
      ),
    'admin_resume_claim_queue' : IDL.Func([], [], []),
    'admin_retry_claim_request' : IDL.Func(
        [ClaimRequestId],
        [IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text })],
        [],
      ),
    'admin_return_token' : IDL.Func(
        [IDL.Principal, IDL.Nat, IDL.Principal],
        [TransferResult],
        [],
      ),
    'admin_set_enforce_zero_balance_before_claim' : IDL.Func(
        [IDL.Bool],
        [],
        [],
      ),
    'admin_trigger_claim_processing' : IDL.Func([], [IDL.Text], []),
    'claim_position' : IDL.Func([IDL.Principal, PositionId], [IDL.Bool], []),
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
    'get_active_claim_request' : IDL.Func(
        [ClaimRequestId],
        [IDL.Opt(ClaimRequest)],
        ['query'],
      ),
    'get_all_active_claim_requests' : IDL.Func(
        [],
        [IDL.Vec(ClaimRequest)],
        ['query'],
      ),
    'get_all_completed_claim_requests' : IDL.Func(
        [],
        [IDL.Vec(IDL.Text)],
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
    'get_claim_queue_status' : IDL.Func(
        [],
        [
          IDL.Record({
            'pending_count' : IDL.Nat,
            'processing_count' : IDL.Nat,
            'active_total' : IDL.Nat,
            'completed_buffer_count' : IDL.Nat,
            'processing_state' : QueueProcessingState,
          }),
        ],
        ['query'],
      ),
    'get_claim_request_status' : IDL.Func(
        [ClaimRequestId],
        [
          IDL.Opt(
            IDL.Variant({ 'Active' : ClaimRequest, 'Completed' : IDL.Text })
          ),
        ],
        ['query'],
      ),
    'get_claimed_positions_for_principal' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(ClaimedPosition)],
        ['query'],
      ),
    'get_completed_claim_requests' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [IDL.Vec(IDL.Opt(BufferEntry))],
        ['query'],
      ),
    'get_completed_claim_requests_id_range' : IDL.Func(
        [],
        [IDL.Opt(IDL.Tuple(IDL.Nat, IDL.Nat))],
        ['query'],
      ),
    'get_enforce_zero_balance_before_claim' : IDL.Func(
        [],
        [IDL.Bool],
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
    'get_my_active_claim_requests' : IDL.Func(
        [],
        [IDL.Vec(ClaimRequest)],
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
    'get_timer_status' : IDL.Func(
        [],
        [
          IDL.Record({
            'timer_id' : IDL.Opt(IDL.Nat),
            'next_scheduled_time' : IDL.Opt(Timestamp),
            'time_since_last_execution_seconds' : IDL.Opt(IDL.Nat64),
            'last_execution_correlation_id' : IDL.Opt(IDL.Nat),
            'last_execution_time' : IDL.Opt(Timestamp),
            'is_active' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
    'get_token_lock_fee_sneed_e8s' : IDL.Func([], [IDL.Nat], ['query']),
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
    'request_claim_and_withdraw' : IDL.Func(
        [SwapCanisterId, PositionId],
        [ClaimAndWithdrawResult],
        [],
      ),
    'set_max_lock_length_days' : IDL.Func([IDL.Nat64], [], []),
    'set_token_lock_fee_sneed_e8s' : IDL.Func(
        [IDL.Nat],
        [SetLockFeeResult],
        [],
      ),
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
