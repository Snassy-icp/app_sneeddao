import { useCallback } from 'react';
import { useSmsInbox } from '../contexts/SmsContext';

/**
 * Unread Sneed SMS messages for the header, from the shared inbox (contexts/SmsContext.jsx): the
 * same cached, incrementally polled data the Messages page shows, so no calls of its own.
 *
 * Provides:
 * - newMessageCount: received messages newer than the last-seen mark
 * - markAsViewed: marks everything received so far as seen
 * - refreshNotifications: syncs the inbox now
 * - loading, error, lastChecked
 */
export function useSmsNotifications() {
    const sms = useSmsInbox();
    const markSeen = sms?.markSeen;
    const newest = sms?.received?.items?.[0]?.created_at ?? null;

    const markAsViewed = useCallback(async () => {
        if (markSeen && newest !== null) await markSeen(newest);
    }, [markSeen, newest]);

    const refreshNotifications = useCallback(() => { sms?.sync?.(); }, [sms]);

    return {
        newMessageCount: sms?.unreadCount ?? 0,
        markAsViewed,
        refreshNotifications,
        loading: sms?.syncing ?? false,
        error: sms?.error ?? null,
        lastChecked: sms?.lastSynced ?? null,
    };
}
