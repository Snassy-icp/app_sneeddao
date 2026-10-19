// In the installed app's login dialog: log in through a browser where you are logged in
// (utils/pairing.js explains why).
import React, { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { startPairing } from '../utils/pairing';

export default function PairAppPanel() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { completePairing } = useAuth();
    const [pair, setPair] = useState(null); // { code, url }
    const [copied, setCopied] = useState(false);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { startPairing().then(setPair).catch((e) => setError(e.message || String(e))); }, []);

    const copyLink = async () => {
        try { await navigator.clipboard.writeText(pair.url); setCopied(true); } catch { setCopied(false); setError('Copy failed: select the link and copy it by hand.'); }
    };
    const finish = async (value) => {
        setBusy(true); setError('');
        try { await completePairing(value); } catch (e) { setError(e.message || String(e)); } finally { setBusy(false); }
    };
    const pasteFromClipboard = async () => {
        try { const t = await navigator.clipboard.readText(); if (t) return finish(t); } catch { /* fall back to the box */ }
        setPasteOpen(true);
    };

    const button = (primary) => ({ width: '100%', padding: '14px 16px', borderRadius: '12px', border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? '#3498db' : c.secondaryBg, color: primary ? 'white' : c.primaryText, fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer' });
    const step = { fontSize: '0.85rem', color: c.secondaryText, lineHeight: 1.5, margin: 0 };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={step}>In this app, Internet Identity can't hand the login back. Approve the app from Safari instead (or any browser where you use Sneed Hub):</p>
            <p style={step}><strong>1.</strong> Copy this link and open it in Safari:</p>
            <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', background: c.tertiaryBg, border: `1px solid ${c.border}`, borderRadius: '8px', padding: '8px', color: c.mutedText, userSelect: 'all' }}>{pair ? pair.url : 'Preparing…'}</div>
            <button type="button" style={button(false)} disabled={!pair} onClick={copyLink}>{copied ? 'Link copied ✓' : 'Copy link'}</button>
            <p style={step}><strong>2.</strong> Log in there, check that it shows this code, and tap Allow:</p>
            <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: '1.6rem', fontWeight: 700, letterSpacing: '3px', color: c.primaryText }}>{pair ? pair.code : '…'}</div>
            <p style={step}><strong>3.</strong> Copy the approval it gives you, come back here, and paste it:</p>
            <button type="button" style={button(true)} disabled={!pair || busy} onClick={pasteFromClipboard}>{busy ? 'Logging in…' : 'Paste approval'}</button>
            {pasteOpen && (
                <>
                    <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the approval here" rows={4}
                        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.75rem', background: c.secondaryBg, color: c.primaryText, border: `1px solid ${c.border}`, borderRadius: '8px', padding: '8px' }} />
                    <button type="button" style={button(true)} disabled={!text.trim() || busy} onClick={() => finish(text)}>Log in</button>
                </>
            )}
            {error && <div style={{ color: c.error || '#ff5252', fontSize: '0.85rem' }}>{error}</div>}
            <p style={{ ...step, fontSize: '0.75rem', color: c.mutedText }}>Only approve a code you see here, in your own app. The approval works only together with a key that never leaves this app.</p>
        </div>
    );
}
