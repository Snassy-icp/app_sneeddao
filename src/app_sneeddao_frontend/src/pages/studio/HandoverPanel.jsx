// Hand an existing ledger suite (ledger, its index, its archives) to a Sneed
// custody canister: add the canister as controller, register each canister
// there with the maintainer's policy, then, if wanted, step down so the
// custody canister is the only controller. Works for any ledger the signed-in
// principal controls, launched here or anywhere.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { FaShieldAlt, FaSpinner, FaCheck, FaTimes, FaPlus, FaTrash, FaExternalLinkAlt } from 'react-icons/fa';
import PrincipalInput from '../../components/PrincipalInput';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { GUARDIANS, guardianIdl, policySummary } from '../../tokensafety/guardianIdl.js';
import { padIdl, PAD_CANISTER_ID } from '../../tokensafety/padIdl.js';
import { readStatus, setControllers } from '../../utils/management.js';
import { parsePrincipal } from '../../utils/icrc3/client.js';

const HOST = 'https://icp-api.io';
const amber = '#f59e0b';
const short = (h) => (h ? `${h.slice(0, 10)}…` : '—');

const suiteIdl = ({ IDL }) => IDL.Service({
    archives: IDL.Func([], [IDL.Vec(IDL.Record({ canister_id: IDL.Principal, block_range_start: IDL.Nat, block_range_end: IDL.Nat }))], ['query']),
    icrc106_get_index_principal: IDL.Func([], [IDL.Variant({ Ok: IDL.Principal, Err: IDL.Reserved })], ['query']),
});

export function HandoverPanel({ ledgerId, header }) {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const me = identity?.getPrincipal?.().toText?.() || null;
    const [dep, setDep] = useState(GUARDIANS[0] || null);
    const [suite, setSuite] = useState(null); // [{ id, kind, status|null, error }]
    const [guardianCfg, setGuardianCfg] = useState(null);
    const [registered, setRegistered] = useState(new Map()); // id -> child (already under this deployment)
    const [loading, setLoading] = useState(false);
    const [extraIndex, setExtraIndex] = useState('');
    const [policy, setPolicy] = useState({ guardians: [], vetoesToBlock: '1', oksRequired: '0', windowDays: '2', autoUpgrade: true });
    const [stepDown, setStepDown] = useState(true);
    const [busy, setBusy] = useState('');
    const [log, setLog] = useState([]);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const guardian = (withId) => Actor.createActor(guardianIdl, { agent: new HttpAgent({ host: HOST, ...(withId && identity ? { identity } : {}) }), canisterId: dep.id });

    // the suite: the ledger, its index (ICRC-106, or ours from the pad, or typed), its archives; each one's status as seen by me
    useEffect(() => {
        if (!ledgerId || !identity || !dep) return;
        let live = true;
        setLoading(true); setSuite(null); setError('');
        (async () => {
            try {
                const l = Actor.createActor(suiteIdl, { agent: new HttpAgent({ host: HOST }), canisterId: ledgerId });
                const [archives, idx, cfg, kids] = await Promise.all([
                    l.archives().catch(() => []),
                    l.icrc106_get_index_principal().then((r) => ('Ok' in r ? r.Ok.toText() : null)).catch(() => null),
                    guardian(false).get_config(),
                    guardian(false).get_suite(Principal.fromText(ledgerId)).catch(() => []),
                ]);
                const padIndexes = PAD_CANISTER_ID ? await Actor.createActor(padIdl, { agent: new HttpAgent({ host: HOST }), canisterId: PAD_CANISTER_ID }).get_indexes_of_ledger(Principal.fromText(ledgerId)).catch(() => []) : [];
                const indexIds = [...new Set([idx, ...padIndexes.map((p) => p.toText()), parsePrincipal(extraIndex)?.toText()].filter(Boolean))];
                const items = [{ id: ledgerId, kind: 'ledger' }, ...indexIds.map((id) => ({ id, kind: 'index' })), ...archives.map((a) => ({ id: a.canister_id.toText(), kind: 'archive' }))];
                const withStatus = await Promise.all(items.map(async (it) => { try { return { ...it, status: await readStatus(identity, it.id), error: null }; } catch (e) { return { ...it, status: null, error: e?.message || String(e) }; } }));
                if (!live) return;
                setSuite(withStatus); setGuardianCfg(cfg); setRegistered(new Map(kids.map((c) => [c.canister_id.toText(), c])));
            } catch (e) { if (live) setError(e?.message || String(e)); }
            finally { if (live) setLoading(false); }
        })();
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ledgerId, identity, dep?.id, extraIndex]);

    const blessed = useMemo(() => {
        if (!guardianCfg) return null;
        const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
        return { ledger: new Set(guardianCfg.blessed.ledger.map(hex)), index: new Set(guardianCfg.blessed.index.map(hex)), archive: new Set(guardianCfg.blessed.archive.map(hex)) };
    }, [guardianCfg]);
    const canDo = (it) => it.status && it.status.controllers.includes(me) && blessed?.[it.kind]?.has(it.status.moduleHash) && !registered.has(it.id);
    const todo = (suite || []).filter(canDo);
    const policyValue = () => {
        const gs = policy.guardians.map((t) => parsePrincipal(t)).filter(Boolean);
        const vb = gs.length ? Number(policy.vetoesToBlock || 0) : 0; const ok = gs.length ? Number(policy.oksRequired || 0) : 0;
        return { guardians: gs, vetoes_to_block: BigInt(vb), oks_required: BigInt(ok), window_ns: vb > 0 ? BigInt(Math.round(Number(policy.windowDays || 0) * 86_400)) * 1_000_000_000n : 0n, auto_upgrade: !!policy.autoUpgrade };
    };
    const problems = () => {
        const gs = policy.guardians.map((t) => parsePrincipal(t));
        if (gs.some((x) => !x)) return 'every veto council line needs a principal';
        const vb = gs.length ? Number(policy.vetoesToBlock || 0) : 0; const ok = gs.length ? Number(policy.oksRequired || 0) : 0;
        if (vb > gs.length || ok > gs.length) return 'vetoes to block and go-aheads cannot exceed the council size';
        if (vb > 0 && Number(policy.windowDays || 0) <= 0) return 'a veto council needs a window of at least a day';
        return null;
    };

    const run = async () => {
        const p = problems(); if (p) { setError(p); return; }
        setBusy('working'); setError(''); setLog([]); setDone(false);
        const say = (t) => setLog((l) => [...l, t]);
        try {
            const g = guardian(true);
            const pol = policyValue();
            const ledgerFirst = [...todo].sort((a, b) => (a.kind === 'ledger' ? -1 : b.kind === 'ledger' ? 1 : 0));
            for (const it of ledgerFirst) {
                if (!it.status.controllers.includes(dep.id)) {
                    say(`Adding ${dep.name} as a controller of the ${it.kind} ${it.id}…`);
                    await setControllers(identity, it.id, [...it.status.controllers, dep.id]);
                }
                say(`Registering the ${it.kind} with ${dep.name}…`);
                const title = `${header?.symbol || 'token'} ${it.kind}`;
                const r = await g.register(Principal.fromText(it.id), { [it.kind]: null }, pol, it.kind === 'ledger' ? [] : [Principal.fromText(ledgerId)], title);
                if ('Err' in r) throw new Error(`${it.kind} ${it.id}: ${r.Err}`);
                say(`Registered: ${title}.`);
            }
            if (stepDown) {
                for (const it of ledgerFirst) {
                    say(`Leaving ${dep.name} as the only controller of the ${it.kind}…`);
                    await setControllers(identity, it.id, [dep.id]);
                }
            }
            say('Done.');
            setDone(true);
        } catch (e) { setError(e?.message || String(e)); }
        finally { setBusy(''); }
    };

    const card = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem 1.1rem', marginBottom: 14 };
    const h = { margin: '0 0 6px', fontSize: '1.05rem', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: 8 };
    const p = { color: theme.colors.secondaryText, fontSize: '0.88rem', lineHeight: 1.6, margin: '0 0 8px' };
    const input = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' };
    const btn = (primary, disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: `1px solid ${primary ? amber : theme.colors.border}`, background: primary ? amber : 'transparent', color: primary ? '#1a1030' : theme.colors.primaryText, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, fontSize: '0.9rem' });

    if (!GUARDIANS.length) return <div style={{ ...card, color: amber }}>No custody canister is deployed in this build yet.</div>;
    if (!isAuthenticated) return <div style={{ ...card, color: theme.colors.secondaryText }}>Log in with the principal that controls the ledger to hand it over.</div>;
    return (
        <>
            <div style={card}>
                <h2 style={h}><FaShieldAlt size={14} color={amber} /> Hand {header?.symbol || 'this ledger'} to Sneed custody</h2>
                <p style={p}>The custody canister becomes the controller of the ledger, its index and its archives. From then on nothing changes without a Sneed DAO vote, every upgrade is to NNS-blessed code only, and your veto council, if you name one, can block any approved change. Registration is free. Your principal must currently control the canisters.</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {GUARDIANS.map((g) => <button key={g.key} type="button" onClick={() => setDep(g)} style={{ ...btn(false), border: `1px solid ${dep?.key === g.key ? amber : theme.colors.border}`, background: dep?.key === g.key ? `${amber}22` : 'transparent' }}>{g.name}</button>)}
                </div>
                {dep && <p style={{ ...p, fontSize: '0.8rem' }}>{dep.blurb}</p>}
            </div>

            <div style={card}>
                <h2 style={h}>The canisters</h2>
                {loading && <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}><FaSpinner className="health-spin" /> Reading the suite as {me?.slice(0, 12)}…</div>}
                {suite && (
                    <div style={{ display: 'grid', gap: 6 }}>
                        {suite.map((it) => {
                            const reg = registered.get(it.id);
                            const mine = it.status?.controllers.includes(me);
                            const ok = blessed?.[it.kind]?.has(it.status?.moduleHash);
                            return (
                                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, fontSize: '0.82rem' }}>
                                    <span><b style={{ color: theme.colors.primaryText }}>{it.kind}</b> <span className="health-mono" style={{ color: theme.colors.mutedText }}>{it.id}</span></span>
                                    <span style={{ color: reg ? '#10b981' : it.error ? theme.colors.error : !mine ? amber : !ok ? amber : '#10b981' }}>
                                        {reg ? <><FaCheck size={10} /> already under {dep.name}</>
                                            : it.error ? <><FaTimes size={10} /> not readable: are you a controller?</>
                                            : !mine ? <><FaTimes size={10} /> you are not a controller (controllers: {it.status.controllers.map((c) => c.slice(0, 8)).join(', ')})</>
                                            : !ok ? <><FaTimes size={10} /> code {short(it.status.moduleHash)} is not an NNS-blessed {it.kind} version; upgrade it first</>
                                            : <><FaCheck size={10} /> ready ({it.status.controllers.length} controller{it.status.controllers.length === 1 ? '' : 's'})</>}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 240 }}><PrincipalInput value={extraIndex} onChange={setExtraIndex} placeholder="An index canister the ledger does not announce (optional)" defaultTab="all" defaultPrincipalType="canisters" style={{ width: '100%' }} inputStyle={input} isAuthenticated={isAuthenticated} /></div>
                    <Link to={`/studio/${ledgerId}/index`} style={{ fontSize: '0.82rem', color: theme.colors.accent }}>No index yet? Create one</Link>
                </div>
            </div>

            <div style={card}>
                <h2 style={h}>Rules</h2>
                <p style={p}>A veto council is optional. Without one, a DAO vote alone decides every change.</p>
                {policy.guardians.map((v, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ flex: 1 }}><PrincipalInput value={v} onChange={(x) => setPolicy((f) => ({ ...f, guardians: f.guardians.map((y, j) => (j === i ? x : y)) }))} placeholder="Veto council member" defaultTab="all" style={{ width: '100%' }} inputStyle={input} isAuthenticated={isAuthenticated} /></div>
                        <button type="button" style={btn(false)} onClick={() => setPolicy((f) => ({ ...f, guardians: f.guardians.filter((_, j) => j !== i) }))}><FaTrash size={11} /></button>
                    </div>
                ))}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {policy.guardians.length < 20 && <button type="button" style={{ ...btn(false), fontSize: '0.8rem', padding: '6px 10px' }} onClick={() => setPolicy((f) => ({ ...f, guardians: [...f.guardians, f.guardians.length === 0 && me ? me : ''] }))}><FaPlus size={10} /> Add a veto council member</button>}
                </div>
                {policy.guardians.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 8, fontSize: '0.8rem', color: theme.colors.secondaryText }}>
                        <label>Vetoes that block<input style={input} type="number" min="0" value={policy.vetoesToBlock} onChange={(e) => setPolicy((f) => ({ ...f, vetoesToBlock: e.target.value }))} /></label>
                        <label>Go-aheads required<input style={input} type="number" min="0" value={policy.oksRequired} onChange={(e) => setPolicy((f) => ({ ...f, oksRequired: e.target.value }))} /></label>
                        <label>Veto window (days)<input style={input} type="number" min="0" max="90" value={policy.windowDays} onChange={(e) => setPolicy((f) => ({ ...f, windowDays: e.target.value }))} /></label>
                    </div>
                )}
                <label style={{ display: 'flex', gap: 8, fontSize: '0.88rem', color: theme.colors.primaryText, marginTop: 10, cursor: 'pointer' }}><input type="checkbox" checked={!!policy.autoUpgrade} onChange={(e) => setPolicy((f) => ({ ...f, autoUpgrade: e.target.checked }))} /> Follow the NNS: upgrade to each newly blessed version without a vote</label>
                <label style={{ display: 'flex', gap: 8, fontSize: '0.88rem', color: theme.colors.primaryText, marginTop: 6, cursor: 'pointer' }}><input type="checkbox" checked={stepDown} onChange={(e) => setStepDown(e.target.checked)} /> Afterwards, leave {dep?.name} as the only controller (recommended: a ledger with extra controllers still fails the safety check)</label>
                <div style={{ fontSize: '0.78rem', color: theme.colors.mutedText, marginTop: 6 }}>Rules: {policySummary(policyValue())}</div>
            </div>

            <div style={card}>
                <button type="button" style={btn(true, busy || !todo.length)} disabled={!!busy || !todo.length} onClick={run}>{busy ? <FaSpinner className="health-spin" /> : <FaShieldAlt />} Hand over {todo.length} canister{todo.length === 1 ? '' : 's'}</button>
                {suite && !todo.length && !loading && <div style={{ marginTop: 8, fontSize: '0.85rem', color: theme.colors.mutedText }}>Nothing to hand over: every canister is already under custody, not yours to hand over, or not on blessed code.</div>}
                {log.length > 0 && <div style={{ marginTop: 10, fontSize: '0.82rem', color: theme.colors.secondaryText, lineHeight: 1.6 }}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
                {error && <div style={{ marginTop: 8, color: theme.colors.error, fontSize: '0.88rem' }}>{error}</div>}
                {done && <div style={{ marginTop: 10, fontSize: '0.88rem', color: '#10b981' }}>Under custody. <Link to={`/guardian?deployment=${dep.key}&child=${ledgerId}`} style={{ color: theme.colors.accent }}>See the rules and status <FaExternalLinkAlt size={9} /></Link>, or <Link to={`/studio/${ledgerId}`} style={{ color: theme.colors.accent }}>re-run the safety check</Link>.</div>}
            </div>
        </>
    );
}

export default HandoverPanel;
