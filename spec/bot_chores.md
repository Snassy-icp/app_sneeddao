# Bot Chores — Specification & Implementation Plan

## 1. Overview

**Bot Chores** are automated, recurring tasks that bot canisters execute on a schedule using IC Timers. Examples include periodically refreshing neuron voting power, auto-staking maturity, or collecting rewards.

The system is designed as a **reusable framework** that any bot canister can adopt, following the same shared-module pattern established by Botkeys (`BotkeyTypes.mo` / `BotkeyPermissions.mo`).

### Goals

- **Reusable**: Shared types and engine live alongside bot code; each bot provides only its chore-specific logic.
- **Safe**: Long-running work is split across multiple timer invocations to stay within IC instruction limits.
- **Upgrade-resilient**: All timer state is persisted in stable storage so timers resume correctly after canister upgrades.
- **Admin-controllable**: Full visibility into what is running, what is scheduled, and precise controls to start, stop, trigger, and configure chores.
- **Stoppable**: Every self-rescheduling timer checks a stop flag before rescheduling, preventing runaway infinite loops that could drain cycles.
- **Trap-resilient**: Tasks and conductors are decoupled via polling, so a trapped task doesn't leave the conductor permanently stuck.

---

## 2. Timer Hierarchy

The system uses a **three-level timer hierarchy** to safely execute long-running work within IC instruction limits. Each level has a clear name and responsibility:

### 2.1 Scheduler (Level 1)

The **Scheduler** is the outermost timer. It fires on a recurring schedule (e.g., once per week) and its only job is to:

1. Check if the chore's Conductor is already running (skip if so).
2. Start the Conductor.
3. Schedule itself to fire again at the next interval.

The Scheduler is a simple periodic trigger. It does no actual work.

### 2.2 Conductor (Level 2)

The **Conductor** orchestrates the chore's execution. It uses a **polling pattern**:

1. First invocation: Determines what work needs to be done (e.g., queries the list of neurons), starts the first Task, then returns `#ContinueIn(N)` to poll in N seconds.
2. Subsequent polling invocations: Checks if the current Task is still running (`ctx.isTaskRunning`). If yes, returns `#ContinueIn(N)` to poll again. If no, inspects the result (`ctx.lastCompletedTask`), optionally starts the next Task, and polls again.
3. When all Tasks are done: Returns `#Done`.

The Conductor is **decoupled from Tasks**: it does not get notified when a Task completes. Instead, it periodically checks Task state via the `ConductorContext`. This polling model is **trap-resilient** — if a Task traps, it simply stops rescheduling itself, and the Conductor's next poll detects the stale task and can recover.

To start a Task, the Conductor calls `engine.setPendingTask(choreId, taskId, taskFn)` before returning. The engine picks up the pending task after the conductor callback returns and starts it.

### 2.3 Task (Level 3)

A **Task** performs a discrete unit of work within the chore. It:

1. Executes a chunk of work (e.g., refresh voting power for one neuron).
2. Returns `#Continue` to be called again (via 0-second timer) if more work remains.
3. Returns `#Done` when the work is complete, or `#Error` if it failed.

Tasks split their work into instruction-limit-safe chunks by self-rescheduling with 0-second timers. The engine wraps each Task tick for stop-flag checking, error handling, and state tracking — but the Task itself is unaware of the Conductor.

### 2.4 Execution Flow Example: "Refresh Voting Power" (Weekly)

```
Week 1, Monday 00:00:
  [Scheduler] fires → starts Conductor → reschedules for next Monday

  [Conductor] tick 0 (isTaskRunning=false, lastCompletedTask=null):
    - Queries governance for all managed neurons → finds 3 neurons
    - Calls engine.setPendingTask("refresh-voting-power", "refresh-0", taskFn)
    - Returns #ContinueIn(10) — poll in 10 seconds

  [Engine] picks up pending task → starts Task "refresh-0"

  [Task "refresh-0"] tick 0:
    - Calls refreshVotingPower for neuron 0
    - Returns #Done → engine marks task complete

  10 seconds later...

  [Conductor] tick 1 (isTaskRunning=false, lastCompletedTask=("refresh-0", true)):
    - Last task succeeded, advance to next neuron
    - Calls engine.setPendingTask("refresh-voting-power", "refresh-1", taskFn)
    - Returns #ContinueIn(10)

  [Task "refresh-1"] ... → #Done

  [Conductor] tick 2:
    - Starts "refresh-2"
    - Returns #ContinueIn(10)

  [Task "refresh-2"] ... → #Done

  [Conductor] tick 3:
    - All neurons processed
    - Returns #Done → chore marked complete

Week 2, Monday 00:00:
  [Scheduler] fires again → cycle repeats
```

---

## 3. Architecture & Reusability

### 3.1 File Layout

Following the Botkey pattern, shared modules live in `src/` (one level above bot directories):

```
src/
├── BotChoreTypes.mo              # Shared types (like BotkeyTypes.mo)
├── BotChoreEngine.mo             # Reusable engine (like BotkeyPermissions.mo)
├── BotkeyTypes.mo                # (existing)
├── BotkeyPermissions.mo          # (existing)
└── sneed_icp_neuron_manager/
    ├── neuron_manager_canister.mo  # Bot actor — integrates chore engine
    └── Types.mo                    # Bot types — adds chore permissions
```

### 3.2 What's Shared vs Bot-Specific

| Component | Shared (Framework) | Bot-Specific |
|-----------|-------------------|--------------|
| Types | `ChoreConfig`, `ChoreRuntimeState`, `ConductorContext`, `ConductorAction`, `TaskAction`, `ChoreStatus` | Chore definitions (IDs, names, conduct functions) |
| Engine | Timer management, state tracking, stop logic, upgrade resume, admin queries, task loop, task timeout | — |
| State vars | — | `var choreConfigs`, `var choreStates` (in bot actor) |
| Chore logic | — | Conductor callbacks, Task execute functions |
| API methods | — | Canister endpoints (with permission checks) |

### 3.3 Integration Pattern

Each bot:

1. Declares stable vars for chore config and runtime state.
2. Creates a `transient let choreEngine` (re-created on every canister start).
3. Registers chore definitions with the engine (providing conductor callbacks).
4. Calls `choreEngine.resumeTimers<system>()` on init and after upgrade.
5. Exposes admin API methods that delegate to the engine.

---

## 4. Data Types

### 4.1 ChoreConfig (Admin-Settable, Stable)

```motoko
type ChoreConfig = {
    enabled: Bool;              // Whether the scheduler should fire
    intervalSeconds: Nat;       // How often the scheduler fires
    taskTimeoutSeconds: Nat;    // Max seconds a task can run before considered dead
};
```

### 4.2 ChoreRuntimeState (Internal Tracking, Stable)

```motoko
type ChoreRuntimeState = {
    // Scheduler
    schedulerTimerId: ?Nat;
    nextScheduledRunAt: ?Int;       // Timestamp (nanoseconds) for next scheduled fire
    lastCompletedRunAt: ?Int;       // Timestamp of last successful chore completion

    // Conductor
    conductorActive: Bool;          // true if conductor is running or polling
    conductorTimerId: ?Nat;
    conductorStartedAt: ?Int;
    conductorInvocationCount: Nat;

    // Current Task
    currentTaskId: ?Text;
    taskActive: Bool;
    taskTimerId: ?Nat;
    taskStartedAt: ?Int;
    lastCompletedTaskId: ?Text;
    lastTaskSucceeded: ?Bool;
    lastTaskError: ?Text;

    // Control
    stopRequested: Bool;            // Emergency stop flag

    // Statistics
    totalRunCount: Nat;             // Number of completed chore runs
    totalSuccessCount: Nat;
    totalFailureCount: Nat;
    lastError: ?Text;
    lastErrorAt: ?Int;
};
```

### 4.3 Callback Types

```motoko
// Action returned by the Conductor to tell the engine what to do next.
// Intentionally simple — tasks are started via engine.setPendingTask(), not via return value.
type ConductorAction = {
    #ContinueIn: Nat;   // Schedule next conductor tick in N seconds (0 = immediately)
    #Done;               // Chore completed successfully
    #Error: Text;        // Chore failed
};

// Context passed to the conductor on each invocation — pure data, no functions.
type ConductorContext = {
    choreId: Text;                  // ID of this chore (for calling engine.setPendingTask)
    invocationCount: Nat;           // How many ticks so far in this run
    isTaskRunning: Bool;            // Is a task currently active?
    lastCompletedTask: ?{           // Result of the most recently completed task
        taskId: Text;
        succeeded: Bool;
        error: ?Text;
    };
};

// Returned by a task to tell the engine what to do next
type TaskAction = {
    #Continue;      // More work to do (0-sec re-invoke)
    #Done;          // Task completed
    #Error: Text;   // Task failed
};
```

### 4.4 ChoreStatus (Query Result)

```motoko
type ChoreStatus = {
    choreId: Text;
    choreName: Text;
    choreDescription: Text;
    enabled: Bool;
    intervalSeconds: Nat;
    taskTimeoutSeconds: Nat;

    schedulerStatus: { #Idle; #Scheduled };
    nextScheduledRunAt: ?Int;
    lastCompletedRunAt: ?Int;

    conductorStatus: { #Idle; #Running; #Polling };
    conductorStartedAt: ?Int;
    conductorInvocationCount: Nat;

    currentTaskId: ?Text;
    taskStatus: { #Idle; #Running };
    taskStartedAt: ?Int;
    lastCompletedTaskId: ?Text;
    lastTaskSucceeded: ?Bool;
    lastTaskError: ?Text;

    stopRequested: Bool;

    totalRunCount: Nat;
    totalSuccessCount: Nat;
    totalFailureCount: Nat;
    lastError: ?Text;
    lastErrorAt: ?Int;
};
```

### 4.5 ChoreDefinition (Registered by Bot)

```motoko
type ChoreDefinition = {
    id: Text;
    name: Text;
    description: Text;
    defaultIntervalSeconds: Nat;
    defaultTaskTimeoutSeconds: Nat;     // Default: 300 (5 minutes)
    conduct: (ConductorContext) -> async ConductorAction;
};
```

Note: No `createTask` field. Tasks are started by the conductor calling `engine.setPendingTask(choreId, taskId, taskFn)` before returning.

---

## 5. Engine API

### 5.1 Construction & Registration

```motoko
// State accessor — engine reads/writes bot's stable vars through these
type StateAccessor = {
    getConfigs: () -> [(Text, ChoreConfig)];
    setConfigs: ([(Text, ChoreConfig)]) -> ();
    getStates: () -> [(Text, ChoreRuntimeState)];
    setStates: ([(Text, ChoreRuntimeState)]) -> ();
};

let engine = BotChoreEngine.Engine(stateAccessor);
engine.registerChore(myChoreDefinition);
```

### 5.2 Task Management (called by conductor callbacks)

```motoko
// Called by the conductor to request starting a task.
// The engine picks up the pending task after the conductor callback returns.
engine.setPendingTask(choreId, taskId, taskFn)
```

### 5.3 Timer Lifecycle

```motoko
engine.resumeTimers<system>()    // Start/resume schedulers and any interrupted conductors
engine.cancelAllTimers()         // Cancel every active timer (emergency use)
```

### 5.4 Admin Control

```motoko
engine.setEnabled<system>(choreId, true)     // Enable/disable (starts/stops scheduler)
engine.setInterval(choreId, 604800)          // Change schedule interval (seconds)
engine.setTaskTimeout(choreId, 300)          // Change task timeout (seconds)
engine.trigger<system>(choreId)              // Force-run now (starts conductor immediately)
engine.stopChore(choreId)                    // Stop a running chore gracefully
engine.stopAllChores()                       // Stop all running chores
```

### 5.5 Status Queries

```motoko
engine.getStatus(choreId) : ?ChoreStatus
engine.getAllStatuses() : [ChoreStatus]
engine.getConfig(choreId) : ?ChoreConfig
engine.getAllConfigs() : [(Text, ChoreConfig)]
```

---

## 6. Upgrade Resilience

### 6.1 What Survives Upgrades

| Data | Survives? | Notes |
|------|-----------|-------|
| `choreConfigs` | Yes | Stable var in bot actor |
| `choreStates` | Yes | Stable var in bot actor |
| Timer IDs | **No** | Timers are destroyed on upgrade; IDs become stale |
| Chore definitions | **No** | Closures; re-registered on every canister start |
| Task execute functions | **No** | Closures; lost on upgrade |

### 6.2 Resume Strategy (`resumeTimers`)

Called in both the actor body (first deploy) and `postupgrade` (upgrades):

1. **Clear stale timer IDs** in all runtime states (old timers no longer exist).
2. For each registered chore:
   - If **enabled** and has a valid `nextScheduledRunAt`:
     - If in the future → schedule for that time.
     - If in the past → schedule immediately (missed while stopped).
     - If none → schedule for `intervalSeconds` from now.
   - If a **conductor was active** when the upgrade happened:
     - Restart the conductor from the beginning (`invocationCount = 0`).
     - The conductor's captured mutable state is lost, so it starts fresh.
   - Clear task state (task closures are lost; conductor will re-create tasks).

### 6.3 Idempotency Requirement

Since conductors restart from the beginning after an upgrade, **tasks must be idempotent** — running the same task twice must be safe. For most neuron management operations (refresh voting power, stake maturity), this is naturally the case.

---

## 7. Safety: Emergency Stop

### 7.1 The Problem

Self-rescheduling timers (conductors and tasks that return `#Continue`) create chains of timer invocations. A bug that always returns `#Continue` would create an infinite loop that drains the canister's cycles.

### 7.2 Double Safety Mechanism

**Flag check**: Before every re-invocation, the engine checks `stopRequested` in the chore's runtime state. If set, the timer does not reschedule and marks itself as stopped.

**Timer cancellation**: The admin `stopChore` method also calls `Timer.cancelTimer` on any stored timer IDs. This handles the case where a timer is scheduled but hasn't fired yet.

Together, these cover all cases:
- Timer is **waiting to fire** → `cancelTimer` prevents it from running.
- Timer is **currently executing** → the flag prevents it from rescheduling.

### 7.3 Stop Flow

```
Admin calls stopChore("my-chore"):
  1. Set stopRequested = true in runtime state
  2. Cancel scheduler timer ID (if any)
  3. Cancel conductor timer ID (if any)
  4. Cancel task timer ID (if any)
  5. Mark conductor and task as inactive

Next time any timer callback runs (if cancellation missed it):
  → Sees stopRequested = true
  → Does NOT reschedule
  → Marks itself as stopped
  → Clears stopRequested (ready for future runs)
```

---

## 8. Task Timeout

### 8.1 The Problem

If a Task traps (as opposed to throwing), the timer is consumed and the Task stops rescheduling itself. However, the `taskActive` flag in runtime state remains `true` because the state update to clear it was rolled back by the trap.

Without intervention, the Conductor would poll forever, seeing a task that appears to be running but is actually dead.

### 8.2 Solution

The engine checks for timed-out tasks at the start of each Conductor tick. If `taskActive = true` and `taskStartedAt` is older than `taskTimeoutSeconds`, the engine:

1. Cancels the task timer (if it still exists).
2. Marks the task as failed with a "Task timed out" error.
3. Proceeds to call the Conductor with the updated context.

The Conductor then sees the failure in `ctx.lastCompletedTask` and can decide how to proceed (retry, skip, or abort).

### 8.3 Default Timeout

The default task timeout is 300 seconds (5 minutes). This can be configured per-chore via `defaultTaskTimeoutSeconds` in the ChoreDefinition, and changed at runtime via the admin API.

---

## 9. Admin Interface

### 9.1 Running vs Scheduled vs Polling

The admin interface clearly distinguishes between:

- **Running**: A timer callback is actively executing (conductor doing work, task doing work).
- **Polling**: The conductor is periodically checking if a task has finished.
- **Scheduled**: A timer is set and will fire at a specific future time (scheduler waiting for next interval).
- **Idle**: No timer is set and nothing is happening.

These are reflected in `schedulerStatus`, `conductorStatus`, and `taskStatus` fields of `ChoreStatus`.

### 9.2 Bot API Methods

Each bot exposes these canister methods (with permission checks):

```motoko
// Queries
getChoreStatuses() : async [ChoreStatus]
getChoreStatus(choreId: Text) : async ?ChoreStatus

// Admin controls
setChoreEnabled(choreId: Text, enabled: Bool) : async ()
setChoreInterval(choreId: Text, seconds: Nat) : async ()
setChoreTaskTimeout(choreId: Text, seconds: Nat) : async ()
triggerChore(choreId: Text) : async ()
stopChore(choreId: Text) : async ()
stopAllChores() : async ()
```

### 9.3 Permissions

Two new bot-specific permissions are added (following the Botkey pattern):

- `#ManageChores` (ID 18) — Enable/disable, configure, trigger, and stop chores.
- `#ViewChores` (ID 19) — View chore statuses and configurations.

Controllers always have full access.

---

## 10. Implementation Plan

### Phase 1: Core Types (`BotChoreTypes.mo`)
- Define all shared types: `ChoreConfig`, `ChoreRuntimeState`, `ConductorContext`, `ConductorAction`, `TaskAction`, `ChoreStatus`, `ChoreDefinition`, `StateAccessor`.
- Provide `emptyRuntimeState()` helper.

### Phase 2: Engine (`BotChoreEngine.mo`)
- Implement the `Engine` class with:
  - Chore registration
  - `setPendingTask` method for conductor → engine task handoff
  - Scheduler timer management
  - Conductor timer loop with polling pattern and stop-flag checks
  - Task timer loop with stop-flag checks (engine wraps task for infrastructure)
  - Task timeout detection
  - State persistence through accessor
  - `resumeTimers` for upgrade resilience
  - All admin control and query methods

### Phase 3: ICP Staking Bot Integration
- Add `#ManageChores` and `#ViewChores` permissions to `Types.mo`.
- Add stable vars `choreConfigs` and `choreStates` to the actor.
- Instantiate the engine (`transient let`).
- Register the first chore.
- Call `resumeTimers` in body and `postupgrade`.
- Expose admin API methods.

### Phase 4: First Chore — Refresh Voting Power
- **Scheduler**: Weekly (604,800 seconds).
- **Conductor**: Lists all neurons, then for each neuron starts a Task and polls for completion.
- **Task**: Calls `refreshVotingPower` for one neuron. Single-step task (returns `#Done` immediately).

---

## 11. First Chore: Refresh Voting Power

### 11.1 Why This Chore

ICP neurons need periodic voting power refresh to maintain maximum voting power. This chore automates it by calling `RefreshVotingPower` for every neuron managed by the bot canister, once per week.

### 11.2 Conductor Logic (Polling Pattern)

```
Tick 0 (isTaskRunning=false, lastCompletedTask=null):
  → Fetch all neurons from governance
  → If 0 neurons: return #Done
  → Store neuron list in captured mutable var
  → Call engine.setPendingTask(choreId, "refresh-0", taskFn)
  → Return #ContinueIn(10)  // Poll in 10 seconds

Tick N (isTaskRunning=true):
  → Task still running, return #ContinueIn(10)

Tick N (isTaskRunning=false, lastCompletedTask=some result):
  → Increment index
  → If index >= neurons.size(): return #Done
  → Call engine.setPendingTask(choreId, "refresh-N", taskFn)
  → Return #ContinueIn(10)
```

### 11.3 Task Logic

Each task is a single-step operation:

```
Tick 0:
  → Call governance.manage_neuron({ id = ?neuronId, command = ?#RefreshVotingPower({}) })
  → Return #Done (or #Error if it fails)
```

No chunking is needed because each governance call is a single inter-canister message that fits within instruction limits.

---

## Appendix: Naming Rationale

| Level | Name | Why |
|-------|------|-----|
| 1 | **Scheduler** | Universally understood — it schedules recurring events on a timetable. |
| 2 | **Conductor** | Evokes orchestration — like a musical conductor directing an ensemble of tasks. Distinctive enough to avoid confusion with generic programming terms. |
| 3 | **Task** | Clear and simple — the unit of actual work being performed. |
