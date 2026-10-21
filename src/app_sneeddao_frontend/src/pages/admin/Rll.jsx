// /admin/rll: the RLL rewards canister for admins (public/api-docs/rll.md). The claim log as one
// table with a status filter and failed claims grouped by their error, the cycle status and its
// controls, balance reconciliation, known tokens with their distribution limits, and the event
// statistics with their status. The full set of RLL tools (imports, balances, admins, resets) is
// on /admin/rewards. The public page is /rll.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { FaCoins, FaSpinner, FaSync, FaChevronDown, FaChevronRight, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import Pager from '../../components/Pager';
import TokenSelector from '../../components/TokenSelector';
import ConfirmationModal from '../../ConfirmationModal';
import { PrincipalDisplay } from '../../utils/PrincipalUtils';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { useStoreVersion } from '../../utils/revenueStore';
import { loadTokenMeta, fmtAmount } from '../../utils/revenueData';
import {
    rllActor, rllCanisterId, RLL_HOST, loadEventStatistics, loadEventStatisticsStatus, loadAllClaimEvents, groupClaims, errorShape, fmtNs,
} from '../../utils/rllApi';

const AMBER = '#f59e0b';
const PAGE_SIZE = 20;
const STAGES = ['importing whitelist', 'checking balances', 'importing neurons', 'importing proposals', 'distributing tokens'];

const msgOf = (e) => e?.message || String(e);
const n = (x) => Number(x).toLocaleString();
const unitsText = (amount, decimals) => (Number(amount) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: decimals });
const formatDuration = (seconds) => {
    if (!seconds) return 'unknown';
    const h = seconds / 3600;
    return h >= 24 ? `${(h / 24).toLocaleString()} day${h === 24 ? '' : 's'}` : `${h.toLocaleString()} hours`;
};

function useStyles() {
    const { theme } = useTheme();
    const c = theme.colors;
    return {
        c,
        card: { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16, minWidth: 0 },
        h2: { margin: 0, fontSize: '1.1rem', color: c.primaryText },
        muted: { fontSize: '0.75rem', color: c.mutedText },
        row: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.85rem', padding: '3px 0', color: c.primaryText, flexWrap: 'wrap' },
        btn: (primary, disabled, color = AMBER) => ({
            padding: '7px 14px', borderRadius: 10, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? (disabled ? c.border : color) : 'transparent',
            color: primary ? '#fff' : c.secondaryText, fontWeight: 600, fontSize: '0.85rem', cursor: disabled ? 'not-allowed' : 'pointer',
        }),
        input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText },
    };
}

function CardHead({ title, right, sub }) {
    const s = useStyles();
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={s.h2}>{title}</h2>
                {right}
            </div>
            {sub && <div style={{ ...s.muted, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
        </div>
    );
}

function Refresh({ loading, onClick }) {
    const s = useStyles();
    return <button type="button" disabled={loading} onClick={onClick} title="Read again" style={{ ...s.btn(false, loading), padding: '4px 8px' }}><FaSync className={loading ? 'rlla-spin' : ''} /></button>;
}

const Spin = ({ text }) => { const s = useStyles(); return <span style={{ ...s.muted, display: 'inline-flex', gap: 6, alignItems: 'center' }}><FaSpinner className="rlla-spin" /> {text}</span>; };

// ---- cycle status and controls ----

function Progress({ label, done, total, running }) {
    const s = useStyles();
    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
    return (
        <div style={{ marginBottom: 8 }}>
            <div style={{ ...s.row, fontSize: '0.8rem' }}>
                <span>{running ? <FaSpinner className="rlla-spin" size={10} /> : <FaCheckCircle size={10} color={s.c.success} />} {label}</span>
                <span style={{ fontFamily: 'monospace', color: AMBER }}>{done} / {total}</span>
            </div>
            <div style={{ height: 6, background: s.c.secondaryBg, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: running ? AMBER : s.c.success, transition: 'width .5s' }} />
            </div>
        </div>
    );
}

function CycleCard({ identity, canAct, setNotice, setConfirm }) {
    const s = useStyles();
    const { c } = s;
    const [st, setSt] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);

    const load = useCallback(async () => {
        try {
            const a = rllActor();
            const [neurons, owners, props, stage, proposalId, loop, tokenCheck, walletCheck] = await Promise.all([
                a.imported_neurons_count(), a.imported_owners_count(), a.imported_props_count(), a.get_import_stage(),
                a.get_highest_closed_proposal_id(), a.get_main_loop_status(), a.get_token_balance_check_status(), a.get_wallet_token_check_status(),
            ]);
            setSt({ neurons, owners, props, stage, proposalId, loop, tokenCheck, walletCheck });
            setError(null);
        } catch (e) { setError(msgOf(e)); }
    }, []);
    const active = !!st && !!st.stage && !st.stage.includes('idle');
    useEffect(() => {
        load();
        const id = setInterval(load, active ? 5000 : 30000); // faster while a cycle runs
        return () => clearInterval(id);
    }, [load, active]);

    // the admin buttons of the old /rll page, with the same calls
    const ACTIONS = [
        ['start_distribution_cycle', 'Start distribution cycle'],
        ['stop_distribution_cycle', 'Stop distribution cycle'],
        ['import_all_neurons', 'Import all neurons'],
        ['import_all_proposals', 'Import all proposals'],
        ['start_rll_main_loop', 'Start main loop'],
        ['stop_rll_main_loop', 'Stop main loop'],
    ];
    const run = (method, label) => setConfirm({
        message: `${label} on the RLL canister?`,
        run: async () => {
            setBusy(method);
            try {
                const r = await rllActor(identity)[method]();
                const text = r && typeof r === 'object' ? ('ok' in r ? r.ok : 'err' in r ? `Error: ${r.err}` : JSON.stringify(r)) : (r === undefined ? 'done' : String(r));
                setNotice({ ok: !(r && typeof r === 'object' && 'err' in r), text: `${label}: ${text}` });
            } catch (e) { setNotice({ ok: false, text: `${label}: ${msgOf(e)}` }); }
            finally { setBusy(null); load(); }
        },
    });

    const loop = st?.loop;
    const stage = st?.stage || '';
    const currentIdx = STAGES.findIndex((x) => stage.toLowerCase().includes(x));
    const distMatch = stage.includes('distributing tokens') ? stage.match(/(\d+)\/(\d+)/) : null;
    const ns = (o) => (o && o.length ? fmtNs(o[0]) : null);
    const opt = (v) => (Array.isArray(v) ? v[0] : v);
    return (
        <section style={s.card}>
            <CardHead title="Distribution cycle" right={<Refresh loading={false} onClick={load} />} />
            {error && <div style={{ color: c.error, fontSize: '0.85rem' }}>Could not read the status: {error}</div>}
            {!st && !error && <Spin text="Reading the status…" />}
            {st && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '4px 24px' }}>
                    <div>
                        <div style={s.row}><span>Main loop</span><b style={{ color: loop.is_running ? c.success : c.error }}>{loop.is_running ? 'Running' : 'Stopped'}</b></div>
                        <div style={s.row}><span>Stage</span><span style={{ fontFamily: 'monospace', color: active ? c.success : c.secondaryText }}>{stage}</span></div>
                        <div style={s.row}><span>Every</span><span>{formatDuration(Number(opt(loop.frequency_seconds) || 0))}</span></div>
                        <div style={s.row}><span>Next scheduled</span><span>{ns(loop.next_scheduled) || 'not scheduled'}</span></div>
                        <div style={s.row}><span>Last cycle</span><span>{ns(loop.last_cycle_started) || 'never'} → {ns(loop.last_cycle_ended) || '…'}</span></div>
                        <div style={s.row}><span>Loop started / stopped</span><span>{ns(loop.last_started) || 'never'} / {ns(loop.last_stopped) || 'never'}</span></div>
                    </div>
                    <div>
                        <div style={s.row}><span>Imported neurons</span><span>{n(st.neurons)}</span></div>
                        <div style={s.row}><span>Imported owners</span><span>{n(st.owners)}</span></div>
                        <div style={s.row}><span>Imported proposals</span><span>{n(st.props)}</span></div>
                        <div style={s.row}><span>Highest closed proposal</span><span>{n(st.proposalId)}</span></div>
                    </div>
                </div>
            )}
            {st && (active || st.tokenCheck.is_running || st.walletCheck.is_running) && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: `${AMBER}10`, border: `1px solid ${AMBER}33` }}>
                    {active && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                            {STAGES.map((x, i) => {
                                const on = i === currentIdx; const done = currentIdx > i;
                                return <span key={x} style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600, background: on ? `${AMBER}30` : done ? `${c.success}22` : 'transparent', color: on ? AMBER : done ? c.success : c.mutedText, border: `1px solid ${on ? AMBER : done ? c.success : c.border}55` }}>{done ? '✓ ' : on ? '● ' : '○ '}{x}</span>;
                            })}
                        </div>
                    )}
                    {(st.tokenCheck.is_running || Number(st.tokenCheck.total) > 0) && <Progress label="Canister token balances" done={Number(st.tokenCheck.processed)} total={Number(st.tokenCheck.total)} running={st.tokenCheck.is_running} />}
                    {(st.walletCheck.is_running || Number(st.walletCheck.total) > 0) && <Progress label="Wallet token balances" done={Number(st.walletCheck.processed)} total={Number(st.walletCheck.total)} running={st.walletCheck.is_running} />}
                    {distMatch && <Progress label="Token distribution" done={Number(distMatch[1])} total={Number(distMatch[2])} running />}
                </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                {ACTIONS.map(([m, label]) => (
                    <button key={m} type="button" disabled={!canAct || !!busy} onClick={() => run(m, label)} style={s.btn(true, !canAct || !!busy)}>
                        {busy === m ? <FaSpinner className="rlla-spin" /> : label}
                    </button>
                ))}
            </div>
        </section>
    );
}

// ---- claims ----

const STATUS_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'Success', label: 'Paid' },
    { key: 'Failed', label: 'Failed' },
    { key: 'Pending', label: 'Pending (no outcome)' },
];

function StatusBadge({ status }) {
    const { c } = useStyles();
    const color = { Success: c.success, Failed: c.error, Pending: c.warning }[status] || c.mutedText;
    return <span style={{ fontSize: '0.7rem', fontWeight: 700, color, border: `1px solid ${color}66`, background: `${color}18`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>{status === 'Success' ? 'Paid' : status}</span>;
}

function ClaimTable({ claims, isAuthenticated }) {
    const s = useStyles();
    const { c } = s;
    const [page, setPage] = useState(0);
    useEffect(() => { setPage(0); }, [claims]);
    const pages = Math.ceil(claims.length / PAGE_SIZE);
    const shown = claims.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const th = { textAlign: 'left', padding: '6px 8px', fontSize: '0.7rem', color: c.mutedText, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: `1px solid ${c.border}`, whiteSpace: 'nowrap' };
    const td = { padding: '6px 8px', fontSize: '0.8rem', color: c.primaryText, borderBottom: `1px solid ${c.border}`, verticalAlign: 'top' };
    if (!claims.length) return <div style={s.muted}>No claims match.</div>;
    return (
        <>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead><tr><th style={th}>#</th><th style={th}>Status</th><th style={th}>Caller</th><th style={th}>Amount</th><th style={th}>Fee</th><th style={th}>Outcome</th><th style={th}>Time</th></tr></thead>
                    <tbody>
                        {shown.map((x) => (
                            <tr key={String(x.seq)}>
                                <td style={{ ...td, fontFamily: 'monospace', color: c.mutedText }}>{String(x.seq)}</td>
                                <td style={td}><StatusBadge status={x.status} /></td>
                                <td style={td}><PrincipalDisplay principal={x.hotkey} short showCopyButton={false} isAuthenticated={isAuthenticated} /></td>
                                <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(x.amount, x.token, 8)}</td>
                                <td style={{ ...td, whiteSpace: 'nowrap', color: c.secondaryText }}>{fmtAmount(x.fee, x.token, 8)}</td>
                                <td style={{ ...td, maxWidth: 320, wordBreak: 'break-word', color: x.error ? c.error : c.secondaryText }}>
                                    {x.txIndex != null ? <Link to={`/transaction?id=${x.txIndex}&ledger=${x.token}`} style={{ color: c.accent }}>ledger tx {String(x.txIndex)}</Link> : (x.error || (x.status === 'Pending' ? 'no outcome logged' : ''))}
                                </td>
                                <td style={{ ...td, whiteSpace: 'nowrap', color: c.mutedText }}>{fmtNs(x.ts)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Pager page={page} pages={pages} onChange={setPage} accent={AMBER} />
        </>
    );
}

function ClaimsCard({ identity, isAuthenticated }) {
    const s = useStyles();
    const { c } = s;
    useStoreVersion();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('all');
    const [grouped, setGrouped] = useState(true);
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const r = await loadAllClaimEvents(identity);
            const claims = groupClaims(r.events);
            new Set(claims.map((x) => x.token)).forEach((t) => loadTokenMeta(t).catch(() => {}));
            setData({ claims, events: r.events.length, paged: r.paged });
        } catch (e) { setError(msgOf(e)); }
        finally { setLoading(false); }
    }, [identity]);
    useEffect(() => { load(); }, [load]);

    const counts = useMemo(() => {
        const k = { all: 0, Success: 0, Failed: 0, Pending: 0 };
        for (const x of data?.claims || []) { k.all++; k[x.status]++; }
        return k;
    }, [data]);
    const q = search.trim();
    const filtered = useMemo(() => (data?.claims || []).filter((x) => (filter === 'all' || x.status === filter)
        && (!q || x.hotkey.toText().includes(q) || x.token.includes(q) || String(x.seq) === q)), [data, filter, q]);
    const groups = useMemo(() => {
        if (filter !== 'Failed' || !grouped) return null;
        const m = new Map();
        for (const x of filtered) {
            const key = errorShape(x.error);
            let g = m.get(key);
            if (!g) { g = { key, claims: [], latest: x.ts }; m.set(key, g); }
            g.claims.push(x);
        }
        return [...m.values()].sort((a, b) => b.claims.length - a.claims.length);
    }, [filtered, filter, grouped]);

    return (
        <section style={s.card}>
            <CardHead title="Claims" right={<Refresh loading={loading} onClick={load} />}
                sub={<>Every claim attempt, one row per claim (its Pending event and its outcome share a sequence number), newest first. {data && `${n(data.events)} events${data.paged ? '' : ' (read whole: the paged query arrives with proposal #444)'}.`}</>} />
            {error && <div style={{ color: c.error, fontSize: '0.85rem' }}>Could not read the claims: {error}</div>}
            {!data && loading && <Spin text="Reading the claim log…" />}
            {data && (
                <>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                        {STATUS_FILTERS.map((f) => (
                            <button key={f.key} type="button" onClick={() => { setFilter(f.key); setOpen(null); }}
                                style={{ padding: '5px 12px', borderRadius: 8, fontSize: '0.8rem', cursor: 'pointer', color: c.primaryText, border: `1px solid ${filter === f.key ? AMBER : c.border}`, background: filter === f.key ? `${AMBER}22` : 'transparent' }}>
                                {f.label} <span style={{ color: c.mutedText }}>{n(counts[f.key])}</span>
                            </button>
                        ))}
                        {filter === 'Failed' && (
                            <label style={{ ...s.muted, display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 6, cursor: 'pointer' }}>
                                <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> group by error
                            </label>
                        )}
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by caller, token or #" style={{ ...s.input, width: 'auto', flex: '1 1 200px', minWidth: 0, padding: '5px 10px', fontSize: '0.8rem' }} />
                    </div>
                    {groups ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {groups.length === 0 && <div style={s.muted}>No failed claims match.</div>}
                            {groups.map((g) => (
                                <div key={g.key} style={{ border: `1px solid ${c.border}`, borderRadius: 10, overflow: 'hidden' }}>
                                    <button type="button" onClick={() => setOpen(open === g.key ? null : g.key)}
                                        style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 10px', background: c.secondaryBg, border: 'none', color: c.primaryText, cursor: 'pointer', textAlign: 'left', fontSize: '0.82rem' }}>
                                        {open === g.key ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
                                        <b style={{ color: c.error, fontVariantNumeric: 'tabular-nums', minWidth: 40 }}>{n(g.claims.length)}×</b>
                                        <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{g.key}</span>
                                        <span style={{ ...s.muted, whiteSpace: 'nowrap' }}>latest {fmtNs(g.latest)}</span>
                                    </button>
                                    {open === g.key && <div style={{ padding: 8 }}><ClaimTable claims={g.claims} isAuthenticated={isAuthenticated} /></div>}
                                </div>
                            ))}
                        </div>
                    ) : <ClaimTable claims={filtered} isAuthenticated={isAuthenticated} />}
                </>
            )}
        </section>
    );
}

function IncidentsCard({ identity }) {
    const s = useStyles();
    const [list, setList] = useState(null);
    const [error, setError] = useState(null);
    const load = useCallback(async () => {
        try { const r = await rllActor(identity).list_claim_incidents(); setList(r); r.forEach((x) => loadTokenMeta(x.token_id.toText()).catch(() => {})); setError(null); }
        catch (e) { setError(msgOf(e)); }
    }, [identity]);
    useEffect(() => { load(); }, [load]);
    useStoreVersion();
    const open = (list || []).filter((x) => !x.resolved);
    return (
        <section style={s.card}>
            <CardHead title={`Claim incidents${list ? ` (${open.length} open of ${list.length})` : ''}`} right={<Refresh loading={false} onClick={load} />}
                sub="Claims whose transfer outcome was unknown: the owners stay debited until an admin resolves the incident (resolve_claim_incident) after checking the ledger for its memo." />
            {error && <div style={{ color: s.c.error, fontSize: '0.85rem' }}>{error}</div>}
            {list && list.length === 0 && <div style={s.muted}>None.</div>}
            {(list || []).map((x) => (
                <div key={String(x.id)} style={{ ...s.row, borderTop: `1px solid ${s.c.border}`, padding: '6px 0' }}>
                    <span>#{String(x.id)} · claim {String(x.sequence_number)} · {fmtAmount(x.total, x.token_id.toText(), 8)} · <PrincipalDisplay principal={x.recipient} short showCopyButton={false} /></span>
                    <span style={{ color: x.resolved ? s.c.success : s.c.warning }}>{x.resolved ? `resolved (${x.landed?.[0] ? 'landed' : 're-credited'})` : 'open'} · {fmtNs(x.created_at_time)}</span>
                </div>
            ))}
        </section>
    );
}

// ---- tokens: reconciliation, known tokens, limits ----

function TokensCard({ identity, canAct, setNotice, setConfirm }) {
    const s = useStyles();
    const { c } = s;
    const [d, setD] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [token, setToken] = useState('');
    const [tokenDecimals, setTokenDecimals] = useState(null);
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const a = rllActor();
            const [known, mins, maxs, totals] = await Promise.all([a.get_known_tokens(), a.get_all_token_min_distributions(), a.get_all_token_max_distributions(), a.get_total_distributions()]);
            // the ledger balance of every known token, compared with what is owed (as the old /rll page did)
            const balances = await Promise.all(known.map(async ([id]) => [id, await createLedgerActor(id.toText(), { agentOptions: { host: RLL_HOST } }).icrc1_balance_of({ owner: Principal.fromText(rllCanisterId), subaccount: [] })]));
            const reconciliation = await a.balance_reconciliation_from_balances(balances);
            const map = (pairs) => new Map(pairs.map(([p, v]) => [p.toText(), v]));
            setD({ known, mins: map(mins), maxs: map(maxs), totals: map(totals), rec: map(reconciliation.map((r) => [r.token_id, r])) });
        } catch (e) { setError(msgOf(e)); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const meta = (id) => d?.known.find(([k]) => k.toText() === id)?.[1];
    const decimalsOf = (id) => { const m = meta(id); return m ? Number(m.decimals) : tokenDecimals ?? 8; };
    const toUnits = (text, dec) => BigInt(Math.floor(Number(text) * 10 ** dec));
    const setLimits = () => {
        const dec = decimalsOf(token);
        setConfirm({
            message: `Set the distribution limits of ${meta(token)?.symbol || token}${minAmount ? `: minimum ${minAmount}` : ''}${maxAmount ? `, maximum ${maxAmount}` : ''}?`,
            run: async () => {
                setBusy(true);
                try {
                    const a = rllActor(identity);
                    if (minAmount) await a.set_token_min_distribution(Principal.fromText(token), toUnits(minAmount, dec));
                    if (maxAmount) await a.set_token_max_distribution(Principal.fromText(token), toUnits(maxAmount, dec));
                    setNotice({ ok: true, text: 'Limits set.' }); setMinAmount(''); setMaxAmount('');
                } catch (e) { setNotice({ ok: false, text: `Setting the limits failed: ${msgOf(e)}` }); }
                finally { setBusy(false); load(); }
            },
        });
    };
    const removeLimits = () => setConfirm({
        message: `Remove both distribution limits of ${meta(token)?.symbol || token}? The minimum goes back to 10 × the ledger fee and there is no maximum.`,
        run: async () => {
            setBusy(true);
            try {
                const a = rllActor(identity);
                await a.remove_token_min_distribution(Principal.fromText(token));
                await a.remove_token_max_distribution(Principal.fromText(token));
                setNotice({ ok: true, text: 'Limits removed.' });
            } catch (e) { setNotice({ ok: false, text: `Removing the limits failed: ${msgOf(e)}` }); }
            finally { setBusy(false); load(); }
        },
    });

    const th = { textAlign: 'right', padding: '6px 8px', fontSize: '0.7rem', color: c.mutedText, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: `1px solid ${c.border}`, whiteSpace: 'nowrap' };
    const td = { textAlign: 'right', padding: '6px 8px', fontSize: '0.8rem', color: c.primaryText, borderBottom: `1px solid ${c.border}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
    return (
        <section style={s.card}>
            <CardHead title={`Known tokens${d ? ` (${d.known.length})` : ''}`} right={<Refresh loading={loading} onClick={load} />}
                sub="The tokens the cycle distributes, with the canister's ledger balance against what owners can claim (remaining = balance − claimable: shared out in the next cycle once it reaches the minimum) and the per-cycle limits." />
            {error && <div style={{ color: c.error, fontSize: '0.85rem' }}>Could not read the tokens: {error}</div>}
            {!d && loading && <Spin text="Reading the tokens and their ledgers…" />}
            {d && (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                        <thead><tr>
                            <th style={{ ...th, textAlign: 'left' }}>Token</th><th style={th}>Distributed, all time</th><th style={th}>Claimable</th><th style={th}>Ledger balance</th><th style={th}>Remaining</th><th style={th}>Min</th><th style={th}>Max</th>
                        </tr></thead>
                        <tbody>
                            {d.known.map(([id, m]) => {
                                const k = id.toText(); const dec = Number(m.decimals); const r = d.rec.get(k);
                                const u = (v) => (v == null ? '—' : unitsText(v, dec));
                                return (
                                    <tr key={k}>
                                        <td style={{ ...td, textAlign: 'left' }} title={k}><b>{m.symbol}</b> <span style={{ color: c.mutedText }}>{m.name}</span></td>
                                        <td style={td}>{u(d.totals.get(k))}</td>
                                        <td style={td}>{u(r?.local_total)}</td>
                                        <td style={td}>{u(r?.server_balance)}</td>
                                        <td style={{ ...td, color: r && r.underflow > 0n ? c.error : c.primaryText }}>{r && r.underflow > 0n ? <><FaExclamationTriangle /> −{u(r.underflow)}</> : u(r?.remaining)}</td>
                                        <td style={td}>{d.mins.has(k) ? u(d.mins.get(k)) : <span style={{ color: c.mutedText }}>10 × fee</span>}</td>
                                        <td style={td}>{d.maxs.has(k) ? u(d.maxs.get(k)) : <span style={{ color: c.mutedText }}>none</span>}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${c.border}` }}>
                <div style={{ fontWeight: 600, color: c.primaryText, fontSize: '0.9rem', marginBottom: 8 }}>Set distribution limits</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 8 }}>
                    <TokenSelector value={token} onChange={setToken} onSelectToken={(t) => setTokenDecimals(t.decimals != null ? Number(t.decimals) : null)} placeholder="Token (must be whitelisted)" />
                    <input type="number" min="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="Minimum per cycle" style={s.input} />
                    <input type="number" min="0" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="Maximum per cycle" style={s.input} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" disabled={!canAct || !token || busy || (!minAmount && !maxAmount)} onClick={setLimits} style={s.btn(true, !canAct || !token || busy || (!minAmount && !maxAmount))}>Set limits</button>
                    <button type="button" disabled={!canAct || !token || busy} onClick={removeLimits} style={s.btn(true, !canAct || !token || busy, c.error)}>Remove limits</button>
                </div>
                <div style={{ ...s.muted, marginTop: 6 }}>Amounts in whole tokens; the minimum makes small rewards wait until they are worth sharing, the maximum caps one cycle (the rest carries over).</div>
            </div>
        </section>
    );
}

// ---- statistics ----

function StatsCard() {
    const s = useStyles();
    const { c } = s;
    useStoreVersion();
    const [r, setR] = useState(null);
    const [status, setStatus] = useState(undefined);
    const load = useCallback(async () => {
        setR(null);
        const [stats, st] = await Promise.all([loadEventStatistics(), loadEventStatisticsStatus().catch((e) => ({ error: msgOf(e) }))]);
        if (stats.stats) for (const p of [stats.stats.all_time, stats.stats.last_24h]) for (const [l] of [...p.server_distributions.per_token, ...p.claims.per_token]) loadTokenMeta(l.toText()).catch(() => {});
        setR(stats); setStatus(st);
    }, []);
    useEffect(() => { load(); }, [load]);
    const tokens = (list) => (list.length ? list.map(([l, a]) => fmtAmount(a, l.toText(), 4)).join(' · ') : 'none');
    const period = (label, p) => {
        const pendingOpen = Number(p.claims.pending) - Number(p.claims.successful) - Number(p.claims.failed);
        return (
            <div style={{ background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: AMBER, marginBottom: 6 }}>{label}</div>
                <div style={s.row}><span>Distributions</span><span>{n(p.server_distributions.total)}</span></div>
                <div style={{ ...s.muted, marginBottom: 6, lineHeight: 1.5 }}>{tokens(p.server_distributions.per_token)}</div>
                <div style={s.row}><span>Owner credits</span><span>{n(p.user_distributions.total)} to {n(p.user_distributions.unique_users)} owners</span></div>
                <div style={s.row}><span>Claim attempts</span><span>{n(p.claims.pending)} by {n(p.claims.unique_users)} principals</span></div>
                <div style={s.row}><span>Paid / failed</span><span><span style={{ color: c.success }}>{n(p.claims.successful)}</span> / <span style={{ color: c.error }}>{n(p.claims.failed)}</span>{pendingOpen > 0 && <> / <span style={{ color: c.warning }}>{n(pendingOpen)} open</span></>}</span></div>
                <div style={{ ...s.muted, lineHeight: 1.5 }}>Claimed: {tokens(p.claims.per_token)}</div>
            </div>
        );
    };
    return (
        <section style={s.card}>
            <CardHead title="Event statistics" right={<Refresh loading={!r} onClick={load} />}
                sub="get_event_statistics: running counters since #444 (rebuilt by one pass over the event lists on upgrade). Claim attempts count Pending events; paid and failed count outcomes." />
            {!r && <Spin text="Reading the statistics…" />}
            {r?.fixing && <div style={{ color: c.warning, fontSize: '0.85rem' }}>Statistics are being fixed (proposal #444): get_event_statistics runs out of instructions on the current code.</div>}
            {r?.error && <div style={{ color: c.error, fontSize: '0.85rem' }}>{r.error}</div>}
            {r?.stats && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 10 }}>{period('All time', r.stats.all_time)}{period('Last 24 hours', r.stats.last_24h)}</div>}
            <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 600, color: c.primaryText, fontSize: '0.9rem', marginBottom: 4 }}>Status</div>
                {status === undefined && <Spin text="…" />}
                {status === null && <div style={s.muted}>get_event_statistics_status arrives with the RLL upgrade of proposal #444.</div>}
                {status?.error && <div style={{ color: c.error, fontSize: '0.85rem' }}>{status.error}</div>}
                {status && !status.error && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '0 24px' }}>
                        <div style={s.row}><span>Distribution events</span><span>{n(status.distribution_events)}</span></div>
                        <div style={s.row}><span>Owner credit events</span><span>{n(status.user_distribution_events)}</span></div>
                        <div style={s.row}><span>Claim events</span><span>{n(status.claim_events)}</span></div>
                        <div style={s.row}><span>Statistics rebuilt</span><span>{fmtNs(status.rebuilt_at) || 'never'}</span></div>
                        <div style={s.row}><span>Rebuild cost</span><span>{n(status.rebuild_instructions)} instructions</span></div>
                        <div style={s.row}><span>Post-upgrade cost</span><span>{n(status.postupgrade_instructions)} instructions</span></div>
                    </div>
                )}
            </div>
        </section>
    );
}

export default function RllAdmin() {
    const { identity, isAuthenticated } = useAuth();
    const { isAdmin, loading: adminLoading } = useAdminCheck({ identity, isAuthenticated, redirectPath: '/admin' });
    const s = useStyles();
    const { c } = s;
    const [rllAdmin, setRllAdmin] = useState(null);
    const [notice, setNotice] = useState(null);
    const [confirm, setConfirm] = useState(null);

    useEffect(() => {
        if (!isAdmin || !identity) return;
        rllActor(identity).caller_is_admin().then(setRllAdmin).catch(() => setRllAdmin(false));
    }, [isAdmin, identity]);

    if (adminLoading) return <><Header /><div style={{ padding: 40, textAlign: 'center', color: c.mutedText }}><FaSpinner className="rlla-spin" /> Loading…</div></>;
    if (!isAdmin) return <><Header /><div style={{ padding: 40, textAlign: 'center', color: c.mutedText }}>Admins only.</div></>;

    const canAct = rllAdmin === true;
    return (
        <>
            <Header />
            <style>{'@keyframes rlla-spin { to { transform: rotate(360deg); } } .rlla-spin { animation: rlla-spin 1s linear infinite; }'}</style>
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 16px 3rem', boxSizing: 'border-box' }}>
                <h1 style={{ margin: '0 0 4px', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.5rem' }}><FaCoins color={AMBER} /> RLL rewards</h1>
                <p style={{ margin: '0 0 16px', color: c.secondaryText, fontSize: '0.88rem', lineHeight: 1.5 }}>
                    The rewards canister <code>{rllCanisterId}</code>. The public page is <Link to="/rll" style={{ color: c.accent }}>/rll</Link>; imports, balances, the admin list and the reset tools are on <Link to="/admin/rewards" style={{ color: c.accent }}>/admin/rewards</Link>.
                </p>
                {rllAdmin === false && (
                    <div style={{ ...s.card, borderColor: c.warning, color: c.primaryText, fontSize: '0.85rem' }}>
                        Your principal is not an admin of the RLL canister (its controllers, Sneed SNS governance and its admin list), so its tools are off. The incidents list is admin-only too.
                    </div>
                )}
                {notice && (
                    <div style={{ ...s.card, borderColor: notice.ok ? c.success : c.error, color: c.primaryText, fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ wordBreak: 'break-word' }}>{notice.text}</span>
                        <button type="button" onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', color: c.mutedText, cursor: 'pointer' }}>×</button>
                    </div>
                )}

                <ClaimsCard identity={identity} isAuthenticated={isAuthenticated} />
                <CycleCard identity={identity} canAct={canAct} setNotice={setNotice} setConfirm={setConfirm} />
                <TokensCard identity={identity} canAct={canAct} setNotice={setNotice} setConfirm={setConfirm} />
                <StatsCard />
                {canAct && <IncidentsCard identity={identity} />}
            </div>
            {confirm && <ConfirmationModal show onClose={() => setConfirm(null)} onSubmit={confirm.run} doAwait message={confirm.message} />}
        </>
    );
}
