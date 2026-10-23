// Native <-> ck moves on btc.html (spec/sneed_wallet.md §6, phase A3): while the page is open (any
// tab), every 60 s while visible and once on load, each move to ckBTC that has gone out reads its
// deposit's confirmations (a free Bitcoin canister query) and, when due (moves.js checkDue: the
// minter's confirmations reached, with backoff), calls update_balance as the user; each move to
// the Bitcoin address refreshes its retrieve_btc_status_v2 (a free query). The "Check / finish"
// button runs the same check at once. Records live in localStorage per network and principal, so
// a reload (or another tab) resumes them.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    activeDeposits, activeWithdrawals, depositConfirmations, finishDeposit, noteConfirmations, refreshWithdraw,
} from '../utils/btc/moves';

const TICK_MS = 60_000;

export function useMoves(w) {
    const { ck, cfg, store, movesStore, makeActor, actors, loadRecords } = w;
    const [moves, setMoves] = useState({ ok: true, records: [] });
    const [busyIds, setBusyIds] = useState(() => new Set());
    const [notes, setNotes] = useState({});
    const busy = useRef(new Set());
    const live = useRef(true);
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    const setBusy = (id, on) => {
        if (on) busy.current.add(id); else busy.current.delete(id);
        if (live.current) setBusyIds(new Set(busy.current));
    };

    const loadMoves = useCallback(() => {
        if (!movesStore) return { ok: true, records: [] };
        const r = movesStore.load();
        if (live.current) setMoves(r);
        return r;
    }, [movesStore]);

    /// One check of a move to ckBTC (manual = the button: no backoff, no confirmation wait).
    const checkDeposit = useCallback(async (id, manual = false) => {
        if (!ck || !makeActor || !store || busy.current.has(id)) return null;
        setBusy(id, true);
        try {
            const cur = store.load();
            const rec = cur.ok ? cur.records.find((r) => r.id === id) : null;
            if (rec?.ckbtc && ['broadcast', 'confirmed'].includes(rec.state)) {
                try {
                    const c = await depositConfirmations(actors.bitcoin(cfg.bitcoinCanister), { network: cfg.network, record: rec });
                    noteConfirmations(store, id, c);
                } catch { /* the minter's own count comes with update_balance */ }
            }
            const r = await finishDeposit({ makeActor, store, id, manual });
            loadRecords();
            if (live.current && (manual || !r.skipped)) {
                const tone = r.skipped ? 'info' : r.outcome === 'minted' ? 'success' : ['too_small', 'tainted', 'error'].includes(r.outcome) ? 'error' : 'info';
                const text = r.skipped && r.message === 'the send has not gone out yet' ? 'The Bitcoin send has not gone out yet; the minter is asked once it has.' : r.message;
                setNotes((n) => ({ ...n, [id]: { tone, text } }));
            }
            return r;
        } finally {
            setBusy(id, false);
        }
    }, [ck, makeActor, store, actors, cfg, loadRecords]);

    const refreshWithdrawal = useCallback(async (rec, manual = false) => {
        if (!makeActor || !movesStore || busy.current.has(rec.id)) return null;
        setBusy(rec.id, true);
        try {
            const r = await refreshWithdraw({ makeActor, store: movesStore, record: rec });
            loadMoves();
            return r;
        } catch (e) {
            if (manual && live.current) setNotes((n) => ({ ...n, [rec.id]: { tone: 'warning', text: `Couldn't reach the minter (${String(e?.message || e).split('\n')[0]}).` } }));
            return null;
        } finally {
            setBusy(rec.id, false);
        }
    }, [makeActor, movesStore, loadMoves]);

    const tick = useCallback(async () => {
        if (!ck || !makeActor) return;
        const recs = store?.load();
        if (recs?.ok) for (const r of activeDeposits(recs.records)) await checkDeposit(r.id, false); // eslint-disable-line no-await-in-loop
        const mv = loadMoves();
        if (mv.ok) for (const r of activeWithdrawals(mv.records)) await refreshWithdrawal(r); // eslint-disable-line no-await-in-loop
    }, [ck, makeActor, store, checkDeposit, loadMoves, refreshWithdrawal]);

    const tickRef = useRef(tick);
    tickRef.current = tick;
    useEffect(() => {
        if (!ck || !makeActor) return undefined;
        loadMoves();
        tickRef.current();
        const t = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) tickRef.current(); }, TICK_MS);
        return () => clearInterval(t);
    }, [ck, makeActor, loadMoves]);

    return { moves, loadMoves, checkDeposit, refreshWithdrawal, busyIds, notes, tick };
}
