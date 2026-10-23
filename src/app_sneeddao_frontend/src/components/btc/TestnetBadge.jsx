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

