/// Reusable types for the Bot Chores system.
///
/// Bot Chores are automated, recurring tasks that bot canisters execute on a schedule
/// using IC Timers. This module defines the shared types used by all bots.
///
/// The system uses a three-level timer hierarchy:
///   - Scheduler (Level 1): Fires on a recurring schedule, starts the Conductor.
///   - Conductor (Level 2): Orchestrates the chore by running Tasks in sequence.
///   - Task (Level 3): Performs actual work in instruction-limit-safe chunks.
///
/// Each bot provides its own chore definitions (conductor callbacks, task logic)
/// while the BotChoreEngine handles all timer management, state tracking,
/// upgrade resilience, and admin controls.
module {

    // ============================================
    // CONFIGURATION (admin-settable, stable)
    // ============================================

    /// Per-chore configuration. Stored in stable memory, settable by admins.
    public type ChoreConfig = {
        enabled: Bool;          // Whether the scheduler should fire
        intervalSeconds: Nat;   // How often the scheduler fires (in seconds)
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
        conductorActive: Bool;          // true if conductor is running or waiting for task
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
    public type TaskAction = {
        #Continue;      // More work to do — re-invoke via 0-second timer
        #Done;          // Task completed successfully
        #Error: Text;   // Task failed with error message
    };

    /// Result of a completed task, as reported to the Conductor.
    public type TaskCompletionResult = {
        #Completed;
        #Failed: Text;
    };

    /// Context passed to the Conductor on each invocation.
    public type ConductorContext = {
        /// How many times the conductor has been invoked in this run.
        /// 0 on first invocation, increments each time.
        invocationCount: Nat;

        /// Result of the last completed task, if any.
        /// null on first invocation or after upgrade resume.
        lastCompletedTask: ?{
            taskId: Text;
            result: TaskCompletionResult;
        };
    };

    /// Action returned by the Conductor to tell the engine what to do next.
    /// This type must be shared (usable with `async`) so it cannot contain functions.
    /// Task functions are provided separately via `ChoreDefinition.createTask`.
    public type ConductorAction = {
        /// Start a new Task. The engine will call `createTask(taskId)` from the
        /// ChoreDefinition to get the task function, then run it via 0-second timers.
        /// Re-invokes the conductor when the task completes.
        #StartTask: { taskId: Text };
        /// Re-invoke the conductor immediately (0-second timer).
        /// Use when the conductor needs to do more work without starting a task.
        #Continue;
        /// Re-invoke the conductor after a delay (in seconds).
        /// Use to avoid overwhelming external canisters.
        #ContinueIn: { seconds: Nat };
        /// Chore completed successfully.
        #Done;
        /// Chore failed with error message.
        #Error: Text;
    };

    // ============================================
    // CHORE DEFINITION (registered by bot)
    // ============================================

    /// Definition of a chore, provided by the bot at registration time.
    /// Both `conduct` and `createTask` are closures — transient, re-registered on every canister start.
    public type ChoreDefinition = {
        /// Unique identifier for this chore (e.g., "refresh-voting-power").
        id: Text;
        /// Human-readable name (e.g., "Refresh Voting Power").
        name: Text;
        /// Description of what this chore does.
        description: Text;
        /// Default schedule interval in seconds (used when first registered).
        defaultIntervalSeconds: Nat;
        /// The conductor function. Called repeatedly by the engine to orchestrate the chore.
        /// Receives context about the current run and returns an action telling the engine
        /// what to do next (start a task, continue, done, or error).
        conduct: (ConductorContext) -> async ConductorAction;
        /// Task factory function. Called by the engine immediately after the conductor
        /// returns `#StartTask({ taskId })` to obtain the actual task function to execute.
        /// The conductor should set up any captured mutable state before returning #StartTask,
        /// and createTask reads that state to build the appropriate task closure.
        /// Returns null if the task ID is unknown.
        createTask: (Text) -> ?(() -> async TaskAction);
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
        #Idle;              // Not running
        #Running;           // Actively executing conductor logic
        #WaitingForTask;    // Waiting for a task to complete
    };

    /// Status of the current Task.
    public type TaskStatus = {
        #Idle;      // No task running
        #Running;   // A task is actively executing
    };

    /// Complete status snapshot of a chore (for admin display).
    public type ChoreStatus = {
        choreId: Text;
        choreName: Text;
        choreDescription: Text;
        enabled: Bool;
        intervalSeconds: Nat;

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
    // STATE ACCESSOR (bridge to bot's stable vars)
    // ============================================

    /// Interface for the engine to read/write the bot's stable chore state.
    /// The bot provides getter/setter functions that close over its stable vars.
    public type StateAccessor = {
        getConfigs: () -> [(Text, ChoreConfig)];
        setConfigs: ([(Text, ChoreConfig)]) -> ();
        getStates: () -> [(Text, ChoreRuntimeState)];
        setStates: ([(Text, ChoreRuntimeState)]) -> ();
    };

};
