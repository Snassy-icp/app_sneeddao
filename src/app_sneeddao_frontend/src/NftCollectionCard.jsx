import React, { useState } from 'react';
import { useTheme } from './contexts/ThemeContext';
import NftCard from './NftCard';
import './NftCollectionCard.css';

const NftCollectionCard = ({ collection, onSendNft, onRemove, onRefresh, isRefreshing }) => {
    const { theme } = useTheme();
    const [isExpanded, setIsExpanded] = useState(true);
    
    const handleHeaderClick = () => {
        setIsExpanded(!isExpanded);
    };
    
    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };
    
    return (
        <div className="card" style={{
            background: theme.colors.cardBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            marginBottom: '20px',
            overflow: 'hidden'
        }}>
            {/* Collection Header */}
            <div 
                className="card-header" 
                onClick={handleHeaderClick}
                style={{
                    padding: '16px 20px',
                    cursor: 'pointer',
                    background: theme.colors.secondaryBg,
                    borderBottom: isExpanded ? `1px solid ${theme.colors.border}` : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
                    {/* Collection Logo */}
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '8px',
                        background: theme.colors.primaryBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        flexShrink: 0
                    }}>
                        {collection.logo ? (
                            <img 
                                src={collection.logo} 
                                alt={collection.symbol}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover'
                                }}
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.parentElement.innerHTML = '<span style="font-size: 24px">🎨</span>';
                                }}
                            />
                        ) : (
                            <span style={{ fontSize: '24px' }}>🎨</span>
                        )}
                    </div>
                    
                    {/* Collection Info */}
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
                            {collection.name}
                        </div>
                        <div style={{
                            fontSize: '14px',
                            color: theme.colors.mutedText,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flexWrap: 'wrap'
                        }}>
                            <span>{collection.symbol}</span>
                            <span>•</span>
                            <span>{collection.nfts.length} NFT{collection.nfts.length !== 1 ? 's' : ''}</span>
                            {collection.totalSupply && (
                                <>
                                    <span>•</span>
                                    <span>Supply: {collection.totalSupply.toString()}</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                
                {/* Actions and expand indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {onRefresh && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRefresh(collection);
                            }}
                            disabled={isRefreshing}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: isRefreshing ? 'default' : 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                color: theme.colors.mutedText,
                                fontSize: '1.2rem',
                                transition: 'color 0.2s ease',
                                opacity: isRefreshing ? 0.6 : 1
                            }}
                            onMouseEnter={(e) => !isRefreshing && (e.target.style.color = theme.colors.primaryText)}
                            onMouseLeave={(e) => !isRefreshing && (e.target.style.color = theme.colors.mutedText)}
                            title="Refresh collection"
                        >
                            {isRefreshing ? '⏳' : '🔄'}
                        </button>
                    )}
                    
                    <span style={{
                        color: theme.colors.mutedText,
                        fontSize: '1.2rem',
                        transition: 'transform 0.2s ease',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                    }}>
                        ▼
                    </span>
                </div>
            </div>
            
            {/* Expanded Content */}
            {isExpanded && (
                <div style={{ padding: '20px' }}>
                    {/* Collection Description */}
                    {collection.description && (
                        <div style={{
                            padding: '12px 16px',
                            background: theme.colors.secondaryBg,
                            borderRadius: '8px',
                            marginBottom: '20px',
                            fontSize: '0.9rem',
                            color: theme.colors.secondaryText,
                            lineHeight: '1.5'
                        }}>
                            {collection.description}
                        </div>
                    )}
                    
                    {/* Canister ID */}
                    <div style={{
                        padding: '12px 16px',
                        background: theme.colors.secondaryBg,
                        borderRadius: '8px',
                        marginBottom: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px'
                    }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: '0.8rem',
                                color: theme.colors.mutedText,
                                marginBottom: '4px'
                            }}>
                                Canister ID:
                            </div>
                            <div style={{
                                fontSize: '0.85rem',
                                color: theme.colors.primaryText,
                                fontFamily: 'monospace',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {collection.canisterId}
                            </div>
                        </div>
                        <button
                            onClick={() => copyToClipboard(collection.canisterId)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                color: theme.colors.accent,
                                fontSize: '1rem',
                                flexShrink: 0
                            }}
                            title="Copy canister ID"
                        >
                            📋
                        </button>
                    </div>
                    
                    {/* Action Buttons */}
                    {onRemove && (
                        <div style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            marginBottom: '20px'
                        }}>
                            <button
                                onClick={() => onRemove(collection)}
                                style={{
                                    background: theme.colors.error,
                                    color: theme.colors.primaryBg,
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: '500',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = theme.colors.errorHover || `${theme.colors.error}dd`;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = theme.colors.error;
                                }}
                            >
                                <img 
                                    src="red-x-black.png" 
                                    alt="Remove" 
                                    style={{ width: '14px', height: '14px' }}
                                />
                                Remove Collection
                            </button>
                        </div>
                    )}
                    
                    {/* NFT Grid */}
                    {collection.nfts.length > 0 ? (
                        <div className="nft-grid" style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                            gap: '20px'
                        }}>
                            {collection.nfts.map(nft => (
                                <NftCard
                                    key={nft.tokenId.toString()}
                                    nft={nft}
                                    collectionName={collection.name}
                                    collectionSymbol={collection.symbol}
                                    onSend={(nft) => onSendNft(collection, nft)}
                                />
                            ))}
                        </div>
                    ) : (
                        <div style={{
                            padding: '40px',
                            textAlign: 'center',
                            color: theme.colors.mutedText
                        }}>
                            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
                            <div style={{ fontSize: '1rem' }}>No NFTs in this collection</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default NftCollectionCard;

