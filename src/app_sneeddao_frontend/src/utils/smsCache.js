// Per-principal cache of the Sneed SMS inbox and sent lists (IndexedDB 'sneed_sms_cache'), so the
// inbox shows at once on the next visit. One record per canister + principal, never shared between
// principals; the newest MAX_PER_LIST messages of each list and at most MAX_TEXT_CHARS of subject and
// text in all (older messages are fetched page by page when asked for). Principals are stored as
// text (structured clone drops the Principal class); bigints are kept as they are. Every access is
// best effort: private windows, blocked storage or a broken database just mean no cache.
import { Principal } from '@dfinity/principal';

export const SMS_CACHE_DB = 'sneed_sms_cache';
const STORE = 'inbox';
const VERSION = 1;
export const MAX_PER_LIST = 200;
const MAX_TEXT_CHARS = 3_000_000;

let dbPromise = null;
function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        try {
            if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
            const req = indexedDB.open(SMS_CACHE_DB, VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
            };
            req.onsuccess = () => {
                const db = req.result;
                db.onversionchange = () => { db.close(); dbPromise = null; }; // let a cache clear delete it
                resolve(db);
            };
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error('sms cache blocked'));
        } catch (e) { reject(e); }
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
}

async function run(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE], mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export const cacheKey = (canisterId, principal) => `${canisterId}:${principal}`;

const toStored = (m) => ({
    ...m,
    sender: m.sender.toString(),
    recipients: m.recipients.map((r) => r.toString()),
});
const fromStored = (m) => ({
    ...m,
    sender: Principal.fromText(m.sender),
    recipients: m.recipients.map((r) => Principal.fromText(r)),
});

/// Trims a list (newest first) to the cache's bounds; `budget` is the text allowance left.
function trim(items, budget) {
    const out = [];
    for (const m of items.slice(0, MAX_PER_LIST)) {
        const size = (m.subject?.length || 0) + (m.body?.length || 0);
        if (out.length > 0 && size > budget.left) break;
        budget.left -= size;
        out.push(m);
    }
    return out;
}

/// { received, sent } with { items, total, lastUpdated, hasOlder } each, plus lastSeen; or null.
export async function loadSmsCache(key) {
    try {
        const rec = await run('readonly', (s) => s.get(key));
        if (!rec || rec.v !== VERSION) return null;
        const list = (l) => (l ? { ...l, items: (l.items || []).map(fromStored) } : null);
        return { received: list(rec.received), sent: list(rec.sent), lastSeen: rec.lastSeen ?? null, savedAt: rec.savedAt };
    } catch (e) {
        return null;
    }
}

export async function saveSmsCache(key, { received, sent, lastSeen }) {
    try {
        const budget = { left: MAX_TEXT_CHARS };
        const list = (l) => {
            if (!l) return null;
            const items = trim(l.items, budget);
            return { total: l.total, lastUpdated: l.lastUpdated, hasOlder: l.hasOlder || items.length < l.items.length, items: items.map(toStored) };
        };
        // received first: the inbox gets the text budget before the sent list
        const rec = { key, v: VERSION, received: list(received), sent: list(sent), lastSeen: lastSeen ?? null, savedAt: Date.now() };
        await run('readwrite', (s) => s.put(rec));
    } catch (e) {
        // no cache this time
    }
}

export async function deleteSmsCache(key) {
    try { await run('readwrite', (s) => s.delete(key)); } catch (e) { /* nothing to delete */ }
}
