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
    'NeuronsDB',  // Shared neurons cache from useNeuronsCache.js
];

const CACHE_KEY_PATTERNS = [
    key => key?.includes('wallet_cache'),
    key => key?.includes('sns_cache') || key === 'sns_data_cache',  // SNS cache (localStorage)
    key => key?.includes('sneed_'),
    key => key?.startsWith('neuronsCache_'),  // Old NeuronsContext localStorage cache
];

/**
 * Clear all IndexedDB and localStorage caches.
 * Does not reload the page - caller should handle that.
 * @returns {Promise<void>}
 */
export const clearAllCaches = async () => {
    for (const dbName of CACHE_DB_NAMES) {
        try {
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(dbName);
                request.onsuccess = () => {
                    console.log(`[Cache] Deleted ${dbName}`);
                    resolve();
                };
                request.onerror = () => reject(request.error);
                request.onblocked = () => {
                    console.warn(`[Cache] Delete blocked for ${dbName}`);
                    resolve(); // Continue anyway
                };
            });
        } catch (e) {
            console.warn(`[Cache] Failed to delete ${dbName}:`, e);
        }
    }

    // Clear token cache (IndexedDB + in-memory)
    try {
        await clearTokenCache();
    } catch (e) {
        console.warn('[Cache] Failed to clear token cache:', e);
    }

    // Clear SNS cache (localStorage)
    try {
        clearSnsCache();
    } catch (e) {
        console.warn('[Cache] Failed to clear SNS cache:', e);
    }

    // Clear localStorage caches
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && CACHE_KEY_PATTERNS.some(fn => fn(key))) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
};

/**
 * Nuclear option: clear ALL site data, equivalent to browser DevTools
 * Application > Storage > "Clear site data".
 * 
 * This wipes ALL IndexedDB databases (not just known ones), ALL localStorage,
 * ALL sessionStorage, ALL Cache API storage, unregisters service workers,
 * and clears cookies. The user WILL be logged out.
 * 
 * Does not reload the page - caller should handle that.
 * @returns {Promise<{errors: string[]}>} Any non-fatal errors encountered.
 */
export const nuclearClearAllSiteData = async () => {
    const errors = [];

    // 1. Delete ALL IndexedDB databases (not just known ones)
    try {
        if (typeof indexedDB.databases === 'function') {
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
                if (db.name) {
                    try {
                        await new Promise((resolve, reject) => {
                            const req = indexedDB.deleteDatabase(db.name);
                            req.onsuccess = () => { console.log(`[NuclearClear] Deleted IndexedDB: ${db.name}`); resolve(); };
                            req.onerror = () => reject(req.error);
                            req.onblocked = () => { console.warn(`[NuclearClear] Delete blocked: ${db.name}`); resolve(); };
                        });
                    } catch (e) {
                        errors.push(`IndexedDB ${db.name}: ${e.message}`);
                    }
                }
            }
        } else {
            // Fallback: delete all known databases + common ICP-related ones
            const allKnown = [
                ...CACHE_DB_NAMES,
                'sneed_rewards_cache',
                'sneed_locks_cache',
                'auth-client-db',           // Internet Identity auth client
                'ic-keyval',                // @dfinity/auth-client key-value store
            ];
            for (const dbName of allKnown) {
                try {
                    await new Promise((resolve, reject) => {
                        const req = indexedDB.deleteDatabase(dbName);
                        req.onsuccess = () => { console.log(`[NuclearClear] Deleted IndexedDB: ${dbName}`); resolve(); };
                        req.onerror = () => reject(req.error);
                        req.onblocked = () => { console.warn(`[NuclearClear] Delete blocked: ${dbName}`); resolve(); };
                    });
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

    // 4. Clear all Cache API storage (used by service workers / fetch caching)
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
