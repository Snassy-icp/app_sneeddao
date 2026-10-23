# Custody: DAO control of ledgers without per-canister proposals

Agreed on 2026-10-14. One canister codebase, `sneed_guardian`, deployed three times:

> **Status (2026-10-20): v1 is built** (`src/sneed_guardian/main.mo`, `Types.mo`; PocketIC tests in `test/canisters`). The three deployments were renamed from `sneed_hole` / `sneed_accord` on 2026-10-19 and are declared in `dfx.json`. Only `sneed_guardian` is deployed, on staging (`ri7jl-6iaaa-aaaal-qxojq-cai`). The blackhole and multi-DAO deployments and every mainnet deployment are **planned**; no GNSF is registered yet. In the frontend, the console (`/guardian`) and the hand-over and index panels in the Token Studio are built but sit behind the "coming soon" gate (admins can preview them) until a deployment is marked `live` in `tokensafety/guardianIdl.js`.

| Deployment | Controllers | Approvers | Who trusts whom |
|---|---|---|---|
| `sneed_guardian` | Sneed SNS root | Sneed governance | the project trusts Sneed DAO: the DAO can upgrade the guardian itself and so bypass any veto |
| `sneed_guardian_blackhole` | none (blackholed) | Sneed governance | the project trusts only the code: a DAO vote and the child's own rules are the only way in |
| `sneed_guardian_multidao` | none (blackholed) | several DAOs' governance canisters, m-of-n | no single DAO can act alone |

The three differ only in configuration. The blackholed ones run code that first ran
under DAO control on staging and production, with the PocketIC suite as the net.

Why: a ledger that wants DAO control today needs a `RegisterDappCanisters`
proposal, a hotkeyed neuron, and either a bespoke set of generic nervous system
functions (GNSFs) or an SNS-root upgrade proposal per change. That does not scale past
a handful of canisters. With a custody canister as the controller, the DAO needs a
fixed handful of GNSFs that take the child canister as a parameter, and no dapp
canisters are registered with SNS root at all. This is the "Blank Canvas DAO" idea in
a form that can host hundreds of ledgers.

## Scope of v1

Ledger suites only: ledger, index and archive canisters of the ICRC ledger suite. The
hard rule that makes the blackholed deployments safe: **a child's code can only ever
be a hash the NNS blessed** (a version listed by the SNS wasm canister), and it can
only move one step along that list at a time, in the order ledger, index, archives,
the way the SNS upgrades its own suite. No custom wasm, no reinstall, ever. Other
canister kinds come later, once the veto and timelock story has been exercised.

## Data model

```
Kind      = #ledger | #index | #archive
Policy    = { guardians : [Principal];   // may veto an op and give go-aheads
              vetoes_to_block : Nat;     // 0 = vetoes off; this many vetoes block an approved op
              oks_required : Nat;        // 0 = none; this many guardians must ok before execution
              window_ns : Nat;           // time an approved op waits for vetoes before it may execute
              auto_upgrade : Bool }      // follow the blessed path without a vote
Child     = { canister_id; kind; suite : ?Principal (the ledger an index/archive belongs to);
              title; policy; registered_at; registered_by; status : ?Status;
              last_upgrade : ?{ at; from : ?Blob; to : Blob; by : Text };  // by = "auto" or "op <id>"
              last_upgrade_error : ?Text }
Status    = { at; cycles; memory_size; module_hash; controllers; running; idle_cycles_burned_per_day;
              freezing_threshold; error }        // last canister_status read; on a failed read the
                                                 // previous fields stay and `error` is set
Op        = { id; child; kind : OpKind; staged_by; staged_at; memo;
              payer;                             // refunds and surplus go here
              fee_e8s;                           // the fee due, fixed at staging
              fee_paid_e8s; refunded_e8s;
              approvals : [Principal]; oks : [Principal]; vetoes : [Principal]; state }
OpKind    = #set_controllers : [Principal]       // self not in the list = release the child
          | #install : { hash : Blob; arg : ?Blob }   // next blessed hash for the kind, or the
                                                      // current hash with an arg (reconfiguration)
          | #set_policy : Policy
          | #set_config : ConfigUpdate            // child = the guardian itself
          | #set_approvers : { approvers; threshold }
OpState   = #pending | #approved : Int | #vetoed | #executed : Int | #failed : Text | #expired | #cancelled
ConfigUpdate = { op_fee_e8s; premium_op_fee_e8s; fee_destination; op_ttl_ns; self_window_ns;
                 status_interval_s; low_cycles_threshold; cycle_reserve; paused;
                 approve_function_id : ??Nat64 }  // every field optional
Init      = { name; approvers; threshold; archive_controllers;  // the last: of the ICRC-3 log's archives
              admins; sneed_premium : ?Principal; fee_destination : ?Account;
              icp_ledger : ?Principal; sns_wasm : ?Principal }  // tests point these at mocks
```

Changed from the original plan: the child's `label` is called `title` (at most 64 characters). Ops record `payer`, `fee_e8s` and `refunded_e8s` for the payment-subaccount flow. The install argument fixes everything a blackholed deployment cannot change later.

Limits enforced by `validatePolicy` and `validateOp`: at most 20 guardians, none anonymous; `vetoes_to_block` and `oks_required` at most the number of guardians; `window_ns` at most 90 days, and non-zero when vetoes are on. `#set_controllers` takes 1 to 10 controllers, none anonymous. `#set_approvers` needs at least one approver and a threshold from 1 to the number of approvers. `#set_config` and `#set_approvers` must target the guardian itself; the other kinds must target a registered child.

Every state change is also a block in the guardian's own ICRC-3 log (`guardian_register`, `guardian_op_stage`, `guardian_op_approve`, `guardian_op_ok`, `guardian_op_veto`, `guardian_op_cancel`, `guardian_op_fee`, `guardian_op_execute`, `guardian_op_fail`, `guardian_op_refund`, `guardian_release`, `guardian_upgrade`, `guardian_policy_set`, `guardian_approvers_set`, `guardian_config_update`). A text log is kept as well (`get_text_log`).

## Registration (permissionless, free)

`register(canister_id, kind, policy, suite, title)` (signed-in callers, refused while paused; `suite`
must name a registered ledger and is given only for an index or archive):

1. the guardian must already be a controller of the canister: `canister_status`
   succeeds only then;
2. the caller must be one of the canister's current controllers (proof of ownership,
   read from the same status reply);
3. the module hash must be a blessed hash of that kind.

The registrant sets the initial policy. From then on the policy, like everything
else about the child, changes only through ops. The registrant drops themselves from
the controller list whenever they are ready; the guardian never does that for them.
Archives that a registered ledger spawns are discovered by the status timer (through
the ledger's `archives` query) and registered under the ledger's policy when the
guardian controls them and their hash is blessed. The guardian is then the registrant,
and the archive's title is the ledger's title plus " archive".

Anyone may register any ledger they control, and anyone may stage and pay for an op
on any child: nothing about registering or staging favours the caller, the rules
decide what executes.

## Op lifecycle

```
stage ──► pending ──approvals ≥ threshold──► approved(at) ──execute──► executed
            │                                   │    ▲                     │
            │ vetoes ≥ vetoes_to_block           │    │ oks ≥ oks_required  └─► failed(text)
            └───────────────────────────────────┴──► vetoed
          (pending or approved) ──ttl──► expired;  staged_by / approver ──► cancelled
```

Changed from the original plan: only pending and approved ops expire, since vetoed, failed and cancelled are already final. Expiry is applied lazily, when the op is next read.

- `stage_op(child, kind, memo, payer)`: any signed-in caller, free; refused while paused;
  memo at most 500 characters; an empty `#set_config` is refused; an `#install` upgrade argument
  at most 256 KiB; a non-admin may have at most `max_open_ops_per_caller` (10, `admin_set_max_open_ops`)
  open ops at once, and `stage_op`, `register` and `refund_op` are rate limited per caller
  (`get_rate_limits`, `admin_set_rate_limit`; src/RateLimit.mo). Validates the op against the
  child's kind and the blessed lists, records the payer (the caller unless named; never
  anonymous) and the fee due (the premium rate when the **payer** is a Sneed Premium
  member; 0 for ops on the guardian itself). The fee is then paid by a plain transfer to the op's **payment subaccount**
  of the guardian ('o', version 1, op id big-endian in the last 8 bytes), which only
  the guardian can move. `get_op_payment(id)` tells where and how much: the amount to send is
  the fee plus one ICP ledger fee, which pays for the later sweep.
- `approve_op(id)`: approvers only (the governance canisters, which call it through a
  GNSF when a proposal passes), on a pending op. At `threshold` approvals the op is approved and the
  veto window starts. An admin's approval counts as the whole threshold (see "Trial period").
- `ok_op(id)`, `veto_op(id)`: the child's guardians. Vetoes reaching
  `vetoes_to_block` block the op for good.
- `validate_approve_op(id)`, the generic function's validator, refuses while the fee is
  not in the payment subaccount, so an approval proposal cannot even be filed for an
  unpaid op. (It is an update method: it reads the ICP ledger.)
- `execute_op(id)`: any signed-in caller, once the window has passed, the oks are in and the vetoes
  are short. First the fee is swept from the payment subaccount to the fee destination
  (the RLL): it pays for the attempt, so a failed op keeps it. Then the action runs;
  the result is recorded. A failed op stays failed; stage a new one. Execution is not
  refused while paused. **Fixed 2026-10-20:** nothing marked an op as in flight, so two
  concurrent `execute_op` calls could both run the action and both sweep a fee from an
  overpaid op. The guardian now keeps a (transient) list of ops being executed: a second
  `execute_op` of the same op gets `#Err("op N is already being executed")`, and
  `cancel_op` and `veto_op` refuse with `op N is being executed` until it has finished.
- `refund_op(id)`: any signed-in caller, for an op that is no longer open (vetoed, failed, expired,
  cancelled, or executed with a surplus): whatever is left in the payment subaccount
  goes to the recorded payer. Anyone may pay on the payer's behalf; the guardian never
  attributes deposits to senders.
- `cancel_op(id)`: the stager or an approver, while pending or approved (admins only as approvers).
- Ops not executed within `op_ttl_ns` (30 days by default; a `#set_config` below one day is ignored) expire.
- Reads: `get_op`, `list_ops(open, limit)` (newest first; at most 100, `limit` 0 = 50, and fewer once
  install arguments pass about 1.5 MB), `list_ops_for(canister)` (the newest 100, same byte cap), and
  `list_op_summaries({ open; child; before; limit })`, which pages every op newest first with an install's
  argument as `arg_size` + `arg_sha256` only (the bytes come with `get_op`). `get_op_limits` lists the caps.

Policy changes are ops like any other and pass the rules in force at the time, so a
veto council cannot be dissolved around its back. Ops on the guardian itself
(`#set_config`, `#set_approvers`) have no guardians; the approver threshold is their
whole rule, with a configurable window (`self_window_ns`, 0 by default, at most 90 days).

`#set_controllers` refreshes the child's status afterwards. A list without the guardian
releases the child: it is dropped from the registry and a `guardian_release` block is logged.

## Auto-upgrade and the blessed path

Once a day the guardian reads `list_upgrade_steps` from the SNS wasm canister and
keeps the ordered list of blessed hashes per kind. For every child with
`auto_upgrade`, if its current hash is in the list and not the last, it fetches the
next version's bytes from the SNS wasm canister, checks the sha256, and installs it
in upgrade mode; ledgers first, then indexes, then archives; one step per run. Errors
are kept on the child and in the log. For children without the flag, the same check
is exposed as `list_upgradable()` so the frontend can stage one batch of ops and the
DAO can approve them in one proposal.

As built: the list is read up to 500 steps from the start. It is refreshed 2 seconds
after install or upgrade, whenever it is older than a day when a registration, an
`#install` op or the daily auto-upgrade needs it, and on demand through `refresh_blessed()`
(anyone, at most every ten minutes for non-admins). An empty answer keeps the old list.
`list_upgradable()` lists every child with a next blessed version, with or without the flag,
from the last status reading. Without an explicit `arg`, an upgrade passes "no changes"
(`opt Upgrade(null)` for a ledger, `opt Upgrade(record {})` for an index, `null` for an
archive). An `#install` with the current hash and an `arg` is a reconfiguration on the same
code. Auto-upgrade does not run while paused.

## Cycles

The guardian is the controller, so it is the only party that can read a blackholed
child's `canister_status`. The status timer refreshes every child's status (cycles,
memory, module hash, controllers, state) a few times a day and keeps the last reading.
Queries: `get_child`, `list_children`, `get_cycles_report(threshold)` (children under
the threshold, plus the guardian's own balance). ic-unicycle and the health page read
these; topping up is theirs to do (anyone can deposit cycles into any canister).
`refresh_status(child)` lets anyone force a reading, rate limited.

As built: the status timer runs every `status_interval_s` (6 hours by default, at least 10
minutes). `refresh_status` is limited to one call a minute across all non-admin callers.
`get_cycles_report(threshold)` puts the guardian's own row first (flagged `#ledger` in the
`kind` field) and uses `low_cycles_threshold` (2T) when no threshold is given. `get_suite(ledger)`
returns a ledger with its index and archives. `cycle_reserve` (2T) is configurable but not
used by any code path yet.

## Fees

| Fee | Default | Who pays |
|---|---|---|
| registration | 0 | nobody |
| blessed auto-upgrade | 0 | nobody |
| an op | `op_fee_e8s` (1 ICP), `premium_op_fee_e8s` (0.5 ICP) | the op's payer, into the op's payment subaccount; swept at execution |

**Special prices** (spec/special_prices.md, 2026-10-21): next to the regular and premium op fee,
an admin price and partner prices (`Prices = { op_fee_e8s : opt nat }`). The fee of an op is the
lowest of the base fee as before (premium for members), the admin price (when the caller is an
admin and a person) and the caller's partner price (when it has an entry that has not expired).
They apply only when the caller pays for its own op (`payer` null or the caller): a named payer
never lends its special price. Ops on the guardian itself stay free. Methods:
`set_admin_prices`, `set_partner_prices(principal, { label; prices; expires_at })`,
`remove_partner_prices` (admins, or an approver when it alone is the threshold: the same
principals who can change the op fee on their own today; special prices are not an op kind,
because a new `OpKind` case would change the Candid of `stage_op`, `get_op` and `list_ops`), and
the public queries `get_special_prices`, `get_special_prices_for(principal)` and
`get_op_price_tier(op_id)`. Every change is a `guardian_config_update` block (key `admin_prices`,
or `partner_prices` with `partner`); `guardian_op_stage` and `guardian_op_fee` carry
`price_tier` (`regular`, `premium`, `admin`, `partner`).

Fees are set by `#set_config` ops and go to the RLL. The payment-subaccount pattern
("pay first, the validator checks, the execution charges") works for any DAO service
granted by proposal, not only custody. A project that only ever needs
blessed upgrades pays nothing; the DAO carries no cost for them either.

## Trial period: admins

Each deployment is installed with an `admins` list. An admin's approval counts as the whole
threshold and admins may run the timers early, so a deployment can be exercised on staging and
in its first weeks on mainnet without a DAO vote per op. Admins can add admins and remove
themselves or each other; once the list is empty it cannot be refilled, so maturing a
deployment is a one-way step. Blackholed deployments are installed with an empty list.

As built: the canister's **controllers also count as admins** (`isAdmin` is controller or
listed admin), so on `sneed_guardian`, which SNS root controls, an emptied list can be refilled
by the DAO, which can upgrade the code anyway. Only a blackholed deployment's empty list is final.
Admin-only methods: `admin_add_admin`, `admin_remove_admin`, `admin_set_approve_function_id`
(during the trial; afterwards a `#set_config` op), `admin_set_canisters` (point the ICP ledger,
SNS wasm and premium canister ids at mocks), `admin_run_status`, `admin_run_auto_upgrade`. Admins
also bypass the rate limits of `refresh_status` and `refresh_blessed`. `paused` (a `#set_config`
op) stops registration, staging and auto-upgrade; approvals and execution still run.

## What the DAO registers

Per deployment, three GNSFs on the DAO's governance: `approve_op(id)` with validator
`validate_approve_op(id)`, and nothing else. (`cancel_op` by an approver is optional.)
Guardians act directly; everybody else's calls are permissionless.

## Around the custody canisters

- **Handover of any ledger** (`/studio/<ledger>/handover`, also `/custody`): for a ledger the
  signed-in principal controls, the wizard reads the suite (ledger, announced or pad-made
  indexes, archives), adds the custody canister as controller, registers each canister with
  the maintainer's policy (a veto council is optional) and, by default, steps down so the
  custody canister is the only controller. The guardian refuses code that is not blessed, so
  the wizard says so per canister before anything moves.
- **Index for an existing ledger** (`/studio/<ledger>/index`, `/studio/index`): the pad's
  `create_index` creates an index on the blessed index code for any ICRC-1 ledger, with the
  same payment flow and control choices as a launch, listed in the creator's wallet. A ledger
  may have several. Announcing it through ICRC-106 is a same-code upgrade with an argument:
  under custody that is an `#install` op with the current hash and an explicit `arg` (a
  reconfiguration, allowed when the hash is unchanged); otherwise a dfx upgrade by the
  controller. The safety check accepts an index the user names (`?index=`) and verifies it
  indexes the ledger.

Status of these (2026-10-20): both panels are built (`pages/studio/HandoverPanel.jsx`,
`IndexPanel.jsx`; the pad's `create_index`, `get_index_quote`, `get_indexes_of_ledger`), behind the
"coming soon" gate. The pad's launch wizard offers `#guardian { canister; policy }` as a control choice,
and the pad registers the new canisters with the custody canister (`register`). Fixed 2026-10-20: an index made by `create_index` was registered with `suite = null` even when the custody canister holds its ledger; the pad now asks the custody canister (`get_child(ledger)`) and passes the ledger as the suite when it is a registered ledger there, and `null` otherwise (the guardian refuses a suite that is not one of its ledgers), so `get_suite(ledger)` lists the index.

## Not in v1

Custom wasms, non-ledger canisters, paying for cycles, moving children between
deployments (done by a `#set_controllers` op that adds the other guardian), and the
frontend's full op console. The pad gets a control choice per deployment, the token
checker learns to read a child's policy, and the health page reads the cycles report.

Status (2026-10-20): the frontend items are built ahead of plan. `/guardian` is an op console
(rules, blessed versions, children with cycles and policy, open ops with stage, ok, veto, execute,
cancel and refund, approval by proposal). The pad's control choice and the token checker's policy
reading (a custody-controlled ledger passes the controller gate and shows its rules) are in, and
`/health` reads `get_config` and `get_cycles_report` for every deployment marked `live`. Custom wasms,
non-ledger canisters, cycles payments and moving children between deployments are still not built.
