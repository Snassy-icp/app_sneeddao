import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import { useAuth } from '../AuthContext';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { HttpAgent } from '@dfinity/agent';
import { getTokenLogo, get_token_conversion_rate, get_available, get_available_backend } from '../utils/TokenUtils';
import { fetchUserNeuronsForSns, uint8ArrayToHex } from '../utils/NeuronUtils';
import { getTipTokensReceivedByUser } from '../utils/BackendUtils';
import { fetchAndCacheSnsData, getAllSnses, getSnsById } from '../utils/SnsUtils';
import { getNeuronsFromCacheByIds } from '../hooks/useNeuronsCache';

const WalletContext = createContext(null);

// ============================================================================
// PERSISTENT CACHE HELPERS (IndexedDB - much larger quota than localStorage)
// ============================================================================

const WALLET_DB_NAME = 'sneed_wallet_cache';
const WALLET_DB_VERSION = 1;
const WALLET_STORE_NAME = 'walletData';
const CACHE_VERSION = 2; // Increment when cache structure changes

// Initialize IndexedDB for wallet cache
let walletDbPromise = null;
const initializeWalletDB = () => {
    if (walletDbPromise) return walletDbPromise;
    
    walletDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(WALLET_DB_NAME, WALLET_DB_VERSION);
        
        request.onerror = () => {
            console.error('[WalletContext] Failed to open IndexedDB:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            resolve(request.result);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(WALLET_STORE_NAME)) {
                db.createObjectStore(WALLET_STORE_NAME, { keyPath: 'principalId' });
            }
        };
    });
    
    return walletDbPromise;
};

// Custom serialization for IndexedDB (handles BigInt, Principal, etc.)
const serializeForDB = (obj) => {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        if (typeof value === 'bigint') {
            return { __type: 'BigInt', value: value.toString() };
        }
        if (value && typeof value === 'object' && value._isPrincipal) {
            return { __type: 'Principal', value: value.toString() };
        }
        if (value instanceof Principal) {
            return { __type: 'Principal', value: value.toString() };
        }
        if (value instanceof Map) {
            return { __type: 'Map', value: Array.from(value.entries()) };
        }
        if (value instanceof Set) {
            return { __type: 'Set', value: Array.from(value) };
        }
        if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
            return { __type: 'TypedArray', arrayType: value.constructor.name, value: Array.from(value) };
        }
        return value;
    }));
};

// Custom deserialization from IndexedDB
const deserializeFromDB = (obj) => {
    if (!obj) return obj;
    
    const revive = (value) => {
        if (value && typeof value === 'object') {
            if (value.__type) {
                switch (value.__type) {
                    case 'BigInt':
                        return BigInt(value.value);
                    case 'Principal':
                        return Principal.fromText(value.value);
                    case 'Map':
                        return new Map(value.value.map(([k, v]) => [k, revive(v)]));
                    case 'Set':
                        return new Set(value.value.map(v => revive(v)));
                    case 'TypedArray':
                        const TypedArrayConstructor = globalThis[value.arrayType];
                        if (TypedArrayConstructor) {
                            return new TypedArrayConstructor(value.value);
                        }
                        return value.value;
                }
            }
            // Recursively process objects and arrays
            if (Array.isArray(value)) {
                return value.map(v => revive(v));
            }
            const result = {};
            for (const key of Object.keys(value)) {
                result[key] = revive(value[key]);
            }
            return result;
        }
        return value;
    };
    
    return revive(obj);
};

// Save wallet cache to IndexedDB (async)
const saveWalletCache = async (principalId, data) => {
    try {
        const db = await initializeWalletDB();
        
        const cacheData = serializeForDB({
            principalId,
            version: CACHE_VERSION,
            timestamp: Date.now(),
            ...data
        });
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([WALLET_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(WALLET_STORE_NAME);
            const request = store.put(cacheData);
            
            request.onsuccess = () => {
                resolve();
            };
            request.onerror = () => {
                console.warn('[WalletContext] Failed to save to IndexedDB:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.warn('[WalletContext] Failed to save cache:', error);
    }
};

// Load wallet cache from IndexedDB (async)
const loadWalletCache = async (principalId) => {
    try {
        const db = await initializeWalletDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([WALLET_STORE_NAME], 'readonly');
            const store = transaction.objectStore(WALLET_STORE_NAME);
            const request = store.get(principalId);
            
            request.onsuccess = () => {
                const data = request.result;
                if (!data) {
                    resolve(null);
                    return;
                }
                
                // Check cache version
                if (data.version !== CACHE_VERSION) {
                    console.log('[WalletContext] Cache version mismatch, clearing');
                    // Clear old version
                    const deleteTransaction = db.transaction([WALLET_STORE_NAME], 'readwrite');
                    deleteTransaction.objectStore(WALLET_STORE_NAME).delete(principalId);
                    resolve(null);
                    return;
                }
                
                // Deserialize and return
                resolve(deserializeFromDB(data));
            };
            
            request.onerror = () => {
                console.warn('[WalletContext] Failed to load from IndexedDB:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.warn('[WalletContext] Failed to load cache:', error);
        return null;
    }
};

// Clear wallet cache for a principal from IndexedDB
const clearWalletCache = async (principalId) => {
    try {
        const db = await initializeWalletDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([WALLET_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(WALLET_STORE_NAME);
            const request = store.delete(principalId);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[WalletContext] Failed to clear cache:', error);
    }
};

// Migrate from localStorage to IndexedDB (one-time migration)
const migrateFromLocalStorage = async (principalId) => {
    try {
        const oldCacheKey = `walletCache_${principalId}`;
        const oldData = localStorage.getItem(oldCacheKey);
        
        if (oldData) {
            console.log('[WalletContext] Migrating cache from localStorage to IndexedDB...');
            const parsed = JSON.parse(oldData, (key, value) => {
                if (value && typeof value === 'object' && value.__type) {
                    switch (value.__type) {
                        case 'BigInt': return BigInt(value.value);
                        case 'Principal': return Principal.fromText(value.value);
                        case 'Map': return new Map(value.value);
                        case 'Set': return new Set(value.value);
                        case 'TypedArray':
                            const Constructor = globalThis[value.arrayType];
                            return Constructor ? new Constructor(value.value) : value.value;
                    }
                }
                return value;
            });
            
            // Save to IndexedDB
            await saveWalletCache(principalId, parsed);
            
            // Remove from localStorage
            localStorage.removeItem(oldCacheKey);
            console.log('[WalletContext] Migration complete, localStorage cache removed');
            
            return parsed;
        }
        return null;
    } catch (error) {
        console.warn('[WalletContext] Migration failed:', error);
        return null;
    }
};

// ============================================================================
// WALLET PROVIDER
// ============================================================================

export const WalletProvider = ({ children }) => {
    const { identity, isAuthenticated } = useAuth();
    
    // Tokens from the wallet - same structure as Wallet.jsx tokens state
    const [walletTokens, setWalletTokens] = useState([]);
    const [walletLoading, setWalletLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [hasFetchedInitial, setHasFetchedInitial] = useState(false);
    // Track if detailed wallet data has been loaded (from Wallet.jsx)
    const [hasDetailedData, setHasDetailedData] = useState(false);
    // Track fetch session to prevent stale updates
    const fetchSessionRef = useRef(0);
    // Track SNS token ledger IDs
    const [snsTokenLedgers, setSnsTokenLedgers] = useState(new Set());
    // Liquidity positions from the wallet
    const [liquidityPositions, setLiquidityPositions] = useState([]);
    const [positionsLoading, setPositionsLoading] = useState(false);
    const [hasFetchedPositions, setHasFetchedPositions] = useState(false);
    const positionsFetchSessionRef = useRef(0);
    const hasPositionsRef = useRef(false); // Track if we have positions (for stale closure safety)
    
    // Global neuron cache - stores all reachable neurons by governance canister ID
    // This cache is independent of wallet tokens and used by:
    // - Wallet token cards (staked amounts)
    // - Quick wallet
    // - VP bar
    // - /me page neurons tab
    // - Forum voting
    // - Any component that needs neuron data
    const [neuronCache, setNeuronCache] = useState(new Map()); // Map<governanceCanisterId, neuron[]>
    const [neuronCacheLoading, setNeuronCacheLoading] = useState(new Set()); // Set of governance IDs currently loading
    const [neuronCacheInitialized, setNeuronCacheInitialized] = useState(false);
    const neuronCacheFetchSessionRef = useRef(0);
    
    // ICP Neuron Managers - shared between quick wallet and /wallet page
    const [neuronManagers, setNeuronManagers] = useState([]); // Array of { canisterId, version, isController }
    const [managerNeurons, setManagerNeurons] = useState({}); // canisterId -> { loading, neurons, error }
    const [managerNeuronsTotal, setManagerNeuronsTotal] = useState(0); // Total ICP value
    const [neuronManagersLoading, setNeuronManagersLoading] = useState(false);
    const [hasFetchedManagers, setHasFetchedManagers] = useState(false);
    const managersFetchSessionRef = useRef(0);
    
    // Track if we loaded from persistent cache (for instant display)
    const [loadedFromCache, setLoadedFromCache] = useState(false);
    const [cacheCheckComplete, setCacheCheckComplete] = useState(false); // True after cache check finishes (with or without data)
    const hasInitializedFromCacheRef = useRef(false);
    
    // Get principal ID for cache key
    const principalId = identity?.getPrincipal()?.toString();
    
    // Load from persistent cache on mount/login
    useEffect(() => {
        if (!principalId || hasInitializedFromCacheRef.current) return;
        
        // Mark as initializing immediately to prevent re-entry
        hasInitializedFromCacheRef.current = true;
        
        const loadCache = async () => {
            // First try to migrate from old localStorage cache (one-time)
            let cachedData = await migrateFromLocalStorage(principalId);
            
            // If no migrated data, load from IndexedDB
            if (!cachedData) {
                cachedData = await loadWalletCache(principalId);
            }
            
            if (cachedData) {
                console.log('%c💾 [WALLET CACHE] Loading from IndexedDB cache, age:', 'background: #3498db; color: white; padding: 2px 6px;',
                    Math.round((Date.now() - cachedData.timestamp) / 1000), 'seconds');
                
                // Restore tokens
                if (cachedData.walletTokens && cachedData.walletTokens.length > 0) {
                    console.log('%c💾 [WALLET CACHE] Restoring', cachedData.walletTokens.length, 'tokens', 'background: #2ecc71; color: white; padding: 2px 6px;');
                    setWalletTokens(cachedData.walletTokens);
                    setHasFetchedInitial(true);
                }
                
                // Restore positions
                if (cachedData.liquidityPositions && cachedData.liquidityPositions.length > 0) {
                    console.log('%c💾 [POSITIONS CACHE] Restoring', cachedData.liquidityPositions.length, 'positions from cache', 'background: #9b59b6; color: white; padding: 2px 6px;');
                    setLiquidityPositions(cachedData.liquidityPositions);
                    setHasFetchedPositions(true);
                    hasPositionsRef.current = true;
                } else {
                    console.log('%c💾 [POSITIONS CACHE] No cached positions found', 'background: #e74c3c; color: white; padding: 2px 6px;');
                }
                
                // Restore neuron cache from IDs (hydrate from shared IndexedDB cache)
                // We now store only neuron IDs in localStorage and hydrate from shared cache
                // IMPORTANT: This is async but we MUST wait for it before marking cache complete
                if (cachedData.neuronCacheIds || cachedData.neuronCache) {
                    // Handle both old format (neuronCache with full objects) and new format (neuronCacheIds)
                    const cacheData = cachedData.neuronCacheIds || cachedData.neuronCache;
                    const entries = cacheData instanceof Map ? Array.from(cacheData.entries()) : 
                                   Array.isArray(cacheData) ? cacheData : [];
                    
                    // For each governance, try to hydrate neurons from shared IndexedDB cache
                    const hydratedMap = new Map();
                    
                    for (const [governanceId, neuronDataOrIds] of entries) {
                        // Extract neuron IDs from either old format (full objects) or new format (just IDs)
                        let neuronIds;
                        if (Array.isArray(neuronDataOrIds) && neuronDataOrIds.length > 0) {
                            if (typeof neuronDataOrIds[0] === 'string') {
                                // New format: just IDs
                                neuronIds = neuronDataOrIds;
                            } else if (neuronDataOrIds[0]?.id) {
                                // Old format: full neuron objects - extract IDs
                                neuronIds = neuronDataOrIds.map(n => {
                                    const idArray = n.id?.[0]?.id;
                                    if (!idArray) return null;
                                    return Array.isArray(idArray) 
                                        ? idArray.map(b => b.toString(16).padStart(2, '0')).join('')
                                        : uint8ArrayToHex(new Uint8Array(idArray));
                                }).filter(Boolean);
                            }
                        }
                        
                        if (!neuronIds || neuronIds.length === 0) continue;
                        
                        // Find SNS root for this governance canister
                        const allSnses = getAllSnses();
                        const sns = allSnses.find(s => s.canisters?.governance === governanceId);
                        const snsRoot = sns?.rootCanisterId;
                        
                        if (snsRoot) {
                            // Try to hydrate from shared IndexedDB cache
                            try {
                                const { found, missing } = await getNeuronsFromCacheByIds(snsRoot, neuronIds);
                                if (found.length > 0) {
                                    hydratedMap.set(governanceId, found);
                                }
                                // Note: missing neurons will be fetched fresh by fetchAndCacheNeurons
                            } catch (e) {
                                console.warn('Failed to hydrate neurons from cache:', e);
                            }
                        } else if (Array.isArray(neuronDataOrIds) && neuronDataOrIds[0]?.id) {
                            // No SNS mapping but we have old format full objects - use them directly
                            hydratedMap.set(governanceId, neuronDataOrIds);
                        }
                    }
                    
                    if (hydratedMap.size > 0) {
                        setNeuronCache(hydratedMap);
                        setNeuronCacheInitialized(true);
                        console.log('%c💾 [NEURON CACHE] Hydrated', hydratedMap.size, 'governance caches from IndexedDB', 'background: #9b59b6; color: white; padding: 2px 6px;');
                    }
                }
                
                // Restore neuron managers
                if (cachedData.neuronManagers && cachedData.neuronManagers.length > 0) {
                    setNeuronManagers(cachedData.neuronManagers);
                    setHasFetchedManagers(true);
                }
                if (cachedData.managerNeurons) {
                    setManagerNeurons(cachedData.managerNeurons);
                }
                if (cachedData.managerNeuronsTotal !== undefined) {
                    setManagerNeuronsTotal(cachedData.managerNeuronsTotal);
                }
                
                // Restore last updated
                if (cachedData.lastUpdated) {
                    setLastUpdated(new Date(cachedData.lastUpdated));
                }
                
                setLoadedFromCache(true);
                console.log('%c✅ [WALLET CACHE] Restore complete', 'background: #2ecc71; color: white; padding: 2px 6px;');
            } else {
                console.log('%c💾 [WALLET CACHE] No cache found', 'background: #e74c3c; color: white; padding: 2px 6px;');
            }
            
            // Mark cache check as complete AFTER all async operations (including neuron hydration)
            setCacheCheckComplete(true);
        };
        
        loadCache();
    }, [principalId]);
    
    // Save to persistent cache when data changes (debounced)
    const saveCacheTimeoutRef = useRef(null);
    useEffect(() => {
        if (!principalId || !isAuthenticated) return;
        
        // Don't save if we haven't fetched anything yet
        if (!hasFetchedInitial && !loadedFromCache) return;
        
        // Debounce saves to avoid excessive writes during progressive loading
        if (saveCacheTimeoutRef.current) {
            clearTimeout(saveCacheTimeoutRef.current);
        }
        
        saveCacheTimeoutRef.current = setTimeout(() => {
            // Convert neuronCache to just IDs for efficient storage
            // Full neuron data lives in shared IndexedDB cache
            const neuronCacheIds = Array.from(neuronCache.entries()).map(([govId, neurons]) => {
                const neuronIds = neurons.map(n => {
                    const idArray = n.id?.[0]?.id;
                    if (!idArray) return null;
                    return idArray instanceof Uint8Array 
                        ? uint8ArrayToHex(idArray)
                        : Array.isArray(idArray)
                            ? idArray.map(b => b.toString(16).padStart(2, '0')).join('')
                            : null;
                }).filter(Boolean);
                return [govId, neuronIds];
            });
            
            console.log('%c💾 [POSITIONS CACHE] Saving', liquidityPositions.length, 'positions to cache', 'background: #3498db; color: white; padding: 2px 6px;');
            saveWalletCache(principalId, {
                walletTokens,
                liquidityPositions,
                neuronCacheIds, // Store only IDs, not full neuron objects
                neuronManagers,
                managerNeurons,
                managerNeuronsTotal,
                lastUpdated: lastUpdated?.getTime() || Date.now()
            });
        }, 2000); // Save 2 seconds after last change
        
        return () => {
            if (saveCacheTimeoutRef.current) {
                clearTimeout(saveCacheTimeoutRef.current);
            }
        };
    }, [principalId, isAuthenticated, walletTokens, liquidityPositions, neuronCache, neuronManagers, managerNeurons, managerNeuronsTotal, lastUpdated, hasFetchedInitial, loadedFromCache]);

    // Load SNS data to know which tokens are SNS tokens
    useEffect(() => {
        async function loadSnsData() {
            try {
                // First try cached data for instant display
                const cached = getAllSnses();
                if (cached && cached.length > 0) {
                    const snsLedgers = new Set(
                        cached.map(sns => sns.canisters?.ledger).filter(Boolean)
                    );
                    setSnsTokenLedgers(snsLedgers);
                }
                
                // Then fetch fresh data in background
                if (identity) {
                    const freshData = await fetchAndCacheSnsData(identity);
                    if (freshData && freshData.length > 0) {
                        const snsLedgers = new Set(
                            freshData.map(sns => sns.canisters?.ledger).filter(Boolean)
                        );
                        setSnsTokenLedgers(snsLedgers);
                    }
                }
            } catch (error) {
                console.warn('[WalletContext] Failed to load SNS data:', error);
            }
        }
        
        loadSnsData();
    }, [identity]);

    // Helper to check if a token is an SNS token
    const isTokenSns = useCallback((ledgerCanisterId) => {
        const ledgerId = typeof ledgerCanisterId === 'string' 
            ? ledgerCanisterId 
            : ledgerCanisterId?.toString?.() || ledgerCanisterId;
        return snsTokenLedgers.has(ledgerId);
    }, [snsTokenLedgers]);

    // Fetch token details for a single ledger - includes locked and backend balance
    const fetchTokenDetailsFast = useCallback(async (ledgerCanisterId, summedLocks = {}) => {
        if (!identity) return null;

        try {
            const ledgerActor = createLedgerActor(ledgerCanisterId, {
                agentOptions: { identity }
            });

            const principal = identity.getPrincipal();
            const subaccount = principalToSubAccount(principal);

            const [metadata, symbol, decimals, fee, balance, balance_backend] = await Promise.all([
                ledgerActor.icrc1_metadata(),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals(),
                ledgerActor.icrc1_fee(),
                ledgerActor.icrc1_balance_of({ 
                    owner: principal, 
                    subaccount: [] 
                }),
                ledgerActor.icrc1_balance_of({ 
                    owner: Principal.fromText(sneedLockCanisterId), 
                    subaccount: [subaccount] 
                })
            ]);

            const logo = getTokenLogo(metadata);
            const ledgerId = ledgerCanisterId.toString();
            
            // Get locked amount from summedLocks map
            const locked = summedLocks[ledgerId] || BigInt(0);

            // Create token object with all balances
            const token = {
                principal: ledgerId,
                ledger_canister_id: ledgerCanisterId,
                symbol,
                decimals,
                fee,
                logo: symbol.toLowerCase() === "icp" && logo === "" ? "icp_symbol.svg" : logo,
                balance,
                balance_backend,
                locked,
                conversion_rate: null, // Will be fetched progressively
                usdValue: null
            };

            // Calculate available balances using same logic as Wallet.jsx
            token.available_backend = get_available_backend(token);
            token.available = get_available(token);

            return token;
        } catch (error) {
            console.error(`Error fetching token details for ${ledgerCanisterId}:`, error);
            return null;
        }
    }, [identity]);

    // Fetch conversion rate for a token and update it in place
    const fetchAndUpdateConversionRate = useCallback(async (ledgerCanisterId, decimals, sessionId) => {
        try {
            const conversion_rate = await get_token_conversion_rate(
                ledgerCanisterId.toString(), 
                decimals
            );
            
            // Only update if still in same fetch session
            if (fetchSessionRef.current === sessionId) {
                setWalletTokens(prev => prev.map(token => {
                    if (token.principal === ledgerCanisterId.toString()) {
                        const balance = BigInt(token.available || token.balance || 0n);
                        const balanceNum = Number(balance) / (10 ** (token.decimals || 8));
                        const usdValue = conversion_rate ? balanceNum * conversion_rate : null;
                        return { ...token, conversion_rate, usdValue };
                    }
                    return token;
                }));
            }
        } catch (error) {
            console.warn(`Could not fetch conversion rate for ${ledgerCanisterId}:`, error);
        }
    }, []);

    // Fetch neurons for a governance canister and cache them
    const fetchAndCacheNeurons = useCallback(async (governanceCanisterId) => {
        if (!identity) return [];
        
        // Check if already in cache
        if (neuronCache.has(governanceCanisterId)) {
            return neuronCache.get(governanceCanisterId);
        }
        
        // Check if already loading
        if (neuronCacheLoading.has(governanceCanisterId)) {
            // Wait for it to load by polling
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (!neuronCacheLoading.has(governanceCanisterId)) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                // Timeout after 30 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve();
                }, 30000);
            });
            return neuronCache.get(governanceCanisterId) || [];
        }
        
        // Mark as loading
        setNeuronCacheLoading(prev => new Set(prev).add(governanceCanisterId));
        
        try {
            const neurons = await fetchUserNeuronsForSns(identity, governanceCanisterId);
            
            // Cache the neurons
            setNeuronCache(prev => new Map(prev).set(governanceCanisterId, neurons));
            
            return neurons;
        } catch (error) {
            console.warn(`Could not fetch neurons for governance ${governanceCanisterId}:`, error);
            return [];
        } finally {
            // Mark as done loading
            setNeuronCacheLoading(prev => {
                const newSet = new Set(prev);
                newSet.delete(governanceCanisterId);
                return newSet;
            });
        }
    }, [identity, neuronCache, neuronCacheLoading]);
    
    // Get neurons from cache (or fetch if not cached)
    const getNeuronsForGovernance = useCallback(async (governanceCanisterId) => {
        return fetchAndCacheNeurons(governanceCanisterId);
    }, [fetchAndCacheNeurons]);
    
    // Get cached neurons synchronously (returns empty array if not yet loaded)
    const getCachedNeurons = useCallback((governanceCanisterId) => {
        return neuronCache.get(governanceCanisterId) || [];
    }, [neuronCache]);
    
    // Clear neuron cache (e.g., on refresh)
    const clearNeuronCache = useCallback((governanceCanisterId = null) => {
        if (governanceCanisterId) {
            setNeuronCache(prev => {
                const newMap = new Map(prev);
                newMap.delete(governanceCanisterId);
                return newMap;
            });
        } else {
            setNeuronCache(new Map());
            setNeuronCacheInitialized(false);
        }
    }, []);

    // Proactively fetch neurons for ALL SNS tokens on login
    // This is independent of wallet tokens - fetches for all known SNS
    const fetchAllSnsNeurons = useCallback(async () => {
        if (!identity || !isAuthenticated) return;
        
        const sessionId = ++neuronCacheFetchSessionRef.current;
        
        try {
            // Get all known SNS tokens
            const allSnses = getAllSnses();
            if (!allSnses || allSnses.length === 0) {
                // Try to fetch fresh SNS data
                const freshData = await fetchAndCacheSnsData(identity);
                if (!freshData || freshData.length === 0) return;
            }
            
            const snsList = getAllSnses();
            
            // Fetch neurons for each SNS in parallel (fire and forget for speed)
            for (const sns of snsList) {
                if (neuronCacheFetchSessionRef.current !== sessionId) return;
                
                const governanceCanisterId = sns.canisters?.governance;
                if (!governanceCanisterId) continue;
                
                // Skip if already cached or loading
                if (neuronCache.has(governanceCanisterId)) continue;
                if (neuronCacheLoading.has(governanceCanisterId)) continue;
                
                // Fire and forget - don't await, let them load in parallel
                fetchAndCacheNeurons(governanceCanisterId).catch(err => {
                    console.warn(`[WalletContext] Failed to fetch neurons for ${sns.name || governanceCanisterId}:`, err);
                });
            }
            
            setNeuronCacheInitialized(true);
        } catch (error) {
            console.warn('[WalletContext] Error fetching all SNS neurons:', error);
        }
    }, [identity, isAuthenticated, neuronCache, neuronCacheLoading, fetchAndCacheNeurons]);

    // Proactively fetch neurons for all SNS on login
    useEffect(() => {
        if (isAuthenticated && identity && !neuronCacheInitialized) {
            fetchAllSnsNeurons();
        }
        if (!isAuthenticated) {
            setNeuronCache(new Map());
            setNeuronCacheInitialized(false);
        }
    }, [isAuthenticated, identity, neuronCacheInitialized, fetchAllSnsNeurons]);

    // Fetch neuron totals for an SNS token and update it in place (uses cache)
    const fetchAndUpdateNeuronTotals = useCallback(async (ledgerCanisterId, sessionId) => {
        const ledgerId = ledgerCanisterId.toString();
        
        // Check if this is an SNS token
        if (!snsTokenLedgers.has(ledgerId)) return;
        
        try {
            // Find the governance canister for this SNS
            const allSnses = getAllSnses();
            const snsData = allSnses.find(sns => sns.canisters?.ledger === ledgerId);
            
            if (!snsData || !snsData.canisters?.governance) return;
            
            const governanceCanisterId = snsData.canisters.governance;
            
            // Fetch neurons (uses cache)
            const neurons = await fetchAndCacheNeurons(governanceCanisterId);
            
            if (fetchSessionRef.current !== sessionId) return;
            
            // Calculate totals
            const neuronStake = neurons.reduce((total, neuron) => {
                return total + BigInt(neuron.cached_neuron_stake_e8s || 0n);
            }, 0n);
            
            const neuronMaturity = neurons.reduce((total, neuron) => {
                return total + BigInt(neuron.maturity_e8s_equivalent || 0n);
            }, 0n);
            
            // Update token with neuron data
            setWalletTokens(prev => prev.map(token => {
                if (token.principal === ledgerId) {
                    return { 
                        ...token, 
                        neuronStake,
                        neuronMaturity,
                        neuronsLoaded: true
                    };
                }
                return token;
            }));
        } catch (error) {
            console.warn(`Could not fetch neuron totals for ${ledgerId}:`, error);
        }
    }, [identity, snsTokenLedgers, fetchAndCacheNeurons]);

    // Add a position progressively as it loads
    const addPositionProgressively = useCallback((positionData, sessionId) => {
        if (positionsFetchSessionRef.current !== sessionId) return;
        
        setLiquidityPositions(prev => {
            // Check if position already exists
            const exists = prev.some(p => p.swapCanisterId === positionData.swapCanisterId);
            if (exists) {
                return prev.map(p => p.swapCanisterId === positionData.swapCanisterId ? positionData : p);
            }
            return [...prev, positionData];
        });
    }, []);

    // Fetch conversion rate for a position and update it in place
    const fetchPositionConversionRates = useCallback(async (swapCanisterId, ledger0, ledger1, decimals0, decimals1, sessionId) => {
        try {
            const [rate0, rate1] = await Promise.all([
                get_token_conversion_rate(ledger0, decimals0).catch(() => 0),
                get_token_conversion_rate(ledger1, decimals1).catch(() => 0)
            ]);
            
            if (positionsFetchSessionRef.current === sessionId) {
                setLiquidityPositions(prev => prev.map(p => {
                    if (p.swapCanisterId === swapCanisterId) {
                        return { ...p, token0_conversion_rate: rate0, token1_conversion_rate: rate1 };
                    }
                    return p;
                }));
            }
        } catch (e) {
            console.warn('Could not fetch conversion rates for position:', e);
        }
    }, []);

    // Keep ref in sync with liquidityPositions length
    useEffect(() => {
        hasPositionsRef.current = liquidityPositions.length > 0;
    }, [liquidityPositions]);
    
    // Fetch compact positions for the quick wallet - PROGRESSIVE
    const fetchCompactPositions = useCallback(async (clearFirst = false, showLoading = true) => {
        console.log('%c🔄 [POSITIONS FETCH] Called with clearFirst=', clearFirst, 'showLoading=', showLoading, 'hasPositionsRef=', hasPositionsRef.current, 'background: #f39c12; color: black; padding: 2px 6px;');
        
        if (!identity || !isAuthenticated) {
            setLiquidityPositions([]);
            setPositionsLoading(false);
            return;
        }

        const sessionId = ++positionsFetchSessionRef.current;
        
        // Only clear positions if explicitly requested (e.g., on manual refresh)
        // This preserves cached data during background refresh
        if (clearFirst) {
            console.log('%c🔄 [POSITIONS FETCH] Clearing positions (clearFirst=true)', 'background: #e74c3c; color: white; padding: 2px 6px;');
            setLiquidityPositions([]);
            hasPositionsRef.current = false;
        }
        
        // Only show loading spinner if requested AND we have no data to show
        // Use ref to avoid stale closure issue
        const shouldShowLoading = showLoading && (clearFirst || !hasPositionsRef.current);
        console.log('%c🔄 [POSITIONS FETCH] shouldShowLoading=', shouldShowLoading, 'background: #f39c12; color: black; padding: 2px 6px;');
        if (shouldShowLoading) {
            setPositionsLoading(true);
        }

        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Get swap canister IDs FIRST (fast)
            const swap_canisters = await backendActor.get_swap_canister_ids();
            
            if (swap_canisters.length === 0) {
                if (positionsFetchSessionRef.current === sessionId) {
                    setPositionsLoading(false);
                    setHasFetchedPositions(true);
                }
                return;
            }

            // Get claimed positions in parallel with swap fetches
            const claimedPositionsPromise = (async () => {
                try {
                    // Clear expired locks in background
                    sneedLockActor.has_expired_position_locks().then(async (hasExpired) => {
                        if (hasExpired) await sneedLockActor.clear_expired_position_locks();
                    }).catch(() => {});
                    
                    return await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
                } catch (e) {
                    console.warn('Could not get claimed positions:', e);
                    return [];
                }
            })();

            // Mark as fetched early so UI shows loading state properly
            setHasFetchedPositions(true);

            // Fetch each swap canister's positions in parallel - fire and forget pattern
            swap_canisters.forEach(async (swap_canister) => {
                if (positionsFetchSessionRef.current !== sessionId) return;
                
                try {
                    const swapActor = createIcpSwapActor(swap_canister);
                    
                    // Get swap metadata first
                    const swap_meta = await swapActor.metadata();
                    if (!swap_meta.ok) return;

                    const icrc1_ledger0 = swap_meta.ok.token0.address;
                    const icrc1_ledger1 = swap_meta.ok.token1.address;

                    // Get user's position IDs quickly
                    const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok || [];
                    
                    // Get claimed positions (from the parallel promise)
                    const claimed_positions = await claimedPositionsPromise;
                    const claimed_positions_for_swap = claimed_positions.filter(cp => cp.swap_canister_id === swap_canister);
                    const claimed_position_ids_for_swap = claimed_positions_for_swap.map(cp => cp.position_id);
                    
                    // If no positions for this user in this swap, skip
                    if (userPositionIds.length === 0 && claimed_position_ids_for_swap.length === 0) return;

                    // Get token metadata in parallel
                    const [ledgerActor0, ledgerActor1] = [
                        createLedgerActor(icrc1_ledger0),
                        createLedgerActor(icrc1_ledger1)
                    ];

                    const [metadata0, metadata1, decimals0, decimals1, symbol0, symbol1, fee0, fee1] = await Promise.all([
                        ledgerActor0.icrc1_metadata(),
                        ledgerActor1.icrc1_metadata(),
                        ledgerActor0.icrc1_decimals(),
                        ledgerActor1.icrc1_decimals(),
                        ledgerActor0.icrc1_symbol(),
                        ledgerActor1.icrc1_symbol(),
                        ledgerActor0.icrc1_fee(),
                        ledgerActor1.icrc1_fee()
                    ]);

                    let token0Logo = getTokenLogo(metadata0);
                    let token1Logo = getTokenLogo(metadata1);
                    if (symbol0?.toLowerCase() === "icp" && token0Logo === "") token0Logo = "icp_symbol.svg";
                    if (symbol1?.toLowerCase() === "icp" && token1Logo === "") token1Logo = "icp_symbol.svg";

                    // Build claimed positions lookup
                    const claimed_positions_for_swap_by_id = {};
                    for (const cp of claimed_positions_for_swap) {
                        claimed_positions_for_swap_by_id[cp.position_id] = cp;
                    }
                    
                    // Fetch positions with amounts
                    let userPositions = [];
                    let offset = 0;
                    const limit = 50;
                    let hasMore = true;
                    
                    while (hasMore && positionsFetchSessionRef.current === sessionId) {
                        const result = await swapActor.getUserPositionWithTokenAmount(offset, limit);
                        const allPositions = result.ok?.content || [];
                        
                        for (const position of allPositions) {
                            if (userPositionIds.includes(position.id) || claimed_position_ids_for_swap.includes(position.id)) {
                                userPositions.push({
                                    position: position,
                                    claimInfo: claimed_positions_for_swap_by_id[position.id],
                                    frontendOwnership: userPositionIds.includes(position.id)
                                });
                            }
                        }
                        
                        offset += limit;
                        hasMore = allPositions.length === limit;
                    }

                    if (userPositions.length === 0 || positionsFetchSessionRef.current !== sessionId) return;

                    // Build position details
                    const positionDetails = userPositions.map(compoundPosition => {
                        const position = compoundPosition.position;
                        return {
                            positionId: position.id,
                            tokensOwed0: position.tokensOwed0,
                            tokensOwed1: position.tokensOwed1,
                            amount0: position.token0Amount,
                            amount1: position.token1Amount,
                            frontendOwnership: compoundPosition.frontendOwnership,
                            lockInfo: (!compoundPosition.frontendOwnership && compoundPosition.claimInfo?.position_lock?.[0]) 
                                ? compoundPosition.claimInfo.position_lock[0] 
                                : null
                        };
                    });

                    // Add position immediately (without conversion rates)
                    const positionData = {
                        swapCanisterId: swap_canister,
                        token0: Principal.fromText(icrc1_ledger0),
                        token1: Principal.fromText(icrc1_ledger1),
                        token0Symbol: symbol0,
                        token1Symbol: symbol1,
                        token0Logo: token0Logo,
                        token1Logo: token1Logo,
                        token0Decimals: Number(decimals0),
                        token1Decimals: Number(decimals1),
                        token0Fee: fee0,
                        token1Fee: fee1,
                        token0_conversion_rate: 0, // Will be updated progressively
                        token1_conversion_rate: 0,
                        swapCanisterBalance0: 0n,
                        swapCanisterBalance1: 0n,
                        positions: positionDetails,
                        loading: false
                    };
                    
                    addPositionProgressively(positionData, sessionId);
                    
                    // Fetch conversion rates in background
                    fetchPositionConversionRates(swap_canister, icrc1_ledger0, icrc1_ledger1, decimals0, decimals1, sessionId);
                    
                } catch (err) {
                    console.warn(`Could not fetch positions for swap ${swap_canister}:`, err);
                }
            });

            // Set loading to false after a short delay to allow first positions to appear
            setTimeout(() => {
                if (positionsFetchSessionRef.current === sessionId) {
                    setPositionsLoading(false);
                }
            }, 500);
            
        } catch (error) {
            console.error('Error fetching compact positions:', error);
            if (positionsFetchSessionRef.current === sessionId) {
                setPositionsLoading(false);
                setHasFetchedPositions(true);
            }
        }
    }, [identity, isAuthenticated, addPositionProgressively, fetchPositionConversionRates]);

    // Progressive token fetcher - adds tokens as they load
    const addTokenProgressively = useCallback((token, sessionId) => {
        if (fetchSessionRef.current !== sessionId) return;
        
        setWalletTokens(prev => {
            // Check if token already exists
            const exists = prev.some(t => t.principal === token.principal);
            if (exists) {
                // Update existing token
                return prev.map(t => t.principal === token.principal ? token : t);
            }
            // Check for duplicates in existing array (shouldn't happen, but debug)
            const duplicates = prev.filter(t => t.principal === token.principal);
            if (duplicates.length > 0) {
                console.warn('%c⚠️ [TOKENS] Duplicate found!', 'background: #e74c3c; color: white;', token.principal, 'already in array', duplicates.length, 'times');
            }
            return [...prev, token];
        });
    }, []);

    // Fetch all tokens for the compact wallet - PROGRESSIVE
    const fetchCompactWalletTokens = useCallback(async () => {
        if (!identity || !isAuthenticated) {
            setWalletTokens([]);
            setWalletLoading(false);
            return;
        }

        // Increment session to invalidate any in-flight requests from previous fetches
        const sessionId = ++fetchSessionRef.current;
        
        setWalletLoading(true);
        // Don't clear tokens - keep showing existing while refreshing

        try {
            const backendActor = createBackendActor(backendCanisterId, { 
                agentOptions: { identity } 
            });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                agentOptions: { identity } 
            });

            // Track known ledgers to avoid duplicates
            const knownLedgers = new Set();

            // 1. Fetch summed locks from sneed_lock (needed for locked balances)
            // Also clear expired locks if any
            if (await sneedLockActor.has_expired_locks()) {
                await sneedLockActor.clear_expired_locks();
            }
            const summedLocksList = await sneedLockActor.get_summed_locks();
            const summedLocks = {};
            for (const [tokenLedger, amount] of summedLocksList) {
                summedLocks[tokenLedger.toString()] = amount;
            }

            // 2. Get registered ledger canister IDs from backend
            const registeredLedgers = await backendActor.get_ledger_canister_ids();
            
            // Start fetching registered tokens immediately (don't wait for RLL/tips)
            registeredLedgers.forEach(ledger => {
                const ledgerId = ledger.toString();
                if (!knownLedgers.has(ledgerId)) {
                    knownLedgers.add(ledgerId);
                    // Fire and forget - will add progressively
                    fetchTokenDetailsFast(ledger, summedLocks).then(token => {
                        if (token && fetchSessionRef.current === sessionId) {
                            addTokenProgressively(token, sessionId);
                            // Then fetch USD value and neuron totals in background
                            fetchAndUpdateConversionRate(ledger, token.decimals, sessionId);
                            // Fetch neuron data for SNS tokens (progressive)
                            fetchAndUpdateNeuronTotals(ledger, sessionId);
                        }
                    });
                }
            });

            // 3. Get reward tokens from RLL (in parallel, don't block)
            (async () => {
                try {
                    const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                    const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
                    const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
                    const rewardBalances = await rllActor.balances_of_hotkey_neurons(neurons);
                    
                    rewardBalances.forEach(balance => {
                        const ledger = balance[0];
                        const ledgerId = ledger.toString();
                        if (!knownLedgers.has(ledgerId) && fetchSessionRef.current === sessionId) {
                            knownLedgers.add(ledgerId);
                            fetchTokenDetailsFast(ledger, summedLocks).then(token => {
                                if (token && fetchSessionRef.current === sessionId) {
                                    addTokenProgressively(token, sessionId);
                                    fetchAndUpdateConversionRate(ledger, token.decimals, sessionId);
                                    fetchAndUpdateNeuronTotals(ledger, sessionId);
                                }
                            });
                        }
                    });
                } catch (rewardErr) {
                    console.warn('Could not fetch reward tokens:', rewardErr);
                }
            })();

            // 4. Get tokens from received tips (in parallel, don't block)
            (async () => {
                try {
                    const forumActor = createForumActor(forumCanisterId, {
                        agentOptions: {
                            host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
                            identity: identity,
                        },
                    });
                    const tipTokenSummaries = await getTipTokensReceivedByUser(forumActor, identity.getPrincipal());
                    
                    for (const summary of tipTokenSummaries) {
                        const ledger = summary.token_ledger_principal;
                        const ledgerId = ledger.toString();
                        if (!knownLedgers.has(ledgerId) && fetchSessionRef.current === sessionId) {
                            knownLedgers.add(ledgerId);
                            fetchTokenDetailsFast(ledger, summedLocks).then(token => {
                                if (token && fetchSessionRef.current === sessionId) {
                                    addTokenProgressively(token, sessionId);
                                    fetchAndUpdateConversionRate(ledger, token.decimals, sessionId);
                                    fetchAndUpdateNeuronTotals(ledger, sessionId);
                                }
                            });
                        }
                    }
                } catch (tipErr) {
                    console.warn('Could not fetch tip tokens:', tipErr);
                }
            })();

            setLastUpdated(new Date());
            
            // Set loading to false and hasFetchedInitial to true after tokens have had time to load
            // This prevents the brief "No tokens" flash during progressive loading
            setTimeout(() => {
                if (fetchSessionRef.current === sessionId) {
                    setHasFetchedInitial(true);
                    setWalletLoading(false);
                }
            }, 800);
            
        } catch (err) {
            console.error('Error fetching compact wallet tokens:', err);
            if (fetchSessionRef.current === sessionId) {
                setWalletLoading(false);
            }
        }
    }, [identity, isAuthenticated, fetchTokenDetailsFast, addTokenProgressively, fetchAndUpdateConversionRate, fetchAndUpdateNeuronTotals]);

    // ============================================================================
    // ICP NEURON MANAGERS
    // ============================================================================
    
    // Fetch neurons for a specific manager canister
    const fetchManagerNeuronsData = useCallback(async (managerCanisterId) => {
        if (!identity) return;
        
        const canisterIdStr = typeof managerCanisterId === 'string' ? managerCanisterId : managerCanisterId.toString();
        
        // Set loading state
        setManagerNeurons(prev => ({
            ...prev,
            [canisterIdStr]: { loading: true, neurons: prev[canisterIdStr]?.neurons || [], error: null }
        }));
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const manager = createManagerActor(canisterIdStr, { agent });
            
            // Get neuron IDs
            const neuronIds = await manager.getNeuronIds();
            
            if (!neuronIds || neuronIds.length === 0) {
                setManagerNeurons(prev => ({
                    ...prev,
                    [canisterIdStr]: { loading: false, neurons: [], error: null }
                }));
                return;
            }
            
            // Fetch neuron info for each neuron
            const neuronsData = await Promise.all(
                neuronIds.map(async (neuronId) => {
                    try {
                        const [infoResult, fullResult] = await Promise.all([
                            manager.getNeuronInfo(neuronId),
                            manager.getFullNeuron(neuronId),
                        ]);
                        
                        const neuronInfo = infoResult && infoResult.length > 0 ? infoResult[0] : null;
                        const fullNeuron = fullResult && fullResult.length > 0 ? fullResult[0] : null;
                        
                        return {
                            id: neuronId,
                            info: neuronInfo,
                            full: fullNeuron,
                        };
                    } catch (err) {
                        console.error(`Error fetching neuron ${neuronId}:`, err);
                        return { id: neuronId, info: null, full: null, error: err.message };
                    }
                })
            );
            
            setManagerNeurons(prev => ({
                ...prev,
                [canisterIdStr]: { loading: false, neurons: neuronsData, error: null }
            }));
        } catch (err) {
            console.error(`Error fetching neurons for ${canisterIdStr}:`, err);
            setManagerNeurons(prev => ({
                ...prev,
                [canisterIdStr]: { loading: false, neurons: [], error: err.message }
            }));
        }
    }, [identity]);
    
    // Fetch all ICP Neuron Managers
    const fetchNeuronManagers = useCallback(async () => {
        if (!identity || !isAuthenticated) {
            setNeuronManagers([]);
            return;
        }
        
        const sessionId = ++managersFetchSessionRef.current;
        setNeuronManagersLoading(true);
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            // Fetch managers
            const canisterIds = await factory.getMyManagers();
            
            if (managersFetchSessionRef.current !== sessionId) return;
            
            if (canisterIds.length > 0) {
                const updatedManagers = [];
                
                await Promise.all(canisterIds.map(async (canisterIdPrincipal) => {
                    const canisterId = canisterIdPrincipal.toString();
                    let currentVersion = { major: 0, minor: 0, patch: 0 };
                    let neuronCount = 0;
                    
                    try {
                        const managerActor = createManagerActor(canisterIdPrincipal, { agent });
                        const [count, version] = await Promise.all([
                            managerActor.getNeuronCount(),
                            managerActor.getVersion(),
                        ]);
                        neuronCount = Number(count);
                        currentVersion = version;
                    } catch (err) {
                        console.error(`Error fetching data for ${canisterId}:`, err);
                    }
                    
                    updatedManagers.push({ 
                        canisterId: canisterIdPrincipal, 
                        version: currentVersion, 
                        neuronCount 
                    });
                }));
                
                if (managersFetchSessionRef.current !== sessionId) return;
                
                setNeuronManagers(updatedManagers);
                setHasFetchedManagers(true);
                
                // Fetch neurons for all managers in parallel (for total calculation)
                updatedManagers.forEach(manager => {
                    fetchManagerNeuronsData(manager.canisterId.toString());
                });
            } else {
                setNeuronManagers([]);
                setHasFetchedManagers(true);
            }
        } catch (err) {
            console.error('Error fetching neuron managers:', err);
            if (managersFetchSessionRef.current === sessionId) {
                setHasFetchedManagers(true);
            }
        } finally {
            if (managersFetchSessionRef.current === sessionId) {
                setNeuronManagersLoading(false);
            }
        }
    }, [identity, isAuthenticated, fetchManagerNeuronsData]);
    
    // Calculate total ICP value from all manager neurons
    useEffect(() => {
        let totalIcp = 0;
        
        Object.values(managerNeurons).forEach(managerData => {
            if (managerData.neurons && managerData.neurons.length > 0) {
                managerData.neurons.forEach(neuron => {
                    if (neuron.info) {
                        // Add stake (in e8s)
                        totalIcp += Number(neuron.info.stake_e8s || 0) / 1e8;
                    }
                    if (neuron.full) {
                        // Add maturity (in e8s)
                        totalIcp += Number(neuron.full.maturity_e8s_equivalent || 0) / 1e8;
                        // Add staked maturity if any
                        if (neuron.full.staked_maturity_e8s_equivalent?.[0]) {
                            totalIcp += Number(neuron.full.staked_maturity_e8s_equivalent[0]) / 1e8;
                        }
                    }
                });
            }
        });
        
        setManagerNeuronsTotal(totalIcp);
    }, [managerNeurons]);
    
    // Refresh neuron managers
    const refreshNeuronManagers = useCallback(() => {
        setHasFetchedManagers(false);
        setManagerNeurons({});
        fetchNeuronManagers();
    }, [fetchNeuronManagers]);

    // Fetch tokens and positions when user authenticates
    // Always fetch fresh data in background, even if we loaded from persistent cache
    const hasFetchedFreshRef = useRef(false);
    const isFetchingRef = useRef(false); // Prevent double fetches
    
    useEffect(() => {
        if (isAuthenticated && identity) {
            // Wait for cache check to complete before deciding what to do
            // This prevents the race condition where we fetch before cache is loaded
            if (!cacheCheckComplete) {
                console.log('%c⏳ [WALLET] Waiting for cache check to complete...', 'background: #95a5a6; color: white; padding: 2px 6px;');
                return;
            }
            
            // Guard against concurrent fetches
            if (isFetchingRef.current) return;
            
            // If we loaded from cache, we have hasFetchedInitial=true but need fresh data
            // Use a ref to track if we've fetched fresh data this session
            if (loadedFromCache && !hasFetchedFreshRef.current) {
                // We have cached data showing, fetch fresh in background
                console.log('%c✨ [WALLET] Have cache, fetching fresh in background', 'background: #2ecc71; color: white; padding: 2px 6px;');
                hasFetchedFreshRef.current = true;
                isFetchingRef.current = true;
                // Don't show loading state since we have cached data
                fetchCompactWalletTokens();
                fetchCompactPositions(false, false); // Don't clear, don't show loading
                fetchNeuronManagers();
                // Reset fetching flag after a short delay
                setTimeout(() => { isFetchingRef.current = false; }, 100);
            } else if (!hasFetchedInitial && !loadedFromCache) {
                // No cached data, need to fetch from scratch
                console.log('%c🔄 [WALLET] No cache, fetching from scratch', 'background: #e74c3c; color: white; padding: 2px 6px;');
                isFetchingRef.current = true;
                fetchCompactWalletTokens();
                fetchCompactPositions(true); // Clear first since no cache
                fetchNeuronManagers();
                setTimeout(() => { isFetchingRef.current = false; }, 100);
            }
        }
        if (!isAuthenticated) {
            // Clear wallet on logout
            setWalletTokens([]);
            setLiquidityPositions([]);
            setNeuronManagers([]);
            setManagerNeurons({});
            setManagerNeuronsTotal(0);
            setNeuronCache(new Map());
            setHasFetchedInitial(false);
            setHasFetchedPositions(false);
            setHasFetchedManagers(false);
            setHasDetailedData(false);
            setLastUpdated(null);
            setLoadedFromCache(false);
            setCacheCheckComplete(false);
            hasFetchedFreshRef.current = false;
            hasInitializedFromCacheRef.current = false;
            isFetchingRef.current = false;
        }
    }, [isAuthenticated, identity, hasFetchedInitial, loadedFromCache, cacheCheckComplete, fetchCompactWalletTokens, fetchCompactPositions, fetchNeuronManagers]);

    // Update tokens from Wallet.jsx (more detailed data including locks, staked, etc.)
    const updateWalletTokens = useCallback((tokens) => {
        if (tokens && tokens.length > 0) {
            setWalletTokens(tokens);
            setLastUpdated(new Date());
            setHasDetailedData(true);
        }
    }, []);

    // Update liquidity positions (for local overrides from Wallet.jsx)
    const updateLiquidityPositions = useCallback((positions, loading = false) => {
        if (positions && positions.length > 0) {
            setLiquidityPositions(positions);
        }
        setPositionsLoading(loading);
    }, []);
    
    // Refresh positions only (without refreshing tokens)
    const refreshPositions = useCallback(() => {
        setHasFetchedPositions(false);
        fetchCompactPositions(true); // Clear first on explicit refresh
    }, [fetchCompactPositions]);

    // Set loading state
    const setLoading = useCallback((loading) => {
        setWalletLoading(loading);
    }, []);

    // Clear wallet data (e.g., on logout)
    const clearWallet = useCallback(() => {
        setWalletTokens([]);
        setLiquidityPositions([]);
        setNeuronManagers([]);
        setManagerNeurons({});
        setManagerNeuronsTotal(0);
        setNeuronCache(new Map());
        setLastUpdated(null);
        setHasFetchedInitial(false);
        setHasFetchedPositions(false);
        setHasFetchedManagers(false);
        setHasDetailedData(false);
        setLoadedFromCache(false);
        
        // Clear persistent cache too
        if (principalId) {
            clearWalletCache(principalId);
        }
    }, [principalId]);

    // Refresh tokens manually
    const refreshWallet = useCallback(() => {
        setHasFetchedInitial(false);
        setHasFetchedPositions(false);
        setHasFetchedManagers(false);
        setLoadedFromCache(false);
        // Clear neuron cache so neurons are refetched
        setNeuronCache(new Map());
        setNeuronCacheInitialized(false);
        setManagerNeurons({});
        // Note: Don't clear persistent cache on refresh - it will be updated with fresh data
        fetchCompactWalletTokens();
        fetchCompactPositions(true); // Clear first on explicit refresh
        fetchNeuronManagers();
        // Also refetch all neurons
        fetchAllSnsNeurons();
    }, [fetchCompactWalletTokens, fetchCompactPositions, fetchNeuronManagers, fetchAllSnsNeurons]);

    // Helper to calculate send amounts (frontend vs backend balance)
    const calcSendAmounts = useCallback((token, bigintAmount) => {
        const available = BigInt(token.available || token.balance || 0n);
        const balance = BigInt(token.balance || token.available || 0n);
        const available_backend = BigInt(token.available_backend || 0n);
        const fee = BigInt(token.fee || 0n);

        let send_from_frontend = 0n;
        let send_from_backend = 0n;

        if (available_backend > 0n) {
            // Has backend balance, prefer sending from backend first
            if (bigintAmount <= available_backend) {
                send_from_backend = bigintAmount;
            } else {
                send_from_backend = available_backend;
                send_from_frontend = bigintAmount - available_backend;
            }
        } else {
            // No backend balance, send from frontend only
            send_from_frontend = bigintAmount;
        }

        return { send_from_frontend, send_from_backend };
    }, []);

    // Send token function - can be used from anywhere
    const sendToken = useCallback(async (token, recipient, amount, subaccount = []) => {
        if (!identity) throw new Error('Not authenticated');

        const decimals = token.decimals || 8;
        const amountFloat = parseFloat(amount);
        const scaledAmount = amountFloat * (10 ** decimals);
        const bigintAmount = BigInt(Math.floor(scaledAmount));

        const sendAmounts = calcSendAmounts(token, bigintAmount);

        if (sendAmounts.send_from_backend + sendAmounts.send_from_frontend <= 0n) {
            throw new Error('Invalid send amounts calculated');
        }

        // Send from backend if needed
        if (sendAmounts.send_from_backend > 0n) {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const recipientPrincipal = Principal.fromText(recipient);
            
            await sneedLockActor.transfer_tokens(
                recipientPrincipal,
                subaccount,
                token.ledger_canister_id,
                sendAmounts.send_from_backend
            );
        }

        // Send from frontend if needed
        if (sendAmounts.send_from_frontend > 0n) {
            const ledgerActor = createLedgerActor(token.ledger_canister_id, {
                agentOptions: { identity }
            });

            const recipientPrincipal = Principal.fromText(recipient);
            
            await ledgerActor.icrc1_transfer({
                to: { owner: recipientPrincipal, subaccount: subaccount },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: sendAmounts.send_from_frontend
            });
        }

        // Refresh wallet after send
        refreshWallet();
    }, [identity, calcSendAmounts, refreshWallet]);

    return (
        <WalletContext.Provider value={{
            walletTokens,
            walletLoading,
            lastUpdated,
            hasDetailedData,
            hasFetchedInitial,
            loadedFromCache, // True if initial data came from browser cache
            updateWalletTokens,
            setLoading,
            clearWallet,
            refreshWallet,
            sendToken,
            isTokenSns,
            // Liquidity positions
            liquidityPositions,
            positionsLoading,
            hasFetchedPositions,
            updateLiquidityPositions,
            refreshPositions,
            // Neuron cache - global cache of all reachable neurons by governance canister
            // Independent of wallet tokens - fetches for ALL SNS on login
            neuronCache,
            neuronCacheInitialized,
            getNeuronsForGovernance,
            getCachedNeurons,
            clearNeuronCache,
            fetchAllSnsNeurons,
            // ICP Neuron Managers - shared between quick wallet and /wallet
            neuronManagers,
            managerNeurons,
            managerNeuronsTotal,
            neuronManagersLoading,
            hasFetchedManagers,
            refreshNeuronManagers,
            fetchManagerNeuronsData
        }}>
            {children}
        </WalletContext.Provider>
    );
};

export const useWallet = () => {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
};

// Optional hook that returns null if not within provider (for components that may be outside)
export const useWalletOptional = () => {
    return useContext(WalletContext);
};

export default WalletContext;
