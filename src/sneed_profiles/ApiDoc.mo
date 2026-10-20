/// get_api_doc text of sneed_profiles: Dapp registry of the Sneed naming service. Full reference: https://app.sneeddao.com/api-docs/sneed_names.md
module {
  public let text : Text = "# Sneed profiles (canister sneed_profiles)

The dapp registry: a dapp (id `nat`) with a name, url, logo and canisters. Members of a sneed_pid_names account carry a `dapp` label pointing here (\"this principal is me on TACO\"). Profile fields beyond the registry are planned, not built.

Production: `fytbs-tqaaa-aaaad-qmk4a-cai`. Staging (same code, own state and admins; test there first): `rviz6-yaaaa-aaaad-ag6oa-cai`.

The Sneed DAO naming service is six canisters (production ids):
- sneed_pid_names `ejz7n-lyaaa-aaaad-qmkzq-cai`: accounts (name, checkmark, avatar shared by several principals), hotkeys, canister names, search
- sneed_neuron_names `e46oa-kqaaa-aaaad-qmk2a-cai`: public names of SNS neurons
- sneed_pid_nicknames `e37iu-hiaaa-aaaad-qmk2q-cai`: each user's own labels for principals
- sneed_neuron_nicknames `es4di-raaaa-aaaad-qmk3a-cai`: each user's own labels for SNS neurons
- sneed_profiles `fytbs-tqaaa-aaaad-qmk4a-cai`: the dapp registry
- sneed_avatars `ev5f4-4yaaa-aaaad-qmk3q-cai`: avatar images by SHA-256, served over HTTP

## Units and encoding
- `DappInput = { name; url; logo : opt AvatarRef; canisters : vec principal }`; `DappView` adds `id`, `verified`, `hidden`, `registered_by`, `created_at`, `updated_at` (`nat64` nanoseconds).
- Names: 1-32 characters (ASCII letters, digits, space, `-`, `_`, `.`, `'`; at least one letter or digit; no leading/trailing or double spaces). `\"\"` clears. Unique regardless of capitals. `url` starts with `https://`, max 200 chars; 1-10 canister ids.
- `register_dapp` returns `variant { ok : nat; err : text }` (the dapp id); `update_dapp` returns `variant { ok : text; err : text }`. `get_dapps` takes at most 500 ids; search at most 50; pages up to 500.

## Authentication
- Reads are public queries; `get_log` is admins only.
- `register_dapp`: a controller of at least one of the dapp's canisters (or the governance of an SNS controlling one); admins skip the check. Anonymous callers are refused.
- `update_dapp`: an admin, or a controller of one of the dapp's current canisters and one of the new ones.
- Checkmarks: admins (`verify_dapp`) or a Sneed DAO proposal (`verify_dapp_by_dao`). Admins may hide a dapp (`admin_hide_dapp`).
- Nothing is anonymous: `registered_by` is public and every change is a block in a public ICRC-3 log.

## Fees, transfers and irreversible actions
- No fees and no token transfers.
- A dapp name with a blacklisted word is refused and the caller is **banned automatically** by the moderator (the Sneed backend).
- A new name, or a canister added by a non-admin, drops the checkmark.

## Asynchronous lifecycle and polling
- Writes complete in one call (they await the management canister for the control check and the moderator, then re-check: `The dapp was changed meanwhile; please try again`). No polling needed; audit with `icrc3_get_blocks`.

## Errors, retries and Busy
- No Busy state. Re-read and retry on `please try again` answers. Errors include `A dapp with that name is registered`, `You must control at least one of the dapp's canisters`, `No such dapp`.

## Common pitfalls
- Query methods answer only query calls; sent as update calls they are refused by the ingress guard (inspect_message). Calls from other canisters are not affected.
- Anonymous update calls are refused at ingress; arguments are capped. `verify_dapp_by_dao` is never accepted by ingress.
- Hidden dapps are left out of `list_dapps` and `search_dapps`; `get_dapps` returns them with `hidden = true`.

## Start with these methods
- `list_dapps`, `get_dapps`, `search_dapps(prefix, limit)`, `stats`, `get_config`
- Writes: `register_dapp`, `update_dapp`

## Full reference
- https://app.sneeddao.com/api-docs/sneed_names.md (all six canisters)
- Candid: https://app.sneeddao.com/api-docs/sneed_profiles.did
- https://app.sneeddao.com/llms.txt
";
};
