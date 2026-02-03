import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useSns } from './SnsContext';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import { getSnsById } from '../utils/SnsUtils';

const NeuronsContext = createContext();

// ============================================================================
// PERSISTENT CACHE HELPERS
// ============================================================================

const NEURONS_CACHE_KEY_PREFIX = 'neuronsCache_';
const NEURONS_CACHE_VERSION = 1;

// Custom JSON replacer to handle BigInt, Principal, TypedArrays, Map, Set
const jsonReplacer = (key, value) => {
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
    // Handle TypedArrays (Uint8Array, Int32Array, etc.)
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        return { __type: 'TypedArray', arrayType: value.constructor.name, value: Array.from(value) };
    }
    return value;
};

// Custom JSON reviver to restore BigInt, Principal, TypedArrays, Map, Set
const jsonReviver = (key, value) => {
    if (value && typeof value === 'object' && value.__type) {
        switch (value.__type) {
            case 'BigInt':
                return BigInt(value.value);
            case 'Principal':
                return Principal.fromText(value.value);
            case 'Map':
                return new Map(value.value.map(([k, v]) => [k, v]));
            case 'Set':
                return new Set(value.value);
            case 'TypedArray':
                const TypedArrayConstructor = globalThis[value.arrayType];
                if (TypedArrayConstructor) {
                    return new TypedArrayConstructor(value.value);
                }
                return value.value;
            default:
                return value;
        }
    }
    return value;
};

// Save neurons cache to localStorage
const saveNeuronsCache = (principalId, data) => {
    try {
        const cacheKey = `${NEURONS_CACHE_KEY_PREFIX}${principalId}`;
        const cacheData = {
            version: NEURONS_CACHE_VERSION,
            timestamp: Date.now(),
            ...data
        };
        const serialized = JSON.stringify(cacheData, jsonReplacer);
        localStorage.setItem(cacheKey, serialized);
    } catch (error) {
        console.warn('[NeuronsContext] Failed to save cache:', error);
    }
};

// Load neurons cache from localStorage
const loadNeuronsCache = (principalId) => {
    try {
        const cacheKey = `${NEURONS_CACHE_KEY_PREFIX}${principalId}`;
        const serialized = localStorage.getItem(cacheKey);
        if (!serialized) return null;
        
        const data = JSON.parse(serialized, jsonReviver);
        
        if (data.version !== NEURONS_CACHE_VERSION) {
            console.log('[NeuronsContext] Cache version mismatch, clearing');
            localStorage.removeItem(cacheKey);
            return null;
        }
        
        return data;
    } catch (error) {
        console.warn('[NeuronsContext] Failed to load cache:', error);
        return null;
    }
};

// Clear neurons cache
const clearNeuronsCache = (principalId) => {
    try {
        const cacheKey = `${NEURONS_CACHE_KEY_PREFIX}${principalId}`;
        localStorage.removeItem(cacheKey);
    } catch (error) {
        console.warn('[NeuronsContext] Failed to clear cache:', error);
    }
};

/**
 * NeuronsContext - For browsing ALL neurons in an SNS
 * 
 * This context is for viewing/indexing all neurons in a selected SNS,
 * not just the user's neurons. Works for non-logged-in users too.
 * 
 * For the logged-in user's reachable neurons (for voting, VP bar, wallet, etc.),
 * use WalletContext's neuron cache instead:
 *   - getNeuronsForGovernance(governanceCanisterId)
 *   - getCachedNeurons(governanceCanisterId)
 */
export function NeuronsProvider({ children }) {
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    
    // State for neurons data
    const [neuronsData, setNeuronsData] = useState({
        neurons_by_owner: [],
        total_voting_power: 0,
        distribution_voting_power: 0
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    
    // Cache for neurons by SNS to avoid refetching (in-memory)
    const [neuronsBySns, setNeuronsBySns] = useState(new Map());
    
    // Track if we've loaded from persistent cache
    const [loadedFromPersistentCache, setLoadedFromPersistentCache] = useState(false);
    const hasInitializedFromCacheRef = useRef(false);
    const saveCacheTimeoutRef = useRef(null);
    
    // Get principal ID for cache key
    const principalId = identity?.getPrincipal()?.toString();
    
    // Load from persistent cache on mount/login
    useEffect(() => {
        if (!principalId || hasInitializedFromCacheRef.current) return;
        
        const cachedData = loadNeuronsCache(principalId);
        if (cachedData && cachedData.neuronsBySns) {
            console.log('[NeuronsContext] Loading from persistent cache, age:', 
                Math.round((Date.now() - cachedData.timestamp) / 1000), 'seconds');
            
            // Restore in-memory cache from persistent storage
            if (cachedData.neuronsBySns instanceof Map) {
                setNeuronsBySns(cachedData.neuronsBySns);
            } else if (Array.isArray(cachedData.neuronsBySns)) {
                setNeuronsBySns(new Map(cachedData.neuronsBySns));
            }
            
            setLoadedFromPersistentCache(true);
        }
        
        hasInitializedFromCacheRef.current = true;
    }, [principalId]);
    
    // Save to persistent cache when in-memory cache changes (debounced)
    useEffect(() => {
        if (!principalId || !isAuthenticated) return;
        if (neuronsBySns.size === 0 && !loadedFromPersistentCache) return;
        
        if (saveCacheTimeoutRef.current) {
            clearTimeout(saveCacheTimeoutRef.current);
        }
        
        saveCacheTimeoutRef.current = setTimeout(() => {
            saveNeuronsCache(principalId, {
                neuronsBySns: Array.from(neuronsBySns.entries())
            });
        }, 2000);
        
        return () => {
            if (saveCacheTimeoutRef.current) {
                clearTimeout(saveCacheTimeoutRef.current);
            }
        };
    }, [principalId, isAuthenticated, neuronsBySns, loadedFromPersistentCache]);

    // Function to fetch neurons for a specific SNS
    const fetchNeuronsForSns = useCallback(async (snsRoot) => {
        if (!identity || !snsRoot) return [];
        
        const selectedSns = getSnsById(snsRoot);
        if (!selectedSns) return [];
        
        return await fetchUserNeuronsForSns(identity, selectedSns.canisters.governance);
    }, [identity]);

    // Function to fetch hotkey neurons data with voting power
    const fetchHotkeyNeuronsData = useCallback(async (snsRoot = selectedSnsRoot, forceRefresh = false) => {
        console.log('fetchHotkeyNeuronsData called with:', { snsRoot, hasIdentity: !!identity, forceRefresh });
        
        if (!identity || !snsRoot) {
            console.log('fetchHotkeyNeuronsData: Missing identity or snsRoot, clearing data');
            setNeuronsData({
                neurons_by_owner: [],
                total_voting_power: 0,
                distribution_voting_power: 0
            });
            return;
        }
        
        // Check cache first
        const cacheKey = `${identity.getPrincipal().toString()}-${snsRoot}`;
        console.log('fetchHotkeyNeuronsData: Checking cache for key:', cacheKey);
        
        // Use functional update to access current cache state
        let cachedData = null;
        setNeuronsBySns(prev => {
            cachedData = prev.get(cacheKey);
            return prev;
        });
        
        // If we have cached data and not forcing refresh, show it immediately
        if (cachedData && !forceRefresh) {
            console.log('fetchHotkeyNeuronsData: Found cached data, using it and fetching fresh in background');
            setNeuronsData(cachedData);
            
            // Fetch fresh data in background (don't show loading state)
            (async () => {
                try {
                    const neurons = await fetchNeuronsForSns(snsRoot);
                    const neuronsWithSns = neurons.map(neuron => ({
                        ...neuron,
                        sns_root_canister_id: snsRoot
                    }));
                    
                    const result = {
                        neurons_by_owner: [[identity.getPrincipal().toString(), neuronsWithSns]],
                        total_voting_power: 0,
                        distribution_voting_power: 0
                    };
                    
                    setNeuronsBySns(prev => new Map(prev).set(cacheKey, result));
                    setNeuronsData(result);
                    console.log('fetchHotkeyNeuronsData: Background refresh complete');
                } catch (err) {
                    console.error('Background refresh failed:', err);
                    // Don't update state on background error - keep cached data
                }
            })();
            return;
        }
        
        console.log('fetchHotkeyNeuronsData: No cached data or forcing refresh, fetching from network');
        setLoading(true);
        setError(null);
        
        try {
            // Get neurons from SNS
            console.log('fetchHotkeyNeuronsData: Fetching neurons from SNS...');
            const neurons = await fetchNeuronsForSns(snsRoot);
            console.log('fetchHotkeyNeuronsData: Got neurons from SNS:', neurons.length);
            
            // Add SNS root canister ID to each neuron for filtering purposes
            const neuronsWithSns = neurons.map(neuron => ({
                ...neuron,
                sns_root_canister_id: snsRoot
            }));
            
            // Create the data structure without RLL call
            const result = {
                neurons_by_owner: [[identity.getPrincipal().toString(), neuronsWithSns]],
                total_voting_power: 0, // Will be calculated by frontend
                distribution_voting_power: 0 // Will be calculated by frontend
            };
            
            console.log('fetchHotkeyNeuronsData: Created result structure:', result);
            
            // Cache the result
            setNeuronsBySns(prev => new Map(prev).set(cacheKey, result));
            setNeuronsData(result);
            console.log('fetchHotkeyNeuronsData: Successfully cached and set data');
        } catch (err) {
            console.error('Error fetching hotkey neurons:', err);
            setError(err.message);
            setNeuronsData({
                neurons_by_owner: [],
                total_voting_power: 0,
                distribution_voting_power: 0
            });
        } finally {
            setLoading(false);
        }
    }, [identity, selectedSnsRoot, fetchNeuronsForSns]);

    // Function to get all neurons from the nested structure
    const getAllNeurons = useCallback(() => {
        return neuronsData.neurons_by_owner.flatMap(([owner, neurons]) => neurons);
    }, [neuronsData]);

    // Function to get neurons with hotkey access for the current user
    const getHotkeyNeurons = useCallback(() => {
        if (!identity) return [];
        
        const allNeurons = getAllNeurons();
        return allNeurons.filter(neuron => {
            return neuron.permissions?.some(p => {
                if (p.principal?.toString() !== identity.getPrincipal().toString()) return false;
                // Safe array check for cached data
                const pt = p.permission_type;
                if (!pt) return false;
                const arr = Array.isArray(pt) ? pt : (pt.length !== undefined ? Array.from(pt) : []);
                return arr.includes(4); // Hotkey permission
            });
        });
    }, [identity, getAllNeurons]);

    // Function to clear cache for a specific SNS or all
    const clearCache = useCallback((snsRoot = null, clearPersistent = true) => {
        if (snsRoot && identity) {
            const cacheKey = `${identity.getPrincipal().toString()}-${snsRoot}`;
            setNeuronsBySns(prev => {
                const newMap = new Map(prev);
                newMap.delete(cacheKey);
                return newMap;
            });
        } else {
            setNeuronsBySns(new Map());
        }
        
        // Clear persistent cache too if requested
        if (clearPersistent && principalId) {
            clearNeuronsCache(principalId);
        }
    }, [identity, principalId]);

    // Function to refresh neurons data
    const refreshNeurons = useCallback(async (snsRoot = selectedSnsRoot) => {
        if (identity && snsRoot) {
            console.log('refreshNeurons: Refreshing neurons for SNS:', snsRoot);
            
            // Clear in-memory cache for this SNS (keep persistent cache, it will be updated)
            const cacheKey = `${identity.getPrincipal().toString()}-${snsRoot}`;
            setNeuronsBySns(prev => {
                const newMap = new Map(prev);
                newMap.delete(cacheKey);
                return newMap;
            });
            
            // Force refresh (shows loading state)
            await fetchHotkeyNeuronsData(snsRoot, true);
        }
    }, [selectedSnsRoot, identity, fetchHotkeyNeuronsData]);

    // Effect to fetch neurons when authentication or SNS changes
    useEffect(() => {
        console.log('NeuronsContext useEffect triggered:', {
            isAuthenticated,
            hasIdentity: !!identity,
            selectedSnsRoot,
            identityPrincipal: identity?.getPrincipal()?.toString()
        });
        
        if (isAuthenticated && identity && selectedSnsRoot) {
            console.log('NeuronsContext: Proactively fetching neurons for SNS:', selectedSnsRoot);
            fetchHotkeyNeuronsData(selectedSnsRoot);
        } else if (!isAuthenticated) {
            // Clear everything on logout
            console.log('NeuronsContext: Clearing neurons data on logout');
            setNeuronsData({
                neurons_by_owner: [],
                total_voting_power: 0,
                distribution_voting_power: 0
            });
            setNeuronsBySns(new Map());
            setLoadedFromPersistentCache(false);
            hasInitializedFromCacheRef.current = false;
            setLoading(false);
            // Don't clear persistent cache on logout - keep it for next login
        } else {
            console.log('NeuronsContext: Clearing neurons data - missing requirements');
            setNeuronsData({
                neurons_by_owner: [],
                total_voting_power: 0,
                distribution_voting_power: 0
            });
            setLoading(false);
        }
    }, [isAuthenticated, identity, selectedSnsRoot, fetchHotkeyNeuronsData]);

    const value = {
        // Data
        neuronsData,
        loading,
        error,
        
        // Computed values
        getAllNeurons,
        getHotkeyNeurons,
        
        // Functions
        fetchNeuronsForSns,
        fetchHotkeyNeuronsData,
        refreshNeurons,
        clearCache,
        
        // Cache management
        neuronsBySns
    };

    return (
        <NeuronsContext.Provider value={value}>
            {children}
        </NeuronsContext.Provider>
    );
}

export function useNeurons() {
    const context = useContext(NeuronsContext);
    if (!context) {
        throw new Error('useNeurons must be used within a NeuronsProvider');
    }
    return context;
}
