import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Array "mo:base/Array";
import Text "mo:base/Text";
import Timer "mo:base/Timer";
import Blob "mo:base/Blob";

import T "Types";
import Utils "Utils";
import AssetHandlers "AssetHandlers";

shared (deployer) persistent actor class Sneedex(initConfig : ?T.Config) = this {
    // ============================================
    // STATE
    // ============================================
    
    // Configuration
    var config : T.Config = switch (initConfig) {
        case (?c) { c };
        case null { T.DEFAULT_CONFIG };
    };
    
    // Counters for unique IDs
    var nextOfferId : T.OfferId = 0;
    var nextBidId : T.BidId = 0;
    var nextAssetTypeId : T.AssetTypeId = 3; // 0, 1, 2 are reserved for built-in types
    
    // Asset types registry
    var assetTypes : [T.AssetType] = [
        { id = T.ASSET_TYPE_CANISTER; name = "Canister"; description = "Internet Computer canister"; active = true },
        { id = T.ASSET_TYPE_SNS_NEURON; name = "SNS Neuron"; description = "SNS governance neuron"; active = true },
        { id = T.ASSET_TYPE_ICRC1_TOKEN; name = "ICRC1 Token"; description = "ICRC1 fungible token"; active = true },
    ];
    
    // Offers storage
    var offers : [T.Offer] = [];
    
    // Bids storage  
    var bids : [T.Bid] = [];
    
    // ============================================
    // PRIVATE HELPERS
    // ============================================
    
    func isAdmin(caller : Principal) : Bool {
        Utils.principalInList(caller, config.admins);
    };
    
    func getOffer(offerId : T.OfferId) : ?T.Offer {
        for (offer in offers.vals()) {
            if (offer.id == offerId) return ?offer;
        };
        null;
    };
    
    func getBid(bidId : T.BidId) : ?T.Bid {
        for (bid in bids.vals()) {
            if (bid.id == bidId) return ?bid;
        };
        null;
    };
    
    func updateOffer(offerId : T.OfferId, newOffer : T.Offer) {
        offers := Array.map<T.Offer, T.Offer>(offers, func(o : T.Offer) : T.Offer {
            if (o.id == offerId) { newOffer } else { o };
        });
    };
    
    func updateBid(bidId : T.BidId, newBid : T.Bid) {
        bids := Array.map<T.Bid, T.Bid>(bids, func(b : T.Bid) : T.Bid {
            if (b.id == bidId) { newBid } else { b };
        });
    };
    
    /// Auto-refund a lost bid (called via Timer)
    /// This is a best-effort operation - if it fails, user can manually refund from GUI
    func autoRefundBid(bidId : T.BidId) : async () {
        switch (getBid(bidId)) {
            case null { /* Bid not found, ignore */ };
            case (?bid) {
                // Only refund if bid is Lost and has escrowed tokens
                if (bid.state != #Lost or not bid.tokens_escrowed) {
                    return;
                };
                
                switch (getOffer(bid.offer_id)) {
                    case null { /* Offer not found, ignore */ };
                    case (?offer) {
                        // Get fee and calculate refund amount
                        let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
                        let refundAmount = if (bid.amount > fee) { bid.amount - fee } else { 0 };
                        
                        if (refundAmount == 0) {
                            return; // Amount too small to refund
                        };
                        
                        let subaccount = Utils.bidEscrowSubaccount(bid.bidder, bid.id);
                        let transferResult = await* AssetHandlers.transferTokens(
                            offer.price_token_ledger,
                            ?subaccount,
                            { owner = bid.bidder; subaccount = null },
                            refundAmount
                        );
                        
                        switch (transferResult) {
                            case (#err(_e)) { 
                                // Transfer failed - user can manually refund later
                            };
                            case (#ok(_)) {
                                // Update bid state to Refunded
                                let updatedBid : T.Bid = {
                                    id = bid.id;
                                    offer_id = bid.offer_id;
                                    bidder = bid.bidder;
                                    amount = bid.amount;
                                    state = #Refunded;
                                    created_at = bid.created_at;
                                    tokens_escrowed = bid.tokens_escrowed;
                                };
                                updateBid(bid.id, updatedBid);
                            };
                        };
                    };
                };
            };
        };
    };
    
    /// Schedule auto-refund for a bid using Timer (1 second delay)
    func scheduleAutoRefund<system>(bidId : T.BidId) {
        ignore Timer.setTimer<system>(#seconds 1, func() : async () {
            await autoRefundBid(bidId);
        });
    };
    
    /// Auto-deliver assets to winning bidder (called via Timer)
    /// Best effort - if it fails, buyer can manually claim from GUI
    func autoDeliverAssets(offerId : T.OfferId) : async () {
        switch (getOffer(offerId)) {
            case null { /* Offer not found, ignore */ };
            case (?offer) {
                switch (offer.state) {
                    case (#Completed(completion)) {
                        switch (getBid(completion.winning_bid_id)) {
                            case null { /* Bid not found, ignore */ };
                            case (?bid) {
                                // Transfer all assets to the winner
                                for (entry in offer.assets.vals()) {
                                    switch (entry.asset) {
                                        case (#Canister(asset)) {
                                            let _ = await* AssetHandlers.transferCanister(
                                                asset.canister_id,
                                                [bid.bidder]
                                            );
                                        };
                                        case (#SNSNeuron(asset)) {
                                            let _ = await* AssetHandlers.transferNeuron(
                                                asset.governance_canister_id,
                                                asset.neuron_id,
                                                self(),
                                                [bid.bidder]
                                            );
                                        };
                                        case (#ICRC1Token(asset)) {
                                            let subaccount = Utils.offerEscrowSubaccount(offer.creator, offerId);
                                            let _ = await* AssetHandlers.transferTokens(
                                                asset.ledger_canister_id,
                                                ?subaccount,
                                                { owner = bid.bidder; subaccount = null },
                                                asset.amount
                                            );
                                        };
                                    };
                                };
                                
                                // Update state to Claimed
                                let updatedOffer : T.Offer = {
                                    id = offer.id;
                                    creator = offer.creator;
                                    min_bid_price = offer.min_bid_price;
                                    buyout_price = offer.buyout_price;
                                    expiration = offer.expiration;
                                    price_token_ledger = offer.price_token_ledger;
                                    assets = offer.assets;
                                    state = #Claimed;
                                    created_at = offer.created_at;
                                    activated_at = offer.activated_at;
                                };
                                updateOffer(offerId, updatedOffer);
                            };
                        };
                    };
                    case (_) { /* Wrong state, ignore */ };
                };
            };
        };
    };
    
    /// Auto-deliver payment to seller (called via Timer)
    /// Best effort - if it fails, seller can manually claim from GUI
    func autoDeliverPayment(offerId : T.OfferId) : async () {
        switch (getOffer(offerId)) {
            case null { /* Offer not found, ignore */ };
            case (?offer) {
                // Check if state is Completed or Claimed
                let winningBidId : ?T.BidId = switch (offer.state) {
                    case (#Completed(completion)) { ?completion.winning_bid_id };
                    case (#Claimed) {
                        // Find winning bid
                        var found : ?T.BidId = null;
                        for (b in getBidsForOffer(offerId).vals()) {
                            if (b.state == #Won) { found := ?b.id };
                        };
                        found;
                    };
                    case (_) { null };
                };
                
                switch (winningBidId) {
                    case null { /* No winning bid, ignore */ };
                    case (?bidId) {
                        switch (getBid(bidId)) {
                            case null { /* Bid not found, ignore */ };
                            case (?bid) {
                                if (bid.state != #Won) { return }; // Already claimed
                                
                                // Get fee and calculate transfer amount
                                let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
                                let transferAmount = if (bid.amount > fee) { bid.amount - fee } else { 0 };
                                
                                if (transferAmount == 0) { return };
                                
                                // Transfer tokens to seller
                                let subaccount = Utils.bidEscrowSubaccount(bid.bidder, bid.id);
                                let transferResult = await* AssetHandlers.transferTokens(
                                    offer.price_token_ledger,
                                    ?subaccount,
                                    { owner = offer.creator; subaccount = null },
                                    transferAmount
                                );
                                
                                switch (transferResult) {
                                    case (#err(_e)) { /* Transfer failed, user can manually claim */ };
                                    case (#ok(_)) {
                                        // Update bid state to ClaimedBySeller
                                        let updatedBid : T.Bid = {
                                            id = bid.id;
                                            offer_id = bid.offer_id;
                                            bidder = bid.bidder;
                                            amount = bid.amount;
                                            state = #ClaimedBySeller;
                                            created_at = bid.created_at;
                                            tokens_escrowed = bid.tokens_escrowed;
                                        };
                                        updateBid(bid.id, updatedBid);
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
    };
    
    /// Auto-reclaim assets for expired/cancelled offers (called via Timer)
    /// Best effort - if it fails, seller can manually reclaim from GUI
    func autoReclaimAssets(offerId : T.OfferId) : async () {
        switch (getOffer(offerId)) {
            case null { /* Offer not found, ignore */ };
            case (?offer) {
                if (offer.state != #Expired and offer.state != #Cancelled) {
                    return; // Wrong state
                };
                
                // Transfer all escrowed assets back to creator
                for (entry in offer.assets.vals()) {
                    if (entry.escrowed) {
                        switch (entry.asset) {
                            case (#Canister(asset)) {
                                switch (asset.controllers_snapshot) {
                                    case (?snapshot) {
                                        let _ = await* AssetHandlers.releaseCanister(
                                            asset.canister_id,
                                            snapshot
                                        );
                                    };
                                    case null {
                                        let _ = await* AssetHandlers.transferCanister(
                                            asset.canister_id,
                                            [offer.creator]
                                        );
                                    };
                                };
                            };
                            case (#SNSNeuron(asset)) {
                                switch (asset.hotkeys_snapshot) {
                                    case (?snapshot) {
                                        let _ = await* AssetHandlers.releaseNeuron(
                                            asset.governance_canister_id,
                                            asset.neuron_id,
                                            self(),
                                            snapshot
                                        );
                                    };
                                    case null {
                                        let _ = await* AssetHandlers.transferNeuron(
                                            asset.governance_canister_id,
                                            asset.neuron_id,
                                            self(),
                                            [offer.creator]
                                        );
                                    };
                                };
                            };
                            case (#ICRC1Token(asset)) {
                                let subaccount = Utils.offerEscrowSubaccount(offer.creator, offerId);
                                let _ = await* AssetHandlers.transferTokens(
                                    asset.ledger_canister_id,
                                    ?subaccount,
                                    { owner = offer.creator; subaccount = null },
                                    asset.amount
                                );
                            };
                        };
                    };
                };
                
                // Update state to Reclaimed
                let updatedOffer : T.Offer = {
                    id = offer.id;
                    creator = offer.creator;
                    min_bid_price = offer.min_bid_price;
                    buyout_price = offer.buyout_price;
                    expiration = offer.expiration;
                    price_token_ledger = offer.price_token_ledger;
                    assets = offer.assets;
                    state = #Reclaimed;
                    created_at = offer.created_at;
                    activated_at = offer.activated_at;
                };
                updateOffer(offerId, updatedOffer);
            };
        };
    };
    
    /// Schedule auto-delivery of assets to buyer (2 second delay)
    func scheduleAutoDeliverAssets<system>(offerId : T.OfferId) {
        ignore Timer.setTimer<system>(#seconds 2, func() : async () {
            await autoDeliverAssets(offerId);
        });
    };
    
    /// Schedule auto-delivery of payment to seller (3 second delay, after assets)
    func scheduleAutoDeliverPayment<system>(offerId : T.OfferId) {
        ignore Timer.setTimer<system>(#seconds 3, func() : async () {
            await autoDeliverPayment(offerId);
        });
    };
    
    /// Schedule auto-reclaim of assets for expired/cancelled offers (2 second delay)
    func scheduleAutoReclaimAssets<system>(offerId : T.OfferId) {
        ignore Timer.setTimer<system>(#seconds 2, func() : async () {
            await autoReclaimAssets(offerId);
        });
    };
    
    func getBidsForOffer(offerId : T.OfferId) : [T.Bid] {
        Array.filter<T.Bid>(bids, func(b : T.Bid) : Bool {
            b.offer_id == offerId;
        });
    };
    
    func getActiveBidsForOffer(offerId : T.OfferId) : [T.Bid] {
        Array.filter<T.Bid>(bids, func(b : T.Bid) : Bool {
            b.offer_id == offerId and b.state == #Pending and b.tokens_escrowed;
        });
    };
    
    func getHighestBid(offerId : T.OfferId) : ?T.Bid {
        let activeBids = getActiveBidsForOffer(offerId);
        if (activeBids.size() == 0) return null;
        
        var highest : ?T.Bid = null;
        var highestAmount : Nat = 0;
        
        for (bid in activeBids.vals()) {
            if (bid.amount > highestAmount) {
                highest := ?bid;
                highestAmount := bid.amount;
            };
        };
        
        highest;
    };
    
    func self() : Principal {
        Principal.fromActor(this);
    };
    
    // ============================================
    // ASSET TYPE MANAGEMENT (Admin)
    // ============================================
    
    /// Add a new asset type (admin only)
    public shared ({ caller }) func addAssetType(name : Text, description : Text) : async T.Result<T.AssetTypeId> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        let id = nextAssetTypeId;
        nextAssetTypeId += 1;
        
        let newType : T.AssetType = {
            id = id;
            name = name;
            description = description;
            active = true;
        };
        
        assetTypes := Array.append(assetTypes, [newType]);
        
        #ok(id);
    };
    
    /// Deactivate an asset type (admin only)
    public shared ({ caller }) func deactivateAssetType(assetTypeId : T.AssetTypeId) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        assetTypes := Array.map<T.AssetType, T.AssetType>(assetTypes, func(t : T.AssetType) : T.AssetType {
            if (t.id == assetTypeId) {
                { id = t.id; name = t.name; description = t.description; active = false };
            } else { t };
        });
        
        #ok();
    };
    
    /// Get all asset types
    public query func getAssetTypes() : async [T.AssetType] {
        assetTypes;
    };
    
    // ============================================
    // OFFER CREATION AND MANAGEMENT
    // ============================================
    
    /// Create a new offer in Draft state
    public shared ({ caller }) func createOffer(request : T.CreateOfferRequest) : async T.Result<T.OfferId> {
        // Validate: must have buyout or expiration
        switch (request.buyout_price, request.expiration) {
            case (null, null) {
                return #err(#OfferMustHaveBuyoutOrExpiration);
            };
            case (_, ?exp) {
                // Validate expiration is in the future
                if (exp < Time.now() + config.min_offer_duration_ns) {
                    return #err(#InvalidExpiration);
                };
            };
            case (_, _) {};
        };
        
        // Validate min_bid <= buyout (if both set)
        switch (request.min_bid_price, request.buyout_price) {
            case (?minBid, ?buyout) {
                if (minBid > buyout) {
                    return #err(#InvalidPrice("Minimum bid cannot exceed buyout price"));
                };
            };
            case (_, _) {};
        };
        
        let offerId = nextOfferId;
        nextOfferId += 1;
        
        let offer : T.Offer = {
            id = offerId;
            creator = caller;
            min_bid_price = request.min_bid_price;
            buyout_price = request.buyout_price;
            expiration = request.expiration;
            price_token_ledger = request.price_token_ledger;
            assets = [];
            state = #Draft;
            created_at = Time.now();
            activated_at = null;
        };
        
        offers := Array.append(offers, [offer]);
        
        #ok(offerId);
    };
    
    // Helper to check if an asset already exists in an offer
    func assetExists(assets : [T.AssetEntry], newAsset : T.Asset) : Bool {
        for (entry in assets.vals()) {
            switch (entry.asset, newAsset) {
                case (#Canister(existing), #Canister(new)) {
                    if (Principal.equal(existing.canister_id, new.canister_id)) {
                        return true;
                    };
                };
                case (#SNSNeuron(existing), #SNSNeuron(new)) {
                    if (Principal.equal(existing.governance_canister_id, new.governance_canister_id) and 
                        Blob.equal(existing.neuron_id.id, new.neuron_id.id)) {
                        return true;
                    };
                };
                case (#ICRC1Token(existing), #ICRC1Token(new)) {
                    if (Principal.equal(existing.ledger_canister_id, new.ledger_canister_id)) {
                        return true;
                    };
                };
                case (_, _) {};
            };
        };
        false;
    };
    
    /// Add an asset to an offer (must be in Draft state)
    public shared ({ caller }) func addAsset(request : T.AddAssetRequest) : async T.Result<()> {
        switch (getOffer(request.offer_id)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                // Must be creator
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                // Must be in Draft state
                if (offer.state != #Draft) {
                    return #err(#InvalidState("Offer must be in Draft state to add assets"));
                };
                
                // Check max assets
                if (offer.assets.size() >= config.max_assets_per_offer) {
                    return #err(#InvalidAsset("Maximum number of assets reached"));
                };
                
                // Check for duplicate asset
                if (assetExists(offer.assets, request.asset)) {
                    return #err(#InvalidAsset("This asset has already been added to the offer"));
                };
                
                // Add asset entry
                let entry : T.AssetEntry = {
                    asset = request.asset;
                    escrowed = false;
                };
                
                let updatedOffer : T.Offer = {
                    id = offer.id;
                    creator = offer.creator;
                    min_bid_price = offer.min_bid_price;
                    buyout_price = offer.buyout_price;
                    expiration = offer.expiration;
                    price_token_ledger = offer.price_token_ledger;
                    assets = Array.append(offer.assets, [entry]);
                    state = offer.state;
                    created_at = offer.created_at;
                    activated_at = offer.activated_at;
                };
                
                updateOffer(request.offer_id, updatedOffer);
                #ok();
            };
        };
    };
    
    /// Finalize asset declaration and move to PendingEscrow
    public shared ({ caller }) func finalizeAssets(offerId : T.OfferId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                if (offer.state != #Draft) {
                    return #err(#InvalidState("Offer must be in Draft state"));
                };
                
                if (offer.assets.size() == 0) {
                    return #err(#InvalidAsset("Offer must have at least one asset"));
                };
                
                let updatedOffer : T.Offer = {
                    id = offer.id;
                    creator = offer.creator;
                    min_bid_price = offer.min_bid_price;
                    buyout_price = offer.buyout_price;
                    expiration = offer.expiration;
                    price_token_ledger = offer.price_token_ledger;
                    assets = offer.assets;
                    state = #PendingEscrow;
                    created_at = offer.created_at;
                    activated_at = offer.activated_at;
                };
                
                updateOffer(offerId, updatedOffer);
                #ok();
            };
        };
    };
    
    // ============================================
    // ESCROW MANAGEMENT
    // ============================================
    
    /// Escrow a canister asset
    public shared ({ caller }) func escrowCanister(offerId : T.OfferId, assetIndex : Nat) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                if (offer.state != #PendingEscrow) {
                    return #err(#InvalidState("Offer must be in PendingEscrow state"));
                };
                
                if (assetIndex >= offer.assets.size()) {
                    return #err(#InvalidAsset("Asset index out of bounds"));
                };
                
                let assetEntry = offer.assets[assetIndex];
                
                if (assetEntry.escrowed) {
                    return #err(#InvalidAsset("Asset already escrowed"));
                };
                
                switch (assetEntry.asset) {
                    case (#Canister(canisterAsset)) {
                        // Verify controllers
                        let verifyResult = await* AssetHandlers.verifyCanisterControllers(
                            canisterAsset.canister_id,
                            caller,
                            self()
                        );
                        
                        switch (verifyResult) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(controllers)) {
                                // Escrow the canister
                                let escrowResult = await* AssetHandlers.escrowCanister(
                                    canisterAsset.canister_id,
                                    self(),
                                    controllers
                                );
                                
                                switch (escrowResult) {
                                    case (#err(e)) { return #err(e) };
                                    case (#ok(snapshot)) {
                                        // Update asset with snapshot
                                        let updatedAsset : T.Asset = #Canister({
                                            canister_id = canisterAsset.canister_id;
                                            controllers_snapshot = ?snapshot;
                                        });
                                        
                                        let updatedEntry : T.AssetEntry = {
                                            asset = updatedAsset;
                                            escrowed = true;
                                        };
                                        
                                        let updatedAssets = Utils.updateAt(offer.assets, assetIndex, updatedEntry);
                                        
                                        let updatedOffer : T.Offer = {
                                            id = offer.id;
                                            creator = offer.creator;
                                            min_bid_price = offer.min_bid_price;
                                            buyout_price = offer.buyout_price;
                                            expiration = offer.expiration;
                                            price_token_ledger = offer.price_token_ledger;
                                            assets = updatedAssets;
                                            state = offer.state;
                                            created_at = offer.created_at;
                                            activated_at = offer.activated_at;
                                        };
                                        
                                        updateOffer(offerId, updatedOffer);
                                        #ok();
                                    };
                                };
                            };
                        };
                    };
                    case (_) {
                        return #err(#InvalidAsset("Asset at index is not a canister"));
                    };
                };
            };
        };
    };
    
    /// Escrow an SNS Neuron asset
    public shared ({ caller }) func escrowSNSNeuron(offerId : T.OfferId, assetIndex : Nat) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                if (offer.state != #PendingEscrow) {
                    return #err(#InvalidState("Offer must be in PendingEscrow state"));
                };
                
                if (assetIndex >= offer.assets.size()) {
                    return #err(#InvalidAsset("Asset index out of bounds"));
                };
                
                let assetEntry = offer.assets[assetIndex];
                
                if (assetEntry.escrowed) {
                    return #err(#InvalidAsset("Asset already escrowed"));
                };
                
                switch (assetEntry.asset) {
                    case (#SNSNeuron(neuronAsset)) {
                        // Verify hotkeys
                        let verifyResult = await* AssetHandlers.verifyNeuronHotkeys(
                            neuronAsset.governance_canister_id,
                            neuronAsset.neuron_id,
                            caller,
                            self()
                        );
                        
                        switch (verifyResult) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(owners)) {
                                // Escrow the neuron
                                let escrowResult = await* AssetHandlers.escrowNeuron(
                                    neuronAsset.governance_canister_id,
                                    neuronAsset.neuron_id,
                                    self(),
                                    owners
                                );
                                
                                switch (escrowResult) {
                                    case (#err(e)) { return #err(e) };
                                    case (#ok(snapshot)) {
                                        // Update asset with snapshot
                                        let updatedAsset : T.Asset = #SNSNeuron({
                                            governance_canister_id = neuronAsset.governance_canister_id;
                                            neuron_id = neuronAsset.neuron_id;
                                            hotkeys_snapshot = ?snapshot;
                                        });
                                        
                                        let updatedEntry : T.AssetEntry = {
                                            asset = updatedAsset;
                                            escrowed = true;
                                        };
                                        
                                        let updatedAssets = Utils.updateAt(offer.assets, assetIndex, updatedEntry);
                                        
                                        let updatedOffer : T.Offer = {
                                            id = offer.id;
                                            creator = offer.creator;
                                            min_bid_price = offer.min_bid_price;
                                            buyout_price = offer.buyout_price;
                                            expiration = offer.expiration;
                                            price_token_ledger = offer.price_token_ledger;
                                            assets = updatedAssets;
                                            state = offer.state;
                                            created_at = offer.created_at;
                                            activated_at = offer.activated_at;
                                        };
                                        
                                        updateOffer(offerId, updatedOffer);
                                        #ok();
                                    };
                                };
                            };
                        };
                    };
                    case (_) {
                        return #err(#InvalidAsset("Asset at index is not an SNS Neuron"));
                    };
                };
            };
        };
    };
    
    /// Verify and escrow ICRC1 tokens (user must have transferred tokens to the escrow subaccount first)
    public shared ({ caller }) func escrowICRC1Tokens(offerId : T.OfferId, assetIndex : Nat) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                if (offer.state != #PendingEscrow) {
                    return #err(#InvalidState("Offer must be in PendingEscrow state"));
                };
                
                if (assetIndex >= offer.assets.size()) {
                    return #err(#InvalidAsset("Asset index out of bounds"));
                };
                
                let assetEntry = offer.assets[assetIndex];
                
                if (assetEntry.escrowed) {
                    return #err(#InvalidAsset("Asset already escrowed"));
                };
                
                switch (assetEntry.asset) {
                    case (#ICRC1Token(tokenAsset)) {
                        // Generate the escrow subaccount
                        let subaccount = Utils.offerEscrowSubaccount(caller, offerId);
                        
                        // Verify tokens are present
                        let verifyResult = await* AssetHandlers.verifyTokenEscrow(
                            tokenAsset.ledger_canister_id,
                            self(),
                            subaccount,
                            tokenAsset.amount
                        );
                        
                        switch (verifyResult) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(_)) {
                                // Mark as escrowed
                                let updatedEntry : T.AssetEntry = {
                                    asset = assetEntry.asset;
                                    escrowed = true;
                                };
                                
                                let updatedAssets = Utils.updateAt(offer.assets, assetIndex, updatedEntry);
                                
                                let updatedOffer : T.Offer = {
                                    id = offer.id;
                                    creator = offer.creator;
                                    min_bid_price = offer.min_bid_price;
                                    buyout_price = offer.buyout_price;
                                    expiration = offer.expiration;
                                    price_token_ledger = offer.price_token_ledger;
                                    assets = updatedAssets;
                                    state = offer.state;
                                    created_at = offer.created_at;
                                    activated_at = offer.activated_at;
                                };
                                
                                updateOffer(offerId, updatedOffer);
                                #ok();
                            };
                        };
                    };
                    case (_) {
                        return #err(#InvalidAsset("Asset at index is not an ICRC1 Token"));
                    };
                };
            };
        };
    };
    
    /// Activate the offer after all assets are escrowed
    public shared ({ caller }) func activateOffer(offerId : T.OfferId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                if (offer.state != #PendingEscrow) {
                    return #err(#InvalidState("Offer must be in PendingEscrow state"));
                };
                
                // Verify all assets are escrowed
                for (entry in offer.assets.vals()) {
                    if (not entry.escrowed) {
                        return #err(#InvalidState("All assets must be escrowed before activation"));
                    };
                };
                
                // Check expiration hasn't passed
                switch (offer.expiration) {
                    case (?exp) {
                        if (exp < Time.now()) {
                            return #err(#OfferExpired);
                        };
                    };
                    case null {};
                };
                
                let updatedOffer : T.Offer = {
                    id = offer.id;
                    creator = offer.creator;
                    min_bid_price = offer.min_bid_price;
                    buyout_price = offer.buyout_price;
                    expiration = offer.expiration;
                    price_token_ledger = offer.price_token_ledger;
                    assets = offer.assets;
                    state = #Active;
                    created_at = offer.created_at;
                    activated_at = ?Time.now();
                };
                
                updateOffer(offerId, updatedOffer);
                #ok();
            };
        };
    };
    
    // ============================================
    // BIDDING
    // ============================================
    
    /// Get the escrow subaccount for placing a bid
    public query func getBidEscrowSubaccount(bidder : Principal, bidId : T.BidId) : async Blob {
        Utils.bidEscrowSubaccount(bidder, bidId);
    };
    
    /// Reserve a bid ID (so user knows which subaccount to send tokens to)
    public shared ({ caller }) func reserveBid(offerId : T.OfferId) : async T.Result<T.BidId> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (offer.state != #Active) {
                    return #err(#InvalidState("Offer is not active"));
                };
                
                // Check expiration
                switch (offer.expiration) {
                    case (?exp) {
                        if (exp < Time.now()) {
                            return #err(#OfferExpired);
                        };
                    };
                    case null {};
                };
                
                let bidId = nextBidId;
                nextBidId += 1;
                
                let bid : T.Bid = {
                    id = bidId;
                    offer_id = offerId;
                    bidder = caller;
                    amount = 0; // Will be set when confirmed
                    state = #Pending;
                    created_at = Time.now();
                    tokens_escrowed = false;
                };
                
                bids := Array.append(bids, [bid]);
                
                #ok(bidId);
            };
        };
    };
    
    /// Confirm a bid after tokens have been sent to the escrow subaccount
    public shared ({ caller }) func confirmBid(bidId : T.BidId, amount : Nat) : async T.Result<()> {
        switch (getBid(bidId)) {
            case null { return #err(#BidNotFound) };
            case (?bid) {
                if (not Principal.equal(caller, bid.bidder)) {
                    return #err(#NotAuthorized);
                };
                
                if (bid.tokens_escrowed) {
                    return #err(#InvalidState("Bid already confirmed"));
                };
                
                switch (getOffer(bid.offer_id)) {
                    case null { return #err(#OfferNotFound) };
                    case (?offer) {
                        if (offer.state != #Active) {
                            return #err(#InvalidState("Offer is not active"));
                        };
                        
                        // Check expiration
                        switch (offer.expiration) {
                            case (?exp) {
                                if (exp < Time.now()) {
                                    return #err(#OfferExpired);
                                };
                            };
                            case null {};
                        };
                        
                        // Check minimum bid
                        let minBid = Utils.effectiveMinBid(offer.min_bid_price, offer.buyout_price);
                        if (amount < minBid) {
                            return #err(#BidTooLow({ minimum = minBid }));
                        };
                        
                        // Check must be higher than current highest bid
                        switch (getHighestBid(bid.offer_id)) {
                            case (?highest) {
                                if (amount <= highest.amount) {
                                    return #err(#BidTooLow({ minimum = highest.amount + 1 }));
                                };
                            };
                            case null {};
                        };
                        
                        // Verify tokens in escrow
                        let subaccount = Utils.bidEscrowSubaccount(caller, bidId);
                        let verifyResult = await* AssetHandlers.verifyTokenEscrow(
                            offer.price_token_ledger,
                            self(),
                            subaccount,
                            amount
                        );
                        
                        switch (verifyResult) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(_)) {
                                // Update bid
                                let updatedBid : T.Bid = {
                                    id = bid.id;
                                    offer_id = bid.offer_id;
                                    bidder = bid.bidder;
                                    amount = amount;
                                    state = bid.state;
                                    created_at = bid.created_at;
                                    tokens_escrowed = true;
                                };
                                
                                updateBid(bidId, updatedBid);
                                
                                // Mark all lower confirmed bids as Lost (outbid) and schedule auto-refund
                                // This allows outbid users to reclaim their funds immediately
                                // Auto-refund runs via Timer to avoid instruction limits
                                for (otherBid in getBidsForOffer(bid.offer_id).vals()) {
                                    if (otherBid.id != bidId and 
                                        otherBid.tokens_escrowed and 
                                        otherBid.state == #Pending and 
                                        otherBid.amount < amount) {
                                        let lostBid : T.Bid = {
                                            id = otherBid.id;
                                            offer_id = otherBid.offer_id;
                                            bidder = otherBid.bidder;
                                            amount = otherBid.amount;
                                            state = #Lost;
                                            created_at = otherBid.created_at;
                                            tokens_escrowed = otherBid.tokens_escrowed;
                                        };
                                        updateBid(otherBid.id, lostBid);
                                        
                                        // Schedule auto-refund via Timer (best effort)
                                        scheduleAutoRefund<system>(otherBid.id);
                                    };
                                };
                                
                                // Check for buyout
                                switch (offer.buyout_price) {
                                    case (?buyout) {
                                        if (amount >= buyout) {
                                            // Buyout! Complete the offer
                                            ignore await completeOfferInternal(bid.offer_id, bidId);
                                        };
                                    };
                                    case null {};
                                };
                                
                                #ok();
                            };
                        };
                    };
                };
            };
        };
    };
    
    // ============================================
    // OFFER COMPLETION
    // ============================================
    
    /// Internal function to complete an offer with a winning bid
    func completeOfferInternal(offerId : T.OfferId, winningBidId : T.BidId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                // Update offer state
                let updatedOffer : T.Offer = {
                    id = offer.id;
                    creator = offer.creator;
                    min_bid_price = offer.min_bid_price;
                    buyout_price = offer.buyout_price;
                    expiration = offer.expiration;
                    price_token_ledger = offer.price_token_ledger;
                    assets = offer.assets;
                    state = #Completed({
                        winning_bid_id = winningBidId;
                        completion_time = Time.now();
                    });
                    created_at = offer.created_at;
                    activated_at = offer.activated_at;
                };
                
                updateOffer(offerId, updatedOffer);
                
                // Mark winning bid as won
                switch (getBid(winningBidId)) {
                    case (?bid) {
                        let updatedBid : T.Bid = {
                            id = bid.id;
                            offer_id = bid.offer_id;
                            bidder = bid.bidder;
                            amount = bid.amount;
                            state = #Won;
                            created_at = bid.created_at;
                            tokens_escrowed = bid.tokens_escrowed;
                        };
                        updateBid(winningBidId, updatedBid);
                    };
                    case null {};
                };
                
                // Mark all other bids as lost and schedule auto-refunds
                for (bid in getBidsForOffer(offerId).vals()) {
                    if (bid.id != winningBidId and bid.state == #Pending) {
                        let updatedBid : T.Bid = {
                            id = bid.id;
                            offer_id = bid.offer_id;
                            bidder = bid.bidder;
                            amount = bid.amount;
                            state = #Lost;
                            created_at = bid.created_at;
                            tokens_escrowed = bid.tokens_escrowed;
                        };
                        updateBid(bid.id, updatedBid);
                        
                        // Schedule auto-refund for lost bid (best effort)
                        if (bid.tokens_escrowed) {
                            scheduleAutoRefund<system>(bid.id);
                        };
                    };
                };
                
                // Schedule auto-delivery to buyer and seller (best effort)
                scheduleAutoDeliverAssets<system>(offerId);
                scheduleAutoDeliverPayment<system>(offerId);
                
                #ok();
            };
        };
    };
    
    /// Seller accepts the current highest bid before expiration
    public shared ({ caller }) func acceptBid(offerId : T.OfferId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                if (offer.state != #Active) {
                    return #err(#InvalidState("Offer is not active"));
                };
                
                switch (getHighestBid(offerId)) {
                    case null {
                        return #err(#InvalidState("No bids to accept"));
                    };
                    case (?highest) {
                        await completeOfferInternal(offerId, highest.id);
                    };
                };
            };
        };
    };
    
    /// Process expiration for an offer (can be called by anyone)
    public shared func processExpiration(offerId : T.OfferId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (offer.state != #Active) {
                    return #err(#InvalidState("Offer is not active"));
                };
                
                switch (offer.expiration) {
                    case null {
                        return #err(#InvalidState("Offer has no expiration"));
                    };
                    case (?exp) {
                        if (exp > Time.now()) {
                            return #err(#InvalidState("Offer has not expired yet"));
                        };
                        
                        // Check for highest bid
                        switch (getHighestBid(offerId)) {
                            case (?highest) {
                                // Complete with highest bid
                                await completeOfferInternal(offerId, highest.id);
                            };
                            case null {
                                // No bids - mark as expired
                                let updatedOffer : T.Offer = {
                                    id = offer.id;
                                    creator = offer.creator;
                                    min_bid_price = offer.min_bid_price;
                                    buyout_price = offer.buyout_price;
                                    expiration = offer.expiration;
                                    price_token_ledger = offer.price_token_ledger;
                                    assets = offer.assets;
                                    state = #Expired;
                                    created_at = offer.created_at;
                                    activated_at = offer.activated_at;
                                };
                                
                                updateOffer(offerId, updatedOffer);
                                
                                // Schedule auto-reclaim of assets back to seller (best effort)
                                scheduleAutoReclaimAssets<system>(offerId);
                                
                                #ok();
                            };
                        };
                    };
                };
            };
        };
    };
    
    /// Cancel an offer (only if no bids)
    public shared ({ caller }) func cancelOffer(offerId : T.OfferId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                if (offer.state != #Active and offer.state != #Draft and offer.state != #PendingEscrow) {
                    return #err(#InvalidState("Offer cannot be cancelled in current state"));
                };
                
                // Check for bids
                let activeBids = getActiveBidsForOffer(offerId);
                if (activeBids.size() > 0) {
                    return #err(#CannotCancelWithBids);
                };
                
                let updatedOffer : T.Offer = {
                    id = offer.id;
                    creator = offer.creator;
                    min_bid_price = offer.min_bid_price;
                    buyout_price = offer.buyout_price;
                    expiration = offer.expiration;
                    price_token_ledger = offer.price_token_ledger;
                    assets = offer.assets;
                    state = #Cancelled;
                    created_at = offer.created_at;
                    activated_at = offer.activated_at;
                };
                
                updateOffer(offerId, updatedOffer);
                
                // Schedule auto-reclaim of assets back to seller (best effort)
                scheduleAutoReclaimAssets<system>(offerId);
                
                // Schedule auto-refund for any bids that had escrowed tokens
                for (bid in getBidsForOffer(offerId).vals()) {
                    if (bid.tokens_escrowed and bid.state == #Pending) {
                        // Mark as lost first
                        let updatedBid : T.Bid = {
                            id = bid.id;
                            offer_id = bid.offer_id;
                            bidder = bid.bidder;
                            amount = bid.amount;
                            state = #Lost;
                            created_at = bid.created_at;
                            tokens_escrowed = bid.tokens_escrowed;
                        };
                        updateBid(bid.id, updatedBid);
                        scheduleAutoRefund<system>(bid.id);
                    };
                };
                
                #ok();
            };
        };
    };
    
    // ============================================
    // CLAIMING ASSETS AND REFUNDS
    // ============================================
    
    /// Buyer claims assets from a completed offer
    public shared ({ caller }) func claimAssets(offerId : T.OfferId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                switch (offer.state) {
                    case (#Completed(completion)) {
                        switch (getBid(completion.winning_bid_id)) {
                            case null { return #err(#BidNotFound) };
                            case (?bid) {
                                if (not Principal.equal(caller, bid.bidder)) {
                                    return #err(#NotAuthorized);
                                };
                                
                                // Transfer all assets to the winner
                                for (entry in offer.assets.vals()) {
                                    switch (entry.asset) {
                                        case (#Canister(asset)) {
                                            let _ = await* AssetHandlers.transferCanister(
                                                asset.canister_id,
                                                [caller]
                                            );
                                        };
                                        case (#SNSNeuron(asset)) {
                                            let _ = await* AssetHandlers.transferNeuron(
                                                asset.governance_canister_id,
                                                asset.neuron_id,
                                                self(),
                                                [caller]
                                            );
                                        };
                                        case (#ICRC1Token(asset)) {
                                            let subaccount = Utils.offerEscrowSubaccount(offer.creator, offerId);
                                            let _ = await* AssetHandlers.transferTokens(
                                                asset.ledger_canister_id,
                                                ?subaccount,
                                                { owner = caller; subaccount = null },
                                                asset.amount
                                            );
                                        };
                                    };
                                };
                                
                                // Update state to claimed
                                let updatedOffer : T.Offer = {
                                    id = offer.id;
                                    creator = offer.creator;
                                    min_bid_price = offer.min_bid_price;
                                    buyout_price = offer.buyout_price;
                                    expiration = offer.expiration;
                                    price_token_ledger = offer.price_token_ledger;
                                    assets = offer.assets;
                                    state = #Claimed;
                                    created_at = offer.created_at;
                                    activated_at = offer.activated_at;
                                };
                                
                                updateOffer(offerId, updatedOffer);
                                #ok();
                            };
                        };
                    };
                    case (#Draft) {
                        return #err(#InvalidState("Offer is in Draft state, not completed"));
                    };
                    case (#PendingEscrow) {
                        return #err(#InvalidState("Offer is in PendingEscrow state, not completed"));
                    };
                    case (#Active) {
                        return #err(#InvalidState("Offer is Active (not yet completed). Seller must accept a bid first."));
                    };
                    case (#Expired) {
                        return #err(#InvalidState("Offer has expired"));
                    };
                    case (#Cancelled) {
                        return #err(#InvalidState("Offer was cancelled"));
                    };
                    case (#Claimed) {
                        return #err(#InvalidState("Assets already claimed"));
                    };
                    case (#Reclaimed) {
                        return #err(#InvalidState("Assets were reclaimed by seller"));
                    };
                };
            };
        };
    };
    
    /// Seller claims the winning bid tokens
    public shared ({ caller }) func claimWinningBid(offerId : T.OfferId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                switch (offer.state) {
                    case (#Completed(completion)) {
                        switch (getBid(completion.winning_bid_id)) {
                            case null { return #err(#BidNotFound) };
                            case (?bid) {
                                if (bid.state != #Won) {
                                    return #err(#InvalidState("Bid is not in won state"));
                                };
                                
                                // Get fee and calculate transfer amount (bid amount - fee)
                                let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
                                let transferAmount = if (bid.amount > fee) { bid.amount - fee } else { 0 };
                                
                                if (transferAmount == 0) {
                                    return #err(#InsufficientFunds({ available = bid.amount; required = fee }));
                                };
                                
                                // Transfer tokens to seller (amount - fee, since fee is deducted)
                                let subaccount = Utils.bidEscrowSubaccount(bid.bidder, bid.id);
                                let transferResult = await* AssetHandlers.transferTokens(
                                    offer.price_token_ledger,
                                    ?subaccount,
                                    { owner = caller; subaccount = null },
                                    transferAmount
                                );
                                
                                switch (transferResult) {
                                    case (#err(e)) { return #err(e) };
                                    case (#ok(_)) {
                                        // Update bid state
                                        let updatedBid : T.Bid = {
                                            id = bid.id;
                                            offer_id = bid.offer_id;
                                            bidder = bid.bidder;
                                            amount = bid.amount;
                                            state = #ClaimedBySeller;
                                            created_at = bid.created_at;
                                            tokens_escrowed = bid.tokens_escrowed;
                                        };
                                        
                                        updateBid(bid.id, updatedBid);
                                        #ok();
                                    };
                                };
                            };
                        };
                    };
                    case (#Claimed) {
                        // Also allow claiming after assets claimed
                        switch (getHighestBid(offerId)) {
                            case null { return #err(#BidNotFound) };
                            case (?_bid) {
                                // Get fee for transfer
                                let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
                                
                                // Find the winning bid from completed state
                                for (b in getBidsForOffer(offerId).vals()) {
                                    if (b.state == #Won) {
                                        let transferAmount = if (b.amount > fee) { b.amount - fee } else { 0 };
                                        
                                        if (transferAmount == 0) {
                                            return #err(#InsufficientFunds({ available = b.amount; required = fee }));
                                        };
                                        
                                        let subaccount = Utils.bidEscrowSubaccount(b.bidder, b.id);
                                        let transferResult = await* AssetHandlers.transferTokens(
                                            offer.price_token_ledger,
                                            ?subaccount,
                                            { owner = caller; subaccount = null },
                                            transferAmount
                                        );
                                        
                                        switch (transferResult) {
                                            case (#err(e)) { return #err(e) };
                                            case (#ok(_)) {
                                                let updatedBid : T.Bid = {
                                                    id = b.id;
                                                    offer_id = b.offer_id;
                                                    bidder = b.bidder;
                                                    amount = b.amount;
                                                    state = #ClaimedBySeller;
                                                    created_at = b.created_at;
                                                    tokens_escrowed = b.tokens_escrowed;
                                                };
                                                
                                                updateBid(b.id, updatedBid);
                                                return #ok();
                                            };
                                        };
                                    };
                                };
                                return #err(#BidNotFound);
                            };
                        };
                    };
                    case (_) {
                        return #err(#InvalidState("Offer is not completed"));
                    };
                };
            };
        };
    };
    
    /// Reclaim assets from expired or cancelled offer
    public shared ({ caller }) func reclaimAssets(offerId : T.OfferId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                
                if (offer.state != #Expired and offer.state != #Cancelled) {
                    return #err(#InvalidState("Can only reclaim from expired or cancelled offers"));
                };
                
                // Transfer all assets back to creator
                for (entry in offer.assets.vals()) {
                    if (entry.escrowed) {
                        switch (entry.asset) {
                            case (#Canister(asset)) {
                                switch (asset.controllers_snapshot) {
                                    case (?snapshot) {
                                        let _ = await* AssetHandlers.releaseCanister(
                                            asset.canister_id,
                                            snapshot
                                        );
                                    };
                                    case null {
                                        let _ = await* AssetHandlers.transferCanister(
                                            asset.canister_id,
                                            [caller]
                                        );
                                    };
                                };
                            };
                            case (#SNSNeuron(asset)) {
                                switch (asset.hotkeys_snapshot) {
                                    case (?snapshot) {
                                        let _ = await* AssetHandlers.releaseNeuron(
                                            asset.governance_canister_id,
                                            asset.neuron_id,
                                            self(),
                                            snapshot
                                        );
                                    };
                                    case null {
                                        let _ = await* AssetHandlers.transferNeuron(
                                            asset.governance_canister_id,
                                            asset.neuron_id,
                                            self(),
                                            [caller]
                                        );
                                    };
                                };
                            };
                            case (#ICRC1Token(asset)) {
                                let subaccount = Utils.offerEscrowSubaccount(caller, offerId);
                                let _ = await* AssetHandlers.transferTokens(
                                    asset.ledger_canister_id,
                                    ?subaccount,
                                    { owner = caller; subaccount = null },
                                    asset.amount
                                );
                            };
                        };
                    };
                };
                
                // Update state
                let updatedOffer : T.Offer = {
                    id = offer.id;
                    creator = offer.creator;
                    min_bid_price = offer.min_bid_price;
                    buyout_price = offer.buyout_price;
                    expiration = offer.expiration;
                    price_token_ledger = offer.price_token_ledger;
                    assets = offer.assets;
                    state = #Reclaimed;
                    created_at = offer.created_at;
                    activated_at = offer.activated_at;
                };
                
                updateOffer(offerId, updatedOffer);
                #ok();
            };
        };
    };
    
    /// Refund lost bid tokens
    public shared ({ caller }) func refundBid(bidId : T.BidId) : async T.Result<()> {
        switch (getBid(bidId)) {
            case null { return #err(#BidNotFound) };
            case (?bid) {
                if (not Principal.equal(caller, bid.bidder)) {
                    return #err(#NotAuthorized);
                };
                
                if (bid.state != #Lost) {
                    return #err(#InvalidState("Can only refund lost bids"));
                };
                
                if (not bid.tokens_escrowed) {
                    return #err(#InvalidState("No tokens escrowed"));
                };
                
                switch (getOffer(bid.offer_id)) {
                    case null { return #err(#OfferNotFound) };
                    case (?offer) {
                        // Get fee and calculate refund amount (bid amount - fee)
                        let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
                        let refundAmount = if (bid.amount > fee) { bid.amount - fee } else { 0 };
                        
                        if (refundAmount == 0) {
                            return #err(#InsufficientFunds({ available = bid.amount; required = fee }));
                        };
                        
                        let subaccount = Utils.bidEscrowSubaccount(bid.bidder, bid.id);
                        let transferResult = await* AssetHandlers.transferTokens(
                            offer.price_token_ledger,
                            ?subaccount,
                            { owner = caller; subaccount = null },
                            refundAmount
                        );
                        
                        switch (transferResult) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(_)) {
                                let updatedBid : T.Bid = {
                                    id = bid.id;
                                    offer_id = bid.offer_id;
                                    bidder = bid.bidder;
                                    amount = bid.amount;
                                    state = #Refunded;
                                    created_at = bid.created_at;
                                    tokens_escrowed = bid.tokens_escrowed;
                                };
                                
                                updateBid(bid.id, updatedBid);
                                #ok();
                            };
                        };
                    };
                };
            };
        };
    };
    
    /// Withdraw funds from bid escrow subaccount
    /// - Before confirmation: can withdraw all funds
    /// - After confirmation: can withdraw excess (balance - bid amount - 1 fee)
    ///   We reserve 1 fee so there's enough for the eventual refund/claim transfer
    public shared ({ caller }) func withdrawBidEscrow(bidId : T.BidId, amount : Nat) : async T.Result<Nat> {
        switch (getBid(bidId)) {
            case null { return #err(#BidNotFound) };
            case (?bid) {
                if (not Principal.equal(caller, bid.bidder)) {
                    return #err(#NotAuthorized);
                };
                
                // Can't withdraw from winning or refunded bids
                if (bid.state == #Won or bid.state == #Refunded) {
                    return #err(#InvalidState("Cannot withdraw from won or refunded bids"));
                };
                
                switch (getOffer(bid.offer_id)) {
                    case null { return #err(#OfferNotFound) };
                    case (?offer) {
                        let subaccount = Utils.bidEscrowSubaccount(bid.bidder, bid.id);
                        
                        // Get current balance
                        let balance = await* AssetHandlers.getTokenBalance(
                            offer.price_token_ledger,
                            self(),
                            ?subaccount
                        );
                        
                        // Get the ledger fee
                        let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
                        
                        // Calculate minimum that must remain
                        // After confirmation: bid amount + 1 fee (for eventual refund/claim transfer)
                        let minimumReserved : Nat = if (bid.tokens_escrowed) {
                            bid.amount + fee // Must keep bid amount + 1 fee for later transfer
                        } else {
                            0 // Nothing reserved yet
                        };
                        
                        let maxWithdrawable : Nat = if (balance > minimumReserved) {
                            balance - minimumReserved
                        } else {
                            0
                        };
                        
                        if (amount > maxWithdrawable) {
                            return #err(#InsufficientFunds({ 
                                available = maxWithdrawable;
                                required = amount
                            }));
                        };
                        
                        // Perform transfer back to caller
                        let transferResult = await* AssetHandlers.transferTokens(
                            offer.price_token_ledger,
                            ?subaccount,
                            { owner = caller; subaccount = null },
                            amount
                        );
                        
                        switch (transferResult) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(txId)) { return #ok(txId) };
                        };
                    };
                };
            };
        };
    };
    
    /// Get the balance in a bid escrow subaccount
    public shared func getBidEscrowBalance(bidId : T.BidId) : async T.Result<Nat> {
        switch (getBid(bidId)) {
            case null { return #err(#BidNotFound) };
            case (?bid) {
                switch (getOffer(bid.offer_id)) {
                    case null { return #err(#OfferNotFound) };
                    case (?offer) {
                        let subaccount = Utils.bidEscrowSubaccount(bid.bidder, bid.id);
                        let balance = await* AssetHandlers.getTokenBalance(
                            offer.price_token_ledger,
                            self(),
                            ?subaccount
                        );
                        #ok(balance);
                    };
                };
            };
        };
    };
    
    // ============================================
    // QUERY FUNCTIONS
    // ============================================
    
    /// Get offer escrow subaccount for ICRC1 token deposits
    public query func getOfferEscrowSubaccount(creator : Principal, offerId : T.OfferId) : async Blob {
        Utils.offerEscrowSubaccount(creator, offerId);
    };
    
    /// Get offer by ID
    public query func queryOffer(offerId : T.OfferId) : async ?T.Offer {
        getOffer(offerId);
    };
    
    /// Get offer with bids
    public query func getOfferView(offerId : T.OfferId) : async ?T.OfferView {
        switch (getOffer(offerId)) {
            case null { null };
            case (?offer) {
                let offerBids = getBidsForOffer(offerId);
                ?{
                    offer = offer;
                    bids = offerBids;
                    highest_bid = getHighestBid(offerId);
                };
            };
        };
    };
    
    /// Get all active offers
    public query func getActiveOffers() : async [T.Offer] {
        Array.filter<T.Offer>(offers, func(o : T.Offer) : Bool {
            o.state == #Active;
        });
    };
    
    /// Get offers by creator
    public query func getOffersByCreator(creator : Principal) : async [T.Offer] {
        Array.filter<T.Offer>(offers, func(o : T.Offer) : Bool {
            Principal.equal(o.creator, creator);
        });
    };
    
    /// Get bids by bidder
    public query func getBidsByBidder(bidder : Principal) : async [T.Bid] {
        Array.filter<T.Bid>(bids, func(b : T.Bid) : Bool {
            Principal.equal(b.bidder, bidder);
        });
    };
    
    /// Get bid by ID
    public query func queryBid(bidId : T.BidId) : async ?T.Bid {
        getBid(bidId);
    };
    
    /// Get market statistics
    public query func getMarketStats() : async T.MarketStats {
        var totalOffers = offers.size();
        var activeOffers = 0;
        var completedOffers = 0;
        
        for (offer in offers.vals()) {
            switch (offer.state) {
                case (#Active) { activeOffers += 1 };
                case (#Completed(_)) { completedOffers += 1 };
                case (#Claimed) { completedOffers += 1 };
                case (_) {};
            };
        };
        
        {
            total_offers = totalOffers;
            active_offers = activeOffers;
            completed_offers = completedOffers;
            total_bids = bids.size();
            total_volume_by_token = []; // TODO: implement volume tracking
        };
    };
    
    /// Get next offer ID (for preview)
    public query func getNextOfferId() : async T.OfferId {
        nextOfferId;
    };
    
    /// Get next bid ID (for preview)
    public query func getNextBidId() : async T.BidId {
        nextBidId;
    };
    
    // ============================================
    // ADMIN FUNCTIONS
    // ============================================
    
    /// Update configuration (admin only)
    public shared ({ caller }) func updateConfig(newConfig : T.Config) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        config := newConfig;
        #ok();
    };
    
    /// Get current configuration
    public query func getConfig() : async T.Config {
        config;
    };
    
    /// Add admin (existing admin only)
    public shared ({ caller }) func addAdmin(newAdmin : Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        config := {
            admins = Utils.addPrincipal(newAdmin, config.admins);
            min_offer_duration_ns = config.min_offer_duration_ns;
            max_assets_per_offer = config.max_assets_per_offer;
        };
        
        #ok();
    };
    
    /// Remove admin (existing admin only)
    public shared ({ caller }) func removeAdmin(admin : Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        config := {
            admins = Utils.removePrincipal(admin, config.admins);
            min_offer_duration_ns = config.min_offer_duration_ns;
            max_assets_per_offer = config.max_assets_per_offer;
        };
        
        #ok();
    };
};

