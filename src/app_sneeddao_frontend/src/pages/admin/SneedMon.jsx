// /admin/mon: Sneed Monitor (sneed_mon, spec/sneed_mon.md §5) for admins. Status and economics
// (revenue against cycles burned), accounting, every setting (core, tuning, watch defaults,
// billing, price tiers), fee destination and sweep threshold, fee withdrawal, pause / resume /
// run now / interval, the Sneed Notifications connection, targets, and the admin list.
// The calls need a sneed_mon admin (or controller): others are refused at ingress.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { FaSatelliteDish, FaSpinner, FaSync, FaPlay, FaPause, FaTrash, FaPlus } from 'react-icons/fa';
import Header from '../../components/Header';
import PrincipalInput from '../../components/PrincipalInput';
import ConfirmationModal from '../../ConfirmationModal';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useDenomination } from '../../contexts/DenominationContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { PrincipalDisplay } from '../../utils/PrincipalUtils';
import priceService from '../../services/PriceService';
import { getCkUsdcTerms } from '../../utils/CyclePayService';
import { monEnabled, monId, monActor, tierLabel, fmtIcp, e8sToIcp, icpToE8s, unwrap } from '../../utils/SneedMonService';

const accent = '#f59e0b';
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const isPrincipal = (v) => v && typeof v === 'object' && typeof v.toText === 'function' && !Array.isArray(v);
const nsDate = (ns) => (BigInt(ns) > 0n ? new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleString() : 'never');
const tc = (cycles) => `${(Number(cycles) / 1e12).toLocaleString(undefined, { maximumFractionDigits: 4 })} T`;
const label = (k) => k.replace(/_/g, ' ');

// A flat record (nat / bool / principal / opt principal fields) as strings for inputs, and back.
const toDraft = (rec, skip = []) => Object.fromEntries(Object.entries(rec).filter(([k]) => !skip.includes(k)).flatMap(([k, v]) => {
    if (typeof v === 'bigint') return [[k, String(v)]];
    if (typeof v === 'boolean') return [[k, v]];
    if (isPrincipal(v)) return [[k, v.toText()]];
    if (Array.isArray(v) && (v.length === 0 || isPrincipal(v[0]))) return [[k, v.length ? v[0].toText() : '']];
    return [];
}));
const fromDraft = (orig, draft) => Object.fromEntries(Object.entries(orig).map(([k, v]) => {
    if (!(k in draft)) return [k, v];
    const x = draft[k];
    if (typeof v === 'bigint') { if (!/^\d+$/.test(String(x).trim())) throw new Error(`${label(k)}: a whole number`); return [k, BigInt(String(x).trim())]; }
    if (typeof v === 'boolean') return [k, !!x];
    try {
        if (isPrincipal(v)) return [k, Principal.fromText(String(x).trim())];
        return [k, String(x).trim() ? [Principal.fromText(String(x).trim())] : []];
    } catch { throw new Error(`${label(k)}: not a principal`); }
}));

export default function AdminSneedMon() {
    const { theme, isDark } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated } = useAuth();
    const { formatValue } = useDenomination();
    const { isAdmin, loading: adminLoading } = useAdminCheck({ identity, isAuthenticated, redirectPath: '/admin' });
    const actor = useMemo(() => (identity && monEnabled ? monActor(identity) : null), [identity]);

    const [s, setS] = useState(null); // { status, config, accounting, admins, targets }
    const [drafts, setDrafts] = useState({}); // section -> draft
    const [notice, setNotice] = useState(null); // { ok, text }
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState(null); // { message, run }
    const [icpUsd, setIcpUsd] = useState(null);
    const [cyclesPerUsd, setCyclesPerUsd] = useState(1e12 / 1.35); // 1 XDR ≈ $1.35 until CyclePay answers
    const [newAdmin, setNewAdmin] = useState('');
    const [notifId, setNotifId] = useState('');
    const [appIdText, setAppIdText] = useState('');
    const [destOwner, setDestOwner] = useState('');
    const [destSub, setDestSub] = useState('');
    const [threshold, setThreshold] = useState('');
    const [interval, setIntervalText] = useState('');
    const [wd, setWd] = useState({ amount: '', to: '' });

    const load = useCallback(async () => {
        const [status, config, accounting, admins, targets] = await Promise.all([actor.get_status(), actor.get_config(), actor.get_accounting(), actor.get_admins(), actor.get_targets()]);
        setS({ status, config, accounting, admins, targets });
        setDrafts({
            core: toDraft(config.core),
            tuning: toDraft(config.tuning),
            defaults: toDraft(config.tuning.defaults),
            billing: toDraft(config.billing, ['fee_destination', 'fee_sweep_threshold_e8s']),
            tiers: { base: String(config.tiers.base_daily_price_e8s), rows: config.tiers.tiers.map((t) => ({ every_min: String(t.every_min), daily_multiplier: String(t.daily_multiplier) })) },
        });
        setNotifId(config.core.notifications.length ? config.core.notifications[0].toText() : '');
        setAppIdText(status.app_id.length ? String(status.app_id[0]) : '');
        const dest = config.billing.fee_destination.length ? config.billing.fee_destination[0] : null;
        setDestOwner(dest ? dest.owner.toText() : '');
        setDestSub(dest && dest.subaccount.length ? hexOf(dest.subaccount[0]) : '');
        setThreshold(String(e8sToIcp(config.billing.fee_sweep_threshold_e8s)));
        setIntervalText(String(config.core.interval_s));
    }, [actor]);
    useEffect(() => { if (isAdmin && actor) load().catch((e) => setNotice({ ok: false, text: e.message })); }, [isAdmin, actor, load]);
    useEffect(() => {
        priceService.getICPUSDPrice().then((p) => setIcpUsd(Number(p) || null)).catch(() => {});
        getCkUsdcTerms().then((t) => { if (t.cyclesPerUsd) setCyclesPerUsd(t.cyclesPerUsd); }).catch(() => {});
    }, []);
    useEffect(() => { if (identity && !wd.to) setWd((w) => ({ ...w, to: identity.getPrincipal().toText() })); }, [identity, wd.to]);

    const run = async (f, okText) => {
        setBusy(true); setNotice(null);
        try { const r = await f(); setNotice({ ok: true, text: okText || (typeof r === 'string' ? r : 'Done') }); await load(); }
        catch (e) { setNotice({ ok: false, text: e.message || String(e) }); } finally { setBusy(false); }
    };
    const ask = (message, f, okText) => setConfirm({ message, run: () => run(f, okText) });

    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16 };
    const h2 = { margin: '0 0 8px', fontSize: '1.1rem', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 8 };
    const muted = { color: c.mutedText, fontSize: 13 };
    const input = { padding: '7px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: 13, boxSizing: 'border-box', colorScheme: isDark ? 'dark' : 'light' };
    const btn = (primary) => ({ padding: '7px 14px', borderRadius: 8, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? accent : 'transparent', color: primary ? '#111' : c.primaryText, fontWeight: 600, fontSize: 13, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 });
    const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 8 };
    const kv = (k, v) => <div key={k} style={{ fontSize: 13, color: c.secondaryText }}><span style={{ color: c.mutedText }}>{k}: </span><span style={{ color: c.primaryText }}>{v}</span></div>;

    const page = (body) => (
        <>
            <Header />
            <div style={{ maxWidth: 980, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <h1 style={{ margin: '0 0 4px', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 10 }}><FaSatelliteDish color={accent} /> Sneed Monitor</h1>
                <p style={{ margin: '0 0 16px', color: c.secondaryText, fontSize: 14 }}>
                    Proposal watcher, paid per check (<a href="/api-docs/sneed_mon.md" style={{ color: accent }}>API</a> · <Link to="/help/monitor" style={{ color: accent }}>help</Link>){monId && <> · canister <code>{monId}</code></>}
                </p>
                {body}
            </div>
        </>
    );
    if (adminLoading) return page(<div style={{ ...muted, padding: 30, textAlign: 'center' }}><FaSpinner /> Loading…</div>);
    if (!isAdmin) return page(<div style={{ ...muted, padding: 30, textAlign: 'center' }}>Admins only.</div>);
    if (!monEnabled) return page(<div style={card}><p style={muted}>Sneed Monitor has no canister on this network yet.</p></div>);
    if (!s) return page(<>{notice && <div style={{ ...card, borderColor: c.error, color: c.primaryText }}>{notice.text}</div>}<div style={{ ...muted, padding: 30, textAlign: 'center' }}><FaSpinner /> Loading…</div></>);

    const { status: st, config, accounting: acc, admins, targets } = s;
    const usdOfE8s = (e8s) => (icpUsd ? e8sToIcp(e8s) * icpUsd : null);
    const usdOfCycles = (cy) => Number(cy) / cyclesPerUsd;
    const money = (e8s) => `${fmtIcp(e8s)}${usdOfE8s(e8s) != null ? ` (≈ ${formatValue(usdOfE8s(e8s))})` : ''}`;
    const iAmMonAdmin = identity && admins.some((p) => p.toText() === identity.getPrincipal().toText());

    // a flat record editor
    const editor = (section, skipNote) => (
        <div style={grid}>
            {Object.entries(drafts[section] || {}).map(([k, v]) => (
                <label key={k} style={{ display: 'grid', gap: 3, fontSize: 12, color: c.mutedText }}>
                    {typeof v === 'boolean'
                        ? <span style={{ display: 'flex', gap: 6, alignItems: 'center', color: c.secondaryText }}><input type="checkbox" checked={v} onChange={(e) => setDrafts({ ...drafts, [section]: { ...drafts[section], [k]: e.target.checked } })} /> {label(k)}</span>
                        : <>{label(k)}<input value={v} onChange={(e) => setDrafts({ ...drafts, [section]: { ...drafts[section], [k]: e.target.value } })} style={{ ...input, width: '100%', fontFamily: /^\d*$/.test(v) ? 'inherit' : 'monospace' }} /></>}
                </label>
            ))}
            {skipNote && <div style={{ ...muted, fontSize: 12, gridColumn: '1 / -1' }}>{skipNote}</div>}
        </div>
    );
    const period = (name, p) => {
        const rev = usdOfE8s(p.revenue_e8s);
        const cost = usdOfCycles(p.cycles_burned);
        return (
            <tr key={name} style={{ borderTop: `1px solid ${c.border}` }}>
                <td style={{ padding: 6, color: c.primaryText }}>{name}</td>
                <td style={{ padding: 6 }}>{fmtIcp(p.revenue_e8s)}{rev != null && <div style={muted}>≈ {formatValue(rev)}</div>}</td>
                <td style={{ padding: 6 }}>{tc(p.cycles_burned)}<div style={muted}>≈ {formatValue(cost)}</div></td>
                <td style={{ padding: 6, color: rev == null || cost === 0 ? c.mutedText : rev >= cost ? (c.success || '#10b981') : (c.error || '#ef4444') }}>{rev == null || cost === 0 ? '–' : `${(rev / cost).toFixed(2)}×`}</td>
                <td style={{ padding: 6 }}>{String(p.checks)}</td>
                <td style={{ padding: 6 }}>{String(p.rounds)}</td>
            </tr>
        );
    };
    const tiersDraft = drafts.tiers || { base: '0', rows: [] };
    const tierPreview = (r) => {
        try { const daily = BigInt(tiersDraft.base) * BigInt(r.daily_multiplier); return `${fmtIcp((daily * BigInt(r.every_min)) / 1440n)} a check · ${fmtIcp(daily)} a day`; } catch { return ''; }
    };

    return page(
        <>
            {notice && <div role="status" onClick={() => setNotice(null)} style={{ ...card, borderColor: notice.ok ? (c.success || '#10b981') : (c.error || '#ef4444'), color: c.primaryText, cursor: 'pointer' }}>{notice.text}</div>}
            {!iAmMonAdmin && <div style={{ ...card, borderColor: accent, ...muted }}>You are not on sneed_mon's admin list (a controller can still act). Changes from others are refused at ingress.</div>}

            <section style={card}>
                <h2 style={h2}>Status <button type="button" style={{ ...btn(false), marginLeft: 'auto', padding: '4px 10px' }} disabled={busy} onClick={() => run(load, 'Reloaded')}><FaSync size={11} /> Reload</button></h2>
                <div style={grid}>
                    {kv('State', st.paused ? 'paused' : st.running ? 'round running' : 'idle')}
                    {kv('Users / watches / targets', `${st.users} / ${st.watches} / ${st.targets}`)}
                    {kv('Paused users', String(st.paused_users))}
                    {kv('Open proposals', String(st.open_proposals))}
                    {kv('Rounds', `${st.rounds} (every ${st.interval_s} s)`)}
                    {kv('Last round', `${nsDate(st.last_round_start)} · ${(Number(st.last_round_duration_ns) / 1e9).toFixed(1)} s · ${st.round_ticks} ticks`)}
                    {kv('Calls', `${st.calls_last_round} last round · ${st.calls_total} total`)}
                    {kv('Sent / deduplicated', `${st.sent} / ${st.deduplicated}`)}
                    {kv('Skipped', `${st.skipped_not_allowed} not allowed · ${st.skipped_rate_limited} rate limited · ${st.skipped_other} other`)}
                    {kv('Errors', String(st.errors))}
                    {kv('Cycles', tc(st.cycles))}
                    {kv('Notifications app', st.app_id.length ? `#${st.app_id[0]}` : 'not registered')}
                </div>
                {st.last_error.length > 0 && <div style={{ ...muted, color: c.error, marginTop: 8 }}>Last error ({nsDate(st.last_error[0][0])}): {st.last_error[0][1]}</div>}
                <div style={{ ...muted, marginTop: 8 }}>Backlog: {st.backlog.round_open ? 'round open · ' : ''}{String(st.backlog.ballots_to_fetch)} ballot reads, {String(st.backlog.pending_messages)} messages for {String(st.backlog.users_with_pending)} users, {String(st.backlog.checks_due)} checks due, neuron caches {String(st.backlog.neuron_caches_missing)} missing / {String(st.backlog.neuron_caches_stale)} stale</div>
                <div style={{ ...row, marginTop: 12 }}>
                    {st.paused
                        ? <button type="button" style={btn(true)} disabled={busy} onClick={() => run(async () => unwrap(await actor.admin_resume()))}><FaPlay size={11} /> Resume</button>
                        : <button type="button" style={btn(false)} disabled={busy} onClick={() => run(async () => unwrap(await actor.admin_pause()))}><FaPause size={11} /> Pause</button>}
                    <button type="button" style={btn(false)} disabled={busy || st.paused} onClick={() => run(async () => unwrap(await actor.admin_run_now()))}>Run a round now</button>
                    <span style={muted}>Interval</span>
                    <input value={interval} onChange={(e) => setIntervalText(e.target.value)} style={{ ...input, width: 80 }} aria-label="Interval in seconds" /><span style={muted}>s</span>
                    <button type="button" style={btn(false)} disabled={busy || !/^\d+$/.test(interval)} onClick={() => run(async () => unwrap(await actor.admin_set_interval(BigInt(interval))))}>Set</button>
                </div>
            </section>

            <section style={card}>
                <h2 style={h2}>Economics</h2>
                <p style={{ ...muted, marginTop: 0 }}>Revenue is what users were charged; cycles burned is what the canister's balance went down by during its ticks (cycles received meanwhile hide some of it). Cycles in {formatValue(1)} at {Math.round(cyclesPerUsd / 1e9).toLocaleString()} B cycles per dollar. Last round: {tc(st.economics.last_round_cycles)}.</p>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, color: c.secondaryText }}>
                        <thead><tr style={{ textAlign: 'left', color: c.mutedText }}><th style={{ padding: 6 }}>Period</th><th style={{ padding: 6 }}>Revenue</th><th style={{ padding: 6 }}>Cycles burned</th><th style={{ padding: 6 }}>Revenue / cost</th><th style={{ padding: 6 }}>Checks</th><th style={{ padding: 6 }}>Rounds</th></tr></thead>
                        <tbody>{period('Last 24 h', st.economics.last_24h)}{period('Last 30 days', st.economics.last_30d)}{period('Total', st.economics.total)}</tbody>
                    </table>
                </div>
            </section>

            <section style={card}>
                <h2 style={h2}>Accounting</h2>
                <div style={grid}>
                    {kv('User balances', money(acc.user_balances_e8s))}
                    {kv('Fees available', money(acc.fees_available_e8s))}
                    {kv('Obligations (main account holds at least)', fmtIcp(acc.obligations_e8s))}
                    {kv('Fees collected', fmtIcp(acc.fees_collected_e8s))}
                    {kv('Fees forwarded', `${fmtIcp(acc.fees_forwarded_e8s)} in ${acc.fee_forwards} transfers`)}
                    {kv('Fees withdrawn (all)', fmtIcp(acc.fees_withdrawn_e8s))}
                    {kv('Deposits / withdrawals', `${fmtIcp(acc.deposits_e8s)} / ${fmtIcp(acc.withdrawals_e8s)}`)}
                    {kv('Accounts', `${acc.accounts} (${acc.paused_users} paused)`)}
                    {kv('Ledger', acc.icp_ledger.toText())}
                </div>
                <h3 style={{ ...h2, fontSize: 14, marginTop: 14 }}>Withdraw fees</h3>
                <div style={row}>
                    <input value={wd.amount} onChange={(e) => setWd({ ...wd, amount: e.target.value })} placeholder="ICP" style={{ ...input, width: 110 }} aria-label="Fees to withdraw in ICP" />
                    <button type="button" style={btn(false)} onClick={() => setWd({ ...wd, amount: String(e8sToIcp(acc.fees_available_e8s)) })}>All available</button>
                    <button type="button" style={btn(true)} disabled={busy || icpToE8s(wd.amount) <= 0n} onClick={() => {
                        let to; try { to = Principal.fromText(wd.to.trim()); } catch { setNotice({ ok: false, text: 'Enter a valid principal to receive the fees' }); return; }
                        const amount = icpToE8s(wd.amount);
                        ask(`Withdraw ${fmtIcp(amount)} of collected fees to ${to.toText()} (it receives the amount less the ledger fee)?`, async () => `Sent, ledger block ${unwrap(await actor.admin_withdraw_fees(amount, { owner: to, subaccount: [] }))}`);
                    }}>Withdraw</button>
                </div>
                <div style={{ marginTop: 6 }}><PrincipalInput value={wd.to} onChange={(v) => setWd({ ...wd, to: v })} isAuthenticated={isAuthenticated} /></div>
            </section>

            <section style={card}>
                <h2 style={h2}>Fees: destination and sweep threshold</h2>
                <p style={{ ...muted, marginTop: 0 }}>
                    Collected fees go in one transfer to this account once they reach the threshold (default: the RLL's ICP splitter, as Sneed Premium).
                    Now: {config.billing.fee_destination.length ? <><PrincipalDisplay principal={config.billing.fee_destination[0].owner} short isAuthenticated={isAuthenticated} />{config.billing.fee_destination[0].subaccount.length > 0 && <> · <code style={{ wordBreak: 'break-all' }}>{hexOf(config.billing.fee_destination[0].subaccount[0])}</code></>}</> : 'none: fees stay in the canister for withdrawal'}.
                </p>
                <PrincipalInput value={destOwner} onChange={setDestOwner} isAuthenticated={isAuthenticated} placeholder="Destination principal (empty: keep fees in the canister)" />
                <input value={destSub} onChange={(e) => setDestSub(e.target.value)} placeholder="Subaccount, 64 hex characters (optional)" style={{ ...input, width: '100%', marginTop: 8, fontFamily: 'monospace' }} />
                <div style={{ ...row, marginTop: 8 }}>
                    <button type="button" style={btn(true)} disabled={busy} onClick={() => {
                        const h = destSub.trim().toLowerCase();
                        if (h && !/^[0-9a-f]{64}$/.test(h)) { setNotice({ ok: false, text: 'A subaccount is 64 hex characters' }); return; }
                        let acct = null;
                        if (destOwner.trim()) { try { acct = { owner: Principal.fromText(destOwner.trim()), subaccount: h ? [fromHex(h)] : [] }; } catch { setNotice({ ok: false, text: 'Not a valid principal' }); return; } }
                        ask(acct ? `Send collected fees to ${acct.owner.toText()}${h ? ` (subaccount ${h})` : ''}? Funds sent to a wrong account cannot be recovered.` : 'Keep collected fees in the canister (no automatic forwarding)?',
                            async () => unwrap(await actor.admin_set_fee_destination(acct ? [acct] : [])), 'Fee destination saved');
                    }}>Save destination</button>
                    <span style={muted}>Threshold</span>
                    <input value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ ...input, width: 100 }} aria-label="Sweep threshold in ICP" /><span style={muted}>ICP</span>
                    <button type="button" style={btn(false)} disabled={busy || !(Number(threshold) >= 0)} onClick={() => run(async () => unwrap(await actor.admin_set_fee_sweep_threshold(BigInt(Math.round(Number(threshold) * 1e8)))), 'Threshold saved')}>Save threshold</button>
                </div>
            </section>

            <section style={card}>
                <h2 style={h2}>Prices (tiers)</h2>
                <p style={{ ...muted, marginTop: 0 }}>Per check = floor(base × multiplier × every_min / 1440). every_min must be at least 10 and divide 1440; the default frequency and tiers in use must stay.</p>
                <div style={row}>
                    <span style={muted}>Base daily price</span>
                    <input value={tiersDraft.base} onChange={(e) => setDrafts({ ...drafts, tiers: { ...tiersDraft, base: e.target.value } })} style={{ ...input, width: 120 }} aria-label="Base daily price in e8s" />
                    <span style={muted}>e8s ({/^\d+$/.test(tiersDraft.base) ? fmtIcp(BigInt(tiersDraft.base)) : '?'} a day)</span>
                </div>
                {tiersDraft.rows.map((r, i) => (
                    <div key={i} style={{ ...row, marginTop: 6 }}>
                        <input value={r.every_min} onChange={(e) => setDrafts({ ...drafts, tiers: { ...tiersDraft, rows: tiersDraft.rows.map((x, j) => (j === i ? { ...x, every_min: e.target.value } : x)) } })} style={{ ...input, width: 70 }} aria-label="every_min" />
                        <span style={muted}>min ×</span>
                        <input value={r.daily_multiplier} onChange={(e) => setDrafts({ ...drafts, tiers: { ...tiersDraft, rows: tiersDraft.rows.map((x, j) => (j === i ? { ...x, daily_multiplier: e.target.value } : x)) } })} style={{ ...input, width: 60 }} aria-label="daily multiplier" />
                        <span style={muted}>{/^\d+$/.test(r.every_min) ? tierLabel(r.every_min) : ''} · {tierPreview(r)}</span>
                        <button type="button" style={{ ...btn(false), padding: '4px 8px' }} onClick={() => setDrafts({ ...drafts, tiers: { ...tiersDraft, rows: tiersDraft.rows.filter((_, j) => j !== i) } })} aria-label="Remove tier"><FaTrash size={11} /></button>
                    </div>
                ))}
                <div style={{ ...row, marginTop: 8 }}>
                    <button type="button" style={btn(false)} onClick={() => setDrafts({ ...drafts, tiers: { ...tiersDraft, rows: [...tiersDraft.rows, { every_min: '', daily_multiplier: '1' }] } })}><FaPlus size={11} /> Tier</button>
                    <button type="button" style={btn(true)} disabled={busy} onClick={() => {
                        if (![tiersDraft.base, ...tiersDraft.rows.flatMap((r) => [r.every_min, r.daily_multiplier])].every((x) => /^\d+$/.test(String(x).trim()))) { setNotice({ ok: false, text: 'Tiers: whole numbers only' }); return; }
                        const t = { base_daily_price_e8s: BigInt(tiersDraft.base), tiers: tiersDraft.rows.map((r) => ({ every_min: BigInt(r.every_min), daily_multiplier: BigInt(r.daily_multiplier) })) };
                        ask(`Set the base price to ${fmtIcp(t.base_daily_price_e8s)} a day with ${t.tiers.length} tiers? It applies to every user's next check.`, async () => unwrap(await actor.admin_set_tiers(t)), 'Tiers saved');
                    }}>Save tiers</button>
                </div>
            </section>

            <section style={card}>
                <h2 style={h2}>Core config</h2>
                {editor('core', 'Notifications canister: empty for none (setting it here also works; the dedicated control below clears the app id).')}
                <button type="button" style={{ ...btn(true), marginTop: 10 }} disabled={busy} onClick={() => run(async () => unwrap(await actor.admin_set_config(fromDraft(config.core, drafts.core))), 'Config saved')}>Save core</button>
            </section>

            <section style={card}>
                <h2 style={h2}>Tuning and watch defaults</h2>
                {editor('tuning')}
                <h3 style={{ ...h2, fontSize: 14, marginTop: 14 }}>Defaults for watch(target)</h3>
                {editor('defaults', `Topics: ${'all' in config.tuning.defaults.topics ? 'all' : config.tuning.defaults.topics.only.join(', ')} (kept). every_min is a tier; reminder window 3600, 14400, 43200, 86400 or 172800 s, at least the interval.`)}
                <button type="button" style={{ ...btn(true), marginTop: 10 }} disabled={busy} onClick={() => run(async () => unwrap(await actor.admin_set_tuning({ ...fromDraft(config.tuning, drafts.tuning), defaults: fromDraft(config.tuning.defaults, drafts.defaults) })), 'Tuning saved')}>Save tuning</button>
            </section>

            <section style={card}>
                <h2 style={h2}>Billing</h2>
                {editor('billing', 'The ledger can only change while no user balances are held. Fee destination and threshold are set above.')}
                <button type="button" style={{ ...btn(true), marginTop: 10 }} disabled={busy} onClick={() => {
                    let b; try { b = fromDraft(config.billing, drafts.billing); } catch (e) { setNotice({ ok: false, text: e.message }); return; }
                    ask(`Save billing: ledger ${b.icp_ledger.toText()}, ledger fee ${b.ledger_fee_e8s} e8s?`, async () => unwrap(await actor.admin_set_billing(b)), 'Billing saved');
                }}>Save billing</button>
            </section>

            <section style={card}>
                <h2 style={h2}>Sneed Notifications</h2>
                <p style={{ ...muted, marginTop: 0 }}>Now: {config.core.notifications.length ? <code>{config.core.notifications[0].toText()}</code> : 'none'} · app {st.app_id.length ? `#${st.app_id[0]}` : 'not registered'}.</p>
                <PrincipalInput value={notifId} onChange={setNotifId} isAuthenticated={isAuthenticated} defaultPrincipalType="canisters" placeholder="Sneed Notifications canister id (empty: none)" />
                <div style={{ ...row, marginTop: 8 }}>
                    <button type="button" style={btn(false)} disabled={busy} onClick={() => {
                        let p = []; if (notifId.trim()) { try { p = [Principal.fromText(notifId.trim())]; } catch { setNotice({ ok: false, text: 'Not a valid canister id' }); return; } }
                        ask('Change the notifications canister? This clears the app id; register or set it again afterwards.', async () => unwrap(await actor.admin_set_notifications_canister(p)), 'Notifications canister saved');
                    }}>Set canister</button>
                    <button type="button" style={btn(false)} disabled={busy} onClick={() => run(async () => `Registered as app #${unwrap(await actor.admin_register_with_notifications())}`)}>Register app</button>
                    <button type="button" style={btn(false)} disabled={busy || !st.app_id.length} onClick={() => run(async () => unwrap(await actor.admin_update_notifications_app()))}>Update app (name, topics)</button>
                </div>
                <div style={{ ...row, marginTop: 8 }}>
                    <span style={muted}>App id</span>
                    <input value={appIdText} onChange={(e) => setAppIdText(e.target.value)} style={{ ...input, width: 80 }} aria-label="App id" />
                    <button type="button" style={btn(false)} disabled={busy || !/^\d*$/.test(appIdText.trim())} onClick={() => run(async () => unwrap(await actor.admin_set_app_id(appIdText.trim() ? [BigInt(appIdText.trim())] : [])), 'App id saved')}>Set app id</button>
                </div>
            </section>

            <section style={card}>
                <h2 style={h2}>Targets ({targets.length})</h2>
                {targets.length === 0 && <p style={muted}>Nothing watched.</p>}
                {targets.map((t) => (
                    <div key={'nns' in t.target ? 'nns' : t.target.sns.toText()} style={{ borderTop: `1px solid ${c.border}`, padding: '6px 0', fontSize: 13, color: c.secondaryText }}>
                        <strong style={{ color: c.primaryText }}>{t.name}</strong> · {String(t.watchers)} watchers ({String(t.active_watchers)} active) · polled {t.poll_every_min.length ? tierLabel(t.poll_every_min[0]).toLowerCase() : 'never (no active watcher)'} · {t.open.length} open · listed {nsDate(t.listed_at)}
                        {t.last_error.length > 0 && <div style={{ color: c.error }}>{String(t.errors)} errors; last: {t.last_error[0][1]}</div>}
                    </div>
                ))}
            </section>

            <section style={card}>
                <h2 style={h2}>Admins</h2>
                <p style={{ ...muted, marginTop: 0 }}>Controllers are admins too. Also on <Link to="/admin/admins" style={{ color: accent }}>/admin/admins</Link>.</p>
                {admins.length === 0 && <p style={muted}>No listed admins.</p>}
                {admins.map((p) => (
                    <div key={p.toText()} style={{ ...row, borderTop: `1px solid ${c.border}`, padding: '6px 0' }}>
                        <span style={{ flex: 1, minWidth: 0 }}><PrincipalDisplay principal={p} short isAuthenticated={isAuthenticated} /></span>
                        <button type="button" style={btn(false)} disabled={busy} onClick={() => ask(`Remove ${p.toText()} from sneed_mon's admins?`, async () => unwrap(await actor.admin_remove_admin(p)), 'Admin removed')}><FaTrash size={11} /> Remove</button>
                    </div>
                ))}
                <div style={{ marginTop: 8 }}><PrincipalInput value={newAdmin} onChange={setNewAdmin} isAuthenticated={isAuthenticated} defaultPrincipalType="users" /></div>
                <button type="button" style={{ ...btn(true), marginTop: 8 }} disabled={busy || !newAdmin.trim()} onClick={() => {
                    let p; try { p = Principal.fromText(newAdmin.trim()); } catch { setNotice({ ok: false, text: 'Not a valid principal' }); return; }
                    run(async () => { const r = unwrap(await actor.admin_add_admin(p)); setNewAdmin(''); return r; }, 'Admin added');
                }}><FaPlus size={11} /> Add admin</button>
            </section>

            {confirm && <ConfirmationModal show onClose={() => setConfirm(null)} onSubmit={async () => { const f = confirm.run; setConfirm(null); await f(); }} doAwait message={confirm.message} />}
        </>
    );
}
