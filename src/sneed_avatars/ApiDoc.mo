/// get_api_doc text of sneed_avatars: Avatar image store of the Sneed naming service. Full reference: https://app.sneeddao.com/api-docs/sneed_names.md
module {
  public let text : Text = "# Sneed avatars (canister sneed_avatars)

Stores avatar images content-addressed by SHA-256 and serves them over HTTP. Names and nicknames point at an image with `AvatarRef.blob` (the 32-byte hash).

Production: `ev5f4-4yaaa-aaaad-qmk3q-cai`. Staging (same code, own state and admins; test there first): `rapit-ziaaa-aaaad-ag6nq-cai`.

The Sneed DAO naming service is six canisters (production ids):
- sneed_pid_names `ejz7n-lyaaa-aaaad-qmkzq-cai`: accounts (name, checkmark, avatar shared by several principals), hotkeys, canister names, search
- sneed_neuron_names `e46oa-kqaaa-aaaad-qmk2a-cai`: public names of SNS neurons
- sneed_pid_nicknames `e37iu-hiaaa-aaaad-qmk2q-cai`: each user's own labels for principals
- sneed_neuron_nicknames `es4di-raaaa-aaaad-qmk3a-cai`: each user's own labels for SNS neurons
- sneed_profiles `fytbs-tqaaa-aaaad-qmk4a-cai`: the dapp registry
- sneed_avatars `ev5f4-4yaaa-aaaad-qmk3q-cai`: avatar images by SHA-256, served over HTTP

## Units and encoding
- An image is identified by its 32-byte SHA-256 (`blob`). Served at `https://ev5f4-4yaaa-aaaad-qmk3q-cai.raw.icp0.io/<64 hex characters>` (`GET`/`HEAD`; immutable cache, CORS `*`; 404 unknown or removed).
- PNG, JPEG, GIF or WebP only (type read from the bytes), at most 48 KiB.
- `ImageInfo = { hash; content_type; size; holders; created_at }`, `created_at` in `nat64` nanoseconds.
- `upload` returns `variant { ok : blob; err : text }` (the hash); `release` returns `variant { ok : text; err : text }`. `get_info` takes at most 500 hashes, `get_images` at most 20 (trap above).

## Authentication
- Reads (`get_info`, `get_images`, `http_request`, `stats`) are public; `my_images` lists the caller's held images.
- `upload` and `release` need a signed-in principal (`Please sign in`). Uploads are signed by the caller's principal and images are public: nothing here is anonymous or private.

## Fees, transfers and irreversible actions
- No fees and no token transfers. Each principal holds at most 20 images (200 with Sneed Premium).
- An image is stored once; uploading an existing one makes the caller a holder. `release` stops holding it; an image nobody holds is freed (deleted), and names pointing at it then show no avatar.
- Admins can remove an image for everyone (`admin_remove`); a removed image can never be uploaded again (`This image was removed`).

## Asynchronous lifecycle and polling
- `upload` completes in one call (it may ask the premium canister for the holding limit). Then set the hash as an avatar in sneed_pid_names, sneed_neuron_names or a nickname canister. No polling needed.

## Errors, retries and Busy
- No Busy state. Re-uploading the same bytes is idempotent (same hash).
- Errors: `Images may be at most 48 KiB`, `Only PNG, JPEG, GIF and WebP images`, `This image was removed`, `You hold N images already; release one first`, `You do not hold that image`.
- `Rate limited: too many changes in a short time, please try again in a minute`: per-caller limits on writes (actions `upload`, `release`; `get_rate_limits` lists them, admins set them with `admin_set_rate_limit`). Once a caller is over the limit its next calls are also refused at ingress until it refills. Nothing was stored; wait and retry.

## Common pitfalls
- Query methods answer only query calls; sent as update calls they are refused by the ingress guard (inspect_message). Calls from other canisters are not affected.
- Anonymous update calls are refused at ingress; `upload` arguments are capped at 64 KiB, other calls at 4 KiB.
- In browsers use the HTTP URL rather than `get_images`.

## Start with these methods
- `upload(bytes)`, `release(hash)`, `my_images`, `get_info`, `get_images`, `stats`, `get_config`

## Full reference
- https://app.sneeddao.com/api-docs/sneed_names.md (all six canisters)
- Candid: https://app.sneeddao.com/api-docs/sneed_avatars.did
- https://app.sneeddao.com/llms.txt
";
};
