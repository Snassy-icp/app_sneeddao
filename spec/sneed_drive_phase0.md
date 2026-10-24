# Sneed Drive, phase 0: notes first

Written 2026-10-25. An addendum to [sneed_drive.md](sneed_drive.md) (the full design: index plus
shards, content-addressed chunks, vetKeys, sync). Decided today: there is no separate "Notebook"
product. Notes are a **view** of Sneed Drive, and phase 0 is the first slice of the drive itself.

Phase 0 is **one index canister** (`sneed_drive`, `src/sneed_drive/`) and a hidden Sneed Hub
section at `/drive`, for admins only behind a per-browser switch. The first use is personal
markdown notes shared with chosen principals, among them Claude's
(`xda3q-vimkb-k5ld3-2y2hp-l4emm-475y5-fyljy-zo6mh-zy3ml-2hbu7-nae`), which reads and writes with
dfx. So the Candid API is plain and scriptable: text in, text out, paths resolvable.

## 1 · What phase 0 has

| Feature | Phase 0 |
|---|---|
| Storage | Small files (≤ 64 KiB) **inline** in the index, one copy per version. No shards, no chunks. |
| Tree | Folders and files, root = node 0. Names unique per folder, case-insensitively. |
| Versions | Every save that changes the bytes makes a new version. All are kept (retention setting below); the owner can purge. Saving identical bytes is a no-op. |
| Trash | Delete moves a node (with its subtree) to the trash; restore puts it back (renamed if the name was taken); the owner purges. |
| Tags | On any node, folders included. |
| Search | Server-side, over names, tags and the text of inline text files (plaintext, which is all of phase 0). |
| ACL | Per-node grants `(principal, role)`, inherited down the tree; roles `read`, `write`, `manage`. |
| Encryption | None. The per-folder `encrypted` flag and the spec's `scope`, `key_epoch`, `meta` and `wrapped_key` fields exist and are always plaintext / empty. |
| Log | ICRC-3 block log of every write (`src/icrc3`), readable by the owner only; text log of errors. |

## 2 · Owner and controllers

- `owner : ?Principal` is set by the init argument and changed by `set_owner` (owner or any
  controller). While it is `null`, **the controllers are the owner** (the main spec's rule, §2).
- That fits minting on sneedapp: today `createAndInstall` installs with empty args and hands
  control to the minter, so the minter owns the drive as its controller with no drive-specific
  hook. When sneedapp learns per-app init args, it passes `opt record { owner = opt <minter> }`.
- Setting `owner` separates the two: on staging the controller is a dfx identity, the owner an
  II principal. A controller who is not the owner has no access to contents through the API
  (only `set_owner`, which it could force by reinstalling anyway).

Init argument (`opt InitArgs`, all optional, so empty args install too):

```candid
type InitArgs = record { owner : opt principal; settings : opt SettingsUpdate };
```

## 3 · Data model

```
NodeId = Nat (never reused; 0 = root folder, created at install)

Node = {
  id; kind : #folder | #file;
  parent : ?NodeId;               // null only for the root; kept while trashed (ACL still inherits)
  name : Text; name_key : Text;   // name_key = lowercase(name): uniqueness key in the parent (§3 of the spec; NFC later)
  tags : [Text];                  // lowercase, trimmed
  head : ?VersionId; versions : [VersionId];       // files; oldest first
  children : OrderedMap<name_key, NodeId>;         // folders; trashed children are removed from it
  trashed : ?{ at; by; root : Bool };              // root = this node was deleted (not just an ancestor)
  created_at/by; modified_at/by; seq;              // seq: global change counter (the spec's change feed, §8)
  // reserved for phase 1 (spec §3, §5), always plaintext in phase 0
  scope = 0; key_epoch = 0; encrypted = false; meta = "";
}

Version = {
  id; node; size; mime; sha256 : Blob;
  content : #inline Blob | #chunks { hashes : [Blob] };   // only #inline in phase 0
  wrapped_key : ?Blob;                                     // null = plaintext
  format_version = 0;                                      // inline plaintext
  created_at; created_by;
}

Grants   : NodeId -> [(Principal, Role)]     // direct grants
ByGrantee: Principal -> [NodeId]             // for "shared with me"
Trash    : NodeId -> trashed_at              // trash roots
Tags     : tag -> count                      // owner's tag list
```

**Access** of a principal at a node is `owner` for the owner, else the highest role granted on the
node or any ancestor (`read` < `write` < `manage`), else none. A node is **in the trash** when it
or an ancestor is trashed; one walk up the tree (≤ 32 levels) answers both.

| Role | May |
|---|---|
| `read` | get nodes, list folders, read content and old versions, search, list tags, list its trash |
| `write` | + create, save, rename, move (needs `write` on the destination too), tag, delete to trash, restore from trash, restore an old version |
| `manage` | + see the grants on the subtree and grant or revoke `read`/`write`/`manage` there |
| owner | + purge (trash, versions), settings, set owner, logs, ICRC-3 settings |

Anonymous callers are refused on every write (at `inspect` and in the method) and have no access
on reads. Grants to the anonymous principal or the owner are refused.

## 4 · Candid API

Results are `variant { ok : T; err : DriveError }`:

```candid
type DriveError = variant {
  not_found; forbidden; not_signed_in; in_trash; not_in_trash;
  name_taken : nat;                 // the node holding the name
  conflict : record { head : opt nat };   // expected_head did not match
  invalid : text; limit : text;
};
type Content = variant { "text" : text; bytes : blob };   // text = UTF-8, the dfx-friendly form
```

Writes (update calls; `node`/`parent` are `nat`):

| Method | Notes |
|---|---|
| `create_folder({ parent; name; tags })` | → `NodeInfo` |
| `create_file({ parent; name; content; mime : opt text; tags })` | first version; mime defaults from the extension (`.md` → `text/markdown`) |
| `save_file({ node; content; mime : opt text; expected_head : opt nat })` | new version unless bytes are unchanged; `conflict` if `expected_head` is stale |
| `rename(node, name)`, `move_node(node, new_parent)`, `set_tags(node, tags)` | |
| `trash(node)`, `restore(node)` | restore → original parent, or the root when the parent is in the trash; renamed `x (restored).md` if taken |
| `restore_version(node, version)` | copies an old version as the new head |
| `purge(node)`, `empty_trash()` | owner; budgeted, `{ purged; done }`, call again until `done` |
| `purge_versions(node, keep_latest)` | owner; the head is always kept |
| `grant({ node; principal; role })`, `revoke({ node; principal })` | manage on the node |
| `set_settings(SettingsUpdate)`, `set_owner(principal)` | owner (`set_owner`: or a controller) |

Reads (queries, all paged where a list can grow):

| Method | Notes |
|---|---|
| `get_node(node)`, `resolve_path("/Notes/todo.md")` | `NodeInfo` with `my_access`, `in_trash`, `children` count |
| `get_path(node)` | breadcrumbs from the highest readable ancestor |
| `list_children({ folder; after : opt text; limit })` | sorted by name key; `next` = last name key |
| `get_content({ node; version : opt nat })` | `{ version; mime; size; sha256; bytes; "text" : opt text }` |
| `list_versions({ node; before : opt nat; limit })` | newest first, no content |
| `list_trash({ after : opt nat; limit })` | trash roots the caller can read |
| `search({ query; tags; under : opt nat; kind : opt Kind; in_content; after : opt nat; limit })` | `{ hits; next : opt nat }`: scans node ids after `after` with a budget, so `next` can come with fewer hits than `limit`; continue until `next = null` |
| `list_tags({ after : opt nat })` | `{ tags : vec record { tag; count }; next }` (owner: one page from the counts) |
| `list_shared_with_me({ after; limit })` | the caller's direct grants: the entry points for grantees |
| `get_grants(node)` | manage: direct grants here and the ones inherited from above |
| `get_drive_info()` | owner, counts, bytes, settings, limits, version |
| `icrc3_get_blocks`, `icrc3_log_status`, … | the write log; owner only (the standard endpoints, gated) |
| `get_log(start, length)`, `get_api_doc()` | owner text log; short guide |

Scripted use, e.g. Claude with dfx:

```sh
dfx canister call sneed_drive list_shared_with_me '(record { after = null; limit = 50 })'
dfx canister call sneed_drive resolve_path '("/Notes/plan.md")'
dfx canister call sneed_drive get_content '(record { node = 12; version = null })'
dfx canister call sneed_drive save_file '(record { node = 12; content = variant { "text" = "# Plan\n…" }; mime = null; expected_head = opt 41 })'
```

## 5 · Limits

Every list and store is capped. Settings can lower or raise the soft limits up to the hard ones.

| Limit | Default | Hard |
|---|---|---|
| Inline content per version | 64 KiB | 64 KiB |
| Nodes (incl. trash) | 50,000 | 200,000 |
| Versions per file | 200 | 1,000 (at the cap a save is refused with `limit`; the owner purges. A writer can't push history out.) |
| Inline bytes, all versions | 1 GiB | 3 GiB |
| Children per folder | 5,000 | — |
| Depth | 32 | — |
| Name | 1–255 chars, no `/`, no control chars, not `.`/`..`, no leading/trailing space | — |
| Tags | 20 per node, 1–40 chars each, 2,000 distinct per drive | — |
| Grants | 50 per node, 500 per grantee, 10,000 in all | — |
| mime | 100 chars | — |
| Page `limit` | 100 | 200 (search hits: 100) |
| Search scan per call | 5,000 node ids and 16 MiB of content | — |
| Purge per call | 1,000 nodes | — |
| ICRC-3 live blocks before an archive | 10,000 | library settings |

`inspect` refuses queries sent as updates, anonymous writes, and arguments over each method's cap
(64 KiB + names and tags for content writes, 4 KiB for the rest).

**Retention** (`settings.retention`): `keep_versions` (0 = keep all up to the cap; else a save
drops the oldest beyond it, as the owner chose) and `trash_days` (0 = keep forever; else a timer
every 6 hours purges trash roots older than that, 1,000 nodes a run). Both default to 0, so phase 0
keeps everything until the owner purges.

## 6 · How phase 1 extends it (same canister, no data migration)

- **Chunked files**: `Version.content` already has `#chunks`. Files over 64 KiB go through the
  spec's `prepareUpload`/`commitVersion` flow to shards; inline stays for small files and notes.
  New stores (chunk table, shards) are new stable fields, which upgrade cleanly.
- **Encryption**: `encrypted`, `scope`, `key_epoch`, `meta`, `wrapped_key` and `format_version`
  are in the records now. A folder marked encrypted becomes a scope root; names in it would move to
  the encrypted `name_enc` + HMAC `name_key` form (the spec's open question 1). Server-side search
  stays available for plaintext folders only.
- **Permissions**: the three roles map onto the spec's numeric permissions (read = 10,
  write = 11 + 12 + 13, manage = + 1 + 15), so grants can be converted to permission sets; owner
  stays all. Devices and quotas are new fields on grants.
- **Change feed**: `seq` is kept per node and globally; `changes_since` is added on top.
- Records that need new fields go through the mops migration chain (`migrating-motoko-actors`).

## 7 · Left out of phase 0, on purpose

Shards, chunks, files over 64 KiB, vetKeys and encryption, public links and HTTP serving,
devices and pairing, sync, quotas, mass-change guard, change feed queries, thumbnails and photos,
cycles management of shards, sneedapp registration, Sneedex transfer (`prepareForTransfer` /
`claimOwnership`), NFC name normalisation, and a public API doc page. The ICRC-3 archives the
library creates (after 10,000 blocks) are readable by anyone who knows their id; the blocks hold
node ids, principals and sizes, never names, tags or content.
