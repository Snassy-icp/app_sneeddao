// Pick an ICRC-7 NFT from your wallet's collections to show as your avatar (sneed_pid_names
// set_my_nft_avatar). The naming canister checks you own it; clients check again when they show
// it, so after a sale your other avatar shows instead.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { anonymousNftAgent, getSavedNftCollections, loadNftCollection, getNftImage, getNftName } from '../utils/NftUtils';
import { setMyNftAvatar } from '../utils/NamingService';

export default function NftAvatarPicker({ identity, accent, current, onChanged }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const [open, setOpen] = useState(false);
    const [collections, setCollections] = useState(null); // [{ canisterId, name, nfts: [{ tokenId, image, name }] }]
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(null); // `${collection}:${tokenId}` being saved, or 'clear'
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open || collections || !identity) return;
        let alive = true;
        setLoading(true);
        const agent = anonymousNftAgent();
        const me = { owner: identity.getPrincipal(), subaccount: [] };
        Promise.allSettled(getSavedNftCollections().map(async (id) => {
            const col = await loadNftCollection(id, me, identity, agent);
            return { canisterId: id, name: col.name, nfts: col.nfts.map((n) => ({ tokenId: n.tokenId, image: getNftImage(n.metadata, n), name: getNftName(n.metadata, n.tokenId, n) })) };
        })).then((rs) => {
            if (!alive) return;
            setCollections(rs.filter((r) => r.status === 'fulfilled' && r.value.nfts.length).map((r) => r.value));
            setLoading(false);
        });
        return () => { alive = false; };
    }, [open, collections, identity]);

    const pick = async (collection, nft) => {
        setBusy(`${collection}:${nft.tokenId}`); setError('');
        const r = await setMyNftAvatar(identity, collection, nft.tokenId);
        setBusy(null);
        if ('ok' in r) { setOpen(false); onChanged?.(nft.image || null, { collection, token_id: nft.tokenId.toString() }); }
        else setError(r.err);
    };
    const clear = async () => {
        setBusy('clear'); setError('');
        const r = await setMyNftAvatar(identity, null);
        setBusy(null);
        if ('ok' in r) onChanged?.(null, null);
        else setError(r.err);
    };

    const button = { background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: '10px', color: c.primaryText, padding: '0.6rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem' };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: `1px solid ${c.border}`, paddingTop: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" style={button} onClick={() => setOpen((v) => !v)}>{open ? 'Hide my NFTs' : 'Use an NFT I own…'}</button>
                {current && (
                    <>
                        <span style={{ fontSize: '0.8rem', color: c.mutedText }}>Showing an NFT (token #{current.token_id}). Your picture above shows if you sell it.</span>
                        <button type="button" disabled={busy === 'clear'} onClick={clear} style={{ ...button, background: 'transparent', borderColor: c.error, color: c.error }}>{busy === 'clear' ? 'Stopping…' : 'Stop showing the NFT'}</button>
                    </>
                )}
            </div>
            {open && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {loading && <div style={{ fontSize: '0.8rem', color: c.mutedText }}>Looking through your NFT collections…</div>}
                    {!loading && collections && collections.length === 0 && (
                        <div style={{ fontSize: '0.8rem', color: c.mutedText }}>
                            No NFTs found in the collections of your <Link to="/nft" style={{ color: accent }}>NFT wallet</Link>. Add a collection there, or open any NFT you own and choose "Use as my avatar".
                        </div>
                    )}
                    {(collections || []).map((col) => (
                        <div key={col.canisterId}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: c.secondaryText, marginBottom: '0.35rem' }}>{col.name}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '0.5rem' }}>
                                {col.nfts.map((n) => {
                                    const key = `${col.canisterId}:${n.tokenId}`;
                                    const chosen = current && current.collection === col.canisterId && current.token_id === n.tokenId.toString();
                                    return (
                                        <button key={key} type="button" title={n.name} disabled={!!busy || !n.image} onClick={() => pick(col.canisterId, n)}
                                            style={{ padding: 0, border: `2px solid ${chosen ? accent : c.border}`, borderRadius: '12px', background: c.secondaryBg, cursor: n.image ? 'pointer' : 'not-allowed', aspectRatio: '1', overflow: 'hidden', opacity: busy && busy !== key ? 0.5 : 1 }}>
                                            {n.image
                                                ? <img src={n.image} alt={n.name} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : <span style={{ fontSize: '0.65rem', color: c.mutedText }}>no picture</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {error && <div style={{ color: c.error, fontSize: '0.8rem' }}>{error}</div>}
        </div>
    );
}
