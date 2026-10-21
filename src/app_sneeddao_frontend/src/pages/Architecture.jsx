// /architecture: a map of Sneed DAO's canisters, what they connect to and which services use them.
// All data lives in src/data/architecture.js (see the note at its top for how to update it); the
// only live call is a read_state of a canister's controllers and module hash when you open it.
import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ReactFlow, { Background, MiniMap, MarkerType, Position, Handle, ReactFlowProvider, useReactFlow } from 'reactflow';
import 'reactflow/dist/style.css';
import { Principal } from '@dfinity/principal';
import {
    FaUsers, FaLandmark, FaCoins, FaRobot, FaComments, FaIdBadge, FaServer, FaGlobe, FaUser, FaFingerprint, FaVoteYea,
    FaSitemap, FaListUl, FaGift, FaPiggyBank, FaUserTie, FaLaptopCode, FaLock, FaExchangeAlt, FaCrown, FaRocket,
    FaShieldAlt, FaStore, FaBrain, FaChartLine, FaImage, FaEnvelope, FaBell, FaEye, FaBroadcastTower, FaUserTag, FaTags,
    FaUserCircle, FaAddressCard, FaArchive, FaBolt, FaLayerGroup, FaCogs, FaUniversity, FaBook, FaNetworkWired, FaWater,
    FaProjectDiagram, FaCircle, FaSearch, FaExpand, FaPlus, FaMinus, FaTimes, FaExternalLinkAlt, FaArrowRight,
    FaFileAlt, FaSpinner, FaCopy, FaCheck, FaInfoCircle, FaPlug,
} from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { readControllers, withTimeout } from '../health/agent';
import { apiDocs } from './Api';
import { CLUSTERS, CONTROLLERS, PERSISTENCE, EDGE_TYPES, NODES, EDGES, SERVICES, LAYOUT } from '../data/architecture';

const ICONS = {
    FaUsers, FaLandmark, FaCoins, FaRobot, FaComments, FaIdBadge, FaServer, FaGlobe, FaUser, FaFingerprint, FaVoteYea,
    FaSitemap, FaListUl, FaGift, FaPiggyBank, FaUserTie, FaLaptopCode, FaLock, FaExchangeAlt, FaCrown, FaRocket,
    FaShieldAlt, FaStore, FaBrain, FaChartLine, FaImage, FaEnvelope, FaBell, FaEye, FaBroadcastTower, FaUserTag, FaTags,
    FaUserCircle, FaAddressCard, FaArchive, FaBolt, FaLayerGroup, FaCogs, FaUniversity, FaBook, FaNetworkWired, FaWater,
    FaProjectDiagram, FaCircle, FaPlug,
};
const Icon = ({ name, ...rest }) => { const C = ICONS[name] || FaCircle; return <C {...rest} />; };

const ACCENT = '#8b5cf6';
const CLUSTER = Object.fromEntries(CLUSTERS.map((c) => [c.id, c]));
const NODE = Object.fromEntries(NODES.map((n) => [n.id, n]));
const SERVICE = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
const EDGE_TYPE = Object.fromEntries(EDGE_TYPES.map((t) => [t.id, t]));
const API_SLUGS = new Set(apiDocs.map((d) => d.slug));
const OUTSIDE = new Set(['external']);
const DASHBOARD = (id) => `https://dashboard.internetcomputer.org/canister/${id}`;

const KIND_LABEL = { dao: 'Sneed canister', sns: 'Sneed SNS canister', external: 'Outside canister', offchain: 'Off-chain', people: 'People' };
const STATUS_LABEL = { staging: 'Staging', upcoming: 'Coming soon' };
const statusOf = (n) => n.status || (n.ids?.ic || n.kind !== 'dao' ? 'live' : 'staging');

// ---- layout: clusters on a 3 × 2 grid, a band above and below, nodes on a grid inside each box ----

function computeLayout() {
    const { nodeW, nodeH, gapX, gapY, pad, head, clusterGapX, clusterGapY, bandCols } = LAYOUT;
    const rowsOf = (cid) => Math.max(1, ...NODES.filter((n) => n.cluster === cid).map((n) => n.at[1] + 1));
    const boxH = (rows) => head + rows * nodeH + (rows - 1) * gapY + pad;
    const boxW = pad * 2 + 2 * nodeW + gapX;
    const totalW = 3 * boxW + 2 * clusterGapX;
    const grid = CLUSTERS.filter((c) => c.box);
    const rowH = [0, 1].map((r) => Math.max(...grid.filter((c) => c.box[1] === r).map((c) => boxH(rowsOf(c.id)))));
    const top = CLUSTERS.find((c) => c.band === 'top');
    const bottom = CLUSTERS.find((c) => c.band === 'bottom');
    const topH = boxH(rowsOf(top.id));
    const boxes = {};
    boxes[top.id] = { x: 0, y: 0, w: totalW, h: topH };
    let y = topH + clusterGapY;
    for (const c of grid) {
        const by = y + (c.box[1] === 1 ? rowH[0] + clusterGapY : 0);
        boxes[c.id] = { x: c.box[0] * (boxW + clusterGapX), y: by, w: boxW, h: rowH[c.box[1]] };
    }
    const bottomY = y + rowH[0] + clusterGapY + rowH[1] + clusterGapY;
    boxes[bottom.id] = { x: 0, y: bottomY, w: totalW, h: boxH(rowsOf(bottom.id)) };
    const bandStep = (totalW - pad * 2 - nodeW) / (bandCols - 1);
    const pos = {};
    for (const n of NODES) {
        const b = boxes[n.cluster];
        const band = CLUSTER[n.cluster].band;
        const x = band ? b.x + pad + n.at[0] * bandStep : b.x + pad + n.at[0] * (nodeW + gapX);
        pos[n.id] = { x, y: b.y + head + n.at[1] * (nodeH + gapY) };
    }
    return { boxes, pos };
}
const LAYOUT_DATA = computeLayout();

/// Which sides an edge leaves and enters by, from the relative place of the two boxes.
function sides(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dy) > Math.abs(dx) * 0.5) return dy > 0 ? ['b', 't'] : ['t', 'b'];
    return dx > 0 ? ['r', 'l'] : ['l', 'r'];
}

// ---- diagram nodes ----

const hidden = { opacity: 0, width: 6, height: 6, minWidth: 0, minHeight: 0, border: 'none', pointerEvents: 'none' };
const HANDLES = [['t', Position.Top], ['b', Position.Bottom], ['l', Position.Left], ['r', Position.Right]];

const CanisterNode = memo(({ data }) => {
    const { n, c, ui } = data;
    const status = statusOf(n);
    const dashed = n.kind === 'external' ? 'dashed' : n.kind === 'offchain' ? 'dotted' : 'solid';
    return (
        <div
            title={`${n.name}: ${n.about}`}
            style={{
                width: LAYOUT.nodeW, height: LAYOUT.nodeH, boxSizing: 'border-box', borderRadius: 12,
                background: ui.nodeBg, border: `1.5px ${dashed} ${data.selected ? c.color : ui.border}`,
                boxShadow: data.selected ? `0 0 0 3px ${c.color}55, 0 8px 24px ${c.color}33` : ui.shadow,
                display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', cursor: 'pointer',
                opacity: data.dim ? 0.22 : 1, transition: 'opacity 0.2s, box-shadow 0.2s, border-color 0.2s', position: 'relative',
            }}
        >
            {HANDLES.map(([id, p]) => <Handle key={`s${id}`} id={`s${id}`} type="source" position={p} style={hidden} isConnectable={false} />)}
            {HANDLES.map(([id, p]) => <Handle key={`t${id}`} id={`t${id}`} type="target" position={p} style={hidden} isConnectable={false} />)}
            <div style={{
                width: 32, height: 32, flexShrink: 0, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: n.kind === 'dao' || n.kind === 'sns' ? `linear-gradient(135deg, ${c.color}, ${c.color}bb)` : `${c.color}22`,
            }}>
                <Icon name={n.icon} size={15} color={n.kind === 'dao' || n.kind === 'sns' ? '#fff' : c.color} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ui.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</div>
                <div style={{ fontSize: 10.5, color: ui.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.role}</div>
            </div>
            {status !== 'live' && (
                <span style={{
                    position: 'absolute', top: -8, right: 8, fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                    padding: '1px 6px', borderRadius: 6, background: status === 'upcoming' ? '#f59e0b' : ui.chipBg, color: status === 'upcoming' ? '#1a1a1a' : ui.muted,
                    border: `1px solid ${status === 'upcoming' ? '#f59e0b' : ui.border}`,
                }}>{STATUS_LABEL[status]}</span>
            )}
        </div>
    );
});

const ClusterNode = memo(({ data }) => {
    const { c, w, h, ui, dim } = data;
    return (
        <div style={{
            width: w, height: h, boxSizing: 'border-box', borderRadius: 18, pointerEvents: 'none',
            background: `${c.color}${ui.dark ? '10' : '0c'}`, border: `1px solid ${c.color}${ui.dark ? '40' : '35'}`,
            opacity: dim ? 0.5 : 1, transition: 'opacity 0.2s',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', color: c.color, fontWeight: 800, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                <Icon name={c.icon} size={13} /> {c.name}
            </div>
        </div>
    );
});

const NODE_TYPES = { canister: CanisterNode, cluster: ClusterNode };

// ---- small pieces ----

function useWidth() {
    const [w, setW] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
    useEffect(() => {
        const on = () => setW(window.innerWidth);
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);
    return w;
}

function CopyId({ id, theme }) {
    const [ok, setOk] = useState(false);
    return (
        <button type="button" title="Copy" onClick={async () => { try { await navigator.clipboard.writeText(id); setOk(true); setTimeout(() => setOk(false), 1200); } catch (e) { /* ignore */ } }}
            style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: ok ? theme.colors.success : theme.colors.mutedText, display: 'inline-flex' }}>
            {ok ? <FaCheck size={11} /> : <FaCopy size={11} />}
        </button>
    );
}

function IdLine({ label, id, theme, isAuthenticated }) {
    let principal = null;
    try { principal = Principal.fromText(id); } catch (e) { /* not a principal */ }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                {principal && id !== 'aaaaa-aa'
                    ? <PrincipalDisplay principal={principal} short={false} isAuthenticated={isAuthenticated} showSendMessage={false} style={{ fontSize: 12 }} />
                    : <code style={{ fontSize: 12, color: theme.colors.primaryText, wordBreak: 'break-all' }}>{id}</code>}
                {!(principal && id !== 'aaaaa-aa') && <CopyId id={id} theme={theme} />}
                {id !== 'aaaaa-aa' && <a href={DASHBOARD(id)} target="_blank" rel="noopener noreferrer" title="IC dashboard" style={{ color: theme.colors.mutedText, display: 'inline-flex' }}><FaExternalLinkAlt size={10} /></a>}
            </div>
        </div>
    );
}

const liveCache = new Map();

/// Controllers and module hash, read from the IC's state tree (no canister call, no login).
function LiveFacts({ id, theme, isAuthenticated }) {
    const [state, setState] = useState(() => liveCache.get(id) || { loading: true });
    useEffect(() => {
        let gone = false;
        const cached = liveCache.get(id);
        if (cached && !cached.error) { setState(cached); return undefined; }
        setState({ loading: true });
        withTimeout(readControllers(id), 15000, 'read_state')
            .then((r) => {
                const h = r.moduleHash;
                const hash = !h ? null : typeof h === 'string' ? h : Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
                const v = { controllers: r.controllers, hash };
                liveCache.set(id, v);
                if (!gone) setState(v);
            })
            .catch((e) => { if (!gone) setState({ error: String(e?.message || e).slice(0, 140) }); });
        return () => { gone = true; };
    }, [id]);
    const label = { fontSize: 11, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: 0.4 };
    if (state.loading) return <div style={{ fontSize: 12, color: theme.colors.mutedText, display: 'flex', alignItems: 'center', gap: 6 }}><FaSpinner className="arch-spin" /> Reading controllers and module hash…</div>;
    if (state.error) return <div style={{ fontSize: 12, color: theme.colors.mutedText }}>Could not read it live: {state.error}</div>;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
                <div style={label}>Controllers, live</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 3 }}>
                    {state.controllers.length === 0 && <span style={{ fontSize: 12, color: theme.colors.primaryText }}>None: blackholed</span>}
                    {state.controllers.map((p) => {
                        let pr = null;
                        try { pr = Principal.fromText(p); } catch (e) { /* ignore */ }
                        return pr ? <PrincipalDisplay key={p} principal={pr} short isAuthenticated={isAuthenticated} style={{ fontSize: 12 }} /> : <code key={p}>{p}</code>;
                    })}
                </div>
            </div>
            <div>
                <div style={label}>Module hash, live</div>
                {state.hash
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><code style={{ fontSize: 11.5, color: theme.colors.primaryText }} title={state.hash}>{state.hash.slice(0, 16)}…{state.hash.slice(-6)}</code><CopyId id={state.hash} theme={theme} /></div>
                    : <span style={{ fontSize: 12, color: theme.colors.primaryText }}>No code installed</span>}
            </div>
        </div>
    );
}

function EdgeRow({ e, other, onPick, theme }) {
    const t = EDGE_TYPE[e.type];
    const o = NODE[other];
    return (
        <button type="button" onClick={() => onPick(other)} className="arch-row" style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none',
            padding: '6px 8px', borderRadius: 8, cursor: 'pointer', color: theme.colors.primaryText,
        }}>
            <span style={{ width: 18, flexShrink: 0, marginTop: 7, borderTop: `2px ${t.dash ? 'dashed' : 'solid'} ${t.color}` }} />
            <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{o.name}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: theme.colors.mutedText, lineHeight: 1.35 }}>{e.label}</span>
            </span>
        </button>
    );
}

function Fact({ label, children, theme, note }) {
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
            <div style={{ fontSize: 13, color: theme.colors.primaryText, marginTop: 2 }} title={note}>{children}</div>
        </div>
    );
}

function NodePanel({ n, onClose, onPickNode, onPickService, theme, isAuthenticated }) {
    const c = CLUSTER[n.cluster];
    const status = statusOf(n);
    const out = EDGES.filter((e) => e.from === n.id);
    const inc = EDGES.filter((e) => e.to === n.id);
    const services = SERVICES.filter((s) => s.canisters.includes(n.id));
    const liveId = n.ids?.ic || n.ids?.staging;
    const ctl = CONTROLLERS[n.controllers];
    const per = PERSISTENCE[n.persistence];
    const apiHref = n.api ? (API_SLUGS.has(n.api) ? `/api/${n.api}` : `/api-docs/${n.api}.md`) : null;
    const section = { fontSize: 12, fontWeight: 700, color: theme.colors.secondaryText, textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 6px' };
    const canister = n.kind === 'dao' || n.kind === 'sns' || n.ids;
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${c.color}, ${c.color}bb)` }}>
                    <Icon name={n.icon} size={18} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: theme.colors.primaryText, lineHeight: 1.2 }}>{n.name}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                        <span className="arch-chip" style={{ background: `${c.color}22`, color: c.color }}>{c.name}</span>
                        <span className="arch-chip" style={{ background: theme.colors.secondaryBg, color: theme.colors.secondaryText }}>{KIND_LABEL[n.kind]}</span>
                        {status !== 'live' && <span className="arch-chip" style={{ background: status === 'upcoming' ? '#f59e0b' : theme.colors.secondaryBg, color: status === 'upcoming' ? '#1a1a1a' : theme.colors.secondaryText }}>{STATUS_LABEL[status]}</span>}
                    </div>
                </div>
                <button type="button" onClick={onClose} title="Close" style={{ background: 'none', border: 'none', color: theme.colors.mutedText, cursor: 'pointer', padding: 4 }}><FaTimes /></button>
            </div>
            <p style={{ fontSize: 13.5, lineHeight: 1.55, color: theme.colors.secondaryText, margin: '12px 0 0' }}>{n.about}</p>

            {(n.ids?.ic || n.ids?.staging) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                    {n.ids.ic && <IdLine label="Mainnet" id={n.ids.ic} theme={theme} isAuthenticated={isAuthenticated} />}
                    {n.ids.staging && n.ids.staging !== n.ids.ic && <IdLine label="Staging" id={n.ids.staging} theme={theme} isAuthenticated={isAuthenticated} />}
                </div>
            )}

            {canister && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 14px', marginTop: 14 }}>
                    {ctl && <Fact label="Controlled by" theme={theme} note={ctl.note}>{ctl.label}</Fact>}
                    {per && <Fact label="Persistence" theme={theme} note={per.note}>{n.persistence === 'eop' ? 'Enhanced (EOP)' : 'Classic'}</Fact>}
                    {n.kind !== 'offchain' && n.kind !== 'people' && <Fact label="ICRC-3 log" theme={theme}>{n.icrc3 ? 'Yes' : 'No'}</Fact>}
                    {apiHref && <Fact label="API doc" theme={theme}>{apiHref.startsWith('/api/') ? <Link to={apiHref} style={{ color: theme.colors.accent }}>{n.api} <FaArrowRight size={9} /></Link> : <a href={apiHref} style={{ color: theme.colors.accent }}>{n.api}.md</a>}</Fact>}
                </div>
            )}
            {ctl && <div style={{ fontSize: 11.5, color: theme.colors.mutedText, marginTop: 6, lineHeight: 1.4 }}>{ctl.note}{per ? ` ${per.note}` : ''}</div>}

            {liveId && liveId !== 'aaaaa-aa' && (
                <>
                    <div style={section}>From the IC now{!n.ids?.ic ? ' (staging)' : ''}</div>
                    <LiveFacts id={liveId} theme={theme} isAuthenticated={isAuthenticated} />
                </>
            )}

            {services.length > 0 && (
                <>
                    <div style={section}>Used by</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {services.map((s) => (
                            <button key={s.id} type="button" onClick={() => onPickService(s.id)} className="arch-chip arch-chip-btn" style={{ background: `${CLUSTER[s.cluster].color}1f`, color: theme.colors.primaryText, border: `1px solid ${CLUSTER[s.cluster].color}55` }}>{s.name}</button>
                        ))}
                    </div>
                </>
            )}
            {out.length > 0 && (<><div style={section}>Calls and pays ({out.length})</div>{out.map((e, i) => <EdgeRow key={`o${i}`} e={e} other={e.to} onPick={onPickNode} theme={theme} />)}</>)}
            {inc.length > 0 && (<><div style={section}>Called by ({inc.length})</div>{inc.map((e, i) => <EdgeRow key={`i${i}`} e={e} other={e.from} onPick={onPickNode} theme={theme} />)}</>)}
        </div>
    );
}

function ServicePanel({ s, onClose, onPickNode, theme }) {
    const c = CLUSTER[s.cluster];
    const set = new Set(s.canisters);
    const inner = EDGES.filter((e) => set.has(e.from) && set.has(e.to) && e.type !== 'control');
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${c.color}, ${c.color}bb)` }}>
                    <Icon name={c.icon} size={18} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: theme.colors.primaryText }}>{s.name}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                        <span className="arch-chip" style={{ background: `${c.color}22`, color: c.color }}>{c.name}</span>
                        {s.upcoming && <span className="arch-chip" style={{ background: '#f59e0b', color: '#1a1a1a' }}>Coming soon</span>}
                    </div>
                </div>
                <button type="button" onClick={onClose} title="Close" style={{ background: 'none', border: 'none', color: theme.colors.mutedText, cursor: 'pointer', padding: 4 }}><FaTimes /></button>
            </div>
            <Link to={s.route} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, color: theme.colors.accent, fontSize: 13, fontWeight: 600 }}>Open {s.name} <FaArrowRight size={10} /></Link>
            <div style={{ fontSize: 12, fontWeight: 700, color: theme.colors.secondaryText, textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 6px' }}>Canisters and parts ({s.canisters.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {s.canisters.map((id, i) => {
                    const n = NODE[id];
                    const nc = CLUSTER[n.cluster];
                    return (
                        <button key={id} type="button" onClick={() => onPickNode(id)} className="arch-row" style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: '6px 8px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: theme.colors.primaryText }}>
                            <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${nc.color}22` }}><Icon name={n.icon} size={12} color={nc.color} /></span>
                            <span style={{ minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{n.name}</span>{i === 0 && <span style={{ fontSize: 11, color: theme.colors.mutedText }}> · main</span>}
                                <span style={{ display: 'block', fontSize: 11.5, color: theme.colors.mutedText }}>{n.role}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
            <div style={{ fontSize: 12, color: theme.colors.mutedText, marginTop: 10 }}>{inner.length} connection{inner.length === 1 ? '' : 's'} between them are highlighted. Tap a canister for its details.</div>
        </div>
    );
}

// ---- the page ----

function ArchitectureInner() {
    const { theme, isDark } = useTheme();
    const { isAuthenticated } = useAuth();
    const width = useWidth();
    const wide = width >= 980;
    const flow = useReactFlow();
    const [params, setParams] = useSearchParams();
    const selectedNode = NODE[params.get('canister')] ? params.get('canister') : null;
    const selectedService = !selectedNode && SERVICE[params.get('service')] ? params.get('service') : null;
    const [types, setTypes] = useState(() => new Set(EDGE_TYPES.filter((t) => t.on).map((t) => t.id)));
    const [outside, setOutside] = useState(false);
    const [query, setQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const diagramRef = useRef(null);

    const select = useCallback((kind, id) => {
        const next = new URLSearchParams(params);
        next.delete('canister'); next.delete('service');
        if (id) next.set(kind, id);
        setParams(next, { replace: true });
    }, [params, setParams]);
    const pickNode = useCallback((id) => select('canister', id), [select]);
    const pickService = useCallback((id) => select('service', id), [select]);
    const clear = useCallback(() => select(null, null), [select]);
    const toDiagram = () => diagramRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') clear(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [clear]);

    // what is in focus: a canister and its neighbours, or a service's canisters
    const focus = useMemo(() => {
        if (selectedNode) {
            const nodes = new Set([selectedNode]);
            const edges = new Set();
            EDGES.forEach((e, i) => { if ((e.from === selectedNode || e.to === selectedNode) && types.has(e.type)) { edges.add(i); nodes.add(e.from); nodes.add(e.to); } });
            return { nodes, edges, labels: edges.size <= 8 };
        }
        if (selectedService) {
            const nodes = new Set(SERVICE[selectedService].canisters);
            const edges = new Set();
            EDGES.forEach((e, i) => { if (nodes.has(e.from) && nodes.has(e.to) && types.has(e.type)) edges.add(i); });
            return { nodes, edges, labels: false };
        }
        return null;
    }, [selectedNode, selectedService, types]);

    const ui = useMemo(() => ({
        dark: isDark,
        nodeBg: isDark ? '#232327' : '#ffffff',
        chipBg: isDark ? '#2f2f35' : '#f1f3f5',
        border: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)',
        shadow: isDark ? '0 2px 10px rgba(0,0,0,0.45)' : '0 2px 10px rgba(15,23,42,0.08)',
        text: theme.colors.primaryText,
        muted: theme.colors.mutedText,
    }), [isDark, theme]);

    const nodes = useMemo(() => {
        const boxes = CLUSTERS.map((c) => {
            const b = LAYOUT_DATA.boxes[c.id];
            const dim = focus ? !NODES.some((n) => n.cluster === c.id && focus.nodes.has(n.id)) : false;
            return { id: `cluster:${c.id}`, type: 'cluster', position: { x: b.x, y: b.y }, data: { c, w: b.w, h: b.h, ui, dim }, draggable: false, selectable: false, focusable: false, zIndex: 0, style: { pointerEvents: 'none' } };
        });
        const items = NODES.map((n) => ({
            id: n.id, type: 'canister', position: LAYOUT_DATA.pos[n.id], draggable: false, zIndex: 2,
            data: { n, c: CLUSTER[n.cluster], ui, selected: n.id === selectedNode, dim: focus ? !focus.nodes.has(n.id) : false },
        }));
        return [...boxes, ...items];
    }, [focus, ui, selectedNode]);

    const edges = useMemo(() => EDGES.map((e, i) => {
        const t = EDGE_TYPE[e.type];
        const a = LAYOUT_DATA.pos[e.from];
        const b = LAYOUT_DATA.pos[e.to];
        const [s, d] = sides(a, b);
        const on = types.has(e.type);
        const inFocus = focus?.edges.has(i);
        const touchesOutside = OUTSIDE.has(NODE[e.from].cluster) || OUTSIDE.has(NODE[e.to].cluster);
        const visible = on && (focus ? true : (outside || !touchesOutside));
        const opacity = focus ? (inFocus ? 1 : 0.05) : 0.5;
        return {
            id: `e${i}`, source: e.from, target: e.to, sourceHandle: `s${s}`, targetHandle: `t${d}`, type: 'default',
            hidden: !visible, zIndex: inFocus ? 3 : 1,
            animated: Boolean(inFocus && (e.type === 'notify' || e.type === 'relay')),
            style: { stroke: t.color, strokeWidth: inFocus ? 2.2 : 1.3, strokeDasharray: t.dash || undefined, opacity, transition: 'opacity 0.2s' },
            markerEnd: { type: MarkerType.ArrowClosed, color: t.color, width: 14, height: 14 },
            label: inFocus && focus.labels ? e.label : undefined,
            labelStyle: { fontSize: 10.5, fill: theme.colors.primaryText, fontWeight: 500 },
            labelBgStyle: { fill: isDark ? '#18181b' : '#ffffff', fillOpacity: 0.92 },
            labelBgPadding: [5, 3], labelBgBorderRadius: 5,
        };
    }), [types, focus, outside, theme, isDark]);

    // bring the focus into view
    useEffect(() => {
        if (!focus) return undefined;
        const timer = setTimeout(() => flow.fitView({ nodes: [...focus.nodes].map((id) => ({ id })), padding: 0.25, duration: 500, maxZoom: 1.1 }), 60);
        return () => clearTimeout(timer);
    }, [focus, flow]);

    const fitAll = () => flow.fitView({ padding: 0.06, duration: 400 });
    const toggleType = (id) => setTypes((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const hit = (s) => s && s.toLowerCase().includes(q);
        const svc = SERVICES.filter((s) => hit(s.name) || hit(s.id)).map((s) => ({ kind: 'service', id: s.id, name: s.name, sub: `Service · ${CLUSTER[s.cluster].name}`, color: CLUSTER[s.cluster].color, icon: CLUSTER[s.cluster].icon }));
        const nod = NODES.filter((n) => hit(n.name) || hit(n.role) || hit(n.id) || hit(n.ids?.ic) || hit(n.ids?.staging)).map((n) => ({ kind: 'canister', id: n.id, name: n.name, sub: `${KIND_LABEL[n.kind]} · ${n.role}`, color: CLUSTER[n.cluster].color, icon: n.icon }));
        return [...svc, ...nod].slice(0, 9);
    }, [query]);
    const choose = (r) => { select(r.kind, r.id); setQuery(''); setSearchOpen(false); };

    const counts = useMemo(() => {
        const ours = NODES.filter((n) => n.kind === 'dao' && n.id !== 'icrc3_archives');
        return {
            ours: ours.length,
            dao: ours.filter((n) => n.controllers === 'sns').length,
            outside: NODES.filter((n) => n.kind === 'external').length,
            edges: EDGES.filter((e) => e.type !== 'control').length,
            services: SERVICES.length,
        };
    }, []);

    const panel = selectedNode
        ? <NodePanel n={NODE[selectedNode]} onClose={clear} onPickNode={pickNode} onPickService={pickService} theme={theme} isAuthenticated={isAuthenticated} />
        : selectedService ? <ServicePanel s={SERVICE[selectedService]} onClose={clear} onPickNode={pickNode} theme={theme} /> : null;

    const card = { background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, borderRadius: 16, boxShadow: theme.colors.cardShadow };
    const btn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, minWidth: 34, padding: '0 10px', borderRadius: 9, border: `1px solid ${theme.colors.border}`, background: isDark ? '#1f1f23' : '#ffffff', color: theme.colors.primaryText, cursor: 'pointer', fontSize: 13 };
    const css = `
        @keyframes arch-spin { to { transform: rotate(360deg); } } .arch-spin { animation: arch-spin 1s linear infinite; }
        .arch-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; border: 1px solid transparent; white-space: nowrap; }
        .arch-chip-btn { cursor: pointer; font-family: inherit; transition: transform 0.15s, filter 0.15s; }
        .arch-chip-btn:hover { transform: translateY(-1px); filter: brightness(1.08); }
        .arch-row:hover { background: ${theme.colors.secondaryBg} !important; }
        .arch-cluster-card { transition: transform 0.2s, box-shadow 0.2s; }
        .arch-cluster-card:hover { transform: translateY(-2px); }
        .arch-flow .react-flow__edge-text { font-family: inherit; }
        .arch-flow .react-flow__node { cursor: default; }
        .arch-flow .react-flow__node-canister { cursor: pointer; }
        .arch-flow .react-flow__minimap { background: ${isDark ? '#141417' : '#f8fafc'}; border: 1px solid ${theme.colors.border}; border-radius: 10px; overflow: hidden; }
    `;

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{css}</style>
            <Header />

            {/* hero */}
            <div style={{ background: `linear-gradient(135deg, ${ACCENT}18 0%, #0ea5e910 55%, transparent 100%)`, borderBottom: `1px solid ${theme.colors.border}`, padding: '2.2rem 16px 1.8rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: '-60%', right: '-8%', width: 420, height: 420, background: `radial-gradient(circle, ${ACCENT}22 0%, transparent 70%)`, pointerEvents: 'none' }} />
                <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{ width: 56, height: 56, borderRadius: 16, background: `linear-gradient(135deg, ${ACCENT}, #0ea5e9)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 10px 32px ${ACCENT}45`, flexShrink: 0 }}>
                            <FaProjectDiagram size={26} color="#fff" />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <h1 style={{ margin: 0, fontSize: 'clamp(1.6rem, 4vw, 2.1rem)', fontWeight: 800, color: theme.colors.primaryText, letterSpacing: '-0.5px' }}>Architecture</h1>
                            <p style={{ margin: '4px 0 0', color: theme.colors.secondaryText, fontSize: '0.95rem', lineHeight: 1.55, maxWidth: 720 }}>
                                How Sneed DAO is built: the canisters behind each service, what they call and pay, and who controls them.
                                Pick a service to light up its canisters, or a canister for its ids, controllers and connections.
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                        {[
                            [counts.ours, 'Sneed canisters'],
                            [counts.dao, 'controlled by the DAO'],
                            [counts.services, 'services'],
                            [counts.outside, 'outside dependencies'],
                            [counts.edges, 'connections'],
                        ].map(([v, l]) => (
                            <div key={l} style={{ padding: '7px 12px', borderRadius: 10, background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.75)', border: `1px solid ${theme.colors.border}`, fontSize: 13, color: theme.colors.secondaryText }}>
                                <b style={{ color: theme.colors.primaryText, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{v}</b> {l}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <main style={{ maxWidth: 1200, margin: '0 auto', padding: '1.25rem 16px 3rem', boxSizing: 'border-box' }}>
                {/* overview: clusters and their services */}
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: theme.colors.primaryText, margin: '0 0 12px' }}>At a glance</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))', gap: 12, marginBottom: 22 }}>
                    {CLUSTERS.filter((c) => c.box).map((c) => {
                        const svcs = SERVICES.filter((s) => s.cluster === c.id);
                        const n = NODES.filter((x) => x.cluster === c.id && (x.kind === 'dao' || x.kind === 'sns')).length;
                        return (
                            <section key={c.id} className="arch-cluster-card" style={{ ...card, padding: '14px 16px', borderTop: `3px solid ${c.color}`, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${c.color}, ${c.color}bb)`, flexShrink: 0 }}><Icon name={c.icon} size={15} color="#fff" /></div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontWeight: 800, color: theme.colors.primaryText, fontSize: 15 }}>{c.name}</div>
                                        <div style={{ fontSize: 11.5, color: theme.colors.mutedText }}>{n} canister{n === 1 ? '' : 's'} · {svcs.length} service{svcs.length === 1 ? '' : 's'}</div>
                                    </div>
                                </div>
                                <p style={{ fontSize: 12.5, color: theme.colors.secondaryText, lineHeight: 1.5, margin: '9px 0 10px' }}>{c.blurb}</p>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {svcs.map((s) => {
                                        const active = s.id === selectedService;
                                        return (
                                            <button key={s.id} type="button" className="arch-chip arch-chip-btn" onClick={() => { pickService(s.id); toDiagram(); }}
                                                style={{ background: active ? c.color : `${c.color}18`, color: active ? '#fff' : theme.colors.primaryText, border: `1px solid ${c.color}${active ? '' : '50'}` }}>
                                                {s.name}{s.upcoming && <span style={{ fontSize: 9, fontWeight: 800, color: active ? '#fff' : '#f59e0b', textTransform: 'uppercase' }}>soon</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                </div>

                {/* the diagram */}
                <div ref={diagramRef} style={{ scrollMarginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: theme.colors.primaryText, margin: 0 }}>Network</h2>
                        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 380, minWidth: 0 }}>
                            <FaSearch size={12} style={{ position: 'absolute', left: 11, top: 11, color: theme.colors.mutedText }} />
                            <input
                                value={query}
                                onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
                                onFocus={() => setSearchOpen(true)}
                                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) choose(results[0]); }}
                                placeholder="Find a canister, service or id"
                                aria-label="Find a canister, service or id"
                                style={{ width: '100%', boxSizing: 'border-box', height: 34, padding: '0 10px 0 30px', borderRadius: 9, border: `1px solid ${theme.colors.border}`, background: isDark ? '#1f1f23' : '#ffffff', color: theme.colors.primaryText, fontSize: 13, outline: 'none' }}
                            />
                            {searchOpen && results.length > 0 && (
                                <div style={{ position: 'absolute', top: 38, left: 0, right: 0, zIndex: 20, background: isDark ? '#1f1f23' : '#ffffff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.25)', padding: 4 }}>
                                    {results.map((r) => (
                                        <button key={`${r.kind}:${r.id}`} type="button" className="arch-row" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}
                                            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', padding: '6px 8px', borderRadius: 7, cursor: 'pointer', textAlign: 'left', color: theme.colors.primaryText }}>
                                            <span style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${r.color}22`, flexShrink: 0 }}><Icon name={r.icon} size={11} color={r.color} /></span>
                                            <span style={{ minWidth: 0 }}>
                                                <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                                                <span style={{ display: 'block', fontSize: 11, color: theme.colors.mutedText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* legend = filters */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                        {EDGE_TYPES.map((t) => {
                            const on = types.has(t.id);
                            return (
                                <button key={t.id} type="button" onClick={() => toggleType(t.id)} title={`${t.note}: ${on ? 'shown' : 'hidden'}`} aria-pressed={on}
                                    style={{ ...btn, height: 30, gap: 8, opacity: on ? 1 : 0.5, borderColor: on ? `${t.color}90` : theme.colors.border }}>
                                    <svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="24" y2="4" stroke={t.color} strokeWidth="2.2" strokeDasharray={t.dash || undefined} /></svg>
                                    {t.label}
                                </button>
                            );
                        })}
                        <button type="button" onClick={() => setOutside((v) => !v)} aria-pressed={outside} title="Show the lines to outside canisters before anything is picked"
                            style={{ ...btn, height: 30, opacity: outside ? 1 : 0.6, borderColor: outside ? '#0ea5e990' : theme.colors.border }}>
                            <FaGlobe size={11} color="#0ea5e9" /> Outside lines
                        </button>
                        <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: theme.colors.mutedText, marginLeft: 4 }}>
                            <span><span style={{ display: 'inline-block', width: 14, height: 10, borderRadius: 3, border: `1.5px solid ${theme.colors.mutedText}`, verticalAlign: -1 }} /> Sneed</span>
                            <span><span style={{ display: 'inline-block', width: 14, height: 10, borderRadius: 3, border: `1.5px dashed ${theme.colors.mutedText}`, verticalAlign: -1 }} /> outside</span>
                            <span><span style={{ display: 'inline-block', width: 14, height: 10, borderRadius: 3, border: `1.5px dotted ${theme.colors.mutedText}`, verticalAlign: -1 }} /> off-chain</span>
                        </span>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                        <div className="arch-flow" style={{ ...card, flex: 1, minWidth: 0, height: wide ? 'min(76vh, 820px)' : 480, position: 'relative', overflow: 'hidden', background: isDark ? '#161619' : '#fbfcfe' }}>
                            <ReactFlow
                                nodes={nodes}
                                edges={edges}
                                nodeTypes={NODE_TYPES}
                                fitView
                                fitViewOptions={{ padding: 0.06 }}
                                minZoom={0.12}
                                maxZoom={2}
                                nodesDraggable={false}
                                nodesConnectable={false}
                                elementsSelectable={false}
                                zoomOnScroll={false}
                                zoomActivationKeyCode={['Control', 'Meta']}
                                preventScrolling={false}
                                zoomOnDoubleClick={false}
                                onNodeClick={(_, node) => { if (node.type === 'canister') pickNode(node.id === selectedNode ? null : node.id); }}
                                onPaneClick={clear}
                                proOptions={{ hideAttribution: true }}
                                style={{ width: '100%', height: '100%' }}
                            >
                                <Background color={isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.08)'} gap={22} size={1.2} />
                                {wide && <MiniMap position="top-right" pannable zoomable nodeColor={(nd) => (nd.type === 'cluster' ? 'transparent' : CLUSTER[NODE[nd.id]?.cluster]?.color || '#888')} nodeStrokeColor={(nd) => (nd.type === 'cluster' ? CLUSTER[nd.id.slice(8)]?.color || '#888' : 'transparent')} nodeBorderRadius={6} maskColor={isDark ? 'rgba(0,0,0,0.55)' : 'rgba(240,244,248,0.7)'} style={{ width: 170, height: 110 }} />}
                            </ReactFlow>
                            <div style={{ position: 'absolute', left: 10, top: 10, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 5 }}>
                                <button type="button" style={btn} title="Zoom in" onClick={() => flow.zoomIn({ duration: 200 })}><FaPlus size={11} /></button>
                                <button type="button" style={btn} title="Zoom out" onClick={() => flow.zoomOut({ duration: 200 })}><FaMinus size={11} /></button>
                                <button type="button" style={btn} title="Fit everything" onClick={fitAll}><FaExpand size={11} /></button>
                                {(selectedNode || selectedService) && <button type="button" style={btn} title="Clear the selection (Esc)" onClick={clear}><FaTimes size={11} /></button>}
                            </div>
                            {!selectedNode && !selectedService && (
                                <div style={{ position: 'absolute', left: 54, top: 12, right: 12, zIndex: 4, fontSize: 11.5, color: theme.colors.mutedText, pointerEvents: 'none' }}>
                                    Tap a box for details. {wide ? 'Drag to move, Ctrl + scroll or the buttons to zoom.' : 'Pinch to zoom.'}
                                </div>
                            )}
                        </div>
                        {wide && (
                            <aside style={{ ...card, width: 350, flexShrink: 0, height: 'min(76vh, 820px)', overflowY: 'auto', padding: 16, boxSizing: 'border-box' }}>
                                {panel || <PanelIntro theme={theme} onPickService={pickService} />}
                            </aside>
                        )}
                    </div>
                    {!wide && panel && <div style={{ ...card, padding: 16, marginTop: 12 }}>{panel}</div>}
                </div>

                {/* directory */}
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: theme.colors.primaryText, margin: '26px 0 6px' }}>All canisters</h2>
                <p style={{ fontSize: 13, color: theme.colors.secondaryText, margin: '0 0 12px', lineHeight: 1.5 }}>
                    Sneed's own canisters by cluster, with their mainnet ids. <span style={{ color: theme.colors.mutedText }}>DAO = controlled by the SNS root; EOP = enhanced orthogonal persistence; ICRC-3 = keeps a public activity log.</span>
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))', gap: 12 }}>
                    {CLUSTERS.filter((c) => c.box).map((c) => (
                        <section key={c.id} style={{ ...card, padding: '10px 8px', minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px 6px', color: c.color, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}><Icon name={c.icon} size={11} /> {c.name}</div>
                            {NODES.filter((n) => n.cluster === c.id).map((n) => (
                                <button key={n.id} type="button" className="arch-row" onClick={() => { pickNode(n.id); toDiagram(); }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: n.id === selectedNode ? `${c.color}18` : 'none', border: 'none', padding: '7px 8px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: theme.colors.primaryText }}>
                                    <span style={{ width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${c.color}22`, flexShrink: 0 }}><Icon name={n.icon} size={11} color={c.color} /></span>
                                    <span style={{ minWidth: 0, flex: 1 }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: 13, fontWeight: 650 }}>{n.name}</span>
                                            {n.controllers === 'sns' && n.kind === 'dao' && <Tag theme={theme}>DAO</Tag>}
                                            {n.persistence === 'eop' && <Tag theme={theme}>EOP</Tag>}
                                            {n.icrc3 && <Tag theme={theme}>ICRC-3</Tag>}
                                            {statusOf(n) !== 'live' && <Tag theme={theme} warn={statusOf(n) === 'upcoming'}>{STATUS_LABEL[statusOf(n)]}</Tag>}
                                        </span>
                                        <span style={{ display: 'block', fontSize: 11, color: theme.colors.mutedText, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {n.ids?.ic || (n.ids?.staging ? `staging ${n.ids.staging}` : n.role)}
                                        </span>
                                    </span>
                                </button>
                            ))}
                        </section>
                    ))}
                </div>

                <div style={{ ...card, padding: '12px 14px', marginTop: 18, fontSize: 12.5, color: theme.colors.mutedText, lineHeight: 1.55, display: 'flex', gap: 10 }}>
                    <FaInfoCircle style={{ marginTop: 3, flexShrink: 0 }} />
                    <div>
                        Connections are read from each canister's source code; the web app itself calls nearly every canister from your browser, so those lines are left out.
                        Controllers shown as facts are a snapshot; the live section reads them from the IC when you open a canister.
                        Developers: the interfaces are in the <Link to="/api" style={{ color: theme.colors.accent }}>API docs</Link>, the DAO's state in <Link to="/health" style={{ color: theme.colors.accent }}>Health</Link>, and the money flows in the <Link to="/rll_info" style={{ color: theme.colors.accent }}>tokenomics diagram</Link>.
                    </div>
                </div>
            </main>
        </div>
    );
}

function Tag({ children, theme, warn }) {
    return <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, padding: '1px 5px', borderRadius: 5, background: warn ? '#f59e0b' : theme.colors.secondaryBg, color: warn ? '#1a1a1a' : theme.colors.secondaryText, border: `1px solid ${warn ? '#f59e0b' : theme.colors.border}` }}>{children}</span>;
}

function PanelIntro({ theme, onPickService }) {
    return (
        <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: theme.colors.primaryText }}>Details</div>
            <p style={{ fontSize: 13, color: theme.colors.secondaryText, lineHeight: 1.55, margin: '8px 0 14px' }}>
                Pick a box in the diagram, a service above or a result from the search. Its canisters light up with their connections, and the details show here.
            </p>
            <div style={{ fontSize: 12, fontWeight: 700, color: theme.colors.secondaryText, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Try</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {['sneedex', 'notifications', 'studio', 'rewards'].map((id) => {
                    const s = SERVICE[id];
                    const c = CLUSTER[s.cluster];
                    return (
                        <button key={id} type="button" className="arch-row" onClick={() => onPickService(id)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', textAlign: 'left', color: theme.colors.primaryText }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{s.name}</span>
                            <FaArrowRight size={10} color={theme.colors.mutedText} />
                        </button>
                    );
                })}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: theme.colors.secondaryText, textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 8px' }}>Lines</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {EDGE_TYPES.map((t) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: theme.colors.secondaryText }}>
                        <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke={t.color} strokeWidth="2.2" strokeDasharray={t.dash || undefined} /></svg>
                        <span><b style={{ color: theme.colors.primaryText }}>{t.label}</b> · {t.note}{t.on ? '' : ' (off until you switch it on)'}</span>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, fontSize: 12, color: theme.colors.mutedText }}>
                <FaFileAlt size={11} /> Data: <code>src/data/architecture.js</code>
            </div>
        </div>
    );
}

export default function Architecture() {
    return (
        <ReactFlowProvider>
            <ArchitectureInner />
        </ReactFlowProvider>
    );
}
