// /connect-agent?key=…&name=…&callback=http://127.0.0.1:PORT/…: let a local AI agent (the Sneed Hub
// MCP server) act as you, limited to the canisters and time you choose (utils/agentConnect.js).
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import {
    approveAgent, approvalCode, checkCode, deliverToAgent, isCanisterId, sessionExpiryNs, targetsFor, validCallback,
    SNEED_CANISTERS,
} from '../utils/agentConnect';

const EXPIRIES = [['1 hour', 3600_000], ['24 hours', 86400_000], ['7 days', 7 * 86400_000]];

export default function ConnectAgent() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated, login } = useAuth();
    const [params] = useSearchParams();
    const keyHex = (params.get('key') || '').toLowerCase();
    const agentName = (params.get('name') || 'AI agent').slice(0, 60);
    const callback = params.get('callback') || '';
    const validKey = /^[0-9a-f]{40,200}$/.test(keyHex);
    const cbOk = !callback || validCallback(callback);
    const [code, setCode] = useState(null);
    const [scope, setScope] = useState({ icp: false, sneed: false, governance: false, custom: false, everything: false });
    const [extra, setExtra] = useState('');
    const [expiry, setExpiry] = useState(86400_000);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null); // { delivered, until, code, error }
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);

    useEffect(() => { if (validKey) checkCode(keyHex).then(setCode); }, [keyHex, validKey]);

    const extraIds = useMemo(() => extra.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean), [extra]);
    const badExtra = scope.custom ? extraIds.filter((x) => !isCanisterId(x)) : [];
    const sessionEndMs = identity ? Number((sessionExpiryNs(identity) ?? 0n) / 1_000_000n) : 0;
    const untilMs = Math.min(Date.now() + expiry, sessionEndMs || Infinity);
    const me = isAuthenticated && identity ? identity.getPrincipal().toText() : null;

    const approve = async () => {
        setError(''); setBusy(true);
        try {
            const targets = targetsFor({ ...scope, extra: scope.custom ? extraIds : [] });
            const chain = await approveAgent(identity, keyHex, { targets, expiresMs: Date.now() + expiry });
            const until = new Date(untilMs).toLocaleString();
            const text = approvalCode(chain);
            if (callback) {
                try { await deliverToAgent(callback, chain); setDone({ delivered: true, until }); return; } catch (e) {
                    setDone({ delivered: false, until, code: text, error: e.message || String(e), canNavigate: true });
                    return;
                }
            }
            setDone({ delivered: false, until, code: text });
        } catch (e) { setError(e.message || String(e)); } finally { setBusy(false); }
    };
    const sendByNavigation = () => { window.location.href = `${callback}${callback.includes('?') ? '&' : '?'}d=${done.code}`; };
    const copy = async () => { try { await navigator.clipboard.writeText(done.code); setCopied(true); } catch { setError('Copy failed: select the text and copy it by hand.'); } };

    const card = { background: c.cardBg || c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 12 };
    const p = { margin: 0, color: c.secondaryText, lineHeight: 1.55, fontSize: '0.9rem' };
    const small = { ...p, fontSize: '0.8rem', color: c.mutedText };
    const btn = (primary) => ({ padding: '12px 16px', borderRadius: 10, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? '#3498db' : 'transparent', color: primary ? 'white' : c.primaryText, fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer' });
    const check = (k, label, hint) => (
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: c.primaryText, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={scope[k]} onChange={(e) => setScope({ ...scope, [k]: e.target.checked })} style={{ marginTop: 3 }} />
            <span>{label}{hint && <span style={{ display: 'block', color: c.mutedText, fontSize: '0.78rem' }}>{hint}</span>}</span>
        </label>
    );

    return (
        <>
            <Header />
            <div style={{ maxWidth: 560, margin: '0 auto', padding: '1.5rem 16px 3rem' }}>
                <div style={card}>
                    <h1 style={{ margin: 0, fontSize: '1.35rem', color: c.primaryText }}>Let an AI agent act as you</h1>
                    {!validKey || !cbOk ? (
                        <p style={p}>{!validKey ? 'This link is incomplete.' : 'This link sends the approval somewhere other than your own computer (only http://127.0.0.1 or http://localhost is allowed), so it is refused.'} Start again from your agent (connect_as_me).</p>
                    ) : done ? (
                        done.delivered ? (
                            <>
                                <p style={p}><strong>Done.</strong> {agentName} can now act as you until <strong>{done.until}</strong>, within the scope you chose. Go back to your agent.</p>
                                <p style={small}>This cannot be revoked on-chain; it ends at that time. To end it earlier, tell the agent to disconnect (it deletes its key).</p>
                            </>
                        ) : (
                            <>
                                {done.error && <p style={p}>The page could not reach the agent on this computer ({done.error}).</p>}
                                {done.canNavigate && <button type="button" style={btn(true)} onClick={sendByNavigation}>Send it by opening the agent's page</button>}
                                <p style={p}>Or copy this approval and give it to the agent (connect_as_me with code). It only works together with the agent's own key, so it is not a secret.</p>
                                <button type="button" style={btn(!done.canNavigate)} onClick={copy}>{copied ? 'Copied ✓' : 'Copy approval'}</button>
                                <textarea readOnly value={done.code} rows={4} onFocus={(e) => e.target.select()}
                                    style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.7rem', background: c.tertiaryBg, color: c.mutedText, border: `1px solid ${c.border}`, borderRadius: 8, padding: 8 }} />
                                <p style={small}>Valid until {done.until}.</p>
                            </>
                        )
                    ) : (
                        <>
                            <p style={p}><strong>{agentName}</strong> asks to act as you on Sneed Hub. Only allow it if <strong>your own agent</strong> shows this code right now:</p>
                            <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: '1.8rem', fontWeight: 700, letterSpacing: 3, color: c.primaryText }}>{code || '…'}</div>
                            {!isAuthenticated ? (
                                <button type="button" style={btn(true)} onClick={login}>Log in to continue</button>
                            ) : (
                                <>
                                    <p style={p}>It will act as <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{me}</span>. Everything it does on-chain is public and tied to this principal.</p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <div style={{ color: c.primaryText, fontWeight: 600, fontSize: '0.9rem' }}>What it may use</div>
                                        <p style={small}>Always: the Sneed canisters ({SNEED_CANISTERS.map(([n]) => n).join(', ')}).</p>
                                        {check('icp', 'Your ICP', 'Needed for fees (Sneedex offers, locks), ICP bids and tips')}
                                        {check('sneed', 'Your SNEED', 'Tips, bids and locks in SNEED')}
                                        {check('governance', 'Sneed DAO governance', 'Vote and make proposals with your neurons')}
                                        {check('custom', 'NFT collections and other token ledgers I choose')}
                                        {scope.custom && (
                                            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Canister ids, separated by spaces or commas"
                                                style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${badExtra.length ? (c.error || '#ff5252') : c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: '0.85rem', fontFamily: 'monospace' }} />
                                        )}
                                        {badExtra.length > 0 && <div style={{ color: c.error || '#ff5252', fontSize: '0.8rem' }}>Not canister ids: {badExtra.join(', ')}</div>}
                                        {check('everything', 'Everything', 'Any canister, including all your tokens. Only for agents you fully trust.')}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <div style={{ color: c.primaryText, fontWeight: 600, fontSize: '0.9rem' }}>For how long</div>
                                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                            {EXPIRIES.map(([label, ms]) => (
                                                <button key={ms} type="button" onClick={() => setExpiry(ms)}
                                                    style={{ ...btn(false), padding: '8px 14px', fontSize: '0.85rem', background: expiry === ms ? c.tertiaryBg : 'transparent', borderColor: expiry === ms ? '#3498db' : c.border }}>{label}</button>
                                            ))}
                                        </div>
                                        <p style={small}>Until {new Date(untilMs).toLocaleString()}{sessionEndMs && Date.now() + expiry > sessionEndMs ? ' (your own login ends then)' : ''}. It cannot be revoked on-chain, so shorter is safer.</p>
                                    </div>
                                    <button type="button" style={btn(true)} disabled={busy || badExtra.length > 0} onClick={approve}>{busy ? 'Approving…' : 'Allow'}</button>
                                    <p style={small}>The agent still shows you a preview of every action and needs your OK, with daily spending caps. If someone sent you this link, don't allow it.</p>
                                </>
                            )}
                        </>
                    )}
                    {error && <div style={{ color: c.error || '#ff5252', fontSize: '0.85rem' }}>{error}</div>}
                </div>
            </div>
        </>
    );
}
