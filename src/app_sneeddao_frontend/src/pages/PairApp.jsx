// /pair?key=…: approve an installed Sneed Hub app to use this browser's login (utils/pairing.js).
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { approvePairing, checkCode } from '../utils/pairing';

export default function PairApp() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated, login } = useAuth();
    const [params] = useSearchParams();
    const keyHex = (params.get('key') || '').toLowerCase();
    const valid = /^[0-9a-f]{40,200}$/.test(keyHex);
    const [code, setCode] = useState(null);
    const [approval, setApproval] = useState(null);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { if (valid) checkCode(keyHex).then(setCode); }, [keyHex, valid]);

    const allow = async () => {
        setError('');
        try { setApproval(await approvePairing(identity, keyHex)); } catch (e) { setError(e.message || String(e)); }
    };
    const copy = async () => { try { await navigator.clipboard.writeText(approval); setCopied(true); } catch { setError('Copy failed: select the text and copy it by hand.'); } };

    const card = { background: c.cardBg || c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 12 };
    const p = { margin: 0, color: c.secondaryText, lineHeight: 1.55, fontSize: '0.9rem' };
    const btn = (primary) => ({ padding: '12px 16px', borderRadius: 10, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? '#3498db' : 'transparent', color: primary ? 'white' : c.primaryText, fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer' });
    return (
        <>
            <Header />
            <div style={{ maxWidth: 520, margin: '0 auto', padding: '1.5rem 16px 3rem' }}>
                <div style={card}>
                    <h1 style={{ margin: 0, fontSize: '1.35rem', color: c.primaryText }}>Approve the Sneed Hub app</h1>
                    {!valid ? <p style={p}>This pairing link is incomplete. Start again from the app's login screen.</p> : !approval ? (
                        <>
                            <p style={p}>An installed Sneed Hub app asks to use your login. Only allow it if <strong>your own app</strong> shows this code right now:</p>
                            <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: '1.8rem', fontWeight: 700, letterSpacing: 3, color: c.primaryText }}>{code || '…'}</div>
                            <p style={{ ...p, fontSize: '0.8rem', color: c.mutedText }}>Allowing gives that app your Sneed Hub login until this browser's login expires. If someone sent you this link, don't allow it.</p>
                            {!isAuthenticated
                                ? <button type="button" style={btn(true)} onClick={login}>Log in to continue</button>
                                : <button type="button" style={btn(true)} onClick={allow}>Allow</button>}
                        </>
                    ) : (
                        <>
                            <p style={p}>Allowed. Copy the approval, go back to the Sneed Hub app and tap <strong>Paste approval</strong>.</p>
                            <button type="button" style={btn(true)} onClick={copy}>{copied ? 'Copied ✓' : 'Copy approval'}</button>
                            <textarea readOnly value={approval} rows={4} onFocus={(e) => e.target.select()}
                                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.7rem', background: c.tertiaryBg, color: c.mutedText, border: `1px solid ${c.border}`, borderRadius: 8, padding: 8 }} />
                        </>
                    )}
                    {error && <div style={{ color: c.error || '#ff5252', fontSize: '0.85rem' }}>{error}</div>}
                </div>
            </div>
        </>
    );
}
