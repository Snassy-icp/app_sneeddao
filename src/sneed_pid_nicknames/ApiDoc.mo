/// get_api_doc text of sneed_pid_nicknames: Private nicknames for principals (Sneed naming service). Full reference: https://app.sneeddao.com/api-docs/sneed_names.md
module {
  public let text : Text = "# Sneed principal nicknames (canister sneed_pid_nicknames)

Each user's own labels (with an optional avatar) for principals. Targets are principals. Everything is scoped to the caller: there is no method that returns someone else's nicknames and no public log.

Production: `e37iu-hiaaa-aaaad-qmk2q-cai`. Staging (same code, own state and admins; test there first): `ronf3-cyaaa-aaaad-ag6mq-cai`.

The Sneed DAO naming service is six canisters (production ids):
- sneed_pid_names `ejz7n-lyaaa-aaaad-qmkzq-cai`: accounts (name, checkmark, avatar shared by several principals), hotkeys, canister names, search
- sneed_neuron_names `e46oa-kqaaa-aaaad-qmk2a-cai`: public names of SNS neurons
- sneed_pid_nicknames `e37iu-hiaaa-aaaad-qmk2q-cai`: each user's own labels for principals
- sneed_neuron_nicknames `es4di-raaaa-aaaad-qmk3a-cai`: each user's own labels for SNS neurons
- sneed_profiles `fytbs-tqaaa-aaaad-qmk4a-cai`: the dapp registry
- sneed_avatars `ev5f4-4yaaa-aaaad-qmk3q-cai`: avatar images by SHA-256, served over HTTP

## Units and encoding
- `Nickname = { target; nickname : text; avatar : opt AvatarRef; updated_at : nat64 }` (nanoseconds since the Unix epoch).
- `AvatarRef = variant { url : text; blob : blob }`: an `https://` link (max 512 chars) or the SHA-256 of a sneed_avatars image.
- Names: 1-32 characters (ASCII letters, digits, space, `-`, `_`, `.`, `'`; at least one letter or digit; no leading/trailing or double spaces). `\"\"` clears. Nicknames need not be unique.
- Writes return `variant { ok : text; err : text }`. `get_my_nicknames_for` takes at most 500 targets (traps above); pages up to 500; search up to 50.

## Authentication
- All reads return only the caller's own nicknames, so call them as signed queries.
- Writes refuse the anonymous principal.
- Nicknames are unpublished, **not secret**: stored unencrypted on a public network. Do not put anything in a nickname the user could not bear to see public. The writes are signed by the caller's principal; nothing on-chain is anonymous.

## Fees, transfers and irreversible actions
- No fees and no token transfers. Limit: 10 nicknames per user, 100 with Sneed Premium (`my_nickname_count`).
- Nicknames are checked by the moderator (the Sneed backend): a blacklisted word is refused; banned principals cannot set nicknames.
- `set_nickname(target, \"\")` removes the nickname.

## Asynchronous lifecycle and polling
- Writes complete in one call (they await the moderator and, for the limit, the premium canister). No polling needed; re-read with `get_my_nicknames`.

## Errors, retries and Busy
- No Busy state. Retrying a write is safe.
- `The name check is unavailable right now, please try again (...)`: nothing stored; retry later.
- `You have reached the maximum number of nicknames (10). Get Sneed Premium for more!`, `Set a nickname first` (for `set_nickname_avatar`).

## Common pitfalls
- Query methods answer only query calls; sent as update calls they are refused by the ingress guard (inspect_message). Calls from other canisters are not affected.
- Anonymous update calls are refused at ingress; arguments are capped (4 KiB, about 6 KiB with an avatar link).
- Unsigned reads return nothing useful: they answer for the anonymous caller.

## Start with these methods
- `get_my_nicknames({ start_after; limit })`, `get_my_nicknames_for`, `search_my_nicknames(prefix, limit)`, `my_nickname_count`, `stats`, `get_config`
- Writes: `set_nickname`, `set_nickname_avatar`

## Full reference
- https://app.sneeddao.com/api-docs/sneed_names.md (all six canisters)
- Candid: https://app.sneeddao.com/api-docs/sneed_pid_nicknames.did
- https://app.sneeddao.com/llms.txt
";
};
