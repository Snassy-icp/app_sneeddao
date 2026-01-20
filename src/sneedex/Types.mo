import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Blob "mo:base/Blob";
import Result "mo:base/Result";

module {
    // ============================================
    // CORE IDENTIFIERS
    // ============================================
    
    public type OfferId = Nat;
    public type BidId = Nat;
    public type AssetTypeId = Nat;
    
    // ============================================
    // ASSET TYPES - Extensible System
    // ============================================
    
    public type AssetType = {
        id : AssetTypeId;
        name : Text;
        description : Text;
        active : Bool;
    };
    
    // Asset type IDs (well-known)
    public let ASSET_TYPE_CANISTER : AssetTypeId = 0;
    public let ASSET_TYPE_SNS_NEURON : AssetTypeId = 1;
    public let ASSET_TYPE_ICRC1_TOKEN : AssetTypeId = 2;
    
    // ============================================
    // CANISTER KINDS - Extensible System for known canister types
    // ============================================
    
    public type CanisterKindId = Nat;
    
    public type CanisterKind = {
        id : CanisterKindId;
        name : Text;
        description : Text;
        active : Bool;
    };
    
    // Canister kind IDs (well-known)
    public let CANISTER_KIND_UNKNOWN : CanisterKindId = 0;
    public let CANISTER_KIND_ICP_NEURON_MANAGER : CanisterKindId = 1;
    
    // ============================================
    // ICRC1 TYPES
    // ============================================
    
    public type Account = {
        owner : Principal;
        subaccount : ?Blob;
    };
    
    public type TransferArg = {
        to : Account;
        fee : ?Nat;
        memo : ?Blob;
        from_subaccount : ?Blob;
        created_at_time : ?Nat64;
        amount : Nat;
    };
    
    public type TransferError = {
        #GenericError : { message : Text; error_code : Nat };
        #TemporarilyUnavailable;
        #BadBurn : { min_burn_amount : Nat };
        #Duplicate : { duplicate_of : Nat };
        #BadFee : { expected_fee : Nat };
        #CreatedInFuture : { ledger_time : Nat64 };
        #TooOld;
        #InsufficientFunds : { balance : Nat };
    };
    
    public type TransferResult = {
        #Ok : Nat;
        #Err : TransferError;
    };
    
    public type ICRC1Actor = actor {
        icrc1_transfer : shared (TransferArg) -> async TransferResult;
        icrc1_balance_of : shared query (Account) -> async Nat;
        icrc1_fee : shared query () -> async Nat;
        icrc1_decimals : shared query () -> async Nat8;
        icrc1_symbol : shared query () -> async Text;
    };
    
    // ============================================
    // SNS NEURON TYPES
    // ============================================
    
    public type NeuronId = {
        id : Blob;
    };
    
    public type NeuronPermission = {
        principal : ?Principal;
        permission_type : [Int32];
    };
    
    public type DissolveState = {
        #DissolveDelaySeconds : Nat64;
        #WhenDissolvedTimestampSeconds : Nat64;
    };
    
    public type Neuron = {
        id : ?NeuronId;
        permissions : [NeuronPermission];
        cached_neuron_stake_e8s : Nat64;
        maturity_e8s_equivalent : Nat64;
        dissolve_state : ?DissolveState;
        // ... other fields as needed
    };
    
    public type GetNeuron = {
        neuron_id : ?NeuronId;
    };
    
    public type GetNeuronResponse = {
        result : ?{
            #Error : { error_message : Text; error_type : Int32 };
            #Neuron : Neuron;
        };
    };
    
    public type NeuronPermissionList = {
        permissions : [Int32];
    };
    
    public type AddNeuronPermissions = {
        permissions_to_add : ?NeuronPermissionList;
        principal_id : ?Principal;
    };
    
    public type RemoveNeuronPermissions = {
        permissions_to_remove : ?NeuronPermissionList;
        principal_id : ?Principal;
    };
    
    public type ManageNeuron = {
        subaccount : Blob;
        command : ?{
            #AddNeuronPermissions : AddNeuronPermissions;
            #RemoveNeuronPermissions : RemoveNeuronPermissions;
            // Other commands...
        };
    };
    
    public type ManageNeuronResponse = {
        command : ?{
            #Error : { error_message : Text; error_type : Int32 };
            #AddNeuronPermission : {};
            #RemoveNeuronPermission : {};
            // Other responses...
        };
    };
    
    public type SNSGovernanceActor = actor {
        get_neuron : shared query (GetNeuron) -> async GetNeuronResponse;
        manage_neuron : shared (ManageNeuron) -> async ManageNeuronResponse;
    };
    
    // ============================================
    // MANAGEMENT CANISTER TYPES
    // ============================================
    
    public type CanisterSettings = {
        controllers : ?[Principal];
        compute_allocation : ?Nat;
        memory_allocation : ?Nat;
        freezing_threshold : ?Nat;
    };
    
    public type CanisterStatus = {
        status : { #running; #stopping; #stopped };
        settings : {
            controllers : [Principal];
            compute_allocation : Nat;
            memory_allocation : Nat;
            freezing_threshold : Nat;
        };
        module_hash : ?Blob;
        memory_size : Nat;
        cycles : Nat;
        idle_cycles_burned_per_day : Nat;
    };
    
    public type UpdateSettingsArgs = {
        canister_id : Principal;
        settings : CanisterSettings;
    };
    
    public type ManagementActor = actor {
        canister_status : shared ({ canister_id : Principal }) -> async CanisterStatus;
        update_settings : shared (UpdateSettingsArgs) -> async ();
    };
    
    // ============================================
    // ICP NEURON MANAGER TYPES (for verification and display)
    // ============================================
    
    public type NeuronManagerVersion = {
        major : Nat;
        minor : Nat;
        patch : Nat;
    };
    
    // NNS Neuron ID for ICP neurons
    public type ICPNeuronId = { id : Nat64 };
    
    // Amount in e8s
    public type ICPAmount = { e8s : Nat64 };
    
    // Dissolve state of an ICP neuron
    public type ICPDissolveState = {
        #DissolveDelaySeconds : Nat64;
        #WhenDissolvedTimestampSeconds : Nat64;
    };
    
    // Simplified neuron info for display
    public type ICPNeuronInfo = {
        neuron_id : ICPNeuronId;
        cached_neuron_stake_e8s : Nat64;
        dissolve_delay_seconds : Nat64;
        state : Int32; // 1 = locked, 2 = dissolving, 3 = dissolved
        age_seconds : Nat64;
        voting_power : Nat64;
        maturity_e8s_equivalent : Nat64;
    };
    
    // Summary of neuron manager status
    public type NeuronManagerInfo = {
        version : NeuronManagerVersion;
        neuron_count : Nat;
        neurons : [ICPNeuronInfo];
    };
    
    // Actor interface for ICP Neuron Manager verification
    public type ICPNeuronManagerActor = actor {
        getVersion : shared query () -> async NeuronManagerVersion;
        getNeuronCount : shared () -> async Nat;
        getAllNeuronsInfo : shared () -> async [(ICPNeuronId, ?{
            dissolve_delay_seconds : Nat64;
            state : Int32;
            stake_e8s : Nat64;
            age_seconds : Nat64;
            voting_power : Nat64;
            // Additional fields from NeuronInfo that we don't use:
            // recent_ballots, neuron_type, created_timestamp_seconds, etc.
        })];
    };
    
    // Canister info response for frontend display
    public type CanisterInfo = {
        canister_id : Principal;
        status : { #running; #stopping; #stopped };
        controllers : [Principal];
        memory_size : Nat;
        cycles : Nat;
        idle_cycles_burned_per_day : Nat;
        module_hash : ?Blob;
        compute_allocation : Nat;
        memory_allocation : Nat;
        freezing_threshold : Nat;
    };
    
    // ============================================
    // ASSET DEFINITIONS
    // ============================================
    
    // Canister asset - stores controllers snapshot when escrowed
    public type CanisterAsset = {
        canister_id : Principal;
        canister_kind : ?CanisterKindId; // Optional known canister type (0 = unknown, 1 = ICP Neuron Manager, etc.)
        controllers_snapshot : ?[Principal]; // Populated when escrowed
    };
    
    // SNS Neuron asset - stores governance canister and neuron id
    public type SNSNeuronAsset = {
        governance_canister_id : Principal;
        neuron_id : NeuronId;
        hotkeys_snapshot : ?[Principal]; // Populated when escrowed
    };
    
    // ICRC1 Token asset
    public type ICRC1TokenAsset = {
        ledger_canister_id : Principal;
        amount : Nat; // Amount in smallest units (e8s)
    };
    
    // Union type for all assets
    public type Asset = {
        #Canister : CanisterAsset;
        #SNSNeuron : SNSNeuronAsset;
        #ICRC1Token : ICRC1TokenAsset;
    };
    
    // Asset with escrow status
    public type AssetEntry = {
        asset : Asset;
        escrowed : Bool;
    };
    
    // ============================================
    // OFFER STATE MACHINE
    // ============================================
    
    public type OfferState = {
        // Offer is being created, assets can be added
        #Draft;
        // All assets have been declared, waiting for escrow
        #PendingEscrow;
        // All assets are in escrow, offer is live and accepting bids
        #Active;
        // Offer was successfully completed (buyout or accepted bid or expiration with bids)
        #Completed : {
            winning_bid_id : BidId;
            completion_time : Time.Time;
        };
        // Offer expired without any bids
        #Expired;
        // Offer was cancelled by creator before any bids
        #Cancelled;
        // Assets have been reclaimed after expiration/cancellation
        #Reclaimed;
        // Assets have been claimed by winner after completion
        #Claimed;
    };
    
    // ============================================
    // OFFER
    // ============================================
    
    public type Offer = {
        id : OfferId;
        creator : Principal;
        
        // Pricing (all in e8s of the price_token)
        min_bid_price : ?Nat; // Optional minimum bid
        buyout_price : ?Nat;  // Optional instant buyout price
        expiration : ?Time.Time; // Optional expiration time
        
        // Token for pricing
        price_token_ledger : Principal;
        
        // Minimum bid increment as a multiple of the token's transaction fee
        // e.g., if fee is 10000 and this is 10, min increment is 100000
        min_bid_increment_fee_multiple : ?Nat;
        
        // Assets in this offer
        assets : [AssetEntry];
        
        // State
        state : OfferState;
        
        // Access control - if set, only these principals can bid (OTC/private offer)
        approved_bidders : ?[Principal];
        
        // Timestamps
        created_at : Time.Time;
        activated_at : ?Time.Time;
    };
    
    // ============================================
    // BID
    // ============================================
    
    public type BidState = {
        // Bid is pending (tokens transferred to escrow subaccount)
        #Pending;
        // Bid won the offer
        #Won;
        // Bid was outbid or offer ended without this bid winning
        #Lost;
        // Bid tokens have been refunded
        #Refunded;
        // Winning bid tokens have been claimed by seller
        #ClaimedBySeller;
    };
    
    public type Bid = {
        id : BidId;
        offer_id : OfferId;
        bidder : Principal;
        amount : Nat; // Amount in price token e8s
        state : BidState;
        created_at : Time.Time;
        tokens_escrowed : Bool;
    };
    
    // ============================================
    // API REQUEST/RESPONSE TYPES
    // ============================================
    
    public type CreateOfferRequest = {
        min_bid_price : ?Nat;
        buyout_price : ?Nat;
        expiration : ?Time.Time;
        price_token_ledger : Principal;
        approved_bidders : ?[Principal]; // If set, only these principals can bid (OTC/private offer)
        min_bid_increment_fee_multiple : ?Nat; // Min bid increase as multiple of token fee
    };
    
    public type AddAssetRequest = {
        offer_id : OfferId;
        asset : Asset;
    };
    
    public type PlaceBidRequest = {
        offer_id : OfferId;
        amount : Nat;
    };
    
    // ============================================
    // ERROR TYPES
    // ============================================
    
    public type SneedexError = {
        #NotAuthorized;
        #OfferNotFound;
        #BidNotFound;
        #InvalidState : Text;
        #InvalidAsset : Text;
        #EscrowFailed : Text;
        #TransferFailed : Text;
        #InvalidPrice : Text;
        #InvalidExpiration;
        #AssetTypeNotSupported;
        #OfferMustHaveBuyoutOrExpiration;
        #CannotCancelWithBids;
        #BidTooLow : { minimum : Nat };
        #BidIncrementTooSmall : { current_highest : Nat; minimum_next : Nat; required_increment : Nat };
        #InsufficientFunds : { required : Nat; available : Nat };
        #OfferExpired;
        #GovernanceError : Text;
        #CanisterError : Text;
    };
    
    public type Result<T> = Result.Result<T, SneedexError>;
    
    // ============================================
    // VIEW TYPES (for queries)
    // ============================================
    
    public type OfferView = {
        offer : Offer;
        bids : [Bid];
        highest_bid : ?Bid;
    };
    
    public type MarketStats = {
        total_offers : Nat;
        active_offers : Nat;
        completed_offers : Nat;
        total_bids : Nat;
        total_volume_by_token : [(Principal, Nat)]; // ledger -> volume
    };
    
    // ============================================
    // SNS NEURON PERMISSION TYPES (constants)
    // ============================================
    
    // Full owner permissions for SNS neurons
    public let SNS_NEURON_PERMISSION_UNSPECIFIED : Int32 = 0;
    public let SNS_NEURON_PERMISSION_CONFIGURE_DISSOLVE_STATE : Int32 = 1;
    public let SNS_NEURON_PERMISSION_MANAGE_PRINCIPALS : Int32 = 2;
    public let SNS_NEURON_PERMISSION_SUBMIT_PROPOSAL : Int32 = 3;
    public let SNS_NEURON_PERMISSION_VOTE : Int32 = 4;
    public let SNS_NEURON_PERMISSION_DISBURSE : Int32 = 5;
    public let SNS_NEURON_PERMISSION_SPLIT : Int32 = 6;
    public let SNS_NEURON_PERMISSION_MERGE_MATURITY : Int32 = 7;
    public let SNS_NEURON_PERMISSION_DISBURSE_MATURITY : Int32 = 8;
    public let SNS_NEURON_PERMISSION_STAKE_MATURITY : Int32 = 9;
    public let SNS_NEURON_PERMISSION_MANAGE_VOTING_PERMISSION : Int32 = 10;
    
    // All permissions that constitute "owner" level access
    public let FULL_OWNER_PERMISSIONS : [Int32] = [
        SNS_NEURON_PERMISSION_CONFIGURE_DISSOLVE_STATE,
        SNS_NEURON_PERMISSION_MANAGE_PRINCIPALS,
        SNS_NEURON_PERMISSION_SUBMIT_PROPOSAL,
        SNS_NEURON_PERMISSION_VOTE,
        SNS_NEURON_PERMISSION_DISBURSE,
        SNS_NEURON_PERMISSION_SPLIT,
        SNS_NEURON_PERMISSION_MERGE_MATURITY,
        SNS_NEURON_PERMISSION_DISBURSE_MATURITY,
        SNS_NEURON_PERMISSION_STAKE_MATURITY,
        SNS_NEURON_PERMISSION_MANAGE_VOTING_PERMISSION,
    ];
    
    // ============================================
    // SUBACCOUNT UTILITIES
    // ============================================
    
    // Subaccount is 32 bytes
    public let SUBACCOUNT_SIZE : Nat = 32;
    
    // ============================================
    // CONFIGURATION
    // ============================================
    
    public type Config = {
        // Admins who can manage asset types
        admins : [Principal];
        // Minimum offer duration (if expiration is set)
        min_offer_duration_ns : Nat;
        // Maximum number of assets per offer
        max_assets_per_offer : Nat;
    };
    
    public let DEFAULT_CONFIG : Config = {
        admins = [];
        min_offer_duration_ns = 3600_000_000_000; // 1 hour minimum
        max_assets_per_offer = 10;
    };
};

