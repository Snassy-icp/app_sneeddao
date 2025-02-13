import React from 'react';
import { formatAmount, getUSD } from './utils/StringUtils';
import { bigDateToReadable } from './utils/DateUtils';
import { getIcpSwapLink, isLockedPosition, getPositionTVL } from './utils/PositionUtils';

const PositionCard = ({ position, positionDetails, openSendLiquidityPositionModal, openLockPositionModal, withdraw_position_rewards, hideButtons, hideUnclaimedFees }) => {

    function getPositionLockUrl(swap, positionId) {
        const baseUrl = '/positionlock';
        const positionsParam = `&positions=${positionId}`;
        const url = `${baseUrl}?swap=${swap}${positionsParam}`;
        return url;
    }

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