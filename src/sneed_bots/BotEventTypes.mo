import Principal "mo:base/Principal";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Char "mo:base/Char";
import Iter "mo:base/Iter";
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Text "mo:base/Text";
import Debug "mo:base/Debug";

/// Reusable types for the Inter-Bot Event System.
///
/// The event system enables loosely-coupled communication between bot canisters.
/// A bot emits events at key operational points, and other bots (or itself) can
/// register as listeners and execute configurable reaction actions when events arrive.
///
/// === Event Type ID Ranges ===
/// Same range convention as Botkey permission IDs:
///   - Shared/base events: 0–99  (chore lifecycle, distributions)
///   - ICP Staking Bot:    100–199
///   - Trading Bot:        200–299
///   - (future bots):      300–399, etc.
///
/// All IDs are stored as Nat, never as enums in stable vars.
module {

    // ============================================
    // SHARED BASE EVENT TYPE IDS (0–99)
    // ============================================

    public module BaseEvent {
        public let ChoreStarted: Nat         = 0;
        public let ChoreStopped: Nat         = 1;
        public let ChorePaused: Nat          = 2;
        public let ChoreResumed: Nat         = 3;
        public let ChoreRunCompleted: Nat    = 4;
        public let ChoreRunFailed: Nat       = 5;
        public let ChoreHalted: Nat          = 6;
        public let DistributionExecuted: Nat = 10;
        public let DistributionFailed: Nat   = 11;
    };

    // ============================================
    // CONDITION OPERATORS
    // ============================================

    public module ConditionOp {
        public let Equals: Nat      = 0;
        public let NotEquals: Nat   = 1;
        public let Contains: Nat    = 2;
        public let GreaterThan: Nat = 3;
        public let LessThan: Nat    = 4;
    };

    // ============================================
    // SHARED BASE REACTION ACTION IDS (0–99)
    // ============================================

    public module BaseAction {
        public let StartChore: Nat    = 0;
        public let StopChore: Nat     = 1;
        public let PauseChore: Nat    = 2;
        public let ResumeChore: Nat   = 3;
        public let TriggerChore: Nat  = 4;
        public let StopAllChores: Nat = 5;
    };

    // ============================================
    // WIRE FORMAT (inter-canister)
    // ============================================

    /// An event delivered between bots (or processed internally for self-events).
    public type BotEvent = {
        sourceCanisterId: Principal;
        eventTypeId: Nat;
        timestamp: Int;
        data: [(Text, Text)];
        eventId: Nat;
    };

    // ============================================
    // SOURCE SIDE: LISTENER REGISTRATION
    // ============================================

    /// A registered external listener on the source bot.
    public type EventListenerRegistration = {
        id: Nat;
        listenerCanisterId: Principal;
        eventTypeIds: [Nat];
        registeredAt: Int;
        enabled: Bool;
    };

    /// Request to register as an event listener (sent by the listener bot).
    public type RegisterListenerRequest = {
        eventTypeIds: [Nat];
    };

    // ============================================
    // LISTENER SIDE: SUBSCRIPTIONS & REACTIONS
    // ============================================

    /// A subscription to events from another bot (stored on the listener).
    public type EventSubscription = {
        id: Nat;
        sourceBotCanisterId: Principal;
        eventTypeIds: [Nat];
        registrationId: ?Nat;
        enabled: Bool;
        createdAt: Int;
    };

    /// Input type for creating/updating subscriptions (omits runtime state).
    public type EventSubscriptionInput = {
        sourceBotCanisterId: Principal;
        eventTypeIds: [Nat];
    };

    /// A condition that filters events before a reaction rule fires.
    public type EventCondition = {
        dataKey: Text;
        operator: Nat;
        value: Text;
    };

    /// A reaction rule: when a specific event arrives, execute a specific action.
    public type EventReactionRule = {
        id: Nat;
        name: Text;
        enabled: Bool;
        subscriptionId: Nat;
        eventTypeId: Nat;
        reactionActionId: Nat;
        actionParams: [(Text, Text)];
        conditions: [EventCondition];
        cooldownSeconds: ?Nat;
        lastTriggeredAt: ?Int;
        triggerCount: Nat;
    };

    /// Input type for creating/updating reaction rules (omits runtime state).
    public type EventReactionRuleInput = {
        name: Text;
        enabled: Bool;
        subscriptionId: Nat;
        eventTypeId: Nat;
        reactionActionId: Nat;
        actionParams: [(Text, Text)];
        conditions: [EventCondition];
        cooldownSeconds: ?Nat;
    };

    // ============================================
    // LOGS & QUERIES
    // ============================================

    /// Audit log entry for an executed reaction.
    public type EventReactionLogEntry = {
        id: Nat;
        timestamp: Int;
        eventId: Nat;
        eventTypeId: Nat;
        sourceCanisterId: Principal;
        reactionRuleId: Nat;
        reactionRuleName: Text;
        reactionActionId: Nat;
        success: Bool;
        error: ?Text;
    };

    /// Query filter for the event log (emitted events).
    public type EventLogQuery = {
        eventTypeId: ?Nat;
        fromTime: ?Int;
        toTime: ?Int;
        startId: ?Nat;
        limit: ?Nat;
    };

    /// Result of an event log query.
    public type EventLogResult = {
        entries: [BotEvent];
        totalMatching: Nat;
        hasMore: Bool;
    };

    /// Query filter for the reaction log.
    public type EventReactionLogQuery = {
        reactionRuleId: ?Nat;
        eventTypeId: ?Nat;
        fromTime: ?Int;
        toTime: ?Int;
        startId: ?Nat;
        limit: ?Nat;
    };

    /// Result of a reaction log query.
    public type EventReactionLogResult = {
        entries: [EventReactionLogEntry];
        totalMatching: Nat;
        hasMore: Bool;
    };

    // ============================================
    // ENGINE CONFIGURATION
    // ============================================

    /// Pending event delivery (transient, in-memory only).
    public type PendingEventDelivery = {
        event: BotEvent;
        listenerCanisterId: Principal;
    };

    /// Callback that the engine uses to check Botkey permissions before delivery.
    /// Arguments: (listenerPrincipal, requiredPermissionId) -> Bool.
    public type PermissionChecker = (Principal, Nat) -> Bool;

    /// Callback for the engine to execute a reaction action on the listener side.
    /// Arguments: (reactionActionId, actionParams, event) -> async { #Ok; #Err: Text }.
    /// This is a bot-specific closure provided at engine construction.
    public type ReactionActionExecutor = (Nat, [(Text, Text)], BotEvent) -> async { #Ok; #Err: Text };

    /// Maps event type IDs to the Botkey permission ID required to listen to them.
    /// The engine uses this to check permissions at registration and delivery time.
    public type EventPermissionMap = [(Nat, Nat)];

    /// Callbacks for the engine to access persistent state (source side).
    public type SourceStateAccessor = {
        getListeners: () -> [EventListenerRegistration];
        setListeners: ([EventListenerRegistration]) -> ();
        getNextListenerId: () -> Nat;
        setNextListenerId: (Nat) -> ();
        getEmissionEnabled: () -> Bool;
        setEmissionEnabled: (Bool) -> ();
        getEventLog: () -> [BotEvent];
        setEventLog: ([BotEvent]) -> ();
        getEventLogNextId: () -> Nat;
        setEventLogNextId: (Nat) -> ();
        getEventLogMaxEntries: () -> Nat;
    };

    /// Callbacks for the engine to access persistent state (listener side).
    public type ListenerStateAccessor = {
        getSubscriptions: () -> [EventSubscription];
        setSubscriptions: ([EventSubscription]) -> ();
        getNextSubscriptionId: () -> Nat;
        setNextSubscriptionId: (Nat) -> ();
        getReactions: () -> [EventReactionRule];
        setReactions: ([EventReactionRule]) -> ();
        getNextReactionId: () -> Nat;
        setNextReactionId: (Nat) -> ();
        getReactionLog: () -> [EventReactionLogEntry];
        setReactionLog: ([EventReactionLogEntry]) -> ();
        getReactionLogNextId: () -> Nat;
        setReactionLogNextId: (Nat) -> ();
        getReactionLogMaxEntries: () -> Nat;
    };

    /// Full engine configuration provided by the bot at construction time.
    public type EngineConfig = {
        sourceState: SourceStateAccessor;
        listenerState: ListenerStateAccessor;
        permissionChecker: PermissionChecker;
        eventPermissionMap: EventPermissionMap;
        reactionExecutor: ReactionActionExecutor;
        selfCanisterId: Principal;
        /// Optional log callback: (level, source, message, tags).
        log: ?((Text, Text, Text, [(Text, Text)]) -> ());
    };

    // ============================================
    // ACTION PARAM PARSING HELPERS
    // ============================================

    /// Parse a decimal string to Nat. Returns null on invalid input.
    public func textToNat(t: Text): ?Nat {
        var n: Nat = 0;
        var hasDigit = false;
        for (c in t.chars()) {
            let code = Char.toNat32(c);
            if (code < 48 or code > 57) return null;
            n := n * 10 + Nat32.toNat(code - 48);
            hasDigit := true;
        };
        if (hasDigit) ?n else null
    };

    /// Standard ICRC-1 account for use in reaction params.
    public type Account = { owner: Principal; subaccount: ?Blob };

    func hexCharToNat(c: Char): ?Nat8 {
        let code = Char.toNat32(c);
        if (code >= 48 and code <= 57) { ?Nat8.fromNat(Nat32.toNat(code - 48)) }
        else if (code >= 65 and code <= 70) { ?Nat8.fromNat(Nat32.toNat(code - 55)) }
        else if (code >= 97 and code <= 102) { ?Nat8.fromNat(Nat32.toNat(code - 87)) }
        else { null }
    };

    func hexToBytes(hex: Text): ?[Nat8] {
        let chars = Iter.toArray(hex.chars());
        if (chars.size() % 2 != 0) return null;
        let buf = Array.init<Nat8>(chars.size() / 2, 0);
        var i = 0;
        while (i < chars.size()) {
            switch (hexCharToNat(chars[i]), hexCharToNat(chars[i + 1])) {
                case (?hi, ?lo) { buf[i / 2] := hi * 16 + lo };
                case _ { return null };
            };
            i += 2;
        };
        ?Array.freeze(buf)
    };

    /// Parse an ICRC-1 text account representation (or plain principal) into an Account.
    /// Accepts:
    ///   - "aaaaa-bbbbb-..." → { owner = principal, subaccount = null }
    ///   - "aaaaa-bbbbb-....CCCCSSSS..." → { owner = principal, subaccount = ?blob }
    ///     where CCCC = 4-byte CRC32 checksum (skipped), SSSS = subaccount bytes
    ///     (the hex after '.' is the checksum + subaccount, left-padded to 36 bytes)
    /// Traps if the principal text is invalid (caller should wrap in try/catch in async context).
    public func parseIcrc1Account(text: Text): Account {
        let parts = Iter.toArray(Text.split(text, #char '.'));
        if (parts.size() == 1) {
            { owner = Principal.fromText(parts[0]); subaccount = null }
        } else if (parts.size() >= 2) {
            let owner = Principal.fromText(parts[0]);
            switch (hexToBytes(parts[1])) {
                case (?bytes) {
                    let padded = Array.init<Nat8>(36, 0);
                    let offset: Nat = 36 - bytes.size();
                    for (j in bytes.keys()) { padded[offset + j] := bytes[j] };
                    let sub = Array.tabulate<Nat8>(32, func(k) { padded[4 + k] });
                    var allZero = true;
                    for (b in sub.vals()) { if (b != 0) allZero := false };
                    { owner = owner; subaccount = if (allZero) null else ?Blob.fromArray(sub) }
                };
                case null {
                    Debug.trap("Invalid ICRC-1 account hex: " # parts[1])
                };
            };
        } else {
            Debug.trap("Invalid ICRC-1 account: " # text)
        }
    };

};
