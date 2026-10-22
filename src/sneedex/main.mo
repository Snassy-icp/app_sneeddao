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
import Nat32 "mo:base/Nat32";
import Error "mo:base/Error";

import Map "mo:map/Map";
import { phash; nhash; thash } "mo:map/Map";

import T "Types";
import Utils "Utils";
import AssetHandlers "AssetHandlers";
import PremiumClient "../PremiumClient";
import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";
import Icrc3Log "../icrc3/Log";
import Icrc3Sns "../icrc3/SnsRegister";
import T3 "../icrc3/Types";
import Ext "../sneed_names/Ext";
import SpecialPrices "../SpecialPrices";

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
    var nextAssetTypeId : T.AssetTypeId = 5; // 0..5 are reserved for built-in types (ensureBuiltInAssetTypes moves this past 5)
    
    // Asset types registry
    var assetTypes : [T.AssetType] = [
        { id = T.ASSET_TYPE_CANISTER; name = "Canister"; description = "Internet Computer canister"; active = true },
        { id = T.ASSET_TYPE_SNS_NEURON; name = "SNS Neuron"; description = "SNS governance neuron"; active = true },
        { id = T.ASSET_TYPE_ICRC1_TOKEN; name = "ICRC1 Token"; description = "ICRC1 fungible token"; active = true },
        { id = T.ASSET_TYPE_ICRC7_NFT; name = "ICRC-7 NFT"; description = "Non-fungible tokens of an ICRC-7 collection"; active = true },
        { id = T.ASSET_TYPE_SNEED_LOCK; name = "Sneed Lock"; description = "A Sneed Lock token lock or locked LP position"; active = true },
        { id = T.ASSET_TYPE_EXT_NFT; name = "EXT NFT"; description = "Non-fungible tokens of an EXT collection (Toniq / Entrepot standard)"; active = true },
    ];
    /// Deployments from before the NFT type keep their registry across upgrades; add the entry once.
    private func ensureBuiltInAssetTypes() {
        if (Array.find<T.AssetType>(assetTypes, func(t) { t.id == T.ASSET_TYPE_ICRC7_NFT }) == null) {
            assetTypes := Array.append(assetTypes, [{ id = T.ASSET_TYPE_ICRC7_NFT; name = "ICRC-7 NFT"; description = "Non-fungible tokens of an ICRC-7 collection"; active = true }]);
        };
        if (Array.find<T.AssetType>(assetTypes, func(t) { t.id == T.ASSET_TYPE_SNEED_LOCK }) == null) {
            assetTypes := Array.append(assetTypes, [{ id = T.ASSET_TYPE_SNEED_LOCK; name = "Sneed Lock"; description = "A Sneed Lock token lock or locked LP position"; active = true }]);
        };
        if (Array.find<T.AssetType>(assetTypes, func(t) { t.id == T.ASSET_TYPE_EXT_NFT }) == null) {
            assetTypes := Array.append(assetTypes, [{ id = T.ASSET_TYPE_EXT_NFT; name = "EXT NFT"; description = "Non-fungible tokens of an EXT collection (Toniq / Entrepot standard)"; active = true }]);
        };
        if (nextAssetTypeId <= T.ASSET_TYPE_EXT_NFT) { nextAssetTypeId := T.ASSET_TYPE_EXT_NFT + 1 };
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

    // Special prices (spec/special_prices.md): an admin price for this canister's admins (people
    // only) and partner prices per principal, next to the regular and premium prices. The lowest
    // applicable one is charged; all unset = the regular and premium prices as before.
    var specialAdminPrices : T.SpecialPriceOverrides = { offer_creation_fee_e8s = null; auction_cut_bps = null };
    var specialPartnerPrices : Map.Map<Principal, SpecialPrices.Partner<T.SpecialPriceOverrides>> = Map.new();
    // The tiers each offer's creator got (creation fee and the cut locked in at creation)
    var offerPriceTiers : Map.Map<T.OfferId, T.OfferPriceTiers> = Map.new();
    
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

    // Support log: a bounded ring of the errors the background work used to swallow (timers,
    // stake caching, auto settlement) and of admin interventions (adminReclaimStuckTokens*).
    // Public (getSupportLog / getSupportLogFor): principals, ids and error text only, as on-chain
    // records already are. The oldest entries drop out past SUPPORT_LOG_MAX.
    var supportLog : [T.SupportLogEntry] = [];
    var nextSupportLogId : Nat = 0;

    // In-flight guard for asset settlement, per offer (transient, like bidEscrowLocks): the
    // auto-delivery timers and the manual claim/reclaim must not hand over the same offer at once.
    transient var settlementLocks = Map.new<T.OfferId, ()>();

    // ICRC-3 activity log: a hash-chained, certified block per market action, with archive
    // canisters for old blocks. Library src/icrc3; design and block catalogue: spec/sneedex_icrc3.md.
    var icrc3 : Icrc3Log.State = Icrc3Log.init();
    transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
    // SNS registration of archives (skipped until a hotkeyed neuron is configured)
    var icrc3_sns : Icrc3Sns.State = Icrc3Sns.init();
    transient let icrc3_sns_rt : Icrc3Sns.Runtime = Icrc3Sns.runtime();
    transient let SNEED_SNS_ROOT : Principal = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");
    transient let SNEED_GOVERNANCE : Principal = Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai");
    transient var icrc3_next_cid : Nat = 0; // groups the canister-log lines of one spill run

    /// Append one block for an action that has just been committed to local state.
    func icrc3_add(btype : Text, tx : [(Text, T3.Value)]) {
        ignore Icrc3Log.append(icrc3, btype, Int.abs(Time.now()), tx);
    };
    func pv(p : Principal) : T3.Value { Icrc3Log.principal(p) };
    func acctV(a : T.Account) : T3.Value { Icrc3Log.account(a.owner, a.subaccount) };
    func flagV(b : Bool) : T3.Value { #Nat(if (b) { 1 } else { 0 }) };
    /// `caller` for an action someone called, `via = "timer"` for one a Sneedex timer did.
    func whoV(caller : ?Principal) : (Text, T3.Value) {
        switch (caller) { case (?c) { ("caller", pv(c)) }; case null { ("via", #Text("timer")) } };
    };
    func optNatF(key : Text, v : ?Nat) : [(Text, T3.Value)] {
        switch (v) { case (?n) { [(key, #Nat(n))] }; case null { [] } };
    };
    func optPrincipalV(v : ?Principal) : T3.Value {
        switch (v) { case (?p) { pv(p) }; case null { #Text("none") } };
    };
    /// The asset as listed (with the escrow snapshots once taken); notes, titles and descriptions are left out.
    func assetV(asset : T.Asset) : T3.Value {
        let principals = func(ps : [Principal]) : T3.Value { #Array(Array.map<Principal, T3.Value>(ps, pv)) };
        switch (asset) {
            case (#Canister(c)) {
                let f = Buffer.Buffer<(Text, T3.Value)>(4);
                f.add(("type", #Text("canister")));
                f.add(("canister_id", pv(c.canister_id)));
                switch (c.canister_kind) { case (?k) { f.add(("canister_kind", #Nat(k))) }; case null {} };
                switch (c.controllers_snapshot) { case (?s) { f.add(("controllers_snapshot", principals(s))) }; case null {} };
                #Map(Buffer.toArray(f));
            };
            case (#SNSNeuron(n)) {
                let base : [(Text, T3.Value)] = [("type", #Text("sns_neuron")), ("governance", pv(n.governance_canister_id)), ("neuron_id", #Blob(n.neuron_id.id))];
                #Map(switch (n.hotkeys_snapshot) { case (?s) { Array.append(base, [("hotkeys_snapshot", principals(s))]) }; case null { base } });
            };
            case (#ICRC1Token(t)) {
                #Map([("type", #Text("icrc1")), ("ledger", pv(t.ledger_canister_id)), ("amount", #Nat(t.amount))]);
            };
            case (#ICRC7NFT(n)) {
                #Map([("type", #Text("icrc7")), ("collection", pv(n.collection_canister_id)), ("token_ids", #Array(Array.map<Nat, T3.Value>(n.token_ids, func(i) { #Nat(i) })))]);
            };
            case (#EXTNFT(n)) {
                #Map([
                    ("type", #Text("ext")), ("collection", pv(n.collection_canister_id)),
                    ("token_indices", #Array(Array.map<Nat32, T3.Value>(n.token_indices, func(i) { #Nat(Nat32.toNat(i)) }))),
                    ("token_identifiers", #Array(Array.map<Nat32, T3.Value>(n.token_indices, func(i) { #Text(Ext.tokenIdentifier(n.collection_canister_id, i)) }))),
                ]);
            };
            case (#SneedLock(l)) {
                switch (l.lock) {
                    case (#Token(t)) {
                        #Map([("type", #Text("sneed_lock")), ("lock_id", #Nat(l.lock_id)), ("kind", #Text("token")), ("ledger", pv(t.ledger_canister_id)), ("amount", #Nat(t.amount)), ("expiry", Icrc3Log.nat64(t.expiry))]);
                    };
                    case (#Position(q)) {
                        #Map([("type", #Text("sneed_lock")), ("lock_id", #Nat(l.lock_id)), ("kind", #Text("position")), ("pool", pv(q.swap_canister_id)), ("position_id", #Nat(q.position_id)), ("expiry", Icrc3Log.nat64(q.expiry))]);
                    };
                };
            };
        };
    };
    func icrc3_config(caller : Principal, key : Text, value : T3.Value, old_value : ?T3.Value) {
        let base : [(Text, T3.Value)] = [("caller", pv(caller)), ("key", #Text(key)), ("value", value)];
        icrc3_add("sneedex_config_update", switch (old_value) { case (?o) { Array.append(base, [("old_value", o)]) }; case null { base } });
    };
    /// One config-update block per field of the Config record that changed.
    func icrc3_config_changes(caller : Principal, old : T.Config, new : T.Config) {
        let principals = func(ps : [Principal]) : T3.Value { #Array(Array.map<Principal, T3.Value>(ps, pv)) };
        let samePrincipals = func(a : [Principal], b : [Principal]) : Bool {
            a.size() == b.size() and Array.foldLeft<Principal, Bool>(a, true, func(acc, p) { acc and Utils.principalInList(p, b) }) and Array.foldLeft<Principal, Bool>(b, true, func(acc, p) { acc and Utils.principalInList(p, a) });
        };
        if (not samePrincipals(old.admins, new.admins)) { icrc3_config(caller, "admins", principals(new.admins), ?principals(old.admins)) };
        let nat = func(key : Text, o : Nat, n : Nat) { if (o != n) { icrc3_config(caller, key, #Nat(n), ?#Nat(o)) } };
        nat("min_offer_duration_ns", old.min_offer_duration_ns, new.min_offer_duration_ns);
        nat("max_assets_per_offer", old.max_assets_per_offer, new.max_assets_per_offer);
        nat("min_increment_usd_range_min", old.min_increment_usd_range_min, new.min_increment_usd_range_min);
        nat("min_increment_usd_range_max", old.min_increment_usd_range_max, new.min_increment_usd_range_max);
        nat("min_increment_usd_target", old.min_increment_usd_target, new.min_increment_usd_target);
        nat("min_increment_fallback_tokens", old.min_increment_fallback_tokens, new.min_increment_fallback_tokens);
    };
    func icrc3_bid_lost(bid : T.Bid, reason : Text) {
        icrc3_add("sneedex_bid_lost", [
            ("bid_id", #Nat(bid.id)), ("offer_id", #Nat(bid.offer_id)), ("bidder", pv(bid.bidder)), ("amount", #Nat(bid.amount)),
            ("escrowed", flagV(bid.tokens_escrowed)), ("reason", #Text(reason)),
        ]);
    };

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
                        try {
                            switch (await factory.deregisterCanisterFor(user, canisterId)) {
                                case (#Ok) {};
                                case (#Err(t)) { noteSupport("error", "deregisterCanisterFromWallet", ?user, null, null, Principal.toText(canisterId) # ": " # t) };
                            };
                        } catch (e) { noteCatch("deregisterCanisterFromWallet", ?user, null, Principal.toText(canisterId), e) };
                    };
                    case null {};
                };
            };
            case null {
                // Unknown canister kind: deregister from backend tracked canisters
                switch (backendCanisterId) {
                    case (?id) {
                        let backend : T.BackendActor = actor(Principal.toText(id));
                        try { await backend.unregister_tracked_canister_for(user, canisterId); } catch (e) { noteCatch("deregisterCanisterFromWallet", ?user, null, Principal.toText(canisterId), e) };
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
                        try {
                            switch (await factory.registerCanisterFor(user, canisterId, aid)) {
                                case (#Ok) {};
                                case (#Err(t)) { noteSupport("error", "registerCanisterToWallet", ?user, null, null, Principal.toText(canisterId) # ": " # t) };
                            };
                        } catch (e) { noteCatch("registerCanisterToWallet", ?user, null, Principal.toText(canisterId), e) };
                    };
                    case null {};
                };
            };
            case null {
                // Unknown canister kind: register to backend tracked canisters
                switch (backendCanisterId) {
                    case (?id) {
                        let backend : T.BackendActor = actor(Principal.toText(id));
                        try { await backend.register_tracked_canister_for(user, canisterId); } catch (e) { noteCatch("registerCanisterToWallet", ?user, null, Principal.toText(canisterId), e) };
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
                try { await backend.register_user_token_for(user, ledgerId); } catch (e) { noteCatch("registerTokenToWallet", ?user, null, Principal.toText(ledgerId), e) };
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
                    switch (await sms.send_system_notification({
                        recipients = recipients;
                        subject = subject;
                        body = body;
                    })) {
                        case (#ok(_)) {};
                        case (#err(e)) { noteSupport("error", "sendNotification", if (recipients.size() == 1) { ?recipients[0] } else { null }, null, null, subject # ": " # debug_show (e)) };
                    };
                } catch (e) {
                    // Notification failed - log but don't fail the main operation
                    noteCatch("sendNotification", if (recipients.size() == 1) { ?recipients[0] } else { null }, null, subject, e);
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
    /// Every step is best effort; a failed one is written to the support log (op "botEscrowSnapshot").
    func snapshotAndCleanNeuronManager(canisterId : Principal) : async () {
        let cid = Principal.toText(canisterId);
        func failed(what : Text, e : Error.Error) { noteCatch("botEscrowSnapshot", null, null, cid # " " # what, e) };
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
                    } catch (e) { failed("getFullNeuron", e) };
                };
            } catch (e) { failed("getAllNeuronsInfo", e) };
            
            // Step 2: Snapshot botkeys (raw numeric IDs)
            var botkeys : [(Principal, [Nat])] = [];
            try {
                botkeys := await manager.getBotkeySnapshot();
            } catch (e) { failed("getBotkeySnapshot (bots before v0.9.1 lack it)", e) };
            
            // Step 3: Store the combined snapshot
            putEscrowSnapshot(canisterId, {
                neuron_hotkeys = Buffer.toArray(neuronHotkeys);
                botkeys = botkeys;
            });
            
            // Step 4: Remove neuron hotkeys
            for (entry in Buffer.toArray(neuronHotkeys).vals()) {
                for (hotkey in entry.hotkeys.vals()) {
                    try {
                        switch (await manager.removeHotKey(entry.neuron_id, hotkey)) {
                            case (#Ok) {};
                            case (#Err(t)) { noteSupport("error", "botEscrowSnapshot", null, null, null, cid # " removeHotKey " # Principal.toText(hotkey) # ": " # t) };
                        };
                    } catch (e) { failed("removeHotKey " # Principal.toText(hotkey), e) };
                };
            };
            
            // Step 5: Clear botkeys
            try {
                await manager.clearBotkeys();
            } catch (e) { failed("clearBotkeys (bots before v0.9.1 lack it)", e) };
        } catch (e) { failed("snapshot", e) };
    };
    
    /// Snapshot botkeys and clear them during escrow for a Trading Bot.
    /// Similar to neuron manager flow but without neuron hotkeys.
    func snapshotAndCleanTradingBot(canisterId : Principal) : async () {
        let cid = Principal.toText(canisterId);
        func failed(what : Text, e : Error.Error) { noteCatch("botEscrowSnapshot", null, null, cid # " " # what, e) };
        try {
            let bot : T.TradingBotActor = actor(Principal.toText(canisterId));
            
            var botkeys : [(Principal, [Nat])] = [];
            try {
                botkeys := await bot.getBotkeySnapshot();
            } catch (e) { failed("getBotkeySnapshot", e) };
            
            putEscrowSnapshot(canisterId, {
                neuron_hotkeys = [];
                botkeys = botkeys;
            });
            
            try {
                await bot.clearBotkeys();
            } catch (e) { failed("clearBotkeys", e) };
        } catch (e) { failed("snapshot", e) };
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
                        } catch (e) { noteCatch("botEscrowRestore", null, null, Principal.toText(canisterId) # " restoreBotkeySnapshot " # debug_show (snapshot.botkeys), e) };
                    };
                } catch (e) { noteCatch("botEscrowRestore", null, null, Principal.toText(canisterId), e) };
                removeEscrowSnapshot(canisterId);
            };
        };
    };
    
    /// Restore neuron hotkeys and botkeys from escrow snapshot.
    /// Called during reclaim BEFORE the canister controllers are released,
    /// since Sneedex needs to still be a controller to call these methods.
    /// What could not be restored goes to the support log (op "botEscrowRestore") with the
    /// hotkey or botkeys, since the snapshot is dropped afterwards.
    func restoreNeuronManagerState(canisterId : Principal) : async () {
        let cid = Principal.toText(canisterId);
        switch (getEscrowSnapshot(canisterId)) {
            case null {}; // No snapshot, nothing to restore
            case (?snapshot) {
                try {
                    let manager : T.ICPNeuronManagerActor = actor(Principal.toText(canisterId));
                    
                    // Restore neuron hotkeys
                    for (entry in snapshot.neuron_hotkeys.vals()) {
                        for (hotkey in entry.hotkeys.vals()) {
                            let what = cid # " addHotKey " # Principal.toText(hotkey) # " to neuron " # debug_show (entry.neuron_id);
                            try {
                                switch (await manager.addHotKey(entry.neuron_id, hotkey)) {
                                    case (#Ok) {};
                                    case (#Err(t)) { noteSupport("error", "botEscrowRestore", null, null, null, what # ": " # t) };
                                };
                            } catch (e) { noteCatch("botEscrowRestore", null, null, what, e) };
                        };
                    };
                    
                    // Restore botkeys
                    if (snapshot.botkeys.size() > 0) {
                        try {
                            await manager.restoreBotkeySnapshot(snapshot.botkeys);
                        } catch (e) { noteCatch("botEscrowRestore", null, null, cid # " restoreBotkeySnapshot " # debug_show (snapshot.botkeys), e) }; // Older bots may not have this method
                    };
                } catch (e) { noteCatch("botEscrowRestore", null, null, cid, e) };
                
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

    transient let SUPPORT_LOG_MAX = 500;
    transient let SUPPORT_LOG_TEXT_MAX = 500;
    transient let MAX_ADMIN_REASON = 500;
    /// Append to the support log (kind "error" or "admin"), keeping at most SUPPORT_LOG_MAX entries.
    func noteSupport(kind : Text, op : Text, principal : ?Principal, offerId : ?T.OfferId, bidId : ?T.BidId, text : Text) {
        let clipped = if (text.size() <= SUPPORT_LOG_TEXT_MAX) { text } else {
            var out = ""; var n = 0;
            label clip for (c in text.chars()) { if (n >= SUPPORT_LOG_TEXT_MAX) { break clip }; out #= Text.fromChar(c); n += 1 };
            out # "…";
        };
        let entry : T.SupportLogEntry = { id = nextSupportLogId; time = Time.now(); kind; op; principal; offer_id = offerId; bid_id = bidId; text = clipped };
        nextSupportLogId += 1;
        let kept = if (supportLog.size() >= SUPPORT_LOG_MAX) {
            Array.tabulate<T.SupportLogEntry>(SUPPORT_LOG_MAX - 1, func(i) { supportLog[supportLog.size() - (SUPPORT_LOG_MAX - 1) + i] });
        } else { supportLog };
        supportLog := Array.append(kept, [entry]);
    };

    // The last text noted per (op, offer, bid) by background work that retries the same thing
    // (the hourly settlement sweep): a failure that repeats unchanged is logged once, not every
    // hour, so it cannot push everything else out of the ring. Transient: after an upgrade a
    // failure that persists is logged once more.
    transient var supportLastNoted = Map.new<Text, Text>();
    func noteSupportOnce(op : Text, principal : ?Principal, offerId : ?T.OfferId, bidId : ?T.BidId, text : Text) {
        let key = op # ":" # debug_show (offerId) # ":" # debug_show (bidId);
        if (Map.get(supportLastNoted, thash, key) == ?text) { return };
        Map.set(supportLastNoted, thash, key, text);
        noteSupport("error", op, principal, offerId, bidId, text);
    };
    /// What AssetHandlers' neuron escrow / hand-over could not do (a partial strip, a failed
    /// put-back, Sneedex unable to remove itself), for the support log.
    func neuronNote(principal : ?Principal, offerId : T.OfferId) : Text -> () {
        func(t : Text) { noteSupport("error", "snsNeuron", principal, ?offerId, null, t) };
    };
    /// A swallowed error of a best-effort call (wallet registration, notification, bot botkeys).
    func noteCatch(op : Text, principal : ?Principal, offerId : ?T.OfferId, what : Text, e : Error.Error) {
        noteSupport("error", op, principal, offerId, null, what # ": " # Error.message(e));
    };

    // ---- special prices ----
    func specialOverridesFields(o : T.SpecialPriceOverrides) : [(Text, ?Nat)] {
        [("offer_creation_fee_e8s", o.offer_creation_fee_e8s), ("auction_cut_bps", o.auction_cut_bps)];
    };
    /// The admin overrides when `p` gets the admin price (an admin who is a person).
    func adminPricesFor(p : Principal) : ?T.SpecialPriceOverrides {
        if (isAdmin(p) and SpecialPrices.isPerson(p)) { ?specialAdminPrices } else { null };
    };
    func partnerPricesFor(p : Principal) : ?SpecialPrices.Partner<T.SpecialPriceOverrides> {
        SpecialPrices.activePartner(specialPartnerPrices, p, Time.now());
    };
    /// Apply the admin and partner overrides of `p` on top of the price it gets today (`base`
    /// from `baseTier`, regular or premium): the lowest wins, ties keep the base tier.
    func applySpecial(p : Principal, base : Nat, baseTier : SpecialPrices.Tier, pick : T.SpecialPriceOverrides -> ?Nat) : (Nat, SpecialPrices.Tier) {
        let admin = switch (adminPricesFor(p)) { case (?o) { pick(o) }; case null { null } };
        let partner = switch (partnerPricesFor(p)) { case (?e) { pick(e.prices) }; case null { null } };
        let (n, t) = SpecialPrices.lowest(base, null, admin, partner);
        (n, if (t == #regular) { baseTier } else { t });
    };
    /// Offer creation fee for `user` and its tier: regular, premium as before, then admin / partner.
    func effectiveCreationFee(user : Principal) : async* (Nat64, SpecialPrices.Tier) {
        if (offerCreationFeeE8s == 0) { return (0, #regular) };
        var base = offerCreationFeeE8s;
        var tier : SpecialPrices.Tier = #regular;
        switch (sneedPremiumCanisterId) {
            case (?canisterId) {
                if (await* PremiumClient.isPremium(premiumCache, canisterId, user)) { base := premiumOfferCreationFeeE8s; tier := #premium };
            };
            case null {};
        };
        let (n, t) = applySpecial(user, Nat64.toNat(base), tier, func(o) { o.offer_creation_fee_e8s });
        // a fee below one ledger fee means no fee: createOffer forwards fee - ledger fee
        (if (n < Nat64.toNat(ICP_FEE)) { 0 } else { Nat64.fromNat(n) }, t);
    };
    func validateSpecialOverrides(o : T.SpecialPriceOverrides) : ?Text {
        switch (o.offer_creation_fee_e8s) {
            case (?f) {
                if (f > 18_446_744_073_709_551_615) { return ?"offer_creation_fee_e8s: too large" };
            };
            case null {};
        };
        switch (o.auction_cut_bps) { case (?b) { if (b > 5000) { return ?"auction_cut_bps: cannot exceed 50% (5000 bps)" } }; case null {} };
        null;
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
    
    /// Refund a Lost bid's escrow to its bidder, the one recipient the bid records: the bid amount
    /// less one ledger fee, from the bid's escrow subaccount. Serialized with every other payout of
    /// the bid (auto refund, refundBid, retryRefund, withdrawBidEscrow); once paid the bid is
    /// Refunded, so a repeat finds nothing to do. `caller`: who asked (null for a timer), for the
    /// activity log. Answers the ledger block of the refund.
    func refundLostBid(bidId : T.BidId, caller : ?Principal) : async* T.Result<Nat> {
        let bid = switch (getBid(bidId)) { case (?b) { b }; case null { return #err(#BidNotFound) } };
        if (bid.state != #Lost) { return #err(#InvalidState("Can only refund lost bids")) };
        if (not bid.tokens_escrowed) { return #err(#InvalidState("No tokens escrowed")) };
        let offer = switch (getOffer(bid.offer_id)) { case (?o) { o }; case null { return #err(#OfferNotFound) } };
        // the state checks above hold atomically with taking the lock
        if (isBidEscrowLocked(bid.id)) {
            return #err(#InvalidState("An escrow operation is already in progress for this bid"));
        };
        lockBidEscrow(bid.id);
        try {
            let fee = await* AssetHandlers.getTokenFee(offer.price_token_ledger);
            let refundAmount = if (bid.amount > fee) { bid.amount - fee } else { 0 };
            if (refundAmount == 0) {
                return #err(#InsufficientFunds({ available = bid.amount; required = fee }));
            };
            let to : T.Account = { owner = bid.bidder; subaccount = null };
            switch (await* AssetHandlers.transferTokens(offer.price_token_ledger, ?Utils.bidEscrowSubaccount(bid.bidder, bid.id), to, refundAmount)) {
                case (#err(e)) { #err(e) };
                case (#ok(txId)) {
                    switch (getBid(bid.id)) {
                        case (?current) { updateBid(bid.id, { current with state = #Refunded }) };
                        case null {};
                    };
                    icrc3_add("sneedex_bid_refund", [
                        ("bid_id", #Nat(bid.id)), ("offer_id", #Nat(bid.offer_id)), ("bidder", pv(bid.bidder)),
                        ("ledger", pv(offer.price_token_ledger)), ("amount", #Nat(refundAmount)),
                        ("to", acctV(to)), ("ledger_tx", #Nat(txId)), whoV(caller),
                    ]);
                    #ok(txId);
                };
            };
        } finally {
            unlockBidEscrow(bid.id);
        };
    };

    /// Auto-refund a lost bid (called via Timer)
    /// This is a best-effort operation - if it fails, the bidder (refundBid), anyone (retryRefund)
    /// or the hourly settlement sweep retries; the failure goes to the support log.
    func autoRefundBid(bidId : T.BidId) : async () {
        switch (getBid(bidId)) {
            case null {};
            case (?bid) {
                // nothing to do, or another payout of this bid is running
                if (bid.state != #Lost or not bid.tokens_escrowed or isBidEscrowLocked(bid.id)) { return };
                switch (await* refundLostBid(bidId, null)) {
                    case (#ok(_)) {};
                    case (#err(e)) { noteSupport("error", "autoRefundBid", ?bid.bidder, ?bid.offer_id, ?bid.id, errorText(e)) };
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
    /// Answers the details of the hand-over for its activity-log block (the amount and ledger
    /// block of a token transfer, how many NFTs moved; nothing for the other kinds).
    func deliverAsset(offer : T.Offer, assetIndex : Nat, recipient : Principal, toBuyer : Bool) : async* T.Result<[(Text, T3.Value)]> {
        let escrowSub = Utils.offerEscrowSubaccount(offer.creator, offer.id);
        func plain(r : T.Result<()>) : T.Result<[(Text, T3.Value)]> {
            switch (r) { case (#ok(_)) { #ok([]) }; case (#err(e)) { #err(e) } };
        };
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
                    plain(r);
                } else {
                    // restore botkeys BEFORE releasing controllers (nothing to do once restored)
                    if (ckind == T.CANISTER_KIND_ICP_NEURON_MANAGER) {
                        await restoreNeuronManagerState(asset.canister_id);
                    } else if (ckind == T.CANISTER_KIND_TRADING_BOT) {
                        await restoreTradingBotState(asset.canister_id);
                    };
                    switch (asset.controllers_snapshot) {
                        case (?snapshot) { plain(await* AssetHandlers.releaseCanister(asset.canister_id, snapshot)) };
                        case null { plain(await* AssetHandlers.transferCanister(asset.canister_id, [recipient])) };
                    };
                };
            };
            case (#SNSNeuron(asset)) {
                if (toBuyer) {
                    plain(await* AssetHandlers.transferNeuron(asset.governance_canister_id, asset.neuron_id, self(), [recipient], neuronNote(?recipient, offer.id)));
                } else {
                    switch (asset.hotkeys_snapshot) {
                        case (?snapshot) {
                            plain(await* AssetHandlers.releaseNeuron(asset.governance_canister_id, asset.neuron_id, self(), neuronRestorePermissions(offer, assetIndex, snapshot), neuronNote(?offer.creator, offer.id)));
                        };
                        case null {
                            plain(await* AssetHandlers.transferNeuron(asset.governance_canister_id, asset.neuron_id, self(), [recipient], neuronNote(?recipient, offer.id)));
                        };
                    };
                };
            };
            case (#ICRC1Token(asset)) {
                switch (await* AssetHandlers.sweepTokens(asset.ledger_canister_id, self(), escrowSub, { owner = recipient; subaccount = null })) {
                    case (#ok(?(amount, blockIndex))) { #ok([("amount", #Nat(amount)), ("ledger_tx", #Nat(blockIndex))]) };
                    case (#ok(null)) { #ok([]) };
                    case (#err(e)) { #err(e) };
                };
            };
            case (#ICRC7NFT(asset)) {
                switch (await* AssetHandlers.deliverEscrowedNfts(asset.collection_canister_id, self(), escrowSub, { owner = recipient; subaccount = null }, asset.token_ids)) {
                    case (#ok(n)) { #ok([("moved", #Nat(n))]) };
                    case (#err(e)) { #err(e) };
                };
            };
            case (#SneedLock(asset)) {
                plain(await* AssetHandlers.transferSneedLock(sneedLockCanisterId, asset, recipient));
            };
            case (#EXTNFT(asset)) {
                switch (await* AssetHandlers.deliverEscrowedExt(asset.collection_canister_id, self(), escrowSub, recipient, asset.token_indices)) {
                    case (#ok(n)) { #ok([("moved", #Nat(n))]) };
                    case (#err(e)) { #err(e) };
                };
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
    /// Answers null when nothing was handed over, else the details for the activity log (as deliverAsset).
    func recoverAsset(offer : T.Offer, assetIndex : Nat, recipient : Principal, toBuyer : Bool) : async* T.Result<?[(Text, T3.Value)]> {
        let entry = offer.assets[assetIndex];
        let escrowSub = Utils.offerEscrowSubaccount(offer.creator, offer.id);
        switch (entry.asset) {
            case (#ICRC1Token(asset)) {
                let bal = await* AssetHandlers.getTokenBalance(asset.ledger_canister_id, self(), ?escrowSub);
                let fee = await* AssetHandlers.getTokenFee(asset.ledger_canister_id);
                if (bal <= fee or (toBuyer and bal < asset.amount)) { return #ok(null) };
                switch (await* AssetHandlers.sweepTokens(asset.ledger_canister_id, self(), escrowSub, { owner = recipient; subaccount = null })) {
                    case (#ok(?(amount, blockIndex))) { #ok(?[("amount", #Nat(amount)), ("ledger_tx", #Nat(blockIndex))]) };
                    case (#ok(null)) { #ok(?[]) };
                    case (#err(e)) { #err(e) };
                };
            };
            case (#ICRC7NFT(asset)) {
                switch (await* AssetHandlers.deliverEscrowedNfts(asset.collection_canister_id, self(), escrowSub, { owner = recipient; subaccount = null }, asset.token_ids)) {
                    case (#ok(n)) { #ok(if (n > 0) { ?[("moved", #Nat(n))] } else { null }) };
                    case (#err(e)) { #err(e) };
                };
            };
            // like ICRC-7: only the tokens still in this offer's escrow account
            case (#EXTNFT(asset)) {
                switch (await* AssetHandlers.deliverEscrowedExt(asset.collection_canister_id, self(), escrowSub, recipient, asset.token_indices)) {
                    case (#ok(n)) { #ok(if (n > 0) { ?[("moved", #Nat(n))] } else { null }) };
                    case (#err(e)) { #err(e) };
                };
            };
            case (_) {
                if (otherOfferListsAsset(offer.id, entry.asset)) { return #ok(null) };
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
                if (not held) { return #ok(null) };
                switch (await* deliverAsset(offer, assetIndex, recipient, toBuyer)) {
                    case (#ok(d)) { #ok(?d) };
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
    /// `caller`: who asked (null for the auto-delivery timers), for the activity log.
    func settleAssets(offerId : T.OfferId, toBuyer : Bool, recover : Bool, recipient : Principal, winningBid : ?T.Bid, caller : ?Principal) : async* T.Result<Nat> {
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
            // one block per asset that arrived, written in the message that records it
            func logDelivered(assetIndex : Nat, recovered : Bool, details : [(Text, T3.Value)]) {
                let base : [(Text, T3.Value)] = [
                    ("offer_id", #Nat(offerId)), ("asset_index", #Nat(assetIndex)), ("asset", assetV(offer.assets[assetIndex].asset)),
                    ("to", pv(recipient)), ("side", #Text(if (toBuyer) { "buyer" } else { "seller" })),
                ];
                let flags : [(Text, T3.Value)] = if (recovered) { [("recovered", #Nat(1))] } else { [] };
                icrc3_add("sneedex_asset_deliver", Array.append(Array.append(Array.append(base, flags), details), [whoV(caller)]));
            };
            for (assetIndex in offer.assets.keys()) {
                let entry = offer.assets[assetIndex];
                // Tokens or NFTs the seller sent to the offer's escrow account but that never got
                // marked escrowed (too little sent, escrow* not called, or the offer cancelled
                // first) go back to the seller too: only what is in this offer's escrow account,
                // which only the seller funds. Best effort: nothing there is no failure, and a
                // ledger or collection that cannot answer is written to the support log (the
                // seller's reclaimAssets, settleOffer or the hourly sweep retry it while the offer
                // is Expired/Cancelled, and reclaimAssets once it is Reclaimed).
                let unescrowedReturn = (not toBuyer) and (not entry.escrowed) and (recover or not isAssetDelivered(offerId, assetIndex));
                if (unescrowedReturn) {
                    let escrowSub = Utils.offerEscrowSubaccount(offer.creator, offerId);
                    let moved : ?T.Result<?[(Text, T3.Value)]> = switch (entry.asset) {
                        case (#EXTNFT(a)) {
                            switch (await* AssetHandlers.deliverEscrowedExt(a.collection_canister_id, self(), escrowSub, recipient, a.token_indices)) {
                                case (#ok(n)) { ?#ok(if (n > 0) { ?[("moved", #Nat(n))] } else { null }) };
                                case (#err(e)) { ?#err(e) };
                            };
                        };
                        case (#ICRC7NFT(a)) {
                            switch (await* AssetHandlers.deliverEscrowedNfts(a.collection_canister_id, self(), escrowSub, { owner = recipient; subaccount = null }, a.token_ids)) {
                                case (#ok(n)) { ?#ok(if (n > 0) { ?[("moved", #Nat(n))] } else { null }) };
                                case (#err(e)) { ?#err(e) };
                            };
                        };
                        case (#ICRC1Token(a)) {
                            switch (await* AssetHandlers.sweepTokens(a.ledger_canister_id, self(), escrowSub, { owner = recipient; subaccount = null })) {
                                case (#ok(?(amount, blockIndex))) { ?#ok(?[("amount", #Nat(amount)), ("ledger_tx", #Nat(blockIndex))]) };
                                case (#ok(null)) { ?#ok(null) };
                                case (#err(e)) { ?#err(e) };
                            };
                        };
                        case (_) { null };
                    };
                    switch (moved) {
                        case (?#ok(details)) {
                            if (not recover) { markAssetDelivered(offerId, assetIndex) };
                            switch (details) {
                                case (?d) { handedOver += 1; logDelivered(assetIndex, recover, Array.append(d, [("escrowed", #Nat(0))])) };
                                case null {};
                            };
                        };
                        case (?#err(e)) {
                            noteSupport("error", "returnUnescrowedAsset", ?offer.creator, ?offerId, null, "asset " # Nat.toText(assetIndex) # ": " # errorText(e));
                        };
                        case null {};
                    };
                };
                let pending = (toBuyer or entry.escrowed) and (recover or not isAssetDelivered(offerId, assetIndex));
                if (pending) {
                    if (recover) {
                        switch (await* recoverAsset(offer, assetIndex, recipient, toBuyer)) {
                            case (#ok(?details)) { handedOver += 1; logDelivered(assetIndex, true, details) };
                            case (#ok(null)) {};
                            case (#err(e)) { failures.add("asset " # Nat.toText(assetIndex) # ": " # errorText(e)) };
                        };
                    } else {
                        switch (await* deliverAsset(offer, assetIndex, recipient, toBuyer)) {
                            case (#ok(details)) {
                                markAssetDelivered(offerId, assetIndex);
                                handedOver += 1;
                                logDelivered(assetIndex, false, details);
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
                icrc3_add("sneedex_offer_settle", [
                    ("offer_id", #Nat(offerId)), ("outcome", #Text(if (toBuyer) { "claimed" } else { "reclaimed" })), ("to", pv(recipient)), whoV(caller),
                ]);
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
                        case (#SNSNeuron(_) or #ICRC7NFT(_) or #SneedLock(_) or #EXTNFT(_)) {};
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
                                switch (await* settleAssets(offerId, true, false, bid.bidder, ?bid, null)) {
                                    case (#ok(_)) { scheduleWalletRegistration<system>(offer, bid.bidder, true) };
                                    case (#err(e)) { noteSupport("error", "autoDeliverAssets", ?bid.bidder, ?offerId, ?bid.id, errorText(e)) };
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
    func payWinningBidToSeller(offer : T.Offer, bid : T.Bid, caller : ?Principal) : async* T.Result<()> {
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
                let cutRecipient = getFeeRecipientForLedger(offer.price_token_ledger);
                let feeTransferResult = await* AssetHandlers.transferTokens(
                    offer.price_token_ledger,
                    ?subaccount,
                    cutRecipient,
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
                        icrc3_add("sneedex_cut_pay", Array.append<(Text, T3.Value)>([
                            ("offer_id", #Nat(offer.id)), ("bid_id", #Nat(bid.id)), ("ledger", pv(offer.price_token_ledger)),
                            ("cut", #Nat(marketplaceFee)), ("amount", #Nat(marketplaceFee - fee)), ("fee_rate_bps", #Nat(offer.fee_rate_bps)),
                            ("to", acctV(cutRecipient)), ("ledger_tx", #Nat(txId)), whoV(caller),
                        ], switch (Map.get(offerPriceTiers, nhash, offer.id)) { case (?t) { [("price_tier", #Text(SpecialPrices.tierText(t.cut)))] }; case null { [] } }));
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
                case (#ok(sellerTx)) {
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
                    icrc3_add("sneedex_seller_pay", [
                        ("offer_id", #Nat(offer.id)), ("bid_id", #Nat(bid.id)), ("seller", pv(offer.creator)), ("ledger", pv(offer.price_token_ledger)),
                        ("bid_amount", #Nat(bid.amount)), ("cut", #Nat(marketplaceFee)), ("amount", #Nat(sellerTransferAmount)),
                        ("to", acctV({ owner = offer.creator; subaccount = null })), ("ledger_tx", #Nat(sellerTx)), whoV(caller),
                    ]);
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
                        switch (await* payWinningBidToSeller(offer, bid, null)) {
                            case (#ok) {};
                            case (#err(e)) { noteSupport("error", "autoDeliverPayment", ?offer.creator, ?offerId, ?bid.id, errorText(e)) };
                        };
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
                switch (await* settleAssets(offerId, false, false, offer.creator, null, null)) {
                    case (#ok(_)) { scheduleWalletRegistration<system>(offer, offer.creator, false) };
                    case (#err(e)) { noteSupport("error", "autoReclaimAssets", ?offer.creator, ?offerId, null, errorText(e)) };
                };
            };
        };
    };
    
    /// Finish whatever settlement of an offer is still undone, paying only the recipients it
    /// records: a Completed offer's assets to the winning bidder and the winning bid to the seller;
    /// a Claimed offer's unpaid winning bid to the seller; an Expired or Cancelled offer's assets
    /// (and anything left in its escrow account) back to the seller. Each part only redoes what has
    /// not happened (per-asset tracking, bid states), so a repeat is harmless. Used by settleOffer
    /// (anyone) and the expiration worker's sweep (caller null). Answers what was done.
    func settleOfferInternal<system>(offerId : T.OfferId, caller : ?Principal) : async* T.Result<Text> {
        let offer = switch (getOffer(offerId)) { case (?o) { o }; case null { return #err(#OfferNotFound) } };
        let notes = Buffer.Buffer<Text>(2);
        var failed = false;
        // the seller's payment out of the winning bid's escrow, while that bid is still Won
        func paySeller() : async* () {
            let current = switch (getOffer(offerId)) { case (?o) { o }; case null { return } };
            switch (findWinningBid(current)) {
                case (?bid) {
                    if (bid.state == #Won) {
                        switch (await* payWinningBidToSeller(current, bid, caller)) {
                            case (#ok) { notes.add("seller paid") };
                            case (#err(e)) { failed := true; notes.add("seller payment: " # errorText(e)) };
                        };
                    } else { notes.add("seller already paid") };
                };
                case null { failed := true; notes.add("no winning bid found") };
            };
        };
        switch (offer.state) {
            case (#Completed(completion)) {
                let bid = switch (getBid(completion.winning_bid_id)) { case (?b) { b }; case null { return #err(#BidNotFound) } };
                switch (await* settleAssets(offerId, true, false, bid.bidder, ?bid, caller)) {
                    case (#ok(n)) {
                        notes.add("assets handed to the buyer (" # Nat.toText(n) # " in this call)");
                        scheduleWalletRegistration<system>(offer, bid.bidder, true);
                    };
                    case (#err(e)) { failed := true; notes.add("assets: " # errorText(e)) };
                };
                await* paySeller();
            };
            case (#Claimed) {
                let unpaid = switch (findWinningBid(offer)) { case (?b) { b.state == #Won }; case null { false } };
                if (not unpaid) { return #err(#InvalidState("Nothing to settle: the assets are claimed and the seller is paid")) };
                await* paySeller();
            };
            case (#Expired or #Cancelled) {
                switch (await* settleAssets(offerId, false, false, offer.creator, null, caller)) {
                    case (#ok(n)) {
                        notes.add("assets handed back to the seller (" # Nat.toText(n) # " in this call)");
                        scheduleWalletRegistration<system>(offer, offer.creator, false);
                    };
                    case (#err(e)) { failed := true; notes.add("assets: " # errorText(e)) };
                };
            };
            case (_) {
                return #err(#InvalidState("Nothing to settle: the offer is " # offerStateText(offer.state)));
            };
        };
        let summary = "Offer #" # Nat.toText(offerId) # ": " # Text.join("; ", notes.vals());
        if (failed) { #err(#TransferFailed(summary)) } else { #ok(summary) };
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
    /// This is called via Timer after activation to avoid instruction limits.
    /// The stakes are looked up first (awaits), then merged into the offer as it is *now*: a buyout,
    /// accept, cancel or expiry that lands during the lookups is never overwritten. Only the cached
    /// stake field of an asset that is still the same asset (same neuron / canister) changes.
    func cacheAssetStakes(offerId : T.OfferId) : async () {
        let offer = switch (getOffer(offerId)) { case (?o) { o }; case null { return } };
        if (offer.state != #Active) { return };

        // (asset index, asset with the cached stake filled in)
        let found = Buffer.Buffer<(Nat, T.Asset)>(0);
        for (i in offer.assets.keys()) {
            let entry = offer.assets[i];
            if (entry.escrowed) {
                switch (entry.asset) {
                    case (#SNSNeuron(neuronAsset)) {
                        try {
                            let governance : T.SNSGovernanceActor = actor(Principal.toText(neuronAsset.governance_canister_id));
                            let response = await governance.get_neuron({ neuron_id = ?neuronAsset.neuron_id });
                            switch (response.result) {
                                case (?#Neuron(neuron)) {
                                    found.add((i, #SNSNeuron({ neuronAsset with cached_stake_e8s = ?neuron.cached_neuron_stake_e8s })));
                                };
                                case (_) {};
                            };
                        } catch (e) {
                            noteSupport("error", "cacheAssetStakes", null, ?offerId, null, "get_neuron failed for asset " # Nat.toText(i) # ": " # Error.message(e));
                        };
                    };
                    case (#Canister(canisterAsset)) {
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
                                    switch (maybeInfo) { case (?info) { totalStake += info.stake_e8s }; case null {} };
                                };
                                found.add((i, #Canister({ canisterAsset with cached_total_stake_e8s = ?totalStake })));
                            } catch (e) {
                                noteSupport("error", "cacheAssetStakes", null, ?offerId, null, "getAllNeuronsInfo failed for asset " # Nat.toText(i) # ": " # Error.message(e));
                            };
                        };
                    };
                    case (_) {};
                };
            };
        };
        if (found.size() == 0) { return };

        // re-read: the offer may have been bought, accepted, cancelled or expired across the awaits
        let current = switch (getOffer(offerId)) { case (?o) { o }; case null { return } };
        if (current.state != #Active) { return };
        var assets = current.assets;
        for ((i, cached) in found.vals()) {
            if (i < assets.size() and assets[i].escrowed) {
                let same = switch (assets[i].asset, cached) {
                    case (#SNSNeuron(a), #SNSNeuron(b)) {
                        Principal.equal(a.governance_canister_id, b.governance_canister_id) and a.neuron_id.id == b.neuron_id.id
                    };
                    case (#Canister(a), #Canister(b)) { Principal.equal(a.canister_id, b.canister_id) };
                    case (_) { false };
                };
                if (same) {
                    let merged : T.Asset = switch (assets[i].asset, cached) {
                        case (#SNSNeuron(a), #SNSNeuron(b)) { #SNSNeuron({ a with cached_stake_e8s = b.cached_stake_e8s }) };
                        case (#Canister(a), #Canister(b)) { #Canister({ a with cached_total_stake_e8s = b.cached_total_stake_e8s }) };
                        case (other, _) { other };
                    };
                    assets := Utils.updateAt(assets, i, { assets[i] with asset = merged });
                };
            };
        };
        updateOffer(offerId, { current with assets });
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
    
    // One run of the expiration worker: first every Active offer past its expiration (each tried
    // once per run), then a sweep of what settlement left undone (one-shot settlement timers are
    // lost on an upgrade, and a failed hand-over or refund is only retried when someone asks):
    // offers Completed / Expired / Cancelled, Claimed offers whose seller is still unpaid, and Lost
    // bids still holding their escrow. Each item is one worker step on its own 0-second timer and
    // pays only the recipients the offer and bid record. At most SWEEP_MAX_* per run, rotating, so
    // an item that keeps failing cannot starve the others; its failure is logged once (support log).
    transient var workerAttempted = Map.new<T.OfferId, ()>(); // expired offers tried in this run
    transient var sweepOfferQueue : [T.OfferId] = [];
    transient var sweepBidQueue : [T.BidId] = [];
    transient var sweepOfferCursor : Nat = 0; // the last offer id swept: the next run starts after it
    transient var sweepBidCursor : Nat = 0;
    transient let SWEEP_MAX_OFFERS : Nat = 20;
    transient let SWEEP_MAX_BIDS : Nat = 50;
    // A worker that made no step for this long is gone (a trap rolls its message back before it
    // could clear expirationWorkerRunning): the next timer tick starts a new run.
    transient var workerLastStep : Int = 0;
    transient let WORKER_STALE_NS : Int = 30 * 60 * 1_000_000_000;

    /// Find the first Active offer that has passed its expiration time (not tried yet in this run)
    func findFirstExpiredOffer() : ?T.Offer {
        let now = Time.now();
        for (offer in offers.vals()) {
            if (offer.state == #Active and not Map.has(workerAttempted, nhash, offer.id)) {
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

    /// The first `max` of `ids` (ascending) after `cursor`, then wrapping around to the start.
    func rotateFrom(ids : [Nat], cursor : Nat, max : Nat) : [Nat] {
        let all = Array.append(Array.filter<Nat>(ids, func(i) { i > cursor }), Array.filter<Nat>(ids, func(i) { i <= cursor }));
        if (all.size() <= max) { all } else { Array.subArray<Nat>(all, 0, max) };
    };

    /// The offers and bids whose settlement is unfinished (see above), minus any being handed over now.
    func buildSweepQueues() {
        let wonOffers = Map.new<T.OfferId, ()>();
        for (b in bids.vals()) { if (b.state == #Won) { Map.set(wonOffers, nhash, b.offer_id, ()) } };
        let offerIds = Buffer.Buffer<T.OfferId>(0);
        for (o in offers.vals()) {
            let unsettled = switch (o.state) {
                case (#Completed(_) or #Expired or #Cancelled) { true };
                case (#Claimed) { Map.has(wonOffers, nhash, o.id) };
                case (_) { false };
            };
            if (unsettled and not Map.has(settlementLocks, nhash, o.id)) { offerIds.add(o.id) };
        };
        let bidIds = Buffer.Buffer<T.BidId>(0);
        for (b in bids.vals()) {
            if (b.state == #Lost and b.tokens_escrowed and not isBidEscrowLocked(b.id)) { bidIds.add(b.id) };
        };
        sweepOfferQueue := rotateFrom(Buffer.toArray(offerIds), sweepOfferCursor, SWEEP_MAX_OFFERS);
        sweepBidQueue := rotateFrom(Buffer.toArray(bidIds), sweepBidCursor, SWEEP_MAX_BIDS);
    };

    /// Start a worker run if there is anything to do. False when there is nothing.
    func startWorkerRun<system>() : Bool {
        workerAttempted := Map.new<T.OfferId, ()>();
        buildSweepQueues();
        if (findFirstExpiredOffer() == null and sweepOfferQueue.size() == 0 and sweepBidQueue.size() == 0) {
            return false;
        };
        expirationWorkerRunning := true;
        workerLastStep := Time.now();
        scheduleExpirationWorker<system>();
        true;
    };

    /// An Active offer past its expiration: completed with its highest bid, or Expired (and its
    /// assets handed back) when it has none. No await.
    func expireOfferNow<system>(offer : T.Offer) {
        switch (getHighestBid(offer.id)) {
            case (?highest) {
                switch (completeOfferNow<system>(offer.id, highest.id, "expiry", null)) {
                    case (#ok) {};
                    case (#err(e)) { noteSupport("error", "expirationWorker", ?offer.creator, ?offer.id, ?highest.id, errorText(e)) };
                };
            };
            case null {
                switch (getOffer(offer.id)) {
                    case (?current) {
                        if (current.state != #Active) { return };
                        updateOffer(offer.id, { current with state = #Expired });
                        notifyExpiration<system>(current);
                        icrc3_add("sneedex_offer_expire", [("offer_id", #Nat(offer.id)), whoV(null)]);
                        scheduleAutoReclaimAssets<system>(offer.id);
                    };
                    case null {};
                };
            };
        };
    };
    
    /// Worker function that processes expired offers one by one, then the settlement sweep.
    /// Uses 0-second timers to chain calls and avoid instruction limits. Whatever happens in a
    /// step (an error, a rejected call), the next step is scheduled or the running flag cleared.
    func expirationWorker() : async () {
        workerLastStep := Time.now();
        var again = false;
        var scheduled = false;
        try {
          try {
            switch (findFirstExpiredOffer()) {
                case (?offer) {
                    Map.set(workerAttempted, nhash, offer.id, ());
                    again := true;
                    expireOfferNow<system>(offer);
                };
                case null {
                    if (sweepOfferQueue.size() > 0) {
                        let offerId = sweepOfferQueue[0];
                        sweepOfferQueue := Array.subArray<T.OfferId>(sweepOfferQueue, 1, sweepOfferQueue.size() - 1);
                        sweepOfferCursor := offerId;
                        again := true;
                        switch (await* settleOfferInternal<system>(offerId, null)) {
                            case (#ok(_)) {};
                            case (#err(e)) {
                                let who = switch (getOffer(offerId)) { case (?o) { ?o.creator }; case null { null } };
                                noteSupportOnce("settlementSweep", who, ?offerId, null, errorText(e));
                            };
                        };
                    } else if (sweepBidQueue.size() > 0) {
                        let bidId = sweepBidQueue[0];
                        sweepBidQueue := Array.subArray<T.BidId>(sweepBidQueue, 1, sweepBidQueue.size() - 1);
                        sweepBidCursor := bidId;
                        again := true;
                        // skipped when nothing is due (no longer Lost) or another payout of it runs
                        let due = switch (getBid(bidId)) {
                            case (?b) { b.state == #Lost and b.tokens_escrowed and not isBidEscrowLocked(bidId) };
                            case null { false };
                        };
                        if (due) {
                            switch (await* refundLostBid(bidId, null)) {
                                case (#ok(_)) {};
                                case (#err(e)) {
                                    let (who, offerId) = switch (getBid(bidId)) { case (?b) { (?b.bidder, ?b.offer_id) }; case null { (null, null) } };
                                    noteSupportOnce("refundSweep", who, offerId, ?bidId, errorText(e));
                                };
                            };
                        };
                    };
                };
            };
          } catch (e) {
            noteSupport("error", "expirationWorker", null, null, null, Error.message(e));
          };
          if (again) { scheduleExpirationWorker<system>(); scheduled := true } else { expirationWorkerRunning := false };
        } finally {
            // a trap after an await (the catch cannot see it) still ends the run cleanly
            if (not scheduled) { expirationWorkerRunning := false };
        };
    };
    
    /// Schedule the worker to run (0-second timer to yield execution)
    func scheduleExpirationWorker<system>() {
        ignore Timer.setTimer<system>(#seconds 0, func() : async () {
            await expirationWorker();
        });
    };
    
    /// Main timer callback - starts a worker if not already running (or if the running one is gone)
    func expirationTimerCallback<system>() : async () {
        if (expirationWorkerRunning) {
            if (Time.now() - workerLastStep < WORKER_STALE_NS) { return };
            noteSupport("error", "expirationWorker", null, null, null, "the worker stopped without clearing its running flag; a new run starts");
            expirationWorkerRunning := false;
        };
        ignore startWorkerRun<system>();
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
        icrc3_config(caller, "asset_type_added", #Map([("id", #Nat(id)), ("name", #Text(name))]), null);
        
        #ok(id);
    };
    
    /// Deactivate an asset type (admin only)
    public shared ({ caller }) func deactivateAssetType(assetTypeId : T.AssetTypeId) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        let known = Array.find<T.AssetType>(assetTypes, func(t) { t.id == assetTypeId }) != null;
        assetTypes := Array.map<T.AssetType, T.AssetType>(assetTypes, func(t : T.AssetType) : T.AssetType {
            if (t.id == assetTypeId) {
                { id = t.id; name = t.name; description = t.description; active = false };
            } else { t };
        });
        if (known) { icrc3_config(caller, "asset_type_deactivated", #Nat(assetTypeId), null) };
        
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
        icrc3_config(caller, "asset_type_reactivated", #Nat(assetTypeId), null);
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
        var creationFeePaid : ?(Nat, Nat) = null; // (fee charged, ICP block), for the offer's block
        let (effectiveFee, creationFeeTier) = await* effectiveCreationFee(caller);
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
                        creationFeePaid := ?(requiredAmount, txId);
                        icrc3_add("sneedex_creation_fee_pay", [
                            ("caller", pv(caller)), ("payer", pv(caller)), ("fee_e8s", #Nat(requiredAmount)), ("amount_e8s", #Nat(transferAmount)),
                            ("to", acctV(icpFeeRecipient)), ("icp_tx", #Nat(txId)), ("price_tier", #Text(SpecialPrices.tierText(creationFeeTier))),
                        ]);
                    };
                };
            };
        };
        
        // Determine the fee rate for this offer (premium members may get lower rate)
        var offerFeeRateBps = marketplaceFeeRateBps;
        var cutTier : SpecialPrices.Tier = #regular;
        if (premiumAuctionCutBps > 0) {
            switch (sneedPremiumCanisterId) {
                case (?canisterId) {
                    let isPremiumMember = await* PremiumClient.isPremium(premiumCache, canisterId, caller);
                    if (isPremiumMember) {
                        offerFeeRateBps := premiumAuctionCutBps;
                        cutTier := #premium;
                    };
                };
                case null {};
            };
        };
        // admin and partner cuts (special prices), decided now like the premium cut
        let (specialRate, specialCutTier) = applySpecial(caller, offerFeeRateBps, cutTier, func(o) { o.auction_cut_bps });
        offerFeeRateBps := specialRate;
        cutTier := specialCutTier;
        
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
        let chargedFeeTier : ?SpecialPrices.Tier = switch (creationFeePaid) { case (?_) { ?creationFeeTier }; case null { null } };
        Map.set(offerPriceTiers, nhash, offerId, { creation_fee = chargedFeeTier; cut = cutTier });
        icrc3_add("sneedex_offer_create", Array.flatten<(Text, T3.Value)>([
            [("caller", pv(caller)), ("offer_id", #Nat(offerId)), ("price_ledger", pv(offer.price_token_ledger)), ("fee_rate_bps", #Nat(offerFeeRateBps)), ("cut_price_tier", #Text(SpecialPrices.tierText(cutTier)))],
            optNatF("min_bid", offer.min_bid_price),
            optNatF("buyout", offer.buyout_price),
            optNatF("expiration", switch (offer.expiration) { case (?e) { ?Int.abs(e) }; case null { null } }),
            optNatF("min_increment_fee_multiple", offer.min_bid_increment_fee_multiple),
            switch (offer.approved_bidders) { case (?list) { [("approved_bidders", #Array(Array.map<Principal, T3.Value>(list, pv)))] }; case null { [] } },
            switch (creationFeePaid) { case (?(fee, tx)) { [("creation_fee_e8s", #Nat(fee)), ("creation_fee_icp_tx", #Nat(tx)), ("price_tier", #Text(SpecialPrices.tierText(creationFeeTier)))] }; case null { [] } },
        ]));
        
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
                case (#EXTNFT(existing), #EXTNFT(new)) {
                    if (Principal.equal(existing.collection_canister_id, new.collection_canister_id)) {
                        for (i in new.token_indices.vals()) { if (Array.find<Nat32>(existing.token_indices, func(x) { x == i }) != null) { return true } };
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
            // EXT tokens: only their holder lists them. Each must be held by the caller's default
            // account, or already sit in this offer's escrow account (sent there before listing).
            case (#EXTNFT(nft)) {
                switch (getOffer(request.offer_id)) {
                    case null { return #err(#OfferNotFound) };
                    case (?o) {
                        if (not Principal.equal(caller, o.creator)) { return #err(#NotAuthorized) };
                        if (o.state != #Draft) { return #err(#InvalidState("Offer must be in Draft state to add assets")) };
                    };
                };
                switch (validateExtIndices(nft.token_indices)) { case (#err(e)) { return #err(e) }; case (#ok(_)) {} };
                let mine = Ext.accountId(caller);
                let escrowAid = Ext.accountIdOf(self(), Utils.offerEscrowSubaccount(caller, request.offer_id));
                for (index in nft.token_indices.vals()) {
                    switch (await* AssetHandlers.extBearer(nft.collection_canister_id, index)) {
                        case (#err(e)) { return #err(e) };
                        case (#ok(holder)) {
                            if (holder != mine and holder != escrowAid) {
                                return #err(#InvalidAsset("EXT token " # Nat32.toText(index) # " is not yours: it is held by account " # holder # ", not by your account " # mine));
                            };
                        };
                    };
                };
            };
            case (_) {};
        };
        addAssetSync(caller, { offer_id = request.offer_id; asset = asset });
    };

    /// 1 to 50 token indices, none twice.
    func validateExtIndices(indices : [Nat32]) : T.Result<()> {
        if (indices.size() == 0) { return #err(#InvalidAsset("List at least one token index")) };
        if (indices.size() > 50) { return #err(#InvalidAsset("At most 50 tokens of one collection per asset")) };
        var i = 0;
        for (a in indices.vals()) {
            var j = 0;
            for (b in indices.vals()) { if (i != j and a == b) { return #err(#InvalidAsset("Token index " # Nat32.toText(a) # " is listed twice")) }; j += 1 };
            i += 1;
        };
        #ok();
    };

    /// Another offer that can still change hands lists one of these EXT tokens: an open offer
    /// (Draft, PendingEscrow, Active) of the same seller, or any offer that holds it in escrow
    /// and has not handed it over yet. Another seller's stale draft does not block a new holder.
    func otherOfferListsExt(offerId : T.OfferId, seller : Principal, collection : Principal, indices : [Nat32]) : ?T.OfferId {
        for (o in offers.vals()) {
            if (o.id != offerId) {
                let open = o.state == #Draft or o.state == #PendingEscrow or o.state == #Active;
                let settled = o.state == #Claimed or o.state == #Reclaimed;
                for (assetIndex in o.assets.keys()) {
                    let entry = o.assets[assetIndex];
                    switch (entry.asset) {
                        case (#EXTNFT(e)) {
                            if (Principal.equal(e.collection_canister_id, collection)) {
                                let blocks = (open and Principal.equal(o.creator, seller)) or (entry.escrowed and not settled and not isAssetDelivered(o.id, assetIndex));
                                if (blocks) {
                                    for (i in indices.vals()) { if (Array.find<Nat32>(e.token_indices, func(x) { x == i }) != null) { return ?o.id } };
                                };
                            };
                        };
                        case (_) {};
                    };
                };
            };
        };
        null;
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
                    case (#EXTNFT(nft)) {
                        switch (validateExtIndices(nft.token_indices)) { case (#err(e)) { return #err(e) }; case (#ok(_)) {} };
                        switch (otherOfferListsExt(offer.id, caller, nft.collection_canister_id, nft.token_indices)) {
                            case (?other) { return #err(#InvalidAsset("An EXT token of this asset is already listed in offer " # Nat.toText(other))) };
                            case null {};
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
                icrc3_add("sneedex_asset_add", [
                    ("caller", pv(caller)), ("offer_id", #Nat(offer.id)), ("asset_index", #Nat(offer.assets.size())), ("asset", assetV(request.asset)),
                ]);
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
                icrc3_add("sneedex_offer_finalize", [("caller", pv(caller)), ("offer_id", #Nat(offerId)), ("asset_count", #Nat(offer.assets.size()))]);
                #ok();
            };
        };
    };
    
    // ============================================
    // ESCROW MANAGEMENT
    // ============================================
    
    /// Escrow a canister asset
    /// The end of an escrow, after its awaits: mark asset `assetIndex` escrowed (as `updatedEntry`)
    /// on the offer as it is *now*, never on the copy read before the awaits, so a concurrent
    /// escrow of another asset or a cancel is never undone. #written gives the offer's current
    /// state: anything but PendingEscrow means it was cancelled during the escrow, and the asset
    /// (which Sneedex now holds) is recorded as escrowed so the reclaim hands it back.
    func commitEscrow(offerId : T.OfferId, assetIndex : Nat, original : T.Asset, updatedEntry : T.AssetEntry) : { #written : T.OfferState; #alreadyEscrowed; #gone } {
        let current = switch (getOffer(offerId)) { case (?o) { o }; case null { return #gone } };
        if (assetIndex >= current.assets.size() or current.assets[assetIndex].asset != original) { return #gone };
        if (current.assets[assetIndex].escrowed) { return #alreadyEscrowed };
        updateOffer(offerId, { current with assets = Utils.updateAt(current.assets, assetIndex, updatedEntry) });
        #written(current.state);
    };

    /// The answer of an escrow that `commitEscrow` recorded on an offer no longer PendingEscrow.
    func escrowAfterCancel<system>(offerId : T.OfferId, state : T.OfferState) : T.Result<()> {
        switch (state) {
            case (#Cancelled or #Expired) { scheduleAutoReclaimAssets<system>(offerId) };
            case (_) {};
        };
        #err(#InvalidState("The offer was cancelled while this asset was being escrowed; the asset is recorded as escrowed and goes back to the seller (reclaimAssets)"));
    };

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
                                        
                                        // re-read: written onto the offer as it is now (see commitEscrow)
                                        let cstate = switch (commitEscrow(offerId, assetIndex, assetEntry.asset, updatedEntry)) {
                                            case (#gone) { return #err(#InvalidState("Offer changed while escrowing")) };
                                            case (#alreadyEscrowed) { return #err(#InvalidAsset("Asset already escrowed")) };
                                            case (#written(st)) { st };
                                        };
                                        icrc3_add("sneedex_asset_escrow", [("caller", pv(caller)), ("offer_id", #Nat(offerId)), ("asset_index", #Nat(assetIndex)), ("asset", assetV(updatedAsset))]);
                                        if (cstate != #PendingEscrow) { return escrowAfterCancel<system>(offerId, cstate) };
                                        
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
                                    allPermissions,
                                    neuronNote(?caller, offerId)
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
                                        
                                        // re-read: written onto the offer as it is now (see commitEscrow)
                                        let cstate = switch (commitEscrow(offerId, assetIndex, assetEntry.asset, updatedEntry)) {
                                            case (#gone) { return #err(#InvalidState("Offer changed while escrowing")) };
                                            case (#alreadyEscrowed) { return #err(#InvalidAsset("Asset already escrowed")) };
                                            case (#written(st)) { st };
                                        };
                                        icrc3_add("sneedex_asset_escrow", [("caller", pv(caller)), ("offer_id", #Nat(offerId)), ("asset_index", #Nat(assetIndex)), ("asset", assetV(updatedAsset))]);
                                        if (cstate != #PendingEscrow) { return escrowAfterCancel<system>(offerId, cstate) };
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
                                
                                // re-read: written onto the offer as it is now (see commitEscrow)
                                let cstate = switch (commitEscrow(offerId, assetIndex, assetEntry.asset, updatedEntry)) {
                                    case (#gone) { return #err(#InvalidState("Offer changed while escrowing")) };
                                    case (#alreadyEscrowed) { return #err(#InvalidAsset("Asset already escrowed")) };
                                    case (#written(st)) { st };
                                };
                                icrc3_add("sneedex_asset_escrow", [("caller", pv(caller)), ("offer_id", #Nat(offerId)), ("asset_index", #Nat(assetIndex)), ("asset", assetV(assetEntry.asset))]);
                                if (cstate != #PendingEscrow) { return escrowAfterCancel<system>(offerId, cstate) };
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
    /// Mark an EXT asset escrowed once every listed token is held by the offer's escrow account:
    /// the account id of this canister's escrow subaccount for the offer (getOfferEscrowAccountId).
    /// The seller sends each token there with the collection's transfer (to = { address = that
    /// account id }) and then calls this; nothing is pulled (EXT has no standard approval flow).
    public shared ({ caller }) func escrowEXTNFTs(offerId : T.OfferId, assetIndex : Nat) : async T.Result<()> {
        let offer = switch (getOffer(offerId)) { case (?o) { o }; case null { return #err(#OfferNotFound) } };
        if (not Principal.equal(caller, offer.creator)) { return #err(#NotAuthorized) };
        if (offer.state != #PendingEscrow) { return #err(#InvalidState("Offer must be in PendingEscrow state")) };
        if (assetIndex >= offer.assets.size()) { return #err(#InvalidAsset("Asset index out of bounds")) };
        let assetEntry = offer.assets[assetIndex];
        if (assetEntry.escrowed) { return #err(#InvalidAsset("Asset already escrowed")) };
        let nft = switch (assetEntry.asset) { case (#EXTNFT(n)) { n }; case (_) { return #err(#InvalidAsset("Asset at index is not an EXT NFT")) } };
        let escrowAid = Ext.accountIdOf(self(), Utils.offerEscrowSubaccount(caller, offerId));
        switch (await* AssetHandlers.verifyExtHeldBy(nft.collection_canister_id, nft.token_indices, escrowAid, "in the escrow account " # escrowAid)) {
            case (#err(e)) { return #err(e) };
            case (#ok(_)) {};
        };
        // re-read: the offer may have changed across the awaits
        let offer2 = switch (getOffer(offerId)) { case (?o) { o }; case null { return #err(#OfferNotFound) } };
        if (offer2.state != #PendingEscrow or assetIndex >= offer2.assets.size() or offer2.assets[assetIndex].escrowed) { return #err(#InvalidState("Offer changed while escrowing")) };
        let updatedEntry : T.AssetEntry = { asset = assetEntry.asset; escrowed = true };
        updateOffer(offerId, { offer2 with assets = Utils.updateAt(offer2.assets, assetIndex, updatedEntry) });
        icrc3_add("sneedex_asset_escrow", [("caller", pv(caller)), ("offer_id", #Nat(offerId)), ("asset_index", #Nat(assetIndex)), ("asset", assetV(assetEntry.asset)), ("account_id", #Text(escrowAid))]);
        #ok();
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
                                icrc3_add("sneedex_asset_escrow", [("caller", pv(caller)), ("offer_id", #Nat(offerId)), ("asset_index", #Nat(assetIndex)), ("asset", assetV(updatedEntry.asset))]);
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
                                icrc3_add("sneedex_asset_escrow", [("caller", pv(caller)), ("offer_id", #Nat(offerId)), ("asset_index", #Nat(assetIndex)), ("asset", assetV(assetEntry.asset)), ("pulled", flagV(pull))]);
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
                icrc3_add("sneedex_offer_activate", [("caller", pv(caller)), ("offer_id", #Nat(offerId))]);
                
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
    
    transient let MAX_OPEN_RESERVATIONS_PER_OFFER : Nat = 10;
    transient let MAX_OPEN_RESERVATIONS : Nat = 50;

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
                
                // Reservations are free, so each principal may hold only a few unconfirmed ones
                // (per offer and in all); confirming, or the offer closing, frees them.
                var openHere = 0;
                var openAll = 0;
                for (b in bids.vals()) {
                    if (b.state == #Pending and not b.tokens_escrowed and Principal.equal(b.bidder, caller)) {
                        let open = switch (getOffer(b.offer_id)) { case (?o) { o.state == #Active }; case null { false } };
                        if (open) {
                            openAll += 1;
                            if (b.offer_id == offerId) { openHere += 1 };
                        };
                    };
                };
                if (openHere >= MAX_OPEN_RESERVATIONS_PER_OFFER or openAll >= MAX_OPEN_RESERVATIONS) {
                    return #err(#InvalidState("Too many unconfirmed bid reservations (at most " # Nat.toText(MAX_OPEN_RESERVATIONS_PER_OFFER) # " per offer and " # Nat.toText(MAX_OPEN_RESERVATIONS) # " in all): confirm one, or reuse a reservation you already have (getBidsByBidderAll)"));
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
                icrc3_add("sneedex_bid_reserve", [("caller", pv(caller)), ("bid_id", #Nat(bidId)), ("offer_id", #Nat(offerId))]);
                
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
                                        let excessResult = await ledger.icrc1_transfer({
                                            from_subaccount = ?subaccount;
                                            to = { owner = caller; subaccount = null };
                                            amount = refundAmount;
                                            fee = ?fee;
                                            memo = ?Text.encodeUtf8("Excess bid refund");
                                            created_at_time = ?Nat64.fromNat(Int.abs(Time.now()));
                                        });
                                        switch (excessResult) {
                                            case (#Ok(txId)) {
                                                icrc3_add("sneedex_bid_excess_refund", [
                                                    ("caller", pv(caller)), ("bid_id", #Nat(bidId)), ("offer_id", #Nat(bid.offer_id)), ("ledger", pv(offer.price_token_ledger)),
                                                    ("amount", #Nat(refundAmount)), ("to", acctV({ owner = caller; subaccount = null })), ("ledger_tx", #Nat(txId)),
                                                ]);
                                            };
                                            // the excess stays in the bid escrow; withdrawBidEscrow takes it back
                                            case (#Err(e)) { noteSupport("error", "confirmBidExcessRefund", ?caller, ?bid.offer_id, ?bidId, debug_show (e)) };
                                        };
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
                                    icrc3_bid_lost(lostBid, "offer_closed");
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
                                icrc3_add("sneedex_bid_confirm", [
                                    ("caller", pv(caller)), ("bid_id", #Nat(bidId)), ("offer_id", #Nat(bid.offer_id)),
                                    ("ledger", pv(offer.price_token_ledger)), ("amount", #Nat(effectiveAmount)),
                                ]);
                                
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
                                        icrc3_bid_lost(lostBid, "outbid");
                                        
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
                                            switch (await completeOfferInternal(bid.offer_id, bidId, "buyout", ?caller)) {
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
                                                                icrc3_bid_lost(lostBid, "buyout_race");
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
    /// `reason` (buyout, accept, expiry) and `caller` (null for the expiration worker) are for the activity log.
    func completeOfferInternal(offerId : T.OfferId, winningBidId : T.BidId, reason : Text, caller : ?Principal) : async T.Result<()> {
        completeOfferNow<system>(offerId, winningBidId, reason, caller);
    };

    /// completeOfferInternal without the self-call: no await, so the expiration worker completes an
    /// offer within its own message and has no call of its own that could fail.
    func completeOfferNow<system>(offerId : T.OfferId, winningBidId : T.BidId, reason : Text, caller : ?Principal) : T.Result<()> {
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
                        icrc3_add("sneedex_offer_complete", [
                            ("offer_id", #Nat(offerId)), ("bid_id", #Nat(winningBidId)), ("buyer", pv(bid.bidder)),
                            ("price_ledger", pv(offer.price_token_ledger)), ("amount", #Nat(bid.amount)), ("reason", #Text(reason)), whoV(caller),
                        ]);
                        
                        // Notify seller of sale and winner of win (fire-and-forget)
                        notifySale<system>(offer, updatedBid);
                        notifyWin<system>(offer, updatedBid);
                    };
                    case null {
                        icrc3_add("sneedex_offer_complete", [("offer_id", #Nat(offerId)), ("bid_id", #Nat(winningBidId)), ("reason", #Text(reason)), whoV(caller)]);
                    };
                };
                
                // Mark all other bids as lost and schedule auto-refunds, in one pass over the bids
                // (it was one full copy of the bid list per bid, so thousands of free reservations
                // could push completion past the instruction limit). Unconfirmed reservations hold
                // no escrow: they become Lost too but get no block of their own (the offer's
                // completion block covers them), and nothing is refunded for them.
                let lostConfirmed = Buffer.Buffer<T.Bid>(0);
                bids := Array.map<T.Bid, T.Bid>(bids, func(b : T.Bid) : T.Bid {
                    if (b.offer_id == offerId and b.id != winningBidId and b.state == #Pending) {
                        let lost = { b with state = #Lost };
                        if (b.tokens_escrowed) { lostConfirmed.add(lost) };
                        lost;
                    } else { b };
                });
                for (lost in lostConfirmed.vals()) {
                    icrc3_bid_lost(lost, "offer_completed");
                    // Schedule auto-refund for lost bid (best effort)
                    scheduleAutoRefund<system>(lost.id);
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
                        await completeOfferInternal(offerId, highest.id, "accept", ?caller);
                    };
                };
            };
        };
    };
    
    /// Process expiration for an offer (can be called by anyone)
    public shared ({ caller }) func processExpiration(offerId : T.OfferId) : async T.Result<()> {
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
                                await completeOfferInternal(offerId, highest.id, "expiry", ?caller);
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
                                icrc3_add("sneedex_offer_expire", [("offer_id", #Nat(offerId)), whoV(?caller)]);
                                
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
                icrc3_add("sneedex_offer_cancel", [
                    ("caller", pv(caller)), ("offer_id", #Nat(offerId)),
                    ("from_state", #Text(switch (offer.state) { case (#Draft) { "draft" }; case (#PendingEscrow) { "pending_escrow" }; case (_) { "active" } })),
                ]);
                
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
                        icrc3_bid_lost(updatedBid, "offer_cancelled");
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
    
    /// Finish an offer's settlement, whoever calls: assets and payments go only to the recipients
    /// the offer records (the winning bidder, the seller), never to the caller as such. For a
    /// Completed offer: the assets to the winner and the payment to the seller; Claimed with the
    /// seller unpaid: the payment; Expired / Cancelled: the assets (and anything left in the offer's
    /// escrow account) back to the seller. Safe to repeat: only what has not happened is done.
    /// Lost bids are refunded with retryRefund. Answers what was done.
    public shared ({ caller }) func settleOffer(offerId : T.OfferId) : async T.Result<Text> {
        await* settleOfferInternal<system>(offerId, ?caller);
    };

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
                                switch (await* settleAssets(offerId, true, false, caller, ?bid, ?caller)) {
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
                                    switch (await* settleAssets(offerId, true, true, caller, ?bid, ?caller)) {
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
                            case (?bid) { await* payWinningBidToSeller(offer, bid, ?caller) };
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
                        switch (await* settleAssets(offerId, false, false, offer.creator, null, ?caller)) {
                            case (#err(e)) { #err(e) };
                            case (#ok(_)) {
                                scheduleWalletRegistration<system>(offer, offer.creator, false);
                                #ok();
                            };
                        };
                    };
                    case (#Reclaimed) {
                        switch (await* settleAssets(offerId, false, true, offer.creator, null, ?caller)) {
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
    
    /// Refund lost bid tokens (the bidder; anyone may call retryRefund, which pays the same bidder)
    public shared ({ caller }) func refundBid(bidId : T.BidId) : async T.Result<()> {
        switch (getBid(bidId)) {
            case null { return #err(#BidNotFound) };
            case (?bid) {
                if (not Principal.equal(caller, bid.bidder)) {
                    return #err(#NotAuthorized);
                };
                switch (await* refundLostBid(bidId, ?caller)) {
                    case (#ok(_)) { #ok() };
                    case (#err(e)) { #err(e) };
                };
            };
        };
    };

    /// Refund a Lost bid's escrow to its bidder, whoever calls: the money goes only to the bidder
    /// the bid records (the bid amount less one ledger fee), once. For support, or a bidder whose
    /// automatic refund failed. Answers the ledger block of the refund.
    public shared ({ caller }) func retryRefund(bidId : T.BidId) : async T.Result<Nat> {
        await* refundLostBid(bidId, ?caller);
    };
    
    /// Withdraw funds from bid escrow subaccount
    /// - Before confirmation: can withdraw all funds
    /// - After confirmation: can withdraw the excess above the bid amount. Every payout of a bid
    ///   escrow costs exactly bid.amount in all, its ledger fees included (a refund sends
    ///   amount - fee; the seller payout sends cut - fee and bid - cut - fee), so bid.amount is the
    ///   whole reserve (it used to be bid.amount + fee, one fee too many: a late deposit came back
    ///   less two fees)
    /// - Once the bid is paid out (Refunded, or ClaimedBySeller: the seller has been paid), nothing
    ///   is reserved: whatever is left or arrives later is the bidder's
    /// - Never from a Won bid (its escrow pays the seller)
    public shared ({ caller }) func withdrawBidEscrow(bidId : T.BidId, amount : Nat) : async T.Result<Nat> {
        switch (getBid(bidId)) {
            case null { return #err(#BidNotFound) };
            case (?bid) {
                if (not Principal.equal(caller, bid.bidder)) {
                    return #err(#NotAuthorized);
                };
                
                // Can't withdraw from a winning bid until the seller is paid
                if (bid.state == #Won) {
                    return #err(#InvalidState("Cannot withdraw from a won bid"));
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
                            // read again after the awaits: a payout that finished meanwhile shows here
                            let paidOut = switch (getBid(bid.id)) {
                                case (?b) { b.state == #Refunded or b.state == #ClaimedBySeller };
                                case null { false };
                            };
                            let minimumReserved : Nat = if (bid.tokens_escrowed and not paidOut) {
                                bid.amount // what the refund or the seller payout takes, fees included
                            } else {
                                0 // Nothing reserved yet, or the bid is paid out
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
                                case (#ok(txId)) {
                                    icrc3_add("sneedex_bid_escrow_withdraw", [
                                        ("caller", pv(caller)), ("bid_id", #Nat(bid.id)), ("offer_id", #Nat(bid.offer_id)), ("ledger", pv(offer.price_token_ledger)),
                                        ("amount", #Nat(amount)), ("to", acctV({ owner = caller; subaccount = null })), ("ledger_tx", #Nat(txId)),
                                    ]);
                                    return #ok(txId);
                                };
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
    
    /// The EXT / ICP-style account identifier (64 hex chars) of an offer's escrow account: this
    /// canister with getOfferEscrowSubaccount(creator, offerId). EXT tokens are escrowed there.
    public query func getOfferEscrowAccountId(creator : Principal, offerId : T.OfferId) : async Text {
        Ext.accountIdOf(self(), Utils.offerEscrowSubaccount(creator, offerId));
    };

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
            case (#EXTNFT(_)) T.ASSET_TYPE_EXT_NFT;
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
    
    /// Every bid of a bidder, unconfirmed reservations included (getBidsByBidder hides those):
    /// for support, to find a bid escrow a user deposited into without confirming.
    public query func getBidsByBidderAll(bidder : Principal) : async [T.Bid] {
        Array.filter<T.Bid>(bids, func(b : T.Bid) : Bool { Principal.equal(b.bidder, bidder) });
    };

    /// Where an offer's settlement stands: its state, the winning bid (if any), the indices of the
    /// assets already handed over by a settlement still in progress, and whether one is running now.
    public query func getSettlement(offerId : T.OfferId) : async ?{
        state : T.OfferState;
        winning_bid : ?T.Bid;
        delivered_asset_indices : [Nat];
        settlement_in_progress : Bool;
    } {
        switch (getOffer(offerId)) {
            case null { null };
            case (?offer) {
                ?{
                    state = offer.state;
                    winning_bid = findWinningBid(offer);
                    delivered_asset_indices = deliveredIndicesOf(offerId);
                    settlement_in_progress = Map.has(settlementLocks, nhash, offerId);
                };
            };
        };
    };

    /// The support log, newest first: errors of background work (timers, stake caching, auto
    /// settlement) and admin interventions. `before` pages back (entries with id < before).
    public query func getSupportLog(before : ?Nat, limit : Nat) : async [T.SupportLogEntry] {
        let lim = Nat.min(limit, 100);
        let out = Buffer.Buffer<T.SupportLogEntry>(lim);
        var i = supportLog.size();
        while (i > 0 and out.size() < lim) {
            i -= 1;
            let e = supportLog[i];
            let ok = switch (before) { case (?b) { e.id < b }; case null { true } };
            if (ok) { out.add(e) };
        };
        Buffer.toArray(out);
    };

    /// The support log entries that name a principal (as party or admin), newest first.
    public query func getSupportLogFor(p : Principal) : async [T.SupportLogEntry] {
        let out = Buffer.Buffer<T.SupportLogEntry>(0);
        var i = supportLog.size();
        while (i > 0) {
            i -= 1;
            let e = supportLog[i];
            if (e.principal == ?p) { out.add(e) };
        };
        Buffer.toArray(out);
    };

    /// The creation fees a principal paid, newest first (the same facts as the ICP ledger and the
    /// `sneedex_creation_fee_pay` blocks; older than the activity log too). `before` pages back
    /// (entries with id < before); at most 100 per call.
    public query func getCreationFeePaymentsFor(p : Principal, before : ?Nat, limit : Nat) : async [T.CreationFeePaymentLogEntry] {
        let lim = Nat.min(limit, 100);
        let out = Buffer.Buffer<T.CreationFeePaymentLogEntry>(0);
        var i = creationFeePaymentLog.size();
        while (i > 0 and out.size() < lim) {
            i -= 1;
            let e = creationFeePaymentLog[i];
            let inPage = switch (before) { case (?b) { e.id < b }; case null { true } };
            if (inPage and Principal.equal(e.payer, p)) { out.add(e) };
        };
        Buffer.toArray(out);
    };

    /// The marketplace cuts of the sales a principal took part in (as seller or buyer), newest first.
    /// `before` pages back (entries with id < before); at most 100 per call.
    public query func getCutPaymentsFor(p : Principal, before : ?Nat, limit : Nat) : async [T.CutPaymentLogEntry] {
        let lim = Nat.min(limit, 100);
        let out = Buffer.Buffer<T.CutPaymentLogEntry>(0);
        var i = cutPaymentLog.size();
        while (i > 0 and out.size() < lim) {
            i -= 1;
            let e = cutPaymentLog[i];
            let inPage = switch (before) { case (?b) { e.id < b }; case null { true } };
            if (inPage and (Principal.equal(e.seller, p) or Principal.equal(e.buyer, p))) { out.add(e) };
        };
        Buffer.toArray(out);
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
        
        let old = config;
        config := newConfig;
        icrc3_config_changes(caller, old, newConfig);
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
        
        let wasAdmin = Utils.principalInList(newAdmin, config.admins);
        config := {
            admins = Utils.addPrincipal(newAdmin, config.admins);
            min_offer_duration_ns = config.min_offer_duration_ns;
            max_assets_per_offer = config.max_assets_per_offer;
            min_increment_usd_range_min = config.min_increment_usd_range_min;
            min_increment_usd_range_max = config.min_increment_usd_range_max;
            min_increment_usd_target = config.min_increment_usd_target;
            min_increment_fallback_tokens = config.min_increment_fallback_tokens;
        };
        if (not wasAdmin) { icrc3_config(caller, "admin_added", pv(newAdmin), null) };
        
        #ok();
    };
    
    /// Remove admin (existing admin only)
    public shared ({ caller }) func removeAdmin(admin : Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        let wasAdmin = Utils.principalInList(admin, config.admins);
        config := {
            admins = Utils.removePrincipal(admin, config.admins);
            min_offer_duration_ns = config.min_offer_duration_ns;
            max_assets_per_offer = config.max_assets_per_offer;
            min_increment_usd_range_min = config.min_increment_usd_range_min;
            min_increment_usd_range_max = config.min_increment_usd_range_max;
            min_increment_usd_target = config.min_increment_usd_target;
            min_increment_fallback_tokens = config.min_increment_fallback_tokens;
        };
        if (wasAdmin) { icrc3_config(caller, "admin_removed", pv(admin), null) };
        
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
        
        let old = config;
        config := {
            admins = config.admins;
            min_offer_duration_ns = config.min_offer_duration_ns;
            max_assets_per_offer = config.max_assets_per_offer;
            min_increment_usd_range_min = usd_range_min;
            min_increment_usd_range_max = usd_range_max;
            min_increment_usd_target = usd_target;
            min_increment_fallback_tokens = fallback_tokens;
        };
        icrc3_config_changes(caller, old, config);
        
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
        
        let old = marketplaceFeeRateBps;
        marketplaceFeeRateBps := rateBps;
        icrc3_config(caller, "marketplace_fee_rate_bps", #Nat(rateBps), ?#Nat(old));
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
        
        let old = feeRecipient;
        feeRecipient := account;
        icrc3_config(caller, "fee_recipient", acctV(account), ?acctV(old));
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
        
        let oldOverride = Array.find<(Principal, T.Account)>(ledgerFeeRecipients, func((l, _)) { Principal.equal(l, ledger) });
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
        icrc3_config(caller, "ledger_fee_recipient", #Map([("ledger", pv(ledger)), ("account", acctV(account))]),
            switch (oldOverride) { case (?(_, a)) { ?#Map([("ledger", pv(ledger)), ("account", acctV(a))]) }; case null { null } });
        
        #ok();
    };
    
    /// Remove a fee recipient override for a specific ledger (admin only)
    /// Fees will fall back to the default fee recipient
    public shared ({ caller }) func removeLedgerFeeRecipient(ledger : Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        let hadOverride = Array.find<(Principal, T.Account)>(ledgerFeeRecipients, func((l, _)) { Principal.equal(l, ledger) }) != null;
        ledgerFeeRecipients := Array.filter<(Principal, T.Account)>(
            ledgerFeeRecipients,
            func ((l, _) : (Principal, T.Account)) : Bool {
                not Principal.equal(l, ledger);
            }
        );
        if (hadOverride) { icrc3_config(caller, "ledger_fee_recipient_removed", pv(ledger), null) };
        
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
        let old = offerCreationFeeE8s;
        offerCreationFeeE8s := feeE8s;
        icrc3_config(caller, "offer_creation_fee_e8s", Icrc3Log.nat64(feeE8s), ?Icrc3Log.nat64(old));
        #ok();
    };
    
    /// Set premium offer creation fee in ICP e8s (admin only)
    public shared ({ caller }) func setPremiumOfferCreationFee(feeE8s : Nat64) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let old = premiumOfferCreationFeeE8s;
        premiumOfferCreationFeeE8s := feeE8s;
        icrc3_config(caller, "premium_offer_creation_fee_e8s", Icrc3Log.nat64(feeE8s), ?Icrc3Log.nat64(old));
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
        let old = premiumAuctionCutBps;
        premiumAuctionCutBps := rateBps;
        icrc3_config(caller, "premium_auction_cut_bps", #Nat(rateBps), ?#Nat(old));
        #ok();
    };
    
    /// Set Sneed Premium canister ID (admin only)
    public shared ({ caller }) func setSneedPremiumCanisterId(canisterId : ?Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let old = sneedPremiumCanisterId;
        sneedPremiumCanisterId := canisterId;
        icrc3_config(caller, "sneed_premium_canister_id", optPrincipalV(canisterId), ?optPrincipalV(old));
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
            case (#Ok(txId)) {
                icrc3_add("sneedex_creation_payment_withdraw", [
                    ("caller", pv(caller)), ("amount_e8s", #Nat(withdrawAmount)), ("to", acctV({ owner = caller; subaccount = null })), ("icp_tx", #Nat(txId)),
                ]);
                #ok(withdrawAmount);
            };
            case (#Err(e)) { #err(#TransferFailed(debug_show(e))) };
        };
    };
    
    /// Get the effective offer creation fee for a user: premium status, then the admin and partner
    /// prices (special prices; the lowest applicable is charged)
    public func getEffectiveOfferCreationFee(user : Principal) : async Nat64 {
        (await* effectiveCreationFee(user)).0;
    };

    // ============================================
    // SPECIAL PRICES (spec/special_prices.md)
    // ============================================

    /// Admin prices: apply to this canister's admins who are people (never canisters). Admin only.
    public shared ({ caller }) func set_admin_prices(prices : T.SpecialPriceOverrides) : async { #ok; #err : Text } {
        if (not isAdmin(caller)) { return #err("Only admins can set special prices") };
        switch (validateSpecialOverrides(prices)) { case (?e) { return #err(e) }; case null {} };
        let old = specialAdminPrices;
        specialAdminPrices := prices;
        icrc3_config(caller, "admin_prices", SpecialPrices.overridesValue(specialOverridesFields(prices)), ?SpecialPrices.overridesValue(specialOverridesFields(old)));
        #ok;
    };

    /// Add or replace a partner's prices (label shown publicly, optional expiry in ns). Admin only.
    public shared ({ caller }) func set_partner_prices(partner : Principal, entry : SpecialPrices.Partner<T.SpecialPriceOverrides>) : async { #ok; #err : Text } {
        if (not isAdmin(caller)) { return #err("Only admins can set special prices") };
        switch (SpecialPrices.validatePartner(specialPartnerPrices, partner, entry, Time.now())) { case (?e) { return #err(e) }; case null {} };
        switch (validateSpecialOverrides(entry.prices)) { case (?e) { return #err(e) }; case null {} };
        let old = Map.get(specialPartnerPrices, phash, partner);
        Map.set(specialPartnerPrices, phash, partner, entry);
        let v = func(e : SpecialPrices.Partner<T.SpecialPriceOverrides>) : T3.Value { SpecialPrices.partnerValue(e.label_, specialOverridesFields(e.prices), e.expires_at) };
        icrc3_add("sneedex_config_update", Array.append<(Text, T3.Value)>(
            [("caller", pv(caller)), ("key", #Text("partner_prices")), ("partner", pv(partner)), ("value", v(entry))],
            switch (old) { case (?o) { [("old_value", v(o))] }; case null { [] } },
        ));
        #ok;
    };

    /// Remove a partner's prices. Admin only.
    public shared ({ caller }) func remove_partner_prices(partner : Principal) : async { #ok; #err : Text } {
        if (not isAdmin(caller)) { return #err("Only admins can set special prices") };
        switch (Map.remove(specialPartnerPrices, phash, partner)) {
            case null { #err("no partner prices for this principal") };
            case (?o) {
                icrc3_add("sneedex_config_update", [
                    ("caller", pv(caller)), ("key", #Text("partner_prices")), ("partner", pv(partner)), ("value", #Text("removed")),
                    ("old_value", SpecialPrices.partnerValue(o.label_, specialOverridesFields(o.prices), o.expires_at)),
                ]);
                #ok;
            };
        };
    };

    /// The admin prices and every partner entry (expired ones too). Public.
    public query func get_special_prices() : async {
        admin_prices : T.SpecialPriceOverrides;
        partners : [SpecialPrices.PartnerListing<T.SpecialPriceOverrides>];
    } {
        { admin_prices = specialAdminPrices; partners = SpecialPrices.listing(specialPartnerPrices) };
    };

    /// The special prices that apply to `p`: the admin prices if it gets them, its partner entry if
    /// one exists and has not expired. Public.
    public query func get_special_prices_for(p : Principal) : async {
        admin_prices : ?T.SpecialPriceOverrides;
        partner : ?SpecialPrices.Partner<T.SpecialPriceOverrides>;
    } {
        { admin_prices = adminPricesFor(p); partner = partnerPricesFor(p) };
    };

    /// The price tiers an offer's creator got: the creation fee's (null when none was charged) and
    /// the cut's (locked in as the offer's fee_rate_bps). Null for offers created before special prices.
    public query func get_offer_price_tiers(offerId : T.OfferId) : async ?T.OfferPriceTiers {
        Map.get(offerPriceTiers, nhash, offerId);
    };
    
    // ============================================
    // WALLET REGISTRATION SETTINGS (Admin)
    // ============================================
    
    /// Set the backend canister ID for wallet registration (admin only)
    public shared ({ caller }) func setBackendCanisterId(canisterId : ?Principal) : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let old = backendCanisterId;
        backendCanisterId := canisterId;
        icrc3_config(caller, "backend_canister_id", optPrincipalV(canisterId), ?optPrincipalV(old));
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
        let old = neuronManagerFactoryCanisterId;
        neuronManagerFactoryCanisterId := canisterId;
        icrc3_config(caller, "neuron_manager_factory_canister_id", optPrincipalV(canisterId), ?optPrincipalV(old));
        #ok();
    };
    
    public shared ({ caller }) func setSneedLockCanisterId(canisterId : Principal) : async T.Result<()> {
        if (not isAdmin(caller)) { return #err(#NotAuthorized) };
        let old = sneedLockCanisterId;
        sneedLockCanisterId := canisterId;
        icrc3_config(caller, "sneed_lock_canister_id", pv(canisterId), ?pv(old));
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
        let old = sneedSmsCanisterId;
        sneedSmsCanisterId := canisterId;
        icrc3_config(caller, "sneed_sms_canister_id", optPrincipalV(canisterId), ?optPrincipalV(old));
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
        icrc3_config(caller, "expiration_timer", #Text("on"), null);
        #ok();
    };
    
    /// Stop the expiration auto-processing timer (admin only)
    public shared ({ caller }) func stopExpirationTimer() : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let wasRunning = expirationTimerId != null;
        stopExpirationTimerInternal();
        if (wasRunning) { icrc3_config(caller, "expiration_timer", #Text("off"), null) };
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
        let old = expirationCheckIntervalSeconds;
        expirationCheckIntervalSeconds := intervalSeconds;
        icrc3_config(caller, "expiration_check_interval_seconds", #Nat(intervalSeconds), ?#Nat(old));
        
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
    /// Useful for testing or when you want to process expired offers immediately; also runs the
    /// settlement sweep (unsettled offers, unrefunded Lost bids)
    public shared ({ caller }) func triggerExpirationCheck() : async T.Result<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        if (expirationWorkerRunning and Time.now() - workerLastStep < WORKER_STALE_NS) {
            return #err(#InvalidState("Worker is already running"));
        };
        
        // Expired offers and the settlement sweep (nothing to do is fine)
        ignore startWorkerRun<system>();
        #ok();
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
            case (#ok(_)) {
                icrc3_add("sneedex_admin_nft_return", [("caller", pv(caller)), ("collection", pv(collection)), ("token_id", #Nat(tokenId)), ("to", acctV(to))]);
                #ok("Token " # Nat.toText(tokenId) # " returned");
            };
        };
    };

    /// Admin rescue for an EXT token that sits in an account of Sneedex but belongs to no offer
    /// that can still hand it over: sent to Sneedex's default account (`fromOffer` null), or to an
    /// offer's escrow account (`fromOffer`) without the offer holding it (never marked escrowed,
    /// or not listed there at all). Moves it to `to`'s default account. Refused while any offer
    /// waiting for its escrow lists the token, or any offer holds it escrowed and has not handed
    /// it over, so a legitimately escrowed token can never be moved this way.
    public shared ({ caller }) func adminReturnMisplacedExtNft(collection : Principal, tokenIndex : Nat32, fromOffer : ?T.OfferId, to : Principal) : async T.Result<Text> {
        if (not isAdmin(caller)) { return #err(#NotAuthorized) };
        if (Principal.isAnonymous(to)) { return #err(#InvalidInput("Refusing to send to the anonymous principal")) };
        for (o in offers.vals()) {
            if (o.state != #Draft and o.state != #Claimed and o.state != #Reclaimed) {
                for (assetIndex in o.assets.keys()) {
                    let entry = o.assets[assetIndex];
                    switch (entry.asset) {
                        case (#EXTNFT(nft)) {
                            if (Principal.equal(nft.collection_canister_id, collection) and Array.find<Nat32>(nft.token_indices, func(i) { i == tokenIndex }) != null) {
                                if (entry.escrowed and not isAssetDelivered(o.id, assetIndex)) {
                                    return #err(#InvalidState("Token is escrowed for offer " # Nat.toText(o.id)));
                                };
                                if (o.state == #PendingEscrow) {
                                    return #err(#InvalidState("Token is listed in offer " # Nat.toText(o.id) # ", which is waiting for its escrow"));
                                };
                            };
                        };
                        case (_) {};
                    };
                };
            };
        };
        let sub : ?Blob = switch (fromOffer) {
            case null { null };
            case (?id) { switch (getOffer(id)) { case (?o) { ?Utils.offerEscrowSubaccount(o.creator, o.id) }; case null { return #err(#OfferNotFound) } } };
        };
        let fromAid = switch (sub) { case (?s) { Ext.accountIdOf(self(), s) }; case null { Ext.accountId(self()) } };
        switch (await* AssetHandlers.verifyExtHeldBy(collection, [tokenIndex], fromAid, "in that account of Sneedex (" # fromAid # ")")) {
            case (#err(e)) { return #err(e) };
            case (#ok(_)) {};
        };
        switch (await* AssetHandlers.transferExtFrom(collection, self(), sub, tokenIndex, to)) {
            case (#err(e)) { #err(e) };
            case (#ok(_)) {
                let from : [(Text, T3.Value)] = switch (fromOffer) { case (?id) { [("from_offer_id", #Nat(id))] }; case null { [] } };
                icrc3_add("sneedex_admin_ext_return", Array.flatten<(Text, T3.Value)>([
                    [("caller", pv(caller)), ("collection", pv(collection)), ("token_index", #Nat(Nat32.toNat(tokenIndex))), ("token_identifier", #Text(Ext.tokenIdentifier(collection, tokenIndex)))],
                    from,
                    [("from_account_id", #Text(fromAid)), ("to", pv(to))],
                ]));
                #ok("EXT token " # Nat32.toText(tokenIndex) # " returned");
            };
        };
    };

    /// Admin function to manually reclaim stuck tokens from an offer
    /// This is useful when autoReclaimAssets failed to transfer tokens
    /// but already updated the state to Reclaimed.
    /// Only for offers whose assets belong back with the seller: Cancelled, Expired or Reclaimed,
    /// with no winning bid. Refused otherwise (an Active offer, or a Completed/Claimed one whose
    /// buyer is owed the assets). Every call is written to the support log.
    public shared ({ caller }) func adminReclaimStuckTokens(offerId : T.OfferId) : async T.Result<Text> {
        await* adminReclaimStuckTokensInternal(caller, offerId, "");
    };

    /// adminReclaimStuckTokens with the reason for the intervention (kept in the support log and
    /// in the activity-log block of every asset returned).
    public shared ({ caller }) func adminReclaimStuckTokensWithReason(offerId : T.OfferId, reason : Text) : async T.Result<Text> {
        if (reason.size() > MAX_ADMIN_REASON) { return #err(#InvalidState("The reason is limited to " # Nat.toText(MAX_ADMIN_REASON) # " characters")) };
        await* adminReclaimStuckTokensInternal(caller, offerId, reason);
    };

    func adminReclaimStuckTokensInternal(caller : Principal, offerId : T.OfferId, reason : Text) : async* T.Result<Text> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        func refuse(e : T.SneedexError) : T.Result<Text> {
            noteSupport("admin", "adminReclaimStuckTokens", ?caller, ?offerId, null, "refused: " # errorText(e) # (if (reason == "") { "" } else { "; reason: " # reason }));
            #err(e);
        };
        let offer = switch (getOffer(offerId)) { case (?o) { o }; case null { return refuse(#OfferNotFound) } };
        switch (offer.state) {
            // PendingEscrow: no bid can exist yet; each returned asset loses its escrowed flag, so the
            // offer cannot be activated over an empty escrow
            case (#Cancelled or #Expired or #Reclaimed or #PendingEscrow) {};
            case (_) {
                return refuse(#InvalidState("Only a PendingEscrow, Cancelled, Expired or Reclaimed offer can have its assets returned to the seller; this offer is " # offerStateText(offer.state)));
            };
        };
        // a winning bid means the buyer is owed the assets, whatever the offer state says
        for (b in getBidsForOffer(offerId).vals()) {
            if (b.state == #Won or b.state == #ClaimedBySeller) {
                return refuse(#InvalidState("Bid #" # Nat.toText(b.id) # " won this offer; its assets belong to the buyer"));
            };
        };
        // serialised with the settlement of the same offer (auto reclaim, reclaimAssets)
        if (Map.has(settlementLocks, nhash, offerId)) {
            return refuse(#InvalidState("A hand-over of this offer's assets is already in progress; try again shortly"));
        };
        Map.set(settlementLocks, nhash, offerId, ());
        try {
            let reasonField : [(Text, T3.Value)] = if (reason == "") { [] } else { [("reason", #Text(reason))] };
            let message = await* adminReturnOfferAssets(caller, offer, reasonField);
            noteSupport("admin", "adminReclaimStuckTokens", ?caller, ?offerId, null, (if (reason == "") { "" } else { "reason: " # reason # "; " }) # message);
            #ok(message);
        } finally {
            Map.delete(settlementLocks, nhash, offerId);
        };
    };

    func offerStateText(st : T.OfferState) : Text {
        switch (st) {
            case (#Draft) { "Draft" }; case (#PendingEscrow) { "PendingEscrow" }; case (#Active) { "Active" };
            case (#Completed(_)) { "Completed" }; case (#Expired) { "Expired" }; case (#Cancelled) { "Cancelled" };
            case (#Claimed) { "Claimed" }; case (#Reclaimed) { "Reclaimed" };
        };
    };

    /// Return every escrowed asset of `offer` to its creator, best effort; answers the per-asset results.
    /// Each step moves only what Sneedex still holds, so calling again does no harm.
    func adminReturnOfferAssets(caller : Principal, offer : T.Offer, extra : [(Text, T3.Value)]) : async* Text {
        let offerId = offer.id;
        do {
                var message = "Results for offer #" # Nat.toText(offerId) # ":\n";
                func returned(assetIndex : Nat, asset : T.Asset, details : [(Text, T3.Value)]) {
                    switch (getOffer(offerId)) {
                        case (?current) {
                            if (current.state == #PendingEscrow and assetIndex < current.assets.size() and current.assets[assetIndex].asset == asset) {
                                updateOffer(offerId, { current with assets = Utils.updateAt(current.assets, assetIndex, { current.assets[assetIndex] with escrowed = false }) });
                            };
                        };
                        case null {};
                    };
                    icrc3_add("sneedex_admin_asset_return", Array.append<(Text, T3.Value)>(Array.append<(Text, T3.Value)>([
                        ("caller", pv(caller)), ("offer_id", #Nat(offerId)), ("asset_index", #Nat(assetIndex)), ("asset", assetV(asset)), ("to", pv(offer.creator)),
                    ], details), extra));
                };
                
                for (assetIndex in offer.assets.keys()) {
                    let entry = offer.assets[assetIndex];
                    if (entry.escrowed) {
                        switch (entry.asset) {
                            case (#ICRC1Token(asset)) {
                                let subaccount = Utils.offerEscrowSubaccount(offer.creator, offerId);
                                let result = await* AssetHandlers.sweepTokens(
                                    asset.ledger_canister_id,
                                    self(),
                                    subaccount,
                                    { owner = offer.creator; subaccount = null }
                                );
                                switch (result) {
                                    case (#ok(swept)) {
                                        let blockIndex = switch (swept) { case (?(_, b)) { b }; case null { 0 } };
                                        message := message # "Token transfer succeeded, block: " # Nat.toText(blockIndex) # "\n";
                                        switch (swept) {
                                            case (?(amount, b)) { returned(assetIndex, entry.asset, [("amount", #Nat(amount)), ("ledger_tx", #Nat(b))]) };
                                            case null {};
                                        };
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
                                            case (#ok(_)) { message := message # "Canister released successfully\n"; returned(assetIndex, entry.asset, []) };
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
                                            case (#ok(_)) { message := message # "Canister transferred successfully\n"; returned(assetIndex, entry.asset, []) };
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
                            // NFTs: only the tokens still in this offer's escrow (before, an ICRC-7 asset
                            // was not covered by this switch and trapped)
                            case (#ICRC7NFT(asset)) {
                                switch (await* AssetHandlers.deliverEscrowedNfts(asset.collection_canister_id, self(), Utils.offerEscrowSubaccount(offer.creator, offerId), { owner = offer.creator; subaccount = null }, asset.token_ids)) {
                                    case (#ok(n)) { message := message # "NFTs returned to the seller: " # Nat.toText(n) # "\n"; if (n > 0) { returned(assetIndex, entry.asset, [("moved", #Nat(n))]) } };
                                    case (#err(e)) { message := message # "NFT return failed: " # errorText(e) # "\n" };
                                };
                            };
                            case (#EXTNFT(asset)) {
                                switch (await* AssetHandlers.deliverEscrowedExt(asset.collection_canister_id, self(), Utils.offerEscrowSubaccount(offer.creator, offerId), offer.creator, asset.token_indices)) {
                                    case (#ok(n)) { message := message # "EXT tokens returned to the seller: " # Nat.toText(n) # "\n"; if (n > 0) { returned(assetIndex, entry.asset, [("moved", #Nat(n))]) } };
                                    case (#err(e)) { message := message # "EXT return failed: " # errorText(e) # "\n" };
                                };
                            };
                            case (#SneedLock(asset)) {
                                switch (await* AssetHandlers.transferSneedLock(sneedLockCanisterId, asset, offer.creator)) {
                                    case (#ok(_)) { message := message # "Lock returned to the seller\n"; returned(assetIndex, entry.asset, []) };
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
                                            neuronRestorePermissions(offer, assetIndex, snapshot),
                                            neuronNote(?offer.creator, offerId)
                                        );
                                        switch (result) {
                                            case (#ok(_)) { message := message # "Neuron released successfully\n"; returned(assetIndex, entry.asset, []) };
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
                                            [offer.creator],
                                            neuronNote(?offer.creator, offerId)
                                        );
                                        switch (result) {
                                            case (#ok(_)) { message := message # "Neuron transferred successfully\n"; returned(assetIndex, entry.asset, []) };
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
                
                message;
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
        let old = neuronInfoCacheStalenessSeconds;
        neuronInfoCacheStalenessSeconds := seconds;
        icrc3_config(caller, "neuron_info_cache_staleness_seconds", #Nat(seconds), ?#Nat(old));
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
    // ICRC-3 ACTIVITY LOG (library src/icrc3, design spec/sneedex_icrc3.md)
    // ============================================

    transient let icrc3_catalogue : Icrc3Log.Config = {
        block_types_url = "https://app.sneeddao.com/api/sneedex#block-types";
        block_types = [
            "sneedex_offer_create",
            "sneedex_asset_add",
            "sneedex_offer_finalize",
            "sneedex_asset_escrow",
            "sneedex_offer_activate",
            "sneedex_offer_cancel",
            "sneedex_offer_expire",
            "sneedex_offer_complete",
            "sneedex_asset_deliver",
            "sneedex_offer_settle",
            "sneedex_bid_reserve",
            "sneedex_bid_excess_refund",
            "sneedex_bid_confirm",
            "sneedex_bid_lost",
            "sneedex_bid_refund",
            "sneedex_bid_escrow_withdraw",
            "sneedex_cut_pay",
            "sneedex_seller_pay",
            "sneedex_creation_fee_pay",
            "sneedex_creation_payment_withdraw",
            "sneedex_admin_asset_return",
            "sneedex_admin_nft_return",
            "sneedex_admin_ext_return",
            "sneedex_config_update",
        ];
    };

    func icrc3_cid() : Nat { icrc3_next_cid += 1; icrc3_next_cid };
    // Sneedex has no text log; the library's lines go to the canister log
    func icrc3_print(cid : Nat, message : Text) { Debug.print("[icrc3 " # Nat.toText(cid) # "] " # message) };

    func icrc3_env() : Icrc3Log.Environment {
        {
            self = self();
            archive_controllers = [SNEED_SNS_ROOT];
            cycle_reserve = 2_000_000_000_000; // never spend this canister's balance below 2 T
            new_correlation_id = icrc3_cid;
            log_info = icrc3_print;
            log_error = icrc3_print;
        };
    };

    func icrc3_sns_env() : Icrc3Sns.Environment {
        {
            governance = SNEED_GOVERNANCE;
            name = "Sneedex";
            doc_url = "https://app.sneeddao.com/api/sneedex#activity-log-icrc-3";
            new_correlation_id = icrc3_cid;
            log_info = icrc3_print;
            log_error = icrc3_print;
            describe = null;
        };
    };

    // ---- standard ICRC-3 read interface ----

    public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult {
        Icrc3Log.getBlocks(icrc3, args);
    };

    public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult {
        Icrc3Log.getArchives(icrc3, args);
    };

    public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate {
        Icrc3Log.tipCertificate(icrc3);
    };

    public query func icrc3_supported_block_types() : async [T3.BlockType] {
        Icrc3Log.supportedBlockTypes(icrc3_catalogue);
    };

    public query func icrc10_supported_standards() : async [T3.SupportedStandard] {
        Icrc3Log.supportedStandards();
    };

    public query func icrc3_log_status() : async T3.LogStatus {
        Icrc3Log.status(icrc3, icrc3_rt);
    };

    // ---- administration ----

    public shared ({ caller }) func admin_set_icrc3_settings(update : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
        if (not isAdmin(caller)) { return #Err("Only admins can change the ICRC-3 settings") };
        switch (Icrc3Log.applySettings(icrc3, update)) {
            case (#Err(e)) { #Err(e) };
            case (#Ok(changes)) {
                for ((key, old_value, new_value) in changes.vals()) {
                    icrc3_config(caller, key, #Nat(new_value), ?#Nat(old_value));
                };
                #Ok(icrc3.settings);
            };
        };
    };

    /// Move every live block to the archives now (creating archives as needed). Returns the number of blocks moved.
    public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
        if (not isAdmin(caller)) { return #Err("Only admins can trigger a spill") };
        if (icrc3_rt.spilling) { return #Err("A spill is already in progress") };
        let moved = await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true);
        ignore await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
        #Ok(moved);
    };

    /// Re-apply the intended controllers (this canister and SNS root) to every archive.
    public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
        if (not isAdmin(caller)) { Debug.trap("Only admins can repair archive controllers") };
        await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
    };

    // ---- SNS registration of archives ----

    /// Where each archive stands with its RegisterDappCanisters proposal.
    public query func icrc3_registration_status() : async Icrc3Sns.Status {
        Icrc3Sns.status(icrc3_sns, icrc3_sns_env());
    };

    /// The SNS neuron (32-byte id) that has this canister as a hotkey and submits the
    /// registration proposals; null switches the step off.
    public shared ({ caller }) func admin_set_icrc3_proposal_neuron(neuron : ?Blob) : async { #Ok; #Err : Text } {
        if (not isAdmin(caller)) { return #Err("Only admins can set the proposal neuron") };
        let old = icrc3_sns.neuron;
        switch (Icrc3Sns.setNeuron(icrc3_sns, neuron)) {
            case (#Err(e)) { #Err(e) };
            case (#Ok) {
                let asValue = func(n : ?Blob) : T3.Value { switch (n) { case (?b) { #Blob(b) }; case null { #Text("none") } } };
                icrc3_config(caller, "icrc3_proposal_neuron", asValue(neuron), ?asValue(old));
                #Ok;
            };
        };
    };

    /// Submit the pending registration proposals now instead of at the next spill check.
    public shared ({ caller }) func admin_icrc3_register_archives_now() : async { #Ok : Nat; #Err : Text } {
        if (not isAdmin(caller)) { return #Err("Only admins can submit registration proposals") };
        #Ok(await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env()));
    };

    /// Forget an archive's proposal (after a rejection) so a new one is submitted.
    public shared ({ caller }) func admin_icrc3_reset_archive_registration(canister_id : Principal) : async { #Ok : Bool; #Err : Text } {
        if (not isAdmin(caller)) { return #Err("Only admins can reset a registration") };
        #Ok(Icrc3Sns.reset(icrc3_sns, canister_id));
    };

    // ---- background work ----

    func icrc3_timer_job() : async () {
        ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false);
        ignore await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
    };

    func ensure_icrc3_timer<system>() {
        Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job);
    };

    // Republish the certified tip after an upgrade (certified data does not survive one).
    system func postupgrade() {
        Icrc3Log.certify(icrc3);
        ensure_icrc3_timer<system>();
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
        workerLastStep := Time.now();
        scheduleExpirationWorker<system>();
    };
    // the ICRC-3 spill check (every 15 minutes; started once, also on upgrades)
    ensure_icrc3_timer<system>();

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
        #adminReclaimStuckTokensWithReason : Any;
        #getBidsByBidderAll : Any;
        #getSettlement : Any;
        #getSupportLog : Any;
        #getSupportLogFor : Any;
        #getCreationFeePaymentsFor : Any;
        #getCutPaymentsFor : Any;
        #settleOffer : Any;
        #retryRefund : Any;
        #adminReturnMisplacedNft : Any;
        #adminReturnMisplacedExtNft : Any;
        #admin_icrc3_register_archives_now : Any;
        #admin_icrc3_repair_archive_controllers : Any;
        #admin_icrc3_reset_archive_registration : Any;
        #admin_icrc3_spill_now : Any;
        #admin_set_icrc3_proposal_neuron : Any;
        #admin_set_icrc3_settings : Any;
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
        #escrowEXTNFTs : Any;
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
        #get_offer_price_tiers : Any;
        #get_special_prices : Any;
        #get_special_prices_for : Any;
        #remove_partner_prices : Any;
        #set_admin_prices : Any;
        #set_partner_prices : Any;
        #getOfferCreationPaymentSubaccount : Any;
        #getOfferEscrowSubaccount : Any;
        #getOfferEscrowAccountId : Any;
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
        #icrc10_supported_standards : Any;
        #icrc3_get_archives : Any;
        #icrc3_get_blocks : Any;
        #icrc3_get_tip_certificate : Any;
        #icrc3_log_status : Any;
        #icrc3_registration_status : Any;
        #icrc3_supported_block_types : Any;
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
                or #getBidsByBidderAll _
                or #getSettlement _
                or #getSupportLog _
                or #getSupportLogFor _
                or #getCreationFeePaymentsFor _
                or #getCutPaymentsFor _
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
                or #get_offer_price_tiers _
                or #get_special_prices _
                or #get_special_prices_for _
                or #getOfferCreationPaymentSubaccount _
                or #getOfferEscrowSubaccount _
                or #getOfferEscrowAccountId _
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
                or #icrc10_supported_standards _
                or #icrc3_get_archives _
                or #icrc3_get_blocks _
                or #icrc3_get_tip_certificate _
                or #icrc3_log_status _
                or #icrc3_registration_status _
                or #icrc3_supported_block_types _
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
                    case (#EXTNFT n) n.token_indices.size() <= MAX_NFTS_PER_ASSET;
                    case _ true;
                })
            };
            // admin tools with free-form content
            case (#addAssetType _ or #updateConfig _) isAdmin(caller);
            case (#adminReclaimStuckTokensWithReason _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(MAX_ADMIN_REASON);
            case _ arg.size() <= IngressGuard.SMALL_ARG;
        };
    };

};
