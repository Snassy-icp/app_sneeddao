import React from 'react';
import { formatAmount, getUSD } from './utils/StringUtils';
import { bigDateToReadable } from './utils/DateUtils';
import { getIcpSwapLink, isLockedPosition, getPositionTVL } from './utils/PositionUtils';
import { PrincipalDisplay, getPrincipalDisplayInfo } from './utils/PrincipalUtils';

const PositionCard = ({ position, positionDetails, openSendLiquidityPositionModal, openLockPositionModal, withdraw_position_rewards, hideButtons, hideUnclaimedFees }) => {

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
            <div className="card-header">
                <img src={position.token0Logo} alt={position.token0Symbol} className="swap-token-logo1" />
                <img src={position.token1Logo} alt={position.token1Symbol} className="swap-token-logo2" />
                <span className="token-symbol">{position.token0Symbol}/{position.token1Symbol} #{positionDetails.positionId.toString()}</span>
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
                <div className="locks-header">Lock Expires</div>
                <div className="lock-item">
                    {isLockedPosition(positionDetails)
                        ? bigDateToReadable(positionDetails.lockInfo.expiry)
                        : 'No lock'}
                </div>
                {positionDetails.owner && (
                    <>
                        <div className="locks-header" style={{ marginTop: '10px' }}>SneedLock Owner</div>
                        <div className="lock-item">
                            <PrincipalDisplay 
                                principal={positionDetails.owner}
                                showCopyButton={true}
                                displayInfo={getPrincipalDisplayInfo(positionDetails.owner)}
                            />
                        </div>
                    </>
                )}
                {positionDetails.icpSwapOwner && (
                    <>
                        <div className="locks-header" style={{ 
                            marginTop: '10px', 
                            color: '#888',
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
                                    backgroundColor: 
                                        positionDetails.ownershipStatus === 'match' ? 'rgba(46, 204, 113, 0.2)' :
                                        positionDetails.ownershipStatus === 'locked' ? 'rgba(46, 204, 113, 0.2)' :
                                        'rgba(231, 76, 60, 0.2)',
                                    color: 
                                        positionDetails.ownershipStatus === 'match' ? '#2ecc71' :
                                        positionDetails.ownershipStatus === 'locked' ? '#2ecc71' :
                                        '#e74c3c',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    {positionDetails.ownershipStatus === 'match' ? '✓ Match!' :
                                     positionDetails.ownershipStatus === 'locked' ? '✓ Locked!' :
                                     '✗ Mismatch!'}
                                </span>
                            )}
                        </div>
                        <div className="lock-item" style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px',
                            color: '#fff',
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
                                    color: '#888',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    fontSize: '12px'
                                }}
                                title="Copy to clipboard"
                            >
                                📋
                            </button>
                        </div>
                    </>
                )}
            </div>
            {!hideButtons &&
                <div className="action-buttons">
                    <div className="tooltip-wrapper">
                        <a href={getIcpSwapLink(position)} target="_blank">
                            <img src="icpswap.png" className="swap-link-button" alt="Position on ICPSwap" />
                        </a>
                        <span className="tooltip">View on ICPSwap</span>
                    </div>
                    <div className="tooltip-wrapper">
                        <a className="link-button" href={getPositionLockUrl(position.swapCanisterId, positionDetails.positionId)} target="_blank">
                            <img src="link-chain.png" alt="Lock Link" />
                        </a>
                        <span className="tooltip">View Lock Details</span>
                    </div>
                    {!isLockedPosition(positionDetails) &&
                        <div className="tooltip-wrapper">
                            <button
                                className="send-button"
                                onClick={() =>
                                    openSendLiquidityPositionModal({
                                        swapCanisterId: position.swapCanisterId,
                                        id: positionDetails.positionId,
                                        frontendOwnership: positionDetails.frontendOwnership,
                                        symbols: position.token0Symbol + '/' + position.token1Symbol})}
                            >
                                <img src="send-inverted.png" alt="Send" />
                            </button>
                            <span className="tooltip">Send Position</span>
                        </div>
                    }
                    <div className="tooltip-wrapper">
                        <button className="lock-button" onClick={() => 
                            openLockPositionModal({
                                isLocked: isLockedPosition(positionDetails),
                                token0: position.token0,
                                token1: position.token1,
                                swapCanisterId: position.swapCanisterId,
                                id: positionDetails.positionId,
                                frontendOwnership: positionDetails.frontendOwnership,
                                symbols: position.token0Symbol + '/' + position.token1Symbol})}>
                            <img src="sneedlock-logo-cropped.png" alt="Lock Details" />
                        </button>
                        <span className="tooltip">Lock Position</span>
                    </div>
                </div>
            }
        </div>
    );
};

export default PositionCard;