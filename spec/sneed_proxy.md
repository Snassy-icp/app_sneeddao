> **Status: parked (2026-10-23), superseded for settings by spec/dao_settings.md; the canister is built and tested, kept for possible multi-step atomic changes.**

# sneed_proxy: every admin setting by SNS proposal (draft)

The aim is a Sneed DAO run entirely by its members. Every parameter and action that only admins
can change today from Sneed Hub's admin pages should also be changeable by SNS proposal. Any
member can submit such a proposal from inside Sneed Hub, provided their principal can submit
proposals for a SNEED neuron (as the neuron's owner or as a hotkey with `SubmitProposal`). The
member never needs the SNS toolkit or an outside proposal builder.

- **Admin pages become public.** Everyone can read them. Admins apply changes directly, as
  today. Everyone else gets a "Propose" button in place of "Apply".
- **Settings get small in-place buttons.** Where a setting is shown to users, a button such as
  "Propose to change the splitter ratios" sits next to it.

One new canister, `sneed_proxy`, carries the proposals into the canisters. It is controlled by
SNS root and is an admin on each target canister. It has one execute method per proposal topic,
and each execute method is registered as its own generic nervous system function (GNSF). An
allowlist decides which `(canister, method)` may be called, and through which topic.

Status (2026-10-21): built, not deployed. `src/sneed_proxy` (EOP), tests in
`test/canisters/tests/sneed-proxy.test.js` (mock governance; pilot on the real sneed_lock wasm),
frontend groundwork in `src/app_sneeddao_frontend/src/governance/`. No proposals yet. The open
questions are answered (§11, "Decisions").
- SNS root: `fp274-iaaaa-aaaaq-aacha-cai`.
- SNS governance: `fi3zi-fyaaa-aaaaq-aachq-cai`.

Open questions are marked **Q** and collected in §11.

## 1. What the SNS gives us (checked 2026-10-21)

### 1.1 Topics and criticality

From read-only `list_topics` on fi3zi:

| Topic | Critical | Native functions in it |
|---|---|---|
| `DaoCommunitySettings` | **yes** | 2 Manage nervous system parameters, 8 Manage SNS metadata, 13 Manage ledger parameters |
| `SnsFrameworkManagement` | no | 7 Upgrade SNS to next version, 15 Advance SNS target version |
| `DappCanisterManagement` | no | 3 Upgrade SNS controlled canister, 10 Register dapp canisters, 14 Manage dapp canister settings |
| `ApplicationBusinessLogic` | no | none (custom functions only) |
| `Governance` | no | 1 Motion |
| `TreasuryAssetManagement` | **yes** | 9 Transfer SNS treasury funds, 12 Mint SNS tokens |
| `CriticalDappOperations` | **yes** | 4 Add GNSF, 5 Remove GNSF, 11 Deregister dapp canisters, 16 Set topics for custom proposals, 17 Register extension, 19 Upgrade extension |

How criticality works:
- It follows the topic. A GNSF placed in a critical topic gets the critical rules.
- The topic is set by the `topic` field of `GenericNervousSystemFunction` when the function is
  added. It can be changed later with `SetTopicsForCustomProposals` (native function 16), which
  is itself critical.

What critical means (DFINITY forum "Improvements for SNS treasury and other critical proposals",
in force since governance with topic-based criticality):
- **Normal proposal:** passes with a majority of exercised voting power and at least 3% of total
  voting power voting yes.
- **Critical proposal:** needs at least 67% of exercised voting power voting yes, and at least
  20% of total voting power voting yes.
- Critical voting periods are longer: 5 days, up to 10 with wait-for-quiet, and the SNS cannot
  change them.
- Catch-all following (function 0) does not apply to critical proposals.

Sneed's current parameters (`get_nervous_system_parameters`):
- Initial voting period: 4 days (`345_600` s).
- Wait-for-quiet: plus 1 day.
- Reject cost: 0.1 SNEED (`10_000_000` e8s).
- Minimum dissolve delay to vote: about 30.4 days (`2_630_016` s).
- Grantable permissions include 3 (`SubmitProposal`).

A member therefore needs a neuron with at least about a month of dissolve delay and more than
0.1 SNEED of stake. Their principal must hold permission 3 on that neuron.

### 1.2 Existing custom functions

From `list_nervous_system_functions`, read-only:

| id | name | topic | target → method |
|---|---|---|---|
| 2000 | set_canister_ids | CriticalDappOperations | 5ceyv… `set_canister_ids` |
| 2001 | burn_old_tokens | TreasuryAssetManagement | 5ceyv… |
| 2002 | send_icrc1_tokens | TreasuryAssetManagement | ok64y… (Sneed DeFi) |
| 2003 | transfer_icpswap_lp_position | TreasuryAssetManagement | ok64y… |
| 2004 | deploy_icrc1_tokens_to_icpswap | TreasuryAssetManagement | ok64y… |
| 2005 | transfer_icpex_lp_position | TreasuryAssetManagement | ok64y… |
| 2006 | transfer_icpswap_lp_from_governance | TreasuryAssetManagement | validator ok64y…, target osyzs… `transferPosition` |
| 3000 | Neuron Pylon: ICRC55 Command | TreasuryAssetManagement | 6jvpj… `icrc55_command` (the ICP and SNEED splitters live here) |
| 3001 | deploy_icrc1_tokens | TreasuryAssetManagement | ok64y… |
| 3002 | Transcendence Pylon: ICRC55 Command | TreasuryAssetManagement | togwv… `icrc55_command` (buyback) |
| 3003–3005 | Sonic claim / withdraw / transfer position | TreasuryAssetManagement | ni6i4… |
| 4000–4013 | Unicycle: Setup … Deregister (14 functions) | ApplicationBusinessLogic | 2ccdl… |
| 5000 | Mr Sneed: set personality | ApplicationBusinessLogic | ucthl… `set_personality` |

Native ids are 0–19. The ranges 6000–6099 are free.

**Proposed: reserve 6000–6099 for Sneed Hub governance.**
- 6000–6009: the proxy's execute functions.
- 6010–6019: the proxy's own administration.
- 6020–6049: spare for the proxy.
- 6050–6099: direct GNSFs on Sneed canisters that already have DAO validators (§6.3).

Mr Sneed keeps the 5000 range.

### 1.3 How governance runs a GNSF (relevant facts)

1. **At submission**, governance calls `validator_canister_id.validator_method_name(payload)`.
   - The validator must reply Candid `variant { Ok : text; Err : text }`.
   - `Err` refuses the proposal, and the submitter is not charged.
   - The `Ok` text is stored as the proposal's `payload_text_rendering`. That is what NNS dapp,
     the SNS toolkit and Sneed Hub's `Proposal.jsx` show voters.
2. **When adopted**, governance calls `target_canister_id.target_method_name(payload)` with the
   raw payload bytes.
   - Any reply means success: the proposal becomes "executed".
   - A reject or trap means failure: the proposal is "failed" with the reject message.
   - Governance never retries.
3. **The target cannot see the proposal id**, which is not part of the call.
4. **Payload size is capped by governance.** Current source: 70,000 bytes for
   `ExecuteGenericNervousSystemFunction` payloads. Check this against the running governance
   version (`24ef2004…`) in the PocketIC rehearsal before relying on it. In practice it rules
   out wasm uploads (`sneedapp.setManagerWasm`) through the proxy.

### 1.4 Bounded-wait calls from Motoko

- moc 0.14.13 (dfx 0.28.0, our release toolchain) compiles
  `await (with timeout = n) IC.call(canister, method, argBlob)`.
- `IC` is `mo:base/ExperimentalInternetComputer`, i.e. `Prim.call_raw`. The emitted wasm
  imports `ic0.call_with_best_effort_response`. This was checked by a test compile on
  2026-10-21.
- The repo already uses `(with timeout = …)` in sneedex, the forum's `TipVerify.mo` and
  sneed_pid_names.
- The IC caps the timeout at 300 s.
- A timed-out call throws with `#system_unknown`. `Error.isRetryPossible` tells this apart from
  a definite reject.

So the proxy forwards with a bounded-wait raw call, with no typed actor reference needed.

## 2. Why a proxy

Three alternatives were considered and rejected.

- **One GNSF per admin method, with the canister itself as the target.** That means hundreds of
  `AddGenericNervousSystemFunction` proposals, each critical and taking 5–10 days. Each target
  would need a `validate_*` method for every admin method. Each target would also have to accept
  governance as an admin, which only rll, the forum, sms, sneed_lock and sneed_pad do today.
- **GNSFs whose target is the real canister and whose validator is a shared validator
  canister.** GNSF 2006 does this. It still needs one GNSF per method, and governance becomes
  the caller everywhere.
- **Proposals that only signal intent (motions) while admins carry them out.** That is not
  member control.

With the proxy, a new setting becomes proposable by one allowlist entry, which needs one
critical proposal and no new GNSF. Every execution goes through one ingress guard, one
validation path and one ICRC-3 log.

## 3. The canister

`src/sneed_proxy/main.mo`.
- It is a persistent actor with enhanced orthogonal persistence, built with the release
  toolchain.
- Its controllers are **SNS root only**. It is registered with the SNS by
  `RegisterDappCanisters` and upgraded only by proposal.
- It has **no admins**. No principal other than governance (and itself, §3.6) can change
  anything.
- It holds no tokens, only cycles. It is added to ic-unicycle monitoring like every DAO
  canister.

### 3.1 Payload

```candid
type ProxyCall = record {
  canister : principal;        // target
  method : text;               // target method
  arg : blob;                  // Candid-encoded argument tuple, exactly as the target expects
  note : opt text;             // ≤ 500 chars, shown in the validator text and logged
  expires_at : opt nat64;      // ns; refused at execution after this time (stale proposals)
};
```

`expires_at` lets a proposer say "this fee change only makes sense this month". Sneed Hub
proposes none by default; **Q1**.

### 3.2 Execute functions (one per topic)

Each method is a GNSF target. Each has its own validator, and each is assigned to the matching
topic.

| GNSF id | Name | Topic | Target / validator method | Class (§3.3) |
|---|---|---|---|---|
| 6000 | Sneed Hub: app setting | ApplicationBusinessLogic | `execute_business` / `validate_business` | `#business` |
| 6001 | Sneed Hub: dapp maintenance | DappCanisterManagement | `execute_dapp` / `validate_dapp` | `#dapp` |
| 6002 | Sneed Hub: community setting | DaoCommunitySettings (critical) | `execute_community` / `validate_community` | `#community` |
| 6003 | Sneed Hub: critical dapp operation | CriticalDappOperations (critical) | `execute_critical` / `validate_critical` | `#critical` |
| 6004 | Sneed Hub: treasury & fees | TreasuryAssetManagement (critical) | `execute_treasury` / `validate_treasury` | `#treasury` |
| 6010 | Sneed Hub: proxy allowlist | CriticalDappOperations (critical) | `set_allowlist` / `validate_set_allowlist` | — |

Notes on the table:
- 6002 is reserved but may stay unregistered at first. No inventoried action needs it, and a
  critical topic should not be used for convenience.
- There is no `Governance`-topic function. That topic is for motions.

All five execute methods share one implementation, `execute(class, call)`:

1. `caller == governance`, else trap. Also refused at ingress, §3.7.
2. `expires_at`, if set, is not in the past.
3. `(canister, method)` is in the allowlist, enabled, and its class equals the method's class.
   A call arriving through the wrong GNSF is refused **here and in the validator**. The
   allowlist may have changed between submission and execution, so the check runs again.
4. `arg.size() <= entry.max_arg_bytes`.
5. Forward: `await (with timeout = 300) IC.call(canister, method, arg)`.
6. Classify the reply (§3.5), append the ICRC-3 block, and return or reject (§3.5).

### 3.3 Allowlist

```candid
type Class = variant { business; dapp; community; critical; treasury };
type Reply = variant { any; result };          // how to read the target's reply, §3.5
type Entry = record {
  canister : principal;
  method : text;
  class : Class;
  label : text;                 // "Set Sneedex marketplace fee rate"
  max_arg_bytes : nat;          // ≤ 65_536; default 4_096
  reply : Reply;
  enabled : bool;
};
type CanisterName = record { canister : principal; name : text };   // "Sneedex"
type AllowlistUpdate = record {
  upsert : vec Entry;
  remove : vec record { principal; text };
  names : vec CanisterName;      // upsert canister display names
  remove_names : vec principal;
};
```

- **Stable storage.** The allowlist is a `Map<(Principal, Text), Entry>` plus a
  `Map<Principal, Text>` of canister names.
- **Changes only through `set_allowlist` (GNSF 6010, critical).** That includes moving an
  entry to a different class and disabling an entry.
- **Validator text.** `validate_set_allowlist` returns the complete diff as text: every added,
  changed (old → new class, label, cap) and removed entry, and every renamed canister.
- **Hard refusals.** These hold in both the validator and `set_allowlist`, whatever the
  proposal says:
  - The target is SNS governance, root, ledger, index, swap or archive. These are read from
    root's `list_sns_canisters` at install and refreshed daily by a timer.
  - The target is the management canister `aaaaa-aa`.
  - The target is the proxy itself, except the built-in self entries of §3.6.
  - `max_arg_bytes` is above 65,536.
- **Empty at install.** The first critical proposal fills it (§9). An init-arg allowlist would
  be harder for voters to see than a proposal.

### 3.4 Validators

Validators are `query` methods. Governance calls them inter-canister, and they are refused at
ingress as updates (§3.7). Each one runs the same checks as `execute`: class match, enabled,
size cap, expiry, and target name known. It returns `#Err` with a reason on any failure, so a
misrouted proposal cannot even be submitted.

Example `Ok` text (plain text, one fact per line, stable format so Sneed Hub can parse it):

```
Sneed proxy · Application Business Logic (GNSF 6000)
Action: Set Sneedex marketplace fee rate
Target: Sneedex (7bvk3-ryaaa-aaaal-qtykq-cai)
Method: setMarketplaceFeeRate
Argument: 14 bytes, SHA-256 9f2c…e01a
Argument (hex): 4449444c00017d90 03
Expires: never
Note: Lower the cut while volume is low (forum thread 1234).
Read the argument decoded: https://app.sneeddao.com/proxy/verify?c=7bvk3…&m=setMarketplaceFeeRate&a=<hex>
```

- **Why no decoded values.** Motoko cannot decode an arbitrary Candid blob into readable values
  without the target's types.
- **What the validator gives instead.** The label, the target's name and id, the method, the
  size, the SHA-256 and, for arguments of at most 512 bytes (all prices and limits), the hex. With
  the hex, anyone can check the payload with `didc decode` and the target's `.did`, or in Sneed
  Hub. Larger arguments get the hash only.
- **The verify link** is a convenience. The hex and the hash are the authority.

### 3.5 Execution, replies and failures

**Replies.** Many Sneed admin methods report refusal as a reply (`#err`, `#Err`, `#err(#NotAuthorized)`)
rather than a trap. Governance would mark such a proposal "executed" although nothing changed.
The entry's `reply` field handles this:

- `#any`: any reply is success. This is for methods that return `()` or trap on refusal.
- `#result`: the proxy reads the top level of the reply.
  - If the reply is a single value of a variant type, the proxy checks its tag:
    - a tag hash of `ok` or `Ok` means success;
    - a tag hash of `err` or `Err` means failure;
    - any other shape counts as success, and the reply bytes are kept.
  - If the `err` payload is `text`, it becomes the failure message. Otherwise the message is
    `"target replied err (n bytes)"`.
  - This needs a small Candid reader: magic, type table, the first value's type index, variant
    tag. That is about 150 lines, with unit tests over the reply shapes the inventoried methods
    actually use. It does not need a general decoder.

**Outcomes:**

| Case | Logged `outcome` | Governance sees | State |
|---|---|---|---|
| Reply, success | `ok` | reply `"ok: <label> · reply <n> bytes, SHA-256 …"` | executed |
| Reply `#err` (with `#result`) | `err` | **reject** with the error text | failed |
| Target trapped or rejected | `err` | reject with `"target rejected (<code>): <message>"` | failed |
| Timeout / `#system_unknown` | `unknown` | reject with `"outcome unknown after 300 s: check <canister> state before re-proposing"` | failed (but may have happened) |
| Pre-check refused (class, expiry, allowlist) | not logged (§3.8) | trap with the reason | failed |

**Reject, not trap.** After the forward, failures are reported with `throw Error.reject(msg)`,
not a trap.
- A `throw` after an `await` commits the state changes made in that message segment, so the
  ICRC-3 block survives.
- The call is still rejected, so governance marks the proposal failed and stores the message.
- A trap would roll the block back.

**A target that traps** changes nothing in the target, since its own message rolls back. The
proxy's state from before the call is already committed, and the proxy has none worth keeping
except a counter.

**Idempotency.**
- Governance executes an adopted proposal exactly once and never retries, so the proxy needs no
  dedupe of its own.
- Two different proposals with the same payload are two decisions. Both run, and that is
  intended.
- The proxy cannot see the proposal id (§1.3). The log therefore records the payload's SHA-256
  (`payload_hash`, over the full `ProxyCall` bytes), the GNSF id and the time.
- Sneed Hub joins a log entry to its proposal by matching `payload_hash` and `function_id`
  against governance's `list_proposals`. Proposals carry the payload, so the hash can be
  computed.
- An optional later timer job could do the same lookup on-chain and append a
  `sneedproxy_linked` block. It is not needed for v1.

**Reentrancy and concurrency.**
- Governance may execute several adopted proposals concurrently, so several `execute` calls can
  be in flight at once.
- `execute` takes no lock and reads no state after its `await` other than the log append.
- Two in-flight calls may hit the same target method. The target then applies them in the order
  it receives them, as with two admins clicking.
- An allowlist change while a call is in flight does not affect that call: the check ran before
  the forward.
- One cap: at most 20 forwards in flight (a transient counter, decremented in `finally`). A 21st
  is rejected with "busy, re-propose". This should never trigger. It bounds the cycles a burst
  of adopted proposals can cost.

**Cycles.** Forwards attach no cycles.

**Timeout.** 300 s, the maximum. Admin methods that do real work, such as sneed_lock pool
operations or sneedex expiry runs, can take tens of seconds.

### 3.6 Self entries (built in, not removable)

A few of the proxy's own settings are changed through the same execute path, as a call to
itself. The caller is then the proxy, and these methods check `caller == self`. They are fixed
in code, not stored in the allowlist, and are shown by `get_allowlist` with `builtin = true`.

| Method | Class | Does |
|---|---|---|
| `self_set_icrc3_settings` | `#dapp` | ICRC-3 log settings (`Log.applySettings`) |
| `self_icrc3_spill_now` | `#dapp` | force a spill |
| `self_icrc3_repair_archive_controllers` | `#dapp` | as in every Sneed log |
| `self_set_max_in_flight` | `#dapp` | the concurrency cap of §3.5, 1–100 |

`set_allowlist` deliberately is **not** a self entry. It has its own critical GNSF, so it cannot
be reached through a misclassified entry.

### 3.7 Ingress guard

`system func inspect` follows `src/IngressGuard.mo`. Every public method is in the `msg`
variant.
- **Refused at ingress, always:**
  - `execute_*` and `set_allowlist`, which are called only by governance and therefore always
    inter-canister;
  - the `self_*` methods;
  - every query when it arrives as an update, including all `validate_*` methods.
- **No ingress updates at all.** The proxy has no ingress update method, so every ingress
  update is refused. The guard is the simplest in the repo.
- **The methods check their callers again.** `inspect` runs on one replica, so the methods
  re-check (`caller == governance`, `caller == self`).
- **No timers that pay anyone, no ICRC-85.** The only timers are the ICRC-3 spill check and the
  daily refresh of the SNS canister list.

### 3.8 ICRC-3 log

The proxy uses the shared library `src/icrc3` (Log.mo, Archive.mo, optionally SnsRegister.mo), as
`sneed_pid_names`, `sneed_profiles` and the forum do.
- **Archives** are controlled by the proxy plus SNS root (`archive_controllers = [sns_root]`).
  They are registered with the SNS by proposal (SnsRegister.mo with a hotkeyed neuron, **Q8**).
- **Prefix:** `sneedproxy_`.
- **Catalogue URL:** `https://app.sneeddao.com/api/sneed_proxy#block-types`.

| btype | appended by | tx fields |
|---|---|---|
| `sneedproxy_forwarded` | `execute_*` after the forward | `caller` (governance), `function_id`, `class`, `target`, `method`, `label`, `arg_size`, `arg_hash`, `payload_hash`, `note`?, `outcome` (`ok`/`err`/`unknown`), `error`?, `reply_size`?, `reply_hash`?, `reply`? (bytes, only when ≤ 1 KiB, so Sneed Hub can decode it) |
| `sneedproxy_allowlist_set` | `set_allowlist` | one block per entry: `target`, `method`, `class`, `label`, `max_arg_bytes`, `reply`, `enabled`, `old_class`? |
| `sneedproxy_allowlist_removed` | `set_allowlist` | `target`, `method`, `old_class` |
| `sneedproxy_canister_named` | `set_allowlist` | `target`, `name` (empty = removed) |
| `sneedproxy_config` | `self_*` setters | `key`, `old`, `new` |

- **What is logged.** Following the house rule "log what happened, not what failed", a refused
  pre-check (wrong class, expired, not allowlisted) is not logged. Governance already records it
  as the proposal's failure reason.
- **What is logged anyway.** A forward that reached the target and failed **is** logged. It
  happened, and it cost a proposal.
- **Text log.** The proxy also keeps the usual text log (`get_log`, public, since there is
  nothing private here) for spill and archive messages.

### 3.9 Queries

All are public:
- `get_allowlist`, `get_canister_names`;
- `get_config`: governance, root, the SNS canister set, the in-flight cap and the GNSF ids it
  expects;
- `get_stats`: forwarded, ok, err and unknown counts per class;
- `get_recent(n)`: the last n forwarded blocks, decoded for convenience;
- the standard `icrc3_*` and `icrc10_*` queries;
- `get_api_doc`, in the API-doc pattern of sneed_mon and mr_sneed. Public doc:
  `public/api-docs/sneed_proxy.md`.

### 3.10 What the proxy needs from each target

On each target canister, the proxy must be added as an admin by that canister's existing
add-admin method.
- **Already accept governance:** sneed_lock, rll, the forum, SMS and sneed_pad. Governance
  could call them directly, but it is the proxy that calls, so the proxy still needs to be an
  admin.
- **sneedapp** checks only its own `admins` list and ignores controllers. Add the proxy with
  `addAdmin`. `setSneedGovernance` does not help, since the caller is the proxy.
- **sneed_notifications** re-adds a bootstrap admin on every upgrade. That is unrelated, but it
  matters when human admins are retired (§9.4).
- **mr_sneed and the guardian** are not proxy targets (§6.3, §6.4).

The proxy's own first admin grants are critical proposals (`#critical` class, "add proxy as
admin").
- Until the proxy is in the allowlist of a canister's add-admin method, a human admin adds it
  directly, and the act is logged in that canister's ICRC-3 log where the canister has one.
- An "add proxy as admin" proposal through the proxy cannot work before the proxy is an admin.

## 4. Sneed Hub

### 4.1 Registry: `src/app_sneeddao_frontend/src/governance/registry.js`

The registry is one table that describes every proposable action. Admin pages, in-place buttons
and the proposal view all read it.

```js
// key: `${canisterKey}.${method}`
export const ACTIONS = {
  'sneedex.setMarketplaceFeeRate': {
    canister: 'sneedex',                 // → declarations/sneedex (idlFactory, canisterId per network)
    method: 'setMarketplaceFeeRate',
    route: 'proxy',                      // 'proxy' | 'direct' (own GNSF) | 'pylon' (icrc55_command)
    class: 'business',                   // must equal the proxy allowlist entry
    label: 'Set Sneedex marketplace fee rate',
    fields: { 0: { kind: 'bps' } },      // display hints: bps, e8s:<ledger>, ns, seconds, principal, account, bool
    read: (actor) => actor.getMarketplaceFeeRate(),   // current value, for "old → new" in summaries
    page: '/admin/sneedex#fees',
  },
  ...
};
export const CANISTERS = {
  sneedex: { name: 'Sneedex', idl: sneedexIdl, id: { ic: '7bvk3-…', staging: 'igm46-…' },
             isAdmin: (actor, p) => actor.getConfig().then(c => c.admins.some(a => a.toText() === p)) },
  ...
};
```

**Decoding.**
- `idlFactory({ IDL })` returns a `ServiceClass`. Its `_fields` holds `[method, FuncClass]`, and
  `FuncClass.argTypes` gives the argument types.
- `encode(key, args) = IDL.encode(argTypes, args)`.
- `decode(canisterId, method, bytes) = IDL.decode(argTypes, bytes)`.
- Hand-written IDLs work the same way: `utils/feedback.js`, `utils/donations.js`,
  `tokensafety/padIdl.js`, the pylon `icrc55_vector` IDL.
- `@dfinity/candid` is already a dependency. `IDL.decode` is not used anywhere yet.

**Rendering.** A generic Candid value renderer (`components/CandidValue.jsx`) uses the field
hints:
- e8s through `useDenomination().formatValue`, per the "denominate in anything" rule;
- principals through `PrincipalDisplay`, which shows names;
- bps as %;
- ns and seconds as durations;
- `opt` as "unchanged" or "cleared" where the method uses `??` for "keep".

**Verification.** On a proposal page (`Proposal.jsx`), a proxy proposal is recognised by its
function id (6000–6004), read from `list_nervous_system_functions` rather than hard-coded, as
`utils/mrSneed.js` `mrSneedFunctions` does. For such a proposal, the page:
1. decodes the `ProxyCall` payload with the proxy's IDL;
2. decodes `arg` with the target's IDL;
3. shows the values and, where `read` exists, the current value;
4. recomputes the SHA-256 and shows ✓ when it matches the validator's `Argument: … SHA-256`
   line, or ✗ and "do not trust the decoded values" when it does not.

If the registry does not know the method, the page shows the raw hex and the validator text
only.

**Verify route.** `/proxy/verify` (the link in the validator text) does steps 2–4 for a
`(canister, method, hex)` given in the URL, without a proposal.

**One table for both sides.** A test (`npm run check` plus a node script in CI) asserts that every
registry `proxy` entry has a matching allowlist entry with the same class on the deployed proxy.
It runs against staging, and against prod on request.

### 4.2 `useProposeAction` and `ProposeButton`

The new code goes in `src/app_sneeddao_frontend/src/governance/`.

```js
const p = useProposeAction('sneedex.setMarketplaceFeeRate');
// p.canApply      — the user is an admin of the target canister (registry isAdmin)
// p.neurons       — the user's Sneed neurons with permission 3, sorted by stake
// p.canPropose    — neurons.length > 0
// p.apply(args)   — direct call through the canister actor (admins)
// p.draft(args)   — { title, summary, payload, functionId, renderedValues }
// p.propose({ draft, neuronId, title, summary }) → proposal id
```

**Neurons.** `governance/neurons.js` generalises `utils/mrSneed.js` `proposerNeurons`:
- it calls `list_neurons({ of_principal: [me], limit: 100 })` on fi3zi;
- it keeps neurons where some permission names the caller with type 3;
- it drops neurons whose dissolve delay is below the minimum to vote, or whose stake is below
  the reject cost. The parameters are read once per session.

Each excluded neuron is listed with its reason ("dissolve delay 12 days, needs 30") so a user
knows what to fix.

**Proposal text.**
- **Title:** `"<Canister>: <label> → <new value>"`, for example
  `"Sneedex: set marketplace fee rate → 2.5%"`.
- **Summary (markdown):**
  - current → proposed values, for each field;
  - why (free text the proposer must fill in, at least 20 characters);
  - the route: GNSF id, topic, and whether it is critical, with the voting period that implies;
  - the payload SHA-256;
  - a link to the setting's page and to `/proxy/verify`;
  - "Submitted from Sneed Hub by <principal> with neuron <id>". The principal is public, per
    the "no false anonymity" rule.
- Both title and summary are editable before submitting.
- The `url` field is the page link.

**Submit.**

```js
gov.manage_neuron({ subaccount: neuronId, command: [{ MakeProposal: { title, url, summary,
  action: [{ ExecuteGenericNervousSystemFunction: { function_id, payload } }] } }] })
```

This is exactly what `utils/mrSneed.js` `proposeChange` does, generalised. The function id is
looked up by the proxy's target method name in `list_nervous_system_functions`, never
hard-coded. If the function is not registered yet, the button is disabled with the text
"proposals for this setting are not enabled yet".

**Before submitting.** The dialog calls the proxy validator itself (a query) and shows the text
it returns. A refusal is shown before the user pays anything.

**After submitting.** The dialog links to `/proposal?id=…`. The pending change appears beside
the setting as "Proposal #123 open: 2.5% (ends in 3 d)", read from `list_proposals`
filtered by function id and decoded payload. This avoids duplicate proposals.

**Components.**
- `ProposeButton`: the small in-place button ("Propose…" with a governance icon). It opens
  `ProposeDialog` with the form pre-filled from the current value.
- `ProposeDialog`: generalised from the existing Mr Sneed dialog. It holds the form fields, the
  neuron picker, the generated title and summary, the validator preview and the submit button.
- `ApplyOrPropose`: wraps an admin page's existing submit button. It shows "Apply" when
  `canApply`, "Propose" when `canPropose`, and both for an admin who also has a neuron. For
  everyone else it shows "Log in with a principal that can submit proposals for a SNEED neuron".

**Other routes.**
- **Direct GNSFs.** `route: 'direct'` entries work the same way, with the target canister's own
  validator. Examples: GNSF 5000 for Mr Sneed, and the 6050+ range (§6.3).
- **Splitters.** `route: 'pylon'` builds an `icrc55_command` payload for GNSF 3000 (pylon
  `6jvpj…`: ICP splitter node 6, SNEED splitter node 45) or GNSF 3002 (the buyback pylon
  `togwv…`). These are TreasuryAssetManagement and so critical. The pylon's own validator
  renders the text. The dialog's form edits the splitter's output shares and keeps everything
  else of the node as it is, from `icrc55_get_nodes`.

### 4.3 Admin pages open to everyone

**Gating.** `hooks/useAdminCheck.js` redirects non-admins today, and it only checks the
backend's admin list. It is replaced by `useAdminView()`, which returns
`{ isAdmin, canPropose, loading }` and never redirects.

- **`/admin` (the hub)** is public, with the subtitle "Everything here can be changed by Sneed
  DAO proposal; admins can still apply directly."
- **Admin-only data stays admin-only.** Each page hides it from non-admins with a short notice.
  The canister enforces this anyway:
  - payment, claim, creation and financial logs;
  - ban history;
  - promo codes and their claims;
  - feedback;
  - the full donation list;
  - the forum's admin views.
- **Per-canister admin checks.** Each form uses its canister's own admin check through the
  registry. Today the pages assume "backend admin" means "admin everywhere".
- **Partners.jsx and Projects.jsx** have no `useAdminCheck` today. They get the same treatment.
- **Forms with no proposable action** show the reason inline, for example "Withdrawals are not
  proposable: use a Treasury proposal from the DAO account" (§7).

### 4.4 In-place buttons: first places

| Where (file) | Setting | Action key(s) | Route |
|---|---|---|---|
| `/rll_ledger` (`pages/RllLedger.jsx`), `/revenue` (`pages/Revenue.jsx`) | ICP and SNEED splitter ratios | pylon node 6 / 45 | pylon, GNSF 3000 (critical) |
| `/sneedex` (`pages/Sneedex.jsx` fee line), `/sneedex_create` (`pages/SneedexCreate.jsx` ~198–295) | marketplace cut, offer creation fee, premium fee, premium auction cut | `sneedex.setMarketplaceFeeRate`, `setOfferCreationFee`, `setPremiumOfferCreationFee`, `setPremiumAuctionCutBps` | proxy 6000 |
| Lock dialogs (`LockModal.jsx:238`, `LockPositionModal.jsx:241`, `pages/LockWizard.jsx:221`), `HelpSneedlock.jsx` | lock fees, max lock length | `sneed_lock.admin_set_lock_fees_icp`, `set_max_lock_length_days` | proxy 6000 |
| `/premium` (`pages/Premium.jsx`) | ICP tiers, VP tiers, claim interval | `sneed_premium.addIcpTier`/`updateIcpTier`/`removeIcpTier`, VP likewise, `setMinClaimInterval` | proxy 6000 |
| `CreateIcpNeuron.jsx:250`, `CreateIcpNeuronWizard.jsx:97`, `SneedAppDetail.jsx` | mint fee, premium fee, creation cycles, DAO cut per app/publisher | `sneedapp.setCreationFee`, `setPremiumCreationFee`, `setCanisterCreationCycles`, `setAppDaoCut`, `setPublisherDaoCut` | proxy 6000 |
| `/notifications` (`pages/Notifications.jsx`, another agent is editing; add later) | channel prices, per-notify price | needs a narrow setter (§6.2) | proxy 6000 |
| `components/SneedMonitorSection.jsx` tier picker (~322–343), `HelpMonitor.jsx` | monitor tiers and prices, round interval | `sneed_mon.admin_set_tiers`, `admin_set_interval` | proxy 6000 |
| Forum composer limits (`hooks/useTextLimits.js` users: `ThreadViewer.jsx`, `Discussion.jsx`, `Topic.jsx`) | text limits | `sneed_sns_forum.update_text_limits` | proxy 6000 |
| `/sms` (`pages/SMS.jsx` ~233–250 "effective limits") | rate limit, max subject/body/recipients | `sneed_sms.update_config` | proxy 6000 |
| `/partners`, `/projects` | list entries | `app_sneeddao_backend.add_partner`, … | proxy 6000 |
| `/rll` (stats) | min and max distribution per token | `rll.set_token_min_distribution`, `set_token_max_distribution` | proxy 6000 |
| `/mr_sneed` (exists) | personality; writers, limits, remove memory | GNSF 5000; new 5001–5003 direct | direct |

## 5. Inventory classes

| Class | Topic / GNSF | Meaning |
|---|---|---|
| **B** | ApplicationBusinessLogic, 6000 | prices, fees (amounts), limits, caps, intervals, texts, lists shown in the app, catalogue entries |
| **D** | DappCanisterManagement, 6001 | maintenance with no change of power or money: imports, cache resets, run-now, log settings |
| **C** | CriticalDappOperations, 6003 | who holds power or which canister is trusted: admin lists, authorised callers, canister-id wiring, governance id, relays, wasm and version choice, archive-registration neuron, whole-config setters that include any of these |
| **T** | TreasuryAssetManagement, 6004 | where money goes or money moving: fee destinations and recipients, payment accounts, withdrawals the DAO decides, cycle spend from the canister's ICP |
| **M** | not through the proxy (default) | moderation that needs speed and is about a person: bans, deletions, hiding, avatar removal, verification. Humans keep it as *moderators*; the DAO controls who the moderators are (C) and may reverse a moderation act by a B proposal where an undo exists |
| **X** | not proxied | user-fund repairs, destructive wipes, secrets, migrations, payloads too big for a proposal |

**Rule for mixed whole-config setters.** A method like `updateConfig` that sets prices and
admins together gets the highest class of any field it can change. The fix is a narrow setter,
listed in §6.2, so that a price change does not need a critical vote.

## 6. Inventory

The inventory is taken from each `main.mo` on 2026-10-21. "In place" refers to §4.4. Admin-only
queries are not listed.

**How each canister checks admin:**
- **backend:** deployer, controllers or `admins`.
- **sneed_lock:** controllers, governance (hard-coded) or `admin_list`.
- **sneedex:** controllers or `config.admins`.
- **sneedapp:** `admins` only. `isAdminOrGovernance` also accepts `sneedGovernance` on some
  methods.
- **premium:** controllers or `config.admins`.
- **rll:** controllers, governance or `admin_principals`.
- **forum and SMS:** governance, controllers or `admins`.
- **notifications, sneed_mon, naming, avatars, profiles:** controllers or `admins`.
- **sneed_pad:** controllers, governance or `admins`.

### 6.1 Table

**app_sneeddao_backend** (`g7s5u-…`)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| add_admin / remove_admin | admin list | C | | the deployer cannot be removed (retirement, §9.4) |
| add_authorized_for_caller / remove_authorized_for_caller | canisters allowed to call `*_for` | C | | |
| add_whitelisted_token / remove_whitelisted_token | token whitelist | B | | |
| import_whitelist_from_icpswap / _from_swaprunner | import list | D | | |
| refresh_token_metadata, start/stop_refresh_all_token_metadata, run_token_list_maintenance_now | metadata upkeep | D | | |
| update_nickname_limits | nickname caps | B | | |
| update_canister_groups_limits | canister-group caps | B | | |
| add/update/remove_partner, add/update/remove_project | public lists | B | /partners, /projects | logo URLs: the validator shows only the hash, so Sneed Hub's decode matters |
| set_jailbreak_fee_settings | fees **and** fee account | T | | split it: `set_jailbreak_fees` (B) and `set_jailbreak_fee_account` (T) |
| admin_set_donation_account | donation destination | T | | |
| admin_set_feedback_config | recipients, topics | B | | recipients read bug reports; **Q6** whether C |
| admin_set_names_canisters | trusted naming canisters | C | | |
| set_nickname_premium_canister | premium canister id | C | | |
| admin_set_names_frozen | freeze all name writes | M | | emergency; humans keep it; a B proposal may unfreeze |
| add_blacklisted_word / remove_blacklisted_word | word blacklist | M | | putting slurs into public proposals is self-defeating; moderators keep it |
| ban_user / unban_user | bans | M | | unban also B (DAO may reverse) |
| verify/unverify_neuron_name, verify/unverify_principal_name | checkmarks | M | | SNS governance path exists for neuron names |
| admin_clear_avatar, admin_set_donation_hidden | moderation | M | | |
| send_tokens, transfer_position | move tokens or LP held for users | X | | user-fund repairs; stay admin; the DAO may later add T entries case by case |

**sneed_lock** (`pqsms-…`, already accepts governance)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| admin_add_admin / admin_remove_admin | admin list | C | | |
| admin_set_lock_fees_icp | 4 ICP fees | B | lock dialogs | `reply: #result` |
| set_max_lock_length_days | max lock length | B | lock wizard | |
| admin_set_icp_fee_recipient | fee account | T | | |
| admin_set_sneed_premium_canister_id | premium id | C | | |
| admin_set_icrc3_proposal_neuron | neuron the canister proposes with | C | | |
| admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_register_archives_now, admin_icrc3_reset_archive_registration, admin_icrc3_repair_archive_controllers, admin_icrc3_import_history | log upkeep | D | | |
| admin_clear_completed_claim_requests / admin_clear_failed_claim_requests | history wipes | D | | |
| admin_get_pool_unused_balance | read via update | D | | harmless |
| admin_return_token, admin_return_token_from_failed_request, admin_rescue_stuck_tokens, admin_pool_deposit, admin_withdraw_pool_balance_to_user | user-fund repairs | X | | stay admin (speed, case work); later T if admins are retired, **Q5** |

**sneedex** (`7bvk3-…`, no governance today)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| addAdmin / removeAdmin | admin list | C | | |
| updateConfig | whole config incl. admins | C | | prefer narrow setters |
| setMarketplaceFeeRate, setOfferCreationFee, setPremiumOfferCreationFee, setPremiumAuctionCutBps | fees | B | /sneedex, /sneedex_create | **pilot** (§9); `reply: #result` |
| setMinIncrementSettings, setExpirationCheckInterval, setNeuronInfoCacheStaleness | limits, intervals | B | | |
| addAssetType, deactivateAssetType / reactivateAssetType | asset catalogue | B | | deactivate also usable in an emergency by admins |
| setFeeRecipient, setLedgerFeeRecipient, removeLedgerFeeRecipient | fee destinations | T | | |
| setSneedPremiumCanisterId, setBackendCanisterId, setNeuronManagerFactoryCanisterId, setSneedLockCanisterId, setSneedSmsCanisterId | wiring | C | | |
| startExpirationTimer / stopExpirationTimer, triggerExpirationCheck, clearNeuronInfoCache(For) | upkeep | D | | stop is also an admin emergency switch |
| admin_set_icrc3_settings, admin_icrc3_* (5) | log upkeep | D | | admin_set_icrc3_proposal_neuron: C |
| adminReturnMisplacedNft, adminReturnMisplacedExtNft, adminReclaimStuckTokens | user-asset repairs | X | | stay admin |

**sneedapp** (`sfamc-…`; `isAdmin` ignores controllers)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| addAdmin / removeAdmin, setSneedGovernance | admin list, governance id | C | | the proxy must be added via `addAdmin` |
| addAuthorizedForCaller / removeAuthorizedForCaller | `*For` callers | C | | |
| setCreationFee, setPremiumCreationFee, setPaymentRequired, setTargetCycles, setCanisterCreationCycles | prices, cycles per mint | B | create-neuron pages | |
| setPublisherDaoCut, setAppDaoCut | DAO cut | B | SneedAppDetail | |
| setPaymentConfig | fee, cycles **and** destination | T | | narrow setters exist; use those for B |
| setFeeDestination | fee account | T | | |
| setSneedPremiumCanisterId | premium id | C | | |
| setCurrentVersion, add/update/removeOfficialVersion, setOfficialVersions | which bot wasm users get | C | | bot upgrade path: keep intermediate versions published |
| setManagerWasm / clearManagerWasm | upload wasm | X | | too big for a proposal (§1.3); stays admin, and setCurrentVersion (C) decides what is offered |
| verifyPublisher / unverifyPublisher | checkmark | M | | |
| removeApp | delete an app | M | | |
| adminTopUpCycles | own ICP → own cycles | T | | |
| adminWithdrawIcp | ICP out | X | | the DAO decides spending through treasury proposals, not here (§7) |
| adminRegisterCanister, adminBulkRegisterCanisters | backfill | D | | |
| admin_set_icrc3_settings, admin_icrc3_* | log upkeep | D | | proposal neuron: C |

**sneed_premium** (`7gump-…`)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| addAdmin / removeAdmin | admin list | C | | |
| updateConfig | whole config incl. admins, recipient | C | | prefer narrow setters |
| add/update/removeIcpTier, add/update/removeVpTier | tiers and prices | B | /premium | |
| setMinClaimInterval | anti-spam | B | | |
| setPaymentRecipient | ICP destination | T | | |
| setIcpLedgerId, setSneedGovernanceId | wiring | C | | |
| setMembershipAdmin, extendMembershipAdmin | grant membership | B | | a grant has value; public by nature (**Q7**) |
| revokeMembership | remove membership | M | | |
| createPromoCode, de/re-activate, deletePromoCode | promo codes | X | | a code in a public proposal is no longer secret; stays admin (or a hashed-code redesign) |
| admin_set_icrc3_settings, admin_icrc3_* | log upkeep | D | | proposal neuron: C |

**rll** (`lvc4n-…`, already accepts governance)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| add_admin / remove_admin | admin list | C | | |
| set_token_min_distribution / remove_…, set_token_max_distribution / remove_… | payout bounds | B | /rll | |
| add_known_token / remove_known_token | tokens distributed | B | | |
| start_rll_main_loop, start_distribution_cycle, import_all_*, stop_*_import, check_*_balances, import_whitelisted_tokens_* | loop operation | D | | |
| stop_rll_main_loop, stop_distribution_cycle | pause | D | | admins keep them as emergency switches |
| resolve_claim_incident | re-credits balances if a claim did not land | T | | case work; admins first, T later |
| clear_imported_neurons / _owners / _props | cache resets | D | | |
| clear_balances, clear_all_balances_and_distributions, clear_*distribution*, clear_claim_events, clear_whitelisted_tokens, clear_known_tokens | destructive wipes | X | | never by casual proposal; a deliberate wipe is an upgrade |
| admin_set_icrc3_settings, admin_icrc3_* | log upkeep | D | | proposal neuron: C |

**sneed_sns_forum** (`mcigm-…`, already accepts governance)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| add_admin / remove_admin | admin list | C | | |
| create_forum, update_forum, create_topic, update_topic | structure | B | forum pages ("Propose a new topic") | |
| set_proposals_topic, remove_proposals_topic | proposal-thread mapping | B | | |
| update_text_limits | text limits | B | composer | |
| update_premium_config | premium id **and** limits | C | | split: limits B, id C |
| admin_set_notifications | notifications canister | C | | |
| delete_forum/topic/thread/post, update_thread/post (as admin) | moderation | M | | |
| undelete_* | restore | M + B | | the DAO may reverse a deletion |
| admin_set_icrc3_settings, admin_icrc3_* | log upkeep | D | | |

**sneed_sms** (`zelpl-…`, already accepts governance)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| add_admin / remove_admin | admin list | C | | |
| update_config | rate limit, max sizes | B | /sms | |
| update_premium_config | premium id **and** limits | C | | split as for the forum |
| add_authorized_sender / remove_authorized_sender | who may send system messages | C | | |
| set_system_sender_principal | shown sender | C | | |
| admin_set_notifications | notifications canister | C | | |
| import_admins, import_messages | migration (controller only) | X | | |

**sneed_notifications** (`vuy7a-…`; bootstrap admin re-added on upgrade)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| admin_add_admin / admin_remove_admin | admin list | C | | no last-admin guard |
| admin_set_config | whole config incl. prices, relays, ledger, caps | C | | relays receive message content: C is right for them. Add narrow setters for prices and caps (B) |
| admin_set_relay_key | relay encryption key | C | | |
| admin_register_app, update_app (as admin) | app registry | C | | |
| admin_set_app_verified | checkmark | M | | |
| admin_remove_app | delete an app | M | | |
| admin_set_fee_destination, admin_set_fee_sweep_threshold | fee routing | T | | |
| admin_forward_fees_now | forward to the set destination | D | | the destination is already chosen by T |

**sneed_mon** (staging `v53u4-…`, not on ic yet)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| admin_add_admin / admin_remove_admin | admin list | C | | |
| admin_set_tiers | price table | B | tier picker | |
| admin_set_interval | round interval | B | | |
| admin_set_tuning | defaults, pacing, caps, NNS governance id | C | | split: tuning B, nns id C |
| admin_set_config | whole config incl. notifications id, paused | C | | narrow setters exist for most fields |
| admin_pause / admin_resume | stop rounds | D | | admins keep pause as an emergency switch |
| admin_run_now, admin_register_with_notifications, admin_update_notifications_app | upkeep | D | | |
| admin_set_notifications_canister, admin_set_app_id | wiring | C | | |
| admin_set_fee_destination, admin_set_fee_sweep_threshold, admin_set_billing | fee routing, ledger | T | | |
| admin_withdraw_fees | send fees out | T | | earned fees only, never user balances |

**sneed_pid_names, sneed_neuron_names** (`ejz7n-…`, `e46oa-…`)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| admin_add_admin / admin_remove_admin | admin list | C | | |
| admin_set_config | caps, moderator, dao_governance, sns_wasm, archive controllers | C | | add a narrow `set_limits` (B) |
| verify / unverify, admin_set_name, admin_clear_avatar | moderation | M | | the DAO path already exists: `verify_by_dao` / `unverify_by_dao` with validators (§6.3) |
| admin_import_names, admin_finish_import | one-time import | X | | prod `finish_import` is still open; a human task |
| admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers | log upkeep | D | | |

**sneed_pid_nicknames, sneed_neuron_nicknames** (`e37iu-…`, `es4di-…`)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| admin_add_admin / admin_remove_admin | admin list | C | | |
| admin_set_config | max_free, max_premium, moderator, premium | C | | narrow setter for caps (B) |
| admin_import_nicknames, admin_finish_import | import | X | | |

**sneed_avatars** (`ev5f4-…`)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| admin_add_admin / admin_remove_admin | admin list | C | | |
| admin_set_config | caps, premium id | C | | narrow setter for caps (B) |
| admin_remove | delete an image and block its hash | M | | abuse removal must be fast |
| admin_upload_for | migration upload | X | | |

**sneed_profiles** (`fytbs-…`)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| admin_add_admin / admin_remove_admin | admin list | C | | |
| admin_set_config | max canisters, moderator, dao_governance, … | C | | narrow setter for caps (B) |
| verify_dapp, admin_hide_dapp | moderation | M | | `verify_dapp_by_dao` exists with a validator (§6.3) |
| admin_set_icrc3_settings, admin_icrc3_* | log upkeep | D | | |

**sneed_pad** (staging `symdn-…`, already accepts governance)

| Method | What it does | Class | In place | Notes |
|---|---|---|---|---|
| admin_add_admin / admin_remove_admin | admin list | C | | |
| admin_set_config | fees, follow_nns, guardians, cycles, fee_destination, paused | C | | split: fees B; guardians C; fee_destination and cycles T; paused admin emergency |
| admin_set_canisters | dependency ids incl. governance | C | | |
| admin_set_wasm_hashes | which ledger wasm the pad installs | C | | token safety depends on it |
| admin_fetch_wasms | fetch bytes for pinned hashes | D | | |
| admin_set_registration_neuron | proposal neuron | C | | |
| admin_set_canister_controllers | hand a pad canister to new controllers | C | | rescue tool; C, never B |
| admin_withdraw_icp | ICP out | X | | as for sneedapp (§7) |

### 6.2 Narrow setters to add (canister follow-ups)

These make price and limit changes B instead of C or T. Each needs its own release: an upgrade
proposal per canister, as usual.

- **backend:** `set_jailbreak_fees` (B) and `set_jailbreak_fee_account` (T).
- **premium:** none needed (tiers already have their own setters). Do not proxy `updateConfig`.
- **forum, SMS:** `update_premium_limits` (B), split from the premium canister id (C).
- **notifications:** `admin_set_prices` (`prices_e8s`, `notify_price_e8s`) and `admin_set_caps`
  (daily caps, max title/body, retention) as B. Relays, ledger and SMS stay in the C config.
  `pages/Notifications.jsx` is another agent's current work, so this comes after that lands.
- **sneed_mon:** split the NNS governance id out of `admin_set_tuning`.
- **naming, nicknames, avatars, profiles:** `admin_set_limits` (B).
- **sneed_pad:** `admin_set_fees` (B), `admin_set_fee_destination` (T),
  `admin_set_paused` (admin plus D).

### 6.3 Direct GNSFs, no proxy

These canisters already check `caller == governance` and have validators. A direct GNSF is
simpler than the proxy for them, and the proxy could not call them anyway, since the caller
would be the proxy.

| Proposed id | Canister → method | Validator | Topic |
|---|---|---|---|
| 5001 | mr_sneed `set_writers` | `validate_set_writers` | CriticalDappOperations (who may write the DAO's memory) |
| 5002 | mr_sneed `set_limits` | `validate_set_limits` | ApplicationBusinessLogic |
| 5003 | mr_sneed `remove_memory` | `validate_remove_memory` | ApplicationBusinessLogic |
| 6050 | sneed_pid_names `verify_by_dao` | `validate_verify_by_dao` | ApplicationBusinessLogic |
| 6051 | sneed_pid_names `unverify_by_dao` | `validate_unverify_by_dao` | ApplicationBusinessLogic |
| 6052 | sneed_neuron_names `verify_by_dao` | `validate_verify_by_dao` | ApplicationBusinessLogic |
| 6053 | sneed_neuron_names `unverify_by_dao` | `validate_unverify_by_dao` | ApplicationBusinessLogic |
| 6054 | sneed_profiles `verify_dapp_by_dao` | `validate_verify_dapp_by_dao` | ApplicationBusinessLogic |

**Q9:** whether the mr_sneed ones should stay in his 5000 range.

### 6.4 Out of scope

- **sneed_guardian, sneed_guardian_blackhole, sneed_guardian_multidao.** Custody canisters have
  their own staged-op and approval flow. The DAO approves ops through `approve_op` and its
  approve function id (`pages/Guardian.jsx` already files those proposals). Adding a generic
  admin to a custody canister would contradict its blessed-hash design.
- **The bots.** They are user-owned instances, not DAO canisters.
- **The SNS's own canisters.** Native proposals already cover them.

## 7. Actions that do not go through the proxy, and why

1. **Raw fund transfers out of canisters:** sneedapp `adminWithdrawIcp`, sneed_pad
   `admin_withdraw_icp`.
   - Product revenue already flows straight to the splitters or a fee destination (T).
   - Money the DAO decides to spend should leave from the treasury by native "Transfer SNS
     treasury funds" proposals, so that there is one place to watch.
   - Recommendation: after the fee destinations point at DAO accounts, these methods lose their
     purpose. Retire them, or keep them for admins as stuck-fund repair.
2. **User-fund and user-asset repairs:**
   - sneed_lock returns, rescue and pool operations;
   - sneedex NFT returns and reclaims;
   - backend `send_tokens` and `transfer_position`;
   - rll `resolve_claim_incident`.
   These are case work that needs investigation and speed, and the funds go back to their owner.
   They stay with admins and are logged in each canister's ICRC-3 log. Once admins are retired
   (§9.4), the ones a canister still needs become T entries. **Q5.**
3. **Moderation (class M):** bans, deletions, avatar and image removal, hiding, checkmarks, word
   blacklist, app removal.
   - It needs minutes, not days.
   - A public proposal that names a person and their offence for four days does more harm than
     the act itself.
   - Recommendation: a **moderator** role per canister, held by humans. The DAO appoints and
     removes moderators by C proposal and may reverse acts by B proposal (unban, undelete,
     unfreeze).
   - Today "admin" means both moderator and configurator. Splitting the role is a per-canister
     change, done when that canister's admins are retired.
4. **Emergency switches:** stop main loop, stop expiration timer, pause, names freeze.
   - Admins and moderators keep the stop. A DAO proposal can also stop.
   - The **resume** is proxied (D) and is also admin.
   - Recommendation: in the long run, humans may only stop, and only the DAO may resume.
     That cannot make anything worse than a stop.
5. **Secrets:** promo codes. A public proposal would publish the code.
6. **Payloads above the governance cap:** wasm uploads (`setManagerWasm`). Which wasm is offered
   is C (`setCurrentVersion`, official versions). Uploading bytes stays a team task, verified
   by hash.
7. **Destructive wipes and migrations:** rll `clear_*` balances and distributions,
   `import_*`/`finish_import`, `admin_upload_for`, SMS imports. Those are one-offs. If needed,
   they belong in an upgrade proposal with a migration.

## 8. Tests (`test/canisters/tests/sneed-proxy.test.js`)

PocketIC through pic-js, as in the rest of the suite (`npm run build && npm test`).

- **Mock SNS governance** (`test/canisters/mocks/sns_governance_mock.mo`). It holds a list of
  GNSFs.
  - `submit(function_id, payload)` calls the validator and stores the `Ok` text or refuses.
  - `adopt(id)` calls the target with the payload and records executed or failed with the
    reject message, as real governance does (§1.3).
  - It exposes `list_sns_canisters` as root would.
- **Mock target canister.** It has methods that return `()`, return `#ok`, return `#err("…")`,
  return `#err(#NotAuthorized)`, trap, sleep past the timeout (a self-call loop), and check that
  the caller is an admin.
- **Cases:**
  - Only governance can call `execute_*` and `set_allowlist`. All are refused at ingress
    (`refusedAtIngress`), and validators are refused as updates.
  - A call through the wrong class is refused in the validator and at execution. Also: the
    allowlist changes between submit and adopt.
  - Disabled entries, entries over the size cap and expired proposals are refused.
  - `#result` replies: `ok` gives executed; `err` with text gives failed, with that text;
    `err` with a variant gives failed with "(n bytes)". A trap gives failed. A timeout gives
    `unknown`, with the block appended and the state committed.
  - The hard refusals of §3.3 (governance, root, ledger, management canister, self).
  - Self entries work only through `#dapp`.
  - The in-flight cap.
  - ICRC-3: block shapes, `icrc3_supported_block_types` matching the catalogue, certification,
    spill to an archive whose controllers are proxy plus root.
  - Upgrade with state kept (EOP), and the allowlist surviving.
- **Pilot integration.** The real sneedex wasm with the proxy as admin, `setMarketplaceFeeRate`
  end to end through the mock governance.
- **Rehearsal.** A local PocketIC run with the **real** SNS governance wasm
  (dfx 0.28 `--pocketic`, per the local rehearsal recipe). It registers GNSFs 6000/6003/6010
  and checks:
  - the 70,000-byte payload cap;
  - how the validator text appears;
  - that a `throw` reject marks the proposal failed with the message.

## 9. Rollout

1. **Spec review** (this document). Answer the open questions.
2. **Build the proxy and its tests** (§8). Write the API doc and add it to `/architecture`.
3. **Build the frontend** behind a flag:
   - the registry, `useProposeAction`, `ProposeDialog` and `CandidValue`;
   - `/proxy/verify`;
   - decoding in `Proposal.jsx`.
4. **Staging.**
   - Deploy the proxy on staging.
   - Staging has no SNS, so the staging proxy is installed with a test "governance" principal: a
     team identity or the mock governance canister.
   - Add it as admin on staging sneedex and run the pilot end to end from Sneed Hub staging.
     This exercises the browser flow without real votes.
5. **Mainnet: the proxy as a dapp.**
   - Create the canister and install the wasm with `governance = fi3zi…`, `root = fp274…`.
   - Set root as the sole controller.
   - Submit `RegisterDappCanisters` (DappCanisterManagement, normal).
6. **Proposals to register the functions.**
   - `AddGenericNervousSystemFunction` for 6000 (ApplicationBusinessLogic) and 6010
     (CriticalDappOperations).
   - 6001/6003/6004 follow as the pages need them.
   - Each AddGNSF is itself critical (topic CriticalDappOperations), so 5–10 days each. Submit
     them in parallel.
7. **Pilot: the Sneedex fees.**
   - A Sneedex admin adds the proxy as an admin (direct call, logged).
   - A critical `set_allowlist` proposal adds the four Sneedex fee setters as `#business`, with
     `reply: #result`.
   - Then the first B proposal from `/sneedex`. It runs normally: 4 days, majority vote.
   - Post in forum News (topic 899) at each step.
8. **Page by page.** Each page follows the same pattern:
   - add the proxy as admin on its canister;
   - one critical allowlist proposal for that page's entries, batched per canister;
   - switch the page to `ApplyOrPropose`.

   Order:
   1. Sneed Lock fees;
   2. Premium tiers;
   3. Sneedapp prices;
   4. forum and SMS limits;
   5. rll distribution bounds;
   6. partners and projects;
   7. sneed_mon tiers (after its mainnet deploy);
   8. notifications prices (after the narrow setters, §6.2);
   9. the C and T entries (admin lists, wiring, fee destinations) last, once the B flow has been
      seen working.

   The splitter button (pylon route) needs no proxy and can ship with step 3.

### 9.4 Retiring human admins

Admins are retired per canister, one canister at a time, when all three of these hold:

- all of the canister's B, D, C and T actions are proposable and have been used at least once;
- the M actions have moved to a moderator role, or the canister has none;
- the X actions are retired or covered.

Then:
1. A C proposal through the proxy removes the human admins on that canister. The proxy stays,
   and governance stays where it is hard-coded.
2. Remove leftovers where they exist:
   - the backend's undeletable deployer, which needs an upgrade;
   - the notifications bootstrap admin, which needs an upgrade;
   - sneedapp's "at least one admin" rule, which is then held by the proxy.

Suggested order: from low-risk config canisters (sneedex, premium) to the backend last. The
backend's admin list also gates the hub's old `useAdminCheck`, which no longer gates anything
after §4.3.

This is in line with the existing sneed_lock plan (hard-coded admin removed; GNSFs by proposal
instead of `admin_list`; eventually blackhole). For sneed_lock the proxy entries replace the
"GNSFs per method" step.

### 9.5 Admin prices (planned)

The planned "admin price", shown next to the regular and premium prices, interacts with this as
follows:
- **The proxy is an admin but never a customer.** It only calls allowlisted config methods, so
  no admin-price purchase can be made through it. The canisters should still exclude it
  explicitly: an admin price should apply to *human* admins, so check membership in the admin
  list minus the proxy.
- **Admin prices are prices.** Setting them is a B entry, like the regular and premium prices,
  and the in-place button shows all three.
- **Retiring admins empties the admin price's audience.** If the intent is "the team pays
  less", that is a separate list, such as `team` or `contributors`, appointed by C proposal.
  It should not be tied to the admin role that is being retired. **Q4.**

## 10. Costs and limits

- **Proposals.** Each proposal costs the proposer 0.1 SNEED if rejected. Neurons need about a
  month of dissolve delay.
- **Speed.** A B change takes 4–5 days. A C or T change takes 5–10 days and needs 20% of total
  voting power to say yes. With Sneed's turnout this can fail for lack of votes, not for lack of
  support. That is why prices and limits must not be bundled with critical fields (§6.2).
- **Cycles.** The proxy's cycle cost is a few calls per proposal plus the log.

## 11. Open questions

**Decisions (2026-10-21), the suggested answers throughout:**
1. Sneed Hub sets `expires_at` 14 days out by default (`DEFAULT_EXPIRY_DAYS` in `governance/registry.js`).
2. Partners, projects, forum structure and texts stay B (normal, GNSF 6000); 6002 stays unregistered.
3. No stake minimum beyond what governance requires (the reject cost and the dissolve delay to vote).
4. (admin prices: handled by the separate special-prices work.)
5. User-fund repairs stay with admins for now.
6. `admin_set_feedback_config` is C (critical, GNSF 6003).
7. Membership grants (`setMembershipAdmin`, `extendMembershipAdmin`) are B.
8. The proxy's ICRC-3 archives are registered with the SNS manually, by proposal; no SnsRegister.mo.
9. (Mr Sneed's GNSFs: unchanged.)
10. (Moderators: later.)
11. Humans keep stop-only emergency switches, built later.
12. Pilot: Sneed Lock fees (`sneed_lock.admin_set_lock_fees_icp`, `reply = #result`). The RLL
    splitter ratios go through the existing GNSF 3000 (pylon `icrc55_command`) and need no proxy.

**Built differently from the text above:**
- `payload_hash` (§3.5) is not the SHA-256 of the payload bytes, which the proxy cannot see (it
  receives the decoded record, and re-encoding is not byte-identical across Candid encoders). It is
  the ICRC-3 representation-independent hash of the map `{ canister : Blob; method : Text;
  arg : Blob; note? : Text; expires_at? : Nat }`, which Sneed Hub computes from a decoded proposal
  payload (`payloadHash` in `governance/registry.js`).
- Reject messages after the forward end with ` · block <index>`, the ICRC-3 block of that call.
- A trapping target reaches the proxy as `canister_reject` (IC0503, the trap message) on the
  bounded-wait path, not `canister_error`; both read "target rejected (<code>): …".


1. **Stale proposals.** Should Sneed Hub set `expires_at` by default, for example 14 days after
   submission, so that a fee proposal adopted after someone else already changed the fee does
   not overwrite it? The alternative is an `expect` precondition: the proposal carries the
   current value, and the canister refuses if it changed. That needs per-method support.
2. **Proposal topic of community-type settings.** Partners, projects, forum structure and
   texts are planned as B (normal). Should any of them be DaoCommunitySettings (critical,
   GNSF 6002) instead?
3. **Proposer threshold.** Should Sneed Hub ask for a minimum stake beyond the reject cost
   before it offers "Propose", to limit proposal spam? Or rely on the 0.1 SNEED reject cost?
4. **Admin prices.** Should the admin price be tied to the admin role, or to a separate team
   list (§9.5)?
5. **User-fund repairs** (§7.2). Should they stay with admins indefinitely, or become T entries
   when the canister's admins are retired? Retiring them would mean waiting 5–10 days for a
   refund.
6. **Feedback recipients.** They read bug reports, which may include user details. Should
   `admin_set_feedback_config` be C rather than B?
7. **Membership grants.** Should `setMembershipAdmin` / `extendMembershipAdmin` be proposable
   at all (B)? Or should they be admin-only (giveaways), or dropped?
8. **Proxy archive registration.** Should the proxy's ICRC-3 archives be registered
   automatically through SnsRegister.mo, which needs a hotkeyed neuron with the proxy as hotkey?
   Or manually?
9. **Mr Sneed's remaining GNSFs.** Should they take 5001–5003, and should `set_writers` be
   critical?
10. **Moderators.** Should moderation (M) move to a separate moderator role per canister as
    proposed, with the DAO appointing moderators? Or should it stay with admins until a later
    phase?
11. **Emergency stops.** Should humans keep stop-only powers after retirement, with the DAO
    alone able to resume (§7.4)?
12. **Pilot.** Is Sneedex fees the right pilot, or would Sneed Lock fees be better? Sneed Lock
    already accepts governance, which makes it a smaller step.
