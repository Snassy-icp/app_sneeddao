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

    // Refresh every 5 minutes to catch new proposals
    useEffect(() => {
        const intervalMs = 5 * 60 * 1000; // 5 minutes
        const intervalId = setInterval(checkVotableProposals, intervalMs);
        return () => clearInterval(intervalId);
    }, [checkVotableProposals]);

    // Listen for immediate refresh (e.g. after voting on ActiveProposals)
    useEffect(() => {
        const handleRefresh = () => checkVotableProposals();
        window.addEventListener('votableProposalsRefresh', handleRefresh);
        return () => window.removeEventListener('votableProposalsRefresh', handleRefresh);
    }, [checkVotableProposals]);

    return {
        votableCount,
        loading,
        refresh: checkVotableProposals
    };
}
