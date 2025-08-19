import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useForum } from '../contexts/ForumContext';
import { 
    getRecentTipsReceived, 
    getRecentTipsCount,
    markTipsSeenUpTo 
} from '../utils/BackendUtils';

/**
 * Custom hook for managing tip notifications
 * 
 * Provides:
 * - newTipCount: Number of new tips since last seen
 * - newTips: Array of new tip objects
 * - markAsViewed: Function to mark tips as seen
 * - refreshNotifications: Function to manually refresh
 * - loading: Loading state
 */
export function useTipNotifications() {
    const { isAuthenticated, identity } = useAuth();
    const { createForumActor } = useForum();
    
    const [newTipCount, setNewTipCount] = useState(0);
    const [newTips, setNewTips] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastChecked, setLastChecked] = useState(null);

    const checkForNewTips = useCallback(async () => {
        if (!isAuthenticated || !identity) {
            setNewTipCount(0);
            setNewTips([]);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const forumActor = createForumActor(identity);
            
            // Use optimized count method for ticker (much faster)
            const tipCount = await getRecentTipsCount(forumActor, identity.getPrincipal());
            
            console.log('Tip notifications debug:', {
                userPrincipal: identity.getPrincipal().toString(),
                newTipsCount: tipCount
            });
            
            // We don't need the full tips array for ticker, just the count
            setNewTips([]); // Clear tips array since we're not fetching them
            setNewTipCount(Number(tipCount));
            setLastChecked(Date.now());
            
            console.log(`Tip notifications: Found ${tipCount} new tips`);
            
        } catch (err) {
            console.error('Error checking for new tips:', err);
            setError(err.message);
            setNewTipCount(0);
            setNewTips([]);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, createForumActor]);

    const markAsViewed = useCallback(async () => {
        if (!isAuthenticated || !identity || newTipCount === 0) {
            return;
        }

        try {
            const forumActor = createForumActor(identity);
            const currentTimestamp = Date.now() * 1_000_000; // Convert to nanoseconds
            
            await markTipsSeenUpTo(forumActor, currentTimestamp);
            
            // Reset notification state
            setNewTipCount(0);
            setNewTips([]);
            setLastChecked(Date.now());
            
            console.log('Tip notifications: Marked tips as viewed up to', new Date());
            
        } catch (err) {
            console.error('Error marking tips as viewed:', err);
            setError(err.message);
        }
    }, [isAuthenticated, identity, createForumActor, newTipCount]);

    const refreshNotifications = useCallback(() => {
        checkForNewTips();
    }, [checkForNewTips]);

    // Check for new tips when component mounts or identity changes
    useEffect(() => {
        checkForNewTips();
    }, [checkForNewTips]);

    // Periodically check for new tips (every 2 minutes)
    useEffect(() => {
        if (!isAuthenticated || !identity) {
            return;
        }

        const interval = setInterval(() => {
            checkForNewTips();
        }, 2 * 60 * 1000); // 2 minutes

        return () => clearInterval(interval);
    }, [isAuthenticated, identity, checkForNewTips]);

    return {
        newTipCount,
        newTips,
        markAsViewed,
        refreshNotifications,
        loading,
        error,
        lastChecked
    };
}
