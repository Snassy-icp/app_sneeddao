import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';

/**
 * Custom hook for managing collectibles notifications
 * 
 * Checks for collectible rewards from the RLL canister (same as Wallet's "Collect All" feature)
 * 
 * Provides:
 * - collectiblesCount: Number of different token rewards available to collect
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

    const checkForCollectibles = useCallback(async () => {
        if (!isAuthenticated || !identity) {
            setCollectiblesCount(0);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            // Fetch rewards from RLL canister (same logic as Wallet.jsx fetchRewardDetails)
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            
            // Get neurons using the common utility function with Sneed governance canister
            const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
            const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
            
            // Get rewards using the query method
            const arr_balances = await rllActor.balances_of_hotkey_neurons(neurons);

            // Count how many different tokens have rewards > 0
            let rewardsCount = 0;
            for (const balance of arr_balances) {
                const amount = BigInt(balance[1]);
                if (amount > 0n) {
                    rewardsCount++;
                }
            }

            setCollectiblesCount(rewardsCount);
            setLastChecked(Date.now());
            
            console.log(`Collectibles notifications: Found ${rewardsCount} tokens with rewards to collect`);
            
        } catch (err) {
            console.error('Error checking for collectibles:', err);
            setError(err.message);
            setCollectiblesCount(0);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity]);

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
