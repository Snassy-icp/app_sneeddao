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

> **Status (2026-10-20)**, in the plan order rating page → `sneed_wasm_registry` → `sneed_guardian` → `sneed_pad`:
> 1. **Rating page: built.** It is the Check tab of the Token Studio at `/studio/<ledger>` (`pages/TokenSafety.jsx` `CheckPanel`, `tokensafety/checks.js`). `/tools/token_safety[/<ledger>]` redirects there, and the `/token-safety/<ledger>` route this plan names never existed. It ships without the registry: hashes are compared with the SNS wasm canister's history and a built-in list of official DFINITY ledger-suite releases (`tokensafety/dfinityReleases.js`). Each release entry also carries the SHA-256 of the decompressed Wasm (`raw`), so a recompressed copy of an official build is recognised once the team has verified the file and listed it in `tokensafety/repackaged.js` (empty so far); the code line's "Verify a recompressed build" box lets anyone check a .wasm.gz in the browser (file upload; URLs only from GitHub and icp0.io hosts, which the CSP allows). Controllers that are unclassified canisters are followed up to 3 levels (at most 20 canisters, `tokensafety/controllerTree.js`): a canister whose every path ends in NNS root, an SNS root, a blackhole, a Sneed guardian or no controllers grades **partial** ("semi-blackholed": its own code decides what it does with its control), and pass only if all of them run code in the known-safe list (empty so far); a path to a user principal still fails. A partial controllers gate caps the headline at Fair.
> 2. **`sneed_wasm_registry`: planned, not started.** No canister and no code.
> 3. **`sneed_guardian`: built, staging only** (`src/sneed_guardian`, three deployments, see `spec/custody.md`). It was built ahead of the registry: it vets code against the NNS-blessed hashes itself.
> 4. **`sneed_pad`: partly built, staging only** (`src/sneed_pad`, `symdn-ciaaa-aaaal-qxobq-cai`). Tiers 1–3 are built (bare ledger, index, the control choices including custody) plus indexes for existing ledgers. Tiers 4–5 (locks and liquidity through the pad) are not built. The Launch, Index and Hand over tabs sit behind the "coming soon" gate (admins preview them).
> 5. **Scanner canister: not built.** Holders are rebuilt in the browser, off the main thread in a web worker (`tokensafety/scan.worker.js`).

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

As built (`classifyControllers`), each canister of the trio is graded alone:

| Controllers | Grade |
|---|---|
| None | pass |
| Only one of the custody canisters (`sneed_guardian*`) | pass, with the child's rules shown; warn when the canister is not registered there |
| Only blackhole canisters (v0 `e3mmv-…`, v2 `5vdms-…`) | pass |
| Only NNS root | pass |
| Only the root of any NNS-deployed SNS | pass |
| A mix including one of the above, or anything else | fail |

Changed from the original plan: the gate does not grade SNS maturity or check that the
canister is registered with the SNS. A sole SNS root passes, and the DAO's quality is
judged by "The DAO behind it" group, where a captured DAO caps the rating. NNS root
control was added. The "frozen feature set" note for blackholed ledgers is not shown
yet (planned).

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

As built (`classifyHash`): pass for a hash in the SNS wasm canister's version list for
that kind, or in the built-in list of official DFINITY ledger-suite releases; warn for a
DFINITY ledger-suite wasm of another kind (an archive wasm installed as the ledger, say);
pass for an unknown hash when NNS root is the controller (installed by NNS proposal);
otherwise fail ("unknown wasm"). The "reproduced", "known source" and "flagged" grades
need the registry and are **planned**. The index is found through ICRC-106, the SNS
registry or the pad's own launch records; `?index=` names one by hand. The code group also
lists the announced standards (`code:standards`) and checks the ICRC-3 tip certificate
(`code:tip`).

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

Status of the dimensions (2026-10-20):

| Dimension | Status | Leaves |
|---|---|---|
| Minting | built | `mint:account`, `mint:untracked` (supply outside the log), `mint:history`; the fee collector appears in the details |
| Distribution | built | `dist:recon`, `dist:top1`, `dist:top10`, `dist:count`, known accounts tagged; NatLabs `get_transactions` ledgers walked sequentially |
| Locked supply | built | `locks:total`, `locks:sneedlock`, `locks:neurons`, `locks:treasury` (the SNS treasury, shown apart), `locks:cliffs` |
| Liquidity | built | `lp:exists` / `lp:none`, `lp:depth`, `lp:control` (Sneed Lock, DAO, burned and immutable owners matched by account identifier) |
| The DAO behind it | built | `dao:info`, `dao:top`, `dao:following`, `dao:votable`, `dao:genesis`, `dao:participation` |
| Distribution by origin | built | `dist:folded`, `dist:fanout`, `dist:origin`; the money graph at `/tools/money` |
| Cycles and memory | built | via the blackhole, SNS root, a custody canister or NNS root; otherwise "not observable" |
| Allowances | **planned** | not checked yet |
| Age and upgrade history | partly | `supply:age` (age from block 0) is built; module-hash change history is planned |

The headline rating (`rateTree`): **Unverifiable** when either gate fails; **Captured DAO**
when the DAO group fails; otherwise over minting, distribution, locks, liquidity and
cycles: **Strong** (no failure, at most one warning), **Fair** (at most one failure), **Weak**.
The thresholds (`tokensafety/config.js`: holder shares, lock length, liquidity depth, DAO
shares, the maximum blocks to scan (500,000 by default), cycle levels) can be changed in the page
and are stored per browser. A finished report is cached in the tab for 30 minutes.

## 2. `sneed_wasm_registry`

**Status (2026-10-20): planned, not started.** Until it exists, the rating page uses the
SNS wasm canister's history and its built-in DFINITY release list, and the custody canisters
and the pad trust only NNS-blessed hashes.

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

(Status 2026-10-20: tiers 1–3 built, 4–5 planned; see the status notes below.)

Defaults: ledger-suite wasms held by the pad and installed with the creator's init
args; minting account set to a principal that cannot act unless the creator opts into
DAO minting; archive controller set to the same controller as the ledger; a cycle
reserve funded by the creator for archive creation. Ledger choice is offered once there
are two, with the score each would earn shown next to the choice.

`sneed_guardian`: sole controller of launched ledgers; installs only hashes present in
the registry's vetted set (initially "present in the SNS wasm canister", widened by
DAO proposal); tops up cycles; exposes public canister status. Blackhole-grade safety
with patchability.

Changed from the original plan: `sneed_guardian` was built as the custody canister of
`spec/custody.md` (2026-10-14). It installs only NNS-blessed ledger-suite hashes, one step
at a time (no registry widening). Changes go through DAO-approved ops with per-child veto
councils, and it publishes each child's status and cycles. It does **not** top up cycles;
that is left to ic-unicycle and anyone else.

### Status (2026-10-13)

`src/sneed_pad` implements stages 1 and 2: `get_quote`, `create_token` (one
ICRC-2 pull of the quoted total; cycles through the CMC with the pad fronting
them; ledger and optional index installed from SNS-W wasms; control kept,
blackholed, or handed to Sneed DAO with an automatic registration proposal; changed the same day: the pad files no proposals, see "Control choices" below),
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

**Status update (2026-10-20):** the pad also creates indexes for existing ledgers
(`get_index_quote`, `create_index`, `list_index_launches`, `get_indexes_of_ledger`), on the
blessed index code with the same payment and control choices. It offers a sixth control
choice, `#guardian { canister; policy }`, which hands the canisters to a custody canister and
registers them there (fixed 2026-10-20: an index from `create_index` for a ledger the custody
canister already holds now joins that ledger's suite; it was registered with `suite = null`). The handover fee (`sneed_dao_control_fee_e8s`, 5 ICP) applies to
`#sneed_dao`, `#guardian`, and `#sns` when the root is Sneed's. Minting policy is `#nobody` (the
ledger itself is the minting account), `#sneed_dao` or `#principal`. Not built: tiers 4–5
(locks and liquidity from the pad) and plan-then-pay across stages. The pad is still on
staging only.

**Special prices (2026-10-21, spec/special_prices.md):** next to the regular and premium fees,
an admin price and partner prices with `Prices = { creation_fee_e8s; index_creation_fee_e8s;
sneed_dao_control_fee_e8s }` (each `opt nat`; the creation fee override covers both the regular
and the member launch fee). Each fee of a quote is the lowest of the base fee as before, the
admin price (caller is an admin and a person) and the caller's unexpired partner price; the
handover fee is only overridden when one is charged. `get_quote` / `get_index_quote` already
return the effective fees. Admin methods `set_admin_prices`, `set_partner_prices`,
`remove_partner_prices` (governance, controllers or listed admins, like `admin_set_config`);
public queries `get_special_prices`, `get_special_prices_for(principal)`,
`get_launch_price_tiers(id)` and `get_index_launch_price_tiers(id)` (`{ creation_fee; control_fee }`
tiers, null for launches before special prices). Changes are `sneedpad_config_update` blocks (key
`admin_prices`, or `partner_prices` with `partner`); `sneedpad_token_create` and the standalone
`sneedpad_index_create` carry `price_tier` and `control_price_tier`.

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

Status (2026-10-20): the studio now has five tabs, at `/studio/<ledger>[/harden|/handover|/index]`
and `/studio/launch`: Check, Harden, **Hand over** (`/custody` opens it without a ledger) and
**Index** (`/studio/index` without a ledger) were added for the custody canisters, and Launch.
Hand over, Index and Launch are behind the "coming soon" gate. Harden still shows dfx commands
for blackholing or handing to an SNS; filing RegisterDappCanisters from the studio and the
ic-unicycle integration are still marked "next" or "coming". The fix buttons (`tokensafety/fixes.js`)
send controller failures to Hand over, index failures to Index, and the rest to Harden sections
or the lock wizard.

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
(It was built the next day as the custody canister, which vets against NNS-blessed hashes
and reports cycles without topping up; see section 4 and `spec/custody.md`. The ic-unicycle
integration is not built yet.)
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

Status (2026-10-20): 1 built; 2 not started; 3 built (staging); 4 tiers 1–3 built (staging),
4–5 not; 5 not started (the in-browser scan moved to a web worker). Steps 2 and 3 were done
out of order: the guardian was built first, against the NNS-blessed list.
