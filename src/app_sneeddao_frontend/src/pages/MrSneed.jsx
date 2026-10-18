// /mr-sneed: everything in Mr Sneed's canister (Sneed DAO's mascot and spirit, now speaking for
// himself), for anyone to inspect: who he is, his DAO-governed personality and its history, the
// frame of rules in his code, who governs him, and
// every memory he has written, browsable by folder, kind and search. Members see what he remembers
// about them and can remove it. Changes (personality, writers, limits, removing a memory) are
// proposed to Sneed DAO from the member's own neuron, once the DAO has registered the functions.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FaSpinner, FaSync, FaSearch, FaFolder, FaFolderOpen, FaChevronDown, FaChevronRight, FaThumbtack, FaExternalLinkAlt, FaGavel, FaTimes, FaPlus, FaTrash } from 'react-icons/fa';
import Header from '../components/Header';
import PrincipalInput from '../components/PrincipalInput';
import ConfirmationModal from '../ConfirmationModal';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import {
    mrSneedCanisterId, mrSneedActor, mrSneedFunctions, proposerNeurons, previewChange, proposeChange, linkOf, kindName, statusName, bytesOf,
    MR_SNEED_PRINCIPAL, MR_SNEED_NEURON, SNEED_ROOT, PERSONALITY_MAX, REASON_MAX,
} from '../utils/mrSneed';

const PAGE = 30;
const KINDS = ['note', 'decision', 'lesson', 'project', 'reference', 'member'];
const KIND_COLORS = { note: '#64748b', decision: '#8b5cf6', lesson: '#f59e0b', project: '#3b82f6', reference: '#14b8a6', member: '#ec4899' };
const hex = (b) => Array.from(b || [], (x) => x.toString(16).padStart(2, '0')).join('');
const when = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const day = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fmtBytes = (n) => (Number(n) >= 1e6 ? `${(Number(n) / 1e6).toFixed(1)} MB` : `${(Number(n) / 1e3).toFixed(1)} KB`);
const kindDetail = (k) => {
    const n = kindName(k);
    if (n === 'decision' && k.decision.length) return `decision · proposal ${k.decision[0]}`;
    if (n === 'project') return `project · ${k.project}`;
    return n;
};

/// Folders as a tree: every prefix of every path, with the counts of everything under it.
function folderTree(folders) {
    const nodes = new Map();
    for (const f of folders) {
        const parts = f.path ? f.path.split('/') : [];
        for (let i = 1; i <= parts.length; i++) {
            const p = parts.slice(0, i).join('/');
            const n = nodes.get(p) || { path: p, name: parts[i - 1], depth: i - 1, active: 0, total: 0 };
            n.active += Number(f.active); n.total += Number(f.total);
            nodes.set(p, n);
        }
    }
    return [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export default function MrSneed() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated, login } = useAuth();
    const naming = useNaming();
    const [params, setParams] = useSearchParams();
    const me = identity?.getPrincipal?.().toText?.() || null;

    const [config, setConfig] = useState(null);
    const [stats, setStats] = useState(null);
    const [prompt, setPrompt] = useState(null);
    const [history, setHistory] = useState([]);
    const [folders, setFolders] = useState([]);
    const [functions, setFunctions] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [showFrame, setShowFrame] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    const path = params.get('path') || '';
    const kind = params.get('kind') || '';
    const status = params.get('status') || 'active';
    const [query, setQuery] = useState(params.get('q') || '');
    const [items, setItems] = useState(null);
    const [next, setNext] = useState(null);
    const [listBusy, setListBusy] = useState(false);
    const [open, setOpen] = useState(() => new Set(params.get('memory') ? [params.get('memory')] : []));
    const [focus, setFocus] = useState(null); // a memory opened by ?memory= that is not in the list

    const [aboutMe, setAboutMe] = useState(null);
    const [forgetting, setForgetting] = useState(null); // memory to remove about me
    const [propose, setPropose] = useState(null); // { method, args }

    const info = useCallback((p) => getPrincipalDisplayInfoFromContext(p, naming.principalNames, naming.principalNicknames, naming.verifiedNames, naming.principalCanisterTypes), [naming]);
    const who = (p) => <PrincipalDisplay principal={p} displayInfo={info(p)} short showCopyButton={false} isAuthenticated={isAuthenticated} />;
    const setParam = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); n.delete('memory'); setParams(n, { replace: true }); };
    const showMemory = (id) => { const n = new URLSearchParams(params); n.set('memory', id); setParams(n, { replace: true }); setOpen((s) => new Set(s).add(id)); window.scrollTo({ top: 0, behavior: 'smooth' }); };

    const load = useCallback(async () => {
        if (!mrSneedCanisterId) { setLoading(false); return; }
        setLoading(true); setError('');
        try {
            const a = await mrSneedActor(null);
            const [cfg, st, pr, hi, fo] = await Promise.all([a.get_config(), a.get_stats(), a.get_prompt(), a.list_personalities(0n, 100n), a.list_folders()]);
            setConfig(cfg); setStats(st); setPrompt(pr); setHistory(hi); setFolders(fo);
            mrSneedFunctions(cfg.governance.toText()).then(setFunctions).catch(() => setFunctions({}));
        } catch (e) { setError(e?.message || String(e)); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const q = params.get('q') || '';
    const loadList = useCallback(async (after) => {
        if (!mrSneedCanisterId) return;
        setListBusy(true);
        try {
            const a = await mrSneedActor(null);
            if (q) {
                const r = await a.search_memories(q, 100n);
                setItems(r.filter((m) => (!path || m.path === path || m.path.startsWith(`${path}/`)) && (!kind || kindName(m.kind) === kind)));
                setNext(null);
            } else {
                const r = await a.list_memories({ path: path ? [path] : [], kind: kind ? [kind] : [], tag: [], status: status === 'all' ? [] : [status], after: after != null ? [after] : [], limit: BigInt(PAGE) });
                setItems((prev) => (after != null ? [...(prev || []), ...r.items] : r.items));
                setNext(r.next[0] ?? null);
            }
        } catch (e) { setError(e?.message || String(e)); }
        finally { setListBusy(false); }
    }, [q, path, kind, status]);
    useEffect(() => { setItems(null); loadList(null); }, [loadList]);

    useEffect(() => {
        const id = params.get('memory');
        if (!id || !mrSneedCanisterId || !/^\d+$/.test(id)) { setFocus(null); return; }
        mrSneedActor(null).then((a) => a.get_memory(BigInt(id))).then((r) => setFocus(r[0] || null)).catch(() => setFocus(null));
    }, [params]);

    const loadAboutMe = useCallback(async () => {
        if (!me || !mrSneedCanisterId) { setAboutMe(null); return; }
        try { const a = await mrSneedActor(null); const r = await a.memories_about(identity.getPrincipal(), [], 100n); setAboutMe(r.items); }
        catch { setAboutMe([]); }
    }, [me, identity]);
    useEffect(() => { loadAboutMe(); }, [loadAboutMe]);

    const tree = useMemo(() => folderTree(folders), [folders]);
    const personality = prompt?.personality?.[0] || null;
    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 16, padding: 18, marginBottom: 16 };
    const label = { fontSize: 12, color: c.mutedText, textTransform: 'uppercase', letterSpacing: 0.6 };
    const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, wordBreak: 'break-all' };
    const chip = (on, color) => ({ padding: '5px 10px', borderRadius: 999, border: `1px solid ${on ? (color || c.accent) : c.border}`, background: on ? `${color || c.accent}22` : 'transparent', color: on ? (color || c.accent) : c.secondaryText, cursor: 'pointer', fontSize: 13 });
    const btn = (accent) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, border: `1px solid ${accent || c.border}`, background: 'transparent', color: accent || c.secondaryText, cursor: 'pointer', fontSize: 13 });
    const proposeBtn = (method, args) => (
        <button type="button" style={btn(c.accent)} onClick={() => setPropose({ method, args })}><FaGavel size={11} /> Propose a change</button>
    );

    if (!mrSneedCanisterId) {
        return (<><Header /><div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 16px' }}><h1 style={{ color: c.primaryText }}>Mr Sneed</h1><div style={card}>Mr Sneed's canister is not deployed on this network.</div></div></>);
    }

    const memoryCard = (m) => {
        const id = m.id.toString(); const isOpen = open.has(id); const st = statusName(m.status); const k = kindName(m.kind);
        const toggle = () => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
        return (
            <div key={id} id={`memory-${id}`} style={{ border: `1px solid ${c.border}`, borderRadius: 12, background: c.secondaryBg, opacity: st === 'active' ? 1 : 0.7 }}>
                <button type="button" onClick={toggle} aria-expanded={isOpen} style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'flex-start', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: c.primaryText }}>
                    <span style={{ marginTop: 3, color: c.mutedText }}>{isOpen ? <FaChevronDown size={11} /> : <FaChevronRight size={11} />}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{m.pinned && <FaThumbtack size={11} color={c.accent} style={{ marginRight: 6 }} title="Pinned: part of every session brief" />}{m.title || <em>(removed)</em>}</span>
                        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, fontSize: 12, color: c.mutedText }}>
                            <span style={{ color: KIND_COLORS[k] }}>{kindDetail(m.kind)}</span>
                            <span>{m.path || '/'}</span>
                            <span>#{id} · {day(m.created_at)}</span>
                            {st !== 'active' && <span style={{ color: c.warning || '#f59e0b' }}>{st}</span>}
                        </span>
                    </span>
                </button>
                {isOpen && (
                    <div style={{ padding: '0 14px 12px 33px' }}>
                        {st === 'removed' && <div style={{ fontSize: 13, color: c.secondaryText, marginBottom: 8 }}>Removed {when(m.status.removed.at)} by {who(m.status.removed.by)}{m.status.removed.reason ? `: ${m.status.removed.reason}` : ''}. The text is gone; the log keeps its hash.</div>}
                        {st === 'superseded' && <div style={{ fontSize: 13, color: c.secondaryText, marginBottom: 8 }}>Replaced by <button type="button" onClick={() => showMemory(m.status.superseded.toString())} style={{ ...btn(), padding: '1px 8px' }}>#{m.status.superseded.toString()}</button></div>}
                        {m.body && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 14, color: c.primaryText, overflowWrap: 'anywhere' }}>{m.body}</div>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                            {m.tags.map((t) => <span key={t} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: c.cardBg, border: `1px solid ${c.border}`, color: c.secondaryText }}>{t}</span>)}
                            {m.links.map((l) => {
                                const L = linkOf(l);
                                if (!L.href) return <span key={l} style={{ fontSize: 12, color: c.mutedText }}>{l}</span>;
                                return L.internal ? <Link key={l} to={L.href} style={{ fontSize: 12, color: c.accent }}>{L.label}</Link>
                                    : <a key={l} href={L.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: c.accent }}>{L.label} <FaExternalLinkAlt size={8} /></a>;
                            })}
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: 12, color: c.mutedText }}>
                            <span>Written {when(m.created_at)} by {who(m.author)}</span>
                            {k === 'member' && <span>about {who(m.kind.member)}</span>}
                            <Link to={`/mr-sneed?memory=${id}`} style={{ color: c.accent }}>Link</Link>
                            {st === 'active' && isAuthenticated && <button type="button" style={{ ...btn(), padding: '3px 10px', fontSize: 12 }} onClick={() => setPropose({ method: 'remove_memory', args: { id, title: m.title, reason: '' } })}><FaTrash size={10} /> Propose removal</button>}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <Header />
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 16px 3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                    <div style={{ maxWidth: 760, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                        <img src="/mr-sneed-face.png" alt="Mr Sneed" width={96} height={96}
                            style={{ width: 96, height: 96, objectFit: 'contain', borderRadius: '50%', background: '#f4f1ea', border: `3px solid ${c.accent}`, padding: 6, boxSizing: 'border-box', flexShrink: 0 }} />
                        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                            <h1 style={{ margin: 0, color: c.primaryText }}>Mr Sneed</h1>
                            <p style={{ margin: '6px 0 0', color: c.secondaryText, lineHeight: 1.6 }}>
                                Mr Sneed is Sneed DAO: its mascot and its spirit. We are all Mr Sneed. Now he is learning to speak and act for himself, one step at a time, on the way to a DAO that helps write itself. His personality is set by DAO vote, everything he remembers is on-chain, public and listed below, and he holds only the powers the DAO gave him: a 1-SNEED neuron and a pen. <Link to="/lore" style={{ color: c.accent }}>Read the lore</Link>.
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={() => { load(); loadList(null); loadAboutMe(); }} style={btn()} title="Reload"><FaSync className={loading ? 'mrs-spin' : ''} /></button>
                </div>
                <style>{'@keyframes mrs-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .mrs-spin { animation: mrs-spin 1s linear infinite; }'}</style>
                {error && <div style={{ ...card, color: c.error }}>{error}</div>}

                {/* who he is and who governs him */}
                <section style={card}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                        {[
                            ['Principal', <span key="p">{who(MR_SNEED_PRINCIPAL)}</span>],
                            ['Neuron', <Link key="n" to={`/neuron?neuronid=${MR_SNEED_NEURON}&sns=${SNEED_ROOT}`} style={{ ...mono, color: c.accent }}>{MR_SNEED_NEURON.slice(0, 16)}…</Link>],
                            ['Canister', <a key="c" href={`https://dashboard.internetcomputer.org/canister/${mrSneedCanisterId}`} target="_blank" rel="noopener noreferrer" style={{ ...mono, color: c.accent }}>{mrSneedCanisterId} <FaExternalLinkAlt size={8} /></a>],
                            ['Memories', stats ? `${stats.active} active · ${stats.total} written · ${fmtBytes(stats.bytes)} · ${stats.pinned} pinned` : '…'],
                            ['Governed by', config ? (config.operator.length ? <span key="g">Sneed DAO, with an operator until the handover: {who(config.operator[0])}</span> : 'Sneed DAO only') : '…'],
                            ['May write memories', config ? <span key="w" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{config.writers.length ? config.writers.map((p) => <span key={p.toText()}>{who(p)}</span>) : 'nobody'}</span> : '…'],
                            ['Limits', config ? `${config.limits.writes_per_day} writes a day per writer · ${config.limits.max_pinned} pinned · ${Number(config.limits.max_active).toLocaleString()} active · ${fmtBytes(config.limits.max_bytes)}` : '…'],
                            ['Log', <Link key="l" to={`/tools/icrc3?canister=${mrSneedCanisterId}`} style={{ color: c.accent }}>Every change, in his ICRC-3 log</Link>],
                        ].map(([k, v]) => (
                            <div key={k} style={{ background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: '10px 12px', minWidth: 0 }}>
                                <div style={label}>{k}</div>
                                <div style={{ marginTop: 4, fontSize: 14, color: c.primaryText, overflowWrap: 'anywhere' }}>{v}</div>
                            </div>
                        ))}
                    </div>
                    {config && isAuthenticated && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                            <button type="button" style={btn(c.accent)} onClick={() => setPropose({ method: 'set_writers', args: { writers: config.writers.map((p) => p.toText()) } })}><FaGavel size={11} /> Propose new writers</button>
                            <button type="button" style={btn(c.accent)} onClick={() => setPropose({ method: 'set_limits', args: { limits: { ...config.limits } } })}><FaGavel size={11} /> Propose new limits</button>
                        </div>
                    )}
                </section>

                {/* the prompt */}
                <section style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <h2 style={{ margin: 0, fontSize: 20, color: c.primaryText }}>Personality</h2>
                        {isAuthenticated && prompt && proposeBtn('set_personality', { text: personality?.text || '', reason: '', expectedVersion: history.length })}
                    </div>
                    {personality ? (
                        <>
                            <div style={{ fontSize: 13, color: c.mutedText, margin: '6px 0 10px' }}>
                                Version {personality.version.toString()} · set {when(personality.set_at)}{personality.set_by_proposal.length ? <> by <Link to={`/proposal?proposalid=${personality.set_by_proposal[0]}&sns=${SNEED_ROOT}`} style={{ color: c.accent }}>proposal {personality.set_by_proposal[0].toString()}</Link></> : ' by the operator'}{personality.reason ? ` · ${personality.reason}` : ''}
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14, color: c.primaryText, background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14 }}>{personality.text}</div>
                            <div style={{ ...mono, color: c.mutedText, marginTop: 6 }}>SHA-256 {hex(personality.hash)}</div>
                        </>
                    ) : (
                        <p style={{ color: c.secondaryText, lineHeight: 1.6 }}>Not set yet. The first version is a <a href="https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/mr_sneed_personality_v1.md" target="_blank" rel="noopener noreferrer" style={{ color: c.accent }}>draft for the community to edit</a>; it is set by a DAO proposal.</p>
                    )}
                    {history.length > 1 && (
                        <div style={{ marginTop: 12 }}>
                            <button type="button" style={btn()} onClick={() => setShowHistory((v) => !v)}>{showHistory ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />} Earlier versions ({history.length - 1})</button>
                            {showHistory && [...history].reverse().slice(1).map((p) => (
                                <details key={p.version.toString()} style={{ marginTop: 8, border: `1px solid ${c.border}`, borderRadius: 10, padding: '8px 12px', background: c.secondaryBg }}>
                                    <summary style={{ cursor: 'pointer', color: c.primaryText, fontSize: 14 }}>Version {p.version.toString()} · {when(p.set_at)}{p.reason ? ` · ${p.reason}` : ''}</summary>
                                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 13, color: c.secondaryText, marginTop: 8 }}>{p.text}</div>
                                </details>
                            ))}
                        </div>
                    )}
                    <div style={{ marginTop: 14 }}>
                        <button type="button" style={btn()} onClick={() => setShowFrame((v) => !v)}>{showFrame ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />} The frame: rules in his code</button>
                        {showFrame && prompt && (
                            <div style={{ marginTop: 8 }}>
                                <p style={{ fontSize: 13, color: c.secondaryText, margin: '0 0 6px', lineHeight: 1.5 }}>Today Mr Sneed's words and memories are written with the help of AI, under these rules. They come before the personality and win over it, and change only by a code upgrade, which is a DAO proposal too.</p>
                                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 13, color: c.primaryText, background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 14 }}>{prompt.frame}</div>
                                <div style={{ ...mono, color: c.mutedText, marginTop: 6 }}>SHA-256 {hex(prompt.frame_hash)}</div>
                            </div>
                        )}
                    </div>
                </section>

                {/* what he remembers about you */}
                {isAuthenticated && aboutMe && aboutMe.length > 0 && (
                    <section style={card}>
                        <h2 style={{ margin: '0 0 6px', fontSize: 20, color: c.primaryText }}>What Mr Sneed remembers about you</h2>
                        <p style={{ margin: '0 0 10px', fontSize: 14, color: c.secondaryText }}>You can remove any of these. The log keeps a record that something was removed, not what it said.</p>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {aboutMe.map((m) => (
                                <div key={m.id.toString()} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>{memoryCard(m)}</div>
                                    {statusName(m.status) !== 'removed' && <button type="button" style={btn(c.error)} onClick={() => setForgetting(m)}><FaTrash size={10} /> Remove</button>}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* the memories */}
                <section style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                        <h2 style={{ margin: 0, fontSize: 20, color: c.primaryText }}>Memories</h2>
                        <form onSubmit={(e) => { e.preventDefault(); setParam('q', query.trim()); }} style={{ display: 'flex', gap: 6, flex: '1 1 260px', maxWidth: 420 }}>
                            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, folders and tags" aria-label="Search memories"
                                style={{ flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 999, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: 14 }} />
                            <button type="submit" style={btn(c.accent)} aria-label="Search"><FaSearch size={12} /></button>
                            {q && <button type="button" style={btn()} onClick={() => { setQuery(''); setParam('q', ''); }} aria-label="Clear search"><FaTimes size={12} /></button>}
                        </form>
                    </div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <nav aria-label="Folders" style={{ flex: '0 1 230px', minWidth: 180 }}>
                            <button type="button" onClick={() => setParam('path', '')} style={{ ...chip(!path), display: 'flex', width: '100%', borderRadius: 8, justifyContent: 'space-between', marginBottom: 4 }}><span><FaFolderOpen size={11} /> All</span><span>{stats ? stats.active.toString() : ''}</span></button>
                            {tree.map((n) => (
                                <button key={n.path} type="button" onClick={() => setParam('path', n.path)} title={n.path}
                                    style={{ ...chip(path === n.path), display: 'flex', width: '100%', borderRadius: 8, justifyContent: 'space-between', gap: 6, marginBottom: 4, paddingLeft: 10 + n.depth * 14, border: path === n.path ? `1px solid ${c.accent}` : '1px solid transparent' }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path === n.path ? <FaFolderOpen size={11} /> : <FaFolder size={11} />} {n.name}</span><span>{n.active}</span>
                                </button>
                            ))}
                        </nav>
                        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                                <button type="button" onClick={() => setParam('kind', '')} style={chip(!kind)}>Any kind</button>
                                {KINDS.map((k) => <button key={k} type="button" onClick={() => setParam('kind', k)} style={chip(kind === k, KIND_COLORS[k])}>{k}</button>)}
                                {!q && (
                                    <select value={status} onChange={(e) => setParam('status', e.target.value === 'active' ? '' : e.target.value)} aria-label="Status"
                                        style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 999, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: 13 }}>
                                        {[['active', 'Current'], ['superseded', 'Replaced'], ['removed', 'Removed'], ['all', 'All']].map(([v, t]) => <option key={v} value={v} style={{ background: c.secondaryBg, color: c.primaryText }}>{t}</option>)}
                                    </select>
                                )}
                            </div>
                            {focus && !(items || []).some((m) => m.id === focus.id) && <div style={{ marginBottom: 10 }}>{memoryCard(focus)}</div>}
                            {items === null ? <div style={{ color: c.mutedText }}><FaSpinner className="mrs-spin" /> Loading…</div>
                                : items.length === 0 ? <div style={{ color: c.mutedText }}>{q ? 'Nothing matches.' : 'No memories here yet.'}</div>
                                : <div style={{ display: 'grid', gap: 8 }}>{items.map(memoryCard)}</div>}
                            {next != null && <button type="button" disabled={listBusy} onClick={() => loadList(next)} style={{ ...btn(), marginTop: 10 }}>{listBusy ? <FaSpinner className="mrs-spin" /> : <FaPlus size={10} />} More</button>}
                            {q && <div style={{ fontSize: 12, color: c.mutedText, marginTop: 8 }}>Search covers current memories only.</div>}
                        </div>
                    </div>
                </section>
                {!isAuthenticated && (
                    <p style={{ textAlign: 'center', color: c.secondaryText }}>
                        Members can propose changes to Mr Sneed from here. <button type="button" onClick={login} style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer', padding: 0, font: 'inherit' }}>Log in</button> to see what he remembers about you.
                    </p>
                )}
            </div>

            <ConfirmationModal
                show={!!forgetting}
                onClose={() => setForgetting(null)}
                doAwait
                message={forgetting ? `Remove "${forgetting.title}"? Its text is deleted for good; the log keeps only a record that it was removed.` : ''}
                onSubmit={async () => {
                    try {
                        const a = await mrSneedActor(identity);
                        const r = await a.forget_about_me(forgetting.id, '');
                        if ('err' in r) throw new Error(r.err);
                    } catch (e) { setError(`Remove: ${e?.message || e}`); return; }
                    await Promise.all([loadAboutMe(), loadList(null), load()]);
                }}
            />
            {propose && config && (
                <ProposeDialog
                    theme={theme} identity={identity} governance={config.governance.toText()} functions={functions}
                    method={propose.method} initial={propose.args} onClose={() => setPropose(null)}
                />
            )}
        </>
    );
}

const METHOD_TITLES = {
    set_personality: 'Propose a new personality',
    set_writers: 'Propose who may write memories',
    set_limits: 'Propose new memory limits',
    remove_memory: 'Propose removing a memory',
};

/// Edit a change, see it rendered by the canister's own validator (what voters will see), and file
/// it from one of your neurons.
function ProposeDialog({ theme, identity, governance, functions, method, initial, onClose }) {
    const c = theme.colors;
    const [args, setArgs] = useState(initial);
    const [summary, setSummary] = useState('');
    const [neurons, setNeurons] = useState(null);
    const [neuron, setNeuron] = useState('');
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null); // { id } once filed
    const functionId = functions ? functions[method] : undefined;

    useEffect(() => {
        proposerNeurons(identity, governance).then((ns) => { setNeurons(ns); if (ns[0]) setNeuron(hex(ns[0].id[0].id)); }).catch(() => setNeurons([]));
    }, [identity, governance]);
    useEffect(() => {
        let live = true;
        const t = setTimeout(() => {
            let a = args;
            if (method === 'set_writers') {
                const ws = args.writers.map((w) => w.trim()).filter(Boolean);
                a = { writers: ws };
            }
            if (method === 'set_limits') {
                try { a = { limits: Object.fromEntries(Object.entries(args.limits).map(([k, v]) => [k, BigInt(String(v).trim() || '0')])) }; }
                catch { setPreview({ err: 'Limits are whole numbers' }); return; }
            }
            previewChange(method, a).then((p) => live && setPreview(p)).catch((e) => live && setPreview({ err: e?.message || String(e) }));
        }, 400);
        return () => { live = false; clearTimeout(t); };
    }, [method, args]);

    const normalized = () => {
        if (method === 'set_writers') return { writers: args.writers.map((w) => w.trim()).filter(Boolean) };
        if (method === 'set_limits') return { limits: Object.fromEntries(Object.entries(args.limits).map(([k, v]) => [k, BigInt(String(v).trim() || '0')])) };
        return args;
    };
    const tooLong = method === 'set_personality' && bytesOf(args.text) > PERSONALITY_MAX;
    const reasonMissing = (method === 'set_personality' || method === 'remove_memory') && !args.reason.trim();
    const canSubmit = functionId != null && neuron && preview?.ok && !reasonMissing && !tooLong && !busy && summary.trim();

    const submit = async () => {
        setBusy(true); setError('');
        try {
            const n = neurons.find((x) => hex(x.id[0].id) === neuron);
            const id = await proposeChange(identity, governance, { neuronId: n.id[0].id, functionId, method, args: normalized(), summary: `${summary.trim()}\n\n---\n${preview.ok}` });
            setDone({ id });
        } catch (e) { setError(e?.message || String(e)); }
        finally { setBusy(false); }
    };

    const input = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: 14, fontFamily: 'inherit' };
    const label = { display: 'block', fontSize: 12, color: c.mutedText, textTransform: 'uppercase', letterSpacing: 0.6, margin: '12px 0 6px' };
    const button = (primary, disabled) => ({ padding: '9px 18px', borderRadius: 999, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? c.accent : 'transparent', color: primary ? '#fff' : c.secondaryText, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 });

    return (
        <div role="dialog" aria-modal="true" aria-label={METHOD_TITLES[method]} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: c.primaryBg, border: `1px solid ${c.border}`, borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
                    <h2 style={{ margin: 0, fontSize: 18, color: c.primaryText }}>{METHOD_TITLES[method]}</h2>
                    <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ background: 'none', border: 'none', color: c.mutedText, cursor: 'pointer' }}><FaTimes /></button>
                </div>
                <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 18px 14px' }}>
                    {done ? (
                        <div style={{ padding: '18px 0', color: c.primaryText, lineHeight: 1.6 }}>
                            Proposal filed{done.id != null ? <> as <Link to={`/proposal?proposalid=${done.id}&sns=${SNEED_ROOT}`} style={{ color: c.accent }}>proposal {done.id.toString()}</Link></> : ''}. Your neuron voted yes on it automatically, as SNS proposers do. It takes effect if the DAO adopts it.
                        </div>
                    ) : (
                        <>
                            {functions && functionId == null && (
                                <div style={{ margin: '12px 0', padding: 12, borderRadius: 10, border: `1px solid ${c.warning || '#f59e0b'}`, color: c.secondaryText, fontSize: 14, lineHeight: 1.5 }}>
                                    The DAO has not registered <code>{method}</code> as a proposal type for Mr Sneed yet, so this can't be filed until it does. You can still draft the change and see how voters would see it.
                                </div>
                            )}
                            {method === 'set_personality' && (
                                <>
                                    <label style={label} htmlFor="mrs-text">Personality, version {args.expectedVersion + 1}</label>
                                    <textarea id="mrs-text" value={args.text} onChange={(e) => setArgs({ ...args, text: e.target.value })} rows={14} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
                                    <div style={{ textAlign: 'right', fontSize: 12, color: tooLong ? c.error : c.mutedText }}>{bytesOf(args.text).toLocaleString()} / {PERSONALITY_MAX.toLocaleString()} bytes</div>
                                    <label style={label} htmlFor="mrs-reason">Why (stored with the version)</label>
                                    <input id="mrs-reason" value={args.reason} maxLength={REASON_MAX} onChange={(e) => setArgs({ ...args, reason: e.target.value })} placeholder="What changes, and why" style={input} />
                                </>
                            )}
                            {method === 'set_writers' && (
                                <>
                                    <label style={label}>Principals that may write memories</label>
                                    {args.writers.map((w, i) => (
                                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}><PrincipalInput value={w} onChange={(v) => setArgs({ writers: args.writers.map((x, j) => (j === i ? v : x)) })} placeholder="Principal" /></div>
                                            <button type="button" aria-label="Remove" onClick={() => setArgs({ writers: args.writers.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', color: c.mutedText, cursor: 'pointer' }}><FaTimes /></button>
                                        </div>
                                    ))}
                                    <button type="button" onClick={() => setArgs({ writers: [...args.writers, ''] })} style={{ ...button(false), padding: '5px 12px', fontSize: 13 }}><FaPlus size={10} /> Add</button>
                                </>
                            )}
                            {method === 'set_limits' && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                                    {[['writes_per_day', 'Writes a day per writer'], ['max_pinned', 'Pinned'], ['max_active', 'Active memories'], ['max_bytes', 'Total bytes']].map(([k, t]) => (
                                        <div key={k}><label style={label} htmlFor={`mrs-${k}`}>{t}</label>
                                            <input id={`mrs-${k}`} inputMode="numeric" value={String(args.limits[k])} onChange={(e) => setArgs({ limits: { ...args.limits, [k]: e.target.value.replace(/[^0-9]/g, '') } })} style={input} /></div>
                                    ))}
                                </div>
                            )}
                            {method === 'remove_memory' && (
                                <>
                                    <p style={{ color: c.secondaryText, fontSize: 14, margin: '12px 0 0' }}>Memory #{args.id}: "{args.title}". If adopted, its text is deleted; the log keeps its hash and the reason.</p>
                                    <label style={label} htmlFor="mrs-rm-reason">Reason</label>
                                    <input id="mrs-rm-reason" value={args.reason} maxLength={REASON_MAX} onChange={(e) => setArgs({ ...args, reason: e.target.value })} placeholder="Why it should not be there" style={input} />
                                </>
                            )}

                            <label style={label} htmlFor="mrs-summary">Proposal summary</label>
                            <textarea id="mrs-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Explain the change to voters" style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
                            <div style={label}>What voters will see</div>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, padding: 12, borderRadius: 10, background: c.secondaryBg, border: `1px solid ${preview?.err ? c.error : c.border}`, color: preview?.err ? c.error : c.secondaryText, maxHeight: 220, overflowY: 'auto' }}>
                                {preview ? (preview.ok || preview.err) : 'Checking…'}
                            </div>

                            <label style={label} htmlFor="mrs-neuron">From your neuron</label>
                            {neurons === null ? <div style={{ color: c.mutedText, fontSize: 14 }}><FaSpinner className="mrs-spin" /> Looking for your neurons…</div>
                                : neurons.length === 0 ? <div style={{ color: c.secondaryText, fontSize: 14 }}>You need a Sneed neuron that lets you submit proposals. <Link to="/neurons" style={{ color: c.accent }}>Your neurons</Link></div>
                                : (
                                    <select id="mrs-neuron" value={neuron} onChange={(e) => setNeuron(e.target.value)} style={{ ...input, background: c.secondaryBg, color: c.primaryText }}>
                                        {neurons.map((n) => { const h = hex(n.id[0].id); return <option key={h} value={h} style={{ background: c.secondaryBg, color: c.primaryText }}>{h.slice(0, 12)}… · {(Number(n.cached_neuron_stake_e8s) / 1e8).toLocaleString()} SNEED</option>; })}
                                    </select>
                                )}
                            <p style={{ fontSize: 12, color: c.mutedText, margin: '8px 0 0', lineHeight: 1.5 }}>A rejected proposal costs its proposer the DAO's rejection fee. Your neuron votes yes on its own proposal automatically.</p>
                            {error && <div style={{ color: c.error, fontSize: 14, marginTop: 10 }}>{error}</div>}
                        </>
                    )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: `1px solid ${c.border}`, flexShrink: 0 }}>
                    <button type="button" onClick={onClose} disabled={busy} style={button(false, busy)}>{done ? 'Close' : 'Cancel'}</button>
                    {!done && <button type="button" onClick={submit} disabled={!canSubmit} style={button(true, !canSubmit)}>{busy ? <FaSpinner className="mrs-spin" /> : <FaGavel size={12} />} File proposal</button>}
                </div>
            </div>
        </div>
    );
}
