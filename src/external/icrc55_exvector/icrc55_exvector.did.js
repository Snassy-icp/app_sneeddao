export const idlFactory = ({ IDL }) => {
  const ArchivedTransactionResponse = IDL.Rec();
  const Value = IDL.Rec();
  const Result_1 = IDL.Variant({ 'ok' : IDL.Nat64, 'err' : IDL.Text });
  const Result = IDL.Variant({
    'ok' : IDL.Vec(
      IDL.Record({
        'result' : Result_1,
        'ledger' : IDL.Principal,
        'amount' : IDL.Nat,
      })
    ),
    'err' : IDL.Text,
  });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Swap = IDL.Record({
    'to' : Account,
    'from' : Account,
    'amountIn' : IDL.Nat,
    'zeroForOne' : IDL.Bool,
    'amountOut' : IDL.Nat,
    'newPrice' : IDL.Float64,
  });
  const LiquidityAdd = IDL.Record({
    'to' : Account,
    'fromA' : Account,
    'fromB' : Account,
    'amountA' : IDL.Nat,
    'amountB' : IDL.Nat,
  });
  const LiquidityRemove = IDL.Record({
    'toA' : Account,
    'toB' : Account,
    'from' : Account,
    'amountA' : IDL.Nat,
    'amountB' : IDL.Nat,
  });
  const C200_Dex = IDL.Variant({
    'swap' : Swap,
    'liquidityAdd' : LiquidityAdd,
    'liquidityRemove' : LiquidityRemove,
  });
  const Sent = IDL.Record({
    'to' : IDL.Variant({ 'icp' : IDL.Vec(IDL.Nat8), 'icrc' : Account }),
    'ledger' : IDL.Principal,
    'amount' : IDL.Nat,
  });
  const Received = IDL.Record({
    'from' : IDL.Variant({ 'icp' : IDL.Vec(IDL.Nat8), 'icrc' : Account }),
    'ledger' : IDL.Principal,
    'amount' : IDL.Nat,
  });
  const C100_Account = IDL.Variant({ 'sent' : Sent, 'received' : Received });
  const ChronoRecord = IDL.Variant({
    'dex' : C200_Dex,
    'account' : C100_Account,
  });
  const SupportedLedger = IDL.Variant({
    'ic' : IDL.Principal,
    'other' : IDL.Record({
      'platform' : IDL.Nat64,
      'ledger' : IDL.Vec(IDL.Nat8),
    }),
  });
  const OHLCVRequest = IDL.Record({
    'l1' : SupportedLedger,
    'l2' : SupportedLedger,
    'period' : IDL.Variant({
      't1d' : IDL.Null,
      't1h' : IDL.Null,
      't1m' : IDL.Null,
      't1s' : IDL.Null,
    }),
  });
  const MarketTickInner = IDL.Tuple(
    IDL.Nat32,
    IDL.Float64,
    IDL.Float64,
    IDL.Float64,
    IDL.Float64,
    IDL.Nat,
  );
  const OHLCVResponse = IDL.Variant({
    'ok' : IDL.Record({
      'l1' : SupportedLedger,
      'l2' : SupportedLedger,
      'data' : IDL.Vec(MarketTickInner),
    }),
    'err' : IDL.Text,
  });
  const PoolRequest = IDL.Record({
    'base' : IDL.Principal,
    'quote' : IDL.Principal,
  });
  const PoolResponse = IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text });
  const DeletePoolRequest = IDL.Record({
    'base' : IDL.Principal,
    'quote' : IDL.Principal,
  });
  const DeletePoolResponse = IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text });
  const QuoteRequest = IDL.Record({
    'ledger_to' : SupportedLedger,
    'ledger_from' : SupportedLedger,
    'amount' : IDL.Nat,
  });
  const QuoteResponse = IDL.Variant({
    'ok' : IDL.Record({
      'fees' : IDL.Vec(IDL.Tuple(IDL.Text, SupportedLedger, IDL.Nat)),
      'path' : IDL.Vec(IDL.Tuple(SupportedLedger, IDL.Float64)),
      'amount_out' : IDL.Nat,
      'before_price' : IDL.Float64,
      'amount_in_max' : IDL.Nat,
      'after_price' : IDL.Float64,
    }),
    'err' : IDL.Text,
  });
  const SwapRequest = IDL.Record({
    'min_amount_out' : IDL.Nat,
    'ledger_to' : SupportedLedger,
    'ledger_from' : SupportedLedger,
    'account' : Account,
    'amount' : IDL.Nat,
  });
  const SwapResponse = IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text });
  const Info = IDL.Record({
    'pending' : IDL.Nat,
    'last_indexed_tx' : IDL.Nat,
    'errors' : IDL.Nat,
    'lastTxTime' : IDL.Nat64,
    'accounts' : IDL.Nat,
    'actor_principal' : IDL.Opt(IDL.Principal),
    'reader_instructions_cost' : IDL.Nat64,
    'sender_instructions_cost' : IDL.Nat64,
  });
  const Info__1 = IDL.Record({
    'pending' : IDL.Nat,
    'last_indexed_tx' : IDL.Nat,
    'errors' : IDL.Nat,
    'lastTxTime' : IDL.Nat64,
    'accounts' : IDL.Nat,
    'actor_principal' : IDL.Principal,
    'reader_instructions_cost' : IDL.Nat64,
    'sender_instructions_cost' : IDL.Nat64,
  });
  const LedgerInfo__1 = IDL.Record({
    'id' : IDL.Principal,
    'info' : IDL.Variant({ 'icp' : Info, 'icrc' : Info__1 }),
  });
  const GetArchivesArgs = IDL.Record({ 'from' : IDL.Opt(IDL.Principal) });
  const GetArchivesResultItem = IDL.Record({
    'end' : IDL.Nat,
    'canister_id' : IDL.Principal,
    'start' : IDL.Nat,
  });
  const GetArchivesResult = IDL.Vec(GetArchivesResultItem);
  const TransactionRange = IDL.Record({
    'start' : IDL.Nat,
    'length' : IDL.Nat,
  });
  const GetBlocksArgs = IDL.Vec(TransactionRange);
  const ValueMap = IDL.Tuple(IDL.Text, Value);
  Value.fill(
    IDL.Variant({
      'Int' : IDL.Int,
      'Map' : IDL.Vec(ValueMap),
      'Nat' : IDL.Nat,
      'Blob' : IDL.Vec(IDL.Nat8),
      'Text' : IDL.Text,
      'Array' : IDL.Vec(Value),
    })
  );
  const GetTransactionsResult = IDL.Record({
    'log_length' : IDL.Nat,
    'blocks' : IDL.Vec(
      IDL.Record({ 'id' : IDL.Nat, 'block' : IDL.Opt(Value) })
    ),
    'archived_blocks' : IDL.Vec(ArchivedTransactionResponse),
  });
  const GetTransactionsFn = IDL.Func(
      [IDL.Vec(TransactionRange)],
      [GetTransactionsResult],
      ['query'],
    );
  ArchivedTransactionResponse.fill(
    IDL.Record({
      'args' : IDL.Vec(TransactionRange),
      'callback' : GetTransactionsFn,
    })
  );
  const GetBlocksResult = IDL.Record({
    'log_length' : IDL.Nat,
    'blocks' : IDL.Vec(
      IDL.Record({ 'id' : IDL.Nat, 'block' : IDL.Opt(Value) })
    ),
    'archived_blocks' : IDL.Vec(ArchivedTransactionResponse),
  });
  const DataCertificate = IDL.Record({
    'certificate' : IDL.Vec(IDL.Nat8),
    'hash_tree' : IDL.Vec(IDL.Nat8),
  });
  const BlockType = IDL.Record({ 'url' : IDL.Text, 'block_type' : IDL.Text });
  const PlatformPath = IDL.Vec(IDL.Nat8);
  const PlatformId = IDL.Nat64;
  const TokenId = IDL.Record({
    'path' : PlatformPath,
    'platform' : PlatformId,
  });
  const PairId = IDL.Record({ 'base' : TokenId, 'quote' : TokenId });
  const Level = IDL.Nat8;
  const DepthRequest = IDL.Record({ 'level' : Level, 'limit' : IDL.Nat32 });
  const PairRequest = IDL.Record({
    'pairs' : IDL.Vec(PairId),
    'depth' : IDL.Opt(DepthRequest),
  });
  const Amount = IDL.Nat;
  const Rate = IDL.Float64;
  const TokenData = IDL.Record({
    'volume24' : Amount,
    'volume_total' : Amount,
  });
  const PairData = IDL.Record({
    'id' : PairId,
    'volume_total_USD' : IDL.Opt(Amount),
    'asks' : IDL.Vec(IDL.Tuple(Rate, Amount)),
    'base' : TokenData,
    'bids' : IDL.Vec(IDL.Tuple(Rate, Amount)),
    'last' : Rate,
    'quote' : TokenData,
    'last_timestamp' : IDL.Nat64,
    'volume24_USD' : IDL.Opt(Amount),
    'updated_timestamp' : IDL.Nat64,
  });
  const PairResponseOk = IDL.Vec(PairData);
  const PairResponseErr = IDL.Variant({
    'NotFound' : PairId,
    'InvalidDepthLevel' : Level,
    'InvalidDepthLimit' : IDL.Nat32,
  });
  const PairResponse = IDL.Variant({
    'Ok' : PairResponseOk,
    'Err' : PairResponseErr,
  });
  const DataSource = IDL.Principal;
  const PairInfo = IDL.Record({ 'id' : PairId, 'data' : DataSource });
  const ListPairsResponse = IDL.Vec(PairInfo);
  const AccountsRequest = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const EndpointIC = IDL.Record({
    'ledger' : IDL.Principal,
    'account' : Account,
  });
  const EndpointOther = IDL.Record({
    'platform' : IDL.Nat64,
    'ledger' : IDL.Vec(IDL.Nat8),
    'account' : IDL.Vec(IDL.Nat8),
  });
  const Endpoint = IDL.Variant({ 'ic' : EndpointIC, 'other' : EndpointOther });
  const AccountEndpoint = IDL.Record({
    'balance' : IDL.Nat,
    'endpoint' : Endpoint,
  });
  const AccountsResponse = IDL.Vec(AccountEndpoint);
  const Controller = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const LocalNodeId = IDL.Nat32;
  const EndpointIdx = IDL.Nat8;
  const InputAddress = IDL.Variant({
    'ic' : Account,
    'other' : IDL.Vec(IDL.Nat8),
    'temp' : IDL.Record({ 'id' : IDL.Nat32, 'source_idx' : EndpointIdx }),
  });
  const CommonModifyRequest = IDL.Record({
    'active' : IDL.Opt(IDL.Bool),
    'controllers' : IDL.Opt(IDL.Vec(Controller)),
    'extractors' : IDL.Opt(IDL.Vec(LocalNodeId)),
    'destinations' : IDL.Opt(IDL.Vec(IDL.Opt(InputAddress))),
    'sources' : IDL.Opt(IDL.Vec(IDL.Opt(InputAddress))),
    'refund' : IDL.Opt(Account),
  });
  const ModifyRequest__3 = IDL.Record({ 'split' : IDL.Vec(IDL.Nat) });
  const NumVariant = IDL.Variant({
    'rnd' : IDL.Record({ 'max' : IDL.Nat64, 'min' : IDL.Nat64 }),
    'fixed' : IDL.Nat64,
  });
  const ModifyRequest__4 = IDL.Record({
    'interval_sec' : NumVariant,
    'max_amount' : NumVariant,
  });
  const ModifyRequest__1 = IDL.Record({
    'max_impact' : IDL.Float64,
    'max_rate' : IDL.Opt(IDL.Float64),
    'buy_for_amount' : IDL.Nat,
    'buy_interval_seconds' : IDL.Nat64,
  });
  const Flow = IDL.Variant({ 'add' : IDL.Null, 'remove' : IDL.Null });
  const Range = IDL.Variant({
    'partial' : IDL.Record({
      'to_price' : IDL.Float64,
      'from_price' : IDL.Float64,
    }),
  });
  const ModifyRequest__2 = IDL.Record({ 'flow' : Flow, 'range' : Range });
  const ModifyRequest = IDL.Variant({
    'split' : ModifyRequest__3,
    'throttle' : ModifyRequest__4,
    'exchange' : ModifyRequest__1,
    'exchange_liquidity' : ModifyRequest__2,
  });
  const ModifyNodeRequest = IDL.Tuple(
    LocalNodeId,
    IDL.Opt(CommonModifyRequest),
    IDL.Opt(ModifyRequest),
  );
  const CommonCreateRequest = IDL.Record({
    'controllers' : IDL.Vec(Controller),
    'initial_billing_amount' : IDL.Opt(IDL.Nat),
    'extractors' : IDL.Vec(LocalNodeId),
    'temp_id' : IDL.Nat32,
    'billing_option' : IDL.Nat,
    'destinations' : IDL.Vec(IDL.Opt(InputAddress)),
    'sources' : IDL.Vec(IDL.Opt(InputAddress)),
    'affiliate' : IDL.Opt(Account),
    'ledgers' : IDL.Vec(SupportedLedger),
    'temporary' : IDL.Bool,
    'refund' : Account,
  });
  const CreateRequest__3 = IDL.Record({
    'init' : IDL.Record({}),
    'variables' : IDL.Record({ 'split' : IDL.Vec(IDL.Nat) }),
  });
  const CreateRequest__4 = IDL.Record({
    'init' : IDL.Record({}),
    'variables' : IDL.Record({
      'interval_sec' : NumVariant,
      'max_amount' : NumVariant,
    }),
  });
  const CreateRequest__1 = IDL.Record({
    'init' : IDL.Record({}),
    'variables' : IDL.Record({
      'max_impact' : IDL.Float64,
      'max_rate' : IDL.Opt(IDL.Float64),
      'buy_for_amount' : IDL.Nat,
      'buy_interval_seconds' : IDL.Nat64,
    }),
  });
  const CreateRequest__2 = IDL.Record({
    'init' : IDL.Record({}),
    'variables' : IDL.Record({ 'flow' : Flow, 'range' : Range }),
  });
  const CreateRequest = IDL.Variant({
    'split' : CreateRequest__3,
    'throttle' : CreateRequest__4,
    'exchange' : CreateRequest__1,
    'exchange_liquidity' : CreateRequest__2,
  });
  const CreateNodeRequest = IDL.Tuple(CommonCreateRequest, CreateRequest);
  const TransferRequest = IDL.Record({
    'to' : IDL.Variant({
      'node_billing' : LocalNodeId,
      'node' : IDL.Record({
        'node_id' : LocalNodeId,
        'endpoint_idx' : EndpointIdx,
      }),
      'temp' : IDL.Record({ 'id' : IDL.Nat32, 'source_idx' : EndpointIdx }),
      'external_account' : IDL.Variant({
        'ic' : Account,
        'other' : IDL.Vec(IDL.Nat8),
      }),
      'account' : Account,
    }),
    'from' : IDL.Variant({
      'node' : IDL.Record({
        'node_id' : LocalNodeId,
        'endpoint_idx' : EndpointIdx,
      }),
      'account' : Account,
    }),
    'ledger' : SupportedLedger,
    'amount' : IDL.Nat,
  });
  const Command = IDL.Variant({
    'modify_node' : ModifyNodeRequest,
    'create_node' : CreateNodeRequest,
    'transfer' : TransferRequest,
    'delete_node' : LocalNodeId,
  });
  const BatchCommandRequest = IDL.Record({
    'request_id' : IDL.Opt(IDL.Nat32),
    'controller' : Controller,
    'signature' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'expire_at' : IDL.Opt(IDL.Nat64),
    'commands' : IDL.Vec(Command),
  });
  const Shared__3 = IDL.Record({
    'internals' : IDL.Record({}),
    'init' : IDL.Record({}),
    'variables' : IDL.Record({ 'split' : IDL.Vec(IDL.Nat) }),
  });
  const Shared__4 = IDL.Record({
    'internals' : IDL.Record({ 'wait_until_ts' : IDL.Nat64 }),
    'init' : IDL.Record({}),
    'variables' : IDL.Record({
      'interval_sec' : NumVariant,
      'max_amount' : NumVariant,
    }),
  });
  const Shared__1 = IDL.Record({
    'internals' : IDL.Record({
      'next_buy' : IDL.Nat64,
      'last_error' : IDL.Opt(IDL.Text),
      'swap_fee_e4s' : IDL.Nat,
      'current_rate' : IDL.Opt(IDL.Float64),
      'price' : IDL.Opt(IDL.Float64),
      'last_buy' : IDL.Nat64,
      'last_run' : IDL.Nat64,
    }),
    'init' : IDL.Record({}),
    'variables' : IDL.Record({
      'max_impact' : IDL.Float64,
      'max_rate' : IDL.Opt(IDL.Float64),
      'buy_for_amount' : IDL.Nat,
      'buy_interval_seconds' : IDL.Nat64,
    }),
  });
  const Shared__2 = IDL.Record({
    'internals' : IDL.Record({
      'last_error' : IDL.Opt(IDL.Text),
      'tokenA' : IDL.Nat,
      'tokenB' : IDL.Nat,
      'last_run' : IDL.Nat64,
      'addedTokenA' : IDL.Nat,
      'addedTokenB' : IDL.Nat,
    }),
    'init' : IDL.Record({}),
    'variables' : IDL.Record({ 'flow' : Flow, 'range' : Range }),
  });
  const Shared = IDL.Variant({
    'split' : Shared__3,
    'throttle' : Shared__4,
    'exchange' : Shared__1,
    'exchange_liquidity' : Shared__2,
  });
  const BillingTransactionFee = IDL.Variant({
    'none' : IDL.Null,
    'transaction_percentage_fee_e8s' : IDL.Nat,
    'flat_fee_multiplier' : IDL.Nat,
  });
  const EndpointOptIC = IDL.Record({
    'ledger' : IDL.Principal,
    'account' : IDL.Opt(Account),
  });
  const EndpointOptOther = IDL.Record({
    'platform' : IDL.Nat64,
    'ledger' : IDL.Vec(IDL.Nat8),
    'account' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const EndpointOpt = IDL.Variant({
    'ic' : EndpointOptIC,
    'other' : EndpointOptOther,
  });
  const DestinationEndpointResp = IDL.Record({
    'endpoint' : EndpointOpt,
    'name' : IDL.Text,
  });
  const SourceEndpointResp = IDL.Record({
    'balance' : IDL.Nat,
    'endpoint' : Endpoint,
    'name' : IDL.Text,
  });
  const GetNodeResponse = IDL.Record({
    'id' : LocalNodeId,
    'created' : IDL.Nat64,
    'active' : IDL.Bool,
    'modified' : IDL.Nat64,
    'controllers' : IDL.Vec(Controller),
    'custom' : IDL.Opt(Shared),
    'extractors' : IDL.Vec(LocalNodeId),
    'billing' : IDL.Record({
      'transaction_fee' : BillingTransactionFee,
      'expires' : IDL.Opt(IDL.Nat64),
      'current_balance' : IDL.Nat,
      'billing_option' : IDL.Nat,
      'account' : Account,
      'frozen' : IDL.Bool,
      'cost_per_day' : IDL.Nat,
    }),
    'destinations' : IDL.Vec(DestinationEndpointResp),
    'sources' : IDL.Vec(SourceEndpointResp),
    'refund' : Account,
  });
  const ModifyNodeResponse = IDL.Variant({
    'ok' : GetNodeResponse,
    'err' : IDL.Text,
  });
  const CreateNodeResponse = IDL.Variant({
    'ok' : GetNodeResponse,
    'err' : IDL.Text,
  });
  const TransferResponse = IDL.Variant({ 'ok' : IDL.Nat64, 'err' : IDL.Text });
  const DeleteNodeResp = IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text });
  const CommandResponse = IDL.Variant({
    'modify_node' : ModifyNodeResponse,
    'create_node' : CreateNodeResponse,
    'transfer' : TransferResponse,
    'delete_node' : DeleteNodeResp,
  });
  const BatchCommandResponse = IDL.Variant({
    'ok' : IDL.Record({
      'id' : IDL.Opt(IDL.Nat),
      'commands' : IDL.Vec(CommandResponse),
    }),
    'err' : IDL.Variant({
      'caller_not_controller' : IDL.Null,
      'expired' : IDL.Null,
      'other' : IDL.Text,
      'duplicate' : IDL.Nat,
      'invalid_signature' : IDL.Null,
    }),
  });
  const ValidationResult = IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text });
  const GetControllerNodesRequest = IDL.Record({
    'id' : Controller,
    'start' : LocalNodeId,
    'length' : IDL.Nat32,
  });
  const NodeShared = IDL.Record({
    'id' : LocalNodeId,
    'created' : IDL.Nat64,
    'active' : IDL.Bool,
    'modified' : IDL.Nat64,
    'controllers' : IDL.Vec(Controller),
    'custom' : IDL.Opt(Shared),
    'extractors' : IDL.Vec(LocalNodeId),
    'billing' : IDL.Record({
      'transaction_fee' : BillingTransactionFee,
      'expires' : IDL.Opt(IDL.Nat64),
      'current_balance' : IDL.Nat,
      'billing_option' : IDL.Nat,
      'account' : Account,
      'frozen' : IDL.Bool,
      'cost_per_day' : IDL.Nat,
    }),
    'destinations' : IDL.Vec(DestinationEndpointResp),
    'sources' : IDL.Vec(SourceEndpointResp),
    'refund' : Account,
  });
  const GetNode = IDL.Variant({ 'id' : LocalNodeId, 'endpoint' : Endpoint });
  const BillingFeeSplit = IDL.Record({
    'platform' : IDL.Nat,
    'author' : IDL.Nat,
    'affiliate' : IDL.Nat,
    'pylon' : IDL.Nat,
  });
  const BillingPylon = IDL.Record({
    'operation_cost' : IDL.Nat,
    'freezing_threshold_days' : IDL.Nat,
    'min_create_balance' : IDL.Nat,
    'split' : BillingFeeSplit,
    'ledger' : IDL.Principal,
    'platform_account' : Account,
    'pylon_account' : Account,
  });
  const LedgerInfo = IDL.Record({
    'fee' : IDL.Nat,
    'decimals' : IDL.Nat8,
    'name' : IDL.Text,
    'ledger' : SupportedLedger,
    'symbol' : IDL.Text,
  });
  const Billing = IDL.Record({
    'transaction_fee' : BillingTransactionFee,
    'cost_per_day' : IDL.Nat,
  });
  const Version = IDL.Variant({
    'alpha' : IDL.Vec(IDL.Nat16),
    'beta' : IDL.Vec(IDL.Nat16),
    'release' : IDL.Vec(IDL.Nat16),
  });
  const LedgerIdx = IDL.Nat;
  const LedgerLabel = IDL.Text;
  const EndpointsDescription = IDL.Vec(IDL.Tuple(LedgerIdx, LedgerLabel));
  const ModuleMeta = IDL.Record({
    'id' : IDL.Text,
    'create_allowed' : IDL.Bool,
    'ledger_slots' : IDL.Vec(IDL.Text),
    'name' : IDL.Text,
    'billing' : IDL.Vec(Billing),
    'description' : IDL.Text,
    'supported_ledgers' : IDL.Vec(SupportedLedger),
    'author' : IDL.Text,
    'version' : Version,
    'destinations' : EndpointsDescription,
    'sources' : EndpointsDescription,
    'temporary_allowed' : IDL.Bool,
    'author_account' : Account,
  });
  const PylonMetaResp = IDL.Record({
    'name' : IDL.Text,
    'billing' : BillingPylon,
    'supported_ledgers' : IDL.Vec(LedgerInfo),
    'request_max_expire_sec' : IDL.Nat64,
    'governed_by' : IDL.Text,
    'temporary_nodes' : IDL.Record({
      'allowed' : IDL.Bool,
      'expire_sec' : IDL.Nat64,
    }),
    'modules' : IDL.Vec(ModuleMeta),
  });
  return IDL.Service({
    'add_supported_ledger' : IDL.Func(
        [IDL.Principal, IDL.Variant({ 'icp' : IDL.Null, 'icrc' : IDL.Null })],
        [],
        ['oneway'],
      ),
    'admin_withdraw_all' : IDL.Func([], [Result], []),
    'chrono_records' : IDL.Func([], [IDL.Opt(ChronoRecord)], ['query']),
    'dex_ohlcv' : IDL.Func([OHLCVRequest], [OHLCVResponse], ['query']),
    'dex_pool_create' : IDL.Func([PoolRequest], [PoolResponse], []),
    'dex_pool_delete' : IDL.Func([DeletePoolRequest], [DeletePoolResponse], []),
    'dex_quote' : IDL.Func([QuoteRequest], [QuoteResponse], ['query']),
    'dex_swap' : IDL.Func([SwapRequest], [SwapResponse], []),
    'get_ledger_errors' : IDL.Func([], [IDL.Vec(IDL.Vec(IDL.Text))], ['query']),
    'get_ledgers_info' : IDL.Func([], [IDL.Vec(LedgerInfo__1)], ['query']),
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
    'icrc3_supported_block_types' : IDL.Func(
        [],
        [IDL.Vec(BlockType)],
        ['query'],
      ),
    'icrc45_get_pairs' : IDL.Func([PairRequest], [PairResponse], ['query']),
    'icrc45_list_pairs' : IDL.Func([], [ListPairsResponse], ['query']),
    'icrc55_account_register' : IDL.Func([Account], [], []),
    'icrc55_accounts' : IDL.Func(
        [AccountsRequest],
        [AccountsResponse],
        ['query'],
      ),
    'icrc55_command' : IDL.Func(
        [BatchCommandRequest],
        [BatchCommandResponse],
        [],
      ),
    'icrc55_command_validate' : IDL.Func(
        [BatchCommandRequest],
        [ValidationResult],
        ['query'],
      ),
    'icrc55_get_controller_nodes' : IDL.Func(
        [GetControllerNodesRequest],
        [IDL.Vec(NodeShared)],
        ['query'],
      ),
    'icrc55_get_defaults' : IDL.Func([IDL.Text], [CreateRequest], ['query']),
    'icrc55_get_nodes' : IDL.Func(
        [IDL.Vec(GetNode)],
        [IDL.Vec(IDL.Opt(NodeShared))],
        ['query'],
      ),
    'icrc55_get_pylon_meta' : IDL.Func([], [PylonMetaResp], ['query']),
  });
};
export const init = ({ IDL }) => { return []; };