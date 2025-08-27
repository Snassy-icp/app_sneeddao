// LockPositionModal.jsx
import React, { useState, useEffect } from 'react';
import './LockPositionModal.css';
import ConfirmationModal from './ConfirmationModal';
import { get_short_timezone, format_duration, dateToReadable, getInitialExpiry } from './utils/DateUtils';
import { useTheme } from './contexts/ThemeContext';

function LockPositionModal({ show, onClose, liquidityPosition, onAddLockPosition }) {    
    const { theme } = useTheme();
    const [newLockPositionExpiry, setNewLockPositionExpiry] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');

    useEffect(() => {
        if (show) {
            setNewLockPositionExpiry(getInitialExpiry());
            setErrorText('');
        }
    }, [show]);

    if (!show) {
        return null;
    }

    const handleAddLockPosition = async () => {
        setErrorText('');
        
        if (newLockPositionExpiry == "") {
            setErrorText("Please enter expiration first!");
            return;
        }

        if (new Date(newLockPositionExpiry) < new Date()) {
            setErrorText("Please enter expiration in the future!");
            return;
        }

        setConfirmAction(() => async () => {
            try {
                setIsLoading(true);
                setErrorText('');
                const result = await onAddLockPosition(liquidityPosition, new Date(newLockPositionExpiry).getTime());
                if (result["Err"]) {
                    const error_text = result["Err"].message;
                    setErrorText(error_text);
                } else {
                    setNewLockPositionExpiry('');
                    onClose();
                }
            } catch (error) {
                setErrorText('Error adding lock position: ' + error.toString());
            }
            finally {
                setIsLoading(false);
            }
        });

        setConfirmMessage(
            `You are about to lock position #${liquidityPosition.id.toString()} of ${liquidityPosition.symbols} ` +
            `until ${dateToReadable(new Date(newLockPositionExpiry))} ${get_short_timezone()} ` +
            `(for ${format_duration(new Date(newLockPositionExpiry) - new Date())}).`
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
                    Lock {liquidityPosition.symbols} #{liquidityPosition.id.toString()}
                </h2>
                
                {isLoading ? (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        padding: '40px 20px'
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
                    <div>
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
                                Expiration ({get_short_timezone()}):
                            </label>
                            <input
                                type="datetime-local"
                                value={newLockPositionExpiry}
                                onChange={(e) => setNewLockPositionExpiry(e.target.value)}
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

                        <div style={{
                            display: 'flex',
                            gap: '12px',
                            marginTop: '24px'
                        }}>
                            <button 
                                onClick={handleAddLockPosition}
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

export default LockPositionModal;