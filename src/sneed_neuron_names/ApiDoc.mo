/// get_api_doc text of sneed_neuron_names: Public names of SNS neurons (Sneed naming service). Full reference: https://app.sneeddao.com/api-docs/sneed_names.md
module {
  public let text : Text = "# Sneed neuron names (canister sneed_neuron_names)

Public names (with checkmark and avatar) for SNS neurons, unique per SNS. A neuron is keyed by `NeuronKey = { sns_root : principal; neuron_id : blob }` (the neuron's subaccount bytes, 1-64 bytes).

Production: `e46oa-kqaaa-aaaad-qmk2a-cai`. Staging (same code, own state and admins; test there first): `rjmdp-paaaa-aaaad-ag6ma-cai`.

The Sneed DAO naming service is six canisters (production ids):
- sneed_pid_names `ejz7n-lyaaa-aaaad-qmkzq-cai`: accounts (name, checkmark, avatar shared by several principals), hotkeys, canister names, search
- sneed_neuron_names `e46oa-kqaaa-aaaad-qmk2a-cai`: public names of SNS neurons
- sneed_pid_nicknames `e37iu-hiaaa-aaaad-qmk2q-cai`: each user's own labels for principals
- sneed_neuron_nicknames `es4di-raaaa-aaaad-qmk3a-cai`: each user's own labels for SNS neurons
- sneed_profiles `fytbs-tqaaa-aaaad-qmk4a-cai`: the dapp registry
- sneed_avatars `ev5f4-4yaaa-aaaad-qmk3q-cai`: avatar images by SHA-256, served over HTTP

## Units and encoding
- Timestamps are `nat64` nanoseconds since the Unix epoch.
- `AvatarRef = variant { url : text; blob : blob }`: an `https://` link (max 512 chars) or the 32-byte SHA-256 of a sneed_avatars image.
- Names: 1-32 characters (ASCII letters, digits, space, `-`, `_`, `.`, `'`; at least one letter or digit; no leading/trailing or double spaces). `\"\"` clears. Unique per SNS regardless of capitals.
- Writes return `variant { ok : text; err : text }` (`Name set`, `Name removed`, `Unchanged`). Batched `get_names` takes at most 500 keys and traps above; search at most 50; pages capped at 500.

## Authentication
- Reads are public queries. `get_log` is admins only.
- `set_name` / `set_avatar`: anyone with any permission on the neuron according to that SNS's governance canister; the root counts only if SNS-W lists it as a deployed SNS. Admins may name any neuron. Anonymous callers are refused.
- Checkmarks: admins (`verify`), the governance canister of the neuron's own SNS (`verify_by_sns`, by that SNS's proposal) or a Sneed DAO proposal (`verify_by_dao`).
- Nothing is anonymous: names record `set_by`, and every change is a block in a public ICRC-3 log.

## Fees, transfers and irreversible actions
- No fees and no token transfers.
- A name with a blacklisted word is refused and the caller is **banned automatically** by the moderator (the Sneed backend). Banned principals cannot set names.
- A rename clears the checkmark.

## Asynchronous lifecycle and polling
- Writes complete in one call (they await the moderator, SNS-W and the SNS governance canister, then re-check state).
- Mirror with `changes_since({ after; limit })`, persisting the last `seq` (`state = []` when removed); poll as queries at a modest interval. Audit via `icrc3_get_blocks` and the certified tip.

## Errors, retries and Busy
- No Busy state. Retrying a write is safe (same value answers `Unchanged`).
- `The name check is unavailable right now, please try again (...)`: nothing stored; retry later.
- Typical errors: `Not a neuron id`, `That name is taken in this SNS`, `Not a deployed SNS`, `No such neuron in that SNS`, `You have no permission on that neuron`, `Name the neuron first`.

## Common pitfalls
- Query methods answer only query calls; sent as update calls they are refused by the ingress guard (inspect_message). Calls from other canisters are not affected.
- Anonymous update calls are refused at ingress; arguments are capped (4 KiB, about 6 KiB with an avatar link). `verify_by_dao`, `unverify_by_dao`, `verify_by_sns`, `unverify_by_sns` are never accepted by ingress (governance canisters call them).
- Show a checkmark only when `verified` is true.

## Start with these methods
- `get_names(vec NeuronKey)`, `get_name`, `search({ sns_root; prefix; limit })`, `list_by_sns`, `changes_since`, `stats`, `get_config`
- Writes: `set_name`, `set_avatar`

## Full reference
- https://app.sneeddao.com/api-docs/sneed_names.md (all six canisters)
- Candid: https://app.sneeddao.com/api-docs/sneed_neuron_names.did
- https://app.sneeddao.com/llms.txt
";
};
