import { createActor as createNnsSnsWActor } from 'external/nns_snsw';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';

const SNS_CACHE_KEY = 'sns_data_cache';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

// Memory fallback when localStorage fails
let memoryCache = null;

// In-memory cache for SNS logos
const logoCache = new Map();

// Event listeners for background SNS data updates
const snsUpdateListeners = new Set();

// Safe localStorage wrapper with memory fallback
const safeStorage = {
    getItem: (key) => {
        try {
            return localStorage.getItem(key);
        } catch (error) {
            console.warn('localStorage access failed, using memory fallback:', error);
            return memoryCache;
        }
    },
    setItem: (key, value) => {
        try {
            localStorage.setItem(key, value);
        } catch (error) {
            console.warn('localStorage write failed, using memory fallback:', error);
            memoryCache = value;
        }
    },
    removeItem: (key) => {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('localStorage remove failed, using memory fallback:', error);
            memoryCache = null;
        }
    }
};

// Helper function to safely get canister ID
function safeGetCanisterId(canisterIdArray) {
    try {
        if (Array.isArray(canisterIdArray) && canisterIdArray.length > 0 && canisterIdArray[0]) {
            // Check if it's already a string
            if (typeof canisterIdArray[0] === 'string') {
                return canisterIdArray[0];
            }
            // Check if it's a Principal with toText method
            if (typeof canisterIdArray[0].toText === 'function') {
                return canisterIdArray[0].toText();
            }
            // If it has an _arr property (Principal internal representation)
            if (canisterIdArray[0]._arr) {
                return Principal.fromUint8Array(canisterIdArray[0]._arr).toText();
            }
        }
        console.warn('Invalid canister ID array:', canisterIdArray);
        return null;
    } catch (err) {
        console.error('Error extracting canister ID:', err);
        return null;
    }
}

// New function to fetch SNS logo
export async function fetchSnsLogo(governanceId, agent) {
    // Check memory cache first
    if (logoCache.has(governanceId)) {
        return logoCache.get(governanceId);
    }

    try {
        const governanceActor = createSnsGovernanceActor(governanceId, { agent });
        const metadataResponse = await governanceActor.get_metadata({});
        const logo = metadataResponse?.logo?.[0] || '';
        
        // Store in memory cache
        logoCache.set(governanceId, logo);
        return logo;
    } catch (error) {
        console.error(`Error fetching logo for SNS ${governanceId}:`, error);
        return '';
    }
}

// Clear logo cache (useful when debugging or if logos aren't loading correctly)
export function clearLogoCache() {
    logoCache.clear();
}

export async function fetchAndCacheSnsData(identity) {
    console.log('Starting fetchAndCacheSnsData...'); // Debug log
    
    // Check cache first
    const cachedData = getCachedSnsData();
    
    // Get priority SNS from URL
    const prioritySns = new URLSearchParams(window.location.search).get('sns');
    
    // If we have cached data and either no priority OR priority is in cache, return cache
    if (cachedData && cachedData.length > 0) {
        if (!prioritySns || cachedData.find(sns => sns.rootCanisterId === prioritySns)) {
            console.log('Returning cached SNS data:', cachedData);
            return cachedData;
        }
    }

    try {
        console.log('Creating NNS SNS Wrapper actor...'); // Debug log
        
        // Create an agent with proper host configuration
        const host = process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943';
        console.log('Using host:', host);
        
        const agentConfig = {
            host,
            ...(identity && { identity })
        };
        console.log('Agent config:', { ...agentConfig, identity: identity ? 'present' : 'none' });
        
        const agent = new HttpAgent(agentConfig);

        try {
            if (process.env.DFX_NETWORK !== 'ic') {
                console.log('Fetching root key for local development...');
                await agent.fetchRootKey();
            }
        } catch (rootKeyError) {
            console.error('Error fetching root key:', rootKeyError);
            // Continue anyway as this might not be critical for IC
        }

        // If we have a priority SNS not in cache, load it first
        if (prioritySns && (!cachedData || !cachedData.find(sns => sns.rootCanisterId === prioritySns))) {
            console.log('Loading priority SNS:', prioritySns);
            try {
                const prioritySnsData = await loadSingleSns(prioritySns, agent);
                if (prioritySnsData) {
                    console.log('Successfully loaded priority SNS:', prioritySnsData);
                    // Cache immediately with existing data
                    const initialData = [...(cachedData || []), prioritySnsData];
                    cacheSnsData(initialData);
                    
                    // Start loading the rest in background (don't await)
                    loadRestInBackground(agent, initialData);
                    
                    return initialData;
                }
            } catch (error) {
                console.warn('Failed to load priority SNS, falling back to full load:', error);
            }
        }

        // Fallback to normal loading
        return await loadAllSnses(agent);
        
    } catch (error) {
        console.error('Error fetching SNS data:', error);
        // Only return cached data if it exists and is not empty
        if (cachedData && cachedData.length > 0) {
            return cachedData;
        }
        return [];
    }
}

// Helper function to load a single SNS by root canister ID
async function loadSingleSns(rootCanisterId, agent) {
    try {
        // Get all SNSes to find the target one
        const nnsSnsWActor = createNnsSnsWActor('qaa6y-5yaaa-aaaaa-aaafa-cai', { agent });
        const response = await nnsSnsWActor.list_deployed_snses({});
        const deployedSnses = response?.instances || [];
        
        const targetSns = deployedSnses.find(sns => 
            safeGetCanisterId(sns.root_canister_id) === rootCanisterId
        );
        
        if (!targetSns) {
            throw new Error(`SNS with root canister ${rootCanisterId} not found`);
        }
        
        return await processSingleSnsInstance(targetSns, agent);
    } catch (error) {
        console.error('Error loading single SNS:', error);
        return null;
    }
}

// Helper function to process a single SNS instance
async function processSingleSnsInstance(sns, agent) {
    const rootCanisterId = safeGetCanisterId(sns.root_canister_id);
    const governanceId = safeGetCanisterId(sns.governance_canister_id);
    const ledgerId = safeGetCanisterId(sns.ledger_canister_id);
    const swapId = safeGetCanisterId(sns.swap_canister_id);

    if (!rootCanisterId || !governanceId || !ledgerId) {
        console.error('Missing required canister IDs for SNS:', {
            rootCanisterId,
            governanceId,
            ledgerId,
            swapId
        });
        return null;
    }

    try {
        // Create governance actor with the same agent
        const governanceActor = createSnsGovernanceActor(governanceId, { agent });

        // Get metadata from governance canister
        const metadataResponse = await governanceActor.get_metadata({});

        // Extract only essential metadata
        const name = metadataResponse?.name?.[0] || `SNS ${rootCanisterId.slice(0, 8)}...`;
        
        // Store only essential data
        const snsData = {
            rootCanisterId,
            name,
            canisters: {
                governance: governanceId,
                ledger: ledgerId,
                root: rootCanisterId,
                swap: swapId
            }
        };
        
        return snsData;
    } catch (err) {
        // Skip SNSes that aren't properly installed yet
        if (err.message?.includes('no Wasm module')) {
            console.log(`Skipping uninstalled SNS ${governanceId}`);
            return null;
        }
        throw err;
    }
}

// Background function to load all remaining SNSes
async function loadRestInBackground(agent, existingData) {
    try {
        console.log('Loading remaining SNSes in background...');
        const allSnsData = await loadAllSnses(agent);
        
        // Merge with existing data, avoiding duplicates
        const existingIds = new Set(existingData.map(sns => sns.rootCanisterId));
        const newSnsData = allSnsData.filter(sns => !existingIds.has(sns.rootCanisterId));
        
        if (newSnsData.length > 0) {
            const completeData = [...existingData, ...newSnsData];
            cacheSnsData(completeData);
            console.log('Background SNS loading completed, notifying listeners');
            notifySnsUpdate(completeData);
        }
    } catch (error) {
        console.error('Error in background SNS loading:', error);
    }
}

// Extract the original loading logic into a separate function
async function loadAllSnses(agent) {
    console.log('Creating NNS SNS Wrapper actor with canister:', 'qaa6y-5yaaa-aaaaa-aaafa-cai');
    const nnsSnsWActor = createNnsSnsWActor('qaa6y-5yaaa-aaaaa-aaafa-cai', {
        agent
    });

    console.log('Calling list_deployed_snses...'); // Debug log
    let response;
    try {
        response = await nnsSnsWActor.list_deployed_snses({});
        console.log('Raw response from list_deployed_snses:', response); // Debug log
    } catch (listError) {
        console.error('Error calling list_deployed_snses:', listError);
        throw listError;
    }
    
    const deployedSnses = response?.instances || [];
    console.log('Deployed SNSes:', deployedSnses); // Debug log
    
    if (!deployedSnses.length) {
        console.log('No SNS instances found'); // Debug log
        return [];
    }

    console.log(`Processing ${deployedSnses.length} SNS instances...`); // Debug log

    // Process each SNS instance
    const snsDataPromises = deployedSnses.map(async (sns) => {
        try {
            // Extract all canister IDs
            const rootCanisterId = safeGetCanisterId(sns.root_canister_id);
            const governanceId = safeGetCanisterId(sns.governance_canister_id);
            const ledgerId = safeGetCanisterId(sns.ledger_canister_id);
            const swapId = safeGetCanisterId(sns.swap_canister_id);

            if (!rootCanisterId || !governanceId || !ledgerId) {
                console.error('Missing required canister IDs for SNS:', {
                    rootCanisterId,
                    governanceId,
                    ledgerId,
                    swapId
                });
                return null;
            }

            console.log('Processing SNS with governance canister:', governanceId); // Debug log

            try {
                // Create governance actor with the same agent
                const governanceActor = createSnsGovernanceActor(governanceId, {
                    agent
                });

                // Get metadata from governance canister
                const metadataResponse = await governanceActor.get_metadata({});
                console.log('Metadata response:', metadataResponse); // Debug log

                // Extract only essential metadata
                const name = metadataResponse?.name?.[0] || `SNS ${rootCanisterId.slice(0, 8)}...`;
                
                // Store only essential data
                const snsData = {
                    rootCanisterId,
                    name,
                    canisters: {
                        governance: governanceId,
                        ledger: ledgerId,
                        root: rootCanisterId,
                        swap: swapId
                    }
                };
                
                console.log('Successfully processed SNS:', snsData); // Debug log
                return snsData;
            } catch (err) {
                // Skip SNSes that aren't properly installed yet
                if (err.message?.includes('no Wasm module')) {
                    console.log(`Skipping uninstalled SNS ${governanceId}`);
                    return null;
                }
                throw err;
            }
        } catch (err) {
            console.error('Error processing SNS:', err);
            return null;
        }
    });

    console.log('Waiting for all SNS processing to complete...'); // Debug log
    const snsData = (await Promise.all(snsDataPromises)).filter(Boolean);
    console.log('Final SNS data:', snsData); // Debug log
    
    // Cache the data only if we have valid results
    if (snsData.length > 0) {
        console.log('Caching SNS data...'); // Debug log
        cacheSnsData(snsData);
    } else {
        console.log('No valid SNS data to cache'); // Debug log
        // Clear invalid cache
        safeStorage.removeItem(SNS_CACHE_KEY);
    }
    
    return snsData;
}

function getCachedSnsData() {
    const cachedString = safeStorage.getItem(SNS_CACHE_KEY);
    if (!cachedString) return null;

    try {
        const { data, timestamp } = JSON.parse(cachedString);
        // Check if cache is still valid and not empty
        if (Date.now() - timestamp < CACHE_DURATION && data && data.length > 0) {
            return data;
        }
        // Clear invalid or empty cache
        safeStorage.removeItem(SNS_CACHE_KEY);
    } catch (error) {
        console.error('Error parsing cached SNS data:', error);
        // Clear invalid cache
        safeStorage.removeItem(SNS_CACHE_KEY);
    }
    return null;
}

function cacheSnsData(data) {
    try {
        const cacheObject = {
            data,
            timestamp: Date.now()
        };
        safeStorage.setItem(SNS_CACHE_KEY, JSON.stringify(cacheObject));
    } catch (error) {
        console.error('Error caching SNS data:', error);
    }
}

export function getSnsById(rootCanisterId) {
    const cachedData = getCachedSnsData();
    return cachedData?.find(sns => sns.rootCanisterId === rootCanisterId);
}

export function getAllSnses() {
    return getCachedSnsData() || [];
}

export function clearSnsCache() {
    console.log('Clearing SNS cache...'); // Debug log
    safeStorage.removeItem(SNS_CACHE_KEY);
}

// Add listener for SNS data updates
export function addSnsUpdateListener(callback) {
    snsUpdateListeners.add(callback);
    return () => snsUpdateListeners.delete(callback);
}

// Notify all listeners of SNS data updates
function notifySnsUpdate(data) {
    snsUpdateListeners.forEach(callback => {
        try {
            callback(data);
        } catch (error) {
            console.error('Error in SNS update listener:', error);
        }
    });
} 