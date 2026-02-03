import { createActor as createNnsSnsWActor } from 'external/nns_snsw';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';
import { getLogo, setLogo, getLogoSync, hasLogo, clearLogoCache as clearUnifiedLogoCache } from '../hooks/useLogoCache';

const SNS_CACHE_KEY = 'sns_data_cache';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

// Memory fallback when localStorage fails
let memoryCache = null;

// Prevents multiple simultaneous foreground fetches (race condition fix)
let foregroundFetchPromise = null;

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

// Fetch SNS logo - uses unified logo cache
export async function fetchSnsLogo(governanceId, agent) {
    // Check unified logo cache first (fast, in-memory)
    if (hasLogo(governanceId)) {
        return getLogoSync(governanceId);
    }

    try {
        const governanceActor = createSnsGovernanceActor(governanceId, { agent });
        const metadataResponse = await governanceActor.get_metadata({});
        const logo = metadataResponse?.logo?.[0] || '';
        
        // Store in unified logo cache (persists in IndexedDB)
        if (logo) {
            await setLogo(governanceId, logo);
        }
        return logo;
    } catch (error) {
        console.error(`Error fetching logo for SNS ${governanceId}:`, error);
        return '';
    }
}

// Get SNS logo synchronously (returns null if not cached)
export function getSnsLogoSync(governanceId) {
    return getLogoSync(governanceId);
}

// Clear logo cache (useful when debugging)
export function clearLogoCache() {
    clearUnifiedLogoCache();
}

export async function fetchAndCacheSnsData(identity) {
    console.log('Starting fetchAndCacheSnsData...'); // Debug log
    
    // Check cache first
    const cachedData = getCachedSnsData();
    if (cachedData && cachedData.length > 0) {
        console.log('Returning cached SNS data:', cachedData); // Debug log
        return cachedData;
    }

    // Prevent multiple simultaneous foreground fetches (race condition fix)
    if (foregroundFetchPromise) {
        console.log('Reusing existing foreground fetch promise'); // Debug log
        return foregroundFetchPromise;
    }

    foregroundFetchPromise = (async () => {
    try {
        console.log('Creating NNS SNS Wrapper actor...'); // Debug log
        
        // Create an agent with proper host configuration
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
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

        // Fetch deployed SNSes
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

                    // Extract only essential metadata
                    const name = metadataResponse?.name?.[0] || `SNS ${rootCanisterId.slice(0, 8)}...`;
                    const logo = metadataResponse?.logo?.[0] || '';
                    const symbol = metadataResponse?.symbol?.[0] || '';
                    
                    // Cache logo separately in unified logo cache (don't store in SNS data)
                    if (logo) {
                        // Cache by governance ID (for SNS logo lookups)
                        setLogo(governanceId, logo);
                        // Also cache by root canister ID (alternative lookup)
                        setLogo(rootCanisterId, logo);
                    }
                    
                    // Store only essential data (NO logo - it's in unified logo cache)
                    const snsData = {
                        rootCanisterId,
                        name,
                        // logo removed - use getSnsLogoSync(governanceId) or getLogoSync(governanceId)
                        token_symbol: symbol,
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
    } catch (error) {
        console.error('Error fetching SNS data:', error);
        // Only return cached data if it exists and is not empty
        if (cachedData && cachedData.length > 0) {
            return cachedData;
        }
        return [];
    }
    })();

    // Clear the promise when done (success or failure)
    foregroundFetchPromise.finally(() => {
        foregroundFetchPromise = null;
    });

    return foregroundFetchPromise;
}

function getCachedSnsData() {
    const cachedString = safeStorage.getItem(SNS_CACHE_KEY);
    if (!cachedString) return null;

    try {
        const { data, timestamp } = JSON.parse(cachedString);
        // Check if cache is still valid and not empty
        if (Date.now() - timestamp < CACHE_DURATION && data && data.length > 0) {
            // Note: logos are stored separately in the unified logo cache (IndexedDB)
            // so we don't check for logo field here - use getLogoSync() to get logos
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

// Add a single SNS to the cache (used by fetchSingleSnsData)
function addSnsToCache(snsData) {
    try {
        const cachedString = safeStorage.getItem(SNS_CACHE_KEY);
        let existingData = [];
        let timestamp = Date.now();
        
        if (cachedString) {
            try {
                const parsed = JSON.parse(cachedString);
                existingData = parsed.data || [];
                // Preserve original timestamp if cache exists
                timestamp = parsed.timestamp || timestamp;
            } catch (e) {
                // Invalid cache, start fresh
            }
        }
        
        // Check if this SNS already exists in cache
        const existingIndex = existingData.findIndex(sns => sns.rootCanisterId === snsData.rootCanisterId);
        
        if (existingIndex >= 0) {
            // Update existing entry
            existingData[existingIndex] = snsData;
        } else {
            // Add new entry
            existingData.push(snsData);
        }
        
        const cacheObject = {
            data: existingData,
            timestamp
        };
        safeStorage.setItem(SNS_CACHE_KEY, JSON.stringify(cacheObject));
        console.log(`Added/updated SNS ${snsData.rootCanisterId} in cache`);
    } catch (error) {
        console.error('Error adding SNS to cache:', error);
    }
}

export function getSnsById(rootCanisterId) {
    const cachedData = getCachedSnsData();
    const sns = cachedData?.find(sns => sns.rootCanisterId === rootCanisterId);
    if (sns) {
        // Add logo from unified logo cache for backwards compatibility
        const logo = getLogoSync(rootCanisterId) || getLogoSync(sns.canisters?.governance);
        return { ...sns, logo };
    }
    return sns;
}

export function getSnsByLedgerId(ledgerCanisterId) {
    const cachedData = getCachedSnsData();
    const sns = cachedData?.find(sns => sns.canisters?.ledger === ledgerCanisterId);
    if (sns) {
        // Add logo from unified logo cache for backwards compatibility
        const logo = getLogoSync(sns.rootCanisterId) || getLogoSync(sns.canisters?.governance);
        return { ...sns, logo };
    }
    return sns;
}

export function getAllSnses() {
    const cachedData = getCachedSnsData() || [];
    // Add logos from unified logo cache for backwards compatibility
    return cachedData.map(sns => ({
        ...sns,
        logo: getLogoSync(sns.rootCanisterId) || getLogoSync(sns.canisters?.governance) || ''
    }));
}

// New function to fetch a single SNS data immediately
export async function fetchSingleSnsData(rootCanisterId, identity) {
    console.log(`Fetching single SNS data for: ${rootCanisterId}`); // Debug log
    
    // Check if this SNS is already in cache
    const cachedData = getCachedSnsData();
    const existingSnS = cachedData?.find(sns => sns.rootCanisterId === rootCanisterId);
    if (existingSnS) {
        console.log('Found SNS in cache:', existingSnS); // Debug log
        return existingSnS;
    }

    try {
        // Create an agent with proper host configuration
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
        const agentConfig = {
            host,
            ...(identity && { identity })
        };
        const agent = new HttpAgent(agentConfig);

        if (process.env.DFX_NETWORK !== 'ic') {
            await agent.fetchRootKey().catch(err => 
                console.warn('Root key fetch failed:', err)
            );
        }

        // Get the SNS details from SNS-W first to get governance canister ID
        const nnsSnsWActor = createNnsSnsWActor('qaa6y-5yaaa-aaaaa-aaafa-cai', { agent });
        const response = await nnsSnsWActor.list_deployed_snses({});
        const deployedSnses = response?.instances || [];
        
        // Find the SNS with matching root canister
        const targetSns = deployedSnses.find(sns => {
            const snsRootId = safeGetCanisterId(sns.root_canister_id);
            return snsRootId === rootCanisterId;
        });

        if (!targetSns) {
            throw new Error(`SNS with root canister ${rootCanisterId} not found`);
        }

        // Extract canister IDs
        const governanceId = safeGetCanisterId(targetSns.governance_canister_id);
        const ledgerId = safeGetCanisterId(targetSns.ledger_canister_id);
        const swapId = safeGetCanisterId(targetSns.swap_canister_id);

        if (!governanceId || !ledgerId) {
            throw new Error('Missing required canister IDs for SNS');
        }

        // Get metadata from governance canister
        const governanceActor = createSnsGovernanceActor(governanceId, { agent });
        const metadataResponse = await governanceActor.get_metadata({});
        
        // Extract essential metadata
        const name = metadataResponse?.name?.[0] || `SNS ${rootCanisterId.slice(0, 8)}...`;
        const logo = metadataResponse?.logo?.[0] || '';
        const symbol = metadataResponse?.symbol?.[0] || '';
        
        // Cache logo in unified logo cache (don't store in SNS data)
        if (logo) {
            setLogo(governanceId, logo);
            setLogo(rootCanisterId, logo);
        }
        
        const snsData = {
            rootCanisterId,
            name,
            // logo removed - use getLogoSync(governanceId)
            token_symbol: symbol,
            canisters: {
                governance: governanceId,
                ledger: ledgerId,
                root: rootCanisterId,
                swap: swapId
            }
        };
        
        // Add this SNS to the main cache so we don't have to fetch it again
        addSnsToCache(snsData);
        
        return snsData;
    } catch (error) {
        console.error(`Error fetching single SNS data for ${rootCanisterId}:`, error);
        throw error;
    }
}

// Enhanced function to fetch all SNSes with optional background mode
export async function fetchAndCacheSnsDataOptimized(identity, options = {}) {
    const { backgroundMode = false, onProgress } = options;
    
    console.log(`Starting fetchAndCacheSnsDataOptimized (background: ${backgroundMode})...`); // Debug log
    
    // In background mode, we always fetch fresh data
    // In foreground mode, check cache first
    if (!backgroundMode) {
        const cachedData = getCachedSnsData();
        if (cachedData && cachedData.length > 0) {
            console.log('Returning cached SNS data:', cachedData); // Debug log
            return cachedData;
        }
    }

    try {
        console.log('Creating NNS SNS Wrapper actor...'); // Debug log
        
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
        const agentConfig = {
            host,
            ...(identity && { identity })
        };
        const agent = new HttpAgent(agentConfig);

        if (process.env.DFX_NETWORK !== 'ic') {
            await agent.fetchRootKey().catch(err => 
                console.warn('Root key fetch failed:', err)
            );
        }

        // Fetch deployed SNSes
        const nnsSnsWActor = createNnsSnsWActor('qaa6y-5yaaa-aaaaa-aaafa-cai', { agent });
        const response = await nnsSnsWActor.list_deployed_snses({});
        const deployedSnses = response?.instances || [];
        
        if (!deployedSnses.length) {
            console.log('No SNS instances found'); // Debug log
            return [];
        }

        console.log(`Processing ${deployedSnses.length} SNS instances...`); // Debug log

        // Process each SNS instance
        const snsDataPromises = deployedSnses.map(async (sns, index) => {
            try {
                // Report progress if callback provided
                if (onProgress) {
                    onProgress(index + 1, deployedSnses.length);
                }

                const rootCanisterId = safeGetCanisterId(sns.root_canister_id);
                const governanceId = safeGetCanisterId(sns.governance_canister_id);
                const ledgerId = safeGetCanisterId(sns.ledger_canister_id);
                const swapId = safeGetCanisterId(sns.swap_canister_id);

                if (!rootCanisterId || !governanceId || !ledgerId) {
                    console.error('Missing required canister IDs for SNS:', {
                        rootCanisterId, governanceId, ledgerId, swapId
                    });
                    return null;
                }

                const governanceActor = createSnsGovernanceActor(governanceId, { agent });
                const metadataResponse = await governanceActor.get_metadata({});
                const name = metadataResponse?.name?.[0] || `SNS ${rootCanisterId.slice(0, 8)}...`;
                const logo = metadataResponse?.logo?.[0] || '';
                const symbol = metadataResponse?.symbol?.[0] || '';
                
                // Cache logo in unified logo cache
                if (logo) {
                    setLogo(governanceId, logo);
                    setLogo(rootCanisterId, logo);
                }
                
                const snsData = {
                    rootCanisterId,
                    name,
                    // logo removed - use getLogoSync(governanceId)
                    token_symbol: symbol,
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
                    console.log(`Skipping uninstalled SNS ${safeGetCanisterId(sns.governance_canister_id)}`);
                    return null;
                }
                console.error('Error processing SNS:', err);
                return null;
            }
        });

        const snsData = (await Promise.all(snsDataPromises)).filter(Boolean);
        console.log('Final SNS data:', snsData); // Debug log
        
        // Cache the data only if we have valid results
        if (snsData.length > 0) {
            console.log('Caching SNS data...'); // Debug log
            cacheSnsData(snsData);
        } else {
            console.log('No valid SNS data to cache'); // Debug log
            safeStorage.removeItem(SNS_CACHE_KEY);
        }
        
        return snsData;
    } catch (error) {
        console.error('Error fetching SNS data:', error);
        if (!backgroundMode) {
            // Only return cached data if it exists and is not empty
            const cachedData = getCachedSnsData();
            if (cachedData && cachedData.length > 0) {
                return cachedData;
            }
        }
        return [];
    }
}

// Background task manager
let backgroundFetchPromise = null;

export function startBackgroundSnsFetch(identity, onComplete) {
    // Prevent multiple simultaneous background fetches
    if (backgroundFetchPromise) {
        return backgroundFetchPromise;
    }

    console.log('Starting background SNS fetch...'); // Debug log
    
    backgroundFetchPromise = fetchAndCacheSnsDataOptimized(identity, { 
        backgroundMode: true,
        onProgress: (current, total) => {
            console.log(`Background SNS fetch progress: ${current}/${total}`);
        }
    }).then(result => {
        console.log('Background SNS fetch completed'); // Debug log
        if (onComplete) {
            onComplete(result);
        }
        return result;
    }).catch(error => {
        console.error('Background SNS fetch failed:', error);
        return [];
    }).finally(() => {
        backgroundFetchPromise = null;
    });

    return backgroundFetchPromise;
}

export function clearSnsCache() {
    console.log('Clearing SNS cache...'); // Debug log
    safeStorage.removeItem(SNS_CACHE_KEY);
} 