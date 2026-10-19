// A small card on the front page, on phones only and not inside the installed app: Sneed Hub can
// be added to the home screen (/help/app). Dismissable; remembered in this browser.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaMobileAlt, FaTimes } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { isStandaloneApp } from '../utils/pairing';

const KEY = 'install_app_card_dismissed';

export default function InstallAppCard() {
    const { theme } = useTheme();
    const c = theme.colors;
    const [hidden, setHidden] = useState(() => {
        try { if (localStorage.getItem(KEY)) return true; } catch { /* no storage: show it */ }
        return isStandaloneApp() || window.innerWidth > 768;
    });
    if (hidden) return null;
    const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 16, padding: '12px 14px', marginBottom: '1rem' }}>
            <FaMobileAlt size={22} color="#3498db" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: '0.9rem', color: c.secondaryText, lineHeight: 1.45 }}>
                <strong style={{ color: c.primaryText }}>Sneed Hub as an app.</strong> Add it to your home screen for a full-screen app.{' '}
                <Link to="/help/app" style={{ color: '#3498db', fontWeight: 600, whiteSpace: 'nowrap' }}>How it works →</Link>
            </div>
            <button type="button" onClick={dismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: c.mutedText, cursor: 'pointer', padding: 4, flexShrink: 0 }}><FaTimes /></button>
        </div>
    );
}
