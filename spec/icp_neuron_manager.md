# ICP Neuron Manager Specification

## Overview

The ICP Neuron Manager is a factory-based system that allows users to create dedicated canisters for managing ICP NNS neurons. Each neuron manager canister:
- Is controlled entirely by the user
- Creates and manages exactly **one** ICP NNS neuron
- Enables transfer of neuron ownership by transferring canister control

Users can create **multiple** neuron manager canisters (one neuron per canister) to manage multiple neurons independently.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Factory Canister (main.mo)                    │
│  - Creates new neuron manager canisters                         │
│  - Tracks deployed canisters                                    │
│  - Provides upgrade paths                                       │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
            ┌───────────┐ ┌───────────┐ ┌───────────┐
            │  User A   │ │  User B   │ │  User C   │
            │  Neuron   │ │  Neuron   │ │  Neuron   │
            │  Manager  │ │  Manager  │ │  Manager  │
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
| `main.mo` | Factory actor - creates and tracks neuron manager canisters |
| `icp_neuron_manager.mo` | Actor class definition for individual neuron managers |
| `Types.mo` | Shared type definitions used by both |

---

## Types.mo

### Version Information
```motoko
type Version = {
    major: Nat;
    minor: Nat;
    patch: Nat;
};
```

### NNS Types (mirrors of governance canister types)

```motoko
// Neuron ID
type NeuronId = { id: Nat64 };

// Account identifier (32 bytes)
type AccountIdentifier = Blob;

// Subaccount (32 bytes)  
type Subaccount = Blob;

// Dissolve state
type DissolveState = {
    #DissolveDelaySeconds: Nat64;
    #WhenDissolvedTimestampSeconds: Nat64;
};

// Neuron state enum
type NeuronState = {
    #Locked;
    #Dissolving;
    #Dissolved;
    #Spawning;
};

// Followee configuration
type Followees = {
    topic: Int32;
    followees: [NeuronId];
};

// Basic neuron info (subset of full neuron)
type NeuronInfo = {
    neuronId: NeuronId;
    dissolveState: DissolveState;
    cachedNeuronStakeE8s: Nat64;
    maturityE8sEquivalent: Nat64;
    state: NeuronState;
    votingPower: Nat64;
    ageSeconds: Nat64;
};

// Ballot info for proposals
type BallotInfo = {
    proposalId: Nat64;
    vote: Int32;
};

// Vote options
type Vote = {
    #Unspecified;
    #Yes;
    #No;
};

// Proposal topics for following
type Topic = {
    #Unspecified;
    #NeuronManagement;
    #ExchangeRate;
    #NetworkEconomics;
    #Governance;
    #NodeAdmin;
    #ParticipantManagement;
    #SubnetManagement;
    #NetworkCanisterManagement;
    #Kyc;
    #NodeProviderRewards;
    #SnsDecentralizationSale;
    #SubnetReplicaVersionManagement;
    #ReplicaVersionManagement;
    #SnsAndCommunityFund;
    #ApiBoundaryNodeManagement;
    #SubnetRental;
    #ProtocolCanisterManagement;
    #ServiceNervousSystemManagement;
};
```

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
};

// Result of staking/creating a neuron
type StakeNeuronResult = {
    #Ok: NeuronId;
    #Err: StakeNeuronError;
};

type StakeNeuronError = {
    #InsufficientFunds;
    #NeuronAlreadyExists;
    #TransferFailed: Text;
    #GovernanceError: Text;
};

// Generic operation result
type OperationResult = {
    #Ok;
    #Err: OperationError;
};

type OperationError = {
    #NoNeuron;
    #NotController;
    #GovernanceError: Text;
    #InvalidOperation: Text;
};

// Disburse result
type DisburseResult = {
    #Ok: { transferBlockHeight: Nat64 };
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

// Manager canister info (for factory tracking)
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

### State

```motoko
var managers: [(Principal, ManagerInfo)] = []; // canisterId -> manager info (allows multiple per user)
var currentVersion: Version = { major = 1; minor = 0; patch = 0 };
```

### Public Functions

#### Factory Operations

```motoko
// Create a new neuron manager canister for the caller
// The caller becomes the controller of the new canister
// Users can create MULTIPLE managers (one neuron per manager)
createNeuronManager(): async CreateManagerResult

// Get all manager canisters owned by the caller
getMyManagers(): async [ManagerInfo]

// Get manager info by canister ID
getManagerByCanisterId(canisterId: Principal): async ?ManagerInfo

// Get all managers for a specific owner
getManagersByOwner(owner: Principal): async [ManagerInfo]

// Get all managers (admin/query)
getAllManagers(): async [ManagerInfo]

// Get the current version of the manager canister code
getCurrentVersion(): async Version
```

#### Admin Operations

```motoko
// Update the current version number
// Only callable by factory controllers  
setCurrentVersion(version: Version): async ()
```

### Canister Creation Flow

1. User calls `createNeuronManager()`
2. Factory spawns new `NeuronManagerCanister` actor class directly (no WASM upload needed)
3. Factory transfers control to caller (removes factory as controller)
4. Factory records the new manager in state
5. Returns canister ID and ICP account ID

---

## icp_neuron_manager.mo (Neuron Manager Actor Class)

### State

```motoko
stable var neuronId: ?NeuronId = null;
stable var version: Version = { major = 1; minor = 0; patch = 0 };
stable var createdAt: Int = 0;
```

### Constants

```motoko
let GOVERNANCE_CANISTER_ID: Principal = "rrkah-fqaaa-aaaaa-aaaaq-cai";
let LEDGER_CANISTER_ID: Principal = "ryjl3-tyaaa-aaaaa-aaaba-cai";
let ICP_FEE: Nat64 = 10_000; // 0.0001 ICP
let MIN_STAKE: Nat64 = 100_000_000; // 1 ICP minimum to create neuron
```

### Public Functions

#### Canister Info

```motoko
// Get version info
getVersion(): async Version

// Get this canister's ICP account identifier
// Users send ICP here before staking
getAccountId(): async AccountIdentifier

// Get ICP balance of this canister
getBalance(): async Nat64

// Get the neuron ID (if created)
getNeuronId(): async ?NeuronId
```

#### Neuron Creation

```motoko
// Stake ICP from this canister's balance to create a neuron
// amount_e8s: amount in e8s (1 ICP = 100_000_000 e8s)
// dissolve_delay_seconds: initial dissolve delay (min 6 months for voting)
stakeNeuron(amount_e8s: Nat64, dissolve_delay_seconds: Nat64): async StakeNeuronResult
```

#### Neuron Information

```motoko
// Get full neuron info from governance
getNeuronInfo(): async ?NeuronInfo

// Get current stake
getStake(): async ?Nat64

// Get maturity
getMaturity(): async ?Nat64

// Get voting power  
getVotingPower(): async ?Nat64

// Get dissolve state
getDissolveState(): async ?DissolveState

// Get age bonus
getAgeSeconds(): async ?Nat64
```

#### Stake Management

```motoko
// Increase stake by transferring from canister balance to neuron
increaseStake(amount_e8s: Nat64): async OperationResult

// Refresh stake (claim any ICP sent directly to neuron's subaccount)
refreshStake(): async OperationResult
```

#### Dissolve Management

```motoko
// Set the dissolve delay (can only increase, never decrease)
// Must be at least 6 months (15778800 seconds) for voting power
setDissolveDelay(seconds: Nat64): async OperationResult

// Start dissolving the neuron
startDissolving(): async OperationResult

// Stop dissolving (re-lock the neuron)
stopDissolving(): async OperationResult
```

#### Disburse (Withdraw)

```motoko
// Disburse neuron to a specific account
// Only works if neuron is fully dissolved
// If amount is null, disburses entire stake
// If to_account is null, disburses to this canister's account
disburse(amount_e8s: ?Nat64, to_account: ?AccountIdentifier): async DisburseResult

// Withdraw ICP from canister balance to external account
// (For ICP that's in the canister, not staked in neuron)
withdrawIcp(amount_e8s: Nat64, to_account: AccountIdentifier): async DisburseResult
```

#### Maturity Management

```motoko
// Spawn maturity into a new neuron
// percentage: 1-100, percentage of maturity to spawn
spawnMaturity(percentage: Nat32): async SpawnResult

// Merge maturity into stake (increases stake without locking new ICP)
mergeMaturity(percentage: Nat32): async OperationResult

// Stake maturity (convert maturity to staked ICP)
stakeMaturity(percentage: Nat32): async OperationResult

// Disburse maturity to an account
disburseMaturity(percentage: Nat32, to_account: ?AccountIdentifier): async OperationResult
```

#### Voting

```motoko
// Vote on a proposal
vote(proposal_id: Nat64, vote: Vote): async OperationResult

// Set following for a topic
// followees: list of neuron IDs to follow for this topic
setFollowing(topic: Topic, followees: [NeuronId]): async OperationResult

// Get current followees for a topic
getFollowees(topic: Topic): async [NeuronId]
```

#### Hot Key Management

```motoko
// Add a hot key (can vote but not manage stake)
addHotKey(principal: Principal): async OperationResult

// Remove a hot key
removeHotKey(principal: Principal): async OperationResult

// Get current hot keys
getHotKeys(): async [Principal]
```

#### Neuron Splitting/Merging

```motoko
// Split neuron into two
// amount_e8s: amount to transfer to new neuron
// Returns the new neuron ID (managed by this same canister)
splitNeuron(amount_e8s: Nat64): async SplitResult

// Merge another neuron into this one
// The source neuron must also be controlled by this canister
mergeNeurons(source_neuron_id: NeuronId): async OperationResult
```

#### Auto-Stake Maturity Configuration

```motoko
// Configure automatic maturity staking
// percentage: 0-100, percentage of new maturity to auto-stake
setAutoStakeMaturity(percentage: Nat32): async OperationResult
```

---

## User Flows

### Flow 1: Create Manager and Stake New Neuron

1. User calls `factory.createNeuronManager()`
2. User receives their canister ID and account ID
3. User transfers ICP to the canister's account ID
4. User calls `manager.stakeNeuron(amount, dissolveDelay)`
5. Neuron is created, user can now manage it

### Flow 2: Increase Neuron Stake

**Option A: Through canister**
1. User sends ICP to canister account ID
2. User calls `manager.increaseStake(amount)`

**Option B: Direct to neuron**
1. User sends ICP directly to neuron's subaccount on ledger
2. User calls `manager.refreshStake()` to claim it

### Flow 3: Dissolve and Withdraw

1. User calls `manager.startDissolving()`
2. User waits for dissolve delay to pass
3. User calls `manager.disburse(null, recipientAccount)`
4. ICP is transferred to recipient

### Flow 4: Transfer Neuron Ownership

1. Current owner uses IC management canister to change controller
2. New controller now has full access to the neuron manager
3. (Neuron ownership effectively transferred)

### Flow 5: Upgrade Manager Canister

1. Factory releases new version, updates `managerWasm` and version
2. User sees their version vs current version
3. User downloads new WASM or uses upgrade helper
4. User upgrades their canister (they are controller)

---

## Security Considerations

### Access Control
- All neuron operations require being the canister controller
- Hot keys can only vote, not manage stake or dissolve
- Factory cannot access user canisters after creation

### Funds Safety
- ICP sent to canister can be withdrawn by controller
- ICP staked in neuron follows NNS rules (dissolve delay)
- No admin backdoors in user canisters

### Upgrade Safety
- Users control their own upgrades
- Version tracking helps users know when updates available
- Factory tracks versions for compatibility

---

## Constants Reference

| Constant | Value | Description |
|----------|-------|-------------|
| Governance Canister | `rrkah-fqaaa-aaaaa-aaaaq-cai` | NNS Governance |
| Ledger Canister | `ryjl3-tyaaa-aaaaa-aaaba-cai` | ICP Ledger |
| Min Stake | 1 ICP (100_000_000 e8s) | Minimum to create neuron |
| ICP Fee | 0.0001 ICP (10_000 e8s) | Ledger transfer fee |
| Min Dissolve (voting) | 6 months (15,778,800 s) | Min for voting power |
| Max Dissolve | 8 years (252,460,800 s) | Max dissolve delay |

---

## Future Enhancements

- [ ] Payment system for canister creation (ICP -> cycles)
- [ ] Specify destination wallet for maturity disbursement
- [ ] Batch operations for managing multiple neurons
- [ ] Notification system for proposals
- [ ] Auto-voting based on rules
- [ ] Community neuron features (shared control)
- [ ] Integration with app_sneeddao_backend for unified frontend

---

## Implementation Priority

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

