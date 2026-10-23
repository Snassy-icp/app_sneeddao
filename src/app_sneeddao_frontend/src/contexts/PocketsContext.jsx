// The one pockets model for the UI (spec/programmable_accounts.md §4.5): pockets, totals, the
// selected pocket of the switcher, and the registry actions. All logic is in utils/pockets/ (pure,
// tested); this provider only holds state and calls it.
//
// Lazy: nothing is read until a component uses usePockets() (hooks/usePockets.js), so mounting the
// provider costs nothing on pages without pockets. A failing host never breaks the rest.
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useWalletOptional } from './WalletContext';
import { getSnsByLedgerId } from '../utils/SnsUtils';
import { normalizeId } from '../utils/IdUtils';
import { makeCtx } from '../utils/pockets/ctx';
import { createRegistry } from '../utils/pockets/registry';
import { listHosted, readBalances, okBalances, enabledAdapters, adapterFor } from '../utils/pockets/adapters/index';
import { executeTransfer } from '../utils/pockets/move';
import { discoverWallet, checkNumbers, deepScan as deepScanLedger } from '../utils/pockets/discovery';
import * as M from '../utils/pockets/model';
import { numberToSubaccount, canonical } from '../utils/pockets/subaccount';

export const PocketsContext = createContext(null);

const SELECTED_KEY = 'sneed_pockets_selected_v1:';
const HIDE_EMPTY_KEY = 'sneed_pockets_hide_empty_v1';
const SHOW_QUIET_KEY = 'sneed_pockets_show_escrows_v1:';
const readLocal = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const ledgerText = (t) => normalizeId(t?.ledger_canister_id) || (t?.principal ? normalizeId(t.principal) : null);

export function PocketsProvider({ children }) {
    const { identity } = useAuth() || {};
    const wallet = useWalletOptional?.() || null;
    const walletTokens = wallet?.walletTokens || [];
    const me = identity?.getPrincipal?.()?.toText?.() || null;

    const [active, setActive] = useState(false);
    const [rawPockets, setPockets] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [discoveryNotes, setDiscoveryNotes] = useState([]);
    const [registryError, setRegistryError] = useState(null);
    const [selected, setSelectedState] = useState(M.ALL);
    const [hideEmpty, setHideEmptyState] = useState(() => readLocal(HIDE_EMPTY_KEY, true));
    const [showQuiet, setShowQuietState] = useState(false);
    // Sneedex escrows stay out of sight unless something can be withdrawn, or the user asks (Advanced)
    // and hosted dust at or below the ledger fee (it can't be withdrawn) stays out of sight too
    const feeByLedger = useMemo(() => new Map(walletTokens.map((t) => [ledgerText(t), t.fee]).filter(([l, f]) => l && f != null)), [walletTokens]);
    const pockets = useMemo(() => M.applyQuiet(M.dropDust(rawPockets, (l) => feeByLedger.get(l) ?? null), { showQuiet }), [rawPockets, showQuiet, feeByLedger]);
    const run = useRef(0);
    const registryRef = useRef(null);

    const ledgers = useMemo(() => [...new Set(walletTokens.map(ledgerText).filter(Boolean))], [walletTokens]);
    // Main and the Sneed Lock wallet come from the wallet's token list (it reads them already)
    const seed = useMemo(() => walletTokens.map((t) => ({ ledger: ledgerText(t), balance: t.balance, balance_backend: t.balance_backend, locked: t.locked })).filter((t) => t.ledger), [walletTokens]);
    const seedRef = useRef(seed);
    seedRef.current = seed;
    useEffect(() => { setPockets((ps) => (ps.length ? M.withWalletTokens(ps, seed) : ps)); }, [seed]);
    const metaRef = useRef(new Map());
    useEffect(() => {
        const m = new Map();
        for (const t of walletTokens) { const l = ledgerText(t); if (l) m.set(l, { fee: t.fee, decimals: t.decimals, symbol: t.symbol }); }
        metaRef.current = m;
    }, [walletTokens]);

    const ctx = useMemo(() => (identity ? makeCtx({
        identity,
        ledgerMeta: async (l) => metaRef.current.get(l) || null,
        indexFor: async (l) => getSnsByLedgerId(l)?.canisters?.index || null,
    }) : null), [identity]);

    // per-identity state: registry, selection
    useEffect(() => {
        registryRef.current = identity ? createRegistry(identity) : null;
        setPockets(identity ? M.withWalletTokens(M.mergePockets({ me: identity.getPrincipal(), registry: registryRef.current.entries() }), seedRef.current) : []);
        setSelectedState(me ? readLocal(SELECTED_KEY + me, M.ALL) : M.ALL);
        setShowQuietState(me ? Boolean(readLocal(SHOW_QUIET_KEY + me, false)) : false);
    }, [identity, me]);

    const refresh = useCallback(async () => {
        if (!ctx || !registryRef.current) return;
        const id = ++run.current;
        setLoading(true);
        setError(null);
        try {
            const registry = registryRef.current;
            // the mirror stays when the naming service can't be read, but say so (never drop pockets silently)
            try { await registry.refresh(); setRegistryError(null); } catch (e) { setRegistryError(`Couldn't read your saved pockets from the naming service: ${e?.message || e}`); }
            const [hosted, disc] = await Promise.all([listHosted(ctx, { adapters: enabledAdapters(ctx) }), discoverWallet(ctx, ledgers, { registry, probe: false })]);
            let merged = M.withWalletTokens(M.mergePockets({ me: ctx.me, registry: registry.entries(), discovered: disc.discovered, hosted }), seedRef.current);
            if (id !== run.current) return;
            setPockets(merged);
            setDiscoveryNotes(disc.byLedger);
            const seeded = new Set(seedRef.current.map((t) => t.ledger));
            const skip = (p, l) => (p.id === M.MAIN_ID || p.id === M.LOCK_POCKET_ID) && seeded.has(l);
            const balances = okBalances(await readBalances(ctx, merged, ledgers, { skip }));
            merged = M.withWalletTokens(M.mergePockets({ me: ctx.me, registry: registry.entries(), discovered: disc.discovered, hosted, balances }), seedRef.current);
            if (id !== run.current) return;
            setPockets(merged);
        } catch (e) {
            if (id === run.current) setError(String(e?.message || e));
        } finally {
            if (id === run.current) setLoading(false);
        }
    }, [ctx, ledgers]);

    // the wallet's tokens arrive one by one: read once they settle (and again when the list changes)
    const ledgersKey = ledgers.join(',');
    useEffect(() => {
        if (!active || !ctx) return undefined;
        const t = setTimeout(() => refresh(), 1500);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, ctx, ledgersKey]);

    const setSelected = useCallback((v) => {
        const next = v || M.ALL;
        setSelectedState(next);
        if (me) writeLocal(SELECTED_KEY + me, next);
    }, [me]);
    const setShowQuiet = useCallback((v) => { setShowQuietState(Boolean(v)); if (me) writeLocal(SHOW_QUIET_KEY + me, Boolean(v)); }, [me]);
    const setHideEmpty = useCallback((v) => { setHideEmptyState(Boolean(v)); writeLocal(HIDE_EMPTY_KEY, Boolean(v)); }, []);
    const validSelected = M.validSelection(pockets, selected);

    const afterRegistryChange = useCallback(() => {
        const r = registryRef.current;
        if (!r || !ctx) return;
        setPockets((ps) => {
            const fresh = M.mergePockets({ me: ctx.me, registry: r.entries() });
            const old = new Map(ps.map((p) => [p.id, p]));
            const ids = new Set(fresh.map((p) => p.id));
            // keep what was read (balances, hosted pockets), with the new names and flags
            const kept = ps.filter((p) => !ids.has(p.id));
            return [...fresh.map((p) => (old.has(p.id) ? { ...old.get(p.id), nickname: p.nickname, hidden: p.hidden, registered: p.registered } : p)), ...kept];
        });
    }, [ctx]);

    /// Create a wallet pocket: the next free number (default), a given number, or an exact subaccount.
    const create = useCallback(async ({ number = null, subaccount = null, name = '' } = {}) => {
        const r = registryRef.current;
        if (!r || !ctx) throw new Error('Sign in to create pockets');
        const sub = subaccount ? canonical(subaccount) : numberToSubaccount(number ?? M.nextFreeNumber(pockets, { registry: r.entries(), me: ctx.me }));
        if (!sub) throw new Error('Main already exists');
        const account = { owner: ctx.me, subaccount: sub };
        const [res] = await r.remember([{ account, ledgers: [] }]);
        if (res && 'err' in res) throw new Error(res.err);
        if (name.trim()) await r.rename(account, name);
        afterRegistryChange();
        return M.walletPocketId(sub);
    }, [ctx, pockets, afterRegistryChange]);

    const accountOf = (p) => p.account;
    const rename = useCallback(async (p, name) => { await registryRef.current.rename(accountOf(p), name); afterRegistryChange(); }, [afterRegistryChange]);
    const hide = useCallback(async (p, hidden = true) => { await registryRef.current.setHidden(accountOf(p), hidden, p.kind === M.KIND.wallet ? null : p.adapterId); afterRegistryChange(); }, [afterRegistryChange]);
    const forget = useCallback(async (p) => { await registryRef.current.forget(accountOf(p)); afterRegistryChange(); }, [afterRegistryChange]);

    /// "Check pocket #N" for a ledger (ICP has no listing): pockets with a balance are remembered.
    const checkNumber = useCallback(async (ledger, n) => {
        if (!ctx) return [];
        const nums = Array.isArray(n) ? n : [n];
        const found = await checkNumbers(ctx, ledger, nums);
        const hits = found.filter((f) => f.balance > 0n);
        if (hits.length) { try { await registryRef.current.remember(hits.map((f) => ({ account: { owner: ctx.me, subaccount: f.subaccount }, ledgers: [String(ledger)] }))); } catch { /* registry optional */ } }
        setPockets((ps) => M.mergePockets({ me: ctx.me, registry: registryRef.current.entries(), discovered: [...ps.filter((p) => p.kind === M.KIND.wallet).map((p) => ({ subaccount: p.account.subaccount })), ...found.map((f) => ({ subaccount: f.subaccount, ledger: String(ledger), balance: f.balance }))], hosted: [] }).map((q) => {
            const old = ps.find((p) => p.id === q.id);
            return old ? { ...old, ...q, balances: new Map([...old.balances, ...q.balances]) } : q;
        }).concat(ps.filter((p) => p.kind !== M.KIND.wallet)));
        return found;
    }, [ctx]);

    const deepScan = useCallback((ledger) => deepScanLedger(ctx, ledger), [ctx]);

    /// What a pocket can deliver now in `ledger`, and why not more (its adapter's rules).
    const rules = useCallback(async (pocket, ledger) => {
        const a = adapterFor(pocket);
        if (!ctx || !a?.rules) return { withdrawable: 0n, why: 'not available' };
        return a.rules(ctx, pocket, String(ledger));
    }, [ctx]);

    /// Send from a pocket to an account, or move to another pocket (`to` a pocket); then re-read.
    const transfer = useCallback(async (from, to, ledger, amount) => {
        if (!ctx) throw new Error('Sign in first');
        const r = await executeTransfer(ctx, from, to, String(ledger), amount);
        if (to?.kind === M.KIND.wallet && to.account?.subaccount && registryRef.current) {
            try { await registryRef.current.remember([{ account: to.account, ledgers: [String(ledger)] }]); } catch { /* registry optional */ }
        }
        refresh();
        return r;
    }, [ctx, refresh]);

    const value = useMemo(() => ({
        active,
        activate: () => setActive(true),
        pockets,
        loading,
        error,
        discoveryNotes,
        ctx,
        selected: validSelected,
        setSelected,
        hideEmpty,
        setHideEmpty,
        showQuiet,
        setShowQuiet,
        registryError,
        pocketsFor: (ledger) => M.sortPockets(M.listed(pockets, ledger)),
        total: (ledger) => M.total(pockets, ledger, M.ALL),
        balanceFor: (ledger) => M.total(pockets, ledger, validSelected),
        holders: (ledger) => M.holders(pockets, ledger),
        showDisclosure: (ledger) => M.showDisclosure(pockets, ledger),
        displayName: M.displayName,
        create,
        rename,
        hide,
        forget,
        refresh,
        checkNumber,
        deepScan,
        rules,
        transfer,
        pocketById: (id) => pockets.find((p) => p.id === id) || null,
        registryEntries: () => registryRef.current?.entries() || [],
    }), [active, pockets, loading, error, discoveryNotes, registryError, ctx, validSelected, setSelected, hideEmpty, setHideEmpty, showQuiet, setShowQuiet, create, rename, hide, forget, refresh, checkNumber, deepScan, rules, transfer]);

    return <PocketsContext.Provider value={value}>{children}</PocketsContext.Provider>;
}

export default PocketsContext;
