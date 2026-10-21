# Staging without real money: test ICP (later)

Status: planned, not started (agreed 2026-10-21).

## Why

Staging runs on mainnet and is public: proposals link to it so voters can try a release before it
ships. Its canisters take real ICP and SNEED today. That is tolerable while only the team tests with
tiny amounts, but there should never be real money on staging.

## Now (done first)

- Every staging fee destination is set to where production sends it: the RLL's ICP splitter
  (owner `6jvpj-sqaaa-aaaaj-azwnq-cai`, subaccount `01 00 00 00 00 06` followed by zeros) for ICP,
  and the SNEED splitter (node 45) for SNEED. Nothing on staging pays a team member or Mr Sneed.
- Staging prices stay at their floor.
- The staging banner says: "Staging uses real tokens: test with tiny amounts only."

## Later: a test ICP ledger for staging

1. Deploy an ICRC-1/2 ledger for staging only ("Test ICP", symbol `TICP`, 8 decimals, the ICP
   ledger's fee), from the DFINITY ledger suite (an official, verifiable build), plus its index
   canister.
2. A faucet: a small canister or a minting account behind a rate-limited `claim()` that hands out
   test ICP to anyone signed in (for example 10 TICP a day per principal).
3. Point each staging canister whose ledger id is configurable at the test ledger, using its admin
   setter. Canisters with the ICP ledger hard-coded get a configurable ledger first: additive
   config, with the real ICP ledger as the default, so production stays unchanged.
4. Frontend: on staging, show TICP wherever ICP is shown, with the faucet one click away, and keep
   the denomination code unchanged (the token is just another ledger).
5. Leave on real ICP whatever cannot be faked: anything that talks to real SNSes, ICPSwap/Kong,
   the CMC (cycles) or the NNS. Those flows stay at tiny amounts and are labelled on staging.

The canisters that take money, with their ledgers and setters, are listed in the staging revenue
inventory (see the release plan doc); update that list when this starts.
