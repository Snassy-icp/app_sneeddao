import React, { useState, useEffect } from 'react';
import { Principal } from '@dfinity/principal';
import { useTheme } from './contexts/ThemeContext';
import { getNftImage, getNftName } from './utils/NftUtils';
import './SendNftModal.css';

const SendNftModal = ({ isOpen, onClose, nft, collection, onConfirm }) => {
    const { theme } = useTheme();
    const [recipient, setRecipient] = useState('');
    const [subaccount, setSubaccount] = useState('');
    const [memo, setMemo] = useState('');
    const [isValidPrincipal, setIsValidPrincipal] = useState(false);
    const [isValidSubaccount, setIsValidSubaccount] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');
    
    useEffect(() => {
        if (recipient) {
            try {
                Principal.fromText(recipient);
                setIsValidPrincipal(true);
                setError('');
            } catch (e) {
                setIsValidPrincipal(false);
                setError('Invalid principal format');
            }
        } else {
            setIsValidPrincipal(false);
            setError('');
        }
    }, [recipient]);
    
    useEffect(() => {
        if (subaccount && subaccount.trim() !== '') {
            // Check if it's a valid hex string of 64 characters (32 bytes)
            const hexPattern = /^[0-9a-fA-F]{64}$/;
            if (hexPattern.test(subaccount)) {
                setIsValidSubaccount(true);
                setError('');
            } else {
                setIsValidSubaccount(false);
                setError('Subaccount must be 64 hex characters (32 bytes)');
            }
        } else {
            setIsValidSubaccount(true);
            setError('');
        }
    }, [subaccount]);
    
    const handleSubmit = async () => {
        if (!isValidPrincipal || !isValidSubaccount) return;
        
        setIsSending(true);
        setError('');
        
        try {
            const toAccount = {
                owner: Principal.fromText(recipient),
                subaccount: subaccount && subaccount.trim() !== '' 
                    ? [hexToBytes(subaccount)] 
                    : []
            };
            
            const memoBytes = memo && memo.trim() !== '' 
                ? [new TextEncoder().encode(memo)] 
                : [];
            
            await onConfirm(toAccount, memoBytes);
            
            // Reset form
            setRecipient('');
            setSubaccount('');
            setMemo('');
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to send NFT');
        } finally {
            setIsSending(false);
        }
    };
    
    const hexToBytes = (hex) => {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    };
    
    if (!isOpen || !nft || !collection) return null;
    
    const imageUrl = getNftImage(nft.metadata);
    const nftName = getNftName(nft.metadata, nft.tokenId);
    
    return (
        <div 
            className="modal-overlay"
            onClick={onClose}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: '20px'
            }}
        >
            <div 
                className="modal-content"
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: theme.colors.cardBg,
                    borderRadius: '16px',
                    maxWidth: '500px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                }}
            >
                {/* Header */}
                <div style={{
                    padding: '24px',
                    borderBottom: `1px solid ${theme.colors.border}`
                }}>
                    <h2 style={{
                        margin: 0,
                        fontSize: '24px',
                        fontWeight: '600',
                        color: theme.colors.primaryText
                    }}>
                        Send NFT
                    </h2>
                </div>
                
                {/* NFT Preview */}
                <div style={{
                    padding: '24px',
                    borderBottom: `1px solid ${theme.colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px'
                }}>
                    <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '8px',
                        background: theme.colors.secondaryBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        flexShrink: 0
                    }}>
                        {imageUrl ? (
                            <img 
                                src={imageUrl} 
                                alt={nftName}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover'
                                }}
                            />
                        ) : (
                            <span style={{ fontSize: '32px' }}>🖼️</span>
                        )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                            fontSize: '18px',
                            fontWeight: '600',
                            color: theme.colors.primaryText,
                            marginBottom: '4px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}>
                            {nftName}
                        </div>
                        <div style={{
                            fontSize: '14px',
                            color: theme.colors.mutedText
                        }}>
                            {collection.symbol} #{nft.tokenId.toString()}
                        </div>
                        <div style={{
                            fontSize: '13px',
                            color: theme.colors.mutedText,
                            marginTop: '4px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}>
                            {collection.name}
                        </div>
                    </div>
                </div>
                
                {/* Form */}
                <div style={{ padding: '24px' }}>
                    {/* Recipient */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontSize: '14px',
                            fontWeight: '500',
                            color: theme.colors.primaryText
                        }}>
                            Recipient Principal *
                        </label>
                        <input
                            type="text"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            placeholder="xxxxx-xxxxx-xxxxx-xxxxx-xxx"
                            disabled={isSending}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: `1px solid ${isValidPrincipal || !recipient ? theme.colors.border : theme.colors.error}`,
                                background: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                fontSize: '14px',
                                fontFamily: 'monospace',
                                outline: 'none',
                                transition: 'border-color 0.2s ease'
                            }}
                        />
                    </div>
                    
                    {/* Subaccount (optional) */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontSize: '14px',
                            fontWeight: '500',
                            color: theme.colors.primaryText
                        }}>
                            Subaccount (optional)
                        </label>
                        <input
                            type="text"
                            value={subaccount}
                            onChange={(e) => setSubaccount(e.target.value)}
                            placeholder="64 hex characters (32 bytes)"
                            disabled={isSending}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: `1px solid ${isValidSubaccount || !subaccount ? theme.colors.border : theme.colors.error}`,
                                background: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                fontSize: '14px',
                                fontFamily: 'monospace',
                                outline: 'none',
                                transition: 'border-color 0.2s ease'
                            }}
                        />
                        <div style={{
                            fontSize: '12px',
                            color: theme.colors.mutedText,
                            marginTop: '4px'
                        }}>
                            Leave empty for default subaccount
                        </div>
                    </div>
                    
                    {/* Memo (optional) */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontSize: '14px',
                            fontWeight: '500',
                            color: theme.colors.primaryText
                        }}>
                            Memo (optional)
                        </label>
                        <input
                            type="text"
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            placeholder="Note or reference"
                            disabled={isSending}
                            maxLength={32}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`,
                                background: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                fontSize: '14px',
                                outline: 'none'
                            }}
                        />
                    </div>
                    
                    {/* Error message */}
                    {error && (
                        <div style={{
                            padding: '12px',
                            borderRadius: '8px',
                            background: `${theme.colors.error}20`,
                            border: `1px solid ${theme.colors.error}40`,
                            color: theme.colors.error,
                            fontSize: '14px',
                            marginBottom: '20px'
                        }}>
                            {error}
                        </div>
                    )}
                    
                    {/* Buttons */}
                    <div style={{
                        display: 'flex',
                        gap: '12px',
                        justifyContent: 'flex-end'
                    }}>
                        <button
                            onClick={onClose}
                            disabled={isSending}
                            style={{
                                padding: '12px 24px',
                                borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`,
                                background: 'transparent',
                                color: theme.colors.primaryText,
                                fontSize: '14px',
                                fontWeight: '500',
                                cursor: isSending ? 'not-allowed' : 'pointer',
                                opacity: isSending ? 0.6 : 1,
                                transition: 'all 0.2s ease'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!isValidPrincipal || !isValidSubaccount || isSending}
                            style={{
                                padding: '12px 24px',
                                borderRadius: '8px',
                                border: 'none',
                                background: isValidPrincipal && isValidSubaccount && !isSending 
                                    ? theme.colors.accent 
                                    : theme.colors.mutedText,
                                color: theme.colors.primaryBg,
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: isValidPrincipal && isValidSubaccount && !isSending ? 'pointer' : 'not-allowed',
                                opacity: isValidPrincipal && isValidSubaccount && !isSending ? 1 : 0.6,
                                transition: 'all 0.2s ease'
                            }}
                        >
                            {isSending ? 'Sending...' : 'Send NFT'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SendNftModal;

