# ICP Neuron Manager Specification

> **Status (2026-10-20): built, and grown past this spec.** The product shipped as the **ICP Staking Bot**: canister code `src/sneed_bots/sneed_icp_staking_bot/main.mo` + `Types.mo` (dfx canister `sneed_icp_staking_bot`, formerly `sneed_icp_neuron_manager`; current version 0.9.5). The factory is the `sneedapp` canister (`src/sneedapp/main.mo`, see `spec/sneedapp.md`). The sections below are updated to the code; the biggest changes from the original plan are:
> - One bot canister manages **any number of neurons** (every NNS neuron it controls), so all neuron methods take a `neuronId`.
> - Access is controllers **plus botkeys** (per-principal numeric permissions), not controllers only.
> - The factory installs an uploaded WASM and charges a creation fee; it does not spawn an actor class.
> - Chores, Botlog and bot events were added (`spec/bot_chores.md`).

## Overview

The ICP Neuron Manager is a factory-based system that allows users to create dedicated canisters for managing ICP NNS neurons. Each neuron manager canister:
- Is controlled entirely by the user
- Creates and manages **any number of** ICP NNS neurons (all neurons whose controller is the canister)
- Enables transfer of neuron ownership by transferring canister control

Changed from the original plan: a manager canister was to hold exactly one neuron. Users can still create multiple manager canisters, e.g. to transfer neurons separately.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              Factory Canister (sneedapp, src/sneedapp/main.mo)   │
│  - Creates new neuron manager canisters (paid)                  │
│  - Tracks them in each user's wallet (bookmarks)                │
│  - Publishes official versions (WASM hash, URL, source)         │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
            ┌───────────┐ ┌───────────┐ ┌───────────┐
            │  User A   │ │  User B   │ │  User C   │
            │  Staking  │ │  Staking  │ │  Staking  │
            │    Bot    │ │    Bot    │ │    Bot    │
            └───────────┘ └───────────┘ └───────────┘
                    │           │           │
                    ▼           ▼           ▼
            ┌─────────────────────────────────────┐
            │         NNS Governance Canister      │
            │      (rrkah-fqaaa-aaaaa-aaaaq-cai)   │
            └─────────────────────────────────────┘
                                │
                                ▼
            ┌─────────────────────────────────────┐
            │           ICP Ledger Canister        │
            │      (ryjl3-tyaaa-aaaaa-aaaba-cai)   │
            └─────────────────────────────────────┘
```

## Files Structure

| File | Purpose |
|------|---------|
| `src/sneedapp/main.mo` | Factory actor (multi-app factory) - creates and tracks neuron manager canisters |
| `src/sneed_bots/sneed_icp_staking_bot/main.mo` | Actor class `NeuronManagerCanister` for individual neuron managers |
| `src/sneed_bots/sneed_icp_staking_bot/Types.mo` | Type definitions (also imported by the factory) |
| `src/sneed_bots/Botkey*.mo`, `BotChore*.mo`, `BotLog*.mo`, `BotEvent*.mo`, `DistributionTypes.mo` | Shared bot framework |

Changed from the original plan: `main.mo` / `icp_neuron_manager.mo` / `Types.mo` in one folder.

---

## Types.mo

### Version Information
```motoko
type Version = {
    major: Nat;
    minor: Nat;
    patch: Nat;
};

// Published by the factory for users to verify and upgrade
type OfficialVersion = {
    major: Nat; minor: Nat; patch: Nat;
    wasmHash: Text;   // hex SHA-256 of the WASM
    wasmUrl: Text;
    sourceUrl: Text;
};
```

### NNS Types (mirrors of governance canister types)

As built, these mirror the governance Candid directly (snake_case fields, numeric enums) rather than the friendlier variants first planned:

```motoko
type NeuronId = { id: Nat64 };
type AccountIdentifier = Blob;   // 32 bytes
type Subaccount = Blob;          // 32 bytes
type Account = { owner: Principal; subaccount: ?Blob };   // ICRC-1

type DissolveState = {
    #DissolveDelaySeconds: Nat64;
    #WhenDissolvedTimestampSeconds: Nat64;
};

// Followees per topic: followees: [(Int32 /* topic */, { followees: [NeuronId] })]

// Full neuron (governance `Neuron`): id, controller, hot_keys, cached_neuron_stake_e8s,
// maturity_e8s_equivalent, staked_maturity_e8s_equivalent, auto_stake_maturity,
// dissolve_state, followees, visibility, spawn_at_timestamp_seconds,
// voting_power_refreshed_timestamp_seconds, deciding/potential_voting_power, ...

// Neuron info (governance `NeuronInfo`): dissolve_delay_seconds, state: Int32,
// stake_e8s, age_seconds, voting_power, recent_ballots, visibility, ...

type BallotInfo = { vote: Int32; proposal_id: ?ProposalId };
```

Changed from the original plan: `NeuronState`, `Vote` and `Topic` variants were dropped; neuron state, votes (1 = Yes, 2 = No) and topics are the NNS `Int32` codes.

### Manager Canister Types

```motoko
// Result of creating a neuron manager
type CreateManagerResult = {
    #Ok: {
        canisterId: Principal;
        accountId: AccountIdentifier;
    };
    #Err: CreateManagerError;
};

type CreateManagerError = {
    #InsufficientCycles;
    #CanisterCreationFailed: Text;
    #AlreadyExists;
    #NotAuthorized;
    #InsufficientPayment: { required: Nat64; provided: Nat64 };
    #TransferFailed: Text;
    #CyclesTopUpFailed: Text;
};

// Result of staking/creating a neuron
type StakeNeuronResult = {
    #Ok: NeuronId;
    #Err: StakeNeuronError;
};

type StakeNeuronError = {
    #InsufficientFunds: { balance: Nat64; required: Nat64 };
    #NeuronAlreadyExists;
    #TransferFailed: Text;
    #GovernanceError: GovernanceError;   // { error_message: Text; error_type: Int32 }
    #InvalidDissolveDelay: { min: Nat64; max: Nat64; provided: Nat64 };  // declared, not currently returned
};

// Generic operation result
type OperationResult = {
    #Ok;
    #Err: OperationError;
};

type OperationError = {
    #NoNeuron;             // neuron not controlled by this canister
    #NotController;
    #GovernanceError: GovernanceError;
    #InvalidOperation: Text;
    #TransferFailed: Text;
};

// Disburse / withdraw result
type DisburseResult = {
    #Ok: { transfer_block_height: Nat64 };
    #Err: OperationError;
};

// Spawn result
type SpawnResult = {
    #Ok: NeuronId; // The new neuron ID
    #Err: OperationError;
};

// Split result
type SplitResult = {
    #Ok: NeuronId; // The new neuron ID from split
    #Err: OperationError;
};

// Proposal submission result
type MakeProposalResult = {
    #Ok: { proposal_id: ?ProposalId; message: ?Text };
    #Err: OperationError;
};

// Manager canister info (legacy factory tracking type; still declared)
type ManagerInfo = {
    canisterId: Principal;
    owner: Principal;
    createdAt: Int;
    version: Version;
    neuronId: ?NeuronId;
};
```

---

## main.mo (Factory Canister)

*Status (2026-10-20): built as part of `sneedapp`; full detail in `spec/sneedapp.md`. Only the neuron-manager surface is summarised here.*

### State

Changed from the original plan: there is no `managers` list. Created managers are recorded in the per-user wallet (`userWalletMap`, app id `"icp-staking-bot"`) and in the creation/mint logs. The factory also keeps the uploaded `managerWasm`, the payment config (creation fee, premium fee, target cycles, fee destination), and the list of official versions.

### Public Functions

#### Factory Operations

```motoko
// Create a new neuron manager canister for the caller (paid unless payment is switched off).
// The caller pays from their payment subaccount (getPaymentSubaccount(user)); Sneed Premium
// members pay the premium fee. The new canister's only controller is the caller.
createNeuronManager(): async CreateManagerResult

// Manager canister IDs in the caller's wallet
getMyManagers(): async [Principal]

// DEPRECATED: always returns null
getManagerByCanisterId(canisterId: Principal): async ?ManagerInfo

// Manager canister IDs in an owner's wallet
getManagersByOwner(owner: Principal): async [Principal]

// All registrations (admin): replaces getAllManagers
getAllRegistrations(): async [(Principal, [Principal])]

// Bookmarks: registerManager / deregisterManager / transferManager(canisterId, newOwner)

// The current version of the manager canister code, and the published versions
getCurrentVersion(): async Version
getOfficialVersions(): async [OfficialVersion]
getOfficialVersionByHash(wasmHash: Text): async ?OfficialVersion
```

#### Admin Operations

```motoko
// Factory admins only
setCurrentVersion(version: Version): async ()
setManagerWasm(wasm: Blob): async ()           // WASM installed into new managers
add/update/removeOfficialVersion(...), setOfficialVersions(...)
setPaymentConfig / setCreationFee / setPremiumCreationFee / setTargetCycles / setFeeDestination / setPaymentRequired
```

### Canister Creation Flow

1. User sends the creation fee to their payment subaccount, then calls `createNeuronManager()`
2. Factory checks that a manager WASM is uploaded and that it has enough cycles, takes the fee (part converted to cycles via the CMC, the rest to the fee destination)
3. Factory creates a canister, installs the uploaded WASM
4. Factory sets the caller as the only controller (removes itself)
5. Factory records the new manager in the caller's wallet and the creation log
6. Returns canister ID and ICP account ID

Changed from the original plan: no `NeuronManagerCanister` actor-class spawn and no free creation — the factory installs an uploaded WASM, and creation is paid.

---

## icp_neuron_manager.mo (Neuron Manager Actor Class)

*Now `src/sneed_bots/sneed_icp_staking_bot/main.mo`, `persistent actor class NeuronManagerCanister()`.*

### State

```motoko
var createdAt: Int = Time.now();
transient let currentVersion: Version = T.CURRENT_VERSION;   // reflects the compiled WASM
var hotkeyPermissions: [(Principal, [Nat])] = [];             // botkeys
// + chore configs/states/instances, per-instance chore settings, bot log, event system state
```

Changed from the original plan: no stored `neuronId` — the bot's neurons are read from governance (`list_neurons`, filtered to neurons whose controller is the canister) on demand, and the version is not stored.

### Constants

```motoko
GOVERNANCE_CANISTER_ID = "rrkah-fqaaa-aaaaa-aaaaq-cai";
LEDGER_CANISTER_ID     = "ryjl3-tyaaa-aaaaa-aaaba-cai";
CMC_CANISTER_ID        = "rkp4c-7iaaa-aaaaa-aaaca-cai";
ICP_FEE: Nat64         = 10_000;       // 0.0001 ICP
MIN_STAKE_E8S: Nat64   = 100_000_000;  // 1 ICP minimum to create neuron
```

### Public Functions

Every method below except the plain info queries is permission-checked: controllers always pass; other principals need the botkey permission shown in brackets (IDs in `Types.mo` `NeuronPermission`).

#### Canister Info

```motoko
getVersion(): async Version                    // query, public
getCreatedAt(): async Int                      // query, public
getAccount(): async Account                    // query, public — the canister's ICRC-1 account
getAccountId(): async AccountIdentifier        // query, public — legacy account id; users send ICP here before staking
getBalance(): async Nat                        // [ViewNeuron] ICP balance of this canister

// Neurons
listNeurons(): async [Neuron]                  // [ViewNeuron] full neurons controlled by this canister
getNeuronIds(): async [NeuronId]               // [ViewNeuron]
getNeuronCount(): async Nat                    // [ViewNeuron]
hasNeuron(neuronId: NeuronId): async Bool      // [ViewNeuron]
getNeuronAccount(neuronId: NeuronId): async ?Account   // [ViewNeuron] the neuron's governance subaccount
```

Changed from the original plan: `getNeuronId()` became the list methods above.

#### Neuron Creation

```motoko
// Stake ICP from this canister's balance to create a neuron   [StakeNeuron]
// Needs balance >= amount + fee and amount >= 1 ICP. The dissolve delay is not validated
// locally — NNS governance enforces min/max, so limit changes need no bot upgrade.
stakeNeuron(amount_e8s: Nat64, dissolve_delay_seconds: Nat64): async StakeNeuronResult

// Two-step staking from an outside wallet: get a memo and the governance account to pay,
// send ICP there, then claim.
generateMemo(): async Nat64                                       // query, public
getStakeAccount(memo: Nat64): async { account: Account; memo: Nat64 }   // query, public
claimNeuronFromDeposit(memo: Nat64, dissolve_delay_seconds: Nat64): async StakeNeuronResult   // [StakeNeuron]
```

#### Neuron Information

```motoko
getNeuronInfo(neuronId: NeuronId): async ?NeuronInfo        // [ViewNeuron]
getFullNeuron(neuronId: NeuronId): async ?Neuron            // [ViewNeuron]
getAllNeuronsInfo(): async [(NeuronId, ?NeuronInfo)]        // [ViewNeuron]
```

Changed from the original plan: `getStake`, `getMaturity`, `getVotingPower`, `getDissolveState`, `getAgeSeconds` were not built; read the fields from `getNeuronInfo` / `getFullNeuron`. These are update calls (they call governance), not queries.

#### Stake Management

```motoko
// Increase stake by transferring from canister balance to the neuron   [StakeNeuron]
increaseStake(neuronId: NeuronId, amount_e8s: Nat64): async OperationResult

// Refresh stake (claim any ICP sent directly to the neuron's subaccount)   [StakeNeuron]
refreshStake(neuronId: NeuronId): async OperationResult
refreshStakeFromDeposit(neuronId: NeuronId): async OperationResult
```

#### Dissolve Management

```motoko
// Increase the dissolve delay by `additionalSeconds` (NNS IncreaseDissolveDelay)   [ConfigureDissolveState]
setDissolveDelay(neuronId: NeuronId, additionalSeconds: Nat32): async OperationResult

startDissolving(neuronId: NeuronId): async OperationResult   // [ConfigureDissolveState]
stopDissolving(neuronId: NeuronId): async OperationResult    // [ConfigureDissolveState]
```

Changed from the original plan: `setDissolveDelay` adds seconds (`Nat32`) rather than setting an absolute `Nat64` delay.

#### Disburse (Withdraw)

```motoko
// Disburse a dissolved neuron. amount null = all; to_account null = this canister   [Disburse]
disburse(neuronId: NeuronId, amount_e8s: ?Nat64, to_account: ?AccountIdentifier): async DisburseResult

// Withdraw ICP held by the canister (not staked) to an ICRC-1 account   [WithdrawFunds]
withdrawIcp(amount_e8s: Nat64, to_account: Account): async DisburseResult

// Withdraw any ICRC-1 token held by the canister   [WithdrawFunds]
withdrawToken(ledger_canister_id: Principal, amount: Nat, to_account: Account): async DisburseResult
```

Changed from the original plan: `withdrawIcp` takes an ICRC-1 `Account` (not an `AccountIdentifier`); `withdrawToken` was added.

#### Maturity Management

```motoko
// Spawn maturity into a new neuron; newController null = this canister   [Spawn]
spawnMaturity(neuronId: NeuronId, percentage: Nat32, newController: ?Principal): async SpawnResult

mergeMaturity(neuronId: NeuronId, percentage: Nat32): async OperationResult    // [MergeMaturity]
stakeMaturity(neuronId: NeuronId, percentage: Nat32): async OperationResult    // [StakeMaturity]

// Disburse maturity to an ICRC-1 account (null = this canister)   [DisburseMaturity]
disburseMaturity(neuronId: NeuronId, percentage: Nat32, to_account: ?Account): async OperationResult
```

Note: NNS governance no longer supports `MergeMaturity`; `mergeMaturity` is still exposed and will return the governance error.

#### Voting

```motoko
// vote: 1 = Yes, 2 = No (NNS codes)   [Vote]
vote(neuronId: NeuronId, proposal_id: Nat64, voteValue: Int32): async OperationResult

// Submit an NNS proposal with a neuron   [MakeProposal]
makeProposal(neuronId: NeuronId, proposal: Proposal): async MakeProposalResult

// Set following for a topic (Int32 topic code)   [ManageFollowees]
setFollowing(neuronId: NeuronId, topic: Int32, followees: [NeuronId]): async OperationResult

// Re-apply all current followees (keeps the 6-month confirmation fresh)   [ManageFollowees]
confirmFollowing(neuronId: NeuronId): async OperationResult

// Refresh voting power   [Vote]
refreshVotingPower(neuronId: NeuronId): async OperationResult
```

Changed from the original plan: `getFollowees(topic)` was not built (followees are in `getFullNeuron`); `makeProposal`, `confirmFollowing` and `refreshVotingPower` were added.

#### Hot Key Management

```motoko
// NNS hot keys on a neuron   [ManageNeuronHotkeys]
addHotKey(neuronId: NeuronId, hotkey: Principal): async OperationResult
removeHotKey(neuronId: NeuronId, hotkey: Principal): async OperationResult
```

`getHotKeys` was not built (hot keys are in `getFullNeuron`). Separate from NNS hot keys, the canister has **botkeys** — principals granted numeric permissions on the canister itself: `addHotkeyPermissions`, `removeHotkeyPermissions`, `removeHotkeyPrincipal` [ManagePermissions]; `getHotkeyPermissions`, `listHotkeyPrincipals`, `listPermissionTypes`, `callerPermissions`, `checkPermission` (queries); `getBotkeySnapshot`, `restoreBotkeySnapshot`, `clearBotkeys` (controllers only).

#### Neuron Splitting/Merging

```motoko
// Split; the new neuron is controlled by this same canister   [Split]
splitNeuron(neuronId: NeuronId, amount_e8s: Nat64): async SplitResult

// Merge source into target; both must be controlled by this canister   [MergeNeurons]
mergeNeurons(targetNeuronId: NeuronId, sourceNeuronId: NeuronId): async OperationResult
```

#### Auto-Stake Maturity and Visibility

```motoko
// NNS auto-stake maturity on/off   [AutoStakeMaturity]
setAutoStakeMaturity(neuronId: NeuronId, enabled: Bool): async OperationResult

// Neuron visibility (NNS code)   [ManageVisibility]
setVisibility(neuronId: NeuronId, visibility: Int32): async OperationResult
```

Changed from the original plan: auto-stake is the NNS on/off flag, not a percentage.

#### Chores, logs and events

See `spec/bot_chores.md`: chores (confirm-following, refresh-stake, collect-maturity, distribute-funds), Botlog (`getLogs`, `setLogLevel`, …) and the bot event source/listener API (`registerEventListener`, `getEventLog`, `addEventReaction`, …).

---

## User Flows

### Flow 1: Create Manager and Stake New Neuron

1. User pays the creation fee and calls `factory.createNeuronManager()`
2. User receives their canister ID and account ID
3. User transfers ICP to the canister's account
4. User calls `manager.stakeNeuron(amount, dissolveDelay)` (or uses `getStakeAccount` + `claimNeuronFromDeposit` to stake straight from a wallet)
5. Neuron is created, user can now manage it; more neurons can be staked from the same canister

### Flow 2: Increase Neuron Stake

**Option A: Through canister**
1. User sends ICP to canister account
2. User calls `manager.increaseStake(neuronId, amount)`

**Option B: Direct to neuron**
1. User sends ICP directly to the neuron's governance subaccount (`getNeuronAccount`)
2. User calls `manager.refreshStake(neuronId)` to claim it (or lets the refresh-stake chore do it)

### Flow 3: Dissolve and Withdraw

1. User calls `manager.startDissolving(neuronId)`
2. User waits for dissolve delay to pass
3. User calls `manager.disburse(neuronId, null, ?recipientAccountId)`
4. ICP is transferred to recipient

### Flow 4: Transfer Neuron Ownership

1. Current owner uses IC management canister to change controller (the frontend also offers `factory.transferManager` to move the wallet bookmark)
2. New controller now has full access to the neuron manager — and to every neuron it holds
3. (Neuron ownership effectively transferred). Botkeys granted by the old owner stay until cleared (`clearBotkeys`).

### Flow 5: Upgrade Manager Canister

1. Factory admins publish a new official version (WASM hash, download URL, source URL) and update the current version / manager WASM
2. User sees their version (`getVersion`) vs current version
3. User upgrades their canister (they are controller), from the frontend or with the downloaded WASM, checking the hash against `getOfficialVersionByHash`
4. Upgrades must pass through every published version that carries a migration (e.g. 0.9.2 for distribution lists)

---

## Security Considerations

### Access Control
- Controllers can do everything; other principals only what their botkey permissions allow (`FullPermissions` grants all)
- NNS hot keys added to a neuron can only vote/follow, not manage stake or dissolve
- Factory cannot access user canisters after creation (it removes itself as controller)
- Ingress `inspect` refuses oversized arguments and query-only methods called as updates (`IngressGuard`)

Changed from the original plan: "all neuron operations require being the canister controller" became controller-or-botkey.

### Funds Safety
- ICP and tokens sent to the canister can be withdrawn by the controller or a `WithdrawFunds` botkey
- ICP staked in neuron follows NNS rules (dissolve delay)
- No admin backdoors in user canisters

### Upgrade Safety
- Users control their own upgrades
- Version tracking helps users know when updates are available
- Factory publishes official version hashes for verification

---

## Constants Reference

| Constant | Value | Description |
|----------|-------|-------------|
| Governance Canister | `rrkah-fqaaa-aaaaa-aaaaq-cai` | NNS Governance |
| Ledger Canister | `ryjl3-tyaaa-aaaaa-aaaba-cai` | ICP Ledger |
| CMC | `rkp4c-7iaaa-aaaaa-aaaca-cai` | Cycles minting (factory top-ups) |
| Min Stake | 1 ICP (100_000_000 e8s) | Minimum to create neuron (checked by the bot) |
| ICP Fee | 0.0001 ICP (10_000 e8s) | Ledger transfer fee |
| Min Dissolve (voting) | 6 months (15,778,800 s) | Min for voting power (enforced by NNS, not the bot) |
| Max Dissolve | 2 years (63,072,000 s) | Max dissolve delay since the 2026 NNS tokenomics change (was 8 years); enforced by NNS, not the bot |

---

## Future Enhancements

- [x] Payment system for canister creation (ICP -> cycles) — built in sneedapp
- [x] Specify destination wallet for maturity disbursement — `disburseMaturity(…, to_account)` and the collect-maturity chore
- [ ] Batch operations for managing multiple neurons — partly: chores act on all neurons; no batch API
- [ ] Notification system for proposals
- [ ] Auto-voting based on rules
- [ ] Community neuron features (shared control) — partly: botkeys give other principals scoped access
- [x] Integration with app_sneeddao_backend for unified frontend — the bot is managed from the Sneed Hub frontend (`IcpNeuronManager.jsx`)

---

## Implementation Priority

*Status (2026-10-20): all three phases built; "testing and audit" is covered by the PocketIC canister test suite (`test/canisters`).*

### Phase 1: Core Functionality
1. Types.mo - All type definitions
2. Basic factory (create canister, set controller)
3. Basic neuron manager (stake, dissolve, disburse)
4. Version tracking

### Phase 2: Full Neuron Management  
1. Voting and following
2. Hot key management
3. Maturity management
4. Split/merge neurons

### Phase 3: Polish & Integration
1. Payment for canister creation
2. Frontend integration
3. Upgrade helpers
4. Testing and audit
