// One anonymous agent for every health check, plus the small Candid
// interfaces the checks need that no generated declaration covers.
import { Actor, HttpAgent, CanisterStatus } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { bigEndianCrc32 } from '@dfinity/utils';
import { sha224 } from '@noble/hashes/sha256';

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

/// A canister's controllers and module hash (hex, null without code), read from the certified
/// state tree: anyone can ask, the canister does not have to answer or know about it.
export async function readControllers(canisterId) {
    const id = typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId;
    const r = await CanisterStatus.request({ canisterId: id, agent: getAgent(id.toText()), paths: ['controllers', 'module_hash'] });
    return { controllers: (r.get('controllers') || []).map((p) => p.toText()), moduleHash: r.get('module_hash') || null };
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
    icrc3_log_status: IDL.Func([], [IDL.Record({
        log_length: IDL.Nat, live_blocks: IDL.Nat, live_first_index: IDL.Nat, last_block_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
        archives: IDL.Vec(ArchiveInfo), settings: Settings, history_imported: IDL.Bool, spilling: IDL.Bool,
    })], ['query']),
    icrc3_registration_status: IDL.Func([], [IDL.Record({
        governance: IDL.Principal, neuron: IDL.Opt(IDL.Vec(IDL.Nat8)),
        registrations: IDL.Vec(IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, proposal_id: IDL.Opt(IDL.Nat64), attempts: IDL.Nat, last_error: IDL.Opt(IDL.Text) })),
    })], ['query']),
});

// The ICP index canister: transactions of one account, newest first. Accounts
// in the operations are account identifiers (hex), see accountIdentifierHex.
const Tokens = IDL.Record({ e8s: IDL.Nat64 });
const TimeStamp = IDL.Record({ timestamp_nanos: IDL.Nat64 });
const IcpOperation = IDL.Variant({
    Approve: IDL.Record({ fee: Tokens, from: IDL.Text, allowance: Tokens, expires_at: IDL.Opt(TimeStamp), spender: IDL.Text, expected_allowance: IDL.Opt(Tokens) }),
    Burn: IDL.Record({ from: IDL.Text, amount: Tokens, spender: IDL.Opt(IDL.Text) }),
    Mint: IDL.Record({ to: IDL.Text, amount: Tokens }),
    Transfer: IDL.Record({ to: IDL.Text, fee: Tokens, from: IDL.Text, amount: Tokens, spender: IDL.Opt(IDL.Text) }),
});
export const icpIndexIdl = ({ IDL }) => IDL.Service({
    get_account_transactions: IDL.Func(
        [IDL.Record({ account: Account, start: IDL.Opt(IDL.Nat), max_results: IDL.Nat })],
        [IDL.Variant({
            Ok: IDL.Record({
                balance: IDL.Nat64,
                transactions: IDL.Vec(IDL.Record({ id: IDL.Nat64, transaction: IDL.Record({ memo: IDL.Nat64, icrc1_memo: IDL.Opt(IDL.Vec(IDL.Nat8)), operation: IcpOperation, created_at_time: IDL.Opt(TimeStamp), timestamp: IDL.Opt(TimeStamp) }) })),
                oldest_tx_id: IDL.Opt(IDL.Nat64),
            }),
            Err: IDL.Record({ message: IDL.Text }),
        })],
        ['query'],
    ),
});

export const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/// The ICP ledger account identifier (hex) of an ICRC-1 account.
export const accountIdentifierHex = (owner, subaccount) => {
    const principal = (typeof owner === 'string' ? Principal.fromText(owner) : owner).toUint8Array();
    const sub = subaccount ? Uint8Array.from(subaccount) : new Uint8Array(32);
    const domain = new TextEncoder().encode('account-id');
    const digest = sha224(new Uint8Array([0x0a, ...domain, ...principal, ...sub]));
    return hex(new Uint8Array([...bigEndianCrc32(digest), ...digest]));
};

export const backendTokenListIdl = ({ IDL }) => IDL.Service({
    get_token_list_status: IDL.Func([], [IDL.Record({
        tokens: IDL.Nat, interval_seconds: IDL.Nat, timer_scheduled: IDL.Bool, refresh_running: IDL.Bool,
        last_import: IDL.Int, last_refresh_started: IDL.Int, last_refresh_done: IDL.Int, last_error: IDL.Text,
    })], ['query']),
});

export const stakingBotIdl = ({ IDL }) => IDL.Service({
    getVersion: IDL.Func([], [IDL.Reserved], ['query']),
});

/// True when the error says the canister has no such method (older build).
export const isMissingMethod = (e) => /has no (query|update) method|method not found|IC0536|IC0537|no method/i.test(String(e?.message || e));

export { IDL, Principal };
