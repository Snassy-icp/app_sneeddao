/// get_api_doc text of sneed_pid_names: Public names, accounts, hotkeys and canister names (Sneed naming service). Full reference: https://app.sneeddao.com/api-docs/sneed_names.md
module {
  public let text : Text = "# Sneed principal names (canister sneed_pid_names)

Gives a person one public name for all their principals: a name belongs to an **account** (id `nat`, never reused) with a checkmark, an avatar, an optional NFT avatar (ICRC-7 or EXT), member principals and hotkeys. Also names canisters (by their controllers) and keeps a name search index.

Production: `ejz7n-lyaaa-aaaad-qmkzq-cai`. Staging (same code, own state and admins; test there first): `qechb-aiaaa-aaaad-ag6lq-cai`.

The Sneed DAO naming service is six canisters (production ids):
- sneed_pid_names `ejz7n-lyaaa-aaaad-qmkzq-cai`: accounts (name, checkmark, avatar shared by several principals), hotkeys, canister names, search
- sneed_neuron_names `e46oa-kqaaa-aaaad-qmk2a-cai`: public names of SNS neurons
- sneed_pid_nicknames `e37iu-hiaaa-aaaad-qmk2q-cai`: each user's own labels for principals
- sneed_neuron_nicknames `es4di-raaaa-aaaad-qmk3a-cai`: each user's own labels for SNS neurons
- sneed_profiles `fytbs-tqaaa-aaaad-qmk4a-cai`: the dapp registry
- sneed_avatars `ev5f4-4yaaa-aaaad-qmk3q-cai`: avatar images by SHA-256, served over HTTP

## Units and encoding
- Timestamps are `nat64` nanoseconds since the Unix epoch. Account and dapp ids are `nat`.
- `AvatarRef = variant { url : text; blob : blob }`: an `https://` link (max 512 chars) or the 32-byte SHA-256 of a sneed_avatars image, served at `https://ev5f4-4yaaa-aaaad-qmk3q-cai.raw.icp0.io/<64 hex>`.
- Names: 1-32 characters (ASCII letters, digits, space, `-`, `_`, `.`, `'`; at least one letter or digit; no leading/trailing or double spaces). `\"\"` clears. Unique regardless of capitals; accounts and canisters share one name space (canister names: at least 2 chars).
- Writes return `variant { ok : text; err : text }` (ok says what happened: `Name set`, `Unchanged`, `Merged`, ...). ICRC-3 admin methods use `Ok`/`Err`.
- Pages: `{ start_after : opt K; limit : nat }` in, `{ items; next : opt K }` out; pass `next` back until null. limit capped at 500, search at 50. `get_names` takes at most 500 principals and traps above.

## Authentication
- Reads are public queries; any principal (even unsigned) may call them. `get_log` is admins only. Hotkeys in `AccountView` are filled only for the account's owners, hotkeys and admins.
- Every write refuses the anonymous principal (`Please sign in`); canisters cannot own accounts.
- Owners rename, change avatars, add hotkeys, change roles. A hotkey may manage the account and merge it into its own account. Canister names: the caller must control the canister (checked with the management canister), or be the governance of an SNS whose root controls it.
- Nothing here is anonymous: names, accounts with their member principals, canister names and every change are public, and each change is a block in a public ICRC-3 log.

## Fees, transfers and irreversible actions
- No fees and no token transfers in this canister.
- `merge_account` is irreversible: the merged account, its hotkeys and NFT avatar are deleted, its members join the caller's account. Merging or `link_by_neuron` publicly reveals that the principals belong together; tell the user first.
- A public name with a blacklisted word is refused and the caller is **banned automatically** by the moderator (the Sneed backend's `names_moderate`). Banned principals cannot set names.
- A rename clears the checkmark. Checkmarks come from admins (`verify`) or a Sneed DAO proposal (`verify_by_dao`).

## Asynchronous lifecycle and polling
- Writes complete in one call (awaiting the moderator and other canisters, then re-checking state).
- To mirror names, page `changes_since({ after; limit })`, persisting the last `seq`; each entity appears once at its latest change (`state = []` when deleted). Poll it at a modest interval (minutes), as queries.
- Audits: read the ICRC-3 log (`icrc3_get_blocks`, `icrc3_get_archives`, `icrc3_get_tip_certificate`).
- NFT avatars change hands: before showing `nft_avatar`, check ownership on the collection by `nft_avatar_standard` and fall back to `avatar`: \"ICRC-7\": `icrc7_owner_of([token_id])` owner == `owner`; \"EXT\": `bearer(tokenIdentifier(collection, token_id))` == the account identifier of `owner`'s default account. Anyone signed in may call `refresh_nft_avatar`.
- `set_my_nft_avatar` takes ICRC-7 NFTs only; EXT NFTs (e.g. Sneed Diamond Club cards) go through `set_my_ext_nft_avatar` (`token_id` = the EXT token index; a member's default account must hold it).

## Errors, retries and Busy
- There is no Busy state. Retrying a timed-out write is safe (same value answers `Unchanged` / `Already a hotkey`); re-read state first if the answer matters.
- `The name check is unavailable right now, please try again (...)`: moderator unreachable, nothing stored; retry later.
- A trap (e.g. over 500 keys) means nothing changed.

## Common pitfalls
- Query methods answer only query calls; sent as update calls they are refused by the ingress guard (inspect_message). Calls from other canisters are not affected.
- Anonymous update calls are refused at ingress; arguments are capped (4 KiB for most calls, about 6 KiB with an avatar link). `admin_*`, `verify`, `unverify` are refused unless the caller is an admin; `verify_by_dao`/`unverify_by_dao` are never accepted by ingress.
- Show a checkmark only when `verified` is true, not from `verification` alone (it may belong to an older name).

## Start with these methods
- `get_names(vec principal)`, `get_name`, `search({ prefix; limit; kind })`, `list_names`
- `get_account`, `get_account_of`, `get_canister_name`, `my_hotkey_accounts`, `changes_since`, `stats`, `get_config`
- Writes: `set_my_name`, `set_my_avatar`, `set_my_nft_avatar`, `set_my_ext_nft_avatar`, `add_hotkey`, `merge_account`, `remove_member`, `set_member`, `link_by_neuron`, `set_canister_name`

## Full reference
- https://app.sneeddao.com/api-docs/sneed_names.md (all six canisters)
- Candid: https://app.sneeddao.com/api-docs/sneed_pid_names.did
- https://app.sneeddao.com/llms.txt
";
};
