import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useSns } from './SnsContext';
import { fetchUserNeuronsForSns, uint8ArrayToHex } from '../utils/NeuronUtils';
import { getSnsById } from '../utils/SnsUtils';
import { getNeuronsFromCacheByIds, saveNeuronsToCache } from '../hooks/useNeuronsCache';

const NeuronsContext = createContext();

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
    
    // Cache for neurons by SNS to avoid refetching (in-memory only)
    // Persistent storage is handled by the shared IndexedDB cache (NeuronsDB)
    const [neuronsBySns, setNeuronsBySns] = useState(new Map());
    
    // Get principal ID for cache key
    const principalId = identity?.getPrincipal()?.toString();

    // Function to fetch neurons for a specific SNS
    const fetchNeuronsForSns = useCallback(async (snsRoot) => {
        if (!identity || !snsRoot) return [];
        
        const selectedSns = getSnsById(snsRoot);
        if (!selectedSns) return [];
        
        return await fetchUserNeuronsForSns(identity, selectedSns.canisters.governance);
    }, [identity]);

    // Helper to extract neuron IDs for cache lookup
    const extractNeuronIds = useCallback((neurons) => {
        return neurons.map(n => {
            const idArray = n.id?.[0]?.id;
            if (!idArray) return null;
            return idArray instanceof Uint8Array
                ? uint8ArrayToHex(idArray)
                : Array.isArray(idArray)
                    ? idArray.map(b => b.toString(16).padStart(2, '0')).join('')
                    : null;
        }).filter(Boolean);
    }, []);

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
        
        // Check in-memory cache first
        const cacheKey = `${identity.getPrincipal().toString()}-${snsRoot}`;
        console.log('fetchHotkeyNeuronsData: Checking cache for key:', cacheKey);
        
        // Use functional update to access current cache state
        let cachedData = null;
        setNeuronsBySns(prev => {
            cachedData = prev.get(cacheKey);
            return prev;
        });
        
        // If we have in-memory cached data and not forcing refresh, show it immediately
        if (cachedData && !forceRefresh) {
            console.log('fetchHotkeyNeuronsData: Found in-memory cached data, using it and fetching fresh in background');
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
                    
                    // Save to shared IndexedDB cache (fire and forget)
                    if (neurons.length > 0) {
                        saveNeuronsToCache(snsRoot, neurons).catch(e => 
                            console.warn('[NeuronsContext] Failed to save to shared cache:', e)
                        );
                    }
                    
                    console.log('fetchHotkeyNeuronsData: Background refresh complete');
                } catch (err) {
                    console.error('Background refresh failed:', err);
                    // Don't update state on background error - keep cached data
                }
            })();
            return;
        }
        
        console.log('fetchHotkeyNeuronsData: No in-memory cached data or forcing refresh, fetching from network');
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
            
            // Cache the result in-memory
            setNeuronsBySns(prev => new Map(prev).set(cacheKey, result));
            setNeuronsData(result);
            
            // Save to shared IndexedDB cache (fire and forget)
            if (neurons.length > 0) {
                saveNeuronsToCache(snsRoot, neurons).catch(e => 
                    console.warn('[NeuronsContext] Failed to save to shared cache:', e)
                );
            }
            
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

    // Function to clear in-memory cache for a specific SNS or all
    // Note: Shared IndexedDB cache is not cleared here - use the Clear Cache button in /me for full reset
    const clearCache = useCallback((snsRoot = null) => {
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
    }, [identity]);

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
            // Clear in-memory state on logout
            console.log('NeuronsContext: Clearing neurons data on logout');
            setNeuronsData({
                neurons_by_owner: [],
                total_voting_power: 0,
                distribution_voting_power: 0
            });
            setNeuronsBySns(new Map());
            setLoading(false);
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
