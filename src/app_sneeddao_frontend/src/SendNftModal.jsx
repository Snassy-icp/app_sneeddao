import React, { useState, useEffect } from 'react';
import { Principal } from '@dfinity/principal';
import { useTheme } from './contexts/ThemeContext';
import { getNftImage, getNftName } from './utils/NftUtils';
import { accountId as extAccountId, isValidAccountId } from './utils/ExtUtils';
import PrincipalInput from './components/PrincipalInput';
import { PrincipalDisplay } from './utils/PrincipalUtils';
import './SendNftModal.css';

/// The EXT send dialog: one NFT, to a principal or an account id, with a confirm step that shows
/// exactly where it goes. `onConfirm(to)` gets { principal: text } or { address: hex }.
const ExtSendNftModal = ({ onClose, nft, collection, onConfirm }) => {
    const { theme } = useTheme();
    const [mode, setMode] = useState('principal'); // 'principal' | 'address'
    const [recipient, setRecipient] = useState('');
    const [address, setAddress] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');
    const principalText = recipient.trim();
    const addressText = address.trim().toLowerCase().replace(/^0x/, '');
    let principalOk = false;
    try { principalOk = !!principalText && !Principal.fromText(principalText).isAnonymous(); } catch { principalOk = false; }
    const addressOk = isValidAccountId(addressText);
    const valid = mode === 'principal' ? principalOk : addressOk;
    const targetAid = mode === 'principal' ? (principalOk ? extAccountId(principalText) : null) : (addressOk ? addressText : null);
    const ownAid = nft.ownerAccountId || null;
    const toSelf = !!(targetAid && ownAid && targetAid === ownAid);
    const imageUrl = getNftImage(nft.metadata, nft);
    const nftName = getNftName(nft.metadata, nft.tokenId, nft);
    const box = { width: '100%', padding: '12px', borderRadius: '8px', border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '14px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' };
    const tab = (on) => ({ flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, border: `1px solid ${on ? theme.colors.accent : theme.colors.border}`, background: on ? `${theme.colors.accent}22` : 'transparent', color: on ? theme.colors.primaryText : theme.colors.mutedText });
    const send = async () => {
        setIsSending(true); setError('');
        try {
            await onConfirm(mode === 'principal' ? { principal: principalText } : { address: addressText });
            onClose();
        } catch (e) { setError(e?.message || 'Failed to send NFT'); setConfirming(false); }
        finally { setIsSending(false); }
    };
    return (
        <div className="modal-overlay" onClick={isSending ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ background: theme.colors.primaryBg, borderRadius: '16px', maxWidth: '500px', width: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)' }}>
                <div style={{ padding: '24px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '600', color: theme.colors.primaryText }}>Send NFT</h2>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: '#0ea5e933', color: '#38bdf8' }}>EXT</span>
                </div>
                <div style={{ padding: '24px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: 80, height: 80, borderRadius: 8, background: theme.colors.secondaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                        {imageUrl ? <img src={imageUrl} alt={nftName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '32px' }}>🖼️</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.primaryText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nftName}</div>
                        <div style={{ fontSize: 14, color: theme.colors.mutedText }}>{collection.name}</div>
                        <div style={{ fontSize: 12, color: theme.colors.mutedText, fontFamily: 'monospace' }}>token index {nft.index ?? nft.tokenId.toString()}</div>
                    </div>
                </div>
                <div style={{ padding: '24px' }}>
                    {!confirming ? (
                        <>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                                <button type="button" style={tab(mode === 'principal')} onClick={() => setMode('principal')} disabled={isSending}>To a principal</button>
                                <button type="button" style={tab(mode === 'address')} onClick={() => setMode('address')} disabled={isSending}>To an account id</button>
                            </div>
                            {mode === 'principal' ? (
                                <div style={{ marginBottom: 16 }}>
                                    <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 500, color: theme.colors.primaryText }}>Recipient principal</label>
                                    <PrincipalInput value={recipient} onChange={setRecipient} placeholder="Principal or name" defaultTab="all" disabled={isSending} style={{ width: '100%' }} inputStyle={box} />
                                    <div style={{ fontSize: 12, color: theme.colors.mutedText, marginTop: 6 }}>It goes to the principal's default account{principalOk ? <> (account id <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{targetAid}</span>)</> : ''}.</div>
                                </div>
                            ) : (
                                <div style={{ marginBottom: 16 }}>
                                    <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 500, color: theme.colors.primaryText }}>Recipient account id</label>
                                    <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="64 hex characters" disabled={isSending} spellCheck={false}
                                        style={{ ...box, border: `1px solid ${!address || addressOk ? theme.colors.border : theme.colors.error}` }} />
                                    <div style={{ fontSize: 12, color: address && !addressOk ? theme.colors.error : theme.colors.mutedText, marginTop: 6 }}>
                                        {address && !addressOk ? 'Not a valid account id: it needs 64 hex characters with a matching checksum.' : 'An ICP-style account identifier, as marketplaces and the NNS show it.'}
                                    </div>
                                </div>
                            )}
                            {toSelf && <div style={{ color: theme.colors.error, fontSize: 13, marginBottom: 12 }}>That is the account that already holds it.</div>}
                        </>
                    ) : (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 14, color: theme.colors.primaryText, marginBottom: 10, fontWeight: 600 }}>Send {nftName} to:</div>
                            <div style={{ padding: 12, borderRadius: 8, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, display: 'grid', gap: 6 }}>
                                {mode === 'principal' && <><span style={{ fontSize: 12, color: theme.colors.mutedText }}>Principal</span><PrincipalDisplay principal={Principal.fromText(principalText)} showSendMessage={false} /><span style={{ fontFamily: 'monospace', fontSize: 12, color: theme.colors.primaryText, wordBreak: 'break-all' }}>{principalText}</span></>}
                                <span style={{ fontSize: 12, color: theme.colors.mutedText }}>{mode === 'principal' ? 'Its default account id' : 'Account id'}</span>
                                <span style={{ fontFamily: 'monospace', fontSize: 12, color: theme.colors.primaryText, wordBreak: 'break-all' }}>{targetAid}</span>
                            </div>
                            <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: `${theme.colors.error}15`, border: `1px solid ${theme.colors.error}40`, color: theme.colors.primaryText, fontSize: 13, lineHeight: 1.45 }}>
                                A transfer cannot be undone. Check the recipient: an NFT sent to a wrong principal or account id is gone.
                            </div>
                        </div>
                    )}
                    {error && <div style={{ padding: 12, borderRadius: 8, background: `${theme.colors.error}20`, border: `1px solid ${theme.colors.error}40`, color: theme.colors.error, fontSize: 14, marginBottom: 16, wordBreak: 'break-word' }}>{error}</div>}
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button type="button" onClick={confirming ? () => setConfirming(false) : onClose} disabled={isSending} style={{ padding: '12px 24px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, fontSize: 14, cursor: isSending ? 'not-allowed' : 'pointer', opacity: isSending ? 0.6 : 1 }}>{confirming ? 'Back' : 'Cancel'}</button>
                        {!confirming ? (
                            <button type="button" onClick={() => { setError(''); setConfirming(true); }} disabled={!valid || toSelf} style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: valid && !toSelf ? theme.colors.accent : theme.colors.mutedText, color: theme.colors.primaryBg, fontSize: 14, fontWeight: 600, cursor: valid && !toSelf ? 'pointer' : 'not-allowed', opacity: valid && !toSelf ? 1 : 0.6 }}>Review</button>
                        ) : (
                            <button type="button" onClick={send} disabled={isSending} style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: theme.colors.accent, color: theme.colors.primaryBg, fontSize: 14, fontWeight: 600, cursor: isSending ? 'not-allowed' : 'pointer', opacity: isSending ? 0.6 : 1 }}>{isSending ? 'Sending…' : 'Confirm and send'}</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

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
    if (collection.standard === 'EXT') return <ExtSendNftModal key={`${collection.canisterId}:${nft.tokenId}`} onClose={onClose} nft={nft} collection={collection} onConfirm={onConfirm} />;
    
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
                    background: theme.colors.primaryBg,
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

