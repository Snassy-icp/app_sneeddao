// /nfts: browse any ICRC-7 collection the way /positions browses pools and
// /neurons browses neurons. No login needed; tokens you own are marked.
// ?collection=<canister> opens a collection; each tile opens /nft_item.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { FaImage, FaSpinner, FaSync, FaWallet, FaExternalLinkAlt } from 'react-icons/fa';
import Header from '../components/Header';
import PrincipalInput from '../components/PrincipalInput';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { anonymousNftAgent, fetchCollectionTokenIds, getSavedNftCollections, NFT_COLLECTIONS_STORAGE_KEY, getNftImage, getNftName } from '../utils/NftUtils';
import { loadCollectionInfoCached, loadTokensCached, nftItemUrl, useNftTokens } from '../components/NftAssetView';
import { customStyles } from '../health/TreeView.jsx';

const primary = '#a18cd1';
const RECENT_KEY = 'nft_browsed_collections';
const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const pushRecent = (id) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 12))); } catch { /* ignore */ } };

function CollectionChip({ id, onPick, active, theme }) {
    const { info } = useNftTokens(id, []);
    return (
        <button type="button" onClick={() => onPick(id)} title={id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${active ? primary : theme.colors.border}`, background: active ? `${primary}22` : theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.85rem' }}>
            {info?.logo ? <img src={info.logo} alt="" style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover' }} /> : <FaImage style={{ color: primary }} />}
            <span>{info?.name || `${id.slice(0, 5)}…${id.slice(-3)}`}</span>
            {info?.symbol && <span style={{ color: theme.colors.mutedText }}>{info.symbol}</span>}
        </button>
    );
}

function NftBrowser() {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { identity, isAuthenticated } = useAuth();
    const me = identity?.getPrincipal?.().toText?.() || null;
    const collection = params.get('collection') || '';
    const [input, setInput] = useState(collection);
    const [info, setInfo] = useState(null);
    const [infoError, setInfoError] = useState('');
    const [ids, setIds] = useState([]); // BigInt ids in page order
    const [tokens, setTokens] = useState(new Map()); // id text -> detail
    const [cursor, setCursor] = useState(null); // last id seen, null = start
    const [done, setDone] = useState(false);
    const [loading, setLoading] = useState(false);
    const [onlyMine, setOnlyMine] = useState(false);
    const [error, setError] = useState('');
    const saved = useMemo(() => getSavedNftCollections(), [collection]);
    const recent = useMemo(() => readRecent().filter((x) => !saved.includes(x)), [saved, collection]);
    const PAGE = 48;

    useEffect(() => { setInput(collection); }, [collection]);

    const loadPage = useCallback(async (fromCursor, reset) => {
        if (!collection) return;
        setLoading(true); setError('');
        try {
            const agent = anonymousNftAgent();
            const page = await fetchCollectionTokenIds(collection, agent, fromCursor, PAGE);
            setIds((prev) => { const seen = new Set((reset ? [] : prev).map((x) => x.toString())); const add = page.ids.filter((x) => !seen.has(x.toString())); return reset ? add : [...prev, ...add]; });
            setCursor(page.last); setDone(page.done || page.ids.length === 0);
            // details arrive in batches so the tiles fill in progressively
            for (let i = 0; i < page.ids.length; i += 12) {
                const batch = page.ids.slice(i, i + 12);
                const got = await loadTokensCached(collection, batch);
                setTokens((prev) => { const next = new Map(prev); for (const t of got) next.set(t.tokenId.toString(), t); return next; });
            }
        } catch (e) {
            setError(e?.message || String(e));
        } finally { setLoading(false); }
    }, [collection]);

    useEffect(() => {
        if (!collection) { setInfo(null); setIds([]); setTokens(new Map()); return; }
        let alive = true;
        setInfo(null); setInfoError(''); setIds([]); setTokens(new Map()); setCursor(null); setDone(false);
        try { Principal.fromText(collection); } catch { setInfoError('That is not a canister id.'); return; }
        pushRecent(collection);
        loadCollectionInfoCached(collection).then((i) => { if (alive) setInfo(i); }).catch((e) => { if (alive) setInfoError(e?.message || String(e)); });
        loadPage(null, true);
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collection]);

    const open = (id) => { const t = (id || '').trim(); if (!t) return; navigate(`/nfts?collection=${t}`); };
    const isSaved = saved.includes(collection);
    const addToWallet = () => { try { localStorage.setItem(NFT_COLLECTIONS_STORAGE_KEY, JSON.stringify([...new Set([...getSavedNftCollections(), collection])])); } catch { /* ignore */ } navigate('/nft'); };

    const shown = ids.filter((id) => !onlyMine || tokens.get(id.toString())?.owner?.owner?.toString?.() === me);
    const mineCount = me ? ids.filter((id) => tokens.get(id.toString())?.owner?.owner?.toString?.() === me).length : 0;

    const card = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem' };
    return (
        <>
            <Header />
            <style>{customStyles}</style>
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
                    <h1 style={{ color: theme.colors.primaryText, fontSize: '1.6rem', margin: 0 }}>NFTs</h1>
                    <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Browse any ICRC-7 collection, owned or not. Every token has its own page.</span>
                </div>
                <div style={{ ...card, marginTop: 12, marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 240 }}>
                            <PrincipalInput value={input} onChange={setInput} placeholder="Collection canister id or name" defaultTab="all" defaultPrincipalType="canisters" isAuthenticated={isAuthenticated} onKeyDown={(e) => { if (e.key === 'Enter') open(input); }} onSelect={(p) => open(p)} />
                        </div>
                        <button type="button" onClick={() => open(input)} disabled={!input.trim()} style={{ background: primary, color: '#1a1030', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 600, cursor: 'pointer', opacity: input.trim() ? 1 : 0.6 }}>Browse</button>
                        {isAuthenticated && <Link to="/nft" style={{ color: theme.colors.accent, fontSize: '0.85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}><FaWallet /> My NFT wallet</Link>}
                    </div>
                    {(saved.length > 0 || recent.length > 0) && (
                        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {saved.length > 0 && <div><div style={{ fontSize: '0.72rem', color: theme.colors.mutedText, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>In your wallet</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{saved.map((id) => <CollectionChip key={id} id={id} onPick={open} active={id === collection} theme={theme} />)}</div></div>}
                            {recent.length > 0 && <div><div style={{ fontSize: '0.72rem', color: theme.colors.mutedText, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Recently browsed</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{recent.map((id) => <CollectionChip key={id} id={id} onPick={open} active={id === collection} theme={theme} />)}</div></div>}
                        </div>
                    )}
                </div>

                {collection && (
                    <div style={card}>
                        {infoError && <div style={{ color: theme.colors.error, marginBottom: 8 }}>Could not read the collection: {infoError}</div>}
                        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
                            <div style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', background: theme.colors.tertiaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {info?.logo ? <img src={info.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FaImage size={26} color={primary} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 200 }}>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.colors.primaryText }}>{info ? info.name : (infoError ? 'Unknown collection' : 'Reading collection…')} {info?.symbol && <span style={{ fontWeight: 400, color: theme.colors.mutedText }}>({info.symbol})</span>}</div>
                                <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                                    <span style={{ fontFamily: 'monospace' }}>{collection}</span>
                                    {info?.totalSupply !== undefined && info?.totalSupply !== null && <span>supply {info.totalSupply.toString()}</span>}
                                    {info?.standards && <span>{['icrc7', 'icrc37', 'icrc10', 'icrc3'].filter((k) => info.standards[k]).map((k) => k.toUpperCase().replace('ICRC', 'ICRC-')).join(' · ') || 'standards unknown'}</span>}
                                    <a href={`https://dashboard.internetcomputer.org/canister/${collection}`} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}>dashboard <FaExternalLinkAlt size={9} /></a>
                                </div>
                                {info?.description && <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, marginTop: 6, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{info.description}</div>}
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {isAuthenticated && !isSaved && <button type="button" onClick={addToWallet} style={{ background: 'transparent', border: `1px solid ${theme.colors.border}`, borderRadius: 10, color: theme.colors.primaryText, padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem' }}>Add to my wallet</button>}
                                <button type="button" onClick={() => { setTokens(new Map()); setIds([]); setCursor(null); setDone(false); loadPage(null, true); }} disabled={loading} style={{ background: 'transparent', border: `1px solid ${theme.colors.border}`, borderRadius: 10, color: theme.colors.secondaryText, padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}><FaSync className={loading ? 'health-spin' : ''} /> Refresh</button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, fontSize: '0.85rem', color: theme.colors.mutedText }}>
                            <span>{ids.length} token{ids.length === 1 ? '' : 's'} listed{done ? '' : ' so far'}</span>
                            {me && <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> only mine ({mineCount})</label>}
                            {loading && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><FaSpinner className="health-spin" /> loading…</span>}
                        </div>
                        {error && <div style={{ color: theme.colors.error, marginBottom: 8 }}>{error}</div>}
                        {!loading && ids.length === 0 && !error && <div style={{ color: theme.colors.mutedText, padding: '2rem', textAlign: 'center' }}>No tokens listed{info ? ' in this collection' : ''}.</div>}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                            {shown.map((id) => {
                                const key = id.toString();
                                const t = tokens.get(key);
                                const img = t ? getNftImage(t.metadata, t) : null;
                                const name = t ? getNftName(t.metadata, id, t) : `#${key}`;
                                const mine = me && t?.owner?.owner?.toString?.() === me;
                                return (
                                    <Link key={key} to={nftItemUrl(collection, id)} style={{ textDecoration: 'none', background: theme.colors.secondaryBg, border: `1px solid ${mine ? '#10b981' : theme.colors.border}`, borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                        <div style={{ aspectRatio: '1 / 1', background: theme.colors.tertiaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                                            {img ? <img src={img} alt={name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : (t ? <FaImage size={28} color={primary} /> : <FaSpinner className="health-spin" color={theme.colors.mutedText} />)}
                                            {mine && <span style={{ position: 'absolute', top: 6, left: 6, fontSize: '0.65rem', fontWeight: 700, background: '#10b981', color: 'white', padding: '2px 6px', borderRadius: 6 }}>YOURS</span>}
                                        </div>
                                        <div style={{ padding: '6px 8px' }}>
                                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.colors.primaryText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                            <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontFamily: 'monospace' }}>#{key}</div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                        {!done && ids.length > 0 && (
                            <div style={{ textAlign: 'center', marginTop: 14 }}>
                                <button type="button" onClick={() => loadPage(cursor, false)} disabled={loading} style={{ background: primary, color: '#1a1030', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>{loading ? 'Loading…' : 'Load more'}</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

export default NftBrowser;
