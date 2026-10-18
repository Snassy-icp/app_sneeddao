import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Actor, HttpAgent } from '@dfinity/agent';
import NftModel from './NftModel';
import { Principal } from '@dfinity/principal';
import { FaExternalLinkAlt, FaSpinner } from 'react-icons/fa';
import { anonymousNftAgent, fetchTokenDetails, getNftImage, getNftName, getNftMedia } from '../utils/NftUtils';
import { nftItemUrl } from './NftAssetView';

// A character NFT that says where the rest of it is (the wu convention: wu_chars and compatible collections):
//   wu:stats  game roots it has stats in. Each root says how it presents them (showcase: its name, site and readable
//             names for its fact keys and ids), where this NFT's character is (character_of: its key there and the
//             shard with its facts) - and the shard hands out everything the game holds about it (get, get_doc).
//             A game may keep the character's look there too: a "look" document, a 3D model (.glb) of it as it is
//             in that game - what it wears and holds, in that game's own style.
//   wu:items  item collections it holds things in: the NFT's own account's tokens there (carried by the character),
//             and the owner's tokens kept for this character in each of its games (a subaccount of the owner's:
//             sha256("wu-char/" + game root + "/" + the character's key there)).
// Everything is read live from those canisters, never from a copy: what a buyer sees is what the games hold.

const gameIdl = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    return IDL.Service({
        showcase: IDL.Func([], [IDL.Record({ name: IDL.Text, url: IDL.Opt(IDL.Text), names: IDL.Vec(IDL.Record({ key: IDL.Text, name: IDL.Text })) })], ['query']),
        character_of: IDL.Func([Account], [IDL.Opt(IDL.Record({ char: Account, shard: IDL.Opt(IDL.Principal) }))], ['query']),
    });
};
const shardIdl = ({ IDL }) => {
    const Event = IDL.Record({ count: IDL.Nat, first: IDL.Int, last: IDL.Int });
    return IDL.Service({
        get: IDL.Func([IDL.Vec(IDL.Nat8)], [IDL.Record({
            values: IDL.Vec(IDL.Record({ key: IDL.Text, value: IDL.Int })),
            labels: IDL.Vec(IDL.Record({ key: IDL.Text, text: IDL.Text })),
            docs: IDL.Vec(IDL.Record({ key: IDL.Text, size: IDL.Nat, at: IDL.Int })),
            events: IDL.Vec(IDL.Record({ key: IDL.Text, event: Event })),
        })], ['query']),
        get_doc: IDL.Func([IDL.Vec(IDL.Nat8), IDL.Text], [IDL.Opt(IDL.Record({ data: IDL.Vec(IDL.Nat8), at: IDL.Int }))], ['query']),
    });
};
const tokensIdl = ({ IDL }) => IDL.Service({
    icrc7_tokens_of: IDL.Func([IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) }), IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat)], [IDL.Vec(IDL.Nat)], ['query']),
});

function texts(metadata, key) {
    const e = (metadata || []).find(([k]) => k === key);
    return e && e[1].Array ? e[1].Array.map((v) => v.Text).filter((t) => { try { Principal.fromText(t); return true; } catch { return false; } }) : [];
}
/// Does this NFT point to its stats or things (wu:stats, wu:items)?
export function hasCharacterLinks(metadata) { return texts(metadata, 'wu:stats').length > 0 || texts(metadata, 'wu:items').length > 0; }

const be32 = (id) => { const b = new Uint8Array(32); let n = BigInt(id); for (let i = 31; i >= 0 && n > 0n; i--) { b[i] = Number(n & 255n); n >>= 8n; } return b; };
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
async function sha256(text) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
async function gunzipText(bytes) {
    try { return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
    catch { return new TextDecoder().decode(bytes); }   // not compressed
}

/// A game's names: exact keys first, then the longest prefix ("skill:") with the rest named too (an id) or as it is.
function namer(names) {
    const exact = new Map(names.map((n) => [n.key, n.name]));
    const prefixes = names.filter((n) => n.key.endsWith(':')).sort((a, b) => b.key.length - a.key.length);
    const id = (s) => exact.get(s) || s;
    const key = (k) => {
        if (exact.has(k)) return exact.get(k);
        const p = prefixes.find((x) => k.startsWith(x.key));
        return p ? `${p.name}: ${id(k.slice(p.key.length))}` : k;
    };
    return { key, id };
}
const when = (secs) => { const d = new Date(Number(secs) * 1000); return isNaN(d) ? String(secs) : d.toISOString().slice(0, 10); };

/// An inventory document as the game wrote it (XML: bags with items, worn items, a keychain) - item uids named.
function readInventory(xml, n) {
    try {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.querySelector('parsererror')) return null;
        const row = (el, where) => ({ name: n.id(el.getAttribute('uid')), stack: Number(el.getAttribute('stack') || 1), bound: el.getAttribute('bound') === '1', where });
        const out = [];
        for (const el of doc.documentElement.children) {
            if (el.tagName === 'bag') { out.push(row(el, 'Bag')); for (const it of el.querySelectorAll('item')) out.push(row(it, el.getAttribute('id') || 'Bag')); }
            else if (el.tagName === 'keychain') { for (const it of el.querySelectorAll('item')) out.push(row(it, 'Keychain')); }
            else if (el.tagName === 'item') out.push(row(el, el.getAttribute('useslot') ? `Worn: ${el.getAttribute('useslot')}` : 'Worn'));
        }
        return out;
    } catch { return null; }
}

async function loadGame(agent, root, nftAccount) {
    const g = Actor.createActor(gameIdl, { agent, canisterId: root });
    const [show, who] = await Promise.all([g.showcase().catch(() => null), g.character_of(nftAccount).catch(() => [])]);
    const out = { root, name: show?.name || root, url: show?.url?.[0] || null, n: namer(show?.names || []), char: null, facts: null, docs: {}, models: {} };
    if (!who.length) return out;
    const charKey = who[0].char.subaccount[0];
    out.char = charKey ? hex(charKey) : null;
    const shard = who[0].shard[0];
    if (!shard || !charKey) return out;
    const s = Actor.createActor(shardIdl, { agent, canisterId: shard });
    out.facts = await s.get(charKey);
    for (const d of out.facts.docs) {
        const got = await s.get_doc(charKey, d.key).catch(() => []);
        if (!got.length) continue;
        const bytes = new Uint8Array(got[0].data);
        if (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) out.models[d.key] = bytes;   // a binary glTF: a 3D model (its look)
        else out.docs[d.key] = await gunzipText(bytes);
    }
    return out;
}

async function loadItems(agent, collections, nftAccount, owner, games) {
    // where to look in each collection: the character's own account, and the owner's account kept for it in each game
    const places = [{ label: 'Carried by the character', account: nftAccount }];
    if (owner) for (const g of games) if (g.char) places.push({ label: `Kept by the owner for this character (${g.name})`, account: { owner, subaccount: [await sha256(`wu-char/${g.root}/${g.char}`)] } });
    const out = [];
    for (const col of collections) {
        const t = Actor.createActor(tokensIdl, { agent, canisterId: col });
        for (const p of places) {
            const ids = await t.icrc7_tokens_of(p.account, [], [100n]).catch(() => []);
            if (!ids.length) continue;
            const tokens = await fetchTokenDetails(col, ids, agent, { withOwner: false, withIcrc97: false });
            out.push({ collection: col, label: p.label, tokens });
        }
    }
    return out;
}

const charsIdl = ({ IDL }) => IDL.Service({
    account_of: IDL.Func([IDL.Nat], [IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })], ['query']),
});
/// When an NFT's owner is a character's own account (a character collection - wu_chars or compatible - holding it for
/// the character with that token id: account_of(id) is exactly this account), the character it is carried by.
export function CarriedBy({ owner, theme }) {
    const [who, setWho] = useState(null);
    const ownerText = owner?.owner?.toText?.() || null, sub = owner?.subaccount?.length ? new Uint8Array(owner.subaccount[0]) : null;
    useEffect(() => {
        setWho(null);
        if (!ownerText || !sub || sub.length !== 32) return undefined;
        let alive = true;
        (async () => {
            try {
                let id = 0n; for (const x of sub) id = (id << 8n) + BigInt(x);
                const agent = anonymousNftAgent(), acct = await Actor.createActor(charsIdl, { agent, canisterId: ownerText }).account_of(id);
                const same = acct.owner.toText() === ownerText && acct.subaccount.length && hex(acct.subaccount[0]) === hex(sub);
                if (!same) return;
                const [t] = await fetchTokenDetails(ownerText, [id], agent, { withOwner: false, withIcrc97: false });
                if (alive && t && t.exists) setWho({ collection: ownerText, id, name: getNftName(t.metadata, id, t), img: getNftImage(t.metadata, t) });
            } catch { /* not a character collection: the plain owner stands */ }
        })();
        return () => { alive = false; };
    }, [ownerText, sub ? hex(sub) : '']);
    if (!who) return null;
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', textAlign: 'left', alignSelf: 'stretch', width: '100%', gap: 8, marginTop: 8, fontSize: '0.85rem', color: theme.colors.secondaryText }}>
            {who.img && <img src={who.img} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', margin: 0, flex: 'none' }} />}
            <span style={{ flex: 'none', textAlign: 'left', margin: 0 }}>Carried by the character <Link to={nftItemUrl(who.collection, who.id)} style={{ color: theme.colors.accent, fontWeight: 600 }}>{who.name}</Link></span>
        </div>
    );
}

const setModelIdl = ({ IDL }) => IDL.Service({ set_model: IDL.Func([IDL.Nat, IDL.Opt(IDL.Vec(IDL.Nat8))], [IDL.Variant({ ok: IDL.Null, err: IDL.Text })], []) });
/// A game's look of the character: turn it around; its owner may make it the NFT's own 3D model (set_model).
function GameLook({ bytes, gameName, collection, tokenId, identity, mine, theme }) {
    const [url, setUrl] = useState(null);
    const [msg, setMsg] = useState('');
    useEffect(() => { const u = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })); setUrl(u); return () => URL.revokeObjectURL(u); }, [bytes]);
    const use = async () => {
        try {
            setMsg('Saving…');
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host, identity, shouldFetchRootKey: host.startsWith('http://localhost') });
            const r = await Actor.createActor(setModelIdl, { agent, canisterId: collection }).set_model(BigInt(tokenId), [bytes]);
            setMsg('err' in r ? r.err : `This is the NFT's 3D model now (reload to see it above).`);
        } catch (e) { setMsg(e?.message || String(e)); }
    };
    if (!url) return null;
    return (
        <div style={{ marginTop: 10 }}>
            <div style={{ aspectRatio: '4 / 3', maxHeight: 320, background: theme.colors.tertiaryBg, borderRadius: 8, overflow: 'hidden' }}><NftModel url={url} alt={`Its look in ${gameName}`} style={{ width: '100%', height: '100%' }} /></div>
            {mine && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                <button onClick={use} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>Use this look as the NFT's 3D model</button>
                {msg && <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>{msg}</span>}
            </div>}
        </div>
    );
}

export default function CharacterPanel({ collection, tokenId, metadata, owner, theme, card, label, identity, mine }) {
    const [games, setGames] = useState(null);
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');
    const stats = texts(metadata, 'wu:stats'), cols = texts(metadata, 'wu:items');
    const ownerText = owner?.toText?.() || null;
    useEffect(() => {
        let alive = true;
        setGames(null); setItems(null); setError('');
        (async () => {
            try {
                const agent = anonymousNftAgent(), nftAccount = { owner: Principal.fromText(collection), subaccount: [be32(tokenId)] };
                const gs = await Promise.all(stats.map((r) => loadGame(agent, r, nftAccount).catch(() => ({ root: r, name: r, n: namer([]), failed: true }))));
                if (!alive) return; setGames(gs);
                const its = await loadItems(agent, cols, nftAccount, ownerText ? Principal.fromText(ownerText) : null, gs);
                if (alive) setItems(its);
            } catch (e) { if (alive) setError(e?.message || String(e)); }
        })();
        return () => { alive = false; };
    }, [collection, tokenId, ownerText, stats.join(','), cols.join(',')]);

    const cell = { background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: '8px 10px' };
    const small = { fontSize: '0.68rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.4px' };
    const spin = <FaSpinner className="health-spin" size={14} color={theme.colors.mutedText} />;
    return (
        <>
            {error && <div style={{ ...card, color: theme.colors.error }}>{error}</div>}
            {stats.length > 0 && !games && <div style={card}><div style={label}>In its games</div>{spin}</div>}
            {(games || []).map((g) => {
                const n = g.n, f = g.facts;
                const facts = f ? [
                    ...f.labels.map((l) => ({ k: n.key(l.key), v: n.id(l.text) })),
                    ...f.values.map((v) => ({ k: n.key(v.key), v: v.key.startsWith('questat:') ? when(v.value) : v.value.toString() })),
                    ...f.events.map((e) => ({ k: n.key(e.key), v: e.event.count > 1n ? `${e.event.count}×, last ${when(e.event.last / 1_000_000_000n)}` : when(e.event.first / 1_000_000_000n) })),
                ] : [];
                const inv = g.docs?.inventory ? readInventory(g.docs.inventory, n) : null;
                return (
                    <div key={g.root} style={card}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                            <div style={{ ...label, marginBottom: 0 }}>In {g.name}</div>
                            {g.url && <a href={g.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: theme.colors.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}><FaExternalLinkAlt size={9} /> site</a>}
                            <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText, fontFamily: 'monospace' }}>{g.root}</span>
                        </div>
                        {g.failed ? <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>The game did not answer.</div>
                            : !f ? <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>No facts about this character there yet.</div>
                            : (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                                        {facts.map((x, i) => <div key={i} style={cell}><div style={small}>{x.k}</div><div style={{ fontSize: '0.9rem', fontWeight: 600, wordBreak: 'break-word', color: theme.colors.primaryText }}>{x.v}</div></div>)}
                                    </div>
                                    {g.models?.look && <GameLook bytes={g.models.look} gameName={g.name} collection={collection} tokenId={tokenId} identity={identity} mine={mine} theme={theme} />}
                                    {inv && inv.length > 0 && (
                                        <div style={{ marginTop: 10 }}>
                                            <div style={small}>{n.key('inventory')}</div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, fontSize: '0.85rem' }}>
                                                {inv.map((it, i) => <div key={i} style={{ display: 'flex', gap: 8 }}><span style={{ color: theme.colors.mutedText, minWidth: 120 }}>{it.where}</span><span style={{ color: theme.colors.primaryText }}>{it.name}{it.stack > 1 ? ` ×${it.stack}` : ''}</span>{it.bound && <span style={{ color: theme.colors.mutedText }}>(soulbound)</span>}</div>)}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                    </div>
                );
            })}
            {cols.length > 0 && (
                <div style={card}>
                    <div style={label}>Its things (NFTs)</div>
                    {!items ? spin : items.length === 0 ? <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>None found.</div> : items.map((grp, gi) => (
                        <div key={gi} style={{ marginTop: gi ? 12 : 0 }}>
                            <div style={small}>{grp.label}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginTop: 6 }}>
                                {grp.tokens.map((t) => {
                                    const img = getNftImage(t.metadata, t), name = getNftName(t.metadata, t.tokenId, t), m = getNftMedia(t);
                                    return (
                                        <Link key={t.tokenId.toString()} to={nftItemUrl(grp.collection, t.tokenId)} title={name} style={{ ...cell, padding: 6, textDecoration: 'none', color: theme.colors.primaryText, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <div style={{ aspectRatio: '1 / 1', background: theme.colors.tertiaryBg, borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                                {img && <img src={img} alt={name} style={{ width: '80%', height: '80%', objectFit: 'contain', imageRendering: 'pixelated' }} />}
                                                {m?.kind === 'model' && <span style={{ position: 'absolute', top: 3, right: 4, fontSize: '0.6rem', fontWeight: 700, color: theme.colors.accent }}>3D</span>}
                                            </div>
                                            <div style={{ fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
