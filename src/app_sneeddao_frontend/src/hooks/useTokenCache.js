/**
 * Unified Token Cache - Single source of truth for ICRC1 token data
 * 
 * Uses IndexedDB for persistent storage:
 * - Token metadata (symbol, decimals, fee) - global, not user-specific
 * - Ledger list (known token canister IDs)
 * 
 * Logos are stored separately in useLogoCache.js
 */

import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo } from '../utils/TokenUtils';
import { getLogo, setLogo, getLogoSync } from './useLogoCache';

const TOKEN_DB_NAME = 'sneed_token_cache';
const TOKEN_DB_VERSION = 2; // Bumped for WHITELIST_STORE
const METADATA_STORE = 'tokenMetadata';
const LEDGER_LIST_STORE = 'ledgerLists';
const WHITELIST_STORE = 'whitelistTokens';
export const WHITELIST_UPDATED_EVENT = 'whitelist-tokens-updated';

// In-memory caches for fast access
const metadataMemoryCache = new Map();
const ledgerListMemoryCache = new Map(); // key -> Set of ledger IDs
const whitelistMemoryCache = []; // WhitelistedToken[]
const loadingStates = new Map();

/** Notify listeners that whitelist was updated */
function notifyWhitelistUpdated() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(WHITELIST_UPDATED_EVENT));
    }
}

let dbPromise = null;

// Initialize IndexedDB
const initializeDB = () => {
    if (dbPromise) return dbPromise;
    
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(TOKEN_DB_NAME, TOKEN_DB_VERSION);
        
        request.onerror = () => {
            console.error('[TokenCache] Failed to open IndexedDB:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            resolve(request.result);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Token metadata store (symbol, decimals, fee)
            if (!db.objectStoreNames.contains(METADATA_STORE)) {
                db.createObjectStore(METADATA_STORE, { keyPath: 'canisterId' });
            }
            
            // Ledger lists store (known token ledger IDs by source)
            if (!db.objectStoreNames.contains(LEDGER_LIST_STORE)) {
                db.createObjectStore(LEDGER_LIST_STORE, { keyPath: 'key' });
            }
            // Whitelist tokens store (single source for token selectors)
            if (!db.objectStoreNames.contains(WHITELIST_STORE)) {
                db.createObjectStore(WHITELIST_STORE, { keyPath: 'key' });
            }
        };
    });
    
    return dbPromise;
};

// ============================================================================
// TOKEN METADATA CACHE
// ============================================================================

/**
 * Initialize metadata cache from IndexedDB
 */
export const initializeTokenCache = async () => {
    try {
        const db = await initializeDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([METADATA_STORE], 'readonly');
            const store = transaction.objectStore(METADATA_STORE);
            const request = store.getAll();
            
            request.onsuccess = () => {
                const items = request.result || [];
                items.forEach(item => {
                    metadataMemoryCache.set(item.canisterId, item);
                });
                console.log(`[TokenCache] Loaded ${items.length} token metadata entries from IndexedDB`);
                resolve(metadataMemoryCache.size);
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[TokenCache] Failed to initialize:', error);
        return 0;
    }
};

/**
 * Get token metadata from cache (memory first, then IndexedDB)
 */
export const getTokenMetadata = async (canisterId) => {
    if (!canisterId) return null;
    
    const key = canisterId.toString();
    
    // Check memory cache first
    if (metadataMemoryCache.has(key)) {
        const cached = metadataMemoryCache.get(key);
        // Add logo from logo cache
        cached.logo = getLogoSync(key) || cached.logo || '';
        return cached;
    }
    
    // Try IndexedDB
    try {
        const db = await initializeDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([METADATA_STORE], 'readonly');
            const store = transaction.objectStore(METADATA_STORE);
            const request = store.get(key);
            
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    metadataMemoryCache.set(key, result);
                    // Add logo from logo cache
                    result.logo = getLogoSync(key) || result.logo || '';
                    resolve(result);
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => resolve(null);
        });
    } catch (error) {
        return null;
    }
};

/**
 * Get token metadata synchronously (memory only)
 */
export const getTokenMetadataSync = (canisterId) => {
    if (!canisterId) return null;
    const key = canisterId.toString();
    const cached = metadataMemoryCache.get(key);
    if (cached) {
        // Add logo from logo cache
        return { ...cached, logo: getLogoSync(key) || cached.logo || '' };
    }
    return null;
};

/**
 * Check if metadata is cached
 */
export const hasTokenMetadata = (canisterId) => {
    if (!canisterId) return false;
    return metadataMemoryCache.has(canisterId.toString());
};

/**
 * Check if currently loading metadata for a token
 */
export const isLoadingMetadata = (canisterId) => {
    if (!canisterId) return false;
    return loadingStates.get(canisterId.toString()) || false;
};

/**
 * Fetch and cache token metadata from ledger
 */
export const fetchAndCacheTokenMetadata = async (canisterId, identity) => {
    if (!canisterId) return null;
    
    const key = canisterId.toString();
    
    // Return cached if available
    if (metadataMemoryCache.has(key)) {
        const cached = metadataMemoryCache.get(key);
        return { ...cached, logo: getLogoSync(key) || cached.logo || '' };
    }
    
    // Check if already loading
    if (loadingStates.get(key)) {
        // Wait for it to complete
        await new Promise(resolve => {
            const checkInterval = setInterval(() => {
                if (!loadingStates.get(key)) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 50);
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
            }, 10000);
        });
        return metadataMemoryCache.get(key) || null;
    }
    
    // Mark as loading
    loadingStates.set(key, true);
    
    try {
        // Check for cached logo first
        const cachedLogo = await getLogo(key);
        
        const ledgerActor = createLedgerActor(canisterId, {
            agentOptions: identity ? { identity } : {}
        });
        
        const [rawMetadata, symbol, decimals, fee] = await Promise.all([
            ledgerActor.icrc1_metadata(),
            ledgerActor.icrc1_symbol(),
            ledgerActor.icrc1_decimals(),
            ledgerActor.icrc1_fee()
        ]);
        
        // Get logo from metadata
        let logo = getTokenLogo(rawMetadata);
        
        // Handle ICP special case
        if (symbol.toLowerCase() === 'icp' && !logo) {
            logo = 'icp_symbol.svg';
        }
        
        // Use cached logo if we didn't get one
        if (!logo && cachedLogo) {
            logo = cachedLogo;
        }
        
        // Cache logo separately
        if (logo && logo !== cachedLogo) {
            setLogo(key, logo);
        }
        
        const metadata = {
            canisterId: key,
            symbol,
            decimals,
            fee: fee.toString(), // Store as string for IndexedDB
            timestamp: Date.now()
        };
        
        // Save to memory and IndexedDB
        metadataMemoryCache.set(key, metadata);
        
        try {
            const db = await initializeDB();
            const transaction = db.transaction([METADATA_STORE], 'readwrite');
            transaction.objectStore(METADATA_STORE).put(metadata);
        } catch (e) {
            console.warn('[TokenCache] Failed to save metadata:', e);
        }
        
        return { ...metadata, logo };
        
    } catch (error) {
        console.error(`[TokenCache] Error fetching metadata for ${key}:`, error);
        return null;
    } finally {
        loadingStates.delete(key);
    }
};

/**
 * Manually set token metadata (e.g. from TokenSelector callbacks that already have the data).
 * Writes to both memory and IndexedDB so all consumers see it immediately.
 */
export const setTokenMetadataManual = async (canisterId, { symbol, decimals, fee }) => {
    if (!canisterId) return;
    const key = canisterId.toString();
    if (metadataMemoryCache.has(key)) return; // already cached
    const metadata = {
        canisterId: key,
        symbol: symbol || '???',
        decimals: decimals ?? 8,
        fee: fee != null ? fee.toString() : '0',
        timestamp: Date.now(),
    };
    metadataMemoryCache.set(key, metadata);
    try {
        const db = await initializeDB();
        const transaction = db.transaction([METADATA_STORE], 'readwrite');
        transaction.objectStore(METADATA_STORE).put(metadata);
    } catch (e) {
        console.warn('[TokenCache] Failed to save manual metadata:', e);
    }
};

/**
 * Batch fetch multiple token metadata
 */
export const fetchAndCacheMultipleMetadata = async (canisterIds, identity) => {
    const results = await Promise.all(
        canisterIds.map(id => fetchAndCacheTokenMetadata(id, identity))
    );
    return results.filter(Boolean);
};

// ============================================================================
// LEDGER LIST CACHE
// ============================================================================

/**
 * Get cached ledger list
 * @param {string} key - Cache key (e.g., 'registered', 'user_principal_id')
 */
export const getLedgerList = async (key) => {
    // Check memory first
    if (ledgerListMemoryCache.has(key)) {
        return Array.from(ledgerListMemoryCache.get(key));
    }
    
    try {
        const db = await initializeDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([LEDGER_LIST_STORE], 'readonly');
            const store = transaction.objectStore(LEDGER_LIST_STORE);
            const request = store.get(key);
            
            request.onsuccess = () => {
                const result = request.result;
                if (result && result.ledgers) {
                    const ledgerSet = new Set(result.ledgers);
                    ledgerListMemoryCache.set(key, ledgerSet);
                    resolve(result.ledgers);
                } else {
                    resolve([]);
                }
            };
            
            request.onerror = () => resolve([]);
        });
    } catch (error) {
        return [];
    }
};

/**
 * Save ledger list to cache
 */
export const setLedgerList = async (key, ledgers) => {
    if (!key || !ledgers) return;
    
    const ledgerArray = Array.isArray(ledgers) 
        ? ledgers.map(l => l.toString())
        : Array.from(ledgers).map(l => l.toString());
    
    // Update memory cache
    ledgerListMemoryCache.set(key, new Set(ledgerArray));
    
    // Save to IndexedDB
    try {
        const db = await initializeDB();
        
        const transaction = db.transaction([LEDGER_LIST_STORE], 'readwrite');
        transaction.objectStore(LEDGER_LIST_STORE).put({
            key,
            ledgers: ledgerArray,
            timestamp: Date.now()
        });
    } catch (error) {
        console.warn('[TokenCache] Failed to save ledger list:', error);
    }
};

/**
 * Add ledgers to existing list
 */
export const addToLedgerList = async (key, newLedgers) => {
    const existing = await getLedgerList(key);
    const existingSet = new Set(existing);
    
    const ledgersToAdd = Array.isArray(newLedgers) ? newLedgers : [newLedgers];
    ledgersToAdd.forEach(l => existingSet.add(l.toString()));
    
    await setLedgerList(key, Array.from(existingSet));
};

/**
 * Get merged ledger list from multiple sources
 */
export const getMergedLedgerList = async (keys) => {
    const merged = new Set();
    
    for (const key of keys) {
        const ledgers = await getLedgerList(key);
        ledgers.forEach(l => merged.add(l));
    }
    
    return Array.from(merged);
};

// ============================================================================
// WHITELIST TOKENS CACHE (single source for token selectors)
// ============================================================================

const WHITELIST_KEY = 'whitelist';

/**
 * Get cached whitelist tokens (sync from memory)
 */
export const getCachedWhitelistTokens = () => {
    return whitelistMemoryCache.length > 0 ? [...whitelistMemoryCache] : [];
};

/**
 * Save whitelist tokens to cache
 */
const toLedgerIdStr = (t) => typeof t?.toText === 'function' ? t.toText() : String(t ?? '');

export const setCachedWhitelistTokens = async (tokens) => {
    if (!tokens || !Array.isArray(tokens)) return;
    whitelistMemoryCache.length = 0;
    whitelistMemoryCache.push(...tokens);
    try {
        const db = await initializeDB();
        if (db.objectStoreNames.contains(WHITELIST_STORE)) {
            const transaction = db.transaction([WHITELIST_STORE], 'readwrite');
            transaction.objectStore(WHITELIST_STORE).put({
                key: WHITELIST_KEY,
                tokens: tokens.map(t => ({
                    ...t,
                    ledger_id: toLedgerIdStr(t.ledger_id)
                })),
                timestamp: Date.now()
            });
        }
        notifyWhitelistUpdated();
    } catch (e) {
        console.warn('[TokenCache] Failed to save whitelist:', e);
    }
};

/**
 * Initialize whitelist from IndexedDB on load
 */
export const initializeWhitelistCache = async () => {
    try {
        const db = await initializeDB();
        if (!db.objectStoreNames.contains(WHITELIST_STORE)) return 0;
        return new Promise((resolve) => {
            const transaction = db.transaction([WHITELIST_STORE], 'readonly');
            const store = transaction.objectStore(WHITELIST_STORE);
            const request = store.get(WHITELIST_KEY);
            request.onsuccess = () => {
                const result = request.result;
                if (result?.tokens?.length) {
                    whitelistMemoryCache.length = 0;
                    whitelistMemoryCache.push(...result.tokens);
                }
                resolve(whitelistMemoryCache.length);
            };
            request.onerror = () => resolve(0);
        });
    } catch (e) {
        return 0;
    }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clear all token caches
 */
export const clearTokenCache = async () => {
    metadataMemoryCache.clear();
    ledgerListMemoryCache.clear();
    whitelistMemoryCache.length = 0;
    
    try {
        const db = await initializeDB();
        
        await Promise.all([
            new Promise((resolve, reject) => {
                const tx = db.transaction([METADATA_STORE], 'readwrite');
                const req = tx.objectStore(METADATA_STORE).clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            }),
            new Promise((resolve, reject) => {
                const tx = db.transaction([LEDGER_LIST_STORE], 'readwrite');
                const req = tx.objectStore(LEDGER_LIST_STORE).clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            }),
            new Promise((resolve, reject) => {
                if (!db.objectStoreNames.contains(WHITELIST_STORE)) {
                    resolve();
                    return;
                }
                const tx = db.transaction([WHITELIST_STORE], 'readwrite');
                const req = tx.objectStore(WHITELIST_STORE).clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            })
        ]);
        
        console.log('[TokenCache] Cache cleared');
    } catch (error) {
        console.warn('[TokenCache] Failed to clear cache:', error);
    }
};

/**
 * Get cache stats
 */
export const getTokenCacheStats = () => {
    return {
        metadataCount: metadataMemoryCache.size,
        ledgerListKeys: Array.from(ledgerListMemoryCache.keys()),
        totalLedgers: Array.from(ledgerListMemoryCache.values())
            .reduce((sum, set) => sum + set.size, 0)
    };
};
