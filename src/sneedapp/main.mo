import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Iter "mo:base/Iter";
import Array "mo:base/Array";
import Time "mo:base/Time";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat "mo:base/Nat";
import Buffer "mo:base/Buffer";
import Error "mo:base/Error";
import Cycles "mo:base/ExperimentalCycles";
import Text "mo:base/Text";

import T "../sneed_bots/sneed_icp_staking_bot/Types";
import PremiumClient "../PremiumClient";

shared (deployer) persistent actor class IcpNeuronManagerFactory() = this {

    // ============================================
    // CONSTANTS
    // ============================================

    // CMC memo for top-up: "TPUP" in little-endian
    transient let TOP_UP_MEMO: Blob = "\54\50\55\50\00\00\00\00";
    
    // Cycles to allocate when creating new canisters (configurable)
    var canisterCreationCycles: Nat = 1_000_000_000_000; // 1T cycles default

    // ============================================
    // STATE
    // ============================================

    // Admins who can manage the factory
    var admins: [Principal] = [deployer.caller];
    
    // Sneed governance canister (can also modify settings)
    var sneedGovernance: ?Principal = null;
    
    // DEPRECATED: Old mapping of canister ID -> manager canister info
    // Kept for migration purposes - will be migrated to userRegistrations on upgrade
    var managersStable: [(Principal, T.ManagerInfo)] = [];
    transient var _managers = HashMap.HashMap<Principal, T.ManagerInfo>(10, Principal.equal, Principal.hash);
    
    // NEW: User registrations - maps owner to list of canister IDs (like bookmarks)
    // Multiple users can register the same canister
    var userRegistrationsStable: [(Principal, [Principal])] = [];
    transient var userRegistrations = HashMap.HashMap<Principal, [Principal]>(10, Principal.equal, Principal.hash);
    
    // Authorized callers for "for" methods (e.g., Sneedex)
    var authorizedForCallersStable: [Principal] = [];
    transient var authorizedForCallers = HashMap.HashMap<Principal, Bool>(10, Principal.equal, Principal.hash);
    
    // Current manager version (set by admin when uploading WASM)
    var currentVersion: T.Version = { major = 0; minor = 0; patch = 0 };
    
    // Official versions registry (list of known verified WASM versions)
    var officialVersions: [T.OfficialVersion] = [];
    
    // Manager WASM module (uploaded by admin, used for creating new managers)
    var managerWasm: ?Blob = null;
    
    // Creation log (audit trail of all created managers)
    var creationLog: [T.CreationLogEntry] = [];
    var creationLogNextIndex: Nat = 0;
    
    // Financial log (correlates with creationLog via canisterId, tracks ICP and cycles)
    var financialLog: [T.FinancialLogEntry] = [];
    var financialLogNextIndex: Nat = 0;
    
    // Aggregate statistics for all creations
    var totalIcpPaidE8s: Nat = 0;
    var totalIcpForCyclesE8s: Nat = 0;
    var totalIcpProfitE8s: Nat = 0;
    var totalIcpTransferFeesE8s: Nat = 0;
    var totalCyclesReceivedFromCmc: Nat = 0;
    var totalCyclesSpentOnCreation: Nat = 0;
    
    // Payment configuration
    var creationFeeE8s: Nat64 = 100_000_000; // 1 ICP default
    var icpForCyclesE8s: Nat64 = 2_000_000;  // 0.02 ICP default (~2T cycles) DEPRECATED
    var minIcpForCyclesE8s: Nat64 = 1_000_000;  // 0.01 ICP minimum DEPRECATED
    var maxIcpForCyclesE8s: Nat64 = 10_000_000; // 0.1 ICP maximum DEPRECATED
    var targetCyclesAmount: Nat = 2_000_000_000_000; // 2T cycles target (to cover ~1T creation cost + margin)
    
    var feeDestination: T.Account = { owner = deployer.caller; subaccount = null }; // Default to deployer
    var paymentRequired: Bool = true;
    
    // Premium membership discount pricing
    var premiumCreationFeeE8s: Nat64 = 50_000_000; // 0.5 ICP default for premium members
    var sneedPremiumCanisterId: ?Principal = null; // Sneed Premium canister ID
    
    // Premium membership cache (stable Map - no preupgrade/postupgrade needed)
    var premiumCache = PremiumClient.emptyCache();

    // ============================================
    // MULTI-APP TYPES
    // ============================================

    type AppInfo = {
        appId: Text;                    // Unique string slug (e.g., "icp-staking-bot")
        numericAppId: Nat;              // Auto-incrementing numeric ID
        publisherId: Nat;               // Publisher that owns this app
        name: Text;
        description: Text;
        iconUrl: ?Text;
        mintPriceE8s: Nat64;
        premiumMintPriceE8s: Nat64;
        viewUrl: ?Text;
        manageUrl: ?Text;
        mintUrl: ?Text;
        families: [Text];               // Capability tags (subset of publisher's families)
        paymentAccount: ?T.Account;     // Override publisher's default payment destination
        daoCutBasisPoints: ?Nat;        // Override publisher's default DAO cut (admin-only)
        createdAt: Int;
        enabled: Bool;
    };

    type AppVersion = {
        major: Nat;
        minor: Nat;
        patch: Nat;
        wasmHash: Text;       // SHA256 hex hash (set by admin)
        wasmUrl: ?Text;       // External download URL
        sourceUrl: ?Text;     // Source code URL
        releaseNotes: Text;   // Markdown release notes
        releaseDate: Int;     // Timestamp
        wasmSize: Nat;        // Size of WASM blob (0 if not uploaded)
    };

    type AppVersionInfo = {
        major: Nat;
        minor: Nat;
        patch: Nat;
        wasmHash: Text;
        wasmUrl: ?Text;
        sourceUrl: ?Text;
        releaseNotes: Text;
        releaseDate: Int;
        wasmSize: Nat;
        hasWasm: Bool;
    };

    type AppVersionInput = {
        major: Nat;
        minor: Nat;
        patch: Nat;
        wasmHash: Text;       // Admin-provided hash
        wasmUrl: ?Text;
        sourceUrl: ?Text;
        releaseNotes: Text;
        releaseDate: Int;
    };

    type MintLogEntry = {
        index: Nat;
        canisterId: Principal;
        minter: Principal;
        appId: Text;
        numericAppId: Nat;
        publisherId: Nat;
        versionMajor: Nat;
        versionMinor: Nat;
        versionPatch: Nat;
        mintedAt: Int;
        icpPaidE8s: Nat64;
        wasPremium: Bool;
        daoCutE8s: Nat64;
        publisherRevenueE8s: Nat64;
    };

    type MintLogQuery = {
        startIndex: ?Nat;
        limit: ?Nat;
        appIdFilter: ?Text;
        minterFilter: ?Principal;
        fromTime: ?Int;
        toTime: ?Int;
    };

    type MintLogResult = {
        entries: [MintLogEntry];
        totalCount: Nat;
        hasMore: Bool;
    };

    type UserCanisterEntry = {
        canisterId: Principal;
        appId: Text;          // "" for legacy/unknown
    };

    type MintResult = {
        #Ok: { canisterId: Principal; accountId: T.AccountIdentifier };
        #Err: MintError;
    };

    type MintError = {
        #AppNotFound;
        #AppDisabled;
        #VersionNotFound;
        #NoWasmForVersion;
        #InsufficientPayment: { required: Nat64; provided: Nat64 };
        #InsufficientCycles;
        #CanisterCreationFailed: Text;
        #TransferFailed: Text;
        #PublisherNotFound;
        #PublisherNotVerified;
    };

    // ============================================
    // PUBLISHER TYPES
    // ============================================

    type PublisherInfo = {
        publisherId: Nat;
        name: Text;
        description: Text;
        websiteUrl: ?Text;
        logoUrl: ?Text;
        links: [(Text, Text)];          // (label, url) pairs
        owners: [Principal];
        verified: Bool;                 // Admin-editable only
        families: [Text];               // Family tags available for this publisher's apps
        defaultPaymentAccount: T.Account;
        daoCutBasisPoints: Nat;         // Default 1000 = 10%, admin-editable only
        createdAt: Int;
    };

    type CreatePublisherInput = {
        name: Text;
        description: Text;
        websiteUrl: ?Text;
        logoUrl: ?Text;
        links: [(Text, Text)];
        defaultPaymentAccount: T.Account;
    };

    type UpdatePublisherInput = {
        name: Text;
        description: Text;
        websiteUrl: ?Text;
        logoUrl: ?Text;
        links: [(Text, Text)];
        defaultPaymentAccount: T.Account;
    };

    type AddAppInput = {
        appId: Text;
        name: Text;
        description: Text;
        iconUrl: ?Text;
        mintPriceE8s: Nat64;
        premiumMintPriceE8s: Nat64;
        viewUrl: ?Text;
        manageUrl: ?Text;
        mintUrl: ?Text;
        families: [Text];
    };

    type UpdateAppInput = {
        name: Text;
        description: Text;
        iconUrl: ?Text;
        mintPriceE8s: Nat64;
        premiumMintPriceE8s: Nat64;
        viewUrl: ?Text;
        manageUrl: ?Text;
        mintUrl: ?Text;
        families: [Text];
    };

    type PublisherStats = {
        publisherId: Nat;
        totalRevenueE8s: Nat;
        totalWithdrawnE8s: Nat;
        totalDaoCutE8s: Nat;
        totalMintCount: Nat;
    };

    type AppRevenueStats = {
        numericAppId: Nat;
        publisherId: Nat;
        totalRevenueE8s: Nat;
        totalWithdrawnE8s: Nat;
        totalDaoCutE8s: Nat;
        mintCount: Nat;
    };

    type DaoRevenueStats = {
        totalDaoCutReceivedE8s: Nat;
        totalDirectRevenueE8s: Nat;
        totalRevenueE8s: Nat;
    };

    // ============================================
    // MULTI-APP STATE
    // ============================================

    // App Registry
    var apps: [AppInfo] = [];

    // App Versions (metadata only - WASM blobs stored separately)
    var appVersions: [(Text, [AppVersion])] = [];

    // WASM blobs for app versions, keyed by "appId:major.minor.patch"
    var appVersionWasmsStable: [(Text, Blob)] = [];
    transient var appVersionWasmsMap = HashMap.HashMap<Text, Blob>(10, Text.equal, Text.hash);

    // Immutable Mint Log
    var mintLog: [MintLogEntry] = [];
    var mintLogNextIndex: Nat = 0;
    var mintLogIndexStable: [(Principal, Nat)] = [];
    transient var mintLogIndexMap = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

    // Enhanced User Wallet (replaces userRegistrations)
    var userWalletStable: [(Principal, [UserCanisterEntry])] = [];
    transient var userWalletMap = HashMap.HashMap<Principal, [UserCanisterEntry]>(10, Principal.equal, Principal.hash);

    // ============================================
    // PUBLISHER STATE
    // ============================================

    func natEqual(a: Nat, b: Nat): Bool { a == b };
    func natHash(n: Nat): Nat32 { Text.hash(Nat.toText(n)) };

    var publishers: [(Nat, PublisherInfo)] = [];
    var nextPublisherId: Nat = 1; // 0 is reserved for Sneed DAO
    transient var publisherMap = HashMap.HashMap<Nat, PublisherInfo>(10, natEqual, natHash);

    // App numeric ID tracking
    var nextAppId: Nat = 0;
    transient var appByNumericId = HashMap.HashMap<Nat, AppInfo>(10, natEqual, natHash);
    transient var appByStringId = HashMap.HashMap<Text, Nat>(10, Text.equal, Text.hash);

    // Revenue stats
    var publisherStatsStable: [(Nat, PublisherStats)] = [];
    var appRevenueStatsStable: [(Nat, AppRevenueStats)] = [];
    var totalDaoCutReceivedE8s: Nat = 0;
    var totalDirectRevenueE8s: Nat = 0;
    transient var publisherStatsMap = HashMap.HashMap<Nat, PublisherStats>(10, natEqual, natHash);
    transient var appRevenueStatsMap = HashMap.HashMap<Nat, AppRevenueStats>(10, natEqual, natHash);

    // IC Management canister (for updating controllers after spawning)
    transient let ic: T.ManagementCanister = actor("aaaaa-aa");
    
    // ICP Ledger canister
    transient let ledger: T.LedgerActor = actor(T.LEDGER_CANISTER_ID);
    
    // CMC canister
    transient let cmc: T.CmcActor = actor(T.CMC_CANISTER_ID);

    // ============================================
    // SYSTEM FUNCTIONS
    // ============================================

    system func preupgrade() {
        // Save old userRegistrations (kept for safety/rollback)
        userRegistrationsStable := Iter.toArray(userRegistrations.entries());
        // Save authorized callers
        authorizedForCallersStable := Iter.toArray(authorizedForCallers.keys());
        // Save multi-app state
        appVersionWasmsStable := Iter.toArray(appVersionWasmsMap.entries());
        mintLogIndexStable := Iter.toArray(mintLogIndexMap.entries());
        userWalletStable := Iter.toArray(userWalletMap.entries());
        // Save publisher state
        publishers := Iter.toArray(publisherMap.entries());
        publisherStatsStable := Iter.toArray(publisherStatsMap.entries());
        appRevenueStatsStable := Iter.toArray(appRevenueStatsMap.entries());
    };

    system func postupgrade() {
        // Restore old userRegistrations from stable storage (if any)
        userRegistrations := HashMap.fromIter(userRegistrationsStable.vals(), userRegistrationsStable.size(), Principal.equal, Principal.hash);
        userRegistrationsStable := [];
        
        // Restore authorized callers
        for (caller in authorizedForCallersStable.vals()) {
            authorizedForCallers.put(caller, true);
        };
        authorizedForCallersStable := [];
        
        // Restore multi-app state
        appVersionWasmsMap := HashMap.fromIter(appVersionWasmsStable.vals(), appVersionWasmsStable.size(), Text.equal, Text.hash);
        appVersionWasmsStable := [];
        mintLogIndexMap := HashMap.fromIter(mintLogIndexStable.vals(), mintLogIndexStable.size(), Principal.equal, Principal.hash);
        mintLogIndexStable := [];
        userWalletMap := HashMap.fromIter(userWalletStable.vals(), userWalletStable.size(), Principal.equal, Principal.hash);
        userWalletStable := [];

        // Restore publisher state
        publisherMap := HashMap.fromIter<Nat, PublisherInfo>(publishers.vals(), publishers.size(), natEqual, natHash);
        publishers := [];
        publisherStatsMap := HashMap.fromIter<Nat, PublisherStats>(publisherStatsStable.vals(), publisherStatsStable.size(), natEqual, natHash);
        publisherStatsStable := [];
        appRevenueStatsMap := HashMap.fromIter<Nat, AppRevenueStats>(appRevenueStatsStable.vals(), appRevenueStatsStable.size(), natEqual, natHash);
        appRevenueStatsStable := [];

        // Rebuild app lookup indexes from apps array
        rebuildAppIndexes();

        // Ensure publisher 0 (Sneed DAO) exists
        ensurePublisher0Exists();
        
        // Clean expired entries from premium cache (stable Map persists automatically)
        PremiumClient.cleanCache(premiumCache);
        
        // Migration: If there's data in old managersStable, migrate it to userWalletMap
        if (managersStable.size() > 0) {
            for ((canisterId, info) in managersStable.vals()) {
                walletAdd(info.owner, canisterId, "icp-staking-bot");
            };
            managersStable := [];
        };
        
        // Migration: Migrate old userRegistrations into userWalletMap
        for ((owner, canisterIds) in userRegistrations.entries()) {
            for (canisterId in canisterIds.vals()) {
                walletAdd(owner, canisterId, "icp-staking-bot");
            };
        };
    };

    // ============================================
    // MULTI-APP HELPER FUNCTIONS
    // ============================================

    // -- Wallet Helpers --

    func walletAdd(user: Principal, canisterId: Principal, appId: Text) {
        let entry: UserCanisterEntry = { canisterId = canisterId; appId = appId };
        switch (userWalletMap.get(user)) {
            case null {
                userWalletMap.put(user, [entry]);
            };
            case (?existing) {
                let found = Array.find<UserCanisterEntry>(existing, func(e) { Principal.equal(e.canisterId, canisterId) });
                switch (found) {
                    case null {
                        userWalletMap.put(user, Array.append(existing, [entry]));
                    };
                    case (?f) {
                        // Update appId if the existing entry has an empty one and a non-empty one is provided
                        if (f.appId == "" and appId != "") {
                            let updated = Array.map<UserCanisterEntry, UserCanisterEntry>(existing, func(e) {
                                if (Principal.equal(e.canisterId, canisterId)) { { canisterId = canisterId; appId = appId } } else { e }
                            });
                            userWalletMap.put(user, updated);
                        };
                    };
                };
            };
        };
    };

    func walletRemove(user: Principal, canisterId: Principal): Bool {
        switch (userWalletMap.get(user)) {
            case null { false };
            case (?existing) {
                let newList = Array.filter<UserCanisterEntry>(existing, func(e) { not Principal.equal(e.canisterId, canisterId) });
                if (newList.size() == existing.size()) { return false };
                if (newList.size() == 0) {
                    userWalletMap.delete(user);
                } else {
                    userWalletMap.put(user, newList);
                };
                true;
            };
        };
    };

    func walletGetEntries(user: Principal): [UserCanisterEntry] {
        switch (userWalletMap.get(user)) {
            case null { [] };
            case (?list) { list };
        };
    };

    func walletGetCanisterIds(user: Principal): [Principal] {
        Array.map<UserCanisterEntry, Principal>(walletGetEntries(user), func(e) { e.canisterId });
    };

    // -- App Version Helpers --

    func makeVersionKey(appId: Text, major: Nat, minor: Nat, patch: Nat): Text {
        appId # ":" # Nat.toText(major) # "." # Nat.toText(minor) # "." # Nat.toText(patch);
    };

    func getAppById(appId: Text): ?AppInfo {
        Array.find<AppInfo>(apps, func(a) { a.appId == appId });
    };

    func getVersionsForApp(appId: Text): [AppVersion] {
        for (pair in appVersions.vals()) {
            if (pair.0 == appId) return pair.1;
        };
        [];
    };

    func setVersionsForApp(appId: Text, versions: [AppVersion]) {
        var found = false;
        appVersions := Array.map<(Text, [AppVersion]), (Text, [AppVersion])>(
            appVersions,
            func(pair) {
                if (pair.0 == appId) {
                    found := true;
                    (pair.0, versions);
                } else {
                    pair;
                };
            }
        );
        if (not found and versions.size() > 0) {
            appVersions := Array.append(appVersions, [(appId, versions)]);
        };
    };

    func versionToInfo(v: AppVersion, appId: Text): AppVersionInfo {
        {
            major = v.major;
            minor = v.minor;
            patch = v.patch;
            wasmHash = v.wasmHash;
            wasmUrl = v.wasmUrl;
            sourceUrl = v.sourceUrl;
            releaseNotes = v.releaseNotes;
            releaseDate = v.releaseDate;
            wasmSize = v.wasmSize;
            hasWasm = appVersionWasmsMap.get(makeVersionKey(appId, v.major, v.minor, v.patch)) != null;
        };
    };

    func findVersion(appId: Text, major: Nat, minor: Nat, patch: Nat): ?AppVersion {
        let versions = getVersionsForApp(appId);
        Array.find<AppVersion>(versions, func(v) { v.major == major and v.minor == minor and v.patch == patch });
    };

    func getLatestVersionWithWasm(appId: Text): ?AppVersion {
        let versions = getVersionsForApp(appId);
        for (v in versions.vals()) {
            let key = makeVersionKey(appId, v.major, v.minor, v.patch);
            if (appVersionWasmsMap.get(key) != null) {
                return ?v;
            };
        };
        null;
    };

    // -- Mint Log Helpers --

    func addMintLogEntry(
        canisterId: Principal, minter: Principal,
        appId: Text, numAppId: Nat, pubId: Nat,
        major: Nat, minor: Nat, patch: Nat,
        icpPaidE8s: Nat64, wasPremium: Bool,
        daoCutE8s: Nat64, publisherRevenueE8s: Nat64
    ) {
        let entry: MintLogEntry = {
            index = mintLogNextIndex;
            canisterId = canisterId;
            minter = minter;
            appId = appId;
            numericAppId = numAppId;
            publisherId = pubId;
            versionMajor = major;
            versionMinor = minor;
            versionPatch = patch;
            mintedAt = Time.now();
            icpPaidE8s = icpPaidE8s;
            wasPremium = wasPremium;
            daoCutE8s = daoCutE8s;
            publisherRevenueE8s = publisherRevenueE8s;
        };
        mintLog := Array.append(mintLog, [entry]);
        mintLogIndexMap.put(canisterId, mintLogNextIndex);
        mintLogNextIndex += 1;
    };

    // -- Publisher Helpers --

    func getPublisherById(publisherId: Nat): ?PublisherInfo {
        publisherMap.get(publisherId);
    };

    func isPublisherOwner(caller: Principal, publisherId: Nat): Bool {
        switch (publisherMap.get(publisherId)) {
            case null { false };
            case (?pub) {
                for (owner in pub.owners.vals()) {
                    if (Principal.equal(owner, caller)) { return true };
                };
                false;
            };
        };
    };

    func isPublisherOwnerOrAdmin(caller: Principal, publisherId: Nat): Bool {
        isAdmin(caller) or isPublisherOwner(caller, publisherId);
    };

    func isAppManagerAuthorized(caller: Principal, app: AppInfo): Bool {
        isPublisherOwnerOrAdmin(caller, app.publisherId);
    };

    func getEffectiveDaoCutBps(app: AppInfo): Nat {
        switch (app.daoCutBasisPoints) {
            case (?bps) { bps };
            case null {
                switch (publisherMap.get(app.publisherId)) {
                    case (?pub) { pub.daoCutBasisPoints };
                    case null { 1000 }; // 10% fallback
                };
            };
        };
    };

    func getAppByNumericIdHelper(numericAppId: Nat): ?AppInfo {
        appByNumericId.get(numericAppId);
    };

    // Rebuild the app lookup indexes from the apps array
    func rebuildAppIndexes() {
        appByNumericId := HashMap.HashMap<Nat, AppInfo>(apps.size(), natEqual, natHash);
        appByStringId := HashMap.HashMap<Text, Nat>(apps.size(), Text.equal, Text.hash);
        for (app in apps.vals()) {
            appByNumericId.put(app.numericAppId, app);
            appByStringId.put(app.appId, app.numericAppId);
        };
    };

    // Update app in the apps array and indexes
    func updateAppInStorage(updatedApp: AppInfo) {
        apps := Array.map<AppInfo, AppInfo>(apps, func(a) {
            if (a.numericAppId == updatedApp.numericAppId) { updatedApp } else { a };
        });
        appByNumericId.put(updatedApp.numericAppId, updatedApp);
        appByStringId.put(updatedApp.appId, updatedApp.numericAppId);
    };

    // -- Stats Update Helpers --

    func getOrInitPublisherStats(publisherId: Nat): PublisherStats {
        switch (publisherStatsMap.get(publisherId)) {
            case (?s) { s };
            case null { { publisherId = publisherId; totalRevenueE8s = 0; totalWithdrawnE8s = 0; totalDaoCutE8s = 0; totalMintCount = 0 } };
        };
    };

    func getOrInitAppRevenueStats(numericAppId: Nat, publisherId: Nat): AppRevenueStats {
        switch (appRevenueStatsMap.get(numericAppId)) {
            case (?s) { s };
            case null { { numericAppId = numericAppId; publisherId = publisherId; totalRevenueE8s = 0; totalWithdrawnE8s = 0; totalDaoCutE8s = 0; mintCount = 0 } };
        };
    };

    func updateStatsOnMint(publisherId: Nat, numericAppId: Nat, publisherRevenueE8s: Nat, daoCutE8s: Nat) {
        let ps = getOrInitPublisherStats(publisherId);
        publisherStatsMap.put(publisherId, {
            publisherId = ps.publisherId;
            totalRevenueE8s = ps.totalRevenueE8s + publisherRevenueE8s;
            totalWithdrawnE8s = ps.totalWithdrawnE8s;
            totalDaoCutE8s = ps.totalDaoCutE8s + daoCutE8s;
            totalMintCount = ps.totalMintCount + 1;
        });

        let ars = getOrInitAppRevenueStats(numericAppId, publisherId);
        appRevenueStatsMap.put(numericAppId, {
            numericAppId = ars.numericAppId;
            publisherId = ars.publisherId;
            totalRevenueE8s = ars.totalRevenueE8s + publisherRevenueE8s;
            totalWithdrawnE8s = ars.totalWithdrawnE8s;
            totalDaoCutE8s = ars.totalDaoCutE8s + daoCutE8s;
            mintCount = ars.mintCount + 1;
        });
    };

    func updateStatsOnWithdrawal(publisherId: Nat, numericAppId: ?Nat, amount: Nat) {
        let ps = getOrInitPublisherStats(publisherId);
        publisherStatsMap.put(publisherId, {
            publisherId = ps.publisherId;
            totalRevenueE8s = ps.totalRevenueE8s;
            totalWithdrawnE8s = ps.totalWithdrawnE8s + amount;
            totalDaoCutE8s = ps.totalDaoCutE8s;
            totalMintCount = ps.totalMintCount;
        });
        switch (numericAppId) {
            case (?appId) {
                let ars = getOrInitAppRevenueStats(appId, publisherId);
                appRevenueStatsMap.put(appId, {
                    numericAppId = ars.numericAppId;
                    publisherId = ars.publisherId;
                    totalRevenueE8s = ars.totalRevenueE8s;
                    totalWithdrawnE8s = ars.totalWithdrawnE8s + amount;
                    totalDaoCutE8s = ars.totalDaoCutE8s;
                    mintCount = ars.mintCount;
                });
            };
            case null {};
        };
    };

    // Initialize publisher 0 (Sneed DAO) if it doesn't exist
    func ensurePublisher0Exists() {
        switch (publisherMap.get(0)) {
            case (?_) {}; // already exists
            case null {
                let pub0: PublisherInfo = {
                    publisherId = 0;
                    name = "Sneed DAO";
                    description = "Official Sneed DAO apps";
                    websiteUrl = ?"https://sneed.xyz";
                    logoUrl = null;
                    links = [];
                    owners = admins;
                    verified = true;
                    families = ["sneed-bots"];
                    defaultPaymentAccount = feeDestination;
                    daoCutBasisPoints = 10000; // 100%
                    createdAt = Time.now();
                };
                publisherMap.put(0, pub0);
            };
        };
    };

    // ============================================
    // ADMIN MANAGEMENT
    // ============================================

    func isAdmin(principal: Principal): Bool {
        for (admin in admins.vals()) {
            if (Principal.equal(admin, principal)) {
                return true;
            };
        };
        false;
    };

    func isAdminOrGovernance(principal: Principal): Bool {
        if (isAdmin(principal)) { return true };
        switch (sneedGovernance) {
            case (?gov) { Principal.equal(principal, gov) };
            case null { false };
        };
    };

    public shared ({ caller }) func addAdmin(newAdmin: Principal): async () {
        assert(isAdmin(caller));
        if (not isAdmin(newAdmin)) {
            admins := Array.append(admins, [newAdmin]);
        };
    };

    public shared ({ caller }) func removeAdmin(adminToRemove: Principal): async () {
        assert(isAdmin(caller));
        assert(admins.size() > 1); // Keep at least one admin
        admins := Array.filter<Principal>(admins, func(a) { not Principal.equal(a, adminToRemove) });
    };

    public query func getAdmins(): async [Principal] {
        admins;
    };

    public shared ({ caller }) func setSneedGovernance(governance: ?Principal): async () {
        assert(isAdmin(caller));
        sneedGovernance := governance;
    };

    public query func getSneedGovernance(): async ?Principal {
        sneedGovernance;
    };

    // ============================================
    // PAYMENT CONFIGURATION
    // ============================================

    public shared ({ caller }) func setPaymentConfig(config: T.PaymentConfig): async () {
        assert(isAdminOrGovernance(caller));
        creationFeeE8s := config.creationFeeE8s;
        targetCyclesAmount := config.targetCyclesAmount;
        feeDestination := config.feeDestination;
        paymentRequired := config.paymentRequired;
    };

    public query func getPaymentConfig(): async T.PaymentConfig {
        {
            creationFeeE8s = creationFeeE8s;
            targetCyclesAmount = targetCyclesAmount;
            feeDestination = feeDestination;
            paymentRequired = paymentRequired;
        };
    };

    public shared ({ caller }) func setCreationFee(feeE8s: Nat64): async () {
        assert(isAdminOrGovernance(caller));
        creationFeeE8s := feeE8s;
    };

    public shared ({ caller }) func setTargetCycles(cycles: Nat): async () {
        assert(isAdminOrGovernance(caller));
        targetCyclesAmount := cycles;
    };

    public shared ({ caller }) func setFeeDestination(destination: T.Account): async () {
        assert(isAdminOrGovernance(caller));
        feeDestination := destination;
    };
    
    // Calculate ICP needed to acquire target cycles based on current CMC rate
    // Returns amount in e8s, or 0 if rate unavailable
    public func calculateIcpForCycles(targetCycles: Nat): async Nat64 {
        try {
            let rateResponse = await cmc.get_icp_xdr_conversion_rate();
            let xdrPerIcp = rateResponse.data.xdr_permyriad_per_icp; // XDR per ICP * 10000
            
            // 1 XDR = 1 Trillion cycles (1T)
            // Cycles per ICP = (xdrPerIcp / 10000) * 1_000_000_000_000
            // = xdrPerIcp * 100_000_000 (cycles per ICP)
            let cyclesPerIcp: Nat = Nat64.toNat(xdrPerIcp) * 100_000_000;
            
            if (cyclesPerIcp == 0) {
                return 0;
            };
            
            // ICP needed (in e8s) = targetCycles * 100_000_000 / cyclesPerIcp
            // We add 5% buffer to account for rate fluctuations
            let icpE8sNeeded = (targetCycles * 100_000_000 * 105) / (cyclesPerIcp * 100);
            
            Nat64.fromNat(icpE8sNeeded);
        } catch (_) {
            0; // Return 0 if we can't get the rate
        };
    };
    
    // Query the current conversion rate info
    public func getConversionRate(): async { cyclesPerIcp: Nat; xdrPermyriadPerIcp: Nat64 } {
        let rateResponse = await cmc.get_icp_xdr_conversion_rate();
        let xdrPerIcp = rateResponse.data.xdr_permyriad_per_icp;
        let cyclesPerIcp = Nat64.toNat(xdrPerIcp) * 100_000_000;
        { cyclesPerIcp = cyclesPerIcp; xdrPermyriadPerIcp = xdrPerIcp };
    };

    public shared ({ caller }) func setPaymentRequired(required: Bool): async () {
        assert(isAdminOrGovernance(caller));
        paymentRequired := required;
    };
    
    // ============================================
    // PREMIUM DISCOUNT CONFIGURATION
    // ============================================
    
    // Get the premium creation fee (discounted fee for Sneed Premium members)
    public query func getPremiumCreationFee(): async Nat64 {
        premiumCreationFeeE8s;
    };
    
    // Set the premium creation fee (admin only)
    public shared ({ caller }) func setPremiumCreationFee(feeE8s: Nat64): async () {
        assert(isAdminOrGovernance(caller));
        premiumCreationFeeE8s := feeE8s;
    };
    
    // Get the Sneed Premium canister ID
    public query func getSneedPremiumCanisterId(): async ?Principal {
        sneedPremiumCanisterId;
    };
    
    // Set the Sneed Premium canister ID (admin only)
    public shared ({ caller }) func setSneedPremiumCanisterId(canisterId: ?Principal): async () {
        assert(isAdminOrGovernance(caller));
        sneedPremiumCanisterId := canisterId;
    };

// Not exposed since potentially async call (can't be query) that costs cycles.
/*    
    // Check if a user is a Sneed Premium member (uses cache)
    public func checkUserPremiumStatus(user: Principal): async Bool {
        switch (sneedPremiumCanisterId) {
            case null { false }; // No premium canister configured
            case (?canisterId) {
                await* PremiumClient.isPremium(premiumCache, canisterId, user);
            };
        };
    };
*/

    // Get the cycles allocated to new canisters
    public query func getCanisterCreationCycles(): async Nat {
        canisterCreationCycles;
    };

    // Set the cycles allocated to new canisters (admin only)
    public shared ({ caller }) func setCanisterCreationCycles(cycles: Nat): async () {
        assert(isAdminOrGovernance(caller));
        canisterCreationCycles := cycles;
    };

    // ============================================
    // PUBLISHER MANAGEMENT
    // ============================================

    public query func getPublisher(publisherId: Nat): async ?PublisherInfo {
        publisherMap.get(publisherId);
    };

    public query func getPublishers(): async [PublisherInfo] {
        Iter.toArray(Iter.map<(Nat, PublisherInfo), PublisherInfo>(publisherMap.entries(), func(e) { e.1 }));
    };

    public query func getVerifiedPublishers(): async [PublisherInfo] {
        let buf = Buffer.Buffer<PublisherInfo>(publisherMap.size());
        for ((_, pub) in publisherMap.entries()) {
            if (pub.verified) { buf.add(pub) };
        };
        Buffer.toArray(buf);
    };

    public query func getPublishersByOwner(owner: Principal): async [PublisherInfo] {
        let buf = Buffer.Buffer<PublisherInfo>(4);
        for ((_, pub) in publisherMap.entries()) {
            let isOwner = Array.find<Principal>(pub.owners, func(o) { Principal.equal(o, owner) });
            if (isOwner != null) { buf.add(pub) };
        };
        Buffer.toArray(buf);
    };

    public shared ({ caller }) func createPublisher(input: CreatePublisherInput): async { #Ok: Nat; #Err: Text } {
        if (Principal.isAnonymous(caller)) { return #Err("Anonymous callers cannot create publishers") };
        let id = nextPublisherId;
        nextPublisherId += 1;
        let pub: PublisherInfo = {
            publisherId = id;
            name = input.name;
            description = input.description;
            websiteUrl = input.websiteUrl;
            logoUrl = input.logoUrl;
            links = input.links;
            owners = [caller];
            verified = false;
            families = [];
            defaultPaymentAccount = input.defaultPaymentAccount;
            daoCutBasisPoints = 1000; // 10% default
            createdAt = Time.now();
        };
        publisherMap.put(id, pub);
        #Ok(id);
    };

    public shared ({ caller }) func updatePublisher(publisherId: Nat, input: UpdatePublisherInput): async { #Ok; #Err: Text } {
        switch (publisherMap.get(publisherId)) {
            case null { #Err("Publisher not found") };
            case (?pub) {
                if (not isPublisherOwnerOrAdmin(caller, publisherId)) { return #Err("Not authorized") };
                publisherMap.put(publisherId, {
                    publisherId = pub.publisherId;
                    name = input.name;
                    description = input.description;
                    websiteUrl = input.websiteUrl;
                    logoUrl = input.logoUrl;
                    links = input.links;
                    owners = pub.owners;
                    verified = pub.verified;
                    families = pub.families;
                    defaultPaymentAccount = input.defaultPaymentAccount;
                    daoCutBasisPoints = pub.daoCutBasisPoints;
                    createdAt = pub.createdAt;
                });
                #Ok;
            };
        };
    };

    public shared ({ caller }) func addPublisherOwner(publisherId: Nat, newOwner: Principal): async { #Ok; #Err: Text } {
        switch (publisherMap.get(publisherId)) {
            case null { #Err("Publisher not found") };
            case (?pub) {
                if (not isPublisherOwnerOrAdmin(caller, publisherId)) { return #Err("Not authorized") };
                let already = Array.find<Principal>(pub.owners, func(o) { Principal.equal(o, newOwner) });
                if (already != null) { return #Err("Already an owner") };
                publisherMap.put(publisherId, {
                    publisherId = pub.publisherId;
                    name = pub.name;
                    description = pub.description;
                    websiteUrl = pub.websiteUrl;
                    logoUrl = pub.logoUrl;
                    links = pub.links;
                    owners = Array.append(pub.owners, [newOwner]);
                    verified = pub.verified;
                    families = pub.families;
                    defaultPaymentAccount = pub.defaultPaymentAccount;
                    daoCutBasisPoints = pub.daoCutBasisPoints;
                    createdAt = pub.createdAt;
                });
                #Ok;
            };
        };
    };

    public shared ({ caller }) func removePublisherOwner(publisherId: Nat, ownerToRemove: Principal): async { #Ok; #Err: Text } {
        switch (publisherMap.get(publisherId)) {
            case null { #Err("Publisher not found") };
            case (?pub) {
                if (not isPublisherOwnerOrAdmin(caller, publisherId)) { return #Err("Not authorized") };
                if (pub.owners.size() <= 1) { return #Err("Cannot remove the last owner") };
                let newOwners = Array.filter<Principal>(pub.owners, func(o) { not Principal.equal(o, ownerToRemove) });
                if (newOwners.size() == pub.owners.size()) { return #Err("Principal is not an owner") };
                publisherMap.put(publisherId, {
                    publisherId = pub.publisherId;
                    name = pub.name;
                    description = pub.description;
                    websiteUrl = pub.websiteUrl;
                    logoUrl = pub.logoUrl;
                    links = pub.links;
                    owners = newOwners;
                    verified = pub.verified;
                    families = pub.families;
                    defaultPaymentAccount = pub.defaultPaymentAccount;
                    daoCutBasisPoints = pub.daoCutBasisPoints;
                    createdAt = pub.createdAt;
                });
                #Ok;
            };
        };
    };

    public shared ({ caller }) func addPublisherFamily(publisherId: Nat, family: Text): async { #Ok; #Err: Text } {
        switch (publisherMap.get(publisherId)) {
            case null { #Err("Publisher not found") };
            case (?pub) {
                if (not isPublisherOwnerOrAdmin(caller, publisherId)) { return #Err("Not authorized") };
                let already = Array.find<Text>(pub.families, func(f) { f == family });
                if (already != null) { return #Err("Family already exists") };
                publisherMap.put(publisherId, {
                    publisherId = pub.publisherId;
                    name = pub.name;
                    description = pub.description;
                    websiteUrl = pub.websiteUrl;
                    logoUrl = pub.logoUrl;
                    links = pub.links;
                    owners = pub.owners;
                    verified = pub.verified;
                    families = Array.append(pub.families, [family]);
                    defaultPaymentAccount = pub.defaultPaymentAccount;
                    daoCutBasisPoints = pub.daoCutBasisPoints;
                    createdAt = pub.createdAt;
                });
                #Ok;
            };
        };
    };

    public shared ({ caller }) func removePublisherFamily(publisherId: Nat, family: Text): async { #Ok; #Err: Text } {
        switch (publisherMap.get(publisherId)) {
            case null { #Err("Publisher not found") };
            case (?pub) {
                if (not isPublisherOwnerOrAdmin(caller, publisherId)) { return #Err("Not authorized") };
                let newFamilies = Array.filter<Text>(pub.families, func(f) { f != family });
                publisherMap.put(publisherId, {
                    publisherId = pub.publisherId;
                    name = pub.name;
                    description = pub.description;
                    websiteUrl = pub.websiteUrl;
                    logoUrl = pub.logoUrl;
                    links = pub.links;
                    owners = pub.owners;
                    verified = pub.verified;
                    families = newFamilies;
                    defaultPaymentAccount = pub.defaultPaymentAccount;
                    daoCutBasisPoints = pub.daoCutBasisPoints;
                    createdAt = pub.createdAt;
                });
                // Cascade: remove this family from all of this publisher's apps
                apps := Array.map<AppInfo, AppInfo>(apps, func(a) {
                    if (a.publisherId == publisherId) {
                        let updatedApp = {
                            appId = a.appId; numericAppId = a.numericAppId; publisherId = a.publisherId;
                            name = a.name; description = a.description; iconUrl = a.iconUrl;
                            mintPriceE8s = a.mintPriceE8s; premiumMintPriceE8s = a.premiumMintPriceE8s;
                            viewUrl = a.viewUrl; manageUrl = a.manageUrl; mintUrl = a.mintUrl;
                            families = Array.filter<Text>(a.families, func(f) { f != family });
                            paymentAccount = a.paymentAccount; daoCutBasisPoints = a.daoCutBasisPoints;
                            createdAt = a.createdAt; enabled = a.enabled;
                        };
                        appByNumericId.put(updatedApp.numericAppId, updatedApp);
                        updatedApp;
                    } else { a };
                });
                #Ok;
            };
        };
    };

    // Admin-only publisher mutations
    public shared ({ caller }) func verifyPublisher(publisherId: Nat): async () {
        assert(isAdmin(caller));
        switch (publisherMap.get(publisherId)) {
            case null { assert(false) };
            case (?pub) {
                publisherMap.put(publisherId, {
                    publisherId = pub.publisherId; name = pub.name; description = pub.description;
                    websiteUrl = pub.websiteUrl; logoUrl = pub.logoUrl; links = pub.links;
                    owners = pub.owners; verified = true; families = pub.families;
                    defaultPaymentAccount = pub.defaultPaymentAccount;
                    daoCutBasisPoints = pub.daoCutBasisPoints; createdAt = pub.createdAt;
                });
            };
        };
    };

    public shared ({ caller }) func unverifyPublisher(publisherId: Nat): async () {
        assert(isAdmin(caller));
        switch (publisherMap.get(publisherId)) {
            case null { assert(false) };
            case (?pub) {
                publisherMap.put(publisherId, {
                    publisherId = pub.publisherId; name = pub.name; description = pub.description;
                    websiteUrl = pub.websiteUrl; logoUrl = pub.logoUrl; links = pub.links;
                    owners = pub.owners; verified = false; families = pub.families;
                    defaultPaymentAccount = pub.defaultPaymentAccount;
                    daoCutBasisPoints = pub.daoCutBasisPoints; createdAt = pub.createdAt;
                });
            };
        };
    };

    public shared ({ caller }) func setPublisherDaoCut(publisherId: Nat, basisPoints: Nat): async () {
        assert(isAdmin(caller));
        assert(basisPoints <= 10000);
        switch (publisherMap.get(publisherId)) {
            case null { assert(false) };
            case (?pub) {
                publisherMap.put(publisherId, {
                    publisherId = pub.publisherId; name = pub.name; description = pub.description;
                    websiteUrl = pub.websiteUrl; logoUrl = pub.logoUrl; links = pub.links;
                    owners = pub.owners; verified = pub.verified; families = pub.families;
                    defaultPaymentAccount = pub.defaultPaymentAccount;
                    daoCutBasisPoints = basisPoints; createdAt = pub.createdAt;
                });
            };
        };
    };

    // ============================================
    // MANAGER WASM MANAGEMENT
    // ============================================

    // Upload manager WASM module (admin only)
    // This WASM will be used when creating new manager canisters
    public shared ({ caller }) func setManagerWasm(wasm: Blob): async () {
        assert(isAdminOrGovernance(caller));
        managerWasm := ?wasm;
    };

    // Check if manager WASM is set
    public query func hasManagerWasm(): async Bool {
        switch (managerWasm) {
            case null { false };
            case (?_) { true };
        };
    };

    // Get manager WASM size (for verification)
    public query func getManagerWasmSize(): async Nat {
        switch (managerWasm) {
            case null { 0 };
            case (?wasm) { wasm.size() };
        };
    };

    // Clear manager WASM (admin only)
    public shared ({ caller }) func clearManagerWasm(): async () {
        assert(isAdminOrGovernance(caller));
        managerWasm := null;
    };

    // ============================================
    // VERSION MANAGEMENT
    // ============================================

    // Get the current manager version (set by admin)
    public query func getCurrentVersion(): async T.Version {
        currentVersion;
    };

    // Set the current manager version (admin only)
    // Should be called when uploading a new WASM
    public shared ({ caller }) func setCurrentVersion(version: T.Version): async () {
        assert(isAdminOrGovernance(caller));
        currentVersion := version;
    };

    // ============================================
    // OFFICIAL VERSIONS REGISTRY
    // ============================================

    // Get all official versions (public)
    public query func getOfficialVersions(): async [T.OfficialVersion] {
        officialVersions;
    };

    // Get official version by WASM hash (public)
    public query func getOfficialVersionByHash(wasmHash: Text): async ?T.OfficialVersion {
        let lowerHash = Text.toLowercase(wasmHash);
        for (v in officialVersions.vals()) {
            if (Text.toLowercase(v.wasmHash) == lowerHash) {
                return ?v;
            };
        };
        null;
    };

    // Add a new official version (admin only)
    public shared ({ caller }) func addOfficialVersion(version: T.OfficialVersion): async () {
        assert(isAdmin(caller));
        
        // Check if version with same hash already exists
        let lowerHash = Text.toLowercase(version.wasmHash);
        for (v in officialVersions.vals()) {
            if (Text.toLowercase(v.wasmHash) == lowerHash) {
                // Update existing version
                officialVersions := Array.map<T.OfficialVersion, T.OfficialVersion>(
                    officialVersions,
                    func(ov) {
                        if (Text.toLowercase(ov.wasmHash) == lowerHash) {
                            version;
                        } else {
                            ov;
                        };
                    }
                );
                return;
            };
        };
        
        // Add new version
        officialVersions := Array.append(officialVersions, [version]);
    };

    // Update an official version (admin only)
    public shared ({ caller }) func updateOfficialVersion(wasmHash: Text, version: T.OfficialVersion): async Bool {
        assert(isAdmin(caller));
        
        let lowerHash = Text.toLowercase(wasmHash);
        var found = false;
        officialVersions := Array.map<T.OfficialVersion, T.OfficialVersion>(
            officialVersions,
            func(ov) {
                if (Text.toLowercase(ov.wasmHash) == lowerHash) {
                    found := true;
                    version;
                } else {
                    ov;
                };
            }
        );
        found;
    };

    // Remove an official version (admin only)
    public shared ({ caller }) func removeOfficialVersion(wasmHash: Text): async Bool {
        assert(isAdmin(caller));
        
        let lowerHash = Text.toLowercase(wasmHash);
        let originalSize = officialVersions.size();
        officialVersions := Array.filter<T.OfficialVersion>(
            officialVersions,
            func(ov) { Text.toLowercase(ov.wasmHash) != lowerHash }
        );
        officialVersions.size() < originalSize;
    };

    // Set all official versions at once (admin only, for bulk updates)
    public shared ({ caller }) func setOfficialVersions(versions: [T.OfficialVersion]): async () {
        assert(isAdmin(caller));
        officialVersions := versions;
    };

    // ============================================
    // FACTORY OPERATIONS
    // ============================================

    // Compute subaccount for a user (standard ICRC1 subaccount derivation)
    // The subaccount is: [length_byte, principal_bytes..., 0_padding...]
    func principalToSubaccount(principal: Principal): Blob {
        let principalBytes = Blob.toArray(Principal.toBlob(principal));
        let subaccount = Array.init<Nat8>(32, 0);
        subaccount[0] := Nat8.fromNat(principalBytes.size());
        var i = 0;
        while (i < principalBytes.size() and i < 31) {
            subaccount[i + 1] := principalBytes[i];
            i += 1;
        };
        Blob.fromArray(Array.freeze(subaccount));
    };

    // Encode a Nat as 8-byte big-endian into a mutable array at the given offset
    func encodeNatBigEndian8(arr: [var Nat8], offset: Nat, n: Nat) {
        var val = n;
        var i = 7 : Nat;
        loop {
            arr[offset + i] := Nat8.fromNat(val % 256);
            val := val / 256;
            if (i == 0) { return };
            i -= 1;
        };
    };

    // Subaccount for publisher revenue: [0x50("P"), publisherId:8 bytes BE, zeros:23 bytes]
    func publisherRevenueSubaccount(publisherId: Nat): Blob {
        let sub = Array.init<Nat8>(32, 0);
        sub[0] := 0x50; // "P"
        encodeNatBigEndian8(sub, 1, publisherId);
        Blob.fromArray(Array.freeze(sub));
    };

    // Subaccount for app-specific revenue: [0x41("A"), publisherId:8 bytes BE, appNumericId:8 bytes BE, zeros:15 bytes]
    func appRevenueSubaccount(publisherId: Nat, appNumericId: Nat): Blob {
        let sub = Array.init<Nat8>(32, 0);
        sub[0] := 0x41; // "A"
        encodeNatBigEndian8(sub, 1, publisherId);
        encodeNatBigEndian8(sub, 9, appNumericId);
        Blob.fromArray(Array.freeze(sub));
    };

    // Get the revenue subaccount for an app (app-specific if it has a payment override, otherwise publisher-level)
    func getRevenueSubaccount(app: AppInfo): Blob {
        switch (app.paymentAccount) {
            case (?_) { appRevenueSubaccount(app.publisherId, app.numericAppId) };
            case null { publisherRevenueSubaccount(app.publisherId) };
        };
    };

    // Get the subaccount where user should send payment (unchanged - one per user)
    public query func getPaymentSubaccount(user: Principal): async Blob {
        principalToSubaccount(user);
    };

    // Get balance of user's payment subaccount on this canister
    public func getUserPaymentBalance(user: Principal): async Nat {
        let subaccount = principalToSubaccount(user);
        await ledger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = ?subaccount;
        });
    };

    // Allow user to withdraw their deposited payment
    public shared ({ caller }) func withdrawUserPayment(): async T.TransferResult {
        let subaccount = principalToSubaccount(caller);
        let fee = Nat64.toNat(T.ICP_FEE);
        
        // Get balance in user's subaccount
        let balance = await ledger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = ?subaccount;
        });
        
        // Check if there's anything to withdraw (accounting for fee)
        if (balance <= fee) {
            return #Err(#InsufficientFunds({ balance = balance }));
        };
        
        // Withdraw to caller's main account (balance - fee)
        let withdrawAmount = balance - fee;
        
        await ledger.icrc1_transfer({
            to = { owner = caller; subaccount = null };
            fee = ?fee;
            memo = null;
            from_subaccount = ?subaccount;
            created_at_time = null;
            amount = withdrawAmount;
        });
    };

    // Transfer ICP to CMC and notify to top up this canister with cycles
    func topUpSelfWithCycles(icpAmountE8s: Nat64): async* T.NotifyTopUpResult {
        let selfPrincipal = Principal.fromActor(this);
        let cmcPrincipal = Principal.fromText(T.CMC_CANISTER_ID);
        
        // Compute CMC subaccount for this canister
        let cmcSubaccount = principalToSubaccount(selfPrincipal);
        
        // Transfer ICP to CMC
        let transferResult = await ledger.icrc1_transfer({
            to = { owner = cmcPrincipal; subaccount = ?cmcSubaccount };
            fee = ?Nat64.toNat(T.ICP_FEE);
            memo = ?TOP_UP_MEMO;
            from_subaccount = null;
            created_at_time = null;
            amount = Nat64.toNat(icpAmountE8s);
        });
        
                switch (transferResult) {
            case (#Err(_)) {
                return #Err(#InvalidTransaction("Transfer to CMC failed"));
            };
            case (#Ok(blockIndex)) {
                // Notify CMC to mint cycles
                await cmc.notify_top_up({
                    block_index = Nat64.fromNat(blockIndex);
                    canister_id = selfPrincipal;
                });
            };
        };
    };

    // Create a new neuron manager canister for the caller
    // Users can create multiple managers (one neuron per manager)
    // Payment flow:
    // 1. User sends ICP to their subaccount on this factory
    // 2. User calls createNeuronManager
    // 3. Factory checks balance, calculates ICP for cycles dynamically, processes payment, creates canister
    public shared ({ caller }) func createNeuronManager(): async T.CreateManagerResult {
        // Check cycles
        if (Cycles.balance() < canisterCreationCycles) {
            return #Err(#InsufficientCycles);
        };

        // Track financial metrics for this creation
        var trackedIcpPaidE8s: Nat64 = 0;
        var trackedIcpForCyclesE8s: Nat64 = 0;
        var trackedIcpProfitE8s: Nat64 = 0;
        var trackedIcpTransferFeesE8s: Nat64 = 0;
        var trackedCyclesReceivedFromCmc: Nat = 0;
        let cyclesBalanceBefore = Cycles.balance();

        // Process payment if required
        if (paymentRequired) {
            let userSubaccount = principalToSubaccount(caller);
            
            // Check if user is a Sneed Premium member for discounted pricing
            let isPremiumMember: Bool = switch (sneedPremiumCanisterId) {
                case null { false };
                case (?canisterId) {
                    await* PremiumClient.isPremium(premiumCache, canisterId, caller);
                };
            };
            
            // Determine the applicable fee (premium members get a discount)
            let applicableFeeE8s: Nat64 = if (isPremiumMember) {
                premiumCreationFeeE8s;
            } else {
                creationFeeE8s;
            };
            
            // Check user's balance on their subaccount
            let userBalance = await ledger.icrc1_balance_of({
                owner = Principal.fromActor(this);
                subaccount = ?userSubaccount;
            });
            
            if (userBalance < Nat64.toNat(applicableFeeE8s)) {
                return #Err(#InsufficientPayment({
                    required = applicableFeeE8s;
                    provided = Nat64.fromNat(userBalance);
                }));
            };
            
            // Track: Total ICP paid by user
            trackedIcpPaidE8s := applicableFeeE8s;
            
            // Calculate ICP needed for target cycles based on current CMC rate
            let icpForCyclesE8s = await calculateIcpForCycles(targetCyclesAmount);
            
            // If we couldn't get a rate, use a fallback (0.02 ICP ~ 2T at typical rates)
            let actualIcpForCycles: Nat64 = if (icpForCyclesE8s > 0) {
                icpForCyclesE8s;
            } else {
                2_000_000; // 0.02 ICP fallback
            };
            
            // Track: ICP used for cycles
            trackedIcpForCyclesE8s := actualIcpForCycles;
            
            // Calculate amount for fee destination (total - cycles portion - 2 transfer fees)
            let feeAmount: Nat64 = if (applicableFeeE8s > actualIcpForCycles + T.ICP_FEE * 2) {
                applicableFeeE8s - actualIcpForCycles - T.ICP_FEE * 2;
            } else {
                0;
            };
            
            // Track: Profit (ICP to fee destination)
            trackedIcpProfitE8s := feeAmount;
            
            // Track: Transfer fees (2 transfers)
            trackedIcpTransferFeesE8s := T.ICP_FEE * 2;
            
            // Step 1: Transfer ICP for cycles to factory's main account (for later CMC top-up)
            if (actualIcpForCycles > 0) {
                let cyclesTransfer = await ledger.icrc1_transfer({
                    to = { owner = Principal.fromActor(this); subaccount = null };
                    fee = ?Nat64.toNat(T.ICP_FEE);
                    memo = null;
                    from_subaccount = ?userSubaccount;
                    created_at_time = null;
                    amount = Nat64.toNat(actualIcpForCycles);
                });
                
                switch (cyclesTransfer) {
                    case (#Err(_)) {
                        return #Err(#TransferFailed("Failed to transfer ICP for cycles"));
                    };
                    case (#Ok(_)) {};
                };
            };
            
            // Step 2: Transfer remaining ICP to fee destination
            if (feeAmount > 0) {
                let feeTransfer = await ledger.icrc1_transfer({
                    to = feeDestination;
                    fee = ?Nat64.toNat(T.ICP_FEE);
                    memo = null;
                    from_subaccount = ?userSubaccount;
                    created_at_time = null;
                    amount = Nat64.toNat(feeAmount);
                });
                
                switch (feeTransfer) {
                    case (#Err(_)) {
                        // Log but don't fail - cycles portion already transferred
                        // Note: profit tracking may be inaccurate if this fails
                    };
                    case (#Ok(_)) {};
                };
            };
            
            // Step 3: Top up factory with cycles from the ICP
            if (actualIcpForCycles > 0) {
                let topUpResult = await* topUpSelfWithCycles(actualIcpForCycles);
                switch (topUpResult) {
                    case (#Err(_)) {
                        // Log but don't fail canister creation - we still have cycles from the fee
                    };
                    case (#Ok(cyclesReceived)) {
                        // Track: Cycles received from CMC
                        trackedCyclesReceivedFromCmc := cyclesReceived;
                    };
                };
            };
        };

        // Check that we have a WASM module to install
        let wasm = switch (managerWasm) {
            case null {
                return #Err(#CanisterCreationFailed("No manager WASM uploaded. Admin must upload WASM first."));
            };
            case (?w) { w };
        };

        // Track cycles spent on creation
        let trackedCyclesSpentOnCreation = canisterCreationCycles;

        // Now create the canister using management canister
        try {
            let factoryPrincipal = Principal.fromActor(this);
            
            // Step 1: Create a new empty canister with factory + user as controllers
            // Factory needs to be a controller to install the WASM
            let createResult = await (with cycles = canisterCreationCycles) ic.create_canister({
                settings = ?{
                    controllers = ?[caller, factoryPrincipal];
                    compute_allocation = null;
                    memory_allocation = null;
                    freezing_threshold = null;
                };
            });
            
            let canisterId = createResult.canister_id;

            // Step 2: Install the WASM code (empty Candid args: DIDL\00\00)
            let emptyArgs: Blob = "\44\49\44\4c\00\00"; // DIDL header for empty args
            await ic.install_code({
                mode = #install;
                canister_id = canisterId;
                wasm_module = wasm;
                arg = emptyArgs;
            });
            
            // Step 3: Remove factory from controllers, leaving only the user
            await ic.update_settings({
                canister_id = canisterId;
                settings = {
                    controllers = ?[caller];
                    compute_allocation = null;
                    memory_allocation = null;
                    freezing_threshold = null;
                };
            });

            // Track cycles balance after creation
            let cyclesBalanceAfter = Cycles.balance();

            // Compute the account ID for the new canister
            let accountId = computeAccountId(canisterId, null);

            // Register the manager to the caller's wallet
            let createdAt = Time.now();
            walletAdd(caller, canisterId, "icp-staking-bot");
            
            // Add to creation log
            let logEntry: T.CreationLogEntry = {
                canisterId = canisterId;
                caller = caller;
                createdAt = createdAt;
                index = creationLogNextIndex;
            };
            creationLog := Array.append(creationLog, [logEntry]);
            creationLogNextIndex += 1;
            
            // Add to financial log
            let financialEntry: T.FinancialLogEntry = {
                canisterId = canisterId;
                index = financialLogNextIndex;
                createdAt = createdAt;
                icpPaidE8s = trackedIcpPaidE8s;
                icpForCyclesE8s = trackedIcpForCyclesE8s;
                icpProfitE8s = trackedIcpProfitE8s;
                icpTransferFeesE8s = trackedIcpTransferFeesE8s;
                cyclesReceivedFromCmc = trackedCyclesReceivedFromCmc;
                cyclesSpentOnCreation = trackedCyclesSpentOnCreation;
                cyclesBalanceBefore = cyclesBalanceBefore;
                cyclesBalanceAfter = cyclesBalanceAfter;
            };
            financialLog := Array.append(financialLog, [financialEntry]);
            financialLogNextIndex += 1;
            
            // Update aggregate statistics
            totalIcpPaidE8s += Nat64.toNat(trackedIcpPaidE8s);
            totalIcpForCyclesE8s += Nat64.toNat(trackedIcpForCyclesE8s);
            totalIcpProfitE8s += Nat64.toNat(trackedIcpProfitE8s);
            totalIcpTransferFeesE8s += Nat64.toNat(trackedIcpTransferFeesE8s);
            totalCyclesReceivedFromCmc += trackedCyclesReceivedFromCmc;
            totalCyclesSpentOnCreation += trackedCyclesSpentOnCreation;

            // Bridge: Record in immutable mint log
            let isPremiumMember: Bool = switch (sneedPremiumCanisterId) {
                case null { false };
                case (?premCanisterId) {
                    await* PremiumClient.isPremium(premiumCache, premCanisterId, caller);
                };
            };
            addMintLogEntry(canisterId, caller, "icp-staking-bot", 0, 0, currentVersion.major, currentVersion.minor, currentVersion.patch, trackedIcpPaidE8s, isPremiumMember, trackedIcpProfitE8s, 0);

            #Ok({
                canisterId = canisterId;
                accountId = accountId;
            });
        } catch (e) {
            #Err(#CanisterCreationFailed(Error.message(e)));
        };
    };
    
    // Admin function to manually top up factory with cycles from its ICP balance
    public shared ({ caller }) func adminTopUpCycles(icpAmountE8s: Nat64): async T.NotifyTopUpResult {
        assert(isAdmin(caller));
        await* topUpSelfWithCycles(icpAmountE8s);
    };

    // Get all manager canister IDs registered by the caller (bookmarks)
    // Backward compatible: returns canister IDs from both old and new storage
    public query ({ caller }) func getMyManagers(): async [Principal] {
        walletGetCanisterIds(caller);
    };

    // DEPRECATED: Get manager info by canister ID
    public query func getManagerByCanisterId(_canisterId: Principal): async ?T.ManagerInfo {
        null;
    };

    // Get all manager canister IDs registered by a specific owner
    public query func getManagersByOwner(owner: Principal): async [Principal] {
        walletGetCanisterIds(owner);
    };

    // Get all registrations (admin only) - returns owner -> canister IDs mapping
    public query ({ caller }) func getAllRegistrations(): async [(Principal, [Principal])] {
        assert(isAdmin(caller));
        let buf = Buffer.Buffer<(Principal, [Principal])>(userWalletMap.size());
        for ((owner, entries) in userWalletMap.entries()) {
            let ids = Array.map<UserCanisterEntry, Principal>(entries, func(e) { e.canisterId });
            buf.add((owner, ids));
        };
        Buffer.toArray(buf);
    };

    // Get total number of unique users with registrations
    public query func getRegisteredUserCount(): async Nat {
        userWalletMap.size();
    };
    
    // Get total number of registrations across all users
    public query func getTotalRegistrationCount(): async Nat {
        var count = 0;
        for ((_, list) in userWalletMap.entries()) {
            count += list.size();
        };
        count;
    };
    
    // BACKWARD COMPAT: Alias for getTotalRegistrationCount
    public query func getManagerCount(): async Nat {
        var count = 0;
        for ((_, list) in userWalletMap.entries()) {
            count += list.size();
        };
        count;
    };

    // DEPRECATED: Update neuron ID for a manager
    // With the new bookmark system, we no longer store neuron IDs in the factory
    // The neuron ID should be queried directly from the manager canister
    public shared ({ caller = _caller }) func updateManagerNeuronId(_canisterId: Principal, _neuronId: ?T.NeuronId): async () {
        // No-op - kept for API compatibility during transition
    };

    // ============================================
    // MANAGER REGISTRATION (bookmarks - now backed by userWalletMap)
    // ============================================

    // Register a manager canister to the caller's bookmarks
    // Anyone can register any canister - we don't verify ownership
    public shared ({ caller }) func registerManager(canisterId: Principal): async { #Ok; #Err: Text } {
        walletAdd(caller, canisterId, "");
        #Ok;
    };

    // Deregister a manager canister from the caller's bookmarks
    public shared ({ caller }) func deregisterManager(canisterId: Principal): async { #Ok; #Err: Text } {
        if (walletRemove(caller, canisterId)) {
            #Ok;
        } else {
            #Err("Canister is not in your registered list");
        };
    };

    // Transfer a manager canister registration from the caller to a new owner
    public shared ({ caller }) func transferManager(canisterId: Principal, newOwner: Principal): async { #Ok; #Err: Text } {
        // Find the entry to get its appId
        let entries = walletGetEntries(caller);
        let found = Array.find<UserCanisterEntry>(entries, func(e) { Principal.equal(e.canisterId, canisterId) });
        switch (found) {
            case null {
                #Err("Canister is not in your registered list");
            };
            case (?entry) {
                ignore walletRemove(caller, canisterId);
                walletAdd(newOwner, canisterId, entry.appId);
                #Ok;
            };
        };
    };

    // ============================================
    // "FOR" METHODS (callable by authorized canisters like Sneedex)
    // ============================================
    
    func isAuthorizedForCaller(caller: Principal): Bool {
        authorizedForCallers.get(caller) != null or isAdmin(caller);
    };
    
    public shared ({ caller }) func addAuthorizedForCaller(canisterId: Principal): async () {
        assert(isAdminOrGovernance(caller));
        authorizedForCallers.put(canisterId, true);
    };
    
    public shared ({ caller }) func removeAuthorizedForCaller(canisterId: Principal): async () {
        assert(isAdminOrGovernance(caller));
        authorizedForCallers.delete(canisterId);
    };
    
    public query func getAuthorizedForCallers(): async [Principal] {
        Iter.toArray(authorizedForCallers.keys());
    };
    
    // Register a manager canister to a user's bookmarks (callable by authorized canisters)
    public shared ({ caller }) func registerManagerFor(user: Principal, canisterId: Principal): async { #Ok; #Err: Text } {
        if (not isAuthorizedForCaller(caller)) { return #Err("Not authorized"); };
        if (Principal.isAnonymous(user)) { return #Err("Cannot register for anonymous"); };
        walletAdd(user, canisterId, "");
        #Ok;
    };
    
    // Deregister a manager canister from a user's bookmarks (callable by authorized canisters)
    public shared ({ caller }) func deregisterManagerFor(user: Principal, canisterId: Principal): async { #Ok; #Err: Text } {
        if (not isAuthorizedForCaller(caller)) { return #Err("Not authorized"); };
        if (Principal.isAnonymous(user)) { return #Err("Cannot deregister for anonymous"); };
        ignore walletRemove(user, canisterId);
        #Ok;
    };

    // ============================================
    // MULTI-APP: APP REGISTRY
    // ============================================

    public query func getApps(): async [AppInfo] { apps };

    public query func getApp(appId: Text): async ?AppInfo { getAppById(appId) };

    public query func getAppByNumericId(numericAppId: Nat): async ?AppInfo { appByNumericId.get(numericAppId) };

    public query func getAppsByPublisher(publisherId: Nat): async [AppInfo] {
        Array.filter<AppInfo>(apps, func(a) { a.publisherId == publisherId });
    };

    public query func getAppsByFamily(family: Text): async [AppInfo] {
        Array.filter<AppInfo>(apps, func(a) {
            Array.find<Text>(a.families, func(f) { f == family }) != null;
        });
    };

    // Add a new app (publisher owner or admin)
    public shared ({ caller }) func addApp(publisherId: Nat, input: AddAppInput): async { #Ok: Nat; #Err: Text } {
        if (not isPublisherOwnerOrAdmin(caller, publisherId)) { return #Err("Not authorized") };
        if (getAppById(input.appId) != null) { return #Err("App ID already exists") };
        switch (publisherMap.get(publisherId)) {
            case null { return #Err("Publisher not found") };
            case (?pub) {
                // Validate families are subset of publisher's families
                for (fam in input.families.vals()) {
                    if (Array.find<Text>(pub.families, func(f) { f == fam }) == null) {
                        return #Err("Family '" # fam # "' not in publisher's families");
                    };
                };
            };
        };
        let numId = nextAppId;
        nextAppId += 1;
        let app: AppInfo = {
            appId = input.appId;
            numericAppId = numId;
            publisherId = publisherId;
            name = input.name;
            description = input.description;
            iconUrl = input.iconUrl;
            mintPriceE8s = input.mintPriceE8s;
            premiumMintPriceE8s = input.premiumMintPriceE8s;
            viewUrl = input.viewUrl;
            manageUrl = input.manageUrl;
            mintUrl = input.mintUrl;
            families = input.families;
            paymentAccount = null;
            daoCutBasisPoints = null;
            createdAt = Time.now();
            enabled = false;
        };
        apps := Array.append(apps, [app]);
        appByNumericId.put(numId, app);
        appByStringId.put(input.appId, numId);
        #Ok(numId);
    };

    // Update app info (publisher owner or admin)
    public shared ({ caller }) func updateApp(numericAppId: Nat, input: UpdateAppInput): async { #Ok; #Err: Text } {
        switch (appByNumericId.get(numericAppId)) {
            case null { #Err("App not found") };
            case (?app) {
                if (not isPublisherOwnerOrAdmin(caller, app.publisherId)) { return #Err("Not authorized") };
                // Validate families
                switch (publisherMap.get(app.publisherId)) {
                    case null {};
                    case (?pub) {
                        for (fam in input.families.vals()) {
                            if (Array.find<Text>(pub.families, func(f) { f == fam }) == null) {
                                return #Err("Family '" # fam # "' not in publisher's families");
                            };
                        };
                    };
                };
                let updated: AppInfo = {
                    appId = app.appId;
                    numericAppId = app.numericAppId;
                    publisherId = app.publisherId;
                    name = input.name;
                    description = input.description;
                    iconUrl = input.iconUrl;
                    mintPriceE8s = input.mintPriceE8s;
                    premiumMintPriceE8s = input.premiumMintPriceE8s;
                    viewUrl = input.viewUrl;
                    manageUrl = input.manageUrl;
                    mintUrl = input.mintUrl;
                    families = input.families;
                    paymentAccount = app.paymentAccount;
                    daoCutBasisPoints = app.daoCutBasisPoints;
                    createdAt = app.createdAt;
                    enabled = app.enabled;
                };
                updateAppInStorage(updated);
                #Ok;
            };
        };
    };

    // Remove an app (admin only)
    public shared ({ caller }) func removeApp(numericAppId: Nat): async { #Ok; #Err: Text } {
        assert(isAdmin(caller));
        switch (appByNumericId.get(numericAppId)) {
            case null { #Err("App not found") };
            case (?app) {
                apps := Array.filter<AppInfo>(apps, func(a) { a.numericAppId != numericAppId });
                appByNumericId.delete(numericAppId);
                appByStringId.delete(app.appId);
                #Ok;
            };
        };
    };

    // Enable/disable minting (publisher owner or admin)
    public shared ({ caller }) func setAppEnabled(numericAppId: Nat, enabled: Bool): async { #Ok; #Err: Text } {
        switch (appByNumericId.get(numericAppId)) {
            case null { #Err("App not found") };
            case (?app) {
                if (not isPublisherOwnerOrAdmin(caller, app.publisherId)) { return #Err("Not authorized") };
                updateAppInStorage({
                    appId = app.appId; numericAppId = app.numericAppId; publisherId = app.publisherId;
                    name = app.name; description = app.description; iconUrl = app.iconUrl;
                    mintPriceE8s = app.mintPriceE8s; premiumMintPriceE8s = app.premiumMintPriceE8s;
                    viewUrl = app.viewUrl; manageUrl = app.manageUrl; mintUrl = app.mintUrl;
                    families = app.families; paymentAccount = app.paymentAccount;
                    daoCutBasisPoints = app.daoCutBasisPoints; createdAt = app.createdAt;
                    enabled = enabled;
                });
                #Ok;
            };
        };
    };

    // Set pricing (publisher owner or admin)
    public shared ({ caller }) func setAppPricing(numericAppId: Nat, mintPrice: Nat64, premiumMintPrice: Nat64): async { #Ok; #Err: Text } {
        switch (appByNumericId.get(numericAppId)) {
            case null { #Err("App not found") };
            case (?app) {
                if (not isPublisherOwnerOrAdmin(caller, app.publisherId)) { return #Err("Not authorized") };
                updateAppInStorage({
                    appId = app.appId; numericAppId = app.numericAppId; publisherId = app.publisherId;
                    name = app.name; description = app.description; iconUrl = app.iconUrl;
                    mintPriceE8s = mintPrice; premiumMintPriceE8s = premiumMintPrice;
                    viewUrl = app.viewUrl; manageUrl = app.manageUrl; mintUrl = app.mintUrl;
                    families = app.families; paymentAccount = app.paymentAccount;
                    daoCutBasisPoints = app.daoCutBasisPoints; createdAt = app.createdAt;
                    enabled = app.enabled;
                });
                #Ok;
            };
        };
    };

    // Set app payment account override (publisher owner or admin)
    public shared ({ caller }) func setAppPaymentAccount(numericAppId: Nat, account: ?T.Account): async { #Ok; #Err: Text } {
        switch (appByNumericId.get(numericAppId)) {
            case null { #Err("App not found") };
            case (?app) {
                if (not isPublisherOwnerOrAdmin(caller, app.publisherId)) { return #Err("Not authorized") };
                updateAppInStorage({
                    appId = app.appId; numericAppId = app.numericAppId; publisherId = app.publisherId;
                    name = app.name; description = app.description; iconUrl = app.iconUrl;
                    mintPriceE8s = app.mintPriceE8s; premiumMintPriceE8s = app.premiumMintPriceE8s;
                    viewUrl = app.viewUrl; manageUrl = app.manageUrl; mintUrl = app.mintUrl;
                    families = app.families; paymentAccount = account;
                    daoCutBasisPoints = app.daoCutBasisPoints; createdAt = app.createdAt;
                    enabled = app.enabled;
                });
                #Ok;
            };
        };
    };

    // Set app DAO cut override (admin only)
    public shared ({ caller }) func setAppDaoCut(numericAppId: Nat, basisPoints: ?Nat): async () {
        assert(isAdmin(caller));
        switch (appByNumericId.get(numericAppId)) {
            case null { assert(false) };
            case (?app) {
                switch (basisPoints) {
                    case (?bps) { assert(bps <= 10000) };
                    case null {};
                };
                updateAppInStorage({
                    appId = app.appId; numericAppId = app.numericAppId; publisherId = app.publisherId;
                    name = app.name; description = app.description; iconUrl = app.iconUrl;
                    mintPriceE8s = app.mintPriceE8s; premiumMintPriceE8s = app.premiumMintPriceE8s;
                    viewUrl = app.viewUrl; manageUrl = app.manageUrl; mintUrl = app.mintUrl;
                    families = app.families; paymentAccount = app.paymentAccount;
                    daoCutBasisPoints = basisPoints; createdAt = app.createdAt;
                    enabled = app.enabled;
                });
            };
        };
    };

    // Set app families (publisher owner or admin)
    public shared ({ caller }) func setAppFamilies(numericAppId: Nat, families: [Text]): async { #Ok; #Err: Text } {
        switch (appByNumericId.get(numericAppId)) {
            case null { #Err("App not found") };
            case (?app) {
                if (not isPublisherOwnerOrAdmin(caller, app.publisherId)) { return #Err("Not authorized") };
                switch (publisherMap.get(app.publisherId)) {
                    case null { return #Err("Publisher not found") };
                    case (?pub) {
                        for (fam in families.vals()) {
                            if (Array.find<Text>(pub.families, func(f) { f == fam }) == null) {
                                return #Err("Family '" # fam # "' not in publisher's families");
                            };
                        };
                    };
                };
                updateAppInStorage({
                    appId = app.appId; numericAppId = app.numericAppId; publisherId = app.publisherId;
                    name = app.name; description = app.description; iconUrl = app.iconUrl;
                    mintPriceE8s = app.mintPriceE8s; premiumMintPriceE8s = app.premiumMintPriceE8s;
                    viewUrl = app.viewUrl; manageUrl = app.manageUrl; mintUrl = app.mintUrl;
                    families = families; paymentAccount = app.paymentAccount;
                    daoCutBasisPoints = app.daoCutBasisPoints; createdAt = app.createdAt;
                    enabled = app.enabled;
                });
                #Ok;
            };
        };
    };

    // ============================================
    // MULTI-APP: APP VERSIONS
    // ============================================

    // Get all versions for an app (public, no WASM blobs)
    public query func getAppVersions(appId: Text): async [AppVersionInfo] {
        let versions = getVersionsForApp(appId);
        Array.map<AppVersion, AppVersionInfo>(versions, func(v) { versionToInfo(v, appId) });
    };

    // Get a specific version (public, no WASM blob)
    public query func getAppVersion(appId: Text, major: Nat, minor: Nat, patch: Nat): async ?AppVersionInfo {
        switch (findVersion(appId, major, minor, patch)) {
            case null { null };
            case (?v) { ?versionToInfo(v, appId) };
        };
    };

    // Get the latest version that has a WASM blob (public)
    public query func getLatestAppVersion(appId: Text): async ?AppVersionInfo {
        switch (getLatestVersionWithWasm(appId)) {
            case null { null };
            case (?v) { ?versionToInfo(v, appId) };
        };
    };

    // Check if a version has a WASM blob (public)
    public query func hasAppVersionWasm(appId: Text, major: Nat, minor: Nat, patch: Nat): async Bool {
        appVersionWasmsMap.get(makeVersionKey(appId, major, minor, patch)) != null;
    };

    // Check authorization for app version management via string appId
    func assertAppVersionAuth(caller: Principal, appId: Text) {
        switch (getAppById(appId)) {
            case null { assert(false) };
            case (?app) { assert(isPublisherOwnerOrAdmin(caller, app.publisherId)) };
        };
    };

    // Add a new version (publisher owner or admin) - inserted at the beginning (newest first)
    public shared ({ caller }) func addAppVersion(appId: Text, input: AppVersionInput): async () {
        assertAppVersionAuth(caller, appId);
        let version: AppVersion = {
            major = input.major;
            minor = input.minor;
            patch = input.patch;
            wasmHash = input.wasmHash;
            wasmUrl = input.wasmUrl;
            sourceUrl = input.sourceUrl;
            releaseNotes = input.releaseNotes;
            releaseDate = input.releaseDate;
            wasmSize = 0;
        };
        let existing = getVersionsForApp(appId);
        // Check for duplicate version number
        let dup = Array.find<AppVersion>(existing, func(v) { v.major == input.major and v.minor == input.minor and v.patch == input.patch });
        assert(dup == null);
        // Prepend (newest first)
        setVersionsForApp(appId, Array.append([version], existing));
    };

    // Update version metadata (publisher owner or admin)
    public shared ({ caller }) func updateAppVersion(appId: Text, major: Nat, minor: Nat, patch: Nat, input: AppVersionInput): async () {
        assertAppVersionAuth(caller, appId);
        let versions = getVersionsForApp(appId);
        let key = makeVersionKey(appId, major, minor, patch);
        let currentWasmSize = switch (appVersionWasmsMap.get(key)) {
            case null { 0 };
            case (?blob) { blob.size() };
        };
        setVersionsForApp(appId, Array.map<AppVersion, AppVersion>(versions, func(v) {
            if (v.major == major and v.minor == minor and v.patch == patch) {
                {
                    major = input.major;
                    minor = input.minor;
                    patch = input.patch;
                    wasmHash = input.wasmHash;
                    wasmUrl = input.wasmUrl;
                    sourceUrl = input.sourceUrl;
                    releaseNotes = input.releaseNotes;
                    releaseDate = input.releaseDate;
                    wasmSize = currentWasmSize;
                };
            } else { v };
        }));
    };

    // Remove a version (publisher owner or admin)
    public shared ({ caller }) func removeAppVersion(appId: Text, major: Nat, minor: Nat, patch: Nat): async () {
        assertAppVersionAuth(caller, appId);
        let versions = getVersionsForApp(appId);
        setVersionsForApp(appId, Array.filter<AppVersion>(versions, func(v) {
            not (v.major == major and v.minor == minor and v.patch == patch);
        }));
        // Also remove WASM blob if any
        let key = makeVersionKey(appId, major, minor, patch);
        appVersionWasmsMap.delete(key);
    };

    // Upload WASM blob for a version (publisher owner or admin)
    public shared ({ caller }) func uploadAppVersionWasm(appId: Text, major: Nat, minor: Nat, patch: Nat, wasm: Blob): async () {
        assertAppVersionAuth(caller, appId);
        // Ensure version exists
        assert(findVersion(appId, major, minor, patch) != null);
        let key = makeVersionKey(appId, major, minor, patch);
        appVersionWasmsMap.put(key, wasm);
        // Update wasmSize in version metadata
        let versions = getVersionsForApp(appId);
        setVersionsForApp(appId, Array.map<AppVersion, AppVersion>(versions, func(v) {
            if (v.major == major and v.minor == minor and v.patch == patch) {
                {
                    major = v.major;
                    minor = v.minor;
                    patch = v.patch;
                    wasmHash = v.wasmHash;
                    wasmUrl = v.wasmUrl;
                    sourceUrl = v.sourceUrl;
                    releaseNotes = v.releaseNotes;
                    releaseDate = v.releaseDate;
                    wasmSize = wasm.size();
                };
            } else { v };
        }));
    };

    // Clear WASM blob for a version (publisher owner or admin)
    public shared ({ caller }) func clearAppVersionWasm(appId: Text, major: Nat, minor: Nat, patch: Nat): async () {
        assertAppVersionAuth(caller, appId);
        let key = makeVersionKey(appId, major, minor, patch);
        appVersionWasmsMap.delete(key);
        // Update wasmSize to 0
        let versions = getVersionsForApp(appId);
        setVersionsForApp(appId, Array.map<AppVersion, AppVersion>(versions, func(v) {
            if (v.major == major and v.minor == minor and v.patch == patch) {
                {
                    major = v.major;
                    minor = v.minor;
                    patch = v.patch;
                    wasmHash = v.wasmHash;
                    wasmUrl = v.wasmUrl;
                    sourceUrl = v.sourceUrl;
                    releaseNotes = v.releaseNotes;
                    releaseDate = v.releaseDate;
                    wasmSize = 0;
                };
            } else { v };
        }));
    };

    // ============================================
    // MULTI-APP: IMMUTABLE MINT LOG
    // ============================================

    // Query mint log with filtering and paging (public)
    public query func getMintLog(params: MintLogQuery): async MintLogResult {
        let startIndex = switch (params.startIndex) { case null { 0 }; case (?s) { s } };
        let limit = switch (params.limit) { case null { 50 }; case (?l) { if (l > 100) { 100 } else { l } } };
        
        let filtered = Array.filter<MintLogEntry>(mintLog, func(entry) {
            switch (params.appIdFilter) {
                case (?appId) { if (entry.appId != appId) { return false } };
                case null {};
            };
            switch (params.minterFilter) {
                case (?minter) { if (not Principal.equal(entry.minter, minter)) { return false } };
                case null {};
            };
            switch (params.fromTime) {
                case (?from) { if (entry.mintedAt < from) { return false } };
                case null {};
            };
            switch (params.toTime) {
                case (?to) { if (entry.mintedAt > to) { return false } };
                case null {};
            };
            true;
        });
        
        let totalCount = filtered.size();
        let buf = Buffer.Buffer<MintLogEntry>(limit);
        var idx: Nat = 0;
        var count: Nat = 0;
        for (entry in filtered.vals()) {
            if (idx >= startIndex and count < limit) {
                buf.add(entry);
                count += 1;
            };
            idx += 1;
        };
        
        {
            entries = Buffer.toArray(buf);
            totalCount = totalCount;
            hasMore = (startIndex + count) < totalCount;
        };
    };

    // Get a specific mint log entry by index
    public query func getMintLogEntry(index: Nat): async ?MintLogEntry {
        if (index < mintLog.size()) { ?mintLog[index] } else { null };
    };

    // Lookup a minted canister by canister ID (fast, O(1))
    public query func lookupMintedCanister(canisterId: Principal): async ?MintLogEntry {
        switch (mintLogIndexMap.get(canisterId)) {
            case null { null };
            case (?index) {
                if (index < mintLog.size()) { ?mintLog[index] } else { null };
            };
        };
    };

    // Quick check if a canister was minted by us
    public query func wasMintedByUs(canisterId: Principal): async Bool {
        mintLogIndexMap.get(canisterId) != null;
    };

    // Get total mint log count
    public query func getMintLogCount(): async Nat {
        mintLog.size();
    };

    // Get mint log count for a specific app
    public query func getMintLogCountForApp(appId: Text): async Nat {
        var count = 0;
        for (entry in mintLog.vals()) {
            if (entry.appId == appId) { count += 1 };
        };
        count;
    };

    // ============================================
    // MULTI-APP: ENHANCED USER WALLET
    // ============================================

    // Get caller's full wallet (with app info)
    public query ({ caller }) func getMyWallet(): async [UserCanisterEntry] {
        walletGetEntries(caller);
    };

    // Get caller's wallet filtered by app
    public query ({ caller }) func getMyWalletForApp(appId: Text): async [UserCanisterEntry] {
        Array.filter<UserCanisterEntry>(walletGetEntries(caller), func(e) { e.appId == appId });
    };

    // Register a canister to the caller's wallet with app info
    public shared ({ caller }) func registerCanister(canisterId: Principal, appId: Text): async { #Ok; #Err: Text } {
        walletAdd(caller, canisterId, appId);
        #Ok;
    };

    // Deregister a canister from the caller's wallet
    public shared ({ caller }) func deregisterCanister(canisterId: Principal): async { #Ok; #Err: Text } {
        if (walletRemove(caller, canisterId)) { #Ok } else { #Err("Canister not found in wallet") };
    };

    // Register a canister for another user (authorized callers only)
    public shared ({ caller }) func registerCanisterFor(user: Principal, canisterId: Principal, appId: Text): async { #Ok; #Err: Text } {
        if (not isAuthorizedForCaller(caller)) { return #Err("Not authorized") };
        if (Principal.isAnonymous(user)) { return #Err("Cannot register for anonymous") };
        walletAdd(user, canisterId, appId);
        #Ok;
    };

    // Deregister a canister for another user (authorized callers only)
    public shared ({ caller }) func deregisterCanisterFor(user: Principal, canisterId: Principal): async { #Ok; #Err: Text } {
        if (not isAuthorizedForCaller(caller)) { return #Err("Not authorized") };
        if (Principal.isAnonymous(user)) { return #Err("Cannot deregister for anonymous") };
        ignore walletRemove(user, canisterId);
        #Ok;
    };

    // Get wallet entries for a specific user (admin only)
    public query ({ caller }) func getUserWallet(user: Principal): async [UserCanisterEntry] {
        assert(isAdmin(caller));
        walletGetEntries(user);
    };

    // Get all wallet entries (admin only)
    public query ({ caller }) func getAllWallets(): async [(Principal, [UserCanisterEntry])] {
        assert(isAdmin(caller));
        Iter.toArray(userWalletMap.entries());
    };

    // ============================================
    // MULTI-APP: GENERIC MINTING
    // ============================================

    // Mint a canister for any app
    // If version is null, uses latest version with WASM blob
    public shared ({ caller }) func mintCanister(
        appId: Text,
        versionMajor: ?Nat,
        versionMinor: ?Nat,
        versionPatch: ?Nat
    ): async MintResult {
        // 1. Validate app and publisher
        let app = switch (getAppById(appId)) {
            case null { return #Err(#AppNotFound) };
            case (?a) { a };
        };
        if (not app.enabled) { return #Err(#AppDisabled) };
        let publisher = switch (publisherMap.get(app.publisherId)) {
            case null { return #Err(#PublisherNotFound) };
            case (?p) { p };
        };

        // 2. Resolve version
        let version = switch (versionMajor, versionMinor, versionPatch) {
            case (?maj, ?min, ?pat) {
                switch (findVersion(appId, maj, min, pat)) {
                    case null { return #Err(#VersionNotFound) };
                    case (?v) { v };
                };
            };
            case _ {
                switch (getLatestVersionWithWasm(appId)) {
                    case null { return #Err(#NoWasmForVersion) };
                    case (?v) { v };
                };
            };
        };

        // 3. Get WASM blob
        let wasmKey = makeVersionKey(appId, version.major, version.minor, version.patch);
        let wasm = switch (appVersionWasmsMap.get(wasmKey)) {
            case null { return #Err(#NoWasmForVersion) };
            case (?w) { w };
        };

        // 4. Check cycles
        if (Cycles.balance() < canisterCreationCycles) {
            return #Err(#InsufficientCycles);
        };

        // Track financial metrics
        var trackedIcpPaidE8s: Nat64 = 0;
        var trackedIcpForCyclesE8s: Nat64 = 0;
        var trackedIcpProfitE8s: Nat64 = 0;
        var trackedIcpTransferFeesE8s: Nat64 = 0;
        var trackedCyclesReceivedFromCmc: Nat = 0;
        var trackedDaoCutE8s: Nat64 = 0;
        var trackedPublisherRevenueE8s: Nat64 = 0;
        let cyclesBalanceBefore = Cycles.balance();
        var wasPremium = false;

        // 5. Process payment
        if (paymentRequired) {
            let userSubaccount = principalToSubaccount(caller);
            
            let isPremiumMember: Bool = switch (sneedPremiumCanisterId) {
                case null { false };
                case (?premCanisterId) {
                    await* PremiumClient.isPremium(premiumCache, premCanisterId, caller);
                };
            };
            wasPremium := isPremiumMember;
            
            let applicableFeeE8s: Nat64 = if (isPremiumMember) {
                app.premiumMintPriceE8s;
            } else {
                app.mintPriceE8s;
            };
            
            let userBalance = await ledger.icrc1_balance_of({
                owner = Principal.fromActor(this);
                subaccount = ?userSubaccount;
            });
            
            if (userBalance < Nat64.toNat(applicableFeeE8s)) {
                return #Err(#InsufficientPayment({
                    required = applicableFeeE8s;
                    provided = Nat64.fromNat(userBalance);
                }));
            };
            
            trackedIcpPaidE8s := applicableFeeE8s;
            
            let icpForCycles = await calculateIcpForCycles(targetCyclesAmount);
            let actualIcpForCycles: Nat64 = if (icpForCycles > 0) { icpForCycles } else { 2_000_000 };
            trackedIcpForCyclesE8s := actualIcpForCycles;

            let isSneedDao = app.publisherId == 0;
            // Publisher 0: 2 transfers (cycles + profit to feeDestination)
            // Others: 3 transfers (cycles + DAO cut + publisher share)
            let numTransfers: Nat64 = if (isSneedDao) { 2 } else { 3 };
            let totalTransferFees = T.ICP_FEE * numTransfers;

            let profit: Nat64 = if (applicableFeeE8s > actualIcpForCycles + totalTransferFees) {
                applicableFeeE8s - actualIcpForCycles - totalTransferFees;
            } else { 0 };
            trackedIcpTransferFeesE8s := totalTransferFees;
            
            // Transfer ICP for cycles to factory's main account
            if (actualIcpForCycles > 0) {
                let cyclesTransfer = await ledger.icrc1_transfer({
                    to = { owner = Principal.fromActor(this); subaccount = null };
                    fee = ?Nat64.toNat(T.ICP_FEE);
                    memo = null;
                    from_subaccount = ?userSubaccount;
                    created_at_time = null;
                    amount = Nat64.toNat(actualIcpForCycles);
                });
                switch (cyclesTransfer) {
                    case (#Err(_)) { return #Err(#TransferFailed("Failed to transfer ICP for cycles")) };
                    case (#Ok(_)) {};
                };
            };

            if (isSneedDao) {
                // Publisher 0: all profit goes to feeDestination
                trackedIcpProfitE8s := profit;
                trackedDaoCutE8s := profit;
                trackedPublisherRevenueE8s := 0;
                if (profit > 0) {
                    let feeTransfer = await ledger.icrc1_transfer({
                        to = feeDestination;
                        fee = ?Nat64.toNat(T.ICP_FEE);
                        memo = null;
                        from_subaccount = ?userSubaccount;
                        created_at_time = null;
                        amount = Nat64.toNat(profit);
                    });
                    switch (feeTransfer) {
                        case (#Err(_)) {};
                        case (#Ok(_)) {};
                    };
                };
            } else {
                // Non-DAO publisher: split profit between DAO cut and publisher share
                let effectiveCutBps = getEffectiveDaoCutBps(app);
                let daoCut: Nat64 = Nat64.fromNat((Nat64.toNat(profit) * effectiveCutBps) / 10000);
                let publisherShare: Nat64 = profit - daoCut;
                
                trackedIcpProfitE8s := profit;
                trackedDaoCutE8s := daoCut;
                trackedPublisherRevenueE8s := publisherShare;

                // Transfer DAO cut to feeDestination
                if (daoCut > 0) {
                    let daoCutTransfer = await ledger.icrc1_transfer({
                        to = feeDestination;
                        fee = ?Nat64.toNat(T.ICP_FEE);
                        memo = null;
                        from_subaccount = ?userSubaccount;
                        created_at_time = null;
                        amount = Nat64.toNat(daoCut);
                    });
                    switch (daoCutTransfer) {
                        case (#Err(_)) {};
                        case (#Ok(_)) {};
                    };
                };

                // Transfer publisher share to revenue subaccount
                if (publisherShare > 0) {
                    let revSubaccount = getRevenueSubaccount(app);
                    let pubTransfer = await ledger.icrc1_transfer({
                        to = { owner = Principal.fromActor(this); subaccount = ?revSubaccount };
                        fee = ?Nat64.toNat(T.ICP_FEE);
                        memo = null;
                        from_subaccount = ?userSubaccount;
                        created_at_time = null;
                        amount = Nat64.toNat(publisherShare);
                    });
                    switch (pubTransfer) {
                        case (#Err(_)) {};
                        case (#Ok(_)) {};
                    };
                };
            };
            
            // Top up factory with cycles
            if (actualIcpForCycles > 0) {
                let topUpResult = await* topUpSelfWithCycles(actualIcpForCycles);
                switch (topUpResult) {
                    case (#Err(_)) {};
                    case (#Ok(cyclesReceived)) {
                        trackedCyclesReceivedFromCmc := cyclesReceived;
                    };
                };
            };
        };

        // 6. Create canister
        try {
            let factoryPrincipal = Principal.fromActor(this);
            
            let createResult = await (with cycles = canisterCreationCycles) ic.create_canister({
                settings = ?{
                    controllers = ?[caller, factoryPrincipal];
                    compute_allocation = null;
                    memory_allocation = null;
                    freezing_threshold = null;
                };
            });
            
            let newCanisterId = createResult.canister_id;

            let emptyArgs: Blob = "\44\49\44\4c\00\00";
            await ic.install_code({
                mode = #install;
                canister_id = newCanisterId;
                wasm_module = wasm;
                arg = emptyArgs;
            });
            
            await ic.update_settings({
                canister_id = newCanisterId;
                settings = {
                    controllers = ?[caller];
                    compute_allocation = null;
                    memory_allocation = null;
                    freezing_threshold = null;
                };
            });

            let cyclesBalanceAfter = Cycles.balance();
            let accountId = computeAccountId(newCanisterId, null);

            // Record in wallet
            walletAdd(caller, newCanisterId, appId);

            // Record in immutable mint log
            addMintLogEntry(newCanisterId, caller, appId, app.numericAppId, app.publisherId, version.major, version.minor, version.patch, trackedIcpPaidE8s, wasPremium, trackedDaoCutE8s, trackedPublisherRevenueE8s);

            // Record in old creation log (backward compat)
            let createdAt = Time.now();
            let logEntry: T.CreationLogEntry = {
                canisterId = newCanisterId;
                caller = caller;
                createdAt = createdAt;
                index = creationLogNextIndex;
            };
            creationLog := Array.append(creationLog, [logEntry]);
            creationLogNextIndex += 1;
            
            let financialEntry: T.FinancialLogEntry = {
                canisterId = newCanisterId;
                index = financialLogNextIndex;
                createdAt = createdAt;
                icpPaidE8s = trackedIcpPaidE8s;
                icpForCyclesE8s = trackedIcpForCyclesE8s;
                icpProfitE8s = trackedIcpProfitE8s;
                icpTransferFeesE8s = trackedIcpTransferFeesE8s;
                cyclesReceivedFromCmc = trackedCyclesReceivedFromCmc;
                cyclesSpentOnCreation = canisterCreationCycles;
                cyclesBalanceBefore = cyclesBalanceBefore;
                cyclesBalanceAfter = cyclesBalanceAfter;
            };
            financialLog := Array.append(financialLog, [financialEntry]);
            financialLogNextIndex += 1;
            
            // Update aggregate statistics
            totalIcpPaidE8s += Nat64.toNat(trackedIcpPaidE8s);
            totalIcpForCyclesE8s += Nat64.toNat(trackedIcpForCyclesE8s);
            totalIcpProfitE8s += Nat64.toNat(trackedIcpProfitE8s);
            totalIcpTransferFeesE8s += Nat64.toNat(trackedIcpTransferFeesE8s);
            totalCyclesReceivedFromCmc += trackedCyclesReceivedFromCmc;
            totalCyclesSpentOnCreation += canisterCreationCycles;

            // Update publisher/app revenue stats
            if (app.publisherId == 0) {
                totalDirectRevenueE8s += Nat64.toNat(trackedDaoCutE8s);
            } else {
                totalDaoCutReceivedE8s += Nat64.toNat(trackedDaoCutE8s);
            };
            updateStatsOnMint(app.publisherId, app.numericAppId, Nat64.toNat(trackedPublisherRevenueE8s), Nat64.toNat(trackedDaoCutE8s));

            #Ok({
                canisterId = newCanisterId;
                accountId = accountId;
            });
        } catch (e) {
            #Err(#CanisterCreationFailed(Error.message(e)));
        };
    };

    // Get pricing info for an app (convenience method)
    public func getAppMintPrice(appId: Text, user: Principal): async { regular: Nat64; premium: Nat64; applicable: Nat64; isPremium: Bool } {
        let app = switch (getAppById(appId)) {
            case null { return { regular = 0: Nat64; premium = 0: Nat64; applicable = 0: Nat64; isPremium = false } };
            case (?a) { a };
        };
        let isPremiumMember: Bool = switch (sneedPremiumCanisterId) {
            case null { false };
            case (?canisterId) {
                await* PremiumClient.isPremium(premiumCache, canisterId, user);
            };
        };
        {
            regular = app.mintPriceE8s;
            premium = app.premiumMintPriceE8s;
            applicable = if (isPremiumMember) { app.premiumMintPriceE8s } else { app.mintPriceE8s };
            isPremium = isPremiumMember;
        };
    };

    // ============================================
    // PUBLISHER REVENUE & WITHDRAWAL
    // ============================================

    public func getPublisherRevenueBalance(publisherId: Nat): async Nat {
        let sub = publisherRevenueSubaccount(publisherId);
        await ledger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = ?sub;
        });
    };

    public func getAppRevenueBalance(publisherId: Nat, numericAppId: Nat): async Nat {
        let sub = appRevenueSubaccount(publisherId, numericAppId);
        await ledger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = ?sub;
        });
    };

    public query func getPublisherRevenueSubaccount(publisherId: Nat): async Blob {
        publisherRevenueSubaccount(publisherId);
    };

    public query func getAppRevenueSubaccount(publisherId: Nat, numericAppId: Nat): async Blob {
        appRevenueSubaccount(publisherId, numericAppId);
    };

    public query func getEffectiveDaoCutForApp(appId: Text): async Nat {
        switch (getAppById(appId)) {
            case null { 1000 };
            case (?app) { getEffectiveDaoCutBps(app) };
        };
    };

    // Withdraw publisher revenue to publisher's defaultPaymentAccount
    public shared ({ caller }) func withdrawPublisherFunds(publisherId: Nat): async { #Ok: Nat; #Err: Text } {
        if (not isPublisherOwner(caller, publisherId)) { return #Err("Not authorized") };
        let publisher = switch (publisherMap.get(publisherId)) {
            case null { return #Err("Publisher not found") };
            case (?p) { p };
        };
        let sub = publisherRevenueSubaccount(publisherId);
        let fee = Nat64.toNat(T.ICP_FEE);
        let balance = await ledger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = ?sub;
        });
        if (balance <= fee) { return #Err("Insufficient balance to cover transfer fee") };
        let withdrawAmount = balance - fee;
        let result = await ledger.icrc1_transfer({
            to = publisher.defaultPaymentAccount;
            fee = ?fee;
            memo = null;
            from_subaccount = ?sub;
            created_at_time = null;
            amount = withdrawAmount;
        });
        switch (result) {
            case (#Err(_)) { #Err("Transfer failed") };
            case (#Ok(_)) {
                updateStatsOnWithdrawal(publisherId, null, withdrawAmount);
                #Ok(withdrawAmount);
            };
        };
    };

    // Withdraw app-specific revenue to app's paymentAccount
    public shared ({ caller }) func withdrawAppFunds(publisherId: Nat, numericAppId: Nat): async { #Ok: Nat; #Err: Text } {
        if (not isPublisherOwner(caller, publisherId)) { return #Err("Not authorized") };
        let app = switch (appByNumericId.get(numericAppId)) {
            case null { return #Err("App not found") };
            case (?a) { a };
        };
        if (app.publisherId != publisherId) { return #Err("App does not belong to this publisher") };
        let dest = switch (app.paymentAccount) {
            case null { return #Err("App has no payment account override; use withdrawPublisherFunds") };
            case (?account) { account };
        };
        let sub = appRevenueSubaccount(publisherId, numericAppId);
        let fee = Nat64.toNat(T.ICP_FEE);
        let balance = await ledger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = ?sub;
        });
        if (balance <= fee) { return #Err("Insufficient balance to cover transfer fee") };
        let withdrawAmount = balance - fee;
        let result = await ledger.icrc1_transfer({
            to = dest;
            fee = ?fee;
            memo = null;
            from_subaccount = ?sub;
            created_at_time = null;
            amount = withdrawAmount;
        });
        switch (result) {
            case (#Err(_)) { #Err("Transfer failed") };
            case (#Ok(_)) {
                updateStatsOnWithdrawal(publisherId, ?numericAppId, withdrawAmount);
                #Ok(withdrawAmount);
            };
        };
    };

    // ============================================
    // CREATION LOG (Admin audit trail)
    // ============================================

    // Query creation log with filtering and paging (admin only)
    public query ({ caller }) func getCreationLog(params: T.CreationLogQuery): async T.CreationLogResult {
        assert(isAdmin(caller));
        
        let startIndex = switch (params.startIndex) { case null { 0 }; case (?s) { s } };
        let limit = switch (params.limit) { case null { 50 }; case (?l) { if (l > 500) { 500 } else { l } } };
        
        // Filter entries
        let filtered = Array.filter<T.CreationLogEntry>(creationLog, func(entry) {
            // Filter by caller
            switch (params.callerFilter) {
                case (?filterCaller) {
                    if (not Principal.equal(entry.caller, filterCaller)) {
                        return false;
                    };
                };
                case null {};
            };
            
            // Filter by canister
            switch (params.canisterFilter) {
                case (?filterCanister) {
                    if (not Principal.equal(entry.canisterId, filterCanister)) {
                        return false;
                    };
                };
                case null {};
            };
            
            // Filter by time range
            switch (params.fromTime) {
                case (?from) {
                    if (entry.createdAt < from) {
                        return false;
                    };
                };
                case null {};
            };
            
            switch (params.toTime) {
                case (?to) {
                    if (entry.createdAt > to) {
                        return false;
                    };
                };
                case null {};
            };
            
            true;
        });
        
        let totalCount = filtered.size();
        
        // Apply paging (skip to startIndex, take limit)
        let buf = Buffer.Buffer<T.CreationLogEntry>(limit);
        var idx: Nat = 0;
        var count: Nat = 0;
        
        for (entry in filtered.vals()) {
            if (idx >= startIndex and count < limit) {
                buf.add(entry);
                count += 1;
            };
            idx += 1;
        };
        
        {
            entries = Buffer.toArray(buf);
            totalCount = totalCount;
            hasMore = (startIndex + count) < totalCount;
        };
    };

    // Get total count of creation log entries (admin only)
    public query ({ caller }) func getCreationLogCount(): async Nat {
        assert(isAdmin(caller));
        creationLog.size();
    };

    // Get recent creations (convenience method, admin only)
    public query ({ caller }) func getRecentCreations(limit: Nat): async [T.CreationLogEntry] {
        assert(isAdmin(caller));
        let safeLimit = if (limit > 100) { 100 } else { limit };
        let size = creationLog.size();
        
        if (size <= safeLimit) {
            // Return all in reverse order (most recent first)
            Array.tabulate<T.CreationLogEntry>(size, func(i) {
                creationLog[size - 1 - i];
            });
        } else {
            // Return last `safeLimit` entries in reverse order
            Array.tabulate<T.CreationLogEntry>(safeLimit, func(i) {
                creationLog[size - 1 - i];
            });
        };
    };

    // ============================================
    // FINANCIAL LOG QUERIES (admin only)
    // ============================================

    // Query financial log with filtering and paging (admin only)
    public query ({ caller }) func getFinancialLog(params: T.FinancialLogQuery): async T.FinancialLogResult {
        assert(isAdmin(caller));
        
        let startIndex = switch (params.startIndex) {
            case (?idx) { idx };
            case null { 0 };
        };
        
        let limit = switch (params.limit) {
            case (?l) { if (l > 100) { 100 } else { l } };
            case null { 50 };
        };
        
        // Apply filters
        let filtered = Array.filter<T.FinancialLogEntry>(financialLog, func(entry) {
            // Filter by canister
            switch (params.canisterFilter) {
                case (?canister) {
                    if (entry.canisterId != canister) {
                        return false;
                    };
                };
                case null {};
            };
            
            // Filter by time range
            switch (params.fromTime) {
                case (?from) {
                    if (entry.createdAt < from) {
                        return false;
                    };
                };
                case null {};
            };
            
            switch (params.toTime) {
                case (?to) {
                    if (entry.createdAt > to) {
                        return false;
                    };
                };
                case null {};
            };
            
            true;
        });
        
        let totalCount = filtered.size();
        
        // Apply paging
        let buf = Buffer.Buffer<T.FinancialLogEntry>(limit);
        var idx: Nat = 0;
        var count: Nat = 0;
        
        for (entry in filtered.vals()) {
            if (idx >= startIndex and count < limit) {
                buf.add(entry);
                count += 1;
            };
            idx += 1;
        };
        
        {
            entries = Buffer.toArray(buf);
            totalCount = totalCount;
            hasMore = (startIndex + count) < totalCount;
        };
    };

    // Get merged log (combines creation and financial logs) - admin only
    // Supports full filtering like getCreationLog
    public query ({ caller }) func getMergedLog(params: T.MergedLogQuery): async T.MergedLogResult {
        assert(isAdmin(caller));
        
        let startIndex = switch (params.startIndex) {
            case (?idx) { idx };
            case null { 0 };
        };
        
        let limit = switch (params.limit) {
            case (?l) { if (l > 100) { 100 } else { l } };
            case null { 50 };
        };
        
        // First, filter the creation log entries
        let filtered = Array.filter<T.CreationLogEntry>(creationLog, func(entry) {
            // Filter by caller
            switch (params.callerFilter) {
                case (?callerFilter) {
                    if (entry.caller != callerFilter) {
                        return false;
                    };
                };
                case null {};
            };
            
            // Filter by canister
            switch (params.canisterFilter) {
                case (?canister) {
                    if (entry.canisterId != canister) {
                        return false;
                    };
                };
                case null {};
            };
            
            // Filter by time range
            switch (params.fromTime) {
                case (?from) {
                    if (entry.createdAt < from) {
                        return false;
                    };
                };
                case null {};
            };
            
            switch (params.toTime) {
                case (?to) {
                    if (entry.createdAt > to) {
                        return false;
                    };
                };
                case null {};
            };
            
            true;
        });
        
        let totalCount = filtered.size();
        
        // Build merged entries with paging
        let buf = Buffer.Buffer<T.MergedLogEntry>(limit);
        var idx: Nat = 0;
        var count: Nat = 0;
        
        for (creationEntry in filtered.vals()) {
            if (idx >= startIndex and count < limit) {
                // Find matching financial entry by canisterId
                var financialData: ?{
                    icpPaidE8s: Nat64;
                    icpForCyclesE8s: Nat64;
                    icpProfitE8s: Nat64;
                    icpTransferFeesE8s: Nat64;
                    cyclesReceivedFromCmc: Nat;
                    cyclesSpentOnCreation: Nat;
                    cyclesBalanceBefore: Nat;
                    cyclesBalanceAfter: Nat;
                } = null;
                
                for (finEntry in financialLog.vals()) {
                    if (finEntry.canisterId == creationEntry.canisterId) {
                        financialData := ?{
                            icpPaidE8s = finEntry.icpPaidE8s;
                            icpForCyclesE8s = finEntry.icpForCyclesE8s;
                            icpProfitE8s = finEntry.icpProfitE8s;
                            icpTransferFeesE8s = finEntry.icpTransferFeesE8s;
                            cyclesReceivedFromCmc = finEntry.cyclesReceivedFromCmc;
                            cyclesSpentOnCreation = finEntry.cyclesSpentOnCreation;
                            cyclesBalanceBefore = finEntry.cyclesBalanceBefore;
                            cyclesBalanceAfter = finEntry.cyclesBalanceAfter;
                        };
                    };
                };
                
                buf.add({
                    canisterId = creationEntry.canisterId;
                    caller = creationEntry.caller;
                    createdAt = creationEntry.createdAt;
                    index = creationEntry.index;
                    financialData = financialData;
                });
                count += 1;
            };
            idx += 1;
        };
        
        {
            entries = Buffer.toArray(buf);
            totalCount = totalCount;
            hasMore = (startIndex + count) < totalCount;
        };
    };

    // Get factory aggregate statistics (admin only)
    public query ({ caller }) func getFactoryAggregates(): async T.FactoryAggregates {
        assert(isAdmin(caller));
        {
            totalCanistersCreated = creationLog.size();
            totalIcpPaidE8s = totalIcpPaidE8s;
            totalIcpForCyclesE8s = totalIcpForCyclesE8s;
            totalIcpProfitE8s = totalIcpProfitE8s;
            totalIcpTransferFeesE8s = totalIcpTransferFeesE8s;
            totalCyclesReceivedFromCmc = totalCyclesReceivedFromCmc;
            totalCyclesSpentOnCreation = totalCyclesSpentOnCreation;
        };
    };

    // Get financial log count (admin only)
    public query ({ caller }) func getFinancialLogCount(): async Nat {
        assert(isAdmin(caller));
        financialLog.size();
    };

    // ============================================
    // REVENUE STATS
    // ============================================

    public query func getPublisherStats(publisherId: Nat): async ?PublisherStats {
        publisherStatsMap.get(publisherId);
    };

    public query func getAllPublisherStats(): async [PublisherStats] {
        Iter.toArray(Iter.map<(Nat, PublisherStats), PublisherStats>(publisherStatsMap.entries(), func(e) { e.1 }));
    };

    public query func getAppRevenueStats(numericAppId: Nat): async ?AppRevenueStats {
        appRevenueStatsMap.get(numericAppId);
    };

    public query func getDaoRevenueStats(): async DaoRevenueStats {
        {
            totalDaoCutReceivedE8s = totalDaoCutReceivedE8s;
            totalDirectRevenueE8s = totalDirectRevenueE8s;
            totalRevenueE8s = totalDaoCutReceivedE8s + totalDirectRevenueE8s;
        };
    };

    // ============================================
    // ADMIN: REGISTER CANISTERS FOR USERS
    // ============================================

    // Register a canister in a user's wallet (admin only, for migration)
    public shared ({ caller }) func adminRegisterCanister(user: Principal, canisterId: Principal, appId: Text) : async () {
        assert(isAdmin(caller));
        walletAdd(user, canisterId, appId);
    };

    // Bulk register canisters for users (admin only, for migration)
    public shared ({ caller }) func adminBulkRegisterCanisters(entries: [(Principal, Principal, Text)]) : async Nat {
        assert(isAdmin(caller));
        var count: Nat = 0;
        for ((user, canisterId, appId) in entries.vals()) {
            walletAdd(user, canisterId, appId);
            count += 1;
        };
        count;
    };

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    // Get this canister's principal
    public query func getCanisterId(): async Principal {
        Principal.fromActor(this);
    };

    // Get cycles balance
    public query func getCyclesBalance(): async Nat {
        Cycles.balance();
    };
    
    // Get ICP balance of this canister's main account
    public func getIcpBalance(): async Nat {
        await ledger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = null;
        });
    };
    
    // Admin: Withdraw ICP from factory's main account
    public shared ({ caller }) func adminWithdrawIcp(amount: Nat64, to: T.Account): async T.TransferResult {
        assert(isAdmin(caller));
        await ledger.icrc1_transfer({
            to = to;
            fee = ?Nat64.toNat(T.ICP_FEE);
            memo = null;
            from_subaccount = null;
            created_at_time = null;
            amount = Nat64.toNat(amount);
        });
    };

    // Compute account identifier
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

    // SHA-224 implementation
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

    func sha224(data: [Nat8]): [Nat8] {
        let paddedData = padMessage(data);
        var h = Array.thaw<Nat32>(SHA224_H);
        
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
        
        // SHA-224 returns first 28 bytes (7 words)
        let result = Buffer.Buffer<Nat8>(28);
        var wordIdx = 0;
        while (wordIdx < 7) {
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
};

