# Sneed Names: the naming service, broken out of the backend

Status: design, October 2026. Replaces the naming code in `app_sneeddao_backend`
(principal names, neuron names, canister names, nicknames, avatars).

**Status (2026-10-20): built and live on production.** All six canisters are deployed (production
ids in `canister_ids.json`, controlled by the Sneed SNS root), the backend's names were imported
and every import is closed, the backend's naming writes are frozen, and the frontend uses the new
canisters. NFT avatars (§4.1a) were added after the first design. Still open: see §12. The public
API reference, checked against the code, is
`src/app_sneeddao_frontend/public/api-docs/sneed_names.md`.

## 1. Goals

- **Scale.** Millions of names. No method returns "everything"; every list is paged
  with a cursor, and lookups are by key, in batches.
- **Search as you type.** One query per keystroke returns the names starting with
  the typed text, or with a word in them starting with it ("whale" finds
  "Sneed Whale").
- **One name per person, not per principal.** Internet Identity gives the same
  person a different principal on every dapp. A name belongs to an *account*, and
  the person links their principals to it, so "Snassy on TACO" is never needed.
- **Names other dapps can use.** Any dapp can look up its users' names, checkmarks
  and avatars with one batched query call.
- **Auditable.** Public names have an ICRC-3 log: every name, link, verification
  and canister-name change is a block.
- **Fix the old holes.** Verification survives a rename today ("Bob" gets a
  checkmark, renames to "ICP Foundation", keeps it); canister names skip the
  character rules and the word blacklist; names differing only in capitals
  ("Diavolo" / "diavolo") are both allowed; neuron ownership reads only the
  caller's first 100 neurons; every uniqueness check scans every name.

## 2. Canisters

| Canister | Holds | Public log |
|---|---|---|
| `sneed_pid_names` | accounts (name, verification, avatar, NFT avatar, linked principals, hotkeys), canister names, the search index | ICRC-3 |
| `sneed_neuron_names` | SNS neuron names per SNS, verification, avatar, the search index | ICRC-3 |
| `sneed_pid_nicknames` | each user's private labels for principals (+ avatar) | none |
| `sneed_neuron_nicknames` | each user's private labels for neurons (+ avatar) | none |
| `sneed_avatars` | avatar images, content-addressed, in stable memory, served over HTTP | none |
| `sneed_profiles` | the dapp registry (phase 1); bio, links, banner, other profile fields (phase 2) | ICRC-3 |

All of them:

- **Enhanced orthogonal persistence** (`persistent actor`, `--enhanced-orthogonal-persistence`).
  No `preupgrade`, no copying into stable arrays on upgrade: the backend's habit of
  copying everything at upgrade time is what would fail first at a million names.
  The heap is limited by the IC's Wasm64 main-memory limit (6 GiB at the time of
  writing); indexes live there because reads and writes are cheapest there.
  Bulky data (ICRC-3 archives, avatar bytes) lives in stable memory (up to ~500 GiB)
  through `Region`.
- **The ingress guard** (`src/IngressGuard.mo`): queries refused as updates, the anonymous
  principal refused for every update, every argument capped (4 KiB for most calls, about 6 KiB
  with an avatar link, 64 KiB for an avatar upload), `admin_*` / `verify` / `unverify` only from
  admins, and the methods governance canisters call (`*_by_dao`, `*_by_sns`) never by ingress.
- **Admins**: the canister's controllers (the Sneed SNS root in prod) plus an
  admin list the controllers manage (staging: the dev principals). Sneed DAO
  governance may call the `*_by_dao` methods (generic nervous system functions).
- **Bans, the word blacklist and premium**: the backend stays the moderation
  authority (see §8); premium limits come from `sneed_premium` via `PremiumClient`.
- **Paging**: `{ start_after : ?K; limit : Nat }` in, `{ items; next : ?K }` out.
  `limit` is capped per method (`MAX_PAGE`, 500 unless stated).

Capacity estimate for `sneed_pid_names`: an account with one member, its name, the
unique-name entry and two word entries is roughly 300–400 bytes of heap, so a
6 GiB heap holds about 15 million named accounts. Beyond that it splits by
account id ranges, with a small directory canister (§11).

## 3. Names: the shared rules (`src/sneed_names/NameRules.mo`)

### 3.1 Valid names

Unchanged from today for people and neurons, now also applied to canisters:

- 1–32 characters (canisters: 2–32, as today);
- letters `a–z A–Z`, digits, and the separators space `-` `_` `.` `'`;
- at least one letter or digit (new for people and neurons; canisters had it);
- no leading or trailing space, no two spaces in a row (new: these made
  look-alike names);
- not containing a blacklisted word (§8).

### 3.2 Normalized form and uniqueness

`normalize(name)` = lowercase. Names are unique by normalized form:

- among accounts and canisters together in `sneed_pid_names` (a canister cannot
  be called "Snassy" either);
- among the neurons of one SNS in `sneed_neuron_names` (as today).

So "Snassy" and "snassy" can no longer belong to two different owners. The owner
of a name may change its capitals freely.

Migration: the one existing collision in prod principal names
("Diavolo" / "diavolo") is resolved before import (§10).

### 3.3 Search index

Two sorted maps (red-black trees, `mo:base/OrderedMap`, with a lower-bound iterator
of our own, `src/sneed_names/NameIndex.mo`): the unique index from the normalized name to
the owner, and a word index from `(suffix, normalized)` to the owner, where `suffix` runs from
each later word start of the normalized name to its end (the whole name is the unique key).
Both keys start with a scope: 0 in `sneed_pid_names`, the SNS's root index in
`sneed_neuron_names`:

```
"sneed whale"  →  ("sneed whale", "sneed whale"), ("whale", "sneed whale")
"big-whale.x"  →  ("big-whale.x", …), ("whale.x", …), ("x", …)
```

At most 8 entries per name (word starts beyond the 8th are not indexed).

`search(prefix, limit)` normalizes the prefix, seeks to the first key `>= prefix`
and walks forward while keys start with it, skipping owners already returned,
until `limit` results (max 50) or 2,000 steps. Cost: O(log n + steps), no
matter how many names there are. Results come in alphabetical order of the
matched word; names starting with the prefix come first (a first pass over the
unique index, then the word index). The prefix is lowercased, leading spaces dropped and runs of
spaces collapsed; a trailing space is kept ("sneed " finds "Sneed Whale" but not "Sneedy").

Why not a trie: a Motoko trie allocates one heap object per character (each a
few words), many times the size of the names themselves, and does nothing a
sorted map with a lower-bound seek does not do for prefix search.

### 3.4 Verification

A checkmark belongs to an exact name:

```motoko
type Verification = {
  name : Text;            // the exact name that was verified
  source : VerifySource;  // #admin(Principal) | #dao | #sns_governance(Principal) | #import_
  at : Nat64;             // ns
};
```

A name shows as verified only while `verification.name == name`. Any rename
clears the verification (and logs it). Sources:

- `#admin`: an admin.
- `#dao`: Sneed DAO governance, through a generic nervous system function whose
  target is `verify_by_dao(target, expected_name)` and whose validator is
  `validate_verify_by_dao(target, expected_name)`. The expected name is part of
  the proposal so a rename between proposal and execution makes it fail instead
  of verifying the new name.
- `#sns_governance(governance)`: an SNS's governance canister verifying the names of its
  own neurons (`sneed_neuron_names`, `verify_by_sns` / `unverify_by_sns`), as
  `can_verify_names` allowed in the backend. The SNS must be listed by SNS-W.
- `#import_`: the backend's verified flag, carried over by the migration (§10).

The frontend keeps showing its computed checkmark for SNS canisters (listed by
SNS-W); a permissionless on-chain source for that can come later.

## 4. `sneed_pid_names`

### 4.1 Accounts

```motoko
type AccountId = Nat;
type Role = { #owner; #member };
type Member = { principal : Principal; role : Role; dapp : ?DappId; linked_at : Nat64; via : LinkProof };
type LinkProof = { #self_; #hotkey; #neuron_stake : { sns_root : Principal; neuron_id : Blob; memo : Nat64 }; #admin; #import_ };
type Account = {
  id : AccountId;
  var name : ?Text;
  var verification : ?Verification;
  var avatar : ?AvatarRef;
  var members : [Member];          // at most max_members (50): shown as this account
  var hotkeys : [Principal];       // at most max_hotkeys (10): may manage it, not shown as it
  created_at : Nat64;
  var updated_at : Nat64;
};
```

A principal belongs to at most one account. Every principal that sets a name
without having an account gets one, with itself as the only owner.

- **Owners** rename the account, set its avatar, add and remove hotkeys, remove
  members, change roles. Several owners are allowed: that is the recovery story
  (lose your II anchor on one dapp, manage from another). A "primary identity" is
  just an account with one owner.
- **Members** carry the account's name. A member can leave at any time and set its
  own dapp label.
- **Hotkeys** manage the account like owners, except that they cannot change the
  hotkeys or remove or demote owners. They are not the account's principals: being
  a hotkey shows nothing about you, so an owner adds one without the hotkey's
  consent (it only gains power over the granter's account). This is the SNS hotkey
  model: add your Sneed Hub principal as a hotkey on TACO, and from Sneed Hub you
  see and change your TACO principal's name, with nothing to accept.
- The last owner cannot leave or be removed while other members remain. An account
  with no name, no avatar, no NFT avatar, no hotkeys and at most one member is deleted (its
  principal simply has no name); when the last member leaves, the account is
  deleted and its name freed.
- Hotkeys may manage an account (rename it, change its avatar, set members' dapp labels,
  remove non-owner members, merge it into their own account). Only owners rename through
  `set_my_name`, change the avatar through `set_my_avatar` / `set_my_nft_avatar`, add hotkeys,
  link principals and change roles.

### 4.1a NFT avatars

Added after the first design (built 2026-10-19). An account may show an ICRC-7 NFT as its
avatar, kept in its own map (not in `Account`) and returned as an optional `nft_avatar` field
in `NameInfo`, `AccountView` and `SearchHit`, so existing clients that decode `AvatarRef` are
not broken:

```motoko
type NftRef = { collection : Principal; token_id : Nat };
type NftAvatar = { collection : Principal; token_id : Nat; owner : Principal; set_at : Nat64 };
```

- `set_my_nft_avatar(opt NftRef)` (owners; `null` clears): the canister calls the collection's
  `icrc7_owner_of` (a bounded wait of 10 s) and accepts the NFT only if its owner, in any
  subaccount, is one of the account's member principals; `owner` records which.
- **Must own, checked again at display.** NFTs change hands, so clients show the NFT only while
  `owner` still owns it and otherwise fall back to `avatar`, which is kept for that case.
  `refresh_nft_avatar(account)` (anyone signed in) clears an NFT avatar that changed hands.
- ICRC-3 block `sneednames_nft_avatar_set`. Admins clear it with `admin_clear_avatar`; a merge
  deletes the merged account's NFT avatar.

**EXT NFTs** (step 2 of Sneed DAO proposal #416, built 2026-10-20; e.g. Sneed Diamond Club cards,
collection `gjv36-laaaa-aaaah-adyza-cai`):

- `set_my_ext_nft_avatar(opt NftRef)`: a new method beside `set_my_nft_avatar`, which is
  unchanged. The caller names the standard by the method; the canister does not probe
  `extensions()`. `token_id` is the EXT token index (above 2^32-1: "does not exist"). The canister
  calls `bearer(tokenIdentifier(collection, index))` (bounded wait, 10 s; a failed call or
  `#err(#Other)` refuses) and accepts the NFT only if the holder is the default account (account
  identifier with a zero subaccount) of the caller or another member of the caller's account.
  Identifiers are computed in `src/sneed_names/Ext.mo` (sha2's SHA-224, own CRC32), the same as
  the frontend's `ExtUtils.js`.
- **Storage without a stable type change.** `NftAvatar` (an EOP stable type) is unchanged. A new
  stable map `nft_avatar_standards : AccountId -> Text` holds `"EXT"` for EXT avatars; no entry
  means ICRC-7, so every avatar from before keeps meaning what it meant. Setting, clearing,
  refresh and account deletion keep both maps in step.
- The views (`NameInfo`, `AccountView`, `SearchHit`, so also `changes_since`) carry a new
  `nft_avatar_standard : opt text` (`"ICRC-7"` / `"EXT"` while `nft_avatar` is set): an added
  record field, backward compatible for Candid clients.
- Display re-check for EXT: `bearer(tokenIdentifier(collection, token_id))` equals the account
  identifier of `owner`'s default account. Picture: the card's metadata `image`, else the EXT
  route `https://<collection>.raw.icp0.io/?tokenid=<tid>`. `refresh_nft_avatar` uses the
  avatar's standard.
- The `sneednames_nft_avatar_set` block's `nft_avatar` map gains `standard` (`"ICRC-7"` or
  `"EXT"`); earlier blocks have none and mean ICRC-7.

### 4.2 Linking principals: hotkeys and merging

Showing a principal as "the same person" as an account needs that principal's
consent, otherwise anyone could claim your principal under their name. Two
proofs exist:

1. **Hotkey, then merge.** The principal's account (on TACO, say) adds your
   principal as a hotkey: that is its consent for you to manage it. From your
   account you call `merge_account(its account)`: its principals join your
   account as members (`via = #hotkey`) and show your name from then on. If your
   account has no name it takes the merged account's name (and checkmark);
   otherwise that name is freed. The merged account and its hotkeys are deleted.
   A dapp only has to offer "add hotkey" (one call) to let its users do this.
2. **Neuron stake.** For principals that never sign in where our canisters are
   called (an NNS dapp principal): `link_by_neuron(sns_root, neuron_id, memo, principal, dapp)`.
   It succeeds when
   - `sns_root` is a deployed SNS (SNS-W lists it);
   - `neuron_id == sha256(0x0c "neuron-stake" ‖ principal ‖ memo as 8 bytes BE)`, the
     staking subaccount: only `principal` can end up with permissions on a
     neuron with that id (a claim of that subaccount gives `principal` the
     neuron), so the principal created it;
   - the principal still has `ManagePrincipals` on it and the caller has a
     permission on it (the principal, or someone it trusted, gave the caller a
     hotkey);
   - the principal is in no account yet, is a person's principal (not a canister) and is not
     the caller; the caller is an owner of its account (one is created if needed).

   The frontend finds the memo by trying memos from 0 upwards against the neuron
   id. Why not today's rule ("the caller is a hotkey of a neuron where the
   principal has ManagePrincipals")? An SNS neuron does not record who created
   it, and any owner of a neuron can grant `ManagePrincipals` to any principal,
   so that rule let anyone put anyone's principal under their name (the
   backend's `set_principal_name_for` has this hole today).

Each member carries an optional dapp label ("this is me on TACO") from the dapp
registry in `sneed_profiles`. It is the member's (or its account's managers')
claim; nothing on-chain can prove which origin an II principal was derived for,
and only principals that consented can be labelled.

Members are **public**: the point of the feature is that everyone sees they are the
same person. The UI says so before merging or linking. Hotkeys are shown only to
the account's owners and hotkeys (they do appear in the public ICRC-3 log).

### 4.3 Canister names

A canister id is not a person, so it does not join an account. It has its own
entry:

```motoko
type CanisterName = {
  canister : Principal;
  var name : Text;
  var verification : ?Verification;
  var avatar : ?AvatarRef;
  var run_by : ?AccountId;   // "Trading Bot · run by Snassy"
  var set_by : Principal;    // the controller that last named it
  var updated_at : Nat64;
};
```

- Whoever controls the canister at the time of the call may name it, rename it,
  set its avatar or clear it. Controllers are read with the management canister's
  `canister_info`.
- `run_by` may be set by a controller that is also an owner of that account (both
  sides consent in one call), and is cleared when a different controller renames
  the canister.
- An SNS-controlled canister (a controller is an SNS root, which never calls other
  canisters on its own) may also be named by that SNS's governance canister, through
  a generic proposal of that SNS. The (root, governance) pairs come from SNS-W's
  `list_deployed_snses`, cached and refreshed at most once a minute
  (`src/sneed_names/Control.mo`, `SnsDirectory.mo`). Changed from the original plan: SNS-W, not
  the root's `list_sns_canisters`, so a made-up root cannot vouch for a governance canister.
  Admins can name any canister (`admin_set_name`).
- `set_canister_avatar` and `set_canister_run_by` need the canister to be named first; clearing
  the name deletes the entry with its avatar and `run_by`.
- Canister names share the unique name space and the search index with accounts.

Principals in the migrated data are split by class: opaque ids (canisters) become
canister names, self-authenticating ids become accounts.

### 4.4 Changes feed

Every account and canister name has a latest change; a sorted map
`seq → ref` keeps only the latest change of each, and deletions leave a tombstone.
`changes_since({ after : Nat; limit })` returns the refs changed after a sequence
number, in order, with their current state (or `#deleted`). A client keeps a full
local copy current with it while the service is small, and the frontend uses it
for that until names reach tens of thousands; it is also how a full export is
paged (after = 0).

### 4.5 API

Queries (anyone):

```candid
get_names : (vec principal) -> (vec opt NameInfo) query;          // max 500
// NameInfo = record { name : opt text; verified : bool; avatar : opt AvatarRef;
//   nft_avatar : opt NftAvatar;     // accounts only (§4.1a)
//   nft_avatar_standard : opt text; // "ICRC-7" or "EXT" while nft_avatar is set
//   kind : variant { account : nat; canister };
//   dapp : opt nat;                 // the dapp label of this principal in its account
//   run_by : opt record { account : nat; name : opt text } }
get_name : (principal) -> (opt NameInfo) query;
search : (record { prefix : text; limit : nat; kind : opt variant { account; canister } }) -> (vec SearchHit) query;
list_names : (record { start_after : opt text; limit : nat }) -> (record { items : vec SearchHit; next : opt text }) query;
get_account : (nat) -> (opt AccountView) query;      // hotkeys shown to owners and hotkeys only
get_account_of : (principal) -> (opt AccountView) query;
my_hotkey_accounts : () -> (vec AccountView) query;  // the first 100 (2026-10-23, paging_audit S14)
my_hotkey_accounts_page : (record { start_after : opt nat; limit : nat }) -> (record { items : vec AccountView; next : opt nat; total : nat }) query;
get_canister_name : (principal) -> (opt CanisterView) query;
changes_since : (record { after : nat; limit : nat }) -> (record { items : vec Change; last_seq : nat }) query;
stats, get_config, get_admins, get_log (admins)
icrc3_get_blocks, icrc3_get_archives, icrc3_get_tip_certificate, icrc3_supported_block_types,
icrc10_supported_standards, icrc3_log_status
```

Updates (signed in):

```candid
set_my_name : (text) -> (Result);                    // "" clears; creates the account if needed
set_my_avatar : (opt AvatarRef) -> (Result);
set_my_nft_avatar : (opt NftRef) -> (Result);         // owners; §4.1a
set_my_ext_nft_avatar : (opt NftRef) -> (Result);     // owners; EXT token index; §4.1a
refresh_nft_avatar : (nat) -> (Result);              // anyone signed in; clears a sold NFT avatar
set_account_name : (nat, text) -> (Result);          // owners and hotkeys
set_account_avatar : (nat, opt AvatarRef) -> (Result);
add_hotkey : (principal) -> (Result);                // owners, on their own account
remove_hotkey : (nat, principal) -> (Result);        // owners, or the hotkey itself
leave_hotkey_accounts : () -> (Result);              // the caller leaves every account that gave it a hotkey (500 a call)
merge_account : (nat) -> (Result);                   // a hotkey (or owner) of it, into the caller's account
link_by_neuron : (principal sns_root, blob neuron_id, nat64 memo, principal, opt nat dapp) -> (Result);
remove_member : (principal) -> (Result);             // managers remove (hotkeys not owners), or leave
set_member : (principal, Role, opt nat) -> (Result); // owners: role; managers and the member: dapp label
set_canister_name : (principal, text) -> (Result);
set_canister_avatar : (principal, opt AvatarRef) -> (Result);
set_canister_run_by : (principal, opt nat) -> (Result);
```

Admin and DAO:

```candid
admin_set_name : (principal, text) -> (Result);   // a principal's account (created if needed) or a canister
admin_clear_avatar : (principal) -> (Result);    // also clears the NFT avatar
verify : (principal, text expected_name) -> (Result);
unverify : (principal) -> (Result);
verify_by_dao / validate_verify_by_dao, unverify_by_dao / validate_unverify_by_dao
admin_set_config, admin_add_admin, admin_remove_admin
admin_import_names (§10), admin_finish_import
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers
```

### 4.6 ICRC-3 block types (prefix `sneednames_`)

`account_create`, `account_delete`, `name_set`, `avatar_set`, `nft_avatar_set`, `member_link`
(with proof), `member_unlink`, `member_update`, `hotkey_add`, `hotkey_remove`,
`account_merge`, `verify`, `unverify`, `canister_name_set`, `canister_run_by`,
`config_update`, `import` (one block per imported record, so the log starts
complete). Every block has `caller`. `nft_avatar_set` carries either `nft_avatar`
(`collection`, `token_id`, `owner`) or a `reason` (`cleared by owner`, `no longer owned`,
`cleared by admin`).

Fixed 2026-10-20 (known issue before): `merge_account` copied the merged account's avatar (when
the target has none) and its checkmark (with its name) into the target account without an
`avatar_set` or `verify` block, so they could not be replayed from the log alone. It now writes
an `avatar_set` block and a `verify` block for the target account (both with `merged_from`, the
merged account's id; the `verify` block keeps the original `source` and adds `verified_at`, the
original verification time). Merges before the upgrade stay without them.

## 5. `sneed_neuron_names`

Key: `(sns_root, neuron_id)`. SNS roots are deduplicated to `Nat32` with `mo:dedup`
(a few hundred roots, repeated on every key); neuron ids stay `Blob` keys.

```motoko
type NeuronName = { var name : Text; var verification : ?Verification; var avatar : ?AvatarRef;
                    var set_by : Principal; var updated_at : Nat64 };
```

- Set / clear / avatar: the caller has any permission on the neuron (as today),
  checked with the SNS governance `get_neuron` (exact, no 100-neuron window). The root must be
  a deployed SNS listed by SNS-W; a neuron id is 1 to 64 bytes. Admins may name any neuron
  without the SNS check (`admin_set_name`). An avatar needs a name first.
- Unique per SNS by normalized name; the search index key is
  `(root_index, suffix, normalized)`, so search is per SNS:
  `search({ sns_root; prefix; limit })`.
- Verification: admins, Sneed DAO (`verify_by_dao`), or that SNS's governance canister
  (`verify_by_sns(key, expected_name)` / `unverify_by_sns(key)`).
- `get_names(vec record { sns_root; neuron_id })`, `list_by_sns({ sns_root; start_after; limit })`,
  `changes_since`, ICRC-3 (`sneedneuronnames_*`).

## 6. Nickname canisters

`sneed_pid_nicknames` (targets are principals) and `sneed_neuron_nicknames`
(targets are `(sns_root, neuron_id)`).

- Owners and targets are deduplicated to `Nat32` (`mo:dedup`); a nickname is one
  entry in one flat map keyed by `Nat64 = owner_index << 32 | target_index`. Since
  the owner is the high half, one owner's nicknames are a contiguous range, which
  makes `get_my_nicknames` a range scan. This replaces a map of maps per user and
  saves roughly a fifth to a third of the memory per nickname.
- Value: `{ nickname : Text; avatar : ?AvatarRef; updated_at : Nat64 }`.
- `get_my_nicknames({ start_after; limit })` (limit 500: usually everything in one
  call), `get_my_nicknames_for(vec target)`, `search_my_nicknames(prefix, limit)`
  (a scan over the caller's own range, at most 50 results; nickname counts are bounded by the
  limits), `my_nickname_count()` (count, max_free, max_premium).
- `set_nickname(target, text)` ("" clears; the avatar is kept while the nickname exists),
  `set_nickname_avatar(target, opt AvatarRef)` (needs a nickname first).
- Limits: 10 per user, 100 with Sneed Premium, configurable, as today.
- Validation: the name rules of §3.1; the blacklist is checked without banning
  (nicknames are only seen by their owner, as today), and a banned user cannot set nicknames.
- **No public log.** A nickname is *unpublished*, not *secret*: the canister only
  returns a user's nicknames to that user, but the data is not encrypted and node
  providers can in principle read canister state. The UI never calls them private
  in a way that suggests encryption.

## 7. `sneed_avatars`

`AvatarRef = variant { url : text; blob : blob }` (blob = SHA-256 of the image).

- `#url`: an `https://` link, at most 512 characters (as today).
- `#blob`: an image stored in `sneed_avatars`: PNG, JPEG, WebP or GIF, at most
  48 KiB (the backend's inline limit was 32,768 base64 characters, about 24 KiB). The
  type is read from the bytes, not taken from the client.

The store:

- Bytes in stable memory (`Region`), indexed by hash on the heap; identical images
  are stored once.
- Each principal *holds* the blobs it uploaded (`upload(bytes) -> hash`, `release(hash)`,
  `my_images()`), at most 20 held blobs per principal (200 with premium). Changed from the
  original plan: `upload` takes no content type; the canister detects it. A blob
  is freed when nobody holds it. The name canisters do not call the avatar store:
  a record pointing at a freed blob simply shows the default avatar. This keeps the
  canisters independent and needs no cross-canister reference counting.
- Served at `https://<sneed_avatars>.raw.icp0.io/<hex hash>` with
  `Cache-Control: public, max-age=31536000, immutable` (content-addressed, so it
  never changes), and by `get_images(vec blob)` (at most 20 a call) for clients that prefer a
  query; `get_info(vec blob)` (up to 500) answers type, size, holders and creation time.
  Serving from the certified domain needs response certification of each blob;
  that is a later step (the hash in the URL already lets a client check the bytes).
  Status (2026-10-20): not built; images are served from the raw domain only.
- Admins can remove an abusive image (`admin_remove(hash)`), which frees it for
  every holder and blocks the same bytes from being uploaded again. `admin_upload_for(owner,
  bytes)` uploads an image held by another principal (used by the migration).

## 7a. `sneed_profiles`

Phase 1 holds the dapp registry; phase 2 adds profile fields (bio, links, banner),
kept out of the name canisters so lookups stay small. Status (2026-10-20): phase 1 built and
deployed; phase 2 planned.

### 7a.1 Dapp registry

```motoko
type DappId = Nat;
type Dapp = { id : DappId; name : Text; url : Text; logo : ?AvatarRef;
              canisters : [Principal]; verified : Bool; hidden : Bool;
              registered_by : Principal; created_at : Nat64; updated_at : Nat64 };
```

- `register_dapp`: a controller of at least one of the listed canisters (checked
  with `canister_info`), or the governance canister of an SNS whose root controls one,
  registers it; 1 to 10 canisters a dapp. The name follows §3.1, is unique regardless of
  capitals and is moderated as a public name; the url starts with `https://`, at most 200
  characters.
- `update_dapp(id, DappInput)`: an admin, or a controller (or SNS governance) of one of the
  dapp's *current* canisters who also controls one of the new list. A new name loses the
  checkmark, and so does adding a canister unless an admin does it (removing canisters or
  changing the url or logo keeps it); the `dapp_update` block then has `verification_cleared`.
  Fixed 2026-10-20 (known issue before): the control check ran against the new canister list
  only, so anyone who controlled some canister could rewrite any dapp entry and keep its
  checkmark.
- `verify_dapp` / `verify_dapp_by_dao`: admins or a Sneed DAO proposal mark it
  verified (shown with a checkmark in the picker; unverified dapps are shown
  greyed).
- Admins can edit any entry and hide abusive ones (`admin_hide_dapp`); hidden dapps are left out
  of `list_dapps` and `search_dapps`, and `get_dapps` returns them flagged.
- Queries: `list_dapps` (paged by id), `get_dapps` (up to 500), `search_dapps(prefix, limit)`.
- ICRC-3 (`sneedprofiles_`): `dapp_register`, `dapp_update`, `dapp_verify`, `config_update`.

The registry is small (hundreds of entries). Member dapp labels in
`sneed_pid_names` hold a `DappId` from here; the name canisters do not check it
(a label pointing at a removed dapp shows nothing).

## 8. Moderation: bans and the blacklist stay in the backend

The backend keeps the ban list and the word blacklist (also used for the forum
and messages), and gets one new method, callable only by the naming canisters
(a list the backend admins set with `admin_set_names_canisters`, at most 20; any other caller
traps):

```candid
names_moderate : (record { user : principal; text : text; is_public : bool }) ->
  (variant { ok; banned : text; blacklisted : text });
```

It answers whether `user` is banned (with the remaining time), and whether `text`
contains a blacklisted word; with `is_public = true` a blacklisted word also bans
the user, exactly as setting a public name does today. One inter-canister call per
name write; names change rarely, so this costs little. Clearing a name makes no
call. If the backend cannot be reached the write is refused. It is asked for account,
canister, neuron and dapp names (public) and for nicknames (not public).

## 9. Frontend

Status (2026-10-20): the frontend talks to the naming service through
`src/app_sneeddao_frontend/src/utils/NamingService.js`, which answers the backend-shaped naming
calls from the new canisters once they have ids on the build's network, so most pages did not
change. It runs in small-service mode (below): names are mirrored with `changes_since`, and
`PrincipalInput` searches the mirror. The per-key resolver and server-side search are planned.

- **`NamingContext` becomes a resolver.** `useName(principal)` / `useNeuronName(root, id)`
  return what is cached and register the key; every 20 ms the resolver fetches the
  unknown keys with one `get_names` call (max 500) per canister. Results are cached
  in localStorage with a time limit (and refreshed in the background).
- **Small-service mode**: while names are few, the frontend keeps a full local copy,
  kept current with `changes_since` (a few calls on load instead of `get_all_*`).
  The resolver works the same way either way.
- **`PrincipalInput`** searches as you type: the caller's own nicknames
  (`search_my_nicknames`) and public names (`search`), merged, debounced ~120 ms.
- **NFT avatars** (§4.1a): a picker on the Me page, "use as my avatar" on an NFT's page,
  and an ownership re-check at display (`utils/nftAvatars.js`).
- **Me page**: account management (name, avatar, linked principals with dapp
  labels, hotkeys, owners, merging), canister names, nicknames.
- Display: the account's name with the checkmark; the dapp logo where it helps
  (profile, hover card); canisters as "Name · run by Account".

## 10. Migration

Status (2026-10-20): done on production. Every import is closed (`admin_finish_import`), and
the backend's naming writes are frozen. The TACO PR (step 6) is still open.

Prod data (16 Oct 2026): 153 principal names (4 verified), 15 neuron names,
nicknames and avatars for a few users.

1. **Deploy** the new canisters (staging first), admins = dev principals on staging,
   SNS root on prod.
2. **Backend upgrade** (one proposal):
   - `names_moderate` (§8);
   - `admin_export_*` paged queries for admins: principal names, neuron names,
     *every user's* nicknames (today's `get_all_*_nicknames` return only the
     caller's), avatars;
   - a `names_frozen` flag: when set, every naming write in the backend answers
     "Names are moving to the new naming service; please try again shortly" (reads keep
     working). It is set with `admin_set_names_frozen` (backend admins) and read with
     `get_names_frozen`; it covers principal, neuron and canister names, nicknames, avatars and
     verification;
   - the backend's stable naming state is kept, never removed.
3. **Freeze** the backend's naming writes (admin call).
4. **Import**: `scripts/migrate_names.py` (dry run by default; `--apply`, `--verify`,
   `--decisions FILE`, `--identity NAME`; rehearsed on a local replica) reads the backend
   exports and calls the new canisters'
   `admin_import_*` methods in batches. Each new canister logs one `import` block
   per record, and `admin_finish_import` locks import forever. Verification: counts
   and a checksum per canister, compared with the backend.
   - Principal names: self-authenticating principals become one-owner accounts;
     opaque ids become canister names (`set_by` = the importing admin).
   - Verified flags are imported as verifications of the current name with source `#import_`.
     Changed from the original plan: `#import_` rather than `#admin`, so the log and the
     views say where the checkmark came from.
   - Collisions by capitals: a verified name wins; the other needs a decision
     (`rename` or `drop` in the decisions file) before `--apply` runs. Prod today:
     "Diavolo" (az6nt…, verified) and "diavolo" (r24bn…).
   - Names that break the new rules: spaces are trimmed and collapsed
     automatically (prod: "AwaisUllah ", "icpp-pro  onicai"); anything else needs a
     decision (prod: ".." of 2yhmq…).
   - Principals with an avatar and no name become accounts with only an avatar.
   - Avatars: data URLs are decoded and uploaded to `sneed_avatars` as held by
     their owner; links stay links.
5. **Frontend** switches to the new canisters.
6. **TACO**: a PR to TACO switching their naming calls to the new canisters, plus an
   "add hotkey" button so TACO users can manage their TACO name from Sneed Hub. Until
   it lands, the backend's naming queries keep answering from the frozen copy.
   Later backend releases can drop the naming methods once nobody calls them (the
   stable state stays).

## 11. Scaling beyond one canister

- Nicknames split by owner (all of a user's nicknames stay together).
- Names split by account id ranges; uniqueness and search then need either a
  separate global name index canister or range splitting by name. Not needed
  before ~10 million names; the API (batched `get_names`, cursors, `changes_since`)
  does not change when it happens, except that clients ask a directory which
  canister holds a key.

## 12. Build order

Status 16 Oct 2026: steps 1–6 done (canisters, backend support, migration script rehearsed on a
local replica, `scripts/configure_names.sh`), step 7 done for the data layer and the Me page's
account panel (the frontend switches to the naming service when the canisters have ids for its
network).

Status (2026-10-20): steps 1–7 done and live on staging and production (names imported,
backend writes frozen); step 8 phase 1 (the dapp registry) built and deployed; NFT avatars
(§4.1a) added. Admin lists for the six canisters are managed on the hub's admins page, and
the names admin page verifies through the new canisters. Still open: search on the server in
PrincipalInput (the frontend mirrors all names for now), the link-by-neuron UI (it searches the
memo), certified avatar responses, profile fields (phase 2), splitting beyond one canister
(§11), the TACO PR.


1. `src/sneed_names/`: shared modules (name rules, sorted index with lower-bound
   seek, search, paging), Motoko unit tests.
2. `sneed_pid_names` with tests (PocketIC).
3. `sneed_neuron_names`, then the two nickname canisters, with tests.
4. `sneed_avatars` with tests.
5. Backend: `names_moderate`, exports, freeze flag, tests.
6. Migration script, staging rehearsal with a copy of prod data.
7. Frontend resolver, search, Me page; staging; then prod.
8. Phase 2: `sneed_profiles`.
