import { useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useStickyCount } from './useStickyCount';
import { getRecentMentionsCount, markMentionsSeen } from '../utils/mentions';

/// New @-mentions of the signed-in member in the forum (spec/forum_mentions.md), checked every
/// two minutes like replies; markAsViewed clears the count.
export function useMentionNotifications() {
    const { isAuthenticated, identity } = useAuth();
    const [newMentionCount, setNewMentionCount] = useStickyCount('mentions', identity?.getPrincipal().toText() ?? null);

    const check = useCallback(async () => {
        if (!isAuthenticated || !identity) { setNewMentionCount(0); return; }
        try { setNewMentionCount(await getRecentMentionsCount(identity, identity.getPrincipal())); }
        catch { setNewMentionCount(0); } // a forum from before mentions has no such method
    }, [isAuthenticated, identity, setNewMentionCount]);

    const markAsViewed = useCallback(async () => {
        if (!isAuthenticated || !identity) return;
        try { await markMentionsSeen(identity); setNewMentionCount(0); } catch { /* try again next time */ }
    }, [isAuthenticated, identity, setNewMentionCount]);

    useEffect(() => { check(); }, [check]);
    useEffect(() => {
        if (!isAuthenticated || !identity) return undefined;
        const t = setInterval(check, 2 * 60 * 1000);
        const onSeen = () => check();
        window.addEventListener('mentionsSeen', onSeen);
        return () => { clearInterval(t); window.removeEventListener('mentionsSeen', onSeen); };
    }, [isAuthenticated, identity, check]);

    return { newMentionCount, markAsViewed, refreshNotifications: check };
}
