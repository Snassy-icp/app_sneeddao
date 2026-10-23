// Everything the btc.html page reads and the canisters it talks to (spec/sneed_wallet.md §5).
// One hook so the send, signing-credit and activity views share one set of actors and reads.
//
//   signer         Chain Fusion Signer (btc_caller_send / btc_caller_address), paid in cycles
//   cyclesLedger   um5iw-… (balance, allowance to the signer, approve)
//   icpLedger      for "Top up signing credit from ICP" (transfer to the CMC)
//   cmc            notify_mint_cycles, the ICP/XDR rate
//   bitcoin        the IC Bitcoin canister's free queries (UTXOs)
//   makeActor      any other canister (the ck minter and ledger for moves, utils/btc/moves.js)
// Reads refresh on open, after each action, and every 60 s while the page is visible; there is no
// background polling. Fee rates (mempool.space) are NOT read here: only the send form asks for
// them, while it is open, unless the user turned lookups off (utils/btc/fees.js).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory as icrc1Idl } from 'external/icrc1_ledger/icrc1_ledger.did.js';
import { idlFactory as cmcIdl } from 'external/cmc/cmc.did.js';
import { useAuth } from '../AuthContext';
import priceService from '../services/PriceService';
import { btcNative, btcSurface, ckMoveFor, SIGNER_CANISTER } from '../utils/btc/network';
import { btcAddressFor } from '../utils/btc/address';
import { readNative } from '../utils/pockets/adapters/btc_native';
import { signerIdl } from '../utils/btc/signerIdl';
import { bitcoinCanisterIdl } from '../utils/btc/bitcoinCanisterIdl';
import { fetchFeeRates } from '../utils/btc/fees';
import { CYCLES_LEDGER, readCredit, creditPlan, approveSigner } from '../utils/btc/credit';
import { storeKey, defaultStorage, lockedOutpoints, reconcileAll } from '../utils/btc/pending';
import { makeStore } from '../utils/btc/send';
import { movesKey, makeMovesStore } from '../utils/btc/moves';
import { CMC_CANISTER_ID_TEXT } from '../utils/cyclesTopUp';
import { outpointKey } from '../utils/btc/utxos';

export const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const REFRESH_MS = 60_000;
const isLocal = () => !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const nowNs = () => BigInt(Date.now()) * 1_000_000n;

function makeActors(identity) {
    const host = isLocal() ? 'http://localhost:4943' : 'https://icp0.io';
    const agent = HttpAgent.createSync({ host, identity });
    if (isLocal()) agent.fetchRootKey().catch(() => {});
    const mk = (idl, canisterId) => Actor.createActor(idl, { agent, canisterId });
    const bitcoin = new Map();
    return {
        make: (idl, id) => mk(idl, typeof id === 'string' ? id : id.toText()),
        bitcoin: (id) => { if (!bitcoin.has(id)) bitcoin.set(id, mk(bitcoinCanisterIdl, id)); return bitcoin.get(id); },
        signer: mk(signerIdl, SIGNER_CANISTER),
        cyclesLedger: mk(icrc1Idl, CYCLES_LEDGER),
        icpLedger: mk(icrc1Idl, ICP_LEDGER),
        cmc: mk(cmcIdl, CMC_CANISTER_ID_TEXT),
    };
}

export function useBtcWallet() {
    const { identity, isAuthenticated } = useAuth();
    const me = isAuthenticated && identity ? identity.getPrincipal() : null;
    const meText = me ? me.toText() : null;
    // the network is decided once the principal is known (mainnet developer mode is per
    // principal); while logged out nothing is derived or called. On prod, cfg stays null until
    // this browser turned on the Bitcoin (beta) switch (utils/btc/network.js).
    const status = btcNative(meText);
    const surface = btcSurface(status, Boolean(meText && identity && isAuthenticated));
    const cfg = surface.cfg;
    const address = useMemo(() => (surface.active ? btcAddressFor(meText, cfg.network) : null), [surface.active, cfg, meText]);
    // no canister is called at all while the flag is off (prod with the switch off)
    const actors = useMemo(() => (surface.active ? makeActors(identity) : null), [surface.active, identity]);
    // the btc_native adapter's read (shared 20 s cache) needs a minimal pockets ctx
    const ctx = useMemo(() => (actors && me ? {
        me,
        flags: {},
        actor: (kind, id) => {
            if (kind !== 'bitcoin') throw new Error(`no ${kind} actor on this page`);
            return actors.bitcoin(typeof id === 'string' ? id : id.toText());
        },
    } : null), [actors, me]);
    const storage = useMemo(() => defaultStorage(), []);
    const store = useMemo(() => (cfg && meText ? makeStore(storage, storeKey(cfg.network, meText)) : null), [cfg, meText, storage]);
    // native <-> ck moves (A3): only with an active surface (never on prod with the beta switch off)
    const ck = surface.active ? ckMoveFor(status) : null;
    const movesStore = useMemo(() => (ck && meText ? makeMovesStore(storage, movesKey(cfg.network, meText)) : null), [ck, cfg, meText, storage]);
    const makeActor = useMemo(() => (actors ? actors.make : null), [actors]);

    const [btc, setBtc] = useState({ data: null, error: null, loading: false });
    const [credit, setCredit] = useState({ data: null, error: null, loading: false });
    const [fees, setFees] = useState({ data: null, error: null, loading: false });
    const [records, setRecords] = useState({ ok: true, records: [] });
    const [market, setMarket] = useState({ icpUsd: null, xdrPermyriadPerIcp: null, btcUsd: null, icpBalance: null });
    const inFlight = useRef(new Set());
    const live = useRef(true);
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

    const loadRecords = useCallback(() => {
        if (!store) return { ok: true, records: [] };
        const r = store.load();
        if (live.current) setRecords(r);
        return r;
    }, [store]);

    const refreshBtc = useCallback(async () => {
        if (!ctx) return null;
        setBtc((s) => ({ ...s, loading: true }));
        try {
            const data = await readNative(ctx, { fresh: true });
            // move pending records forward (confirmed / replaced / unknown) against the UTXO set
            if (store) {
                const utxoKeys = new Set(data.utxos.map(outpointKey));
                store.mutate((rs) => reconcileAll(rs, { utxoKeys, now: Date.now(), inFlight: inFlight.current }).records);
                loadRecords();
            }
            if (live.current) setBtc({ data, error: null, loading: false });
            return data;
        } catch (e) {
            if (live.current) setBtc((s) => ({ ...s, error: String(e?.message || e), loading: false }));
            return null;
        }
    }, [ctx, store, loadRecords]);

    const refreshCredit = useCallback(async () => {
        if (!actors || !me) return null;
        setCredit((s) => ({ ...s, loading: true }));
        try {
            const data = await readCredit(actors.cyclesLedger, me);
            if (live.current) setCredit({ data, error: null, loading: false });
            return data;
        } catch (e) {
            if (live.current) setCredit((s) => ({ ...s, error: String(e?.message || e), loading: false }));
            return null;
        }
    }, [actors, me]);

    const refreshFees = useCallback(async (fresh = false) => {
        if (!cfg) return null;
        setFees((s) => ({ ...s, loading: true }));
        const r = await fetchFeeRates(cfg.network, { fresh });
        if (live.current) setFees(r.ok ? { data: r, error: null, loading: false } : { data: null, error: r.error, loading: false });
        return r;
    }, [cfg]);

    const refreshMarket = useCallback(async () => {
        if (!actors || !me) return;
        const [icpUsd, rate, icpBalance, btcUsd] = await Promise.all([
            priceService.getICPUSDPrice().catch(() => null),
            actors.cmc.get_icp_xdr_conversion_rate().then((r) => r.data.xdr_permyriad_per_icp).catch(() => null),
            actors.icpLedger.icrc1_balance_of({ owner: me, subaccount: [] }).then((b) => BigInt(b)).catch(() => null),
            // test coins are never valued; mainnet BTC is valued at the ckBTC price
            cfg && !cfg.testnet ? priceService.getTokenUSDPrice('mxzaz-hqaaa-aaaar-qaada-cai', 8).catch(() => null) : Promise.resolve(null),
        ]);
        if (live.current) setMarket({ icpUsd, xdrPermyriadPerIcp: rate != null ? BigInt(rate) : null, btcUsd, icpBalance });
    }, [actors, me, cfg]);

    const refreshAll = useCallback(() => {
        loadRecords();
        refreshBtc();
        refreshCredit();
        refreshMarket();
    }, [loadRecords, refreshBtc, refreshCredit, refreshMarket]);

    useEffect(() => {
        if (!ctx) return undefined;
        refreshAll();
        const t = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            refreshBtc();
            refreshCredit();
        }, REFRESH_MS);
        return () => clearInterval(t);
    }, [ctx, refreshAll, refreshBtc, refreshCredit]);

    const locked = useMemo(() => (records.ok ? lockedOutpoints(records.records) : new Set()), [records]);

    /**
     * Make sure the signer may take `charges` (cycles, one per call) from the user's cycles-ledger
     * account: read balance and allowance, approve exactly what is needed for one hour when the
     * current allowance is too small or about to expire. { ok, plan, approved } or
     * { ok: false, shortfall, plan, error }.
     */
    const ensureCredit = useCallback(async (charges) => {
        if (!actors || !me) return { ok: false, error: 'Sign in first.' };
        let c;
        try { c = await readCredit(actors.cyclesLedger, me); } catch (e) { return { ok: false, error: `Couldn't read your signing credit (${e?.message || e}).` }; }
        if (live.current) setCredit({ data: c, error: null, loading: false });
        const plan = creditPlan({ balance: c.balance, allowance: { allowance: c.allowance, expiresAt: c.expiresAt }, charges, nowNs: nowNs() });
        if (plan.shortfall > 0n) return { ok: false, shortfall: plan.shortfall, plan, error: 'Not enough signing credit.' };
        if (!plan.approveNeeded) return { ok: true, plan, approved: false };
        let r;
        try { r = await approveSigner(actors.cyclesLedger, { amount: plan.allowanceNeeded, nowNs: nowNs(), expected: c.allowance }); } catch (e) { return { ok: false, plan, error: `The approval did not go through (${e?.message || e}). Nothing was sent; try again.` }; }
        if (!r.ok) return { ok: false, plan, error: r.error };
        refreshCredit();
        return { ok: true, plan, approved: true };
    }, [actors, me, refreshCredit]);

    return {
        status, surface, cfg, me, meText, address, actors, storage, store, ck, movesStore, makeActor,
        btc, credit, fees, records, market, locked, inFlight,
        refreshAll, refreshBtc, refreshCredit, refreshFees, refreshMarket, loadRecords, ensureCredit,
    };
}
