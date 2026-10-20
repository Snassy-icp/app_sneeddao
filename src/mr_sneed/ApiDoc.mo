/// The text get_api_doc returns: a short guide for agents (full reference in public/api-docs/mr_sneed.md).
module {
  public let text : Text = "# Mr Sneed (canister mr_sneed)

Mr Sneed is the mascot and spirit of Sneed DAO (\"we are all Mr Sneed\"), given a voice by AI. This canister holds what makes that voice his and keeps it accountable: the prompt (a fixed frame of rules in the code, plus a versioned personality that only Sneed DAO governance can change) and his memories, short public notes about DAO facts, decisions, lessons, projects and references. Every change is recorded in a certified ICRC-3 log. Everything here is public.

- Production: `ucthl-5qaaa-aaaay-aadrq-cai`
- Staging: `ufsb7-qiaaa-aaaay-aadra-cai` (separate state; use it to test)

## Units and encoding
- Memory ids are `nat` (a global counter, never reused). Timestamps are `int` nanoseconds since the Unix epoch.
- Memory `kind`: `note`, `member(principal)`, `decision(opt proposal_id)`, `lesson`, `project(name)`, `reference`. `status`: `active`, `superseded(new_id)`, `removed { by; reason; at }`.
- Paths like `dao/governance` (`\"\"` is the top). Body at most 4,096 bytes, title 1-120 characters, at most 8 tags and 8 links.
- Writes return `variant { ok : text | nat; err : text }`; proposal validators return `variant { Ok : text; Err : text }`; governance updates return nothing or trap on refusal.
- The ICRC-3 log stores `body_hash` (SHA-256 of the body), not the body.

## Authentication
- Anyone, signed or not, may call every query: prompt, personalities, memories, folders, search, brief, config, stats, ICRC-3 log.
- Writers (`get_config().writers`, at most 20): `remember`, `revise`, `forget`, `set_pinned`, within a daily write budget.
- The member a `member(p)` memory is about: `forget_about_me` on it.
- Sneed DAO governance (by generic proposals) or the operator while there is one: `set_personality`, `set_writers`, `set_limits`, `remove_memory`, `end_operator`. Operator only: `operator_set_config`.
- Nothing is anonymous: memories record their author principal, and every write is logged with the caller.

## Fees, transfers and irreversible actions
- No fees and no token transfers.
- **Memories are public and permanent in the log as hashes.** `forget`, `remove_memory` and `forget_about_me` tombstone a memory: the body is erased, the title and reason stay, and the log keeps the hash. Never share anything private with Mr Sneed.
- **`end_operator` is irreversible**: afterwards only the DAO governs.
- Memories are never edited in place: `revise` writes a new memory and marks the old one superseded.

## Asynchronous lifecycle and polling
- Every update is a single message with no inter-canister await (except `admin_icrc3_spill_now`); its effect is visible at once.
- To follow changes, poll the ICRC-3 log (`icrc3_get_blocks`) or `list_memories` newest first; every few minutes is plenty. A timer moves blocks to archives every 15 minutes.
- Governance changes take effect when the DAO's proposal executes; the matching `validate_*` query shows what a proposal will do.

## Errors, retries and Busy
- A rejected update changed nothing and can be retried.
- `remember` is not idempotent: after a timeout check `list_memories` before writing again.
- `set_personality` takes `expected_version` and refuses a stale proposal (`The personality is at version N, not M`).
- Budget errors: `At most N writes a day`, `Too many active memories: revise or forget some first`, `The memory store is full`, `At most N pinned memories`.

## Common pitfalls
- Query methods sent as update calls are refused by the ingress guard (`inspect`); use query calls.
- Writes are refused at ingress from principals that cannot make them; arguments are capped per method.
- Pages return at most 100 items; page `list_memories` with `next` until it is empty (a short page is not necessarily the last).
- `search_memories` matches word prefixes of title, path and tags, not the body.

## Start with these methods
`session_brief(n)`, `get_prompt`, `list_memories`, `search_memories`, `get_memory`, `list_folders`, `memories_about`, `forget_about_me`, `get_config`, `get_stats`, `icrc3_get_blocks`.

## Full reference
- https://app.sneeddao.com/api-docs/mr_sneed.md
- Candid: https://app.sneeddao.com/api-docs/mr_sneed.did
- All Sneed APIs: https://app.sneeddao.com/llms.txt
";
};
