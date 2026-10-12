// Hand-written Candid interfaces of the test-only canisters (the real
// sneed_lock interface comes from the dfx build in build/sneed_lock.did.js).
import { IDL } from '@icp-sdk/core/candid';
import { Value, icrc3Service } from './icrc3.js';

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const TransferError = IDL.Variant({
  BadFee: IDL.Record({ expected_fee: IDL.Nat }), BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
  InsufficientFunds: IDL.Record({ balance: IDL.Nat }), TooOld: IDL.Null, CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
  Duplicate: IDL.Record({ duplicate_of: IDL.Nat }), TemporarilyUnavailable: IDL.Null,
  GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
});
const TransferArgs = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), to: Account, amount: IDL.Nat, fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64),
});

export const ledgerInit = [IDL.Record({ fee: IDL.Nat, symbol: IDL.Text, decimals: IDL.Nat8 })];
export const ledgerIdl = ({ IDL }) => IDL.Service({
  icrc1_fee: IDL.Func([], [IDL.Nat], ['query']),
  icrc1_symbol: IDL.Func([], [IDL.Text], ['query']),
  icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ['query']),
  icrc1_transfer: IDL.Func([TransferArgs], [IDL.Variant({ Ok: IDL.Nat, Err: TransferError })], []),
  mint: IDL.Func([Account, IDL.Nat], [IDL.Nat], []),
  set_fee: IDL.Func([IDL.Nat], [], []),
  set_paused: IDL.Func([IDL.Bool], [], []),
  get_transactions: IDL.Func([], [IDL.Vec(IDL.Record({ index: IDL.Nat, from: Account, to: Account, amount: IDL.Nat, fee: IDL.Nat }))], ['query']),
});

const PoolError = IDL.Variant({ CommonError: IDL.Null, InternalError: IDL.Text, UnsupportedToken: IDL.Text, InsufficientFunds: IDL.Null });
export const poolInit = [IDL.Record({ token0: IDL.Principal, token1: IDL.Principal, fee: IDL.Nat })];
export const poolIdl = ({ IDL }) => IDL.Service({
  metadata: IDL.Func([], [IDL.Variant({ ok: IDL.Record({ token0: IDL.Record({ address: IDL.Text, standard: IDL.Text }), token1: IDL.Record({ address: IDL.Text, standard: IDL.Text }), fee: IDL.Nat }), err: PoolError })], ['query']),
  getUserPositionIdsByPrincipal: IDL.Func([IDL.Principal], [IDL.Variant({ ok: IDL.Vec(IDL.Nat), err: PoolError })], ['query']),
  getUserPosition: IDL.Func([IDL.Nat], [IDL.Variant({ ok: IDL.Record({ tokensOwed0: IDL.Nat, tokensOwed1: IDL.Nat, liquidity: IDL.Nat }), err: PoolError })], ['query']),
  transferPosition: IDL.Func([IDL.Principal, IDL.Principal, IDL.Nat], [IDL.Variant({ ok: IDL.Bool, err: PoolError })], []),
  getUserUnusedBalance: IDL.Func([IDL.Principal], [IDL.Variant({ ok: IDL.Record({ balance0: IDL.Nat, balance1: IDL.Nat }), err: PoolError })], ['query']),
  mint_position: IDL.Func([IDL.Principal, IDL.Nat, IDL.Nat], [], []),
  set_tokens_owed: IDL.Func([IDL.Nat, IDL.Nat, IDL.Nat], [], []),
  set_use_percent: IDL.Func([IDL.Nat], [], []),
  set_fail_increase: IDL.Func([IDL.Bool], [], []),
  position_owner: IDL.Func([IDL.Nat], [IDL.Opt(IDL.Principal)], ['query']),
  position_liquidity: IDL.Func([IDL.Nat], [IDL.Opt(IDL.Nat)], ['query']),
});

export const demoInit = [IDL.Record({ extra_controller: IDL.Principal, cycle_reserve: IDL.Nat, timer_seconds: IDL.Nat, governance: IDL.Principal })];

// mock SNS governance (test/canisters/canisters/MockSnsGovernance.mo)
export const governanceIdl = ({ IDL }) => IDL.Service({
  add_hotkey: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Principal], [], []),
  clear_hotkeys: IDL.Func([], [], []),
  set_mode: IDL.Func([IDL.Variant({ normal: IDL.Null, unknown_reply: IDL.Null, no_id: IDL.Null, trap: IDL.Null })], [], []),
  list_proposals: IDL.Func([], [IDL.Vec(IDL.Record({
    id: IDL.Nat64, proposer: IDL.Principal, neuron: IDL.Vec(IDL.Nat8), title: IDL.Text, url: IDL.Text, summary: IDL.Text, canister_ids: IDL.Vec(IDL.Principal),
  }))], ['query']),
});
export const demoIdl = ({ IDL }) => IDL.Service({
  ...icrc3Service(IDL),
  record: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Text, Value))], [IDL.Nat], []),
  record_many: IDL.Func([IDL.Nat], [IDL.Nat], []),
  logs: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Nat, IDL.Text))], ['query']),
  whoami: IDL.Func([], [IDL.Principal], ['query']),
});
