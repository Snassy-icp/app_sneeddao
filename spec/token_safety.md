# Token safety: rating, registry, launchpad

Plan agreed on 2026-10-12. Three deliverables, built in this order:

1. **Token safety page** (`/token-safety/<ledger>`): rates any ICRC ledger on the IC
   from public, verifiable data. Lives in the frontend; no new canister.
2. **`sneed_wasm_registry`**: the registry of known wasm hashes, their sources and the
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
- **Distribution.** Holders reconstructed from the block log: the ledger suite's
  `get_blocks` (2000 a request), ICRC-3, or the `get_transactions` family of
  NatLabs-style ledgers (walked sequentially, since their archives ignore ranges and
  duplicate records). Supply created outside the log (init-argument balances) is
  measured and told apart from supply the log has since traced. Tag known accounts
  before measuring concentration: minting account, treasuries, DEX pools, the lock
  canister. Long term: a scanner canister following registered ledgers.
- **Locked supply.** Tokens that cannot move for a known time, from two equal sources:
  `sneed_lock` locks and SNS neuron stake (dissolve delay, or time left when
  dissolving, plus vesting). Weighted by remaining duration, plus the unlock timeline
  including neurons that become liquid inside the window. A lock expiring next week
  is sell pressure, not safety.
- **Liquidity.** Depth of the main ICPSwap pool relative to market cap (a pool holding
  5% of the market cap is deep however small the token; an absolute floor catches
  pools too thin to trade). Then every position in the pool is classified by who can
  withdraw it, and these count as safe alike: locked in `sneed_lock` with time left;
  owned by a DAO (SNS governance or root, or a canister only an SNS root controls,
  such as Sneed's DeFi canister); burned (owned by the anonymous principal or the pool
  itself, so no one can ever act as the owner); or owned by immutable code known not
  to move positions (the blackhole canisters). A canister with no controllers but
  unknown code is **not** safe: it may expose a method that transfers the position,
  and only the registry can clear it. Out-of-range positions provide nothing. Owners
  are matched by ICP account identifier, which is what the pool reports.
- **The DAO behind it.** For an SNS token, or a ledger an SNS root controls, the
  governance that controls the code is rated: largest voting principal (neurons are
  attributed to the principal with ManagePrincipals), influence after catch-all
  following (own power plus followers, one level), stake able to vote, genesis
  neurons with vesting, and participation on recent proposals. A captured DAO caps
  the rating like a failed gate.
- **Distribution by origin.** Facts about where balances came from, never a Sybil
  verdict: a satellite account received its whole balance from one sender and never
  sent anything, and is folded into its funder for a second largest-holder figure;
  supply is split into bought from a pool, minted directly, received from a genesis
  account, or from other holders; and the share sitting in single-source dormant
  accounts is reported. Exchange hot wallets will need registry tags to avoid false
  positives; a determined actor routing through a DEX defeats this, so it stays a
  warning-level signal.
- **Cycles and memory.** Observable only through the blackhole canister, an SNS root
  summary, `sneed_guardian`, or a self-reported status method. "Not observable" is
  shown as such. The ledger also needs a cycle reserve to spawn archives.
- **Allowances.** Large ICRC-2 allowances from big holders to unknown spenders are a
  hidden transfer route.
- **Age and upgrade history.** A module hash that changed recently deserves a look.

Presentation: the same tree as `/health` (gates on top, dimensions below, each row
stating what would raise the score). Scores are computed in the page from the raw
evidence, never stored, so the page can always show why.

## 2. `sneed_wasm_registry`

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

### Status (2026-10-13)

`src/sneed_pad` implements stages 1 and 2: `get_quote`, `create_token` (one
ICRC-2 pull of the quoted total; cycles through the CMC with the pad fronting
them; ledger and optional index installed from SNS-W wasms; control kept,
blackholed, or handed to Sneed DAO with an automatic registration proposal),
launch records, an ICRC-3 log, DAO/admin configuration. The wasm hashes need
nobody: a daily timer (and a first run one second after install) asks SNS-W
for the latest NNS-approved SNS version and adopts its ledger and index
hashes, fetching and sha256-verifying the bytes before swapping, so a bad
fetch never takes a working version away. Anyone may call `refresh_wasms`
(ten-minute gap for non-admins); the DAO can pin hashes instead
(`admin_set_wasm_hashes` turns `follow_nns` off). Fees are dual: the
standard creation fee and a Sneed Premium member fee (membership checked
through the shared PremiumClient against the premium canister), both set by
`admin_set_config` (governance, controllers or listed admins).
PocketIC tests in test/canisters/tests/sneed-pad.test.js use the real
ledger-suite wasms. The pad is deployed on staging (symdn-ciaaa-aaaal-qxobq-cai).

**Token Studio (2026-10-13):** the front end for all of this is one page,
`/studio`, with three tabs. Check is the rating (was /tools/token_safety),
with a fix button on every failing or weak line (src/tokensafety/fixes.js maps
leaf ids to actions). Harden lists what the owner of an existing token can do,
section by section: lock supply and LP positions in Sneed Lock (the lock
wizard takes `?type=token|position&token=<ledger>`), hand control to the
blackhole or an SNS (commands today; filed from the studio with the user's
own hotkeyed neuron next), add an index (pad stage, next), minting (cannot
change after install), cycles (ic-unicycle integration, see below). Launch is the pad (was
/tools/pad). The old routes redirect.

**Control choices (2026-10-13):** `#keep` (creator), `#keep_with [principals]`
(creator plus up to ten more; adding an SNS root here lets that DAO register the
canisters later), `#blackhole`, `#sneed_dao` and `#sns root` (any NNS-deployed SNS,
checked against SNS-W). For the two DAO options the SNS root becomes the only
controller and the *creator* files RegisterDappCanisters with their own neuron from
the wizard, which refuses to launch when the creator holds no neuron with the
SubmitProposal permission in that DAO (it offers "keep control and add the root"
instead). The pad holds no DAO neuron and files nothing; only the Sneed handover
carries the handover fee. The wizard warns before launching without a logo, and
registers the ledger in the creator's wallet and SneedApp entries.

**Cycles (2026-10-13):** no new guardian canister for cycles. Sneed DAO already
runs ic-unicycle, a member-built monitor that watches cycles, tops canisters up and
can file treasury proposals for SNS-controlled canisters; the studio integrates with
it for ledgers, archives and indexes. `sneed_guardian` in section 3, if it is built
at all, is only the code-vetting controller (installs registry-trusted hashes only).
Planned next: adopt existing ledgers, lock and liquidity stages, plan-then-pay
across stages (one approval, staged execution), index canisters for existing
ICRC-3 ledgers.

## 5. Order of work

1. Token safety page reading live data: controllers and hashes through `read_state`,
   NNS-approved hashes from the SNS wasm canister, minting account, supply and
   metadata, holders from the ICRC-3 log (capped block count in the browser), locks
   from `sneed_lock`, ICPSwap pools and locked positions, status where observable.
2. `sneed_wasm_registry` with the three-layer model, ICRC-3 log, bootstrap from SNS-W,
   attestations and audits; the page switches from its built-in list to the registry.
3. `sneed_guardian`.
4. `sneed_pad`, tier by tier, with its own front-end ("Sneed Fun" as a brand if wanted).
5. Scanner canister for holders once in-browser reconstruction is too slow.
