/**
 * Locks Cache - Caches detailed token lock information per user
 * 
 * Uses IndexedDB for persistent storage:
 * - Detailed locks (individual locks with expiry dates) stored per user principal
 * - Provides instant loading from cache, then silent background validation
 */

import { normalizeId } from './useNeuronsCache';

const LOCKS_DB_NAME = 'sneed_locks_cache';
const LOCKS_DB_VERSION = 1;
const LOCKS_STORE = 'detailedLocks';

// In-memory cache for fast access
const locksMemoryCache = new Map(); // userPrincipal -> { ledgerId -> [locks] }

let dbPromise = null;

// Initialize IndexedDB
const initializeDB = () => {
    if (dbPromise) return dbPromise;
    
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(LOCKS_DB_NAME, LOCKS_DB_VERSION);
        
        request.onerror = () => {
            console.error('[LocksCache] Failed to open IndexedDB:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            resolve(request.result);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Locks store (per user principal)
            if (!db.objectStoreNames.contains(LOCKS_STORE)) {
                db.createObjectStore(LOCKS_STORE, { keyPath: 'userPrincipal' });
            }
        };
    });
    
    return dbPromise;
};

/**
 * Get cached locks for a user (memory first, then IndexedDB)
 * Returns: { ledgerId: [{lock_id, amount, expiry}, ...], ... } or null if not cached
 */
export const getCachedLocks = async (userPrincipal) => {
    if (!userPrincipal) return null;
    
    const key = normalizeId(userPrincipal);
    
    // Check memory cache first
    if (locksMemoryCache.has(key)) {
        return locksMemoryCache.get(key);
    }
    
    // Try IndexedDB
    try {
        const db = await initializeDB();
        
        return new Promise((resolve) => {
            const transaction = db.transaction([LOCKS_STORE], 'readonly');
            const store = transaction.objectStore(LOCKS_STORE);
            const request = store.get(key);
            
            request.onsuccess = () => {
                if (request.result) {
                    // Convert stored data back to proper types
                    const locks = {};
                    const storedLocks = request.result.locks || {};
                    for (const [ledgerId, lockList] of Object.entries(storedLocks)) {
                        locks[ledgerId] = lockList.map(lock => ({
                            lock_id: BigInt(lock.lock_id),
                            amount: BigInt(lock.amount),
                            expiry: new Date(lock.expiry)
                        }));
                    }
                    locksMemoryCache.set(key, locks);
                    resolve(locks);
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => {
                console.warn('[LocksCache] Failed to read from IndexedDB');
                resolve(null);
            };
        });
    } catch (error) {
        console.warn('[LocksCache] Error reading cache:', error);
        return null;
    }
};

/**
 * Save locks to cache (memory and IndexedDB)
 * @param userPrincipal - User's principal
 * @param locks - Object mapping ledgerId -> array of lock objects
 */
export const setCachedLocks = async (userPrincipal, locks) => {
    if (!userPrincipal || !locks) return;
    
    const key = normalizeId(userPrincipal);
    
    // Update memory cache
    locksMemoryCache.set(key, locks);
    
    // Convert to storable format (BigInt to strings, Date to ISO strings)
    const storedLocks = {};
    for (const [ledgerId, lockList] of Object.entries(locks)) {
        storedLocks[ledgerId] = lockList.map(lock => ({
            lock_id: lock.lock_id.toString(),
            amount: lock.amount.toString(),
            expiry: lock.expiry.toISOString()
        }));
    }
    
    // Save to IndexedDB
    try {
        const db = await initializeDB();
        
        const transaction = db.transaction([LOCKS_STORE], 'readwrite');
        const store = transaction.objectStore(LOCKS_STORE);
        
        store.put({
            userPrincipal: key,
            locks: storedLocks,
            updatedAt: Date.now()
        });
    } catch (error) {
        console.warn('[LocksCache] Failed to save to IndexedDB:', error);
    }
};

/**
 * Clear cached locks for a user
 */
export const clearCachedLocks = async (userPrincipal) => {
    if (!userPrincipal) return;
    
    const key = normalizeId(userPrincipal);
    
    // Clear memory cache
    locksMemoryCache.delete(key);
    
    // Clear IndexedDB
    try {
        const db = await initializeDB();
        
        const transaction = db.transaction([LOCKS_STORE], 'readwrite');
        const store = transaction.objectStore(LOCKS_STORE);
        store.delete(key);
    } catch (error) {
        console.warn('[LocksCache] Failed to clear from IndexedDB:', error);
    }
};

/**
 * Get cached locks synchronously from memory only
 * Returns null if not in memory cache
 */
export const getCachedLocksSync = (userPrincipal) => {
    if (!userPrincipal) return null;
    const key = normalizeId(userPrincipal);
    return locksMemoryCache.get(key) || null;
};
