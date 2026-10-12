// "Follow the money": an explorable graph of who sent this token to whom,
// drawn from the scan the token safety page already holds. Nodes are
// principals (subaccounts folded), edges are directed transfers. Start at
// any node and expand its counterparties; known canisters are marked, and
// the sleuthing results (satellites, hubs) are overlaid. Names and nicknames
// come from the Sneed naming context.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNaming } from '../NamingContext';
import { getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { holdersByOwner } from './scan.js';

const COLORS = {
    node: '#22d3ee', pool: '#3b82f6', lock: '#f59e0b', dao: '#22c55e', mint: '#a78bfa', burn: '#64748b', hub: '#ef4444', satellite: '#94a3b8', genesis: '#f472b6', start: '#ffffff',
};
const EXPAND = 12;
const MAX_NODES = 400;

const shortId = (id) => (id.length > 20 ? `${id.slice(0, 5)}…${id.slice(-3)}` : id);
const nsToMs = (ns) => (ns ? Number(BigInt(ns) / 1000000n) : null);

/// Build the node and adjacency tables once per scan.
function buildGraph(scan, tags, origin) {
    const balances = new Map(holdersByOwner(scan).map((h) => [h.owner, h.balance]));
    const nodes = new Map();
    const node = (id) => { let n = nodes.get(id); if (!n) { n = { id, balance: balances.get(id) || 0n, out: [], in: [], sent: 0n, received: 0n }; nodes.set(id, n); } return n; };
    let minTs = null; let maxTs = null;
    for (const e of scan.edges.values()) {
        const a = node(e.from); const b = node(e.to);
        a.out.push(e); b.in.push(e); a.sent += e.amount; b.received += e.amount;
        const f = nsToMs(e.firstTs); const l = nsToMs(e.lastTs);
        if (f !== null && (minTs === null || f < minTs)) minTs = f;
        if (l !== null && (maxTs === null || l > maxTs)) maxTs = l;
    }
    const funders = origin?.funders || new Map();
    for (const n of nodes.values()) {
        const tag = tags?.get(n.id) || null;
        n.tag = tag;
        n.kind = n.id === 'mint' ? 'mint' : n.id === 'burn' ? 'burn' : tag?.startsWith('ICPSwap pool') ? 'pool' : tag?.includes('Sneed Lock') ? 'lock' : tag ? 'dao' : origin?.satelliteOf?.has(n.id) ? 'satellite' : (funders.get(n.id)?.count || 0) >= 5 ? 'hub' : origin?.genesisOwners?.has(n.id) ? 'genesis' : 'node';
        n.satellites = funders.get(n.id)?.count || 0;
        n.satelliteOf = origin?.satelliteOf?.get(n.id) || null;
        n.out.sort((x, y) => (x.amount < y.amount ? 1 : -1));
        n.in.sort((x, y) => (x.amount < y.amount ? 1 : -1));
    }
    return { nodes, minTs, maxTs };
}

function MoneyGraph({ scan, tags, origin, token, start, theme }) {
    const navigate = useNavigate();
    const { principalNames, principalNicknames, verifiedNames, principalCanisterTypes } = useNaming();
    const graph = useMemo(() => buildGraph(scan, tags, origin), [scan, tags, origin]);
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const pos = useRef(new Map()); // id -> { x, y, vx, vy, fixed }
    const view = useRef({ x: 0, y: 0, k: 1 });
    const alpha = useRef(1);
    const [visible, setVisible] = useState(() => new Set());
    const [focus, setFocus] = useState(start || null);
    const [hover, setHover] = useState(null);
    const [collapseSatellites, setCollapseSatellites] = useState(true);
    const [until, setUntil] = useState(null); // ms; edges first seen after this are hidden
    const [startText, setStartText] = useState(start || '');
    const drag = useRef(null);

    const label = useCallback((id) => {
        if (id === 'mint') return 'Minting';
        if (id === 'burn') return 'Burned';
        const n = graph.nodes.get(id);
        const info = getPrincipalDisplayInfoFromContext(id, principalNames, principalNicknames, verifiedNames, principalCanisterTypes);
        return info.nickname || info.name || (n?.tag ? n.tag.replace(/^ICPSwap pool .*/, 'ICPSwap pool') : null) || shortId(id);
    }, [graph, principalNames, principalNicknames, verifiedNames, principalCanisterTypes]);

    const fmt = useCallback((amt) => `${(Number(amt) / 10 ** (token?.decimals ?? 8)).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${token?.symbol || ''}`, [token]);
    const share = useCallback((amt) => (scan.netSupply && scan.netSupply > 0n ? `${(Number((amt * 10000n) / scan.netSupply) / 100).toFixed(2)}%` : ''), [scan]);

    const candidates = useMemo(() => {
        const holders = [...graph.nodes.values()].filter((n) => !['mint', 'burn'].includes(n.id)).sort((a, b) => (a.balance < b.balance ? 1 : -1));
        const hubs = [...graph.nodes.values()].filter((n) => n.satellites > 0).sort((a, b) => b.satellites - a.satellites);
        return { holders: holders.slice(0, 15), hubs: hubs.slice(0, 10) };
    }, [graph]);

    /// Edges of a node, honouring the time filter and satellite folding.
    const neighbours = useCallback((id) => {
        const n = graph.nodes.get(id); if (!n) return [];
        const ok = (e) => (until === null || (nsToMs(e.firstTs) ?? 0) <= until) && !(collapseSatellites && (graph.nodes.get(e.to)?.satelliteOf === id || graph.nodes.get(e.from)?.satelliteOf === id));
        const seen = new Set(); const out = [];
        for (const e of [...n.out, ...n.in].sort((x, y) => (x.amount < y.amount ? 1 : -1))) { if (!ok(e)) continue; const other = e.from === id ? e.to : e.from; if (seen.has(other) || other === id) continue; seen.add(other); out.push(other); }
        return out;
    }, [graph, until, collapseSatellites]);

    const place = useCallback((id, near) => {
        if (pos.current.has(id)) return;
        const p = near && pos.current.get(near);
        const a = Math.random() * Math.PI * 2; const r = 60 + Math.random() * 60;
        pos.current.set(id, { x: (p ? p.x : 0) + Math.cos(a) * r, y: (p ? p.y : 0) + Math.sin(a) * r, vx: 0, vy: 0, fixed: false });
    }, []);

    const expand = useCallback((id, limit = EXPAND) => {
        setVisible((prev) => {
            const next = new Set(prev); next.add(id); place(id, null);
            let added = 0;
            for (const other of neighbours(id)) { if (next.size >= MAX_NODES) break; if (!next.has(other)) { next.add(other); place(other, id); added += 1; if (added >= limit) break; } }
            alpha.current = 1;
            return next;
        });
    }, [neighbours, place]);

    const collapse = useCallback((id) => {
        setVisible((prev) => { const next = new Set(prev); for (const other of neighbours(id)) if (other !== focus) next.delete(other); alpha.current = 1; return next; });
    }, [neighbours, focus]);

    const restart = useCallback((id) => {
        if (!id || !graph.nodes.has(id)) return;
        pos.current = new Map(); view.current = { x: 0, y: 0, k: 1 };
        setVisible(new Set()); setFocus(id); setStartText(id);
        setTimeout(() => expand(id, EXPAND), 0);
    }, [graph, expand]);

    useEffect(() => { if (focus && visible.size === 0) expand(focus, EXPAND); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [focus]);
    useEffect(() => { if (start && start !== focus) restart(start); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [start]);

    // ---- simulation and drawing ----
    useEffect(() => {
        const canvas = canvasRef.current; if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');
        let raf = 0;
        const visibleEdges = () => {
            const out = [];
            for (const id of visible) { const n = graph.nodes.get(id); if (!n) continue; for (const e of n.out) if (visible.has(e.to) && (until === null || (nsToMs(e.firstTs) ?? 0) <= until)) out.push(e); }
            return out;
        };
        const radius = (n) => { const b = Number(n.balance); return b > 0 && scan.netSupply > 0n ? 6 + Math.min(26, Math.log10(1 + (b / Number(scan.netSupply)) * 1e4) * 6) : 6; };
        const tick = () => {
            const ids = [...visible]; const P = pos.current; const a = alpha.current;
            if (a > 0.005) {
                for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
                    const p = P.get(ids[i]); const q = P.get(ids[j]); if (!p || !q) continue;
                    let dx = q.x - p.x; let dy = q.y - p.y; let d2 = dx * dx + dy * dy; if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
                    const f = (1800 * a) / d2; const d = Math.sqrt(d2); dx /= d; dy /= d;
                    if (!p.fixed) { p.vx -= dx * f; p.vy -= dy * f; } if (!q.fixed) { q.vx += dx * f; q.vy += dy * f; }
                }
                for (const e of visibleEdges()) {
                    const p = P.get(e.from); const q = P.get(e.to); if (!p || !q) continue;
                    const dx = q.x - p.x; const dy = q.y - p.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 110) * 0.02 * a;
                    if (!p.fixed) { p.vx += (dx / d) * f; p.vy += (dy / d) * f; } if (!q.fixed) { q.vx -= (dx / d) * f; q.vy -= (dy / d) * f; }
                }
                for (const id of ids) { const p = P.get(id); if (!p || p.fixed) continue; p.vx -= p.x * 0.002 * a; p.vy -= p.y * 0.002 * a; p.vx *= 0.85; p.vy *= 0.85; p.x += p.vx; p.y += p.vy; }
                alpha.current = a * 0.97;
            }
            draw();
            raf = requestAnimationFrame(tick);
        };
        const draw = () => {
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.clientWidth; const h = canvas.clientHeight;
            if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = theme.colors.primaryBg; ctx.fillRect(0, 0, w, h);
            const v = view.current; ctx.save(); ctx.translate(w / 2 + v.x, h / 2 + v.y); ctx.scale(v.k, v.k);
            const P = pos.current;
            const edges = visibleEdges();
            const maxAmt = edges.reduce((m, e) => (e.amount > m ? e.amount : m), 1n);
            for (const e of edges) {
                const p = P.get(e.from); const q = P.get(e.to); if (!p || !q) continue;
                const nq = graph.nodes.get(e.to); const rq = nq ? radius(nq) : 6;
                const dx = q.x - p.x; const dy = q.y - p.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const ux = dx / d; const uy = dy / d;
                const ex = q.x - ux * (rq + 3); const ey = q.y - uy * (rq + 3);
                const wgt = 0.6 + 4 * Math.sqrt(Number(e.amount) / Number(maxAmt));
                const hl = hover && (hover === e.from || hover === e.to);
                ctx.strokeStyle = hl ? '#f8fafc' : 'rgba(148,163,184,0.45)'; ctx.lineWidth = wgt / v.k;
                ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
                ctx.fillStyle = hl ? '#f8fafc' : 'rgba(148,163,184,0.8)';
                const ah = (6 + wgt) / v.k;
                ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - ux * ah - uy * ah * 0.5, ey - uy * ah + ux * ah * 0.5); ctx.lineTo(ex - ux * ah + uy * ah * 0.5, ey - uy * ah - ux * ah * 0.5); ctx.closePath(); ctx.fill();
            }
            ctx.font = `${12 / v.k}px system-ui, sans-serif`; ctx.textAlign = 'center';
            for (const id of visible) {
                const n = graph.nodes.get(id); const p = P.get(id); if (!n || !p) continue;
                const r = radius(n); const color = COLORS[n.kind] || COLORS.node;
                ctx.beginPath();
                if (n.kind === 'pool') ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
                else if (n.kind === 'mint' || n.kind === 'burn') { ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); }
                else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fillStyle = color; ctx.globalAlpha = n.kind === 'satellite' ? 0.6 : 0.9; ctx.fill(); ctx.globalAlpha = 1;
                if (id === focus || id === hover) { ctx.lineWidth = 3 / v.k; ctx.strokeStyle = COLORS.start; ctx.stroke(); }
                if (n.kind === 'hub') { ctx.lineWidth = 2 / v.k; ctx.strokeStyle = COLORS.hub; ctx.beginPath(); ctx.arc(p.x, p.y, r + 4 / v.k, 0, Math.PI * 2); ctx.stroke(); }
                ctx.fillStyle = theme.colors.primaryText;
                ctx.fillText(label(id), p.x, p.y + r + 13 / v.k);
                if (collapseSatellites && n.satellites > 0) { ctx.fillStyle = COLORS.satellite; ctx.fillText(`+${n.satellites} satellite${n.satellites > 1 ? 's' : ''}`, p.x, p.y + r + 26 / v.k); }
            }
            ctx.restore();
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [visible, graph, hover, focus, until, collapseSatellites, label, theme, scan]);

    // ---- interaction ----
    const toWorld = (ev) => { const r = canvasRef.current.getBoundingClientRect(); const v = view.current; return { x: (ev.clientX - r.left - r.width / 2 - v.x) / v.k, y: (ev.clientY - r.top - r.height / 2 - v.y) / v.k }; };
    const hit = (pt) => { let best = null; let bd = 1e9; for (const id of visible) { const p = pos.current.get(id); if (!p) continue; const d = Math.hypot(p.x - pt.x, p.y - pt.y); if (d < 22 / view.current.k && d < bd) { bd = d; best = id; } } return best; };
    const onDown = (ev) => { const pt = toWorld(ev); const id = hit(pt); drag.current = id ? { id, moved: false } : { pan: true, x: ev.clientX, y: ev.clientY, vx: view.current.x, vy: view.current.y, moved: false }; if (id) { const p = pos.current.get(id); p.fixed = true; } };
    const onMove = (ev) => {
        const d = drag.current;
        if (d?.id) { const pt = toWorld(ev); const p = pos.current.get(d.id); p.x = pt.x; p.y = pt.y; d.moved = true; alpha.current = Math.max(alpha.current, 0.3); return; }
        if (d?.pan) { view.current.x = d.vx + (ev.clientX - d.x); view.current.y = d.vy + (ev.clientY - d.y); d.moved = true; return; }
        setHover(hit(toWorld(ev)));
    };
    const onUp = (ev) => {
        const d = drag.current; drag.current = null;
        if (d?.id) { const p = pos.current.get(d.id); if (p) p.fixed = false; if (!d.moved) { if (ev.shiftKey) collapse(d.id); else { setFocus(d.id); expand(d.id); } } }
    };
    const onWheel = (ev) => { ev.preventDefault(); const v = view.current; const k = Math.min(4, Math.max(0.2, v.k * (ev.deltaY < 0 ? 1.1 : 0.9))); v.k = k; };
    const onDouble = (ev) => { const id = hit(toWorld(ev)); if (id && !['mint', 'burn'].includes(id)) navigate(`/principal/${id}`); };

    const hoverNode = hover ? graph.nodes.get(hover) : null;
    const btn = (active) => ({ padding: '6px 10px', borderRadius: 8, border: `1px solid ${active ? '#10b981' : theme.colors.border}`, background: active ? '#10b98122' : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.8rem' });
    const legend = [['node', 'holder'], ['pool', 'DEX pool'], ['lock', 'Sneed Lock'], ['dao', 'DAO / treasury / minting account'], ['mint', 'minted'], ['burn', 'burned'], ['hub', 'funded 5+ dormant accounts'], ['satellite', 'satellite (one funder, never sent)'], ['genesis', 'genesis account (balance outside the log)']];

    return (
        <div ref={wrapRef} style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 14, background: theme.colors.cardBg, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 10, borderBottom: `1px solid ${theme.colors.border}` }}>
                <form onSubmit={(e) => { e.preventDefault(); restart(startText.trim()); }} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={startText} onChange={(e) => setStartText(e.target.value)} placeholder="Start at a principal" className="health-mono" style={{ width: 300, padding: '6px 8px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.8rem' }} />
                    <button type="submit" style={btn(false)}>Go</button>
                </form>
                <select value="" onChange={(e) => { if (e.target.value) restart(e.target.value); }} style={{ ...btn(false), maxWidth: 260 }}>
                    <option value="">Start from…</option>
                    <option value="mint">Minting</option>
                    {candidates.hubs.length > 0 && <optgroup label="Funders of dormant accounts">{candidates.hubs.map((n) => <option key={n.id} value={n.id}>{label(n.id)} (+{n.satellites})</option>)}</optgroup>}
                    <optgroup label="Largest holders">{candidates.holders.map((n) => <option key={n.id} value={n.id}>{label(n.id)} {share(n.balance)}</option>)}</optgroup>
                </select>
                <button type="button" style={btn(collapseSatellites)} onClick={() => { setCollapseSatellites((v) => !v); alpha.current = 1; }}>Fold satellites</button>
                {graph.minTs !== null && graph.maxTs !== null && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: theme.colors.secondaryText }}>
                        until <input type="range" min={graph.minTs} max={graph.maxTs} step={3600000} value={until ?? graph.maxTs} onChange={(e) => { setUntil(Number(e.target.value) >= graph.maxTs ? null : Number(e.target.value)); alpha.current = 1; }} />
                        <span className="health-mono">{new Date(until ?? graph.maxTs).toISOString().slice(0, 10)}</span>
                    </label>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: theme.colors.mutedText }}>{visible.size} of {graph.nodes.size.toLocaleString('en-US')} principals, {scan.edges.size.toLocaleString('en-US')} edges. Click expands, shift-click folds, double-click opens, drag moves, wheel zooms.</span>
            </div>
            <div style={{ position: 'relative' }}>
                <canvas ref={canvasRef} style={{ width: '100%', height: 560, display: 'block', cursor: hover ? 'pointer' : 'grab' }}
                    onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => { drag.current = null; setHover(null); }} onWheel={onWheel} onDoubleClick={onDouble} />
                {hoverNode && (
                    <div className="health-mono" style={{ position: 'absolute', left: 12, top: 12, maxWidth: 420, padding: '8px 10px', borderRadius: 10, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, fontSize: '0.75rem', pointerEvents: 'none', lineHeight: 1.5 }}>
                        <div style={{ fontWeight: 700 }}>{label(hover)}</div>
                        {!['mint', 'burn'].includes(hover) && <div style={{ color: theme.colors.mutedText }}>{hover}</div>}
                        {hoverNode.tag && <div>{hoverNode.tag}</div>}
                        <div>balance {fmt(hoverNode.balance)} {share(hoverNode.balance)}</div>
                        <div>received {fmt(hoverNode.received)} from {hoverNode.in.length} · sent {fmt(hoverNode.sent)} to {hoverNode.out.length}</div>
                        {hoverNode.satellites > 0 && <div style={{ color: COLORS.hub }}>funded {hoverNode.satellites} dormant single-source account(s)</div>}
                        {hoverNode.satelliteOf && <div style={{ color: COLORS.satellite }}>satellite of {label(hoverNode.satelliteOf)}</div>}
                    </div>
                )}
                <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px', borderRadius: 10, background: `${theme.colors.secondaryBg}dd`, border: `1px solid ${theme.colors.border}`, fontSize: '0.72rem', color: theme.colors.secondaryText, pointerEvents: 'none' }}>
                    {legend.map(([k, t]) => <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: k === 'pool' ? 2 : 5, background: COLORS[k], display: 'inline-block' }} />{t}</div>)}
                </div>
            </div>
        </div>
    );
}

export default MoneyGraph;
