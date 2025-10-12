import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface Account {
  'owner' : Principal,
  'subaccount' : [] | [Uint8Array | number[]],
}
export type AccountIdentifier = Uint8Array | number[];
export interface CancelSwapArgs { 'swap_id' : number }
export type CancelSwapResponse = { 'Error' : OCError } |
  { 'SwapExpired' : null } |
  { 'SwapAlreadyAccepted' : null } |
  { 'NotAuthorized' : null } |
  { 'Success' : null } |
  { 'SwapNotFound' : null };
export type CanisterId = Principal;
export type ChannelId = number;
export type Chat = { 'Group' : ChatId } |
  { 'Channel' : [CommunityId, ChannelId] } |
  { 'Direct' : ChatId };
export type ChatId = CanisterId;
export type CommunityId = CanisterId;
export interface CompletedCryptoTransaction {
  'to' : CryptoAccount,
  'fee' : bigint,
  'created' : TimestampNanos,
  'block_index' : bigint,
  'token_symbol' : string,
  'from' : CryptoAccount,
  'memo' : [] | [Memo],
  'ledger' : CanisterId,
  'amount' : bigint,
}
export interface CreateSwapArgs {
  'is_public' : boolean,
  'token1_principal' : [] | [Principal],
  'canister_to_notify' : [] | [CanisterId],
  'token0_amount' : bigint,
  'token0' : TokenInfo,
  'token1' : TokenInfo,
  'token0_principal' : [] | [Principal],
  'additional_admins' : Array<Principal>,
  'token1_amount' : bigint,
  'expires_at' : TimestampMillis,
  'location' : P2PSwapLocation,
}
export type CreateSwapResponse = { 'Error' : OCError } |
  {
    'Success' : {
      'id' : number,
      'token1_deposit_address' : [] | [string],
      'token0_deposit_address' : string,
    }
  } |
  { 'InvalidSwap' : string };
export type CryptoAccount = { 'Mint' : null } |
  { 'Account' : Account };
export type Cryptocurrency = { 'InternetComputer' : null } |
  { 'CHAT' : null } |
  { 'SNS1' : null } |
  { 'KINIC' : null } |
  { 'CKBTC' : null } |
  { 'Other' : string };
export interface LookupSwapArgs {
  'swap_id' : number,
  'accepting_principal' : [] | [Principal],
}
export type LookupSwapResponse = { 'Error' : OCError } |
  { 'SwapIsPrivate' : null } |
  {
    'Success' : {
      'id' : number,
      'status' : SwapStatus,
      'is_public' : boolean,
      'canister_to_notify' : [] | [CanisterId],
      'restricted_to' : [] | [Principal],
      'token1_deposit_address' : string,
      'created_at' : TimestampMillis,
      'created_by' : Principal,
      'amount0' : bigint,
      'amount1' : bigint,
      'token0' : TokenInfo,
      'token1' : TokenInfo,
      'offered_by' : Principal,
      'additional_admins' : Array<Principal>,
      'expires_at' : TimestampMillis,
      'token0_deposit_address' : string,
      'location' : P2PSwapLocation,
    }
  } |
  { 'SwapNotFound' : null } |
  { 'PrincipalNotFound' : null };
export type Memo = Uint8Array | number[];
export interface Message {
  'chat' : Chat,
  'message_id' : MessageId,
  'thread_root_message_index' : [] | [MessageIndex],
}
export type MessageId = bigint;
export type MessageIndex = number;
export interface NotifyDepositArgs {
  'swap_id' : number,
  'deposited_by' : [] | [Principal],
}
export type NotifyDepositResponse = { 'Error' : OCError } |
  { 'SwapExpired' : null } |
  { 'BalanceTooLow' : { 'balance' : bigint, 'balance_required' : bigint } } |
  { 'SwapAlreadyAccepted' : null } |
  { 'NotAuthorized' : null } |
  { 'Success' : { 'complete' : boolean } } |
  { 'SwapNotFound' : null } |
  { 'InternalError' : string } |
  { 'SwapCancelled' : null };
export type OCError = [number, [] | [string]];
export type P2PSwapLocation = { 'Message' : Message } |
  { 'External' : null };
export type SwapStatus = { 'Open' : null } |
  { 'Accepted' : SwapStatusAccepted } |
  { 'Cancelled' : SwapStatusCancelled } |
  { 'Completed' : SwapStatusCompleted } |
  { 'Expired' : SwapStatusExpired };
export interface SwapStatusAccepted {
  'accepted_at' : TimestampMillis,
  'accepted_by' : Principal,
}
export interface SwapStatusCancelled {
  'cancelled_at' : TimestampMillis,
  'refunds' : Array<CompletedCryptoTransaction>,
}
export interface SwapStatusCompleted {
  'token0_transfer_out' : CompletedCryptoTransaction,
  'accepted_at' : TimestampMillis,
  'accepted_by' : Principal,
  'refunds' : Array<CompletedCryptoTransaction>,
  'token1_transfer_out' : CompletedCryptoTransaction,
}
export interface SwapStatusExpired {
  'refunds' : Array<CompletedCryptoTransaction>,
}
export type TimestampMillis = bigint;
export type TimestampNanos = bigint;
export interface TokenInfo {
  'fee' : bigint,
  'decimals' : number,
  'ledger' : CanisterId,
  'symbol' : string,
}
export interface _SERVICE {
  'cancel_swap' : ActorMethod<[CancelSwapArgs], CancelSwapResponse>,
  'create_swap' : ActorMethod<[CreateSwapArgs], CreateSwapResponse>,
  'lookup_swap' : ActorMethod<[LookupSwapArgs], LookupSwapResponse>,
  'notify_deposit' : ActorMethod<[NotifyDepositArgs], NotifyDepositResponse>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
