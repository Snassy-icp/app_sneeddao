// Sneed Wallet · Bitcoin (btc.html). The page that can sign native Bitcoin, kept apart from the
// SPA so Google Analytics (index.html) never runs where BTC is signed (spec/sneed_wallet.md §4,
// Q2). Same origin as the app, so the stored Internet Identity session carries over: AuthProvider
// reads the same AuthClient storage (IndexedDB / localStorage of this origin).
//
// Tabs: Send · Signing credit · Activity (hash: #send, #credit, #activity).
import React, { useEffect, useState } from 'react';
import { FaBitcoin, FaArrowLeft } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatAmount } from '../utils/StringUtils';
import { useBtcWallet } from './useBtcWallet';
import BtcSend from '../components/btc/BtcSend';
import SigningCredit from '../components/btc/SigningCredit';
import BtcActivity from '../components/btc/BtcActivity';
import TestnetBadge from '../components/btc/TestnetBadge';
import { Card, Button, Notice } from '../components/convert/ConvertUi';

const TABS = [['send', 'Send'], ['credit', 'Signing credit'], ['activity', 'Activity']];
const readTab = () => { const h = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', ''); return TABS.some(([k]) => k === h) ? h : 'send'; };

function SignIn() {
    const { loginWithII1, loginWithII2, isLoggingIn, authError } = useAuth();
    return (
        <Card>
            <p style={{ marginTop: 0 }}>Sign in to send Bitcoin. You sign in as the same principal as in Sneed Hub, so it is the same Bitcoin address.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button onClick={loginWithII2} disabled={isLoggingIn}>Internet Identity</Button>
                <Button variant="ghost" onClick={loginWithII1} disabled={isLoggingIn}>Internet Identity 1.0</Button>
            </div>
            {authError && <Notice tone="error" style={{ marginTop: 10 }}>{authError}</Notice>}
        </Card>
    );
}

export default function BtcApp() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { isAuthenticated } = useAuth();
    const w = useBtcWallet();
    const [tab, setTabState] = useState(readTab);
    const [need, setNeed] = useState(null);
    useEffect(() => {
        const on = () => setTabState(readTab());
        window.addEventListener('hashchange', on);
        return () => window.removeEventListener('hashchange', on);
    }, []);
    const setTab = (t) => { try { window.history.replaceState(null, '', `#${t}`); } catch { /* ignore */ } setTabState(t); };

    const s = w.btc.data?.summary;
    return (
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px 16px 48px', boxSizing: 'border-box', color: c.primaryText }}>
            <a href="/wallet" style={{ color: c.secondaryText, fontSize: 13, textDecoration: 'none', display: 'inline-flex', gap: 6, alignItems: 'center' }}><FaArrowLeft size={11} /> Back to wallet</a>
            <header style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0', flexWrap: 'wrap' }}>
                <FaBitcoin size={28} color={w.cfg?.testnet ? c.mutedText : '#f7931a'} />
                <h1 style={{ fontSize: 22, margin: 0 }}>Sneed Wallet · Bitcoin</h1>
                {w.cfg?.testnet && <TestnetBadge big />}
            </header>
            {!w.cfg && <Notice tone="warning">Native Bitcoin is not available here ({w.status.reason}).</Notice>}
            {w.cfg && !isAuthenticated && <SignIn />}
            {w.cfg && isAuthenticated && (
                <>
                    <div style={{ fontSize: 14, color: c.secondaryText, marginBottom: 12, overflowWrap: 'anywhere' }}>
                        Balance: <b style={{ color: c.primaryText }}>{s ? `${formatAmount(s.confirmed, 8)} ${w.cfg.symbol}` : '…'}</b>
                        {s && s.locked > 0n && <> · {formatAmount(s.locked, 8)} in pending sends</>}
                        <div style={{ fontSize: 12, color: c.mutedText }}>From <span style={{ fontFamily: 'ui-monospace, monospace' }}>{w.address}</span></div>
                    </div>
                    {w.cfg.testnet && <Notice tone="warning" style={{ marginBottom: 12 }}>Staging preview on Bitcoin <b>testnet4</b>: test coins with no value. Send only to testnet4 addresses.</Notice>}
                    <nav role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                        {TABS.map(([k, label]) => (
                            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                                style={{ padding: '8px 14px', borderRadius: 999, border: `1px solid ${tab === k ? c.accent : c.border}`, background: tab === k ? `${c.accent}22` : 'transparent', color: c.primaryText, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                                {label}
                            </button>
                        ))}
                    </nav>
                    {tab === 'send' && <BtcSend w={w} onGoCredit={(n) => { setNeed(n); setTab('credit'); }} onGoActivity={() => setTab('activity')} />}
                    {tab === 'credit' && <SigningCredit w={w} need={need} />}
                    {tab === 'activity' && <BtcActivity w={w} />}
                </>
            )}
            <footer style={{ marginTop: 24, fontSize: 11, color: c.mutedText, lineHeight: 1.6 }}>
                This page loads no analytics or third-party scripts and refuses to run inside a frame. Every action is public on the Bitcoin and IC chains and tied to your principal.
            </footer>
        </div>
    );
}
