/// Reusable types for the Bot Chores system.
///
/// Bot Chores are automated, recurring tasks that bot canisters execute on a schedule
/// using IC Timers. This module defines the shared types used by all bots.
///
/// The system uses a three-level timer hierarchy:
///   - Scheduler (Level 1): Fires on a recurring schedule, starts the Conductor.
///   - Conductor (Level 2): Orchestrates the chore by polling for Task completion.
///   - Task (Level 3): Performs actual work in instruction-limit-safe chunks.
///
/// The Conductor uses a polling pattern: it periodically checks if a Task has
/// finished rather than being notified by the Task. This makes the system
/// trap-resilient — a trapped Task simply stops, and the Conductor detects
/// the stale task on its next poll.
///
/// To start a Task, the Conductor calls engine.setPendingTask() before returning.
/// The engine picks up the pending task and runs it independently.
module {

    // ============================================
    // CONFIGURATION (admin-settable, stable)
    // ============================================

    /// Per-chore configuration. Stored in stable memory, settable by admins.
    ///
    /// Lifecycle states:
    ///   - Stopped:  enabled=false, paused=false — no schedule, no timers.
    ///   - Running:  enabled=true,  paused=false — scheduler active, chore runs on schedule.
    ///   - Paused:   enabled=true,  paused=true  — scheduler suspended, nextScheduledRunAt preserved.
    public type ChoreConfig = {
        enabled: Bool;              // Whether the chore is started (true) or stopped (false)
        paused: Bool;               // Whether the chore is paused (schedule preserved but suspended)
        intervalSeconds: Nat;       // Minimum interval: how often the scheduler fires (in seconds)
        maxIntervalSeconds: ?Nat;   // Optional max interval for random scheduling (null = use intervalSeconds exactly)
        taskTimeoutSeconds: Nat;    // Max seconds a task can run before considered dead
    };

    // ============================================
    // RUNTIME STATE (internal tracking, stable)
    // ============================================

    /// Per-chore runtime state. Stored in stable memory for upgrade resilience.
    /// Timer IDs become stale after upgrades and must be cleared on resume.
    public type ChoreRuntimeState = {
        // Scheduler
        schedulerTimerId: ?Nat;         // Timer ID (stale after upgrade)
        nextScheduledRunAt: ?Int;       // Timestamp (nanoseconds) for next scheduled fire
        lastCompletedRunAt: ?Int;       // Timestamp of last successful chore completion

        // Conductor
        conductorActive: Bool;          // true if conductor is running or polling for task
        conductorTimerId: ?Nat;         // Timer ID (stale after upgrade)
        conductorStartedAt: ?Int;       // Timestamp when conductor started this run
        conductorInvocationCount: Nat;  // How many times conductor was called this run

        // Current Task
        currentTaskId: ?Text;           // ID of the currently running task
        taskActive: Bool;               // true if a task is actively running
        taskTimerId: ?Nat;              // Timer ID (stale after upgrade)
        taskStartedAt: ?Int;            // Timestamp when current task started
        lastCompletedTaskId: ?Text;     // ID of the last completed task
        lastTaskSucceeded: ?Bool;       // true = success, false = failure
        lastTaskError: ?Text;           // Error message if last task failed

        // Control
        stopRequested: Bool;            // Emergency stop flag — prevents rescheduling

        // Statistics
        totalRunCount: Nat;             // Number of completed chore runs (success + failure)
        totalSuccessCount: Nat;         // Number of successful completions
        totalFailureCount: Nat;         // Number of failed completions
        lastError: ?Text;               // Most recent error message
        lastErrorAt: ?Int;              // Timestamp of most recent error
    };

    /// Create an empty runtime state for a new chore.
    public func emptyRuntimeState(): ChoreRuntimeState {
        {
            schedulerTimerId = null;
            nextScheduledRunAt = null;
            lastCompletedRunAt = null;
            conductorActive = false;
            conductorTimerId = null;
            conductorStartedAt = null;
            conductorInvocationCount = 0;
            currentTaskId = null;
            taskActive = false;
            taskTimerId = null;
            taskStartedAt = null;
            lastCompletedTaskId = null;
            lastTaskSucceeded = null;
            lastTaskError = null;
            stopRequested = false;
            totalRunCount = 0;
            totalSuccessCount = 0;
            totalFailureCount = 0;
            lastError = null;
            lastErrorAt = null;
        }
    };

    // ============================================
    // CALLBACK TYPES
    // ============================================

    /// Result returned by a Task to tell the engine what to do next.
    /// The engine wraps each task tick for stop-flag checking and state tracking.
    public type TaskAction = {
        #Continue;      // More work to do — re-invoke via 0-second timer
        #Done;          // Task completed successfully
        #Error: Text;   // Task failed with error message
    };

    /// Context passed to the Conductor on each invocation.
    /// Pure data — no functions. The conductor uses this to decide what to do.
    public type ConductorContext = {
        /// The chore ID (for calling engine.setPendingTask).
        choreId: Text;

        /// How many times the conductor has been invoked in this run.
        /// 0 on first invocation, increments each time.
        invocationCount: Nat;

        /// Whether a task is currently running.
        /// The conductor should return #ContinueIn(N) to poll when true.
        isTaskRunning: Bool;

        /// Info about the most recently completed task, if any.
        /// null on first invocation, after upgrade resume, or if no task has completed yet.
        lastCompletedTask: ?{
            taskId: Text;
            succeeded: Bool;
            error: ?Text;
        };
    };

    /// Action returned by the Conductor to tell the engine what to do next.
    /// Intentionally simple — all shared types, safe for async return.
    /// Tasks are started via engine.setPendingTask(), not via this return value.
    public type ConductorAction = {
        /// Schedule next conductor tick in N seconds.
        /// Use 0 for immediate (doing work), 10+ for polling (waiting for task).
        #ContinueIn: Nat;
        /// Chore completed successfully.
        #Done;
        /// Chore failed with error message.
        #Error: Text;
    };

    // ============================================
    // CHORE DEFINITION (registered by bot)
    // ============================================

    /// Definition of a chore type, provided by the bot at registration time.
    /// The `conduct` callback is a closure — transient, re-registered on every canister start.
    /// Multiple instances of the same type can be created (e.g., multiple trade chores).
    ///
    /// To start tasks, the conductor calls engine.setPendingTask(choreId, taskId, taskFn)
    /// before returning (choreId is the instance ID). No createTask callback is needed.
    public type ChoreDefinition = {
        /// Unique identifier for this chore type (e.g., "distribute-funds").
        id: Text;
        /// Human-readable name (e.g., "Refresh Voting Power").
        name: Text;
        /// Description of what this chore does.
        description: Text;
        /// Default schedule interval in seconds (used when first registered).
        defaultIntervalSeconds: Nat;
        /// Default max interval in seconds (null = no range, use exact interval).
        /// When set, each reschedule picks a random time in [defaultIntervalSeconds, defaultMaxIntervalSeconds].
        defaultMaxIntervalSeconds: ?Nat;
        /// Default task timeout in seconds (used when first registered).
        /// Timed-out tasks are marked as failed and the conductor can recover.
        defaultTaskTimeoutSeconds: Nat;
        /// The conductor function. Called repeatedly by the engine to orchestrate the chore.
        /// Receives context about the current run (including task state) and returns an action
        /// telling the engine when to call it again (or that it's done/failed).
        /// To start a task, call engine.setPendingTask() before returning.
        conduct: (ConductorContext) -> async ConductorAction;
    };

    // ============================================
    // STATUS TYPES (for admin queries)
    // ============================================

    /// Status of the Scheduler timer.
    public type SchedulerStatus = {
        #Idle;      // No timer set
        #Scheduled; // Timer set, waiting to fire
    };

    /// Status of the Conductor.
    public type ConductorStatus = {
        #Idle;      // Not running
        #Running;   // Actively executing conductor logic (no task running)
        #Polling;   // Waiting for a task to complete, checking periodically
    };

    /// Status of the current Task.
    public type TaskStatus = {
        #Idle;      // No task running
        #Running;   // A task is actively executing
    };

    /// Complete status snapshot of a chore instance (for admin display).
    public type ChoreStatus = {
        choreId: Text;          // Instance ID (unique per instance)
        choreTypeId: Text;      // Type ID (references ChoreDefinition.id — same for all instances of a type)
        choreName: Text;        // Type name (from ChoreDefinition)
        choreDescription: Text; // Type description (from ChoreDefinition)
        instanceLabel: Text;    // Instance label (user-facing, e.g., "ETH Trade #1")
        enabled: Bool;
        paused: Bool;
        intervalSeconds: Nat;
        maxIntervalSeconds: ?Nat;
        taskTimeoutSeconds: Nat;

        // Scheduler
        schedulerStatus: SchedulerStatus;
        nextScheduledRunAt: ?Int;
        lastCompletedRunAt: ?Int;

        // Conductor
        conductorStatus: ConductorStatus;
        conductorStartedAt: ?Int;
        conductorInvocationCount: Nat;

        // Task
        currentTaskId: ?Text;
        taskStatus: TaskStatus;
        taskStartedAt: ?Int;
        lastCompletedTaskId: ?Text;
        lastTaskSucceeded: ?Bool;
        lastTaskError: ?Text;

        // Control
        stopRequested: Bool;

        // Statistics
        totalRunCount: Nat;
        totalSuccessCount: Nat;
        totalFailureCount: Nat;
        lastError: ?Text;
        lastErrorAt: ?Int;
    };

    // ============================================
    // MULTI-INSTANCE SUPPORT
    // ============================================

    /// Information about a chore instance. Each instance references a chore type
    /// (by typeId) and has a user-facing label. Multiple instances of the same type
    /// can coexist (e.g., multiple "trade" chores with different configs).
    ///
    /// For single-instance chores (the common case), the instanceId equals the typeId
    /// and the label equals the type name.
    public type ChoreInstanceInfo = {
        typeId: Text;           // References ChoreDefinition.id
        instanceLabel: Text;    // User-facing name for this instance (e.g., "ETH Trade #1")
    };

    // ============================================
    // STATE ACCESSOR (bridge to bot's stable vars)
    // ============================================

    /// Interface for the engine to read/write the bot's stable chore state.
    /// The bot provides getter/setter functions that close over its stable vars.
    public type StateAccessor = {
        getConfigs: () -> [(Text, ChoreConfig)];
        setConfigs: ([(Text, ChoreConfig)]) -> ();
        getStates: () -> [(Text, ChoreRuntimeState)];
        setStates: ([(Text, ChoreRuntimeState)]) -> ();
        getInstances: () -> [(Text, ChoreInstanceInfo)];
        setInstances: ([(Text, ChoreInstanceInfo)]) -> ();
    };

};
