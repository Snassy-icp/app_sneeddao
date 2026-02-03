import { useState, useEffect, useCallback } from 'react';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { HttpAgent } from '@dfinity/agent';
import { getSnsById } from '../utils/SnsUtils';
import { uint8ArrayToHex } from '../utils/NeuronUtils';

// ============================================================================
// STANDALONE CACHE UTILITIES (for single neuron operations)
// ============================================================================

const DB_NAME = 'NeuronsDB';
const DB_VERSION = 1;
const STORE_NAME = 'neurons';

/**
 * Initialize IndexedDB (standalone version)
 */
const initializeNeuronsDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'snsRoot' });
            }
        };
    });
};

/**
 * Get a single neuron from cache by its hex ID
 * @param {string} snsRoot - SNS root canister ID
 * @param {string} neuronIdHex - Neuron ID in hex format
 * @returns {Object|null} The neuron object or null if not found
 */
export const getNeuronFromCache = async (snsRoot, neuronIdHex) => {
    try {
        const db = await initializeNeuronsDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(snsRoot);
            
            request.onsuccess = () => {
                const data = request.result;
                if (data && data.neurons) {
                    // Find neuron by matching hex ID
                    const neuron = data.neurons.find(n => {
                        if (!n.id?.[0]?.id) return false;
                        const idArray = n.id[0].id;
                        // Handle both Uint8Array and regular Array
                        const hex = Array.isArray(idArray) 
                            ? idArray.map(b => b.toString(16).padStart(2, '0')).join('')
                            : uint8ArrayToHex(new Uint8Array(idArray));
                        return hex === neuronIdHex.toLowerCase();
                    });
                    
                    if (neuron) {
                        // Reconstruct Uint8Array for neuron ID
                        const reconstructedNeuron = {
                            ...neuron,
                            id: neuron.id.map(idObj => ({
                                ...idObj,
                                id: new Uint8Array(idObj.id)
                            }))
                        };
                        console.log('%c🧠 [NEURON CACHE] Found neuron in cache:', 'background: #2ecc71; color: white; padding: 2px 6px;', neuronIdHex.substring(0, 16) + '...');
                        resolve(reconstructedNeuron);
                    } else {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('Error getting neuron from cache:', error);
        return null;
    }
};

/**
 * Update a single neuron in the cache (or add if not exists)
 * Does NOT trigger loading all neurons
 * @param {string} snsRoot - SNS root canister ID
 * @param {Object} neuron - The neuron object to update
 */
export const updateNeuronInCache = async (snsRoot, neuron) => {
    try {
        const db = await initializeNeuronsDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const getRequest = store.get(snsRoot);
            
            getRequest.onsuccess = () => {
                const data = getRequest.result;
                
                if (data && data.neurons) {
                    // Get neuron ID hex for comparison
                    const neuronIdHex = uint8ArrayToHex(neuron.id[0]?.id);
                    
                    // Find and update the neuron, or add it
                    let found = false;
                    const updatedNeurons = data.neurons.map(n => {
                        const existingHex = Array.isArray(n.id?.[0]?.id)
                            ? n.id[0].id.map(b => b.toString(16).padStart(2, '0')).join('')
                            : uint8ArrayToHex(new Uint8Array(n.id?.[0]?.id || []));
                        
                        if (existingHex === neuronIdHex) {
                            found = true;
                            // Serialize the neuron for storage
                            return {
                                ...neuron,
                                id: neuron.id.map(idObj => ({
                                    ...idObj,
                                    id: Array.from(idObj.id)
                                }))
                            };
                        }
                        return n;
                    });
                    
                    // If not found, add it
                    if (!found) {
                        updatedNeurons.push({
                            ...neuron,
                            id: neuron.id.map(idObj => ({
                                ...idObj,
                                id: Array.from(idObj.id)
                            }))
                        });
                    }
                    
                    // Save updated cache
                    const putRequest = store.put({
                        ...data,
                        neurons: updatedNeurons,
                        timestamp: Date.now()
                    });
                    
                    putRequest.onsuccess = () => {
                        console.log('%c🧠 [NEURON CACHE] Updated neuron in cache:', 'background: #3498db; color: white; padding: 2px 6px;', neuronIdHex.substring(0, 16) + '...');
                        resolve();
                    };
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    // No cache exists yet - that's OK, the /neurons page will create it
                    console.log('%c🧠 [NEURON CACHE] No cache exists yet, skipping update', 'background: #95a5a6; color: white; padding: 2px 6px;');
                    resolve();
                }
            };
            
            getRequest.onerror = () => reject(getRequest.error);
        });
    } catch (error) {
        console.warn('Error updating neuron in cache:', error);
    }
};

/**
 * Check if cache exists for an SNS
 * @param {string} snsRoot - SNS root canister ID
 * @returns {boolean} True if cache exists
 */
export const hasCacheForSns = async (snsRoot) => {
    try {
        const db = await initializeNeuronsDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(snsRoot);
            
            request.onsuccess = () => {
                resolve(!!request.result);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return false;
    }
};

// ============================================================================
// MAIN HOOK (for loading all neurons)
// ============================================================================

/**
 * Reusable hook for fetching and caching SNS neurons using IndexedDB
 * This hook is shared between /neurons, /users, and /hub pages
 */
export default function useNeuronsCache(selectedSnsRoot, identity) {
    const [neurons, setNeurons] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [tokenSymbol, setTokenSymbol] = useState('SNS');
    const [totalNeuronCount, setTotalNeuronCount] = useState(null);
    const [loadingProgress, setLoadingProgress] = useState({ count: 0, message: '', percent: 0 });

    // IndexedDB initialization (reuse the standalone function)
    const initializeDB = useCallback(() => initializeNeuronsDB(), []);

    // Get cached data from IndexedDB
    const getCachedData = useCallback(async (snsRoot) => {
        try {
            const db = await initializeDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(['neurons'], 'readonly');
                const store = transaction.objectStore('neurons');
                const request = store.get(snsRoot);
                
                request.onsuccess = () => {
                    const data = request.result;
                    if (data) {
                        // Reconstruct Uint8Arrays for neuron IDs
                        const neurons = data.neurons.map(neuron => ({
                            ...neuron,
                            id: neuron.id.map(idObj => ({
                                ...idObj,
                                id: new Uint8Array(idObj.id)
                            }))
                        }));
                        resolve({ neurons, metadata: data.metadata, timestamp: data.timestamp });
                    } else {
                        resolve(null);
                    }
                };
                
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('Error reading from IndexedDB:', error);
            return null;
        }
    }, [initializeDB]);

    // Set cache data in IndexedDB
    const setCacheData = useCallback(async (snsRoot, neurons, metadata) => {
        try {
            const db = await initializeDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(['neurons'], 'readwrite');
                const store = transaction.objectStore('neurons');
                
                // Convert Uint8Arrays to regular arrays for storage
                const serializedNeurons = neurons.map(neuron => ({
                    ...neuron,
                    id: neuron.id.map(idObj => ({
                        ...idObj,
                        id: Array.from(idObj.id)
                    }))
                }));
                
                const request = store.put({
                    snsRoot,
                    neurons: serializedNeurons,
                    metadata,
                    timestamp: Date.now()
                });
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('Error writing to IndexedDB:', error);
        }
    }, [initializeDB]);

    // Clear cache for a specific SNS
    const clearCache = useCallback(async (snsRoot) => {
        try {
            const db = await initializeDB();
            const transaction = db.transaction(['neurons'], 'readwrite');
            const store = transaction.objectStore('neurons');
            await store.delete(snsRoot);
        } catch (error) {
            console.warn('Error clearing cache:', error);
        }
    }, [initializeDB]);

    // Fetch neuron count from SNS API
    const fetchNeuronCount = useCallback(async () => {
        if (!selectedSnsRoot) return 0;
        try {
            const response = await fetch(`https://sns-api.internetcomputer.org/api/v2/snses/${selectedSnsRoot}/neurons/count`);
            const data = await response.json();
            const total = data.total || 0;
            setTotalNeuronCount(total);
            return total;
        } catch (error) {
            console.error('Error fetching neuron count:', error);
            return 0;
        }
    }, [selectedSnsRoot]);

    // Fetch neurons from the governance canister
    const fetchNeurons = useCallback(async () => {
        if (!selectedSnsRoot) return;
        
        setLoading(true);
        setError('');
        setLoadingProgress({ count: 0, message: 'Initializing...', percent: 0 });
        
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) {
                setError('Selected SNS not found');
                setLoading(false);
                return;
            }

            // Fetch total neuron count first
            const totalCount = await fetchNeuronCount();
            setLoadingProgress(prev => ({ 
                ...prev, 
                message: 'Connected to governance canister',
                percent: 5
            }));

            // Create an anonymous agent if no identity is available
            const agent = identity ? 
                new HttpAgent({ identity }) : 
                new HttpAgent();

            if (process.env.DFX_NETWORK !== 'ic') {
                await agent.fetchRootKey();
            }

            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agent
            });

            // Fetch all neurons using pagination
            let allNeurons = [];
            let hasMore = true;
            let lastNeuron = [];
            let pageCount = 0;

            while (hasMore) {
                pageCount++;
                const baseProgress = 5;
                const maxProgress = 90;
                const progressRange = maxProgress - baseProgress;
                const progressPercent = totalCount > 0 
                    ? baseProgress + ((allNeurons.length / totalCount) * progressRange)
                    : baseProgress + (pageCount * 2);
                
                setLoadingProgress({ 
                    count: allNeurons.length,
                    message: `Fetching page ${pageCount} (${allNeurons.length}${totalCount ? ` of ${totalCount}` : ''} neurons)...`,
                    percent: Math.min(maxProgress, progressPercent)
                });

                const response = await snsGovActor.list_neurons({
                    limit: 100,
                    of_principal: [],
                    start_page_at: lastNeuron
                });
                
                if (response.neurons.length === 0) {
                    hasMore = false;
                } else {
                    allNeurons = [...allNeurons, ...response.neurons];
                    const lastNeuronId = response.neurons[response.neurons.length - 1].id;
                    lastNeuron = lastNeuronId;
                    
                    if (response.neurons.length < 100) {
                        hasMore = false;
                    }
                }
            }

            setLoadingProgress({ 
                count: allNeurons.length,
                message: `Sorting ${allNeurons.length}${totalCount ? ` of ${totalCount}` : ''} neurons by stake...`,
                percent: 95
            });
            
            // Sort neurons by stake (highest first)
            const sortedNeurons = allNeurons.sort((a, b) => {
                const stakeA = BigInt(a.cached_neuron_stake_e8s || 0);
                const stakeB = BigInt(b.cached_neuron_stake_e8s || 0);
                return stakeB > stakeA ? 1 : stakeB < stakeA ? -1 : 0;
            });

            setNeurons(sortedNeurons);

            setLoadingProgress({ 
                count: allNeurons.length,
                message: `Fetching token metadata...`,
                percent: 97
            });

            // Get token symbol
            const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, { agent });
            const metadata = await icrc1Actor.icrc1_metadata();
            const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
            let symbol = 'SNS';
            if (symbolEntry && symbolEntry[1]) {
                symbol = symbolEntry[1].Text;
                setTokenSymbol(symbol);
            }

            // Cache the fetched data
            await setCacheData(selectedSnsRoot, sortedNeurons, { symbol });
            
            setLoadingProgress({ 
                count: sortedNeurons.length,
                message: `Cached ${sortedNeurons.length} neurons for future use`,
                percent: 100
            });

        } catch (err) {
            console.error('Error fetching neurons:', err);
            setError('Failed to fetch neurons');
        } finally {
            setLoading(false);
        }
    }, [selectedSnsRoot, identity, fetchNeuronCount, setCacheData]);

    // Load data (from cache or fetch)
    const loadData = useCallback(async () => {
        if (!selectedSnsRoot) return;
        
        const cachedData = await getCachedData(selectedSnsRoot);
        if (cachedData) {
            console.log('Loading from cache for SNS:', selectedSnsRoot);
            setLoadingProgress({ count: cachedData.neurons.length, message: 'Loading from cache...', percent: 100 });
            setNeurons(cachedData.neurons);
            setTokenSymbol(cachedData.metadata.symbol);
            setLoading(false);
        } else {
            console.log('No cache found for SNS:', selectedSnsRoot);
            await fetchNeurons();
        }
    }, [selectedSnsRoot, getCachedData, fetchNeurons]);

    // Refresh data (clear cache and fetch)
    const refreshData = useCallback(async () => {
        await clearCache(selectedSnsRoot);
        await fetchNeurons();
    }, [selectedSnsRoot, clearCache, fetchNeurons]);

    // Auto-load when selectedSnsRoot changes
    useEffect(() => {
        if (selectedSnsRoot) {
            setNeurons([]);
            loadData();
        }
    }, [selectedSnsRoot]);

    return {
        neurons,
        loading,
        error,
        tokenSymbol,
        totalNeuronCount,
        loadingProgress,
        refreshData,
        loadData,
        setError
    };
}
