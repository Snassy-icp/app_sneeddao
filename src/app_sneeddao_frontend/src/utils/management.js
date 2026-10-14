// The management canister from the browser: canister_status and
// update_settings work for a principal that controls the canister, which is
// how a maintainer adds a custody canister as controller or steps down.
import { Actor, HttpAgent } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';

const HOST = 'https://icp-api.io';

const managementIdl = ({ IDL }) => {
    const settings = IDL.Record({ controllers: IDL.Vec(IDL.Principal), freezing_threshold: IDL.Nat, memory_allocation: IDL.Nat, compute_allocation: IDL.Nat, reserved_cycles_limit: IDL.Nat, log_visibility: IDL.Variant({ controllers: IDL.Null, public: IDL.Null, allowed_viewers: IDL.Vec(IDL.Principal) }), wasm_memory_limit: IDL.Nat, wasm_memory_threshold: IDL.Nat });
    const status = IDL.Record({ status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }), settings, module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), memory_size: IDL.Nat, cycles: IDL.Nat, idle_cycles_burned_per_day: IDL.Nat, reserved_cycles: IDL.Nat, query_stats: IDL.Record({ num_calls_total: IDL.Nat, num_instructions_total: IDL.Nat, request_payload_bytes_total: IDL.Nat, response_payload_bytes_total: IDL.Nat }), memory_metrics: IDL.Opt(IDL.Reserved) });
    const update = IDL.Record({ controllers: IDL.Opt(IDL.Vec(IDL.Principal)), compute_allocation: IDL.Opt(IDL.Nat), memory_allocation: IDL.Opt(IDL.Nat), freezing_threshold: IDL.Opt(IDL.Nat), reserved_cycles_limit: IDL.Opt(IDL.Nat), log_visibility: IDL.Opt(IDL.Variant({ controllers: IDL.Null, public: IDL.Null, allowed_viewers: IDL.Vec(IDL.Principal) })), wasm_memory_limit: IDL.Opt(IDL.Nat), wasm_memory_threshold: IDL.Opt(IDL.Nat) });
    return IDL.Service({
        canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [status], []),
        update_settings: IDL.Func([IDL.Record({ canister_id: IDL.Principal, settings: update, sender_canister_version: IDL.Opt(IDL.Nat64) })], [], []),
    });
};

/// A management-canister actor whose calls are routed to `canisterId`'s subnet.
export function managementFor(identity, canisterId) {
    const target = typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId;
    return Actor.createActor(managementIdl, {
        agent: new HttpAgent({ host: HOST, identity }),
        canisterId: Principal.fromText('aaaaa-aa'),
        callTransform: (method, args, config) => ({ ...config, effectiveCanisterId: target }),
        queryTransform: (method, args, config) => ({ ...config, effectiveCanisterId: target }),
    });
}

/// { controllers: [text], moduleHash: hex|null, cycles, running } or throws (not a controller, or no such canister).
export async function readStatus(identity, canisterId) {
    const m = managementFor(identity, canisterId);
    const s = await m.canister_status({ canister_id: typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId });
    const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return { controllers: s.settings.controllers.map((p) => p.toText()), moduleHash: s.module_hash[0] ? hex(s.module_hash[0]) : null, cycles: s.cycles, running: Object.keys(s.status)[0] };
}

export async function setControllers(identity, canisterId, controllers) {
    const m = managementFor(identity, canisterId);
    await m.update_settings({
        canister_id: typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId,
        settings: { controllers: [controllers.map((c) => (typeof c === 'string' ? Principal.fromText(c) : c))], compute_allocation: [], memory_allocation: [], freezing_threshold: [], reserved_cycles_limit: [], log_visibility: [], wasm_memory_limit: [], wasm_memory_threshold: [] },
        sender_canister_version: [],
    });
}

/// `(opt variant { Upgrade = opt record { index_principal = opt principal } })`: the ICRC ledger upgrade
/// argument that announces an index through ICRC-106 and changes nothing else.
export function ledgerIndexUpgradeArg(indexId) {
    const UpgradeArgs = IDL.Record({ index_principal: IDL.Opt(IDL.Principal) });
    const LedgerArg = IDL.Variant({ Upgrade: IDL.Opt(UpgradeArgs) });
    return new Uint8Array(IDL.encode([IDL.Opt(LedgerArg)], [[{ Upgrade: [{ index_principal: [typeof indexId === 'string' ? Principal.fromText(indexId) : indexId] }] }]]));
}
