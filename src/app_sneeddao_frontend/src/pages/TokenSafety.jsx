// The studio's Check panel: rates any ICRC ledger from public, verifiable
// data. Gates first (controllers, code), then minting, distribution, locks,
// liquidity and cycles, as a tree of checks like /health, with a fix button
// on every line the studio has an answer for. The old /tools/token_safety
// route redirects into the studio.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { FaSpinner, FaRedo, FaCog, FaExclamationTriangle, FaProjectDiagram } from 'react-icons/fa';
import { buildTokenTree, rateTree, fetchTokenHeader } from '../tokensafety/checks.js';
import { runTree, statusOf, countLeaves, isListing } from '../health/runner.js';
import { loadConfig, saveConfig, DEFAULT_CONFIG, CONFIG_FIELDS } from '../tokensafety/config.js';
import { STATUS, Badge, Node, primary } from '../health/TreeView.jsx';
import MoneyGraph from '../tokensafety/MoneyGraph.jsx';
import { scanSource } from '../tokensafety/sources.js';
import { fixFor } from '../tokensafety/fixes.js';
import VerifyRecompressed from '../tokensafety/VerifyRecompressed.jsx';

function ConfigPanel({ config, setConfig, theme, onClose }) {
    const [draft, setDraft] = useState(config);
    const input = { width: 120, padding: '6px 8px', borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.85rem' };
    return (
        <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: '1rem', background: theme.colors.cardBg, marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: theme.colors.primaryText }}>Thresholds</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px 18px' }}>
                {CONFIG_FIELDS.map(([key, label, help]) => (
                    <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: theme.colors.secondaryText }}>
                        <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>{label}</span>
                        <input type="number" step="any" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} style={input} />
                        {help && <span style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>{help}</span>}
                    </label>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => { setConfig(draft); saveConfig(draft); onClose(); }} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: primary, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save and re-run</button>
                <button type="button" onClick={() => setDraft({ ...DEFAULT_CONFIG })} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.primaryText, cursor: 'pointer' }}>Defaults</button>
                <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.secondaryText, cursor: 'pointer' }}>Cancel</button>
            </div>
            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginTop: 8 }}>Saved in this browser only.</div>
        </div>
    );
}

// Finished reports survive navigating away and back (the scan of a big log
// takes a while): one entry per ledger and threshold set, for this tab's life.
const REPORT_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const reportCache = new Map(); // key -> { state, header, graphData, startedAt, finishedAt, expanded }
const cacheKey = (ledgerId, cfg) => `${ledgerId}|${JSON.stringify(Object.fromEntries(Object.entries(cfg).filter(([, v]) => typeof v !== 'function')))}`;

/// Rates `ledgerId`; `onHeader` and `onRating` let the studio show the token and its grade in its own header.
export function CheckPanel({ ledgerId, onHeader, onRating, indexOverride = null }) {
    const { theme } = useTheme();
    const [baseConfig, setConfig] = useState(loadConfig);
    const config = useMemo(() => (indexOverride ? { ...baseConfig, indexOverride } : baseConfig), [baseConfig, indexOverride]);
    const cached = ledgerId ? reportCache.get(cacheKey(ledgerId, config)) : null;
    const fresh = cached && Date.now() - cached.finishedAt < REPORT_CACHE_MAX_AGE_MS ? cached : null;
    const [state, setState] = useState(fresh ? fresh.state : { tree: null, results: new Map() });
    const [running, setRunning] = useState(false);
    const [startedAt, setStartedAt] = useState(fresh ? fresh.startedAt : null);
    const [finishedAt, setFinishedAt] = useState(fresh ? fresh.finishedAt : null);
    const [progress, setProgress] = useState(null);
    const [expanded, setExpanded] = useState(() => (fresh ? fresh.expanded : new Set(['token', 'gates'])));
    const [onlyProblems, setOnlyProblems] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [error, setError] = useState(null);
    const [header, setHeader] = useState(fresh ? fresh.header : null);
    const [graphData, setGraphData] = useState(fresh ? fresh.graphData : null); // { scan, meta, tags, origin } once the log is scanned
    const [showGraph, setShowGraph] = useState(false);
    const [fromCache, setFromCache] = useState(!!fresh);
    const runId = useRef(0);
    const expandedRef = useRef(expanded); expandedRef.current = expanded;

    const run = useCallback(async (id, cfg) => {
        if (!id) return;
        const me = ++runId.current;
        setFromCache(false);
        const started = Date.now();
        setRunning(true); setStartedAt(started); setFinishedAt(null); setProgress(null); setError(null);
        setState({ tree: null, results: new Map() });
        setHeader(null); setGraphData(null); setShowGraph(false);
        const collected = {};
        const cfgWithProgress = {
            ...cfg,
            onProgress: (done, total) => { if (runId.current === me) setProgress({ done, total }); },
            onScan: (scan, meta) => { if (runId.current !== me || scan.skipped) return; collected.scan = scan; collected.meta = meta; setGraphData({ ...collected }); },
            onTags: (tags) => { if (runId.current !== me) return; collected.tags = tags; if (collected.scan) setGraphData({ ...collected }); },
            onOrigin: (origin) => { if (runId.current !== me) return; collected.origin = origin; if (collected.scan) setGraphData({ ...collected }); },
        };
        try {
            const info = await fetchTokenHeader(id);
            if (runId.current !== me) return;
            setHeader(info);
            const final = await runTree(buildTokenTree(id, cfgWithProgress, info), cfgWithProgress, (u) => { if (runId.current === me) setState(u); });
            if (runId.current === me) {
                setState(final);
                reportCache.set(cacheKey(id, cfg), { state: final, header: info, graphData: collected.scan ? { ...collected } : null, startedAt: started, finishedAt: Date.now(), expanded: expandedRef.current });
            }
        } catch (e) {
            if (runId.current === me) setError(e?.message || String(e));
        } finally {
            if (runId.current === me) { setRunning(false); setFinishedAt(Date.now()); }
        }
    }, []);

    useEffect(() => {
        if (!ledgerId) return;
        const c = reportCache.get(cacheKey(ledgerId, config));
        if (c && Date.now() - c.finishedAt < REPORT_CACHE_MAX_AGE_MS) {
            setState(c.state); setHeader(c.header); setGraphData(c.graphData); setStartedAt(c.startedAt); setFinishedAt(c.finishedAt); setFromCache(true); setRunning(false); setError(null);
            return;
        }
        run(ledgerId, config);
        /* eslint-disable-next-line react-hooks/exhaustive-deps */
    }, [ledgerId, config]);
    // keep the cached entry's expansion in step with the user's
    useEffect(() => { if (!ledgerId) return; const c = reportCache.get(cacheKey(ledgerId, config)); if (c) c.expanded = expanded; }, [expanded, ledgerId, config]);

    const graphSource = useMemo(() => (graphData ? scanSource(graphData.scan, graphData.tags, graphData.origin, { symbol: header?.symbol || graphData.meta?.symbol, decimals: header?.decimals ?? graphData.meta?.decimals ?? 8 }) : null), [graphData, header]);
    const toggle = useCallback((id) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
    const fixes = useCallback((leafId) => fixFor(leafId, ledgerId), [ledgerId]);
    // code checks that did not pass carry `verify`: offer to check a recompressed build
    const extras = useCallback((node, result) => (result?.verify ? <VerifyRecompressed key={result.verify.moduleHash} moduleHash={result.verify.moduleHash} kind={result.verify.kind} theme={theme} /> : null), [theme]);
    const counts = state.tree ? countLeaves(state.tree, state.results) : null;
    const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
    const done = counts ? total - counts.pending - counts.running : 0;
    const rating = state.tree ? rateTree(state.tree, (n) => statusOf(n, state.results)) : null;
    const overall = state.tree ? statusOf(state.tree, state.results) : 'pending';

    useEffect(() => { onHeader?.(header); }, [header, onHeader]);
    useEffect(() => { onRating?.(rating, running); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rating?.label, rating?.color, running]);

    const expandAll = (problemsOnly) => {
        if (!state.tree) return;
        const ids = new Set();
        const walk = (n) => { const s = statusOf(n, state.results); if (n.children) { if (!problemsOnly || ['fail', 'warn'].includes(s)) { ids.add(n.id); n.children.forEach(walk); } } else if (problemsOnly && ['fail', 'warn'].includes(s) && state.results.get(n.id)?.details) ids.add(n.id); };
        walk(state.tree);
        setExpanded(ids);
    };
    const btn = (active) => ({ padding: '8px 12px', borderRadius: 8, border: `1px solid ${active ? primary : theme.colors.border}`, background: active ? `${primary}22` : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 });

    if (!ledgerId) return null;
    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: '1rem' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: rating?.color || theme.colors.primaryText }}>{rating ? rating.label : running ? 'Preparing…' : ''}</div>
                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.88rem' }}>{rating?.note}</div>
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: 4 }}>
                        {running ? (total === 0 ? 'Listing checks…' : `Running ${done} of ${total} checks${state.tree && isListing(state.tree) ? ', listing more' : ''}…`) : finishedAt ? `${total} checks, finished ${new Date(finishedAt).toLocaleTimeString()} in ${((finishedAt - startedAt) / 1000).toFixed(1)} s${fromCache ? ' (kept from your last visit; run again for fresh data)' : ''}` : ''}
                        {running && progress && progress.total > 0 && <span> Scanning the block log: {progress.done.toLocaleString('en-US')} of {progress.total.toLocaleString('en-US')} blocks.</span>}
                    </div>
                </div>
                <Badge status={overall} theme={theme}>{(STATUS[overall] || STATUS.pending).label}</Badge>
            </div>

            {error && <div style={{ marginBottom: 10, color: '#ef4444', fontSize: '0.88rem' }}>{error}</div>}

            {counts && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <Badge status="pass" theme={theme}>{counts.pass} passed</Badge>
                    <Badge status="warn" theme={theme}>{counts.warn} warnings</Badge>
                    <Badge status="fail" theme={theme}>{counts.fail} failed</Badge>
                    {counts.skip > 0 && <Badge status="skip" theme={theme}>{counts.skip} skipped</Badge>}
                    {(counts.running + counts.pending) > 0 && <Badge status="running" theme={theme}>{counts.running + counts.pending} pending</Badge>}
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
                <button type="button" style={btn(false)} onClick={() => run(ledgerId, config)} disabled={running}><FaRedo size={11} className={running ? 'health-spin' : undefined} /> Run again</button>
                <button type="button" style={btn(onlyProblems)} onClick={() => setOnlyProblems((v) => !v)}><FaExclamationTriangle size={11} /> Problems only</button>
                <button type="button" style={btn(false)} onClick={() => expandAll(false)}>Expand all</button>
                <button type="button" style={btn(false)} onClick={() => expandAll(true)}>Expand problems</button>
                <button type="button" style={btn(false)} onClick={() => setExpanded(new Set(['token', 'gates']))}>Collapse</button>
                <button type="button" style={btn(showConfig)} onClick={() => setShowConfig((v) => !v)}><FaCog size={11} /> Thresholds</button>
                {graphData && <button type="button" style={btn(showGraph)} onClick={() => setShowGraph((v) => !v)}><FaProjectDiagram size={11} /> Follow the money</button>}
            </div>

            {showGraph && graphData && (
                <div style={{ marginBottom: '1rem' }}>
                    <MoneyGraph source={graphSource} start={null} theme={theme} />
                </div>
            )}

            {showConfig && <ConfigPanel config={config} setConfig={setConfig} theme={theme} onClose={() => setShowConfig(false)} />}

            <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 14, overflow: 'hidden', background: theme.colors.cardBg }}>
                {state.tree ? (
                    <Node node={state.tree} results={state.results} depth={0} theme={theme} expanded={expanded} toggle={toggle} onlyProblems={onlyProblems} fixFor={fixes} extraFor={extras} />
                ) : (
                    <div style={{ padding: '2rem', textAlign: 'center', color: theme.colors.mutedText }}><FaSpinner className="health-spin" /> Preparing checks…</div>
                )}
            </div>

            <div style={{ color: theme.colors.mutedText, fontSize: '0.78rem', marginTop: 12, lineHeight: 1.6 }}>
                The two gates come first: controllers and module hashes are read through the IC's public state, and hashes are compared with every ledger-suite version the NNS has approved and every official DFINITY ledger suite release. When a gate fails, nothing the ledger reports can be trusted, so the rating is "Unverifiable" whatever the other checks say. Holders are rebuilt from the ledger's own block log in your browser. Locks and locked liquidity come from Sneed Lock, pools from ICPSwap, and cycles from the blackhole canister, the SNS root or NNS root where they are observable. A button on a line opens the studio action that answers it.
            </div>
        </>
    );
}

/// The old address: /tools/token_safety[/:ledgerId] now lives in the studio.
function TokenSafety() {
    const { ledgerId } = useParams();
    return <Navigate to={ledgerId ? `/studio/${ledgerId}` : '/studio'} replace />;
}

export default TokenSafety;
