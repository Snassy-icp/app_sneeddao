import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Nat64 "mo:base/Nat64";
import Text "mo:base/Text";

module {

    // ============================================
    // VERSION
    // ============================================

    public type Version = {
        major: Nat;
        minor: Nat;
        patch: Nat;
    };

    // Official version info for tracking known canister WASM versions
    public type OfficialVersion = {
        major: Nat;
        minor: Nat;
        patch: Nat;
        wasmHash: Text;      // Hex-encoded SHA256 hash of the WASM module
        wasmUrl: Text;       // URL to download the WASM file
        sourceUrl: Text;     // URL to the source code (e.g., GitHub release)
    };

    // ============================================
    // NNS GOVERNANCE TYPES
    // ============================================

    // Neuron ID - the unique identifier for a neuron
    public type NeuronId = { id: Nat64 };

    // Proposal ID
    public type ProposalId = { id: Nat64 };

    // Account identifier (legacy 32-byte format used by NNS)
    public type AccountIdentifier = Blob;

    // Subaccount (32 bytes)
    public type Subaccount = Blob;

    // ICRC1 Account (used by ledger)
    public type Account = {
        owner: Principal;
        subaccount: ?Blob;
    };

    // Dissolve state of a neuron
    public type DissolveState = {
        #DissolveDelaySeconds: Nat64;
        #WhenDissolvedTimestampSeconds: Nat64;
    };

    // Amount in e8s
    public type Amount = { e8s: Nat64 };

    // Neuron ID or Subaccount for identifying neurons
    public type NeuronIdOrSubaccount = {
        #Subaccount: Blob;
        #NeuronId: NeuronId;
    };

    // Followees for a topic
    public type Followees = {
        followees: [NeuronId];
    };

    // Governance error from NNS
    public type GovernanceError = {
        error_message: Text;
        error_type: Int32;
    };

    // Ballot info for proposals
    public type BallotInfo = {
        vote: Int32;
        proposal_id: ?ProposalId;
    };

    // Known neuron data
    public type KnownNeuronData = {
        name: Text;
        description: ?Text;
    };

    // Known neuron (for list_known_neurons response)
    public type KnownNeuron = {
        id: ?NeuronId;
        known_neuron_data: ?KnownNeuronData;
    };

    public type ListKnownNeuronsResponse = {
        known_neurons: [KnownNeuron];
    };

    // Full Neuron type from governance
    public type Neuron = {
        id: ?NeuronId;
        staked_maturity_e8s_equivalent: ?Nat64;
        controller: ?Principal;
        recent_ballots: [BallotInfo];
        kyc_verified: Bool;
        neuron_type: ?Int32;
        not_for_profit: Bool;
        maturity_e8s_equivalent: Nat64;
        cached_neuron_stake_e8s: Nat64;
        created_timestamp_seconds: Nat64;
        auto_stake_maturity: ?Bool;
        aging_since_timestamp_seconds: Nat64;
        hot_keys: [Principal];
        account: Blob;
        joined_community_fund_timestamp_seconds: ?Nat64;
        dissolve_state: ?DissolveState;
        followees: [(Int32, Followees)];
        neuron_fees_e8s: Nat64;
        visibility: ?Int32;
        transfer: ?NeuronStakeTransfer;
        known_neuron_data: ?KnownNeuronData;
        spawn_at_timestamp_seconds: ?Nat64;
        voting_power_refreshed_timestamp_seconds: ?Nat64;
        deciding_voting_power: ?Nat64;
        potential_voting_power: ?Nat64;
    };

    public type NeuronStakeTransfer = {
        to_subaccount: Blob;
        neuron_stake_e8s: Nat64;
        from: ?Principal;
        memo: Nat64;
        from_subaccount: Blob;
        transfer_timestamp: Nat64;
        block_height: Nat64;
    };

    // Neuron info (public view)
    public type NeuronInfo = {
        dissolve_delay_seconds: Nat64;
        recent_ballots: [BallotInfo];
        neuron_type: ?Int32;
        created_timestamp_seconds: Nat64;
        state: Int32;
        stake_e8s: Nat64;
        joined_community_fund_timestamp_seconds: ?Nat64;
        retrieved_at_timestamp_seconds: Nat64;
        visibility: ?Int32;
        known_neuron_data: ?KnownNeuronData;
        age_seconds: Nat64;
        voting_power: Nat64;
        voting_power_refreshed_timestamp_seconds: ?Nat64;
        deciding_voting_power: ?Nat64;
        potential_voting_power: ?Nat64;
    };

    // ============================================
    // MANAGE NEURON COMMANDS
    // ============================================

    // Configure operation types
    // Note: NNS governance expects empty records {}, not unit variants
    public type Operation = {
        #RemoveHotKey: { hot_key_to_remove: ?Principal };
        #AddHotKey: { new_hot_key: ?Principal };
        #ChangeAutoStakeMaturity: { requested_setting_for_auto_stake_maturity: Bool };
        #StopDissolving: {};
        #StartDissolving: {};
        #IncreaseDissolveDelay: { additional_dissolve_delay_seconds: Nat32 };
        #SetVisibility: { visibility: ?Int32 };
        #JoinCommunityFund: {};
        #LeaveCommunityFund: {};
        #SetDissolveTimestamp: { dissolve_timestamp_seconds: Nat64 };
    };

    public type Configure = {
        operation: ?Operation;
    };

    public type Spawn = {
        percentage_to_spawn: ?Nat32;
        new_controller: ?Principal;
        nonce: ?Nat64;
    };

    public type Split = {
        amount_e8s: Nat64;
    };

    public type Merge = {
        source_neuron_id: ?NeuronId;
    };

    public type Follow = {
        topic: Int32;
        followees: [NeuronId];
    };

    public type RegisterVote = {
        vote: Int32;
        proposal: ?ProposalId;
    };

    public type Disburse = {
        to_account: ?AccountIdentifier;
        amount: ?Amount;
    };

    public type DisburseToNeuron = {
        dissolve_delay_seconds: Nat64;
        kyc_verified: Bool;
        amount_e8s: Nat64;
        new_controller: ?Principal;
        nonce: Nat64;
    };

    public type StakeMaturity = {
        percentage_to_stake: ?Nat32;
    };

    public type MergeMaturity = {
        percentage_to_merge: Nat32;
    };

    public type DisburseMaturity = {
        percentage_to_disburse: Nat32;
        to_account: ?Account;
    };

    public type ClaimOrRefreshBy = {
        #NeuronIdOrSubaccount;
        #MemoAndController: { controller: ?Principal; memo: Nat64 };
        #Memo: Nat64;
    };

    public type ClaimOrRefresh = {
        by: ?ClaimOrRefreshBy;
    };

    public type RefreshVotingPower = {};

    // Command - the action to perform on a neuron
    public type Command = {
        #Spawn: Spawn;
        #Split: Split;
        #Follow: Follow;
        #ClaimOrRefresh: ClaimOrRefresh;
        #Configure: Configure;
        #RegisterVote: RegisterVote;
        #Merge: Merge;
        #DisburseToNeuron: DisburseToNeuron;
        #MakeProposal: Proposal;
        #StakeMaturity: StakeMaturity;
        #MergeMaturity: MergeMaturity;
        #Disburse: Disburse;
        #RefreshVotingPower: RefreshVotingPower;
        #DisburseMaturity: DisburseMaturity;
    };

    // Proposal (simplified - for making proposals)
    public type Proposal = {
        url: Text;
        title: ?Text;
        action: ?Action;
        summary: Text;
    };

    // Action types (simplified - mainly for motions)
    public type Action = {
        #Motion: { motion_text: Text };
        // Add more action types as needed
    };

    // ManageNeuron request
    public type ManageNeuronRequest = {
        id: ?NeuronId;
        command: ?Command;
        neuron_id_or_subaccount: ?NeuronIdOrSubaccount;
    };

    // Command response variants
    public type SpawnResponse = {
        created_neuron_id: ?NeuronId;
    };

    public type ClaimOrRefreshResponse = {
        refreshed_neuron_id: ?NeuronId;
    };

    public type MergeResponse = {
        target_neuron: ?Neuron;
        source_neuron: ?Neuron;
        target_neuron_info: ?NeuronInfo;
        source_neuron_info: ?NeuronInfo;
    };

    public type MakeProposalResponse = {
        message: ?Text;
        proposal_id: ?ProposalId;
    };

    public type StakeMaturityResponse = {
        maturity_e8s: Nat64;
        staked_maturity_e8s: Nat64;
    };

    public type MergeMaturityResponse = {
        merged_maturity_e8s: Nat64;
        new_stake_e8s: Nat64;
    };

    public type DisburseResponse = {
        transfer_block_height: Nat64;
    };

    public type RefreshVotingPowerResponse = {};

    public type DisburseMaturityResponse = {
        amount_disbursed_e8s: ?Nat64;
    };

    public type CommandResponse = {
        #Error: GovernanceError;
        #Spawn: SpawnResponse;
        #Split: SpawnResponse;
        #Follow: {};
        #ClaimOrRefresh: ClaimOrRefreshResponse;
        #Configure: {};
        #RegisterVote: {};
        #Merge: MergeResponse;
        #DisburseToNeuron: SpawnResponse;
        #MakeProposal: MakeProposalResponse;
        #StakeMaturity: StakeMaturityResponse;
        #MergeMaturity: MergeMaturityResponse;
        #Disburse: DisburseResponse;
        #RefreshVotingPower: RefreshVotingPowerResponse;
        #DisburseMaturity: DisburseMaturityResponse;
    };

    // ManageNeuron response
    public type ManageNeuronResponse = {
        command: ?CommandResponse;
    };

    // ============================================
    // LIST NEURONS
    // ============================================

    public type ListNeurons = {
        neuron_ids: [Nat64];
        include_neurons_readable_by_caller: Bool;
        include_empty_neurons_readable_by_caller: ?Bool;
        include_public_neurons_in_full_neurons: ?Bool;
    };

    public type ListNeuronsResponse = {
        neuron_infos: [(Nat64, NeuronInfo)];
        full_neurons: [Neuron];
    };

    // ============================================
    // CLAIM OR REFRESH FROM ACCOUNT
    // ============================================

    public type ClaimOrRefreshNeuronFromAccount = {
        controller: ?Principal;
        memo: Nat64;
    };

    public type ClaimOrRefreshResult = {
        #Error: GovernanceError;
        #NeuronId: NeuronId;
    };

    public type ClaimOrRefreshNeuronFromAccountResponse = {
        result: ?ClaimOrRefreshResult;
    };

    // ============================================
    // GET NEURON
    // ============================================

    public type GetFullNeuronResult = {
        #Ok: Neuron;
        #Err: GovernanceError;
    };

    public type GetNeuronInfoResult = {
        #Ok: NeuronInfo;
        #Err: GovernanceError;
    };

    // ============================================
    // ICP LEDGER TYPES (ICRC1)
    // ============================================

    public type TransferArg = {
        to: Account;
        fee: ?Nat;
        memo: ?Blob;
        from_subaccount: ?Blob;
        created_at_time: ?Nat64;
        amount: Nat;
    };

    public type TransferError = {
        #GenericError: { message: Text; error_code: Nat };
        #TemporarilyUnavailable;
        #BadBurn: { min_burn_amount: Nat };
        #Duplicate: { duplicate_of: Nat };
        #BadFee: { expected_fee: Nat };
        #CreatedInFuture: { ledger_time: Nat64 };
        #TooOld;
        #InsufficientFunds: { balance: Nat };
    };

    public type TransferResult = {
        #Ok: Nat;
        #Err: TransferError;
    };

    // ============================================
    // NEURON MANAGER TYPES
    // ============================================

    // Result of creating a neuron manager
    public type CreateManagerResult = {
        #Ok: {
            canisterId: Principal;
            accountId: AccountIdentifier;
        };
        #Err: CreateManagerError;
    };

    // Result of staking/creating a neuron
    public type StakeNeuronResult = {
        #Ok: NeuronId;
        #Err: StakeNeuronError;
    };

    public type StakeNeuronError = {
        #InsufficientFunds: { balance: Nat64; required: Nat64 };
        #NeuronAlreadyExists;
        #TransferFailed: Text;
        #GovernanceError: GovernanceError;
        #InvalidDissolveDelay: { min: Nat64; max: Nat64; provided: Nat64 };
    };

    // Generic operation result
    public type OperationResult = {
        #Ok;
        #Err: OperationError;
    };

    public type OperationError = {
        #NoNeuron;
        #NotController;
        #GovernanceError: GovernanceError;
        #InvalidOperation: Text;
        #TransferFailed: Text;
    };

    // Disburse result
    public type DisburseResult = {
        #Ok: { transfer_block_height: Nat64 };
        #Err: OperationError;
    };

    // Spawn result
    public type SpawnResult = {
        #Ok: NeuronId;
        #Err: OperationError;
    };

    // Split result
    public type SplitResult = {
        #Ok: NeuronId;
        #Err: OperationError;
    };

    // Manager canister info (for factory tracking)
    public type ManagerInfo = {
        canisterId: Principal;
        owner: Principal;
        createdAt: Int;
        version: Version;
        neuronId: ?NeuronId;
    };

    // Creation log entry (for factory audit log)
    public type CreationLogEntry = {
        canisterId: Principal;
        caller: Principal;
        createdAt: Int;
        index: Nat; // Sequential index for paging
    };

    // Query parameters for creation log
    public type CreationLogQuery = {
        startIndex: ?Nat;      // Start from this index (for paging)
        limit: ?Nat;           // Max entries to return
        callerFilter: ?Principal;  // Filter by caller
        canisterFilter: ?Principal; // Filter by canister ID
        fromTime: ?Int;        // Filter: created after this time
        toTime: ?Int;          // Filter: created before this time
    };

    // Result for creation log query
    public type CreationLogResult = {
        entries: [CreationLogEntry];
        totalCount: Nat;       // Total matching entries (before paging)
        hasMore: Bool;         // More entries available
    };

    // ============================================
    // TOPIC ENUM (for following)
    // ============================================

    // NNS topics (as Int32 values used by governance)
    public module Topic {
        public let Unspecified: Int32 = 0;
        public let NeuronManagement: Int32 = 1;
        public let ExchangeRate: Int32 = 2;
        public let NetworkEconomics: Int32 = 3;
        public let Governance: Int32 = 4;
        public let NodeAdmin: Int32 = 5;
        public let ParticipantManagement: Int32 = 6;
        public let SubnetManagement: Int32 = 7;
        public let NetworkCanisterManagement: Int32 = 8;
        public let Kyc: Int32 = 9;
        public let NodeProviderRewards: Int32 = 10;
        public let SnsDecentralizationSale: Int32 = 11;
        public let SubnetReplicaVersionManagement: Int32 = 12;
        public let ReplicaVersionManagement: Int32 = 13;
        public let SnsAndCommunityFund: Int32 = 14;
        public let ApiBoundaryNodeManagement: Int32 = 15;
        public let SubnetRental: Int32 = 16;
        public let ProtocolCanisterManagement: Int32 = 17;
        public let ServiceNervousSystemManagement: Int32 = 18;
    };

    // Vote values
    public module Vote {
        public let Unspecified: Int32 = 0;
        public let Yes: Int32 = 1;
        public let No: Int32 = 2;
    };

    // Neuron state values
    public module NeuronState {
        public let Unspecified: Int32 = 0;
        public let Locked: Int32 = 1;
        public let Dissolving: Int32 = 2;
        public let Dissolved: Int32 = 3;
        public let Spawning: Int32 = 4;
    };

    // ============================================
    // GOVERNANCE ACTOR INTERFACE
    // ============================================

    public type GovernanceActor = actor {
        manage_neuron: shared (ManageNeuronRequest) -> async ManageNeuronResponse;
        claim_or_refresh_neuron_from_account: shared (ClaimOrRefreshNeuronFromAccount) -> async ClaimOrRefreshNeuronFromAccountResponse;
        list_neurons: shared query (ListNeurons) -> async ListNeuronsResponse;
        list_known_neurons: shared query () -> async ListKnownNeuronsResponse;
        get_full_neuron: shared query (Nat64) -> async GetFullNeuronResult;
        get_full_neuron_by_id_or_subaccount: shared query (NeuronIdOrSubaccount) -> async GetFullNeuronResult;
        get_neuron_info: shared query (Nat64) -> async GetNeuronInfoResult;
        get_neuron_info_by_id_or_subaccount: shared query (NeuronIdOrSubaccount) -> async GetNeuronInfoResult;
    };

    // ============================================
    // LEDGER ACTOR INTERFACE
    // ============================================

    public type LedgerActor = actor {
        icrc1_balance_of: shared query (Account) -> async Nat;
        icrc1_transfer: shared (TransferArg) -> async TransferResult;
        icrc1_fee: shared query () -> async Nat;
    };

    // ============================================
    // IC MANAGEMENT CANISTER TYPES
    // ============================================

    public type CanisterSettings = {
        controllers: ?[Principal];
        compute_allocation: ?Nat;
        memory_allocation: ?Nat;
        freezing_threshold: ?Nat;
    };

    // Definite canister settings (returned from canister_status)
    public type DefiniteCanisterSettings = {
        controllers: [Principal];
        compute_allocation: Nat;
        memory_allocation: Nat;
        freezing_threshold: Nat;
    };

    public type CreateCanisterArgs = {
        settings: ?CanisterSettings;
    };

    public type CanisterIdRecord = {
        canister_id: Principal;
    };

    public type CanisterStatusArgs = {
        canister_id: Principal;
    };

    public type CanisterStatusResult = {
        status: { #running; #stopping; #stopped };
        settings: DefiniteCanisterSettings;
        module_hash: ?Blob;
        memory_size: Nat;
        cycles: Nat;
        idle_cycles_burned_per_day: Nat;
    };

    public type InstallCodeArgs = {
        mode: { #install; #reinstall; #upgrade };
        canister_id: Principal;
        wasm_module: Blob;
        arg: Blob;
    };

    public type UpdateSettingsArgs = {
        canister_id: Principal;
        settings: CanisterSettings;
    };

    public type ManagementCanister = actor {
        create_canister: shared (CreateCanisterArgs) -> async CanisterIdRecord;
        install_code: shared (InstallCodeArgs) -> async ();
        update_settings: shared (UpdateSettingsArgs) -> async ();
        canister_status: shared (CanisterStatusArgs) -> async CanisterStatusResult;
    };

    // ============================================
    // CMC (CYCLES MINTING CANISTER) TYPES
    // ============================================

    public type NotifyTopUpArg = {
        block_index: Nat64;
        canister_id: Principal;
    };

    public type NotifyError = {
        #Refunded: { block_index: ?Nat64; reason: Text };
        #InvalidTransaction: Text;
        #Other: { error_message: Text; error_code: Nat64 };
        #Processing;
        #TransactionTooOld: Nat64;
    };

    public type NotifyTopUpResult = {
        #Ok: Nat;  // cycles added
        #Err: NotifyError;
    };

    // ICP to XDR conversion rate response from CMC
    public type IcpXdrConversionRate = {
        xdr_permyriad_per_icp: Nat64;  // XDR per ICP * 10000
        timestamp_seconds: Nat64;
    };

    public type IcpXdrConversionRateResponse = {
        data: IcpXdrConversionRate;
        hash_tree: [Nat8];
        certificate: [Nat8];
    };

    public type CmcActor = actor {
        notify_top_up: shared (NotifyTopUpArg) -> async NotifyTopUpResult;
        get_icp_xdr_conversion_rate: shared query () -> async IcpXdrConversionRateResponse;
    };

    // ============================================
    // FACTORY PAYMENT CONFIGURATION
    // ============================================

    // Configuration for paid canister creation
    public type PaymentConfig = {
        // Total ICP to charge for creating a manager (in e8s)
        creationFeeE8s: Nat64;
        // Target cycles to acquire via ICP conversion (calculated dynamically from CMC rate)
        targetCyclesAmount: Nat;
        // Destination for remaining ICP (after cycles conversion)
        feeDestination: Account;
        // Whether payment is required (can be disabled for free mode)
        paymentRequired: Bool;
    };

    // Extended error types for payment-related failures
    public type CreateManagerError = {
        #InsufficientCycles;
        #CanisterCreationFailed: Text;
        #AlreadyExists;
        #NotAuthorized;
        #InsufficientPayment: { required: Nat64; provided: Nat64 };
        #TransferFailed: Text;
        #CyclesTopUpFailed: Text;
    };

    // ============================================
    // CONSTANTS
    // ============================================

    public let GOVERNANCE_CANISTER_ID: Text = "rrkah-fqaaa-aaaaa-aaaaq-cai";
    public let LEDGER_CANISTER_ID: Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
    public let CMC_CANISTER_ID: Text = "rkp4c-7iaaa-aaaaa-aaaca-cai";
    
    public let ICP_FEE: Nat64 = 10_000; // 0.0001 ICP
    public let MIN_STAKE_E8S: Nat64 = 100_000_000; // 1 ICP minimum to create neuron

    public let CURRENT_VERSION: Version = {
        major = 1;
        minor = 0;
        patch = 5;
    };

};

