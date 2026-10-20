// Candid interfaces of the test doubles written for the reward loop (rll) and
// sneed_premium suites: canisters/MockRllGovernance.mo and
// canisters/MockIcpSwapTokenList.mo.
import { IDL } from '@icp-sdk/core/candid';

const NeuronSpec = IDL.Record({
  id: IDL.Vec(IDL.Nat8), owner: IDL.Opt(IDL.Principal), hotkeys: IDL.Vec(IDL.Principal), hotkeys_first: IDL.Bool,
  stake_e8s: IDL.Nat64, dissolve_delay_seconds: IDL.Nat64, aging_since_timestamp_seconds: IDL.Nat64, multiplier: IDL.Nat64,
});
const Ballot = IDL.Record({ vote: IDL.Int32, cast_timestamp_seconds: IDL.Nat64, voting_power: IDL.Nat64 });
const ProposalSpec = IDL.Record({ id: IDL.Nat64, title: IDL.Text, deadline_seconds: IDL.Nat64, ballots: IDL.Vec(IDL.Tuple(IDL.Text, Ballot)) });
const Parameters = IDL.Record({
  max_dissolve_delay_seconds: IDL.Nat64, max_dissolve_delay_bonus_percentage: IDL.Nat64, neuron_minimum_dissolve_delay_to_vote_seconds: IDL.Nat64,
  max_neuron_age_for_age_bonus: IDL.Nat64, max_age_bonus_percentage: IDL.Nat64,
});

/// mock SNS governance with neurons, proposals and parameters (MockRllGovernance.mo)
export const rllGovernanceIdl = ({ IDL }) => IDL.Service({
  add_neuron: IDL.Func([NeuronSpec], [], []),
  add_filler_neurons: IDL.Func([IDL.Nat, IDL.Principal], [], []),
  clear_neurons: IDL.Func([], [], []),
  neuron_count: IDL.Func([], [IDL.Nat], ['query']),
  set_proposal: IDL.Func([ProposalSpec], [], []),
  clear_proposals: IDL.Func([], [], []),
  set_parameters: IDL.Func([Parameters], [], []),
  // manage_neuron's test side (rll's ICRC-3 archive registration)
  add_hotkey: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Principal], [], []),
  list_proposals: IDL.Func([], [IDL.Vec(IDL.Record({
    id: IDL.Nat64, proposer: IDL.Principal, neuron: IDL.Vec(IDL.Nat8), title: IDL.Text, url: IDL.Text, summary: IDL.Text, canister_ids: IDL.Vec(IDL.Principal),
  }))], ['query']),
});

/// mock ICPSwap token list (MockIcpSwapTokenList.mo)
const ListToken = IDL.Record({ canisterId: IDL.Text, decimals: IDL.Nat, fee: IDL.Nat, name: IDL.Text, symbol: IDL.Text, standard: IDL.Text });
export const icpswapListIdl = ({ IDL }) => IDL.Service({
  getList: IDL.Func([], [IDL.Variant({ ok: IDL.Vec(ListToken), err: IDL.Text })], ['query']),
  set_list: IDL.Func([IDL.Vec(ListToken)], [], []),
  set_fail: IDL.Func([IDL.Bool], [], []),
});

/// a neuron spec with the defaults filled in
export const neuronSpec = ({ id, owner = null, hotkeys = [], hotkeysFirst = false, stake = 0n, dissolve = 0n, agingSince = 0n, multiplier = 100n }) => ({
  id: Uint8Array.from(id), owner: owner ? [owner] : [], hotkeys, hotkeys_first: hotkeysFirst,
  stake_e8s: stake, dissolve_delay_seconds: dissolve, aging_since_timestamp_seconds: agingSince, multiplier,
});
export const hex = (bytes) => Buffer.from(bytes).toString('hex');

/// minimal ledger that can reject transfers (MockRejectLedger.mo)
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
export const rejectLedgerInit = [IDL.Record({ fee: IDL.Nat, symbol: IDL.Text, decimals: IDL.Nat8 })];
export const rejectLedgerIdl = ({ IDL }) => IDL.Service({
  icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ['query']),
  mint: IDL.Func([Account, IDL.Nat], [], []),
  set_mode: IDL.Func([IDL.Variant({ normal: IDL.Null, reject_before: IDL.Null, reject_after: IDL.Null })], [], []),
  get_transactions: IDL.Func([], [IDL.Vec(IDL.Record({ from: Account, to: Account, amount: IDL.Nat, memo: IDL.Opt(IDL.Vec(IDL.Nat8)) }))], ['query']),
});
