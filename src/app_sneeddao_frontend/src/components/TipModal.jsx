import React, { useState, useEffect } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';

const TipModal = ({ 
    isOpen, 
    onClose, 
    onTip, 
    post, 
    isSubmitting,
    availableTokens = [], // Array of {principal, symbol, decimals, balance}
    userPrincipal,
    identity
}) => {
    const [selectedToken, setSelectedToken] = useState('');
    const [amount, setAmount] = useState('');
    const [error, setError] = useState('');
    const [tokenBalances, setTokenBalances] = useState({});
    const [loadingBalances, setLoadingBalances] = useState({});

    // Fetch balance for a specific token
    const fetchTokenBalance = async (tokenPrincipal) => {
        if (!identity || !tokenPrincipal) return;

        setLoadingBalances(prev => ({ ...prev, [tokenPrincipal]: true }));
        
        try {
            const ledgerActor = createLedgerActor(tokenPrincipal, {
                agentOptions: { identity }
            });
            
            const balance = await ledgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: []
            });
            
            setTokenBalances(prev => ({ ...prev, [tokenPrincipal]: balance }));
        } catch (err) {
            console.error(`Error fetching balance for token ${tokenPrincipal}:`, err);
            setTokenBalances(prev => ({ ...prev, [tokenPrincipal]: BigInt(0) }));
        } finally {
            setLoadingBalances(prev => ({ ...prev, [tokenPrincipal]: false }));
        }
    };

    // Reset form when modal opens and fetch balances
    useEffect(() => {
        if (isOpen) {
            setSelectedToken(availableTokens.length > 0 ? availableTokens[0].principal : '');
            setAmount('');
            setError('');
            setTokenBalances({});
            setLoadingBalances({});
            
            // Fetch balances for all available tokens
            availableTokens.forEach(token => {
                fetchTokenBalance(token.principal);
            });
        }
    }, [isOpen, availableTokens, identity]);

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

        // Check balance from our fetched balances
        const currentBalance = tokenBalances[selectedToken] || BigInt(0);
        
        // We need to account for transaction fees - get fee from token data
        const tokenFee = BigInt(token.fee || 0);
        const totalNeeded = BigInt(amountInSmallestUnit) + tokenFee;
        
        if (totalNeeded > currentBalance) {
            const shortfall = totalNeeded - currentBalance;
            const shortfallFormatted = (Number(shortfall) / Math.pow(10, token.decimals)).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: Math.min(token.decimals, 8)
            });
            setError(`Insufficient balance. You need ${shortfallFormatted} ${token.symbol} more (including transaction fees)`);
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

    const formatBalance = (tokenPrincipal, decimals) => {
        if (loadingBalances[tokenPrincipal]) return 'Loading...';
        
        const balance = tokenBalances[tokenPrincipal];
        if (balance === undefined || balance === null) return 'Loading...';
        
        const formatted = (Number(balance) / Math.pow(10, decimals)).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: Math.min(decimals, 8) // Cap at 8 decimal places for display
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
                                    {token.symbol} - Balance: {formatBalance(token.principal, token.decimals)}
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
                                Available: {formatBalance(selectedTokenData.principal, selectedTokenData.decimals)} {selectedTokenData.symbol}
                                <br />
                                Transaction fee: {(Number(selectedTokenData.fee || 0) / Math.pow(10, selectedTokenData.decimals)).toLocaleString(undefined, {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: Math.min(selectedTokenData.decimals, 8)
                                })} {selectedTokenData.symbol}
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
