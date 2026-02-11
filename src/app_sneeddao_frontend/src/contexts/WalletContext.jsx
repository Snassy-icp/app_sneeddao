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
import { HttpAgent, Actor } from '@dfinity/agent';
import { getTokenLogo, get_token_conversion_rate, get_token_icp_rate, get_available, get_available_backend } from '../utils/TokenUtils';
import { fetchUserNeuronsForSns, uint8ArrayToHex } from '../utils/NeuronUtils';
import { getTipTokensReceivedByUser, getTrackedCanisters, getCanisterGroups, convertGroupsFromBackend } from '../utils/BackendUtils';
import { fetchAndCacheSnsData, getAllSnses, getSnsById, buildSnsCanisterToRootMap, fetchSnsCyclesFromRoot } from '../utils/SnsUtils';
import { getNeuronsFromCacheByIds, saveNeuronsToCache, getAllNeuronsForSns, normalizeId } from '../hooks/useNeuronsCache';
import { initializeLogoCache, getLogo, setLogo, getLogoSync } from '../hooks/useLogoCache';
import { initializeTokenCache, setLedgerList, getTokenMetadataSync } from '../hooks/useTokenCache';
import { getNeuronManagerSettings, getCanisterManagerSettings } from '../utils/NeuronManagerSettings';
import { getCachedRewards, setCachedRewards } from '../hooks/useRewardsCache';
import priceService from '../services/PriceService';

const WalletContext = createContext(null);

// Management canister for checking controller status
const MANAGEMENT_CANISTER_ID = 'aaaaa-aa';
const managementCanisterIdlFactory = ({ IDL }) => {
    return IDL.Service({
        canister_status: IDL.Func(
            [IDL.Record({ canister_id: IDL.Principal })],
            [IDL.Record({
                status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
                memory_size: IDL.Nat,
                cycles: IDL.Nat,
                settings: IDL.Record({
                    freezing_threshold: IDL.Nat,
                    controllers: IDL.Vec(IDL.Principal),
                    memory_allocation: IDL.Nat,
                    compute_allocation: IDL.Nat,
                }),
                module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
            })],
            []
        ),
    });
};

// ============================================================================
// PERSISTENT CACHE HELPERS (IndexedDB - much larger quota than localStorage)
// ============================================================================

const WALLET_DB_NAME = 'sneed_wallet_cache';
const WALLET_DB_VERSION = 1;
const WALLET_STORE_NAME = 'walletData';
const CACHE_VERSION = 3; // Increment when cache structure changes - v3: fixed duplicates & neuron merge

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
        // Detect Principal objects by various methods
        if (value && typeof value === 'object') {
            // Check for Principal-like objects (has toText method or _isPrincipal flag)
            if (value._isPrincipal || (typeof value.toText === 'function' && typeof value._arr !== 'undefined')) {
                return { __type: 'Principal', value: value.toText?.() || value.toString() };
            }
            if (value instanceof Principal) {
                return { __type: 'Principal', value: value.toText() };
            }
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
    
    const safePrincipalFromText = (value) => {
        if (!value) return null;
        try {
            return Principal.fromText(value);
        } catch {
            return value;
        }
    };

    const revive = (value) => {
        if (value && typeof value === 'object') {
            if (value.__type) {
                switch (value.__type) {
                    case 'BigInt':
                        return BigInt(value.value);
                    case 'Principal':
                        return safePrincipalFromText(value.value);
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
                        case 'Principal': {
                            try {
                                return Principal.fromText(value.value);
                            } catch {
                                return value.value;
                            }
                        }
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

// Helper: get critical cycle level for ICP Staking Bots (from localStorage settings)
function _getNeuronManagerCriticalLevel() {
    const s = getNeuronManagerSettings();
    return s.cycleThresholdRed || 1_000_000_000_000;
}
function _getNeuronManagerHealthyLevel() {
    const s = getNeuronManagerSettings();
    return s.cycleThresholdOrange || 5_000_000_000_000;
}

// Helper: get critical cycle level for generic tracked canisters
function _getCanisterCriticalLevel() {
    const s = getCanisterManagerSettings();
    return s.cycleThresholdRed || 1_000_000_000_000;
}
function _getCanisterHealthyLevel() {
    const s = getCanisterManagerSettings();
    return s.cycleThresholdOrange || 5_000_000_000_000;
}

// ============================================================================
// WALLET PROVIDER
// ============================================================================

export const WalletProvider = ({ children }) => {
    const { identity, isAuthenticated } = useAuth();
    
    // Initialize caches on mount (loads from IndexedDB into memory)
    useEffect(() => {
        initializeLogoCache();
        initializeTokenCache();
    }, []);
    
    // Tokens from the wallet - same structure as Wallet.jsx tokens state
    const [walletTokens, setWalletTokens] = useState([]);
    const [walletLoading, setWalletLoading] = useState(false);
    // Map of ledgerId → 'balance' | 'full' for refresh phase tracking (shared with quick wallet)
    const [refreshingTokens, setRefreshingTokens] = useState(new Map());
    
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
    
    // Shared ICP price - ensures Wallet and Quick Wallet use the same price
    const [icpPrice, setIcpPrice] = useState(null);
    
    // Fetch ICP price (shared between all consumers)
    const fetchIcpPrice = useCallback(async () => {
        try {
            const price = await priceService.getICPUSDPrice();
            setIcpPrice(price);
            return price;
        } catch (error) {
            console.error('Error fetching ICP price:', error);
            return null;
        }
    }, []);
    
    // Global neuron cache - stores all reachable neurons by governance canister ID
    // This cache is independent of wallet tokens and used by:
    // - Wallet token cards (staked amounts)
    // - Quick wallet
    // - VP bar
    // - /me page neurons tab
    // - Forum voting
    // - Any component that needs neuron data
    const [neuronCache, setNeuronCache] = useState(new Map()); // Map<governanceCanisterId, neuron[]>
    const [neuronCacheInitialized, setNeuronCacheInitialized] = useState(false);
    const neuronCacheFetchSessionRef = useRef(0);
    // Refs to always access the latest cache values (avoids stale closure issues in async callbacks)
    const neuronCacheRef = useRef(new Map());
    // In-flight request deduplication: Map<govId, Promise<neuron[]>>
    // When a fetch is in progress, subsequent callers await the same promise instead of making duplicate requests
    const neuronFetchPromisesRef = useRef(new Map());
    // Keep ref in sync with state
    useEffect(() => {
        neuronCacheRef.current = neuronCache;
    }, [neuronCache]);
    
    // ICP Neuron Managers - shared between quick wallet and /wallet page
    const [neuronManagers, setNeuronManagers] = useState([]); // Array of { canisterId, version }
    const [managerNeurons, setManagerNeurons] = useState({}); // canisterId -> { loading, neurons, error }
    const [managerNeuronsTotal, setManagerNeuronsTotal] = useState(0); // Total ICP value
    const [neuronManagersLoading, setNeuronManagersLoading] = useState(false);
    const [hasFetchedManagers, setHasFetchedManagers] = useState(false);
    const managersFetchSessionRef = useRef(0);
    
    // Chore statuses for neuron managers - shared between quick wallet and /wallet page
    const [managerChoreStatuses, setManagerChoreStatuses] = useState({}); // canisterId -> choreStatuses[]
    
    // Official bot versions - shared for outdated detection across all UI surfaces
    const [officialVersions, setOfficialVersions] = useState([]);
    const [latestOfficialVersion, setLatestOfficialVersion] = useState(null);
    
    // Controller status for neuron managers - shared between quick wallet and /wallet page
    const [neuronManagerIsController, setNeuronManagerIsController] = useState({}); // canisterId -> boolean
    
    // Tracked Canisters (wallet canisters) - shared between quick wallet and /wallet page
    const [trackedCanisters, setTrackedCanisters] = useState([]); // Array of canister ID strings
    const [trackedCanistersLoading, setTrackedCanistersLoading] = useState(false);
    const [hasFetchedTrackedCanisters, setHasFetchedTrackedCanisters] = useState(false);
    const trackedCanistersFetchSessionRef = useRef(0);
    
    // Controller status for tracked canisters - shared between quick wallet and /wallet page
    const [trackedCanisterIsController, setTrackedCanisterIsController] = useState({}); // canisterId -> boolean
    
    // Cycles data - shared for low-cycles notifications across Header, Wallet, PrincipalBox
    const [neuronManagerCycles, setNeuronManagerCycles] = useState({}); // canisterId -> number|null
    const [trackedCanisterCycles, setTrackedCanisterCycles] = useState({}); // canisterId -> number|null
    
    // App manager canisters (canister groups from /apps page) - for low-cycles notifications
    const [appManagerCanisters, setAppManagerCanisters] = useState([]); // Array of canister ID strings
    const [appManagerCanisterIsController, setAppManagerCanisterIsController] = useState({}); // canisterId -> boolean
    const [appManagerCanisterCycles, setAppManagerCanisterCycles] = useState({}); // canisterId -> number|null
    
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
            try {
                // First try to migrate from old localStorage cache (one-time)
                let cachedData = await migrateFromLocalStorage(principalId);
                
                // If no migrated data, load from IndexedDB
                if (!cachedData) {
                    cachedData = await loadWalletCache(principalId);
                }
                
                if (cachedData) {
                    // Restore tokens (with deduplication by principal)
                    if (cachedData.walletTokens && cachedData.walletTokens.length > 0) {
                        const seenPrincipals = new Set();
                        const deduplicatedTokens = cachedData.walletTokens.filter(token => {
                            const principal = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
                            if (!principal) return false;
                            if (seenPrincipals.has(principal)) return false;
                            seenPrincipals.add(principal);
                            return true;
                        });
                        
                        // Load cached rewards and apply to tokens
                        const cachedRewards = await getCachedRewards(principalId);
                        const tokensWithRewards = deduplicatedTokens.map(token => {
                            const tokenId = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
                            const reward = cachedRewards?.[tokenId];
                            if (reward !== undefined) {
                                return { ...token, rewards: reward };
                            }
                            return token;
                        });
                        
                        setWalletTokens(tokensWithRewards);
                        setHasFetchedInitial(true);
                    }
                    
                    // Restore positions (with deduplication)
                    if (cachedData.liquidityPositions && cachedData.liquidityPositions.length > 0) {
                        // Deduplicate by swapCanisterId (using normalizeId for Principal/string insensitivity)
                        const seenSwapIds = new Set();
                        const deduplicatedPositions = cachedData.liquidityPositions.filter(pos => {
                            const swapId = normalizeId(pos.swapCanisterId);
                            if (!swapId) return false;
                            if (seenSwapIds.has(swapId)) return false;
                            seenSwapIds.add(swapId);
                            return true;
                        });
                        
                        // Also deduplicate inner positions arrays
                        const cleanedPositions = deduplicatedPositions.map(lp => {
                            if (!lp.positions || lp.positions.length === 0) return lp;
                            const seenPositionIds = new Set();
                            const cleanedInnerPositions = lp.positions.filter(pos => {
                                const posId = normalizeId(pos.positionId);
                                if (seenPositionIds.has(posId)) return false;
                                seenPositionIds.add(posId);
                                return true;
                            });
                            return { ...lp, positions: cleanedInnerPositions };
                        });
                        
                        setLiquidityPositions(cleanedPositions);
                        setHasFetchedPositions(true);
                        hasPositionsRef.current = true;
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
                            
                            // Normalize governance ID for consistent cache keys
                            const normalizedGovId = normalizeId(governanceId);
                            
                            // Skip governance IDs with 0 neuron IDs - don't add empty arrays
                            // (empty arrays would block fresh fetches later)
                            if (!neuronIds || neuronIds.length === 0) {
                                continue;
                            }
                            
                            // Find SNS root for this governance canister
                            const allSnses = getAllSnses();
                            const sns = allSnses.find(s => normalizeId(s.canisters?.governance) === normalizedGovId);
                            const snsRoot = sns?.rootCanisterId;
                            
                            if (snsRoot) {
                                // Try to hydrate from shared IndexedDB cache
                                try {
                                    const { found, missing } = await getNeuronsFromCacheByIds(snsRoot, neuronIds);
                                    // Only add to map if we found actual neurons
                                    if (found && found.length > 0) {
                                        hydratedMap.set(normalizedGovId, found);
                                    }
                                    // Note: missing neurons will be fetched fresh by fetchAndCacheNeurons
                                } catch (e) {
                                    console.warn('Failed to hydrate neurons from cache:', e);
                                }
                            } else if (Array.isArray(neuronDataOrIds) && neuronDataOrIds[0]?.id) {
                                // No SNS mapping but we have old format full objects - use them directly
                                hydratedMap.set(normalizedGovId, neuronDataOrIds);
                            }
                        }
                        
                        // IMPORTANT: Update ref IMMEDIATELY before state update
                        // This prevents race conditions where other code checks the ref before the useEffect runs
                        if (hydratedMap.size > 0) {
                            neuronCacheRef.current = hydratedMap;
                            setNeuronCache(hydratedMap);
                        }
                        // Always mark as initialized after hydration attempt so consumers know cache check is done
                        setNeuronCacheInitialized(true);
                    } else {
                        // No cached neuron data, but still mark as initialized so consumers don't wait forever
                        setNeuronCacheInitialized(true);
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
                    
                    // Restore tracked canisters
                    if (cachedData.trackedCanisters && cachedData.trackedCanisters.length > 0) {
                        setTrackedCanisters(cachedData.trackedCanisters);
                        setHasFetchedTrackedCanisters(true);
                    }
                    
                    // Restore last updated
                    if (cachedData.lastUpdated) {
                        setLastUpdated(new Date(cachedData.lastUpdated));
                    }
                    
                    setLoadedFromCache(true);
                }
            } catch (error) {
                console.error('[WalletContext] Error loading cache:', error);
            } finally {
                // ALWAYS mark cache check as complete, even if there was an error
                setCacheCheckComplete(true);
            }
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
            
            saveWalletCache(principalId, {
                walletTokens,
                liquidityPositions,
                neuronCacheIds, // Store only IDs, not full neuron objects
                neuronManagers,
                managerNeurons,
                managerNeuronsTotal,
                trackedCanisters,
                lastUpdated: lastUpdated?.getTime() || Date.now()
            });
        }, 2000); // Save 2 seconds after last change
        
        return () => {
            if (saveCacheTimeoutRef.current) {
                clearTimeout(saveCacheTimeoutRef.current);
            }
        };
    }, [principalId, isAuthenticated, walletTokens, liquidityPositions, neuronCache, neuronManagers, managerNeurons, managerNeuronsTotal, trackedCanisters, lastUpdated, hasFetchedInitial, loadedFromCache]);

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

        const ledgerId = ledgerCanisterId.toString();
        
        try {
            const ledgerActor = createLedgerActor(ledgerCanisterId, {
                agentOptions: { identity }
            });

            const principal = identity.getPrincipal();
            const subaccount = principalToSubAccount(principal);

            // Check for cached logo first (instant display)
            const cachedLogo = getLogoSync(ledgerId);

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

            // Get logo from metadata
            let logo = getTokenLogo(metadata);
            
            // Handle ICP special case
            if (symbol.toLowerCase() === "icp" && logo === "") {
                logo = "icp_symbol.svg";
            }
            
            // Use cached logo if we didn't get one from metadata
            if (!logo && cachedLogo) {
                logo = cachedLogo;
            }
            
            // Cache logo in unified logo cache (persists to IndexedDB)
            if (logo && logo !== '' && logo !== cachedLogo) {
                setLogo(ledgerId, logo); // Fire and forget
            }
            
            // Get locked amount from summedLocks map
            const locked = summedLocks[ledgerId] || BigInt(0);

            // Create token object with all balances
            const token = {
                principal: ledgerId,
                ledger_canister_id: ledgerCanisterId,
                symbol,
                decimals,
                fee,
                logo,
                balance,
                balance_backend,
                locked,
                conversion_rate: null, // Will be fetched progressively
                icp_rate: null, // Will be fetched progressively
                usdValue: null
            };

            // Calculate available balances using same logic as Wallet.jsx
            token.available_backend = get_available_backend(token);
            token.available = get_available(token);

            return token;
        } catch (error) {
            console.error(`Error fetching token details for ${ledgerId}:`, error);
            // Return minimal token with cached logo if available
            const cachedLogo = getLogoSync(ledgerId);
            if (cachedLogo) {
                return {
                    principal: ledgerId,
                    ledger_canister_id: ledgerCanisterId,
                    logo: cachedLogo,
                    error: true
                };
            }
            return null;
        }
    }, [identity]);

    // Fetch conversion rate and ICP rate for a token and update it in place
    const fetchAndUpdateConversionRate = useCallback(async (ledgerCanisterId, decimals, sessionId) => {
        try {
            const ledgerIdStr = ledgerCanisterId.toString();
            const [conversion_rate, icp_rate] = await Promise.all([
                get_token_conversion_rate(ledgerIdStr, decimals),
                get_token_icp_rate(ledgerIdStr, decimals)
            ]);
            
            // Only update if still in same fetch session
            if (fetchSessionRef.current === sessionId) {
                const targetLedger = normalizeId(ledgerCanisterId);
                setWalletTokens(prev => prev.map(token => {
                    const tokenId = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
                    if (tokenId === targetLedger) {
                        const balance = BigInt(token.available || token.balance || 0n);
                        const balanceNum = Number(balance) / (10 ** (token.decimals || 8));
                        const usdValue = conversion_rate ? balanceNum * conversion_rate : null;
                        return { ...token, conversion_rate, icp_rate, usdValue };
                    }
                    return token;
                }));
            }
        } catch (error) {
            console.warn(`Could not fetch conversion rate for ${ledgerCanisterId}:`, error);
        }
    }, []);

    // Ref to always access latest walletTokens (avoids stale closure in refreshTokenBalance)
    const walletTokensRef = useRef(walletTokens);
    useEffect(() => { walletTokensRef.current = walletTokens; }, [walletTokens]);

    // Safely compute available balance, tolerating missing fields
    const safeGetAvailable = useCallback((token) => {
        try {
            return get_available(token);
        } catch {
            // If balance_backend or locked are missing/invalid, just use balance directly
            return BigInt(token.balance || 0n);
        }
    }, []);

    // Refresh a single token's balance quickly (e.g., after a swap)
    // Does balance-first update then full rate refresh in background
    const refreshTokenBalance = useCallback(async (ledgerCanisterId) => {
        if (!identity || !isAuthenticated) return;
        const lid = normalizeId(ledgerCanisterId);
        if (!lid) {
            console.warn('refreshTokenBalance: invalid ledgerCanisterId', ledgerCanisterId);
            return;
        }

        console.log(`[refreshTokenBalance] START for ${lid}`);

        // Phase 1: fast balance fetch
        setRefreshingTokens(prev => new Map(prev).set(lid, 'balance'));
        try {
            const ledgerPrincipal = typeof ledgerCanisterId === 'string'
                ? Principal.fromText(lid)
                : ledgerCanisterId;
            const ledgerActor = createLedgerActor(ledgerPrincipal, { agentOptions: { identity } });
            const freshBalance = await ledgerActor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });

            console.log(`[refreshTokenBalance] Phase 1 balance fetched for ${lid}:`, freshBalance?.toString());

            // Update balance immediately
            let foundMatch = false;
            setWalletTokens(prev => prev.map(token => {
                const tokenId = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
                if (tokenId === lid) {
                    foundMatch = true;
                    const updated = { ...token, balance: freshBalance };
                    // Safely compute available - don't crash if balance_backend/locked missing
                    updated.available = safeGetAvailable(updated);
                    return updated;
                }
                return token;
            }));

            if (!foundMatch) {
                console.warn(`[refreshTokenBalance] No matching token found in walletTokens for ${lid}`);
            }

            // Phase 2: subtle pulse while rates refresh
            setRefreshingTokens(prev => new Map(prev).set(lid, 'full'));

            // Refresh conversion rates in background
            // Use ref to get latest walletTokens (avoids stale closure)
            const currentTokens = walletTokensRef.current;
            const existingToken = currentTokens.find(t => 
                (normalizeId(t.principal) || normalizeId(t.ledger_canister_id)) === lid
            );
            if (existingToken) {
                const decimals = existingToken.decimals || 8;
                try {
                    const [conversion_rate, icp_rate] = await Promise.all([
                        get_token_conversion_rate(lid, decimals),
                        get_token_icp_rate(lid, decimals)
                    ]);
                    setWalletTokens(prev => prev.map(token => {
                        const tokenId = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
                        if (tokenId === lid) {
                            try {
                                const balance = BigInt(token.available || token.balance || 0n);
                                const balanceNum = Number(balance) / (10 ** (token.decimals || 8));
                                const usdValue = conversion_rate ? balanceNum * conversion_rate : null;
                                return { ...token, conversion_rate, icp_rate, usdValue };
                            } catch {
                                return { ...token, conversion_rate, icp_rate };
                            }
                        }
                        return token;
                    }));
                    console.log(`[refreshTokenBalance] Phase 2 rates updated for ${lid}`);
                } catch (rateErr) {
                    console.warn(`refreshTokenBalance: rate fetch failed for ${lid}:`, rateErr);
                }
            } else {
                console.warn(`[refreshTokenBalance] No existing token for rate refresh of ${lid}`);
            }
        } catch (error) {
            console.warn(`[refreshTokenBalance] Error for ${lid}:`, error);
        } finally {
            setRefreshingTokens(prev => {
                const next = new Map(prev);
                next.delete(lid);
                return next;
            });
            console.log(`[refreshTokenBalance] DONE for ${lid}`);
        }
    }, [identity, isAuthenticated, safeGetAvailable]);

    // Fetch neurons for a governance canister and cache them
    // Uses promise-based request deduplication - if a fetch is in-flight, subsequent callers share the same promise
    const fetchAndCacheNeurons = useCallback(async (governanceCanisterId) => {
        // Normalize the governance canister ID (accepts Principal or string)
        const govId = normalizeId(governanceCanisterId);
        if (!govId) return [];
        
        if (!identity) {
            return [];
        }
        
        // Check if already in memory cache with actual neurons (use ref to get latest value, avoid stale closure)
        // Don't return empty arrays - those might be from failed hydration
        const cachedNeurons = neuronCacheRef.current.get(govId);
        if (cachedNeurons && cachedNeurons.length > 0) {
            return cachedNeurons;
        }
        
        // Check if there's already an in-flight request for this govId (request deduplication)
        const existingPromise = neuronFetchPromisesRef.current.get(govId);
        if (existingPromise) {
            return existingPromise;
        }
        
        // Create the fetch promise and store it for deduplication
        const fetchPromise = (async () => {
            try {
                // Find the SNS for this governance canister
                const allSnses = getAllSnses();
                const sns = allSnses.find(s => normalizeId(s.canisters?.governance) === govId);
                
                // IMPORTANT: Always fetch user's neurons from network first.
                // This is the user-specific call that returns only neurons where the user
                // is a hotkey/controller. The IndexedDB cache stores ALL neurons for an SNS
                // (global data), but we need the user-specific list from the network.
                const neurons = await fetchUserNeuronsForSns(identity, govId);
                
                // Cache the neurons in memory
                neuronCacheRef.current.set(govId, neurons);
                setNeuronCache(prev => new Map(prev).set(govId, neurons));
                
                // Also save to the shared IndexedDB cache for persistence
                if (sns?.rootCanisterId) {
                    saveNeuronsToCache(sns.rootCanisterId, neurons).catch(() => {});
                }
                
                return neurons;
            } catch (error) {
                console.warn(`Could not fetch neurons for governance ${govId}:`, error);
                return [];
            } finally {
                // Remove from in-flight promises when done (success or failure)
                neuronFetchPromisesRef.current.delete(govId);
            }
        })();
        
        // Store the promise for deduplication
        neuronFetchPromisesRef.current.set(govId, fetchPromise);
        
        return fetchPromise;
    }, [identity]); // Using refs for cache access to avoid stale closures
    
    // Get neurons from cache (or fetch if not cached)
    const getNeuronsForGovernance = useCallback(async (governanceCanisterId) => {
        return fetchAndCacheNeurons(governanceCanisterId);
    }, [fetchAndCacheNeurons]);
    
    // Get cached neurons synchronously (returns empty array if not yet loaded)
    // Uses ref for truly synchronous access - state might be stale due to React's async updates
    const getCachedNeurons = useCallback((governanceCanisterId) => {
        const govId = normalizeId(governanceCanisterId);
        return neuronCacheRef.current.get(govId) || [];
    }, []);
    
    // Clear neuron cache (e.g., on refresh)
    const clearNeuronCache = useCallback((governanceCanisterId = null) => {
        if (governanceCanisterId) {
            const govId = normalizeId(governanceCanisterId);
            neuronCacheRef.current.delete(govId);
            neuronFetchPromisesRef.current.delete(govId);
            setNeuronCache(prev => {
                const newMap = new Map(prev);
                newMap.delete(govId);
                return newMap;
            });
        } else {
            neuronCacheRef.current = new Map();
            neuronFetchPromisesRef.current.clear();
            setNeuronCache(new Map());
            setNeuronCacheInitialized(false);
        }
    }, []);

    // Refresh neurons for a specific governance (clear + refetch). Use after transfer, escrow, permission changes.
    const refreshNeuronsForGovernance = useCallback(async (governanceCanisterId) => {
        if (!governanceCanisterId || !identity) return;
        const govId = normalizeId(governanceCanisterId);
        clearNeuronCache(govId);
        return fetchAndCacheNeurons(govId);
    }, [identity, clearNeuronCache, fetchAndCacheNeurons]);

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
                
                const normalizedGovId = normalizeId(governanceCanisterId);
                
                // Skip if already cached with actual neurons (not just empty array) or in-flight
                const existingNeurons = neuronCacheRef.current.get(normalizedGovId);
                if (existingNeurons && existingNeurons.length > 0) continue;
                if (neuronFetchPromisesRef.current.has(normalizedGovId)) continue;
                
                // Fire and forget - don't await, let them load in parallel
                fetchAndCacheNeurons(normalizedGovId).catch(err => {
                    console.warn(`[WalletContext] Failed to fetch neurons for ${sns.name || governanceCanisterId}:`, err);
                });
            }
            
            setNeuronCacheInitialized(true);
        } catch (error) {
            console.warn('[WalletContext] Error fetching all SNS neurons:', error);
        }
    }, [identity, isAuthenticated, neuronCache, fetchAndCacheNeurons]);

    // Refresh all SNS neurons. Use when we don't know which SNS was affected (e.g. received neuron from Sneedex).
    const refreshAllNeurons = useCallback(async () => {
        if (!identity || !isAuthenticated) return;
        clearNeuronCache();
        await fetchAllSnsNeurons();
    }, [identity, isAuthenticated, clearNeuronCache, fetchAllSnsNeurons]);

    // Proactively fetch neurons for all SNS on login
    // Wait for cacheCheckComplete to avoid redundant network fetches when cache has data
    useEffect(() => {
        // Check if cache has any ACTUAL neurons (not just empty arrays from failed hydration)
        const hasActualNeurons = Array.from(neuronCacheRef.current.values()).some(neurons => neurons && neurons.length > 0);
        
        // Fetch if: authenticated, cache check done, and no actual neurons in cache
        if (isAuthenticated && identity && cacheCheckComplete && !hasActualNeurons) {
            fetchAllSnsNeurons();
        }
        if (!isAuthenticated) {
            setNeuronCache(new Map());
            neuronCacheRef.current = new Map();
            setNeuronCacheInitialized(false);
        }
    }, [isAuthenticated, identity, cacheCheckComplete, fetchAllSnsNeurons]);

    // Fetch neuron totals for an SNS token and update it in place (uses cache)
    const fetchAndUpdateNeuronTotals = useCallback(async (ledgerCanisterId, sessionId) => {
        const ledgerId = ledgerCanisterId.toString();
        
        try {
            // Find the governance canister for this SNS
            // Use getAllSnses() directly instead of snsTokenLedgers state to avoid race condition
            let allSnses = getAllSnses();
            
            // If SNS data isn't loaded yet (cache was cleared), wait for it to load
            if (allSnses.length === 0) {
                // Wait up to 10 seconds for SNS data to load, checking every 200ms
                for (let i = 0; i < 50; i++) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    if (fetchSessionRef.current !== sessionId) return;
                    allSnses = getAllSnses();
                    if (allSnses.length > 0) break;
                }
            }
            
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
            
            const targetLedger = normalizeId(ledgerId);
            setWalletTokens(prev => prev.map(token => {
                const tokenId = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
                if (tokenId === targetLedger) {
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
    }, [identity, fetchAndCacheNeurons]);

    // Fetch and update rewards for all tokens (stores on tokens, caches to IndexedDB)
    const fetchAndUpdateRewards = useCallback(async (sessionId) => {
        if (!identity) return;
        
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
            const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
            const rewardBalances = await rllActor.balances_of_hotkey_neurons(neurons);
            
            // Build rewards map
            const rewardsMap = {};
            rewardBalances.forEach(balance => {
                const ledgerId = normalizeId(balance[0]);
                rewardsMap[ledgerId] = BigInt(balance[1]);
            });
            
            // Save rewards to cache (for instant load next time)
            setCachedRewards(identity.getPrincipal(), rewardsMap);
            
            // Update all tokens with their reward amounts
            if (fetchSessionRef.current === sessionId) {
                setWalletTokens(prev => prev.map(token => {
                    const tokenId = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
                    const reward = rewardsMap[tokenId];
                    if (reward !== undefined) {
                        return { ...token, rewards: reward };
                    }
                    // Set to 0n if no rewards (not undefined) - indicates "loaded, no rewards"
                    if (token.rewards === undefined) {
                        return { ...token, rewards: 0n };
                    }
                    return token;
                }));
            }
            
            return rewardsMap;
        } catch (error) {
            console.warn('Could not fetch rewards:', error);
            return {};
        }
    }, [identity]);

    // Add a position progressively as it loads
    const addPositionProgressively = useCallback((positionData, sessionId) => {
        if (positionsFetchSessionRef.current !== sessionId) return;
        
        setLiquidityPositions(prev => {
            // Normalize swapCanisterId for comparison (Principal/string insensitive)
            const newSwapId = normalizeId(positionData.swapCanisterId);
            
            // Check if LP already exists (normalize comparison)
            const existingIndex = prev.findIndex(p => normalizeId(p.swapCanisterId) === newSwapId);
            
            if (existingIndex >= 0) {
                // Update existing LP, preserving conversion rates if new data doesn't have them
                const existing = prev[existingIndex];
                
                // Deduplicate inner positions array by positionId
                let mergedPositions = positionData.positions || [];
                if (existing.positions && existing.positions.length > 0 && mergedPositions.length > 0) {
                    const seenPositionIds = new Set();
                    mergedPositions = mergedPositions.filter(pos => {
                        const posId = normalizeId(pos.positionId);
                        if (seenPositionIds.has(posId)) return false;
                        seenPositionIds.add(posId);
                        return true;
                    });
                }
                
                const merged = {
                    ...existing,
                    ...positionData,
                    positions: mergedPositions,
                    // Preserve cached conversion rates if new data has 0 (meaning "not yet fetched")
                    // Only overwrite if new rate is non-zero (actual fetched value)
                    token0_conversion_rate: (positionData.token0_conversion_rate && positionData.token0_conversion_rate !== 0) 
                        ? positionData.token0_conversion_rate 
                        : existing.token0_conversion_rate,
                    token1_conversion_rate: (positionData.token1_conversion_rate && positionData.token1_conversion_rate !== 0) 
                        ? positionData.token1_conversion_rate 
                        : existing.token1_conversion_rate
                };
                return prev.map((p, i) => i === existingIndex ? merged : p);
            }
            
            // New LP - also deduplicate inner positions
            let newPositions = positionData.positions || [];
            const seenPositionIds = new Set();
            newPositions = newPositions.filter(pos => {
                const posId = normalizeId(pos.positionId);
                if (seenPositionIds.has(posId)) return false;
                seenPositionIds.add(posId);
                return true;
            });
            
            return [...prev, { ...positionData, positions: newPositions }];
        });
    }, []);

    // Fetch conversion rate for a position and update it in place
    const fetchPositionConversionRates = useCallback(async (swapCanisterId, ledger0, ledger1, decimals0, decimals1, sessionId) => {
        try {
            const targetSwapId = normalizeId(swapCanisterId);
            
            const [rate0, rate1] = await Promise.all([
                get_token_conversion_rate(ledger0, decimals0).catch(() => 0),
                get_token_conversion_rate(ledger1, decimals1).catch(() => 0)
            ]);
            
            if (positionsFetchSessionRef.current === sessionId) {
                setLiquidityPositions(prev => prev.map(p => {
                    if (normalizeId(p.swapCanisterId) === targetSwapId) {
                        return { ...p, token0_conversion_rate: rate0, token1_conversion_rate: rate1 };
                    }
                    return p;
                }));
            }
        } catch (e) {
            // Silently ignore conversion rate fetch failures
        }
    }, []);

    // Keep ref in sync with liquidityPositions length
    useEffect(() => {
        hasPositionsRef.current = liquidityPositions.length > 0;
    }, [liquidityPositions]);
    
    // Fetch compact positions for the quick wallet - PROGRESSIVE
    const fetchCompactPositions = useCallback(async (clearFirst = false, showLoading = true) => {
        if (!identity || !isAuthenticated) {
            setLiquidityPositions([]);
            setPositionsLoading(false);
            return;
        }

        const sessionId = ++positionsFetchSessionRef.current;
        
        // Only clear positions if explicitly requested (e.g., on manual refresh)
        if (clearFirst) {
            setLiquidityPositions([]);
            hasPositionsRef.current = false;
        }
        
        // Only show loading spinner if requested AND we have no data to show
        const shouldShowLoading = showLoading && (clearFirst || !hasPositionsRef.current);
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
                    const normalizedSwapCanister = normalizeId(swap_canister);
                    const claimed_positions_for_swap = claimed_positions.filter(cp => normalizeId(cp.swap_canister_id) === normalizedSwapCanister);
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
            // Normalize principal for comparison - try both principal and ledger_canister_id
            const newPrincipal = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
            
            // Check if token already exists (using normalized comparison of both principal AND ledger_canister_id)
            const existingIndex = prev.findIndex(t => {
                const existingPrincipal = normalizeId(t.principal) || normalizeId(t.ledger_canister_id);
                return existingPrincipal === newPrincipal;
            });
            
            if (existingIndex >= 0) {
                // IMPORTANT: Merge with existing token to preserve neuron data loaded from cache
                const existing = prev[existingIndex];
                const merged = {
                    ...existing, // Keep existing neuron data, usdValue, etc.
                    ...token,    // Override with fresh balance, metadata
                    // Explicitly preserve neuron-related fields from cache
                    neuronStake: token.neuronStake || existing.neuronStake,
                    neuronMaturity: token.neuronMaturity || existing.neuronMaturity,
                    neuronsLoaded: token.neuronsLoaded || existing.neuronsLoaded,
                    // Preserve usdValue and rates if new token doesn't have them
                    usdValue: token.usdValue ?? existing.usdValue,
                    conversion_rate: token.conversion_rate ?? existing.conversion_rate,
                    icp_rate: token.icp_rate ?? existing.icp_rate
                };
                return prev.map((t, i) => i === existingIndex ? merged : t);
            }
            return [...prev, token];
        });
    }, []);

    // Ensure a token is registered in the backend and present in walletTokens
    // If already present, does nothing. Otherwise registers with backend and fetches details.
    const ensureTokenRegistered = useCallback(async (ledgerCanisterId) => {
        if (!identity || !isAuthenticated) return;
        const lid = normalizeId(ledgerCanisterId);
        if (!lid) return;

        // Check if already in walletTokens
        const currentTokens = walletTokensRef.current;
        const exists = currentTokens.some(t =>
            (normalizeId(t.principal) || normalizeId(t.ledger_canister_id)) === lid
        );
        if (exists) return; // Already registered

        try {
            console.log(`[ensureTokenRegistered] Registering ${lid} with backend`);
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            await backendActor.register_ledger_canister_id(Principal.fromText(lid));

            // Fetch token details and add to wallet
            const token = await fetchTokenDetailsFast(Principal.fromText(lid), {});
            if (token) {
                addTokenProgressively(token, fetchSessionRef.current);
                // Fetch conversion rate in background
                fetchAndUpdateConversionRate(Principal.fromText(lid), token.decimals, fetchSessionRef.current);
            }
            console.log(`[ensureTokenRegistered] Successfully registered ${lid}`);
        } catch (err) {
            console.warn(`[ensureTokenRegistered] Failed for ${lid}:`, err);
        }
    }, [identity, isAuthenticated, fetchTokenDetailsFast, addTokenProgressively, fetchAndUpdateConversionRate]);

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
            
            // Cache the registered ledgers list
            setLedgerList('registered', registeredLedgers);
            
            // Start fetching registered tokens immediately (don't wait for RLL/tips)
            // Collect promises so we know when initial fetch is done
            const registeredTokenPromises = [];
            registeredLedgers.forEach(ledger => {
                const ledgerId = ledger.toString();
                if (!knownLedgers.has(ledgerId)) {
                    knownLedgers.add(ledgerId);
                    // Fire and forget - will add progressively
                    const promise = fetchTokenDetailsFast(ledger, summedLocks).then(token => {
                        if (token && fetchSessionRef.current === sessionId) {
                            addTokenProgressively(token, sessionId);
                            // Then fetch USD value and neuron totals in background
                            fetchAndUpdateConversionRate(ledger, token.decimals, sessionId);
                            fetchAndUpdateNeuronTotals(ledger, sessionId);
                        }
                    }).catch(() => {});
                    registeredTokenPromises.push(promise);
                }
            });
            
            // Wait for all registered token fetches to complete before marking as fetched
            // This prevents the "No tokens" flash when network is slow
            // Use a timeout race to ensure walletLoading is reset even if a canister is unresponsive
            const allSettledPromise = Promise.allSettled(registeredTokenPromises);
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, 30000)); // 30s safety net
            Promise.race([allSettledPromise, timeoutPromise]).then(() => {
                if (fetchSessionRef.current === sessionId) {
                    setHasFetchedInitial(true);
                    setWalletLoading(false);
                }
            });

            // 3. Get rewards from RLL and update tokens (in parallel, don't block)
            // This both discovers new tokens with rewards AND updates reward amounts on all tokens
            (async () => {
                try {
                    // Fetch rewards and update all tokens with reward amounts
                    const rewardsMap = await fetchAndUpdateRewards(sessionId);
                    
                    // Also discover new tokens that have rewards (but aren't in registered list)
                    const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                    const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
                    const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
                    const rewardBalances = await rllActor.balances_of_hotkey_neurons(neurons);
                    
                    rewardBalances.forEach(balance => {
                        const ledger = balance[0];
                        const ledgerId = normalizeId(ledger);
                        if (!knownLedgers.has(ledgerId) && fetchSessionRef.current === sessionId) {
                            knownLedgers.add(ledgerId);
                            fetchTokenDetailsFast(ledger, summedLocks).then(token => {
                                if (token && fetchSessionRef.current === sessionId) {
                                    // Add reward amount to token
                                    const tokenWithReward = { ...token, rewards: rewardsMap[ledgerId] || 0n };
                                    addTokenProgressively(tokenWithReward, sessionId);
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
            
            // Note: hasFetchedInitial and walletLoading are now set by Promise.allSettled
            // above when all registered token fetches complete
            
        } catch (err) {
            console.error('Error fetching compact wallet tokens:', err);
            if (fetchSessionRef.current === sessionId) {
                setWalletLoading(false);
            }
        }
        
        // Ultimate safety net: ensure walletLoading is cleared after 45 seconds
        // Only resets if this is still the active session (prevents resetting a newer fetch)
        setTimeout(() => {
            if (fetchSessionRef.current === sessionId) {
                setWalletLoading(false);
                setHasFetchedInitial(true);
            }
        }, 45000);
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
            
            // Also fetch chore statuses (silently fail if canister version doesn't support chores)
            try {
                const choreStatuses = await manager.getChoreStatuses();
                if (choreStatuses && choreStatuses.length > 0) {
                    setManagerChoreStatuses(prev => ({
                        ...prev,
                        [canisterIdStr]: choreStatuses
                    }));
                }
            } catch (_) {
                // Chores API not available on this canister version - ignore
            }
        } catch (err) {
            // Only log if not a "method not found" error (canister isn't an ICP Staking Bot)
            if (!err.message?.includes('has no') && !err.message?.includes('Method not found')) {
                console.error(`Error fetching neurons for ${canisterIdStr}:`, err);
            }
            setManagerNeurons(prev => ({
                ...prev,
                [canisterIdStr]: { loading: false, neurons: [], error: err.message }
            }));
        }
    }, [identity]);
    
    // Fetch all ICP Neuron Managers
    const fetchNeuronManagers = useCallback(async (isBackgroundRefresh = false) => {
        if (!identity || !isAuthenticated) {
            setNeuronManagers([]);
            return;
        }
        
        const sessionId = ++managersFetchSessionRef.current;
        
        // Only show loading spinner if this is NOT a background refresh
        // This prevents a flash when refreshing cached data in the background
        if (!isBackgroundRefresh) {
            setNeuronManagersLoading(true);
        }
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            // Step 1: Quick query to get manager IDs
            const canisterIds = await factory.getMyManagers();
            
            if (managersFetchSessionRef.current !== sessionId) return;
            
            if (canisterIds.length > 0) {
                // Step 2: Immediately show the list with loading placeholders
                const initialManagers = canisterIds.map(canisterIdPrincipal => ({
                    canisterId: canisterIdPrincipal,
                    version: null, // Will be loaded progressively
                    neuronCount: null, // Will be loaded progressively
                    loading: true,
                }));
                
                setNeuronManagers(initialManagers);
                setHasFetchedManagers(true);
                setNeuronManagersLoading(false); // List is ready, details loading
                
                // Step 3: Progressively fetch version and neuronCount for each manager
                canisterIds.forEach(async (canisterIdPrincipal) => {
                    const canisterId = canisterIdPrincipal.toString();
                    let isValidManager = false;
                    
                    try {
                        const managerActor = createManagerActor(canisterIdPrincipal, { agent });
                        const [count, version] = await Promise.all([
                            managerActor.getNeuronCount(),
                            managerActor.getVersion(),
                        ]);
                        
                        if (managersFetchSessionRef.current !== sessionId) return;
                        
                        isValidManager = true;
                        
                        // Update this specific manager with fetched data
                        setNeuronManagers(prev => prev.map(m => 
                            m.canisterId.toString() === canisterId 
                                ? { ...m, version, neuronCount: Number(count), loading: false }
                                : m
                        ));
                    } catch (err) {
                        // Only log if not a "method not found" error (canister isn't an ICP Staking Bot)
                        if (!err.message?.includes('has no') && !err.message?.includes('Method not found')) {
                            console.error(`Error fetching data for ${canisterId}:`, err);
                        }
                        
                        if (managersFetchSessionRef.current !== sessionId) return;
                        
                        // Mark as loaded even on error, with default values
                        setNeuronManagers(prev => prev.map(m => 
                            m.canisterId.toString() === canisterId 
                                ? { ...m, version: { major: 0, minor: 0, patch: 0 }, neuronCount: 0, loading: false, isInvalid: true }
                                : m
                        ));
                    }
                    
                    // Only fetch neurons if this is a valid ICP Staking Bot
                    if (isValidManager) {
                        fetchManagerNeuronsData(canisterId);
                    }
                });
            } else {
                setNeuronManagers([]);
                setHasFetchedManagers(true);
                setNeuronManagersLoading(false);
            }
        } catch (err) {
            console.error('Error fetching ICP staking bots:', err);
            if (managersFetchSessionRef.current === sessionId) {
                setHasFetchedManagers(true);
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
    
    // Listen for external refresh requests (e.g. after bot upgrades)
    useEffect(() => {
        const handleRefresh = () => refreshNeuronManagers();
        window.addEventListener('neuronManagersRefresh', handleRefresh);
        return () => window.removeEventListener('neuronManagersRefresh', handleRefresh);
    }, [refreshNeuronManagers]);
    
    // --- Official versions (for outdated bot detection) ---
    const compareVersions = useCallback((a, b) => {
        const aMajor = Number(a.major), aMinor = Number(a.minor), aPatch = Number(a.patch);
        const bMajor = Number(b.major), bMinor = Number(b.minor), bPatch = Number(b.patch);
        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
    }, []);

    const isVersionOutdated = useCallback((version) => {
        if (!latestOfficialVersion || !version) return false;
        return compareVersions(version, latestOfficialVersion) < 0;
    }, [latestOfficialVersion, compareVersions]);

    const fetchOfficialVersions = useCallback(async () => {
        if (!identity) return;
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://ic0.app'
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const fetched = await factory.getOfficialVersions();
            setOfficialVersions(fetched || []);
            if (fetched && fetched.length > 0) {
                const sorted = [...fetched].sort((a, b) => {
                    const am = Number(a.major), an = Number(a.minor), ap = Number(a.patch);
                    const bm = Number(b.major), bn = Number(b.minor), bp = Number(b.patch);
                    if (am !== bm) return bm - am;
                    if (an !== bn) return bn - an;
                    return bp - ap;
                });
                setLatestOfficialVersion(sorted[0]);
            }
        } catch (err) {
            // Silent — low-priority background fetch
        }
    }, [identity]);

    // Fetch official versions lazily after managers are loaded (low priority, non-blocking)
    useEffect(() => {
        if (hasFetchedManagers && identity && officialVersions.length === 0) {
            // Small delay so it doesn't compete with initial wallet loads
            const timer = setTimeout(fetchOfficialVersions, 2000);
            return () => clearTimeout(timer);
        }
    }, [hasFetchedManagers, identity, officialVersions.length, fetchOfficialVersions]);

    // Computed: list of outdated managers (only ones we are controller of)
    const outdatedManagers = React.useMemo(() => {
        if (!latestOfficialVersion || neuronManagers.length === 0) return [];
        return neuronManagers.filter(m => {
            if (!m.version || !isVersionOutdated(m.version)) return false;
            const cid = typeof m.canisterId === 'string' ? m.canisterId : m.canisterId?.toText?.() || m.canisterId?.toString?.() || '';
            return neuronManagerIsController[cid] === true;
        });
    }, [neuronManagers, latestOfficialVersion, isVersionOutdated, neuronManagerIsController]);

    // Computed: list of canisters (managers + tracked + app manager) that are below their critical cycle level
    // Includes canisters we're not controller of, since topping up cycles is permissionless (CMC notify_top_up)
    // Each entry includes an `isController` flag so the UI can differentiate if needed
    const lowCyclesCanisters = React.useMemo(() => {
        const result = [];
        // Check neuron managers (must be controller for these)
        for (const manager of neuronManagers) {
            const cid = typeof manager.canisterId === 'string' ? manager.canisterId : manager.canisterId?.toText?.() || manager.canisterId?.toString?.() || '';
            if (!cid || neuronManagerIsController[cid] !== true) continue;
            const cycles = neuronManagerCycles[cid];
            if (cycles === null || cycles === undefined) continue;
            const criticalLevel = _getNeuronManagerCriticalLevel();
            if (cycles < criticalLevel) {
                result.push({
                    canisterId: cid,
                    cycles,
                    criticalLevel,
                    healthyLevel: _getNeuronManagerHealthyLevel(),
                    type: 'neuron_manager',
                    label: 'ICP Staking Bot',
                    version: manager.version,
                    isController: true,
                });
            }
        }
        // Collect all canister IDs already checked (managers)
        const checkedIds = new Set(neuronManagers.map(m => {
            return typeof m.canisterId === 'string' ? m.canisterId : m.canisterId?.toText?.() || m.canisterId?.toString?.() || '';
        }));
        
        // Check tracked canisters (wallet) - include even if not controller (top-up is permissionless)
        for (const canisterId of trackedCanisters) {
            if (checkedIds.has(canisterId)) continue;
            checkedIds.add(canisterId);
            const cycles = trackedCanisterCycles[canisterId];
            if (cycles === null || cycles === undefined) continue;
            const criticalLevel = _getCanisterCriticalLevel();
            if (cycles < criticalLevel) {
                result.push({
                    canisterId,
                    cycles,
                    criticalLevel,
                    healthyLevel: _getCanisterHealthyLevel(),
                    type: 'canister',
                    label: 'Wallet',
                    isController: trackedCanisterIsController[canisterId] === true,
                });
            }
        }
        
        // Check app manager canisters (canister groups from /apps, including virtual SNS sub-canisters)
        // Include even if not controller - top-up is permissionless
        for (const canisterId of appManagerCanisters) {
            if (checkedIds.has(canisterId)) continue;
            checkedIds.add(canisterId);
            const cycles = appManagerCanisterCycles[canisterId];
            if (cycles === null || cycles === undefined) continue;
            const criticalLevel = _getCanisterCriticalLevel();
            if (cycles < criticalLevel) {
                result.push({
                    canisterId,
                    cycles,
                    criticalLevel,
                    healthyLevel: _getCanisterHealthyLevel(),
                    type: 'canister',
                    label: appManagerCanisterIsController[canisterId] === true ? 'App' : 'App (SNS)',
                    isController: appManagerCanisterIsController[canisterId] === true,
                });
            }
        }
        return result;
    }, [neuronManagers, neuronManagerIsController, neuronManagerCycles, trackedCanisters, trackedCanisterIsController, trackedCanisterCycles, appManagerCanisters, appManagerCanisterIsController, appManagerCanisterCycles]);

    // Fetch tracked canisters (wallet canisters)
    const fetchTrackedCanisters = useCallback(async () => {
        if (!identity || !isAuthenticated) {
            setTrackedCanisters([]);
            return;
        }
        
        const sessionId = ++trackedCanistersFetchSessionRef.current;
        setTrackedCanistersLoading(true);
        
        try {
            const canisters = await getTrackedCanisters(identity);
            
            if (trackedCanistersFetchSessionRef.current !== sessionId) return;
            
            // Convert Principal objects to strings
            const canisterIds = canisters.map(p => p.toText());
            setTrackedCanisters(canisterIds);
            setHasFetchedTrackedCanisters(true);
        } catch (err) {
            console.error('Error fetching tracked canisters:', err);
            if (trackedCanistersFetchSessionRef.current === sessionId) {
                setHasFetchedTrackedCanisters(true);
            }
        } finally {
            if (trackedCanistersFetchSessionRef.current === sessionId) {
                setTrackedCanistersLoading(false);
            }
        }
    }, [identity, isAuthenticated]);
    
    // Refresh tracked canisters
    const refreshTrackedCanisters = useCallback(() => {
        setHasFetchedTrackedCanisters(false);
        fetchTrackedCanisters();
    }, [fetchTrackedCanisters]);
    
    // Fetch controller status for neuron managers
    // SEQUENTIAL: processes one manager at a time to avoid flooding the browser
    // with concurrent management-canister update calls (each = 1 POST + many read_state polls)
    const fetchNeuronManagerControllerStatus = useCallback(async () => {
        if (!identity || neuronManagers.length === 0) return;
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const controllerMap = {};
            const cyclesMap = {};
            for (const manager of neuronManagers) {
                // Safely convert canisterId to string
                let canisterId = '';
                if (manager.canisterId) {
                    if (typeof manager.canisterId === 'string') {
                        canisterId = manager.canisterId;
                    } else if (typeof manager.canisterId.toText === 'function') {
                        canisterId = manager.canisterId.toText();
                    } else if (typeof manager.canisterId.toString === 'function') {
                        const str = manager.canisterId.toString();
                        canisterId = str.includes('-') ? str : '';
                    }
                }
                if (!canisterId) continue; // Skip if invalid
                
                try {
                    const canisterIdPrincipal = Principal.fromText(canisterId);
                    const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                        agent,
                        canisterId: MANAGEMENT_CANISTER_ID,
                        callTransform: (methodName, args, callConfig) => ({
                            ...callConfig,
                            effectiveCanisterId: canisterIdPrincipal,
                        }),
                    });
                    const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                    controllerMap[canisterId] = true;
                    cyclesMap[canisterId] = Number(status.cycles);
                } catch (err) {
                    // Not a controller
                    controllerMap[canisterId] = false;
                }
            }
            setNeuronManagerIsController(controllerMap);
            setNeuronManagerCycles(prev => ({ ...prev, ...cyclesMap }));
        } catch (err) {
            console.warn('[WalletContext] Error fetching manager controller status:', err);
        }
    }, [identity, neuronManagers]);
    
    // Fetch controller status for tracked canisters
    // SEQUENTIAL: processes one canister at a time to avoid flooding the browser
    // with concurrent management-canister update calls (each = 1 POST + many read_state polls)
    const fetchTrackedCanisterControllerStatus = useCallback(async () => {
        if (!identity || trackedCanisters.length === 0) return;
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const controllerMap = {};
            const cyclesMap = {};
            for (const canisterId of trackedCanisters) {
                try {
                    const canisterIdPrincipal = Principal.fromText(canisterId);
                    const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                        agent,
                        canisterId: MANAGEMENT_CANISTER_ID,
                        callTransform: (methodName, args, callConfig) => ({
                            ...callConfig,
                            effectiveCanisterId: canisterIdPrincipal,
                        }),
                    });
                    const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                    controllerMap[canisterId] = true;
                    cyclesMap[canisterId] = Number(status.cycles);
                } catch (err) {
                    // Not a controller
                    controllerMap[canisterId] = false;
                }
            }
            setTrackedCanisterIsController(controllerMap);
            setTrackedCanisterCycles(prev => ({ ...prev, ...cyclesMap }));
        } catch (err) {
            console.warn('[WalletContext] Error fetching tracked canister controller status:', err);
        }
    }, [identity, trackedCanisters]);
    
    // Auto-fetch controller status when managers/canisters are loaded
    useEffect(() => {
        if (neuronManagers.length > 0 && identity) {
            fetchNeuronManagerControllerStatus();
        }
    }, [neuronManagers, identity, fetchNeuronManagerControllerStatus]);
    
    useEffect(() => {
        if (trackedCanisters.length > 0 && identity) {
            fetchTrackedCanisterControllerStatus();
        }
    }, [trackedCanisters, identity, fetchTrackedCanisterControllerStatus]);

    // Fetch app manager canisters (canister groups from /apps page) and check controller status + cycles
    const fetchAppManagerCanisters = useCallback(async () => {
        if (!identity) return;
        
        try {
            const result = await getCanisterGroups(identity);
            const groups = convertGroupsFromBackend(result);
            if (!groups) {
                setAppManagerCanisters([]);
                return;
            }
            
            // Extract all canister IDs from groups
            const ids = [...groups.ungrouped];
            const collectFromGroups = (groupsList) => {
                for (const group of groupsList) {
                    ids.push(...group.canisters);
                    collectFromGroups(group.subgroups);
                }
            };
            collectFromGroups(groups.groups);
            setAppManagerCanisters(ids);
            
            if (ids.length === 0) return;
            
            // Check controller status + cycles for each
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const controllerMap = {};
            const cyclesMap = {};
            const missingCyclesIds = []; // IDs where we couldn't get cycles (not controller)
            for (const canisterId of ids) {
                try {
                    const canisterIdPrincipal = Principal.fromText(canisterId);
                    const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                        agent,
                        canisterId: MANAGEMENT_CANISTER_ID,
                        callTransform: (methodName, args, callConfig) => ({
                            ...callConfig,
                            effectiveCanisterId: canisterIdPrincipal,
                        }),
                    });
                    const status = await mgmtActor.canister_status({ canister_id: canisterIdPrincipal });
                    controllerMap[canisterId] = true;
                    cyclesMap[canisterId] = Number(status.cycles);
                } catch (err) {
                    controllerMap[canisterId] = false;
                    missingCyclesIds.push(canisterId);
                }
            }
            setAppManagerCanisterIsController(controllerMap);
            setAppManagerCanisterCycles(cyclesMap);

            // For SNS canisters we're not controller of, try fetching via SNS root
            // Also discover and store ALL virtual SNS sub-canisters (governance, ledger, swap, etc.)
            // since top-up is permissionless and we want to show low cycle warnings for all of them
            if (missingCyclesIds.length > 0) {
                try {
                    const snsMap = buildSnsCanisterToRootMap();
                    const rootsToFetch = new Map();
                    for (const cid of missingCyclesIds) {
                        const rootId = snsMap.get(cid);
                        if (rootId) {
                            if (!rootsToFetch.has(rootId)) rootsToFetch.set(rootId, new Set());
                            rootsToFetch.get(rootId).add(cid);
                        }
                    }
                    if (rootsToFetch.size > 0) {
                        const additionalIds = []; // virtual sub-canisters discovered
                        for (const [rootId, canisterIds] of rootsToFetch) {
                            try {
                                const snsCycles = await fetchSnsCyclesFromRoot(rootId, identity);
                                // Store cycles for ALL returned canisters, not just
                                // the ones in our groups - this catches virtual sub-canisters
                                for (const [cid, data] of snsCycles) {
                                    cyclesMap[cid] = data.cycles;
                                    controllerMap[cid] = controllerMap[cid] ?? false;
                                    // Track newly discovered sub-canisters
                                    if (!ids.includes(cid)) {
                                        additionalIds.push(cid);
                                    }
                                }
                            } catch (err) {
                                // Non-critical
                            }
                        }
                        // Add virtual SNS sub-canisters to the app manager canister list
                        if (additionalIds.length > 0) {
                            const allIds = [...ids, ...additionalIds];
                            setAppManagerCanisters(allIds);
                        }
                        setAppManagerCanisterIsController({ ...controllerMap });
                        setAppManagerCanisterCycles({ ...cyclesMap });
                    }
                } catch (err) {
                    // Non-critical - SNS cycle fetch is a best-effort enhancement
                }
            }
        } catch (err) {
            console.warn('[WalletContext] Error fetching app manager canisters:', err);
        }
    }, [identity]);
    
    // Auto-fetch app manager canisters when identity is available
    useEffect(() => {
        if (identity && isAuthenticated) {
            // Delay to avoid competing with higher-priority fetches
            const timer = setTimeout(() => fetchAppManagerCanisters(), 5000);
            return () => clearTimeout(timer);
        }
    }, [identity, isAuthenticated, fetchAppManagerCanisters]);

    // Fetch tokens and positions when user authenticates
    // Always fetch fresh data in background, even if we loaded from persistent cache
    const hasFetchedFreshRef = useRef(false);
    const isFetchingRef = useRef(false); // Prevent double fetches
    
    useEffect(() => {
        if (isAuthenticated && identity) {
            // Wait for cache check to complete before deciding what to do
            if (!cacheCheckComplete) return;
            
            // Guard against concurrent fetches
            if (isFetchingRef.current) return;
            
            // If we loaded from cache, we have hasFetchedInitial=true but need fresh data
            if (loadedFromCache && !hasFetchedFreshRef.current) {
                // We have cached data showing, fetch fresh in background
                hasFetchedFreshRef.current = true;
                isFetchingRef.current = true;
                // Fetch ICP price for all consumers
                fetchIcpPrice();
                // Small delay to ensure React has committed cache state before validation starts
                setTimeout(() => {
                    fetchCompactWalletTokens();
                    fetchCompactPositions(false, false);
                    fetchNeuronManagers(true); // true = background refresh, don't show loading spinner
                    fetchTrackedCanisters();
                }, 50);
                setTimeout(() => { isFetchingRef.current = false; }, 150);
            } else if (!hasFetchedInitial && !loadedFromCache) {
                // No cached data, need to fetch from scratch
                isFetchingRef.current = true;
                // Fetch ICP price for all consumers
                fetchIcpPrice();
                fetchCompactWalletTokens();
                fetchCompactPositions(true);
                fetchNeuronManagers();
                fetchTrackedCanisters();
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
            setNeuronManagerIsController({});
            setTrackedCanisters([]);
            setTrackedCanisterIsController({});
            setAppManagerCanisters([]);
            setAppManagerCanisterIsController({});
            setAppManagerCanisterCycles({});
            setNeuronCache(new Map());
            setHasFetchedInitial(false);
            setHasFetchedPositions(false);
            setHasFetchedManagers(false);
            setHasFetchedTrackedCanisters(false);
            setHasDetailedData(false);
            setLastUpdated(null);
            setLoadedFromCache(false);
            setCacheCheckComplete(false);
            hasFetchedFreshRef.current = false;
            hasInitializedFromCacheRef.current = false;
            isFetchingRef.current = false;
        }
    }, [isAuthenticated, identity, hasFetchedInitial, loadedFromCache, cacheCheckComplete, fetchCompactWalletTokens, fetchCompactPositions, fetchNeuronManagers, fetchTrackedCanisters]);

    // Deduplicate helper
    const deduplicateTokens = useCallback((tokens) => {
        const seenPrincipals = new Set();
        return tokens.filter(token => {
            const principal = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
            if (!principal) return false;
            if (seenPrincipals.has(principal)) return false;
            seenPrincipals.add(principal);
            return true;
        });
    }, []);

    // Update tokens from Wallet.jsx (more detailed data including locks, staked, etc.)
    // Supports both direct arrays AND function updaters (for safe concurrent updates)
    const updateWalletTokens = useCallback((tokensOrUpdater) => {
        if (typeof tokensOrUpdater === 'function') {
            // Function updater: use React's state updater for safe concurrent access
            setWalletTokens(prev => {
                const updated = tokensOrUpdater(prev);
                if (!updated || updated.length === 0) return prev;
                const deduped = deduplicateTokens(updated);
                return deduped;
            });
            setLastUpdated(new Date());
            setHasDetailedData(true);
        } else if (tokensOrUpdater && tokensOrUpdater.length > 0) {
            const deduped = deduplicateTokens(tokensOrUpdater);
            setWalletTokens(deduped);
            setLastUpdated(new Date());
            setHasDetailedData(true);
        }
    }, [deduplicateTokens]);

    // Update just the rewards on tokens (called from Wallet.jsx when rewards are fetched)
    const updateTokenRewards = useCallback((rewardsMap) => {
        if (!rewardsMap || Object.keys(rewardsMap).length === 0) return;
        
        setWalletTokens(prev => prev.map(token => {
            const tokenId = normalizeId(token.principal) || normalizeId(token.ledger_canister_id);
            const reward = rewardsMap[tokenId];
            if (reward !== undefined) {
                return { ...token, rewards: reward };
            }
            return token;
        }));
    }, []);

    // Update liquidity positions (for local overrides from Wallet.jsx)
    const updateLiquidityPositions = useCallback((positions, loading = false) => {
        if (positions && positions.length > 0) {
            // Deduplicate by swapCanisterId (Principal/string insensitive)
            const seenSwapIds = new Set();
            const deduplicatedPositions = positions.filter(pos => {
                const swapId = normalizeId(pos.swapCanisterId);
                if (seenSwapIds.has(swapId)) return false;
                seenSwapIds.add(swapId);
                return true;
            });
            
            // Also deduplicate inner positions arrays
            const cleanedPositions = deduplicatedPositions.map(lp => {
                if (!lp.positions || lp.positions.length === 0) return lp;
                const seenPositionIds = new Set();
                const cleanedInnerPositions = lp.positions.filter(pos => {
                    const posId = normalizeId(pos.positionId);
                    if (seenPositionIds.has(posId)) return false;
                    seenPositionIds.add(posId);
                    return true;
                });
                return { ...lp, positions: cleanedInnerPositions };
            });
            
            setLiquidityPositions(cleanedPositions);
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
        setHasFetchedTrackedCanisters(false);
        setLoadedFromCache(false);
        // Clear neuron cache so neurons are refetched
        setNeuronCache(new Map());
        setNeuronCacheInitialized(false);
        setManagerNeurons({});
        if (principalId) {
            clearWalletCache(principalId);
        }
        fetchIcpPrice(); // Refresh ICP price
        fetchCompactWalletTokens();
        fetchCompactPositions(true); // Clear first on explicit refresh
        fetchNeuronManagers();
        fetchTrackedCanisters();
        // Also refetch all neurons
        fetchAllSnsNeurons();
    }, [fetchIcpPrice, fetchCompactWalletTokens, fetchCompactPositions, fetchNeuronManagers, fetchTrackedCanisters, fetchAllSnsNeurons]);

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
    // accountId: optional ICP account ID hex string for legacy ICP transfers
    const sendToken = useCallback(async (token, recipient, amount, subaccount = [], accountId = undefined) => {
        if (!identity) throw new Error('Not authenticated');

        const ledgerCanisterIdText = normalizeId(token?.ledger_canister_id || token?.principal);
        if (!ledgerCanisterIdText) {
            throw new Error('Missing ledger canister ID');
        }
        const ledgerCanisterId = Principal.fromText(ledgerCanisterIdText);

        const decimals = token.decimals || 8;
        const amountFloat = parseFloat(amount);
        const scaledAmount = amountFloat * (10 ** decimals);
        const bigintAmount = BigInt(Math.floor(scaledAmount));

        // ICP Account ID transfer (legacy transfer method)
        if (accountId && !recipient) {
            const { IDL } = await import('@dfinity/candid');
            const accountIdClean = accountId.trim().toLowerCase().replace(/^0x/, '');
            const accountIdBytes = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                accountIdBytes[i] = parseInt(accountIdClean.slice(i * 2, i * 2 + 2), 16);
            }

            const icpLedgerIdlFactory = ({ IDL: idl }) => {
                const Tokens = idl.Record({ e8s: idl.Nat64 });
                const AccountIdentifier = idl.Vec(idl.Nat8);
                const SubAccount = idl.Vec(idl.Nat8);
                const TimeStamp = idl.Record({ timestamp_nanos: idl.Nat64 });
                const TransferArgs = idl.Record({
                    to: AccountIdentifier,
                    fee: Tokens,
                    memo: idl.Nat64,
                    from_subaccount: idl.Opt(SubAccount),
                    created_at_time: idl.Opt(TimeStamp),
                    amount: Tokens
                });
                const TransferError = idl.Variant({
                    TxTooOld: idl.Record({ allowed_window_nanos: idl.Nat64 }),
                    BadFee: idl.Record({ expected_fee: Tokens }),
                    TxDuplicate: idl.Record({ duplicate_of: idl.Nat64 }),
                    TxCreatedInFuture: idl.Null,
                    InsufficientFunds: idl.Record({ balance: Tokens })
                });
                const TransferResult = idl.Variant({
                    Ok: idl.Nat64,
                    Err: TransferError
                });
                return idl.Service({
                    transfer: idl.Func([TransferArgs], [TransferResult], [])
                });
            };

            const agent = new HttpAgent({ identity, host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943' });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }

            const icpLedgerActor = Actor.createActor(icpLedgerIdlFactory, {
                agent,
                canisterId: ledgerCanisterId
            });

            const result = await icpLedgerActor.transfer({
                to: Array.from(accountIdBytes),
                fee: { e8s: BigInt(token.fee) },
                memo: BigInt(0),
                from_subaccount: [],
                created_at_time: [],
                amount: { e8s: bigintAmount }
            });

            if (result.Err) {
                const errKey = Object.keys(result.Err)[0];
                const errVal = result.Err[errKey];
                throw new Error(`Transfer failed: ${errKey} - ${JSON.stringify(errVal, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
            }

            refreshWallet();
            return;
        }

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
                ledgerCanisterId,
                sendAmounts.send_from_backend
            );
        }

        // Send from frontend if needed
        if (sendAmounts.send_from_frontend > 0n) {
            const ledgerActor = createLedgerActor(ledgerCanisterId, {
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
            updateTokenRewards, // Update just the rewards on tokens
            setLoading,
            // Refresh phase tracking (shared between Wallet.jsx and quick wallet)
            refreshingTokens,
            setRefreshingTokens,
            clearWallet,
            refreshWallet,
            refreshTokenBalance, // Refresh a single token's balance (e.g., after swap)
            ensureTokenRegistered, // Register a token in backend + wallet if not already present
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
            cacheCheckComplete, // True after initial cache check completes (with or without data)
            getNeuronsForGovernance,
            getCachedNeurons,
            clearNeuronCache,
            refreshNeuronsForGovernance,
            refreshAllNeurons,
            fetchAllSnsNeurons,
            // ICP Neuron Managers - shared between quick wallet and /wallet
            neuronManagers,
            managerNeurons,
            managerNeuronsTotal,
            managerChoreStatuses,
            officialVersions,
            latestOfficialVersion,
            outdatedManagers,
            isVersionOutdated,
            compareVersions,
            neuronManagersLoading,
            hasFetchedManagers,
            refreshNeuronManagers,
            fetchManagerNeuronsData,
            // Tracked Canisters (wallet canisters) - shared between quick wallet and /wallet
            trackedCanisters,
            trackedCanistersLoading,
            hasFetchedTrackedCanisters,
            refreshTrackedCanisters,
            // Controller status - shared between quick wallet and /wallet page
            neuronManagerIsController,
            trackedCanisterIsController,
            // Cycles data - shared for low-cycles notifications
            neuronManagerCycles,
            setNeuronManagerCycles,
            trackedCanisterCycles,
            setTrackedCanisterCycles,
            lowCyclesCanisters,
            // Shared ICP price - ensures consistent values across components
            icpPrice,
            fetchIcpPrice
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
