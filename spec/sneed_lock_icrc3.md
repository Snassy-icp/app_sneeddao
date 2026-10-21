# Sneed Lock activity log (ICRC-3)

Design for a structured, hash-chained, certified activity log in the `sneed_lock`
canister, exposed through the ICRC-3 block log interface, with an extensible chain of
archive canisters. Written 2026-10-12; implementation follows this document unless a
section says otherwise.

**Status (2026-10-20): built and live.** The library is `src/icrc3` (Log.mo, Archive.mo,
Hash.mo, SnsRegister.mo); `sneed_lock` uses it. On mainnet the history import has run and the
log holds its blocks live (no archive created yet). Sneed Lock v2 (spec/sneed_lock_v2.md) added
block types, listed below with the original catalogue.

## Goals

- Every state-changing action in Sneed Lock produces one structured block: lock
  created, extended, transferred, withdrawn, fee paid, fees claimed, liquidity added,
  admin and configuration actions.
- Blocks are hash-chained (`phash`) and the tip is certified by the IC, so anyone can
  verify the history without trusting the Sneed app or the DAO.
- Standard ICRC-3 read interface (`icrc3_get_blocks`, `icrc3_get_archives`,
  `icrc3_get_tip_certificate`, `icrc3_supported_block_types`), so existing explorers,
  Rosetta-style indexers and agent tooling can read it.
- Old blocks move to archive canisters in stable memory; the chain of archives grows
  without governance action when one fills up.
- No third-party library that shares cycles with anyone. The implementation is
  in-house, a few hundred lines, and uses the current release toolchain (dfx 0.28.0,
  moc 0.14.13, classic persistence). It works unchanged under enhanced orthogonal
  persistence.

## Non-goals

- Not a token ledger: no ICRC-1 blocks, no balances. Sneed Lock stays what it is.
- Does not replace the existing text logs (`get_info_entries`, `get_error_entries`),
  which keep recording failures and diagnostics. The block log records what happened,
  not what failed.
- No backfill of events before this release. The log starts with an import of the
  current state (every active and archived lock) so it is complete from its first
  block onward.

## Architecture

```
 user ──update call──► sneed_lock ──append block──► live store (bounded, stable heap)
                            │                              │ spill when ≥ max_live
                            │ CertifiedData.set(tip)       ▼
                            │                     archive #1 (Region) ─full─► archive #2 ─► ...
                            ▼
                    icrc3_get_blocks: live blocks + callbacks to the right archive
```

- **Append** happens synchronously inside the update call that performed the action,
  after the state change is committed to local state. No cross-canister call is
  involved, so a block can never be lost or reordered relative to the action.
- **Spill** is a separate background step: a recurring timer (every 15 minutes)
  checks the live store and moves the oldest blocks to the newest archive in batched
  calls, forgetting them locally only once the archive has acknowledged. An admin can
  run the same routine on demand. The timer keeps the user's own call free of any
  cross-canister work and of the system capability the timer API needs.
- **Archives** are instances of an actor class compiled into `sneed_lock`, created by
  `sneed_lock` with a cycle grant, controlled by `sneed_lock` and SNS root. They store
  encoded blocks in stable memory `Region`s, so their capacity is the canister's
  stable memory limit, not the Motoko heap.
- **Certification**: after every append `sneed_lock` sets its certified data to the
  root hash of a two-leaf tree (`last_block_index`, `last_block_hash`). Archived blocks
  are verified by walking `phash` back from the certified tip.

## Block format

Every block is an ICRC-3 `Value` of variant `Map` with these top-level fields:

| field   | type | meaning |
|---------|------|---------|
| `btype` | Text | block type, see catalogue below |
| `ts`    | Nat  | time the block was appended, nanoseconds since epoch |
| `phash` | Blob | hash of the previous block; absent on block 0 only |
| `tx`    | Map  | the action's data; fields depend on `btype` |

Encoding conventions inside `tx`:

- principals: `Blob` (raw principal bytes, as in ICRC-3 account owners)
- ICRC-1 accounts: `Array [Blob owner, Blob subaccount]` (subaccount omitted when
  default), exactly the ICRC-3 account representation
- amounts, ids, timestamps, expiries: `Nat` (base units; nanoseconds since epoch)
- `cid`: `Nat`, the correlation id that ties the block to the text log entries of the
  same call
- `caller`: `Blob`, the principal that made the call (equals the owner for user
  actions, the admin principal for admin actions)
- optional fields are omitted when absent, never encoded as empty values

Hashing is the ICRC-3 representation-independent hash: `Nat` as unsigned LEB128,
`Int` as signed LEB128, `Text` as UTF-8, `Blob` raw, `Array` as the concatenation of
element hashes, `Map` as the concatenation of the sorted `hash(key) ‖ hash(value)`
pairs, each wrapped in SHA-256. This is the same algorithm as IC request ids, which
gives a published test vector to check against.

## Block type catalogue

All block types carry the `sneedlock_` prefix. ICRC numbers are reserved for ICRC
standards, so a letter prefix cannot collide with any of them. The `url` reported by
`icrc3_supported_block_types` for every type is
`https://app.sneeddao.com/api/sneed_lock#block-types`, where this catalogue will be
published.

Lifecycle of the log itself:

| btype | when | tx fields |
|-------|------|-----------|
| `sneedlock_log_start` | first block ever, written by the history import | `canister` Blob, `current_lock_id` Nat, `active_token_locks` Nat, `active_position_locks` Nat, `archived_token_locks` Nat, `archived_position_locks` Nat, `total_token_lock_fees_e8s` Nat, `total_position_lock_fees_e8s` Nat |
| `sneedlock_import_token_lock` | one per token lock that existed at log start | `owner`, `ledger`, `lock_id`, `amount`, `expiry`, `status` Text (`active` or `expired`) |
| `sneedlock_import_position_lock` | one per position lock that existed at log start | `owner`, `pool`, `position_id`, `lock_id`, `expiry`, `token0`, `token1`, `dex` Nat, `status` Text |
| `sneedlock_import_position_claim` | one per claimed position without a lock at log start | `owner`, `pool`, `position_id` |

Token locks:

| btype | when | tx fields |
|-------|------|-----------|
| `sneedlock_token_lock_create` | `create_lock` succeeded | `cid`, `caller`, `owner`, `ledger`, `lock_id`, `amount`, `expiry` (the requested `expires_at`); `dissolve_delay` when the lock has one (v2) |
| `sneedlock_token_lock_transfer` | `transfer_token_lock_ownership` or an NFT transfer of a token lock moved the lock and the tokens | `cid`, `caller`, `from`, `to`, `ledger`, `lock_id`, `amount`, `expiry`, `ledger_tx` Nat (ledger block index), `outcome` Text: `ok`, or `uncertain` when the ledger call threw with an ambiguous code and the lock is held for both parties (then without `ledger_tx`); with `ok`, also `gas_source` Text (`owner` or `tank`) and `fee` Nat (v2) |
| `sneedlock_token_withdraw` | `transfer_tokens` moved tokens out of the caller's Sneed wallet | `cid`, `caller`, `ledger`, `amount`, `to` Account, `ledger_tx` |

Positions:

| btype | when | tx fields |
|-------|------|-----------|
| `sneedlock_position_claim` | `claim_position` verified ownership and mapped the position to the caller | `cid`, `caller`, `owner`, `pool`, `position_id`; `removed_claims` Array of Blob when claims left by earlier owners were dropped |
| `sneedlock_position_lock_create` | `create_position_lock` succeeded | `cid`, `caller`, `owner`, `pool`, `position_id`, `lock_id`, `expiry`, `token0`, `token1`, `dex`; `dissolve_delay` when the lock has one (v2) |
| `sneedlock_position_lock_extend` | `update_position_lock` moved the expiry later | `cid`, `caller`, `owner`, `pool`, `position_id`, `lock_id`, `old_expiry`, `expiry`. When written by `extend_lock` (v2) the fields are those of the lock-change blocks below (no `position_id`) |
| `sneedlock_position_transfer` | `transfer_position_ownership` succeeded (liquid locking) | `cid`, `caller`, `from`, `to`, `pool`, `position_id`; plus `lock_id` and `expiry` when a lock moved with it |
| `sneedlock_position_withdraw` | `transfer_position` moved the position out to ICPSwap | `cid`, `caller`, `owner`, `to`, `pool`, `position_id` |
| `sneedlock_fees_claim` | `claim_position_fees` (or `request_claim_and_withdraw`) succeeded | `cid`, `caller`, `owner`, `pool`, `position_id`, `token0`, `token1`, `amount0`, `amount1` (gross claimed), `delivered0`, `delivered1` (net the pool delivers), `request_id` |
| `sneedlock_liquidity_add` | `add_liquidity_to_locked_position` returned `Ok` | `cid`, `caller`, `owner`, `pool`, `position_id`, `token0`, `token1`, `amount0`, `amount1`, `credited0`, `credited1`, `used0`, `used1`, `returned0`, `returned1`; `increase_error` Text when the pool refused |

Lock changes (v2, spec/sneed_lock_v2.md):

| btype | when | tx fields |
|-------|------|-----------|
| `sneedlock_dissolve_start` | `start_dissolving` | `cid`, `caller`, `owner`, `lock_id`, `kind` Text (`token` or `position`), `ledger` or `pool`, `old_expiry`, `expiry` (the effective expiry), `lock_end`; `dissolve_delay` and `dissolving_until` when set |
| `sneedlock_dissolve_stop` | `stop_dissolving` | as above |
| `sneedlock_dissolve_delay_increase` | `increase_dissolve_delay` | as above |
| `sneedlock_token_lock_extend` | `extend_lock` on a token lock | as above |
| `sneedlock_gas_withdraw` | `withdraw_lock_gas` | `cid`, `caller`, `lock_id`, `ledger`, `amount`, `to` Account, `ledger_tx` |

NFTs (v2): the standard ICRC-7 and ICRC-37 blocks `7mint`, `7burn`, `7xfer`, `37approve`,
`37approve_coll`, `37revoke`, `37revoke_coll` and `37xfer` share the log, with the standards'
fields (`tid`, `from`, `to`, `spender`, `memo`, `ts`, `exp`; `7mint` carries `meta` with
`sneedlock:kind` and `sneedlock:minted_by`). `icrc3_supported_block_types` lists them with the
ICRC-7 and ICRC-37 standard URLs instead of the Sneed Lock catalogue URL. An ICRC-7 or ICRC-37
call answers the index of its block as the transaction id.

Fees:

| btype | when | tx fields |
|-------|------|-----------|
| `sneedlock_fee_pay` | the ICP lock fee was transferred from the payer's payment subaccount | `cid`, `caller`, `payer`, `lock_type` Text (`token` or `position`), `fee_e8s` (fee charged), `amount_e8s` (amount transferred, fee minus ledger fee), `to` Account, `icp_tx`, `price_tier` Text (`regular`, `premium`, `admin`, `partner`; since special prices, spec/special_prices.md) |

Admin and configuration (only callable by admins, governance or controllers):

| btype | when | tx fields |
|-------|------|-----------|
| `sneedlock_admin_token_return` | `admin_return_token` or `admin_return_token_from_failed_request` succeeded | `cid`, `caller`, `ledger`, `from` Account, `to` Account, `amount`, `ledger_tx` |
| `sneedlock_admin_token_rescue` | `admin_rescue_stuck_tokens` succeeded | `cid`, `caller`, `ledger`, `to` Account, `amount`, `ledger_tx` |
| `sneedlock_admin_pool_deposit` | `admin_pool_deposit` succeeded | `cid`, `caller`, `pool`, `ledger`, `amount`, `credited` |
| `sneedlock_admin_pool_withdraw` | `admin_withdraw_pool_balance_to_user` succeeded | `cid`, `caller`, `pool`, `ledger`, `amount`, `user`, `accepted` |
| `sneedlock_config_update` | any setting changed | `cid`, `caller`, `key` Text, `value` (Text or Nat), plus `old_value` when known |

`sneedlock_config_update` keys: `max_lock_length_ns`, `token_lock_fee_icp_e8s`,
`position_lock_fee_icp_e8s`, `premium_token_lock_fee_icp_e8s`,
`premium_position_lock_fee_icp_e8s`, `icp_fee_recipient` (Text account),
`sneed_premium_canister_id`, `admin_added`, `admin_removed`, `claim_history_cleared` and
`failed_claim_history_cleared` (value = number of entries), `icrc3_proposal_neuron` (Blob, or Text `none`),
`admin_prices` (Map of the set overrides) and `partner_prices` (extra field `partner`; value Map
`{ label; prices; expires_at? }` or Text `removed`; spec/special_prices.md), and the
ICRC-3 settings below (`icrc3_max_live_blocks` and so on).

Housekeeping (`clear_expired_locks`, archiving expired locks) is not logged: expiry is
implied by the `expiry` field of the create block. Since v2 the archiving of an expired token
lock writes a `7burn` for its NFT.

## Endpoints on `sneed_lock`

Standard (all queries):

```
icrc3_get_blocks : (vec record { start : nat; length : nat }) -> (GetBlocksResult) query;
icrc3_get_archives : (record { from : opt principal }) -> (vec record { canister_id : principal; start : nat; end : nat }) query;
icrc3_get_tip_certificate : () -> (opt record { certificate : blob; hash_tree : blob }) query;
icrc3_supported_block_types : () -> (vec record { block_type : text; url : text }) query;
icrc10_supported_standards : () -> (vec record { name : text; url : text }) query;  // lists ICRC-3 and ICRC-10, and since v2 ICRC-7 and ICRC-37
```

`icrc3_get_blocks` serves blocks from the live store directly and returns one
`archived_blocks` entry per archive that holds part of the requested ranges, with the
callback pointing at that archive's own `icrc3_get_blocks`. Responses are capped at
1000 blocks or about 1.5 MB, whichever comes first; `log_length` is the total number of
blocks ever appended.

Status and administration:

```
icrc3_log_status : () -> (record {
  log_length : nat; live_blocks : nat; live_first_index : nat;
  last_block_hash : opt blob; archives : vec ArchiveInfo;
  settings : Icrc3Settings; history_imported : bool; spilling : bool;
}) query;
admin_set_icrc3_settings : (record { max_live_blocks : opt nat; spill_batch_size : opt nat; archive_max_blocks : opt nat; archive_initial_cycles : opt nat; archive_top_up_threshold : opt nat; archive_top_up_amount : opt nat }) -> (variant { Ok : Icrc3Settings; Err : text });
admin_icrc3_spill_now : () -> (variant { Ok : nat; Err : text });    // moves every live block now; returns blocks moved
admin_icrc3_import_history : () -> (variant { Ok : nat; Err : text }); // idempotent; blocks written
admin_icrc3_repair_archive_controllers : () -> (vec record { principal; variant { Ok; Err : text } }); // re-applies [sneed_lock, SNS root]
// SNS registration of archives (next sections):
icrc3_registration_status : () -> (SnsRegister.Status) query;
admin_set_icrc3_proposal_neuron : (opt blob) -> (variant { Ok; Err : text });
admin_icrc3_register_archives_now : () -> (variant { Ok : nat; Err : text });
admin_icrc3_reset_archive_registration : (principal) -> (variant { Ok : bool; Err : text });
```

## Archive canister

Source `src/icrc3/Archive.mo`, an actor class instantiated by the library on behalf of `sneed_lock`.

```
Archive(init : { first_index : nat; max_blocks : nat })

append_blocks : (record { first_index : nat; blocks : vec blob }) -> (variant { Ok : nat; Err : text });  // parent only
icrc3_get_blocks : (vec record { start : nat; length : nat }) -> (GetBlocksResult) query;
archive_status : () -> (record { parent : principal; first_index : nat; block_count : nat; max_blocks : nat; cycles : nat; data_bytes : nat; stable_memory_bytes : nat; heap_bytes : nat; memory_bytes : nat }) query;  // public health, for monitoring
deposit_cycles : () -> ();  // accepts attached cycles from anyone
```

- Only the parent (the principal that created the canister, captured at install) may
  call `append_blocks`. There is no other write path; the archive never decodes or
  interprets blocks beyond returning them.
- `append_blocks` is idempotent: if `first_index` equals the next expected index the
  batch is appended; if the whole batch is already stored it returns `Ok` with the
  current count; anything else is an `Err` and nothing is written. A batch that would
  exceed `max_blocks` is refused.
- Storage: two `Region`s. The index region holds, per block, the 64-bit offset and
  32-bit length of its bytes in the data region; the data region holds the Candid
  encoding of each `Value` (`to_candid`). Regions are stable memory: not part of the
  heap, not serialised on upgrade, limited only by the canister's stable memory
  allowance (currently 500 GiB).
- `icrc3_get_blocks` decodes only the requested blocks, with the same 1000-block /
  1.5 MB cap, and returns an empty `archived_blocks` list.
- Controllers: `sneed_lock` and the SNS root canister, set by `sneed_lock` right
  after creation (`admin_icrc3_repair_archive_controllers` re-applies them while
  `sneed_lock` is still a controller). That is only the precondition for the DAO
  to take the archive over: a `RegisterDappCanisters` proposal makes SNS root the
  *sole* controller (root removes every other controller when it registers a
  canister) and only registered canisters can be upgraded by proposal. After
  registration `sneed_lock` keeps no control over the archive and needs none:
  appending is gated by the stored parent principal, top-ups go through
  `deposit_cycles`, and the balance is read with the `archive_status` query.
  Hand-over or reclaim later is a `DeregisterDappCanisters` proposal.
- The parent (the only principal allowed to append) is stored in a stable variable
  at first install, so an upgrade performed by SNS root does not move the write
  permission to the upgrader. Init arguments passed on upgrade are ignored.
- Upgrading an archive is a DAO proposal (`UpgradeSnsControlledCanister`) with a
  wasm compiled from `src/icrc3/Archive.mo` on its own and any well-typed init
  argument. Upgrading `sneed_lock` with a changed `Archive.mo` only affects archives
  created afterwards; existing ones keep their code, and the append protocol is
  designed to stay compatible across versions.
- Registration is automatic when a neuron is configured (next section). Operations
  on every new archive (the text log line `ICRC-3: created archive …`,
  `icrc3_log_status` and `icrc3_registration_status` list them): add it to the DAO's
  ic-unicycle cycle monitoring, and check that its registration proposal was
  adopted.

### Automatic SNS registration

Library module `src/icrc3/SnsRegister.mo`, state `icrc3_sns` on `sneed_lock`.

- `sneed_lock` submits one `RegisterDappCanisters` proposal per archive through an
  SNS neuron that lists the `sneed_lock` principal as a hotkey (the `SubmitProposal`
  permission). Governance requires that neuron to have at least the minimum dissolve
  delay to vote (30.4 days on Sneed) and a stake covering the reject cost (0.1 SNEED);
  a few SNEED are plenty. The neuron id (32-byte subaccount) is set with
  `admin_set_icrc3_proposal_neuron`, which writes a `sneedlock_config_update` block
  (key `icrc3_proposal_neuron`, value the id as Blob or the text `none`).
- Without a neuron the step is skipped silently, so the log works unchanged before
  the neuron exists and if the DAO ever removes it.
- Submission happens right after the spill that created the archive, and is retried
  on every later 15-minute check for archives without a proposal: a wrong or
  under-staked neuron or a governance outage self-heals once fixed. After 5 failed
  attempts an archive is left alone until the neuron is changed or
  `admin_icrc3_reset_archive_registration` is called (also the way to resubmit after a
  rejected proposal). `admin_icrc3_register_archives_now` runs the step on demand.
- `icrc3_registration_status` (query) shows the governance canister, the neuron and,
  per archive, the proposal id or the attempts and last error.
- The governance call uses reduced Candid types (variants with only the tags that are
  sent; the response command is an option, so unknown tags decode to null). Every
  failure mode, including a trap in governance, counts as one failed attempt.

## Spill protocol

Settings (defaults): `max_live_blocks = 2000`, `spill_batch_size = 500`,
`archive_max_blocks = 1_000_000`, `archive_initial_cycles = 1.5 T`,
`archive_top_up_threshold = 0.5 T`, `archive_top_up_amount = 0.5 T`. The subnet keeps
the canister creation fee (0.5 T on 13-node subnets) out of the initial grant, so a
new archive starts with about 1 T.

1. A recurring timer (every 15 minutes, restarted in `postupgrade`) runs `spill()`.
   `admin_icrc3_spill_now` runs the same function with `force`, which moves every
   live block regardless of the threshold (useful for tests and before upgrades).
2. `spill()` returns immediately if a spill is in flight (transient flag) or the live
   store is below the threshold.
3. If there is no archive, or the newest one is full, create one: check
   `Cycles.balance() > archive_initial_cycles + 2 T` reserve, attach
   `archive_initial_cycles`, instantiate the class with `first_index = log_length −
   live_blocks`, set its controllers to `[sneed_lock, sns_root]`, record it in the
   archive list with `length = 0`. If the balance is too low, log an error and stop;
   the live store keeps growing on the heap until the DAO tops up (at Sneed Lock's
   rate that takes years to matter, and `icrc3_log_status` shows it).
4. Take the oldest `min(spill_batch_size, remaining capacity of the archive)` blocks
   as encoded blobs and call `append_blocks`. The batch size keeps the message well
   below the 2 MB limit (500 blocks of a few hundred bytes).
5. On `Ok`, drop those blocks from the live store, advance `live_first_index`, update
   the archive's `length`. On `Err` or a thrown call, keep everything and log; the
   next spill retries from the same point and the archive's idempotency rule makes a
   lost reply harmless.
6. Read the archive's `archive_status`; if `cycles < archive_top_up_threshold`, send
   `archive_top_up_amount` with `deposit_cycles`, provided `sneed_lock` keeps its own
   2 T reserve.
7. Repeat from step 2 while the live count is still at or above the threshold, so a
   backlog clears in one timer run.

Because the block index is global and archives are created in order, every archive
holds one contiguous range and `icrc3_get_archives` lists them in index order.

## History import

Run once, idempotently, by `admin_icrc3_import_history` (also scheduled by a 0-second
timer in `postupgrade` of the release that introduces the log, guarded by a stable
`icrc3_history_imported` flag). It writes, in this order: `sneedlock_log_start`, one
import block per active token lock, per archived token lock, per active position lock,
per archived position lock, and one `sneedlock_import_position_claim` per claimed
position that has no lock. Locks are written in ascending `lock_id` order so the
import is deterministic. The flag is set after the last block, inside the same
message, so a trap leaves the log empty rather than half imported.

## Certification

After every append, and in `postupgrade`, `sneed_lock` computes the tree

```
Fork(
  Labeled("last_block_hash",  Leaf(hash of last block)),
  Labeled("last_block_index", Leaf(unsigned LEB128 of last index)))
```

and calls `CertifiedData.set(root_hash)`. Labels are ordered lexicographically so
agent libraries can look up paths. `icrc3_get_tip_certificate` returns
`CertifiedData.getCertificate()` plus the CBOR encoding of that tree (self-describing
tag, arrays of `[tag, ...]` with the IC hash-tree tags 0 empty, 1 fork, 2 labeled,
3 leaf). Hashing uses the IC domain separators (`ic-hashtree-fork`,
`ic-hashtree-labeled`, `ic-hashtree-leaf`). Verification is tested end to end with
`@dfinity/agent` against staging.

Before the first block exists the endpoint returns `null`.

## Storage on `sneed_lock`

New stable variables, all additive (the stable signature check against the production
`.most` file must pass; nothing existing is removed or retyped):

```
icrc3_live : { var blocks : [var Blob]; var count : Nat; var first_index : Nat }
icrc3_log_length : Nat
icrc3_last_hash : ?Blob
icrc3_archives : [{ canister_id : Principal; start : Nat; length : Nat; max_blocks : Nat }]
icrc3_settings : Icrc3Settings
icrc3_history_imported : Bool
```

Changed from the original plan: these are fields of one stable record, `stable var icrc3 :
Log.State` (`live`, `log_length`, `last_hash`, `archives`, `settings`, `history_imported`),
plus `stable var icrc3_sns : SnsRegister.State` for archive registration.

The live store is a growable array of encoded blocks on the heap; bounded by the
spill threshold it stays around 2000 × ~300 bytes, so upgrade serialisation cost is
negligible. Blocks are stored already encoded (Candid bytes of the `Value`) so the
hash chain and the archive see identical bytes.

## Cycles

- `sneed_lock` pays `archive_initial_cycles` (1.5 T, of which the subnet keeps the
  0.5 T creation fee) per archive created and tops archives up from its own balance,
  always keeping a 2 T reserve for itself. An archive holding a few hundred megabytes
  idles at a few hundred thousand cycles per day, so 1 T lasts for years.
- `sneed_lock` never sends cycles anywhere else. There is no cycle sharing, no
  collector, no timer that pays anyone. Any future donation to library authors or
  infrastructure is a separate, explicit DAO decision.
- `icrc3_log_status` exposes the archive cycle balances so the DAO can watch them.
  Each new archive must also be added to the DAO's ic-unicycle monitoring, which
  is the independent safety net if `sneed_lock` itself runs low and cannot top up.
  The automatic registration proposal names the archive and repeats this checklist
  in its summary.

## Security considerations

- Writes to the chain happen only inside `sneed_lock`'s own update methods, at the
  point where the action is already committed to local state. There is no public
  method that appends arbitrary blocks.
- The archive accepts blocks only from its parent. Nothing in the archive can alter
  or delete a stored block.
- Clients must verify the tip certificate and walk `phash`; the archives are not
  certified individually, which is the standard ICRC-3 model.
- The history import blocks are self-declared state at log start; they are labelled
  as imports and carry no `cid`, so they cannot be confused with observed actions.
- Any failure of the logging path must not break the user's action: encoding and
  hashing are pure and cannot trap on valid input; spill runs out of band.

## Testing

1. Hash oracle: the in-house representation-independent hash is compared on a corpus
   of sample blocks against `rep-indy-hash` 0.2.1 (ICDevs' library, used only as a
   test oracle, never deployed) and against the IC request-id test vector from the
   interface specification.
2. SHA-256 comes from `sha2` 0.1.6 (research-ag, Apache-2.0, pure hashing, no
   dependencies beyond `base`), added to `mops.toml`.
3. Hash-tree: root hash and CBOR output checked against `@dfinity/agent`'s
   `reconstruct` and `lookup_path`.
4. Local rehearsal (done 2026-10-12 on PocketIC with dfx 0.28.0): fresh install writes
   the log start block from the timer; config actions produce blocks; forced spills with
   `archive_max_blocks = 3` created five archives in a row with the right controllers;
   an ingress `append_blocks` is refused by `inspect`; top-ups land; an upgrade keeps
   the log, re-certifies the tip and does not re-import; the JavaScript verifier
   (independent hash implementation) validated the certificate and the full chain
   across live and archived blocks before and after the upgrade.
5. Staging: upgrade the staging `sneed_lock`, confirm the import, create locks, run the
   verifier, force a spill with a low `max_live_blocks`, then restore defaults.
6. Stable compatibility: `moc --stable-compatible` old vs new `.most` (passes).

## Reuse in other canisters

The implementation is a library, `src/icrc3`, with nothing specific to Sneed Lock in
it. A canister adopts it by declaring one stable `Log.State`, one transient
`Log.Runtime`, a `Log.Config` with its own block-type catalogue and documentation URL,
an `Environment` (its principal, the extra archive controllers, the cycle reserve and
its text-log functions), one-line public wrappers for the standard queries and the
admin operations, `Log.ensureTimer` in the actor body and `postupgrade`, and
`Log.append` at each committed action. `src/icrc3/README.md` has the recipe. Sneedex,
Sneedapp and the rewards canister are the next candidates; each needs its own block
catalogue designed and documented before instrumentation.

## Follow-ups outside this change

- Frontend: show the log on `/sneedlock_info` and on each `/lock/<id>` page (blocks
  mentioning that lock id), with a link to verify. *Not done (2026-10-20); the generic ICRC-3
  viewer at `/tools/icrc3` can read the log.*
- API docs and the agent skill: document the endpoints and the block catalogue at
  `https://app.sneeddao.com/api/sneed_lock#block-types`. *Done: section 8 of
  `public/api-docs/sneed_lock.md`; the `#block-types` anchor resolves to "8.3 Block types".*
- Whitepaper: describe the verifiable log.
