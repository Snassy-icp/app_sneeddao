// One anonymous agent for every health check, plus the small Candid
// interfaces the checks need that no generated declaration covers.
import { Actor, HttpAgent } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';

export const HOST = 'https://icp-api.io';

// One agent per canister. agent-js keeps a single certificate-time watermark
// per agent, so an agent shared across subnets rejects answers from a subnet
// whose certified time lags behind the newest one seen ("Timestamp failed to
// pass the watermark"). Separate agents keep each canister's clock to itself.
const agents = new Map();
export const getAgent = (canisterId) => {
    const key = String(canisterId);
    if (!agents.has(key)) agents.set(key, HttpAgent.createSync({ host: HOST }));
    return agents.get(key);
};

export async function actor(idlFactory, canisterId) {
    const id = typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId;
    return Actor.createActor(idlFactory, { agent: getAgent(id.toText()), canisterId: id });
}

/// Reject after `ms` so a hanging canister cannot stall the whole run.
export function withTimeout(promise, ms, what = 'call') {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---- minimal interfaces ----

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });

export const ledgerIdl = ({ IDL }) => IDL.Service({
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ['query']),
    icrc1_total_supply: IDL.Func([], [IDL.Nat], ['query']),
    icrc1_decimals: IDL.Func([], [IDL.Nat8], ['query']),
    icrc1_symbol: IDL.Func([], [IDL.Text], ['query']),
    icrc3_get_blocks: IDL.Func([IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat }))], [IDL.Record({ log_length: IDL.Nat })], ['query']),
});

export const swapIdl = ({ IDL }) => IDL.Service({
    get_lifecycle: IDL.Func([IDL.Record({})], [IDL.Record({ lifecycle: IDL.Opt(IDL.Int32) })], ['query']),
});

/// A service with one no-argument query that returns anything we ignore.
export const pingIdl = (method, ret) => ({ IDL }) => IDL.Service({ [method]: IDL.Func([], [ret(IDL)], ['query']) });

export const archiveStatusIdl = ({ IDL }) => IDL.Service({
    archive_status: IDL.Func([], [IDL.Record({
        parent: IDL.Principal, first_index: IDL.Nat, block_count: IDL.Nat, max_blocks: IDL.Nat, cycles: IDL.Nat, data_bytes: IDL.Nat,
        stable_memory_bytes: IDL.Nat, heap_bytes: IDL.Nat, memory_bytes: IDL.Nat,
    })], ['query']),
});

const ArchiveInfo = IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, length: IDL.Nat, max_blocks: IDL.Nat });
const Settings = IDL.Record({
    max_live_blocks: IDL.Nat, spill_batch_size: IDL.Nat, archive_max_blocks: IDL.Nat,
    archive_initial_cycles: IDL.Nat, archive_top_up_threshold: IDL.Nat, archive_top_up_amount: IDL.Nat,
});
export const sneedLockHealthIdl = ({ IDL }) => IDL.Service({
    get_admin_list: IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    get_active_token_locks: IDL.Func([], [IDL.Vec(IDL.Reserved)], ['query']),
    get_active_position_locks: IDL.Func([], [IDL.Vec(IDL.Reserved)], ['query']),
    icrc3_log_status: IDL.Func([], [IDL.Record({
        log_length: IDL.Nat, live_blocks: IDL.Nat, live_first_index: IDL.Nat, last_block_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
        archives: IDL.Vec(ArchiveInfo), settings: Settings, history_imported: IDL.Bool, spilling: IDL.Bool,
    })], ['query']),
    icrc3_registration_status: IDL.Func([], [IDL.Record({
        governance: IDL.Principal, neuron: IDL.Opt(IDL.Vec(IDL.Nat8)),
        registrations: IDL.Vec(IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, proposal_id: IDL.Opt(IDL.Nat64), attempts: IDL.Nat, last_error: IDL.Opt(IDL.Text) })),
    })], ['query']),
});

export const stakingBotIdl = ({ IDL }) => IDL.Service({
    getVersion: IDL.Func([], [IDL.Reserved], ['query']),
});

/// True when the error says the canister has no such method (older build).
export const isMissingMethod = (e) => /has no (query|update) method|method not found|IC0536|IC0537|no method/i.test(String(e?.message || e));

export { IDL, Principal };
