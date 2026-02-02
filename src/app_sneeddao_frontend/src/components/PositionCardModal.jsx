import React, { useEffect, useState } from 'react';
import { FaTimes, FaSync } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import PositionCard from '../PositionCard';

/**
 * Modal wrapper for displaying a PositionCard
 * Used in the PrincipalBox compact wallet to show full position details
 */
const PositionCardModal = ({ 
    show, 
    onClose, 
    position,
    positionDetails,
    // Optional handlers - if not provided, buttons will be hidden
    openSendLiquidityPositionModal,
    openLockPositionModal,
    handleWithdrawPositionRewards,
    handleClaimLockedPositionFees,
    handleClaimUnlockedDepositedPositionFees,
    handleWithdrawPosition,
    handleWithdrawSwapBalance,
    handleTransferPositionOwnership,
    handleRefreshPosition,
    isRefreshing = false,
    swapCanisterBalance0,
    swapCanisterBalance1,
    token0Fee,
    token1Fee,
    hideUnclaimedFees = false
}) => {
    const { theme } = useTheme();
    const [refreshClicked, setRefreshClicked] = useState(false);

    // Handle refresh click with visual feedback
    const handleRefreshClick = async () => {
        if (isRefreshing || !handleRefreshPosition) return;
        
        // Visual feedback
        setRefreshClicked(true);
        setTimeout(() => setRefreshClicked(false), 300);
        
        // Trigger refresh
        await handleRefreshPosition(position);
    };

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

    if (!show || !position || !positionDetails) return null;

    // Determine if we should hide buttons (when no handlers provided)
    const hideButtons = !openSendLiquidityPositionModal && !openLockPositionModal;

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
                {/* Header bar with refresh and close buttons */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                    padding: '8px 8px 0 8px'
                }}>
                    {/* Refresh button */}
                    {handleRefreshPosition && (
                        <button
                            onClick={handleRefreshClick}
                            disabled={isRefreshing}
                            style={{
                                background: refreshClicked 
                                    ? 'rgba(59, 130, 246, 0.5)' 
                                    : 'rgba(255, 255, 255, 0.1)',
                                border: 'none',
                                borderRadius: '50%',
                                width: '32px',
                                height: '32px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: isRefreshing ? 'not-allowed' : 'pointer',
                                color: refreshClicked ? '#fff' : theme.colors.mutedText,
                                transition: 'all 0.15s ease',
                                opacity: isRefreshing ? 0.5 : 1,
                                transform: refreshClicked ? 'scale(0.9)' : 'scale(1)',
                                flexShrink: 0
                            }}
                            onMouseOver={(e) => {
                                if (!isRefreshing && !refreshClicked) {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                                    e.currentTarget.style.color = theme.colors.primaryText;
                                }
                            }}
                            onMouseOut={(e) => {
                                if (!refreshClicked) {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                                    e.currentTarget.style.color = theme.colors.mutedText;
                                }
                            }}
                            title="Refresh position data"
                        >
                            <FaSync 
                                size={12} 
                                style={{ 
                                    animation: isRefreshing ? 'spin 1s linear infinite' : 'none' 
                                }} 
                            />
                        </button>
                    )}
                    
                    {/* Close button */}
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

                {/* PositionCard wrapper */}
                <div style={{ padding: '0 8px 8px 8px' }}>
                    <PositionCard
                        position={position}
                        positionDetails={positionDetails}
                        openSendLiquidityPositionModal={openSendLiquidityPositionModal}
                        openLockPositionModal={openLockPositionModal}
                        handleWithdrawPositionRewards={handleWithdrawPositionRewards}
                        handleClaimLockedPositionFees={handleClaimLockedPositionFees}
                        handleClaimUnlockedDepositedPositionFees={handleClaimUnlockedDepositedPositionFees}
                        handleWithdrawPosition={handleWithdrawPosition}
                        handleWithdrawSwapBalance={handleWithdrawSwapBalance}
                        handleTransferPositionOwnership={handleTransferPositionOwnership}
                        /* Don't pass handleRefreshPosition - we handle refresh in modal header */
                        isRefreshing={isRefreshing}
                        swapCanisterBalance0={swapCanisterBalance0}
                        swapCanisterBalance1={swapCanisterBalance1}
                        token0Fee={token0Fee}
                        token1Fee={token1Fee}
                        hideButtons={hideButtons}
                        hideUnclaimedFees={hideUnclaimedFees}
                        defaultExpanded={true}
                        defaultLocksExpanded={false}
                        /* Don't pass onOpenDetailModal since we're already in the modal */
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
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default PositionCardModal;
