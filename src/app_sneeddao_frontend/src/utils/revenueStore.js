// A small keyed cache that outlives the page: /revenue, /rll_info and /rll_ledger read the same
// entries, so moving between them shows what is already loaded and only reloads what is stale.
//
// An entry is { value?, error?, at?, loading, progress? }. `load` starts a fetch unless the value
// is fresh or a fetch is already running (both callers then share it); a stale value stays visible
// while it is refreshed, so a card can render at once and fill in as data arrives.
import { useEffect, useSyncExternalStore } from 'react';

export const TTL = 10 * 60 * 1000;
const EMPTY = Object.freeze({ loading: false });
const entries = new Map();
const subscribers = new Set();
let version = 0;

const emit = () => { version++; subscribers.forEach((f) => f()); };
const patch = (key, p) => { entries.set(key, { ...(entries.get(key) || EMPTY), ...p }); emit(); };
const subscribe = (f) => { subscribers.add(f); return () => subscribers.delete(f); };
const promises = new Map();

/// The entry as it stands now, without loading anything.
export const peek = (key) => entries.get(key) || EMPTY;
export const hasValue = (e) => e && 'value' in e;

/// Loads `key` with `fetcher(onProgress)` unless it is fresh or already loading; resolves to the value.
export function load(key, fetcher, { ttl = TTL, force = false } = {}) {
    if (promises.has(key)) return promises.get(key);
    const e = peek(key);
    if (!force && hasValue(e) && Date.now() - e.at < ttl) return Promise.resolve(e.value);
    const promise = Promise.resolve()
        .then(() => fetcher((progress) => patch(key, { progress })))
        .then(
            (value) => { promises.delete(key); patch(key, { value, error: null, at: Date.now(), loading: false, progress: null }); return value; },
            (err) => { promises.delete(key); patch(key, { error: err?.message || String(err), loading: false, progress: null }); throw err; },
        );
    promises.set(key, promise);
    patch(key, { loading: true });
    return promise;
}

/// Re-renders the caller whenever any entry changes; read entries with `peek` during render.
export function useStoreVersion() {
    return useSyncExternalStore(subscribe, () => version);
}

/// One entry, loaded on mount (and when `key` changes) while `enabled`.
export function useResource(key, fetcher, { enabled = true, ttl = TTL } = {}) {
    const entry = useSyncExternalStore(subscribe, () => (key ? peek(key) : EMPTY));
    useEffect(() => {
        if (enabled && key) load(key, fetcher, { ttl }).catch(() => {});
    }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
    return entry;
}
