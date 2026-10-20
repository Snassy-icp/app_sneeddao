# Canister tests

Automated tests of the Sneed DAO canisters, run against [PocketIC](https://github.com/dfinity/pocketic)
through [pic-js](https://js.icp.build/pic-js/). No local replica, no mainnet: every run
starts from an empty IC with an NNS subnet and one application subnet.

```
cd test/canisters
npm install          # pic-js downloads its PocketIC server binary
npm run build        # builds sneed_lock with dfx 0.28.0 + the test canisters with the same moc
npm test             # vitest, all files; or: npx vitest run tests/sneed-lock.test.js
```

Requirements: Node 22+, `dfx` with version 0.28.0 installed (`dfxvm install 0.28.0`),
`mops` on the path. `DFX_VERSION` overrides the toolchain version for both build and tests.

## What is covered

| File | Subject |
|---|---|
| `tests/icrc3-hash.test.js` | The ICRC-3 value hash, LEB128 and IC hash trees: Motoko implementation run in the interpreter against the IC request-id vector, a rep-indy-hash cross-check vector and agent-js tree hashes; the JavaScript verifier against the same vectors. |
| `tests/icrc3-library.test.js` | The `src/icrc3` library through `canisters/Icrc3Demo.mo` (a canister written from the library README): empty log, chaining and certification, range queries, tamper detection, settings validation and config blocks, forced spills into size-limited archives, archive controllers, callbacks, parent-only writes and ingress refusal, cycle top-ups and the cycle reserve, the periodic timer, and upgrades. |
| `tests/sneed-lock.test.js` | `sneed_lock` with a mock ICRC-1 ledger (also installed at the real ICP ledger id for fees) and a mock ICPSwap pool: token locks and their limits, withdrawals bounded by locks, the per-caller mutex (interleaved calls), expiry and archiving, liquid locking with rollback on ledger failure, ICP lock fees (payment subaccount, recipient, stats, payment log), position claims, locks, the no-withdraw-while-locked rule, extension, ownership transfer, fee claims with dust, liquidity additions (leftovers, pool refusal), withdrawal after expiry, admin guards and config trail, the ICRC-3 log (every action's block, archives, verification) and an upgrade. |
| `tests/sneed-pad.test.js` | The launchpad with the real ledger-suite wasms: following the NNS's latest version, quotes and premium rates, launches with each control choice (keep, extra controllers, blackhole, Sneed DAO, any SNS, a custody canister), index-only launches for existing ledgers, failure paths and an upgrade. |
| `tests/sneed-guardian.test.js` | The custody canister: registration rules, payment-gated ops (validator, sweep, refunds), approvals, vetoes, go-aheads, windows, expiry, admin trial period, auto-upgrade along the blessed path, reconfiguration, cycles reports, archive discovery, release, and a blackholed instance. |
| `tests/sneedex-core.test.js`, `sneedex-admin.test.js`, `sneedex-nft.test.js`, `sneedex-lock.test.js` | Sneedex: offer validation and the full state machine, token, canister, SNS neuron, NFT and Sneed Lock assets, bids, buyouts, fees and cut accounting, expiration timers, every admin method and an upgrade. |
| `tests/sneedapp.test.js`, `sneedapp-mint.test.js` | The SneedApp factory: publishers, apps, versions, wallet registry, minting with deposits, revenue splits, premium prices, rollbacks on failed transfers, the legacy neuron-manager path and an upgrade. |
| `tests/backend-names.test.js`, `backend-user.test.js`, `backend-admin.test.js`, `backend-names-move.test.js` | The Sneed Hub backend (a public API): names, nicknames, neuron and canister names, avatars, bans and the word blacklist, settings, registries, canister groups, wallet layouts, whitelist import and metadata refresh, partners, projects, jailbreak fees, admin transfers and an upgrade; its part in moving names to the naming service (moderation of the real sneed_pid_names, exports of every user's nicknames and avatars, the naming-write freeze). |
| `tests/forum.test.js`, `tests/sms.test.js` | The forum and messaging canisters (public APIs): content, votes, polls, tips, read tracking, feeds, premium limits, admins, rate limits, privacy on leaving a message, and upgrades. |
| `tests/forum-tips.test.js` | Forum tips checked on the ledger (real ICRC ledger wasm with archives, mock ICP ledger): real tips verify; missing blocks, wrong amount, sender or recipient, mints and approvals are refused; a block backs one tip, also for racing calls; unreadable tips are recorded unverified and count nowhere; tips from before the upgrade keep their blocks and verify with `verify_tip`; `get_api_doc`. |
| `tests/premium.test.js`, `tests/rll.test.js` | Sneed Premium (tiers, ICP purchases, voting-power claims, promo codes, grants) and the reward loop (whitelist import, neuron and proposal imports, exact weights, claims and incidents, the main loop on timers, upgrades). |
| `tests/names-rules.test.js`, `tests/pid-names.test.js`, `tests/neuron-names.test.js`, `tests/nicknames.test.js`, `tests/avatars.test.js`, `tests/profiles.test.js` | The naming service (spec/sneed_names.md): the shared name rules, lower-bound seek and search index in the Motoko interpreter; `sneed_pid_names` with accounts, hotkeys and merging, links by a neuron's staking subaccount, canister names by controllers and SNS governance, verification of the exact name, case-insensitive uniqueness, search and paging, the changes feed, moderation through a mock backend, the import, the ICRC-3 log, the ingress guard and an upgrade; `sneed_neuron_names` with names unique per SNS set by the neuron's principals of SNS-W-listed SNSes, avatars, verification by admins and the neuron's own SNS governance, search and paging per SNS, the feed, the import and an upgrade; the two nickname canisters with privacy per owner, paging and search, free and premium limits, the blacklist without bans, avatars, the import and an upgrade; `sneed_avatars` with image checks by content, storage once by hash in stable memory, holding limits, freeing and slot reuse, admin removal, HTTP serving and an upgrade; `sneed_profiles`' dapp registry (controllers register, unique names, verification, hiding, search, an upgrade). |
| `tests/staking-bot.test.js` | The ICP staking bot against a mock NNS governance: staking, claiming, dissolve, maturity, split and merge, disburse, permissions and botkeys, chores on timers, events between bots and upgrades. |
| `tests/trading-bot.test.js` | The trading bot against mock ICPSwap and KongSwap at their mainnet ids: permissions on every mutating method, configuration, deposits and withdrawals, chore purses, one-off trades on both ICPSwap paths and Kong, the circuit breaker, chores on timers and an upgrade. |

Every integration test file verifies the ICRC-3 log it produced with an independent
JavaScript implementation of the hash (`lib/icrc3.js`): certificate against the
subnet key, hash tree, `phash` chain across live and archived blocks.

## Layout

- `canisters/` test-only Motoko canisters: mock ledgers, DEXes, NNS and SNS governance, SNS-W, CMC, Premium, SneedApp, ICPSwap lists, and `Icrc3Demo.mo`
- `lib/` harness: PocketIC setup, identities, Candid IDLs of the mocks, the ICRC-3 verifier
- `motoko/` Motoko unit tests run with `moc -r`
- `build/` build output (ignored by git)

## Notes

- The PocketIC clock starts in 2021; the harness sets it to now so certificates are
  fresh. Tests that advance time disable only the 5-minute freshness check of the
  agent, not signature or tree verification.
- pic-js returns the subnet public key as a plain array; the harness converts it.
- Canisters that talk to hard-coded mainnet ids (ICP ledger, NNS governance, SNS-W, ICPSwap's list and factory, KongSwap, Sneed governance) get mocks installed at those exact ids; PocketIC creates the owning subnet.
- The backend, forum and SMS canisters use enhanced orthogonal persistence: their upgrade tests pass `wasm_memory_persistence: keep`.
- `sneed_lock` talks to the ICP ledger by its mainnet id, which is why the mock ledger
  is installed at `ryjl3-tyaaa-aaaaa-aaaba-cai` on the NNS subnet.
- Timers fire only when time advances and rounds execute: use `pic.advanceTime` followed
  by `pic.tick(n)`, with enough rounds for the inter-canister calls a spill makes.
