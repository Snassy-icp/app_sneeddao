import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Nat64 "mo:base/Nat64";
import Nat32 "mo:base/Nat32";
import Int "mo:base/Int";
import Int32 "mo:base/Int32";
import Time "mo:base/Time";
import Array "mo:base/Array";
import Nat8 "mo:base/Nat8";
import Buffer "mo:base/Buffer";
import Text "mo:base/Text";
import Debug "mo:base/Debug";

import Nat "mo:base/Nat";

import T "Types";
import BotkeyPermissions "../BotkeyPermissions";
import BotChoreTypes "../BotChoreTypes";
import BotChoreEngine "../BotChoreEngine";
import BotLogTypes "../BotLogTypes";
import BotLogEngine "../BotLogEngine";
import DistributionTypes "../DistributionTypes";

// This is the actual canister that gets deployed for each user
// No constructor arguments needed - access control uses IC canister controllers

// Note: Previous migration (ChoreConfig gained maxIntervalSeconds: ?Nat) has been applied.
// The deployed canisters already have the full ChoreConfig type.
// Remove stale migration expressions once deployed to avoid compatibility errors.

shared (deployer) persistent actor class NeuronManagerCanister() = this {

    // ============================================
    // STATE
    // ============================================

    var createdAt: Int = Time.now();
    
    // Version is transient - always reflects the compiled WASM version
    transient let currentVersion: T.Version = T.CURRENT_VERSION;

    // Actor references
    transient let governance: T.GovernanceActor = actor(T.GOVERNANCE_CANISTER_ID);
    transient let ledger: T.LedgerActor = actor(T.LEDGER_CANISTER_ID);

    // Hotkey permissions: maps Principal -> list of numeric permission IDs
    // We store numeric IDs (not variants) so we can add new permission types
    // in future upgrades without needing stable variable migration
    var hotkeyPermissions: [(Principal, [Nat])] = [];

    // Bot Chores: stable state for the chore system
    var choreConfigs: [(Text, BotChoreTypes.ChoreConfig)] = [];
    var choreStates: [(Text, BotChoreTypes.ChoreRuntimeState)] = [];
    var choreInstances: [(Text, BotChoreTypes.ChoreInstanceInfo)] = [];

    // Per-instance chore settings (keyed by instanceId)
    // Collect-Maturity: threshold and destination per instance
    var collectMaturitySettings: [(Text, { thresholdE8s: ?Nat64; destination: ?T.Account })] = [];
    // Distribution: lists and next ID counter per instance
    var distributionSettings: [(Text, { lists: [DistributionTypes.DistributionList]; nextListId: Nat })] = [];

    // Bot Log: persistent state for the logging system
    var botLogEntries: [BotLogTypes.LogEntry] = [];
    var botLogNextId: Nat = 0;
    var botLogLevel: Nat = 3; // Info (default)
    var botLogMaxEntries: Nat = 10_000;

    // ============================================
    // PER-INSTANCE SETTINGS HELPERS
    // ============================================

    func getCmSettings(instanceId: Text): { thresholdE8s: ?Nat64; destination: ?T.Account } {
        for ((id, s) in collectMaturitySettings.vals()) {
            if (id == instanceId) return s;
        };
        { thresholdE8s = null; destination = null }
    };

    func setCmSettings(instanceId: Text, s: { thresholdE8s: ?Nat64; destination: ?T.Account }) {
        var found = false;
        let updated = Array.map<(Text, { thresholdE8s: ?Nat64; destination: ?T.Account }), (Text, { thresholdE8s: ?Nat64; destination: ?T.Account })>(
            collectMaturitySettings,
            func((id, old)) { if (id == instanceId) { found := true; (id, s) } else { (id, old) } }
        );
        if (found) { collectMaturitySettings := updated }
        else { collectMaturitySettings := Array.append(collectMaturitySettings, [(instanceId, s)]) };
    };

    func getDistSettings(instanceId: Text): { lists: [DistributionTypes.DistributionList]; nextListId: Nat } {
        for ((id, s) in distributionSettings.vals()) {
            if (id == instanceId) return s;
        };
        { lists = []; nextListId = 1 }
    };

    func setDistSettings(instanceId: Text, s: { lists: [DistributionTypes.DistributionList]; nextListId: Nat }) {
        var found = false;
        let updated = Array.map<(Text, { lists: [DistributionTypes.DistributionList]; nextListId: Nat }), (Text, { lists: [DistributionTypes.DistributionList]; nextListId: Nat })>(
            distributionSettings,
            func((id, old)) { if (id == instanceId) { found := true; (id, s) } else { (id, old) } }
        );
        if (found) { distributionSettings := updated }
        else { distributionSettings := Array.append(distributionSettings, [(instanceId, s)]) };
    };

    // ============================================
    // PERMISSION SYSTEM (using reusable BotkeyPermissions engine)
    // ============================================

    // Full permission map: shared base permissions (0–99) + ICP Staking Bot permissions (100–199).
    transient let PERMISSION_MAP: [(Nat, T.NeuronPermissionType)] = [
        // Shared base permissions (range 0–99)
        (0,   #FullPermissions),
        (1,   #ManagePermissions),
        (2,   #ViewChores),
        (3,   #ViewLogs),
        (4,   #ManageLogs),
        // ICP Staking Bot permissions (range 100–199)
        (100, #ConfigureDissolveState),
        (101, #Vote),
        (102, #MakeProposal),
        (103, #Disburse),
        (104, #Split),
        (105, #MergeMaturity),
        (106, #DisburseMaturity),
        (107, #StakeMaturity),
        (108, #ManageFollowees),
        (109, #Spawn),
        (110, #ManageNeuronHotkeys),
        (111, #StakeNeuron),
        (112, #MergeNeurons),
        (113, #AutoStakeMaturity),
        (114, #ManageVisibility),
        (115, #WithdrawFunds),
        (116, #ViewNeuron),
        (117, #ManageConfirmFollowing),
        (118, #ManageRefreshStake),
        (119, #ManageCollectMaturity),
        (120, #ManageDistributeFunds),
        (121, #ConfigureCollectMaturity),
        (122, #ConfigureDistribution),
    ];

    // Variant-to-ID conversion (shared base + ICP Staking Bot permissions)
    func permissionVariantToId(perm: T.NeuronPermissionType): Nat {
        switch (perm) {
            // Shared base permissions (range 0–99)
            case (#FullPermissions) { 0 };
            case (#ManagePermissions) { 1 };
            case (#ViewChores) { 2 };
            case (#ViewLogs) { 3 };
            case (#ManageLogs) { 4 };
            // ICP Staking Bot permissions (range 100–199)
            case (#ConfigureDissolveState) { 100 };
            case (#Vote) { 101 };
            case (#MakeProposal) { 102 };
            case (#Disburse) { 103 };
            case (#Split) { 104 };
            case (#MergeMaturity) { 105 };
            case (#DisburseMaturity) { 106 };
            case (#StakeMaturity) { 107 };
            case (#ManageFollowees) { 108 };
            case (#Spawn) { 109 };
            case (#ManageNeuronHotkeys) { 110 };
            case (#StakeNeuron) { 111 };
            case (#MergeNeurons) { 112 };
            case (#AutoStakeMaturity) { 113 };
            case (#ManageVisibility) { 114 };
            case (#WithdrawFunds) { 115 };
            case (#ViewNeuron) { 116 };
            case (#ManageConfirmFollowing) { 117 };
            case (#ManageRefreshStake) { 118 };
            case (#ManageCollectMaturity) { 119 };
            case (#ManageDistributeFunds) { 120 };
            case (#ConfigureCollectMaturity) { 121 };
            case (#ConfigureDistribution) { 122 };
        }
    };

    // ID-to-variant conversion (shared base + ICP Staking Bot permissions)
    func permissionIdToVariant(id: Nat): ?T.NeuronPermissionType {
        switch (id) {
            // Shared base permissions (range 0–99)
            case (0)   { ?#FullPermissions };
            case (1)   { ?#ManagePermissions };
            case (2)   { ?#ViewChores };
            case (3)   { ?#ViewLogs };
            case (4)   { ?#ManageLogs };
            // ICP Staking Bot permissions (range 100–199)
            case (100) { ?#ConfigureDissolveState };
            case (101) { ?#Vote };
            case (102) { ?#MakeProposal };
            case (103) { ?#Disburse };
            case (104) { ?#Split };
            case (105) { ?#MergeMaturity };
            case (106) { ?#DisburseMaturity };
            case (107) { ?#StakeMaturity };
            case (108) { ?#ManageFollowees };
            case (109) { ?#Spawn };
            case (110) { ?#ManageNeuronHotkeys };
            case (111) { ?#StakeNeuron };
            case (112) { ?#MergeNeurons };
            case (113) { ?#AutoStakeMaturity };
            case (114) { ?#ManageVisibility };
            case (115) { ?#WithdrawFunds };
            case (116) { ?#ViewNeuron };
            case (117) { ?#ManageConfirmFollowing };
            case (118) { ?#ManageRefreshStake };
            case (119) { ?#ManageCollectMaturity };
            case (120) { ?#ManageDistributeFunds };
            case (121) { ?#ConfigureCollectMaturity };
            case (122) { ?#ConfigureDistribution };
            case (_)   { null };
        }
    };

    // Instantiate the reusable permission engine with this bot's types
    transient let permEngine = BotkeyPermissions.Engine<T.NeuronPermissionType>({
        permissionMap = PERMISSION_MAP;
        variantToId = permissionVariantToId;
        idToVariant = permissionIdToVariant;
    });

    // ============================================
    // BOT LOG SYSTEM
    // ============================================

    // Instantiate the log engine (transient — re-created on each canister start)
    transient let logEngine = BotLogEngine.Engine({
        getEntries = func(): [BotLogTypes.LogEntry] { botLogEntries };
        setEntries = func(e: [BotLogTypes.LogEntry]): () { botLogEntries := e };
        getNextId = func(): Nat { botLogNextId };
        setNextId = func(n: Nat): () { botLogNextId := n };
        getLogLevel = func(): Nat { botLogLevel };
        setLogLevel = func(n: Nat): () { botLogLevel := n };
        maxEntries = botLogMaxEntries;
    });

    // ============================================
    // BOT CHORES SYSTEM (state declarations)
    // ============================================

    // Instantiate the chore engine (transient — re-created on each canister start)
    transient let choreEngine = BotChoreEngine.Engine({
        getConfigs = func(): [(Text, BotChoreTypes.ChoreConfig)] { choreConfigs };
        setConfigs = func(c: [(Text, BotChoreTypes.ChoreConfig)]): () { choreConfigs := c };
        getStates = func(): [(Text, BotChoreTypes.ChoreRuntimeState)] { choreStates };
        setStates = func(s: [(Text, BotChoreTypes.ChoreRuntimeState)]): () { choreStates := s };
        getInstances = func(): [(Text, BotChoreTypes.ChoreInstanceInfo)] { choreInstances };
        setInstances = func(i: [(Text, BotChoreTypes.ChoreInstanceInfo)]): () { choreInstances := i };
        log = ?(func(level: BotChoreTypes.ChoreLogLevel, source: Text, message: Text, tags: [(Text, Text)]): () {
            switch (level) {
                case (#Info) { logEngine.logInfo(source, message, null, tags) };
                case (#Warning) { logEngine.logWarning(source, message, null, tags) };
                case (#Error) { logEngine.logError(source, message, null, tags) };
            };
        });
    });

    // Mutable state for chore closures (transient, reset on upgrade)
    // -- Refresh Stake chore state --
    transient var _rs_neurons: [T.NeuronId] = [];
    transient var _rs_index: Nat = 0;
    // -- Confirm Following chore state --
    transient var _cf_neurons: [T.NeuronId] = [];
    transient var _cf_index: Nat = 0;

    // Convenience wrappers that close over hotkeyPermissions state
    func callerHasPermission(caller: Principal, permissionId: Nat): Bool {
        permEngine.callerHasPermission(caller, permissionId, hotkeyPermissions)
    };

    func assertPermission(caller: Principal, permissionId: Nat) {
        permEngine.assertPermission(caller, permissionId, hotkeyPermissions)
    };

    // Map a chore instance ID to its per-type manage permission ID.
    // Resolves instanceId -> typeId -> permission.
    func choreManagePermission(instanceId: Text): Nat {
        // Look up typeId from instance registry
        let typeId = switch (choreEngine.getInstance(instanceId)) {
            case (?info) { info.typeId };
            case null { instanceId }; // Fallback: assume instanceId = typeId
        };
        switch (typeId) {
            case ("confirm-following") { T.NeuronPermission.ManageConfirmFollowing };
            case ("refresh-stake") { T.NeuronPermission.ManageRefreshStake };
            case ("collect-maturity") { T.NeuronPermission.ManageCollectMaturity };
            case ("distribute-funds") { T.NeuronPermission.ManageDistributeFunds };
            case (_) { Debug.trap("Unknown chore type: " # typeId) };
        }
    };

    // ============================================
    // CANISTER INFO
    // ============================================

    public query func getVersion(): async T.Version {
        currentVersion;
    };

    public query func getCreatedAt(): async Int {
        createdAt;
    };


    // Internal: Get all neurons controlled by this canister from NNS governance
    func listNeuronsInternal(): async [T.Neuron] {
        let selfPrincipal = Principal.fromActor(this);
        let response = await governance.list_neurons({
            neuron_ids = [];
            include_neurons_readable_by_caller = true;
            include_empty_neurons_readable_by_caller = ?false;
            include_public_neurons_in_full_neurons = ?false;
        });
        // Filter to only neurons where this canister is the controller
        Array.filter<T.Neuron>(response.full_neurons, func(n) {
            switch (n.controller) {
                case (?ctrl) { Principal.equal(ctrl, selfPrincipal) };
                case null { false };
            }
        })
    };

    // Get all neurons controlled by this canister from NNS governance
    public shared ({ caller }) func listNeurons(): async [T.Neuron] {
        assertPermission(caller, T.NeuronPermission.ViewNeuron);
        await listNeuronsInternal()
    };

    // Get all neuron IDs controlled by this canister
    public shared ({ caller }) func getNeuronIds(): async [T.NeuronId] {
        assertPermission(caller, T.NeuronPermission.ViewNeuron);
        let managedNeurons = await listNeuronsInternal();
        let result = Buffer.Buffer<T.NeuronId>(managedNeurons.size());
        for (n in managedNeurons.vals()) {
            switch (n.id) {
                case (?nid) { result.add(nid) };
                case null {};
            };
        };
        Buffer.toArray(result)
    };

    // Get count of neurons controlled by this canister
    public shared ({ caller }) func getNeuronCount(): async Nat {
        assertPermission(caller, T.NeuronPermission.ViewNeuron);
        let neurons = await listNeuronsInternal();
        neurons.size()
    };

    // Internal: Check if this canister controls a specific neuron
    func hasNeuronInternal(neuronId: T.NeuronId): async Bool {
        let result = await governance.get_full_neuron(neuronId.id);
        switch (result) {
            case (#Err(_)) { false };
            case (#Ok(neuron)) {
                let selfPrincipal = Principal.fromActor(this);
                switch (neuron.controller) {
                    case (?ctrl) { Principal.equal(ctrl, selfPrincipal) };
                    case null { false };
                }
            }
        }
    };

    // Check if this canister controls a specific neuron
    public shared ({ caller }) func hasNeuron(neuronId: T.NeuronId): async Bool {
        assertPermission(caller, T.NeuronPermission.ViewNeuron);
        await hasNeuronInternal(neuronId)
    };

    // Get this canister's ICP account
    public query func getAccount(): async T.Account {
        {
            owner = Principal.fromActor(this);
            subaccount = null;
        };
    };

    // Get this canister's legacy account identifier
    public query func getAccountId(): async T.AccountIdentifier {
        computeAccountId(Principal.fromActor(this), null);
    };

    // Internal: Get ICP balance
    func getBalanceInternal(): async Nat {
        let account: T.Account = {
            owner = Principal.fromActor(this);
            subaccount = null;
        };
        await ledger.icrc1_balance_of(account);
    };

    // Get ICP balance
    public shared ({ caller }) func getBalance(): async Nat {
        assertPermission(caller, T.NeuronPermission.ViewNeuron);
        await getBalanceInternal()
    };

    // Get a neuron's account by fetching its info from NNS
    // Returns the governance canister as owner with the neuron's subaccount
    public shared ({ caller }) func getNeuronAccount(neuronId: T.NeuronId): async ?T.Account {
        assertPermission(caller, T.NeuronPermission.ViewNeuron);
        let result = await governance.get_full_neuron(neuronId.id);
        switch (result) {
            case (#Err(_)) { null };
            case (#Ok(neuron)) {
                ?{
                    owner = Principal.fromText(T.GOVERNANCE_CANISTER_ID);
                    subaccount = ?neuron.account; // account is the subaccount Blob
                }
            }
        }
    };

    // Get the account where users should send ICP to create a new neuron
    // Returns (governance canister, neuron subaccount, memo to use)
    // User sends ICP to this account, then calls claimNeuronFromDeposit with the memo
    public query func getStakeAccount(memo: Nat64): async { account: T.Account; memo: Nat64 } {
        let selfPrincipal = Principal.fromActor(this);
        let neuronSubaccount = computeNeuronSubaccount(selfPrincipal, memo);
        {
            account = {
                owner = Principal.fromText(T.GOVERNANCE_CANISTER_ID);
                subaccount = ?neuronSubaccount;
            };
            memo = memo;
        }
    };

    // Generate a memo based on current timestamp (convenience function)
    public query func generateMemo(): async Nat64 {
        Nat64.fromNat(Int.abs(Time.now()))
    };


    // ============================================
    // NEURON CREATION
    // ============================================

    // Claim a neuron from a direct deposit to governance
    // User sends ICP to the account returned by getStakeAccount(memo), then calls this
    public shared ({ caller }) func claimNeuronFromDeposit(
        memo: Nat64,
        dissolve_delay_seconds: Nat64
    ): async T.StakeNeuronResult {
        assertPermission(caller, T.NeuronPermission.StakeNeuron);
        logEngine.logInfo("api", "claimNeuronFromDeposit", ?caller, [("memo", Nat64.toText(memo)), ("dissolveDelay", Nat64.toText(dissolve_delay_seconds))]);
        
        let selfPrincipal = Principal.fromActor(this);

        // Claim the neuron using the memo
        let claimRequest: T.ClaimOrRefreshNeuronFromAccount = {
            controller = ?selfPrincipal;
            memo = memo;
        };
        
        let claimResult = await governance.claim_or_refresh_neuron_from_account(claimRequest);
        
        switch (claimResult.result) {
            case null {
                logEngine.logError("api", "claimNeuronFromDeposit: no result from claim", ?caller, [("memo", Nat64.toText(memo))]);
                return #Err(#GovernanceError({ error_message = "No result from claim - no ICP deposited?"; error_type = 0 }));
            };
            case (?#Error(e)) {
                logEngine.logError("api", "claimNeuronFromDeposit: governance error", ?caller, [("error", e.error_message)]);
                return #Err(#GovernanceError(e));
            };
            case (?#NeuronId(nid)) {
                // Neuron claimed - set dissolve delay
                let nowSeconds: Nat64 = Nat64.fromNat(Int.abs(Time.now() / 1_000_000_000));
                let dissolveTimestamp: Nat64 = nowSeconds + dissolve_delay_seconds;
                
                let configResult = await configureNeuron(nid, #SetDissolveTimestamp({
                    dissolve_timestamp_seconds = dissolveTimestamp;
                }));
                
                switch (configResult) {
                    case (#Err(#GovernanceError(ge))) {
                        // Neuron was claimed but dissolve delay failed
                        return #Err(#GovernanceError(ge));
                    };
                    case (#Err(_)) {
                        // Other errors - neuron was still claimed
                        return #Ok(nid);
                    };
                    case (#Ok) {
                        return #Ok(nid);
                    };
                };
            };
        };
    };

    // Increase stake on existing neuron by sending ICP directly to the neuron's account
    // User sends ICP to the neuron account (from getNeuronAccount), then calls this
    public shared ({ caller }) func refreshStakeFromDeposit(neuronId: T.NeuronId): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.StakeNeuron);
        logEngine.logInfo("api", "refreshStakeFromDeposit", ?caller, [("neuronId", Nat64.toText(neuronId.id))]);
        
        // Verify this canister controls the neuron
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            logEngine.logWarning("api", "refreshStakeFromDeposit: neuron not controlled", ?caller, [("neuronId", Nat64.toText(neuronId.id))]);
            return #Err(#NoNeuron);
        };
        
        // Refresh the neuron to pick up the new deposit
        await refreshStakeInternal(neuronId);
    };

    // Legacy method - stakes from canister's ICP balance
    public shared ({ caller }) func stakeNeuron(
        amount_e8s: Nat64,
        dissolve_delay_seconds: Nat64
    ): async T.StakeNeuronResult {
        assertPermission(caller, T.NeuronPermission.StakeNeuron);
        logEngine.logInfo("api", "stakeNeuron", ?caller, [("amount_e8s", Nat64.toText(amount_e8s)), ("dissolveDelay", Nat64.toText(dissolve_delay_seconds))]);
        
        // Note: We don't validate dissolve delay here - let NNS governance enforce the limits
        // This way if they change min/max, we don't need to upgrade all canisters

        // Check balance
        let balance = await getBalanceInternal();
        let required = Nat64.toNat(amount_e8s + T.ICP_FEE);
        if (balance < required) {
            return #Err(#InsufficientFunds({
                balance = Nat64.fromNat(balance);
                required = Nat64.fromNat(required);
            }));
        };

        // Validate minimum stake
        if (amount_e8s < T.MIN_STAKE_E8S) {
            return #Err(#InsufficientFunds({
                balance = amount_e8s;
                required = T.MIN_STAKE_E8S;
            }));
        };

        let selfPrincipal = Principal.fromActor(this);

        // Generate memo from timestamp
        let memo = Nat64.fromNat(Int.abs(Time.now()));
        
        // Compute neuron subaccount
        let neuronSubaccount = computeNeuronSubaccount(selfPrincipal, memo);
        
        // Transfer ICP to governance canister's neuron subaccount
        let transferArg: T.TransferArg = {
            to = {
                owner = Principal.fromText(T.GOVERNANCE_CANISTER_ID);
                subaccount = ?neuronSubaccount;
            };
            fee = ?Nat64.toNat(T.ICP_FEE);
            memo = ?Blob.fromArray(nat64ToBytes(memo));
            from_subaccount = null;
            created_at_time = null;
            amount = Nat64.toNat(amount_e8s);
        };

        let transferResult = await ledger.icrc1_transfer(transferArg);
        
        switch (transferResult) {
            case (#Err(e)) {
                return #Err(#TransferFailed(transferErrorToText(e)));
            };
            case (#Ok(_blockIndex)) {
                // Claim the neuron
                let claimRequest: T.ClaimOrRefreshNeuronFromAccount = {
                    controller = ?selfPrincipal;
                    memo = memo;
                };
                
                let claimResult = await governance.claim_or_refresh_neuron_from_account(claimRequest);
                
                switch (claimResult.result) {
                    case null {
                        return #Err(#GovernanceError({ error_message = "No result from claim"; error_type = 0 }));
                    };
                    case (?#Error(e)) {
                        return #Err(#GovernanceError(e));
                    };
                    case (?#NeuronId(nid)) {
                        // Neuron created - no need to store locally, we'll query NNS to get our neurons
                        
                        // Set dissolve delay using absolute timestamp
                        // Using SetDissolveTimestamp instead of IncreaseDissolveDelay to avoid adding to any default delay
                        let nowSeconds: Nat64 = Nat64.fromNat(Int.abs(Time.now() / 1_000_000_000));
                        let dissolveTimestamp: Nat64 = nowSeconds + dissolve_delay_seconds;
                        
                        let configResult = await configureNeuron(nid, #SetDissolveTimestamp({
                            dissolve_timestamp_seconds = dissolveTimestamp;
                        }));
                        
                        switch (configResult) {
                            case (#Err(#GovernanceError(ge))) {
                                // Neuron was created but dissolve delay failed
                                return #Err(#GovernanceError(ge));
                            };
                            case (#Err(_)) {
                                // Other errors - neuron was still created
                                return #Ok(nid);
                            };
                            case (#Ok) {
                                return #Ok(nid);
                            };
                        };
                    };
                };
            };
        };
    };

    // ============================================
    // NEURON INFORMATION
    // ============================================

    public shared ({ caller }) func getNeuronInfo(neuronId: T.NeuronId): async ?T.NeuronInfo {
        assertPermission(caller, T.NeuronPermission.ViewNeuron);
        // First verify this canister controls the neuron
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return null;
        };
        
        let result = await governance.get_neuron_info(neuronId.id);
        switch (result) {
            case (#Ok(info)) { ?info };
            case (#Err(_)) { null };
        };
    };

    public shared ({ caller }) func getFullNeuron(neuronId: T.NeuronId): async ?T.Neuron {
        assertPermission(caller, T.NeuronPermission.ViewNeuron);
        // Verify this canister controls the neuron
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return null;
        };
        
        let result = await governance.get_full_neuron(neuronId.id);
        switch (result) {
            case (#Ok(neuron)) { ?neuron };
            case (#Err(_)) { null };
        };
    };

    // Get full info for all neurons controlled by this canister
    public shared ({ caller }) func getAllNeuronsInfo(): async [(T.NeuronId, ?T.NeuronInfo)] {
        assertPermission(caller, T.NeuronPermission.ViewNeuron);
        let managedNeurons = await listNeuronsInternal();
        let results = Buffer.Buffer<(T.NeuronId, ?T.NeuronInfo)>(managedNeurons.size());
        
        for (neuron in managedNeurons.vals()) {
            switch (neuron.id) {
                case (?nid) {
                    let result = await governance.get_neuron_info(nid.id);
                    switch (result) {
                        case (#Ok(info)) { results.add((nid, ?info)) };
                        case (#Err(_)) { results.add((nid, null)) };
                    };
                };
                case null {};
            };
        };
        
        Buffer.toArray(results);
    };

    // ============================================
    // STAKE MANAGEMENT
    // ============================================

    public shared ({ caller }) func increaseStake(neuronId: T.NeuronId, amount_e8s: Nat64): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.StakeNeuron);
        logEngine.logInfo("api", "increaseStake", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("amount_e8s", Nat64.toText(amount_e8s))]);
        
        // Verify this canister controls the neuron and get its account
        let neuronResult = await governance.get_full_neuron(neuronId.id);
        switch (neuronResult) {
            case (#Err(e)) {
                return #Err(#GovernanceError(e));
            };
            case (#Ok(neuron)) {
                let selfPrincipal = Principal.fromActor(this);
                
                // Verify we control it
                switch (neuron.controller) {
                    case null { return #Err(#NoNeuron) };
                    case (?ctrl) {
                        if (not Principal.equal(ctrl, selfPrincipal)) {
                            return #Err(#NoNeuron);
                        };
                    };
                };
                
                // Check balance
                let balance = await getBalanceInternal();
                let required = Nat64.toNat(amount_e8s + T.ICP_FEE);
                if (balance < required) {
                    return #Err(#TransferFailed("Insufficient balance"));
                };

                // Use the neuron's account from governance
                let neuronSubaccount: Blob = neuron.account;
                
                // Transfer to neuron
                let transferArg: T.TransferArg = {
                    to = {
                        owner = Principal.fromText(T.GOVERNANCE_CANISTER_ID);
                        subaccount = ?neuronSubaccount;
                    };
                    fee = ?Nat64.toNat(T.ICP_FEE);
                    memo = null;
                    from_subaccount = null;
                    created_at_time = null;
                    amount = Nat64.toNat(amount_e8s);
                };

                let transferResult = await ledger.icrc1_transfer(transferArg);
                
                switch (transferResult) {
                    case (#Err(e)) {
                        return #Err(#TransferFailed(transferErrorToText(e)));
                    };
                    case (#Ok(_)) {
                        // Refresh the neuron
                        return await refreshStakeInternal(neuronId);
                    };
                };
            };
        };
    };

    public shared ({ caller }) func refreshStake(neuronId: T.NeuronId): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.StakeNeuron);
        logEngine.logInfo("api", "refreshStake", ?caller, [("neuronId", Nat64.toText(neuronId.id))]);
        
        // Verify this canister controls the neuron
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        await refreshStakeInternal(neuronId);
    };

    func refreshStakeInternal(nid: T.NeuronId): async T.OperationResult {
        // Use neuron_id_or_subaccount approach - only set this field, not id
        let request: T.ManageNeuronRequest = {
            id = null;
            command = ?#ClaimOrRefresh({
                by = ?#NeuronIdOrSubaccount({});
            });
            neuron_id_or_subaccount = ?#NeuronId(nid);
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { 
                #Err(#GovernanceError({ error_message = "No response from refresh"; error_type = 0 })) 
            };
            case (?#Error(e)) { 
                #Err(#GovernanceError(e)) 
            };
            case (?#ClaimOrRefresh(_)) { 
                #Ok 
            };
            case (_) { 
                #Err(#InvalidOperation("Unexpected response")) 
            };
        };
    };

    // ============================================
    // DISSOLVE MANAGEMENT
    // ============================================

    public shared ({ caller }) func setDissolveDelay(neuronId: T.NeuronId, additionalSeconds: Nat32): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ConfigureDissolveState);
        logEngine.logInfo("api", "setDissolveDelay", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("additionalSeconds", Nat32.toText(additionalSeconds))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        await configureNeuron(neuronId, #IncreaseDissolveDelay({
            additional_dissolve_delay_seconds = additionalSeconds;
        }));
    };

    public shared ({ caller }) func startDissolving(neuronId: T.NeuronId): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ConfigureDissolveState);
        logEngine.logInfo("api", "startDissolving", ?caller, [("neuronId", Nat64.toText(neuronId.id))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        await configureNeuron(neuronId, #StartDissolving({}));
    };

    public shared ({ caller }) func stopDissolving(neuronId: T.NeuronId): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ConfigureDissolveState);
        logEngine.logInfo("api", "stopDissolving", ?caller, [("neuronId", Nat64.toText(neuronId.id))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        await configureNeuron(neuronId, #StopDissolving({}));
    };

    // ============================================
    // DISBURSE
    // ============================================

    public shared ({ caller }) func disburse(
        neuronId: T.NeuronId,
        amount_e8s: ?Nat64,
        to_account: ?T.AccountIdentifier
    ): async T.DisburseResult {
        assertPermission(caller, T.NeuronPermission.Disburse);
        logEngine.logInfo("api", "disburse", ?caller, [("neuronId", Nat64.toText(neuronId.id))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#Disburse({
                to_account = to_account;
                amount = switch (amount_e8s) {
                    case null { null };
                    case (?a) { ?{ e8s = a } };
                };
            });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#Disburse(r)) { #Ok({ transfer_block_height = r.transfer_block_height }) };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    public shared ({ caller }) func withdrawIcp(
        amount_e8s: Nat64,
        to_account: T.Account
    ): async T.DisburseResult {
        assertPermission(caller, T.NeuronPermission.WithdrawFunds);
        logEngine.logInfo("api", "withdrawIcp", ?caller, [("amount_e8s", Nat64.toText(amount_e8s))]);
        
        let balance = await getBalanceInternal();
        let required = Nat64.toNat(amount_e8s + T.ICP_FEE);
        if (balance < required) {
            return #Err(#TransferFailed("Insufficient balance"));
        };

        let transferArg: T.TransferArg = {
            to = to_account;
            fee = ?Nat64.toNat(T.ICP_FEE);
            memo = null;
            from_subaccount = null;
            created_at_time = null;
            amount = Nat64.toNat(amount_e8s);
        };

        let result = await ledger.icrc1_transfer(transferArg);
        
        switch (result) {
            case (#Err(e)) { #Err(#TransferFailed(transferErrorToText(e))) };
            case (#Ok(blockIndex)) { #Ok({ transfer_block_height = Nat64.fromNat(blockIndex) }) };
        };
    };

    // Withdraw any ICRC1 token from the canister
    public shared ({ caller }) func withdrawToken(
        ledger_canister_id: Principal,
        amount: Nat,
        to_account: T.Account
    ): async T.DisburseResult {
        assertPermission(caller, T.NeuronPermission.WithdrawFunds);
        logEngine.logInfo("api", "withdrawToken", ?caller, [("ledger", Principal.toText(ledger_canister_id)), ("amount", Nat.toText(amount))]);
        
        // Create actor for the specified ledger
        let tokenLedger: T.LedgerActor = actor(Principal.toText(ledger_canister_id));
        
        // Get the fee for this token
        let fee = await tokenLedger.icrc1_fee();
        
        // Check balance
        let balance = await tokenLedger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = null;
        });
        
        if (balance < amount + fee) {
            return #Err(#TransferFailed("Insufficient token balance"));
        };

        let transferArg: T.TransferArg = {
            to = to_account;
            fee = ?fee;
            memo = null;
            from_subaccount = null;
            created_at_time = null;
            amount = amount;
        };

        let result = await tokenLedger.icrc1_transfer(transferArg);
        
        switch (result) {
            case (#Err(e)) { #Err(#TransferFailed(transferErrorToText(e))) };
            case (#Ok(blockIndex)) { #Ok({ transfer_block_height = Nat64.fromNat(blockIndex) }) };
        };
    };
    
    // Get balance of any ICRC1 token held by this canister
    public func getTokenBalance(ledger_canister_id: Principal): async Nat {
        let tokenLedger: T.LedgerActor = actor(Principal.toText(ledger_canister_id));
        await tokenLedger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = null;
        });
    };

    // ============================================
    // MATURITY MANAGEMENT
    // ============================================

    public shared ({ caller }) func spawnMaturity(
        neuronId: T.NeuronId,
        percentage: Nat32,
        newController: ?Principal
    ): async T.SpawnResult {
        assertPermission(caller, T.NeuronPermission.Spawn);
        logEngine.logInfo("api", "spawnMaturity", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("percentage", Nat32.toText(percentage))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#Spawn({
                percentage_to_spawn = ?percentage;
                new_controller = newController;
                nonce = null;
            });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#Spawn(r)) {
                switch (r.created_neuron_id) {
                    case null { #Err(#InvalidOperation("No neuron ID returned")) };
                    case (?newNid) {
                        // Spawned neuron will be auto-discovered via listNeurons
                        #Ok(newNid);
                    };
                };
            };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    public shared ({ caller }) func stakeMaturity(neuronId: T.NeuronId, percentage: Nat32): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.StakeMaturity);
        logEngine.logInfo("api", "stakeMaturity", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("percentage", Nat32.toText(percentage))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#StakeMaturity({ percentage_to_stake = ?percentage });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#StakeMaturity(_)) { #Ok };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    public shared ({ caller }) func mergeMaturity(neuronId: T.NeuronId, percentage: Nat32): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.MergeMaturity);
        logEngine.logInfo("api", "mergeMaturity", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("percentage", Nat32.toText(percentage))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#MergeMaturity({ percentage_to_merge = percentage });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#MergeMaturity(_)) { #Ok };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    public shared ({ caller }) func disburseMaturity(
        neuronId: T.NeuronId,
        percentage: Nat32,
        to_account: ?T.Account
    ): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.DisburseMaturity);
        logEngine.logInfo("api", "disburseMaturity", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("percentage", Nat32.toText(percentage))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#DisburseMaturity({
                percentage_to_disburse = percentage;
                to_account = to_account;
            });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#DisburseMaturity(_)) { #Ok };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    public shared ({ caller }) func setAutoStakeMaturity(neuronId: T.NeuronId, enabled: Bool): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.AutoStakeMaturity);
        logEngine.logInfo("api", "setAutoStakeMaturity", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("enabled", if (enabled) "true" else "false")]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        await configureNeuron(neuronId, #ChangeAutoStakeMaturity({
            requested_setting_for_auto_stake_maturity = enabled;
        }));
    };

    // ============================================
    // VOTING
    // ============================================

    public shared ({ caller }) func vote(neuronId: T.NeuronId, proposal_id: Nat64, voteValue: Int32): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.Vote);
        logEngine.logInfo("api", "vote", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("proposalId", Nat64.toText(proposal_id)), ("vote", Int32.toText(voteValue))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#RegisterVote({
                vote = voteValue;
                proposal = ?{ id = proposal_id };
            });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#RegisterVote(_)) { #Ok };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    // ============================================
    // PROPOSALS
    // ============================================

    public shared ({ caller }) func makeProposal(
        neuronId: T.NeuronId,
        proposal: T.Proposal
    ): async T.MakeProposalResult {
        assertPermission(caller, T.NeuronPermission.MakeProposal);
        logEngine.logInfo("api", "makeProposal", ?caller, [("neuronId", Nat64.toText(neuronId.id))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#MakeProposal(proposal);
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#MakeProposal(resp)) { #Ok({ proposal_id = resp.proposal_id; message = resp.message }) };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    public shared ({ caller }) func setFollowing(
        neuronId: T.NeuronId,
        topic: Int32,
        followees: [T.NeuronId]
    ): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ManageFollowees);
        logEngine.logInfo("api", "setFollowing", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("topic", Int32.toText(topic))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#Follow({
                topic = topic;
                followees = followees;
            });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#Follow(_)) { #Ok };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    public shared ({ caller }) func refreshVotingPower(neuronId: T.NeuronId): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.Vote);
        logEngine.logInfo("api", "refreshVotingPower", ?caller, [("neuronId", Nat64.toText(neuronId.id))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#RefreshVotingPower({});
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#RefreshVotingPower(_)) { #Ok };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    // Confirm all following settings (re-applies current followees to keep neuron active)
    public shared ({ caller }) func confirmFollowing(neuronId: T.NeuronId): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ManageFollowees);
        logEngine.logInfo("api", "confirmFollowing", ?caller, [("neuronId", Nat64.toText(neuronId.id))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        // Get current neuron to read existing followees
        let neuronResult = await governance.get_full_neuron(neuronId.id);
        let neuron = switch (neuronResult) {
            case (#Err(e)) { return #Err(#GovernanceError(e)) };
            case (#Ok(n)) { n };
        };
        
        // Re-apply each topic's followees
        for ((topic, followeesRecord) in neuron.followees.vals()) {
            let request: T.ManageNeuronRequest = {
                id = ?neuronId;
                command = ?#Follow({
                    topic = topic;
                    followees = followeesRecord.followees;
                });
                neuron_id_or_subaccount = null;
            };
            
            let result = await governance.manage_neuron(request);
            
            switch (result.command) {
                case (?#Error(e)) { return #Err(#GovernanceError(e)) };
                case (?#Follow(_)) { /* continue */ };
                case null { return #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
                case (_) { return #Err(#InvalidOperation("Unexpected response")) };
            };
        };
        
        #Ok;
    };

    // ============================================
    // HOT KEY MANAGEMENT
    // ============================================

    public shared ({ caller }) func addHotKey(neuronId: T.NeuronId, hotkey: Principal): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ManageNeuronHotkeys);
        logEngine.logInfo("api", "addHotKey", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("hotkey", Principal.toText(hotkey))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        await configureNeuron(neuronId, #AddHotKey({ new_hot_key = ?hotkey }));
    };

    public shared ({ caller }) func removeHotKey(neuronId: T.NeuronId, hotkey: Principal): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ManageNeuronHotkeys);
        logEngine.logInfo("api", "removeHotKey", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("hotkey", Principal.toText(hotkey))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        await configureNeuron(neuronId, #RemoveHotKey({ hot_key_to_remove = ?hotkey }));
    };

    // Set neuron visibility (0 = private, 1 = public)
    public shared ({ caller }) func setVisibility(neuronId: T.NeuronId, visibility: Int32): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ManageVisibility);
        logEngine.logInfo("api", "setVisibility", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("visibility", Int32.toText(visibility))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        await configureNeuron(neuronId, #SetVisibility({ visibility = ?visibility }));
    };

    // ============================================
    // HOTKEY PERMISSION MANAGEMENT
    // ============================================

    // Add permissions to a botkey principal (merges with existing permissions)
    public shared ({ caller }) func addHotkeyPermissions(
        hotkeyPrincipal: Principal,
        permissions: [T.NeuronPermissionType]
    ): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ManagePermissions);
        logEngine.logInfo("permissions", "addHotkeyPermissions", ?caller, [("principal", Principal.toText(hotkeyPrincipal))]);

        if (Principal.isAnonymous(hotkeyPrincipal)) {
            return #Err(#InvalidOperation("Cannot add anonymous principal as hotkey"));
        };

        hotkeyPermissions := permEngine.addPermissions(hotkeyPrincipal, permissions, hotkeyPermissions);
        #Ok
    };

    // Remove specific permissions from a botkey principal
    // If all permissions are removed, the principal is removed entirely
    public shared ({ caller }) func removeHotkeyPermissions(
        hotkeyPrincipal: Principal,
        permissions: [T.NeuronPermissionType]
    ): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ManagePermissions);
        logEngine.logInfo("permissions", "removeHotkeyPermissions", ?caller, [("principal", Principal.toText(hotkeyPrincipal))]);

        hotkeyPermissions := permEngine.removePermissions(hotkeyPrincipal, permissions, hotkeyPermissions);
        #Ok
    };

    // Remove a botkey principal entirely (removes all their permissions)
    public shared ({ caller }) func removeHotkeyPrincipal(
        hotkeyPrincipal: Principal
    ): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.ManagePermissions);
        logEngine.logInfo("permissions", "removeHotkeyPrincipal", ?caller, [("principal", Principal.toText(hotkeyPrincipal))]);

        hotkeyPermissions := permEngine.removePrincipal(hotkeyPrincipal, hotkeyPermissions);
        #Ok
    };

    // Get permissions for a specific botkey principal
    public query func getHotkeyPermissions(hotkeyPrincipal: Principal): async [T.NeuronPermissionType] {
        permEngine.getPermissions(hotkeyPrincipal, hotkeyPermissions)
    };

    // List all botkey principals and their permissions
    public query func listHotkeyPrincipals(): async [T.HotkeyPermissionInfo] {
        permEngine.listPrincipals(hotkeyPermissions)
    };

    // List all available permission types and their numeric IDs
    public query func listPermissionTypes(): async [(Nat, T.NeuronPermissionType)] {
        permEngine.listPermissionTypes()
    };

    // Get the caller's current permissions
    // Controllers and principals with FullPermissions get all permissions;
    // other botkey principals get their assigned permissions.
    public shared query ({ caller }) func callerPermissions(): async [T.NeuronPermissionType] {
        permEngine.getCallerPermissions(caller, hotkeyPermissions)
    };

    // Check if the caller has a specific permission
    public shared query ({ caller }) func checkPermission(permission: T.NeuronPermissionType): async Bool {
        callerHasPermission(caller, permissionVariantToId(permission))
    };

    // Get raw botkey snapshot for escrow backup (controller-only)
    // Returns the raw (Principal, [Nat]) pairs that represent botkey permissions.
    // This is used by Sneedex to backup botkeys before clearing them during escrow.
    public shared ({ caller }) func getBotkeySnapshot() : async [(Principal, [Nat])] {
        assert(Principal.isController(caller));
        logEngine.logInfo("permissions", "getBotkeySnapshot", ?caller, []);
        hotkeyPermissions
    };

    // Restore botkeys from a raw snapshot (controller-only)
    // Used by Sneedex to restore botkeys when an escrowed canister is reclaimed by the seller.
    public shared ({ caller }) func restoreBotkeySnapshot(data : [(Principal, [Nat])]) : async () {
        assert(Principal.isController(caller));
        logEngine.logInfo("permissions", "restoreBotkeySnapshot", ?caller, []);
        hotkeyPermissions := data;
    };

    // Clear all botkeys (controller-only)
    // Used by Sneedex to clear botkeys when escrowing a canister.
    public shared ({ caller }) func clearBotkeys() : async () {
        assert(Principal.isController(caller));
        logEngine.logInfo("permissions", "clearBotkeys", ?caller, []);
        hotkeyPermissions := [];
    };

    // ============================================
    // BOT LOG API
    // ============================================

    // Query log entries with filtering and pagination
    public shared query ({ caller }) func getLogs(filter: BotLogTypes.LogFilter): async BotLogTypes.LogResult {
        assertPermission(caller, T.NeuronPermission.ViewLogs);
        logEngine.getLogs(filter)
    };

    // Get current log configuration
    public shared query ({ caller }) func getLogConfig(): async BotLogTypes.LogConfig {
        assertPermission(caller, T.NeuronPermission.ViewLogs);
        logEngine.getConfig()
    };

    // Set the minimum log level (write-side threshold)
    public shared ({ caller }) func setLogLevel(level: BotLogTypes.LogLevel): async () {
        assertPermission(caller, T.NeuronPermission.ManageLogs);
        logEngine.logInfo("log", "setLogLevel", ?caller, [("newLevel", switch (level) {
            case (#Off) { "Off" }; case (#Error) { "Error" }; case (#Warning) { "Warning" };
            case (#Info) { "Info" }; case (#Debug) { "Debug" }; case (#Trace) { "Trace" };
        })]);
        logEngine.setLogLevel(level);
    };

    // Set the maximum number of log entries to retain
    public shared ({ caller }) func setMaxLogEntries(maxEntries: Nat): async () {
        assertPermission(caller, T.NeuronPermission.ManageLogs);
        logEngine.logInfo("log", "setMaxLogEntries", ?caller, [("maxEntries", Nat.toText(maxEntries))]);
        botLogMaxEntries := maxEntries;
        logEngine.setMaxEntries(maxEntries);
    };

    // Clear all log entries
    public shared ({ caller }) func clearLogs(): async () {
        assertPermission(caller, T.NeuronPermission.ManageLogs);
        logEngine.logInfo("log", "clearLogs", ?caller, []);
        logEngine.clear();
    };

    // ============================================
    // NEURON SPLITTING / MERGING
    // ============================================

    public shared ({ caller }) func splitNeuron(neuronId: T.NeuronId, amount_e8s: Nat64): async T.SplitResult {
        assertPermission(caller, T.NeuronPermission.Split);
        logEngine.logInfo("api", "splitNeuron", ?caller, [("neuronId", Nat64.toText(neuronId.id)), ("amount_e8s", Nat64.toText(amount_e8s))]);
        
        let hasControl = await hasNeuronInternal(neuronId);
        if (not hasControl) {
            return #Err(#NoNeuron);
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?neuronId;
            command = ?#Split({ amount_e8s = amount_e8s });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#Split(r)) {
                switch (r.created_neuron_id) {
                    case null { #Err(#InvalidOperation("No neuron ID returned")) };
                    case (?newNid) {
                        // New split neuron will be auto-discovered via listNeurons
                        #Ok(newNid);
                    };
                };
            };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    public shared ({ caller }) func mergeNeurons(targetNeuronId: T.NeuronId, sourceNeuronId: T.NeuronId): async T.OperationResult {
        assertPermission(caller, T.NeuronPermission.MergeNeurons);
        logEngine.logInfo("api", "mergeNeurons", ?caller, [("targetNeuronId", Nat64.toText(targetNeuronId.id)), ("sourceNeuronId", Nat64.toText(sourceNeuronId.id))]);
        
        // Verify both neurons are controlled by this canister
        let hasTargetControl = await hasNeuronInternal(targetNeuronId);
        if (not hasTargetControl) {
            return #Err(#NoNeuron);
        };
        let hasSourceControl = await hasNeuronInternal(sourceNeuronId);
        if (not hasSourceControl) {
            return #Err(#InvalidOperation("Source neuron is not controlled by this canister"));
        };
        
        let request: T.ManageNeuronRequest = {
            id = ?targetNeuronId;
            command = ?#Merge({ source_neuron_id = ?sourceNeuronId });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#Merge(_)) {
                // Source neuron is destroyed, it will no longer appear in listNeurons
                #Ok;
            };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    // ============================================
    // BOT CHORE ADMIN API
    // ============================================

    // Query: Get status of all registered chores
    public shared query ({ caller }) func getChoreStatuses(): async [BotChoreTypes.ChoreStatus] {
        assertPermission(caller, T.NeuronPermission.ViewChores);
        choreEngine.getAllStatuses()
    };

    // Query: Get status of a specific chore
    public shared query ({ caller }) func getChoreStatus(choreId: Text): async ?BotChoreTypes.ChoreStatus {
        assertPermission(caller, T.NeuronPermission.ViewChores);
        choreEngine.getStatus(choreId)
    };

    // Query: Get configs of all chores
    public shared query ({ caller }) func getChoreConfigs(): async [(Text, BotChoreTypes.ChoreConfig)] {
        assertPermission(caller, T.NeuronPermission.ViewChores);
        choreEngine.getAllConfigs()
    };

    // Start a chore: run immediately + schedule next run (Stopped → Running)
    public shared ({ caller }) func startChore(choreId: Text): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "startChore", ?caller, [("choreId", choreId)]);
        choreEngine.start<system>(choreId);
    };

    // Schedule-start a chore: enable it and schedule the first run at a specific time, without running immediately
    public shared ({ caller }) func scheduleStartChore(choreId: Text, timestampNanos: Int): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "scheduleStartChore", ?caller, [("choreId", choreId)]);
        choreEngine.scheduleStart<system>(choreId, timestampNanos);
    };

    // Pause a running chore: suspend schedule but preserve next-run time (Running → Paused)
    public shared ({ caller }) func pauseChore(choreId: Text): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "pauseChore", ?caller, [("choreId", choreId)]);
        choreEngine.pause(choreId);
    };

    // Resume a paused chore: re-activate preserved schedule (Paused → Running)
    public shared ({ caller }) func resumeChore(choreId: Text): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "resumeChore", ?caller, [("choreId", choreId)]);
        choreEngine.resume<system>(choreId);
    };

    // Change the schedule interval for a chore (in seconds)
    public shared ({ caller }) func setChoreInterval(choreId: Text, seconds: Nat): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "setChoreInterval", ?caller, [("choreId", choreId), ("seconds", Nat.toText(seconds))]);
        choreEngine.setInterval(choreId, seconds);
    };

    // Change the max interval for randomized scheduling (in seconds), or null to disable
    public shared ({ caller }) func setChoreMaxInterval(choreId: Text, seconds: ?Nat): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "setChoreMaxInterval", ?caller, [("choreId", choreId)]);
        choreEngine.setMaxInterval(choreId, seconds);
    };

    // Change the task timeout for a chore (in seconds)
    public shared ({ caller }) func setChoreTaskTimeout(choreId: Text, seconds: Nat): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "setChoreTaskTimeout", ?caller, [("choreId", choreId), ("seconds", Nat.toText(seconds))]);
        choreEngine.setTaskTimeout(choreId, seconds);
    };

    // Force-run a chore immediately (regardless of schedule)
    public shared ({ caller }) func triggerChore(choreId: Text): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "triggerChore", ?caller, [("choreId", choreId)]);
        choreEngine.trigger<system>(choreId);
    };

    // Set the exact timestamp for the next scheduled run (nanoseconds since epoch)
    public shared ({ caller }) func setChoreNextRun(choreId: Text, timestampNanos: Int): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "setChoreNextRun", ?caller, [("choreId", choreId)]);
        choreEngine.setNextScheduledRun<system>(choreId, timestampNanos);
    };

    // Stop a chore completely: cancel everything, clear schedule (Running/Paused → Stopped)
    public shared ({ caller }) func stopChore(choreId: Text): async () {
        assertPermission(caller, choreManagePermission(choreId));
        logEngine.logInfo("api", "stopChore", ?caller, [("choreId", choreId)]);
        choreEngine.stop(choreId);
    };

    // Stop all running chores (requires all per-chore manage permissions)
    public shared ({ caller }) func stopAllChores(): async () {
        assertPermission(caller, T.NeuronPermission.ManageConfirmFollowing);
        assertPermission(caller, T.NeuronPermission.ManageRefreshStake);
        assertPermission(caller, T.NeuronPermission.ManageCollectMaturity);
        assertPermission(caller, T.NeuronPermission.ManageDistributeFunds);
        logEngine.logInfo("api", "stopAllChores", ?caller, []);
        choreEngine.stopAllChores();
    };

    // --- Chore Instance Management ---

    // Create a new chore instance of the given type
    public shared ({ caller }) func createChoreInstance(typeId: Text, instanceId: Text, instanceLabel: Text): async Bool {
        assertPermission(caller, choreManagePermission(typeId));
        logEngine.logInfo("api", "createChoreInstance", ?caller, [("typeId", typeId), ("instanceId", instanceId), ("label", instanceLabel)]);
        choreEngine.createInstance(typeId, instanceId, instanceLabel)
    };

    // Delete a chore instance (must be stopped first)
    public shared ({ caller }) func deleteChoreInstance(instanceId: Text): async Bool {
        // Look up the instance to find its typeId for permission check
        switch (choreEngine.getInstance(instanceId)) {
            case (?info) {
                assertPermission(caller, choreManagePermission(info.typeId));
                logEngine.logInfo("api", "deleteChoreInstance", ?caller, [("instanceId", instanceId)]);
                choreEngine.deleteInstance(instanceId)
            };
            case null { false };
        };
    };

    // Rename a chore instance's label
    public shared ({ caller }) func renameChoreInstance(instanceId: Text, newLabel: Text): async Bool {
        switch (choreEngine.getInstance(instanceId)) {
            case (?info) {
                assertPermission(caller, choreManagePermission(info.typeId));
                logEngine.logInfo("api", "renameChoreInstance", ?caller, [("instanceId", instanceId), ("newLabel", newLabel)]);
                choreEngine.renameInstance(instanceId, newLabel)
            };
            case null { false };
        };
    };

    // List all chore instances, optionally filtered by typeId
    public shared query ({ caller }) func listChoreInstances(typeIdFilter: ?Text): async [(Text, BotChoreTypes.ChoreInstanceInfo)] {
        assertPermission(caller, T.NeuronPermission.ViewChores);
        choreEngine.listInstances(typeIdFilter)
    };

    // --- Collect-Maturity chore settings (per-instance) ---

    // Get collect-maturity settings for an instance
    public shared query ({ caller }) func getCollectMaturitySettings(instanceId: Text): async {
        thresholdE8s: ?Nat64;
        destination: ?T.Account;
    } {
        assertPermission(caller, T.NeuronPermission.ViewChores);
        getCmSettings(instanceId)
    };

    // Set collect-maturity threshold for an instance (null = collect any amount)
    public shared ({ caller }) func setCollectMaturityThreshold(instanceId: Text, thresholdE8s: ?Nat64): async () {
        assertPermission(caller, T.NeuronPermission.ConfigureCollectMaturity);
        logEngine.logInfo("api", "setCollectMaturityThreshold", ?caller, [("instanceId", instanceId)]);
        let s = getCmSettings(instanceId);
        setCmSettings(instanceId, { s with thresholdE8s = thresholdE8s });
    };

    // Set collect-maturity destination for an instance (null = bot's own account)
    public shared ({ caller }) func setCollectMaturityDestination(instanceId: Text, destination: ?T.Account): async () {
        assertPermission(caller, T.NeuronPermission.ConfigureCollectMaturity);
        logEngine.logInfo("api", "setCollectMaturityDestination", ?caller, [("instanceId", instanceId)]);
        let s = getCmSettings(instanceId);
        setCmSettings(instanceId, { s with destination = destination });
    };

    // --- Distribution chore settings (per-instance) ---

    // Get distribution lists for an instance
    public shared query ({ caller }) func getDistributionLists(instanceId: Text): async [DistributionTypes.DistributionList] {
        assertPermission(caller, T.NeuronPermission.ViewChores);
        getDistSettings(instanceId).lists
    };

    // Add a new distribution list to an instance, returns the assigned ID
    public shared ({ caller }) func addDistributionList(instanceId: Text, input: DistributionTypes.DistributionListInput): async Nat {
        assertPermission(caller, T.NeuronPermission.ConfigureDistribution);
        logEngine.logInfo("api", "addDistributionList", ?caller, [("instanceId", instanceId), ("name", input.name)]);
        let ds = getDistSettings(instanceId);
        let id = ds.nextListId;
        let newList: DistributionTypes.DistributionList = {
            id = id;
            name = input.name;
            sourceSubaccount = input.sourceSubaccount;
            tokenLedgerCanisterId = input.tokenLedgerCanisterId;
            thresholdAmount = input.thresholdAmount;
            maxDistributionAmount = input.maxDistributionAmount;
            targets = input.targets;
        };
        let buf = Buffer.fromArray<DistributionTypes.DistributionList>(ds.lists);
        buf.add(newList);
        setDistSettings(instanceId, { lists = Buffer.toArray(buf); nextListId = id + 1 });
        id
    };

    // Update an existing distribution list by ID within an instance
    public shared ({ caller }) func updateDistributionList(instanceId: Text, id: Nat, input: DistributionTypes.DistributionListInput): async () {
        assertPermission(caller, T.NeuronPermission.ConfigureDistribution);
        logEngine.logInfo("api", "updateDistributionList", ?caller, [("instanceId", instanceId), ("listId", Nat.toText(id))]);
        let ds = getDistSettings(instanceId);
        let updatedLists = Array.map<DistributionTypes.DistributionList, DistributionTypes.DistributionList>(
            ds.lists,
            func(list: DistributionTypes.DistributionList): DistributionTypes.DistributionList {
                if (list.id == id) {
                    {
                        id = id;
                        name = input.name;
                        sourceSubaccount = input.sourceSubaccount;
                        tokenLedgerCanisterId = input.tokenLedgerCanisterId;
                        thresholdAmount = input.thresholdAmount;
                        maxDistributionAmount = input.maxDistributionAmount;
                        targets = input.targets;
                    }
                } else { list }
            }
        );
        setDistSettings(instanceId, { ds with lists = updatedLists });
    };

    // Remove a distribution list by ID within an instance
    public shared ({ caller }) func removeDistributionList(instanceId: Text, id: Nat): async () {
        assertPermission(caller, T.NeuronPermission.ConfigureDistribution);
        logEngine.logInfo("api", "removeDistributionList", ?caller, [("instanceId", instanceId), ("listId", Nat.toText(id))]);
        let ds = getDistSettings(instanceId);
        let filtered = Array.filter<DistributionTypes.DistributionList>(
            ds.lists,
            func(list: DistributionTypes.DistributionList): Bool { list.id != id }
        );
        setDistSettings(instanceId, { ds with lists = filtered });
    };

    // ============================================
    // INTERNAL HELPERS
    // ============================================

    func configureNeuron(nid: T.NeuronId, operation: T.Operation): async T.OperationResult {
        let request: T.ManageNeuronRequest = {
            id = ?nid;
            command = ?#Configure({ operation = ?operation });
            neuron_id_or_subaccount = null;
        };
        
        let result = await governance.manage_neuron(request);
        
        switch (result.command) {
            case null { #Err(#GovernanceError({ error_message = "No response"; error_type = 0 })) };
            case (?#Error(e)) { #Err(#GovernanceError(e)) };
            case (?#Configure(_)) { #Ok };
            case (_) { #Err(#InvalidOperation("Unexpected response")) };
        };
    };

    func transferErrorToText(e: T.TransferError): Text {
        switch (e) {
            case (#GenericError({ message })) { "Generic error: " # message };
            case (#TemporarilyUnavailable) { "Temporarily unavailable" };
            case (#BadBurn(_)) { "Bad burn" };
            case (#Duplicate(_)) { "Duplicate transaction" };
            case (#BadFee(_)) { "Bad fee" };
            case (#CreatedInFuture(_)) { "Created in future" };
            case (#TooOld) { "Too old" };
            case (#InsufficientFunds(_)) { "Insufficient funds" };
        };
    };

    func nat64ToBytes(n: Nat64): [Nat8] {
        [
            Nat8.fromNat(Nat64.toNat((n >> 56) & 0xFF)),
            Nat8.fromNat(Nat64.toNat((n >> 48) & 0xFF)),
            Nat8.fromNat(Nat64.toNat((n >> 40) & 0xFF)),
            Nat8.fromNat(Nat64.toNat((n >> 32) & 0xFF)),
            Nat8.fromNat(Nat64.toNat((n >> 24) & 0xFF)),
            Nat8.fromNat(Nat64.toNat((n >> 16) & 0xFF)),
            Nat8.fromNat(Nat64.toNat((n >> 8) & 0xFF)),
            Nat8.fromNat(Nat64.toNat(n & 0xFF)),
        ];
    };

    // ============================================
    // ACCOUNT ID COMPUTATION
    // ============================================

    func computeAccountId(principal: Principal, subaccount: ?Blob): T.AccountIdentifier {
        let hash = computeAccountIdHash(principal, subaccount);
        let crc = crc32(hash);
        let result = Buffer.Buffer<Nat8>(32);
        result.add(Nat8.fromNat(Nat32.toNat((crc >> 24) & 0xFF)));
        result.add(Nat8.fromNat(Nat32.toNat((crc >> 16) & 0xFF)));
        result.add(Nat8.fromNat(Nat32.toNat((crc >> 8) & 0xFF)));
        result.add(Nat8.fromNat(Nat32.toNat(crc & 0xFF)));
        for (byte in hash.vals()) {
            result.add(byte);
        };
        Blob.fromArray(Buffer.toArray(result));
    };

    func computeAccountIdHash(principal: Principal, subaccount: ?Blob): [Nat8] {
        let principalBytes = Blob.toArray(Principal.toBlob(principal));
        let subaccountBytes = switch (subaccount) {
            case null { Array.tabulate<Nat8>(32, func(_) = 0) };
            case (?sa) { Blob.toArray(sa) };
        };
        
        // Domain separator: 0x0a + "account-id"
        let domainSeparatorText = Blob.toArray(Text.encodeUtf8("account-id"));
        
        let preimage = Buffer.Buffer<Nat8>(1 + domainSeparatorText.size() + principalBytes.size() + subaccountBytes.size());
        preimage.add(0x0a);
        for (b in domainSeparatorText.vals()) { preimage.add(b) };
        for (b in principalBytes.vals()) { preimage.add(b) };
        for (b in subaccountBytes.vals()) { preimage.add(b) };
        
        sha224(Buffer.toArray(preimage));
    };

    func computeNeuronSubaccount(controller: Principal, memo: Nat64): Blob {
        // Domain separator: 0x0c + "neuron-stake"
        let domainSeparatorText = Blob.toArray(Text.encodeUtf8("neuron-stake"));
        let controllerBytes = Blob.toArray(Principal.toBlob(controller));
        let memoBytes = nat64ToBytes(memo);
        
        let preimage = Buffer.Buffer<Nat8>(1 + domainSeparatorText.size() + controllerBytes.size() + 8);
        preimage.add(0x0c);
        for (b in domainSeparatorText.vals()) { preimage.add(b) };
        for (b in controllerBytes.vals()) { preimage.add(b) };
        for (b in memoBytes.vals()) { preimage.add(b) };
        
        Blob.fromArray(sha256(Buffer.toArray(preimage)));
    };

    // SHA-256/SHA-224 implementation
    transient let SHA256_H: [Nat32] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    transient let SHA224_H: [Nat32] = [
        0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939,
        0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4
    ];

    transient let K: [Nat32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    func sha256(data: [Nat8]): [Nat8] {
        shaCore(data, SHA256_H, 32);
    };

    func sha224(data: [Nat8]): [Nat8] {
        shaCore(data, SHA224_H, 28);
    };

    func shaCore(data: [Nat8], initialH: [Nat32], outputLen: Nat): [Nat8] {
        let paddedData = padMessage(data);
        var h = Array.thaw<Nat32>(initialH);
        
        let numBlocks = paddedData.size() / 64;
        var blockIdx = 0;
        while (blockIdx < numBlocks) {
            let blockStart = blockIdx * 64;
            
            var w = Array.init<Nat32>(64, 0);
            var i = 0;
            while (i < 16) {
                let byteIdx = blockStart + i * 4;
                w[i] := (Nat32.fromNat(Nat8.toNat(paddedData[byteIdx])) << 24) |
                        (Nat32.fromNat(Nat8.toNat(paddedData[byteIdx + 1])) << 16) |
                        (Nat32.fromNat(Nat8.toNat(paddedData[byteIdx + 2])) << 8) |
                        Nat32.fromNat(Nat8.toNat(paddedData[byteIdx + 3]));
                i += 1;
            };
            
            while (i < 64) {
                let s0 = rotr32(w[i-15], 7) ^ rotr32(w[i-15], 18) ^ (w[i-15] >> 3);
                let s1 = rotr32(w[i-2], 17) ^ rotr32(w[i-2], 19) ^ (w[i-2] >> 10);
                w[i] := w[i-16] +% s0 +% w[i-7] +% s1;
                i += 1;
            };
            
            var a = h[0];
            var b = h[1];
            var c = h[2];
            var d = h[3];
            var e = h[4];
            var f = h[5];
            var g = h[6];
            var hh = h[7];
            
            i := 0;
            while (i < 64) {
                let S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
                let ch = (e & f) ^ ((^e) & g);
                let temp1 = hh +% S1 +% ch +% K[i] +% w[i];
                let S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
                let maj = (a & b) ^ (a & c) ^ (b & c);
                let temp2 = S0 +% maj;
                
                hh := g;
                g := f;
                f := e;
                e := d +% temp1;
                d := c;
                c := b;
                b := a;
                a := temp1 +% temp2;
                i += 1;
            };
            
            h[0] +%= a;
            h[1] +%= b;
            h[2] +%= c;
            h[3] +%= d;
            h[4] +%= e;
            h[5] +%= f;
            h[6] +%= g;
            h[7] +%= hh;
            
            blockIdx += 1;
        };
        
        let result = Buffer.Buffer<Nat8>(outputLen);
        let numWords = outputLen / 4;
        var wordIdx = 0;
        while (wordIdx < numWords) {
            result.add(Nat8.fromNat(Nat32.toNat((h[wordIdx] >> 24) & 0xFF)));
            result.add(Nat8.fromNat(Nat32.toNat((h[wordIdx] >> 16) & 0xFF)));
            result.add(Nat8.fromNat(Nat32.toNat((h[wordIdx] >> 8) & 0xFF)));
            result.add(Nat8.fromNat(Nat32.toNat(h[wordIdx] & 0xFF)));
            wordIdx += 1;
        };
        Buffer.toArray(result);
    };

    func padMessage(data: [Nat8]): [Nat8] {
        let dataLen = data.size();
        let bitLen = dataLen * 8;
        
        var paddingLen = 64 - ((dataLen + 9) % 64);
        if (paddingLen == 64) { paddingLen := 0 };
        
        let totalLen = dataLen + 1 + paddingLen + 8;
        let padded = Array.init<Nat8>(totalLen, 0);
        
        var i = 0;
        while (i < dataLen) {
            padded[i] := data[i];
            i += 1;
        };
        
        padded[dataLen] := 0x80;
        
        let bitLenNat64 = Nat64.fromNat(bitLen);
        padded[totalLen - 8] := Nat8.fromNat(Nat64.toNat((bitLenNat64 >> 56) & 0xFF));
        padded[totalLen - 7] := Nat8.fromNat(Nat64.toNat((bitLenNat64 >> 48) & 0xFF));
        padded[totalLen - 6] := Nat8.fromNat(Nat64.toNat((bitLenNat64 >> 40) & 0xFF));
        padded[totalLen - 5] := Nat8.fromNat(Nat64.toNat((bitLenNat64 >> 32) & 0xFF));
        padded[totalLen - 4] := Nat8.fromNat(Nat64.toNat((bitLenNat64 >> 24) & 0xFF));
        padded[totalLen - 3] := Nat8.fromNat(Nat64.toNat((bitLenNat64 >> 16) & 0xFF));
        padded[totalLen - 2] := Nat8.fromNat(Nat64.toNat((bitLenNat64 >> 8) & 0xFF));
        padded[totalLen - 1] := Nat8.fromNat(Nat64.toNat(bitLenNat64 & 0xFF));
        
        Array.freeze(padded);
    };

    func rotr32(x: Nat32, n: Nat32): Nat32 {
        (x >> n) | (x << (32 - n));
    };

    func crc32(data: [Nat8]): Nat32 {
        var crc: Nat32 = 0xFFFFFFFF;
        for (byte in data.vals()) {
            let index = Nat32.toNat((crc ^ Nat32.fromNat(Nat8.toNat(byte))) & 0xFF);
            crc := CRC32_TABLE[index] ^ (crc >> 8);
        };
        ^crc;
    };

    transient let CRC32_TABLE: [Nat32] = [
        0x00000000, 0x77073096, 0xee0e612c, 0x990951ba, 0x076dc419, 0x706af48f, 0xe963a535, 0x9e6495a3,
        0x0edb8832, 0x79dcb8a4, 0xe0d5e91e, 0x97d2d988, 0x09b64c2b, 0x7eb17cbd, 0xe7b82d07, 0x90bf1d91,
        0x1db71064, 0x6ab020f2, 0xf3b97148, 0x84be41de, 0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
        0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec, 0x14015c4f, 0x63066cd9, 0xfa0f3d63, 0x8d080df5,
        0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172, 0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b,
        0x35b5a8fa, 0x42b2986c, 0xdbbbc9d6, 0xacbcf940, 0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
        0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116, 0x21b4f4b5, 0x56b3c423, 0xcfba9599, 0xb8bda50f,
        0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924, 0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d,
        0x76dc4190, 0x01db7106, 0x98d220bc, 0xefd5102a, 0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
        0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818, 0x7f6a0dbb, 0x086d3d2d, 0x91646c97, 0xe6635c01,
        0x6b6b51f4, 0x1c6c6162, 0x856530d8, 0xf262004e, 0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457,
        0x65b0d9c6, 0x12b7e950, 0x8bbeb8ea, 0xfcb9887c, 0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
        0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2, 0x4adfa541, 0x3dd895d7, 0xa4d1c46d, 0xd3d6f4fb,
        0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0, 0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7a9b,
        0x5005713c, 0x270241aa, 0xbe0b1010, 0xc90c2086, 0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
        0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4, 0x59b33d17, 0x2eb40d81, 0xb7bd5c3b, 0xc0ba6cad,
        0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a, 0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683,
        0xe3630b12, 0x94643b84, 0x0d6d6a3e, 0x7a6a5aa8, 0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
        0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe, 0xf762575d, 0x806567cb, 0x196c3671, 0x6e6b06e7,
        0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc, 0xf9b9df6f, 0x8ebeeff9, 0x17b7be43, 0x60b08ed5,
        0xd6d6a3e8, 0xa1d1937e, 0x38d8c2c4, 0x4fdff252, 0xd1bb67f1, 0xa6bc5767, 0x3fb506dd, 0x48b2364b,
        0xd80d2bda, 0xaf0a1b4c, 0x36034af6, 0x41047a60, 0xdf60efc3, 0xa867df55, 0x316e8eef, 0x4669be79,
        0xcb61b38c, 0xbc66831a, 0x256fd2a0, 0x5268e236, 0xcc0c7795, 0xbb0b4703, 0x220216b9, 0x5505262f,
        0xc5ba3bbe, 0xb2bd0b28, 0x2bb45a92, 0x5cb36a04, 0xc2d7ffa7, 0xb5d0cf31, 0x2cd99e8b, 0x5bdeae1d,
        0x9b64c2b0, 0xec63f226, 0x756aa39c, 0x026d930a, 0x9c0906a9, 0xeb0e363f, 0x72076785, 0x05005713,
        0x95bf4a82, 0xe2b87a14, 0x7bb12bae, 0x0cb61b38, 0x92d28e9b, 0xe5d5be0d, 0x7cdcefb7, 0x0bdbdf21,
        0x86d3d2d4, 0xf1d4e242, 0x68ddb3f8, 0x1fda836e, 0x81be16cd, 0xf6b9265b, 0x6fb077e1, 0x18b74777,
        0x88085ae6, 0xff0f6a70, 0x66063bca, 0x11010b5c, 0x8f659eff, 0xf862ae69, 0x616bffd3, 0x166ccf45,
        0xa00ae278, 0xd70dd2ee, 0x4e048354, 0x3903b3c2, 0xa7672661, 0xd06016f7, 0x4969474d, 0x3e6e77db,
        0xaed16a4a, 0xd9d65adc, 0x40df0b66, 0x37d83bf0, 0xa9bcae53, 0xdebb9ec5, 0x47b2cf7f, 0x30b5ffe9,
        0xbdbdf21c, 0xcabac28a, 0x53b39330, 0x24b4a3a6, 0xbad03605, 0xcdd706b3, 0x54de5729, 0x23d967bf,
        0xb3667a2e, 0xc4614ab8, 0x5d681b02, 0x2a6f2b94, 0xb40bbe37, 0xc30c8ea1, 0x5a05df1b, 0x2d02ef8d
    ];

    // ============================================
    // BOT CHORES INITIALIZATION
    // ============================================
    // This section is at the bottom so all referenced functions
    // (e.g. listNeuronsInternal, governance) are already defined.

    // Helper: create a task function that refreshes stake for a specific neuron.
    // This calls ClaimOrRefresh which picks up any ICP deposited to the neuron's account.
    func _rs_makeTaskFn(nid: T.NeuronId): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            let result = await refreshStakeInternal(nid);
            switch (result) {
                case (#Ok) { #Done };
                case (#Err(#GovernanceError(e))) { #Error(e.error_message) };
                case (#Err(#NoNeuron)) { #Error("Neuron not found") };
                case (#Err(#InvalidOperation(msg))) { #Error(msg) };
                case (#Err(#TransferFailed(msg))) { #Error(msg) };
                case (#Err(#InsufficientFunds(_))) { #Error("Insufficient funds") };
            };
        }
    };

    // Helper: start a refresh-stake task for the neuron at _rs_index
    func _rs_startCurrentTask() {
        if (_rs_index < _rs_neurons.size()) {
            let nid = _rs_neurons[_rs_index];
            let taskFn = _rs_makeTaskFn(nid);
            choreEngine.setPendingTask(
                "refresh-stake",
                "refresh-" # Nat.toText(_rs_index),
                taskFn
            );
        };
    };

    // Helper: create a task function that confirms following for a specific neuron
    func _cf_makeTaskFn(nid: T.NeuronId): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            // Get full neuron to read current followees
            let neuronResult = await governance.get_full_neuron(nid.id);
            let neuron = switch (neuronResult) {
                case (#Err(e)) { return #Error("Failed to get neuron: " # e.error_message) };
                case (#Ok(n)) { n };
            };

            // Re-apply each topic's followees
            for ((topic, followeesRecord) in neuron.followees.vals()) {
                let request: T.ManageNeuronRequest = {
                    id = ?nid;
                    command = ?#Follow({
                        topic = topic;
                        followees = followeesRecord.followees;
                    });
                    neuron_id_or_subaccount = null;
                };

                let result = await governance.manage_neuron(request);
                switch (result.command) {
                    case (?#Error(e)) {
                        return #Error("Failed to confirm topic " # Int.toText(Int32.toInt(topic)) # ": " # e.error_message);
                    };
                    case (?#Follow(_)) { /* success, continue */ };
                    case null {
                        return #Error("No response for topic " # Int.toText(Int32.toInt(topic)));
                    };
                    case (_) { /* unexpected but not fatal, continue */ };
                };
            };

            #Done
        }
    };

    // Helper: start a confirm-following task for the neuron at _cf_index
    func _cf_startCurrentTask() {
        if (_cf_index < _cf_neurons.size()) {
            let nid = _cf_neurons[_cf_index];
            let taskFn = _cf_makeTaskFn(nid);
            choreEngine.setPendingTask(
                "confirm-following",
                "confirm-" # Nat.toText(_cf_index),
                taskFn
            );
        };
    };

    // --- Collect Maturity chore transient state (per-instance) ---
    transient var _cm_state: [(Text, { neurons: [T.NeuronId]; index: Nat })] = [];

    func _cm_getState(instanceId: Text): { neurons: [T.NeuronId]; index: Nat } {
        for ((id, s) in _cm_state.vals()) { if (id == instanceId) return s };
        { neurons = []; index = 0 }
    };

    func _cm_setState(instanceId: Text, s: { neurons: [T.NeuronId]; index: Nat }) {
        var found = false;
        let updated = Array.map<(Text, { neurons: [T.NeuronId]; index: Nat }), (Text, { neurons: [T.NeuronId]; index: Nat })>(
            _cm_state, func((id, old)) { if (id == instanceId) { found := true; (id, s) } else { (id, old) } }
        );
        if (found) { _cm_state := updated } else { _cm_state := Array.append(_cm_state, [(instanceId, s)]) };
    };

    // Helper: create a task function that collects maturity for a specific neuron (per-instance)
    func _cm_makeTaskFn(instanceId: Text, nid: T.NeuronId): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            let settings = getCmSettings(instanceId);

            // Get full neuron to check maturity
            let neuronResult = await governance.get_full_neuron(nid.id);
            let neuron = switch (neuronResult) {
                case (#Err(e)) { return #Error("Failed to get neuron: " # e.error_message) };
                case (#Ok(n)) { n };
            };

            let maturityE8s = neuron.maturity_e8s_equivalent;

            // Check threshold
            switch (settings.thresholdE8s) {
                case (?threshold) {
                    if (maturityE8s < threshold) {
                        return #Done; // Below threshold, skip
                    };
                };
                case null {}; // No threshold, always collect
            };

            // Nothing to collect
            if (maturityE8s == 0) {
                return #Done;
            };

            // Determine destination
            let destAccount: ?T.Account = switch (settings.destination) {
                case (?acct) { ?acct };
                case null {
                    // Bot's own account (canister principal, no subaccount)
                    ?{ owner = Principal.fromActor(this); subaccount = null }
                };
            };

            // Disburse 100% of maturity
            let request: T.ManageNeuronRequest = {
                id = ?nid;
                command = ?#DisburseMaturity({
                    percentage_to_disburse = 100 : Nat32;
                    to_account = destAccount;
                });
                neuron_id_or_subaccount = null;
            };

            let result = await governance.manage_neuron(request);
            switch (result.command) {
                case (?#Error(e)) {
                    return #Error("Failed to disburse maturity: " # e.error_message);
                };
                case (?#DisburseMaturity(_)) { #Done };
                case null { #Error("No response from governance") };
                case (_) { #Done }; // Unexpected but not fatal
            };
        }
    };

    // Helper: start a collect-maturity task for the current neuron in instance state
    func _cm_startCurrentTask(instanceId: Text) {
        let st = _cm_getState(instanceId);
        if (st.index < st.neurons.size()) {
            let nid = st.neurons[st.index];
            let taskFn = _cm_makeTaskFn(instanceId, nid);
            choreEngine.setPendingTask(
                instanceId,
                "collect-" # Nat.toText(st.index),
                taskFn
            );
        };
    };

    // --- Distribute Funds chore transient state (per-instance) ---
    transient var _df_state: [(Text, { lists: [DistributionTypes.DistributionList]; index: Nat })] = [];

    func _df_getState(instanceId: Text): { lists: [DistributionTypes.DistributionList]; index: Nat } {
        for ((id, s) in _df_state.vals()) { if (id == instanceId) return s };
        { lists = []; index = 0 }
    };

    func _df_setState(instanceId: Text, s: { lists: [DistributionTypes.DistributionList]; index: Nat }) {
        var found = false;
        let updated = Array.map<(Text, { lists: [DistributionTypes.DistributionList]; index: Nat }), (Text, { lists: [DistributionTypes.DistributionList]; index: Nat })>(
            _df_state, func((id, old)) { if (id == instanceId) { found := true; (id, s) } else { (id, old) } }
        );
        if (found) { _df_state := updated } else { _df_state := Array.append(_df_state, [(instanceId, s)]) };
    };

    // Helper: create a task function that distributes funds for a single distribution list
    func _df_makeTaskFn(list: DistributionTypes.DistributionList): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            let numTargets = list.targets.size();
            if (numTargets == 0) return #Done; // No targets

            // Create dynamic ledger actor for this token
            let tokenLedger: T.LedgerActor = actor(Principal.toText(list.tokenLedgerCanisterId));

            // Query fee
            let fee = await tokenLedger.icrc1_fee();

            // Query balance of source account
            let sourceAccount: T.Account = {
                owner = Principal.fromActor(this);
                subaccount = list.sourceSubaccount;
            };
            let balance = await tokenLedger.icrc1_balance_of(sourceAccount);

            // Check threshold
            if (balance < list.thresholdAmount) return #Done; // Below threshold

            // Calculate distributable amount (capped at max)
            let distributable = Nat.min(balance, list.maxDistributionAmount);

            // Reserve fees for all transfers
            let totalFees = numTargets * fee;
            if (distributable <= totalFees) return #Done; // Can't cover fees
            let distributableNet: Nat = distributable - totalFees;

            // Calculate basis points
            var totalAssignedBp: Nat = 0;
            var numUnassigned: Nat = 0;
            for (target in list.targets.vals()) {
                switch (target.basisPoints) {
                    case (?bp) { totalAssignedBp += bp };
                    case null { numUnassigned += 1 };
                };
            };

            // Determine effective basis points for each target
            let effectiveBps = Buffer.Buffer<Nat>(numTargets);
            if (totalAssignedBp > 10000) {
                // Over 100%: renormalize assigned, unassigned get nothing
                for (target in list.targets.vals()) {
                    switch (target.basisPoints) {
                        case (?bp) { effectiveBps.add(bp * 10000 / totalAssignedBp) };
                        case null { effectiveBps.add(0) };
                    };
                };
            } else {
                let remainderBp: Nat = 10000 - totalAssignedBp;
                let eachUnassignedBp: Nat = if (numUnassigned > 0) { remainderBp / numUnassigned } else { 0 };
                for (target in list.targets.vals()) {
                    switch (target.basisPoints) {
                        case (?bp) { effectiveBps.add(bp) };
                        case null { effectiveBps.add(eachUnassignedBp) };
                    };
                };
            };

            // Calculate amounts and check hard minimum
            let amounts = Buffer.Buffer<Nat>(numTargets);
            var minAmount: Nat = distributableNet; // will find the real minimum
            for (bp in effectiveBps.vals()) {
                let amount: Nat = distributableNet * bp / 10000;
                amounts.add(amount);
                if (amount < minAmount) { minAmount := amount };
            };

            // Hard minimum: smallest recipient must get more than one tx fee
            if (minAmount <= fee) return #Done; // Hard minimum not met

            // Execute transfers
            var transferErrors = Buffer.Buffer<Text>(0);
            var i: Nat = 0;
            for (target in list.targets.vals()) {
                let amount = amounts.get(i);
                if (amount > 0) {
                    let transferResult = await tokenLedger.icrc1_transfer({
                        to = { owner = target.account.owner; subaccount = target.account.subaccount };
                        amount = amount;
                        fee = ?fee;
                        memo = null;
                        from_subaccount = list.sourceSubaccount;
                        created_at_time = null;
                    });
                    switch (transferResult) {
                        case (#Err(e)) {
                            let errMsg = switch (e) {
                                case (#InsufficientFunds(d)) { "InsufficientFunds(balance=" # Nat.toText(d.balance) # ")" };
                                case (#BadFee(d)) { "BadFee(expected=" # Nat.toText(d.expected_fee) # ")" };
                                case (#GenericError(d)) { "GenericError(" # d.message # ")" };
                                case (#TemporarilyUnavailable) { "TemporarilyUnavailable" };
                                case (#BadBurn(d)) { "BadBurn(min=" # Nat.toText(d.min_burn_amount) # ")" };
                                case (#Duplicate(d)) { "Duplicate(of=" # Nat.toText(d.duplicate_of) # ")" };
                                case (#CreatedInFuture(_)) { "CreatedInFuture" };
                                case (#TooOld) { "TooOld" };
                            };
                            transferErrors.add("Target " # Nat.toText(i) # ": " # errMsg);
                        };
                        case (#Ok(_)) { /* success */ };
                    };
                };
                i += 1;
            };

            if (transferErrors.size() > 0) {
                return #Error("Distribution '" # list.name # "' completed with " # Nat.toText(transferErrors.size()) # " error(s): " # Text.join("; ", transferErrors.vals()));
            };

            #Done
        }
    };

    // Helper: start a distribute-funds task for the current list in instance state
    func _df_startCurrentTask(instanceId: Text) {
        let st = _df_getState(instanceId);
        if (st.index < st.lists.size()) {
            let list = st.lists[st.index];
            let taskFn = _df_makeTaskFn(list);
            choreEngine.setPendingTask(
                instanceId,
                "dist-" # Nat.toText(list.id),
                taskFn
            );
        };
    };

    // Register chores and start timers.
    // This runs on every canister start (first deploy + upgrades) because
    // it's inside a transient let expression.
    transient let _choreInit: () = do {
        // --- Chore: Confirm Following ---
        choreEngine.registerChore({
            id = "confirm-following";
            name = "Confirm Following";
            description = "Periodically re-confirms neuron followees to keep neurons eligible for voting rewards. NNS requires followees to be re-confirmed at least every 6 months.";
            defaultIntervalSeconds = 30 * 24 * 60 * 60; // 30 days (monthly, well within 6-month deadline)
            defaultMaxIntervalSeconds = null; // No randomization for confirm following
            defaultTaskTimeoutSeconds = 600; // 10 minutes (confirming many topics can take time)
            conduct = func(ctx: BotChoreTypes.ConductorContext): async BotChoreTypes.ConductorAction {
                // If a task is still running, just poll again
                if (ctx.isTaskRunning) {
                    return #ContinueIn(10);
                };

                switch (ctx.lastCompletedTask) {
                    case null {
                        // First invocation: fetch all neurons
                        let neurons = await listNeuronsInternal();
                        let neuronIds = Buffer.Buffer<T.NeuronId>(neurons.size());
                        for (n in neurons.vals()) {
                            switch (n.id) {
                                case (?nid) { neuronIds.add(nid) };
                                case null {};
                            };
                        };
                        _cf_neurons := Buffer.toArray(neuronIds);
                        _cf_index := 0;

                        if (_cf_neurons.size() == 0) {
                            return #Done; // No neurons to process
                        };

                        // Start first task and poll
                        _cf_startCurrentTask();
                        return #ContinueIn(10);
                    };
                    case (?_lastResult) {
                        // Previous task completed — advance to next neuron
                        // (continue even if the last task failed — best effort for remaining neurons)
                        _cf_index += 1;
                        if (_cf_index >= _cf_neurons.size()) {
                            return #Done; // All neurons processed
                        };

                        // Start next task and poll
                        _cf_startCurrentTask();
                        return #ContinueIn(10);
                    };
                };
            };
        });

        // --- Chore: Refresh Stake ---
        choreEngine.registerChore({
            id = "refresh-stake";
            name = "Refresh Stake";
            description = "Periodically refreshes the stake of all managed neurons. This picks up any ICP that was deposited directly to a neuron's account, counting it as staked. Useful when external processes send ICP to neuron accounts.";
            defaultIntervalSeconds = 24 * 60 * 60; // 1 day
            defaultMaxIntervalSeconds = null; // No randomization for refresh stake
            defaultTaskTimeoutSeconds = 300; // 5 minutes per neuron refresh
            conduct = func(ctx: BotChoreTypes.ConductorContext): async BotChoreTypes.ConductorAction {
                // If a task is still running, just poll again
                if (ctx.isTaskRunning) {
                    return #ContinueIn(10);
                };

                switch (ctx.lastCompletedTask) {
                    case null {
                        // First invocation: fetch all neurons
                        let neurons = await listNeuronsInternal();
                        let neuronIds = Buffer.Buffer<T.NeuronId>(neurons.size());
                        for (n in neurons.vals()) {
                            switch (n.id) {
                                case (?nid) { neuronIds.add(nid) };
                                case null {};
                            };
                        };
                        _rs_neurons := Buffer.toArray(neuronIds);
                        _rs_index := 0;

                        if (_rs_neurons.size() == 0) {
                            return #Done; // No neurons to process
                        };

                        // Start first task and poll
                        _rs_startCurrentTask();
                        return #ContinueIn(10);
                    };
                    case (?_lastResult) {
                        // Previous task completed — advance to next neuron
                        _rs_index += 1;
                        if (_rs_index >= _rs_neurons.size()) {
                            return #Done; // All neurons processed
                        };

                        // Start next task and poll
                        _rs_startCurrentTask();
                        return #ContinueIn(10);
                    };
                };
            };
        });

        // --- Chore: Collect Maturity ---
        choreEngine.registerChore({
            id = "collect-maturity";
            name = "Collect Maturity";
            description = "Periodically collects (disburses) maturity from all managed neurons and sends it to a configured account. Maturity accumulates from voting rewards. A threshold can be set to only collect when a minimum amount is available.";
            defaultIntervalSeconds = 7 * 24 * 60 * 60; // 7 days (weekly)
            defaultMaxIntervalSeconds = null; // No randomization for collect maturity
            defaultTaskTimeoutSeconds = 300; // 5 minutes per neuron
            conduct = func(ctx: BotChoreTypes.ConductorContext): async BotChoreTypes.ConductorAction {
                let instanceId = ctx.choreId;
                // If a task is still running, just poll again
                if (ctx.isTaskRunning) {
                    return #ContinueIn(10);
                };

                switch (ctx.lastCompletedTask) {
                    case null {
                        // First invocation: fetch all neurons
                        let neurons = await listNeuronsInternal();
                        let neuronIds = Buffer.Buffer<T.NeuronId>(neurons.size());
                        for (n in neurons.vals()) {
                            switch (n.id) {
                                case (?nid) { neuronIds.add(nid) };
                                case null {};
                            };
                        };
                        _cm_setState(instanceId, { neurons = Buffer.toArray(neuronIds); index = 0 });

                        let st = _cm_getState(instanceId);
                        if (st.neurons.size() == 0) {
                            return #Done; // No neurons to process
                        };

                        // Start first task and poll
                        _cm_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };
                    case (?_lastResult) {
                        // Previous task completed — advance to next neuron
                        let st = _cm_getState(instanceId);
                        let nextIdx = st.index + 1;
                        _cm_setState(instanceId, { st with index = nextIdx });
                        if (nextIdx >= st.neurons.size()) {
                            return #Done; // All neurons processed
                        };

                        // Start next task and poll
                        _cm_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };
                };
            };
        });

        // --- Chore: Distribute Funds ---
        choreEngine.registerChore({
            id = "distribute-funds";
            name = "Distribute Funds";
            description = "Periodically checks configured distribution lists and sends funds from the bot's account (or a subaccount) to a set of target accounts based on configured percentages. Supports multiple lists, each with its own token, threshold, and targets.";
            defaultIntervalSeconds = 24 * 60 * 60; // 1 day
            defaultMaxIntervalSeconds = null; // No randomization for distribution
            defaultTaskTimeoutSeconds = 600; // 10 minutes per distribution list
            conduct = func(ctx: BotChoreTypes.ConductorContext): async BotChoreTypes.ConductorAction {
                let instanceId = ctx.choreId;
                // If a task is still running, just poll again
                if (ctx.isTaskRunning) {
                    return #ContinueIn(10);
                };

                switch (ctx.lastCompletedTask) {
                    case null {
                        // First invocation: snapshot distribution lists for this instance
                        let ds = getDistSettings(instanceId);
                        _df_setState(instanceId, { lists = ds.lists; index = 0 });

                        if (ds.lists.size() == 0) {
                            return #Done; // No distribution lists configured
                        };

                        // Start first task and poll
                        _df_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };
                    case (?_lastResult) {
                        // Previous task completed — advance to next list
                        let st = _df_getState(instanceId);
                        let nextIdx = st.index + 1;
                        _df_setState(instanceId, { st with index = nextIdx });
                        if (nextIdx >= st.lists.size()) {
                            return #Done; // All lists processed
                        };

                        // Start next task and poll
                        _df_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };
                };
            };
        });

        // Start/resume all chore timers
        choreEngine.resumeTimers<system>();
    };

    // Resume timers after upgrade (transient engine is fresh, stable state is loaded)
    system func postupgrade() {
        choreEngine.resumeTimers<system>();
    };
};

