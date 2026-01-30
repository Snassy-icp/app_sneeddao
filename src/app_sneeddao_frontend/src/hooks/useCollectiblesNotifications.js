import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import { getAllSnses } from '../utils/SnsUtils';
import { PERM } from '../utils/NeuronPermissionUtils';

/**
 * Custom hook for managing collectibles notifications
 * 
 * Checks for collectible items from:
 * 1. RLL rewards (token rewards from Sneed neurons)
 * 2. LP fees (uncollected fees from liquidity positions)
 * 3. Neuron maturity (disbursable maturity from SNS neurons)
 * 
 * Provides:
 * - collectiblesCount: Total number of collectible items
 * - loading: Loading state
 * - refreshCollectibles: Function to manually refresh
 * - lastChecked: Timestamp of last check
 */
export function useCollectiblesNotifications() {
    const { isAuthenticated, identity } = useAuth();
    
    const [collectiblesCount, setCollectiblesCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastChecked, setLastChecked] = useState(null);

    // Helper to check if user has a specific permission on a neuron
    const userHasNeuronPermission = useCallback((neuron, permissionType) => {
        if (!identity || !neuron.permissions) return false;
        const userPrincipal = identity.getPrincipal().toString();
        const userPerms = neuron.permissions.find(p => 
            p.principal?.[0]?.toString() === userPrincipal
        );
        return userPerms?.permission_type?.includes(permissionType) || false;
    }, [identity]);

    const checkForCollectibles = useCallback(async () => {
        if (!isAuthenticated || !identity) {
            setCollectiblesCount(0);
            return;
        }

        try {
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
                                    if (maturity > 0n && userHasNeuronPermission(neuron, PERM.DISBURSE_MATURITY)) {
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
            
            setCollectiblesCount(totalCount);
            setLastChecked(Date.now());
            
            console.log(`Collectibles notifications: ${rewardsCount} rewards, ${feesCount} LP fees, ${maturityCount} maturity = ${totalCount} total`);
            
        } catch (err) {
            console.error('Error checking for collectibles:', err);
            setError(err.message);
            setCollectiblesCount(0);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, userHasNeuronPermission]);

    const refreshCollectibles = useCallback(() => {
        checkForCollectibles();
    }, [checkForCollectibles]);

    // Check for collectibles when component mounts or identity changes
    useEffect(() => {
        checkForCollectibles();
    }, [checkForCollectibles]);

    // Periodically check for collectibles (every 5 minutes)
    useEffect(() => {
        if (!isAuthenticated || !identity) {
            return;
        }

        const interval = setInterval(() => {
            checkForCollectibles();
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
