// Entry of btc.html, the page that signs native Bitcoin (spec/sneed_wallet.md §4, §9.1).
// Separate from the SPA (index.html) so no analytics script ever runs here; served with its own
// strict headers (public/.ic-assets.json5: no googletagmanager, frame-ancestors 'none').
// Refuses to run inside a frame (clickjacking) and when the native-Bitcoin flag is off.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from '../AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { DenominationProvider } from '../contexts/DenominationContext';
import BtcApp from './BtcApp';

const root = document.getElementById('root');
let framed = true;
try { framed = window.top !== window.self; } catch { framed = true; }

if (framed) {
    root.textContent = 'This page cannot run inside a frame. Open it directly at its own address.';
} else {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <ThemeProvider>
                <AuthProvider>
                    <DenominationProvider>
                        <BtcApp />
                    </DenominationProvider>
                </AuthProvider>
            </ThemeProvider>
        </React.StrictMode>,
    );
}
