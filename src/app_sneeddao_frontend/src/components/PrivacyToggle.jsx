// Privacy mode controls: the toggle (wallet header, user menu) and PrivacyHost, mounted once in
// App: the Shift+P shortcut and the small "amounts hidden" pill while it is on.
import React, { useEffect } from 'react';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { usePrivacyMode } from '../hooks/usePrivacyMode';
import { isTypingTarget } from '../utils/privacyMode';

export const PRIVACY_SHORTCUT_HINT = 'Shift+P';

/** Eye button. `label` shows text next to it ("Hide amounts" / "Show amounts"). */
export default function PrivacyToggle({ label = false, size = 15, style }) {
    const { theme } = useTheme();
    const [on, toggle] = usePrivacyMode();
    const title = on ? `Show amounts (${PRIVACY_SHORTCUT_HINT})` : `Hide amounts for screen sharing (${PRIVACY_SHORTCUT_HINT})`;
    return (
        <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
            title={title}
            aria-label={title}
            aria-pressed={on}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: on ? `${theme.colors.accent}22` : 'transparent',
                border: `1px solid ${on ? theme.colors.accent : theme.colors.border}`,
                color: on ? theme.colors.accent : theme.colors.secondaryText,
                borderRadius: 8, padding: label ? '5px 10px' : '5px 7px',
                cursor: 'pointer', fontSize: 13, fontWeight: 500, lineHeight: 1,
                ...style,
            }}
        >
            {on ? <FaEyeSlash size={size} /> : <FaEye size={size} />}
            {label && <span>{on ? 'Amounts hidden' : 'Hide amounts'}</span>}
        </button>
    );
}

/** Shortcut plus the on-screen indicator. Render once near the app root. */
export function PrivacyHost() {
    const { theme } = useTheme();
    const [on, toggle] = usePrivacyMode();

    useEffect(() => {
        const onKey = (e) => {
            if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
            if (e.key !== 'P' && e.key !== 'p') return;
            if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
            e.preventDefault();
            toggle();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toggle]);

    if (!on) return null;
    return (
        <button
            type="button"
            onClick={toggle}
            title={`Privacy mode is on: balances and amounts are hidden. Click or press ${PRIVACY_SHORTCUT_HINT} to show them.`}
            style={{
                position: 'fixed', right: 'calc(12px + env(safe-area-inset-right, 0px))', bottom: 'max(20px, calc(env(safe-area-inset-bottom, 0px) + 8px))', zIndex: 9000,
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 11px', borderRadius: 999,
                background: theme.colors.secondaryBg, color: theme.colors.accent,
                border: `1px solid ${theme.colors.accent}`, boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: 0.92,
            }}
        >
            <FaEyeSlash size={12} /> Amounts hidden
        </button>
    );
}
