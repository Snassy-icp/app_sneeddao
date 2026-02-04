import { useState, useEffect, useCallback } from 'react';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { getSnsById, getAllSnses } from '../utils/SnsUtils';
import { uint8ArrayToHex, getNeuronDetails } from '../utils/NeuronUtils';

// ============================================================================
// STANDALONE CACHE UTILITIES (for single neuron operations)
// ============================================================================

const DB_NAME = 'NeuronsDB';
const DB_VERSION = 1;
const STORE_NAME = 'neurons';

/**
 * Normalize a canister ID to string format
 * Accepts Principal objects, strings, or anything with toString()/toText()
 * Also handles objects that were serialized/deserialized (e.g., from IndexedDB)
 * @param {Principal|string|object} canisterId - The canister ID in any format
 * @returns {string} The canister ID as a string
 */
export const normalizeId = (canisterId) => {
    if (!canisterId) return '';
    if (typeof canisterId === 'string') return canisterId;
    // Handle BigInt (for position IDs)
    if (typeof canisterId === 'bigint') return canisterId.toString();
    
    // Handle object types
    if (typeof canisterId === 'object') {
        // Handle Principal objects with toText method
        if (typeof canisterId.toText === 'function') return canisterId.toText();
        
        // Handle dfinity agent's serialized Principal format: {"__principal__":"..."}
        if (canisterId.__principal__ && typeof canisterId.__principal__ === 'string') {
            return canisterId.__principal__;
        }
        
        // Handle our custom serialization format: {"__type":"Principal","value":"..."}
        if (canisterId.__type === 'Principal' && canisterId.value) {
            return canisterId.value;
        }
        
        // Handle serialized Principal objects that might have a value property
        if (canisterId.value && typeof canisterId.value === 'string') {
            return canisterId.value;
        }
        
        // Handle objects with toString (but not plain objects which return "[object Object]")
        if (typeof canisterId.toString === 'function') {
            const str = canisterId.toString();
            if (str !== '[object Object]') return str;
        }
    }
    
    // Fallback
    return String(canisterId);
};

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
 * @param {Principal|string} snsRoot - SNS root canister ID (accepts Principal or string)
 * @param {string} neuronIdHex - Neuron ID in hex format
 * @returns {Object|null} The neuron object or null if not found
 */
export const getNeuronFromCache = async (snsRoot, neuronIdHex) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot) return null;
    
    try {
        const db = await initializeNeuronsDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(normalizedRoot);
            
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
 * Get a single neuron by ID - checks cache first, fetches from network if not cached
 * This is the main API for getting a neuron - callers don't need to manage the cache flow
 * 
 * @param {Object} options - Options object
 * @param {Principal|string} options.snsRoot - SNS root canister ID (accepts Principal or string)
 * @param {Principal|string} [options.governanceCanisterId] - Governance canister ID (optional if snsRoot provided)
 * @param {string} options.neuronIdHex - Neuron ID in hex format
 * @param {Object} options.identity - User identity for network requests
 * @returns {Object|null} The neuron object or null if not found
 */
export const getOrFetchNeuron = async ({ snsRoot, governanceCanisterId, neuronIdHex, identity }) => {
    if (!neuronIdHex) return null;
    
    // Normalize IDs
    const normalizedRoot = normalizeId(snsRoot);
    let normalizedGovId = normalizeId(governanceCanisterId);
    
    // If we have snsRoot but no governanceCanisterId, look it up
    if (normalizedRoot && !normalizedGovId) {
        const sns = getSnsById(normalizedRoot);
        if (sns?.canisters?.governance) {
            normalizedGovId = normalizeId(sns.canisters.governance);
        }
    }
    
    // If we have governanceCanisterId but no snsRoot, look it up
    if (normalizedGovId && !normalizedRoot) {
        const allSnses = getAllSnses();
        const sns = allSnses.find(s => normalizeId(s.canisters?.governance) === normalizedGovId);
        if (sns?.rootCanisterId) {
            // Use the found root for cache operations
            const foundRoot = normalizeId(sns.rootCanisterId);
            return getOrFetchNeuronInternal(foundRoot, normalizedGovId, neuronIdHex, identity);
        }
    }
    
    if (!normalizedRoot) {
        console.warn('[getOrFetchNeuron] Could not determine SNS root canister ID');
        return null;
    }
    
    return getOrFetchNeuronInternal(normalizedRoot, normalizedGovId, neuronIdHex, identity);
};

// Internal implementation
const getOrFetchNeuronInternal = async (snsRoot, governanceCanisterId, neuronIdHex, identity) => {
    // 1. Check cache first
    const cached = await getNeuronFromCache(snsRoot, neuronIdHex);
    if (cached) {
        return cached;
    }
    
    // 2. Not in cache - need to fetch from network
    if (!identity || !governanceCanisterId) {
        return null;
    }
    
    try {
        // 3. Fetch from network
        const neuron = await getNeuronDetails(identity, governanceCanisterId, neuronIdHex);
        
        if (neuron) {
            // 4. Cache the result
            await updateNeuronInCache(snsRoot, neuron);
            return neuron;
        }
        
        return null;
    } catch (error) {
        console.warn('[getOrFetchNeuron] Error fetching neuron:', error);
        return null;
    }
};

/**
 * Fetch a single neuron from network and update cache - ALWAYS goes to network
 * Use this for the "stale-while-revalidate" pattern:
 *   1. Call getNeuronFromCache() → show cached data immediately
 *   2. Call fetchNeuronFresh() → get fresh data, update cache, update UI
 * 
 * @param {Object} options - Options object
 * @param {Principal|string} options.snsRoot - SNS root canister ID (accepts Principal or string)
 * @param {Principal|string} [options.governanceCanisterId] - Governance canister ID (optional if snsRoot provided)
 * @param {string} options.neuronIdHex - Neuron ID in hex format
 * @param {Object} options.identity - User identity for network requests
 * @returns {Object|null} The fresh neuron object or null if fetch failed
 */
export const fetchNeuronFresh = async ({ snsRoot, governanceCanisterId, neuronIdHex, identity }) => {
    if (!neuronIdHex || !identity) return null;
    
    // Normalize and resolve IDs
    const normalizedRoot = normalizeId(snsRoot);
    let normalizedGovId = normalizeId(governanceCanisterId);
    
    // If we have snsRoot but no governanceCanisterId, look it up
    if (normalizedRoot && !normalizedGovId) {
        const sns = getSnsById(normalizedRoot);
        if (sns?.canisters?.governance) {
            normalizedGovId = normalizeId(sns.canisters.governance);
        }
    }
    
    // If we have governanceCanisterId but no snsRoot, look it up
    let effectiveRoot = normalizedRoot;
    if (normalizedGovId && !effectiveRoot) {
        const allSnses = getAllSnses();
        const sns = allSnses.find(s => normalizeId(s.canisters?.governance) === normalizedGovId);
        if (sns?.rootCanisterId) {
            effectiveRoot = normalizeId(sns.rootCanisterId);
        }
    }
    
    if (!normalizedGovId) {
        return null;
    }
    
    try {
        const neuron = await getNeuronDetails(identity, normalizedGovId, neuronIdHex);
        
        if (neuron && effectiveRoot) {
            await updateNeuronInCache(effectiveRoot, neuron);
        }
        
        return neuron;
    } catch (error) {
        console.warn('[fetchNeuronFresh] Error:', error);
        return null;
    }
};

/**
 * Update a single neuron in the cache (or add if not exists)
 * Creates the cache entry if it doesn't exist - does NOT require loading all neurons first
 * @param {Principal|string} snsRoot - SNS root canister ID (accepts Principal or string)
 * @param {Object} neuron - The neuron object to update
 */
export const updateNeuronInCache = async (snsRoot, neuron) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot || !neuron?.id?.[0]?.id) return;
    
    try {
        const db = await initializeNeuronsDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const getRequest = store.get(normalizedRoot);
            
            getRequest.onsuccess = () => {
                const data = getRequest.result;
                
                // Get neuron ID hex for comparison
                const idArray = neuron.id[0].id;
                const neuronIdHex = idArray instanceof Uint8Array
                    ? uint8ArrayToHex(idArray)
                    : Array.isArray(idArray)
                        ? idArray.map(b => b.toString(16).padStart(2, '0')).join('')
                        : '';
                
                // Serialize the neuron for storage
                const serializedNeuron = {
                    ...neuron,
                    id: neuron.id.map(idObj => ({
                        ...idObj,
                        id: idObj.id instanceof Uint8Array 
                            ? Array.from(idObj.id)
                            : Array.isArray(idObj.id) ? idObj.id : []
                    }))
                };
                
                let updatedNeurons;
                
                if (data && data.neurons) {
                    // Find and update the neuron, or add it
                    let found = false;
                    updatedNeurons = data.neurons.map(n => {
                        const existingHex = Array.isArray(n.id?.[0]?.id)
                            ? n.id[0].id.map(b => b.toString(16).padStart(2, '0')).join('')
                            : uint8ArrayToHex(new Uint8Array(n.id?.[0]?.id || []));
                        
                        if (existingHex.toLowerCase() === neuronIdHex.toLowerCase()) {
                            found = true;
                            return serializedNeuron;
                        }
                        return n;
                    });
                    
                    // If not found, add it
                    if (!found) {
                        updatedNeurons.push(serializedNeuron);
                    }
                } else {
                    // No cache exists yet - create it with just this neuron
                    updatedNeurons = [serializedNeuron];
                }
                
                // Save updated cache
                const putRequest = store.put({
                    snsRoot: normalizedRoot,
                    neurons: updatedNeurons,
                    metadata: data?.metadata || { symbol: 'SNS' },
                    timestamp: Date.now()
                });
                
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = () => reject(putRequest.error);
            };
            
            getRequest.onerror = () => reject(getRequest.error);
        });
    } catch (error) {
        // Silently ignore cache update errors
    }
};

/**
 * Serialize a neuron for storage in IndexedDB
 * Handles Uint8Arrays in id field and Principal objects in permissions
 * @param {Object} neuron - The neuron object to serialize
 * @returns {Object} The serialized neuron
 */
const serializeNeuronForStorage = (neuron) => {
    // Serialize the id field (Uint8Array -> Array)
    const serializedId = neuron.id?.map(idObj => ({
        ...idObj,
        id: idObj.id instanceof Uint8Array 
            ? Array.from(idObj.id)
            : Array.isArray(idObj.id) ? idObj.id : []
    })) || neuron.id;
    
    // Serialize permissions (Principal -> string)
    const serializedPermissions = neuron.permissions?.map(p => {
        // Extract principal string safely
        let principalStr = null;
        if (p.principal) {
            if (typeof p.principal === 'string') {
                principalStr = p.principal;
            } else if (typeof p.principal.toText === 'function') {
                principalStr = p.principal.toText();
            } else if (p.principal.__principal__ && typeof p.principal.__principal__ === 'string') {
                principalStr = p.principal.__principal__;
            } else if (p.principal._arr) {
                // Try to reconstruct from internal _arr bytes
                try {
                    const arr = p.principal._arr;
                    const bytes = arr instanceof Uint8Array ? arr : 
                                 (Array.isArray(arr) ? new Uint8Array(arr) : 
                                  (arr.length !== undefined ? new Uint8Array(Array.from(arr)) : null));
                    if (bytes) {
                        principalStr = Principal.fromUint8Array(bytes).toText();
                    }
                } catch (e) {
                    console.warn('[serializeNeuronForStorage] Failed to reconstruct principal from _arr:', e);
                }
            }
            // Fallback: try toString but validate it's not [object Object]
            if (!principalStr) {
                const str = p.principal.toString?.();
                if (str && str !== '[object Object]' && str.includes('-')) {
                    principalStr = str;
                }
            }
        }
        
        return {
            ...p,
            // Store principal as a string for reliable retrieval
            principal: principalStr,
            // Ensure permission_type is a regular array
            permission_type: Array.isArray(p.permission_type) 
                ? p.permission_type 
                : (p.permission_type?.length !== undefined 
                    ? Array.from(p.permission_type) 
                    : p.permission_type)
        };
    }) || neuron.permissions;
    
    return {
        ...neuron,
        id: serializedId,
        permissions: serializedPermissions
    };
};

/**
 * Save neurons to the shared cache (for use by WalletContext and other consumers)
 * This merges with existing neurons rather than replacing
 * @param {Principal|string} snsRoot - SNS root canister ID (accepts Principal or string)
 * @param {Object[]} neurons - Array of neuron objects to save
 */
export const saveNeuronsToCache = async (snsRoot, neurons) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot || !neurons) return;
    
    try {
        const db = await initializeNeuronsDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const getRequest = store.get(normalizedRoot);
            
            getRequest.onsuccess = () => {
                const existingData = getRequest.result;
                let mergedNeurons;
                
                // Handle empty arrays - still save to mark this SNS as "checked"
                if (neurons.length === 0) {
                    // If we have existing neurons, keep them; otherwise empty array
                    mergedNeurons = existingData?.neurons || [];
                } else if (existingData && existingData.neurons) {
                    // Merge: update existing neurons, add new ones
                    const existingMap = new Map();
                    existingData.neurons.forEach(n => {
                        if (n.id?.[0]?.id) {
                            const idArray = n.id[0].id;
                            const hex = Array.isArray(idArray) 
                                ? idArray.map(b => b.toString(16).padStart(2, '0')).join('')
                                : uint8ArrayToHex(new Uint8Array(idArray));
                            existingMap.set(hex.toLowerCase(), n);
                        }
                    });
                    
                    // Add/update with new neurons
                    neurons.forEach(neuron => {
                        if (neuron.id?.[0]?.id) {
                            const idArray = neuron.id[0].id;
                            const hex = idArray instanceof Uint8Array
                                ? uint8ArrayToHex(idArray)
                                : Array.isArray(idArray)
                                    ? idArray.map(b => b.toString(16).padStart(2, '0')).join('')
                                    : '';
                            
                            // Serialize for storage (handles id and permissions)
                            existingMap.set(hex.toLowerCase(), serializeNeuronForStorage(neuron));
                        }
                    });
                    
                    mergedNeurons = Array.from(existingMap.values());
                } else {
                    // No existing data - just serialize the new neurons
                    mergedNeurons = neurons.map(neuron => serializeNeuronForStorage(neuron));
                }
                
                const putRequest = store.put({
                    snsRoot: normalizedRoot,
                    neurons: mergedNeurons,
                    metadata: existingData?.metadata || { symbol: 'SNS' },
                    timestamp: Date.now()
                });
                
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = () => reject(putRequest.error);
            };
            
            getRequest.onerror = () => reject(getRequest.error);
        });
    } catch (error) {
        // Silently ignore cache save errors
    }
};

/**
 * Save the complete list of neuron IDs for an SNS
 * This marks the cache as "complete" - we have all neurons for this SNS
 * @param {Principal|string} snsRoot - SNS root canister ID
 * @param {string[]} neuronIds - Array of neuron IDs in hex format
 */
export const setAllNeuronIdsForSns = async (snsRoot, neuronIds) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot || !neuronIds) return;
    
    try {
        const db = await initializeNeuronsDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const getRequest = store.get(normalizedRoot);
            
            getRequest.onsuccess = () => {
                const existingData = getRequest.result || { snsRoot: normalizedRoot, neurons: [] };
                
                const putRequest = store.put({
                    ...existingData,
                    snsRoot: normalizedRoot,
                    allNeuronIds: neuronIds,
                    allNeuronIdsTimestamp: Date.now(),
                    timestamp: Date.now()
                });
                
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = () => reject(putRequest.error);
            };
            
            getRequest.onerror = () => reject(getRequest.error);
        });
    } catch (error) {
        console.warn('[NeuronsCache] Error saving allNeuronIds:', error);
    }
};

/**
 * Get the complete list of neuron IDs for an SNS (if available)
 * Returns null if we don't have a complete list (only partial/user neurons)
 * @param {Principal|string} snsRoot - SNS root canister ID
 * @returns {{ ids: string[], timestamp: number } | null} Complete ID list or null
 */
export const getAllNeuronIdsForSns = async (snsRoot) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot) return null;
    
    try {
        const db = await initializeNeuronsDB();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(normalizedRoot);
            
            request.onsuccess = () => {
                const data = request.result;
                if (data && data.allNeuronIds && data.allNeuronIds.length > 0) {
                    resolve({
                        ids: data.allNeuronIds,
                        timestamp: data.allNeuronIdsTimestamp || data.timestamp
                    });
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return null;
    }
};

/**
 * Check if we have a complete neuron list for an SNS
 * @param {Principal|string} snsRoot - SNS root canister ID
 * @returns {boolean} True if we have the complete list
 */
export const hasCompleteNeuronList = async (snsRoot) => {
    const result = await getAllNeuronIdsForSns(snsRoot);
    return result !== null && result.ids.length > 0;
};

/**
 * Check if cache exists for an SNS
 * @param {Principal|string} snsRoot - SNS root canister ID (accepts Principal or string)
 * @returns {boolean} True if cache exists
 */
export const hasCacheForSns = async (snsRoot) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot) return false;
    
    try {
        const db = await initializeNeuronsDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(normalizedRoot);
            
            request.onsuccess = () => {
                resolve(!!request.result);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return false;
    }
};

/**
 * Get ALL neurons for an SNS from the shared cache
 * NOTE: This returns ALL cached neurons for the SNS, which may include neurons
 * from different sources (wallet, /neurons page). Use getNeuronsFromCacheByIds
 * for filtering to specific neurons.
 * @param {Principal|string} snsRoot - SNS root canister ID (accepts Principal or string)
 * @returns {Object[]} Array of neuron objects, or empty array if not found
 */
export const getAllNeuronsForSns = async (snsRoot) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot) return [];
    
    try {
        const db = await initializeNeuronsDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(normalizedRoot);
            
            request.onsuccess = () => {
                const data = request.result;
                if (!data || !data.neurons || data.neurons.length === 0) {
                    resolve([]);
                    return;
                }
                
                // Reconstruct Uint8Arrays for neuron IDs
                const neurons = data.neurons.map(n => ({
                    ...n,
                    id: n.id?.map(idObj => ({
                        ...idObj,
                        id: new Uint8Array(idObj.id)
                    })) || n.id
                }));
                
                resolve(neurons);
            };
            
            request.onerror = () => resolve([]);
        });
    } catch (error) {
        return [];
    }
};

/**
 * Get multiple neurons from cache by their hex IDs
 * @param {Principal|string} snsRoot - SNS root canister ID (accepts Principal or string)
 * @param {string[]} neuronIdHexArray - Array of neuron IDs in hex format
 * @returns {Object} { found: neuron[], missing: string[] } - Found neurons and missing IDs
 */
export const getNeuronsFromCacheByIds = async (snsRoot, neuronIdHexArray) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot || !neuronIdHexArray || neuronIdHexArray.length === 0) {
        return { found: [], missing: neuronIdHexArray || [] };
    }
    
    try {
        const db = await initializeNeuronsDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(normalizedRoot);
            
            request.onsuccess = () => {
                const data = request.result;
                if (!data || !data.neurons) {
                    resolve({ found: [], missing: neuronIdHexArray });
                    return;
                }
                
                const found = [];
                const foundIds = new Set();
                const idSet = new Set(neuronIdHexArray.map(id => id.toLowerCase()));
                
                data.neurons.forEach(n => {
                    if (!n.id?.[0]?.id) return;
                    const idArray = n.id[0].id;
                    const hex = Array.isArray(idArray) 
                        ? idArray.map(b => b.toString(16).padStart(2, '0')).join('')
                        : uint8ArrayToHex(new Uint8Array(idArray));
                    
                    if (idSet.has(hex.toLowerCase())) {
                        // Reconstruct Uint8Array for neuron ID
                        const reconstructedNeuron = {
                            ...n,
                            id: n.id.map(idObj => ({
                                ...idObj,
                                id: new Uint8Array(idObj.id)
                            }))
                        };
                        found.push(reconstructedNeuron);
                        foundIds.add(hex.toLowerCase());
                    }
                });
                
                const missing = neuronIdHexArray.filter(id => !foundIds.has(id.toLowerCase()));
                resolve({ found, missing });
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return { found: [], missing: neuronIdHexArray };
    }
};

/**
 * Get multiple neurons by ID - checks cache first, fetches missing from network
 * Convenience method that combines getNeuronsFromCacheByIds + getOrFetchNeuron for missing
 * 
 * @param {Object} options - Options object
 * @param {Principal|string} options.snsRoot - SNS root canister ID (accepts Principal or string)
 * @param {Principal|string} [options.governanceCanisterId] - Governance canister ID (optional if snsRoot provided)
 * @param {string[]} options.neuronIdHexArray - Array of neuron IDs in hex format
 * @param {Object} options.identity - User identity for network requests (needed for fetching missing)
 * @returns {Object[]} Array of neurons (those found in cache + those fetched from network)
 */
export const getOrFetchNeuronsByIds = async ({ snsRoot, governanceCanisterId, neuronIdHexArray, identity }) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot || !neuronIdHexArray || neuronIdHexArray.length === 0) {
        return [];
    }
    
    // Resolve governance canister ID if not provided
    let normalizedGovId = normalizeId(governanceCanisterId);
    if (!normalizedGovId) {
        const sns = getSnsById(normalizedRoot);
        if (sns?.canisters?.governance) {
            normalizedGovId = normalizeId(sns.canisters.governance);
        }
    }
    
    // 1. Try to get from cache first
    const { found, missing } = await getNeuronsFromCacheByIds(normalizedRoot, neuronIdHexArray);
    
    // 2. If all found in cache, we're done
    if (missing.length === 0) {
        return found;
    }
    
    // 3. If no identity, can't fetch missing - return what we have
    if (!identity) {
        return found;
    }
    
    if (!normalizedGovId) {
        return found;
    }
    
    // 4. Fetch missing neurons from network (in parallel, but limit concurrency)
    const BATCH_SIZE = 5;
    const fetchedNeurons = [];
    
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(neuronIdHex => 
                getNeuronDetails(identity, normalizedGovId, neuronIdHex).catch(() => null)
            )
        );
        
        for (const neuron of batchResults) {
            if (neuron) {
                fetchedNeurons.push(neuron);
            }
        }
    }
    
    // 5. Cache the newly fetched neurons
    if (fetchedNeurons.length > 0) {
        await saveNeuronsToCache(normalizedRoot, fetchedNeurons);
    }
    
    // 6. Return all neurons (cached + freshly fetched)
    return [...found, ...fetchedNeurons];
};

/**
 * Clear cache for a specific SNS
 * @param {Principal|string} snsRoot - SNS root canister ID (accepts Principal or string)
 */
export const clearCacheForSns = async (snsRoot) => {
    const normalizedRoot = normalizeId(snsRoot);
    if (!normalizedRoot) return;
    
    try {
        const db = await initializeNeuronsDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(normalizedRoot);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        // Silently ignore cache clear errors
    }
};

// ============================================================================
// MAIN HOOK (for loading all neurons - used by /neurons, /users, /hub pages)
// ============================================================================

/**
 * Reusable hook for fetching and caching SNS neurons using IndexedDB
 * This hook is shared between /neurons, /users, and /hub pages
 * NOTE: This loads ALL neurons for an SNS - for individual neuron operations,
 * use the standalone functions like getNeuronFromCache, updateNeuronInCache
 */
export default function useNeuronsCache(selectedSnsRoot, identity) {
    // Normalize the selected SNS root
    const normalizedSnsRoot = normalizeId(selectedSnsRoot);
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
        const normalized = normalizeId(snsRoot);
        if (!normalized) return null;
        
        try {
            const db = await initializeDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(['neurons'], 'readonly');
                const store = transaction.objectStore('neurons');
                const request = store.get(normalized);
                
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
        const normalized = normalizeId(snsRoot);
        if (!normalized) return;
        
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
                    snsRoot: normalized,
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

    // Clear cache for a specific SNS (uses the standalone function)
    const clearCache = useCallback(async (snsRoot) => {
        return clearCacheForSns(snsRoot);
    }, []);

    // Fetch neuron count from SNS API
    const fetchNeuronCount = useCallback(async () => {
        if (!normalizedSnsRoot) return 0;
        try {
            const response = await fetch(`https://sns-api.internetcomputer.org/api/v2/snses/${normalizedSnsRoot}/neurons/count`);
            const data = await response.json();
            const total = data.total || 0;
            setTotalNeuronCount(total);
            return total;
        } catch (error) {
            console.error('Error fetching neuron count:', error);
            return 0;
        }
    }, [normalizedSnsRoot]);

    // Fetch neurons from the governance canister
    const fetchNeurons = useCallback(async () => {
        if (!normalizedSnsRoot) return;
        
        setLoading(true);
        setError('');
        setLoadingProgress({ count: 0, message: 'Initializing...', percent: 0 });
        
        try {
            const selectedSns = getSnsById(normalizedSnsRoot);
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
            await setCacheData(normalizedSnsRoot, sortedNeurons, { symbol });
            
            // Save the complete list of neuron IDs (marks this SNS as "complete")
            const allNeuronIds = sortedNeurons.map(n => {
                const idArray = n.id?.[0]?.id;
                if (!idArray) return null;
                return idArray instanceof Uint8Array 
                    ? uint8ArrayToHex(idArray)
                    : Array.isArray(idArray)
                        ? idArray.map(b => b.toString(16).padStart(2, '0')).join('')
                        : null;
            }).filter(Boolean);
            await setAllNeuronIdsForSns(normalizedSnsRoot, allNeuronIds);
            
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
    }, [normalizedSnsRoot, identity, fetchNeuronCount, setCacheData]);

    // Load data (from cache or fetch)
    // If we have a complete ID list, use progressive loading for instant display
    const loadData = useCallback(async () => {
        if (!normalizedSnsRoot) return;
        
        // First, check if we have a complete ID list (indicates full neuron data)
        const completeIdList = await getAllNeuronIdsForSns(normalizedSnsRoot);
        
        if (completeIdList && completeIdList.ids.length > 0) {
            // We have a complete list - start with instant display
            setLoading(true);
            setLoadingProgress({ 
                count: completeIdList.ids.length, 
                message: `Loading ${completeIdList.ids.length} neurons from cache...`, 
                percent: 10 
            });
            
            // Try to load full neuron data from cache
            const cachedData = await getCachedData(normalizedSnsRoot);
            
            if (cachedData && cachedData.neurons && cachedData.neurons.length > 0) {
                // Great - we have full cached data
                setLoadingProgress({ 
                    count: cachedData.neurons.length, 
                    message: 'Loaded from cache', 
                    percent: 100 
                });
                setNeurons(cachedData.neurons);
                setTokenSymbol(cachedData.metadata?.symbol || 'SNS');
                setLoading(false);
                
                // Check if we need to refresh (count mismatch with API)
                const apiCount = await fetchNeuronCount();
                if (apiCount > 0 && Math.abs(apiCount - cachedData.neurons.length) > 5) {
                    // Significant difference - silently refresh in background
                    console.log(`[NeuronsCache] Cache has ${cachedData.neurons.length} neurons, API reports ${apiCount}. Refreshing...`);
                    fetchNeurons(); // Don't await - runs in background
                }
            } else {
                // We have IDs but not full data - this shouldn't happen normally
                // but let's handle it by fetching fresh
                await fetchNeurons();
            }
        } else {
            // No complete ID list - check for any cached data
            const cachedData = await getCachedData(normalizedSnsRoot);
            
            if (cachedData && cachedData.neurons && cachedData.neurons.length > 0) {
                // We have some cached neurons but not a complete list
                // This might be just the user's neurons from WalletContext
                // Don't use this - fetch fresh data instead
                console.log(`[NeuronsCache] Found ${cachedData.neurons.length} cached neurons but no complete ID list. Fetching fresh...`);
                await fetchNeurons();
            } else {
                // No cached data at all - fetch fresh
                await fetchNeurons();
            }
        }
    }, [normalizedSnsRoot, getCachedData, fetchNeurons, fetchNeuronCount]);

    // Refresh data (clear cache and fetch)
    const refreshData = useCallback(async () => {
        await clearCache(normalizedSnsRoot);
        await fetchNeurons();
    }, [normalizedSnsRoot, clearCache, fetchNeurons]);

    // Auto-load when normalizedSnsRoot changes
    useEffect(() => {
        if (normalizedSnsRoot) {
            setNeurons([]);
            loadData();
        }
    }, [normalizedSnsRoot]);

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
