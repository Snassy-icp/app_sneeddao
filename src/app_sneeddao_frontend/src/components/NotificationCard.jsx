// One notification, drawn like a phone's notification card: a small header line (app icon, app
// name, time), the title in bold and the body. `expanded` is the single-notification page: larger,
// the full body as Markdown (MarkdownBody: no raw HTML, safe links) and room for actions below.
import React, { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useSmsInbox } from '../contexts/SmsContext';
import MarkdownBody from './MarkdownBody';
import BigAvatar from './BigAvatar';
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

/// The Sneed SMS message a notification is about (its link is …/msg/<id>), or null.
export function smsMessageIdOf(n) {
    const link = n?.link?.[0] || '';
    const m = /\/msg\/(\d+)(?:[/?#]|$)/.exec(link);
    return m && (n.topic === 'direct_message' || /sms/i.test(n.app_name || '')) ? m[1] : null;
}

/// Who a notification is from, when that is a person we can know: the sender of a Sneed SMS
/// message, found in the shared inbox cache (no extra call), or with `fetch` (the single
/// notification page) asked of Sneed SMS once. Tips are anonymous in the notification, so they
/// keep the app's logo. Returns { isPerson, sender }: isPerson reserves the avatar's space at once.
export function useNotificationSender(n, { fetch = false } = {}) {
    const sms = useSmsInbox();
    const msgId = smsMessageIdOf(n);
    const cached = msgId ? (sms?.received?.items || []).find((m) => m.id.toString() === msgId) : null;
    const [fetched, setFetched] = useState(null);
    useEffect(() => {
        setFetched(null);
        if (!fetch || !msgId || cached) return undefined;
        const actor = sms?.getActor?.();
        if (!actor?.get_message) return undefined;
        let stop = false;
        actor.get_message(BigInt(msgId)).then((r) => { if (!stop && r?.[0]) setFetched(r[0]); }).catch(() => {});
        return () => { stop = true; };
    }, [fetch, msgId, Boolean(cached)]); // eslint-disable-line react-hooks/exhaustive-deps
    const msg = cached || fetched;
    return { isPerson: Boolean(msgId), sender: msg?.sender || null };
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
    const { isPerson, sender } = useNotificationSender(n, { fetch: expanded });
    const side = isPerson || !expanded;
    const c = theme.colors;
    const lv = levelStyle(n.level);
    const level = levelOf(n.level);
    const clamp = { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
    return (
        <div style={{ ...cardSurface(isDark), position: 'relative', borderRadius: expanded ? 24 : 20, padding: expanded ? '16px 18px 18px' : '11px 14px 12px', overflow: 'hidden' }}>
            {/* the level, as a thin accent along the left edge (urgent also gets a label) */}
            <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: lv.color, opacity: level === 'info' ? 0.55 : 0.9 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: expanded ? 10 : 7, marginBottom: expanded ? 12 : 5 }}>
                {(expanded || isPerson) && <AppIcon n={n} app={app} size={expanded ? 36 : 20} />}
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
            {/* a big picture beside the text: a person's face for a message from them (the space is
                kept while it loads), else the app's logo (on the list; the open card has it above) */}
            <div style={side ? { display: 'flex', gap: expanded ? 14 : 10, alignItems: 'flex-start' } : undefined}>
            {isPerson
                ? <BigAvatar principal={sender} url={sender ? undefined : null} size={expanded ? 56 : 40} verified="auto" cutout={isDark ? '#2c2c32' : '#ffffff'} style={{ marginTop: 2 }} />
                : side && <span style={{ marginTop: 2, flexShrink: 0 }}><AppIcon n={n} app={app} size={40} /></span>}
            <div style={side ? { flex: 1, minWidth: 0 } : undefined}>
            <div style={{ fontWeight: 700, color: c.primaryText, fontSize: expanded ? '1.15rem' : '0.92rem', lineHeight: 1.3, marginBottom: n.body ? (expanded ? 10 : 2) : 0, overflowWrap: 'anywhere' }}>{n.title}</div>
            {n.body && (expanded
                ? <MarkdownBody text={n.body} style={{ fontSize: '0.98rem', lineHeight: 1.5, overflowWrap: 'anywhere' }} />
                : <div style={{ ...clamp, color: c.secondaryText, fontSize: '0.86rem', lineHeight: 1.35, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{plainPreview(n.body)}</div>)}
            </div>
            </div>
            {children}
        </div>
    );
}
