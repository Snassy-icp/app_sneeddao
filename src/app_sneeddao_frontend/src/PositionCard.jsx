import React, { useState } from 'react';
import { formatAmount, getUSD } from './utils/StringUtils';
import { bigDateToReadable } from './utils/DateUtils';
import { getIcpSwapLink, isLockedPosition, getPositionTVL } from './utils/PositionUtils';
import { PrincipalDisplay, getPrincipalDisplayInfo } from './utils/PrincipalUtils';
import { useTheme } from './contexts/ThemeContext';

const PositionCard = ({ position, positionDetails, openSendLiquidityPositionModal, openLockPositionModal, withdraw_position_rewards, hideButtons, hideUnclaimedFees, defaultExpanded = false }) => {

    const { theme } = useTheme();
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [locksExpanded, setLocksExpanded] = useState(false);

    const handleHeaderClick = () => {
        setIsExpanded(!isExpanded);
    };

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

                        </div>
                    )}
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
                                <span className="amount-value">{formatAmount(positionDetails.tokensOwed0 + positionDetails.tokensUnused0, position.token0Decimals)}{getUSD(positionDetails.tokensOwed0 + positionDetails.tokensUnused0, position.token0Decimals, position.token0_conversion_rate)}</span>
                            </div>
                            <div className="token-amount">
                                <span className="token-symbol">{position.token1Symbol}:</span>
                                <span className="amount-value">{formatAmount(positionDetails.tokensOwed1 + positionDetails.tokensUnused1, position.token1Decimals)}{getUSD(positionDetails.tokensOwed1 + positionDetails.tokensUnused1, position.token1Decimals, position.token1_conversion_rate)}</span>
                            </div>
                        </div>
                        <div className="withdraw-button-container">
                            <button className="withdraw-button" onClick={() => withdraw_position_rewards({
                                swapCanisterId: position.swapCanisterId,
                                id: positionDetails.positionId,
                                frontendOwnership: positionDetails.frontendOwnership,
                                symbols: position.token0Symbol + '/' + position.token1Symbol
                            })}>
                                Withdraw
                            </button>
                        </div>
                    </div>
                }
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
                                gap: '12px', 
                                marginBottom: '15px',
                                paddingBottom: '12px',
                                borderBottom: `1px solid ${theme.colors.border}`
                            }}>
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
                                            principal={positionDetails.owner}
                                            showCopyButton={true}
                                            displayInfo={getPrincipalDisplayInfo(positionDetails.owner)}
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
                </>
            )}
        </div>
    );
};

export default PositionCard;