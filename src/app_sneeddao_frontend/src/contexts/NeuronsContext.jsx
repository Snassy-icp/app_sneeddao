import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useSns } from './SnsContext';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import { getSnsById } from '../utils/SnsUtils';

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
    
    // Cache for neurons by SNS to avoid refetching
    const [neuronsBySns, setNeuronsBySns] = useState(new Map());

    // Function to fetch neurons for a specific SNS
    const fetchNeuronsForSns = useCallback(async (snsRoot) => {
        if (!identity || !snsRoot) return [];
        
        const selectedSns = getSnsById(snsRoot);
        if (!selectedSns) return [];
        
        return await fetchUserNeuronsForSns(identity, selectedSns.canisters.governance);
    }, [identity]);

    // Function to fetch hotkey neurons data with voting power
    const fetchHotkeyNeuronsData = useCallback(async (snsRoot = selectedSnsRoot) => {
        console.log('fetchHotkeyNeuronsData called with:', { snsRoot, hasIdentity: !!identity });
        
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
        
        if (cachedData) {
            console.log('fetchHotkeyNeuronsData: Found cached data, using it');
            setNeuronsData(cachedData);
            return;
        }
        
        console.log('fetchHotkeyNeuronsData: No cached data, fetching from network');
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
            return neuron.permissions.some(p => 
                p.principal?.toString() === identity.getPrincipal().toString() &&
                p.permission_type.includes(4) // Hotkey permission
            );
        });
    }, [identity, getAllNeurons]);

    // Function to clear cache for a specific SNS or all
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
        clearCache(snsRoot);
        // Call fetchHotkeyNeuronsData directly without including it in dependencies
        if (identity && snsRoot) {
            console.log('refreshNeurons: Refreshing neurons for SNS:', snsRoot);
            
            // Clear cache first
            const cacheKey = `${identity.getPrincipal().toString()}-${snsRoot}`;
            setNeuronsBySns(prev => {
                const newMap = new Map(prev);
                newMap.delete(cacheKey);
                return newMap;
            });
            
            // Then fetch fresh data
            setLoading(true);
            setError(null);
            
            try {
                const selectedSns = getSnsById(snsRoot);
                if (!selectedSns) {
                    throw new Error('Selected SNS not found');
                }
                
                const neurons = await fetchUserNeuronsForSns(identity, selectedSns.canisters.governance);
                
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
                
                // Cache and set the result
                setNeuronsBySns(prev => new Map(prev).set(cacheKey, result));
                setNeuronsData(result);
                console.log('refreshNeurons: Successfully refreshed data');
            } catch (err) {
                console.error('Error refreshing neurons:', err);
                setError(err.message);
                setNeuronsData({
                    neurons_by_owner: [],
                    total_voting_power: 0,
                    distribution_voting_power: 0
                });
            } finally {
                setLoading(false);
            }
        }
    }, [selectedSnsRoot, identity, clearCache]);

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
