import React, { useState, useEffect } from 'react';
import { Principal } from '@dfinity/principal';

const TipModal = ({ 
    isOpen, 
    onClose, 
    onTip, 
    post, 
    isSubmitting,
    availableTokens = [], // Array of {principal, symbol, decimals, balance}
    userPrincipal
}) => {
    const [selectedToken, setSelectedToken] = useState('');
    const [amount, setAmount] = useState('');
    const [error, setError] = useState('');

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setSelectedToken(availableTokens.length > 0 ? availableTokens[0].principal : '');
            setAmount('');
            setError('');
        }
    }, [isOpen, availableTokens]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!selectedToken) {
            setError('Please select a token');
            return;
        }

        if (!amount || parseFloat(amount) <= 0) {
            setError('Please enter a valid amount');
            return;
        }

        const token = availableTokens.find(t => t.principal === selectedToken);
        if (!token) {
            setError('Selected token not found');
            return;
        }

        // Convert amount to smallest unit (e.g., e8s for ICP)
        const amountInSmallestUnit = Math.floor(parseFloat(amount) * Math.pow(10, token.decimals));

        if (token.balance && amountInSmallestUnit > token.balance) {
            setError('Insufficient balance');
            return;
        }

        try {
            await onTip({
                tokenPrincipal: selectedToken,
                amount: amountInSmallestUnit,
                recipientPrincipal: post.created_by,
                postId: post.id
            });
        } catch (err) {
            setError(err.message || 'Failed to send tip');
        }
    };

    const formatBalance = (balance, decimals) => {
        if (balance === undefined || balance === null) return 'Loading...';
        const formatted = (balance / Math.pow(10, decimals)).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: decimals
        });
        return formatted;
    };

    const selectedTokenData = availableTokens.find(t => t.principal === selectedToken);

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        }}>
            <div style={{
                backgroundColor: '#2a2a2a',
                border: '1px solid #4a4a4a',
                borderRadius: '8px',
                padding: '24px',
                maxWidth: '400px',
                width: '90%',
                maxHeight: '90vh',
                overflow: 'auto'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ color: '#ffffff', margin: 0, fontSize: '18px' }}>
                        💰 Tip Post
                    </h3>
                    <button
                        onClick={onClose}
                        style={{
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: '#888',
                            fontSize: '20px',
                            cursor: 'pointer',
                            padding: '0',
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        ×
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    {/* Token Selection */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{
                            display: 'block',
                            color: '#cccccc',
                            fontSize: '14px',
                            marginBottom: '6px',
                            fontWeight: '500'
                        }}>
                            Token
                        </label>
                        <select
                            value={selectedToken}
                            onChange={(e) => setSelectedToken(e.target.value)}
                            style={{
                                width: '100%',
                                backgroundColor: '#1a1a1a',
                                border: '1px solid #4a4a4a',
                                borderRadius: '4px',
                                color: '#ffffff',
                                padding: '8px 12px',
                                fontSize: '14px'
                            }}
                            required
                        >
                            <option value="">Select a token</option>
                            {availableTokens.map(token => (
                                <option key={token.principal} value={token.principal}>
                                    {token.symbol} - Balance: {formatBalance(token.balance, token.decimals)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Amount Input */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{
                            display: 'block',
                            color: '#cccccc',
                            fontSize: '14px',
                            marginBottom: '6px',
                            fontWeight: '500'
                        }}>
                            Amount
                        </label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            step="any"
                            min="0"
                            style={{
                                width: '100%',
                                backgroundColor: '#1a1a1a',
                                border: '1px solid #4a4a4a',
                                borderRadius: '4px',
                                color: '#ffffff',
                                padding: '8px 12px',
                                fontSize: '14px'
                            }}
                            required
                        />
                        {selectedTokenData && (
                            <div style={{
                                fontSize: '12px',
                                color: '#888',
                                marginTop: '4px'
                            }}>
                                Available: {formatBalance(selectedTokenData.balance, selectedTokenData.decimals)} {selectedTokenData.symbol}
                            </div>
                        )}
                    </div>

                    {/* Recipient Info */}
                    <div style={{
                        backgroundColor: '#1a1a1a',
                        border: '1px solid #4a4a4a',
                        borderRadius: '4px',
                        padding: '12px',
                        marginBottom: '16px'
                    }}>
                        <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                            Tip recipient:
                        </div>
                        <div style={{
                            fontSize: '14px',
                            color: '#ffffff',
                            fontFamily: 'monospace',
                            wordBreak: 'break-all'
                        }}>
                            {post.created_by.toString()}
                        </div>
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div style={{
                            backgroundColor: 'rgba(231, 76, 60, 0.1)',
                            border: '1px solid #e74c3c',
                            color: '#e74c3c',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            fontSize: '14px',
                            marginBottom: '16px'
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div style={{
                        display: 'flex',
                        gap: '12px',
                        justifyContent: 'flex-end'
                    }}>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            style={{
                                backgroundColor: 'transparent',
                                border: '1px solid #666',
                                color: '#cccccc',
                                borderRadius: '4px',
                                padding: '8px 16px',
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                fontSize: '14px',
                                opacity: isSubmitting ? 0.6 : 1
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !selectedToken || !amount}
                            style={{
                                backgroundColor: (!isSubmitting && selectedToken && amount) ? '#f39c12' : '#666',
                                border: 'none',
                                color: '#ffffff',
                                borderRadius: '4px',
                                padding: '8px 16px',
                                cursor: (!isSubmitting && selectedToken && amount) ? 'pointer' : 'not-allowed',
                                fontSize: '14px',
                                fontWeight: '500'
                            }}
                        >
                            {isSubmitting ? 'Sending Tip...' : 'Send Tip'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TipModal;
