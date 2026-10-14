# Custody: DAO control of ledgers without per-canister proposals

Agreed on 2026-10-14. One canister codebase, `sneed_guardian`, deployed three times:

| Deployment | Controllers | Approvers | Who trusts whom |
|---|---|---|---|
| `sneed_guardian` | Sneed SNS root | Sneed governance | the project trusts Sneed DAO: the DAO can upgrade the guardian itself and so bypass any veto |
| `sneed_hole` | none (blackholed) | Sneed governance | the project trusts only the code: a DAO vote and the child's own rules are the only way in |
| `sneed_accord` | none (blackholed) | several DAOs' governance canisters, m-of-n | no single DAO can act alone |

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
              label; policy; registered_at; registered_by; status : ?Status }
Status    = { at; cycles; memory_size; module_hash; controllers; running; idle_cycles_burned_per_day;
              freezing_threshold; error }        // last canister_status read
Op        = { id; child; kind : OpKind; staged_by; staged_at; memo; fee_paid_e8s;
              approvals : [Principal]; oks : [Principal]; vetoes : [Principal]; state }
OpKind    = #set_controllers : [Principal]       // self not in the list = release the child
          | #install : { hash : Blob; arg : ?Blob }   // next blessed hash for the kind
          | #set_policy : Policy
          | #set_config : ConfigUpdate            // child = the guardian itself
          | #set_approvers : { approvers; threshold }
OpState   = #pending | #approved : Int | #vetoed | #executed : Int | #failed : Text | #expired | #cancelled
```

## Registration (permissionless, free)

`register(canister_id, kind, policy, suite, label)`:

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
guardian controls them and their hash is blessed.

Anyone may register any ledger they control, and anyone may stage and pay for an op
on any child: nothing about registering or staging favours the caller, the rules
decide what executes.

## Op lifecycle

```
stage ──► pending ──approvals ≥ threshold──► approved(at) ──execute──► executed
            │                                   │    ▲                     │
            │ vetoes ≥ vetoes_to_block           │    │ oks ≥ oks_required  └─► failed(text)
            └───────────────────────────────────┴──► vetoed
          (any state but executed) ──ttl──► expired;  staged_by / approver ──► cancelled
```

- `stage_op(child, kind, memo, payer)`: anyone, free. Validates the op against the
  child's kind and the blessed lists, records the payer (the caller unless named) and
  the fee due (the premium rate for Sneed Premium members; 0 for ops on the guardian
  itself). The fee is then paid by a plain transfer to the op's **payment subaccount**
  of the guardian ('o', version 1, op id big-endian in the last 8 bytes), which only
  the guardian can move. `get_op_payment(id)` tells where and how much.
- `approve_op(id)`: approvers only (the governance canisters, which call it through a
  GNSF when a proposal passes). At `threshold` approvals the op is approved and the
  veto window starts.
- `ok_op(id)`, `veto_op(id)`: the child's guardians. Vetoes reaching
  `vetoes_to_block` block the op for good.
- `validate_approve_op(id)`, the generic function's validator, refuses while the fee is
  not in the payment subaccount, so an approval proposal cannot even be filed for an
  unpaid op. (It is an update method: it reads the ICP ledger.)
- `execute_op(id)`: anyone, once the window has passed, the oks are in and the vetoes
  are short. First the fee is swept from the payment subaccount to the fee destination
  (the RLL): it pays for the attempt, so a failed op keeps it. Then the action runs;
  the result is recorded. A failed op stays failed; stage a new one.
- `refund_op(id)`: anyone, for an op that is no longer open (vetoed, failed, expired,
  cancelled, or executed with a surplus): whatever is left in the payment subaccount
  goes to the recorded payer. Anyone may pay on the payer's behalf; the guardian never
  attributes deposits to senders.
- `cancel_op(id)`: the stager or an approver, before execution.
- Ops not executed within `op_ttl_ns` (30 days) expire.

Policy changes are ops like any other and pass the rules in force at the time, so a
veto council cannot be dissolved around its back. Ops on the guardian itself
(`#set_config`, `#set_approvers`) have no guardians; the approver threshold is their
whole rule, with a configurable window.

## Auto-upgrade and the blessed path

Once a day the guardian reads `list_upgrade_steps` from the SNS wasm canister and
keeps the ordered list of blessed hashes per kind. For every child with
`auto_upgrade`, if its current hash is in the list and not the last, it fetches the
next version's bytes from the SNS wasm canister, checks the sha256, and installs it
in upgrade mode; ledgers first, then indexes, then archives; one step per run. Errors
are kept on the child and in the log. For children without the flag, the same check
is exposed as `list_upgradable()` so the frontend can stage one batch of ops and the
DAO can approve them in one proposal.

## Cycles

The guardian is the controller, so it is the only party that can read a blackholed
child's `canister_status`. The status timer refreshes every child's status (cycles,
memory, module hash, controllers, state) a few times a day and keeps the last reading.
Queries: `get_child`, `list_children`, `get_cycles_report(threshold)` (children under
the threshold, plus the guardian's own balance). ic-unicycle and the health page read
these; topping up is theirs to do (anyone can deposit cycles into any canister).
`refresh_status(child)` lets anyone force a reading, rate limited.

## Fees

| Fee | Default | Who pays |
|---|---|---|
| registration | 0 | nobody |
| blessed auto-upgrade | 0 | nobody |
| an op | `op_fee_e8s` (1 ICP), `premium_op_fee_e8s` (0.5 ICP) | the op's payer, into the op's payment subaccount; swept at execution |

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

## Not in v1

Custom wasms, non-ledger canisters, paying for cycles, moving children between
deployments (done by a `#set_controllers` op that adds the other guardian), and the
frontend's full op console. The pad gets a control choice per deployment, the token
checker learns to read a child's policy, and the health page reads the cycles report.
