import { useState, useEffect, useCallback } from 'react';
import { useWalletOptional } from '../contexts/WalletContext';

/**
 * Hook for outdated bot notification count.
 * Returns the number of ICP Staking Bots that have a newer official version available.
 * Used in the Header notifications bar.
 */
export function useOutdatedBotsNotification() {
    const walletContext = useWalletOptional();
    const outdatedManagers = walletContext?.outdatedManagers || [];
    const latestOfficialVersion = walletContext?.latestOfficialVersion;

    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const openDialog = useCallback(() => setIsDialogOpen(true), []);
    const closeDialog = useCallback(() => setIsDialogOpen(false), []);

    return {
        outdatedCount: outdatedManagers.length,
        outdatedManagers,
        latestOfficialVersion,
        isDialogOpen,
        openDialog,
        closeDialog,
    };
}
