export const idlFactory = ({ IDL }) => {
  const CancelSwapArgs = IDL.Record({ 'swap_id' : IDL.Nat32 });
  const OCError = IDL.Tuple(IDL.Nat16, IDL.Opt(IDL.Text));
  const CancelSwapResponse = IDL.Variant({
    'Error' : OCError,
    'SwapExpired' : IDL.Null,
    'SwapAlreadyAccepted' : IDL.Null,
    'NotAuthorized' : IDL.Null,
    'Success' : IDL.Null,
    'SwapNotFound' : IDL.Null,
  });
  const CanisterId = IDL.Principal;
  const TokenInfo = IDL.Record({
    'fee' : IDL.Nat,
    'decimals' : IDL.Nat8,
    'ledger' : CanisterId,
    'symbol' : IDL.Text,
  });
  const TimestampMillis = IDL.Nat64;
  const ChatId = CanisterId;
  const CommunityId = CanisterId;
  const ChannelId = IDL.Nat32;
  const Chat = IDL.Variant({
    'Group' : ChatId,
    'Channel' : IDL.Tuple(CommunityId, ChannelId),
    'Direct' : ChatId,
  });
  const MessageId = IDL.Nat64;
  const MessageIndex = IDL.Nat32;
  const Message = IDL.Record({
    'chat' : Chat,
    'message_id' : MessageId,
    'thread_root_message_index' : IDL.Opt(MessageIndex),
  });
  const P2PSwapLocation = IDL.Variant({
    'Message' : Message,
    'External' : IDL.Null,
  });
  const CreateSwapArgs = IDL.Record({
    'is_public' : IDL.Bool,
    'token1_principal' : IDL.Opt(IDL.Principal),
    'canister_to_notify' : IDL.Opt(CanisterId),
    'token0_amount' : IDL.Nat,
    'token0' : TokenInfo,
    'token1' : TokenInfo,
    'token0_principal' : IDL.Opt(IDL.Principal),
    'additional_admins' : IDL.Vec(IDL.Principal),
    'token1_amount' : IDL.Nat,
    'expires_at' : TimestampMillis,
    'location' : P2PSwapLocation,
  });
  const CreateSwapResponse = IDL.Variant({
    'Error' : OCError,
    'Success' : IDL.Record({
      'id' : IDL.Nat32,
      'token1_deposit_address' : IDL.Opt(IDL.Text),
      'token0_deposit_address' : IDL.Text,
    }),
    'InvalidSwap' : IDL.Text,
  });
  const LookupSwapArgs = IDL.Record({
    'swap_id' : IDL.Nat32,
    'accepting_principal' : IDL.Opt(IDL.Principal),
  });
  const SwapStatusAccepted = IDL.Record({
    'accepted_at' : TimestampMillis,
    'accepted_by' : IDL.Principal,
  });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const CryptoAccount = IDL.Variant({ 'Mint' : IDL.Null, 'Account' : Account });
  const TimestampNanos = IDL.Nat64;
  const Memo = IDL.Vec(IDL.Nat8);
  const CompletedCryptoTransaction = IDL.Record({
    'to' : CryptoAccount,
    'fee' : IDL.Nat,
    'created' : TimestampNanos,
    'block_index' : IDL.Nat64,
    'token_symbol' : IDL.Text,
    'from' : CryptoAccount,
    'memo' : IDL.Opt(Memo),
    'ledger' : CanisterId,
    'amount' : IDL.Nat,
  });
  const SwapStatusCancelled = IDL.Record({
    'cancelled_at' : TimestampMillis,
    'refunds' : IDL.Vec(CompletedCryptoTransaction),
  });
  const SwapStatusCompleted = IDL.Record({
    'token0_transfer_out' : CompletedCryptoTransaction,
    'accepted_at' : TimestampMillis,
    'accepted_by' : IDL.Principal,
    'refunds' : IDL.Vec(CompletedCryptoTransaction),
    'token1_transfer_out' : CompletedCryptoTransaction,
  });
  const SwapStatusExpired = IDL.Record({
    'refunds' : IDL.Vec(CompletedCryptoTransaction),
  });
  const SwapStatus = IDL.Variant({
    'Open' : IDL.Null,
    'Accepted' : SwapStatusAccepted,
    'Cancelled' : SwapStatusCancelled,
    'Completed' : SwapStatusCompleted,
    'Expired' : SwapStatusExpired,
  });
  const LookupSwapResponse = IDL.Variant({
    'Error' : OCError,
    'SwapIsPrivate' : IDL.Null,
    'Success' : IDL.Record({
      'id' : IDL.Nat32,
      'status' : SwapStatus,
      'is_public' : IDL.Bool,
      'canister_to_notify' : IDL.Opt(CanisterId),
      'restricted_to' : IDL.Opt(IDL.Principal),
      'token1_deposit_address' : IDL.Text,
      'created_at' : TimestampMillis,
      'created_by' : IDL.Principal,
      'amount0' : IDL.Nat,
      'amount1' : IDL.Nat,
      'token0' : TokenInfo,
      'token1' : TokenInfo,
      'offered_by' : IDL.Principal,
      'additional_admins' : IDL.Vec(IDL.Principal),
      'expires_at' : TimestampMillis,
      'token0_deposit_address' : IDL.Text,
      'location' : P2PSwapLocation,
    }),
    'SwapNotFound' : IDL.Null,
    'PrincipalNotFound' : IDL.Null,
  });
  const NotifyDepositArgs = IDL.Record({
    'swap_id' : IDL.Nat32,
    'deposited_by' : IDL.Opt(IDL.Principal),
  });
  const NotifyDepositResponse = IDL.Variant({
    'Error' : OCError,
    'SwapExpired' : IDL.Null,
    'BalanceTooLow' : IDL.Record({
      'balance' : IDL.Nat,
      'balance_required' : IDL.Nat,
    }),
    'SwapAlreadyAccepted' : IDL.Null,
    'NotAuthorized' : IDL.Null,
    'Success' : IDL.Record({ 'complete' : IDL.Bool }),
    'SwapNotFound' : IDL.Null,
    'InternalError' : IDL.Text,
    'SwapCancelled' : IDL.Null,
  });
  return IDL.Service({
    'cancel_swap' : IDL.Func([CancelSwapArgs], [CancelSwapResponse], []),
    'create_swap' : IDL.Func([CreateSwapArgs], [CreateSwapResponse], []),
    'lookup_swap' : IDL.Func([LookupSwapArgs], [LookupSwapResponse], ['query']),
    'notify_deposit' : IDL.Func(
        [NotifyDepositArgs],
        [NotifyDepositResponse],
        [],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
