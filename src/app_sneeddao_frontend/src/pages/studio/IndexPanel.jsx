// Create an index canister for a ledger that already exists, from the pad,
// on the NNS-blessed index code. A ledger may have several indexes; one it
// cannot be pointed at (ICRC-106) still serves history on its own. Afterwards:
// point the ledger at it, through a custody op when the ledger is under
// custody, or by a dfx upgrade when its developer controls it.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { FaDatabase, FaSpinner, FaCheck, FaExternalLinkAlt } from 'react-icons/fa';
import TokenSelector from '../../components/TokenSelector';
import PrincipalInput from '../../components/PrincipalInput';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { approveAndRecord } from '../../utils/approvals';
import { expiresInMs } from '../../utils/icrcTx';
import { padIdl, PAD_CANISTER_ID } from '../../tokensafety/padIdl.js';
import { padQuoteTiers } from '../../tokensafety/padPrices.js';
import PriceTierBadge from '../../components/PriceTierBadge';
import { GUARDIANS, guardianIdl, guardianById } from '../../tokensafety/guardianIdl.js';
import { ledgerIndexUpgradeArg, readStatus } from '../../utils/management.js';
import { parsePrincipal } from '../../utils/icrc3/client.js';

const HOST = 'https://icp-api.io';
const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ICP_FEE = 10_000n;
const SNEED_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
const indigo = '#6366f1';
const fmtIcp = (e8s) => `${(Number(e8s) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 4 })} ICP`;
const fmtT = (c) => `${(Number(c) / 1e12).toFixed(1)} T`;

const probeIdl = ({ IDL }) => IDL.Service({ icrc106_get_index_principal: IDL.Func([], [IDL.Variant({ Ok: IDL.Principal, Err: IDL.Reserved })], ['query']) });

export function IndexPanel({ ledgerId: initialLedger, header }) {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const { identity, isAuthenticated } = useAuth();
    const [ledger, setLedger] = useState(initialLedger || '');
    const [known, setKnown] = useState(null); // { announced, ours: [] }
    const [control, setControl] = useState('keep');
    const [guardianKey, setGuardianKey] = useState(GUARDIANS[0]?.key || '');
    const [snsRoot, setSnsRoot] = useState('');
    const [quote, setQuote] = useState(null);
    const [quoteTiers, setQuoteTiers] = useState(null); // admin / partner price badges for the quote
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [custody, setCustody] = useState(null); // the ledger's custody child, if any
    const [pointed, setPointed] = useState(null);
    const pad = useCallback((withId) => (PAD_CANISTER_ID ? Actor.createActor(padIdl, { agent: new HttpAgent({ host: HOST, ...(withId && identity ? { identity } : {}) }), canisterId: PAD_CANISTER_ID }) : null), [identity]);

    useEffect(() => { setLedger(initialLedger || ''); }, [initialLedger]);
    useEffect(() => {
        const p = parsePrincipal(ledger); setKnown(null); setQuote(null); setResult(null); setCustody(null);
        if (!p) return;
        let live = true;
        (async () => {
            const l = Actor.createActor(probeIdl, { agent: new HttpAgent({ host: HOST }), canisterId: p.toText() });
            const [announced, ours] = await Promise.all([
                l.icrc106_get_index_principal().then((r) => ('Ok' in r ? r.Ok.toText() : null)).catch(() => null),
                pad(false)?.get_indexes_of_ledger(p).then((xs) => xs.map((x) => x.toText())).catch(() => []) || [],
            ]);
            if (live) setKnown({ announced, ours });
            // under custody?
            for (const g of GUARDIANS) {
                try { const c = await Actor.createActor(guardianIdl, { agent: new HttpAgent({ host: HOST }), canisterId: g.id }).get_child(p); if (c[0] && live) { setCustody({ dep: g, child: c[0] }); break; } } catch { /* next */ }
            }
        })();
        return () => { live = false; };
    }, [ledger, pad]);

    const controlValue = () => {
        if (control === 'guardian') { const g = GUARDIANS.find((x) => x.key === guardianKey); if (!g) throw new Error('pick a custody canister'); return { guardian: { canister: Principal.fromText(g.id), policy: custody?.child?.policy || { guardians: [], vetoes_to_block: 0n, oks_required: 0n, window_ns: 0n, auto_upgrade: true } } }; }
        if (control === 'sns') { const r = parsePrincipal(snsRoot); if (!r) throw new Error('the SNS root canister is needed'); return { sns: r }; }
        return { [control]: null };
    };
    const getQuote = async () => {
        setError(''); setQuote(null); setBusy('quote');
        setQuoteTiers(null);
        try {
            const a = pad(true);
            const r = await a.get_index_quote({ ledger: Principal.fromText(ledger), control: controlValue() }); if ('Err' in r) throw new Error(r.Err); setQuote(r.Ok);
            if (identity) padQuoteTiers(a, identity.getPrincipal(), r.Ok, { index: true }).then(setQuoteTiers).catch(() => {});
        }
        catch (e) { setError(e?.message || String(e)); }
        finally { setBusy(''); }
    };
    const create = async () => {
        if (!quote) return;
        setError(''); setBusy('create');
        try {
            const icp = createLedgerActor(ICP_LEDGER, { agentOptions: { identity, host: HOST } });
            const ap = await approveAndRecord(icp, ICP_LEDGER, { from_subaccount: [], spender: { owner: Principal.fromText(PAD_CANISTER_ID), subaccount: [] }, amount: quote.total_e8s + ICP_FEE, expected_allowance: [], expires_at: expiresInMs(), fee: [], memo: [], created_at_time: [] });
            if ('Err' in ap) throw new Error(`approval failed: ${JSON.stringify(ap.Err, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
            const r = await pad(true).create_index({ ledger: Principal.fromText(ledger), control: controlValue() });
            if ('Err' in r) throw new Error(r.Err);
            setResult(r.Ok); setQuote(null);
        } catch (e) { setError(e?.message || String(e)); }
        finally { setBusy(''); }
    };
    /// The ledger is under custody: stage the ICRC-106 reconfiguration op (same code, new argument).
    const stagePointing = async () => {
        if (!custody || !result?.index?.[0]) return;
        setError(''); setBusy('point');
        try {
            const g = Actor.createActor(guardianIdl, { agent: new HttpAgent({ host: HOST, identity }), canisterId: custody.dep.id });
            const st = custody.child.status[0];
            if (!st?.module_hash?.[0]) throw new Error('the custody canister has no status reading of the ledger yet; try again in a minute');
            const r = await g.stage_op(Principal.fromText(ledger), { install: { hash: st.module_hash[0], arg: [ledgerIndexUpgradeArg(result.index[0])] } }, `announce index ${result.index[0].toText()} (ICRC-106)`, []);
            if ('Err' in r) throw new Error(r.Err);
            setPointed(r.Ok);
        } catch (e) { setError(e?.message || String(e)); }
        finally { setBusy(''); }
    };

    const card = { background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem 1.1rem', marginBottom: 14 };
    const h = { margin: '0 0 6px', fontSize: '1.05rem', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: 8 };
    const p = { color: theme.colors.secondaryText, fontSize: '0.88rem', lineHeight: 1.6, margin: '0 0 8px' };
    const input = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' };
    const btn = (primary, disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: `1px solid ${primary ? indigo : theme.colors.border}`, background: primary ? indigo : 'transparent', color: primary ? '#fff' : theme.colors.primaryText, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, fontSize: '0.9rem' });
    const radio = (value, text, help) => (
        <label key={value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem', color: theme.colors.primaryText, cursor: 'pointer' }}>
            <input type="radio" name="index-control" checked={control === value} onChange={() => setControl(value)} style={{ marginTop: 3 }} />
            <span><b>{text}</b>{help && <span style={{ color: theme.colors.mutedText }}> · {help}</span>}</span>
        </label>
    );
    const code = { display: 'block', padding: '8px 10px', borderRadius: 8, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.78rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '4px 0 10px' };

    if (!PAD_CANISTER_ID) return <div style={{ ...card, color: '#f59e0b' }}>The launchpad canister is not deployed in this build yet.</div>;
    return (
        <>
            <div style={card}>
                <h2 style={h}><FaDatabase size={14} color={indigo} /> An index for {header?.symbol || 'a token'}</h2>
                <p style={p}>An index canister serves per-account history, which wallets and explorers need. The pad creates one on the same NNS-blessed index code every SNS runs, pointed at the ledger you choose. A ledger may have more than one; a second one is redundancy. The index works whether or not the ledger announces it.</p>
                {!initialLedger && <div style={{ marginBottom: 10 }}><TokenSelector value={ledger} onChange={(id) => { setLedger(id); if (parsePrincipal(id)) navigate(`/studio/${id}/index`); }} placeholder="Pick a token, or enter any ledger canister id" allowCustom /></div>}
                {known && (
                    <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, display: 'grid', gap: 4 }}>
                        <div>Announced by the ledger (ICRC-106): {known.announced ? <span className="health-mono">{known.announced}</span> : 'none'}</div>
                        <div>Created here before: {known.ours.length ? known.ours.map((x) => <span key={x} className="health-mono" style={{ marginRight: 8 }}>{x}</span>) : 'none'}</div>
                        {custody && <div>The ledger is under {custody.dep.name}: the new index can be announced through a custody op below.</div>}
                    </div>
                )}
            </div>

            {parsePrincipal(ledger) && !result && (
                <div style={card}>
                    <h2 style={h}>Who controls the index</h2>
                    <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                        {radio('keep', 'Me', 'you can upgrade it')}
                        {radio('blackhole', 'The blackhole', 'nobody can ever change it')}
                        {custody
                            ? radio('guardian', `${custody.dep.name}, like the ledger`, 'same rules as the ledger; registered as its index')
                            : GUARDIANS.length ? radio('guardian', 'Sneed custody', 'only NNS-blessed code, changed by DAO vote') : null}
                        {control === 'guardian' && !custody && GUARDIANS.length > 1 && <select value={guardianKey} onChange={(e) => setGuardianKey(e.target.value)} style={{ ...input, width: 'auto', marginLeft: 24 }}>{GUARDIANS.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}</select>}
                        {radio('sneed_dao', 'Sneed DAO', 'Sneed root becomes the controller; register it with your neuron afterwards')}
                        {radio('sns', 'Another SNS DAO', 'its root becomes the controller')}
                        {control === 'sns' && <div style={{ marginLeft: 24 }}><PrincipalInput value={snsRoot} onChange={setSnsRoot} placeholder="SNS root canister" defaultTab="all" style={{ width: '100%' }} inputStyle={input} isAuthenticated={isAuthenticated} /></div>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" style={btn(false, !!busy || !isAuthenticated)} disabled={!!busy || !isAuthenticated} onClick={getQuote}>{busy === 'quote' ? <FaSpinner className="health-spin" /> : null} Get the price</button>
                        {!isAuthenticated && <span style={{ fontSize: '0.82rem', color: theme.colors.mutedText }}>Log in to create an index.</span>}
                    </div>
                    {quote && (
                        <div style={{ marginTop: 12, fontSize: '0.88rem', color: theme.colors.secondaryText }}>
                            <table style={{ borderCollapse: 'collapse' }}><tbody>
                                <tr><td style={{ paddingRight: 14 }}>Index fee{quote.premium ? ', Sneed Premium member rate' : ''}</td><td>{fmtIcp(quote.creation_fee_e8s)}<PriceTierBadge tier={quoteTiers?.creation.tier} partnerLabel={quoteTiers?.creation.partnerLabel} /></td></tr>
                                {quote.control_fee_e8s > 0n && <tr><td style={{ paddingRight: 14 }}>Handover fee</td><td>{fmtIcp(quote.control_fee_e8s)}<PriceTierBadge tier={quoteTiers?.control.tier} partnerLabel={quoteTiers?.control.partnerLabel} /></td></tr>}
                                <tr><td style={{ paddingRight: 14 }}>Cycles for the index ({fmtT(quote.index_cycles)})</td><td>{fmtIcp(quote.icp_for_cycles_e8s)}</td></tr>
                                <tr><td style={{ paddingRight: 14 }}>Ledger fees</td><td>{fmtIcp(quote.ledger_fees_e8s)}</td></tr>
                                <tr><td style={{ paddingRight: 14, fontWeight: 700, color: theme.colors.primaryText }}>Total</td><td style={{ fontWeight: 700, color: theme.colors.primaryText }}>{fmtIcp(quote.total_e8s)}</td></tr>
                            </tbody></table>
                            <button type="button" style={{ ...btn(true, !!busy), marginTop: 10 }} disabled={!!busy} onClick={create}>{busy === 'create' ? <FaSpinner className="health-spin" /> : <FaDatabase />} Approve and create the index</button>
                        </div>
                    )}
                    {error && <div style={{ marginTop: 8, color: theme.colors.error, fontSize: '0.88rem' }}>{error}</div>}
                </div>
            )}

            {result && (
                <div style={card}>
                    <h2 style={h}><FaCheck size={14} color="#10b981" /> Index created</h2>
                    <p style={p}>Index <span className="health-mono">{result.index[0]?.toText()}</span> is indexing <span className="health-mono">{ledger}</span>. Controlled by {result.controllers.map((c) => c.toText()).join(', ')}. It is listed in your wallet.</p>
                    <h3 style={{ ...h, fontSize: '0.95rem' }}>Let the ledger announce it (ICRC-106)</h3>
                    {custody ? (
                        <>
                            <p style={p}>The ledger is under {custody.dep.name}. Stage a reconfiguration op: the same ledger code, upgraded once with an argument that sets the index. It then needs the DAO's approval like any op.</p>
                            {pointed ? <div style={{ fontSize: '0.88rem', color: '#10b981' }}>Op #{pointed.id.toString()} staged. <Link to={`/guardian?deployment=${custody.dep.key}&child=${ledger}`} style={{ color: theme.colors.accent }}>Pay its fee and propose approval <FaExternalLinkAlt size={9} /></Link></div>
                                : <button type="button" style={btn(true, !!busy)} disabled={!!busy} onClick={stagePointing}>{busy === 'point' ? <FaSpinner className="health-spin" /> : null} Stage the announcement op</button>}
                        </>
                    ) : (
                        <>
                            <p style={p}>Whoever controls the ledger upgrades it once with the same wasm and this argument (the ledger suite reads <code>index_principal</code> on upgrade; older ledger versions ignore it, and the index still works on its own):</p>
                            <code style={code}>{`dfx canister --network ic install ${ledger} --mode upgrade --wasm <the ledger's current wasm> --argument '(opt variant { Upgrade = opt record { index_principal = opt principal "${result.index[0]?.toText()}" } })'`}</code>
                            <p style={{ ...p, fontSize: '0.82rem' }}>Under custody this is one op; <Link to={`/studio/${ledger}/handover`} style={{ color: theme.colors.accent }}>hand the ledger over</Link> and the pad can do it for you next time.</p>
                        </>
                    )}
                    {error && <div style={{ marginTop: 8, color: theme.colors.error, fontSize: '0.88rem' }}>{error}</div>}
                    <div style={{ marginTop: 8, fontSize: '0.85rem' }}><Link to={`/studio/${ledger}?index=${result.index[0]?.toText()}`} style={{ color: theme.colors.accent }}>Re-run the safety check with this index</Link></div>
                </div>
            )}
        </>
    );
}

export default IndexPanel;
