// "Follow the money": an explorable graph of who sent a token to whom. Nodes
// are principals (subaccounts folded), edges are directed transfers. The
// data comes from a source (sources.js): the full graph of a block scan, or
// a lazy index canister that is queried as nodes are expanded. Start at any
// node, click to expand its counterparties; known canisters are marked, and
// where the source knows them the sleuthing results (satellites, hubs) are
// overlaid. Names and nicknames come from the Sneed naming context.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNaming } from '../NamingContext';
import { getPrincipalDisplayInfoFromContext, getPrincipalProfileUrl } from '../utils/PrincipalUtils';
import PrincipalInput from '../components/PrincipalInput';
import { nsToMs } from './sources.js';

const COLORS = {
    node: '#22d3ee', pool: '#3b82f6', lock: '#f59e0b', dao: '#22c55e', mint: '#a78bfa', burn: '#64748b', hub: '#ef4444', satellite: '#94a3b8', genesis: '#f472b6', start: '#ffffff',
};
const EXPAND = 12;
const MAX_NODES = 400;
const shortId = (id) => (id.length > 20 ? `${id.slice(0, 5)}…${id.slice(-3)}` : id);

function MoneyGraph({ source, start, theme }) {
    const navigate = useNavigate();
    const { principalNames, principalNicknames, verifiedNames, principalCanisterTypes } = useNaming();
    const canvasRef = useRef(null);
    const pos = useRef(new Map()); // id -> { x, y, vx, vy, fixed }
    const view = useRef({ x: 0, y: 0, k: 1 });
    const alpha = useRef(1);
    const edgesOf = useRef(new Map()); // id -> edges touching it (once expanded)
    const [visible, setVisible] = useState(() => new Set());
    const [focus, setFocus] = useState(null);
    const [hover, setHover] = useState(null);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [collapseSatellites, setCollapseSatellites] = useState(true);
    const [until, setUntil] = useState(null);
    const [startText, setStartText] = useState(start || '');
    const [tick, setTick] = useState(0); // bumps when cached data changes
    const drag = useRef(null);
    const token = source.token;

    const label = useCallback((id) => {
        if (id === 'mint') return 'Minting';
        if (id === 'burn') return 'Burned';
        const n = source.getNode(id);
        if (n?.tag === 'minting account') return 'Minting account';
        const info = getPrincipalDisplayInfoFromContext(id, principalNames, principalNicknames, verifiedNames, principalCanisterTypes);
        return info.nickname || info.name || (n?.tag ? n.tag.replace(/^ICPSwap pool .*/, 'ICPSwap pool') : null) || shortId(id);
    }, [source, principalNames, principalNicknames, verifiedNames, principalCanisterTypes]);
    const fmt = useCallback((amt) => (amt === null || amt === undefined ? '?' : `${(Number(amt) / 10 ** (token?.decimals ?? 8)).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${token?.symbol || ''}`), [token]);
    const share = useCallback((amt) => (amt !== null && amt !== undefined && source.totalSupply ? `${(Number((amt * 10000n) / source.totalSupply) / 100).toFixed(2)}%` : ''), [source]);

    const edgeOk = useCallback((e, id) => {
        if (until !== null && (nsToMs(e.firstTs) ?? 0) > until) return false;
        if (collapseSatellites && source.hasOrigin) { const other = e.from === id ? e.to : e.from; if (source.getNode(other)?.satelliteOf === id) return false; }
        return true;
    }, [until, collapseSatellites, source]);

    const neighbours = useCallback((id) => {
        const edges = edgesOf.current.get(id) || [];
        const seen = new Set(); const out = [];
        for (const e of [...edges].sort((x, y) => (x.amount < y.amount ? 1 : -1))) { if (!edgeOk(e, id)) continue; const other = e.from === id ? e.to : e.from; if (other === id || seen.has(other)) continue; seen.add(other); out.push(other); }
        return out;
    }, [edgeOk]);

    const place = useCallback((id, near) => {
        if (pos.current.has(id)) return;
        const p = near && pos.current.get(near);
        const a = Math.random() * Math.PI * 2; const r = 70 + Math.random() * 60;
        pos.current.set(id, { x: (p ? p.x : 0) + Math.cos(a) * r, y: (p ? p.y : 0) + Math.sin(a) * r, vx: 0, vy: 0, fixed: false });
    }, []);

    const expand = useCallback(async (rawId, limit = EXPAND) => {
        const id = source.resolve ? source.resolve(rawId) : rawId;
        setError(null);
        if (!edgesOf.current.has(id)) {
            setBusy(id);
            try { edgesOf.current.set(id, await source.edgesOf(id)); } catch (e) { setError(`Could not read ${label(id)}: ${e?.message || e}`); } finally { setBusy(null); }
            setTick((t) => t + 1);
        }
        setVisible((prev) => {
            const next = new Set(prev); next.add(id); place(id, null);
            let added = 0;
            for (const other of neighbours(id)) { if (next.size >= MAX_NODES) break; if (!next.has(other)) { next.add(other); place(other, id); added += 1; if (added >= limit) break; } }
            alpha.current = 1;
            return next;
        });
        return id;
    }, [source, neighbours, place, label]);

    const collapse = useCallback((id) => {
        setVisible((prev) => { const next = new Set(prev); for (const other of neighbours(id)) if (other !== focus) next.delete(other); alpha.current = 1; return next; });
    }, [neighbours, focus]);

    const restart = useCallback(async (rawId) => {
        if (!rawId) return;
        pos.current = new Map(); view.current = { x: 0, y: 0, k: 1 };
        setVisible(new Set());
        const id = await expand(rawId, EXPAND);
        setFocus(id); setStartText(id);
    }, [expand]);

    useEffect(() => { if (start) restart(start); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [start, source]);

    // ---- simulation and drawing ----
    useEffect(() => {
        const canvas = canvasRef.current; if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');
        let raf = 0;
        const visibleEdges = () => {
            const out = new Map();
            for (const id of visible) for (const e of edgesOf.current.get(id) || []) if (visible.has(e.from) && visible.has(e.to) && edgeOk(e, e.from === id ? id : e.to) && (until === null || (nsToMs(e.firstTs) ?? 0) <= until)) out.set(`${e.from}|${e.to}`, e);
            return [...out.values()];
        };
        const radius = (n) => { const b = n?.balance !== null && n?.balance !== undefined ? Number(n.balance) : 0; return b > 0 && source.totalSupply ? 6 + Math.min(26, Math.log10(1 + (b / Number(source.totalSupply)) * 1e4) * 6) : 6; };
        const step = () => {
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
            raf = requestAnimationFrame(step);
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
                const rq = radius(source.getNode(e.to));
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
                const n = source.getNode(id); const p = P.get(id); if (!p) continue;
                const r = radius(n); const kind = n?.kind || 'node'; const color = COLORS[kind] || COLORS.node;
                ctx.beginPath();
                if (kind === 'pool') ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
                else if (kind === 'mint' || kind === 'burn') { ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); }
                else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fillStyle = color; ctx.globalAlpha = kind === 'satellite' ? 0.6 : 0.9; ctx.fill(); ctx.globalAlpha = 1;
                if (id === focus || id === hover) { ctx.lineWidth = 3 / v.k; ctx.strokeStyle = COLORS.start; ctx.stroke(); }
                if (kind === 'hub') { ctx.lineWidth = 2 / v.k; ctx.strokeStyle = COLORS.hub; ctx.beginPath(); ctx.arc(p.x, p.y, r + 4 / v.k, 0, Math.PI * 2); ctx.stroke(); }
                if (!edgesOf.current.has(id)) { ctx.lineWidth = 1 / v.k; ctx.strokeStyle = 'rgba(148,163,184,0.6)'; ctx.setLineDash([3 / v.k, 3 / v.k]); ctx.beginPath(); ctx.arc(p.x, p.y, r + 3 / v.k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
                ctx.fillStyle = theme.colors.primaryText;
                ctx.fillText(label(id), p.x, p.y + r + 13 / v.k);
                if (collapseSatellites && n?.satellites > 0) { ctx.fillStyle = COLORS.satellite; ctx.fillText(`+${n.satellites} satellite${n.satellites > 1 ? 's' : ''}`, p.x, p.y + r + 26 / v.k); }
            }
            ctx.restore();
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [visible, source, hover, focus, until, collapseSatellites, label, theme, edgeOk, tick]);

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
    const onWheel = (ev) => { ev.preventDefault(); const v = view.current; v.k = Math.min(4, Math.max(0.2, v.k * (ev.deltaY < 0 ? 1.1 : 0.9))); };
    const onDouble = (ev) => { ev.preventDefault(); const id = hit(toWorld(ev)); if (id && !['mint', 'burn'].includes(id)) { drag.current = null; navigate(getPrincipalProfileUrl(id)); } };

    const hoverNode = hover ? source.getNode(hover) : null;
    const btn = (active) => ({ padding: '6px 10px', borderRadius: 8, border: `1px solid ${active ? '#10b981' : theme.colors.border}`, background: active ? '#10b98122' : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.8rem' });
    const selectStyle = { ...btn(false), background: theme.colors.primaryBg, maxWidth: 260 };
    const optStyle = { background: theme.colors.primaryBg, color: theme.colors.primaryText };
    const legend = [['node', 'holder'], ['pool', 'DEX pool'], ['lock', 'Sneed Lock'], ['dao', 'DAO / treasury'], ['mint', 'minting'], ['burn', 'burned'], ...(source.hasOrigin ? [['hub', 'funded 5+ dormant accounts'], ['satellite', 'satellite (one funder, never sent)'], ['genesis', 'genesis account (balance outside the log)']] : [])];
    const c = source.candidates || { holders: [], hubs: [], mint: false };
    const counts = source.nodeCount !== null && source.nodeCount !== undefined ? `${visible.size} of ${source.nodeCount.toLocaleString('en-US')} principals, ${source.edgeCount.toLocaleString('en-US')} edges.` : `${visible.size} principals shown, ${edgesOf.current.size} expanded.`;

    return (
        <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 14, background: theme.colors.cardBg, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 10, borderBottom: `1px solid ${theme.colors.border}` }}>
                <form onSubmit={(e) => { e.preventDefault(); restart(startText.trim()); }} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ width: 320 }}>
                        <PrincipalInput value={startText} onChange={setStartText} onSelect={(id) => restart(id)} placeholder="Start at a principal or name" defaultTab="all" style={{ width: '100%' }} inputStyle={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }} />
                    </div>
                    <button type="submit" style={btn(false)}>Go</button>
                </form>
                {(c.mint || c.hubs.length > 0 || c.holders.length > 0) && (
                    <select value="" onChange={(e) => { if (e.target.value) restart(e.target.value); }} style={selectStyle}>
                        <option value="" style={optStyle}>Start from…</option>
                        {c.mint && <option value="mint" style={optStyle}>Minting</option>}
                        {c.hubs.length > 0 && <optgroup label="Funders of dormant accounts" style={optStyle}>{c.hubs.map((n) => <option key={n.id} value={n.id} style={optStyle}>{label(n.id)} (+{n.satellites})</option>)}</optgroup>}
                        {c.holders.length > 0 && <optgroup label="Largest holders" style={optStyle}>{c.holders.map((n) => <option key={n.id} value={n.id} style={optStyle}>{label(n.id)} {share(n.balance)}</option>)}</optgroup>}
                    </select>
                )}
                {source.hasOrigin && <button type="button" style={btn(collapseSatellites)} onClick={() => { setCollapseSatellites((v) => !v); alpha.current = 1; }}>Fold satellites</button>}
                {source.timeRange && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: theme.colors.secondaryText }}>
                        until <input type="range" min={source.timeRange.minTs} max={source.timeRange.maxTs} step={3600000} value={until ?? source.timeRange.maxTs} onChange={(e) => { setUntil(Number(e.target.value) >= source.timeRange.maxTs ? null : Number(e.target.value)); alpha.current = 1; }} />
                        <span className="health-mono">{new Date(until ?? source.timeRange.maxTs).toISOString().slice(0, 10)}</span>
                    </label>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: theme.colors.mutedText }}>{busy ? `Reading ${label(busy)}… ` : ''}{counts} Click expands, shift-click folds, double-click opens, drag moves, wheel zooms.</span>
            </div>
            {error && <div style={{ padding: '6px 12px', color: '#ef4444', fontSize: '0.8rem' }}>{error}</div>}
            <div style={{ position: 'relative' }}>
                <canvas ref={canvasRef} style={{ width: '100%', height: 560, display: 'block', cursor: hover ? 'pointer' : 'grab' }}
                    onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => { drag.current = null; setHover(null); }} onWheel={onWheel} onDoubleClick={onDouble} />
                {visible.size === 0 && !busy && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.colors.mutedText, pointerEvents: 'none' }}>Pick a principal to start from.</div>}
                {hoverNode && (
                    <div className="health-mono" style={{ position: 'absolute', left: 12, top: 12, maxWidth: 420, padding: '8px 10px', borderRadius: 10, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, color: theme.colors.primaryText, fontSize: '0.75rem', pointerEvents: 'none', lineHeight: 1.5 }}>
                        <div style={{ fontWeight: 700 }}>{label(hover)}</div>
                        {!['mint', 'burn'].includes(hover) && <div style={{ color: theme.colors.mutedText }}>{hover}</div>}
                        {hoverNode.tag && <div>{hoverNode.tag}</div>}
                        <div>balance {fmt(hoverNode.balance)} {share(hoverNode.balance)}</div>
                        {edgesOf.current.has(hover) ? <div>received {fmt(hoverNode.received)} from {hoverNode.inCount} · sent {fmt(hoverNode.sent)} to {hoverNode.outCount}{hoverNode.truncated ? ' (long history, most recent only)' : ''}</div> : <div style={{ color: theme.colors.mutedText }}>not expanded yet, click to read</div>}
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
