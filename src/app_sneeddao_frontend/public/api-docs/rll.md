# RLL rewards canister API

The RLL canister is where Sneed DAO's Recursive Liquidity Loop pays out. Tokens that reach its main account, the DAO's share of revenue among them, are shared every day among the owners of Sneed DAO neurons, in proportion to the voting power their neurons have cast on Sneed DAO proposals. Owners (or principals added as hotkeys to their neurons) claim their share to their own wallet whenever they like. Every balance, distribution and claim can be read by anyone; claiming is permissionless for anyone who is on a Sneed neuron.

| | |
|---|---|
| Production canister | `lvc4n-7aaaa-aaaam-adm6a-cai` |
| Staging canister | `twapx-riaaa-aaaak-qlojq-cai` (separate state, same code line; use it to test) |
| Candid interface | [rll.did](/api-docs/rll.did) · [JavaScript IDL factory](/api-docs/rll.did.js) |
| Source | [src/sneed_rewards/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_rewards/main.mo) · [Types.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_rewards/Types.mo) (the dfx canister name is `rll`) |
| Reference frontend | [app.sneeddao.com/rewards](https://app.sneeddao.com/rewards) · [/rll](https://app.sneeddao.com/rll) · [/rll_info](https://app.sneeddao.com/rll_info) ([source](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/app_sneeddao_frontend)) |
| This document | [rendered](/api/rll) · [raw Markdown](/api-docs/rll.md) |

The production canister is controlled by Sneed DAO's SNS root; upgrades are decided by Sneed DAO proposals. The method set below matches the source on `main`.

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister (units and encoding, authentication, fees, transfers and irreversible actions, asynchronous flows and polling, common pitfalls) that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 Tokens in, balances out

The canister keeps an internal ledger: for every **owner principal** and every token, a claimable balance (`balance_of(owner, ledger)`). Real tokens all sit in the canister's main account `{ owner = rll; subaccount = null }`. At any time:

```
ledger balance of the main account  =  sum of all claimable balances
                                     + claims awaiting the ledger
                                     + unresolved claim incidents (section 4)
                                     + undistributed
```

Anything **undistributed** is shared out in the next distribution cycle. Anyone can add to it with a plain ICRC-1 transfer to the main account; the DAO's revenue reaches it that way. Only tokens on the canister's list of known tokens (`get_known_tokens()`) are distributed (1.4).

### 1.2 Who earns: voting power cast

The canister imports every Sneed DAO neuron and every proposal (with its ballots) from Sneed SNS governance (`fi3zi-fyaaa-aaaaq-aachq-cai`). For a distribution it adds up, per neuron, the voting power of every ballot the neuron actually cast (`vote != 0`) on proposals 1 up to the highest proposal whose voting has closed. A neuron's share of a distribution is its sum divided by the sum of all neurons, rounded down to a base unit. Voting more, with more voting power, earns more; a neuron that never votes earns nothing.

Shares are credited to the neuron's **owner**: the principal that holds the full set of permissions on the neuron (more than seven permission types; if no principal has that many, the last principal listed). Several neurons of one owner add up. One principal is excluded in code (`umo43-o3yqa-363iw-wroso-jm5az-kmfp2-rdzoj-q7il2-zfhcj-l35r7-oqe`); its neurons neither earn nor count towards the total.

### 1.3 Who claims: anyone on the neuron

`claim_full_balance_of_hotkey(ledger, fee)` pays to the **caller**. The canister asks SNS governance for the neurons the caller has any permission on (owner or hotkey; the first 100), collects the owners of those neurons, and sends the sum of those owners' balances in that token to the caller's main account. So:

- An owner claims their own rewards by calling with their own principal.
- A principal added as a hotkey to a neuron can claim the rewards of that neuron's owner, to itself. This is how the Sneed app lets users claim from whatever login they hotkeyed. Only add hotkeys you trust with the owner's rewards.

### 1.4 Known tokens

Each cycle the canister imports ICPSwap's trusted token list (ICRC tokens only) as its **whitelist** (`get_whitelisted_tokens()`), checks which whitelisted tokens it holds a balance of, and adds those to the **known tokens** (`get_known_tokens()`). Admins can also add a token directly. A token you send that is not on ICPSwap's list is not distributed until an admin adds it.

Per known token a cycle distributes nothing unless the undistributed amount reaches a minimum (by default 10 × the token's ledger fee; `get_token_min_distribution`), and at most a maximum if one is set (`get_token_max_distribution`). The rest waits for later cycles.

### 1.5 Time and amounts

Amounts are base units of each ledger (`nat`). Event timestamps are `int` nanoseconds since the Unix epoch (`DistributionEvent`, `UserDistributionEvent`, `get_main_loop_status`); `ClaimEvent.timestamp` and incident times are `nat64` nanoseconds. Proposal and ballot times come from SNS governance and are in seconds (`*_seconds`).

### 1.6 Calls the canister refuses at ingress

The canister's `inspect_message` refuses query methods called as updates, and update calls from outside the IC whose argument exceeds 4 KiB. Canister-to-canister calls are not affected.

---

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './rll.did.js'; // https://app.sneeddao.com/api-docs/rll.did.js

const RLL = 'lvc4n-7aaaa-aaaam-adm6a-cai';
const SNEED_GOVERNANCE = 'fi3zi-fyaaa-aaaaq-aachq-cai';

export function rllActor(identity) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId: RLL });
}
```

With dfx:

```bash
dfx canister --network ic call lvc4n-7aaaa-aaaam-adm6a-cai get_known_tokens '()' --query
dfx canister --network ic call lvc4n-7aaaa-aaaam-adm6a-cai get_main_loop_status '()' --query
```

### 2.2 Show what a user can claim

The cheap way is a query: fetch the user's neurons from SNS governance yourself and pass them in. The canister groups them by owner and adds up those owners' balances.

```js
// snsGov: an actor for fi3zi-fyaaa-aaaaq-aachq-cai with the SNS governance IDL (e.g. from @dfinity/sns)
async function claimable(identity, snsGov) {
  const { neurons } = await snsGov.list_neurons({
    of_principal: [identity.getPrincipal()], limit: 100, start_page_at: [],
  });
  const rll = rllActor(identity);
  return rll.balances_of_hotkey_neurons(neurons);   // [[ledgerPrincipal, amount], ...]
}
```

`balances_of_hotkey()` (an update call, so it is certified) does the same lookup inside the canister for the caller.

For one owner principal: `balance_of(owner, ledger)`.

### 2.3 Claim

```js
async function claim(identity, ledgerId, ledgerActor) {
  const fee = await ledgerActor.icrc1_fee();                 // must be the ledger's current fee
  const r = await rllActor(identity).claim_full_balance_of_hotkey(Principal.fromText(ledgerId), fee);
  if ('Ok' in r) return r.Ok;                                // ledger block index
  if ('InsufficientFunds' in r.Err) return null;             // nothing above the fee to claim
  throw new Error(JSON.stringify(r.Err));
}
```

The caller receives `total − fee` in `{ owner = caller; subaccount = null }`, where `total` is the sum of the owners' balances in that token. Claims smaller than or equal to the fee are refused, so a few cycles of rewards may be needed before a token can be claimed.

### 2.4 History

```js
const rll = rllActor(identity);
const me = identity.getPrincipal();
const [claims, claimed, received, events] = await Promise.all([
  rll.get_claim_events_for_hotkey(me),                       // every claim attempt by me
  rll.get_hotkey_claimed_amounts(me),                        // [[ledger, total successfully claimed]]
  rll.get_user_distributions(me),                            // [[ledger, total ever credited to me as owner]]
  rll.get_user_specific_distribution_events(me),             // each credit, with the proposal range used
]);
```

---

## 3. Flows in detail

### 3.1 The daily distribution cycle

While the main loop runs (`get_main_loop_status().is_running`), a distribution cycle starts every `frequency_seconds` (86,400, once a day). A cycle moves through these stages (`get_import_stage()` reports where it is):

1. **importing whitelist**: ICPSwap's token list.
2. **checking balances**: which whitelisted tokens the canister holds; those become known tokens.
3. **importing neurons**: all Sneed neurons, in pages of 100.
4. **importing proposals**: from the highest closed proposal already imported onwards, with their ballots.
5. **distributing tokens**: for each known token, in one message: `undistributed = ledger balance − (claimable balances + in-flight claims + unresolved incidents)`; if it reaches the token's minimum, up to its maximum is shared as in 1.2, each owner's balance is increased, and a `DistributionEvent` (total) plus one `UserDistributionEvent` per owner are logged.

Rounding down leaves a little dust; it stays undistributed and joins the next cycle. A cycle interrupted by an upgrade restarts from stage 1; because a token's share is computed and credited in one message, and the undistributed amount is recomputed from the ledger, nothing is paid twice.

### 3.2 Claiming

`claim_full_balance_of_hotkey(ledger, fee)`:

1. Looks up the owners of the caller's neurons (1.3) and their balances in `ledger`, and debits them.
2. If the total is not above `fee`, restores the balances and returns `Err(InsufficientFunds { balance = total })`; nothing is logged.
3. Logs a `Pending` claim event and transfers `total − fee` to the caller with `fee`, memo `rll-claim:<sequence_number>` and a `created_at_time`.
4. On `Ok(block)`: logs `Success` with `tx_index`.
5. On a ledger `Err` (a wrong `fee` gives `BadFee`): logs `Failed`, restores the balances, and returns the ledger's error.
6. If the call to the ledger fails in a way that proves the transfer did not happen: logs `Failed`, restores the balances, returns `Err(GenericError { error_code = 1; message })`.
7. If the outcome is unknown: logs `Failed`, does **not** restore the balances, records a claim incident, and returns `Err(GenericError { error_code = 1; message = "Transfer outcome unknown; balances were NOT re-credited. Incident #<id> recorded for manual reconciliation. Underlying error: …" })`. The DAO checks the ledger for the memo and either closes the incident (the transfer landed) or re-credits the owners exactly.

---

## 4. Concurrency, errors and retries

**Result shapes.** `claim_full_balance_of_hotkey` returns the ICRC-1 `TransferResult` (`Ok : nat` or `Err : TransferError`), with `InsufficientFunds` and `GenericError { error_code = 1 }` also produced by the canister itself (3.2). Admin methods return `Result` (`ok : text` or `err : text`) or trap (`assert`) when the caller is not an admin.

**Retrying a claim.** Retrying is safe: balances are debited before the transfer and restored only when the transfer certainly did not happen, so a second claim can never pay the same balance twice. After an unknown outcome, check `get_claim_events_for_hotkey` and your wallet; if the transfer did not land, the DAO restores the balance when it resolves the incident.

**Concurrent claims.** Two claims covering the same owners at the same moment can collide; the loser is rejected (the call traps and changes nothing). Retry it.

**The balance query is not certified.** `balances_of_hotkey_neurons` trusts the neurons you pass in and is a query. Use it for display; the claim itself always asks governance.

---

## 5. Method reference

Types are in section 6. "Caller" is the principal signing the call. Methods marked *query* can be called without a signature.

### 5.1 Balances and claims

| Method | Kind | Returns | Notes |
|---|---|---|---|
| `balance_of(owner, ledger)` | query | `nat` | Claimable balance of one owner principal. |
| `balances_of_hotkey_neurons(vec Neuron)` | query | `vec (ledger, nat)` | Summed balances of the owners of the given neurons. |
| `balances_of_hotkey()` | update | `vec (ledger, nat)` | Same, for the neurons governance lists for the caller. |
| `claim_full_balance_of_hotkey(ledger, fee)` | update | `TransferResult` | See 3.2. `fee` must be the ledger's fee. |
| `get_hotkey_voting_power(vec Neuron)` | query | record | `neurons_by_owner`, `total_voting_power` (cast by the given neurons on proposals 1..highest closed) and `distribution_voting_power` (cast by all neurons). The ratio is the share of the next distribution, before the exclusion of 1.2. |
| `total_balance(ledger)` | query | `nat` | Sum of all claimable balances in one token. |
| `all_token_balances()` | query | `vec (ledger, nat)` | Same for every token. |
| `get_all_user_balances()` | query | `vec (owner, vec (ledger, nat))` | Every non-zero balance. |
| `balances_count()` | query | `nat` | Number of owners with a balance record. |
| `balance_reconciliation()` | update | `vec record { token_id; local_total; server_balance; remaining; underflow }` | Reads the ledger balance of every known token and compares it with the claimable total (`remaining` = ledger − claimable, `underflow` = shortfall). Open to anyone. |
| `balance_reconciliation_from_balances(vec (ledger, nat))` | query | same | The same comparison with ledger balances you supply. |

### 5.2 Distributions and claim history (queries)

| Method | Returns | Notes |
|---|---|---|
| `get_total_distributions()` | `vec (ledger, nat)` | All-time distributed per token. |
| `get_token_total_distribution(ledger)` | `nat` | One token. |
| `get_user_distributions(owner)` | `vec (ledger, nat)` | All-time credited to an owner. |
| `get_user_token_distribution(owner, ledger)` | `nat` | One token. |
| `get_distribution_events()` | `vec DistributionEvent` | Every distribution. |
| `get_token_distribution_events(ledger)` | `vec DistributionEvent` | Filtered by token. |
| `get_user_distribution_events()` | `vec UserDistributionEvent` | Every per-owner credit (large). |
| `get_user_specific_distribution_events(owner)` | `vec UserDistributionEvent` | One owner. |
| `get_user_token_distribution_events(owner, ledger)` | `vec UserDistributionEvent` | One owner, one token. |
| `get_claim_events()` | `vec ClaimEvent` | Every claim attempt: a `Pending` entry and then `Success` or `Failed` with the same `sequence_number`. |
| `get_claim_events_for_hotkey(principal)` | `vec ClaimEvent` | Claims made by one caller. |
| `get_hotkey_claimed_amounts(principal)` | `vec (ledger, nat)` | Sum of successful claims (net amounts) by one caller. |
| `get_event_statistics()` | record | Distribution and claim totals, all-time and last 24 hours, per token, with unique users. |

The event lists are returned whole. They grow with every cycle; prefer the filtered versions.

### 5.3 Tokens and distribution limits (queries)

| Method | Returns | Notes |
|---|---|---|
| `get_known_tokens()` | `vec (ledger, TokenMetadata)` | Tokens that are distributed. |
| `get_token_metadata(ledger)` | `opt TokenMetadata` | One known token. |
| `get_whitelisted_tokens()` | `vec (ledger, TokenMetadata)` | Imported from ICPSwap's token list. |
| `get_wallet_known_tokens(wallet)` | `vec (ledger, TokenMetadata)` | Tokens found by an admin's wallet scan. |
| `get_token_min_distribution(ledger)`, `get_all_token_min_distributions()` | `opt nat`, `vec (ledger, nat)` | Minimums set by admins; without one, the minimum is 10 × the ledger fee. |
| `get_token_max_distribution(ledger)`, `get_all_token_max_distributions()` | `opt nat`, `vec (ledger, nat)` | Per-cycle maximums set by admins. |

### 5.4 Governance data (queries)

| Method | Returns | Notes |
|---|---|---|
| `get_user_voting_history(principal)` | vec record | Per proposal, the votes of every imported neuron the principal has any permission on, with summed voting power and title. |
| `get_neuron_voting_history(neuron_id : blob)` | vec record | One neuron's ballots. |
| `get_proposal_ballots(proposal_id : nat64)` | `vec (text, Ballot)` | Imported ballots of a proposal, keyed by hex neuron id. |
| `get_highest_closed_proposal_id()` | `nat64` | Upper end of the proposal range distributions use. |
| `acceptsVote(ProposalData, now_seconds)` | `bool` | Whether a proposal's voting deadline is after `now_seconds`. |
| `get_empty_ballot_proposals()` | `{ proposal_ids; total_count }` | Imported proposals without ballots. |
| `get_neuron_statistics()` | record | Counts, stake, dissolve states and delays, voting power, hotkeys across imported neurons. |
| `imported_neurons_count()`, `imported_owners_count()`, `imported_props_count()` | `nat` | Import sizes. |
| `get_imported_proposal_max()`, `get_import_next_neuron_id()` | `nat64`, `opt NeuronId` | Import cursors. |

### 5.5 Status (queries)

| Method | Returns | Notes |
|---|---|---|
| `get_main_loop_status()` | record | `is_running`, `frequency_seconds`, `last_started`, `last_stopped`, `last_cycle_started`, `last_cycle_ended`, `next_scheduled`, `current_time` (ns). |
| `get_import_stage()` | `text` | Current cycle stage in words. |
| `get_neuron_import_status()`, `get_proposal_import_status()` | `Result` | `ok` text saying whether an import is running. |
| `get_token_balance_check_status()`, `get_wallet_token_check_status()` | record | Progress of the balance scans. |
| `list_admins()`, `principal_is_admin(principal)`, `caller_is_admin()` | | Admins are the controllers, Sneed SNS governance and the listed principals. |

### 5.6 Admin methods

Restricted to the canister's controllers, Sneed SNS governance and the principals in `list_admins()`. Integrators never call them.

| Method | Purpose |
|---|---|
| `start_rll_main_loop`, `stop_rll_main_loop` | Turn the daily loop on or off. |
| `start_distribution_cycle`, `stop_distribution_cycle` | Run or abort one cycle now. |
| `import_all_neurons`, `import_all_new_neurons`, `stop_neuron_import` | Manual neuron imports. |
| `import_all_proposals`, `import_all_new_proposals`, `stop_proposal_import` | Manual proposal imports. |
| `import_whitelisted_tokens_from_icpswap` (`import_whitelisted_tokens_from_swaprunner` is the old name) | Import ICPSwap's token list now. |
| `check_whitelisted_token_balances`, `stop_token_balance_check` | Scan whitelisted tokens for balances. |
| `check_wallet_token_balances(wallet)`, `stop_wallet_token_check` | Scan a wallet's tokens. |
| `add_known_token`, `remove_known_token`, `clear_known_tokens`, `clear_whitelisted_tokens` | Token lists. |
| `set_token_min_distribution`, `remove_token_min_distribution`, `set_token_max_distribution`, `remove_token_max_distribution` | Per-token limits (token must be whitelisted). |
| `list_claim_incidents()`, `resolve_claim_incident(id, landed)` | Unknown-outcome claims (3.2): `landed = false` re-credits the owners. |
| `get_error_claim_events()`, `get_unmatched_pending_claims()` | Failed claims; pending claims without an outcome. |
| `add_admin`, `remove_admin` | Admin list (governance cannot be removed). |
| `clear_balances`, `clear_total_distributions`, `clear_user_distributions`, `clear_user_distribution_events`, `clear_distribution_events`, `clear_claim_events`, `clear_all_balances_and_distributions`, `clear_imported_neurons`, `clear_imported_owners`, `clear_imported_props` | Reset tools from the canister's early days. |

---

## 6. Types

```candid
type TxIndex = nat;
type Balance = nat;
type Timestamp = nat64;   // ns
type Account = record { owner : principal; subaccount : opt blob };

type TokenMetadata = record { name : text; symbol : text; decimals : nat8; fee : nat };

type TransferResult = variant { Ok : TxIndex; Err : TransferError };
type TransferError = variant {
  BadFee : record { expected_fee : Balance };
  BadBurn : record { min_burn_amount : Balance };
  InsufficientFunds : record { balance : Balance };
  TooOld;
  CreatedInFuture : record { ledger_time : Timestamp };
  Duplicate : record { duplicate_of : TxIndex };
  TemporarilyUnavailable;
  GenericError : record { error_code : nat; message : text };
};

type DistributionEvent = record {
  token_id : principal;
  amount : nat;                                  // total credited in this distribution
  timestamp : int;                               // ns
  proposal_range : record { first : nat64; last : nat64 };
};
type UserDistributionEvent = record {
  user : principal;                              // the neuron owner credited
  token_id : principal;
  amount : nat;
  timestamp : int;
  proposal_range : record { first : nat64; last : nat64 };
};

type ClaimStatus = variant { Pending; Success; Failed };
type ClaimEvent = record {
  sequence_number : nat;                         // Pending and its outcome share it
  hotkey : principal;                            // the caller who claimed
  token_id : principal;
  amount : nat;                                  // sent, net of fee
  fee : nat;
  timestamp : Timestamp;
  status : ClaimStatus;
  error_message : opt text;
  tx_index : opt nat;
};

type ClaimIncident = record {
  id : nat; sequence_number : nat; token_id : principal; recipient : principal;
  owners : vec record { principal; nat };        // who was debited, how much
  total : nat; amount : nat; fee : nat; memo : blob; created_at_time : Timestamp;
  error_message : text; resolved : bool; landed : opt bool; resolved_at : opt Timestamp;
};

type Result = variant { ok : text; err : text };
```

`Neuron`, `ProposalData` and `Ballot` are the SNS governance types; see [rll.did](/api-docs/rll.did).

---

## 7. Integration checklist

- Show claimable rewards with `balances_of_hotkey_neurons(neurons)` after listing the user's neurons in Sneed SNS governance.
- Claim with `claim_full_balance_of_hotkey(ledger, icrc1_fee())`; skip tokens whose balance is not above the fee.
- Treat `InsufficientFunds` as "nothing to claim yet", not as a failure.
- After a timeout or a `GenericError`, re-read `get_claim_events_for_hotkey` before retrying; retries never pay twice.
- Remember that a hotkey can claim its neuron owner's rewards, and say so to users who add hotkeys.
- To add to the rewards, transfer a known token to `lvc4n-7aaaa-aaaam-adm6a-cai` (main account); it is shared in the next daily cycle.
- Prefer the filtered event queries; the unfiltered ones return every event ever logged.
