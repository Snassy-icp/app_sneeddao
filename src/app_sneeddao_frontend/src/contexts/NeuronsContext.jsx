import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { useAuth } from '../AuthContext';
import { useSns } from './SnsContext';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import { getSnsById } from '../utils/SnsUtils';

const NeuronsContext = createContext();

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
        if (!identity || !snsRoot) {
            setNeuronsData({
                neurons_by_owner: [],
                total_voting_power: 0,
                distribution_voting_power: 0
            });
            return;
        }
        
        // Check cache first
        const cacheKey = `${identity.getPrincipal().toString()}-${snsRoot}`;
        if (neuronsBySns.has(cacheKey)) {
            setNeuronsData(neuronsBySns.get(cacheKey));
            return;
        }
        
        setLoading(true);
        setError(null);
        
        try {
            // First get neurons from SNS
            const neurons = await fetchNeuronsForSns(snsRoot);
            
            // Then get voting power data from RLL
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const result = await rllActor.get_hotkey_voting_power(neurons);
            
            // Cache the result
            setNeuronsBySns(prev => new Map(prev).set(cacheKey, result));
            setNeuronsData(result);
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
    }, [identity, selectedSnsRoot, fetchNeuronsForSns, neuronsBySns]);

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
        await fetchHotkeyNeuronsData(snsRoot);
    }, [selectedSnsRoot, clearCache, fetchHotkeyNeuronsData]);

    // Effect to fetch neurons when authentication or SNS changes
    useEffect(() => {
        if (isAuthenticated && identity && selectedSnsRoot) {
            fetchHotkeyNeuronsData(selectedSnsRoot);
        } else {
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