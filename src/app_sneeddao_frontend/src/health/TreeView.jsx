// Shared tree rendering for check pages (/health, token safety): status
// icons and badges, one row per node with details, and the styles.
import React from 'react';
import { Link } from 'react-router-dom';
import { FaCheckCircle, FaExclamationTriangle, FaTimesCircle, FaMinusCircle, FaSpinner, FaChevronRight, FaChevronDown, FaClock, FaExternalLinkAlt } from 'react-icons/fa';
import { statusOf, countLeaves } from './runner.js';

export const primary = '#10b981';

export const STATUS = {
    pass: { label: 'pass', color: '#22c55e', Icon: FaCheckCircle },
    warn: { label: 'warning', color: '#f59e0b', Icon: FaExclamationTriangle },
    fail: { label: 'fail', color: '#ef4444', Icon: FaTimesCircle },
    skip: { label: 'skipped', color: '#94a3b8', Icon: FaMinusCircle },
    pending: { label: 'queued', color: '#94a3b8', Icon: FaClock },
    running: { label: 'running', color: '#3b82f6', Icon: FaSpinner },
};

export const customStyles = `
  @keyframes health-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .health-spin { animation: health-spin 1s linear infinite; }
  .health-row:hover { background: rgba(127,127,127,0.08); }
  .health-details { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.78rem; white-space: pre-wrap; word-break: break-word; }
  .health-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  @media (max-width: 640px) { .health-summary-cell { display: block !important; padding-left: 28px; } }
`;

export function StatusIcon({ status, size = 16 }) {
    const s = STATUS[status] || STATUS.pending;
    const { Icon } = s;
    return <Icon size={size} color={s.color} className={status === 'running' ? 'health-spin' : undefined} style={{ flexShrink: 0 }} />;
}

export function Badge({ status, theme, children }) {
    const s = STATUS[status] || STATUS.pending;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 700, background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}55`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <StatusIcon status={status} size={11} /> {children || s.label}
        </span>
    );
}

export const detailsText = (d) => {
    if (d === undefined || d === null) return '';
    if (typeof d === 'string') return d;
    try { return JSON.stringify(d, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2); } catch { return String(d); }
};

export function ExternalOrInternal({ href, theme }) {
    if (!href) return null;
    const style = { color: primary, fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', whiteSpace: 'nowrap' };
    if (href.startsWith('/')) return <Link to={href} style={style} onClick={(e) => e.stopPropagation()}>open <FaExternalLinkAlt size={9} /></Link>;
    return <a href={href} target="_blank" rel="noopener noreferrer" style={style} onClick={(e) => e.stopPropagation()}>open <FaExternalLinkAlt size={9} /></a>;
}

export function FixLink({ fix, theme }) {
    if (!fix) return null;
    const style = { color: primary, fontSize: '0.75rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 999, border: `1px solid ${primary}66`, background: `${primary}14` };
    return <Link to={fix.href} style={style} onClick={(e) => e.stopPropagation()}>{fix.label}</Link>;
}

export function Node({ node, results, depth, theme, expanded, toggle, onlyProblems, fixFor }) {
    const status = statusOf(node, results);
    const isGroup = !!node.children;
    const open = expanded.has(node.id);
    const result = isGroup ? null : results.get(node.id);
    if (onlyProblems && !['fail', 'warn', 'running', 'pending'].includes(status)) return null;
    const counts = isGroup ? countLeaves(node, results) : null;
    return (
        <div>
            <div
                className="health-row"
                onClick={() => toggle(node.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', paddingLeft: 10 + depth * 18, cursor: 'pointer', borderBottom: `1px solid ${theme.colors.border}`, borderLeft: `3px solid ${(STATUS[status] || STATUS.pending).color}` }}
            >
                <span style={{ width: 12, color: theme.colors.mutedText, display: 'inline-flex' }}>{isGroup || result?.details ? (open ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />) : null}</span>
                <StatusIcon status={status} />
                <span style={{ fontWeight: isGroup ? 700 : 500, color: theme.colors.primaryText, fontSize: isGroup ? '0.95rem' : '0.88rem', flex: '0 1 auto' }}>{node.name}</span>
                {isGroup ? (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {node.loading && <Badge status="running" theme={theme}>listing checks…</Badge>}
                        {counts.fail > 0 && <Badge status="fail" theme={theme}>{counts.fail}</Badge>}
                        {counts.warn > 0 && <Badge status="warn" theme={theme}>{counts.warn}</Badge>}
                        {counts.pass > 0 && <Badge status="pass" theme={theme}>{counts.pass}</Badge>}
                        {counts.skip > 0 && <Badge status="skip" theme={theme}>{counts.skip}</Badge>}
                        {(counts.running > 0 || counts.pending > 0) && <Badge status="running" theme={theme}>{counts.running + counts.pending}</Badge>}
                    </span>
                ) : (
                    <span className="health-summary-cell" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, color: theme.colors.secondaryText, fontSize: '0.82rem', textAlign: 'right', minWidth: 0 }}>
                        <span style={{ wordBreak: 'break-word' }}>{result?.summary || ''}</span>
                        {fixFor && ['fail', 'warn'].includes(status) && <FixLink fix={fixFor(node.id)} theme={theme} />}
                        {result?.ms !== undefined && <span style={{ color: theme.colors.mutedText, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{result.ms} ms</span>}
                        <ExternalOrInternal href={result?.link || node.link} theme={theme} />
                    </span>
                )}
            </div>
            {open && isGroup && node.children.map((ch) => (
                <Node key={ch.id} node={ch} results={results} depth={depth + 1} theme={theme} expanded={expanded} toggle={toggle} onlyProblems={onlyProblems} fixFor={fixFor} />
            ))}
            {open && !isGroup && result?.details && (
                <div className="health-details" style={{ padding: '8px 14px 10px', paddingLeft: 40 + depth * 18, background: theme.colors.secondaryBg, color: theme.colors.secondaryText, borderBottom: `1px solid ${theme.colors.border}` }}>
                    {detailsText(result.details)}
                </div>
            )}
        </div>
    );
}

