/**
 * Shared cache clearing utilities.
 * Used by Me page settings and by the frontend update refresh flow.
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

/**
 * Delete a single IndexedDB database by name, with blocked-handling.
 * @param {string} dbName
 * @returns {Promise<void>}
 */
const deleteIndexedDB = (dbName) => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => { console.log(`[Cache] Deleted IndexedDB: ${dbName}`); resolve(); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { console.warn(`[Cache] Delete blocked for: ${dbName}`); resolve(); };
});

/**
 * Clear all app caches: all known IndexedDB databases, any unknown IndexedDB
 * databases, all localStorage, sessionStorage, and Cache API storage.
 * Does NOT clear cookies or Internet Identity auth storage (user stays logged in).
 * Does not reload the page - caller should handle that.
 * @returns {Promise<void>}
 */
export const clearAllCaches = async () => {
    // 1. Delete all known IndexedDB databases
    for (const dbName of CACHE_DB_NAMES) {
        try {
            await deleteIndexedDB(dbName);
        } catch (e) {
            console.warn(`[Cache] Failed to delete ${dbName}:`, e);
        }
    }

    // 2. Enumerate and delete any OTHER IndexedDB databases we might not know about
    //    (but skip Internet Identity auth databases so user stays logged in)
    const AUTH_DB_NAMES = new Set(['auth-client-db', 'ic-keyval']);
    try {
        if (typeof indexedDB.databases === 'function') {
            const allDbs = await indexedDB.databases();
            const knownSet = new Set(CACHE_DB_NAMES);
            for (const db of allDbs) {
                if (db.name && !knownSet.has(db.name) && !AUTH_DB_NAMES.has(db.name)) {
                    try {
                        await deleteIndexedDB(db.name);
                    } catch (e) {
                        console.warn(`[Cache] Failed to delete unknown DB ${db.name}:`, e);
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[Cache] Failed to enumerate IndexedDB databases:', e);
    }

    // 3. Clear token cache (IndexedDB + in-memory)
    try {
        await clearTokenCache();
    } catch (e) {
        console.warn('[Cache] Failed to clear token cache:', e);
    }

    // 4. Clear SNS cache (localStorage)
    try {
        clearSnsCache();
    } catch (e) {
        console.warn('[Cache] Failed to clear SNS cache:', e);
    }

    // 5. Clear ALL localStorage (not just matching patterns)
    try {
        localStorage.clear();
        console.log('[Cache] localStorage cleared');
    } catch (e) {
        console.warn('[Cache] Failed to clear localStorage:', e);
    }

    // 6. Clear ALL sessionStorage
    try {
        sessionStorage.clear();
        console.log('[Cache] sessionStorage cleared');
    } catch (e) {
        console.warn('[Cache] Failed to clear sessionStorage:', e);
    }

    // 7. Clear all Cache API storage
    try {
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                await caches.delete(name);
                console.log(`[Cache] Deleted Cache API: ${name}`);
            }
        }
    } catch (e) {
        console.warn('[Cache] Failed to clear Cache API:', e);
    }
};

/**
 * Nuclear option: clear ALL site data, equivalent to browser DevTools
 * Application > Storage > "Clear site data".
 * 
 * This wipes ALL IndexedDB databases (including auth), ALL localStorage,
 * ALL sessionStorage, ALL Cache API storage, unregisters service workers,
 * and clears cookies. The user WILL be logged out.
 * 
 * Does not reload the page - caller should handle that.
 * @returns {Promise<{errors: string[]}>} Any non-fatal errors encountered.
 */
export const nuclearClearAllSiteData = async () => {
    const errors = [];

    // 1. Delete ALL IndexedDB databases (including auth databases)
    try {
        if (typeof indexedDB.databases === 'function') {
            const dbs = await indexedDB.databases();
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
            const allKnown = [
                ...CACHE_DB_NAMES,
                'auth-client-db',   // Internet Identity auth client
                'ic-keyval',        // @dfinity/auth-client key-value store
            ];
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

    // 2. Clear ALL localStorage
    try {
        localStorage.clear();
        console.log('[NuclearClear] localStorage cleared');
    } catch (e) {
        errors.push(`localStorage: ${e.message}`);
    }

    // 3. Clear ALL sessionStorage
    try {
        sessionStorage.clear();
        console.log('[NuclearClear] sessionStorage cleared');
    } catch (e) {
        errors.push(`sessionStorage: ${e.message}`);
    }

    // 4. Clear all Cache API storage
    try {
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                await caches.delete(name);
                console.log(`[NuclearClear] Deleted Cache API: ${name}`);
            }
        }
    } catch (e) {
        errors.push(`Cache API: ${e.message}`);
    }

    // 5. Unregister all service workers
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const reg of registrations) {
                await reg.unregister();
                console.log(`[NuclearClear] Unregistered service worker: ${reg.scope}`);
            }
        }
    } catch (e) {
        errors.push(`Service workers: ${e.message}`);
    }

    // 6. Clear cookies for this origin
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

    if (errors.length > 0) {
        console.warn('[NuclearClear] Completed with errors:', errors);
    } else {
        console.log('[NuclearClear] All site data cleared successfully');
    }

    return { errors };
};
