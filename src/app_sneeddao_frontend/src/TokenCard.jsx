import React from 'react';
import { formatAmount, getUSD, formatAmountWithConversion } from './utils/StringUtils';
import { dateToReadable, format_duration } from './utils/DateUtils'
import { rewardAmountOrZero, availableOrZero } from './utils/TokenUtils';
import { PrincipalDisplay } from './utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';

const TokenCard = ({ token, locks, lockDetailsLoading, principalDisplayInfo, showDebug, hideAvailable = false, hideButtons = false, openSendModal, openLockModal, handleUnregisterToken, rewardDetailsLoading, handleClaimRewards }) => {

    function getTokenLockUrl(ledger, locks) {
        const baseUrl = '/tokenlock';
        const lockIds = !locks || locks.length < 1 ? "" : locks.map(lock => lock.lock_id).join(',');
        const locksParam = lockIds.length < 1 ? "" : `&locks=${lockIds}`;
        const url = `${baseUrl}?ledger=${ledger}${locksParam}`;
        return url;
    }

    return (
        <div className="card">
            <div className="card-header">
                <img src={token.logo} alt={token.symbol} className="token-logo" />
                <span className="token-symbol">{token.symbol}</span>
            </div>
            <div className="balance-section">
                {!hideAvailable && (
                    <>
                        <div className="balance-item">
                            <div className="balance-label">Total</div>
                            <div className="balance-value">${formatAmountWithConversion(availableOrZero(token.available) + token.locked + rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals, token.conversion_rate, 2)}</div>
                        </div>
                        <div className="balance-item">
                            <div className="balance-label">Available</div>
                            <div className="balance-value">{formatAmount(token.available, token.decimals)}{getUSD(token.available, token.decimals, token.conversion_rate)}</div>
                        </div>
                    </>
                )}
                <div className="balance-item">
                    <div className="balance-label">Locked</div>
                    <div className="balance-value">{formatAmount(token.locked, token.decimals)}{getUSD(token.locked, token.decimals, token.conversion_rate)}</div>
                </div>    
                {(!hideAvailable && (
                    (rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable) > 0) ? (
                        <div className="balance-item">
                            <div className="balance-label">Rewards:
                                <div className="tooltip-wrapper">
                                    <button className="claim-button" onClick={() => handleClaimRewards(token)}>
                                        <img src="grasp-white.png" alt="Claim" />
                                    </button>
                                    <span className="tooltip">Claim Rewards</span>
                                </div>
                            </div>
                            <div className="balance-value">{formatAmount(rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals)}{getUSD(rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals, token.conversion_rate)}</div>
                        </div>
                    ) : (
                        ((Object.keys(rewardDetailsLoading).length === 0 || (rewardDetailsLoading[token.ledger_canister_id] != null && rewardDetailsLoading[token.ledger_canister_id] < 0))) && (
                            <div className="spinner-container">
                                <div className="spinner"></div>
                            </div>
                        )
                    )
                ))}
            </div>
            {showDebug && (
                <div className="debug-section">
                    <p>Frontend: {formatAmount(token.balance, token.decimals)}</p>
                    <p>Backend: {formatAmount(token.balance_backend, token.decimals)}</p>
                </div>
            )}
            {!hideButtons && (
                <div className="action-buttons">

                    <div className="tooltip-wrapper">
                        <a className="link-button" href={getTokenLockUrl(token.ledger_canister_id, locks[token.ledger_canister_id])} target="_blank">
                            <img src="link-chain.png" alt="Lock Link" />
                        </a>
                        <span className="tooltip">View Lock Details</span>
                    </div>
                    {token.available > 0n && (
                        <div className="tooltip-wrapper">
                            <button className="send-button" onClick={() => openSendModal(token)}>
                                <img src="send-inverted.png" alt="Send" />
                            </button>
                            <span className="tooltip">Send Tokens</span>
                        </div>
                    )}
                    {token.available > 0n && (
                        <div className="tooltip-wrapper">
                            <button className="lock-button" onClick={() => openLockModal(token)}>
                                <img src="sneedlock-logo-cropped.png" alt="Lock" />
                            </button>
                            <span className="tooltip">Lock Tokens</span>
                        </div>
                    )}
                    {token.available + BigInt(token.locked) + rewardAmountOrZero(token) === 0n && (
                        <div className="tooltip-wrapper">
                            <button className="remove-button" onClick={() => handleUnregisterToken(token.ledger_canister_id)}>
                                <img src="red-x-black.png" alt="Remove" />
                            </button>
                            <span className="tooltip">Remove Token</span>
                        </div>
                    )}
                </div>
            )}
            {lockDetailsLoading[token.ledger_canister_id] ? (
                <div className="spinner-container">
                    <div className="spinner"></div>
                </div>
            ) : (
                <div className="locks-section">
                    <div className="locks-header">Locks</div>
                    {locks[token.ledger_canister_id] && locks[token.ledger_canister_id].length > 0 ? (
                        locks[token.ledger_canister_id].map((lock, lockIndex) => (
                            <div key={lockIndex} className="lock-item">
                                <div className="lock-details">
                                    <span className="lock-label">Amount:</span>
                                    <span className="lock-value">{formatAmount(lock.amount, token.decimals)}{getUSD(lock.amount, token.decimals, token.conversion_rate)}</span>
                                </div>
                                <div className="lock-details">
                                    <span className="lock-label">Expires:</span>
                                    <span className="lock-value">{dateToReadable(lock.expiry)}</span>
                                </div>
                                <div className="lock-details">
                                    <span className="lock-label">Duration:</span>
                                    <span className="lock-value">{format_duration(lock.expiry - new Date())}</span>
                                </div>
                                {lock.owner && (
                                    <div className="lock-details">
                                        <span className="lock-label">Owner:</span>
                                        <span className="lock-value">
                                            <PrincipalDisplay 
                                                principal={Principal.fromText(lock.owner)}
                                                displayInfo={principalDisplayInfo?.get(lock.owner)}
                                                showCopyButton={true}
                                                style={{ display: 'inline-flex' }}
                                            />
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))
                    ) : (
                        <p>No locks</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default TokenCard;