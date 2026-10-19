# NFT launchpad (draft)

Anyone can launch an ICRC-7 NFT collection from Sneed Hub: configure it, pay once, get a collection
canister they (or a DAO) control, then mint, airdrop or sell its NFTs. Launched collections work at
once in the NFT wallet, the NFT browser, NFT avatars and Sneedex.

Status: draft for the user's decisions (marked **Q**). Nothing is built yet.

## 1. What exists to build on

- **Sneed Pad** (`src/sneed_pad`, spec/token_safety.md §4) already does the launch: a quote from
  the CMC rate, one ICP payment by ICRC-2, cycles bought through the CMC, the fee to the RLL, a new
  canister, a control choice (`#keep`, `#keep_with`, `#blackhole`, `#sneed_dao`, `#sns`,
  `#guardian`), rescue of half-finished launches, an ICRC-3 log, and listing the canister in the
  creator's SneedApp wallet (`registerCanisterFor`).
- **icrc7_demo** (`src/icrc7_demo`) is the seed of the collection canister: ICRC-7, ICRC-37 and
  ICRC-10, admins who mint. It is not fit for real collections: stable arrays scanned per call,
  one mint per call, no burn, no metadata updates, no ICRC-3 log, no `inspect`, no metadata size cap.
- **SneedApp** lists canisters in the user's wallet and offers upgrades from published versions,
  but installs with empty init args, so it cannot mint a collection directly (it can list and
  upgrade it).
- **Sneedex** accepts any ICRC-7 collection (escrow by transfer or ICRC-37 approval).
- **Frontend conventions** the collection must carry unchanged: `name`, `description`, `image`,
  `attributes`, `animation_url`, `icrc97:metadata`, and the game keys `wu:stats`, `wu:items`,
  `bound_to` (components/CharacterPanel.jsx, Soulbound.jsx).

## 2. Design

### 2.1 The collection canister: `sneed_nft`

Our own implementation (no ICRC-85; see the no-OVS rule), grown from icrc7_demo:

- **Standards:** ICRC-7, ICRC-37, ICRC-3 (via `src/icrc3`, blocks `7mint`, `7burn`, `7xfer`,
  `7update_token`, `37approve`, `37revoke_*`, `37xfer`), ICRC-10. EOP (`persistent actor`).
- **Storage:** maps, not arrays: token id → owner, metadata; owner → token ids. Metadata size capped
  per token (default 8 KB) and per collection.
- **Mint:** batch `icrcX_mint(vec SetNFTRequest) -> vec SetNFTResult`, shaped like PanIndustrial's
  icrc7-mo. *Verify the exact types against that repo before building.* Ids assigned by the
  canister unless the creator gives them. Plus `icrcX_burn` (owner burns their own; creator burns
  only if the collection allows it).
- **Roles:** controllers; *minters* (may mint, up to their allowance); *metadata editors*.
- **Metadata policy,** chosen per collection and only ever tightened: `#mutable` (editors may update
  any token), `#append_only` (new keys only), `#frozen`. `freeze_metadata()` is one-way.
- **Supply cap,** optional, only lowerable. `lock_minting()` ends minting forever.
- **Guard:** `inspect` like the other DAO canisters (queries as updates refused, argument caps).
- **Upgrades:** published as a SneedApp app (`icrc7-collection`, publisher 0 = Sneed DAO), so the
  wallet's upgrade dialog works as for bots and ledgers: each version reads the previous one's
  state.

### 2.2 Launch: a new stage in Sneed Pad

`create_collection(config, control)`, the same pay-once flow as `create_token`: quote, ICRC-2
payment, cycles, fee, `create_canister`, `install_code` with the collection's init args, control,
`registerCanisterFor(caller, id, "icrc7-collection")`. Config: name, symbol, description, logo,
supply cap, metadata policy, royalty (if §3 Q3 is yes), initial minters (default: the creator).

### 2.3 Minting and drops (frontend + canister)

- **Creator minting:** a mint page in the NFT wallet (it exists for the demo): one NFT, a batch from
  a CSV/JSON plus images, or an airdrop to a list of principals (with PrincipalInput).
- **Public drop** (if §3 Q1 is yes): a sale config on the collection canister: price in any ICRC-1
  token (TokenSelector), start/end time, per-wallet limit, optional allowlist, proceeds to the
  creator's account, Sneed DAO's cut to the RLL. Buyers pay by ICRC-2 and receive the next token.

### 2.4 Frontend

- A **Collection** tab in Token Studio (`/studio/collection`) behind `ComingSoonGate` until release:
  the form, the quote, approve and launch, then a link to the collection's mint page.
- After launch the collection is added to the creator's NFT wallet list, and offered for NFT
  avatars and Sneedex.
- `/nfts` (browser) shows a "Launched on Sneed Hub" badge for collections from the pad.

## 3. Questions for the user

1. **Drops in v1?** Creator minting and airdrops only, or also public sales (price, limits,
   allowlist)? Suggest: creator minting first, drops as v1.1.
2. **Where do pictures live?** (a) links only (https, IPFS), (b) on-chain in the collection canister
   (served over HTTP, costs cycles, permanent), (c) both. Suggest (c), with on-chain capped in size.
3. **Royalties?** A creator royalty in basis points that Sneedex pays on resales (needs a Sneedex
   change; other markets may ignore it).
4. **Metadata:** is the per-collection policy (mutable / append-only / frozen, tightening only)
   right? Games need mutable stats; art collectors want frozen.
5. **Fees:** token launches cost 5 ICP (2.5 with Premium), +5 ICP for DAO or guardian control.
   Same for collections, or cheaper (a collection canister is one canister, not two)?
6. **Your game:** should its item, character and map collections be launched here, so the `wu`
   conventions (character accounts, soulbound `bound_to`) get first-class support in the mint UI?
7. **Name:** "NFT launchpad" in Token Studio, or its own place (e.g. /studio/nft, "Collection
   Studio")?

## 4. Build order

1. `sneed_nft` canister with tests (PocketIC), replacing icrc7_demo on staging.
2. Pad stage `create_collection` + SneedApp app entry; staging launches.
3. Studio tab and the mint page; staging browser test.
4. Drops (if in scope), then release: one upgrade proposal for sneed_pad (Keep), SneedApp version
   publish, frontend deploy.
