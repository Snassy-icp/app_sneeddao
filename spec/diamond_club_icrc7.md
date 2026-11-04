# Sneed Diamond Club on ICRC-7 (proposal #416, step 4)

The Sneed Diamond Club (1,000 membership cards) moves from its EXT canister to a DAO-owned ICRC-7
collection with every image stored in the collection canister itself. Holders swap 1:1: they give
the EXT card, they get the same card number on ICRC-7.

Status: draft for the user's decisions (marked **Q**). Nothing is built yet.

## 1. Why

- The EXT collection `gjv36-laaaa-aaaah-adyza-cai` keeps its images off-chain only, at
  `https://cf-assets.yuku.app/BatchMint/Sneed/<n>.jpg`. That host has returned HTTP 500 since
  2026-10-20, so every wallet shows blank cards.
- The EXT canister's controller (h3nxl-…) is Yuku, which has not answered in over a year. Nobody in
  the DAO can fix the links in place.
- The artwork has been recovered: 1,000 JPEGs (2000×2000) plus their metadata. Checked on
  2026-11-04: the metadata is identical to the on-chain EXT metadata for all 1,000 cards, with no
  duplicate images. The artist stays anonymous: no credits or names anywhere (code, metadata, UI).

## 2. Facts about the EXT collection

- 1,000 tokens; EXT token index `n` is card `#n+1` (`Sneed Diamond Club #<n+1>`, image `<n+1>.jpg`).
- Metadata (JSON in `nonfungible.metadata`): `name`, `image`, `description`, `attributes`
  (`Card Number`, `Card Type` with 22 values, `Background`), `compiler`, `external_url`, `url`,
  `thumb`.
- 314 distinct holder accounts. One account (`9840813037ed…`) holds 476 cards; the next largest
  hold 30, 24 and 21 (2026-11-04).
- The EXT interface has `approve(ApproveRequest)`, `allowance`, `bearer`, and
  `transfer(TransferRequest)` with a `from` user, so a spender with an allowance can move a card.
- Sneed Hub reads it through `src/app_sneeddao_frontend/src/utils/ExtUtils.js`.

## 3. Design

### 3.1 The collection canister

The Diamond Club is the first collection on `sneed_nft`, the collection canister planned in
spec/nft_launchpad.md §2.1 and grown from `src/icrc7_demo`. Building it for the Diamond Club
first means the launchpad gets a canister that already holds a real collection.

- **Standards:** ICRC-7, ICRC-37, ICRC-10, and ICRC-3 via `src/icrc3` (blocks `7mint`, `7burn`,
  `7xfer`, `37approve`, `37revoke_*`, `37xfer`, plus a `dcswap` block for each swap). EOP
  (`persistent actor`), `inspect` ingress guard, timers only when there is work (none expected).
- **Storage:** maps, not arrays (token id → owner, owner → token ids, token id → metadata).
- **Metadata:** the EXT metadata carried over unchanged (`name`, `description`, `attributes`,
  `external_url`), with `image` set to the canister's own URL and a new `image_sha256`. Token ids
  are card numbers 1–1000 (not EXT indexes). The policy is `#frozen` once the load is done.
- **Supply:** exactly 1,000, all minted at load time to the canister's own swap account. Minting is
  locked forever after the load (`lock_minting()`).

### 3.2 Images in the canister

- Three sizes per card: the original (2000 px, ~666 MB in total), a web size (800 px, ~100 KB each)
  and a thumbnail (256 px, ~20 KB each). About 0.8 GB in all, stored in stable memory regions.
- **Upload:** chunked (ingress limit 2 MB) by an uploader principal during the load phase. The
  canister computes each image's SHA-256 on finish and refuses an image whose hash differs from the
  manifest committed beforehand. The manifest (1,000 hashes) is set once and published in the
  proposal, so anyone can check that the on-chain art is the recovered art.
- **Serving:** `http_request` at `https://<canister>.icp0.io/card/<n>.jpg` (`?size=web|thumb`),
  with long cache headers. Responses must be certified so wallets and browsers accept the normal
  (not raw) domain. **Verify before building:** which Motoko certification library to use (asset
  certification v2), and that it is ICRC-85-free.
- **Cost:** a one-time upload of about 1–2 T cycles, then storage of about 0.8 GB, a few dollars a
  year. Serving is paid by the canister; caching keeps it small.

### 3.3 The swap

One card at a time or in batches, from Sneed Hub:

1. The holder calls EXT `approve` for the card, with the collection canister as spender.
2. The holder calls `swap(vec ext_index)` on the collection canister.
3. For each card, the canister checks `bearer` is the caller's account, moves the EXT card to itself
   with EXT `transfer` (`from` = the caller), then transfers ICRC-7 token `index + 1` from its swap
   account to the caller. Each swap is logged (`dcswap`: caller, EXT index, ICRC-7 id).
4. A per-card lock prevents two swaps of the same card at once. If the EXT transfer fails, nothing
   changes; if the ICRC-7 transfer fails after the EXT card arrived, the card is recorded as owed
   and `retry_swap` (callable by the holder or anyone) delivers it.

- EXT cards held by the canister are never moved again: in effect they are retired.
- Cards held by an account identifier only (no principal), or listed on Yuku, cannot swap until the
  holder moves them to a principal-based account and delists. Sneed Hub explains this.
- **No deadline:** the swap stays open as long as unswapped cards exist.

### 3.4 Control

- Created with cycles; the owner sets the controllers to SNS root (plus a dev principal only until
  the load is done; see §5). Claude never changes controllers. Registered as a dapp canister of
  the Sneed SNS.
- After the load: upgrades only by DAO proposal, metadata frozen, minting locked. Admin methods that
  remain go behind a GNSF (one per canister, per the DAO-settings rule).

### 3.5 Frontend

- The NFT wallet, the NFT browser, NFT avatars and Sneedex already read ICRC-7; the Diamond Club
  collection is added to the known list.
- A **Swap** button on EXT Diamond Club cards in the wallet: approve, swap, done, with a clear
  account display (no anonymity options). Batch swap for holders with many cards.
- Until a card is swapped, Sneed Hub shows the EXT card with the image from the new canister (same
  card number), so blank cards are fixed for everyone from day one.

## 4. Questions for the user

1. **The 476-card account** (`9840813037ed…`): is it the DAO treasury, a marketplace escrow, or a
   member? If it is the DAO's, those cards can swap in one batch by proposal.
2. **One-way or two-way?** One-way (EXT → ICRC-7) is simpler and retires EXT. Two-way keeps Yuku
   trading possible. Suggest: one-way.
3. **Royalty:** Yuku pays 3% to the treasury today. Keep a royalty on Sneedex resales (needs a
   Sneedex change)?
4. **Discord role:** the Diamond Club role on the public server is granted by a bot that checks EXT
   holdings. Who runs it, and can it read ICRC-7? Otherwise swapped holders lose the role.
5. **Image sizes:** keep the 2000 px originals on-chain (~666 MB), or only web and thumbnail
   (~120 MB)? Suggest: keep the originals; the art exists nowhere else.
6. **Symbol and logo:** symbol `SDC`? Logo: card #1000 (the plain emblem card)?

## 5. Build order

1. `sneed_nft` canister: collection, image store and swap, with PocketIC tests (a mock EXT canister
   for the swap, including the failure and retry paths, and an idle-cost test).
2. Staging: create the canister, load all 1,000 cards and images, test swaps with staging EXT test
   tokens.
3. Mainnet: create the canister, load it (images checked against the manifest), freeze metadata,
   lock minting, then the owner hands it to SNS root.
4. Proposals: register the dapp canister with SNS root, then the frontend release (swap UI, image
   fallback).
5. Announce in the forum News topic and in #diamond-club.
