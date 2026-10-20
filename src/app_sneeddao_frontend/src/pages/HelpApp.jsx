// /help/app: install Sneed Hub as an app on a phone or computer, and log in there (pairing on iPhone).
import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { FaArrowLeft, FaMobileAlt, FaApple, FaAndroid, FaDesktop, FaKey } from 'react-icons/fa';

const appPrimary = '#3498db';

export default function HelpApp() {
    const { theme } = useTheme();
    const c = theme.colors;
    const card = { background: c.cardBg || c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1.25rem', marginBottom: '1rem' };
    const h2 = { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 0.75rem', fontSize: '1.15rem', color: c.primaryText };
    const p = { margin: '0 0 0.6rem', color: c.secondaryText, lineHeight: 1.6 };
    const ol = { margin: 0, paddingLeft: '1.25rem', color: c.secondaryText, lineHeight: 1.7 };
    return (
        <>
            <Header />
            <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <Link to="/help" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: c.accent, textDecoration: 'none', fontSize: '0.9rem', marginBottom: '1.25rem' }}><FaArrowLeft /> Help</Link>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 0.5rem', color: c.primaryText }}><FaMobileAlt color={appPrimary} /> Sneed Hub on your phone</h1>
                <p style={{ ...p, marginBottom: '1.25rem' }}>
                    Sneed Hub can be installed as an app: its own icon on your home screen, full screen, without the browser's bars. It is the same Sneed Hub, always up to date.
                </p>

                <div style={card}>
                    <h2 style={h2}><FaApple /> iPhone and iPad</h2>
                    <ol style={ol}>
                        <li>Open <strong>app.sneeddao.com</strong> in Safari (or Chrome).</li>
                        <li>Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
                        <li>Open Sneed Hub from your home screen and log in as usual. If the login doesn't come back to the app, pair it with Safari (below).</li>
                    </ol>
                </div>

                <div style={card}>
                    <h2 style={h2}><FaKey /> If the login doesn't come back: pair with Safari</h2>
                    <p style={p}>
                        Sometimes an app on the iPhone home screen doesn't receive Internet Identity's login: you log in, and it never comes back to the app. Then approve the app from Safari instead. It takes a minute, once a week (as long as a login lasts).
                    </p>
                    <ol style={ol}>
                        <li>In the app, tap <strong>Log in</strong>, then <strong>Pair it with Safari</strong>. It shows a link and a check code, such as <code>K7Q-2MX</code>.</li>
                        <li>Tap <strong>Copy link</strong> and open the link in Safari. Log in there as usual.</li>
                        <li>Check that Safari shows the <strong>same code</strong>, then tap <strong>Allow</strong> and <strong>Copy approval</strong>.</li>
                        <li>Go back to the app and tap <strong>Paste approval</strong>. You're logged in.</li>
                    </ol>
                    <p style={{ ...p, marginTop: '0.75rem', fontSize: '0.85rem', color: c.mutedText }}>
                        The approval only works together with a key that never leaves your app, so copying it is safe. Only ever approve a code you see in your own app: if someone sends you a pairing link, don't allow it.
                    </p>
                </div>

                <div style={card}>
                    <h2 style={h2}><FaAndroid /> Android</h2>
                    <ol style={ol}>
                        <li>Open <strong>app.sneeddao.com</strong> in Chrome.</li>
                        <li>Tap the menu (⋮), then <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
                        <li>Log in as usual. If the login doesn't come back to the app, tap <strong>Pair it with a browser</strong> in the login window and follow the steps above.</li>
                    </ol>
                </div>

                <div style={card}>
                    <h2 style={h2}><FaDesktop /> Computer</h2>
                    <p style={{ ...p, margin: 0 }}>
                        In Chrome or Edge, click the install icon at the right of the address bar (or the menu, then <strong>Install Sneed Hub</strong>). Sneed Hub opens in its own window.
                    </p>
                </div>
            </div>
        </>
    );
}
