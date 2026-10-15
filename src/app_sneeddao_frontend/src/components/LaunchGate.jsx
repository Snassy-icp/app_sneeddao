// "Coming soon" for features that are built but not launched: site admins (the backend's
// caller_is_admin) see the real thing under a preview banner, everyone else a coming-soon panel.
// ComingSoonRibbon marks the cards that lead there.
import React, { useEffect, useState } from 'react';
import { FaHourglassHalf } from 'react-icons/fa';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from './Header';

const cache = new Map(); // principal text -> Promise<boolean>

/** null while checking, then whether the logged-in user is a site admin. Never redirects. */
export function useSiteAdmin() {
    const { identity, isAuthenticated } = useAuth();
    const [admin, setAdmin] = useState(isAuthenticated ? null : false);
    const key = isAuthenticated ? identity?.getPrincipal?.().toText?.() : null;
    useEffect(() => {
        if (!key) { setAdmin(false); return undefined; }
        let alive = true;
        if (!cache.has(key)) {
            cache.set(key, createBackendActor(backendCanisterId, { agentOptions: { identity } }).caller_is_admin().catch(() => false));
        }
        cache.get(key).then((v) => { if (alive) setAdmin(!!v); });
        return () => { alive = false; };
    }, [key, identity]);
    return admin;
}

export function ComingSoonGate({ title, children, note }) {
    const { theme } = useTheme();
    const admin = useSiteAdmin();
    if (admin === null) return <div style={{ color: theme.colors.mutedText, padding: '1rem 0' }}>Loading…</div>;
    if (admin) {
        return (
            <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12, borderRadius: 10, border: '1px solid #f59e0b55', background: '#f59e0b14', color: '#f59e0b', fontSize: '0.82rem', fontWeight: 600 }}>
                    <FaHourglassHalf size={12} /> Admin preview: {title} shows "coming soon" to everyone else.
                </div>
                {children}
            </>
        );
    }
    return (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', border: `1px solid ${theme.colors.border}`, borderRadius: 14, background: theme.colors.cardGradient || theme.colors.secondaryBg }}>
            <FaHourglassHalf size={34} color="#f59e0b" />
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: theme.colors.primaryText, marginTop: 12 }}>{title}: coming soon</div>
            <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginTop: 8, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
                {note || 'This is built and being tested. It opens once everything it relies on is live.'}
            </div>
        </div>
    );
}

/** A diagonal "Coming soon" ribbon in the top-right corner of a card (the card needs position: relative and overflow: hidden). */
export function ComingSoonRibbon() {
    return (
        <div aria-label="Coming soon" style={{
            position: 'absolute', top: 18, right: -38, transform: 'rotate(45deg)', width: 150, textAlign: 'center',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', fontSize: 11, fontWeight: 800,
            letterSpacing: '0.5px', textTransform: 'uppercase', padding: '4px 0', boxShadow: '0 2px 6px rgba(0,0,0,0.3)', pointerEvents: 'none', zIndex: 1,
        }}>Coming soon</div>
    );
}

/** A whole page behind "coming soon": admins get the page, everyone else the header and the panel. */
export function ComingSoonPage({ title, children, note }) {
    const admin = useSiteAdmin();
    if (admin) return children;
    return (
        <>
            <Header />
            <main style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 16px 3rem' }}>
                {admin === null ? null : <ComingSoonGate title={title} note={note}>{null}</ComingSoonGate>}
            </main>
        </>
    );
}
