import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../AuthContext';
import { setNeuronNickname } from '../utils/BackendUtils';

const NeuronNicknameDialog = ({ 
    isOpen, 
    onClose, 
    neuronId,
    snsRoot,
    currentNickname = '',
    onSuccess = null 
}) => {
    const { identity } = useAuth();
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

    // Validate nickname input (same validation as principal nicknames)
    const validateNameInput = (input) => {
        if (!input) return ''; // Empty is allowed (removes nickname)
        
        if (input.length > 32) {
            return 'Nickname must be 32 characters or less';
        }
        
        // Check for invalid characters
        const invalidChars = /[<>'"&]/;
        if (invalidChars.test(input)) {
            return 'Nickname cannot contain < > \' " & characters';
        }
        
        return '';
    };

    // Handle nickname submission
    const handleSubmit = async () => {
        if (!identity || !neuronId || !snsRoot) {
            setError('Authentication and neuron information required');
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
            const response = await setNeuronNickname(identity, snsRoot, neuronId, nicknameInput);
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
            console.error('Error setting neuron nickname:', err);
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
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10001
        }}>
            <div style={{
                backgroundColor: '#2a2a2a',
                borderRadius: '8px',
                padding: '20px',
                width: '90%',
                maxWidth: '400px',
                boxSizing: 'border-box'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ color: '#ffffff', margin: 0 }}>
                        {currentNickname ? 'Edit Neuron Nickname' : 'Set Neuron Nickname'}
                    </h3>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#888',
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
                        backgroundColor: 'rgba(231, 76, 60, 0.2)',
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
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
                        color: '#ffffff', 
                        display: 'block', 
                        marginBottom: '8px',
                        fontSize: '14px'
                    }}>
                        Private Neuron Nickname
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
                            backgroundColor: '#3a3a3a',
                            border: `1px solid ${error ? '#e74c3c' : '#4a4a4a'}`,
                            borderRadius: '4px',
                            color: '#ffffff',
                            fontSize: '14px',
                            boxSizing: 'border-box'
                        }}
                        autoFocus
                    />
                    <div style={{
                        color: '#888',
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
                            backgroundColor: '#6c757d',
                            color: '#ffffff',
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
                            backgroundColor: (!isSubmitting && !error) ? '#3498db' : '#6c757d',
                            color: '#ffffff',
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
                                🧠 Save Nickname
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default NeuronNicknameDialog;
