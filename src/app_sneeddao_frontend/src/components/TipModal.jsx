import React, { useState, useEffect, useContext } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { NamingContext } from '../NamingContext';

// Add CSS animations
const animationStyles = `
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes slideIn {
    from { 
        opacity: 0;
        transform: translateY(-20px) scale(0.95);
    }
    to { 
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
`;

// Inject styles into document head
if (typeof document !== 'undefined' && !document.getElementById('tip-modal-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'tip-modal-styles';
    styleSheet.type = 'text/css';
    styleSheet.innerText = animationStyles;
    document.head.appendChild(styleSheet);
}

const TipModal = ({ 
    isOpen, 
    onClose, 
    onTip, 
    post, 
    isSubmitting,
    availableTokens = [], // Array of {principal, symbol, decimals, balance}
    userPrincipal,
    identity,
    tippingState = 'idle' // 'idle', 'transferring', 'registering', 'success', 'error'
}) => {
    const { principalNames, principalNicknames } = useContext(NamingContext);
    const [selectedToken, setSelectedToken] = useState('');
    const [amount, setAmount] = useState('');
    const [error, setError] = useState('');
    const [tokenBalances, setTokenBalances] = useState({});
    const [loadingBalances, setLoadingBalances] = useState({});
    const [tokenMetadata, setTokenMetadata] = useState({}); // Store metadata for each token
    const [tokenLogo, setTokenLogo] = useState(null);
    const [recipientDisplayInfo, setRecipientDisplayInfo] = useState(null);

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

            // Extract symbol and logo from metadata
            let symbol = 'Unknown';
            let logo = null;
            if (metadata && Array.isArray(metadata)) {
                const symbolEntry = metadata.find(([key]) => key === 'icrc1:symbol');
                if (symbolEntry && symbolEntry[1] && symbolEntry[1].Text) {
                    symbol = symbolEntry[1].Text;
                }
                
                const logoEntry = metadata.find(([key]) => key === 'icrc1:logo');
                if (logoEntry && logoEntry[1] && logoEntry[1].Text) {
                    logo = logoEntry[1].Text;
                }
            }
            
            setTokenMetadata(prev => ({
                ...prev,
                [tokenPrincipal]: {
                    symbol,
                    decimals: Number(decimals),
                    fee: fee,
                    logo: logo
                }
            }));

            // Update logo state if this is the selected token
            if (tokenPrincipal === selectedToken) {
                setTokenLogo(logo);
            }
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

    // Update logo when selected token changes
    useEffect(() => {
        if (selectedToken && tokenMetadata[selectedToken]) {
            setTokenLogo(tokenMetadata[selectedToken].logo);
        } else {
            setTokenLogo(null);
        }
    }, [selectedToken, tokenMetadata]);

    // Calculate recipient display info when post or naming context changes
    useEffect(() => {
        if (post?.created_by && principalNames && principalNicknames) {
            const displayInfo = getPrincipalDisplayInfoFromContext(
                post.created_by,
                principalNames,
                principalNicknames
            );
            setRecipientDisplayInfo(displayInfo);
        }
    }, [post?.created_by, principalNames, principalNicknames]);

    if (!isOpen) return null;

    // Calculate max amount (balance - fee)
    const getMaxAmount = () => {
        if (!selectedToken || !tokenBalances[selectedToken] || !tokenMetadata[selectedToken]) {
            return 0;
        }
        const balance = tokenBalances[selectedToken];
        const fee = tokenMetadata[selectedToken].fee;
        const decimals = tokenMetadata[selectedToken].decimals;
        
        const maxInSmallestUnit = balance > fee ? balance - fee : BigInt(0);
        return Number(maxInSmallestUnit) / Math.pow(10, decimals);
    };

    const handleMaxClick = () => {
        const maxAmount = getMaxAmount();
        setAmount(maxAmount.toString());
    };

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

    // Render different content based on tipping state
    const renderContent = () => {
        if (tippingState === 'success') {
            return (
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>✨</div>
                    <h3 style={{ 
                        color: '#ffffff', 
                        margin: '0 0 16px', 
                        fontSize: '24px',
                        fontWeight: '600'
                    }}>
                        Thank You!
                    </h3>
                    <p style={{
                        color: 'rgba(255, 255, 255, 0.8)',
                        margin: '0 0 24px',
                        fontSize: '16px',
                        lineHeight: '1.5'
                    }}>
                        Your appreciation has been sent successfully. The recipient will be notified of your thoughtful gesture.
                    </p>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'linear-gradient(135deg, #ffd700, #ffaa00)',
                            border: 'none',
                            borderRadius: '12px',
                            color: '#000000',
                            cursor: 'pointer',
                            fontSize: '15px',
                            fontWeight: '600',
                            padding: '12px 24px',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        Close
                    </button>
                </div>
            );
        }

        if (tippingState === 'transferring' || tippingState === 'registering') {
            return (
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        border: '4px solid rgba(255, 215, 0, 0.3)',
                        borderTop: '4px solid #ffd700',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        margin: '0 auto 24px'
                    }}></div>
                    <h3 style={{ 
                        color: '#ffffff', 
                        margin: '0 0 16px', 
                        fontSize: '24px',
                        fontWeight: '600'
                    }}>
                        {tippingState === 'transferring' ? 'Sending Tip...' : 'Registering Tip...'}
                    </h3>
                    <p style={{
                        color: 'rgba(255, 255, 255, 0.8)',
                        margin: '0 0 16px',
                        fontSize: '16px',
                        lineHeight: '1.5'
                    }}>
                        {tippingState === 'transferring' 
                            ? 'Processing your token transfer...' 
                            : 'Recording your tip in the forum...'
                        }
                    </p>
                    <div style={{
                        backgroundColor: 'rgba(255, 165, 0, 0.1)',
                        border: '1px solid rgba(255, 165, 0, 0.3)',
                        borderRadius: '8px',
                        padding: '12px',
                        marginTop: '16px'
                    }}>
                        <p style={{
                            color: '#ffa500',
                            margin: 0,
                            fontSize: '14px',
                            fontWeight: '500'
                        }}>
                            ⚠️ Please don't close your browser during this process
                        </p>
                    </div>
                </div>
            );
        }

        if (tippingState === 'error') {
            return (
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
                    <h3 style={{ 
                        color: '#ffffff', 
                        margin: '0 0 16px', 
                        fontSize: '24px',
                        fontWeight: '600'
                    }}>
                        Something Went Wrong
                    </h3>
                    <p style={{
                        color: 'rgba(255, 255, 255, 0.8)',
                        margin: '0 0 24px',
                        fontSize: '16px',
                        lineHeight: '1.5'
                    }}>
                        We encountered an error while processing your tip. Please try again.
                    </p>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '12px',
                            color: '#ffffff',
                            cursor: 'pointer',
                            fontSize: '15px',
                            fontWeight: '500',
                            padding: '12px 24px',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        Close
                    </button>
                </div>
            );
        }

        // Default form content for 'idle' state
        return (
            <>
                {/* Elegant header with golden accent */}
                <div style={{
                    textAlign: 'center',
                    marginBottom: '32px',
                    position: 'relative'
                }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #ffd700, #ffaa00)',
                        width: '60px',
                        height: '60px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px',
                        boxShadow: '0 8px 16px rgba(255, 215, 0, 0.3)',
                        overflow: 'hidden'
                    }}>
                        {tokenLogo ? (
                            <img 
                                src={tokenLogo} 
                                alt="Token Logo"
                                style={{ 
                                    width: '50px', 
                                    height: '50px',
                                    objectFit: 'cover',
                                    borderRadius: '50%'
                                }}
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'block';
                                }}
                            />
                        ) : null}
                        <span style={{ 
                            fontSize: '24px',
                            display: tokenLogo ? 'none' : 'block'
                        }}>💎</span>
                    </div>
                    <h3 style={{ 
                        color: '#ffffff', 
                        margin: 0, 
                        fontSize: '24px',
                        fontWeight: '600',
                        background: 'linear-gradient(135deg, #ffd700, #ffaa00)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text'
                    }}>
                        Send Appreciation
                    </h3>
                    <p style={{
                        color: 'rgba(255, 255, 255, 0.7)',
                        margin: '8px 0 0',
                        fontSize: '14px',
                        fontWeight: '400'
                    }}>
                        Show your support with a thoughtful tip
                    </p>
                    
                    {/* Close button */}
                    <button
                        onClick={onClose}
                        style={{
                            position: 'absolute',
                            top: '-8px',
                            right: '-8px',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            color: 'rgba(255, 255, 255, 0.7)',
                            fontSize: '18px',
                            cursor: 'pointer',
                            padding: '8px',
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s ease',
                            backdropFilter: 'blur(10px)'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                            e.target.style.color = '#ffffff';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                            e.target.style.color = 'rgba(255, 255, 255, 0.7)';
                        }}
                    >
                        ×
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
                    {/* Token Selection */}
                    <div style={{ width: '100%' }}>
                        <label style={{
                            display: 'block',
                            color: 'rgba(255, 255, 255, 0.9)',
                            fontSize: '15px',
                            marginBottom: '12px',
                            fontWeight: '500',
                            letterSpacing: '0.5px'
                        }}>
                            Choose Token
                        </label>
                        <div style={{
                            position: 'relative',
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            overflow: 'hidden'
                        }}>
                            <select
                                value={selectedToken}
                                onChange={(e) => setSelectedToken(e.target.value)}
                                style={{
                                    width: '100%',
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    borderRadius: '12px',
                                    color: '#ffffff',
                                    padding: '16px 20px',
                                    fontSize: '15px',
                                    fontWeight: '500',
                                    cursor: 'pointer',
                                    outline: 'none',
                                    appearance: 'none',
                                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23ffffff' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                                    backgroundPosition: 'right 16px center',
                                    backgroundRepeat: 'no-repeat',
                                    backgroundSize: '16px',
                                    paddingRight: '48px'
                                }}
                                required
                            >
                                <option value="" style={{ backgroundColor: '#2a2a2a' }}>Select a token</option>
                                {availableTokens.map(token => (
                                    <option key={token.principal} value={token.principal} style={{ backgroundColor: '#2a2a2a' }}>
                                        {token.symbol} - Balance: {formatBalance(token.principal)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Amount Input */}
                    <div style={{ width: '100%' }}>
                        <label style={{
                            display: 'block',
                            color: 'rgba(255, 255, 255, 0.9)',
                            fontSize: '15px',
                            marginBottom: '12px',
                            fontWeight: '500',
                            letterSpacing: '0.5px'
                        }}>
                            Amount
                        </label>
                        <div style={{
                            position: 'relative',
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center'
                        }}>
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    const maxAmount = getMaxAmount();
                                    if (parseFloat(value) <= maxAmount || value === '') {
                                        setAmount(value);
                                    }
                                }}
                                placeholder="0.00"
                                step="any"
                                min="0"
                                max={getMaxAmount()}
                                style={{
                                    flex: 1,
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: '#ffffff',
                                    padding: '16px 20px',
                                    fontSize: '18px',
                                    fontWeight: '500',
                                    outline: 'none',
                                    textAlign: 'center',
                                    letterSpacing: '1px'
                                }}
                                required
                            />
                            <button
                                type="button"
                                onClick={handleMaxClick}
                                style={{
                                    backgroundColor: 'rgba(255, 215, 0, 0.2)',
                                    border: '1px solid rgba(255, 215, 0, 0.4)',
                                    borderRadius: '8px',
                                    color: '#ffd700',
                                    padding: '8px 12px',
                                    margin: '8px',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    letterSpacing: '0.5px'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.backgroundColor = 'rgba(255, 215, 0, 0.3)';
                                    e.target.style.borderColor = 'rgba(255, 215, 0, 0.6)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.backgroundColor = 'rgba(255, 215, 0, 0.2)';
                                    e.target.style.borderColor = 'rgba(255, 215, 0, 0.4)';
                                }}
                            >
                                MAX
                            </button>
                        </div>
                        {selectedToken && tokenMetadata[selectedToken] && (
                            <div style={{
                                marginTop: '16px',
                                padding: '16px',
                                background: 'rgba(255, 215, 0, 0.05)',
                                border: '1px solid rgba(255, 215, 0, 0.1)',
                                borderRadius: '12px',
                                fontSize: '13px',
                                color: 'rgba(255, 255, 255, 0.8)',
                                lineHeight: '1.5'
                            }}>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    marginBottom: '8px',
                                    alignItems: 'center'
                                }}>
                                    <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Available Balance</span>
                                    <span style={{ 
                                        fontWeight: '600',
                                        color: '#ffd700'
                                    }}>
                                        {formatBalance(selectedToken)} {tokenMetadata[selectedToken].symbol}
                                    </span>
                                </div>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between',
                                    marginBottom: '8px',
                                    alignItems: 'center'
                                }}>
                                    <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Transaction Fee</span>
                                    <span style={{ fontWeight: '500' }}>
                                        {(Number(tokenMetadata[selectedToken].fee) / Math.pow(10, tokenMetadata[selectedToken].decimals)).toLocaleString(undefined, {
                                            minimumFractionDigits: 0,
                                            maximumFractionDigits: Math.min(tokenMetadata[selectedToken].decimals, 8)
                                        })} {tokenMetadata[selectedToken].symbol}
                                    </span>
                                </div>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}>
                                    <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Precision</span>
                                    <span style={{ fontWeight: '500' }}>
                                        {tokenMetadata[selectedToken].decimals} decimals
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Recipient Info */}
                    <div style={{ width: '100%' }}>
                        <label style={{
                            display: 'block',
                            color: 'rgba(255, 255, 255, 0.9)',
                            fontSize: '15px',
                            marginBottom: '12px',
                            fontWeight: '500',
                            letterSpacing: '0.5px'
                        }}>
                            Recipient
                        </label>
                        <div style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            padding: '16px 20px'
                        }}>
                            <div style={{
                                fontSize: '14px',
                                color: 'rgba(255, 255, 255, 0.7)',
                                marginBottom: '8px'
                            }}>
                                Post Creator
                            </div>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px'
                            }}>
                                <div style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '14px',
                                    fontWeight: 'bold',
                                    color: '#ffffff',
                                    flexShrink: 0
                                }}>
                                    {post.created_by.toString().slice(0, 2).toUpperCase()}
                                </div>
                                <div style={{ 
                                    flex: 1, 
                                    minWidth: 0,
                                    fontSize: '15px',
                                    fontWeight: '500'
                                }}>
                                    <PrincipalDisplay 
                                        principal={post.created_by} 
                                        displayInfo={recipientDisplayInfo}
                                        showCopyButton={false}
                                        style={{
                                            color: '#ffffff',
                                            fontSize: '15px'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Post Preview */}
                    <div style={{ width: '100%' }}>
                        <label style={{
                            display: 'block',
                            color: 'rgba(255, 255, 255, 0.9)',
                            fontSize: '15px',
                            marginBottom: '12px',
                            fontWeight: '500',
                            letterSpacing: '0.5px'
                        }}>
                            Tipping for Post
                        </label>
                        <div style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            padding: '16px 20px'
                        }}>
                            <div style={{
                                fontSize: '14px',
                                color: '#ffd700',
                                marginBottom: '8px',
                                fontWeight: '600'
                            }}>
                                Post #{post.id.toString()}
                            </div>
                            {post.title && (
                                <div style={{
                                    fontSize: '15px',
                                    color: '#ffffff',
                                    fontWeight: '500',
                                    marginBottom: '8px',
                                    lineHeight: '1.3'
                                }}>
                                    {post.title}
                                </div>
                            )}
                            <div style={{
                                fontSize: '14px',
                                color: 'rgba(255, 255, 255, 0.8)',
                                lineHeight: '1.4',
                                maxHeight: '60px',
                                overflow: 'hidden',
                                position: 'relative'
                            }}>
                                {post.body && post.body.length > 150 
                                    ? `${post.body.substring(0, 150)}...` 
                                    : post.body || 'No content'}
                            </div>
                        </div>
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div style={{
                            background: 'rgba(231, 76, 60, 0.1)',
                            border: '1px solid rgba(231, 76, 60, 0.3)',
                            borderRadius: '12px',
                            padding: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px'
                        }}>
                            <span style={{ fontSize: '18px' }}>⚠️</span>
                            <div style={{ 
                                color: '#ff6b6b', 
                                fontSize: '14px',
                                fontWeight: '500',
                                lineHeight: '1.4'
                            }}>
                                {error}
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '8px',
                        gap: '20px'
                    }}>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '12px',
                                color: 'rgba(255, 255, 255, 0.8)',
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                fontSize: '15px',
                                fontWeight: '500',
                                transition: 'all 0.2s ease',
                                backdropFilter: 'blur(10px)',
                                opacity: isSubmitting ? 0.6 : 1,
                                height: '56px',
                                minWidth: '120px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                outline: 'none'
                            }}
                            onMouseEnter={(e) => {
                                if (!isSubmitting) {
                                    e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
                                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isSubmitting) {
                                    e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                                }
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !selectedToken || !amount}
                            style={{
                                background: (isSubmitting || !selectedToken || !amount)
                                    ? 'rgba(255, 255, 255, 0.1)' 
                                    : 'linear-gradient(135deg, #ffd700, #ffaa00)',
                                border: 'none',
                                borderRadius: '12px',
                                color: (isSubmitting || !selectedToken || !amount) ? 'rgba(255, 255, 255, 0.5)' : '#000000',
                                cursor: (isSubmitting || !selectedToken || !amount) ? 'not-allowed' : 'pointer',
                                fontSize: '15px',
                                fontWeight: '600',
                                letterSpacing: '0.5px',
                                transition: 'all 0.2s ease',
                                boxShadow: (isSubmitting || !selectedToken || !amount) ? 'none' : '0 4px 12px rgba(255, 215, 0, 0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                height: '56px',
                                minWidth: '180px',
                                outline: 'none'
                            }}
                            onMouseEnter={(e) => {
                                if (!isSubmitting && selectedToken && amount) {
                                    e.target.style.transform = 'translateY(-1px)';
                                    e.target.style.boxShadow = '0 6px 16px rgba(255, 215, 0, 0.4)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isSubmitting && selectedToken && amount) {
                                    e.target.style.transform = 'translateY(0)';
                                    e.target.style.boxShadow = '0 4px 12px rgba(255, 215, 0, 0.3)';
                                }
                            }}
                        >
                            {isSubmitting ? (
                                <>
                                    <div style={{
                                        width: '16px',
                                        height: '16px',
                                        border: '2px solid rgba(255, 255, 255, 0.3)',
                                        borderTop: '2px solid rgba(255, 255, 255, 0.8)',
                                        borderRadius: '50%',
                                        animation: 'spin 1s linear infinite'
                                    }}></div>
                                    Sending...
                                </>
                            ) : (
                                <>
                                    <span>💎</span>
                                    Send Appreciation
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </>
        );
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.2s ease-out'
        }}>
            <div style={{
                background: 'linear-gradient(145deg, #1a1a1a 0%, #2a2a2a 100%)',
                border: '1px solid rgba(255, 215, 0, 0.2)',
                borderRadius: '20px',
                padding: '32px',
                maxWidth: '420px',
                width: '90%',
                maxHeight: '90vh',
                overflow: 'auto',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
                position: 'relative',
                animation: 'slideIn 0.3s ease-out'
            }}>
                {renderContent()}
            </div>
        </div>
    );
};

export default TipModal;
