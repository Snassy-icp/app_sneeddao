// /rll_ledger: the revenue loop's books. For each station (the 2-year ICP
// neuron's vector, the ICP splitter, the SNEED buyback vector, the SNEED
// splitter) the history read from the index canisters: totals, averages,
// a per-day chart, and the rows, each linking to the transaction browser.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { FaExternalLinkAlt, FaSpinner, FaSync, FaArrowDown, FaArrowUp, FaFire } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { get_token_conversion_rate } from '../utils/TokenUtils';
import { customStyles } from '../health/TreeView.jsx';
import { STATIONS, ICP_LEDGER, SNEED_LEDGER, SNEED_ROOT, GOVERNANCE, NEURON_2Y, fetchStationHistory, fetchNeuron, fetchSplits, summarize, nameFor } from '../utils/rllLedger';

const ICP_COLOR = '#4a90e2';
const SNEED_COLOR = '#2ecc71';
const BURN_COLOR = '#e74c3c';
const AMBER = '#f59e0b';
const DEC = { ICP: 8, SNEED: 8 };
const PERIODS = [{ key: '30', label: '30 days', ms: 30 * 86_400_000 }, { key: '90', label: '90 days', ms: 90 * 86_400_000 }, { key: '365', label: '1 year', ms: 365 * 86_400_000 }, { key: 'all', label: 'All time', ms: 0 }];
const fmt = (v, d = 8, max = 4) => (Number(v) / 10 ** d).toLocaleString('en-US', { maximumFractionDigits: max });
const fmtNum = (n, max = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: max });
const txUrl = (ledger, id) => `/transaction?ledger=${ledger}&id=${id.toString()}${ledger === SNEED_LEDGER ? `&sns=${SNEED_ROOT}` : ''}`;
const daysOf = (s) => Math.round(Number(s) / 86_400);

function Counterparty({ cp, theme }) {
    if (!cp) return <span style={{ color: theme.colors.mutedText }}>—</span>;
    const name = nameFor(cp);
    if (cp.hex) return <span title={cp.hex} style={{ color: name ? theme.colors.primaryText : theme.colors.secondaryText }}>{name || `${cp.hex.slice(0, 8)}…${cp.hex.slice(-6)}`}</span>;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {name && <span style={{ color: theme.colors.primaryText }}>{name}</span>}
            <PrincipalDisplay principal={Principal.fromText(cp.owner)} short={true} showCopyButton={false} style={{ fontSize: '0.78rem' }} />
            {cp.sub && !name && <span title={cp.sub} style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: theme.colors.mutedText }}>·{cp.sub.slice(0, 6)}</span>}
        </span>
    );
}

/// One station's ledger: fetches, summarises, charts and lists.
function StationLedger({ station, ledger, token, sinceMs, prices, title, intro, color, split, children }) {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const [rows, setRows] = useState(null);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState('');
    const [showAll, setShowAll] = useState(false);
    const [tick, setTick] = useState(0);
    const d = DEC[token];
    useEffect(() => {
        let alive = true;
        setRows(null); setError(''); setProgress(0);
        fetchStationHistory(station.key, ledger, sinceMs, (n) => { if (alive) setProgress(n); })
            .then((r) => { if (alive) setRows(r); })
            .catch((e) => { if (alive) setError(e?.message || String(e)); });
        return () => { alive = false; };
    }, [station.key, ledger, sinceMs, tick]);
    const sum = useMemo(() => (rows ? summarize(rows, d, sinceMs) : null), [rows, d, sinceMs]);
    const price = prices[token];
    const usd = (v) => (price != null ? (Number(v) / 10 ** d) * price : null);
    const money = (v) => { const u = usd(v); return u == null ? null : formatValue(u); };
    const card = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16 };
    const tile = (label, value, sub, c) => (
        <div key={label} style={{ background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
            <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: c || theme.colors.primaryText, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>{sub}</div>}
        </div>
    );
    const shown = rows ? (showAll ? rows : rows.slice(0, 25)) : [];
    return (
        <section style={card} id={station.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />{title}</h2>
                    <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: 1.5 }}>{intro}</p>
                    <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{station.account}</span>
                        <a href={station.link} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, whiteSpace: 'nowrap' }}>vector <FaExternalLinkAlt size={9} /></a>
                    </div>
                </div>
                <button type="button" onClick={() => setTick((t) => t + 1)} title="Re-read from the index" style={{ background: 'transparent', border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.secondaryText, padding: '6px 10px', cursor: 'pointer' }}><FaSync className={rows === null && !error ? 'health-spin' : ''} /></button>
            </div>
            {children}
            {error && <div style={{ color: theme.colors.error, marginTop: 10 }}>Could not read the history: {error}</div>}
            {rows === null && !error && <div style={{ marginTop: 12, color: theme.colors.mutedText, fontSize: '0.85rem' }}><FaSpinner className="health-spin" /> Reading the index… {progress ? `${progress} rows so far` : ''}</div>}
            {sum && (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 12 }}>
                        {tile(`${token} in`, `${fmt(sum.in, d)} ${token}`, money(sum.in), color)}
                        {tile(`${token} out`, `${fmt(sum.out, d)} ${token}`, money(sum.out))}
                        {tile('Net', `${sum.in >= sum.out ? '+' : '−'}${fmt(sum.in >= sum.out ? sum.in - sum.out : sum.out - sum.in, d)} ${token}`, `${sum.nIn} in · ${sum.nOut} out`)}
                        {tile('Per day', `${fmtNum(Number(sum.in) / 10 ** d / sum.spanDays, 4)} ${token}`, `in, over ${sum.spanDays} day${sum.spanDays === 1 ? '' : 's'}`)}
                        {tile('Fees paid', `${fmt(sum.fees, d, 6)} ${token}`, `${sum.nOut} transfer${sum.nOut === 1 ? '' : 's'}`)}
                    </div>
                    {sum.byCp.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Where it went{split ? ' (configured share in brackets)' : ''}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
                                {sum.byCp.map((c, i) => {
                                    const share = sum.out > 0n ? Number(c.amount * 10000n / sum.out) / 100 : 0;
                                    const cfg = split?.find((s) => (c.cp?.hex ? false : `${s.owner}:${s.sub}` === `${c.cp?.owner}:${c.cp?.sub || ''}`) || (nameFor(c.cp) && nameFor(c.cp) === s.name));
                                    const n = nameFor(c.cp) || '';
                                    const isBurn = c.cp && !c.cp.hex && c.cp.owner === GOVERNANCE && !c.cp.sub && token === 'SNEED';
                                    return (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderRadius: 8, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, fontSize: '0.8rem' }}>
                                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>{isBurn && <FaFire color={BURN_COLOR} size={11} />}{isBurn ? 'Burned (sent to the minting account)' : <Counterparty cp={c.cp} theme={theme} />}</span>
                                            <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: theme.colors.primaryText }}>{fmt(c.amount, d)} · {fmtNum(share, 1)}%{cfg ? <span style={{ color: theme.colors.mutedText }}> [{fmtNum(cfg.pct, 0)}%]</span> : ''}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {sum.days.length > 1 && (
                        <div style={{ height: 200, marginTop: 14 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={sum.days} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                    <CartesianGrid stroke={theme.colors.border} strokeDasharray="3 3" />
                                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: theme.colors.mutedText }} tickFormatter={(v) => v.slice(5)} minTickGap={24} />
                                    <YAxis tick={{ fontSize: 10, fill: theme.colors.mutedText }} width={48} tickFormatter={(v) => fmtNum(v, 2)} />
                                    <Tooltip contentStyle={{ background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, k) => [`${fmtNum(v, 4)} ${token}`, k]} />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                    <Bar dataKey="in" name={`${token} in`} fill={color} radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="out" name={`${token} out`} fill={theme.colors.mutedText} radius={[3, 3, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                    <div style={{ marginTop: 12, overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead><tr style={{ color: theme.colors.mutedText, textAlign: 'left' }}><th style={{ padding: '4px 6px' }}>When</th><th style={{ padding: '4px 6px' }}></th><th style={{ padding: '4px 6px', textAlign: 'right' }}>{token}</th><th style={{ padding: '4px 6px' }}>Counterparty</th><th style={{ padding: '4px 6px' }}>Tx</th></tr></thead>
                            <tbody>
                                {shown.map((r) => (
                                    <tr key={r.id.toString()} className="health-row" style={{ borderTop: `1px solid ${theme.colors.border}` }}>
                                        <td style={{ padding: '5px 6px', whiteSpace: 'nowrap', color: theme.colors.secondaryText }}>{new Date(r.at).toLocaleString()}</td>
                                        <td style={{ padding: '5px 6px' }}>{r.dir === 'in' ? <FaArrowDown color={color} title="in" /> : r.dir === 'out' ? <FaArrowUp color={theme.colors.mutedText} title="out" /> : '↔'}{r.kind === 'mint' && <span style={{ marginLeft: 4, fontSize: '0.7rem', color: AMBER }}>mint</span>}{r.kind === 'burn' && <span style={{ marginLeft: 4, fontSize: '0.7rem', color: BURN_COLOR }}>burn</span>}</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: theme.colors.primaryText, whiteSpace: 'nowrap' }}>{r.dir === 'out' ? '−' : '+'}{fmt(r.amount, d)}{money(r.amount) ? <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText }}>{money(r.amount)}</div> : null}</td>
                                        <td style={{ padding: '5px 6px' }}><Counterparty cp={r.cp} theme={theme} /></td>
                                        <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}><Link to={txUrl(ledger, r.id)} style={{ color: theme.colors.accent }}>#{r.id.toString()}</Link></td>
                                    </tr>
                                ))}
                                {rows.length === 0 && <tr><td colSpan={5} style={{ padding: 10, color: theme.colors.mutedText }}>No transactions in this period.</td></tr>}
                            </tbody>
                        </table>
                        {rows.length > 25 && <button type="button" onClick={() => setShowAll((v) => !v)} style={{ marginTop: 8, background: 'none', border: 'none', color: theme.colors.accent, cursor: 'pointer', fontSize: '0.8rem' }}>{showAll ? 'Show the latest 25' : `Show all ${rows.length}`}</button>}
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
    const period = PERIODS.find((p) => p.key === params.get('period')) || PERIODS[1];
    const sinceMs = period.ms ? Date.now() - period.ms : 0;
    const [prices, setPrices] = useState({});
    const [neuron, setNeuron] = useState(null);
    const [neuronError, setNeuronError] = useState('');
    const [splits, setSplits] = useState({});
    useEffect(() => {
        get_token_conversion_rate(ICP_LEDGER, 8).then((p) => setPrices((x) => ({ ...x, ICP: p ? Number(p) : null }))).catch(() => {});
        get_token_conversion_rate(SNEED_LEDGER, 8).then((p) => setPrices((x) => ({ ...x, SNEED: p ? Number(p) : null }))).catch(() => {});
        fetchNeuron().then(setNeuron).catch((e) => setNeuronError(e?.message || String(e)));
        for (const k of ['icpSplitter', 'sneedSplitter']) fetchSplits(k).then((s) => setSplits((x) => ({ ...x, [k]: s }))).catch(() => {});
    }, []);
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
                            What actually moved through the <Link to="/rll_info" style={{ color: theme.colors.accent }}>Recursive Liquidity Loop</Link>, read straight from the ICP and SNEED index canisters. Every row links to the transaction browser.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {PERIODS.map((p) => (
                            <button key={p.key} type="button" onClick={() => setParams({ period: p.key })} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${p.key === period.key ? AMBER : theme.colors.border}`, background: p.key === period.key ? `${AMBER}22` : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.85rem' }}>{p.label}</button>
                        ))}
                    </div>
                </div>
                <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.8rem', marginBottom: 12 }}>
                    {[['neuron', '1 · Neuron'], ['icpSplitter', '2 · ICP splitter'], ['buyback', '3 · Buyback'], ['sneedSplitter', '4 · SNEED splitter']].map(([k, l]) => <a key={k} href={`#${k}`} style={{ color: theme.colors.accent, textDecoration: 'none', padding: '4px 10px', borderRadius: 8, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}` }}>{l}</a>)}
                </nav>

                <StationLedger station={STATIONS.neuron} ledger={ICP_LEDGER} token="ICP" sinceMs={sinceMs} prices={prices} color={ICP_COLOR}
                    title="1 · The 2-year ICP neuron"
                    intro="The DAO's NNS neuron, controlled by a Neutrinite vector. Its maturity is disbursed as ICP into the vector's account (the mints below) and forwarded to the ICP splitter.">
                    <div style={{ marginTop: 10 }}>
                        {neuronError && <div style={{ color: theme.colors.error, fontSize: '0.85rem' }}>Could not read the neuron: {neuronError}</div>}
                        {neuron && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                                {[
                                    ['Stake', `${fmtNum(stake, 2)} ICP`, prices.ICP ? formatValue(stake * prices.ICP) : null],
                                    ['Dissolve delay', `${daysOf(neuron.dissolve_delay_seconds)} days`, neuron.state === 1 ? 'locked' : neuron.state === 2 ? 'dissolving' : neuron.state === 3 ? 'dissolved' : ''],
                                    ['Age', `${daysOf(neuron.age_seconds)} days`, null],
                                    ['Voting power', fmtNum(Number(neuron.voting_power) / 1e8, 0), null],
                                    ['Neuron', <a key="n" href={STATIONS.neuron.dashboard} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent, fontSize: '0.85rem' }}>{NEURON_2Y.toString().slice(0, 8)}… <FaExternalLinkAlt size={9} /></a>, 'on the NNS dashboard'],
                                ].map(([l, v, s]) => (
                                    <div key={l} style={{ background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '10px 12px' }}>
                                        <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{l}</div>
                                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: theme.colors.primaryText }}>{v}</div>
                                        {s && <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText }}>{s}</div>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </StationLedger>

                <StationLedger station={STATIONS.icpSplitter} ledger={ICP_LEDGER} token="ICP" sinceMs={sinceMs} prices={prices} color={ICP_COLOR} split={splits.icpSplitter}
                    title="2 · The ICP splitter"
                    intro="Takes the neuron's maturity (and any other ICP revenue sent here) and splits it by the configured shares: most of it to the SNEED buyback vector, the rest to the treasury." />

                <StationLedger station={STATIONS.buyback} ledger={ICP_LEDGER} token="ICP" sinceMs={sinceMs} prices={prices} color={ICP_COLOR}
                    title="3 · The SNEED buyback vector — ICP side"
                    intro="ICP arriving from the splitter is spent on the SNEED/ICP pool. Outflows here are the swaps." />
                <StationLedger station={STATIONS.buyback} ledger={SNEED_LEDGER} token="SNEED" sinceMs={sinceMs} prices={prices} color={SNEED_COLOR}
                    title="3 · The SNEED buyback vector — SNEED side"
                    intro="The SNEED bought with that ICP lands in the same account and is forwarded to the SNEED splitter. Inflows here are what the buybacks got." />

                <StationLedger station={STATIONS.sneedSplitter} ledger={SNEED_LEDGER} token="SNEED" sinceMs={sinceMs} prices={prices} color={SNEED_COLOR} split={splits.sneedSplitter}
                    title="4 · The SNEED splitter"
                    intro="Splits the bought SNEED by the configured shares: burned (sent to the ledger's minting account, which destroys it), kept in the DAO treasury, and paid to the RLL rewards canister for voters." />

                <div style={{ ...card, fontSize: '0.8rem', color: theme.colors.mutedText, lineHeight: 1.5 }}>
                    Amounts are read from the ICP index and the SNEED index for each station's account; a station that has moved more than 4,000 transactions in the period is cut off at the oldest 4,000. Values in your chosen denomination use today's prices, not the price at the time of each transfer.
                </div>
            </div>
        </>
    );
}

export default RllLedger;
