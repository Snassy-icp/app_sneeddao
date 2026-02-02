import React, { useEffect, useMemo } from 'react';
import { FaTimes } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import TokenCard from '../TokenCard';

/**
 * Modal wrapper for displaying a TokenCard
 * Used in the PrincipalBox compact wallet to show full token details
 */
const TokenCardModal = ({ 
    show, 
    onClose, 
    token,
    // Optional handlers - if not provided, buttons will be hidden
    openSendModal,
    openLockModal,
    openWrapModal,
    openUnwrapModal,
    handleClaimRewards,
    handleWithdrawFromBackend,
    handleDepositToBackend,
    handleRefreshToken,
    isRefreshing = false,
    locks = [],
    lockDetailsLoading = false,
    rewardDetailsLoading = false,
    isSnsToken = false
}) => {
    const { theme } = useTheme();

    // Normalize token data to ensure all required fields exist
    const normalizedToken = useMemo(() => {
        if (!token) return null;
        
        return {
            ...token,
            // Ensure all BigInt fields have defaults
            balance: token.balance ?? token.available ?? 0n,
            available: token.available ?? token.balance ?? 0n,
            locked: token.locked ?? 0n,
            staked: token.staked ?? 0n,
            maturity: token.maturity ?? 0n,
            rewards: token.rewards ?? 0n,
            available_backend: token.available_backend ?? 0n,
            fee: token.fee ?? 10000n,
            // Ensure numeric fields have defaults
            decimals: token.decimals ?? 8,
            conversion_rate: token.conversion_rate ?? null,
            // Ensure string fields have defaults
            symbol: token.symbol ?? '???',
            name: token.name ?? token.symbol ?? 'Unknown Token',
            logo: token.logo ?? '',
            principal: token.principal ?? token.ledger_canister_id?.toString?.() ?? '',
        };
    }, [token]);

    // Create proper loading state objects that indicate "not loading"
    // rewardDetailsLoading expects { [ledger_id]: number } where >= 0 means not loading
    // lockDetailsLoading expects { [ledger_id]: boolean } where false means not loading
    const normalizedRewardDetailsLoading = useMemo(() => {
        if (rewardDetailsLoading && typeof rewardDetailsLoading === 'object' && Object.keys(rewardDetailsLoading).length > 0) {
            return rewardDetailsLoading;
        }
        // Return object indicating "loaded" (value >= 0) for this token
        const ledgerId = token?.ledger_canister_id?.toString?.() || token?.ledger_canister_id || token?.principal;
        if (ledgerId) {
            return { [ledgerId]: 0 }; // 0 means loaded/not loading
        }
        return {};
    }, [rewardDetailsLoading, token]);

    const normalizedLockDetailsLoading = useMemo(() => {
        if (lockDetailsLoading && typeof lockDetailsLoading === 'object') {
            return lockDetailsLoading;
        }
        // Return object indicating "not loading" for this token
        const ledgerId = token?.ledger_canister_id?.toString?.() || token?.ledger_canister_id || token?.principal;
        if (ledgerId) {
            return { [ledgerId]: false };
        }
        return {};
    }, [lockDetailsLoading, token]);

    // Convert locks array to object keyed by ledger_canister_id (format expected by TokenCard)
    const normalizedLocks = useMemo(() => {
        const ledgerId = token?.ledger_canister_id?.toString?.() || token?.ledger_canister_id || token?.principal;
        
        // If locks is already an object with the right structure, use it
        if (locks && typeof locks === 'object' && !Array.isArray(locks)) {
            return locks;
        }
        
        // If locks is an array, convert to object
        if (Array.isArray(locks) && ledgerId) {
            return { [ledgerId]: locks };
        }
        
        // Default empty object
        return ledgerId ? { [ledgerId]: [] } : {};
    }, [locks, token]);

    // Handle escape key to close
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && show) {
                onClose();
            }
        };
        
        if (show) {
            document.addEventListener('keydown', handleEscape);
            // Prevent body scroll when modal is open
            document.body.style.overflow = 'hidden';
        }
        
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [show, onClose]);

    if (!show || !normalizedToken) return null;

    // Determine if we should hide buttons (when no handlers provided)
    const hideButtons = !openSendModal && !openLockModal;

    return (
        <div 
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                padding: '16px',
                animation: 'fadeIn 0.2s ease'
            }}
        >
            <div 
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'relative',
                    width: '100%',
                    maxWidth: '500px',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    borderRadius: '16px',
                    backgroundColor: theme.colors.secondaryBg,
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                    animation: 'slideUp 0.3s ease'
                }}
            >
                {/* Header bar with close button - positioned above the card content */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    padding: '8px 8px 0 8px'
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            borderRadius: '50%',
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: theme.colors.mutedText,
                            transition: 'all 0.2s ease',
                            flexShrink: 0
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                            e.currentTarget.style.color = theme.colors.primaryText;
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.color = theme.colors.mutedText;
                        }}
                        title="Close"
                    >
                        <FaTimes size={14} />
                    </button>
                </div>

                {/* TokenCard wrapper */}
                <div style={{ padding: '0 8px 8px 8px' }}>
                    <TokenCard
                        token={normalizedToken}
                        locks={normalizedLocks}
                        lockDetailsLoading={normalizedLockDetailsLoading}
                        showDebug={false}
                        hideButtons={hideButtons}
                        defaultExpanded={true}
                        defaultLocksExpanded={false}
                        openSendModal={openSendModal}
                        openLockModal={openLockModal}
                        openWrapModal={openWrapModal}
                        openUnwrapModal={openUnwrapModal}
                        rewardDetailsLoading={normalizedRewardDetailsLoading}
                        handleClaimRewards={handleClaimRewards}
                        handleWithdrawFromBackend={handleWithdrawFromBackend}
                        handleDepositToBackend={handleDepositToBackend}
                        handleRefreshToken={handleRefreshToken}
                        isRefreshing={isRefreshing}
                        isSnsToken={isSnsToken}
                    />
                </div>
            </div>

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { 
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to { 
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            `}</style>
        </div>
    );
};

export default TokenCardModal;
