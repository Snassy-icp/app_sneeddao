// The studio's Launch panel: configure a ledger, see the full price, then
// approve once and the pad mints it (stages 1 and 2 of spec/token_safety.md).
// The old /tools/pad route redirects into the studio.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import PrincipalInput from '../components/PrincipalInput';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSneedAppActor, canisterId as sneedAppCanisterId } from 'declarations/sneedapp';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { padIdl, PAD_CANISTER_ID } from '../tokensafety/padIdl.js';
import { FaRocket, FaSpinner, FaPlus, FaTrash, FaShieldAlt, FaExternalLinkAlt } from 'react-icons/fa';

const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ICP_FEE = 10_000n;
const HOST = 'https://icp-api.io';
const fmtIcp = (e8s) => `${(Number(e8s) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 4 })} ICP`;
const fmtT = (c) => `${(Number(c) / 1e12).toFixed(1)} T`;
const parseUnits = (text, decimals) => {
    const t = String(text).trim(); if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') return null;
    const [w, f = ''] = t.split('.'); if (f.length > decimals) return null;
    return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
};
const parsePrincipal = (t) => { try { return Principal.fromText(String(t).trim()); } catch { return null; } };

/// `onLaunched(launch)` lets the studio switch to the new token's report.
export function LaunchPanel({ onLaunched }) {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const me = identity?.getPrincipal?.().toText?.() || null;
    const [form, setForm] = useState({ name: '', symbol: '', decimals: 8, fee: '0.0001', logo: null, minting: 'nobody', mintingPrincipal: '', control: 'keep', withIndex: true, feeCollector: '', allocations: [{ owner: '', amount: '' }] });
    const [quote, setQuote] = useState(null);
    const [quoting, setQuoting] = useState(false);
    const [launching, setLaunching] = useState(null); // step text
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [padConfig, setPadConfig] = useState(null);
    const [mine, setMine] = useState([]);

    const padActor = useCallback((withIdentity) => {
        if (!PAD_CANISTER_ID) return null;
        const agent = new HttpAgent({ host: HOST, ...(withIdentity && identity ? { identity } : {}) });
        return Actor.createActor(padIdl, { agent, canisterId: PAD_CANISTER_ID });
    }, [identity]);

    useEffect(() => {
        const a = padActor(false); if (!a) return;
        a.get_config().then(setPadConfig).catch((e) => setError(`Could not read the launchpad: ${e?.message || e}`));
    }, [padActor]);
    useEffect(() => {
        const a = padActor(false); if (!a || !me) { setMine([]); return; }
        a.get_launches_by_creator(Principal.fromText(me)).then(setMine).catch(() => {});
    }, [padActor, me, result]);

    useEffect(() => { if (me && form.allocations.length === 1 && !form.allocations[0].owner) setForm((f) => ({ ...f, allocations: [{ owner: me, amount: f.allocations[0].amount }] })); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [me]);

    /// The config as the canister takes it, or a validation message.
    const built = useMemo(() => {
        const problems = [];
        const symbol = form.symbol.trim(); const name = form.name.trim();
        if (!symbol || symbol.length > 12) problems.push('symbol: 1 to 12 characters');
        if (!name || name.length > 64) problems.push('name: 1 to 64 characters');
        const decimals = Number(form.decimals); if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) problems.push('decimals: 0 to 18');
        const fee = parseUnits(form.fee, decimals); if (fee === null) problems.push('transfer fee: a number with at most the token\'s decimals');
        const allocations = [];
        for (const [i, a] of form.allocations.entries()) {
            const p = parsePrincipal(a.owner); const amt = parseUnits(a.amount, decimals);
            if (!p) problems.push(`allocation ${i + 1}: a principal is needed`);
            else if (amt === null || amt === 0n) problems.push(`allocation ${i + 1}: an amount above 0 is needed`);
            else allocations.push({ account: { owner: p, subaccount: [] }, amount: amt });
        }
        if (form.allocations.length === 0) problems.push('at least one allocation: a token with no supply cannot be traded');
        let minting;
        if (form.minting === 'nobody') minting = { nobody: null };
        else if (form.minting === 'sneed_dao') minting = { sneed_dao: null };
        else { const p = parsePrincipal(form.mintingPrincipal); if (!p) problems.push('minting principal: a principal is needed'); else minting = { principal: p }; }
        let fee_collector = [];
        if (form.feeCollector.trim()) { const p = parsePrincipal(form.feeCollector); if (!p) problems.push('fee collector: not a principal'); else fee_collector = [{ owner: p, subaccount: [] }]; }
        if (form.logo && form.logo.length > 200_000) problems.push('logo: at most 200 kB');
        const config = problems.length ? null : {
            name, symbol, decimals, transfer_fee: fee, logo: form.logo ? [form.logo] : [], allocations, minting, fee_collector,
            control: { [form.control]: null }, with_index: form.withIndex,
        };
        const supply = allocations.reduce((a, x) => a + x.amount, 0n);
        return { problems, config, supply, decimals };
    }, [form]);

    useEffect(() => { setQuote(null); }, [built.config]);

    const getQuote = async () => {
        const a = padActor(false); if (!a || !built.config) return;
        setQuoting(true); setError(null);
        try { const r = await a.get_quote(built.config); if ('Err' in r) setError(r.Err); else setQuote(r.Ok); }
        catch (e) { setError(e?.message || String(e)); }
        finally { setQuoting(false); }
    };

    const launch = async () => {
        if (!quote || !built.config || !identity) return;
        setError(null); setResult(null);
        try {
            setLaunching('Approving the launchpad on the ICP ledger…');
            const ledger = createLedgerActor(ICP_LEDGER, { agentOptions: { identity, host: HOST } });
            const approve = await ledger.icrc2_approve({ from_subaccount: [], spender: { owner: Principal.fromText(PAD_CANISTER_ID), subaccount: [] }, amount: quote.total_e8s + ICP_FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] });
            if ('Err' in approve) throw new Error(`approval failed: ${JSON.stringify(approve.Err, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
            setLaunching('Launching: the pad pulls the payment, buys cycles, creates and installs the ledger…');
            const r = await padActor(true).create_token(built.config);
            if ('Err' in r) throw new Error(r.Err);
            setResult(r.Ok);
            setQuote(null);
            onLaunched?.(r.Ok);
            // The wallet: the token under tokens, the canisters under SneedApp mints. The pad lists them
            // itself when SneedApp authorizes it; these calls make sure, and are harmless twice.
            const ledgerId = r.Ok.ledger[0];
            if (ledgerId) {
                const quiet = (p) => p.catch((e) => console.warn('wallet registration skipped', e));
                await Promise.all([
                    quiet(createBackendActor(backendCanisterId, { agentOptions: { identity, host: HOST } }).register_ledger_canister_id(ledgerId)),
                    quiet(createSneedAppActor(sneedAppCanisterId, { agentOptions: { identity, host: HOST } }).registerCanister(ledgerId, 'icrc-ledger')),
                    ...(r.Ok.index[0] ? [quiet(createSneedAppActor(sneedAppCanisterId, { agentOptions: { identity, host: HOST } }).registerCanister(r.Ok.index[0], 'icrc-index'))] : []),
                ]);
            }
        } catch (e) { setError(e?.message || String(e)); }
        finally { setLaunching(null); }
    };

    const onLogo = (file) => {
        if (!file) { setForm((f) => ({ ...f, logo: null })); return; }
        if (file.size > 150_000) { setError('Logo files up to 150 kB, please (it is stored in the ledger\'s metadata)'); return; }
        const reader = new FileReader(); reader.onload = () => setForm((f) => ({ ...f, logo: String(reader.result) })); reader.readAsDataURL(file);
    };

    const card = { border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem 1.1rem', background: theme.colors.cardBg, marginBottom: '1rem' };
    const input = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' };
    const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: theme.colors.secondaryText };
    const btn = (primary, disabled) => ({ padding: '10px 16px', borderRadius: 10, border: `1px solid ${primary ? '#10b981' : theme.colors.border}`, background: primary ? '#10b981' : 'transparent', color: primary ? '#fff' : theme.colors.primaryText, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 });
    const radio = (name, value, text, help) => (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem', color: theme.colors.primaryText, cursor: 'pointer' }}>
            <input type="radio" name={name} checked={form[name] === value} onChange={() => setForm((f) => ({ ...f, [name]: value }))} style={{ marginTop: 3 }} />
            <span><b>{text}</b>{help && <span style={{ color: theme.colors.mutedText }}> · {help}</span>}</span>
        </label>
    );

    return (
        <>
                <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginBottom: '1rem' }}>Launch a token on the same ledger code every SNS runs, with the safe choices made easy. Configure it, see the full price, approve once, and it is minted. The studio rates it the moment it exists.</div>

                {!PAD_CANISTER_ID && <div style={{ ...card, color: '#f59e0b' }}>The launchpad canister is not deployed in this build yet.</div>}
                {PAD_CANISTER_ID && (
                    <div style={{ ...card, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: '0.82rem', color: theme.colors.secondaryText, minHeight: 20 }}>
                        {!padConfig && <span>Loading the launchpad's current fees and settings…</span>}
                        {padConfig && <>
                        <span>Fee {fmtIcp(padConfig.creation_fee_e8s)}{padConfig.premium_creation_fee_e8s !== padConfig.creation_fee_e8s ? ` (${fmtIcp(padConfig.premium_creation_fee_e8s)} for Sneed Premium members)` : ''}</span><span>Handing control to Sneed DAO {fmtIcp(padConfig.sneed_dao_control_fee_e8s)} more</span><span>Ledger starts with {fmtT(padConfig.ledger_cycles)} cycles</span><span>Index {fmtT(padConfig.index_cycles)} cycles</span>
                        <span title={padConfig.wasm_last_error[0] || ''}>Ledger code {padConfig.ledger_wasm_bytes > 0n ? (padConfig.follow_nns ? 'the latest NNS-approved version, checked daily' : 'NNS-approved, pinned by the DAO') : 'not loaded yet (fetched from the NNS automatically)'}{padConfig.wasm_last_error[0] ? ', last check failed' : ''}</span>
                        {padConfig.paused && <span style={{ color: '#ef4444' }}>paused</span>}
                        </>}
                    </div>
                )}

                <div style={card}>
                    <h2 style={{ margin: '0 0 12px', fontSize: '1.05rem', color: theme.colors.primaryText }}>1. The token</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                        <label style={label}>Name<input style={input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="My Token" maxLength={64} /></label>
                        <label style={label}>Symbol<input style={input} value={form.symbol} onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))} placeholder="MYT" maxLength={12} /></label>
                        <label style={label}>Decimals<input style={input} type="number" min={0} max={18} value={form.decimals} onChange={(e) => setForm((f) => ({ ...f, decimals: e.target.value }))} /></label>
                        <label style={label}>Transfer fee (in tokens)<input style={input} value={form.fee} onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))} /></label>
                        <label style={label}>Logo (PNG or SVG, up to 150 kB)<input type="file" accept="image/*" onChange={(e) => onLogo(e.target.files?.[0])} style={{ fontSize: '0.8rem' }} />{form.logo && <img src={form.logo} alt="" style={{ width: 40, height: 40, borderRadius: 10, marginTop: 4 }} />}</label>
                    </div>
                </div>

                <div style={card}>
                    <h2 style={{ margin: '0 0 6px', fontSize: '1.05rem', color: theme.colors.primaryText }}>2. Who gets the supply</h2>
                    <div style={{ fontSize: '0.82rem', color: theme.colors.mutedText, marginBottom: 10 }}>Each line is minted at launch, as a mint block in the ledger's log. Total: <b>{(Number(built.supply) / 10 ** built.decimals).toLocaleString('en-US')}</b> {form.symbol || 'tokens'}.</div>
                    {form.allocations.map((a, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 320px' }}><PrincipalInput value={a.owner} onChange={(v) => setForm((f) => ({ ...f, allocations: f.allocations.map((x, j) => (j === i ? { ...x, owner: v } : x)) }))} placeholder="Principal or name" defaultTab="all" style={{ width: '100%' }} inputStyle={input} /></div>
                            <input style={{ ...input, width: 180 }} value={a.amount} onChange={(e) => setForm((f) => ({ ...f, allocations: f.allocations.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) }))} placeholder="amount" />
                            <button type="button" onClick={() => setForm((f) => ({ ...f, allocations: f.allocations.filter((_, j) => j !== i) }))} style={btn(false)} title="Remove"><FaTrash size={11} /></button>
                        </div>
                    ))}
                    <button type="button" onClick={() => setForm((f) => ({ ...f, allocations: [...f.allocations, { owner: '', amount: '' }] }))} style={btn(false)}><FaPlus size={11} /> Add an allocation</button>
                </div>

                <div style={card}>
                    <h2 style={{ margin: '0 0 10px', fontSize: '1.05rem', color: theme.colors.primaryText }}>3. The rules</h2>
                    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                        <div>
                            <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, marginBottom: 6 }}>Minting after launch</div>
                            <div style={{ display: 'grid', gap: 6 }}>
                                {radio('minting', 'nobody', 'Nobody', 'fixed supply: the minting account is the ledger itself')}
                                {radio('minting', 'sneed_dao', 'Sneed DAO', 'minting takes a DAO proposal')}
                                {radio('minting', 'principal', 'A principal', 'its holder can mint without limit; the safety page will say so')}
                                {form.minting === 'principal' && <div style={{ marginLeft: 24 }}><PrincipalInput value={form.mintingPrincipal} onChange={(v) => setForm((f) => ({ ...f, mintingPrincipal: v }))} placeholder="Minting principal" defaultTab="all" style={{ width: '100%' }} inputStyle={input} /></div>}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, marginBottom: 6 }}>Who controls the ledger's code</div>
                            <div style={{ display: 'grid', gap: 6 }}>
                                {radio('control', 'keep', 'Me', 'you can upgrade it; rates low on the safety page until you hand it over')}
                                {radio('control', 'blackhole', 'The blackhole', 'nobody can ever change it, and its cycles stay observable')}
                                {radio('control', 'sneed_dao', 'Sneed DAO', `the DAO upgrades it by proposal, only to vetted code, and keeps it running; registration is proposed automatically${padConfig ? `; ${fmtIcp(padConfig.sneed_dao_control_fee_e8s)} handover fee` : ''}`)}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, marginBottom: 6 }}>Extras</div>
                            <label style={{ display: 'flex', gap: 8, fontSize: '0.88rem', color: theme.colors.primaryText, cursor: 'pointer' }}><input type="checkbox" checked={form.withIndex} onChange={(e) => setForm((f) => ({ ...f, withIndex: e.target.checked }))} /> <span><b>Index canister</b> <span style={{ color: theme.colors.mutedText }}>· wallets and explorers read history from it</span></span></label>
                            <label style={{ ...label, marginTop: 10 }}>Fee collector (optional: transfer fees go here instead of being burned)<PrincipalInput value={form.feeCollector} onChange={(v) => setForm((f) => ({ ...f, feeCollector: v }))} placeholder="Principal or name, or empty" defaultTab="all" style={{ width: '100%' }} inputStyle={input} /></label>
                        </div>
                    </div>
                </div>

                <div style={card}>
                    <h2 style={{ margin: '0 0 10px', fontSize: '1.05rem', color: theme.colors.primaryText }}>4. Price and launch</h2>
                    {built.problems.length > 0 && <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: '#f59e0b', fontSize: '0.85rem' }}>{built.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" style={btn(false, !built.config || quoting || !PAD_CANISTER_ID)} disabled={!built.config || quoting || !PAD_CANISTER_ID} onClick={getQuote}>{quoting ? <FaSpinner className="health-spin" /> : null} Get the price</button>
                        {quote && (
                            <table style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, borderCollapse: 'collapse' }}><tbody>
                                <tr><td style={{ paddingRight: 14 }}>Launch fee{quote.premium ? ', Sneed Premium member rate' : ''} (to the DAO's reward loop)</td><td>{fmtIcp(quote.creation_fee_e8s)}</td></tr>
                                {quote.control_fee_e8s > 0n && <tr><td style={{ paddingRight: 14 }}>Handover fee (Sneed DAO takes over the canisters)</td><td>{fmtIcp(quote.control_fee_e8s)}</td></tr>}
                                <tr><td style={{ paddingRight: 14 }}>Cycles for the ledger{quote.index_cycles > 0n ? ' and index' : ''} ({fmtT(quote.ledger_cycles + quote.index_cycles)})</td><td>{fmtIcp(quote.icp_for_cycles_e8s)}</td></tr>
                                <tr><td style={{ paddingRight: 14 }}>Ledger fees</td><td>{fmtIcp(quote.ledger_fees_e8s)}</td></tr>
                                <tr style={{ color: theme.colors.primaryText, fontWeight: 700 }}><td style={{ paddingRight: 14 }}>Total (plus one approval fee)</td><td>{fmtIcp(quote.total_e8s)}</td></tr>
                            </tbody></table>
                        )}
                        {quote && (isAuthenticated ? (
                            <button type="button" style={btn(true, !!launching)} disabled={!!launching} onClick={launch}>{launching ? <FaSpinner className="health-spin" /> : <FaRocket size={13} />} Approve and launch</button>
                        ) : <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Log in to launch.</span>)}
                    </div>
                    {launching && <div style={{ marginTop: 10, color: theme.colors.secondaryText, fontSize: '0.85rem' }}>{launching}</div>}
                    {error && <div style={{ marginTop: 10, color: '#ef4444', fontSize: '0.88rem' }}>{error}</div>}
                    {result && (
                        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: '#10b98118', border: '1px solid #10b98155', color: theme.colors.primaryText, fontSize: '0.9rem', lineHeight: 1.7 }}>
                            <div><b>{result.config.name} ({result.config.symbol})</b> is live. Ledger <span className="health-mono">{result.ledger[0]?.toText()}</span>{result.index.length ? <>, index <span className="health-mono">{result.index[0].toText()}</span></> : null}.</div>
                            <div>Controlled by {result.controllers.map((p) => p.toText()).join(', ')}{result.registration_proposal.length ? `, registration proposal ${result.registration_proposal[0]} submitted to Sneed DAO` : ''}.</div>
                            <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                                <Link to={`/studio/${result.ledger[0]?.toText()}`} style={{ color: '#10b981', display: 'inline-flex', gap: 6, alignItems: 'center' }}><FaShieldAlt size={12} /> Check it</Link>
                                <a href={`https://dashboard.internetcomputer.org/canister/${result.ledger[0]?.toText()}`} target="_blank" rel="noopener noreferrer" style={{ color: '#10b981', display: 'inline-flex', gap: 6, alignItems: 'center' }}>Dashboard <FaExternalLinkAlt size={10} /></a>
                            </div>
                        </div>
                    )}
                </div>

                {mine.length > 0 && (
                    <div style={card}>
                        <h2 style={{ margin: '0 0 10px', fontSize: '1.05rem', color: theme.colors.primaryText }}>Your launches</h2>
                        {mine.map((l) => (
                            <div key={String(l.id)} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${theme.colors.border}`, fontSize: '0.88rem', color: theme.colors.primaryText }}>
                                <span style={{ fontWeight: 700 }}>{l.config.name} ({l.config.symbol})</span>
                                <span className="health-mono" style={{ color: theme.colors.mutedText }}>{l.ledger[0]?.toText() || 'no ledger'}</span>
                                <span style={{ color: 'failed' in l.status ? '#ef4444' : theme.colors.mutedText }}>{'failed' in l.status ? `failed: ${l.status.failed}` : new Date(Number(l.created_at / 1000000n)).toLocaleString()}</span>
                                {l.ledger.length > 0 && <Link to={`/studio/${l.ledger[0].toText()}`} style={{ color: '#10b981' }}>check</Link>}
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ color: theme.colors.mutedText, fontSize: '0.78rem', lineHeight: 1.6 }}>
                    The ledger code is the DFINITY ICRC ledger suite, fetched by the pad from the NNS's SNS wasm canister: the latest version the NNS approved, unless Sneed DAO pinned one. The creator pays for the cycles of the new canisters; the launch fee goes to the DAO's reward loop. Locking allocations and liquidity through Sneed Lock, and handing control over later, are on the Harden tab and work for existing tokens too.
                </div>
        </>
    );
}

/// The old address: /tools/pad now lives in the studio.
function SneedPad() { return <Navigate to="/studio/launch" replace />; }

export default SneedPad;
