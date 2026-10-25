/// get_api_doc text of sneed_drive (Sneed Drive phase 0). Design: spec/sneed_drive_phase0.md.
module {
  public let text : Text = "# Sneed Drive (canister sneed_drive), phase 0

A personal drive: a folder tree of small files (at most 64 KiB a version, stored inline), a version on every save, a trash, tags on any item, search, and grants for other principals. Notes are markdown files (`text/markdown`).

## Units and encoding
- Node ids are `nat`, never reused; the root folder is `0`. Version ids are `nat`. Times are `int` nanoseconds since the Unix epoch.
- Content in: `variant { text : text; bytes : blob }`. Content out: `bytes`, plus `text` when the bytes are valid UTF-8.
- Results: `variant { ok : T; err : DriveError }`, with `DriveError = not_found | forbidden | not_signed_in | in_trash | not_in_trash | name_taken : nat | conflict : record { head } | invalid : text | limit : text`.
- Pages: pass `next` back as `after` (`before` for versions) until it is null. `limit` 0 means 100; the most is 200 (search hits: 100). `search` and `list_tags` scan a budget of node ids per call, so a page can hold fewer items than `limit` and still have a `next`.

## Authentication and access
- Every write refuses the anonymous principal, and every read checks access.
- The owner (`get_drive_info().owner`; the controllers while it is null) may do everything, including purging and settings.
- `grant` / `revoke` give a principal `read`, `write` or `manage` on an item and everything under it. `manage` may grant and revoke there. A grantee finds their items with `list_shared_with_me`.

## Common calls
- `resolve_path(\"/Notes/plan.md\")`, `get_content(record { node = 12; version = null })`
- `create_file(record { parent = 0; name = \"plan.md\"; content = variant { text = \"# Plan\" }; mime = null; tags = vec { \"work\" } })`
- `save_file(record { node = 12; content = variant { text = \"...\" }; mime = null; expected_head = opt 41 })` (`conflict` if someone saved in between)
- `list_children(record { folder = 0; after = null; limit = 100 })`, `list_versions(record { node = 12; before = null; limit = 50 })`
- `search(record { query = \"word\"; tags = vec {}; under = null; kind = null; in_content = true; include_trash = false; after = null; limit = 50 })`
- `trash(node)`, `restore(node)`, `restore_version(node, version)`; owner only: `purge(node)`, `empty_trash()`, `purge_versions(node, keep_latest)`

## Irreversible actions
- `purge`, `empty_trash`, `purge_versions` and the retention settings delete for good. Only the owner can do them.
- Nothing is encrypted in phase 0: contents can be read by the canister's controllers and the subnet's node providers.
";
};
