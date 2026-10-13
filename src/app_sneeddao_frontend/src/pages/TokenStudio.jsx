// /studio: the Token Studio. One place for any token: Check rates it from
// public data, Harden lists what its owner can do about each weak line, and
// Launch mints a new one on the pad. The report drives the actions.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import Header from '../components/Header';
import TokenSelector from '../components/TokenSelector';
import { useTheme } from '../contexts/ThemeContext';
import { FaFlask, FaShieldAlt, FaRocket, FaWrench, FaSearch, FaSpinner, FaLock, FaExternalLinkAlt } from 'react-icons/fa';
import { customStyles, primary } from '../health/TreeView.jsx';
import { fetchTokenHeader } from '../tokensafety/checks.js';
import { parsePrincipal } from '../utils/icrc3/client.js';
import { CheckPanel } from './TokenSafety.jsx';
import { LaunchPanel } from './SneedPad.jsx';

const BLACKHOLE = 'e3mmv-5qaaa-aaaah-aadma-cai';

function HardenPanel({ ledgerId, header, theme }) {
    const { hash } = useLocation();
    useEffect(() => {
        if (!hash) return;
        const el = document.getElementById(hash.slice(1));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [hash]);
    const card = (id) => ({ id, style: { border: `1px solid ${hash === `#${id}` ? primary : theme.colors.border}`, borderRadius: 14, padding: '1rem 1.1rem', background: theme.colors.cardBg, marginBottom: '1rem', scrollMarginTop: 90 } });
    const h = { margin: '0 0 6px', fontSize: '1.05rem', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: 8 };
    const p = { color: theme.colors.secondaryText, fontSize: '0.88rem', lineHeight: 1.6, margin: '0 0 8px' };
    const soon = { display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b55', marginLeft: 6, verticalAlign: 'middle' };
    const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, background: primary, color: '#fff', fontWeight: 700, textDecoration: 'none', fontSize: '0.85rem' };
    const code = { display: 'block', padding: '8px 10px', borderRadius: 8, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.78rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '6px 0' };
    const sym = header?.symbol || 'the token';
    return (
        <>
            <div style={{ ...p, marginBottom: '1rem' }}>Each section answers a line of the report. What exists today is a button; what the studio will do for you next is marked.</div>

            <div {...card('locks')}>
                <h2 style={h}><FaLock size={14} color={primary} /> Lock supply</h2>
                <p style={p}>Large unlocked holdings are the first thing the report flags. Tokens locked in Sneed Lock cannot move until the lock ends, which the report reads directly from the lock canister, and the unlock schedule shows up as cliffs. SNS neurons count the same way.</p>
                <Link to={`/lock_wizard?type=token&token=${ledgerId}`} style={btn}><FaLock size={12} /> Lock {sym} in Sneed Lock</Link>
            </div>

            <div {...card('liquidity')}>
                <h2 style={h}><FaLock size={14} color={primary} /> Liquidity</h2>
                <p style={p}>The report wants a pool on ICPSwap, depth in proportion to the market cap, and the position under safe control: locked in Sneed Lock, owned by a DAO, or burned. A position the creator can pull at any time rates as unsafe however deep it is. Positions are created and managed from here, in your Sneed wallet; a pool for a brand-new pair still has to be created on ICPSwap first.</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Link to={`/lock_wizard?type=position&token=${ledgerId}`} style={btn}><FaLock size={12} /> Lock an LP position</Link>
                    <Link to="/managelp" style={{ ...btn, background: 'transparent', color: primary, border: `1px solid ${primary}` }}>Create or grow a position</Link>
                </div>
            </div>

            <div {...card('control')}>
                <h2 style={h}><FaShieldAlt size={14} color={primary} /> Who controls the code<span style={soon}>handover from here: soon</span></h2>
                <p style={p}>A ledger whose controller is a wallet can be replaced by any code at any time, so the report cannot verify anything else about it. The honest end states are the blackhole canister (nobody can ever change it, and its cycles stay observable) or an SNS DAO (changes take a public proposal). The studio will file these from here; today they are two commands for the controller.</p>
                <p style={{ ...p, marginBottom: 2 }}>Blackhole the ledger (and each archive and the index the same way):</p>
                <code style={code}>{`dfx canister --network ic update-settings ${ledgerId} --set-controller ${BLACKHOLE}`}</code>
                <p style={{ ...p, marginBottom: 2 }}>Or hand it to an SNS: make its root canister the only controller, then have a neuron of that SNS propose RegisterDappCanisters for it. The studio will file that proposal with your own hotkeyed neuron next.</p>
                <code style={code}>{`dfx canister --network ic update-settings ${ledgerId} --set-controller <sns root canister>`}</code>
                <p style={p}>Code that is not an NNS-approved ledger-suite version fails the second gate. Moving to vetted code means upgrading to a ledger-suite wasm from the SNS wasm canister, with the Upgrade argument, before handing control over.</p>
            </div>

            <div {...card('index')}>
                <h2 style={h}><FaWrench size={14} color={primary} /> Index canister<span style={soon}>from the studio: soon</span></h2>
                <p style={p}>Wallets and explorers read history from an index canister. The report looks for one through ICRC-106 and the SNS registry, and rates its controller like the ledger's. The studio will mint a ledger-suite index for an existing ledger, paid for in cycles like a launch. Until then, the index wasm is the same one the pad uses, from the SNS wasm canister, installed with the ledger's id as its init argument.</p>
            </div>

            <div {...card('minting')}>
                <h2 style={h}><FaWrench size={14} color={primary} /> Minting</h2>
                <p style={p}>The minting account is set when the ledger is installed and cannot be changed afterwards, not even by an upgrade. If it is a wallet, that wallet can mint without limit and the report will keep saying so. The honest options are to make the minting principal a canister a DAO controls, or to relaunch from the studio with minting set to nobody and move holders over.</p>
            </div>

            <div {...card('cycles')}>
                <h2 style={h}><FaWrench size={14} color={primary} /> Cycles<span style={soon}>ic-unicycle: integration coming</span></h2>
                <p style={p}>A ledger that runs out of cycles stops, and a ledger whose cycles nobody can see cannot be trusted to keep running. Cycles are observable when the blackhole canister or an SNS root controls it. Sneed DAO already runs ic-unicycle, a member-built monitor that watches cycles, tops canisters up, and can file treasury proposals for SNS-controlled canisters and dapps; the studio will hand ledgers and indexes to it from here.</p>
                <a href={`https://dashboard.internetcomputer.org/canister/${ledgerId}`} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: 'transparent', color: primary, border: `1px solid ${primary}` }}>Dashboard <FaExternalLinkAlt size={10} /></a>
            </div>
        </>
    );
}

function TokenStudio() {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const { ledgerId: routeLedger, tab: routeTab } = useParams();
    const isLaunch = routeLedger === 'launch' || (!routeLedger);
    const ledgerId = !isLaunch && parsePrincipal(routeLedger) ? routeLedger : null;
    const tab = isLaunch ? 'launch' : routeTab === 'harden' ? 'harden' : 'check';
    const [text, setText] = useState(ledgerId || '');
    const [header, setHeader] = useState(null);
    const [rating, setRating] = useState(null);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => { setText(ledgerId || ''); setHeader(null); setRating(null); if (!ledgerId) return; let live = true; fetchTokenHeader(ledgerId).then((h) => { if (live) setHeader(h); }).catch(() => {}); return () => { live = false; }; }, [ledgerId]);
    const onRating = useCallback((r, isRunning) => { setRating(r); setRunning(isRunning); }, []);

    const submit = (value) => {
        const p = parsePrincipal(value || '');
        if (!p) { setError('That is not a principal'); return; }
        setError(null);
        navigate(`/studio/${p.toText()}`);
    };

    const tabStyle = (active, disabled) => ({ padding: '9px 16px', borderRadius: 10, border: `1px solid ${active ? primary : theme.colors.border}`, background: active ? `${primary}22` : 'transparent', color: disabled ? theme.colors.mutedText : theme.colors.primaryText, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.9rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8 });
    const card = { border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem', background: theme.colors.cardBg, marginBottom: '1rem' };

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: `${primary}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FaFlask size={24} color={primary} /></div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: theme.colors.primaryText }}>Token Studio</h1>
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>Check any token against what the chain says about it, harden what the report flags, or launch a new one on vetted code. Nothing here is self-reported.</div>
                    </div>
                </div>

                <div style={card}>
                    <form onSubmit={(e) => { e.preventDefault(); submit(text); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ flex: '1 1 320px', minWidth: 240 }}>
                            <TokenSelector value={text} onChange={(id) => { setText(id); if (id) submit(id); }} placeholder="Pick a token, or enter any ledger canister id" allowCustom />
                        </div>
                        <button type="submit" style={{ ...tabStyle(true, false) }} disabled={!text}>{running ? <FaSpinner className="health-spin" size={12} /> : <FaSearch size={12} />} Check</button>
                    </form>
                    {error && <div style={{ marginTop: 10, color: '#ef4444', fontSize: '0.88rem' }}>{error}</div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                        <button type="button" style={tabStyle(tab === 'check', !ledgerId)} disabled={!ledgerId} onClick={() => navigate(`/studio/${ledgerId}`)}><FaShieldAlt size={12} /> Check</button>
                        <button type="button" style={tabStyle(tab === 'harden', !ledgerId)} disabled={!ledgerId} onClick={() => navigate(`/studio/${ledgerId}/harden`)}><FaWrench size={12} /> Harden</button>
                        <button type="button" style={tabStyle(tab === 'launch', false)} onClick={() => navigate('/studio/launch')}><FaRocket size={12} /> Launch</button>
                    </div>
                </div>

                {ledgerId && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: '1rem' }}>
                        {header?.logo ? (
                            <img src={header.logo} alt="" style={{ width: 52, height: 52, borderRadius: 14, objectFit: 'cover', background: theme.colors.secondaryBg, flexShrink: 0 }} />
                        ) : (
                            <div style={{ width: 52, height: 52, borderRadius: 14, background: theme.colors.secondaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.colors.mutedText, fontWeight: 800, flexShrink: 0 }}>{header?.symbol?.slice(0, 3) || '?'}</div>
                        )}
                        <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: theme.colors.primaryText }}>
                                {header?.name ? `${header.name}${header.symbol ? ` (${header.symbol})` : ''}` : 'Reading the ledger…'}
                                <a href={`https://dashboard.internetcomputer.org/canister/${ledgerId}`} target="_blank" rel="noopener noreferrer" className="health-mono" style={{ marginLeft: 10, fontSize: '0.8rem', color: theme.colors.mutedText, textDecoration: 'none', fontWeight: 400 }}>{ledgerId}</a>
                            </div>
                            {tab === 'harden' && rating && <div style={{ fontSize: '0.95rem', fontWeight: 700, color: rating.color }}>{rating.label}{running ? ' (still checking)' : ''}</div>}
                        </div>
                    </div>
                )}

                {ledgerId && (
                    <div style={{ display: tab === 'check' ? 'block' : 'none' }}>
                        <CheckPanel ledgerId={ledgerId} onRating={onRating} />
                    </div>
                )}
                {ledgerId && tab === 'harden' && <HardenPanel ledgerId={ledgerId} header={header} theme={theme} />}
                {tab === 'launch' && <LaunchPanel />}
            </main>
        </div>
    );
}

export default TokenStudio;
