# Sneed NFT collection canister API (sneed_nft)

**Status: in the source, not deployed yet.** The first collection on it is the Sneed Diamond Club (1,000 cards), moving from the EXT canister `gjv36-laaaa-aaaah-adyza-cai` to ICRC-7 with every image stored in the canister. Design: [spec/diamond_club_icrc7.md](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/diamond_club_icrc7.md), [spec/nft_launchpad.md §2.1](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/nft_launchpad.md).

## 1. Mental model

- **An ICRC-7 collection** with ICRC-37 approvals, ICRC-10 and an ICRC-3 log of everything that changes. Token ids are card numbers: EXT token index `n` is ICRC-7 token `n + 1`.
- **The load** (admins, once): collection metadata, the SHA-256 manifest of the original images (set once; its own hash, `image_manifest_hash`, is what a proposal publishes), batch mint to the **swap account** (this canister's default account), image upload in chunks with the SHA-256 computed by the canister and checked against the manifest, then the one-way `freeze_metadata()` and `lock_minting()` (every minted token must be in the swap account).
- **Images over HTTP**, certified (response verification v2), so the normal domain works: `https://<canister>.icp0.io/card/<n>.jpg` (the original), `?size=web` (800 px) and `?size=thumb` (256 px); `/logo.jpg`; anything else is a certified 404. Originals over 1.5 MB are streamed.
- **The swap**, open once the metadata is frozen and minting is locked, until every card is swapped:
  - *By send*: the holder sends the EXT card to their **swap address** (`swap_address(p)`), from any wallet; `claim_swap(p)` (anyone may call it for `p`) delivers every card held there, and every card sent to `p`'s proof address by mistake. The EXT canister's registry decides who holds what; a card is delivered once, ever.
  - *By proof of payment*, for a wallet that can still send tokens but not NFTs: the wallet pays a small amount of an allow-listed token to `p`'s **proof address** (`proof_address(p)`), and `claim_by_proof(p, ledger, block_index, sender)` delivers every unswapped card held by the paying account (its principal's default account and the subaccount it paid from), **retires** those EXT cards (they stay in the old wallet and can never be swapped again: `list_retired`) and refunds the payment minus the ledger fee.
  - EXT cards received are never moved again.

### 1.1 Who may pay a proof

Only a wallet's own key (a self-authenticating principal), never a canister: a canister pays for whoever it serves (an exchange, a marketplace, an escrow), so its payment proves nothing about the cards it holds. Transfers made with an ICRC-2 approval (by a spender) and anything that is not a plain transfer are refused. Only allow-listed ledgers count, because a fake ledger could report any payment (planned list: SNEED only).

- **ICRC-3 ledgers** (SNEED, ckBTC, ...): the block names the sender's principal; `sender` is not needed.
- **The ICP ledger** records only an account identifier: `sender` must give the paying principal and subaccount (`null` for the default one); they must hash to exactly that identifier, and the principal must be a key.

### 1.2 Refunds

Each refund attempt sends the same transfer (amount, fee, memo `SHA-256("sdc-refund" ‖ "<ledger>:<block>")`, `created_at_time`), so the ledger deduplicates a retry of an attempt whose outcome was unknown. States: `pending`, `in_flight`, `done { block }`, `failed` (retry with `retry_refund`, anyone), `needs_admin`, `none` (the payment did not cover the fee). An attempt still `in_flight` 10 minutes later is over (the canister trapped after the ledger call): `retry_refund` resends it. Resends stop 23 hours after the first attempt (the ledger deduplicates for 24 hours): the refund becomes `needs_admin`.

**Runbook, `admin_reset_refund(ledger, block, checked_no_refund_on_ledger)`**: it gives the refund a new `created_at_time` (and the current fee) and sends it, so the ledger will **not** recognise an earlier attempt. Use it only after looking up the proof address's outgoing transfers on the ledger (`icrc3_get_blocks`, or the ledger's index) and finding no refund of this payment (memo above, to the sender). If one exists, do not reset: the payer was paid.

### 1.3 Who controls what

- **Admins** (controllers and `get_admins`) run the load. After it (minting locked), the settings that decide who receives cards or that guard the canister's cycles change **only by DAO proposal** through one generic nervous system function, `dao_admin` (validator `validate_dao_admin`): proof ledgers, the EXT canister, the admin list, rate limits, the deduplication cap and the log settings. Admins can still pause the swap (`admin_set_swaps_paused(true)`); resuming takes a proposal.
- Rate limits (`get_rate_limits`): `claim` (per caller), `proof` (per caller), `refund` (per caller), `claims_global` (all callers together) and `nft_update` (ICRC-7 / ICRC-37 updates, per caller and item). Admins are exempt.

### 1.4 Calls the canister refuses at ingress

Query methods sent as update calls; admin methods from others; `dao_admin` (governance calls it inter-canister); the swap methods from the anonymous principal or over their rate limits; arguments over their size caps (batches of at most 20 items, upload chunks of at most 1.9 MB).

## 2. Quick start

```js
import { idlFactory } from './sneed_nft.did.js';
const nft = Actor.createActor(idlFactory, { agent, canisterId });
// swap by send
const address = await nft.swap_address(me);     // send the EXT cards here, from any wallet
await nft.claim_swap(me);                        // { ok: { delivered, already_swapped, unavailable } }
// proof by payment (SNEED)
const { account } = await nft.proof_address(me); // pay a small amount from the stuck wallet to this account
await nft.claim_by_proof(me, sneedLedger, blockIndex, []); // ICP: [{ owner: payer, subaccount: [] }]
```

## 3. Method reference

### 3.1 ICRC-7, ICRC-37, ICRC-10
`icrc7_collection_metadata`, `icrc7_name`, `icrc7_symbol`, `icrc7_description`, `icrc7_logo`, `icrc7_total_supply`, `icrc7_supply_cap`, `icrc7_max_*`, `icrc7_default_take_value`, `icrc7_atomic_batch_transfers`, `icrc7_tx_window`, `icrc7_permitted_drift`, `icrc7_token_metadata`, `icrc7_owner_of`, `icrc7_balance_of`, `icrc7_tokens`, `icrc7_tokens_of`, `icrc7_transfer`; `icrc37_approve_tokens`, `icrc37_approve_collection`, `icrc37_revoke_token_approvals`, `icrc37_revoke_collection_approvals`, `icrc37_transfer_from`, `icrc37_is_approved`, `icrc37_get_token_approvals(token_ids, prev, take)`, `icrc37_get_collection_approvals`, `icrc37_max_*`; `icrc10_supported_standards`. Transfers with `created_at_time` are deduplicated for 24 hours (at most `dedup_cap` remembered at once; when full, send without `created_at_time` or later). Only holders may approve the collection. Nothing can be sent to the canister itself.

Token metadata: `name`, `description`, `attributes`, `external_url` as loaded, plus `image` (this canister's URL) and `image_sha256` (hex of the original) for every card in the manifest.

### 3.2 The swap
`swap_address(p)` (EXT account identifier, hex, of this canister and `swap_sub(p) = SHA-256("sdc-swap" ‖ p)`), `swap_subaccount(p)`, `proof_address(p)` (`{ account; account_id }`, subaccount `SHA-256("sdc-proof" ‖ p)`), `claim_swap(p)`, `claim_by_proof(p, ledger, block_index, sender)`, `retry_refund(ledger, block_index)`; reads `get_swap(ext_index)`, `get_swaps`, `list_swaps(prev, take)`, `list_retired(prev, take)`, `get_proof(ledger, block_index)`, `list_proofs(start, take)`, `pending_refunds()`, `status()`. `claim_swap` reads the EXT registry at most once per 30 seconds for all callers (a card sent seconds ago may need a second claim half a minute later); one read runs at a time (a caller arriving during it is asked to come back).

### 3.3 Images and HTTP
`http_request`, `http_request_streaming_callback`, `get_image_info(targets)`, `image_manifest_hash()`, `get_image_manifest(prev, take)`, `get_uploads()`.

### 3.4 Admin methods
The load: `set_collection`, `set_image_manifest` (once), `icrcX_mint` (the shape of icrc7-mo's `set_nfts`, metadata as an ICRC-3 `Value` map; `override` updates metadata until the freeze), `image_upload_begin` / `image_upload_chunk` / `image_upload_finish` / `image_upload_abort`, `image_upload` (one call, up to 1.9 MB), `freeze_metadata`, `lock_minting`. Settings (DAO-only after the load, see 1.3): `admin_set_proof_ledger`, `admin_remove_proof_ledger`, `admin_set_ext_canister`, `admin_set_swaps_paused`, `admin_add_admin`, `admin_remove_admin`, `admin_set_rate_limit`, `admin_set_dedup_cap`, `admin_set_icrc3_settings`. Always: `admin_reset_refund` (see the runbook in 1.2), `admin_icrc3_spill_now`, `admin_rebuild_certification`, `get_log(start, length)`. Controllers: `admin_set_governance`. Governance: `dao_admin`, `validate_dao_admin`.

## 4. Activity log (ICRC-3)

`icrc3_get_blocks`, `icrc3_get_archives`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types`, `icrc3_log_status`. Blocks are `Map { btype; ts; phash; tx }`; in `tx` principals are `Blob`, accounts `Array [owner, subaccount?]`, numbers `Nat`. Archives are co-controlled by this canister and the Sneed SNS root. The certified tree that holds the tip also holds the HTTP responses, so the tip certificate's witness has a pruned `http_expr` branch.

### 4.1 Block types

| `btype` | When | `tx` fields |
|---|---|---|
| `7mint` | A token minted (load). | `tid`, `to`, `meta` (`Map { "icrc7:token_metadata": Map }`), `memo`?, `ts`? |
| `7update_token` | Metadata replaced before the freeze. | `tid`, `from` (the admin), `meta` |
| `7xfer` | `icrc7_transfer`, and every delivery of the swap (from the swap account). | `tid`, `from`, `to`, `memo`?, `ts`? |
| `37approve` / `37approve_coll` | A token / collection approval. | (`tid`), `from`, `spender`, `exp`?, `memo`?, `ts` |
| `37revoke` / `37revoke_coll` | A revocation (no `spender`: all). | (`tid`), `from`, `spender`?, `memo`?, `ts`? |
| `37xfer` | `icrc37_transfer_from` | `tid`, `from`, `to`, `spender`, `memo`?, `ts`? |
| `dcswap` | An EXT card swapped (one per card, after its `7xfer`). | `caller`, `recipient`, `ext_index`, `tid`, `method` (`send` / `proof`), `bearer` (the EXT holder's account identifier), `xfer` (the `7xfer` block); proofs also `ledger`, `ledger_block` |
| `dcrefund` | A proof payment refunded. | `caller`, `ledger`, `ledger_block` (the payment), `to` (account, or account identifier `Blob` for ICP), `amount`, `fee`, `refund_block` |
| `sneednft_image` | An image stored. | `caller`, `target` (`card/<n>/<orig|web|thumb>`, `logo`), `sha256`, `size`, `content_type` |
| `sneednft_config` | A setting changed (one block each). | `caller`, `key`, `value`; `image_manifest` also `entries`; `proof_ledger` also `kind`; `rate_limit` also `action`; `icrc3_*` also `old_value` |

`sneednft_config` keys: `name`, `symbol`, `description`, `logo`, `supply_cap`, `image_manifest`, `metadata_frozen`, `minting_locked`, `proof_ledger`, `proof_ledger_removed`, `ext_canister`, `swaps_paused`, `admin_added`, `admin_removed`, `rate_limit`, `dedup_cap`, `governance`, `icrc3_*`.
