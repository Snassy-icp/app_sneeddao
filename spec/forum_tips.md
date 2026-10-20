# Forum tips checked on the ledger

Status: built 2026-10-20 (sneed_sns_forum, TipVerify.mo), not deployed. Additive: no stable type changed.

## Why

`create_tip` used to store whatever the client claimed, so anyone could post fake tips (fake
amounts, other people's transfers, the same block many times) and push "Your post got a tip"
notifications, stats and wallet token lists with them.

## What the forum does now

The client still transfers first (`icrc1_transfer`, tipper's main account → post author's main
account, exact `amount`, fee on top) and then calls `create_tip(to, post_id, ledger, amount, opt block)`
with the same signature. The forum:

1. Refuses if `to` is not the post's author.
2. Refuses if `(ledger, block)` is already used by a tip (`stable_tip_blocks`) or reserved by a call in
   flight (`pending_tip_blocks`, transient; reserved before the await, released after it).
3. Reads the block once: ICRC-3 `icrc3_get_blocks` → fallback `get_transactions` (ledger suite);
   ICP ledger → `query_blocks` (account identifiers). Archives followed via the returned callback.
   Bounded-wait calls (30 s), so a ledger that never answers cannot block upgrades.
4. Outcome:
   - confirms → recorded `#verified`, block claimed, author notified;
   - contradicts (no such block, other sender/recipient/amount, mint/burn/approve/transfer_from) →
     `InvalidInput("Tip not recorded: …")`, nothing stored;
   - unreadable (no block index, ledger error) → recorded `#unchecked` with a note, block claimed, no
     notification.

## Why record unverifiable tips instead of refusing them

Old clients (older Sneed Hub builds, TACO DAO's frontend) keep working and get `ok(id)` for real tips,
and a ledger outage doesn't lose a tip the user really paid for: `verify_tip(id)` retries later. They
cost nothing in trust because nothing counts them: stats, wallet token summaries, the recent-tips
counters and notifications are verified-only, and Sneed Hub hides them. Contradicted tips are refused
outright: they are known to be false.

## State (all additive)

- `stable_tip_checks : Map<Nat, TipCheck>`: tip id → `{ status = #verified | #rejected | #unchecked; note; checked_at }`.
  No entry = recorded before this build (`TipResponse.verified = null`).
- `stable_tip_blocks : Map<Text, Nat>`: `"<ledger>:<block>"` → tip id.
- `stable_tip_blocks_backfilled : Bool`: postupgrade puts every existing tip's block into
  `stable_tip_blocks` once (first tip naming a block owns it), so old blocks can't be reused.
- `TipResponse` gains `verified : ?Bool` and `verification_note : ?Text` (response-only, additive).

## API

- `create_tip`: as before, plus the refusals above.
- `verify_tip(tip_id) : Result<Bool>`: any signed-in caller; checks a tip that is not yet verified
  or rejected (old tips included); final once verified or rejected; no notification.
- `get_api_doc() : text` (query): short agent guide (ApiDoc.mo).

## After the upgrade

Upgrade with `wasm_memory_persistence = keep` (EOP). Old tips show `verified = null` and count nowhere
until checked. To verify them, any principal can walk the ids (tips share the forum's id counter):

```bash
N=$(dfx canister --network ic call mcigm-4aaaa-aaaad-qhlkq-cai get_current_counter --query | grep -o '[0-9_]*' | tr -d _)
for i in $(seq 1 "$N"); do
  t=$(dfx canister --network ic call mcigm-4aaaa-aaaad-qhlkq-cai get_tip "($i : nat)" --query)
  echo "$t" | grep -q 'verified = null' && dfx canister --network ic call mcigm-4aaaa-aaaad-qhlkq-cai verify_tip "($i : nat)"
done
```

Each `verify_tip` costs the forum one or two ledger calls.

## Not done

- No age limit on the block: an older real transfer from the tipper to the author can be recorded
  as a tip once.
- The ledger is the one the client names; "verified" says the transfer is real on that ledger, not
  that the token has value. Showing only known tokens is a frontend matter.
