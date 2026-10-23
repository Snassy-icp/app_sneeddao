// The opt-in for mainnet developer mode (utils/btc/network.js): shown only to an allowlisted
// principal on a staging build off the prod hosts. Remembered in this browser; the page reloads,
// because the network is decided once per page load.
import React from 'react';
import { MAINNET_DEV_PARAM, setMainnetDevOptIn, urlWithoutNetParam } from '../../utils/btc/network';
import { useTheme } from '../../contexts/ThemeContext';

export default function MainnetDevToggle({ status }) {
    const { theme } = useTheme();
    const c = theme.colors;
    if (!status?.enabled || !status.devAllowed) return null;
    const on = Boolean(status.devMainnet);
    const flip = (v) => {
        setMainnetDevOptIn(v);
        try {
            // a btcnet=… in the URL would override the toggle: drop it, then reload
            const next = urlWithoutNetParam(window.location.href);
            if (next !== window.location.href) window.location.replace(next); else window.location.reload();
        } catch { /* ignore */ }
    };
    return (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.75rem', color: on ? '#d0021b' : c.secondaryText, fontWeight: on ? 700 : 500, cursor: 'pointer' }}>
            <input type="checkbox" checked={on} onChange={(e) => flip(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
                Developer: use Bitcoin mainnet (real BTC)
                {status.devSource === 'param' && <span style={{ fontWeight: 400 }}> · on from the URL ({MAINNET_DEV_PARAM}=mainnet)</span>}
                <span style={{ display: 'block', fontWeight: 400, color: c.mutedText }}>Staging test identity only. Switches address, balance and sends to mainnet; the page reloads.</span>
            </span>
        </label>
    );
}
