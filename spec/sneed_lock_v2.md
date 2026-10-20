# Sneed Lock v2: dissolve delays, locks as NFTs (ICRC-7, ICRC-37), and what is built on top

Written 2026-10-14. This is the last round of features before Sneed Lock is meant to
**ossify** (admin retired, then blackholed or held by custody) and integrators are invited.
Everything an integrator will depend on has to be in, and right, before then: the money
layout, the lock lifecycle, the read API and the log. Features that only *use* locks
(rewards, voting, hotkeys) live in other canisters, which stay upgradable.

**Status (2026-10-20):** sections 1–4 (v2a dissolve delays, v2b LP NFTs with ICRC-37, v2c token
locks as NFTs with gas) are **built** in `src/sneed_lock` (main.mo, Dissolve.mo, Nft.mo) and
live on mainnet (`get_lock_limits`, `get_lock_gas` and `icrc7_total_supply` answer). Sections 5
(`sneed_hotkey`) and 7 (`sneed_gov`) are **planned**: neither canister exists yet. Section 6 is
partly done (see there). Where the build differs from a decision below, the section says so in a
"Changed from the original plan" note.

## Decisions at a glance

| Topic | Decision |
|---|---|
| Dissolve delay | Optional per lock. Dissolving can start only after the lock period ends. Start, stop and increase; never decrease except by dissolving. The min and max lock length apply to lock period + delay. |
| How old code stays safe | The stored `expiry` becomes the **effective unlock time**: unchanged for a lock without a delay, "never" (`Nat64` max) while a delay lock is not dissolving, the dissolve end while it is. Every existing `expiry <= now` check stays correct without being touched. |
| ICRC-7, phase 1 | **LP (position) locks** are NFTs. An ownership transfer is bookkeeping: no ledger call, no fee. |
| ICRC-7, phase 2 | **Token locks** become NFTs on today's layout (tokens in the owner's subaccount). The ledger fee of a transfer comes from the owner's free balance, else from the lock's own gas tank (a subaccount anyone can fund); with neither, the transfer is refused. The amount never changes. Decided 2026-10-15 (replacing "the lock pays", 2026-10-14). |
| Token id | For an LP NFT, the position's first lock id, kept for as long as Sneed Lock holds the position, through extensions, expiry and re-locks. For a token lock, its lock id. One id space; ids are never reused. |
| Subaccounts | A **label** per NFT (owner principal + subaccount). The principal stays the internal owner. Sufficient for ICRC-7 and ICRC-37: see "The subaccount question". |
| ICRC-37 | Phase 1 with the LP NFTs: token and collection approvals, `transfer_from`. Approvals are cleared on every transfer. |
| History | Standard ICRC-7/37 blocks (`7xfer`, `7burn`, `37approve`, …) join the existing ICRC-3 log next to the `sneedlock_*` ones. |
| Hotkeys | **Not in Sneed Lock.** A general `sneed_hotkey` registry, keyed by owner principal and scope, that consumers such as `sneed_gov` check. Sneed Lock grants hotkeys nothing. |
| Rewards and voting | A separate canister, `sneed_gov`, reading Sneed Lock. Its own spec follows; the outline is at the end of this document. |

---

## 1 · Dissolve delays

Locks get the essential mechanics of an NNS/SNS neuron. Three shapes:

| Shape | Lock period | Dissolve delay | Behaves like |
|---|---|---|---|
| a | 0 | x | an ordinary neuron: locked until it is dissolved |
| b | y | 0 | today's lock: free at expiry |
| c | y | x | a vesting neuron: locked for y, then dissolving can start |

### State

New stable vars only (the stored lock records do not change shape). As built, one map
(`dissolve_infos` in main.mo, type `Dissolve.Info`) holds the three values, only for locks that
have or had a delay:

```
dissolve_infos lock_id → {
  lock_end : Nat64;            // end of the lock period (y). Absent entry = the stored expiry.
  delay : Nat64;               // x in ns. Absent entry = 0.
  dissolving_until : ?Nat64;   // the time dissolving finishes; null = not dissolving.
}                              // stays set once dissolved
```

Changed from the original plan: one map of records instead of three maps (`LockEnd`,
`DissolveDelay`, `Dissolving`); same meaning.

### Rules

- **Locked** while `now < lock_end`, or while `delay > 0` and the lock has not finished
  dissolving.
- **start_dissolving(lock_id)**: owner only; needs `delay > 0`, not already dissolving, and
  `now ≥ lock_end`. Sets `dissolving_until = now + delay`.
- **stop_dissolving(lock_id)**: owner only; while dissolving and `now < dissolving_until`.
  Sets `delay = dissolving_until − now` and clears `Dissolving`, as the NNS does.
- **increase_dissolve_delay(lock_id, additional_ns)**: owner only, while the lock is locked.
  Adds `additional_ns` (> 0) to the delay.
  - Dissolving: `dissolving_until` moves out by the same amount.
  - Adding a delay to an existing no-delay lock is allowed while it is still locked; its stored
    expiry then becomes its lock end.
  - Changed from the original plan: the argument is the increase, not the new total delay
    (`new_delay`); the effect is the same.
- **extend_lock(lock_id, new_end)**: owner only, while not dissolving; `new_end > lock_end` and
  `new_end > now`. This is new for token locks, which before v2 could not be extended at all.
  It works for position locks too (logged as `sneedlock_position_lock_extend`);
  `update_position_lock` still extends position locks as before.
- All four changes answer `LockOpResult` (`#Ok : LockState` or `#Err` of `#NotFound`,
  `#NotOwner`, `#InProgress`, `#Invalid : Text`). `#InProgress` while an ownership transfer of
  the lock, or another token operation of its owner, is running.
- **The limits** apply to lock period + delay. On mainnet the minimum is 5 seconds (the code's
  default; the user remembered 5 minutes) and the maximum 3,652 days, about 10 years
  (`get_lock_limits` on 2026-10-20 answers `max_lock_length_ns = 315_532_800_000_000_000`; the
  DAO sets it with `set_max_lock_length_days`).
  - At creation: `min ≤ (lock_end − now) + delay ≤ max` for a lock with a delay. A lock
    without one keeps the old checks (`now + min ≤ expires_at ≤ now + max`).
  - After any change: `max(lock_end − now, 0) + delay ≤ max`, or `dissolving_until − now ≤ max`
    while dissolving.
  - A new `get_lock_limits()` query exposes both, since today nothing does.
- **Once dissolved**, a lock is free exactly as an expired lock is today: tokens can be
  withdrawn, a position claimed. Changing an unlocked lock is not allowed; lock again by
  creating a lock.
- `create_lock` and `create_position_lock` take an optional `dissolve_delay` (new optional
  argument, so existing callers are unaffected). With a delay, `expires_at` may equal `now`
  (shape a).

### The effective expiry

The stored record's `expiry` field is set to:

| Lock | Stored `expiry` |
|---|---|
| no delay | `lock_end` (as today) |
| delay, not dissolving | `0xFFFF_FFFF_FFFF_FFFF` ("not before it dissolves") |
| delay, dissolving | `dissolving_until` |

Every place in `main.mo` that decides "is this locked?" compares `expiry` with `now`:
- the free-balance computation in `transfer_tokens` and in the ownership transfer;
- `claim_position`;
- the `get_active_*` and `get_expired_*` queries;
- `clear_expired_*`;
- `has_expired_*`.

With the effective expiry, those stay correct **without being edited**. That matters in the
code that holds the money. Old frontends and integrators see a delay lock as locked until a
far-future date, which never overstates how free it is.

**Audit before shipping:** every arithmetic use of `expiry` (an addition near `Nat64` max
traps), in the canister and in the frontend:
- the lock pages;
- Sneedex's lock asset;
- the token safety rating, which must count a delay lock as locked;
- the ICRC-3 blocks, which carry the effective value plus the new fields.

### Reads

`get_lock_state(lock_id)` returns (as built in v2a; see `LockState` in Types.mo):

```
{
  lock_id; kind; owner; owner_subaccount;   // the label, once locks are NFTs
  ledger; amount;                           // token locks
  swap_canister_id; position_id; token0; token1;   // position locks
  lock_end;                 // end of the lock period: dissolving can start from here
  dissolve_delay;           // 0 = none
  dissolving_until : ?Nat64;
  expiry;                   // the effective (stored) expiry, see above
  earliest_unlock;          // the soonest it can be free
  created_at : ?Nat64;      // when the lock was created
  locked : Bool;
  archived : Bool;
}
```

**`earliest_unlock`, not "never".** A delay lock that is not dissolving stores `NEVER`,
because it must not unlock by itself; but what a person wants to know is when it can be
free. `earliest_unlock` is `expiry` for a plain or dissolving lock, and otherwise
`max(lock_end, now) + dissolve_delay`. A lock with a 1 h lock period and a 1 h delay shows
"2 h from now at the soonest". Once its lock period is over and it still is not dissolving,
the value moves forward with time: it says "if dissolving started now". GUIs show this,
labelled "at the soonest", wherever a plain lock shows its expiry.

**`created_at`, the lock's age.** Lock records never carried a creation time. v2 keeps one
per lock id in a stable map, set when the lock is created and kept after it is archived.
On the upgrade that adds it, the canister fills it in once from the `*_lock_create` blocks
of its ICRC-3 log, so every lock created since the log began (October 2026) has its time.
(The backfill reads only blocks still held by `sneed_lock`, not archived ones; no archive
existed when it ran on mainnet, so nothing was missed.)
Older locks have none (`null`), and GUIs say so. Re-locking or extending a position keeps its
lock id and so its age. Whether an age bonus survives an NFT transfer is an open question
(below); `created_at` itself never changes.

Plus a batch form and paged forms per owner and per ledger. This is the single query
`sneed_gov` and integrators build on. As built: `get_lock_states(ids)` (at most 100 ids) and
`get_lock_states_page(q)` with filters `owner`, `ledger`, `swap_canister_id`, `token`, `kind`,
`status` (`#Active` / `#Expired`) and `include_archived`, ascending ids after `prev`, `take`
100 by default and at most 500. `LockState` also carries `dex` for position locks.

### Log

New ICRC-3 block types:
- `sneedlock_dissolve_start`
- `sneedlock_dissolve_stop`
- `sneedlock_dissolve_delay_increase`
- `sneedlock_token_lock_extend`

`extend_lock` on a position lock writes the existing `sneedlock_position_lock_extend`. All five
carry `cid`, `caller`, `owner`, `lock_id`, `kind`, `ledger` or `pool`, `old_expiry`, `expiry`
(effective), `lock_end`, and `dissolve_delay` / `dissolving_until` when the lock has them.

The existing create blocks gain an optional `dissolve_delay` field. Their `expiry` field is the
`expires_at` the caller asked for (the lock end), not the stored effective expiry.

---

## 2 · Locks as NFTs: ICRC-7, phase 1 (LP locks)

### Which tokens exist

- **One NFT per ICPSwap position held by Sneed Lock that has been locked at least once.**
  Its token id is the lock id of the position's first lock. A new stable var,
  `PositionToken (swap, position_id) → token_id`, keeps it through extensions, expiry and
  re-locks: re-locking after expiry creates a new lock id but keeps the token id.
  Existing positions are assigned at upgrade from their current lock.
- **Minted** when a position is first locked (`7mint`), and once for every existing one when
  phase 1 activates. That is a bounded batch on a timer, logged as `7mint` with
  `"meta": "activation"`. Changed from the original plan: activation runs once, in a single
  message right after the ICRC-3 history import, and the reason is
  `meta.sneedlock:minted_by = "activation"` (see "As built" below).
- **Burned** when the position leaves Sneed Lock (`claim_position`, withdrawal): `7burn`.
  `icrc7_owner_of` then answers `null`. As built, the burn happens in `transfer_position`
  (the withdrawal); `claim_position` only records the caller's claim and burns nothing.
- Phase 1 token locks are **not** in the collection: `icrc7_owner_of` answers `null`, and the
  supply and the lists leave them out.

### Read surface

| Method | Answer |
|---|---|
| `icrc7_name` / `icrc7_symbol` | "Sneed Lock" / "SLOCK" |
| `icrc7_owner_of`, `icrc7_balance_of`, `icrc7_tokens_of` | Per account (owner + label). `null` and 32 zero bytes are the same account. |
| `icrc7_tokens`, `icrc7_tokens_of` | Ascending ids, paged by `prev`. |
| `icrc7_token_metadata` | See below. |
| `icrc10_supported_standards` | Adds ICRC-7 and ICRC-37 to the list (ICRC-3 and ICRC-10 are already there). |

Token metadata is ICRC-7 Values; this collection has no legacy decoders, so `#Array` and `#Map`
are allowed:
- `name`: "SNEED/ICP LP lock" or "… position #N", built from cached symbols;
- `description`;
- `image`: an SVG card drawn on the fly. It shows the pair, "locked until …" or
  "dissolving, free on …", and the lock id.
- `sneedlock:kind = position`;
- `sneedlock:swap`, `sneedlock:position_id`, `sneedlock:token0`, `sneedlock:token1`,
  `sneedlock:dex`;
- `sneedlock:lock_end`, `sneedlock:dissolve_delay`, `sneedlock:dissolving_until`,
  `sneedlock:locked`.

**Symbols:** a small stable cache `ledger → symbol`, filled by one `icrc1_symbol` call the
first time a ledger is seen at lock creation. A missing symbol shows the ledger's short id.
Logos are not stored: wallets draw them from the ledger.

### Transfer

- `icrc7_transfer` for an LP NFT is `transfer_position_ownership` plus the label.
- Rules:
  - the caller must be the owner **and** `from_subaccount` must equal the label;
  - the recipient must not be anonymous or the same account;
  - the memo is at most 32 bytes;
  - the batch is at most the advertised size.
- A position with a pending claim or fee operation (the existing `pool_op_locks`) is refused
  with `GenericError` rather than raced.
- The lock state travels with it: `lock_end`, the delay and dissolving all belong to the lock,
  not the owner.
- The position's **unclaimed fees travel too**: whoever owns it when `claim_position_fees`
  runs collects them. The NFT card says so, and marketplaces should know it.
- Free (no Sneed fee), logged as `7xfer`.

### The subaccount question

Sneed Lock's internals are keyed by principal: maps, the per-owner token subaccounts, and
every non-ICRC method (claim, fees, add liquidity, withdraw). Making the subaccount part of
internal ownership would touch all of that, including the money layout. A **label** does not:

- `NftAccount lock_id → subaccount` records which of the owner's accounts holds the token.
  `null` means the default.
- ICRC-7 and ICRC-37 calls see the full account and enforce it: a token moves only from the
  account that holds it.
- Non-ICRC methods act for the principal, across all its labels. In ICRC-1 terms a principal
  controls all its subaccounts, so this is the same authority, not a widened one.

**Is the label enough for ICRC-37?** Yes. Approvals belong to an account (owner principal +
label), spenders are accounts, and `transfer_from` moves the token between accounts. All of
that is ICRC-level and the label carries it.

The cases where labels would not be enough are ones where *different parties* would hold
different subaccounts of one principal. ICRC-1 does not allow that: only the principal signs
for any of its subaccounts. A marketplace escrowing many offers in subaccounts of itself (the
case that broke Delulu) is exactly what labels support. Real per-subaccount ownership would
cost the money layout and buy nothing the standard requires.

---

## 3 · ICRC-37 (with phase 1)

Applies to every token in the collection.

**Methods:**
- `icrc37_approve_tokens`, `icrc37_approve_collection`
- `icrc37_revoke_token_approvals`, `icrc37_revoke_collection_approvals`
- `icrc37_is_approved`, `icrc37_get_token_approvals`, `icrc37_get_collection_approvals`
- `icrc37_transfer_from`
- `icrc37_max_approvals_per_token_or_collection`, `icrc37_max_revoke_approvals`

**State** (new stable vars):

```
TokenApprovals      token_id → [(spender : Account, expires_at : ?Nat64, created_at : Nat64)]   // ≤ 8 per token
CollectionApprovals owner Account → [(spender : Account, expires_at : ?Nat64, created_at : Nat64)]  // ≤ 8 per account
```

Changed from the original plan: the limit is 10 per token and 10 per account
(`icrc37_max_approvals_per_token_or_collection`), and the lists hold the full ICRC-37
`ApprovalInfo` (spender, from_subaccount, expires_at, memo, created_at_time).

**Rules:**
- **Token approvals are cleared on every transfer**, including `transfer_from` and a burn, as
  the standard requires. Collection approvals stay with the owner's account.
- Only the token's current account may approve it. A spender may not be the owner's own
  account.
- `transfer_from`:
  - the caller's account (caller + `spender_subaccount`) must hold a live approval, for the
    token or for the collection of the `from` account;
  - `from` must be the current owner account;
  - the same recipient checks as `icrc7_transfer` apply.
- Expired approvals are refused, and pruned when touched and by a daily sweep. As built there
  is no sweep: expired approvals are ignored by every check and read, and dropped the next time
  that token's or account's approvals are written (approve, revoke, transfer, burn).
- `created_at_time` is checked against a 24-hour window, as for transfers. Duplicates within
  the window are refused (`Duplicate`), using a bounded recent-transactions set. As built,
  duplicate detection covers `icrc7_transfer` and `icrc37_transfer_from` (the set is pruned to
  the window on each transfer call); approvals and revocations are only time-checked, and an
  approval for an already-approved spender replaces it.
- An approval whose `expires_at` is already past is refused (`GenericError` 4).
- Logged as `37approve`, `37approve_coll`, `37revoke`, `37revoke_coll` and `37xfer`, each with
  the standard fields.

**Why with phase 1:** it lets Sneedex and other marketplaces list a lock **by approval**. The
seller approves, the market pulls the lock into its escrow account at listing time, and it
then sits in the market's labelled subaccount. That is one step for the seller instead of a
transfer plus an escrow call.

---

### As built (v2b, 2026-10-15)

`src/sneed_lock/Nft.mo` holds the types and pure helpers; the state and endpoints are in
`main.mo`. Where the build settles details the sections above left open:

- **Owner = the only claimant.** A token's owner is the principal holding the position's claim,
  and only when exactly one principal does (see the stale-claim fix: claims are exclusive now).
  The label is kept per token; a zero subaccount is the same as none.
- **Mint:** on a position's first lock (`7mint`, `meta.sneedlock:minted_by = "lock"`); a re-lock
  after expiry keeps the token. **Activation:** once, after the ICRC-3 history import, every
  position that is claimed and has any lock record (active or archived) gets a token whose id is
  the lowest such lock id (`minted_by = "activation"`).
- **Burn:** when `transfer_position` withdraws the position (`7burn`). A later deposit and lock
  mints a new token with the new lock id; ids are never reused.
- **Transfers:** `icrc7_transfer` and `icrc37_transfer_from` move the claim and the lock record
  (logged as `sneedlock_position_transfer`, as before) and the label, clear the token's
  approvals, and log `7xfer` / `37xfer`. The answer is that block's index. A move between two
  accounts of one principal only changes the label. `transfer_position_ownership` takes the NFT
  along to the recipient's default account and logs `7xfer` too.
- **Refused while busy** (`GenericError` 3): a withdrawal of the position, or a fee claim or
  liquidity addition on its pool, is awaiting the pool.
- **Dedup:** requests with `created_at_time` are remembered for the transaction window (24 h +
  2 min drift) and answered `Duplicate` with the first block index.
- **Limits:** 10 updates per call, 100 per query, take 100 by default and 500 at most, memo 32
  bytes, 10 approvals per token and per account for the collection.
- **Metadata:** `icrc7:name` ("AAA/BBB LP lock"), `icrc7:description`, `icrc7:image` (an SVG
  data URL card), and `sneedlock:*` fields (kind, swap, position_id, token0/1, lock_id, dex,
  lock_end, dissolve_delay, dissolving_until, earliest_unlock, locked, minted_at). Symbols come
  from a cache filled by a timer (`icrc1_symbol`, once per ledger).
- `get_position_nft(swap, position_id)` answers a position's token id. `LockState.owner_subaccount`
  carries the label for position locks.

---

## 4 · Token locks as NFTs (phase 2): today's layout, gas from the owner or the lock's tank

**Decided 2026-10-14: keep the layout.** A token lock's tokens sit in Sneed Lock's subaccount for
the owner principal (the Sneed wallet), shared by that owner's locks of the ledger, with the locks
reserving amounts in it. The accounting needs no state kept by Sneed Lock: the owner's tokens are
in the owner's subaccount. If the lock records were ever lost, the failure would be that funds
unlock, never that they are stranded.

**Decided 2026-10-15: gas, and refuse without it.** An ownership change is a ledger transfer of the
locked amount `A` from the old owner's Sneed wallet to the new owner's, and the ledger charges its
fee `F` to the sending account. The lock's amount never changes: whatever counts locked amounts
(a buyer, `sneed_gov` voting power, a vesting schedule) can rely on it. The fee comes from, in order:

1. **The owner's free balance:** the old owner's Sneed wallet beyond everything locked there
   (`balance − sum(locks) ≥ F`). One fee. This is what `transfer_token_lock_ownership` does today.
2. **The lock's gas tank:** a Sneed Lock subaccount of its own per lock, in the lock's token. The
   tank first sends `F` to the old owner's Sneed wallet (that hop costs the tank another `F`), then
   the move runs as in 1. Two fees from the tank per transfer.
3. **Neither:** the transfer is refused, `GenericError` code 7, with a message that names the gas
   account and the amount needed (`2F` into the tank, or `F` of free balance). No partial effect.

### The gas tank

- **Account:** `{ owner = sneed_lock; subaccount = gas_subaccount(lock_id) }`, 32 bytes: byte 0 =
  `0xFE`, bytes 1–3 = `"GAS"`, bytes 24–31 = the lock id big-endian, zero elsewhere. Byte 0 of a
  Sneed wallet subaccount is the principal's length (at most 29) and the payment subaccount keeps
  that layout, so no gas account can be anyone's wallet. A query `get_lock_gas_account(lock_id)`
  answers it, and clients may also derive it. Changed from the original plan: the query is
  `get_lock_gas(lock_id)` and answers `?{ account; ledger; transfer_fee : ?Nat }` (null for ids
  that are not token locks, live or archived).
- **Funding:** a plain ICRC-1 transfer by anyone: the sender when listing or sending (the
  frontend offers "add gas for about N transfers"), the recipient, a marketplace. No call to
  Sneed Lock is needed, and no state: the balance lives on the ledger.
- **Permissionless, like topping up a canister's cycles:** anyone can fund any lock's tank,
  owner or not, so an NFT held in a wallet that knows nothing about gas is never stuck: someone
  (the holder from another wallet, a buyer, a friend, the seller) tops it up from Sneed Hub.
- **Top-up in Sneed Hub** (decided 2026-10-15), one shared "Add gas" dialog (lock id → its
  ledger, fee, gas account, current tank balance and "about N transfers"; amount presets of
  1, 5 and 20 transfers at `2F` each, or a free amount; pays from the user's wallet balance of
  that token with a plain `icrc1_transfer` to the gas account), offered for **every** token lock,
  whoever owns it, on:
  - the wallet's lock rows (the user's own locks);
  - `/lock/:id`;
  - `/tokenlock` (every lock of a token, anyone's);
  - the lock's NFT page.
  Each place shows the tank balance and "about N transfers left" next to the button. Gas is a
  gift to the lock's current owner; the dialog says so.
- **Whose it is:** the lock's current owner's, whoever funded it. Gas travels with the lock.
- **Taking it back:** `withdraw_lock_gas(lock_id, to : Account)`, the lock's owner only (the last
  owner once the lock is archived), sends the tank's balance minus one fee. Serialised by the
  owner's token-op guard. Logged as `sneedlock_gas_withdraw`. Answers `#Ok` with the ledger block
  index or `#Err : Text` (also when the tank holds no more than one fee).
- **Read:** NFT metadata is served by a query, which cannot read the ledger, so the metadata
  carries `sneedlock:gas_account` (the account) and `sneedlock:transfer_fee` (the ledger fee when
  last seen), and wallets read the balance themselves. Changed from the original plan: the
  account is two fields, `sneedlock:gas_owner` (Text, the Sneed Lock principal) and
  `sneedlock:gas_subaccount` (Blob). The Sneed frontend shows "gas for about
  N transfers" (`floor(balance / 2F)`) plus whether the owner's free balance covers one.

### The NFT

- **Which tokens:** every live (not archived) token lock; token id = its lock id. Minted by
  `create_lock` (`7mint`), and once for every live token lock at activation, as for positions.
- **Owner:** the lock record's owner principal plus a label, exactly as for LP NFTs.
- **Burn:** when the lock is archived after it has unlocked (`7burn`). Archiving is lazy, so an
  expired lock keeps answering `icrc7_owner_of` until then, but a transfer of it is refused
  (`GenericError` code 8, "the lock has unlocked").
- **Transfer** (`icrc7_transfer`, `icrc37_transfer_from`, and `transfer_token_lock_ownership`):
  - between two accounts of one principal: the label only, no ledger call, no gas;
  - otherwise: the fee source as above, then today's move. The lock is recorded on the recipient
    before the ledger transfer, so the recipient never sees the tokens arrive unlocked; a refusal
    or a definite ledger failure rolls back; an ambiguous outcome keeps the lock on both parties
    until reconciled, and the NFT then answers no owner and refuses to move.
  - Serialised: the old owner's token-op guard and the lock's in-flight mark, as today; dissolve
    changes are refused meanwhile (`InProgress`).
  - Logged: `sneedlock_token_lock_transfer` (now with `gas_source` = `owner` or `tank` and `fee`)
    followed by `7xfer` / `37xfer`.
- **Dissolving locks** transfer like any other (decided 2026-10-14); escrow in Sneedex stays a
  separate call.
- **`transfer_token_lock_ownership`** keeps its signature and gains the tank as a second fee source
  (it refused before), so Sneedex's escrow keeps working and cannot get stuck for want of gas.
- **Batches:** each token-lock transfer awaits the ledger, so a batch runs them one after the other
  and answers each separately (`icrc7_atomic_batch_transfers` stays `false`).
- **Metadata:** `icrc7:name` ("1,000 SNEED lock"), `icrc7:image` (the same on-the-fly SVG card),
  `sneedlock:kind = token`, `sneedlock:ledger`, `sneedlock:amount`, the lock fields as for
  positions, `sneedlock:gas_owner`, `sneedlock:gas_subaccount`, `sneedlock:transfer_fee` (the
  fee only when Sneed Lock has seen it: symbol cache or a gas withdrawal).

### As built (v2c, 2026-10-15)

- `token_lock_move` in main.mo is the one money path for token-lock ownership changes:
  `transfer_token_lock_ownership` (Sneedex escrow) and the NFT transfers both run it. It is the
  previous `transfer_token_lock_ownership` body with the fee step above added; error codes 3
  busy, 7 needs gas, 8 unlocked, 9 other.
- NFT ownership of a token lock is read from its lock record (exactly one record; two means a
  transfer awaiting reconciliation, and the NFT then answers no owner). No mint map is kept: a
  flag `token_nfts_activated` marks that every live lock was minted once (after the ICRC-3
  history import); from then on `create_lock` mints and archiving burns.
- `icrc7_transfer` and `icrc37_transfer_from` run a batch item by item, re-checking each just
  before it runs (an earlier item may have awaited the ledger).
- Metadata names use cached `icrc1_symbol` / `icrc1_decimals` / `icrc1_fee` per ledger (filled
  by timer); amounts are rounded down to 4 decimals so a name never overstates.
- Queries: `get_lock_gas(lock_id)`; update: `withdraw_lock_gas(lock_id, to)`, logged as
  `sneedlock_gas_withdraw`.
- Sneed Hub: the wallet sends locks with `icrc7_transfer` (optional recipient subaccount; the
  native call is the fallback against an older canister); a shared `components/LockGas.jsx`
  (balance, "about N transfers", Add gas dialog) is on the wallet's lock rows, `/lock/:id`,
  `/tokenlock` and the NFT page; Sneedex lists locks as NFTs of the Sneed Lock collection and
  the separate "Sneed Lock" asset type is hidden (still supported by the canister).

### Why not the alternatives

- **The lock pays its own fee (amount shrinks per transfer):** never stuck, but the amount drifts,
  which breaks "this lock is exactly X" for buyers, vesting and voting power.
- **A vault subaccount per lock holding the locked tokens:** gas-free moves, but the owner of the
  funds would exist only in Sneed Lock's state, giving up the "lost state only unlocks" property.

### Tests to write with it

Owner-paid and tank-paid transfers (balances to the e8s, both fee hops); refusal with no gas and
no effect; a ledger refusal on the second hop (the fee stays in the old owner's free balance,
the lock does not move); an ambiguous outcome; label-only moves cost nothing; gas withdrawal by
the owner only; a dissolving lock transfers; an expired lock refuses and burns on archive;
activation mints every live token lock once; Sneedex escrow with the owner's free balance empty
but a funded tank.

---

## 5 · Hotkeys: a separate `sneed_hotkey` registry

**Status (2026-10-20): planned.** No `sneed_hotkey` canister exists. Sneed Lock grants hotkeys
nothing, as decided.

**What hotkeys are for here:** acting for a lock without being able to move it, which mostly
means voting in `sneed_gov`. NNS hotkeys cannot disburse or change dissolve state, and
Sneed Lock has nothing else a hotkey could do. So **Sneed Lock needs no hotkeys at all**.
That keeps its surface smaller before ossification.

**A general registry:**
- `sneed_hotkey`: an owner principal sets hotkeys with scopes, for example
  `sneed_gov:vote`, `sneed_gov:*`, or a scope per DAO.
- Consumers ask `is_hotkey(owner, hotkey, scope)`. `sneed_gov` asks once per vote.

**Why owner-level, not per lock:**
- With NFTs, locks change hands. Owner-level hotkeys follow ownership automatically: the new
  owner's hotkeys apply, the old owner's stop.
- Per-lock hotkeys stored in Sneed Lock would have to be wiped on every transfer.
- If per-lock scoping is wanted, a scope can name a lock (`sneed_gov:vote:lock/1234`) without
  Sneed Lock knowing.

**Other consumers later:** Sneedex bidding, forum and SMS delegation. The bots keep their own
permission systems.

**Risk:** a compromised registry lets an attacker vote with other people's locks, never move
them. It stays DAO-upgradable. Consumers should treat it as a convenience, so the owner can
always act directly.

---

## 6 · What must be right before ossifying (integrator surface)

**Status (2026-10-20): partly done.** The read API, the paged queries, the log blocks and the
token-lock money layout are built; admin retirement is not finished.

- `get_lock_state` (single, batch, paged by owner and by ledger, and by swap for positions),
  with stable field names. Built: `get_lock_state`, `get_lock_states`, `get_lock_states_page`.
- The ICRC-3 log complete for every state change, including the new dissolve and NFT blocks.
  `sneed_gov` and indexers should be able to follow the log instead of scanning.
- ~~Paged versions of every list query.~~ Done (2026-10-15): the whole-store queries
  (`get_all_*`, `get_active_*`, `get_expired_*`, `get_ledger_token_locks`,
  `get_swap_position_locks`, `get_token_position_locks`, the three claim-history lists) are
  removed; `get_lock_states_page` gained `token` and `status` filters, `LockState` gained `dex`,
  and `get_claim_requests_page` pages the claim history. The text-log readers answer at most
  500 entries. Per-owner queries (`get_token_locks`, `get_claimed_positions_for_principal`,
  `get_position_ownerships`, `get_summed_locks`) stay: Sneedex calls `get_token_locks`, and they
  grow only with one owner's locks.
- Stable error variants on the new methods (`#Err` with codes, not only text). As built: the
  dissolve methods answer `LockOpError` variants; the ICRC-7/37 methods use `GenericError`
  codes (1 batch too large, 2 memo too long, 3 busy, 4 approval already expired, 5 too many
  approvals, 6 bad subaccount, 7 needs gas, 8 unlocked, 9 other). `withdraw_lock_gas` and the
  older methods still answer text.
- The token-lock money layout (section 4). Built.
- Admin retirement first (the hard-coded admin is already gone; the admin list is next): configuration (max lock
  length, fees) moves to governance-approved calls, then custody or the blackhole. Not done:
  configuration is still open to SNS governance **or** any principal on the admin list
  (`admin_add_admin` / `admin_remove_admin`).
- ~~Confirm the current mainnet `max_lock_length_ns`.~~ Confirmed 2026-10-20: 3,652 days (the
  default in code is 7 days, settable in days by `set_max_lock_length_days`). It now caps lock
  period + dissolve delay, so it decides how neuron-like a lock can be.

---

## 7 · Built on top: `sneed_gov` (outline; own spec next)

**Status (2026-10-20): planned.** No `sneed_gov` canister or spec exists yet.

`sneed_gov` turns Sneed Lock into a staking and governance module for any token,
permissionlessly. It reads Sneed Lock and never holds locks.

**One canister per DAO, bought on SneedApp.** Anyone creates a DAO canister for any token, the way
bots are created today. It runs its own timer for rewards, holds its own treasury and runs its
own proposals and votes. Nothing stops two people creating two DAOs around the same token, with
different rewards, rules and purposes: each DAO is its own canister and its own community.

- **Proposal archives** are canisters the DAO canister creates as it fills, the same pattern as
  the ICRC-3 archives already in `src/icrc3`. Old proposals and ballots move out and stay
  readable. Archive cycles come from the DAO, with SneedApp selling the top-up.
- **Who controls a DAO canister** is the trust question. A DAO whose creator can upgrade it can
  empty its treasury. After setup, control should pass to the custody canisters:
  - on code SneedApp publishes (blessed versions);
  - with upgrades approved by the DAO's own proposals.
  Custody today blesses only NNS ledger-suite code, so this extends it to a second list of
  blessed hashes. That needs its own design before treasuries hold real money.

**Rewards ("staking")**
- Anyone opens a reward program for token X:
  - a funding subaccount of `sneed_gov` that anyone can top up;
  - rules: which locks qualify (ledger, minimum lock period + delay), a weight curve
    (amount × multiplier by time to unlock), a rate per day, and an end date.
- **A pull model, not push:** a daily epoch snapshots qualifying locks (paged via
  `get_lock_state` or the log) and credits each lock owner's claimable balance. Owners claim
  when they like, which avoids paying a ledger fee for every dust payment every day. The
  same machinery as RLL, inverted.
- Program money is held per program, and a program's creator can only top it up or end it on
  its stated terms. Never sweep other funds.

**Voting**
- A DAO is a token X plus its parameters: who may propose, the proposal deposit (spam
  control, refunded unless rejected), voting period, quorum, and minimum time-to-unlock to
  vote. The last one is the NNS's 6-month rule and the main defence against borrowed votes.
- **Voting power is the DAO's choice within a small set of parameters**:
  - the amount, times a time-to-unlock bonus that grows linearly from 1× at the voting minimum
    to a chosen maximum (the NNS uses 2× at 8 years);
  - an optional age bonus for locks held unchanged (owner and amount) for a while;
  - a cap on any single lock's share, if wanted.
  The defaults copy the NNS shape.
- **Ballots are snapshotted per lock at proposal creation:** voting power from amount and time
  to unlock at that moment. Whoever owns the lock at vote time casts its ballot (owner or
  `sneed_hotkey` hotkey); one ballot per lock per proposal. Buying a lock mid-proposal buys at
  most its unspent ballot.
- What proposals can **do**, in order:
  1. motions (signal only);
  2. treasury transfers from a DAO treasury held by `sneed_gov`;
  3. control of canisters by making the DAO an approver of a **custody** deployment.
  The last one connects to `sneed_guardian`: a project's ledger under custody, governed by its
  own token's lockers. That is "an SNS for any token", without the SNS's swap and launch
  machinery.
- **LP locks and voting power:** an LP position's token amounts move with price, so phase 1 of
  `sneed_gov` counts token locks only. LP locks can earn rewards (weighted by position value at
  snapshot) before they vote.

**Main risks to design against:**
- vote buying through NFT markets (snapshot + minimum time-to-unlock);
- snapshot cost as lock counts grow (paged reads, or following the ICRC-3 log);
- a reward program draining faster than funded (rate × epochs checked at every epoch, with a
  pro-rata payout when short);
- governance capture of a small token's custody (custody's veto council and window still
  apply).

---

## 8 · Phasing and testing

1. **Sneed Lock v2a:** dissolve delays, token-lock extension, `get_lock_state`, paged queries,
   new log blocks. *Built, live.*
2. **Sneed Lock v2b:** ICRC-7 for LP locks, labels, ICRC-37, the activation mint, the symbol
   cache, the card image. *Built, live.*
3. **Sneed Lock v2c:** token locks as NFTs (layout A or B). *Built, live, on today's layout
   with gas (section 4).*
4. **`sneed_hotkey`**, then **`sneed_gov`** (rewards, then voting, then treasury and custody).
   *Planned.*

Each Sneed Lock phase:
- ships by SNS proposal after staging;
- is stable-compatible (new vars only);
- extends `test/canisters/tests/sneed-lock.test.js`:
  - dissolve state machine, including the cap and the effective expiry in every money path;
  - NFT transfer and burn;
  - approvals cleared on transfer;
  - `transfer_from` with labels;
  - Sneedex escrow by transfer and by approval;
  - an upgrade from the live build with real locks.
- runs the frontend audit of `expiry` arithmetic before release.

## Decided (2026-10-14)

- Lock limits: the min (5 s) and max (about 10 years, set by the DAO) apply to lock period +
  delay.
- Token locks keep today's layout (section 4). The fee rule was settled on 2026-10-15: owner's free
  balance, then the lock's gas tank, else refuse; the amount never shrinks.
- Dissolving locks can be transferred. While Sneedex holds a lock in escrow, only Sneedex could
  change its dissolve state and it never does, so a listing cannot change under a buyer. Time
  still runs, so a dissolving lock keeps dissolving while listed and the offer page shows the
  live state. Whether Sneedex should refuse or flag a dissolving lock is Sneedex's decision, not
  Sneed Lock's.
- Voting power: DAO parameters with NNS-shaped defaults (section 7).
- `sneed_gov` is one canister per DAO, sold on SneedApp, with its own proposal archives.

## Open questions

1. Control of DAO canisters: custody with SneedApp-blessed hashes (section 7). Needs a design.
2. Should a lock's age (for an age bonus) survive an NFT transfer? The NNS resets age on some
   changes; resetting on transfer stops age being bought.
