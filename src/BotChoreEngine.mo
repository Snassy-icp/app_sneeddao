import Timer "mo:base/Timer";
import Time "mo:base/Time";
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Bool "mo:base/Bool";
import Error "mo:base/Error";
import Debug "mo:base/Debug";

import BotChoreTypes "BotChoreTypes";

/// Reusable Bot Chore engine using a polling pattern.
///
/// Manages the three-level timer hierarchy (Scheduler → Conductor → Task),
/// persists state through a StateAccessor for upgrade resilience, and provides
/// admin controls including emergency stop and task timeout.
///
/// Key design: The Conductor polls for Task completion rather than being
/// event-notified. This makes the system trap-resilient — if a Task traps,
/// it simply stops rescheduling, and the Conductor detects the stale task
/// on its next poll (or via task timeout).
///
/// Tasks are started by the Conductor calling engine.setPendingTask()
/// before returning. The engine picks up the pending task after the
/// conductor callback returns and starts it independently.
///
/// Usage in a bot canister:
/// ```
///   transient let choreEngine = BotChoreEngine.Engine({
///       getConfigs = func() { choreConfigs };
///       setConfigs = func(c) { choreConfigs := c };
///       getStates = func() { choreStates };
///       setStates = func(s) { choreStates := s };
///   });
///   choreEngine.registerChore(myChoreDefinition);
///   choreEngine.resumeTimers<system>();
/// ```
module {

    public class Engine(stateAccessor: BotChoreTypes.StateAccessor) {

        // ============================================
        // INTERNAL STATE (transient)
        // ============================================

        /// Registered chore type definitions, keyed by typeId.
        /// Re-registered on each canister start (conduct closures don't survive upgrades).
        var definitions = Buffer.Buffer<BotChoreTypes.ChoreDefinition>(4);

        /// Pending tasks set by conductor callbacks, keyed by choreId (instanceId).
        /// The conductor calls setPendingTask() before returning, and the engine
        /// picks up the pending task after the await and starts it.
        /// Array of (choreId, taskId, taskFn) tuples.
        var pendingTasks: [(Text, Text, () -> async BotChoreTypes.TaskAction)] = [];

        // ============================================
        // TYPE REGISTRATION
        // ============================================

        /// Register a chore type definition. Call this on every canister start
        /// (the conduct function is a closure that doesn't survive upgrades).
        /// This only registers the type template — use createInstance() to create
        /// runnable instances, or use registerChore() for backward compatibility
        /// (which auto-creates a single instance with instanceId = typeId).
        public func registerChoreType(def: BotChoreTypes.ChoreDefinition) {
            // Replace existing definition if re-registered (happens on every canister start)
            var replaced = false;
            let size = definitions.size();
            var i = 0;
            while (i < size) {
                if (definitions.get(i).id == def.id) {
                    definitions.put(i, def);
                    replaced := true;
                };
                i += 1;
            };
            if (not replaced) {
                definitions.add(def);
            };
        };

        /// Backward-compatible registration: registers a chore type AND auto-creates
        /// a single instance with instanceId = typeId and label = name.
        /// This is the simple path for bots that only need one instance per type.
        public func registerChore(def: BotChoreTypes.ChoreDefinition) {
            registerChoreType(def);
            // Auto-create a default instance if one doesn't exist for this type
            ignore createInstance(def.id, def.id, def.name);
        };

        // ============================================
        // INSTANCE MANAGEMENT
        // ============================================

        /// Create a new chore instance of the given type.
        /// Returns true if created, false if instanceId already exists or typeId unknown.
        public func createInstance(typeId: Text, instanceId: Text, instanceLabel: Text): Bool {
            // Verify the type exists
            switch (findDefinitionByTypeId(typeId)) {
                case null { return false };
                case (_) {};
            };

            // Check if instance already exists
            let instances = stateAccessor.getInstances();
            switch (Array.find<(Text, BotChoreTypes.ChoreInstanceInfo)>(
                instances, func((id, _)) { id == instanceId }
            )) {
                case (?_) { return false }; // Already exists
                case null {};
            };

            // Create instance registry entry
            let info: BotChoreTypes.ChoreInstanceInfo = { typeId = typeId; instanceLabel = instanceLabel };
            stateAccessor.setInstances(Array.append(instances, [(instanceId, info)]));

            // Initialize config if not present
            let configs = stateAccessor.getConfigs();
            let configExists = Array.find<(Text, BotChoreTypes.ChoreConfig)>(
                configs, func((id, _)) { id == instanceId }
            );
            if (configExists == null) {
                switch (findDefinitionByTypeId(typeId)) {
                    case (?def) {
                        let newConfig: BotChoreTypes.ChoreConfig = {
                            enabled = false;
                            paused = false;
                            intervalSeconds = def.defaultIntervalSeconds;
                            maxIntervalSeconds = def.defaultMaxIntervalSeconds;
                            taskTimeoutSeconds = def.defaultTaskTimeoutSeconds;
                        };
                        stateAccessor.setConfigs(Array.append(configs, [(instanceId, newConfig)]));
                    };
                    case null {};
                };
            };

            // Initialize runtime state if not present
            let states = stateAccessor.getStates();
            let stateExists = Array.find<(Text, BotChoreTypes.ChoreRuntimeState)>(
                states, func((id, _)) { id == instanceId }
            );
            if (stateExists == null) {
                stateAccessor.setStates(Array.append(states, [(instanceId, BotChoreTypes.emptyRuntimeState())]));
            };

            true
        };

        /// Delete a chore instance. Must be stopped first (enabled=false).
        /// Returns true if deleted, false if not found or still running.
        public func deleteInstance(instanceId: Text): Bool {
            // Look up instance
            let instances = stateAccessor.getInstances();
            let instance = Array.find<(Text, BotChoreTypes.ChoreInstanceInfo)>(
                instances, func((id, _)) { id == instanceId }
            );
            switch (instance) {
                case null { return false }; // Not found
                case (?_) {};
            };

            // Ensure chore is stopped
            let config = getConfigOrDefault(instanceId);
            if (config.enabled) return false; // Must stop first

            // Remove from instances
            stateAccessor.setInstances(
                Array.filter<(Text, BotChoreTypes.ChoreInstanceInfo)>(
                    instances, func((id, _)) { id != instanceId }
                )
            );

            // Remove config
            stateAccessor.setConfigs(
                Array.filter<(Text, BotChoreTypes.ChoreConfig)>(
                    stateAccessor.getConfigs(), func((id, _)) { id != instanceId }
                )
            );

            // Remove runtime state
            stateAccessor.setStates(
                Array.filter<(Text, BotChoreTypes.ChoreRuntimeState)>(
                    stateAccessor.getStates(), func((id, _)) { id != instanceId }
                )
            );

            true
        };

        /// Rename a chore instance's label.
        /// Returns true if renamed, false if not found.
        public func renameInstance(instanceId: Text, newLabel: Text): Bool {
            let instances = stateAccessor.getInstances();
            var found = false;
            let updated = Array.map<(Text, BotChoreTypes.ChoreInstanceInfo), (Text, BotChoreTypes.ChoreInstanceInfo)>(
                instances,
                func((id, info)) {
                    if (id == instanceId) {
                        found := true;
                        (id, { info with instanceLabel = newLabel })
                    } else {
                        (id, info)
                    }
                }
            );
            if (found) {
                stateAccessor.setInstances(updated);
            };
            found
        };

        /// List all instances, optionally filtered by typeId.
        public func listInstances(typeIdFilter: ?Text): [(Text, BotChoreTypes.ChoreInstanceInfo)] {
            let instances = stateAccessor.getInstances();
            switch (typeIdFilter) {
                case null { instances };
                case (?tid) {
                    Array.filter<(Text, BotChoreTypes.ChoreInstanceInfo)>(
                        instances, func((_, info)) { info.typeId == tid }
                    )
                };
            }
        };

        /// Get the instance info for a specific instance.
        public func getInstance(instanceId: Text): ?BotChoreTypes.ChoreInstanceInfo {
            let instances = stateAccessor.getInstances();
            for ((id, info) in instances.vals()) {
                if (id == instanceId) return ?info;
            };
            null
        };

        // ============================================
        // TASK HANDOFF (called by conductor callbacks)
        // ============================================

        /// Called by the conductor to request starting a task.
        /// The conductor calls this before returning #ContinueIn(N).
        /// The engine picks up the pending task after the conductor callback
        /// returns and starts the task loop independently.
        ///
        /// Safe for concurrent chores: keyed by choreId.
        public func setPendingTask(choreId: Text, taskId: Text, taskFn: () -> async BotChoreTypes.TaskAction) {
            // Remove any existing pending task for this chore
            pendingTasks := Array.filter<(Text, Text, () -> async BotChoreTypes.TaskAction)>(
                pendingTasks,
                func((cid, _tid, _fn)) { cid != choreId }
            );
            pendingTasks := Array.append(pendingTasks, [(choreId, taskId, taskFn)]);
        };

        /// Consume a pending task for a chore (internal use).
        func consumePendingTask(choreId: Text): ?(Text, () -> async BotChoreTypes.TaskAction) {
            var result: ?(Text, () -> async BotChoreTypes.TaskAction) = null;
            for ((cid, tid, fn) in pendingTasks.vals()) {
                if (cid == choreId) { result := ?(tid, fn) };
            };
            pendingTasks := Array.filter<(Text, Text, () -> async BotChoreTypes.TaskAction)>(
                pendingTasks,
                func((cid, _tid, _fn)) { cid != choreId }
            );
            result
        };

        // ============================================
        // TIMER LIFECYCLE
        // ============================================

        /// Start or resume all timers. Call on first deploy and after every upgrade.
        /// - Clears stale timer IDs (old timers don't survive upgrades).
        /// - Restarts schedulers for enabled chores.
        /// - Restarts conductors that were active when the canister was stopped.
        public func resumeTimers<system>() {
            let instances = stateAccessor.getInstances();
            for ((choreId, _info) in instances.vals()) {

                // Clear stale timer IDs from previous canister lifetime
                updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                    {
                        s with
                        schedulerTimerId = null;
                        conductorTimerId = null;
                        taskTimerId = null;
                        // Clear task state — closures are lost after upgrade
                        taskActive = false;
                        currentTaskId = null;
                    }
                });

                let config = getConfigOrDefault(choreId);

                if (config.enabled and not config.paused) {
                    let state = getStateOrDefault(choreId);

                    // Resume conductor if it was active
                    if (state.conductorActive) {
                        // Restart conductor from the beginning (closures lost after upgrade)
                        updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                            {
                                s with
                                conductorInvocationCount = 0;
                                conductorStartedAt = ?Time.now();
                                lastCompletedTaskId = null;
                                lastTaskSucceeded = null;
                                lastTaskError = null;
                            }
                        });
                        scheduleConductorTick<system>(choreId, 0);
                    };

                    // Start scheduler
                    startScheduler<system>(choreId);
                };
            };
        };

        /// Cancel all active timers. Use in emergencies or during controlled shutdown.
        public func cancelAllTimers() {
            let states = stateAccessor.getStates();
            for ((choreId, _state) in states.vals()) {
                cancelChoreTimers(choreId);
            };
        };

        // ============================================
        // ADMIN CONTROL
        // ============================================

        /// Start a chore: run it immediately AND schedule the next run.
        /// Transitions from Stopped → Running.
        /// If already running (not paused), this is a no-op.
        /// If paused, this unpauses and triggers immediately.
        public func start<system>(choreId: Text) {
            let config = getConfigOrDefault(choreId);
            
            // Set enabled=true, paused=false
            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with enabled = true; paused = false }
            });

            // Clear any stop request
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with stopRequested = false }
            });

            // Trigger conductor immediately (if not already running)
            let state = getStateOrDefault(choreId);
            if (not state.conductorActive) {
                updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                    {
                        s with
                        conductorActive = true;
                        conductorStartedAt = ?Time.now();
                        conductorInvocationCount = 0;
                        lastCompletedTaskId = null;
                        lastTaskSucceeded = null;
                        lastTaskError = null;
                    }
                });
                scheduleConductorTick<system>(choreId, 0);
            };

            // Schedule the next run (with optional randomization)
            let now = Time.now();
            let intervalSecs = computeInterval(config);
            let intervalNanos = intervalSecs * 1_000_000_000;
            let nextRunAt = now + intervalNanos;

            let tid = Timer.setTimer<system>(#seconds intervalSecs, func(): async () {
                await schedulerFired<system>(choreId);
            });

            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with schedulerTimerId = ?tid; nextScheduledRunAt = ?nextRunAt }
            });
        };

        /// Schedule-start a chore: enable it and arm the scheduler at a specific future time,
        /// but do NOT run the conductor immediately. When the timer fires, the chore runs and
        /// reschedules itself with its normal interval from that point on.
        /// Use this when the user wants to start a chore but defer the first run.
        public func scheduleStart<system>(choreId: Text, timestampNanos: Int) {
            // Set enabled=true, paused=false
            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with enabled = true; paused = false }
            });

            // Clear any stop request
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with stopRequested = false }
            });

            // Cancel existing scheduler timer if any
            let state = getStateOrDefault(choreId);
            switch (state.schedulerTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };

            // Set the next scheduled run to the user-provided time
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with nextScheduledRunAt = ?timestampNanos; schedulerTimerId = null }
            });

            // Arm the scheduler (will compute delay from nextScheduledRunAt)
            startScheduler<system>(choreId);
        };

        /// Pause a running chore: suspend the schedule but preserve nextScheduledRunAt.
        /// Stops conductor/task if currently active. Transitions Running → Paused.
        public func pause(choreId: Text) {
            let config = getConfigOrDefault(choreId);
            if (not config.enabled or config.paused) return; // Already paused or stopped

            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with paused = true }
            });

            // Cancel scheduler timer but keep nextScheduledRunAt
            let state = getStateOrDefault(choreId);
            switch (state.schedulerTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with schedulerTimerId = null }
            });

            // Stop conductor/task if running
            if (state.conductorActive) {
                stopRunningActivity(choreId);
            };
        };

        /// Resume a paused chore: re-activate the preserved schedule.
        /// If nextScheduledRunAt has already passed, triggers immediately.
        /// Transitions Paused → Running.
        public func resume<system>(choreId: Text) {
            let config = getConfigOrDefault(choreId);
            if (not config.enabled or not config.paused) return; // Not paused

            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with paused = false }
            });

            // Clear any stop request
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with stopRequested = false }
            });

            // Check if the preserved schedule time has passed
            let state = getStateOrDefault(choreId);
            switch (state.nextScheduledRunAt) {
                case (?nextRun) {
                    let now = Time.now();
                    if (nextRun <= now) {
                        // Past due — run immediately and schedule next
                        if (not state.conductorActive) {
                            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                                {
                                    s with
                                    conductorActive = true;
                                    conductorStartedAt = ?Time.now();
                                    conductorInvocationCount = 0;
                                    lastCompletedTaskId = null;
                                    lastTaskSucceeded = null;
                                    lastTaskError = null;
                                }
                            });
                            scheduleConductorTick<system>(choreId, 0);
                        };
                        // Schedule the next regular run (with optional randomization)
                        let intervalSecs = computeInterval(config);
                        let intervalNanos = intervalSecs * 1_000_000_000;
                        let nextRunAt = now + intervalNanos;
                        let tid = Timer.setTimer<system>(#seconds intervalSecs, func(): async () {
                            await schedulerFired<system>(choreId);
                        });
                        updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                            { s with schedulerTimerId = ?tid; nextScheduledRunAt = ?nextRunAt }
                        });
                    } else {
                        // Future time — just re-schedule the timer for that time
                        startScheduler<system>(choreId);
                    };
                };
                case null {
                    // No preserved schedule — start fresh scheduler
                    startScheduler<system>(choreId);
                };
            };
        };

        /// Stop a chore completely: cancel everything and clear the schedule.
        /// Transitions Running or Paused → Stopped.
        public func stop(choreId: Text) {
            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with enabled = false; paused = false }
            });

            // Cancel scheduler timer and clear schedule
            let state = getStateOrDefault(choreId);
            switch (state.schedulerTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with schedulerTimerId = null; nextScheduledRunAt = null }
            });

            // Stop conductor/task if running
            if (state.conductorActive) {
                stopRunningActivity(choreId);
            };
        };

        /// Internal: stop running conductor and task activity for a chore.
        func stopRunningActivity(choreId: Text) {
            let state = getStateOrDefault(choreId);

            // Cancel conductor timer
            switch (state.conductorTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };
            // Cancel task timer
            switch (state.taskTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };

            // Mark inactive
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    stopRequested = true;
                    conductorActive = false;
                    conductorTimerId = null;
                    taskActive = false;
                    taskTimerId = null;
                    currentTaskId = null;
                }
            });

            // Clear pending tasks
            ignore consumePendingTask(choreId);
        };

        /// Change the schedule interval for a chore (in seconds).
        /// Takes effect on the next scheduler fire.
        public func setInterval(choreId: Text, seconds: Nat) {
            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with intervalSeconds = seconds }
            });
        };

        /// Change the max interval for randomized scheduling (in seconds).
        /// Pass null to disable randomization (use exact intervalSeconds).
        /// When set and > intervalSeconds, each reschedule picks a random time in [intervalSeconds, maxIntervalSeconds].
        public func setMaxInterval(choreId: Text, seconds: ?Nat) {
            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with maxIntervalSeconds = seconds }
            });
        };

        /// Change the task timeout for a chore (in seconds).
        public func setTaskTimeout(choreId: Text, seconds: Nat) {
            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with taskTimeoutSeconds = seconds }
            });
        };

        /// Force-run a chore immediately, regardless of schedule.
        /// If the conductor is already running, this is a no-op.
        public func trigger<system>(choreId: Text) {
            let state = getStateOrDefault(choreId);
            if (state.conductorActive) {
                return; // Already running
            };

            // Clear any previous stop request and start conductor
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    stopRequested = false;
                    conductorActive = true;
                    conductorStartedAt = ?Time.now();
                    conductorInvocationCount = 0;
                    lastCompletedTaskId = null;
                    lastTaskSucceeded = null;
                    lastTaskError = null;
                }
            });

            scheduleConductorTick<system>(choreId, 0);
        };

        /// Set the next scheduled run time for a chore. Reschedules the scheduler timer.
        /// The chore must be enabled. For paused chores, the time is stored but the
        /// scheduler is not started (it will be armed when the chore is resumed).
        /// The timestamp is in nanoseconds.
        /// Use this to offset chore schedules (e.g., two weekly chores running on opposite weeks).
        public func setNextScheduledRun<system>(choreId: Text, timestampNanos: Int) {
            let config = getConfigOrDefault(choreId);
            if (not config.enabled) {
                Debug.trap("setNextScheduledRun: chore '" # choreId # "' is not enabled (enabled=" # Bool.toText(config.enabled) # ", paused=" # Bool.toText(config.paused) # ")");
            };

            // Verify the state entry exists before attempting update
            let states = stateAccessor.getStates();
            var stateFound = false;
            for ((id, _s) in states.vals()) {
                if (id == choreId) { stateFound := true };
            };
            if (not stateFound) {
                Debug.trap("setNextScheduledRun: no runtime state entry found for choreId '" # choreId # "'");
            };

            // Cancel existing scheduler timer
            let state = getStateOrDefault(choreId);
            switch (state.schedulerTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };

            // Set the new next scheduled run time
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with nextScheduledRunAt = ?timestampNanos; schedulerTimerId = null }
            });

            // Restart the scheduler only if not paused
            // Paused chores preserve nextScheduledRunAt for when they are resumed
            if (not config.paused) {
                startScheduler<system>(choreId);
            };
        };

        /// Stop all chore instances (full stop — disable + clear schedules).
        public func stopAllChores() {
            let instances = stateAccessor.getInstances();
            for ((instanceId, _info) in instances.vals()) {
                stop(instanceId);
            };
        };

        // ============================================
        // QUERIES
        // ============================================

        /// Get the full status of a specific chore instance.
        public func getStatus(instanceId: Text): ?BotChoreTypes.ChoreStatus {
            let def = findDefinition(instanceId);
            switch (def) {
                case null { null };
                case (?d) {
                    let config = getConfigOrDefault(instanceId);
                    let state = getStateOrDefault(instanceId);
                    let info = getInstance(instanceId);
                    let iLabel = switch (info) { case (?i) { i.instanceLabel }; case null { d.name } };
                    ?buildStatus(instanceId, d, config, state, iLabel)
                };
            };
        };

        /// Get the full status of all chore instances.
        public func getAllStatuses(): [BotChoreTypes.ChoreStatus] {
            let instances = stateAccessor.getInstances();
            let result = Buffer.Buffer<BotChoreTypes.ChoreStatus>(instances.size());
            for ((instanceId, info) in instances.vals()) {
                switch (findDefinitionByTypeId(info.typeId)) {
                    case (?def) {
                        let config = getConfigOrDefault(instanceId);
                        let state = getStateOrDefault(instanceId);
                        result.add(buildStatus(instanceId, def, config, state, info.instanceLabel));
                    };
                    case null {}; // Type not registered (shouldn't happen)
                };
            };
            Buffer.toArray(result)
        };

        /// Get the config for a specific chore.
        public func getConfig(choreId: Text): ?BotChoreTypes.ChoreConfig {
            let configs = stateAccessor.getConfigs();
            for ((id, config) in configs.vals()) {
                if (id == choreId) return ?config;
            };
            null
        };

        /// Get all chore configs.
        public func getAllConfigs(): [(Text, BotChoreTypes.ChoreConfig)] {
            stateAccessor.getConfigs()
        };

        // ============================================
        // SCHEDULER (Level 1)
        // ============================================

        /// Start the scheduler timer for a chore.
        func startScheduler<system>(choreId: Text) {
            let state = getStateOrDefault(choreId);
            let config = getConfigOrDefault(choreId);

            // Cancel existing scheduler if any
            switch (state.schedulerTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };

            // Calculate delay until next fire
            let now = Time.now();
            let intervalSecs = computeInterval(config);
            let intervalNanos = intervalSecs * 1_000_000_000;

            let delayNanos: Nat = switch (state.nextScheduledRunAt) {
                case (?nextRun) {
                    if (nextRun > now) {
                        // Future scheduled time — use it
                        Int.abs(nextRun - now)
                    } else {
                        // Past due — fire soon (1 second grace period)
                        1_000_000_000
                    };
                };
                case null {
                    // Never scheduled — fire after one interval
                    intervalNanos
                };
            };

            let delaySeconds = delayNanos / 1_000_000_000;
            let nextRunAt = now + delayNanos;

            let tid = Timer.setTimer<system>(#seconds delaySeconds, func(): async () {
                await schedulerFired<system>(choreId);
            });

            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with schedulerTimerId = ?tid; nextScheduledRunAt = ?nextRunAt }
            });
        };

        /// Called when a scheduler timer fires.
        func schedulerFired<system>(choreId: Text): async () {
            let config = getConfigOrDefault(choreId);
            let state = getStateOrDefault(choreId);

            // Check stop flag
            if (state.stopRequested) {
                updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                    { s with schedulerTimerId = null; stopRequested = false }
                });
                return;
            };

            // Only start conductor if not already running
            if (not state.conductorActive) {
                updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                    {
                        s with
                        conductorActive = true;
                        conductorStartedAt = ?Time.now();
                        conductorInvocationCount = 0;
                        lastCompletedTaskId = null;
                        lastTaskSucceeded = null;
                        lastTaskError = null;
                    }
                });
                scheduleConductorTick<system>(choreId, 0);
            };

            // Reschedule for next interval (only if enabled and not paused, with optional randomization)
            if (config.enabled and not config.paused) {
                let now = Time.now();
                let interval = computeInterval(config);
                let intervalNanos = interval * 1_000_000_000;
                let nextRunAt = now + intervalNanos;

                let tid = Timer.setTimer<system>(#seconds interval, func(): async () {
                    await schedulerFired<system>(choreId);
                });

                updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                    { s with schedulerTimerId = ?tid; nextScheduledRunAt = ?nextRunAt }
                });
            } else {
                updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                    { s with schedulerTimerId = null; nextScheduledRunAt = null }
                });
            };
        };

        // ============================================
        // CONDUCTOR (Level 2) — Polling Pattern
        // ============================================

        /// Schedule a conductor tick after a delay (in seconds).
        func scheduleConductorTick<system>(choreId: Text, delaySecs: Nat) {
            let tid = Timer.setTimer<system>(#seconds delaySecs, func(): async () {
                await conductorTick<system>(choreId);
            });
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with conductorTimerId = ?tid }
            });
        };

        /// One tick of the conductor loop (polling pattern).
        ///
        /// Flow:
        /// 1. Check stop flag
        /// 2. Check for timed-out task (mark as failed if so)
        /// 3. Build context with current task state
        /// 4. Call conductor callback
        /// 5. Start pending task if conductor set one via setPendingTask
        /// 6. Schedule next tick based on conductor's return value
        func conductorTick<system>(choreId: Text): async () {
            let state = getStateOrDefault(choreId);

            // 1. Check stop flag BEFORE doing work
            if (state.stopRequested) {
                markConductorStopped(choreId);
                return;
            };

            let def = findDefinition(choreId);
            switch (def) {
                case null {
                    markConductorError(choreId, "Chore definition not found: " # choreId);
                    return;
                };
                case (?d) {
                    // 2. Check for timed-out task
                    let freshState = checkTaskTimeout(choreId);

                    // 3. Build conductor context with pure data
                    let context: BotChoreTypes.ConductorContext = {
                        choreId = choreId;
                        invocationCount = freshState.conductorInvocationCount;
                        isTaskRunning = freshState.taskActive;
                        lastCompletedTask = switch (freshState.lastCompletedTaskId) {
                            case null { null };
                            case (?taskId) {
                                ?{
                                    taskId = taskId;
                                    succeeded = switch (freshState.lastTaskSucceeded) {
                                        case (?s) { s };
                                        case null { true }; // Assume success if unknown
                                    };
                                    error = freshState.lastTaskError;
                                }
                            };
                        };
                    };

                    // Increment invocation count
                    updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                        { s with conductorInvocationCount = s.conductorInvocationCount + 1 }
                    });

                    // 4. Call the conductor function
                    try {
                        let action = await d.conduct(context);

                        // Check stop flag AFTER await (could have been set during)
                        let stateAfter = getStateOrDefault(choreId);
                        if (stateAfter.stopRequested) {
                            markConductorStopped(choreId);
                            return;
                        };

                        // 5. Start pending task if conductor set one
                        let pending = consumePendingTask(choreId);
                        switch (pending) {
                            case (?(taskId, taskFn)) {
                                // Mark task as started in state
                                updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                                    {
                                        s with
                                        currentTaskId = ?taskId;
                                        taskActive = true;
                                        taskStartedAt = ?Time.now();
                                    }
                                });
                                // Start the task loop
                                startTaskLoop<system>(choreId, taskFn);
                            };
                            case null {};
                        };

                        // 6. Handle conductor action
                        switch (action) {
                            case (#ContinueIn(seconds)) {
                                scheduleConductorTick<system>(choreId, seconds);
                            };
                            case (#Done) {
                                // If a task is still running, cancel it
                                let stFinal = getStateOrDefault(choreId);
                                if (stFinal.taskActive) {
                                    switch (stFinal.taskTimerId) {
                                        case (?tid) { Timer.cancelTimer(tid) };
                                        case null {};
                                    };
                                    updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                                        { s with taskActive = false; taskTimerId = null; currentTaskId = null }
                                    });
                                };
                                markConductorDone(choreId);
                            };
                            case (#Error(msg)) {
                                // If a task is still running, cancel it
                                let stFinal = getStateOrDefault(choreId);
                                if (stFinal.taskActive) {
                                    switch (stFinal.taskTimerId) {
                                        case (?tid) { Timer.cancelTimer(tid) };
                                        case null {};
                                    };
                                    updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                                        { s with taskActive = false; taskTimerId = null; currentTaskId = null }
                                    });
                                };
                                markConductorError(choreId, msg);
                            };
                        };
                    } catch (e) {
                        markConductorError(choreId, "Conductor threw: " # Error.message(e));
                    };
                };
            };
        };

        /// Check if the current task has timed out. If so, mark it as failed.
        /// Returns the (possibly updated) runtime state.
        func checkTaskTimeout(choreId: Text): BotChoreTypes.ChoreRuntimeState {
            let state = getStateOrDefault(choreId);
            if (not state.taskActive) return state;

            let config = getConfigOrDefault(choreId);
            switch (state.taskStartedAt) {
                case (?startedAt) {
                    let now = Time.now();
                    let elapsedNanos = Int.abs(now - startedAt);
                    let elapsedSeconds = elapsedNanos / 1_000_000_000;
                    if (elapsedSeconds >= config.taskTimeoutSeconds) {
                        // Task timed out — cancel its timer and mark as failed
                        switch (state.taskTimerId) {
                            case (?tid) { Timer.cancelTimer(tid) };
                            case null {};
                        };
                        let taskId = switch (state.currentTaskId) {
                            case (?id) { id };
                            case null { "unknown" };
                        };
                        updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                            {
                                s with
                                taskActive = false;
                                taskTimerId = null;
                                currentTaskId = null;
                                lastCompletedTaskId = ?taskId;
                                lastTaskSucceeded = ?false;
                                lastTaskError = ?"Task timed out";
                            }
                        });
                        return getStateOrDefault(choreId);
                    };
                };
                case null {};
            };
            state
        };

        /// Mark conductor as successfully completed.
        func markConductorDone(choreId: Text) {
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    conductorActive = false;
                    conductorTimerId = null;
                    lastCompletedRunAt = ?Time.now();
                    totalRunCount = s.totalRunCount + 1;
                    totalSuccessCount = s.totalSuccessCount + 1;
                }
            });
        };

        /// Mark conductor as failed.
        func markConductorError(choreId: Text, msg: Text) {
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    conductorActive = false;
                    conductorTimerId = null;
                    totalRunCount = s.totalRunCount + 1;
                    totalFailureCount = s.totalFailureCount + 1;
                    lastError = ?msg;
                    lastErrorAt = ?Time.now();
                }
            });
        };

        /// Mark conductor as stopped (by stop flag).
        func markConductorStopped(choreId: Text) {
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    conductorActive = false;
                    conductorTimerId = null;
                    taskActive = false;
                    taskTimerId = null;
                    currentTaskId = null;
                    stopRequested = false; // Clear flag so chore can be re-triggered
                }
            });
        };

        // ============================================
        // TASK (Level 3) — Engine-Wrapped Loop
        // ============================================
        // The engine wraps each task tick to provide:
        //   - Stop-flag checking
        //   - Timer ID tracking (for admin & cancellation)
        //   - State updates (taskActive, etc.)
        //   - Error handling (try/catch)
        //
        // The task itself is unaware of the conductor. It just returns
        // #Continue, #Done, or #Error. The conductor detects task
        // completion by polling ctx.isTaskRunning on its next tick.

        /// Start the task loop with a 0-second timer.
        func startTaskLoop<system>(choreId: Text, taskFn: () -> async BotChoreTypes.TaskAction) {
            let tid = Timer.setTimer<system>(#seconds 0, func(): async () {
                await taskLoopTick<system>(choreId, taskFn);
            });
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with taskTimerId = ?tid }
            });
        };

        /// One tick of the task loop.
        func taskLoopTick<system>(choreId: Text, taskFn: () -> async BotChoreTypes.TaskAction): async () {
            let state = getStateOrDefault(choreId);

            // Check stop flag BEFORE doing work
            if (state.stopRequested or not state.taskActive) {
                return; // Stopped or task already marked done (e.g., timeout)
            };

            try {
                let action = await taskFn();

                // Check stop flag AFTER await
                let stateAfter = getStateOrDefault(choreId);
                if (stateAfter.stopRequested or not stateAfter.taskActive) {
                    return; // Stopped or timed out while we were working
                };

                switch (action) {
                    case (#Continue) {
                        // More work — reschedule immediately
                        let tid = Timer.setTimer<system>(#seconds 0, func(): async () {
                            await taskLoopTick<system>(choreId, taskFn);
                        });
                        updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                            { s with taskTimerId = ?tid }
                        });
                    };
                    case (#Done) {
                        markTaskCompleted(choreId, true, null);
                    };
                    case (#Error(msg)) {
                        markTaskCompleted(choreId, false, ?msg);
                    };
                };
            } catch (e) {
                markTaskCompleted(choreId, false, ?("Task threw: " # Error.message(e)));
            };
        };

        /// Mark a task as completed (success or failure).
        /// Updates state only — does NOT trigger the conductor.
        /// The conductor discovers this on its next polling tick.
        func markTaskCompleted(choreId: Text, succeeded: Bool, error: ?Text) {
            let state = getStateOrDefault(choreId);
            let taskId = switch (state.currentTaskId) {
                case (?id) { id };
                case null { "unknown" };
            };

            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    taskActive = false;
                    taskTimerId = null;
                    currentTaskId = null;
                    lastCompletedTaskId = ?taskId;
                    lastTaskSucceeded = ?succeeded;
                    lastTaskError = error;
                }
            });
        };

        // ============================================
        // INTERNAL: State helpers
        // ============================================

        /// Find a chore type definition by type ID.
        func findDefinitionByTypeId(typeId: Text): ?BotChoreTypes.ChoreDefinition {
            for (def in definitions.vals()) {
                if (def.id == typeId) return ?def;
            };
            null
        };

        /// Find the chore type definition for an instance ID.
        /// Resolves instanceId -> typeId -> definition.
        func findDefinition(instanceId: Text): ?BotChoreTypes.ChoreDefinition {
            // Look up instance to get its typeId
            let instances = stateAccessor.getInstances();
            for ((id, info) in instances.vals()) {
                if (id == instanceId) {
                    return findDefinitionByTypeId(info.typeId);
                };
            };
            // Fallback: try direct match (for backward compat during transition)
            findDefinitionByTypeId(instanceId)
        };

        /// Get config for a chore, or a default if not found.
        func getConfigOrDefault(choreId: Text): BotChoreTypes.ChoreConfig {
            let configs = stateAccessor.getConfigs();
            for ((id, config) in configs.vals()) {
                if (id == choreId) return config;
            };
            { enabled = false; paused = false; intervalSeconds = 3600; maxIntervalSeconds = null; taskTimeoutSeconds = 300 }
        };

        /// Get runtime state for a chore, or empty state if not found.
        func getStateOrDefault(choreId: Text): BotChoreTypes.ChoreRuntimeState {
            let states = stateAccessor.getStates();
            for ((id, state) in states.vals()) {
                if (id == choreId) return state;
            };
            BotChoreTypes.emptyRuntimeState()
        };

        /// Update config for a chore.
        func updateConfig(choreId: Text, updater: (BotChoreTypes.ChoreConfig) -> BotChoreTypes.ChoreConfig) {
            let configs = stateAccessor.getConfigs();
            let updated = Array.map<(Text, BotChoreTypes.ChoreConfig), (Text, BotChoreTypes.ChoreConfig)>(
                configs,
                func((id, config)) {
                    if (id == choreId) { (id, updater(config)) } else { (id, config) }
                }
            );
            stateAccessor.setConfigs(updated);
        };

        /// Update runtime state for a chore.
        func updateState(choreId: Text, updater: (BotChoreTypes.ChoreRuntimeState) -> BotChoreTypes.ChoreRuntimeState) {
            let states = stateAccessor.getStates();
            let updated = Array.map<(Text, BotChoreTypes.ChoreRuntimeState), (Text, BotChoreTypes.ChoreRuntimeState)>(
                states,
                func((id, state)) {
                    if (id == choreId) { (id, updater(state)) } else { (id, state) }
                }
            );
            stateAccessor.setStates(updated);
        };

        /// Cancel all active timers for a chore (scheduler, conductor, task).
        func cancelChoreTimers(choreId: Text) {
            let state = getStateOrDefault(choreId);
            switch (state.schedulerTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };
            switch (state.conductorTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };
            switch (state.taskTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };
            ignore consumePendingTask(choreId);
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    schedulerTimerId = null;
                    conductorTimerId = null;
                    taskTimerId = null;
                    conductorActive = false;
                    taskActive = false;
                    currentTaskId = null;
                }
            });
        };

        // ============================================
        // INTERNAL: Interval randomization
        // ============================================

        /// Compute the actual interval to use for scheduling.
        /// If maxIntervalSeconds is set and > intervalSeconds, picks a pseudo-random
        /// value in [intervalSeconds, maxIntervalSeconds] using Time.now() as entropy.
        /// This provides scheduling jitter for chores that should not be perfectly regular.
        func computeInterval(config: BotChoreTypes.ChoreConfig): Nat {
            let min = config.intervalSeconds;
            switch (config.maxIntervalSeconds) {
                case (?max) {
                    if (max > min) {
                        let range = max - min + 1; // inclusive range
                        let entropy = Int.abs(Time.now()); // nanosecond timestamp as entropy
                        let jitter = entropy % range;
                        min + jitter
                    } else {
                        min // max <= min, no range
                    };
                };
                case null { min }; // no max set, use exact interval
            };
        };

        // ============================================
        // INTERNAL: Status builder
        // ============================================

        /// Build a ChoreStatus from instance ID, definition, config, runtime state, and instance label.
        func buildStatus(
            instanceId: Text,
            def: BotChoreTypes.ChoreDefinition,
            config: BotChoreTypes.ChoreConfig,
            state: BotChoreTypes.ChoreRuntimeState,
            iLabel: Text
        ): BotChoreTypes.ChoreStatus {
            let schedulerStatus: BotChoreTypes.SchedulerStatus = switch (state.schedulerTimerId) {
                case (?_) { #Scheduled };
                case null { #Idle };
            };

            let conductorStatus: BotChoreTypes.ConductorStatus = if (not state.conductorActive) {
                #Idle
            } else if (state.taskActive) {
                #Polling  // Conductor is active while a task is running → polling
            } else {
                #Running  // Conductor is active, no task → doing its own work
            };

            let taskStatus: BotChoreTypes.TaskStatus = if (state.taskActive) {
                #Running
            } else {
                #Idle
            };

            {
                choreId = instanceId;
                choreTypeId = def.id;
                choreName = def.name;
                choreDescription = def.description;
                instanceLabel = iLabel;
                enabled = config.enabled;
                paused = config.paused;
                intervalSeconds = config.intervalSeconds;
                maxIntervalSeconds = config.maxIntervalSeconds;
                taskTimeoutSeconds = config.taskTimeoutSeconds;

                schedulerStatus = schedulerStatus;
                nextScheduledRunAt = state.nextScheduledRunAt;
                lastCompletedRunAt = state.lastCompletedRunAt;

                conductorStatus = conductorStatus;
                conductorStartedAt = state.conductorStartedAt;
                conductorInvocationCount = state.conductorInvocationCount;

                currentTaskId = state.currentTaskId;
                taskStatus = taskStatus;
                taskStartedAt = state.taskStartedAt;
                lastCompletedTaskId = state.lastCompletedTaskId;
                lastTaskSucceeded = state.lastTaskSucceeded;
                lastTaskError = state.lastTaskError;

                stopRequested = state.stopRequested;

                totalRunCount = state.totalRunCount;
                totalSuccessCount = state.totalSuccessCount;
                totalFailureCount = state.totalFailureCount;
                lastError = state.lastError;
                lastErrorAt = state.lastErrorAt;
            }
        };

    };

};
