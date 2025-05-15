import { createActor as createNnsSnsWActor } from 'external/nns_snsw';
import { createActor as createSnsRootActor } from 'external/sns_root';

const SNS_CACHE_KEY = 'sns_data_cache';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

// Helper function to safely get canister ID
function safeGetCanisterId(canisterIdArray) {
    if (Array.isArray(canisterIdArray) && canisterIdArray.length > 0 && canisterIdArray[0]) {
        return canisterIdArray[0].toText();
    }
    return null;
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
        // Call list_deployed_snses with the required empty record argument
        const response = await nnsSnsWActor.list_deployed_snses({});
        console.log('Raw response from list_deployed_snses:', response); // Debug log
        
        // The response should have a "instances" field containing the array of SNS instances
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
                
                const snsRootActor = createSnsRootActor(rootCanisterId, {
                    agentOptions: {
                        identity,
                    },
                });
                
                console.log('Calling list_sns_canisters for', rootCanisterId); // Debug log
                const canisterInfo = await snsRootActor.list_sns_canisters({});
                console.log('Canister info for', rootCanisterId, ':', canisterInfo); // Debug log
                
                // Get metadata safely
                const metadata = sns.metadata?.[0] || {};
                console.log('SNS metadata:', metadata); // Debug log
                const name = metadata.name?.[0] || 'Unknown SNS';
                const description = metadata.description?.[0] || '';
                const logo = metadata.logo?.[0] || '';

                // Get canister IDs safely
                const governanceId = safeGetCanisterId(canisterInfo.governance_canister_id);
                const ledgerId = safeGetCanisterId(canisterInfo.ledger_canister_id);
                const swapId = safeGetCanisterId(canisterInfo.swap_canister_id);

                if (!governanceId || !ledgerId) {
                    console.error('Missing required canister IDs for SNS:', rootCanisterId, {
                        governanceId,
                        ledgerId,
                        swapId
                    });
                    return null;
                }
                
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
                console.error('Error processing SNS:', err);
                return null;
            }
        });

        console.log('Waiting for all SNS processing to complete...'); // Debug log
        const snsData = (await Promise.all(snsDataPromises)).filter(Boolean);
        console.log('Final SNS data:', snsData); // Debug log
        
        // Cache the data
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