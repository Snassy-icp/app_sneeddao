export const idlFactory = ({ IDL }) => {
    const PositionId = IDL.Nat;
    const Expiry = IDL.Nat64;
    const LockId = IDL.Nat;
    const Balance = IDL.Nat;
    const TxIndex = IDL.Nat;
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
    const CreateLockError = IDL.Record({
      'transfer_error' : IDL.Opt(TransferError),
      'message' : IDL.Text,
    });
    const CreateLockResult__1 = IDL.Variant({
      'Ok' : LockId,
      'Err' : CreateLockError,
    });
    const Dex = IDL.Nat;
    const TokenType = IDL.Principal;
    const CreateLockResult = IDL.Variant({
      'Ok' : LockId,
      'Err' : CreateLockError,
    });
    const SwapCanisterId = IDL.Principal;
    const Expiry__1 = IDL.Nat64;
    const PositionLock = IDL.Record({
      'dex' : Dex,
      'lock_id' : LockId,
      'token0' : TokenType,
      'token1' : TokenType,
      'expiry' : Expiry__1,
      'position_id' : PositionId,
    });
    const FullyQualifiedPositionLock = IDL.Tuple(
      IDL.Principal,
      SwapCanisterId,
      PositionLock,
    );
    const Lock = IDL.Record({
      'lock_id' : LockId,
      'expiry' : Expiry__1,
      'amount' : Balance,
    });
    const FullyQualifiedLock = IDL.Tuple(IDL.Principal, TokenType, Lock);
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
    const TokenType__1 = IDL.Principal;
    const Balance__1 = IDL.Nat;
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
    const Subaccount = IDL.Vec(IDL.Nat8);
    const TransferResult = IDL.Variant({ 'Ok' : TxIndex, 'Err' : TransferError });
    const SneedLock = IDL.Service({
      'claim_position' : IDL.Func([IDL.Principal, PositionId], [IDL.Bool], []),
      'clear_expired_locks' : IDL.Func([], [], []),
      'clear_expired_position_locks' : IDL.Func([], [], []),
      'create_lock' : IDL.Func(
          [IDL.Nat, IDL.Principal, Expiry],
          [CreateLockResult__1],
          [],
        ),
      'create_position_lock' : IDL.Func(
          [IDL.Principal, Dex, PositionId, Expiry, TokenType, TokenType],
          [CreateLockResult],
          [],
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
      'get_claimed_positions_for_principal' : IDL.Func(
          [IDL.Principal],
          [IDL.Vec(ClaimedPosition)],
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
      'get_position_ownerships' : IDL.Func(
          [],
          [IDL.Vec(IDL.Tuple(SwapCanisterId, PositionId))],
          ['query'],
        ),
      'get_summed_locks' : IDL.Func(
          [],
          [IDL.Vec(IDL.Tuple(TokenType__1, Balance__1))],
          ['query'],
        ),
      'get_swap_position_locks' : IDL.Func(
          [SwapCanisterId],
          [IDL.Vec(FullyQualifiedPositionLock)],
          ['query'],
        ),
      'get_token_lock_fee_sneed_e8s' : IDL.Func([], [IDL.Nat], ['query']),
      'get_token_locks' : IDL.Func(
          [],
          [IDL.Vec(IDL.Tuple(LockId, TokenType__1, Balance__1, Expiry))],
          ['query'],
        ),
      'get_token_position_locks' : IDL.Func(
          [TokenType],
          [IDL.Vec(FullyQualifiedPositionLock)],
          ['query'],
        ),
      'has_expired_locks' : IDL.Func([], [IDL.Bool], ['query']),
      'has_expired_position_locks' : IDL.Func([], [IDL.Bool], ['query']),
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
  