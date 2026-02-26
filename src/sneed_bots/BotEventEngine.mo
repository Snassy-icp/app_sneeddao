import Timer "mo:base/Timer";
import Time "mo:base/Time";
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Principal "mo:base/Principal";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Char "mo:base/Char";
import Int "mo:base/Int";
import Text "mo:base/Text";
import Error "mo:base/Error";
import Iter "mo:base/Iter";

import BotEventTypes "BotEventTypes";

/// Reusable Inter-Bot Event Engine.
///
/// Manages both the source side (event emission, listener management, delivery)
/// and the listener side (subscriptions, reaction rules, action execution).
///
/// Delivery is demand-driven: events are queued and a timer is set only when
/// the first event enters an empty queue. The timer self-chains until the
/// queue drains, then stops.
///
/// Self-events (bot listening to itself) bypass the inter-canister call and
/// are processed through the same delivery timer but with a direct local call
/// to the reaction executor.
///
/// Permissions are checked twice: at listener registration time and before
/// each event delivery.
module {

    /// Actor interface for delivering events to listener bots.
    type ListenerActor = actor {
        onBotEvent: shared (BotEventTypes.BotEvent) -> async { #Ok; #Err: Text };
    };

    /// Actor interface for registering as a listener on a source bot.
    type SourceBotActor = actor {
        registerEventListener: shared (BotEventTypes.RegisterListenerRequest) -> async { #Ok: Nat; #Err: Text };
        unregisterEventListener: shared (Nat) -> async ();
        updateEventListenerTypes: shared (Nat, [Nat]) -> async { #Ok; #Err: Text };
    };

    public class Engine(config: BotEventTypes.EngineConfig) {

        let srcState = config.sourceState;
        let lsnState = config.listenerState;
        let permChecker = config.permissionChecker;
        let permMap = config.eventPermissionMap;
        let reactionExec = config.reactionExecutor;
        let selfPrincipal = config.selfCanisterId;

        // ============================================
        // TRANSIENT STATE
        // ============================================

        var deliveryQueue = Buffer.Buffer<BotEventTypes.PendingEventDelivery>(16);
        var deliveryTimerActive: Bool = false;
        var deliveryTimerId: ?Nat = null;

        // ============================================
        // LOGGING HELPER
        // ============================================

        func emitLog(level: Text, message: Text, tags: [(Text, Text)]) {
            switch (config.log) {
                case (?logFn) { logFn(level, "events", message, tags) };
                case null {};
            };
        };

        // ============================================
        // PERMISSION HELPERS
        // ============================================

        func getRequiredPermission(eventTypeId: Nat): ?Nat {
            for ((evtId, permId) in permMap.vals()) {
                if (evtId == eventTypeId) return ?permId;
            };
            null
        };

        func hasPermissionForEvent(listenerPrincipal: Principal, eventTypeId: Nat): Bool {
            switch (getRequiredPermission(eventTypeId)) {
                case (?permId) { permChecker(listenerPrincipal, permId) };
                case null { false };
            };
        };

        func hasPermissionForAllEvents(listenerPrincipal: Principal, eventTypeIds: [Nat]): Bool {
            for (evtId in eventTypeIds.vals()) {
                if (not hasPermissionForEvent(listenerPrincipal, evtId)) return false;
            };
            true
        };

        // ============================================
        // SOURCE SIDE: EVENT EMISSION
        // ============================================

        /// Queue an event without kicking the delivery timer.
        /// Use from contexts without `system` capability; the timer will be
        /// kicked the next time `emitEvent<system>` runs or `flushDeliveryQueue<system>` is called.
        public func queueEvent(eventTypeId: Nat, data: [(Text, Text)]) {
            if (not srcState.getEmissionEnabled()) return;
            _queueEventInternal(eventTypeId, data);
        };

        /// Emit an event. Adds to the event log, queues deliveries for all
        /// matching listeners, and kicks off the delivery timer if needed.
        public func emitEvent<system>(eventTypeId: Nat, data: [(Text, Text)]) {
            if (not srcState.getEmissionEnabled()) {
                emitLog("Trace", "emitEvent: emission disabled, dropping eventTypeId=" # Nat.toText(eventTypeId), []);
                return;
            };
            _queueEventInternal(eventTypeId, data);
            kickDeliveryTimer<system>();
        };

        /// Kick the delivery timer (call from a `<system>` context after queueEvent calls).
        public func flushDeliveryQueue<system>() {
            kickDeliveryTimer<system>();
        };

        func _queueEventInternal(eventTypeId: Nat, data: [(Text, Text)]) {
            let eventId = srcState.getEventLogNextId();
            srcState.setEventLogNextId(eventId + 1);

            let event: BotEventTypes.BotEvent = {
                sourceCanisterId = selfPrincipal;
                eventTypeId = eventTypeId;
                timestamp = Time.now();
                data = data;
                eventId = eventId;
            };

            addToEventLog(event);

            let listeners = srcState.getListeners();
            var matchedCount: Nat = 0;
            for (reg in listeners.vals()) {
                if (not reg.enabled) { /* skip disabled */ }
                else if (not arrayContainsNat(reg.eventTypeIds, eventTypeId)) { /* skip non-matching */ }
                else {
                    deliveryQueue.add({
                        event = event;
                        listenerCanisterId = reg.listenerCanisterId;
                    });
                    matchedCount += 1;
                };
            };
            emitLog("Trace", "Event queued: typeId=" # Nat.toText(eventTypeId) # " id=" # Nat.toText(eventId) # " listeners=" # Nat.toText(listeners.size()) # " matched=" # Nat.toText(matchedCount) # " queueLen=" # Nat.toText(deliveryQueue.size()), []);
        };

        func addToEventLog(event: BotEventTypes.BotEvent) {
            let maxEntries = srcState.getEventLogMaxEntries();
            let current = srcState.getEventLog();
            if (current.size() >= maxEntries) {
                let trimmed = if (current.size() > 0) {
                    Array.tabulate<BotEventTypes.BotEvent>(
                        current.size() - 1,
                        func(i: Nat): BotEventTypes.BotEvent { current[i + 1] }
                    )
                } else { [] };
                srcState.setEventLog(Array.append(trimmed, [event]));
            } else {
                srcState.setEventLog(Array.append(current, [event]));
            };
        };

        // ============================================
        // SOURCE SIDE: LISTENER MANAGEMENT
        // ============================================

        /// Register an external listener. Called by listener bots.
        /// Checks that the caller has the required Botkey permission for each event.
        public func registerListener(
            callerPrincipal: Principal,
            req: BotEventTypes.RegisterListenerRequest
        ): { #Ok: Nat; #Err: Text } {
            if (req.eventTypeIds.size() == 0) {
                return #Err("No event types specified");
            };

            if (not Principal.equal(callerPrincipal, selfPrincipal) and
                not hasPermissionForAllEvents(callerPrincipal, req.eventTypeIds)) {
                return #Err("Insufficient permissions for requested event types");
            };

            let existing = srcState.getListeners();
            for (reg in existing.vals()) {
                if (Principal.equal(reg.listenerCanisterId, callerPrincipal)) {
                    return #Err("Listener already registered. Unregister first to update.");
                };
            };

            let id = srcState.getNextListenerId();
            srcState.setNextListenerId(id + 1);

            let reg: BotEventTypes.EventListenerRegistration = {
                id = id;
                listenerCanisterId = callerPrincipal;
                eventTypeIds = req.eventTypeIds;
                registeredAt = Time.now();
                enabled = true;
            };

            srcState.setListeners(Array.append(existing, [reg]));
            emitLog("Info", "Listener registered: " # Principal.toText(callerPrincipal), [("listenerId", Nat.toText(id))]);
            #Ok(id)
        };

        /// Unregister a listener by ID.
        public func unregisterListener(callerPrincipal: Principal, listenerId: Nat) {
            let listeners = srcState.getListeners();
            let updated = Array.filter<BotEventTypes.EventListenerRegistration>(
                listeners,
                func(reg: BotEventTypes.EventListenerRegistration): Bool {
                    not (reg.id == listenerId and (
                        Principal.equal(reg.listenerCanisterId, callerPrincipal) or
                        Principal.isController(callerPrincipal)
                    ))
                }
            );
            srcState.setListeners(updated);
        };

        /// Update the event type IDs for an existing listener registration.
        public func updateListenerEventTypes(
            callerPrincipal: Principal,
            listenerId: Nat,
            newEventTypeIds: [Nat]
        ): { #Ok; #Err: Text } {
            if (newEventTypeIds.size() == 0) {
                return #Err("No event types specified");
            };
            if (not Principal.equal(callerPrincipal, selfPrincipal) and
                not hasPermissionForAllEvents(callerPrincipal, newEventTypeIds)) {
                return #Err("Insufficient permissions for requested event types");
            };
            let listeners = srcState.getListeners();
            var found = false;
            let updated = Array.map<BotEventTypes.EventListenerRegistration, BotEventTypes.EventListenerRegistration>(
                listeners,
                func(reg: BotEventTypes.EventListenerRegistration): BotEventTypes.EventListenerRegistration {
                    if (reg.id == listenerId and (
                        Principal.equal(reg.listenerCanisterId, callerPrincipal) or
                        Principal.isController(callerPrincipal)
                    )) {
                        found := true;
                        { id = reg.id; listenerCanisterId = reg.listenerCanisterId; eventTypeIds = newEventTypeIds; registeredAt = reg.registeredAt; enabled = reg.enabled }
                    } else { reg }
                }
            );
            if (not found) return #Err("Listener registration not found");
            srcState.setListeners(updated);
            #Ok
        };

        /// Get all registered listeners.
        public func getListeners(): [BotEventTypes.EventListenerRegistration] {
            srcState.getListeners()
        };

        /// Enable or disable a specific listener registration.
        public func setListenerEnabled(listenerId: Nat, enabled: Bool) {
            let listeners = srcState.getListeners();
            let updated = Array.map<BotEventTypes.EventListenerRegistration, BotEventTypes.EventListenerRegistration>(
                listeners,
                func(reg: BotEventTypes.EventListenerRegistration): BotEventTypes.EventListenerRegistration {
                    if (reg.id == listenerId) {
                        { id = reg.id; listenerCanisterId = reg.listenerCanisterId; eventTypeIds = reg.eventTypeIds; registeredAt = reg.registeredAt; enabled = enabled }
                    } else { reg }
                }
            );
            srcState.setListeners(updated);
        };

        /// Query whether global event emission is enabled.
        public func getEmissionEnabled(): Bool {
            srcState.getEmissionEnabled()
        };

        /// Enable or disable global event emission.
        public func setEmissionEnabled(enabled: Bool) {
            srcState.setEmissionEnabled(enabled);
        };

        /// Query the event emission log (returns the newest matching entries).
        public func queryEventLog(filter: BotEventTypes.EventLogQuery): BotEventTypes.EventLogResult {
            let allEntries = srcState.getEventLog();
            let limit = switch (filter.limit) { case (?l) { l }; case null { 100 } };

            let matched = Buffer.Buffer<BotEventTypes.BotEvent>(limit);
            var totalMatching: Nat = 0;

            var i: Nat = allEntries.size();
            while (i > 0) {
                i -= 1;
                let entry = allEntries[i];
                if (matchesEventLogQuery(entry, filter)) {
                    totalMatching += 1;
                    if (matched.size() < limit) {
                        matched.add(entry);
                    };
                };
            };

            let arr = Buffer.toArray(matched);
            let size = arr.size();
            {
                entries = Array.tabulate<BotEventTypes.BotEvent>(size, func(j: Nat): BotEventTypes.BotEvent { arr[size - 1 - j] });
                totalMatching = totalMatching;
                hasMore = totalMatching > limit;
            }
        };

        func matchesEventLogQuery(entry: BotEventTypes.BotEvent, filter: BotEventTypes.EventLogQuery): Bool {
            switch (filter.eventTypeId) {
                case (?id) { if (entry.eventTypeId != id) return false };
                case null {};
            };
            switch (filter.fromTime) {
                case (?t) { if (entry.timestamp < t) return false };
                case null {};
            };
            switch (filter.toTime) {
                case (?t) { if (entry.timestamp > t) return false };
                case null {};
            };
            switch (filter.startId) {
                case (?id) { if (entry.eventId < id) return false };
                case null {};
            };
            true
        };

        // ============================================
        // SOURCE SIDE: DELIVERY MECHANISM
        // ============================================

        func kickDeliveryTimer<system>() {
            if (deliveryTimerActive) return;
            if (deliveryQueue.size() == 0) return;

            deliveryTimerActive := true;
            let tid = Timer.setTimer<system>(#seconds 2, func(): async () {
                try {
                    await processDeliveryBatch();
                } catch (e) {
                    emitLog("Error", "Delivery batch trapped: " # Error.message(e), []);
                };
                deliveryTimerActive := false;
                deliveryTimerId := null;
                if (deliveryQueue.size() > 0) {
                    kickDeliveryTimer<system>();
                };
            });
            deliveryTimerId := ?tid;
        };

        func processDeliveryBatch(): async () {
            let batchSize = Nat.min(deliveryQueue.size(), 10);
            if (batchSize == 0) return;
            emitLog("Trace", "Delivery batch: processing " # Nat.toText(batchSize) # " of " # Nat.toText(deliveryQueue.size()) # " queued", []);

            let batch = Buffer.Buffer<BotEventTypes.PendingEventDelivery>(batchSize);
            var i: Nat = 0;
            while (i < batchSize and deliveryQueue.size() > 0) {
                let item = deliveryQueue.get(0);
                deliveryQueue.filterEntries(func(idx: Nat, _: BotEventTypes.PendingEventDelivery): Bool { idx != 0 });
                batch.add(item);
                i += 1;
            };

            for (delivery in batch.vals()) {
                let isSelf = Principal.equal(delivery.listenerCanisterId, selfPrincipal);
                emitLog("Trace", "Delivering eventId=" # Nat.toText(delivery.event.eventId) # " typeId=" # Nat.toText(delivery.event.eventTypeId) # " to " # (if isSelf "self" else Principal.toText(delivery.listenerCanisterId)), []);
                if (isSelf) {
                    try {
                        await handleIncomingEventInternal(delivery.event);
                    } catch (e) {
                        emitLog("Error", "Self-delivery failed: " # Error.message(e),
                            [("eventId", Nat.toText(delivery.event.eventId)),
                             ("eventTypeId", Nat.toText(delivery.event.eventTypeId))]);
                    };
                } else if (not hasPermissionForEvent(delivery.listenerCanisterId, delivery.event.eventTypeId)) {
                    emitLog("Warning", "Skipping delivery: permission revoked for " # Principal.toText(delivery.listenerCanisterId),
                        [("eventTypeId", Nat.toText(delivery.event.eventTypeId))]);
                } else {
                    try {
                        let listener: ListenerActor = actor(Principal.toText(delivery.listenerCanisterId));
                        let result = await listener.onBotEvent(delivery.event);
                        switch (result) {
                            case (#Ok) {};
                            case (#Err(msg)) {
                                emitLog("Warning", "Listener rejected event: " # msg,
                                    [("listener", Principal.toText(delivery.listenerCanisterId)),
                                     ("eventId", Nat.toText(delivery.event.eventId))]);
                            };
                        };
                    } catch (e) {
                        emitLog("Error", "Delivery failed: " # Error.message(e),
                            [("listener", Principal.toText(delivery.listenerCanisterId)),
                             ("eventId", Nat.toText(delivery.event.eventId))]);
                    };
                };
            };
        };

        // ============================================
        // LISTENER SIDE: SUBSCRIPTION MANAGEMENT
        // ============================================

        /// Add a subscription to events from another bot and register with it.
        public func addSubscription(input: BotEventTypes.EventSubscriptionInput): async { #Ok: Nat; #Err: Text } {
            let subId = lsnState.getNextSubscriptionId();
            lsnState.setNextSubscriptionId(subId + 1);

            var registrationId: ?Nat = null;

            if (not Principal.equal(input.sourceBotCanisterId, selfPrincipal)) {
                try {
                    let sourceBot: SourceBotActor = actor(Principal.toText(input.sourceBotCanisterId));
                    let result = await sourceBot.registerEventListener({
                        eventTypeIds = input.eventTypeIds;
                    });
                    switch (result) {
                        case (#Ok(regId)) { registrationId := ?regId };
                        case (#Err(msg)) { return #Err("Source bot rejected registration: " # msg) };
                    };
                } catch (e) {
                    return #Err("Failed to register with source bot: " # Error.message(e));
                };
            } else {
                let selfRegResult = registerListener(selfPrincipal, { eventTypeIds = input.eventTypeIds });
                switch (selfRegResult) {
                    case (#Ok(regId)) { registrationId := ?regId };
                    case (#Err(msg)) { return #Err("Self-registration failed: " # msg) };
                };
            };

            let sub: BotEventTypes.EventSubscription = {
                id = subId;
                sourceBotCanisterId = input.sourceBotCanisterId;
                eventTypeIds = input.eventTypeIds;
                registrationId = registrationId;
                enabled = true;
                createdAt = Time.now();
            };

            lsnState.setSubscriptions(Array.append(lsnState.getSubscriptions(), [sub]));
            emitLog("Info", "Subscription added to " # Principal.toText(input.sourceBotCanisterId),
                [("subscriptionId", Nat.toText(subId))]);
            #Ok(subId)
        };

        /// Remove a subscription and unregister from the source bot.
        public func removeSubscription(subId: Nat): async () {
            let subs = lsnState.getSubscriptions();
            var targetSub: ?BotEventTypes.EventSubscription = null;

            for (sub in subs.vals()) {
                if (sub.id == subId) { targetSub := ?sub };
            };

            switch (targetSub) {
                case (?sub) {
                    switch (sub.registrationId) {
                        case (?regId) {
                            if (Principal.equal(sub.sourceBotCanisterId, selfPrincipal)) {
                                unregisterListener(selfPrincipal, regId);
                            } else {
                                try {
                                    let sourceBot: SourceBotActor = actor(Principal.toText(sub.sourceBotCanisterId));
                                    await sourceBot.unregisterEventListener(regId);
                                } catch (_) {};
                            };
                        };
                        case null {};
                    };

                    let reactions = lsnState.getReactions();
                    let updatedReactions = Array.filter<BotEventTypes.EventReactionRule>(
                        reactions,
                        func(r: BotEventTypes.EventReactionRule): Bool { r.subscriptionId != subId }
                    );
                    lsnState.setReactions(updatedReactions);
                };
                case null {};
            };

            let updated = Array.filter<BotEventTypes.EventSubscription>(
                subs,
                func(s: BotEventTypes.EventSubscription): Bool { s.id != subId }
            );
            lsnState.setSubscriptions(updated);
        };

        /// Update the event type IDs for an existing subscription.
        /// Re-registers with the source bot using the new event types.
        public func updateSubscription(subId: Nat, newEventTypeIds: [Nat]): async { #Ok; #Err: Text } {
            if (newEventTypeIds.size() == 0) {
                return #Err("No event types specified");
            };

            let subs = lsnState.getSubscriptions();
            var targetSub: ?BotEventTypes.EventSubscription = null;
            for (sub in subs.vals()) {
                if (sub.id == subId) { targetSub := ?sub };
            };

            switch (targetSub) {
                case (?sub) {
                    switch (sub.registrationId) {
                        case (?regId) {
                            if (Principal.equal(sub.sourceBotCanisterId, selfPrincipal)) {
                                let result = updateListenerEventTypes(selfPrincipal, regId, newEventTypeIds);
                                switch (result) {
                                    case (#Err(msg)) { return #Err("Self-update failed: " # msg) };
                                    case (#Ok) {};
                                };
                            } else {
                                try {
                                    let sourceBot: SourceBotActor = actor(Principal.toText(sub.sourceBotCanisterId));
                                    let result = await sourceBot.updateEventListenerTypes(regId, newEventTypeIds);
                                    switch (result) {
                                        case (#Err(msg)) { return #Err("Source bot rejected update: " # msg) };
                                        case (#Ok) {};
                                    };
                                } catch (e) {
                                    return #Err("Failed to update on source bot: " # Error.message(e));
                                };
                            };
                        };
                        case null {};
                    };

                    let updated = Array.map<BotEventTypes.EventSubscription, BotEventTypes.EventSubscription>(
                        subs,
                        func(s: BotEventTypes.EventSubscription): BotEventTypes.EventSubscription {
                            if (s.id == subId) {
                                { id = s.id; sourceBotCanisterId = s.sourceBotCanisterId; eventTypeIds = newEventTypeIds; registrationId = s.registrationId; enabled = s.enabled; createdAt = s.createdAt }
                            } else { s }
                        }
                    );
                    lsnState.setSubscriptions(updated);
                    emitLog("Info", "Subscription updated: " # Nat.toText(subId), []);
                    #Ok
                };
                case null { #Err("Subscription not found") };
            }
        };

        /// Get all subscriptions.
        public func getSubscriptions(): [BotEventTypes.EventSubscription] {
            lsnState.getSubscriptions()
        };

        // ============================================
        // LISTENER SIDE: REACTION RULE MANAGEMENT
        // ============================================

        /// Add a reaction rule.
        public func addReaction(input: BotEventTypes.EventReactionRuleInput): { #Ok: Nat; #Err: Text } {
            let subs = lsnState.getSubscriptions();
            var found = false;
            for (sub in subs.vals()) {
                if (sub.id == input.subscriptionId) { found := true };
            };
            if (not found) {
                return #Err("Subscription " # Nat.toText(input.subscriptionId) # " not found");
            };

            let id = lsnState.getNextReactionId();
            lsnState.setNextReactionId(id + 1);

            let rule: BotEventTypes.EventReactionRule = {
                id = id;
                name = input.name;
                enabled = input.enabled;
                subscriptionId = input.subscriptionId;
                eventTypeId = input.eventTypeId;
                reactionActionId = input.reactionActionId;
                actionParams = input.actionParams;
                conditions = input.conditions;
                cooldownSeconds = input.cooldownSeconds;
                lastTriggeredAt = null;
                triggerCount = 0;
            };

            lsnState.setReactions(Array.append(lsnState.getReactions(), [rule]));
            #Ok(id)
        };

        /// Update a reaction rule (preserves runtime state).
        public func updateReaction(ruleId: Nat, input: BotEventTypes.EventReactionRuleInput): { #Ok; #Err: Text } {
            let reactions = lsnState.getReactions();
            var found = false;

            let updated = Array.map<BotEventTypes.EventReactionRule, BotEventTypes.EventReactionRule>(
                reactions,
                func(r: BotEventTypes.EventReactionRule): BotEventTypes.EventReactionRule {
                    if (r.id == ruleId) {
                        found := true;
                        {
                            id = r.id;
                            name = input.name;
                            enabled = input.enabled;
                            subscriptionId = input.subscriptionId;
                            eventTypeId = input.eventTypeId;
                            reactionActionId = input.reactionActionId;
                            actionParams = input.actionParams;
                            conditions = input.conditions;
                            cooldownSeconds = input.cooldownSeconds;
                            lastTriggeredAt = r.lastTriggeredAt;
                            triggerCount = r.triggerCount;
                        }
                    } else { r }
                }
            );

            if (not found) { return #Err("Reaction rule not found") };
            lsnState.setReactions(updated);
            #Ok
        };

        /// Remove a reaction rule.
        public func removeReaction(ruleId: Nat) {
            let reactions = lsnState.getReactions();
            let updated = Array.filter<BotEventTypes.EventReactionRule>(
                reactions,
                func(r: BotEventTypes.EventReactionRule): Bool { r.id != ruleId }
            );
            lsnState.setReactions(updated);
        };

        /// Get all reaction rules.
        public func getReactions(): [BotEventTypes.EventReactionRule] {
            lsnState.getReactions()
        };

        /// Query the reaction log (returns the newest matching entries).
        public func queryReactionLog(filter: BotEventTypes.EventReactionLogQuery): BotEventTypes.EventReactionLogResult {
            let allEntries = lsnState.getReactionLog();
            let limit = switch (filter.limit) { case (?l) { l }; case null { 100 } };

            let matched = Buffer.Buffer<BotEventTypes.EventReactionLogEntry>(limit);
            var totalMatching: Nat = 0;

            var i: Nat = allEntries.size();
            while (i > 0) {
                i -= 1;
                let entry = allEntries[i];
                if (matchesReactionLogQuery(entry, filter)) {
                    totalMatching += 1;
                    if (matched.size() < limit) {
                        matched.add(entry);
                    };
                };
            };

            let arr = Buffer.toArray(matched);
            let size = arr.size();
            {
                entries = Array.tabulate<BotEventTypes.EventReactionLogEntry>(size, func(j: Nat): BotEventTypes.EventReactionLogEntry { arr[size - 1 - j] });
                totalMatching = totalMatching;
                hasMore = totalMatching > limit;
            }
        };

        func matchesReactionLogQuery(entry: BotEventTypes.EventReactionLogEntry, filter: BotEventTypes.EventReactionLogQuery): Bool {
            switch (filter.reactionRuleId) {
                case (?id) { if (entry.reactionRuleId != id) return false };
                case null {};
            };
            switch (filter.eventTypeId) {
                case (?id) { if (entry.eventTypeId != id) return false };
                case null {};
            };
            switch (filter.fromTime) {
                case (?t) { if (entry.timestamp < t) return false };
                case null {};
            };
            switch (filter.toTime) {
                case (?t) { if (entry.timestamp > t) return false };
                case null {};
            };
            switch (filter.startId) {
                case (?id) { if (entry.id < id) return false };
                case null {};
            };
            true
        };

        // ============================================
        // LISTENER SIDE: INCOMING EVENT PROCESSING
        // ============================================

        /// Handle an incoming event from a source bot (public API entry point).
        /// Validates the caller, finds matching reactions, evaluates conditions,
        /// checks cooldowns, and executes actions.
        public func handleIncomingEvent(callerPrincipal: Principal, event: BotEventTypes.BotEvent): async { #Ok; #Err: Text } {
            if (not Principal.equal(callerPrincipal, event.sourceCanisterId)) {
                return #Err("Caller does not match event source");
            };

            let subs = lsnState.getSubscriptions();
            var validSub = false;
            for (sub in subs.vals()) {
                if (sub.enabled and
                    Principal.equal(sub.sourceBotCanisterId, event.sourceCanisterId) and
                    arrayContainsNat(sub.eventTypeIds, event.eventTypeId)) {
                    validSub := true;
                };
            };

            if (not validSub) {
                return #Err("No active subscription for this event source/type");
            };

            await handleIncomingEventInternal(event);
            #Ok
        };

        /// Internal event processing (used by both external and self-event paths).
        func handleIncomingEventInternal(event: BotEventTypes.BotEvent): async () {
            let reactions = lsnState.getReactions();
            let now = Time.now();
            emitLog("Trace", "handleIncomingEvent: eventTypeId=" # Nat.toText(event.eventTypeId) # " eventId=" # Nat.toText(event.eventId) # " rules=" # Nat.toText(reactions.size()), []);

            for (rule in reactions.vals()) {
                if (not rule.enabled) {
                    emitLog("Trace", "Rule " # Nat.toText(rule.id) # " '" # rule.name # "': skip (disabled)", []);
                }
                else if (rule.eventTypeId != event.eventTypeId) {
                    emitLog("Trace", "Rule " # Nat.toText(rule.id) # " '" # rule.name # "': skip (eventType " # Nat.toText(rule.eventTypeId) # " != " # Nat.toText(event.eventTypeId) # ")", []);
                }
                else if (not subscriptionMatchesSource(rule.subscriptionId, event.sourceCanisterId)) {
                    emitLog("Trace", "Rule " # Nat.toText(rule.id) # " '" # rule.name # "': skip (subscription " # Nat.toText(rule.subscriptionId) # " does not match source)", []);
                }
                else if (not evaluateConditions(rule.conditions, event.data)) {
                    emitLog("Trace", "Rule " # Nat.toText(rule.id) # " '" # rule.name # "': skip (conditions not met)", []);
                }
                else if (isOnCooldown(rule, now)) {
                    emitLog("Trace", "Rule " # Nat.toText(rule.id) # " '" # rule.name # "': skip (cooldown)", []);
                }
                else {
                    emitLog("Info", "Rule " # Nat.toText(rule.id) # " '" # rule.name # "' MATCHED eventId=" # Nat.toText(event.eventId) # " — executing actionId=" # Nat.toText(rule.reactionActionId), []);
                    let success = await executeReaction(rule, event);
                    updateReactionRuntimeState(rule.id, now, success);
                    logReaction(rule, event, success);
                };
            };
        };

        func subscriptionMatchesSource(subId: Nat, sourceCanisterId: Principal): Bool {
            let subs = lsnState.getSubscriptions();
            for (sub in subs.vals()) {
                if (sub.id == subId and sub.enabled and
                    Principal.equal(sub.sourceBotCanisterId, sourceCanisterId)) {
                    return true;
                };
            };
            false
        };

        // ============================================
        // CONDITION EVALUATION
        // ============================================

        func evaluateConditions(conditions: [BotEventTypes.EventCondition], data: [(Text, Text)]): Bool {
            for (cond in conditions.vals()) {
                let dataValue = getDataValue(data, cond.dataKey);
                switch (dataValue) {
                    case (?val) {
                        if (not evaluateCondition(cond.operator, val, cond.value)) return false;
                    };
                    case null { return false };
                };
            };
            true
        };

        func getDataValue(data: [(Text, Text)], key: Text): ?Text {
            for ((k, v) in data.vals()) {
                if (k == key) return ?v;
            };
            null
        };

        func evaluateCondition(operator: Nat, actual: Text, expected: Text): Bool {
            if (operator == BotEventTypes.ConditionOp.Equals) {
                actual == expected
            } else if (operator == BotEventTypes.ConditionOp.NotEquals) {
                actual != expected
            } else if (operator == BotEventTypes.ConditionOp.Contains) {
                Text.contains(actual, #text expected)
            } else if (operator == BotEventTypes.ConditionOp.GreaterThan) {
                compareNumeric(actual, expected, func(a: Int, b: Int): Bool { a > b })
            } else if (operator == BotEventTypes.ConditionOp.LessThan) {
                compareNumeric(actual, expected, func(a: Int, b: Int): Bool { a < b })
            } else {
                false
            }
        };

        func compareNumeric(a: Text, b: Text, cmp: (Int, Int) -> Bool): Bool {
            switch (textToNat(a), textToNat(b)) {
                case (?na, ?nb) { cmp(na, nb) };
                case _ { false };
            }
        };

        func textToNat(t: Text): ?Int {
            var n: Nat = 0;
            var found = false;
            for (c in t.chars()) {
                let code = Nat32.toNat(Char.toNat32(c));
                if (code >= 48 and code <= 57) {
                    n := n * 10 + (code - 48);
                    found := true;
                } else {
                    return null;
                };
            };
            if (found) { ?n } else { null }
        };

        // ============================================
        // COOLDOWN CHECK
        // ============================================

        func isOnCooldown(rule: BotEventTypes.EventReactionRule, now: Int): Bool {
            switch (rule.cooldownSeconds, rule.lastTriggeredAt) {
                case (?cooldown, ?lastTriggered) {
                    let cooldownNanos = cooldown * 1_000_000_000;
                    now < lastTriggered + cooldownNanos
                };
                case _ { false };
            }
        };

        // ============================================
        // REACTION EXECUTION
        // ============================================

        func executeReaction(rule: BotEventTypes.EventReactionRule, event: BotEventTypes.BotEvent): async Bool {
            try {
                let result = await reactionExec(rule.reactionActionId, rule.actionParams, event);
                switch (result) {
                    case (#Ok) { true };
                    case (#Err(msg)) {
                        emitLog("Warning", "Reaction action failed: " # msg,
                            [("ruleId", Nat.toText(rule.id)), ("actionId", Nat.toText(rule.reactionActionId))]);
                        false
                    };
                }
            } catch (e) {
                emitLog("Error", "Reaction execution error: " # Error.message(e),
                    [("ruleId", Nat.toText(rule.id)), ("actionId", Nat.toText(rule.reactionActionId))]);
                false
            }
        };

        func updateReactionRuntimeState(ruleId: Nat, now: Int, _success: Bool) {
            let reactions = lsnState.getReactions();
            let updated = Array.map<BotEventTypes.EventReactionRule, BotEventTypes.EventReactionRule>(
                reactions,
                func(r: BotEventTypes.EventReactionRule): BotEventTypes.EventReactionRule {
                    if (r.id == ruleId) {
                        {
                            id = r.id;
                            name = r.name;
                            enabled = r.enabled;
                            subscriptionId = r.subscriptionId;
                            eventTypeId = r.eventTypeId;
                            reactionActionId = r.reactionActionId;
                            actionParams = r.actionParams;
                            conditions = r.conditions;
                            cooldownSeconds = r.cooldownSeconds;
                            lastTriggeredAt = ?now;
                            triggerCount = r.triggerCount + 1;
                        }
                    } else { r }
                }
            );
            lsnState.setReactions(updated);
        };

        func logReaction(rule: BotEventTypes.EventReactionRule, event: BotEventTypes.BotEvent, success: Bool) {
            let logId = lsnState.getReactionLogNextId();
            lsnState.setReactionLogNextId(logId + 1);

            let entry: BotEventTypes.EventReactionLogEntry = {
                id = logId;
                timestamp = Time.now();
                eventId = event.eventId;
                eventTypeId = event.eventTypeId;
                sourceCanisterId = event.sourceCanisterId;
                reactionRuleId = rule.id;
                reactionRuleName = rule.name;
                reactionActionId = rule.reactionActionId;
                success = success;
                error = if (success) { null } else { ?"See bot log for details" };
            };

            let maxEntries = lsnState.getReactionLogMaxEntries();
            let current = lsnState.getReactionLog();
            if (current.size() >= maxEntries) {
                let trimmed = if (current.size() > 0) {
                    Array.tabulate<BotEventTypes.EventReactionLogEntry>(
                        current.size() - 1,
                        func(i: Nat): BotEventTypes.EventReactionLogEntry { current[i + 1] }
                    )
                } else { [] };
                lsnState.setReactionLog(Array.append(trimmed, [entry]));
            } else {
                lsnState.setReactionLog(Array.append(current, [entry]));
            };
        };

        // ============================================
        // UTILITY
        // ============================================

        func arrayContainsNat(arr: [Nat], val: Nat): Bool {
            for (item in arr.vals()) {
                if (item == val) return true;
            };
            false
        };
    };

};
