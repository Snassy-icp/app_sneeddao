/// The text get_api_doc answers: a short guide to Sneed Lock for agents (full reference: api-docs/sneed_lock.md).
module {
  public let text : Text = "# Sneed Lock (canister sneed_lock)

Sneed Lock is Sneed DAO's time-locking canister. It holds ICRC-1 tokens and ICPSwap liquidity positions for their owners and refuses to release them before the lock ends; every lock is also an ICRC-7/ICRC-37 NFT that can change hands while staying locked. Anyone can read every lock and any principal can integrate; the canister is controlled by the Sneed DAO SNS.

- Production: `pqsms-lqaaa-aaaal-ajjza-cai`
- Staging (same code, own state, real ledgers and pools): `25fsc-7yaaa-aaaal-qjt5q-cai`

## Units and encoding

- Amounts are ledger base units as `nat` (e8s for ICP); nothing is scaled by decimals.
- Expiries and times are `nat64` nanoseconds since the Unix epoch. A lock with a dissolve delay that is not dissolving has `expiry` = max nat64; show `earliest_unlock` from `get_lock_state` instead.
- Lock ids are `nat` (one counter for token and position locks). A position is `(swap_canister_id, position_id)`; `dex` must be `1` (ICPSwap).
- Three accounts per user P: frontend wallet `{owner = P}`; Sneed wallet `{owner = sneed_lock; subaccount = principalToSubAccount(P)}` (byte 0 = length, then the principal bytes); payment subaccount for ICP lock fees - never compute it, ask `getPaymentSubaccount(P)`.
- Most updates answer `variant { Ok; Err }` (Err is a record with `message` or a text); `transfer_position` answers ICPSwap's lowercase `ok`/`err`; `claim_position` a bare `bool`. Always branch on the variant.

## Authentication

Calls are authorised by the signing principal only; there is nothing else to register. Nothing on-chain is anonymous: locks, owners and the ICRC-3 activity log are public and tied to the principal that signs. A lock belongs to the principal that made it, so a user logged in with another principal sees other locks. Only the owner can move unlocked funds out, act on a position (one claimant per position) or change a lock. Admin methods are for Sneed governance, controllers and listed admins (`get_admin_list`).

## Fees, transfers and irreversible actions

- **Lock fee (ICP):** creating a lock may cost a fee set by governance (lower for Sneed Premium members). Check `getEffectiveLockFee(user, is_position_lock)` (update call, authoritative); `get_lock_fees_icp` is the fee table. Deposit ICP to the payment subaccount first; `create_lock` / `create_position_lock` then take exactly `fee_e8s` from it. Extending, transferring, claiming fees and adding liquidity cost no lock fee (ledger fees aside). An unused deposit comes back with `withdraw_payment_balance()` (to the caller's own default account, less the 10_000 e8s ICP fee; refused while a lock creation of the caller runs).
- **Special prices:** Special prices (spec/special_prices.md): besides the regular and premium fees there is an admin price (for this canister's admins who are people; canisters such as SNS governance never get it) and partner prices (per principal, with a public label and an optional expiry). Each is an optional override per fee (`token_lock_fee_icp_e8s`, `position_lock_fee_icp_e8s`); the lowest applicable price is charged, and `getEffectiveLockFee` already answers it. `get_special_prices()` (public) lists the admin prices and every partner entry; `get_special_prices_for(principal)` says which apply to a principal. Each fee payment records its `price_tier` (`regular`, `premium`, `admin` or `partner`) in its `sneedlock_fee_pay` block.
- **Ledger fees:** every token transfer pays the ledger fee, from the Sneed wallet on top of the amount (`transfer_tokens`), or from free balance or the lock's gas tank for token-lock transfers. `add_liquidity_to_locked_position` needs each non-zero amount above twice the ledger fee; tiny leftovers can stay in the pool as dust.
- **Irreversible:** a lock can never be shortened or cancelled (`extend_lock`, `update_position_lock` and `increase_dissolve_delay` only lengthen it). `create_lock` is not idempotent: two calls make two locks. `transfer_token_lock_ownership`, `transfer_position_ownership`, `icrc7_transfer` and `icrc37_transfer_from` hand the lock and its assets to someone else for good. `transfer_tokens` and `transfer_position` send assets out of Sneed Lock to any account. A position sent to Sneed Lock without `claim_position` first cannot be used by anyone through the API (only a DAO proposal can recover it).

## Asynchronous lifecycle and polling

- Token lock: transfer to the Sneed wallet, fund the fee, `create_lock`.
- Position lock, in this order: `claim_position` (while the user still owns it on ICPSwap), the pool's `transferPosition` to Sneed Lock, then `create_position_lock`.
- Dissolve delays: `start_dissolving` after the lock period, `stop_dissolving`, then free when the delay has run out.
- `claim_position_fees` returns gross amounts; ICPSwap delivers the fees to the Sneed wallet asynchronously (seconds). Poll the ledger balance, not the canister.
- Expired locks are archived lazily (`has_expired_locks`, `clear_expired_locks`). Read with queries; never cache \"locked\" across an expiry. Page lists with `get_lock_states_page` (`prev` = last id, `take` up to 500).

## Errors, retries and Busy

- `GenericError` with `error_code = 2`: another token operation of the caller is running - retry after it completes. `create_lock` / `create_position_lock` answer `... already in progress ...` while another lock creation, token operation or payment withdrawal of the caller runs.
- `Busy: ...` on fee claims or add-liquidity (per-pool mutex, or a fee delivery in transit): retry after a few seconds.
- `InProgress` on lock operations: a transfer of the lock is waiting on the ledger; retry shortly.
- A lock transfer whose ledger outcome is unknown leaves the lock with both parties (`InProgress`, `get_uncertain_token_locks()`): either holder calls `reconcile_token_lock(lock_id, null)`, which checks the ledger and keeps the lock with exactly one side.
- After a timeout, re-read state (`get_token_locks`, `get_lock_state`) before retrying a non-idempotent call.
- An add-liquidity failure that leaves tokens inside the pool names a `stranded record N`: it is public (`get_stranded`, ICRC-3 `sneedlock_stranded`) and an admin pays exactly it to the owner's Sneed wallet, once.

## Support reads

`get_info_entries` / `get_error_entries` and their id ranges are queries (they were update calls before October 2026; call them as queries now). For one principal (that principal or an admin): `get_log_entries_for(p, { errors; before; take })` (its text-log entries, newest first) and `get_payment_log_for(p, offset, limit)` (its lock-fee payments). Public: `get_claim_requests_page_for(owner, q)` (fee-claim history) and `get_stranded({ owner; unpaid_only; prev; take })`.

## Common pitfalls

- Query methods only answer query calls: the ingress guard refuses a query sent as an update call (e.g. dfx `--update`).
- Update arguments are capped at 4 KiB; ICRC-7/37 batches at `icrc7_max_update_batch_size` items.
- Pass the pool's own `token0`/`token1` to `create_position_lock`, in the pool's order: they are checked against the pool's `metadata()` and anything else is refused.
- `getEffectiveLockFee` and `getPaymentBalance` are update calls.
- Transferring a lock NFT moves its unclaimed position fees too.

## Start with these methods

`get_lock_limits`, `get_lock_states_page`, `get_lock_state`, `get_claimed_positions_for_principal`, `get_summed_locks`, `getEffectiveLockFee`, `getPaymentSubaccount`, `create_lock`, `create_position_lock`, `claim_position_fees`, `transfer_tokens`, `icrc3_get_blocks`.

## Full reference

- https://app.sneeddao.com/api-docs/sneed_lock.md
- Candid: https://app.sneeddao.com/api-docs/sneed_lock.did
- All Sneed APIs: https://app.sneeddao.com/llms.txt
";
};
