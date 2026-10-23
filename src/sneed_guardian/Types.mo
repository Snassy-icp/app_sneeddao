/// sneed_guardian types: a custody canister that is the controller of ledger
/// suite canisters on behalf of one or more DAOs. See spec/custody.md.
module {
  public type Account = { owner : Principal; subaccount : ?Blob };

  public type Kind = { #ledger; #index; #archive };

  public type Policy = {
    guardians : [Principal];
    vetoes_to_block : Nat; // 0 = vetoes off
    oks_required : Nat; // 0 = no go-aheads needed
    window_ns : Nat; // an approved op waits this long for vetoes
    auto_upgrade : Bool;
  };

  public type Status = {
    at : Int;
    cycles : Nat;
    memory_size : Nat;
    module_hash : ?Blob;
    controllers : [Principal];
    running : Text; // "running" | "stopping" | "stopped"
    idle_cycles_burned_per_day : Nat;
    freezing_threshold : Nat;
    error : ?Text; // the last status read failed with this (the fields are then the previous reading)
  };

  public type Child = {
    canister_id : Principal;
    kind : Kind;
    suite : ?Principal; // the ledger this index or archive belongs to
    title : Text;
    policy : Policy;
    registered_at : Int;
    registered_by : Principal;
    status : ?Status;
    last_upgrade : ?{ at : Int; from : ?Blob; to : Blob; by : Text }; // "auto" or an op id
    last_upgrade_error : ?Text;
  };

  public type ConfigUpdate = {
    op_fee_e8s : ?Nat;
    premium_op_fee_e8s : ?Nat;
    fee_destination : ?Account;
    op_ttl_ns : ?Nat;
    self_window_ns : ?Nat;
    status_interval_s : ?Nat;
    low_cycles_threshold : ?Nat;
    cycle_reserve : ?Nat;
    paused : ?Bool;
    approve_function_id : ??Nat64; // the DAO's generic function that calls approve_op (null = not registered yet)
  };

  public type OpKind = {
    #set_controllers : [Principal];
    #install : { hash : Blob; arg : ?Blob };
    #set_policy : Policy;
    #set_config : ConfigUpdate;
    #set_approvers : { approvers : [Principal]; threshold : Nat };
  };

  public type OpState = {
    #pending;
    #approved : Int;
    #vetoed;
    #executed : Int;
    #failed : Text;
    #expired;
    #cancelled;
  };

  public type Op = {
    id : Nat;
    child : Principal; // the guardian itself for #set_config / #set_approvers
    kind : OpKind;
    staged_by : Principal;
    staged_at : Int;
    memo : Text;
    payer : Principal; // whom refunds and any surplus in the op's payment subaccount go to
    fee_e8s : Nat; // the fee due (0 for ops on the guardian itself), paid to the op's payment subaccount
    fee_paid_e8s : Nat; // swept to the fee destination at execution
    refunded_e8s : Nat;
    approvals : [Principal];
    oks : [Principal];
    vetoes : [Principal];
    state : OpState;
  };

  /// An op as the lists show it: an install's upgrade argument is given by size and SHA-256 only
  /// (the bytes come with get_op), so a page of ops stays small.
  public type OpKindSummary = {
    #set_controllers : [Principal];
    #install : { hash : Blob; arg_size : ?Nat; arg_sha256 : ?Blob };
    #set_policy : Policy;
    #set_config : ConfigUpdate;
    #set_approvers : { approvers : [Principal]; threshold : Nat };
  };
  public type OpSummary = {
    id : Nat;
    child : Principal;
    kind : OpKindSummary;
    staged_by : Principal;
    staged_at : Int;
    memo : Text;
    payer : Principal;
    fee_e8s : Nat;
    fee_paid_e8s : Nat;
    refunded_e8s : Nat;
    approvals : [Principal];
    oks : [Principal];
    vetoes : [Principal];
    state : OpState;
  };
  /// A page of ops, newest first. `open`: only pending and approved ones; `child`: only ops on that
  /// canister; `before`: ids below this one (the `next` of the previous page); `limit`: at most 100
  /// (0 = 50).
  public type OpPageArgs = { open : Bool; child : ?Principal; before : ?Nat; limit : Nat };
  public type OpPage = { items : [OpSummary]; next : ?Nat };
  /// Anti-spam limits on staging ops.
  public type OpLimits = { max_open_ops_per_caller : Nat; max_install_arg_bytes : Nat; max_page : Nat };

  public type Config = {
    name : Text;
    approvers : [Principal];
    threshold : Nat;
    admins : [Principal];
    approve_function_id : ?Nat64;
    op_fee_e8s : Nat;
    premium_op_fee_e8s : Nat;
    fee_destination : Account;
    sneed_premium : ?Principal;
    icp_ledger : Principal;
    sns_wasm : Principal;
    op_ttl_ns : Nat;
    self_window_ns : Nat;
    status_interval_s : Nat;
    low_cycles_threshold : Nat;
    cycle_reserve : Nat;
    paused : Bool;
    children : Nat;
    ops : Nat;
    blessed : { ledger : [Blob]; index : [Blob]; archive : [Blob] };
    blessed_at : Int;
    blessed_error : ?Text;
    status_last_run : Int;
    own_cycles : Nat;
  };

  /// Install-time configuration: everything a blackholed deployment needs, since nothing
  /// else can set it afterwards (ops can change the fee and timer values).
  public type Init = {
    name : Text;
    approvers : [Principal];
    threshold : Nat;
    archive_controllers : [Principal]; // controllers of the ICRC-3 log's archives, next to the guardian itself
    admins : [Principal]; // may approve ops alone and run the timers; meant for staging, emptied as the deployment matures, [] for a blackholed one
    sneed_premium : ?Principal;
    fee_destination : ?Account;
    icp_ledger : ?Principal; // tests point these at mocks
    sns_wasm : ?Principal;
  };

  public type CyclesRow = {
    canister_id : Principal;
    title : Text;
    kind : Kind;
    cycles : Nat;
    at : Int;
    low : Bool;
    error : ?Text;
  };

  public type Upgradable = {
    canister_id : Principal;
    kind : Kind;
    title : Text;
    current : ?Blob;
    next : Blob;
    auto_upgrade : Bool;
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
    icrc1_balance_of : shared query (Account) -> async Nat;
    icrc1_transfer : shared (TransferArgs) -> async { #Ok : Nat; #Err : TransferError };
  };
  /// Where an op's fee is paid: a subaccount of the guardian that only the guardian can move.
  public type OpPayment = { account : Account; fee_e8s : Nat; amount_to_send_e8s : Nat; paid_e8s : Nat; refunded_e8s : Nat };
  public type SnsVersion = {
    archive_wasm_hash : Blob; root_wasm_hash : Blob; swap_wasm_hash : Blob; ledger_wasm_hash : Blob; governance_wasm_hash : Blob; index_wasm_hash : Blob;
  };
  public type SnsWasmCanister = actor {
    get_wasm : shared query ({ hash : Blob }) -> async { wasm : ?{ wasm : Blob; canister_type : Int32; proposal_id : ?Nat64 } };
    list_upgrade_steps : shared query ({ limit : Nat32; starting_at : ?SnsVersion; sns_governance_canister_id : ?Principal }) -> async { steps : [{ version : ?SnsVersion }] };
  };
  /// The ledger's own list of archives (ICRC ledger suite).
  public type LedgerActor = actor {
    archives : shared query () -> async [{ canister_id : Principal; block_range_start : Nat; block_range_end : Nat }];
  };
  public type CanisterSettings = { controllers : ?[Principal]; compute_allocation : ?Nat; memory_allocation : ?Nat; freezing_threshold : ?Nat };
  public type CanisterStatus = {
    status : { #running; #stopping; #stopped };
    settings : { controllers : [Principal]; compute_allocation : Nat; memory_allocation : Nat; freezing_threshold : Nat };
    module_hash : ?Blob;
    memory_size : Nat;
    cycles : Nat;
    idle_cycles_burned_per_day : Nat;
  };
  public type Management = actor {
    canister_status : shared ({ canister_id : Principal }) -> async CanisterStatus;
    install_code : shared ({ mode : { #install; #reinstall; #upgrade : ?{ skip_pre_upgrade : ?Bool } }; canister_id : Principal; wasm_module : Blob; arg : Blob; sender_canister_version : ?Nat64 }) -> async ();
    update_settings : shared ({ canister_id : Principal; settings : CanisterSettings; sender_canister_version : ?Nat64 }) -> async ();
  };

  // ---- special prices (spec/special_prices.md) ----
  /// Override of the op fee: the admin price and each partner's price. Null = no special price.
  public type Prices = { op_fee_e8s : ?Nat };
  public type Tier = { #regular; #premium; #admin; #partner };
};
