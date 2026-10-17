// /revenue: what Sneed DAO's products have earned, read live from each product's canister, and
// what reached the Recursive Liquidity Loop, read from the ledger. Everything comes from the
// shared cache (utils/revenueStore.js), so /rll_info and /rll_ledger reuse it and the reverse.
// Each card renders at once and fills in as its own data arrives.
import React, { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { FaSpinner, FaInfoCircle, FaLock, FaArrowRight, FaSync } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { useStoreVersion } from '../utils/revenueStore';
import { PRODUCTS, SOURCES, PERIODS, DEFAULT_PERIOD, loadAllProducts, loadProduct, productEntry, productTotals, revenueTotals, loadAllSources, loadSource, sourceEntry, usdOf, fmtAmount, priceOf, useSection, lineOf, loadSection } from '../utils/revenueData';
import { ICP_LEDGER } from '../utils/rllLedger';

const AMBER = '#f59e0b';
const ICP_COLOR = '#4a90e2';
const MATURITY_COLOR = '#2ecc71';
const fmtNum = (n, max = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: max });

function Spinner({ text }) {
    const { theme } = useTheme();
    return <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}><FaSpinner className="rev-spin" /> {text}</span>;
}

/// "12.3 ICP · 45.6 SNEED", or a dash. A long list wraps after a "·", never inside an amount.
function Amounts({ amounts, max = 2 }) {
    const shown = amounts.filter((a) => a.amount > 0n);
    if (!shown.length) return <>0 ICP</>;
    return <>{shown.map((a, i) => <React.Fragment key={a.ledger}>{i > 0 && '\u00a0· '}<span style={{ whiteSpace: 'nowrap' }}>{fmtAmount(a.amount, a.ledger, max)}</span></React.Fragment>)}</>;
}

/// One source of revenue: a product (read from its canister) or the neuron or the LP (read from
/// the ledger). `item` is { id, name, link, color, description }, `e` its cache entry and `s` its
/// summary ({ amounts, parts, stats, hidden? }, null while it loads).
function RevenueCard({ item, e, s, retry, reading }) {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const product = item;
    const value = s ? usdOf(s.amounts) : null;
    return (
        <section id={product.id} style={{ background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderTop: `3px solid ${product.color}`, borderRadius: 14, padding: '1rem', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <Link to={product.link} style={{ fontSize: '1.05rem', fontWeight: 700, color: theme.colors.primaryText, textDecoration: 'none' }}>{product.name}</Link>
                {s && !s.hidden && (
                    <div style={{ textAlign: 'right', minWidth: 0, marginLeft: 'auto' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: product.color, fontVariantNumeric: 'tabular-nums' }}><Amounts amounts={s.amounts} /></div>
                        {value && value.usd > 0 && <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>{formatValue(value.usd)}{value.complete ? '' : ' +'} today</div>}
                    </div>
                )}
            </div>
            <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, lineHeight: 1.5 }}>{product.description}</div>
            {!s && !(e.error && !e.loading) && <Spinner text={e.progress || reading} />}
            {!s && e.error && !e.loading && (
                <div style={{ fontSize: '0.8rem', color: theme.colors.error }}>
                    Could not read it: {e.error} <button type="button" onClick={retry} style={{ background: 'none', border: 'none', color: theme.colors.accent, cursor: 'pointer', fontSize: '0.8rem' }}>Try again</button>
                </div>
            )}
            {s?.hidden && (
                <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <FaLock style={{ marginTop: 3, flexShrink: 0 }} /> Its canister still shows its revenue totals to admins only. They will appear here once a DAO upgrade makes them public.
                </div>
            )}
            {s && !s.hidden && s.parts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {s.parts.map((part) => (
                        // the label keeps its line; amounts in several tokens wrap under it, right-aligned
                        <div key={part.label} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 2, fontSize: '0.8rem', padding: '5px 8px', borderRadius: 8, background: theme.colors.secondaryBg }}>
                            <span style={{ color: theme.colors.primaryText, flex: '0 0 auto', whiteSpace: 'nowrap' }}>
                                {part.link ? <Link to={part.link} style={{ color: theme.colors.primaryText }}>{part.label}</Link> : part.label}
                                {part.note && <span style={{ color: theme.colors.mutedText }}> · {part.note}</span>}
                            </span>
                            <span style={{ color: theme.colors.primaryText, fontVariantNumeric: 'tabular-nums', textAlign: 'right', flex: '1 1 auto', marginLeft: 'auto' }}><Amounts amounts={part.amounts} /></span>
                        </div>
                    ))}
                </div>
            )}
            {s && s.stats.length > 0 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.75rem', color: theme.colors.mutedText }}>
                    {s.stats.map((x) => <span key={x.label}>{x.label}: <b style={{ color: theme.colors.secondaryText }}>{x.value}</b></span>)}
                </div>
            )}
        </section>
    );
}

const ProductCard = ({ product }) => {
    const e = productEntry(product.id);
    return <RevenueCard item={product} e={e} s={e.value} retry={() => loadProduct(product, { force: true }).catch(() => {})} reading="Reading its canister…" />;
};
const SourceCard = ({ src }) => (
    <RevenueCard item={src} e={sourceEntry(src)} s={src.summary()} retry={() => loadSource(src, { force: true }).catch(() => {})} reading="Reading the ledger…" />
);
const PRODUCTS_SOURCE = { id: 'products', name: 'Products', color: AMBER };

/// What each part contributed, as one bar (by today's value, or ICP when prices are missing).
/// `parts` is [{ p: { id, name, color }, s: summary or null }].
function ShareBar({ parts }) {
    const { theme } = useTheme();
    const rows = parts.map(({ p, s }) => {
        if (!s || s.hidden) return null;
        const v = usdOf(s.amounts);
        const icp = s.amounts.find((a) => a.ledger === ICP_LEDGER)?.amount || 0n;
        return { p, usd: v.usd, icp: Number(icp) / 1e8 };
    }).filter(Boolean);
    const byUsd = rows.length > 0 && rows.every((r) => r.usd > 0 || r.icp === 0);
    const total = rows.reduce((a, r) => a + (byUsd ? r.usd : r.icp), 0);
    if (!total) return null;
    return (
        <div>
            <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: theme.colors.secondaryBg }}>
                {rows.map((r) => { const v = byUsd ? r.usd : r.icp; return v > 0 ? <div key={r.p.id} title={`${r.p.name}: ${fmtNum((v / total) * 100, 1)}%`} style={{ width: `${(v / total) * 100}%`, background: r.p.color }} /> : null; })}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6, fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                {rows.map((r) => { const v = byUsd ? r.usd : r.icp; return <a key={r.p.id} href={`#${r.p.id}`} style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: r.p.color }} />{r.p.name} {fmtNum((v / total) * 100, 1)}%</a>; })}
            </div>
        </div>
    );
}

/// The loop's income over the period: neuron maturity and deposits into the ICP splitter, per day.
function LoopIncome({ period }) {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const entry = useSection('icpSplitter', period.key);
    const maturity = lineOf('icpSplitter', 'maturity', period.key);
    const deposits = lineOf('icpSplitter', 'deposits', period.key);
    const icpPrice = priceOf(ICP_LEDGER);
    const money = (e8s) => (icpPrice ? formatValue((Number(e8s) / 1e8) * icpPrice) : null);
    const days = new Map();
    for (const [key, l] of [['maturity', maturity], ['deposits', deposits]]) if (l) for (const [day, v] of l.byDay) { const d = days.get(day) || { day, maturity: 0, deposits: 0 }; d[key] += v; days.set(day, d); }
    const series = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
    const tile = (label, l, color, sub) => (
        <div style={{ background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
            <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
            {l ? (
                <>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(Number(l.total) / 1e8, 2)} ICP</div>
                    <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>{[money(l.total), `${l.n} tx`, l.cutAt ? `since ${new Date(l.cutAt).toISOString().slice(0, 10)} only` : null, sub].filter(Boolean).join(' · ')}</div>
                </>
            ) : <Spinner text={entry.progress || 'Reading the index…'} />}
        </div>
    );
    return (
        <section style={{ background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', color: theme.colors.primaryText }}>Into the loop</h2>
                    <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: 1.5 }}>
                        Product fees in ICP are paid into the ICP splitter's deposit account, next to the maturity of the DAO's 2-year neuron. The splitter sends them on to the SNEED buyback, the treasury and the neuron. Read from the ICP index; deposits also include ICP that anyone else sent there.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Link to={`/rll_ledger?period=${period.key}#icpSplitter`} style={{ color: theme.colors.accent, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>In the loop ledger <FaArrowRight size={10} /></Link>
                </div>
            </div>
            {entry.error && !entry.value && !entry.loading && <div style={{ color: theme.colors.error, marginTop: 10, fontSize: '0.85rem' }}>Could not read the index: {entry.error} <button type="button" onClick={() => loadSection('icpSplitter', period.key, { force: true }).catch(() => {})} style={{ background: 'none', border: 'none', color: theme.colors.accent, cursor: 'pointer' }}>Try again</button></div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginTop: 12 }}>
                {tile('Deposits: product fees and more', deposits, ICP_COLOR)}
                {tile('Neuron maturity', maturity, MATURITY_COLOR)}
                {tile('Together', deposits && maturity ? { total: deposits.total + maturity.total, n: deposits.n + maturity.n, cutAt: deposits.cutAt || maturity.cutAt } : null, theme.colors.primaryText)}
            </div>
            {series.length > 1 && (
                <div style={{ height: 200, marginTop: 14 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={theme.colors.border} strokeDasharray="3 3" />
                            <XAxis dataKey="day" tick={{ fontSize: 10, fill: theme.colors.mutedText }} tickFormatter={(v) => v.slice(5)} minTickGap={24} />
                            <YAxis tick={{ fontSize: 10, fill: theme.colors.mutedText }} width={44} tickFormatter={(v) => fmtNum(v, 1)} />
                            <Tooltip contentStyle={{ background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, k) => [`${fmtNum(v, 4)} ICP`, k]} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="deposits" name="Deposits" stackId="a" fill={ICP_COLOR} />
                            <Bar dataKey="maturity" name="Maturity" stackId="a" fill={MATURITY_COLOR} radius={[3, 3, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </section>
    );
}

export default function Revenue() {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const [params, setParams] = useSearchParams();
    const period = PERIODS.find((p) => p.key === params.get('period')) || PERIODS.find((p) => p.key === DEFAULT_PERIOD);
    useStoreVersion();
    useEffect(() => { loadAllProducts(); loadAllSources(); }, []);
    const totals = productTotals();
    const value = usdOf(totals.amounts);
    const revenue = revenueTotals();
    const revenueValue = usdOf(revenue.amounts);
    const sourcesRead = revenue.sources.every((x) => x.summary);
    const loading = PRODUCTS.some((p) => productEntry(p.id).loading) || SOURCES.some((src) => sourceEntry(src).loading);
    const refresh = () => { loadAllProducts({ force: true }); loadAllSources({ force: true }); };
    const productShares = PRODUCTS.map((p) => ({ p, s: productEntry(p.id).value }));
    const sourceShares = [...revenue.sources.map(({ src, summary }) => ({ p: src, s: summary })), { p: PRODUCTS_SOURCE, s: totals.loaded ? { amounts: totals.amounts } : null }];
    const card = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16 };
    return (
        <>
            <Header />
            <style>{'@keyframes rev-spin { to { transform: rotate(360deg); } } .rev-spin { animation: rev-spin 1s linear infinite; }'}</style>
            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ marginBottom: 12 }}>
                    <h1 style={{ margin: 0, fontSize: '1.6rem', color: theme.colors.primaryText }}>Revenue</h1>
                    <p style={{ margin: '4px 0 0', color: theme.colors.secondaryText, fontSize: '0.9rem', maxWidth: 680, lineHeight: 1.5 }}>
                        What Sneed DAO earns, from three sources: the maturity of its 2-year ICP neuron and the trading fees of its ICPSwap liquidity, read from the ledger, and the fees of its products, read live from each product's canister. All of it goes into the <Link to="/rll_info" style={{ color: theme.colors.accent }}>Recursive Liquidity Loop</Link>, which turns it into SNEED buybacks, burns, treasury and rewards for SNEED voters.
                    </p>
                </div>

                <section style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Revenue, all time</div>
                            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: theme.colors.primaryText, fontVariantNumeric: 'tabular-nums' }}>
                                {totals.loaded === totals.total && sourcesRead ? <Amounts amounts={revenue.amounts} /> : <Spinner text="Reading the ledger and the products…" />}
                            </div>
                            {totals.loaded === totals.total && sourcesRead && revenueValue.usd > 0 && <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>{formatValue(revenueValue.usd)}{revenueValue.complete ? '' : ' +'} at today's prices</div>}
                        </div>
                        <button type="button" disabled={loading} onClick={refresh} title="Read the ledger and the products again" style={{ background: 'transparent', border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.secondaryText, padding: '6px 10px', cursor: 'pointer' }}><FaSync className={loading ? 'rev-spin' : ''} /></button>
                    </div>
                    {totals.loaded === totals.total && sourcesRead && <div style={{ marginTop: 12 }}><ShareBar parts={sourceShares} /></div>}
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12, marginBottom: 16 }}>
                    {SOURCES.map((src) => <SourceCard key={src.id} src={src} />)}
                </div>

                <section id="products" style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Earned by the products, all time</div>
                            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: AMBER, fontVariantNumeric: 'tabular-nums' }}>
                                {totals.loaded ? <Amounts amounts={totals.amounts} /> : <Spinner text="Reading the products…" />}
                            </div>
                            {value.usd > 0 && <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>{formatValue(value.usd)}{value.complete ? '' : ' +'} at today's prices</div>}
                        </div>
                    </div>
                    {(totals.loaded < totals.total || totals.hidden.length > 0) && (
                        <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: 6 }}>
                            {totals.loaded < totals.total && `${totals.loaded} of ${totals.total} products read so far. `}
                            {totals.hidden.length > 0 && `Not counted yet: ${totals.hidden.map((p) => p.name).join(', ')} (totals still admin only).`}
                        </div>
                    )}
                    <div style={{ marginTop: 12 }}><ShareBar parts={productShares} /></div>
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12, marginBottom: 16 }}>
                    {PRODUCTS.map((p) => <ProductCard key={p.id} product={p} />)}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {PERIODS.map((p) => (
                        <button key={p.key} type="button" onClick={() => setParams({ period: p.key }, { replace: true })} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${p.key === period.key ? AMBER : theme.colors.border}`, background: p.key === period.key ? `${AMBER}22` : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.85rem' }}>{p.label}</button>
                    ))}
                </div>
                <LoopIncome period={period} />

                <div style={{ ...card, fontSize: '0.8rem', color: theme.colors.mutedText, lineHeight: 1.5, display: 'flex', gap: 8 }}>
                    <FaInfoCircle style={{ marginTop: 3, flexShrink: 0 }} />
                    <div>
                        The neuron's maturity and the LP's fees are read from the ledger, from their first transfer on. Product totals are each canister's own lifetime counters of the fees it charged, so they match no single period. Most fees are paid by the user straight into the loop, so the ledger cannot tell the products apart; it shows their sum among the deposits above. Sneedex's cut of a sale is paid in the token of the sale: ICP goes to the ICP splitter, SNEED to the SNEED splitter, other tokens to the Sneed DeFi canister. Values in your chosen denomination use today's prices, not the price on the day of each payment.
                        See the flows in the <Link to="/rll_info" style={{ color: theme.colors.accent }}>tokenomics diagram</Link> and every transfer in the <Link to="/rll_ledger" style={{ color: theme.colors.accent }}>loop ledger</Link>.
                    </div>
                </div>
            </div>
        </>
    );
}
