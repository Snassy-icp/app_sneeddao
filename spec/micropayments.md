# Micropayments: prepaid balances per canister

Status (2026-10-23): draft spec, nothing built. Open questions in §16.

The idea is that anyone (a person, a bot, a DAO) pays per call for Sneed services beyond the free
tier. Each service canister keeps a small prepaid ICP balance per payer. It refills that balance
in batches by ICRC-2 pull, and charges each call from it with no ledger round trip. Sneed SMS is
the first service, then the backend's BTC reservation store, then the forum.

Generalises what is already built:
- `src/sneed_notifications` has user balances by ICRC-2 `top_up`, app balances for `sponsored`
  messages, refunds of failed deliveries, revenue forwarding with books checked against the
  ledger, and no withdraw.
- `src/sneed_mon` has a per-user balance, a deposit subaccount plus `credit_deposit`,
  `withdraw_balance`, auto top-up by ICRC-2 pull, a charge statement and special prices.
- `src/RateLimit.mo` and `src/RateRules.mo` (token buckets, `allows` in inspect, `take` in the
  method), `src/IngressGuard.mo`, `src/DaoSettings.mo`, `src/SpecialPrices.mo` and
  `src/icrc3/Log.mo`.

## 1. Goals and non-goals

Goals:
1. **Spam and cycle-drain protection.** Unfunded traffic beyond the free tier is refused in
   `inspect`, before it costs cycles. Under a flood, paying callers keep working.
2. **All use is legitimate.** A bot that needs 10,000 messages a day pays its way instead of
   being rate limited or banned. Humans keep today's free use.
3. **The money stays the user's.** Unused balance can always be withdrawn. The canister holds
   only small, capped amounts.
4. **The service runs at or above its cost.** Prices cover the cycles a call burns. Revenue goes
   to the RLL through the ICP splitter.
5. **One shared module** (`src/Prepaid.mo`), so every canister charges, logs, refunds and sweeps
   the same way, and support has one playbook.
6. **Additive only** for TACO DAO and every existing integrator. No method changes shape.

Non-goals:
- A shared balance across canisters. Cross-canister coordination is costly and fragile, and a bot
  should fund only what it uses and see what it pays for.
- A "Sneed credits" token. The best version of that is an ICRC-1 token, which ICP already is.
- Paying for queries. They stay free. Inspect already refuses queries sent as updates.
- Charging other canisters' costs, such as Sneed Notifications deliveries. Each service bills its
  own work.
- Price talk. Prices are set against cycles cost. The spec and the UI never discuss what ICP is
  worth.

## 2. Balance model

- **One balance per payer principal per canister**, in ICP: `Map<Principal, Account>` inside the
  canister.
- **Subaccounts are not balance keys.** They appear only as the *source* of an ICRC-2 pull
  (`from_subaccount`, as in sneed_mon's auto top-up) and as the *destination* of a withdrawal.
  - A user who wants separation approves from a dedicated wallet subaccount (Sneed Hub wallet
    subaccounts, spec/programmable_accounts.md).
  - That approval is also the hard cap on what the service can ever take.
- **Who is charged: the caller**, by default. A call may name a different payer only if the
  payer has granted the caller (below). The caller is never charged without asking for it: paid
  overflow is opt-in (§6).
- **Grants (third-party funding).** A payer may let other principals spend from its balance:
  `set_grant(grantee, { daily_cap_e8s; per_call_cap_e8s; expires_at; note })`.
  - **Bot operator.** One balance, N bot principals as grantees, each with its own daily cap. The
    operator's statement shows the spend per grantee.
  - **DAO paying for members.** The DAO's treasury (by proposal) or a DAO-controlled canister
    funds a balance and grants member principals.
    - A "grant to every staker of SNS X" rule needs a stake gate (spec/sneed_stake_gate.md). That
      is phase 2. Phase 1 takes explicit principal lists only, capped at
      `max_grants_per_payer` (default 1,000).
  - **App sponsorship.** Sneed Notifications' `sponsored = true` is a special case: the app's
    balance pays for its users. The module offers grants with a wildcard grantee (`#any`,
    payable only by named canisters of a registered app), so notifications can move onto the
    module without changing its API.
  - A call chooses the payer with a new optional field `payer : ?Principal`. With no payer, the
    caller pays. A grantee's free tier is used first, always.
- **No anonymous balances.** The anonymous principal can neither hold a balance nor be granted
  one. Every balance and grant is tied to a public principal, and the UI says so.

Per-payer state (stable):

```motoko
type Account = {
  balance_e8s : Nat;            // spendable
  reserved_e8s : Nat;           // charged for work not final yet (refundable), e.g. queued deliveries
  deposited_e8s : Nat; charged_e8s : Nat; refunded_e8s : Nat; withdrawn_e8s : Nat;  // lifetime
  refill : ?Refill;             // §3.1
  overflow : Bool;              // pay beyond the free tier (§6); default true after the first deposit
  created_at : Int; last_activity : Int;
};
```

## 3. Deposit paths

### 3.1 ICRC-2 pull with a cap (auto-refill, the default)

1. The payer approves the service canister on the ICP ledger (`icrc2_approve`). The allowance
   amount and expiry are the **total** the service may ever take. Sneed Hub suggests 10 refills'
   worth and an expiry of 90 days. Casual users click once.
2. `set_refill(?{ amount_e8s; when_below_e8s; from_subaccount })`. Bounds: `amount_e8s` from 10
   ledger fees up to `max_refill_e8s` (DAO setting, default 1 ICP); `when_below_e8s` at most the
   amount.
3. When a charge leaves `balance < when_below`, the payer goes on the **refill queue**.
   - A timer drains the queue with `icrc2_transfer_from({ from = payer/from_subaccount;
     amount; memo = "<svc>:refill:<n>"; created_at_time })`.
   - Parallel pulls are bounded by the cycles reserve (memory: IC call reservation limit; at most
     `parallel_pulls`, default 8). Each pull is credited in full, and the payer's wallet pays
     the ledger fee on top.
4. **A call that finds the balance short** while a refill is configured and not in backoff
   awaits one pull inline, under a per-payer lock, and then charges. This is the only await on
   the paid path. It happens at most once per refill, and the timer path makes it rare.
5. **A refused pull** (allowance spent or expired, wallet empty) sets
   `refill.failure = ?{ at; reason }` and a backoff of 1 h, then 24 h.
   - During backoff inspect treats the refill as absent. This blocks the "configure a refill with
     no allowance" drain.
   - The payer gets one free notice through Sneed Notifications, topic `account`.
6. A new `set_refill` or a successful deposit clears the backoff.
7. `set_refill` checks the allowance once, with `icrc2_allowance`, an update call made on
   purpose. A refill with no allowance is refused with "approve first".

### 3.2 Explicit deposit

- **ICRC-2 one-shot:** `deposit(amount_e8s, from_subaccount)` is today's notifications `top_up`.
- **Deposit subaccount:** `get_deposit_account()` returns the canister's own subaccount for the
  caller. The caller transfers there, then calls `credit_deposit()`, which moves it to the main
  account for one ledger fee and credits the rest. This is sneed_mon's path, and it works from
  wallets with no ICRC-2 (exchanges, CEX withdrawals).
- Both are idempotent:
  - Credited ledger blocks are kept, as notifications' `credited_blocks`, so an admin credit and
    a late success never double up.
  - `credit_deposit` with nothing new credits nothing.

### 3.3 Withdraw and refund

- `withdraw(amount_e8s, to : Account)`. It is always available, including while the canister is
  paused (spec rule: users can always get their money out).
  - It debits first, then transfers `amount − fee`, and undoes the debit when the ledger refuses
    or does not answer. This is sneed_mon's `withdrawBalance`, which uses the same per-payer lock
    as deposits.
  - Grantees cannot withdraw a payer's balance.
- `close()`: withdraw everything to the caller's main account, turn the refill off, and suggest
  revoking the allowance (the UI does that next with `icrc2_approve(0)`).
- **Refunds of failed work** go back to whoever paid, as notifications' `refundJob` does. Work
  that can fail after the charge holds its price in `reserved_e8s` until it is final.
- **Abandoned balances are never swept.** A balance idle for years stays the payer's. A
  possible `dormant_after` rule (§16) may only stop refills, never take funds.
- **Dust:** a balance at or below one ledger fee cannot be withdrawn (the transfer would deliver
  nothing). It stays spendable, and `close()` says so.

## 4. Charging

- **Unit.** Balances and charges are whole e8s. Prices are set in **milli-e8s** (1/1000 e8s),
  so per-KB and per-recipient parts can be finer than one e8s. A call's charge is
  `ceil(sum of parts in milli-e8s / 1000)`. Rounding up costs a payer under 1 e8s per call,
  never more. There is no fractional ledger to explain to support.
- **When.** A charge is applied in the same message as the work, after the last `await` and
  before the state change it pays for (no await between charge and effect). If the effect fails
  validation, nothing is charged.
  - For SMS, the premium check (`PremiumClient.isPremium`) is awaited first, then the free or
    paid decision, the charge and the message write all run in one atomic block.
- **The price tier.** `SpecialPrices` applies unchanged: the lowest of regular, premium, admin
  and partner. Every charge records its tier.
- **Caps per call.** A new optional `max_charge_e8s` on paid calls lets a bot refuse to pay more
  than it expected, for example after a price change. A higher charge returns
  `#price_changed { charge_e8s }` and charges nothing.
- **Revenue sweeps.** `fees_earned_e8s` grows with each charge and shrinks with refunds.
  - A timer forwards the unforwarded amount to `fee_destination` in one `icrc1_transfer` once
    it reaches `fee_sweep_threshold_e8s` (default 0.1 ICP).
  - `fee_destination` defaults to the ICP splitter: owner `6jvpj-sqaaa-aaaaj-azwnq-cai`,
    subaccount `01 00 00 00 00 06` followed by 26 zero bytes.
  - This is notifications' `forwardFees`, moved into the module:
    - the books (`free at base + earned − refunded − out − Δreserved`) are checked against
      `ledger balance − liabilities` before every transfer;
    - a transfer whose outcome is unknown is retried with identical arguments (the ledger
      deduplicates it);
    - a transfer that would leave the balance below the liabilities is never made.

## 5. Inspect-time checks and their limits

`inspect` gains one call per paid method: `Prepaid.admits(state, caller, payer, action, quote,
now)`. It is true when **any** of these holds:
1. the caller is rate exempt (admins, the exempt list); or
2. the free tier allows the call (`RateLimit.allows` on the free bucket); or
3. the payer's overflow is on, the grant (if any) covers it, and either `balance_e8s ≥ quote`
   or a refill is configured and not in backoff; and the paid ceiling bucket allows it.

`quote` is the price computed from the argument in inspect (sizes, recipient count) with the
regular price. Special prices only lower it.

Limits, stated plainly:
- **Inspect runs on one replica and cannot change state.** It is a filter, not a check:
  - n calls admitted together may all see the same balance;
  - a malicious boundary node or replica can skip it.
  The method re-checks everything with `take` and the real charge. The excess calls fail cheaply
  at the top of the method.
- **Inspect only sees ingress.** Calls from other canisters (TACO's, bots run as canisters)
  skip it. The update's own check is the only one they meet, and the canister pays for the
  execution of a refused inter-canister call (around 5–6M cycles). This is the floor of what an
  unfunded canister caller can cost us. A per-canister-caller RateLimit bucket bounds it.
- Inspect can't await, so it can't consult the ledger or premium status. Premium only loosens
  limits, so inspect uses the looser of the two, as SMS does today.

## 6. Free tier, and how it composes with RateLimit

The free tier is **today's limits, unchanged**. A call that passes them costs nothing and is
logged as it is today. Each paid action gets three buckets in `RateRules`:

| Bucket | Default (SMS `send`) | Meaning |
|---|---|---|
| `send` (exists) | capacity 10, 2/min, plus the 10-min gap (1 min for premium) | **free** allowance per principal |
| `send.free_global` (new) | capacity 600, 60/min across all callers | free sends the whole canister gives away. Under a Sybil flood, free calls are refused and paid calls pass. |
| `send.paid` (new) | capacity 600, 300/min per payer | **safety ceiling** for paid use, high enough for any honest bot. Above it, call support for a raised partner rule. |

Order inside the method:
1. Run the existing free check (`send_rate_ok` plus `check_rate_limit`).
2. If it passes, the call is free.
3. Else, if overflow is on and the paid bucket allows it, charge the call.
4. Else, return today's `#RateLimited` text, extended with "or fund your SMS balance".

The free buckets are consumed only by free calls, so paying never eats the human allowance.

The "minutes between messages" gap stays the free-tier gap. A paid send ignores it and updates
the timestamp as today.

RateLimit state stays transient (an upgrade refills buckets). The module's money state is stable.

**Overflow is opt-in.** Paid overflow is on only for a payer whose `overflow = true`. It turns on
by default at the first deposit and can be switched off with `set_overflow(false)`. So TACO, or
anyone who never deposits, sees exactly today's behaviour.

## 7. Pricing for Sneed SMS

### 7.1 What a send costs us (estimate from the code)

`send_message` (src/sneed_sms/main.mo:842) does the following:
- validates;
- awaits the premium check (cached);
- writes the message, the dedup indices and the sender and recipient indexes;
- makes one bounded-wait inter-canister call, `notify_batch`, to Sneed Notifications.

The table uses the 13-node subnet fees published in DFINITY's cycles cost table: ingress
1.2M + 2,000 per byte, update 5M + 0.4 per instruction, inter-canister call 260k + 1,000 per byte
plus callback execution, storage 127k per GiB-second. These must be re-checked against the
current table. Fees scale with subnet size (n/13).

| Part | Cycles (1 KB body, 1 recipient) | Scaling |
|---|---|---|
| Ingress reception | ~3.3M | +2,000 per byte, so ~10M at 5 KB |
| Execution (validate, index, write) | ~5M base + ~1–2M instructions | + per recipient: one dedup lookup and index insert |
| notify_batch call + callback | ~0.3M + ~0.5M payload + ~5M callback | + ~0.5M per recipient (payload) |
| ICRC-3 / logging | 0 today (message activity is never logged) | |
| **Storage, 10-year horizon** | ~3.8M per KB-year, so **~38M** | linear in bytes; recipients add index bytes |
| **Total** | **~55M cycles** | storage dominates long messages |

Measure before pricing. A PocketIC test records `performanceCounter` and the cycle balance delta
around a send at 1 KB / 5 KB / 20 KB and 1 / 20 / 50 recipients. Prices are then set from the
measured numbers with a margin of at least 2×.

### 7.2 Price shape

The proposed shape, as DAO settings in milli-e8s:

```
charge = base + per_kb × ceil(bytes(subject + body) / 1024) + per_recipient × (recipients − 1)
```

Conversion: the CMC's `xdr_permyriad_per_icp` is exactly the number of cycles one e8s buys
(1 XDR = 10¹² cycles, and 1 ICP = 10⁸ e8s), call it R. A cost of C cycles is C / R e8s. The
canister reads R daily from the CMC with a timer and caches it, which gives two modes (§16 Q1):
- **ICP-fixed** (simplest): the DAO sets e8s prices. `dao_settings()` shows next to each price
  what it covers in cycles at today's R, and the validator refuses a price below
  `cost_floor_cycles / R`.
- **Cycles-pegged** (recommended): the DAO sets prices in cycles (`base_cycles = 150M`,
  `per_kb_cycles = 80M`, `per_recipient_cycles = 10M`, about 2× the estimate). The charge in e8s
  is `ceil(cycles / R)` at the cached R.
  - Prices then never fall below cost when R moves, and no proposal is needed to keep up.
  - Bots see the current e8s quote and use `max_charge_e8s`.

### 7.3 Proposed initial values

These are cycles-pegged values, to be confirmed by measurement:

| Action | Price | Free tier |
|---|---|---|
| `send_message`, base | 150M cycles | today's limits |
| per KB of subject + body | 80M cycles | |
| per extra recipient | 10M cycles | |
| `send_message` with premium limits but no membership | same formula; the paid path takes premium size limits | |
| reads, inbox pages, `mark_messages_seen_up_to`, `remove_self_from_message` | free (rate-limited as now) | |

Notifications that SMS triggers stay billed to the *recipients'* notification balances
(`sponsored = false`), with notifications' per-app daily and spend caps protecting them. A paid
flood therefore cannot drain a recipient: their caps hold, and the always-copy channel (SMS
itself) is free.

## 8. Bots: discovery, estimates, idempotency

- `get_prices() : query -> PriceSheet` lists every paid action with:
  - the formula parts (cycles and e8s at the cached R);
  - `rate_updated_at`;
  - the free-tier rules;
  - the ceiling;
  - the caller's tier (premium, admin or partner).
- `estimate(action, params) : query` takes
  `{ action : Text; bytes : Nat; recipients : Nat; payer : ?Principal }` and returns
  `{ free : Bool; charge_e8s : Nat; tier; balance_e8s; would_refill : Bool; refused : ?Text }`.
  It is the same function the method uses, run without state change. A query, so it costs a bot
  nothing.
- **Idempotency.** A paid call may carry `op_id : ?Blob` (at most 32 bytes) and
  `created_at_time : ?Nat64`, modelled on the ICRC-1 dedup rules.
  - A repeat of `(payer, op_id)` within `dedup_window` (24 h) returns the first result, for
    example the same message id, and charges nothing.
  - `created_at_time` older than the window, or more than 2 min in the future, is refused.
  - Storage is bounded: at most 1,000 live entries per payer, evicted oldest first, and an entry
    holds only the 32-byte id, time and result. The paging audit's rule holds: nothing a user
    can grow for someone else, every list capped and paged.
- **Bot-readable errors.** New methods return a variant such as `#insufficient_balance { needed;
  balance; refill : ?{ pending; failure } }`, `#price_changed`, `#ceiling { retry_after_ns }` or
  `#grant_exhausted`.
  - Old methods keep their old error types. The new causes map onto `#RateLimited(Text)`, since
    adding a variant to a returned type breaks old Candid decoders.

## 9. Accounting and audit

- **ICRC-3 blocks (public) for money and governance:**
  - `<svc>_deposit`, `<svc>_refill`, `<svc>_withdraw`;
  - `<svc>_refund`;
  - `<svc>_grant_set` and `<svc>_grant_remove`;
  - `<svc>_admin_credit`;
  - `<svc>_fee_forward`, `<svc>_fee_remeasure`;
  - the `config_update` blocks of price changes, with `via = "dao"` or `"admin"`.
- **No block per charge.**
  - Volume: one SHA-256 per message in Motoko doubles the cost.
  - Privacy: SMS promises that its log never shows who sends messages.
  - Instead, each fee sweep writes a `<svc>_charges` block with the period's totals (count,
    charged, refunded, by tier), which ties revenue to the ledger transfer that follows.
- **Per-payer statement** (caller-only query, admins for support), newest first, paged
  (`start`, `len ≤ 100`):
  - the last 500 entries (charge, refund, deposit, refill, withdraw, grant spend);
  - **daily aggregates for 400 days**, so a busy bot's history never overflows;
  - each charge entry: `at`, action, size params, charge, tier, payer or grantee, op_id, and the
    resulting object id (message id).
- **Support** (memory: I am customer support):
  - `admin_get_payer(p)` returns the account, grants, refill state with its last failure,
    statement, in-flight pulls and dedup entries;
  - `admin_credit(p, ledger_block)` credits a deposit whose outcome was unknown, after the
    ledger check;
  - `admin_refund(p, amount, reason)` is logged, can only *add* to a payer's balance, and is
    capped by `fees_earned − forwarded`;
  - every failure path writes to the canister's `TextLog` with a correlation id.
  - There is no admin method that moves a user's balance anywhere but back to that user.
- **Public totals:** `get_fee_forwarding()` (as in notifications) and `get_accounting()` (as in
  sneed_mon) return liabilities, earned, forwarded, refunded and payer count. /revenue reads
  them.

## 10. DAO control

- Every price, free-tier rule, ceiling, refill bound and `fee_sweep_threshold_e8s` is a
  `DaoSettings` row (spec/dao_settings.md), with bounds in code. Examples:
  - `prepaid.send.base_cycles`: 1M … 10B;
  - `prepaid.send.paid.capacity`: 1 … 100,000;
  - `prepaid.max_refill_e8s`: 0.01 … 100 ICP.
- The module exports `Prepaid.settings(state) : [DaoSettings.Setting]`, so a canister appends
  them to its table in one line.
- Admins keep setters during the transition. Every change, admin or DAO, writes the same
  `config_update` block, and `expected` protects proposals. A single admin can never change a
  price unlogged.
- **Floors in code:** the validator refuses any price below the measured cycles floor of its
  action, so a careless proposal cannot make a service run at a loss.
- The fee destination stays admin-only money routing (spec/dao_settings.md §7.2), defaulting to
  the splitter.
- Partner prices stay `SpecialPrices`. A partner deal for a high-volume bot can also raise its
  ceiling (`partner_rules`).

## 11. Safety

- **Hold little:**
  - each balance is capped at `max_balance_e8s` (DAO, default 10 ICP); deposits above it are
    refused before the pull;
  - refills are small and frequent instead of large;
  - the allowance, not the balance, carries the user's headroom.
- **Liabilities invariant:** `ledger balance ≥ Σ balances + Σ reserved + pulls in flight`.
  - It is checked before every outgoing transfer (sweep, withdraw).
  - It is exposed in `get_accounting`.
  - A test drives random deposits, charges, refunds and sweeps and asserts it.
- **Reentrancy around `transfer_from` and `transfer`:**
  - **Pulls:**
    - a per-payer lock (`in_flight`, transient, as in sneed_mon), so one payer has one money
      operation at a time;
    - pulls in flight are counted as liabilities before the await;
    - a pull is credited in the callback, only on `#Ok(block)`, and only once per ledger block
      (`credited_blocks`).
  - **Withdrawals:** debit before the await, undo on `#Err` or reject. An unknown outcome on a
    bounded-wait call is never undone blindly: the retry is made with the same `created_at_time`
    and memo, and the ledger deduplicates it.
  - **Charges** never await: no await sits between a balance check and its debit.
- **Upgrades:**
  - All money state is stable (EOP: the module's `State` record in the actor). Upgrades need
    `wasm_memory_persistence = KEEP` (memory: EOP upgrades need KEEP), and the hash is verified
    after.
  - Locks and buckets are transient: an upgrade drops locks and refills buckets. A pull that was
    in flight across an upgrade is found on the ledger by its memo and `admin_credit`ed. The
    support tool lists `pulls_started − pulls_settled`.
- **Low cycles:** parallel pulls are bounded (memory: IC call reservation limit). Tests install
  with about 600B cycles.
- **Pause:** `admin_pause_paid` stops charging, refills and sweeps. Paid calls then fall back to
  the free tier only. Deposits are refused. **Withdraw keeps working.**

## 12. The shared module `src/Prepaid.mo`

Shaped like `Icrc3Log`: a stable `State`, a transient `Runtime` (locks, RateLimit buckets), an
`Environment` (ledger, self, now, `block`, `log` callbacks), and functions.

```motoko
public type State; public func init(cfg : Config) : State;
public func admits(s, rt, caller, payer : ?Principal, action, quote_milli : Nat, now) : Bool;      // inspect
public func authorize(s, rt, env, caller, payer, action, units : Units, opts : CallOpts)
  : { #free; #paid : Ticket; #dedup : Blob; #err : PayError };                                     // in the method, no await
public func commit(s, env, t : Ticket, result : Blob);  public func reserve(...); public func settle(...);  // charge, or hold and settle/refund
public func refillIfShort(s, rt, env, payer) : async* ();                                          // the one inline await
public func deposit / creditDeposit / withdraw / setRefill / setGrant : async* ...;
public func sweep(s, rt, env, force) : async* Result;  public func tick(...) : async* ();            // timer: refill queue, sweep, CMC rate
public func statement(s, p, start, len) : Page;  public func estimate(...); public func prices(...);
public func settings(s) : [DaoSettings.Setting];  public func catalogue() : [Text];                // dao rows, ICRC-3 block types
```

- Each canister declares its actions and unit formula (SMS: bytes and recipients) and its free
  rule hooks. The module owns everything about money.
- Notifications and sneed_mon move onto it later, mapping their existing methods. Their APIs
  stay unchanged, and notifications gains a `withdraw` (§14).

## 13. Frontend UX

- **Pockets.**
  - A generic adapter, `utils/pockets/adapters/prepaid.js`, is parameterised by canister. It
    reads `get_my_prepaid()`, deposits by approve plus `deposit`, withdraws with `withdraw`, and
    sets rules with `set_refill`.
  - Each service then becomes a pocket in one line: "Sneed SMS balance", next to "Sneed Monitor
    balance".
  - The notifications adapter's "cannot be withdrawn" note goes away when notifications moves
    onto the module.
- **Casual** (top of /sms and the wallet pocket):
  - The line reads "SMS: {formatValue(balance)} left · auto-refill on". Money is always shown
    with `useDenomination().formatValue`, never a hard-coded currency.
  - One button: "Turn on auto-refill". It approves 10 refills with a 90-day expiry and sets the
    refill.
  - A notice appears only when the free tier is used up: "You've used today's free messages.
    Send anyway for {formatValue(charge)}?"
  - The send button shows "free" or the price before sending.
- **Pro** (Advanced, and per-service pages under /me):
  - the statement with filters (action, grantee, day), CSV export, and daily aggregates as a
    chart;
  - refill settings, the allowance left and its expiry, revoke;
  - grants: add or remove bot principals with `PrincipalInput`, set caps, and see spend per
    grantee;
  - the price sheet and the free-tier rules.
- **Public, not anonymous:** balances and grants are tied to the principal. The UI says that
  deposits, withdrawals and grants are public ICRC-3 records. Per-message charges are visible
  only to the payer and support.

## 14. Migration plan

Each step is its own proposal, staging first (memory: Sneed DAO release process).

1. **Module and tests (no proposal).**
   - `src/Prepaid.mo` plus `test/canisters/tests/prepaid.test.js`, using a mock service canister
     that exercises:
     - the liabilities invariant;
     - double-pull and double-credit;
     - withdraw failure and undo;
     - dedup;
     - inspect admits and refuses;
     - low cycles.
   - Measure SMS cycles costs (§7.1).
2. **Sneed SMS (EOP, KEEP).** New, additive API:
   - optional input fields: `op_id`, `created_at_time`, `payer`, `max_charge_e8s`;
   - `send_message_v2`, returning the rich result;
   - the balance methods, `get_prices`, `estimate` and the statement;
   - `dao_set` rows.
   Old `send_message` keeps its type, and its paid overflow applies only to opted-in payers.
   Inspect gains the paid branch. Ship it with the pending paged inbox (paging audit S3).
3. **Backend: BTC reservation store (EOP, KEEP).**
   - New methods `put_btc_pending(record)`, `get_btc_pending(network)` and
     `delete_btc_pending(id)`, for the spec/sneed_wallet.md §5.5 records. Limits: ≤ 200 records
     per principal and ≤ 2 KB each.
   - Free tier: 50 writes a day per principal. Beyond that, paid through the module at about
     20M cycles a write.
   - A new store, so there is no existing usage to protect. The pilot of a pure "pay per write"
     micro-service.
   - The frontend switches `utils/btc/pending.js` to the backend, with a localStorage mirror.
4. **Forum posts and threads.** Same pattern on `thread` and `post`.
   - The free tier is today's buckets.
   - Paid overflow serves bots that summarise or bridge. The bridge may also be the first DAO
     grant: the DAO funds its own bridge principal.
5. **Sneed Notifications onto the module.** Balances, app balances (grants with `#any`) and
   forwarding move over. It gains `withdraw`, and the "service balance cannot be withdrawn"
   rule ends.
6. **sneed_mon onto the module.** It already matches. The tier billing becomes "reserve per
   round, settle per check".

## 15. TACO DAO impact

- Nothing changes for TACO unless they deposit:
  - no method is removed or changed in shape;
  - free limits are identical;
  - error types are unchanged.
  The new input fields are `opt`, which Candid accepts from old clients.
- If TACO's integration hits limits today, it can fund a balance, or a grant from the DAO, and
  stop being rate limited.
- Tell them in forum News topic 899, and in TACO HQ once Mr Sneed is in, before step 2 ships.

## 15a. Decisions (2026-10-23)

- **Prices are pegged to cycles plus a DAO margin.** price = measured cycles cost of the call × (1 + margin), converted to ICP at the cached CMC rate. The margin (a DaoSettings row, default 100% = the "about 2× cost" above) is the DAO's ICP profit and goes to the splitter with the rest of the revenue; the cycles part keeps the canister funded.
- **No separate opt-in for paid use.** Once a service has a price, a call beyond the free tier is charged automatically if the payer has balance (or a working refill), and rejected (at inspect, and again in the update) if it doesn't. Free-tier calls stay free and never touch the balance.
- **SMS retention follows the scaling plan:** once SMS moves to inbox canisters (memory scaling-sms-and-forums-plan), retention, and so storage pricing, is each inbox canister's policy. Until then the central canister prices storage as specced and the question stays open.
- **Notifications triggered by a paid SMS:** as today, the recipient pays by default; the sender can choose to pay instead (the `sponsored` flag that sneed_notifications already has: the app or sender balance pays all or nothing, `#no_funds` otherwise).
- **A common withdraw API across all services:** every service that holds user money exposes the same withdraw (and balance/statement) methods; where none exists yet (sneed_notifications today has no user withdraw), add it. Later, write this up as an ICRC-style standard draft (possibly together with the pockets balance spec, spec/programmable_accounts.md), so wallets can list and withdraw any service balance generically.

## 16. Open questions

1. **Pricing mode:** cycles-pegged prices with a daily CMC rate (recommended), or e8s prices set
   by proposal?
2. **Overflow default:** on at the first deposit (proposed), or an explicit opt-in toggle?
3. **Global free budget:** should Sybil protection (`free_global`) ship in step 2, or only after
   abuse is seen? It can refuse honest free users during a flood.
4. **Grant scope in phase 1:** explicit principal lists only, or a stake-gated "all members of
   SNS X" from the start?
5. **Storage horizon:** do messages live forever (price ~10 years of storage), or does SMS get
   retention, at least for system messages (paging audit S3)?
6. **Notification costs of paid SMS:** keep billing recipients (proposed), or let a paying
   sender sponsor recipients' notifications for an extra fee?
7. **Dormant balances:** do nothing (proposed), or stop refills after a year idle? Never sweep.
8. **Should SMS premium membership include a monthly paid allowance**, to blend Premium with
   micropayments?
9. **Backend reservations:** keep them free (they protect users' BTC from conflicts) and use
   the forum as the first pure paid service instead?
10. **Units:** are milli-e8s prices enough, or are any planned actions cheaper than 1 e8s even
    in aggregate (e.g. per-KB storage on Sneed Drive), which would need balances in milli-e8s?
