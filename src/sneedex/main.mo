import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Array "mo:base/Array";
import Text "mo:base/Text";
import Timer "mo:base/Timer";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";

import Map "mo:map/Map";
import { phash; nhash } "mo:map/Map";

import T "Types";
import Utils "Utils";
import AssetHandlers "AssetHandlers";
import PremiumClient "../PremiumClient";
import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";

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
    var nextAssetTypeId : T.AssetTypeId = 5; // 0..4 are reserved for built-in types
    
    // Asset types registry
    var assetTypes : [T.AssetType] = [
        { id = T.ASSET_TYPE_CANISTER; name = "Canister"; description = "Internet Computer canister"; active = true },
        { id = T.ASSET_TYPE_SNS_NEURON; name = "SNS Neuron"; description = "SNS governance neuron"; active = true },
        { id = T.ASSET_TYPE_ICRC1_TOKEN; name = "ICRC1 Token"; description = "ICRC1 fungible token"; active = true },
        { id = T.ASSET_TYPE_ICRC7_NFT; name = "ICRC-7 NFT"; description = "Non-fungible tokens of an ICRC-7 collection"; active = true },
        { id = T.ASSET_TYPE_SNEED_LOCK; name = "Sneed Lock"; description = "A Sneed Lock token lock or locked LP position"; active = true },
    ];
    /// Deployments from before the NFT type keep their registry across upgrades; add the entry once.
    private func ensureBuiltInAssetTypes() {
        if (Array.find<T.AssetType>(assetTypes, func(t) { t.id == T.ASSET_TYPE_ICRC7_NFT }) == null) {
            assetTypes := Array.append(assetTypes, [{ id = T.ASSET_TYPE_ICRC7_NFT; name = "ICRC-7 NFT"; description = "Non-fungible tokens of an ICRC-7 collection"; active = true }]);
        };
        if (Array.find<T.AssetType>(assetTypes, func(t) { t.id == T.ASSET_TYPE_SNEED_LOCK }) == null) {
            assetTypes := Array.append(assetTypes, [{ id = T.ASSET_TYPE_SNEED_LOCK; name = "Sneed Lock"; description = "A Sneed Lock token lock or locked LP position"; active = true }]);
        };
        if (nextAssetTypeId <= T.ASSET_TYPE_SNEED_LOCK) { nextAssetTypeId := T.ASSET_TYPE_SNEED_LOCK + 1 };
    };
    // The actor body runs on every install, upgrades included, while the registry above keeps its stored value.
    ensureBuiltInAssetTypes();
    
    // Canister kinds registry (for known canister types with enhanced display)
    var canisterKinds : [T.CanisterKind] = [
        { id = T.CANISTER_KIND_UNKNOWN; name = "Unknown"; description = "Generic canister"; active = true },
        { id = T.CANISTER_KIND_ICP_NEURON_MANAGER; name = "ICP Staking Bot"; description = "Sneed ICP Staking Bot canister"; active = true },
        { id = T.CANISTER_KIND_TRADING_BOT; name = "Trading Bot"; description = "Sneed Trading Bot canister"; active = true },
    ];
    var _nextCanisterKindId : T.CanisterKindId = 2; // 0, 1 are reserved (prefixed with _ to suppress unused warning)
    
    // Offers storage
    var offers : [T.Offer] = [];
    
    // Bids storage
    var bids : [T.Bid] = [];

    // In-flight guard for bid escrow payouts (transient — intentionally reset
    // on upgrade). On ICP every await is a commit point and concurrent ingress
    // messages interleave, so any two operations that read the escrow and then
    // transfer out of it (withdrawBidEscrow, refundBid, autoRefundBid) could
    // each pass their pre-checks across awaits and collectively pay the escrow
    // out more than once. This set serializes those payouts per bid.
    transient var bidEscrowLocks = Map.new<T.BidId, ()>();

    func isBidEscrowLocked(bidId : T.BidId) : Bool {
        Map.has(bidEscrowLocks, nhash, bidId);
    };
    func lockBidEscrow(bidId : T.BidId) {
        Map.set(bidEscrowLocks, nhash, bidId, ());
    };
    func unlockBidEscrow(bidId : T.BidId) {
        Map.delete(bidEscrowLocks, nhash, bidId);
    };
    
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
    
    // Offer creation fee settings (in ICP e8s)
    var offerCreationFeeE8s : Nat64 = 0; // Default 0 - no fee
    var premiumOfferCreationFeeE8s : Nat64 = 0; // Default 0 - no fee for premium
    
    // Premium auction cut in basis points (applies to completed auctions for premium members)
    var premiumAuctionCutBps : Nat = 0; // Default same as regular (0 means use regular rate)
    
    // Sneed Premium integration
    var sneedPremiumCanisterId : ?Principal = null;
    var premiumCache = PremiumClient.emptyCache();
    
    // ICP Ledger for offer creation fees
    let ICP_LEDGER_ID : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
    let ICP_FEE : Nat64 = 10_000; // 0.0001 ICP
    
    // Wallet registration settings (for auto-registering delivered assets)
    // These are optional - if not set, wallet registration is skipped
    var backendCanisterId : ?Principal = null;
    var neuronManagerFactoryCanisterId : ?Principal = null;
    // Sneed Lock, whose token and position locks can be escrowed as assets (staging points this elsewhere)
    var sneedLockCanisterId : Principal = Principal.fromText("pqsms-lqaaa-aaaal-ajjza-cai");
    
    // Expiration auto-processing timer settings
    var expirationCheckIntervalSeconds : Nat = 3600; // Default: 1 hour
    var expirationTimerId : ?Timer.TimerId = null; // Main periodic timer
    var expirationWorkerRunning : Bool = false; // Flag to prevent multiple workers
    
    // Payment logs
    var creationFeePaymentLog : [T.CreationFeePaymentLogEntry] = [];
    var nextCreationFeePaymentId : Nat = 0;
    var cutPaymentLog : [T.CutPaymentLogEntry] = [];
    var nextCutPaymentId : Nat = 0;
    
    // Payment statistics
    var totalCreationFeesCollectedE8s : Nat = 0;
    var totalCutsCollectedByLedger : [(Principal, Nat)] = []; // ledger -> total amount
    
    // Notification settings storage
    var userNotificationSettings : [(Principal, T.NotificationSettings)] = [];
    var sneedSmsCanisterId : ?Principal = null;
    
    // Neuron info cache settings and storage
    // Cache staleness threshold in seconds (entries older than this are considered stale)
    var neuronInfoCacheStalenessSeconds : Nat = 3600; // Default: 1 hour
    // Cache: maps staking bot canister ID -> cached neuron manager info
    var neuronInfoCache : [(Principal, T.NeuronManagerCacheEntry)] = [];
    
    // Escrow snapshots for ICP Neuron Managers
    // Stores neuron hotkeys and botkeys that were present before escrow,
    // so they can be restored on seller reclaim (but NOT on delivery to buyer).
    // Keyed by canister principal ID.
    var neuronManagerEscrowSnapshots : [(Principal, T.NeuronManagerEscrowSnapshot)] = [];

    // Permissions each principal held on an escrowed SNS neuron before escrow stripped them,
    // keyed by (offer id, asset index). A cancelled/expired offer gives every principal back
    // exactly these (the hotkeys_snapshot inside the offer only keeps the principals).
    // Escrows from before this map existed have no entry; see neuronRestorePermissions.
    var snsNeuronEscrowPermissions : [(T.OfferId, Nat, [T.NeuronPermission])] = [];

    // Settlement progress: for an offer whose assets are being handed over (to the winner of a
    // Completed offer, or back to the seller of an Expired/Cancelled one), the indices of the
    // assets already delivered. A retry only redoes the others; the offer becomes Claimed or
    // Reclaimed only once every asset is delivered, and its entry is then removed.
    var settlementDelivered : [(T.OfferId, [Nat])] = [];

    // In-flight guard for asset settlement, per offer (transient, like bidEscrowLocks): the
    // auto-delivery timers and the manual claim/reclaim must not hand over the same offer at once.
    transient var settlementLocks = Map.new<T.OfferId, ()>();

    // ============================================
    // PRIVATE HELPERS
    // ============================================
    
    // Helper to deregister canister from seller's wallet (best effort, non-blocking).
    // Known Sneedapp canister kinds are deregistered from the Sneedapp factory wallet;
    // unknown kinds fall back to the backend tracked canisters list.
    func deregisterCanisterFromWallet(user : Principal, canisterId : Principal, canister_kind : ?T.CanisterKindId) : async () {
        let appId : ?Text = switch (canister_kind) {
            case (?kind) { T.canisterKindToAppId(kind) };
            case null { null };
        };
        switch (appId) {
            case (?_) {
                // Known Sneedapp canister: deregister from factory wallet
                switch (neuronManagerFactoryCanisterId) {
                    case (?id) {
                        let factory : T.SneedappFactoryActor = actor(Principal.toText(id));
                        try { ignore await factory.deregisterCanisterFor(user, canisterId); } catch (_) {};
                    };
                    case null {};
                };
            };
            case null {
                // Unknown canister kind: deregister from backend tracked canisters
                switch (backendCanisterId) {
                    case (?id) {
                        let backend : T.BackendActor = actor(Principal.toText(id));
                        try { await backend.unregister_tracked_canister_for(user, canisterId); } catch (_) {};
                    };
                    case null {};
                };
            };
        };
    };
    
    // Helper to register canister to buyer's wallet (best effort, non-blocking).
    // Known Sneedapp canister kinds are registered to the Sneedapp factory wallet with the correct appId;
    // unknown kinds fall back to the backend tracked canisters list.
    func registerCanisterToWallet(user : Principal, canisterId : Principal, canister_kind : ?T.CanisterKindId) : async () {
        let appId : ?Text = switch (canister_kind) {
            case (?kind) { T.canisterKindToAppId(kind) };
            case null { null };
        };
        switch (appId) {
            case (?aid) {
                // Known Sneedapp canister: register to factory wallet with appId
                switch (neuronManagerFactoryCanisterId) {
                    case (?id) {
                        let factory : T.SneedappFactoryActor = actor(Principal.toText(id));
                        try { ignore await factory.registerCanisterFor(user, canisterId, aid); } catch (_) {};
                    };
                    case null {};
                };
            };
            case null {
                // Unknown canister kind: register to backend tracked canisters
                switch (backendCanisterId) {
                    case (?id) {
                        let backend : T.BackendActor = actor(Principal.toText(id));
                        try { await backend.register_tracked_canister_for(user, canisterId); } catch (_) {};
                    };
                    case null {};
                };
            };
        };
    };
    
    // Helper to record a marketplace cut payment
    func recordCutPayment(
        offerId : T.OfferId,
        bidId : T.BidId,
        seller : Principal,
        buyer : Principal,
        ledger : Principal,
        cutAmount : Nat,
        transactionId : Nat,
        bidAmount : Nat,
        feeRateBps : Nat
    ) {
        let cutEntry : T.CutPaymentLogEntry = {
            id = nextCutPaymentId;
            timestamp = Nat64.fromNat(Int.abs(Time.now()));
            offer_id = offerId;
            bid_id = bidId;
            seller = seller;
            buyer = buyer;
            ledger = ledger;
            cut_amount = cutAmount;
            transaction_id = transactionId;
            bid_amount = bidAmount;
            fee_rate_bps = feeRateBps;
        };
        cutPaymentLog := Array.append(cutPaymentLog, [cutEntry]);
        nextCutPaymentId += 1;
        
        // Update per-ledger totals
        var found = false;
        totalCutsCollectedByLedger := Array.map<(Principal, Nat), (Principal, Nat)>(
            totalCutsCollectedByLedger,
            func((l, total)) {
                if (Principal.equal(l, ledger)) {
                    found := true;
                    (l, total + cutAmount)
                } else {
                    (l, total)
                }
            }
        );
        if (not found) {
            totalCutsCollectedByLedger := Array.append(totalCutsCollectedByLedger, [(ledger, cutAmount)]);
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
    
    // ============================================
    // NOTIFICATION HELPERS
    // ============================================
    
    // Get notification settings for a user (returns defaults if not set)
    func getUserNotificationSettings(user : Principal) : T.NotificationSettings {
        for ((p, settings) in userNotificationSettings.vals()) {
            if (Principal.equal(p, user)) {
                return settings;
            };
        };
        T.DEFAULT_NOTIFICATION_SETTINGS
    };
    
    // Send a notification via sneed_sms (best effort, non-blocking)
    func sendNotification(recipients : [Principal], subject : Text, body : Text) : async () {
        switch (sneedSmsCanisterId) {
            case (?id) {
                let sms : T.SneedSMSActor = actor(Principal.toText(id));
                try {
                    ignore await sms.send_system_notification({
                        recipients = recipients;
                        subject = subject;
                        body = body;
                    });
                } catch (_) {
                    // Notification failed - log but don't fail the main operation
                    Debug.print("Failed to send notification: " # subject);
                };
            };
            case null {
                // SMS canister not configured - skip notification
            };
        };
    };
    
    // Fetch token metadata (symbol, decimals) from ledger - returns defaults on error
    func fetchTokenMetadata(ledger : Principal) : async (Text, Nat8) {
        try {
            let ledgerActor : T.ICRC1Actor = actor(Principal.toText(ledger));
            let symbol = await ledgerActor.icrc1_symbol();
            let decimals = await ledgerActor.icrc1_decimals();
            (symbol, decimals)
        } catch (_) {
            // Fallback if ledger call fails
            ("tokens", 8)
        };
    };
    
    // Format token amount with symbol and decimals
    func formatTokenAmount(amount : Nat, symbol : Text, decimals : Nat8) : Text {
        let divisor = Nat.pow(10, Nat8.toNat(decimals));
        let wholePart = amount / divisor;
        let fractionalPart = amount % divisor;
        
        // Format with appropriate decimal places (up to 4 for readability)
        let displayDecimals = if (Nat8.toNat(decimals) > 4) 4 else Nat8.toNat(decimals);
        if (displayDecimals == 0 or fractionalPart == 0) {
            Nat.toText(wholePart) # " " # symbol
        } else {
            let fractionalDivisor = Nat.pow(10, Nat8.toNat(decimals) - displayDecimals);
            let displayFractional = fractionalPart / fractionalDivisor;
            Nat.toText(wholePart) # "." # padLeft(Nat.toText(displayFractional), displayDecimals) # " " # symbol
        };
    };
    
    // Helper to pad string with leading zeros
    func padLeft(s : Text, len : Nat) : Text {
        var result = s;
        while (result.size() < len) {
            result := "0" # result;
        };
        result;
    };
    
    // Notify seller about a new bid on their offer (fire-and-forget)
    func notifyNewBid<system>(offer : T.Offer, bid : T.Bid) {
        let settings = getUserNotificationSettings(offer.creator);
        if (settings.notify_on_bid) {
            ignore Timer.setTimer<system>(#seconds 0, func() : async () {
                let (symbol, decimals) = await fetchTokenMetadata(offer.price_token_ledger);
                let formattedAmount = formatTokenAmount(bid.amount, symbol, decimals);
                let offerUrl = "/sneedex_offer/" # Nat.toText(offer.id);
                let subject = "🔔 New Bid on Sneedex Offer #" # Nat.toText(offer.id);
                let body = "You have received a new bid on your Sneedex offer #" # Nat.toText(offer.id) # ".\n\n" #
                           "**Bid amount:** " # formattedAmount # "\n" #
                           "**Bidder:** " # Principal.toText(bid.bidder) # "\n\n" #
                           "[View your offer](" # offerUrl # ")";
                await sendNotification([offer.creator], subject, body);
            });
        };
    };
    
    // Notify a bidder that they've been outbid (fire-and-forget)
    func notifyOutbid<system>(offer : T.Offer, previousBid : T.Bid, newBid : T.Bid) {
        let settings = getUserNotificationSettings(previousBid.bidder);
        if (settings.notify_on_outbid) {
            ignore Timer.setTimer<system>(#seconds 0, func() : async () {
                let (symbol, decimals) = await fetchTokenMetadata(offer.price_token_ledger);
                let formattedPrevious = formatTokenAmount(previousBid.amount, symbol, decimals);
                let formattedNew = formatTokenAmount(newBid.amount, symbol, decimals);
                let offerUrl = "/sneedex_offer/" # Nat.toText(offer.id);
                let subject = "⚠️ You've Been Outbid on Sneedex Offer #" # Nat.toText(offer.id);
                let body = "Your bid on Sneedex offer #" # Nat.toText(offer.id) # " has been outbid.\n\n" #
                           "**Your bid:** " # formattedPrevious # "\n" #
                           "**New highest bid:** " # formattedNew # "\n\n" #
                           "[Place a higher bid](" # offerUrl # ")";
                await sendNotification([previousBid.bidder], subject, body);
            });
        };
    };
    
    // Notify seller that their offer has sold (fire-and-forget)
    func notifySale<system>(offer : T.Offer, winningBid : T.Bid) {
        let settings = getUserNotificationSettings(offer.creator);
        if (settings.notify_on_sale) {
            ignore Timer.setTimer<system>(#seconds 0, func() : async () {
                let (symbol, decimals) = await fetchTokenMetadata(offer.price_token_ledger);
                let formattedAmount = formatTokenAmount(winningBid.amount, symbol, decimals);
                let offerUrl = "/sneedex_offer/" # Nat.toText(offer.id);
                let subject = "🎉 Your Sneedex Offer #" # Nat.toText(offer.id) # " Has Sold!";
                let body = "Congratulations! Your Sneedex offer #" # Nat.toText(offer.id) # " has been completed.\n\n" #
                           "**Winning bid:** " # formattedAmount # "\n" #
                           "**Buyer:** " # Principal.toText(winningBid.bidder) # "\n\n" #
                           "Your payment should have been delivered automatically to your wallet.\n\n" #
                           "[View offer details](" # offerUrl # ")";
                await sendNotification([offer.creator], subject, body);
            });
        };
    };
    
    // Notify winner that they won the auction (fire-and-forget)
    func notifyWin<system>(offer : T.Offer, winningBid : T.Bid) {
        let settings = getUserNotificationSettings(winningBid.bidder);
        if (settings.notify_on_win) {
            ignore Timer.setTimer<system>(#seconds 0, func() : async () {
                let (symbol, decimals) = await fetchTokenMetadata(offer.price_token_ledger);
                let formattedAmount = formatTokenAmount(winningBid.amount, symbol, decimals);
                let offerUrl = "/sneedex_offer/" # Nat.toText(offer.id);
                let subject = "🏆 You Won Sneedex Auction #" # Nat.toText(offer.id) # "!";
                let body = "Congratulations! You have won Sneedex auction #" # Nat.toText(offer.id) # ".\n\n" #
                           "**Your winning bid:** " # formattedAmount # "\n\n" #
                           "Your assets should have been delivered automatically to your wallet.\n\n" #
                           "[View offer details](" # offerUrl # ")";
                await sendNotification([winningBid.bidder], subject, body);
            });
        };
    };
    
    // Notify seller that their offer has expired without bids (fire-and-forget)
    func notifyExpiration<system>(offer : T.Offer) {
        let settings = getUserNotificationSettings(offer.creator);
        if (settings.notify_on_expiration) {
            ignore Timer.setTimer<system>(#seconds 0, func() : async () {
                let offerUrl = "/sneedex_offer/" # Nat.toText(offer.id);
                let subject = "⏰ Your Sneedex Offer #" # Nat.toText(offer.id) # " Has Expired";
                let body = "Your Sneedex offer #" # Nat.toText(offer.id) # " has expired without receiving any bids.\n\n" #
                           "[Reclaim your assets](" # offerUrl # ")";
                await sendNotification([offer.creator], subject, body);
            });
        };
    };
    
    // Notify bidder that an offer they bid on was cancelled (fire-and-forget)
    func notifyCancellation<system>(offer : T.Offer, bid : T.Bid) {
        let settings = getUserNotificationSettings(bid.bidder);
        if (settings.notify_on_cancellation) {
            ignore Timer.setTimer<system>(#seconds 0, func() : async () {
                let (symbol, decimals) = await fetchTokenMetadata(offer.price_token_ledger);
                let formattedAmount = formatTokenAmount(bid.amount, symbol, decimals);
                let offerUrl = "/sneedex_offer/" # Nat.toText(offer.id);
                let subject = "❌ Sneedex Offer #" # Nat.toText(offer.id) # " Was Cancelled";
                let body = "The seller has cancelled Sneedex offer #" # Nat.toText(offer.id) # " that you had bid on.\n\n" #
                           "**Your bid:** " # formattedAmount # "\n\n" #
                           "Your bid is being automatically refunded to your wallet.\n\n" #
                           "[View offer details](" # offerUrl # ")";
                await sendNotification([bid.bidder], subject, body);
            });
        };
    };
    
    // Notify approved bidders that they've been invited to a private auction (fire-and-forget)
    func notifyPrivateInvite<system>(offer : T.Offer, approvedBidders : [Principal]) {
        ignore Timer.setTimer<system>(#seconds 0, func() : async () {
            let (symbol, decimals) = await fetchTokenMetadata(offer.price_token_ledger);
            let minBidText = switch (offer.min_bid_price) {
                case (?minBid) { "**Minimum bid:** " # formatTokenAmount(minBid, symbol, decimals) # "\n\n" };
                case null { "" };
            };
            let offerUrl = "/sneedex_offer/" # Nat.toText(offer.id);
            let subject = "🔒 You've Been Invited to a Private Sneedex Auction #" # Nat.toText(offer.id);
            
            // Build list of recipients who have this notification enabled
            let recipientsBuffer = Buffer.Buffer<Principal>(approvedBidders.size());
            for (bidder in approvedBidders.vals()) {
                // Don't notify the creator if they're in the list
                if (not Principal.equal(bidder, offer.creator)) {
                    let settings = getUserNotificationSettings(bidder);
                    if (settings.notify_on_private_invite) {
                        recipientsBuffer.add(bidder);
                    };
                };
            };
            
            let recipients = Buffer.toArray(recipientsBuffer);
            if (recipients.size() > 0) {
                let body = "You have been invited to bid on a private Sneedex auction #" # Nat.toText(offer.id) # ".\n\n" #
                           minBidText #
                           "This is a private offer and only invited users can participate.\n\n" #
                           "[View offer](" # offerUrl # ")";
                await sendNotification(recipients, subject, body);
            };
        });
    };
    
    // Helper to remove all hotkeys from all neurons in a neuron manager (best effort)
    // ============================================
    // NEURON MANAGER ESCROW SNAPSHOT HELPERS
    // ============================================
    
    func getEscrowSnapshot(canisterId : Principal) : ?T.NeuronManagerEscrowSnapshot {
        for ((id, snapshot) in neuronManagerEscrowSnapshots.vals()) {
            if (Principal.equal(id, canisterId)) return ?snapshot;
        };
        null
    };
    
    func putEscrowSnapshot(canisterId : Principal, snapshot : T.NeuronManagerEscrowSnapshot) {
        let buf = Buffer.Buffer<(Principal, T.NeuronManagerEscrowSnapshot)>(neuronManagerEscrowSnapshots.size() + 1);
        var found = false;
        for ((id, existing) in neuronManagerEscrowSnapshots.vals()) {
            if (Principal.equal(id, canisterId)) {
                buf.add((id, snapshot));
                found := true;
            } else {
                buf.add((id, existing));
            };
        };
        if (not found) {
            buf.add((canisterId, snapshot));
        };
        neuronManagerEscrowSnapshots := Buffer.toArray(buf);
    };
    
    func removeEscrowSnapshot(canisterId : Principal) {
        neuronManagerEscrowSnapshots := Array.filter<(Principal, T.NeuronManagerEscrowSnapshot)>(
            neuronManagerEscrowSnapshots,
            func((id, _)) { not Principal.equal(id, canisterId) }
        );
    };
    
    /// Snapshot neuron hotkeys and botkeys, then clear them during escrow.
    /// This is called asynchronously via Timer after the canister is escrowed.
    func snapshotAndCleanNeuronManager(canisterId : Principal) : async () {
        try {
            let manager : T.ICPNeuronManagerActor = actor(Principal.toText(canisterId));
            
            // Step 1: Snapshot neuron hotkeys
            let neuronHotkeys = Buffer.Buffer<T.NeuronHotkeySnapshotEntry>(0);
            try {
                let neuronsInfo = await manager.getAllNeuronsInfo();
                for ((neuronId, _) in neuronsInfo.vals()) {
                    try {
                        let fullNeuron = await manager.getFullNeuron(neuronId);
                        switch (fullNeuron) {
                            case (?neuron) {
                                if (neuron.hot_keys.size() > 0) {
                                    neuronHotkeys.add({
                                        neuron_id = neuronId;
                                        hotkeys = neuron.hot_keys;
                                    });
                                };
                            };
                            case null {};
                        };
                    } catch (_) {};
                };
            } catch (_) {};
            
            // Step 2: Snapshot botkeys (raw numeric IDs)
            var botkeys : [(Principal, [Nat])] = [];
            try {
                botkeys := await manager.getBotkeySnapshot();
            } catch (_) {}; // Older bots (< v0.9.1) may not have this method
            
            // Step 3: Store the combined snapshot
            putEscrowSnapshot(canisterId, {
                neuron_hotkeys = Buffer.toArray(neuronHotkeys);
                botkeys = botkeys;
            });
            
            // Step 4: Remove neuron hotkeys
            for (entry in Buffer.toArray(neuronHotkeys).vals()) {
                for (hotkey in entry.hotkeys.vals()) {
                    try {
                        ignore await manager.removeHotKey(entry.neuron_id, hotkey);
                    } catch (_) {};
                };
            };
            
            // Step 5: Clear botkeys
            try {
                await manager.clearBotkeys();
            } catch (_) {}; // Older bots may not have this method
        } catch (_) {};
    };
    
    /// Snapshot botkeys and clear them during escrow for a Trading Bot.
    /// Similar to neuron manager flow but without neuron hotkeys.
    func snapshotAndCleanTradingBot(canisterId : Principal) : async () {
        try {
            let bot : T.TradingBotActor = actor(Principal.toText(canisterId));
            
            var botkeys : [(Principal, [Nat])] = [];
            try {
                botkeys := await bot.getBotkeySnapshot();
            } catch (_) {};
            
            putEscrowSnapshot(canisterId, {
                neuron_hotkeys = [];
                botkeys = botkeys;
            });
            
            try {
                await bot.clearBotkeys();
            } catch (_) {};
        } catch (_) {};
    };
    
    /// Restore botkeys from escrow snapshot for a Trading Bot.
    func restoreTradingBotState(canisterId : Principal) : async () {
        switch (getEscrowSnapshot(canisterId)) {
            case null {};
            case (?snapshot) {
                try {
                    let bot : T.TradingBotActor = actor(Principal.toText(canisterId));
                    if (snapshot.botkeys.size() > 0) {
                        try {
                            await bot.restoreBotkeySnapshot(snapshot.botkeys);
                        } catch (_) {};
                    };
                } catch (_) {};
                removeEscrowSnapshot(canisterId);
            };
        };
    };
    
    /// Restore neuron hotkeys and botkeys from escrow snapshot.
    /// Called during reclaim BEFORE the canister controllers are released,
    /// since Sneedex needs to still be a controller to call these methods.
    func restoreNeuronManagerState(canisterId : Principal) : async () {
        switch (getEscrowSnapshot(canisterId)) {
            case null {}; // No snapshot, nothing to restore
            case (?snapshot) {
                try {
                    let manager : T.ICPNeuronManagerActor = actor(Principal.toText(canisterId));
                    
                    // Restore neuron hotkeys
                    for (entry in snapshot.neuron_hotkeys.vals()) {
                        for (hotkey in entry.hotkeys.vals()) {
                            try {
                                ignore await manager.addHotKey(entry.neuron_id, hotkey);
                            } catch (_) {};
                        };
                    };
                    
                    // Restore botkeys
                    if (snapshot.botkeys.size() > 0) {
                        try {
                            await manager.restoreBotkeySnapshot(snapshot.botkeys);
                        } catch (_) {}; // Older bots may not have this method
                    };
                } catch (_) {};
                
                // Remove the snapshot after restoration
                removeEscrowSnapshot(canisterId);
            };
        };
    };
    
    func recordSnsNeuronEscrowPermissions(offerId : T.OfferId, assetIndex : Nat, perms : [T.NeuronPermission]) {
        let others = Array.filter<(T.OfferId, Nat, [T.NeuronPermission])>(
            snsNeuronEscrowPermissions,
            func((o, i, _)) { not (o == offerId and i == assetIndex) }
        );
        snsNeuronEscrowPermissions := Array.append(others, [(offerId, assetIndex, perms)]);
    };

    /// What each principal of an escrowed neuron gets back when the seller reclaims it.
    /// With permissions stored at escrow: exactly what the principal had (less the
    /// "Unspecified" permission 0, which cannot be granted). For escrows made before
    /// permissions were stored, only the principal list is known: the offer creator was
    /// verified as a full owner at escrow and gets full owner permissions back; every other
    /// principal gets hotkey permissions only (submit proposal and vote), never more than a
    /// hotkey, so no principal can end up with more control than it may have had.
    func neuronRestorePermissions(offer : T.Offer, assetIndex : Nat, snapshot : [Principal]) : [(Principal, [Int32])] {
        let stored = Array.find<(T.OfferId, Nat, [T.NeuronPermission])>(
            snsNeuronEscrowPermissions,
            func((o, i, _)) { o == offer.id and i == assetIndex }
        );
        switch (stored) {
            case (?(_, _, perms)) {
                Array.mapFilter<T.NeuronPermission, (Principal, [Int32])>(perms, func(np) {
                    switch (np.principal) {
                        case null { null };
                        case (?p) {
                            let grantable = Array.filter<Int32>(np.permission_type, func(x) { x != T.SNS_NEURON_PERMISSION_UNSPECIFIED });
                            if (grantable.size() == 0) { null } else { ?(p, grantable) };
                        };
                    };
                });
            };
            case null {
                Array.map<Principal, (Principal, [Int32])>(snapshot, func(p) {
                    if (Principal.equal(p, offer.creator)) { (p, T.FULL_OWNER_PERMISSIONS) }
                    else { (p, [T.SNS_NEURON_PERMISSION_SUBMIT_PROPOSAL, T.SNS_NEURON_PERMISSION_VOTE]) };
                });
            };
        };
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

                // Serialize with any other payout on this bid (a duplicate
                // auto-refund, a manual refundBid, or a withdrawal). Skip if one
                // is already running — the state check above holds atomically with
                // this lock acquisition, so a concurrent payout can't slip through.
                if (isBidEscrowLocked(bid.id)) {
                    return;
                };
                lockBidEscrow(bid.id);

                try {
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
                } finally {
                    unlockBidEscrow(bid.id);
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
    
    // ============================================
    // SETTLEMENT: HANDING THE ASSETS OVER
    // ============================================

    func deliveredIndicesOf(offerId : T.OfferId) : [Nat] {
        for ((o, idx) in settlementDelivered.vals()) { if (o == offerId) { return idx } };
        [];
    };

    func isAssetDelivered(offerId : T.OfferId, assetIndex : Nat) : Bool {
        Array.find<Nat>(deliveredIndicesOf(offerId), func(i) { i == assetIndex }) != null;
    };

    func markAssetDelivered(offerId : T.OfferId, assetIndex : Nat) {
        if (isAssetDelivered(offerId, assetIndex)) { return };
        let updated = Array.append(deliveredIndicesOf(offerId), [assetIndex]);
        let others = Array.filter<(T.OfferId, [Nat])>(settlementDelivered, func((o, _)) { o != offerId });
        settlementDelivered := Array.append(others, [(offerId, updated)]);
    };

    func clearDeliveredAssets(offerId : T.OfferId) {
        settlementDelivered := Array.filter<(T.OfferId, [Nat])>(settlementDelivered, func((o, _)) { o != offerId });
    };

    /// Set an offer's state, keeping everything else as the offer has it now.
    func setOfferState(offerId : T.OfferId, newState : T.OfferState) {
        switch (getOffer(offerId)) {
            case (?offer) { updateOffer(offerId, { offer with state = newState }) };
            case null {};
        };
    };

    /// The marketplace cut already paid out of a winning bid's escrow (zero if none). The cut log
    /// is append-only, so this is the record that the cut must not be paid again.
    func cutPaidForBid(bidId : T.BidId) : Nat {
        var paid = 0;
        for (e in cutPaymentLog.vals()) { if (e.bid_id == bidId) { paid += e.cut_amount } };
        paid;
    };

    func errorText(e : T.SneedexError) : Text {
        switch (e) {
            case (#TransferFailed(t) or #CanisterError(t) or #GovernanceError(t) or #InvalidAsset(t) or #InvalidState(t) or #EscrowFailed(t)) { t };
            case (_) { debug_show (e) };
        };
    };

    /// Another offer (any state) names the same canister, neuron or lock.
    func otherOfferListsAsset(offerId : T.OfferId, asset : T.Asset) : Bool {
        for (o in offers.vals()) {
            if (o.id != offerId and assetExists(o.assets, asset)) { return true };
        };
        false;
    };

    /// Hand one asset of an offer to `recipient`: to the winner (toBuyer) or back to the seller.
    /// Safe to repeat after a failure: a canister's controllers, a neuron's new owner, a lock's
    /// owner and a token sweep are each one call that happens whole or not at all (re-adding a
    /// neuron permission that was already added is harmless), and NFTs are moved only while they
    /// are still in the offer's escrow subaccount.
    func deliverAsset(offer : T.Offer, assetIndex : Nat, recipient : Principal, toBuyer : Bool) : async* T.Result<()> {
        let escrowSub = Utils.offerEscrowSubaccount(offer.creator, offer.id);
        switch (offer.assets[assetIndex].asset) {
            case (#Canister(asset)) {
                let ckind = switch (asset.canister_kind) { case (?k) { k }; case null { 0 } };
                if (toBuyer) {
                    let r = await* AssetHandlers.transferCanister(asset.canister_id, [recipient]);
                    // the buyer gets a clean canister: a bot's escrow snapshot is dropped, not restored
                    switch (r) {
                        case (#ok(_)) {
                            if (ckind == T.CANISTER_KIND_ICP_NEURON_MANAGER or ckind == T.CANISTER_KIND_TRADING_BOT) {
                                removeEscrowSnapshot(asset.canister_id);
                            };
                        };
                        case (#err(_)) {};
                    };
                    r;
                } else {
                    // restore botkeys BEFORE releasing controllers (nothing to do once restored)
                    if (ckind == T.CANISTER_KIND_ICP_NEURON_MANAGER) {
                        await restoreNeuronManagerState(asset.canister_id);
                    } else if (ckind == T.CANISTER_KIND_TRADING_BOT) {
                        await restoreTradingBotState(asset.canister_id);
                    };
                    switch (asset.controllers_snapshot) {
                        case (?snapshot) { await* AssetHandlers.releaseCanister(asset.canister_id, snapshot) };
                        case null { await* AssetHandlers.transferCanister(asset.canister_id, [recipient]) };
                    };
                };
            };
            case (#SNSNeuron(asset)) {
                if (toBuyer) {
                    await* AssetHandlers.transferNeuron(asset.governance_canister_id, asset.neuron_id, self(), [recipient]);
                } else {
                    switch (asset.hotkeys_snapshot) {
                        case (?snapshot) {
                            await* AssetHandlers.releaseNeuron(asset.governance_canister_id, asset.neuron_id, self(), neuronRestorePermissions(offer, assetIndex, snapshot));
                        };
                        case null {
                            await* AssetHandlers.transferNeuron(asset.governance_canister_id, asset.neuron_id, self(), [recipient]);
                        };
                    };
                };
            };
            case (#ICRC1Token(asset)) {
                switch (await* AssetHandlers.reclaimAllTokens(asset.ledger_canister_id, self(), escrowSub, { owner = recipient; subaccount = null })) {
                    case (#ok(_)) { #ok() };
                    case (#err(e)) { #err(e) };
                };
            };
            case (#ICRC7NFT(asset)) {
                switch (await* AssetHandlers.deliverEscrowedNfts(asset.collection_canister_id, self(), escrowSub, { owner = recipient; subaccount = null }, asset.token_ids)) {
                    case (#ok(_)) { #ok() };
                    case (#err(e)) { #err(e) };
                };
            };
            case (#SneedLock(asset)) {
                await* AssetHandlers.transferSneedLock(sneedLockCanisterId, asset, recipient);
            };
        };
    };

    /// For an offer that is already Claimed or Reclaimed: offers settled before per-asset tracking
    /// were marked so even when a hand-over failed. Hand an asset over only when it is provably
    /// still held in escrow for this offer, as a failed hand-over left it. Returns whether
    /// anything was handed over.
    ///  - tokens: the escrow subaccount is this offer's alone; to the buyer only while it still
    ///    holds the whole amount that was sold (a delivered escrow is left empty)
    ///  - NFTs: only the tokens still in this offer's escrow subaccount
    ///  - canisters, neurons, locks: custody is not per offer, so only when no other offer names
    ///    the asset and Sneedex is its sole controller / sole permission holder / owner
    func recoverAsset(offer : T.Offer, assetIndex : Nat, recipient : Principal, toBuyer : Bool) : async* T.Result<Bool> {
        let entry = offer.assets[assetIndex];
        let escrowSub = Utils.offerEscrowSubaccount(offer.creator, offer.id);
        switch (entry.asset) {
            case (#ICRC1Token(asset)) {
                let bal = await* AssetHandlers.getTokenBalance(asset.ledger_canister_id, self(), ?escrowSub);
                let fee = await* AssetHandlers.getTokenFee(asset.ledger_canister_id);
                if (bal <= fee or (toBuyer and bal < asset.amount)) { return #ok(false) };
                switch (await* AssetHandlers.reclaimAllTokens(asset.ledger_canister_id, self(), escrowSub, { owner = recipient; subaccount = null })) {
                    case (#ok(_)) { #ok(true) };
                    case (#err(e)) { #err(e) };
                };
            };
            case (#ICRC7NFT(asset)) {
                switch (await* AssetHandlers.deliverEscrowedNfts(asset.collection_canister_id, self(), escrowSub, { owner = recipient; subaccount = null }, asset.token_ids)) {
                    case (#ok(n)) { #ok(n > 0) };
                    case (#err(e)) { #err(e) };
                };
            };
            case (_) {
                if (otherOfferListsAsset(offer.id, entry.asset)) { return #ok(false) };
                let held = switch (entry.asset) {
                    case (#Canister(a)) { await* AssetHandlers.isSoleCanisterController(a.canister_id, self()) };
                    case (#SNSNeuron(a)) { await* AssetHandlers.isSoleNeuronHolder(a.governance_canister_id, a.neuron_id, self()) };
                    case (#SneedLock(a)) {
                        switch (await* AssetHandlers.readSneedLock(sneedLockCanisterId, a.lock_id)) {
                            case (#ok((owner, _))) { Principal.equal(owner, self()) };
                            case (#err(_)) { false };
                        };
                    };
                    case (_) { false };
                };
                if (not held) { return #ok(false) };
                switch (await* deliverAsset(offer, assetIndex, recipient, toBuyer)) {
                    case (#ok(_)) { #ok(true) };
                    case (#err(e)) { #err(e) };
                };
            };
        };
    };

    /// Hand every asset of a settled offer to its recipient: the winner of a Completed offer
    /// (toBuyer) or the seller of an Expired / Cancelled one (only the assets that were escrowed).
    /// Each asset handed over is recorded, so a retry redoes only the ones that failed, and the
    /// offer becomes Claimed / Reclaimed only once every asset is delivered; until then it stays
    /// Completed / Expired / Cancelled and the error names what failed.
    /// With `recover` the offer is already Claimed / Reclaimed; see recoverAsset.
    /// `winningBid`: never hand assets to the winner while the seller is still owed and the
    /// winning escrow no longer holds what the seller is due (the bid less any cut already paid).
    /// Serialized per offer. Returns how many assets this call handed over.
    func settleAssets(offerId : T.OfferId, toBuyer : Bool, recover : Bool, recipient : Principal, winningBid : ?T.Bid) : async* T.Result<Nat> {
        if (Map.has(settlementLocks, nhash, offerId)) {
            return #err(#InvalidState("A hand-over of this offer's assets is already in progress; try again shortly"));
        };
        Map.set(settlementLocks, nhash, offerId, ());
        try {
            let offer = switch (getOffer(offerId)) { case (?o) { o }; case null { return #err(#OfferNotFound) } };
            // checked again under the lock: the state decides who receives the assets
            let stateOk = switch (offer.state, toBuyer, recover) {
                case (#Completed(_), true, false) { true };
                case (#Claimed, true, true) { true };
                case ((#Expired or #Cancelled), false, false) { true };
                case (#Reclaimed, false, true) { true };
                case (_) { false };
            };
            if (not stateOk) { return #err(#InvalidState("The offer is not in a state to hand these assets over")) };

            switch (winningBid) {
                case (?b) {
                    switch (getBid(b.id)) {
                        case null { return #err(#BidNotFound) };
                        case (?bid) {
                            if (bid.state == #Won) {
                                let paidCut = cutPaidForBid(bid.id);
                                let due = if (bid.amount > paidCut) { bid.amount - paidCut } else { 0 };
                                let escrowBalance = await* AssetHandlers.getTokenBalance(
                                    offer.price_token_ledger,
                                    self(),
                                    ?Utils.bidEscrowSubaccount(bid.bidder, bid.id)
                                );
                                if (escrowBalance < due) {
                                    return #err(#InvalidState("Winning bid escrow no longer holds the full bid amount; assets cannot be released"));
                                };
                            };
                        };
                    };
                };
                case null {};
            };

            let failures = Buffer.Buffer<Text>(0);
            var handedOver = 0;
            for (assetIndex in offer.assets.keys()) {
                let entry = offer.assets[assetIndex];
                let pending = (toBuyer or entry.escrowed) and (recover or not isAssetDelivered(offerId, assetIndex));
                if (pending) {
                    if (recover) {
                        switch (await* recoverAsset(offer, assetIndex, recipient, toBuyer)) {
                            case (#ok(moved)) { if (moved) { handedOver += 1 } };
                            case (#err(e)) { failures.add("asset " # Nat.toText(assetIndex) # ": " # errorText(e)) };
                        };
                    } else {
                        switch (await* deliverAsset(offer, assetIndex, recipient, toBuyer)) {
                            case (#ok(_)) {
                                markAssetDelivered(offerId, assetIndex);
                                handedOver += 1;
                            };
                            case (#err(e)) { failures.add("asset " # Nat.toText(assetIndex) # ": " # errorText(e)) };
                        };
                    };
                };
            };

            if (failures.size() > 0) {
                return #err(#TransferFailed("Not every asset could be handed over (" # Text.join("; ", failures.vals()) # "). The assets handed over are recorded; call again to retry the rest."));
            };
            if (not recover) {
                setOfferState(offerId, if (toBuyer) { #Claimed } else { #Reclaimed });
                clearDeliveredAssets(offerId);
            };
            #ok(handedOver);
        } finally {
            Map.delete(settlementLocks, nhash, offerId);
        };
    };

    /// Register delivered assets in the recipient's Sneed Hub wallet (best effort, on a timer).
    func scheduleWalletRegistration<system>(offer : T.Offer, recipient : Principal, toBuyer : Bool) {
        ignore Timer.setTimer<system>(#seconds 0, func () : async () {
            for (entry in offer.assets.vals()) {
                if (toBuyer or entry.escrowed) {
                    switch (entry.asset) {
                        case (#Canister(asset)) {
                            await registerCanisterToWallet(recipient, asset.canister_id, asset.canister_kind);
                        };
                        case (#ICRC1Token(asset)) {
                            // the seller already has the token in the wallet
                            if (toBuyer) { await registerTokenToWallet(recipient, asset.ledger_canister_id) };
                        };
                        // SNS neurons are shown via SNS governance; NFT collections per user on the NFT page
                        case (#SNSNeuron(_) or #ICRC7NFT(_) or #SneedLock(_)) {};
                    };
                };
            };
        });
    };

    /// Auto-deliver assets to the winning bidder (called via Timer). Best effort: if a hand-over
    /// fails the offer stays Completed and the buyer's claimAssets retries the missing assets.
    func autoDeliverAssets(offerId : T.OfferId) : async () {
        switch (getOffer(offerId)) {
            case null {};
            case (?offer) {
                switch (offer.state) {
                    case (#Completed(completion)) {
                        switch (getBid(completion.winning_bid_id)) {
                            case null {};
                            case (?bid) {
                                switch (await* settleAssets(offerId, true, false, bid.bidder, ?bid)) {
                                    case (#ok(_)) { scheduleWalletRegistration<system>(offer, bid.bidder, true) };
                                    case (#err(_)) {};
                                };
                            };
                        };
                    };
                    case (_) {};
                };
            };
        };
    };
    
    /// The winning bid of a Completed or Claimed offer, whatever its payout state.
    /// A Completed offer names it; once the assets are claimed the offer state no longer
    /// does, so the bid of the offer that won (Won, or ClaimedBySeller once paid) is used.
    func findWinningBid(offer : T.Offer) : ?T.Bid {
        switch (offer.state) {
            case (#Completed(completion)) { getBid(completion.winning_bid_id) };
            case (#Claimed) {
                for (b in getBidsForOffer(offer.id).vals()) {
                    if (b.state == #Won or b.state == #ClaimedBySeller) { return ?b };
                };
                null;
            };
            case (_) { null };
        };
    };

    /// Pay a Won bid out of its escrow: the marketplace cut (rate locked at offer creation)
    /// to the fee recipient of the price ledger, the rest less one ledger fee to the seller.
    /// A cut no bigger than one ledger fee could not be sent, so it is not taken at all.
    /// Shared by claimWinningBid and the auto-delivery timer; serialized per bid.
    func payWinningBidToSeller(offer : T.Offer, bid : T.Bid) : async* T.Result<()> {
        if (bid.state != #Won) {
            return #err(#InvalidState("Bid is not in won state"));
        };
        // Serialize with any other payout from this escrow (the auto-delivery timer or a
        // concurrent manual claim) so the seller payout cannot run twice across the awaits.
        if (isBidEscrowLocked(bid.id)) {
            return #err(#InvalidState("An escrow operation is already in progress for this bid"));
        };
        lockBidEscrow(bid.id);
        try {
            let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
            let subaccount = Utils.bidEscrowSubaccount(bid.bidder, bid.id);

            // A cut paid by an earlier attempt whose seller transfer then failed is not paid again:
            // the retry only pays the seller (the escrow already holds just the bid less that cut).
            let alreadyPaidCut = cutPaidForBid(bid.id);
            let rawCut = bid.amount * offer.fee_rate_bps / 10000;
            let marketplaceFee = if (alreadyPaidCut > 0) { alreadyPaidCut } else if (rawCut > fee) { rawCut } else { 0 };

            if (marketplaceFee > 0 and alreadyPaidCut == 0) {
                // The escrow pays the cut less one fee, plus that ledger fee: marketplaceFee in all.
                let feeTransferResult = await* AssetHandlers.transferTokens(
                    offer.price_token_ledger,
                    ?subaccount,
                    getFeeRecipientForLedger(offer.price_token_ledger),
                    marketplaceFee - fee
                );
                switch (feeTransferResult) {
                    case (#err(e)) { return #err(e) };
                    case (#ok(txId)) {
                        recordCutPayment(
                            offer.id,
                            bid.id,
                            offer.creator,
                            bid.bidder,
                            offer.price_token_ledger,
                            marketplaceFee,
                            txId,
                            bid.amount,
                            offer.fee_rate_bps
                        );
                    };
                };
            };

            let amountAfterFee = bid.amount - marketplaceFee;
            let sellerTransferAmount = if (amountAfterFee > fee) { amountAfterFee - fee } else { 0 };
            if (sellerTransferAmount == 0) {
                return #err(#InsufficientFunds({ available = amountAfterFee; required = fee }));
            };

            let transferResult = await* AssetHandlers.transferTokens(
                offer.price_token_ledger,
                ?subaccount,
                { owner = offer.creator; subaccount = null },
                sellerTransferAmount
            );
            switch (transferResult) {
                case (#err(e)) { #err(e) };
                case (#ok(_)) {
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
        } finally {
            unlockBidEscrow(bid.id);
        };
    };

    /// Auto-deliver payment to seller (called via Timer)
    /// Best effort - if it fails, seller can manually claim from GUI
    func autoDeliverPayment(offerId : T.OfferId) : async () {
        switch (getOffer(offerId)) {
            case null { /* Offer not found, ignore */ };
            case (?offer) {
                switch (findWinningBid(offer)) {
                    case null { /* No winning bid, ignore */ };
                    case (?bid) {
                        if (bid.state != #Won) { return }; // Already claimed
                        // Errors (a payout in flight, a failed transfer) leave the seller to claim by hand.
                        ignore await* payWinningBidToSeller(offer, bid);
                    };
                };
            };
        };
    };

    /// Auto-reclaim assets for expired/cancelled offers (called via Timer). Best effort: if a
    /// hand-over fails the offer stays Expired/Cancelled and the seller's reclaimAssets retries.
    func autoReclaimAssets(offerId : T.OfferId) : async () {
        switch (getOffer(offerId)) {
            case null {};
            case (?offer) {
                if (offer.state != #Expired and offer.state != #Cancelled) {
                    return; // Wrong state
                };
                switch (await* settleAssets(offerId, false, false, offer.creator, null)) {
                    case (#ok(_)) { scheduleWalletRegistration<system>(offer, offer.creator, false) };
                    case (#err(_)) {};
                };
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
                            case (#ICRC7NFT(_)) { updatedAssets.add(entry) };
                            case (#SneedLock(_)) { updatedAssets.add(entry) };
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
    
    // ============================================
    // EXPIRATION AUTO-PROCESSING TIMER
    // ============================================
    
    /// Find the first Active offer that has passed its expiration time
    func findFirstExpiredOffer() : ?T.Offer {
        let now = Time.now();
        for (offer in offers.vals()) {
            if (offer.state == #Active) {
                switch (offer.expiration) {
                    case (?exp) {
                        if (exp < now) {
                            return ?offer;
                        };
                    };
                    case null {};
                };
            };
        };
        return null;
    };
    
    /// Worker function that processes expired offers one by one
    /// Uses 0-second timers to chain calls and avoid instruction limits
    func expirationWorker() : async () {
        // Find next expired offer
        switch (findFirstExpiredOffer()) {
            case null {
                // No more expired offers, worker is done
                expirationWorkerRunning := false;
                Debug.print("Expiration worker: No more expired offers to process");
            };
            case (?offer) {
                Debug.print("Expiration worker: Processing offer #" # Nat.toText(offer.id));
                
                // Process this expired offer
                switch (offer.expiration) {
                    case (?_exp) {
                        // Check for highest bid
                        switch (getHighestBid(offer.id)) {
                            case (?highest) {
                                // Complete with highest bid
                                Debug.print("Expiration worker: Completing offer #" # Nat.toText(offer.id) # " with winning bid #" # Nat.toText(highest.id));
                                ignore await completeOfferInternal(offer.id, highest.id);
                            };
                            case null {
                                // No bids - mark as expired
                                Debug.print("Expiration worker: No bids, marking offer #" # Nat.toText(offer.id) # " as expired");
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
                                updateOffer(offer.id, updatedOffer);
                                
                                // Notify seller of expiration (fire-and-forget)
                                notifyExpiration<system>(offer);
                                
                                // Schedule auto-reclaim of assets
                                scheduleAutoReclaimAssets<system>(offer.id);
                            };
                        };
                    };
                    case null {
                        // Should not happen - we only found offers with expiration
                        Debug.print("Expiration worker: Offer #" # Nat.toText(offer.id) # " has no expiration (unexpected)");
                    };
                };
                
                // Schedule next worker iteration (0-second delay to yield)
                scheduleExpirationWorker<system>();
            };
        };
    };
    
    /// Schedule the worker to run (0-second timer to yield execution)
    func scheduleExpirationWorker<system>() {
        ignore Timer.setTimer<system>(#seconds 0, func() : async () {
            await expirationWorker();
        });
    };
    
    /// Main timer callback - starts a worker if not already running
    func expirationTimerCallback<system>() : async () {
        Debug.print("Expiration timer: Checking for expired offers...");
        
        if (expirationWorkerRunning) {
            Debug.print("Expiration timer: Worker already running, skipping this cycle");
            return;
        };
        
        // Check if there are any expired offers to process
        switch (findFirstExpiredOffer()) {
            case null {
                Debug.print("Expiration timer: No expired offers found");
            };
            case (?_offer) {
                Debug.print("Expiration timer: Found expired offers, starting worker");
                expirationWorkerRunning := true;
                scheduleExpirationWorker<system>();
            };
        };
    };
    
    /// Start the periodic expiration timer with the configured interval
    func startExpirationTimerInternal<system>() {
        // Cancel existing timer if any
        switch (expirationTimerId) {
            case (?id) { Timer.cancelTimer(id); };
            case null {};
        };
        
        // Create new recurring timer
        let timerId = Timer.recurringTimer<system>(#seconds expirationCheckIntervalSeconds, func() : async () {
            await expirationTimerCallback<system>();
        });
        expirationTimerId := ?timerId;
        Debug.print("Expiration timer started with interval: " # Nat.toText(expirationCheckIntervalSeconds) # " seconds");
    };
    
    /// Stop the periodic expiration timer
    func stopExpirationTimerInternal() {
        switch (expirationTimerId) {
            case (?id) {
                Timer.cancelTimer(id);
                expirationTimerId := null;
                Debug.print("Expiration timer stopped");
            };
            case null {
                Debug.print("Expiration timer was not running");
            };
        };
    };
    
    func getBidsForOffer(offerId : T.OfferId) : [T.Bid] {
        Array.filter<T.Bid>(bids, func(b : T.Bid) : Bool {
            b.offer_id == offerId;
        });
    };
    
    /// Get only confirmed bids for an offer (excludes unconfirmed reservations with amount=0)
    func getConfirmedBidsForOffer(offerId : T.OfferId) : [T.Bid] {
        Array.filter<T.Bid>(bids, func(b : T.Bid) : Bool {
            b.offer_id == offerId and b.tokens_escrowed;
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
    
    /// Reactivate an asset type that was deactivated (admin only)
    public shared ({ caller }) func reactivateAssetType(assetTypeId : T.AssetTypeId) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        if (Array.find<T.AssetType>(assetTypes, func(t) { t.id == assetTypeId }) == null) {
            return #err(#InvalidAsset("Unknown asset type"));
        };
        assetTypes := Array.map<T.AssetType, T.AssetType>(assetTypes, func(t : T.AssetType) : T.AssetType {
            if (t.id == assetTypeId) {
                { id = t.id; name = t.name; description = t.description; active = true };
            } else { t };
        });
        #ok();
    };

    /// Whether the registry lists the type as active (a type missing from the registry is not)
    func isAssetTypeActive(assetTypeId : T.AssetTypeId) : Bool {
        switch (Array.find<T.AssetType>(assetTypes, func(t) { t.id == assetTypeId })) {
            case (?t) { t.active };
            case null { false };
        };
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
            #Err("Failed to verify canister as ICP Staking Bot. getVersion() call failed.");
        };
    };
    
    /// Verify if a canister is a Trading Bot by calling getVersion()
    public shared func verifyTradingBot(canisterId : Principal) : async { #Ok : T.TradingBotVersion; #Err : Text } {
        try {
            let bot : T.TradingBotActor = actor(Principal.toText(canisterId));
            let version = await bot.getVersion();
            #Ok(version);
        } catch (_e) {
            #Err("Failed to verify canister as Trading Bot. getVersion() call failed.");
        };
    };
    
    // Internal: check if a canister is currently held in escrow by a live offer.
    // Only PendingEscrow and Active offers actually hold custody of assets;
    // Cancelled/Expired/Reclaimed/Completed/Claimed offers no longer do.
    /// A lock listed in any offer that is still open (draft, awaiting escrow, or active).
    func isSneedLockListed(lockId : Nat) : Bool {
        for (offer in offers.vals()) {
            if (offer.state == #Draft or offer.state == #PendingEscrow or offer.state == #Active) {
                for (assetEntry in offer.assets.vals()) {
                    switch (assetEntry.asset) {
                        case (#SneedLock(l)) { if (l.lock_id == lockId) { return true } };
                        case (_) {};
                    };
                };
            };
        };
        false;
    };
    
    func isCanisterInEscrow(canisterId : Principal) : Bool {
        for (offer in offers.vals()) {
            if (offer.state == #PendingEscrow or offer.state == #Active) {
                for (assetEntry in offer.assets.vals()) {
                    switch (assetEntry.asset) {
                        case (#Canister(c)) {
                            if (c.canister_id == canisterId and assetEntry.escrowed) {
                                return true;
                            };
                        };
                        case (_) {};
                    };
                };
            };
        };
        false;
    };
    
    // Internal: fetch fresh neuron manager info from a staking bot and cache it
    func fetchAndCacheNeuronManagerInfo(canisterId : Principal) : async { #Ok : T.NeuronManagerInfo; #Err : Text } {
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
                        // Get full neuron to get maturity data and hotkeys
                        let fullNeuronOpt = await manager.getFullNeuron(nid);
                        let (maturity, stakedMaturity, hotKeys) = switch (fullNeuronOpt) {
                            case null { (0 : Nat64, 0 : Nat64, [] : [Principal]) };
                            case (?fullNeuron) {
                                let staked = switch (fullNeuron.staked_maturity_e8s_equivalent) {
                                    case null { 0 : Nat64 };
                                    case (?s) { s };
                                };
                                (fullNeuron.maturity_e8s_equivalent, staked, fullNeuron.hot_keys);
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
                            hot_keys = hotKeys;
                        });
                    };
                };
            };
            
            let neurons = Buffer.toArray(neuronsBuffer);
            
            let info : T.NeuronManagerInfo = {
                version = version;
                neuron_count = neurons.size();
                neurons = neurons;
            };
            
            let now = Time.now();
            
            // Cache the result
            putCacheEntry(canisterId, {
                fetched_at = now;
                info = info;
            });
            
            #Ok(info);
        } catch (_e) {
            #Err("Failed to get staking bot info");
        };
    };
    
    /// Get info about an escrowed ICP Neuron Manager canister.
    /// Uses cache: returns cached data if fresh, otherwise fetches from the bot.
    public shared func getNeuronManagerInfo(canisterId : Principal) : async { #Ok : T.NeuronManagerInfo; #Err : Text } {
        // First verify we have this canister in escrow
        if (not isCanisterInEscrow(canisterId)) {
            return #Err("Canister is not in escrow");
        };
        
        // Check cache first
        switch (getCacheEntry(canisterId)) {
            case (?entry) {
                if (isCacheFresh(entry)) {
                    return #Ok(entry.info);
                };
            };
            case null {};
        };
        
        // Cache miss or stale - fetch fresh
        await fetchAndCacheNeuronManagerInfo(canisterId);
    };
    
    /// Query method: get cached ICP Neuron Manager info (no inter-canister calls).
    /// Returns cached data if fresh, null if stale or missing.
    /// Frontend should call this first; if null, fall back to getNeuronManagerInfo.
    public query func getCachedNeuronManagerInfoQuery(canisterId : Principal) : async ?T.NeuronManagerInfo {
        switch (getCacheEntry(canisterId)) {
            case (?entry) {
                if (isCacheFresh(entry)) {
                    ?entry.info;
                } else {
                    null;
                };
            };
            case null { null };
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
                if (minBid == 0) {
                    return #err(#InvalidPrice("Minimum bid must be greater than 0 (leave it unset for buyout-only offers)"));
                };
                if (minBid > buyout) {
                    return #err(#InvalidPrice("Minimum bid cannot exceed buyout price"));
                };
            };
            case (?minBid, null) {
                if (minBid == 0) {
                    return #err(#InvalidPrice("Minimum bid must be greater than 0 (leave it unset for buyout-only offers)"));
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
        
        // Check and collect offer creation fee
        let effectiveFee = await getEffectiveOfferCreationFee(caller);
        if (effectiveFee > 0) {
            let paymentSubaccount = Utils.userPaymentSubaccount(caller);
            let icpLedger : T.ICRC1Actor = actor(ICP_LEDGER_ID);
            
            // Check user's payment balance
            let balance = await icpLedger.icrc1_balance_of({
                owner = Principal.fromActor(this);
                subaccount = ?paymentSubaccount;
            });
            
            let requiredAmount = Nat64.toNat(effectiveFee);
            if (balance < requiredAmount) {
                return #err(#InsufficientFunds({ required = requiredAmount; available = balance }));
            };
            
            // Transfer fee to the ICP fee recipient
            let icpFeeRecipient = getFeeRecipientForLedger(Principal.fromText(ICP_LEDGER_ID));
            let transferAmount = requiredAmount - Nat64.toNat(ICP_FEE); // Deduct ledger fee
            
            if (transferAmount > 0) {
                let transferResult = await icpLedger.icrc1_transfer({
                    to = icpFeeRecipient;
                    fee = ?Nat64.toNat(ICP_FEE);
                    memo = null;
                    from_subaccount = ?paymentSubaccount;
                    created_at_time = null;
                    amount = transferAmount;
                });
                
                switch (transferResult) {
                    case (#Err(e)) {
                        return #err(#TransferFailed(debug_show(e)));
                    };
                    case (#Ok(txId)) {
                        // Record the creation fee payment (offer ID will be assigned after this)
                        let paymentEntry : T.CreationFeePaymentLogEntry = {
                            id = nextCreationFeePaymentId;
                            timestamp = Nat64.fromNat(Int.abs(Time.now()));
                            payer = caller;
                            amount_e8s = requiredAmount;
                            icp_transaction_id = txId;
                            offer_id = nextOfferId; // This will be the offer ID
                        };
                        creationFeePaymentLog := Array.append(creationFeePaymentLog, [paymentEntry]);
                        nextCreationFeePaymentId += 1;
                        totalCreationFeesCollectedE8s += requiredAmount;
                    };
                };
            };
        };
        
        // Determine the fee rate for this offer (premium members may get lower rate)
        var offerFeeRateBps = marketplaceFeeRateBps;
        if (premiumAuctionCutBps > 0) {
            switch (sneedPremiumCanisterId) {
                case (?canisterId) {
                    let isPremiumMember = await* PremiumClient.isPremium(premiumCache, canisterId, caller);
                    if (isPremiumMember) {
                        offerFeeRateBps := premiumAuctionCutBps;
                    };
                };
                case null {};
            };
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
            fee_rate_bps = offerFeeRateBps; // Lock in fee rate (may be premium rate)
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
                case (#SneedLock(existing), #SneedLock(new)) {
                    if (existing.lock_id == new.lock_id) { return true };
                };
                case (#ICRC7NFT(existing), #ICRC7NFT(new)) {
                    if (Principal.equal(existing.collection_canister_id, new.collection_canister_id)) {
                        for (id in new.token_ids.vals()) { if (Array.find<Nat>(existing.token_ids, func(x) { x == id }) != null) { return true } };
                    };
                };
                case (_, _) {};
            };
        };
        false;
    };
    
    /// Add an asset to an offer (must be in Draft state)
    public shared ({ caller }) func addAsset(request : T.AddAssetRequest) : async T.Result<()> {
        // A deactivated asset type cannot be listed any more (offers already holding one are unaffected)
        if (not isAssetTypeActive(getAssetTypeId(request.asset))) {
            return #err(#InvalidAsset("This asset type is not currently accepted"));
        };
        // A Sneed Lock is checked against Sneed Lock itself before anything is recorded: it must
        // exist, be the caller's, and be the kind the caller says. The stored snapshot is the live one.
        var asset = request.asset;
        switch (request.asset) {
            case (#SneedLock(l)) {
                switch (await* AssetHandlers.readSneedLock(sneedLockCanisterId, l.lock_id)) {
                    case (#err(e)) { return #err(e) };
                    case (#ok((owner, kind))) {
                        if (not Principal.equal(owner, caller)) { return #err(#InvalidAsset("Lock " # Nat.toText(l.lock_id) # " is not yours")) };
                        let same = switch (l.lock, kind) {
                            case (#Token(a), #Token(b)) { Principal.equal(a.ledger_canister_id, b.ledger_canister_id) };
                            case (#Position(a), #Position(b)) { Principal.equal(a.swap_canister_id, b.swap_canister_id) and a.position_id == b.position_id };
                            case (_, _) { false };
                        };
                        if (not same) { return #err(#InvalidAsset("Lock " # Nat.toText(l.lock_id) # " is not the lock you described")) };
                        asset := #SneedLock({ lock_id = l.lock_id; lock = kind });
                    };
                };
            };
            // NFTs of Sneed Lock's collection are locks: the same expiry rule as the Sneed Lock type
            case (#ICRC7NFT(nft)) {
                if (Principal.equal(nft.collection_canister_id, sneedLockCanisterId)) {
                    let expiration = switch (getOffer(request.offer_id)) { case (?o) o.expiration; case null { return #err(#OfferNotFound) } };
                    switch (await* AssetHandlers.checkSneedLockNfts(sneedLockCanisterId, self(), nft.token_ids, expiration, false)) {
                        case (#err(e)) { return #err(e) };
                        case (#ok(_)) {};
                    };
                };
            };
            case (_) {};
        };
        addAssetSync(caller, { offer_id = request.offer_id; asset = asset });
    };
    
    func addAssetSync(caller : Principal, request : T.AddAssetRequest) : T.Result<()> {
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
                
                // Validate canister title and description lengths, and check if already escrowed elsewhere
                switch (request.asset) {
                    case (#Canister(canisterAsset)) {
                        // Reject if this canister is already escrowed in another offer
                        if (isCanisterInEscrow(canisterAsset.canister_id)) {
                            return #err(#InvalidAsset("This canister is already escrowed in another offer"));
                        };
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
                    case (#ICRC7NFT(nft)) {
                        if (nft.token_ids.size() == 0) { return #err(#InvalidAsset("List at least one token id")) };
                        if (nft.token_ids.size() > 50) { return #err(#InvalidAsset("At most 50 tokens of one collection per asset")) };
                        var i = 0;
                        for (id in nft.token_ids.vals()) {
                            var j = 0;
                            for (other in nft.token_ids.vals()) { if (i != j and id == other) { return #err(#InvalidAsset("Token id " # Nat.toText(id) # " is listed twice")) }; j += 1 };
                            i += 1;
                        };
                    };
                    case (#SneedLock(l)) {
                        if (isSneedLockListed(l.lock_id)) { return #err(#InvalidAsset("Lock " # Nat.toText(l.lock_id) # " is already listed in an open offer")) };
                        let expiry = switch (l.lock) { case (#Token(t)) { t.expiry }; case (#Position(p)) { p.expiry } };
                        if (Nat64.toNat(expiry) <= Int.abs(Time.now())) { return #err(#InvalidAsset("Lock " # Nat.toText(l.lock_id) # " has expired")) };
                        switch (offer.expiration) {
                            case (?e) { if (Nat64.toNat(expiry) <= Int.abs(e)) { return #err(#InvalidAsset("The lock expires before the offer does; a lock must outlive the offer")) } };
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
                        // Reject if this canister is already escrowed in another offer
                        if (isCanisterInEscrow(canisterAsset.canister_id)) {
                            return #err(#InvalidAsset("This canister is already escrowed in another offer"));
                        };
                        
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
                                        ignore Timer.setTimer<system>(#seconds 0, func () : async () {
                                            await deregisterCanisterFromWallet(caller, canisterAsset.canister_id, canisterAsset.canister_kind);
                                        });
                                        
                                        // Snapshot and clear botkeys for known bot types (best effort, non-blocking)
                                        let canisterKindVal = switch (canisterAsset.canister_kind) { case (?k) { k }; case null { 0 } };
                                        if (canisterKindVal == T.CANISTER_KIND_ICP_NEURON_MANAGER) {
                                            ignore Timer.setTimer<system>(#seconds 1, func () : async () {
                                                await snapshotAndCleanNeuronManager(canisterAsset.canister_id);
                                            });
                                        } else if (canisterKindVal == T.CANISTER_KIND_TRADING_BOT) {
                                            ignore Timer.setTimer<system>(#seconds 1, func () : async () {
                                                await snapshotAndCleanTradingBot(canisterAsset.canister_id);
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
                            case (#ok(allPermissions)) {
                                // Escrow the neuron (passing actual permissions so we can remove exactly what each principal has)
                                let escrowResult = await* AssetHandlers.escrowNeuron(
                                    neuronAsset.governance_canister_id,
                                    neuronAsset.neuron_id,
                                    self(),
                                    allPermissions
                                );
                                
                                switch (escrowResult) {
                                    case (#err(e)) { return #err(e) };
                                    case (#ok(snapshot)) {
                                        // Keep each other principal's exact permissions for a reclaim
                                        recordSnsNeuronEscrowPermissions(
                                            offerId,
                                            assetIndex,
                                            Array.filter<T.NeuronPermission>(allPermissions, func(np) {
                                                switch (np.principal) {
                                                    case (?p) { not Principal.equal(p, self()) };
                                                    case null { false };
                                                };
                                            })
                                        );
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
    
    /// Mark an ICRC-7 asset escrowed once every listed token sits in the offer's escrow
    /// subaccount of this canister (the seller transferred them there with icrc7_transfer).
    public shared ({ caller }) func escrowICRC7NFTs(offerId : T.OfferId, assetIndex : Nat) : async T.Result<()> {
        await* escrowNftsInternal(caller, offerId, assetIndex, false);
    };
    /// ICRC-37 listing: the seller approved this canister for the tokens (or the collection);
    /// Sneedex pulls them into the escrow subaccount itself, then marks the asset escrowed.
    public shared ({ caller }) func escrowICRC7NFTsByApproval(offerId : T.OfferId, assetIndex : Nat) : async T.Result<()> {
        await* escrowNftsInternal(caller, offerId, assetIndex, true);
    };
    /// Escrow a Sneed Lock: the seller has moved the lock's ownership in Sneed Lock to this canister
    /// (transfer_token_lock_ownership / transfer_position_ownership); verify it, and for a token lock
    /// make sure Sneedex can afford to pass it on (one ledger fee free in its Sneed Lock wallet).
    public shared ({ caller }) func escrowSneedLock(offerId : T.OfferId, assetIndex : Nat) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) { return #err(#NotAuthorized) };
                if (offer.state != #PendingEscrow) { return #err(#InvalidState("Offer must be in PendingEscrow state")) };
                if (assetIndex >= offer.assets.size()) { return #err(#InvalidAsset("Asset index out of bounds")) };
                let assetEntry = offer.assets[assetIndex];
                if (assetEntry.escrowed) { return #err(#InvalidAsset("Asset already escrowed")) };
                switch (assetEntry.asset) {
                    case (#SneedLock(l)) {
                        let (owner, live) = switch (await* AssetHandlers.readSneedLock(sneedLockCanisterId, l.lock_id)) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(x)) { x };
                        };
                        if (not Principal.equal(owner, self())) { return #err(#InvalidAsset("Lock " # Nat.toText(l.lock_id) # " has not been transferred to Sneedex")) };
                        let same = switch (l.lock, live) {
                            case (#Token(a), #Token(b)) { Principal.equal(a.ledger_canister_id, b.ledger_canister_id) and a.amount == b.amount };
                            case (#Position(a), #Position(b)) { Principal.equal(a.swap_canister_id, b.swap_canister_id) and a.position_id == b.position_id };
                            case (_, _) { false };
                        };
                        if (not same) { return #err(#InvalidAsset("Lock " # Nat.toText(l.lock_id) # " no longer matches the listed asset")) };
                        switch (live) {
                            case (#Token(t)) {
                                switch (await* AssetHandlers.sneedexFreeBalanceInSneedLock(sneedLockCanisterId, self(), t.ledger_canister_id)) {
                                    case (#err(e)) { return #err(e) };
                                    case (#ok((free, fee))) {
                                        if (free < fee) {
                                            return #err(#InvalidAsset("Sneedex needs " # Nat.toText(fee) # " free units of this token in its Sneed Lock wallet to pass the lock on (it has " # Nat.toText(free) # "); send the fee to Sneed Lock's subaccount for Sneedex and try again"));
                                        };
                                    };
                                };
                            };
                            case (#Position(_)) {};
                        };
                        // re-read: the offer may have changed across the awaits
                        switch (getOffer(offerId)) {
                            case null { return #err(#OfferNotFound) };
                            case (?offer2) {
                                if (offer2.state != #PendingEscrow or assetIndex >= offer2.assets.size() or offer2.assets[assetIndex].escrowed) { return #err(#InvalidState("Offer changed while escrowing")) };
                                let updatedEntry : T.AssetEntry = { asset = #SneedLock({ lock_id = l.lock_id; lock = live }); escrowed = true };
                                let updatedAssets = Utils.updateAt(offer2.assets, assetIndex, updatedEntry);
                                let updatedOffer : T.Offer = {
                                    id = offer2.id;
                                    creator = offer2.creator;
                                    min_bid_price = offer2.min_bid_price;
                                    buyout_price = offer2.buyout_price;
                                    expiration = offer2.expiration;
                                    price_token_ledger = offer2.price_token_ledger;
                                    assets = updatedAssets;
                                    state = offer2.state;
                                    min_bid_increment_fee_multiple = offer2.min_bid_increment_fee_multiple;
                                    approved_bidders = offer2.approved_bidders;
                                    fee_rate_bps = offer2.fee_rate_bps;
                                    public_note = offer2.public_note;
                                    note_to_buyer = offer2.note_to_buyer;
                                    created_at = offer2.created_at;
                                    activated_at = offer2.activated_at;
                                };
                                updateOffer(offerId, updatedOffer);
                                #ok();
                            };
                        };
                    };
                    case (_) { return #err(#InvalidAsset("Asset at index is not a Sneed Lock")) };
                };
            };
        };
    };
    
    private func escrowNftsInternal(caller : Principal, offerId : T.OfferId, assetIndex : Nat, pull : Bool) : async* T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) { return #err(#NotAuthorized) };
                if (offer.state != #PendingEscrow) { return #err(#InvalidState("Offer must be in PendingEscrow state")) };
                if (assetIndex >= offer.assets.size()) { return #err(#InvalidAsset("Asset index out of bounds")) };
                let assetEntry = offer.assets[assetIndex];
                if (assetEntry.escrowed) { return #err(#InvalidAsset("Asset already escrowed")) };
                switch (assetEntry.asset) {
                    case (#ICRC7NFT(nft)) {
                        let listedExpiration = offer.expiration;
                        let subaccount = Utils.offerEscrowSubaccount(caller, offerId);
                        if (pull) {
                            switch (await* AssetHandlers.pullNfts(nft.collection_canister_id, { owner = caller; subaccount = null }, self(), subaccount, nft.token_ids)) {
                                case (#err(e)) { return #err(e) };
                                case (#ok(_)) {};
                            };
                        };
                        switch (await* AssetHandlers.verifyNftEscrow(nft.collection_canister_id, self(), subaccount, nft.token_ids)) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(_)) {
                                // Sneed Lock NFTs: still locked past the offer, and a token lock can pay its delivery
                                if (Principal.equal(nft.collection_canister_id, sneedLockCanisterId)) {
                                    switch (await* AssetHandlers.checkSneedLockNfts(sneedLockCanisterId, self(), nft.token_ids, listedExpiration, true)) {
                                        case (#err(e)) { return #err(e) };
                                        case (#ok(_)) {};
                                    };
                                };
                                // re-read: the offer may have changed across the awaits
                                let offer = switch (getOffer(offerId)) { case (?o) o; case null { return #err(#OfferNotFound) } };
                                if (offer.state != #PendingEscrow or assetIndex >= offer.assets.size() or offer.assets[assetIndex].escrowed) { return #err(#InvalidState("Offer changed while escrowing")) };
                                let updatedEntry : T.AssetEntry = { asset = assetEntry.asset; escrowed = true };
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
                    case (_) { return #err(#InvalidAsset("Asset at index is not an ICRC-7 NFT")) };
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
                
                // Notify approved bidders of private auction invitation
                switch (updatedOffer.approved_bidders) {
                    case (?approvedList) {
                        if (approvedList.size() > 0) {
                            notifyPrivateInvite<system>(updatedOffer, approvedList);
                        };
                    };
                    case null {};
                };
                
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

                        if (amount == 0) {
                            return #err(#InvalidPrice("Bid amount must be greater than 0"));
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
                        
                        // Cap bid at buyout price if it exceeds it (no overbidding)
                        // If bid >= buyout, user only pays buyout price
                        let effectiveAmount = switch (offer.buyout_price) {
                            case (?buyout) {
                                if (amount >= buyout) { buyout } else { amount };
                            };
                            case null { amount };
                        };
                        
                        // Hold this bid's escrow lock across the awaits below. Before
                        // confirmation the withdrawal reserve is zero, so without the
                        // lock the bidder could withdraw the escrow between the balance
                        // verification and the bid being marked escrowed — confirming a
                        // bid backed by nothing. Released in the finally block at the end.
                        if (isBidEscrowLocked(bidId)) {
                            return #err(#InvalidState("An escrow operation is already in progress for this bid"));
                        };
                        lockBidEscrow(bidId);

                        try {
                        // Verify tokens in escrow (at least the effective amount)
                        let subaccount = Utils.bidEscrowSubaccount(caller, bidId);
                        let verifyResult = await* AssetHandlers.verifyTokenEscrow(
                            offer.price_token_ledger,
                            self(),
                            subaccount,
                            effectiveAmount
                        );

                        switch (verifyResult) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(escrowBalance)) {
                                // Refund any excess above the effective amount immediately.
                                // The excess is computed from the verified escrow balance,
                                // never from the caller-declared `amount`: trusting the
                                // declared amount would let a caller declare more than they
                                // deposited and have the "excess" refund drain the escrow
                                // below effectiveAmount while the bid is recorded as fully
                                // escrowed.
                                if (escrowBalance > effectiveAmount) {
                                    let ledger : T.ICRC1Actor = actor(Principal.toText(offer.price_token_ledger));
                                    let fee = await ledger.icrc1_fee();
                                    let excessAmount = escrowBalance - effectiveAmount;

                                    // Only refund if excess is greater than fee
                                    if (excessAmount > fee) {
                                        let refundAmount = excessAmount - fee;
                                        let _ = await ledger.icrc1_transfer({
                                            from_subaccount = ?subaccount;
                                            to = { owner = caller; subaccount = null };
                                            amount = refundAmount;
                                            fee = ?fee;
                                            memo = ?Text.encodeUtf8("Excess bid refund");
                                            created_at_time = ?Nat64.fromNat(Int.abs(Time.now()));
                                        });
                                    };
                                };

                                // Re-validate against current state: the offer may have been
                                // completed (buyout, acceptBid or expiration) while the awaits
                                // above were in flight. Confirming into a non-Active offer
                                // would strand this bidder's escrowed tokens in a Pending bid
                                // that nothing ever refunds. Mark it Lost and refund instead.
                                let currentBid = switch (getBid(bidId)) {
                                    case null { return #err(#BidNotFound) };
                                    case (?b) { b };
                                };
                                let offerStillActive = switch (getOffer(bid.offer_id)) {
                                    case (?o) { o.state == #Active };
                                    case null { false };
                                };
                                if (not offerStillActive and currentBid.state != #Won) {
                                    let lostBid : T.Bid = {
                                        id = currentBid.id;
                                        offer_id = currentBid.offer_id;
                                        bidder = currentBid.bidder;
                                        amount = effectiveAmount;
                                        state = #Lost;
                                        created_at = currentBid.created_at;
                                        tokens_escrowed = true;
                                    };
                                    updateBid(bidId, lostBid);
                                    scheduleAutoRefund<system>(bidId);
                                    return #err(#InvalidState("Offer is no longer active; your escrowed tokens will be refunded"));
                                };

                                // Update bid with effective amount (capped at buyout)
                                let updatedBid : T.Bid = {
                                    id = currentBid.id;
                                    offer_id = currentBid.offer_id;
                                    bidder = currentBid.bidder;
                                    amount = effectiveAmount;
                                    state = currentBid.state;
                                    created_at = currentBid.created_at;
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
                                        otherBid.amount < effectiveAmount) {
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
                                        
                                        // Notify outbid user (fire-and-forget)
                                        notifyOutbid<system>(offer, otherBid, updatedBid);
                                    };
                                };
                                
                                // Notify seller of new bid (fire-and-forget)
                                notifyNewBid<system>(offer, updatedBid);
                                
                                // Check for buyout (using effective amount which is capped at buyout)
                                switch (offer.buyout_price) {
                                    case (?buyout) {
                                        if (effectiveAmount >= buyout) {
                                            // Buyout! Attempt to complete the offer. Another
                                            // buyout may already be in flight and have completed
                                            // it first — completeOfferInternal now rejects unless
                                            // the offer is still Active. If we lost that race, this
                                            // bidder's tokens are already escrowed, so mark the bid
                                            // Lost and refund it rather than returning a misleading
                                            // success and stranding the payment.
                                            switch (await completeOfferInternal(bid.offer_id, bidId)) {
                                                case (#ok()) { /* won the buyout */ };
                                                case (#err(_)) {
                                                    switch (getBid(bidId)) {
                                                        case (?currentBid) {
                                                            if (currentBid.state != #Won) {
                                                                let lostBid : T.Bid = {
                                                                    id = currentBid.id;
                                                                    offer_id = currentBid.offer_id;
                                                                    bidder = currentBid.bidder;
                                                                    amount = currentBid.amount;
                                                                    state = #Lost;
                                                                    created_at = currentBid.created_at;
                                                                    tokens_escrowed = currentBid.tokens_escrowed;
                                                                };
                                                                updateBid(bidId, lostBid);
                                                                if (currentBid.tokens_escrowed) {
                                                                    scheduleAutoRefund<system>(bidId);
                                                                };
                                                            };
                                                        };
                                                        case null {};
                                                    };
                                                    return #err(#InvalidState("Offer was already completed by another buyer; your bid was marked lost and will be refunded"));
                                                };
                                            };
                                        };
                                    };
                                    case null {};
                                };

                                #ok();
                            };
                        };
                        } finally {
                            unlockBidEscrow(bidId);
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
                // Only an Active offer may be settled. This check and the
                // #Completed write below run with no intervening await, so they
                // are atomic: a second concurrent settlement (e.g. two buyout
                // confirmBid calls racing) sees a non-Active state here and is
                // rejected instead of overwriting the recorded winner and
                // stranding the first winner's escrowed payment.
                if (offer.state != #Active) {
                    return #err(#InvalidState("Offer is not active and cannot be completed"));
                };

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
                        
                        // Notify seller of sale and winner of win (fire-and-forget)
                        notifySale<system>(offer, updatedBid);
                        notifyWin<system>(offer, updatedBid);
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
                                
                                // Notify seller of expiration (fire-and-forget)
                                notifyExpiration<system>(offer);
                                
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
                
                // Note: We allow cancellation even with active bids
                // All bidders will be automatically refunded
                
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
                
                // Schedule auto-refund for any bids that had escrowed tokens and notify bidders
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
                        
                        // Notify bidder of cancellation (fire-and-forget)
                        notifyCancellation<system>(offer, bid);
                    };
                };
                
                #ok();
            };
        };
    };
    
    // ============================================
    // CLAIMING ASSETS AND REFUNDS
    // ============================================
    
    /// Buyer claims assets from a completed offer. Only the assets not yet handed over are moved;
    /// the offer becomes Claimed once all of them are, and stays Completed (error returned) if a
    /// hand-over fails, so calling again retries the rest.
    /// On an offer already Claimed (settled before per-asset tracking), hands over whatever is
    /// provably still in escrow for it; with nothing there it answers "Assets already claimed".
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
                                // Never hand over the assets unless the seller is still guaranteed to be
                                // paid: while the bid is #Won its escrow must hold what the seller is due.
                                // Once the seller is paid (#ClaimedBySeller) the escrow is legitimately
                                // empty and the buyer must still be able to claim. (In settleAssets.)
                                switch (await* settleAssets(offerId, true, false, caller, ?bid)) {
                                    case (#err(e)) { #err(e) };
                                    case (#ok(_)) {
                                        scheduleWalletRegistration<system>(offer, caller, true);
                                        #ok();
                                    };
                                };
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
                        switch (findWinningBid(offer)) {
                            case (?bid) {
                                if (Principal.equal(caller, bid.bidder)) {
                                    switch (await* settleAssets(offerId, true, true, caller, ?bid)) {
                                        case (#err(e)) { return #err(e) };
                                        case (#ok(n)) {
                                            if (n > 0) {
                                                scheduleWalletRegistration<system>(offer, caller, true);
                                                return #ok();
                                            };
                                        };
                                    };
                                };
                            };
                            case null {};
                        };
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
                    case (#Completed(_) or #Claimed) {
                        switch (findWinningBid(offer)) {
                            case null { #err(#BidNotFound) };
                            case (?bid) { await* payWinningBidToSeller(offer, bid) };
                        };
                    };
                    case (_) {
                        #err(#InvalidState("Offer is not completed"));
                    };
                };
            };
        };
    };
    
    /// Reclaim assets from an expired or cancelled offer. Only the escrowed assets not yet handed
    /// back are moved; the offer becomes Reclaimed once all of them are, and stays Expired/Cancelled
    /// (error returned) if a hand-over fails, so calling again retries the rest.
    /// On an offer already Reclaimed (settled before per-asset tracking), hands back whatever is
    /// provably still in escrow for it.
    public shared ({ caller }) func reclaimAssets(offerId : T.OfferId) : async T.Result<()> {
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                if (not Principal.equal(caller, offer.creator)) {
                    return #err(#NotAuthorized);
                };
                switch (offer.state) {
                    case (#Expired or #Cancelled) {
                        switch (await* settleAssets(offerId, false, false, offer.creator, null)) {
                            case (#err(e)) { #err(e) };
                            case (#ok(_)) {
                                scheduleWalletRegistration<system>(offer, offer.creator, false);
                                #ok();
                            };
                        };
                    };
                    case (#Reclaimed) {
                        switch (await* settleAssets(offerId, false, true, offer.creator, null)) {
                            case (#err(e)) { return #err(e) };
                            case (#ok(n)) {
                                if (n > 0) {
                                    scheduleWalletRegistration<system>(offer, offer.creator, false);
                                    return #ok();
                                };
                            };
                        };
                        #err(#InvalidState("Can only reclaim from expired or cancelled offers"));
                    };
                    case (_) {
                        #err(#InvalidState("Can only reclaim from expired or cancelled offers"));
                    };
                };
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
                        // Serialize with any other payout on this bid (auto-refund
                        // or withdrawal) so the escrow can't be paid out twice
                        // across the transfer await.
                        if (isBidEscrowLocked(bid.id)) {
                            return #err(#InvalidState("An escrow operation is already in progress for this bid"));
                        };
                        lockBidEscrow(bid.id);

                        try {
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
                        } finally {
                            unlockBidEscrow(bid.id);
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

                        // In-flight guard: reject a second concurrent payout on
                        // the same bid. Without this, both calls read the balance
                        // before either transfer settles, both pass the reserve
                        // check, and together they drain the escrow below bid.amount.
                        if (isBidEscrowLocked(bid.id)) {
                            return #err(#InvalidState("An escrow operation is already in progress for this bid"));
                        };
                        lockBidEscrow(bid.id);

                        try {
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

                            // The withdrawal itself pays one ledger fee out of the escrow too, so
                            // what is left afterwards is balance - amount - fee >= minimumReserved.
                            let maxWithdrawable : Nat = if (balance > minimumReserved + fee) {
                                balance - minimumReserved - fee
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
                        } finally {
                            // Always release the lock, including on early return or trap.
                            unlockBidEscrow(bid.id);
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
    
    /// Get offer by ID (note_to_buyer only for the creator and, once won, the winning bidder)
    public shared query ({ caller }) func queryOffer(offerId : T.OfferId) : async ?T.Offer {
        switch (getOffer(offerId)) {
            case null { null };
            case (?offer) { ?offerAsSeenBy(caller, offer) };
        };
    };

    /// note_to_buyer is for the creator and, once the offer is Completed/Claimed, the winning bidder.
    func canSeeNoteToBuyer(caller : Principal, offer : T.Offer) : Bool {
        if (Principal.equal(caller, offer.creator)) { return true };
        switch (offer.state) {
            case (#Completed(_) or #Claimed) {
                switch (findWinningBid(offer)) {
                    case (?bid) { Principal.equal(caller, bid.bidder) };
                    case null { false };
                };
            };
            case (_) { false };
        };
    };

    /// The offer as `caller` may see it: note_to_buyer removed unless canSeeNoteToBuyer.
    func offerAsSeenBy(caller : Principal, offer : T.Offer) : T.Offer {
        if (offer.note_to_buyer == null or canSeeNoteToBuyer(caller, offer)) { return offer };
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

    func offersAsSeenBy(caller : Principal, list : [T.Offer]) : [T.Offer] {
        Array.map<T.Offer, T.Offer>(list, func(o) { offerAsSeenBy(caller, o) });
    };
    
    /// Get offer with bids
    public shared query ({ caller }) func getOfferView(offerId : T.OfferId) : async ?T.OfferView {
        switch (getOffer(offerId)) {
            case null { null };
            case (?offer) {
                // Only return confirmed bids (excludes abandoned reservations with amount=0)
                let offerBids = getConfirmedBidsForOffer(offerId);
                let highestBid = getHighestBid(offerId);
                
                // The private note goes to the creator, and to the winning bidder once the offer is won
                let filteredOffer : T.Offer = offerAsSeenBy(caller, offer);
                
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
    public shared query ({ caller }) func getActiveOffers() : async [T.Offer] {
        offersAsSeenBy(caller, Array.filter<T.Offer>(offers, func(o : T.Offer) : Bool {
            o.state == #Active;
        }));
    };
    
    /// Get all active public offers (no approved_bidders list)
    public shared query ({ caller }) func getPublicOffers() : async [T.Offer] {
        offersAsSeenBy(caller, Array.filter<T.Offer>(offers, func(o : T.Offer) : Bool {
            o.state == #Active and o.approved_bidders == null;
        }));
    };
    
    /// Get all private offers visible to a specific principal
    /// (offers where the principal is the creator or in the approved_bidders list)
    /// For creators: shows all states (including Draft, PendingEscrow for management)
    /// For approved bidders: shows all states except Draft/PendingEscrow (so they can see completed/expired auctions)
    public shared query ({ caller }) func getPrivateOffersFor(viewer : Principal) : async [T.Offer] {
        offersAsSeenBy(caller, Array.filter<T.Offer>(offers, func(o : T.Offer) : Bool {
            switch (o.approved_bidders) {
                case null { false }; // Public offer, not included
                case (?approvedList) {
                    // If viewer is creator, show all states
                    if (Principal.equal(o.creator, viewer)) {
                        true;
                    } else {
                        // For approved bidders: show all states except Draft/PendingEscrow
                        // (Draft/PendingEscrow are pre-activation states only the creator should see)
                        if (o.state == #Draft or o.state == #PendingEscrow) {
                            false;
                        } else {
                            let isApproved = Array.find<Principal>(approvedList, func(p) { Principal.equal(p, viewer) });
                            isApproved != null;
                        };
                    };
                };
            };
        }));
    };
    
    /// Get offers by creator
    public shared query ({ caller }) func getOffersByCreator(creator : Principal) : async [T.Offer] {
        offersAsSeenBy(caller, Array.filter<T.Offer>(offers, func(o : T.Offer) : Bool {
            Principal.equal(o.creator, creator);
        }));
    };
    
    /// Get paginated offer feed (sorted by ID descending = newest first)
    public shared query ({ caller }) func getOfferFeed(input : T.GetOfferFeedInput) : async T.GetOfferFeedResponse {
        // Determine starting ID (default to highest offer ID)
        let startId : Nat = switch (input.start_id) {
            case (?id) id;
            case null if (nextOfferId > 0) nextOfferId else 0;
        };
        
        // Collect matching offers
        let resultBuffer = Buffer.Buffer<T.Offer>(input.length);
        var lastMatchedId : ?Nat = null;
        
        // Sort offers by ID descending and filter
        let sortedOffers = Array.sort<T.Offer>(offers, func(a : T.Offer, b : T.Offer) : {#less; #equal; #greater} {
            if (a.id > b.id) #less
            else if (a.id < b.id) #greater
            else #equal
        });
        
        for (offer in sortedOffers.vals()) {
            // Skip offers with ID >= startId (we want offers BEFORE startId)
            if (offer.id >= startId) {
                // continue
            } else {
                // Check if offer matches filter
                if (matchesOfferFilter(offer, input.filter)) {
                    if (resultBuffer.size() < input.length) {
                        resultBuffer.add(offerAsSeenBy(caller, offer));
                        lastMatchedId := ?offer.id;
                    } else {
                        // We have enough, but there are more
                        return {
                            offers = Buffer.toArray(resultBuffer);
                            has_more = true;
                            next_start_id = lastMatchedId;
                        };
                    };
                };
            };
        };
        
        // Return what we have (no more items available)
        {
            offers = Buffer.toArray(resultBuffer);
            has_more = false;
            next_start_id = if (resultBuffer.size() > 0) lastMatchedId else null;
        };
    };
    
    // Helper function to check if an offer matches the filter
    private func matchesOfferFilter(offer : T.Offer, filter : ?T.OfferFeedFilter) : Bool {
        switch (filter) {
            case null true; // No filter = match all
            case (?f) {
                // Check state filter
                switch (f.states) {
                    case (?states) {
                        var stateMatches = false;
                        label stateCheck for (state in states.vals()) {
                            if (offerStateEquals(offer.state, state)) {
                                stateMatches := true;
                                break stateCheck;
                            };
                        };
                        if (not stateMatches) return false;
                    };
                    case null {};
                };
                
                // Check asset type filter
                switch (f.asset_types) {
                    case (?assetTypes) {
                        var hasMatchingAsset = false;
                        label assetCheck for (assetEntry in offer.assets.vals()) {
                            let assetTypeId = getAssetTypeId(assetEntry.asset);
                            for (targetType in assetTypes.vals()) {
                                if (assetTypeId == targetType) {
                                    hasMatchingAsset := true;
                                    break assetCheck;
                                };
                            };
                        };
                        if (not hasMatchingAsset) return false;
                    };
                    case null {};
                };
                
                // Check creator filter
                switch (f.creator) {
                    case (?creator) {
                        if (not Principal.equal(offer.creator, creator)) return false;
                    };
                    case null {};
                };
                
                // Check has_bids filter
                switch (f.has_bids) {
                    case (?hasBids) {
                        let offerHasBids = Array.size(Array.filter<T.Bid>(bids, func(b : T.Bid) : Bool {
                            b.offer_id == offer.id
                        })) > 0;
                        if (hasBids != offerHasBids) return false;
                    };
                    case null {};
                };
                
                // Check public_only filter
                switch (f.public_only) {
                    case (?publicOnly) {
                        if (publicOnly) {
                            // public_only = true: only show offers with no approved_bidders (public offers)
                            if (offer.approved_bidders != null) return false;
                        } else {
                            // public_only = false: only show private offers (has approved_bidders)
                            switch (offer.approved_bidders) {
                                case null { return false }; // Skip public offers
                                case (?approvedList) {
                                    // Must have a viewer to check access
                                    switch (f.viewer) {
                                        case null { return false }; // No viewer = can't show private offers
                                        case (?viewer) {
                                            // Check if viewer is creator
                                            if (Principal.equal(offer.creator, viewer)) {
                                                // Creator can see their private offers in any state
                                            } else {
                                                // Approved bidders can see private offers they're approved for
                                                // But not Draft/PendingEscrow (pre-activation states only creator should see)
                                                if (offer.state == #Draft or offer.state == #PendingEscrow) return false;
                                                let isApproved = Array.find<Principal>(approvedList, func(p) { Principal.equal(p, viewer) });
                                                if (isApproved == null) return false;
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    case null {};
                };
                
                true
            };
        };
    };
    
    // Helper to compare offer states
    private func offerStateEquals(a : T.OfferState, b : T.OfferState) : Bool {
        switch (a, b) {
            case (#Draft, #Draft) true;
            case (#PendingEscrow, #PendingEscrow) true;
            case (#Active, #Active) true;
            case (#Completed(_), #Completed(_)) true;
            case (#Expired, #Expired) true;
            case (#Cancelled, #Cancelled) true;
            case (#Reclaimed, #Reclaimed) true;
            case (#Claimed, #Claimed) true;
            case _ false;
        };
    };
    
    // Helper to get asset type ID from asset
    private func getAssetTypeId(asset : T.Asset) : T.AssetTypeId {
        switch (asset) {
            case (#Canister(_)) T.ASSET_TYPE_CANISTER;
            case (#SNSNeuron(_)) T.ASSET_TYPE_SNS_NEURON;
            case (#ICRC1Token(_)) T.ASSET_TYPE_ICRC1_TOKEN;
            case (#ICRC7NFT(_)) T.ASSET_TYPE_ICRC7_NFT;
            case (#SneedLock(_)) T.ASSET_TYPE_SNEED_LOCK;
        };
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
    
    /// Get bids by bidder (excludes unconfirmed reservations with amount=0)
    public query func getBidsByBidder(bidder : Principal) : async [T.Bid] {
        Array.filter<T.Bid>(bids, func(b : T.Bid) : Bool {
            Principal.equal(b.bidder, bidder) and b.tokens_escrowed;
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
            min_increment_usd_range_min = config.min_increment_usd_range_min;
            min_increment_usd_range_max = config.min_increment_usd_range_max;
            min_increment_usd_target = config.min_increment_usd_target;
            min_increment_fallback_tokens = config.min_increment_fallback_tokens;
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
            min_increment_usd_range_min = config.min_increment_usd_range_min;
            min_increment_usd_range_max = config.min_increment_usd_range_max;
            min_increment_usd_target = config.min_increment_usd_target;
            min_increment_fallback_tokens = config.min_increment_fallback_tokens;
        };
        
        #ok();
    };
    
    /// Get min increment settings
    public query func getMinIncrementSettings() : async {
        usd_range_min : Nat;
        usd_range_max : Nat;
        usd_target : Nat;
        fallback_tokens : Nat;
    } {
        {
            usd_range_min = config.min_increment_usd_range_min;
            usd_range_max = config.min_increment_usd_range_max;
            usd_target = config.min_increment_usd_target;
            fallback_tokens = config.min_increment_fallback_tokens;
        };
    };
    
    /// Set min increment settings (admin only)
    /// USD values are in cents (100 = $1.00)
    /// fallback_tokens is in token base units (e.g., 100000000 = 1 token with 8 decimals)
    public shared ({ caller }) func setMinIncrementSettings(
        usd_range_min : Nat,
        usd_range_max : Nat,
        usd_target : Nat,
        fallback_tokens : Nat
    ) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        // Validate: range_min <= target <= range_max
        if (usd_range_min > usd_target or usd_target > usd_range_max) {
            return #err(#InvalidPrice("Target must be between range min and max"));
        };
        
        config := {
            admins = config.admins;
            min_offer_duration_ns = config.min_offer_duration_ns;
            max_assets_per_offer = config.max_assets_per_offer;
            min_increment_usd_range_min = usd_range_min;
            min_increment_usd_range_max = usd_range_max;
            min_increment_usd_target = usd_target;
            min_increment_fallback_tokens = fallback_tokens;
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
    // OFFER CREATION FEE MANAGEMENT (Admin)
    // ============================================
    
    /// Get current offer creation fee in ICP e8s
    public query func getOfferCreationFee() : async Nat64 {
        offerCreationFeeE8s;
    };
    
    /// Get premium offer creation fee in ICP e8s
    public query func getPremiumOfferCreationFee() : async Nat64 {
        premiumOfferCreationFeeE8s;
    };
    
    /// Get premium auction cut in basis points
    public query func getPremiumAuctionCutBps() : async Nat {
        premiumAuctionCutBps;
    };
    
    /// Get all fee configuration in a single query
    /// Returns: (regularCreationFeeE8s, premiumCreationFeeE8s, regularAuctionCutBps, premiumAuctionCutBps)
    public query func getFeeConfig() : async {
        regularCreationFeeE8s : Nat64;
        premiumCreationFeeE8s : Nat64;
        regularAuctionCutBps : Nat;
        premiumAuctionCutBps : Nat;
    } {
        {
            regularCreationFeeE8s = offerCreationFeeE8s;
            premiumCreationFeeE8s = premiumOfferCreationFeeE8s;
            regularAuctionCutBps = marketplaceFeeRateBps;
            premiumAuctionCutBps = premiumAuctionCutBps;
        };
    };
    
    /// Get Sneed Premium canister ID
    public query func getSneedPremiumCanisterId() : async ?Principal {
        sneedPremiumCanisterId;
    };
    
    /// Set offer creation fee in ICP e8s (admin only)
    public shared ({ caller }) func setOfferCreationFee(feeE8s : Nat64) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        offerCreationFeeE8s := feeE8s;
        #ok();
    };
    
    /// Set premium offer creation fee in ICP e8s (admin only)
    public shared ({ caller }) func setPremiumOfferCreationFee(feeE8s : Nat64) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        premiumOfferCreationFeeE8s := feeE8s;
        #ok();
    };
    
    /// Set premium auction cut in basis points (admin only)
    /// 0 means use the regular marketplace fee rate
    public shared ({ caller }) func setPremiumAuctionCutBps(rateBps : Nat) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        // Sanity check: max 50% (5000 bps)
        if (rateBps > 5000) {
            return #err(#InvalidAsset("Fee rate cannot exceed 50% (5000 bps)"));
        };
        premiumAuctionCutBps := rateBps;
        #ok();
    };
    
    /// Set Sneed Premium canister ID (admin only)
    public shared ({ caller }) func setSneedPremiumCanisterId(canisterId : ?Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        sneedPremiumCanisterId := canisterId;
        #ok();
    };
    
    // ============================================
    // OFFER CREATION PAYMENT (User)
    // ============================================
    
    /// Get the payment subaccount for a user to send offer creation fees
    public query func getOfferCreationPaymentSubaccount(user : Principal) : async Blob {
        Utils.userPaymentSubaccount(user);
    };
    
    /// Get user's payment balance for offer creation
    public func getUserOfferCreationBalance(user : Principal) : async Nat {
        let subaccount = Utils.userPaymentSubaccount(user);
        let icpLedger : T.ICRC1Actor = actor(ICP_LEDGER_ID);
        await icpLedger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = ?subaccount;
        });
    };
    
    /// Withdraw user's offer creation payment balance
    public shared ({ caller }) func withdrawOfferCreationPayment() : async T.Result<Nat> {
        let subaccount = Utils.userPaymentSubaccount(caller);
        let fee = Nat64.toNat(ICP_FEE);
        
        let icpLedger : T.ICRC1Actor = actor(ICP_LEDGER_ID);
        let balance = await icpLedger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = ?subaccount;
        });
        
        if (balance <= fee) {
            return #err(#InsufficientFunds({ required = fee + 1; available = balance }));
        };
        
        let withdrawAmount = balance - fee;
        
        let result = await icpLedger.icrc1_transfer({
            to = { owner = caller; subaccount = null };
            fee = ?fee;
            memo = null;
            from_subaccount = ?subaccount;
            created_at_time = null;
            amount = withdrawAmount;
        });
        
        switch (result) {
            case (#Ok(_)) { #ok(withdrawAmount) };
            case (#Err(e)) { #err(#TransferFailed(debug_show(e))) };
        };
    };
    
    /// Get the effective offer creation fee for a user (checks premium status)
    public func getEffectiveOfferCreationFee(user : Principal) : async Nat64 {
        // If no fee is set, return 0
        if (offerCreationFeeE8s == 0) {
            return 0;
        };
        
        // Check if user is premium
        switch (sneedPremiumCanisterId) {
            case (?canisterId) {
                let isPremiumMember = await* PremiumClient.isPremium(premiumCache, canisterId, user);
                if (isPremiumMember) {
                    return premiumOfferCreationFeeE8s;
                };
            };
            case null {};
        };
        
        offerCreationFeeE8s;
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
    
    public shared ({ caller }) func setSneedLockCanisterId(canisterId : Principal) : async T.Result<()> {
        if (not isAdmin(caller)) { return #err(#NotAuthorized) };
        sneedLockCanisterId := canisterId;
        #ok();
    };
    public query func getSneedLockCanisterId() : async Principal { sneedLockCanisterId };
    
    /// Get the neuron manager factory canister ID
    public query func getNeuronManagerFactoryCanisterId() : async ?Principal {
        neuronManagerFactoryCanisterId;
    };
    
    /// Set the Sneed SMS canister ID for notifications (admin only)
    public shared ({ caller }) func setSneedSmsCanisterId(canisterId : ?Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        sneedSmsCanisterId := canisterId;
        #ok();
    };
    
    /// Get the Sneed SMS canister ID
    public query func getSneedSmsCanisterId() : async ?Principal {
        sneedSmsCanisterId;
    };
    
    // ============================================
    // USER NOTIFICATION SETTINGS
    // ============================================
    
    /// Get notification settings for the caller
    public query ({ caller }) func getMyNotificationSettings() : async T.NotificationSettings {
        getUserNotificationSettings(caller);
    };
    
    /// Update notification settings for the caller
    public shared ({ caller }) func setMyNotificationSettings(settings : T.NotificationSettings) : async T.Result<()> {
        // Update or add settings for this user
        var found = false;
        userNotificationSettings := Array.map<(Principal, T.NotificationSettings), (Principal, T.NotificationSettings)>(
            userNotificationSettings,
            func ((p, s) : (Principal, T.NotificationSettings)) : (Principal, T.NotificationSettings) {
                if (Principal.equal(p, caller)) {
                    found := true;
                    (p, settings)
                } else {
                    (p, s)
                }
            }
        );
        
        if (not found) {
            userNotificationSettings := Array.append(userNotificationSettings, [(caller, settings)]);
        };
        
        #ok();
    };
    
    // ============================================
    // EXPIRATION TIMER ADMIN FUNCTIONS
    // ============================================
    
    /// Start the expiration auto-processing timer (admin only)
    public shared ({ caller }) func startExpirationTimer() : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        startExpirationTimerInternal<system>();
        #ok();
    };
    
    /// Stop the expiration auto-processing timer (admin only)
    public shared ({ caller }) func stopExpirationTimer() : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        stopExpirationTimerInternal();
        #ok();
    };
    
    /// Set the expiration check interval in seconds (admin only)
    public shared ({ caller }) func setExpirationCheckInterval(intervalSeconds : Nat) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        if (intervalSeconds < 60) {
            return #err(#InvalidInput("Interval must be at least 60 seconds"));
        };
        expirationCheckIntervalSeconds := intervalSeconds;
        
        // If timer is running, restart it with new interval
        switch (expirationTimerId) {
            case (?_id) {
                startExpirationTimerInternal<system>();
            };
            case null {};
        };
        #ok();
    };
    
    /// Get the expiration check interval in seconds
    public query func getExpirationCheckInterval() : async Nat {
        expirationCheckIntervalSeconds;
    };
    
    /// Check if the expiration timer is currently running
    public query func isExpirationTimerRunning() : async Bool {
        switch (expirationTimerId) {
            case (?_id) { true };
            case null { false };
        };
    };
    
    /// Check if the expiration worker is currently running
    public query func isExpirationWorkerRunning() : async Bool {
        expirationWorkerRunning;
    };
    
    /// Manually trigger expiration check (admin only)
    /// Useful for testing or when you want to process expired offers immediately
    public shared ({ caller }) func triggerExpirationCheck() : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        if (expirationWorkerRunning) {
            return #err(#InvalidState("Worker is already running"));
        };
        
        // Check if there are any expired offers to process
        switch (findFirstExpiredOffer()) {
            case null {
                #ok(); // No expired offers, nothing to do
            };
            case (?_offer) {
                expirationWorkerRunning := true;
                scheduleExpirationWorker<system>();
                #ok();
            };
        };
    };
    
    /// Admin rescue for an NFT that a non-compliant collection put in Sneedex's default account
    /// instead of the offer's escrow subaccount (the escrow check refuses such a deposit, so the
    /// token belongs to nobody's offer). Returns it to the account given. Refused while any open
    /// offer lists the token, so a legitimately escrowed token can never be moved this way.
    public shared ({ caller }) func adminReturnMisplacedNft(collection : Principal, tokenId : Nat, to : T.Account) : async T.Result<Text> {
        if (not isAdmin(caller)) { return #err(#NotAuthorized) };
        for (o in offers.vals()) {
            if (o.state == #PendingEscrow or o.state == #Active) {
                for (entry in o.assets.vals()) {
                    switch (entry.asset) {
                        case (#ICRC7NFT(nft)) {
                            if (entry.escrowed and Principal.equal(nft.collection_canister_id, collection)
                                and Array.find<Nat>(nft.token_ids, func(id) { id == tokenId }) != null) {
                                return #err(#InvalidState("Token is escrowed for offer " # Nat.toText(o.id)));
                            };
                        };
                        case (_) {};
                    };
                };
            };
        };
        // the token must really sit in the default account, not in some escrow subaccount
        switch (await* AssetHandlers.verifyNftEscrow(collection, self(), Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0 })), [tokenId])) {
            case (#err(_)) { return #err(#InvalidAsset("Token " # Nat.toText(tokenId) # " is not in Sneedex's default account")) };
            case (#ok(_)) {};
        };
        switch (await* AssetHandlers.transferNftsFromDefault(collection, to, [tokenId])) {
            case (#err(e)) { #err(e) };
            case (#ok(_)) { #ok("Token " # Nat.toText(tokenId) # " returned") };
        };
    };

    /// Admin function to manually reclaim stuck tokens from an offer
    /// This is useful when autoReclaimAssets failed to transfer tokens
    /// but already updated the state to Reclaimed
    public shared ({ caller }) func adminReclaimStuckTokens(offerId : T.OfferId) : async T.Result<Text> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        switch (getOffer(offerId)) {
            case null { return #err(#OfferNotFound) };
            case (?offer) {
                var message = "Results for offer #" # Nat.toText(offerId) # ":\n";
                
                for (assetIndex in offer.assets.keys()) {
                    let entry = offer.assets[assetIndex];
                    if (entry.escrowed) {
                        switch (entry.asset) {
                            case (#ICRC1Token(asset)) {
                                let subaccount = Utils.offerEscrowSubaccount(offer.creator, offerId);
                                let result = await* AssetHandlers.reclaimAllTokens(
                                    asset.ledger_canister_id,
                                    self(),
                                    subaccount,
                                    { owner = offer.creator; subaccount = null }
                                );
                                switch (result) {
                                    case (#ok(blockIndex)) {
                                        message := message # "Token transfer succeeded, block: " # Nat.toText(blockIndex) # "\n";
                                    };
                                    case (#err(e)) {
                                        let errMsg = switch (e) {
                                            case (#TransferFailed(msg)) { msg };
                                            case _ { "Unknown error" };
                                        };
                                        message := message # "Token transfer failed: " # errMsg # "\n";
                                    };
                                };
                            };
                            case (#Canister(asset)) {
                                // Restore botkeys BEFORE releasing controllers
                                let ckind = switch (asset.canister_kind) { case (?k) { k }; case null { 0 } };
                                if (ckind == T.CANISTER_KIND_ICP_NEURON_MANAGER) {
                                    await restoreNeuronManagerState(asset.canister_id);
                                    message := message # "Neuron manager state restored (hotkeys + botkeys)\n";
                                } else if (ckind == T.CANISTER_KIND_TRADING_BOT) {
                                    await restoreTradingBotState(asset.canister_id);
                                    message := message # "Trading bot state restored (botkeys)\n";
                                };
                                
                                switch (asset.controllers_snapshot) {
                                    case (?snapshot) {
                                        let result = await* AssetHandlers.releaseCanister(
                                            asset.canister_id,
                                            snapshot
                                        );
                                        switch (result) {
                                            case (#ok(_)) { message := message # "Canister released successfully\n"; };
                                            case (#err(e)) {
                                                let errMsg = switch (e) {
                                                    case (#TransferFailed(msg)) { msg };
                                                    case _ { "Unknown error" };
                                                };
                                                message := message # "Canister release failed: " # errMsg # "\n";
                                            };
                                        };
                                    };
                                    case null {
                                        let result = await* AssetHandlers.transferCanister(
                                            asset.canister_id,
                                            [offer.creator]
                                        );
                                        switch (result) {
                                            case (#ok(_)) { message := message # "Canister transferred successfully\n"; };
                                            case (#err(e)) {
                                                let errMsg = switch (e) {
                                                    case (#TransferFailed(msg)) { msg };
                                                    case _ { "Unknown error" };
                                                };
                                                message := message # "Canister transfer failed: " # errMsg # "\n";
                                            };
                                        };
                                    };
                                };
                            };
                            case (#SneedLock(asset)) {
                                switch (await* AssetHandlers.transferSneedLock(sneedLockCanisterId, asset, offer.creator)) {
                                    case (#ok(_)) { message := message # "Lock returned to the seller\n"; };
                                    case (#err(e)) {
                                        let errMsg = switch (e) { case (#TransferFailed(msg)) { msg }; case _ { "Unknown error" } };
                                        message := message # "Lock transfer failed: " # errMsg # "\n";
                                    };
                                };
                            };
                            case (#SNSNeuron(asset)) {
                                switch (asset.hotkeys_snapshot) {
                                    case (?snapshot) {
                                        let result = await* AssetHandlers.releaseNeuron(
                                            asset.governance_canister_id,
                                            asset.neuron_id,
                                            self(),
                                            neuronRestorePermissions(offer, assetIndex, snapshot)
                                        );
                                        switch (result) {
                                            case (#ok(_)) { message := message # "Neuron released successfully\n"; };
                                            case (#err(e)) {
                                                let errMsg = switch (e) {
                                                    case (#GovernanceError(msg)) { msg };
                                                    case _ { "Unknown error" };
                                                };
                                                message := message # "Neuron release failed: " # errMsg # "\n";
                                            };
                                        };
                                    };
                                    case null {
                                        let result = await* AssetHandlers.transferNeuron(
                                            asset.governance_canister_id,
                                            asset.neuron_id,
                                            self(),
                                            [offer.creator]
                                        );
                                        switch (result) {
                                            case (#ok(_)) { message := message # "Neuron transferred successfully\n"; };
                                            case (#err(e)) {
                                                let errMsg = switch (e) {
                                                    case (#GovernanceError(msg)) { msg };
                                                    case _ { "Unknown error" };
                                                };
                                                message := message # "Neuron transfer failed: " # errMsg # "\n";
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
                
                #ok(message);
            };
        };
    };
    
    // ============================================
    // PAYMENT LOG QUERIES (Admin only)
    // ============================================
    
    /// Get paginated creation fee payment log (admin only)
    /// Returns payments in reverse chronological order (newest first)
    public shared query ({ caller }) func getCreationFeePaymentLog(offset : Nat, limit : Nat) : async {
        payments : [T.CreationFeePaymentLogEntry];
        total_count : Nat;
        has_more : Bool;
    } {
        assert(isAdmin(caller));
        
        let total = creationFeePaymentLog.size();
        
        if (offset >= total) {
            return {
                payments = [];
                total_count = total;
                has_more = false;
            };
        };
        
        let effectiveLimit = if (limit > 1000) { 1000 } else { limit };
        let startIdx = if (total > offset) { total - offset } else { 0 };
        let endIdx = if (startIdx > effectiveLimit) { startIdx - effectiveLimit } else { 0 };
        
        var result : [T.CreationFeePaymentLogEntry] = [];
        var idx = startIdx;
        while (idx > endIdx) {
            idx -= 1;
            result := Array.append(result, [creationFeePaymentLog[idx]]);
        };
        
        {
            payments = result;
            total_count = total;
            has_more = endIdx > 0;
        };
    };
    
    /// Get paginated cut payment log (admin only)
    /// Returns payments in reverse chronological order (newest first)
    public shared query ({ caller }) func getCutPaymentLog(offset : Nat, limit : Nat) : async {
        payments : [T.CutPaymentLogEntry];
        total_count : Nat;
        has_more : Bool;
    } {
        assert(isAdmin(caller));
        
        let total = cutPaymentLog.size();
        
        if (offset >= total) {
            return {
                payments = [];
                total_count = total;
                has_more = false;
            };
        };
        
        let effectiveLimit = if (limit > 1000) { 1000 } else { limit };
        let startIdx = if (total > offset) { total - offset } else { 0 };
        let endIdx = if (startIdx > effectiveLimit) { startIdx - effectiveLimit } else { 0 };
        
        var result : [T.CutPaymentLogEntry] = [];
        var idx = startIdx;
        while (idx > endIdx) {
            idx -= 1;
            result := Array.append(result, [cutPaymentLog[idx]]);
        };
        
        {
            payments = result;
            total_count = total;
            has_more = endIdx > 0;
        };
    };
    
    /// Get payment statistics: public, for the revenue page (the logs themselves stay admin only)
    public query func getPaymentStats() : async {
        total_creation_fees_collected_e8s : Nat;
        total_creation_fee_payments : Nat;
        total_cut_payments : Nat;
        cuts_by_ledger : [(Principal, Nat)];
    } {
        {
            total_creation_fees_collected_e8s = totalCreationFeesCollectedE8s;
            total_creation_fee_payments = creationFeePaymentLog.size();
            total_cut_payments = cutPaymentLog.size();
            cuts_by_ledger = totalCutsCollectedByLedger;
        };
    };
    
    /// Get creation fee payment log count (admin only)
    public shared query ({ caller }) func getCreationFeePaymentLogCount() : async Nat {
        assert(isAdmin(caller));
        creationFeePaymentLog.size();
    };
    
    /// Get cut payment log count (admin only)
    public shared query ({ caller }) func getCutPaymentLogCount() : async Nat {
        assert(isAdmin(caller));
        cutPaymentLog.size();
    };
    
    // ============================================
    // NEURON INFO CACHE (for ICP Staking Bot proxy)
    // ============================================
    // Sneedex is a controller of escrowed staking bots, so it can call their
    // ViewNeuron-gated methods. Users who can't call those methods directly
    // can use these Sneedex proxy methods instead.
    
    /// Get the neuron info cache staleness threshold in seconds
    public query func getNeuronInfoCacheStaleness() : async Nat {
        neuronInfoCacheStalenessSeconds;
    };
    
    /// Set the neuron info cache staleness threshold in seconds (admin only)
    public shared ({ caller }) func setNeuronInfoCacheStaleness(seconds : Nat) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        neuronInfoCacheStalenessSeconds := seconds;
        #ok();
    };
    
    // Internal: look up cache entry for a bot canister
    func getCacheEntry(botCanisterId : Principal) : ?T.NeuronManagerCacheEntry {
        for ((p, entry) in neuronInfoCache.vals()) {
            if (Principal.equal(p, botCanisterId)) {
                return ?entry;
            };
        };
        null;
    };
    
    // Internal: check if a cache entry is still fresh
    func isCacheFresh(entry : T.NeuronManagerCacheEntry) : Bool {
        let now = Time.now();
        let ageNs = now - entry.fetched_at;
        let ageSeconds = Int.abs(ageNs) / 1_000_000_000;
        ageSeconds < neuronInfoCacheStalenessSeconds;
    };
    
    // Internal: store/update a cache entry
    func putCacheEntry(botCanisterId : Principal, entry : T.NeuronManagerCacheEntry) {
        let updated = Buffer.Buffer<(Principal, T.NeuronManagerCacheEntry)>(neuronInfoCache.size() + 1);
        var found = false;
        for ((p, e) in neuronInfoCache.vals()) {
            if (Principal.equal(p, botCanisterId)) {
                found := true;
                updated.add((p, entry));
            } else {
                updated.add((p, e));
            };
        };
        if (not found) {
            updated.add((botCanisterId, entry));
        };
        neuronInfoCache := Buffer.toArray(updated);
    };
    
    /// Admin: clear all neuron info cache entries
    public shared ({ caller }) func clearNeuronInfoCache() : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        neuronInfoCache := [];
        #ok();
    };
    
    /// Admin: clear a specific neuron info cache entry
    public shared ({ caller }) func clearNeuronInfoCacheFor(botCanisterId : Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        neuronInfoCache := Array.filter<(Principal, T.NeuronManagerCacheEntry)>(
            neuronInfoCache,
            func((p, _)) { not Principal.equal(p, botCanisterId) }
        );
        #ok();
    };

    // ============================================
    // TIMERS AFTER AN UPGRADE
    // ============================================
    // Timers do not survive an upgrade, but the stored timer id and worker flag do. The actor
    // body runs on every install and upgrade, so put the timers back here (as sneed_pad does):
    // a periodic expiration timer that was on is started again, and a worker that was scheduled
    // when the upgrade came is scheduled again, so the flag never claims a worker that is gone.
    // On a fresh install both are off and nothing happens.
    if (expirationTimerId != null) {
        expirationTimerId := null; // the old id means nothing to the new timer runtime: do not cancel it
        startExpirationTimerInternal<system>();
    };
    if (expirationWorkerRunning) {
        scheduleExpirationWorker<system>();
    };

    // Limits of the ingress guard below (the notes and NFT limits are createOffer's and addAsset's own)
    transient let MAX_OFFER_NOTE : Nat = 4_000;
    transient let MAX_NFTS_PER_ASSET : Nat = 50;
    transient let MAX_APPROVED_BIDDERS : Nat = 200;
    transient let MAX_ASSET_LIST : Nat = 100; // token ids, or controllers / hotkeys in a snapshot
    transient let MAX_PRINCIPAL_BYTES : Nat = 32;

    // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
    // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
    public query func get_api_doc() : async Text { ApiDoc.text };

    // Ingress guard (src/IngressGuard.mo): queries are never accepted as update calls, which
    // would go through consensus at our cost, and arguments are capped in size.
    system func inspect({ caller : Principal; arg : Blob; msg : {
        #get_api_doc : Any;
        #acceptBid : Any;
        #activateOffer : Any;
        #addAdmin : Any;
        #addAsset : () -> T.AddAssetRequest;
        #addAssetType : Any;
        #adminReclaimStuckTokens : Any;
        #adminReturnMisplacedNft : Any;
        #cancelOffer : Any;
        #claimAssets : Any;
        #claimWinningBid : Any;
        #clearNeuronInfoCache : Any;
        #clearNeuronInfoCacheFor : Any;
        #confirmBid : Any;
        #createOffer : () -> T.CreateOfferRequest;
        #deactivateAssetType : Any;
        #debugGetAllOffers : Any;
        #escrowCanister : Any;
        #escrowICRC1Tokens : Any;
        #escrowICRC7NFTs : Any;
        #escrowICRC7NFTsByApproval : Any;
        #escrowSNSNeuron : Any;
        #escrowSneedLock : Any;
        #finalizeAssets : Any;
        #getActiveOffers : Any;
        #getAssetTypes : Any;
        #getBackendCanisterId : Any;
        #getBidEscrowBalance : Any;
        #getBidEscrowSubaccount : Any;
        #getBidsByBidder : Any;
        #getCachedNeuronManagerInfoQuery : Any;
        #getCanisterInfo : Any;
        #getCanisterKinds : Any;
        #getConfig : Any;
        #getCreationFeePaymentLog : Any;
        #getCreationFeePaymentLogCount : Any;
        #getCutPaymentLog : Any;
        #getCutPaymentLogCount : Any;
        #getEffectiveOfferCreationFee : Any;
        #getExpirationCheckInterval : Any;
        #getFeeConfig : Any;
        #getFeeRecipient : Any;
        #getLedgerFeeRecipients : Any;
        #getMarketStats : Any;
        #getMarketplaceFeeRate : Any;
        #getMinIncrementSettings : Any;
        #getMyNotificationSettings : Any;
        #getNeuronInfoCacheStaleness : Any;
        #getNeuronManagerFactoryCanisterId : Any;
        #getNeuronManagerInfo : Any;
        #getNextBidId : Any;
        #getNextOfferId : Any;
        #getOfferCreationFee : Any;
        #getOfferCreationPaymentSubaccount : Any;
        #getOfferEscrowSubaccount : Any;
        #getOfferFeed : Any;
        #getOfferView : Any;
        #getOffersByCreator : Any;
        #getPaymentStats : Any;
        #getPremiumAuctionCutBps : Any;
        #getPremiumOfferCreationFee : Any;
        #getPrivateOffersFor : Any;
        #getPublicOffers : Any;
        #getSneedLockCanisterId : Any;
        #getSneedPremiumCanisterId : Any;
        #getSneedSmsCanisterId : Any;
        #getUserOfferCreationBalance : Any;
        #isExpirationTimerRunning : Any;
        #isExpirationWorkerRunning : Any;
        #processExpiration : Any;
        #queryBid : Any;
        #queryOffer : Any;
        #reactivateAssetType : Any;
        #reclaimAssets : Any;
        #refundBid : Any;
        #removeAdmin : Any;
        #removeLedgerFeeRecipient : Any;
        #reserveBid : Any;
        #setBackendCanisterId : Any;
        #setExpirationCheckInterval : Any;
        #setFeeRecipient : Any;
        #setLedgerFeeRecipient : Any;
        #setMarketplaceFeeRate : Any;
        #setMinIncrementSettings : Any;
        #setMyNotificationSettings : Any;
        #setNeuronInfoCacheStaleness : Any;
        #setNeuronManagerFactoryCanisterId : Any;
        #setOfferCreationFee : Any;
        #setPremiumAuctionCutBps : Any;
        #setPremiumOfferCreationFee : Any;
        #setSneedLockCanisterId : Any;
        #setSneedPremiumCanisterId : Any;
        #setSneedSmsCanisterId : Any;
        #startExpirationTimer : Any;
        #stopExpirationTimer : Any;
        #triggerExpirationCheck : Any;
        #updateConfig : Any;
        #verifyICPNeuronManager : Any;
        #verifyTradingBot : Any;
        #withdrawBidEscrow : Any;
        #withdrawOfferCreationPayment : Any;
    } }) : Bool {
        switch (msg) {
            case (
                #get_api_doc _
                or #debugGetAllOffers _
                or #getActiveOffers _
                or #getAssetTypes _
                or #getBackendCanisterId _
                or #getBidEscrowSubaccount _
                or #getBidsByBidder _
                or #getCachedNeuronManagerInfoQuery _
                or #getCanisterKinds _
                or #getConfig _
                or #getCreationFeePaymentLog _
                or #getCreationFeePaymentLogCount _
                or #getCutPaymentLog _
                or #getCutPaymentLogCount _
                or #getExpirationCheckInterval _
                or #getFeeConfig _
                or #getFeeRecipient _
                or #getLedgerFeeRecipients _
                or #getMarketStats _
                or #getMarketplaceFeeRate _
                or #getMinIncrementSettings _
                or #getMyNotificationSettings _
                or #getNeuronInfoCacheStaleness _
                or #getNeuronManagerFactoryCanisterId _
                or #getNextBidId _
                or #getNextOfferId _
                or #getOfferCreationFee _
                or #getOfferCreationPaymentSubaccount _
                or #getOfferEscrowSubaccount _
                or #getOfferFeed _
                or #getOfferView _
                or #getOffersByCreator _
                or #getPaymentStats _
                or #getPremiumAuctionCutBps _
                or #getPremiumOfferCreationFee _
                or #getPrivateOffersFor _
                or #getPublicOffers _
                or #getSneedLockCanisterId _
                or #getSneedPremiumCanisterId _
                or #getSneedSmsCanisterId _
                or #isExpirationTimerRunning _
                or #isExpirationWorkerRunning _
                or #queryBid _
                or #queryOffer _
            ) false;
            case (#createOffer f) {
                let r = f();
                let bidders = switch (r.approved_bidders) { case null 0; case (?b) b.size() };
                bidders <= MAX_APPROVED_BIDDERS
                and arg.size() <= IngressGuard.textArg(2 * MAX_OFFER_NOTE) + MAX_APPROVED_BIDDERS * MAX_PRINCIPAL_BYTES
                and IngressGuard.optText(r.public_note, MAX_OFFER_NOTE) and IngressGuard.optText(r.note_to_buyer, MAX_OFFER_NOTE)
            };
            case (#addAsset f) {
                arg.size() <= IngressGuard.textArg(T.MAX_CANISTER_TITLE_LENGTH + T.MAX_CANISTER_DESCRIPTION_LENGTH) + MAX_ASSET_LIST * MAX_PRINCIPAL_BYTES
                and (switch (f().asset) {
                    case (#Canister c) IngressGuard.optText(c.title, T.MAX_CANISTER_TITLE_LENGTH) and IngressGuard.optText(c.description, T.MAX_CANISTER_DESCRIPTION_LENGTH);
                    case (#ICRC7NFT n) n.token_ids.size() <= MAX_NFTS_PER_ASSET;
                    case _ true;
                })
            };
            // admin tools with free-form content
            case (#addAssetType _ or #updateConfig _) isAdmin(caller);
            case _ arg.size() <= IngressGuard.SMALL_ARG;
        };
    };

};
