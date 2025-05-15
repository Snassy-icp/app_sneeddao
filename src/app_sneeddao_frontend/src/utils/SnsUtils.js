import { createActor as createNnsSnsWActor } from 'external/nns_snsw';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { Principal } from '@dfinity/principal';

const SNS_CACHE_KEY = 'sns_data_cache';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

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

export async function fetchAndCacheSnsData(identity) {
    console.log('Starting fetchAndCacheSnsData...'); // Debug log
    
    // Check cache first
    const cachedData = getCachedSnsData();
    if (cachedData && cachedData.length > 0) {
        console.log('Returning cached SNS data:', cachedData); // Debug log
        return cachedData;
    }

    try {
        console.log('Creating NNS SNS Wrapper actor...'); // Debug log
        // Fetch deployed SNSes
        const nnsSnsWActor = createNnsSnsWActor('qaa6y-5yaaa-aaaaa-aaafa-cai', {
            agentOptions: {
                identity,
            },
        });

        console.log('Calling list_deployed_snses...'); // Debug log
        const response = await nnsSnsWActor.list_deployed_snses({});
        console.log('Raw response from list_deployed_snses:', response); // Debug log
        
        const deployedSnses = response?.instances || [];
        console.log('Deployed SNSes:', deployedSnses); // Debug log
        
        if (!deployedSnses.length) {
            console.log('No SNS instances found'); // Debug log
            return [];
        }

        console.log(`Processing ${deployedSnses.length} SNS instances...`); // Debug log

        // Fetch canister info for each SNS
        const snsDataPromises = deployedSnses.map(async (sns) => {
            try {
                console.log('Processing SNS:', sns); // Debug log
                const rootCanisterId = safeGetCanisterId(sns.root_canister_id);
                if (!rootCanisterId) {
                    console.error('Invalid root canister ID for SNS:', sns);
                    return null;
                }
                
                console.log('Processing SNS with root canister:', rootCanisterId); // Debug log
                
                try {
                    const snsRootActor = createSnsRootActor(rootCanisterId, {
                        agentOptions: {
                            identity,
                        },
                    });
                    
                    console.log('Calling list_sns_canisters for', rootCanisterId); // Debug log
                    const canisterInfo = await snsRootActor.list_sns_canisters({});
                    console.log('Canister info for', rootCanisterId, ':', canisterInfo); // Debug log

                    // Get canister IDs safely - updated property names to match response structure
                    const governanceId = safeGetCanisterId(canisterInfo.governance);
                    const ledgerId = safeGetCanisterId(canisterInfo.ledger);
                    const swapId = safeGetCanisterId(canisterInfo.swap);

                    if (!governanceId || !ledgerId) {
                        console.error('Missing required canister IDs for SNS:', rootCanisterId, {
                            governanceId,
                            ledgerId,
                            swapId
                        });
                        return null;
                    }

                    // Get metadata safely
                    const metadata = sns.metadata?.[0] || {};
                    console.log('SNS metadata:', metadata); // Debug log
                    const name = metadata.name?.[0] || rootCanisterId;
                    const description = metadata.description?.[0] || '';
                    const logo = metadata.logo?.[0] || '';
                    
                    const snsData = {
                        rootCanisterId,
                        name,
                        description,
                        logo,
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
                        console.log(`Skipping uninstalled SNS ${rootCanisterId}`);
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
            localStorage.removeItem(SNS_CACHE_KEY);
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
}

function getCachedSnsData() {
    const cachedString = localStorage.getItem(SNS_CACHE_KEY);
    if (!cachedString) return null;

    try {
        const { data, timestamp } = JSON.parse(cachedString);
        // Check if cache is still valid and not empty
        if (Date.now() - timestamp < CACHE_DURATION && data && data.length > 0) {
            return data;
        }
        // Clear invalid or empty cache
        localStorage.removeItem(SNS_CACHE_KEY);
    } catch (error) {
        console.error('Error parsing cached SNS data:', error);
        // Clear invalid cache
        localStorage.removeItem(SNS_CACHE_KEY);
    }
    return null;
}

function cacheSnsData(data) {
    try {
        const cacheObject = {
            data,
            timestamp: Date.now()
        };
        localStorage.setItem(SNS_CACHE_KEY, JSON.stringify(cacheObject));
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