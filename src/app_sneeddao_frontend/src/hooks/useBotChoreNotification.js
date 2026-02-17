import { useMemo, useState, useCallback } from 'react';
import { useWalletOptional } from '../contexts/WalletContext';
import {
    getAllChoresSummaryLamp,
    LAMP_WARN,
    LAMP_ERROR,
    LAMP_COLORS,
} from '../components/ChoreStatusLamp';

/**
 * Hook for bot chore health notification.
 * Returns the number of bots (staking + trading) whose overall chore lamp is orange (warn) or red (error).
 * Used in the Header notifications bar.
 */
export function useBotChoreNotification() {
    const walletContext = useWalletOptional();
    const managerChoreStatuses = walletContext?.managerChoreStatuses || {};
    const allBotEntries = walletContext?.allBotEntries || [];

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const openDialog = useCallback(() => setIsDialogOpen(true), []);
    const closeDialog = useCallback(() => setIsDialogOpen(false), []);

    // Build a canisterId -> appId map for quick lookup
    const botTypeMap = useMemo(() => {
        const map = {};
        for (const entry of allBotEntries) {
            map[entry.canisterId.toString()] = entry.appId || '';
        }
        return map;
    }, [allBotEntries]);

    const { unhealthyCount, worstState, unhealthyManagers } = useMemo(() => {
        const entries = Object.entries(managerChoreStatuses);
        const unhealthy = [];
        let worst = null;

        for (const [canisterId, choreStatuses] of entries) {
            if (!choreStatuses || choreStatuses.length === 0) continue;
            const lamp = getAllChoresSummaryLamp(choreStatuses);
            if (lamp === LAMP_WARN || lamp === LAMP_ERROR) {
                const appId = botTypeMap[canisterId] || '';
                unhealthy.push({ canisterId, lamp, appId });
                if (lamp === LAMP_ERROR) {
                    worst = LAMP_ERROR;
                } else if (!worst) {
                    worst = LAMP_WARN;
                }
            }
        }

        return {
            unhealthyCount: unhealthy.length,
            worstState: worst,
            unhealthyManagers: unhealthy,
        };
    }, [managerChoreStatuses, botTypeMap]);

    // Pick color based on worst state — red for error, orange for warn
    const color = worstState === LAMP_ERROR ? LAMP_COLORS.error : LAMP_COLORS.warn;

    return {
        unhealthyCount,
        worstState,
        unhealthyManagers,
        color,
        isDialogOpen,
        openDialog,
        closeDialog,
    };
}
