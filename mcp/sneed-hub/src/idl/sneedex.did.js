export const idlFactory = ({ IDL }) => {
  const GetBlocksResult = IDL.Rec();
  const Value = IDL.Rec();
  const Config = IDL.Record({
    'min_increment_usd_range_max' : IDL.Nat,
    'min_increment_usd_range_min' : IDL.Nat,
    'min_increment_fallback_tokens' : IDL.Nat,
    'admins' : IDL.Vec(IDL.Principal),
    'min_increment_usd_target' : IDL.Nat,
    'max_assets_per_offer' : IDL.Nat,
    'min_offer_duration_ns' : IDL.Nat,
  });
  const OfferId = IDL.Nat;
  const SneedexError = IDL.Variant({
    'CannotCancelWithBids' : IDL.Null,
    'CanisterError' : IDL.Text,
    'EscrowFailed' : IDL.Text,
    'InvalidInput' : IDL.Text,
    'InvalidPrice' : IDL.Text,
    'OfferNotFound' : IDL.Null,
    'OfferMustHaveBuyoutOrExpiration' : IDL.Null,
    'NotAuthorized' : IDL.Null,
    'InvalidAsset' : IDL.Text,
    'InvalidExpiration' : IDL.Null,
    'AssetTypeNotSupported' : IDL.Null,
    'BidIncrementTooSmall' : IDL.Record({
      'required_increment' : IDL.Nat,
      'current_highest' : IDL.Nat,
      'minimum_next' : IDL.Nat,
    }),
    'GovernanceError' : IDL.Text,
    'TransferFailed' : IDL.Text,
    'BidTooLow' : IDL.Record({ 'minimum' : IDL.Nat }),
    'OfferExpired' : IDL.Null,
    'BidNotFound' : IDL.Null,
    'InvalidState' : IDL.Text,
    'InsufficientFunds' : IDL.Record({
      'available' : IDL.Nat,
      'required' : IDL.Nat,
    }),
  });
  const Result_1 = IDL.Variant({ 'ok' : IDL.Null, 'err' : SneedexError });
  const CanisterKindId = IDL.Nat;
  const CanisterAsset = IDL.Record({
    'controllers_snapshot' : IDL.Opt(IDL.Vec(IDL.Principal)),
    'title' : IDL.Opt(IDL.Text),
    'canister_id' : IDL.Principal,
    'description' : IDL.Opt(IDL.Text),
    'canister_kind' : IDL.Opt(CanisterKindId),
    'cached_total_stake_e8s' : IDL.Opt(IDL.Nat64),
  });
  const EXTNFTAsset = IDL.Record({
    'token_indices' : IDL.Vec(IDL.Nat32),
    'collection_canister_id' : IDL.Principal,
  });
  const ICRC1TokenAsset = IDL.Record({
    'ledger_canister_id' : IDL.Principal,
    'amount' : IDL.Nat,
  });
  const SneedLockKind = IDL.Variant({
    'Position' : IDL.Record({
      'swap_canister_id' : IDL.Principal,
      'expiry' : IDL.Nat64,
      'position_id' : IDL.Nat,
    }),
    'Token' : IDL.Record({
      'ledger_canister_id' : IDL.Principal,
      'expiry' : IDL.Nat64,
      'amount' : IDL.Nat,
    }),
  });
  const SneedLockAsset = IDL.Record({
    'lock_id' : IDL.Nat,
    'lock' : SneedLockKind,
  });
  const ICRC7NFTAsset = IDL.Record({
    'collection_canister_id' : IDL.Principal,
    'token_ids' : IDL.Vec(IDL.Nat),
  });
  const NeuronId = IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) });
  const SNSNeuronAsset = IDL.Record({
    'cached_stake_e8s' : IDL.Opt(IDL.Nat64),
    'hotkeys_snapshot' : IDL.Opt(IDL.Vec(IDL.Principal)),
    'governance_canister_id' : IDL.Principal,
    'neuron_id' : NeuronId,
  });
  const Asset = IDL.Variant({
    'Canister' : CanisterAsset,
    'EXTNFT' : EXTNFTAsset,
    'ICRC1Token' : ICRC1TokenAsset,
    'SneedLock' : SneedLockAsset,
    'ICRC7NFT' : ICRC7NFTAsset,
    'SNSNeuron' : SNSNeuronAsset,
  });
  const AddAssetRequest = IDL.Record({ 'asset' : Asset, 'offer_id' : OfferId });
  const AssetTypeId = IDL.Nat;
  const Result_6 = IDL.Variant({ 'ok' : AssetTypeId, 'err' : SneedexError });
  const Result_5 = IDL.Variant({ 'ok' : IDL.Text, 'err' : SneedexError });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
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
  const BidId = IDL.Nat;
  const Time = IDL.Int;
  const CreateOfferRequest = IDL.Record({
    'approved_bidders' : IDL.Opt(IDL.Vec(IDL.Principal)),
    'buyout_price' : IDL.Opt(IDL.Nat),
    'price_token_ledger' : IDL.Principal,
    'expiration' : IDL.Opt(Time),
    'min_bid_price' : IDL.Opt(IDL.Nat),
    'note_to_buyer' : IDL.Opt(IDL.Text),
    'public_note' : IDL.Opt(IDL.Text),
    'min_bid_increment_fee_multiple' : IDL.Opt(IDL.Nat),
  });
  const Result_4 = IDL.Variant({ 'ok' : OfferId, 'err' : SneedexError });
  const OfferState = IDL.Variant({
    'PendingEscrow' : IDL.Null,
    'Claimed' : IDL.Null,
    'Active' : IDL.Null,
    'Draft' : IDL.Null,
    'Reclaimed' : IDL.Null,
    'Cancelled' : IDL.Null,
    'Completed' : IDL.Record({
      'winning_bid_id' : BidId,
      'completion_time' : Time,
    }),
    'Expired' : IDL.Null,
  });
  const AssetEntry = IDL.Record({ 'asset' : Asset, 'escrowed' : IDL.Bool });
  const Offer = IDL.Record({
    'id' : OfferId,
    'approved_bidders' : IDL.Opt(IDL.Vec(IDL.Principal)),
    'creator' : IDL.Principal,
    'buyout_price' : IDL.Opt(IDL.Nat),
    'fee_rate_bps' : IDL.Nat,
    'price_token_ledger' : IDL.Principal,
    'assets' : IDL.Vec(AssetEntry),
    'activated_at' : IDL.Opt(Time),
    'created_at' : Time,
    'state' : OfferState,
    'expiration' : IDL.Opt(Time),
    'min_bid_price' : IDL.Opt(IDL.Nat),
    'note_to_buyer' : IDL.Opt(IDL.Text),
    'public_note' : IDL.Opt(IDL.Text),
    'min_bid_increment_fee_multiple' : IDL.Opt(IDL.Nat),
  });
  const AssetType = IDL.Record({
    'id' : AssetTypeId,
    'active' : IDL.Bool,
    'name' : IDL.Text,
    'description' : IDL.Text,
  });
  const Result = IDL.Variant({ 'ok' : IDL.Nat, 'err' : SneedexError });
  const BidState = IDL.Variant({
    'Won' : IDL.Null,
    'Refunded' : IDL.Null,
    'Lost' : IDL.Null,
    'ClaimedBySeller' : IDL.Null,
    'Pending' : IDL.Null,
  });
  const Bid = IDL.Record({
    'id' : BidId,
    'created_at' : Time,
    'state' : BidState,
    'offer_id' : OfferId,
    'tokens_escrowed' : IDL.Bool,
    'amount' : IDL.Nat,
    'bidder' : IDL.Principal,
  });
  const NeuronManagerVersion = IDL.Record({
    'major' : IDL.Nat,
    'minor' : IDL.Nat,
    'patch' : IDL.Nat,
  });
  const ICPNeuronId = IDL.Record({ 'id' : IDL.Nat64 });
  const ICPNeuronInfo = IDL.Record({
    'staked_maturity_e8s_equivalent' : IDL.Nat64,
    'dissolve_delay_seconds' : IDL.Nat64,
    'maturity_e8s_equivalent' : IDL.Nat64,
    'cached_neuron_stake_e8s' : IDL.Nat64,
    'state' : IDL.Int32,
    'hot_keys' : IDL.Vec(IDL.Principal),
    'voting_power' : IDL.Nat64,
    'neuron_id' : ICPNeuronId,
    'age_seconds' : IDL.Nat64,
  });
  const NeuronManagerInfo = IDL.Record({
    'version' : NeuronManagerVersion,
    'neuron_count' : IDL.Nat,
    'neurons' : IDL.Vec(ICPNeuronInfo),
  });
  const CanisterInfo = IDL.Record({
    'status' : IDL.Variant({
      'stopped' : IDL.Null,
      'stopping' : IDL.Null,
      'running' : IDL.Null,
    }),
    'freezing_threshold' : IDL.Nat,
    'controllers' : IDL.Vec(IDL.Principal),
    'memory_size' : IDL.Nat,
    'canister_id' : IDL.Principal,
    'cycles' : IDL.Nat,
    'idle_cycles_burned_per_day' : IDL.Nat,
    'module_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'memory_allocation' : IDL.Nat,
    'compute_allocation' : IDL.Nat,
  });
  const Result_3 = IDL.Variant({ 'ok' : CanisterInfo, 'err' : SneedexError });
  const CanisterKind = IDL.Record({
    'id' : CanisterKindId,
    'active' : IDL.Bool,
    'name' : IDL.Text,
    'description' : IDL.Text,
  });
  const Timestamp = IDL.Nat64;
  const CreationFeePaymentLogEntry = IDL.Record({
    'id' : IDL.Nat,
    'amount_e8s' : IDL.Nat,
    'offer_id' : OfferId,
    'icp_transaction_id' : IDL.Nat,
    'timestamp' : Timestamp,
    'payer' : IDL.Principal,
  });
  const CutPaymentLogEntry = IDL.Record({
    'id' : IDL.Nat,
    'transaction_id' : IDL.Nat,
    'fee_rate_bps' : IDL.Nat,
    'seller' : IDL.Principal,
    'ledger' : IDL.Principal,
    'offer_id' : OfferId,
    'timestamp' : Timestamp,
    'buyer' : IDL.Principal,
    'bid_amount' : IDL.Nat,
    'bid_id' : BidId,
    'cut_amount' : IDL.Nat,
  });
  const MarketStats = IDL.Record({
    'completed_offers' : IDL.Nat,
    'total_bids' : IDL.Nat,
    'total_volume_by_token' : IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat)),
    'total_offers' : IDL.Nat,
    'active_offers' : IDL.Nat,
  });
  const NotificationSettings = IDL.Record({
    'notify_on_sale' : IDL.Bool,
    'notify_on_expiration' : IDL.Bool,
    'notify_on_bid' : IDL.Bool,
    'notify_on_win' : IDL.Bool,
    'notify_on_private_invite' : IDL.Bool,
    'notify_on_cancellation' : IDL.Bool,
    'notify_on_outbid' : IDL.Bool,
  });
  const OfferFeedFilter = IDL.Record({
    'states' : IDL.Opt(IDL.Vec(OfferState)),
    'creator' : IDL.Opt(IDL.Principal),
    'asset_types' : IDL.Opt(IDL.Vec(AssetTypeId)),
    'public_only' : IDL.Opt(IDL.Bool),
    'viewer' : IDL.Opt(IDL.Principal),
    'has_bids' : IDL.Opt(IDL.Bool),
  });
  const GetOfferFeedInput = IDL.Record({
    'start_id' : IDL.Opt(OfferId),
    'filter' : IDL.Opt(OfferFeedFilter),
    'length' : IDL.Nat,
  });
  const GetOfferFeedResponse = IDL.Record({
    'offers' : IDL.Vec(Offer),
    'has_more' : IDL.Bool,
    'next_start_id' : IDL.Opt(OfferId),
  });
  const OfferView = IDL.Record({
    'offer' : Offer,
    'bids' : IDL.Vec(Bid),
    'highest_bid' : IDL.Opt(Bid),
  });
  const PriceTier = IDL.Variant({
    'admin' : IDL.Null,
    'premium' : IDL.Null,
    'regular' : IDL.Null,
    'partner' : IDL.Null,
  });
  const OfferPriceTiers = IDL.Record({
    'cut' : PriceTier,
    'creation_fee' : IDL.Opt(PriceTier),
  });
  const SpecialPriceOverrides = IDL.Record({
    'auction_cut_bps' : IDL.Opt(IDL.Nat),
    'offer_creation_fee_e8s' : IDL.Opt(IDL.Nat),
  });
  const PartnerListing = IDL.Record({
    'principal' : IDL.Principal,
    'label' : IDL.Text,
    'prices' : SpecialPriceOverrides,
    'expires_at' : IDL.Opt(IDL.Int),
  });
  const Partner = IDL.Record({
    'label' : IDL.Text,
    'prices' : SpecialPriceOverrides,
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
  const Result_2 = IDL.Variant({ 'ok' : BidId, 'err' : SneedexError });
  const TradingBotVersion = IDL.Record({
    'major' : IDL.Nat,
    'minor' : IDL.Nat,
    'patch' : IDL.Nat,
  });
  const Sneedex = IDL.Service({
    'acceptBid' : IDL.Func([OfferId], [Result_1], []),
    'activateOffer' : IDL.Func([OfferId], [Result_1], []),
    'addAdmin' : IDL.Func([IDL.Principal], [Result_1], []),
    'addAsset' : IDL.Func([AddAssetRequest], [Result_1], []),
    'addAssetType' : IDL.Func([IDL.Text, IDL.Text], [Result_6], []),
    'adminReclaimStuckTokens' : IDL.Func([OfferId], [Result_5], []),
    'adminReturnMisplacedExtNft' : IDL.Func(
        [IDL.Principal, IDL.Nat32, IDL.Opt(OfferId), IDL.Principal],
        [Result_5],
        [],
      ),
    'adminReturnMisplacedNft' : IDL.Func(
        [IDL.Principal, IDL.Nat, Account],
        [Result_5],
        [],
      ),
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
    'cancelOffer' : IDL.Func([OfferId], [Result_1], []),
    'claimAssets' : IDL.Func([OfferId], [Result_1], []),
    'claimWinningBid' : IDL.Func([OfferId], [Result_1], []),
    'clearNeuronInfoCache' : IDL.Func([], [Result_1], []),
    'clearNeuronInfoCacheFor' : IDL.Func([IDL.Principal], [Result_1], []),
    'confirmBid' : IDL.Func([BidId, IDL.Nat], [Result_1], []),
    'createOffer' : IDL.Func([CreateOfferRequest], [Result_4], []),
    'deactivateAssetType' : IDL.Func([AssetTypeId], [Result_1], []),
    'debugGetAllOffers' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Record({
              'id' : OfferId,
              'approved_bidders' : IDL.Opt(IDL.Vec(IDL.Principal)),
              'creator' : IDL.Principal,
              'state' : OfferState,
            })
          ),
        ],
        ['query'],
      ),
    'escrowCanister' : IDL.Func([OfferId, IDL.Nat], [Result_1], []),
    'escrowEXTNFTs' : IDL.Func([OfferId, IDL.Nat], [Result_1], []),
    'escrowICRC1Tokens' : IDL.Func([OfferId, IDL.Nat], [Result_1], []),
    'escrowICRC7NFTs' : IDL.Func([OfferId, IDL.Nat], [Result_1], []),
    'escrowICRC7NFTsByApproval' : IDL.Func([OfferId, IDL.Nat], [Result_1], []),
    'escrowSNSNeuron' : IDL.Func([OfferId, IDL.Nat], [Result_1], []),
    'escrowSneedLock' : IDL.Func([OfferId, IDL.Nat], [Result_1], []),
    'finalizeAssets' : IDL.Func([OfferId], [Result_1], []),
    'getActiveOffers' : IDL.Func([], [IDL.Vec(Offer)], ['query']),
    'getAssetTypes' : IDL.Func([], [IDL.Vec(AssetType)], ['query']),
    'getBackendCanisterId' : IDL.Func([], [IDL.Opt(IDL.Principal)], ['query']),
    'getBidEscrowBalance' : IDL.Func([BidId], [Result], []),
    'getBidEscrowSubaccount' : IDL.Func(
        [IDL.Principal, BidId],
        [IDL.Vec(IDL.Nat8)],
        ['query'],
      ),
    'getBidsByBidder' : IDL.Func([IDL.Principal], [IDL.Vec(Bid)], ['query']),
    'getCachedNeuronManagerInfoQuery' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(NeuronManagerInfo)],
        ['query'],
      ),
    'getCanisterInfo' : IDL.Func([OfferId, IDL.Nat], [Result_3], []),
    'getCanisterKinds' : IDL.Func([], [IDL.Vec(CanisterKind)], ['query']),
    'getConfig' : IDL.Func([], [Config], ['query']),
    'getCreationFeePaymentLog' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [
          IDL.Record({
            'payments' : IDL.Vec(CreationFeePaymentLogEntry),
            'total_count' : IDL.Nat,
            'has_more' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
    'getCreationFeePaymentLogCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getCutPaymentLog' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [
          IDL.Record({
            'payments' : IDL.Vec(CutPaymentLogEntry),
            'total_count' : IDL.Nat,
            'has_more' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
    'getCutPaymentLogCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getEffectiveOfferCreationFee' : IDL.Func([IDL.Principal], [IDL.Nat64], []),
    'getExpirationCheckInterval' : IDL.Func([], [IDL.Nat], ['query']),
    'getFeeConfig' : IDL.Func(
        [],
        [
          IDL.Record({
            'premiumAuctionCutBps' : IDL.Nat,
            'regularAuctionCutBps' : IDL.Nat,
            'regularCreationFeeE8s' : IDL.Nat64,
            'premiumCreationFeeE8s' : IDL.Nat64,
          }),
        ],
        ['query'],
      ),
    'getFeeRecipient' : IDL.Func([], [Account], ['query']),
    'getLedgerFeeRecipients' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, Account))],
        ['query'],
      ),
    'getMarketStats' : IDL.Func([], [MarketStats], ['query']),
    'getMarketplaceFeeRate' : IDL.Func([], [IDL.Nat], ['query']),
    'getMinIncrementSettings' : IDL.Func(
        [],
        [
          IDL.Record({
            'usd_range_max' : IDL.Nat,
            'usd_range_min' : IDL.Nat,
            'usd_target' : IDL.Nat,
            'fallback_tokens' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'getMyNotificationSettings' : IDL.Func(
        [],
        [NotificationSettings],
        ['query'],
      ),
    'getNeuronInfoCacheStaleness' : IDL.Func([], [IDL.Nat], ['query']),
    'getNeuronManagerFactoryCanisterId' : IDL.Func(
        [],
        [IDL.Opt(IDL.Principal)],
        ['query'],
      ),
    'getNeuronManagerInfo' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : NeuronManagerInfo, 'Err' : IDL.Text })],
        [],
      ),
    'getNextBidId' : IDL.Func([], [BidId], ['query']),
    'getNextOfferId' : IDL.Func([], [OfferId], ['query']),
    'getOfferCreationFee' : IDL.Func([], [IDL.Nat64], ['query']),
    'getOfferCreationPaymentSubaccount' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(IDL.Nat8)],
        ['query'],
      ),
    'getOfferEscrowAccountId' : IDL.Func(
        [IDL.Principal, OfferId],
        [IDL.Text],
        ['query'],
      ),
    'getOfferEscrowSubaccount' : IDL.Func(
        [IDL.Principal, OfferId],
        [IDL.Vec(IDL.Nat8)],
        ['query'],
      ),
    'getOfferFeed' : IDL.Func(
        [GetOfferFeedInput],
        [GetOfferFeedResponse],
        ['query'],
      ),
    'getOfferView' : IDL.Func([OfferId], [IDL.Opt(OfferView)], ['query']),
    'getOffersByCreator' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(Offer)],
        ['query'],
      ),
    'getPaymentStats' : IDL.Func(
        [],
        [
          IDL.Record({
            'cuts_by_ledger' : IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat)),
            'total_creation_fees_collected_e8s' : IDL.Nat,
            'total_creation_fee_payments' : IDL.Nat,
            'total_cut_payments' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'getPremiumAuctionCutBps' : IDL.Func([], [IDL.Nat], ['query']),
    'getPremiumOfferCreationFee' : IDL.Func([], [IDL.Nat64], ['query']),
    'getPrivateOffersFor' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(Offer)],
        ['query'],
      ),
    'getPublicOffers' : IDL.Func([], [IDL.Vec(Offer)], ['query']),
    'getSneedLockCanisterId' : IDL.Func([], [IDL.Principal], ['query']),
    'getSneedPremiumCanisterId' : IDL.Func(
        [],
        [IDL.Opt(IDL.Principal)],
        ['query'],
      ),
    'getSneedSmsCanisterId' : IDL.Func([], [IDL.Opt(IDL.Principal)], ['query']),
    'getUserOfferCreationBalance' : IDL.Func([IDL.Principal], [IDL.Nat], []),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_offer_price_tiers' : IDL.Func(
        [OfferId],
        [IDL.Opt(OfferPriceTiers)],
        ['query'],
      ),
    'get_special_prices' : IDL.Func(
        [],
        [
          IDL.Record({
            'admin_prices' : SpecialPriceOverrides,
            'partners' : IDL.Vec(PartnerListing),
          }),
        ],
        ['query'],
      ),
    'get_special_prices_for' : IDL.Func(
        [IDL.Principal],
        [
          IDL.Record({
            'admin_prices' : IDL.Opt(SpecialPriceOverrides),
            'partner' : IDL.Opt(Partner),
          }),
        ],
        ['query'],
      ),
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
    'isExpirationTimerRunning' : IDL.Func([], [IDL.Bool], ['query']),
    'isExpirationWorkerRunning' : IDL.Func([], [IDL.Bool], ['query']),
    'processExpiration' : IDL.Func([OfferId], [Result_1], []),
    'queryBid' : IDL.Func([BidId], [IDL.Opt(Bid)], ['query']),
    'queryOffer' : IDL.Func([OfferId], [IDL.Opt(Offer)], ['query']),
    'reactivateAssetType' : IDL.Func([AssetTypeId], [Result_1], []),
    'reclaimAssets' : IDL.Func([OfferId], [Result_1], []),
    'refundBid' : IDL.Func([BidId], [Result_1], []),
    'removeAdmin' : IDL.Func([IDL.Principal], [Result_1], []),
    'removeLedgerFeeRecipient' : IDL.Func([IDL.Principal], [Result_1], []),
    'remove_partner_prices' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'reserveBid' : IDL.Func([OfferId], [Result_2], []),
    'setBackendCanisterId' : IDL.Func([IDL.Opt(IDL.Principal)], [Result_1], []),
    'setExpirationCheckInterval' : IDL.Func([IDL.Nat], [Result_1], []),
    'setFeeRecipient' : IDL.Func([Account], [Result_1], []),
    'setLedgerFeeRecipient' : IDL.Func(
        [IDL.Principal, Account],
        [Result_1],
        [],
      ),
    'setMarketplaceFeeRate' : IDL.Func([IDL.Nat], [Result_1], []),
    'setMinIncrementSettings' : IDL.Func(
        [IDL.Nat, IDL.Nat, IDL.Nat, IDL.Nat],
        [Result_1],
        [],
      ),
    'setMyNotificationSettings' : IDL.Func(
        [NotificationSettings],
        [Result_1],
        [],
      ),
    'setNeuronInfoCacheStaleness' : IDL.Func([IDL.Nat], [Result_1], []),
    'setNeuronManagerFactoryCanisterId' : IDL.Func(
        [IDL.Opt(IDL.Principal)],
        [Result_1],
        [],
      ),
    'setOfferCreationFee' : IDL.Func([IDL.Nat64], [Result_1], []),
    'setPremiumAuctionCutBps' : IDL.Func([IDL.Nat], [Result_1], []),
    'setPremiumOfferCreationFee' : IDL.Func([IDL.Nat64], [Result_1], []),
    'setSneedLockCanisterId' : IDL.Func([IDL.Principal], [Result_1], []),
    'setSneedPremiumCanisterId' : IDL.Func(
        [IDL.Opt(IDL.Principal)],
        [Result_1],
        [],
      ),
    'setSneedSmsCanisterId' : IDL.Func(
        [IDL.Opt(IDL.Principal)],
        [Result_1],
        [],
      ),
    'set_admin_prices' : IDL.Func(
        [SpecialPriceOverrides],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'set_partner_prices' : IDL.Func(
        [IDL.Principal, Partner],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'startExpirationTimer' : IDL.Func([], [Result_1], []),
    'stopExpirationTimer' : IDL.Func([], [Result_1], []),
    'triggerExpirationCheck' : IDL.Func([], [Result_1], []),
    'updateConfig' : IDL.Func([Config], [Result_1], []),
    'verifyICPNeuronManager' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : NeuronManagerVersion, 'Err' : IDL.Text })],
        [],
      ),
    'verifyTradingBot' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'Ok' : TradingBotVersion, 'Err' : IDL.Text })],
        [],
      ),
    'withdrawBidEscrow' : IDL.Func([BidId, IDL.Nat], [Result], []),
    'withdrawOfferCreationPayment' : IDL.Func([], [Result], []),
  });
  return Sneedex;
};
export const init = ({ IDL }) => {
  const Config = IDL.Record({
    'min_increment_usd_range_max' : IDL.Nat,
    'min_increment_usd_range_min' : IDL.Nat,
    'min_increment_fallback_tokens' : IDL.Nat,
    'admins' : IDL.Vec(IDL.Principal),
    'min_increment_usd_target' : IDL.Nat,
    'max_assets_per_offer' : IDL.Nat,
    'min_offer_duration_ns' : IDL.Nat,
  });
  return [IDL.Opt(Config)];
};
