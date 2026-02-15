import Buffer "mo:base/Buffer";
import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Text "mo:base/Text";

import BotLogTypes "BotLogTypes";

/// Reusable bot log engine.
///
/// Provides efficient append, query, and filtering over a circular log buffer.
/// Each bot canister creates one instance and passes its persistent state via callbacks.
///
/// Usage in a bot canister:
/// ```
///   transient let logEngine = BotLogEngine.Engine({
///       getEntries = func() { botLogEntries };
///       setEntries = func(e) { botLogEntries := e };
///       getNextId = func() { botLogNextId };
///       setNextId = func(n) { botLogNextId := n };
///       getLogLevel = func() { botLogLevel };
///       setLogLevel = func(n) { botLogLevel := n };
///       maxEntries = 10_000;
///   });
///   logEngine.logInfo("system", "Canister initialized", null, []);
/// ```
module {

    public class Engine(config: BotLogTypes.EngineConfig) {

        let setEntries = config.setEntries;
        let setNextId = config.setNextId;
        let setLogLevelNat = config.setLogLevel;
        var maxEntries = config.maxEntries;

        // Internal buffer for efficient operations (transient, rebuilt from persistent state on init)
        var buf: Buffer.Buffer<BotLogTypes.LogEntry> = do {
            let initEntries = config.getEntries();
            let b = Buffer.Buffer<BotLogTypes.LogEntry>(initEntries.size());
            for (entry in initEntries.vals()) { b.add(entry) };
            b
        };
        var nextId: Nat = config.getNextId();
        var currentLevel: Nat = config.getLogLevel();

        // ============================================
        // INTERNAL HELPERS
        // ============================================

        // Sync internal state back to persistent storage
        func sync() {
            setEntries(Buffer.toArray(buf));
            setNextId(nextId);
        };

        // Trim oldest entries if over maxEntries
        func trimIfNeeded() {
            if (buf.size() > maxEntries) {
                let start = buf.size() - maxEntries;
                let newBuf = Buffer.Buffer<BotLogTypes.LogEntry>(maxEntries);
                var i = start;
                while (i < buf.size()) {
                    newBuf.add(buf.get(i));
                    i += 1;
                };
                buf := newBuf;
            };
        };

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

            true
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
            buf.add(entry);
            trimIfNeeded();
            sync();
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
        /// Returns entries in ascending ID order.
        public func getLogs(filter: BotLogTypes.LogFilter): BotLogTypes.LogResult {
            let minLvl: Nat = switch (filter.minLevel) {
                case (?l) { BotLogTypes.logLevelToNat(l) };
                case null { 0 };
            };
            let limit: Nat = switch (filter.limit) {
                case (?l) { l };
                case null { 100 };
            };

            let matching = Buffer.Buffer<BotLogTypes.LogEntry>(limit);
            var totalMatching: Nat = 0;

            for (entry in buf.vals()) {
                if (matchesFilter(entry, minLvl, filter)) {
                    totalMatching += 1;
                    if (matching.size() < limit) {
                        matching.add(entry);
                    };
                };
            };

            {
                entries = Buffer.toArray(matching);
                totalMatching = totalMatching;
                hasMore = totalMatching > limit;
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
                entryCount = buf.size();
                nextId = nextId;
            }
        };

        /// Set the minimum log level (write-side threshold).
        public func setLogLevel(level: BotLogTypes.LogLevel) {
            currentLevel := BotLogTypes.logLevelToNat(level);
            setLogLevelNat(currentLevel);
        };

        /// Set the maximum number of entries to retain.
        /// Immediately trims if the current count exceeds the new limit.
        public func setMaxEntries(n: Nat) {
            maxEntries := n;
            trimIfNeeded();
            sync();
        };

        /// Clear all log entries. The nextId continues to increase (entry IDs are never reused).
        public func clear() {
            buf := Buffer.Buffer<BotLogTypes.LogEntry>(maxEntries);
            sync();
        };

        /// Get current entry count.
        public func size(): Nat { buf.size() };
    };
};
