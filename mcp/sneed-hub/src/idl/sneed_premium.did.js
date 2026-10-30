export const idlFactory = ({ IDL }) => {
  const GetBlocksResult = IDL.Rec();
  const Value = IDL.Rec();
  const AdminError = IDL.Variant({
    'InvalidInput' : IDL.Text,
    'NotFound' : IDL.Null,
    'NotAuthorized' : IDL.Null,
  });
  const AdminResult = IDL.Variant({ 'ok' : IDL.Null, 'err' : AdminError });
  const IcpTier = IDL.Record({
    'active' : IDL.Bool,
    'name' : IDL.Text,
    'amountE8s' : IDL.Nat,
    'durationNs' : IDL.Nat,
  });
  const VotingPowerTier = IDL.Record({
    'active' : IDL.Bool,
    'minVotingPowerE8s' : IDL.Nat,
    'name' : IDL.Text,
    'durationNs' : IDL.Nat,
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
  const Time = IDL.Int;
  const MembershipStatus = IDL.Variant({
    'Active' : IDL.Record({ 'expiration' : Time }),
    'NotFound' : IDL.Null,
    'Expired' : IDL.Record({ 'expiredAt' : Time }),
  });
  const Membership = IDL.Record({
    'principal' : IDL.Principal,
    'lastUpdated' : Time,
    'expiration' : Time,
  });
  const PromoCodeError = IDL.Variant({
    'CodeExpired' : IDL.Null,
    'AlreadyClaimed' : IDL.Null,
    'NotAuthorized' : IDL.Null,
    'CodeFullyClaimed' : IDL.Null,
    'InvalidCode' : IDL.Null,
    'CodeInactive' : IDL.Null,
    'InternalError' : IDL.Text,
  });
  const PromoCodeResult = IDL.Variant({
    'ok' : Membership,
    'err' : PromoCodeError,
  });
  const ClaimError = IDL.Variant({
    'NoActiveTiers' : IDL.Null,
    'NoEligibleNeurons' : IDL.Null,
    'NotAuthorized' : IDL.Null,
    'AlreadyClaimedRecently' : IDL.Record({
      'lastClaimTime' : Time,
      'nextClaimTime' : Time,
      'intervalNs' : IDL.Nat,
    }),
    'InternalError' : IDL.Text,
    'InsufficientVotingPower' : IDL.Record({
      'found' : IDL.Nat,
      'required' : IDL.Nat,
    }),
  });
  const ClaimResult = IDL.Variant({ 'ok' : Membership, 'err' : ClaimError });
  const CreatePromoCodeRequest = IDL.Record({
    'maxClaims' : IDL.Nat,
    'expiration' : IDL.Opt(Time),
    'notes' : IDL.Opt(IDL.Text),
    'durationNs' : IDL.Nat,
  });
  const PromoCode = IDL.Record({
    'active' : IDL.Bool,
    'maxClaims' : IDL.Nat,
    'code' : IDL.Text,
    'createdAt' : Time,
    'createdBy' : IDL.Principal,
    'claimCount' : IDL.Nat,
    'expiration' : IDL.Opt(Time),
    'notes' : IDL.Opt(IDL.Text),
    'durationNs' : IDL.Nat,
  });
  const AdminResult_5 = IDL.Variant({ 'ok' : PromoCode, 'err' : AdminError });
  const AdminResult_1 = IDL.Variant({ 'ok' : Membership, 'err' : AdminError });
  const Timestamp = IDL.Int;
  const ClaimType = IDL.Variant({
    'PromoCode' : IDL.Null,
    'VotingPower' : IDL.Null,
    'IcpPayment' : IDL.Null,
  });
  const ClaimLogEntry = IDL.Record({
    'id' : IDL.Nat,
    'votingPowerE8s' : IDL.Opt(IDL.Nat),
    'durationGrantedNs' : IDL.Nat,
    'previousExpiration' : Timestamp,
    'claimant' : IDL.Principal,
    'tierName' : IDL.Text,
    'icpAmountE8s' : IDL.Opt(IDL.Nat),
    'newExpiration' : Timestamp,
    'claimType' : ClaimType,
    'promoCode' : IDL.Opt(IDL.Text),
    'timestamp' : Timestamp,
  });
  const Subaccount = IDL.Vec(IDL.Nat8);
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(Subaccount),
  });
  const Config = IDL.Record({
    'minClaimIntervalNs' : IDL.Nat,
    'icpLedgerId' : IDL.Principal,
    'admins' : IDL.Vec(IDL.Principal),
    'paymentRecipient' : Account,
    'sneedGovernanceId' : IDL.Principal,
  });
  const IcpPaymentLogEntry = IDL.Record({
    'id' : IDL.Nat,
    'durationGrantedNs' : IDL.Nat,
    'tierName' : IDL.Text,
    'netAmountE8s' : IDL.Nat,
    'timestamp' : Timestamp,
    'amountE8s' : IDL.Nat,
    'payer' : IDL.Principal,
    'icpTransactionId' : IDL.Nat,
  });
  const PromoCodeClaim = IDL.Record({
    'durationGrantedNs' : IDL.Nat,
    'code' : IDL.Text,
    'claimedAt' : Time,
    'claimedBy' : IDL.Principal,
  });
  const AdminResult_4 = IDL.Variant({
    'ok' : IDL.Vec(PromoCodeClaim),
    'err' : AdminError,
  });
  const AdminResult_3 = IDL.Variant({
    'ok' : IDL.Vec(IDL.Tuple(IDL.Text, IDL.Nat)),
    'err' : AdminError,
  });
  const AdminResult_2 = IDL.Variant({
    'ok' : IDL.Vec(PromoCode),
    'err' : AdminError,
  });
  const PriceTier = IDL.Variant({
    'admin' : IDL.Null,
    'premium' : IDL.Null,
    'regular' : IDL.Null,
    'partner' : IDL.Null,
  });
  const IcpTierPrice = IDL.Record({
    'tier' : IcpTier,
    'price_e8s' : IDL.Nat,
    'price_tier' : PriceTier,
  });
  const SpecialPrices = IDL.Record({ 'icp_tier_price_bps' : IDL.Opt(IDL.Nat) });
  const PartnerListing = IDL.Record({
    'principal' : IDL.Principal,
    'label' : IDL.Text,
    'prices' : SpecialPrices,
    'expires_at' : IDL.Opt(IDL.Int),
  });
  const PartnerPrices = IDL.Record({
    'label' : IDL.Text,
    'prices' : SpecialPrices,
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
  const PurchaseError = IDL.Variant({
    'InsufficientPayment' : IDL.Record({
      'required' : IDL.Nat,
      'received' : IDL.Nat,
    }),
    'NotAuthorized' : IDL.Null,
    'TierNotActive' : IDL.Null,
    'InvalidTier' : IDL.Null,
    'TransferFailed' : IDL.Text,
    'InternalError' : IDL.Text,
  });
  const PurchaseResult = IDL.Variant({
    'ok' : Membership,
    'err' : PurchaseError,
  });
  const Withdrawal = IDL.Record({
    'to' : Account,
    'blockIndex' : IDL.Nat,
    'amountE8s' : IDL.Nat,
  });
  const WithdrawError = IDL.Variant({
    'NothingToWithdraw' : IDL.Record({ 'fee' : IDL.Nat, 'balance' : IDL.Nat }),
    'NotAuthorized' : IDL.Null,
    'InProgress' : IDL.Null,
    'TransferFailed' : IDL.Text,
  });
  const WithdrawResult = IDL.Variant({
    'ok' : Withdrawal,
    'err' : WithdrawError,
  });
  return IDL.Service({
    'addAdmin' : IDL.Func([IDL.Principal], [AdminResult], []),
    'addIcpTier' : IDL.Func([IcpTier], [AdminResult], []),
    'addVpTier' : IDL.Func([VotingPowerTier], [AdminResult], []),
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
    'checkMembership' : IDL.Func(
        [IDL.Principal],
        [MembershipStatus],
        ['query'],
      ),
    'checkMemberships' : IDL.Func(
        [IDL.Vec(IDL.Principal)],
        [IDL.Vec(MembershipStatus)],
        ['query'],
      ),
    'claimPromoCode' : IDL.Func([IDL.Text], [PromoCodeResult], []),
    'claimWithVotingPower' : IDL.Func([], [ClaimResult], []),
    'createPromoCode' : IDL.Func([CreatePromoCodeRequest], [AdminResult_5], []),
    'deactivatePromoCode' : IDL.Func([IDL.Text], [AdminResult], []),
    'deletePromoCode' : IDL.Func([IDL.Text], [AdminResult], []),
    'extendMembershipAdmin' : IDL.Func(
        [IDL.Principal, IDL.Nat],
        [AdminResult_1],
        [],
      ),
    'getActivePremiumMembers' : IDL.Func(
        [],
        [IDL.Vec(IDL.Principal)],
        ['query'],
      ),
    'getActivePremiumMembersPage' : IDL.Func(
        [IDL.Record({ 'limit' : IDL.Nat, 'start' : IDL.Nat })],
        [
          IDL.Record({
            'next' : IDL.Opt(IDL.Nat),
            'total_active' : IDL.Nat,
            'items' : IDL.Vec(
              IDL.Record({
                'principal' : IDL.Principal,
                'expiration' : IDL.Int,
              })
            ),
          }),
        ],
        ['query'],
      ),
    'getAllIcpTiers' : IDL.Func([], [IDL.Vec(IcpTier)], ['query']),
    'getAllMemberships' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, Membership))],
        ['query'],
      ),
    'getAllVotingPowerTiers' : IDL.Func(
        [],
        [IDL.Vec(VotingPowerTier)],
        ['query'],
      ),
    'getCanisterId' : IDL.Func([], [IDL.Principal], ['query']),
    'getClaimLog' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [
          IDL.Record({
            'claims' : IDL.Vec(ClaimLogEntry),
            'total_count' : IDL.Nat,
            'has_more' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
    'getClaimLogCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getClaimLogFor' : IDL.Func(
        [IDL.Principal, IDL.Nat, IDL.Nat],
        [
          IDL.Record({
            'claims' : IDL.Vec(ClaimLogEntry),
            'total_count' : IDL.Nat,
            'has_more' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
    'getConfig' : IDL.Func([], [Config], ['query']),
    'getDepositAccount' : IDL.Func([IDL.Principal], [Account], ['query']),
    'getIcpPaymentLog' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [
          IDL.Record({
            'payments' : IDL.Vec(IcpPaymentLogEntry),
            'total_count' : IDL.Nat,
            'has_more' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
    'getIcpPaymentLogCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getIcpPaymentLogFor' : IDL.Func(
        [IDL.Principal, IDL.Nat, IDL.Nat],
        [
          IDL.Record({
            'payments' : IDL.Vec(IcpPaymentLogEntry),
            'total_count' : IDL.Nat,
            'has_more' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
    'getIcpTiers' : IDL.Func([], [IDL.Vec(IcpTier)], ['query']),
    'getMembershipDetails' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(Membership)],
        ['query'],
      ),
    'getPaymentStats' : IDL.Func(
        [],
        [
          IDL.Record({
            'total_icp_payments' : IDL.Nat,
            'total_claims' : IDL.Nat,
            'payment_log_size' : IDL.Nat,
            'total_promo_claims' : IDL.Nat,
            'total_icp_collected_e8s' : IDL.Nat,
            'total_vp_claims' : IDL.Nat,
            'claim_log_size' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'getPromoCodeClaims' : IDL.Func([IDL.Text], [AdminResult_4], ['query']),
    'getPromoCodeIds' : IDL.Func([], [AdminResult_3], ['query']),
    'getPromoCodes' : IDL.Func([], [AdminResult_2], ['query']),
    'getVotingPowerTiers' : IDL.Func([], [IDL.Vec(VotingPowerTier)], ['query']),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_icp_payment_price_tier' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(PriceTier)],
        ['query'],
      ),
    'get_icp_tier_prices_for' : IDL.Func(
        [IDL.Principal],
        [IDL.Vec(IcpTierPrice)],
        ['query'],
      ),
    'get_special_prices' : IDL.Func(
        [],
        [
          IDL.Record({
            'admin_prices' : SpecialPrices,
            'partners' : IDL.Vec(PartnerListing),
          }),
        ],
        ['query'],
      ),
    'get_special_prices_for' : IDL.Func(
        [IDL.Principal],
        [
          IDL.Record({
            'admin_prices' : IDL.Opt(SpecialPrices),
            'partner' : IDL.Opt(PartnerPrices),
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
    'isCallerAdmin' : IDL.Func([], [IDL.Bool], ['query']),
    'purchaseWithIcp' : IDL.Func([], [PurchaseResult], []),
    'reactivatePromoCode' : IDL.Func([IDL.Text], [AdminResult], []),
    'removeAdmin' : IDL.Func([IDL.Principal], [AdminResult], []),
    'removeIcpTier' : IDL.Func([IDL.Nat], [AdminResult], []),
    'removeVpTier' : IDL.Func([IDL.Nat], [AdminResult], []),
    'remove_partner_prices' : IDL.Func(
        [IDL.Principal],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'revokeMembership' : IDL.Func([IDL.Principal], [AdminResult], []),
    'setIcpLedgerId' : IDL.Func([IDL.Principal], [AdminResult], []),
    'setMembershipAdmin' : IDL.Func([IDL.Principal, Time], [AdminResult_1], []),
    'setMinClaimInterval' : IDL.Func([IDL.Nat], [AdminResult], []),
    'setPaymentRecipient' : IDL.Func([Account], [AdminResult], []),
    'setSneedGovernanceId' : IDL.Func([IDL.Principal], [AdminResult], []),
    'set_admin_prices' : IDL.Func(
        [SpecialPrices],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'set_partner_prices' : IDL.Func(
        [IDL.Principal, PartnerPrices],
        [IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text })],
        [],
      ),
    'updateConfig' : IDL.Func([Config], [AdminResult], []),
    'updateIcpTier' : IDL.Func([IDL.Nat, IcpTier], [AdminResult], []),
    'updateVpTier' : IDL.Func([IDL.Nat, VotingPowerTier], [AdminResult], []),
    'withdrawDeposit' : IDL.Func([], [WithdrawResult], []),
    'withdrawDepositToken' : IDL.Func([IDL.Principal], [WithdrawResult], []),
  });
};
export const init = ({ IDL }) => { return []; };
