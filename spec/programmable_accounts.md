# Programmable accounts: wallet subaccounts, sneed_vault, funding trees (draft)

Three ideas from 2026-10-21 that build on each other:

1. **Wallet subaccounts.** Sneed Hub's wallet holds, sends from, receives on and approves
   (ICRC-2) from the user's own subaccounts. A prudent user gives approvals from a subaccount
   that holds limited funds, so a spender can never take more than that subaccount holds.
2. **Programmable accounts (`sneed_vault`).** A canister in which every principal owns a
   namespace of 65,536 subaccounts. Each subaccount carries **grants**: rules for who may request
   funds from it, how much, to where and under what conditions, a bit like neuron hotkeys with
   permissions. The vault checks the conditions itself (ledger balances, canister cycles), so a
   grantee can't take more than the target needs.
3. **Funding trees (Sneed Monitor).** Sneed Monitor (spec/sneed_mon.md) watches any accounts
   (token balances) and canisters (cycles) and tops them up from ICRC-2 approvals and from vault
   grants, in trees: A tops up B, B tops up C.

Status (2026-10-21): spec only, nothing built. sneed_mon's auto top-up (ICRC-2 with an optional
`from_subaccount`, spec/sneed_mon.md §3) is being built and is the first edge of a funding tree.

Open questions are marked **Q** and collected in §14.

## 1. Words

- **Account:** an ICRC-1 account `{ owner : principal; subaccount : opt blob }` on one ledger.
- **Wallet subaccount:** `{ owner = me; subaccount = s }`: my own principal's subaccount on a
  ledger. Only I can move it (with my key), or a spender I approved from it.
- **Vault subaccount:** `{ owner = sneed_vault; subaccount = owned(me, index) }`. The vault holds
  it; I own it by the namespace rule (§3). Only the vault can move it, on my instruction or on a
  grant I made.
- **Grant:** a rule on one vault subaccount that lets a **grantee** (a principal: a person, a bot,
  a canister, Sneed Monitor) request funds from it within limits.
- **Edge:** one link of a funding tree: "source pays target when target is below X". Its source
  is an ICRC-2 approval or a vault grant.

## 2. Where the accounts live

### 2.1 Recommendation: a new canister, `sneed_vault`

| option | for | against |
|---|---|---|
| **new `sneed_vault`** (recommended) | custody in one small canister that changes rarely and can later be frozen into a blessed hash (sneed_guardian, spec/custody.md); a bug in monitoring can't move funds; clean ICRC-3 log of fund movements only; usable by anyone (bots, other dapps, partners), not only Sneed Monitor customers | one more canister to deploy, fund with cycles and register |
| in `sneed_mon` | no cross-canister call between monitor and vault; already has billing and rounds | sneed_mon changes often (new watch kinds), so the code that holds user funds would be upgraded often; mixes an internal-ledger service balance with real custody; its own deposit subaccounts already use the index-0 layout (§3.3) |
| in `sneed_lock` | Sneed Lock already holds users' tokens in `principalToSubAccount(P)` (its "Sneed wallet", the same bytes as index 0) | Sneed Lock guards locked funds and is high value; programmable pulls widen its attack surface; its admin retirement is under way (no new powers) |

Sneed Monitor is a **client** of the vault: a grantee like any other (§7). The vault keeps the
rules and the money; Monitor keeps the schedule, the graph and the notifications.

Name: canister `sneed_vault`, product name **Sneed Vault**, the feature **programmable
accounts**. **Q1:** `sneed_vault` or `sneed_accounts`?

### 2.2 Custody: ledger balances, no internal ledger

| | **ledger subaccounts** (recommended) | internal bookkeeping (as sneed_mon's service balance) |
|---|---|---|
| balance | `icrc1_balance_of({ vault; owned(me, i) })`, readable by anyone on the ledger | a number in the vault; the ledger shows one pooled account |
| deposit | send to the subaccount; nothing to call | send, then `credit_deposit` sweeps it into the pool |
| tokens | any ICRC-1 ledger and ICP at once, no per-token accounting | per-token balances, invariants, a sweep per token |
| a vault bug | can move funds only by sending from a wrong `from_subaccount` | can also credit one user with another's funds by arithmetic |
| moves between my own subaccounts | a real transfer, costs a ledger fee | free |
| unknown outcome | the ledger is the truth; retry with the same `created_at_time` | must reconcile books against the ledger |

Recommendation: **balances are the ledger balances of the owned subaccounts**, as Sneed Lock's
Sneed wallet. The vault keeps no balance numbers for user funds, never sweeps, never pools, and
never touches a subaccount that is not the source of the transfer it is making. The ledger
refuses overdrafts, so no race can spend the same tokens twice; the vault's own state is only
rules, counters, reservations (§6.3) and the service credit (§10.2).

Never sweep others' funds: tokens sent to a vault subaccount that is not canonical (§3.2) belong
to no owner; the vault leaves them where they are. Only a DAO proposal can return them
(`admin_rescue`, §11, which refuses every canonical subaccount).

### 2.3 Tokens and fees

- **Ledgers:** any ICRC-1 ledger; ICRC-2 where the vault approves on the owner's behalf (§4.2) or
  pulls from a wallet; ICP through its ICRC-1/2 interface. For ICP the vault page also shows the
  legacy 64-hex account identifier, for deposits from exchanges.
- **Allowed ledgers:** a grant names its ledgers explicitly. The vault itself has no token list:
  the owner chose the token when they deposited it. Sneed Hub warns about ledgers its token
  safety rating (spec/token_safety.md) marks risky.
- **Ledger fee:** read with `icrc1_fee` before each transfer and passed as `fee`. The sender pays
  it, on top of the amount, out of the source subaccount. Limits count **amount + fee**, so a limit
  is a true cap on what leaves the subaccount. A changed fee (`BadFee`) is retried once with the
  new fee.
- **Cycles as a destination** (§5.3): from ICP through the CMC, or from the cycles ledger
  (`um5iw-rqaaa-aaaaq-qaaba-cai`, an ICRC-1/2 ledger whose `withdraw` sends cycles to a canister).
  **Q2:** support the cycles ledger from the start, or ICP→CMC only?

## 3. Owned subaccount namespace

### 3.1 Layout

```
byte  0       : L = length of the owner's principal bytes (0 < L <= 29)
bytes 1..L    : the principal bytes
bytes L+1..29 : zero
bytes 30..31  : index, big-endian (0..65,535)
```

Principal lengths (interface spec: at most 29 bytes):

| kind | bytes | room | allowed as owner |
|---|---|---|---|
| self-authenticating (people, II, keys) | 29 | exactly bytes 1..29, index in 30..31 | yes |
| canister / opaque ids | 10 | bytes 11..29 zero | yes (DAOs, bots, partner canisters) |
| derived ids (type 0x03) | up to 29 | padding zero | yes |
| anonymous `2vxsx-fae` | 1 (`0x04`) | | **no** |
| management canister `aaaaa-aa` | 0 | `owned(aaaaa-aa, 0)` would be 32 zero bytes, the vault's default account | **no** |

Every owner gets 65,536 subaccounts. The mapping is injective: the length byte fixes where the
principal ends, the padding is zero and the index is at a fixed place, so two (owner, index)
pairs never share a subaccount, and every subaccount decodes back to exactly one owner.

### 3.2 Canonical form and parsing

`parse(s)` returns `(owner, index)` only when `1 <= s[0] <= 29`, `s[1..L]` is a principal other
than the anonymous one, bytes `L+1..29` are zero and the size is 32. Anything else is
**non-canonical**: no owner, nothing the vault will send from. System subaccounts of the vault
use `s[0] >= 0xF0` (no principal is that long), for example the fee account `F0 'f' 'e' 'e' 0...`
and the service-credit pool `F1 ...`, so they can never parse as owned.

Public queries: `get_subaccount(owner, index) -> blob`, `parse_subaccount(blob) -> opt record {
owner; index }`. Sneed Hub computes them locally too (same bytes, tested against the queries).

### 3.3 Compatibility with the repo's existing derivations

- **Index 0 = the classic Sneed derivation.** `[L][principal][zeros]` is what sneed_premium
  (`Utils.principalToSubaccount`), sneedapp (`principalToSubaccount`, payment and CMC
  subaccounts), sneed_lock (the Sneed wallet), sneed_mon (`get_deposit_account`), sneed_pad and the
  frontend's `principalToSubAccount` from `@dfinity/utils` produce. So `owned(P, 0)` equals "P's
  subaccount" in every one of them, and the CMC top-up subaccount of canister C is `owned(C, 0)`.
  On the vault, index 0 is the owner's **main vault account**. The 2-byte index lives in bytes
  30..31, which the classic derivation leaves zero for every principal, so indices 1..65,535
  never collide with any classic subaccount of any principal.
- **Sneedex and Sneed Lock payment/escrow subaccounts** (`src/sneedex/Utils.mo`,
  `sneed_lock` `userPaymentSubaccount`) put a marker at byte 23 (`P`, `O`, `B`) and, for escrow, a
  64-bit id in bytes 24..31. For a 29-byte principal the marker and the id **overwrite principal
  bytes 22..28**, so those subaccounts keep only 22 of the 29 principal bytes and can't be decoded
  back to their owner. That is harmless where it is used (collisions would need a 176-bit match in
  a hash) but it is not a namespace. They live on other canisters, so they never meet vault
  subaccounts; if the vault namespace were ever adopted inside those canisters, their subaccounts
  would parse as non-canonical (non-zero padding or a broken principal) and stay out of it. No
  change to them is proposed.
- **Wallet subaccounts** (§4) use a different convention on purpose: they are subaccounts of the
  user's *own* principal, so the owner is already in `owner` and the subaccount is just a number.

## 4. Wallet subaccounts (Sneed Hub, phase 1, frontend only)

### 4.1 What the wallet does

- **Numbered subaccounts.** Wallet subaccount *n* is the 32-byte big-endian number *n* (n >= 1;
  0 is the main account). The ICRC-1 textual account then stays short (`<principal>-<checksum>.3`),
  which `AccountParser` (spec/subaccounts.md) already reads and writes. Raw 32-byte subaccounts
  (from elsewhere) are supported in Advanced.
- **Which exist.** A ledger can't list them. Sneed Hub merges: the subaccounts remembered in the
  browser, the ones the user created, and, for ICRC ledgers with an index-ng canister,
  `list_subaccounts({ owner })` (ICP's index has no such call; ICP subaccounts come from memory
  and a scan of 1..N). Empty ones are hidden unless named.
- **Hold:** the token list shows the total per token; a token row opens its accounts (main,
  each subaccount, the Sneed Lock wallet as today, vault subaccounts). Amounts use
  `useDenomination().formatValue` (never a hard-coded `$`).
- **Receive on:** a subaccount's card shows its textual account, a QR code and, for ICP, the
  64-hex account identifier.
- **Send from:** the send dialog gains a "from" picker (default: main). `from_subaccount` is set
  on the transfer; the existing split logic (`sendPlan.js`) learns about subaccounts later
  (**Q3**: let "send" draw from several subaccounts at once?).
- **Move between my accounts:** a send to my own subaccount, with the ledger fee shown.
- **Approve from a subaccount:** `icrc2_approve({ from_subaccount; spender; amount; expires_at;
  expected_allowance })`. The approve dialog suggests "approve from a new subaccount holding only
  what you want at risk": one click creates subaccount *n*, moves the amount plus fees there, and
  approves from it.
- **Approvals view.** Per token: spender, from which account, allowance, expiry. Sources: ICRC-103
  `icrc103_get_allowances` where the ledger lists it in `icrc1_supported_standards`; otherwise the
  approvals Sneed Hub made (remembered locally) plus approve transactions from the index, each
  confirmed with `icrc2_allowance`. **Revoke** is `icrc2_approve` with amount 0 (costs a ledger
  fee; said so). Sneed Monitor's auto top-up shows its approval here with a link.

### 4.2 ICRC-2 facts the UI must respect

- An approval is per (owner account, spender). A new `icrc2_approve` **replaces** the allowance;
  it does not add to it. `expected_allowance` makes it compare-and-set, which Sneed Hub always
  sets when it changes an existing allowance.
- Each `icrc2_transfer_from` consumes amount + ledger fee of the allowance.
- An approval costs one ledger fee, paid by the approver's account. Revoking costs one too.
- An expired allowance answers `InsufficientAllowance`, exactly as a used-up one.
- An approval is independent of the balance: the account may hold less than the allowance. That
  is what makes the limited-funds subaccount the real cap.

### 4.3 Names

Names are **local by default** (browser storage per principal: "Bots", "Savings"), wrapped in
try/catch, never relied on. An optional on-chain label for **vault** subaccounts (§6.1) is public
and says so. **Q4:** on-chain names for wallet subaccounts, through the naming service
(spec/sneed_names.md) as account names, or local only?

## 5. sneed_vault: owner operations

### 5.1 Owner calls

All take `index : nat16` (a subaccount of the caller's namespace) and are owner-only: the caller
is the principal in the subaccount. There is no way to act on someone else's namespace except
through a grant.

```candid
type Account = record { owner : principal; subaccount : opt blob };
type Dest = variant { account : Account; canister_cycles : principal };

transfer : (record { index : nat16; ledger : principal; amount : nat; to : Dest;
                     memo : opt blob; created_at_time : opt nat64 }) -> (TransferResult);
approve  : (record { index : nat16; ledger : principal; spender : Account; amount : nat;
                     expected_allowance : opt nat; expires_at : opt nat64 }) -> (ApproveResult);
set_label : (nat16, opt text) -> (variant { ok; err : text });        // public, <= 64 chars
get_my_accounts : () -> (vec AccountInfo) query;                      // labels, grants, counters
get_accounts_of : (principal) -> (vec AccountInfo) query;             // the same, public
```

- `transfer` to another of my own vault subaccounts is a plain ledger transfer between two vault
  subaccounts.
- `approve` makes the vault call `icrc2_approve` from that subaccount: a **raw approval**. Its
  spender pulls directly through the ledger and **bypasses every grant rule**; the UI says so and
  prefers a grant. It exists so a vault subaccount can feed contracts that only speak ICRC-2
  (including sneed_mon's auto top-up once it takes a full `from` account, §8.6).
- Owner calls are free of service fees (ledger fees only), like a wallet. **Q5:** charge a small
  fee per owner call to cover cycles?

### 5.2 Delegates

A grant (§6) only moves money. Managing rules is owner-only. **Q6:** add a "manager" role (a
second principal, like a neuron hotkey with `ManagePrincipals`, that can pause or revoke grants but
never create one or move funds), so a lost-key or compromised-bot emergency can be stopped from a
second device?

### 5.3 Cycles destinations

`canister_cycles(C)`:
- **From ICP:** `icrc1_transfer` of the amount to the CMC at `{ owner = CMC; subaccount = owned(C,
  0) }` with memo `TPUP` (`0x50555054`), then `notify_top_up({ block_index; canister_id = C })`.
  The block index is kept in a pending list until the CMC answered; `notify_top_up` is idempotent
  per block, so a failure is retried on the next request or by `retry_pending` (public, anyone
  may call it, it only finishes what was started). A block the CMC refuses is refunded by the CMC to the sending
  account (check on staging that this is the source subaccount).
- **From the cycles ledger:** `withdraw({ from_subaccount; to = C; amount; created_at_time })`.
- Other ledgers can't pay cycles.

## 6. Grants (the rules)

### 6.1 Shape

```candid
type Period = variant { hour; day; week; month_30d; seconds : nat64 };
type TokenLimit = record {
  ledger : principal;
  per_call_max : opt nat;            // amount + fee per request
  per_period_max : opt record { amount : nat; period : Period };
  total_max : opt nat;               // over the grant's life
};
type DestRule = variant {
  fixed : vec Dest;                  // at most 10
  grantee_own : null;                // { owner = grantee; subaccount = any } or canister_cycles(grantee)
  any : null;                        // Advanced only, with a warning
};
type CyclesSource = variant {
  blackhole : principal;             // a trusted blackhole controller of the target (§6.4)
  vault_controller : null;           // the vault is a controller of the target
  self_reported : null;              // the target's own query; unverified (§6.4)
};
type Condition = variant {
  balance_below : record { threshold : nat; fill_to : opt nat };  // the destination's balance of the same ledger
  cycles_below : record { threshold : nat; fill_to : opt nat; via : CyclesSource };
};
type Grant = record {
  id : nat;
  index : nat16;                     // the source subaccount
  grantee : principal;               // a person, bot, canister or sneed_mon
  label : opt text;                  // public, <= 64 chars
  tokens : vec TokenLimit;           // at most 10; a ledger not listed is refused
  destinations : DestRule;
  condition : opt Condition;
  min_interval_s : opt nat64;        // between executed requests; default 10 min when a condition is set
  expires_at : opt nat64;
  paused : bool;
  created_at : nat64;
  // counters, read-only: used_total per ledger, used_in_period + period_start per ledger,
  // requests_ok, requests_refused, last_request_at, last_refusal
};

set_grant : (record { id : opt nat; ... }) -> (variant { ok : nat; err : text });  // create or replace
pause_grant : (nat) -> (...); resume_grant : (nat) -> (...); revoke_grant : (nat) -> (...);
get_grants_of : (principal) -> (vec Grant) query;      // public
get_grants_for_grantee : (principal) -> (vec record { owner : principal; grant : Grant }) query;
```

Rules:
- **Grantees:** any principal except the anonymous one and the vault itself. Several grants may
  name the same grantee (one per destination, say).
- **Limits** are all optional, but a grant needs at least one of `per_call_max`,
  `per_period_max` or `total_max` per ledger (no unlimited grant from the casual path; Advanced
  may set huge values knowingly).
- **Periods** are fixed windows: `period_start` moves forward by whole periods at the first
  request after a window ends. So a grantee can use two windows' worth around a boundary; the
  UI says "up to X per day (a new day starts at <time>)". **Q7:** fixed windows, or a token bucket
  (no boundary burst, harder to explain)?
- **Replacing a grant** keeps its counters when the token and period stay the same, so a change
  can't reset a spent limit. Revoke is final (the id is never reused); pause is reversible.
- **Expiry:** an expired grant refuses requests and is shown as expired; it is kept for the record
  until the owner removes it.
- **Caps:** 200 grants per owner, 20 per subaccount, 10 destinations and 10 ledgers per grant,
  1,000 labelled subaccounts per owner, 20,000 owners with state. Admin-settable (B).

### 6.2 Destinations

- `fixed`: exactly the listed accounts or canisters. The usual choice: "my bot's canister",
  "my trading subaccount".
- `grantee_own`: anything owned by the grantee (its accounts, or cycles for the grantee if it is a
  canister). For "pay my bot's own expenses".
- `any`: the grantee chooses. Then only the limits protect the owner. Advanced only.

### 6.3 Conditions: refill only what is needed

A condition makes the vault read the destination before it pays, so the grantee can't take more
than the target needs:

- `balance_below`: `icrc1_balance_of(dest)` on the same ledger. The request is refused unless the
  balance is below `threshold`; the amount is then clipped to `fill_to - balance` (default
  `fill_to` = `threshold`), and to the limits.
- `cycles_below`: the target's cycles through `via` (§6.4); clipped to `fill_to - cycles`,
  converted at the CMC rate (`get_icp_xdr_conversion_rate`) for ICP, 1:1 for the cycles ledger.

What conditions do not stop: a grantee that controls the destination can move funds out of it and
ask again; cycles can be turned back into tokens through the cycles ledger's `deposit`. The
**limits are the hard cap**; conditions only stop needless refills by an honest or buggy
grantee. The UI says this next to every condition.

### 6.4 Reading cycles

Only a controller may call `canister_status`. The vault can read a target's cycles when:
- **a trusted blackhole** is a controller of the target and the vault asks it (ninegua's
  `e3mmv-5qaaa-aaaah-aadma-cai`, sneed_guardian_blackhole; the list is admin config, class C,
  because it decides whose answers are trusted);
- **the vault is a controller** of the target (unusual; a user could add it);
- **self-reported** (Advanced only): the target's own query (for example a bot's `get_cycles`).
  The target can lie, so this is labelled "unverified" and only the limits protect the owner.

**Q8:** a target with none of these: refuse cycles conditions, or allow them only as
"self-reported"? (Sneed Monitor passing its own reading in is ruled out: the vault must verify
itself, or a grantee could pass any number.)

## 7. Requesting funds

### 7.1 `request_funds`

```candid
request_funds : (record {
  owner : principal; index : nat16;        // the source subaccount
  grant_id : opt nat;                      // which grant, when several match
  ledger : principal;
  amount : nat;                            // what is asked (excluding the ledger fee)
  allow_partial : bool;                    // accept a clipped amount
  to : Dest;
  reason : opt text;                       // <= 200 chars, logged publicly
  created_at_time : opt nat64;             // dedupe, see §9.3
}) -> (variant {
  ok : record { amount : nat; fee : nat; ledger_block : opt nat; log_block : nat };
  err : variant {
    no_grant; paused; expired; token_not_allowed; destination_not_allowed;
    over_per_call : record { max : nat };
    over_period : record { remaining : nat; resets_at : nat64 };
    over_total : record { remaining : nat };
    too_soon : record { retry_at : nat64 };
    condition_not_met : record { current : nat; threshold : nat };
    condition_unverifiable : text;
    insufficient_funds : record { balance : nat };
    no_service_credit;
    busy;                                    // another request on this grant is in flight
    ledger_error : text;
    duplicate : record { log_block : nat };  // same request seen; its earlier answer
  };
});
```

Order: (1) find the grant and check everything that needs no call (paused, expiry, ledger,
destination, per-call, period, total, interval, service credit); (2) **reserve** the amount + fee
against the limits and mark the grant busy, before the first `await`; (3) read the condition, if
any, and clip; (4) transfer with unbounded wait; (5) commit the reservation (or release it on a
definite failure; keep it on an unknown outcome until a retry with the same arguments settles it);
(6) log; (7) charge (§10). Everything in (1) refuses with no outgoing call, so a refused request
costs the vault only instructions.

### 7.2 "Auto" mode: nobody has to ask

The owner may want top-ups without running a bot that calls `request_funds`. Two choices:

- **Through Sneed Monitor (recommended).** "Keep this topped up" creates a grant with grantee =
  sneed_mon, a fixed destination and a condition, plus a Monitor watch of that destination. Each
  Monitor round checks the destination (cheaply, it already polls) and, when it is low, calls
  `request_funds`; the vault re-checks the condition itself. The vault stays timer-free, small and
  rarely upgraded; scheduling, trees and notifications live in Monitor (§8).
- **A vault timer.** The vault evaluates its own auto grants. Simpler for single edges, but puts a
  scheduler, retries and billing into the custody canister.

**Q9:** Monitor-only auto, or a minimal vault timer in phase 3 so auto works before Monitor trees
ship?

## 8. Funding trees with Sneed Monitor

### 8.1 The graph

- **Nodes:** ledger accounts (wallet accounts, wallet subaccounts, vault subaccounts, anyone's
  account as a target only), canisters (cycles), and the user's sneed_mon service balance.
- **Edges:** `source -> target` with a ledger (or cycles), a condition (`below X, fill to Y`), and
  a source kind:
  - **ICRC-2 edge:** the source is an account that approved sneed_mon; Monitor calls
    `icrc2_transfer_from`. The allowance (and the subaccount's balance) is the cap.
  - **Vault edge:** the source is a vault subaccount with a grant to sneed_mon; Monitor calls
    `request_funds`. The grant's limits are the cap.
  - **Cycles edge:** target is a canister; source pays through the CMC or the cycles ledger.
- A node may be the target of one edge per ledger (one parent) and the source of many (children):
  a forest. **Q10:** allow several parents (a fallback source when the first is empty)?
- Different owners can share a tree: A's vault subaccount may feed B's canister.

### 8.2 Validation

- **No cycles:** adding an edge that closes a directed cycle in the flow graph of a ledger (or
  across ledgers through a conversion) is refused (DFS from the new target, at most `max_depth`
  steps). A cycle would let fees ping-pong funds away forever.
- **Depth** at most 8, **edges** at most 50 per user (admin-settable, B).
- An edge needs its cap to exist: the approval (checked with `icrc2_allowance`) or the grant
  (checked with `get_grants_for_grantee`). Missing caps show as a broken edge, not an error.

### 8.3 Order in a round

Leaves first (reverse topological order): if C is low, B pays C; B may now be low, so A pays B in
the same round. Each edge runs at most once a round. Independent edges run in parallel
(`tuning.parallel_calls`). An edge whose source is itself refilled in this round waits for that
refill.

### 8.4 Failures

- Source empty, allowance used up or expired, grant exhausted or paused, condition not met: the
  edge is marked **starved** with the reason, retried after a day (or at once when its source is
  refilled or the user changes it), and the owner is told once per failure streak.
- Passing trouble (reject, `TemporarilyUnavailable`, `busy`): next round, no message.
- A target still below its threshold after its edge failed raises the target's own low alert.
- An unknown outcome is retried with the same `created_at_time` (the ledger or the vault answers
  `Duplicate` / `duplicate`, which counts as done).

### 8.5 Notifications (Sneed Notifications, spec/sneed_notifications.md)

Monitor (app "Sneed Monitor") gains topics: `top_ups` (normal: "Topped up <target> with <amount>
from <source>"), `top_up_failed` (urgent: "<edge> starved: <reason>"), `low_balance` and
`low_cycles` (urgent, for watched nodes without an edge, or whose edge failed). The vault registers
its own app "Sneed Vault" for activity that doesn't pass through Monitor: `vault_requests`
(info: a grantee took funds), `vault_alerts` (urgent: a grant ran out, was refused repeatedly and
auto-paused, or expires within a week). Users pay for delivery as usual (`sponsored = false`).

### 8.6 What sneed_mon needs

- Watch kinds `#balance { account; ledger }` and `#cycles { canister; via }` (the `MonTopic`
  extension in spec/sneed_mon.md §8), priced per check like proposal watches.
- Edges as watch settings; the auto top-up being built now (`from_subaccount` of the user's own
  principal) becomes the first ICRC-2 edge whose target is the service balance. Later its source
  generalises to a full `from : Account` so a vault subaccount with a raw approval (§5.1) or a
  wallet subaccount can feed it.
- A tree view query: `get_my_tree()` with nodes, edges, last state and counters.

## 9. Security

### 9.1 Reentrancy and concurrency

- Every check and the reservation happen before the first `await` (§7.1). One request in flight
  per grant (`busy`), so a condition read can't be raced by a second request on the same grant.
- Requests on *different* grants of one subaccount may run together: each has its own
  reservation and the ledger refuses overdrafts. Owner transfers run alongside; the ledger is the
  arbiter.
- Ledger transfers are unbounded-wait (a reject means nothing moved). CMC notifications are
  idempotent and kept in a pending list until answered.
- Counters change only after the ledger answered. Locks are released in `finally`.

### 9.2 ICRC-2 semantics

- The vault never holds an allowance from a user's wallet unless the user gives it (an edge "my
  wallet refills my vault subaccount" is a Monitor ICRC-2 edge, with sneed_mon as spender; the
  vault is never a spender, so it can't pull from wallets at all).
- Raw approvals from vault subaccounts (§5.1) bypass grants; shown in red with "this spender is not
  bound by your rules".
- Approve replaces; Sneed Hub sends `expected_allowance`.

### 9.3 Dedupe

- `request_funds` with `created_at_time`: the vault remembers `(grantee, grant, created_at_time)`
  for 24 hours (the ledger's window) and answers `duplicate` with the earlier log block; the same
  `created_at_time` is passed to the ledger, which deduplicates the transfer itself. Requests
  without it are not deduplicated (said in the API doc).
- Owner `transfer` passes `created_at_time` through likewise.

### 9.4 Cycles DoS

- Refusals in step (1) cost no outgoing call. A condition check costs one call (about 0.26 B
  cycles plus bytes), paid from the owner's service credit as a check fee (§10). A grantee that
  makes more than `max_refused_per_day` (default 50) refused requests on a grant auto-pauses it
  and the owner is told: the grantee was the owner's choice, but it can't drain the credit.
- `min_interval_s` (default 10 minutes on conditional grants) bounds checks per grant.
- Ingress from a principal with no grant is refused in `inspect` (it reads the grantee index), so
  random callers cost nothing. Inter-canister calls bypass `inspect` and are refused at step (1).

### 9.5 Ingress guard

`system func inspect` with `src/IngressGuard.mo`, as every DAO canister: queries refused as
updates; anonymous callers refused; `admin_*` only from admins; `request_funds` only from a
principal with a grant; owner calls only when the caller has state or the call creates it;
arguments capped (`SMALL_ARG` for most, `textArg(200)` for requests with a reason, `MEDIUM_ARG`
for `set_grant`). Every new method joins the `msg` variant.

### 9.6 Other

- **Owners can always leave:** an owner's `transfer` is never blocked by grants, pauses or the
  service credit, and never needs the admins. An emergency `admin_pause_requests` stops grant
  requests only, never owner transfers.
- **No admin path to user funds:** no admin method sends from a canonical subaccount.
- **Key loss:** the namespace is bound to the principal; a lost key loses the vault subaccounts
  as it loses the wallet. A Q6 manager can at least pause grants.
- **Ledgers:** a malicious ledger can lie about balances; it is only ever the ledger of the
  owner's own token, so it can only mislead about that token.
- **Privacy:** nothing here is private. Balances are on the ledger, every vault subaccount carries
  its owner's principal in its bytes, grants, labels and requests (with reasons) are public
  queries and ICRC-3 blocks. The UI never offers anonymity or privacy (memory: no false
  anonymity); local names stay in the browser but are not secret.

### 9.7 Tests

PocketIC suite (`test/canisters`): namespace (every principal length, anonymous and management
refused, parse round-trip, index 0 equals the classic derivation), limits and windows, reservation
under concurrent requests, dedupe, unknown-outcome retry, conditions (mock ledger balances, mock
blackhole), CMC path with failing notify, inspect, upgrade keeping state, and the invariant "no
transfer ever leaves from a subaccount other than the request's source".

## 10. Fees and revenue

### 10.1 Prices

Consistent with Sneed Monitor (per unit of work, in ICP e8s, bookkeeping charges):

| fee | when | default (**Q11**) |
|---|---|---|
| `request_fee_e8s` | each executed request (grant or Monitor) | 10,000 (0.0001 ICP, one ICP ledger fee) |
| `check_fee_e8s` | each condition check, met or not | 2,000 |
| owner calls | `transfer`, `approve`, grants | free (ledger fees only) |

No monthly fee; storage is bounded by caps (§6.1). Monitor's edge checks are charged by Monitor
per check (its tiers); sneed_mon gets a **partner price** of 0 on the vault (special prices), so a
Monitor-driven top-up is not charged twice. **Q12:** a premium price for Sneed Premium members?

### 10.2 Service credit

A prepaid ICP balance per owner in the vault, kept like sneed_mon's balance: funded by
`fund_service_credit(index, amount)` (a transfer from one of the owner's ICP vault subaccounts to
the credit pool `F1...`, credited after the ledger accepted) or by a deposit and
`credit_deposit()`. Charges are bookkeeping. With no credit, requests answer `no_service_credit`
and the owner is told once. `withdraw_service_credit(amount, to)` returns it. Invariant: the pool
holds at least the sum of credits plus unforwarded fees (`get_accounting()`).

A credit refill can itself be an edge (Monitor tops up the credit from a subaccount).

### 10.3 Special prices and revenue

- `Prices = { request_fee_e8s : opt nat; check_fee_e8s : opt nat }` with `set_admin_prices`,
  `set_partner_prices`, `remove_partner_prices`, `get_special_prices`, `get_special_prices_for`
  (spec/special_prices.md §3, `src/SpecialPrices.mo`); each charge records its `price_tier`.
- Fees forward when they reach `fee_sweep_threshold_e8s` (0.1 ICP) to `fee_destination`, by
  default the RLL ICP splitter `6jvpj-sqaaa-aaaaj-azwnq-cai`, subaccount `01 00 00 00 00 06` + 26
  zero bytes; `null` keeps them for `admin_withdraw_fees`. Counters move after the ledger
  accepted; public `get_fee_forwarding` for /revenue.

## 11. Governance and admin

- **Controller:** Sneed DAO SNS root (`fp274-iaaaa-aaaaq-aacha-cai`) only. Upgrades by proposal;
  enhanced orthogonal persistence, so upgrade proposals set `wasm_memory_persistence = keep`. Later
  candidate for sneed_guardian custody (spec/custody.md): the code that holds user funds should
  only change to a blessed hash.
- **Admins:** controllers plus an admin list; Mr Sneed may hold maintenance admin like elsewhere,
  never powers over funds.
- **Admin methods and their proxy class** (spec/sneed_proxy.md §5): `admin_set_prices` and special
  prices B; `admin_set_limits` (caps, intervals, `max_refused_per_day`) B;
  `admin_set_fee_sweep_threshold` B; `admin_set_fee_destination` T; `admin_withdraw_fees` T;
  `admin_rescue(subaccount, ledger, to)` T (non-canonical subaccounts only, refuses any owned or
  system subaccount); `admin_set_trusted_blackholes` C; `admin_set_monitor` (which principal gets
  the Monitor partner price and notifications wiring) C; `admin_add_admin` / `admin_remove_admin`
  C; `admin_set_notifications_canister` C; `admin_pause_requests` / `admin_resume_requests` D
  (humans keep stop; the DAO alone may resume, as decided for emergency stops).
- **ICRC-3 log**, prefix `sneedvault_`, archived and registered with the SNS by proposal:
  `sneedvault_transfer` (owner), `sneedvault_approve` (owner raw approval), `sneedvault_grant_set`,
  `sneedvault_grant_pause`, `sneedvault_grant_resume`, `sneedvault_grant_revoke`,
  `sneedvault_request` (executed: grantee, grant, ledger, amount, fee, to, reason, condition
  reading, ledger block; refused requests are counted on the grant, not logged, to bound the log),
  `sneedvault_cmc_topup`, `sneedvault_credit`, `sneedvault_charge` (with `price_tier`),
  `sneedvault_fee_forward`, `sneedvault_config` (with `old_value`). `get_api_doc` and
  `public/api-docs/sneed_vault.md` as other canisters. No ICRC-85.

## 12. Sneed Hub UX

The user's rule: one-click simple path on top, full control behind **Advanced**.

### 12.1 Wallet (phase 1)

- **Casual:** token rows show totals; "Receive" offers "a new address for this" (creates
  subaccount *n*, local name); "Approve safely" (§4.1) creates a limited subaccount in one click.
- **Advanced:** per-token account list, raw subaccount entry, move between accounts, the
  approvals table with revoke, ICP account ids.

### 12.2 Vault page (`/vault`)

- **Casual:** "Set aside funds for <bot/canister>": pick the target (PrincipalInput), token
  (TokenSelector), "keep it at least X, refill to Y, at most Z a day". One click creates a vault
  subaccount, moves the funds there, makes a grant to sneed_mon with that condition and a Monitor
  watch (§7.2). The preview shows the worst case: "at most Z a day and T in total can leave this
  subaccount".
- **Advanced:** subaccounts with labels (on-chain labels marked public), balances, deposit
  address; a **rules editor** per subaccount (grantee, per-ledger limits, period, destinations,
  condition with its reading source and "verified/unverified", interval, expiry, pause, revoke)
  with the counters and last refusal; raw approvals; the service credit; the grant's ICRC-3
  history.
- **Grantee view:** "grants to me" (`get_grants_for_grantee`) for bots and canisters' admins.
- **Tree view:** nodes as cards (balance or cycles, threshold, state), edges as arrows labelled
  with the rule and its remaining limit; starved edges in red with the reason; "add edge"
  refuses cycles with an explanation. Phone width: a nested list instead of a graph.
- Amounts in the user's denomination; selects with explicit dark-mode colours.

## 13. Rollout

1. **Wallet subaccounts** (frontend only): numbered subaccounts, hold, send from, receive on, move,
   approve from a subaccount, approvals view and revoke. Sneed Monitor's auto top-up picks its
   `from_subaccount` from the list. No canister changes.
2. **sneed_vault v1:** namespace, owner transfer/approve/labels, grants with limits, ledgers,
   destinations, expiry, pause, revoke; `request_funds`; dedupe; service credit, fees, special
   prices, fee forwarding; ICRC-3; ingress guard; vault page with the rules editor. Staging first,
   then deploy and hand to SNS root.
3. **Conditions:** `balance_below`, `cycles_below` (blackhole, vault-controller, self-reported),
   fill-to clipping, cycles destinations through the CMC (and the cycles ledger, Q2).
4. **Monitor trees:** sneed_mon balance and cycles watches, ICRC-2 and vault edges, ordering,
   failures, new notification topics, tree view; sneed_mon's auto top-up source generalised to a
   full account.

## 14. Open questions

1. Canister name: `sneed_vault` or `sneed_accounts`?
2. Cycles ledger as a cycles source from the start, or ICP→CMC only?
3. Should "send" draw from several wallet subaccounts at once?
4. On-chain names for wallet subaccounts (naming service), or local only?
5. Charge owner calls (transfer/approve) a small service fee for cycles, or keep them free?
6. A "manager" delegate that can pause/revoke grants but not create them or move funds?
7. Limit periods: fixed windows (boundary burst) or a token bucket?
8. Cycles conditions on targets the vault can't read: refuse, or only allow "self-reported"?
9. Auto mode only through Sneed Monitor, or a minimal vault timer in phase 3?
10. Funding trees: one parent per node per ledger, or fallback parents?
11. Prices: 10,000 e8s per executed request and 2,000 per condition check, and the 0 partner price
    for sneed_mon: right, or a monthly per-subaccount fee instead?
12. A Sneed Premium price for vault fees?
13. Should the vault itself ever act as an ICRC-2 spender (pulling from wallets), or stay
    push-only with Monitor as the only puller (recommended: push-only)?
