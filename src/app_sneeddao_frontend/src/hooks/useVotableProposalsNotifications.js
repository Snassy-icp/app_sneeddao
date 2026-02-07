import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { fetchVotableProposalsCount } from '../utils/VotableProposalsUtils';

/**
 * Hook for votable proposals notification count.
 * Returns the number of active proposals the user can vote on but hasn't voted on yet.
 * Used in the Header notifications bar.
 */
export function useVotableProposalsNotifications() {
    const { isAuthenticated, identity } = useAuth();
    const walletContext = useWalletOptional();
    const neuronCache = walletContext?.neuronCache;
    
    const [votableCount, setVotableCount] = useState(0);
    const [loading, setLoading] = useState(false);

    const checkVotableProposals = useCallback(async () => {
        if (!isAuthenticated || !identity || !neuronCache || neuronCache.size === 0) {
            setVotableCount(0);
            return;
        }

        try {
            setLoading(true);
            const { count } = await fetchVotableProposalsCount(identity, neuronCache, false);
            setVotableCount(count);
        } catch (err) {
            console.warn('Error fetching votable proposals count:', err);
            setVotableCount(0);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, neuronCache]);

    useEffect(() => {
        checkVotableProposals();
    }, [checkVotableProposals]);

    return {
        votableCount,
        loading,
        refresh: checkVotableProposals
    };
}
