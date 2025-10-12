import React, { useState, useEffect } from 'react';
import { useTheme } from './contexts/ThemeContext';
import { formatAmount } from './utils/StringUtils';
import ConfirmationModal from './ConfirmationModal';

function ClaimFeesModal({ show, onClose, onClaim, position, unclaimedFees, token0Fee, token1Fee }) {
    const { theme } = useTheme();
    const [token0Amount, setToken0Amount] = useState('');
    const [token1Amount, setToken1Amount] = useState('');
    const [claimAndWithdraw, setClaimAndWithdraw] = useState(true);
    const [isClaiming, setIsClaiming] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [isInitialized, setIsInitialized] = useState(false);

    // Calculate max withdrawable amounts (claimable - 1 tx fee)
    const getMaxWithdrawable = (claimableAmount, fee, decimals) => {
        // Ensure we have at least enough for the fee
        if (claimableAmount <= fee) {
            return 0n;
        }
        const maxAmount = claimableAmount - fee;
        return maxAmount;
    };

    const max0 = unclaimedFees ? getMaxWithdrawable(unclaimedFees.token0Amount, token0Fee || 0n, position.token0Decimals) : 0n;
    const max1 = unclaimedFees ? getMaxWithdrawable(unclaimedFees.token1Amount, token1Fee || 0n, position.token1Decimals) : 0n;

    // When modal opens, set defaults to max available (only once)
    useEffect(() => {
        if (show && unclaimedFees && !isInitialized) {
            setToken0Amount(formatAmount(max0, position.token0Decimals));
            setToken1Amount(formatAmount(max1, position.token1Decimals));
            setClaimAndWithdraw(true); // Default to Claim & Withdraw
            setErrorText('');
            setIsInitialized(true);
        } else if (!show && isInitialized) {
            // Reset when modal closes
            setIsInitialized(false);
        }
    }, [show, unclaimedFees, position, isInitialized, max0, max1]);

    if (!show) return null;

    const handleSetMax0 = () => {
        setToken0Amount(formatAmount(max0, position.token0Decimals));
    };

    const handleSetMax1 = () => {
        setToken1Amount(formatAmount(max1, position.token1Decimals));
    };

    const handleClaim = async () => {
        try {
            setIsClaiming(true);
            setShowConfirm(false);
            setErrorText('');

            let token0AmountBigInt = 0n;
            let token1AmountBigInt = 0n;

            // Convert string amounts to BigInt (in base units)
            // Ensure decimals is a regular number, not BigInt
            const decimals0 = typeof position.token0Decimals === 'bigint' 
                ? Number(position.token0Decimals) 
                : position.token0Decimals;
            const decimals1 = typeof position.token1Decimals === 'bigint' 
                ? Number(position.token1Decimals) 
                : position.token1Decimals;

            token0AmountBigInt = BigInt(Math.floor(parseFloat(token0Amount || '0') * Math.pow(10, decimals0)));
            token1AmountBigInt = BigInt(Math.floor(parseFloat(token1Amount || '0') * Math.pow(10, decimals1)));

            // Validate amounts if we're doing claim & withdraw
            if (claimAndWithdraw) {
                // Check if amounts are above minimum (1 tx fee)
                const token0Valid = token0AmountBigInt >= (token0Fee || 0n);
                const token1Valid = token1AmountBigInt >= (token1Fee || 0n);

                // If both are too small, show error
                if (!token0Valid && !token1Valid) {
                    setErrorText(`Both amounts are below minimum. Minimum: ${formatAmount(token0Fee, position.token0Decimals)} ${position.token0Symbol}, ${formatAmount(token1Fee, position.token1Decimals)} ${position.token1Symbol}`);
                    setIsClaiming(false);
                    return;
                }

                // If one is too small, set it to 0 (skip it)
                if (!token0Valid) {
                    token0AmountBigInt = 0n;
                    console.log(`Token0 amount below minimum fee, skipping withdrawal`);
                }
                if (!token1Valid) {
                    token1AmountBigInt = 0n;
                    console.log(`Token1 amount below minimum fee, skipping withdrawal`);
                }
            }

            await onClaim({
                token0Amount: token0AmountBigInt,
                token1Amount: token1AmountBigInt,
                claimAndWithdraw: claimAndWithdraw
            });
            
            onClose();
        } catch (error) {
            console.error('Error claiming fees:', error);
            setErrorText(`Failed to claim fees: ${error.message || error.toString()}`);
        } finally {
            setIsClaiming(false);
        }
    };

    return (
        <>
            <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
            }}>
                <div style={{
                    background: theme.colors.secondaryBg,
                    padding: '30px',
                    borderRadius: '12px',
                    maxWidth: '500px',
                    width: '90%',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                }}>
                    <h2 style={{
                        margin: '0 0 20px 0',
                        color: theme.colors.text,
                        fontSize: '1.5rem',
                        fontWeight: '600',
                    }}>
                        Claim Trading Fees
                    </h2>

                    <p style={{
                        color: theme.colors.secondaryText,
                        marginBottom: '20px',
                        fontSize: '0.95rem',
                    }}>
                        Position #{position.positionId} ({position.token0Symbol}/{position.token1Symbol})
                    </p>

                    {/* Claim Mode Selection */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            color: theme.colors.text,
                            marginBottom: '10px',
                            fontSize: '0.9rem',
                            fontWeight: '500',
                        }}>
                            Action
                        </label>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => setClaimAndWithdraw(true)}
                                disabled={isClaiming}
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: '6px',
                                    border: `2px solid ${claimAndWithdraw ? theme.colors.success : theme.colors.border}`,
                                    background: claimAndWithdraw ? `${theme.colors.success}20` : 'transparent',
                                    color: claimAndWithdraw ? theme.colors.success : theme.colors.text,
                                    cursor: isClaiming ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: claimAndWithdraw ? '600' : '500',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                Claim & Withdraw
                            </button>
                            <button
                                onClick={() => setClaimAndWithdraw(false)}
                                disabled={isClaiming}
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: '6px',
                                    border: `2px solid ${!claimAndWithdraw ? theme.colors.accent : theme.colors.border}`,
                                    background: !claimAndWithdraw ? `${theme.colors.accent}20` : 'transparent',
                                    color: !claimAndWithdraw ? theme.colors.accent : theme.colors.text,
                                    cursor: isClaiming ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: !claimAndWithdraw ? '600' : '500',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                Claim Only
                            </button>
                        </div>
                        <p style={{
                            fontSize: '0.8rem',
                            color: theme.colors.secondaryText,
                            marginTop: '6px',
                        }}>
                            {claimAndWithdraw 
                                ? 'Claims all fees and withdraws specified amounts to your wallet'
                                : 'Claims all fees to swap canister balance (amounts specify what to withdraw later)'}
                        </p>
                    </div>

                    {/* Withdrawal Amounts */}
                    <div style={{ 
                        marginBottom: '15px',
                        padding: '12px',
                        borderRadius: '8px',
                        background: `${theme.colors.border}20`,
                    }}>
                        <div style={{
                            fontSize: '0.85rem',
                            color: theme.colors.secondaryText,
                            marginBottom: '12px',
                            fontWeight: '500',
                        }}>
                            {claimAndWithdraw ? 'Amounts to Withdraw Now' : 'Amounts (for future withdrawal)'}
                        </div>
                    {/* Token 0 Amount */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            color: theme.colors.text,
                            marginBottom: '8px',
                            fontSize: '0.9rem',
                            fontWeight: '500',
                        }}>
                            {position.token0Symbol} Amount
                        </label>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input
                                type="number"
                                value={token0Amount}
                                onChange={(e) => setToken0Amount(e.target.value)}
                                placeholder="0.0"
                                disabled={isClaiming}
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: '6px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.primaryBg,
                                    color: theme.colors.text,
                                    fontSize: '1rem',
                                }}
                            />
                            <button
                                onClick={handleSetMax0}
                                disabled={isClaiming}
                                style={{
                                    padding: '10px 16px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: theme.colors.accent,
                                    color: theme.colors.primaryBg,
                                    cursor: isClaiming ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                }}
                            >
                                MAX
                            </button>
                        </div>
                        <div style={{
                            fontSize: '0.8rem',
                            color: theme.colors.secondaryText,
                            marginTop: '4px',
                        }}>
                            Available: {formatAmount(unclaimedFees.token0Amount, position.token0Decimals)} {position.token0Symbol}
                            <br />
                            Max withdrawable: {formatAmount(max0, position.token0Decimals)} {position.token0Symbol}
                        </div>
                    </div>

                    {/* Token 1 Amount */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            color: theme.colors.text,
                            marginBottom: '8px',
                            fontSize: '0.9rem',
                            fontWeight: '500',
                        }}>
                            {position.token1Symbol} Amount
                        </label>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input
                                type="number"
                                value={token1Amount}
                                onChange={(e) => setToken1Amount(e.target.value)}
                                placeholder="0.0"
                                disabled={isClaiming}
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: '6px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.primaryBg,
                                    color: theme.colors.text,
                                    fontSize: '1rem',
                                }}
                            />
                            <button
                                onClick={handleSetMax1}
                                disabled={isClaiming}
                                style={{
                                    padding: '10px 16px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: theme.colors.accent,
                                    color: theme.colors.primaryBg,
                                    cursor: isClaiming ? 'not-allowed' : 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                }}
                            >
                                MAX
                            </button>
                        </div>
                        <div style={{
                            fontSize: '0.8rem',
                            color: theme.colors.secondaryText,
                            marginTop: '4px',
                        }}>
                            Available: {formatAmount(unclaimedFees.token1Amount, position.token1Decimals)} {position.token1Symbol}
                            <br />
                            Max withdrawable: {formatAmount(max1, position.token1Decimals)} {position.token1Symbol}
                        </div>
                    </div>
                    </div>

                    {errorText && (
                        <div style={{
                            padding: '10px',
                            marginBottom: '15px',
                            borderRadius: '6px',
                            background: `${theme.colors.error}20`,
                            border: `1px solid ${theme.colors.error}`,
                            color: theme.colors.error,
                            fontSize: '0.9rem',
                        }}>
                            {errorText}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px', marginTop: '25px' }}>
                        <button
                            onClick={onClose}
                            disabled={isClaiming}
                            style={{
                                flex: 1,
                                padding: '12px',
                                borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`,
                                background: 'transparent',
                                color: theme.colors.text,
                                cursor: isClaiming ? 'not-allowed' : 'pointer',
                                fontSize: '1rem',
                                fontWeight: '500',
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => setShowConfirm(true)}
                            disabled={isClaiming}
                            style={{
                                flex: 1,
                                padding: '12px',
                                borderRadius: '8px',
                                border: 'none',
                                background: theme.colors.success,
                                color: theme.colors.primaryBg,
                                cursor: isClaiming ? 'not-allowed' : 'pointer',
                                fontSize: '1rem',
                                fontWeight: '600',
                                opacity: isClaiming ? 0.6 : 1,
                            }}
                        >
                            {isClaiming ? 'Claiming...' : (claimAndWithdraw ? 'Claim & Withdraw' : 'Claim Only')}
                        </button>
                    </div>
                </div>
            </div>

            <ConfirmationModal
                show={showConfirm}
                onClose={() => setShowConfirm(false)}
                onSubmit={handleClaim}
                message={claimAndWithdraw 
                    ? `You are about to claim all fees and withdraw:\n• ${token0Amount} ${position.token0Symbol}\n• ${token1Amount} ${position.token1Symbol}\n\nThese amounts will be transferred to your wallet. Continue?`
                    : `You are about to claim all fees from position #${position.positionId}.\n\nAll fees will be moved to your swap canister balance.\nYou can withdraw ${token0Amount || '0'} ${position.token0Symbol} and ${token1Amount || '0'} ${position.token1Symbol} later. Continue?`
                }
                doAwait={true}
            />
        </>
    );
}

export default ClaimFeesModal;

