// The notification inbox (/notifications/inbox, /notifications/:id): what sneed_notifications
// sent you, read back with get_my_history. The canister keeps no read state, so which ones you
// have opened is kept on this device (localStorage, per principal).
import { notificationsActor, levelOf } from './NotificationsService';

export const SYSTEM_APP_ID = 0n; // "Sneed Notifications" itself (verification codes, low balance)
export const HISTORY_MAX = 200; // get_my_history returns at most this many

/// A short hash of a notification's title, so a push link (/notifications/push?t=<created_at>&h=<hash>)
/// finds its notification even when two share a timestamp. Same function in relays/notifications/relay.mjs.
export function titleHash(text) {
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(String(text || ''))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
}

/// Your notifications, newest first (at most HISTORY_MAX).
export const fetchHistory = (identity, limit) => notificationsActor(identity).get_my_history(BigInt(Math.min(limit, HISTORY_MAX)));

// ---- apps: name and logo by id, cached for the session ----
let appsCache = null;
export async function fetchApps(identity) {
    if (!appsCache) {
        appsCache = notificationsActor(identity).list_apps(1n, 200n)
            .then((list) => new Map(list.map((a) => [String(a.id), a])))
            .catch((e) => { appsCache = null; throw e; });
    }
    return appsCache;
}
/// An app's logo, only when it is an https (or inline image) link.
export function safeLogo(app) {
    const logo = app?.logo?.[0];
    return logo && (/^https:\/\//i.test(logo) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(logo)) ? logo : null;
}

// ---- seen on this device ----
const seenKey = (principal) => `sneedNotificationsSeen:${principal}`;
const SEEN_CAP = 1000;
export function loadSeen(principal) {
    try { const v = JSON.parse(localStorage.getItem(seenKey(principal)) || '[]'); return new Set(Array.isArray(v) ? v.map(String) : []); } catch { return new Set(); }
}
export function saveSeen(principal, set) {
    try { localStorage.setItem(seenKey(principal), JSON.stringify([...set].slice(-SEEN_CAP))); } catch { /* private window: nothing kept */ }
}
export function markSeen(principal, ids) {
    const s = loadSeen(principal);
    for (const id of ids) { s.delete(String(id)); s.add(String(id)); } // newest last, for the cap
    saveSeen(principal, s);
    return s;
}

// ---- presentation ----
export const LEVEL_STYLE = {
    urgent: { color: '#ef4444', label: 'Urgent' },
    normal: { color: '#f59e0b', label: 'Normal' },
    info: { color: '#3b82f6', label: 'Info' },
};
export const levelStyle = (level) => LEVEL_STYLE[levelOf(level)] || LEVEL_STYLE.normal;

export const nsToDate = (ns) => new Date(Number(BigInt(ns) / 1_000_000n));

/// "now", "5m", "3h", "2d", then a date, like a phone's notification list.
export function relativeTime(ns, now = Date.now()) {
    const d = nsToDate(ns);
    const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/// Where a notification's own link goes: Sneed Hub links (any network) stay in the app.
export function linkTarget(link) {
    if (!link) return null;
    try {
        const u = new URL(link, window.location.origin);
        if (!/^https?:$/.test(u.protocol)) return null;
        const hub = u.origin === window.location.origin || /^(app\.)?sneeddao\.com$/i.test(u.hostname);
        return hub ? { internal: true, to: `${u.pathname}${u.search}${u.hash}` } : { internal: false, href: u.href };
    } catch { return null; }
}

/// The primary action of a notification: its link, with a friendlier label for system messages.
export function primaryAction(n) {
    if (n.app === SYSTEM_APP_ID && n.topic === 'low_balance') return { label: 'Top up', target: { internal: true, to: '/notifications#message-balance' } };
    const target = linkTarget(n.link?.[0]);
    return target ? { label: 'Open', target } : null;
}

/// A body's text for the card preview: Markdown marks removed (links keep their text).
export const plainPreview = (body) => String(body || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+)/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '');
