# Sneed Names: the naming service, broken out of the backend

Status: design, October 2026. Replaces the naming code in `app_sneeddao_backend`
(principal names, neuron names, canister names, nicknames, avatars).

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
| `sneed_pid_names` | accounts (name, verification, avatar, linked principals, hotkeys), canister names, the search index | ICRC-3 |
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
- **The ingress guard** (`src/IngressGuard.mo`): queries refused as updates, every
  argument capped, texts compared with the canister's limits.
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

A sorted map (red-black tree, `mo:base/OrderedMap`, with a lower-bound iterator
of our own) from `(suffix, normalized)` to the owner, where `suffix` runs from
each word start of the normalized name to its end:

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
unique index, then the word index).

Why not a trie: a Motoko trie allocates one heap object per character (each a
few words), many times the size of the names themselves, and does nothing a
sorted map with a lower-bound seek does not do for prefix search.

### 3.4 Verification

A checkmark belongs to an exact name:

```motoko
type Verification = {
  name : Text;            // the exact name that was verified
  source : VerifySource;  // #admin(Principal) | #dao | #sns_governance(Principal)
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
- `#sns_governance(root)`: an SNS's governance canister verifying the names of its
  own neurons (`sneed_neuron_names`), as `can_verify_names` allows today.

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
  with no name, no avatar, no hotkeys and at most one member is deleted (its
  principal simply has no name); when the last member leaves, the account is
  deleted and its name freed.

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
   - the principal is in no account yet.

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
  a generic proposal of that SNS; the governance id is read from the root's
  `list_sns_canisters`. Admins can name any canister (`admin_set_name`).
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
//   kind : variant { account : nat; canister };
//   dapp : opt nat;                 // the dapp label of this principal in its account
//   run_by : opt record { account : nat; name : opt text } }
get_name : (principal) -> (opt NameInfo) query;
search : (record { prefix : text; limit : nat; kind : opt variant { account; canister } }) -> (vec SearchHit) query;
list_names : (record { start_after : opt text; limit : nat }) -> (record { items : vec SearchHit; next : opt text }) query;
get_account : (nat) -> (opt AccountView) query;      // hotkeys shown to owners and hotkeys only
get_account_of : (principal) -> (opt AccountView) query;
my_hotkey_accounts : () -> (vec AccountView) query;
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
set_account_name : (nat, text) -> (Result);          // owners and hotkeys
set_account_avatar : (nat, opt AvatarRef) -> (Result);
add_hotkey : (principal) -> (Result);                // owners, on their own account
remove_hotkey : (nat, principal) -> (Result);        // owners, or the hotkey itself
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
admin_clear_avatar : (principal) -> (Result);
verify : (principal, text expected_name) -> (Result);
unverify : (principal) -> (Result);
verify_by_dao / validate_verify_by_dao, unverify_by_dao / validate_unverify_by_dao
admin_set_config, admin_add_admin, admin_remove_admin
admin_import_names (§10), admin_finish_import
admin_set_icrc3_settings, admin_icrc3_spill_now, admin_icrc3_repair_archive_controllers
```

### 4.6 ICRC-3 block types (prefix `sneednames_`)

`account_create`, `account_delete`, `name_set`, `avatar_set`, `member_link`
(with proof), `member_unlink`, `member_update`, `hotkey_add`, `hotkey_remove`,
`account_merge`, `verify`, `unverify`, `canister_name_set`, `canister_run_by`,
`config_update`, `import` (one block per imported record, so the log starts
complete). Every block has `caller`.

## 5. `sneed_neuron_names`

Key: `(sns_root, neuron_id)`. SNS roots are deduplicated to `Nat32` with `mo:dedup`
(a few hundred roots, repeated on every key); neuron ids stay `Blob` keys.

```motoko
type NeuronName = { var name : Text; var verification : ?Verification; var avatar : ?AvatarRef;
                    var set_by : Principal; var updated_at : Nat64; var last_seq : Nat };
```

- Set / clear / avatar: the caller has any permission on the neuron (as today),
  checked with the SNS governance `get_neuron` (exact, no 100-neuron window).
- Unique per SNS by normalized name; the search index key is
  `(root_index, suffix, normalized)`, so search is per SNS:
  `search({ sns_root; prefix; limit })`.
- Verification: admins, Sneed DAO, or that SNS's governance canister.
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
  (a scan over the caller's own range; nickname counts are bounded by the limits).
- `set_nickname(target, text)` ("" clears), `set_nickname_avatar(target, opt AvatarRef)`.
- Limits: 10 per user, 100 with Sneed Premium, configurable, as today.
- Validation: the name rules of §3.1; the blacklist is checked without banning
  (nicknames are only seen by their owner, as today).
- **No public log.** A nickname is *unpublished*, not *secret*: the canister only
  returns a user's nicknames to that user, but the data is not encrypted and node
  providers can in principle read canister state. The UI never calls them private
  in a way that suggests encryption.

## 7. `sneed_avatars`

`AvatarRef = variant { url : text; blob : blob }` (blob = SHA-256 of the image).

- `#url`: an `https://` link, at most 512 characters (as today).
- `#blob`: an image stored in `sneed_avatars`: PNG, JPEG, WebP or GIF, at most
  48 KiB (today's inline limit is 32,768 base64 characters, about 24 KiB).

The store:

- Bytes in stable memory (`Region`), indexed by hash on the heap; identical images
  are stored once.
- Each principal *holds* the blobs it uploaded (`upload(bytes, content_type) -> hash`,
  `release(hash)`), at most 20 held blobs per principal (200 with premium). A blob
  is freed when nobody holds it. The name canisters do not call the avatar store:
  a record pointing at a freed blob simply shows the default avatar. This keeps the
  canisters independent and needs no cross-canister reference counting.
- Served at `https://<sneed_avatars>.raw.icp0.io/<hex hash>` with
  `Cache-Control: public, max-age=31536000, immutable` (content-addressed, so it
  never changes), and by `get_blobs(vec blob)` for clients that prefer a query.
  Serving from the certified domain needs response certification of each blob;
  that is a later step (the hash in the URL already lets a client check the bytes).
- Admins can remove an abusive image (`admin_remove(hash)`), which frees it for
  every holder.

## 7a. `sneed_profiles`

Phase 1 holds the dapp registry; phase 2 adds profile fields (bio, links, banner),
kept out of the name canisters so lookups stay small.

### 7a.1 Dapp registry

```motoko
type DappId = Nat;
type Dapp = { id : DappId; name : Text; url : Text; logo : ?AvatarRef;
              canisters : [Principal]; verified : Bool; registered_by : Principal; created_at : Nat64 };
```

- `register_dapp`: a controller of at least one of the listed canisters (checked
  with `canister_info`) registers it; at most 10 canisters a dapp.
- `verify_dapp` / `verify_dapp_by_dao`: admins or a Sneed DAO proposal mark it
  verified (shown with a checkmark in the picker; unverified dapps are shown
  greyed).
- Admins can edit or hide abusive entries.

The registry is small (hundreds of entries). Member dapp labels in
`sneed_pid_names` hold a `DappId` from here; the name canisters do not check it
(a label pointing at a removed dapp shows nothing).

## 8. Moderation: bans and the blacklist stay in the backend

The backend keeps the ban list and the word blacklist (also used for the forum
and messages), and gets one new method, callable only by the naming canisters
(a list the backend admins set):

```candid
names_moderate : (record { user : principal; text : text; is_public : bool }) ->
  (variant { ok; banned : text; blacklisted : text });
```

It answers whether `user` is banned (with the remaining time), and whether `text`
contains a blacklisted word; with `is_public = true` a blacklisted word also bans
the user, exactly as setting a public name does today. One inter-canister call per
name write; names change rarely, so this costs little. Clearing a name makes no
call. If the backend cannot be reached the write is refused.

## 9. Frontend

- **`NamingContext` becomes a resolver.** `useName(principal)` / `useNeuronName(root, id)`
  return what is cached and register the key; every 20 ms the resolver fetches the
  unknown keys with one `get_names` call (max 500) per canister. Results are cached
  in localStorage with a time limit (and refreshed in the background).
- **Small-service mode**: while names are few, the frontend keeps a full local copy,
  kept current with `changes_since` (a few calls on load instead of `get_all_*`).
  The resolver works the same way either way.
- **`PrincipalInput`** searches as you type: the caller's own nicknames
  (`search_my_nicknames`) and public names (`search`), merged, debounced ~120 ms.
- **Me page**: account management (name, avatar, linked principals with dapp
  labels, hotkeys, owners, merging), canister names, nicknames.
- Display: the account's name with the checkmark; the dapp logo where it helps
  (profile, hover card); canisters as "Name · run by Account".

## 10. Migration

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
     "Names are moving to the new naming service" (reads keep working);
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
   - Verified flags are imported as `#admin` verifications of the current name.
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

1. `src/sneed_names/`: shared modules (name rules, sorted index with lower-bound
   seek, search, paging), Motoko unit tests.
2. `sneed_pid_names` with tests (PocketIC).
3. `sneed_neuron_names`, then the two nickname canisters, with tests.
4. `sneed_avatars` with tests.
5. Backend: `names_moderate`, exports, freeze flag, tests.
6. Migration script, staging rehearsal with a copy of prod data.
7. Frontend resolver, search, Me page; staging; then prod.
8. Phase 2: `sneed_profiles`.
