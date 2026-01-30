import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { setPrincipalNickname, getPrincipalNickname } from '../utils/BackendUtils';
import { FaTag, FaTimes, FaSpinner, FaSave, FaExclamationTriangle, FaInfoCircle } from 'react-icons/fa';

// Custom CSS animations
const customAnimations = `
@keyframes nicknameDialogFadeIn {
    from { opacity: 0; transform: scale(0.95) translateY(-10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes nicknameDialogSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
.nickname-dialog-animate {
    animation: nicknameDialogFadeIn 0.25s ease-out forwards;
}
.nickname-dialog-spin {
    animation: nicknameDialogSpin 1s linear infinite;
}
`;

const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Accent colors for the dialog
const nicknamePrimary = '#9b59b6';
const nicknameSecondary = '#8e44ad';

const NicknameDialog = ({ 
    isOpen, 
    onClose, 
    principalId, 
    currentNickname = '',
    onSuccess = null 
}) => {
    const { identity } = useAuth();
    const { theme } = useTheme();
    const [nicknameInput, setNicknameInput] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Reset form when dialog opens/closes or initial values change
    useEffect(() => {
        if (isOpen) {
            setNicknameInput(currentNickname || '');
            setError('');
        }
    }, [isOpen, currentNickname]);

    // Validate nickname input
    const validateNameInput = (input) => {
        if (!input) return ''; // Empty is allowed (removes nickname)
        
        if (input.length > 32) {
            return 'Nickname must be 32 characters or less';
        }
        
        // Check for invalid characters (same validation as in Principal.jsx)
        const invalidChars = /[<>'"&]/;
        if (invalidChars.test(input)) {
            return 'Nickname cannot contain < > \' " & characters';
        }
        
        return '';
    };

    // Handle nickname submission
    const handleSubmit = async () => {
        if (!identity || !principalId) {
            setError('Authentication required');
            return;
        }

        const validationError = validateNameInput(nicknameInput);
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSubmitting(true);
        setError('');

        try {
            const response = await setPrincipalNickname(identity, principalId, nicknameInput);
            if ('ok' in response) {
                // Success
                if (onSuccess) {
                    onSuccess(nicknameInput.trim() || null);
                }
                onClose();
            } else {
                setError(response.err || 'Failed to set nickname');
            }
        } catch (err) {
            console.error('Error setting principal nickname:', err);
            setError('Failed to set nickname: ' + (err.message || err.toString()));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle form submission (Enter key)
    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <>
            <style>{customAnimations}</style>
            <div 
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.7)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 10001,
                    padding: '1rem'
                }}
                onClick={onClose}
            >
                <div 
                    className="nickname-dialog-animate"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        background: `linear-gradient(180deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
                        borderRadius: '16px',
                        width: '100%',
                        maxWidth: '420px',
                        overflow: 'hidden',
                        border: `1px solid ${theme.colors.border}`,
                        fontFamily: SYSTEM_FONT,
                        boxShadow: `0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px ${nicknamePrimary}20`
                    }}
                >
                    {/* Modal Header */}
                    <div style={{ 
                        background: `linear-gradient(135deg, ${nicknamePrimary}20, ${nicknameSecondary}10)`,
                        borderBottom: `1px solid ${theme.colors.border}`,
                        padding: '1.25rem 1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem'
                    }}>
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            background: `linear-gradient(135deg, ${nicknamePrimary}, ${nicknameSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 4px 15px ${nicknamePrimary}40`,
                            flexShrink: 0
                        }}>
                            <FaTag size={18} color="white" />
                        </div>
                        <div style={{ flex: 1 }}>
                            <h2 style={{ 
                                color: theme.colors.primaryText, 
                                margin: 0, 
                                fontSize: '1.25rem', 
                                fontWeight: '600' 
                            }}>
                                {currentNickname ? 'Edit Nickname' : 'Set Nickname'}
                            </h2>
                            <p style={{ 
                                color: theme.colors.mutedText, 
                                margin: '0.25rem 0 0 0', 
                                fontSize: '0.85rem' 
                            }}>
                                Create a private label for this address
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            disabled={isSubmitting}
                            style={{
                                width: '36px',
                                height: '36px',
                                borderRadius: '10px',
                                background: theme.colors.tertiaryBg,
                                border: `1px solid ${theme.colors.border}`,
                                color: theme.colors.mutedText,
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <FaTimes size={14} />
                        </button>
                    </div>

                    {/* Modal Body */}
                    <div style={{ padding: '1.5rem' }}>
                        {/* Error Message */}
                        {error && (
                            <div style={{
                                background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}08)`,
                                border: `1px solid ${theme.colors.error}40`,
                                borderRadius: '10px',
                                padding: '0.875rem 1rem',
                                marginBottom: '1.25rem',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '0.75rem'
                            }}>
                                <FaExclamationTriangle size={14} color={theme.colors.error} style={{ marginTop: '2px', flexShrink: 0 }} />
                                <span style={{ 
                                    color: theme.colors.error, 
                                    fontSize: '0.875rem',
                                    lineHeight: '1.4'
                                }}>
                                    {error}
                                </span>
                            </div>
                        )}

                        {/* Input Field */}
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ 
                                color: theme.colors.primaryText, 
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginBottom: '0.75rem',
                                fontSize: '0.9rem',
                                fontWeight: '600'
                            }}>
                                <FaTag size={12} style={{ color: nicknamePrimary }} />
                                Private Nickname
                            </label>
                            <input
                                type="text"
                                value={nicknameInput}
                                onChange={(e) => {
                                    const newValue = e.target.value;
                                    setNicknameInput(newValue);
                                    const validationError = validateNameInput(newValue);
                                    setError(validationError);
                                }}
                                onKeyPress={handleKeyPress}
                                maxLength={32}
                                placeholder="Enter a nickname (max 32 characters)"
                                style={{
                                    width: '100%',
                                    padding: '0.875rem 1rem',
                                    background: theme.colors.tertiaryBg,
                                    border: `1px solid ${error ? theme.colors.error : theme.colors.border}`,
                                    borderRadius: '10px',
                                    color: theme.colors.primaryText,
                                    fontSize: '0.95rem',
                                    fontFamily: SYSTEM_FONT,
                                    outline: 'none',
                                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                                    boxSizing: 'border-box'
                                }}
                                onFocus={(e) => {
                                    if (!error) {
                                        e.target.style.borderColor = nicknamePrimary;
                                        e.target.style.boxShadow = `0 0 0 3px ${nicknamePrimary}20`;
                                    }
                                }}
                                onBlur={(e) => {
                                    e.target.style.borderColor = error ? theme.colors.error : theme.colors.border;
                                    e.target.style.boxShadow = 'none';
                                }}
                                autoFocus
                            />
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginTop: '0.5rem'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.375rem',
                                    color: theme.colors.mutedText,
                                    fontSize: '0.8rem'
                                }}>
                                    <FaInfoCircle size={11} />
                                    <span>Only visible to you. Leave empty to remove.</span>
                                </div>
                                <span style={{
                                    color: nicknameInput.length > 28 ? theme.colors.warning : theme.colors.mutedText,
                                    fontSize: '0.8rem',
                                    fontWeight: '500'
                                }}>
                                    {nicknameInput.length}/32
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Modal Footer */}
                    <div style={{
                        borderTop: `1px solid ${theme.colors.border}`,
                        padding: '1rem 1.5rem',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: '0.75rem',
                        background: theme.colors.primaryBg
                    }}>
                        <button
                            onClick={onClose}
                            disabled={isSubmitting}
                            style={{
                                background: theme.colors.tertiaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '10px',
                                padding: '0.75rem 1.25rem',
                                fontSize: '0.9rem',
                                fontWeight: '500',
                                fontFamily: SYSTEM_FONT,
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                opacity: isSubmitting ? 0.6 : 1,
                                transition: 'all 0.2s ease'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting || !!error}
                            style={{
                                background: (!isSubmitting && !error) 
                                    ? `linear-gradient(135deg, ${nicknamePrimary}, ${nicknameSecondary})`
                                    : theme.colors.mutedText,
                                color: 'white',
                                border: 'none',
                                borderRadius: '10px',
                                padding: '0.75rem 1.5rem',
                                fontSize: '0.9rem',
                                fontWeight: '600',
                                fontFamily: SYSTEM_FONT,
                                cursor: (!isSubmitting && !error) ? 'pointer' : 'not-allowed',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                boxShadow: (!isSubmitting && !error) ? `0 4px 15px ${nicknamePrimary}40` : 'none',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            {isSubmitting ? (
                                <>
                                    <FaSpinner size={14} className="nickname-dialog-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <FaSave size={14} />
                                    Save Nickname
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </>,
        document.body
    );
};

export default NicknameDialog;
