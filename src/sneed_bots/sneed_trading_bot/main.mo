import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Float "mo:base/Float";
import Time "mo:base/Time";
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Text "mo:base/Text";
import Debug "mo:base/Debug";
import Error "mo:base/Error";

import T "Types";
import BotkeyPermissions "../BotkeyPermissions";
import BotChoreTypes "../BotChoreTypes";
import BotChoreEngine "../BotChoreEngine";
import BotLogTypes "../BotLogTypes";
import BotLogEngine "../BotLogEngine";
import DistributionTypes "../DistributionTypes";

/// Sneed Trading Bot — autonomous token trading canister.
///
/// Reuses shared infrastructure: Botkeys, Bot Chores, Botlog.
/// Supports: Trade Chore, Rebalance Chore, Move Funds Chore, Distribute Funds Chore.
shared (deployer) persistent actor class TradingBotCanister() = this {

    // ============================================
    // STATE — Individual stable vars (no config records)
    // ============================================

    var createdAt: Int = Time.now();

    transient let currentVersion: T.Version = T.CURRENT_VERSION;

    // Hotkey permissions: Principal -> [numeric permission IDs]
    var hotkeyPermissions: [(Principal, [Nat])] = [];

    // Token Registry
    var tokenRegistry: [T.TokenRegistryEntry] = [];

    // Named Subaccounts
    var namedSubaccounts: [(Nat, Text)] = [];
    var nextSubaccountNumber: Nat = 1;

    // DEX Settings
    var enabledDexes: [Nat] = [0, 1]; // ICPSwap and KongSwap
    var defaultSlippageBps: Nat = 100; // 1%
    var defaultMaxPriceImpactBps: Nat = 300; // 3%
    var icpswapPoolCache: [(Text, Principal)] = [];

    // Bot Chores: stable state for the chore system
    var choreConfigs: [(Text, BotChoreTypes.ChoreConfig)] = [];
    var choreStates: [(Text, BotChoreTypes.ChoreRuntimeState)] = [];
    var choreInstances: [(Text, BotChoreTypes.ChoreInstanceInfo)] = [];

    // Trade Chore: per-instance action lists
    var tradeChoreActions: [(Text, [T.ActionConfig])] = [];
    var tradeChoreNextActionId: [(Text, Nat)] = [];

    // Rebalance Chore: per-instance settings
    var rebalanceTargets: [(Text, [T.RebalanceTarget])] = [];
    var rebalanceDenominationToken: [(Text, Principal)] = [];
    var rebalanceMaxTradeSize: [(Text, Nat)] = [];
    var rebalanceMinTradeSize: [(Text, Nat)] = [];
    var rebalanceMaxPriceImpactBps: [(Text, Nat)] = [];
    var rebalanceMaxSlippageBps: [(Text, Nat)] = [];
    var rebalanceThresholdBps: [(Text, Nat)] = [];
    var rebalanceFallbackRouteTokens: [(Text, [Principal])] = [];

    // Move Funds Chore: per-instance action lists
    var moveFundsActions: [(Text, [T.ActionConfig])] = [];
    var moveFundsNextActionId: [(Text, Nat)] = [];

    // Distribution (shared pattern)
    var distributionSettings: [(Text, { lists: [DistributionTypes.DistributionList]; nextListId: Nat })] = [];

    // Bot Log
    var botLogEntries: [BotLogTypes.LogEntry] = [];
    var botLogNextId: Nat = 0;
    var botLogLevel: Nat = 3; // Info
    var botLogMaxEntries: Nat = 10_000;

    // Trade Log
    var tradeLogEntries: [T.TradeLogEntry] = [];
    var tradeLogNextId: Nat = 0;

    // Portfolio Snapshot Log
    var portfolioSnapshots: [T.PortfolioSnapshot] = [];
    var portfolioSnapshotNextId: Nat = 0;

    // Logging Settings (master)
    var loggingSettings: T.LoggingSettings = {
        tradeLogEnabled = true;
        portfolioLogEnabled = true;
        maxTradeLogEntries = 10_000;
        maxPortfolioLogEntries = 5_000;
    };

    // Per-chore logging overrides: choreId -> overrides
    var choreLoggingOverrides: [(Text, T.ChoreLoggingOverrides)] = [];

    // Balance reconciliation: last known balance per (token, subaccount)
    var lastKnownBalances: [(Text, Nat)] = [];

    // Net capital deployed tracking (for P&L computation)
    var capitalDeployedIcpE8s: Int = 0;
    var capitalDeployedUsdE8s: Int = 0;

    // Per-token capital flows in native token amounts
    // Key: token principal text, Value: (totalInflowNative, totalOutflowNative)
    var tokenCapitalFlows: [(Text, (Nat, Nat))] = [];

    // Persistent last known prices: pairKey -> CachedPrice
    var lastKnownPrices: [(Text, T.CachedPrice)] = [];

    // Price history ring buffer
    var priceHistory: [T.CachedPrice] = [];
    var priceHistoryNextIdx: Nat = 0;
    var priceHistoryMaxSize: Nat = 5000;

    // Price staleness threshold (seconds) — prices older than this are re-fetched in prep
    var priceStalenessSeconds: Nat = 300; // 5 minutes default

    // Metadata staleness threshold (seconds). Metadata older than this is re-fetched.
    var metadataStalenessSeconds: Nat = 3600; // 1 hour

    // Daily OHLC aggregation storage
    var dailyPortfolioSummaries: [T.DailyPortfolioSummary] = [];
    var dailyPriceCandles: [T.DailyPriceCandle] = [];

    // ============================================
    // TRANSIENT CACHES (cleared on canister upgrade)
    // ============================================

    // Token metadata cache: Principal -> { entry, fetchedAt }
    transient var _tokenMetaCache: [(Principal, T.CachedTokenMeta)] = [];

    // Price/quote cache: pairKey -> { inputToken, outputToken, quote, fetchedAt }
    transient var _priceCache: [(Text, T.CachedPrice)] = [];

    // Preparatory task progress tracking (per chore instance)
    transient var _prep_metaIndex: [(Text, Nat)] = [];
    transient var _prep_priceIndex: [(Text, Nat)] = [];

    // ============================================
    // PER-INSTANCE SETTINGS HELPERS
    // ============================================

    // Generic helpers for per-instance keyed arrays
    func getFromMap<V>(map: [(Text, V)], key: Text, default_: V): V {
        for ((k, v) in map.vals()) { if (k == key) return v };
        default_
    };

    func setInMap<V>(map: [(Text, V)], key: Text, value: V): [(Text, V)] {
        var found = false;
        let updated = Array.map<(Text, V), (Text, V)>(map,
            func((k, v)) { if (k == key) { found := true; (k, value) } else { (k, v) } }
        );
        if (found) updated
        else Array.append(updated, [(key, value)])
    };

    func removeFromMap<V>(map: [(Text, V)], key: Text): [(Text, V)] {
        Array.filter<(Text, V)>(map, func((k, _)) { k != key })
    };

    // Look up the chore type ID for a given instance ID (e.g., "trade", "rebalance")
    func getInstanceTypeId(instanceId: Text): ?Text {
        for ((id, info) in choreInstances.vals()) {
            if (id == instanceId) return ?info.typeId;
        };
        null
    };

    // Trade chore actions helpers
    func getTradeActionsForInstance(instanceId: Text): [T.ActionConfig] {
        getFromMap(tradeChoreActions, instanceId, [])
    };
    func setTradeActionsForInstance(instanceId: Text, actions: [T.ActionConfig]) {
        tradeChoreActions := setInMap(tradeChoreActions, instanceId, actions)
    };
    func getTradeNextId(instanceId: Text): Nat {
        getFromMap(tradeChoreNextActionId, instanceId, 1)
    };
    func setTradeNextId(instanceId: Text, n: Nat) {
        tradeChoreNextActionId := setInMap(tradeChoreNextActionId, instanceId, n)
    };

    // Move funds actions helpers
    func getMoveFundsActionsForInstance(instanceId: Text): [T.ActionConfig] {
        getFromMap(moveFundsActions, instanceId, [])
    };
    func setMoveFundsActionsForInstance(instanceId: Text, actions: [T.ActionConfig]) {
        moveFundsActions := setInMap(moveFundsActions, instanceId, actions)
    };
    func getMoveFundsNextId(instanceId: Text): Nat {
        getFromMap(moveFundsNextActionId, instanceId, 1)
    };
    func setMoveFundsNextId(instanceId: Text, n: Nat) {
        moveFundsNextActionId := setInMap(moveFundsNextActionId, instanceId, n)
    };

    // Distribution settings helpers
    func getDistSettings(instanceId: Text): { lists: [DistributionTypes.DistributionList]; nextListId: Nat } {
        getFromMap(distributionSettings, instanceId, { lists = []; nextListId = 1 })
    };
    func setDistSettings(instanceId: Text, s: { lists: [DistributionTypes.DistributionList]; nextListId: Nat }) {
        distributionSettings := setInMap(distributionSettings, instanceId, s)
    };

    // Rebalance settings helpers
    func getRebalTargets(instanceId: Text): [T.RebalanceTarget] {
        getFromMap(rebalanceTargets, instanceId, [])
    };
    func setRebalTargets(instanceId: Text, targets: [T.RebalanceTarget]) {
        rebalanceTargets := setInMap(rebalanceTargets, instanceId, targets)
    };
    func getRebalDenomToken(instanceId: Text): Principal {
        getFromMap(rebalanceDenominationToken, instanceId, Principal.fromText(T.ICP_LEDGER))
    };
    func getRebalMaxTrade(instanceId: Text): Nat {
        getFromMap(rebalanceMaxTradeSize, instanceId, 100_000_000) // 1 ICP default
    };
    func getRebalMinTrade(instanceId: Text): Nat {
        getFromMap(rebalanceMinTradeSize, instanceId, 10_000) // 0.0001 ICP default
    };
    func getRebalMaxImpact(instanceId: Text): Nat {
        getFromMap(rebalanceMaxPriceImpactBps, instanceId, 300) // 3%
    };
    func getRebalMaxSlippage(instanceId: Text): Nat {
        getFromMap(rebalanceMaxSlippageBps, instanceId, 100) // 1%
    };
    func getRebalThreshold(instanceId: Text): Nat {
        getFromMap(rebalanceThresholdBps, instanceId, 200) // 2% minimum deviation
    };
    func getRebalFallbackRouteTokens(instanceId: Text): [Principal] {
        let configured = getFromMap(rebalanceFallbackRouteTokens, instanceId, []);
        if (configured.size() > 0) { configured }
        else { [Principal.fromText(T.ICP_LEDGER)] } // Default: ICP as sole fallback
    };

    // ============================================
    // PERMISSION SYSTEM
    // ============================================

    transient let PERMISSION_MAP: [(Nat, T.TradingPermissionType)] = [
        // Shared base permissions (0–99)
        (0,   #FullPermissions),
        (1,   #ManagePermissions),
        (2,   #ViewChores),
        (3,   #ViewLogs),
        (4,   #ManageLogs),
        // Trading Bot permissions (200–299)
        (200, #ViewPortfolio),
        (201, #ManageSubaccounts),
        (202, #ManageTrades),
        (203, #ManageRebalancer),
        (204, #ManageTradeChore),
        (205, #ManageRebalanceChore),
        (206, #ManageMoveFundsChore),
        (207, #ManageTokenRegistry),
        (208, #ManageDexSettings),
        (209, #WithdrawFunds),
        (210, #ConfigureDistribution),
        (211, #ManageDistributeFunds),
    ];

    func permissionVariantToId(perm: T.TradingPermissionType): Nat {
        switch (perm) {
            case (#FullPermissions) { 0 };
            case (#ManagePermissions) { 1 };
            case (#ViewChores) { 2 };
            case (#ViewLogs) { 3 };
            case (#ManageLogs) { 4 };
            case (#ViewPortfolio) { 200 };
            case (#ManageSubaccounts) { 201 };
            case (#ManageTrades) { 202 };
            case (#ManageRebalancer) { 203 };
            case (#ManageTradeChore) { 204 };
            case (#ManageRebalanceChore) { 205 };
            case (#ManageMoveFundsChore) { 206 };
            case (#ManageTokenRegistry) { 207 };
            case (#ManageDexSettings) { 208 };
            case (#WithdrawFunds) { 209 };
            case (#ConfigureDistribution) { 210 };
            case (#ManageDistributeFunds) { 211 };
        }
    };

    func permissionIdToVariant(id: Nat): ?T.TradingPermissionType {
        switch (id) {
            case (0)   { ?#FullPermissions };
            case (1)   { ?#ManagePermissions };
            case (2)   { ?#ViewChores };
            case (3)   { ?#ViewLogs };
            case (4)   { ?#ManageLogs };
            case (200) { ?#ViewPortfolio };
            case (201) { ?#ManageSubaccounts };
            case (202) { ?#ManageTrades };
            case (203) { ?#ManageRebalancer };
            case (204) { ?#ManageTradeChore };
            case (205) { ?#ManageRebalanceChore };
            case (206) { ?#ManageMoveFundsChore };
            case (207) { ?#ManageTokenRegistry };
            case (208) { ?#ManageDexSettings };
            case (209) { ?#WithdrawFunds };
            case (210) { ?#ConfigureDistribution };
            case (211) { ?#ManageDistributeFunds };
            case (_)   { null };
        }
    };

    transient let permEngine = BotkeyPermissions.Engine<T.TradingPermissionType>({
        permissionMap = PERMISSION_MAP;
        variantToId = permissionVariantToId;
        idToVariant = permissionIdToVariant;
    });

    func callerHasPermission(caller: Principal, permissionId: Nat): Bool {
        permEngine.callerHasPermission(caller, permissionId, hotkeyPermissions)
    };

    func assertPermission(caller: Principal, permissionId: Nat) {
        permEngine.assertPermission(caller, permissionId, hotkeyPermissions)
    };

    // Map chore instance -> manage permission
    func choreManagePermission(instanceId: Text): Nat {
        let typeId = switch (choreEngine.getInstance(instanceId)) {
            case (?info) { info.typeId };
            case null { instanceId };
        };
        switch (typeId) {
            case ("trade") { T.TradingPermission.ManageTradeChore };
            case ("rebalance") { T.TradingPermission.ManageRebalanceChore };
            case ("move-funds") { T.TradingPermission.ManageMoveFundsChore };
            case ("distribute-funds") { T.TradingPermission.ManageDistributeFunds };
            case ("snapshot") { T.TradingPermission.ManageSnapshotChore };
            case (_) { Debug.trap("Unknown chore type: " # typeId) };
        }
    };

    // ============================================
    // BOT LOG SYSTEM
    // ============================================

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
    // BOT CHORES SYSTEM
    // ============================================

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

    // ============================================
    // SUBACCOUNT HELPERS
    // ============================================

    /// Convert a subaccount number to a 32-byte blob (big-endian encoding).
    func subaccountNumberToBlob(n: Nat): Blob {
        let bytes = Array.tabulate<Nat8>(32, func(i: Nat): Nat8 {
            let shift = (31 - i) * 8;
            Nat8.fromNat((n / (2 ** shift)) % 256)
        });
        Blob.fromArray(bytes)
    };

    /// Get the subaccount blob for a given number (0 = null = main account).
    func getSubaccountBlob(number: ?Nat): ?Blob {
        switch (number) {
            case null { null };
            case (?0) { null };
            case (?n) { ?subaccountNumberToBlob(n) };
        }
    };

    // ============================================
    // BALANCE RECONCILIATION HELPERS
    // ============================================

    /// Build a unique key for the (token, subaccount) pair.
    func balanceKey(token: Principal, subaccount: ?Blob): Text {
        let tokenPart = Principal.toText(token);
        let subPart = switch (subaccount) {
            case null { "main" };
            case (?blob) {
                let bytes = Blob.toArray(blob);
                var allZero = true;
                for (b in bytes.vals()) { if (b != 0) allZero := false };
                if (allZero) { "main" }
                else {
                    // Encode blob bytes as hex string
                    let hexChars = Array.tabulate<Text>(bytes.size(), func(i: Nat): Text {
                        let b = bytes[i];
                        let hi = Nat8.toNat(b / 16);
                        let lo = Nat8.toNat(b % 16);
                        let hexDigit = func(n: Nat): Text {
                            switch (n) {
                                case 0 "0"; case 1 "1"; case 2 "2"; case 3 "3";
                                case 4 "4"; case 5 "5"; case 6 "6"; case 7 "7";
                                case 8 "8"; case 9 "9"; case 10 "a"; case 11 "b";
                                case 12 "c"; case 13 "d"; case 14 "e"; case 15 "f";
                                case _ "?";
                            }
                        };
                        hexDigit(hi) # hexDigit(lo)
                    });
                    var hex = "";
                    for (h in hexChars.vals()) { hex := hex # h };
                    hex
                }
            };
        };
        tokenPart # ":" # subPart
    };

    /// Get the last known balance for a (token, subaccount) pair, if any.
    func getLastKnownBalance(token: Principal, subaccount: ?Blob): ?Nat {
        let key = balanceKey(token, subaccount);
        for ((k, v) in lastKnownBalances.vals()) {
            if (k == key) return ?v;
        };
        null
    };

    /// Set the last known balance for a (token, subaccount) pair.
    func setLastKnownBalance(token: Principal, subaccount: ?Blob, balance: Nat) {
        lastKnownBalances := setInMap(lastKnownBalances, balanceKey(token, subaccount), balance)
    };

    /// Adjust the last known balance for a (token, subaccount) pair by adding `delta`.
    /// Only adjusts if a last-known value already exists; otherwise does nothing.
    func adjustLastKnownBalance(token: Principal, subaccount: ?Blob, delta: Nat) {
        switch (getLastKnownBalance(token, subaccount)) {
            case (?prev) { setLastKnownBalance(token, subaccount, prev + delta) };
            case null {};
        };
    };

    /// Record a native-amount inflow for a token.
    func recordTokenInflow(token: Principal, amount: Nat) {
        let key = Principal.toText(token);
        var found = false;
        tokenCapitalFlows := Array.map<(Text, (Nat, Nat)), (Text, (Nat, Nat))>(tokenCapitalFlows, func((k, (infl, outfl))) {
            if (k == key) { found := true; (k, (infl + amount, outfl)) } else { (k, (infl, outfl)) }
        });
        if (not found) { tokenCapitalFlows := Array.append(tokenCapitalFlows, [(key, (amount, 0))]) };
    };

    /// Record a native-amount outflow for a token.
    func recordTokenOutflow(token: Principal, amount: Nat) {
        let key = Principal.toText(token);
        var found = false;
        tokenCapitalFlows := Array.map<(Text, (Nat, Nat)), (Text, (Nat, Nat))>(tokenCapitalFlows, func((k, (infl, outfl))) {
            if (k == key) { found := true; (k, (infl, outfl + amount)) } else { (k, (infl, outfl)) }
        });
        if (not found) { tokenCapitalFlows := Array.append(tokenCapitalFlows, [(key, (0, amount))]) };
    };

    /// Compare the current balance to the last known balance (0 if never seen before).
    /// If a discrepancy is found, log it as a trade log entry (actionType 4=inflow, 5=outflow).
    /// Then update lastKnown to the current balance.
    func reconcileBalance(token: Principal, subaccount: ?Blob, currentBalance: Nat, source: Text) {
        let lastKnown: Nat = switch (getLastKnownBalance(token, subaccount)) {
            case null 0;
            case (?v) v;
        };
        if (currentBalance > lastKnown) {
            let inflow = currentBalance - lastKnown;
            let subLabel = switch (subaccount) { case null "main"; case _ balanceKey(token, subaccount) };
            logEngine.logInfo(source, "Reconciliation: detected untracked inflow of " # Nat.toText(inflow) # " for " # tokenLabel(token) # " (" # subLabel # ")", null, []);
            ignore appendTradeLog({
                choreId = null;
                choreTypeId = ?"reconciliation";
                actionId = null;
                actionType = T.ActionType.DetectedInflow;
                inputToken = token;
                outputToken = null;
                inputAmount = inflow;
                outputAmount = null;
                priceE8s = null;
                priceImpactBps = null;
                slippageBps = null;
                dexId = null;
                status = #Success;
                errorMessage = null;
                txId = null;
                destinationOwner = null;
            });
            let (icpVal, usdVal) = valueTokenInIcpAndUsd(token, inflow);
            capitalDeployedIcpE8s += icpVal;
            capitalDeployedUsdE8s += usdVal;
            recordTokenInflow(token, inflow);
        } else if (currentBalance < lastKnown) {
            let outflow = lastKnown - currentBalance;
            let subLabel = switch (subaccount) { case null "main"; case _ balanceKey(token, subaccount) };
            logEngine.logWarning(source, "Reconciliation: detected untracked outflow of " # Nat.toText(outflow) # " for " # tokenLabel(token) # " (" # subLabel # ")", null, []);
            ignore appendTradeLog({
                choreId = null;
                choreTypeId = ?"reconciliation";
                actionId = null;
                actionType = T.ActionType.DetectedOutflow;
                inputToken = token;
                outputToken = null;
                inputAmount = outflow;
                outputAmount = null;
                priceE8s = null;
                priceImpactBps = null;
                slippageBps = null;
                dexId = null;
                status = #Success;
                errorMessage = null;
                txId = null;
                destinationOwner = null;
            });
            let (icpVal, usdVal) = valueTokenInIcpAndUsd(token, outflow);
            capitalDeployedIcpE8s -= icpVal;
            capitalDeployedUsdE8s -= usdVal;
            recordTokenOutflow(token, outflow);
        };
        // Always update lastKnown to current balance
        setLastKnownBalance(token, subaccount, currentBalance);
    };

    // ============================================
    // DEX AGGREGATOR — INTERNAL HELPERS
    // ============================================

    /// Get the ICPSwap factory actor.
    func getICPSwapFactory(): T.ICPSwapFactoryActor {
        actor(T.ICPSWAP_FACTORY): T.ICPSwapFactoryActor
    };

    /// Get the Kong swap actor.
    func getKongSwap(): T.KongSwapActor {
        actor(T.KONG_SWAP): T.KongSwapActor
    };

    /// Create a ledger actor from a canister ID.
    func getLedger(canisterId: Principal): T.LedgerActor {
        actor(Principal.toText(canisterId)): T.LedgerActor
    };

    /// Get ICPSwap pool canister for a token pair.
    /// Returns cached result if available, otherwise queries factory.
    func getICPSwapPool(tokenA: Principal, tokenB: Principal): async ?Principal {
        let key = pairKey(tokenA, tokenB);
        // Check cache
        for ((k, v) in icpswapPoolCache.vals()) {
            if (k == key) return ?v;
        };
        // Query factory
        let factory = getICPSwapFactory();
        let aText = Principal.toText(tokenA);
        let bText = Principal.toText(tokenB);
        let (t0, t1) = if (aText < bText) { (aText, bText) } else { (bText, aText) };
        try {
            let result = await factory.getPool({
                token0 = { address = t0; standard = "ICRC1" };
                token1 = { address = t1; standard = "ICRC1" };
                fee = 3000; // 0.3% standard fee tier
            });
            switch (result) {
                case (#ok(pool)) {
                    icpswapPoolCache := Array.append(icpswapPoolCache, [(key, pool.canisterId)]);
                    ?pool.canisterId
                };
                case (#err(_)) { null };
            };
        } catch (_) { null };
    };

    /// Build a canonical pair key (sorted lexicographically).
    func pairKey(tokenA: Principal, tokenB: Principal): Text {
        let a = Principal.toText(tokenA);
        let b = Principal.toText(tokenB);
        if (a < b) { a # ":" # b } else { b # ":" # a }
    };

    /// Determine ICPSwap zeroForOne direction.
    func isZeroForOne(inputToken: Principal, outputToken: Principal): Bool {
        Principal.toText(inputToken) < Principal.toText(outputToken)
    };

    /// Compute pool subaccount for a principal (ICPSwap ICRC1 deposit pattern).
    func principalToSubaccount(p: Principal): Blob {
        let bytes = Blob.toArray(Principal.toBlob(p));
        let sub = Array.tabulate<Nat8>(32, func(i: Nat): Nat8 {
            if (i == 0) { Nat8.fromNat(bytes.size()) }
            else if (i <= bytes.size()) { bytes[i - 1] }
            else { 0 }
        });
        Blob.fromArray(sub)
    };

    /// Get token info from the registry.
    func getTokenInfo(token: Principal): ?T.TokenRegistryEntry {
        Array.find<T.TokenRegistryEntry>(tokenRegistry, func(e) { e.ledgerCanisterId == token })
    };

    // ============================================
    // CACHE HELPERS
    // ============================================

    /// Get cached token metadata (returns null if missing or stale).
    func getCachedMeta(token: Principal): ?T.TokenRegistryEntry {
        let now = Time.now();
        let stalenessNanos = metadataStalenessSeconds * 1_000_000_000;
        for ((p, cached) in _tokenMetaCache.vals()) {
            if (p == token and (now - cached.fetchedAt) < stalenessNanos) {
                return ?cached.entry;
            };
        };
        null
    };

    /// Resolve a short label for a token (symbol or abbreviated principal).
    func tokenLabel(token: Principal): Text {
        switch (getCachedMeta(token)) {
            case (?m) { m.symbol };
            case null {
                switch (getTokenInfo(token)) {
                    case (?i) { i.symbol };
                    case null { Principal.toText(token) };
                };
            };
        }
    };

    /// Store token metadata in the transient cache.
    func setCachedMeta(token: Principal, entry: T.TokenRegistryEntry) {
        let cached: T.CachedTokenMeta = { entry = entry; fetchedAt = Time.now() };
        var found = false;
        let updated = Array.map<(Principal, T.CachedTokenMeta), (Principal, T.CachedTokenMeta)>(
            _tokenMetaCache,
            func((p, c)) { if (p == token) { found := true; (p, cached) } else { (p, c) } }
        );
        _tokenMetaCache := if (found) updated else Array.append(updated, [(token, cached)]);
    };

    /// Get a cached price/quote for a token pair (returns null if not cached).
    /// Direction-aware: if the cached quote was stored for the reverse direction,
    /// the inputAmount and expectedOutput are swapped so callers always get
    /// a quote consistent with the requested (inputToken → outputToken) direction.
    func getCachedQuote(inputToken: Principal, outputToken: Principal): ?T.SwapQuote {
        let key = pairKey(inputToken, outputToken);
        for ((k, cached) in _priceCache.vals()) {
            if (k == key) {
                if (cached.inputToken == inputToken and cached.outputToken == outputToken) {
                    return ?cached.quote;
                } else {
                    // Cached in reverse direction — swap amounts so the caller
                    // can compute (expectedOutput / inputAmount) correctly.
                    return ?{
                        dexId = cached.quote.dexId;
                        inputToken = inputToken;
                        outputToken = outputToken;
                        inputAmount = cached.quote.expectedOutput;
                        effectiveInputAmount = cached.quote.expectedOutput;
                        expectedOutput = cached.quote.inputAmount;
                        spotPriceE8s = cached.quote.spotPriceE8s;
                        priceImpactBps = cached.quote.priceImpactBps;
                        dexFeeBps = cached.quote.dexFeeBps;
                        inputFeesTotal = 0;
                        outputFeesTotal = 0;
                        poolCanisterId = cached.quote.poolCanisterId;
                        timestamp = cached.quote.timestamp;
                    };
                };
            };
        };
        null
    };

    /// Push an entry to the price history ring buffer.
    func pushPriceHistory(entry: T.CachedPrice) {
        if (priceHistoryMaxSize == 0) return;
        if (priceHistory.size() < priceHistoryMaxSize) {
            priceHistory := Array.append(priceHistory, [entry]);
        } else {
            priceHistory := Array.tabulate<T.CachedPrice>(priceHistory.size(), func(i) {
                if (i == priceHistoryNextIdx) entry else priceHistory[i]
            });
            priceHistoryNextIdx := (priceHistoryNextIdx + 1) % priceHistoryMaxSize;
        };
    };

    /// Store a price/quote in the transient cache, persist to lastKnownPrices,
    /// and push the old entry (if any) to the price history ring buffer.
    func setCachedQuote(inputToken: Principal, outputToken: Principal, quote: T.SwapQuote) {
        let key = pairKey(inputToken, outputToken);
        let cached: T.CachedPrice = { inputToken = inputToken; outputToken = outputToken; quote = quote; fetchedAt = Time.now() };

        // Update transient cache
        var found = false;
        let updated = Array.map<(Text, T.CachedPrice), (Text, T.CachedPrice)>(
            _priceCache,
            func((k, c)) { if (k == key) { found := true; (k, cached) } else { (k, c) } }
        );
        _priceCache := if (found) updated else Array.append(updated, [(key, cached)]);

        // Persist: push old entry to history, then overwrite
        var persistFound = false;
        lastKnownPrices := Array.map<(Text, T.CachedPrice), (Text, T.CachedPrice)>(lastKnownPrices, func((k, old)) {
            if (k == key) {
                persistFound := true;
                pushPriceHistory(old);
                (k, cached)
            } else { (k, old) }
        });
        if (not persistFound) { lastKnownPrices := Array.append(lastKnownPrices, [(key, cached)]) };

        // Update daily price candle
        updateDailyPriceCandle(key, cached);
    };

    /// Reset the transient price cache: seed it from persistent lastKnownPrices
    /// entries that are still fresh (within priceStalenessSeconds), so the prep
    /// task only fetches stale or missing prices.
    func resetPriceCache() {
        let now = Time.now();
        let thresholdNs: Int = priceStalenessSeconds * 1_000_000_000;
        _priceCache := Array.filter<(Text, T.CachedPrice)>(lastKnownPrices, func((_, cached)) {
            (now - cached.fetchedAt) < thresholdNs
        });
    };

    /// Convert an amount from one token to another using the cached price data.
    /// Tries a direct quote first; if unavailable, falls back to a two-hop
    /// conversion via ICP (e.g., SNEED → ICP → ckUSDC).
    func convertAmountViaCache(amount: Nat, fromToken: Principal, toToken: Principal): ?Nat {
        if (fromToken == toToken) return ?amount;
        // Try direct conversion
        switch (getCachedQuote(fromToken, toToken)) {
            case (?q) {
                if (q.inputAmount > 0) {
                    return ?(amount * q.expectedOutput / q.inputAmount)
                };
            };
            case null {};
        };
        // Fallback: two-hop via ICP
        let icpToken = Principal.fromText(T.ICP_LEDGER);
        if (fromToken != icpToken and toToken != icpToken) {
            switch (getCachedQuote(fromToken, icpToken)) {
                case (?q1) {
                    if (q1.inputAmount > 0) {
                        let icpAmount = amount * q1.expectedOutput / q1.inputAmount;
                        switch (getCachedQuote(icpToken, toToken)) {
                            case (?q2) {
                                if (q2.inputAmount > 0) {
                                    return ?(icpAmount * q2.expectedOutput / q2.inputAmount)
                                };
                            };
                            case null {};
                        };
                    };
                };
                case null {};
            };
        };
        null
    };

    /// Value a token amount in ICP and USD using the price cache.
    /// Returns (icpValue, usdValue) as Int. Returns 0 for either if price is unavailable.
    func valueTokenInIcpAndUsd(token: Principal, amount: Nat): (Int, Int) {
        let icpToken = Principal.fromText(T.ICP_LEDGER);
        let ckusdcToken = Principal.fromText(T.CKUSDC_LEDGER);
        let icpVal: Int = switch (convertAmountViaCache(amount, token, icpToken)) {
            case (?v) v;
            case null 0;
        };
        let usdVal: Int = switch (convertAmountViaCache(amount, token, ckusdcToken)) {
            case (?v) v;
            case null 0;
        };
        (icpVal, usdVal)
    };

    /// Get token info from registry, then metadata cache, then fetch on-the-fly.
    /// Results are stored in the metadata cache for future lookups.
    func getTokenInfoOrFetch(token: Principal): async T.TokenRegistryEntry {
        // 1. Check token registry first (user-managed, always authoritative)
        switch (getTokenInfo(token)) {
            case (?entry) { return entry };
            case null {};
        };
        // 2. Check transient metadata cache (with staleness)
        switch (getCachedMeta(token)) {
            case (?entry) { return entry };
            case null {};
        };
        // 3. Fetch from ledger and cache
        let ledger = getLedger(token);
        let fee = await ledger.icrc1_fee();
        let decimals = await ledger.icrc1_decimals();
        let symbol = await ledger.icrc1_symbol();
        let entry: T.TokenRegistryEntry = {
            ledgerCanisterId = token;
            symbol = symbol;
            decimals = decimals;
            fee = fee;
        };
        setCachedMeta(token, entry);
        logEngine.logDebug("dex", "Fetched metadata for " # symbol # " (" # Principal.toText(token) # "): fee=" # Nat.toText(fee) # " decimals=" # Nat8.toText(decimals), null, []);
        entry
    };

    /// Check if a DEX is enabled.
    func isDexEnabled(dexId: Nat): Bool {
        Array.find<Nat>(enabledDexes, func(d) { d == dexId }) != null
    };

    // ============================================
    // DEX AGGREGATOR — QUOTING
    // ============================================

    /// Get a swap quote from ICPSwap.
    func getICPSwapQuote(inputToken: Principal, outputToken: Principal, amount: Nat): async ?T.SwapQuote {
        let poolOpt = await getICPSwapPool(inputToken, outputToken);
        let poolCid = switch (poolOpt) {
            case (?p) p;
            case null {
                logEngine.logDebug("dex", "ICPSwap: no pool found for " # Principal.toText(inputToken) # " -> " # Principal.toText(outputToken), null, []);
                return null;
            };
        };

        let inputInfo = try { await getTokenInfoOrFetch(inputToken) } catch (e) {
            logEngine.logWarning("dex", "ICPSwap: failed to get info for input token " # Principal.toText(inputToken) # ": " # Error.message(e), null, []);
            return null;
        };
        let outputInfo = try { await getTokenInfoOrFetch(outputToken) } catch (e) {
            logEngine.logWarning("dex", "ICPSwap: failed to get info for output token " # Principal.toText(outputToken) # ": " # Error.message(e), null, []);
            return null;
        };

        // ICPSwap: 2 input fees (transfer + deposit), 1 output fee (withdrawal)
        let inputFees = 2 * inputInfo.fee;
        let outputFees = 1 * outputInfo.fee;

        if (amount <= inputFees) return null;
        let effectiveInput = amount - inputFees;

        let pool: T.ICPSwapPoolActor = actor(Principal.toText(poolCid));
        let zfo = isZeroForOne(inputToken, outputToken);

        try {
            let quoteResult = await pool.quote({
                amountIn = Nat.toText(effectiveInput);
                zeroForOne = zfo;
                amountOutMinimum = "0";
            });

            switch (quoteResult) {
                case (#ok(expectedOutputInt)) {
                    // ICPSwap returns Int; convert to Nat (negative means error)
                    if (expectedOutputInt <= 0) return null;
                    let expectedOutput = Int.abs(expectedOutputInt);
                    let netOutput = if (expectedOutput > outputFees) { expectedOutput - outputFees } else { 0 };

                    // Calculate spot price (as e8s: output per 1e(inputDecimals) input)
                    // Using the quote for a reasonable estimate
                    let spotPriceE8s = if (effectiveInput > 0) {
                        (expectedOutput * (10 ** Nat8.toNat(inputInfo.decimals))) / effectiveInput
                    } else { 0 };

                    // Price impact estimate
                    let priceImpactBps: Nat = 0; // Would need metadata for precise calculation

                    ?{
                        dexId = T.DexId.ICPSwap;
                        inputToken = inputToken;
                        outputToken = outputToken;
                        inputAmount = amount;
                        effectiveInputAmount = effectiveInput;
                        expectedOutput = netOutput;
                        spotPriceE8s = spotPriceE8s;
                        priceImpactBps = priceImpactBps;
                        dexFeeBps = 30; // 0.3%
                        inputFeesTotal = inputFees;
                        outputFeesTotal = outputFees;
                        poolCanisterId = ?poolCid;
                        timestamp = Time.now();
                    }
                };
                case (#err(_)) { null };
            };
        } catch (_) { null };
    };

    /// Get a swap quote from KongSwap.
    func getKongQuote(inputToken: Principal, outputToken: Principal, amount: Nat): async ?T.SwapQuote {
        let inputInfo = try { await getTokenInfoOrFetch(inputToken) } catch (e) {
            logEngine.logWarning("dex", "Kong: failed to get info for input token " # Principal.toText(inputToken) # ": " # Error.message(e), null, []);
            return null;
        };
        let outputInfo = try { await getTokenInfoOrFetch(outputToken) } catch (e) {
            logEngine.logWarning("dex", "Kong: failed to get info for output token " # Principal.toText(outputToken) # ": " # Error.message(e), null, []);
            return null;
        };

        // Kong ICRC1: 1 input fee, 0 output fees
        // Kong ICRC2: 2 input fees, 0 output fees — we'll use ICRC1 fee count for now
        let inputFees = 1 * inputInfo.fee;
        let outputFees: Nat = 0;

        if (amount <= inputFees) return null;
        let effectiveInput = amount - inputFees;

        let kong = getKongSwap();

        try {
            let result = await kong.swap_amounts(
                Principal.toText(inputToken),
                effectiveInput,
                Principal.toText(outputToken)
            );

            switch (result) {
                case (#Ok(quoteData)) {
                    let netOutput = quoteData.receive_amount; // Kong has 0 output fees

                    let spotPriceE8s = if (quoteData.mid_price > 0.0) {
                        // Convert float mid_price to e8s representation
                        let decimalAdj = Float.pow(10.0, Float.fromInt(Nat8.toNat(outputInfo.decimals)));
                        let priceNat = Int.abs(Float.toInt(quoteData.mid_price * decimalAdj));
                        priceNat
                    } else { 0 };

                    let priceImpactBps = Int.abs(Float.toInt(Float.abs(quoteData.slippage) * 100.0));

                    ?{
                        dexId = T.DexId.KongSwap;
                        inputToken = inputToken;
                        outputToken = outputToken;
                        inputAmount = amount;
                        effectiveInputAmount = effectiveInput;
                        expectedOutput = netOutput;
                        spotPriceE8s = spotPriceE8s;
                        priceImpactBps = priceImpactBps;
                        dexFeeBps = 30; // Default 0.3%, varies by pool
                        inputFeesTotal = inputFees;
                        outputFeesTotal = outputFees;
                        poolCanisterId = null;
                        timestamp = Time.now();
                    }
                };
                case (#Err(_)) { null };
            };
        } catch (_) { null };
    };

    /// Get quotes from all enabled DEXes, sorted by output (best first).
    func getAllQuotes(inputToken: Principal, outputToken: Principal, amount: Nat): async [T.SwapQuote] {
        let quotes = Buffer.Buffer<T.SwapQuote>(2);

        if (isDexEnabled(T.DexId.ICPSwap)) {
            let q = await getICPSwapQuote(inputToken, outputToken, amount);
            switch (q) { case (?quote) { quotes.add(quote) }; case null {} };
        };

        if (isDexEnabled(T.DexId.KongSwap)) {
            let q = await getKongQuote(inputToken, outputToken, amount);
            switch (q) { case (?quote) { quotes.add(quote) }; case null {} };
        };

        // Sort by expectedOutput descending
        let arr = Buffer.toArray(quotes);
        Array.sort<T.SwapQuote>(arr, func(a, b) {
            if (a.expectedOutput > b.expectedOutput) { #less }
            else if (a.expectedOutput < b.expectedOutput) { #greater }
            else { #equal }
        })
    };

    /// Get the best quote across all enabled DEXes.
    func getBestQuote(inputToken: Principal, outputToken: Principal, amount: Nat): async ?T.SwapQuote {
        let quotes = await getAllQuotes(inputToken, outputToken, amount);
        if (quotes.size() > 0) { ?quotes[0] } else { null }
    };

    // ============================================
    // DEX AGGREGATOR — SWAP EXECUTION
    // ============================================

    /// Execute a swap on ICPSwap using ICRC-1 path.
    /// (Transfer to pool subaccount, then depositAndSwap)
    func executeICPSwapSwap(quote: T.SwapQuote, slippageBps: Nat): async T.SwapResult {
        let poolCid = switch (quote.poolCanisterId) {
            case (?p) p;
            case null { return #Err("No pool canister for ICPSwap swap") };
        };

        let inputInfo = try { await getTokenInfoOrFetch(quote.inputToken) } catch (e) {
            return #Err("Failed to get input token info: " # Error.message(e));
        };
        let outputInfo = try { await getTokenInfoOrFetch(quote.outputToken) } catch (e) {
            return #Err("Failed to get output token info: " # Error.message(e));
        };

        let zfo = isZeroForOne(quote.inputToken, quote.outputToken);
        let effectiveInput = quote.effectiveInputAmount;
        let minOutput = quote.expectedOutput - (quote.expectedOutput * slippageBps / 10000);

        let pool: T.ICPSwapPoolActor = actor(Principal.toText(poolCid));
        let inputLedger = getLedger(quote.inputToken);

        // Step 1: Transfer input tokens to pool's subaccount for our principal
        let selfPrincipal = Principal.fromActor(this);
        let poolSubaccount = principalToSubaccount(selfPrincipal);
        let transferAmount = effectiveInput + inputInfo.fee; // Pool's internal deposit costs a fee

        try {
            let transferResult = await inputLedger.icrc1_transfer({
                to = { owner = poolCid; subaccount = ?poolSubaccount };
                fee = ?inputInfo.fee;
                memo = null;
                from_subaccount = null;
                created_at_time = null;
                amount = transferAmount;
            });

            switch (transferResult) {
                case (#Err(e)) {
                    return #Err("Transfer to pool failed: " # debug_show(e));
                };
                case (#Ok(_)) {};
            };
        } catch (e) {
            return #Err("Transfer to pool threw: " # Error.message(e));
        };

        // Step 2: depositAndSwap
        try {
            let swapResult = await pool.depositAndSwap({
                amountIn = Nat.toText(effectiveInput);
                zeroForOne = zfo;
                amountOutMinimum = Nat.toText(minOutput);
                tokenInFee = inputInfo.fee;
                tokenOutFee = outputInfo.fee;
            });

            switch (swapResult) {
                case (#ok(amountOutInt)) {
                    // ICPSwap returns Int; convert to Nat
                    if (amountOutInt <= 0) {
                        return #Err("ICPSwap swap returned non-positive output: " # Int.toText(amountOutInt));
                    };
                    #Ok({ amountOut = Int.abs(amountOutInt); txId = null })
                };
                case (#err(e)) { #Err("ICPSwap swap failed: " # e.message) };
            };
        } catch (e) {
            #Err("ICPSwap swap threw: " # Error.message(e))
        };
    };

    /// Execute a swap on KongSwap using ICRC-1 path.
    /// (Transfer to Kong canister, then swap with block index)
    func executeKongSwapSwap(quote: T.SwapQuote, slippageBps: Nat): async T.SwapResult {
        let inputInfo = try { await getTokenInfoOrFetch(quote.inputToken) } catch (e) {
            return #Err("Failed to get input token info: " # Error.message(e));
        };

        let effectiveInput = quote.effectiveInputAmount;
        let minOutput = quote.expectedOutput - (quote.expectedOutput * slippageBps / 10000);

        let inputLedger = getLedger(quote.inputToken);
        let kongPrincipal = Principal.fromText(T.KONG_SWAP);
        let kong = getKongSwap();

        // Step 1: Transfer input tokens to Kong canister
        let blockIndex: Nat = try {
            let transferResult = await inputLedger.icrc1_transfer({
                to = { owner = kongPrincipal; subaccount = null };
                fee = ?inputInfo.fee;
                memo = null;
                from_subaccount = null;
                created_at_time = null;
                amount = effectiveInput;
            });

            switch (transferResult) {
                case (#Ok(idx)) { idx };
                case (#Err(e)) {
                    return #Err("Transfer to Kong failed: " # debug_show(e));
                };
            };
        } catch (e) {
            return #Err("Transfer to Kong threw: " # Error.message(e));
        };

        // Step 2: Call swap with block index
        // Calculate max_slippage: Kong's slippage is total % deviation from mid_price
        let totalSlippagePct = Float.fromInt(quote.priceImpactBps + quote.dexFeeBps + slippageBps) / 100.0;

        try {
            let swapResult = await kong.swap({
                pay_token = Principal.toText(quote.inputToken);
                pay_amount = effectiveInput;
                receive_token = Principal.toText(quote.outputToken);
                receive_amount = ?minOutput;
                receive_address = null;
                pay_tx_id = ?#BlockIndex(blockIndex);
                max_slippage = ?totalSlippagePct;
                referred_by = null;
            });

            switch (swapResult) {
                case (#Ok(reply)) {
                    #Ok({ amountOut = reply.receive_amount; txId = ?Nat64.toNat(reply.tx_id) })
                };
                case (#Err(e)) { #Err("Kong swap failed: " # e) };
            };
        } catch (e) {
            #Err("Kong swap threw: " # Error.message(e))
        };
    };

    /// Execute a swap using the given quote.
    func executeSwap(quote: T.SwapQuote, slippageBps: Nat): async T.SwapResult {
        if (quote.dexId == T.DexId.ICPSwap) {
            await executeICPSwapSwap(quote, slippageBps)
        } else if (quote.dexId == T.DexId.KongSwap) {
            await executeKongSwapSwap(quote, slippageBps)
        } else {
            #Err("Unknown DEX ID: " # Nat.toText(quote.dexId))
        }
    };

    // ============================================
    // ICRC-1 TRANSFER HELPERS
    // ============================================

    /// Transfer tokens (internal helper).
    func transferTokens(token: Principal, fromSubaccount: ?Blob, to: T.Account, amount: Nat): async T.TransferResult {
        let ledger = getLedger(token);
        let fee = switch (getTokenInfo(token)) {
            case (?info) { info.fee };
            case null { 0 }; // will be fetched by ledger
        };
        await ledger.icrc1_transfer({
            to = to;
            fee = ?fee;
            memo = null;
            from_subaccount = fromSubaccount;
            created_at_time = null;
            amount = amount;
        })
    };

    /// Get balance of a token in a subaccount.
    func getBalance(token: Principal, subaccount: ?Blob): async Nat {
        let ledger = getLedger(token);
        await ledger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = subaccount;
        })
    };

    // ============================================
    // TRADE LOG — INTERNAL HELPERS
    // ============================================

    /// Append a trade log entry (called internally by chore conductors).
    /// Respects master and per-chore logging settings.
    /// Returns the assigned entry ID (or null if logging was disabled).
    func appendTradeLog(entry: {
        choreId: ?Text;
        choreTypeId: ?Text;
        actionId: ?Nat;
        actionType: Nat;
        inputToken: Principal;
        outputToken: ?Principal;
        inputAmount: Nat;
        outputAmount: ?Nat;
        priceE8s: ?Nat;
        priceImpactBps: ?Nat;
        slippageBps: ?Nat;
        dexId: ?Nat;
        status: T.TradeStatus;
        errorMessage: ?Text;
        txId: ?Nat;
        destinationOwner: ?Principal;
    }): ?Nat {
        // Check master setting
        if (not loggingSettings.tradeLogEnabled) { return null };
        // Check per-chore override
        switch (entry.choreId) {
            case (?cid) {
                for ((id, ovr) in choreLoggingOverrides.vals()) {
                    if (id == cid) {
                        switch (ovr.tradeLogEnabled) {
                            case (?false) { return null };
                            case (_) {};
                        };
                    };
                };
            };
            case (null) {};
        };

        let id = tradeLogNextId;
        tradeLogNextId += 1;
        let full: T.TradeLogEntry = {
            id = id;
            timestamp = Time.now();
            choreId = entry.choreId;
            choreTypeId = entry.choreTypeId;
            actionId = entry.actionId;
            actionType = entry.actionType;
            inputToken = entry.inputToken;
            outputToken = entry.outputToken;
            inputAmount = entry.inputAmount;
            outputAmount = entry.outputAmount;
            priceE8s = entry.priceE8s;
            priceImpactBps = entry.priceImpactBps;
            slippageBps = entry.slippageBps;
            dexId = entry.dexId;
            status = entry.status;
            errorMessage = entry.errorMessage;
            txId = entry.txId;
            destinationOwner = entry.destinationOwner;
        };
        let buf = Buffer.fromArray<T.TradeLogEntry>(tradeLogEntries);
        buf.add(full);
        // Trim circular buffer
        if (buf.size() > loggingSettings.maxTradeLogEntries) {
            let excess = buf.size() - loggingSettings.maxTradeLogEntries : Nat;
            let trimmed = Buffer.Buffer<T.TradeLogEntry>(loggingSettings.maxTradeLogEntries);
            var i = excess;
            while (i < buf.size()) {
                trimmed.add(buf.get(i));
                i += 1;
            };
            tradeLogEntries := Buffer.toArray(trimmed);
        } else {
            tradeLogEntries := Buffer.toArray(buf);
        };
        ?id
    };

    // ============================================
    // DAILY OHLC AGGREGATION — INTERNAL HELPERS
    // ============================================

    let NANOS_PER_DAY: Int = 86_400_000_000_000;

    /// Compute UTC day start (midnight) in nanoseconds from a timestamp.
    func utcDayStart(timestamp: Int): Int {
        let day = timestamp / NANOS_PER_DAY;
        day * NANOS_PER_DAY
    };

    /// Compare two optional Blobs for equality.
    func blobOptEq(a: ?Blob, b: ?Blob): Bool {
        switch (a, b) {
            case (null, null) true;
            case (?ba, ?bb) { ba == bb };
            case (_, _) false;
        }
    };

    /// Update or create the daily portfolio summary for a snapshot.
    func updateDailyPortfolioSummary(snapshot: T.PortfolioSnapshot) {
        let icpVal = switch (snapshot.totalValueIcpE8s) { case (?v) v; case null 0 };
        let usdVal = switch (snapshot.totalValueUsdE8s) { case (?v) v; case null 0 };
        if (icpVal == 0 and usdVal == 0) return; // No value data, skip

        let date = utcDayStart(snapshot.timestamp);

        // Find existing summary for (date, subaccount)
        var found = false;
        dailyPortfolioSummaries := Array.map<T.DailyPortfolioSummary, T.DailyPortfolioSummary>(dailyPortfolioSummaries, func(s) {
            if (s.date == date and blobOptEq(s.subaccount, snapshot.subaccount)) {
                found := true;
                {
                    s with
                    highValueIcpE8s = Nat.max(s.highValueIcpE8s, icpVal);
                    lowValueIcpE8s = Nat.min(s.lowValueIcpE8s, icpVal);
                    closeValueIcpE8s = icpVal;
                    highValueUsdE8s = Nat.max(s.highValueUsdE8s, usdVal);
                    lowValueUsdE8s = Nat.min(s.lowValueUsdE8s, usdVal);
                    closeValueUsdE8s = usdVal;
                    snapshotCount = s.snapshotCount + 1;
                    closeTokens = snapshot.tokens;
                }
            } else { s }
        });

        if (not found) {
            dailyPortfolioSummaries := Array.append(dailyPortfolioSummaries, [{
                date = date;
                subaccount = snapshot.subaccount;
                openValueIcpE8s = icpVal;
                highValueIcpE8s = icpVal;
                lowValueIcpE8s = icpVal;
                closeValueIcpE8s = icpVal;
                openValueUsdE8s = usdVal;
                highValueUsdE8s = usdVal;
                lowValueUsdE8s = usdVal;
                closeValueUsdE8s = usdVal;
                snapshotCount = 1;
                closeTokens = snapshot.tokens;
            }]);
        };
    };

    /// Update or create the daily price candle for a cached quote.
    func updateDailyPriceCandle(key: Text, cached: T.CachedPrice) {
        let price = cached.quote.spotPriceE8s;
        if (price == 0) return;

        let date = utcDayStart(cached.fetchedAt);

        var found = false;
        dailyPriceCandles := Array.map<T.DailyPriceCandle, T.DailyPriceCandle>(dailyPriceCandles, func(c) {
            if (c.pairKey == key and c.date == date) {
                found := true;
                {
                    c with
                    highE8s = Nat.max(c.highE8s, price);
                    lowE8s = Nat.min(c.lowE8s, price);
                    closeE8s = price;
                    quoteCount = c.quoteCount + 1;
                }
            } else { c }
        });

        if (not found) {
            dailyPriceCandles := Array.append(dailyPriceCandles, [{
                pairKey = key;
                inputToken = cached.inputToken;
                outputToken = cached.outputToken;
                date = date;
                openE8s = price;
                highE8s = price;
                lowE8s = price;
                closeE8s = price;
                quoteCount = 1;
            }]);
        };
    };

    // ============================================
    // PORTFOLIO SNAPSHOT — INTERNAL HELPERS
    // ============================================

    /// Append a portfolio snapshot (called internally).
    /// Respects master and per-chore logging settings.
    func appendPortfolioSnapshot(entry: {
        trigger: Text;
        tradeLogId: ?Nat;
        phase: T.SnapshotPhase;
        choreId: ?Text;
        subaccount: ?Blob;
        denominationToken: ?Principal;
        totalValueIcpE8s: ?Nat;
        totalValueUsdE8s: ?Nat;
        totalValueDenomE8s: ?Nat;
        tokens: [T.TokenSnapshot];
    }): ?Nat {
        if (not loggingSettings.portfolioLogEnabled) { return null };
        // Check per-chore override
        switch (entry.choreId) {
            case (?cid) {
                for ((id, ovr) in choreLoggingOverrides.vals()) {
                    if (id == cid) {
                        switch (ovr.portfolioLogEnabled) {
                            case (?false) { return null };
                            case (_) {};
                        };
                    };
                };
            };
            case (null) {};
        };

        let id = portfolioSnapshotNextId;
        portfolioSnapshotNextId += 1;
        let full: T.PortfolioSnapshot = {
            id = id;
            timestamp = Time.now();
            trigger = entry.trigger;
            tradeLogId = entry.tradeLogId;
            phase = entry.phase;
            choreId = entry.choreId;
            subaccount = entry.subaccount;
            denominationToken = entry.denominationToken;
            totalValueIcpE8s = entry.totalValueIcpE8s;
            totalValueUsdE8s = entry.totalValueUsdE8s;
            totalValueDenomE8s = entry.totalValueDenomE8s;
            tokens = entry.tokens;
        };
        let buf = Buffer.fromArray<T.PortfolioSnapshot>(portfolioSnapshots);
        buf.add(full);
        if (buf.size() > loggingSettings.maxPortfolioLogEntries) {
            let excess = buf.size() - loggingSettings.maxPortfolioLogEntries : Nat;
            // Fallback: ensure trimmed entries are captured in daily summaries
            var j: Nat = 0;
            while (j < excess) {
                updateDailyPortfolioSummary(buf.get(j));
                j += 1;
            };
            let trimmed = Buffer.Buffer<T.PortfolioSnapshot>(loggingSettings.maxPortfolioLogEntries);
            var i = excess;
            while (i < buf.size()) {
                trimmed.add(buf.get(i));
                i += 1;
            };
            portfolioSnapshots := Buffer.toArray(trimmed);
        } else {
            portfolioSnapshots := Buffer.toArray(buf);
        };
        updateDailyPortfolioSummary(full);
        ?id
    };

    /// Take token snapshots for a list of tokens. Uses cached metadata and prices.
    /// Returns TokenSnapshot array.
    func takeTokenSnapshots(tokens: [Principal]): async [T.TokenSnapshot] {
        let snaps = Buffer.Buffer<T.TokenSnapshot>(tokens.size());

        let icpToken = Principal.fromText(T.ICP_LEDGER);
        let ckusdcToken = Principal.fromText(T.CKUSDC_LEDGER);

        // Try to get ICP→ckUSDC quote to derive USD values.
        // ckUSDC has 6 decimals, so: icpUsdPrice = quote.expectedOutput * 1e6 / quote.inputAmount
        // represents how many ckUSDC (6-dec) you get per 1 raw ICP (8-dec unit).
        // We express priceUsdE8s similarly to priceIcpE8s: humanUsdPerToken * 10^tokenDecimals.
        let icpPriceUsdE6: ?Nat = switch (getCachedQuote(icpToken, ckusdcToken)) {
            case (?q) {
                if (q.inputAmount > 0) {
                    // This gives us: ckUSDC-raw per 1e8 ICP-raw
                    // = USD (with 6 decimals) per 1 ICP
                    ?((q.expectedOutput * 100_000_000) / q.inputAmount)
                } else { null }
            };
            case null { null };
        };

        for (token in tokens.vals()) {
            let balance = await getBalance(token, null); // Main account
            // Update lastKnown with queried balance (corrects any compute-based approximation)
            setLastKnownBalance(token, null, balance);
            let meta = getCachedMeta(token);
            let symbol = switch (meta) { case (?m) m.symbol; case null { switch (getTokenInfo(token)) { case (?i) i.symbol; case null "?" } } };
            let decimals: Nat8 = switch (meta) { case (?m) m.decimals; case null { switch (getTokenInfo(token)) { case (?i) i.decimals; case null 8 } } };
            let decNat = Nat8.toNat(decimals);
            let scale = 10 ** decNat;

            // ICP price: spotPriceE8s format = humanIcpPerToken * 10^tokenDecimals
            let priceIcpE8s: ?Nat = if (token == icpToken) {
                ?scale // 1 ICP = 1 ICP
            } else {
                switch (getCachedQuote(token, icpToken)) {
                    case (?q) {
                        if (q.inputAmount > 0) {
                            ?((q.expectedOutput * scale) / q.inputAmount)
                        } else { null }
                    };
                    case null { null };
                };
            };

            let valueIcpE8s: ?Nat = switch (priceIcpE8s) {
                case (?p) { ?((balance * p) / scale) };
                case null { null };
            };

            // USD price: derive from ICP price * ICP/USD rate
            // priceUsdE8s = humanUsdPerToken * 10^tokenDecimals
            let priceUsdE8s: ?Nat = if (token == ckusdcToken) {
                ?scale // 1 ckUSDC = $1
            } else {
                switch (priceIcpE8s, icpPriceUsdE6) {
                    case (?icpP, ?usdRate) {
                        // icpP = humanIcpPerToken * scale
                        // usdRate = ckUSDC-raw per 1 ICP (6 dec)
                        // humanUsdPerToken = (icpP / scale) * (usdRate / 1e6)
                        // priceUsdE8s = humanUsdPerToken * scale = icpP * usdRate / 1e6
                        ?((icpP * usdRate) / 1_000_000)
                    };
                    case (_, _) { null };
                };
            };

            let valueUsdE8s: ?Nat = switch (priceUsdE8s) {
                case (?p) { ?((balance * p) / scale) };
                case null { null };
            };

            snaps.add({
                token = token;
                symbol = symbol;
                decimals = decimals;
                balance = balance;
                priceIcpE8s = priceIcpE8s;
                priceUsdE8s = priceUsdE8s;
                priceDenomE8s = null;
                valueIcpE8s = valueIcpE8s;
                valueUsdE8s = valueUsdE8s;
                valueDenomE8s = null;
            });
        };
        Buffer.toArray(snaps)
    };

    /// Create a level-3 task function that takes a portfolio snapshot for given tokens.
    /// Used as before/after trade snapshot tasks in the chore pipeline.
    func _makeSnapshotTaskFn(tokens: [Principal], phase: T.SnapshotPhase, instanceId: Text, actionId: Nat): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            try {
                let snaps = await takeTokenSnapshots(tokens);
                let trigger = switch (phase) {
                    case (#Before) { "Trade " # Nat.toText(actionId) # " pre-swap" };
                    case (#After) { "Trade " # Nat.toText(actionId) # " post-swap" };
                };
                let tradeLogId: ?Nat = switch (phase) {
                    case (#After) { getFromMap(_trade_lastLogId, instanceId, null) };
                    case (#Before) { null };
                };
                let totalIcp = Array.foldLeft<T.TokenSnapshot, Nat>(snaps, 0, func(acc, s) { acc + (switch (s.valueIcpE8s) { case (?v) v; case null 0 }) });
                let totalUsd = Array.foldLeft<T.TokenSnapshot, Nat>(snaps, 0, func(acc, s) { acc + (switch (s.valueUsdE8s) { case (?v) v; case null 0 }) });
                ignore appendPortfolioSnapshot({
                    trigger = trigger;
                    tradeLogId = tradeLogId;
                    phase = phase;
                    choreId = ?instanceId;
                    subaccount = null;
                    denominationToken = null;
                    totalValueIcpE8s = ?totalIcp;
                    totalValueUsdE8s = ?totalUsd;
                    totalValueDenomE8s = null;
                    tokens = snaps;
                });
                #Done
            } catch (e) {
                logEngine.logWarning("chore:" # instanceId, "Snapshot failed: " # Error.message(e), null, []);
                #Done
            }
        }
    };

    /// Create a snapshot task for one or more token/subaccount pairs.
    /// Each pair produces its own PortfolioSnapshot entry (with that subaccount).
    /// Used for before/after snapshots around deposit/withdraw/send/distribution.
    func _makeAccountSnapshotTaskFn(
        pairs: [(Principal, ?Blob)],
        phase: T.SnapshotPhase,
        instanceId: Text,
        actionId: Nat,
        triggerPrefix: Text
    ): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            try {
                let icpToken = Principal.fromText(T.ICP_LEDGER);
                let ckusdcToken = Principal.fromText(T.CKUSDC_LEDGER);
                let icpPriceUsdE6: ?Nat = switch (getCachedQuote(icpToken, ckusdcToken)) {
                    case (?q) { if (q.inputAmount > 0) { ?((q.expectedOutput * 100_000_000) / q.inputAmount) } else { null } };
                    case null { null };
                };
                let phaseLabel = switch (phase) { case (#Before) "pre"; case (#After) "post" };

                for ((token, subaccount) in pairs.vals()) {
                    let balance = await getBalance(token, subaccount);
                    setLastKnownBalance(token, subaccount, balance);
                    let meta = getCachedMeta(token);
                    let symbol = switch (meta) { case (?m) m.symbol; case null { switch (getTokenInfo(token)) { case (?i) i.symbol; case null "?" } } };
                    let decimals: Nat8 = switch (meta) { case (?m) m.decimals; case null { switch (getTokenInfo(token)) { case (?i) i.decimals; case null 8 } } };
                    let decNat = Nat8.toNat(decimals);
                    let scale = 10 ** decNat;

                    let priceIcpE8s: ?Nat = if (token == icpToken) { ?scale } else {
                        switch (getCachedQuote(token, icpToken)) {
                            case (?q) { if (q.inputAmount > 0) { ?((q.expectedOutput * scale) / q.inputAmount) } else { null } };
                            case null { null };
                        }
                    };
                    let valueIcpE8s: ?Nat = switch (priceIcpE8s) { case (?p) { ?((balance * p) / scale) }; case null { null } };

                    let priceUsdE8s: ?Nat = if (token == ckusdcToken) { ?scale } else {
                        switch (priceIcpE8s, icpPriceUsdE6) {
                            case (?icpP, ?usdRate) { ?((icpP * usdRate) / 1_000_000) };
                            case (_, _) { null };
                        }
                    };
                    let valueUsdE8s: ?Nat = switch (priceUsdE8s) { case (?p) { ?((balance * p) / scale) }; case null { null } };

                    let snap: T.TokenSnapshot = {
                        token = token; symbol = symbol; decimals = decimals; balance = balance;
                        priceIcpE8s = priceIcpE8s; priceUsdE8s = priceUsdE8s; priceDenomE8s = null;
                        valueIcpE8s = valueIcpE8s; valueUsdE8s = valueUsdE8s; valueDenomE8s = null;
                    };

                    let trigger = triggerPrefix # " " # phaseLabel;
                    ignore appendPortfolioSnapshot({
                        trigger = trigger;
                        tradeLogId = switch (phase) { case (#After) { getFromMap(_trade_lastLogId, instanceId, null) }; case (#Before) { null } };
                        phase = phase;
                        choreId = ?instanceId;
                        subaccount = subaccount;
                        denominationToken = null;
                        totalValueIcpE8s = valueIcpE8s;
                        totalValueUsdE8s = valueUsdE8s;
                        totalValueDenomE8s = null;
                        tokens = [snap];
                    });
                };
                #Done
            } catch (e) {
                logEngine.logWarning("chore:" # instanceId, "Account snapshot failed: " # Error.message(e), null, []);
                #Done
            }
        }
    };

    // ============================================
    // TRADE ACTION EXECUTION
    // ============================================

    /// Compute action amount based on amountMode.
    /// Mode 0 (default): random in [minAmount, maxAmount].
    /// Mode 1: (balancePercent / 10000) * balance, clamped to [minAmount, maxAmount].
    func computeActionAmount(action: T.ActionConfig, balance: Nat, effectiveMin: Nat, effectiveMax: Nat): Nat {
        if (action.amountMode == 1) {
            // Percentage of balance mode
            let pct = switch (action.balancePercent) { case (?p) p; case null 10000 }; // default 100%
            let pctAmount = (balance * pct) / 10000;
            // Clamp to [effectiveMin, effectiveMax]
            let clamped = Nat.min(effectiveMax, Nat.max(effectiveMin, pctAmount));
            clamped
        } else {
            // Random in range (mode 0 / default)
            if (effectiveMin == effectiveMax) { effectiveMin }
            else if (effectiveMax > effectiveMin) {
                let range = effectiveMax - effectiveMin;
                let entropy = Int.abs(Time.now()) % (range + 1);
                effectiveMin + entropy
            } else { effectiveMin }
        }
    };

    /// Execute a single trade action. Returns true if executed, false if skipped.
    func executeTradeAction(action: T.ActionConfig, instanceId: Text): async Bool {
        let src = "chore:" # instanceId;

        // Check frequency
        switch (action.minFrequencySeconds) {
            case (?minFreq) {
                switch (action.lastExecutedAt) {
                    case (?lastTime) {
                        let elapsed = (Time.now() - lastTime) / 1_000_000_000;
                        if (elapsed < Int.abs(minFreq)) {
                            logEngine.logDebug(src, "Action " # Nat.toText(action.id) # " skipped: frequency limit (" # Nat.toText(Int.abs(elapsed)) # "s < " # Nat.toText(minFreq) # "s)", null, []);
                            return false;
                        };
                    };
                    case null {};
                };
            };
            case null {};
        };

        switch (action.actionType) {
            case (0) { // Trade
                await executeTradeSwap(action, instanceId)
            };
            case (1) { // Deposit
                await executeDeposit(action, instanceId)
            };
            case (2) { // Withdraw
                await executeWithdraw(action, instanceId)
            };
            case (3) { // Send
                await executeSend(action, instanceId)
            };
            case (_) {
                logEngine.logError(src, "Unknown action type: " # Nat.toText(action.actionType), null, []);
                false
            };
        }
    };

    /// Execute a Trade action (action type 0).
    func executeTradeSwap(action: T.ActionConfig, instanceId: Text): async Bool {
        let src = "chore:" # instanceId;
        let outputToken = switch (action.outputToken) {
            case (?t) t;
            case null {
                logEngine.logError(src, "Trade action " # Nat.toText(action.id) # " has no output token", null, []);
                return false;
            };
        };

        // Check input balance (optionally denominated in another token)
        let balance = await getBalance(action.inputToken, null); // Main account only for trades
        reconcileBalance(action.inputToken, null, balance, src);
        let balanceForComparison: Nat = switch (action.balanceDenominationToken) {
            case (?denomToken) {
                switch (convertAmountViaCache(balance, action.inputToken, denomToken)) {
                    case (?converted) converted;
                    case null {
                        logEngine.logWarning(src, "Trade " # Nat.toText(action.id) # " skipped: no cached quote to convert balance to denomination token", null, []);
                        return false;
                    };
                };
            };
            case null { balance };
        };
        switch (action.minBalance) {
            case (?min) { if (balanceForComparison < min) {
                logEngine.logDebug(src, "Trade " # Nat.toText(action.id) # " skipped: balance " # Nat.toText(balanceForComparison) # " < min " # Nat.toText(min), null, []);
                return false;
            }};
            case null {};
        };
        switch (action.maxBalance) {
            case (?max) { if (balanceForComparison > max) {
                logEngine.logDebug(src, "Trade " # Nat.toText(action.id) # " skipped: balance " # Nat.toText(balanceForComparison) # " > max " # Nat.toText(max), null, []);
                return false;
            }};
            case null {};
        };

        // Determine trade size (pick a value in the min-max range)
        // If tradeSizeDenominationToken is set, convert min/max from denomination units to inputToken units
        let (effectiveMinAmount, effectiveMaxAmount): (Nat, Nat) = switch (action.tradeSizeDenominationToken) {
            case (?denomToken) {
                let minNative = switch (convertAmountViaCache(action.minAmount, denomToken, action.inputToken)) {
                    case (?v) v;
                    case null {
                        logEngine.logWarning(src, "Trade " # Nat.toText(action.id) # " skipped: no cached quote to convert trade size min from denomination token", null, []);
                        return false;
                    };
                };
                let maxNative = switch (convertAmountViaCache(action.maxAmount, denomToken, action.inputToken)) {
                    case (?v) v;
                    case null {
                        logEngine.logWarning(src, "Trade " # Nat.toText(action.id) # " skipped: no cached quote to convert trade size max from denomination token", null, []);
                        return false;
                    };
                };
                (minNative, maxNative)
            };
            case null { (action.minAmount, action.maxAmount) };
        };

        let tradeSize = computeActionAmount(action, balance, effectiveMinAmount, effectiveMaxAmount);

        // Clamp to available balance (minus fees)
        let inputFee = try { (await getTokenInfoOrFetch(action.inputToken)).fee } catch (_) { 0 };
        let maxAffordable = if (balance > inputFee * 3) { balance - inputFee * 3 } else { 0 };
        let actualTradeSize = Nat.min(tradeSize, maxAffordable);

        if (actualTradeSize < effectiveMinAmount) {
            logEngine.logDebug(src, "Trade " # Nat.toText(action.id) # " skipped: affordable amount " # Nat.toText(actualTradeSize) # " < min " # Nat.toText(effectiveMinAmount), null, []);
            return false;
        };

        // Get quote — check price cache first, then fetch fresh
        let quoteOpt: ?T.SwapQuote = switch (action.preferredDex) {
            case (?dexId) {
                // User specified a DEX — always get a fresh quote for the actual trade size
                if (dexId == T.DexId.ICPSwap) {
                    await getICPSwapQuote(action.inputToken, outputToken, actualTradeSize)
                } else if (dexId == T.DexId.KongSwap) {
                    await getKongQuote(action.inputToken, outputToken, actualTradeSize)
                } else { null }
            };
            case null {
                // No preferred DEX — use cached quote's DEX if available, otherwise getBestQuote
                switch (getCachedQuote(action.inputToken, outputToken)) {
                    case (?cachedQ) {
                        // Re-fetch a quote on the same DEX but with actual trade size
                        if (cachedQ.dexId == T.DexId.ICPSwap) {
                            await getICPSwapQuote(action.inputToken, outputToken, actualTradeSize)
                        } else if (cachedQ.dexId == T.DexId.KongSwap) {
                            await getKongQuote(action.inputToken, outputToken, actualTradeSize)
                        } else {
                            await getBestQuote(action.inputToken, outputToken, actualTradeSize)
                        }
                    };
                    case null {
                        await getBestQuote(action.inputToken, outputToken, actualTradeSize)
                    };
                }
            };
        };

        let quote = switch (quoteOpt) {
            case (?q) q;
            case null {
                logEngine.logWarning(src, "Trade " # Nat.toText(action.id) # " skipped: no quote available", null, []);
                return false;
            };
        };

        // Check price impact
        let maxImpact = switch (action.maxPriceImpactBps) {
            case (?m) m;
            case null { defaultMaxPriceImpactBps };
        };
        if (quote.priceImpactBps > maxImpact) {
            logEngine.logWarning(src, "Trade " # Nat.toText(action.id) # " skipped: price impact " # Nat.toText(quote.priceImpactBps) # " bps > max " # Nat.toText(maxImpact) # " bps", null, []);
            return false;
        };

        // Check price conditions.
        switch (action.minPrice, action.maxPrice) {
            case (null, null) {};
            case (_, _) {
                switch (action.priceDenominationToken) {
                    case (?denomToken) {
                        // Denominated price: stored as humanDenomPerOutput * 10^denomDecimals.
                        // Convert 1 whole output token to denomination units via cache (supports two-hop via ICP).
                        let outMeta = getCachedMeta(outputToken);
                        let outDec: Nat = switch (outMeta) { case (?m) Nat8.toNat(m.decimals); case null 8 };
                        let oneOutputUnit = 10 ** outDec;
                        switch (convertAmountViaCache(oneOutputUnit, outputToken, denomToken)) {
                            case (?currentPriceInDenom) {
                                switch (action.minPrice) {
                                    case (?min) { if (currentPriceInDenom < min) {
                                        logEngine.logDebug(src, "Trade " # Nat.toText(action.id) # " skipped: denominated price " # Nat.toText(currentPriceInDenom) # " < min " # Nat.toText(min), null, []);
                                        return false;
                                    }};
                                    case null {};
                                };
                                switch (action.maxPrice) {
                                    case (?max) { if (currentPriceInDenom > max) {
                                        logEngine.logDebug(src, "Trade " # Nat.toText(action.id) # " skipped: denominated price " # Nat.toText(currentPriceInDenom) # " > max " # Nat.toText(max), null, []);
                                        return false;
                                    }};
                                    case null {};
                                };
                            };
                            case null {
                                logEngine.logWarning(src, "Trade " # Nat.toText(action.id) # " skipped: cannot convert output token price to denomination token (no direct or ICP-hop quote)", null, []);
                                return false;
                            };
                        };
                    };
                    case null {
                        // Native price: stored as humanInputPerOutput * 10^inputDecimals.
                        // spotPriceE8s is "output per input": humanOutputPerInput * 10^outputDecimals.
                        // Cross-multiplication:
                        //   minPrice <= actualIPO  ⟺  minPrice * spot <= 10^(inDec + outDec)
                        //   actualIPO <= maxPrice  ⟺  10^(inDec + outDec) <= maxPrice * spot
                        let inMeta = getCachedMeta(action.inputToken);
                        let outMeta = getCachedMeta(outputToken);
                        let inDec: Nat = switch (inMeta) { case (?m) Nat8.toNat(m.decimals); case null 8 };
                        let outDec: Nat = switch (outMeta) { case (?m) Nat8.toNat(m.decimals); case null 8 };
                        let scale = 10 ** (inDec + outDec);
                        switch (action.minPrice) {
                            case (?min) { if (min * quote.spotPriceE8s > scale) {
                                logEngine.logDebug(src, "Trade " # Nat.toText(action.id) # " skipped: price too low", null, []);
                                return false;
                            }};
                            case null {};
                        };
                        switch (action.maxPrice) {
                            case (?max) { if (max * quote.spotPriceE8s < scale) {
                                logEngine.logDebug(src, "Trade " # Nat.toText(action.id) # " skipped: price too high", null, []);
                                return false;
                            }};
                            case null {};
                        };
                    };
                };
            };
        };

        // Execute the swap
        let slippage = switch (action.maxSlippageBps) {
            case (?s) s;
            case null { defaultSlippageBps };
        };

        let result = await executeSwap(quote, slippage);

        switch (result) {
            case (#Ok(r)) {
                logEngine.logInfo(src, "Trade " # Nat.toText(action.id) # " executed: " # Nat.toText(actualTradeSize) # " -> " # Nat.toText(r.amountOut) # " via DEX " # Nat.toText(quote.dexId), null, [
                    ("actionId", Nat.toText(action.id)),
                    ("inputToken", Principal.toText(action.inputToken)),
                    ("outputToken", Principal.toText(outputToken)),
                    ("inputAmount", Nat.toText(actualTradeSize)),
                    ("outputAmount", Nat.toText(r.amountOut)),
                    ("dexId", Nat.toText(quote.dexId)),
                ]);
                let logId = appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = ?action.id;
                    actionType = 0;
                    inputToken = action.inputToken;
                    outputToken = ?outputToken;
                    inputAmount = actualTradeSize;
                    outputAmount = ?r.amountOut;
                    priceE8s = ?quote.spotPriceE8s;
                    priceImpactBps = ?quote.priceImpactBps;
                    slippageBps = ?slippage;
                    dexId = ?quote.dexId;
                    status = #Success;
                    errorMessage = null;
                    txId = r.txId;
                    destinationOwner = null;
                });
                // Store trade log ID so the after-snapshot task can link to it
                _trade_lastLogId := setInMap(_trade_lastLogId, instanceId, logId);
                // Update lastKnown: input decreased by trade amount, output increased by received amount
                setLastKnownBalance(action.inputToken, null, if (balance > actualTradeSize) { balance - actualTradeSize } else { 0 });
                adjustLastKnownBalance(outputToken, null, r.amountOut);
                true
            };
            case (#Err(e)) {
                logEngine.logError(src, "Trade " # Nat.toText(action.id) # " failed: " # e, null, [
                    ("actionId", Nat.toText(action.id)),
                    ("error", e),
                ]);
                let logId = appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = ?action.id;
                    actionType = 0;
                    inputToken = action.inputToken;
                    outputToken = ?outputToken;
                    inputAmount = actualTradeSize;
                    outputAmount = null;
                    priceE8s = ?quote.spotPriceE8s;
                    priceImpactBps = ?quote.priceImpactBps;
                    slippageBps = ?slippage;
                    dexId = ?quote.dexId;
                    status = #Failed;
                    errorMessage = ?e;
                    txId = null;
                    destinationOwner = null;
                });
                // Store trade log ID so the after-snapshot task can link to it
                _trade_lastLogId := setInMap(_trade_lastLogId, instanceId, logId);
                // On failure, balance should be unchanged (lastKnown was already set by reconcileBalance above)
                false
            };
        };
    };

    /// Execute a Deposit action (action type 1).
    func executeDeposit(action: T.ActionConfig, instanceId: Text): async Bool {
        let src = "chore:" # instanceId;
        let targetSub = switch (action.targetSubaccount) {
            case (?n) n;
            case null {
                logEngine.logError(src, "Deposit action " # Nat.toText(action.id) # " has no target subaccount", null, []);
                return false;
            };
        };

        let balance = await getBalance(action.inputToken, null); // Main account
        reconcileBalance(action.inputToken, null, balance, src);
        switch (action.minBalance) {
            case (?min) { if (balance < min) { return false } };
            case null {};
        };

        let fee = switch (getTokenInfo(action.inputToken)) { case (?i) i.fee; case null 0 };
        let affordable = if (balance > fee) { balance - fee } else { 0 };
        let amount = computeActionAmount(action, balance, action.minAmount, Nat.min(action.maxAmount, affordable));
        if (amount < action.minAmount or amount == 0) return false;

        let targetBlob = subaccountNumberToBlob(targetSub);
        let result = await transferTokens(
            action.inputToken,
            null, // from main
            { owner = Principal.fromActor(this); subaccount = ?targetBlob },
            amount
        );

        switch (result) {
            case (#Ok(blockIdx)) {
                logEngine.logInfo(src, "Deposit " # Nat.toText(action.id) # ": " # Nat.toText(amount) # " to subaccount " # Nat.toText(targetSub), null, []);
                ignore appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = ?action.id;
                    actionType = 1;
                    inputToken = action.inputToken;
                    outputToken = null;
                    inputAmount = amount;
                    outputAmount = null;
                    priceE8s = null;
                    priceImpactBps = null;
                    slippageBps = null;
                    dexId = null;
                    status = #Success;
                    errorMessage = null;
                    txId = ?blockIdx;
                    destinationOwner = null;
                });
                // Update lastKnown: main decreased by amount + fee, target subaccount increased by amount
                setLastKnownBalance(action.inputToken, null, if (balance > amount + fee) { balance - amount - fee } else { 0 });
                adjustLastKnownBalance(action.inputToken, ?targetBlob, amount);
                true
            };
            case (#Err(e)) {
                logEngine.logError(src, "Deposit " # Nat.toText(action.id) # " failed: " # debug_show(e), null, []);
                ignore appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = ?action.id;
                    actionType = 1;
                    inputToken = action.inputToken;
                    outputToken = null;
                    inputAmount = amount;
                    outputAmount = null;
                    priceE8s = null;
                    priceImpactBps = null;
                    slippageBps = null;
                    dexId = null;
                    status = #Failed;
                    errorMessage = ?debug_show(e);
                    txId = null;
                    destinationOwner = null;
                });
                false
            };
        };
    };

    /// Execute a Withdraw action (action type 2).
    func executeWithdraw(action: T.ActionConfig, instanceId: Text): async Bool {
        let src = "chore:" # instanceId;
        let sourceSub = switch (action.sourceSubaccount) {
            case (?n) n;
            case null {
                logEngine.logError(src, "Withdraw action " # Nat.toText(action.id) # " has no source subaccount", null, []);
                return false;
            };
        };

        let sourceBlob = subaccountNumberToBlob(sourceSub);
        let balance = await getBalance(action.inputToken, ?sourceBlob);
        reconcileBalance(action.inputToken, ?sourceBlob, balance, src);
        switch (action.minBalance) {
            case (?min) { if (balance < min) { return false } };
            case null {};
        };

        let fee = switch (getTokenInfo(action.inputToken)) { case (?i) i.fee; case null 0 };
        let affordable = if (balance > fee) { balance - fee } else { 0 };
        let amount = computeActionAmount(action, balance, action.minAmount, Nat.min(action.maxAmount, affordable));
        if (amount < action.minAmount or amount == 0) return false;

        let result = await transferTokens(
            action.inputToken,
            ?sourceBlob, // from subaccount
            { owner = Principal.fromActor(this); subaccount = null }, // to main
            amount
        );

        switch (result) {
            case (#Ok(blockIdx)) {
                logEngine.logInfo(src, "Withdraw " # Nat.toText(action.id) # ": " # Nat.toText(amount) # " from subaccount " # Nat.toText(sourceSub), null, []);
                ignore appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = ?action.id;
                    actionType = 2;
                    inputToken = action.inputToken;
                    outputToken = null;
                    inputAmount = amount;
                    outputAmount = null;
                    priceE8s = null;
                    priceImpactBps = null;
                    slippageBps = null;
                    dexId = null;
                    status = #Success;
                    errorMessage = null;
                    txId = ?blockIdx;
                    destinationOwner = null;
                });
                // Update lastKnown: subaccount decreased by amount + fee, main increased by amount
                setLastKnownBalance(action.inputToken, ?sourceBlob, if (balance > amount + fee) { balance - amount - fee } else { 0 });
                adjustLastKnownBalance(action.inputToken, null, amount);
                true
            };
            case (#Err(e)) {
                logEngine.logError(src, "Withdraw " # Nat.toText(action.id) # " failed: " # debug_show(e), null, []);
                ignore appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = ?action.id;
                    actionType = 2;
                    inputToken = action.inputToken;
                    outputToken = null;
                    inputAmount = amount;
                    outputAmount = null;
                    priceE8s = null;
                    priceImpactBps = null;
                    slippageBps = null;
                    dexId = null;
                    status = #Failed;
                    errorMessage = ?debug_show(e);
                    txId = null;
                    destinationOwner = null;
                });
                false
            };
        };
    };

    /// Execute a Send action (action type 3).
    func executeSend(action: T.ActionConfig, instanceId: Text): async Bool {
        let src = "chore:" # instanceId;
        let destOwner = switch (action.destinationOwner) {
            case (?o) o;
            case null {
                logEngine.logError(src, "Send action " # Nat.toText(action.id) # " has no destination", null, []);
                return false;
            };
        };

        let sourceBlob = getSubaccountBlob(action.sourceSubaccount);
        let balance = await getBalance(action.inputToken, sourceBlob);
        reconcileBalance(action.inputToken, sourceBlob, balance, src);
        switch (action.minBalance) {
            case (?min) { if (balance < min) { return false } };
            case null {};
        };

        let fee = switch (getTokenInfo(action.inputToken)) { case (?i) i.fee; case null 0 };
        let affordable = if (balance > fee) { balance - fee } else { 0 };
        let amount = computeActionAmount(action, balance, action.minAmount, Nat.min(action.maxAmount, affordable));
        if (amount < action.minAmount or amount == 0) return false;

        let result = await transferTokens(
            action.inputToken,
            sourceBlob,
            { owner = destOwner; subaccount = action.destinationSubaccount },
            amount
        );

        switch (result) {
            case (#Ok(blockIdx)) {
                logEngine.logInfo(src, "Send " # Nat.toText(action.id) # ": " # Nat.toText(amount) # " to " # Principal.toText(destOwner), null, []);
                ignore appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = ?action.id;
                    actionType = 3;
                    inputToken = action.inputToken;
                    outputToken = null;
                    inputAmount = amount;
                    outputAmount = null;
                    priceE8s = null;
                    priceImpactBps = null;
                    slippageBps = null;
                    dexId = null;
                    status = #Success;
                    errorMessage = null;
                    txId = ?blockIdx;
                    destinationOwner = ?destOwner;
                });
                // Update lastKnown: source decreased by amount + fee
                setLastKnownBalance(action.inputToken, sourceBlob, if (balance > amount + fee) { balance - amount - fee } else { 0 });
                // Track capital outflow (sent outside the canister)
                let (icpVal, usdVal) = valueTokenInIcpAndUsd(action.inputToken, amount);
                capitalDeployedIcpE8s -= icpVal;
                capitalDeployedUsdE8s -= usdVal;
                recordTokenOutflow(action.inputToken, amount);
                true
            };
            case (#Err(e)) {
                logEngine.logError(src, "Send " # Nat.toText(action.id) # " failed: " # debug_show(e), null, []);
                ignore appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = ?action.id;
                    actionType = 3;
                    inputToken = action.inputToken;
                    outputToken = null;
                    inputAmount = amount;
                    outputAmount = null;
                    priceE8s = null;
                    priceImpactBps = null;
                    slippageBps = null;
                    dexId = null;
                    status = #Failed;
                    errorMessage = ?debug_show(e);
                    txId = null;
                    destinationOwner = ?destOwner;
                });
                false
            };
        };
    };

    // Update lastExecutedAt for an action in a list
    func updateActionLastExecuted(instanceId: Text, actionId: Nat, isTradeChore: Bool) {
        let now = Time.now();
        let actions = if (isTradeChore) { getTradeActionsForInstance(instanceId) }
                     else { getMoveFundsActionsForInstance(instanceId) };
        let updated = Array.map<T.ActionConfig, T.ActionConfig>(actions, func(a) {
            if (a.id == actionId) { { a with lastExecutedAt = ?now } } else { a }
        });
        if (isTradeChore) { setTradeActionsForInstance(instanceId, updated) }
        else { setMoveFundsActionsForInstance(instanceId, updated) };
    };

    // ============================================
    // REBALANCER EXECUTION
    // ============================================

    // Last trade log ID produced by executeRebalance, keyed by instanceId.
    // Used by the after-snapshot task to link to the trade log entry.
    transient var _rebal_lastLogId: [(Text, ?Nat)] = [];

    /// Execute a swap and log the result for the rebalancer. Returns true on success.
    func _rebalExecuteAndLog(
        instanceId: Text,
        src: Text,
        sellToken: { token: Principal; deviationBps: Nat; balance: Nat; value: Nat },
        buyToken: { token: Principal; deviationBps: Nat; balance: Nat; value: Nat },
        quote: T.SwapQuote,
        slippage: Nat,
        tradeSize: Nat,
        route: Text,
    ): async Bool {
        logEngine.logTrace(src, "Executing swap: " # tokenLabel(sellToken.token) # " → " # tokenLabel(buyToken.token) # " on dex " # Nat.toText(quote.dexId), null, [
            ("sellToken", tokenLabel(sellToken.token)),
            ("sellTokenId", Principal.toText(sellToken.token)),
            ("buyToken", tokenLabel(buyToken.token)),
            ("buyTokenId", Principal.toText(buyToken.token)),
            ("tradeSize", Nat.toText(tradeSize)),
            ("expectedOutput", Nat.toText(quote.expectedOutput)),
            ("spotPriceE8s", Nat.toText(quote.spotPriceE8s)),
            ("priceImpactBps", Nat.toText(quote.priceImpactBps)),
            ("slippageBps", Nat.toText(slippage)),
            ("dexId", Nat.toText(quote.dexId)),
            ("route", route),
        ]);
        let result = await executeSwap(quote, slippage);
        switch (result) {
            case (#Ok(r)) {
                logEngine.logInfo(src, "Rebalance trade executed: sold " # Nat.toText(tradeSize) # " " # tokenLabel(sellToken.token) # " → received " # Nat.toText(r.amountOut) # " " # tokenLabel(buyToken.token) # " (" # route # ", dex " # Nat.toText(quote.dexId) # ", impact " # Nat.toText(quote.priceImpactBps) # " bps)", null, [
                    ("sellToken", tokenLabel(sellToken.token)),
                    ("sellTokenId", Principal.toText(sellToken.token)),
                    ("buyToken", tokenLabel(buyToken.token)),
                    ("buyTokenId", Principal.toText(buyToken.token)),
                    ("sellAmount", Nat.toText(tradeSize)),
                    ("buyAmount", Nat.toText(r.amountOut)),
                    ("dexId", Nat.toText(quote.dexId)),
                    ("priceImpactBps", Nat.toText(quote.priceImpactBps)),
                    ("route", route),
                ]);
                let logId = appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = null;
                    actionType = 0;
                    inputToken = sellToken.token;
                    outputToken = ?buyToken.token;
                    inputAmount = tradeSize;
                    outputAmount = ?r.amountOut;
                    priceE8s = ?quote.spotPriceE8s;
                    priceImpactBps = ?quote.priceImpactBps;
                    slippageBps = ?slippage;
                    dexId = ?quote.dexId;
                    status = #Success;
                    errorMessage = null;
                    txId = r.txId;
                    destinationOwner = null;
                });
                _rebal_lastLogId := setInMap(_rebal_lastLogId, instanceId, logId);
                // Update lastKnown: sell token decreased, buy token increased
                setLastKnownBalance(sellToken.token, null, if (sellToken.balance > tradeSize) { sellToken.balance - tradeSize } else { 0 });
                adjustLastKnownBalance(buyToken.token, null, r.amountOut);
                true
            };
            case (#Err(e)) {
                logEngine.logError(src, "Rebalance trade failed: " # tokenLabel(sellToken.token) # " → " # tokenLabel(buyToken.token) # " (" # route # "): " # e, null, [
                    ("sellToken", tokenLabel(sellToken.token)),
                    ("sellTokenId", Principal.toText(sellToken.token)),
                    ("buyToken", tokenLabel(buyToken.token)),
                    ("buyTokenId", Principal.toText(buyToken.token)),
                    ("tradeSize", Nat.toText(tradeSize)),
                    ("route", route),
                    ("error", e),
                ]);
                let logId = appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = null;
                    actionType = 0;
                    inputToken = sellToken.token;
                    outputToken = ?buyToken.token;
                    inputAmount = tradeSize;
                    outputAmount = null;
                    priceE8s = ?quote.spotPriceE8s;
                    priceImpactBps = ?quote.priceImpactBps;
                    slippageBps = ?slippage;
                    dexId = ?quote.dexId;
                    status = #Failed;
                    errorMessage = ?e;
                    txId = null;
                    destinationOwner = null;
                });
                _rebal_lastLogId := setInMap(_rebal_lastLogId, instanceId, logId);
                // On failure, balance should be unchanged (lastKnown was already set by reconcileBalance)
                false
            };
        };
    };

    /// Execute one rebalancing trade for the given instance.
    func executeRebalance(instanceId: Text): async Bool {
        let src = "chore:" # instanceId;
        let allTargets = getRebalTargets(instanceId);
        if (allTargets.size() == 0) {
            logEngine.logInfo(src, "Rebalance skipped: no targets configured", null, []);
            return false;
        };

        // Filter out paused tokens and renormalize targets
        let activeTargets = Array.filter<T.RebalanceTarget>(allTargets, func(t) { not t.paused });
        if (activeTargets.size() == 0) {
            logEngine.logInfo(src, "Rebalance skipped: all targets are paused", null, []);
            return false;
        };
        let activeTotalBps = Array.foldLeft<T.RebalanceTarget, Nat>(activeTargets, 0, func(acc, t) { acc + t.targetBps });
        // Renormalize: scale each active target's bps so they sum to 10000
        let targets = if (activeTotalBps > 0 and activeTotalBps != 10000) {
            Array.map<T.RebalanceTarget, T.RebalanceTarget>(activeTargets, func(t) {
                { token = t.token; targetBps = (t.targetBps * 10000) / activeTotalBps; paused = t.paused }
            })
        } else { activeTargets };

        let denomToken = getRebalDenomToken(instanceId);
        let threshold = getRebalThreshold(instanceId);
        let maxTrade = getRebalMaxTrade(instanceId);
        let minTrade = getRebalMinTrade(instanceId);
        let maxImpactCfg = getRebalMaxImpact(instanceId);
        let slippageCfg = getRebalMaxSlippage(instanceId);

        logEngine.logTrace(src, "executeRebalance started", null, [
            ("instanceId", instanceId),
            ("denomToken", Principal.toText(denomToken)),
            ("denomLabel", tokenLabel(denomToken)),
            ("thresholdBps", Nat.toText(threshold)),
            ("maxTrade", Nat.toText(maxTrade)),
            ("minTrade", Nat.toText(minTrade)),
            ("maxImpactBps", Nat.toText(maxImpactCfg)),
            ("maxSlippageBps", Nat.toText(slippageCfg)),
            ("targetCount", Nat.toText(targets.size())),
            ("pausedCount", Nat.toText(allTargets.size() - activeTargets.size())),
        ]);

        // 1. Value portfolio (only active/unpaused tokens)
        let tokenValues = Buffer.Buffer<{
            token: Principal;
            balance: Nat;
            value: Nat;
            targetBps: Nat;
        }>(targets.size());

        var totalValue: Nat = 0;

        for (target in targets.vals()) {
            let balance = await getBalance(target.token, null); // Main account
            reconcileBalance(target.token, null, balance, src);

            // Get value in denomination token — use cached price if available
            let value = if (target.token == denomToken) {
                logEngine.logTrace(src, "Token " # tokenLabel(target.token) # " is denom token, value = balance", null, [
                    ("token", tokenLabel(target.token)),
                    ("tokenId", Principal.toText(target.token)),
                    ("balance", Nat.toText(balance)),
                ]);
                balance
            } else {
                // Try cached quote first (populated by price-fetch phase)
                switch (getCachedQuote(target.token, denomToken)) {
                    case (?cachedQ) {
                        let v = if (cachedQ.inputAmount > 0) {
                            (balance * cachedQ.expectedOutput) / cachedQ.inputAmount
                        } else { 0 };
                        logEngine.logTrace(src, "Token " # tokenLabel(target.token) # " valued via cached quote", null, [
                            ("token", tokenLabel(target.token)),
                            ("tokenId", Principal.toText(target.token)),
                            ("balance", Nat.toText(balance)),
                            ("value", Nat.toText(v)),
                            ("cachedInputAmount", Nat.toText(cachedQ.inputAmount)),
                            ("cachedExpectedOutput", Nat.toText(cachedQ.expectedOutput)),
                            ("cachedDexId", Nat.toText(cachedQ.dexId)),
                        ]);
                        v
                    };
                    case null {
                        logEngine.logDebug(src, "No cached quote for " # tokenLabel(target.token) # " → " # tokenLabel(denomToken) # ", fetching fresh", null, [
                            ("token", tokenLabel(target.token)),
                            ("tokenId", Principal.toText(target.token)),
                            ("denomToken", tokenLabel(denomToken)),
                        ]);
                        let quoteOpt = await getBestQuote(target.token, denomToken, balance);
                        switch (quoteOpt) {
                            case (?q) {
                                logEngine.logTrace(src, "Fresh quote obtained for " # tokenLabel(target.token), null, [
                                    ("token", tokenLabel(target.token)),
                                    ("value", Nat.toText(q.expectedOutput)),
                                    ("dexId", Nat.toText(q.dexId)),
                                    ("priceImpactBps", Nat.toText(q.priceImpactBps)),
                                ]);
                                q.expectedOutput
                            };
                            case null {
                                logEngine.logDebug(src, "No quote available for " # tokenLabel(target.token) # " → " # tokenLabel(denomToken) # ", value = 0", null, [
                                    ("token", tokenLabel(target.token)),
                                    ("tokenId", Principal.toText(target.token)),
                                ]);
                                0
                            };
                        };
                    };
                };
            };

            tokenValues.add({ token = target.token; balance = balance; value = value; targetBps = target.targetBps });
            totalValue += value;
        };

        if (totalValue == 0) {
            logEngine.logInfo(src, "Rebalance skipped: portfolio value is 0", null, []);
            return false;
        };

        // Log portfolio summary
        logEngine.logDebug(src, "Portfolio valued: totalValue = " # Nat.toText(totalValue) # " " # tokenLabel(denomToken) # ", " # Nat.toText(tokenValues.size()) # " tokens", null, [
            ("totalValue", Nat.toText(totalValue)),
            ("denomToken", tokenLabel(denomToken)),
            ("tokenCount", Nat.toText(tokenValues.size())),
        ]);

        // 2. Calculate deviations
        let overweight = Buffer.Buffer<{ token: Principal; deviationBps: Nat; balance: Nat; value: Nat }>(4);
        let underweight = Buffer.Buffer<{ token: Principal; deviationBps: Nat; balance: Nat; value: Nat }>(4);

        for (tv in tokenValues.vals()) {
            let currentBps = (tv.value * 10000) / totalValue;
            let classification = if (currentBps > tv.targetBps + threshold) {
                "overweight"
            } else if (tv.targetBps > currentBps + threshold) {
                "underweight"
            } else { "within-tolerance" };

            logEngine.logTrace(src, tokenLabel(tv.token) # ": current " # Nat.toText(currentBps / 100) # "." # Nat.toText(currentBps % 100) # "% target " # Nat.toText(tv.targetBps / 100) # "." # Nat.toText(tv.targetBps % 100) # "% → " # classification, null, [
                ("token", tokenLabel(tv.token)),
                ("tokenId", Principal.toText(tv.token)),
                ("balance", Nat.toText(tv.balance)),
                ("value", Nat.toText(tv.value)),
                ("currentBps", Nat.toText(currentBps)),
                ("targetBps", Nat.toText(tv.targetBps)),
                ("thresholdBps", Nat.toText(threshold)),
                ("classification", classification),
            ]);

            if (currentBps > tv.targetBps + threshold) {
                overweight.add({
                    token = tv.token;
                    deviationBps = currentBps - tv.targetBps;
                    balance = tv.balance;
                    value = tv.value;
                });
            } else if (tv.targetBps > currentBps + threshold) {
                underweight.add({
                    token = tv.token;
                    deviationBps = tv.targetBps - currentBps;
                    balance = tv.balance;
                    value = tv.value;
                });
            };
        };

        logEngine.logDebug(src, "Deviation analysis: " # Nat.toText(overweight.size()) # " overweight, " # Nat.toText(underweight.size()) # " underweight (threshold " # Nat.toText(threshold) # " bps)", null, [
            ("overweightCount", Nat.toText(overweight.size())),
            ("underweightCount", Nat.toText(underweight.size())),
            ("thresholdBps", Nat.toText(threshold)),
        ]);

        if (overweight.size() == 0 or underweight.size() == 0) {
            logEngine.logInfo(src, "Rebalance skipped: portfolio within tolerance (threshold " # Nat.toText(threshold / 100) # "." # Nat.toText(threshold % 100) # "%, " # Nat.toText(overweight.size()) # " overweight, " # Nat.toText(underweight.size()) # " underweight)", null, [
                ("thresholdBps", Nat.toText(threshold)),
                ("overweightCount", Nat.toText(overweight.size())),
                ("underweightCount", Nat.toText(underweight.size())),
            ]);
            return false;
        };

        // Helper: get transfer fee for a token
        let getFee = func(token: Principal): Nat {
            switch (getTokenInfo(token)) {
                case (?i) i.fee;
                case null { switch (getCachedMeta(token)) { case (?e) e.fee; case null 0 } };
            }
        };

        // 3. Pair selection — weighted random, where each token's deviation
        //    is its weight in the lottery. This ensures all imbalanced pairs
        //    get a chance proportional to their severity.

        // Log all candidate tokens with their lottery weights
        for (ow in overweight.vals()) {
            logEngine.logTrace(src, "Overweight candidate: " # tokenLabel(ow.token) # " +" # Nat.toText(ow.deviationBps) # " bps", null, [
                ("token", tokenLabel(ow.token)),
                ("tokenId", Principal.toText(ow.token)),
                ("deviationBps", Nat.toText(ow.deviationBps)),
                ("balance", Nat.toText(ow.balance)),
                ("value", Nat.toText(ow.value)),
                ("side", "sell"),
            ]);
        };
        for (uw in underweight.vals()) {
            logEngine.logTrace(src, "Underweight candidate: " # tokenLabel(uw.token) # " -" # Nat.toText(uw.deviationBps) # " bps", null, [
                ("token", tokenLabel(uw.token)),
                ("tokenId", Principal.toText(uw.token)),
                ("deviationBps", Nat.toText(uw.deviationBps)),
                ("balance", Nat.toText(uw.balance)),
                ("value", Nat.toText(uw.value)),
                ("side", "buy"),
            ]);
        };

        var sellToken = overweight.get(0);
        var buyToken = underweight.get(0);
        let entropy = Int.abs(Time.now());

        // Pick overweight (sell) token — weighted by deviation
        var totalOverWeight: Nat = 0;
        for (ow in overweight.vals()) { totalOverWeight += ow.deviationBps };
        let owRand = entropy % totalOverWeight;
        var owCumulative: Nat = 0;
        var owPicked = false;
        for (ow in overweight.vals()) {
            if (not owPicked) {
                owCumulative += ow.deviationBps;
                if (owCumulative > owRand) {
                    sellToken := ow;
                    owPicked := true;
                };
            };
        };

        // Pick underweight (buy) token — weighted by deviation
        var totalUnderWeight: Nat = 0;
        for (uw in underweight.vals()) { totalUnderWeight += uw.deviationBps };
        let uwRand = (entropy / 1000) % totalUnderWeight;
        var uwCumulative: Nat = 0;
        var uwPicked = false;
        for (uw in underweight.vals()) {
            if (not uwPicked) {
                uwCumulative += uw.deviationBps;
                if (uwCumulative > uwRand) {
                    buyToken := uw;
                    uwPicked := true;
                };
            };
        };

        logEngine.logDebug(src, "Lottery result: sell " # tokenLabel(sellToken.token) # " (weight " # Nat.toText(sellToken.deviationBps) # "/" # Nat.toText(totalOverWeight) # " = " # Nat.toText((sellToken.deviationBps * 100) / totalOverWeight) # "%, draw " # Nat.toText(owRand) # ") → buy " # tokenLabel(buyToken.token) # " (weight " # Nat.toText(buyToken.deviationBps) # "/" # Nat.toText(totalUnderWeight) # " = " # Nat.toText((buyToken.deviationBps * 100) / totalUnderWeight) # "%, draw " # Nat.toText(uwRand) # ")", null, [
            ("sellToken", tokenLabel(sellToken.token)),
            ("sellTokenId", Principal.toText(sellToken.token)),
            ("sellDeviationBps", Nat.toText(sellToken.deviationBps)),
            ("sellWeight", Nat.toText(sellToken.deviationBps) # "/" # Nat.toText(totalOverWeight)),
            ("sellWeightPct", Nat.toText((sellToken.deviationBps * 100) / totalOverWeight)),
            ("sellDraw", Nat.toText(owRand)),
            ("buyToken", tokenLabel(buyToken.token)),
            ("buyTokenId", Principal.toText(buyToken.token)),
            ("buyDeviationBps", Nat.toText(buyToken.deviationBps)),
            ("buyWeight", Nat.toText(buyToken.deviationBps) # "/" # Nat.toText(totalUnderWeight)),
            ("buyWeightPct", Nat.toText((buyToken.deviationBps * 100) / totalUnderWeight)),
            ("buyDraw", Nat.toText(uwRand)),
        ]);

        // 4. Calculate trade size — check if target-reaching is possible,
        //    otherwise use conservative partial sizing.
        let fee = getFee(sellToken.token);
        let maxAffordable = if (sellToken.balance > fee * 3) { sellToken.balance - fee * 3 } else { 0 };
        let excessSellValue = (totalValue * sellToken.deviationBps) / 10000;
        let deficitBuyValue = (totalValue * buyToken.deviationBps) / 10000;
        let capDenomValue = Nat.min(excessSellValue, deficitBuyValue);
        let targetReachUnits = if (sellToken.value > 0) {
            (capDenomValue * sellToken.balance) / sellToken.value
        } else { 0 };
        let effectiveTargetReach = Nat.min(targetReachUnits, maxAffordable);

        logEngine.logTrace(src, "Trade size calculation for " # tokenLabel(sellToken.token) # " → " # tokenLabel(buyToken.token), null, [
            ("sellToken", tokenLabel(sellToken.token)),
            ("buyToken", tokenLabel(buyToken.token)),
            ("sellBalance", Nat.toText(sellToken.balance)),
            ("sellValue", Nat.toText(sellToken.value)),
            ("buyBalance", Nat.toText(buyToken.balance)),
            ("buyValue", Nat.toText(buyToken.value)),
            ("fee", Nat.toText(fee)),
            ("maxAffordable", Nat.toText(maxAffordable)),
            ("excessSellValue", Nat.toText(excessSellValue)),
            ("deficitBuyValue", Nat.toText(deficitBuyValue)),
            ("capDenomValue", Nat.toText(capDenomValue)),
            ("targetReachUnits", Nat.toText(targetReachUnits)),
            ("effectiveTargetReach", Nat.toText(effectiveTargetReach)),
            ("minTrade", Nat.toText(minTrade)),
            ("maxTrade", Nat.toText(maxTrade)),
            ("balanceDiv4", Nat.toText(sellToken.balance / 4)),
            ("totalValue", Nat.toText(totalValue)),
        ]);

        var tradeSize: Nat = 0;

        if (effectiveTargetReach >= minTrade and effectiveTargetReach <= maxTrade) {
            // Target-reaching: this pair can be completed in one trade
            tradeSize := effectiveTargetReach;
            logEngine.logInfo(src, "Pair selected (target-reaching): sell " # tokenLabel(sellToken.token) # " (+" # Nat.toText(sellToken.deviationBps / 100) # "." # Nat.toText(sellToken.deviationBps % 100) # "% over) → buy " # tokenLabel(buyToken.token) # " (-" # Nat.toText(buyToken.deviationBps / 100) # "." # Nat.toText(buyToken.deviationBps % 100) # "% under), trade " # Nat.toText(tradeSize) # " units", null, [
                ("sellToken", tokenLabel(sellToken.token)),
                ("sellTokenId", Principal.toText(sellToken.token)),
                ("buyToken", tokenLabel(buyToken.token)),
                ("buyTokenId", Principal.toText(buyToken.token)),
                ("tradeSize", Nat.toText(tradeSize)),
                ("sellDeviationBps", Nat.toText(sellToken.deviationBps)),
                ("buyDeviationBps", Nat.toText(buyToken.deviationBps)),
                ("combinedDeviationBps", Nat.toText(sellToken.deviationBps + buyToken.deviationBps)),
                ("mode", "target-reaching"),
            ]);
        } else {
            // Partial trade: use conservative sizing with overshoot cap
            let overshootCap = targetReachUnits;
            tradeSize := Nat.min(maxTrade, Nat.min(maxAffordable, Nat.min(sellToken.balance / 4, overshootCap)));

            logEngine.logTrace(src, "Partial trade sizing breakdown", null, [
                ("overshootCap", Nat.toText(overshootCap)),
                ("balanceDiv4", Nat.toText(sellToken.balance / 4)),
                ("maxAffordable", Nat.toText(maxAffordable)),
                ("maxTrade", Nat.toText(maxTrade)),
                ("resultTradeSize", Nat.toText(tradeSize)),
                ("limitingFactor", if (tradeSize == overshootCap) { "overshootCap" } else if (tradeSize == sellToken.balance / 4) { "balanceDiv4" } else if (tradeSize == maxAffordable) { "maxAffordable" } else { "maxTrade" }),
            ]);

            logEngine.logInfo(src, "Pair selected (partial): sell " # tokenLabel(sellToken.token) # " (+" # Nat.toText(sellToken.deviationBps / 100) # "." # Nat.toText(sellToken.deviationBps % 100) # "% over) → buy " # tokenLabel(buyToken.token) # " (-" # Nat.toText(buyToken.deviationBps / 100) # "." # Nat.toText(buyToken.deviationBps % 100) # "% under), trade " # Nat.toText(tradeSize) # " units (cap: " # Nat.toText(overshootCap) # ", targetReach: " # Nat.toText(targetReachUnits) # ")", null, [
                ("sellToken", tokenLabel(sellToken.token)),
                ("sellTokenId", Principal.toText(sellToken.token)),
                ("buyToken", tokenLabel(buyToken.token)),
                ("buyTokenId", Principal.toText(buyToken.token)),
                ("tradeSize", Nat.toText(tradeSize)),
                ("overshootCap", Nat.toText(overshootCap)),
                ("targetReachUnits", Nat.toText(targetReachUnits)),
                ("maxAffordable", Nat.toText(maxAffordable)),
                ("sellDeviationBps", Nat.toText(sellToken.deviationBps)),
                ("buyDeviationBps", Nat.toText(buyToken.deviationBps)),
                ("combinedDeviationBps", Nat.toText(sellToken.deviationBps + buyToken.deviationBps)),
                ("mode", "partial"),
            ]);
        };

        if (tradeSize < minTrade) {
            logEngine.logInfo(src, "Rebalance skipped: trade size " # Nat.toText(tradeSize) # " < min " # Nat.toText(minTrade) # " for " # tokenLabel(sellToken.token) # " → " # tokenLabel(buyToken.token), null, [
                ("sellToken", tokenLabel(sellToken.token)),
                ("buyToken", tokenLabel(buyToken.token)),
                ("tradeSize", Nat.toText(tradeSize)),
                ("minTrade", Nat.toText(minTrade)),
            ]);
            // Log as skipped in trade log
            ignore appendTradeLog({
                choreId = ?instanceId;
                choreTypeId = getInstanceTypeId(instanceId);
                actionId = null;
                actionType = 0;
                inputToken = sellToken.token;
                outputToken = ?buyToken.token;
                inputAmount = tradeSize;
                outputAmount = null;
                priceE8s = null;
                priceImpactBps = null;
                slippageBps = null;
                dexId = null;
                status = #Skipped;
                errorMessage = ?("Trade size " # Nat.toText(tradeSize) # " < min " # Nat.toText(minTrade));
                txId = null;
                destinationOwner = null;
            });
            return false;
        };

        // 5. Get quote and validate — with configurable fallback routing for illiquid pairs
        let maxImpact = maxImpactCfg;
        let slippage = slippageCfg;

        logEngine.logDebug(src, "Fetching direct quote: " # tokenLabel(sellToken.token) # " → " # tokenLabel(buyToken.token) # " amount " # Nat.toText(tradeSize), null, [
            ("sellToken", tokenLabel(sellToken.token)),
            ("sellTokenId", Principal.toText(sellToken.token)),
            ("buyToken", tokenLabel(buyToken.token)),
            ("buyTokenId", Principal.toText(buyToken.token)),
            ("tradeSize", Nat.toText(tradeSize)),
            ("maxImpactBps", Nat.toText(maxImpact)),
            ("maxSlippageBps", Nat.toText(slippage)),
        ]);

        // Try direct quote first
        let directQuoteOpt = await getBestQuote(sellToken.token, buyToken.token, tradeSize);
        let directOk = switch (directQuoteOpt) {
            case (?q) {
                logEngine.logTrace(src, "Direct quote received: " # Nat.toText(q.expectedOutput) # " " # tokenLabel(buyToken.token) # " (dex " # Nat.toText(q.dexId) # ", impact " # Nat.toText(q.priceImpactBps) # " bps, spot " # Nat.toText(q.spotPriceE8s) # ")", null, [
                    ("expectedOutput", Nat.toText(q.expectedOutput)),
                    ("spotPriceE8s", Nat.toText(q.spotPriceE8s)),
                    ("priceImpactBps", Nat.toText(q.priceImpactBps)),
                    ("dexId", Nat.toText(q.dexId)),
                    ("maxImpactBps", Nat.toText(maxImpact)),
                    ("impactOk", if (q.priceImpactBps <= maxImpact) { "yes" } else { "no" }),
                ]);
                q.priceImpactBps <= maxImpact
            };
            case null {
                logEngine.logTrace(src, "Direct quote: no quote available for " # tokenLabel(sellToken.token) # " → " # tokenLabel(buyToken.token), null, [
                    ("sellToken", tokenLabel(sellToken.token)),
                    ("buyToken", tokenLabel(buyToken.token)),
                ]);
                false
            };
        };

        if (directOk) {
            // --- 6a. Direct trade path ---
            let quote = switch (directQuoteOpt) { case (?q) q; case null { return false } };
            logEngine.logDebug(src, "Executing direct swap: " # tokenLabel(sellToken.token) # " → " # tokenLabel(buyToken.token) # " on dex " # Nat.toText(quote.dexId) # " amount " # Nat.toText(tradeSize) # " slippage " # Nat.toText(slippage) # " bps", null, [
                ("route", "direct"),
                ("dexId", Nat.toText(quote.dexId)),
                ("tradeSize", Nat.toText(tradeSize)),
                ("expectedOutput", Nat.toText(quote.expectedOutput)),
                ("slippageBps", Nat.toText(slippage)),
            ]);
            return await _rebalExecuteAndLog(instanceId, src, sellToken, buyToken, quote, slippage, tradeSize, "direct");
        };

        // --- 6b. Fallback routing (sell → intermediary → buy) ---
        let fallbackTokens = getRebalFallbackRouteTokens(instanceId);

        // Check if a token is paused in the rebalance targets
        let isTokenPaused = func(token: Principal): Bool {
            for (t in allTargets.vals()) {
                if (t.token == token and t.paused) return true;
            };
            false
        };

        logEngine.logInfo(src, "Direct quote insufficient for " # tokenLabel(sellToken.token) # " → " # tokenLabel(buyToken.token) # ", trying fallback routes (" # Nat.toText(fallbackTokens.size()) # " candidates)", null, [
            ("sellToken", tokenLabel(sellToken.token)),
            ("buyToken", tokenLabel(buyToken.token)),
            ("directImpact", switch (directQuoteOpt) { case (?q) Nat.toText(q.priceImpactBps) # " bps"; case null "no quote" }),
            ("fallbackCount", Nat.toText(fallbackTokens.size())),
        ]);

        // Phase 1: Find a viable fallback route (quotes only, no execution yet)
        var chosenIntermediary: ?Principal = null;
        var chosenLeg1: ?T.SwapQuote = null;
        var chosenLeg2: ?T.SwapQuote = null;
        var routeIdx: Nat = 0;
        while (chosenIntermediary == null and routeIdx < fallbackTokens.size()) {
            let intermediary = fallbackTokens[routeIdx];
            routeIdx += 1;
            let intLabel = tokenLabel(intermediary);

            // Skip if intermediary is same as sell or buy token
            if (intermediary == sellToken.token or intermediary == buyToken.token) {
                logEngine.logTrace(src, "Skipping fallback via " # intLabel # ": same as sell/buy token", null, [
                    ("intermediary", intLabel),
                    ("intermediaryId", Principal.toText(intermediary)),
                ]);
            } else if (isTokenPaused(intermediary)) {
                // Skip paused intermediary tokens
                logEngine.logTrace(src, "Skipping fallback via " # intLabel # ": token is paused", null, [
                    ("intermediary", intLabel),
                    ("intermediaryId", Principal.toText(intermediary)),
                ]);
            } else {
                // Try leg 1: sell → intermediary
                logEngine.logDebug(src, "Trying fallback via " # intLabel # " — leg1: " # tokenLabel(sellToken.token) # " → " # intLabel # ", amount " # Nat.toText(tradeSize), null, [
                    ("intermediary", intLabel),
                    ("leg", "1"),
                    ("sellToken", tokenLabel(sellToken.token)),
                    ("amount", Nat.toText(tradeSize)),
                ]);
                let leg1Opt = await getBestQuote(sellToken.token, intermediary, tradeSize);
                switch (leg1Opt) {
                    case (?q1) {
                        if (q1.priceImpactBps > maxImpact) {
                            logEngine.logTrace(src, "Fallback via " # intLabel # " leg1 impact too high: " # Nat.toText(q1.priceImpactBps) # " bps > max " # Nat.toText(maxImpact) # " bps", null, [
                                ("intermediary", intLabel),
                                ("leg", "1"),
                                ("priceImpactBps", Nat.toText(q1.priceImpactBps)),
                            ]);
                        } else {
                            // Leg 1 OK — try leg 2: intermediary → buy
                            let leg2Opt = await getBestQuote(intermediary, buyToken.token, q1.expectedOutput);
                            switch (leg2Opt) {
                                case (?q2) {
                                    if (q2.priceImpactBps > maxImpact) {
                                        logEngine.logTrace(src, "Fallback via " # intLabel # " leg2 impact too high: " # Nat.toText(q2.priceImpactBps) # " bps > max " # Nat.toText(maxImpact) # " bps", null, [
                                            ("intermediary", intLabel),
                                            ("leg", "2"),
                                            ("priceImpactBps", Nat.toText(q2.priceImpactBps)),
                                        ]);
                                    } else {
                                        // Both legs viable — choose this route
                                        chosenIntermediary := ?intermediary;
                                        chosenLeg1 := ?q1;
                                        chosenLeg2 := ?q2;
                                        logEngine.logDebug(src, "Viable fallback route found via " # intLabel # " (leg1 impact: " # Nat.toText(q1.priceImpactBps) # " bps, leg2 impact: " # Nat.toText(q2.priceImpactBps) # " bps)", null, [
                                            ("intermediary", intLabel),
                                            ("leg1ImpactBps", Nat.toText(q1.priceImpactBps)),
                                            ("leg2ImpactBps", Nat.toText(q2.priceImpactBps)),
                                        ]);
                                    };
                                };
                                case null {
                                    logEngine.logTrace(src, "Fallback via " # intLabel # " leg2: no quote for " # intLabel # " → " # tokenLabel(buyToken.token), null, [
                                        ("intermediary", intLabel),
                                        ("leg", "2"),
                                    ]);
                                };
                            };
                        };
                    };
                    case null {
                        logEngine.logTrace(src, "Fallback via " # intLabel # " leg1: no quote for " # tokenLabel(sellToken.token) # " → " # intLabel, null, [
                            ("intermediary", intLabel),
                            ("leg", "1"),
                        ]);
                    };
                };
            };
        };

        // Phase 2: If no viable route found, log and skip
        let intermediary = switch (chosenIntermediary) {
            case null {
                let reason = switch (directQuoteOpt) {
                    case null { "no liquidity (direct or via " # Nat.toText(fallbackTokens.size()) # " fallback tokens)" };
                    case (?q) { "price impact too high (direct: " # Nat.toText(q.priceImpactBps) # " bps, " # Nat.toText(fallbackTokens.size()) # " fallback tokens also failed)" };
                };
                logEngine.logWarning(src, "Rebalance skipped (" # tokenLabel(sellToken.token) # " → " # tokenLabel(buyToken.token) # "): " # reason, null, [
                    ("sellToken", tokenLabel(sellToken.token)),
                    ("buyToken", tokenLabel(buyToken.token)),
                    ("tradeSize", Nat.toText(tradeSize)),
                    ("reason", reason),
                    ("fallbackTokensTried", Nat.toText(fallbackTokens.size())),
                ]);
                ignore appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = null;
                    actionType = 0;
                    inputToken = sellToken.token;
                    outputToken = ?buyToken.token;
                    inputAmount = tradeSize;
                    outputAmount = null;
                    priceE8s = switch (directQuoteOpt) { case (?q) ?q.spotPriceE8s; case null null };
                    priceImpactBps = switch (directQuoteOpt) { case (?q) ?q.priceImpactBps; case null null };
                    slippageBps = ?slippage;
                    dexId = switch (directQuoteOpt) { case (?q) ?q.dexId; case null null };
                    status = #Skipped;
                    errorMessage = ?reason;
                    txId = null;
                    destinationOwner = null;
                });
                return false;
            };
            case (?p) p;
        };
        let leg1Quote = switch (chosenLeg1) { case (?q) q; case null { return false } };
        let leg2Quote = switch (chosenLeg2) { case (?q) q; case null { return false } };
        let intLabel = tokenLabel(intermediary);
        let routeLabel = "via-" # intLabel;

        logEngine.logInfo(src, "Routing via " # intLabel # ": " # tokenLabel(sellToken.token) # " → " # intLabel # " → " # tokenLabel(buyToken.token) # " (leg1 impact: " # Nat.toText(leg1Quote.priceImpactBps) # " bps, leg2 impact: " # Nat.toText(leg2Quote.priceImpactBps) # " bps)", null, [
            ("sellToken", tokenLabel(sellToken.token)),
            ("buyToken", tokenLabel(buyToken.token)),
            ("intermediary", intLabel),
            ("intermediaryId", Principal.toText(intermediary)),
            ("leg1ImpactBps", Nat.toText(leg1Quote.priceImpactBps)),
            ("leg2ImpactBps", Nat.toText(leg2Quote.priceImpactBps)),
            ("tradeSize", Nat.toText(tradeSize)),
            ("leg1ExpectedOutput", Nat.toText(leg1Quote.expectedOutput)),
        ]);

        // Phase 3: Execute leg 1 (sell → intermediary)
        logEngine.logDebug(src, "Executing " # routeLabel # " leg1: " # tokenLabel(sellToken.token) # " → " # intLabel # " on dex " # Nat.toText(leg1Quote.dexId) # " amount " # Nat.toText(tradeSize) # " expected " # Nat.toText(leg1Quote.expectedOutput) # " " # intLabel, null, [
            ("leg", "1"),
            ("dexId", Nat.toText(leg1Quote.dexId)),
            ("tradeSize", Nat.toText(tradeSize)),
            ("expectedOutput", Nat.toText(leg1Quote.expectedOutput)),
            ("slippageBps", Nat.toText(slippage)),
        ]);
        let leg1Result = await executeSwap(leg1Quote, slippage);
        let intermediaryReceived = switch (leg1Result) {
            case (#Ok(r)) {
                logEngine.logTrace(src, routeLabel # " leg1 executed OK: received " # Nat.toText(r.amountOut) # " " # intLabel, null, [
                    ("leg", "1"),
                    ("amountOut", Nat.toText(r.amountOut)),
                    ("txId", switch (r.txId) { case (?t) Nat.toText(t); case null "none" }),
                ]);
                r.amountOut
            };
            case (#Err(e)) {
                logEngine.logError(src, "Rebalance " # routeLabel # " leg1 failed (" # tokenLabel(sellToken.token) # " → " # intLabel # "): " # e, null, [
                    ("sellToken", tokenLabel(sellToken.token)),
                    ("buyToken", tokenLabel(buyToken.token)),
                    ("intermediary", intLabel),
                    ("route", routeLabel),
                    ("leg", "1"),
                    ("tradeSize", Nat.toText(tradeSize)),
                    ("error", e),
                ]);
                let logId = appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = null;
                    actionType = 0;
                    inputToken = sellToken.token;
                    outputToken = ?intermediary;
                    inputAmount = tradeSize;
                    outputAmount = null;
                    priceE8s = ?leg1Quote.spotPriceE8s;
                    priceImpactBps = ?leg1Quote.priceImpactBps;
                    slippageBps = ?slippage;
                    dexId = ?leg1Quote.dexId;
                    status = #Failed;
                    errorMessage = ?(routeLabel # " leg1: " # e);
                    txId = null;
                    destinationOwner = null;
                });
                _rebal_lastLogId := setInMap(_rebal_lastLogId, instanceId, logId);
                return false;
            };
        };

        // Log leg 1 success
        ignore appendTradeLog({
            choreId = ?instanceId;
            choreTypeId = getInstanceTypeId(instanceId);
            actionId = null;
            actionType = 0;
            inputToken = sellToken.token;
            outputToken = ?intermediary;
            inputAmount = tradeSize;
            outputAmount = ?intermediaryReceived;
            priceE8s = ?leg1Quote.spotPriceE8s;
            priceImpactBps = ?leg1Quote.priceImpactBps;
            slippageBps = ?slippage;
            dexId = ?leg1Quote.dexId;
            status = #Success;
            errorMessage = null;
            txId = null;
            destinationOwner = null;
        });
        // Update lastKnown after leg 1: sellToken decreased, intermediary increased
        setLastKnownBalance(sellToken.token, null, if (sellToken.balance > tradeSize) { sellToken.balance - tradeSize } else { 0 });
        adjustLastKnownBalance(intermediary, null, intermediaryReceived);

        // Phase 4: Execute leg 2 (intermediary → buy) with fresh quote
        logEngine.logDebug(src, "Fetching fresh leg2 quote with actual " # intLabel # " received: " # Nat.toText(intermediaryReceived) # " " # intLabel # " → " # tokenLabel(buyToken.token), null, [
            ("leg", "2-fresh"),
            ("intermediaryReceived", Nat.toText(intermediaryReceived)),
            ("buyToken", tokenLabel(buyToken.token)),
            ("buyTokenId", Principal.toText(buyToken.token)),
        ]);
        let leg2FreshQuoteOpt = await getBestQuote(intermediary, buyToken.token, intermediaryReceived);
        let leg2FreshQuote = switch (leg2FreshQuoteOpt) {
            case (?q) {
                logEngine.logTrace(src, "Fresh leg2 quote received: " # Nat.toText(q.expectedOutput) # " " # tokenLabel(buyToken.token) # " (dex " # Nat.toText(q.dexId) # ", impact " # Nat.toText(q.priceImpactBps) # " bps)", null, [
                    ("leg", "2-fresh"),
                    ("expectedOutput", Nat.toText(q.expectedOutput)),
                    ("spotPriceE8s", Nat.toText(q.spotPriceE8s)),
                    ("priceImpactBps", Nat.toText(q.priceImpactBps)),
                    ("dexId", Nat.toText(q.dexId)),
                ]);
                q
            };
            case null {
                logEngine.logError(src, "Rebalance " # routeLabel # ": leg1 succeeded (" # Nat.toText(intermediaryReceived) # " " # intLabel # ") but no quote for leg2 " # intLabel # " → " # tokenLabel(buyToken.token) # " (" # intLabel # " stuck in canister)", null, [
                    ("intermediaryReceived", Nat.toText(intermediaryReceived)),
                    ("intermediary", intLabel),
                    ("buyToken", tokenLabel(buyToken.token)),
                    ("buyTokenId", Principal.toText(buyToken.token)),
                ]);
                return false;
            };
        };

        logEngine.logDebug(src, "Executing " # routeLabel # " leg2: " # intLabel # " → " # tokenLabel(buyToken.token) # " on dex " # Nat.toText(leg2FreshQuote.dexId) # " amount " # Nat.toText(intermediaryReceived) # " " # intLabel # " expected " # Nat.toText(leg2FreshQuote.expectedOutput) # " " # tokenLabel(buyToken.token), null, [
            ("leg", "2"),
            ("dexId", Nat.toText(leg2FreshQuote.dexId)),
            ("intermediaryAmount", Nat.toText(intermediaryReceived)),
            ("expectedOutput", Nat.toText(leg2FreshQuote.expectedOutput)),
            ("slippageBps", Nat.toText(slippage)),
        ]);
        let leg2Result = await executeSwap(leg2FreshQuote, slippage);
        switch (leg2Result) {
            case (#Ok(r)) {
                logEngine.logInfo(src, "Rebalance " # routeLabel # " complete: sold " # Nat.toText(tradeSize) # " " # tokenLabel(sellToken.token) # " → " # Nat.toText(intermediaryReceived) # " " # intLabel # " → " # Nat.toText(r.amountOut) # " " # tokenLabel(buyToken.token), null, [
                    ("sellToken", tokenLabel(sellToken.token)),
                    ("buyToken", tokenLabel(buyToken.token)),
                    ("intermediary", intLabel),
                    ("intermediaryId", Principal.toText(intermediary)),
                    ("sellAmount", Nat.toText(tradeSize)),
                    ("intermediaryAmount", Nat.toText(intermediaryReceived)),
                    ("buyAmount", Nat.toText(r.amountOut)),
                    ("leg1DexId", Nat.toText(leg1Quote.dexId)),
                    ("leg2DexId", Nat.toText(leg2FreshQuote.dexId)),
                    ("leg1ImpactBps", Nat.toText(leg1Quote.priceImpactBps)),
                    ("leg2ImpactBps", Nat.toText(leg2FreshQuote.priceImpactBps)),
                    ("route", routeLabel),
                    ("txId", switch (r.txId) { case (?t) Nat.toText(t); case null "none" }),
                ]);
                let logId = appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = null;
                    actionType = 0;
                    inputToken = intermediary;
                    outputToken = ?buyToken.token;
                    inputAmount = intermediaryReceived;
                    outputAmount = ?r.amountOut;
                    priceE8s = ?leg2FreshQuote.spotPriceE8s;
                    priceImpactBps = ?leg2FreshQuote.priceImpactBps;
                    slippageBps = ?slippage;
                    dexId = ?leg2FreshQuote.dexId;
                    status = #Success;
                    errorMessage = null;
                    txId = r.txId;
                    destinationOwner = null;
                });
                _rebal_lastLogId := setInMap(_rebal_lastLogId, instanceId, logId);
                // Update lastKnown after leg 2: intermediary decreased, buyToken increased
                switch (getLastKnownBalance(intermediary, null)) {
                    case (?prev) { setLastKnownBalance(intermediary, null, if (prev > intermediaryReceived) { prev - intermediaryReceived } else { 0 }) };
                    case null {};
                };
                adjustLastKnownBalance(buyToken.token, null, r.amountOut);
                true
            };
            case (#Err(e)) {
                logEngine.logError(src, "Rebalance " # routeLabel # " leg2 failed (" # intLabel # " → " # tokenLabel(buyToken.token) # "): " # e # " — " # Nat.toText(intermediaryReceived) # " " # intLabel # " stuck in canister", null, [
                    ("sellToken", tokenLabel(sellToken.token)),
                    ("buyToken", tokenLabel(buyToken.token)),
                    ("intermediary", intLabel),
                    ("intermediaryAmount", Nat.toText(intermediaryReceived)),
                    ("route", routeLabel),
                    ("leg", "2"),
                    ("error", e),
                ]);
                let logId = appendTradeLog({
                    choreId = ?instanceId;
                    choreTypeId = getInstanceTypeId(instanceId);
                    actionId = null;
                    actionType = 0;
                    inputToken = intermediary;
                    outputToken = ?buyToken.token;
                    inputAmount = intermediaryReceived;
                    outputAmount = null;
                    priceE8s = ?leg2FreshQuote.spotPriceE8s;
                    priceImpactBps = ?leg2FreshQuote.priceImpactBps;
                    slippageBps = ?slippage;
                    dexId = ?leg2FreshQuote.dexId;
                    status = #Failed;
                    errorMessage = ?(routeLabel # " leg2: " # e);
                    txId = null;
                    destinationOwner = null;
                });
                _rebal_lastLogId := setInMap(_rebal_lastLogId, instanceId, logId);
                false
            };
        };
    };

    /// Create a task function that takes a portfolio snapshot for all rebalance target tokens.
    /// Used as before/after trade snapshot tasks in the rebalancer pipeline.
    func _makeRebalSnapshotTaskFn(tokens: [Principal], phase: T.SnapshotPhase, instanceId: Text): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            try {
                let snaps = await takeTokenSnapshots(tokens);
                let trigger = switch (phase) {
                    case (#Before) { "Rebalance pre-trade" };
                    case (#After) { "Rebalance post-trade" };
                };
                let tradeLogId: ?Nat = switch (phase) {
                    case (#After) { getFromMap(_rebal_lastLogId, instanceId, null) };
                    case (#Before) { null };
                };
                let totalIcp = Array.foldLeft<T.TokenSnapshot, Nat>(snaps, 0, func(acc, s) { acc + (switch (s.valueIcpE8s) { case (?v) v; case null 0 }) });
                let totalUsd = Array.foldLeft<T.TokenSnapshot, Nat>(snaps, 0, func(acc, s) { acc + (switch (s.valueUsdE8s) { case (?v) v; case null 0 }) });
                ignore appendPortfolioSnapshot({
                    trigger = trigger;
                    tradeLogId = tradeLogId;
                    phase = phase;
                    choreId = ?instanceId;
                    subaccount = null;
                    denominationToken = null;
                    totalValueIcpE8s = ?totalIcp;
                    totalValueUsdE8s = ?totalUsd;
                    totalValueDenomE8s = null;
                    tokens = snaps;
                });
                #Done
            } catch (e) {
                logEngine.logWarning("chore:" # instanceId, "Rebalance snapshot failed: " # Error.message(e), null, []);
                #Done
            }
        }
    };

    // ============================================
    // DISTRIBUTION HELPERS (reused from staking bot pattern)
    // ============================================

    // Transient per-instance state for distribution conductor
    transient var _df_state: [(Text, { lists: [DistributionTypes.DistributionList]; index: Nat })] = [];

    func _df_getState(instanceId: Text): { lists: [DistributionTypes.DistributionList]; index: Nat } {
        getFromMap(_df_state, instanceId, { lists = []; index = 0 })
    };
    func _df_setState(instanceId: Text, s: { lists: [DistributionTypes.DistributionList]; index: Nat }) {
        _df_state := setInMap(_df_state, instanceId, s)
    };

    func _df_makeTaskFn(list: DistributionTypes.DistributionList): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            try {
                let ledger = getLedger(list.tokenLedgerCanisterId);
                let fee = await ledger.icrc1_fee();
                let balance = await ledger.icrc1_balance_of({
                    owner = Principal.fromActor(this);
                    subaccount = list.sourceSubaccount;
                });
                reconcileBalance(list.tokenLedgerCanisterId, list.sourceSubaccount, balance, "distribution");

                if (balance < list.thresholdAmount) {
                    return #Done; // Below threshold, skip
                };

                let distributable = Nat.min(balance, list.maxDistributionAmount);
                let totalFees = fee * list.targets.size();
                if (distributable <= totalFees) {
                    return #Done; // Not enough to cover fees
                };
                let net = distributable - totalFees;

                // Calculate shares based on basis points
                var assignedBps: Nat = 0;
                var autoSplitCount: Nat = 0;
                for (t in list.targets.vals()) {
                    switch (t.basisPoints) {
                        case (?bp) { assignedBps += bp };
                        case null { autoSplitCount += 1 };
                    };
                };

                var totalDistributed: Nat = 0;
                var transferCount: Nat = 0;
                for (target in list.targets.vals()) {
                    let share = switch (target.basisPoints) {
                        case (?bp) { (net * bp) / 10000 };
                        case null {
                            if (autoSplitCount > 0 and assignedBps < 10000) {
                                let remainder = net * (10000 - assignedBps) / 10000;
                                remainder / autoSplitCount
                            } else { 0 }
                        };
                    };

                    if (share > fee) {
                        ignore await ledger.icrc1_transfer({
                            to = { owner = target.account.owner; subaccount = target.account.subaccount };
                            fee = ?fee;
                            memo = null;
                            from_subaccount = list.sourceSubaccount;
                            created_at_time = null;
                            amount = share;
                        });
                        totalDistributed += share;
                        transferCount += 1;
                    };
                };

                // Update lastKnown: source decreased by distributed amounts + fees
                let totalSpent = totalDistributed + (fee * transferCount);
                setLastKnownBalance(list.tokenLedgerCanisterId, list.sourceSubaccount, if (balance > totalSpent) { balance - totalSpent } else { 0 });

                // Track capital outflow (distributed to external recipients)
                if (totalDistributed > 0) {
                    let (icpVal, usdVal) = valueTokenInIcpAndUsd(list.tokenLedgerCanisterId, totalDistributed);
                    capitalDeployedIcpE8s -= icpVal;
                    capitalDeployedUsdE8s -= usdVal;
                    recordTokenOutflow(list.tokenLedgerCanisterId, totalDistributed);
                };

                #Done
            } catch (e) {
                #Error("Distribution failed: " # Error.message(e))
            }
        }
    };

    func _df_startCurrentTask(instanceId: Text) {
        let st = _df_getState(instanceId);
        if (st.index < st.lists.size()) {
            let list = st.lists[st.index];
            // Before-snapshot of the distribution source token/account
            let pairs: [(Principal, ?Blob)] = [(list.tokenLedgerCanisterId, list.sourceSubaccount)];
            let triggerPrefix = "Distribution " # list.name;
            let taskFn = _makeAccountSnapshotTaskFn(pairs, #Before, instanceId, list.id, triggerPrefix);
            choreEngine.setPendingTask(instanceId, "dist-snap-before-" # Nat.toText(list.id), taskFn);
        };
    };

    // ============================================
    // PREPARATORY TASKS — METADATA & PRICE CACHING
    // ============================================

    /// Get batch index progress for a preparatory task instance.
    func _prepGetIndex(map: [(Text, Nat)], key: Text): Nat {
        for ((k, v) in map.vals()) { if (k == key) return v };
        0
    };

    /// Set batch index progress for a preparatory task instance.
    func _prepSetIndex(map: [(Text, Nat)], key: Text, idx: Nat): [(Text, Nat)] {
        var found = false;
        let updated = Array.map<(Text, Nat), (Text, Nat)>(map,
            func((k, v)) { if (k == key) { found := true; (k, idx) } else { (k, v) } }
        );
        if (found) updated else Array.append(updated, [(key, idx)])
    };

    /// Build a task function that refreshes token metadata in batches of 10.
    /// Returns #Continue while more tokens remain, #Done when all are fresh.
    func _makeRefreshMetadataTask(taskKey: Text, tokens: [Principal]): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            let startIdx = _prepGetIndex(_prep_metaIndex, taskKey);
            let batchEnd = Nat.min(startIdx + 10, tokens.size());
            var i = startIdx;
            while (i < batchEnd) {
                let token = tokens[i];
                // Check registry first, then cache with staleness
                switch (getTokenInfo(token)) {
                    case (?_) {}; // Already in registry, skip
                    case null {
                        switch (getCachedMeta(token)) {
                            case (?_) {}; // Fresh in cache, skip
                            case null {
                                // Fetch from ledger and cache
                                try {
                                    ignore await getTokenInfoOrFetch(token);
                                } catch (e) {
                                    logEngine.logWarning("prep", "Failed to fetch metadata for " # Principal.toText(token) # ": " # Error.message(e), null, []);
                                };
                            };
                        };
                    };
                };
                i += 1;
            };
            _prep_metaIndex := _prepSetIndex(_prep_metaIndex, taskKey, batchEnd);
            if (batchEnd >= tokens.size()) {
                // Clean up index tracking
                _prep_metaIndex := Array.filter<(Text, Nat)>(_prep_metaIndex, func((k, _)) { k != taskKey });
                #Done
            } else {
                #Continue
            }
        }
    };

    /// Build a task function that fetches price quotes in batches of 10.
    /// Returns #Continue while more pairs remain, #Done when all are fetched.
    func _makeFetchPricesTask(taskKey: Text, pairs: [(Principal, Principal)]): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            let startIdx = _prepGetIndex(_prep_priceIndex, taskKey);
            let batchEnd = Nat.min(startIdx + 10, pairs.size());
            var i = startIdx;
            while (i < batchEnd) {
                let (inputToken, outputToken) = pairs[i];
                // Skip if we already have a cached quote for this pair
                switch (getCachedQuote(inputToken, outputToken)) {
                    case (?_) {};
                    case null {
                        try {
                            // Use a reference amount of 1 full token unit for price discovery
                            let info = await getTokenInfoOrFetch(inputToken);
                            let oneUnit = Nat.pow(10, Nat8.toNat(info.decimals));
                            let quoteOpt = await getBestQuote(inputToken, outputToken, oneUnit);
                            switch (quoteOpt) {
                                case (?q) { setCachedQuote(inputToken, outputToken, q) };
                                case null {
                                    logEngine.logWarning("prep", "No quote for " # Principal.toText(inputToken) # " -> " # Principal.toText(outputToken), null, []);
                                };
                            };
                        } catch (e) {
                            logEngine.logDebug("prep", "Price fetch skipped for pair (no direct pool): " # Error.message(e), null, []);
                        };
                    };
                };
                i += 1;
            };
            _prep_priceIndex := _prepSetIndex(_prep_priceIndex, taskKey, batchEnd);
            if (batchEnd >= pairs.size()) {
                _prep_priceIndex := Array.filter<(Text, Nat)>(_prep_priceIndex, func((k, _)) { k != taskKey });
                #Done
            } else {
                #Continue
            }
        }
    };

    /// Collect all unique token principals from a list of trade actions.
    /// Also includes ICP and ckUSDC for snapshot pricing.
    func _collectTokens(actions: [T.ActionConfig]): [Principal] {
        let buf = Buffer.Buffer<Principal>(actions.size() * 2 + 2);
        let addToken = func(token: Principal) {
            var found = false;
            for (t in buf.vals()) { if (t == token) { found := true } };
            if (not found) { buf.add(token) };
        };
        for (a in actions.vals()) {
            addToken(a.inputToken);
            switch (a.outputToken) {
                case (?ot) { addToken(ot) };
                case null {};
            };
            // Include denomination tokens so their metadata is fetched
            switch (a.tradeSizeDenominationToken) { case (?dt) { addToken(dt) }; case null {} };
            switch (a.priceDenominationToken) { case (?dt) { addToken(dt) }; case null {} };
            switch (a.balanceDenominationToken) { case (?dt) { addToken(dt) }; case null {} };
        };
        // Ensure ICP and ckUSDC metadata are available for snapshot pricing
        addToken(Principal.fromText(T.ICP_LEDGER));
        addToken(Principal.fromText(T.CKUSDC_LEDGER));
        Buffer.toArray(buf)
    };

    /// Collect all unique (input, output) token pairs from trade actions.
    /// Also adds supplementary pairs for portfolio snapshots and denomination conversions:
    ///  - token→ICP for any token not already paired with ICP (for ICP valuation)
    ///  - ICP→ckUSDC (for USD valuation)
    ///  - denomination token pairs for trade size, price, and balance conversions
    func _collectPairs(actions: [T.ActionConfig]): [(Principal, Principal)] {
        let buf = Buffer.Buffer<(Principal, Principal)>(actions.size() + 8);
        let icpToken = Principal.fromText(T.ICP_LEDGER);
        let ckusdcToken = Principal.fromText(T.CKUSDC_LEDGER);

        let addPair = func(inp: Principal, out: Principal) {
            let key = pairKey(inp, out);
            var found = false;
            for ((i, o) in buf.vals()) { if (pairKey(i, o) == key) { found := true } };
            if (not found) { buf.add((inp, out)) };
        };

        // Add all explicit trade pairs
        for (a in actions.vals()) {
            switch (a.outputToken) {
                case (?ot) { addPair(a.inputToken, ot) };
                case null {};
            };
        };

        // Add denomination conversion pairs
        for (a in actions.vals()) {
            // Trade size: need denomToken→inputToken conversion
            switch (a.tradeSizeDenominationToken) {
                case (?dt) { addPair(dt, a.inputToken) };
                case null {};
            };
            // Price: need outputToken→denomToken conversion
            switch (a.priceDenominationToken) {
                case (?dt) {
                    switch (a.outputToken) {
                        case (?ot) { addPair(ot, dt) };
                        case null {};
                    };
                };
                case null {};
            };
            // Balance: need inputToken→denomToken conversion
            switch (a.balanceDenominationToken) {
                case (?dt) { addPair(a.inputToken, dt) };
                case null {};
            };
        };

        // Add token→ICP for any token not already paired with ICP
        for (a in actions.vals()) {
            if (a.inputToken != icpToken) { addPair(a.inputToken, icpToken) };
            switch (a.outputToken) {
                case (?ot) { if (ot != icpToken) { addPair(ot, icpToken) } };
                case null {};
            };
        };

        // Add ICP→ckUSDC for USD price derivation
        addPair(icpToken, ckusdcToken);

        Buffer.toArray(buf)
    };

    // ============================================
    // CHORE CONDUCTOR — TRADE CHORE
    // ============================================

    // Transient per-instance state for trade conductor
    transient var _trade_state: [(Text, { actions: [T.ActionConfig]; index: Nat })] = [];
    // Last trade log ID produced by executeTradeSwap, keyed by instanceId.
    // Used by the after-snapshot task to link to the trade log entry.
    transient var _trade_lastLogId: [(Text, ?Nat)] = [];

    func _trade_getState(instanceId: Text): { actions: [T.ActionConfig]; index: Nat } {
        getFromMap(_trade_state, instanceId, { actions = []; index = 0 })
    };
    func _trade_setState(instanceId: Text, s: { actions: [T.ActionConfig]; index: Nat }) {
        _trade_state := setInMap(_trade_state, instanceId, s)
    };

    func _trade_makeTaskFn(action: T.ActionConfig, instanceId: Text, isTradeChore: Bool): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            try {
                let executed = await executeTradeAction(action, instanceId);
                if (executed) {
                    updateActionLastExecuted(instanceId, action.id, isTradeChore);
                };
                #Done
            } catch (e) {
                #Error("Action " # Nat.toText(action.id) # " failed: " # Error.message(e))
            }
        }
    };

    /// Build the (token, ?subaccount) pairs for before/after snapshots around a given action.
    func _actionSnapshotPairs(action: T.ActionConfig): [(Principal, ?Blob)] {
        switch (action.actionType) {
            case (1) {
                // Deposit: main + target subaccount
                let targetBlob = switch (action.targetSubaccount) { case (?n) ?subaccountNumberToBlob(n); case null null };
                [(action.inputToken, null), (action.inputToken, targetBlob)]
            };
            case (2) {
                // Withdraw: source subaccount + main
                let sourceBlob = switch (action.sourceSubaccount) { case (?n) ?subaccountNumberToBlob(n); case null null };
                [(action.inputToken, sourceBlob), (action.inputToken, null)]
            };
            case (3) {
                // Send: source account only
                let sourceBlob = getSubaccountBlob(action.sourceSubaccount);
                [(action.inputToken, sourceBlob)]
            };
            case (_) { [] };
        }
    };

    func _trade_startCurrentTask(instanceId: Text) {
        let st = _trade_getState(instanceId);
        if (st.index < st.actions.size()) {
            let action = st.actions[st.index];
            if (action.actionType == 0) {
                // Swap: start with pre-trade snapshot
                let tokens = switch (action.outputToken) {
                    case (?out) { [action.inputToken, out] };
                    case null { [action.inputToken] };
                };
                let taskFn = _makeSnapshotTaskFn(tokens, #Before, instanceId, action.id);
                choreEngine.setPendingTask(instanceId, "trade-snap-before-" # Nat.toText(action.id), taskFn);
            } else if (action.actionType >= 1 and action.actionType <= 3) {
                // Deposit/Withdraw/Send: start with before-snapshot of involved accounts
                let pairs = _actionSnapshotPairs(action);
                if (pairs.size() > 0) {
                    let triggerPrefix = switch (action.actionType) {
                        case (1) "Deposit " # Nat.toText(action.id);
                        case (2) "Withdraw " # Nat.toText(action.id);
                        case (3) "Send " # Nat.toText(action.id);
                        case (_) "Action " # Nat.toText(action.id);
                    };
                    let taskFn = _makeAccountSnapshotTaskFn(pairs, #Before, instanceId, action.id, triggerPrefix);
                    choreEngine.setPendingTask(instanceId, "trade-acct-snap-before-" # Nat.toText(action.id), taskFn);
                } else {
                    let taskFn = _trade_makeTaskFn(action, instanceId, true);
                    choreEngine.setPendingTask(instanceId, "trade-action-" # Nat.toText(action.id), taskFn);
                };
            } else {
                let taskFn = _trade_makeTaskFn(action, instanceId, true);
                choreEngine.setPendingTask(instanceId, "trade-action-" # Nat.toText(action.id), taskFn);
            };
        };
    };

    // ============================================
    // CHORE CONDUCTOR — MOVE FUNDS CHORE
    // ============================================

    transient var _mf_state: [(Text, { actions: [T.ActionConfig]; index: Nat })] = [];

    func _mf_getState(instanceId: Text): { actions: [T.ActionConfig]; index: Nat } {
        getFromMap(_mf_state, instanceId, { actions = []; index = 0 })
    };
    func _mf_setState(instanceId: Text, s: { actions: [T.ActionConfig]; index: Nat }) {
        _mf_state := setInMap(_mf_state, instanceId, s)
    };

    func _mf_startCurrentTask(instanceId: Text) {
        let st = _mf_getState(instanceId);
        if (st.index < st.actions.size()) {
            let action = st.actions[st.index];
            // Deposit/Withdraw/Send: start with before-snapshot
            if (action.actionType >= 1 and action.actionType <= 3) {
                let pairs = _actionSnapshotPairs(action);
                if (pairs.size() > 0) {
                    let triggerPrefix = switch (action.actionType) {
                        case (1) "Deposit " # Nat.toText(action.id);
                        case (2) "Withdraw " # Nat.toText(action.id);
                        case (3) "Send " # Nat.toText(action.id);
                        case (_) "Action " # Nat.toText(action.id);
                    };
                    let taskFn = _makeAccountSnapshotTaskFn(pairs, #Before, instanceId, action.id, triggerPrefix);
                    choreEngine.setPendingTask(instanceId, "mf-acct-snap-before-" # Nat.toText(action.id), taskFn);
                    return;
                };
            };
            let taskFn = _trade_makeTaskFn(action, instanceId, false);
            choreEngine.setPendingTask(instanceId, "mf-action-" # Nat.toText(action.id), taskFn);
        };
    };

    // ============================================
    // SNAPSHOT CHORE HELPERS
    // ============================================

    /// Balance snapshot task: takes snapshots of all registered tokens across main and all named subaccounts.
    func _snap_makeBalanceTaskFn(instanceId: Text): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            try {
                let allTokens = Array.map<T.TokenRegistryEntry, Principal>(tokenRegistry, func(e) { e.ledgerCanisterId });
                if (allTokens.size() == 0) return #Done;

                // Main account snapshot
                let mainSnaps = await takeTokenSnapshots(allTokens);
                let mainIcp = Array.foldLeft<T.TokenSnapshot, Nat>(mainSnaps, 0, func(acc, s) { acc + (switch (s.valueIcpE8s) { case (?v) v; case null 0 }) });
                let mainUsd = Array.foldLeft<T.TokenSnapshot, Nat>(mainSnaps, 0, func(acc, s) { acc + (switch (s.valueUsdE8s) { case (?v) v; case null 0 }) });
                ignore appendPortfolioSnapshot({
                    trigger = "Snapshot chore";
                    tradeLogId = null;
                    phase = #After;
                    choreId = ?instanceId;
                    subaccount = null;
                    denominationToken = null;
                    totalValueIcpE8s = ?mainIcp;
                    totalValueUsdE8s = ?mainUsd;
                    totalValueDenomE8s = null;
                    tokens = mainSnaps;
                });

                // Named subaccount snapshots
                for ((subNum, _subName) in namedSubaccounts.vals()) {
                    let subBlob = subaccountNumberToBlob(subNum);
                    // Take snapshot for each token in this subaccount
                    let subSnapBuf = Buffer.Buffer<T.TokenSnapshot>(allTokens.size());
                    for (token in allTokens.vals()) {
                        let balance = await getBalance(token, ?subBlob);
                        setLastKnownBalance(token, ?subBlob, balance);
                        let meta = getCachedMeta(token);
                        let symbol = switch (meta) { case (?m) m.symbol; case null { switch (getTokenInfo(token)) { case (?i) i.symbol; case null "?" } } };
                        let decimals: Nat8 = switch (meta) { case (?m) m.decimals; case null { switch (getTokenInfo(token)) { case (?i) i.decimals; case null 8 } } };
                        let decNat = Nat8.toNat(decimals);
                        let scale = 10 ** decNat;

                        let icpToken = Principal.fromText(T.ICP_LEDGER);
                        let ckusdcToken = Principal.fromText(T.CKUSDC_LEDGER);

                        let priceIcpE8s: ?Nat = if (token == icpToken) { ?scale } else {
                            switch (getCachedQuote(token, icpToken)) {
                                case (?q) { if (q.inputAmount > 0) { ?((q.expectedOutput * scale) / q.inputAmount) } else { null } };
                                case null { null };
                            }
                        };
                        let valueIcpE8s: ?Nat = switch (priceIcpE8s) { case (?p) { ?((balance * p) / scale) }; case null { null } };

                        let icpPriceUsdE6: ?Nat = switch (getCachedQuote(icpToken, ckusdcToken)) {
                            case (?q) { if (q.inputAmount > 0) { ?((q.expectedOutput * 100_000_000) / q.inputAmount) } else { null } };
                            case null { null };
                        };
                        let priceUsdE8s: ?Nat = if (token == ckusdcToken) { ?scale } else {
                            switch (priceIcpE8s, icpPriceUsdE6) {
                                case (?icpP, ?usdRate) { ?((icpP * usdRate) / 1_000_000) };
                                case (_, _) { null };
                            }
                        };
                        let valueUsdE8s: ?Nat = switch (priceUsdE8s) { case (?p) { ?((balance * p) / scale) }; case null { null } };

                        subSnapBuf.add({
                            token = token; symbol = symbol; decimals = decimals; balance = balance;
                            priceIcpE8s = priceIcpE8s; priceUsdE8s = priceUsdE8s; priceDenomE8s = null;
                            valueIcpE8s = valueIcpE8s; valueUsdE8s = valueUsdE8s; valueDenomE8s = null;
                        });
                    };
                    let subSnaps = Buffer.toArray(subSnapBuf);
                    let subIcp = Array.foldLeft<T.TokenSnapshot, Nat>(subSnaps, 0, func(acc, s) { acc + (switch (s.valueIcpE8s) { case (?v) v; case null 0 }) });
                    let subUsd = Array.foldLeft<T.TokenSnapshot, Nat>(subSnaps, 0, func(acc, s) { acc + (switch (s.valueUsdE8s) { case (?v) v; case null 0 }) });
                    ignore appendPortfolioSnapshot({
                        trigger = "Snapshot chore";
                        tradeLogId = null;
                        phase = #After;
                        choreId = ?instanceId;
                        subaccount = ?subBlob;
                        denominationToken = null;
                        totalValueIcpE8s = ?subIcp;
                        totalValueUsdE8s = ?subUsd;
                        totalValueDenomE8s = null;
                        tokens = subSnaps;
                    });
                };

                #Done
            } catch (e) {
                logEngine.logWarning("chore:" # instanceId, "Balance snapshot failed: " # Error.message(e), null, []);
                #Done
            }
        }
    };

    /// Archive task: finalize the previous day's daily summaries.
    /// If summaries for yesterday already exist, this is a no-op.
    func _snap_makeArchiveTaskFn(instanceId: Text): () -> async BotChoreTypes.TaskAction {
        func(): async BotChoreTypes.TaskAction {
            try {
                let now = Time.now();
                let todayStart = utcDayStart(now);
                let yesterdayStart = todayStart - NANOS_PER_DAY;

                // Check if we already have portfolio summaries for yesterday
                let hasYesterdayPortfolio = Array.find<T.DailyPortfolioSummary>(dailyPortfolioSummaries, func(s) {
                    s.date == yesterdayStart
                });

                switch (hasYesterdayPortfolio) {
                    case (?_) {
                        logEngine.logDebug("chore:" # instanceId, "Archive: yesterday's summaries already exist", null, []);
                    };
                    case null {
                        logEngine.logInfo("chore:" # instanceId, "Archive: no summaries found for yesterday, attempting to patch from existing data", null, []);
                        // Try to create summaries from any portfolio snapshots we still have for yesterday
                        for (snap in portfolioSnapshots.vals()) {
                            if (utcDayStart(snap.timestamp) == yesterdayStart) {
                                updateDailyPortfolioSummary(snap);
                            };
                        };
                    };
                };

                // Similarly for price candles
                let hasYesterdayPrice = Array.find<T.DailyPriceCandle>(dailyPriceCandles, func(c) {
                    c.date == yesterdayStart
                });

                switch (hasYesterdayPrice) {
                    case (?_) {};
                    case null {
                        logEngine.logInfo("chore:" # instanceId, "Archive: patching yesterday's price candles from history", null, []);
                        // Patch from price history ring buffer
                        for (entry in priceHistory.vals()) {
                            if (utcDayStart(entry.fetchedAt) == yesterdayStart) {
                                updateDailyPriceCandle(pairKey(entry.inputToken, entry.outputToken), entry);
                            };
                        };
                    };
                };

                #Done
            } catch (e) {
                logEngine.logWarning("chore:" # instanceId, "Archive task failed: " # Error.message(e), null, []);
                #Done
            }
        }
    };

    // ============================================
    // CHORE REGISTRATION
    // ============================================

    transient let _choreInit: () = do {

        // --- Chore: Trade ---
        choreEngine.registerChoreType({
            id = "trade";
            name = "Trade";
            description = "Execute a configurable list of conditional trades, deposits, withdrawals and sends on a recurring schedule. Each action runs as an independent task, so a failure in one doesn't block the rest.";
            defaultIntervalSeconds = 300; // 5 minutes
            defaultMaxIntervalSeconds = ?600; // Up to 10 minutes for randomization
            defaultTaskTimeoutSeconds = 300; // 5 minutes per action
            conduct = func(ctx: BotChoreTypes.ConductorContext): async BotChoreTypes.ConductorAction {
                let instanceId = ctx.choreId;
                let src = "chore:" # instanceId;

                if (ctx.isTaskRunning) { return #ContinueIn(10) };

                switch (ctx.lastCompletedTask) {
                    case null {
                        // First invocation: load enabled actions and start metadata refresh
                        let allActions = getTradeActionsForInstance(instanceId);
                        let enabledActions = Array.filter<T.ActionConfig>(allActions, func(a) { a.enabled });
                        _trade_setState(instanceId, { actions = enabledActions; index = 0 });

                        logEngine.logInfo(src, "Starting: " # Nat.toText(enabledActions.size()) # " enabled actions", null, []);
                        if (enabledActions.size() == 0) { return #Done };

                        // Reset price cache: seed from fresh persistent prices
                        resetPriceCache();

                        // Start Phase 0: metadata refresh
                        let tokens = _collectTokens(enabledActions);
                        if (tokens.size() > 0) {
                            let taskKey = "trade-meta-" # instanceId;
                            let taskFn = _makeRefreshMetadataTask(taskKey, tokens);
                            choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                            logEngine.logInfo(src, "Phase 0: refreshing metadata for " # Nat.toText(tokens.size()) # " tokens", null, []);
                            return #ContinueIn(5);
                        };

                        // No tokens to refresh → skip to Phase 1: price fetch
                        let pairs = _collectPairs(enabledActions);
                        if (pairs.size() > 0) {
                            let taskKey = "trade-prices-" # instanceId;
                            let taskFn = _makeFetchPricesTask(taskKey, pairs);
                            choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                            logEngine.logInfo(src, "Phase 1: fetching prices for " # Nat.toText(pairs.size()) # " pairs", null, []);
                            return #ContinueIn(5);
                        };

                        // No pairs either → start first trade action directly
                        _trade_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };

                    case (?prevTask) {
                        // Metadata refresh completed → start price fetch
                        if (Text.startsWith(prevTask.taskId, #text("trade-meta-"))) {
                            logEngine.logInfo(src, "Phase 0 complete: metadata refreshed", null, []);
                            let st = _trade_getState(instanceId);
                            let pairs = _collectPairs(st.actions);
                            if (pairs.size() > 0) {
                                let taskKey = "trade-prices-" # instanceId;
                                let taskFn = _makeFetchPricesTask(taskKey, pairs);
                                choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                                logEngine.logInfo(src, "Phase 1: fetching prices for " # Nat.toText(pairs.size()) # " pairs", null, []);
                                return #ContinueIn(5);
                            };
                            // No pairs → start first trade task
                            _trade_startCurrentTask(instanceId);
                            return #ContinueIn(10);
                        };

                        // Price fetch completed → start executing trade actions
                        if (Text.startsWith(prevTask.taskId, #text("trade-prices-"))) {
                            logEngine.logInfo(src, "Phase 1 complete: prices fetched", null, []);
                            _trade_startCurrentTask(instanceId);
                            return #ContinueIn(10);
                        };

                        // Pre-trade snapshot completed → start the actual trade action
                        if (Text.startsWith(prevTask.taskId, #text("trade-snap-before-"))) {
                            let st = _trade_getState(instanceId);
                            if (st.index < st.actions.size()) {
                                let action = st.actions[st.index];
                                let taskFn = _trade_makeTaskFn(action, instanceId, true);
                                choreEngine.setPendingTask(instanceId, "trade-action-" # Nat.toText(action.id), taskFn);
                            };
                            return #ContinueIn(5);
                        };

                        // Account before-snapshot completed → start the action
                        if (Text.startsWith(prevTask.taskId, #text("trade-acct-snap-before-"))) {
                            let st = _trade_getState(instanceId);
                            if (st.index < st.actions.size()) {
                                let action = st.actions[st.index];
                                let taskFn = _trade_makeTaskFn(action, instanceId, true);
                                choreEngine.setPendingTask(instanceId, "trade-action-" # Nat.toText(action.id), taskFn);
                            };
                            return #ContinueIn(5);
                        };

                        // Trade action completed → start post-trade snapshot (for swaps), post-account snapshot (for deposit/withdraw/send), or advance
                        if (Text.startsWith(prevTask.taskId, #text("trade-action-"))) {
                            let st = _trade_getState(instanceId);
                            if (st.index < st.actions.size()) {
                                let action = st.actions[st.index];
                                if (action.actionType == 0) {
                                    // Swap action: schedule post-trade snapshot
                                    let tokens = switch (action.outputToken) {
                                        case (?out) { [action.inputToken, out] };
                                        case null { [action.inputToken] };
                                    };
                                    let taskFn = _makeSnapshotTaskFn(tokens, #After, instanceId, action.id);
                                    choreEngine.setPendingTask(instanceId, "trade-snap-after-" # Nat.toText(action.id), taskFn);
                                    return #ContinueIn(5);
                                } else if (action.actionType >= 1 and action.actionType <= 3) {
                                    // Deposit/Withdraw/Send: schedule post-action account snapshot
                                    let pairs = _actionSnapshotPairs(action);
                                    if (pairs.size() > 0) {
                                        let triggerPrefix = switch (action.actionType) {
                                            case (1) "Deposit " # Nat.toText(action.id);
                                            case (2) "Withdraw " # Nat.toText(action.id);
                                            case (3) "Send " # Nat.toText(action.id);
                                            case (_) "Action " # Nat.toText(action.id);
                                        };
                                        let taskFn = _makeAccountSnapshotTaskFn(pairs, #After, instanceId, action.id, triggerPrefix);
                                        choreEngine.setPendingTask(instanceId, "trade-acct-snap-after-" # Nat.toText(action.id), taskFn);
                                        return #ContinueIn(5);
                                    };
                                };
                            };
                            // Non-snapshot action or no pairs: fall through to advance
                        };

                        // Post-trade snapshot completed OR post-account snapshot completed OR non-snapshot action completed → advance to next
                        let st = _trade_getState(instanceId);
                        let nextIdx = st.index + 1;
                        _trade_setState(instanceId, { st with index = nextIdx });
                        if (nextIdx >= st.actions.size()) {
                            logEngine.logInfo(src, "Completed: all actions processed", null, []);
                            return #Done;
                        };
                        _trade_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };
                };
            };
        });

        // --- Chore: Rebalance ---
        // Pipeline: meta → prices → snapshot(before) → execute → snapshot(after) → done
        choreEngine.registerChore({
            id = "rebalance";
            name = "Rebalance Portfolio";
            description = "Automatically rebalance a portfolio toward target allocations by identifying over/underweight tokens and executing weighted-random trades between them.";
            defaultIntervalSeconds = 3600; // 1 hour
            defaultMaxIntervalSeconds = ?7200; // Up to 2 hours for randomization
            defaultTaskTimeoutSeconds = 600; // 10 minutes
            conduct = func(ctx: BotChoreTypes.ConductorContext): async BotChoreTypes.ConductorAction {
                let instanceId = ctx.choreId;
                let src = "chore:" # instanceId;

                if (ctx.isTaskRunning) { return #ContinueIn(10) };

                // Helper: collect unique target token principals
                let targets = getRebalTargets(instanceId);
                let targetTokens = Array.map<T.RebalanceTarget, Principal>(targets, func(t) { t.token });

                // Helper: collect all tokens for metadata (targets + denom + ICP + ckUSDC)
                let icpToken = Principal.fromText(T.ICP_LEDGER);
                let ckusdcToken = Principal.fromText(T.CKUSDC_LEDGER);
                let denomToken = getRebalDenomToken(instanceId);

                let collectAllTokens = func(): [Principal] {
                    let buf = Buffer.Buffer<Principal>(targets.size() + 3);
                    let addUnique = func(p: Principal) {
                        var dup = false;
                        for (existing in buf.vals()) { if (existing == p) { dup := true } };
                        if (not dup) { buf.add(p) };
                    };
                    for (t in targets.vals()) { addUnique(t.token) };
                    addUnique(denomToken);
                    addUnique(icpToken);
                    addUnique(ckusdcToken);
                    Buffer.toArray(buf)
                };

                // Helper: collect all price pairs needed for rebalancing + snapshots
                let collectAllPairs = func(): [(Principal, Principal)] {
                    let buf = Buffer.Buffer<(Principal, Principal)>(targets.size() * 2 + 2);
                    let addPair = func(inp: Principal, out: Principal) {
                        let key = pairKey(inp, out);
                        var found = false;
                        for ((i, o) in buf.vals()) { if (pairKey(i, o) == key) { found := true } };
                        if (not found) { buf.add((inp, out)) };
                    };
                    for (t in targets.vals()) {
                        // token → denomToken (for rebalancer portfolio valuation)
                        if (t.token != denomToken) { addPair(t.token, denomToken) };
                        // token → ICP (for snapshot ICP valuation)
                        if (t.token != icpToken) { addPair(t.token, icpToken) };
                    };
                    // ICP → ckUSDC (for snapshot USD valuation)
                    addPair(icpToken, ckusdcToken);
                    Buffer.toArray(buf)
                };

                switch (ctx.lastCompletedTask) {
                    case null {
                        // First invocation
                        if (targets.size() == 0) {
                            logEngine.logInfo(src, "Rebalance skipped: no targets configured", null, []);
                            return #Done;
                        };

                        resetPriceCache();

                        // Phase 0: metadata refresh
                        let tokens = collectAllTokens();
                        if (tokens.size() > 0) {
                            let taskKey = "rebal-meta-" # instanceId;
                            let taskFn = _makeRefreshMetadataTask(taskKey, tokens);
                            choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                            logEngine.logInfo(src, "Phase 0: refreshing metadata for " # Nat.toText(tokens.size()) # " tokens", null, []);
                            return #ContinueIn(5);
                        };

                        // Skip to Phase 1: price fetch
                        let pairs = collectAllPairs();
                        if (pairs.size() > 0) {
                            let taskKey = "rebal-prices-" # instanceId;
                            let taskFn = _makeFetchPricesTask(taskKey, pairs);
                            choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                            logEngine.logInfo(src, "Phase 1: fetching prices for " # Nat.toText(pairs.size()) # " pairs", null, []);
                            return #ContinueIn(5);
                        };

                        // Skip to Phase 2: before-snapshot
                        let taskFn = _makeRebalSnapshotTaskFn(targetTokens, #Before, instanceId);
                        choreEngine.setPendingTask(instanceId, "rebal-snap-before-" # instanceId, taskFn);
                        logEngine.logInfo(src, "Phase 2: taking pre-trade portfolio snapshot", null, []);
                        return #ContinueIn(5);
                    };

                    case (?prevTask) {
                        // Phase 0 complete → Phase 1: price fetch
                        if (Text.startsWith(prevTask.taskId, #text("rebal-meta-"))) {
                            logEngine.logInfo(src, "Phase 0 complete: metadata refreshed", null, []);
                            let pairs = collectAllPairs();
                            if (pairs.size() > 0) {
                                let taskKey = "rebal-prices-" # instanceId;
                                let taskFn = _makeFetchPricesTask(taskKey, pairs);
                                choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                                logEngine.logInfo(src, "Phase 1: fetching prices for " # Nat.toText(pairs.size()) # " pairs", null, []);
                                return #ContinueIn(5);
                            };
                            // No pairs → skip to before-snapshot
                            let taskFn = _makeRebalSnapshotTaskFn(targetTokens, #Before, instanceId);
                            choreEngine.setPendingTask(instanceId, "rebal-snap-before-" # instanceId, taskFn);
                            logEngine.logInfo(src, "Phase 2: taking pre-trade portfolio snapshot", null, []);
                            return #ContinueIn(5);
                        };

                        // Phase 1 complete → Phase 2: before-snapshot
                        if (Text.startsWith(prevTask.taskId, #text("rebal-prices-"))) {
                            logEngine.logInfo(src, "Phase 1 complete: prices fetched", null, []);
                            let taskFn = _makeRebalSnapshotTaskFn(targetTokens, #Before, instanceId);
                            choreEngine.setPendingTask(instanceId, "rebal-snap-before-" # instanceId, taskFn);
                            logEngine.logInfo(src, "Phase 2: taking pre-trade portfolio snapshot", null, []);
                            return #ContinueIn(5);
                        };

                        // Phase 2 complete → Phase 3: execute rebalance trade
                        if (Text.startsWith(prevTask.taskId, #text("rebal-snap-before-"))) {
                            logEngine.logInfo(src, "Phase 2 complete: pre-trade snapshot taken", null, []);
                            let taskFn = func(): async BotChoreTypes.TaskAction {
                                try { ignore await executeRebalance(instanceId); #Done }
                                catch (e) { #Error("Rebalance failed: " # Error.message(e)) }
                            };
                            choreEngine.setPendingTask(instanceId, "rebalance-exec-" # Nat.toText(Int.abs(Time.now())), taskFn);
                            return #ContinueIn(15);
                        };

                        // Phase 3 complete → Phase 4: after-snapshot
                        if (Text.startsWith(prevTask.taskId, #text("rebalance-exec-"))) {
                            logEngine.logInfo(src, "Phase 3 complete: rebalance trade executed", null, []);
                            let taskFn = _makeRebalSnapshotTaskFn(targetTokens, #After, instanceId);
                            choreEngine.setPendingTask(instanceId, "rebal-snap-after-" # instanceId, taskFn);
                            logEngine.logInfo(src, "Phase 4: taking post-trade portfolio snapshot", null, []);
                            return #ContinueIn(5);
                        };

                        // Phase 4 complete → Done
                        if (Text.startsWith(prevTask.taskId, #text("rebal-snap-after-"))) {
                            logEngine.logInfo(src, "Phase 4 complete: post-trade snapshot taken. Rebalance cycle done.", null, []);
                            return #Done;
                        };

                        // Unknown task → done (safety fallback)
                        return #Done;
                    };
                };
            };
        });

        // --- Chore: Move Funds ---
        choreEngine.registerChoreType({
            id = "move-funds";
            name = "Move Funds";
            description = "Execute deposit, withdraw, and send actions on a recurring schedule (no trading). Useful for scheduled fund movements between subaccounts or to external addresses.";
            defaultIntervalSeconds = 3600; // 1 hour
            defaultMaxIntervalSeconds = null;
            defaultTaskTimeoutSeconds = 300;
            conduct = func(ctx: BotChoreTypes.ConductorContext): async BotChoreTypes.ConductorAction {
                let instanceId = ctx.choreId;
                let src = "chore:" # instanceId;

                if (ctx.isTaskRunning) { return #ContinueIn(10) };

                switch (ctx.lastCompletedTask) {
                    case null {
                        let allActions = getMoveFundsActionsForInstance(instanceId);
                        let enabledActions = Array.filter<T.ActionConfig>(allActions, func(a) { a.enabled });
                        _mf_setState(instanceId, { actions = enabledActions; index = 0 });

                        logEngine.logInfo(src, "Starting: " # Nat.toText(enabledActions.size()) # " enabled actions", null, []);

                        if (enabledActions.size() == 0) { return #Done };
                        _mf_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };
                    case (?prevTask) {
                        // Account before-snapshot completed → start the action
                        if (Text.startsWith(prevTask.taskId, #text("mf-acct-snap-before-"))) {
                            let st = _mf_getState(instanceId);
                            if (st.index < st.actions.size()) {
                                let action = st.actions[st.index];
                                let taskFn = _trade_makeTaskFn(action, instanceId, false);
                                choreEngine.setPendingTask(instanceId, "mf-action-" # Nat.toText(action.id), taskFn);
                            };
                            return #ContinueIn(5);
                        };

                        // Action completed → schedule post-action snapshot if applicable
                        if (Text.startsWith(prevTask.taskId, #text("mf-action-"))) {
                            let st = _mf_getState(instanceId);
                            if (st.index < st.actions.size()) {
                                let action = st.actions[st.index];
                                if (action.actionType >= 1 and action.actionType <= 3) {
                                    let pairs = _actionSnapshotPairs(action);
                                    if (pairs.size() > 0) {
                                        let triggerPrefix = switch (action.actionType) {
                                            case (1) "Deposit " # Nat.toText(action.id);
                                            case (2) "Withdraw " # Nat.toText(action.id);
                                            case (3) "Send " # Nat.toText(action.id);
                                            case (_) "Action " # Nat.toText(action.id);
                                        };
                                        let taskFn = _makeAccountSnapshotTaskFn(pairs, #After, instanceId, action.id, triggerPrefix);
                                        choreEngine.setPendingTask(instanceId, "mf-acct-snap-after-" # Nat.toText(action.id), taskFn);
                                        return #ContinueIn(5);
                                    };
                                };
                            };
                            // Fall through to advance
                        };

                        // Post-action snapshot completed OR action without snapshot → advance
                        let st = _mf_getState(instanceId);
                        let nextIdx = st.index + 1;
                        _mf_setState(instanceId, { st with index = nextIdx });
                        if (nextIdx >= st.actions.size()) {
                            logEngine.logInfo(src, "Completed: all actions processed", null, []);
                            return #Done;
                        };
                        _mf_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };
                };
            };
        });

        // --- Chore: Distribute Funds ---
        choreEngine.registerChore({
            id = "distribute-funds";
            name = "Distribute Funds";
            description = "Periodically distributes funds from the bot's account to target accounts based on configured percentages. Supports multiple distribution lists per instance.";
            defaultIntervalSeconds = 24 * 60 * 60; // 1 day
            defaultMaxIntervalSeconds = null;
            defaultTaskTimeoutSeconds = 600;
            conduct = func(ctx: BotChoreTypes.ConductorContext): async BotChoreTypes.ConductorAction {
                let instanceId = ctx.choreId;
                let src = "chore:" # instanceId;

                if (ctx.isTaskRunning) { return #ContinueIn(10) };

                switch (ctx.lastCompletedTask) {
                    case null {
                        let ds = getDistSettings(instanceId);
                        _df_setState(instanceId, { lists = ds.lists; index = 0 });
                        logEngine.logInfo(src, "Starting: " # Nat.toText(ds.lists.size()) # " distribution list(s)", null, []);
                        if (ds.lists.size() == 0) { return #Done };
                        _df_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };
                    case (?prevTask) {
                        // Before-snapshot completed → start distribution
                        if (Text.startsWith(prevTask.taskId, #text("dist-snap-before-"))) {
                            let st = _df_getState(instanceId);
                            if (st.index < st.lists.size()) {
                                let list = st.lists[st.index];
                                let taskFn = _df_makeTaskFn(list);
                                choreEngine.setPendingTask(instanceId, "dist-" # Nat.toText(list.id), taskFn);
                            };
                            return #ContinueIn(5);
                        };

                        // Distribution completed → after-snapshot
                        if (Text.startsWith(prevTask.taskId, #text("dist-")) and not Text.startsWith(prevTask.taskId, #text("dist-snap-"))) {
                            let st = _df_getState(instanceId);
                            if (st.index < st.lists.size()) {
                                let list = st.lists[st.index];
                                let pairs: [(Principal, ?Blob)] = [(list.tokenLedgerCanisterId, list.sourceSubaccount)];
                                let triggerPrefix = "Distribution " # list.name;
                                let taskFn = _makeAccountSnapshotTaskFn(pairs, #After, instanceId, list.id, triggerPrefix);
                                choreEngine.setPendingTask(instanceId, "dist-snap-after-" # Nat.toText(list.id), taskFn);
                                return #ContinueIn(5);
                            };
                        };

                        // After-snapshot completed → advance to next list
                        let st = _df_getState(instanceId);
                        let nextIdx = st.index + 1;
                        _df_setState(instanceId, { st with index = nextIdx });
                        if (nextIdx >= st.lists.size()) {
                            logEngine.logInfo(src, "Completed: all lists processed", null, []);
                            return #Done;
                        };
                        _df_startCurrentTask(instanceId);
                        return #ContinueIn(10);
                    };
                };
            };
        });

        // --- Chore: Snapshot ---
        // Pipeline: meta → prices → balance snapshots (per-account) → archive → done
        choreEngine.registerChoreType({
            id = "snapshot";
            name = "Snapshot";
            description = "Periodically takes balance snapshots (all registered tokens across main and named subaccounts), price snapshots (all registered pairs), and archives daily summaries. Ensures data coverage even when trade/rebalance chores are inactive.";
            defaultIntervalSeconds = 3600; // 1 hour
            defaultMaxIntervalSeconds = null;
            defaultTaskTimeoutSeconds = 600; // 10 minutes
            conduct = func(ctx: BotChoreTypes.ConductorContext): async BotChoreTypes.ConductorAction {
                let instanceId = ctx.choreId;
                let src = "chore:" # instanceId;

                if (ctx.isTaskRunning) { return #ContinueIn(10) };

                switch (ctx.lastCompletedTask) {
                    case null {
                        // Phase 0: Metadata refresh for all registered tokens
                        let allTokens = Array.map<T.TokenRegistryEntry, Principal>(tokenRegistry, func(e) { e.ledgerCanisterId });
                        let icpToken = Principal.fromText(T.ICP_LEDGER);
                        let ckusdcToken = Principal.fromText(T.CKUSDC_LEDGER);
                        let buf = Buffer.Buffer<Principal>(allTokens.size() + 2);
                        for (t in allTokens.vals()) { buf.add(t) };
                        var hasIcp = false; var hasUsdc = false;
                        for (t in allTokens.vals()) { if (t == icpToken) hasIcp := true; if (t == ckusdcToken) hasUsdc := true };
                        if (not hasIcp) buf.add(icpToken);
                        if (not hasUsdc) buf.add(ckusdcToken);
                        let tokens = Buffer.toArray(buf);

                        resetPriceCache();

                        if (tokens.size() > 0) {
                            let taskKey = "snap-meta-" # instanceId;
                            let taskFn = _makeRefreshMetadataTask(taskKey, tokens);
                            choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                            logEngine.logInfo(src, "Phase 0: refreshing metadata for " # Nat.toText(tokens.size()) # " tokens", null, []);
                            return #ContinueIn(5);
                        };
                        // No tokens → skip to price fetch (unlikely)
                        return #Done;
                    };

                    case (?prevTask) {
                        // Phase 0 complete → Phase 1: Price snapshot
                        if (Text.startsWith(prevTask.taskId, #text("snap-meta-"))) {
                            logEngine.logInfo(src, "Phase 0 complete: metadata refreshed", null, []);
                            // Collect all pairs: each registered token → ICP, ICP → ckUSDC
                            let icpToken = Principal.fromText(T.ICP_LEDGER);
                            let ckusdcToken = Principal.fromText(T.CKUSDC_LEDGER);
                            let pairBuf = Buffer.Buffer<(Principal, Principal)>(tokenRegistry.size() * 2 + 1);
                            let addPair = func(inp: Principal, out: Principal) {
                                if (inp == out) return;
                                let key = pairKey(inp, out);
                                var found = false;
                                for ((i, o) in pairBuf.vals()) { if (pairKey(i, o) == key) found := true };
                                if (not found) pairBuf.add((inp, out));
                            };
                            for (e in tokenRegistry.vals()) {
                                if (e.ledgerCanisterId != icpToken) addPair(e.ledgerCanisterId, icpToken);
                            };
                            addPair(icpToken, ckusdcToken);
                            let pairs = Buffer.toArray(pairBuf);

                            if (pairs.size() > 0) {
                                let taskKey = "snap-prices-" # instanceId;
                                let taskFn = _makeFetchPricesTask(taskKey, pairs);
                                choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                                logEngine.logInfo(src, "Phase 1: fetching prices for " # Nat.toText(pairs.size()) # " pairs", null, []);
                                return #ContinueIn(5);
                            };
                            // No pairs → balance snapshot
                            let balTaskKey = "snap-balance-" # instanceId;
                            let balTaskFn = _snap_makeBalanceTaskFn(instanceId);
                            choreEngine.setPendingTask(instanceId, balTaskKey, balTaskFn);
                            return #ContinueIn(5);
                        };

                        // Phase 1 complete → Phase 2: Balance snapshot
                        if (Text.startsWith(prevTask.taskId, #text("snap-prices-"))) {
                            logEngine.logInfo(src, "Phase 1 complete: prices fetched", null, []);
                            let taskKey = "snap-balance-" # instanceId;
                            let taskFn = _snap_makeBalanceTaskFn(instanceId);
                            choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                            return #ContinueIn(5);
                        };

                        // Phase 2 complete → Phase 3: Archive daily summaries
                        if (Text.startsWith(prevTask.taskId, #text("snap-balance-"))) {
                            logEngine.logInfo(src, "Phase 2 complete: balance snapshots taken", null, []);
                            let taskKey = "snap-archive-" # instanceId;
                            let taskFn = _snap_makeArchiveTaskFn(instanceId);
                            choreEngine.setPendingTask(instanceId, taskKey, taskFn);
                            return #ContinueIn(5);
                        };

                        // Phase 3 complete → Done
                        if (Text.startsWith(prevTask.taskId, #text("snap-archive-"))) {
                            logEngine.logInfo(src, "Phase 3 complete: daily archive processed", null, []);
                            return #Done;
                        };

                        // Fallback
                        return #Done;
                    };
                };
            };
        });

        // Resume all chore timers
        choreEngine.resumeTimers<system>();
    };

    system func postupgrade() {
        choreEngine.resumeTimers<system>();
    };

    // ============================================
    // PUBLIC API — CANISTER INFO
    // ============================================

    public query func getVersion(): async T.Version { currentVersion };

    public query func getCanisterPrincipal(): async Principal {
        Principal.fromActor(this)
    };

    // ============================================
    // PUBLIC API — PERMISSIONS (aligned with staking bot API)
    // ============================================

    // Add permissions to a botkey principal (merges with existing permissions)
    public shared ({ caller }) func addHotkeyPermissions(
        hotkeyPrincipal: Principal,
        permissions: [T.TradingPermissionType]
    ): async T.OperationResult {
        assertPermission(caller, T.TradingPermission.ManagePermissions);
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
        permissions: [T.TradingPermissionType]
    ): async T.OperationResult {
        assertPermission(caller, T.TradingPermission.ManagePermissions);
        logEngine.logInfo("permissions", "removeHotkeyPermissions", ?caller, [("principal", Principal.toText(hotkeyPrincipal))]);

        hotkeyPermissions := permEngine.removePermissions(hotkeyPrincipal, permissions, hotkeyPermissions);
        #Ok
    };

    // Remove a botkey principal entirely (removes all their permissions)
    public shared ({ caller }) func removeHotkeyPrincipal(
        hotkeyPrincipal: Principal
    ): async T.OperationResult {
        assertPermission(caller, T.TradingPermission.ManagePermissions);
        logEngine.logInfo("permissions", "removeHotkeyPrincipal", ?caller, [("principal", Principal.toText(hotkeyPrincipal))]);

        hotkeyPermissions := permEngine.removePrincipal(hotkeyPrincipal, hotkeyPermissions);
        #Ok
    };

    // Get permissions for a specific botkey principal
    public query func getHotkeyPermissions(hotkeyPrincipal: Principal): async [T.TradingPermissionType] {
        permEngine.getPermissions(hotkeyPrincipal, hotkeyPermissions)
    };

    // List all botkey principals and their permissions
    public query func listHotkeyPrincipals(): async [T.HotkeyPermissionInfo] {
        permEngine.listPrincipals(hotkeyPermissions)
    };

    // List all available permission types and their numeric IDs
    public query func listPermissionTypes(): async [(Nat, T.TradingPermissionType)] {
        PERMISSION_MAP
    };

    // Get the caller's current permissions
    // Controllers and principals with FullPermissions get all permissions;
    // other botkey principals get their assigned permissions.
    public shared query ({ caller }) func callerPermissions(): async [T.TradingPermissionType] {
        permEngine.getCallerPermissions(caller, hotkeyPermissions)
    };

    // Check if the caller has a specific permission
    public shared query ({ caller }) func checkPermission(permission: T.TradingPermissionType): async Bool {
        callerHasPermission(caller, permissionVariantToId(permission))
    };

    // Get raw botkey snapshot for escrow backup (controller-only)
    public shared ({ caller }) func getBotkeySnapshot() : async [(Principal, [Nat])] {
        assert(Principal.isController(caller));
        logEngine.logInfo("permissions", "getBotkeySnapshot", ?caller, []);
        hotkeyPermissions
    };

    // Restore botkey snapshot from escrow backup (controller-only)
    public shared ({ caller }) func restoreBotkeySnapshot(data : [(Principal, [Nat])]) : async () {
        assert(Principal.isController(caller));
        logEngine.logInfo("permissions", "restoreBotkeySnapshot", ?caller, []);
        hotkeyPermissions := data;
    };

    // ============================================
    // PUBLIC API — TOKEN REGISTRY
    // ============================================

    public shared query (msg) func getTokenRegistry(): async [T.TokenRegistryEntry] {
        assertPermission(msg.caller, T.TradingPermission.ViewPortfolio);
        tokenRegistry
    };

    public shared (msg) func addToken(entry: T.TokenRegistryEntry): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageTokenRegistry);
        // Skip if already registered (idempotent for auto-registration)
        let existing = Array.find<T.TokenRegistryEntry>(tokenRegistry, func(e) { e.ledgerCanisterId == entry.ledgerCanisterId });
        switch (existing) {
            case (?_) {}; // already registered, silently skip
            case null {
                tokenRegistry := Array.append(tokenRegistry, [entry]);
                logEngine.logInfo("api", "Added token: " # entry.symbol # " (" # Principal.toText(entry.ledgerCanisterId) # ")", ?msg.caller, []);
            };
        };
    };

    public shared (msg) func removeToken(ledgerCanisterId: Principal): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageTokenRegistry);
        tokenRegistry := Array.filter<T.TokenRegistryEntry>(tokenRegistry, func(e) { e.ledgerCanisterId != ledgerCanisterId });
        logEngine.logInfo("api", "Removed token: " # Principal.toText(ledgerCanisterId), ?msg.caller, []);
    };

    public shared (msg) func reorderTokenRegistry(orderedIds: [Principal]): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageTokenRegistry);
        // Build a new ordered array: first the tokens in orderedIds order, then any remaining
        let buf = Buffer.Buffer<T.TokenRegistryEntry>(tokenRegistry.size());
        for (pid in orderedIds.vals()) {
            switch (Array.find<T.TokenRegistryEntry>(tokenRegistry, func(e) { e.ledgerCanisterId == pid })) {
                case (?e) { buf.add(e) };
                case null {};
            };
        };
        // Append any tokens not in orderedIds (shouldn't happen, but safety)
        let orderedSet = Array.map<Principal, Text>(orderedIds, func(p) { Principal.toText(p) });
        for (e in tokenRegistry.vals()) {
            let found = Array.find<Text>(orderedSet, func(t) { t == Principal.toText(e.ledgerCanisterId) });
            if (found == null) { buf.add(e) };
        };
        tokenRegistry := Buffer.toArray(buf);
        logEngine.logDebug("api", "Token registry reordered (" # Nat.toText(tokenRegistry.size()) # " tokens)", ?msg.caller, []);
    };

    public shared (msg) func refreshTokenMetadata(ledgerCanisterId: Principal): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageTokenRegistry);
        let ledger = getLedger(ledgerCanisterId);
        let fee = await ledger.icrc1_fee();
        let decimals = await ledger.icrc1_decimals();
        let symbol = await ledger.icrc1_symbol();
        tokenRegistry := Array.map<T.TokenRegistryEntry, T.TokenRegistryEntry>(tokenRegistry, func(e) {
            if (e.ledgerCanisterId == ledgerCanisterId) {
                { e with fee = fee; decimals = decimals; symbol = symbol }
            } else { e }
        });
        logEngine.logInfo("api", "Refreshed metadata for " # Principal.toText(ledgerCanisterId), ?msg.caller, []);
    };

    // ============================================
    // PUBLIC API — SUBACCOUNTS
    // ============================================

    public shared query (msg) func getSubaccounts(): async [T.SubaccountInfo] {
        assertPermission(msg.caller, T.TradingPermission.ViewPortfolio);
        Array.map<(Nat, Text), T.SubaccountInfo>(namedSubaccounts, func((n, name)) {
            { number = n; name = name; subaccount = subaccountNumberToBlob(n) }
        })
    };

    public shared (msg) func createSubaccount(name: Text): async T.SubaccountInfo {
        assertPermission(msg.caller, T.TradingPermission.ManageSubaccounts);
        let number = nextSubaccountNumber;
        nextSubaccountNumber += 1;
        namedSubaccounts := Array.append(namedSubaccounts, [(number, name)]);
        logEngine.logInfo("api", "Created subaccount " # Nat.toText(number) # ": " # name, ?msg.caller, []);
        { number = number; name = name; subaccount = subaccountNumberToBlob(number) }
    };

    public shared (msg) func renameSubaccount(number: Nat, name: Text): async Bool {
        assertPermission(msg.caller, T.TradingPermission.ManageSubaccounts);
        var found = false;
        namedSubaccounts := Array.map<(Nat, Text), (Nat, Text)>(namedSubaccounts, func((n, oldName)) {
            if (n == number) { found := true; (n, name) } else { (n, oldName) }
        });
        if (found) { logEngine.logInfo("api", "Renamed subaccount " # Nat.toText(number) # " to " # name, ?msg.caller, []) };
        found
    };

    public shared (msg) func deleteSubaccount(number: Nat): async Bool {
        assertPermission(msg.caller, T.TradingPermission.ManageSubaccounts);
        let existing = Array.find<(Nat, Text)>(namedSubaccounts, func((n, _)) { n == number });
        switch (existing) {
            case null { false };
            case (?_) {
                namedSubaccounts := Array.filter<(Nat, Text)>(namedSubaccounts, func((n, _)) { n != number });
                logEngine.logInfo("api", "Deleted subaccount " # Nat.toText(number), ?msg.caller, []);
                true
            };
        };
    };

    // ============================================
    // PUBLIC API — BALANCES
    // ============================================

    // REMOVED: getBalances and getAllBalances were expensive update methods (N inter-canister
    // calls each) exposed to the public API. Balances are now fetched directly from ledger
    // canisters by the frontend, avoiding unnecessary cycles cost and latency.

    // ============================================
    // PUBLIC API — DEX
    // ============================================

    // REMOVED: getQuote was an expensive update method (inter-canister DEX calls) exposed to
    // the public API. Prices are now fetched by the frontend via PriceService (ICPSwap pools).
    // Internal quote functionality is still available via getBestQuote/getAllQuotes for chore execution.

    public shared query (msg) func getEnabledDexes(): async [Nat] {
        assertPermission(msg.caller, T.TradingPermission.ViewPortfolio);
        enabledDexes
    };

    /// Returns all supported DEXes with their enabled/disabled status.
    public shared query (msg) func getSupportedDexes(): async [T.DexInfo] {
        assertPermission(msg.caller, T.TradingPermission.ViewPortfolio);
        Array.map<(Nat, Text, Text), T.DexInfo>(T.SUPPORTED_DEXES, func((id, name, desc)) {
            { id = id; name = name; description = desc; enabled = isDexEnabled(id) }
        })
    };

    /// Toggle a single DEX on or off. At least one DEX must remain enabled.
    public shared (msg) func setDexEnabled(dexId: Nat, enabled: Bool): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageDexSettings);
        if (enabled) {
            // Add if not already present
            if (not isDexEnabled(dexId)) {
                enabledDexes := Array.append(enabledDexes, [dexId]);
            };
        } else {
            let filtered = Array.filter<Nat>(enabledDexes, func(d) { d != dexId });
            if (filtered.size() == 0) {
                // Cannot disable the last DEX — enable all others instead
                let others = Array.map<(Nat, Text, Text), Nat>(
                    Array.filter<(Nat, Text, Text)>(T.SUPPORTED_DEXES, func((id, _, _)) { id != dexId }),
                    func((id, _, _)) { id }
                );
                enabledDexes := others;
                logEngine.logWarning("api", "Cannot disable last DEX (id " # Nat.toText(dexId) # "). Enabled others instead.", ?msg.caller, []);
            } else {
                enabledDexes := filtered;
            };
        };
        logEngine.logInfo("api", "DEX " # Nat.toText(dexId) # " " # (if enabled "enabled" else "disabled") # ". Active DEXes: " # debug_show(enabledDexes), ?msg.caller, []);
    };

    public shared (msg) func setEnabledDexes(dexIds: [Nat]): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageDexSettings);
        if (dexIds.size() == 0) {
            // Cannot disable all — keep current
            logEngine.logWarning("api", "Cannot set empty DEX list. At least one DEX must be enabled.", ?msg.caller, []);
            return;
        };
        enabledDexes := dexIds;
        logEngine.logInfo("api", "Updated enabled DEXes: " # debug_show(dexIds), ?msg.caller, []);
    };

    public shared (msg) func setDefaultSlippage(bps: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageDexSettings);
        defaultSlippageBps := bps;
        logEngine.logInfo("api", "Set default slippage to " # Nat.toText(bps) # " bps", ?msg.caller, []);
    };

    public shared (msg) func setDefaultMaxPriceImpact(bps: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageDexSettings);
        defaultMaxPriceImpactBps := bps;
        logEngine.logInfo("api", "Set default max price impact to " # Nat.toText(bps) # " bps", ?msg.caller, []);
    };

    // ============================================
    // PUBLIC API — TRADE ACTIONS
    // ============================================

    public shared query (msg) func getTradeActions(instanceId: Text): async [T.ActionConfig] {
        assertPermission(msg.caller, T.TradingPermission.ManageTrades);
        getTradeActionsForInstance(instanceId)
    };

    public shared (msg) func addTradeAction(instanceId: Text, config: T.ActionConfigInput): async Nat {
        assertPermission(msg.caller, T.TradingPermission.ManageTrades);
        let nextId = getTradeNextId(instanceId);
        let action: T.ActionConfig = {
            id = nextId;
            actionType = config.actionType;
            enabled = config.enabled;
            inputToken = config.inputToken;
            outputToken = config.outputToken;
            minAmount = config.minAmount;
            maxAmount = config.maxAmount;
            amountMode = config.amountMode;
            balancePercent = config.balancePercent;
            preferredDex = config.preferredDex;
            sourceSubaccount = config.sourceSubaccount;
            targetSubaccount = config.targetSubaccount;
            destinationOwner = config.destinationOwner;
            destinationSubaccount = config.destinationSubaccount;
            minBalance = config.minBalance;
            maxBalance = config.maxBalance;
            balanceDenominationToken = config.balanceDenominationToken;
            minPrice = config.minPrice;
            maxPrice = config.maxPrice;
            priceDenominationToken = config.priceDenominationToken;
            maxPriceImpactBps = config.maxPriceImpactBps;
            maxSlippageBps = config.maxSlippageBps;
            minFrequencySeconds = config.minFrequencySeconds;
            maxFrequencySeconds = config.maxFrequencySeconds;
            tradeSizeDenominationToken = config.tradeSizeDenominationToken;
            lastExecutedAt = null;
        };
        setTradeActionsForInstance(instanceId, Array.append(getTradeActionsForInstance(instanceId), [action]));
        setTradeNextId(instanceId, nextId + 1);
        logEngine.logInfo("api", "Added trade action " # Nat.toText(nextId) # " to instance " # instanceId, ?msg.caller, []);
        nextId
    };

    public shared (msg) func updateTradeAction(instanceId: Text, id: Nat, config: T.ActionConfigInput): async Bool {
        assertPermission(msg.caller, T.TradingPermission.ManageTrades);
        let actions = getTradeActionsForInstance(instanceId);
        var found = false;
        let updated = Array.map<T.ActionConfig, T.ActionConfig>(actions, func(a) {
            if (a.id == id) {
                found := true;
                {
                    id = id;
                    actionType = config.actionType;
                    enabled = config.enabled;
                    inputToken = config.inputToken;
                    outputToken = config.outputToken;
                    minAmount = config.minAmount;
                    maxAmount = config.maxAmount;
                    amountMode = config.amountMode;
                    balancePercent = config.balancePercent;
                    preferredDex = config.preferredDex;
                    sourceSubaccount = config.sourceSubaccount;
                    targetSubaccount = config.targetSubaccount;
                    destinationOwner = config.destinationOwner;
                    destinationSubaccount = config.destinationSubaccount;
                    minBalance = config.minBalance;
                    maxBalance = config.maxBalance;
                    balanceDenominationToken = config.balanceDenominationToken;
                    minPrice = config.minPrice;
                    maxPrice = config.maxPrice;
                    priceDenominationToken = config.priceDenominationToken;
                    maxPriceImpactBps = config.maxPriceImpactBps;
                    maxSlippageBps = config.maxSlippageBps;
                    minFrequencySeconds = config.minFrequencySeconds;
                    maxFrequencySeconds = config.maxFrequencySeconds;
                    tradeSizeDenominationToken = config.tradeSizeDenominationToken;
                    lastExecutedAt = a.lastExecutedAt; // Preserve runtime state
                }
            } else { a }
        });
        if (found) {
            setTradeActionsForInstance(instanceId, updated);
            logEngine.logInfo("api", "Updated trade action " # Nat.toText(id), ?msg.caller, []);
        };
        found
    };

    public shared (msg) func removeTradeAction(instanceId: Text, id: Nat): async Bool {
        assertPermission(msg.caller, T.TradingPermission.ManageTrades);
        let actions = getTradeActionsForInstance(instanceId);
        let filtered = Array.filter<T.ActionConfig>(actions, func(a) { a.id != id });
        if (filtered.size() < actions.size()) {
            setTradeActionsForInstance(instanceId, filtered);
            logEngine.logInfo("api", "Removed trade action " # Nat.toText(id), ?msg.caller, []);
            true
        } else { false }
    };

    public shared (msg) func reorderTradeActions(instanceId: Text, actionIds: [Nat]): async Bool {
        assertPermission(msg.caller, T.TradingPermission.ManageTrades);
        let actions = getTradeActionsForInstance(instanceId);
        let reordered = Buffer.Buffer<T.ActionConfig>(actions.size());
        for (id in actionIds.vals()) {
            let found = Array.find<T.ActionConfig>(actions, func(a) { a.id == id });
            switch (found) {
                case (?a) { reordered.add(a) };
                case null {};
            };
        };
        if (reordered.size() == actions.size()) {
            setTradeActionsForInstance(instanceId, Buffer.toArray(reordered));
            true
        } else { false }
    };

    // ============================================
    // PUBLIC API — MOVE FUNDS ACTIONS
    // ============================================

    public shared query (msg) func getMoveFundsActions(instanceId: Text): async [T.ActionConfig] {
        assertPermission(msg.caller, T.TradingPermission.ManageTrades);
        getMoveFundsActionsForInstance(instanceId)
    };

    public shared (msg) func addMoveFundsAction(instanceId: Text, config: T.ActionConfigInput): async Nat {
        assertPermission(msg.caller, T.TradingPermission.ManageTrades);
        // Validate: only action types 1, 2, 3 allowed
        if (config.actionType == 0) { Debug.trap("Trade actions not allowed in Move Funds chore") };
        let nextId = getMoveFundsNextId(instanceId);
        let action: T.ActionConfig = {
            id = nextId;
            actionType = config.actionType;
            enabled = config.enabled;
            inputToken = config.inputToken;
            outputToken = null; // No trading
            minAmount = config.minAmount;
            maxAmount = config.maxAmount;
            amountMode = config.amountMode;
            balancePercent = config.balancePercent;
            preferredDex = null;
            sourceSubaccount = config.sourceSubaccount;
            targetSubaccount = config.targetSubaccount;
            destinationOwner = config.destinationOwner;
            destinationSubaccount = config.destinationSubaccount;
            minBalance = config.minBalance;
            maxBalance = config.maxBalance;
            balanceDenominationToken = config.balanceDenominationToken;
            minPrice = null;
            maxPrice = null;
            priceDenominationToken = null;
            maxPriceImpactBps = null;
            maxSlippageBps = null;
            minFrequencySeconds = config.minFrequencySeconds;
            maxFrequencySeconds = config.maxFrequencySeconds;
            tradeSizeDenominationToken = null;
            lastExecutedAt = null;
        };
        setMoveFundsActionsForInstance(instanceId, Array.append(getMoveFundsActionsForInstance(instanceId), [action]));
        setMoveFundsNextId(instanceId, nextId + 1);
        logEngine.logInfo("api", "Added move-funds action " # Nat.toText(nextId), ?msg.caller, []);
        nextId
    };

    public shared (msg) func updateMoveFundsAction(instanceId: Text, id: Nat, config: T.ActionConfigInput): async Bool {
        assertPermission(msg.caller, T.TradingPermission.ManageTrades);
        if (config.actionType == 0) { Debug.trap("Trade actions not allowed in Move Funds chore") };
        let actions = getMoveFundsActionsForInstance(instanceId);
        var found = false;
        let updated = Array.map<T.ActionConfig, T.ActionConfig>(actions, func(a) {
            if (a.id == id) {
                found := true;
                { a with
                    actionType = config.actionType;
                    enabled = config.enabled;
                    inputToken = config.inputToken;
                    minAmount = config.minAmount;
                    maxAmount = config.maxAmount;
                    amountMode = config.amountMode;
                    balancePercent = config.balancePercent;
                    sourceSubaccount = config.sourceSubaccount;
                    targetSubaccount = config.targetSubaccount;
                    destinationOwner = config.destinationOwner;
                    destinationSubaccount = config.destinationSubaccount;
                    minBalance = config.minBalance;
                    maxBalance = config.maxBalance;
                    balanceDenominationToken = config.balanceDenominationToken;
                    minFrequencySeconds = config.minFrequencySeconds;
                    maxFrequencySeconds = config.maxFrequencySeconds;
                }
            } else { a }
        });
        if (found) { setMoveFundsActionsForInstance(instanceId, updated) };
        found
    };

    public shared (msg) func removeMoveFundsAction(instanceId: Text, id: Nat): async Bool {
        assertPermission(msg.caller, T.TradingPermission.ManageTrades);
        let actions = getMoveFundsActionsForInstance(instanceId);
        let filtered = Array.filter<T.ActionConfig>(actions, func(a) { a.id != id });
        if (filtered.size() < actions.size()) {
            setMoveFundsActionsForInstance(instanceId, filtered);
            true
        } else { false }
    };

    // ============================================
    // PUBLIC API — REBALANCER
    // ============================================

    public shared query (msg) func getRebalanceTargets(instanceId: Text): async [T.RebalanceTarget] {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        getRebalTargets(instanceId)
    };

    public shared (msg) func setRebalanceTargets(instanceId: Text, targets: [T.RebalanceTarget]): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        rebalanceTargets := setInMap(rebalanceTargets, instanceId, targets);
        logEngine.logInfo("api", "Set rebalance targets for " # instanceId # ": " # Nat.toText(targets.size()) # " tokens", ?msg.caller, []);
    };

    public shared query (msg) func getRebalanceSettings(instanceId: Text): async T.RebalanceSettings {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        {
            denominationToken = getRebalDenomToken(instanceId);
            maxTradeSize = getRebalMaxTrade(instanceId);
            minTradeSize = getRebalMinTrade(instanceId);
            maxPriceImpactBps = getRebalMaxImpact(instanceId);
            maxSlippageBps = getRebalMaxSlippage(instanceId);
            thresholdBps = getRebalThreshold(instanceId);
            fallbackRouteTokens = getRebalFallbackRouteTokens(instanceId);
        }
    };

    public shared (msg) func setRebalanceDenominationToken(instanceId: Text, token: Principal): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        rebalanceDenominationToken := setInMap(rebalanceDenominationToken, instanceId, token);
    };

    public shared (msg) func setRebalanceMaxTradeSize(instanceId: Text, amount: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        rebalanceMaxTradeSize := setInMap(rebalanceMaxTradeSize, instanceId, amount);
    };

    public shared (msg) func setRebalanceMinTradeSize(instanceId: Text, amount: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        rebalanceMinTradeSize := setInMap(rebalanceMinTradeSize, instanceId, amount);
    };

    public shared (msg) func setRebalanceMaxPriceImpactBps(instanceId: Text, bps: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        rebalanceMaxPriceImpactBps := setInMap(rebalanceMaxPriceImpactBps, instanceId, bps);
    };

    public shared (msg) func setRebalanceMaxSlippageBps(instanceId: Text, bps: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        rebalanceMaxSlippageBps := setInMap(rebalanceMaxSlippageBps, instanceId, bps);
    };

    public shared (msg) func setRebalanceThresholdBps(instanceId: Text, bps: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        rebalanceThresholdBps := setInMap(rebalanceThresholdBps, instanceId, bps);
    };

    public shared (msg) func setRebalanceFallbackRouteTokens(instanceId: Text, tokens: [Principal]): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageRebalancer);
        rebalanceFallbackRouteTokens := setInMap(rebalanceFallbackRouteTokens, instanceId, tokens);
        logEngine.logInfo("api", "Set rebalance fallback route tokens for " # instanceId # ": " # Nat.toText(tokens.size()) # " tokens", ?msg.caller, []);
    };

    // REMOVED: getPortfolioStatus was an expensive update method (N balance + N quote
    // inter-canister calls) exposed to the public API. Portfolio status is now computed
    // entirely on the frontend using direct ledger balance calls + PriceService.

    // ============================================
    // PUBLIC API — DISTRIBUTION
    // ============================================

    public shared query (msg) func getDistributionLists(instanceId: Text): async [DistributionTypes.DistributionList] {
        assertPermission(msg.caller, T.TradingPermission.ViewChores);
        let ds = getDistSettings(instanceId);
        ds.lists
    };

    public shared (msg) func addDistributionList(instanceId: Text, input: DistributionTypes.DistributionListInput): async Nat {
        assertPermission(msg.caller, T.TradingPermission.ConfigureDistribution);
        let ds = getDistSettings(instanceId);
        let newId = ds.nextListId;
        let newList: DistributionTypes.DistributionList = {
            id = newId;
            name = input.name;
            sourceSubaccount = input.sourceSubaccount;
            tokenLedgerCanisterId = input.tokenLedgerCanisterId;
            thresholdAmount = input.thresholdAmount;
            maxDistributionAmount = input.maxDistributionAmount;
            targets = input.targets;
        };
        setDistSettings(instanceId, { lists = Array.append(ds.lists, [newList]); nextListId = newId + 1 });
        logEngine.logInfo("api", "Added distribution list " # Nat.toText(newId), ?msg.caller, []);
        newId
    };

    public shared (msg) func updateDistributionList(instanceId: Text, id: Nat, input: DistributionTypes.DistributionListInput): async () {
        assertPermission(msg.caller, T.TradingPermission.ConfigureDistribution);
        let ds = getDistSettings(instanceId);
        let updated = Array.map<DistributionTypes.DistributionList, DistributionTypes.DistributionList>(ds.lists, func(l) {
            if (l.id == id) {
                { l with name = input.name; sourceSubaccount = input.sourceSubaccount; tokenLedgerCanisterId = input.tokenLedgerCanisterId; thresholdAmount = input.thresholdAmount; maxDistributionAmount = input.maxDistributionAmount; targets = input.targets }
            } else { l }
        });
        setDistSettings(instanceId, { ds with lists = updated });
    };

    public shared (msg) func removeDistributionList(instanceId: Text, id: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ConfigureDistribution);
        let ds = getDistSettings(instanceId);
        setDistSettings(instanceId, { ds with lists = Array.filter<DistributionTypes.DistributionList>(ds.lists, func(l) { l.id != id }) });
    };

    // ============================================
    // PUBLIC API — CHORE MANAGEMENT
    // ============================================

    public shared query (msg) func getChoreStatuses(): async [BotChoreTypes.ChoreStatus] {
        assertPermission(msg.caller, T.TradingPermission.ViewChores);
        choreEngine.getAllStatuses()
    };

    public shared query (msg) func getChoreStatus(choreId: Text): async ?BotChoreTypes.ChoreStatus {
        assertPermission(msg.caller, T.TradingPermission.ViewChores);
        choreEngine.getStatus(choreId)
    };

    public shared query (msg) func getChoreTypes(): async [BotChoreTypes.ChoreTypeInfo] {
        assertPermission(msg.caller, T.TradingPermission.ViewChores);
        choreEngine.listChoreTypes()
    };

    // Query: Get configs of all chores (aligned with staking bot API)
    public shared query ({ caller }) func getChoreConfigs(): async [(Text, BotChoreTypes.ChoreConfig)] {
        assertPermission(caller, T.TradingPermission.ViewChores);
        choreEngine.getAllConfigs()
    };

    public shared (msg) func createChoreInstance(typeId: Text, instanceId: Text, instanceLabel: Text): async Bool {
        assertPermission(msg.caller, choreManagePermission(typeId));
        choreEngine.createInstance(typeId, instanceId, instanceLabel)
    };

    public shared (msg) func deleteChoreInstance(instanceId: Text): async Bool {
        assertPermission(msg.caller, choreManagePermission(instanceId));
        choreEngine.deleteInstance(instanceId)
    };

    public shared (msg) func renameChoreInstance(instanceId: Text, newLabel: Text): async Bool {
        assertPermission(msg.caller, choreManagePermission(instanceId));
        choreEngine.renameInstance(instanceId, newLabel)
    };

    public shared query (msg) func listChoreInstances(typeIdFilter: ?Text): async [(Text, BotChoreTypes.ChoreInstanceInfo)] {
        assertPermission(msg.caller, T.TradingPermission.ViewChores);
        choreEngine.listInstances(typeIdFilter)
    };

    public shared (msg) func startChore(choreId: Text): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.start<system>(choreId);
        logEngine.logInfo("api", "Started chore: " # choreId, ?msg.caller, []);
    };

    public shared (msg) func scheduleStartChore(choreId: Text, timestampNanos: Int): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.scheduleStart<system>(choreId, timestampNanos);
        logEngine.logInfo("api", "Scheduled start for chore: " # choreId, ?msg.caller, []);
    };

    public shared (msg) func pauseChore(choreId: Text): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.pause(choreId);
        logEngine.logInfo("api", "Paused chore: " # choreId, ?msg.caller, []);
    };

    public shared (msg) func resumeChore(choreId: Text): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.resume<system>(choreId);
        logEngine.logInfo("api", "Resumed chore: " # choreId, ?msg.caller, []);
    };

    public shared (msg) func stopChore(choreId: Text): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.stop(choreId);
        logEngine.logInfo("api", "Stopped chore: " # choreId, ?msg.caller, []);
    };

    public shared (msg) func stopAllChores(): async () {
        assertPermission(msg.caller, T.TradingPermission.FullPermissions);
        choreEngine.stopAllChores();
        logEngine.logInfo("api", "Stopped all chores", ?msg.caller, []);
    };

    public shared (msg) func triggerChore(choreId: Text): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.trigger<system>(choreId);
        logEngine.logInfo("api", "Triggered chore: " # choreId, ?msg.caller, []);
    };

    public shared (msg) func setChoreInterval(choreId: Text, seconds: Nat): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.setInterval(choreId, seconds);
        logEngine.logInfo("api", "Set interval for " # choreId # " to " # Nat.toText(seconds) # "s", ?msg.caller, []);
    };

    public shared (msg) func setChoreMaxInterval(choreId: Text, seconds: ?Nat): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.setMaxInterval(choreId, seconds);
    };

    public shared (msg) func setChoreTaskTimeout(choreId: Text, seconds: Nat): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.setTaskTimeout(choreId, seconds);
    };

    public shared (msg) func setChoreNextRun(choreId: Text, timestampNanos: Int): async () {
        assertPermission(msg.caller, choreManagePermission(choreId));
        choreEngine.setNextScheduledRun<system>(choreId, timestampNanos);
    };

    // ============================================
    // PUBLIC API — LOGGING
    // ============================================

    public shared query (msg) func getLogs(filter: BotLogTypes.LogFilter): async BotLogTypes.LogResult {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);
        logEngine.getLogs(filter)
    };

    public shared query (msg) func getLogConfig(): async BotLogTypes.LogConfig {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);
        logEngine.getConfig()
    };

    public shared (msg) func setLogLevel(level: BotLogTypes.LogLevel): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageLogs);
        logEngine.setLogLevel(level);
        logEngine.logInfo("log", "Log level changed", ?msg.caller, []);
    };

    public shared (msg) func clearLogs(): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageLogs);
        logEngine.clear();
    };

    // ============================================
    // PUBLIC API — TRADE LOG
    // ============================================

    func matchTradeLogEntry(e: T.TradeLogEntry, q: T.TradeLogQuery): Bool {
        switch (q.startId) { case (?s) { if (e.id < s) return false }; case null {} };
        switch (q.fromTime) { case (?t) { if (e.timestamp < t) return false }; case null {} };
        switch (q.toTime) { case (?t) { if (e.timestamp > t) return false }; case null {} };
        switch (q.actionType) { case (?a) { if (e.actionType != a) return false }; case null {} };
        switch (q.inputToken) { case (?t) { if (e.inputToken != t) return false }; case null {} };
        switch (q.choreId) {
            case (?c) { switch (e.choreId) { case (?ec) { if (ec != c) return false }; case null { return false } } };
            case null {};
        };
        switch (q.choreTypeId) {
            case (?c) { switch (e.choreTypeId) { case (?ec) { if (ec != c) return false }; case null { return false } } };
            case null {};
        };
        switch (q.outputToken) {
            case (?t) { switch (e.outputToken) { case (?eo) { if (eo != t) return false }; case null { return false } } };
            case null {};
        };
        switch (q.status) { case (?s) { if (e.status != s) return false }; case null {} };
        true
    };

    public shared query (msg) func getTradeLog(q: T.TradeLogQuery): async T.TradeLogResult {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);

        let limit = switch (q.limit) { case (?l) l; case null 50 };
        let filtered = Array.filter<T.TradeLogEntry>(tradeLogEntries, func(e: T.TradeLogEntry): Bool { matchTradeLogEntry(e, q) });
        let totalCount = filtered.size();
        let page = if (totalCount <= limit) { filtered } else {
            Array.tabulate<T.TradeLogEntry>(limit, func(i: Nat): T.TradeLogEntry { filtered[i] })
        };
        { entries = page; totalCount = totalCount; hasMore = totalCount > limit }
    };

    public shared query (msg) func getTradeLogStats(): async { totalEntries: Nat; nextId: Nat } {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);
        { totalEntries = tradeLogEntries.size(); nextId = tradeLogNextId }
    };

    public shared (msg) func clearTradeLog(): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageLogs);
        tradeLogEntries := [];
        logEngine.logInfo("trade-log", "Trade log cleared", ?msg.caller, []);
    };

    // ============================================
    // PUBLIC API — PORTFOLIO SNAPSHOT LOG
    // ============================================

    func matchPortfolioSnapshot(e: T.PortfolioSnapshot, q: T.PortfolioSnapshotQuery): Bool {
        switch (q.startId) { case (?s) { if (e.id < s) return false }; case null {} };
        switch (q.fromTime) { case (?t) { if (e.timestamp < t) return false }; case null {} };
        switch (q.toTime) { case (?t) { if (e.timestamp > t) return false }; case null {} };
        switch (q.tradeLogId) {
            case (?tid) { switch (e.tradeLogId) { case (?etid) { if (etid != tid) return false }; case null { return false } } };
            case null {};
        };
        switch (q.phase) { case (?p) { if (e.phase != p) return false }; case null {} };
        true
    };

    public shared query (msg) func getPortfolioSnapshots(q: T.PortfolioSnapshotQuery): async T.PortfolioSnapshotResult {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);

        let limit = switch (q.limit) { case (?l) l; case null 20 };
        let filtered = Array.filter<T.PortfolioSnapshot>(portfolioSnapshots, func(e: T.PortfolioSnapshot): Bool { matchPortfolioSnapshot(e, q) });
        let totalCount = filtered.size();
        let page = if (totalCount <= limit) { filtered } else {
            Array.tabulate<T.PortfolioSnapshot>(limit, func(i: Nat): T.PortfolioSnapshot { filtered[i] })
        };
        { entries = page; totalCount = totalCount; hasMore = totalCount > limit }
    };

    public shared query (msg) func getPortfolioSnapshotStats(): async { totalEntries: Nat; nextId: Nat } {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);
        { totalEntries = portfolioSnapshots.size(); nextId = portfolioSnapshotNextId }
    };

    public shared query (msg) func getCapitalFlows(): async {
        capitalDeployedIcpE8s: Int;
        capitalDeployedUsdE8s: Int;
        perToken: [(Text, { totalInflowNative: Nat; totalOutflowNative: Nat })];
    } {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);
        {
            capitalDeployedIcpE8s = capitalDeployedIcpE8s;
            capitalDeployedUsdE8s = capitalDeployedUsdE8s;
            perToken = Array.map<(Text, (Nat, Nat)), (Text, { totalInflowNative: Nat; totalOutflowNative: Nat })>(
                tokenCapitalFlows, func((k, (infl, outfl))) { (k, { totalInflowNative = infl; totalOutflowNative = outfl }) }
            );
        }
    };

    public shared (msg) func clearPortfolioSnapshots(): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageLogs);
        portfolioSnapshots := [];
        logEngine.logInfo("portfolio-log", "Portfolio snapshot log cleared", ?msg.caller, []);
    };

    // ============================================
    // PUBLIC API — LOGGING SETTINGS
    // ============================================

    public shared query (msg) func getLoggingSettings(): async T.LoggingSettings {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);
        loggingSettings
    };

    public shared (msg) func setLoggingSettings(settings: T.LoggingSettings): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageLogs);
        loggingSettings := settings;
        logEngine.logInfo("settings", "Logging settings updated", ?msg.caller, []);
    };

    public shared query (msg) func getChoreLoggingOverrides(): async [(Text, T.ChoreLoggingOverrides)] {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);
        choreLoggingOverrides
    };

    public shared (msg) func setChoreLoggingOverride(choreId: Text, overrides: T.ChoreLoggingOverrides): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageLogs);
        let buf = Buffer.fromArray<(Text, T.ChoreLoggingOverrides)>(
            Array.filter<(Text, T.ChoreLoggingOverrides)>(choreLoggingOverrides, func(e: (Text, T.ChoreLoggingOverrides)): Bool { e.0 != choreId })
        );
        buf.add((choreId, overrides));
        choreLoggingOverrides := Buffer.toArray(buf);
        logEngine.logInfo("settings", "Chore logging override set for " # choreId, ?msg.caller, []);
    };

    public shared (msg) func removeChoreLoggingOverride(choreId: Text): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageLogs);
        choreLoggingOverrides := Array.filter<(Text, T.ChoreLoggingOverrides)>(choreLoggingOverrides, func(e: (Text, T.ChoreLoggingOverrides)): Bool { e.0 != choreId });
        logEngine.logInfo("settings", "Chore logging override removed for " # choreId, ?msg.caller, []);
    };

    // ============================================
    // PUBLIC API — METADATA STALENESS
    // ============================================

    /// Get the current metadata staleness threshold (seconds).
    public shared query (msg) func getMetadataStaleness(): async Nat {
        assertPermission(msg.caller, T.TradingPermission.ViewPortfolio);
        metadataStalenessSeconds
    };

    /// Set the metadata staleness threshold (seconds). Metadata older than
    /// this will be re-fetched at the start of each chore run.
    public shared (msg) func setMetadataStaleness(seconds: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageDexSettings);
        metadataStalenessSeconds := seconds;
        logEngine.logInfo("settings", "Metadata staleness set to " # Nat.toText(seconds) # "s", ?msg.caller, []);
    };

    // ============================================
    // PUBLIC API — PRICE SETTINGS & HISTORY
    // ============================================

    public shared query (msg) func getPriceStaleness(): async Nat {
        assertPermission(msg.caller, T.TradingPermission.ViewPortfolio);
        priceStalenessSeconds
    };

    public shared (msg) func setPriceStaleness(seconds: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageDexSettings);
        priceStalenessSeconds := seconds;
        logEngine.logInfo("settings", "Price staleness set to " # Nat.toText(seconds) # "s", ?msg.caller, []);
    };

    public shared query (msg) func getPriceHistoryMaxSize(): async Nat {
        assertPermission(msg.caller, T.TradingPermission.ViewPortfolio);
        priceHistoryMaxSize
    };

    public shared (msg) func setPriceHistoryMaxSize(size: Nat): async () {
        assertPermission(msg.caller, T.TradingPermission.ManageDexSettings);
        priceHistoryMaxSize := size;
        // Truncate history if new size is smaller
        if (size < priceHistory.size()) {
            // Keep the most recent entries: the ring buffer write position tells us ordering.
            // Rebuild as a simple array of the newest `size` entries.
            let len = priceHistory.size();
            priceHistory := Array.tabulate<T.CachedPrice>(size, func(i) {
                priceHistory[(priceHistoryNextIdx + len - size + i) % len]
            });
            priceHistoryNextIdx := 0;
        };
        logEngine.logInfo("settings", "Price history max size set to " # Nat.toText(size), ?msg.caller, []);
    };

    public shared query (msg) func getLastKnownPrices(): async [(Text, T.CachedPrice)] {
        assertPermission(msg.caller, T.TradingPermission.ViewPortfolio);
        lastKnownPrices
    };

    public shared query (msg) func getPriceHistory(q: T.PriceHistoryQuery): async T.PriceHistoryResult {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);
        // Linearize ring buffer: oldest first
        let len = priceHistory.size();
        let linearized = if (len < priceHistoryMaxSize) {
            priceHistory
        } else {
            Array.tabulate<T.CachedPrice>(len, func(i) {
                priceHistory[(priceHistoryNextIdx + i) % len]
            })
        };
        // Filter by pairKey if specified
        let filtered = switch (q.pairKey) {
            case (?pk) {
                Array.filter<T.CachedPrice>(linearized, func(entry) {
                    pairKey(entry.inputToken, entry.outputToken) == pk
                })
            };
            case null linearized;
        };
        let total = filtered.size();
        let off = switch (q.offset) { case (?o) Nat.min(o, total); case null 0 };
        let lim = switch (q.limit) { case (?l) l; case null 100 };
        let end = Nat.min(off + lim, total);
        let page = if (off >= total) { [] } else {
            Array.tabulate<T.CachedPrice>(end - off, func(i) { filtered[off + i] })
        };
        { entries = page; totalCount = total }
    };

    // ============================================
    // PUBLIC API — DAILY OHLC SUMMARIES
    // ============================================

    public shared query (msg) func getDailyPortfolioSummaries(q: T.DailyPortfolioSummaryQuery): async {
        entries: [T.DailyPortfolioSummary];
        totalCount: Nat;
    } {
        assertPermission(msg.caller, T.TradingPermission.ViewPortfolio);

        var filtered = dailyPortfolioSummaries;

        // Filter by date range
        switch (q.fromDate) {
            case (?from) { filtered := Array.filter<T.DailyPortfolioSummary>(filtered, func(s) { s.date >= from }) };
            case null {};
        };
        switch (q.toDate) {
            case (?to) { filtered := Array.filter<T.DailyPortfolioSummary>(filtered, func(s) { s.date <= to }) };
            case null {};
        };

        // Filter by subaccount
        switch (q.subaccount) {
            case (?subOpt) { filtered := Array.filter<T.DailyPortfolioSummary>(filtered, func(s) { blobOptEq(s.subaccount, subOpt) }) };
            case null {};
        };

        let total = filtered.size();
        let off = switch (q.offset) { case (?o) Nat.min(o, total); case null 0 };
        let lim = switch (q.limit) { case (?l) l; case null 100 };
        let end = Nat.min(off + lim, total);
        let page = if (off >= total) { [] } else {
            Array.tabulate<T.DailyPortfolioSummary>(end - off, func(i) { filtered[off + i] })
        };
        { entries = page; totalCount = total }
    };

    public shared query (msg) func getDailyPriceCandles(q: T.DailyPriceCandleQuery): async {
        entries: [T.DailyPriceCandle];
        totalCount: Nat;
    } {
        assertPermission(msg.caller, T.TradingPermission.ViewLogs);

        var filtered = dailyPriceCandles;

        switch (q.pairKey) {
            case (?pk) { filtered := Array.filter<T.DailyPriceCandle>(filtered, func(c) { c.pairKey == pk }) };
            case null {};
        };
        switch (q.fromDate) {
            case (?from) { filtered := Array.filter<T.DailyPriceCandle>(filtered, func(c) { c.date >= from }) };
            case null {};
        };
        switch (q.toDate) {
            case (?to) { filtered := Array.filter<T.DailyPriceCandle>(filtered, func(c) { c.date <= to }) };
            case null {};
        };

        let total = filtered.size();
        let off = switch (q.offset) { case (?o) Nat.min(o, total); case null 0 };
        let lim = switch (q.limit) { case (?l) l; case null 100 };
        let end = Nat.min(off + lim, total);
        let page = if (off >= total) { [] } else {
            Array.tabulate<T.DailyPriceCandle>(end - off, func(i) { filtered[off + i] })
        };
        { entries = page; totalCount = total }
    };

};
