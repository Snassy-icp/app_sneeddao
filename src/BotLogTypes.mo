import Principal "mo:base/Principal";

/// Reusable types for the Botlog system.
///
/// Botlog provides comprehensive activity logging for bot canisters.
/// Every action — user-driven API calls and automated chore activity — is recorded
/// with structured data that can be queried and filtered.
///
/// Log levels (ascending verbosity, numeric values for stable storage):
///   0 = Off     (logging disabled)
///   1 = Error   (only errors)
///   2 = Warning (errors + warnings)
///   3 = Info    (normal operations — default)
///   4 = Debug   (detailed diagnostics)
///   5 = Trace   (everything, very verbose)
///
/// Two independent uses of log levels:
///   - Write-side: logLevel setting controls what the bot actually records.
///   - Read-side: query filter minLevel controls what a viewer sees from recorded entries.
module {

    // ============================================
    // LOG LEVELS
    // ============================================

    /// Log level variant (used in public API).
    public type LogLevel = {
        #Off;
        #Error;
        #Warning;
        #Info;
        #Debug;
        #Trace;
    };

    /// Convert a LogLevel variant to its numeric representation.
    public func logLevelToNat(level: LogLevel): Nat {
        switch (level) {
            case (#Off) { 0 };
            case (#Error) { 1 };
            case (#Warning) { 2 };
            case (#Info) { 3 };
            case (#Debug) { 4 };
            case (#Trace) { 5 };
        }
    };

    /// Convert a numeric log level to a variant (defaults to #Off for unknown values).
    public func natToLogLevel(n: Nat): LogLevel {
        switch (n) {
            case (0) { #Off };
            case (1) { #Error };
            case (2) { #Warning };
            case (3) { #Info };
            case (4) { #Debug };
            case (5) { #Trace };
            case (_) { #Off };
        }
    };

    // ============================================
    // LOG ENTRY
    // ============================================

    /// A single log entry.
    public type LogEntry = {
        /// Sequential entry ID (monotonically increasing, never reused).
        id: Nat;
        /// Timestamp in nanoseconds (Time.now()).
        timestamp: Int;
        /// Severity level.
        level: LogLevel;
        /// Source component (e.g. "api", "chore:refresh-stake", "system", "permissions").
        source: Text;
        /// Human-readable message.
        message: Text;
        /// Principal of the caller who triggered this action (null for system/chore activity).
        caller: ?Principal;
        /// Structured key-value pairs for bot-specific data.
        /// Generic enough to display without knowing the keys; parseable when keys are known.
        /// Examples: [("neuronId", "1234"), ("amount_e8s", "100000000"), ("topic", "4")]
        tags: [(Text, Text)];
    };

    // ============================================
    // QUERY TYPES
    // ============================================

    /// Filter for querying log entries.
    public type LogFilter = {
        /// Minimum severity level to include (null = all levels).
        minLevel: ?LogLevel;
        /// Filter by source prefix (e.g. "chore" matches "chore:refresh-stake").
        source: ?Text;
        /// Filter by specific caller principal.
        caller: ?Principal;
        /// Include entries after this timestamp (inclusive).
        fromTime: ?Int;
        /// Include entries before this timestamp (inclusive).
        toTime: ?Int;
        /// Start from this entry ID (for forward pagination, inclusive).
        startId: ?Nat;
        /// Max entries to return (default: 100).
        limit: ?Nat;
    };

    /// Result of a log query.
    public type LogResult = {
        /// Matching entries (ordered by ID ascending).
        entries: [LogEntry];
        /// Total number of entries matching the filter (before pagination).
        totalMatching: Nat;
        /// Whether more entries are available beyond the limit.
        hasMore: Bool;
    };

    // ============================================
    // CONFIGURATION
    // ============================================

    /// Current log configuration (for query responses).
    public type LogConfig = {
        /// Current minimum log level (entries below this are not recorded).
        logLevel: LogLevel;
        /// Maximum number of entries retained (circular buffer).
        maxEntries: Nat;
        /// Current number of entries in the log.
        entryCount: Nat;
        /// Next entry ID that will be assigned.
        nextId: Nat;
    };

    // ============================================
    // ENGINE CONFIGURATION
    // ============================================

    /// Callbacks for the engine to access persistent state.
    /// Follows the same callback pattern as BotChoreEngine's StateAccessor.
    public type EngineConfig = {
        /// Get current log entries from persistent storage.
        getEntries: () -> [LogEntry];
        /// Write log entries back to persistent storage.
        setEntries: ([LogEntry]) -> ();
        /// Get the next entry ID counter.
        getNextId: () -> Nat;
        /// Set the next entry ID counter.
        setNextId: (Nat) -> ();
        /// Get the current log level (as Nat for stable compatibility).
        getLogLevel: () -> Nat;
        /// Set the current log level (as Nat for stable compatibility).
        setLogLevel: (Nat) -> ();
        /// Maximum number of entries to retain.
        maxEntries: Nat;
    };

};
