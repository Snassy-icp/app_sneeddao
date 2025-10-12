import React, { useState } from 'react';
import { formatAmount, getUSD } from './utils/StringUtils';
import { bigDateToReadable } from './utils/DateUtils';
import { getIcpSwapLink, isLockedPosition, getPositionTVL } from './utils/PositionUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from './utils/PrincipalUtils';
import { useTheme } from './contexts/ThemeContext';
import { useNaming } from './NamingContext';
import { useAuth } from './AuthContext';
import { Principal } from '@dfinity/principal';
import ClaimFeesModal from './ClaimFeesModal';

const PositionCard = ({ position, positionDetails, openSendLiquidityPositionModal, openLockPositionModal, handleWithdrawPositionRewards, handleWithdrawPosition, handleWithdrawSwapBalance, handleTransferPositionOwnership, swapCanisterBalance0, swapCanisterBalance1, hideButtons, hideUnclaimedFees, defaultExpanded = false, defaultLocksExpanded = false }) => {

    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming();
    const { isAuthenticated } = useAuth();
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [locksExpanded, setLocksExpanded] = useState(defaultLocksExpanded);
    const [infoExpanded, setInfoExpanded] = useState(false);
    const [showClaimModal, setShowClaimModal] = useState(false);

    const handleHeaderClick = () => {
        setIsExpanded(!isExpanded);
    };

    // Helper function to determine if position can be withdrawn from backend
    const canWithdrawFromBackend = () => {
        if (positionDetails.frontendOwnership) return false;
        if (!positionDetails.lockInfo) return true; // No lock, can withdraw
        // Check if lock has expired
        const now = new Date();
        // Convert BigInt nanoseconds to milliseconds for Date
        const lockExpiry = new Date(Number(positionDetails.lockInfo.expiry / 1000000n));
        return lockExpiry <= now;
    };

    // Helper function to get location status
    const getLocationStatus = () => {
        if (positionDetails.frontendOwnership) {
            return { text: 'Frontend Wallet', color: theme.colors.success, icon: '💼' };
        } else if (isLockedPosition(positionDetails)) {
            const now = new Date();
            // Convert BigInt nanoseconds to milliseconds for Date
            const lockExpiry = new Date(Number(positionDetails.lockInfo.expiry / 1000000n));
            if (lockExpiry > now) {
                return { text: 'Backend (Locked)', color: theme.colors.warning, icon: '🔒' };
            } else {
                return { text: 'Backend (Unlocked)', color: theme.colors.accent, icon: '🔓' };
            }
        } else {
            return { text: 'Backend (Unlocked)', color: theme.colors.accent, icon: '🔓' };
        }
    };

    const locationStatus = getLocationStatus();

    function getPositionLockUrl(swap, positionId) {
        const baseUrl = '/positionlock';
        const positionsParam = `&positions=${positionId}`;
        const url = `${baseUrl}?swap=${swap}${positionsParam}`;
        return url;
    }

    const truncateText = (text) => {
        if (!text) return '';
        const start = text.slice(0, 8);
        const end = text.slice(-8);
        return `${start}...${end}`;
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="card">
            <div className="card-header" onClick={handleHeaderClick}>
                <div className="header-logo-column">
                    <img src={position.token0Logo} alt={position.token0Symbol} className="swap-token-logo1" />
                    <img src={position.token1Logo} alt={position.token1Symbol} className="swap-token-logo2" />
                </div>
                <div className="header-content-column">
                    <div className="header-row-1">
                        <span className="token-name">{position.token0Symbol}/{position.token1Symbol}</span>
                        <span className="token-usd-value">
                            ${getPositionTVL(position, positionDetails, hideUnclaimedFees).toFixed(2)}
                        </span>
                    </div>
                    <div className="header-row-2">
                        <div className="amount-symbol">
                            <span className="token-amount">#{positionDetails.positionId.toString()}</span>
                            {isLockedPosition(positionDetails) && (
                                <span style={{
                                    marginLeft: '6px',
                                    fontSize: '14px',
                                    display: 'inline-flex',
                                    alignItems: 'center'
                                }} title="Position is locked">
                                    🔒
                                </span>
                            )}
                        </div>
                        <span className="expand-indicator">{isExpanded ? '▼' : '▶'}</span>
                    </div>
                </div>
            </div>
            {isExpanded && (
                <>
                    {!hideButtons && (
                        <div className="action-buttons">
                            <a 
                                href={getIcpSwapLink(position)} 
                                target="_blank"
                                style={{
                                    background: theme.colors.accent,
                                    color: theme.colors.primaryBg,
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '6px 12px',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    transition: 'all 0.2s ease',
                                    textDecoration: 'none'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = theme.colors.accentHover;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = theme.colors.accent;
                                }}
                            >
                                <img 
                                    src="icpswap.png" 
                                    alt="ICPSwap" 
                                    style={{ width: '14px', height: '14px' }}
                                />
                                ICPSwap
                            </a>

                            {!isLockedPosition(positionDetails) && (
                                    <button
                                        onClick={() =>
                                            openSendLiquidityPositionModal({
                                                swapCanisterId: position.swapCanisterId,
                                                id: positionDetails.positionId,
                                                frontendOwnership: positionDetails.frontendOwnership,
                                                symbols: position.token0Symbol + '/' + position.token1Symbol})}
                                    style={{
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.background = theme.colors.accentHover;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.background = theme.colors.accent;
                                    }}
                                >
                                    <img 
                                        src="send-inverted.png" 
                                        alt="Send" 
                                        style={{ width: '14px', height: '14px' }}
                                    />
                                    Send
                                    </button>
                            )}

                            {isLockedPosition(positionDetails) && !positionDetails.frontendOwnership && handleTransferPositionOwnership && (
                                <button
                                    onClick={() =>
                                        openSendLiquidityPositionModal({
                                            swapCanisterId: position.swapCanisterId,
                                            id: positionDetails.positionId,
                                            frontendOwnership: positionDetails.frontendOwnership,
                                            symbols: position.token0Symbol + '/' + position.token1Symbol,
                                            isBackendTransfer: true
                                        })}
                                    style={{
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.background = theme.colors.accentHover;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.background = theme.colors.accent;
                                    }}
                                >
                                    <img 
                                        src="send-inverted.png" 
                                        alt="Transfer" 
                                        style={{ width: '14px', height: '14px' }}
                                    />
                                    Transfer
                                </button>
                            )}

                        </div>
                    )}
                    
                    {/* Location Status Badge */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        padding: '12px 0',
                        borderBottom: `1px solid ${theme.colors.border}`,
                        marginBottom: '15px'
                    }}>
                        <span style={{
                            padding: '6px 16px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: '500',
                            background: `linear-gradient(135deg, ${locationStatus.color}30, ${locationStatus.color}15)`,
                            color: locationStatus.color,
                            border: `1px solid ${locationStatus.color}40`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span style={{ fontSize: '16px' }}>{locationStatus.icon}</span>
                            <span>{locationStatus.text}</span>
                        </span>
                    </div>

                    <div className="balance-section">
                <div className="balance-item">
                    <div className="token-amount">
                        <span className="token-symbol">Total:</span>
                        <span className="amount-value">${getPositionTVL(position, positionDetails, hideUnclaimedFees).toFixed(2)}</span>
                    </div>
                </div>
                <div className="balance-item">
                    <div className="balance-label">Liquidity</div>
                    <div className="token-amounts">
                        <div className="token-amount">
                            <span className="token-symbol">{position.token0Symbol}:</span>
                            <span className="amount-value">{formatAmount(positionDetails.token0Amount, position.token0Decimals)}{getUSD(positionDetails.token0Amount, position.token0Decimals, position.token0_conversion_rate)}</span>
                        </div>
                        <div className="token-amount">
                            <span className="token-symbol">{position.token1Symbol}:</span>
                            <span className="amount-value">{formatAmount(positionDetails.token1Amount, position.token1Decimals)}{getUSD(positionDetails.token1Amount, position.token1Decimals, position.token1_conversion_rate)}</span>
                        </div>
                    </div>
                </div>
                {!hideUnclaimedFees &&
                    <div className="balance-item">
                        <div className="balance-label">Unclaimed Fees</div>
                        <div className="token-amounts">
                            <div className="token-amount">
                                <span className="token-symbol">{position.token0Symbol}:</span>
                                <span className="amount-value">{formatAmount(positionDetails.tokensOwed0, position.token0Decimals)}{getUSD(positionDetails.tokensOwed0, position.token0Decimals, position.token0_conversion_rate)}</span>
                            </div>
                            <div className="token-amount">
                                <span className="token-symbol">{position.token1Symbol}:</span>
                                <span className="amount-value">{formatAmount(positionDetails.tokensOwed1, position.token1Decimals)}{getUSD(positionDetails.tokensOwed1, position.token1Decimals, position.token1_conversion_rate)}</span>
                            </div>
                        </div>
                        {/* Only show claim button for frontend positions */}
                        {positionDetails.frontendOwnership && handleWithdrawPositionRewards && (
                            <div className="withdraw-button-container">
                                <button 
                                    className="withdraw-button" 
                                    onClick={() => setShowClaimModal(true)}
                                >
                                    Claim Fees
                                </button>
                            </div>
                        )}
                    </div>
                }
                
                {/* Swap Canister Balance */}
                {!hideUnclaimedFees && positionDetails.frontendOwnership && ((swapCanisterBalance0 || 0n) > 0n || (swapCanisterBalance1 || 0n) > 0n) && (
                    <div className="balance-item" style={{ marginTop: '15px', paddingTop: '15px', borderTop: `1px solid ${theme.colors.border}` }}>
                        <div className="balance-label">Swap Canister Balance</div>
                        <div className="token-amounts">
                            <div className="token-amount">
                                <span className="token-symbol">{position.token0Symbol}:</span>
                                <span className="amount-value">{formatAmount(swapCanisterBalance0 || 0n, position.token0Decimals)}{getUSD(swapCanisterBalance0 || 0n, position.token0Decimals, position.token0_conversion_rate)}</span>
                            </div>
                            <div className="token-amount">
                                <span className="token-symbol">{position.token1Symbol}:</span>
                                <span className="amount-value">{formatAmount(swapCanisterBalance1 || 0n, position.token1Decimals)}{getUSD(swapCanisterBalance1 || 0n, position.token1Decimals, position.token1_conversion_rate)}</span>
                            </div>
                        </div>
                        {handleWithdrawSwapBalance && (
                            <div className="withdraw-button-container">
                                <button 
                                    className="withdraw-button"
                                    onClick={async () => {
                                        if (window.confirm(`Withdraw all available balance from swap canister?\n${formatAmount(swapCanisterBalance0, position.token0Decimals)} ${position.token0Symbol}\n${formatAmount(swapCanisterBalance1, position.token1Decimals)} ${position.token1Symbol}`)) {
                                            try {
                                                await handleWithdrawSwapBalance({
                                                    swapCanisterId: position.swapCanisterId,
                                                    symbols: position.token0Symbol + '/' + position.token1Symbol
                                                });
                                            } catch (error) {
                                                alert(`Failed to withdraw: ${error.message || error.toString()}`);
                                            }
                                        }
                                    }}
                                >
                                    Withdraw
                                </button>
                            </div>
                        )}
                    </div>
                )}
                
                {/* Withdraw from Backend Button */}
                {canWithdrawFromBackend() && handleWithdrawPosition && !hideButtons && (
                    <div className="balance-item" style={{ marginTop: '15px', paddingTop: '15px', borderTop: `1px solid ${theme.colors.border}` }}>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <button
                                onClick={() =>
                                    handleWithdrawPosition({
                                        swapCanisterId: position.swapCanisterId,
                                        id: positionDetails.positionId,
                                        token0: position.token0,
                                        token1: position.token1,
                                        symbols: position.token0Symbol + '/' + position.token1Symbol
                                    })}
                                style={{
                                    background: theme.colors.success,
                                    color: theme.colors.primaryBg,
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '10px 24px',
                                    cursor: 'pointer',
                                    fontSize: '0.95rem',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s ease',
                                    width: '100%',
                                    maxWidth: '300px',
                                    justifyContent: 'center'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = theme.colors.successHover || `${theme.colors.success}dd`;
                                    e.target.style.transform = 'translateY(-2px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = theme.colors.success;
                                    e.target.style.transform = 'translateY(0)';
                                }}
                            >
                                <span style={{ fontSize: '18px' }}>⬇️</span>
                                Withdraw to Frontend Wallet
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <div className="locks-section">
                {/* Collapsible Locks Header */}
                <div 
                    className="locks-header" 
                    onClick={() => setLocksExpanded(!locksExpanded)}
                    style={{
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 0',
                        borderBottom: `1px solid ${theme.colors.border}`,
                        marginBottom: locksExpanded ? '15px' : '0'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                            Locks
                        </span>
                        <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                            ({isLockedPosition(positionDetails) ? '1 lock' : '0 locks'})
                        </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Expand/Collapse Indicator */}
                        <span 
                            style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '1.2rem',
                                transform: locksExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease'
                            }}
                        >
                            ▼
                        </span>
                    </div>
                </div>

                {/* Collapsible Locks Content */}
                {locksExpanded && (
                    <div>
                        {/* Lock Actions Row */}
                        {!hideButtons && (
                            <div style={{ 
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: '12px', 
                                marginBottom: '15px',
                                paddingBottom: '12px',
                                borderBottom: `1px solid ${theme.colors.border}`
                            }}>
                                {/* Link Button */}
                                <a 
                                    href={getPositionLockUrl(position.swapCanisterId, positionDetails.positionId)} 
                                    target="_blank"
                                    style={{
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s ease',
                                        textDecoration: 'none'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.background = theme.colors.accentHover;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.background = theme.colors.accent;
                                    }}
                                >
                                    <img 
                                        src="link-chain.png" 
                                        alt="Link" 
                                        style={{ width: '14px', height: '14px' }}
                                    />
                                    Link
                                </a>
                                
                                {/* Lock Button */}
                                <button
                                    onClick={() => {
                                        openLockPositionModal({
                                            isLocked: isLockedPosition(positionDetails),
                                            token0: position.token0,
                                            token1: position.token1,
                                            swapCanisterId: position.swapCanisterId,
                                            id: positionDetails.positionId,
                                            frontendOwnership: positionDetails.frontendOwnership,
                                            symbols: position.token0Symbol + '/' + position.token1Symbol
                                        });
                                    }}
                                    style={{
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.background = theme.colors.accentHover;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.background = theme.colors.accent;
                                    }}
                                >
                                    <img 
                                        src="sneedlock-logo-cropped.png" 
                                        alt="Lock" 
                                        style={{ width: '14px', height: '14px' }}
                                    />
                                    Lock
                                </button>
                            </div>
                        )}
                <div className="lock-item">
                            <div className="lock-details">
                                <span className="lock-label">Lock Expires:</span>
                                <span className="lock-value">
                    {isLockedPosition(positionDetails)
                        ? bigDateToReadable(positionDetails.lockInfo.expiry)
                        : 'No lock'}
                                </span>
                            </div>
                </div>
                {positionDetails.owner && (
                            <div className="lock-item" style={{ marginTop: '10px' }}>
                                <div className="lock-details">
                                    <span className="lock-label">SneedLock Owner:</span>
                                    <span className="lock-value">
                                        <PrincipalDisplay 
                                            principal={typeof positionDetails.owner === 'string' 
                                                ? Principal.fromText(positionDetails.owner) 
                                                : positionDetails.owner}
                                            showCopyButton={true}
                                            short={true}
                                            enableContextMenu={true}
                                            isAuthenticated={isAuthenticated}
                                            displayInfo={getPrincipalDisplayInfoFromContext(
                                                typeof positionDetails.owner === 'string' 
                                                    ? Principal.fromText(positionDetails.owner) 
                                                    : positionDetails.owner, 
                                                principalNames, 
                                                principalNicknames
                                            )}
                                        />
                                    </span>
                                </div>
                        </div>
                )}
                {positionDetails.icpSwapOwner && (
                            <div className="lock-item" style={{ marginTop: '10px' }}>
                                <div className="lock-details">
                                    <span className="lock-label" style={{ 
                                        color: theme.colors.mutedText,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span>ICPSwap Owner</span>
                            {positionDetails.owner && (
                                <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                                background: 
                                                    positionDetails.ownershipStatus === 'match' ? `linear-gradient(135deg, ${theme.colors.success}20, ${theme.colors.success}10)` :
                                                    positionDetails.ownershipStatus === 'locked' ? `linear-gradient(135deg, ${theme.colors.success}20, ${theme.colors.success}10)` :
                                                    `linear-gradient(135deg, ${theme.colors.error}20, ${theme.colors.error}10)`,
                                    color: 
                                                    positionDetails.ownershipStatus === 'match' ? theme.colors.success :
                                                    positionDetails.ownershipStatus === 'locked' ? theme.colors.success :
                                                    theme.colors.error,
                                    display: 'flex',
                                    alignItems: 'center',
                                                gap: '4px',
                                                border: `1px solid ${
                                                    positionDetails.ownershipStatus === 'match' ? theme.colors.success :
                                                    positionDetails.ownershipStatus === 'locked' ? theme.colors.success :
                                                    theme.colors.error
                                                }30`
                                }}>
                                    {positionDetails.ownershipStatus === 'match' ? '✓ Match!' :
                                     positionDetails.ownershipStatus === 'locked' ? '✓ Match!' :
                                     '✗ Mismatch!'}
                                </span>
                            )}
                                    </span>
                                    <span className="lock-value" style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px',
                                        color: theme.colors.primaryText,
                            fontSize: '14px'
                        }}>
                            <div title={positionDetails.icpSwapOwner} style={{ cursor: 'help' }}>
                                {truncateText(positionDetails.icpSwapOwner)}
                            </div>
                            <button 
                                onClick={() => copyToClipboard(positionDetails.icpSwapOwner)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                                color: theme.colors.mutedText,
                                    cursor: 'pointer',
                                    padding: '4px',
                                    fontSize: '12px'
                                }}
                                title="Copy to clipboard"
                            >
                                📋
                            </button>
                                    </span>
                                </div>
                            </div>
                        )}
                        </div>
                )}
            </div>

            {/* Position Info Section */}
            <div className="info-section">
                {/* Collapsible Info Header */}
                <div 
                    className="info-header" 
                    onClick={() => setInfoExpanded(!infoExpanded)}
                    style={{
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 0',
                        borderBottom: `1px solid ${theme.colors.border}`,
                        marginBottom: infoExpanded ? '15px' : '0'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                            ℹ️ Position Info
                        </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Expand/Collapse Indicator */}
                        <span 
                            style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '1.2rem',
                                transform: infoExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease'
                            }}
                        >
                            ▼
                        </span>
                    </div>
                </div>

                {/* Collapsible Info Content */}
                {infoExpanded && (
                    <div style={{ paddingBottom: '15px' }}>
                        {/* Swap Canister ID */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Swap Canister:
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '0.9rem',
                                    fontFamily: 'monospace'
                                }}>
                                    {position.swapCanisterId?.toString?.() || position.swapCanisterId || 'N/A'}
                                </span>
                                {position.swapCanisterId && (
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(
                                                position.swapCanisterId?.toString?.() || position.swapCanisterId
                                            );
                                        }}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '4px',
                                            color: theme.colors.accent,
                                            fontSize: '0.9rem'
                                        }}
                                        title="Copy to clipboard"
                                    >
                                        📋
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Position ID */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Position ID:
                            </span>
                            <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                #{positionDetails.positionId?.toString() || 'N/A'}
                            </span>
                        </div>

                        {/* Token 0 Info */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Token 0:
                            </span>
                            <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                {position.token0Symbol || 'N/A'} ({position.token0Decimals || 'N/A'} decimals)
                            </span>
                        </div>

                        {/* Token 0 Ledger */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Token 0 Ledger:
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '0.9rem',
                                    fontFamily: 'monospace',
                                    maxWidth: '250px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {position.token0?.toString?.() || position.token0 || 'N/A'}
                                </span>
                                {position.token0 && (
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(
                                                position.token0?.toString?.() || position.token0
                                            );
                                        }}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '4px',
                                            color: theme.colors.accent,
                                            fontSize: '0.9rem'
                                        }}
                                        title="Copy to clipboard"
                                    >
                                        📋
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Token 1 Info */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Token 1:
                            </span>
                            <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                {position.token1Symbol || 'N/A'} ({position.token1Decimals || 'N/A'} decimals)
                            </span>
                        </div>

                        {/* Token 1 Ledger */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0'
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Token 1 Ledger:
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '0.9rem',
                                    fontFamily: 'monospace',
                                    maxWidth: '250px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {position.token1?.toString?.() || position.token1 || 'N/A'}
                                </span>
                                {position.token1 && (
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(
                                                position.token1?.toString?.() || position.token1
                                            );
                                        }}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '4px',
                                            color: theme.colors.accent,
                                            fontSize: '0.9rem'
                                        }}
                                        title="Copy to clipboard"
                                    >
                                        📋
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
                </>
            )}
            
            {/* Claim Fees Modal */}
            <ClaimFeesModal
                show={showClaimModal}
                onClose={() => setShowClaimModal(false)}
                onClaim={(amounts) => handleWithdrawPositionRewards({
                    swapCanisterId: position.swapCanisterId,
                    id: positionDetails.positionId,
                    frontendOwnership: positionDetails.frontendOwnership,
                    symbols: position.token0Symbol + '/' + position.token1Symbol,
                    requestedToken0Amount: amounts.token0Amount,
                    requestedToken1Amount: amounts.token1Amount,
                    claimAndWithdraw: amounts.claimAndWithdraw
                })}
                position={{
                    positionId: positionDetails.positionId,
                    token0Symbol: position.token0Symbol,
                    token1Symbol: position.token1Symbol,
                    token0Decimals: position.token0Decimals,
                    token1Decimals: position.token1Decimals,
                    swapCanisterId: position.swapCanisterId
                }}
                unclaimedFees={{
                    token0Amount: positionDetails.tokensOwed0,
                    token1Amount: positionDetails.tokensOwed1
                }}
            />
        </div>
    );
};

export default PositionCard;