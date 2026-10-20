# Bot Chores — Specification & Implementation Plan

> **Status (2026-10-20): built.** The framework (`src/sneed_bots/BotChoreTypes.mo`, `src/sneed_bots/BotChoreEngine.mo`) is used by the ICP Staking Bot (`src/sneed_bots/sneed_icp_staking_bot/main.mo`: confirm-following, refresh-stake, collect-maturity, distribute-funds) and the trading bot (`src/sneed_bots/sneed_trading_bot/main.mo`: trade, rebalance, move-funds, distribute-funds, snapshot — see `spec/trading_bot.md`). Botlog (end of this file) is built too. The "Refresh Voting Power" chore used as the worked example below was never built as a chore; voting power stays fresh through the confirm-following chore and the manual `refreshVotingPower` method.

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

**Interval Randomization**: If `maxIntervalSeconds` is set in the chore config and is greater than `intervalSeconds`, the scheduler picks a random time within `[intervalSeconds, maxIntervalSeconds]` each time it reschedules. The randomization uses `Time.now()` nanosecond timestamp as entropy source. This is useful for bots where perfectly regular scheduling is undesirable (e.g. trading bots that should vary the timing of their actions).

### 2.2 Conductor (Level 2)

The **Conductor** orchestrates the chore's execution. It uses a **polling pattern**:

1. First invocation: Determines what work needs to be done (e.g., queries the list of neurons), starts the first Task, then returns `#ContinueIn(N)` to poll in N seconds.
2. Subsequent polling invocations: Checks if the current Task is still running (`ctx.isTaskRunning`). If yes, returns `#ContinueIn(N)` to poll again. If no, inspects the result (`ctx.lastCompletedTask`), optionally starts the next Task, and polls again.
3. When all Tasks are done: Returns `#Done`.

The Conductor is **decoupled from Tasks**: it does not get notified when a Task completes. Instead, it periodically checks Task state via the `ConductorContext`. This polling model is **trap-resilient** — if a Task traps, it simply stops rescheduling itself, and the Conductor's next poll detects the stale task and can recover.

To start a Task, the Conductor calls `engine.setPendingTask(choreId, taskId, taskFn)` before returning. The engine picks up the pending task after the conductor callback returns and starts it.

**Tick cadence (as built)**: the engine is *schedule-first*. At the start of every conductor tick it arms the next tick as a heartbeat — 5 seconds when no task is running, 10 seconds while one is — and only then calls the conductor. The `N` in `#ContinueIn(N)` is **ignored**; `#ContinueIn` just means "keep going". When a task completes, the engine also schedules an immediate (0-second) conductor tick, so the conductor normally reacts at once rather than at the next poll. Each scheduled tick carries a sequence number and an in-flight guard, so superseded or overlapping ticks drop themselves.

Changed from the original plan: the conductor no longer chooses its polling delay; `#ContinueIn(N)` is kept in the type for compatibility but the delay is fixed by the engine.

Because the conductor is synchronous (see 4.6), any inter-canister work — including the initial "list the neurons" step — must itself run as a task. The staking bot's chores therefore start with a fetch task (`cf-fetch-neurons`, `rs-fetch-neurons`, `cm-fetch-neurons`) and only then start one task per neuron.

### 2.3 Task (Level 3)

A **Task** performs a discrete unit of work within the chore. It:

1. Executes a chunk of work (e.g., refresh voting power for one neuron).
2. Returns `#Continue` to be called again (via 0-second timer) if more work remains.
3. Returns `#Done` when the work is complete, or `#Error` if it failed.

Tasks split their work into instruction-limit-safe chunks by self-rescheduling with 0-second timers. The engine wraps each Task tick for stop-flag checking, error handling, and state tracking — but the Task itself is unaware of the Conductor.

### 2.4 Execution Flow Example: "Refresh Voting Power" (Weekly)

*(Illustrative only — this chore was not built, and the example predates the synchronous conductor: in the real engine "Queries governance" would be a fetch task, and the 10-second polls are engine heartbeats plus an immediate re-tick on task completion.)*

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

Following the Botkey pattern, shared modules live in `src/sneed_bots/` (one level above bot directories):

```
src/sneed_bots/
├── BotChoreTypes.mo              # Shared types (like BotkeyTypes.mo)
├── BotChoreEngine.mo             # Reusable engine (like BotkeyPermissions.mo)
├── BotkeyTypes.mo                # (existing)
├── BotkeyPermissions.mo          # (existing)
├── BotLogTypes.mo / BotLogEngine.mo      # Botlog (see end of file)
├── BotEventTypes.mo / BotEventEngine.mo  # Bot events (chore lifecycle events, reactions)
├── DistributionTypes.mo          # Shared distribution-list types
├── sneed_icp_staking_bot/
│   ├── main.mo                   # Bot actor — integrates chore engine
│   └── Types.mo                  # Bot types — adds chore permissions
└── sneed_trading_bot/
    ├── main.mo
    └── Types.mo
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
    enabled: Bool;              // true = started (Running or Paused), false = Stopped
    paused: Bool;               // true = Paused (schedule preserved), false = Running or Stopped
    intervalSeconds: Nat;       // How often the scheduler fires (minimum interval)
    maxIntervalSeconds: ?Nat;   // Optional max interval — when set, scheduler picks a random
                                // time in [intervalSeconds, maxIntervalSeconds] each time it reschedules.
                                // Useful for bots where perfectly regular scheduling is undesirable
                                // (e.g. trading bots that should vary timing).
                                // When null, exact intervalSeconds is used.
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

### 4.4 ChoreInstanceInfo (Multi-Instance Support, Stable)

```motoko
type ChoreInstanceInfo = {
    typeId: Text;          // References ChoreDefinition.id
    instanceLabel: Text;   // User-facing name (e.g., "ETH Trade #1")
};

// Returned by engine.listChoreTypes() / the bot's getChoreTypes(), so the UI can offer
// types that have no instance yet.
type ChoreTypeInfo = {
    id: Text;
    name: Text;
    description: Text;
    defaultIntervalSeconds: Nat;
    defaultMaxIntervalSeconds: ?Nat;
    instanceCount: Nat;
};
```

The engine supports **multiple instances of the same chore type**. Each instance has a unique `instanceId` (used throughout as the `choreId`), a `typeId` referencing its `ChoreDefinition`, and an `instanceLabel` for display. For single-instance chores, the `instanceId` equals the `typeId` and the `label` equals the type name.

Instances are stored in a stable map: `[(Text, ChoreInstanceInfo)]` where the key is the `instanceId`.

### 4.5 ChoreStatus (Query Result)

```motoko
type ChoreStatus = {
    choreId: Text;          // Instance ID
    choreTypeId: Text;      // Type ID (from ChoreDefinition)
    choreName: Text;        // Type name (from ChoreDefinition)
    choreDescription: Text; // Type description
    instanceLabel: Text;    // Instance label (user-facing)
    enabled: Bool;
    paused: Bool;
    intervalSeconds: Nat;
    maxIntervalSeconds: ?Nat;
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

### 4.6 ChoreDefinition (Registered by Bot)

```motoko
type ChoreDefinition = {
    id: Text;                       // Type ID (e.g., "distribute-funds")
    name: Text;
    description: Text;
    defaultIntervalSeconds: Nat;
    defaultMaxIntervalSeconds: ?Nat;
    defaultTaskTimeoutSeconds: Nat;  // Default: 300 (5 minutes)
    conduct: (ConductorContext) -> ConductorAction;   // synchronous
};
```

Changed from the original plan: `conduct` is synchronous (no `async`). It must stay lightweight; any inter-canister call belongs in a task.

Note: No `createTask` field. Tasks are started by the conductor calling `engine.setPendingTask(choreId, taskId, taskFn)` before returning. The `choreId` in the conductor context is the **instance ID**, so the conductor can use it to look up instance-specific configuration.

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
    getInstances: () -> [(Text, ChoreInstanceInfo)];
    setInstances: ([(Text, ChoreInstanceInfo)]) -> ();
    // Optional log sink: (level, source = "chore:<choreId>", message, tags).
    // ChoreLogLevel = { #Trace; #Debug; #Info; #Warning; #Error }
    log: ?((ChoreLogLevel, Text, Text, [(Text, Text)]) -> ());
};

let engine = BotChoreEngine.Engine(stateAccessor);

// Optional: run lifecycle callback (choreId, eventType, errorMsg).
// The engine emits "completed" and "failed"; bots turn these into
// ChoreRunCompleted / ChoreRunFailed bot events.
engine.setOnRunLifecycle(func(choreId, eventType, err) { ... });

// Option A: Single-instance (backward compatible) — registers type + auto-creates one instance
engine.registerChore(myChoreDefinition);

// Option B: Multi-instance — register type template, then create instances dynamically
engine.registerChoreType(myChoreDefinition);
engine.createInstance("trade", "trade-1", "ETH Trade");
engine.createInstance("trade", "trade-2", "BTC Trade");
```

### 5.1.1 Instance Management

```motoko
engine.createInstance(typeId, instanceId, label) : Bool  // Create a new instance (false if type unknown or id taken); config starts Stopped with the type's defaults
engine.deleteInstance(instanceId) : Bool                  // Delete (false if not found or still enabled); removes its config and runtime state
engine.renameInstance(instanceId, newLabel) : Bool        // Rename label
engine.listInstances(?typeId) : [(Text, ChoreInstanceInfo)]  // List instances
engine.getInstance(instanceId) : ?ChoreInstanceInfo      // Get instance info
engine.listChoreTypes() : [ChoreTypeInfo]                // Registered types with instance counts
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

### 5.4 Chore Lifecycle

Chores have three states: **Stopped**, **Running**, and **Paused**.

```
  ┌─────────┐   start()    ┌─────────┐   pause()   ┌────────┐
  │ Stopped │ ──────────▶ │ Running │ ──────────▶ │ Paused │
  └─────────┘              └─────────┘              └────────┘
       ▲                        │                       │
       │         stop()         │        stop()         │
       └────────────────────────┘                       │
       └────────────────────────────────────────────────┘
                                ▲       resume()        │
                                └───────────────────────┘
```

| Action | From | To | Behavior |
|--------|------|----|----------|
| **Start** | Stopped | Running | Run the chore immediately AND schedule the next run at now + interval. Also accepted from Running or Paused: it un-pauses, clears `stopRequested`, starts the conductor if idle and re-arms the scheduler at now + interval. |
| **Schedule Start** | Stopped | Running | Enable the chore and schedule the first run at a user-specified future time, without running immediately. After the first run, it reschedules normally. |
| **Pause** | Running | Paused | Suspend schedule (cancel scheduler timer) but preserve `nextScheduledRunAt`. Stops conductor/task if active. |
| **Resume** | Paused | Running | Re-activate preserved schedule. If `nextScheduledRunAt` has already passed, run immediately. |
| **Stop** | Running/Paused | Stopped | Cancel everything, clear schedule (`nextScheduledRunAt = null`). Full reset. |
| **Run Now** | Running (idle) | (same) | Manual one-off trigger when the chore is enabled but the conductor is idle. Does not affect the schedule. |
| **Run Once** | Stopped | (same) | Fire the conductor once without enabling the recurring schedule. The chore stays Stopped. Only available when conductor is not already active. |
| **Set next run** | Running/Paused | (same) | `setNextScheduledRun`: replace `nextScheduledRunAt` and re-arm the scheduler (only stored while Paused). Traps if the chore is Stopped. |

Run Now and Run Once are the same engine call, `trigger`. If the conductor is already active it is a no-op — unless the conductor looks stuck (active with neither a pending conductor timer nor a running task, or active for more than 120 seconds), in which case `trigger` logs a warning, cancels the old conductor timer and restarts the run from invocation 0.

`queueStart(choreId)` is a non-`<system>` variant of Start for code paths that cannot create timers (e.g. trading-bot circuit-breaker actions): it sets the config to Running at once and arms the scheduler/conductor on the next conductor tick (or `resumeTimers`).

The `paused` flag is stored in `ChoreConfig` alongside `enabled`:
- `enabled=false, paused=false` → **Stopped**
- `enabled=true, paused=false` → **Running**
- `enabled=true, paused=true` → **Paused**

```motoko
engine.start<system>(choreId)                          // Start: run now + schedule next (Stopped → Running)
engine.scheduleStart<system>(choreId, timestampNanos)  // Schedule Start: enable + arm scheduler at given time (Stopped → Running)
engine.pause(choreId)                                  // Pause: suspend schedule, preserve nextScheduledRunAt
engine.resume<system>(choreId)                         // Resume: re-activate schedule (Paused → Running)
engine.stop(choreId)                                   // Stop: cancel all, clear schedule (→ Stopped)
engine.trigger<system>(choreId)                        // Run Now / Run Once: manual one-off trigger (does not change enabled/schedule)
engine.queueStart(choreId)                             // Start from non-<system> code (deferred timer arming)
engine.setNextScheduledRun<system>(choreId, timestampNanos) // Move the next run (chore must be enabled)
engine.setInterval(choreId, 604800)                    // Change schedule interval (seconds); applies from the next reschedule
engine.setMaxInterval(choreId, ?1209600)               // Randomization upper bound, or null
engine.setTaskTimeout(choreId, 300)                    // Change task timeout (seconds)
engine.stopAllChores()                                 // Stop all chore instances
```

A chore with no stored config is treated as Stopped with `intervalSeconds = 3600`, `taskTimeoutSeconds = 300`; in practice every instance gets a config from its type's defaults when it is created.

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

1. **Clear stale timer IDs** in all runtime states (old timers no longer exist), and process any queued starts (`queueStart`).
2. For each chore **instance** (paused instances are left alone until resumed):
   - If **enabled and not paused**, arm the scheduler from `nextScheduledRunAt`:
     - If in the future → schedule for that time.
     - If in the past → fire after a 1-second grace period (missed while stopped).
     - If none → schedule for `computeInterval(config)` from now (respecting randomization if configured).
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
  1. Set enabled = false, paused = false
  2. Cancel scheduler timer ID (if any); clear nextScheduledRunAt
  3. If the conductor was active:
     a. Cancel conductor timer ID (if any)
     b. Cancel task timer ID (if any)
     c. Set stopRequested = true, mark conductor and task inactive, drop any pending task

Next time any timer callback runs (if cancellation missed it):
  → Sees stopRequested = true (or the task no longer active)
  → Does NOT reschedule
  → Marks itself as stopped
  → Clears stopRequested (ready for future runs)
```

`pauseChore` does the same to a running conductor/task but keeps `nextScheduledRunAt`. A leftover `stopRequested` is also cleared by the next start, schedule-start, resume or trigger. `cancelAllTimers()` cancels every timer and marks conductors/tasks inactive without touching configs.

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

When the conductor returns `#Done` or `#Error` while a task is still running, the engine cancels that task's timer and marks it inactive. A task that throws (rather than traps) is caught and recorded as failed (`"Task threw: …"`); a conductor that throws ends the run as failed.

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
// Queries (all `shared query`, ViewChores)
getChoreStatuses() : async [ChoreStatus]
getChoreStatus(choreId: Text) : async ?ChoreStatus
getChoreTypes() : async [ChoreTypeInfo]
getChoreConfigs() : async [(Text, ChoreConfig)]
listChoreInstances(typeIdFilter: ?Text) : async [(Text, ChoreInstanceInfo)]

// Instance management (multi-instance support)
createChoreInstance(typeId: Text, instanceId: Text, instanceLabel: Text) : async Bool
deleteChoreInstance(instanceId: Text) : async Bool
renameChoreInstance(instanceId: Text, newLabel: Text) : async Bool

// Admin controls (choreId = instanceId)
startChore(choreId: Text) : async ()                                  // Start: run immediately + schedule next
scheduleStartChore(choreId: Text, timestampNanos: Int) : async ()     // Schedule Start: enable + first run at given time
pauseChore(choreId: Text) : async ()                                  // Pause: suspend schedule
resumeChore(choreId: Text) : async ()                                 // Resume: re-activate schedule
stopChore(choreId: Text) : async ()                                   // Stop: cancel all, clear schedule
stopAllChores() : async ()                                            // Stop all chore instances
triggerChore(choreId: Text) : async ()                                // Run Now / Run Once: manual trigger
setChoreInterval(choreId: Text, seconds: Nat) : async ()
setChoreMaxInterval(choreId: Text, seconds: ?Nat) : async ()
setChoreTaskTimeout(choreId: Text, seconds: Nat) : async ()
setChoreNextRun(choreId: Text, timestampNanos: Int) : async ()        // Set exact next scheduled run time
```

### 9.3 Permissions

As built:

- `#ViewChores` is a **shared base permission, ID 2** (`BotkeyTypes.BasePermission.ViewChores`) — view chore statuses, types, configs, instances and per-instance chore settings.
- There is **no single `#ManageChores`**. Each chore *type* has its own manage permission, resolved from the instance's `typeId`. In the ICP Staking Bot (range 100–199): `ManageConfirmFollowing` (117), `ManageRefreshStake` (118), `ManageCollectMaturity` (119), `ManageDistributeFunds` (120). These gate start/stop/pause/resume/trigger/interval/timeout/next-run and create/delete/rename of that type's instances. An unknown type traps.
- Chore *settings* have separate permissions: `ConfigureCollectMaturity` (121), `ConfigureDistribution` (122).
- `stopAllChores()` requires all four staking-bot manage permissions.
- The trading bot defines its own per-type manage permissions in its range (see `spec/trading_bot.md`).

Controllers and holders of `FullPermissions` (0) always have full access.

Changed from the original plan: one coarse `#ManageChores` (18) / `#ViewChores` (19) pair became a shared `ViewChores` (2) plus per-chore-type manage permissions, so a botkey can be allowed to run one chore without the others.

---

## 10. Implementation Plan

*Status (2026-10-20): Phases 1–3 built. Phase 4 (Refresh Voting Power chore) was not built; the staking bot shipped confirm-following, refresh-stake, collect-maturity and distribute-funds instead (see "ICP Staking Bot — Implemented Chores"). Phase 3's `#ManageChores` became per-type permissions (9.3).*

### Phase 1: Core Types (`BotChoreTypes.mo`)
- Define all shared types: `ChoreConfig`, `ChoreRuntimeState`, `ChoreInstanceInfo`, `ConductorContext`, `ConductorAction`, `TaskAction`, `ChoreStatus`, `ChoreDefinition`, `StateAccessor`.
- Provide `emptyRuntimeState()` helper.

### Phase 2: Engine (`BotChoreEngine.mo`)
- Implement the `Engine` class with:
  - Chore type registration (`registerChoreType`) and backward-compat wrapper (`registerChore`)
  - Instance management (`createInstance`, `deleteInstance`, `renameInstance`, `listInstances`)
  - `setPendingTask` method for conductor → engine task handoff
  - Scheduler timer management
  - Conductor timer loop with polling pattern and stop-flag checks
  - Task timer loop with stop-flag checks (engine wraps task for infrastructure)
  - Task timeout detection
  - State persistence through accessor (configs, states, instances)
  - `resumeTimers` for upgrade resilience (iterates over instances, not definitions)
  - All admin control and query methods

### Phase 3: ICP Staking Bot Integration
- Add `#ManageChores` and `#ViewChores` permissions to `Types.mo`.
- Add stable vars `choreConfigs`, `choreStates`, and `choreInstances` to the actor.
- Instantiate the engine (`transient let`) with full `StateAccessor` including instance accessors.
- Register chores using `registerChore` (backward-compat single-instance mode).
- Call `resumeTimers` in body and `postupgrade`.
- Expose admin API methods, including instance management endpoints.

### Phase 4: First Chore — Refresh Voting Power
- **Scheduler**: Weekly (604,800 seconds).
- **Conductor**: Lists all neurons, then for each neuron starts a Task and polls for completion.
- **Task**: Calls `refreshVotingPower` for one neuron. Single-step task (returns `#Done` immediately).

---

## 11. First Chore: Refresh Voting Power

*Status (2026-10-20): planned, not built.*

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

## Status Indicator (Lamp) System

Bot Chores use a **status lamp** system to give users an at-a-glance understanding of chore health. This is a reusable UI pattern that should be adopted by all bot products.

### Lamp States

Each timer level (Scheduler, Conductor, Task) is represented by a small colored circle ("lamp"):

| State | Color | Animation | Meaning |
|-------|-------|-----------|---------|
| **Off** | Gray (#6b7280) | None | Timer not running, not scheduled |
| **OK** | Green (#22c55e) | Steady | Scheduled, healthy, waiting to fire |
| **Active** | Green (#22c55e) | Pulsing glow | Currently executing |
| **Overdue** | Amber (#f59e0b) | None | Should be running/scheduled but hasn't fired in too long (code constant `LAMP_WARN`, label "Attention needed") |
| **Error** | Red (#ef4444) | None | Stop requested, or last operation failed |
| **Circuit breaker** | Orange (#e67e22) | Pulsing | Chore was stopped or paused by a trading-bot circuit-breaker rule (`LAMP_CB`) |

### Per-Timer State Derivation

**Scheduler:**
- **Off**: Chore is stopped or paused.
- **Circuit breaker**: Stopped or paused, and a recent circuit-breaker event names this chore.
- **OK**: Enabled and scheduled (timer set, waiting to fire). Also shown when the conductor is actively running (scheduler has done its job).
- **Overdue**: Enabled but (a) `lastCompletedRunAt` is more than 3× the interval ago, (b) `nextScheduledRunAt` has passed by more than 5 minutes, (c) enabled and idle with no conductor active (timer missing), or (d) for `confirm-following`, the next run falls after the NNS 6-month (182-day) followee-confirmation deadline, or the interval itself exceeds it.
- **Error**: `stopRequested` is true.

**Conductor:**
- **Off**: Idle (not running).
- **Active**: Running or polling for task completion.
- **Overdue**: Active but running for more than 60 minutes (stale conductor).
- **Error**: `stopRequested` while conductor is active.

**Task:**
- **Off**: No task running (idle). If last task succeeded or no task has run yet.
- **Active**: Task is currently executing within its timeout.
- **Overdue**: Task is running but has exceeded `taskTimeoutSeconds` (stale/hung task).
- **Error**: Last task failed (`lastTaskSucceeded` is false).

### Summary Rollup

Summary lamps aggregate multiple timer or chore lamps using **worst-wins** priority:

```
Error > Circuit breaker > Overdue > Active > OK > Off
```

- **Chore summary** = worst of (Scheduler, Conductor, Task) for that chore.
- **All-chores summary** = worst of all chore summaries.

### Lamp Placement Hierarchy

Lamps appear at multiple levels of the UI, from most detailed to most summarized:

1. **Timer cards** (inside a chore's status panel): One lamp per timer level (Scheduler, Conductor, Task), shown inline with the status label.
2. **Chore sub-tabs**: A summary lamp per chore, shown in each chore's tab button.
3. **Chores tab button**: An all-chores summary lamp in the "Chores" tab selector.
4. **Bot card header** (always visible): Per-chore summary lamps as a compact group, visible even when the Bot section is collapsed.
5. **Page banner**: An all-chores summary with text label (e.g. "Chores: Active", "Chores: Error"), shown next to the bot version badge.

This hierarchy allows users to:
- See overall health at a glance (levels 4–5)
- Drill down to identify which chore has an issue (level 2–3)
- Pinpoint which timer level is problematic (level 1)

### Reusability Notes

The lamp system is implemented in the shared module `src/app_sneeddao_frontend/src/components/ChoreStatusLamp.jsx` (used by both the staking bot and the trading bot pages, `BotManagementPanel` and `BotChoreHealthDialog`):
- **Pure functions** (`getSchedulerLampState(chore, cbEvents)`, `getConductorLampState`, `getTaskLampState`, `getChoreSummaryLamp(chore, cbEvents)`, `getAllChoresSummaryLamp(statuses, cbEvents)`, `summarizeLampStates`, `getSummaryLabel`) that take `ChoreStatus` data (plus optional circuit-breaker events) and return `{ state, label }` or a state.
- A **`StatusLamp` React component** (default export) that renders a colored circle with optional pulse animation, tooltip, and text label.
- **Constants** (`LAMP_OFF`, `LAMP_OK`, `LAMP_ACTIVE`, `LAMP_WARN`, `LAMP_ERROR`, `LAMP_CB`), color map (`LAMP_COLORS`), labels (`LAMP_LABELS`) and per-chore hard deadlines (`CHORE_DEADLINES`).

The state derivation functions operate on `ChoreStatus` data from the backend; the only bot-specific pieces are `CHORE_DEADLINES` and the circuit-breaker events.

---

## ICP Staking Bot — Implemented Chores

The ICP Staking Bot (canister `sneed_icp_staking_bot`, code `src/sneed_bots/sneed_icp_staking_bot/main.mo`; formerly `sneed_icp_neuron_manager`) uses the Bot Chores framework to automate the following recurring tasks. All four are registered with `registerChore` (one default instance each, instanceId = typeId; more instances can be created, each with its own run state, tasks and log source `chore:<instanceId>`), none uses interval randomization, and every run starts with a fetch-neurons task (except distribute-funds, which snapshots its lists in the conductor).

### 1. Confirm Following (`confirm-following`)

- **Purpose**: Re-confirms neuron followees to keep neurons eligible for voting rewards. NNS requires followees to be re-confirmed at least every 6 months.
- **Default interval**: 30 days (monthly, well within the 6-month deadline).
- **Task timeout**: 10 minutes per neuron.
- **Behavior**: For each managed neuron, reads current followees via `get_full_neuron`, then re-applies each topic's followees via `manage_neuron(#Follow)`. The first topic that fails fails the task for that neuron.
- **Chore-specific settings**: None (uses standard interval configuration).
- **Multi-instance**: yes — each instance has its own run state (`_cf_state`, keyed by instanceId, transient) and posts its tasks under its own id. (Known issue fixed 2026-10-20, staking bot 0.9.4: the run state was global and tasks went to the hard-coded id `"confirm-following"`, so a second instance drove the default instance's task slot instead of running.)

### 2. Refresh Stake (`refresh-stake`)

- **Purpose**: Picks up any ICP that was deposited directly to a neuron's governance account. After depositing ICP to a neuron account, `ClaimOrRefresh` must be called for the ICP to count as staked.
- **Default interval**: 1 day.
- **Task timeout**: 5 minutes per neuron.
- **Behavior**: For each managed neuron, calls governance `manage_neuron` with `ClaimOrRefresh { by = NeuronIdOrSubaccount }` and `neuron_id_or_subaccount = NeuronId` (the same path as the manual `refreshStake`).
- **Chore-specific settings**: None.
- **Multi-instance**: yes, as confirm-following (`_rs_state` per instance). (Known issue fixed 2026-10-20, staking bot 0.9.4: the run state was global and tasks were posted to `"refresh-stake"`.)

### 3. Collect Maturity (`collect-maturity`)

- **Purpose**: Periodically collects (disburses) accumulated maturity from all managed neurons and sends it to a configurable account. Maturity accumulates from voting rewards.
- **Default interval**: 7 days (weekly).
- **Task timeout**: 5 minutes per neuron.
- **Behavior**: For each managed neuron:
  1. Reads the full neuron. If it is spawning (`spawn_at_timestamp_seconds` set), skips it.
  2. Reads `maturity_e8s_equivalent`. If a threshold is configured and the maturity is below it, skips the neuron.
  3. If maturity is 0, skips the neuron.
  4. Calls `DisburseMaturity` with 100% percentage, sending to the configured destination, and emits a `MaturityCollected` bot event.
- **Multi-instance**: yes — each instance has its own settings and run state.
- **Chore-specific settings** (per instance, in stable `collectMaturitySettings`, keyed by instanceId):
  - `thresholdE8s: ?Nat64` — Minimum maturity (in e8s) before collection is attempted. `null` = collect any amount.
  - `destination: ?Account` — ICRC-1 account to receive disbursed maturity. `null` = bot's own account (canister principal, no subaccount).
- **API methods**: per-instance, see the list under Distribute Funds below (`getCollectMaturitySettings(instanceId)` needs ViewChores; the setters need `ConfigureCollectMaturity`).

Changed from the original plan: the global `collectMaturityThresholdE8s` / `collectMaturityDestination` settings and their parameterless API became per-instance (see the work log at the end).

### 4. Distribute Funds (`distribute-funds`)

- **Purpose**: Periodically checks configured distribution lists and sends funds from the bot's account (or a subaccount) to target ICRC-1 accounts based on configured percentages. Designed for reusability across multiple bot products.
- **Default interval**: 1 day.
- **Task timeout**: 10 minutes per distribution list.
- **Behavior**: For each distribution list (processed in definition order; a list with no targets is skipped):
  1. Creates a dynamic ledger actor from the list's `tokenLedgerCanisterId`.
  2. Queries `icrc1_fee()` and `icrc1_balance_of()` for the source account — always the bot's main account (canister principal, no subaccount).
  3. If balance < `thresholdAmount`, skips the list.
  4. Calculates the distributable amount by `amountMode`:
     - `1` (percent): `balance × balancePercent / 10000` (null = 100%), capped at `maxDistributionAmount`.
     - `0` (up to the max): min(balance, `maxDistributionAmount`), deterministic; skipped if that is below `minDistributionAmount`. (The trading bot reads mode 0 as a random amount in [min, max]; the staking bot never did — before amount modes it paid min(balance, max), and lists migrated from then have mode 0 with min 0.)
  5. Deducts total transfer fees (one fee per target); skips if nothing is left.
  6. Calculates each target's share based on basis points (see percentage logic below).
  7. Applies hard minimum check: the smallest recipient's share must exceed one tx fee.
  8. Executes `icrc1_transfer` for each target with a non-zero share. Any failed transfer makes the task end in `#Error` (others still go through) and emits `DistributionFailed`; full success emits `DistributionExecuted`.

  Changed from the original plan: the per-list `sourceSubaccount` was replaced by `sourcePurseId` (a trading-bot purse), and "distribute min(balance, max)" became the two `amountMode`s. In the staking bot `sourcePurseId` and each target's `choreInstanceId` are **ignored** — it has no purses, so funds always come from the main account and always go by `icrc1_transfer` to `target.account`.

  Known issues, all fixed 2026-10-20 (staking bot 0.9.4; mode 0 as above, the page sends the current `DistributionListInput` and offers both amount modes, logs and events use the instance id): (a) with `amountMode = 0` and `minDistributionAmount = 0` (what a list gets if those fields are left at zero) the amount is random in [0, min(balance, max)], not the old "min(balance, max)"; (b) the staking bot page (`src/app_sneeddao_frontend/src/pages/IcpNeuronManager.jsx`, distribution list save handler) still sends the old input shape (`sourceSubaccount`, no `amountMode`/`balancePercent`/`minDistributionAmount`/`sourcePurseId`, targets without `choreInstanceId`), which does not match the current `DistributionListInput`, so adding or editing a list from that page should fail at Candid encoding; (c) the task logs under source `chore:distribute-funds` and tags events with `choreId = "distribute-funds"` whatever the instance.

- **Percentage Logic**:
  - Targets with assigned `basisPoints` (0–10000, where 10000 = 100%) get their proportional share.
  - If assigned percentages exceed 100%, they are renormalized (scaled down proportionally). The UI warns about this.
  - Targets with `null` basisPoints evenly split the remainder (100% minus the sum of assigned percentages).
  - If assigned percentages total 100% or more, auto-split targets receive nothing.
  - If no targets have assigned percentages, all targets get equal shares.

- **Hard Minimum**: Regardless of the user-configured threshold, a distribution is skipped entirely if the smallest recipient would receive an amount less than or equal to one transaction fee. This prevents wasteful micro-distributions.

- **Multiple Lists**: Multiple distribution lists can use the same token. They run in definition order. If the first list's distribution leaves sufficient balance above the second list's threshold, the second list runs as well.

- **Shared Types** (`src/sneed_bots/DistributionTypes.mo` — reusable across bots):
  ```motoko
  DistributionTarget = {
      account: Account;         // ICRC-1 account (owner + optional subaccount)
      basisPoints: ?Nat;        // null = auto-split remainder; 0–10000 where 10000 = 100%
      choreInstanceId: ?Text;   // trading bot: credit this chore's purse instead of transferring
  };

  DistributionList = {
      id: Nat;                          // Unique ID (assigned by canister, per instance, from 1)
      name: Text;                       // Human-readable name
      tokenLedgerCanisterId: Principal; // Which ICRC-1 token
      thresholdAmount: Nat;             // Min balance to trigger
      maxDistributionAmount: Nat;       // Cap per round
      targets: [DistributionTarget];
      sourcePurseId: ?Text;             // trading bot: debit this chore's purse; null = main purse
      amountMode: Nat;                  // 0 = staking bot: min(balance, max), skipped below min; trading bot: random in [min, max]. 1 = % of balance (capped by max)
      balancePercent: ?Nat;             // amountMode 1: basis points of balance
      minDistributionAmount: Nat;       // amountMode 0: lower bound
  };

  DistributionListInput = { /* same as DistributionList but without id */ };
  ```

  Upgrade note: a bot still on the pre-0.9.2 list shape must go through the 0.9.2 wasm (which carries the one-off migration) before a later version; upgraded directly, its `distributionSettings` would not decode and would start empty.

- **Stable Variables** (per-instance):
  - `distributionSettings: [(Text, { lists: [DistributionList]; nextListId: Nat })]` — per-instance distribution lists keyed by instanceId.
  - `collectMaturitySettings: [(Text, { thresholdE8s: ?Nat64; destination: ?Account })]` — per-instance collect-maturity settings keyed by instanceId.

- **API Methods** (all take instanceId as first param; the instance id is not checked against the instance registry):
  - `getDistributionLists(instanceId: Text) -> [DistributionList]` (query, ViewChores)
  - `addDistributionList(instanceId: Text, input: DistributionListInput) -> Nat` (ConfigureDistribution)
  - `updateDistributionList(instanceId: Text, id: Nat, input: DistributionListInput)` (ConfigureDistribution)
  - `removeDistributionList(instanceId: Text, id: Nat)` (ConfigureDistribution)
  - `getCollectMaturitySettings(instanceId: Text) -> { thresholdE8s: ?Nat64; destination: ?Account }` (query, ViewChores)
  - `setCollectMaturityThreshold(instanceId: Text, thresholdE8s: ?Nat64)` (ConfigureCollectMaturity)
  - `setCollectMaturityDestination(instanceId: Text, destination: ?Account)` (ConfigureCollectMaturity)

- **Instance Management API**:
  - `createChoreInstance(typeId: Text, instanceId: Text, instanceLabel: Text) -> Bool`
  - `deleteChoreInstance(instanceId: Text) -> Bool`
  - `renameChoreInstance(instanceId: Text, newLabel: Text) -> Bool`
  - `listChoreInstances(typeIdFilter: ?Text) -> [(Text, ChoreInstanceInfo)]`

- **Scheduling API**:
  - `setChoreNextRun(choreId: Text, timestampNanos: Int)` — set the exact next scheduled run time for a chore instance.

- **Frontend**: The "Distribute Funds" chore tab includes a full distribution list management interface:
  - View all lists with token, threshold, max amount, and target summary.
  - Add new lists with a form for all fields including dynamic target rows.
  - Edit existing lists inline.
  - Remove lists with confirmation.
  - Percentage warnings when assigned totals exceed 100%.

---

## Appendix: Naming Rationale

| Level | Name | Why |
|-------|------|-----|
| 1 | **Scheduler** | Universally understood — it schedules recurring events on a timetable. |
| 2 | **Conductor** | Evokes orchestration — like a musical conductor directing an ensemble of tasks. Distinctive enough to avoid confusion with generic programming terms. |
| 3 | **Task** | Clear and simple — the unit of actual work being performed. |

---

## Work Log: Per-Instance Chore Settings Migration

### Verified Complete (backend):
1. **Stable vars** — Global `collectMaturityThresholdE8s`, `collectMaturityDestination`, `distributionLists`, `nextDistributionListId` replaced with per-instance keyed maps: `collectMaturitySettings: [(Text, { thresholdE8s: ?Nat64; destination: ?T.Account })]` and `distributionSettings: [(Text, { lists: [DistributionList]; nextListId: Nat })]`.
2. **Helpers** — `getCmSettings`/`setCmSettings`/`getDistSettings`/`setDistSettings` all take `instanceId` and do upsert logic.
3. **API endpoints** — All collect-maturity and distribution APIs (`getCollectMaturitySettings`, `setCollectMaturityThreshold`, `setCollectMaturityDestination`, `getDistributionLists`, `addDistributionList`, `updateDistributionList`, `removeDistributionList`) accept `instanceId: Text` as first param.
4. **Conductor callbacks** — Both collect-maturity and distribute-funds conductors use `let instanceId = ctx.choreId` and call per-instance helpers.
5. **Transient state** — `_cm_state` and `_df_state` are per-instance `[(Text, {...})]` arrays with `_cm_getState`/`_cm_setState`/`_df_getState`/`_df_setState` helpers. `_cm_startCurrentTask(instanceId)` and `_df_startCurrentTask(instanceId)` both take instanceId and use `choreEngine.setPendingTask(instanceId, ...)`.

### Verified Complete (engine + canister API):
6. **setNextScheduledRun** — `BotChoreEngine.mo` has `setNextScheduledRun<system>(choreId, timestampNanos)`. Canister API has `setChoreNextRun(choreId, timestampNanos)`. Both done.

### Verified Complete (frontend):
7. **Frontend multi-instance** — "+" button for `collect-maturity` and `distribute-funds` types both enabled. Instance create/delete/rename UI working.
8. **Frontend API calls** — All collect-maturity and distribution API calls pass `chore.choreId` as instanceId. Settings are loaded per-instance into `cmSettingsMap` and `distListsMap`. Date/time picker for `setChoreNextRun` added inline next to "Next Scheduled Run" display.
9. **Candid declarations** — `.did`, `.did.js`, `.did.d.ts` updated via `dfx generate` for all changed API signatures.
10. **Spec** — Updated with per-instance settings pattern and `setNextScheduledRun` documentation.

---

## Botlog — Specification & Implementation Plan

### Overview

**Botlog** provides comprehensive activity logging for bot canisters. Every action — user-driven API calls and automated chore activity — is recorded with structured data that can be queried and filtered. The system is reusable across all bot products, following the same shared-module pattern as Botkeys and Bot Chores.

### Architecture

*Status (2026-10-20): built, in both the ICP Staking Bot and the trading bot, with a frontend log viewer.*

```
src/sneed_bots/
  BotLogTypes.mo           # Shared types (LogLevel, LogEntry, LogFilter, LogAlertSummary, etc.)
  BotLogEngine.mo          # Shared engine (Buffer-based, callback pattern)
  BotkeyTypes.mo           # BasePermission gains ViewLogs (3), ManageLogs (4)
  sneed_icp_staking_bot/
    Types.mo               # #ViewLogs, #ManageLogs added to NeuronPermissionType
    main.mo                # Engine integrated, API endpoints, all functions instrumented
```

### Log Levels

| Numeric | Variant    | Description |
|---------|-----------|-------------|
| 0       | `#Off`    | Logging disabled |
| 1       | `#Error`  | Only errors |
| 2       | `#Warning`| Errors + warnings |
| 3       | `#Info`   | Normal operations (**default**) |
| 4       | `#Debug`  | Detailed diagnostics |
| 5       | `#Trace`  | Everything |

Two independent uses:
- **Write-side**: `logLevel` setting controls what the bot actually records.
- **Read-side**: query filter `minLevel` controls what a viewer sees from recorded entries.

### Log Entry

```motoko
type LogEntry = {
    id: Nat;              // Sequential, monotonically increasing, never reused
    timestamp: Int;       // Time.now() nanoseconds
    level: LogLevel;      // #Error | #Warning | #Info | #Debug | #Trace
    source: Text;         // Component: "api", "chore:refresh-stake", "system", "permissions"
    message: Text;        // Human-readable description
    caller: ?Principal;   // Who triggered it (null for system/chore)
    tags: [(Text, Text)]; // Structured key-value pairs for bot-specific data
};
```

**Tags** provide semi-structured bot-specific data. Generic enough to display as a formatted key-value table without knowing the keys; parseable and actionable when you know them.

Examples for the staking bot:
- `[("neuronId", "12345"), ("amount_e8s", "100000000")]`
- `[("error", "Insufficient balance"), ("required", "200000000")]`
- `[("topic", "4"), ("followees", "111,222,333")]`

### Permissions (shared range 0–99)

| ID | Permission      | Description |
|----|----------------|-------------|
| 3  | `ViewLogs`     | Read log entries and configuration |
| 4  | `ManageLogs`   | Set log level, clear logs |

### Engine Design

Follows the BotChoreEngine callback pattern. The engine maintains an internal `Buffer<LogEntry>` for efficient operations, populated from persistent state on construction. Each `add()` appends to the buffer, trims if over `maxEntries`, and syncs back via callback.

Configuration: `maxEntries` defaults to 10,000 and is stored in a stable var (`botLogMaxEntries`); it can be changed at runtime with `setMaxLogEntries`, which trims immediately if needed.

Changed from the original plan: `maxEntries` was a compile-time constant.

### Query/Filter

```motoko
type LogFilter = {
    minLevel: ?LogLevel;   // minimum severity (null = all)
    source: ?Text;         // prefix match (e.g. "chore" matches "chore:refresh-stake")
    caller: ?Principal;    // exact match
    fromTime: ?Int;        // entries >= this timestamp
    toTime: ?Int;          // entries <= this timestamp
    startId: ?Nat;         // entries with id >= this (forward pagination)
    limit: ?Nat;           // max results (default 100)
};
// Without startId, getLogs returns the NEWEST `limit` matching entries (ascending by id);
// with startId it scans forward from that id.

type LogResult = {
    entries: [LogEntry];
    totalMatching: Nat;
    hasMore: Bool;
};
```

### Canister API

| Method | Type | Permission | Description |
|--------|------|-----------|-------------|
| `getLogs(filter)` | query | ViewLogs | Query entries with filtering and pagination |
| `getLogConfig()` | query | ViewLogs | Current log level, entry count, etc. |
| `setLogLevel(level)` | update | ManageLogs | Change the write-side log level |
| `setMaxLogEntries(n)` | update | ManageLogs | Change the retention cap |
| `clearLogs()` | update | ManageLogs | Remove all entries (nextId continues) |
| `getLogAlertSummary(sinceId)` | query | ViewLogs | Counts of errors/warnings with id > `sinceId`, highest error/warning ids, `nextId` — used for unseen-alert badges |

### Source Naming Convention

| Source | Usage |
|--------|-------|
| `"api"` | User-initiated API calls (mutations) |
| `"permissions"` | Botkey/permission management |
| `"chore:<choreId>"` | Automated chore activity |
| `"system"` | Canister lifecycle (init, upgrade) |
| `"log"` | Log management actions (setLogLevel, clearLogs) |

### Implementation Progress

**Completed (backend):**
1. **BotLogTypes.mo** — Shared types created: `LogLevel`, `LogEntry`, `LogFilter`, `LogResult`, `LogConfig`, `EngineConfig`, plus `logLevelToNat`/`natToLogLevel` conversion helpers.
2. **BotLogEngine.mo** — Shared engine created: `Engine` class with Buffer-based storage, callback pattern, `add`/`logInfo`/`logError`/etc. convenience methods, `query` with filtering, `getConfig`, `setLogLevel`, `clear`, `size`.
3. **Permissions** — `ViewLogs` (3) and `ManageLogs` (4) added to `BotkeyTypes.BasePermission`, `NeuronPermissionType` variant, `NeuronPermission` module, `PERMISSION_MAP`, `permissionVariantToId`, `permissionIdToVariant`.
4. **Canister integration** — Persistent vars (`botLogEntries`, `botLogNextId`, `botLogLevel`), engine instantiation, 4 API endpoints (`getLogs`, `getLogConfig`, `setLogLevel`, `clearLogs`) added.
5. **Instrumentation** — All ~50 public shared functions instrumented with `logEngine.logInfo`/`logWarning`/`logError` calls covering neuron creation, stake management, dissolve, disburse/withdraw, maturity, voting/proposals, following, hotkey management, visibility, permission management, escrow, split/merge, chore admin, distribution config, collect-maturity config, and log management.

6. **Since done** (were pending): frontend log viewer/filter (`BotManagementPanel.jsx`, `BotHealthDialog.jsx`), chore logging (the engine logs run/task lifecycle through `StateAccessor.log`, and the conductors and tasks log directly), Candid declarations, `setMaxLogEntries`, `getLogAlertSummary`.
