// The "TESTNET" badge for native Bitcoin on staging (own file so btc.html doesn't pull in the
// wallet's pockets code).
import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

/// "TESTNET" in the warning colour: on every surface that shows a testnet address or amount.
export default function TestnetBadge({ big = false }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <span title="Bitcoin testnet4: test coins with no value. Not real BTC."
            style={{ fontSize: big ? '0.75rem' : '0.62rem', fontWeight: 800, letterSpacing: 0.6, color: c.warning, border: `1px solid ${c.warning}`, background: `${c.warning}1f`, borderRadius: 999, padding: big ? '2px 9px' : '1px 6px', whiteSpace: 'nowrap' }}>
            TESTNET
        </span>
    );
}


/// "MAINNET · REAL BTC · developer mode" in solid red: on every surface that shows a mainnet
/// address or amount while staging runs in mainnet developer mode (utils/btc/network.js).
export function MainnetDevBadge({ big = false }) {
    const red = '#d0021b';
    return (
        <span title="Staging developer mode: Bitcoin MAINNET. These are real bitcoin."
            style={{ fontSize: big ? '0.75rem' : '0.62rem', fontWeight: 800, letterSpacing: 0.6, color: '#fff', background: red, border: `1px solid ${red}`, borderRadius: 999, padding: big ? '2px 9px' : '1px 6px', whiteSpace: 'nowrap' }}>
            MAINNET · REAL BTC · developer mode
        </span>
    );
}

/// The badge for `cfg`: TESTNET, the red mainnet developer badge, or nothing.
export function BtcNetworkBadge({ cfg, big = false }) {
    if (!cfg) return null;
    if (cfg.devMode) return <MainnetDevBadge big={big} />;
    if (cfg.testnet) return <TestnetBadge big={big} />;
    return null;
}

/// The unmissable red banner for mainnet developer mode (nothing otherwise).
export function MainnetDevBanner({ cfg, style }) {
    if (!cfg?.devMode) return null;
    return (
        <div role="alert" style={{ background: '#d0021b', color: '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.5, boxSizing: 'border-box', minWidth: 0, overflowWrap: 'anywhere', ...style }}>
            <div style={{ fontWeight: 800, letterSpacing: 0.6, fontSize: 14 }}>MAINNET · REAL BTC · developer mode</div>
            This staging page is on Bitcoin <b>mainnet</b>: the address is a real bc1… address and every send moves real bitcoin. Use small amounts only.
        </div>
    );
}
