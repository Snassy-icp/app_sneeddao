// Sneed SMS inbox, loaded once for the signed-in principal and shared by the header's unread count
// and the Messages pages. The newest messages of the received and sent lists are cached per
// principal (utils/smsCache.js) and shown at once; then only what is new is fetched
// (get_received_messages_page / get_sent_messages_page with `after`), and older messages page by
// page on demand (`before`). Each paged reply carries the list's `total` and `last_updated`: when
// they differ from what the cache plus the new messages imply, something was removed or changed and
// the newest page is read again. Canisters without the paged reads ("method not found") fall back to
// the full lists (only while a Messages page is open) and the unread count query.
//
// Polling: every 60 s in the background, every 30 s while a Messages page is open, only while the tab
// is visible; also on 'sneed-refresh' / coming back to the screen (useAppRefresh). The newest page is
// reread every 10 minutes and on a manual Refresh. Cleared when the principal signs out.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { createActor as createSmsActor } from '../../../declarations/sneed_sms';
import { useAppRefresh } from '../hooks/useAppRefresh';
import { cacheKey, deleteSmsCache, loadSmsCache, saveSmsCache } from '../utils/smsCache';

const SMS_CANISTER_ID = process.env.CANISTER_ID_SNEED_SMS || 'v33jy-4qaaa-aaaad-absna-cai';
const PAGE = 100;               // newest page (the canister's cap)
const OLDER_PAGE = 50;          // "Load older"
const MAX_CATCH_UP_PAGES = 5;   // more new than this: reread the newest page instead
const POLL_BACKGROUND_MS = 60_000;
const POLL_ACTIVE_MS = 30_000;
const FULL_RESYNC_MS = 10 * 60_000;
const SENT_BACKGROUND_MS = 5 * 60_000;

const SmsContext = createContext(null);

const emptyList = () => ({ items: [], total: 0, lastUpdated: 0n, hasOlder: false, loaded: false });
const maxBig = (a, b) => (b > a ? b : a);
const byNewest = (a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : (a.created_at < b.created_at ? 1 : -1));
const maxId = (items) => items.reduce((m, x) => maxBig(m, x.id), 0n);
const minId = (items) => items.reduce((m, x) => (m === null || x.id < m ? x.id : m), null);
const dedupe = (items) => {
    const seen = new Set();
    return items.filter((m) => { const k = m.id.toString(); if (seen.has(k)) return false; seen.add(k); return true; });
};

/// A reject for a method the canister does not have (an older build): IC0536 / "has no query method".
export const isMissingMethod = (e) => /has no (query|update) method|method not found|IC0536|IC0302/i.test(String(e?.message || e));

export function SmsProvider({ children }) {
    const { identity, isAuthenticated } = useAuth();
    const principal = isAuthenticated && identity ? identity.getPrincipal().toText() : null;

    const [received, setReceived] = useState(emptyList);
    const [sent, setSent] = useState(emptyList);
    const [lastSeen, setLastSeen] = useState(null);          // ns bigint; null until known
    const [lastSeenFresh, setLastSeenFresh] = useState(false); // read from the canister this session
    const [legacyUnread, setLegacyUnread] = useState(null);    // count query, when the cache can't tell
    const [mode, setMode] = useState(null);                    // 'paged' | 'legacy'
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState(null);
    const [arrivals, setArrivals] = useState(() => new Map()); // id text -> ms, messages that came in by polling
    const [lastSynced, setLastSynced] = useState(null);

    // the authoritative copy for the async code (React state lags a render behind)
    const store = useRef({ received: emptyList(), sent: emptyList(), lastSeen: null });
    const principalRef = useRef(principal);
    const keyRef = useRef(null);
    const modeRef = useRef(null);
    const actorRef = useRef(null);
    const inflight = useRef(null);
    const lastFullAt = useRef(0);
    const lastSentAt = useRef(0);
    const activeViewers = useRef(0);
    const [activeCount, setActiveCount] = useState(0);

    const publish = useCallback(() => {
        setReceived({ ...store.current.received });
        setSent({ ...store.current.sent });
        setLastSeen(store.current.lastSeen);
    }, []);

    const persist = useCallback(() => {
        if (!keyRef.current) return;
        const { received: r, sent: s, lastSeen: ls } = store.current;
        saveSmsCache(keyRef.current, { received: r.loaded ? r : null, sent: s.loaded ? s : null, lastSeen: ls });
    }, []);

    // a new identity (also a renewed login of the same principal) signs the calls
    useEffect(() => {
        actorRef.current = principal && identity ? createSmsActor(SMS_CANISTER_ID, { agentOptions: { identity } }) : null;
    }, [identity, principal]);

    // principal changes: drop the old one's state (and its cache on sign-out), load the new one's cache
    useEffect(() => {
        const previousKey = keyRef.current;
        principalRef.current = principal;
        inflight.current = null;
        lastFullAt.current = 0;
        lastSentAt.current = 0;
        store.current = { received: emptyList(), sent: emptyList(), lastSeen: null };
        modeRef.current = null;
        setMode(null);
        setLegacyUnread(null);
        setLastSeenFresh(false);
        setArrivals(new Map());
        setError(null);
        publish();
        if (!principal) {
            keyRef.current = null;
            if (previousKey) deleteSmsCache(previousKey); // signed out: nothing stays on the device
            return undefined;
        }
        keyRef.current = cacheKey(SMS_CANISTER_ID, principal);
        let cancelled = false;
        loadSmsCache(keyRef.current).then((cached) => {
            if (cancelled || !cached || principalRef.current !== principal) return;
            // only if nothing fresher arrived meanwhile
            if (!store.current.received.loaded && cached.received) store.current.received = { ...cached.received, loaded: true, fromCache: true };
            if (!store.current.sent.loaded && cached.sent) store.current.sent = { ...cached.sent, loaded: true, fromCache: true };
            if (store.current.lastSeen === null) store.current.lastSeen = cached.lastSeen;
            publish();
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [principal]);

    const pageCall = (actor, kind, args) => (kind === 'received'
        ? actor.get_received_messages_page(args)
        : actor.get_sent_messages_page(args));

    /// The newest page of a list, replacing what is held.
    const reloadNewest = async (actor, kind) => {
        const page = await pageCall(actor, kind, { before: [], after: [], limit: BigInt(PAGE) });
        return { items: page.messages, total: Number(page.total), lastUpdated: page.last_updated, hasOlder: page.has_more, loaded: true };
    };

    /// What is new in a list since the highest id held; null when the list must be reread.
    const catchUp = async (actor, kind, list) => {
        let after = maxId(list.items);
        const fresh = [];
        let last = null;
        for (let i = 0; i < MAX_CATCH_UP_PAGES; i += 1) {
            last = await pageCall(actor, kind, { before: [], after: [after], limit: BigInt(PAGE) });
            fresh.push(...last.messages);
            if (!last.has_more || last.messages.length === 0) break;
            after = last.messages[last.messages.length - 1].id;
        }
        if (last.has_more) return null;
        const known = new Set(list.items.map((m) => m.id.toString()));
        const added = fresh.filter((m) => !known.has(m.id.toString()));
        const expectedTotal = list.total + added.length;
        const expectedLast = added.reduce((a, m) => maxBig(a, m.updated_at), list.lastUpdated ?? 0n);
        if (Number(last.total) !== expectedTotal || last.last_updated !== expectedLast) return null; // removed or changed
        return { items: [...added.reverse(), ...list.items], total: expectedTotal, lastUpdated: last.last_updated, hasOlder: list.hasOlder, loaded: true };
    };

    // keepOlder: a reread keeps the older pages loaded below the new window (someone is reading them)
    const syncList = async (actor, kind, full, keepOlder) => {
        const list = store.current[kind];
        const before = list.loaded ? maxId(list.items) : null;
        let next = (!full && list.loaded) ? await catchUp(actor, kind, list) : null;
        if (!next) {
            next = await reloadNewest(actor, kind);
            const low = minId(next.items);
            const older = keepOlder && low !== null ? list.items.filter((m) => m.id < low) : [];
            if (older.length && next.hasOlder) next = { ...next, items: [...next.items, ...older], hasOlder: list.hasOlder };
        }
        next.items = dedupe(next.items).sort(byNewest);
        return { next, newIds: before === null ? [] : next.items.filter((m) => m.id > before).map((m) => m.id.toString()) };
    };

    const legacySync = async (actor, includeLists) => {
        const me = identity.getPrincipal();
        const [count, seen] = await Promise.all([actor.get_recent_messages_count(me), actor.get_last_seen_messages_timestamp(me)]);
        setLegacyUnread(Number(count));
        store.current.lastSeen = seen.length ? seen[0] : 0n;
        setLastSeenFresh(true);
        if (!includeLists) return [];
        const [r, s] = await Promise.all([actor.get_received_messages(), actor.get_sent_messages()]);
        const prevMax = store.current.received.loaded ? maxId(store.current.received.items) : null;
        const toList = (items) => {
            const sorted = dedupe(items).sort(byNewest);
            return { items: sorted, total: sorted.length, lastUpdated: 0n, hasOlder: false, loaded: true };
        };
        store.current.received = toList(r);
        store.current.sent = toList(s);
        return prevMax === null ? [] : store.current.received.items.filter((m) => m.id > prevMax).map((m) => m.id.toString());
    };

    /// One sync at a time; a call during one waits for it (and a `full` one runs after it).
    /// `manual`: the user asked (Refresh): reread the newest pages and drop older pages loaded.
    const sync = useCallback(async ({ full = false, includeSent = false, manual = false } = {}) => {
        if (!principalRef.current || !actorRef.current) return;
        if (inflight.current) {
            await inflight.current.catch(() => {});
            if (!full && !manual && !includeSent) return;
        }
        const forPrincipal = principalRef.current;
        const actor = actorRef.current;
        const run = (async () => {
            setSyncing(true);
            try {
                const now = Date.now();
                const keepOlder = !manual && activeViewers.current > 0;
                const doFull = full || manual || now - lastFullAt.current >= FULL_RESYNC_MS;
                const doSent = includeSent || doFull || activeViewers.current > 0 || !store.current.sent.loaded || now - lastSentAt.current >= SENT_BACKGROUND_MS;
                let newIds = [];
                if (modeRef.current !== 'legacy') {
                    try {
                        const [r, s, seen] = await Promise.all([
                            syncList(actor, 'received', doFull, keepOlder),
                            doSent ? syncList(actor, 'sent', doFull, keepOlder) : null,
                            actor.get_last_seen_messages_timestamp(identity.getPrincipal()),
                        ]);
                        if (principalRef.current !== forPrincipal) return;
                        store.current.received = r.next;
                        if (s) { store.current.sent = s.next; lastSentAt.current = now; }
                        store.current.lastSeen = seen.length ? seen[0] : 0n;
                        setLastSeenFresh(true);
                        newIds = r.newIds;
                        if (doFull) lastFullAt.current = now;
                        if (modeRef.current !== 'paged') { modeRef.current = 'paged'; setMode('paged'); }
                    } catch (e) {
                        if (!isMissingMethod(e)) throw e;
                        modeRef.current = 'legacy';
                        setMode('legacy');
                    }
                }
                if (modeRef.current === 'legacy') {
                    newIds = await legacySync(actor, activeViewers.current > 0 || full || manual || includeSent);
                    if (principalRef.current !== forPrincipal) return;
                }
                if (newIds.length) {
                    const at = Date.now();
                    setArrivals((prev) => { const m = new Map(prev); newIds.forEach((id) => m.set(id, at)); return m; });
                }
                setError(null);
                setLastSynced(Date.now());
                publish();
                persist();
            } catch (e) {
                if (principalRef.current === forPrincipal) setError(e?.message || String(e));
            } finally {
                setSyncing(false);
            }
        })();
        inflight.current = run;
        try { await run; } finally { if (inflight.current === run) inflight.current = null; }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity, publish, persist]);

    // first sync for a principal, then polling while visible
    useEffect(() => {
        if (principal) sync();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [principal]);

    useEffect(() => {
        if (!principal) return undefined;
        const every = activeCount > 0 ? POLL_ACTIVE_MS : POLL_BACKGROUND_MS;
        const t = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            sync();
        }, every);
        return () => clearInterval(t);
    }, [principal, activeCount, sync]);

    useAppRefresh(() => { if (principalRef.current) sync(); }, { onVisible: true });

    /// Older messages of a list (or both, for 'all'), OLDER_PAGE at a time.
    const loadOlder = useCallback(async (which) => {
        const actor = actorRef.current;
        if (!actor || modeRef.current !== 'paged') return;
        const forPrincipal = principalRef.current;
        const kinds = which === 'all' ? ['received', 'sent'] : [which];
        await Promise.all(kinds.map(async (kind) => {
            const list = store.current[kind];
            if (!list.loaded || !list.hasOlder) return;
            const low = minId(list.items);
            const page = await pageCall(actor, kind, { before: low === null ? [] : [low], after: [], limit: BigInt(OLDER_PAGE) });
            if (principalRef.current !== forPrincipal) return;
            const cur = store.current[kind];
            store.current[kind] = { ...cur, items: dedupe([...cur.items, ...page.messages]).sort(byNewest), hasOlder: page.has_more };
        }));
        publish();
    }, [publish]);

    /// The caller left a message: drop it at once (the next sync confirms it).
    const removeLocal = useCallback((id) => {
        const key = BigInt(id).toString();
        for (const kind of ['received', 'sent']) {
            const list = store.current[kind];
            const items = list.items.filter((m) => m.id.toString() !== key);
            if (items.length !== list.items.length) store.current[kind] = { ...list, items, total: Math.max(0, list.total - 1) };
        }
        publish();
        persist();
    }, [publish, persist]);

    /// Marks received messages seen up to `ts` (ns); never moves the mark back.
    const markSeen = useCallback(async (ts) => {
        const actor = actorRef.current;
        if (!actor || ts === null || ts === undefined) return;
        const t = BigInt(ts);
        if (store.current.lastSeen !== null && t <= store.current.lastSeen) return;
        store.current.lastSeen = t;
        setLastSeen(t);
        setLegacyUnread(0);
        persist();
        try { await actor.mark_messages_seen_up_to(t); } catch (e) { console.warn('mark_messages_seen_up_to failed', e); }
    }, [persist]);

    /// A Messages page is open: poll faster and keep the sent list (and legacy full lists) current.
    const registerViewer = useCallback(() => {
        activeViewers.current += 1;
        setActiveCount(activeViewers.current);
        return () => { activeViewers.current = Math.max(0, activeViewers.current - 1); setActiveCount(activeViewers.current); };
    }, []);

    const unreadCount = useMemo(() => {
        if (!principal) return 0;
        if (mode === 'legacy' || (!received.loaded && legacyUnread !== null)) return legacyUnread ?? 0;
        if (!received.loaded || lastSeen === null) return 0;
        return received.items.filter((m) => m.created_at > lastSeen).length;
    }, [principal, mode, received, lastSeen, legacyUnread]);

    const value = useMemo(() => ({
        principal, received, sent, lastSeen, lastSeenFresh, unreadCount, mode, syncing, error, arrivals, lastSynced,
        sync, loadOlder, removeLocal, markSeen, registerViewer, getActor: () => actorRef.current,
    }), [principal, received, sent, lastSeen, lastSeenFresh, unreadCount, mode, syncing, error, arrivals, lastSynced, sync, loadOlder, removeLocal, markSeen, registerViewer]);

    return <SmsContext.Provider value={value}>{children}</SmsContext.Provider>;
}

/// The shared inbox. `{ active: true }` from a Messages page: faster polling and current sent list.
export function useSmsInbox({ active = false } = {}) {
    const ctx = useContext(SmsContext);
    const register = ctx?.registerViewer;
    useEffect(() => (active && register ? register() : undefined), [active, register]);
    return ctx;
}
