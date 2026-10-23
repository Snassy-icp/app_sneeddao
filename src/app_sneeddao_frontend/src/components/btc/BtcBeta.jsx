// Native Bitcoin on prod as a BETA, opt-in per browser (utils/btc/network.js; spec/sneed_wallet.md
// §12, decided 2026-10-23). The "Bitcoin (beta)" switch, the explanation shown with it while it is
// off, and the one-time explanation once it is on. Own file without pockets code, so btc.html can
// use it too. Nothing here derives an address or calls a canister: the switch only writes this
// browser's localStorage and reloads, and the network is decided once per page load.
import React, { useState } from 'react';
import { FaBitcoin } from 'react-icons/fa';
import { useTheme } from '../../contexts/ThemeContext';
import { flipBeta, betaIntroSeen, setBetaIntroSeen } from '../../utils/btc/network';
import { Notice, Advanced, Button } from '../convert/ConvertUi';
import { BetaBadge } from './TestnetBadge';

/// What native Bitcoin is, who holds the key, what it costs, and that it is a beta.
export function BtcBetaExplainer() {
    const { theme } = useTheme();
    const c = theme.colors;
    const li = { marginBottom: 6 };
    return (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', lineHeight: 1.55, color: c.secondaryText }}>
            <li style={li}><b style={{ color: c.primaryText }}>Native Bitcoin</b> is real bitcoin at your own Bitcoin address (bc1…), on the Bitcoin network. <b style={{ color: c.primaryText }}>ckBTC</b> is a token on the Internet Computer backed 1:1 by bitcoin, fast and cheap between IC wallets. Both show on your Bitcoin card.</li>
            <li style={li}>There is no seed phrase. The key for your address is held by the Internet Computer's threshold signing, through DFINITY's Chain Fusion Signer, and only your principal (your Sneed Hub sign-in) can ask it to sign. Whoever can act as your principal, including this site while you are signed in, can move these coins.</li>
            <li style={li}>Receiving is free. Each send costs a Bitcoin network fee (in BTC) plus a little signing credit in cycles for the signer; the review screen shows both before you confirm.</li>
            <li style={li}>It is a beta: moving between Bitcoin and ckBTC, speeding up a stuck send and sweeping come later. Start with small amounts.</li>
            <li>The switch is remembered in this browser only. Turn it on in each browser you use; turning it off hides the Bitcoin address here, and your coins stay at the address.</li>
        </ul>
    );
}

/// The "Bitcoin (beta)" switch. Remembered per browser; the page reloads.
export function BtcBetaSwitch({ on = false }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.8rem', color: c.primaryText, cursor: 'pointer', minWidth: 0 }}>
            <input type="checkbox" role="switch" aria-checked={on} checked={on} onChange={(e) => flipBeta(e.target.checked)} style={{ marginTop: 2 }} />
            <span style={{ minWidth: 0 }}>
                <b>Bitcoin (beta)</b>
                <span style={{ display: 'block', fontSize: '0.72rem', color: c.mutedText }}>In this browser only · the page reloads</span>
            </span>
        </label>
    );
}

/// Shown instead of the Bitcoin row while the switch is off: one line, the switch, and the
/// explanation behind "What is this?" (open on btc.html, where it replaces the send page).
export function BtcBetaOffer({ open = false, style }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <FaBitcoin size={16} color="#f7931a" />
                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: c.primaryText }}>Your own Bitcoin address</span>
                <BetaBadge />
            </div>
            <div style={{ fontSize: '0.75rem', color: c.mutedText, lineHeight: 1.5 }}>
                Receive and send real bitcoin from Sneed Wallet, next to your ckBTC. Off until you turn it on.
            </div>
            <BtcBetaSwitch on={false} />
            {open ? <div style={{ marginTop: 6 }}><BtcBetaExplainer /></div> : <Advanced title="What is this?"><BtcBetaExplainer /></Advanced>}
        </div>
    );
}

/// The explanation once, the first time the beta is on in this browser.
export function BtcBetaIntro({ style }) {
    const [seen, setSeen] = useState(() => betaIntroSeen());
    if (seen) return null;
    return (
        <Notice style={style}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Bitcoin (beta) is on</div>
            <BtcBetaExplainer />
            <div style={{ marginTop: 8 }}>
                <Button variant="ghost" onClick={(e) => { e?.stopPropagation?.(); setBetaIntroSeen(); setSeen(true); }}>Got it</Button>
            </div>
        </Notice>
    );
}
