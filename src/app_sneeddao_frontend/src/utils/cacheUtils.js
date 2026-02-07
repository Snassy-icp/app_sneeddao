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
