// /notifications/:id: one notification, as its card enlarged with the full message (Markdown),
// its link as the main button, and where it was delivered. Tapping a push lands here: the relay
// links /notifications/push?t=<created_at>&h=<title hash> (a relay job carries no notification
// id), which this page resolves against your history and replaces with /notifications/<id>.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { FaArrowLeft, FaExternalLinkAlt, FaInbox, FaCheckCircle } from 'react-icons/fa';
import Header from '../components/Header';
import NotificationCard from '../components/NotificationCard';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { notificationsEnabled, notificationsActor, kindOf, CHANNEL_KINDS } from '../utils/NotificationsService';
import { fetchHistory, fetchApps, markSeen, titleHash, primaryAction, levelStyle, nsToDate, HISTORY_MAX, SYSTEM_APP_ID } from '../utils/notificationInbox';

const accent = '#f59e0b';
const kindLabel = (k) => ({ push: 'Phone push', sneed_sms: 'Sneed SMS' })[k] || CHANNEL_KINDS.find((x) => x.key === k)?.label || k;
const SYSTEM_TOPICS = { verify: 'Channel verification', low_balance: 'Low message balance' };

export default function NotificationView() {
    const { theme, isDark } = useTheme();
    const c = theme.colors;
    const { id } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const { identity, isAuthenticated, login } = useAuth();
    const principal = identity?.getPrincipal?.().toText?.() || null;
    const [n, setN] = useState(undefined); // undefined: loading, null: not found
    const [error, setError] = useState(null);
    const [app, setApp] = useState(null);
    const [channels, setChannels] = useState([]);

    const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const fromPush = id === 'push';

    useEffect(() => {
        if (!identity || !notificationsEnabled) return;
        let stop = false;
        setN(undefined); setError(null);
        (async () => {
            let match;
            if (fromPush) {
                const t = query.get('t');
                const h = query.get('h');
                if (!/^\d+$/.test(t || '')) { if (!stop) setN(null); return; }
                match = (x) => String(x.created_at) === t && (!h || titleHash(x.title) === h);
            } else {
                if (!/^\d+$/.test(id || '')) { if (!stop) setN(null); return; }
                match = (x) => String(x.id) === id;
            }
            // the canister has no lookup by id: the recent ones first, then everything it keeps
            let hit = (await fetchHistory(identity, 50)).find(match);
            if (!hit) hit = (await fetchHistory(identity, HISTORY_MAX)).find(match);
            if (stop) return;
            if (hit && fromPush) { navigate(`/notifications/${hit.id}`, { replace: true }); return; }
            setN(hit || null);
        })().catch((e) => { if (!stop) setError(e.message || String(e)); });
        return () => { stop = true; };
    }, [identity, id, fromPush, query, navigate]);

    useEffect(() => { if (n && principal) markSeen(principal, [n.id]); }, [n, principal]);
    useEffect(() => {
        if (!n || !identity) return;
        if (n.app !== SYSTEM_APP_ID) fetchApps(identity).then((m) => setApp(m.get(String(n.app)) || null)).catch(() => {});
        if (n.deliveries.length) notificationsActor(identity).get_my_settings().then((s) => setChannels(s.channels)).catch(() => {});
    }, [n, identity]);

    const muted = { color: c.mutedText, fontSize: '0.84rem', lineHeight: 1.5 };
    const wallpaper = { borderRadius: 28, padding: '14px 10px', background: isDark ? 'linear-gradient(160deg, rgba(245,158,11,0.10), rgba(59,130,246,0.08) 55%, rgba(139,92,246,0.10))' : 'linear-gradient(160deg, rgba(245,158,11,0.14), rgba(59,130,246,0.10) 55%, rgba(139,92,246,0.12))' };
    const primaryBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 18px', borderRadius: 14, border: 'none', background: accent, color: '#111', fontWeight: 700, fontSize: '0.95rem', textDecoration: 'none', cursor: 'pointer', flex: '1 1 160px' };
    const ghostBtn = { ...primaryBtn, background: 'transparent', color: c.primaryText, border: `1px solid ${c.border}`, fontWeight: 600 };
    const row = { display: 'flex', gap: 12, padding: '8px 0', borderTop: `1px solid ${c.border}`, fontSize: '0.86rem' };
    const key = { color: c.mutedText, width: 92, flexShrink: 0 };
    const val = { color: c.primaryText, minWidth: 0, overflowWrap: 'anywhere' };

    const content = (() => {
        if (!notificationsEnabled) return <p style={muted}>The notification service isn't live on this network yet.</p>;
        if (!isAuthenticated) return (
            <div style={{ ...wallpaper, padding: 20, textAlign: 'center' }}>
                <p style={{ ...muted, marginTop: 0 }}>Log in to read this notification. You'll come right back here.</p>
                <button type="button" onClick={login} style={{ ...primaryBtn, flex: 'none' }}>Log in</button>
            </div>
        );
        if (error) return <p style={{ ...muted, color: c.error }}>{error}</p>;
        if (n === undefined) return <p style={muted}>Loading…</p>;
        if (n === null) return (
            <div style={{ ...wallpaper, padding: '2rem 1rem', textAlign: 'center' }}>
                <FaInbox size={28} color={c.mutedText} />
                <p style={{ ...muted, margin: '10px 0' }}>This notification wasn't found for the account you're logged in with. Notifications are kept for 30 days; it may also have been sent to another of your accounts.</p>
                <Link to="/notifications/inbox" style={{ color: accent }}>Open the inbox</Link>
            </div>
        );
        const action = primaryAction(n);
        const lv = levelStyle(n.level);
        const topic = n.app === SYSTEM_APP_ID ? SYSTEM_TOPICS[n.topic] : app?.topics?.find((t) => t.id === n.topic)?.title;
        const chName = (d) => channels.find((ch) => ch.id === d.channel)?.name;
        return (
            <>
                <div style={wallpaper}>
                    <NotificationCard n={n} app={app} expanded>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                            {action && (action.target.internal
                                ? <Link to={action.target.to} style={primaryBtn}>{action.label}</Link>
                                : <a href={action.target.href} target="_blank" rel="noopener noreferrer" style={primaryBtn}>{action.label} <FaExternalLinkAlt size={12} /></a>)}
                            <Link to="/notifications/inbox" style={ghostBtn}><FaInbox /> All notifications</Link>
                        </div>
                    </NotificationCard>
                </div>
                <div style={{ marginTop: 16, padding: '4px 4px 0' }}>
                    <div style={{ ...row, borderTop: 'none' }}><span style={key}>App</span><span style={val}>{n.app_name}{app?.verified && <FaCheckCircle size={11} color="#10b981" title="Verified by Sneed DAO" style={{ marginLeft: 5, verticalAlign: '-1px' }} />}</span></div>
                    <div style={row}><span style={key}>Topic</span><span style={val}>{topic ? `${topic} ` : ''}<span style={{ color: c.mutedText }}>({n.topic})</span></span></div>
                    <div style={row}><span style={key}>Level</span><span style={{ ...val, color: lv.color, fontWeight: 600 }}>{lv.label}</span></div>
                    <div style={row}><span style={key}>Sent</span><span style={val}>{nsToDate(n.created_at).toLocaleString()}</span></div>
                    <div style={row}>
                        <span style={key}>Delivered</span>
                        <span style={{ ...val, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {n.deliveries.length === 0 && <span style={{ color: c.mutedText }}>Only kept here (muted, or no channel for this level)</span>}
                            {n.deliveries.map((d, i) => {
                                const s = Object.keys(d.state)[0];
                                const color = s === 'delivered' ? '#10b981' : s === 'failed' ? (c.error || '#ef4444') : s === 'suppressed' ? c.mutedText : accent;
                                const reason = d.state[s]?.reason;
                                const name = chName(d);
                                return (
                                    <span key={i}>
                                        {kindLabel(kindOf(d.kind))}{name && name !== kindLabel(kindOf(d.kind)) ? ` (${name})` : ''} · <span style={{ color, fontWeight: 600 }}>{s}</span>
                                        {reason && <span style={{ color: c.mutedText }}>: {reason}</span>}
                                    </span>
                                );
                            })}
                        </span>
                    </div>
                </div>
            </>
        );
    })();

    return (
        <>
            <Header />
            <div style={{ maxWidth: 640, margin: '0 auto', padding: '1rem 16px 3rem', boxSizing: 'border-box' }}>
                <Link to="/notifications/inbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: c.secondaryText, textDecoration: 'none', fontSize: '0.88rem', marginBottom: 12 }}><FaArrowLeft size={12} /> Inbox</Link>
                {content}
            </div>
        </>
    );
}
