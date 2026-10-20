// Shared views of ICRC-7 tokens outside the NFT wallet: an icon, a title and a
// detail grid for a (collection, token ids) pair. Used by Sneedex offers, the
// NFT browser and the token page. Reads are anonymous, so they work logged out.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaImage, FaExternalLinkAlt } from 'react-icons/fa';
import { boundTo, SoulboundBadge } from './Soulbound';
import { useTheme } from '../contexts/ThemeContext';
import { isKnownExtCollection, isExtCollection, fetchExtCollectionInfo, fetchRegistry, tokenMetadata as extTokenMetadata, extTokenView } from '../utils/ExtUtils';
import { anonymousNftAgent, verifyIcrc7Support, fetchCollectionInfo, fetchTokenDetails, getNftImage, getNftName, getNftDescription, getNftAttributes, getNftLinks, formatNftMetadata, getNftMedia } from '../utils/NftUtils';

const collectionCache = new Map(); // id -> Promise<info>
const tokenCache = new Map(); // `${collection}:${id}` -> token detail
const standardCache = new Map(); // id -> Promise<'ICRC-7' | 'EXT'>

/// 'EXT' for the EXT collections this browser knows and for canisters that answer as EXT but not as ICRC-7; else 'ICRC-7'.
export function collectionStandardCached(collectionId) {
    if (isKnownExtCollection(collectionId)) return Promise.resolve('EXT');
    if (!standardCache.has(collectionId)) {
        const agent = anonymousNftAgent();
        const p = (async () => {
            if (await verifyIcrc7Support(collectionId, agent)) return 'ICRC-7';
            return (await isExtCollection(collectionId, agent)) ? 'EXT' : 'ICRC-7';
        })().catch(() => 'ICRC-7');
        standardCache.set(collectionId, p);
    }
    return standardCache.get(collectionId);
}

export function loadCollectionInfoCached(collectionId) {
    if (!collectionCache.has(collectionId)) {
        const p = collectionStandardCached(collectionId).then((std) => (std === 'EXT' ? fetchExtCollectionInfo(collectionId, anonymousNftAgent()) : fetchCollectionInfo(collectionId, anonymousNftAgent())));
        p.catch(() => collectionCache.delete(collectionId));
        collectionCache.set(collectionId, p);
    }
    return collectionCache.get(collectionId);
}

export async function loadTokensCached(collectionId, tokenIds, { refresh = false } = {}) {
    const want = tokenIds.map((x) => x.toString());
    const missing = refresh ? want : want.filter((id) => !tokenCache.has(`${collectionId}:${id}`));
    if (missing.length && (await collectionStandardCached(collectionId)) === 'EXT') {
        // EXT: holders from the registry (an account id each, not a principal), pictures and traits from each token's metadata
        const agent = anonymousNftAgent();
        const idx = missing.map(Number);
        const [registry, metas] = await Promise.all([fetchRegistry(collectionId, agent, { refresh }), extTokenMetadata(collectionId, idx, agent, { refresh })]);
        const holder = new Map(registry.map((r) => [r.index, r.accountId]));
        for (const i of idx) tokenCache.set(`${collectionId}:${i}`, extTokenView(collectionId, i, metas.get(i), holder.get(i) || null));
    } else if (missing.length) {
        const got = await fetchTokenDetails(collectionId, missing, anonymousNftAgent());
        for (const t of got) tokenCache.set(`${collectionId}:${t.tokenId.toString()}`, t);
    }
    return want.map((id) => tokenCache.get(`${collectionId}:${id}`)).filter(Boolean);
}

/// { info, tokens, loading, error } for a collection and some of its tokens.
export function useNftTokens(collectionId, tokenIds, { refreshKey = 0 } = {}) {
    const key = `${collectionId}:${(tokenIds || []).map((x) => x.toString()).join(',')}`;
    const [state, setState] = useState({ info: null, tokens: [], loading: true, error: '' });
    useEffect(() => {
        let alive = true;
        if (!collectionId) { setState({ info: null, tokens: [], loading: false, error: '' }); return; }
        setState((s) => ({ ...s, loading: true, error: '' }));
        (async () => {
            try {
                const [info, tokens] = await Promise.all([
                    loadCollectionInfoCached(collectionId).catch(() => null),
                    loadTokensCached(collectionId, tokenIds || [], { refresh: refreshKey > 0 }),
                ]);
                if (alive) setState({ info, tokens, loading: false, error: '' });
            } catch (e) {
                if (alive) setState({ info: null, tokens: [], loading: false, error: e?.message || String(e) });
            }
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, refreshKey]);
    return state;
}

export const nftItemUrl = (collectionId, tokenId) => `/nft_item?collection=${collectionId}&id=${tokenId.toString()}`;
export const nftCollectionUrl = (collectionId) => `/nfts?collection=${collectionId}`;

/// A square thumbnail: the first token's picture, else the collection logo, else a placeholder.
export function NftAssetIcon({ collectionId, tokenIds, size = 36, radius = 8 }) {
    const { info, tokens } = useNftTokens(collectionId, (tokenIds || []).slice(0, 1));
    const t = tokens[0];
    const img = (t && getNftImage(t.metadata, t)) || info?.logo || null;
    return (
        <div style={{ width: size, height: size, flexShrink: 0, borderRadius: radius, overflow: 'hidden', background: 'rgba(161,140,209,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FaImage style={{ fontSize: Math.round(size * 0.55), color: '#a18cd1' }} />}
        </div>
    );
}

/// "Name · Collection (SYMBOL)" with links to the token page and the collection browser.
export function NftAssetTitle({ collectionId, tokenIds, linkStyle = {} }) {
    const { theme } = useTheme();
    const ids = tokenIds || [];
    const { info, tokens } = useNftTokens(collectionId, ids.slice(0, 1));
    const t = tokens[0];
    const name = ids.length === 1 ? (t ? getNftName(t.metadata, ids[0], t) : `NFT #${ids[0]}`) : `${ids.length} NFTs`;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
            {ids.length === 1 ? <Link to={nftItemUrl(collectionId, ids[0])} style={{ color: 'inherit', textDecoration: 'none', ...linkStyle }}>{name}</Link> : <span>{name}</span>}
            <Link to={nftCollectionUrl(collectionId)} style={{ fontSize: '0.8rem', fontWeight: 400, color: theme.colors.accent, textDecoration: 'none' }}>
                {info ? `${info.name}${info.symbol ? ` (${info.symbol})` : ''}` : collectionId}
            </Link>
        </span>
    );
}

/// Everything we can read about each token: picture, name, description, attributes, links, raw metadata.
export function NftAssetDetails({ collectionId, tokenIds, me = null }) {
    const { theme } = useTheme();
    const { info, tokens, loading, error } = useNftTokens(collectionId, tokenIds || []);
    const [rawOpen, setRawOpen] = useState({});
    const ids = tokenIds || [];
    const label = { fontSize: '0.72rem', fontWeight: 600, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 };
    return (
        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '1rem', padding: '1rem', background: theme.colors.secondaryBg, borderRadius: 10, border: `1px solid ${theme.colors.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {info?.logo && <img src={info.logo} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} />}
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: theme.colors.primaryText }}>{info?.name || 'Collection'} {info?.symbol && <span style={{ color: theme.colors.mutedText, fontWeight: 400 }}>({info.symbol})</span>}</div>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'monospace' }}>{collectionId}</span>
                        {info?.totalSupply !== undefined && info?.totalSupply !== null && <span>· supply {info.totalSupply.toString()}</span>}
                        {info?.standards?.icrc37 && <span>· ICRC-37 approvals</span>}
                        <Link to={nftCollectionUrl(collectionId)} style={{ color: theme.colors.accent, textDecoration: 'none' }}>Browse collection</Link>
                    </div>
                </div>
            </div>
            {loading && <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Reading the token{ids.length === 1 ? '' : 's'}…</div>}
            {error && <div style={{ fontSize: '0.85rem', color: theme.colors.error }}>Could not read the collection: {error}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {ids.map((id) => {
                    const t = tokens.find((x) => x.tokenId.toString() === id.toString());
                    const img = t ? getNftImage(t.metadata, t) : null;
                    const name = t ? getNftName(t.metadata, id, t) : `NFT #${id}`;
                    const desc = t ? getNftDescription(t.metadata, t) : null;
                    const attrs = t ? getNftAttributes(t) : [];
                    const links = t ? getNftLinks(t) : [];
                    const raw = t ? formatNftMetadata(t.metadata) : [];
                    const media = t ? getNftMedia(t) : null;
                    const ownerText = t?.owner?.owner?.toString?.() || null;
                    const key = id.toString();
                    return (
                        <div key={key} style={{ background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                            <Link to={nftItemUrl(collectionId, id)} style={{ display: 'block', aspectRatio: '1 / 1', background: theme.colors.tertiaryBg, overflow: 'hidden' }}>
                                {img ? <img src={img} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, color: theme.colors.mutedText }}><FaImage size={34} color="#a18cd1" /><span style={{ fontSize: '0.75rem' }}>{t && !t.exists ? 'token not found' : 'no picture'}</span></div>}
                            </Link>
                            {media?.kind === 'audio' && <audio controls preload="none" src={media.url} style={{ width: '100%', display: 'block', height: 36 }} />}
                            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                                    <Link to={nftItemUrl(collectionId, id)} style={{ fontWeight: 600, color: theme.colors.primaryText, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Link>
                                    <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText, fontFamily: 'monospace', flexShrink: 0 }}>{t && boundTo(t.metadata) && <SoulboundBadge style={{ marginRight: 6, fontFamily: 'inherit' }} />}{media?.kind === 'model' && <span title="Has a 3D model - open it to turn it around" style={{ marginRight: 6, fontFamily: 'inherit', fontWeight: 700, color: theme.colors.accent }}>3D</span>}#{key}</span>
                                </div>
                                {desc && <div style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{desc}</div>}
                                {!ownerText && t?.ownerAccountId && (
                                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>
                                        Holder account: <span style={{ fontFamily: 'monospace' }}>{t.ownerAccountId.slice(0, 8)}…{t.ownerAccountId.slice(-6)}</span>
                                    </div>
                                )}
                                {ownerText && (
                                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>
                                        Owner: <span style={{ fontFamily: 'monospace' }}>{ownerText.slice(0, 5)}…{ownerText.slice(-3)}</span>{me && ownerText === me && <span style={{ marginLeft: 6, color: '#10b981', fontWeight: 600 }}>yours</span>}
                                    </div>
                                )}
                                {attrs.length > 0 && (
                                    <div>
                                        <div style={label}>Attributes</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            {attrs.map((a, i) => <span key={i} style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: 6, background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.secondaryText }}><span style={{ color: theme.colors.mutedText }}>{a.trait_type}:</span> {String(a.value)}</span>)}
                                        </div>
                                    </div>
                                )}
                                {links.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                        {links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.72rem', color: theme.colors.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}><FaExternalLinkAlt size={9} /> {l.key}</a>)}
                                    </div>
                                )}
                                {raw.length > 0 && (
                                    <div>
                                        <button type="button" onClick={() => setRawOpen((o) => ({ ...o, [key]: !o[key] }))} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.72rem', color: theme.colors.accent }}>{rawOpen[key] ? 'Hide' : 'Show'} metadata ({raw.length} fields)</button>
                                        {rawOpen[key] && (
                                            <div style={{ marginTop: 6, fontSize: '0.72rem', fontFamily: 'monospace', color: theme.colors.secondaryText, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', wordBreak: 'break-all' }}>
                                                {raw.map((r, i) => <React.Fragment key={i}><span style={{ color: theme.colors.mutedText }}>{r.key}</span><span>{r.value.length > 300 ? `${r.value.slice(0, 300)}…` : r.value}</span></React.Fragment>)}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
