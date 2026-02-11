import { useState, useCallback } from 'react';
import { useWalletOptional } from '../contexts/WalletContext';

/**
 * Hook for low-cycles canister notification count.
 * Returns canisters below their critical cycle level.
 * Used in the Header notifications bar.
 */
export function useLowCyclesNotification() {
    const walletContext = useWalletOptional();
    const lowCyclesCanisters = walletContext?.lowCyclesCanisters || [];

    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const openDialog = useCallback(() => setIsDialogOpen(true), []);
    const closeDialog = useCallback(() => setIsDialogOpen(false), []);

    return {
        lowCyclesCount: lowCyclesCanisters.length,
        lowCyclesCanisters,
        isDialogOpen,
        openDialog,
        closeDialog,
    };
}
