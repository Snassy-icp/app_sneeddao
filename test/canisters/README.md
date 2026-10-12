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

Every integration test file verifies the ICRC-3 log it produced with an independent
JavaScript implementation of the hash (`lib/icrc3.js`): certificate against the
subnet key, hash tree, `phash` chain across live and archived blocks.

## Layout

- `canisters/` test-only Motoko canisters: `MockLedger.mo`, `MockSwapPool.mo`, `Icrc3Demo.mo`
- `lib/` harness: PocketIC setup, identities, Candid IDLs of the mocks, the ICRC-3 verifier
- `motoko/` Motoko unit tests run with `moc -r`
- `build/` build output (ignored by git)

## Notes

- The PocketIC clock starts in 2021; the harness sets it to now so certificates are
  fresh. Tests that advance time disable only the 5-minute freshness check of the
  agent, not signature or tree verification.
- pic-js returns the subnet public key as a plain array; the harness converts it.
- `sneed_lock` talks to the ICP ledger by its mainnet id, which is why the mock ledger
  is installed at `ryjl3-tyaaa-aaaaa-aaaba-cai` on the NNS subnet.
- Timers fire only when time advances and rounds execute: use `pic.advanceTime` followed
  by `pic.tick(n)`, with enough rounds for the inter-canister calls a spill makes.
