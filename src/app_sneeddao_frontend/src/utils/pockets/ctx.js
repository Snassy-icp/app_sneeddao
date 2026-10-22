// The context pocket adapters run in (spec/programmable_accounts.md §4.2):
//   ctx = { identity, me, actor(kind, canisterId), canisterIds, ledgerMeta(ledger), swapCanisters(), flags }
// `actor` hands out actors made with the user's identity (cached per kind and canister), so
// adapters never touch keys. Tests build their own ctx with PocketIC actors.
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor as createLedger } from 'external/icrc1_ledger';
import { createActor as createIcpSwap } from 'external/icp_swap';
import { createActor as createIndex } from 'external/sns_index';
import { createActor as createSneedLock, canisterId as sneedLockEnv } from 'declarations/sneed_lock';
import { createActor as createSneedex, canisterId as sneedexEnv } from 'declarations/sneedex';
import { createActor as createMon, canisterId as monEnv } from 'declarations/sneed_mon';
import { createActor as createNotifications, canisterId as notificationsEnv } from 'declarations/sneed_notifications';
import { createActor as createBackend, canisterId as backendEnv } from 'declarations/app_sneeddao_backend';

export const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

/// Only real canister ids (10 bytes, last 0x01): dfx bakes made-up ids into the bundle for
/// canisters a network does not have.
const realId = (t) => {
    try { const b = Principal.fromText(t).toUint8Array(); return b.length === 10 && b[9] === 1 ? Principal.fromText(t) : null; } catch { return null; }
};

export const defaultCanisterIds = () => ({
    sneed_lock: realId(sneedLockEnv),
    sneedex: realId(sneedexEnv),
    sneed_mon: realId(monEnv),
    sneed_notifications: realId(notificationsEnv),
    backend: realId(backendEnv),
    icp_ledger: Principal.fromText(ICP_LEDGER_ID),
});

/// ICRC-106: where a ledger's index is (probed, as pages/studio/IndexPanel.jsx does).
const icrc106Idl = ({ IDL }) => IDL.Service({ icrc106_get_index_principal: IDL.Func([], [IDL.Variant({ Ok: IDL.Principal, Err: IDL.Reserved })], ['query']) });
const createIcrc106 = (id, { agentOptions }) => Actor.createActor(icrc106Idl, { agent: HttpAgent.createSync(agentOptions), canisterId: id });

const FACTORIES = {
    ledger: createLedger,
    index: createIndex,
    icrc106: createIcrc106,
    icpswap_pool: createIcpSwap,
    sneed_lock: createSneedLock,
    sneedex: createSneedex,
    sneed_mon: createMon,
    sneed_notifications: createNotifications,
    backend: createBackend,
};

const isLocal = () => !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');

/// The production context for `identity`. `ledgerMeta(ledger)` → { fee, decimals, symbol } (the
/// wallet's token list knows them); `indexFor(ledger)` → the index canister id when known (SNS
/// data), else discovery probes ICRC-106; `flags` switch optional adapters (taco).
export function makeCtx({ identity, ledgerMeta = null, indexFor = null, flags = {}, canisterIds = defaultCanisterIds(), swapCanisters = null }) {
    const host = isLocal() ? 'http://localhost:4943' : 'https://icp0.io';
    const cache = new Map();
    const actor = (kind, canisterId) => {
        const id = typeof canisterId === 'string' ? canisterId : canisterId.toText();
        const key = `${kind}:${id}`;
        if (!cache.has(key)) cache.set(key, FACTORIES[kind](id, { agentOptions: { host, identity } }));
        return cache.get(key);
    };
    const ctx = {
        identity,
        me: identity.getPrincipal(),
        actor,
        canisterIds,
        ledgerMeta,
        indexFor,
        flags,
        swapCanisters: swapCanisters || (async () => (canisterIds.backend ? actor('backend', canisterIds.backend).get_swap_canister_ids() : [])),
    };
    return ctx;
}
