// One notification, drawn like a phone's notification card: a small header line (app icon, app
// name, time), the title in bold and the body. `expanded` is the single-notification page: larger,
// the full body as Markdown (MarkdownBody: no raw HTML, safe links) and room for actions below.
import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import MarkdownBody from './MarkdownBody';
import { SYSTEM_APP_ID, safeLogo, levelStyle, relativeTime, nsToDate, plainPreview } from '../utils/notificationInbox';
import { levelOf } from '../utils/NotificationsService';

const initialColor = (name) => {
    let h = 0;
    for (const ch of String(name || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h}, 55%, 45%)`;
};

/// The app's icon: its registered logo, Sneed Hub's own for system messages, else its initial.
export function AppIcon({ n, app, size = 20 }) {
    const [broken, setBroken] = useState(false);
    const src = n.app === SYSTEM_APP_ID ? '/icon-192.png' : safeLogo(app);
    const radius = Math.round(size * 0.24);
    if (src && !broken) return <img src={src} alt="" width={size} height={size} onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0, display: 'block' }} />;
    return (
        <span aria-hidden="true" style={{ width: size, height: size, borderRadius: radius, background: initialColor(n.app_name), color: '#fff', fontWeight: 700, fontSize: Math.round(size * 0.55), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {(n.app_name || '?').trim().charAt(0).toUpperCase() || '?'}
        </span>
    );
}

export function cardSurface(isDark) {
    return {
        background: isDark ? 'rgba(44, 44, 50, 0.72)' : 'rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(18px) saturate(160%)',
        WebkitBackdropFilter: 'blur(18px) saturate(160%)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
        boxShadow: isDark ? '0 6px 20px rgba(0,0,0,0.35)' : '0 6px 18px rgba(0,0,0,0.08)',
    };
}

export default function NotificationCard({ n, app, unread = false, expanded = false, now, children }) {
    const { theme, isDark } = useTheme();
    const c = theme.colors;
    const lv = levelStyle(n.level);
    const level = levelOf(n.level);
    const clamp = { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
    return (
        <div style={{ ...cardSurface(isDark), position: 'relative', borderRadius: expanded ? 24 : 20, padding: expanded ? '16px 18px 18px' : '11px 14px 12px', overflow: 'hidden' }}>
            {/* the level, as a thin accent along the left edge (urgent also gets a label) */}
            <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: lv.color, opacity: level === 'info' ? 0.55 : 0.9 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: expanded ? 10 : 7, marginBottom: expanded ? 12 : 5 }}>
                <AppIcon n={n} app={app} size={expanded ? 36 : 20} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: expanded ? 'column' : 'row', alignItems: expanded ? 'flex-start' : 'center', gap: expanded ? 1 : 6 }}>
                    <span style={{ fontSize: expanded ? '0.9rem' : '0.72rem', fontWeight: 600, letterSpacing: expanded ? 0 : '0.04em', textTransform: expanded ? 'none' : 'uppercase', color: expanded ? c.primaryText : c.mutedText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                        {n.app_name}
                    </span>
                    {expanded && <span style={{ fontSize: '0.76rem', color: c.mutedText }}>{nsToDate(n.created_at).toLocaleString()}</span>}
                </div>
                {level === 'urgent' && <span style={{ fontSize: '0.64rem', fontWeight: 700, color: lv.color, border: `1px solid ${lv.color}`, borderRadius: 999, padding: '0 6px', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>Urgent</span>}
                {!expanded && <span style={{ fontSize: '0.72rem', color: c.mutedText, flexShrink: 0 }} title={nsToDate(n.created_at).toLocaleString()}>{relativeTime(n.created_at, now)}</span>}
                {unread && <span aria-label="unread" title="Not opened on this device" style={{ width: 9, height: 9, borderRadius: '50%', background: '#0a84ff', flexShrink: 0 }} />}
            </div>
            <div style={{ fontWeight: 700, color: c.primaryText, fontSize: expanded ? '1.15rem' : '0.92rem', lineHeight: 1.3, marginBottom: n.body ? (expanded ? 10 : 2) : 0, overflowWrap: 'anywhere' }}>{n.title}</div>
            {n.body && (expanded
                ? <MarkdownBody text={n.body} style={{ fontSize: '0.98rem', lineHeight: 1.5, overflowWrap: 'anywhere' }} />
                : <div style={{ ...clamp, color: c.secondaryText, fontSize: '0.86rem', lineHeight: 1.35, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{plainPreview(n.body)}</div>)}
            {children}
        </div>
    );
}
