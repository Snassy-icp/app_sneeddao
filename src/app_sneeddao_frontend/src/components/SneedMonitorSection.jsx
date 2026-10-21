// Sneed Monitor on /notifications (sneed_mon, spec/sneed_mon.md): proposals the user's neurons can
// vote on, told through Sneed Notifications while Sneed Hub is closed. Casual: one switch that
// watches every SNS where the logged-in user has vote neurons (and the NNS when the app knows their
// NNS neurons), with the deposit step when the balance can't pay. Advanced: per-watch frequency,
// topics, reminders, manual SNS targets, NNS neuron ids, charges and withdrawals.
// Renders nothing on a network where sneed_mon has no canister id (prod, for now).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaSatelliteDish, FaChevronDown, FaChevronRight, FaCopy, FaSync, FaTrash, FaPlus, FaWallet, FaHistory, FaExclamationTriangle } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { useDenomination } from '../contexts/DenominationContext';
import priceService from '../services/PriceService';
import PrincipalInput from './PrincipalInput';
import { computeAccountId } from '../utils/PrincipalUtils';
import { getAllSnses, getSnsById } from '../utils/SnsUtils';
import { getRelevantSnses, getRelevantNnsNeurons } from '../utils/VotableProposalsUtils';
import { getNnsNeuronId } from '../utils/NnsUtils';
import {
    monEnabled, monActor, NNS_TARGET, snsTarget, targetKey, tierLabel, REMINDER_WINDOWS,
    e8sToIcp, fmtIcp, icpToE8s, encodeAccount, sendIcp,
} from '../utils/SneedMonService';

const accent = '#f59e0b';
const MONTH_DAYS = 30;
const opt = (v) => (v === undefined ? [] : [v]);
const noChange = { every_min: [], topics: [], new_proposals: [], reminders: [], reminder_window_s: [] };
const nsToDate = (ns) => new Date(Number(BigInt(ns) / 1_000_000n));

/// notifActor: the Sneed Notifications actor of the page; myApps: its get_my_apps ([[App, Permission]]);
/// onNotificationsChanged: reloads the page's notification data; setMsg: the page's status line.
export default function SneedMonitorSection({ notifActor, myApps, onNotificationsChanged, setMsg }) {
    const { theme, isDark } = useTheme();
    const c = theme.colors;
    const { identity } = useAuth();
    const wallet = useWalletOptional();
    const neuronCache = wallet?.neuronCache;
    const { formatValue } = useDenomination();

    const actor = useMemo(() => (identity && monEnabled ? monActor(identity) : null), [identity]);
    const [d, setD] = useState(null); // { balance, watches, tiers, nnsIds, config, appId }
    const [loadErr, setLoadErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const [icpUsd, setIcpUsd] = useState(null);
    const [showDeposit, setShowDeposit] = useState(false);
    const [pendingEnable, setPendingEnable] = useState(false); // turn on once the deposit is credited
    const [topUpAmt, setTopUpAmt] = useState('');
    const [advanced, setAdvanced] = useState(false);
    const [topicEdit, setTopicEdit] = useState(null); // { key, options, chosen: Set }
    const [addRoot, setAddRoot] = useState('');
    const [nnsDraft, setNnsDraft] = useState(null); // text, null until edited
    const [charges, setCharges] = useState(null); // { total, entries, start }
    const [wdAmount, setWdAmount] = useState('');
    const [wdTo, setWdTo] = useState('');

    const load = useCallback(async () => {
        if (!actor) return;
        const [balance, watches, tiers, nnsIds, config, status] = await Promise.all([
            actor.get_my_balance(), actor.get_my_watches(), actor.get_tiers(), actor.get_my_nns_neurons(), actor.get_config(), actor.get_status(),
        ]);
        setD({ balance, watches, tiers, nnsIds: Array.from(nnsIds), config, appId: status.app_id.length ? status.app_id[0] : null });
        setLoadErr(null);
    }, [actor]);
    useEffect(() => { load().catch((e) => setLoadErr(e.message || String(e))); }, [load]);
    useEffect(() => { priceService.getICPUSDPrice().then((p) => setIcpUsd(Number(p) || null)).catch(() => {}); }, []);
    useEffect(() => { if (identity && !wdTo) setWdTo(identity.getPrincipal().toText()); }, [identity, wdTo]);

    // what the app knows of the user's neurons: SNSes with vote neurons, and NNS neuron ids
    const found = useMemo(() => {
        if (!identity || !neuronCache) return { snses: [], nnsIds: [] };
        const snses = getRelevantSnses(neuronCache, identity).map(({ sns, neurons }) => ({ root: sns.rootCanisterId, name: sns.name, neurons: neurons.length }));
        const nnsIds = getRelevantNnsNeurons(neuronCache, identity).map(getNnsNeuronId).filter((x) => x != null);
        return { snses, nnsIds };
    }, [identity, neuronCache]);

    if (!monEnabled || !identity) return null;

    const card = { background: c.cardBg || c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1rem 1.1rem', marginBottom: '1rem' };
    const h2 = { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 0.5rem', fontSize: '1.05rem', color: c.primaryText };
    const h3 = { ...h2, fontSize: '0.95rem', margin: '1.1rem 0 0.5rem' };
    const muted = { color: c.mutedText, fontSize: '0.82rem', lineHeight: 1.5 };
    const btn = (primary) => ({ padding: '7px 12px', borderRadius: 8, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? accent : 'transparent', color: primary ? '#111' : c.primaryText, fontWeight: 600, fontSize: '0.85rem', cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 });
    const field = { background: c.secondaryBg, color: c.primaryText, border: `1px solid ${c.border}`, borderRadius: 8, padding: '6px 8px', fontSize: '0.85rem', colorScheme: isDark ? 'dark' : 'light' };
    const optStyle = { background: c.secondaryBg, color: c.primaryText };
    const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };

    if (loadErr && !d) return <div style={card}><h2 style={h2}><FaSatelliteDish color={accent} /> Sneed Monitor</h2><p style={{ ...muted, color: c.error }}>Sneed Monitor did not answer: {loadErr}</p></div>;
    if (!d) return <div style={card}><h2 style={h2}><FaSatelliteDish color={accent} /> Sneed Monitor</h2><p style={muted}>Loading…</p></div>;

    const { balance, watches, tiers, config } = d;
    const fee = config.billing.ledger_fee_e8s;
    const tierOf = (min) => tiers.tiers.find((t) => t.every_min === BigInt(min));
    const defMin = config.tuning.defaults.every_min;
    const defTier = tierOf(defMin);
    const maxWatches = Number(config.core.max_watches_per_user);
    const watching = new Set(watches.map((w) => targetKey(w.target)));
    const usd = (e8s) => (icpUsd ? formatValue(e8sToIcp(e8s) * icpUsd) : null);
    const money = (e8s) => <>{fmtIcp(e8s)}{usd(e8s) && <span style={{ color: c.mutedText }}> (≈ {usd(e8s)})</span>}</>;
    const nameOf = (t) => {
        const w = watches.find((x) => targetKey(x.target) === targetKey(t));
        if (w) return w.name;
        if ('nns' in t) return 'NNS';
        return getSnsById(t.sns.toText())?.name || t.sns.toText();
    };

    // the casual plan: SNSes with vote neurons, plus the NNS when the app knows NNS neurons
    const planTargets = [
        ...found.snses.filter((s) => !watching.has(s.root)).map((s) => snsTarget(s.root)),
        ...(found.nnsIds.length && !watching.has('nns') ? [NNS_TARGET] : []),
    ].slice(0, Math.max(0, maxWatches - watches.length));
    const skippedForCap = found.snses.filter((s) => !watching.has(s.root)).length + (found.nnsIds.length && !watching.has('nns') ? 1 : 0) - planTargets.length;
    const needForPlan = balance.per_round_of_checks_e8s + BigInt(planTargets.length) * (defTier?.per_check_e8s || 0n);
    const monthNow = balance.per_day_e8s * BigInt(MONTH_DAYS);
    const monthPlan = (balance.per_day_e8s + BigInt(planTargets.length) * (defTier?.daily_price_e8s || 0n)) * BigInt(MONTH_DAYS);
    const on = watches.length > 0;
    const suggestTopUp = (need) => {
        const e8s = need > monthPlan ? need : monthPlan;
        return String(Math.max(0.01, Math.ceil(e8sToIcp(e8s) * 100) / 100));
    };

    const run = async (f) => {
        setBusy(true); setMsg(null);
        try { await f(); } catch (e) { setMsg({ err: e.message || String(e) }); } finally { setBusy(false); load().catch(() => {}); }
    };
    const ok = (r) => { if (r && 'err' in r) throw new Error(r.err); return r?.ok; };

    // allow "Sneed Monitor" in Sneed Notifications unless it is allowed already
    const allowApp = async () => {
        if (d.appId == null || !notifActor) return false;
        const mine = (myApps || []).find(([a]) => a.id === d.appId);
        if (mine && mine[1].allowed) return false;
        ok(await notifActor.allow_app(d.appId, true));
        return true;
    };

    const enableNow = async (targets) => {
        const errors = [];
        let done = 0;
        if (targets.some((t) => 'nns' in t)) {
            const merged = [...new Set([...d.nnsIds, ...found.nnsIds].map(String))].slice(0, Number(config.tuning.max_nns_neurons)).map((x) => BigInt(x));
            ok(await actor.set_nns_neurons(merged));
        }
        for (const t of targets) {
            const r = await actor.watch(t);
            if ('err' in r) errors.push(`${nameOf(t)}: ${r.err}`); else done++;
        }
        const allowed = await allowApp();
        if (allowed) onNotificationsChanged?.();
        const parts = [`Watching ${done} more ${done === 1 ? 'place' : 'places'}`];
        if (allowed) parts.push('Sneed Monitor may now notify you');
        if (errors.length) setMsg({ err: `${parts.join('; ')}. Not watched: ${errors.join('; ')}` });
        else setMsg({ ok: `${parts.join('; ')}.` });
    };

    const turnOn = () => run(async () => {
        if (!planTargets.length) {
            setMsg({ err: found.snses.length || found.nnsIds.length ? 'You are watching everything we found already.' : 'We have not found neurons you can vote with yet (they load in the background after you log in). Add an SNS under Advanced, or try again in a moment.' });
            return;
        }
        if (balance.balance_e8s < needForPlan) {
            setPendingEnable(true); setShowDeposit(true);
            if (!topUpAmt) setTopUpAmt(suggestTopUp(needForPlan - balance.balance_e8s));
            setMsg({ ok: 'Top up your Sneed Monitor balance first; monitoring turns on when it arrives.' });
            return;
        }
        await enableNow(planTargets);
    });
    const turnOff = () => run(async () => {
        for (const w of watches) ok(await actor.unwatch(w.target));
        setPendingEnable(false);
        setMsg({ ok: `Stopped. Nothing more is charged; your balance (${fmtIcp(balance.balance_e8s)}) stays until you withdraw it under Advanced.` });
    });

    // after a credit: go on with turning monitoring on, when that was what the deposit was for
    const afterCredit = async (credited) => {
        const fresh = await actor.get_my_balance();
        if (credited === 0n) { setMsg({ err: 'Nothing has arrived at your deposit address yet. Transfers usually land within seconds; try again shortly.' }); return; }
        if (pendingEnable && planTargets.length && fresh.balance_e8s >= needForPlan) {
            setPendingEnable(false); setShowDeposit(false);
            await enableNow(planTargets);
            return;
        }
        setMsg({ ok: `Credited ${fmtIcp(credited)}. Your balance: ${fmtIcp(fresh.balance_e8s)}.` });
    };
    const creditDeposit = () => run(async () => {
        const r = ok(await actor.credit_deposit());
        await afterCredit(r.credited_e8s);
    });
    const topUpFromWallet = () => run(async () => {
        const amount = icpToE8s(topUpAmt);
        if (amount <= 0n) throw new Error('Enter an amount of ICP');
        // send amount + one fee, so the balance grows by `amount` after credit_deposit's own transfer
        await sendIcp(identity, config.billing.icp_ledger, { owner: balance.deposit_account.owner, subaccount: balance.deposit_account.subaccount }, amount + fee);
        const r = ok(await actor.credit_deposit());
        await afterCredit(r.credited_e8s);
    });

    const updateWatch = (t, patch, okText) => run(async () => { ok(await actor.update_watch(t, { ...noChange, ...patch })); if (okText) setMsg({ ok: okText }); });
    const setFrequency = (w, min) => {
        const patch = { every_min: [BigInt(min)] };
        // a reminder window shorter than the check interval is refused: move it up with it
        if (w.settings.reminder_window_s < BigInt(min) * 60n) patch.reminder_window_s = [BigInt(REMINDER_WINDOWS.find((x) => x.s >= min * 60).s)];
        updateWatch(w.target, patch, `${w.name}: ${tierLabel(min).toLowerCase()}`);
    };
    const openTopics = (w) => run(async () => {
        const key = targetKey(w.target);
        if (topicEdit?.key === key) { setTopicEdit(null); return; }
        const cached = await actor.get_target_topics(w.target);
        const options = cached.length ? cached[0] : ok(await actor.list_target_topics(w.target));
        const chosen = 'all' in w.settings.topics ? new Set(options.map((o) => o.key)) : new Set(w.settings.topics.only);
        setTopicEdit({ key, target: w.target, options, chosen });
    });
    const saveTopics = () => {
        const { target, options, chosen } = topicEdit;
        if (!chosen.size) { setMsg({ err: 'Choose at least one topic, or stop watching this one.' }); return; }
        const all = options.every((o) => chosen.has(o.key));
        updateWatch(target, { topics: [all ? { all: null } : { only: [...chosen] }] }, 'Topics saved');
        setTopicEdit(null);
    };
    const loadCharges = (start = 0) => run(async () => {
        const r = await actor.get_my_charges(BigInt(start), 20n);
        setCharges({ total: Number(r.total), entries: r.entries, start });
    });
    const withdraw = () => run(async () => {
        const amount = icpToE8s(wdAmount);
        if (amount <= fee) throw new Error(`Withdraw more than the ledger fee (${fmtIcp(fee)})`);
        let owner;
        try { owner = Principal.fromText(wdTo.trim()); } catch { throw new Error('Enter a valid principal to receive it'); }
        const block = ok(await actor.withdraw_balance(amount, { owner, subaccount: [] }));
        setWdAmount('');
        setMsg({ ok: `Withdrawn: ${fmtIcp(amount - fee)} sent (ledger block ${block}).` });
    });
    const saveNns = () => run(async () => {
        const ids = (nnsDraft || '').split(/[\s,]+/).filter(Boolean);
        if (ids.some((x) => !/^\d+$/.test(x))) throw new Error('NNS neuron ids are numbers, separated by commas or spaces');
        ok(await actor.set_nns_neurons([...new Set(ids)].map((x) => BigInt(x))));
        setNnsDraft(null);
        setMsg({ ok: ids.length ? `${new Set(ids).size} NNS neurons registered` : 'NNS neurons cleared' });
    });

    const depositAcct = balance.deposit_account;
    const depositText = encodeAccount(depositAcct);
    const legacyId = computeAccountId(depositAcct.owner, depositAcct.subaccount.length ? depositAcct.subaccount[0] : null);
    const copy = (text, what) => { navigator.clipboard?.writeText(text).then(() => setMsg({ ok: `${what} copied` })).catch(() => {}); };
    const snsOptions = getAllSnses().filter((s) => !watching.has(s.rootCanisterId)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const nnsText = nnsDraft ?? d.nnsIds.map(String).join(', ');

    return (
        <div style={card} id="sneed-monitor">
            <h2 style={h2}><FaSatelliteDish color={accent} /> Sneed Monitor</h2>
            <p style={{ ...muted, marginTop: 0 }}>
                Get a message when one of your neurons can vote on a proposal, and a reminder before voting closes, even while Sneed Hub is closed.
                You pay a small amount per check from a prepaid ICP balance. <Link to="/help/monitor" style={{ color: accent }}>How it works</Link>
            </p>

            {/* the casual switch */}
            <div style={{ ...row, justifyContent: 'space-between', padding: '10px 0', borderTop: `1px solid ${c.border}` }}>
                <span style={{ color: c.primaryText, fontWeight: 600, flex: 1, minWidth: 200 }}>Tell me about proposals I can vote on</span>
                <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={on ? turnOff : turnOn}
                    style={{ width: 52, height: 28, borderRadius: 999, border: 'none', padding: 3, cursor: busy ? 'wait' : 'pointer', background: on ? '#10b981' : c.border, display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', transition: 'background .2s' }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'block' }} />
                </button>
            </div>
            <div style={{ ...muted, display: 'grid', gap: 4 }}>
                <span>Balance: <strong style={{ color: c.primaryText }}>{money(balance.balance_e8s)}</strong></span>
                {on
                    ? <span>Watching {watches.map((w) => w.name).join(', ')}. Estimated cost: <strong style={{ color: c.primaryText }}>≈ {money(monthNow)} a month</strong>{balance.per_day_e8s > 0n && balance.balance_e8s > 0n && <> · lasts about {Math.floor(Number(balance.balance_e8s) / Number(balance.per_day_e8s))} days</>}</span>
                    : planTargets.length > 0
                        ? <span>Turning it on watches {planTargets.map(nameOf).join(', ')} ({tierLabel(defMin).toLowerCase()} checks): <strong style={{ color: c.primaryText }}>≈ {money(monthPlan)} a month</strong>.</span>
                        : <span>{wallet?.neuronCacheInitialized ? 'We have not found neurons you can vote with. You can still watch an SNS under Advanced.' : 'Looking for your neurons…'}</span>}
                {on && planTargets.length > 0 && <span>Also found: {planTargets.map(nameOf).join(', ')}. <button type="button" style={{ ...btn(false), padding: '2px 8px', fontSize: '0.78rem' }} disabled={busy} onClick={turnOn}>Watch them too</button></span>}
                {skippedForCap > 0 && <span>At most {maxWatches} watches per user: {skippedForCap} left out.</span>}
                {balance.paused && <span style={{ color: c.error || '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}><FaExclamationTriangle /> Paused: your balance can't pay the next check. Top up to resume (watches are kept).</span>}
            </div>
            <div style={{ ...row, marginTop: 10 }}>
                <button type="button" style={btn(showDeposit)} disabled={busy} onClick={() => { setShowDeposit(!showDeposit); if (!topUpAmt) setTopUpAmt(suggestTopUp(0n)); }}><FaWallet /> Top up</button>
            </div>

            {showDeposit && (
                <div style={{ marginTop: 12, padding: '12px', borderRadius: 10, border: `1px solid ${accent}`, display: 'grid', gap: 10 }}>
                    {pendingEnable && <div style={{ ...muted, color: c.primaryText }}>Monitoring needs at least {money(needForPlan)} to start (one check of each watch). Top up below; it turns on as soon as the ICP is credited.</div>}
                    <div>
                        <div style={{ ...muted, fontWeight: 600, color: c.primaryText }}>From your Sneed Hub wallet</div>
                        <div style={{ ...row, marginTop: 6 }}>
                            <input type="number" min="0.0001" step="0.01" value={topUpAmt} onChange={(e) => setTopUpAmt(e.target.value)} style={{ ...field, width: 120 }} aria-label="Amount in ICP" />
                            <span style={muted}>ICP{usd(icpToE8s(topUpAmt)) && ` (≈ ${usd(icpToE8s(topUpAmt))})`}</span>
                            <button type="button" style={btn(true)} disabled={busy || icpToE8s(topUpAmt) <= 0n} onClick={topUpFromWallet}>Top up from my wallet</button>
                        </div>
                        <div style={{ ...muted, fontSize: '0.75rem', marginTop: 4 }}>Two ledger fees ({fmtIcp(fee * 2n)}) come on top: one for sending, one for moving it into your balance.</div>
                    </div>
                    <div>
                        <div style={{ ...muted, fontWeight: 600, color: c.primaryText }}>Or send ICP from any wallet to your deposit address</div>
                        <div style={{ ...row, marginTop: 6 }}>
                            <code style={{ fontSize: '0.75rem', wordBreak: 'break-all', color: c.secondaryText, flex: 1, minWidth: 0 }}>{depositText}</code>
                            <button type="button" style={btn(false)} onClick={() => copy(depositText, 'Deposit address')} aria-label="Copy deposit address"><FaCopy /></button>
                        </div>
                        {legacyId && (
                            <div style={{ ...row, marginTop: 4 }}>
                                <span style={{ ...muted, fontSize: '0.75rem' }}>Account id (for exchanges):</span>
                                <code style={{ fontSize: '0.72rem', wordBreak: 'break-all', color: c.secondaryText, flex: 1, minWidth: 0 }}>{legacyId}</code>
                                <button type="button" style={btn(false)} onClick={() => copy(legacyId, 'Account id')} aria-label="Copy account id"><FaCopy /></button>
                            </div>
                        )}
                        <div style={{ ...row, marginTop: 8 }}>
                            <button type="button" style={btn(true)} disabled={busy} onClick={creditDeposit}>I've sent it: check deposit</button>
                            <span style={{ ...muted, fontSize: '0.75rem' }}>Moving it into your balance costs one ledger fee ({fmtIcp(fee)}).</span>
                        </div>
                    </div>
                </div>
            )}

            {/* pro */}
            <button type="button" onClick={() => { setAdvanced(!advanced); if (!advanced && !charges) loadCharges(0); }} style={{ background: 'none', border: 'none', color: c.primaryText, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '14px 0 0', fontWeight: 600 }}>
                {advanced ? <FaChevronDown size={11} /> : <FaChevronRight size={11} />} Advanced
            </button>
            {advanced && (
                <div style={{ paddingTop: 4 }}>
                    <h3 style={h3}>Prices per check</h3>
                    <div style={{ ...muted, display: 'grid', gap: 2 }}>
                        {tiers.tiers.map((t) => (
                            <span key={String(t.every_min)}>{tierLabel(t.every_min)}: {fmtIcp(t.per_check_e8s)} a check, {money(t.daily_price_e8s * BigInt(MONTH_DAYS))} a month</span>
                        ))}
                        <span style={{ fontSize: '0.75rem' }}>An SNS or the NNS checked more often hears sooner; messages themselves are priced by Sneed Notifications (Sneed SMS is free).</span>
                    </div>

                    <h3 style={h3}>Watches ({watches.length} of {maxWatches})</h3>
                    {watches.length === 0 && <p style={muted}>Nothing watched yet.</p>}
                    {watches.map((w) => {
                        const key = targetKey(w.target);
                        const s = w.settings;
                        return (
                            <div key={key} style={{ borderTop: `1px solid ${c.border}`, padding: '10px 0', display: 'grid', gap: 8, fontSize: '0.85rem', color: c.secondaryText }}>
                                <div style={row}>
                                    <strong style={{ color: c.primaryText, flex: 1, minWidth: 140 }}>{w.name}</strong>
                                    <span style={muted}>{fmtIcp(w.price_per_check_e8s)} a check</span>
                                    <button type="button" style={btn(false)} disabled={busy} onClick={() => run(async () => { ok(await actor.unwatch(w.target)); setMsg({ ok: `Stopped watching ${w.name}` }); })} aria-label={`Stop watching ${w.name}`}><FaTrash size={11} /> Remove</button>
                                </div>
                                <div style={row}>
                                    <label style={row}>Check
                                        <select style={field} value={String(s.every_min)} disabled={busy} onChange={(e) => setFrequency(w, Number(e.target.value))}>
                                            {tiers.tiers.map((t) => <option key={String(t.every_min)} value={String(t.every_min)} style={optStyle}>{tierLabel(t.every_min)} · {fmtIcp(t.per_check_e8s)}</option>)}
                                        </select>
                                    </label>
                                    <button type="button" style={btn(false)} disabled={busy} onClick={() => openTopics(w)}>Topics: {'all' in s.topics ? 'all' : `${s.topics.only.length} chosen`}</button>
                                </div>
                                {topicEdit?.key === key && (
                                    <div style={{ padding: '8px 10px', border: `1px solid ${c.border}`, borderRadius: 8, display: 'grid', gap: 4 }}>
                                        {topicEdit.options.map((o) => (
                                            <label key={o.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }} title={o.description}>
                                                <input type="checkbox" checked={topicEdit.chosen.has(o.key)} onChange={(e) => { const n = new Set(topicEdit.chosen); if (e.target.checked) n.add(o.key); else n.delete(o.key); setTopicEdit({ ...topicEdit, chosen: n }); }} />
                                                <span>{o.name}{o.description && <span style={{ ...muted, display: 'block', fontSize: '0.75rem' }}>{o.description.length > 140 ? `${o.description.slice(0, 140)}…` : o.description}</span>}</span>
                                            </label>
                                        ))}
                                        <div style={row}>
                                            <button type="button" style={btn(true)} disabled={busy} onClick={saveTopics}>Save topics</button>
                                            <button type="button" style={btn(false)} onClick={() => setTopicEdit({ ...topicEdit, chosen: new Set(topicEdit.options.map((o) => o.key)) })}>All</button>
                                            <button type="button" style={btn(false)} onClick={() => setTopicEdit(null)}>Cancel</button>
                                        </div>
                                    </div>
                                )}
                                <div style={row}>
                                    <label><input type="checkbox" checked={s.new_proposals} disabled={busy} onChange={(e) => updateWatch(w.target, { new_proposals: [e.target.checked] })} /> New proposals</label>
                                    <label><input type="checkbox" checked={s.reminders} disabled={busy} onChange={(e) => updateWatch(w.target, { reminders: [e.target.checked] })} /> Reminders</label>
                                    {s.reminders && (
                                        <select style={field} value={String(s.reminder_window_s)} disabled={busy} onChange={(e) => updateWatch(w.target, { reminder_window_s: [BigInt(e.target.value)] })}>
                                            {REMINDER_WINDOWS.filter((x) => BigInt(x.s) >= s.every_min * 60n).map((x) => <option key={x.s} value={String(x.s)} style={optStyle}>{x.label} before it closes</option>)}
                                        </select>
                                    )}
                                </div>
                                <div style={{ ...row, ...muted }}>
                                    <span>{'nns' in w.target ? `${w.neurons.length ? String(w.neurons[0]) : 0} NNS neurons registered` : w.neurons.length ? `${String(w.neurons[0])} of your neurons can vote here` : 'neurons not read yet'}</span>
                                    {w.pending > 0n && <span>· {String(w.pending)} waiting</span>}
                                    <span>· next check {nsToDate(w.next_check_at).toLocaleString()}</span>
                                    {'sns' in w.target && <button type="button" style={{ ...btn(false), padding: '3px 8px', fontSize: '0.75rem' }} disabled={busy} onClick={() => run(async () => { const n = ok(await actor.refresh_my_neurons(w.target)); setMsg({ ok: `${w.name}: ${n} of your neurons can vote` }); })}><FaSync size={10} /> Refresh neurons</button>}
                                </div>
                            </div>
                        );
                    })}

                    {watches.length < maxWatches && (
                        <div style={{ ...row, marginTop: 8 }}>
                            <select style={{ ...field, flex: 1, minWidth: 180, maxWidth: '100%' }} value={addRoot} onChange={(e) => setAddRoot(e.target.value)} aria-label="SNS to watch">
                                <option value="" style={optStyle}>Choose an SNS…</option>
                                {!watching.has('nns') && <option value="nns" style={optStyle}>NNS (Internet Computer)</option>}
                                {snsOptions.map((s) => <option key={s.rootCanisterId} value={s.rootCanisterId} style={optStyle}>{s.name || s.rootCanisterId}</option>)}
                            </select>
                            <button type="button" style={btn(true)} disabled={busy || !addRoot} onClick={() => run(async () => {
                                const t = addRoot === 'nns' ? NNS_TARGET : snsTarget(addRoot);
                                const r = ok(await actor.watch(t));
                                const allowed = await allowApp();
                                if (allowed) onNotificationsChanged?.();
                                setAddRoot('');
                                setMsg({ ok: `${r}${allowed ? '. Sneed Monitor may now notify you.' : ''}` });
                            })}><FaPlus size={11} /> Watch</button>
                        </div>
                    )}

                    <h3 style={h3}>NNS neurons</h3>
                    <p style={{ ...muted, marginTop: 0 }}>The NNS only shows a neuron's ballots to its owner, so Sneed Monitor reads the public info of the neuron ids you register (at most {String(config.tuning.max_nns_neurons)}). No hotkey needed.</p>
                    <div style={row}>
                        <input value={nnsText} onChange={(e) => setNnsDraft(e.target.value)} placeholder="Neuron ids, separated by commas" style={{ ...field, flex: 1, minWidth: 200 }} aria-label="NNS neuron ids" />
                        <button type="button" style={btn(true)} disabled={busy || nnsDraft === null} onClick={saveNns}>Save</button>
                        {found.nnsIds.length > 0 && <button type="button" style={btn(false)} disabled={busy} onClick={() => setNnsDraft([...new Set([...d.nnsIds, ...found.nnsIds].map(String))].join(', '))}>Use my NNS neurons ({found.nnsIds.length})</button>}
                    </div>

                    <h3 style={h3}><FaWallet color={accent} /> Balance</h3>
                    <div style={{ ...muted, display: 'grid', gap: 2 }}>
                        <span>Balance {fmtIcp(balance.balance_e8s)} · deposited {fmtIcp(balance.deposited_e8s)} · charged {fmtIcp(balance.charged_e8s)} for {String(balance.checks)} checks · withdrawn {fmtIcp(balance.withdrawn_e8s)}</span>
                        <span>Your watches cost {fmtIcp(balance.per_day_e8s)} a day; one round of checks {fmtIcp(balance.per_round_of_checks_e8s)}.</span>
                    </div>
                    <div style={{ ...row, marginTop: 8 }}>
                        <input type="number" min="0" step="0.0001" value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} placeholder="ICP" style={{ ...field, width: 110 }} aria-label="Amount to withdraw in ICP" />
                        <button type="button" style={btn(false)} disabled={busy} onClick={() => setWdAmount(String(e8sToIcp(balance.balance_e8s)))}>All</button>
                        <button type="button" style={btn(true)} disabled={busy || icpToE8s(wdAmount) <= fee} onClick={withdraw}>Withdraw</button>
                    </div>
                    <div style={{ marginTop: 6 }}>
                        <div style={{ ...muted, fontSize: '0.75rem', marginBottom: 4 }}>To (your own wallet unless you change it); the ledger fee ({fmtIcp(fee)}) comes off the amount.</div>
                        <PrincipalInput value={wdTo} onChange={setWdTo} isAuthenticated defaultPrincipalType="users" />
                    </div>

                    <h3 style={h3}><FaHistory color={accent} /> Charges</h3>
                    {!charges && <p style={muted}>Loading…</p>}
                    {charges && charges.entries.length === 0 && <p style={muted}>No checks charged yet.</p>}
                    {charges && charges.entries.map((e, i) => (
                        <div key={`${charges.start}-${i}`} style={{ ...row, borderTop: `1px solid ${c.border}`, padding: '5px 0', fontSize: '0.8rem', color: c.secondaryText }}>
                            <span style={{ minWidth: 140 }}>{nsToDate(e.at).toLocaleString()}</span>
                            <span style={{ flex: 1, minWidth: 120, color: c.primaryText }}>{nameOf(e.target)}</span>
                            <span>{tierLabel(e.every_min).toLowerCase()}</span>
                            <span>{fmtIcp(e.price_e8s)}</span>
                            <span style={{ ...muted, flexBasis: '100%' }}>{e.outcome}</span>
                        </div>
                    ))}
                    {charges && charges.total > 20 && (
                        <div style={{ ...row, marginTop: 6 }}>
                            <button type="button" style={btn(false)} disabled={busy || charges.start === 0} onClick={() => loadCharges(Math.max(0, charges.start - 20))}>Newer</button>
                            <span style={muted}>{charges.start + 1}–{Math.min(charges.total, charges.start + 20)} of {charges.total}</span>
                            <button type="button" style={btn(false)} disabled={busy || charges.start + 20 >= charges.total} onClick={() => loadCharges(charges.start + 20)}>Older</button>
                        </div>
                    )}
                    {charges && <button type="button" style={{ ...btn(false), marginTop: 6 }} disabled={busy} onClick={() => loadCharges(charges.start)}><FaSync size={11} /> Refresh</button>}
                </div>
            )}
        </div>
    );
}
