// /health: the DAO's diagnostics as a tree of pass/warn/fail checks. Every
// leaf is an independent test against a live canister; a group shows the
// worst status beneath it, so the root goes red when anything does.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { FaHeartbeat, FaExclamationTriangle, FaSpinner, FaRedo, FaCog, FaClock } from 'react-icons/fa';
import { buildTree } from '../health/checks.js';
import { runTree, statusOf, countLeaves, isListing } from '../health/runner.js';
import { loadConfig, saveConfig, DEFAULT_CONFIG, CONFIG_FIELDS } from '../health/config.js';
import { STATUS, customStyles, Badge, Node, primary } from '../health/TreeView.jsx';
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function ConfigPanel({ config, setConfig, theme, onClose }) {
    const [draft, setDraft] = useState(config);
    const input = { width: 110, padding: '6px 8px', borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.85rem' };
    return (
        <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: '1rem', background: theme.colors.cardBg, marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: theme.colors.primaryText }}>Thresholds</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px 18px' }}>
                {CONFIG_FIELDS.map(([key, label, help, type]) => (
                    <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: theme.colors.secondaryText }}>
                        <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>{label}</span>
                        {type === 'bool'
                            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32 }}><input type="checkbox" checked={!!draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} /> {draft[key] ? 'yes' : 'no'}</span>
                            : <input type="number" step="any" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} style={input} />}
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

function Health() {
    const { theme } = useTheme();
    const [config, setConfig] = useState(loadConfig);
    const [state, setState] = useState({ tree: null, results: new Map() });
    const [running, setRunning] = useState(false);
    const [startedAt, setStartedAt] = useState(null);
    const [finishedAt, setFinishedAt] = useState(null);
    const [expanded, setExpanded] = useState(() => new Set(['dao']));
    const [onlyProblems, setOnlyProblems] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const runId = useRef(0);

    const run = useCallback(async (cfg) => {
        const id = ++runId.current;
        setRunning(true);
        setStartedAt(Date.now());
        setFinishedAt(null);
        try {
            const final = await runTree(buildTree(cfg), cfg, (u) => { if (runId.current === id) setState(u); });
            if (runId.current === id) setState(final);
        } finally {
            if (runId.current === id) { setRunning(false); setFinishedAt(Date.now()); }
        }
    }, []);

    useEffect(() => { run(config); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [config]);

    useEffect(() => {
        if (!autoRefresh) return undefined;
        const t = setInterval(() => { if (!running) run(config); }, AUTO_REFRESH_MS);
        return () => clearInterval(t);
    }, [autoRefresh, running, run, config]);

    const toggle = useCallback((id) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

    const overall = state.tree ? statusOf(state.tree, state.results) : 'pending';
    const counts = state.tree ? countLeaves(state.tree, state.results) : null;
    const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
    const done = counts ? total - counts.pending - counts.running : 0;

    const expandAll = (problemsOnly) => {
        if (!state.tree) return;
        const ids = new Set();
        const walk = (n) => { const s = statusOf(n, state.results); if (n.children) { if (!problemsOnly || ['fail', 'warn'].includes(s)) { ids.add(n.id); n.children.forEach(walk); } } else if (problemsOnly && ['fail', 'warn'].includes(s) && state.results.get(n.id)?.details) ids.add(n.id); };
        walk(state.tree);
        setExpanded(ids);
    };

    const btn = (active) => ({ padding: '8px 12px', borderRadius: 8, border: `1px solid ${active ? primary : theme.colors.border}`, background: active ? `${primary}22` : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 });
    const headline = STATUS[overall] || STATUS.pending;

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: `${headline.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FaHeartbeat size={26} color={headline.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: theme.colors.primaryText }}>DAO Health</h1>
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                            {running ? (total === 0 ? 'Listing checks…' : `Running ${done} of ${total} checks${state.tree && isListing(state.tree) ? ', listing more' : ''}…`) : finishedAt ? `${total} checks, finished ${new Date(finishedAt).toLocaleTimeString()} in ${((finishedAt - startedAt) / 1000).toFixed(1)} s` : 'Preparing checks…'}
                        </div>
                    </div>
                    <Badge status={overall} theme={theme}>{overall === 'pass' ? 'all systems go' : overall === 'warn' ? 'needs attention' : overall === 'fail' ? 'problems found' : headline.label}</Badge>
                </div>

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
                    <button type="button" style={btn(false)} onClick={() => run(config)} disabled={running}><FaRedo size={11} className={running ? 'health-spin' : undefined} /> Run again</button>
                    <button type="button" style={btn(autoRefresh)} onClick={() => setAutoRefresh((v) => !v)}><FaClock size={11} /> Auto-refresh every 5 min</button>
                    <button type="button" style={btn(onlyProblems)} onClick={() => setOnlyProblems((v) => !v)}><FaExclamationTriangle size={11} /> Problems only</button>
                    <button type="button" style={btn(false)} onClick={() => expandAll(false)}>Expand all</button>
                    <button type="button" style={btn(false)} onClick={() => expandAll(true)}>Expand problems</button>
                    <button type="button" style={btn(false)} onClick={() => setExpanded(new Set(['dao']))}>Collapse</button>
                    <button type="button" style={btn(showConfig)} onClick={() => setShowConfig((v) => !v)}><FaCog size={11} /> Thresholds</button>
                </div>

                {showConfig && <ConfigPanel config={config} setConfig={setConfig} theme={theme} onClose={() => setShowConfig(false)} />}

                <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 14, overflow: 'hidden', background: theme.colors.cardBg }}>
                    {state.tree ? (
                        <Node node={state.tree} results={state.results} depth={0} theme={theme} expanded={expanded} toggle={toggle} onlyProblems={onlyProblems} />
                    ) : (
                        <div style={{ padding: '2rem', textAlign: 'center', color: theme.colors.mutedText }}><FaSpinner className="health-spin" /> Preparing checks…</div>
                    )}
                </div>

                <div style={{ color: theme.colors.mutedText, fontSize: '0.78rem', marginTop: 12, lineHeight: 1.6 }}>
                    Every check reads live canister state anonymously; nothing here needs a login. A group shows the worst result beneath it. Cycle balances come from the SNS root's canister summary, the revenue loop from the Neutrinite and ICPCoins vectors and the NNS, rewards from the RLL canister, and the activity log from Sneed Lock and its archives.
                </div>
            </main>
        </div>
    );
}

export default Health;
