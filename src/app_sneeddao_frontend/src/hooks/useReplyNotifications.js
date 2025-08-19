import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useForum } from '../contexts/ForumContext';
import { 
    getRecentRepliesCount,
    markRepliesSeenUpTo
} from '../utils/BackendUtils';

/**
 * Custom hook for managing reply notifications
 * 
 * Provides:
 * - newReplyCount: Number of new replies since last seen
 * - markAsViewed: Function to mark replies as seen
 * - refreshNotifications: Function to manually refresh
 * - loading: Loading state
 */
export function useReplyNotifications() {
    const { isAuthenticated, identity } = useAuth();
    const { createForumActor } = useForum();
    
    const [newReplyCount, setNewReplyCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastChecked, setLastChecked] = useState(null);

    const checkForNewReplies = useCallback(async () => {
        if (!isAuthenticated || !identity) {
            setNewReplyCount(0);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const forumActor = createForumActor(identity);
            
            // Use optimized count method for ticker (much faster)
            const replyCount = await getRecentRepliesCount(forumActor, identity.getPrincipal());
            
            console.log('Reply notifications debug:', {
                userPrincipal: identity.getPrincipal().toString(),
                newRepliesCount: replyCount
            });
            
            setNewReplyCount(Number(replyCount));
            setLastChecked(Date.now());
            
            console.log(`Reply notifications: Found ${replyCount} new replies`);
            
        } catch (err) {
            console.error('Error checking for new replies:', err);
            setError(err.message);
            setNewReplyCount(0);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, createForumActor]);

    const markAsViewed = useCallback(async () => {
        if (!isAuthenticated || !identity || newReplyCount === 0) {
            return;
        }

        try {
            const forumActor = createForumActor(identity);
            const currentTimestamp = Date.now() * 1_000_000; // Convert to nanoseconds
            
            await markRepliesSeenUpTo(forumActor, currentTimestamp);
            
            // Reset notification state
            setNewReplyCount(0);
            setLastChecked(Date.now());
            
            console.log('Reply notifications: Marked replies as viewed up to', new Date());
            
        } catch (err) {
            console.error('Error marking replies as viewed:', err);
            setError(err.message);
        }
    }, [isAuthenticated, identity, createForumActor, newReplyCount]);

    const refreshNotifications = useCallback(() => {
        checkForNewReplies();
    }, [checkForNewReplies]);

    // Check for new replies when component mounts or identity changes
    useEffect(() => {
        checkForNewReplies();
    }, [checkForNewReplies]);

    // Periodically check for new replies (every 2 minutes)
    useEffect(() => {
        if (!isAuthenticated || !identity) {
            return;
        }

        const interval = setInterval(() => {
            checkForNewReplies();
        }, 2 * 60 * 1000); // 2 minutes

        return () => clearInterval(interval);
    }, [isAuthenticated, identity, checkForNewReplies]);

    return {
        newReplyCount,
        markAsViewed,
        refreshNotifications,
        loading,
        error,
        lastChecked
    };
}
