import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import Header from '../components/Header';
import TokenIcon from '../components/TokenIcon';
import PrincipalInput from '../components/PrincipalInput';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { getPrincipalProfileUrl } from '../utils/PrincipalUtils';
import { fetchOverview, fetchBlocks, verifyTip, hashValue, bytesEqual, toHex, parsePrincipal } from '../utils/icrc3/client';
import {
    kindOf, field, btypeOf, tsOf, bytesOf, asPrincipal, asAccount, guessKind, asTimestampMs,
    formatUnits, formatNat, formatTime, relativeTime, shortHex, fullHex, valueToJson, txEntries,
} from '../utils/icrc3/value';
import { projectionFor, fieldSpec } from '../utils/icrc3/projections';
import {
    FaDatabase, FaSearch, FaSpinner, FaChevronDown, FaChevronUp, FaChevronLeft, FaChevronRight, FaAngleDoubleLeft, FaAngleDoubleRight,
    FaCopy, FaCheck, FaShieldAlt, FaLink, FaExternalLinkAlt, FaCube, FaFilter, FaSortAmountDown, FaSortAmountUp, FaTimes, FaCode, FaExclamationTriangle, FaCheckCircle,
} from 'react-icons/fa';

const primary = '#6366f1';
const secondary = '#818cf8';

const customStyles = `
@keyframes icrc3FadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes icrc3Spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.icrc3-fade-in { animation: icrc3FadeIn 0.35s ease-out forwards; }
.icrc3-spin { animation: icrc3Spin 1s linear infinite; }
.icrc3-block:hover { border-color: ${primary}66 !important; }
.icrc3-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.icrc3-tree { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.8rem; line-height: 1.55; }
`;

const PRESETS = [
    { label: 'Sneed Lock', id: 'pqsms-lqaaa-aaaal-ajjza-cai' },
    { label: 'Sneed Lock (staging)', id: '25fsc-7yaaa-aaaal-qjt5q-cai' },
    { label: 'RLL', id: 'lvc4n-7aaaa-aaaam-adm6a-cai' },
    { label: 'Sneedex', id: '7bvk3-ryaaa-aaaal-qtykq-cai' },
    { label: 'Sneed Premium', id: '7gump-4aaaa-aaaal-qtyka-cai' },
    { label: 'Sneedapp', id: 'sfamc-kyaaa-aaaau-adnpq-cai' },
    { label: 'Sneed forum', id: 'mcigm-4aaaa-aaaad-qhlkq-cai' },
    { label: 'Sneed Hub backend', id: 'g7s5u-tqaaa-aaaad-qhktq-cai' },
    { label: 'Sneed SMS', id: 'zelpl-7yaaa-aaaad-abtcq-cai' },
    { label: 'Sneed Notifications', id: 'vuy7a-iaaaa-aaaay-aaduq-cai' },
    { label: 'SNEED ledger', id: 'hvgxa-wqaaa-aaaaq-aacia-cai' },
    { label: 'ckBTC ledger', id: 'mxzaz-hqaaa-aaaar-qaada-cai' },
    { label: 'ckETH ledger', id: 'ss2fx-dyaaa-aaaar-qacoq-cai' },
    { label: 'ckUSDC ledger', id: 'xevnm-gaaaa-aaaar-qafnq-cai' },
];
const PAGE_SIZES = [10, 25, 50, 100];
const VIEWS = [
    { id: 'specific', label: 'Specific', hint: 'Purpose-built view for block types this app understands' },
    { id: 'compact', label: 'Compact', hint: 'Generic view that guesses what each field means' },
    { id: 'verbose', label: 'Verbose', hint: 'Every field, every byte, nothing interpreted' },
];

// ---------------------------------------------------------------------------
// Token metadata cache (symbol, decimals, logo) for ledger principals
// ---------------------------------------------------------------------------
const tokenMetaCache = new Map();
const tokenMetaPending = new Map();
async function loadTokenMeta(principalText) {
    if (tokenMetaCache.has(principalText)) return tokenMetaCache.get(principalText);
    if (!tokenMetaPending.has(principalText)) {
        tokenMetaPending.set(principalText, (async () => {
            try {
                const actor = createLedgerActor(principalText);
                const md = await actor.icrc1_metadata();
                const get = (k) => { const e = md.find(([key]) => key === k); return e ? Object.values(e[1])[0] : undefined; };
                const meta = { symbol: get('icrc1:symbol') || '', decimals: Number(get('icrc1:decimals') ?? 8), logo: get('icrc1:logo') || '', name: get('icrc1:name') || '' };
                tokenMetaCache.set(principalText, meta);
                return meta;
            } catch {
                const meta = { symbol: '', decimals: 8, logo: '', name: '', failed: true };
                tokenMetaCache.set(principalText, meta);
                return meta;
            }
        })());
    }
    return tokenMetaPending.get(principalText);
}
function useTokenMeta(principals) {
    const [, bump] = useState(0);
    const key = principals.join(',');
    useEffect(() => {
        let alive = true;
        const missing = principals.filter((p) => !tokenMetaCache.has(p));
        if (missing.length === 0) return;
        Promise.all(missing.map(loadTokenMeta)).then(() => { if (alive) bump((n) => n + 1); });
        return () => { alive = false; };
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
    return (p) => tokenMetaCache.get(p);
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------
function CopyButton({ text, theme, size = 10 }) {
    const [copied, setCopied] = useState(false);
    return (
        <button type="button" title="Copy" onClick={async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* ignore */ } }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: copied ? theme.colors.success : theme.colors.mutedText, padding: '0 3px', display: 'inline-flex', alignItems: 'center' }}>
            {copied ? <FaCheck size={size} /> : <FaCopy size={size} />}
        </button>
    );
}

function Pill({ children, color, theme, title }) {
    return (
        <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 12, fontSize: '0.74rem', fontWeight: 600, background: `${color}1f`, color, border: `1px solid ${color}44`, whiteSpace: 'nowrap' }}>
            {children}
        </span>
    );
}

function PrincipalChip({ principal, theme, getName }) {
    const text = typeof principal === 'string' ? principal : principal.toText();
    const names = getName ? getName(text) : null;
    const label = names?.nickname || names?.name;
    const short = text.length > 20 ? `${text.slice(0, 8)}…${text.slice(-5)}` : text;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%' }}>
            <Link to={getPrincipalProfileUrl(text)} className="icrc3-mono" title={text} style={{ color: theme.colors.linkText || primary, textDecoration: 'none', fontSize: '0.82rem' }}>
                {label ? <span style={{ fontFamily: 'inherit', fontWeight: 600 }}>{label} </span> : null}
                <span style={{ opacity: label ? 0.7 : 1 }}>{short}</span>
            </Link>
            <CopyButton text={text} theme={theme} />
        </span>
    );
}

function TokenChip({ principal, meta, theme }) {
    const text = principal.toText();
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <TokenIcon logo={meta?.logo} canisterId={text} size={18} />
            <Link to={getPrincipalProfileUrl(text)} title={`${meta?.name || ''} ${text}`} style={{ color: theme.colors.primaryText, fontWeight: 600, textDecoration: 'none', fontSize: '0.85rem' }}>
                {meta?.symbol || `${text.slice(0, 5)}…`}
            </Link>
            <CopyButton text={text} theme={theme} />
        </span>
    );
}

function AccountChip({ account, theme, getName }) {
    const short = account.text.length > 26 ? `${account.text.slice(0, 10)}…${account.text.slice(-8)}` : account.text;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <PrincipalChip principal={account.owner} theme={theme} getName={getName} />
            {account.subaccount && (
                <span className="icrc3-mono" title={account.text} style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>
                    · sub {shortHex(account.subaccount, 4)} <CopyButton text={account.text} theme={theme} />
                </span>
            )}
            {!account.subaccount && <span style={{ display: 'none' }}>{short}</span>}
        </span>
    );
}

function Amount({ value, meta, theme }) {
    if (meta && meta.symbol) {
        return <span className="icrc3-mono" title={`${formatNat(value)} base units`} style={{ color: theme.colors.primaryText, fontWeight: 600 }}>{formatUnits(value, meta.decimals)} <span style={{ color: theme.colors.secondaryText, fontWeight: 500 }}>{meta.symbol}</span></span>;
    }
    return <span className="icrc3-mono" style={{ color: theme.colors.primaryText }}>{formatNat(value)}</span>;
}

function TimeChip({ ns, theme }) {
    const ms = asTimestampMs(ns);
    if (ms === null) return <span className="icrc3-mono">{formatNat(ns)}</span>;
    return <span title={`${formatNat(ns)} (raw)`} style={{ color: theme.colors.primaryText }}>{formatTime(ms)} <span style={{ color: theme.colors.mutedText, fontSize: '0.78rem' }}>({relativeTime(ms)})</span></span>;
}

// ---------------------------------------------------------------------------
// Field rendering: specific (typed by projection), compact (guessed), verbose (raw)
// ---------------------------------------------------------------------------
function TypedValue({ spec, value, ctx }) {
    const { theme, getName, tokenMeta, canisterId } = ctx;
    const kind = kindOf(value);
    switch (spec.type) {
        case 'principal': case 'pool': {
            const p = asPrincipal(value);
            return p ? <PrincipalChip principal={p} theme={theme} getName={getName} /> : <GuessedValue fieldKey="" value={value} ctx={ctx} />;
        }
        case 'ledger': {
            const p = asPrincipal(value);
            return p ? <TokenChip principal={p} meta={tokenMeta(p.toText())} theme={theme} /> : <GuessedValue fieldKey="" value={value} ctx={ctx} />;
        }
        case 'account': {
            const a = asAccount(value);
            return a ? <AccountChip account={a} theme={theme} getName={getName} /> : <GuessedValue fieldKey="" value={value} ctx={ctx} />;
        }
        case 'amount': {
            if (kind !== 'Nat') return <GuessedValue fieldKey="" value={value} ctx={ctx} />;
            const ledgerText = spec.ledger === 'self' ? canisterId?.toText() : spec.ledger || (spec.token && asPrincipal(ctx.txField(spec.token))?.toText());
            return <Amount value={value.Nat} meta={ledgerText ? tokenMeta(ledgerText) : null} theme={theme} />;
        }
        case 'time': return kind === 'Nat' ? <TimeChip ns={value.Nat} theme={theme} /> : <GuessedValue fieldKey="" value={value} ctx={ctx} />;
        case 'lockId': return kind === 'Nat' ? <Link to={`/lock/${value.Nat}`} style={{ color: primary, fontWeight: 600, textDecoration: 'none' }}>Lock #{value.Nat.toString()} <FaExternalLinkAlt size={9} /></Link> : <GuessedValue fieldKey="" value={value} ctx={ctx} />;
        case 'nat': return kind === 'Nat' || kind === 'Int' ? <span className="icrc3-mono">{formatNat(value[kind])}</span> : <GuessedValue fieldKey="" value={value} ctx={ctx} />;
        case 'text': {
            if (kind === 'Text') return <span>{value.Text}</span>;
            if (kind === 'Nat' || kind === 'Int') return <span className="icrc3-mono">{formatNat(value[kind])}</span>;
            return <GuessedValue fieldKey="" value={value} ctx={ctx} />;
        }
        case 'hash': case 'bytes': {
            const b = bytesOf(value);
            return b ? <span className="icrc3-mono" title={fullHex(b)}>{shortHex(b, 8)} <CopyButton text={fullHex(b)} theme={theme} /></span> : <GuessedValue fieldKey="" value={value} ctx={ctx} />;
        }
        default: return <GuessedValue fieldKey="" value={value} ctx={ctx} />;
    }
}

function GuessedValue({ fieldKey, value, ctx, depth = 0 }) {
    const { theme, getName, tokenMeta, canisterId, ledgerSelf } = ctx;
    const g = guessKind(fieldKey, value);
    switch (g) {
        case 'principal': {
            const p = asPrincipal(value);
            const meta = tokenMeta(p.toText());
            return meta && meta.symbol ? <TokenChip principal={p} meta={meta} theme={theme} /> : <PrincipalChip principal={p} theme={theme} getName={getName} />;
        }
        case 'account': return <AccountChip account={asAccount(value)} theme={theme} getName={getName} />;
        case 'amount': return <Amount value={value.Nat} meta={ledgerSelf ? tokenMeta(canisterId.toText()) : null} theme={theme} />;
        case 'time': return <TimeChip ns={value.Nat} theme={theme} />;
        case 'tag': return <Pill color={primary} theme={theme}>{value.Text}</Pill>;
        case 'text': return <span style={{ wordBreak: 'break-word' }}>{value.Text}</span>;
        case 'nat': case 'int': return <span className="icrc3-mono">{formatNat(value[kindOf(value)])}</span>;
        case 'hash': case 'subaccount': case 'bytes': {
            const b = bytesOf(value);
            return <span className="icrc3-mono" title={fullHex(b)}>{shortHex(b, 8)} <span style={{ color: theme.colors.mutedText, fontSize: '0.72rem' }}>{b.length} B</span> <CopyButton text={fullHex(b)} theme={theme} /></span>;
        }
        case 'map': return <FieldTable entries={value.Map} ctx={ctx} depth={depth + 1} />;
        case 'array': return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {value.Array.map((item, i) => <div key={i} style={{ display: 'flex', gap: 8 }}><span style={{ color: theme.colors.mutedText, fontSize: '0.75rem', minWidth: 18 }}>[{i}]</span><GuessedValue fieldKey={fieldKey} value={item} ctx={ctx} depth={depth + 1} /></div>)}
            </div>
        );
        default: return <span>?</span>;
    }
}

function FieldTable({ entries, ctx, projection = null, depth = 0 }) {
    const { theme } = ctx;
    const known = projection ? entries.filter(([k]) => fieldSpec(projection, k)) : [];
    const rest = projection ? entries.filter(([k]) => !fieldSpec(projection, k)) : entries;
    const rows = [...known, ...rest];
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, max-content) minmax(0, 1fr)', columnGap: 14, rowGap: 6, alignItems: 'baseline', paddingLeft: depth ? 10 : 0, borderLeft: depth ? `2px solid ${theme.colors.border}` : 'none' }}>
            {rows.map(([k, v]) => {
                const spec = fieldSpec(projection, k);
                return (
                    <React.Fragment key={k}>
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }} title={k}>{spec ? spec.label : k}</div>
                        <div style={{ minWidth: 0, fontSize: '0.88rem', color: theme.colors.primaryText, wordBreak: 'break-word' }}>
                            {spec ? <TypedValue spec={spec} value={v} ctx={ctx} /> : <GuessedValue fieldKey={k} value={v} ctx={ctx} depth={depth} />}
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function VerboseNode({ name, value, theme, depth = 0 }) {
    const [open, setOpen] = useState(depth < 2);
    const kind = kindOf(value);
    const label = <span style={{ color: theme.colors.secondaryText }}>{name !== null ? <><span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>{name}</span>: </> : null}</span>;
    const typeTag = <span style={{ color: primary, fontSize: '0.72rem', marginLeft: 6 }}>{kind}</span>;
    const pad = { paddingLeft: depth ? 16 : 0 };
    if (kind === 'Map' || kind === 'Array') {
        const items = kind === 'Map' ? value.Map : value.Array.map((v, i) => [i, v]);
        return (
            <div style={pad}>
                <div onClick={() => setOpen((o) => !o)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    {open ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />} {label}{typeTag} <span style={{ color: theme.colors.mutedText }}>({items.length})</span>
                </div>
                {open && items.map(([k, v]) => <VerboseNode key={String(k)} name={kind === 'Array' ? `[${k}]` : k} value={v} theme={theme} depth={depth + 1} />)}
            </div>
        );
    }
    let text;
    if (kind === 'Nat' || kind === 'Int') text = value[kind].toString();
    else if (kind === 'Text') text = JSON.stringify(value.Text);
    else if (kind === 'Blob') text = `0x${fullHex(value.Blob)}`;
    else text = String(value);
    return (
        <div style={{ ...pad, wordBreak: 'break-all' }}>
            {label}<span style={{ color: theme.colors.primaryText }}>{text}</span>{typeTag}
            {kind === 'Blob' && <span style={{ color: theme.colors.mutedText, fontSize: '0.72rem' }}> {value.Blob.length} B</span>}
            <CopyButton text={kind === 'Blob' ? fullHex(value.Blob) : kind === 'Text' ? value.Text : text} theme={theme} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Block card
// ---------------------------------------------------------------------------
function summaryText(projection, block, ctx) {
    const t = projection?.types?.[btypeOf(block)];
    if (!t) return null;
    const f = (key) => {
        const v = ctx.txField(key);
        if (v === undefined) return undefined;
        const spec = fieldSpec(projection, key);
        const kind = kindOf(v);
        if (spec?.type === 'amount' && kind === 'Nat') {
            const ledgerText = spec.ledger === 'self' ? ctx.canisterId?.toText() : spec.ledger || (spec.token && asPrincipal(ctx.txField(spec.token))?.toText());
            const meta = ledgerText ? ctx.tokenMeta(ledgerText) : null;
            return meta?.symbol ? `${formatUnits(v.Nat, meta.decimals)} ${meta.symbol}` : formatNat(v.Nat);
        }
        if (spec?.type === 'time' && kind === 'Nat') { const ms = asTimestampMs(v.Nat); return ms === null ? formatNat(v.Nat) : formatTime(ms); }
        if (spec?.type === 'account') { const a = asAccount(v); return a ? ctx.nameOf(a.owner.toText()) : '?'; }
        if (['principal', 'pool', 'ledger'].includes(spec?.type)) { const p = asPrincipal(v); if (!p) return '?'; const meta = spec.type === 'ledger' ? ctx.tokenMeta(p.toText()) : null; return meta?.symbol || ctx.nameOf(p.toText()); }
        if (kind === 'Nat' || kind === 'Int') return formatNat(v[kind]);
        if (kind === 'Text') return v.Text;
        if (kind === 'Blob') { const p = asPrincipal(v); return p ? ctx.nameOf(p.toText()) : shortHex(v.Blob, 4); }
        return '…';
    };
    try { return t.title(f); } catch { return null; }
}

function compactSummary(block, ctx) {
    const parts = [];
    for (const [k, v] of txEntries(block)) {
        if (parts.length >= 4) break;
        if (['cid', 'caller'].includes(k)) continue;
        const g = guessKind(k, v);
        let text = null;
        if (g === 'amount') text = formatNat(v.Nat);
        else if (g === 'principal') { const p = asPrincipal(v); const meta = ctx.tokenMeta(p.toText()); text = meta?.symbol || ctx.nameOf(p.toText()); }
        else if (g === 'account') text = ctx.nameOf(asAccount(v).owner.toText());
        else if (g === 'time') text = formatTime(asTimestampMs(v.Nat));
        else if (g === 'text' || g === 'tag') text = v.Text.length > 40 ? v.Text.slice(0, 40) + '…' : v.Text;
        else if (g === 'nat' || g === 'int') text = formatNat(v[kindOf(v)]);
        if (text) parts.push(`${k} ${text}`);
    }
    return parts.join(' · ');
}

function BlockCard({ item, view, ctx, expanded, onToggle, chainState }) {
    const { theme, canisterId } = ctx;
    const { id, block } = item;
    const [raw, setRaw] = useState(false);
    const btype = btypeOf(block);
    const projection = view === 'specific' ? projectionFor(block, canisterId.toText()) : null;
    const typeInfo = projection?.types?.[btype];
    const Icon = typeInfo?.icon || FaCube;
    const color = typeInfo?.color || primary;
    const ts = tsOf(block);
    const tsMs = ts !== null ? asTimestampMs(ts) : null;
    const blockCtx = { ...ctx, txField: (key) => field(field(block, 'tx'), key) };
    const summary = projection ? summaryText(projection, block, blockCtx) : (view === 'compact' ? compactSummary(block, blockCtx) : null);
    const tx = field(block, 'tx');
    const topLevel = block.Map.filter(([k]) => !['btype', 'ts', 'tx', 'phash'].includes(k));
    const phash = field(block, 'phash');
    const chain = chainState?.get(id);

    return (
        <div className="icrc3-block icrc3-fade-in" style={{ background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, borderRadius: 14, boxShadow: theme.colors.cardShadow, overflow: 'hidden', transition: 'border-color 0.2s ease' }}>
            <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: `linear-gradient(135deg, ${color}30, ${color}12)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
                    <Icon size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="icrc3-mono" style={{ color: theme.colors.mutedText, fontSize: '0.78rem' }}>#{id.toString()}</span>
                        <Pill color={color} theme={theme} title={btype || 'no btype'}>{typeInfo?.label || btype || 'block'}</Pill>
                        {tsMs !== null && <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }} title={formatTime(tsMs)}>{relativeTime(tsMs)}</span>}
                        {chain === 'ok' && <Pill color={theme.colors.success} theme={theme} title="phash matches the hash of the previous block"><FaLink size={9} /> linked</Pill>}
                        {chain === 'broken' && <Pill color={theme.colors.error} theme={theme} title="phash does not match the previous block"><FaExclamationTriangle size={9} /> broken link</Pill>}
                        {chain === 'certified' && <Pill color={theme.colors.success} theme={theme} title="hash equals the certified tip"><FaShieldAlt size={9} /> certified tip</Pill>}
                    </div>
                    {summary && <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem', marginTop: 4, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</div>}
                </div>
                <div style={{ color: theme.colors.mutedText, flexShrink: 0 }}>{expanded ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}</div>
            </div>
            {expanded && (
                <div style={{ padding: '4px 14px 14px 64px', borderTop: `1px solid ${theme.colors.border}` }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 8 }}>
                        <button type="button" onClick={() => setRaw((r) => !r)} style={{ background: raw ? `${primary}22` : 'transparent', border: `1px solid ${theme.colors.border}`, color: theme.colors.secondaryText, borderRadius: 8, padding: '3px 9px', fontSize: '0.74rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <FaCode size={10} /> JSON
                        </button>
                    </div>
                    {raw ? (
                        <div style={{ position: 'relative' }}>
                            <pre className="icrc3-mono" style={{ margin: 0, padding: 12, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, fontSize: '0.76rem', overflowX: 'auto', color: theme.colors.primaryText }}>
                                {JSON.stringify(valueToJson(block), null, 2)}
                            </pre>
                            <div style={{ position: 'absolute', top: 8, right: 8 }}><CopyButton text={JSON.stringify(valueToJson(block), null, 2)} theme={theme} size={12} /></div>
                        </div>
                    ) : view === 'verbose' ? (
                        <div className="icrc3-tree" style={{ color: theme.colors.primaryText }}>
                            <VerboseNode name={null} value={block} theme={theme} />
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, max-content) minmax(0, 1fr)', columnGap: 14, rowGap: 6, alignItems: 'baseline', fontSize: '0.85rem' }}>
                                <div style={{ color: theme.colors.mutedText, fontWeight: 600, fontSize: '0.8rem' }}>Time</div>
                                <div>{ts !== null ? <TimeChip ns={ts} theme={theme} /> : <span style={{ color: theme.colors.mutedText }}>none</span>}</div>
                                <div style={{ color: theme.colors.mutedText, fontWeight: 600, fontSize: '0.8rem' }}>Block type</div>
                                <div className="icrc3-mono">{btype || <span style={{ color: theme.colors.mutedText }}>none</span>}</div>
                                <div style={{ color: theme.colors.mutedText, fontWeight: 600, fontSize: '0.8rem' }}>Parent hash</div>
                                <div className="icrc3-mono">{phash ? <>{shortHex(bytesOf(phash), 8)} <CopyButton text={fullHex(bytesOf(phash))} theme={theme} /></> : <span style={{ color: theme.colors.mutedText }}>none (first block)</span>}</div>
                                <div style={{ color: theme.colors.mutedText, fontWeight: 600, fontSize: '0.8rem' }}>Block hash</div>
                                <div className="icrc3-mono">{(() => { const h = hashValue(block); return <>{shortHex(h, 8)} <CopyButton text={toHex(h)} theme={theme} /></>; })()}</div>
                            </div>
                            {topLevel.length > 0 && <FieldTable entries={topLevel} ctx={blockCtx} projection={projection} />}
                            {tx && 'Map' in tx ? (
                                <div>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '4px 0 8px' }}>Transaction</div>
                                    <FieldTable entries={tx.Map} ctx={blockCtx} projection={projection} />
                                </div>
                            ) : tx ? <FieldTable entries={[['tx', tx]]} ctx={blockCtx} /> : null}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function ToolsIcrc3() {
    const { theme } = useTheme();
    const naming = useNaming();
    const [params, setParams] = useSearchParams();

    const [canisterText, setCanisterText] = useState(params.get('canister') || '');
    const [canisterId, setCanisterId] = useState(() => parsePrincipal(params.get('canister') || ''));
    const [overview, setOverview] = useState(null);
    const [overviewError, setOverviewError] = useState('');
    const [loadingOverview, setLoadingOverview] = useState(false);

    const [pageSize, setPageSize] = useState(() => PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : 25);
    const [page, setPage] = useState(() => Math.max(0, Number(params.get('page') || 0)));
    const [newestFirst, setNewestFirst] = useState(params.get('order') !== 'asc');
    const [view, setView] = useState(() => VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'specific');
    const [typeFilter, setTypeFilter] = useState('');
    const [jump, setJump] = useState('');

    const [items, setItems] = useState([]);
    const [loadingBlocks, setLoadingBlocks] = useState(false);
    const [blocksError, setBlocksError] = useState('');
    const [expanded, setExpanded] = useState(() => new Set());
    const [tip, setTip] = useState(null); // { lastIndex, lastHash } | { error }
    const [verifying, setVerifying] = useState(false);
    const [chainState, setChainState] = useState(null);
    const requestSeq = useRef(0);
    // ?block=N (with ?canister=) opens the page holding block N with that block expanded, once
    const pendingBlock = useRef((() => { try { const b = params.get('block'); return b ? BigInt(b) : null; } catch { return null; } })());

    // keep the URL shareable
    useEffect(() => {
        const next = {};
        if (canisterId) next.canister = canisterId.toText();
        if (pageSize !== 25) next.size = String(pageSize);
        if (page > 0) next.page = String(page);
        if (!newestFirst) next.order = 'asc';
        if (view !== 'specific') next.view = view;
        setParams(next, { replace: true });
    }, [canisterId, pageSize, page, newestFirst, view, setParams]);

    const load = useCallback(async (text) => {
        const p = parsePrincipal(text);
        if (!p) { setOverviewError('That is not a valid canister id.'); return; }
        setOverviewError('');
        setCanisterId(p);
        setOverview(null);
        setItems([]);
        setTip(null);
        setChainState(null);
        setExpanded(new Set());
        setPage(0);
        setLoadingOverview(true);
        try {
            const ov = await fetchOverview(p);
            setOverview(ov);
        } catch (e) {
            setOverviewError(`This canister did not answer icrc3_get_blocks: ${e?.message || e}`);
        } finally {
            setLoadingOverview(false);
        }
    }, []);

    useEffect(() => { if (canisterId && !overview && !loadingOverview && !overviewError) load(canisterId.toText()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const logLength = overview?.logLength ?? 0n;
    const totalPages = Math.max(1, Number((logLength + BigInt(pageSize) - 1n) / BigInt(pageSize)));
    const range = useMemo(() => {
        if (!overview || logLength === 0n) return null;
        const size = BigInt(pageSize);
        const p = BigInt(Math.min(page, totalPages - 1));
        if (newestFirst) {
            const end = logLength - p * size;
            const start = end > size ? end - size : 0n;
            return { start, length: end - start };
        }
        const start = p * size;
        return { start, length: logLength - start < size ? logLength - start : size };
    }, [overview, logLength, pageSize, page, newestFirst, totalPages]);

    useEffect(() => {
        if (!canisterId || !range) { setItems([]); return; }
        const seq = ++requestSeq.current;
        setLoadingBlocks(true);
        setBlocksError('');
        setChainState(null);
        fetchBlocks(canisterId, range.start, range.length)
            .then((list) => { if (seq === requestSeq.current) setItems(newestFirst ? [...list].reverse() : list); })
            .catch((e) => { if (seq === requestSeq.current) setBlocksError(`Could not load blocks: ${e?.message || e}`); })
            .finally(() => { if (seq === requestSeq.current) setLoadingBlocks(false); });
    }, [canisterId, range, newestFirst]);

    // token metadata for every ledger-looking principal on the page (and the canister itself)
    const principalsOnPage = useMemo(() => {
        const set = new Set();
        if (canisterId) set.add(canisterId.toText());
        for (const { block } of items) {
            for (const [k, v] of txEntries(block)) {
                const spec = ['ledger', 'token0', 'token1'].includes(k);
                const p = asPrincipal(v);
                if (p && (spec || guessKind(k, v) === 'principal')) set.add(p.toText());
            }
        }
        return [...set];
    }, [items, canisterId]);
    const tokenMeta = useTokenMeta(principalsOnPage);
    const ledgerSelf = !!overview?.metadata;

    const nameOf = useCallback((text) => {
        const n = naming?.getPrincipalDisplayName?.(text);
        return n?.nickname || n?.name || `${text.slice(0, 5)}…${text.slice(-3)}`;
    }, [naming]);

    const ctx = useMemo(() => ({ theme, getName: naming?.getPrincipalDisplayName, nameOf, tokenMeta, canisterId, ledgerSelf }), [theme, naming, nameOf, tokenMeta, canisterId, ledgerSelf]);

    const specificAvailable = useMemo(() => canisterId && items.some(({ block }) => projectionFor(block, canisterId.toText())), [items, canisterId]);
    const effectiveView = view === 'specific' && !specificAvailable ? 'compact' : view;

    const typesOnPage = useMemo(() => [...new Set(items.map(({ block }) => btypeOf(block)).filter(Boolean))], [items]);
    const shown = typeFilter ? items.filter(({ block }) => btypeOf(block) === typeFilter) : items;

    const verify = async () => {
        if (!canisterId || verifying) return;
        setVerifying(true);
        try {
            const t = await verifyTip(canisterId);
            if (!t) { setTip({ error: 'The canister returned no tip certificate.' }); return; }
            setTip(t);
            // page chain: consecutive blocks link, and the tip block matches the certificate
            const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
            const state = new Map();
            for (let i = 0; i < sorted.length; i++) {
                const { id, block } = sorted[i];
                if (i > 0) {
                    const prev = sorted[i - 1];
                    const ph = field(block, 'phash');
                    state.set(id, prev.id + 1n === id && ph && bytesEqual(bytesOf(ph), hashValue(prev.block)) ? 'ok' : 'broken');
                }
                if (id === t.lastIndex) state.set(id, bytesEqual(hashValue(block), t.lastHash) ? 'certified' : 'broken');
            }
            setChainState(state);
        } catch (e) {
            setTip({ error: e?.message || String(e) });
        } finally {
            setVerifying(false);
        }
    };

    const goto = (p) => { setPage(Math.min(Math.max(0, p), totalPages - 1)); setExpanded(new Set()); };
    const jumpTo = () => {
        if (!overview) return;
        let n; try { n = BigInt(jump.trim()); } catch { return; }
        if (n < 0n || n >= logLength) return;
        const size = BigInt(pageSize);
        const p = newestFirst ? Number((logLength - 1n - n) / size) : Number(n / size);
        goto(p);
        setExpanded(new Set([n]));
    };

    useEffect(() => {
        const n = pendingBlock.current;
        if (!overview || n === null) return;
        pendingBlock.current = null;
        if (n < 0n || n >= logLength) return;
        const size = BigInt(pageSize);
        setPage(newestFirst ? Number((logLength - 1n - n) / size) : Number(n / size));
        setExpanded(new Set([n]));
    }, [overview]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggle = (id) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const allExpanded = shown.length > 0 && shown.every(({ id }) => expanded.has(id));

    const styles = {
        container: { maxWidth: '1100px', margin: '0 auto', padding: '1.25rem 1rem 3rem', color: theme.colors.primaryText },
        card: { background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, borderRadius: 16, padding: '1.1rem 1.25rem', boxShadow: theme.colors.cardShadow, marginBottom: '1rem' },
        input: { flex: 1, minWidth: 220, padding: '11px 14px', borderRadius: 10, border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.95rem', outline: 'none' },
        button: (active = true, color = primary) => ({ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: active ? 'pointer' : 'default', color: '#fff', fontWeight: 600, fontSize: '0.9rem', background: active ? `linear-gradient(135deg, ${color}, ${color}cc)` : theme.colors.border, boxShadow: active ? `0 4px 14px ${color}40` : 'none', opacity: active ? 1 : 0.6 }),
        ghost: (active = false) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 9, border: `1px solid ${active ? primary : theme.colors.border}`, background: active ? `${primary}20` : 'transparent', color: active ? primary : theme.colors.secondaryText, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }),
        select: { padding: '7px 10px', borderRadius: 9, border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.82rem' },
        stat: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 110 },
        statLabel: { color: theme.colors.mutedText, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 },
        statValue: { color: theme.colors.primaryText, fontSize: '1.05rem', fontWeight: 700 },
    };

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />

            <div style={{ background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${primary}12 50%, ${secondary}08 100%)`, borderBottom: `1px solid ${theme.colors.border}`, padding: '2rem 1rem 1.75rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: '-40%', right: '-5%', width: 320, height: 320, background: `radial-gradient(circle, ${primary}18 0%, transparent 70%)`, pointerEvents: 'none' }} />
                <div className="icrc3-fade-in" style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', position: 'relative' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 18, background: `linear-gradient(135deg, ${primary}, ${secondary})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 12px 36px ${primary}50`, flexShrink: 0 }}>
                        <FaDatabase size={28} color="#fff" />
                    </div>
                    <div style={{ flex: 1, minWidth: 240 }}>
                        <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 700, letterSpacing: '-0.5px', color: theme.colors.primaryText }}>ICRC-3 Browser</h1>
                        <p style={{ margin: '4px 0 0', color: theme.colors.secondaryText, fontSize: '0.98rem', lineHeight: 1.5 }}>
                            Point it at any canister that implements the ICRC-3 block log: ledgers, Sneed Lock, anything. Read the chain, verify the certified tip, and switch between a purpose-built, a compact and a verbose view.
                        </p>
                    </div>
                </div>
            </div>

            <main style={styles.container}>
                <div className="icrc3-fade-in" style={styles.card}>
                    <form onSubmit={(e) => { e.preventDefault(); load(canisterText); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ flex: '1 1 320px', minWidth: 240 }}>
                            <PrincipalInput value={canisterText} onChange={setCanisterText} onSelect={(id) => { setCanisterText(id); load(id); }} placeholder="Canister id or name, e.g. Sneed Lock" defaultTab="all" defaultPrincipalType="canisters" style={{ width: '100%' }} inputStyle={styles.input} />
                        </div>
                        <select value="" onChange={(e) => { if (e.target.value) { setCanisterText(e.target.value); load(e.target.value); } }} style={styles.select}>
                            <option value="">Known canisters…</option>
                            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        <button type="submit" style={styles.button(!loadingOverview)} disabled={loadingOverview}>
                            {loadingOverview ? <FaSpinner className="icrc3-spin" size={13} /> : <FaSearch size={13} />} Browse
                        </button>
                        {canisterId && overview?.metadata && (
                            <Link to={`/tools/money?ledger=${canisterId.toText()}`} style={{ ...styles.button(true), textDecoration: 'none' }}>Follow the money</Link>
                        )}
                    </form>
                    {overviewError && <div style={{ marginTop: 10, color: theme.colors.error, fontSize: '0.88rem' }}>{overviewError}</div>}
                </div>

                {overview && canisterId && (
                    <div className="icrc3-fade-in" style={styles.card}>
                        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            <div style={styles.stat}><span style={styles.statLabel}>Canister</span><span style={{ ...styles.statValue, fontSize: '0.9rem' }}><PrincipalChip principal={canisterId} theme={theme} getName={naming?.getPrincipalDisplayName} /></span></div>
                            <div style={styles.stat}><span style={styles.statLabel}>Blocks</span><span style={styles.statValue}>{formatNat(logLength)}</span></div>
                            <div style={styles.stat}><span style={styles.statLabel}>Archives</span><span style={styles.statValue}>{overview.archives.length}</span></div>
                            {overview.metadata && <div style={styles.stat}><span style={styles.statLabel}>Token</span><span style={styles.statValue}>{overview.metadata['icrc1:symbol'] || '?'} <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', fontWeight: 500 }}>{overview.metadata['icrc1:decimals']?.toString()} decimals</span></span></div>}
                            {overview.standards.length > 0 && <div style={styles.stat}><span style={styles.statLabel}>Standards</span><span style={{ ...styles.statValue, fontSize: '0.85rem' }}>{overview.standards.map((s) => s.name).join(', ')}</span></div>}
                            <div style={{ ...styles.stat, flex: 1, minWidth: 200 }}>
                                <span style={styles.statLabel}>Certified tip</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    {tip && !tip.error && <Pill color={theme.colors.success} theme={theme}><FaCheckCircle size={10} /> block #{tip.lastIndex.toString()} · {shortHex(tip.lastHash, 5)}</Pill>}
                                    {tip?.error && <Pill color={theme.colors.error} theme={theme}><FaExclamationTriangle size={10} /> {tip.error}</Pill>}
                                    <button type="button" onClick={verify} style={styles.ghost(false)} disabled={verifying}>
                                        {verifying ? <FaSpinner className="icrc3-spin" size={11} /> : <FaShieldAlt size={11} />} {tip ? 'Verify again' : 'Verify tip and this page'}
                                    </button>
                                </span>
                            </div>
                        </div>
                        {overview.blockTypes.length > 0 && (
                            <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                <span style={{ ...styles.statLabel, marginRight: 4 }}>Block types</span>
                                {overview.blockTypes.map((t) => (
                                    <a key={t.block_type} href={t.url || undefined} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                                        <Pill color={theme.colors.secondaryText} theme={theme} title={t.url}>{t.block_type}</Pill>
                                    </a>
                                ))}
                            </div>
                        )}
                        {overview.archives.length > 0 && (
                            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem', color: theme.colors.secondaryText }}>
                                <span style={{ ...styles.statLabel, marginRight: 4 }}>Archives</span>
                                {overview.archives.map((a) => (
                                    <span key={a.canister_id.toText()} className="icrc3-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        <PrincipalChip principal={a.canister_id} theme={theme} getName={naming?.getPrincipalDisplayName} /> [{a.start.toString()}…{a.end.toString()}]
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {overview && canisterId && (
                    <>
                        <div className="icrc3-fade-in" style={{ ...styles.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '0.8rem 1rem' }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                                {VIEWS.map((v) => (
                                    <button key={v.id} type="button" title={v.id === 'specific' && !specificAvailable ? 'No purpose-built view for the block types on this page' : v.hint} onClick={() => setView(v.id)}
                                        style={{ ...styles.ghost(view === v.id), opacity: v.id === 'specific' && !specificAvailable ? 0.5 : 1 }}>
                                        {v.label}
                                    </button>
                                ))}
                            </div>
                            <div style={{ width: 1, height: 22, background: theme.colors.border }} />
                            <button type="button" onClick={() => { setNewestFirst((n) => !n); setPage(0); }} style={styles.ghost(false)} title="Toggle order">
                                {newestFirst ? <FaSortAmountDown size={11} /> : <FaSortAmountUp size={11} />} {newestFirst ? 'Newest first' : 'Oldest first'}
                            </button>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: theme.colors.secondaryText }}>
                                Page size
                                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} style={styles.select}>
                                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: theme.colors.secondaryText }}>
                                <FaFilter size={10} />
                                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={styles.select}>
                                    <option value="">All types on this page</option>
                                    {typesOnPage.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </label>
                            <form onSubmit={(e) => { e.preventDefault(); jumpTo(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                                <input value={jump} onChange={(e) => setJump(e.target.value)} placeholder="Go to block #" className="icrc3-mono" style={{ ...styles.select, width: 120 }} />
                                <button type="submit" style={styles.ghost(false)}>Go</button>
                            </form>
                            <button type="button" onClick={() => setExpanded(allExpanded ? new Set() : new Set(shown.map(({ id }) => id)))} style={styles.ghost(false)}>
                                {allExpanded ? 'Collapse all' : 'Expand all'}
                            </button>
                        </div>

                        {view === 'specific' && !specificAvailable && items.length > 0 && (
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.82rem', margin: '-4px 0 10px 4px' }}>No purpose-built view for these block types yet, showing the compact view.</div>
                        )}

                        {blocksError && <div style={{ ...styles.card, color: theme.colors.error }}>{blocksError}</div>}
                        {loadingBlocks && (
                            <div style={{ ...styles.card, display: 'flex', alignItems: 'center', gap: 10, color: theme.colors.mutedText }}><FaSpinner className="icrc3-spin" /> Loading blocks {range ? `${range.start.toString()}…${(range.start + range.length - 1n).toString()}` : ''}…</div>
                        )}
                        {!loadingBlocks && !blocksError && logLength === 0n && <div style={{ ...styles.card, color: theme.colors.mutedText }}>This log is empty.</div>}
                        {!loadingBlocks && shown.length === 0 && items.length > 0 && <div style={{ ...styles.card, color: theme.colors.mutedText }}>No blocks of that type on this page. <button type="button" onClick={() => setTypeFilter('')} style={styles.ghost(false)}><FaTimes size={10} /> clear filter</button></div>}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {shown.map((item) => (
                                <BlockCard key={item.id.toString()} item={item} view={effectiveView} ctx={ctx} expanded={expanded.has(item.id)} onToggle={() => toggle(item.id)} chainState={chainState} />
                            ))}
                        </div>

                        {logLength > 0n && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                                <button type="button" onClick={() => goto(0)} disabled={page === 0} style={styles.ghost(false)} title="First page"><FaAngleDoubleLeft size={11} /></button>
                                <button type="button" onClick={() => goto(page - 1)} disabled={page === 0} style={styles.ghost(false)}><FaChevronLeft size={11} /> Prev</button>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                                    Page <strong style={{ color: theme.colors.primaryText }}>{Math.min(page, totalPages - 1) + 1}</strong> of {totalPages.toLocaleString()}
                                    {range && <span style={{ color: theme.colors.mutedText }}> · blocks {range.start.toString()}…{(range.start + range.length - 1n).toString()}</span>}
                                </span>
                                <button type="button" onClick={() => goto(page + 1)} disabled={page >= totalPages - 1} style={styles.ghost(false)}>Next <FaChevronRight size={11} /></button>
                                <button type="button" onClick={() => goto(totalPages - 1)} disabled={page >= totalPages - 1} style={styles.ghost(false)} title="Last page"><FaAngleDoubleRight size={11} /></button>
                            </div>
                        )}
                    </>
                )}

                {!overview && !loadingOverview && !overviewError && (
                    <div className="icrc3-fade-in" style={{ ...styles.card, color: theme.colors.secondaryText, fontSize: '0.92rem', lineHeight: 1.65 }}>
                        <p style={{ marginTop: 0 }}><strong style={{ color: theme.colors.primaryText }}>What this does.</strong> ICRC-3 is the standard way a canister on the Internet Computer publishes a tamper-evident log of blocks: each block carries the hash of the previous one and the canister certifies the newest block. Token ledgers use it for their transactions; Sneed Lock uses it for every lock, transfer, fee and admin action.</p>
                        <p>Enter a canister id or pick a known one. Blocks that this app understands (Sneed Lock, ICRC-1 and ICRC-2 ledgers) get a purpose-built view with token symbols, names and links. Everything else gets a compact view that guesses what each field is, and a verbose view that shows every byte.</p>
                        <p style={{ marginBottom: 0 }}>Developers: Sneed Lock's block catalogue and a verifier script are in the <Link to="/api/sneed_lock" style={{ color: primary }}>API documentation</Link>.</p>
                    </div>
                )}
            </main>
        </div>
    );
}

export default ToolsIcrc3;
