import Timer "mo:base/Timer";
import Time "mo:base/Time";
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Error "mo:base/Error";

import BotChoreTypes "BotChoreTypes";

/// Reusable Bot Chore engine.
///
/// Manages the three-level timer hierarchy (Scheduler → Conductor → Task),
/// persists state through a StateAccessor for upgrade resilience, and provides
/// admin controls including emergency stop.
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

        /// Registered chore definitions (re-registered on each canister start).
        var definitions = Buffer.Buffer<BotChoreTypes.ChoreDefinition>(4);

        /// Currently active task execute functions, keyed by chore ID.
        /// These are closures that can't be persisted — only valid during execution.
        var activeTaskFns: [(Text, () -> async BotChoreTypes.TaskAction)] = [];

        // ============================================
        // REGISTRATION
        // ============================================

        /// Register a chore definition. Call this on every canister start
        /// (the conduct function is a closure that doesn't survive upgrades).
        /// If no config exists for this chore, creates one with defaults.
        public func registerChore(def: BotChoreTypes.ChoreDefinition) {
            definitions.add(def);

            // Initialize config if not present
            let configs = stateAccessor.getConfigs();
            let configExists = Array.find<(Text, BotChoreTypes.ChoreConfig)>(
                configs, func((id, _)) { id == def.id }
            );
            if (configExists == null) {
                let newConfig: BotChoreTypes.ChoreConfig = {
                    enabled = false; // Disabled by default — admin must enable
                    intervalSeconds = def.defaultIntervalSeconds;
                };
                stateAccessor.setConfigs(Array.append(configs, [(def.id, newConfig)]));
            };

            // Initialize runtime state if not present
            let states = stateAccessor.getStates();
            let stateExists = Array.find<(Text, BotChoreTypes.ChoreRuntimeState)>(
                states, func((id, _)) { id == def.id }
            );
            if (stateExists == null) {
                stateAccessor.setStates(Array.append(states, [(def.id, BotChoreTypes.emptyRuntimeState())]));
            };
        };

        // ============================================
        // TIMER LIFECYCLE
        // ============================================

        /// Start or resume all timers. Call on first deploy and after every upgrade.
        /// - Clears stale timer IDs (old timers don't survive upgrades).
        /// - Restarts schedulers for enabled chores.
        /// - Restarts conductors that were active when the canister was stopped.
        public func resumeTimers<system>() {
            for (def in definitions.vals()) {
                let choreId = def.id;

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

                if (config.enabled) {
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
                        startConductorTimer<system>(choreId);
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

        /// Enable or disable a chore. When enabled, starts the scheduler.
        /// When disabled, stops any running activity.
        public func setEnabled<system>(choreId: Text, enabled: Bool) {
            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with enabled = enabled }
            });

            if (enabled) {
                startScheduler<system>(choreId);
            } else {
                stopChore(choreId);
            };
        };

        /// Change the schedule interval for a chore (in seconds).
        /// Takes effect on the next scheduler fire.
        public func setInterval(choreId: Text, seconds: Nat) {
            updateConfig(choreId, func(c: BotChoreTypes.ChoreConfig): BotChoreTypes.ChoreConfig {
                { c with intervalSeconds = seconds }
            });
        };

        /// Force-run a chore immediately, regardless of schedule.
        /// If the conductor is already running, this is a no-op.
        public func trigger<system>(choreId: Text) {
            let state = getStateOrDefault(choreId);
            if (state.conductorActive) {
                return; // Already running
            };

            // Clear any previous stop request
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

            startConductorTimer<system>(choreId);
        };

        /// Stop a running chore gracefully. Sets the stop flag and cancels timers.
        /// The stop flag prevents any running timer from rescheduling itself.
        public func stopChore(choreId: Text) {
            let state = getStateOrDefault(choreId);

            // Cancel active timers
            switch (state.conductorTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };
            switch (state.taskTimerId) {
                case (?tid) { Timer.cancelTimer(tid) };
                case null {};
            };

            // Set stop flag and mark inactive
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

            // Also remove any cached task function
            removeTaskFn(choreId);
        };

        /// Stop all running chores.
        public func stopAllChores() {
            let states = stateAccessor.getStates();
            for ((choreId, _state) in states.vals()) {
                stopChore(choreId);
            };
        };

        // ============================================
        // QUERIES
        // ============================================

        /// Get the full status of a specific chore.
        public func getStatus(choreId: Text): ?BotChoreTypes.ChoreStatus {
            let def = findDefinition(choreId);
            switch (def) {
                case null { null };
                case (?d) {
                    let config = getConfigOrDefault(choreId);
                    let state = getStateOrDefault(choreId);
                    ?buildStatus(d, config, state)
                };
            };
        };

        /// Get the full status of all registered chores.
        public func getAllStatuses(): [BotChoreTypes.ChoreStatus] {
            let result = Buffer.Buffer<BotChoreTypes.ChoreStatus>(definitions.size());
            for (def in definitions.vals()) {
                let config = getConfigOrDefault(def.id);
                let state = getStateOrDefault(def.id);
                result.add(buildStatus(def, config, state));
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
            let intervalNanos = config.intervalSeconds * 1_000_000_000;

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
                startConductorTimer<system>(choreId);
            };

            // Reschedule for next interval
            if (config.enabled) {
                let now = Time.now();
                let interval = config.intervalSeconds;
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
        // CONDUCTOR (Level 2)
        // ============================================

        /// Start a conductor timer (0-second, to run ASAP).
        func startConductorTimer<system>(choreId: Text) {
            let tid = Timer.setTimer<system>(#seconds 0, func(): async () {
                await conductorTick<system>(choreId);
            });
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with conductorTimerId = ?tid }
            });
        };

        /// One tick of the conductor loop.
        func conductorTick<system>(choreId: Text): async () {
            let state = getStateOrDefault(choreId);

            // Check stop flag BEFORE doing work
            if (state.stopRequested) {
                markConductorStopped(choreId);
                return;
            };

            let def = findDefinition(choreId);
            switch (def) {
                case null {
                    // Definition not found (shouldn't happen unless chore was unregistered)
                    markConductorError(choreId, "Chore definition not found: " # choreId);
                    return;
                };
                case (?d) {
                    // Build conductor context
                    let context: BotChoreTypes.ConductorContext = {
                        invocationCount = state.conductorInvocationCount;
                        lastCompletedTask = switch (state.lastCompletedTaskId) {
                            case null { null };
                            case (?taskId) {
                                ?{
                                    taskId = taskId;
                                    result = switch (state.lastTaskSucceeded) {
                                        case (?true) { #Completed };
                                        case (?false) {
                                            let errMsg = switch (state.lastTaskError) {
                                                case (?e) { e };
                                                case null { "Unknown error" };
                                            };
                                            #Failed(errMsg)
                                        };
                                        case null { #Completed };
                                    };
                                }
                            };
                        };
                    };

                    // Increment invocation count
                    updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                        { s with conductorInvocationCount = s.conductorInvocationCount + 1 }
                    });

                    // Call the conductor function
                    try {
                        let action = await d.conduct(context);

                        // Check stop flag AFTER await (could have been set during)
                        let stateAfter = getStateOrDefault(choreId);
                        if (stateAfter.stopRequested) {
                            markConductorStopped(choreId);
                            return;
                        };

                        // Interpret the action
                        switch (action) {
                            case (#StartTask({ taskId })) {
                                // Get the task function from the chore definition
                                let taskFnOpt = d.createTask(taskId);
                                switch (taskFnOpt) {
                                    case null {
                                        markConductorError(choreId, "createTask returned null for task: " # taskId);
                                    };
                                    case (?taskFn) {
                                        // Save the task function and start the task timer
                                        setTaskFn(choreId, taskFn);
                                        updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                                            {
                                                s with
                                                currentTaskId = ?taskId;
                                                taskActive = true;
                                                taskStartedAt = ?Time.now();
                                            }
                                        });
                                        startTaskTimer<system>(choreId);
                                    };
                                };
                            };
                            case (#Continue) {
                                startConductorTimer<system>(choreId);
                            };
                            case (#ContinueIn({ seconds })) {
                                let tid = Timer.setTimer<system>(#seconds seconds, func(): async () {
                                    await conductorTick<system>(choreId);
                                });
                                updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                                    { s with conductorTimerId = ?tid }
                                });
                            };
                            case (#Done) {
                                markConductorDone(choreId);
                            };
                            case (#Error(msg)) {
                                markConductorError(choreId, msg);
                            };
                        };
                    } catch (e) {
                        markConductorError(choreId, "Conductor threw: " # Error.message(e));
                    };
                };
            };
        };

        /// Mark conductor as successfully completed.
        func markConductorDone(choreId: Text) {
            removeTaskFn(choreId);
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    conductorActive = false;
                    conductorTimerId = null;
                    taskActive = false;
                    taskTimerId = null;
                    currentTaskId = null;
                    lastCompletedRunAt = ?Time.now();
                    totalRunCount = s.totalRunCount + 1;
                    totalSuccessCount = s.totalSuccessCount + 1;
                }
            });
        };

        /// Mark conductor as failed.
        func markConductorError(choreId: Text, msg: Text) {
            removeTaskFn(choreId);
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    conductorActive = false;
                    conductorTimerId = null;
                    taskActive = false;
                    taskTimerId = null;
                    currentTaskId = null;
                    totalRunCount = s.totalRunCount + 1;
                    totalFailureCount = s.totalFailureCount + 1;
                    lastError = ?msg;
                    lastErrorAt = ?Time.now();
                }
            });
        };

        /// Mark conductor as stopped (by stop flag).
        func markConductorStopped(choreId: Text) {
            removeTaskFn(choreId);
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
        // TASK (Level 3)
        // ============================================

        /// Start a task timer (0-second, to run ASAP).
        func startTaskTimer<system>(choreId: Text) {
            let tid = Timer.setTimer<system>(#seconds 0, func(): async () {
                await taskTick<system>(choreId);
            });
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                { s with taskTimerId = ?tid }
            });
        };

        /// One tick of the task loop.
        func taskTick<system>(choreId: Text): async () {
            let state = getStateOrDefault(choreId);

            // Check stop flag BEFORE doing work
            if (state.stopRequested) {
                onTaskComplete<system>(choreId, #Failed("Stopped by admin"));
                return;
            };

            // Get the task function
            let taskFn = getTaskFn(choreId);
            switch (taskFn) {
                case null {
                    // No task function — this shouldn't happen
                    onTaskComplete<system>(choreId, #Failed("Task function not found"));
                    return;
                };
                case (?execute) {
                    try {
                        let action = await execute();

                        // Check stop flag AFTER await
                        let stateAfter = getStateOrDefault(choreId);
                        if (stateAfter.stopRequested) {
                            onTaskComplete<system>(choreId, #Failed("Stopped by admin"));
                            return;
                        };

                        switch (action) {
                            case (#Continue) {
                                // More work — reschedule immediately
                                startTaskTimer<system>(choreId);
                            };
                            case (#Done) {
                                onTaskComplete<system>(choreId, #Completed);
                            };
                            case (#Error(msg)) {
                                onTaskComplete<system>(choreId, #Failed(msg));
                            };
                        };
                    } catch (e) {
                        onTaskComplete<system>(choreId, #Failed("Task threw: " # Error.message(e)));
                    };
                };
            };
        };

        /// Called when a task completes (success or failure).
        /// Records the result and triggers the next conductor tick.
        func onTaskComplete<system>(choreId: Text, result: BotChoreTypes.TaskCompletionResult) {
            let state = getStateOrDefault(choreId);
            let taskId = switch (state.currentTaskId) {
                case (?id) { id };
                case null { "unknown" };
            };

            let succeeded = switch (result) {
                case (#Completed) { true };
                case (#Failed(_)) { false };
            };
            let errorMsg: ?Text = switch (result) {
                case (#Completed) { null };
                case (#Failed(msg)) { ?msg };
            };

            removeTaskFn(choreId);
            updateState(choreId, func(s: BotChoreTypes.ChoreRuntimeState): BotChoreTypes.ChoreRuntimeState {
                {
                    s with
                    taskActive = false;
                    taskTimerId = null;
                    currentTaskId = null;
                    lastCompletedTaskId = ?taskId;
                    lastTaskSucceeded = ?succeeded;
                    lastTaskError = errorMsg;
                }
            });

            // Check stop flag before re-invoking conductor
            let stateAfter = getStateOrDefault(choreId);
            if (stateAfter.stopRequested) {
                markConductorStopped(choreId);
                return;
            };

            // Trigger the next conductor tick to decide what to do next
            if (stateAfter.conductorActive) {
                startConductorTimer<system>(choreId);
            };
        };

        // ============================================
        // INTERNAL: State helpers
        // ============================================

        /// Find a registered chore definition by ID.
        func findDefinition(choreId: Text): ?BotChoreTypes.ChoreDefinition {
            for (def in definitions.vals()) {
                if (def.id == choreId) return ?def;
            };
            null
        };

        /// Get config for a chore, or a default if not found.
        func getConfigOrDefault(choreId: Text): BotChoreTypes.ChoreConfig {
            let configs = stateAccessor.getConfigs();
            for ((id, config) in configs.vals()) {
                if (id == choreId) return config;
            };
            { enabled = false; intervalSeconds = 3600 }
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
            removeTaskFn(choreId);
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
        // INTERNAL: Task function cache
        // ============================================

        /// Store the execute function for a chore's current task.
        func setTaskFn(choreId: Text, fn: () -> async BotChoreTypes.TaskAction) {
            removeTaskFn(choreId);
            activeTaskFns := Array.append(activeTaskFns, [(choreId, fn)]);
        };

        /// Get the execute function for a chore's current task.
        func getTaskFn(choreId: Text): ?(()-> async BotChoreTypes.TaskAction) {
            for ((id, fn) in activeTaskFns.vals()) {
                if (id == choreId) return ?fn;
            };
            null
        };

        /// Remove the cached task function for a chore.
        func removeTaskFn(choreId: Text) {
            activeTaskFns := Array.filter<(Text, () -> async BotChoreTypes.TaskAction)>(
                activeTaskFns,
                func((id, _fn)) { id != choreId }
            );
        };

        // ============================================
        // INTERNAL: Status builder
        // ============================================

        /// Build a ChoreStatus from definition, config, and runtime state.
        func buildStatus(
            def: BotChoreTypes.ChoreDefinition,
            config: BotChoreTypes.ChoreConfig,
            state: BotChoreTypes.ChoreRuntimeState
        ): BotChoreTypes.ChoreStatus {
            let schedulerStatus: BotChoreTypes.SchedulerStatus = switch (state.schedulerTimerId) {
                case (?_) { #Scheduled };
                case null { #Idle };
            };

            let conductorStatus: BotChoreTypes.ConductorStatus = if (not state.conductorActive) {
                #Idle
            } else if (state.taskActive) {
                #WaitingForTask
            } else {
                #Running
            };

            let taskStatus: BotChoreTypes.TaskStatus = if (state.taskActive) {
                #Running
            } else {
                #Idle
            };

            {
                choreId = def.id;
                choreName = def.name;
                choreDescription = def.description;
                enabled = config.enabled;
                intervalSeconds = config.intervalSeconds;

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
