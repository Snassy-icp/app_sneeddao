import List "mo:base/List";
import HashMap "mo:base/HashMap";
import Int "mo:base/Int";

module {
    // state management types
    public type PrincipalSwapCanisterMap = HashMap.HashMap<Principal, List.List<Principal>>;
    public type PrincipalLedgerCanisterMap = HashMap.HashMap<Principal, List.List<Principal>>;
    public type PrincipalTrackedCanisterMap = HashMap.HashMap<Principal, List.List<Principal>>;
    public type StablePrincipalSwapCanisters = [(Principal, [Principal])];
    public type StablePrincipalLedgerCanisters = [(Principal, [Principal])];
    public type StablePrincipalTrackedCanisters = [(Principal, [Principal])];

    // Canister Groups - hierarchical grouping of canisters
    // A group can contain canister IDs and nested subgroups
    public type CanisterGroup = {
        id: Text;           // Unique identifier for the group
        name: Text;         // Display name
        canisters: [Principal];  // Canister IDs in this group
        subgroups: [CanisterGroup];  // Nested groups
    };
    
    // Root structure for a user's canister groups
    public type CanisterGroupsRoot = {
        groups: [CanisterGroup];  // Top-level groups
        ungrouped: [Principal];   // Canisters not in any group
    };
    
    public type PrincipalCanisterGroupsMap = HashMap.HashMap<Principal, CanisterGroupsRoot>;
    public type StablePrincipalCanisterGroups = [(Principal, CanisterGroupsRoot)];

    // Wallet Layout - user's preferred ordering for wallet sections
    public type WalletLayout = {
        tokens: [Principal];        // Ordered ledger canister IDs
        positions: [Principal];     // Ordered swap canister IDs
        apps: [Principal];          // Ordered tracked canister IDs
        sneedapp: [Principal];      // Ordered sneedapp canister IDs
    };

    public type PrincipalWalletLayoutMap = HashMap.HashMap<Principal, WalletLayout>;
    public type StablePrincipalWalletLayout = [(Principal, WalletLayout)];

    public type State = object {
        principal_swap_canisters: PrincipalSwapCanisterMap;
        principal_ledger_canisters: PrincipalLedgerCanisterMap;
        principal_tracked_canisters: PrincipalTrackedCanisterMap;
    };

    // User settings (each setting stored separately in backend)
    public type UserSettings = {
        principal_color_coding: Bool;
        neuron_color_coding: Bool;
        show_vp_bar: Bool;
        show_header_notifications: Bool;
        collectibles_threshold: Float;
        expand_quick_links_on_desktop: Bool;
        particle_effects_enabled: Bool;
        neuron_manager_cycle_threshold_red: Nat;
        neuron_manager_cycle_threshold_orange: Nat;
        canister_manager_cycle_threshold_red: Nat;
        canister_manager_cycle_threshold_orange: Nat;
        frontend_auto_update_enabled: Bool;
        frontend_clear_cache_on_update: Bool;
        frontend_update_check_interval_sec: Nat;
        frontend_update_countdown_sec: Nat;
        swap_slippage_tolerance: Float;
        always_show_remove_token: Bool;
        // Per-notification-type visibility settings
        notify_replies: Bool;
        notify_tips: Bool;
        notify_messages: Bool;
        notify_collectibles: Bool;
        notify_votable_proposals: Bool;
        notify_outdated_bots: Bool;
        notify_low_cycles: Bool;
        notify_bot_chores: Bool;
        notify_bot_log_errors: Bool;
        notify_bot_log_warnings: Bool;
        notify_updates: Bool;
    };

    public type UserSettingsUpdate = {
        principal_color_coding: ?Bool;
        neuron_color_coding: ?Bool;
        show_vp_bar: ?Bool;
        show_header_notifications: ?Bool;
        collectibles_threshold: ?Float;
        expand_quick_links_on_desktop: ?Bool;
        particle_effects_enabled: ?Bool;
        neuron_manager_cycle_threshold_red: ?Nat;
        neuron_manager_cycle_threshold_orange: ?Nat;
        canister_manager_cycle_threshold_red: ?Nat;
        canister_manager_cycle_threshold_orange: ?Nat;
        frontend_auto_update_enabled: ?Bool;
        frontend_clear_cache_on_update: ?Bool;
        frontend_update_check_interval_sec: ?Nat;
        frontend_update_countdown_sec: ?Nat;
        swap_slippage_tolerance: ?Float;
        always_show_remove_token: ?Bool;
        // Per-notification-type visibility settings
        notify_replies: ?Bool;
        notify_tips: ?Bool;
        notify_messages: ?Bool;
        notify_collectibles: ?Bool;
        notify_votable_proposals: ?Bool;
        notify_outdated_bots: ?Bool;
        notify_low_cycles: ?Bool;
        notify_bot_chores: ?Bool;
        notify_bot_log_errors: ?Bool;
        notify_bot_log_warnings: ?Bool;
        notify_updates: ?Bool;
    };

    // token metadata types
    public type TokenMetaValue = { #Int : Int; #Nat : Nat; #Blob : Blob; #Text : Text };
    public type TokenMeta = {
        token0 : [(Text, TokenMetaValue)];
        token1 : [(Text, TokenMetaValue)];
    };

    public type Subaccount = [Nat8];
    public type Balance = Nat;
    public type TxIndex = Nat;
    public type Timestamp = Nat64;


    public type Account = {
        owner: Principal;
        subaccount: ?Subaccount;
    };
    
    public type TransferArgs = {
        from_subaccount : ?Subaccount;
        to : Account;
        amount : Balance;
        fee : ?Balance;
        memo : ?Blob;
        created_at_time : ?Nat64;
    };

    public type TransferResult = {
        #Ok : TxIndex;
        #Err : TransferError;
    };

    public type TimeError = {
        #TooOld;
        #CreatedInFuture : { ledger_time : Timestamp };
    };

    public type TransferError = TimeError or {
        #BadFee : { expected_fee : Balance };
        #BadBurn : { min_burn_amount : Balance };
        #InsufficientFunds : { balance : Balance };
        #Duplicate : { duplicate_of : TxIndex };
        #TemporarilyUnavailable;
        #GenericError : { error_code : Nat; message : Text };
    };

    public type TransferPositionResult = { #ok : Bool; #err : TransferPositionError };

    type TransferPositionError = {
        #CommonError;
        #InternalError: Text;
        #UnsupportedToken: Text;
        #InsufficientFunds;
    };
    
    public type SwapRunnerTokenMetadata = {
        decimals: ?Nat8;
        fee: ?Nat;
        hasLogo: Bool;
        name: ?Text;
        standard: Text;
        symbol: ?Text;
    };

    // Neuron name types
    public type NeuronId = { id : Blob };
    public type NeuronName = {
        sns_root_canister_id : Principal;
        neuron_id : NeuronId;
        name : Text;
        verified : Bool;
    };

    // Neuron nickname types
    public type NeuronNickname = {
        sns_root_canister_id : Principal;
        neuron_id : NeuronId;
        nickname : Text;
    };

    public type NeuronNameKey = {
        sns_root_canister_id : Principal;
        neuron_id : NeuronId;
    };

    public type Neuron = {
        id : ?NeuronId;
        permissions : [(Principal, [Int32])];
    };

    // Partner types
    public type PartnerLink = {
        title : Text;
        url : Text;
    };

    public type Partner = {
        id : Nat;
        name : Text;
        logo_url : Text;
        description : Text;
        links : [PartnerLink];
        index : ?Nat;
        created_at : Int;
        updated_at : Int;
    };

    // Project types
    public type ProjectLink = {
        title : Text;
        url : Text;
    };

    public type ProjectType = {
        #product;
        #project;
        #fork;
    };

    public type Project = {
        id : Nat;
        name : Text;
        logo_url : ?Text;
        description : Text;
        project_type : ProjectType;
        links : [ProjectLink];
        index : ?Nat;
        created_at : Int;
        updated_at : Int;
    };

    // Canister info types for IC management canister
    public type CanisterInfoRequest = {
        canister_id : Principal;
        num_requested_changes : ?Nat64;
    };

    public type CanisterChange = {
        timestamp_nanos : Nat64;
        canister_version : Nat64;
        origin : CanisterChangeOrigin;
        details : CanisterChangeDetails;
    };

    public type CanisterChangeOrigin = {
        #from_user : { user_id : Principal };
        #from_canister : { canister_id : Principal; canister_version : ?Nat64 };
    };

    public type CanisterChangeDetails = {
        #creation : { controllers : [Principal] };
        #code_uninstall;
        #code_deployment : { mode : { #install; #reinstall; #upgrade } ; module_hash : Blob };
        #controllers_change : { controllers : [Principal] };
    };

    public type CanisterInfoResponse = {
        total_num_changes : Nat64;
        recent_changes : [CanisterChange];
        module_hash : ?Blob;
        controllers : [Principal];
    };
};