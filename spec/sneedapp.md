# Sneedapp — Multi-App Factory Specification

## 1. Overview

The **Sneedapp** canister (`IcpNeuronManagerFactory`) currently serves as a factory for a single app — the ICP Staking Bot. This spec extends it to support **any number of apps**, each with its own versioned WASM registry, pricing, and minting configuration.

### Goals

- **Multi-app support**: Admin can register named apps, each with independent versions, pricing, and WASM blobs.
- **Per-version WASM storage**: Each app version can optionally have its WASM blob uploaded, replacing the single-WASM-per-canister model.
- **Immutable mint log**: A permanent, indexed record of every canister minted — who minted it, what app/version, when — with fast canister-ID lookup.
- **Mutable user wallet**: Per-user list of registered canisters (bookmarks), now storing which app each canister belongs to.
- **Backward compatibility**: All existing ICP Staking Bot structures, APIs, and the `/create_icp_neuron` page remain intact and functional. New structures are additive.
- **Generic minting page**: A new `/sneedapp` page that lets users browse apps, view versions, and mint canisters from any app.

---

## 2. App Registry

### Data Model

```
AppInfo = {
    appId: Text;                     // Unique machine identifier (e.g., "icp-staking-bot", "trading-bot")
    name: Text;                      // Human-readable display name
    description: Text;               // Short description
    iconUrl: ?Text;                  // Optional app icon URL

    // Pricing (in ICP e8s)
    mintPriceE8s: Nat64;             // Price for regular users
    premiumMintPriceE8s: Nat64;      // Price for Sneed Premium members

    // URLs for user-facing pages
    // May contain "CANISTER_ID" placeholder that is replaced with the actual canister ID
    viewUrl: ?Text;                  // URL to view a canister (e.g., "/icp_neuron_manager/CANISTER_ID")
    manageUrl: ?Text;                // URL to manage a canister (may be same as viewUrl)
    mintUrl: ?Text;                  // Custom minting page URL (null = use generic /sneedapp minting page)

    // Metadata
    createdAt: Int;                  // Timestamp when the app was registered
    enabled: Bool;                   // Whether minting is currently enabled for this app
}
```

### Storage

```
Stable var:
  var apps: [AppInfo]                // List of registered apps
```

### Admin API

```motoko
// App CRUD
getApps() : async [AppInfo]                                     // Public: list all apps
getApp(appId: Text) : async ?AppInfo                             // Public: get single app
addApp(app: AppInfo) : async ()                                  // Admin: register a new app
updateApp(appId: Text, app: AppInfo) : async ()                  // Admin: update app info
removeApp(appId: Text) : async ()                                // Admin: remove an app (must have 0 minted canisters)
setAppEnabled(appId: Text, enabled: Bool) : async ()             // Admin: enable/disable minting
setAppPricing(appId: Text, mintPriceE8s: Nat64, premiumMintPriceE8s: Nat64) : async ()
```

---

## 3. App Versions

### Data Model

Each app has an ordered list of versions. Each version can optionally store a WASM blob.

```
AppVersion = {
    major: Nat;
    minor: Nat;
    patch: Nat;

    // Identifiers
    wasmHash: Text;                   // SHA256 hex hash of the WASM (if uploaded)

    // Links
    wasmUrl: ?Text;                   // URL to download the WASM externally
    sourceUrl: ?Text;                 // URL to source code (e.g., GitHub release)

    // New fields (vs old OfficialVersion)
    releaseNotes: Text;               // Markdown release notes
    releaseDate: Int;                 // Timestamp of the release

    // WASM blob
    wasmBlob: ?Blob;                  // The actual WASM module (null = not uploaded yet)
    wasmSize: Nat;                    // Size of WASM blob in bytes (0 if not uploaded)
}
```

### Storage

```
Stable var:
  var appVersions: [(Text, [AppVersion])]   // appId -> list of versions (newest first)
```

Note: The `wasmBlob` field stores the actual WASM binary. This can be large (1-5 MB per version). The canister should have sufficient memory allocated. Old versions' WASM blobs can optionally be cleared to save memory while keeping the version metadata.

### Version API

```motoko
// Public queries (wasmBlob is excluded from query responses to save bandwidth)
getAppVersions(appId: Text) : async [AppVersionInfo]             // List all versions (no blobs)
getAppVersion(appId: Text, major: Nat, minor: Nat, patch: Nat) : async ?AppVersionInfo
getLatestAppVersion(appId: Text) : async ?AppVersionInfo         // Latest version with a WASM blob
hasAppVersionWasm(appId: Text, major: Nat, minor: Nat, patch: Nat) : async Bool

// Admin mutations
addAppVersion(appId: Text, version: AppVersionInput) : async ()  // Add a new version
updateAppVersion(appId: Text, major: Nat, minor: Nat, patch: Nat, input: AppVersionInput) : async ()
removeAppVersion(appId: Text, major: Nat, minor: Nat, patch: Nat) : async ()
uploadAppVersionWasm(appId: Text, major: Nat, minor: Nat, patch: Nat, wasm: Blob) : async ()
clearAppVersionWasm(appId: Text, major: Nat, minor: Nat, patch: Nat) : async ()  // Free memory
```

`AppVersionInfo` is the same as `AppVersion` but with `wasmBlob` replaced by a boolean `hasWasm: Bool`.

`AppVersionInput` omits `wasmBlob`, `wasmSize`, and `wasmHash` (hash is computed on upload).

---

## 4. Immutable Mint Log

### Purpose

An **append-only** log of every canister minted through the factory, across all apps. This is separate from the mutable user wallet (bookmarks). The mint log is immutable — entries can never be deleted or modified.

### Data Model

```
MintLogEntry = {
    index: Nat;                       // Sequential, monotonically increasing
    canisterId: Principal;            // The minted canister
    minter: Principal;                // Who minted it
    appId: Text;                      // Which app
    versionMajor: Nat;               // Version at time of minting
    versionMinor: Nat;
    versionPatch: Nat;
    mintedAt: Int;                    // Timestamp
    icpPaidE8s: Nat64;               // How much was paid
    wasPremium: Bool;                 // Whether premium pricing was used
}
```

### Storage

```
Stable var:
  var mintLog: [MintLogEntry]                         // Append-only log
  var mintLogNextIndex: Nat                           // Next index to assign

  // Fast lookup index: canister ID -> mint log index
  // Allows O(1) lookup to check if a canister was minted by us
  var mintLogIndex: [(Principal, Nat)]                // canisterId -> index in mintLog
```

The `mintLogIndex` is stored as a stable array but used as a transient HashMap at runtime for fast lookups.

### API

```motoko
// Public queries
getMintLog(params: MintLogQuery) : async MintLogResult           // Paginated, filterable
getMintLogEntry(index: Nat) : async ?MintLogEntry                // By index
lookupMintedCanister(canisterId: Principal) : async ?MintLogEntry // By canister ID (fast)
wasMintedByUs(canisterId: Principal) : async Bool                 // Quick check
getMintLogCount() : async Nat
getMintLogCountForApp(appId: Text) : async Nat
```

```
MintLogQuery = {
    startIndex: ?Nat;
    limit: ?Nat;                      // Max 100
    appIdFilter: ?Text;               // Filter by app
    minterFilter: ?Principal;         // Filter by minter
    fromTime: ?Int;
    toTime: ?Int;
}

MintLogResult = {
    entries: [MintLogEntry];
    totalCount: Nat;
    hasMore: Bool;
}
```

---

## 5. User Wallet (Enhanced Bookmarks)

### Current State

The current `userRegistrations` maps `Principal -> [Principal]` (user -> list of canister IDs). This is a flat list of canister IDs without knowing which app they belong to.

### Enhanced Model

The new user wallet stores which app each canister belongs to:

```
UserCanisterEntry = {
    canisterId: Principal;
    appId: Text;                      // Which app this canister was minted from (or "" for legacy/unknown)
}
```

### Storage

```
Stable var:
  var userWallet: [(Principal, [UserCanisterEntry])]  // user -> list of entries
```

The existing `userRegistrations` is kept for backward compatibility and will be migrated on upgrade.

### Migration Strategy

On `postupgrade`:
1. If `userRegistrationsStable` has entries and `userWallet` is empty, migrate them.
2. Each legacy `Principal` (canister ID) becomes a `UserCanisterEntry` with `appId = "icp-staking-bot"` (default assumption).
3. After migration, `userRegistrationsStable` is cleared.

### API

```motoko
// User-facing
getMyWallet() : async [UserCanisterEntry]
registerCanister(canisterId: Principal, appId: Text) : async { #Ok; #Err: Text }
deregisterCanister(canisterId: Principal) : async { #Ok; #Err: Text }
transferCanister(canisterId: Principal, newOwner: Principal) : async { #Ok; #Err: Text }

// "For" methods (authorized callers)
registerCanisterFor(user: Principal, canisterId: Principal, appId: Text) : async { #Ok; #Err: Text }
deregisterCanisterFor(user: Principal, canisterId: Principal) : async { #Ok; #Err: Text }

// Backward-compatible aliases (delegate to new methods with appId = "")
getMyManagers() : async [Principal]                   // Returns just canister IDs
registerManager(canisterId: Principal) : ...          // Delegates with appId = ""
deregisterManager(canisterId: Principal) : ...        // Unchanged
```

---

## 6. Generic Minting (Multi-App Factory)

### Minting Function

```motoko
mintCanister(appId: Text, versionMajor: ?Nat, versionMinor: ?Nat, versionPatch: ?Nat) : async MintResult
```

If version is null/null/null, mints from the latest version that has a WASM blob. If a specific version is provided, mints from that version (must have a WASM blob).

### MintResult

```
MintResult = {
    #Ok: { canisterId: Principal; accountId: Blob };
    #Err: MintError;
}

MintError = {
    #AppNotFound;
    #AppDisabled;
    #VersionNotFound;
    #NoWasmForVersion;
    #InsufficientPayment: { required: Nat64; provided: Nat64 };
    #InsufficientCycles;
    #CanisterCreationFailed: Text;
    #TransferFailed: Text;
}
```

### Minting Flow

1. **Validate app**: Check `appId` exists and is enabled.
2. **Resolve version**: Find the requested version (or latest with WASM blob).
3. **Check WASM**: Ensure the version has a WASM blob.
4. **Check premium status**: Determine applicable price.
5. **Process payment**: Same flow as current `createNeuronManager` — check user's payment subaccount balance, transfer ICP for cycles + fee to destination.
6. **Create canister**: Create via management canister, install WASM, set user as sole controller.
7. **Record in mint log**: Append immutable entry.
8. **Add to user wallet**: Auto-register in user's wallet.
9. **Return result**.

### Payment Details

Each app has its own pricing (`mintPriceE8s` / `premiumMintPriceE8s`). The global `targetCyclesAmount`, `feeDestination`, and `canisterCreationCycles` settings are shared across all apps (they control infrastructure costs, not app-specific pricing).

The payment subaccount system is unchanged — users send ICP to their principal-derived subaccount on the factory canister, then call `mintCanister`.

---

## 7. Frontend Pages

### `/sneedapp` — App Browser & Minting Hub

The main landing page for the multi-app system.

**Layout**:
- **App Grid**: Cards showing each enabled app with name, description, icon, and pricing.
- **My Canisters**: User's minted canisters grouped by app, with View/Manage links.
- **Mint Button**: Each app card has a "Mint" button that goes to the app's custom mint page (if set) or opens the generic minting flow.

### `/sneedapp/mint/:appId` — Generic Minting Page

Used when an app doesn't have a custom `mintUrl`.

**Steps** (wizard):
1. **Select Version**: Shows app versions with release notes. Defaults to latest with WASM. Can expand to see older versions.
2. **Fund Wallet**: Show creation price (with premium discount if applicable). User deposits ICP to payment subaccount.
3. **Configure Gas**: Optional extra ICP for additional cycles (same as current system).
4. **Confirm & Create**: Summary of app, version, price, gas. Execute payment + minting.
5. **Success**: Show canister ID, View/Manage links.

### `/sneedapp/admin` — Admin Dashboard

**Tabs**:
1. **Apps**: CRUD for apps — add/edit/remove apps, set pricing, toggle enabled.
2. **Versions**: Per-app version management — add versions, upload WASM blobs, set release notes.
3. **Mint Log**: Browse immutable mint log with filters (app, user, time range).
4. **Config**: Global settings (target cycles, fee destination, premium canister ID, etc.).
5. **Legacy**: Link to existing `/admin/icp_neuron_manager` for old admin functions.

### Existing pages — Unchanged

- `/create_icp_neuron` — Existing ICP Staking Bot creation page (unchanged).
- `/admin/icp_neuron_manager` — Existing admin page (unchanged).
- All existing routes continue to work.

---

## 8. Stable Variables Summary (New Additions)

All new variables are additive — no existing variables are modified.

```motoko
// App Registry
var apps: [AppInfo] = [];

// App Versions (per-app)
var appVersions: [(Text, [AppVersion])] = [];

// Immutable Mint Log
var mintLog: [MintLogEntry] = [];
var mintLogNextIndex: Nat = 0;
var mintLogIndex: [(Principal, Nat)] = [];          // canisterId -> mintLog index

// Enhanced User Wallet
var userWallet: [(Principal, [UserCanisterEntry])] = [];
```

Transient (rebuilt on every canister start):
```motoko
transient var mintLogIndexMap = HashMap<Principal, Nat>(...);     // Fast lookup from mintLogIndex
transient var userWalletMap = HashMap<Principal, [UserCanisterEntry]>(...); // Fast lookup from userWallet
```

---

## 9. Backward Compatibility

### Existing Functions — Unchanged

All of these continue to work exactly as before:

- `createNeuronManager()` — Still creates ICP Staking Bot canisters using the old single-WASM system. Also records an entry in the new mint log.
- `getMyManagers()` — Returns canister IDs from both old `userRegistrations` and new `userWallet`.
- `registerManager()` / `deregisterManager()` — Delegate to new wallet with `appId = ""`.
- `setManagerWasm()` / `getCurrentVersion()` / etc. — Unchanged, control the old single-WASM system.
- `getCreationLog()` / `getFinancialLog()` — Unchanged, continue to log old-system creations.
- All payment config, premium config, admin management — Unchanged.

### Bridge: Old `createNeuronManager` → New Mint Log

When `createNeuronManager` successfully creates a canister, it should also:
1. Append a `MintLogEntry` with `appId = "icp-staking-bot"` and the current version.
2. Add a `UserCanisterEntry` to the minter's wallet.

This ensures the new mint log is a complete record of all canisters ever minted.

---

## 10. Implementation Plan

### Phase 1: New Types
- Add `AppInfo`, `AppVersion`, `AppVersionInfo`, `AppVersionInput`, `MintLogEntry`, `MintLogQuery`, `MintLogResult`, `UserCanisterEntry`, `MintResult`, `MintError` types.

### Phase 2: App Registry & Versions
- Stable vars for `apps` and `appVersions`.
- Admin CRUD API for apps and versions.
- WASM blob upload/clear per version.

### Phase 3: Immutable Mint Log
- Stable vars for `mintLog`, `mintLogNextIndex`, `mintLogIndex`.
- Transient HashMap for fast canister-ID lookup.
- Query API with filtering and pagination.
- Bridge: `createNeuronManager` also writes to mint log.

### Phase 4: Enhanced User Wallet
- Stable var for `userWallet`.
- Migration from `userRegistrations` on upgrade.
- New API methods (`getMyWallet`, `registerCanister`, etc.).
- Backward-compat wrappers for old API.

### Phase 5: Generic Minting
- `mintCanister()` function with full payment flow.
- Reuses existing payment infrastructure (subaccounts, CMC top-up, fee destination).

### Phase 6: Frontend — `/sneedapp` Pages
- App browser with cards.
- Generic minting wizard.
- Admin dashboard for apps, versions, mint log.
- My Canisters view with app grouping.

---

## Appendix A: URL Placeholder Pattern

App URLs use `CANISTER_ID` as a placeholder:

```
viewUrl: "/icp_neuron_manager/CANISTER_ID"
manageUrl: "/icp_neuron_manager/CANISTER_ID/admin"
mintUrl: "/create_icp_neuron"
```

The frontend replaces `CANISTER_ID` with the actual canister principal text when generating links:

```javascript
const viewLink = app.viewUrl.replace('CANISTER_ID', canisterId.toText());
```

## Appendix B: Example Apps Configuration

```
ICP Staking Bot:
  appId: "icp-staking-bot"
  name: "ICP Staking Bot"
  mintPriceE8s: 100_000_000 (1 ICP)
  premiumMintPriceE8s: 50_000_000 (0.5 ICP)
  viewUrl: "/icp_neuron_manager/CANISTER_ID"
  manageUrl: "/icp_neuron_manager/CANISTER_ID"
  mintUrl: "/create_icp_neuron"

Trading Bot:
  appId: "trading-bot"
  name: "Sneed Trading Bot"
  mintPriceE8s: 200_000_000 (2 ICP)
  premiumMintPriceE8s: 100_000_000 (1 ICP)
  viewUrl: "/trading_bot/CANISTER_ID"
  manageUrl: "/trading_bot/CANISTER_ID"
  mintUrl: null (uses generic /sneedapp/mint/trading-bot)
```
