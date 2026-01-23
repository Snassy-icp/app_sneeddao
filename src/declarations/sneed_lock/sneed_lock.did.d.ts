import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export type Balance = bigint;
export interface BufferEntry {
  'id' : bigint,
  'content' : string,
  'timestamp' : bigint,
  'caller' : Principal,
  'correlation_id' : bigint,
}
export type ClaimAndWithdrawResult = { 'Ok' : ClaimRequestId } |
  { 'Err' : string };
export interface ClaimRequest {
  'request_id' : ClaimRequestId,
  'status' : ClaimRequestStatus,
  'retry_count' : bigint,
  'started_processing_at' : [] | [Timestamp],
  'created_at' : Timestamp,
  'token0' : TokenType,
  'token1' : TokenType,
  'caller' : Principal,
  'swap_canister_id' : SwapCanisterId,
  'last_attempted_at' : [] | [Timestamp],
  'completed_at' : [] | [Timestamp],
  'position_id' : PositionId,
}
export type ClaimRequestId = bigint;
export type ClaimRequestStatus = { 'Failed' : string } |
  {
    'ClaimVerified' : {
      'balance1_before' : Balance,
      'amount1_claimed' : Balance,
      'amount0_claimed' : Balance,
      'balance0_before' : Balance,
    }
  } |
  {
    'Withdrawn' : { 'amount1_claimed' : Balance, 'amount0_claimed' : Balance }
  } |
  {
    'ClaimAttempted' : {
      'balance1_before' : Balance,
      'claim_attempt' : bigint,
      'balance0_before' : Balance,
    }
  } |
  { 'Processing' : null } |
  { 'TimedOut' : null } |
  {
    'Completed' : {
      'amount1_claimed' : Balance,
      'transfer1_tx_id' : [] | [bigint],
      'amount0_claimed' : Balance,
      'amount0_transferred' : Balance,
      'transfer0_tx_id' : [] | [bigint],
      'amount1_transferred' : Balance,
    }
  } |
  { 'Pending' : null } |
  {
    'BalanceRecorded' : {
      'balance1_before' : Balance,
      'balance0_before' : Balance,
    }
  };
export interface ClaimedPosition {
  'owner' : Principal,
  'swap_canister_id' : SwapCanisterId,
  'position_lock' : [] | [PositionLock],
  'position_id' : PositionId,
}
export interface CreateLockError {
  'transfer_error' : [] | [TransferError],
  'message' : string,
}
export type CreateLockResult = { 'Ok' : LockId } |
  { 'Err' : CreateLockError };
export type Dex = bigint;
export type Expiry = bigint;
export type FullyQualifiedLock = [Principal, TokenType, Lock];
export type FullyQualifiedPositionLock = [
  Principal,
  SwapCanisterId,
  PositionLock,
];
export interface Lock {
  'lock_id' : LockId,
  'expiry' : Expiry,
  'amount' : Balance,
}
export type LockId = bigint;
export type LockInfo = { 'PositionLock' : FullyQualifiedPositionLock } |
  { 'TokenLock' : FullyQualifiedLock };
export type LockType = { 'PositionLock' : null } |
  { 'TokenLock' : null };
export type PositionId = bigint;
export interface PositionLock {
  'dex' : Dex,
  'lock_id' : LockId,
  'token0' : TokenType,
  'token1' : TokenType,
  'expiry' : Expiry,
  'position_id' : PositionId,
}
export type QueueProcessingState = { 'Paused' : string } |
  { 'Active' : null };
export interface SneedLock {
  'admin_add_admin' : ActorMethod<
    [Principal],
    { 'Ok' : string } |
      { 'Err' : string }
  >,
  'admin_clear_completed_claim_requests' : ActorMethod<[], bigint>,
  'admin_clear_failed_claim_requests' : ActorMethod<[], bigint>,
  'admin_emergency_stop_timer' : ActorMethod<[], undefined>,
  'admin_pause_claim_queue' : ActorMethod<[string], undefined>,
  'admin_remove_active_claim_request' : ActorMethod<[ClaimRequestId], boolean>,
  'admin_remove_admin' : ActorMethod<
    [Principal],
    { 'Ok' : string } |
      { 'Err' : string }
  >,
  'admin_rescue_stuck_tokens' : ActorMethod<
    [TokenType, Principal],
    { 'Ok' : string } |
      { 'Err' : string }
  >,
  'admin_resume_claim_queue' : ActorMethod<[], undefined>,
  'admin_retry_claim_request' : ActorMethod<
    [ClaimRequestId],
    { 'Ok' : string } |
      { 'Err' : string }
  >,
  'admin_return_token' : ActorMethod<
    [Principal, bigint, Principal],
    TransferResult
  >,
  'admin_return_token_from_failed_request' : ActorMethod<
    [Principal, bigint, Principal],
    TransferResult
  >,
  'admin_set_enforce_zero_balance_before_claim' : ActorMethod<
    [boolean],
    undefined
  >,
  'admin_set_icp_fee_recipient' : ActorMethod<
    [[] | [Principal], [] | [Uint8Array | number[]]],
    { 'Ok' : string } |
      { 'Err' : string }
  >,
  'admin_set_lock_fees_icp' : ActorMethod<
    [[] | [bigint], [] | [bigint], [] | [bigint], [] | [bigint]],
    { 'Ok' : string } |
      { 'Err' : string }
  >,
  'admin_set_sneed_premium_canister_id' : ActorMethod<
    [[] | [Principal]],
    { 'Ok' : string } |
      { 'Err' : string }
  >,
  'admin_trigger_claim_processing' : ActorMethod<[], string>,
  'claim_position' : ActorMethod<[Principal, PositionId], boolean>,
  'clear_expired_locks' : ActorMethod<[], undefined>,
  'clear_expired_position_locks' : ActorMethod<[], undefined>,
  'create_lock' : ActorMethod<[bigint, Principal, Expiry], CreateLockResult>,
  'create_position_lock' : ActorMethod<
    [Principal, Dex, PositionId, Expiry, TokenType, TokenType],
    CreateLockResult
  >,
  'getEffectiveLockFee' : ActorMethod<
    [Principal, boolean],
    { 'is_premium' : boolean, 'fee_e8s' : bigint }
  >,
  'getPaymentBalance' : ActorMethod<[Principal], bigint>,
  'getPaymentSubaccount' : ActorMethod<[Principal], Uint8Array | number[]>,
  'get_active_claim_request' : ActorMethod<
    [ClaimRequestId],
    [] | [ClaimRequest]
  >,
  'get_admin_list' : ActorMethod<[], Array<Principal>>,
  'get_all_active_claim_requests' : ActorMethod<[], Array<ClaimRequest>>,
  'get_all_completed_claim_requests' : ActorMethod<[], Array<ClaimRequest>>,
  'get_all_failed_claim_requests' : ActorMethod<[], Array<ClaimRequest>>,
  'get_all_position_locks' : ActorMethod<[], Array<FullyQualifiedPositionLock>>,
  'get_all_token_locks' : ActorMethod<[], Array<FullyQualifiedLock>>,
  'get_claim_queue_status' : ActorMethod<
    [],
    {
      'pending_count' : bigint,
      'is_currently_processing' : boolean,
      'processing_count' : bigint,
      'active_total' : bigint,
      'completed_count' : bigint,
      'processing_state' : QueueProcessingState,
      'consecutive_empty_cycles' : bigint,
      'failed_count' : bigint,
    }
  >,
  'get_claim_request_status' : ActorMethod<
    [ClaimRequestId],
    [] | [
      { 'Failed' : ClaimRequest } |
        { 'Active' : ClaimRequest } |
        { 'Completed' : ClaimRequest }
    ]
  >,
  'get_claimed_positions_for_principal' : ActorMethod<
    [Principal],
    Array<ClaimedPosition>
  >,
  'get_completed_claim_request' : ActorMethod<
    [ClaimRequestId],
    [] | [ClaimRequest]
  >,
  'get_enforce_zero_balance_before_claim' : ActorMethod<[], boolean>,
  'get_error_entries' : ActorMethod<
    [bigint, bigint],
    Array<[] | [BufferEntry]>
  >,
  'get_error_id_range' : ActorMethod<[], [] | [[bigint, bigint]]>,
  'get_failed_claim_request' : ActorMethod<
    [ClaimRequestId],
    [] | [ClaimRequest]
  >,
  'get_info_entries' : ActorMethod<[bigint, bigint], Array<[] | [BufferEntry]>>,
  'get_info_id_range' : ActorMethod<[], [] | [[bigint, bigint]]>,
  'get_ledger_token_locks' : ActorMethod<
    [TokenType],
    Array<FullyQualifiedLock>
  >,
  'get_lock_by_id' : ActorMethod<[LockId], [] | [LockInfo]>,
  'get_lock_fees_icp' : ActorMethod<
    [],
    {
      'fee_recipient_principal' : [] | [Principal],
      'premium_position_lock_fee_icp_e8s' : bigint,
      'token_lock_fee_icp_e8s' : bigint,
      'sneed_premium_canister_id' : [] | [Principal],
      'premium_token_lock_fee_icp_e8s' : bigint,
      'position_lock_fee_icp_e8s' : bigint,
      'fee_recipient_subaccount' : [] | [Uint8Array | number[]],
    }
  >,
  'get_lock_type' : ActorMethod<[LockId], [] | [LockType]>,
  'get_my_active_claim_requests' : ActorMethod<[], Array<ClaimRequest>>,
  'get_position_lock_by_id' : ActorMethod<
    [LockId],
    [] | [FullyQualifiedPositionLock]
  >,
  'get_position_ownerships' : ActorMethod<
    [],
    Array<[SwapCanisterId, PositionId]>
  >,
  'get_summed_locks' : ActorMethod<[], Array<[TokenType, Balance]>>,
  'get_swap_position_locks' : ActorMethod<
    [SwapCanisterId],
    Array<FullyQualifiedPositionLock>
  >,
  'get_timer_status' : ActorMethod<
    [],
    {
      'timer_id' : [] | [bigint],
      'next_scheduled_time' : [] | [Timestamp],
      'time_since_last_execution_seconds' : [] | [bigint],
      'last_execution_correlation_id' : [] | [bigint],
      'last_execution_time' : [] | [Timestamp],
      'is_active' : boolean,
    }
  >,
  'get_token_lock_by_id' : ActorMethod<[LockId], [] | [FullyQualifiedLock]>,
  'get_token_locks' : ActorMethod<
    [],
    Array<[LockId, TokenType, Balance, Expiry]>
  >,
  'get_token_position_locks' : ActorMethod<
    [TokenType],
    Array<FullyQualifiedPositionLock>
  >,
  'has_expired_locks' : ActorMethod<[], boolean>,
  'has_expired_position_locks' : ActorMethod<[], boolean>,
  'request_claim_and_withdraw' : ActorMethod<
    [SwapCanisterId, PositionId],
    ClaimAndWithdrawResult
  >,
  'set_max_lock_length_days' : ActorMethod<[bigint], undefined>,
  'transfer_position' : ActorMethod<
    [Principal, Principal, PositionId],
    TransferPositionResult
  >,
  'transfer_position_ownership' : ActorMethod<
    [Principal, SwapCanisterId, PositionId],
    TransferPositionOwnershipResult
  >,
  'transfer_token_lock_ownership' : ActorMethod<
    [Principal, TokenType, LockId],
    TransferTokenLockOwnershipResult
  >,
  'transfer_tokens' : ActorMethod<
    [Principal, [] | [Subaccount], Principal, Balance],
    TransferResult
  >,
  'update_position_lock' : ActorMethod<
    [Principal, PositionId, Expiry],
    CreateLockResult
  >,
}
export type Subaccount = Uint8Array | number[];
export type SwapCanisterId = Principal;
export type Timestamp = bigint;
export type TokenType = Principal;
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
export interface TransferPositionOwnershipError { 'message' : string }
export type TransferPositionOwnershipResult = { 'Ok' : null } |
  { 'Err' : TransferPositionOwnershipError };
export type TransferPositionResult = { 'ok' : boolean } |
  { 'err' : TransferPositionError };
export type TransferResult = { 'Ok' : TxIndex } |
  { 'Err' : TransferError };
export interface TransferTokenLockOwnershipError {
  'transfer_error' : [] | [TransferError],
  'message' : string,
}
export type TransferTokenLockOwnershipResult = { 'Ok' : null } |
  { 'Err' : TransferTokenLockOwnershipError };
export type TxIndex = bigint;
export interface _SERVICE extends SneedLock {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
