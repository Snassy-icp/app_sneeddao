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

**Interval Randomization**: If `maxIntervalSeconds` is set in the chore config and is greater than `intervalSeconds`, the scheduler picks a random time within `[intervalSeconds, maxIntervalSeconds]` each time it reschedules. The randomization uses `Time.now()` nanosecond timestamp as entropy source. This is useful for bots where perfectly regular scheduling is undesirable (e.g. trading bots that should vary the timing of their actions).

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

### 4.4 ChoreStatus (Query Result)

```motoko
type ChoreStatus = {
    choreId: Text;
    choreName: Text;
    choreDescription: Text;
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
| **Start** | Stopped | Running | Run the chore immediately AND schedule the next run at now + interval. |
| **Pause** | Running | Paused | Suspend schedule (cancel scheduler timer) but preserve `nextScheduledRunAt`. Stops conductor/task if active. |
| **Resume** | Paused | Running | Re-activate preserved schedule. If `nextScheduledRunAt` has already passed, run immediately. |
| **Stop** | Running/Paused | Stopped | Cancel everything, clear schedule (`nextScheduledRunAt = null`). Full reset. |
| **Run Now** | Running/Paused | (same) | Manual one-off trigger. Does not affect the schedule. Only available when conductor is not already active. |

The `paused` flag is stored in `ChoreConfig` alongside `enabled`:
- `enabled=false, paused=false` → **Stopped**
- `enabled=true, paused=false` → **Running**
- `enabled=true, paused=true` → **Paused**

```motoko
engine.start<system>(choreId)               // Start: run now + schedule next (Stopped → Running)
engine.pause(choreId)                        // Pause: suspend schedule, preserve nextScheduledRunAt
engine.resume<system>(choreId)               // Resume: re-activate schedule (Paused → Running)
engine.stop(choreId)                         // Stop: cancel all, clear schedule (→ Stopped)
engine.trigger<system>(choreId)              // Manual one-off trigger (does not change state)
engine.setInterval(choreId, 604800)          // Change schedule interval (seconds)
engine.setTaskTimeout(choreId, 300)          // Change task timeout (seconds)
engine.stopAllChores()                       // Stop all chores
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
setChoreMaxInterval(choreId: Text, seconds: ?Nat) : async ()  // Set optional max interval for randomization
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

## Status Indicator (Lamp) System

Bot Chores use a **status lamp** system to give users an at-a-glance understanding of chore health. This is a reusable UI pattern that should be adopted by all bot products.

### Lamp States

Each timer level (Scheduler, Conductor, Task) is represented by a small colored circle ("lamp"):

| State | Color | Animation | Meaning |
|-------|-------|-----------|---------|
| **Off** | Gray (#6b7280) | None | Timer not running, not scheduled |
| **OK** | Green (#22c55e) | Steady | Scheduled, healthy, waiting to fire |
| **Active** | Green (#22c55e) | Pulsing glow | Currently executing |
| **Overdue** | Amber (#f59e0b) | None | Should be running/scheduled but hasn't fired in too long |
| **Error** | Red (#ef4444) | None | Stop requested, or last operation failed |

### Per-Timer State Derivation

**Scheduler:**
- **Off**: Chore is disabled.
- **OK**: Enabled and scheduled (timer set, waiting to fire). Also shown when the conductor is actively running (scheduler has done its job).
- **Overdue**: Enabled but (a) `lastCompletedRunAt` is more than 3× the interval ago, (b) `nextScheduledRunAt` has passed by more than 5 minutes, or (c) enabled and idle with no conductor active (timer missing).
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
Error > Overdue > Active > OK > Off
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

The lamp system is implemented as:
- **Pure functions** (`getSchedulerLampState`, `getConductorLampState`, `getTaskLampState`, `getChoreSummaryLamp`, `getAllChoresSummaryLamp`) that take `ChoreStatus` data and return `{ state, label }`.
- A **`StatusLamp` React component** that renders a colored circle with optional pulse animation, tooltip, and text label.
- **Constants** (`LAMP_OFF`, `LAMP_OK`, `LAMP_ACTIVE`, `LAMP_WARN`, `LAMP_ERROR`) and color map (`LAMP_COLORS`).

For new bot products, these functions and the `StatusLamp` component can be extracted to a shared module. The state derivation functions operate purely on `ChoreStatus` data from the backend — no bot-specific logic is needed.

---

## ICP Staking Bot — Implemented Chores

The ICP Staking Bot (`sneed_icp_neuron_manager`) uses the Bot Chores framework to automate the following recurring tasks:

### 1. Confirm Following (`confirm-following`)

- **Purpose**: Re-confirms neuron followees to keep neurons eligible for voting rewards. NNS requires followees to be re-confirmed at least every 6 months.
- **Default interval**: 30 days (monthly, well within the 6-month deadline).
- **Task timeout**: 10 minutes per neuron.
- **Behavior**: For each managed neuron, reads current followees via `get_full_neuron`, then re-applies each topic's followees via `manage_neuron(#Follow)`.
- **Chore-specific settings**: None (uses standard interval configuration).

### 2. Refresh Stake (`refresh-stake`)

- **Purpose**: Picks up any ICP that was deposited directly to a neuron's governance account. After depositing ICP to a neuron account, `ClaimOrRefresh` must be called for the ICP to count as staked.
- **Default interval**: 1 day.
- **Task timeout**: 5 minutes per neuron.
- **Behavior**: For each managed neuron, calls `claim_or_refresh_neuron_from_account` to refresh the stake.
- **Chore-specific settings**: None.

### 3. Collect Maturity (`collect-maturity`)

- **Purpose**: Periodically collects (disburses) accumulated maturity from all managed neurons and sends it to a configurable account. Maturity accumulates from voting rewards.
- **Default interval**: 7 days (weekly).
- **Task timeout**: 5 minutes per neuron.
- **Behavior**: For each managed neuron:
  1. Reads `maturity_e8s_equivalent` from the full neuron.
  2. If a threshold is configured and the maturity is below it, skips the neuron.
  3. If maturity is 0, skips the neuron.
  4. Calls `DisburseMaturity` with 100% percentage, sending to the configured destination.
- **Chore-specific settings** (stable variables in the canister):
  - `collectMaturityThresholdE8s: ?Nat64` — Minimum maturity (in e8s) before collection is attempted. `null` = collect any amount.
  - `collectMaturityDestination: ?Account` — ICRC-1 account to receive disbursed maturity. `null` = bot's own account (canister principal, no subaccount).
- **API methods**:
  - `getCollectMaturitySettings() -> { thresholdE8s: ?Nat64; destination: ?Account }` (query)
  - `setCollectMaturityThreshold(thresholdE8s: ?Nat64)` (ManageChores permission)
  - `setCollectMaturityDestination(destination: ?Account)` (ManageChores permission)

### 4. Distribute Funds (`distribute-funds`)

- **Purpose**: Periodically checks configured distribution lists and sends funds from the bot's account (or a subaccount) to target ICRC-1 accounts based on configured percentages. Designed for reusability across multiple bot products.
- **Default interval**: 1 day.
- **Task timeout**: 10 minutes per distribution list.
- **Behavior**: For each distribution list (processed in definition order):
  1. Creates a dynamic ledger actor from the list's `tokenLedgerCanisterId`.
  2. Queries `icrc1_fee()` and `icrc1_balance_of()` for the source account.
  3. If balance < `thresholdAmount`, skips the list.
  4. Calculates distributable = min(balance, `maxDistributionAmount`).
  5. Deducts total transfer fees (one fee per target).
  6. Calculates each target's share based on basis points (see percentage logic below).
  7. Applies hard minimum check: the smallest recipient's share must exceed one tx fee.
  8. Executes `icrc1_transfer` for each target.

- **Percentage Logic**:
  - Targets with assigned `basisPoints` (0–10000, where 10000 = 100%) get their proportional share.
  - If assigned percentages exceed 100%, they are renormalized (scaled down proportionally). The UI warns about this.
  - Targets with `null` basisPoints evenly split the remainder (100% minus the sum of assigned percentages).
  - If assigned percentages total 100% or more, auto-split targets receive nothing.
  - If no targets have assigned percentages, all targets get equal shares.

- **Hard Minimum**: Regardless of the user-configured threshold, a distribution is skipped entirely if the smallest recipient would receive an amount less than or equal to one transaction fee. This prevents wasteful micro-distributions.

- **Multiple Lists**: Multiple distribution lists can target the same source subaccount and token. They run in definition order. If the first list's distribution leaves sufficient balance above the second list's threshold, the second list runs as well.

- **Shared Types** (`src/DistributionTypes.mo` — reusable across bots):
  ```motoko
  DistributionTarget = {
      account: Account;       // ICRC-1 account (owner + optional subaccount)
      basisPoints: ?Nat;      // null = auto-split remainder; 0–10000 where 10000 = 100%
  };

  DistributionList = {
      id: Nat;                         // Unique ID (assigned by canister)
      name: Text;                      // Human-readable name
      sourceSubaccount: ?Blob;         // null = default account
      tokenLedgerCanisterId: Principal; // Which ICRC-1 token
      thresholdAmount: Nat;            // Min balance to trigger
      maxDistributionAmount: Nat;      // Cap per round
      targets: [DistributionTarget];
  };

  DistributionListInput = { /* same as DistributionList but without id */ };
  ```

- **Stable Variables**:
  - `distributionLists: [DistributionList]` — the configured distribution lists.
  - `nextDistributionListId: Nat` — auto-incrementing ID counter.

- **API Methods**:
  - `getDistributionLists() -> [DistributionList]` (query, ViewChores)
  - `addDistributionList(input: DistributionListInput) -> Nat` (ManageChores, returns assigned ID)
  - `updateDistributionList(id: Nat, input: DistributionListInput)` (ManageChores)
  - `removeDistributionList(id: Nat)` (ManageChores)

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
