// Candid interface of sneed_pad used by the wizard (hand-written until the
// canister is deployed and its declarations are generated).
import { IDL } from '@dfinity/candid';

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const MintingPolicy = IDL.Variant({ nobody: IDL.Null, sneed_dao: IDL.Null, principal: IDL.Principal });
const ControlChoice = IDL.Variant({ keep: IDL.Null, blackhole: IDL.Null, sneed_dao: IDL.Null });
export const TokenConfig = IDL.Record({
    name: IDL.Text, symbol: IDL.Text, decimals: IDL.Nat8, transfer_fee: IDL.Nat, logo: IDL.Opt(IDL.Text),
    allocations: IDL.Vec(IDL.Record({ account: Account, amount: IDL.Nat })),
    minting: MintingPolicy, fee_collector: IDL.Opt(Account), control: ControlChoice, with_index: IDL.Bool,
});
const Quote = IDL.Record({ creation_fee_e8s: IDL.Nat, control_fee_e8s: IDL.Nat, ledger_cycles: IDL.Nat, index_cycles: IDL.Nat, icp_for_cycles_e8s: IDL.Nat, ledger_fees_e8s: IDL.Nat, total_e8s: IDL.Nat, xdr_permyriad_per_icp: IDL.Nat64, premium: IDL.Bool });
const Launch = IDL.Record({
    id: IDL.Nat, creator: IDL.Principal, created_at: IDL.Int, config: TokenConfig, quote: Quote, paid_e8s: IDL.Nat,
    ledger: IDL.Opt(IDL.Principal), index: IDL.Opt(IDL.Principal), ledger_wasm_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), index_wasm_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
    controllers: IDL.Vec(IDL.Principal), registration_proposal: IDL.Opt(IDL.Nat64), status: IDL.Variant({ created: IDL.Null, failed: IDL.Text }), steps: IDL.Vec(IDL.Tuple(IDL.Text, IDL.Int)),
});
const PadConfig = IDL.Record({
    ledger_wasm_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), index_wasm_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), ledger_wasm_bytes: IDL.Nat, index_wasm_bytes: IDL.Nat,
    creation_fee_e8s: IDL.Nat, premium_creation_fee_e8s: IDL.Nat, sneed_dao_control_fee_e8s: IDL.Nat, sneed_premium: IDL.Opt(IDL.Principal), ledger_cycles: IDL.Nat, index_cycles: IDL.Nat, fee_destination: Account, cycle_reserve: IDL.Nat, paused: IDL.Bool,
    follow_nns: IDL.Bool, wasm_last_check: IDL.Int, wasm_last_refresh: IDL.Int, wasm_last_error: IDL.Opt(IDL.Text),
});
export const padIdl = ({ IDL }) => IDL.Service({
    get_quote: IDL.Func([TokenConfig], [IDL.Variant({ Ok: Quote, Err: IDL.Text })], []),
    create_token: IDL.Func([TokenConfig], [IDL.Variant({ Ok: Launch, Err: IDL.Text })], []),
    get_launch: IDL.Func([IDL.Nat], [IDL.Opt(Launch)], ['query']),
    list_launches: IDL.Func([IDL.Nat, IDL.Nat], [IDL.Record({ total: IDL.Nat, launches: IDL.Vec(Launch) })], ['query']),
    get_launches_by_creator: IDL.Func([IDL.Principal], [IDL.Vec(Launch)], ['query']),
    get_launch_by_ledger: IDL.Func([IDL.Principal], [IDL.Opt(Launch)], ['query']),
    get_config: IDL.Func([], [PadConfig], ['query']),
    get_cycle_balance: IDL.Func([], [IDL.Nat], ['query']),
    refresh_wasms: IDL.Func([], [IDL.Variant({ Ok: IDL.Record({ ledger_bytes: IDL.Nat, index_bytes: IDL.Nat, changed: IDL.Bool }), Err: IDL.Text })], []),
    get_text_log: IDL.Func([IDL.Nat], [IDL.Vec(IDL.Text)], ['query']),
    get_admins: IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    admin_set_config: IDL.Func([IDL.Record({ creation_fee_e8s: IDL.Opt(IDL.Nat), premium_creation_fee_e8s: IDL.Opt(IDL.Nat), sneed_dao_control_fee_e8s: IDL.Opt(IDL.Nat), ledger_cycles: IDL.Opt(IDL.Nat), index_cycles: IDL.Opt(IDL.Nat), fee_destination: IDL.Opt(Account), cycle_reserve: IDL.Opt(IDL.Nat), paused: IDL.Opt(IDL.Bool), follow_nns: IDL.Opt(IDL.Bool) })], [IDL.Variant({ Ok: PadConfig, Err: IDL.Text })], []),
    admin_set_canister_controllers: IDL.Func([IDL.Principal, IDL.Vec(IDL.Principal)], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
    admin_set_registration_neuron: IDL.Func([IDL.Opt(IDL.Vec(IDL.Nat8))], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
    admin_withdraw_icp: IDL.Func([Account, IDL.Nat], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
    admin_add_admin: IDL.Func([IDL.Principal], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
    admin_remove_admin: IDL.Func([IDL.Principal], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
});
export const PAD_CANISTER_ID = process.env.CANISTER_ID_SNEED_PAD || null;
