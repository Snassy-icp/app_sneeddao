import Buffer "mo:base/Buffer";
import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Text "mo:base/Text";

import BotLogTypes "BotLogTypes";
import BotRing "BotRing";

/// Reusable bot log engine.
///
/// Provides append, query, and filtering over a ring buffer of log entries.
/// Each bot canister creates one instance and passes its persistent state via the config:
/// the stable ring (mutated in place, so an append is O(1)), the old array-based log (moved into
/// the ring once, then emptied), and callbacks for the id counter and the level.
///
/// Usage in a bot canister:
/// ```
///   var botLogRing: BotRing.Ring<BotLogTypes.LogEntry> = BotRing.empty();
///   transient let logEngine = BotLogEngine.Engine({
///       ring = botLogRing;
///       getEntries = func() { botLogEntries };
///       setEntries = func(e) { botLogEntries := e };
///       getNextId = func() { botLogNextId };
///       setNextId = func(n) { botLogNextId := n };
///       getLogLevel = func() { botLogLevel };
///       setLogLevel = func(n) { botLogLevel := n };
///       maxEntries = botLogMaxEntries;
///   });
///   logEngine.logInfo("system", "Canister initialized", null, []);
/// ```
module {

    /// Most entries a bot keeps (a larger setting is clamped to this).
    public let MAX_ENTRIES_CAP : Nat = 50_000;
    /// Most entries one getLogs reply carries.
    public let MAX_PAGE : Nat = 500;
    /// A getLogs reply stops adding entries at about this many bytes (well under the 2 MiB
    /// inter-canister and 3 MiB query reply limits).
    public let REPLY_BUDGET_BYTES : Nat = 1_000_000;

    public func clampMaxEntries(n : Nat) : Nat { if (n > MAX_ENTRIES_CAP) MAX_ENTRIES_CAP else n };

    /// A generous estimate of an entry's Candid size.
    public func entryBytes(e : BotLogTypes.LogEntry) : Nat {
        var n = 96 + e.source.size() + e.message.size();
        for ((k, v) in e.tags.vals()) { n += 8 + k.size() + v.size() };
        n
    };

    public class Engine(config: BotLogTypes.EngineConfig) {

        let setNextId = config.setNextId;
        let setLogLevelNat = config.setLogLevel;
        func clampMax(n : Nat) : Nat { if (n > 50_000) 50_000 else n }; // = MAX_ENTRIES_CAP
        var maxEntries = clampMax(config.maxEntries);

        // The stable ring, mutated in place.
        let ring : BotRing.Ring<BotLogTypes.LogEntry> = config.ring;

        // One-time move of the old array-based log into the ring.
        do {
            let legacy = config.getEntries();
            if (legacy.size() > 0) {
                BotRing.appendAll(ring, legacy, maxEntries);
                config.setEntries([]);
            };
            BotRing.trim(ring, maxEntries);
        };

        var nextId: Nat = config.getNextId();
        var currentLevel: Nat = config.getLogLevel();

        // Check if an entry matches all filter criteria
        func matchesFilter(
            entry: BotLogTypes.LogEntry,
            minLvl: Nat,
            filter: BotLogTypes.LogFilter
        ): Bool {
            // Level filter — levels: Error=1, Warning=2, Info=3, Debug=4, Trace=5
            // minLvl acts as a severity ceiling: show entries at this level or MORE severe (lower number).
            // E.g. minLvl=2 (Warning) shows Error(1) + Warning(2), hides Info(3)+Debug(4)+Trace(5).
            let entryLvl = BotLogTypes.logLevelToNat(entry.level);
            if (entryLvl == 0) return false; // #Off entries should never exist, but skip if so
            if (minLvl > 0 and entryLvl > minLvl) return false;

            // Source prefix filter
            switch (filter.source) {
                case (?src) {
                    if (not Text.startsWith(entry.source, #text src)) return false;
                };
                case null {};
            };

            // Caller filter
            switch (filter.caller) {
                case (?c) {
                    switch (entry.caller) {
                        case (?ec) { if (not Principal.equal(ec, c)) return false };
                        case null { return false };
                    };
                };
                case null {};
            };

            // Time range filters
            switch (filter.fromTime) {
                case (?from) { if (entry.timestamp < from) return false };
                case null {};
            };
            switch (filter.toTime) {
                case (?to) { if (entry.timestamp > to) return false };
                case null {};
            };

            // Start ID filter (for pagination)
            switch (filter.startId) {
                case (?sid) { if (entry.id < sid) return false };
                case null {};
            };
            switch (filter.beforeId) {
                case (?bid) { if (entry.id >= bid) return false };
                case null {};
            };

            true
        };

        func sizeOf(e : BotLogTypes.LogEntry) : Nat { // = entryBytes
            var n = 96 + e.source.size() + e.message.size();
            for ((k, v) in e.tags.vals()) { n += 8 + k.size() + v.size() };
            n
        };

        // ============================================
        // LOGGING
        // ============================================

        /// Add a log entry (if the level meets the current write threshold).
        /// Entries at #Off level or below the current logLevel are silently dropped.
        public func add(
            level: BotLogTypes.LogLevel,
            source: Text,
            message: Text,
            caller: ?Principal,
            tags: [(Text, Text)]
        ) {
            let lvl = BotLogTypes.logLevelToNat(level);
            // Don't log if level is Off, or the current log level is Off, or entry is below threshold
            if (lvl == 0 or currentLevel == 0 or lvl > currentLevel) return;

            let entry: BotLogTypes.LogEntry = {
                id = nextId;
                timestamp = Time.now();
                level = level;
                source = source;
                message = message;
                caller = caller;
                tags = tags;
            };
            nextId += 1;
            ignore BotRing.push(ring, entry, maxEntries);
            setNextId(nextId);
        };

        /// Convenience: log at Error level.
        public func logError(source: Text, message: Text, caller: ?Principal, tags: [(Text, Text)]) {
            add(#Error, source, message, caller, tags);
        };

        /// Convenience: log at Warning level.
        public func logWarning(source: Text, message: Text, caller: ?Principal, tags: [(Text, Text)]) {
            add(#Warning, source, message, caller, tags);
        };

        /// Convenience: log at Info level.
        public func logInfo(source: Text, message: Text, caller: ?Principal, tags: [(Text, Text)]) {
            add(#Info, source, message, caller, tags);
        };

        /// Convenience: log at Debug level.
        public func logDebug(source: Text, message: Text, caller: ?Principal, tags: [(Text, Text)]) {
            add(#Debug, source, message, caller, tags);
        };

        /// Convenience: log at Trace level.
        public func logTrace(source: Text, message: Text, caller: ?Principal, tags: [(Text, Text)]) {
            add(#Trace, source, message, caller, tags);
        };

        // ============================================
        // QUERYING
        // ============================================

        /// Query log entries with filtering and pagination.
        /// Returns entries in ascending ID order, at most MAX_PAGE of them and about
        /// REPLY_BUDGET_BYTES.
        ///
        /// When `startId` is provided (Some), returns up to `limit` matching entries
        /// starting from that ID (forward scan — oldest first).
        ///
        /// When `startId` is absent (None), returns the **newest** `limit` matching
        /// entries so the default view always shows the most recent activity
        /// (with `beforeId`, the newest ones below that ID: paging back).
        public func getLogs(filter: BotLogTypes.LogFilter): BotLogTypes.LogResult {
            let minLvl: Nat = switch (filter.minLevel) {
                case (?l) { BotLogTypes.logLevelToNat(l) };
                case null { 0 };
            };
            let requested: Nat = switch (filter.limit) {
                case (?l) { l };
                case null { 100 };
            };
            let limit: Nat = if (requested > 500) 500 else requested; // = MAX_PAGE

            let hasStartId = switch (filter.startId) { case (?_) true; case null false };

            var totalMatching: Nat = 0;
            let matching = Buffer.Buffer<BotLogTypes.LogEntry>(limit);
            var bytes: Nat = 0;
            var full = false;
            let it = if (hasStartId) BotRing.vals(ring) else BotRing.valsNewestFirst(ring);
            for (entry in it) {
                if (matchesFilter(entry, minLvl, filter)) {
                    totalMatching += 1;
                    if (not full) {
                        let b = sizeOf(entry);
                        if (matching.size() >= limit or (matching.size() > 0 and bytes + b > 1_000_000)) { // REPLY_BUDGET_BYTES
                            full := true;
                        } else {
                            matching.add(entry);
                            bytes += b;
                        };
                    };
                };
            };
            if (not hasStartId) Buffer.reverse(matching);

            {
                entries = Buffer.toArray(matching);
                totalMatching = totalMatching;
                hasMore = totalMatching > matching.size();
            }
        };

        // ============================================
        // ALERT SUMMARY
        // ============================================

        /// Lightweight scan: count Error and Warning entries with id > sinceId.
        public func getAlertSummary(sinceId: Nat): BotLogTypes.LogAlertSummary {
            var errorCount: Nat = 0;
            var warningCount: Nat = 0;
            var highestErrorId: Nat = 0;
            var highestWarningId: Nat = 0;

            label scan for (entry in BotRing.valsNewestFirst(ring)) {
                if (entry.id <= sinceId) break scan; // ids grow with position: the rest are older
                do {
                    let lvl = BotLogTypes.logLevelToNat(entry.level);
                    if (lvl == 1) { // Error
                        errorCount += 1;
                        if (entry.id > highestErrorId) { highestErrorId := entry.id };
                    } else if (lvl == 2) { // Warning
                        warningCount += 1;
                        if (entry.id > highestWarningId) { highestWarningId := entry.id };
                    };
                };
            };

            {
                unseenErrorCount = errorCount;
                unseenWarningCount = warningCount;
                highestErrorId = highestErrorId;
                highestWarningId = highestWarningId;
                nextId = nextId;
            }
        };

        // ============================================
        // CONFIGURATION
        // ============================================

        /// Get current log configuration.
        public func getConfig(): BotLogTypes.LogConfig {
            {
                logLevel = BotLogTypes.natToLogLevel(currentLevel);
                maxEntries = maxEntries;
                entryCount = BotRing.size(ring);
                nextId = nextId;
            }
        };

        /// Set the minimum log level (write-side threshold).
        public func setLogLevel(level: BotLogTypes.LogLevel) {
            currentLevel := BotLogTypes.logLevelToNat(level);
            setLogLevelNat(currentLevel);
        };

        /// Set the maximum number of entries to retain (clamped to MAX_ENTRIES_CAP).
        /// Immediately trims if the current count exceeds the new limit. Returns the value set.
        public func setMaxEntries(n: Nat): Nat {
            maxEntries := clampMax(n);
            BotRing.trim(ring, maxEntries);
            maxEntries
        };

        /// Clear all log entries. The nextId continues to increase (entry IDs are never reused).
        public func clear() {
            BotRing.clear(ring);
        };

        /// Get current entry count.
        public func size(): Nat { BotRing.size(ring) };
    };
};
