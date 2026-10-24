// A bar across the top of every page once the login has run out (AuthContext watches the
// delegation's expiry), so nobody keeps using a page, or fills in a send, that can only fail.
// It stays until the next login.
import React from 'react';
import { FaSignInAlt } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';

export default function SessionExpiredBanner() {
    const { sessionExpired, isAuthenticated, login } = useAuth();
    const { theme } = useTheme();
    if (!sessionExpired || isAuthenticated) return null;
    const dark = theme?.name !== 'bright';
    const colors = dark
        ? { bg: '#3a1416', border: '#7f1d1d', text: '#fecaca', buttonBg: '#ef4444', buttonText: '#ffffff' }
        : { bg: '#fdecea', border: '#f5c2c7', text: '#842029', buttonBg: '#dc3545', buttonText: '#ffffff' };
    return (
        <div role="alert" style={{
            background: colors.bg, color: colors.text, borderBottom: `1px solid ${colors.border}`,
            fontSize: '14px', lineHeight: 1.45, padding: '8px 16px', textAlign: 'center', fontWeight: 600,
            position: 'relative', zIndex: 1001, display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            justifyContent: 'center', gap: '8px 12px',
        }}>
            <span>Your session expired. Log in again to see your data and to send, vote or post.</span>
            <button type="button" onClick={login} style={{
                background: colors.buttonBg, color: colors.buttonText, border: 'none', borderRadius: '6px',
                padding: '5px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '6px',
            }}>
                <FaSignInAlt size={12} /> Log in
            </button>
        </div>
    );
}
