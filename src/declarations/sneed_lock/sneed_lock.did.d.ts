import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface Account {
  'owner' : Principal,
  'subaccount' : [] | [Uint8Array | number[]],
}
export type AddLiquidityResult = {
    'Ok' : {
      'returned0' : bigint,
      'returned1' : bigint,
      'credited0' : bigint,
      'credited1' : bigint,
      'used0' : bigint,
      'used1' : bigint,
      'increase_error' : [] | [string],
      'position_id' : PositionId,
    }
  } |
  { 'Err' : string };
export interface ApprovalInfo {
  'memo' : [] | [Uint8Array | number[]],
  'from_subaccount' : [] | [Uint8Array | number[]],
  'created_at_time' : bigint,
  'expires_at' : [] | [bigint],
  'spender' : Account,
}
export interface ApproveCollectionArg { 'approval_info' : ApprovalInfo }
export type ApproveCollectionError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'InvalidSpender' : null } |
  { 'CreatedInFuture' : { 'ledger_time' : bigint } } |
  { 'GenericBatchError' : { 'message' : string, 'error_code' : bigint } } |
  { 'TooOld' : null };
export type ApproveCollectionResult = { 'Ok' : bigint } |
  { 'Err' : ApproveCollectionError };
export interface ApproveTokenArg {
  'token_id' : bigint,
  'approval_info' : ApprovalInfo,
}
export type ApproveTokenError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'InvalidSpender' : null } |
  { 'NonExistingTokenId' : null } |
  { 'Unauthorized' : null } |
  { 'CreatedInFuture' : { 'ledger_time' : bigint } } |
  { 'GenericBatchError' : { 'message' : string, 'error_code' : bigint } } |
  { 'TooOld' : null };
export type ApproveTokenResult = { 'Ok' : bigint } |
  { 'Err' : ApproveTokenError };
export interface ArchiveInfo {
  'canister_id' : Principal,
  'start' : bigint,
  'length' : bigint,
  'max_blocks' : bigint,
}
export interface ArchiveRange {
  'end' : bigint,
  'canister_id' : Principal,
  'start' : bigint,
}
export interface ArchivedBlocks {
  'args' : GetBlocksArgs,
  'callback' : [Principal, string],
}
export type Balance = bigint;
export interface Block { 'id' : bigint, 'block' : Value__1 }
export interface BlockRange { 'start' : bigint, 'length' : bigint }
export interface BlockType { 'url' : string, 'block_type' : string }
export interface BufferEntry {
  'id' : bigint,
  'content' : string,
  'timestamp' : bigint,
  'caller' : Principal,
  'correlation_id' : bigint,
}
export type ClaimAndWithdrawResult = { 'Ok' : ClaimRequestId } |
  { 'Err' : string };
export type ClaimFeesResult = {
    'Ok' : {
      'request_id' : ClaimRequestId,
      'amount0' : bigint,
      'amount1' : bigint,
      'token0' : TokenType,
      'token1' : TokenType,
    }
  } |
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
export interface ClaimRequestPageQuery {
  'prev' : [] | [bigint],
  'take' : [] | [bigint],
  'failed' : boolean,
}
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
export interface CollectionApproval {
  'memo' : [] | [Uint8Array | number[]],
  'from_subaccount' : [] | [Uint8Array | number[]],
  'created_at_time' : bigint,
  'expires_at' : [] | [bigint],
  'spender' : Account,
}
export interface CreateLockError {
  'transfer_error' : [] | [TransferError],
  'message' : string,
}
export type CreateLockResult = { 'Ok' : LockId } |
  { 'Err' : CreateLockError };
export interface DataCertificate {
  'certificate' : Uint8Array | number[],
  'hash_tree' : Uint8Array | number[],
}
export type Dex = bigint;
export type Expiry = bigint;
export type FullyQualifiedLock = [Principal, TokenType, Lock];
export type FullyQualifiedPositionLock = [
  Principal,
  SwapCanisterId,
  PositionLock,
];
export interface GetArchivesArgs { 'from' : [] | [Principal] }
export type GetArchivesResult = Array<ArchiveRange>;
export type GetBlocksArgs = Array<BlockRange>;
export interface GetBlocksResult {
  'log_length' : bigint,
  'blocks' : Array<Block>,
  'archived_blocks' : Array<ArchivedBlocks>,
}
export interface IsApprovedArg {
  'token_id' : bigint,
  'from_subaccount' : [] | [Uint8Array | number[]],
  'spender' : Account,
}
export interface Lock {
  'lock_id' : LockId,
  'expiry' : Expiry,
  'amount' : Balance,
}
export type LockId = bigint;
export type LockInfo = { 'PositionLock' : FullyQualifiedPositionLock } |
  { 'TokenLock' : FullyQualifiedLock };
export interface LockLimits {
  'min_lock_length_ns' : bigint,
  'max_lock_length_ns' : bigint,
}
export type LockOpError = { 'Invalid' : string } |
  { 'NotFound' : null } |
  { 'NotOwner' : null } |
  { 'InProgress' : null };
export type LockOpResult = { 'Ok' : LockState } |
  { 'Err' : LockOpError };
export interface LockPageQuery {
  'status' : [] | [LockStatusFilter],
  'token' : [] | [TokenType],
  'owner' : [] | [Principal],
  'kind' : [] | [LockType],
  'prev' : [] | [LockId],
  'take' : [] | [bigint],
  'ledger' : [] | [TokenType],
  'swap_canister_id' : [] | [SwapCanisterId],
  'include_archived' : boolean,
}
export interface LockState {
  'dex' : [] | [Dex],
  'dissolve_delay' : bigint,
  'lock_id' : LockId,
  'owner_subaccount' : [] | [Uint8Array | number[]],
  'owner' : Principal,
  'kind' : LockType,
  'locked' : boolean,
  'created_at' : [] | [bigint],
  'earliest_unlock' : Expiry,
  'token0' : [] | [TokenType],
  'token1' : [] | [TokenType],
  'ledger' : [] | [TokenType],
  'lock_end' : Expiry,
  'dissolving_until' : [] | [Expiry],
  'swap_canister_id' : [] | [SwapCanisterId],
  'expiry' : Expiry,
  'amount' : [] | [Balance],
  'archived' : boolean,
  'position_id' : [] | [PositionId],
}
export type LockStatusFilter = { 'Active' : null } |
  { 'Expired' : null };
export type LockType = { 'PositionLock' : null } |
  { 'TokenLock' : null };
export interface LogStatus {
  'live_blocks' : bigint,
  'live_first_index' : bigint,
  'history_imported' : boolean,
  'spilling' : boolean,
  'settings' : Settings,
  'log_length' : bigint,
  'last_block_hash' : [] | [Uint8Array | number[]],
  'archives' : Array<ArchiveInfo>,
}
export interface PaymentLogEntry {
  'id' : bigint,
  'amount_e8s' : bigint,
  'icp_transaction_id' : bigint,
  'timestamp' : Timestamp,
  'lock_type' : LockType,
  'payer' : Principal,
  'correlation_id' : bigint,
}
export type PositionId = bigint;
export interface PositionLock {
  'dex' : Dex,
  'lock_id' : LockId,
  'token0' : TokenType,
  'token1' : TokenType,
  'expiry' : Expiry,
  'position_id' : PositionId,
}
export interface Registration {
  'last_error' : [] | [string],
  'canister_id' : Principal,
  'attempts' : bigint,
  'start' : bigint,
  'proposal_id' : [] | [bigint],
}
export interface RevokeCollectionApprovalArg {
  'memo' : [] | [Uint8Array | number[]],
  'from_subaccount' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
  'spender' : [] | [Account],
}
export type RevokeCollectionApprovalError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'CreatedInFuture' : { 'ledger_time' : bigint } } |
  { 'ApprovalDoesNotExist' : null } |
  { 'GenericBatchError' : { 'message' : string, 'error_code' : bigint } } |
  { 'TooOld' : null };
export type RevokeCollectionApprovalResult = { 'Ok' : bigint } |
  { 'Err' : RevokeCollectionApprovalError };
export interface RevokeTokenApprovalArg {
  'token_id' : bigint,
  'memo' : [] | [Uint8Array | number[]],
  'from_subaccount' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
  'spender' : [] | [Account],
}
export type RevokeTokenApprovalError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'NonExistingTokenId' : null } |
  { 'Unauthorized' : null } |
  { 'CreatedInFuture' : { 'ledger_time' : bigint } } |
  { 'ApprovalDoesNotExist' : null } |
  { 'GenericBatchError' : { 'message' : string, 'error_code' : bigint } } |
  { 'TooOld' : null };
export type RevokeTokenApprovalResult = { 'Ok' : bigint } |
  { 'Err' : RevokeTokenApprovalError };
export interface Settings {
  'archive_top_up_threshold' : bigint,
  'archive_max_blocks' : bigint,
  'max_live_blocks' : bigint,
  'archive_initial_cycles' : bigint,
  'spill_batch_size' : bigint,
  'archive_top_up_amount' : bigint,
}
export interface SettingsUpdate {
  'archive_top_up_threshold' : [] | [bigint],
  'archive_max_blocks' : [] | [bigint],
  'max_live_blocks' : [] | [bigint],
  'archive_initial_cycles' : [] | [bigint],
  'spill_batch_size' : [] | [bigint],
  'archive_top_up_amount' : [] | [bigint],
}
export interface SneedLock {
  'add_liquidity_to_locked_position' : ActorMethod<
    [SwapCanisterId, PositionId, bigint, bigint],
    AddLiquidityResult
  >,
  'admin_add_admin' : ActorMethod<
    [Principal],
    { 'Ok' : string } |
      { 'Err' : string }
  >,
  'admin_clear_completed_claim_requests' : ActorMethod<[], bigint>,
  'admin_clear_failed_claim_requests' : ActorMethod<[], bigint>,
  'admin_get_payment_log' : ActorMethod<
    [bigint, bigint],
    {
      'payments' : Array<PaymentLogEntry>,
      'total_count' : bigint,
      'has_more' : boolean,
    }
  >,
  'admin_get_payment_log_count' : ActorMethod<[], bigint>,
  'admin_get_pool_unused_balance' : ActorMethod<
    [SwapCanisterId],
    { 'Ok' : { 'balance0' : bigint, 'balance1' : bigint } } |
      { 'Err' : string }
  >,
  'admin_icrc3_import_history' : ActorMethod<
    [],
    { 'Ok' : bigint } |
      { 'Err' : string }
  >,
  'admin_icrc3_register_archives_now' : ActorMethod<
    [],
    { 'Ok' : bigint } |
      { 'Err' : string }
  >,
  'admin_icrc3_repair_archive_controllers' : ActorMethod<
    [],
    Array<[Principal, { 'Ok' : null } | { 'Err' : string }]>
  >,
  'admin_icrc3_reset_archive_registration' : ActorMethod<
    [Principal],
    { 'Ok' : boolean } |
      { 'Err' : string }
  >,
  'admin_icrc3_spill_now' : ActorMethod<
    [],
    { 'Ok' : bigint } |
      { 'Err' : string }
  >,
  'admin_pool_deposit' : ActorMethod<
    [SwapCanisterId, TokenType, bigint],
    { 'Ok' : bigint } |
      { 'Err' : string }
  >,
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
  'admin_return_token' : ActorMethod<
    [Principal, bigint, Principal],
    TransferResult
  >,
  'admin_return_token_from_failed_request' : ActorMethod<
    [Principal, bigint, Principal],
    TransferResult
  >,
  'admin_set_icp_fee_recipient' : ActorMethod<
    [[] | [Principal], [] | [Uint8Array | number[]]],
    { 'Ok' : string } |
      { 'Err' : string }
  >,
  'admin_set_icrc3_proposal_neuron' : ActorMethod<
    [[] | [Uint8Array | number[]]],
    { 'Ok' : null } |
      { 'Err' : string }
  >,
  'admin_set_icrc3_settings' : ActorMethod<
    [SettingsUpdate],
    { 'Ok' : Settings } |
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
  'admin_withdraw_pool_balance_to_user' : ActorMethod<
    [SwapCanisterId, TokenType, bigint, Principal],
    { 'Ok' : bigint } |
      { 'Err' : string }
  >,
  'claim_position' : ActorMethod<[Principal, PositionId], boolean>,
  'claim_position_fees' : ActorMethod<
    [SwapCanisterId, PositionId],
    ClaimFeesResult
  >,
  'clear_expired_locks' : ActorMethod<[], undefined>,
  'clear_expired_position_locks' : ActorMethod<[], undefined>,
  'create_lock' : ActorMethod<
    [bigint, Principal, Expiry, [] | [bigint]],
    CreateLockResult
  >,
  'create_position_lock' : ActorMethod<
    [Principal, Dex, PositionId, Expiry, TokenType, TokenType, [] | [bigint]],
    CreateLockResult
  >,
  'extend_lock' : ActorMethod<[LockId, Expiry], LockOpResult>,
  'getEffectiveLockFee' : ActorMethod<
    [Principal, boolean],
    { 'is_premium' : boolean, 'fee_e8s' : bigint }
  >,
  'getPaymentBalance' : ActorMethod<[Principal], bigint>,
  'getPaymentSubaccount' : ActorMethod<[Principal], Uint8Array | number[]>,
  'get_admin_list' : ActorMethod<[], Array<Principal>>,
  'get_claim_request_status' : ActorMethod<
    [ClaimRequestId],
    [] | [
      { 'Failed' : ClaimRequest } |
        { 'Active' : ClaimRequest } |
        { 'Completed' : ClaimRequest }
    ]
  >,
  'get_claim_requests_page' : ActorMethod<
    [ClaimRequestPageQuery],
    Array<ClaimRequest>
  >,
  'get_claimed_positions_for_principal' : ActorMethod<
    [Principal],
    Array<ClaimedPosition>
  >,
  'get_completed_claim_request' : ActorMethod<
    [ClaimRequestId],
    [] | [ClaimRequest]
  >,
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
  'get_lock_by_id' : ActorMethod<[LockId], [] | [LockInfo]>,
  'get_lock_fee_stats' : ActorMethod<
    [],
    {
      'total_position_lock_fees_collected_e8s' : bigint,
      'total_fees_collected_e8s' : bigint,
      'total_token_lock_fees_collected_e8s' : bigint,
    }
  >,
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
  'get_lock_limits' : ActorMethod<[], LockLimits>,
  'get_lock_state' : ActorMethod<[LockId], [] | [LockState]>,
  'get_lock_states' : ActorMethod<[Array<LockId>], Array<[] | [LockState]>>,
  'get_lock_states_page' : ActorMethod<[LockPageQuery], Array<LockState>>,
  'get_lock_type' : ActorMethod<[LockId], [] | [LockType]>,
  'get_my_claim_history' : ActorMethod<[], Array<ClaimRequest>>,
  'get_position_lock_by_id' : ActorMethod<
    [LockId],
    [] | [FullyQualifiedPositionLock]
  >,
  'get_position_nft' : ActorMethod<[SwapCanisterId, PositionId], [] | [bigint]>,
  'get_position_ownerships' : ActorMethod<
    [],
    Array<[SwapCanisterId, PositionId]>
  >,
  'get_summed_locks' : ActorMethod<[], Array<[TokenType, Balance]>>,
  'get_token_lock_by_id' : ActorMethod<[LockId], [] | [FullyQualifiedLock]>,
  'get_token_locks' : ActorMethod<
    [],
    Array<[LockId, TokenType, Balance, Expiry]>
  >,
  'has_expired_locks' : ActorMethod<[], boolean>,
  'has_expired_position_locks' : ActorMethod<[], boolean>,
  'icrc10_supported_standards' : ActorMethod<[], Array<SupportedStandard>>,
  'icrc37_approve_collection' : ActorMethod<
    [Array<ApproveCollectionArg>],
    Array<[] | [ApproveCollectionResult]>
  >,
  'icrc37_approve_tokens' : ActorMethod<
    [Array<ApproveTokenArg>],
    Array<[] | [ApproveTokenResult]>
  >,
  'icrc37_get_collection_approvals' : ActorMethod<
    [Account, [] | [CollectionApproval], [] | [bigint]],
    Array<CollectionApproval>
  >,
  'icrc37_get_token_approvals' : ActorMethod<
    [Array<bigint>, [] | [TokenApproval], [] | [bigint]],
    Array<TokenApproval>
  >,
  'icrc37_is_approved' : ActorMethod<[Array<IsApprovedArg>], Array<boolean>>,
  'icrc37_max_approvals_per_token_or_collection' : ActorMethod<
    [],
    [] | [bigint]
  >,
  'icrc37_max_revoke_approvals' : ActorMethod<[], [] | [bigint]>,
  'icrc37_metadata' : ActorMethod<[], Array<[string, Value]>>,
  'icrc37_revoke_collection_approvals' : ActorMethod<
    [Array<RevokeCollectionApprovalArg>],
    Array<[] | [RevokeCollectionApprovalResult]>
  >,
  'icrc37_revoke_token_approvals' : ActorMethod<
    [Array<RevokeTokenApprovalArg>],
    Array<[] | [RevokeTokenApprovalResult]>
  >,
  'icrc37_transfer_from' : ActorMethod<
    [Array<TransferFromArg>],
    Array<[] | [TransferFromResult]>
  >,
  'icrc3_get_archives' : ActorMethod<[GetArchivesArgs], GetArchivesResult>,
  'icrc3_get_blocks' : ActorMethod<[GetBlocksArgs], GetBlocksResult>,
  'icrc3_get_tip_certificate' : ActorMethod<[], [] | [DataCertificate]>,
  'icrc3_log_status' : ActorMethod<[], LogStatus>,
  'icrc3_registration_status' : ActorMethod<[], Status>,
  'icrc3_supported_block_types' : ActorMethod<[], Array<BlockType>>,
  'icrc7_atomic_batch_transfers' : ActorMethod<[], [] | [boolean]>,
  'icrc7_balance_of' : ActorMethod<[Array<Account>], Array<bigint>>,
  'icrc7_collection_metadata' : ActorMethod<[], Array<[string, Value]>>,
  'icrc7_default_take_value' : ActorMethod<[], [] | [bigint]>,
  'icrc7_description' : ActorMethod<[], [] | [string]>,
  'icrc7_logo' : ActorMethod<[], [] | [string]>,
  'icrc7_max_memo_size' : ActorMethod<[], [] | [bigint]>,
  'icrc7_max_query_batch_size' : ActorMethod<[], [] | [bigint]>,
  'icrc7_max_take_value' : ActorMethod<[], [] | [bigint]>,
  'icrc7_max_update_batch_size' : ActorMethod<[], [] | [bigint]>,
  'icrc7_name' : ActorMethod<[], string>,
  'icrc7_owner_of' : ActorMethod<[Array<bigint>], Array<[] | [Account]>>,
  'icrc7_permitted_drift' : ActorMethod<[], [] | [bigint]>,
  'icrc7_supply_cap' : ActorMethod<[], [] | [bigint]>,
  'icrc7_symbol' : ActorMethod<[], string>,
  'icrc7_token_metadata' : ActorMethod<
    [Array<bigint>],
    Array<[] | [Array<[string, Value]>]>
  >,
  'icrc7_tokens' : ActorMethod<[[] | [bigint], [] | [bigint]], Array<bigint>>,
  'icrc7_tokens_of' : ActorMethod<
    [Account, [] | [bigint], [] | [bigint]],
    Array<bigint>
  >,
  'icrc7_total_supply' : ActorMethod<[], bigint>,
  'icrc7_transfer' : ActorMethod<
    [Array<TransferArg>],
    Array<[] | [TransferResult__1]>
  >,
  'icrc7_tx_window' : ActorMethod<[], [] | [bigint]>,
  'increase_dissolve_delay' : ActorMethod<[LockId, bigint], LockOpResult>,
  'request_claim_and_withdraw' : ActorMethod<
    [SwapCanisterId, PositionId],
    ClaimAndWithdrawResult
  >,
  'set_max_lock_length_days' : ActorMethod<[bigint], undefined>,
  'start_dissolving' : ActorMethod<[LockId], LockOpResult>,
  'stop_dissolving' : ActorMethod<[LockId], LockOpResult>,
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
export interface Status {
  'neuron' : [] | [Uint8Array | number[]],
  'registrations' : Array<Registration>,
  'governance' : Principal,
}
export type Subaccount = Uint8Array | number[];
export interface SupportedStandard { 'url' : string, 'name' : string }
export type SwapCanisterId = Principal;
export type Timestamp = bigint;
export interface TokenApproval {
  'token_id' : bigint,
  'approval_info' : ApprovalInfo,
}
export type TokenType = Principal;
export interface TransferArg {
  'to' : Account,
  'token_id' : bigint,
  'memo' : [] | [Uint8Array | number[]],
  'from_subaccount' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
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
export type TransferError__1 = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'Duplicate' : { 'duplicate_of' : bigint } } |
  { 'NonExistingTokenId' : null } |
  { 'Unauthorized' : null } |
  { 'CreatedInFuture' : { 'ledger_time' : bigint } } |
  { 'InvalidRecipient' : null } |
  { 'GenericBatchError' : { 'message' : string, 'error_code' : bigint } } |
  { 'TooOld' : null };
export interface TransferFromArg {
  'to' : Account,
  'spender_subaccount' : [] | [Uint8Array | number[]],
  'token_id' : bigint,
  'from' : Account,
  'memo' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
}
export type TransferFromError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'Duplicate' : { 'duplicate_of' : bigint } } |
  { 'NonExistingTokenId' : null } |
  { 'Unauthorized' : null } |
  { 'CreatedInFuture' : { 'ledger_time' : bigint } } |
  { 'InvalidRecipient' : null } |
  { 'GenericBatchError' : { 'message' : string, 'error_code' : bigint } } |
  { 'TooOld' : null };
export type TransferFromResult = { 'Ok' : bigint } |
  { 'Err' : TransferFromError };
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
export type TransferResult__1 = { 'Ok' : bigint } |
  { 'Err' : TransferError__1 };
export interface TransferTokenLockOwnershipError {
  'transfer_error' : [] | [TransferError],
  'message' : string,
}
export type TransferTokenLockOwnershipResult = { 'Ok' : null } |
  { 'Err' : TransferTokenLockOwnershipError };
export type TxIndex = bigint;
export type Value = { 'Int' : bigint } |
  { 'Map' : Array<[string, Value]> } |
  { 'Nat' : bigint } |
  { 'Blob' : Uint8Array | number[] } |
  { 'Text' : string } |
  { 'Array' : Array<Value> };
export type Value__1 = { 'Int' : bigint } |
  { 'Map' : Array<[string, Value__1]> } |
  { 'Nat' : bigint } |
  { 'Blob' : Uint8Array | number[] } |
  { 'Text' : string } |
  { 'Array' : Array<Value__1> };
export interface _SERVICE extends SneedLock {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
