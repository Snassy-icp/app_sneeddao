// /guardian: the custody canisters' console. Per deployment: its rules and
// blessed versions, every child with cycles and policy, the open ops with the
// actions each visitor may take (stage, go-ahead, veto, execute, cancel), and
// approval by DAO proposal through the registered generic function.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import { FaShieldAlt, FaSpinner, FaSync, FaCheck, FaBan, FaPlay, FaTimes, FaPlus, FaExternalLinkAlt } from 'react-icons/fa';
import Header from '../components/Header';
import PrincipalInput from '../components/PrincipalInput';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { GUARDIANS, guardianIdl, policySummary } from '../tokensafety/guardianIdl.js';
import { customStyles } from '../health/TreeView.jsx';
import SpecialPricesCard from '../components/SpecialPricesCard';
import PriceTierBadge from '../components/PriceTierBadge';
import { fetchSpecialPricesFor, effectivePrice } from '../utils/specialPrices';

const HOST = 'https://icp-api.io';
const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const SNEED_GOVERNANCE = 'fi3zi-fyaaa-aaaaq-aachq-cai';
const SUBMIT_PROPOSAL = 3;
const amber = '#f59e0b';
const hex = (b) => Array.from(b || [], (x) => x.toString(16).padStart(2, '0')).join('');
const short = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '—');
const fmtT = (c) => `${(Number(c) / 1e12).toFixed(2)} T`;
const when = (ns) => (ns && Number(ns) ? new Date(Number(ns) / 1e6).toLocaleString() : '—');
const stateOf = (op) => Object.keys(op.state)[0];
const opText = (op, children) => {
    const k = op.kind; const child = children.find((c) => c.canister_id.toText() === op.child.toText());
    const who = child ? child.title : op.child.toText();
    if ('set_controllers' in k) return `${who}: set controllers to ${k.set_controllers.map((p) => p.toText()).join(', ')}`;
    if ('install' in k) return `${who}: upgrade to ${short(hex(k.install.hash))}`;
    if ('set_policy' in k) return `${who}: ${policySummary(k.set_policy)}`;
    if ('set_config' in k) return 'the guardian: change configuration';
    if ('set_approvers' in k) return `the guardian: approvers ${k.set_approvers.approvers.map((p) => p.toText()).join(', ')}, threshold ${k.set_approvers.threshold}`;
    return '?';
};

function Guardian() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const [params, setParams] = useSearchParams();
    const dep = GUARDIANS.find((g) => g.key === params.get('deployment')) || GUARDIANS[0] || null;
    const focusChild = params.get('child') || '';
    const me = identity?.getPrincipal?.().toText?.() || null;
    const [cfg, setCfg] = useState(null);
    const [children, setChildren] = useState([]);
    const [ops, setOps] = useState([]);
    const [upgradable, setUpgradable] = useState([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState('');
    const [showAllOps, setShowAllOps] = useState(false);
    const [stage, setStage] = useState(null); // { child, kind: 'policy'|'controllers'|'install', ... }
    const [neurons, setNeurons] = useState(null);
    const [payFor, setPayFor] = useState(null); // op id whose payment panel is open
    const [payment, setPayment] = useState(null); // { account, fee_e8s, amount_to_send_e8s, paid_e8s }
    const actor = useCallback((withIdentity) => {
        if (!dep) return null;
        return Actor.createActor(guardianIdl, { agent: new HttpAgent({ host: HOST, ...(withIdentity && identity ? { identity } : {}) }), canisterId: dep.id });
    }, [dep, identity]);

    const load = useCallback(async () => {
        const a = actor(false); if (!a) return;
        setError('');
        try {
            const [c, ch, o, u] = await Promise.all([a.get_config(), a.list_children(), a.list_ops(false, 200n), a.list_upgradable()]);
            setCfg(c); setChildren(ch); setOps(o); setUpgradable(u);
        } catch (e) { setError(`Could not read ${dep?.name}: ${e?.message || e}`); }
    }, [actor, dep]);
    useEffect(() => { load(); }, [load]);

    // the payment panel: below `actor`, which its dependency list reads during render
    useEffect(() => {
        if (payFor === null) { setPayment(null); return; }
        let live = true;
        actor(false).get_op_payment(payFor).then((r) => { if (live) setPayment('Ok' in r ? r.Ok : { error: r.Err }); }).catch((e) => { if (live) setPayment({ error: e?.message || String(e) }); });
        return () => { live = false; };
    }, [payFor, actor, ops]);
    const payNow = async (op) => {
        if (!payment || payment.error) return;
        await call(`Pay the fee of op #${op.id}`, async () => {
            const ledger = createLedgerActor(ICP_LEDGER, { agentOptions: { identity, host: HOST } });
            const due = payment.amount_to_send_e8s - payment.paid_e8s;
            if (due <= 0n) return null;
            const r = await ledger.icrc1_transfer({ from_subaccount: [], to: { owner: payment.account.owner, subaccount: payment.account.subaccount }, amount: due, fee: [], memo: [], created_at_time: [] });
            if ('Err' in r) throw new Error(`transfer failed: ${JSON.stringify(r.Err, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
            return null;
        });
        setPayFor(op.id);
    };
    const accountText = (acc) => `${acc.owner.toText()} · subaccount ${hex(acc.subaccount[0])}`;


    // my proposal-capable neurons in Sneed DAO, for approving by proposal
    useEffect(() => {
        if (!identity || !dep) { setNeurons(null); return; }
        let live = true;
        (async () => {
            try {
                const gov = createSnsGovernanceActor(SNEED_GOVERNANCE, { agentOptions: { identity, host: HOST } });
                const r = await gov.list_neurons({ of_principal: [identity.getPrincipal()], limit: 100, start_page_at: [] });
                const mine = identity.getPrincipal().toText();
                if (live) setNeurons(r.neurons.filter((n) => n.id[0] && n.permissions.some((pm) => pm.principal[0]?.toText() === mine && pm.permission_type.includes(SUBMIT_PROPOSAL))));
            } catch { if (live) setNeurons([]); }
        })();
        return () => { live = false; };
    }, [identity, dep]);

    const call = async (label, fn) => {
        setBusy(label); setError(''); setNotice('');
        try { const r = await fn(); if (r && 'Err' in r) throw new Error(r.Err); setNotice(`${label}: done`); await load(); }
        catch (e) { setError(`${label}: ${e?.message || e}`); }
        finally { setBusy(''); }
    };
    const isGuardianOf = (child) => !!(me && child && child.policy.guardians.some((p) => p.toText() === me));
    const isAdmin = !!(cfg && me && cfg.admins.some((p) => p.toText() === me));
    // special prices (spec/special_prices.md): the admin card, and the caller's own op fee
    const adminActor = useMemo(() => (isAdmin ? actor(true) : null), [isAdmin, actor]);
    const specialFields = useMemo(() => [{ key: 'op_fee_e8s', label: 'Op fee', regular: cfg?.op_fee_e8s, premium: cfg?.premium_op_fee_e8s }], [cfg]);
    const [mySpecial, setMySpecial] = useState(null);
    useEffect(() => {
        if (!me || !dep) { setMySpecial(null); return; }
        let live = true;
        fetchSpecialPricesFor(actor(false), Principal.fromText(me)).then((r) => { if (live) setMySpecial(r); });
        return () => { live = false; };
    }, [me, dep, actor, cfg]);
    const myFee = cfg ? effectivePrice({ regular: cfg.op_fee_e8s, special: mySpecial, field: 'op_fee_e8s' }) : null;
    const isApprover = !!(cfg && me && (cfg.approvers.some((p) => p.toText() === me) || isAdmin));

    const functionId = cfg?.approve_function_id?.[0] ?? null;
    /// One step for a maintainer with a Sneed neuron: pay what is still due into the op's payment
    /// account, wait for the ledger to show it, then file the approval proposal from the neuron.
    const proposeApproval = async (op) => {
        if (functionId === null) { setError('The DAO has not registered the approve_op generic function for this deployment yet (an admin records its id here once it is). Until then, propose by hand: ExecuteGenericNervousSystemFunction with the function id and payload = candid (op id : nat).'); return; }
        if (!neurons?.length) { setError('You hold no Sneed neuron that may propose. Approval proposals are filed from your own neuron.'); return; }
        await call(`Pay and propose approval of op #${op.id}`, async () => {
            const a = actor(true);
            if (op.fee_e8s > 0n) {
                let pay = await a.get_op_payment(op.id);
                if ('Err' in pay) throw new Error(pay.Err);
                const due = pay.Ok.amount_to_send_e8s - pay.Ok.paid_e8s;
                if (due > 0n) {
                    const ledger = createLedgerActor(ICP_LEDGER, { agentOptions: { identity, host: HOST } });
                    const r = await ledger.icrc1_transfer({ from_subaccount: [], to: { owner: pay.Ok.account.owner, subaccount: pay.Ok.account.subaccount }, amount: due, fee: [], memo: [], created_at_time: [] });
                    if ('Err' in r) throw new Error(`fee transfer failed: ${JSON.stringify(r.Err, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
                    for (let i = 0; i < 10; i++) { pay = await a.get_op_payment(op.id); if ('Ok' in pay && pay.Ok.paid_e8s >= pay.Ok.amount_to_send_e8s) break; await new Promise((res) => setTimeout(res, 1500)); }
                }
            }
            const v = await a.validate_approve_op(op.id);
            if ('Err' in v) throw new Error(v.Err);
            const gov = createSnsGovernanceActor(SNEED_GOVERNANCE, { agentOptions: { identity, host: HOST } });
            const payload = new Uint8Array(IDL.encode([IDL.Nat], [op.id]));
            const r = await gov.manage_neuron({
                subaccount: neurons[0].id[0].id,
                command: [{ MakeProposal: {
                    title: `Approve custody op #${op.id}: ${opText(op, children).slice(0, 80)}`,
                    url: `https://app.sneeddao.com/guardian?deployment=${dep.key}`,
                    summary: `${opText(op, children)}\n\nStaged by ${op.staged_by.toText()}${op.memo ? ` with memo: ${op.memo}` : ''}.\n\nAdopting this proposal calls approve_op(${op.id}) on ${dep.name} (${dep.id}). The child's own rules (veto council, window) still apply before it executes.`,
                    action: [{ ExecuteGenericNervousSystemFunction: { function_id: BigInt(functionId), payload } }],
                } }],
            });
            const cmd = r.command[0];
            if (cmd && 'Error' in cmd) throw new Error(cmd.Error.error_message);
            return null;
        });
    };

    const stageIt = async () => {
        if (!stage) return;
        const a = actor(true);
        await call('Stage op', async () => {
            let kind;
            if (stage.kind === 'policy') kind = { set_policy: { guardians: stage.guardians.map((t) => Principal.fromText(t.trim())), vetoes_to_block: BigInt(stage.vetoesToBlock || 0), oks_required: BigInt(stage.oksRequired || 0), window_ns: BigInt(Math.round(Number(stage.windowDays || 0) * 86_400)) * 1_000_000_000n, auto_upgrade: !!stage.autoUpgrade } };
            else if (stage.kind === 'controllers') kind = { set_controllers: stage.controllers.map((t) => Principal.fromText(t.trim())) };
            else if (stage.kind === 'install') kind = { install: { hash: Uint8Array.from(stage.hash.match(/../g).map((h) => parseInt(h, 16))), arg: [] } };
            else throw new Error('unknown op');
            const r = await a.stage_op(Principal.fromText(stage.child), kind, stage.memo || '', []);
            if ('Ok' in r) { setStage(null); if (r.Ok.fee_e8s > 0n) setPayFor(r.Ok.id); }
            return r;
        });
    };

    const card = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem', marginBottom: 14 };
    const label = { fontSize: '0.72rem', fontWeight: 600, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' };
    const input = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.88rem', width: '100%', boxSizing: 'border-box' };
    const btn = (accent, disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: `1px solid ${accent || theme.colors.border}`, color: accent || theme.colors.primaryText, background: 'transparent', cursor: disabled ? 'default' : 'pointer', fontSize: '0.8rem', opacity: disabled ? 0.5 : 1 });
    const openOps = ops.filter((o) => ['pending', 'approved'].includes(stateOf(o)));
    const shownOps = showAllOps ? ops : openOps;
    const childOf = (id) => children.find((c) => c.canister_id.toText() === id);

    if (!dep) {
        return (<><Header /><div style={{ maxWidth: 900, margin: '0 auto', padding: '1.25rem 16px' }}><h1 style={{ color: theme.colors.primaryText }}>Custody</h1><div style={{ ...card, color: amber }}>No custody canister is deployed in this build yet.</div></div></>);
    }
    return (
        <>
            <Header />
            <style>{customStyles}</style>
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.6rem', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: 10 }}><FaShieldAlt color={amber} /> Custody</h1>
                        <p style={{ margin: '4px 0 0', color: theme.colors.secondaryText, fontSize: '0.9rem', maxWidth: 680, lineHeight: 1.5 }}>Ledgers held by Sneed's custody canisters: only NNS-blessed code, changed only by DAO vote and each ledger's own veto council. <Link to="/studio/launch" style={{ color: theme.colors.accent }}>Launch a token under custody</Link>.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {GUARDIANS.map((g) => <button key={g.key} type="button" onClick={() => setParams({ deployment: g.key })} style={{ ...btn(g.key === dep.key ? amber : null), background: g.key === dep.key ? `${amber}22` : 'transparent' }}>{g.name}</button>)}
                        <button type="button" onClick={load} style={btn()} title="Reload"><FaSync className={busy ? 'health-spin' : ''} /></button>
                    </div>
                </div>
                {error && <div style={{ ...card, color: theme.colors.error }}>{error}</div>}
                {notice && <div style={{ ...card, color: '#10b981' }}>{notice}</div>}

                {cfg && (
                    <div style={card}>
                        <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: 1.5 }}>{dep.blurb}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginTop: 10 }}>
                            {[['Canister', <span key="c" className="health-mono" style={{ fontSize: '0.78rem' }}>{dep.id}</span>],
                              ['Approvers', `${cfg.threshold} of ${cfg.approvers.length}`],
                              ['Children', String(cfg.children)],
                              ['Op fee', `${(Number(cfg.op_fee_e8s) / 1e8).toFixed(2)} ICP (premium ${(Number(cfg.premium_op_fee_e8s) / 1e8).toFixed(2)})`],
                              ['Own cycles', fmtT(cfg.own_cycles)],
                              ['Blessed versions', `${cfg.blessed.ledger.length} ledger, ${cfg.blessed.index.length} index, ${cfg.blessed.archive.length} archive${cfg.blessed_error.length ? ` · error: ${cfg.blessed_error[0]}` : ''}`],
                              ['Status run', when(cfg.status_last_run)],
                            ].map(([k, v]) => <div key={k} style={{ background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '8px 10px' }}><div style={label}>{k}</div><div style={{ fontSize: '0.9rem', color: theme.colors.primaryText, wordBreak: 'break-word' }}>{v}</div></div>)}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: theme.colors.mutedText, marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>Approvers: {cfg.approvers.map((p) => <PrincipalDisplay key={p.toText()} principal={p} short={true} showCopyButton={false} isAuthenticated={isAuthenticated} />)}{cfg.paused && <span style={{ color: amber }}>· paused</span>}</div>
                    </div>
                )}

                <div style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h2 style={{ margin: 0, fontSize: '1.1rem', color: theme.colors.primaryText }}>Children</h2>
                        {upgradable.length > 0 && <span style={{ fontSize: '0.8rem', color: amber }}>{upgradable.length} can move to a newer blessed version</span>}
                    </div>
                    {children.length === 0 && <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginTop: 8 }}>Nothing under custody yet.</div>}
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                        {children.map((c) => {
                            const id = c.canister_id.toText(); const st = c.status[0]; const up = upgradable.find((u) => u.canister_id.toText() === id);
                            const focus = focusChild === id;
                            return (
                                <div key={id} id={`child-${id}`} style={{ border: `1px solid ${focus ? amber : theme.colors.border}`, borderRadius: 10, padding: '10px 12px', background: theme.colors.secondaryBg }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, color: theme.colors.primaryText }}>{c.title} <span style={{ fontWeight: 400, color: theme.colors.mutedText, fontSize: '0.8rem' }}>{Object.keys(c.kind)[0]}</span></div>
                                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                <span className="health-mono">{id}</span>
                                                <Link to={`/studio/${c.suite[0] ? c.suite[0].toText() : id}`} style={{ color: theme.colors.accent }}>safety check</Link>
                                                <a href={`https://dashboard.internetcomputer.org/canister/${id}`} target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent }}>dashboard <FaExternalLinkAlt size={8} /></a>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: st && !st.error.length ? (st.cycles < (cfg?.low_cycles_threshold || 0n) ? theme.colors.error : theme.colors.primaryText) : amber, textAlign: 'right' }}>
                                            {st ? (st.error.length ? `status: ${st.error[0]}` : `${fmtT(st.cycles)} · ${st.running} · ${short(hex(st.module_hash[0]))}`) : 'not read yet'}
                                            <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText }}>{st ? when(st.at) : ''}</div>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, marginTop: 6 }}>Rules: {policySummary(c.policy)}{c.policy.guardians.length ? <> · council: {c.policy.guardians.map((p) => <PrincipalDisplay key={p.toText()} principal={p} short={true} showCopyButton={false} isAuthenticated={isAuthenticated} style={{ fontSize: '0.78rem' }} />)}</> : null}</div>
                                    {c.last_upgrade_error.length > 0 && <div style={{ fontSize: '0.78rem', color: amber, marginTop: 4 }}>Last upgrade attempt: {c.last_upgrade_error[0]}</div>}
                                    {c.last_upgrade.length > 0 && <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: 4 }}>Upgraded {when(c.last_upgrade[0].at)} to {short(hex(c.last_upgrade[0].to))} ({c.last_upgrade[0].by})</div>}
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                                        {isAuthenticated && <button type="button" style={btn()} onClick={() => setStage({ child: id, kind: 'policy', guardians: c.policy.guardians.map((p) => p.toText()), vetoesToBlock: String(c.policy.vetoes_to_block), oksRequired: String(c.policy.oks_required), windowDays: String(Number(c.policy.window_ns) / 86_400_000_000_000), autoUpgrade: c.policy.auto_upgrade, memo: '' })}><FaPlus size={10} /> Change rules</button>}
                                        {isAuthenticated && <button type="button" style={btn()} onClick={() => setStage({ child: id, kind: 'controllers', controllers: [dep.id], memo: '' })}><FaPlus size={10} /> Change controllers</button>}
                                        {isAuthenticated && up && !c.policy.auto_upgrade && <button type="button" style={btn(amber)} onClick={() => setStage({ child: id, kind: 'install', hash: hex(up.next), memo: `upgrade ${c.title} to the next blessed version` })}><FaPlus size={10} /> Upgrade to {short(hex(up.next))}</button>}
                                        <button type="button" style={btn()} disabled={!!busy} onClick={() => call('Refresh status', () => actor(true).refresh_status(c.canister_id))}><FaSync size={10} /> Read status</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {stage && (
                    <div style={{ ...card, borderColor: amber }}>
                        <h2 style={{ margin: '0 0 8px', fontSize: '1.05rem', color: theme.colors.primaryText }}>Stage an op on {childOf(stage.child)?.title || stage.child}</h2>
                        <div style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, marginBottom: 10, lineHeight: 1.5 }}>Anyone may stage. The op fee ({myFee ? (Number(myFee.amount) / 1e8).toFixed(myFee.tier === 'regular' ? 2 : 8) : '?'} ICP{myFee && <PriceTierBadge tier={myFee.tier} partnerLabel={myFee.partnerLabel} />}{myFee && myFee.tier === 'regular' && cfg && cfg.premium_op_fee_e8s < cfg.op_fee_e8s ? `, ${(Number(cfg.premium_op_fee_e8s) / 1e8).toFixed(2)} for Sneed Premium members` : ''}) is paid from your wallet. It then needs {cfg?.threshold} of {cfg?.approvers.length} approvers (by DAO proposal), passes the child's veto window, and anyone executes it.</div>
                        {stage.kind === 'policy' && (
                            <div style={{ display: 'grid', gap: 8 }}>
                                {stage.guardians.map((v, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <div style={{ flex: 1 }}><PrincipalInput value={v} onChange={(x) => setStage((s) => ({ ...s, guardians: s.guardians.map((y, j) => (j === i ? x : y)) }))} placeholder="Veto council member" defaultTab="all" style={{ width: '100%' }} inputStyle={input} isAuthenticated={isAuthenticated} /></div>
                                        <button type="button" style={btn()} onClick={() => setStage((s) => ({ ...s, guardians: s.guardians.filter((_, j) => j !== i) }))}><FaTimes size={10} /></button>
                                    </div>
                                ))}
                                <div><button type="button" style={btn()} onClick={() => setStage((s) => ({ ...s, guardians: [...s.guardians, ''] }))}><FaPlus size={10} /> Add a council member</button></div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, fontSize: '0.8rem', color: theme.colors.secondaryText }}>
                                    <label>Vetoes that block<input style={input} type="number" min="0" value={stage.vetoesToBlock} onChange={(e) => setStage((s) => ({ ...s, vetoesToBlock: e.target.value }))} /></label>
                                    <label>Go-aheads required<input style={input} type="number" min="0" value={stage.oksRequired} onChange={(e) => setStage((s) => ({ ...s, oksRequired: e.target.value }))} /></label>
                                    <label>Veto window (days)<input style={input} type="number" min="0" max="90" value={stage.windowDays} onChange={(e) => setStage((s) => ({ ...s, windowDays: e.target.value }))} /></label>
                                </div>
                                <label style={{ display: 'flex', gap: 8, fontSize: '0.85rem', color: theme.colors.primaryText }}><input type="checkbox" checked={!!stage.autoUpgrade} onChange={(e) => setStage((s) => ({ ...s, autoUpgrade: e.target.checked }))} /> Auto-upgrade to NNS-blessed versions</label>
                            </div>
                        )}
                        {stage.kind === 'controllers' && (
                            <div style={{ display: 'grid', gap: 8 }}>
                                <div style={{ fontSize: '0.8rem', color: amber }}>Leaving {dep.name} out of the list releases the canister from custody.</div>
                                {stage.controllers.map((v, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <div style={{ flex: 1 }}><PrincipalInput value={v} onChange={(x) => setStage((s) => ({ ...s, controllers: s.controllers.map((y, j) => (j === i ? x : y)) }))} placeholder="Controller" defaultTab="all" style={{ width: '100%' }} inputStyle={input} isAuthenticated={isAuthenticated} /></div>
                                        <button type="button" style={btn()} onClick={() => setStage((s) => ({ ...s, controllers: s.controllers.filter((_, j) => j !== i) }))}><FaTimes size={10} /></button>
                                    </div>
                                ))}
                                <div><button type="button" style={btn()} onClick={() => setStage((s) => ({ ...s, controllers: [...s.controllers, ''] }))}><FaPlus size={10} /> Add a controller</button></div>
                            </div>
                        )}
                        {stage.kind === 'install' && <div style={{ fontSize: '0.85rem', color: theme.colors.primaryText }}>Upgrade to blessed hash <span className="health-mono">{stage.hash}</span> (the next version after the current one; the guardian fetches the bytes from the NNS and checks the hash).</div>}
                        <label style={{ display: 'block', marginTop: 8, fontSize: '0.8rem', color: theme.colors.secondaryText }}>Memo<input style={input} value={stage.memo} maxLength={500} onChange={(e) => setStage((s) => ({ ...s, memo: e.target.value }))} /></label>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button type="button" style={{ ...btn(amber), background: `${amber}22` }} disabled={!!busy} onClick={stageIt}>{busy === 'Stage op' ? <FaSpinner className="health-spin" /> : <FaPlus size={10} />} Stage</button>
                            <button type="button" style={btn()} onClick={() => setStage(null)}>Cancel</button>
                        </div>
                    </div>
                )}

                {adminActor && <SpecialPricesCard actor={adminActor} fields={specialFields} />}

                <div style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h2 style={{ margin: 0, fontSize: '1.1rem', color: theme.colors.primaryText }}>Ops</h2>
                        <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showAllOps} onChange={(e) => setShowAllOps(e.target.checked)} /> show closed ops</label>
                    </div>
                    {isApprover && <div style={{ fontSize: '0.8rem', color: amber, marginTop: 6 }}>You are an {isAdmin ? 'admin' : 'approver'} of this deployment{isAdmin ? ': your approval alone counts as the whole threshold' : ''}.</div>}
                    {cfg && cfg.admins.length > 0 && <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>Admins (trial period): {cfg.admins.map((p) => <PrincipalDisplay key={p.toText()} principal={p} short={true} showCopyButton={false} isAuthenticated={isAuthenticated} />)}{isAdmin && <button type="button" style={btn()} disabled={!!busy} onClick={() => call('Remove me as admin', () => actor(true).admin_remove_admin(Principal.fromText(me)))}>remove me</button>}</div>}
                    {cfg && <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: 4 }}>approve_op generic function id: {functionId !== null ? String(functionId) : 'not registered yet'}{isAdmin && <button type="button" style={{ ...btn(), marginLeft: 8 }} disabled={!!busy} onClick={() => { const v = window.prompt('The id of the DAO generic function that calls approve_op (empty to clear)', functionId !== null ? String(functionId) : ''); if (v === null) return; call('Set function id', () => actor(true).admin_set_approve_function_id(v.trim() ? [BigInt(v.trim())] : [])); }}>set</button>}</div>}
                    {isAdmin && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}><button type="button" style={btn()} disabled={!!busy} onClick={() => call('Status run', () => actor(true).admin_run_status())}><FaSync size={10} /> Run status now</button><button type="button" style={btn()} disabled={!!busy} onClick={() => call('Auto-upgrade run', () => actor(true).admin_run_auto_upgrade())}><FaPlay size={10} /> Run auto-upgrade now</button><button type="button" style={btn()} disabled={!!busy} onClick={() => call('Blessed list', () => actor(true).refresh_blessed())}><FaSync size={10} /> Re-read blessed versions</button></div>}
                    {shownOps.length === 0 && <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginTop: 8 }}>No {showAllOps ? '' : 'open '}ops.</div>}
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                        {shownOps.map((op) => {
                            const s = stateOf(op); const child = childOf(op.child.toText()); const guard = isGuardianOf(child);
                            const open = s === 'pending' || s === 'approved';
                            return (
                                <div key={op.id.toString()} style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '10px 12px', background: theme.colors.secondaryBg }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                                        <div style={{ fontWeight: 600, color: theme.colors.primaryText }}>#{op.id.toString()} · {opText(op, children)}</div>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: s === 'executed' ? '#10b98133' : s === 'approved' ? `${amber}33` : s === 'pending' ? theme.colors.tertiaryBg : '#ef444433', color: theme.colors.primaryText }}>{s}{s === 'failed' ? `: ${op.state.failed}` : ''}</span>
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: theme.colors.mutedText, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                        <span>staged {when(op.staged_at)} by <PrincipalDisplay principal={op.staged_by} short={true} showCopyButton={false} isAuthenticated={isAuthenticated} style={{ fontSize: '0.78rem' }} /></span>
                                        <span>approvals {op.approvals.length}/{cfg?.threshold?.toString()}</span>
                                        {child && child.policy.oks_required > 0n && <span>go-aheads {op.oks.length}/{child.policy.oks_required.toString()}</span>}
                                        {child && child.policy.vetoes_to_block > 0n && <span>vetoes {op.vetoes.length}/{child.policy.vetoes_to_block.toString()}</span>}
                                        {s === 'approved' && child && <span>window until {when(BigInt(op.state.approved) + child.policy.window_ns)}</span>}
                                        {op.memo && <span>“{op.memo}”</span>}
                                        {op.fee_e8s > 0n && <span style={{ color: op.fee_paid_e8s >= op.fee_e8s ? '#10b981' : amber }}>fee {(Number(op.fee_e8s) / 1e8).toFixed(2)} ICP {op.fee_paid_e8s >= op.fee_e8s ? 'paid' : 'due'}{op.refunded_e8s > 0n ? `, ${(Number(op.refunded_e8s) / 1e8).toFixed(4)} refunded` : ''} · payer <PrincipalDisplay principal={op.payer} short={true} showCopyButton={false} isAuthenticated={isAuthenticated} style={{ fontSize: '0.78rem' }} /></span>}
                                    </div>
                                    {payFor === op.id && (
                                        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: theme.colors.tertiaryBg, border: `1px solid ${amber}`, fontSize: '0.8rem', color: theme.colors.secondaryText, lineHeight: 1.5 }}>
                                            {!payment ? <><FaSpinner className="health-spin" /> reading the payment account…</> : payment.error ? <span style={{ color: theme.colors.error }}>{payment.error}</span> : (
                                                <>
                                                    <div>Send <b style={{ color: theme.colors.primaryText }}>{(Number(payment.amount_to_send_e8s) / 1e8).toFixed(4)} ICP</b> (the fee plus one ledger fee) to the op's payment account. Anyone may pay; refunds and surplus go to the payer.</div>
                                                    <div className="health-mono" style={{ fontSize: '0.75rem', wordBreak: 'break-all', margin: '4px 0' }}>{accountText(payment.account)}</div>
                                                    <div>Paid so far: {(Number(payment.paid_e8s) / 1e8).toFixed(4)} ICP{payment.paid_e8s >= payment.amount_to_send_e8s ? ' · paid in full' : ''}</div>
                                                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                                                        {payment.paid_e8s < payment.amount_to_send_e8s && isAuthenticated && <button type="button" style={btn('#10b981')} disabled={!!busy} onClick={() => payNow(op)}>Pay from my wallet</button>}
                                                        <button type="button" style={btn()} onClick={() => setPayFor(null)}>Close</button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                    {!open && isAuthenticated && op.fee_e8s > 0n && (
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                                            <button type="button" style={btn()} disabled={!!busy} onClick={() => call(`Refund op #${op.id}`, () => actor(true).refund_op(op.id))}>Refund what is left to the payer</button>
                                        </div>
                                    )}
                                    {open && isAuthenticated && (
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                                            {s === 'pending' && (isApprover
                                                ? <button type="button" style={btn('#10b981')} disabled={!!busy} onClick={() => call(`Approve #${op.id}`, () => actor(true).approve_op(op.id))}><FaCheck size={10} /> Approve (you are an approver)</button>
                                                : <button type="button" style={btn('#10b981')} disabled={!!busy} onClick={() => proposeApproval(op)} title={functionId !== null ? 'Pay what is due, then file a Sneed DAO proposal from your neuron' : 'The approve_op function is not registered with the DAO yet'}><FaCheck size={10} /> {op.fee_e8s > 0n && op.fee_paid_e8s < op.fee_e8s ? 'Pay and propose approval' : 'Propose approval'}</button>)}
                                            {guard && <button type="button" style={btn('#10b981')} disabled={!!busy} onClick={() => call(`Go-ahead #${op.id}`, () => actor(true).ok_op(op.id))}><FaCheck size={10} /> Go-ahead</button>}
                                            {guard && <button type="button" style={btn('#ef4444')} disabled={!!busy} onClick={() => call(`Veto #${op.id}`, () => actor(true).veto_op(op.id))}><FaBan size={10} /> Veto</button>}
                                            {op.fee_e8s > 0n && op.fee_paid_e8s < op.fee_e8s && <button type="button" style={btn(amber)} onClick={() => setPayFor(payFor === op.id ? null : op.id)}>Pay the fee</button>}
                                            {s === 'approved' && <button type="button" style={btn(amber)} disabled={!!busy} onClick={() => call(`Execute #${op.id}`, () => actor(true).execute_op(op.id))}><FaPlay size={10} /> Execute</button>}
                                            {(op.staged_by.toText() === me || isApprover) && <button type="button" style={btn()} disabled={!!busy} onClick={() => call(`Cancel #${op.id}`, () => actor(true).cancel_op(op.id))}><FaTimes size={10} /> Cancel</button>}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </>
    );
}

export default Guardian;
