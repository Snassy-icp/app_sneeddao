/**
 * Rewards Cache - Caches RLL reward balances per user
 * 
 * Uses IndexedDB for persistent storage:
 * - Rewards are stored per user principal
 * - Provides instant loading from cache, then silent background validation
 */

import { normalizeId } from './useNeuronsCache';

const REWARDS_DB_NAME = 'sneed_rewards_cache';
const REWARDS_DB_VERSION = 1;
const REWARDS_STORE = 'rewardBalances';

// In-memory cache for fast access
const rewardsMemoryCache = new Map(); // userPrincipal -> { ledgerId -> balance }

let dbPromise = null;

// Initialize IndexedDB
const initializeDB = () => {
    if (dbPromise) return dbPromise;
    
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(REWARDS_DB_NAME, REWARDS_DB_VERSION);
        
        request.onerror = () => {
            console.error('[RewardsCache] Failed to open IndexedDB:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            resolve(request.result);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Rewards store (per user principal)
            if (!db.objectStoreNames.contains(REWARDS_STORE)) {
                db.createObjectStore(REWARDS_STORE, { keyPath: 'userPrincipal' });
            }
        };
    });
    
    return dbPromise;
};

/**
 * Get cached rewards for a user (memory first, then IndexedDB)
 * Returns: { ledgerId: balance (BigInt), ... } or null if not cached
 */
export const getCachedRewards = async (userPrincipal) => {
    if (!userPrincipal) return null;
    
    const key = normalizeId(userPrincipal);
    
    // Check memory cache first
    if (rewardsMemoryCache.has(key)) {
        return rewardsMemoryCache.get(key);
    }
    
    // Try IndexedDB
    try {
        const db = await initializeDB();
        
        return new Promise((resolve) => {
            const transaction = db.transaction([REWARDS_STORE], 'readonly');
            const store = transaction.objectStore(REWARDS_STORE);
            const request = store.get(key);
            
            request.onsuccess = () => {
                if (request.result) {
                    // Convert stored strings back to BigInt
                    const rewards = {};
                    const storedRewards = request.result.rewards || {};
                    for (const [ledgerId, balance] of Object.entries(storedRewards)) {
                        rewards[ledgerId] = BigInt(balance);
                    }
                    rewardsMemoryCache.set(key, rewards);
                    resolve(rewards);
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => {
                console.warn('[RewardsCache] Failed to read from IndexedDB');
                resolve(null);
            };
        });
    } catch (error) {
        console.warn('[RewardsCache] Error reading cache:', error);
        return null;
    }
};

/**
 * Save rewards to cache (memory and IndexedDB)
 * @param userPrincipal - User's principal
 * @param rewards - Object mapping ledgerId -> balance (BigInt)
 */
export const setCachedRewards = async (userPrincipal, rewards) => {
    if (!userPrincipal || !rewards) return;
    
    const key = normalizeId(userPrincipal);
    
    // Update memory cache
    rewardsMemoryCache.set(key, rewards);
    
    // Convert BigInt to strings for IndexedDB storage
    const storedRewards = {};
    for (const [ledgerId, balance] of Object.entries(rewards)) {
        storedRewards[ledgerId] = balance.toString();
    }
    
    // Save to IndexedDB
    try {
        const db = await initializeDB();
        
        const transaction = db.transaction([REWARDS_STORE], 'readwrite');
        const store = transaction.objectStore(REWARDS_STORE);
        
        store.put({
            userPrincipal: key,
            rewards: storedRewards,
            updatedAt: Date.now()
        });
    } catch (error) {
        console.warn('[RewardsCache] Failed to save to IndexedDB:', error);
    }
};

/**
 * Clear cached rewards for a user
 */
export const clearCachedRewards = async (userPrincipal) => {
    if (!userPrincipal) return;
    
    const key = normalizeId(userPrincipal);
    
    // Clear memory cache
    rewardsMemoryCache.delete(key);
    
    // Clear IndexedDB
    try {
        const db = await initializeDB();
        
        const transaction = db.transaction([REWARDS_STORE], 'readwrite');
        const store = transaction.objectStore(REWARDS_STORE);
        store.delete(key);
    } catch (error) {
        console.warn('[RewardsCache] Failed to clear from IndexedDB:', error);
    }
};

/**
 * Get cached rewards synchronously from memory only
 * Returns null if not in memory cache
 */
export const getCachedRewardsSync = (userPrincipal) => {
    if (!userPrincipal) return null;
    const key = normalizeId(userPrincipal);
    return rewardsMemoryCache.get(key) || null;
};
