import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";

import T "Types";
import Utils "Utils";
import Array "mo:base/Array";
import Nat "mo:base/Nat";
import Text "mo:base/Text";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Time "mo:base/Time";
import Nat32 "mo:base/Nat32";
import Ext "../sneed_names/Ext";

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
    /// Returns ALL permissions for each principal (so we can remove exactly what they have)
    public func verifyNeuronHotkeys(
        governanceCanisterId : Principal,
        neuronId : T.NeuronId,
        caller : Principal,
        sneedex : Principal
    ) : async* T.Result<[T.NeuronPermission]> {
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
                    
                    // Return ALL permissions for each principal so we can remove exactly what they have
                    #ok(neuron.permissions);
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
    /// Takes the actual permissions for each principal so we only remove what they have
    public func escrowNeuron(
        governanceCanisterId : Principal,
        neuronId : T.NeuronId,
        sneedex : Principal,
        allPermissions : [T.NeuronPermission]
    ) : async* T.Result<[Principal]> {
        let governance = getSNSGovernance(governanceCanisterId);
        
        // Build snapshot of principals to restore (excluding sneedex)
        let snapshotBuffer = Buffer.Buffer<Principal>(4);
        
        // Remove permissions from all principals except sneedex
        // Use their ACTUAL permissions to avoid "missing permission" errors
        for (perm in allPermissions.vals()) {
            switch (perm.principal) {
                case (?p) {
                    if (not Principal.equal(p, sneedex)) {
                        // Add to snapshot for later restoration
                        snapshotBuffer.add(p);
                        
                        // Only remove if they have permissions
                        if (perm.permission_type.size() > 0) {
            try {
                                let response = await governance.manage_neuron({
                    subaccount = neuronId.id;
                    command = ?#RemoveNeuronPermissions({
                                        // Use the ACTUAL permissions this principal has
                                        permissions_to_remove = ?{ permissions = perm.permission_type };
                                        principal_id = ?p;
                    });
                });
                                // Check for errors in the response
                                switch (response.command) {
                                    case (?#Error(e)) {
                                        return #err(#GovernanceError("Failed to remove permissions: " # e.error_message));
                                    };
                                    case _ {}; // Success or other response
                                };
            } catch (_e) {
                return #err(#GovernanceError("Failed to remove permissions from hotkey"));
                            };
                        };
                    };
                };
                case null {};
            };
        };
        
        let snapshot = Buffer.toArray(snapshotBuffer);
        
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
    
    /// Restore hotkeys to a neuron: each principal gets back the given permissions
    /// (what it held before escrow), then Sneedex removes itself.
    public func releaseNeuron(
        governanceCanisterId : Principal,
        neuronId : T.NeuronId,
        sneedex : Principal,
        restore : [(Principal, [Int32])]
    ) : async* T.Result<()> {
        let governance = getSNSGovernance(governanceCanisterId);
        
        // Re-add each original principal with its own permissions
        for ((owner, permissions) in restore.vals()) {
            try {
                let response = await governance.manage_neuron({
                    subaccount = neuronId.id;
                    command = ?#AddNeuronPermissions({
                        permissions_to_add = ?{ permissions = permissions };
                        principal_id = ?owner;
                    });
                });
                // Check for errors in the response
                switch (response.command) {
                    case (?#Error(e)) {
                        return #err(#GovernanceError("Failed to add hotkey: " # e.error_message));
                    };
                    case _ {}; // Success
                };
            } catch (_e) {
                return #err(#GovernanceError("Failed to add hotkey to neuron"));
            };
        };
        
        // Query the neuron to get sneedex's actual permissions before removing
        // This handles the "Unspecified" permission case and avoids governance errors
        try {
            let neuronResponse = await governance.get_neuron({ neuron_id = ?neuronId });
            switch (neuronResponse.result) {
                case (?#Neuron(neuron)) {
                    // Find sneedex's actual permissions
                    for (perm in neuron.permissions.vals()) {
                        switch (perm.principal) {
                            case (?p) {
                                if (Principal.equal(p, sneedex) and perm.permission_type.size() > 0) {
                                    // Remove sneedex's actual permissions
                                    try {
                                        let response = await governance.manage_neuron({
                                            subaccount = neuronId.id;
                                            command = ?#RemoveNeuronPermissions({
                                                permissions_to_remove = ?{ permissions = perm.permission_type };
                                                principal_id = ?sneedex;
                                            });
                                        });
                                        // Check for errors but don't fail - original owners have control
                                        switch (response.command) {
                                            case (?#Error(_e)) {
                                                // If removal fails, original owners still have control
                                            };
                                            case _ {};
                                        };
                                    } catch (_e) {
                                        // If removal fails, original owners still have control
                                    };
                                };
                            };
                            case null {};
                        };
                    };
                };
                case _ {
                    // Fallback to removing FULL_OWNER_PERMISSIONS if we can't query neuron
                    try {
                        let response = await governance.manage_neuron({
                            subaccount = neuronId.id;
                            command = ?#RemoveNeuronPermissions({
                                permissions_to_remove = ?{ permissions = T.FULL_OWNER_PERMISSIONS };
                                principal_id = ?sneedex;
                            });
                        });
                        switch (response.command) {
                            case (?#Error(_e)) {};
                            case _ {};
                        };
                    } catch (_e) {};
                };
            };
        } catch (_e) {
            // Fallback to removing FULL_OWNER_PERMISSIONS if we can't query neuron
            try {
                let response = await governance.manage_neuron({
                    subaccount = neuronId.id;
                    command = ?#RemoveNeuronPermissions({
                        permissions_to_remove = ?{ permissions = T.FULL_OWNER_PERMISSIONS };
                        principal_id = ?sneedex;
                    });
                });
                switch (response.command) {
                    case (?#Error(_e)) {};
                    case _ {};
                };
            } catch (_e) {};
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
                let response = await governance.manage_neuron({
                    subaccount = neuronId.id;
                    command = ?#AddNeuronPermissions({
                        permissions_to_add = ?{ permissions = T.FULL_OWNER_PERMISSIONS };
                        principal_id = ?owner;
                    });
                });
                // Check for errors in the response
                switch (response.command) {
                    case (?#Error(e)) {
                        return #err(#GovernanceError("Failed to add new owner: " # e.error_message));
                    };
                    case _ {}; // Success
                };
            } catch (_e) {
                return #err(#GovernanceError("Failed to add new owner to neuron"));
            };
        };
        
        // Query the neuron to get sneedex's actual permissions before removing
        // This handles the "Unspecified" permission case and avoids governance errors
        try {
            let neuronResponse = await governance.get_neuron({ neuron_id = ?neuronId });
            switch (neuronResponse.result) {
                case (?#Neuron(neuron)) {
                    // Find sneedex's actual permissions
                    for (perm in neuron.permissions.vals()) {
                        switch (perm.principal) {
                            case (?p) {
                                if (Principal.equal(p, sneedex) and perm.permission_type.size() > 0) {
                                    // Remove sneedex's actual permissions
                                    try {
                                        let response = await governance.manage_neuron({
                                            subaccount = neuronId.id;
                                            command = ?#RemoveNeuronPermissions({
                                                permissions_to_remove = ?{ permissions = perm.permission_type };
                                                principal_id = ?sneedex;
                                            });
                                        });
                                        // Check for errors but don't fail - new owners have control
                                        switch (response.command) {
                                            case (?#Error(_e)) {
                                                // Continue even if sneedex removal fails - new owners have control
                                            };
                                            case _ {};
                                        };
                                    } catch (_e) {
                                        // Continue even if sneedex removal fails
                                    };
                                };
                            };
                            case null {};
                        };
                    };
                };
                case _ {
                    // Fallback to removing FULL_OWNER_PERMISSIONS if we can't query neuron
                    try {
                        let response = await governance.manage_neuron({
                            subaccount = neuronId.id;
                            command = ?#RemoveNeuronPermissions({
                                permissions_to_remove = ?{ permissions = T.FULL_OWNER_PERMISSIONS };
                                principal_id = ?sneedex;
                            });
                        });
                        switch (response.command) {
                            case (?#Error(_e)) {};
                            case _ {};
                        };
                    } catch (_e) {};
                };
            };
        } catch (_e) {
            // Fallback to removing FULL_OWNER_PERMISSIONS if we can't query neuron
            try {
                let response = await governance.manage_neuron({
                    subaccount = neuronId.id;
                    command = ?#RemoveNeuronPermissions({
                        permissions_to_remove = ?{ permissions = T.FULL_OWNER_PERMISSIONS };
                        principal_id = ?sneedex;
                    });
                });
                switch (response.command) {
                    case (?#Error(_e)) {};
                    case _ {};
                };
            } catch (_e) {};
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
    /// Use this when reclaiming escrowed tokens where we want to return everything.
    /// Answers the ledger block index, or 0 when there was nothing to move (see sweepTokens,
    /// which tells the two apart).
    public func reclaimAllTokens(
        ledgerCanisterId : Principal,
        sneedex : Principal,
        fromSubaccount : Blob,
        toAccount : T.Account
    ) : async* T.Result<Nat> {
        switch (await* sweepTokens(ledgerCanisterId, sneedex, fromSubaccount, toAccount)) {
            case (#ok(?(_, blockIndex))) { #ok(blockIndex) };
            case (#ok(null)) { #ok(0) };
            case (#err(e)) { #err(e) };
        };
    };

    /// reclaimAllTokens with the details for the activity log: `?(amount, blockIndex)` of the
    /// transfer, or null when the balance did not cover the fee and nothing was moved.
    public func sweepTokens(
        ledgerCanisterId : Principal,
        sneedex : Principal,
        fromSubaccount : Blob,
        toAccount : T.Account
    ) : async* T.Result<?(Nat, Nat)> {
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
                return #ok(null);
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
                case (#Ok(blockIndex)) { #ok(?(transferAmount, blockIndex)) };
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
    
    // ============================================
    // ICRC-7 NFTs
    // ============================================
    public func getICRC7Collection(collectionCanisterId : Principal) : T.ICRC7Actor {
        actor (Principal.toText(collectionCanisterId)) : T.ICRC7Actor;
    };
    
    /// Every listed token must sit in Sneedex's escrow subaccount.
    public func verifyNftEscrow(
        collectionCanisterId : Principal,
        sneedex : Principal,
        subaccount : Blob,
        tokenIds : [Nat]
    ) : async* T.Result<()> {
        let collection = getICRC7Collection(collectionCanisterId);
        try {
            let owners = await collection.icrc7_owner_of(tokenIds);
            if (owners.size() != tokenIds.size()) { return #err(#TransferFailed("The collection answered for a different number of tokens")) };
            var i = 0;
            for (o in owners.vals()) {
                switch (o) {
                    case (?a) {
                        let sub = switch (a.subaccount) { case (?b) { b }; case null { Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0 })) } };
                        if (not Principal.equal(a.owner, sneedex) or not Blob.equal(sub, subaccount)) {
                            return #err(#InvalidAsset("Token " # Nat.toText(tokenIds[i]) # " is not in the escrow account"));
                        };
                    };
                    case null { return #err(#InvalidAsset("Token " # Nat.toText(tokenIds[i]) # " does not exist")) };
                };
                i += 1;
            };
            #ok();
        } catch (_e) {
            #err(#TransferFailed("Failed to check NFT owners"));
        };
    };
    
    /// Move the listed tokens out of an escrow subaccount to a recipient. Stops at the first failure.
    public func transferNfts(
        collectionCanisterId : Principal,
        fromSubaccount : Blob,
        toAccount : T.Account,
        tokenIds : [Nat]
    ) : async* T.Result<()> {
        let collection = getICRC7Collection(collectionCanisterId);
        try {
            let args = Array.map<Nat, T.ICRC7TransferArg>(tokenIds, func(id) { { from_subaccount = ?fromSubaccount; to = toAccount; token_id = id; memo = null; created_at_time = null } });
            let results = await collection.icrc7_transfer(args);
            var i = 0;
            for (r in results.vals()) {
                switch (r) {
                    case (?#Ok(_)) {};
                    case (?#Err(e)) { return #err(#TransferFailed("NFT " # (if (i < tokenIds.size()) { Nat.toText(tokenIds[i]) } else { "?" }) # ": " # nftErrorText(e))) };
                    case null { return #err(#TransferFailed("NFT " # (if (i < tokenIds.size()) { Nat.toText(tokenIds[i]) } else { "?" }) # ": not processed")) };
                };
                i += 1;
            };
            #ok();
        } catch (_e) {
            #err(#TransferFailed("Failed to transfer NFTs"));
        };
    };
    
    func sameAccount(owner : Principal, sub : ?Blob, a : T.Account) : Bool {
        let zero = Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0 }));
        let s1 = switch (sub) { case (?b) { b }; case null { zero } };
        let s2 = switch (a.subaccount) { case (?b) { b }; case null { zero } };
        Principal.equal(owner, a.owner) and Blob.equal(s1, s2);
    };

    /// Hand over the listed tokens that still sit in the offer's escrow subaccount, and only those,
    /// so a retry after a partly failed batch never tries to move a token twice (a token already
    /// moved is no longer Sneedex's to move). Returns how many tokens were moved.
    public func deliverEscrowedNfts(
        collectionCanisterId : Principal,
        sneedex : Principal,
        escrowSubaccount : Blob,
        toAccount : T.Account,
        tokenIds : [Nat]
    ) : async* T.Result<Nat> {
        let collection = getICRC7Collection(collectionCanisterId);
        let owners = try { await collection.icrc7_owner_of(tokenIds) } catch (_e) {
            return #err(#TransferFailed("Failed to check NFT owners"));
        };
        if (owners.size() != tokenIds.size()) { return #err(#TransferFailed("The collection answered for a different number of tokens")) };
        let toMove = Buffer.Buffer<Nat>(tokenIds.size());
        var i = 0;
        for (o in owners.vals()) {
            let id = tokenIds[i];
            i += 1;
            switch (o) {
                case (?a) { if (sameAccount(sneedex, ?escrowSubaccount, a)) { toMove.add(id) } };
                case null {};
            };
        };
        if (toMove.size() == 0) { return #ok(0) };
        switch (await* transferNfts(collectionCanisterId, escrowSubaccount, toAccount, Buffer.toArray(toMove))) {
            case (#ok(_)) { #ok(toMove.size()) };
            case (#err(e)) { #err(e) };
        };
    };

    /// True only when Sneedex is provably the one and only controller of the canister, which is
    /// how escrow leaves it and how a failed hand-over leaves it. Any doubt (no access) is false.
    public func isSoleCanisterController(canisterId : Principal, sneedex : Principal) : async* Bool {
        try {
            let status = await getManagementCanister().canister_status({ canister_id = canisterId });
            let c = status.settings.controllers;
            c.size() == 1 and Principal.equal(c[0], sneedex);
        } catch (_e) { false };
    };

    /// True only when Sneedex is provably the one principal with any permission on the neuron,
    /// which is how escrow leaves it and how a failed hand-over leaves it. Any doubt is false.
    public func isSoleNeuronHolder(governanceCanisterId : Principal, neuronId : T.NeuronId, sneedex : Principal) : async* Bool {
        try {
            let response = await getSNSGovernance(governanceCanisterId).get_neuron({ neuron_id = ?neuronId });
            switch (response.result) {
                case (?#Neuron(neuron)) {
                    var sneedexHolds = false;
                    for (perm in neuron.permissions.vals()) {
                        if (perm.permission_type.size() > 0) {
                            switch (perm.principal) {
                                case (?p) { if (Principal.equal(p, sneedex)) { sneedexHolds := true } else { return false } };
                                case null {};
                            };
                        };
                    };
                    sneedexHolds;
                };
                case (_) { false };
            };
        } catch (_e) { false };
    };

    /// Move tokens out of Sneedex's own default account (no subaccount). Only ever needed for a
    /// collection that ignored the escrow subaccount on deposit, which is not ICRC-7 compliant.
    public func transferNftsFromDefault(
        collectionCanisterId : Principal,
        toAccount : T.Account,
        tokenIds : [Nat]
    ) : async* T.Result<()> {
        let collection = getICRC7Collection(collectionCanisterId);
        try {
            let args = Array.map<Nat, T.ICRC7TransferArg>(tokenIds, func(id) { { from_subaccount = null; to = toAccount; token_id = id; memo = null; created_at_time = null } });
            let results = await collection.icrc7_transfer(args);
            var i = 0;
            for (r in results.vals()) {
                switch (r) {
                    case (?#Ok(_)) {};
                    case (?#Err(e)) { return #err(#TransferFailed("NFT " # (if (i < tokenIds.size()) { Nat.toText(tokenIds[i]) } else { "?" }) # ": " # nftErrorText(e))) };
                    case null { return #err(#TransferFailed("NFT " # (if (i < tokenIds.size()) { Nat.toText(tokenIds[i]) } else { "?" }) # ": not processed")) };
                };
                i += 1;
            };
            #ok();
        } catch (_e) {
            #err(#TransferFailed("Failed to transfer NFTs"));
        };
    };

    // ============================================
    // SNEED LOCK HANDLERS
    // ============================================
    
    /// Sneed Lock's wallet subaccount for a principal: byte 0 = principal length, then the bytes.
    public func sneedLockSubaccount(p : Principal) : Blob {
        let pa = Blob.toArray(Principal.toBlob(p));
        let a = Array.init<Nat8>(32, 0);
        a[0] := Nat8.fromNat(pa.size());
        var i = 1;
        for (x in pa.vals()) { if (i < 32) { a[i] := x }; i += 1 };
        Blob.fromArray(Array.freeze(a));
    };
    
    func sneedLock(id : Principal) : T.SneedLockActor { actor (Principal.toText(id)) : T.SneedLockActor };
    
    /// The lock as Sneed Lock sees it now: its owner and the kind, or an error if it does not exist.
    public func readSneedLock(sneedLockId : Principal, lockId : Nat) : async* T.Result<(Principal, T.SneedLockKind)> {
        try {
            switch (await sneedLock(sneedLockId).get_lock_by_id(lockId)) {
                case null { #err(#InvalidAsset("Lock " # Nat.toText(lockId) # " does not exist in Sneed Lock")) };
                case (?#TokenLock(owner, ledger, l)) { #ok((owner, #Token({ ledger_canister_id = ledger; amount = l.amount; expiry = l.expiry }))) };
                case (?#PositionLock(owner, swap, l)) { #ok((owner, #Position({ swap_canister_id = swap; position_id = l.position_id; expiry = l.expiry }))) };
            };
        } catch (_e) { #err(#TransferFailed("Failed to read the lock from Sneed Lock")) };
    };
    
    /// Delivering a token lock costs one ledger fee out of Sneedex's free balance in its Sneed Lock
    /// wallet. This is how much is free there now (balance minus every lock Sneedex holds in that token).
    public func sneedexFreeBalanceInSneedLock(sneedLockId : Principal, sneedex : Principal, ledger : Principal) : async* T.Result<(Nat, Nat)> {
        try {
            let l : T.ICRC1Actor = actor (Principal.toText(ledger));
            let acct : T.Account = { owner = sneedLockId; subaccount = ?sneedLockSubaccount(sneedex) };
            let balance = await l.icrc1_balance_of(acct);
            let fee = await l.icrc1_fee();
            var locked = 0;
            for ((_id, token, amount, _exp) in (await sneedLock(sneedLockId).get_token_locks()).vals()) {
                if (Principal.equal(token, ledger)) { locked += amount };
            };
            #ok((if (balance > locked) { balance - locked } else { 0 }, fee));
        } catch (_e) { #err(#TransferFailed("Failed to read Sneedex's balance in Sneed Lock")) };
    };
    
    /// Move a lock Sneedex owns to someone else (the buyer, or the seller on reclaim).
    public func transferSneedLock(sneedLockId : Principal, asset : T.SneedLockAsset, to : Principal) : async* T.Result<()> {
        try {
            switch (asset.lock) {
                case (#Token(t)) {
                    switch (await sneedLock(sneedLockId).transfer_token_lock_ownership(to, t.ledger_canister_id, asset.lock_id)) {
                        case (#Ok) { #ok() };
                        case (#Err(e)) { #err(#TransferFailed("Sneed Lock refused the token lock transfer: " # e.message)) };
                    };
                };
                case (#Position(p)) {
                    switch (await sneedLock(sneedLockId).transfer_position_ownership(to, p.swap_canister_id, p.position_id)) {
                        case (#Ok) { #ok() };
                        case (#Err(e)) { #err(#TransferFailed("Sneed Lock refused the position transfer: " # e.message)) };
                    };
                };
            };
        } catch (_e) { #err(#TransferFailed("Failed to call Sneed Lock")) };
    };
    
    /// NFTs of Sneed Lock's own collection are locks, and get the rules of the Sneed Lock asset type:
    /// every lock must still be locked and outlive the offer (`offerExpiration`, ns), checked when
    /// listed and again at escrow (a seller can start dissolving a lock until Sneedex holds it).
    /// With `checkGas`, a token lock must also be able to pay the ledger fee of its delivery: two
    /// fees in its gas tank, or one free fee in Sneedex's own Sneed Lock wallet.
    public func checkSneedLockNfts(sneedLockId : Principal, sneedex : Principal, tokenIds : [Nat], offerExpiration : ?Int, checkGas : Bool) : async* T.Result<()> {
        let nfts : T.SneedLockNftActor = actor (Principal.toText(sneedLockId));
        try {
            let metas = await nfts.icrc7_token_metadata(tokenIds);
            var i = 0;
            for (m in metas.vals()) {
                let tid = tokenIds[i];
                i += 1;
                let fields = switch (m) { case (?f) f; case null { return #err(#InvalidAsset("Sneed Lock NFT " # Nat.toText(tid) # " does not exist (an unlocked lock is no longer an NFT)")) } };
                var kind = ""; var lockId : ?Nat = null;
                for ((k, v) in fields.vals()) {
                    switch (k, v) {
                        case ("sneedlock:kind", #Text(t)) { kind := t };
                        case ("sneedlock:lock_id", #Nat(n)) { lockId := ?n };
                        case _ {};
                    };
                };
                // a position's NFT keeps its first lock id; its current lock is named in the metadata
                let current = switch (lockId) { case (?n) n; case null { return #err(#InvalidAsset("Sneed Lock NFT " # Nat.toText(tid) # " has no current lock")) } };
                let expiry = switch (await sneedLock(sneedLockId).get_lock_by_id(current)) {
                    case (?#TokenLock(_, _, l)) l.expiry;
                    case (?#PositionLock(_, _, l)) l.expiry;
                    case null { return #err(#InvalidAsset("Lock " # Nat.toText(current) # " does not exist in Sneed Lock")) };
                };
                if (Nat64.toNat(expiry) <= Int.abs(Time.now())) { return #err(#InvalidAsset("Lock " # Nat.toText(current) # " has expired")) };
                switch (offerExpiration) {
                    case (?e) { if (Nat64.toNat(expiry) <= Int.abs(e)) { return #err(#InvalidAsset("Lock " # Nat.toText(current) # " unlocks before the offer ends; a lock must outlive the offer")) } };
                    case null {};
                };
                if (checkGas and kind == "token") {
                    let gas = switch (await nfts.get_lock_gas(tid)) { case (?g) g; case null { return #err(#InvalidAsset("Lock " # Nat.toText(tid) # " has no gas account")) } };
                    let l : T.ICRC1Actor = actor (Principal.toText(gas.ledger));
                    let fee = await l.icrc1_fee();
                    let tank = await l.icrc1_balance_of(gas.account);
                    if (tank < 2 * fee) {
                        switch (await* sneedexFreeBalanceInSneedLock(sneedLockId, sneedex, gas.ledger)) {
                            case (#ok((free, _))) {
                                if (free < fee) {
                                    return #err(#InvalidAsset("Lock " # Nat.toText(tid) # " needs gas to be delivered: add at least " # Nat.toText(2 * fee - tank) # " more of its token to its gas account (anyone can, from the lock or NFT page)"));
                                };
                            };
                            case (#err(e)) { return #err(e) };
                        };
                    };
                };
            };
            #ok();
        } catch (_e) { #err(#TransferFailed("Failed to read the lock NFTs from Sneed Lock")) };
    };

    /// ICRC-37 listing: the seller approved Sneedex; pull the tokens into the escrow subaccount.
    public func pullNfts(
        collectionCanisterId : Principal,
        from : T.Account,
        sneedex : Principal,
        subaccount : Blob,
        tokenIds : [Nat]
    ) : async* T.Result<()> {
        let collection = getICRC7Collection(collectionCanisterId);
        try {
            let args = Array.map<Nat, T.ICRC37TransferFromArg>(tokenIds, func(id) { { spender_subaccount = null; from = from; to = { owner = sneedex; subaccount = ?subaccount }; token_id = id; memo = null; created_at_time = null } });
            let results = await collection.icrc37_transfer_from(args);
            var i = 0;
            for (r in results.vals()) {
                switch (r) {
                    case (?#Ok(_)) {};
                    case (?#Err(e)) { return #err(#TransferFailed("NFT " # (if (i < tokenIds.size()) { Nat.toText(tokenIds[i]) } else { "?" }) # ": " # nftErrorText(e))) };
                    case null { return #err(#TransferFailed("NFT " # (if (i < tokenIds.size()) { Nat.toText(tokenIds[i]) } else { "?" }) # ": not processed")) };
                };
                i += 1;
            };
            #ok();
        } catch (_e) {
            #err(#TransferFailed("Failed to pull NFTs (does the collection implement ICRC-37, and is Sneedex approved?)"));
        };
    };
    func nftErrorText(e : T.ICRC7TransferError) : Text {
        switch (e) {
            case (#NonExistingTokenId) { "no such token" }; case (#InvalidRecipient) { "invalid recipient" }; case (#Unauthorized) { "unauthorized" };
            case (#TooOld) { "too old" }; case (#CreatedInFuture(_)) { "created in future" }; case (#Duplicate(d)) { "duplicate of " # Nat.toText(d.duplicate_of) };
            case (#GenericError(g)) { g.message }; case (#GenericBatchError(g)) { g.message };
        };
    };
    
    // ============================================
    // EXT NFTs (Toniq / Entrepot standard)
    // ============================================
    // A holder is an account identifier (hex). Sneedex holds an offer's EXT tokens in the account
    // id of (Sneedex, the offer's escrow subaccount). Every call is a bounded-wait call: a call
    // whose answer is lost is followed by a bearer() read, which is the truth.

    let EXT_READ_TIMEOUT : Nat32 = 30;
    let EXT_TRANSFER_TIMEOUT : Nat32 = 60;

    func extCollection(collection : Principal) : Ext.TransferCollection {
        actor (Principal.toText(collection)) : Ext.TransferCollection;
    };

    /// The account id holding an EXT token (lowercase hex), or why it could not be read.
    public func extBearer(collection : Principal, index : Nat32) : async* T.Result<Text> {
        let tid = Ext.tokenIdentifier(collection, index);
        try {
            switch (await (with timeout = EXT_READ_TIMEOUT) extCollection(collection).bearer(tid)) {
                case (#ok(aid)) { #ok(Text.toLowercase(aid)) };
                case (#err(#InvalidToken(_))) { #err(#InvalidAsset("EXT token " # Nat32.toText(index) # " does not exist in this collection")) };
                case (#err(#Other(t))) { #err(#TransferFailed("The collection could not say who holds EXT token " # Nat32.toText(index) # ": " # t)) };
            };
        } catch (_e) {
            #err(#TransferFailed("Failed to read the holder of EXT token " # Nat32.toText(index) # " (is this an EXT collection?)"));
        };
    };

    /// Every listed token is held by `account` (an account id).
    public func verifyExtHeldBy(collection : Principal, indices : [Nat32], account : Text, what : Text) : async* T.Result<()> {
        for (index in indices.vals()) {
            switch (await* extBearer(collection, index)) {
                case (#err(e)) { return #err(e) };
                case (#ok(holder)) {
                    if (holder != account) { return #err(#InvalidAsset("EXT token " # Nat32.toText(index) # " is not " # what # " (it is held by account " # holder # ")")) };
                };
            };
        };
        #ok();
    };

    func extErrorText(e : { #Unauthorized : Text; #InsufficientBalance; #Rejected; #InvalidToken : Text; #CannotNotify : Text; #Other : Text }) : Text {
        switch (e) {
            case (#Unauthorized(a)) { "unauthorized (" # a # ")" }; case (#InsufficientBalance) { "insufficient balance" };
            case (#Rejected) { "rejected" }; case (#InvalidToken(t)) { "invalid token " # t };
            case (#CannotNotify(a)) { "cannot notify " # a }; case (#Other(t)) { t };
        };
    };

    /// Move one EXT token out of Sneedex's account (`fromSubaccount`, null = the default account)
    /// to `to`, then read the holder back: Ok only once the collection says `to` holds it.
    /// EXT checks that `from` is the holder and that the caller's account (caller +
    /// `subaccount`) is `from`; `from` is therefore the account id of that subaccount, not
    /// Sneedex's principal (which would name its default account).
    public func transferExtFrom(collection : Principal, sneedex : Principal, fromSubaccount : ?Blob, index : Nat32, to : Principal) : async* T.Result<()> {
        let tid = Ext.tokenIdentifier(collection, index);
        let fromAid = switch (fromSubaccount) { case (?s) { Ext.accountIdOf(sneedex, s) }; case null { Ext.accountId(sneedex) } };
        let toAid = Ext.accountId(to);
        let refusal : ?Text = try {
            switch (await (with timeout = EXT_TRANSFER_TIMEOUT) extCollection(collection).transfer({
                from = #address(fromAid); to = #principal(to); token = tid; amount = 1; memo = ""; notify = false; subaccount = fromSubaccount;
            })) {
                case (#ok(_)) { null };
                case (#err(e)) { ?extErrorText(e) };
            };
        } catch (_e) { ?"the call failed or its answer was lost" };
        // the holder is the truth, whatever the answer was (a lost answer may hide a done transfer)
        switch (await* extBearer(collection, index)) {
            case (#ok(holder)) {
                if (holder == toAid) { return #ok() };
                switch (refusal) {
                    case (?r) { #err(#TransferFailed("EXT token " # Nat32.toText(index) # ": " # r)) };
                    case null { #err(#TransferFailed("EXT token " # Nat32.toText(index) # ": the collection answered ok but the token is held by account " # holder)) };
                };
            };
            case (#err(e)) {
                switch (refusal) {
                    case (?r) { #err(#TransferFailed("EXT token " # Nat32.toText(index) # ": " # r)) };
                    case null { #err(e) };
                };
            };
        };
    };

    /// Hand over the listed tokens that are still in the offer's escrow account, and only those:
    /// a token the recipient already holds counts as delivered, and a token held by anyone else
    /// has left the escrow before (only Sneedex can move it out, and only to this offer's
    /// recipient), so a retry never moves a token twice. Stops at the first failure.
    /// Returns how many tokens this call moved.
    public func deliverEscrowedExt(collection : Principal, sneedex : Principal, escrowSubaccount : Blob, to : Principal, indices : [Nat32]) : async* T.Result<Nat> {
        let escrowAid = Ext.accountIdOf(sneedex, escrowSubaccount);
        var moved = 0;
        for (index in indices.vals()) {
            switch (await* extBearer(collection, index)) {
                case (#err(e)) { return #err(e) };
                case (#ok(holder)) {
                    if (holder == escrowAid) {
                        switch (await* transferExtFrom(collection, sneedex, ?escrowSubaccount, index, to)) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(_)) { moved += 1 };
                        };
                    };
                };
            };
        };
        #ok(moved);
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

