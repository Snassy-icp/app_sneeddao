// /nft_item?collection=<canister>&id=<token>: one NFT's own page, like
// /transaction for a transaction. Shows everything the collection answers
// about it; owners get the wallet actions, everyone gets the facts.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';
import { FaImage, FaSpinner, FaSync, FaExternalLinkAlt, FaArrowLeft, FaTag, FaWallet } from 'react-icons/fa';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { uint8ArrayToHex } from '../utils/NeuronUtils';
import { fetchApprovals, getNftImage, getNftName, getNftDescription, getNftAttributes, getNftLinks, formatNftMetadata, getSavedNftCollections, NFT_COLLECTIONS_STORAGE_KEY } from '../utils/NftUtils';
import { loadCollectionInfoCached, loadTokensCached, nftCollectionUrl } from '../components/NftAssetView';
import { customStyles } from '../health/TreeView.jsx';

const primary = '#a18cd1';
const getHost = () => (process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943');

function NftItem() {
    const { theme } = useTheme();
    const [params] = useSearchParams();
    const { identity, isAuthenticated } = useAuth();
    const me = identity?.getPrincipal?.().toText?.() || null;
    const collection = params.get('collection') || '';
    const idText = params.get('id') || '';
    const [info, setInfo] = useState(null);
    const [token, setToken] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [approvals, setApprovals] = useState(null);
    const [rawOpen, setRawOpen] = useState(false);
    const [imgBroken, setImgBroken] = useState(false);

    const valid = useMemo(() => { try { Principal.fromText(collection); return /^\d+$/.test(idText); } catch { return false; } }, [collection, idText]);

    useEffect(() => {
        if (!valid) { setLoading(false); setError('Give a collection canister id and a token id.'); return; }
        let alive = true;
        setLoading(true); setError(''); setImgBroken(false);
        (async () => {
            try {
                const [i, ts] = await Promise.all([
                    loadCollectionInfoCached(collection).catch(() => null),
                    loadTokensCached(collection, [idText], { refresh: refreshKey > 0 }),
                ]);
                if (!alive) return;
                setInfo(i); setToken(ts[0] || null);
            } catch (e) { if (alive) setError(e?.message || String(e)); }
            finally { if (alive) setLoading(false); }
        })();
        return () => { alive = false; };
    }, [collection, idText, valid, refreshKey]);

    const ownerText = token?.owner?.owner?.toString?.() || null;
    const ownerSub = token?.owner?.subaccount?.length ? uint8ArrayToHex(token.owner.subaccount[0]) : null;
    const mine = !!(me && ownerText === me);

    // approvals are only meaningful to the owner and only on ICRC-37 collections
    useEffect(() => {
        if (!mine || !info?.standards?.icrc37 || !identity) { setApprovals(null); return; }
        let alive = true;
        const agent = HttpAgent.createSync({ host: getHost(), identity });
        fetchApprovals(collection, { owner: identity.getPrincipal(), subaccount: [] }, [BigInt(idText)], agent)
            .then((a) => { if (alive) setApprovals(a); }).catch(() => {});
        return () => { alive = false; };
    }, [mine, info?.standards?.icrc37, identity, collection, idText]);

    const img = token ? getNftImage(token.metadata, token) : null;
    const name = token ? getNftName(token.metadata, idText, token) : `NFT #${idText}`;
    const desc = token ? getNftDescription(token.metadata, token) : null;
    const attrs = token ? getNftAttributes(token) : [];
    const links = token ? getNftLinks(token) : [];
    const raw = token ? formatNftMetadata(token.metadata) : [];
    const inWallet = useMemo(() => getSavedNftCollections().includes(collection), [collection]);
    const addToWallet = () => { try { localStorage.setItem(NFT_COLLECTIONS_STORAGE_KEY, JSON.stringify([...new Set([...getSavedNftCollections(), collection])])); } catch { /* ignore */ } };

    const card = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem' };
    const label = { fontSize: '0.72rem', fontWeight: 600, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 };
    const btn = (accent) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: `1px solid ${accent || theme.colors.border}`, color: accent || theme.colors.primaryText, background: 'transparent', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' });

    return (
        <>
            <Header />
            <style>{customStyles}</style>
            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, fontSize: '0.85rem' }}>
                    <Link to={collection ? nftCollectionUrl(collection) : '/nfts'} style={{ color: theme.colors.accent, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}><FaArrowLeft size={11} /> {info ? info.name : 'Collection'}</Link>
                    <span style={{ color: theme.colors.mutedText }}>·</span>
                    <Link to="/nfts" style={{ color: theme.colors.mutedText, textDecoration: 'none' }}>All collections</Link>
                </div>
                {error && <div style={{ ...card, color: theme.colors.error }}>{error}</div>}
                {!error && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: 16 }} className="nft-item-grid">
                        <style>{`@media (max-width: 720px) { .nft-item-grid { grid-template-columns: 1fr !important; } }`}</style>
                        <div style={{ ...card, padding: 0, overflow: 'hidden', alignSelf: 'start' }}>
                            <div style={{ aspectRatio: '1 / 1', background: theme.colors.tertiaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                {loading ? <FaSpinner className="health-spin" size={28} color={theme.colors.mutedText} />
                                    : img && !imgBroken ? <img src={img} alt={name} onError={() => setImgBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                                    : <div style={{ textAlign: 'center', color: theme.colors.mutedText }}><FaImage size={48} color={primary} /><div style={{ fontSize: '0.8rem', marginTop: 8 }}>{token && !token.exists ? 'This token does not exist in the collection' : imgBroken ? 'The picture could not be loaded' : 'No picture in the metadata'}</div></div>}
                            </div>
                            {img && <div style={{ padding: '8px 12px', fontSize: '0.75rem' }}><a href={img} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}>open picture <FaExternalLinkAlt size={9} /></a></div>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={card}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <h1 style={{ margin: 0, fontSize: '1.5rem', color: theme.colors.primaryText, wordBreak: 'break-word' }}>{name}</h1>
                                        <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                            {info?.logo && <img src={info.logo} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover' }} />}
                                            <Link to={nftCollectionUrl(collection)} style={{ color: theme.colors.accent, textDecoration: 'none' }}>{info?.name || collection}</Link>
                                            {info?.symbol && <span>{info.symbol}</span>}
                                            <span style={{ fontFamily: 'monospace' }}>#{idText}</span>
                                        </div>
                                    </div>
                                    <button type="button" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading} title="Re-read from the collection" style={{ ...btn(), padding: '6px 10px' }}><FaSync className={loading ? 'health-spin' : ''} /></button>
                                </div>
                                {desc && <p style={{ margin: '12px 0 0', color: theme.colors.secondaryText, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{desc}</p>}
                            </div>

                            <div style={card}>
                                <div style={label}>Owner</div>
                                {ownerText ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                        <PrincipalDisplay principal={Principal.fromText(ownerText)} isAuthenticated={isAuthenticated} subaccount={ownerSub} />
                                        {mine && <span style={{ fontSize: '0.72rem', fontWeight: 700, background: '#10b981', color: 'white', padding: '2px 8px', borderRadius: 6 }}>YOURS</span>}
                                    </div>
                                ) : <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>{loading ? 'Reading…' : 'Unknown (the collection did not answer icrc7_owner_of, or the token does not exist)'}</div>}
                                {ownerSub && <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: 6, fontFamily: 'monospace', wordBreak: 'break-all' }}>subaccount {ownerSub}</div>}
                                {mine && (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                                        <Link to={`/sneedex_create?nft=${collection}:${idText}`} style={btn('#a78bfa')}><FaTag /> Sell on Sneedex</Link>
                                        <Link to="/nft" onClick={() => { if (!inWallet) addToWallet(); }} style={btn()}><FaWallet /> {inWallet ? 'Open in wallet' : 'Add collection to wallet'}</Link>
                                    </div>
                                )}
                                {!mine && isAuthenticated && !inWallet && <div style={{ marginTop: 10 }}><button type="button" onClick={addToWallet} style={btn()}>Add collection to my wallet</button></div>}
                            </div>

                            {mine && info?.standards?.icrc37 && (
                                <div style={card}>
                                    <div style={label}>Approvals (ICRC-37)</div>
                                    {!approvals ? <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Reading…</div> : (() => {
                                        const list = approvals.byToken?.get(idText) || [];
                                        const coll = approvals.collection || [];
                                        if (list.length === 0 && coll.length === 0) return <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>No spender is approved for this token. Approvals are managed in the NFT wallet.</div>;
                                        return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem' }}>
                                                {list.map((a, i) => <div key={`t${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ color: theme.colors.mutedText }}>token:</span><PrincipalDisplay principal={a.spender?.owner || a.spender} isAuthenticated={isAuthenticated} /></div>)}
                                                {coll.map((a, i) => <div key={`c${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ color: theme.colors.mutedText }}>whole collection:</span><PrincipalDisplay principal={a.spender?.owner || a.spender} isAuthenticated={isAuthenticated} /></div>)}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {attrs.length > 0 && (
                                <div style={card}>
                                    <div style={label}>Attributes</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                                        {attrs.map((a, i) => (
                                            <div key={i} style={{ background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: '8px 10px' }}>
                                                <div style={{ fontSize: '0.68rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{a.trait_type}</div>
                                                <div style={{ fontSize: '0.9rem', color: theme.colors.primaryText, fontWeight: 600, wordBreak: 'break-word' }}>{String(a.value)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(links.length > 0 || token?.icrc97?.url) && (
                                <div style={card}>
                                    <div style={label}>Links</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: '0.85rem' }}>
                                        {token?.icrc97?.url && <a href={token.icrc97.url} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}><FaExternalLinkAlt size={9} /> ICRC-97 document</a>}
                                        {links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}><FaExternalLinkAlt size={9} /> {l.key}</a>)}
                                    </div>
                                </div>
                            )}

                            <div style={card}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                    <div style={{ ...label, marginBottom: 0 }}>Metadata ({raw.length} field{raw.length === 1 ? '' : 's'})</div>
                                    <button type="button" onClick={() => setRawOpen((o) => !o)} style={{ background: 'none', border: 'none', color: theme.colors.accent, cursor: 'pointer', fontSize: '0.8rem' }}>{rawOpen ? 'Hide' : 'Show'}</button>
                                </div>
                                {rawOpen && (
                                    raw.length === 0 ? <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText, marginTop: 8 }}>The collection returned no metadata for this token.</div> : (
                                        <div style={{ marginTop: 10, fontSize: '0.78rem', fontFamily: 'monospace', color: theme.colors.secondaryText, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', wordBreak: 'break-all' }}>
                                            {raw.map((r, i) => <React.Fragment key={i}><span style={{ color: theme.colors.mutedText }}>{r.key}</span><span>{r.value.length > 600 ? `${r.value.slice(0, 600)}…` : r.value}</span></React.Fragment>)}
                                        </div>
                                    )
                                )}
                                {rawOpen && token?.icrc97 && (
                                    <div style={{ marginTop: 10 }}>
                                        <div style={label}>ICRC-97 document</div>
                                        <pre style={{ margin: 0, fontSize: '0.74rem', color: theme.colors.secondaryText, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 320, overflow: 'auto' }}>{JSON.stringify(token.icrc97, null, 2)}</pre>
                                    </div>
                                )}
                            </div>

                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: 'monospace' }}>{collection}</span>
                                <a href={`https://dashboard.internetcomputer.org/canister/${collection}`} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent }}>collection on the dashboard</a>
                                {info?.standards && <span>{['icrc7', 'icrc37', 'icrc10', 'icrc3'].filter((k) => info.standards[k]).map((k) => k.toUpperCase().replace('ICRC', 'ICRC-')).join(' · ')}</span>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

export default NftItem;
