import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { setPrincipalNickname, getPrincipalNickname } from '../utils/BackendUtils';

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
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: theme.colors.modalBg,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10001
        }}>
            <div style={{
                background: theme.colors.cardGradient,
                border: `1px solid ${theme.colors.border}`,
                boxShadow: theme.colors.cardShadow,
                borderRadius: '8px',
                padding: '20px',
                width: '90%',
                maxWidth: '400px'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ color: theme.colors.primaryText, margin: 0 }}>
                        {currentNickname ? 'Edit Nickname' : 'Set Nickname'}
                    </h3>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: theme.colors.mutedText,
                            fontSize: '24px',
                            cursor: 'pointer',
                            padding: '0',
                            width: '30px',
                            height: '30px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        ×
                    </button>
                </div>

                {error && (
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.error}20, ${theme.colors.error}10)`,
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '10px',
                        borderRadius: '4px',
                        marginBottom: '15px',
                        fontSize: '14px'
                    }}>
                        {error}
                    </div>
                )}

                <div style={{ marginBottom: '15px' }}>
                    <label style={{ 
                        color: theme.colors.primaryText, 
                        display: 'block', 
                        marginBottom: '8px',
                        fontSize: '14px'
                    }}>
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
                        placeholder="Enter private nickname (max 32 chars)"
                        style={{
                            width: '100%',
                            padding: '10px',
                            background: theme.colors.tertiaryBg,
                            border: `1px solid ${error ? theme.colors.error : theme.colors.border}`,
                            borderRadius: '4px',
                            color: theme.colors.primaryText,
                            fontSize: '14px'
                        }}
                        autoFocus
                    />
                    <div style={{
                        color: theme.colors.mutedText,
                        fontSize: '12px',
                        marginTop: '4px'
                    }}>
                        Only you can see this nickname. Leave empty to remove.
                    </div>
                </div>

                <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '10px'
                }}>
                    <button
                        onClick={onClose}
                        disabled={isSubmitting}
                        style={{
                            background: theme.colors.mutedText,
                            color: theme.colors.primaryBg,
                            border: 'none',
                            borderRadius: '6px',
                            padding: '10px 20px',
                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            opacity: isSubmitting ? 0.6 : 1
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !!error}
                        style={{
                            background: (!isSubmitting && !error) ? theme.colors.accent : theme.colors.mutedText,
                            color: theme.colors.primaryBg,
                            border: 'none',
                            borderRadius: '6px',
                            padding: '10px 20px',
                            cursor: (!isSubmitting && !error) ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        {isSubmitting ? (
                            <>
                                <span style={{ 
                                    display: 'inline-block',
                                    animation: 'spin 1s linear infinite',
                                    fontSize: '14px'
                                }}>⟳</span>
                                Saving...
                            </>
                        ) : (
                            <>
                                💾 Save Nickname
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default NicknameDialog;
