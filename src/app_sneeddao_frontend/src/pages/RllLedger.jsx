// /rll_ledger: the revenue loop's books. Four sections, each a set of flows
// read where they are visible on the ICP and SNEED indexes (see
// utils/rllLedger.js for how the pylons move money): totals, a per-day
// chart, where the output went against the configured shares, and the rows,
// collapsed to the latest few, each linking to the transaction browser.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { FaExternalLinkAlt, FaSpinner, FaSync, FaArrowDown, FaArrowUp, FaFire, FaInfoCircle } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { customStyles } from '../health/TreeView.jsx';
import { SECTIONS, ICP_LEDGER, SNEED_LEDGER, SNEED_ROOT, NEURON_2Y, PERIODS, DEFAULT_PERIOD, nameFor, isPylonMain, markStale } from '../utils/rllLedger';
import { useStoreVersion } from '../utils/revenueStore';
import { useSection, loadSection, loadPrice, priceOf, loadNeuron, peekNeuron, loadSplits, splitsEntry } from '../utils/revenueData';

const ICP_COLOR = '#4a90e2';
const SNEED_COLOR = '#2ecc71';
const BURN_COLOR = '#e74c3c';
const AMBER = '#f59e0b';
const DEC = 8;
const COLLAPSED_ROWS = 3;
const fmt = (v, max = 4) => (Number(v) / 10 ** DEC).toLocaleString('en-US', { maximumFractionDigits: max });
const fmtNum = (n, max = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: max });
const txUrl = (ledger, id) => `/transaction?ledger=${ledger}&id=${id.toString()}${ledger === SNEED_LEDGER ? `&sns=${SNEED_ROOT}` : ''}`;
const daysOf = (s) => Math.round(Number(s) / 86_400);
const colorOf = (token) => (token === 'SNEED' ? SNEED_COLOR : ICP_COLOR);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
// a line whose account was cut at its newest rows only covers the time since its oldest row read
const cutNote = (l) => (l.cutAt ? ` · since ${dayOf(l.cutAt)} only` : '');

function Counterparty({ cp, theme }) {
    if (!cp) return <span style={{ color: theme.colors.mutedText }}>—</span>;
    const name = nameFor(cp);
    if (cp.hex) return <span title={cp.hex} style={{ color: name ? theme.colors.primaryText : theme.colors.secondaryText }}>{name || `external account ${cp.hex.slice(0, 8)}…`}</span>;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {name && <span style={{ color: theme.colors.primaryText }}>{name}</span>}
            {!name && <PrincipalDisplay principal={Principal.fromText(cp.owner)} short={true} showCopyButton={false} style={{ fontSize: '0.78rem' }} />}
            {cp.sub && !name && <span title={cp.sub} style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: theme.colors.mutedText }}>·{cp.sub.slice(0, 6)}</span>}
        </span>
    );
}

/// One section of the loop: every account its lines need, filtered, summed, charted, listed. The
/// lines come from the shared cache, so /rll_info and /revenue reuse what this page read.
function Section({ section, period, prices, splits, children }) {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const entry = useSection(section.key, period.key);
    const data = entry.value ? { lines: entry.value } : null;
    const error = entry.error && !entry.loading ? entry.error : '';
    const progress = entry.progress || '';
    const sinceMs = period.ms ? Date.now() - period.ms : 0;
    const [showAll, setShowAll] = useState(false);
    const color = colorOf(section.token);
    const refresh = () => { markStale(section.lines.map((l) => l.account)); loadSection(section.key, period.key, { force: true }).catch(() => {}); };

    const price = (token) => prices[token];
    const money = (v, token) => { const p = price(token); return p == null ? null : formatValue((Number(v) / 10 ** DEC) * p); };
    const card = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16, scrollMarginTop: 80 };
    const label = { fontSize: '0.7rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' };
    const tile = (k, value, sub, c) => (
        <div key={k} style={{ background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
            <div style={label}>{k}</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: c || theme.colors.primaryText, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>{sub}</div>}
        </div>
    );

    const view = useMemo(() => {
        if (!data) return null;
        const main = data.lines.filter((l) => !l.aside && (l.token || section.token) === section.token);
        const ins = main.filter((l) => l.dir === 'in'); const outs = main.filter((l) => l.dir === 'out');
        const sumOf = (ls) => ls.reduce((a, l) => a + l.sum.total, 0n);
        const totalIn = sumOf(ins); const totalOut = sumOf(outs);
        const days = new Map();
        for (const l of main) for (const [day, v] of l.sum.byDay) { const d = days.get(day) || { day, in: 0, out: 0 }; d[l.dir] += v; days.set(day, d); }
        const series = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
        const allRows = data.lines.filter((l) => !l.aside).flatMap((l) => l.rows.map((r) => ({ ...r, line: l }))).sort((a, b) => b.at - a.at);
        const oldest = allRows.length ? allRows[allRows.length - 1].at : Date.now();
        const spanDays = Math.max(1, Math.round((Date.now() - (sinceMs || oldest)) / 86_400_000));
        const second = data.lines.find((l) => l.token && l.token !== section.token);
        const others = data.lines.filter((l) => !l.aside && l.token && l.token !== section.token);   // lines in a second token
        // The vector spends what it receives gradually (a fixed amount per interval), so SNEED bought
        // in a period was largely paid with ICP that arrived earlier: the average is only meaningful
        // over the whole history, read in full on both sides.
        let avg = null;
        if (second && !sinceMs && ![...ins, second].some((l) => l.cutAt) && totalIn > 0n && second.sum.total > 0n) avg = { price: Number(totalIn) / Number(second.sum.total) };
        return { ins, outs, others, totalIn, totalOut, series, allRows, spanDays, second, avg };
    }, [entry.value, section, period.key]); // eslint-disable-line react-hooks/exhaustive-deps

    const splitFor = (line) => (line.dest && splits ? splits.find((s) => s.key === line.dest.key && s.ledger === line.dest.ledger) : null);

    return (
        <section style={card} id={section.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />{section.title}</h2>
                    <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: 1.5 }}>{section.intro}</p>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <a href={section.link} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, whiteSpace: 'nowrap' }}>{section.linkLabel || 'the vector'} <FaExternalLinkAlt size={9} /></a>
                        {section.dashboard && <a href={section.dashboard} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, whiteSpace: 'nowrap' }}>the neuron <FaExternalLinkAlt size={9} /></a>}
                    </div>
                </div>
                <button type="button" onClick={refresh} disabled={entry.loading} title="Re-read from the index" style={{ background: 'transparent', border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.secondaryText, padding: '6px 10px', cursor: 'pointer' }}><FaSync className={entry.loading ? 'health-spin' : ''} /></button>
            </div>
            {children}
            {error && <div style={{ color: theme.colors.error, marginTop: 10 }}>Could not read the history: {error}</div>}
            {!data && !error && <div style={{ marginTop: 12, color: theme.colors.mutedText, fontSize: '0.85rem' }}><FaSpinner className="health-spin" /> Reading the indexes… {progress}</div>}
            {view && (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 12 }}>
                        {view.ins.map((l) => tile(l.title, `${fmt(l.sum.total)} ${section.token}`, `${money(l.sum.total, section.token) || ''}${l.sum.n ? ` · ${l.sum.n} tx` : ''}${cutNote(l)}`, color))}
                        {view.outs.map((l) => tile(l.title, `${fmt(l.sum.total)} ${l.token || section.token}`, `${money(l.sum.total, l.token || section.token) || ''}${l.sum.n ? ` · ${l.sum.n} tx` : ''}${cutNote(l)}`, l.burn ? BURN_COLOR : l.token ? colorOf(l.token) : undefined))}
                        {view.others.map((l) => tile(l.title, `${fmt(l.sum.total)} ${l.token}`, `${money(l.sum.total, l.token) || ''}${l.sum.n ? ` · ${l.sum.n} tx` : ''}${cutNote(l)}`, colorOf(l.token)))}
                        {view.ins.length > 1 && tile(`${section.token} in, total`, `${fmt(view.totalIn)} ${section.token}`, money(view.totalIn, section.token), color)}
                        {view.outs.filter((l) => !l.token).length > 1 && tile(`${section.token} out, total`, `${fmt(view.totalOut)} ${section.token}`, money(view.totalOut, section.token))}
                        {tile('Per day', `${fmtNum(Number(view.totalIn) / 10 ** DEC / view.spanDays, 4)} ${section.token}`, `in, over ${view.spanDays} day${view.spanDays === 1 ? '' : 's'}`)}
                        {view.second && section.key === 'buyback' && (view.avg
                            ? tile('Average price paid', `${fmtNum(view.avg.price, 6)} ICP / SNEED`, `all time, counting ICP not yet spent${prices.SNEED && prices.ICP ? ` · market now ${fmtNum(prices.SNEED / prices.ICP, 6)}` : ''}`)
                            : tile('Average price paid', '—', 'all time only: the vector spends its ICP gradually, so a shorter period does not match ICP to the SNEED it bought'))}
                    </div>
                    {section.virtual && section.virtual.map((v, i) => <div key={i} style={{ marginTop: 10, fontSize: '0.78rem', color: theme.colors.mutedText, display: 'flex', gap: 6, alignItems: 'flex-start' }}><FaInfoCircle style={{ marginTop: 2, flexShrink: 0 }} /> {v}</div>)}
                    {section.note && <div style={{ marginTop: 6, fontSize: '0.78rem', color: theme.colors.mutedText, display: 'flex', gap: 6, alignItems: 'flex-start' }}><FaInfoCircle style={{ marginTop: 2, flexShrink: 0 }} /> {section.note}</div>}
                    {view.outs.length > 1 && (
                        <div style={{ marginTop: 12 }}>
                            <div style={{ ...label, marginBottom: 6 }}>Where it went{splits ? ' (configured share in brackets)' : ''}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
                                {view.outs.filter((l) => !l.token).map((l) => {
                                    const share = view.totalOut > 0n ? Number(l.sum.total * 10000n / view.totalOut) / 100 : 0;
                                    const cfg = splitFor(l);
                                    return (
                                        <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderRadius: 8, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, fontSize: '0.8rem' }}>
                                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6, color: theme.colors.primaryText }}>{l.burn && <FaFire color={BURN_COLOR} size={11} />}{l.title}</span>
                                            <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: theme.colors.primaryText }}>{fmt(l.sum.total)} · {fmtNum(share, 1)}%{cfg ? <span style={{ color: theme.colors.mutedText }}> [{fmtNum(cfg.pct, 0)}%]</span> : ''}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {view.series.length > 1 && (
                        <div style={{ height: 200, marginTop: 14 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={view.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                    <CartesianGrid stroke={theme.colors.border} strokeDasharray="3 3" />
                                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: theme.colors.mutedText }} tickFormatter={(v) => v.slice(5)} minTickGap={24} />
                                    <YAxis tick={{ fontSize: 10, fill: theme.colors.mutedText }} width={48} tickFormatter={(v) => fmtNum(v, 2)} />
                                    <Tooltip contentStyle={{ background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, k) => [`${fmtNum(v, 4)} ${section.token}`, k]} />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                    <Bar dataKey="in" name={`${section.token} in`} fill={color} radius={[3, 3, 0, 0]} />
                                    {view.outs.some((l) => !l.token) && <Bar dataKey="out" name={`${section.token} out`} fill={theme.colors.mutedText} radius={[3, 3, 0, 0]} />}
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                    <div style={{ marginTop: 12, overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead><tr style={{ color: theme.colors.mutedText, textAlign: 'left' }}><th style={{ padding: '4px 6px' }}>When</th><th style={{ padding: '4px 6px' }}>Flow</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Amount</th><th style={{ padding: '4px 6px' }}>Counterparty</th><th style={{ padding: '4px 6px' }}>Tx</th></tr></thead>
                            <tbody>
                                {(showAll ? view.allRows : view.allRows.slice(0, COLLAPSED_ROWS)).map((r) => {
                                    const token = r.line.token || section.token;
                                    return (
                                        <tr key={`${r.line.key}:${r.id.toString()}`} className="health-row" style={{ borderTop: `1px solid ${theme.colors.border}` }}>
                                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap', color: theme.colors.secondaryText }}>{new Date(r.at).toLocaleString()}</td>
                                            <td style={{ padding: '5px 6px', color: theme.colors.secondaryText }}>{r.line.dir === 'in' ? <FaArrowDown color={color} title="in" /> : <FaArrowUp color={theme.colors.mutedText} title="out" />} {r.line.title}{r.kind === 'mint' && <span style={{ marginLeft: 4, fontSize: '0.7rem', color: AMBER }}>mint</span>}{r.kind === 'burn' && <span style={{ marginLeft: 4, fontSize: '0.7rem', color: BURN_COLOR }}>burn</span>}</td>
                                            <td style={{ padding: '5px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: theme.colors.primaryText, whiteSpace: 'nowrap' }}>{r.line.dir === 'out' ? '−' : '+'}{fmt(r.amount)} {token}{money(r.amount, token) ? <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText }}>{money(r.amount, token)}</div> : null}</td>
                                            <td style={{ padding: '5px 6px' }}>{r.kind === 'mint' ? <span style={{ color: theme.colors.primaryText }}>NNS (minted maturity)</span> : r.kind === 'burn' ? <span style={{ color: theme.colors.primaryText }}>burned</span> : isPylonMain(r.cp) && r.line.dir === 'in' && section.key !== 'neuron' ? <span style={{ color: theme.colors.primaryText }}>{nameFor(r.cp)} (for {section.key === 'buyback' ? 'the ICP splitter' : section.key === 'sneedSplitter' ? 'the buyback' : 'a node'})</span> : <Counterparty cp={r.cp} theme={theme} />}</td>
                                            <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}><Link to={txUrl(r.line.account.ledger, r.id)} style={{ color: theme.colors.accent }}>#{r.id.toString()}</Link></td>
                                        </tr>
                                    );
                                })}
                                {view.allRows.length === 0 && <tr><td colSpan={5} style={{ padding: 10, color: theme.colors.mutedText }}>No transactions in this period.</td></tr>}
                            </tbody>
                        </table>
                        {view.allRows.length > COLLAPSED_ROWS && <button type="button" onClick={() => setShowAll((v) => !v)} style={{ marginTop: 8, background: 'none', border: 'none', color: theme.colors.accent, cursor: 'pointer', fontSize: '0.8rem' }}>{showAll ? `Show the latest ${COLLAPSED_ROWS}` : `Show all ${view.allRows.length}`}</button>}
                    </div>
                </>
            )}
        </section>
    );
}

function RllLedger() {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const [params, setParams] = useSearchParams();
    const { hash } = useLocation();
    // A link to a section (/rll_ledger#lpFees): scroll to it, and again while the sections above it
    // fill in and push it down, until the reader scrolls on their own.
    useEffect(() => {
        const id = decodeURIComponent(hash.replace(/^#/, ''));
        if (!id) return undefined;
        const go = () => document.getElementById(id)?.scrollIntoView({ block: 'start' });
        const timers = [0, 400, 1200, 2500, 4000].map((ms) => setTimeout(go, ms));
        const stop = () => timers.forEach(clearTimeout);
        const events = ['wheel', 'touchstart', 'keydown', 'mousedown'];
        events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }));
        return () => { stop(); events.forEach((e) => window.removeEventListener(e, stop)); };
    }, [hash]);
    const period = PERIODS.find((p) => p.key === params.get('period')) || PERIODS.find((p) => p.key === DEFAULT_PERIOD);
    // prices, the neuron and the splits come from the shared cache (also used by /rll_info and /revenue)
    useStoreVersion();
    useEffect(() => {
        loadPrice(ICP_LEDGER).catch(() => {});
        loadPrice(SNEED_LEDGER).catch(() => {});
        loadNeuron().catch(() => {});
        for (const s of SECTIONS) if (s.splitsNode) loadSplits(s.splitsNode).catch(() => {});
    }, []);
    const prices = { ICP: priceOf(ICP_LEDGER), SNEED: priceOf(SNEED_LEDGER) };
    const neuronEntry = peekNeuron();
    const neuron = neuronEntry.value || null;
    const neuronError = !neuron && neuronEntry.error ? neuronEntry.error : '';
    const splits = Object.fromEntries(SECTIONS.filter((s) => s.splitsNode && splitsEntry(s.splitsNode).value).map((s) => [s.key, splitsEntry(s.splitsNode).value]));
    const card = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16 };
    const stake = neuron ? Number(neuron.stake_e8s) / 1e8 : null;
    return (
        <>
            <Header />
            <style>{customStyles}</style>
            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.6rem', color: theme.colors.primaryText }}>Revenue loop ledger</h1>
                        <p style={{ margin: '4px 0 0', color: theme.colors.secondaryText, fontSize: '0.9rem', maxWidth: 640, lineHeight: 1.5 }}>
                            What actually moved through the <Link to="/rll_info" style={{ color: theme.colors.accent }}>Recursive Liquidity Loop</Link>, read from the ICP and SNEED index canisters at the accounts where each flow is visible. Every row links to the transaction browser.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {PERIODS.map((p) => (
                            <button key={p.key} type="button" onClick={() => setParams({ period: p.key })} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${p.key === period.key ? AMBER : theme.colors.border}`, background: p.key === period.key ? `${AMBER}22` : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.85rem' }}>{p.label}</button>
                        ))}
                    </div>
                </div>
                <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.8rem', marginBottom: 12 }}>
                    {SECTIONS.map((s) => <a key={s.key} href={`#${s.key}`} style={{ color: theme.colors.accent, textDecoration: 'none', padding: '4px 10px', borderRadius: 8, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}` }}>{s.title}</a>)}
                </nav>

                {SECTIONS.map((s) => (
                    <Section key={s.key} section={s} period={period} prices={prices} splits={splits[s.key] || null}>
                        {s.key === 'neuron' && (
                            <div style={{ marginTop: 10 }}>
                                {neuronError && <div style={{ color: theme.colors.error, fontSize: '0.85rem' }}>Could not read the neuron: {neuronError}</div>}
                                {neuron && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                                        {[
                                            ['Stake', `${fmtNum(stake, 2)} ICP`, prices.ICP ? formatValue(stake * prices.ICP) : null],
                                            ['Dissolve delay', `${daysOf(neuron.dissolve_delay_seconds)} days`, neuron.state === 1 ? 'locked' : neuron.state === 2 ? 'dissolving' : neuron.state === 3 ? 'dissolved' : ''],
                                            ['Age', `${daysOf(neuron.age_seconds)} days`, null],
                                            ['Voting power', fmtNum(Number(neuron.voting_power) / 1e8, 0), null],
                                            ['Neuron', <a key="n" href={`https://dashboard.internetcomputer.org/neuron/${NEURON_2Y}`} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, fontSize: '0.85rem' }}>{NEURON_2Y.toString().slice(0, 8)}… <FaExternalLinkAlt size={9} /></a>, 'on the NNS dashboard'],
                                        ].map(([l, v, sub]) => (
                                            <div key={l} style={{ background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '10px 12px' }}>
                                                <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{l}</div>
                                                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: theme.colors.primaryText }}>{v}</div>
                                                {sub && <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>{sub}</div>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </Section>
                ))}

                <div style={{ ...card, fontSize: '0.8rem', color: theme.colors.mutedText, lineHeight: 1.5 }}>
                    Each flow is read at the account where it is visible: the neuron's maturity account for the mints, the buyback's and the treasury's accounts for the ICP splitter's outputs, the SNEED splitter's account for what the buybacks bought, and the pylon's main SNEED account for the burns and the treasury and RLL transfers. Transfers between nodes of the same pylon never reach the ledger. An account with more than 6,000 transactions in the period is cut at the newest 6,000: its totals then say "since" the oldest day read, and the SNEED splitter's deposit account is always read in full, and the buyback's average price is shown for all time only. Values in your chosen denomination use today's prices, not the price at the time of each transfer.
                </div>
            </div>
        </>
    );
}

export default RllLedger;
