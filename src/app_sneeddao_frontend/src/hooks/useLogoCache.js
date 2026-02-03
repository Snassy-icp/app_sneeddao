/**
 * Unified Logo Cache - Single source of truth for all logos
 * 
 * Uses IndexedDB for persistent storage with smart caching:
 * - URLs: Just store the URL string (browser caches the actual image)
 * - Base64: Store the full data (it IS the image)
 * 
 * Logo types:
 * - Token logos: From ICRC1 metadata (icrc1:logo)
 * - SNS logos: From governance metadata
 * - Position logos: Derived from token logos
 */

const LOGO_DB_NAME = 'sneed_logo_cache';
const LOGO_DB_VERSION = 1;
const LOGO_STORE_NAME = 'logos';

// In-memory cache for fast access (populated from IndexedDB on init)
const memoryCache = new Map();
let dbInitialized = false;
let dbPromise = null;

// Check if a logo string is a URL (not base64)
const isUrl = (logo) => {
    if (!logo || typeof logo !== 'string') return false;
    return logo.startsWith('http://') || 
           logo.startsWith('https://') || 
           logo.startsWith('/') ||
           logo.endsWith('.svg') ||
           logo.endsWith('.png') ||
           logo.endsWith('.jpg') ||
           logo.endsWith('.jpeg') ||
           logo.endsWith('.webp');
};

// Check if logo is base64 encoded
const isBase64 = (logo) => {
    if (!logo || typeof logo !== 'string') return false;
    return logo.startsWith('data:');
};

// Initialize IndexedDB
const initializeDB = () => {
    if (dbPromise) return dbPromise;
    
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(LOGO_DB_NAME, LOGO_DB_VERSION);
        
        request.onerror = () => {
            console.error('[LogoCache] Failed to open IndexedDB:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            dbInitialized = true;
            resolve(request.result);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(LOGO_STORE_NAME)) {
                // Store with canisterId as key, logo data as value
                db.createObjectStore(LOGO_STORE_NAME, { keyPath: 'canisterId' });
            }
        };
    });
    
    return dbPromise;
};

// Load all logos from IndexedDB into memory cache
export const initializeLogoCache = async () => {
    try {
        const db = await initializeDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([LOGO_STORE_NAME], 'readonly');
            const store = transaction.objectStore(LOGO_STORE_NAME);
            const request = store.getAll();
            
            request.onsuccess = () => {
                const logos = request.result || [];
                logos.forEach(item => {
                    memoryCache.set(item.canisterId, item.logo);
                });
                console.log(`[LogoCache] Loaded ${logos.length} logos from IndexedDB`);
                resolve(memoryCache.size);
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[LogoCache] Failed to initialize:', error);
        return 0;
    }
};

// Get logo from cache (memory first, then IndexedDB)
export const getLogo = async (canisterId) => {
    if (!canisterId) return null;
    
    const key = canisterId.toString();
    
    // Check memory cache first (instant)
    if (memoryCache.has(key)) {
        return memoryCache.get(key);
    }
    
    // Try IndexedDB
    try {
        const db = await initializeDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([LOGO_STORE_NAME], 'readonly');
            const store = transaction.objectStore(LOGO_STORE_NAME);
            const request = store.get(key);
            
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    memoryCache.set(key, result.logo);
                    resolve(result.logo);
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => {
                console.warn('[LogoCache] Failed to get logo:', request.error);
                resolve(null);
            };
        });
    } catch (error) {
        return null;
    }
};

// Get logo synchronously from memory cache (returns null if not in memory)
export const getLogoSync = (canisterId) => {
    if (!canisterId) return null;
    return memoryCache.get(canisterId.toString()) || null;
};

// Set logo in cache
export const setLogo = async (canisterId, logo) => {
    if (!canisterId || !logo) return;
    
    const key = canisterId.toString();
    
    // Don't cache empty logos
    if (logo === '' || logo === null || logo === undefined) return;
    
    // For URLs, just store the URL (browser caches the actual image)
    // For base64, store the full data
    const logoToStore = logo;
    
    // Update memory cache immediately
    memoryCache.set(key, logoToStore);
    
    // Save to IndexedDB (fire and forget)
    try {
        const db = await initializeDB();
        
        const transaction = db.transaction([LOGO_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(LOGO_STORE_NAME);
        store.put({ canisterId: key, logo: logoToStore, timestamp: Date.now() });
    } catch (error) {
        console.warn('[LogoCache] Failed to save logo:', error);
    }
};

// Set multiple logos at once (more efficient for batch operations)
export const setLogos = async (logoMap) => {
    if (!logoMap || logoMap.size === 0) return;
    
    try {
        const db = await initializeDB();
        
        const transaction = db.transaction([LOGO_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(LOGO_STORE_NAME);
        const timestamp = Date.now();
        
        for (const [canisterId, logo] of logoMap) {
            if (logo && logo !== '') {
                const key = canisterId.toString();
                memoryCache.set(key, logo);
                store.put({ canisterId: key, logo, timestamp });
            }
        }
    } catch (error) {
        console.warn('[LogoCache] Failed to save logos batch:', error);
    }
};

// Check if we have a cached logo
export const hasLogo = (canisterId) => {
    if (!canisterId) return false;
    return memoryCache.has(canisterId.toString());
};

// Clear all logos (for debugging)
export const clearLogoCache = async () => {
    memoryCache.clear();
    
    try {
        const db = await initializeDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([LOGO_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(LOGO_STORE_NAME);
            const request = store.clear();
            
            request.onsuccess = () => {
                console.log('[LogoCache] Cache cleared');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[LogoCache] Failed to clear cache:', error);
    }
};

// Get cache stats
export const getLogoCacheStats = () => {
    let urlCount = 0;
    let base64Count = 0;
    let totalSize = 0;
    
    for (const [, logo] of memoryCache) {
        if (isUrl(logo)) {
            urlCount++;
            totalSize += logo.length;
        } else if (isBase64(logo)) {
            base64Count++;
            totalSize += logo.length;
        }
    }
    
    return {
        total: memoryCache.size,
        urls: urlCount,
        base64: base64Count,
        approximateSizeKB: Math.round(totalSize / 1024)
    };
};

// Export utilities
export { isUrl, isBase64 };
