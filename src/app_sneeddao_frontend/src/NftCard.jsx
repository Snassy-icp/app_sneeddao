import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from './contexts/ThemeContext';
import { getNftImage, getNftName, getNftDescription, formatNftMetadata, getNftAttributes, getNftLinks } from './utils/NftUtils';
import PrincipalInput from './components/PrincipalInput';
import './NftCard.css';

const NftCard = ({ nft, collectionName, collectionSymbol, onSend , supportsIcrc37 = false, onApprove, onRevoke, collectionId }) => {
    const { theme } = useTheme();
    const [isExpanded, setIsExpanded] = useState(false);
    const [imageError, setImageError] = useState(false);
    
    const imageUrl = getNftImage(nft.metadata, nft);
    const nftName = getNftName(nft.metadata, nft.tokenId, nft);
    const description = getNftDescription(nft.metadata, nft);
    const formattedMetadata = formatNftMetadata(nft.metadata);
    const attributes = getNftAttributes(nft);
    const links = getNftLinks(nft);
    const [approveForm, setApproveForm] = useState({ open: false, spender: '', days: '', busy: false, error: '' });
    const fmtExpiry = (e) => (e && e.length ? new Date(Number(e[0] / 1_000_000n)).toLocaleString() : 'never');
    
    const handleHeaderClick = () => {
        setIsExpanded(!isExpanded);
    };
    
    const renderMetadataValue = (item) => {
        // Don't show image/logo fields in metadata list (already shown as image)
        const skipKeys = ['image', 'icrc7:image', 'url', 'icrc7:url', 'logo', 'icrc7:logo'];
        if (skipKeys.some(k => item.key.toLowerCase().includes(k))) {
            return null;
        }
        
        return (
            <div key={item.key} className="metadata-item" style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: `1px solid ${theme.colors.border}`
            }}>
                <span style={{ 
                    color: theme.colors.mutedText, 
                    fontSize: '0.85rem',
                    fontWeight: '500'
                }}>
                    {item.key}:
                </span>
                <span style={{ 
                    color: theme.colors.primaryText, 
                    fontSize: '0.85rem',
                    textAlign: 'right',
                    maxWidth: '60%',
                    wordBreak: 'break-word'
                }}>
                    {item.value}
                </span>
            </div>
        );
    };
    
    return (
        <div className="nft-card" style={{
            background: theme.colors.cardBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'all 0.2s ease'
        }}>
            {/* NFT Image */}
            <div 
                className="nft-image-container" 
                onClick={handleHeaderClick}
                style={{
                    width: '100%',
                    aspectRatio: '1',
                    background: theme.colors.secondaryBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    position: 'relative'
                }}
            >
                {imageUrl && !imageError ? (
                    <img 
                        src={imageUrl} 
                        alt={nftName}
                        onError={() => setImageError(true)}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                        }}
                    />
                ) : (
                    <div style={{ fontSize: '48px', color: theme.colors.mutedText, textAlign: 'center' }} title={imageUrl ? `The browser could not load ${imageUrl}` : 'No image in the metadata'}>
                        🖼️
                        {imageUrl && <div style={{ fontSize: '11px', marginTop: 4 }}>{imageError ? 'image did not load' : 'no image'}</div>}
                    </div>
                )}
                
                {/* Expand indicator overlay */}
                <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    background: `${theme.colors.primaryBg}cc`,
                    borderRadius: '50%',
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: theme.colors.primaryText,
                    fontSize: '14px',
                    fontWeight: 'bold',
                    backdropFilter: 'blur(4px)'
                }}>
                    {isExpanded ? '▼' : '▶'}
                </div>
            </div>
            
            {/* NFT Info */}
            <div style={{ padding: '12px' }}>
                <div 
                    onClick={handleHeaderClick}
                    style={{
                        cursor: 'pointer',
                        marginBottom: isExpanded ? '12px' : '0'
                    }}
                >
                    <div style={{
                        fontSize: '16px',
                        fontWeight: '600',
                        color: theme.colors.primaryText,
                        marginBottom: '4px',
                        wordBreak: 'break-word'
                    }}>
                        {nftName}
                    </div>
                    <div style={{
                        fontSize: '13px',
                        color: theme.colors.mutedText
                    }}>
                        {collectionSymbol} #{nft.tokenId.toString()}
                    </div>
                </div>
                {/* Always-visible actions: open the token page, put it up on Sneedex */}
                {collectionId && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px', marginBottom: isExpanded ? '12px' : '0' }}>
                        <Link to={`/nft_item?collection=${collectionId}&id=${nft.tokenId.toString()}`} onClick={(e) => e.stopPropagation()} title="Open this NFT's page"
                            style={{ flex: 1, textAlign: 'center', fontSize: '12px', padding: '5px 8px', borderRadius: '6px', border: `1px solid ${theme.colors.border}`, color: theme.colors.secondaryText, textDecoration: 'none' }}>View</Link>
                        <Link to={`/sneedex_create?nft=${collectionId}:${nft.tokenId.toString()}`} onClick={(e) => e.stopPropagation()} title="Create a Sneedex offer with this NFT pre-filled"
                            style={{ flex: 1, textAlign: 'center', fontSize: '12px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #8b5cf6', color: '#a78bfa', textDecoration: 'none', fontWeight: 600 }}>Sell on Sneedex</Link>
                    </div>
                )}
                
                {/* Expanded content */}
                {isExpanded && (
                    <div className="nft-expanded-content">
                        {/* Description */}
                        {description && (
                            <div style={{
                                padding: '12px 0',
                                borderTop: `1px solid ${theme.colors.border}`,
                                marginTop: '12px'
                            }}>
                                <div style={{
                                    fontSize: '0.85rem',
                                    color: theme.colors.secondaryText,
                                    lineHeight: '1.5'
                                }}>
                                    {description}
                                </div>
                            </div>
                        )}
                        
                        {/* ICRC-37 approvals: who may move this token */}
                        {supportsIcrc37 && (
                            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${theme.colors.border}` }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.colors.mutedText, marginBottom: 6 }}>Approvals</div>
                                {(nft.approvals || []).length === 0 && <div style={{ fontSize: '0.78rem', color: theme.colors.mutedText }}>Nobody else may move this token.</div>}
                                {(nft.approvals || []).map((a, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.78rem', color: theme.colors.primaryText, marginBottom: 4, flexWrap: 'wrap' }}>
                                        <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{a.spender.owner.toText()}</span>
                                        <span style={{ color: theme.colors.mutedText }}>until {fmtExpiry(a.expires_at)}</span>
                                        {onRevoke && <button type="button" onClick={(e) => { e.stopPropagation(); onRevoke(nft, a.spender.owner.toText()); }} style={{ border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.error || '#ef4444', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem' }}>Revoke</button>}
                                    </div>
                                ))}
                                {onApprove && !approveForm.open && <button type="button" onClick={(e) => { e.stopPropagation(); setApproveForm((f) => ({ ...f, open: true })); }} style={{ border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.accent, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: '0.78rem', marginTop: 4 }}>Approve a spender</button>}
                                {onApprove && approveForm.open && (
                                    <div style={{ display: 'grid', gap: 6, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                                        <PrincipalInput value={approveForm.spender} onChange={(v) => setApproveForm((f) => ({ ...f, spender: v }))} placeholder="Spender principal (a marketplace, a wallet)" defaultTab="all" style={{ width: '100%' }} inputStyle={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.8rem', boxSizing: 'border-box' }} />
                                        <input value={approveForm.days} onChange={(e) => setApproveForm((f) => ({ ...f, days: e.target.value }))} placeholder="Expires in days (empty: never)" style={{ padding: '6px 8px', borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.8rem' }} />
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <button type="button" disabled={approveForm.busy || !approveForm.spender} onClick={async () => { setApproveForm((f) => ({ ...f, busy: true, error: '' })); try { await onApprove(nft, approveForm.spender, approveForm.days ? Date.now() + Number(approveForm.days) * 86400e3 : null); setApproveForm({ open: false, spender: '', days: '', busy: false, error: '' }); } catch (err) { setApproveForm((f) => ({ ...f, busy: false, error: err?.message || String(err) })); } }} style={{ border: 'none', background: theme.colors.accent, color: theme.colors.primaryBg, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>{approveForm.busy ? 'Approving…' : 'Approve'}</button>
                                            <button type="button" onClick={() => setApproveForm({ open: false, spender: '', days: '', busy: false, error: '' })} style={{ border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.mutedText, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: '0.78rem' }}>Cancel</button>
                                        </div>
                                        {approveForm.error && <div style={{ color: '#ef4444', fontSize: '0.78rem' }}>{approveForm.error}</div>}
                                        <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>An approved spender can transfer this token out of your account until the approval expires, is revoked, or the token moves.</div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Action button */}
                        <div style={{
                            paddingTop: '12px',
                            borderTop: `1px solid ${theme.colors.border}`,
                            marginTop: '12px'
                        }}>
                            <button
                                onClick={() => onSend(nft)}
                                style={{
                                    width: '100%',
                                    background: theme.colors.accent,
                                    color: theme.colors.primaryBg,
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '10px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = theme.colors.accentHover;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = theme.colors.accent;
                                }}
                            >
                                <img 
                                    src="send-inverted.png" 
                                    alt="Send" 
                                    style={{ width: '16px', height: '16px' }}
                                />
                                Send NFT
                            </button>
                        </div>
                        
                        {/* Attributes (ICRC-97 or inline) */}
                        {attributes.length > 0 && (
                            <div style={{ marginTop: '12px' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.colors.mutedText, marginBottom: 6 }}>Attributes</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {attributes.map((a, i) => <span key={i} style={{ fontSize: '0.78rem', padding: '3px 8px', borderRadius: 8, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText }}><span style={{ color: theme.colors.mutedText }}>{a.trait_type}:</span> {a.value}</span>)}
                                </div>
                            </div>
                        )}
                        {/* Links in the metadata (the picture, documents), openable even when the browser will not render them here */}
                        {links.length > 0 && (
                            <div style={{ marginTop: '12px' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.colors.mutedText, marginBottom: 6 }}>Links</div>
                                {links.map((l, i) => <div key={i} style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}><span style={{ color: theme.colors.mutedText }}>{l.key}:</span> <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent }} onClick={(e) => e.stopPropagation()}>{l.url}</a></div>)}
                            </div>
                        )}
                        {nft.icrc97?.error && <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#f59e0b' }}>ICRC-97 document at {nft.icrc97.url} could not be read: {nft.icrc97.error}</div>}
                        {/* Metadata */}
                        {formattedMetadata.length > 0 && (
                            <div style={{
                                marginTop: '16px',
                                paddingTop: '12px',
                                borderTop: `1px solid ${theme.colors.border}`
                            }}>
                                <div style={{
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    color: theme.colors.primaryText,
                                    marginBottom: '8px'
                                }}>
                                    Metadata
                                </div>
                                <div>
                                    {formattedMetadata.map(item => renderMetadataValue(item))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default NftCard;

