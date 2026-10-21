// /rll: the voting rewards of the RLL canister (public/api-docs/rll.md). What the rewards are,
// the headline statistics, the signed-in user's claimable balances, claim button and history,
// the history of distributions (paged, newest first) and the ICRC-3 activity log.
// Other users' claims are not listed here; admins find the claim log, the canister's status and
// its tools on /admin/rll.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { FaGift, FaSpinner, FaSync, FaChartBar, FaWallet, FaHistory, FaInfoCircle, FaExternalLinkAlt } from 'react-icons/fa';
import Header from './components/Header';
import Pager from './components/Pager';
import RllActivityCard from './components/RllActivityCard';
import ConfirmationModal from './ConfirmationModal';
import Notification from './Notification';
import { useAuth } from './AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { useDenomination } from './contexts/DenominationContext';
import { useNaming } from './NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from './utils/PrincipalUtils';
import { fetchUserNeuronsForSns } from './utils/NeuronUtils';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { useStoreVersion } from './utils/revenueStore';
import { loadTokenMeta, loadPrice, tokenMeta, priceOf, fmtAmount } from './utils/revenueData';
import { rllActor, rllCanisterId, RLL_HOST, loadEventStatistics, distributionSource, groupClaims, isInstructionLimit, fmtNs } from './utils/rllApi';

const AMBER = '#f59e0b';
const SNEED_GOVERNANCE = 'fi3zi-fyaaa-aaaaq-aachq-cai';
const PAGE_SIZE = 20;

const textOf = (p) => (typeof p === 'string' ? p : p.toText());
const want = (ledger) => { loadTokenMeta(ledger).catch(() => {}); loadPrice(ledger).catch(() => {}); };
/// The value of an amount in the chosen denomination, or null while the price is unknown.
function useMoney() {
    const { formatValue } = useDenomination();
    return useCallback((amount, ledger) => {
        const meta = tokenMeta(ledger); const p = priceOf(ledger);
        if (!meta || p == null || amount == null) return null;
        return formatValue((Number(amount) / 10 ** meta.decimals) * p);
    }, [formatValue]);
}
const usdOfAmount = (amount, ledger) => {
    const meta = tokenMeta(ledger); const p = priceOf(ledger);
    return meta && p != null ? (Number(amount) / 10 ** meta.decimals) * p : 0;
};

function Who({ principal }) {
    const { theme } = useTheme();
    const naming = useNaming();
    let p = null;
    try { p = typeof principal === 'string' ? Principal.fromText(principal) : principal; } catch { /* not a principal */ }
    if (!p) return <span>{String(principal)}</span>;
    const info = naming ? getPrincipalDisplayInfoFromContext(p, naming.principalNames, naming.principalNicknames, naming.verifiedNames, naming.principalCanisterTypes) : null;
    return <PrincipalDisplay principal={p} displayInfo={info} short showCopyButton={false} style={{ color: theme.colors.primaryText }} />;
}

function Spinner({ text }) {
    const { theme } = useTheme();
    return <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}><FaSpinner className="rll-spin" /> {text}</span>;
}

function Card({ title, icon, right, children, id }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <section id={id} style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 8 }}>{icon} {title}</h2>
                {right}
            </div>
            {children}
        </section>
    );
}

function RefreshButton({ loading, onClick, title }) {
    const { theme } = useTheme();
    return (
        <button type="button" disabled={loading} onClick={onClick} title={title} style={{ background: 'transparent', border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.secondaryText, padding: '4px 8px', cursor: 'pointer' }}>
            <FaSync className={loading ? 'rll-spin' : ''} />
        </button>
    );
}

/// Amounts per token as a wrapped list, largest value first: "12.3 SNEED · 0.5 ICP".
function TokenAmounts({ list, max = 2, limit = 6 }) {
    const { theme } = useTheme();
    const [all, setAll] = useState(false);
    useStoreVersion();
    const sorted = [...list].filter(([, a]) => a > 0n).sort((x, y) => usdOfAmount(y[1], y[0]) - usdOfAmount(x[1], x[0]));
    if (!sorted.length) return <span style={{ color: theme.colors.mutedText }}>None</span>;
    const shown = all ? sorted : sorted.slice(0, limit);
    return (
        <span>
            {shown.map(([ledger, amount], i) => <React.Fragment key={ledger}>{i > 0 && ' · '}<span style={{ whiteSpace: 'nowrap' }}>{fmtAmount(amount, ledger, max)}</span></React.Fragment>)}
            {sorted.length > limit && (
                <button type="button" onClick={() => setAll(!all)} style={{ background: 'none', border: 'none', color: theme.colors.accent, cursor: 'pointer', fontSize: '0.8rem', marginLeft: 6 }}>
                    {all ? 'fewer' : `+${sorted.length - limit} more`}
                </button>
            )}
        </span>
    );
}

const perToken = (pairs) => pairs.map(([p, a]) => [textOf(p), a]);
const valueOf = (list) => list.reduce((s, [l, a]) => s + usdOfAmount(a, l), 0);

// ---- statistics ----

function Statistics({ distributionCount }) {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const c = theme.colors;
    useStoreVersion();
    const [state, setState] = useState({ loading: true });
    const load = useCallback(async () => {
        setState((s) => ({ ...s, loading: true }));
        const r = await loadEventStatistics();
        let totals = null;
        if (!r.stats) {
            // without the statistics, the all-time totals per token still come from their own query
            try { totals = perToken(await rllActor().get_total_distributions()); } catch { /* shown as missing */ }
        }
        const s = r.stats;
        const ledgers = s ? [...s.all_time.server_distributions.per_token, ...s.all_time.claims.per_token, ...s.last_24h.server_distributions.per_token] : (totals || []);
        ledgers.forEach(([l]) => want(textOf(l)));
        setState({ loading: false, ...r, totals });
    }, []);
    useEffect(() => { load(); }, [load]);

    const tile = (label, value, sub, color) => (
        <div style={{ background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
            <div style={{ fontSize: '0.7rem', color: c.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: color || c.primaryText, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.72rem', color: c.mutedText, marginTop: 2 }}>{sub}</div>}
        </div>
    );
    const s = state.stats;
    const distributed = s ? perToken(s.all_time.server_distributions.per_token) : state.totals;
    const claimed = s ? perToken(s.all_time.claims.per_token) : null;
    const last24 = s ? perToken(s.last_24h.server_distributions.per_token) : null;
    const distributedUsd = distributed ? valueOf(distributed) : 0;
    const n = (x) => Number(x).toLocaleString();

    return (
        <Card title="Statistics" icon={<FaChartBar size={15} />} right={<RefreshButton loading={state.loading} onClick={load} title="Read the statistics again" />}>
            {state.loading && !s && !state.totals && <Spinner text="Reading the statistics…" />}
            {state.fixing && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.82rem', color: c.secondaryText, background: `${AMBER}14`, border: `1px solid ${AMBER}55`, borderRadius: 10, padding: '8px 10px', marginBottom: 12 }}>
                    <FaInfoCircle style={{ marginTop: 3, flexShrink: 0, color: AMBER }} />
                    <span>Statistics are being fixed (proposal #444): the canister&apos;s history outgrew the old way of counting it. Until the upgrade, the totals per token below come from a separate query.</span>
                </div>
            )}
            {state.error && <div style={{ fontSize: '0.82rem', color: c.error, marginBottom: 10 }}>Could not read the statistics: {state.error}</div>}
            {distributed && (
                <>
                    <div style={{ fontSize: '0.7rem', color: c.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Distributed, all time</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: AMBER, fontVariantNumeric: 'tabular-nums', lineHeight: 1.4 }}><TokenAmounts list={distributed} /></div>
                    {distributedUsd > 0 && <div style={{ fontSize: '0.82rem', color: c.secondaryText }}>{formatValue(distributedUsd)} at today&apos;s prices</div>}
                </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 12 }}>
                {s ? (
                    <>
                        {tile('Distributions', n(s.all_time.server_distributions.total), 'one per token per daily cycle')}
                        {tile('Owners rewarded', n(s.all_time.user_distributions.unique_users), `${n(s.all_time.user_distributions.total)} credits`)}
                        {tile('Claims paid', n(s.all_time.claims.successful), `by ${n(s.all_time.claims.unique_users)} principals`, c.success)}
                        {tile('Last 24 hours', n(s.last_24h.server_distributions.total) + ' distributions', `${n(s.last_24h.claims.successful)} claims paid`)}
                    </>
                ) : (
                    distributionCount != null && tile('Distributions', n(distributionCount), 'one per token per daily cycle')
                )}
            </div>
            {claimed && claimed.length > 0 && (
                <div style={{ fontSize: '0.82rem', color: c.secondaryText, marginTop: 12, lineHeight: 1.5 }}>
                    <span style={{ color: c.mutedText }}>Claimed, all time: </span><TokenAmounts list={claimed} />
                </div>
            )}
            {last24 && last24.length > 0 && (
                <div style={{ fontSize: '0.82rem', color: c.secondaryText, marginTop: 4, lineHeight: 1.5 }}>
                    <span style={{ color: c.mutedText }}>Distributed in the last 24 hours: </span><TokenAmounts list={last24} />
                </div>
            )}
        </Card>
    );
}

// ---- the signed-in user's rewards ----

const STATUS_COLOR = (c) => ({ Success: c.success, Failed: c.error, Pending: c.warning });

function StatusBadge({ status }) {
    const { theme } = useTheme();
    const color = STATUS_COLOR(theme.colors)[status] || theme.colors.mutedText;
    const label = status === 'Success' ? 'Paid' : status === 'Failed' ? 'Failed' : 'Pending';
    return <span style={{ fontSize: '0.7rem', fontWeight: 700, color, border: `1px solid ${color}66`, background: `${color}18`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>{label}</span>;
}

function Tabs({ tabs, value, onChange }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={t.key === value} onClick={() => onChange(t.key)}
                    style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.key === value ? AMBER : c.border}`, background: t.key === value ? `${AMBER}22` : 'transparent', color: c.primaryText, cursor: 'pointer', fontSize: '0.85rem' }}>
                    {t.label}
                </button>
            ))}
        </div>
    );
}

const rowStyle = (c) => ({ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, rowGap: 2, fontSize: '0.82rem', padding: '7px 10px', borderRadius: 8, background: c.secondaryBg });

function YourRewards() {
    const { identity, isAuthenticated, login } = useAuth();
    const { theme } = useTheme();
    const c = theme.colors;
    const money = useMoney();
    const { formatValue } = useDenomination();
    useStoreVersion();
    const [state, setState] = useState({ loading: false });
    const [fees, setFees] = useState({});
    const [claiming, setClaiming] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [notification, setNotification] = useState(null);
    const [tab, setTab] = useState('received');
    const [page, setPage] = useState(0);

    const load = useCallback(async () => {
        if (!identity) return;
        setState((s) => ({ ...s, loading: true, error: null }));
        try {
            const me = identity.getPrincipal();
            const rll = rllActor(identity);
            const neurons = await fetchUserNeuronsForSns(identity, SNEED_GOVERNANCE);
            const [balances, vp, claimEvents] = await Promise.all([
                rll.balances_of_hotkey_neurons(neurons),
                rll.get_hotkey_voting_power(neurons),
                rll.get_claim_events_for_hotkey(me),
            ]);
            const owners = vp.neurons_by_owner.map(([p]) => p);
            const claims = groupClaims(claimEvents);
            const bal = perToken(balances);
            bal.forEach(([l]) => want(l));
            claims.forEach((x) => want(x.token));
            setState({ loading: false, neurons: neurons.length, owners, balances: bal, vp, claims, history: null, historyError: null });
            // the credits of every owner whose neuron this principal is on (one query per owner)
            try {
                const lists = await Promise.all(owners.map((o) => rll.get_user_specific_distribution_events(o)));
                const history = lists.flat().sort((a, b) => (a.timestamp > b.timestamp ? -1 : a.timestamp < b.timestamp ? 1 : 0));
                new Set(history.map((e) => e.token_id.toText())).forEach(want);
                setState((s) => ({ ...s, history }));
            } catch (e) {
                setState((s) => ({ ...s, historyError: isInstructionLimit(e) ? 'Your reward history can be read after the RLL upgrade of proposal #444.' : (e?.message || String(e)) }));
            }
        } catch (e) {
            setState({ loading: false, error: e?.message || String(e) });
        }
    }, [identity]);
    useEffect(() => { if (isAuthenticated && identity) load(); }, [isAuthenticated, identity, load]);

    // each claimable token's ledger fee: a balance not above it cannot be claimed yet
    useEffect(() => {
        (state.balances || []).forEach(([ledger]) => {
            if (fees[ledger] !== undefined) return;
            setFees((f) => ({ ...f, [ledger]: null }));
            createLedgerActor(ledger, { agentOptions: { host: RLL_HOST } }).icrc1_fee()
                .then((fee) => setFees((f) => ({ ...f, [ledger]: fee })))
                .catch(() => {});
        });
    }, [state.balances]); // eslint-disable-line react-hooks/exhaustive-deps

    const claim = (ledger, amount) => {
        const fee = fees[ledger];
        const meta = tokenMeta(ledger);
        setConfirm({
            message: `Claim ${fmtAmount(amount, ledger, meta?.decimals ?? 8)}? It is sent to your Sneed Hub wallet, less the ledger fee of ${fmtAmount(fee, ledger, meta?.decimals ?? 8)}.`,
            run: async () => {
                setClaiming(ledger);
                try {
                    const r = await rllActor(identity).claim_full_balance_of_hotkey(Principal.fromText(ledger), fee);
                    if ('Ok' in r) {
                        setNotification({ type: 'success', message: `Claimed ${fmtAmount(amount - fee, ledger, 8)} (ledger block ${String(r.Ok)}).` });
                    } else {
                        const e = r.Err;
                        const msg = e.InsufficientFunds ? 'Nothing above the fee to claim yet.'
                            : e.BadFee ? `The ledger fee changed to ${fmtAmount(e.BadFee.expected_fee, ledger, 8)}. Try again.`
                            : e.GenericError ? e.GenericError.message : `The transfer failed: ${Object.keys(e)[0]}`;
                        setNotification({ type: 'error', message: msg });
                    }
                } catch (e) {
                    setNotification({ type: 'error', message: `The claim failed: ${e?.message || String(e)}` });
                } finally {
                    setClaiming(null);
                    setFees((f) => ({ ...f, [ledger]: undefined }));
                    load();
                }
            },
        });
    };

    if (!isAuthenticated) {
        return (
            <Card title="Your rewards" icon={<FaWallet size={15} />}>
                <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: c.secondaryText, lineHeight: 1.5 }}>Sign in to see what your Sneed neurons have earned, claim it to your wallet and see your history.</p>
                <button type="button" onClick={login} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: AMBER, color: '#1a1a1a', fontWeight: 700, cursor: 'pointer' }}>Sign in</button>
            </Card>
        );
    }

    const claimable = (state.balances || []).filter(([, a]) => a > 0n).sort((x, y) => usdOfAmount(y[1], y[0]) - usdOfAmount(x[1], x[0]));
    const totalUsd = valueOf(claimable);
    const share = state.vp && state.vp.distribution_voting_power > 0n ? Number(state.vp.total_voting_power) / Number(state.vp.distribution_voting_power) : null;
    const list = tab === 'received' ? (state.history || []) : (state.claims || []);
    const pages = Math.ceil(list.length / PAGE_SIZE);
    const shown = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const manyOwners = (state.owners || []).length > 1;

    return (
        <Card title="Your rewards" icon={<FaWallet size={15} />} right={<RefreshButton loading={state.loading} onClick={load} title="Read your rewards again" />}>
            {state.loading && !state.balances && <Spinner text="Reading your neurons and balances…" />}
            {state.error && <div style={{ fontSize: '0.82rem', color: c.error }}>Could not read your rewards: {state.error}</div>}
            {state.balances && state.neurons === 0 && (
                <p style={{ margin: 0, fontSize: '0.85rem', color: c.secondaryText, lineHeight: 1.5 }}>
                    No Sneed neurons were found for your principal. Rewards go to the owners of Sneed neurons that vote; add this principal as a hotkey on your neurons to see and claim them here (<Link to="/help/neurons" style={{ color: c.accent }}>how</Link>).
                </p>
            )}
            {state.balances && state.neurons > 0 && (
                <>
                    <div style={{ fontSize: '0.8rem', color: c.mutedText, marginBottom: 10, lineHeight: 1.5 }}>
                        {state.neurons} neuron{state.neurons === 1 ? '' : 's'}{manyOwners ? ` of ${state.owners.length} owners` : ''}
                        {share != null && <> · your votes so far weigh <b style={{ color: c.secondaryText }}>{(share * 100).toLocaleString(undefined, { maximumFractionDigits: 4 })}%</b> of a distribution</>}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: c.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                        Claimable{totalUsd > 0 && <span style={{ textTransform: 'none', letterSpacing: 0 }}> · {formatValue(totalUsd)}</span>}
                    </div>
                    {claimable.length === 0 && <div style={{ fontSize: '0.85rem', color: c.secondaryText }}>Nothing to claim right now. Rewards are shared out once a day.</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {claimable.map(([ledger, amount]) => {
                            const fee = fees[ledger];
                            const tooSmall = fee != null && amount <= fee;
                            const busy = claiming === ledger;
                            const v = money(amount, ledger);
                            return (
                                <div key={ledger} style={{ ...rowStyle(c), alignItems: 'center', padding: '9px 10px' }}>
                                    <span style={{ fontWeight: 700, color: c.primaryText, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(amount, ledger, 8)}</span>
                                    {v && <span style={{ color: c.mutedText, fontSize: '0.75rem' }}>{v}</span>}
                                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                        {tooSmall && <span style={{ color: c.mutedText, fontSize: '0.72rem' }}>not above the fee yet</span>}
                                        <button type="button" disabled={busy || fee == null || tooSmall || !!claiming} onClick={() => claim(ledger, amount)}
                                            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.8rem', background: busy || fee == null || tooSmall ? c.border : c.success, color: '#fff', cursor: busy || fee == null || tooSmall || claiming ? 'not-allowed' : 'pointer' }}>
                                            {busy ? <FaSpinner className="rll-spin" /> : 'Claim'}
                                        </button>
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    {manyOwners && <div style={{ fontSize: '0.72rem', color: c.mutedText, marginTop: 6 }}>A principal on a neuron as a hotkey claims the rewards of the neuron&apos;s owner, to itself.</div>}
                </>
            )}
            {state.balances && (
                <div style={{ marginTop: 16 }}>
                    <Tabs value={tab} onChange={(t) => { setTab(t); setPage(0); }} tabs={[
                        { key: 'received', label: `Received${state.history ? ` (${state.history.length})` : ''}` },
                        { key: 'claims', label: `Your claims (${(state.claims || []).length})` },
                    ]} />
                    {tab === 'received' && !state.history && !state.historyError && <Spinner text="Reading your reward history…" />}
                    {tab === 'received' && state.historyError && <div style={{ fontSize: '0.82rem', color: c.mutedText }}>{state.historyError}</div>}
                    {tab === 'received' && state.history && state.history.length === 0 && <div style={{ fontSize: '0.82rem', color: c.mutedText }}>No rewards credited yet.</div>}
                    {tab === 'claims' && state.claims.length === 0 && <div style={{ fontSize: '0.82rem', color: c.mutedText }}>You have not claimed yet.</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {tab === 'received' && shown.map((e, i) => {
                            const ledger = e.token_id.toText();
                            const v = money(e.amount, ledger);
                            return (
                                <div key={`${String(e.timestamp)}-${ledger}-${i}`} style={rowStyle(c)}>
                                    <span style={{ fontWeight: 600, color: c.primaryText, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(e.amount, ledger, 6)}</span>
                                    {v && <span style={{ color: c.mutedText, fontSize: '0.72rem' }}>{v}</span>}
                                    {manyOwners && <span style={{ color: c.secondaryText, display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>to <Who principal={e.user} /></span>}
                                    <span style={{ color: c.mutedText, fontSize: '0.72rem', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtNs(e.timestamp)} · proposals {String(e.proposal_range.first)}–{String(e.proposal_range.last)}</span>
                                </div>
                            );
                        })}
                        {tab === 'claims' && shown.map((x) => (
                            <div key={String(x.seq)} style={rowStyle(c)}>
                                <StatusBadge status={x.status} />
                                <span style={{ fontWeight: 600, color: c.primaryText, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(x.amount, x.token, 6)}</span>
                                {x.txIndex != null && <Link to={`/transaction?id=${x.txIndex}&ledger=${x.token}`} style={{ color: c.accent, fontSize: '0.72rem' }}>ledger tx {String(x.txIndex)}</Link>}
                                {x.error && <span style={{ color: c.mutedText, fontSize: '0.72rem', wordBreak: 'break-word' }}>{x.error}</span>}
                                <span style={{ color: c.mutedText, fontSize: '0.72rem', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtNs(x.ts)} · #{String(x.seq)}</span>
                            </div>
                        ))}
                    </div>
                    <Pager page={page} pages={pages} onChange={setPage} accent={AMBER} />
                </div>
            )}
            {confirm && <ConfirmationModal show onClose={() => setConfirm(null)} onSubmit={confirm.run} doAwait message={confirm.message} />}
            {notification && <Notification type={notification.type} message={notification.message} onClose={() => setNotification(null)} />}
        </Card>
    );
}

// ---- distribution history ----

function Distributions({ onTotal }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const money = useMoney();
    useStoreVersion();
    const [source, setSource] = useState(null);
    const [page, setPage] = useState(0);
    const [rows, setRows] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const open = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const s = await distributionSource();
            setSource(s); onTotal?.(s.total);
            setPage(0);
        } catch (e) { setError(e?.message || String(e)); setLoading(false); }
    }, [onTotal]);
    useEffect(() => { open(); }, [open]);
    useEffect(() => {
        if (!source) return;
        let live = true;
        setLoading(true);
        source.page(page, PAGE_SIZE)
            .then((events) => { if (!live) return; events.forEach((e) => want(e.token_id.toText())); setRows(events); setError(null); })
            .catch((e) => { if (live) setError(e?.message || String(e)); })
            .finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [source, page]);

    const pages = source ? Math.ceil(source.total / PAGE_SIZE) : 0;
    return (
        <Card id="distributions" title="Distributions" icon={<FaHistory size={15} />} right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {source && <span style={{ fontSize: '0.75rem', color: c.mutedText }}>{source.total.toLocaleString()} in all</span>}
                <RefreshButton loading={loading} onClick={open} title="Read the distributions again" />
            </div>
        }>
            <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: c.secondaryText, lineHeight: 1.5 }}>
                Each daily cycle shares out every known token the canister holds beyond what is already owed, in proportion to the voting power cast on the proposals in the range shown. Newest first.
            </p>
            {error && <div style={{ fontSize: '0.82rem', color: c.error, marginBottom: 8 }}>Could not read the distributions: {error}</div>}
            {!rows && loading && <Spinner text="Reading the distributions…" />}
            {rows && rows.length === 0 && <div style={{ fontSize: '0.82rem', color: c.mutedText }}>No distributions yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: loading && rows ? 0.6 : 1 }}>
                {(rows || []).map((e, i) => {
                    const ledger = e.token_id.toText();
                    const v = money(e.amount, ledger);
                    return (
                        <div key={`${String(e.timestamp)}-${ledger}-${i}`} style={rowStyle(c)}>
                            <span style={{ fontWeight: 600, color: c.primaryText, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtAmount(e.amount, ledger, 4)}</span>
                            {v && <span style={{ color: c.mutedText, fontSize: '0.72rem' }}>{v}</span>}
                            <span style={{ color: c.secondaryText, fontSize: '0.75rem' }}>proposals {String(e.proposal_range.first)}–{String(e.proposal_range.last)}</span>
                            <span style={{ color: c.mutedText, fontSize: '0.72rem', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtNs(e.timestamp)}</span>
                        </div>
                    );
                })}
            </div>
            <Pager page={page} pages={pages} onChange={setPage} disabled={loading} accent={AMBER} />
        </Card>
    );
}

export default function RLL() {
    const { theme } = useTheme();
    const c = theme.colors;
    const [distributionCount, setDistributionCount] = useState(null);
    const onTotal = useMemo(() => (n) => setDistributionCount(n), []);
    return (
        <>
            <Header />
            <style>{'@keyframes rll-spin { to { transform: rotate(360deg); } } .rll-spin { animation: rll-spin 1s linear infinite; }'}</style>
            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.25rem 16px 3rem', boxSizing: 'border-box' }}>
                <div style={{ marginBottom: 14 }}>
                    <h1 style={{ margin: 0, fontSize: '1.6rem', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 10 }}><FaGift color={AMBER} size={22} /> Voting rewards</h1>
                    <p style={{ margin: '6px 0 0', color: c.secondaryText, fontSize: '0.9rem', maxWidth: 720, lineHeight: 1.55 }}>
                        Part of what the DAO earns goes round the <Link to="/rll_info" style={{ color: c.accent }}>Recursive Liquidity Loop</Link> to the RLL rewards canister. Once a day it shares what it holds among the owners of Sneed neurons, in proportion to the voting power their neurons have cast on Sneed DAO proposals: neurons that vote earn, neurons that never vote do not. Owners, or principals added as hotkeys to their neurons, claim their share whenever they like. More in the <Link to="/help/dao#rewards" style={{ color: c.accent }}>Sneed DAO help</Link>.
                    </p>
                </div>

                <Statistics distributionCount={distributionCount} />
                <YourRewards />
                <Distributions onTotal={onTotal} />
                <RllActivityCard style={{ marginBottom: 16 }} />

                <div style={{ fontSize: '0.75rem', color: c.mutedText, lineHeight: 1.5, display: 'flex', gap: 8 }}>
                    <FaInfoCircle style={{ marginTop: 3, flexShrink: 0 }} />
                    <div>
                        Everything here is read live from the RLL canister <code>{rllCanisterId}</code>. Values in your chosen denomination use today&apos;s prices, not the price on the day. For developers: <Link to="/api/rll" style={{ color: c.accent }}>the canister&apos;s API <FaExternalLinkAlt size={8} /></Link>.
                    </div>
                </div>
            </div>
        </>
    );
}
