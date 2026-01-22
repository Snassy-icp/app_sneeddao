import Time "mo:base/Time";
import Result "mo:base/Result";

module {
    // ============================================
    // CORE TYPES
    // ============================================
    
    /// Membership information for a principal
    public type Membership = {
        principal : Principal;
        expiration : Time.Time;  // Nanoseconds since epoch
        lastUpdated : Time.Time;
    };
    
    /// Membership status returned to external callers
    public type MembershipStatus = {
        #Active : { expiration : Time.Time };
        #Expired : { expiredAt : Time.Time };
        #NotFound;
    };
    
    // ============================================
    // PRICING TIERS
    // ============================================
    
    /// ICP payment tier - how much ICP buys how much membership duration
    public type IcpTier = {
        amountE8s : Nat;        // Amount in e8s (1 ICP = 100_000_000 e8s)
        durationNs : Nat;       // Duration in nanoseconds
        name : Text;            // Display name (e.g., "1 Month", "1 Year")
        active : Bool;
    };
    
    /// Voting power tier - how much VP grants how much membership duration
    public type VotingPowerTier = {
        minVotingPowerE8s : Nat;  // Minimum voting power in e8s
        durationNs : Nat;          // Duration granted in nanoseconds
        name : Text;               // Display name
        active : Bool;
    };
    
    // ============================================
    // ICRC1 TYPES
    // ============================================
    
    public type Subaccount = Blob;
    
    public type Account = {
        owner : Principal;
        subaccount : ?Subaccount;
    };
    
    public type TransferArg = {
        to : Account;
        fee : ?Nat;
        memo : ?Blob;
        from_subaccount : ?Subaccount;
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
    };
    
    // ============================================
    // SNS TYPES (for Sneed staking verification)
    // ============================================
    
    public type NeuronId = { id : Blob };
    
    public type NeuronPermission = {
        principal : ?Principal;
        permission_type : [Int32];
    };
    
    public type DissolveState = {
        #DissolveDelaySeconds : Nat64;
        #WhenDissolvedTimestampSeconds : Nat64;
    };
    
    public type DisburseMaturityInProgress = {
        timestamp_of_disbursement_seconds : Nat64;
        amount_e8s : Nat64;
        account_to_disburse_to : ?Account;
        finalize_disbursement_timestamp_seconds : ?Nat64;
    };
    
    public type Followees = { followees : [NeuronId] };
    
    public type Neuron = {
        id : ?NeuronId;
        staked_maturity_e8s_equivalent : ?Nat64;
        permissions : [NeuronPermission];
        maturity_e8s_equivalent : Nat64;
        cached_neuron_stake_e8s : Nat64;
        created_timestamp_seconds : Nat64;
        source_nns_neuron_id : ?Nat64;
        auto_stake_maturity : ?Bool;
        aging_since_timestamp_seconds : Nat64;
        dissolve_state : ?DissolveState;
        voting_power_percentage_multiplier : Nat64;
        vesting_period_seconds : ?Nat64;
        disburse_maturity_in_progress : [DisburseMaturityInProgress];
        followees : [(Nat64, Followees)];
        neuron_fees_e8s : Nat64;
    };
    
    public type ListNeurons = {
        of_principal : ?Principal;
        limit : Nat32;
        start_page_at : ?NeuronId;
    };
    
    public type ListNeuronsResponse = { neurons : [Neuron] };
    
    public type NervousSystemParameters = {
        default_followees : ?{
            followees : [(Nat64, { followees : [{ id : Blob }] })];
        };
        max_dissolve_delay_seconds : ?Nat64;
        max_dissolve_delay_bonus_percentage : ?Nat64;
        max_followees_per_function : ?Nat64;
        automatically_advance_target_version : ?Bool;
        neuron_claimer_permissions : ?{ permissions : [Int32] };
        neuron_minimum_stake_e8s : ?Nat64;
        max_neuron_age_for_age_bonus : ?Nat64;
        initial_voting_period_seconds : ?Nat64;
        neuron_minimum_dissolve_delay_to_vote_seconds : ?Nat64;
        reject_cost_e8s : ?Nat64;
        max_proposals_to_keep_per_action : ?Nat32;
        wait_for_quiet_deadline_increase_seconds : ?Nat64;
        max_number_of_neurons : ?Nat64;
        transaction_fee_e8s : ?Nat64;
        max_number_of_proposals_with_ballots : ?Nat64;
        max_age_bonus_percentage : ?Nat64;
        neuron_grantable_permissions : ?{ permissions : [Int32] };
        voting_rewards_parameters : ?{
            final_reward_rate_basis_points : ?Nat64;
            initial_reward_rate_basis_points : ?Nat64;
            reward_rate_transition_duration_seconds : ?Nat64;
            round_duration_seconds : ?Nat64;
        };
        maturity_modulation_disabled : ?Bool;
        max_number_of_principals_per_neuron : ?Nat64;
    };
    
    public type SnsGovernance = actor {
        list_neurons : shared query ListNeurons -> async ListNeuronsResponse;
        get_nervous_system_parameters : shared () -> async NervousSystemParameters;
    };
    
    // ============================================
    // RESULT TYPES
    // ============================================
    
    public type PurchaseError = {
        #NotAuthorized;
        #InsufficientPayment : { required : Nat; received : Nat };
        #InvalidTier;
        #TierNotActive;
        #TransferFailed : Text;
        #InternalError : Text;
    };
    
    public type ClaimError = {
        #NotAuthorized;
        #NoEligibleNeurons;
        #InsufficientVotingPower : { required : Nat; found : Nat };
        #NoActiveTiers;
        #AlreadyClaimedRecently;  // Prevent spam
        #InternalError : Text;
    };
    
    public type AdminError = {
        #NotAuthorized;
        #InvalidInput : Text;
        #NotFound;
    };
    
    public type PurchaseResult = Result.Result<Membership, PurchaseError>;
    public type ClaimResult = Result.Result<Membership, ClaimError>;
    public type AdminResult<T> = Result.Result<T, AdminError>;
    
    // ============================================
    // CONFIGURATION
    // ============================================
    
    public type Config = {
        admins : [Principal];
        // ICP ledger canister ID (mainnet: ryjl3-tyaaa-aaaaa-aaaba-cai)
        icpLedgerId : Principal;
        // Sneed SNS governance canister ID (mainnet: fi3zi-fyaaa-aaaaq-aachq-cai)
        sneedGovernanceId : Principal;
        // Account to receive ICP payments
        paymentRecipient : Account;
        // Minimum time between VP claims (prevents spam)
        minClaimIntervalNs : Nat;
    };
    
    // ============================================
    // TIME CONSTANTS
    // ============================================
    
    // Nanoseconds per unit of time (all values are static literals)
    public let NS_PER_SECOND : Nat = 1_000_000_000;
    public let NS_PER_MINUTE : Nat = 60_000_000_000;
    public let NS_PER_HOUR : Nat = 3_600_000_000_000;
    public let NS_PER_DAY : Nat = 86_400_000_000_000;
    public let NS_PER_WEEK : Nat = 604_800_000_000_000;
    public let NS_PER_MONTH : Nat = 2_592_000_000_000_000;  // 30 days
    public let NS_PER_YEAR : Nat = 31_536_000_000_000_000;  // 365 days
    
    // ICP e8s constants
    public let E8S_PER_ICP : Nat = 100_000_000;
    
    // Well-known canister IDs as text (to be parsed in actor)
    public let ICP_LEDGER_ID_TEXT : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
    public let SNEED_GOVERNANCE_ID_TEXT : Text = "fi3zi-fyaaa-aaaaq-aachq-cai";
    
    // Default minimum claim interval (24 hours)
    public let DEFAULT_MIN_CLAIM_INTERVAL_NS : Nat = 86_400_000_000_000;
};

