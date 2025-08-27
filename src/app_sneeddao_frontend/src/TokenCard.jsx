import React, { useState } from 'react';
import { formatAmount, getUSD, formatAmountWithConversion } from './utils/StringUtils';
import { dateToReadable, format_duration } from './utils/DateUtils'
import { rewardAmountOrZero, availableOrZero, get_available_backend } from './utils/TokenUtils';
import { PrincipalDisplay } from './utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import { useTheme } from './contexts/ThemeContext';

// Constants for GLDT and sGLDT canister IDs
const GLDT_CANISTER_ID = '6c7su-kiaaa-aaaar-qaira-cai';
const SGLDT_CANISTER_ID = 'i2s4q-syaaa-aaaan-qz4sq-cai';

console.log('TokenCard constants:', { GLDT_CANISTER_ID, SGLDT_CANISTER_ID });

const TokenCard = ({ token, locks, lockDetailsLoading, principalDisplayInfo, showDebug, hideAvailable = false, hideButtons = false, openSendModal, openLockModal, openWrapModal, openUnwrapModal, handleUnregisterToken, rewardDetailsLoading, handleClaimRewards, handleWithdrawFromBackend }) => {

    const { theme } = useTheme();
    const [showBalanceBreakdown, setShowBalanceBreakdown] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [locksExpanded, setLocksExpanded] = useState(false);

    // Debug logging for wrap/unwrap buttons
    console.log('TokenCard Debug:', {
        symbol: token.symbol,
        ledger_canister_id: token.ledger_canister_id,
        available: token.available?.toString(),
        GLDT_CANISTER_ID,
        SGLDT_CANISTER_ID,
        isGLDT: token.ledger_canister_id === GLDT_CANISTER_ID,
        isSGLDT: token.ledger_canister_id === SGLDT_CANISTER_ID,
        hasAvailable: token.available > 0n,
        hideButtons,
        openWrapModal: typeof openWrapModal,
        openUnwrapModal: typeof openUnwrapModal
    });

    function getTokenLockUrl(ledger, locks) {
        const baseUrl = '/tokenlock';
        const lockIds = !locks || locks.length < 1 ? "" : locks.map(lock => lock.lock_id).join(',');
        const locksParam = lockIds.length < 1 ? "" : `&locks=${lockIds}`;
        const url = `${baseUrl}?ledger=${ledger}${locksParam}`;
        return url;
    }

    const handleHeaderClick = () => {
        setIsExpanded(!isExpanded);
    };

    return (
        <div className="card">
            <div className="card-header" onClick={handleHeaderClick}>
                <div className="header-logo-column">
                    <img src={token.logo} alt={token.symbol} className="token-logo" />
                </div>
                <div className="header-content-column">
                    <div className="header-row-1">
                        <span className="token-name">{token.name || token.symbol}</span>
                        <span className="token-usd-value">
                            {(token.available || 0n) > 0n && token.conversion_rate > 0 && 
                                `$${formatAmountWithConversion(token.available || 0n, token.decimals, token.conversion_rate)}`
                            }
                        </span>
                    </div>
                    <div className="header-row-2">
                        <div className="amount-symbol">
                            <span className="token-amount">{formatAmount(token.available || 0n, token.decimals)}</span>
                            <span className="token-symbol">{token.symbol}</span>
                        </div>
                        <span className="expand-indicator">{isExpanded ? '▼' : '▶'}</span>
                    </div>
                </div>
            </div>
            {isExpanded && (
                <>
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
            <div className="balance-section">
                {!hideAvailable && (
                    <>
                        <div className="balance-item">
                            <div className="balance-label">Total</div>
                            <div className="balance-value">${formatAmountWithConversion(availableOrZero(token.available) + token.locked + rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals, token.conversion_rate, 2)}</div>
                        </div>
                        <div className="balance-item" style={{ cursor: 'pointer' }} onClick={() => setShowBalanceBreakdown(!showBalanceBreakdown)}>
                            <div className="balance-label">
                                Available {showBalanceBreakdown ? '▼' : '▶'}
                            </div>
                            <div className="balance-value">{formatAmount(token.available || 0n, token.decimals)}{getUSD(token.available || 0n, token.decimals, token.conversion_rate)}</div>
                        </div>
                        
                        {showBalanceBreakdown && (
                            <div className="balance-breakdown" style={{ 
                                marginLeft: '20px', 
                                padding: '10px', 
                                background: theme.colors.tertiaryBg, 
                                borderRadius: '4px',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                <div className="balance-breakdown-item" style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    marginBottom: '8px'
                                }}>
                                    <div>
                                        <div style={{ fontSize: '12px', color: '#bdc3c7' }}>Frontend Wallet</div>
                                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'white' }}>
                                            {formatAmount(token.balance || 0n, token.decimals)} {token.symbol}
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="balance-breakdown-item">
                                    <div style={{ fontSize: '12px', color: '#bdc3c7' }}>Backend Wallet</div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'white' }}>
                                        {formatAmount(token.available_backend || 0n, token.decimals)} {token.symbol}
                                    </div>
                                    {(() => {
                                        const shouldShowButton = token.available_backend > 0n && !hideButtons;
                                        console.log('Withdraw button debug:', {
                                            symbol: token.symbol,
                                            available_backend: token.available_backend?.toString(),
                                            available_backend_bigint: typeof token.available_backend,
                                            is_greater_than_zero: token.available_backend > 0n,
                                            hideButtons,
                                            shouldShowButton,
                                            handleWithdrawFromBackend: typeof handleWithdrawFromBackend
                                        });
                                        
                                        return shouldShowButton ? (
                                            <div
                                                onClick={(e) => {
                                                    console.log('Withdraw button clicked!');
                                                    e.stopPropagation();
                                                    handleWithdrawFromBackend(token);
                                                }}
                                                style={{
                                                    padding: '6px 10px',
                                                    fontSize: '12px',
                                                    background: theme.colors.accent,
                                                    color: theme.colors.primaryBg,
                                                    border: `1px solid ${theme.colors.accentHover}`,
                                                    borderRadius: '3px',
                                                    cursor: 'pointer',
                                                    marginTop: '4px',
                                                    display: 'inline-block',
                                                    textAlign: 'center',
                                                    userSelect: 'none'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.target.style.background = theme.colors.accentHover;
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.target.style.background = theme.colors.accent;
                                                }}
                                            >
                                                Withdraw
                                            </div>
                                        ) : null;
                                    })()}
                                </div>
                            </div>
                        )}
                    </>
                )}
                <div className="balance-item">
                    <div className="balance-label">Locked</div>
                    <div className="balance-value">{formatAmount(token.locked || 0n, token.decimals)}{getUSD(token.locked || 0n, token.decimals, token.conversion_rate)}</div>
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
                    <p>Frontend: {formatAmount(token.balance || 0n, token.decimals)}</p>
                    <p>Backend: {formatAmount(token.balance_backend || 0n, token.decimals)}</p>
                </div>
            )}
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
                        {lockDetailsLoading[token.ledger_canister_id] ? (
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                (Loading...)
                            </span>
                        ) : (
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                ({locks[token.ledger_canister_id]?.length || 0} {locks[token.ledger_canister_id]?.length === 1 ? 'lock' : 'locks'})
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Lock Button */}
                        {token.available > 0n && !hideButtons && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openLockModal(token);
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
                        )}
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
                        {lockDetailsLoading[token.ledger_canister_id] ? (
                            <div className="spinner-container">
                                <div className="spinner"></div>
                            </div>
                        ) : (
                            <>
                                {locks[token.ledger_canister_id] && locks[token.ledger_canister_id].length > 0 ? (
                                    locks[token.ledger_canister_id].map((lock, lockIndex) => (
                                        <div key={lockIndex} className="lock-item">
                                            <div className="lock-details">
                                                <span className="lock-label">Amount:</span>
                                                <span className="lock-value">{formatAmount(lock.amount || 0n, token.decimals)}{getUSD(lock.amount || 0n, token.decimals, token.conversion_rate)}</span>
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
                                    <p style={{ color: theme.colors.mutedText, fontStyle: 'italic', margin: '10px 0' }}>
                                        No locks found
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
            
            {/* Wrap/Unwrap buttons at bottom of card */}
            {(() => {
                const ledgerIdText = token.ledger_canister_id?.toText?.() || token.ledger_canister_id;
                const isGLDT = ledgerIdText === GLDT_CANISTER_ID;
                const isSGLDT = ledgerIdText === SGLDT_CANISTER_ID;
                
                /*console.log(`Wrap/Unwrap button check for ${token.symbol}:`, {
                    ledger_id_text: ledgerIdText,
                    isGLDT,
                    isSGLDT,
                    available: token.available?.toString(),
                    hasAvailable: token.available > 0n
                });*/
                
                if ((isGLDT || isSGLDT) && token.available > 0n && !hideButtons) {
                    return (
                        <div className="wrap-unwrap-section" style={{ marginTop: '10px', padding: '10px 0', borderTop: `1px solid ${theme.colors.border}` }}>
                            {isGLDT && (
                                <button 
                                    className="wrap-button-full" 
                                    onClick={() => openWrapModal(token)}
                                    style={{
                                        width: '100%',
                                        padding: '8px 16px',
                                        background: theme.colors.success,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    Wrap to sGLDT
                                </button>
                            )}
                            {isSGLDT && (
                                <button 
                                    className="unwrap-button-full" 
                                    onClick={() => openUnwrapModal(token)}
                                    style={{
                                        width: '100%',
                                        padding: '8px 16px',
                                        background: theme.colors.warning,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    Unwrap to GLDT
                                </button>
                            )}
                        </div>
                    );
                }
                return null;
            })()}
                </>
            )}
        </div>
    );
};

export default TokenCard;