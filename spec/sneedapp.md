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
  numericAppId: 0
  publisherId: 0 (Sneed DAO)
  name: "ICP Staking Bot"
  mintPriceE8s: 100_000_000 (1 ICP)
  premiumMintPriceE8s: 50_000_000 (0.5 ICP)
  viewUrl: "/icp_neuron_manager/CANISTER_ID"
  manageUrl: "/icp_neuron_manager/CANISTER_ID"
  mintUrl: "/create_icp_neuron"
  families: ["sneed-bots"]

Trading Bot:
  appId: "trading-bot"
  numericAppId: 1
  publisherId: 0 (Sneed DAO)
  name: "Sneed Trading Bot"
  mintPriceE8s: 200_000_000 (2 ICP)
  premiumMintPriceE8s: 100_000_000 (1 ICP)
  viewUrl: "/trading_bot/CANISTER_ID"
  manageUrl: "/trading_bot/CANISTER_ID"
  mintUrl: null (uses generic /sneedapp/mint/trading-bot)
  families: ["sneed-bots"]
```

---

## 11. Publisher System

### 11.1 Overview

A **publisher** represents an entity (individual, team, or DAO) that publishes apps on the Sneed App Store. Publishers manage their own apps, versions, and receive revenue from minting. Sneed DAO takes a configurable cut of each mint.

Publisher 0 is reserved for **Sneed DAO** itself. When an app belongs to publisher 0, the entire payment goes to Sneed DAO's account with no cut/split logic — preserving the current behavior.

### 11.2 Publisher Data Model

```
PublisherInfo = {
    publisherId: Nat;                 // Auto-incrementing numeric ID (0 = Sneed DAO)
    name: Text;                       // Display name (e.g., "Sneed DAO", "ICVC Labs")
    description: Text;                // Short description of the publisher
    websiteUrl: ?Text;                // Publisher website
    logoUrl: ?Text;                   // Publisher logo/avatar URL
    links: [(Text, Text)];            // Additional links as (label, url) pairs

    owners: [Principal];              // Principals who can manage this publisher and its apps
    verified: Bool;                   // Verified by Sneed DAO admins (admin-editable only)

    families: [Text];                 // Family tags available for this publisher's apps

    defaultPaymentAccount: Account;   // ICRC1 account where publisher revenue is withdrawn to
    daoCutBasisPoints: Nat;           // DAO cut in basis points (1000 = 10%), admin-editable only

    createdAt: Int;                   // Timestamp
}
```

**Key rules:**
- `publisherId` is assigned by the canister (auto-increment). Cannot be changed.
- `verified` can only be set by sneedapp admins.
- `daoCutBasisPoints` defaults to 1000 (10%) and can only be changed by sneedapp admins.
- `owners` can be modified by existing owners (add/remove) or by admins.
- `families` are managed by publisher owners. Apps belonging to this publisher can only use tags from this list.

### 11.3 Publisher Storage

```
Stable var:
  var publishers: [(Nat, PublisherInfo)] = [];    // publisherId -> info
  var nextPublisherId: Nat = 1;                   // Next ID to assign (0 is pre-created for Sneed DAO)
```

Runtime (transient):
```motoko
transient var publisherMap = HashMap<Nat, PublisherInfo>(...);
transient var nextPublisherIdMut: Nat = 1;
```

### 11.4 Publisher API

```motoko
// Public queries
getPublisher(publisherId: Nat) : async ?PublisherInfo
getPublishers() : async [PublisherInfo]                              // All publishers
getVerifiedPublishers() : async [PublisherInfo]                      // Only verified
getPublishersByOwner(owner: Principal) : async [PublisherInfo]       // Publishers owned by a principal

// Publisher creation (anyone can create)
createPublisher(input: CreatePublisherInput) : async { #Ok: Nat; #Err: Text }
    // Returns the new publisherId. Caller is automatically added as owner.
    // Publisher starts unverified with daoCutBasisPoints = 1000 (10%).

// Publisher owner mutations
updatePublisher(publisherId: Nat, input: UpdatePublisherInput) : async { #Ok; #Err: Text }
    // Owners can update: name, description, websiteUrl, logoUrl, links, defaultPaymentAccount
    // Cannot change: publisherId, verified, daoCutBasisPoints, owners (use dedicated methods)

addPublisherOwner(publisherId: Nat, newOwner: Principal) : async { #Ok; #Err: Text }
removePublisherOwner(publisherId: Nat, ownerToRemove: Principal) : async { #Ok; #Err: Text }
    // Must keep at least one owner

// Publisher family management (owner only)
addPublisherFamily(publisherId: Nat, family: Text) : async { #Ok; #Err: Text }
removePublisherFamily(publisherId: Nat, family: Text) : async { #Ok; #Err: Text }
    // Removing a family also removes it from all of this publisher's apps

// Admin-only mutations
verifyPublisher(publisherId: Nat) : async ()
unverifyPublisher(publisherId: Nat) : async ()
setPublisherDaoCut(publisherId: Nat, basisPoints: Nat) : async ()   // 0-10000
adminUpdatePublisher(publisherId: Nat, info: PublisherInfo) : async ()  // Full override
```

```
CreatePublisherInput = {
    name: Text;
    description: Text;
    websiteUrl: ?Text;
    logoUrl: ?Text;
    links: [(Text, Text)];
    defaultPaymentAccount: Account;
}

UpdatePublisherInput = {
    name: Text;
    description: Text;
    websiteUrl: ?Text;
    logoUrl: ?Text;
    links: [(Text, Text)];
    defaultPaymentAccount: Account;
}
```

### 11.5 Publisher 0: Sneed DAO

Publisher 0 is pre-created on canister initialization with:
```
{
    publisherId = 0;
    name = "Sneed DAO";
    description = "Official Sneed DAO apps";
    websiteUrl = ?"https://sneed.xyz";
    logoUrl = null;
    links = [];
    owners = admins;              // Sneed DAO admins
    verified = true;
    families = ["sneed-bots"];    // Initial family for ICP Staking Bot + Trading Bot
    defaultPaymentAccount = feeDestination;   // Same as existing fee destination
    daoCutBasisPoints = 10000;    // 100% — Sneed DAO keeps everything (no split)
    createdAt = Time.now();
}
```

When `publisherId == 0`, the payment flow is simplified: the entire profit goes to `feeDestination` with no split. This preserves exact backward compatibility with the existing behavior.

---

## 12. Publisher Families

### 12.1 Concept

Families are string tags that signal **capabilities** shared across multiple apps. They act like "interfaces" — if an app has a family tag, the frontend (or other consumers) can assume it supports a known set of features associated with that family.

**Example: `"sneed-bots"`**
- Apps in this family support: chore status queries, unseen log alert counts, bot configuration
- The Sneed DAO frontend can detect canisters belonging to `"sneed-bots"` apps in a user's wallet and query them for notification data (chore status, unseen alerts) to show in the notification bar

### 12.2 Rules

1. Each publisher maintains their own list of family tags.
2. An app can be tagged with any subset of its publisher's families.
3. Families are case-sensitive strings. Convention: lowercase-kebab-case (e.g., `"sneed-bots"`, `"defi-vaults"`).
4. Removing a family from a publisher automatically removes it from all of that publisher's apps.
5. Family tags have no enforced semantics on-chain — their meaning is defined by convention and consumed by frontends/tooling.

### 12.3 Cross-Publisher Families

In the initial implementation, families are scoped to a publisher. Two different publishers can independently use the same family string (e.g., `"sneed-bots"`), but there is no formal cross-publisher family registry. If standardization is needed later, a global family registry can be added.

---

## 13. Updated App Registry

### 13.1 Changes from Section 2

Apps now have:
- **Numeric app ID** (`numericAppId: Nat`) — auto-incrementing, used in payment subaccounts and all stored references.
- **Publisher reference** (`publisherId: Nat`) — which publisher owns this app.
- **Family tags** (`families: [Text]`) — subset of the publisher's families.
- **Payment override** (`paymentAccount: ?Account`) — optional per-app payment destination (overrides publisher default).
- **DAO cut override** (`daoCutBasisPoints: ?Nat`) — optional per-app DAO cut (overrides publisher default, admin-editable only).

The string `appId` remains as a human-readable slug/identifier for URLs and display. The `numericAppId` is the canonical reference for storage and payment derivation.

### 13.2 Updated AppInfo Type

```
AppInfo = {
    appId: Text;                      // Unique string slug (e.g., "icp-staking-bot")
    numericAppId: Nat;                // Auto-incrementing numeric ID (assigned by canister)
    publisherId: Nat;                 // Publisher that owns this app

    name: Text;                       // Human-readable display name
    description: Text;                // Short description
    iconUrl: ?Text;                   // Optional app icon URL

    // Pricing (in ICP e8s)
    mintPriceE8s: Nat64;              // Price for regular users
    premiumMintPriceE8s: Nat64;       // Price for Sneed Premium members

    // URLs for user-facing pages
    viewUrl: ?Text;                   // URL to view a canister (CANISTER_ID placeholder)
    manageUrl: ?Text;                 // URL to manage a canister
    mintUrl: ?Text;                   // Custom minting page URL (null = generic)

    // Families (capability tags)
    families: [Text];                 // Subset of publisher's families

    // Payment overrides (null = use publisher defaults)
    paymentAccount: ?Account;         // Override publisher's default payment destination
    daoCutBasisPoints: ?Nat;          // Override publisher's default DAO cut (admin-only)

    // Metadata
    createdAt: Int;                   // Timestamp when the app was registered
    enabled: Bool;                    // Whether minting is currently enabled
}
```

### 13.3 Updated Storage

```
Stable var:
  var apps: [AppInfo] = [];                          // All apps
  var nextAppId: Nat = 0;                            // Next numeric app ID to assign
```

Runtime:
```motoko
transient var appByNumericId = HashMap<Nat, AppInfo>(...);   // numericAppId -> AppInfo
transient var appByStringId = HashMap<Text, Nat>(...);       // appId (slug) -> numericAppId
```

### 13.4 Updated Permission Model

App management is now split between **publisher owners** and **admins**:

| Operation | Publisher Owners | Admins |
|---|---|---|
| Add app (for their publisher) | Yes | Yes |
| Update app info (name, description, URLs, pricing, families) | Yes | Yes |
| Enable/disable minting | Yes | Yes |
| Set app pricing | Yes | Yes |
| Set app families | Yes (from publisher's families only) | Yes |
| Set app payment account override | Yes | Yes |
| Set app DAO cut override | No | Yes |
| Remove app | No | Yes |
| Manage app versions | Yes | Yes |
| Upload WASM blobs | Yes | Yes |

### 13.5 Updated App API

```motoko
// Existing public queries — unchanged signatures but AppInfo now includes new fields
getApps() : async [AppInfo]
getApp(appId: Text) : async ?AppInfo
getAppByNumericId(numericAppId: Nat) : async ?AppInfo
getAppsByPublisher(publisherId: Nat) : async [AppInfo]
getAppsByFamily(family: Text) : async [AppInfo]

// App creation — publisher owner or admin
addApp(publisherId: Nat, app: AddAppInput) : async { #Ok: Nat; #Err: Text }
    // Returns numericAppId. Caller must be owner of publisherId or admin.
    // numericAppId is assigned automatically.

// App updates — publisher owner or admin
updateApp(numericAppId: Nat, input: UpdateAppInput) : async { #Ok; #Err: Text }
setAppEnabled(numericAppId: Nat, enabled: Bool) : async { #Ok; #Err: Text }
setAppPricing(numericAppId: Nat, mintPrice: Nat64, premiumMintPrice: Nat64) : async { #Ok; #Err: Text }
setAppFamilies(numericAppId: Nat, families: [Text]) : async { #Ok; #Err: Text }
setAppPaymentAccount(numericAppId: Nat, account: ?Account) : async { #Ok; #Err: Text }

// Admin-only
setAppDaoCut(numericAppId: Nat, basisPoints: ?Nat) : async ()
removeApp(numericAppId: Nat) : async ()

// Version management — publisher owner or admin (same signatures as before,
// but now checks publisher ownership in addition to admin)
addAppVersion(appId: Text, input: AppVersionInput) : async { #Ok; #Err: Text }
uploadAppVersionWasm(appId: Text, major: Nat, minor: Nat, patch: Nat, wasm: Blob) : async { #Ok; #Err: Text }
// ... etc (see Section 3)
```

```
AddAppInput = {
    appId: Text;                      // String slug — must be unique
    name: Text;
    description: Text;
    iconUrl: ?Text;
    mintPriceE8s: Nat64;
    premiumMintPriceE8s: Nat64;
    viewUrl: ?Text;
    manageUrl: ?Text;
    mintUrl: ?Text;
    families: [Text];                 // Must be subset of publisher's families
}

UpdateAppInput = {
    name: Text;
    description: Text;
    iconUrl: ?Text;
    mintPriceE8s: Nat64;
    premiumMintPriceE8s: Nat64;
    viewUrl: ?Text;
    manageUrl: ?Text;
    mintUrl: ?Text;
    families: [Text];
}
```

---

## 14. Payment & Revenue System

### 14.1 Sneed DAO Payment Account

The existing `feeDestination` (`T.Account`) serves as the **Sneed DAO payment account**. This is where:
- 100% of profit goes for publisher 0 (Sneed DAO) apps — same as current behavior.
- The DAO cut goes for all other publishers' apps.

It remains admin-editable via `setFeeDestination()`.

### 14.2 DAO Cut Configuration

Each publisher has a `daoCutBasisPoints` (default: 1000 = 10%). Each app can optionally override this with its own `daoCutBasisPoints`.

The **effective DAO cut** for an app is:
```
effectiveDaoCut = app.daoCutBasisPoints ?? publisher.daoCutBasisPoints
```

Both values are **admin-editable only** — publisher owners cannot change them.

Special case: Publisher 0 has `daoCutBasisPoints = 10000` (100%). This means all profit goes to Sneed DAO, matching the current behavior.

### 14.3 Payment Subaccount Derivation

Three types of subaccounts are used. No hashing is required — all are simple byte-packed 32-byte blobs.

#### User Deposit Subaccount (unchanged)
Where users deposit ICP before minting. This is the **same** subaccount already used today — one per user, shared across all apps.

```
userDepositSubaccount(user: Principal) -> Blob {
    // Standard principal-to-subaccount derivation (unchanged):
    // [principalLen:1][principalBytes:up to 29][zeroPadding:remaining]
    principalToSubaccount(user)
}
```

Users deposit ICP once. When they mint any app, the canister checks their balance and deducts the price. Users can reclaim unspent deposits via `withdrawUserPayment()` (already implemented).

#### Publisher Revenue Subaccount
Accumulates the publisher's share from all mints (for apps using the publisher's default payment account). One per publisher.

```
publisherRevenueSubaccount(publisherId: Nat) -> Blob {
    // 32 bytes: [0x50("P"):1][publisherId big-endian:8][zeroPadding:23]
    let sub = Array.init<Nat8>(32, 0);
    sub[0] := 0x50;   // "P" tag for publisher
    // Bytes 1-8: publisherId as 8-byte big-endian
    encodeNatBigEndian8(sub, 1, publisherId);
    Blob.fromArray(Array.freeze(sub))
}
```

#### App Revenue Subaccount
Used only for apps that have an overriding `paymentAccount`. Accumulates the publisher's share for that specific app.

```
appRevenueSubaccount(publisherId: Nat, appNumericId: Nat) -> Blob {
    // 32 bytes: [0x41("A"):1][publisherId big-endian:8][appNumericId big-endian:8][zeroPadding:15]
    let sub = Array.init<Nat8>(32, 0);
    sub[0] := 0x41;   // "A" tag for app
    // Bytes 1-8: publisherId as 8-byte big-endian
    encodeNatBigEndian8(sub, 1, publisherId);
    // Bytes 9-16: appNumericId as 8-byte big-endian
    encodeNatBigEndian8(sub, 9, appNumericId);
    Blob.fromArray(Array.freeze(sub))
}
```

**Backward compatibility**: The legacy `createNeuronManager()` endpoint continues to use `principalToSubaccount(caller)` for its payment flow — no changes. The `mintCanister()` endpoint also uses `principalToSubaccount(caller)` (unchanged) for verifying the user's deposited balance.

### 14.4 Updated Minting Payment Flow

When `mintCanister(appId, ...)` is called:

1. **Resolve app and publisher**: Look up the app, get its `publisherId`, resolve the publisher.

2. **Determine pricing**: Check premium status, select `mintPriceE8s` or `premiumMintPriceE8s`.

3. **Verify payment**: Check user's deposit balance in `principalToSubaccount(caller)` (same subaccount as today — one per user, shared across all apps).

4. **Calculate cycles cost**: Dynamic CMC rate → ICP needed for target cycles.

5. **Process payment**:

   **If publisherId == 0 (Sneed DAO):**
   - Transfer cycles portion from user deposit subaccount → factory main account
   - Transfer profit from user deposit subaccount → `feeDestination`
   - Top up factory with cycles via CMC
   - (Identical to current behavior)

   **If publisherId != 0:**
   - Calculate profit: `applicableFee - cyclesCost - transferFees`
   - Calculate DAO cut: `profit * effectiveDaoCut / 10000`
   - Calculate publisher share: `profit - daoCut`
   - Transfer cycles portion from user deposit subaccount → factory main account
   - Transfer DAO cut from user deposit subaccount → `feeDestination`
   - Transfer publisher share from user deposit subaccount → revenue subaccount:
     - If app has `paymentAccount` override → `appRevenueSubaccount(publisherId, appNumericId)`
     - Else → `publisherRevenueSubaccount(publisherId)`
   - Top up factory with cycles via CMC

6. **Create canister**: Same as current (create, install WASM, set user as controller).

7. **Record**: Mint log, creation log, financial log, update stats.

### 14.5 Publisher Revenue Withdrawal

Publisher owners can withdraw accumulated revenue from their revenue subaccounts.

```motoko
// Withdraw from publisher-level revenue subaccount
withdrawPublisherFunds(publisherId: Nat) : async { #Ok: Nat; #Err: Text }
    // Caller must be a publisher owner.
    // Checks ledger balance of publisherRevenueSubaccount(publisherId).
    // Transfers (balance - fee) to publisher's defaultPaymentAccount.
    // Returns amount transferred.

// Withdraw from app-level revenue subaccount
withdrawAppFunds(publisherId: Nat, appNumericId: Nat) : async { #Ok: Nat; #Err: Text }
    // Caller must be a publisher owner.
    // Only works for apps with paymentAccount override.
    // Checks ledger balance of appRevenueSubaccount(publisherId, appNumericId).
    // Transfers (balance - fee) to the app's paymentAccount.
    // Returns amount transferred.
```

### 14.6 Payment Query Helpers

```motoko
// User deposit subaccount — unchanged from current API
getPaymentSubaccount(user: Principal) : async Blob              // Already exists
getUserPaymentBalance(user: Principal) : async Nat               // Already exists

// Publisher/app revenue subaccounts (new)
getPublisherRevenueSubaccount(publisherId: Nat) : async Blob
getAppRevenueSubaccount(publisherId: Nat, appNumericId: Nat) : async Blob

// Revenue balance queries (ledger lookups)
getPublisherRevenueBalance(publisherId: Nat) : async Nat
getAppRevenueBalance(publisherId: Nat, appNumericId: Nat) : async Nat

// Get effective DAO cut for an app (in basis points)
getEffectiveDaoCut(appId: Text) : async Nat
```

---

## 15. Revenue Stats & Tracking

### 15.1 Per-Publisher Stats

```
PublisherStats = {
    publisherId: Nat;
    totalRevenueE8s: Nat;            // Total publisher share accumulated (across all apps)
    totalWithdrawnE8s: Nat;          // Total withdrawn by publisher owners
    totalDaoCutE8s: Nat;             // Total DAO cut from this publisher's apps
    totalMintCount: Nat;             // Total canisters minted from this publisher's apps
}
```

### 15.2 Per-App Stats

```
AppRevenueStats = {
    numericAppId: Nat;
    publisherId: Nat;
    totalRevenueE8s: Nat;            // Total publisher share for this app
    totalWithdrawnE8s: Nat;          // Total withdrawn for this app (if app has payment override)
    totalDaoCutE8s: Nat;             // Total DAO cut for this app
    mintCount: Nat;                  // Canisters minted from this app
}
```

### 15.3 Sneed DAO Revenue Stats

```
DaoRevenueStats = {
    totalDaoCutReceivedE8s: Nat;     // Sum of all DAO cuts across all publishers
    totalDirectRevenueE8s: Nat;      // Revenue from publisher 0 (Sneed DAO) apps
    totalRevenueE8s: Nat;            // totalDaoCutReceivedE8s + totalDirectRevenueE8s
}
```

### 15.4 Stats Storage

```
Stable var:
  var publisherStats: [(Nat, PublisherStats)] = [];          // publisherId -> stats
  var appRevenueStats: [(Nat, AppRevenueStats)] = [];        // numericAppId -> stats
  var totalDaoCutReceivedE8s: Nat = 0;
  var totalDirectRevenueE8s: Nat = 0;
```

### 15.5 Stats API

```motoko
// Public queries
getPublisherStats(publisherId: Nat) : async ?PublisherStats
getAppRevenueStats(numericAppId: Nat) : async ?AppRevenueStats
getDaoRevenueStats() : async DaoRevenueStats

// Admin queries
getAllPublisherStats() : async [PublisherStats]
getAllAppRevenueStats() : async [AppRevenueStats]
```

### 15.6 Updated MintLogEntry

The mint log entry gains publisher context:

```
MintLogEntry = {
    index: Nat;
    canisterId: Principal;
    minter: Principal;
    appId: Text;
    numericAppId: Nat;                // New
    publisherId: Nat;                 // New
    versionMajor: Nat;
    versionMinor: Nat;
    versionPatch: Nat;
    mintedAt: Int;
    icpPaidE8s: Nat64;
    wasPremium: Bool;
    daoCutE8s: Nat64;                 // New: DAO cut for this specific mint
    publisherRevenueE8s: Nat64;       // New: publisher share for this specific mint
}
```

---

## 16. Updated Stable Variables Summary

All new variables (additions to Section 8):

```motoko
// Publishers
var publishers: [(Nat, PublisherInfo)] = [];
var nextPublisherId: Nat = 1;                        // 0 is reserved for Sneed DAO

// Updated App Registry (apps type unchanged but gains new fields)
var nextAppId: Nat = 0;                              // Auto-increment for numericAppId

// Revenue Stats
var publisherStats: [(Nat, PublisherStats)] = [];
var appRevenueStats: [(Nat, AppRevenueStats)] = [];
var totalDaoCutReceivedE8s: Nat = 0;
var totalDirectRevenueE8s: Nat = 0;
```

Transient (rebuilt on every canister start):
```motoko
transient var publisherMap = HashMap<Nat, PublisherInfo>(...);
transient var appByNumericId = HashMap<Nat, AppInfo>(...);
transient var appByStringId = HashMap<Text, Nat>(...);         // slug -> numericAppId
transient var publisherStatsMap = HashMap<Nat, PublisherStats>(...);
transient var appRevenueStatsMap = HashMap<Nat, AppRevenueStats>(...);
```

---

## 17. Updated Implementation Plan

### Phase 1a: Publisher Types & Storage
- Add `PublisherInfo`, `PublisherStats`, `CreatePublisherInput`, `UpdatePublisherInput` types.
- Add stable vars for publishers and next ID.
- Pre-create publisher 0 (Sneed DAO) on initialization.
- Publisher CRUD API with ownership checks.
- Family management API.

### Phase 1b: App Registry Update
- Add `numericAppId`, `publisherId`, `families`, `paymentAccount`, `daoCutBasisPoints` to `AppInfo`.
- Add `nextAppId` counter and lookup maps.
- Update app CRUD API for publisher-owner authorization.
- Migrate existing apps to publisher 0 with assigned numeric IDs.

### Phase 2: Payment Subaccount Derivation
- Implement SHA-256 (trivial extension of existing SHA-224).
- Implement `userPaymentSubaccount()`, `publisherRevenueSubaccount()`, `appRevenueSubaccount()`.
- Add payment query helpers.

### Phase 3: Payment Flow Update
- Update `mintCanister()` with publisher-aware payment split.
- DAO cut calculation and transfer.
- Publisher revenue accumulation in subaccounts.
- Stats tracking on each mint.

### Phase 4: Publisher Withdrawal
- `withdrawPublisherFunds()` and `withdrawAppFunds()` endpoints.
- Withdrawal stats tracking.

### Phase 5: Revenue Stats
- Implement stats storage and queries.
- Update `MintLogEntry` with publisher/revenue fields.
- Dashboard API for admins.

### Phase 6: Frontend Updates
- Publisher management pages.
- App store with publisher/family filtering.
- Revenue dashboard for publishers.
- Withdrawal UI.

---

## Appendix C: Subaccount Derivation Examples

```
User Deposit Subaccount (unchanged from current system):
  principalToSubaccount("abc-123")
  → [len, principal_bytes..., 0_padding...] (32 bytes)
  This is the SAME subaccount for ALL app purchases by this user.

Publisher Revenue Subaccount for publisher 3:
  [0x50, 0,0,0,0,0,0,0,3, 0,0,...,0] (32 bytes)
  "P" tag + publisherId in big-endian + zero padding

App Revenue Subaccount for publisher 3, app 5:
  [0x41, 0,0,0,0,0,0,0,3, 0,0,0,0,0,0,0,5, 0,0,...,0] (32 bytes)
  "A" tag + publisherId + appNumericId in big-endian + zero padding
  (Only used when an app has its own paymentAccount override)

Note: Publisher 0 (Sneed DAO) revenue subaccount exists but is not used —
profit for publisher 0 goes directly to feeDestination.
```

## Appendix D: Payment Flow Diagram

```
User deposits ICP
       │
       ▼
[User Deposit Subaccount]  ← principalToSubaccount(user) — same as today
       │
       │  mintCanister() called — checks deposit balance
       ▼
┌─────────────────┐
│ Is publisher 0?  │
└────┬────────┬───┘
     │Yes     │No
     ▼        ▼
 ┌────────┐  ┌──────────────────────────────┐
 │100% to │  │ Split profit:                 │
 │feeDest │  │  DAO cut → feeDestination     │
 │(as now)│  │  Publisher → revenue subacct   │
 └────────┘  └──────────────────────────────┘
                    │
                    ▼
            [Publisher Revenue Subaccount]  ← [0x50 || pubId]
            or [App Revenue Subaccount]    ← [0x41 || pubId || appId]
                    │
                    │  withdrawPublisherFunds() called by owner
                    ▼
            [Publisher's defaultPaymentAccount]
            or [App's paymentAccount override]

Note: Cycles portion always goes to factory main account → CMC top-up, regardless of publisher.
User can reclaim unspent deposits via withdrawUserPayment() (already exists).
```
