// A page-wide store of ICRC-2 approvals per (ledger, account), on top of utils/approvals.js.
// Results are cached in localStorage (maxAge 30 min by default), at most 3 discoveries run at once,
// and an approve made anywhere in the app (approveAndRecord / setApproval) marks that ledger stale.
//
//   useApprovals({ ledgerId, owner, subaccount })        one ledger, one account (token card, pockets)
//   useApprovalsMany({ ledgerIds, owner, subaccount })   several ledgers (the wallet's Approvals tab)
//   loadApprovals({ ledgerId, owner, subaccount, force }) the same without React
import { useEffect, useMemo, useSyncExternalStore, useCallback } from 'react';
import { HttpAgent } from '@dfinity/agent';
import {
    discoverApprovals, cacheKeyFor, readApprovalsCache, writeApprovalsCache, makeLimiter,
    APPROVALS_CHANGED_EVENT, subaccountHex,
} from '../utils/approvals';
import { spenderCandidates, indexHintFor } from '../utils/approvalSpenders';

export const APPROVALS_MAX_AGE_MS = 30 * 60 * 1000;

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';

let anonAgent = null;
/// An agent for the read-only discovery (anonymous: every call is a public query).
const readAgent = () => {
    if (!anonAgent) {
        anonAgent = HttpAgent.createSync({ host });
        if (isLocal) anonAgent.fetchRootKey().catch(() => {});
    }
    return anonAgent;
};

/// An agent that signs as `identity` (for revoke / change).
export const approvalsAgent = (identity) => {
    const a = HttpAgent.createSync({ host, identity });
    if (isLocal) a.fetchRootKey().catch(() => {});
    return a;
};

// key → { status: 'idle'|'loading'|'done'|'error', result, error }
const entries = new Map();
const inflight = new Map();
const listeners = new Set();
let version = 0;
const emit = () => { version++; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getVersion = () => version;
const limiter = makeLimiter(3);

// something approved on a ledger: its results are stale now
if (typeof window !== 'undefined') {
    window.addEventListener(APPROVALS_CHANGED_EVENT, (e) => {
        const ledgerId = e?.detail?.ledgerId;
        let changed = false;
        for (const [k, v] of entries) {
            if ((!ledgerId || k.startsWith(`${ledgerId}|`)) && v.result) { entries.set(k, { ...v, result: { ...v.result, at: 0 } }); changed = true; }
        }
        if (changed) emit();
    });
}

/// The store entry for an account on a ledger (filled from the localStorage cache on first look).
export function getApprovalsEntry(ledgerId, owner, subaccount = null) {
    if (!ledgerId || !owner) return null;
    const key = cacheKeyFor(ledgerId, owner, subaccount);
    if (!entries.has(key)) {
        const cached = readApprovalsCache(key);
        entries.set(key, cached ? { status: 'done', result: cached } : { status: 'idle', result: null });
    }
    return entries.get(key);
}

/// Discover (or return the fresh cached) approvals. Never throws; errors land in the entry.
/// `positions`: the user's liquidity positions (their pools join the known spenders).
export function loadApprovals({ ledgerId, owner, subaccount = null, force = false, maxAgeMs = APPROVALS_MAX_AGE_MS, positions = [] }) {
    if (!ledgerId || !owner) return Promise.resolve(null);
    const owners = String(owner);
    const key = cacheKeyFor(ledgerId, owners, subaccount);
    const prev = getApprovalsEntry(ledgerId, owners, subaccount);
    if (!force && prev?.result && Date.now() - (prev.result.at || 0) < maxAgeMs) return Promise.resolve(prev.result);
    if (inflight.has(key)) return inflight.get(key);
    entries.set(key, { ...prev, status: 'loading', error: null });
    emit();
    const p = limiter(async () => {
        const { check, resolve } = spenderCandidates(ledgerId, { positions });
        return discoverApprovals({ agent: readAgent(), ledgerId: String(ledgerId), owner: owners, subaccount, candidates: check, resolveCandidates: resolve, indexHint: indexHintFor(ledgerId) });
    }).then((result) => {
        writeApprovalsCache(key, result);
        entries.set(key, { status: 'done', result });
        emit();
        return result;
    }).catch((e) => {
        entries.set(key, { status: 'error', result: prev?.result || null, error: e?.message || String(e) });
        emit();
        return null;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
}

const useStoreVersion = () => useSyncExternalStore(subscribe, getVersion, getVersion);

/**
 * Approvals of one account on one ledger.
 * @returns {{ approvals, result, loading, error, refresh }}
 *   auto=false only reads what is cached (no network): for badges.
 */
export function useApprovals({ ledgerId, owner, subaccount = null, auto = true, maxAgeMs = APPROVALS_MAX_AGE_MS, positions }) {
    useStoreVersion();
    const ownerText = owner ? String(owner) : null;
    const subHex = subaccountHex(subaccount);
    const entry = getApprovalsEntry(ledgerId, ownerText, subHex);
    const at = entry?.result?.at;
    useEffect(() => {
        if (auto && ledgerId && ownerText) loadApprovals({ ledgerId, owner: ownerText, subaccount: subHex, maxAgeMs, positions });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auto, ledgerId, ownerText, subHex, maxAgeMs, at]);
    const refresh = useCallback(() => loadApprovals({ ledgerId, owner: ownerText, subaccount: subHex, force: true, positions }), [ledgerId, ownerText, subHex, positions]);
    return {
        approvals: entry?.result?.approvals || [],
        result: entry?.result || null,
        loading: entry?.status === 'loading',
        error: entry?.status === 'error' ? entry.error : null,
        refresh,
    };
}

/**
 * Approvals of one account on many ledgers.
 * @returns {{ approvals, results: Array<{ ledgerId, result, loading, error }>, loadingCount, doneCount, refreshAll }}
 */
export function useApprovalsMany({ ledgerIds, owner, subaccount = null, auto = true, maxAgeMs = APPROVALS_MAX_AGE_MS, positions }) {
    const v = useStoreVersion();
    const ownerText = owner ? String(owner) : null;
    const subHex = subaccountHex(subaccount);
    const idsKey = (ledgerIds || []).map(String).join(',');
    const ids = useMemo(() => [...new Set(idsKey ? idsKey.split(',') : [])], [idsKey]);
    const staleKey = ids.map((id) => getApprovalsEntry(id, ownerText, subHex)?.result?.at || 0).join(',');
    useEffect(() => {
        if (!auto || !ownerText) return;
        for (const id of ids) loadApprovals({ ledgerId: id, owner: ownerText, subaccount: subHex, maxAgeMs, positions });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auto, ownerText, subHex, idsKey, maxAgeMs, staleKey]);
    const results = useMemo(() => ids.map((id) => {
        const e = getApprovalsEntry(id, ownerText, subHex);
        return { ledgerId: id, result: e?.result || null, loading: e?.status === 'loading', error: e?.status === 'error' ? e.error : null };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [ids, ownerText, subHex, v]);
    const refreshAll = useCallback(() => Promise.all(ids.map((id) => loadApprovals({ ledgerId: id, owner: ownerText, subaccount: subHex, force: true, positions }))), [ids, ownerText, subHex, positions]);
    return {
        approvals: results.flatMap((r) => r.result?.approvals || []),
        results,
        loadingCount: results.filter((r) => r.loading).length,
        doneCount: results.filter((r) => r.result && !r.loading).length,
        refreshAll,
    };
}
