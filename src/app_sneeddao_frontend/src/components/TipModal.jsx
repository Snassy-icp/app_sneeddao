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
    const [tokenMetadata, setTokenMetadata] = useState({}); // Store metadata for each token

    // Fetch token metadata (fee, decimals, symbol)
    const fetchTokenMetadata = async (tokenPrincipal) => {
        if (!tokenPrincipal) return;

        try {
            const ledgerActor = createLedgerActor(tokenPrincipal, {
                agentOptions: { identity }
            });
            
            // Fetch metadata, fee, and decimals
            const [metadata, fee, decimals] = await Promise.all([
                ledgerActor.icrc1_metadata().catch(() => []),
                ledgerActor.icrc1_fee().catch(() => BigInt(0)),
                ledgerActor.icrc1_decimals().catch(() => 8)
            ]);

            console.log('Token metadata fetched:', {
                tokenPrincipal,
                metadata,
                fee: fee.toString(),
                decimals: Number(decimals)
            });

            // Extract symbol from metadata
            let symbol = 'Unknown';
            if (metadata && Array.isArray(metadata)) {
                const symbolEntry = metadata.find(([key]) => key === 'icrc1:symbol');
                if (symbolEntry && symbolEntry[1] && symbolEntry[1].Text) {
                    symbol = symbolEntry[1].Text;
                }
            }
            
            setTokenMetadata(prev => ({
                ...prev,
                [tokenPrincipal]: {
                    symbol,
                    decimals: Number(decimals),
                    fee: fee
                }
            }));
        } catch (err) {
            console.error(`Error fetching metadata for token ${tokenPrincipal}:`, err);
            setTokenMetadata(prev => ({
                ...prev,
                [tokenPrincipal]: {
                    symbol: 'Unknown',
                    decimals: 8,
                    fee: BigInt(0)
                }
            }));
        }
    };

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
            setTokenMetadata({});
            
            // Fetch balances and metadata for all available tokens
            availableTokens.forEach(token => {
                fetchTokenBalance(token.principal);
                fetchTokenMetadata(token.principal);
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

        // Get token metadata (decimals, fee, symbol) from our fetched data
        const metadata = tokenMetadata[selectedToken];
        if (!metadata) {
            setError('Token metadata not loaded. Please try again.');
            return;
        }

        const { decimals, fee: tokenFee, symbol } = metadata;
        
        console.log('Tip calculation:', {
            amount,
            decimals,
            fee: tokenFee.toString(),
            symbol
        });

        // Convert amount to smallest unit (e.g., e8s for ICP)
        const amountInSmallestUnit = Math.floor(parseFloat(amount) * Math.pow(10, decimals));

        // Check balance from our fetched balances
        const currentBalance = tokenBalances[selectedToken] || BigInt(0);
        
        // We need to account for transaction fees
        const totalNeeded = BigInt(amountInSmallestUnit) + tokenFee;
        
        console.log('Balance check:', {
            amountInSmallestUnit,
            currentBalance: currentBalance.toString(),
            tokenFee: tokenFee.toString(),
            totalNeeded: totalNeeded.toString()
        });
        
        if (totalNeeded > currentBalance) {
            const shortfall = totalNeeded - currentBalance;
            const shortfallFormatted = (Number(shortfall) / Math.pow(10, decimals)).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: Math.min(decimals, 8)
            });
            setError(`Insufficient balance. You need ${shortfallFormatted} ${symbol} more (including transaction fees)`);
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

    const formatBalance = (tokenPrincipal) => {
        if (loadingBalances[tokenPrincipal]) return 'Loading...';
        
        const balance = tokenBalances[tokenPrincipal];
        const metadata = tokenMetadata[tokenPrincipal];
        
        if (balance === undefined || balance === null || !metadata) return 'Loading...';
        
        const { decimals } = metadata;
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
                                    {token.symbol} - Balance: {formatBalance(token.principal)}
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
                        {selectedToken && tokenMetadata[selectedToken] && (
                            <div style={{
                                fontSize: '12px',
                                color: '#888',
                                marginTop: '4px'
                            }}>
                                Available: {formatBalance(selectedToken)} {tokenMetadata[selectedToken].symbol}
                                <br />
                                Decimals: {tokenMetadata[selectedToken].decimals}
                                <br />
                                Transaction fee: {(Number(tokenMetadata[selectedToken].fee) / Math.pow(10, tokenMetadata[selectedToken].decimals)).toLocaleString(undefined, {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: Math.min(tokenMetadata[selectedToken].decimals, 8)
                                })} {tokenMetadata[selectedToken].symbol}
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
