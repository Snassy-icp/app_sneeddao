# Sneed stake gate (spec, not started)

A DAO-owned canister that tells any dapp how much a principal has staked in an SNS (or in the NNS), so
the dapp can gate things on stake: content, rooms, items, memberships, roles. The gate only reports
stake; the rules ("at least N staked with at least 6 months dissolve delay") stay with each dapp.

## Who needs it (and who doesn't)
An off-chain service (a game server, a bot) is better off calling SNS governance directly: one
`list_neurons({ of_principal; limit })` query per user per SNS returns the full neurons (stake,
dissolve state, age), and voting power follows from the SNS's `get_nervous_system_parameters`
(cached). Going through the gate would only add a hop. For NNS neurons such a service can simply be
the hotkey itself. The gate is for **on-chain** callers, which can't make cross-subnet queries.

## Why a canister
- Premium and the forum already read SNS stake by hotkey (`list_neurons` with `of_principal`), each in
  its own code. One shared canister gives every dapp the same, cached, without each one paying for and
  maintaining the calls.
- A query can't call SNS governance on another subnet, so a dapp that needs an instant answer needs a
  cache somewhere. The gate is that cache.

## Interface (sketch)
```
type NeuronStake = record {
  id : blob;                      // SNS neuron id (NNS: the nat64 id as 8 bytes)
  stake_e8s : nat;                // cached_neuron_stake_e8s
  voting_power : nat;
  dissolve_delay_seconds : nat64; // 0 when dissolved
  dissolving : bool;
};
type StakeInfo = variant {
  unknown;                                           // never fetched: not the same as 0
  known : record { neurons : vec NeuronStake; fetched_at : nat64 };
};
stake_of  : (principal, opt principal) -> (StakeInfo) query;          // opt sns_root; null = NNS
stakes_of : (vec principal, opt principal) -> (vec StakeInfo) query;  // bounded batch
refresh   : (vec principal, opt principal) -> (vec StakeInfo);        // update: fetch now
```
- **Neuron ids are returned** so a dapp can enforce one neuron per account (otherwise one neuron
  hotkeyed to many principals opens the gate for all of them). The dapp owns its account mapping.
- **Freshness:** `fetched_at` on every answer; a timer re-fetches principals that were asked about
  recently (e.g. within 7 days), oldest first, within a cycles budget.
- **Which SNSes:** any SNS listed by SNS-W (root → governance resolved and cached).

## NNS (ICP) neurons
NNS governance shows a neuron's details only to its controller and hotkeys. A user who wants ICP stake
counted adds the gate canister as a hotkey on the neuron (once, from Sneed Hub's neuron page); the gate
then sees it through `list_neurons` with neurons readable by the caller, and maps it to the neuron's
controller and the controller's other hotkeys. A hotkey can vote and follow, never spend; Sneed Hub
says so plainly before the user adds it. Removing the hotkey removes the stake on the next refresh.

## Rules for dapps (guidance in the API doc)
- Check when used (opening, entering, joining), and re-check memberships periodically.
- Something a user no longer qualifies for stops working; nothing is taken away.
- Treat `unknown` as "ask again later", not as "no stake".

## Costs and abuse
- `refresh` is paid in cycles by the caller canister (or rate-limited per caller), batches capped.
- Ingress guard as in every DAO canister; queries refused as updates.
- No ICRC-3 log needed: it holds no money and no settings beyond admin config (log that, as elsewhere).

## Ownership
Sneed DAO canister (controlled by SNS root), open to every dapp. Listed in spec/pipeline.md.
