import { createActor as createNnsSnsWActor } from 'external/nns_snsw';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
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
                    // Create governance actor to get metadata
                    const governanceActor = createSnsGovernanceActor(governanceId, {
                        agentOptions: {
                            identity,
                        },
                    });

                    // Get metadata from governance canister
                    const metadataResponse = await governanceActor.get_metadata({});
                    console.log('Metadata response:', metadataResponse); // Debug log

                    const metadata = metadataResponse?.metadata?.[0] || {};
                    const name = metadata.name || rootCanisterId;
                    const description = metadata.description || '';
                    const url = metadata.url || '';
                    const logo = metadata.logo || '';
                    
                    const snsData = {
                        rootCanisterId,
                        name,
                        description,
                        url,
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