// LockModal.jsx
import React, { useState, useEffect } from 'react';
import './LockModal.css';
import ConfirmationModal from './ConfirmationModal';
import { get_short_timezone, format_duration, dateToReadable, getInitialExpiry } from './utils/DateUtils';
import { formatAmount } from './utils/StringUtils';
import { useTheme } from './contexts/ThemeContext';

const SNEED_CANISTER_ID = 'hvgxa-wqaaa-aaaaq-aacia-cai';

function LockModal({ show, onClose, token, locks, onAddLock }) {
    const { theme } = useTheme();
    const [newLockAmount, setNewLockAmount] = useState('');
    const [newLockExpiry, setNewLockExpiry] = useState(getInitialExpiry());
    const [isLoading, setIsLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');

    useEffect(() => {
        if (show) {
            setNewLockExpiry(getInitialExpiry());
            setErrorText('');
        }
    }, [show]);

    if (!show) {
        return null;
    }

    const handleSetMax = () => {
        // example
        // balance: 200
        // locked: 100
        // available: 100
        // backend_available: 70
        // frontend_available: available - backend_available
        // max: backend_available + frontend_available - fee

        var max = token.available_backend;
        if (token.available > token.available_backend) {
            var frontend_max = (token.available - token.available_backend - token.fee);
            if (frontend_max < 0n) { frontend_max = 0n; }
            max += frontend_max;
        }

        if (max < 0n) { max = 0n; }
        setNewLockAmount(formatAmount(max, token.decimals));
    };
    
    const handleAddLock = async () => {
        setErrorText('');

        // Check if this is the SNEED token - it cannot be locked
        const tokenId = token.ledger_canister_id?.toText?.() || token.ledger_canister_id;
        if (tokenId === SNEED_CANISTER_ID) {
            setErrorText("SNEED tokens cannot be locked.");
            return;
        }

        if (newLockAmount == "") {
            setErrorText("Please enter an amount first!");
            return;
        }

        // Convert to BigInt safely - handle decimal inputs from formatAmount
        const amountFloat = parseFloat(newLockAmount);
        if (isNaN(amountFloat) || amountFloat <= 0) {
            setErrorText("Invalid amount! Please enter a positive amount.");
            return;
        }
        
        const scaledAmount = amountFloat * (10 ** token.decimals);
        const bigIntAmount = BigInt(Math.floor(scaledAmount));

        if (bigIntAmount > token.available_backend) {
            if (bigIntAmount > BigInt(token.available) - BigInt(token.fee)) {
                setErrorText("Insufficient available balance! Please enter an amount less than or equal to your available balance.");
                return;
            }
        }

        if (newLockExpiry == "") {
            setErrorText("Please enter expiration first!");
            return;
        }

        if (new Date(newLockExpiry) < new Date()) {
            setErrorText("Please enter expiration in the future!");
            return;
        }

        setConfirmAction(() => async () => {            
            try {
                setIsLoading(true);
                setErrorText('');
                const result = await onAddLock(token, newLockAmount, new Date(newLockExpiry).getTime());
                if (result["Err"]) {
                    var error_text = result["Err"].message;
                    setErrorText(error_text);
                } else {
                    setNewLockAmount('');
                    setNewLockExpiry('');
                    onClose();
                }
            } catch (error) {
                setErrorText('Error adding lock:', error);
            } finally {
                setIsLoading(false);
            }
        });

        setConfirmMessage(
            `You are about to lock ${newLockAmount} ${token.symbol} ` +
            `until ${dateToReadable(new Date(newLockExpiry))} ${get_short_timezone()} ` +
            `(for ${format_duration(new Date(newLockExpiry) - new Date())}).`
        );
        setShowConfirmModal(true);
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: theme.colors.modalBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        }}>
            <div style={{
                background: theme.colors.cardGradient,
                border: `1px solid ${theme.colors.border}`,
                boxShadow: theme.colors.cardShadow,
                borderRadius: '16px',
                padding: '32px',
                width: '450px',
                maxWidth: '90vw',
                maxHeight: '90vh',
                overflow: 'auto'
            }}>
                <h2 style={{
                    color: theme.colors.primaryText,
                    marginTop: '0',
                    marginBottom: '24px',
                    fontSize: '1.5rem',
                    fontWeight: '600'
                }}>
                    {token ? `Lock ${token.symbol}` : 'All Lock Details'}
                </h2>

                <h3 style={{
                    color: theme.colors.primaryText,
                    marginBottom: '20px',
                    fontSize: '1.2rem',
                    fontWeight: '500'
                }}>
                    Add New Lock
                </h3>
                
                <div style={{ marginBottom: '20px' }}>
                    <label style={{
                        display: 'block',
                        color: theme.colors.primaryText,
                        marginBottom: '8px',
                        fontWeight: '500'
                    }}>
                        Amount:
                    </label>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                    }}>
                        <input 
                            type="number"
                            placeholder="Amount"
                            value={newLockAmount}
                            onChange={(e) => setNewLockAmount(e.target.value)}
                            style={{
                                flex: '1',
                                padding: '12px',
                                background: theme.colors.secondaryBg,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                color: theme.colors.primaryText,
                                fontSize: '0.9rem',
                                boxSizing: 'border-box'
                            }}
                        />
                        <button 
                            onClick={handleSetMax}
                            style={{
                                background: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '8px',
                                padding: '12px 16px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: '600',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.accentHover;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.accent;
                            }}
                        >
                            MAX
                        </button>
                    </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{
                        display: 'block',
                        color: theme.colors.primaryText,
                        marginBottom: '8px',
                        fontWeight: '500'
                    }}>
                        Expiration ({get_short_timezone()}):
                    </label>
                    <input
                        type="datetime-local"
                        value={newLockExpiry}
                        onChange={(e) => setNewLockExpiry(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: theme.colors.secondaryBg,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: '8px',
                            color: theme.colors.primaryText,
                            fontSize: '0.9rem',
                            boxSizing: 'border-box'
                        }}
                    />
                </div>

                {errorText && (
                    <p style={{
                        color: theme.colors.error,
                        marginBottom: '20px',
                        padding: '12px',
                        background: `${theme.colors.error}15`,
                        border: `1px solid ${theme.colors.error}30`,
                        borderRadius: '8px',
                        fontSize: '0.9rem'
                    }}>
                        {errorText}
                    </p>
                )}

                {isLoading ? (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        padding: '20px'
                    }}>
                        <div className="spinner" style={{
                            width: '24px',
                            height: '24px',
                            border: `3px solid ${theme.colors.border}`,
                            borderTop: `3px solid ${theme.colors.accent}`,
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }}></div>
                    </div>
                ) : (
                    <div style={{
                        display: 'flex',
                        gap: '12px',
                        marginTop: '24px'
                    }}>
                        <button 
                            onClick={handleAddLock}
                            style={{
                                flex: '1',
                                background: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '8px',
                                padding: '12px 24px',
                                cursor: 'pointer',
                                fontSize: '0.95rem',
                                fontWeight: '600',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.accentHover;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.accent;
                            }}
                        >
                            Add Lock
                        </button>
                        <button 
                            onClick={onClose}
                            style={{
                                flex: '1',
                                background: theme.colors.secondaryBg,
                                color: theme.colors.mutedText,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                padding: '12px 24px',
                                cursor: 'pointer',
                                fontSize: '0.95rem',
                                fontWeight: '500',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.tertiaryBg;
                                e.target.style.color = theme.colors.primaryText;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.secondaryBg;
                                e.target.style.color = theme.colors.mutedText;
                            }}
                        >
                            Close
                        </button>
                    </div>
                )}
            </div>
            <ConfirmationModal
                show={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onSubmit={confirmAction}
                message={confirmMessage}
                doAwait={false}
            />
        </div>
    );
}

export default LockModal;