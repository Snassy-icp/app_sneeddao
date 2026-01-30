import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import { getAllSnses } from '../utils/SnsUtils';
import { PERM } from '../utils/NeuronPermissionUtils';

// Module-level cache to persist across navigation/remounts
let cachedResult = {
    count: 0,
    principalId: null,
    lastChecked: null
};

// Minimum time between fetches (30 seconds) to prevent rapid re-fetching
const MIN_FETCH_INTERVAL = 30 * 1000;

/**
 * Custom hook for managing collectibles notifications
 * 
 * Checks for collectible items from:
 * 1. RLL rewards (token rewards from Sneed neurons)
 * 2. LP fees (uncollected fees from liquidity positions)
 * 3. Neuron maturity (disbursable maturity from SNS neurons)
 * 
 * Results are cached at module level to prevent re-fetching on navigation.
 * 
 * Provides:
 * - collectiblesCount: Total number of collectible items
 * - loading: Loading state
 * - refreshCollectibles: Function to manually refresh (force=true bypasses cache)
 * - lastChecked: Timestamp of last check
 */
export function useCollectiblesNotifications() {
    const { isAuthenticated, identity } = useAuth();
    
    const [collectiblesCount, setCollectiblesCount] = useState(cachedResult.count);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastChecked, setLastChecked] = useState(cachedResult.lastChecked);
    
    // Track if we're currently fetching to prevent duplicate fetches
    const isFetching = useRef(false);
    // Track the principal we last fetched for
    const lastFetchedPrincipal = useRef(cachedResult.principalId);

    // Helper to check if user has a specific permission on a neuron
    const userHasNeuronPermission = useCallback((neuron, permissionType, userPrincipal) => {
        if (!userPrincipal || !neuron.permissions) return false;
        const userPerms = neuron.permissions.find(p => 
            p.principal?.[0]?.toString() === userPrincipal
        );
        return userPerms?.permission_type?.includes(permissionType) || false;
    }, []);

    const checkForCollectibles = useCallback(async (force = false) => {
        if (!isAuthenticated || !identity) {
            setCollectiblesCount(0);
            cachedResult = { count: 0, principalId: null, lastChecked: null };
            return;
        }

        const currentPrincipal = identity.getPrincipal().toString();
        const now = Date.now();
        
        // Check if we should skip this fetch (use cache)
        if (!force) {
            const principalChanged = currentPrincipal !== cachedResult.principalId;
            const timeSinceLastFetch = cachedResult.lastChecked ? (now - cachedResult.lastChecked) : Infinity;
            
            // If same principal and fetched recently, use cached result
            if (!principalChanged && timeSinceLastFetch < MIN_FETCH_INTERVAL) {
                console.log('Collectibles: Using cached result (fetched', Math.round(timeSinceLastFetch / 1000), 'seconds ago)');
                setCollectiblesCount(cachedResult.count);
                setLastChecked(cachedResult.lastChecked);
                return;
            }
        }
        
        // Prevent concurrent fetches
        if (isFetching.current) {
            console.log('Collectibles: Fetch already in progress, skipping');
            return;
        }

        try {
            isFetching.current = true;
            setLoading(true);
            setError(null);

            let totalCount = 0;

            // Run all checks in parallel for speed
            const [rewardsCount, feesCount, maturityCount] = await Promise.all([
                // 1. Check RLL rewards
                (async () => {
                    try {
                        const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                        const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
                        const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
                        const arr_balances = await rllActor.balances_of_hotkey_neurons(neurons);
                        
                        let count = 0;
                        for (const balance of arr_balances) {
                            if (BigInt(balance[1]) > 0n) {
                                count++;
                            }
                        }
                        return count;
                    } catch (err) {
                        console.error('Error checking rewards:', err);
                        return 0;
                    }
                })(),

                // 2. Check LP fees
                (async () => {
                    try {
                        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
                        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
                        
                        const swap_canisters = await backendActor.get_swap_canister_ids();
                        const claimed_positions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
                        
                        // Build map of claimed positions by swap canister
                        const claimed_positions_by_swap = {};
                        for (const claimed_position of claimed_positions) {
                            if (!claimed_positions_by_swap[claimed_position.swap_canister_id]) {
                                claimed_positions_by_swap[claimed_position.swap_canister_id] = [];
                            }
                            claimed_positions_by_swap[claimed_position.swap_canister_id].push(claimed_position);
                        }

                        // Check each swap canister for positions with fees
                        const feeCounts = await Promise.all(swap_canisters.map(async (swap_canister) => {
                            try {
                                const claimed_positions_for_swap = claimed_positions_by_swap[swap_canister] || [];
                                const claimed_position_ids_for_swap = claimed_positions_for_swap.map(cp => cp.position_id);
                                
                                const swapActor = createIcpSwapActor(swap_canister);
                                const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok || [];
                                
                                // Get all user positions (direct + claimed)
                                let offset = 0;
                                const limit = 10;
                                let positionsWithFees = 0;
                                let hasMorePositions = true;
                                
                                while (hasMorePositions) {
                                    const allPositions = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok?.content || [];
                                    
                                    for (const position of allPositions) {
                                        if (userPositionIds.includes(position.id) || claimed_position_ids_for_swap.includes(position.id)) {
                                            if (position.tokensOwed0 > 0n || position.tokensOwed1 > 0n) {
                                                positionsWithFees++;
                                            }
                                        }
                                    }
                                    
                                    offset += limit;
                                    hasMorePositions = allPositions.length === limit;
                                }
                                
                                return positionsWithFees;
                            } catch (err) {
                                console.error(`Error checking fees for swap ${swap_canister}:`, err);
                                return 0;
                            }
                        }));
                        
                        return feeCounts.reduce((sum, count) => sum + count, 0);
                    } catch (err) {
                        console.error('Error checking LP fees:', err);
                        return 0;
                    }
                })(),

                // 3. Check neuron maturity
                (async () => {
                    try {
                        const snsList = getAllSnses();
                        if (!snsList || snsList.length === 0) {
                            return 0;
                        }

                        // Check each SNS for neurons with disbursable maturity
                        const maturityCounts = await Promise.all(snsList.map(async (sns) => {
                            try {
                                const governanceId = sns.governance_canister_id;
                                if (!governanceId) return 0;
                                
                                const neurons = await fetchUserNeuronsForSns(identity, governanceId);
                                
                                let count = 0;
                                for (const neuron of neurons) {
                                    const maturity = BigInt(neuron.maturity_e8s_equivalent || 0n);
                                    if (maturity > 0n && userHasNeuronPermission(neuron, PERM.DISBURSE_MATURITY, currentPrincipal)) {
                                        count++;
                                    }
                                }
                                return count;
                            } catch (err) {
                                console.error(`Error checking maturity for SNS ${sns.name}:`, err);
                                return 0;
                            }
                        }));
                        
                        return maturityCounts.reduce((sum, count) => sum + count, 0);
                    } catch (err) {
                        console.error('Error checking neuron maturity:', err);
                        return 0;
                    }
                })()
            ]);

            totalCount = rewardsCount + feesCount + maturityCount;
            
            // Update module-level cache
            cachedResult = {
                count: totalCount,
                principalId: currentPrincipal,
                lastChecked: now
            };
            lastFetchedPrincipal.current = currentPrincipal;
            
            setCollectiblesCount(totalCount);
            setLastChecked(now);
            
            console.log(`Collectibles notifications: ${rewardsCount} rewards, ${feesCount} LP fees, ${maturityCount} maturity = ${totalCount} total`);
            
        } catch (err) {
            console.error('Error checking for collectibles:', err);
            setError(err.message);
            setCollectiblesCount(0);
        } finally {
            setLoading(false);
            isFetching.current = false;
        }
    }, [isAuthenticated, identity, userHasNeuronPermission]);

    // Force refresh function (bypasses cache)
    const refreshCollectibles = useCallback(() => {
        checkForCollectibles(true);
    }, [checkForCollectibles]);

    // Initial check - only fetch if cache is stale or principal changed
    useEffect(() => {
        if (!isAuthenticated || !identity) {
            setCollectiblesCount(0);
            return;
        }
        
        const currentPrincipal = identity.getPrincipal().toString();
        
        // If we have a cached result for this principal, use it immediately
        if (cachedResult.principalId === currentPrincipal && cachedResult.lastChecked) {
            setCollectiblesCount(cachedResult.count);
            setLastChecked(cachedResult.lastChecked);
        }
        
        // Check if we need to fetch (will use cache if recent enough)
        checkForCollectibles(false);
    }, [isAuthenticated, identity, checkForCollectibles]);

    // Periodically check for collectibles (every 5 minutes)
    useEffect(() => {
        if (!isAuthenticated || !identity) {
            return;
        }

        const interval = setInterval(() => {
            checkForCollectibles(true); // Force refresh on interval
        }, 5 * 60 * 1000); // 5 minutes

        return () => clearInterval(interval);
    }, [isAuthenticated, identity, checkForCollectibles]);

    return {
        collectiblesCount,
        refreshCollectibles,
        loading,
        error,
        lastChecked
    };
}

// Export function to clear cache (useful for testing or after collecting)
export function clearCollectiblesCache() {
    cachedResult = { count: 0, principalId: null, lastChecked: null };
}
