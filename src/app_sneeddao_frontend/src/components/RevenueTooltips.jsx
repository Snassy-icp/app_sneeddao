// The live parts of the /rll_info diagram's cards: what each station moved over the last 90 days
// (the loop ledger's lines) and what each product has earned (its canister's counters). They read
// the shared cache (utils/revenueStore.js) and re-render as it fills, so a card shows at once and
// its numbers arrive while it is open; /rll_ledger and /revenue reuse whatever was loaded here.
import React from 'react';
import { Link } from 'react-router-dom';
import { FaSpinner, FaLock } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { useStoreVersion } from '../utils/revenueStore';
import { ICP_LEDGER, SNEED_LEDGER, PERIODS, DEFAULT_PERIOD } from '../utils/rllLedger';
import { PRODUCTS, loadSection, sectionEntry, lineOf, loadAllProducts, productEntry, productTotals, loadPrice, priceOf, usdOf, fmtAmount } from '../utils/revenueData';

const LEDGER_OF = { ICP: ICP_LEDGER, SNEED: SNEED_LEDGER };
const periodLabel = (key) => PERIODS.find((p) => p.key === key).label;

// What the loop ledger knows about each node, and about each edge by source-target.
const NODE_LINES = {
    '1': [['neuron', 'maturity', 'Maturity minted']],
    '2': [['neuron', 'maturity', 'Maturity collected']],
    '3': [['icpSplitter', 'maturity', 'In: neuron maturity'], ['icpSplitter', 'deposits', 'In: deposits (product fees and more)'], ['icpSplitter', 'toBuyback', 'Out: to the SNEED buyback'], ['icpSplitter', 'toTreasury', 'Out: to the treasury']],
    '4': [['buyback', 'icpIn', 'ICP received'], ['buyback', 'sneedOut', 'SNEED bought']],
    '5': [['sneedSplitter', 'in', 'SNEED received'], ['sneedSplitter', 'burn', 'Burned'], ['sneedSplitter', 'treasury', 'To the treasury'], ['sneedSplitter', 'rll', 'To member rewards']],
    '6': [['icpSplitter', 'toTreasury', 'ICP from the splitter'], ['sneedSplitter', 'treasury', 'SNEED from the splitter']],
    '8': [['sneedSplitter', 'burn', 'SNEED burned']],
    '9': [['sneedSplitter', 'rll', 'SNEED for voters']],
    '10': [['neuron', 'maturity', 'Maturity from the neuron'], ['icpSplitter', 'deposits', 'ICP deposited (LP fees, products)'], ['lpFees', 'toSneedSplitter', 'SNEED from LP fees']],
    '11': [['lpFees', 'icpSneedPool', 'ICP fees claimed'], ['lpFees', 'sneedSneedPool', 'SNEED fees claimed']],
};
const EDGE_LINES = {
    '1-2': [['neuron', 'maturity', 'Maturity minted']],
    '2-10': [['icpSplitter', 'maturity', 'Maturity to the splitter']],
    '3-4': [['icpSplitter', 'toBuyback', 'ICP to the buyback']],
    '3-6': [['icpSplitter', 'toTreasury', 'ICP to the treasury']],
    '4-5': [['buyback', 'sneedOut', 'SNEED bought']],
    '5-6': [['sneedSplitter', 'treasury', 'SNEED to the treasury']],
    '5-8': [['sneedSplitter', 'burn', 'SNEED burned']],
    '5-9': [['sneedSplitter', 'rll', 'SNEED to member rewards']],
    '10-3': [['icpSplitter', 'maturity', 'Maturity (inside the pylon)'], ['icpSplitter', 'deposits', 'ICP deposited']],
    '10-5': [['lpFees', 'toSneedSplitter', 'SNEED from LP fees']],
    '11-10': [['lpFees', 'toIcpSplitter', 'ICP to the ICP splitter (both pools)'], ['lpFees', 'toSneedSplitter', 'SNEED to the SNEED splitter']],
};
// cards that count from the start instead of the default period: what the LP has paid out so far
const ALL_TIME = new Set(['node:11', 'edge:11-10']);
// moves that stay inside a pylon and leave no transaction
const INSIDE_PYLON = new Set(['3-2', '2-1']);
const PRODUCT_BY_NODE = Object.fromEntries(PRODUCTS.map((p) => [p.node, p]));

/// What a card shows besides its text: { lines, period, product, products, inside }.
export function ledgerLinesFor(kind, target) {
    if (kind === 'node') {
        return { lines: NODE_LINES[target.id] || [], period: ALL_TIME.has(`node:${target.id}`) ? 'all' : DEFAULT_PERIOD, product: PRODUCT_BY_NODE[target.id] || null, products: target.id === '12' || target.id === '10' };
    }
    const k = `${target.source}-${target.target}`;
    return { lines: EDGE_LINES[k] || [], period: ALL_TIME.has(`edge:${k}`) ? 'all' : DEFAULT_PERIOD, product: target.target === '12' ? PRODUCT_BY_NODE[target.source] || null : null, products: k === '12-10', inside: INSIDE_PYLON.has(k) };
}

/// Starts loading what a card needs (a hover or a tap calls this; loads already done or running are reused).
export function ensureTooltipData(kind, target) {
    const { lines, period, product, products } = ledgerLinesFor(kind, target);
    if (lines.length || product || products) { loadPrice(ICP_LEDGER).catch(() => {}); loadPrice(SNEED_LEDGER).catch(() => {}); }
    for (const s of new Set(lines.map(([section]) => section))) loadSection(s, period).catch(() => {});
    if (product || products) loadAllProducts();
}

const box = (theme) => ({ marginTop: 8, padding: 8, background: theme.colors.tertiaryBg, borderRadius: 4, fontSize: '0.8rem' });
const Pending = ({ text }) => <span style={{ opacity: 0.75, display: 'inline-flex', alignItems: 'center', gap: 5 }}><FaSpinner style={{ animation: 'spin 1s linear infinite' }} size={11} /> {text}</span>;

/// The ledger's numbers for a card: each line's total over the period (the default one unless the
/// card counts from the start), with its value today.
export function LedgerSummary({ lines, inside, period = DEFAULT_PERIOD }) {
    useStoreVersion();
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    if (inside) return <div style={box(theme)}>This move stays inside the Neutrinite pylon, so it leaves no transaction on the ledger.</div>;
    if (!lines.length) return null;
    return (
        <div style={box(theme)}>
            <div style={{ marginBottom: 4, color: theme.colors.mutedText }}>{period === 'all' ? 'All time' : `Last ${periodLabel(period)}`}, from the loop ledger:</div>
            {lines.map(([section, line, label]) => {
                const l = lineOf(section, line, period);
                const e = sectionEntry(section, period);
                const price = l ? priceOf(LEDGER_OF[l.token]) : null;
                return (
                    <div key={`${section}:${line}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0' }}>
                        <span>{label}</span>
                        <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {l ? (
                                <>
                                    {(Number(l.total) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 2 })} {l.token}
                                    <span style={{ color: theme.colors.mutedText }}>{price ? ` · ${formatValue((Number(l.total) / 1e8) * price)}` : ''} · {l.n} tx{l.cutAt ? ` · since ${new Date(l.cutAt).toISOString().slice(0, 10)}` : ''}</span>
                                </>
                            ) : e.error && !e.loading ? <span style={{ color: theme.colors.error }}>could not read</span> : <Pending text="reading…" />}
                        </span>
                    </div>
                );
            })}
            <Link to={`/rll_ledger#${lines[0][0]}`} style={{ display: 'inline-block', marginTop: 4, color: theme.colors.accent, fontSize: '0.75rem' }}>Every transfer in the loop ledger</Link>
        </div>
    );
}

function ProductRow({ p, theme, formatValue, showName }) {
    const e = productEntry(p.id);
    const s = e.value;
    const v = s && !s.hidden ? usdOf(s.amounts) : null;
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0' }}>
            <span>{showName ? p.name : 'Earned, all time'}</span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {!s ? (e.error && !e.loading ? <span style={{ color: theme.colors.error }}>could not read</span> : <Pending text="reading…" />)
                    : s.hidden ? <span style={{ color: theme.colors.mutedText }}><FaLock size={9} /> admin only for now</span>
                    : (
                        <>
                            {s.amounts.filter((a) => a.amount > 0n).map((a) => fmtAmount(a.amount, a.ledger)).join(' · ') || '0 ICP'}
                            {v && v.usd > 0 && <span style={{ color: theme.colors.mutedText }}> · {formatValue(v.usd)}{v.complete ? '' : ' +'}</span>}
                        </>
                    )}
            </span>
        </div>
    );
}

/// One product's lifetime revenue, with its breakdown.
export function ProductSummary({ product }) {
    useStoreVersion();
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const s = productEntry(product.id).value;
    return (
        <div style={box(theme)}>
            <ProductRow p={product} theme={theme} formatValue={formatValue} />
            {s && !s.hidden && s.parts.map((part) => (
                <div key={part.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '1px 0 1px 8px', color: theme.colors.mutedText, fontSize: '0.75rem' }}>
                    <span>{part.label}{part.note ? ` · ${part.note}` : ''}</span>
                    <span style={{ textAlign: 'right' }}>{part.amounts.filter((a) => a.amount > 0n).map((a) => fmtAmount(a.amount, a.ledger)).join(' · ') || '0'}</span>
                </div>
            ))}
            {s && s.stats.length > 0 && <div style={{ marginTop: 4, color: theme.colors.mutedText, fontSize: '0.75rem' }}>{s.stats.map((x) => `${x.label}: ${x.value}`).join(' · ')}</div>}
            {s?.hidden && <div style={{ marginTop: 4, color: theme.colors.mutedText, fontSize: '0.75rem' }}>Its canister still shows revenue totals to admins only.</div>}
            <Link to={`/revenue#${product.id}`} style={{ display: 'inline-block', marginTop: 4, color: theme.colors.accent, fontSize: '0.75rem' }}>All products on the revenue page</Link>
        </div>
    );
}

/// Every product's lifetime revenue and their sum.
export function ProductsSummary() {
    useStoreVersion();
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const t = productTotals();
    const v = usdOf(t.amounts);
    return (
        <div style={box(theme)}>
            <div style={{ marginBottom: 4, color: theme.colors.mutedText }}>Earned by the products, all time:</div>
            {PRODUCTS.map((p) => <ProductRow key={p.id} p={p} theme={theme} formatValue={formatValue} showName />)}
            {t.loaded > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0 0', marginTop: 4, borderTop: `1px solid ${theme.colors.border}`, fontWeight: 600 }}>
                    <span>Together{t.loaded < t.total ? ' (so far)' : ''}</span>
                    <span style={{ textAlign: 'right' }}>{t.amounts.filter((a) => a.amount > 0n).map((a) => fmtAmount(a.amount, a.ledger)).join(' · ') || '0 ICP'}{v.usd > 0 ? ` · ${formatValue(v.usd)}${v.complete ? '' : ' +'}` : ''}</span>
                </div>
            )}
            <Link to="/revenue" style={{ display: 'inline-block', marginTop: 4, color: theme.colors.accent, fontSize: '0.75rem' }}>The breakdown on the revenue page</Link>
        </div>
    );
}
