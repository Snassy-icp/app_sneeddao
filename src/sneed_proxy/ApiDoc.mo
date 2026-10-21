/// get_api_doc text of sneed_proxy. Full reference: https://app.sneeddao.com/api-docs/sneed_proxy.md
module {
  public let text : Text = "# Sneed proxy (canister sneed_proxy)

Carries Sneed DAO proposals into the DAO's canisters, so every admin setting can be changed by SNS proposal. SNS governance calls one execute method per proposal topic; the proxy checks the call against its allowlist and forwards it, as an admin of the target. Controlled by SNS root only; no admins; holds no tokens.

Production: not deployed yet. Sneed SNS governance `fi3zi-fyaaa-aaaaq-aachq-cai`, root `fp274-iaaaa-aaaaq-aacha-cai`.

## Units and encoding
- Proposal payload: `ProxyCall = record { canister : principal; method : text; arg : blob; note : opt text; expires_at : opt nat64 }`. `arg` is the Candid-encoded argument tuple of the target method; `expires_at` is nanoseconds since the epoch; `note` at most 500 characters.
- Generic nervous system functions (target / validator): 6000 `execute_business` / `validate_business` (ApplicationBusinessLogic), 6001 `execute_dapp` (DappCanisterManagement), 6002 `execute_community` (DaoCommunitySettings, critical), 6003 `execute_critical` (CriticalDappOperations, critical), 6004 `execute_treasury` (TreasuryAssetManagement, critical), 6010 `set_allowlist` / `validate_set_allowlist` (CriticalDappOperations, critical). `get_config` lists them.
- Allowlist entry: `record { canister; method; class : variant { business; dapp; community; critical; treasury }; label; max_arg_bytes; reply : variant { any; result }; enabled }`.

## Authentication
- `execute_*` and `set_allowlist`: SNS governance only (checked in the method; never accepted by ingress).
- `self_*`: the proxy itself, reached through `execute_dapp` proposals.
- Everything else is a public query. Nothing is anonymous: proposals and the ICRC-3 log are public.

## Fees, transfers and irreversible actions
- No fees; the proxy holds no tokens and attaches no cycles. A forwarded call changes the target as an admin click would; it is not undone.
- Never targets SNS canisters (governance, root, ledger, index, swap, archives), the management canister, or itself except its built-in `self_*` methods.

## Asynchronous lifecycle and polling
- A proposal is validated when it is made (the validator's `Ok` text is what voters see) and checked again when it is executed: allowlist, class, size, expiry.
- The forward is a bounded-wait call (300 s). A reply is success, except that with `reply = result` a top-level `err`/`Err` variant fails the proposal. A trap or reject fails it. A timeout fails it as `outcome unknown`: the change may still have happened; read the target before re-proposing.
- Every forwarded call is a `sneedproxy_forwarded` block (`icrc3_get_blocks`, `get_recent`) with `payload_hash`, `arg_hash`, outcome and reply hash.

## Errors, retries and Busy
- Governance never retries. Refusals before the forward are traps; failures after it are rejects carrying the reason and the block index.
- At most 20 forwards in flight (`get_config`); beyond that a proposal fails with `The proxy is busy`, and nothing is called: re-propose.

## Common pitfalls
- Query methods (validators included) answer only query calls; sent as update calls they are refused by the ingress guard. There is no ingress update method at all.
- A proposal through the wrong function is refused: an entry's class decides its GNSF.
- `payload_hash` is the ICRC-3 value hash of the map {canister, method, arg, note?, expires_at?}, not the SHA-256 of the payload bytes.

## Start with these methods
- `get_allowlist`, `get_canister_names`, `get_config`, `get_stats`, `get_recent(n)`, `get_log(start, length)`
- `validate_business(call)` to preview a proposal; the ICRC-3 queries for the history

## Full reference
- https://app.sneeddao.com/api-docs/sneed_proxy.md
- Candid: https://app.sneeddao.com/api-docs/sneed_proxy.did
- https://app.sneeddao.com/llms.txt
";
};
