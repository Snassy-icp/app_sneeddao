import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { createActor as createSmsActor } from '../../../declarations/sneed_sms';
import { 
    getRecentMessagesCount,
    markMessagesSeenUpTo
} from '../utils/BackendUtils';

/**
 * Custom hook for managing SMS notifications
 * 
 * Provides:
 * - newMessageCount: Number of new messages since last seen
 * - markAsViewed: Function to mark messages as seen
 * - refreshNotifications: Function to manually refresh
 * - loading: Loading state
 */
export function useSmsNotifications() {
    const { isAuthenticated, identity } = useAuth();
    
    const [newMessageCount, setNewMessageCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastChecked, setLastChecked] = useState(null);

    // Separate actor creation for notifications - doesn't interfere with main SMS components
    const createNotificationSmsActor = useCallback((identity) => {
        try {
            const canisterId = process.env.CANISTER_ID_SNEED_SMS || 'v33jy-4qaaa-aaaad-absna-cai';
            const actor = createSmsActor(canisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                    identity: identity || undefined,
                },
            });

            return actor;
        } catch (err) {
            console.error('Error creating notification SMS actor:', err);
            return null;
        }
    }, []);

    const checkForNewMessages = useCallback(async () => {
        if (!isAuthenticated || !identity) {
            setNewMessageCount(0);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const smsActor = createNotificationSmsActor(identity);
            if (!smsActor) {
                throw new Error('Failed to create SMS actor');
            }
            
            // Use optimized count method for ticker (much faster)
            const messageCount = await getRecentMessagesCount(smsActor, identity.getPrincipal());
            
            console.log('SMS notifications debug:', {
                userPrincipal: identity.getPrincipal().toString(),
                newMessagesCount: messageCount
            });
            
            setNewMessageCount(Number(messageCount));
            setLastChecked(Date.now());
            
            console.log(`SMS notifications: Found ${messageCount} new messages`);
            
        } catch (err) {
            console.error('Error checking for new messages:', err);
            setError(err.message);
            setNewMessageCount(0);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, createNotificationSmsActor]);

    const markAsViewed = useCallback(async () => {
        if (!isAuthenticated || !identity || newMessageCount === 0) {
            return;
        }

        try {
            const smsActor = createNotificationSmsActor(identity);
            if (!smsActor) {
                throw new Error('Failed to create SMS actor');
            }

            const currentTimestamp = Date.now() * 1_000_000; // Convert to nanoseconds
            
            await markMessagesSeenUpTo(smsActor, currentTimestamp);
            
            // Reset notification state
            setNewMessageCount(0);
            setLastChecked(Date.now());
            
            console.log('SMS notifications: Marked messages as viewed up to', new Date());
            
        } catch (err) {
            console.error('Error marking messages as viewed:', err);
            setError(err.message);
        }
    }, [isAuthenticated, identity, createNotificationSmsActor, newMessageCount]);

    const refreshNotifications = useCallback(() => {
        checkForNewMessages();
    }, [checkForNewMessages]);

    // Check for new messages when component mounts or identity changes
    useEffect(() => {
        checkForNewMessages();
    }, [checkForNewMessages]);

    // Periodically check for new messages (every 2 minutes)
    useEffect(() => {
        if (!isAuthenticated || !identity) {
            return;
        }

        const interval = setInterval(() => {
            checkForNewMessages();
        }, 2 * 60 * 1000); // 2 minutes

        return () => clearInterval(interval);
    }, [isAuthenticated, identity, checkForNewMessages]);

    return {
        newMessageCount,
        markAsViewed,
        refreshNotifications,
        loading,
        error,
        lastChecked
    };
}
