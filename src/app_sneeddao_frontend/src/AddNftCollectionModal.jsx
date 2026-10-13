import React, { useState, useEffect } from 'react';
import { Principal } from '@dfinity/principal';
import { useTheme } from './contexts/ThemeContext';
import { fetchCollectionInfo } from './utils/NftUtils';
import './AddNftCollectionModal.css';

const AddNftCollectionModal = ({ isOpen, onClose, onAdd, agent }) => {
    const { theme } = useTheme();
    const [canisterId, setCanisterId] = useState('');
    const [isValidCanister, setIsValidCanister] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [collectionInfo, setCollectionInfo] = useState(null);
    const [error, setError] = useState('');
    
    useEffect(() => {
        if (canisterId) {
            try {
                Principal.fromText(canisterId);
                setIsValidCanister(true);
                setError('');
            } catch (e) {
                setIsValidCanister(false);
                setCollectionInfo(null);
                setError('Invalid canister ID format');
            }
        } else {
            setIsValidCanister(false);
            setCollectionInfo(null);
            setError('');
        }
    }, [canisterId]);
    
    const handlePreview = async () => {
        if (!isValidCanister) return;
        
        setIsLoading(true);
        setError('');
        setCollectionInfo(null);
        
        try {
            const info = await fetchCollectionInfo(canisterId, agent);
            
            if (!info.isIcrc7) {
                setError('This canister does not implement ICRC-7 standard');
                return;
            }
            
            setCollectionInfo(info);
        } catch (err) {
            setError(err.message || 'Failed to fetch collection info');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleAdd = async () => {
        if (!collectionInfo) return;
        
        try {
            await onAdd(canisterId, collectionInfo);
            setCanisterId('');
            setCollectionInfo(null);
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to add collection');
        }
    };
    
    const handleClose = () => {
        setCanisterId('');
        setCollectionInfo(null);
        setError('');
        onClose();
    };
    
    if (!isOpen) return null;
    
    return (
        <div 
            className="modal-overlay"
            onClick={handleClose}
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
                        Add NFT Collection
                    </h2>
                    <p style={{
                        margin: '8px 0 0 0',
                        fontSize: '14px',
                        color: theme.colors.mutedText
                    }}>
                        Enter the canister ID of an ICRC-7 NFT collection
                    </p>
                </div>
                
                {/* Form */}
                <div style={{ padding: '24px' }}>
                    {/* Canister ID Input */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontSize: '14px',
                            fontWeight: '500',
                            color: theme.colors.primaryText
                        }}>
                            Canister ID
                        </label>
                        <input
                            type="text"
                            value={canisterId}
                            onChange={(e) => setCanisterId(e.target.value)}
                            placeholder="xxxxx-xxxxx-xxxxx-xxxxx-xxx"
                            disabled={isLoading}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: `1px solid ${isValidCanister || !canisterId ? theme.colors.border : theme.colors.error}`,
                                background: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                fontSize: '14px',
                                fontFamily: 'monospace',
                                outline: 'none',
                                transition: 'border-color 0.2s ease'
                            }}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter' && isValidCanister && !collectionInfo) {
                                    handlePreview();
                                }
                            }}
                        />
                    </div>
                    
                    {/* Preview Button */}
                    {!collectionInfo && (
                        <button
                            onClick={handlePreview}
                            disabled={!isValidCanister || isLoading}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: 'none',
                                background: isValidCanister && !isLoading 
                                    ? theme.colors.accent 
                                    : theme.colors.mutedText,
                                color: theme.colors.primaryBg,
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: isValidCanister && !isLoading ? 'pointer' : 'not-allowed',
                                opacity: isValidCanister && !isLoading ? 1 : 0.6,
                                transition: 'all 0.2s ease',
                                marginBottom: '20px'
                            }}
                        >
                            {isLoading ? 'Loading...' : 'Preview Collection'}
                        </button>
                    )}
                    
                    {/* Collection Preview */}
                    {collectionInfo && (
                        <div style={{
                            padding: '16px',
                            borderRadius: '12px',
                            background: theme.colors.secondaryBg,
                            border: `1px solid ${theme.colors.border}`,
                            marginBottom: '20px'
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '16px',
                                marginBottom: '16px'
                            }}>
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '8px',
                                    background: theme.colors.primaryBg,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                    flexShrink: 0
                                }}>
                                    {collectionInfo.logo ? (
                                        <img 
                                            src={collectionInfo.logo} 
                                            alt={collectionInfo.symbol}
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'cover'
                                            }}
                                            onError={(e) => {
                                                e.target.style.display = 'none';
                                                e.target.parentElement.innerHTML = '<span style="font-size: 32px">🎨</span>';
                                            }}
                                        />
                                    ) : (
                                        <span style={{ fontSize: '32px' }}>🎨</span>
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
                                        {collectionInfo.name}
                                    </div>
                                    <div style={{
                                        fontSize: '14px',
                                        color: theme.colors.mutedText
                                    }}>
                                        {collectionInfo.symbol}
                                    </div>
                                </div>
                            </div>
                            
                            {collectionInfo.description && (
                                <div style={{
                                    fontSize: '13px',
                                    color: theme.colors.secondaryText,
                                    lineHeight: '1.5',
                                    marginBottom: '12px'
                                }}>
                                    {collectionInfo.description}
                                </div>
                            )}
                            
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                padding: '12px 0',
                                borderTop: `1px solid ${theme.colors.border}`
                            }}>
                                <span style={{
                                    fontSize: '13px',
                                    color: theme.colors.mutedText
                                }}>
                                    Total Supply:
                                </span>
                                <span style={{
                                    fontSize: '13px',
                                    color: theme.colors.primaryText,
                                    fontWeight: '600'
                                }}>
                                    {collectionInfo.totalSupply.toString()}
                                </span>
                            </div>
                            
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                background: `${theme.colors.success}20`,
                                border: `1px solid ${theme.colors.success}40`,
                                marginTop: '12px'
                            }}>
                                <span style={{ fontSize: '16px' }}>✓</span>
                                <span style={{
                                    fontSize: '13px',
                                    color: theme.colors.success,
                                    fontWeight: '500'
                                }}>
                                    ICRC-7 Compatible
                                </span>
                            </div>
                        </div>
                    )}
                    
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
                            onClick={handleClose}
                            style={{
                                padding: '12px 24px',
                                borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`,
                                background: 'transparent',
                                color: theme.colors.primaryText,
                                fontSize: '14px',
                                fontWeight: '500',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            Cancel
                        </button>
                        {collectionInfo && (
                            <button
                                onClick={handleAdd}
                                style={{
                                    padding: '12px 24px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: theme.colors.accent,
                                    color: theme.colors.primaryBg,
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                Add Collection
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AddNftCollectionModal;

