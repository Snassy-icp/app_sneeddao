/// Types of the Sneed token launchpad (`sneed_pad`).
module {
  // ---- ICRC ledger suite (what the ledger and index canisters take at install) ----
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type MetadataValue = { #Nat : Nat; #Int : Int; #Text : Text; #Blob : Blob };
  public type ArchiveOptions = {
    num_blocks_to_archive : Nat64;
    max_transactions_per_response : ?Nat64;
    trigger_threshold : Nat64;
    more_controller_ids : ?[Principal];
    max_message_size_bytes : ?Nat64;
    cycles_for_archive_creation : ?Nat64;
    node_max_memory_size_bytes : ?Nat64;
    controller_id : Principal;
  };
  public type FeatureFlags = { icrc2 : Bool };
  public type LedgerInitArgs = {
    decimals : ?Nat8;
    token_symbol : Text;
    transfer_fee : Nat;
    metadata : [(Text, MetadataValue)];
    minting_account : Account;
    initial_balances : [(Account, Nat)];
    maximum_number_of_accounts : ?Nat64;
    accounts_overflow_trim_quantity : ?Nat64;
    fee_collector_account : ?Account;
    archive_options : ArchiveOptions;
    max_memo_length : ?Nat16;
    token_name : Text;
    feature_flags : ?FeatureFlags;
    index_principal : ?Principal; // ICRC-106: the ledger announces its index (ledger suite 2025+; older wasms ignore the field)
  };
  /// Only `#Init` is ever sent; the `#Upgrade` alternative exists so the
  /// variant matches the ledger's argument type shape.
  public type LedgerArgument = { #Init : LedgerInitArgs; #Upgrade : ?{} };
  public type IndexArg = {
    #Init : { ledger_id : Principal; retrieve_blocks_from_ledger_interval_seconds : ?Nat64 };
    #Upgrade : { ledger_id : ?Principal; retrieve_blocks_from_ledger_interval_seconds : ?Nat64 };
  };

  // ---- what a creator asks for ----
  public type Allocation = { account : Account; amount : Nat };
  /// Who may mint after launch. `#nobody` sets the minting account to the new
  /// ledger itself, a principal that never transfers, so the supply is fixed.
  public type MintingPolicy = { #nobody; #sneed_dao; #principal : Principal };
  /// Who controls the ledger (and its archives and index) after launch.
  /// `#keep_with` keeps the creator and adds more controllers; `#sns` hands the
  /// canisters to that SNS's root (the creator files the registration
  /// proposal with their own neuron; the pad files nothing).
  /// `#guardian` hands the canisters to a Sneed custody canister (sneed_guardian, sneed_guardian_blackhole or
  /// sneed_guardian_multidao, see spec/custody.md) and registers them there with this policy; the DAO then
  /// changes them only through that canister's ops, with the creator's guardians able to veto.
  public type GuardianPolicy = { guardians : [Principal]; vetoes_to_block : Nat; oks_required : Nat; window_ns : Nat; auto_upgrade : Bool };
  public type ControlChoice = { #keep; #keep_with : [Principal]; #blackhole; #sneed_dao; #sns : Principal; #guardian : { canister : Principal; policy : GuardianPolicy } };
  public type GuardianKind = { #ledger; #index; #archive };
  public type GuardianActor = actor {
    register : shared (Principal, GuardianKind, GuardianPolicy, ?Principal, Text) -> async { #Ok : Any; #Err : Text };
    // only the field the pad reads; the guardian's Child record has more
    get_child : shared query Principal -> async ?{ kind : GuardianKind };
  };
  public type TokenConfig = {
    name : Text;
    symbol : Text;
    decimals : Nat8;
    transfer_fee : Nat;
    logo : ?Text; // data URL
    allocations : [Allocation];
    minting : MintingPolicy;
    fee_collector : ?Account;
    control : ControlChoice;
    with_index : Bool;
  };

  /// An index canister for a ledger that already exists (ours or anyone's). A ledger may have
  /// several indexes; a redundant one is still useful, and one the ledger cannot be pointed at
  /// (ICRC-106) is still queryable on its own.
  public type IndexConfig = { ledger : Principal; control : ControlChoice };
  public type IndexLaunch = {
    id : Nat;
    creator : Principal;
    created_at : Int;
    config : IndexConfig;
    quote : Quote;
    paid_e8s : Nat;
    index : ?Principal;
    index_wasm_hash : ?Blob;
    controllers : [Principal];
    status : LaunchStatus;
    steps : [(Text, Int)];
  };

  // ---- quotes, launches, configuration ----
  public type Quote = {
    creation_fee_e8s : Nat; // the pad's fee, forwarded to the fee destination
    control_fee_e8s : Nat;  // the handover fee when control goes to Sneed DAO (0 otherwise), same destination
    ledger_cycles : Nat;    // cycles the new ledger starts with
    index_cycles : Nat;     // cycles the new index starts with (0 without index)
    icp_for_cycles_e8s : Nat; // ICP converted to cycles through the CMC for the above
    ledger_fees_e8s : Nat;  // ICP ledger fees the pad pays on the way
    total_e8s : Nat;        // what the creator approves and pays
    xdr_permyriad_per_icp : Nat64; // CMC rate used
    premium : Bool;         // the creation fee is the Sneed Premium member rate
  };
  public type LaunchStatus = { #created; #failed : Text };
  public type Launch = {
    id : Nat;
    creator : Principal;
    created_at : Int;
    config : TokenConfig;
    quote : Quote;
    paid_e8s : Nat;
    ledger : ?Principal;
    index : ?Principal;
    ledger_wasm_hash : ?Blob;
    index_wasm_hash : ?Blob;
    controllers : [Principal];
    registration_proposal : ?Nat64;
    status : LaunchStatus;
    steps : [(Text, Int)]; // step name, time (ns)
  };
  /// A launch as the lists show it: without the logo (get_launch_logo) and the allocation list
  /// (get_launch has both), so a page stays small whatever the launches carry.
  public type LaunchSummary = {
    id : Nat;
    creator : Principal;
    created_at : Int;
    name : Text;
    symbol : Text;
    decimals : Nat8;
    transfer_fee : Nat;
    logo_bytes : Nat; // 0: no logo
    allocations : Nat; // how many
    allocated : Nat; // their total amount
    minting : MintingPolicy;
    fee_collector : ?Account;
    control : ControlChoice;
    with_index : Bool;
    quote : Quote;
    paid_e8s : Nat;
    ledger : ?Principal;
    index : ?Principal;
    ledger_wasm_hash : ?Blob;
    index_wasm_hash : ?Blob;
    controllers : [Principal];
    registration_proposal : ?Nat64;
    status : LaunchStatus;
    steps : [(Text, Int)];
  };
  /// A page of launches, newest first: all, or one creator's. `before`: ids below this one (the
  /// `next` of the previous page); `limit`: at most 50 (0 = 20).
  public type LaunchPageArgs = { creator : ?Principal; before : ?Nat; limit : Nat };
  public type LaunchPage = { total : Nat; items : [LaunchSummary]; next : ?Nat };

  public type Config = {
    ledger_wasm_hash : ?Blob;
    index_wasm_hash : ?Blob;
    ledger_wasm_bytes : Nat; // 0 until fetched
    index_wasm_bytes : Nat;
    creation_fee_e8s : Nat;
    premium_creation_fee_e8s : Nat; // for Sneed Premium members
    sneed_dao_control_fee_e8s : Nat; // added when control is handed to Sneed DAO
    index_creation_fee_e8s : Nat;    // an index for an existing ledger
    premium_index_creation_fee_e8s : Nat;
    sneed_premium : ?Principal;     // the membership canister asked (none: everybody pays the standard fee)
    ledger_cycles : Nat;
    index_cycles : Nat;
    fee_destination : Account;
    cycle_reserve : Nat;
    paused : Bool;
    guardians : [Principal];  // custody canisters a creator may hand control to (#guardian)
    follow_nns : Bool;        // the wasm hashes track the NNS's latest SNS version (daily); false when the DAO pinned them
    wasm_last_check : Int;    // when the NNS was last asked (ns, 0 never)
    wasm_last_refresh : Int;  // when the hashes last changed (ns)
    wasm_last_error : ?Text;
  };
  public type ConfigUpdate = {
    creation_fee_e8s : ?Nat;
    premium_creation_fee_e8s : ?Nat;
    sneed_dao_control_fee_e8s : ?Nat;
    index_creation_fee_e8s : ?Nat;
    premium_index_creation_fee_e8s : ?Nat;
    ledger_cycles : ?Nat;
    index_cycles : ?Nat;
    fee_destination : ?Account;
    cycle_reserve : ?Nat;
    paused : ?Bool;
    follow_nns : ?Bool;
    guardians : ?[Principal];
  };

  // ---- other canisters ----
  public type TransferFromArgs = {
    spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64;
  };
  public type TransferFromError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #InsufficientAllowance : { allowance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  public type TransferArgs = { from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat }; #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  public type IcpLedger = actor {
    icrc1_fee : shared query () -> async Nat;
    icrc1_balance_of : shared query (Account) -> async Nat;
    icrc1_transfer : shared (TransferArgs) -> async { #Ok : Nat; #Err : TransferError };
    icrc2_transfer_from : shared (TransferFromArgs) -> async { #Ok : Nat; #Err : TransferFromError };
  };
  public type NotifyError = {
    #Refunded : { block_index : ?Nat64; reason : Text }; #InvalidTransaction : Text; #Other : { error_message : Text; error_code : Nat64 };
    #Processing; #TransactionTooOld : Nat64;
  };
  public type Cmc = actor {
    notify_top_up : shared ({ block_index : Nat64; canister_id : Principal }) -> async { #Ok : Nat; #Err : NotifyError };
    get_icp_xdr_conversion_rate : shared query () -> async { data : { xdr_permyriad_per_icp : Nat64; timestamp_seconds : Nat64 }; hash_tree : Blob; certificate : Blob };
  };
  /// SneedApp keeps each user's list of minted canisters; the pad adds its ledgers there so
  /// they show up in the wallet like any SneedApp mint (the pad must be an authorized caller).
  public type AnyLedger = actor { icrc1_symbol : shared query () -> async Text };
  public type SneedApp = actor {
    registerCanisterFor : shared (Principal, Principal, Text) -> async { #Ok; #Err : Text };
  };
  public type SnsWasmCanister = actor {
    get_wasm : shared query ({ hash : Blob }) -> async { wasm : ?{ wasm : Blob; canister_type : Int32; proposal_id : ?Nat64 } };
    /// The latest NNS-approved SNS version as (canister type, hex hash) pairs: "Ledger", "Index", ...
    get_latest_sns_version_pretty : shared query (Null) -> async [(Text, Text)];
    list_deployed_snses : shared query ({}) -> async { instances : [{ root_canister_id : ?Principal }] };
  };
  public type CanisterSettings = {
    controllers : ?[Principal];
    compute_allocation : ?Nat;
    memory_allocation : ?Nat;
    freezing_threshold : ?Nat;
  };
  public type Management = actor {
    create_canister : shared ({ settings : ?CanisterSettings; sender_canister_version : ?Nat64 }) -> async { canister_id : Principal };
    install_code : shared ({ mode : { #install; #reinstall; #upgrade : ?{ skip_pre_upgrade : ?Bool } }; canister_id : Principal; wasm_module : Blob; arg : Blob; sender_canister_version : ?Nat64 }) -> async ();
    update_settings : shared ({ canister_id : Principal; settings : CanisterSettings; sender_canister_version : ?Nat64 }) -> async ();
  };

  // ---- special prices (spec/special_prices.md) ----
  /// Overrides of the pad's fees: the admin price and each partner's prices. Null = no special price for that fee.
  public type Prices = { creation_fee_e8s : ?Nat; index_creation_fee_e8s : ?Nat; sneed_dao_control_fee_e8s : ?Nat };
  public type Tier = { #regular; #premium; #admin; #partner };
  /// Which price a launch paid: for its creation fee (token or index) and for its handover fee.
  public type PriceTiers = { creation_fee : Tier; control_fee : Tier };
};
