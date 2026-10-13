import React, { useState } from 'react';
import PrincipalInput from './components/PrincipalInput';
import { useTheme } from './contexts/ThemeContext';
import NftCard from './NftCard';
import './NftCollectionCard.css';

const NftCollectionCard = ({ collection, onSendNft, onRemove, onRefresh, isRefreshing, isAdmin = false, onMint, myPrincipal }) => {
    const { theme } = useTheme();
    const [isExpanded, setIsExpanded] = useState(true);
    const [showMint, setShowMint] = useState(false);
    const [mint, setMint] = useState({ to: myPrincipal || '', name: '', description: '', image: '', attributes: [], busy: false, error: '', done: '' });
    const onImageFile = (file) => {
        if (!file) return;
        if (file.size > 300_000) { setMint((m) => ({ ...m, error: 'image files up to 300 kB (it is stored in the canister); larger art belongs at a URL' })); return; }
        const r = new FileReader(); r.onload = () => setMint((m) => ({ ...m, image: String(r.result), error: '' })); r.readAsDataURL(file);
    };
    const doMint = async () => {
        setMint((m) => ({ ...m, busy: true, error: '', done: '' }));
        try { const id = await onMint(collection, mint.to, { name: mint.name, description: mint.description, image: mint.image, attributes: mint.attributes }); setMint((m) => ({ ...m, busy: false, done: `Minted #${id}`, name: '', description: '', image: '', attributes: [] })); }
        catch (e) { setMint((m) => ({ ...m, busy: false, error: e?.message || String(e) })); }
    };
    const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.88rem', boxSizing: 'border-box' };
    
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
                    
                    {isAdmin && onMint && (
                        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: `1px solid ${theme.colors.accent}55`, background: `${theme.colors.accent}0c` }}>
                            <button type="button" onClick={() => setShowMint((v) => !v)} style={{ background: 'none', border: 'none', color: theme.colors.accent, cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', padding: 0 }}>{showMint ? '▼' : '▶'} Mint (you are an admin of this collection)</button>
                            {showMint && (
                                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Recipient</div>
                                    <PrincipalInput value={mint.to} onChange={(v) => setMint((m) => ({ ...m, to: v }))} placeholder="Principal or name" defaultTab="all" style={{ width: '100%' }} inputStyle={inputStyle} />
                                    <input style={inputStyle} value={mint.name} onChange={(e) => setMint((m) => ({ ...m, name: e.target.value }))} placeholder="Name" />
                                    <input style={inputStyle} value={mint.description} onChange={(e) => setMint((m) => ({ ...m, description: e.target.value }))} placeholder="Description" />
                                    <input style={inputStyle} value={mint.image.startsWith('data:') ? '(file chosen)' : mint.image} onChange={(e) => setMint((m) => ({ ...m, image: e.target.value }))} placeholder="Image URL (https, ipfs, or a data URL)" />
                                    <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>or an image file (up to 300 kB, stored in the canister) <input type="file" accept="image/*" onChange={(e) => onImageFile(e.target.files?.[0])} /></label>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Attributes</div>
                                    {mint.attributes.map((a, i) => (
                                        <div key={i} style={{ display: 'flex', gap: 6 }}>
                                            <input style={inputStyle} value={a.trait_type} onChange={(e) => setMint((m) => ({ ...m, attributes: m.attributes.map((x, j) => (j === i ? { ...x, trait_type: e.target.value } : x)) }))} placeholder="Trait" />
                                            <input style={inputStyle} value={a.value} onChange={(e) => setMint((m) => ({ ...m, attributes: m.attributes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }))} placeholder="Value" />
                                            <button type="button" onClick={() => setMint((m) => ({ ...m, attributes: m.attributes.filter((_, j) => j !== i) }))} style={{ border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.mutedText, borderRadius: 8, cursor: 'pointer' }}>×</button>
                                        </div>
                                    ))}
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <button type="button" onClick={() => setMint((m) => ({ ...m, attributes: [...m.attributes, { trait_type: '', value: '' }] }))} style={{ border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: '0.82rem' }}>+ attribute</button>
                                        <button type="button" disabled={mint.busy || !mint.to} onClick={doMint} style={{ border: 'none', background: theme.colors.accent, color: theme.colors.primaryBg, borderRadius: 8, padding: '6px 14px', cursor: mint.busy ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.85rem', opacity: mint.busy ? 0.6 : 1 }}>{mint.busy ? 'Minting…' : 'Mint'}</button>
                                        {mint.done && <span style={{ color: '#22c55e', fontSize: '0.85rem', alignSelf: 'center' }}>{mint.done}</span>}
                                        {mint.error && <span style={{ color: '#ef4444', fontSize: '0.85rem', alignSelf: 'center' }}>{mint.error}</span>}
                                    </div>
                                </div>
                            )}
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
                            <div style={{ fontSize: '1rem' }}>You own none of the {collection.totalSupply?.toString?.() || ''} tokens in this collection</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default NftCollectionCard;

