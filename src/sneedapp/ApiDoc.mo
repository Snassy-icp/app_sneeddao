/// The get_api_doc text of sneedapp: a short guide for agents (ICP service discoverability).
module {
  public let text : Text = "# Sneedapp (canister sneedapp)

Sneedapp is Sneed DAO's app factory: a catalogue of apps (canister programs such as the Sneed ICP Staking Bot and the Sneed Trading Bot), their versions and WASM modules. Anyone who pays an app's mint fee in ICP gets a freshly **minted** canister of it, with the minter as its **only controller**. It also keeps a per-user list of app canister bookmarks (the wallet), an immutable mint log, and revenue accounts for third-party publishers.

- Production: `sfamc-kyaaa-aaaau-adnpq-cai`
- Staging: `34e6r-ayaaa-aaaad-adkoa-cai` (separate state; use it to test)
- Controlled by the Sneed DAO SNS; upgrades go through DAO proposals. The Candid service type is still named `IcpNeuronManagerFactory`.

## Units and encoding

- Fees and balances are ICP e8s (`nat64` in fee fields, `nat` in balances); the ICP ledger fee is 10,000 e8s. Revenue shares are basis points (`10000` = 100%).
- Timestamps (`createdAt`, `mintedAt`, `releaseDate`, `fromTime`/`toTime`) are `int` nanoseconds since the Unix epoch.
- Apps: string `appId` slug for users (mint, versions, wallet), `numericAppId` for publisher management. Versions are `(major, minor, patch)` with a lowercase hex SHA-256 `wasmHash`.
- `mintCanister` returns `variant { Ok : record { canisterId; accountId }; Err : MintError }`; management methods return `variant { Ok; Err : text }` or `Ok : nat`; payment withdrawals return the ICP ledger `TransferResult`.

## Authentication

- Browsing, paying, minting and bookmarking are authorised by the calling principal only. Calls are signed by a principal that is public on-chain, and every mint is logged under the minter; nothing here is anonymous.
- Anyone signed in may `createPublisher` and add apps (they start disabled); minting needs the app enabled and its publisher verified by an admin (publisher 0 is Sneed DAO). Publisher content methods are accepted only from the publisher's owners and admins; `registerCanisterFor` / `deregisterCanisterFor` only from authorised canisters (`getAuthorizedForCallers()`) and admins.

## Fees, transfers and irreversible actions

- **Minting costs ICP and moves it.** Fee: `getAppMintPrice(appId, user).applicable` (premium price for Sneed Premium members). The user first transfers ICP to their payment subaccount `{ owner = sneedapp; subaccount = getPaymentSubaccount(user) }`, then calls `mintCanister`. From that subaccount ICP is converted to cycles for the factory, a third-party publisher's share goes to its revenue subaccount, and the DAO's share goes to the DAO's fee destination (`getPaymentConfig().feeDestination`). A successful mint is final: the fee is spent and the canister exists.
- **A mint is not idempotent**: two successful calls mint two canisters and charge twice.
- **Control is handed over**: after install the controller list is replaced by `[minter]`; Sneedapp can no longer upgrade, stop or delete it. Upgrades are the owner's job (via `install_code`), stepping through every published version in between.
- `withdrawUserPayment()` sends the whole payment-subaccount balance minus one ledger fee to the caller's default account. Publisher owners withdraw revenue with `withdrawPublisherFunds` / `withdrawAppFunds` (balance minus one ledger fee).
- Bookmarks are not ownership: anyone can `registerCanister` any canister; `transferManager` moves only the bookmark, not the controllers. Ask the IC who controls a canister.

## Asynchronous lifecycle and polling

- Mint flow: `getAppMintPrice` (update) -> fund the payment subaccount (ICP ledger transfer) -> `mintCanister`. A deposit larger than the fee stays for the next mint or withdrawal.
- If a mint step fails, the new canister is deleted and the moved ICP is returned to the payment subaccount, less ledger fees; the error text says so.
- Verify a minted canister with `lookupMintedCanister` / `wasMintedByUs`, and compare its IC module hash with the version's `wasmHash`. Poll only after user actions; nothing here needs fast polling.

## Errors, retries and Busy

- One payment operation per user at a time: a second mint during the first returns `Err(TransferFailed(\"A payment operation is already in progress for this account; please retry\"))`; a concurrent withdrawal returns `Err(TemporarilyUnavailable)`. Retry once the first call has returned.
- After a mint timeout, check `getMyWalletForApp(appId)` or `getMintLog` with `minterFilter` before retrying. A returned `Err` means the payment was rolled back.
- Admin methods and some publisher methods trap (throw) on unauthorised callers or invalid input and change nothing.

## Common pitfalls

- Minting a disabled app or one from an unverified publisher fails (`AppDisabled`, `PublisherNotVerified`); check `getVerifiedPublishers()` first.
- `getAppMintPrice`, `getUserPaymentBalance` and the revenue balance methods are update calls (they ask other canisters).
- WASM uploads are single ingress messages (2 MiB max): gzip them.
- Query methods sent as update calls are refused by the ingress guard. Arguments are capped (most methods 4 KiB; `appId` at most 256 characters).

## Activity log (ICRC-3)

- Every app, version and Wasm change (with the Wasm's SHA-256 and size), every mint (the installed module's SHA-256, the price and the ICP ledger block of each transfer), refunds, withdrawals, publisher and config changes are blocks in a public, certified ICRC-3 log (`icrc3_get_blocks`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`, `icrc3_log_status`), with archive canisters for old blocks. Block types: https://app.sneeddao.com/api/sneedapp#block-types
- A user's own bookmarks are not logged; `transferManager` and writes to other users' wallets are. A refused call, or one that changes nothing, appends nothing.

## Start with these methods

- `getApps()`, `getApp(appId)`, `getVerifiedPublishers()`, `getAppVersions(appId)`, `getLatestAppVersion(appId)`
- `getAppMintPrice(appId, user)`, `getPaymentSubaccount(user)`, `getUserPaymentBalance(user)`, `mintCanister(appId, major, minor, patch)`, `withdrawUserPayment()`
- `getMyWallet()`, `getMyWalletForApp(appId)`, `registerCanister(canisterId, appId)`, `lookupMintedCanister(canisterId)`, `getMintLog(query)`

## Full reference

- https://app.sneeddao.com/api-docs/sneedapp.md
- Candid: https://app.sneeddao.com/api-docs/sneedapp.did
- All Sneed DAO APIs: https://app.sneeddao.com/llms.txt
";
};
