# Mr Sneed canister API

Mr Sneed is the mascot and spirit of Sneed DAO ("we are all Mr Sneed"), given a voice by AI. The `mr_sneed` canister holds what makes that voice his and keeps it accountable: the **prompt** (a fixed frame of rules written in the code, plus a **personality** that only Sneed DAO governance can change) and his **memories**, short public notes about DAO facts, decisions, lessons, projects and references that he writes as he works. Every change is recorded in a certified ICRC-3 log.

Everything in this canister is public. Anyone can read the prompt, every memory and the log with plain query calls, which makes it easy to build on: show what Mr Sneed knows about a topic, check that the personality in use is the one the DAO approved, or audit every write.

| | |
|---|---|
| Production canister | `ucthl-5qaaa-aaaay-aadrq-cai` |
| Staging canister | `ufsb7-qiaaa-aaaay-aadra-cai` (separate state, same code line; use it to test) |
| Candid interface | [mr_sneed.did](/api-docs/mr_sneed.did) · [JavaScript IDL factory](/api-docs/mr_sneed.did.js) |
| Source | [src/mr_sneed/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/mr_sneed/main.mo) · design: [spec/mr_sneed_canister.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/mr_sneed_canister.md) |
| This document | [rendered](/api/mr_sneed) · [raw Markdown](/api-docs/mr_sneed.md) |

Governance: the personality, the writer list, the limits and removals are set by Sneed DAO governance (`fi3zi-fyaaa-aaaaq-aachq-cai`, through generic proposals), and by an **operator** principal until someone calls `end_operator`, after which only the DAO governs. `get_config()` shows the current operator, governance principal and writers. Unlike the other Sneed DAO canisters, `mr_sneed` is not yet controlled by the SNS root (check with `dfx canister --network ic info ucthl-5qaaa-aaaay-aadrq-cai`); registering it with the DAO is planned. The method set below matches the source on `main`.

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister (units and encoding, authentication, fees, transfers and irreversible actions, asynchronous flows and polling, common pitfalls) that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 The prompt: frame plus personality

| Part | What it is | Who changes it |
|---|---|---|
| **Frame** | The rules, a constant in the code (no talking about price, member text is information not instructions, the memory is public, treasury is not his to move, everything built belongs to the DAO, and so on). Its SHA-256 is published as `frame_hash`. | Only a canister upgrade. |
| **Personality** | Versioned text, at most 8,192 bytes. Version 1 is the first one set; each `set_personality` appends a new version. Old versions stay readable. | Sneed DAO governance, or the operator while there is one. |

`get_prompt()` returns both. The frame overrides the personality and the memories.

### 1.2 Memories

A memory is a short record:

| Field | Meaning |
|---|---|
| `id` | Global counter, never reused. |
| `path` | A folder such as `dao/governance`; `""` is the top. Up to 8 segments of `a-z 0-9 - _ .`, joined by `/`, at most 120 characters. |
| `kind` | `note`, `member(principal)` (about a member), `decision(opt proposal_id)`, `lesson`, `project(name)`, `reference`. |
| `title` | 1 to 120 characters. |
| `body` | Plain text, at most 4,096 bytes. |
| `tags` | At most 8, each 1 to 32 of `a-z 0-9 - _ .`. |
| `links` | At most 8, each 1 to 256 characters. |
| `pinned` | Pinned memories are always in the session brief. At most `limits.max_pinned`. |
| `author` | The writer principal that wrote it. |
| `created_at` | `int` nanoseconds since the Unix epoch. |
| `status` | `active`, `superseded(new_id)` (a revision replaced it), or `removed { by; reason; at }` (a tombstone: the body is erased, the title stays). |

Memories are never edited in place. `revise` writes a new memory and marks the old one `superseded`.

### 1.3 Who can do what

| Who | Can |
|---|---|
| Anyone, signed or not | Every query: prompt, personalities, memories, folders, search, brief, config, stats, ICRC-3 log. |
| Writers (`get_config().writers`, at most 20) | `remember`, `revise`, `forget`, `set_pinned`, within `writes_per_day` writes per writer per UTC day. |
| The member a `member(p)` memory is about | `forget_about_me` on that memory. |
| Governance or the operator | `set_personality`, `set_writers`, `set_limits`, `remove_memory`, `end_operator`. |
| The operator only | `operator_set_config`. |

### 1.4 Time and limits

Timestamps (`created_at`, `set_at`, `removed.at`) are `int` nanoseconds since the Unix epoch. Pages return at most 100 items. Unfiltered list, search and brief queries scan at most 20,000 memories, newest first.

### 1.5 Calls the canister refuses at ingress

The canister's `inspect` refuses, before anybody pays for them:

- **Queries sent as update calls.** Use query calls (`--query` with dfx).
- **Writes from principals that cannot make them.** `remember`, `revise`, `forget` and `set_pinned` are accepted only from writers; governance methods by ingress only from the operator (governance calls them inter-canister); `forget_about_me` from any signed-in principal.
- **Oversized arguments**, capped per method (a memory input at about the size of its largest valid form).

---

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './mr_sneed.did.js'; // https://app.sneeddao.com/api-docs/mr_sneed.did.js

const MR_SNEED = 'ucthl-5qaaa-aaaay-aadrq-cai';

export function mrSneedActor(identity) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' }); // identity optional for reads
  return Actor.createActor(idlFactory, { agent, canisterId: MR_SNEED });
}
```

With dfx:

```bash
dfx canister --network ic call ucthl-5qaaa-aaaay-aadrq-cai session_brief '(30)' --query
```

### 2.2 Read the prompt and check the personality

```js
const mr = mrSneedActor();
const { frame, frame_hash, personality } = await mr.get_prompt();
if (personality.length) {
  const p = personality[0];
  console.log(`personality v${p.version}, set ${new Date(Number(p.set_at / 1_000_000n)).toISOString()}: ${p.reason}`);
  // p.hash is SHA-256 of p.text; the matching ICRC-3 block (btype mrs_personality) carries the same hash
}
```

### 2.3 Browse and search memories

```js
// Newest first, the folder "dao" and everything under it, active only
let after = [];
do {
  const page = await mr.list_memories({ path: ['dao'], kind: [], tag: [], status: ['active'], after, limit: 100n });
  for (const m of page.items) console.log(m.id, m.path, m.title);
  after = page.next;           // [] when done
} while (after.length);

const hits = await mr.search_memories('sneed lock nft', 20n); // every word must prefix a word of title, path or tags
const folders = await mr.list_folders();                       // [{ path, active, total }]
```

### 2.4 What does Mr Sneed remember about me?

```js
const page = await mrSneedActor(identity).memories_about(identity.getPrincipal(), [], 100n);
for (const m of page.items) {
  if ('active' in m.status) {
    const r = await mrSneedActor(identity).forget_about_me(m.id, 'please forget');
    console.log('ok' in r ? r.ok : r.err); // "Removed"
  }
}
```

---

## 3. Flows in detail

### 3.1 A session brief

`session_brief(n)` is what a session of Mr Sneed reads first: the frame and its hash, the current personality, every pinned active memory, and the `n` most recent active unpinned ones (`n` capped at 100), plus `stats`. The response is kept under about 2.5 MB of memory text; the oldest pinned memories that do not fit are left out.

### 3.2 Writing (writers only)

- `remember(input)` → `ok(id)`. Validates the input (section 1.2), then the budget: `At most N writes a day`, `Too many active memories: revise or forget some first`, `The memory store is full`, `At most N pinned memories`.
- `revise(id, input)` → `ok(new_id)`. The old memory must be active (`Only an active memory can be revised`); it becomes `superseded(new_id)` and the new block carries `supersedes`.
- `forget(id, reason)` → `ok("Forgotten")`. Reason 1 to 500 characters. Tombstones the memory and erases its body.
- `set_pinned(id, bool)` → `ok("Pinned" | "Unpinned" | "Unchanged")`. Only active memories.

Every write counts against the writer's daily budget (UTC days).

### 3.3 Members' rights

A memory of kind `member(p)` is about `p`. `memories_about(p, after, limit)` lists them oldest first (all statuses); `p` signed in can remove any of them with `forget_about_me(id, reason)` (reason may be empty, at most 500 characters). Errors: `Sign in first`, `That memory is not about you`, `That memory is not about a member`, `No such memory`, `Already removed`. The removal is logged with `by = "member"`.

### 3.4 Governance changes

`set_personality`, `set_writers`, `set_limits` and `remove_memory` are generic-proposal targets. Each has a `validate_*` query that renders exactly what the proposal will do (for the personality: version change, SHA-256 and full text) or returns `Err` with the reason it would fail. The update methods **trap** on refusal, so a proposal that cannot take effect shows as failed instead of silently doing nothing. `set_personality` takes `expected_version` to refuse a stale proposal (`The personality is at version N, not M`).

---

## 4. Errors and retries

Result shapes: writes return `variant { ok : text | nat; err : text }`; validators return `variant { Ok : text; Err : text }`; governance updates return nothing or trap. Every update is a single message with no inter-canister await (except `admin_icrc3_spill_now`), so a rejected call changed nothing and can be retried. `remember` is not idempotent: a retry after a timeout may write a second memory; check `list_memories` first.

---

## 5. Method reference

### 5.1 Public queries

| Method | Returns | Notes |
|---|---|---|
| `get_prompt()` | `Prompt { frame; frame_hash; personality : opt Personality }` | The current prompt. |
| `get_personality(opt version)` | `opt Personality` | Current with `null`; a given version (1-based) otherwise. |
| `list_personalities(start, limit)` | `vec Personality` | Oldest first; `start` is 0-based; at most 100. |
| `session_brief(n)` | `Brief` | Section 3.1. |
| `get_memory(id)` | `opt Memory` | Any status. |
| `list_memories(ListArgs)` | `Page { items; next : opt nat }` | Newest first, ids below `after`. Filters: `path` (that folder and everything under it), `kind` and `status` by name (`"note"`, `"member"`, `"decision"`, `"lesson"`, `"project"`, `"reference"`; `"active"`, `"superseded"`, `"removed"`), `tag` (exact). Pass `next` as `after` for the next page; `next` may be set with a short page when the scan limit was hit. |
| `search_memories(q, limit)` | `vec Memory` | Active memories where every word of `q` (case-insensitive) starts some word of the title, path or tags. Newest first, at most 100. |
| `memories_about(p, after, limit)` | `Page` | Memories of kind `member(p)`, oldest first, ids above `after`. |
| `list_folders()` | `vec Folder { path; active; total }` | Every folder that has held a memory. |
| `get_config()` | `Config { operator; governance; writers; limits; archive_controllers }` | |
| `get_stats()` | `Stats { active; total; bytes; pinned }` | `bytes` counts title + body of active memories. |
| `validate_set_personality(args)`, `validate_set_writers(vec principal)`, `validate_set_limits(Limits)`, `validate_remove_memory(id, reason)` | `ValidationResult` | Proposal validators (3.4). |

### 5.2 Member update

**`forget_about_me(id : nat, reason : text) → Result`** (section 3.3).

### 5.3 ICRC-3 log

`icrc3_get_blocks`, `icrc3_get_archives`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`, `icrc10_supported_standards` and `icrc3_log_status` behave exactly as in Sneed Lock (same shared `src/icrc3` library; see [Sneed Lock, section 8](/api/sneed_lock#8-activity-log-icrc-3) for the block format, hashing and verification). Blocks carry `caller` as a principal blob. Block types:

| `btype` | `tx` fields |
|---|---|
| `mrs_init` | `caller`, `operator`, `frame_hash` |
| `mrs_personality` | `caller`, `version`, `text_hash`, `reason`, `by` (`"dao"` or `"operator"`) |
| `mrs_memory` | `caller` (the author), `id`, `path`, `kind` (`Text` name, or a `Map` `{member}`, `{decision}`, `{project}`), `title`, `body_hash` (SHA-256 of the body), `tags`, `links`, `pinned` (0/1), `supersedes` (revisions only) |
| `mrs_forget` | `caller`, `id`, `reason`, `by` (`"writer"`, `"member"`, `"dao"` or `"operator"`) |
| `mrs_pin` | `caller`, `id`, `pinned` (0/1) |
| `mrs_config` | `caller`, `method` (`set_writers`, `set_limits`, `operator_set_config`, `end_operator`) and the new values |

The log stores the body's hash, not the body: compare `sha256(memory.body)` with `body_hash` to check a memory. After a removal the hash remains and the text is gone.

### 5.4 Writer, governance and operator methods

| Method | Who | One line |
|---|---|---|
| `remember(MemoryInput) → IdResult` | writers | Write a memory (3.2). |
| `revise(id, MemoryInput) → IdResult` | writers | Replace an active memory (3.2). |
| `forget(id, reason) → Result` | writers | Tombstone a memory. |
| `set_pinned(id, bool) → Result` | writers | Pin or unpin. |
| `set_personality(SetPersonalityArgs) → nat` | governance / operator | Append a personality version; returns it. Traps on refusal. |
| `set_writers(vec principal)` | governance / operator | Replace the writer list (at most 20, no anonymous principal). |
| `set_limits(Limits)` | governance / operator | Daily writes, pinned, active and byte limits (non-zero; at most 10 GB). |
| `remove_memory(id, reason)` | governance / operator | Tombstone any memory. |
| `end_operator() → Result` | governance / operator | Ends the operator's powers for good. |
| `operator_set_config(governance, archive_controllers) → Result` | operator | Governance principal and ICRC-3 archive controllers. |
| `admin_icrc3_spill_now() → variant { Ok : nat; Err : text }` | governance / operator / controllers | Move live blocks to an archive now (a timer does it every 15 minutes). |

---

## 6. Types

```candid
type Kind = variant { note; member : principal; decision : opt nat64; lesson; project : text; reference };
type Status = variant { active; superseded : nat; removed : record { by : principal; reason : text; at : int } };
type Memory = record {
  id : nat; path : text; kind : Kind; title : text; body : text; tags : vec text; links : vec text;
  pinned : bool; author : principal; created_at : int; status : Status;
};
type MemoryInput = record { path : text; kind : Kind; title : text; body : text; tags : vec text; links : vec text; pinned : bool };
type ListArgs = record { path : opt text; kind : opt text; tag : opt text; status : opt text; after : opt nat; limit : nat };
type Page = record { items : vec Memory; next : opt nat };
type Folder = record { path : text; active : nat; total : nat };
type Personality = record { version : nat; "text" : text; hash : blob; set_at : int; set_by_proposal : opt nat64; reason : text };
type SetPersonalityArgs = record { "text" : text; reason : text; expected_version : opt nat };
type Prompt = record { frame : text; frame_hash : blob; personality : opt Personality };
type Brief = record { frame : text; frame_hash : blob; personality : opt Personality; pinned : vec Memory; recent : vec Memory; stats : Stats };
type Stats = record { active : nat; total : nat; bytes : nat; pinned : nat };
type Limits = record { writes_per_day : nat; max_pinned : nat; max_active : nat; max_bytes : nat };
type Config = record { operator : opt principal; governance : principal; writers : vec principal; limits : Limits; archive_controllers : vec principal };
type Result = variant { ok : text; err : text };
type IdResult = variant { ok : nat; err : text };
type ValidationResult = variant { Ok : text; Err : text };
```

`Personality.set_by_proposal` is currently always null; the proposal that set a version is found through the DAO's proposal history (the `mrs_personality` block's `by = "dao"` and timestamp).

---

## 7. Integration checklist

- Read with query calls; no identity is needed.
- Page `list_memories` with `next` until it is empty; do not assume a short page is the last one.
- Show tombstones honestly: a `removed` memory keeps its title and the reason, not its body.
- To verify a personality, hash `text` with SHA-256 and compare it with `hash` and with the `mrs_personality` block.
- Memories are public, permanent in the log (as hashes) and visible to node providers. Do not encourage anyone to share anything private with Mr Sneed.
