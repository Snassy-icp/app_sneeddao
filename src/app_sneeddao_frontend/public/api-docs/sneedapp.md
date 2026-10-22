# Sneedapp canister API

Sneedapp is Sneed DAO's app factory on the Internet Computer. It keeps a catalogue of apps (canister programs such as the Sneed ICP Staking Bot and the Sneed Trading Bot), their published versions and WASM modules, and it **mints** a fresh canister of any app for anyone who pays the app's mint fee in ICP: it creates the canister, installs the chosen version, and hands control over so that the minter is the canister's **only controller**. It also keeps a per-user list of app canisters (the "wallet" of bookmarks the Sneed app shows), an immutable mint log, and the accounts through which third-party publishers are paid for their apps.

Anyone can integrate: browsing, paying, minting and bookmarking are authorised by the calling principal only.

| | |
|---|---|
| Production canister | `sfamc-kyaaa-aaaau-adnpq-cai` |
| Staging canister | `34e6r-ayaaa-aaaad-adkoa-cai` (separate state, same code line; use it to test) |
| Candid interface | [sneedapp.did](/api-docs/sneedapp.did) · [JavaScript IDL factory](/api-docs/sneedapp.did.js) |
| Source | [src/sneedapp/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneedapp/main.mo) |
| Specification | [spec/sneedapp.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sneedapp.md) (design notes; the code is the truth) |
| Reference frontend | [app.sneeddao.com/sneedapp](https://app.sneeddao.com/sneedapp) ([source](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend)) |
| This document | [rendered](/api/sneedapp) · [raw Markdown](/api-docs/sneedapp.md) |

The production canister is controlled by the Sneed DAO SNS; upgrades are decided by proposals. The service type in the Candid file is still called `IcpNeuronManagerFactory`, after the canister's first job (minting ICP neuron manager canisters, today the Sneed ICP Staking Bot). The method set below matches the source on `main`.

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister (units and encoding, authentication, fees, transfers and irreversible actions, asynchronous flows and polling, common pitfalls) that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 Publishers, apps, versions

| Concept | Identified by | What it is |
|---|---|---|
| **Publisher** | `publisherId : nat` | Who offers apps. Publisher `0` is Sneed DAO itself (always verified, receives 100% of its apps' fees). Anyone signed in can create a publisher; it starts **unverified**. |
| **App** | `appId : text` (a slug such as `"sneed-icp-staking-bot"`) and `numericAppId : nat` | A mintable canister program with a mint fee, a discounted fee for Sneed Premium members, link templates and family tags. A new app starts **disabled**. |
| **Version** | `(appId, major, minor, patch)` | Release metadata (SHA-256 `wasmHash`, `wasmUrl`, `sourceUrl`, `releaseNotes`, `releaseDate`) plus, optionally, a WASM blob stored in Sneedapp. Only versions with a stored blob can be minted. |
| **Family** | `text` tag, e.g. `"sneed-bots"` | A capability label a publisher defines and attaches to its apps. It has no on-chain meaning; frontends use it to know which interface a canister speaks (e.g. bots with chores and logs). |

An app can be minted only when it is **enabled** and its publisher is **verified** (or is publisher 0). Verification is an admin decision: anyone can list an app, but only verified publishers make the factory spend its cycles.

Methods take the string `appId` where a user acts (mint, versions, wallet) and the `numericAppId` where a publisher manages an app (`updateApp`, `setAppPricing`, …).

### 1.2 Minted canisters belong to the minter

A minted canister is created with Sneedapp as its sole controller, the WASM is installed with an empty argument (`DIDL\00\00`), and the controller list is then replaced by `[minter]`. From that moment Sneedapp has no power over it: it cannot upgrade, stop or delete it. Upgrades are done by the owner (section 3.6).

Sneedapp records every mint in an immutable **mint log** (`lookupMintedCanister`, `wasMintedByUs`), which lets anyone check that a canister really came out of the factory and from which version.

### 1.3 The wallet is a list of bookmarks

`getMyWallet()` lists `(canisterId, appId)` entries for the caller. Minting adds an entry automatically. The list is **not** a statement of ownership: anyone can bookmark any canister (`registerCanister`), and several users can bookmark the same one. To learn who controls a canister, ask the IC (`canister_status` as a controller, or `dfx canister info`), not Sneedapp. An `appId` of `""` means unknown or legacy.

### 1.4 Payment subaccount

Mint fees are paid from a per-user ICP subaccount on Sneedapp:

`{ owner = sneedapp; subaccount = principalToSubAccount(P) }`

This is the standard 32-byte layout (`principalToSubAccount` in `@dfinity/utils`: byte 0 = length of the principal's bytes, then the bytes, zero padded); `getPaymentSubaccount(P)` returns the same blob. Anyone can deposit there with a plain ICP transfer; only `P` can withdraw it (`withdrawUserPayment`) or spend it on a mint.

### 1.5 Amounts and time

Fees and balances are ICP **e8s** (`nat64` in fee fields, `nat` in balances). The ICP ledger fee is 10,000 e8s. Timestamps (`createdAt`, `mintedAt`, `releaseDate`, `fromTime`/`toTime`) are `int` nanoseconds since the Unix epoch. Revenue shares are **basis points** (`10000` = 100%).

### 1.6 Calls the canister refuses at ingress

Before it accepts an update call from outside the IC, the canister checks it (`inspect_message`):

- **Query methods only answer query calls.** Calling a query as an update call is refused.
- **Arguments are capped.** Most methods accept at most 4 KiB of argument. `mintCanister`, `getAppMintPrice`, `registerCanister` and `registerCanisterFor` take an `appId` of at most 256 characters. `createPublisher` needs a signed (non-anonymous) caller and at most 64 KiB.
- **Publisher content is screened by caller.** `addApp`, `updatePublisher`, `addPublisherFamily`, `removePublisherFamily`, `updateApp`, `setAppFamilies` and the version methods (`addAppVersion`, `updateAppVersion`, `uploadAppVersionWasm`, `clearAppVersionWasm`, `removeAppVersion`) are only accepted from the publisher's owners and admins, so a WASM upload from anyone else is refused before it costs anything.

Canisters calling Sneedapp are not affected: the check applies to ingress only. The methods enforce the same rules themselves.

---

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './sneedapp.did.js'; // https://app.sneeddao.com/api-docs/sneedapp.did.js

const SNEEDAPP = 'sfamc-kyaaa-aaaau-adnpq-cai';

export function sneedappActor(identity) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId: SNEEDAPP });
}
```

With dfx:

```bash
dfx canister --network ic call sfamc-kyaaa-aaaau-adnpq-cai getApps '()' --query
```

### 2.2 Browse the catalogue

```js
const app = sneedappActor(identity);

const [apps, verified] = await Promise.all([app.getApps(), app.getVerifiedPublishers()]);
const verifiedIds = new Set(verified.map((p) => p.publisherId));
// What can actually be minted right now:
const mintable = apps.filter((a) => a.enabled && (a.publisherId === 0n || verifiedIds.has(a.publisherId)));

for (const a of mintable) {
  const latest = await app.getLatestAppVersion(a.appId);   // opt AppVersionInfo: highest version with a wasm
  console.log(a.appId, a.name, latest[0] && `${latest[0].major}.${latest[0].minor}.${latest[0].patch}`);
}
```

`AppInfo.viewUrl`, `manageUrl` and `mintUrl` are link templates in which the text `CANISTER_ID` stands for the minted canister's id:

```js
const link = a.viewUrl[0]?.replace('CANISTER_ID', canisterId.toText());
```

### 2.3 Mint a canister, end to end

1. Ask for the fee that applies to the user (premium or regular).
2. Top up the user's payment subaccount on Sneedapp so it holds at least that fee.
3. Call `mintCanister`.

```js
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';

const ICP_FEE = 10_000n;

async function mintApp({ identity, icpLedger, appId }) {
  const me = identity.getPrincipal();
  const factory = sneedappActor(identity);

  // 1. The fee that applies to this user (an update call: it asks Sneed Premium)
  const price = await factory.getAppMintPrice(appId, me);   // { regular; premium; applicable; isPremium }
  const need = price.applicable;                             // nat64 e8s

  // 2. Fund the payment subaccount up to `need`
  const payAccount = { owner: Principal.fromText(SNEEDAPP), subaccount: [principalToSubAccount(me)] };
  const have = await icpLedger.icrc1_balance_of(payAccount);
  if (have < need) {
    const r = await icpLedger.icrc1_transfer({
      to: payAccount, amount: need - have, fee: [ICP_FEE],
      memo: [], from_subaccount: [], created_at_time: [],
    });
    if ('Err' in r) throw new Error(JSON.stringify(r.Err));
  }

  // 3. Mint the latest version (pass [] [] [] ) or a specific one ([0n], [9n], [4n])
  const res = await factory.mintCanister(appId, [], [], []);
  if ('Err' in res) throw new Error(Object.keys(res.Err)[0]);
  return res.Ok.canisterId; // the caller is now its only controller
}
```

The canister is created and installed with the factory's cycles (`getCanisterCreationCycles()`, currently 2.5T on production) and the ICP set aside for cycles is converted back to cycles for the factory afterwards. A deposit larger than the fee stays in the subaccount for the next mint or for `withdrawUserPayment`.

### 2.4 List the user's canisters

```js
const entries = await factory.getMyWallet();              // vec { canisterId; appId }
const bots = await factory.getMyWalletForApp('sneed-trading-bot');
const proof = await factory.lookupMintedCanister(entries[0].canisterId); // opt MintLogEntry
```

---

## 3. Flows in detail

### 3.1 How a mint works

`mintCanister(appId, major, minor, patch)`:

1. **Checks** (nothing charged): the app exists (`AppNotFound`), is enabled (`AppDisabled`), its publisher exists (`PublisherNotFound`) and is verified or is publisher 0 (`PublisherNotVerified`). The version is the one named, if all three numbers are given (`VersionNotFound`), otherwise the highest version with a stored WASM (`NoWasmForVersion` if none). The version must have a WASM blob that starts with the WASM or gzip magic bytes (`NoWasmForVersion`, or `CanisterCreationFailed("The wasm of this version is not a WebAssembly module")`). The factory must hold at least the creation cycles (`InsufficientCycles`).
2. **Price**: `premiumMintPriceE8s` for a Sneed Premium member (as reported by the Sneed Premium canister, cached), otherwise `mintPriceE8s`. The caller's payment subaccount must hold at least that (`InsufficientPayment { required; provided }`).
3. **Plan**: the fee is split into ledger fees, ICP for cycles (enough to buy at least the creation cycles and at most the target cycles amount at the current CMC rate, plus 5% headroom) and the remainder ("profit"). If the CMC rate is unavailable, or the fee cannot even cover the creation cycles and ledger fees, the mint is refused with `CanisterCreationFailed(...)` and nothing is charged.
4. **Payment and creation**, in this order so that every step can be undone:
   - ICP for cycles moves from the payment subaccount to the factory's main account.
   - For a third-party app: the publisher's share moves to the publisher's (or app's) revenue subaccount on Sneedapp (3.5).
   - The canister is created (factory as sole controller) and the WASM installed.
   - The DAO's share (all of the remainder for a Sneed DAO app, the DAO cut otherwise) goes to the DAO's fee destination. This is the only transfer that leaves Sneedapp, and it runs only after installation succeeded.
   - Control is handed to the caller.
   - The ICP for cycles is sent to the CMC to top up the factory.
5. **Records**: wallet entry, mint log entry, creation and financial logs, revenue statistics.

If a step fails, the canister (if any) is stopped and deleted and everything already moved is returned to the payment subaccount, less ledger fees; the error text says so (`...; your deposit (less ledger fees) remains in your payment subaccount`). If returning it fails too, the message names the amount held inside the factory pending manual return. A canister that could be neither deleted nor handed over is recorded for the admins (`getOrphanCanisters`) to settle by hand; the hand-over error says `...it is recorded for the admins to hand over`.

When an admin has switched payment off (`getPaymentConfig().paymentRequired = false`), steps 2–4 are skipped and the factory pays the cycles.

### 3.2 Payment subaccount

- `getPaymentSubaccount(user)` (query) — the subaccount blob.
- `getUserPaymentBalance(user)` (update; reads the ledger) — the current balance in e8s.
- `withdrawUserPayment()` — sends the whole balance minus one ledger fee to the caller's default account `{ owner = caller; subaccount = null }`. Returns the ICRC-1 `TransferResult`: `Ok(block_index)`, `Err(InsufficientFunds { balance })` when the balance is at most one ledger fee, or `Err(TemporarilyUnavailable)` while a mint or another withdrawal of the caller is in flight.
- `withdrawUserToken(ledger)` — any ICRC-1 token sent by mistake to the caller's own payment subaccount: the caller's whole balance on `ledger` minus that ledger's `icrc1_fee`, to the caller's default account only. For the ICP ledger it is `withdrawUserPayment`. Same `TransferResult`; `Err(GenericError)` when `ledger` cannot be reached or is not a ledger (calls to it wait at most 60 seconds; after a timeout the outcome may be unknown, so check the balance first; the transfer carries `created_at_time`, so the ledger deduplicates a retry), `Err(TemporarilyUnavailable)` while another token withdrawal of the caller runs. Logged as `sneedapp_deposit_token_withdraw`.

### 3.3 One payment operation per user at a time

`mintCanister`, `createNeuronManager` and `withdrawUserPayment` hold a per-caller lock on the payment subaccount for the whole payment phase. A second mint during the first returns `Err(TransferFailed("A payment operation is already in progress for this account; please retry"))`; a withdrawal returns `Err(TemporarilyUnavailable)`. Retry once the first call has returned. Mints of different users run concurrently.

### 3.4 Versions and verifying what you run

Each version carries a `wasmHash` (lowercase hex SHA-256). When a blob is uploaded, Sneedapp computes its SHA-256 and refuses the upload if a declared hash differs (an empty declared hash is filled in), so `AppVersionInfo.wasmHash` of a version with `hasWasm = true` is the hash of what gets installed. Compare it with the `module_hash` the IC reports for a canister to know which version it runs (`dfx canister info <id>`, or `canister_status` as a controller).

`getAppVersions(appId)` lists versions highest first. `getLatestAppVersion(appId)` is the highest version that has a blob, which is what a mint uses by default.

The separate **official versions** registry (`getOfficialVersions`, `getOfficialVersionByHash`) is the older list of known-good ICP neuron manager WASMs (by hash, with `wasmUrl` and `sourceUrl`), kept for the legacy flow and for recognising running canisters.

### 3.5 Publishers and revenue

Anyone signed in can `createPublisher` (becoming its first owner), add co-owners, define families, add apps (`addApp`, starts disabled), publish versions and upload WASMs, set prices and enable the app. Minting starts once an admin verifies the publisher.

For a third-party publisher's app, the remainder of each mint fee (after ledger fees and the ICP for cycles) is split:

- **DAO cut**: `getEffectiveDaoCutForApp(appId)` basis points (the app's override if an admin set one, otherwise the publisher's, which defaults to `1000` = 10%), sent to the DAO's fee destination.
- **Publisher share**: the rest, kept on Sneedapp in a revenue subaccount:
  - `getPublisherRevenueSubaccount(publisherId)` = `0x50` (`"P"`), publisherId as 8 bytes big-endian, zeros (32 bytes), for apps without a payment account override;
  - `getAppRevenueSubaccount(publisherId, numericAppId)` = `0x41` (`"A"`), publisherId 8 bytes BE, numericAppId 8 bytes BE, zeros, for apps with an override (`setAppPaymentAccount`).

Owners withdraw with `withdrawPublisherFunds(publisherId)` (to the publisher's `defaultPaymentAccount`) or `withdrawAppFunds(publisherId, numericAppId)` (to the app's `paymentAccount`). Both send the whole balance minus one ledger fee and return `Ok(amount_sent)`. Errors: `Not authorized` (only publisher **owners**, not admins, may withdraw), `Publisher not found`, `App not found`, `App does not belong to this publisher`, `App has no payment account override; use withdrawPublisherFunds`, `Insufficient balance to cover transfer fee`, `Transfer failed`. Balances: `getPublisherRevenueBalance`, `getAppRevenueBalance` (update calls; they read the ledger). Lifetime totals: `getPublisherStats`, `getAppRevenueStats`, `getDaoRevenueStats`.

### 3.6 Upgrading a minted canister

Sneedapp does not upgrade canisters; the owner does, as the canister's controller, through the IC management canister:

1. Find the running version: compare the canister's module hash with the `wasmHash` of the app's versions.
2. Pick the target from `getAppVersions(appId)` and download its WASM from `wasmUrl`. Check its SHA-256 against `wasmHash` before installing.
3. Call `install_code` with `mode = upgrade` and an empty argument.

**Step through every version in between.** A version's stable-memory migration is written against the version just before it, so the reference frontend installs every published version newer than the running one, oldest first, up to the target (it does not skip a version). Published intermediate versions stay listed for this reason.

```js
import { Actor } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';

const mgmtIdl = ({ IDL }) => IDL.Service({
  install_code: IDL.Func([IDL.Record({
    mode: IDL.Variant({ install: IDL.Null, reinstall: IDL.Null, upgrade: IDL.Null }),
    canister_id: IDL.Principal, wasm_module: IDL.Vec(IDL.Nat8), arg: IDL.Vec(IDL.Nat8),
  })], [], []),
});

async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function upgradeTo(agent, canisterId, version) {
  const bytes = new Uint8Array(await (await fetch(version.wasmUrl[0])).arrayBuffer());
  if ((await sha256Hex(bytes)) !== version.wasmHash.toLowerCase()) throw new Error('hash mismatch');
  const mgmt = Actor.createActor(mgmtIdl, {
    agent, canisterId: 'aaaaa-aa',
    callTransform: (_m, _a, cfg) => ({ ...cfg, effectiveCanisterId: canisterId }),
  });
  await mgmt.install_code({
    mode: { upgrade: null }, canister_id: canisterId, wasm_module: bytes,
    arg: new Uint8Array([0x44, 0x49, 0x44, 0x4c, 0x00, 0x00]),
  });
}
```

### 3.7 Wallet bookmarks

- `registerCanister(canisterId, appId)` adds an entry (no ownership check; an existing entry with `appId = ""` gets the given `appId`; the legacy `"icp-staking-bot"` is stored as `"sneed-icp-staking-bot"`). Always `Ok`.
- `deregisterCanister(canisterId)` removes it; `Err("Canister not found in wallet")` otherwise.
- `transferManager(canisterId, newOwner)` moves the caller's bookmark (with its `appId`) to `newOwner`'s list; `Err("Canister is not in your registered list")`. It only moves the bookmark: change the canister's controllers separately.
- `registerCanisterFor(user, canisterId, appId)` / `deregisterCanisterFor(user, canisterId)` do the same for another user and are reserved for authorised canisters (`getAuthorizedForCallers()`, e.g. Sneedex, which moves bookmarks when a canister changes hands in a trade) and admins. Errors: `Not authorized`, `Cannot register for anonymous`, `Cannot deregister for anonymous`.

The `*Manager*` variants (`registerManager`, `deregisterManager`, `registerManagerFor`, `deregisterManagerFor`, `getMyManagers`, `getManagersByOwner`) are the older names; they read and write the same list, with `appId = ""` and canister ids only.

---

## 4. Concurrency, errors and retries

**Result shapes.** `mintCanister` returns `variant { Ok : record { canisterId; accountId }; Err : MintError }`. `accountId` is the 32-byte ICP account identifier of the new canister's default account (where ICP for it can be sent). Publisher and app management returns `variant { Ok; Err : text }` or `variant { Ok : nat; Err : text }`. Payment withdrawals return the ICP ledger's `TransferResult`.

**Traps.** Admin methods, and a few publisher methods, use assertions: a call by someone not allowed, or with invalid input, is rejected (the call throws in JavaScript) and changes nothing. This applies to `addAppVersion` (duplicate version number), `updateAppVersion`, `removeAppVersion`, `clearAppVersionWasm` (unknown app or not authorised), and `uploadAppVersionWasm`, which traps with `version not found`, `not a WebAssembly module (no wasm or gzip magic bytes)` or `wasmHash mismatch: declared ... but the uploaded wasm has sha256 ...`.

**Retrying a mint.** A mint is not idempotent: two successful calls mint two canisters and charge twice. After a timeout, check before retrying: `getMyWalletForApp(appId)` or `getMintLog({ minterFilter = [me]; appIdFilter = [appId]; ... })` show whether the first call went through. A returned `Err` means the payment was rolled back (see 3.1 for the rare manual-return case).

**WASM uploads** are single update calls, so a module must fit in one ingress message (2 MiB). Gzip it.

---

## 5. Method reference

Types are in section 6. "Caller" is the principal signing the call. *query* methods can be called without a signature.

### 5.1 Catalogue (queries)

| Method | Returns | Notes |
|---|---|---|
| `getApps()` | `vec AppInfo` | All apps, enabled or not. |
| `getApp(appId)` | `opt AppInfo` | By slug. |
| `getAppByNumericId(numericAppId)` | `opt AppInfo` | |
| `getAppsByPublisher(publisherId)` | `vec AppInfo` | |
| `getAppsByFamily(family)` | `vec AppInfo` | Apps carrying the tag. |
| `getAppVersions(appId)` | `vec AppVersionInfo` | Highest version first; no blobs. |
| `getAppVersion(appId, major, minor, patch)` | `opt AppVersionInfo` | |
| `getLatestAppVersion(appId)` | `opt AppVersionInfo` | Highest version with a stored WASM. |
| `hasAppVersionWasm(appId, major, minor, patch)` | `bool` | |
| `getPublisher(publisherId)` | `opt PublisherInfo` | |
| `getPublishers()` | `vec PublisherInfo` | |
| `getVerifiedPublishers()` | `vec PublisherInfo` | |
| `getPublishersByOwner(owner)` | `vec PublisherInfo` | |
| `getEffectiveDaoCutForApp(appId)` | `nat` | Basis points; `1000` for an unknown app. |
| `getOfficialVersions()` | `vec OfficialVersion` | Legacy registry (3.4). |
| `getOfficialVersionByHash(wasmHash)` | `opt OfficialVersion` | Case-insensitive. |

### 5.2 Minting and pricing

**`mintCanister(appId : text, versionMajor : opt nat, versionMinor : opt nat, versionPatch : opt nat) → MintResult`** (update)
Mints a canister of `appId` for the caller, see 3.1. Give all three version numbers to pick a version; any `null` means the latest version with a WASM. Errors: `AppNotFound`, `AppDisabled`, `PublisherNotFound`, `PublisherNotVerified`, `VersionNotFound`, `NoWasmForVersion`, `InsufficientCycles`, `InsufficientPayment { required; provided }`, `CanisterCreationFailed(text)`, `TransferFailed(text)`.

**`getAppMintPrice(appId : text, user : principal) → record { regular : nat64; premium : nat64; applicable : nat64; isPremium : bool }`** (update)
The fee `user` would pay. All zero for an unknown app. `applicable` includes special prices (5.2.1); `regular` and `premium` are the app's own prices.

**`getPaymentSubaccount(user) → blob`** (query), **`getUserPaymentBalance(user) → nat`** (update), **`withdrawUserPayment() → TransferResult`** (update): see 3.2.

**`getPaymentConfig() → PaymentConfig`** (query)
`{ creationFeeE8s; targetCyclesAmount; feeDestination; paymentRequired }`. `creationFeeE8s` is the fee of the legacy `createNeuronManager`; app mints use the app's own prices. `targetCyclesAmount` caps the ICP converted to cycles per mint; `feeDestination` receives the DAO's share.

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `getPremiumCreationFee()` | query | `nat64` | Premium fee of the legacy `createNeuronManager`. |
| `getCanisterCreationCycles()` | query | `nat` | Cycles attached to each new canister. |
| `getSneedPremiumCanisterId()` | query | `opt principal` | Where premium membership is checked. |
| `calculateIcpForCycles(targetCycles)` | update | `nat64` | ICP e8s that buy `targetCycles` at the CMC rate plus 5%; `0` if the rate is unavailable. |
| `getConversionRate()` | update | `{ cyclesPerIcp; xdrPermyriadPerIcp }` | Live CMC rate. |

#### 5.2.1 Special prices: admin and partner prices

Next to the regular and premium prices, the mint fee of **Sneed DAO apps** (publisher 0) and of the legacy `createNeuronManager` has an **admin price** and **partner prices** (spec: `spec/special_prices.md`). Third-party publishers' app prices are theirs and are never overridden.

- The price charged is the **lowest applicable** one: the regular price; the premium price (Sneed Premium members); the admin price (callers on Sneedapp's admin list who are people, i.e. self-authenticating principals; canisters on the list never get it); the caller's partner price (a principal the DAO names, usually a partner canister such as a partner game canister that mints for its users, until the entry's expiry). On a tie the earlier tier in that order is reported.
- Every override is optional: unset means no special price. With nothing set, prices are exactly the regular and premium ones.
- An override is checked like a regular price: at mint time a price that cannot cover the cycles a new canister costs is refused (`CanisterCreationFailed`, nothing charged).
- `Prices = record { mint_fee_e8s : opt nat }`; `PartnerPrices = record { label : text; prices : Prices; expires_at : opt int }` (`expires_at` in nanoseconds since 1970; `label` is public).

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `get_special_prices()` | query | `record { admin_prices : Prices; partners : vec record { principal; label; prices; expires_at } }` | Public, expired partner entries included. |
| `get_special_prices_for(principal)` | query | `record { admin_prices : opt Prices; partner : opt PartnerPrices }` | What applies to that principal now (admin prices only when it is a person on the admin list; the partner entry only before its expiry). |
| `set_admin_prices(Prices)`† | update | `variant { ok; err : text }` | Admins or SNS governance. Logged as `sneedapp_config_update` key `admin_prices`. |
| `set_partner_prices(principal, PartnerPrices)`† | update | `variant { ok; err : text }` | Adds or replaces one entry. Refuses the anonymous principal, an empty label or one over 100 characters, an expiry in the past, more than 200 partners, a fee above nat64. Logged as key `partner_prices` with `partner`. |
| `remove_partner_prices(principal)`† | update | `variant { ok; err : text }` | `err` when there is no entry. Logged as key `partner_prices`, value `removed`. |

Every `sneedapp_mint` and `sneedapp_mint_refund` block carries `price_tier`: `regular`, `premium`, `admin` or `partner`.

### 5.3 Mint log (queries)

| Method | Returns | Notes |
|---|---|---|
| `getMintLog(MintLogQuery)` | `MintLogResult` | Oldest first. Filters: `appIdFilter`, `minterFilter`, `fromTime`, `toTime` (ns, inclusive). `startIndex` counts within the filtered list; `limit` 50 by default, 100 at most. `totalCount` is the filtered total, `hasMore` whether more follow. |
| `getMintLogEntry(index)` | `opt MintLogEntry` | |
| `lookupMintedCanister(canisterId)` | `opt MintLogEntry` | Which app, version, minter and fee split produced the canister. |
| `wasMintedByUs(canisterId)` | `bool` | |
| `getMintLogCount()` | `nat` | |
| `getMintLogCountForApp(appId)` | `nat` | |
| `lookupLedgerTx(icpTx)` | `record { hits : vec record { block_id; btype; field; block : opt Value }; indexedFrom : nat }` | The activity-log blocks (7) that name ICP ledger block `icpTx` in a ledger-block field (`icp_tx`, `cycles_tx`, `publisher_share_tx`, `dao_cut_tx`, `top_up_tx`, `payment_txs`, `refund_txs`), with `field` saying which; `block` while it is still in the canister (otherwise `icrc3_get_blocks` names its archive). Blocks below `indexedFrom` had been archived before the index existed and are not covered. The user's own deposit transfer is not known to the factory; look up the blocks the factory made. |

Each `MintLogEntry` records `icpPaidE8s`, `wasPremium`, `daoCutE8s` and `publisherRevenueE8s` along with the version minted.

### 5.4 Wallet (bookmarks)

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `getMyWallet()` | query | `vec UserCanisterEntry` | The caller's list. |
| `getMyWalletForApp(appId)` | query | `vec UserCanisterEntry` | Filtered by app. |
| `registerCanister(canisterId, appId)` | update | `Ok` | 3.7. |
| `deregisterCanister(canisterId)` | update | `Ok` / `Err` | |
| `transferManager(canisterId, newOwner)` | update | `Ok` / `Err` | Moves the bookmark only. |
| `registerCanisterFor(user, canisterId, appId)` | update | `Ok` / `Err` | Authorised canisters and admins. |
| `deregisterCanisterFor(user, canisterId)` | update | `Ok` / `Err` | Authorised canisters and admins. |
| `getAuthorizedForCallers()` | query | `vec principal` | Canisters allowed to call the `*For` methods. |
| `getRegisteredUserCount()` | query | `nat` | Users with at least one entry. |
| `getTotalRegistrationCount()` | query | `nat` | Entries over all users. |

Legacy aliases: `getMyManagers()` and `getManagersByOwner(owner)` (canister ids only), `registerManager`, `deregisterManager`, `registerManagerFor`, `deregisterManagerFor` (same list, `appId = ""`), `getManagerCount()` (same as `getTotalRegistrationCount`).

### 5.5 Publishers (publisher owners)

All return `variant { Ok; Err : text }` unless noted; owners or admins may call them unless noted. Common errors: `Publisher not found`, `App not found`, `Not authorized`.

| Method | Notes |
|---|---|
| `createPublisher(CreatePublisherInput) → Ok(publisherId)` | Any signed-in caller (`Anonymous callers cannot create publishers`). Caller becomes the only owner; unverified; DAO cut 1000 bps; no families. |
| `updatePublisher(publisherId, UpdatePublisherInput)` | Name, description, links, logo, website, `defaultPaymentAccount`. |
| `addPublisherOwner(publisherId, newOwner)` | `Already an owner`. |
| `removePublisherOwner(publisherId, owner)` | `Cannot remove the last owner`, `Principal is not an owner`. |
| `addPublisherFamily(publisherId, family)` | `Family already exists`. |
| `removePublisherFamily(publisherId, family)` | Also removes the tag from all the publisher's apps. |
| `addApp(publisherId, AddAppInput) → Ok(numericAppId)` | `App ID already exists`, `App ID is reserved` (`"icp-staking-bot"`), `App ID was used by a removed app; ask an admin` (versions or mints of an app removed before 2026-10-20 remain under that slug; only an admin may re-add it), `Family '<f>' not in publisher's families`. Starts disabled. |
| `updateApp(numericAppId, UpdateAppInput)` | Replaces the editable fields (prices included). |
| `setAppEnabled(numericAppId, enabled)` | |
| `setAppPricing(numericAppId, mintPrice, premiumMintPrice)` | e8s. |
| `setAppPaymentAccount(numericAppId, opt Account)` | Override where this app's share is paid; `null` falls back to the publisher's. Revenue then accrues in the app revenue subaccount (3.5). |
| `setAppFamilies(numericAppId, vec text)` | Each tag must be one of the publisher's. |
| `addAppVersion(appId, AppVersionInput) → ()` | Traps on a duplicate version. Metadata only. |
| `updateAppVersion(appId, major, minor, patch, AppVersionInput) → ()` | With a WASM stored, the hash must match it. |
| `uploadAppVersionWasm(appId, major, minor, patch, blob) → ()` | Verifies magic bytes and SHA-256 (4). |
| `clearAppVersionWasm(appId, major, minor, patch) → ()` | Drops the blob, keeps the metadata. |
| `removeAppVersion(appId, major, minor, patch) → ()` | Drops metadata and blob. |
| `withdrawPublisherFunds(publisherId) → Ok(nat)` | Owners only (3.5). |
| `withdrawAppFunds(publisherId, numericAppId) → Ok(nat)` | Owners only (3.5). |

Revenue reads: `getPublisherRevenueBalance(publisherId)`, `getAppRevenueBalance(publisherId, numericAppId)` (updates, `nat` e8s), `getPublisherRevenueSubaccount`, `getAppRevenueSubaccount` (queries, `blob`), `getPublisherStats(publisherId)`, `getAllPublisherStats()`, `getAppRevenueStats(numericAppId)`, `getAllAppRevenueStats()`, `getDaoRevenueStats()` (queries).

### 5.6 Factory information

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `getCanisterId()` | query | `principal` | |
| `getCyclesBalance()` | query | `nat` | The factory's cycles. |
| `getIcpBalance()` | update | `nat` | ICP e8s in the factory's main account. |
| `getAdmins()` | query | `vec principal` | |
| `getSneedGovernance()` | query | `opt principal` | A governance principal with admin-level configuration rights, if set. |

### 5.7 Legacy: ICP neuron manager

The canister's original flow, kept for compatibility. New integrations should use `mintCanister("sneed-icp-staking-bot", ...)`.

- **`createNeuronManager() → CreateManagerResult`** installs the separately uploaded manager WASM (`hasManagerWasm`, `getManagerWasmSize`, `getCurrentVersion`) for `getPaymentConfig().creationFeeE8s` (or `getPremiumCreationFee()` for premium members), with the same payment, rollback and hand-over sequence as 3.1, and bookmarks and logs the canister under app id `"sneed-icp-staking-bot"` (`numericAppId` 0, publisher 0). Until 2026-10-20 it used `"icp-staking-bot"`; an upgrade relabels those older wallet and mint-log entries, so per-app queries for `"sneed-icp-staking-bot"` include them. Errors: `CanisterCreationFailed(text)` (also when no WASM is uploaded: `No manager WASM uploaded. Admin must upload WASM first.`), `InsufficientCycles`, `InsufficientPayment`, `TransferFailed(text)`. `AlreadyExists`, `CyclesTopUpFailed` and `NotAuthorized` exist in the type but are not returned.
- **`getManagerByCanisterId(canisterId)`** always returns `null`; **`updateManagerNeuronId(...)`** does nothing. Ask the manager canister itself for its neuron.

### 5.8 Admin methods

Restricted to Sneedapp admins (`getAdmins()`); those marked † also accept the governance principal (`getSneedGovernance()`). Integrators never call them.

| Method | Purpose |
|---|---|
| `addAdmin`, `removeAdmin` | Manage admins (at least one stays). |
| `setSneedGovernance` | Set the governance principal. |
| `setPaymentConfig`†, `setCreationFee`†, `setTargetCycles`†, `setFeeDestination`†, `setPaymentRequired`†, `setPremiumCreationFee`†, `setCanisterCreationCycles`†, `setSneedPremiumCanisterId`† | Payment and cycles configuration. |
| `set_admin_prices`†, `set_partner_prices`†, `remove_partner_prices`† | Special prices for Sneed DAO mints (5.2.1). |
| `verifyPublisher`, `unverifyPublisher` | Allow or stop minting of a publisher's apps. |
| `setPublisherDaoCut`, `setAppDaoCut` | DAO cut in basis points (app override `null` = publisher default). |
| `removeApp(numericAppId)` | Delete an app from the catalogue together with its versions and WASM blobs. `Err("N canister(s) were minted from this app ...")` while the mint log has canisters minted from it: their owners upgrade from its versions, so disable it with `setAppEnabled` instead. |
| `addAuthorizedForCaller`†, `removeAuthorizedForCaller`† | Canisters allowed to call the `*For` wallet methods. |
| `setManagerWasm`†, `clearManagerWasm`†, `setCurrentVersion`† | Legacy manager WASM. |
| `addOfficialVersion`, `updateOfficialVersion`, `removeOfficialVersion`, `setOfficialVersions` | Legacy official versions registry. |
| `adminRegisterCanister`, `adminBulkRegisterCanisters` | Write bookmarks for users (migrations). |
| `getUserWallet`, `getAllWallets`, `getAllRegistrations` | Read any user's bookmarks. |
| `getOrphanCanisters` | Canisters of failed mints the factory could not clean up. |
| `getCreationLog`, `getCreationLogCount`, `getRecentCreations`, `getFinancialLog`, `getFinancialLogCount`, `getMergedLog`, `getFactoryAggregates` | Internal audit logs of creations and their ICP and cycles accounting. |
| `adminTopUpCycles`, `adminWithdrawIcp` | Convert or move ICP held in the factory's main account. |
| `adminReturnStuckIcp(user, amountE8s, reason)` | Return ICP a user is owed from aborted mints when `claim_refund_credit` cannot (the leg's source no longer holds it): from the main account, **only** to `user`'s payment subaccount, at most the user's open refund credits (`get_refund_credits_for(user)`), which shrink by `amountE8s` oldest first; the user receives `amountE8s` minus the ledger fee. A non-empty `reason` is required. Returns `Ok { blockIndex; returnedE8s; remainingE8s; creditsClosed }` or `Err(text)`. The restricted form of `adminWithdrawIcp` for this case. |

Publisher owners also manage their own publisher and apps (5.5); admins can do the same on any publisher, except withdrawing its revenue.

---

## 6. Types

```candid
type Account = record { owner : principal; subaccount : opt blob };
type AccountIdentifier = blob;   // 32-byte ICP account identifier

type AppInfo = record {
  appId : text; numericAppId : nat; publisherId : nat;
  name : text; description : text; iconUrl : opt text;
  mintPriceE8s : nat64; premiumMintPriceE8s : nat64;
  viewUrl : opt text; manageUrl : opt text; mintUrl : opt text;   // "CANISTER_ID" placeholder
  families : vec text;
  paymentAccount : opt Account;      // publisher share destination override
  daoCutBasisPoints : opt nat;       // admin override of the publisher's DAO cut
  createdAt : int; enabled : bool;
};
type AddAppInput = record {
  appId : text; name : text; description : text; iconUrl : opt text;
  mintPriceE8s : nat64; premiumMintPriceE8s : nat64;
  viewUrl : opt text; manageUrl : opt text; mintUrl : opt text; families : vec text;
};
type UpdateAppInput = record {        // AddAppInput without appId
  name : text; description : text; iconUrl : opt text;
  mintPriceE8s : nat64; premiumMintPriceE8s : nat64;
  viewUrl : opt text; manageUrl : opt text; mintUrl : opt text; families : vec text;
};

type AppVersionInput = record {
  major : nat; minor : nat; patch : nat;
  wasmHash : text;                   // lowercase hex sha256; "" = fill in on upload
  wasmUrl : opt text; sourceUrl : opt text;
  releaseNotes : text; releaseDate : int;
};
type AppVersionInfo = record {
  major : nat; minor : nat; patch : nat; wasmHash : text;
  wasmUrl : opt text; sourceUrl : opt text; releaseNotes : text; releaseDate : int;
  wasmSize : nat;                    // 0 without a blob
  hasWasm : bool;
};

type PublisherInfo = record {
  publisherId : nat; name : text; description : text;
  websiteUrl : opt text; logoUrl : opt text; links : vec record { text; text };  // (label, url)
  owners : vec principal; verified : bool; families : vec text;
  defaultPaymentAccount : Account; daoCutBasisPoints : nat; createdAt : int;
};
type CreatePublisherInput = record {
  name : text; description : text; websiteUrl : opt text; logoUrl : opt text;
  links : vec record { text; text }; defaultPaymentAccount : Account;
};
type UpdatePublisherInput = CreatePublisherInput;   // same fields

type MintResult = variant {
  Ok : record { canisterId : principal; accountId : AccountIdentifier };
  Err : MintError;
};
type MintError = variant {
  AppNotFound; AppDisabled; VersionNotFound; NoWasmForVersion;
  InsufficientPayment : record { required : nat64; provided : nat64 };
  InsufficientCycles; CanisterCreationFailed : text; TransferFailed : text;
  PublisherNotFound; PublisherNotVerified;
};

type MintLogEntry = record {
  index : nat; canisterId : principal; minter : principal;
  appId : text; numericAppId : nat; publisherId : nat;
  versionMajor : nat; versionMinor : nat; versionPatch : nat;
  mintedAt : int; icpPaidE8s : nat64; wasPremium : bool;
  daoCutE8s : nat64; publisherRevenueE8s : nat64;
};
type MintLogQuery = record {
  startIndex : opt nat; limit : opt nat;
  appIdFilter : opt text; minterFilter : opt principal;
  fromTime : opt int; toTime : opt int;
};
type MintLogResult = record { entries : vec MintLogEntry; totalCount : nat; hasMore : bool };

type UserCanisterEntry = record { canisterId : principal; appId : text };  // "" = unknown/legacy

type PaymentConfig = record {
  creationFeeE8s : nat64; targetCyclesAmount : nat;
  feeDestination : Account; paymentRequired : bool;
};

type PublisherStats = record {
  publisherId : nat; totalRevenueE8s : nat; totalWithdrawnE8s : nat;
  totalDaoCutE8s : nat; totalMintCount : nat;
};
type AppRevenueStats = record {
  numericAppId : nat; publisherId : nat; totalRevenueE8s : nat;
  totalWithdrawnE8s : nat; totalDaoCutE8s : nat; mintCount : nat;
};
type DaoRevenueStats = record {
  totalDaoCutReceivedE8s : nat;   // DAO cuts from third-party apps
  totalDirectRevenueE8s : nat;    // Sneed DAO's own apps
  totalRevenueE8s : nat;
};

type OfficialVersion = record {
  major : nat; minor : nat; patch : nat; wasmHash : text; wasmUrl : text; sourceUrl : text;
};
```

`TransferResult` and `TransferError` are the ICP ledger's ICRC-1 types. The legacy and admin types (`CreateManagerResult`, `ManagerInfo`, `CreationLog*`, `FinancialLog*`, `MergedLog*`, `FactoryAggregates`, `OrphanCanister`, `NotifyTopUpResult`) are in the [Candid file](/api-docs/sneedapp.did).

---

## 7. Activity log (ICRC-3)

Every change to the catalogue (apps, versions, Wasm modules, publishers, official versions), every mint with the ICP it cost and where each part went, every refund, withdrawal and top-up, the privileged wallet writes and every configuration change is recorded as a block in a hash-chained, certified log, readable through the standard [ICRC-3](https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3) interface. Each block carries the hash of the previous block (`phash`), and the canister certifies the index and hash of the latest block, so anyone can download the history and prove it complete and untampered without trusting Sneed DAO or this app. Old blocks move to archive canisters that Sneedapp creates.

Two things make it worth reading: the **supply chain** (which code was published under which app, by whom, with the SHA-256 and size of every Wasm; every mint names the SHA-256 of the module it actually installed, computed from the blob at mint time) and the **money** (the price of every mint, the ledger block of every transfer, refunds and withdrawals).

The log uses the same library as [Sneed Lock's log](/api/sneed_lock#8-activity-log-icrc-3) ([src/icrc3](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/icrc3)); the design is in [spec/sneedapp_icrc3.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sneedapp_icrc3.md). It starts empty with the release that introduced it; apps, versions and mints from before are not imported (the mint log, `getMintLog`, has every mint).

### 7.1 Endpoints

| Method | Type | Returns |
|---|---|---|
| `icrc3_get_blocks(vec record { start : nat; length : nat })` | query | `{ log_length; blocks : vec { id; block }; archived_blocks : vec { args; callback } }`. Live blocks come back directly; for archived ranges call `callback` (that archive's own `icrc3_get_blocks`) with `args`. |
| `icrc3_get_archives(record { from : opt principal })` | query | Every archive canister with the first and last block index it holds. |
| `icrc3_get_tip_certificate()` | query | `opt { certificate; hash_tree }` with `last_block_index` and `last_block_hash`. Null until the first block exists. |
| `icrc3_supported_block_types()` | query | Every `btype` below, each with the url of [7.3](#73-block-types). |
| `icrc10_supported_standards()` | query | ICRC-3 and ICRC-10. |
| `icrc3_log_status()` | query | Log length, live blocks, hash of the last block, archives, spill settings. `history_imported` is always false. |
| `icrc3_registration_status()` | query | Per archive, the SNS proposal that registered it as a DAO canister. |

Admins and the governance principal only: `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers`, `admin_set_icrc3_proposal_neuron`, `admin_icrc3_register_archives_now`, `admin_icrc3_reset_archive_registration` (as on Sneed Lock). Archives are controlled by Sneedapp and the Sneed SNS root until a `RegisterDappCanisters` proposal hands them to SNS root alone.

### 7.2 Block format

A block is a `Map` with `btype` (Text), `ts` (Nat, ns since epoch: when the action happened), `phash` (Blob, absent on block 0) and `tx` (Map). Inside `tx`:

- Principals are `Blob` (raw principal bytes); ICRC-1 accounts are `Array [owner, subaccount?]`.
- ICP amounts are `Nat` e8s; cycles, sizes, ids and ledger block indexes `Nat`; flags `Nat` 0 or 1. Optional fields are omitted when absent.
- Hashes are lowercase hex `Text`: `wasm_sha256` is computed by the canister from the blob; `wasm_hash` is the hash a version declares (equal to its Wasm's SHA-256 once one is uploaded, which the upload enforces).
- `caller` is the principal that made the call; nothing on the IC is anonymous.
- `app`: `Map { app_id; numeric_app_id; publisher_id; name; mint_price_e8s; premium_mint_price_e8s; families; enabled; view_url?; manage_url?; mint_url?; payment_account?; dao_cut_bps? }` (descriptions and icons are not logged).
- `publisher`: `Map { publisher_id; name; website_url?; owners; verified; families; default_payment_account; dao_cut_bps }` (description, logo and links are not logged).
- `version`: `Map { major; minor; patch; wasm_hash?; wasm_size; release_date; wasm_url?; source_url? }` (release notes are not logged). `ver`: `Map { major; minor; patch }`. `official`: `Map { major; minor; patch; wasm_hash; wasm_url; source_url }`.

### 7.3 Block types

All types carry the `sneedapp_` prefix. A block is appended only once its action is final, in the message that records it: after every ledger transfer of a mint returned `Ok`, the canister was handed over and the mint log written. A refused or failed call appends nothing, and neither does a call that changes nothing; the exceptions are a mint that aborted after ICP had moved (`sneedapp_mint_refund` records the ICP going back) and a canister left with the factory (`sneedapp_orphan_canister`).

Catalogue and supply chain:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedapp_app_add` | `addApp` | `caller`, `app` |
| `sneedapp_app_update` | `updateApp`, `setAppPricing`, `setAppPaymentAccount`, `setAppDaoCut`, `setAppFamilies`, or `removePublisherFamily` took the family from the app; only when a logged field changed | `caller`, `method`, `app`, `old_app` |
| `sneedapp_app_enable`, `sneedapp_app_disable` | `setAppEnabled` changed the flag | `caller`, `app_id`, `numeric_app_id`, `publisher_id` |
| `sneedapp_app_remove` | `removeApp` | `caller`, `app`, `versions` (Array of `version`, removed with their Wasms) |
| `sneedapp_version_add` | `addAppVersion` | `caller`, `app_id`, `version` |
| `sneedapp_version_update` | `updateAppVersion` changed a logged field | `caller`, `app_id`, `version`, `old_version` |
| `sneedapp_version_remove` | `removeAppVersion` removed a version | `caller`, `app_id`, `old_version`, `had_wasm` |
| `sneedapp_wasm_upload` | `uploadAppVersionWasm` stored a module | `caller`, `app_id`, `version` (after the upload), `wasm_sha256` |
| `sneedapp_wasm_clear` | `clearAppVersionWasm` dropped a stored module | `caller`, `app_id`, `version` (before), `wasm_size` (of the dropped module) |
| `sneedapp_official_version_set` | `addOfficialVersion`, `updateOfficialVersion`, `setOfficialVersions` added or changed an entry (keyed by hash) | `caller`, `method`, `official`; `old_official` when it replaced one |
| `sneedapp_official_version_remove` | those methods or `removeOfficialVersion` dropped an entry | `caller`, `method`, `old_official` |
| `sneedapp_manager_wasm_set` | `setManagerWasm` (the legacy `createNeuronManager` module) | `caller`, `wasm_sha256`, `wasm_size` |
| `sneedapp_manager_wasm_clear` | `clearManagerWasm` dropped it | `caller` |

Publishers:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedapp_publisher_create` | `createPublisher` | `caller`, `publisher` |
| `sneedapp_publisher_update` | `updatePublisher`, `addPublisherOwner`, `removePublisherOwner`, `addPublisherFamily`, `removePublisherFamily`, `setPublisherDaoCut` changed a logged field | `caller`, `method`, `publisher`, `old_publisher` |
| `sneedapp_publisher_verify`, `sneedapp_publisher_unverify` | `verifyPublisher`, `unverifyPublisher` changed the flag | `caller`, `publisher_id` |

Mints and money:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedapp_mint` | `mintCanister` or the legacy `createNeuronManager` completed | `caller` (the minter, now the canister's only controller), `canister_id`, `app_id`, `numeric_app_id`, `publisher_id`, `ver`, `wasm_sha256` and `wasm_size` (the module installed), `price_e8s` (0 when payment is off), `premium`, `price_tier` (`regular`, `premium`, `admin` or `partner`: which price applied, 5.2.1); when paid: `cycles_icp_e8s` and `cycles_tx` (to the factory's main account, converted to cycles), `publisher_share_e8s` (with `publisher_share_to` and `publisher_share_tx` when above 0), `dao_cut_e8s` (with `dao_cut_to` and `dao_cut_tx` when above 0), `fees_e8s` (every ledger fee of the mint); `cycles_received` when the cycles minting canister answered; `method` = `createNeuronManager` for the legacy flow |
| `sneedapp_mint_refund` | a paid mint aborted after ICP had left the payment subaccount, and the moved ICP was sent back to it | `caller`, `app_id`, `ver`, `price_e8s`, `price_tier`, `reason`, `payment_txs` (ledger blocks of the legs that had moved), `moved_e8s`, `returned_e8s` (arrived back), `stuck_e8s` (could not be returned; held by the factory for a manual return), `refund_txs`; `canister_id` when a canister had been created and was deleted |
| `sneedapp_orphan_canister` | a canister of a failed mint stays with the factory (deleting it or handing it over failed); `getOrphanCanisters` | `caller` (the minter), `canister_id`, `app_id`, `reason`; after a full payment whose hand-over failed also `ver`, `price_e8s` and the payment fields of `sneedapp_mint` |
| `sneedapp_orphan_settled` | an orphaned canister was settled: `retry_handover` or `adminSettleOrphan(#HandOver)` gave it to its recorded minter (then its `sneedapp_mint` block follows, with `settled_by`, when the mint had been paid), or `adminSettleOrphan(#Delete)` deleted it | `caller`, `canister_id`, `minter`, `app_id`, `action` (`hand_over` or `delete`), `reason` (the admin's reason, or `retried by the minter` / `retried by an admin`), `mint_recorded` (1 when the paid mint is recorded now) |
| `sneedapp_top_up_retry` | `retry_top_up` finished a pending cycles purchase of a mint (`get_pending_top_ups`) | `caller`, `pending_id`, `canister_id` (the minted canister), `amount_e8s`, `top_up_tx` (ICP block of the transfer to the CMC), `outcome` (`ok` with `cycles`, or `refunded` with `reason`: the CMC sent the ICP back to the main account); a retry that fails again appends nothing |
| `sneedapp_refund_credit_claim` | `claim_refund_credit` returned at least one leg of a refund credit to the payer's payment subaccount | `caller`, `payer`, `credit_id`, `returned_e8s` (arrived), `refund_txs`, `remaining_e8s` (legs still owed; the credit stays open while above 0), `to` (the payer's payment subaccount) |
| `sneedapp_refund_credit_closed` | `adminCloseRefundCredit` closed a credit settled another way | `caller`, `payer`, `credit_id`, `amount_e8s` (what the credit still held), `reason` |
| `sneedapp_deposit_withdraw` | `withdrawUserPayment` (or `withdrawUserToken` for ICP) | `caller`, `amount_e8s`, `fee_e8s`, `to`, `icp_tx` |
| `sneedapp_deposit_token_withdraw` | `withdrawUserToken` sent a token other than ICP from the caller's payment subaccount back to the caller | `caller`, `ledger`, `amount` (transferred, the token's smallest unit), `fee`, `to`, `ledger_tx` (block on that ledger) |
| `sneedapp_publisher_withdraw` | `withdrawPublisherFunds`, `withdrawAppFunds` | `caller`, `publisher_id`, `numeric_app_id` (app funds), `amount_e8s`, `fee_e8s`, `to`, `icp_tx` |
| `sneedapp_admin_withdraw` | `adminWithdrawIcp` | `caller`, `amount_e8s`, `fee_e8s`, `to`, `icp_tx` |
| `sneedapp_admin_stuck_return` | `adminReturnStuckIcp` returned ICP a user was owed from aborted mints to that user's payment subaccount | `caller` (the admin), `user`, `amount_e8s` (transferred), `fee_e8s`, `to` (the user's payment subaccount), `icp_tx`, `reason`, `credit_ids` (refund credits reduced), `credits_closed`, `remaining_e8s` (still owed) |
| `sneedapp_admin_top_up` | `adminTopUpCycles` | `caller`, `amount_e8s`, `cycles` |

Wallet: bookmarks are not ownership, so **a user's own bookmarks are not logged** (`registerCanister`, `deregisterCanister`, `registerManager`, `deregisterManager`): they carry no trust and would publish every canister each user tracks. Logged are the writes that hand an entry to someone else or act on someone else's list:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedapp_wallet_transfer` | `transferManager` | `caller` (the old holder), `canister_id`, `app_id` (when known), `new_owner` |
| `sneedapp_wallet_register` | `registerCanisterFor`, `registerManagerFor`, `adminRegisterCanister`, `adminBulkRegisterCanisters` added or labelled an entry | `caller`, `user`, `canister_id`, `app_id` (when known) |
| `sneedapp_wallet_deregister` | `deregisterCanisterFor`, `deregisterManagerFor` removed an entry | `caller`, `user`, `canister_id` |

Configuration:

| `btype` | When | `tx` fields |
|---|---|---|
| `sneedapp_config_update` | a setting changed | `caller`, `key`, `value`; `old_value` except for list additions and removals |

`sneedapp_config_update` keys: `admin_added`, `admin_removed`, `authorized_caller_added`, `authorized_caller_removed`; `sneed_governance`, `sneed_premium_canister_id` (Blob, or Text `none`); `creation_fee_e8s`, `premium_creation_fee_e8s`, `target_cycles`, `canister_creation_cycles`; `fee_destination` (account); `payment_required`; `current_version` (`ver`); `admin_prices` (Map of the set overrides, e.g. `{ mint_fee_e8s }`; `old_value` the previous map); `partner_prices` (with `partner` = the principal; value `{ label; prices; expires_at? }`, or Text `removed`; `old_value` the previous entry when there was one); `icrc3_proposal_neuron` and the log settings `icrc3_max_live_blocks`, `icrc3_spill_batch_size`, `icrc3_archive_max_blocks`, `icrc3_archive_initial_cycles`, `icrc3_archive_top_up_threshold`, `icrc3_archive_top_up_amount`. `setPaymentConfig` writes one block per field that changed.

Not logged: a user's own bookmarks, reads, release notes, descriptions, icons, logos and links, the premium check of `getAppMintPrice`, and the admin creation and financial logs (they repeat the mint blocks).

### 7.4 Verifying and using the log

- **Verify it:** the procedure and the Node.js script of [Sneed Lock's 8.4](/api/sneed_lock#84-verifying-the-log) work unchanged with the canister id `sfamc-kyaaa-aaaau-adnpq-cai` (or staging `34e6r-ayaaa-aaaad-adkoa-cai`).
- **Browse it:** [app.sneeddao.com/tools/icrc3?canister=sfamc-kyaaa-aaaau-adnpq-cai](https://app.sneeddao.com/tools/icrc3?canister=sfamc-kyaaa-aaaau-adnpq-cai), the generic ICRC-3 browser.
- **What did this canister install?** Find the `sneedapp_mint` block whose `canister_id` is the canister and compare its `wasm_sha256` with the `sneedapp_wasm_upload` blocks of that app, and with the module hash the IC reports for the canister today (the owner may have upgraded it since).
- **Check a payment:** `cycles_tx`, `publisher_share_tx`, `dao_cut_tx` and `icp_tx` are block indexes on the ICP ledger.

---

## 8. Integration checklist

- Mint with `mintCanister`; treat `createNeuronManager` as legacy.
- Show only apps that are `enabled` and whose publisher is verified or `0`; anything else is refused with `AppDisabled` or `PublisherNotVerified`.
- Read the fee with `getAppMintPrice(appId, user)` right before paying; it depends on the user's Sneed Premium status and on prices the publisher can change.
- Pay into `getPaymentSubaccount(user)` on Sneedapp, never to the publisher directly. Unspent ICP stays there; offer `withdrawUserPayment`.
- Never retry a mint blindly after a timeout; check `getMyWalletForApp` or `getMintLog` with `minterFilter` first.
- The minted canister is controlled by the minter alone. Keep its cycles topped up; Sneedapp does not.
- Upgrade through every published version in order, and verify each WASM's SHA-256 against `wasmHash` before `install_code`.
- The wallet is a bookmark list. For ownership, check the canister's controllers on the IC; for provenance, `lookupMintedCanister`.
- Use queries as query calls; update calls to query methods are refused at ingress.
