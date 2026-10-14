// /admin/pad: the launchpad's settings, code source, launches, and the
// rescue of canisters a failed launch left behind. Every call here is an
// admin method of sneed_pad (governance, controllers or listed admins).
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import Header from '../../components/Header';
import PrincipalInput from '../../components/PrincipalInput';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { padIdl, PAD_CANISTER_ID } from '../../tokensafety/padIdl.js';
import { customStyles } from '../../health/TreeView.jsx';
import { FaSpinner, FaSync, FaLifeRing } from 'react-icons/fa';

const HOST = 'https://icp-api.io';
const fmtIcp = (e8s) => `${(Number(e8s) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 4 })} ICP`;
const fmtT = (c) => `${(Number(c) / 1e12).toFixed(2)} T`;
const icpToE8s = (t) => { const n = Number(t); return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 1e8)) : null; };
const tToCycles = (t) => { const n = Number(t); return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 1e12)) : null; };
const hex = (b) => Array.from(b || []).map((x) => x.toString(16).padStart(2, '0')).join('');
const parsePrincipal = (t) => { try { return Principal.fromText(String(t).trim()); } catch { return null; } };
const when = (ns) => (ns && ns > 0n ? new Date(Number(ns / 1_000_000n)).toLocaleString() : 'never');

export default function SneedPadAdmin() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    useAdminCheck({ identity, isAuthenticated });
    const me = identity?.getPrincipal?.().toText?.() || '';
    const [config, setConfig] = useState(null);
    const [cycles, setCycles] = useState(null);
    const [launches, setLaunches] = useState([]);
    const [log, setLog] = useState([]);
    const [admins, setAdmins] = useState([]);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [form, setForm] = useState({});
    const [rescue, setRescue] = useState({ canister: '', controllers: '' });
    const [withdraw, setWithdraw] = useState({ to: '', amount: '' });
    const [neuron, setNeuron] = useState('');

    const pad = useCallback((withIdentity) => {
        if (!PAD_CANISTER_ID) return null;
        return Actor.createActor(padIdl, { agent: new HttpAgent({ host: HOST, ...(withIdentity && identity ? { identity } : {}) }), canisterId: PAD_CANISTER_ID });
    }, [identity]);

    const load = useCallback(async () => {
        const a = pad(false); if (!a) return;
        try {
            const [cfg, cyc, l, lines, adm] = await Promise.all([a.get_config(), a.get_cycle_balance(), a.list_launches(0n, 200n), a.get_text_log(60n), a.get_admins()]);
            setConfig(cfg); setCycles(cyc); setLaunches([...l.launches].reverse()); setLog(lines); setAdmins(adm.map((p) => p.toText()));
            setForm({ fee: (Number(cfg.creation_fee_e8s) / 1e8).toString(), premiumFee: (Number(cfg.premium_creation_fee_e8s) / 1e8).toString(), controlFee: (Number(cfg.sneed_dao_control_fee_e8s) / 1e8).toString(), ledgerT: (Number(cfg.ledger_cycles) / 1e12).toString(), indexT: (Number(cfg.index_cycles) / 1e12).toString(), reserveT: (Number(cfg.cycle_reserve) / 1e12).toString(), feeOwner: cfg.fee_destination.owner.toText(), paused: cfg.paused, indexFee: (Number(cfg.index_creation_fee_e8s) / 1e8).toString(), premiumIndexFee: (Number(cfg.premium_index_creation_fee_e8s) / 1e8).toString(), followNns: cfg.follow_nns, guardians: (cfg.guardians || []).map((p) => p.toText()).join('\n') });
        } catch (e) { setError(`Could not read the pad: ${e?.message || e}`); }
    }, [pad]);
    useEffect(() => { load(); }, [load]);

    const call = async (label, fn) => {
        setBusy(label); setError(''); setSuccess('');
        try {
            const r = await fn(pad(true));
            if (r && typeof r === 'object' && 'Err' in r) throw new Error(r.Err);
            setSuccess(`${label}: done`);
            await load();
        } catch (e) { setError(`${label}: ${e?.message || e}`); }
        finally { setBusy(''); }
    };

    const saveConfig = () => call('Save settings', (a) => {
        const fee = icpToE8s(form.fee); const premiumFee = icpToE8s(form.premiumFee); const controlFee = icpToE8s(form.controlFee);
        const ledger = tToCycles(form.ledgerT); const index = tToCycles(form.indexT); const reserve = tToCycles(form.reserveT);
        const owner = parsePrincipal(form.feeOwner);
        if ([fee, premiumFee, controlFee, ledger, index, reserve].some((v) => v === null) || !owner) throw new Error('check the numbers and the fee destination');
        return a.admin_set_config({
            creation_fee_e8s: [fee], premium_creation_fee_e8s: [premiumFee], sneed_dao_control_fee_e8s: [controlFee],
            index_creation_fee_e8s: [BigInt(Math.round(Number(form.indexFee || 0) * 1e8))], premium_index_creation_fee_e8s: [BigInt(Math.round(Number(form.premiumIndexFee || 0) * 1e8))],
            ledger_cycles: [ledger], index_cycles: [index], cycle_reserve: [reserve],
            fee_destination: [{ owner, subaccount: [] }], paused: [!!form.paused], follow_nns: [!!form.followNns],
            guardians: [String(form.guardians || '').split(/[\s,]+/).filter(Boolean).map((t) => Principal.fromText(t))],
        });
    });
    const doRescue = () => call('Rescue', (a) => {
        const c = parsePrincipal(rescue.canister); if (!c) throw new Error('canister id needed');
        const ctl = rescue.controllers.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).map(parsePrincipal);
        if (ctl.length === 0 || ctl.some((p) => !p)) throw new Error('one or more controller principals needed');
        return a.admin_set_canister_controllers(c, ctl);
    });
    const doWithdraw = () => call('Withdraw ICP', (a) => {
        const to = parsePrincipal(withdraw.to); const amount = icpToE8s(withdraw.amount);
        if (!to || amount === null || amount === 0n) throw new Error('recipient and amount needed');
        return a.admin_withdraw_icp({ owner: to, subaccount: [] }, amount);
    });
    const doNeuron = () => call('Set registration neuron', (a) => {
        const t = neuron.trim();
        if (!t) return a.admin_set_registration_neuron([]);
        if (!/^[0-9a-fA-F]{64}$/.test(t)) throw new Error('a neuron id is 64 hex characters');
        return a.admin_set_registration_neuron([Uint8Array.from(t.match(/../g).map((h) => parseInt(h, 16)))]);
    });

    const card = { border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem 1.1rem', background: theme.colors.cardBg, marginBottom: '1rem' };
    const h2 = { margin: '0 0 10px', fontSize: '1.05rem', color: theme.colors.primaryText };
    const input = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' };
    const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: theme.colors.secondaryText };
    const btn = (primary) => ({ padding: '9px 14px', borderRadius: 10, border: `1px solid ${primary ? '#10b981' : theme.colors.border}`, background: primary ? '#10b981' : 'transparent', color: primary ? '#fff' : theme.colors.primaryText, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' });
    const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.8rem' };
    const failed = launches.filter((l) => 'failed' in l.status);

    if (!isAuthenticated) {
        return <div className="page-container"><Header /><div style={{ padding: '40px 20px', textAlign: 'center', color: theme.colors.primaryText }}><h2>Please log in to access the Sneed Pad admin</h2></div></div>;
    }
    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            <main style={{ maxWidth: 1000, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontWeight: 800, color: theme.colors.primaryText }}>Sneed Pad admin</h1>
                <div style={{ color: theme.colors.secondaryText, fontSize: '0.88rem', marginBottom: '1rem' }}>Canister <span style={mono}>{PAD_CANISTER_ID || 'not configured in this build'}</span>{cycles !== null && <> · {fmtT(cycles)} cycles</>} · admins: <span style={mono}>{admins.join(', ') || '…'}</span></div>
                {error && <div style={{ ...card, color: '#ef4444' }}>{error}</div>}
                {success && <div style={{ ...card, color: '#10b981' }}>{success}</div>}

                <div style={card}>
                    <h2 style={h2}>Ledger code</h2>
                    {config ? (
                        <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: 1.8 }}>
                            <div>Source: {config.follow_nns ? 'following the NNS (latest SNS version, checked daily)' : 'pinned by the DAO'}. Last check {when(config.wasm_last_check)}, last change {when(config.wasm_last_refresh)}.{config.wasm_last_error[0] && <span style={{ color: '#ef4444' }}> Last error: {config.wasm_last_error[0]}</span>}</div>
                            <div>Ledger <span style={mono}>{config.ledger_wasm_hash[0] ? hex(config.ledger_wasm_hash[0]) : 'none'}</span> ({Number(config.ledger_wasm_bytes).toLocaleString('en-US')} bytes)</div>
                            <div>Index <span style={mono}>{config.index_wasm_hash[0] ? hex(config.index_wasm_hash[0]) : 'none'}</span> ({Number(config.index_wasm_bytes).toLocaleString('en-US')} bytes)</div>
                            <button type="button" style={{ ...btn(false), marginTop: 6 }} disabled={!!busy} onClick={() => call('Refresh wasms', (a) => a.refresh_wasms())}><FaSync size={11} className={busy === 'Refresh wasms' ? 'health-spin' : undefined} /> Check the NNS now</button>
                        </div>
                    ) : <FaSpinner className="health-spin" />}
                </div>

                <div style={card}>
                    <h2 style={h2}>Settings</h2>
                    {config && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                                <label style={label}>Launch fee (ICP)<input style={input} value={form.fee ?? ''} onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))} /></label>
                                <label style={label}>Sneed Premium fee (ICP)<input style={input} value={form.premiumFee ?? ''} onChange={(e) => setForm((f) => ({ ...f, premiumFee: e.target.value }))} /></label>
                                <label style={label}>Sneed DAO handover fee (ICP)<input style={input} value={form.controlFee ?? ''} onChange={(e) => setForm((f) => ({ ...f, controlFee: e.target.value }))} /></label>
                                <label style={label}>Ledger cycles (T, at least 1)<input style={input} value={form.ledgerT ?? ''} onChange={(e) => setForm((f) => ({ ...f, ledgerT: e.target.value }))} /></label>
                                <label style={label}>Index cycles (T, at least 1)<input style={input} value={form.indexT ?? ''} onChange={(e) => setForm((f) => ({ ...f, indexT: e.target.value }))} /></label>
                                <label style={label}>Pad's own reserve (T)<input style={input} value={form.reserveT ?? ''} onChange={(e) => setForm((f) => ({ ...f, reserveT: e.target.value }))} /></label>
                                <label style={{ ...label, gridColumn: '1 / -1' }}>Fee destination (principal, default subaccount)<PrincipalInput value={form.feeOwner ?? ''} onChange={(v) => setForm((f) => ({ ...f, feeOwner: v }))} placeholder="Principal or name" defaultTab="all" style={{ width: '100%' }} inputStyle={input} /></label>
                            </div>
                            <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap', fontSize: '0.88rem', color: theme.colors.primaryText }}>
                                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!form.paused} onChange={(e) => setForm((f) => ({ ...f, paused: e.target.checked }))} /> Paused (no launches)</label>
                                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!form.followNns} onChange={(e) => setForm((f) => ({ ...f, followNns: e.target.checked }))} /> Follow the NNS's latest ledger suite</label>
                                <label style={{ display: 'grid', gap: 4 }}><span>Custody canisters a creator may hand control to (one principal per line: sneed_guardian, sneed_hole, sneed_accord)</span><textarea rows={3} value={form.guardians || ''} onChange={(e) => setForm((f) => ({ ...f, guardians: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.8rem', padding: 8, borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText }} /></label>
                            </div>
                            <button type="button" style={{ ...btn(true), marginTop: 12 }} disabled={!!busy} onClick={saveConfig}>{busy === 'Save settings' ? <FaSpinner className="health-spin" /> : null} Save settings</button>
                        </>
                    )}
                </div>

                <div style={card}>
                    <h2 style={h2}><FaLifeRing size={14} color="#10b981" /> Rescue a canister</h2>
                    <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: 10, lineHeight: 1.5 }}>A launch that fails after creating a canister leaves it controlled by the pad. Hand it to whoever can finish or reuse it; the pad logs the handover. Failed launches below fill this in.</div>
                    <div style={{ display: 'grid', gap: 10 }}>
                        <label style={label}>Canister<PrincipalInput value={rescue.canister} onChange={(v) => setRescue((r) => ({ ...r, canister: v }))} placeholder="Canister id" defaultTab="all" style={{ width: '100%' }} inputStyle={input} /></label>
                        <label style={label}>New controllers (one or more principals, separated by spaces or commas)<input style={input} value={rescue.controllers} onChange={(e) => setRescue((r) => ({ ...r, controllers: e.target.value }))} placeholder={me} /></label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button type="button" style={btn(false)} disabled={!!busy || !me} onClick={() => setRescue((r) => ({ ...r, controllers: me }))}>Use my principal</button>
                            <button type="button" style={btn(true)} disabled={!!busy} onClick={doRescue}>{busy === 'Rescue' ? <FaSpinner className="health-spin" /> : <FaLifeRing size={12} />} Set controllers</button>
                        </div>
                    </div>
                </div>

                <div style={card}>
                    <h2 style={h2}>Launches ({launches.length}{failed.length ? `, ${failed.length} failed` : ''})</h2>
                    <div style={{ display: 'grid', gap: 6 }}>
                        {launches.map((l) => {
                            const isFailed = 'failed' in l.status;
                            return (
                                <div key={String(l.id)} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${theme.colors.border}`, fontSize: '0.85rem', color: theme.colors.primaryText }}>
                                    <span style={{ fontWeight: 700 }}>#{String(l.id)} {l.config.name} ({l.config.symbol})</span>
                                    <span style={{ ...mono, color: theme.colors.mutedText }}>{l.creator.toText()}</span>
                                    <span style={{ color: theme.colors.mutedText }}>{new Date(Number(l.created_at / 1_000_000n)).toLocaleString()}</span>
                                    <span style={{ color: theme.colors.mutedText }}>{l.steps.map(([s]) => s).join(' → ') || 'no steps'}</span>
                                    {l.ledger[0] && <Link to={`/studio/${l.ledger[0].toText()}`} style={{ color: '#10b981' }}>ledger {l.ledger[0].toText()}</Link>}
                                    {l.index[0] && <span style={mono}>index {l.index[0].toText()}</span>}
                                    {isFailed && <span style={{ color: '#ef4444' }}>failed: {l.status.failed}</span>}
                                    {isFailed && l.ledger[0] && <button type="button" style={btn(false)} onClick={() => { setRescue({ canister: l.ledger[0].toText(), controllers: me }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Rescue ledger</button>}
                                    {isFailed && l.index[0] && <button type="button" style={btn(false)} onClick={() => { setRescue({ canister: l.index[0].toText(), controllers: me }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Rescue index</button>}
                                </div>
                            );
                        })}
                        {launches.length === 0 && <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>No launches yet.</div>}
                    </div>
                </div>

                <div style={card}>
                    <h2 style={h2}>Registration neuron and ICP</h2>
                    <div style={{ display: 'grid', gap: 10 }}>
                        <label style={label}>Neuron hotkeyed to the pad (64 hex characters; empty clears it)<input style={input} value={neuron} onChange={(e) => setNeuron(e.target.value)} placeholder="neuron id" /></label>
                        <div><button type="button" style={btn(false)} disabled={!!busy} onClick={doNeuron}>Set registration neuron</button></div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                            <label style={label}>Withdraw ICP left by failed steps: to<PrincipalInput value={withdraw.to} onChange={(v) => setWithdraw((w) => ({ ...w, to: v }))} placeholder="Principal or name" defaultTab="all" style={{ width: '100%' }} inputStyle={input} /></label>
                            <label style={label}>Amount (ICP)<input style={input} value={withdraw.amount} onChange={(e) => setWithdraw((w) => ({ ...w, amount: e.target.value }))} /></label>
                        </div>
                        <div><button type="button" style={btn(false)} disabled={!!busy} onClick={doWithdraw}>Withdraw ICP</button></div>
                    </div>
                </div>

                <div style={card}>
                    <h2 style={h2}>Log (last {log.length} lines)</h2>
                    <pre style={{ ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: theme.colors.secondaryText, margin: 0, maxHeight: 360, overflow: 'auto' }}>{log.join('\n') || 'empty'}</pre>
                </div>
            </main>
        </div>
    );
}
