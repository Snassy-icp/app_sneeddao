# Sneed Names: the naming service API

Sneed Names is the naming service of Sneed DAO on the Internet Computer. It gives people one public name for all of their principals, names canisters and SNS neurons, lets every user keep their own nicknames for others, stores avatar images, and keeps a registry of dapps. Any dapp can look up its users' names, checkmarks and avatars with one batched query call, and any wallet or script can set names for its users: the canisters authorise calls by the calling principal only.

The service is six canisters. All of them are controlled by the Sneed SNS (root `fp274-iaaaa-aaaaq-aacha-cai`) on production; upgrades are decided by Sneed DAO proposals.

| Canister | What it holds | Production | Staging | Candid |
|---|---|---|---|---|
| `sneed_pid_names` | Accounts (a name, checkmark and avatar shared by several principals), hotkeys, canister names, the search index | `ejz7n-lyaaa-aaaad-qmkzq-cai` | `qechb-aiaaa-aaaad-ag6lq-cai` | [.did](/api-docs/sneed_pid_names.did) · [.did.js](/api-docs/sneed_pid_names.did.js) |
| `sneed_neuron_names` | Public names of SNS neurons, unique per SNS | `e46oa-kqaaa-aaaad-qmk2a-cai` | `rjmdp-paaaa-aaaad-ag6ma-cai` | [.did](/api-docs/sneed_neuron_names.did) · [.did.js](/api-docs/sneed_neuron_names.did.js) |
| `sneed_pid_nicknames` | Each user's own labels for principals | `e37iu-hiaaa-aaaad-qmk2q-cai` | `ronf3-cyaaa-aaaad-ag6mq-cai` | [.did](/api-docs/sneed_pid_nicknames.did) · [.did.js](/api-docs/sneed_pid_nicknames.did.js) |
| `sneed_neuron_nicknames` | Each user's own labels for SNS neurons | `es4di-raaaa-aaaad-qmk3a-cai` | `rhooh-uqaaa-aaaad-ag6na-cai` | [.did](/api-docs/sneed_neuron_nicknames.did) · [.did.js](/api-docs/sneed_neuron_nicknames.did.js) |
| `sneed_profiles` | The dapp registry ("this principal is me on TACO") | `fytbs-tqaaa-aaaad-qmk4a-cai` | `rviz6-yaaaa-aaaad-ag6oa-cai` | [.did](/api-docs/sneed_profiles.did) · [.did.js](/api-docs/sneed_profiles.did.js) |
| `sneed_avatars` | Avatar images, content-addressed by SHA-256, served over HTTP | `ev5f4-4yaaa-aaaad-qmk3q-cai` | `rapit-ziaaa-aaaad-ag6nq-cai` | [.did](/api-docs/sneed_avatars.did) · [.did.js](/api-docs/sneed_avatars.did.js) |

| | |
|---|---|
| All IDL factories in one module | [sneed_names.did.js](/api-docs/sneed_names.did.js) (re-exports `pidNamesIdlFactory`, `neuronNamesIdlFactory`, `pidNicknamesIdlFactory`, `neuronNicknamesIdlFactory`, `profilesIdlFactory`, `avatarsIdlFactory`) |
| Source | [src/sneed_pid_names](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_pid_names) · [src/sneed_neuron_names](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_neuron_names) · [src/sneed_pid_nicknames](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_pid_nicknames) · [src/sneed_neuron_nicknames](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_neuron_nicknames) · [src/sneed_profiles](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_profiles) · [src/sneed_avatars](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_avatars) · shared modules [src/sneed_names](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_names) |
| Design | [spec/sneed_names.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/sneed_names.md) |
| Reference frontend | [app.sneeddao.com](https://app.sneeddao.com) (client code: [utils/NamingService.js](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/utils/NamingService.js)) |
| This document | [rendered](/api/sneed_names) · [raw Markdown](/api-docs/sneed_names.md) |

Staging runs the same code with its own state (and its own admins); use it to test. The method set below matches the source on `main` and the interfaces the production canisters publish.

**Where names lived before.** Names, nicknames and avatars used to live in the Sneed backend (`g7s5u-tqaaa-aaaad-qhktq-cai`). They were imported into these canisters (every import is closed), and the backend's naming writes are frozen: they answer `Names are moving to the new naming service; please try again shortly`. The backend's naming queries still answer from the frozen copy for old clients, but that copy no longer changes. New integrations use the canisters on this page.

**Short guide for agents.** Each of the six canisters answers `get_api_doc : () -> (text) query` with a compact Markdown guide to that canister (units and encoding, authentication, fees and irreversible actions, polling, common pitfalls) that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 Accounts, members and hotkeys

Internet Identity gives the same person a different principal on every dapp. So in `sneed_pid_names` a name belongs to an **account**, not to a principal, and a person links their principals to the account. Every member principal then shows the account's name, checkmark and avatar.

| Term | Meaning |
|---|---|
| **Account** | `AccountId` (a `nat`, never reused) with an optional name, a checkmark (verification), an avatar, an NFT avatar, members and hotkeys. Created automatically by the first write that needs it (`set_my_name`, `set_my_avatar`, `add_hotkey`, …). |
| **Member** | A principal in the account, with a `role` (`owner` or `member`), an optional `dapp` label (a `sneed_profiles` dapp id: "this principal is me on TACO"), `linked_at` and `via` (how it joined, see `LinkProof`). A principal is in at most one account. At most `max_members` (50) per account. |
| **Owner** | A member with `role = owner`. Owners rename the account, change its avatar, add hotkeys, change roles. The last owner cannot leave while other members remain. |
| **Hotkey** | A principal that may *manage* the account without being one of its principals: rename it, change its avatar, set members' dapp labels, remove non-owner members, and **merge the account into its own account**. Hotkeys cannot add or remove other hotkeys or remove owners. At most `max_hotkeys` (10) per account. Hotkeys are shown only to the account's owners, its hotkeys and admins. |

How a principal joins an account:

1. **Hotkey and merge** (the usual way). On the dapp where the principal lives (say TACO), the user calls `add_hotkey(main_principal)`. That creates a one-member account for the TACO principal if needed. Then, signed in with the main principal, they call `merge_account(taco_account_id)`: every member of the TACO account joins the main account as a `member` (with `via = hotkey`) and the TACO account is deleted. The hotkey needs to do nothing to accept.
2. **Neuron stake proof** (`link_by_neuron`), for principals the user cannot sign in with here, such as an NNS dapp principal: if that principal staked an SNS neuron and gave the caller a permission on it, the neuron id itself proves who staked it (section 3.3).

An account that has nothing left to show (no name, no avatar, no NFT avatar, at most one member and no hotkeys) is deleted automatically after the change that emptied it.

### 1.2 Names

The same rules apply to every public name and nickname (`src/sneed_names/NameRules.mo`):

- 1 to 32 characters (canister names: at least 2).
- Only ASCII letters `a-z A-Z`, digits, spaces, `-`, `_`, `.` and `'`; at least one letter or digit.
- No leading or trailing space, no two spaces in a row.
- **Unique regardless of capitals**: "Diavolo" and "diavolo" cannot both exist. In `sneed_pid_names` accounts and canisters share one name space. Neuron names are unique per SNS.

A refused name comes back as `#err` with the reason in words a user can act on, for example `Name must be at most 32 characters`, `Names may contain only letters a-z, digits, spaces, hyphens, underscores, dots and apostrophes`, `Names may not start or end with a space`, `Names may not contain two spaces in a row`, `Names must contain at least one letter or digit`, `That name is taken` (`That name is taken in this SNS` for neurons).

Setting a name to `""` clears it.

### 1.3 Checkmarks (verification)

A checkmark belongs to the exact name it was given for: `Verification = { name; source; at }`, and `verified` is true only while the current name equals `verification.name`. A rename clears it. Checkmarks are given by the canister's admins, by a Sneed DAO proposal (`verify_by_dao`, a generic nervous system function), and for neuron names also by the governance canister of the neuron's own SNS (`verify_by_sns`). Imported names kept the backend's verified flag as `source = import`.

### 1.4 Moderation

The Sneed backend (`g7s5u-tqaaa-aaaad-qhktq-cai`) stays the moderation authority: before a public name, canister name, neuron name, dapp name or nickname is stored, the canister asks the backend's `names_moderate`. Integrators should know what that means for their users:

- A **banned** principal cannot set names or nicknames: `You are banned` or `You are banned. Ban expires in …`.
- A **public** name (account, canister, neuron or dapp name) containing a word on the blacklist is refused **and the user is banned automatically**: `Name contains inappropriate content. You have been banned.` A nickname with such a word is only refused: `Name contains inappropriate content`.
- When the backend cannot be reached the write is refused, never stored unchecked: `The name check is unavailable right now, please try again (…)`. Retry later.

Admins can clear abusive avatars and names; `sneed_avatars` admins can remove an image for good.

### 1.5 Nicknames: unpublished, not secret

A nickname is one user's own label for a principal or a neuron, with an optional avatar. The nickname canisters answer only the caller's own nicknames: there is no method that returns someone else's, and there is no public log. They are stored unencrypted on a public network, though, so treat them as unpublished, not as secret: do not let users put anything in a nickname they could not bear to see public.

Limits: 10 nicknames per user, 100 with [Sneed Premium](/api/sneed_premium) (`my_nickname_count()` tells the caller theirs). Nicknames follow the name rules of 1.2 but need not be unique.

### 1.6 Avatars

An avatar is an `AvatarRef`:

```candid
type AvatarRef = variant { url : text; blob : blob };
```

- `url`: an `https://` link, at most 512 characters.
- `blob`: the 32-byte SHA-256 of an image stored in `sneed_avatars`. Upload the bytes with `sneed_avatars.upload` first; it answers the hash. The image is served at `https://<sneed_avatars id>.raw.icp0.io/<64 hex characters of the hash>` (production: `https://ev5f4-4yaaa-aaaad-qmk3q-cai.raw.icp0.io/<hex>`).

Images are PNG, JPEG, GIF or WebP (the type is read from the bytes, not trusted from the client), at most 48 KiB, and each image is stored once however many people use it. Each principal **holds** the images it uploaded, at most 20 (200 with Sneed Premium); an image nobody holds any more is freed, and a name record that points at a freed image simply shows no avatar.

### 1.7 NFT avatars (ICRC-7)

An account may also show an ICRC-7 NFT as its avatar (`nft_avatar`). `set_my_nft_avatar({ collection; token_id })` asks the collection's `icrc7_owner_of` and accepts the NFT only if its owner (in any subaccount) is one of the account's member principals. It records `{ collection; token_id; owner; set_at }`, where `owner` is the member that owned it.

NFTs change hands, so **clients must check again when they show it**: call `icrc7_owner_of([token_id])` on the collection and show the NFT only while `owner` still owns it; otherwise (or when the collection does not answer) show the account's ordinary `avatar`. The ordinary avatar is kept while an NFT avatar is set, for exactly this case. Anyone signed in can also call `refresh_nft_avatar(account)`, which clears an NFT avatar that changed hands. The reference client does this in [utils/nftAvatars.js](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_frontend/src/utils/nftAvatars.js) (unsigned query calls, one batch per collection, 10-minute cache).

### 1.8 Canister names

Canisters cannot own accounts. A canister is named by a controller with `set_canister_name`; the canister checks control with the management canister's `canister_info`, so it works for any canister. The governance canister of a deployed SNS may also name canisters whose controllers include that SNS's root. A canister name may say which account runs the canister (`run_by`, shown as "Trading Bot · run by …"). When a different controller renames the canister, the old `run_by` claim is cleared.

### 1.9 Neuron names

`sneed_neuron_names` names SNS neurons, keyed by `NeuronKey = { sns_root; neuron_id }` (the id is the neuron's subaccount bytes, 1 to 64 bytes). Anyone with any permission on the neuron, according to the SNS's governance canister, may name it. The SNS root is trusted only when SNS-W (`qaa6y-5yaaa-aaaaa-aaafa-cai`) lists it as a deployed SNS, so a made-up root cannot vouch for made-up neurons.

### 1.10 Time, paging and batches

- Timestamps are `nat64` nanoseconds since the Unix epoch (`created_at`, `updated_at`, `linked_at`, `set_at`, `Verification.at`). The text log's `ts` is an `int` in the same unit.
- Batched lookups take at most 500 keys (`get_names`, `get_my_nicknames_for`, `get_dapps`, `get_info`) and trap above that; `get_images` takes at most 20.
- Pages are `{ start_after : opt K; limit : nat }` in and `{ items; next : opt K }` out. Pass `next` back as `start_after` until it is null. `limit` is capped at 500. Search results are capped at 50.

### 1.11 Public, not anonymous

Names, accounts with their member principals, canister names, neuron names and the dapp registry are public, and every change to them is a block in a public ICRC-3 log (section 6). Linking principals into one account tells everyone they belong together; make that clear to users before they merge.

### 1.12 Calls the canisters refuse at ingress

Every naming canister checks update calls from outside the IC before accepting them (`inspect_message`; a refused call costs nothing):

- Query methods only answer query calls. Calling one as an update call is refused.
- The anonymous principal cannot make update calls.
- Arguments are capped: 4 KiB for most calls, about 6 KiB for calls that carry an avatar link, 64 KiB for `sneed_avatars.upload`.
- `admin_*`, `verify` and `unverify` calls are refused unless the caller is an admin; `verify_by_dao`, `unverify_by_dao`, `verify_by_sns`, `unverify_by_sns` and `verify_dapp_by_dao` are never accepted by ingress (governance canisters call them).

Canisters calling the naming service are not affected.

---

## 2. Quick start

### 2.1 Create actors

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import {
  pidNamesIdlFactory, neuronNamesIdlFactory, pidNicknamesIdlFactory,
  neuronNicknamesIdlFactory, profilesIdlFactory, avatarsIdlFactory,
} from './sneed_names.did.js'; // https://app.sneeddao.com/api-docs/sneed_names.did.js (imports the six .did.js files next to it)

export const NAMES = {
  pidNames: 'ejz7n-lyaaa-aaaad-qmkzq-cai',
  neuronNames: 'e46oa-kqaaa-aaaad-qmk2a-cai',
  pidNicknames: 'e37iu-hiaaa-aaaad-qmk2q-cai',
  neuronNicknames: 'es4di-raaaa-aaaad-qmk3a-cai',
  profiles: 'fytbs-tqaaa-aaaad-qmk4a-cai',
  avatars: 'ev5f4-4yaaa-aaaad-qmk3q-cai',
};

export function namesActors(identity /* optional: reads work without one */) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  const mk = (idl, id) => Actor.createActor(idl, { agent, canisterId: id });
  return {
    pidNames: mk(pidNamesIdlFactory, NAMES.pidNames),
    neuronNames: mk(neuronNamesIdlFactory, NAMES.neuronNames),
    pidNicknames: mk(pidNicknamesIdlFactory, NAMES.pidNicknames),
    neuronNicknames: mk(neuronNicknamesIdlFactory, NAMES.neuronNicknames),
    profiles: mk(profilesIdlFactory, NAMES.profiles),
    avatars: mk(avatarsIdlFactory, NAMES.avatars),
  };
}
```

With dfx:

```bash
dfx canister --network ic call ejz7n-lyaaa-aaaad-qmkzq-cai get_name '(principal "aaaaa-aa")' --query
```

### 2.2 Show names for a list of principals

One query call for up to 500 principals. `null` means the principal has no name and no avatar.

```js
const AVATARS_HTTP = `https://${NAMES.avatars}.raw.icp0.io`;
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function avatarUrl(avatarOpt) {           // AvatarRef from Candid: [] or [{ url } | { blob }]
  const a = avatarOpt?.[0];
  if (!a) return null;
  if ('url' in a) return a.url;
  return `${AVATARS_HTTP}/${hex(a.blob)}`;
}

export async function namesFor(principals) {
  const { pidNames } = namesActors();
  const infos = await pidNames.get_names(principals); // vec opt NameInfo, same order
  return principals.map((p, i) => {
    const info = infos[i][0];
    if (!info) return { principal: p, name: null };
    return {
      principal: p,
      name: info.name[0] ?? null,                  // an account may have only an avatar
      verified: info.verified,
      avatar: avatarUrl(info.avatar),
      nftAvatar: info.nft_avatar[0] ?? null,       // check ownership before showing (1.7)
      kind: 'account' in info.kind ? 'account' : 'canister',
      runBy: info.run_by[0]?.name[0] ?? null,      // canisters only
    };
  });
}
```

Combine with the caller's own nicknames when signed in (show the nickname first, the public name second, as the reference app does):

```js
const nicks = await namesActors(identity).pidNicknames.get_my_nicknames_for(principals); // vec opt Nickname
```

### 2.3 Search as you type

```js
const hits = await namesActors().pidNames.search({ prefix: 'snee', limit: 20n, kind: [] });
// kind: [] = accounts and canisters, [{ account: null }] or [{ canister: null }] to filter
for (const h of hits) {
  const target = 'account' in h.target
    ? h.target.account.members.map((m) => m.principal.toText()) // first 10 members
    : [h.target.canister.toText()];
  console.log(h.name, h.verified, target);
}
```

A search returns the names that start with the prefix first, then names with a later word starting with it ("whale" finds "Sneed Whale"). Capitals do not matter; a trailing space is kept ("sneed " finds "Sneed Whale" but not "Sneedy").

### 2.4 Set the caller's name

```js
const r = await namesActors(identity).pidNames.set_my_name('Sneed Whale');
if ('err' in r) throw new Error(r.err);    // e.g. "That name is taken"
console.log(r.ok);                          // "Name set", "Name cleared" or "Unchanged"
```

---

## 3. Flows in detail

### 3.1 One name for several principals (hotkey, then merge)

```js
// 1. Signed in on the other dapp (its principal P2): let the main principal P1 manage this account.
await pidNamesAs(identityP2).add_hotkey(P1);            // creates P2's account if needed

// 2. Signed in as P1: find the account and merge it in.
const [acc] = await pidNamesAs(identityP1).get_account_of(P2); // opt AccountView
const r = await pidNamesAs(identityP1).merge_account(acc.id);
if ('err' in r) throw new Error(r.err);
```

`merge_account(from)` rules, from the source:

- The caller must manage `from` (in practice: be its hotkey) and must not already be in it (`You are in that account already`).
- If the caller is in an account, it must be an owner of it (`Only owners can merge into their account`); otherwise an account is created for the caller.
- The members of `from` join as `member` (`via = hotkey`), keeping their dapp labels. Together the accounts may have at most `max_members` principals.
- If the caller's account has no name it takes the merged account's name (with its checkmark); otherwise the merged name is freed. If it has no avatar it takes the merged account's avatar. The merged account, its hotkeys and its NFT avatar are deleted. The log records a carried-over checkmark and avatar as `verify` and `avatar_set` blocks for the caller's account (with `merged_from`).

Instead of merging, a hotkey can also just manage the other account: `set_account_name`, `set_account_avatar`, `set_member` (dapp labels), `remove_member` (non-owners). `my_hotkey_accounts()` lists the accounts the caller holds a hotkey on.

### 3.2 Leaving, removing and roles

- `remove_member(p)`: a principal may always leave its account; owners and hotkeys may remove others, but only owners remove owners. The last owner cannot go while other members remain (`Make another principal an owner first`). The account is deleted when its last principal leaves.
- `set_member(p, role, dapp)`: owners change roles and dapp labels; hotkeys and the member itself may change only the dapp label. An account always keeps one owner (`An account needs an owner`).
- `remove_hotkey(account, hotkey)`: owners remove a hotkey; a hotkey may remove itself.

### 3.3 Linking a principal you cannot sign in with (neuron stake proof)

`link_by_neuron(sns_root, neuron_id, memo, principal, dapp)` links `principal` into the caller's account when:

- `neuron_id` equals the staking subaccount of `principal` with `memo`: SHA-256 of `0x0c ‖ "neuron-stake" ‖ principal bytes ‖ memo as 8 big-endian bytes`. Only `principal` can create a neuron with that id, so it proves `principal` staked it.
- `sns_root` is a deployed SNS (per SNS-W), the neuron exists there, `principal` still holds `ManagePrincipals` (permission 2) on it, and the caller has some permission on it.
- `principal` is a person's principal (not a canister), not the caller, and not in any account yet.

Errors: `That neuron was not staked by that principal with that memo`, `Not a deployed SNS`, `No such neuron in that SNS`, `That principal no longer manages the neuron`, `You have no permission on that neuron`, `That principal is already in an account; it can leave it first`, `The account is full`.

### 3.4 Naming a canister

```js
await pidNames.set_canister_name(canisterId, 'Trading Bot');   // caller is a controller
await pidNames.set_canister_avatar(canisterId, [{ url: 'https://example.com/bot.png' }]);
await pidNames.set_canister_run_by(canisterId, [myAccountId]);  // caller also owns that account
```

`set_canister_avatar` and `set_canister_run_by` need the canister to be named first (`Name the canister first`). Errors from the control check: `Could not read the canister's controllers: …`, `You are not a controller of this canister`. An SNS names its canisters through a proposal that makes its governance canister call `set_canister_name`.

### 3.5 Naming a neuron

```js
const key = { sns_root: Principal.fromText(SNS_ROOT), neuron_id: neuronIdBytes }; // the neuron's id blob
const r = await neuronNames.set_name(key, 'Whale Fund');
// errors: "Not a neuron id", "That name is taken in this SNS", "Not a deployed SNS",
//         "No such neuron in that SNS", "You have no permission on that neuron"
await neuronNames.set_avatar(key, [{ blob: hashFromUpload }]);  // after the name exists
```

Look up names with `get_names(vec NeuronKey)` (up to 500), list an SNS alphabetically with `list_by_sns`, search one SNS with `search({ sns_root; prefix; limit })`.

### 3.6 Uploading an avatar image

```js
const bytes = new Uint8Array(await file.arrayBuffer());      // PNG/JPEG/GIF/WebP, <= 48 KiB
const r = await avatars.upload(bytes);
if ('err' in r) throw new Error(r.err);
const hash = r.ok;                                            // 32-byte SHA-256
await pidNames.set_my_avatar([{ blob: hash }]);
```

`upload` errors: `Please sign in`, `Images may be at most 48 KiB`, `Only PNG, JPEG, GIF and WebP images`, `This image was removed` (an admin removed it; it can never be stored again), `You hold N images already; release one first` (with ` (Sneed Premium holds more)` for non-premium users). Uploading an image that is already stored just makes the caller a holder of it. `release(hash)` stops holding it; `my_images()` lists what the caller holds.

### 3.7 NFT avatar

```js
const r = await pidNames.set_my_nft_avatar([{ collection: Principal.fromText(COLLECTION), token_id: 42n }]);
// errors: "The collection must be a canister", "That token does not exist in the collection",
//         "The collection did not answer: …",
//         "You do not own that NFT (its owner is not one of your account's principals)"
await pidNames.set_my_nft_avatar([]);  // stop showing it
```

Then, when displaying any account's `nft_avatar`, re-check ownership (1.7).

### 3.8 Nicknames

```js
await pidNicknames.set_nickname(target, 'Alice from the forum');  // "" removes it
await pidNicknames.set_nickname_avatar(target, [{ url: 'https://…' }]); // needs a nickname first
const page = await pidNicknames.get_my_nicknames({ start_after: [], limit: 500n }); // usually all of them
const found = await pidNicknames.search_my_nicknames('ali', 10n);
```

`set_nickname` errors: the name rules (1.2), the moderation answers (1.4), `You have reached the maximum number of nicknames (10). Get Sneed Premium for more!`, `You have reached the maximum number of nicknames (100)`. `sneed_neuron_nicknames` works the same with `NeuronKey` targets (and `Not a neuron id` for an empty or over-64-byte id).

### 3.9 Registering a dapp (dapp labels)

A member's `dapp` label refers to a dapp in `sneed_profiles`. A controller of at least one of the dapp's canisters (or the governance of an SNS that controls one) registers it:

```js
const r = await profiles.register_dapp({
  name: 'TACO', url: 'https://tacodao.com', logo: [], canisters: [Principal.fromText(TACO_CANISTER)],
});
const dappId = r.ok;   // then: pidNames.set_member(myTacoPrincipal, { member: null }, [dappId])
```

Rules: the name follows 1.2 and is unique regardless of capitals (`A dapp with that name is registered`); `url` starts with `https://` and has at most 200 characters; 1 to 10 canister ids. `update_dapp` follows the same rules, and the caller must also control one of the dapp's *current* canisters (or be an admin); a new name loses the checkmark, and so does adding a canister unless an admin adds it (removing canisters or changing the url or logo keeps it). Errors include `You must control at least one of the dapp's canisters`, `You must control at least one of the dapp's current canisters` and `The dapp was changed meanwhile; please try again`. Hidden dapps (hidden by an admin) are left out of `list_dapps` and `search_dapps`, and `get_dapps` returns them with `hidden = true`.

### 3.10 Keeping a copy in sync (`changes_since`)

`sneed_pid_names` and `sneed_neuron_names` keep a changes feed: every account, canister name or neuron name that changed, once, with its current state, ordered by a sequence number. A mirror or indexer pages through it:

```js
let after = 0n;            // persist this
for (;;) {
  const { items, last_seq } = await pidNames.changes_since({ after, limit: 500n });
  for (const c of items) {
    // c.ref: { account: id } | { canister: principal }; c.state: [] when deleted
    upsertOrDelete(c.ref, c.state[0]);
    after = c.seq;
  }
  if (items.length === 0 || after >= last_seq) break;
}
```

An entity appears once, at its latest change; it moves to the end of the feed each time it changes. Hotkeys are never included in the feed's account views.

---

## 4. Errors, retries and result shapes

- **Result shapes.** Writes return `Result = variant { ok : text; err : text }`; the `ok` text says what happened (`Name set`, `Unchanged`, `Merged`, …). `sneed_profiles.register_dapp` returns `variant { ok : nat; err : text }` (the dapp id), `sneed_avatars.upload` returns `variant { ok : blob; err : text }` (the hash). ICRC-3 admin methods use `Ok`/`Err`. Always branch on the variant.
- **Traps.** Batched queries trap above their limit (`At most 500 principals per call`, …). Admin-only queries (`get_log`) trap for others. A trap means nothing changed.
- **Signed in.** Every write refuses the anonymous principal (`Please sign in`). Canister callers cannot own accounts (`Canisters cannot own accounts`, `Canisters are named by their controllers (set_canister_name)`, `Canisters use set_canister_avatar`).
- **Awaits.** Name writes call the moderator, and some call the management canister, SNS-W, an SNS governance canister or an ICRC-7 collection. The canisters re-check their state after each such call (a name taken meanwhile gives `That name is taken`), so a client needs no compensation logic: re-read and retry.
- **Idempotency.** Setting the current value again answers `Unchanged` or `Already a hotkey`. Retrying a timed-out write is safe; check the state first if the answer matters.
- **Moderator unavailable.** `The name check is unavailable right now, please try again (…)`: retry later.

---

## 5. Method reference

"Caller" is the principal signing the call. Methods marked *query* can be called without a signature unless noted. Argument names are the Candid ones.

### 5.1 `sneed_pid_names`: reads (queries)

| Method | Returns | Notes |
|---|---|---|
| `get_names(principals : vec principal)` | `vec opt NameInfo` | Up to 500, in order. A member principal gets its account's name, checkmark, avatars and its own `dapp` label; a canister its canister name and `run_by`. |
| `get_name(p)` | `opt NameInfo` | One principal. |
| `search({ prefix; limit; kind : opt variant { account; canister } })` | `vec SearchHit` | Names starting with `prefix`, then names with a later word starting with it. At most 50. Account hits carry the first 10 members. |
| `list_names(Page)` | `{ items : vec SearchHit; next : opt text }` | All names, alphabetical by lowercase name, `start_after` is a lowercase name. |
| `get_account(id)` | `opt AccountView` | Hotkeys are filled in only when the caller is an owner, a hotkey or an admin of the account. |
| `get_account_of(p)` | `opt AccountView` | The account `p` is a member of. Same hotkey rule. |
| `my_hotkey_accounts()` | `vec AccountView` | The accounts the caller holds a hotkey on. |
| `get_canister_name(p)` | `opt CanisterView` | |
| `changes_since({ after; limit })` | `{ items : vec Change; last_seq : nat }` | See 3.10. |
| `stats()` | `Stats` | `accounts`, `named`, `canisters`, `last_seq`, `log_length`, `import_closed`. |
| `get_config()` | `Config` | `max_members`, `max_hotkeys`, `moderator`, `dao_governance`, `sns_wasm`, `archive_controllers`. |
| `get_admins()` | `vec principal` | The admin list (controllers are admins too). |
| `get_log(start, length)` | `vec LogEntry` | Admins only (traps otherwise). Operational text log, last 2,000 entries, at most 500 per call. |

### 5.2 `sneed_pid_names`: your account (updates)

**`set_my_name(name : text) → Result`**
Sets (or with `""` clears) the name of the caller's account; creates the account on first use. Only owners rename (`Only the account's owners can rename it`). Errors: name rules, `That name is taken`, moderation answers. `ok`: `Name set`, `Name cleared`, `Unchanged`.

**`set_my_avatar(avatar : opt AvatarRef) → Result`**
Owners only. Errors: `Avatar link too long (max 512 characters)`, `Avatar links must start with https://`, `An avatar image is referenced by its 32-byte SHA-256`, `Only the account's owners can change its avatar`. Avatars are not moderated by text; admins can clear them.

**`set_my_nft_avatar(nft : opt NftRef) → Result`**
See 1.7 and 3.7. Owners only. `[]` stops showing it (`NFT avatar cleared`).

**`refresh_nft_avatar(account : AccountId) → Result`**
Anyone signed in. Asks the collection; clears the NFT avatar if it changed hands or is gone. `ok`: `No NFT avatar`, `Still owned`, `Cleared: the NFT changed hands`. `err`: the collection's failure (`The collection did not answer: …`).

**`add_hotkey(hotkey : principal) → Result`**
Owners only; creates the caller's account if needed. Errors: `Not a principal`, `That is you`, `That principal is already in this account`, `At most N hotkeys per account`. `ok`: `Hotkey added`, `Already a hotkey`.

**`remove_hotkey(account : AccountId, hotkey : principal) → Result`**
Owners, or the hotkey itself. Errors: `No such account`, `Only the account's owners can remove hotkeys`, `Not a hotkey of this account`.

**`set_account_name(account : AccountId, name : text) → Result`**, **`set_account_avatar(account : AccountId, avatar : opt AvatarRef) → Result`**
Rename or change the avatar of an account the caller owns or holds a hotkey on (`You do not manage this account`, `No such account`).

**`merge_account(from : AccountId) → Result`**
See 3.1. Errors: `No such account`, `You need a hotkey on that account`, `You are in that account already`, `Only owners can merge into their account`, `Together the accounts would have more than N principals`. `ok`: `Merged`.

**`link_by_neuron(sns_root : principal, neuron_id : blob, memo : nat64, principal : principal, dapp : opt DappId) → Result`**
See 3.3. Also `Only people's principals can join an account`, `You are already in your account`, `Only the account's owners can link principals`.

**`remove_member(principal : principal) → Result`**
See 3.2. Errors: `That principal is not in an account`, `You do not manage this account`, `Only owners can remove owners`, `Make another principal an owner first`. `ok`: `Left the account` or `Removed`.

**`set_member(principal : principal, role : Role, dapp : opt DappId) → Result`**
See 3.2. Errors: `Only the account's owners can change roles`, `You do not manage this account`, `An account needs an owner`. The dapp id is not checked against `sneed_profiles`.

### 5.3 `sneed_pid_names`: canister names (updates)

| Method | Notes |
|---|---|
| `set_canister_name(canister, name)` | Caller controls the canister (1.8). Name rules with a minimum of 2 characters; `Not a canister id`. `""` clears. |
| `set_canister_avatar(canister, avatar : opt AvatarRef)` | Caller controls the canister; it must be named. |
| `set_canister_run_by(canister, account : opt AccountId)` | Caller controls the canister and owns the account (`You can only name accounts you own`); it must be named. `[]` clears. |

### 5.4 `sneed_pid_names`: verification

| Method | Who | Notes |
|---|---|---|
| `verify(principal, expected_name)` | admins | Checkmark for the account or canister of `principal`, only if its name is exactly `expected_name` (`The name is not …`, `That principal has no name`). |
| `unverify(principal)` | admins | `Not verified` if there is none. |
| `verify_by_dao(principal, expected_name)` / `unverify_by_dao(principal)` | Sneed DAO governance (`fi3zi-fyaaa-aaaaq-aachq-cai`) | Generic nervous system function targets; trap on error. |
| `validate_verify_by_dao(...)` / `validate_unverify_by_dao(...)` | anyone (query) | The validators for those proposals: `variant { Ok : text; Err : text }`. |

### 5.5 `sneed_neuron_names`

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `get_names(keys : vec NeuronKey)` | query | `vec opt NeuronNameInfo` | Up to 500: `{ name; verified; avatar }`. |
| `get_name(k)` | query | `opt NeuronNameView` | With `verification`, `set_by`, `updated_at`. |
| `search({ sns_root; prefix; limit })` | query | `vec NeuronNameView` | One SNS, at most 50. |
| `list_by_sns({ sns_root; start_after : opt text; limit })` | query | `{ items : vec NeuronNameView; next : opt text }` | One SNS, alphabetical. |
| `changes_since({ after; limit })` | query | `{ items : vec Change; last_seq : nat }` | `Change = { seq; key : NeuronKey; state : opt NeuronNameView }`. |
| `stats()` | query | `Stats` | `names`, `snses`, `last_seq`, `log_length`, `import_closed`. |
| `get_config()`, `get_admins()` | query | | `get_log(start, length)` for admins. |
| `set_name(k, name)` | update | `Result` | See 3.5. Admins may name any neuron without the SNS check. `ok`: `Name set`, `Name removed`, `Unchanged`. |
| `set_avatar(k, avatar : opt AvatarRef)` | update | `Result` | Same permission; the neuron must be named (`Name the neuron first`). |
| `verify(k, expected_name)`, `unverify(k)` | update | `Result` | Admins. |
| `verify_by_sns(k, expected_name)`, `unverify_by_sns(k)` | update | `Result` | Only the governance canister of `k.sns_root` (`Only the governance canister of that SNS`, `Not a deployed SNS`): an SNS verifies names of its own neurons by proposal. |
| `verify_by_dao`, `unverify_by_dao`, `validate_verify_by_dao`, `validate_unverify_by_dao` | | | As in 5.4, for neurons. |

### 5.6 `sneed_pid_nicknames` and `sneed_neuron_nicknames`

The two canisters have the same methods; the target is a `principal` in `sneed_pid_nicknames` and a `NeuronKey` in `sneed_neuron_nicknames`. Everything is scoped to the caller.

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `get_my_nicknames(page : Page)` | query | `{ items : vec Nickname; next : opt Target }` | 500 a page, usually all of them in one call. Signed query. |
| `get_my_nicknames_for(targets : vec Target)` | query | `vec opt Nickname` | Up to 500, in order. |
| `search_my_nicknames(prefix : text, limit : nat)` | query | `vec Nickname` | At most 50. |
| `my_nickname_count()` | query | `{ count; max_free; max_premium }` | |
| `set_nickname(target, nickname : text)` | update | `Result` | `""` removes it (`Nickname removed`). Keeps the nickname's avatar. See 3.8. |
| `set_nickname_avatar(target, avatar : opt AvatarRef)` | update | `Result` | `Set a nickname first`. |
| `stats()` | query | `{ nicknames; owners; targets; import_closed }` | Counts only. |
| `get_config()`, `get_admins()` | query | | `Config = { max_free; max_premium; moderator; premium }`. |

`Nickname = { target; nickname : text; avatar : opt AvatarRef; updated_at : nat64 }`.

### 5.7 `sneed_profiles`

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `register_dapp(DappInput)` | update | `variant { ok : nat; err : text }` | See 3.9. Admins skip the control check. |
| `update_dapp(id, DappInput)` | update | `Result` | Caller is an admin, or controls one of the dapp's current canisters and one of the new ones. A new name or an added canister (not by an admin) drops the checkmark. `No such dapp`. |
| `list_dapps(page : Page)` | query | `{ items : vec DappView; next : opt nat }` | By id, hidden dapps left out. |
| `get_dapps(ids : vec nat)` | query | `vec opt DappView` | Up to 500, hidden ones included and flagged. |
| `search_dapps(prefix, limit)` | query | `vec DappView` | Hidden ones left out, at most 50. |
| `verify_dapp(id, value : bool)` | update | `Result` | Admins. |
| `verify_dapp_by_dao(id, value)`, `validate_verify_dapp_by_dao(id, value)` | | | Sneed DAO proposal target and its validator. |
| `stats()` | query | `{ dapps; log_length }` | |
| `get_config()`, `get_admins()` | query | | `get_log` for admins. |

`DappInput = { name; url; logo : opt AvatarRef; canisters : vec principal }`; `DappView` adds `id`, `verified`, `hidden`, `registered_by`, `created_at`, `updated_at`. Profile fields beyond the dapp registry (bio, links, banner) are planned, not built.

### 5.8 `sneed_avatars`

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `upload(bytes : blob)` | update | `variant { ok : blob; err : text }` | See 3.6. |
| `release(hash : blob)` | update | `Result` | `You do not hold that image`. Freed when nobody holds it. |
| `my_images()` | query | `vec ImageInfo` | The caller's held images. |
| `get_info(hashes : vec blob)` | query | `vec opt ImageInfo` | Up to 500: `{ hash; content_type; size; holders; created_at }`. |
| `get_images(hashes : vec blob)` | query | `vec opt Image` | Up to 20: `{ content_type; bytes }`. Prefer the HTTP URL in browsers. |
| `http_request(HttpRequest)` | query | `HttpResponse` | `GET` or `HEAD /<64 hex>`; `Cache-Control: public, max-age=31536000, immutable`, CORS `*`. 404 for an unknown or removed hash, 405 for other methods. |
| `stats()` | query | `{ images; bytes; region_bytes; holders }` | |
| `get_config()`, `get_admins()` | query | | `Config = { max_held; max_held_premium; premium }`. |

### 5.9 ICRC-3 log (names, neuron names, profiles)

`sneed_pid_names`, `sneed_neuron_names` and `sneed_profiles` each expose `icrc3_get_blocks`, `icrc3_get_archives`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`, `icrc10_supported_standards` and `icrc3_log_status`, with the same shapes as in the [Sneed Lock log](/api/sneed_lock#8-activity-log-icrc-3). Section 6 lists their block types.

### 5.10 Admin methods

Admins are the canister's controllers (the Sneed SNS root on production) plus the canister's admin list. Integrators never call these; they are in the Candid files for transparency.

| Method | Canisters | What it does |
|---|---|---|
| `admin_add_admin`, `admin_remove_admin` | all six | Manage the admin list. |
| `admin_set_config` | all six | Limits, moderator, premium canister, DAO governance, SNS-W, archive controllers. |
| `admin_set_name` | pid_names, neuron_names | Set or clear a name without moderation (account created if needed). |
| `admin_clear_avatar` | pid_names, neuron_names | Remove an abusive avatar (and an NFT avatar). |
| `admin_import_names`, `admin_import_nicknames`, `admin_finish_import` | pid_names, neuron_names, both nickname canisters | One-time import from the backend; closed for good on production. |
| `admin_hide_dapp` | profiles | Hide or show a dapp in lists and search. |
| `admin_remove` | avatars | Remove an image for everyone and block it from being uploaded again. |
| `admin_upload_for` | avatars | Upload an image held by another principal (used by the migration). |
| `admin_set_icrc3_settings`, `admin_icrc3_spill_now`, `admin_icrc3_repair_archive_controllers` | pid_names, neuron_names, profiles | ICRC-3 log maintenance. |

---

## 6. Activity log (ICRC-3)

Every change to public names is a block in a hash-chained, certified ICRC-3 log, one log per canister (`sneed_pid_names`, `sneed_neuron_names`, `sneed_profiles`). The nickname canisters and `sneed_avatars` have no public log. The block format, hashing, archives and verification are those of the shared library [src/icrc3](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/icrc3), described in [Sneed Lock's section 8](/api/sneed_lock#8-activity-log-icrc-3): a block is a `Map` with `btype`, `ts` (ns), `phash` and `tx`; principals inside `tx` are `Blob`s of the raw principal bytes, numbers are `Nat`, optional fields are omitted. Every `tx` here has `caller`; there is no `cid`. Browse a log at [app.sneeddao.com/tools/icrc3](https://app.sneeddao.com/tools/icrc3?canister=ejz7n-lyaaa-aaaad-qmkzq-cai).

The logs started with the import from the backend: one `import` block per imported record, so each log is complete from the first name on.

### Block types

`sneed_pid_names` (prefix `sneednames_`):

| `btype` | `tx` fields |
|---|---|
| `sneednames_account_create` | `account`, `owner`, `via` (`self`, `hotkey`, `admin`, `import`, or a map `{ sns_root; neuron_id; memo }`) |
| `sneednames_account_delete` | `account`, `name` (if it had one) |
| `sneednames_name_set` | `account`, `old_name`, `name` (absent when cleared), `verification_cleared` = 1 when the rename removed a checkmark |
| `sneednames_avatar_set` | `account` or `canister`, `avatar` (`{ url }` or `{ blob }`; absent when cleared); `merged_from` when a merge carried the avatar over |
| `sneednames_nft_avatar_set` | `account`, then either `nft_avatar` `{ collection; token_id; owner }` or `reason` (`cleared by owner`, `no longer owned`, `cleared by admin`) |
| `sneednames_member_link` | `account`, `principal`, `role`, `via`, `dapp` |
| `sneednames_member_unlink` | `account`, `principal` |
| `sneednames_member_update` | `account`, `principal`, `role`, `dapp` |
| `sneednames_hotkey_add`, `sneednames_hotkey_remove` | `account`, `hotkey` |
| `sneednames_account_merge` | `from`, `into`, `principals` (how many moved) |
| `sneednames_verify` | `account` or `canister`, `name`, `source` (`dao`, `import`, `{ admin }`, `{ sns_governance }`); when a merge carried the checkmark over, also `merged_from` (the merged account) and `verified_at` (the original verification time, ns) |
| `sneednames_unverify` | `account` or `canister` |
| `sneednames_canister_name_set` | `canister`, `old_name`, `name`, `verification_cleared`, `run_by_cleared` |
| `sneednames_canister_run_by` | `canister`, `account` (absent when cleared) |
| `sneednames_config_update` | `config` (text), or `admin_added` / `admin_removed`, or `import_closed`, or `key` / `old_value` / `value` for log settings |
| `sneednames_import` | `principal`, `name`, `verified` (0/1), `avatar` |

`sneed_neuron_names` (prefix `sneedneuronnames_`): `name_set` (`sns_root`, `neuron_id`, `old_name`, `name`, `verification_cleared`), `avatar_set` (`sns_root`, `neuron_id`, `avatar`), `verify` (`sns_root`, `neuron_id`, `name`, `source`), `unverify`, `config_update`, `import` (`sns_root`, `neuron_id`, `name`, `verified`).

`sneed_profiles` (prefix `sneedprofiles_`): `dapp_register` (`dapp`, `name`, `url`, `canisters`), `dapp_update` (`dapp`, `name`, `url`, `canisters`, `verification_cleared` when the update dropped the checkmark; or `dapp`, `hidden`), `dapp_verify` (`dapp`, `name`, `verified`), `config_update`.

---

## 7. Types

```candid
type AccountId = nat;
type DappId = nat;                    // an id in sneed_profiles
type AvatarRef = variant { url : text; blob : blob };   // https link, or SHA-256 of a sneed_avatars image
type Result = variant { ok : text; err : text };
type Page = record { start_after : opt K; limit : nat }; // K depends on the method

type VerifySource = variant { admin : principal; dao; sns_governance : principal; "import" };
type Verification = record { name : text; source : VerifySource; at : nat64 };

type Role = variant { owner; member };
type LinkProof = variant {
  self; hotkey; admin; "import";
  neuron_stake : record { sns_root : principal; neuron_id : blob; memo : nat64 };
};
type Member = record { "principal" : principal; role : Role; dapp : opt DappId; linked_at : nat64; via : LinkProof };
type NftRef = record { collection : principal; token_id : nat };
type NftAvatar = record { collection : principal; token_id : nat; owner : principal; set_at : nat64 };

type NameInfo = record {
  name : opt text; verified : bool; avatar : opt AvatarRef;
  nft_avatar : opt NftAvatar;             // accounts only
  kind : variant { account : AccountId; canister };
  dapp : opt DappId;                      // this principal's dapp label
  run_by : opt RunBy;                     // canisters only
};
type RunBy = record { account : AccountId; name : opt text };
type AccountView = record {
  id : AccountId; name : opt text; verified : bool; verification : opt Verification;
  avatar : opt AvatarRef; nft_avatar : opt NftAvatar; members : vec Member;
  hotkeys : vec principal;                // empty unless the caller manages the account
  created_at : nat64; updated_at : nat64;
};
type CanisterView = record {
  canister : principal; name : text; verified : bool; verification : opt Verification;
  avatar : opt AvatarRef; run_by : opt RunBy; set_by : principal; updated_at : nat64;
};
type SearchHit = record {
  name : text; verified : bool; avatar : opt AvatarRef; nft_avatar : opt NftAvatar;
  target : variant {
    account : record { id : AccountId; members : vec record { "principal" : principal; dapp : opt DappId } };
    canister : principal;
  };
};
type ChangeRef = variant { account : AccountId; canister : principal };
type Change = record { seq : nat; ref : ChangeRef; state : opt variant { account : AccountView; canister : CanisterView } };

type NeuronKey = record { sns_root : principal; neuron_id : blob };
type NeuronNameInfo = record { name : text; verified : bool; avatar : opt AvatarRef };
type NeuronNameView = record {
  sns_root : principal; neuron_id : blob; name : text; verified : bool;
  verification : opt Verification; avatar : opt AvatarRef; set_by : principal; updated_at : nat64;
};

type LogEntry = record { id : nat; ts : int; level : variant { info; error }; cid : nat; caller : principal; message : text };
```

The Candid files linked at the top are authoritative.

---

## 8. Integration checklist

- [ ] Test against the **staging** canisters first; they have their own names.
- [ ] Look names up in batches with `get_names` (up to 500 principals per query), not one call per row.
- [ ] Show the checkmark only when `verified` is true; never infer it from `verification` alone (it may belong to an older name).
- [ ] For `nft_avatar`, check `icrc7_owner_of` on the collection before showing it, and fall back to `avatar`.
- [ ] Resolve `AvatarRef.blob` to `https://ev5f4-4yaaa-aaaad-qmk3q-cai.raw.icp0.io/<hex>`; cache freely (content-addressed).
- [ ] Before a user sets a public name, tell them a name with a blacklisted word gets them banned.
- [ ] Before a merge or `link_by_neuron`, tell users the link between their principals becomes public.
- [ ] Treat nicknames as unpublished, not secret.
- [ ] Mirror names with `changes_since`, persisting the last `seq` you processed.
- [ ] For audits, read the ICRC-3 logs and verify them from the certified tip.

Questions, bugs, or an integration you would like listed here: open an issue on [GitHub](https://github.com/Snassy-icp/app_sneeddao/issues).
