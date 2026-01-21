import Principal "mo:base/Principal";
import Blob "mo:base/Blob";

import T "Types";
import Utils "Utils";

module {
    // ============================================
    // MANAGEMENT CANISTER
    // ============================================
    
    let MANAGEMENT_CANISTER_ID : Text = "aaaaa-aa";
    
    public func getManagementCanister() : T.ManagementActor {
        actor(MANAGEMENT_CANISTER_ID) : T.ManagementActor;
    };
    
    // ============================================
    // CANISTER ASSET HANDLER
    // ============================================
    
    /// Verify caller and sneedex are controllers of the canister
    public func verifyCanisterControllers(
        canisterId : Principal,
        caller : Principal,
        sneedex : Principal
    ) : async* T.Result<[Principal]> {
        let mgmt = getManagementCanister();
        
        try {
            let status = await mgmt.canister_status({ canister_id = canisterId });
            let controllers = status.settings.controllers;
            
            // Check caller is a controller
            if (not Utils.principalInList(caller, controllers)) {
                return #err(#CanisterError("Caller is not a controller of the canister"));
            };
            
            // Check sneedex is a controller
            if (not Utils.principalInList(sneedex, controllers)) {
                return #err(#CanisterError("Sneedex canister is not a controller. Please add it first."));
            };
            
            #ok(controllers);
        } catch (_e) {
            #err(#CanisterError("Failed to get canister status. Ensure you are a controller."));
        };
    };
    
    /// Take control of a canister by removing all controllers except sneedex
    /// Returns snapshot of original controllers
    public func escrowCanister(
        canisterId : Principal,
        sneedex : Principal,
        originalControllers : [Principal]
    ) : async* T.Result<[Principal]> {
        let mgmt = getManagementCanister();
        
        // Snapshot controllers (excluding sneedex)
        let snapshot = Utils.removePrincipal(sneedex, originalControllers);
        
        // Update controllers to only sneedex
        try {
            await mgmt.update_settings({
                canister_id = canisterId;
                settings = {
                    controllers = ?[sneedex];
                    compute_allocation = null;
                    memory_allocation = null;
                    freezing_threshold = null;
                };
            });
            
            #ok(snapshot);
        } catch (_e) {
            #err(#CanisterError("Failed to update canister controllers"));
        };
    };
    
    /// Release a canister back to original controllers
    public func releaseCanister(
        canisterId : Principal,
        originalControllers : [Principal]
    ) : async* T.Result<()> {
        let mgmt = getManagementCanister();
        
        try {
            await mgmt.update_settings({
                canister_id = canisterId;
                settings = {
                    controllers = ?originalControllers;
                    compute_allocation = null;
                    memory_allocation = null;
                    freezing_threshold = null;
                };
            });
            
            #ok();
        } catch (_e) {
            #err(#CanisterError("Failed to release canister"));
        };
    };
    
    /// Transfer canister to new owner(s)
    public func transferCanister(
        canisterId : Principal,
        newControllers : [Principal]
    ) : async* T.Result<()> {
        let mgmt = getManagementCanister();
        
        try {
            await mgmt.update_settings({
                canister_id = canisterId;
                settings = {
                    controllers = ?newControllers;
                    compute_allocation = null;
                    memory_allocation = null;
                    freezing_threshold = null;
                };
            });
            
            #ok();
        } catch (_e) {
            #err(#CanisterError("Failed to transfer canister"));
        };
    };
    
    // ============================================
    // SNS NEURON ASSET HANDLER
    // ============================================
    
    /// Get SNS Governance actor
    public func getSNSGovernance(governanceCanisterId : Principal) : T.SNSGovernanceActor {
        actor(Principal.toText(governanceCanisterId)) : T.SNSGovernanceActor;
    };
    
    /// Verify caller and sneedex have owner hotkeys on the neuron
    /// Returns ALL principals with any permissions (for complete removal during escrow)
    public func verifyNeuronHotkeys(
        governanceCanisterId : Principal,
        neuronId : T.NeuronId,
        caller : Principal,
        sneedex : Principal
    ) : async* T.Result<[Principal]> {
        let governance = getSNSGovernance(governanceCanisterId);
        
        try {
            let response = await governance.get_neuron({ neuron_id = ?neuronId });
            
            switch (response.result) {
                case (?#Neuron(neuron)) {
                    let owners = Utils.getOwnerPrincipals(neuron.permissions);
                    
                    // Check caller has owner permissions (full owner needed to add/remove hotkeys)
                    if (not Utils.principalInList(caller, owners)) {
                        return #err(#GovernanceError("Caller does not have owner permissions on the neuron"));
                    };
                    
                    // Check sneedex has owner permissions
                    if (not Utils.principalInList(sneedex, owners)) {
                        return #err(#GovernanceError("Sneedex canister does not have owner permissions. Please add it as a hotkey first."));
                    };
                    
                    // Return ALL principals (not just owners) so we remove everyone during escrow
                    let allPrincipals = Utils.getAllPrincipals(neuron.permissions);
                    #ok(allPrincipals);
                };
                case (?#Error(e)) {
                    #err(#GovernanceError(e.error_message));
                };
                case null {
                    #err(#GovernanceError("Neuron not found"));
                };
            };
        } catch (_e) {
            #err(#GovernanceError("Failed to query neuron"));
        };
    };
    
    /// Remove all hotkeys from a neuron except sneedex
    public func escrowNeuron(
        governanceCanisterId : Principal,
        neuronId : T.NeuronId,
        sneedex : Principal,
        originalOwners : [Principal]
    ) : async* T.Result<[Principal]> {
        let governance = getSNSGovernance(governanceCanisterId);
        
        // Snapshot hotkeys (excluding sneedex)
        let snapshot = Utils.removePrincipal(sneedex, originalOwners);
        
        // Remove ALL permissions from all hotkeys except sneedex
        for (owner in snapshot.vals()) {
            try {
                let _ = await governance.manage_neuron({
                    subaccount = neuronId.id;
                    command = ?#RemoveNeuronPermissions({
                        permissions_to_remove = ?{ permissions = T.ALL_PERMISSIONS };
                        principal_id = ?owner;
                    });
                });
            } catch (_e) {
                return #err(#GovernanceError("Failed to remove permissions from hotkey"));
            };
        };
        
        // Verify that only sneedex remains with permissions
        try {
            let response = await governance.get_neuron({ neuron_id = ?neuronId });
            switch (response.result) {
                case (?#Neuron(neuron)) {
                    let remainingPrincipals = Utils.getAllPrincipals(neuron.permissions);
                    // Check that only sneedex has permissions
                    for (p in remainingPrincipals.vals()) {
                        if (not Principal.equal(p, sneedex)) {
                            return #err(#GovernanceError("Failed to fully escrow neuron - other principals still have permissions"));
                        };
                    };
                };
                case _ {};
            };
        } catch (_e) {
            // Verification failed but removal might have succeeded
        };
        
        #ok(snapshot);
    };
    
    /// Restore hotkeys to a neuron
    public func releaseNeuron(
        governanceCanisterId : Principal,
        neuronId : T.NeuronId,
        sneedex : Principal,
        originalOwners : [Principal]
    ) : async* T.Result<()> {
        let governance = getSNSGovernance(governanceCanisterId);
        
        // Re-add all original owner hotkeys
        for (owner in originalOwners.vals()) {
            try {
                let _ = await governance.manage_neuron({
                    subaccount = neuronId.id;
                    command = ?#AddNeuronPermissions({
                        permissions_to_add = ?{ permissions = T.FULL_OWNER_PERMISSIONS };
                        principal_id = ?owner;
                    });
                });
            } catch (_e) {
                return #err(#GovernanceError("Failed to add hotkey to neuron"));
            };
        };
        
        // Remove sneedex
        try {
            let _ = await governance.manage_neuron({
                subaccount = neuronId.id;
                command = ?#RemoveNeuronPermissions({
                    permissions_to_remove = ?{ permissions = T.FULL_OWNER_PERMISSIONS };
                    principal_id = ?sneedex;
                });
            });
        } catch (_e) {
            // If removal fails, the original owners still have control
            // which is acceptable
        };
        
        #ok();
    };
    
    /// Transfer neuron to new owner(s)
    public func transferNeuron(
        governanceCanisterId : Principal,
        neuronId : T.NeuronId,
        sneedex : Principal,
        newOwners : [Principal]
    ) : async* T.Result<()> {
        let governance = getSNSGovernance(governanceCanisterId);
        
        // Add all new owners
        for (owner in newOwners.vals()) {
            try {
                let _ = await governance.manage_neuron({
                    subaccount = neuronId.id;
                    command = ?#AddNeuronPermissions({
                        permissions_to_add = ?{ permissions = T.FULL_OWNER_PERMISSIONS };
                        principal_id = ?owner;
                    });
                });
            } catch (_e) {
                return #err(#GovernanceError("Failed to add new owner to neuron"));
            };
        };
        
        // Remove sneedex
        try {
            let _ = await governance.manage_neuron({
                subaccount = neuronId.id;
                command = ?#RemoveNeuronPermissions({
                    permissions_to_remove = ?{ permissions = T.FULL_OWNER_PERMISSIONS };
                    principal_id = ?sneedex;
                });
            });
        } catch (_e) {
            // Continue even if sneedex removal fails
        };
        
        #ok();
    };
    
    // ============================================
    // ICRC1 TOKEN ASSET HANDLER
    // ============================================
    
    /// Get ICRC1 Ledger actor
    public func getICRC1Ledger(ledgerCanisterId : Principal) : T.ICRC1Actor {
        actor(Principal.toText(ledgerCanisterId)) : T.ICRC1Actor;
    };
    
    /// Verify ICRC1 tokens are in the escrow subaccount
    public func verifyTokenEscrow(
        ledgerCanisterId : Principal,
        sneedex : Principal,
        subaccount : Blob,
        expectedAmount : Nat
    ) : async* T.Result<Nat> {
        let ledger = getICRC1Ledger(ledgerCanisterId);
        
        try {
            let balance = await ledger.icrc1_balance_of({
                owner = sneedex;
                subaccount = ?subaccount;
            });
            
            if (balance < expectedAmount) {
                return #err(#InsufficientFunds({
                    required = expectedAmount;
                    available = balance;
                }));
            };
            
            #ok(balance);
        } catch (_e) {
            #err(#TransferFailed("Failed to check token balance"));
        };
    };
    
    /// Transfer tokens from escrow subaccount to recipient
    public func transferTokens(
        ledgerCanisterId : Principal,
        fromSubaccount : ?Blob,
        toAccount : T.Account,
        amount : Nat
    ) : async* T.Result<Nat> {
        let ledger = getICRC1Ledger(ledgerCanisterId);
        
        try {
            // Get fee
            let fee = await ledger.icrc1_fee();
            
            // Perform transfer
            let result = await ledger.icrc1_transfer({
                to = toAccount;
                fee = ?fee;
                memo = null;
                from_subaccount = fromSubaccount;
                created_at_time = null;
                amount = amount;
            });
            
            switch (result) {
                case (#Ok(blockIndex)) { #ok(blockIndex) };
                case (#Err(e)) {
                    let errorMsg = switch (e) {
                        case (#GenericError(g)) { g.message };
                        case (#TemporarilyUnavailable) { "Temporarily unavailable" };
                        case (#BadBurn(_)) { "Bad burn amount" };
                        case (#Duplicate(_)) { "Duplicate transaction" };
                        case (#BadFee(_)) { "Bad fee" };
                        case (#CreatedInFuture(_)) { "Created in future" };
                        case (#TooOld) { "Transaction too old" };
                        case (#InsufficientFunds(f)) { "Insufficient funds: " # debug_show(f.balance) };
                    };
                    #err(#TransferFailed(errorMsg));
                };
            };
        } catch (_e) {
            #err(#TransferFailed("Failed to transfer tokens"));
        };
    };
    
    /// Transfer all tokens from a subaccount minus the fee
    /// Use this when reclaiming escrowed tokens where we want to return everything
    public func reclaimAllTokens(
        ledgerCanisterId : Principal,
        sneedex : Principal,
        fromSubaccount : Blob,
        toAccount : T.Account
    ) : async* T.Result<Nat> {
        let ledger = getICRC1Ledger(ledgerCanisterId);
        
        try {
            // Get balance
            let balance = await ledger.icrc1_balance_of({
                owner = sneedex;
                subaccount = ?fromSubaccount;
            });
            
            // Get fee
            let fee = await ledger.icrc1_fee();
            
            // Check if there's enough to cover the fee
            if (balance <= fee) {
                // Nothing to transfer (or dust amount)
                return #ok(0);
            };
            
            let transferAmount = balance - fee;
            
            // Perform transfer
            let result = await ledger.icrc1_transfer({
                to = toAccount;
                fee = ?fee;
                memo = null;
                from_subaccount = ?fromSubaccount;
                created_at_time = null;
                amount = transferAmount;
            });
            
            switch (result) {
                case (#Ok(blockIndex)) { #ok(blockIndex) };
                case (#Err(e)) {
                    let errorMsg = switch (e) {
                        case (#GenericError(g)) { g.message };
                        case (#TemporarilyUnavailable) { "Temporarily unavailable" };
                        case (#BadBurn(_)) { "Bad burn amount" };
                        case (#Duplicate(_)) { "Duplicate transaction" };
                        case (#BadFee(_)) { "Bad fee" };
                        case (#CreatedInFuture(_)) { "Created in future" };
                        case (#TooOld) { "Transaction too old" };
                        case (#InsufficientFunds(f)) { "Insufficient funds: " # debug_show(f.balance) };
                    };
                    #err(#TransferFailed(errorMsg));
                };
            };
        } catch (_e) {
            #err(#TransferFailed("Failed to reclaim tokens"));
        };
    };
    
    /// Get token balance in a subaccount
    public func getTokenBalance(
        ledgerCanisterId : Principal,
        owner : Principal,
        subaccount : ?Blob
    ) : async* Nat {
        let ledger = getICRC1Ledger(ledgerCanisterId);
        
        try {
            await ledger.icrc1_balance_of({
                owner = owner;
                subaccount = subaccount;
            });
        } catch (_e) {
            0;
        };
    };
    
    /// Get token fee
    public func getTokenFee(ledgerCanisterId : Principal) : async* Nat {
        let ledger = getICRC1Ledger(ledgerCanisterId);
        
        try {
            await ledger.icrc1_fee();
        } catch (_e) {
            0;
        };
    };
};

