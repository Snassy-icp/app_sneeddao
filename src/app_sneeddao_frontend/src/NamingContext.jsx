import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { getAllNeuronNames, getAllNeuronNicknames, getAllPrincipalNames, getAllPrincipalNicknames } from './utils/BackendUtils';
import { uint8ArrayToHex } from './utils/NeuronUtils';
import { getAllSnses, SNS_CACHE_UPDATED_EVENT } from './utils/SnsUtils';

const NamingContext = createContext();
export { NamingContext };

// LocalStorage keys for caching
const CACHE_KEYS = {
    NEURON_NAMES: 'sneed_neuron_names_cache',
    NEURON_NICKNAMES: 'sneed_neuron_nicknames_cache',
    PRINCIPAL_NAMES: 'sneed_principal_names_cache',
    PRINCIPAL_NICKNAMES: 'sneed_principal_nicknames_cache',
    VERIFIED_NAMES: 'sneed_verified_names_cache',
    LAST_UPDATED: 'sneed_names_cache_updated'
};

// Helper to save Map to localStorage
const saveMapToCache = (key, map) => {
    try {
        const obj = Object.fromEntries(map);
        localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) {
        console.warn('NamingContext: Failed to save to localStorage:', e);
    }
};

// Helper to load Map from localStorage
const loadMapFromCache = (key) => {
    try {
        const data = localStorage.getItem(key);
        if (data) {
            const obj = JSON.parse(data);
            return new Map(Object.entries(obj));
        }
    } catch (e) {
        console.warn('NamingContext: Failed to load from localStorage:', e);
    }
    return new Map();
};

// Helper to merge maps (new values override old, but old values are kept if not in new)
const mergeMaps = (oldMap, newMap) => {
    const merged = new Map(oldMap);
    newMap.forEach((value, key) => {
        merged.set(key, value);
    });
    return merged;
};

export function NamingProvider({ children }) {
    const { identity } = useAuth();
    
    // Initialize from cache immediately
    const [neuronNames, setNeuronNames] = useState(() => loadMapFromCache(CACHE_KEYS.NEURON_NAMES));
    const [neuronNicknames, setNeuronNicknames] = useState(() => loadMapFromCache(CACHE_KEYS.NEURON_NICKNAMES));
    const [principalNames, setPrincipalNames] = useState(() => loadMapFromCache(CACHE_KEYS.PRINCIPAL_NAMES));
    const [principalNicknames, setPrincipalNicknames] = useState(() => loadMapFromCache(CACHE_KEYS.PRINCIPAL_NICKNAMES));
    const [verifiedNames, setVerifiedNames] = useState(() => loadMapFromCache(CACHE_KEYS.VERIFIED_NAMES));
    const [loading, setLoading] = useState(true);
    const [snsCacheVersion, setSnsCacheVersion] = useState(0);
    
    // Track if we've done initial load from cache
    const hasLoadedFromCache = useRef(
        loadMapFromCache(CACHE_KEYS.PRINCIPAL_NAMES).size > 0 || 
        loadMapFromCache(CACHE_KEYS.NEURON_NAMES).size > 0
    );

    const fetchAllNames = async (isBackgroundRefresh = false) => {
        try {
            // Only show loading spinner if we don't have cached data
            if (!isBackgroundRefresh && !hasLoadedFromCache.current) {
                setLoading(true);
            }
            
            console.log('NamingContext: Fetching names from backend...', isBackgroundRefresh ? '(background refresh)' : '');
            
            const [neuronNamesData, neuronNicknamesData, principalNamesData, principalNicknamesData] = await Promise.all([
                getAllNeuronNames(identity),
                identity ? getAllNeuronNicknames(identity) : null,
                getAllPrincipalNames(identity),
                identity ? getAllPrincipalNicknames(identity) : null
            ]);

            // Process neuron names
            const newNeuronNamesMap = new Map();
            const newVerifiedMap = new Map();
            if (neuronNamesData) {
                neuronNamesData.forEach(([key, nameData]) => {
                    const neuronId = uint8ArrayToHex(key.neuron_id.id);
                    const snsRoot = key.sns_root_canister_id.toString();
                    const mapKey = `${snsRoot}:${neuronId}`;
                    const [name, verified] = nameData;
                    newNeuronNamesMap.set(mapKey, name);
                    newVerifiedMap.set(mapKey, verified);
                });
            }

            // Process neuron nicknames
            const newNeuronNicknamesMap = new Map();
            if (neuronNicknamesData) {
                neuronNicknamesData.forEach(([key, nickname]) => {
                    const neuronId = uint8ArrayToHex(key.neuron_id.id);
                    const snsRoot = key.sns_root_canister_id.toString();
                    const mapKey = `${snsRoot}:${neuronId}`;
                    newNeuronNicknamesMap.set(mapKey, nickname);
                });
            }

            // Process principal names
            const newPrincipalNamesMap = new Map();
            if (principalNamesData) {
                principalNamesData.forEach(([principalId, nameData]) => {
                    const [name, verified] = nameData;
                    const principalIdStr = principalId.toString();
                    newPrincipalNamesMap.set(principalIdStr, name);
                    newVerifiedMap.set(principalIdStr, verified);
                });
            }

            // Process principal nicknames
            const newPrincipalNicknamesMap = new Map();
            if (principalNicknamesData) {
                principalNicknamesData.forEach(([principalId, nickname]) => {
                    const principalIdStr = principalId.toString();
                    newPrincipalNicknamesMap.set(principalIdStr, nickname);
                });
            }

            // Merge with existing data (names can't be deleted, only changed)
            setNeuronNames(prev => {
                const merged = mergeMaps(prev, newNeuronNamesMap);
                saveMapToCache(CACHE_KEYS.NEURON_NAMES, merged);
                return merged;
            });
            
            setNeuronNicknames(prev => {
                const merged = mergeMaps(prev, newNeuronNicknamesMap);
                saveMapToCache(CACHE_KEYS.NEURON_NICKNAMES, merged);
                return merged;
            });
            
            setVerifiedNames(prev => {
                const merged = mergeMaps(prev, newVerifiedMap);
                saveMapToCache(CACHE_KEYS.VERIFIED_NAMES, merged);
                return merged;
            });
            
            setPrincipalNames(prev => {
                const merged = mergeMaps(prev, newPrincipalNamesMap);
                saveMapToCache(CACHE_KEYS.PRINCIPAL_NAMES, merged);
                return merged;
            });
            
            setPrincipalNicknames(prev => {
                const merged = mergeMaps(prev, newPrincipalNicknamesMap);
                saveMapToCache(CACHE_KEYS.PRINCIPAL_NICKNAMES, merged);
                return merged;
            });
            
            // Update last refresh timestamp
            localStorage.setItem(CACHE_KEYS.LAST_UPDATED, Date.now().toString());
            
            console.log('NamingContext: Names updated. Principal names:', newPrincipalNamesMap.size, 'Neuron names:', newNeuronNamesMap.size);

        } catch (err) {
            console.error('NamingContext: Error fetching names:', err);
            // On error, we still have cached data, so just log the error
        } finally {
            setLoading(false);
        }
    };

    // Initial load: immediately use cached data, then refresh in background
    useEffect(() => {
        // If we have cached data, mark loading as false immediately
        if (hasLoadedFromCache.current) {
            setLoading(false);
            console.log('NamingContext: Loaded from cache, starting background refresh...');
            // Do background refresh
            fetchAllNames(true);
        } else {
            // No cache, do a full fetch with loading indicator
            fetchAllNames(false);
        }
    }, []);
    
    // When identity changes, do a background refresh to get user-specific nicknames
    useEffect(() => {
        if (identity) {
            console.log('NamingContext: Identity changed, refreshing nicknames...');
            fetchAllNames(true);
        }
    }, [identity]);

    // Subscribe to SNS cache updates (single source of truth in SnsUtils)
    useEffect(() => {
        const handler = () => setSnsCacheVersion(v => v + 1);
        window.addEventListener(SNS_CACHE_UPDATED_EVENT, handler);
        return () => window.removeEventListener(SNS_CACHE_UPDATED_EVENT, handler);
    }, []);

    // Merge principal names with SNS canister names from cache (user-set names take precedence)
    const principalNamesWithSns = useMemo(() => {
        const merged = new Map(principalNames);
        const snses = getAllSnses() || [];
        snses.forEach(sns => {
            const name = sns.name || `SNS ${(sns.rootCanisterId || '').slice(0, 8)}...`;
            const entries = [
                [sns.canisters?.root, `${name} Root`],
                [sns.canisters?.governance, `${name} Governance`],
                [sns.canisters?.ledger, `${name} Ledger`],
                [sns.canisters?.swap, `${name} Swap`],
                [sns.canisters?.index, `${name} Index`],
            ];
            entries.forEach(([canisterId, label]) => {
                if (canisterId && !merged.has(canisterId)) {
                    merged.set(canisterId, label);
                }
            });
            (sns.canisters?.dapps || []).forEach((dappId, i) => {
                if (dappId && !merged.has(dappId)) {
                    merged.set(dappId, `${name} Dapp ${i + 1}`);
                }
            });
            (sns.canisters?.archives || []).forEach((archId, i) => {
                if (archId && !merged.has(archId)) {
                    merged.set(archId, `${name} Archive ${i + 1}`);
                }
            });
        });
        return merged;
    }, [principalNames, snsCacheVersion]);

    const getNeuronDisplayName = (neuronId, snsRoot) => {
        if (!neuronId || !snsRoot) return null;
        const mapKey = `${snsRoot}:${neuronId}`;
        const name = neuronNames.get(mapKey);
        const nickname = neuronNicknames.get(mapKey);
        const isVerified = verifiedNames.get(mapKey);
        
        return { name, nickname, isVerified };
    };

    const getPrincipalDisplayName = (principalId) => {
        if (!principalId) return null;
        const name = principalNamesWithSns.get(principalId.toString());
        const nickname = principalNicknames.get(principalId.toString());
        
        return { name, nickname };
    };

    return (
        <NamingContext.Provider value={{
            neuronNames,
            neuronNicknames,
            principalNames: principalNamesWithSns,
            principalNicknames,
            verifiedNames,
            loading,
            fetchAllNames,
            getNeuronDisplayName,
            getPrincipalDisplayName
        }}>
            {children}
        </NamingContext.Provider>
    );
}

export function useNaming() {
    const context = useContext(NamingContext);
    if (!context) {
        throw new Error('useNaming must be used within a NamingProvider');
    }
    return context;
} 