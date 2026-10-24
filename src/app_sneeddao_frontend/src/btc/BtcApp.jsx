// Sneed Wallet · Bitcoin (btc.html). The page that can sign native Bitcoin, kept apart from the
// SPA so Google Analytics (index.html) never runs where BTC is signed (spec/sneed_wallet.md §4,
// Q2). Same origin as the app, so the stored Internet Identity session carries over: AuthProvider
// reads the same AuthClient storage (IndexedDB / localStorage of this origin).
//
// Tabs: Send · Move · Signing credit · Activity (hash: #send, #move or #move-tobtc, #credit,
// #activity; anything after '&' in the hash, like btcnet=mainnet, is ignored here). Move appears
// only where the network has a ck pair (utils/btc/network.js ckMoveFor); its records are watched
// on every tab while the page is open (useMoves).
import React, { useEffect, useState } from 'react';
import { FaBitcoin, FaArrowLeft } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatAmount } from '../utils/StringUtils';
import { useBtcWallet } from './useBtcWallet';
import { useMoves } from './useMoves';
import BtcSend from '../components/btc/BtcSend';
import SigningCredit from '../components/btc/SigningCredit';
import BtcActivity from '../components/btc/BtcActivity';
import BtcMove from '../components/btc/BtcMove';
import { BtcNetworkBadge, MainnetDevBanner } from '../components/btc/TestnetBadge';
import MainnetDevToggle from '../components/btc/MainnetDevToggle';
import { BtcBetaOffer, BtcBetaIntro, BtcBetaSwitch } from '../components/btc/BtcBeta';
import { Card, Button, Notice, Advanced } from '../components/convert/ConvertUi';
import { BALANCE_CYCLES } from '../utils/btc/verify';
import { CYCLES_LEDGER_FEE, formatCycles } from '../utils/btc/credit';

/// "Verify balance" (phase A4): the signer's replicated balance (btc_caller_balance, paid) against
/// the coins the free query showed. Shown on request; costs 0.113B + ledger fees.
function VerifyBalance({ w }) {
    const [busy, setBusy] = useState(false);
    const [res, setRes] = useState(null);
    const cost = BALANCE_CYCLES + 2n * CYCLES_LEDGER_FEE;
    const run = async () => {
        setBusy(true); setRes(null);
        try { setRes(await w.verifyBalance({ pay: true })); } catch (e) { setRes({ ok: false, error: String(e?.message || e) }); } finally { setBusy(false); }
    };
    return (
        <div style={{ marginTop: 4 }}>
            <Button variant="ghost" onClick={run} disabled={busy} title="Asks the Bitcoin canister through the signer with an update call that all replicas agree on">
                {busy ? 'Verifying…' : `Verify balance (${formatCycles(cost)} cycles)`}
            </Button>
            {res?.ok && <Notice tone="success" style={{ marginTop: 6 }}>Verified: the Bitcoin canister's replicated answer is {formatAmount(res.verified, 8)} {w.cfg.symbol}, the same as the coins shown here{res.reread ? ' (after a fresh read)' : ''}. Coins in pending sends are included.</Notice>}
            {res && !res.ok && <Notice tone="error" style={{ marginTop: 6 }}>{res.error}</Notice>}
        </div>
    );
}

const TABS = [['send', 'Send'], ['move', 'Move'], ['credit', 'Signing credit'], ['activity', 'Activity']];
const hashHead = () => (typeof window !== 'undefined' ? window.location.hash : '').replace('#', '').split('&')[0];
const readTab = () => { const h = hashHead(); const t = h.startsWith('move') ? 'move' : h; return TABS.some(([k]) => k === t) ? t : 'send'; };
const readDir = () => (hashHead() === 'move-tobtc' ? 'tobtc' : 'tock');

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
    const mv = useMoves(w);
    const [tab, setTabState] = useState(readTab);
    const [dir, setDirState] = useState(readDir);
    const [need, setNeed] = useState(null);
    useEffect(() => {
        const on = () => { setTabState(readTab()); setDirState(readDir()); };
        window.addEventListener('hashchange', on);
        return () => window.removeEventListener('hashchange', on);
    }, []);
    // keep anything after '&' (btcnet=mainnet for the headless developer-mode browser)
    const writeHash = (head) => { try { const rest = window.location.hash.replace('#', '').split('&').slice(1); window.history.replaceState(null, '', `#${[head, ...rest].join('&')}`); } catch { /* ignore */ } };
    const setTab = (t) => { writeHash(t === 'move' && dir === 'tobtc' ? 'move-tobtc' : t); setTabState(t); };
    const setDir = (d) => { writeHash(d === 'tobtc' ? 'move-tobtc' : 'move'); setDirState(d); };
    const tabs = TABS.filter(([k]) => k !== 'move' || w.ck);

    const s = w.btc.data?.summary;
    return (
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px 16px 48px', boxSizing: 'border-box', color: c.primaryText }}>
            <a href="/wallet" style={{ color: c.secondaryText, fontSize: 13, textDecoration: 'none', display: 'inline-flex', gap: 6, alignItems: 'center' }}><FaArrowLeft size={11} /> Back to wallet</a>
            <header style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0', flexWrap: 'wrap' }}>
                <FaBitcoin size={28} color={w.cfg?.testnet ? c.mutedText : '#f7931a'} />
                <h1 style={{ fontSize: 22, margin: 0 }}>Sneed Wallet · Bitcoin</h1>
                <BtcNetworkBadge cfg={w.cfg} big />
            </header>
            <MainnetDevBanner cfg={w.cfg} style={{ marginBottom: 12 }} />
            {/* prod with Bitcoin (beta) off in this browser: the explanation and the switch, no send page */}
            {!w.cfg && w.surface.offer && <Card><BtcBetaOffer open /></Card>}
            {!w.cfg && !w.surface.offer && <Notice tone="warning">Native Bitcoin is not available here ({w.status.reason}).</Notice>}
            {w.cfg?.beta && <BtcBetaIntro style={{ marginBottom: 12 }} />}
            {w.cfg && !isAuthenticated && <SignIn />}
            {w.cfg && isAuthenticated && (
                <>
                    <div style={{ fontSize: 14, color: c.secondaryText, marginBottom: 12, overflowWrap: 'anywhere' }}>
                        Balance: <b style={{ color: c.primaryText }}>{s ? `${formatAmount(s.confirmed, 8)} ${w.cfg.symbol}` : '…'}</b>
                        {s && s.locked > 0n && <> · {formatAmount(s.locked, 8)} in pending sends</>}
                        <div style={{ fontSize: 12, color: c.mutedText }}>From <span style={{ fontFamily: 'ui-monospace, monospace' }}>{w.address}</span></div>
                        {s && <VerifyBalance w={w} />}
                    </div>
                    {w.cfg.testnet && <Notice tone="warning" style={{ marginBottom: 12 }}>Staging preview on Bitcoin <b>testnet4</b>: test coins with no value. Send only to testnet4 addresses.</Notice>}
                    <nav role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                        {tabs.map(([k, label]) => (
                            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                                style={{ padding: '8px 14px', borderRadius: 999, border: `1px solid ${tab === k ? c.accent : c.border}`, background: tab === k ? `${c.accent}22` : 'transparent', color: c.primaryText, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                                {label}
                            </button>
                        ))}
                    </nav>
                    {tab === 'send' && <BtcSend w={w} onGoCredit={(n) => { setNeed(n); setTab('credit'); }} onGoActivity={() => setTab('activity')} />}
                    {tab === 'credit' && <SigningCredit w={w} need={need} />}
                    {tab === 'move' && w.ck && <BtcMove w={w} mv={mv} dir={dir} onDir={setDir} onGoCredit={(n) => { setNeed(n); setTab('credit'); }} onGoActivity={() => setTab('activity')} />}
                    {tab === 'move' && !w.ck && <Notice>Moves between Bitcoin and ckBTC aren't available on this network.</Notice>}
                    {tab === 'activity' && <BtcActivity w={w} mv={mv} />}
                    {w.surface.betaSwitch && (
                        <div style={{ marginTop: 16 }}>
                            <Advanced title="Advanced: Bitcoin (beta)">
                                <div style={{ fontSize: 12, color: c.mutedText }}>Network: <b style={{ color: c.primaryText }}>{w.cfg.label}</b> · Bitcoin canister {w.cfg.bitcoinCanister}</div>
                                <BtcBetaSwitch on />
                            </Advanced>
                        </div>
                    )}
                    {w.status.devAllowed && (
                        <div style={{ marginTop: 16 }}>
                            <Advanced title="Advanced: network">
                                <div style={{ fontSize: 12, color: c.mutedText }}>Network: <b style={{ color: c.primaryText }}>{w.cfg.label}</b> · Bitcoin canister {w.cfg.bitcoinCanister}</div>
                                <MainnetDevToggle status={w.status} />
                            </Advanced>
                        </div>
                    )}
                </>
            )}
            <footer style={{ marginTop: 24, fontSize: 11, color: c.mutedText, lineHeight: 1.6 }}>
                This page loads no analytics or third-party scripts and refuses to run inside a frame. Every action is public on the Bitcoin and IC chains and tied to your principal.
            </footer>
        </div>
    );
}
