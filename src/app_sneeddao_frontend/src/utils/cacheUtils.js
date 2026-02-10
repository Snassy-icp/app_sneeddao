/**
 * Shared cache clearing utilities.
 * Used by Me page settings and by the frontend update refresh flow.
 * 
 * IMPORTANT: indexedDB.deleteDatabase() is cooperative — it fires a "blocked"
 * event and waits when the app has open connections (which it always does from
 * hooks like useTokenCache, useWalletCache, etc.). The browser's "Clear site
 * data" is privileged and can force-close connections. From JavaScript, we
 * cannot do that, so every IndexedDB deletion must have a timeout to prevent
 * hanging. The page reload after clearing will close all connections, and any
 * databases that were blocked will be orphaned / unused on the fresh load.
 */
import { clearTokenCache } from '../hooks/useTokenCache';
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

/** Per-operation timeout for IndexedDB deletions (seconds) */
const IDB_DELETE_TIMEOUT_MS = 3000;

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
                console.warn(`[Cache] Delete blocked for: ${dbName} (open connections exist, will be cleared on reload)`);
                resolve(); // Don't hang — the page reload will close connections
            };
        }),
        IDB_DELETE_TIMEOUT_MS,
        `deleteDatabase(${dbName})`
    );

/**
 * Clear all app caches: all known IndexedDB databases, any unknown IndexedDB
 * databases, all localStorage, sessionStorage, and Cache API storage.
 * Does NOT clear cookies or Internet Identity auth storage (user stays logged in).
 * 
 * All operations are timeout-protected so this function always completes,
 * even if IndexedDB has open connections that block deletion.
 * Does not reload the page — caller should handle that.
 * @returns {Promise<void>}
 */
export const clearAllCaches = async () => {
    // === Synchronous / instant operations first ===

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

    // 3. Clear SNS cache (in-memory + localStorage, already cleared above but this resets module state)
    try {
        clearSnsCache();
    } catch (e) {
        console.warn('[Cache] Failed to clear SNS cache:', e);
    }

    // === Async operations with timeouts ===

    // 4. Clear token cache (IndexedDB + in-memory state)
    try {
        await withTimeout(clearTokenCache(), 3000, 'clearTokenCache');
    } catch (e) {
        console.warn('[Cache] Failed to clear token cache:', e);
    }

    // 5. Delete all known IndexedDB databases (timeout-protected)
    for (const dbName of CACHE_DB_NAMES) {
        try {
            await deleteIndexedDB(dbName);
        } catch (e) {
            console.warn(`[Cache] Failed to delete ${dbName}:`, e.message);
        }
    }

    // 6. Enumerate and delete any OTHER IndexedDB databases we might not know about
    //    (but skip Internet Identity auth databases so user stays logged in)
    try {
        if (typeof indexedDB.databases === 'function') {
            const allDbs = await withTimeout(indexedDB.databases(), 3000, 'indexedDB.databases()');
            const knownSet = new Set(CACHE_DB_NAMES);
            for (const db of allDbs) {
                if (db.name && !knownSet.has(db.name) && !AUTH_DB_NAMES.has(db.name)) {
                    try {
                        await deleteIndexedDB(db.name);
                    } catch (e) {
                        console.warn(`[Cache] Failed to delete unknown DB ${db.name}:`, e.message);
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[Cache] Failed to enumerate IndexedDB databases:', e.message);
    }

    // 7. Clear all Cache API storage
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

    console.log('[Cache] clearAllCaches completed');
};

/**
 * Nuclear option: clear ALL site data, equivalent to browser DevTools
 * Application > Storage > "Clear site data".
 * 
 * This wipes ALL IndexedDB databases (including auth), ALL localStorage,
 * ALL sessionStorage, ALL Cache API storage, unregisters service workers,
 * and clears cookies. The user WILL be logged out.
 * 
 * All operations are timeout-protected so this function always completes
 * quickly, even if IndexedDB deletions are blocked by open connections.
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

    // 6. Delete ALL IndexedDB databases (including auth databases)
    //    These may block if the app has open connections — timeout ensures we don't hang.
    //    The page reload after this function will close all connections.
    try {
        if (typeof indexedDB.databases === 'function') {
            const dbs = await withTimeout(indexedDB.databases(), 3000, 'indexedDB.databases()');
            for (const db of dbs) {
                if (db.name) {
                    try {
                        await deleteIndexedDB(db.name);
                    } catch (e) {
                        errors.push(`IndexedDB ${db.name}: ${e.message}`);
                    }
                }
            }
        } else {
            // Fallback: delete all known databases + auth databases
            const allKnown = [...CACHE_DB_NAMES, 'auth-client-db', 'ic-keyval'];
            for (const dbName of allKnown) {
                try {
                    await deleteIndexedDB(dbName);
                } catch (e) {
                    errors.push(`IndexedDB ${dbName}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        errors.push(`IndexedDB enumeration: ${e.message}`);
    }

    if (errors.length > 0) {
        console.warn('[NuclearClear] Completed with some errors/timeouts:', errors);
    } else {
        console.log('[NuclearClear] All site data cleared successfully');
    }

    return { errors };
};
