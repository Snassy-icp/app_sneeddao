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
  public type ControlChoice = { #keep; #blackhole; #sneed_dao };
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
  public type Config = {
    ledger_wasm_hash : ?Blob;
    index_wasm_hash : ?Blob;
    ledger_wasm_bytes : Nat; // 0 until fetched
    index_wasm_bytes : Nat;
    creation_fee_e8s : Nat;
    premium_creation_fee_e8s : Nat; // for Sneed Premium members
    sneed_dao_control_fee_e8s : Nat; // added when control is handed to Sneed DAO
    sneed_premium : ?Principal;     // the membership canister asked (none: everybody pays the standard fee)
    ledger_cycles : Nat;
    index_cycles : Nat;
    fee_destination : Account;
    cycle_reserve : Nat;
    paused : Bool;
    follow_nns : Bool;        // the wasm hashes track the NNS's latest SNS version (daily); false when the DAO pinned them
    wasm_last_check : Int;    // when the NNS was last asked (ns, 0 never)
    wasm_last_refresh : Int;  // when the hashes last changed (ns)
    wasm_last_error : ?Text;
  };
  public type ConfigUpdate = {
    creation_fee_e8s : ?Nat;
    premium_creation_fee_e8s : ?Nat;
    sneed_dao_control_fee_e8s : ?Nat;
    ledger_cycles : ?Nat;
    index_cycles : ?Nat;
    fee_destination : ?Account;
    cycle_reserve : ?Nat;
    paused : ?Bool;
    follow_nns : ?Bool;
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
  public type SneedApp = actor {
    registerCanisterFor : shared (Principal, Principal, Text) -> async { #Ok; #Err : Text };
  };
  public type SnsWasmCanister = actor {
    get_wasm : shared query ({ hash : Blob }) -> async { wasm : ?{ wasm : Blob; canister_type : Int32; proposal_id : ?Nat64 } };
    /// The latest NNS-approved SNS version as (canister type, hex hash) pairs: "Ledger", "Index", ...
    get_latest_sns_version_pretty : shared query (Null) -> async [(Text, Text)];
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
};
