# Token safety: rating, registry, launchpad

Plan agreed on 2026-10-12. Three deliverables, built in this order:

1. **Token safety page** (`/token-safety/<ledger>`): rates any ICRC ledger on the IC
   from public, verifiable data. Lives in the frontend; no new canister.
2. **`sneed_registry`**: the registry of known wasm hashes, their sources and the
   evidence behind them (reproductions, audits, endorsements, flags). DAO-controlled,
   ICRC-3 logged.
3. **`sneed_pad`**: the launchpad. Creates ledgers from vetted code, hands control to
   the DAO, the blackhole or `sneed_guardian`, locks allocations and liquidity through
   `sneed_lock`, and is configurable down to "a bare ledger for a game".

Principles: the creator pays the cycles, fees go to the RLL, and the rating must stay
honest, including for Sneed's own tokens.

## 1. The rating model

The seven checks are not equal peers. The first two are **gates**: every query answer a
ledger gives (supply, balances, minting account, metadata) is only a claim unless the
code is known and nobody unexpected can replace it. When a gate fails, the score is
**capped** ("unverifiable"), not merely reduced.

### Gates

**Controllers** (read through `read_state`, public for any canister):

| Controllers of the ledger, its archives and its index | Grade |
|---|---|
| Empty, or only the blackhole canister (which also exposes canister status) | full |
| Only the SNS root of a mature SNS, canister registered with that SNS | full |
| Only `sneed_guardian` (installs vetted hashes only, keeps cycles, public status) | full |
| SNS root of a young or concentrated SNS | partial, with the DAO's figures shown |
| Any other principal, or a mix | fail |

Blackholed is not strictly better than DAO-controlled: the ledger suite gets real
upgrades (ICRC-3, ICRC-2 fixes, stable-memory migrations). Show "frozen feature set"
for blackholed ledgers.

**Code** (module hash through `read_state`, compared with the registry):

| Hash | Grade |
|---|---|
| NNS-approved ledger-suite version (from the SNS wasm canister history) | full |
| Reproducible build of a known source, reproduced by independent parties | full |
| Known source, not reproduced | partial |
| Reference implementation / unmaintained / flagged | fail or capped |
| Unknown | capped ("unverified") |

The ledger is a trio: ledger, archives (spawned by the ledger; their controller is set
in the ledger's archive options) and the index wallets read. All three are checked.
The archive chain is verified through the ICRC-3 tip certificate.

### Dimensions (behind the gates)

- **Minting.** The ICRC ledger has no max supply; the minting account can mint without
  limit. Minting account owner: a principal that cannot act (the ledger itself,
  anonymous, a blackholed canister) is best; DAO governance is good; a user principal
  fails. Show mints after launch from the block log, and the fee collector if set.
- **Distribution.** Holders reconstructed from the ICRC-3 log (index-ng has no
  top-holders endpoint). Tag known accounts before measuring concentration: minting
  account, treasuries, DEX pools, the lock canister. Sybil wallets make this a weak
  signal; weight it lightly. Long term: a scanner canister following registered ledgers.
- **Whale locks.** Share of circulating supply locked in `sneed_lock`, weighted by
  remaining duration, plus the unlock timeline. A lock expiring next week is sell
  pressure, not safety.
- **Liquidity.** ICPSwap positions locked in `sneed_lock`: depth relative to market
  cap, share of the pool that is locked, lock duration, and whether the position's
  range covers the current price (an out-of-range position provides nothing).
- **Cycles and memory.** Observable only through the blackhole canister, an SNS root
  summary, `sneed_guardian`, or a self-reported status method. "Not observable" is
  shown as such. The ledger also needs a cycle reserve to spawn archives.
- **Allowances.** Large ICRC-2 allowances from big holders to unknown spenders are a
  hidden transfer route.
- **Age and upgrade history.** A module hash that changed recently deserves a look.

Presentation: the same tree as `/health` (gates on top, dimensions below, each row
stating what would raise the score). Scores are computed in the page from the raw
evidence, never stored, so the page can always show why.

## 2. `sneed_registry`

Three layers:

- **Source**: repository at a commit or tag, path, license, authors, release lineage.
  Developer reputation lives here.
- **Artifact**: one wasm hash (gzipped and raw, since the IC reports whichever bytes
  were installed), kind, Candid interface hash, predecessor/successor, build recipe
  (toolchain versions, container digest, command), known issues. Verification lives
  here: an artifact is tied to its source only by reproduction attestations.
- **Evidence**: typed attestations by principals (reproduced build, reviewed, trust
  developer, runs in production, flag), audits (commit range of a source, auditor,
  report stored by content hash so it cannot be swapped, mapped onto the artifacts
  built from that range), and observed deployments.

```motoko
type Source = { repo : Text; commit : Text; tag : ?Text; path : Text; license : ?Text; predecessor : ?SourceId };
type Build = { toolchain : [(Text, Text)]; container : ?Text; command : Text };
type Artifact = { hash : Blob; gz_hash : ?Blob; kind : Kind; interface_hash : ?Blob; source : ?SourceId; build : ?Build; supersedes : ?Blob; issues : [Issue] };
type Attestation = {
  by : Principal; at : Time; subject : { #source : SourceId; #artifact : Blob };
  claim : { #reproduced : { hash : Blob; toolchain : [(Text, Text)] }; #reviewed : { scope : Text }; #trust_developer; #runs_in_production : { canister : Principal }; #flag : { severity : Severity } };
  note : Text; links : [Text]; withdrawn : ?Time;
};
type Audit = { source : SourceId; from_commit : Text; to_commit : Text; auditor : Text; auditor_principal : ?Principal; date : Time; report_hash : Blob; report_url : Text; findings : Text };
```

Machine evidence, with a system principal as author and shown separately from human
evidence: NNS approval from the SNS wasm canister history, deployments per hash from
chain scans, automatic reproductions in a container.

Confidence votes: two scales, never merged (the "critics and audience" rule).
Stake-weighted endorsements use the NNS voting-power formula (stake, dissolve delay,
age) so weight cannot be bought with liquid ICP; SNS stake converts at a capped pool
price. Expert evidence (reproductions, audits) is checkable and unweighted. Negative
signals outweigh positive ones; flags have a dispute path resolved by Sneed DAO
proposal. Self-attestation (attestor deployed canisters running the hash, or controls
the source) is labelled, not hidden.

Proving stake: SNS neurons are public by principal. NNS neuron control is not public
and Internet Identity principals differ per dapp; hotkeys would work but can also vote.
Verify what public neurons expose before promising ICP-weighted votes; fall back to
SNS stake plus a plain endorsement count for NNS.

Operation: DAO-controlled canister with an ICRC-3 log (every attestation, audit and
flag is a block); a small fee per entry, routed to the RLL; the safety page and the
launchpad read it through the same public query API as everyone else. Bootstrap from
the SNS wasm canister history alone, giving an NNS-backed registry on day one.

## 3. Ledgers and hashes

- **Default code: the DFINITY ICRC ledger suite** (ledger, archive, index-ng; the
  same wasms every SNS token, ckBTC and ckETH run). Hashes come from the SNS wasm
  canister, so the vetted list is NNS history, not a file we curate.
- The Motoko **reference implementation** in dfinity/ICRC-1 (balances folded from the
  log) is listed as "reference, not production".
- **ICDevs** icrc1/2/3-mo: a second option only on demand; a fork without ICRC-85 has
  its own hash and reproducible build that we own.
- **A Sneed slim ledger**: a later "lite" tier, scored honestly as unaudited unless
  externally reviewed. Not day one.
- The registry knows all of them regardless of what the pad offers, each with source,
  toolchain for reproduction, grade and known issues. Older Motoko ledgers (NatLabs)
  that early tokens run are included.

## 4. `sneed_pad`

Tiers that map directly to the score, each an upgrade the creator can buy later:

1. Bare ledger, creator as controller, no index: cheap, scores low, honest.
2. Index and cycle monitoring.
3. Control handed to Sneed DAO, the blackhole, or `sneed_guardian`.
4. Allocations locked with vesting through `sneed_lock`.
5. ICPSwap position created and locked through `sneed_lock`.

Defaults: ledger-suite wasms held by the pad and installed with the creator's init
args; minting account set to a principal that cannot act unless the creator opts into
DAO minting; archive controller set to the same controller as the ledger; a cycle
reserve funded by the creator for archive creation. Ledger choice is offered once there
are two, with the score each would earn shown next to the choice.

`sneed_guardian`: sole controller of launched ledgers; installs only hashes present in
the registry's vetted set (initially "present in the SNS wasm canister", widened by
DAO proposal); tops up cycles; exposes public canister status. Blackhole-grade safety
with patchability.

## 5. Order of work

1. Token safety page reading live data: controllers and hashes through `read_state`,
   NNS-approved hashes from the SNS wasm canister, minting account, supply and
   metadata, holders from the ICRC-3 log (capped block count in the browser), locks
   from `sneed_lock`, ICPSwap pools and locked positions, status where observable.
2. `sneed_registry` with the three-layer model, ICRC-3 log, bootstrap from SNS-W,
   attestations and audits; the page switches from its built-in list to the registry.
3. `sneed_guardian`.
4. `sneed_pad`, tier by tier, with its own front-end ("Sneed Fun" as a brand if wanted).
5. Scanner canister for holders once in-browser reconstruction is too slow.
