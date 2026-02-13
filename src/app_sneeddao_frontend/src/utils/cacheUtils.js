/**
 * Shared cache clearing utilities.
 * Used by Me page settings and by the frontend update refresh flow.
 * 
 * TWO-PHASE CACHE CLEARING:
 * 
 * indexedDB.deleteDatabase() is cooperative — it fires a "blocked" event and
 * waits when the app has open connections (which it always does from hooks
 * like useTokenCache, useWalletCache, etc.). The browser's "Clear site data"
 * is privileged and can force-close connections; JavaScript cannot.
 * 
 * The old approach tried to delete IndexedDB databases while the app was
 * running. This always got blocked (or timed out), leaving databases intact
 * while localStorage was already cleared — creating a broken state on reload
 * where stale IndexedDB data clashed with empty localStorage.
 * 
 * The fix is a two-phase approach:
 *   Phase 1 (clearAllCaches): Clears localStorage, sessionStorage, Cache API,
 *     and sets a "pending clear" flag. Skips IndexedDB entirely.
 *   Phase 2 (completePendingCacheClear): Runs on the NEXT page load, BEFORE
 *     React mounts. No hooks have opened connections yet, so deleteDatabase()
 *     succeeds instantly. Then the app starts fresh.
 */
import { clearSnsCache } from './SnsUtils';

const CACHE_DB_NAMES = [
    'sneed_wallet_cache',
    'sneed_logo_cache',
    'sneed_token_cache',
    'NeuronsDB',           // Shared neurons cache from useNeuronsCache.js
    'sneed_rewards_cache', // Rewards cache from useRewardsCache.js
    'sneed_locks_cache',   // Locks cache from useLocksCache.js
];

/** Internet Identity auth databases — skipped by clearAllCaches, wiped by nuclear */
const AUTH_DB_NAMES = new Set(['auth-client-db', 'ic-keyval']);

/** localStorage key used to signal that IndexedDB cleanup is pending */
const PENDING_CACHE_CLEAR_KEY = '__sneed_pending_cache_clear';

/**
 * Race a promise against a timeout. Resolves with the promise result or
 * rejects with a timeout error — never hangs.
 */
const withTimeout = (promise, ms, label = 'operation') =>
    Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        ),
    ]);

/** Per-operation timeout for IndexedDB deletions */
const IDB_DELETE_TIMEOUT_MS = 5000;

/**
 * Attempt to delete a single IndexedDB database by name.
 * Times out after IDB_DELETE_TIMEOUT_MS if the deletion is blocked by open connections.
 * @param {string} dbName
 * @returns {Promise<void>}
 */
const deleteIndexedDB = (dbName) =>
    withTimeout(
        new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = () => { console.log(`[Cache] Deleted IndexedDB: ${dbName}`); resolve(); };
            request.onerror = () => reject(request.error);
            request.onblocked = () => {
                console.warn(`[Cache] Delete blocked for: ${dbName} (open connections exist)`);
                resolve(); // Don't hang — best-effort
            };
        }),
        IDB_DELETE_TIMEOUT_MS,
        `deleteDatabase(${dbName})`
    );

/**
 * Phase 2: Complete any pending cache clear from the previous page session.
 * 
 * MUST be called BEFORE React mounts (i.e. in main.jsx), so no hooks have
 * opened IndexedDB connections yet. This allows deleteDatabase() to succeed
 * immediately without being blocked.
 * 
 * @returns {Promise<boolean>} true if a pending clear was found and processed
 */
export const completePendingCacheClear = async () => {
    try {
        const pending = localStorage.getItem(PENDING_CACHE_CLEAR_KEY);
        if (!pending) return false;

        // Remove the flag first so we don't loop on repeated failures
        localStorage.removeItem(PENDING_CACHE_CLEAR_KEY);

        // 'nuclear' means include auth databases; 'app' means skip them
        const isNuclear = pending === 'nuclear';
        console.log(`[Cache] Phase 2: Completing pending ${isNuclear ? 'nuclear ' : ''}cache clear...`);

        // 1. Delete all known app IndexedDB databases
        for (const dbName of CACHE_DB_NAMES) {
            try {
                await deleteIndexedDB(dbName);
            } catch (e) {
                console.warn(`[Cache] Phase 2: Failed to delete ${dbName}:`, e.message);
            }
        }

        // 2. Enumerate and delete any other IndexedDB databases
        try {
            if (typeof indexedDB.databases === 'function') {
                const allDbs = await withTimeout(indexedDB.databases(), 3000, 'indexedDB.databases()');
                const knownSet = new Set(CACHE_DB_NAMES);
                for (const db of allDbs) {
                    if (!db.name) continue;
                    if (knownSet.has(db.name)) continue; // already handled above
                    if (!isNuclear && AUTH_DB_NAMES.has(db.name)) continue; // preserve auth unless nuclear
                    try {
                        await deleteIndexedDB(db.name);
                    } catch (e) {
                        console.warn(`[Cache] Phase 2: Failed to delete ${db.name}:`, e.message);
                    }
                }
            }
        } catch (e) {
            console.warn('[Cache] Phase 2: Failed to enumerate databases:', e.message);
        }

        // 3. If nuclear, also clear auth databases explicitly (in case databases() isn't supported)
        if (isNuclear) {
            for (const dbName of AUTH_DB_NAMES) {
                try {
                    await deleteIndexedDB(dbName);
                } catch (e) {
                    console.warn(`[Cache] Phase 2: Failed to delete auth DB ${dbName}:`, e.message);
                }
            }
        }

        console.log('[Cache] Phase 2: Pending cache clear completed successfully');
        return true;
    } catch (e) {
        console.error('[Cache] Phase 2 failed:', e);
        return false;
    }
};

/**
 * Phase 1: Clear all app caches that can be cleared while the app is running
 * (localStorage, sessionStorage, in-memory caches, Cache API), then set a
 * flag so that IndexedDB cleanup happens on the next page load (Phase 2).
 * 
 * Does NOT attempt IndexedDB deletion — those always get blocked by open
 * connections from React hooks and either time out or leave the DB intact.
 * 
 * Does NOT clear cookies or Internet Identity auth storage (user stays logged in).
 * Does not reload the page — caller should handle that.
 * @returns {Promise<void>}
 */
export const clearAllCaches = async () => {
    // === Synchronous / instant operations ===

    // 1. Clear ALL localStorage
    try {
        localStorage.clear();
        console.log('[Cache] localStorage cleared');
    } catch (e) {
        console.warn('[Cache] Failed to clear localStorage:', e);
    }

    // 2. Clear ALL sessionStorage
    try {
        sessionStorage.clear();
        console.log('[Cache] sessionStorage cleared');
    } catch (e) {
        console.warn('[Cache] Failed to clear sessionStorage:', e);
    }

    // 3. Clear SNS in-memory module state
    try {
        clearSnsCache();
    } catch (e) {
        console.warn('[Cache] Failed to clear SNS cache:', e);
    }

    // === Async operations ===

    // 4. Clear all Cache API storage (not blocked by IndexedDB connections)
    try {
        if ('caches' in window) {
            const cacheNames = await withTimeout(caches.keys(), 3000, 'caches.keys()');
            for (const name of cacheNames) {
                try {
                    await withTimeout(caches.delete(name), 2000, `caches.delete(${name})`);
                    console.log(`[Cache] Deleted Cache API: ${name}`);
                } catch (e) {
                    console.warn(`[Cache] Failed to delete cache ${name}:`, e.message);
                }
            }
        }
    } catch (e) {
        console.warn('[Cache] Failed to clear Cache API:', e.message);
    }

    // 5. Set pending flag so Phase 2 cleans up IndexedDB on next page load.
    //    This is set AFTER localStorage.clear() so it survives into the next session.
    //    Value 'app' means: delete app caches only (preserve auth databases).
    try {
        localStorage.setItem(PENDING_CACHE_CLEAR_KEY, 'app');
        console.log('[Cache] Set pending cache clear flag (IndexedDB will be cleaned on next load)');
    } catch (e) {
        console.warn('[Cache] Failed to set pending cache clear flag:', e);
    }

    console.log('[Cache] Phase 1 clearAllCaches completed');
};

/**
 * Nuclear option: clear ALL site data, equivalent to browser DevTools
 * Application > Storage > "Clear site data".
 * 
 * Phase 1: Wipes ALL localStorage, ALL sessionStorage, ALL Cache API storage,
 * unregisters service workers, clears cookies, and sets a 'nuclear' pending
 * flag for IndexedDB cleanup on next load (Phase 2).
 * 
 * The user WILL be logged out (auth databases are included in the nuclear clear).
 * Does not reload the page — caller should handle that.
 * @returns {Promise<{errors: string[]}>} Any non-fatal errors encountered.
 */
export const nuclearClearAllSiteData = async () => {
    const errors = [];

    // === Synchronous / instant operations first (these never hang) ===

    // 1. Clear ALL localStorage
    try {
        localStorage.clear();
        console.log('[NuclearClear] localStorage cleared');
    } catch (e) {
        errors.push(`localStorage: ${e.message}`);
    }

    // 2. Clear ALL sessionStorage
    try {
        sessionStorage.clear();
        console.log('[NuclearClear] sessionStorage cleared');
    } catch (e) {
        errors.push(`sessionStorage: ${e.message}`);
    }

    // 3. Clear cookies for this origin
    try {
        document.cookie.split(';').forEach(cookie => {
            const name = cookie.split('=')[0].trim();
            if (name) {
                document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
            }
        });
        console.log('[NuclearClear] Cookies cleared');
    } catch (e) {
        errors.push(`Cookies: ${e.message}`);
    }

    // === Async operations — all timeout-protected ===

    // 4. Clear all Cache API storage
    try {
        if ('caches' in window) {
            const cacheNames = await withTimeout(caches.keys(), 3000, 'caches.keys()');
            for (const name of cacheNames) {
                try {
                    await withTimeout(caches.delete(name), 2000, `caches.delete(${name})`);
                    console.log(`[NuclearClear] Deleted Cache API: ${name}`);
                } catch (e) {
                    errors.push(`Cache API ${name}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        errors.push(`Cache API: ${e.message}`);
    }

    // 5. Unregister all service workers
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await withTimeout(
                navigator.serviceWorker.getRegistrations(), 3000, 'getRegistrations'
            );
            for (const reg of registrations) {
                try {
                    await withTimeout(reg.unregister(), 2000, `unregister(${reg.scope})`);
                    console.log(`[NuclearClear] Unregistered service worker: ${reg.scope}`);
                } catch (e) {
                    errors.push(`Service worker ${reg.scope}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        errors.push(`Service workers: ${e.message}`);
    }

    // 6. Set 'nuclear' pending flag so Phase 2 deletes ALL IndexedDB databases
    //    (including auth) on next page load, before any connections are opened.
    try {
        localStorage.setItem(PENDING_CACHE_CLEAR_KEY, 'nuclear');
        console.log('[NuclearClear] Set nuclear pending cache clear flag');
    } catch (e) {
        errors.push(`Pending flag: ${e.message}`);
    }

    if (errors.length > 0) {
        console.warn('[NuclearClear] Phase 1 completed with some errors:', errors);
    } else {
        console.log('[NuclearClear] Phase 1 completed (IndexedDB will be cleared on next load)');
    }

    return { errors };
};
