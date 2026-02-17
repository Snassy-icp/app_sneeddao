import { useMemo, useState, useCallback } from 'react';
import { useWalletOptional } from '../contexts/WalletContext';

/**
 * Hook for bot log alert notification.
 * Aggregates unseen error/warning counts across all bots (staking + trading).
 * Used in the Header notifications bar.
 */
export function useBotLogNotification() {
    const walletContext = useWalletOptional();
    const botLogAlerts = walletContext?.botLogAlerts || {};

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const openDialog = useCallback(() => setIsDialogOpen(true), []);
    const closeDialog = useCallback(() => setIsDialogOpen(false), []);

    // Read notification preferences from localStorage (default: true)
    const includeWarnings = (() => {
        try {
            const val = localStorage.getItem('notifyBotLogWarnings');
            return val !== null ? JSON.parse(val) : true;
        } catch { return true; }
    })();

    const { errorCount, warningCount, totalCount, botsWithAlerts, hasErrors } = useMemo(() => {
        const entries = Object.entries(botLogAlerts);
        let errors = 0;
        let warnings = 0;
        const bots = [];

        for (const [canisterId, summary] of entries) {
            const e = summary.unseenErrorCount || 0;
            const w = summary.unseenWarningCount || 0;
            if (e > 0 || w > 0) {
                errors += e;
                warnings += w;
                bots.push({ canisterId, ...summary });
            }
        }

        const total = errors + (includeWarnings ? warnings : 0);

        return {
            errorCount: errors,
            warningCount: warnings,
            totalCount: total,
            botsWithAlerts: bots,
            hasErrors: errors > 0,
        };
    }, [botLogAlerts, includeWarnings]);

    // Red for errors, orange for warnings-only
    const color = hasErrors ? '#ef4444' : '#f59e0b';

    return {
        errorCount,
        warningCount,
        totalCount,
        botsWithAlerts,
        color,
        isDialogOpen,
        openDialog,
        closeDialog,
    };
}
