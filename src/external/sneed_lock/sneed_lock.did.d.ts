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
export type PositionId = bigint;
export interface PositionLock {
  'dex' : Dex,
  'lock_id' : LockId,
  'token0' : TokenType,
  'token1' : TokenType,
  'expiry' : Expiry,
  'position_id' : PositionId,
}
export type SetLockFeeResult = { 'Ok' : bigint } |
  { 'Err' : string };
export interface SneedLock {
  'admin_return_token' : ActorMethod<
    [Principal, bigint, Principal],
    TransferResult
  >,
  'claim_position' : ActorMethod<[Principal, PositionId], boolean>,
  'clear_expired_locks' : ActorMethod<[], undefined>,
  'clear_expired_position_locks' : ActorMethod<[], undefined>,
  'create_lock' : ActorMethod<[bigint, Principal, Expiry], CreateLockResult>,
  'create_position_lock' : ActorMethod<
    [Principal, Dex, PositionId, Expiry, TokenType, TokenType],
    CreateLockResult
  >,
  'get_all_position_locks' : ActorMethod<[], Array<FullyQualifiedPositionLock>>,
  'get_all_token_locks' : ActorMethod<[], Array<FullyQualifiedLock>>,
  'get_claimed_positions_for_principal' : ActorMethod<
    [Principal],
    Array<ClaimedPosition>
  >,
  'get_error_entries' : ActorMethod<
    [bigint, bigint],
    Array<[] | [BufferEntry]>
  >,
  'get_error_id_range' : ActorMethod<[], [] | [[bigint, bigint]]>,
  'get_info_entries' : ActorMethod<[bigint, bigint], Array<[] | [BufferEntry]>>,
  'get_info_id_range' : ActorMethod<[], [] | [[bigint, bigint]]>,
  'get_ledger_token_locks' : ActorMethod<
    [TokenType],
    Array<FullyQualifiedLock>
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
  'get_token_lock_fee_sneed_e8s' : ActorMethod<[], bigint>,
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
  'set_max_lock_length_days' : ActorMethod<[bigint], undefined>,
  'set_token_lock_fee_sneed_e8s' : ActorMethod<[bigint], SetLockFeeResult>,
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
