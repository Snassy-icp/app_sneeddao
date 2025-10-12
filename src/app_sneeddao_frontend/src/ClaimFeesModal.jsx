import React, { useState, useEffect } from 'react';
import { useTheme } from './contexts/ThemeContext';
import { formatAmount } from './utils/StringUtils';
import ConfirmationModal from './ConfirmationModal';

function ClaimFeesModal({ show, onClose, onClaim, position, unclaimedFees }) {
    const { theme } = useTheme();
    const [token0Amount, setToken0Amount] = useState('');
    const [token1Amount, setToken1Amount] = useState('');
    const [isClaiming, setIsClaiming] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [errorText, setErrorText] = useState('');

    // When modal opens, set defaults to max available
    useEffect(() => {
        if (show && unclaimedFees) {
            setToken0Amount(formatAmount(unclaimedFees.token0Amount, position.token0Decimals));
            setToken1Amount(formatAmount(unclaimedFees.token1Amount, position.token1Decimals));
            setErrorText('');
        }
    }, [show, unclaimedFees, position]);

    if (!show) return null;

    const handleSetMax0 = () => {
        setToken0Amount(formatAmount(unclaimedFees.token0Amount, position.token0Decimals));
    };

    const handleSetMax1 = () => {
        setToken1Amount(formatAmount(unclaimedFees.token1Amount, position.token1Decimals));
    };

    const handleClaim = async () => {
        try {
            setIsClaiming(true);
            setShowConfirm(false);
            setErrorText('');

            // Convert string amounts to BigInt (in base units)
            const token0AmountBigInt = BigInt(Math.floor(parseFloat(token0Amount || '0') * Math.pow(10, position.token0Decimals)));
            const token1AmountBigInt = BigInt(Math.floor(parseFloat(token1Amount || '0') * Math.pow(10, position.token1Decimals)));

            await onClaim({
                token0Amount: token0AmountBigInt,
                token1Amount: token1AmountBigInt
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
                            disabled={isClaiming || (!parseFloat(token0Amount) && !parseFloat(token1Amount))}
                            style={{
                                flex: 1,
                                padding: '12px',
                                borderRadius: '8px',
                                border: 'none',
                                background: theme.colors.success,
                                color: theme.colors.primaryBg,
                                cursor: (isClaiming || (!parseFloat(token0Amount) && !parseFloat(token1Amount))) ? 'not-allowed' : 'pointer',
                                fontSize: '1rem',
                                fontWeight: '600',
                                opacity: (isClaiming || (!parseFloat(token0Amount) && !parseFloat(token1Amount))) ? 0.6 : 1,
                            }}
                        >
                            {isClaiming ? 'Claiming...' : 'Claim Fees'}
                        </button>
                    </div>
                </div>
            </div>

            <ConfirmationModal
                show={showConfirm}
                onClose={() => setShowConfirm(false)}
                onSubmit={handleClaim}
                message={`You are about to claim and withdraw trading fees:\n${token0Amount} ${position.token0Symbol}\n${token1Amount} ${position.token1Symbol}\n\nThe fees will be transferred to your wallet. Continue?`}
                doAwait={true}
            />
        </>
    );
}

export default ClaimFeesModal;

