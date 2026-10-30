export const idlFactory = ({ IDL }) => {
  const GetBlocksResult = IDL.Rec();
  const Value = IDL.Rec();
  const AddAppInput = IDL.Record({
    'premiumMintPriceE8s' : IDL.Nat64,
    'appId' : IDL.Text,
    'name' : IDL.Text,
    'mintUrl' : IDL.Opt(IDL.Text),
    'description' : IDL.Text,
    'viewUrl' : IDL.Opt(IDL.Text),
    'mintPriceE8s' : IDL.Nat64,
    'manageUrl' : IDL.Opt(IDL.Text),
    'iconUrl' : IDL.Opt(IDL.Text),
    'families' : IDL.Vec(IDL.Text),
  });
  const AppVersionInput = IDL.Record({
    'major' : IDL.Nat,
    'minor' : IDL.Nat,
    'wasmHash' : IDL.Text,
    'releaseNotes' : IDL.Text,
    'sourceUrl' : IDL.Opt(IDL.Text),
    'wasmUrl' : IDL.Opt(IDL.Text),
    'patch' : IDL.Nat,
    'releaseDate' : IDL.Int,
  });
  const OfficialVersion = IDL.Record({
    'major' : IDL.Nat,
    'minor' : IDL.Nat,
    'wasmHash' : IDL.Text,
    'sourceUrl' : IDL.Text,
    'wasmUrl' : IDL.Text,
    'patch' : IDL.Nat,
  });
  const NotifyError = IDL.Variant({
    'Refunded' : IDL.Record({
      'block_index' : IDL.Opt(IDL.Nat64),
      'reason' : IDL.Text,
    }),
    'InvalidTransaction' : IDL.Text,
    'Other' : IDL.Record({
      'error_message' : IDL.Text,
      'error_code' : IDL.Nat64,
    }),
    'Processing' : IDL.Null,
    'TransactionTooOld' : IDL.Nat64,
  });
  const NotifyTopUpResult = IDL.Variant({
    'Ok' : IDL.Nat,
    'Err' : NotifyError,
  });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const TransferError = IDL.Variant({
    'GenericError' : IDL.Record({
      'message' : IDL.Text,
      'error_code' : IDL.Nat,
    }),
    'TemporarilyUnavailable' : IDL.Null,
    'BadBurn' : IDL.Record({ 'min_burn_amount' : IDL.Nat }),
    'Duplicate' : IDL.Record({ 'duplicate_of' : IDL.Nat }),
    'BadFee' : IDL.Record({ 'expected_fee' : IDL.Nat }),
    'CreatedInFuture' : IDL.Record({ 'ledger_time' : IDL.Nat64 }),
    'TooOld' : IDL.Null,
    'InsufficientFunds' : IDL.Record({ 'balance' : IDL.Nat }),
  });
  const TransferResult = IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : TransferError });
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
  const AccountIdentifier = IDL.Vec(IDL.Nat8);
  const CreateManagerError = IDL.Variant({
    'InsufficientPayment' : IDL.Record({
      'provided' : IDL.Nat64,
      'required' : IDL.Nat64,
    }),
    'CyclesTopUpFailed' : IDL.Text,
    'InsufficientCycles' : IDL.Null,
    'NotAuthorized' : IDL.Null,
    'CanisterCreationFailed' : IDL.Text,
    'AlreadyExists' : IDL.Null,
    'TransferFailed' : IDL.Text,
  });
  const CreateManagerResult = IDL.Variant({
    'Ok' : IDL.Record({
      'accountId' : AccountIdentifier,
      'canisterId' : IDL.Principal,
    }),
    'Err' : CreateManagerError,
  });
  const CreatePublisherInput = IDL.Record({
    'websiteUrl' : IDL.Opt(IDL.Text),
    'defaultPaymentAccount' : Account,
    'name' : IDL.Text,
    'description' : IDL.Text,
    'links' : IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)),
    'logoUrl' : IDL.Opt(IDL.Text),
  });
  const AppRevenueStats = IDL.Record({
    'totalRevenueE8s' : IDL.Nat,
    'numericAppId' : IDL.Nat,
    'publisherId' : IDL.Nat,
    'mintCount' : IDL.Nat,
    'totalDaoCutE8s' : IDL.Nat,
    'totalWithdrawnE8s' : IDL.Nat,
  });
  const PublisherStats = IDL.Record({
    'totalRevenueE8s' : IDL.Nat,
    'totalMintCount' : IDL.Nat,
    'publisherId' : IDL.Nat,
    'totalDaoCutE8s' : IDL.Nat,
    'totalWithdrawnE8s' : IDL.Nat,
  });
  const UserCanisterEntry = IDL.Record({
    'appId' : IDL.Text,
    'canisterId' : IDL.Principal,
  });
  const AppInfo = IDL.Record({
    'daoCutBasisPoints' : IDL.Opt(IDL.Nat),
    'numericAppId' : IDL.Nat,
    'premiumMintPriceE8s' : IDL.Nat64,
    'appId' : IDL.Text,
    'name' : IDL.Text,
    'createdAt' : IDL.Int,
    'mintUrl' : IDL.Opt(IDL.Text),
    'publisherId' : IDL.Nat,
    'description' : IDL.Text,
    'paymentAccount' : IDL.Opt(Account),
    'enabled' : IDL.Bool,
    'viewUrl' : IDL.Opt(IDL.Text),
    'mintPriceE8s' : IDL.Nat64,
    'manageUrl' : IDL.Opt(IDL.Text),
    'iconUrl' : IDL.Opt(IDL.Text),
    'families' : IDL.Vec(IDL.Text),
  });
  const AppVersionInfo = IDL.Record({
    'major' : IDL.Nat,
    'minor' : IDL.Nat,
    'hasWasm' : IDL.Bool,
    'wasmHash' : IDL.Text,
    'wasmSize' : IDL.Nat,
    'releaseNotes' : IDL.Text,
    'sourceUrl' : IDL.Opt(IDL.Text),
    'wasmUrl' : IDL.Opt(IDL.Text),
    'patch' : IDL.Nat,
    'releaseDate' : IDL.Int,
  });
  const CreationLogQuery = IDL.Record({
    'callerFilter' : IDL.Opt(IDL.Principal),
    'limit' : IDL.Opt(IDL.Nat),
    'toTime' : IDL.Opt(IDL.Int),
    'canisterFilter' : IDL.Opt(IDL.Principal),
    'fromTime' : IDL.Opt(IDL.Int),
    'startIndex' : IDL.Opt(IDL.Nat),
  });
  const CreationLogEntry = IDL.Record({
    'createdAt' : IDL.Int,
    'caller' : IDL.Principal,
    'index' : IDL.Nat,
    'canisterId' : IDL.Principal,
  });
  const CreationLogResult = IDL.Record({
    'hasMore' : IDL.Bool,
    'totalCount' : IDL.Nat,
    'entries' : IDL.Vec(CreationLogEntry),
  });
  const Version = IDL.Record({
    'major' : IDL.Nat,
    'minor' : IDL.Nat,
    'patch' : IDL.Nat,
  });
  const DaoRevenueStats = IDL.Record({
    'totalRevenueE8s' : IDL.Nat,
    'totalDirectRevenueE8s' : IDL.Nat,
    'totalDaoCutReceivedE8s' : IDL.Nat,
  });
  const FactoryAggregates = IDL.Record({
    'totalIcpProfitE8s' : IDL.Nat,
    'totalIcpForCyclesE8s' : IDL.Nat,
    'totalCyclesSpentOnCreation' : IDL.Nat,
    'totalCyclesReceivedFromCmc' : IDL.Nat,
    'totalCanistersCreated' : IDL.Nat,
    'totalIcpPaidE8s' : IDL.Nat,
    'totalIcpTransferFeesE8s' : IDL.Nat,
  });
  const FinancialLogQuery = IDL.Record({
    'limit' : IDL.Opt(IDL.Nat),
    'toTime' : IDL.Opt(IDL.Int),
    'canisterFilter' : IDL.Opt(IDL.Principal),
    'fromTime' : IDL.Opt(IDL.Int),
    'startIndex' : IDL.Opt(IDL.Nat),
  });
  const FinancialLogEntry = IDL.Record({
    'cyclesSpentOnCreation' : IDL.Nat,
    'cyclesReceivedFromCmc' : IDL.Nat,
    'createdAt' : IDL.Int,
    'icpForCyclesE8s' : IDL.Nat64,
    'cyclesBalanceAfter' : IDL.Nat,
    'cyclesBalanceBefore' : IDL.Nat,
    'index' : IDL.Nat,
    'icpProfitE8s' : IDL.Nat64,
    'canisterId' : IDL.Principal,
    'icpPaidE8s' : IDL.Nat64,
    'icpTransferFeesE8s' : IDL.Nat64,
  });
  const FinancialLogResult = IDL.Record({
    'hasMore' : IDL.Bool,
    'totalCount' : IDL.Nat,
    'entries' : IDL.Vec(FinancialLogEntry),
  });
  const NeuronId = IDL.Record({ 'id' : IDL.Nat64 });
  const ManagerInfo = IDL.Record({
    'owner' : IDL.Principal,
    'createdAt' : IDL.Int,
    'version' : Version,
    'neuronId' : IDL.Opt(NeuronId),
    'canisterId' : IDL.Principal,
  });
  const MergedLogQuery = IDL.Record({
    'callerFilter' : IDL.Opt(IDL.Principal),
    'limit' : IDL.Opt(IDL.Nat),
    'toTime' : IDL.Opt(IDL.Int),
    'canisterFilter' : IDL.Opt(IDL.Principal),
    'fromTime' : IDL.Opt(IDL.Int),
    'startIndex' : IDL.Opt(IDL.Nat),
  });
  const MergedLogEntry = IDL.Record({
    'createdAt' : IDL.Int,
    'caller' : IDL.Principal,
    'index' : IDL.Nat,
    'financialData' : IDL.Opt(
      IDL.Record({
        'cyclesSpentOnCreation' : IDL.Nat,
        'cyclesReceivedFromCmc' : IDL.Nat,
        'icpForCyclesE8s' : IDL.Nat64,
        'cyclesBalanceAfter' : IDL.Nat,
        'cyclesBalanceBefore' : IDL.Nat,
        'icpProfitE8s' : IDL.Nat64,
        'icpPaidE8s' : IDL.Nat64,
        'icpTransferFeesE8s' : IDL.Nat64,
      })
    ),
    'canisterId' : IDL.Principal,
  });
  const MergedLogResult = IDL.Record({
    'hasMore' : IDL.Bool,
    'totalCount' : IDL.Nat,
    'entries' : IDL.Vec(MergedLogEntry),
  });
  const MintLogQuery = IDL.Record({
    'limit' : IDL.Opt(IDL.Nat),
    'toTime' : IDL.Opt(IDL.Int),
    'appIdFilter' : IDL.Opt(IDL.Text),
    'fromTime' : IDL.Opt(IDL.Int),
    'startIndex' : IDL.Opt(IDL.Nat),
    'minterFilter' : IDL.Opt(IDL.Principal),
  });
  const MintLogEntry = IDL.Record({
    'wasPremium' : IDL.Bool,
    'numericAppId' : IDL.Nat,
    'appId' : IDL.Text,
    'publisherRevenueE8s' : IDL.Nat64,
    'versionPatch' : IDL.Nat,
    'minter' : IDL.Principal,
    'publisherId' : IDL.Nat,
    'mintedAt' : IDL.Int,
    'daoCutE8s' : IDL.Nat64,
    'versionMajor' : IDL.Nat,
    'versionMinor' : IDL.Nat,
    'index' : IDL.Nat,
    'canisterId' : IDL.Principal,
    'icpPaidE8s' : IDL.Nat64,
  });
  const MintLogResult = IDL.Record({
    'hasMore' : IDL.Bool,
    'totalCount' : IDL.Nat,
    'entries' : IDL.Vec(MintLogEntry),
  });
  const OrphanCanister = IDL.Record({
    'appId' : IDL.Text,
    'minter' : IDL.Principal,
    'recordedAt' : IDL.Int,
    'canisterId' : IDL.Principal,
    'reason' : IDL.Text,
  });
  const PaymentConfig = IDL.Record({
    'paymentRequired' : IDL.Bool,
    'targetCyclesAmount' : IDL.Nat,
    'creationFeeE8s' : IDL.Nat64,
    'feeDestination' : Account,
  });
  const PublisherInfo = IDL.Record({
    'daoCutBasisPoints' : IDL.Nat,
    'verified' : IDL.Bool,
    'owners' : IDL.Vec(IDL.Principal),
    'websiteUrl' : IDL.Opt(IDL.Text),
    'defaultPaymentAccount' : Account,
    'name' : IDL.Text,
    'createdAt' : IDL.Int,
    'publisherId' : IDL.Nat,
    'description' : IDL.Text,
    'links' : IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)),
    'logoUrl' : IDL.Opt(IDL.Text),
    'families' : IDL.Vec(IDL.Text),
  });
  const OrphanInfo = IDL.Record({
    'handOverPending' : IDL.Bool,
    'appId' : IDL.Text,
    'minter' : IDL.Principal,
    'recordedAt' : IDL.Int,
    'canisterId' : IDL.Principal,
    'reason' : IDL.Text,
  });
  const PendingTopUp = IDL.Record({
    'id' : IDL.Nat,
    'icpE8s' : IDL.Nat64,
    'recordedAt' : IDL.Int,
    'block' : IDL.Opt(IDL.Nat),
    'payer' : IDL.Principal,
    'canisterId' : IDL.Principal,
    'reason' : IDL.Text,
  });
  const RefundLeg = IDL.Record({
    'fromSubaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'amountE8s' : IDL.Nat64,
  });
  const RefundCredit = IDL.Record({
    'id' : IDL.Nat,
    'appId' : IDL.Text,
    'legs' : IDL.Vec(RefundLeg),
    'recordedAt' : IDL.Int,
    'payer' : IDL.Principal,
    'canisterId' : IDL.Opt(IDL.Principal),
    'reason' : IDL.Text,
  });
  const SpecialMintPrices = IDL.Record({ 'mint_fee_e8s' : IDL.Opt(IDL.Nat) });
  const PartnerListing = IDL.Record({
    'principal' : IDL.Principal,
    'label' : IDL.Text,
    'prices' : SpecialMintPrices,
    'expires_at' : IDL.Opt(IDL.Int),
  });
  const PartnerMintPrices = IDL.Record({
    'label' : IDL.Text,
    'prices' : SpecialMintPrices,
    'expires_at' : IDL.Opt(IDL.Int),
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
  const MintError = IDL.Variant({
    'NoWasmForVersion' : IDL.Null,
    'InsufficientPayment' : IDL.Record({
      'provided' : IDL.Nat64,
      'required' : IDL.Nat64,
    }),
    'PublisherNotVerified' : IDL.Null,
    'AppDisabled' : IDL.Null,
    'InsufficientCycles' : IDL.Null,
    'CanisterCreationFailed' : IDL.Text,
    'AppNotFound' : IDL.Null,
    'VersionNotFound' : IDL.Null,
    'PublisherNotFound' : IDL.Null,
    'TransferFailed' : IDL.Text,
  });
  const MintResult = IDL.Variant({
    'Ok' : IDL.Record({
      'accountId' : AccountIdentifier,
      'canisterId' : IDL.Principal,
    }),
    'Err' : MintError,
  });
  const UpdateAppInput = IDL.Record({
    'premiumMintPriceE8s' : IDL.Nat64,
    'name' : IDL.Text,
    'mintUrl' : IDL.Opt(IDL.Text),
    'description' : IDL.Text,
    'viewUrl' : IDL.Opt(IDL.Text),
    'mintPriceE8s' : IDL.Nat64,
    'manageUrl' : IDL.Opt(IDL.Text),
    'iconUrl' : IDL.Opt(IDL.Text),
    'families' : IDL.Vec(IDL.Text),
  });
  const UpdatePublisherInput = IDL.Record({
    'websiteUrl' : IDL.Opt(IDL.Text),
    'defaultPaymentAccount' : Account,
    'name' : IDL.Text,
    'description' : IDL.Text,
    'links' : IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)),
    'logoUrl' : IDL.Opt(IDL.Text),
  });
  return IDL.Service({
    'addAdmin' : IDL.Func([IDL.Principal], [], []),
    'addApp' : IDL.Func(
        [IDL.Nat, AddAppInput],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'addAppVersion' : IDL.Func([IDL.Text, AppVersionInput], [], []),
    'addAuthorizedForCaller' : IDL.Func([IDL.Principal], [], []),
    'addOfficialVersion' : IDL.Func([OfficialVersion], [], []),
    'addPublisherFamily' : IDL.Func(
        [IDL.Nat, IDL.Text],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'addPublisherOwner' : IDL.Func(
        [IDL.Nat, IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'adminBulkRegisterCanisters' : IDL.Func(
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal, IDL.Text))],
        [IDL.Nat],
        [],
      ),
    'adminCloseRefundCredit' : IDL.Func(
        [IDL.Nat, IDL.Text],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'adminRegisterCanister' : IDL.Func(
        [IDL.Principal, IDL.Principal, IDL.Text],
        [],
        [],
      ),
    'adminReturnStuckIcp' : IDL.Func(
        [IDL.Principal, IDL.Nat64, IDL.Text],
        [
          IDL.Variant({
            'Ok' : IDL.Record({
              'blockIndex' : IDL.Nat,
              'creditsClosed' : IDL.Vec(IDL.Nat),
              'remainingE8s' : IDL.Nat64,
              'returnedE8s' : IDL.Nat64,
            }),
            'Err' : IDL.Text,
          }),
        ],
        [],
      ),
    'adminSettleOrphan' : IDL.Func(
        [
          IDL.Principal,
          IDL.Variant({ 'HandOver' : IDL.Null, 'Delete' : IDL.Null }),
          IDL.Text,
        ],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'adminTopUpCycles' : IDL.Func([IDL.Nat64], [NotifyTopUpResult], []),
    'adminWithdrawIcp' : IDL.Func([IDL.Nat64, Account], [TransferResult], []),
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
    'calculateIcpForCycles' : IDL.Func([IDL.Nat], [IDL.Nat64], []),
    'claim_refund_credit' : IDL.Func(
        [IDL.Nat],
        [
          IDL.Variant({
            'Ok' : IDL.Record({
              'remainingE8s' : IDL.Nat64,
              'returnedE8s' : IDL.Nat64,
            }),
            'Err' : IDL.Text,
          }),
        ],
        [],
      ),
    'clearAppVersionWasm' : IDL.Func(
        [IDL.Text, IDL.Nat, IDL.Nat, IDL.Nat],
        [],
        [],
      ),
    'clearManagerWasm' : IDL.Func([], [], []),
    'createNeuronManager' : IDL.Func([], [CreateManagerResult], []),
    'createPublisher' : IDL.Func(
        [CreatePublisherInput],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'deregisterCanister' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'deregisterCanisterFor' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'deregisterManager' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'deregisterManagerFor' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'getAdmins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'getAllAppRevenueStats' : IDL.Func(
        [],
        [IDL.Vec(AppRevenueStats)],
        ['query'],
      ),
    'getAllPublisherStats' : IDL.Func([], [IDL.Vec(PublisherStats)], ['query']),
    'getAllRegistrations' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(IDL.Principal)))],
        ['query'],
      ),
    'getAllWallets' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(UserCanisterEntry)))],
        ['query'],
      ),
    'getApp' : IDL.Func([IDL.Text], [IDL.Opt(AppInfo)], ['query']),
    'getAppByNumericId' : IDL.Func([IDL.Nat], [IDL.Opt(AppInfo)], ['query']),
    'getAppMintPrice' : IDL.Func(
        [IDL.Text, IDL.Principal],
        [
          IDL.Record({
            'premium' : IDL.Nat64,
            'isPremium' : IDL.Bool,
            'regular' : IDL.Nat64,
            'applicable' : IDL.Nat64,
          }),
        ],
        [],
      ),
    'getAppRevenueBalance' : IDL.Func([IDL.Nat, IDL.Nat], [IDL.Nat], []),
    'getAppRevenueStats' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(AppRevenueStats)],
        ['query'],
      ),
    'getAppRevenueSubaccount' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [IDL.Vec(IDL.Nat8)],
        ['query'],
      ),
    'getAppVersion' : IDL.Func(
        [IDL.Text, IDL.Nat, IDL.Nat, IDL.Nat],
        [IDL.Opt(AppVersionInfo)],
        ['query'],
      ),
    'getAppVersions' : IDL.Func(
        [IDL.Text],
        [IDL.Vec(AppVersionInfo)],
        ['query'],
      ),
    'getApps' : IDL.Func([], [IDL.Vec(AppInfo)], ['query']),
    'getAppsByFamily' : IDL.Func([IDL.Text], [IDL.Vec(AppInfo)], ['query']),
    'getAppsByPublisher' : IDL.Func([IDL.Nat], [IDL.Vec(AppInfo)], ['query']),
    'getAuthorizedForCallers' : IDL.Func(
        [],
        [IDL.Vec(IDL.Principal)],
        ['query'],
      ),
    'getCanisterCreationCycles' : IDL.Func([], [IDL.Nat], ['query']),
    'getCanisterId' : IDL.Func([], [IDL.Principal], ['query']),
    'getConversionRate' : IDL.Func(
        [],
        [
          IDL.Record({
            'xdrPermyriadPerIcp' : IDL.Nat64,
            'cyclesPerIcp' : IDL.Nat,
          }),
        ],
        [],
      ),
    'getCreationLog' : IDL.Func(
        [CreationLogQuery],
        [CreationLogResult],
        ['query'],
      ),
    'getCreationLogCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getCurrentVersion' : IDL.Func([], [Version], ['query']),
    'getCyclesBalance' : IDL.Func([], [IDL.Nat], ['query']),
    'getDaoRevenueStats' : IDL.Func([], [DaoRevenueStats], ['query']),
    'getEffectiveDaoCutForApp' : IDL.Func([IDL.Text], [IDL.Nat], ['query']),
    'getFactoryAggregates' : IDL.Func([], [FactoryAggregates], ['query']),
    'getFinancialLog' : IDL.Func(
        [FinancialLogQuery],
        [FinancialLogResult],
        ['query'],
      ),
    'getFinancialLogCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getIcpBalance' : IDL.Func([], [IDL.Nat], []),
    'getLatestAppVersion' : IDL.Func(
        [IDL.Text],
        [IDL.Opt(AppVersionInfo)],
        ['query'],
      ),
    'getManagerByCanisterId' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(ManagerInfo)],
        ['query'],
      ),
    'getManagerCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getManagerWasmSize' : IDL.Func([], [IDL.Nat], ['query']),
    'getManagersByOwner' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(IDL.Principal)],
        ['query'],
      ),
    'getMergedLog' : IDL.Func([MergedLogQuery], [MergedLogResult], ['query']),
    'getMintLog' : IDL.Func([MintLogQuery], [MintLogResult], ['query']),
    'getMintLogCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getMintLogCountForApp' : IDL.Func([IDL.Text], [IDL.Nat], ['query']),
    'getMintLogEntry' : IDL.Func([IDL.Nat], [IDL.Opt(MintLogEntry)], ['query']),
    'getMyManagers' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'getMyWallet' : IDL.Func([], [IDL.Vec(UserCanisterEntry)], ['query']),
    'getMyWalletForApp' : IDL.Func(
        [IDL.Text],
        [IDL.Vec(UserCanisterEntry)],
        ['query'],
      ),
    'getOfficialVersionByHash' : IDL.Func(
        [IDL.Text],
        [IDL.Opt(OfficialVersion)],
        ['query'],
      ),
    'getOfficialVersions' : IDL.Func([], [IDL.Vec(OfficialVersion)], ['query']),
    'getOrphanCanisters' : IDL.Func([], [IDL.Vec(OrphanCanister)], ['query']),
    'getPaymentConfig' : IDL.Func([], [PaymentConfig], ['query']),
    'getPaymentSubaccount' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(IDL.Nat8)],
        ['query'],
      ),
    'getPremiumCreationFee' : IDL.Func([], [IDL.Nat64], ['query']),
    'getPublisher' : IDL.Func([IDL.Nat], [IDL.Opt(PublisherInfo)], ['query']),
    'getPublisherRevenueBalance' : IDL.Func([IDL.Nat], [IDL.Nat], []),
    'getPublisherRevenueSubaccount' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(IDL.Nat8)],
        ['query'],
      ),
    'getPublisherStats' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(PublisherStats)],
        ['query'],
      ),
    'getPublishers' : IDL.Func([], [IDL.Vec(PublisherInfo)], ['query']),
    'getPublishersByOwner' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(PublisherInfo)],
        ['query'],
      ),
    'getRecentCreations' : IDL.Func(
        [IDL.Nat],
        [IDL.Vec(CreationLogEntry)],
        ['query'],
      ),
    'getRegisteredUserCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getSneedGovernance' : IDL.Func([], [IDL.Opt(IDL.Principal)], ['query']),
    'getSneedPremiumCanisterId' : IDL.Func(
        [],
        [IDL.Opt(IDL.Principal)],
        ['query'],
      ),
    'getTotalRegistrationCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getUserPaymentBalance' : IDL.Func([IDL.Principal], [IDL.Nat], []),
    'getUserWallet' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(UserCanisterEntry)],
        ['query'],
      ),
    'getVerifiedPublishers' : IDL.Func([], [IDL.Vec(PublisherInfo)], ['query']),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_orphans_for' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(OrphanInfo)],
        ['query'],
      ),
    'get_pending_top_ups' : IDL.Func([], [IDL.Vec(PendingTopUp)], ['query']),
    'get_refund_credits_for' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(RefundCredit)],
        ['query'],
      ),
    'get_special_prices' : IDL.Func(
        [],
        [
          IDL.Record({
            'admin_prices' : SpecialMintPrices,
            'partners' : IDL.Vec(PartnerListing),
          }),
        ],
        ['query'],
      ),
    'get_special_prices_for' : IDL.Func(
        [IDL.Principal],
        [
          IDL.Record({
            'admin_prices' : IDL.Opt(SpecialMintPrices),
            'partner' : IDL.Opt(PartnerMintPrices),
          }),
        ],
        ['query'],
      ),
    'hasAppVersionWasm' : IDL.Func(
        [IDL.Text, IDL.Nat, IDL.Nat, IDL.Nat],
        [IDL.Bool],
        ['query'],
      ),
    'hasManagerWasm' : IDL.Func([], [IDL.Bool], ['query']),
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
    'lookupLedgerTx' : IDL.Func(
        [IDL.Nat],
        [
          IDL.Record({
            'indexedFrom' : IDL.Nat,
            'hits' : IDL.Vec(
              IDL.Record({
                'field' : IDL.Text,
                'block_id' : IDL.Nat,
                'block' : IDL.Opt(Value),
                'btype' : IDL.Text,
              })
            ),
          }),
        ],
        ['query'],
      ),
    'lookupMintedCanister' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(MintLogEntry)],
        ['query'],
      ),
    'mintCanister' : IDL.Func(
        [IDL.Text, IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat)],
        [MintResult],
        [],
      ),
    'registerCanister' : IDL.Func(
        [IDL.Principal, IDL.Text],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'registerCanisterFor' : IDL.Func(
        [IDL.Principal, IDL.Principal, IDL.Text],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'registerManager' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'registerManagerFor' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'removeAdmin' : IDL.Func([IDL.Principal], [], []),
    'removeApp' : IDL.Func(
        [IDL.Nat],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'removeAppVersion' : IDL.Func(
        [IDL.Text, IDL.Nat, IDL.Nat, IDL.Nat],
        [],
        [],
      ),
    'removeAuthorizedForCaller' : IDL.Func([IDL.Principal], [], []),
    'removeOfficialVersion' : IDL.Func([IDL.Text], [IDL.Bool], []),
    'removePublisherFamily' : IDL.Func(
        [IDL.Nat, IDL.Text],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'removePublisherOwner' : IDL.Func(
        [IDL.Nat, IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'remove_partner_prices' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'retry_handover' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'retry_top_up' : IDL.Func(
        [IDL.Nat],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'setAppDaoCut' : IDL.Func([IDL.Nat, IDL.Opt(IDL.Nat)], [], []),
    'setAppEnabled' : IDL.Func(
        [IDL.Nat, IDL.Bool],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'setAppFamilies' : IDL.Func(
        [IDL.Nat, IDL.Vec(IDL.Text)],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'setAppPaymentAccount' : IDL.Func(
        [IDL.Nat, IDL.Opt(Account)],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'setAppPricing' : IDL.Func(
        [IDL.Nat, IDL.Nat64, IDL.Nat64],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'setCanisterCreationCycles' : IDL.Func([IDL.Nat], [], []),
    'setCreationFee' : IDL.Func([IDL.Nat64], [], []),
    'setCurrentVersion' : IDL.Func([Version], [], []),
    'setFeeDestination' : IDL.Func([Account], [], []),
    'setManagerWasm' : IDL.Func([IDL.Vec(IDL.Nat8)], [], []),
    'setOfficialVersions' : IDL.Func([IDL.Vec(OfficialVersion)], [], []),
    'setPaymentConfig' : IDL.Func([PaymentConfig], [], []),
    'setPaymentRequired' : IDL.Func([IDL.Bool], [], []),
    'setPremiumCreationFee' : IDL.Func([IDL.Nat64], [], []),
    'setPublisherDaoCut' : IDL.Func([IDL.Nat, IDL.Nat], [], []),
    'setSneedGovernance' : IDL.Func([IDL.Opt(IDL.Principal)], [], []),
    'setSneedPremiumCanisterId' : IDL.Func([IDL.Opt(IDL.Principal)], [], []),
    'setTargetCycles' : IDL.Func([IDL.Nat], [], []),
    'set_admin_prices' : IDL.Func(
        [SpecialMintPrices],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'set_partner_prices' : IDL.Func(
        [IDL.Principal, PartnerMintPrices],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'transferManager' : IDL.Func(
        [IDL.Principal, IDL.Principal],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'unverifyPublisher' : IDL.Func([IDL.Nat], [], []),
    'updateApp' : IDL.Func(
        [IDL.Nat, UpdateAppInput],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'updateAppVersion' : IDL.Func(
        [IDL.Text, IDL.Nat, IDL.Nat, IDL.Nat, AppVersionInput],
        [],
        [],
      ),
    'updateManagerNeuronId' : IDL.Func(
        [IDL.Principal, IDL.Opt(NeuronId)],
        [],
        [],
      ),
    'updateOfficialVersion' : IDL.Func(
        [IDL.Text, OfficialVersion],
        [IDL.Bool],
        [],
      ),
    'updatePublisher' : IDL.Func(
        [IDL.Nat, UpdatePublisherInput],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'uploadAppVersionWasm' : IDL.Func(
        [IDL.Text, IDL.Nat, IDL.Nat, IDL.Nat, IDL.Vec(IDL.Nat8)],
        [],
        [],
      ),
    'verifyPublisher' : IDL.Func([IDL.Nat], [], []),
    'wasMintedByUs' : IDL.Func([IDL.Principal], [IDL.Bool], ['query']),
    'withdrawAppFunds' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'withdrawPublisherFunds' : IDL.Func(
        [IDL.Nat],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'withdrawUserPayment' : IDL.Func([], [TransferResult], []),
    'withdrawUserToken' : IDL.Func([IDL.Principal], [TransferResult], []),
  });
};
export const init = ({ IDL }) => { return []; };
