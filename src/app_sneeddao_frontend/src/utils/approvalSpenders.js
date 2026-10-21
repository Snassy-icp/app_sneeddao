// Who might hold an approval from a Sneed Hub user, by ledger, with a readable name: the spenders
// approvals.js checks with icrc2_allowance when a ledger can't list allowances itself (no ICRC-103),
// and the names the approvals list shows. App-specific (canister ids of this build), unlike approvals.js.
import { Principal } from '@dfinity/principal';
import { canisterId as BACKEND } from 'declarations/app_sneeddao_backend';
import { SNEED_CANISTERS } from './agentConnect';
import { CYCLEPAY_CANISTER_ID, CKUSDC_LEDGER_ID } from './CyclePayService';
import { PAD_CANISTER_ID } from '../tokensafety/padIdl';
import { getRecordedSpenders, ICP_LEDGER_ID } from './approvals';
import { getTokenMetadataSync } from '../hooks/useTokenCache';
import { getSnsByLedgerId } from './SnsUtils';
import { KONG_SWAP_CANISTER } from '../services/dex/types';

const GLDT_LEDGER = '6c7su-kiaaa-aaaar-qaira-cai';
const SGLDT_CANISTER = 'i2s4q-syaaa-aaaan-qz4sq-cai';
const ICPSWAP_POOL_CACHE_KEY = 'icpswap_pool_cache'; // ICPSwapDex's localStorage map pairKey → pool id
const MAX_POOLS_CHECKED = 12; // per ledger in "known spenders" mode; names are resolved for all

const isCanisterId = (t) => { try { const b = Principal.fromText(String(t || '')).toUint8Array(); return b.length === 10 && b[9] === 1; } catch { return false; } };

/// [name, id, ledger | null (any ledger)] — Sneed canisters and services Sneed Hub approves.
const fixedSpenders = () => [
    ...SNEED_CANISTERS.map(([name, id]) => [name, id, null]),
    ['Sneed Hub backend', BACKEND, null],
    ['Sneed Pad', PAD_CANISTER_ID, ICP_LEDGER_ID],
    ['CyclePay', CYCLEPAY_CANISTER_ID, CKUSDC_LEDGER_ID],
    ['KongSwap', KONG_SWAP_CANISTER, null],
    ['sGLDT', SGLDT_CANISTER, GLDT_LEDGER],
].filter(([, id]) => isCanisterId(id));

const symbolOf = (ledgerId) => {
    try { return getTokenMetadataSync(ledgerId)?.symbol || getSnsByLedgerId(ledgerId)?.token_symbol || null; } catch { return null; }
};

let poolRaw = null;
let poolMap = {};
const poolCache = () => {
    const raw = localStorage.getItem(ICPSWAP_POOL_CACHE_KEY) || '{}';
    if (raw !== poolRaw) { poolMap = JSON.parse(raw); poolRaw = raw; }
    return poolMap;
};

/// ICPSwap pools for pairs with `ledgerId` that this browser has seen (the swap's pool cache), plus
/// the user's liquidity-position pools (WalletContext's { swapCanisterId, token0, token1 }) if given.
export function icpswapPoolsFor(ledgerId, positions = []) {
    const id = String(ledgerId).toLowerCase();
    const out = new Map();
    try {
        const map = poolCache();
        for (const [k, pool] of Object.entries(map)) {
            const [a, b] = k.split(':');
            if (a === id || b === id) out.set(pool, { owner: pool, other: a === id ? b : a, kind: 'icpswap' });
        }
    } catch { /* none */ }
    for (const p of positions || []) {
        const pool = p?.swapCanisterId?.toText?.() || (p?.swapCanisterId ? String(p.swapCanisterId) : null);
        if (!pool) continue;
        const txt = (v) => (v ? (v.toText ? v.toText() : String(v)) : '').toLowerCase();
        const l0 = txt(p.token0);
        const l1 = txt(p.token1);
        if (l0 === id || l1 === id) out.set(pool, { owner: pool, other: l0 === id ? l1 : l0, kind: 'icpswap', position: true });
    }
    return [...out.values()];
}

const poolName = (ledgerId, other) => {
    const mine = symbolOf(ledgerId);
    const theirs = other ? symbolOf(other) : null;
    return mine && theirs ? `ICPSwap ${mine}/${theirs} pool` : 'ICPSwap pool';
};

/**
 * Spender candidates for `ledgerId`: { check, resolve }.
 *  check   — checked with icrc2_allowance (Sneed canisters, recorded spenders, a few pools)
 *  resolve — also used to name ICP-index spenders (all known pools; hashing only, no calls)
 */
export function spenderCandidates(ledgerId, { positions = [] } = {}) {
    const id = String(ledgerId);
    const check = [];
    const seen = new Set();
    const add = (list, c) => { const k = `${c.owner}|${c.subaccount ? 'sub' : ''}`; if (!seen.has(k)) { seen.add(k); list.push(c); } };
    for (const [name, owner, ledger] of fixedSpenders()) if (!ledger || ledger === id) add(check, { owner, name });
    for (const r of getRecordedSpenders(id)) add(check, r);
    const pools = icpswapPoolsFor(id, positions);
    // positions first: those pools are the user's own
    pools.sort((a, b) => Number(!!b.position) - Number(!!a.position)).slice(0, MAX_POOLS_CHECKED).forEach((p) => add(check, { owner: p.owner, name: poolName(id, p.other) }));
    const resolve = pools.map((p) => ({ owner: p.owner, name: poolName(id, p.other) }));
    return { check, resolve };
}

/// A readable name for a spender principal (text), or null: Sneed canisters, services, pools.
export function knownSpenderName(spenderText, ledgerId = null) {
    const s = String(spenderText);
    for (const [name, owner] of fixedSpenders()) if (owner === s) return name;
    if (ledgerId) {
        const p = icpswapPoolsFor(ledgerId).find((x) => x.owner === s);
        if (p) return poolName(ledgerId, p.other);
    }
    return null;
}

/// The SNS index canister for an SNS ledger, from the SNS cache (for ledgers without ICRC-106).
export function indexHintFor(ledgerId) {
    try { return getSnsByLedgerId(String(ledgerId))?.canisters?.index || null; } catch { return null; }
}
