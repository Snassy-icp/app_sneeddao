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

The **Conductor** orchestrates the chore's execution. When started by the Scheduler, it:

1. Determines what Tasks need to run (e.g., queries the list of neurons to process).
2. Starts the first Task.
3. When a Task completes, evaluates what to do next — start another Task, or mark the chore as done.
4. Calls itself via 0-second timers to keep progressing through the Task sequence.

The Conductor is event-driven: it runs when there is a decision to make (start of chore, task completion) and idles while a Task is running. This avoids wasteful polling.

### 2.3 Task (Level 3)

A **Task** performs a discrete unit of work within the chore. It:

1. Executes a chunk of work (e.g., refresh voting power for one neuron).
2. Returns `#Continue` to be called again (via 0-second timer) if more work remains.
3. Returns `#Done` when the work is complete, or `#Error` if it failed.

Tasks split their work into instruction-limit-safe chunks by self-rescheduling with 0-second timers.

### 2.4 Execution Flow Example: "Refresh Voting Power" (Weekly)

```
Week 1, Monday 00:00:
  [Scheduler] fires → starts Conductor → reschedules for next Monday

  [Conductor] invocation 0:
    - Queries governance for all managed neurons → finds 3 neurons
    - Returns #StartTask("refresh-0", refreshNeuron0)

  [Task "refresh-0"] invocation 0:
    - Calls refreshVotingPower for neuron 0
    - Returns #Done

  [Conductor] invocation 1 (triggered by task completion):
    - Last task succeeded
    - Returns #StartTask("refresh-1", refreshNeuron1)

  [Task "refresh-1"] ... → #Done

  [Conductor] invocation 2:
    - Returns #StartTask("refresh-2", refreshNeuron2)

  [Task "refresh-2"] ... → #Done

  [Conductor] invocation 3:
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
| Engine | Timer management, state tracking, stop logic, upgrade resume, admin queries | — |
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
    enabled: Bool;          // Whether the scheduler should fire
    intervalSeconds: Nat;   // How often the scheduler fires
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
    conductorActive: Bool;          // true if conductor is running or waiting
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
// Returned by the conductor to tell the engine what to do next
type ConductorAction = {
    #StartTask: { taskId: Text; execute: () -> async TaskAction };
    #Continue;                  // Re-invoke conductor immediately (0-sec timer)
    #ContinueIn: { seconds: Nat };  // Re-invoke after delay
    #Done;                      // Chore completed successfully
    #Error: Text;               // Chore failed
};

// Returned by a task to tell the engine what to do next
type TaskAction = {
    #Continue;      // More work to do (0-sec re-invoke)
    #Done;          // Task completed
    #Error: Text;   // Task failed
};

// Context passed to the conductor on each invocation
type ConductorContext = {
    invocationCount: Nat;
    lastCompletedTask: ?{ taskId: Text; result: TaskCompletionResult };
};

type TaskCompletionResult = { #Completed; #Failed: Text };
```

### 4.4 ChoreStatus (Query Result)

```motoko
type ChoreStatus = {
    choreId: Text;
    choreName: Text;
    choreDescription: Text;
    enabled: Bool;
    intervalSeconds: Nat;

    schedulerStatus: { #Idle; #Scheduled };
    nextScheduledRunAt: ?Int;
    lastCompletedRunAt: ?Int;

    conductorStatus: { #Idle; #Running; #WaitingForTask };
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
    conduct: (ConductorContext) -> async ConductorAction;
};
```

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

### 5.2 Timer Lifecycle

```motoko
engine.resumeTimers<system>()    // Start/resume schedulers and any interrupted conductors
engine.cancelAllTimers()         // Cancel every active timer (emergency use)
```

### 5.3 Admin Control

```motoko
engine.setEnabled<system>(choreId, true)     // Enable/disable (starts/stops scheduler)
engine.setInterval(choreId, 604800)          // Change schedule interval (seconds)
engine.trigger<system>(choreId)              // Force-run now (starts conductor immediately)
engine.stopChore(choreId)                    // Stop a running chore gracefully
engine.stopAllChores()                       // Stop all running chores
```

### 5.4 Status Queries

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

## 8. Admin Interface

### 8.1 Running vs Scheduled Distinction

The admin interface clearly distinguishes between:

- **Running**: A timer callback is actively executing (conductor processing, task doing work).
- **Scheduled**: A timer is set and will fire at a specific future time (scheduler waiting for next interval).
- **Idle**: No timer is set and nothing is happening.

These are reflected in `schedulerStatus`, `conductorStatus`, and `taskStatus` fields of `ChoreStatus`.

### 8.2 Bot API Methods

Each bot exposes these canister methods (with permission checks):

```motoko
// Queries
getChoreStatuses() : async [ChoreStatus]
getChoreStatus(choreId: Text) : async ?ChoreStatus

// Admin controls
setChoreEnabled(choreId: Text, enabled: Bool) : async ()
setChoreInterval(choreId: Text, seconds: Nat) : async ()
triggerChore(choreId: Text) : async ()
stopChore(choreId: Text) : async ()
stopAllChores() : async ()
```

### 8.3 Permissions

Two new bot-specific permissions are added (following the Botkey pattern):

- `#ManageChores` (ID 18) — Enable/disable, configure, trigger, and stop chores.
- `#ViewChores` (ID 19) — View chore statuses and configurations.

Controllers always have full access.

---

## 9. Implementation Plan

### Phase 1: Core Types (`BotChoreTypes.mo`)
- Define all shared types: `ChoreConfig`, `ChoreRuntimeState`, `ConductorContext`, `ConductorAction`, `TaskAction`, `ChoreStatus`, `ChoreDefinition`, `StateAccessor`.
- Provide `emptyRuntimeState()` helper.

### Phase 2: Engine (`BotChoreEngine.mo`)
- Implement the `Engine` class with:
  - Chore registration
  - Scheduler timer management
  - Conductor timer loop with stop-flag checks
  - Task timer loop with stop-flag checks
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
- **Conductor**: Lists all neurons, then for each neuron starts a Task.
- **Task**: Calls `refreshVotingPower` for one neuron. Single-step task (returns `#Done` immediately).

---

## 10. First Chore: Refresh Voting Power

### 10.1 Why This Chore

ICP neurons need periodic voting power refresh to maintain maximum voting power. This chore automates it by calling `RefreshVotingPower` for every neuron managed by the bot canister, once per week.

### 10.2 Conductor Logic

```
Invocation 0 (lastCompletedTask = null):
  → Fetch all neurons from governance
  → If 0 neurons: return #Done
  → Store neuron list in captured mutable var
  → Return #StartTask("refresh-0", refreshNeuron(neurons[0]))

Invocation N (lastCompletedTask = some result):
  → Increment index
  → If index >= neurons.size(): return #Done
  → Return #StartTask("refresh-N", refreshNeuron(neurons[N]))
```

### 10.3 Task Logic

Each task is a single-step operation:

```
Invocation 0:
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
