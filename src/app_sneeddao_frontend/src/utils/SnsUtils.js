import { createActor as createNnsSnsWActor } from 'external/nns_snsw';
import { createActor as createSnsRootActor } from 'external/sns_root';

const SNS_CACHE_KEY = 'sns_data_cache';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

export async function fetchAndCacheSnsData(identity) {
    // Check cache first
    const cachedData = getCachedSnsData();
    if (cachedData) {
        return cachedData;
    }

    try {
        // Fetch deployed SNSes
        const nnsSnsWActor = createNnsSnsWActor('qaa6y-5yaaa-aaaaa-aaafa-cai', {
            agentOptions: {
                identity,
            },
        });

        // Call list_deployed_snses with the required empty record argument
        const deployedSnses = await nnsSnsWActor.list_deployed_snses({});

        // Fetch canister info for each SNS
        const snsDataPromises = deployedSnses.map(async (sns) => {
            const rootCanisterId = sns.root_canister_id[0].toText();
            const snsRootActor = createSnsRootActor(rootCanisterId, {
                agentOptions: {
                    identity,
                },
            });
            
            const canisterInfo = await snsRootActor.list_sns_canisters({});
            
            return {
                rootCanisterId,
                name: sns.metadata?.[0]?.name?.[0] || 'Unknown SNS',
                description: sns.metadata?.[0]?.description?.[0] || '',
                logo: sns.metadata?.[0]?.logo?.[0] || '',
                canisters: {
                    governance: canisterInfo.governance_canister_id[0]?.toText(),
                    ledger: canisterInfo.ledger_canister_id[0]?.toText(),
                    root: rootCanisterId,
                    swap: canisterInfo.swap_canister_id[0]?.toText()
                }
            };
        });

        const snsData = await Promise.all(snsDataPromises);
        
        // Cache the data
        cacheSnsData(snsData);
        
        return snsData;
    } catch (error) {
        console.error('Error fetching SNS data:', error);
        // If there's cached data, return it even if expired
        return cachedData || [];
    }
}

function getCachedSnsData() {
    const cachedString = localStorage.getItem(SNS_CACHE_KEY);
    if (!cachedString) return null;

    try {
        const { data, timestamp } = JSON.parse(cachedString);
        // Check if cache is still valid
        if (Date.now() - timestamp < CACHE_DURATION) {
            return data;
        }
    } catch (error) {
        console.error('Error parsing cached SNS data:', error);
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