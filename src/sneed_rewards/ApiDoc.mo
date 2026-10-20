/// The get_api_doc text of rll (src/sneed_rewards): a short guide for agents (ICP service discoverability).
module {
  public let text : Text = "# RLL rewards (canister rll)

RLL is where Sneed DAO's Recursive Liquidity Loop pays out. Tokens that reach its main account (the DAO's revenue among them) are shared once a day among the owners of Sneed DAO neurons, in proportion to the voting power their neurons cast on Sneed DAO proposals. Owners, or principals added as hotkeys to their neurons, claim to their own wallet whenever they like. Every balance, distribution and claim is public.

- Production: `lvc4n-7aaaa-aaaam-adm6a-cai`
- Staging: `twapx-riaaa-aaaak-qlojq-cai` (separate state; use it to test)
- Controlled by Sneed DAO's SNS root; upgrades go through DAO proposals. Neurons and proposals come from Sneed SNS governance `fi3zi-fyaaa-aaaaq-aachq-cai`.

## Units and encoding

- Amounts are base units of each token's ledger (`nat`); tokens are identified by ledger principal.
- `DistributionEvent` / `UserDistributionEvent` timestamps and `get_main_loop_status` times are `int` nanoseconds; `ClaimEvent.timestamp` is `nat64` nanoseconds; governance proposal times are seconds (`*_seconds`).
- `claim_full_balance_of_hotkey` returns the ICRC-1 `TransferResult` (`Ok : nat` block index or `Err : TransferError`). Admin methods return `Result` (`ok : text` / `err : text`) or trap for non-admins.

## Authentication

- Queries answer anyone. Claiming is permissionless for any principal with a permission (owner or hotkey) on a Sneed neuron.
- Shares are credited to each neuron's owner. A claim pays the **caller** the summed balances of the owners of every neuron the caller has a permission on (first 100 governance lists). **A hotkey can claim its neuron owner's rewards to itself**; only add hotkeys you trust with them.
- Calls are signed by a principal that is public on-chain; claims are logged under that principal. Nothing here is anonymous.
- Admin methods (main loop, imports, token lists, limits, claim incidents, resets) are for controllers, Sneed SNS governance and `list_admins()`.

## Fees, transfers and irreversible actions

- **A claim transfers tokens**: the caller receives `total - fee` in `{ owner = caller; subaccount = null }`, memo `rll-claim:<sequence_number>`. `fee` must be the ledger's current fee (`icrc1_fee()`); a wrong one gives `BadFee`. A total not above the fee is refused with `InsufficientFunds` (nothing to claim yet). A transfer that landed is final.
- **Adding rewards is a plain ICRC-1 transfer** to the main account `{ owner = rll; subaccount = null }`; it cannot be taken back and is shared in the next daily cycle. Only known tokens (`get_known_tokens()`, imported from ICPSwap's trusted list or added by admins) are distributed; others wait until an admin adds them.
- Per cycle a token is distributed only if the undistributed amount reaches its minimum (default 10 x the ledger fee) and up to its maximum if one is set. Rounding dust waits for the next cycle.

## Asynchronous lifecycle and polling

- While `get_main_loop_status().is_running`, a cycle starts every `frequency_seconds` (once a day): whitelist import, balance check, neuron import, proposal import, distribution. `get_import_stage()` reports the stage. Polling more often than every few minutes gains nothing.
- Earnings follow voting: per neuron, the voting power of ballots actually cast on proposals 1 up to `get_highest_closed_proposal_id()`. A neuron that never votes earns nothing.
- A claim logs a `Pending` `ClaimEvent`, then `Success` (with `tx_index`) or `Failed` under the same `sequence_number`.

## Activity log (ICRC-3)

- Every distribution (`rll_distribution`, then one `rll_credit` per owner credited), paid claim (`rll_claim`, with the owners whose balances paid it), unknown-outcome claim and its resolution, each cycle's per-token reconciliation and every admin change is a certified, hash-chained block: `icrc3_get_blocks`, `icrc3_get_archives`, `icrc3_get_tip_certificate`, `icrc3_supported_block_types` (queries). Old blocks move to archive canisters. Block types: https://app.sneeddao.com/api/rll#block-types

## Errors, retries and Busy

- Retrying a claim is safe: balances are debited before the transfer and restored only when it certainly did not happen, so nothing is paid twice.
- Unknown ledger outcome: `Err(GenericError { error_code = 1 })` saying balances were NOT re-credited and an incident was recorded; the DAO resolves it against the ledger memo. Check `get_claim_events_for_hotkey` and the wallet before retrying.
- Two concurrent claims covering the same owners: the loser traps and changes nothing; retry.

## Common pitfalls

- `balances_of_hotkey_neurons(neurons)` is a query that trusts the neurons you pass: fine for display; the claim always asks governance itself. `balances_of_hotkey()` is the certified update version.
- Unfiltered event lists (`get_claim_events`, `get_user_distribution_events`, `get_distribution_events`) return everything ever logged; prefer the per-principal or per-token versions.
- Query methods sent as update calls are refused by the ingress guard; update arguments from outside the IC are capped at 4 KiB.

## Start with these methods

- `get_known_tokens()`, `get_main_loop_status()`, `get_import_stage()`
- `balances_of_hotkey_neurons(neurons)`, `balance_of(owner, ledger)`, `get_hotkey_voting_power(neurons)`
- `claim_full_balance_of_hotkey(ledger, fee)`
- `get_claim_events_for_hotkey(principal)`, `get_hotkey_claimed_amounts(principal)`, `get_user_distributions(owner)`, `get_user_specific_distribution_events(owner)`, `get_event_statistics()`

## Full reference

- https://app.sneeddao.com/api-docs/rll.md
- Candid: https://app.sneeddao.com/api-docs/rll.did
- All Sneed DAO APIs: https://app.sneeddao.com/llms.txt
";
};
