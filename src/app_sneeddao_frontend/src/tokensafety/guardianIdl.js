// The custody canisters (sneed_guardian, sneed_hole, sneed_accord: one codebase,
// three deployments, see spec/custody.md) and their Candid interface.
import { IDL } from '@dfinity/candid';

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
export const Kind = IDL.Variant({ ledger: IDL.Null, index: IDL.Null, archive: IDL.Null });
export const Policy = IDL.Record({ guardians: IDL.Vec(IDL.Principal), vetoes_to_block: IDL.Nat, oks_required: IDL.Nat, window_ns: IDL.Nat, auto_upgrade: IDL.Bool });
const Status = IDL.Record({ at: IDL.Int, cycles: IDL.Nat, memory_size: IDL.Nat, module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), controllers: IDL.Vec(IDL.Principal), running: IDL.Text, idle_cycles_burned_per_day: IDL.Nat, freezing_threshold: IDL.Nat, error: IDL.Opt(IDL.Text) });
const Child = IDL.Record({
    canister_id: IDL.Principal, kind: Kind, suite: IDL.Opt(IDL.Principal), title: IDL.Text, policy: Policy, registered_at: IDL.Int, registered_by: IDL.Principal,
    status: IDL.Opt(Status), last_upgrade: IDL.Opt(IDL.Record({ at: IDL.Int, from: IDL.Opt(IDL.Vec(IDL.Nat8)), to: IDL.Vec(IDL.Nat8), by: IDL.Text })), last_upgrade_error: IDL.Opt(IDL.Text),
});
export const ConfigUpdate = IDL.Record({ op_fee_e8s: IDL.Opt(IDL.Nat), premium_op_fee_e8s: IDL.Opt(IDL.Nat), fee_destination: IDL.Opt(Account), op_ttl_ns: IDL.Opt(IDL.Nat), self_window_ns: IDL.Opt(IDL.Nat), status_interval_s: IDL.Opt(IDL.Nat), low_cycles_threshold: IDL.Opt(IDL.Nat), cycle_reserve: IDL.Opt(IDL.Nat), paused: IDL.Opt(IDL.Bool) });
export const OpKind = IDL.Variant({
    set_controllers: IDL.Vec(IDL.Principal),
    install: IDL.Record({ hash: IDL.Vec(IDL.Nat8), arg: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
    set_policy: Policy,
    set_config: ConfigUpdate,
    set_approvers: IDL.Record({ approvers: IDL.Vec(IDL.Principal), threshold: IDL.Nat }),
});
const OpState = IDL.Variant({ pending: IDL.Null, approved: IDL.Int, vetoed: IDL.Null, executed: IDL.Int, failed: IDL.Text, expired: IDL.Null, cancelled: IDL.Null });
const Op = IDL.Record({ id: IDL.Nat, child: IDL.Principal, kind: OpKind, staged_by: IDL.Principal, staged_at: IDL.Int, memo: IDL.Text, fee_paid_e8s: IDL.Nat, approvals: IDL.Vec(IDL.Principal), oks: IDL.Vec(IDL.Principal), vetoes: IDL.Vec(IDL.Principal), state: OpState });
const Config = IDL.Record({
    name: IDL.Text, approvers: IDL.Vec(IDL.Principal), threshold: IDL.Nat, op_fee_e8s: IDL.Nat, premium_op_fee_e8s: IDL.Nat, fee_destination: Account, sneed_premium: IDL.Opt(IDL.Principal),
    icp_ledger: IDL.Principal, sns_wasm: IDL.Principal, op_ttl_ns: IDL.Nat, self_window_ns: IDL.Nat, status_interval_s: IDL.Nat, low_cycles_threshold: IDL.Nat, cycle_reserve: IDL.Nat, paused: IDL.Bool,
    children: IDL.Nat, ops: IDL.Nat, blessed: IDL.Record({ ledger: IDL.Vec(IDL.Vec(IDL.Nat8)), index: IDL.Vec(IDL.Vec(IDL.Nat8)), archive: IDL.Vec(IDL.Vec(IDL.Nat8)) }), blessed_at: IDL.Int, blessed_error: IDL.Opt(IDL.Text), status_last_run: IDL.Int, own_cycles: IDL.Nat,
});
const CyclesRow = IDL.Record({ canister_id: IDL.Principal, title: IDL.Text, kind: Kind, cycles: IDL.Nat, at: IDL.Int, low: IDL.Bool, error: IDL.Opt(IDL.Text) });
const Upgradable = IDL.Record({ canister_id: IDL.Principal, kind: Kind, title: IDL.Text, current: IDL.Opt(IDL.Vec(IDL.Nat8)), next: IDL.Vec(IDL.Nat8), auto_upgrade: IDL.Bool });
const Res = (t) => IDL.Variant({ Ok: t, Err: IDL.Text });

export const guardianIdl = ({ IDL }) => IDL.Service({
    get_config: IDL.Func([], [Config], ['query']),
    get_child: IDL.Func([IDL.Principal], [IDL.Opt(Child)], ['query']),
    list_children: IDL.Func([], [IDL.Vec(Child)], ['query']),
    get_suite: IDL.Func([IDL.Principal], [IDL.Vec(Child)], ['query']),
    get_op: IDL.Func([IDL.Nat], [IDL.Opt(Op)], ['query']),
    list_ops: IDL.Func([IDL.Bool, IDL.Nat], [IDL.Vec(Op)], ['query']),
    list_ops_for: IDL.Func([IDL.Principal], [IDL.Vec(Op)], ['query']),
    get_cycles_report: IDL.Func([IDL.Opt(IDL.Nat)], [IDL.Vec(CyclesRow)], ['query']),
    list_upgradable: IDL.Func([], [IDL.Vec(Upgradable)], ['query']),
    validate_approve_op: IDL.Func([IDL.Nat], [Res(IDL.Text)], ['query']),
    get_text_log: IDL.Func([IDL.Nat], [IDL.Vec(IDL.Text)], ['query']),
    is_approver: IDL.Func([IDL.Principal], [IDL.Bool], ['query']),
    register: IDL.Func([IDL.Principal, Kind, Policy, IDL.Opt(IDL.Principal), IDL.Text], [Res(Child)], []),
    stage_op: IDL.Func([IDL.Principal, OpKind, IDL.Text], [Res(Op)], []),
    approve_op: IDL.Func([IDL.Nat], [Res(Op)], []),
    ok_op: IDL.Func([IDL.Nat], [Res(Op)], []),
    veto_op: IDL.Func([IDL.Nat], [Res(Op)], []),
    execute_op: IDL.Func([IDL.Nat], [Res(Op)], []),
    cancel_op: IDL.Func([IDL.Nat], [Res(Op)], []),
    refresh_status: IDL.Func([IDL.Principal], [Res(Child)], []),
    refresh_blessed: IDL.Func([], [Res(IDL.Nat)], []),
    admin_run_status: IDL.Func([], [Res(IDL.Nat)], []),
    admin_run_auto_upgrade: IDL.Func([], [Res(IDL.Nat)], []),
});

/// The deployments this frontend knows. Ids come from the dfx environment of the
/// build (canister_ids.json), so staging and production each see their own; a
/// deployment that is not deployed on this network is simply absent.
/// `functionId` is the id of the `approve_op` generic nervous system function
/// once the DAO has registered it (null until then: approvals must be proposed by hand).
const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || null;
export const GUARDIANS = [
    { key: 'guardian', id: env('CANISTER_ID_SNEED_GUARDIAN'), name: 'Sneed Guardian', blackholed: false, functionId: null,
      blurb: 'Custody under Sneed DAO. The DAO can also upgrade the guardian itself, so your veto council trusts Sneed DAO not to go around it. Upgradeable, so bugs can be fixed.' },
    { key: 'hole', id: env('CANISTER_ID_SNEED_HOLE'), name: 'Sneed Hole', blackholed: true, functionId: null,
      blurb: 'Blackholed custody with Sneed DAO as the only approver. Nobody, not even the DAO, can change its code: your veto council is final. The code is frozen.' },
    { key: 'accord', id: env('CANISTER_ID_SNEED_ACCORD'), name: 'Sneed Accord', blackholed: true, functionId: null,
      blurb: 'Blackholed custody shared by several DAOs: changes need m-of-n of their governance canisters, plus your veto council.' },
].filter((g) => g.id);
export const guardianById = (id) => GUARDIANS.find((g) => g.id === id) || null;

export const policySummary = (p) => {
    if (!p) return '';
    const g = p.guardians.length; const vb = Number(p.vetoes_to_block); const ok = Number(p.oks_required); const h = Number(p.window_ns) / 3_600_000_000_000;
    const parts = [];
    if (g && vb) parts.push(`${vb}-of-${g} veto council, ${h >= 48 ? `${Math.round(h / 24)} day` : `${Math.round(h)} h`} window`);
    if (g && ok) parts.push(`${ok}-of-${g} go-aheads`);
    if (!parts.length) parts.push(g ? `${g} guardian${g === 1 ? '' : 's'}, no veto` : 'no veto council');
    parts.push(p.auto_upgrade ? 'auto-upgrades to NNS-blessed versions' : 'upgrades by vote only');
    return parts.join(' · ');
};
