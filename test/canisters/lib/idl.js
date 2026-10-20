// Hand-written Candid interfaces of the test-only canisters (the real
// sneed_lock interface comes from the dfx build in build/sneed_lock.did.js).
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
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
  icrc2_approve: IDL.Func([IDL.Record({ from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), spender: Account, amount: IDL.Nat, expected_allowance: IDL.Opt(IDL.Nat), expires_at: IDL.Opt(IDL.Nat64), fee: IDL.Opt(IDL.Nat), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) })], [IDL.Variant({ Ok: IDL.Nat, Err: TransferError })], []),
  icrc2_allowance: IDL.Func([IDL.Record({ account: Account, spender: Account })], [IDL.Record({ allowance: IDL.Nat, expires_at: IDL.Opt(IDL.Nat64) })], ['query']),
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

// ---- sneed_pad and its mocks ----
export const cmcIdl = ({ IDL }) => IDL.Service({
  get_icp_xdr_conversion_rate: IDL.Func([], [IDL.Record({ data: IDL.Record({ xdr_permyriad_per_icp: IDL.Nat64, timestamp_seconds: IDL.Nat64 }), hash_tree: IDL.Vec(IDL.Nat8), certificate: IDL.Vec(IDL.Nat8) })], ['query']),
  set_rate: IDL.Func([IDL.Nat64], [], []),
  set_mode: IDL.Func([IDL.Variant({ ok: IDL.Null, refund: IDL.Null })], [], []),
  get_notifications: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Nat64, IDL.Principal))], ['query']),
});
export const snsWasmIdl = ({ IDL }) => IDL.Service({
  set_wasm: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8)], [], []),
  set_steps: IDL.Func([IDL.Vec(IDL.Record({ ledger: IDL.Vec(IDL.Nat8), index: IDL.Vec(IDL.Nat8), archive: IDL.Vec(IDL.Nat8) }))], [], []),
  set_latest: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text))], [], []),
  set_deployed: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
});
export const sneedAppIdl = ({ IDL }) => IDL.Service({
  set_authorized: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  get_entries: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal, IDL.Text))], ['query']),
});
export const premiumIdl = ({ IDL }) => IDL.Service({
  set_member: IDL.Func([IDL.Principal, IDL.Int], [], []),
});
const MintingPolicy = IDL.Variant({ nobody: IDL.Null, sneed_dao: IDL.Null, principal: IDL.Principal });
const GuardianPolicy = IDL.Record({ guardians: IDL.Vec(IDL.Principal), vetoes_to_block: IDL.Nat, oks_required: IDL.Nat, window_ns: IDL.Nat, auto_upgrade: IDL.Bool });
const ControlChoice = IDL.Variant({ keep: IDL.Null, keep_with: IDL.Vec(IDL.Principal), blackhole: IDL.Null, sneed_dao: IDL.Null, sns: IDL.Principal, guardian: IDL.Record({ canister: IDL.Principal, policy: GuardianPolicy }) });
export const TokenConfig = IDL.Record({
  name: IDL.Text, symbol: IDL.Text, decimals: IDL.Nat8, transfer_fee: IDL.Nat, logo: IDL.Opt(IDL.Text),
  allocations: IDL.Vec(IDL.Record({ account: Account, amount: IDL.Nat })),
  minting: MintingPolicy, fee_collector: IDL.Opt(Account), control: ControlChoice, with_index: IDL.Bool,
});
const Quote = IDL.Record({ creation_fee_e8s: IDL.Nat, control_fee_e8s: IDL.Nat, ledger_cycles: IDL.Nat, index_cycles: IDL.Nat, icp_for_cycles_e8s: IDL.Nat, ledger_fees_e8s: IDL.Nat, total_e8s: IDL.Nat, xdr_permyriad_per_icp: IDL.Nat64, premium: IDL.Bool });
const IndexConfig = IDL.Record({ ledger: IDL.Principal, control: ControlChoice });
const IndexLaunch = IDL.Record({ id: IDL.Nat, creator: IDL.Principal, created_at: IDL.Int, config: IndexConfig, quote: Quote, paid_e8s: IDL.Nat, index: IDL.Opt(IDL.Principal), index_wasm_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), controllers: IDL.Vec(IDL.Principal), status: IDL.Variant({ created: IDL.Null, failed: IDL.Text }), steps: IDL.Vec(IDL.Tuple(IDL.Text, IDL.Int)) });
const Launch = IDL.Record({
  id: IDL.Nat, creator: IDL.Principal, created_at: IDL.Int, config: TokenConfig, quote: Quote, paid_e8s: IDL.Nat,
  ledger: IDL.Opt(IDL.Principal), index: IDL.Opt(IDL.Principal), ledger_wasm_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), index_wasm_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
  controllers: IDL.Vec(IDL.Principal), registration_proposal: IDL.Opt(IDL.Nat64), status: IDL.Variant({ created: IDL.Null, failed: IDL.Text }), steps: IDL.Vec(IDL.Tuple(IDL.Text, IDL.Int)),
});
const PadConfig = IDL.Record({
  ledger_wasm_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), index_wasm_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), ledger_wasm_bytes: IDL.Nat, index_wasm_bytes: IDL.Nat,
  creation_fee_e8s: IDL.Nat, premium_creation_fee_e8s: IDL.Nat, sneed_dao_control_fee_e8s: IDL.Nat, index_creation_fee_e8s: IDL.Nat, premium_index_creation_fee_e8s: IDL.Nat, sneed_premium: IDL.Opt(IDL.Principal), ledger_cycles: IDL.Nat, index_cycles: IDL.Nat, fee_destination: Account, cycle_reserve: IDL.Nat, paused: IDL.Bool,
  follow_nns: IDL.Bool, guardians: IDL.Vec(IDL.Principal), wasm_last_check: IDL.Int, wasm_last_refresh: IDL.Int, wasm_last_error: IDL.Opt(IDL.Text),
});
const Registration = IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, proposal_id: IDL.Opt(IDL.Nat64), attempts: IDL.Nat, last_error: IDL.Opt(IDL.Text) });
const RegistrationStatus = IDL.Record({ governance: IDL.Principal, neuron: IDL.Opt(IDL.Vec(IDL.Nat8)), registrations: IDL.Vec(Registration) });
export const padIdl = ({ IDL }) => IDL.Service({
  ...icrc3Service(IDL),
  get_index_quote: IDL.Func([IndexConfig], [IDL.Variant({ Ok: Quote, Err: IDL.Text })], []),
  create_index: IDL.Func([IndexConfig], [IDL.Variant({ Ok: IndexLaunch, Err: IDL.Text })], []),
  list_index_launches: IDL.Func([IDL.Nat, IDL.Nat], [IDL.Record({ total: IDL.Nat, launches: IDL.Vec(IndexLaunch) })], ['query']),
  get_index_launches_by_creator: IDL.Func([IDL.Principal], [IDL.Vec(IndexLaunch)], ['query']),
  get_indexes_of_ledger: IDL.Func([IDL.Principal], [IDL.Vec(IDL.Principal)], ['query']),
  get_quote: IDL.Func([TokenConfig], [IDL.Variant({ Ok: Quote, Err: IDL.Text })], []),
  create_token: IDL.Func([TokenConfig], [IDL.Variant({ Ok: Launch, Err: IDL.Text })], []),
  get_launch: IDL.Func([IDL.Nat], [IDL.Opt(Launch)], ['query']),
  list_launches: IDL.Func([IDL.Nat, IDL.Nat], [IDL.Record({ total: IDL.Nat, launches: IDL.Vec(Launch) })], ['query']),
  get_launches_by_creator: IDL.Func([IDL.Principal], [IDL.Vec(Launch)], ['query']),
  get_launch_by_ledger: IDL.Func([IDL.Principal], [IDL.Opt(Launch)], ['query']),
  get_config: IDL.Func([], [PadConfig], ['query']),
  get_cycle_balance: IDL.Func([], [IDL.Nat], ['query']),
  get_text_log: IDL.Func([IDL.Nat], [IDL.Vec(IDL.Text)], ['query']),
  get_ledger_registration_status: IDL.Func([], [RegistrationStatus], ['query']),
  admin_set_wasm_hashes: IDL.Func([IDL.Opt(IDL.Vec(IDL.Nat8)), IDL.Opt(IDL.Vec(IDL.Nat8))], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  admin_fetch_wasms: IDL.Func([], [IDL.Variant({ Ok: IDL.Record({ ledger_bytes: IDL.Nat, index_bytes: IDL.Nat }), Err: IDL.Text })], []),
  refresh_wasms: IDL.Func([], [IDL.Variant({ Ok: IDL.Record({ ledger_bytes: IDL.Nat, index_bytes: IDL.Nat, changed: IDL.Bool }), Err: IDL.Text })], []),
  admin_set_config: IDL.Func([IDL.Record({ creation_fee_e8s: IDL.Opt(IDL.Nat), premium_creation_fee_e8s: IDL.Opt(IDL.Nat), sneed_dao_control_fee_e8s: IDL.Opt(IDL.Nat), index_creation_fee_e8s: IDL.Opt(IDL.Nat), premium_index_creation_fee_e8s: IDL.Opt(IDL.Nat), ledger_cycles: IDL.Opt(IDL.Nat), index_cycles: IDL.Opt(IDL.Nat), fee_destination: IDL.Opt(Account), cycle_reserve: IDL.Opt(IDL.Nat), paused: IDL.Opt(IDL.Bool), follow_nns: IDL.Opt(IDL.Bool), guardians: IDL.Opt(IDL.Vec(IDL.Principal)) })], [IDL.Variant({ Ok: PadConfig, Err: IDL.Text })], []),
  admin_set_canisters: IDL.Func([IDL.Record({ icp_ledger: IDL.Opt(IDL.Principal), cmc: IDL.Opt(IDL.Principal), sns_wasm: IDL.Opt(IDL.Principal), governance: IDL.Opt(IDL.Principal), root: IDL.Opt(IDL.Principal), blackhole: IDL.Opt(IDL.Principal), sneed_premium: IDL.Opt(IDL.Opt(IDL.Principal)), sneedapp: IDL.Opt(IDL.Opt(IDL.Principal)) })], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  admin_set_canister_controllers: IDL.Func([IDL.Principal, IDL.Vec(IDL.Principal)], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  admin_set_registration_neuron: IDL.Func([IDL.Opt(IDL.Vec(IDL.Nat8))], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  admin_withdraw_icp: IDL.Func([Account, IDL.Nat], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
});
// The ledgers the pad mints: just what the tests read back.
export const mintedLedgerIdl = ({ IDL }) => IDL.Service({
  icrc1_name: IDL.Func([], [IDL.Text], ['query']),
  icrc1_symbol: IDL.Func([], [IDL.Text], ['query']),
  icrc1_decimals: IDL.Func([], [IDL.Nat8], ['query']),
  icrc1_fee: IDL.Func([], [IDL.Nat], ['query']),
  icrc1_total_supply: IDL.Func([], [IDL.Nat], ['query']),
  icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ['query']),
  icrc1_minting_account: IDL.Func([], [IDL.Opt(Account)], ['query']),
  icrc106_get_index_principal: IDL.Func([], [IDL.Variant({ Ok: IDL.Principal, Err: IDL.Reserved })], ['query']),
  icrc1_metadata: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) })))], ['query']),
  icrc1_supported_standards: IDL.Func([], [IDL.Vec(IDL.Record({ name: IDL.Text, url: IDL.Text }))], ['query']),
});
export const mintedIndexIdl = ({ IDL }) => IDL.Service({
  ledger_id: IDL.Func([], [IDL.Principal], ['query']),
  status: IDL.Func([], [IDL.Record({ num_blocks_synced: IDL.Nat })], ['query']),
});

// ---- ICRC-7 demo collection ----
export const icrc7Idl = ({ IDL }) => {
  const Value = IDL.Rec();
  Value.fill(IDL.Variant({ Blob: IDL.Vec(IDL.Nat8), Text: IDL.Text, Nat: IDL.Nat, Int: IDL.Int, Array: IDL.Vec(Value), Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)) }));
  const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  const TransferError = IDL.Variant({ NonExistingTokenId: IDL.Null, InvalidRecipient: IDL.Null, Unauthorized: IDL.Null, TooOld: IDL.Null, CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }), Duplicate: IDL.Record({ duplicate_of: IDL.Nat }), GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }), GenericBatchError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }) });
  const ApprovalInfo = IDL.Record({ spender: Account, from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), expires_at: IDL.Opt(IDL.Nat64), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Nat64 });
  return IDL.Service({
    icrc7_name: IDL.Func([], [IDL.Text], ['query']), icrc7_symbol: IDL.Func([], [IDL.Text], ['query']), icrc7_total_supply: IDL.Func([], [IDL.Nat], ['query']),
    icrc7_collection_metadata: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, Value))], ['query']),
    icrc7_max_take_value: IDL.Func([], [IDL.Opt(IDL.Nat)], ['query']),
    icrc7_token_metadata: IDL.Func([IDL.Vec(IDL.Nat)], [IDL.Vec(IDL.Opt(IDL.Vec(IDL.Tuple(IDL.Text, Value))))], ['query']),
    icrc7_owner_of: IDL.Func([IDL.Vec(IDL.Nat)], [IDL.Vec(IDL.Opt(Account))], ['query']),
    icrc7_balance_of: IDL.Func([IDL.Vec(Account)], [IDL.Vec(IDL.Nat)], ['query']),
    icrc7_tokens: IDL.Func([IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat)], [IDL.Vec(IDL.Nat)], ['query']),
    icrc7_tokens_of: IDL.Func([Account, IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat)], [IDL.Vec(IDL.Nat)], ['query']),
    icrc7_transfer: IDL.Func([IDL.Vec(IDL.Record({ from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), to: Account, token_id: IDL.Nat, memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) }))], [IDL.Vec(IDL.Opt(IDL.Variant({ Ok: IDL.Nat, Err: TransferError })))], []),
    icrc10_supported_standards: IDL.Func([], [IDL.Vec(IDL.Record({ name: IDL.Text, url: IDL.Text }))], ['query']),
    mint: IDL.Func([Account, IDL.Vec(IDL.Tuple(IDL.Text, Value))], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
    // ICRC-37
    icrc37_approve_tokens: IDL.Func([IDL.Vec(IDL.Record({ token_id: IDL.Nat, approval_info: ApprovalInfo }))], [IDL.Vec(IDL.Opt(IDL.Variant({ Ok: IDL.Nat, Err: IDL.Variant({ InvalidSpender: IDL.Null, Unauthorized: IDL.Null, NonExistingTokenId: IDL.Null, TooOld: IDL.Null, CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }), GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }), GenericBatchError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }) }) })))], []),
    icrc37_approve_collection: IDL.Func([IDL.Vec(IDL.Record({ approval_info: ApprovalInfo }))], [IDL.Vec(IDL.Opt(IDL.Variant({ Ok: IDL.Nat, Err: IDL.Variant({ InvalidSpender: IDL.Null, TooOld: IDL.Null, CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }), GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }), GenericBatchError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }) }) })))], []),
    icrc37_revoke_token_approvals: IDL.Func([IDL.Vec(IDL.Record({ spender: IDL.Opt(Account), from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), token_id: IDL.Nat, memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) }))], [IDL.Vec(IDL.Opt(IDL.Variant({ Ok: IDL.Nat, Err: IDL.Variant({ ApprovalDoesNotExist: IDL.Null, TooOld: IDL.Null, CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }), NonExistingTokenId: IDL.Null, Unauthorized: IDL.Null, GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }), GenericBatchError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }) }) })))], []),
    icrc37_revoke_collection_approvals: IDL.Func([IDL.Vec(IDL.Record({ spender: IDL.Opt(Account), from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) }))], [IDL.Vec(IDL.Opt(IDL.Variant({ Ok: IDL.Nat, Err: IDL.Variant({ ApprovalDoesNotExist: IDL.Null, TooOld: IDL.Null, CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }), GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }), GenericBatchError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }) }) })))], []),
    icrc37_is_approved: IDL.Func([IDL.Vec(IDL.Record({ spender: Account, from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), token_id: IDL.Nat }))], [IDL.Vec(IDL.Bool)], ['query']),
    icrc37_get_token_approvals: IDL.Func([IDL.Vec(IDL.Nat), IDL.Opt(IDL.Record({ token_id: IDL.Nat, approval_info: ApprovalInfo })), IDL.Opt(IDL.Nat)], [IDL.Vec(IDL.Record({ token_id: IDL.Nat, approval_info: ApprovalInfo }))], ['query']),
    icrc37_get_collection_approvals: IDL.Func([Account, IDL.Opt(ApprovalInfo), IDL.Opt(IDL.Nat)], [IDL.Vec(ApprovalInfo)], ['query']),
    icrc37_transfer_from: IDL.Func([IDL.Vec(IDL.Record({ spender_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), from: Account, to: Account, token_id: IDL.Nat, memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) }))], [IDL.Vec(IDL.Opt(IDL.Variant({ Ok: IDL.Nat, Err: IDL.Variant({ InvalidRecipient: IDL.Null, Unauthorized: IDL.Null, NonExistingTokenId: IDL.Null, TooOld: IDL.Null, CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }), Duplicate: IDL.Record({ duplicate_of: IDL.Nat }), GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }), GenericBatchError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }) }) })))], []),
  });
};
export const icrc7Init = [IDL.Record({ name: IDL.Text, symbol: IDL.Text, description: IDL.Opt(IDL.Text), logo: IDL.Opt(IDL.Text) })];

// ---- EXT collection (canisters/MockExt.mo) and EXT identifiers, computed independently of the
// canister code under test (node's sha224 and crc32) ----
export const extIdl = ({ IDL }) => {
  const CommonError = IDL.Variant({ InvalidToken: IDL.Text, Other: IDL.Text });
  const Metadata = IDL.Variant({
    fungible: IDL.Record({ name: IDL.Text, symbol: IDL.Text, decimals: IDL.Nat8, metadata: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
    nonfungible: IDL.Record({ metadata: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
  });
  const User = IDL.Variant({ address: IDL.Text, principal: IDL.Principal });
  return IDL.Service({
    mint: IDL.Func([IDL.Text, IDL.Opt(IDL.Vec(IDL.Nat8))], [IDL.Nat32], []),
    set_bearer: IDL.Func([IDL.Nat32, IDL.Text], [], []),
    set_failing: IDL.Func([IDL.Bool], [], []),
    set_transfer_failing: IDL.Func([IDL.Bool], [], []),
    transfer_count: IDL.Func([], [IDL.Nat], ['query']),
    transfer: IDL.Func([IDL.Record({
      from: User, to: User, token: IDL.Text, amount: IDL.Nat, memo: IDL.Vec(IDL.Nat8), notify: IDL.Bool, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    })], [IDL.Variant({ ok: IDL.Nat, err: IDL.Variant({ Unauthorized: IDL.Text, InsufficientBalance: IDL.Null, Rejected: IDL.Null, InvalidToken: IDL.Text, CannotNotify: IDL.Text, Other: IDL.Text }) })], []),
    extensions: IDL.Func([], [IDL.Vec(IDL.Text)], ['query']),
    bearer: IDL.Func([IDL.Text], [IDL.Variant({ ok: IDL.Text, err: CommonError })], ['query']),
    tokens: IDL.Func([IDL.Text], [IDL.Variant({ ok: IDL.Vec(IDL.Nat32), err: CommonError })], ['query']),
    metadata: IDL.Func([IDL.Text], [IDL.Variant({ ok: Metadata, err: CommonError })], ['query']),
    getRegistry: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Nat32, IDL.Text))], ['query']),
  });
};
/// The account identifier (hex) of a principal's default account, or of a 32-byte subaccount.
export function extAccountId(principal, subaccount = null) {
  const sub = subaccount ? Buffer.from(subaccount) : Buffer.alloc(32);
  const digest = createHash('sha224').update(Buffer.concat([Buffer.from([0x0a]), Buffer.from('account-id'), Buffer.from(principal.toUint8Array()), sub])).digest();
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(digest));
  return Buffer.concat([crc, digest]).toString('hex');
}
/// The TokenIdentifier of token `index` in collection `canister`.
export function extTokenIdentifier(canister, index) {
  const i = Buffer.alloc(4); i.writeUInt32BE(Number(index));
  return Principal.fromUint8Array(Uint8Array.from(Buffer.concat([Buffer.from([0x0a, 0x74, 0x69, 0x64]), Buffer.from(canister.toUint8Array()), i]))).toText();
}
