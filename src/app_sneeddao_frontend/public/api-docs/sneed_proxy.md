# Sneed proxy canister API

The Sneed proxy (`sneed_proxy`) carries Sneed DAO proposals into the DAO's canisters, so that every admin setting of Sneed Hub can be changed by SNS proposal and any member with a SNEED neuron can propose a change from Sneed Hub.

SNS governance calls one **execute method per proposal topic**, each registered as its own generic nervous system function (GNSF). The proxy checks the call against a stable **allowlist** of `(canister, method, class)` and forwards it, as an admin of the target, with a bounded-wait call. Every forwarded call is a block in the proxy's certified **ICRC-3 log**. The allowlist itself changes only by a critical proposal.

The proxy has **no admins**, is controlled by SNS root only, holds no tokens (only cycles), shares cycles with nobody (no ICRC-85) and accepts **no ingress update calls** at all.

| | |
|---|---|
| Production canister | not deployed yet |
| Staging canister | not deployed yet |
| Sneed SNS governance / root | `fi3zi-fyaaa-aaaaq-aachq-cai` / `fp274-iaaaa-aaaaq-aacha-cai` |
| Candid interface | [sneed_proxy.did](/api-docs/sneed_proxy.did) · [JavaScript IDL factory](/api-docs/sneed_proxy.did.js) |
| Source | [src/sneed_proxy/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_proxy/main.mo) · [Types.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_proxy/Types.mo) · [CandidReply.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_proxy/CandidReply.mo) |
| Design notes | [spec/sneed_proxy.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sneed_proxy.md) |
| This document | [rendered](/api/sneed_proxy) · [raw Markdown](/api-docs/sneed_proxy.md) |

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 Functions and classes

Each allowlist entry has a **class**, and the class decides which GNSF (and so which proposal topic, voting rules and voting period) can reach it:

| GNSF id | Name | Topic | Target / validator | Class |
|---|---|---|---|---|
| 6000 | Sneed Hub: app setting | ApplicationBusinessLogic | `execute_business` / `validate_business` | `business`: prices, fees, limits, texts, catalogue entries |
| 6001 | Sneed Hub: dapp maintenance | DappCanisterManagement | `execute_dapp` / `validate_dapp` | `dapp`: imports, cache resets, run-now, log settings |
| 6002 | Sneed Hub: community setting | DaoCommunitySettings (critical) | `execute_community` / `validate_community` | `community`: reserved |
| 6003 | Sneed Hub: critical dapp operation | CriticalDappOperations (critical) | `execute_critical` / `validate_critical` | `critical`: admin lists, wiring, versions |
| 6004 | Sneed Hub: treasury & fees | TreasuryAssetManagement (critical) | `execute_treasury` / `validate_treasury` | `treasury`: fee destinations, money moving |
| 6010 | Sneed Hub: proxy allowlist | CriticalDappOperations (critical) | `set_allowlist` / `validate_set_allowlist` | the allowlist itself |

A call that arrives through the wrong function is refused, both by the validator (so the proposal cannot even be made) and again at execution. `get_config().functions` lists the table; Sneed Hub finds the registered ids with governance's `list_nervous_system_functions`, by target method name.

### 1.2 The payload

```candid
type ProxyCall = record {
  canister : principal;   // target
  method : text;          // target method
  arg : blob;             // Candid-encoded argument tuple, exactly as the target expects
  note : opt text;        // at most 500 characters, shown in the validator text and logged
  expires_at : opt nat64; // nanoseconds; refused after this time (stale proposals)
};
```

Sneed Hub sets `expires_at` to 14 days after submission by default, so a proposal adopted long after the setting changed by other means does not overwrite it.

### 1.3 Allowlist entries

```candid
type Class = variant { business; dapp; community; critical; treasury };
type ReplyMode = variant { any; result };
type Entry = record {
  canister : principal; method : text; class : Class; label : text;
  max_arg_bytes : nat;  // 1 to 65,536
  reply : ReplyMode;    // how to read the target's reply (§3)
  enabled : bool;
};
type AllowlistUpdate = record {
  upsert : vec Entry;
  remove : vec record { principal; text };
  names : vec record { canister : principal; name : text };  // display names, 1-64 characters
  remove_names : vec principal;
};
```

Every target must have a display name. Some targets are refused whatever a proposal says (in the validator and in `set_allowlist`, and again when a call is executed):

- the SNS's own canisters: governance, root, ledger, index, swap and archives (read from root's `list_sns_canisters` when the proxy starts and once a day);
- the management canister `aaaaa-aa`;
- the proxy itself, except its four built-in `self_*` methods (§1.4).

### 1.4 Built-in self entries

These change the proxy's own settings. They are fixed in code, listed by `get_allowlist` with `builtin = true`, have class `dapp` (GNSF 6001) and answer `variant { Ok; Err }`. They accept only the proxy itself as caller, i.e. an `execute_dapp` proposal whose `canister` is the proxy.

| Method | Argument | Does |
|---|---|---|
| `self_set_icrc3_settings` | ICRC-3 `SettingsUpdate` | log settings |
| `self_icrc3_spill_now` | `()` | move live blocks to the archive now |
| `self_icrc3_repair_archive_controllers` | `()` | re-apply archive controllers (proxy + SNS root) |
| `self_set_max_in_flight` | `nat` (1-100) | how many calls the proxy forwards at once (default 20) |

## 2. Quick start

### 2.1 Read the allowlist

```js
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { idlFactory } from 'https://app.sneeddao.com/api-docs/sneed_proxy.did.js';

const proxy = Actor.createActor(idlFactory, { agent: await HttpAgent.create({ host: 'https://icp-api.io' }), canisterId: PROXY_ID });
const entries = await proxy.get_allowlist();
const names = new Map((await proxy.get_canister_names()).map((n) => [n.canister.toText(), n.name]));
for (const e of entries) console.log(names.get(e.canister.toText()), e.method, Object.keys(e.class)[0], e.label);
```

### 2.2 Build and preview a proposal payload

```js
import { IDL } from '@icp-sdk/core/candid';
const svc = idlFactory({ IDL });
const ProxyCall = svc._fields.find(([m]) => m === 'execute_business')[1].argTypes;

const arg = IDL.encode([IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Nat64)], [[50_000_000n], [], [], []]);
const call = { canister: SNEED_LOCK_ID, method: 'admin_set_lock_fees_icp', arg: new Uint8Array(arg), note: ['Halve the token lock fee'], expires_at: [BigInt(Date.now() + 14 * 86_400_000) * 1_000_000n] };
console.log(await proxy.validate_business(call));    // { Ok: "Sneed proxy · Application Business Logic (GNSF 6000)\nAction: …" }
const payload = new Uint8Array(IDL.encode(ProxyCall, [call]));
```

### 2.3 Submit it

The payload goes into an ordinary SNS proposal, made with a neuron the caller may submit proposals for (permission 3):

```js
await snsGovernance.manage_neuron({ subaccount: neuronId, command: [{ MakeProposal: {
  title: 'Sneed Lock: set the token lock fee → 0.5 ICP', url: 'https://app.sneeddao.com/sneedlock_info', summary,
  action: [{ ExecuteGenericNervousSystemFunction: { function_id: 6000n, payload } }],
} }] });
```

## 3. Execution, replies and failures

When the proposal is adopted, governance calls `execute_<class>(call)` once and never retries. The proxy:

1. checks the caller is governance (it traps otherwise);
2. re-runs every validator check: not expired, not a hard refusal, in the allowlist, enabled, the right class, the argument within `max_arg_bytes`, the target named; a refusal here is a trap and is **not** logged (governance records the reason as the proposal's failure);
3. refuses with `The proxy is busy` if `max_in_flight` calls are already forwarding (nothing is called);
4. forwards with `await (with timeout = 300) call_raw(canister, method, arg)`, attaching no cycles;
5. reads the reply, appends a `sneedproxy_forwarded` block and returns or rejects.

| Case | Block `outcome` | Governance sees | Proposal |
|---|---|---|---|
| Reply, success | `ok` | reply `ok: <label> · reply <n> bytes, SHA-256 <hex> · block <i>` | executed |
| Reply `err`/`Err` with `reply = result` | `err` | reject with the error text (or `target replied err (n bytes)` when it is not text) | failed |
| Target trapped or rejected | `err` | reject `target rejected (<code>): <message>` | failed |
| No answer within 300 s | `unknown` | reject `outcome unknown after 300 s: check <canister> state before re-proposing` | failed, but the change may still happen |
| Refused before the forward | not logged | trap with the reason | failed |

With `reply = result` the proxy reads only the top level of the reply: if it is a single value of a variant type whose tag is `ok`/`Ok` it is success, `err`/`Err` failure; any other shape is success and the bytes are logged. Failures after the forward are rejects (`throw`), not traps, so the block is committed while the call still fails.

## 4. Errors and retries

- Governance never retries an adopted proposal. Re-propose after a failure; after `unknown`, read the target first.
- Two proposals with the same payload are two decisions and both run.
- Errors before the forward: `Only Sneed SNS governance …`, `This proposal expired at …`, `… is not in the proxy allowlist`, `… is disabled in the proxy allowlist`, `… is a <class> action: propose it with GNSF <id> (execute_<class>)`, `The argument is n bytes; … allows at most m`, `SNS canisters are never proxy targets …`, `The proxy is busy (n calls in flight); nothing was called, re-propose later`.

## 5. Method reference

### 5.1 Governance (inter-canister only)

| Method | Notes |
|---|---|
| `execute_business`, `execute_dapp`, `execute_community`, `execute_critical`, `execute_treasury : (ProxyCall) -> (text)` | GNSF targets (§3) |
| `set_allowlist : (AllowlistUpdate) -> (text)` | GNSF 6010 target; returns the diff; appends one block per change |

### 5.2 Validators (queries)

| Method | Notes |
|---|---|
| `validate_business` … `validate_treasury : (ProxyCall) -> (variant { Ok : text; Err : text }) query` | the proposal text voters see |
| `validate_set_allowlist : (AllowlistUpdate) -> (variant { Ok : text; Err : text }) query` | the complete diff: every added, changed (old → new) and removed entry and name |

The `Ok` text of `validate_<class>` has one fact per line, in a stable format: `Sneed proxy · <topic> (GNSF <id>)`, `Action:`, `Target: <name> (<id>)`, `Method:`, `Argument: <n> bytes, SHA-256 <hex>`, `Argument (hex):` (arguments of at most 512 bytes), `Reply:`, `Expires:`, `Note:` (if any), `Payload hash:`, and a link to `https://app.sneeddao.com/proxy/verify?c=…&m=…&a=…` to read the argument decoded. The hex and the hashes are the authority; decode the hex with the target's `.did` (`didc decode`) or in Sneed Hub.

### 5.3 Public queries

| Method | Returns |
|---|---|
| `get_allowlist : () -> (vec EntryView) query` | entries plus the built-in ones (`builtin = true`) |
| `get_canister_names : () -> (vec CanisterName) query` | display names (the proxy is "Sneed proxy") |
| `get_config : () -> (Config) query` | governance, root, the refused SNS canisters and when they were read, `max_in_flight`, `in_flight`, `forward_timeout_seconds`, the expected GNSFs |
| `get_stats : () -> (vec ClassStats) query` | forwarded, ok, err and unknown counts per class |
| `get_recent : (nat) -> (vec Forwarded) query` | the last n (at most 100) forwarded calls, newest first |
| `get_log : (nat, nat) -> (vec LogEntry) query` | the text log (spills, archives, SNS list refreshes) |
| `get_api_doc : () -> (text) query` | the short guide |
| ICRC-3: `icrc3_get_blocks`, `icrc3_get_archives`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`, `icrc10_supported_standards`, `icrc3_log_status` | |

## 6. Activity log (ICRC-3)

The block format, hashing, archives and verification are those of the shared library [src/icrc3](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/icrc3), described in [Sneed Lock's section 8](/api/sneed_lock#8-activity-log-icrc-3). Principals inside `tx` are `Blob`s of the raw principal bytes, numbers are `Nat`, optional fields are omitted. Archives are controlled by the proxy and SNS root. Browse the log at [app.sneeddao.com/tools/icrc3](https://app.sneeddao.com/tools/icrc3).

### Block types

| `btype` | Appended by | `tx` fields |
|---|---|---|
| `sneedproxy_forwarded` | `execute_*`, after the forward | `caller` (governance), `function_id`, `class`, `target`, `method`, `label`, `arg_size`, `arg_hash` (SHA-256 of `arg`), `payload_hash`, `note`?, `expires_at`?, `outcome` (`ok`/`err`/`unknown`), `error`?, `reply_size`?, `reply_hash`?, `reply`? (the reply bytes, when at most 1 KiB) |
| `sneedproxy_allowlist_set` | `set_allowlist`, one per entry | `caller`, `target`, `method`, `class`, `label`, `max_arg_bytes`, `reply` (`any`/`result`), `enabled` (0/1), `old_class`? |
| `sneedproxy_allowlist_removed` | `set_allowlist` | `caller`, `target`, `method`, `old_class` |
| `sneedproxy_canister_named` | `set_allowlist` | `caller`, `target`, `name` (empty when removed) |
| `sneedproxy_config` | `self_*` setters | `caller` (the proxy), `key`, `old`, `new` |

**Joining a block to its proposal.** The proxy cannot see the proposal id. `payload_hash` is the ICRC-3 representation-independent hash of the map `{ canister : Blob; method : Text; arg : Blob; note? : Text; expires_at? : Nat }` built from the decoded payload (the same hash as a block's), so it does not depend on how the payload bytes were encoded. Match it, with `function_id`, against the payloads of governance's `list_proposals`.

## 7. Integration checklist

- Read `get_allowlist` before offering a "Propose" button; the entry's class gives the GNSF, and the GNSF id comes from `list_nervous_system_functions`.
- Preview with the validator query before submitting; a refusal costs nothing.
- Set `expires_at` (Sneed Hub: 14 days).
- Show voters the decoded argument and check its SHA-256 against the validator's `Argument:` line.
- After `unknown`, read the target before re-proposing.
