// /notifications/inbox: every notification Sneed Notifications sent you (get_my_history), as a
// phone-style list of cards. Tapping one opens /notifications/:id with the full message.
// Which ones you opened is remembered on this device (utils/notificationInbox.js).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaInbox, FaCog, FaCheckDouble, FaSync } from 'react-icons/fa';
import Header from '../components/Header';
import NotificationCard from '../components/NotificationCard';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { notificationsEnabled } from '../utils/NotificationsService';
import { fetchHistory, fetchApps, loadSeen, markSeen, HISTORY_MAX } from '../utils/notificationInbox';
import { useAppRefresh } from '../hooks/useAppRefresh';

const accent = '#f59e0b';
const PAGE = 25;

export default function NotificationInbox() {
    const { theme, isDark } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated, login } = useAuth();
    const principal = identity?.getPrincipal?.().toText?.() || null;
    const [items, setItems] = useState(null); // HistoryItem[] | null while loading
    const [limit, setLimit] = useState(PAGE);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [apps, setApps] = useState(new Map());
    const [filter, setFilter] = useState('all'); // 'all' | 'unread' | app id
    const [seen, setSeen] = useState(new Set());
    const [now, setNow] = useState(Date.now());
    const sentinel = useRef(null);

    useEffect(() => { if (principal) setSeen(loadSeen(principal)); }, [principal]);
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
    useEffect(() => { if (identity && notificationsEnabled) fetchApps(identity).then(setApps).catch(() => {}); }, [identity]);

    const load = useCallback(async () => {
        if (!identity || !notificationsEnabled) return;
        setLoading(true); setError(null);
        try { setItems(await fetchHistory(identity, limit)); } catch (e) { setError(e.message || String(e)); } finally { setLoading(false); }
    }, [identity, limit]);
    useEffect(() => { load(); }, [load]);
    // a tapped notification for this page, or the app coming back to the screen: show new ones
    useAppRefresh(load, { onVisible: true });

    const hasMore = items !== null && items.length >= limit && limit < HISTORY_MAX;
    // infinite scroll: the sentinel under the list asks for the next page when it comes into view
    useEffect(() => {
        const el = sentinel.current;
        if (!el || !hasMore || loading || typeof IntersectionObserver === 'undefined') return undefined;
        const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((l) => Math.min(l + PAGE, HISTORY_MAX)); }, { rootMargin: '300px' });
        io.observe(el);
        return () => io.disconnect();
    }, [hasMore, loading, items]);

    const appChips = useMemo(() => {
        const m = new Map();
        for (const n of items || []) { const k = String(n.app); m.set(k, { id: k, name: n.app_name, count: (m.get(k)?.count || 0) + 1 }); }
        return [...m.values()];
    }, [items]);
    const unreadCount = (items || []).filter((n) => !seen.has(String(n.id))).length;
    const shown = (items || []).filter((n) => (filter === 'all' ? true : filter === 'unread' ? !seen.has(String(n.id)) : String(n.app) === filter));

    const muted = { color: c.mutedText, fontSize: '0.84rem', lineHeight: 1.5 };
    const chip = (on) => ({ padding: '5px 12px', borderRadius: 999, border: `1px solid ${on ? accent : c.border}`, background: on ? `${accent}22` : 'transparent', color: on ? c.primaryText : c.secondaryText, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' });
    const iconBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, border: `1px solid ${c.border}`, background: 'transparent', color: c.secondaryText, fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'none' };
    // a soft "wallpaper" behind the cards, so their translucent surface reads like a phone's
    const wallpaper = { borderRadius: 24, padding: '12px 10px', background: isDark ? 'linear-gradient(160deg, rgba(245,158,11,0.10), rgba(59,130,246,0.08) 55%, rgba(139,92,246,0.10))' : 'linear-gradient(160deg, rgba(245,158,11,0.14), rgba(59,130,246,0.10) 55%, rgba(139,92,246,0.12))' };

    const body = (() => {
        if (!notificationsEnabled) return <p style={muted}>The notification service isn't live on this network yet.</p>;
        if (!isAuthenticated) return (
            <div style={{ ...wallpaper, padding: 20, textAlign: 'center' }}>
                <p style={{ ...muted, marginTop: 0 }}>Log in to see your notifications.</p>
                <button type="button" onClick={login} style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: accent, color: '#111', fontWeight: 700, cursor: 'pointer' }}>Log in</button>
            </div>
        );
        if (items === null) return error ? <p style={{ ...muted, color: c.error }}>{error}</p> : <p style={muted}>Loading…</p>;
        return (
            <>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '2px 0 10px', margin: '0 -2px', WebkitOverflowScrolling: 'touch' }}>
                    <button type="button" style={chip(filter === 'all')} onClick={() => setFilter('all')}>All</button>
                    <button type="button" style={chip(filter === 'unread')} onClick={() => setFilter('unread')}>Unread{unreadCount ? ` · ${unreadCount}` : ''}</button>
                    {appChips.map((a) => <button type="button" key={a.id} style={chip(filter === a.id)} onClick={() => setFilter(a.id)}>{a.name}</button>)}
                </div>
                <div style={wallpaper}>
                    {shown.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
                            <FaInbox size={30} color={c.mutedText} />
                            <p style={{ ...muted, margin: '10px 0 0' }}>{items.length === 0 ? 'No notifications yet. When an app you allowed sends you one, it shows up here.' : filter === 'unread' ? "You're all caught up." : 'Nothing from this app.'}</p>
                            {items.length === 0 && <Link to="/notifications" style={{ ...muted, color: accent }}>Choose which apps may notify you</Link>}
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {shown.map((n) => (
                            <Link key={String(n.id)} to={`/notifications/${n.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                                <NotificationCard n={n} app={apps.get(String(n.app))} unread={!seen.has(String(n.id))} now={now} />
                            </Link>
                        ))}
                    </div>
                    <div ref={sentinel} style={{ height: 1 }} />
                    {hasMore && (
                        <div style={{ textAlign: 'center', marginTop: 10 }}>
                            <button type="button" disabled={loading} onClick={() => setLimit((l) => Math.min(l + PAGE, HISTORY_MAX))} style={iconBtn}>{loading ? 'Loading…' : 'Load more'}</button>
                        </div>
                    )}
                    {!hasMore && items.length > 0 && <p style={{ ...muted, textAlign: 'center', fontSize: '0.74rem', margin: '12px 0 2px' }}>{items.length >= HISTORY_MAX ? `Showing your latest ${HISTORY_MAX}.` : 'That\'s all.'} Notifications are kept for 30 days.</p>}
                </div>
            </>
        );
    })();

    return (
        <>
            <Header />
            <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.25rem 16px 3rem', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                    <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, color: c.primaryText, fontSize: '1.5rem', flex: 1, minWidth: 180 }}><FaInbox color={accent} /> Inbox</h1>
                    {isAuthenticated && items?.length > 0 && unreadCount > 0 && (
                        <button type="button" style={iconBtn} onClick={() => setSeen(markSeen(principal, items.map((n) => n.id)))}><FaCheckDouble /> Mark all read</button>
                    )}
                    {isAuthenticated && <button type="button" style={iconBtn} disabled={loading} onClick={load} aria-label="Refresh"><FaSync /></button>}
                    <Link to="/notifications" style={iconBtn}><FaCog /> Settings</Link>
                </div>
                {body}
            </div>
        </>
    );
}
