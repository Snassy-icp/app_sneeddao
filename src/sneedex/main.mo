import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Array "mo:base/Array";
import Text "mo:base/Text";
import Timer "mo:base/Timer";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";

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
    
    // Canister kinds registry (for known canister types with enhanced display)
    var canisterKinds : [T.CanisterKind] = [
        { id = T.CANISTER_KIND_UNKNOWN; name = "Unknown"; description = "Generic canister"; active = true },
        { id = T.CANISTER_KIND_ICP_NEURON_MANAGER; name = "ICP Neuron Manager"; description = "Sneed ICP Neuron Manager canister"; active = true },
    ];
    var _nextCanisterKindId : T.CanisterKindId = 2; // 0, 1 are reserved (prefixed with _ to suppress unused warning)
    
    // Offers storage
    var offers : [T.Offer] = [];
    
    // Bids storage  
    var bids : [T.Bid] = [];
    
    // Marketplace fee settings
    // Fee rate in basis points (100 = 1%, 250 = 2.5%, etc.)
    var marketplaceFeeRateBps : Nat = 0; // Default 0% - admin must set
    
    // Account to receive marketplace fees (default/fallback)
    var feeRecipient : T.Account = {
        owner = Principal.fromText("aaaaa-aa"); // Default to management canister (will fail transfers until set)
        subaccount = null;
    };
    
    // Per-ledger fee recipient overrides
    // Maps ledger principal to override account
    var ledgerFeeRecipients : [(Principal, T.Account)] = [];
    
    // Wallet registration settings (for auto-registering delivered assets)
    // These are optional - if not set, wallet registration is skipped
    var backendCanisterId : ?Principal = null;
    var neuronManagerFactoryCanisterId : ?Principal = null;
    
    // ============================================
    // PRIVATE HELPERS
    // ============================================
    
    // Helper to deregister canister from seller's wallet (best effort, non-blocking)
    func deregisterCanisterFromWallet(user : Principal, canisterId : Principal, isNeuronManager : Bool) : async () {
        // Deregister from tracked canisters
        switch (backendCanisterId) {
            case (?id) {
                let backend : T.BackendActor = actor(Principal.toText(id));
                try { await backend.unregister_tracked_canister_for(user, canisterId); } catch (_) {};
            };
            case null {};
        };
        
        // If it's a neuron manager, also deregister from factory
        if (isNeuronManager) {
            switch (neuronManagerFactoryCanisterId) {
                case (?id) {
                    let factory : T.NeuronManagerFactoryActor = actor(Principal.toText(id));
                    try { ignore await factory.deregisterManagerFor(user, canisterId); } catch (_) {};
                };
                case null {};
            };
        };
    };
    
    // Helper to register canister to buyer's wallet (best effort, non-blocking)
    func registerCanisterToWallet(user : Principal, canisterId : Principal, isNeuronManager : Bool) : async () {
        // Register to tracked canisters
        switch (backendCanisterId) {
            case (?id) {
                let backend : T.BackendActor = actor(Principal.toText(id));
                try { await backend.register_tracked_canister_for(user, canisterId); } catch (_) {};
            };
            case null {};
        };
        
        // If it's a neuron manager, also register with factory
        if (isNeuronManager) {
            switch (neuronManagerFactoryCanisterId) {
                case (?id) {
                    let factory : T.NeuronManagerFactoryActor = actor(Principal.toText(id));
                    try { ignore await factory.registerManagerFor(user, canisterId); } catch (_) {};
                };
                case null {};
            };
        };
    };
    
    // Helper to register token to buyer's wallet (best effort, non-blocking)
    func registerTokenToWallet(user : Principal, ledgerId : Principal) : async () {
        switch (backendCanisterId) {
            case (?id) {
                let backend : T.BackendActor = actor(Principal.toText(id));
                try { await backend.register_user_token_for(user, ledgerId); } catch (_) {};
            };
            case null {};
        };
    };
    
    // Helper to remove all hotkeys from all neurons in a neuron manager (best effort)
    func removeNeuronManagerHotkeys(canisterId : Principal) : async () {
        try {
            let manager : T.ICPNeuronManagerActor = actor(Principal.toText(canisterId));
            
            // Get all neurons and their info
            let neuronsInfo = await manager.getAllNeuronsInfo();
            
            // For each neuron, get full info (which includes hotkeys) and remove them
            for ((neuronId, _) in neuronsInfo.vals()) {
                try {
                    let fullNeuron = await manager.getFullNeuron(neuronId);
                    switch (fullNeuron) {
                        case (?neuron) {
                            // Remove each hotkey
                            for (hotkey in neuron.hot_keys.vals()) {
                                try {
                                    ignore await manager.removeHotKey(neuronId, hotkey);
                                } catch (_) {};
                            };
                        };
                        case null {};
                    };
                } catch (_) {};
            };
        } catch (_) {};
    };
    
    // Get the fee recipient for a specific ledger (checks overrides first, then falls back to default)
    func getFeeRecipientForLedger(ledger : Principal) : T.Account {
        for ((l, account) in ledgerFeeRecipients.vals()) {
            if (Principal.equal(l, ledger)) {
                return account;
            };
        };
        feeRecipient; // Return default
    };
    
    func isAdmin(caller : Principal) : Bool {
        Principal.isController(caller) or Utils.principalInList(caller, config.admins);
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
                                
                                // Register delivered assets to buyer's wallet (best effort)
                                for (entry in offer.assets.vals()) {
                                    switch (entry.asset) {
                                        case (#Canister(asset)) {
                                            let isNeuronManager = switch (asset.canister_kind) {
                                                case (?kind) { kind == T.CANISTER_KIND_ICP_NEURON_MANAGER };
                                                case null { false };
                                            };
                                            await registerCanisterToWallet(bid.bidder, asset.canister_id, isNeuronManager);
                                        };
                                        case (#SNSNeuron(_asset)) {
                                            // For SNS neurons, frontend handles display
                                        };
                                        case (#ICRC1Token(asset)) {
                                            await registerTokenToWallet(bid.bidder, asset.ledger_canister_id);
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
                                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                                    approved_bidders = offer.approved_bidders;
                                    fee_rate_bps = offer.fee_rate_bps;
                                    public_note = offer.public_note;
                                    note_to_buyer = offer.note_to_buyer;
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
                                
                                let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
                                let subaccount = Utils.bidEscrowSubaccount(bid.bidder, bid.id);
                                
                                // Calculate marketplace fee using the rate locked at offer creation
                                let marketplaceFee = bid.amount * offer.fee_rate_bps / 10000;
                                
                                // If there's a marketplace fee, transfer it first (best effort)
                                if (marketplaceFee > 0) {
                                    let feeTransferAmount = if (marketplaceFee > fee) { marketplaceFee - fee } else { 0 };
                                    if (feeTransferAmount > 0) {
                                        let feeTransferResult = await* AssetHandlers.transferTokens(
                                            offer.price_token_ledger,
                                            ?subaccount,
                                            getFeeRecipientForLedger(offer.price_token_ledger),
                                            feeTransferAmount
                                        );
                                        switch (feeTransferResult) {
                                            case (#err(_e)) { return }; // Fee transfer failed, abort
                                            case (#ok(_)) {};
                                        };
                                    };
                                };
                                
                                // Calculate and transfer seller amount
                                let amountAfterFee = bid.amount - marketplaceFee;
                                let sellerTransferAmount = if (amountAfterFee > fee) { amountAfterFee - fee } else { 0 };
                                
                                if (sellerTransferAmount == 0) { return };
                                
                                // Transfer tokens to seller
                                let transferResult = await* AssetHandlers.transferTokens(
                                    offer.price_token_ledger,
                                    ?subaccount,
                                    { owner = offer.creator; subaccount = null },
                                    sellerTransferAmount
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
                
                // Re-register reclaimed assets to seller's wallet (best effort)
                for (entry in offer.assets.vals()) {
                    if (entry.escrowed) {
                        switch (entry.asset) {
                            case (#Canister(asset)) {
                                let isNeuronManager = switch (asset.canister_kind) {
                                    case (?kind) { kind == T.CANISTER_KIND_ICP_NEURON_MANAGER };
                                    case null { false };
                                };
                                await registerCanisterToWallet(offer.creator, asset.canister_id, isNeuronManager);
                            };
                            case (#SNSNeuron(_asset)) {
                                // SNS neurons are shown via SNS governance, no registration needed
                            };
                            case (#ICRC1Token(_asset)) {
                                // Tokens don't need re-registration (user already has it in their wallet)
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
                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                    approved_bidders = offer.approved_bidders;
                    fee_rate_bps = offer.fee_rate_bps;
                    public_note = offer.public_note;
                    note_to_buyer = offer.note_to_buyer;
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
    
    /// Cache stake values for SNS neurons and ICP neuron managers in an offer
    /// This is called via Timer after activation to avoid instruction limits
    func cacheAssetStakes(offerId : T.OfferId) : async () {
        switch (getOffer(offerId)) {
            case null { /* Offer not found, ignore */ };
            case (?offer) {
                // Only cache for Active offers
                if (offer.state != #Active) { return };
                
                var updatedAssets = Buffer.Buffer<T.AssetEntry>(offer.assets.size());
                
                for (entry in offer.assets.vals()) {
                    if (not entry.escrowed) {
                        updatedAssets.add(entry);
                    } else {
                        switch (entry.asset) {
                            case (#SNSNeuron(neuronAsset)) {
                                // Fetch stake from SNS governance using get_neuron
                                try {
                                    let governance : T.SNSGovernanceActor = actor(Principal.toText(neuronAsset.governance_canister_id));
                                    let response = await governance.get_neuron({
                                        neuron_id = ?neuronAsset.neuron_id;
                                    });
                                    
                                    var cachedStake : ?Nat64 = null;
                                    
                                    switch (response.result) {
                                        case (?#Neuron(neuron)) {
                                            cachedStake := ?neuron.cached_neuron_stake_e8s;
                                        };
                                        case (_) {};
                                    };
                                    
                                    let updatedAsset : T.Asset = #SNSNeuron({
                                        governance_canister_id = neuronAsset.governance_canister_id;
                                        neuron_id = neuronAsset.neuron_id;
                                        hotkeys_snapshot = neuronAsset.hotkeys_snapshot;
                                        cached_stake_e8s = cachedStake;
                                    });
                                    updatedAssets.add({ asset = updatedAsset; escrowed = true });
                                } catch (_e) {
                                    // On error, keep original asset without cache
                                    updatedAssets.add(entry);
                                };
                            };
                            case (#Canister(canisterAsset)) {
                                // Only cache for ICP Neuron Managers
                                let isNeuronManager = switch (canisterAsset.canister_kind) {
                                    case (?kind) { kind == T.CANISTER_KIND_ICP_NEURON_MANAGER };
                                    case null { false };
                                };
                                
                                if (isNeuronManager) {
                                    try {
                                        let manager : T.ICPNeuronManagerActor = actor(Principal.toText(canisterAsset.canister_id));
                                        let neuronsInfo = await manager.getAllNeuronsInfo();
                                        
                                        var totalStake : Nat64 = 0;
                                        for ((_, maybeInfo) in neuronsInfo.vals()) {
                                            switch (maybeInfo) {
                                                case (?info) {
                                                    totalStake += info.stake_e8s;
                                                };
                                                case null {};
                                            };
                                        };
                                        
                                        let updatedAsset : T.Asset = #Canister({
                                            canister_id = canisterAsset.canister_id;
                                            canister_kind = canisterAsset.canister_kind;
                                            controllers_snapshot = canisterAsset.controllers_snapshot;
                                            cached_total_stake_e8s = ?totalStake;
                                            title = canisterAsset.title;
                                            description = canisterAsset.description;
                                        });
                                        updatedAssets.add({ asset = updatedAsset; escrowed = true });
                                    } catch (_e) {
                                        // On error, keep original asset without cache
                                        updatedAssets.add(entry);
                                    };
                                } else {
                                    // Not a neuron manager, keep original
                                    updatedAssets.add(entry);
                                };
                            };
                            case (#ICRC1Token(_)) {
                                // No caching needed for tokens
                                updatedAssets.add(entry);
                            };
                        };
                    };
                };
                
                // Update offer with cached values
                let updatedOffer : T.Offer = {
                    id = offer.id;
                    creator = offer.creator;
                    min_bid_price = offer.min_bid_price;
                    buyout_price = offer.buyout_price;
                    expiration = offer.expiration;
                    price_token_ledger = offer.price_token_ledger;
                    assets = Buffer.toArray(updatedAssets);
                    state = offer.state;
                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                    approved_bidders = offer.approved_bidders;
                    fee_rate_bps = offer.fee_rate_bps;
                    public_note = offer.public_note;
                    note_to_buyer = offer.note_to_buyer;
                    created_at = offer.created_at;
                    activated_at = offer.activated_at;
                };
                
                updateOffer(offerId, updatedOffer);
            };
        };
    };
    
    /// Schedule caching of asset stakes (1 second delay to let activation complete)
    func scheduleCacheAssetStakes<system>(offerId : T.OfferId) {
        ignore Timer.setTimer<system>(#seconds 1, func() : async () {
            await cacheAssetStakes(offerId);
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
    
    /// Get all canister kinds
    public query func getCanisterKinds() : async [T.CanisterKind] {
        canisterKinds;
    };
    
    /// Verify if a canister is an ICP Neuron Manager by calling getVersion()
    public shared func verifyICPNeuronManager(canisterId : Principal) : async { #Ok : T.NeuronManagerVersion; #Err : Text } {
        try {
            let manager : T.ICPNeuronManagerActor = actor(Principal.toText(canisterId));
            let version = await manager.getVersion();
            #Ok(version);
        } catch (_e) {
            #Err("Failed to verify canister as ICP Neuron Manager. getVersion() call failed.");
        };
    };
    
    /// Get info about an escrowed ICP Neuron Manager canister
    public shared func getNeuronManagerInfo(canisterId : Principal) : async { #Ok : T.NeuronManagerInfo; #Err : Text } {
        // First verify we have this canister in escrow
        var foundInEscrow = false;
        label escrowCheck for (offer in offers.vals()) {
            for (assetEntry in offer.assets.vals()) {
                switch (assetEntry.asset) {
                    case (#Canister(c)) {
                        if (c.canister_id == canisterId and assetEntry.escrowed) {
                            foundInEscrow := true;
                            break escrowCheck;
                        };
                    };
                    case (_) {};
                };
            };
        };
        
        if (not foundInEscrow) {
            return #Err("Canister is not in escrow");
        };
        
        try {
            let manager : T.ICPNeuronManagerActor = actor(Principal.toText(canisterId));
            
            // Get version and basic neuron info
            let version = await manager.getVersion();
            let neuronsInfoRaw = await manager.getAllNeuronsInfo();
            
            // Build neurons array with maturity data from getFullNeuron
            let neuronsBuffer = Buffer.Buffer<T.ICPNeuronInfo>(neuronsInfoRaw.size());
            
            for ((nid, infoOpt) in neuronsInfoRaw.vals()) {
                switch (infoOpt) {
                    case null {};
                    case (?info) {
                        // Get full neuron to get maturity data
                        let fullNeuronOpt = await manager.getFullNeuron(nid);
                        let (maturity, stakedMaturity) = switch (fullNeuronOpt) {
                            case null { (0 : Nat64, 0 : Nat64) };
                            case (?fullNeuron) {
                                let staked = switch (fullNeuron.staked_maturity_e8s_equivalent) {
                                    case null { 0 : Nat64 };
                                    case (?s) { s };
                                };
                                (fullNeuron.maturity_e8s_equivalent, staked);
                            };
                        };
                        
                        neuronsBuffer.add({
                            neuron_id = nid;
                            cached_neuron_stake_e8s = info.stake_e8s;
                            dissolve_delay_seconds = info.dissolve_delay_seconds;
                            state = info.state;
                            age_seconds = info.age_seconds;
                            voting_power = info.voting_power;
                            maturity_e8s_equivalent = maturity;
                            staked_maturity_e8s_equivalent = stakedMaturity;
                        });
                    };
                };
            };
            
            let neurons = Buffer.toArray(neuronsBuffer);
            
            #Ok({
                version = version;
                neuron_count = neurons.size();
                neurons = neurons;
            });
        } catch (_e) {
            #Err("Failed to get neuron manager info");
        };
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
        
        // Validate note lengths (max 4000 chars each)
        switch (request.public_note) {
            case (?note) {
                if (note.size() > 4000) {
                    return #err(#InvalidInput("Public note exceeds maximum length of 4000 characters"));
                };
            };
            case null {};
        };
        switch (request.note_to_buyer) {
            case (?note) {
                if (note.size() > 4000) {
                    return #err(#InvalidInput("Note to buyer exceeds maximum length of 4000 characters"));
                };
            };
            case null {};
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
            min_bid_increment_fee_multiple = request.min_bid_increment_fee_multiple;
            assets = [];
            state = #Draft;
            approved_bidders = request.approved_bidders;
            fee_rate_bps = marketplaceFeeRateBps; // Lock in current fee rate
            public_note = request.public_note;
            note_to_buyer = request.note_to_buyer;
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
                
                // Validate canister title and description lengths
                switch (request.asset) {
                    case (#Canister(canisterAsset)) {
                        switch (canisterAsset.title) {
                            case (?t) {
                                if (Text.size(t) > T.MAX_CANISTER_TITLE_LENGTH) {
                                    return #err(#InvalidAsset("Canister title exceeds maximum length of " # Nat.toText(T.MAX_CANISTER_TITLE_LENGTH) # " characters"));
                                };
                            };
                            case null {};
                        };
                        switch (canisterAsset.description) {
                            case (?d) {
                                if (Text.size(d) > T.MAX_CANISTER_DESCRIPTION_LENGTH) {
                                    return #err(#InvalidAsset("Canister description exceeds maximum length of " # Nat.toText(T.MAX_CANISTER_DESCRIPTION_LENGTH) # " characters"));
                                };
                            };
                            case null {};
                        };
                    };
                    case _ {};
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
                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                    approved_bidders = offer.approved_bidders;
                    fee_rate_bps = offer.fee_rate_bps;
                    public_note = offer.public_note;
                    note_to_buyer = offer.note_to_buyer;
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
                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                    approved_bidders = offer.approved_bidders;
                    fee_rate_bps = offer.fee_rate_bps;
                    public_note = offer.public_note;
                    note_to_buyer = offer.note_to_buyer;
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
                                        // Update asset with snapshot, preserving canister_kind, title, description
                                        let updatedAsset : T.Asset = #Canister({
                                            canister_id = canisterAsset.canister_id;
                                            canister_kind = canisterAsset.canister_kind;
                                            controllers_snapshot = ?snapshot;
                                            cached_total_stake_e8s = null; // Will be populated after activation for neuron managers
                                            title = canisterAsset.title;
                                            description = canisterAsset.description;
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
                                            min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                                            approved_bidders = offer.approved_bidders;
                                            fee_rate_bps = offer.fee_rate_bps;
                                            public_note = offer.public_note;
                                            note_to_buyer = offer.note_to_buyer;
                                            created_at = offer.created_at;
                                            activated_at = offer.activated_at;
                                        };
                                        
                                        updateOffer(offerId, updatedOffer);
                                        
                                        // Deregister canister from seller's wallet (best effort, non-blocking)
                                        let isNeuronManager = switch (canisterAsset.canister_kind) {
                                            case (?kind) { kind == T.CANISTER_KIND_ICP_NEURON_MANAGER };
                                            case null { false };
                                        };
                                        ignore Timer.setTimer<system>(#seconds 0, func () : async () {
                                            await deregisterCanisterFromWallet(caller, canisterAsset.canister_id, isNeuronManager);
                                        });
                                        
                                        // If it's a neuron manager, remove all hotkeys from its neurons (best effort, non-blocking)
                                        if (isNeuronManager) {
                                            ignore Timer.setTimer<system>(#seconds 1, func () : async () {
                                                await removeNeuronManagerHotkeys(canisterAsset.canister_id);
                                            });
                                        };
                                        
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
                                            cached_stake_e8s = null; // Will be populated after activation
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
                                            min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                                            approved_bidders = offer.approved_bidders;
                                            fee_rate_bps = offer.fee_rate_bps;
                                            public_note = offer.public_note;
                                            note_to_buyer = offer.note_to_buyer;
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
                                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                                    approved_bidders = offer.approved_bidders;
                                    fee_rate_bps = offer.fee_rate_bps;
                                    public_note = offer.public_note;
                                    note_to_buyer = offer.note_to_buyer;
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
                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                    approved_bidders = offer.approved_bidders;
                    fee_rate_bps = offer.fee_rate_bps;
                    public_note = offer.public_note;
                    note_to_buyer = offer.note_to_buyer;
                    created_at = offer.created_at;
                    activated_at = ?Time.now();
                };
                
                updateOffer(offerId, updatedOffer);
                
                // Schedule caching of asset stakes (SNS neurons and neuron managers)
                scheduleCacheAssetStakes<system>(offerId);
                
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
                
                // Check if this is a private offer with approved bidders
                switch (offer.approved_bidders) {
                    case (?approvedList) {
                        let isApproved = Array.find<Principal>(approvedList, func(p) { Principal.equal(p, caller) });
                        if (isApproved == null and not Principal.equal(caller, offer.creator)) {
                            return #err(#NotAuthorized);
                        };
                    };
                    case null {}; // Public offer, anyone can bid
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
                        
                        // Check must be higher than current highest bid (with minimum increment if specified)
                        switch (getHighestBid(bid.offer_id)) {
                            case (?highest) {
                                // Calculate minimum next bid based on increment setting
                                let minIncrement = switch (offer.min_bid_increment_fee_multiple) {
                                    case (?multiple) {
                                        // Get the token fee
                                        let ledger : T.ICRC1Actor = actor(Principal.toText(offer.price_token_ledger));
                                        let fee = await ledger.icrc1_fee();
                                        fee * multiple;
                                    };
                                    case null { 1 }; // Default minimum increment of 1
                                };
                                
                                let minimumNextBid = highest.amount + minIncrement;
                                
                                if (amount < minimumNextBid) {
                                    return #err(#BidIncrementTooSmall({ 
                                        current_highest = highest.amount; 
                                        minimum_next = minimumNextBid;
                                        required_increment = minIncrement;
                                    }));
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
                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                    approved_bidders = offer.approved_bidders;
                    fee_rate_bps = offer.fee_rate_bps;
                    public_note = offer.public_note;
                    note_to_buyer = offer.note_to_buyer;
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
                                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                                    approved_bidders = offer.approved_bidders;
                                    fee_rate_bps = offer.fee_rate_bps;
                                    public_note = offer.public_note;
                                    note_to_buyer = offer.note_to_buyer;
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
                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                    approved_bidders = offer.approved_bidders;
                    fee_rate_bps = offer.fee_rate_bps;
                    public_note = offer.public_note;
                    note_to_buyer = offer.note_to_buyer;
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
                                
                                // Register delivered assets to buyer's wallet (best effort, non-blocking)
                                let buyerPrincipal = caller;
                                ignore Timer.setTimer<system>(#seconds 0, func () : async () {
                                    for (entry in offer.assets.vals()) {
                                        switch (entry.asset) {
                                            case (#Canister(asset)) {
                                                let isNeuronManager = switch (asset.canister_kind) {
                                                    case (?kind) { kind == T.CANISTER_KIND_ICP_NEURON_MANAGER };
                                                    case null { false };
                                                };
                                                await registerCanisterToWallet(buyerPrincipal, asset.canister_id, isNeuronManager);
                                            };
                                            case (#SNSNeuron(asset)) {
                                                // For SNS neurons, register the SNS token ledger
                                                // The neurons will show in the token card in /wallet
                                                // Note: We'd need to get the SNS ledger from governance
                                                // For now, skip - frontend handles SNS neuron display
                                            };
                                            case (#ICRC1Token(asset)) {
                                                await registerTokenToWallet(buyerPrincipal, asset.ledger_canister_id);
                                            };
                                        };
                                    };
                                });
                                
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
                                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                                    approved_bidders = offer.approved_bidders;
                                    fee_rate_bps = offer.fee_rate_bps;
                                    public_note = offer.public_note;
                                    note_to_buyer = offer.note_to_buyer;
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
                                
                                let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
                                let subaccount = Utils.bidEscrowSubaccount(bid.bidder, bid.id);
                                
                                // Calculate marketplace fee using the rate locked at offer creation
                                let marketplaceFee = bid.amount * offer.fee_rate_bps / 10000;
                                
                                // If there's a marketplace fee to collect, transfer it first
                                if (marketplaceFee > 0) {
                                    // Transfer marketplace fee to fee recipient
                                    let feeTransferAmount = if (marketplaceFee > fee) { marketplaceFee - fee } else { 0 };
                                    if (feeTransferAmount > 0) {
                                        let feeTransferResult = await* AssetHandlers.transferTokens(
                                            offer.price_token_ledger,
                                            ?subaccount,
                                            getFeeRecipientForLedger(offer.price_token_ledger),
                                            feeTransferAmount
                                        );
                                        switch (feeTransferResult) {
                                            case (#err(e)) { return #err(e) };
                                            case (#ok(_)) {};
                                        };
                                    };
                                };
                                
                                // Calculate seller amount: bid - marketplace fee - transfer fees
                                // If marketplace fee was paid, we already deducted (marketplaceFee) from escrow
                                // Seller gets remaining minus one more transfer fee
                                let amountAfterFee = bid.amount - marketplaceFee;
                                let sellerTransferAmount = if (amountAfterFee > fee) { amountAfterFee - fee } else { 0 };
                                
                                if (sellerTransferAmount == 0) {
                                    return #err(#InsufficientFunds({ available = amountAfterFee; required = fee }));
                                };
                                
                                // Transfer remaining tokens to seller
                                let transferResult = await* AssetHandlers.transferTokens(
                                    offer.price_token_ledger,
                                    ?subaccount,
                                    { owner = caller; subaccount = null },
                                    sellerTransferAmount
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
                                let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
                                
                                // Find the winning bid from completed state
                                for (b in getBidsForOffer(offerId).vals()) {
                                    if (b.state == #Won) {
                                        let subaccount = Utils.bidEscrowSubaccount(b.bidder, b.id);
                                        
                                        // Calculate marketplace fee using the rate locked at offer creation
                                        let marketplaceFee = b.amount * offer.fee_rate_bps / 10000;
                                        
                                        // If there's a marketplace fee, transfer it first
                                        if (marketplaceFee > 0) {
                                            let feeTransferAmount = if (marketplaceFee > fee) { marketplaceFee - fee } else { 0 };
                                            if (feeTransferAmount > 0) {
                                                let feeTransferResult = await* AssetHandlers.transferTokens(
                                                    offer.price_token_ledger,
                                                    ?subaccount,
                                                    feeRecipient,
                                                    feeTransferAmount
                                                );
                                                switch (feeTransferResult) {
                                                    case (#err(e)) { return #err(e) };
                                                    case (#ok(_)) {};
                                                };
                                            };
                                        };
                                        
                                        // Calculate and transfer seller amount
                                        let amountAfterFee = b.amount - marketplaceFee;
                                        let sellerTransferAmount = if (amountAfterFee > fee) { amountAfterFee - fee } else { 0 };
                                        
                                        if (sellerTransferAmount == 0) {
                                            return #err(#InsufficientFunds({ available = amountAfterFee; required = fee }));
                                        };
                                        
                                        let transferResult = await* AssetHandlers.transferTokens(
                                            offer.price_token_ledger,
                                            ?subaccount,
                                            { owner = caller; subaccount = null },
                                            sellerTransferAmount
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
                
                // Re-register reclaimed assets to seller's wallet (best effort, non-blocking)
                let creatorPrincipal = caller;
                ignore Timer.setTimer<system>(#seconds 0, func () : async () {
                    for (entry in offer.assets.vals()) {
                        if (entry.escrowed) {
                            switch (entry.asset) {
                                case (#Canister(asset)) {
                                    let isNeuronManager = switch (asset.canister_kind) {
                                        case (?kind) { kind == T.CANISTER_KIND_ICP_NEURON_MANAGER };
                                        case null { false };
                                    };
                                    await registerCanisterToWallet(creatorPrincipal, asset.canister_id, isNeuronManager);
                                };
                                case (#SNSNeuron(_asset)) {};
                                case (#ICRC1Token(_asset)) {};
                            };
                        };
                    };
                });
                
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
                    min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                    approved_bidders = offer.approved_bidders;
                    fee_rate_bps = offer.fee_rate_bps;
                    public_note = offer.public_note;
                    note_to_buyer = offer.note_to_buyer;
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
    public shared query ({ caller }) func getOfferView(offerId : T.OfferId) : async ?T.OfferView {
        switch (getOffer(offerId)) {
            case null { null };
            case (?offer) {
                let offerBids = getBidsForOffer(offerId);
                let highestBid = getHighestBid(offerId);
                
                // Determine if caller can see the private note
                // Creator can always see it
                // Winning bidder can see it (highest bid that is Won or Confirmed)
                var canSeePrivateNote = Principal.equal(caller, offer.creator);
                
                if (not canSeePrivateNote) {
                    switch (highestBid) {
                        case (?bid) {
                            if (Principal.equal(caller, bid.bidder)) {
                                switch (bid.state) {
                                    case (#Won) { canSeePrivateNote := true };
                                    case (#Confirmed) { canSeePrivateNote := true };
                                    case (_) {};
                                };
                            };
                        };
                        case null {};
                    };
                };
                
                // Return offer with or without the private note
                let filteredOffer : T.Offer = if (canSeePrivateNote) {
                    offer;
                } else {
                    {
                        id = offer.id;
                        creator = offer.creator;
                        min_bid_price = offer.min_bid_price;
                        buyout_price = offer.buyout_price;
                        expiration = offer.expiration;
                        price_token_ledger = offer.price_token_ledger;
                        min_bid_increment_fee_multiple = offer.min_bid_increment_fee_multiple;
                        assets = offer.assets;
                        state = offer.state;
                        approved_bidders = offer.approved_bidders;
                        fee_rate_bps = offer.fee_rate_bps;
                        public_note = offer.public_note;
                        note_to_buyer = null; // Hide private note
                        created_at = offer.created_at;
                        activated_at = offer.activated_at;
                    };
                };
                
                ?{
                    offer = filteredOffer;
                    bids = offerBids;
                    highest_bid = highestBid;
                };
            };
        };
    };
    
    /// Get canister info for an escrowed canister asset
    /// Only works for escrowed canisters where Sneedex is a controller
    public shared func getCanisterInfo(offerId : T.OfferId, assetIndex : Nat) : async T.Result<T.CanisterInfo> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (assetIndex >= offer.assets.size()) {
                    return #err(#InvalidAsset("Asset index out of bounds"));
                };
                
                let assetEntry = offer.assets[assetIndex];
                
                // Check if asset is escrowed
                if (not assetEntry.escrowed) {
                    return #err(#InvalidState("Asset is not escrowed - cannot query canister info"));
                };
                
                // Check if it's a canister asset
                switch (assetEntry.asset) {
                    case (#Canister(canisterAsset)) {
                        let ic : T.ManagementActor = actor("aaaaa-aa");
                        
                        try {
                            let status = await ic.canister_status({ canister_id = canisterAsset.canister_id });
                            
                            #ok({
                                canister_id = canisterAsset.canister_id;
                                status = status.status;
                                controllers = status.settings.controllers;
                                memory_size = status.memory_size;
                                cycles = status.cycles;
                                idle_cycles_burned_per_day = status.idle_cycles_burned_per_day;
                                module_hash = status.module_hash;
                                compute_allocation = status.settings.compute_allocation;
                                memory_allocation = status.settings.memory_allocation;
                                freezing_threshold = status.settings.freezing_threshold;
                            });
                        } catch (_e) {
                            #err(#CanisterError("Failed to get canister status - may not have controller access"));
                        };
                    };
                    case _ {
                        #err(#InvalidAsset("Asset is not a canister"));
                    };
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
    
    /// Get all active public offers (no approved_bidders list)
    public query func getPublicOffers() : async [T.Offer] {
        Array.filter<T.Offer>(offers, func(o : T.Offer) : Bool {
            o.state == #Active and o.approved_bidders == null;
        });
    };
    
    /// Get all private offers visible to a specific principal
    /// (offers where the principal is the creator or in the approved_bidders list)
    /// For creators: shows all states (Draft, PendingEscrow, Active)
    /// For approved bidders: shows only Active offers
    public query func getPrivateOffersFor(viewer : Principal) : async [T.Offer] {
        Array.filter<T.Offer>(offers, func(o : T.Offer) : Bool {
            switch (o.approved_bidders) {
                case null { false }; // Public offer, not included
                case (?approvedList) {
                    // If viewer is creator, show Draft, PendingEscrow, and Active offers
                    if (Principal.equal(o.creator, viewer)) {
                        o.state == #Draft or o.state == #PendingEscrow or o.state == #Active;
                    } else if (o.state == #Active) {
                        // For approved bidders (not creator), only show Active offers
                        let isApproved = Array.find<Principal>(approvedList, func(p) { Principal.equal(p, viewer) });
                        isApproved != null;
                    } else {
                        false;
                    };
                };
            };
        });
    };
    
    /// Get offers by creator
    public query func getOffersByCreator(creator : Principal) : async [T.Offer] {
        Array.filter<T.Offer>(offers, func(o : T.Offer) : Bool {
            Principal.equal(o.creator, creator);
        });
    };
    
    /// Debug: Get all offers (for debugging approved_bidders)
    public query func debugGetAllOffers() : async [{
        id : T.OfferId;
        creator : Principal;
        state : T.OfferState;
        approved_bidders : ?[Principal];
    }] {
        Array.map<T.Offer, {
            id : T.OfferId;
            creator : Principal;
            state : T.OfferState;
            approved_bidders : ?[Principal];
        }>(offers, func(o : T.Offer) : {
            id : T.OfferId;
            creator : Principal;
            state : T.OfferState;
            approved_bidders : ?[Principal];
        } {
            {
                id = o.id;
                creator = o.creator;
                state = o.state;
                approved_bidders = o.approved_bidders;
            }
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
    
    // ============================================
    // MARKETPLACE FEE MANAGEMENT (Admin)
    // ============================================
    
    /// Get current marketplace fee rate in basis points (100 = 1%)
    public query func getMarketplaceFeeRate() : async Nat {
        marketplaceFeeRateBps;
    };
    
    /// Set marketplace fee rate in basis points (admin only)
    /// e.g., 100 = 1%, 250 = 2.5%, 500 = 5%
    public shared ({ caller }) func setMarketplaceFeeRate(rateBps : Nat) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        // Sanity check: max 50% (5000 bps)
        if (rateBps > 5000) {
            return #err(#InvalidAsset("Fee rate cannot exceed 50% (5000 bps)"));
        };
        
        marketplaceFeeRateBps := rateBps;
        #ok();
    };
    
    /// Get current fee recipient account
    public query func getFeeRecipient() : async T.Account {
        feeRecipient;
    };
    
    /// Set fee recipient account (admin only)
    public shared ({ caller }) func setFeeRecipient(account : T.Account) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        feeRecipient := account;
        #ok();
    };
    
    /// Get all per-ledger fee recipient overrides
    public query func getLedgerFeeRecipients() : async [(Principal, T.Account)] {
        ledgerFeeRecipients;
    };
    
    /// Set a fee recipient override for a specific ledger (admin only)
    /// When fees are collected in this ledger's token, they will go to this account instead of the default
    public shared ({ caller }) func setLedgerFeeRecipient(ledger : Principal, account : T.Account) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        // Update or add the ledger-specific recipient
        var found = false;
        ledgerFeeRecipients := Array.map<(Principal, T.Account), (Principal, T.Account)>(
            ledgerFeeRecipients,
            func ((l, a) : (Principal, T.Account)) : (Principal, T.Account) {
                if (Principal.equal(l, ledger)) {
                    found := true;
                    (l, account);
                } else {
                    (l, a);
                };
            }
        );
        
        // If not found, add new entry
        if (not found) {
            ledgerFeeRecipients := Array.append(ledgerFeeRecipients, [(ledger, account)]);
        };
        
        #ok();
    };
    
    /// Remove a fee recipient override for a specific ledger (admin only)
    /// Fees will fall back to the default fee recipient
    public shared ({ caller }) func removeLedgerFeeRecipient(ledger : Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        ledgerFeeRecipients := Array.filter<(Principal, T.Account)>(
            ledgerFeeRecipients,
            func ((l, _) : (Principal, T.Account)) : Bool {
                not Principal.equal(l, ledger);
            }
        );
        
        #ok();
    };
    
    // ============================================
    // WALLET REGISTRATION SETTINGS (Admin)
    // ============================================
    
    /// Set the backend canister ID for wallet registration (admin only)
    public shared ({ caller }) func setBackendCanisterId(canisterId : ?Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        backendCanisterId := canisterId;
        #ok();
    };
    
    /// Get the backend canister ID
    public query func getBackendCanisterId() : async ?Principal {
        backendCanisterId;
    };
    
    /// Set the neuron manager factory canister ID (admin only)
    public shared ({ caller }) func setNeuronManagerFactoryCanisterId(canisterId : ?Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        neuronManagerFactoryCanisterId := canisterId;
        #ok();
    };
    
    /// Get the neuron manager factory canister ID
    public query func getNeuronManagerFactoryCanisterId() : async ?Principal {
        neuronManagerFactoryCanisterId;
    };
};

