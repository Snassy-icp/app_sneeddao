---
name: sneed-names
description: Read and set Sneed DAO naming-service data on the Internet Computer - public names and avatars of principals (accounts that group a person's principals, plus canister names), public names of SNS neurons, private nicknames for principals and neurons, avatar images, NFT avatars, and the dapp registry. Use when a user or developer wants to look up who a principal or neuron is on Sneed Hub, set their own name or avatar, label principals or neurons privately, link their principals into one account, or name a canister they control.
license: MIT
metadata:
  publisher: Sneed DAO
  canister-pid-names: ejz7n-lyaaa-aaaad-qmkzq-cai
  canister-neuron-names: e46oa-kqaaa-aaaad-qmk2a-cai
  canister-pid-nicknames: e37iu-hiaaa-aaaad-qmk2q-cai
  canister-neuron-nicknames: es4di-raaaa-aaaad-qmk3a-cai
  canister-avatars: ev5f4-4yaaa-aaaad-qmk3q-cai
  canister-profiles: fytbs-tqaaa-aaaad-qmk4a-cai
  full-reference: https://app.sneeddao.com/api-docs/sneed_names.md
  source: https://github.com/Snassy-icp/app_sneeddao/tree/main/src
---

# Sneed naming service skill

Six canisters hold the names Sneed Hub shows. All are on production and Sneed Hub reads and writes them directly; the older naming methods of `app_sneeddao_backend` (`set_principal_name`, `set_neuron_name`, ...) are legacy: their data was imported into these canisters and the imports are closed. The backend stays the moderation authority (bans and the word blacklist), which the name canisters consult on every public name. Full reference: https://app.sneeddao.com/api-docs/sneed_names.md.

| Canister | Holds | Production | Staging |
|---|---|---|---|
| `sneed_pid_names` | public names and avatars of accounts and canisters, ICRC-3 log | `ejz7n-lyaaa-aaaad-qmkzq-cai` | `qechb-aiaaa-aaaad-ag6lq-cai` |
| `sneed_neuron_names` | public names of SNS neurons, ICRC-3 log | `e46oa-kqaaa-aaaad-qmk2a-cai` | `rjmdp-paaaa-aaaad-ag6ma-cai` |
| `sneed_pid_nicknames` | each user's private labels for principals | `e37iu-hiaaa-aaaad-qmk2q-cai` | `ronf3-cyaaa-aaaad-ag6mq-cai` |
| `sneed_neuron_nicknames` | each user's private labels for neurons | `es4di-raaaa-aaaad-qmk3a-cai` | `rhooh-uqaaa-aaaad-ag6na-cai` |
| `sneed_avatars` | avatar images (content-addressed) | `ev5f4-4yaaa-aaaad-qmk3q-cai` | `rapit-ziaaa-aaaad-ag6nq-cai` |
| `sneed_profiles` | dapp registry (the "dapp" labels of principals), ICRC-3 log | `fytbs-tqaaa-aaaad-qmk4a-cai` | `rviz6-yaaaa-aaaad-ag6oa-cai` |

Candid: `src/declarations/<canister>/<canister>.did` in the repo. Results are `variant { ok: text; err: text }` unless noted; errors are readable sentences.

## Core facts to keep straight

1. **Names are public; nicknames are private to the caller.** A public name (`sneed_pid_names`, `sneed_neuron_names`) is visible to everyone and written to an ICRC-3 log. A nickname is returned only to the principal that set it (`get_my_nicknames*` are caller-scoped) and has no public log, but it is not encrypted: canister controllers could read it. Never describe a nickname as secret, or a name as anonymous.
2. **Accounts, not principals.** In `sneed_pid_names` a person's account groups several principals (`members`, each `owner` or `member`, with an optional dapp label); every member shows the account's name. Self-authenticating principals get accounts; canister ids get canister names instead (set by a controller, or by the governance of the SNS whose root controls the canister).
3. **Name rules** (both public names and nicknames): 1 to 32 characters (canisters at least 2), letters a-z A-Z, digits, spaces, `-`, `_`, `.`, `'`; at least one letter or digit; no leading, trailing or double spaces. Unique ignoring capitals (`That name is taken`; neurons: unique per SNS). Public names also pass the backend moderator; if it does not answer, the name is refused (retry).
4. **Checkmark.** `verified` is true only while the stored verification matches the current name; renaming drops it. Verification comes from canister admins (`verify`), from Sneed DAO by proposal (`verify_by_dao`, a generic nervous system function with `validate_verify_by_dao`), and for neurons also from the neuron's own SNS (`verify_by_sns`).
5. **Hotkeys.** An owner may `add_hotkey(p)`: `p` can then manage the account and `merge_account` it into its own account. A hotkey is not shown as a member.
6. **Avatars** are `AvatarRef = variant { url: text; blob: blob }`: an `https://` link (max 512 chars) or the 32-byte SHA-256 of an image in `sneed_avatars`, served at `https://ev5f4-4yaaa-aaaad-qmk3q-cai.raw.icp0.io/<64 hex chars>`. Upload first with `sneed_avatars.upload(bytes)` (PNG, JPEG, GIF or WebP, at most 48 KiB, a limited number held per principal) → `ok(hash)`; `release(hash)` stops holding it. An image nobody holds is freed, and a name pointing at it shows no avatar.
7. **NFT avatars.** `set_my_nft_avatar(opt {collection; token_id})` shows an ICRC-7 NFT; the canister checks with `icrc7_owner_of` that one of the account's principals owns it (any subaccount). Clients must check ownership again when they display it (the NFT may have been sold): Sneed Hub does, and falls back to the account's other avatar. Anyone signed in may call `refresh_nft_avatar(account)` to clear one that changed hands.
8. **Batch reads**: `get_names` takes up to 500 keys and answers in order (`null` = nothing set). To mirror everything, page `changes_since({after; limit})` from `after = 0`, continuing with the last item's `seq` until empty.
9. **The anonymous principal cannot write.** Every setter needs a signed-in caller; the user signs in Sneed Hub (or their own agent identity). Never ask a user for keys or seed phrases.

## Procedures

### Look up who a principal is
`sneed_pid_names.get_name(p)` → `opt NameInfo {name, verified, avatar, nft_avatar, kind: account(id) | canister, dapp, run_by}` (query, anonymous is fine). Many at once: `get_names(vec principal)`. Full account: `get_account_of(p)` / `get_account(id)` → members, hotkeys, verification. Search: `search({prefix; kind: opt (account | canister); limit})`; directory: `list_names({start_after; limit})`.

### Look up a neuron's name
Key is `NeuronKey = {sns_root: principal; neuron_id: blob}`. `sneed_neuron_names.get_name(k)` / `get_names(vec k)`; per SNS: `list_by_sns({sns_root; start_after; limit})`, `search({sns_root; prefix; limit})`.

### Set your own name and avatar (in Sneed Hub: https://app.sneeddao.com/me)
`set_my_name(name)` (creates the account on first use; `""` clears). `set_my_avatar(opt AvatarRef)`. `set_my_nft_avatar(opt NftRef)`. For an account you manage as a hotkey: `set_account_name(id, name)`, `set_account_avatar(id, avatar)`; list them with `my_hotkey_accounts()`.

### Group principals into one account
- Hotkey and merge: from the account to be merged, `add_hotkey(P)`; then, as `P`, `merge_account(fromId)`. Its principals join P's account as members; if P's account had no name it takes the merged name and checkmark.
- Principals you cannot sign in with here (e.g. an NNS dapp principal that staked an SNS neuron you hold a permission on): `link_by_neuron(sns_root, neuron_id, memo, principal, dapp)`; the neuron id must be that principal's staking subaccount with `memo`.
- `set_member(principal, role, dapp)`, `remove_member(principal)`, `remove_hotkey(account, hotkey)`.

### Name a canister
As a controller (or the governance of the SNS controlling it): `set_canister_name(canister, name)`, `set_canister_avatar(canister, avatar)`, `set_canister_run_by(canister, opt accountId)` (you must also own that account).

### Name a neuron
`sneed_neuron_names.set_name(k, name)` needs a permission on the neuron (`That name is taken in this SNS` if used); `set_avatar(k, avatar)`.

### Private nicknames (in Sneed Hub: https://app.sneeddao.com/names)
Principals: `sneed_pid_nicknames.set_nickname(target, text)` (`""` removes), `set_nickname_avatar`, `get_my_nicknames({start_after; limit})` (500 a page), `get_my_nicknames_for(vec principal)`, `search_my_nicknames(prefix, limit)`, `my_nickname_count()` → `{count; max_free; max_premium}` (Sneed Premium members may keep more). Neurons: the same methods on `sneed_neuron_nicknames` with `NeuronKey` targets.

### Dapp registry (sneed_profiles)
`list_dapps({start_after; limit})`, `get_dapps(vec id)`, `search_dapps(prefix, limit)`. `register_dapp({name; url; logo; canisters})` → `ok(id)` as a controller of at least one listed canister (or the governance of the SNS that controls one); `update_dapp(id, input)` (a new name loses the checkmark). Members of an account use the id as their `dapp` label. No public Sneed Hub page registers dapps yet.

### Audit (ICRC-3)
`sneed_pid_names`, `sneed_neuron_names` and `sneed_profiles` log every change as ICRC-3 blocks: `icrc3_log_status`, `icrc3_get_blocks`, `icrc3_get_archives`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`. Text logs: `get_log(start, length)`.

## Minimal JavaScript setup

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory } from './sneed_pid_names.did.js'; // generate from the .did with didc or dfx
const agent = new HttpAgent({ host: 'https://icp-api.io' }); // anonymous is enough for reads
const names = Actor.createActor(idlFactory, { agent, canisterId: 'ejz7n-lyaaa-aaaad-qmkzq-cai' });
const [info] = await names.get_name(Principal.fromText('<principal>')); // undefined = no name
```

## dfx examples

```bash
dfx canister --network ic --identity anonymous call ejz7n-lyaaa-aaaad-qmkzq-cai get_name '(principal "<principal>")' --query
dfx canister --network ic --identity anonymous call ejz7n-lyaaa-aaaad-qmkzq-cai search '(record { prefix = "sneed"; kind = null; limit = 10 : nat })' --query
dfx canister --network ic --identity anonymous call e46oa-kqaaa-aaaad-qmk2a-cai list_by_sns '(record { sns_root = principal "fp274-iaaaa-aaaaq-aacha-cai"; start_after = null; limit = 50 : nat })' --query
```

## Reference implementation

`src/app_sneeddao_frontend/src/utils/NamingService.js` (every call above, the name mirror, avatar URLs), `src/utils/nftAvatars.js` (display-time NFT ownership check), `src/components/AccountPanel.jsx` (hotkeys and merging), pages `/me` and `/names`, under https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend. Canister sources: `src/sneed_pid_names`, `src/sneed_neuron_names`, `src/sneed_pid_nicknames`, `src/sneed_neuron_nicknames`, `src/sneed_avatars`, `src/sneed_profiles`, shared rules in `src/sneed_names`.
