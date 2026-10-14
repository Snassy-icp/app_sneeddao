# Sneed Lock v2: dissolve delays, locks as NFTs (ICRC-7, ICRC-37), and what is built on top

Written 2026-10-14. This is the last round of features before Sneed Lock is meant to
**ossify** (admin retired, then blackholed or held by custody) and integrators are invited.
Everything an integrator will depend on has to be in, and right, before then: the money
layout, the lock lifecycle, the read API and the log. Features that only *use* locks
(rewards, voting, hotkeys) live in other canisters, which stay upgradable.

## Decisions at a glance

| Topic | Decision |
|---|---|
| Dissolve delay | Optional per lock. Dissolving can start only after the lock period ends. Start, stop and increase; never decrease except by dissolving. The min and max lock length apply to lock period + delay. |
| How old code stays safe | The stored `expiry` becomes the **effective unlock time**: unchanged for a lock without a delay, "never" (`Nat64` max) while a delay lock is not dissolving, the dissolve end while it is. Every existing `expiry <= now` check stays correct without being touched. |
| ICRC-7, phase 1 | **LP (position) locks** are NFTs. An ownership transfer is bookkeeping: no ledger call, no fee. |
| ICRC-7, phase 2 | **Token locks** become NFTs on today's layout (tokens in the owner's subaccount). An NFT transfer is paid by the lock itself: the lock shrinks by one ledger fee. Decided 2026-10-14. |
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

New stable vars only (the stored lock records do not change shape):

```
LockEnd       lock_id → Nat64       // end of the lock period (y). Absent = the stored expiry.
DissolveDelay lock_id → Nat64       // x in ns. Absent = 0.
Dissolving    lock_id → Nat64       // the time dissolving finishes. Absent = not dissolving.
```

### Rules

- **Locked** while `now < lock_end`, or while `delay > 0` and the lock has not finished
  dissolving.
- **start_dissolving(lock_id)**: owner only; needs `delay > 0`, not already dissolving, and
  `now ≥ lock_end`. Sets `dissolving_until = now + delay`.
- **stop_dissolving(lock_id)**: owner only; while dissolving and `now < dissolving_until`.
  Sets `delay = dissolving_until − now` and clears `Dissolving`, as the NNS does.
- **increase_dissolve_delay(lock_id, new_delay)**: owner only, while the lock is locked.
  - Not dissolving: `new_delay > delay`.
  - Dissolving: `dissolving_until` moves out by `new_delay − remaining`.
  - Adding a delay to an existing no-delay lock is allowed while it is still locked.
- **extend_lock(lock_id, new_end)**: owner only, while not dissolving; `new_end > lock_end`.
  This is new for token locks, which today cannot be extended at all. Position locks already
  extend through `update_position_lock`, which follows the same rule.
- **The limits** apply to lock period + delay. On mainnet the minimum is 5 seconds (the code's
  default; the user remembered 5 minutes) and the maximum about 10 years (locks expiring in
  2035 exist; the DAO sets it with `set_max_lock_length_days`).
  - At creation: `min ≤ (lock_end − now) + delay ≤ max`.
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

`get_lock_state(lock_id)` returns:

```
{
  kind;
  owner : Account;          // the label is included
  lock_end;
  dissolve_delay;
  dissolving_until : ?Nat64;
  effective_expiry;
  locked : Bool;
  time_to_unlock : ?Nat64;  // null = not dissolving
}
```

Plus a batch form and paged forms per owner and per ledger. This is the single query
`sneed_gov` and integrators build on.

### Log

New ICRC-3 block types:
- `sneedlock_dissolve_start`
- `sneedlock_dissolve_stop`
- `sneedlock_dissolve_delay_increase`
- `sneedlock_token_lock_extend`

The existing create blocks gain an optional `dissolve_delay` field.

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
  `"meta": "activation"`.
- **Burned** when the position leaves Sneed Lock (`claim_position`, withdrawal): `7burn`.
  `icrc7_owner_of` then answers `null`.
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
- Expired approvals are refused, and pruned when touched and by a daily sweep.
- `created_at_time` is checked against a 24-hour window, as for transfers. Duplicates within
  the window are refused (`Duplicate`), using a bounded recent-transactions set.
- Logged as `37approve`, `37approve_coll`, `37revoke`, `37revoke_coll` and `37xfer`, each with
  the standard fields.

**Why with phase 1:** it lets Sneedex and other marketplaces list a lock **by approval**. The
seller approves, the market pulls the lock into its escrow account at listing time, and it
then sits in the market's labelled subaccount. That is one step for the seller instead of a
transfer plus an escrow call.

---

## 4 · Token locks as NFTs (phase 2): today's layout, the lock pays its own fee

**Decided 2026-10-14: keep the layout.** A token lock's tokens sit in Sneed Lock's subaccount for
the owner principal, shared by that owner's locks of the ledger, with the locks reserving amounts
in it. The accounting needs no state kept by Sneed Lock: the owner's tokens are in the owner's
subaccount. If the lock records were ever lost, the failure would be that funds unlock, never that
they are stranded. A per-lock vault subaccount would give that up, since its owner would exist only
in Sneed Lock's state.

The cost is that an ownership change is a ledger transfer from the old owner's subaccount to the
new one's, which costs one ledger fee. ICRC-7 transfers are expected to just work, so **the lock
pays its own fee**:

- An NFT transfer (`icrc7_transfer`, `icrc37_transfer_from`) of a token lock of amount `A` sends
  `A − fee` from the old owner's subaccount to the new owner's. The ledger debits `A` in all
  (`A − fee` plus the fee).
- The lock continues for the new owner with amount `A − fee`, same id, same lock and dissolve
  state.
- **The old owner's free balance is untouched:** their subaccount loses `A` and their locked
  total loses `A`. Nobody has to pre-fund anything.
- A lock with `A ≤ fee` cannot be transferred (`GenericError`).
- Each transfer makes the lock one fee smaller. The NFT card shows the live amount, and the
  metadata says so.
- The existing `transfer_token_lock_ownership`, where the sender pays the fee from free balance,
  stays as it is for existing callers (Sneedex's lock escrow).
- Fee changes on the ledger are read at transfer time (`icrc1_fee`). `BadFee` is retried once
  with the fee the ledger names.

The ledger transfer is an await, so the lock is held by the existing per-principal
`token_op_locks` for both the sender and the recipient while it runs, exactly as
`transfer_token_lock_ownership` does today.

---

## 5 · Hotkeys: a separate `sneed_hotkey` registry

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

- `get_lock_state` (single, batch, paged by owner and by ledger, and by swap for positions),
  with stable field names.
- The ICRC-3 log complete for every state change, including the new dissolve and NFT blocks.
  `sneed_gov` and indexers should be able to follow the log instead of scanning.
- Paged versions of every list query. Several of today's `get_all_*` queries return whole
  stores, which will not fit a reply as locks grow.
- Stable error variants on the new methods (`#Err` with codes, not only text).
- The token-lock money layout (section 4).
- Admin retirement first (the hard-coded admin is already gone; the admin list is next): configuration (max lock
  length, fees) moves to governance-approved calls, then custody or the blackhole.
- Confirm the current mainnet `max_lock_length_ns` (the default in code is 7 days, settable in
  days by `set_max_lock_length_days`). It now caps lock period + dissolve delay, so it decides
  how neuron-like a lock can be.

---

## 7 · Built on top: `sneed_gov` (outline; own spec next)

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
   new log blocks.
2. **Sneed Lock v2b:** ICRC-7 for LP locks, labels, ICRC-37, the activation mint, the symbol
   cache, the card image.
3. **Sneed Lock v2c:** token locks as NFTs (layout A or B).
4. **`sneed_hotkey`**, then **`sneed_gov`** (rewards, then voting, then treasury and custody).

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
- Token locks keep today's layout; an NFT transfer is paid by the lock (section 4).
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
