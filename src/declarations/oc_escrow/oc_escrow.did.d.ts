import type { Principal } from '@icp-sdk/core/principal';
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

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
  /**
   * Determines whether anyone can call lookup_swap to see the details of the swap or whether only the creator and admins can see the details.
   */
  'is_public' : boolean,
  /**
   * The principal of the accepting account. This is where token0 will be sent if the swap completes or where token1 is refunded to. If this is not specified then anyone can accept the swap.
   */
  'token1_principal' : [] | [Principal],
  /**
   * If specified, this canister will be notified when the status of the swap has changed.
   */
  'canister_to_notify' : [] | [CanisterId],
  /**
   * The amount of token0 to be deposited. When making the deposit it is necessary to add the fee to this amount to cover the transaction fee for the swap or refund.
   */
  'token0_amount' : bigint,
  /**
   * The token to be deposited by the offerer of the swap.
   */
  'token0' : TokenInfo,
  /**
   * The token to be deposited by the accepter of the swap.
   */
  'token1' : TokenInfo,
  /**
   * The principal of the offering account. This is where token1 will be sent if the swap completes or where token0 is refunded to. If this is not specified then the caller's principal is used.
   */
  'token0_principal' : [] | [Principal],
  /**
   * The principals of callers other than the offerer who can cancel the swap and lookup the swap details (if the swap is private).
   */
  'additional_admins' : Array<Principal>,
  /**
   * The amount of token1 to be deposited. When making the deposit it is necessary to add the fee to this amount to cover the transaction fee for the swap or refund.
   */
  'token1_amount' : bigint,
  /**
   * The swap will expire after this timestamp.
   */
  'expires_at' : TimestampMillis,
  /**
   * Specifies whether the swap is associated with an OpenChat message or is External.
   */
  'location' : P2PSwapLocation,
}
export type CreateSwapResponse = { 'Error' : OCError } |
  {
    'Success' : {
      'id' : number,
      'token1_deposit_address' : [] | [string],
      /**
       * These addresses use the standard text encoding for ICRC-1 accounts:
       * https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/TextualEncoding.md#textual-encoding-of-icrc-1-accounts
       */
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
  /**
   * The principal of the accepting party or the caller if not specified
   */
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
      /**
       * This address uses the standard text encoding for ICRC-1 accounts:
       * https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/TextualEncoding.md#textual-encoding-of-icrc-1-accounts
       */
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
      /**
       * This address uses the standard text encoding for ICRC-1 accounts:
       * https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/TextualEncoding.md#textual-encoding-of-icrc-1-accounts
       */
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
  /**
   * The principal of the party whose tokens have been deposited
   */
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
