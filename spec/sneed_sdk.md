# Sneed SDK (`@sneeddao/sdk`)

Status: draft, 2026-10-22. Not started. Pipeline entry in spec/pipeline.md.

A JavaScript SDK for anyone integrating Sneed DAO's canisters, and the shared core of our own code: the
Sneed Hub frontend, the MCP server (`mcp/sneed-hub`) and the support/ops tools
(`~/.config/mr-sneed/tools/*`). First integrator target: Sneed Lock (a launchpad locks LP or tokens in a
few lines), then Sneed Notifications (a dapp notifies its users), then Sneedex listings.

Decided: licence MIT; JavaScript first, Motoko/mops packages in phase 2; integrators install from a
GitHub mirror repo; npm publishing later (§10).

## 1. Why: what is duplicated today

| Piece | Copies today |
|---|---|
| Canister interfaces | `src/declarations/<canister>/*.did.js` (dfx generate, rewritten to `@dfinity/*` by `src/app_sneeddao_frontend/scripts/fix-declaration-imports.mjs`); `mcp/sneed-hub/src/idl/*.did.js` (hand-copied from `test/canisters/build/*.did.js`, "refresh them when an interface changes", README §IDL); `test/canisters/build/*.did.js` + hand-written `test/canisters/lib/idl.js`; `~/.config/mr-sneed/tools/support/lib/ic.mjs` (live `candid:service` metadata compiled with `didc`, cached 6 h); `~/.config/mr-sneed/tools/gov_idl.cjs`, `post/*.mjs`, `news/news.mjs`, `openchat/*.mjs` (hand-written); 46 frontend files with an inline `IDL.Service` (e.g. `utils/rllApi.js`, `utils/botEventIdl.js`, `utils/approvals.js`, `utils/icrc3/client.js`, `pages/SneedexCreate.jsx`). They already disagree: `mcp/sneed-hub/src/idl/sneed_lock.did.js` has `SpecialLockPrices`, `src/declarations/sneed_lock/sneed_lock.did.js` does not. `public/api-docs/*.did(.js)` are copies of the declarations (`scripts/build-api-docs.mjs`). |
| Canister ids | `canister_ids.json` (ic + staging), `canister_ids.prod.json` (partial), `process.env.CANISTER_ID_*` in the frontend and `utils/pockets/ctx.js` `defaultCanisterIds()`, `mcp/sneed-hub/src/ic.js` `CANISTERS` (hard-coded ic, env overrides), `support/lib/ids.mjs` (a dated copy of canister_ids.json plus ledgers, CMC, governance, splitter). |
| Subaccount derivations | `support/lib/accounts.mjs`: every Sneed derivation with source line, `decodeSub()` inverse, pinned to mainnet values in `support/test/accounts.test.mjs` (Node-only: `node:crypto`, `node:zlib`). `src/app_sneeddao_frontend/src/utils/pockets/subaccount.js` (new, untracked, in progress): the codec for pockets / `owned(P, i)` (spec/programmable_accounts.md §3, §4.10), compared against older copies in `test/canisters/tests/pockets-model.test.js`. `mcp/sneed-hub/src/chain.js` (`principalSubaccount`, `accountId`). `PrincipalUtils.js` `computeAccountId`, `approvals.js` `icpAccountId`; `principalToSubAccount` in 20 frontend files. |
| Safe transfers | `utils/icrcTx.js` (created_at_time, dedupe-aware single resend on a known-deduping ledger list, `OutcomeUnknownError`, Duplicate = Ok, CreatedInFuture/TooOld retry; tested by `scripts/icrcTx.test.mjs`); `utils/cyclesTopUp.js` (CMC top-up with pending record + renotify); `utils/approvals.js` (`setApproval` with `expected_allowance`/`expires_at`, allowance discovery via ICRC-103 / index). `created_at_time` set by hand in 44 frontend files; `mcp/sneed-hub/src/chain.js` `spend()` and `tools/w_misc.js` have their own transfer paths. |
| ICRC-3 read/verify | `frontend utils/icrc3/{client,value,projections}.js` (fetch, `hashValue`, `verifyTip`); `test/canisters/lib/icrc3.js` (independent hash, `verifyTip`, `verifyChain`, `verifyLog` over archives, `@icp-sdk/core`); `support/lib/icrc3.mjs` (paged scans, jsonl cache, `norm()` to JSON; no verification); `mcp/sneed-hub/src/chain.js` `icrc3IdlFactory`. |
| Naming lookups | `utils/NamingService.js` (6 actors, sync, search, avatars, account nicknames, pockets); MCP `tools/names.js`; hand-written index `public/api-docs/sneed_names.did`. |
| Product flows | Lock LP: `Wallet.jsx:4367` (claim → transferPosition → create_position_lock); lock tokens: `mcp/sneed-hub/src/tools/w_misc.js` (fee deposit, fund wallet, `create_lock`); notifications: `utils/NotificationsService.js`. |

Public descriptions to align with: `public/api-docs/*.md` (full references), `public/.well-known/agent-skills/*/SKILL.md`
(sneed-lock, sneed-notifications, sneedex, sneed-forum, sneed-sms, sneed-names, sneed-hub), `mcp/sneed-hub/README.md`.
The SDK uses their words (Sneed wallet, payment subaccount, gas tank, app, topic, offer, pocket) and links to them; it
does not restate their facts.

## 2. Goals and non-goals

Goals
- An integrator locks LP or tokens, notifies a user, or lists on Sneedex with a few calls and no knowledge of subaccount bytes.
- One implementation of ids, derivations, safe transfers and ICRC-3 that our frontend, MCP and tools import, tested once.
- Typed actors for every documented canister, generated from the release `.did`, never hand-copied.
- Works in browsers (bundlers and plain `<script type=module>`) and Node 18+.

Non-goals
- No UI, no React, no state store, no price feeds, no denomination formatting.
- No identity/login handling (callers bring an agent; Internet Identity stays the app's job). No key storage.
- No MCP preview/confirm/caps layer (stays in `mcp/sneed-hub/src/safety.js`); no support read-only gate (stays in `support/lib/ic.mjs`). Those wrap SDK calls.
- No admin methods in product modules (raw typed actors still expose them).
- Not a general ICP SDK: ICRC/CMC helpers exist only as far as Sneed flows need them.

## 3. Package layout

```
sdk/
  package.json        "name": "@sneeddao/sdk", "type": "module", "exports" per module, "sideEffects": false
  src/
    core/ids.js       networks, canister ids, well-known ledgers
    core/agent.js     the only file that imports the agent library (see §4)
    core/actors.js    typed actor factory over generated/
    accounts.js       subaccount derivations + decoder (incl. the pockets codec)
    tx.js             safe ICRC-1/2 + ICP legacy transfers, approvals, CMC top-up
    icrc3.js          blocks, value hash, tip certificate, chain walk
    names.js          naming service reads (+ set own name)
    lock.js  notifications.js  sneedex.js  forum.js  sms.js  premium.js  rll.js  pockets.js
  generated/<canister>/{idl.js,types.d.ts,interface.json}   from the release .did (§5)
  dist/               .d.ts from JSDoc (tsc --declaration --allowJs --emitDeclarationOnly)
  test/               unit (node:test) + pic (PocketIC, vitest)
  CHANGELOG.md  README.md  docs/
```

Imports: `import { lock } from '@sneeddao/sdk'` or deep `@sneeddao/sdk/lock` (tree-shakes in the frontend).
The npm name `@sneeddao/sdk` is used from day one inside the workspace and in the mirror's `package.json`;
the npm scope is reserved later (§10).

Every product function takes a context first: `const sneed = createSneed({ agent, network: 'ic' })`, then
`sneed.lock.lockTokens(...)` or the functional form `lock.lockTokens(sneed, ...)`. The context holds the
agent, network, ids (overridable, as `SNEED_MCP_CANISTER_*` does today), an optional `storage` (for pending
top-ups) and an optional `onCall` hook (for MCP audit lines and support logging).

### 3.1 Module APIs (key functions)

All amounts are `bigint` base units; times are `bigint` ns since epoch; principals accept `Principal | string`;
accounts are `{ owner, subaccount?: Uint8Array }`. Results are `{ ok } | { err }` objects with a `kind` field
for errors the caller can act on (`'busy' | 'fee_needed' | 'outcome_unknown' | …`), never raw Candid variants.

**core/ids**
- `NETWORKS = { ic, staging, local }`; `canisterIds(network) -> { sneed_lock, sneedex, sneed_notifications, … }`
- `LEDGERS = { ICP, SNEED, ckUSDC, … }` with `{ ledger, index, decimals, fee }`; `CMC`, `NNS_GOVERNANCE`, `SNEED_GOVERNANCE`, `SNEED_ROOT`, `ICP_SPLITTER`
- `nameOf(network, canisterId) -> string | null`; `ICRC3_CANISTERS`
- Generated at build from `canister_ids.json` (+ `canister_ids.prod.json`), the well-known table from `support/lib/ids.mjs`. A canister with no id on a network is `null`, and functions that need it throw `NotDeployed(network, name)` (today: sneed_mon, sneed_guardian, sneed_pad on ic).

**core/actors**
- `actor(ctx, name, { canisterId? }) -> typed actor` for any generated canister; `ledger(ctx, ledgerId)`; `icrc3Actor(ctx, id)`.
- `interfaceInfo(name) -> { didSha256, sourceCommit, release }`; `checkDeployed(ctx, name) -> { same, deployedSha256 }` (reads `candid:service` metadata by `read_state`, like `support/lib/ic.mjs`).

**accounts** (port of `support/lib/accounts.mjs`, browser-safe; plus `utils/pockets/subaccount.js`)
- `principalSubaccount(p)` = S(p); `lockWallet(ctx, p) -> Account`; `lockPayment(p)`; `lockGas(lockId)`; `sneedexOfferEscrow(creator, offerId)`; `sneedexBidEscrow(bidder, bidId)`; `sneedexCreationFee(p)`; `sneedappPayment(p)`; `sneedappPublisherRevenue(id)`; `sneedappAppRevenue(pub, app)`; `premiumDeposit(p)`; `monDeposit(p)`; `jailbreakPayment(p)`; `guardianOp(id)`; `cmcTopUp(canisterId)`; `neuronStake(controller, nonce)`; `snsNeuronAccount(p, nonce, governance?)`; `nnsNeuronAccount(p, memo)`
- `ownedSubaccount(owner, index)`, `parseOwnedSubaccount(sub)`, `numberToSubaccount(n)`, `pocketNumber(sub)`
- `accountId(owner, sub?) -> hex`; `encodeAccount(account) -> text` / `decodeAccount(text)` (ICRC-1 textual, own implementation); `toCandidAccount`, `fromCandidAccount`
- `decodeSub(sub) -> { kind, principal?, prefix?, id? } | null`; `matchPrefix(decoded, p)`; `accountsOf(ctx, p) -> [{ key, label, account, ledgers, source }]`
- Where a canister offers a query for a derivation (`getPaymentSubaccount`, `get_lock_gas`), `accounts.verify(ctx, kind, …)` cross-checks it; product modules use the local derivation and tests pin it (§8).

**tx** (port of `utils/icrcTx.js`, `utils/approvals.js`, `utils/cyclesTopUp.js`)
- `transfer(ctx, ledgerId, { to, amount, fromSubaccount?, memo?, fee? }) -> { ok: blockIndex } | { err }`
- `approve(ctx, ledgerId, { spender, amount, expiresAt?, expectedAllowance?, fromSubaccount? })`
- `transferFrom(ctx, ledgerId, { from, to, amount })`; `icpLegacyTransfer(ctx, { toAccountId, amount, memo })`
- `ledgerDedupes(ledgerId) -> boolean`; `setDedupingLedgerResolver(fn)`; `OutcomeUnknownError`
- `fee(ctx, ledgerId)`, `balance(ctx, ledgerId, account)`, `allowance(ctx, ledgerId, owner, spender)`, `discoverApprovals(ctx, …)`
- `topUpCanister(ctx, canisterId, icpE8s) -> { ok: cycles } | { err }`, `finishPendingTopUps(ctx)`, `renotifyTopUp(ctx, canisterId, blockIndex)`

**icrc3** (one implementation from `test/canisters/lib/icrc3.js` + `utils/icrc3/*` + `support/lib/icrc3.mjs`)
- `logStatus(ctx, canisterId)`; `getBlocks(ctx, canisterId, start, length)` (follows archive callbacks); `scan(ctx, canisterId, { from, cache? })` async iterator; `cache` is an injected adapter (support keeps its jsonl file, the browser can use IndexedDB)
- `hashValue(value) -> Uint8Array`; `verifyTip(ctx, canisterId) -> { lastIndex, lastHash }`; `verifyChain(blocks, lastIndex, lastHash)`; `verifyLog(ctx, canisterId)`
- `toJson(value)` (the support tool's `norm`), `btypeOf`, `txField`, `asAccount`, `asPrincipal`
- `lockHistory(ctx, lockId)`, `proveLockHeld(ctx, lockId) -> { held, createBlock, tipVerified }` (the proof procedure of `api-docs/sneed_lock.md` §8)

**names**
- `getName(ctx, principal)`, `getNames(ctx, principals)` (batched), `getNeuronName(ctx, root, neuronId)`, `search(ctx, prefix, limit?)`, `getAvatar(ctx, principal)`, `listDapps(ctx)`; `setMyName(ctx, name)`. Nicknames and account nicknames are private per caller: `getMyNicknames(ctx)`.

**lock** (aligned with `.well-known/agent-skills/sneed-lock/SKILL.md`)
- `lockTokens(ctx, { ledger, amount, expiresAt | durationNs, dissolveDelayNs?, fromSubaccount? }) -> { ok: lockId } | { err }`: reads free balance, tops up the Sneed wallet, pays the fee shortfall (`getEffectiveLockFee`, `getPaymentBalance`), calls `create_lock`. Each step is reported via `onStep`.
- `lockPosition(ctx, { pool, positionId, expiresAt | durationNs, dissolveDelayNs? }) -> { ok: lockId } | { err, recover? }`: pool `metadata` → `claim_position` → pool `transferPosition` → fee → `create_position_lock` with pool-order tokens. On failure after the transfer, `err.recover` names `transfer_position` to get the position back.
- `getLock(ctx, lockId)`, `listLocks(ctx, { owner?, ledger?, pool?, token?, status? })` (async iterator over `get_lock_states_page`), `positionsOf(ctx, principal)`, `lockLimits(ctx)`, `lockFee(ctx, principal, isPosition)`
- `claimFees(ctx, pool, positionId)`, `addLiquidity(ctx, pool, positionId, amount0, amount1)`, `extendLock`, `startDissolving`, `stopDissolving`, `transferLock(ctx, lockId, to)` (ownership or ICRC-7), `withdrawTokens(ctx, ledger, amount, to?)`, `withdrawPosition(ctx, pool, positionId, to?)`
- `lockUrl(lockId)` → `https://app.sneeddao.com/lock/<id>` (staging host for staging)
- `Busy:` / `GenericError{2|3}` are retried with backoff (bounded) inside the module, as the skill says.

**notifications** (aligned with the sneed-notifications skill)
- Developer: `registerApp(ctx, { name, description, logo?, canisters, topics })`, `updateApp(ctx, appId, input)`, `requestPermission(ctx, user)`, `notify(ctx, { user, topic, title, body, link?, dedupe?, sponsored? })`, `notifyBatch(ctx, inputs)`, `receipts(ctx, …)`
- User: `allowApp(ctx, appId, allowed)`, `myApps(ctx)`, `history(ctx, …)`, `topUp(ctx, icpE8s)`
- `notify` maps `not_allowed` / `unknown_topic` / `rate_limited` / `no_funds` to `err.kind`. Callers of `notify` must be a registered app's principal (§11 Q4).

**sneedex** (aligned with the sneedex skill)
- `listOffer(ctx, { assets, priceLedger, buyoutPrice?, minBidPrice?, expiration?, publicNote?, approvedBidders? }) -> { ok: offerId }`: pays the creation fee, `createOffer` → for each asset escrow (ICRC-1 tokens to the offer escrow subaccount, ICRC-7/EXT NFTs, Sneed Lock locks, neurons/bots per kind) + `addAsset` → `finalizeAssets` → `activateOffer`.
- `getOffer`, `listOffers(ctx, filter)`, `bid(ctx, offerId, amount)`, `buyout`, `cancelOffer`, `claim(ctx, offerId)`, `offerUrl(id)`

**forum, sms, premium, rll** (thinner, mostly reads at first)
- forum: `getThread`, `getTopic`, `listPosts`, `post(ctx, { threadId, body, replyTo? })`, `vote`, `tip`, `mentionsOf(ctx, principal)`
- sms: `inbox(ctx)`, `send(ctx, { to, subject?, body })`
- premium: `membership(ctx, principal)`, `prices(ctx)`, `buy(ctx, tierId)` (deposit subaccount + `purchase`)
- rll: `claimable(ctx, principal)`, `claim(ctx)`, `distributions(ctx)`

**pockets** (lands once `utils/pockets/` settles; spec/programmable_accounts.md §4)
- `walletPocket`, `mergePockets`, `discoverWallet(ctx, ledgers)`, `createRegistry(ctx)`, adapters as data. The React-free files (`model.js`, `subaccount.js`, `discovery.js`, `registry.js`) move as they are; `ctx.js` becomes the SDK context.

### 3.2 Examples

Lock LP from a launchpad (after the user has an ICPSwap position):

```js
import { HttpAgent } from '@dfinity/agent';
import { createSneed } from '@sneeddao/sdk';

const agent = await HttpAgent.create({ identity, host: 'https://icp-api.io' });
const sneed = createSneed({ agent, network: 'ic' });
const r = await sneed.lock.lockPosition({
  pool: 'xxxxx-…-cai', positionId: 42n, durationNs: 365n * 86_400n * 1_000_000_000n,
});
if (r.err) throw new Error(r.err.message);          // r.err.recover tells how to get the position back
console.log('locked', sneed.lock.lockUrl(r.ok));
```

Lock tokens:

```js
const r = await sneed.lock.lockTokens({ ledger: myTokenLedger, amount: 1_000_000n * 10n ** 8n,
  durationNs: 180n * 86_400n * 1_000_000_000n });
```

Notify a user (from the app's registered principal; a canister integration does the same with the Candid call):

```js
const sneed = createSneed({ agent: appAgent, network: 'ic' });
await sneed.notifications.requestPermission(user);   // once; the user allows the app in Sneed Hub
const r = await sneed.notifications.notify({ user, topic: 'trade_filled',
  title: 'Your order filled', body: '500 SNEED bought at 0.01 ICP', link: 'https://mydapp/orders/9', dedupe: 'order-9' });
if (r.err?.kind === 'not_allowed') { /* the user has not allowed us yet */ }
```

Prove a lock for a token page:

```js
const { held, createBlock } = await sneed.icrc3.proveLockHeld(177n);
```

## 4. Language, types, runtimes, dependencies

- Plain ES modules in JavaScript with JSDoc types, like the frontend (checked by `tsc` with `checkJs`, `src/app_sneeddao_frontend/tsconfig.check.json`). `npm run build` in `sdk/` emits `.d.ts` into `dist/`; generated actors get `.d.ts` from `didc bind -t ts`. The SDK itself is checked with `checkJs` + `strict` in CI.
- Browser and Node 18+. No `node:*` imports outside a `node/` entry (file cache adapters): hashing via `@noble/hashes` (sha224/sha256), CRC32 in-house. This replaces `node:crypto`/`node:zlib` in `accounts.mjs` and the deep `@dfinity/principal/lib/esm/utils/*` imports in `pockets/subaccount.js`.
- Peer dependencies (not bundled): `@dfinity/agent`, `@dfinity/candid`, `@dfinity/principal` `^2.4.1` (what the frontend, MCP and support tool run: 2.4.1 installed; the frontend must stay on 2.x because its Internet Identity identities are 2.x, see `fix-declaration-imports.mjs`). `@dfinity/identity` is not needed. Runtime dependency: `@noble/hashes` only.
- `@icp-sdk/core` migration: the test suite already uses `@icp-sdk/core` 6.1 (`test/canisters/package.json`), the root has 5.0.0. Only `core/agent.js` imports the agent library, and generated IDL factories take `{ IDL }` as a parameter, so the switch is one file plus the peer-dependency line. It ships as an SDK major (`2.0.0`) when the frontend moves; until then, tests talk to the SDK through `@dfinity/*` like the frontend does.

## 5. Typed actors, generated at release, versioned with canister releases

- Source of truth: the `.did` that dfx builds for the released wasm (`test/canisters/build/*.did` from `test/canisters/build.sh`, the same sources as `src/declarations`). `sdk/scripts/gen.mjs` runs `didc bind -t js` and `-t ts` for each canister in a list (the `documented` list of `scripts/build-api-docs.mjs` plus ICRC-1/ICRC-7/ICRC-3/EXT/CMC/SNS governance externals) into `sdk/generated/<canister>/`, plus `interface.json` `{ didSha256, sourceCommit, release }`.
- Generated files are committed, so diffs show interface changes in review. CI fails when `gen.mjs` would change them (stale) — the end of hand-copied IDLs.
- An SDK release pins the interfaces of what is **deployed on ic**. When a canister upgrade proposal adopts, regenerate, bump, release. Product functions feature-detect methods that exist on staging but not yet on ic (as `support/lib/ic.mjs` `prefer()` and the MCP's Premium fallback do), so one SDK version serves both networks.
- Compatibility with our Candid changes: we add methods, add `opt` fields and add variant cases mostly. Adding methods or optional record fields is invisible to old SDK versions (Candid subtyping). A new variant case in a **result** breaks old decoders, so product modules decode results through a tolerant layer (unknown case → `{ err: { kind: 'unknown', raw } }`) and canister authors are asked to add new result cases only behind `opt` or a catch-all text error. Removed or renamed methods (e.g. Sneed Lock's removed `get_all_*`) are an SDK major.
- `checkDeployed(ctx, name)` lets an integrator (and CI, nightly) compare the pinned `didSha256` with the live `candid:service` metadata.

## 6. Networks

`network: 'ic' | 'staging' | 'local'`. Staging uses the real ICP and SNEED ledgers with separate canisters
(`canister_ids.json` "staging"); the SDK says so in the README and every staging example uses tiny amounts.
`local` takes ids from the caller (PocketIC/dfx) and sets `fetchRootKey`. Hub URLs (`lockUrl`, …) follow
the network (app.sneeddao.com vs the staging frontend's URL).

## 7. Safety defaults

From `utils/icrcTx.js`, now for everyone:
- Every transfer and approval carries `created_at_time` (filled when absent; caller's object untouched).
- After a thrown call (outcome unknown) the SDK resends once with identical args **only** on a ledger in the deduping list (ICP, DFINITY ck ledgers, SNS ledgers via a resolver). Elsewhere it throws `OutcomeUnknownError` and never resends. `Duplicate { duplicate_of }` = success. `CreatedInFuture` / `TooOld` retried only when the SDK chose the time.
- Approvals expire by default (1 hour, `expiresInMs` in icrcTx.js) and pass `expected_allowance` when known; "unlimited" (`UNLIMITED_TOKENS`) needs an explicit `{ unlimited: true }`.
- Non-idempotent canister updates (`create_lock`, `createOffer`, `notify` without `dedupe`) are never retried after an unknown outcome; multi-step flows return what already happened (`steps`) and how to recover, like `mcp/sneed-hub/src/tools/w_misc.js` does ("anything sent stays in your Sneed Lock wallet").
- CMC top-ups write a pending record (injected `storage`) before notifying, so an interrupted top-up can be finished (`cyclesTopUp.js`).
- Plain transfers to arbitrary accounts are an ordinary function; caps and confirmations are the caller's job (MCP keeps its own).
- No admin methods in product modules; no anonymous-looking options: functions that act on-chain document that the caller's principal is public.
- Bounded parallelism (default 4 in-flight per canister; see the IC call reservation note) for scans.

## 8. Where the code lives and how integrators install it

**In this repo:** `sdk/` as an npm workspace (add `"sdk"` to the root `package.json` `workspaces`). The
frontend depends on `"@sneeddao/sdk": "*"` (workspace link). `mcp/sneed-hub` is not a workspace today
(own lockfile): depend on `"file:../../sdk"`, or join the workspaces. Laptop tools in `~/.config/mr-sneed/tools`
use `file:/home/snassy/app_sneeddao/sdk`; the VPS uses the mirror tag. The in-repo copy is covered by the
repo's `LICENSE` (MIT, "Copyright (c) 2025–2026 Snassy-icp and Sneed DAO contributors", `/home/snassy/app_sneeddao/LICENSE`).

**For integrators (no npm account):** npm and git URLs cannot install a subfolder, so:

| Option | How | Verdict |
|---|---|---|
| **Mirror repo synced by CI** | `github.com/<org>/sneed-sdk`, a GitHub Action on tag `sdk-v*` copies `sdk/` (with built `dist/` and `generated/`) and pushes a tag `v0.1.0`. `npm i github:<org>/sneed-sdk#v0.1.0` | **Chosen.** Plain git install, no build on install, pinned by tag, works with jsDelivr/esm.sh too. Cost: one deploy key in CI. |
| gitpkg-style subfolder URL | `npm i https://gitpkg.now.sh/<owner>/app_sneeddao/sdk?<ref>` | Third-party service in the install path; no. |
| jsDelivr/esm.sh from the main repo | `https://esm.sh/gh/<owner>/app_sneeddao@<tag>/sdk/src/index.js` | Browser-only, peer deps awkward; fine as a demo off the mirror instead. |
| Tarball on GitHub releases | `npm i https://github.com/<owner>/app_sneeddao/releases/download/sdk-v0.1.0/sneeddao-sdk-0.1.0.tgz` | Works, but long URLs and a release per version in the main repo; keep as a fallback. |

The mirror has its own `LICENSE`: MIT, "Copyright (c) 2026 Sneed DAO contributors", and an `AUTHORS.md`
copied by the sync from the main repo's `AUTHORS.md` (contributors add themselves there, not in the mirror). Its README points to
the source (`sdk/` in the main repo) and says issues/PRs go there. Browser without a bundler:
`import { createSneed } from 'https://cdn.jsdelivr.net/gh/<org>/sneed-sdk@v0.1.0/dist/index.js'` with an
import map for `@dfinity/*`.

## 9. Docs and tests

Docs
- `sdk/README.md`: install, `createSneed`, networks, safety defaults, links to api-docs and skills.
- `docs/first-integration-<product>.md`, one per product (lock, notifications, sneedex first): "first integration in 10 minutes" — install, staging run, production switch, what the user sees in Sneed Hub.
- API reference generated from JSDoc (TypeDoc over the `.d.ts`), published with the frontend at `/sdk-docs/` and linked from api-docs and the agent skills (skills gain a "With the SDK" section).

Tests
- Unit (`node --test`): derivations pinned to mainnet values (move `support/test/accounts.test.mjs` vectors: lock 119 payment subaccount, gas tanks of locks 133 and 177, sneedex offer 66 / bid 5 escrows, creation fee, sneedapp/premium deposits, jailbreak), `decodeSub` round trips, pockets codec vectors from `pockets-model.test.js`, `icrcTx.test.mjs` and `cyclesTopUp.test.mjs` cases, ICRC-3 hash vectors from `icrc3-hash.test.js`. `SDK_LIVE=1` re-checks vectors on mainnet (as `SUPPORT_LIVE=1`).
- PocketIC (`sdk/test/pic/`, reusing `test/canisters/lib/pic.js` setup and wasms from `test/canisters/build`): each product flow end to end (lockTokens, lockPosition against the test ICPSwap pool, notify after allow, listOffer/bid/claim), `verifyLog` on every ICRC-3 canister, and resend behaviour on a ledger that answers Duplicate.
- Type check: `tsc --noEmit` over `sdk/` and over the README examples.
- CI: generated files fresh (§5), the mirror sync on tags.

## 10. Versioning, changelog, npm later

- Semver from `0.1.0`. While `0.x`, a minor may break; from `1.0.0` (after the frontend and MCP run on it) breaking = major. Interface pin bumps are minor; removed methods or changed result shapes are major.
- `sdk/CHANGELOG.md` (Keep a Changelog), every entry naming the canister releases it pins (`sneed_lock` proposal #…, `didSha256`).
- Tags `sdk-v<x.y.z>` in the main repo trigger the mirror sync and a GitHub release with the tarball (fallback install).
- npm later needs: an npm organisation `sneeddao` (reserves `@sneeddao/*`); who owns it (the user's account as owner plus one more maintainer so it is never a single point of failure; eventually a DAO-held account); 2FA required for publish on every member; publishing from CI with an automation token stored as a repository secret, `npm publish --provenance --access public` on `sdk-v*` tags so builds are traceable to the commit. Until then the scope stays unclaimed, which is a squatting risk (§11 Q1).
- Phase 2: Motoko packages on mops (`sneed-lock-client`, `sneed-notify`: typed interfaces + `notify` helpers for canisters, derivations), same versioning, MIT.

## 11. Migration order (small steps, no big bang)

1. `sdk/` workspace with `core/ids`, `accounts` (port of `support/lib/accounts.mjs` + pinned vectors), `generated/` (gen script + CI freshness). Nothing consumes it yet.
2. Support tool switches `lib/accounts.mjs` and `lib/ids.mjs` to the SDK (its tests already pin the values; read-only, lowest risk).
3. `tx` (moved `icrcTx.js`, `approvals.js` core, `cyclesTopUp.js`); frontend `utils/icrcTx.js` becomes a re-export, so its 44 call sites keep working. Then MCP `chain.js spend()` uses it.
4. `icrc3`: test suite, frontend `utils/icrc3`, support `lib/icrc3.mjs` (with its file cache adapter) one by one.
5. `lock` module; MCP `w_misc.js` lock tool and the frontend lock flows (`Wallet.jsx`, `LockModal.jsx`, `LockPositionModal.jsx`) adopt it. First mirror release `v0.1.0` and the Sneed Lock integration guide.
6. MCP `src/idl/*` replaced by `generated/` (ends the drift); `notifications` module + guide; mirror `v0.2.0`.
7. `sneedex` module + guide; `names`, `forum`, `sms`, `premium`, `rll`; frontend services become thin wrappers.
8. `pockets` moves in once the wallet/pocket work merges. Frontend `src/declarations` imports switch to `generated/` canister by canister.
9. `@icp-sdk/core` major, together with the frontend.

## 12. Open questions

1. GitHub owner of the mirror: a new `SneedDAO` org (also to hold the npm scope later) or `Snassy-icp/sneed-sdk`? Who besides the user admins it?
2. Reserve the npm scope `@sneeddao` now (free, prevents squatting) even though publishing comes later?
3. Interface pins: is "what is deployed on ic" right, or should the SDK track `main` with staging-only methods marked experimental?
4. Off-chain `notify`: `register_app` accepts "the canister is the caller itself"; does that admit a non-canister principal (a dapp's Node backend) as an app principal, or should integrators always notify from a canister (then the JS `notify` is mainly for tests and the Motoko package is the real path)?
5. Result-variant policy (§5): agree that canisters add new result cases only behind a catch-all, so old SDKs keep decoding?
6. Should product modules include convenience swaps (e.g. "lock 50% of the pool's LP" needs ICPSwap mint), or stop at Sneed canisters?
7. Does the SDK expose Sneed Lock's ICRC-7/37 lock NFTs as a separate `nft` module (Sneedex, launchpads) or inside `lock`?
