// /notifications: the notification centre (sneed_notifications, spec/sneed_notifications.md).
// Which apps may notify you, how each level reaches you, quiet hours, channels, your balance for
// paid channels, and what you were sent; and Sneed Monitor (components/SneedMonitorSection.jsx).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaBell, FaCheckCircle, FaChevronDown, FaChevronRight, FaMoon, FaWallet, FaHistory, FaPlug, FaInbox } from 'react-icons/fa';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { notificationsEnabled, notificationsActor, LEVELS, CHANNEL_KINDS, kindOf, levelOf, topUp, formatIcp, relayKeys, addDiscordChannel, addPushChannel, pushSupported } from '../utils/NotificationsService';
import { isStandaloneApp, isIOS } from '../utils/pairing';
import { createActor as createSmsActor, canisterId as smsCanisterId } from 'declarations/sneed_sms';
import SneedMonitorSection from '../components/SneedMonitorSection';

const accent = '#f59e0b';
const opt = (x) => (x && x.length ? x[0] : null);
const toHHMM = (min) => `${String(Math.floor(Number(min) / 60)).padStart(2, '0')}:${String(Number(min) % 60).padStart(2, '0')}`;
const fromHHMM = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return BigInt((h || 0) * 60 + (m || 0)); };
const kindLabel = (k) => CHANNEL_KINDS.find((c) => c.key === k)?.label || k;

export default function Notifications() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated, login } = useAuth();
    const [data, setData] = useState(null); // { settings, channels, balance_e8s }
    const [apps, setApps] = useState([]); // [[App, Permission]]
    const [requests, setRequests] = useState([]);
    const [allApps, setAllApps] = useState([]);
    const [history, setHistory] = useState([]);
    const [draft, setDraft] = useState(null); // edited Settings
    const [open, setOpen] = useState(null); // app id expanded
    const [msg, setMsg] = useState(null); // { ok|err, text }
    const [busy, setBusy] = useState(false);
    const [amount, setAmount] = useState('0.01');
    const [live, setLive] = useState({}); // channel kinds with a relay running: { discord: true, push: true }
    const [discordId, setDiscordId] = useState('');
    const [codes, setCodes] = useState({}); // channel id -> code typed
    const [lowAlert, setLowAlert] = useState(''); // ICP, '' until loaded
    const [smsPreview, setSmsPreview] = useState(null); // Sneed SMS: start of messages in notifications (null: unknown)
    const smsActor = useMemo(() => (identity && smsCanisterId ? createSmsActor(smsCanisterId, { agentOptions: { identity, host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943' } }) : null), [identity]);

    const actor = useMemo(() => (identity && notificationsEnabled ? notificationsActor(identity) : null), [identity]);
    const load = useCallback(async () => {
        if (!actor) return;
        const [s, a, r, h, all] = await Promise.all([actor.get_my_settings(), actor.get_my_apps(), actor.get_my_requests(), actor.get_my_history(30n), actor.list_apps(1n, 100n)]);
        setData(s); setApps(a); setRequests(r); setHistory(h); setDraft(s.settings); setAllApps(all);
        const kinds = {};
        for (const k of ['discord', 'push']) kinds[k] = !!(await relayKeys(identity, k).catch(() => null));
        setLive(kinds);
        const la = await actor.get_low_balance_alert().catch(() => null); // an older canister has no alert
        if (la) setLowAlert(String(Number(la.threshold_e8s) / 1e8));
        if (smsActor) setSmsPreview(await smsActor.get_notification_preview().catch(() => null)); // an older SMS canister has no setting
    }, [actor, identity, smsActor]);
    useEffect(() => { load().catch((e) => setMsg({ err: e.message || String(e) })); }, [load]);
    // a code from a tapped notification (/notifications?code=123456) fills the channels waiting for one
    const codeFromLink = useMemo(() => { const c = new URLSearchParams(window.location.search).get('code'); return /^\d{6}$/.test(c || '') ? c : null; }, []);
    useEffect(() => {
        if (!codeFromLink || !data) return;
        const waiting = data.channels.filter((c) => 'unverified' in c.state);
        if (waiting.length) setCodes((cs) => Object.fromEntries([...Object.entries(cs), ...waiting.map((c) => [String(c.id), codeFromLink])]));
    }, [codeFromLink, data]);

    const run = async (f, okText) => {
        setBusy(true); setMsg(null);
        try {
            const r = await f();
            if (r && 'err' in r) setMsg({ err: r.err }); else { if (okText) setMsg({ ok: okText }); await load(); }
        } catch (e) { setMsg({ err: e.message || String(e) }); } finally { setBusy(false); }
    };

    const card = { background: c.cardBg || c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1rem 1.1rem', marginBottom: '1rem' };
    const h2 = { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 0.75rem', fontSize: '1.05rem', color: c.primaryText };
    const muted = { color: c.mutedText, fontSize: '0.82rem', lineHeight: 1.5 };
    const btn = (primary) => ({ padding: '7px 12px', borderRadius: 8, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? accent : 'transparent', color: primary ? '#111' : c.primaryText, fontWeight: 600, fontSize: '0.85rem', cursor: busy ? 'wait' : 'pointer' });
    const select = { background: c.secondaryBg, color: c.primaryText, border: `1px solid ${c.border}`, borderRadius: 8, padding: '6px 8px', fontSize: '0.85rem' };

    const page = (body) => (
        <>
            <Header />
            <div style={{ maxWidth: 820, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 0.4rem', color: c.primaryText, fontSize: '1.6rem' }}><FaBell color={accent} /> Notifications</h1>
                <p style={{ ...muted, margin: '0 0 1.25rem', fontSize: '0.9rem' }}>Decide which apps may notify you, about what, and where. Nothing reaches you from an app you haven't allowed.</p>
                {body}
            </div>
        </>
    );

    if (!notificationsEnabled) return page(<div style={card}><p style={muted}>The notification service isn't live on this network yet. It's coming soon.</p></div>);
    if (!isAuthenticated) return page(<div style={card}><p style={muted}>Log in to manage your notifications.</p><button type="button" style={btn(true)} onClick={login}>Log in</button></div>);
    if (!data || !draft) return page(<div style={card}><p style={muted}>Loading…</p></div>);

    const channels = data.channels;
    const verified = channels.filter((ch) => 'verified' in ch.state);
    const quiet = opt(draft.quiet);
    const snooze = opt(draft.snooze_until);
    const snoozed = snooze && Number(snooze / 1_000_000n) > Date.now();
    const setLevelChannel = (level, id, on) => {
        const cur = draft.defaults[level];
        const next = on ? [...cur, id] : cur.filter((x) => x !== id);
        setDraft({ ...draft, defaults: { ...draft.defaults, [level]: next } });
    };
    const saveSettings = (s = draft, okText = 'Saved') => run(() => actor.set_settings(s), okText);
    const setPermission = (app, p) => run(() => actor.set_permission(app.id, p), 'Saved');
    const topicRuleOf = (p, id) => { const r = p.topics.find(([t]) => t === id); return r ? r[1] : null; };
    const ruleValue = (r) => (!r ? 'default' : 'mute' in r ? 'mute' : 'level' in r ? levelOf(r.level) : 'default');
    const withTopicRule = (p, id, v) => {
        const rest = p.topics.filter(([t]) => t !== id);
        if (v === 'default') return { ...p, topics: rest };
        return { ...p, topics: [...rest, [id, v === 'mute' ? { mute: null } : { level: { [v]: null } }]] };
    };

    return page(
        <>
            {/* the outcome of the last action, pinned to the bottom of the screen so it shows wherever the button was */}
            {msg && <div role="status" onClick={() => setMsg(null)} style={{ position: 'fixed', left: 16, right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom))', maxWidth: 560, margin: '0 auto', zIndex: 1002, padding: '12px 16px', borderRadius: 12, background: c.primaryBg, border: `1px solid ${msg.err ? (c.error || '#ef4444') : '#10b981'}`, color: msg.err ? (c.error || '#ef4444') : '#10b981', fontSize: '0.88rem', boxShadow: '0 10px 30px rgba(0,0,0,0.35)', cursor: 'pointer' }}>{msg.err || msg.ok} <span style={{ color: c.mutedText, fontSize: '0.75rem' }}>(tap to close)</span></div>}

            {requests.length > 0 && (
                <div style={{ ...card, borderColor: accent }}>
                    <h2 style={h2}><FaPlug color={accent} /> Apps asking to notify you</h2>
                    {requests.map((a) => (
                        <div key={String(a.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 0', borderTop: `1px solid ${c.border}` }}>
                            <div style={{ flex: 1, minWidth: 200 }}>
                                <div style={{ color: c.primaryText, fontWeight: 600 }}>{a.name} {a.verified && <FaCheckCircle color="#3b82f6" size={12} title="Verified app" />}</div>
                                <div style={muted}>{a.description || 'No description'} · topics: {a.topics.map((t) => t.title).join(', ')}</div>
                            </div>
                            <button type="button" style={btn(true)} disabled={busy} onClick={() => run(() => actor.allow_app(a.id, true), `${a.name} may now notify you`)}>Allow</button>
                            <button type="button" style={btn(false)} disabled={busy} onClick={() => run(() => actor.allow_app(a.id, false), `${a.name} is blocked`)}>Block</button>
                        </div>
                    ))}
                </div>
            )}

            {/* Sneed Monitor: proposals to vote on (renders nothing where sneed_mon has no canister id) */}
            <SneedMonitorSection notifActor={actor} myApps={apps} onNotificationsChanged={() => load().catch(() => {})} setMsg={setMsg} />

            <div style={card}>
                <h2 style={h2}><FaInbox color={accent} /> How you're notified</h2>
                <p style={{ ...muted, marginTop: 0 }}>Every app marks each kind of message with a level. Choose where each level goes. Everything is also copied to one channel, so nothing exists only as a banner.</p>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem', color: c.secondaryText }}>
                        <thead><tr><th style={{ textAlign: 'left', padding: 6 }}>Level</th>{verified.map((ch) => <th key={String(ch.id)} style={{ padding: 6 }}>{ch.name}</th>)}</tr></thead>
                        <tbody>
                            {LEVELS.map((l) => (
                                <tr key={l.key} style={{ borderTop: `1px solid ${c.border}` }}>
                                    <td style={{ padding: 6 }}><strong style={{ color: c.primaryText }}>{l.label}</strong><div style={{ ...muted, fontSize: '0.75rem' }}>{l.hint}</div></td>
                                    {verified.map((ch) => (
                                        <td key={String(ch.id)} style={{ textAlign: 'center', padding: 6 }}>
                                            <input type="checkbox" checked={draft.defaults[l.key].includes(ch.id)} onChange={(e) => setLevelChannel(l.key, ch.id, e.target.checked)} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <span style={{ color: c.secondaryText, fontSize: '0.88rem' }}>Always copy to</span>
                    <select style={select} value={opt(draft.always_copy) != null ? String(opt(draft.always_copy)) : ''} onChange={(e) => setDraft({ ...draft, always_copy: e.target.value === '' ? [] : [BigInt(e.target.value)] })}>
                        {verified.map((ch) => <option key={String(ch.id)} value={String(ch.id)}>{ch.name}</option>)}
                        <option value="">Nothing</option>
                    </select>
                </div>

                <h3 style={{ ...h2, fontSize: '0.95rem', margin: '1.1rem 0 0.5rem' }}><FaMoon color={accent} /> Quiet hours</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.88rem', color: c.secondaryText }}>
                    <label><input type="checkbox" checked={!!quiet} onChange={(e) => setDraft({ ...draft, quiet: e.target.checked ? [{ start_min: 22n * 60n, end_min: 7n * 60n, utc_offset_min: BigInt(-new Date().getTimezoneOffset()), urgent_passes: true }] : [] })} /> Hold messages</label>
                    {quiet && (
                        <>
                            <span>from</span><input type="time" style={select} value={toHHMM(quiet.start_min)} onChange={(e) => setDraft({ ...draft, quiet: [{ ...quiet, start_min: fromHHMM(e.target.value), utc_offset_min: BigInt(-new Date().getTimezoneOffset()) }] })} />
                            <span>to</span><input type="time" style={select} value={toHHMM(quiet.end_min)} onChange={(e) => setDraft({ ...draft, quiet: [{ ...quiet, end_min: fromHHMM(e.target.value), utc_offset_min: BigInt(-new Date().getTimezoneOffset()) }] })} />
                            <label><input type="checkbox" checked={quiet.urgent_passes} onChange={(e) => setDraft({ ...draft, quiet: [{ ...quiet, urgent_passes: e.target.checked }] })} /> Urgent gets through</label>
                        </>
                    )}
                </div>
                <p style={{ ...muted, margin: '6px 0 0' }}>Your time zone is taken from this device. Sneed SMS copies arrive anyway; phone and chat channels wait until morning.</p>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
                    <button type="button" style={btn(true)} disabled={busy} onClick={() => saveSettings()}>Save</button>
                    <span style={{ ...muted, marginLeft: 8 }}>{snoozed ? `Paused until ${new Date(Number(snooze / 1_000_000n)).toLocaleString()}` : 'Pause everything:'}</span>
                    {snoozed
                        ? <button type="button" style={btn(false)} disabled={busy} onClick={() => saveSettings({ ...draft, snooze_until: [] }, 'Resumed')}>Resume</button>
                        : [['1 hour', 3600], ['1 day', 86400]].map(([label, s]) => (
                            <button key={label} type="button" style={btn(false)} disabled={busy} onClick={() => saveSettings({ ...draft, snooze_until: [BigInt(Date.now() + s * 1000) * 1_000_000n] }, `Paused for ${label}`)}>{label}</button>
                        ))}
                </div>
            </div>

            <div style={card}>
                <h2 style={h2}><FaPlug color={accent} /> Apps</h2>
                {apps.length === 0 && <p style={muted}>No apps yet. Allow one below, or wait until an app asks you.</p>}
                {apps.map(([a, p]) => (
                    <div key={String(a.id)} style={{ borderTop: `1px solid ${c.border}`, padding: '8px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} style={{ background: 'none', border: 'none', color: c.primaryText, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0, fontWeight: 600, flex: 1, minWidth: 180, textAlign: 'left' }}>
                                {open === a.id ? <FaChevronDown size={11} /> : <FaChevronRight size={11} />} {a.name} {a.verified && <FaCheckCircle color="#3b82f6" size={12} title="Verified app" />}
                            </button>
                            <span style={{ ...muted, color: p.allowed ? '#10b981' : (c.error || '#ef4444') }}>{p.allowed ? 'allowed' : 'blocked'}</span>
                            <button type="button" style={btn(false)} disabled={busy} onClick={() => run(() => actor.allow_app(a.id, !p.allowed), p.allowed ? `${a.name} is blocked` : `${a.name} may notify you`)}>{p.allowed ? 'Block' : 'Allow'}</button>
                        </div>
                        {open === a.id && (
                            <div style={{ padding: '10px 0 4px 18px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.85rem', color: c.secondaryText }}>
                                <label><input type="checkbox" checked={p.demote} onChange={(e) => setPermission(a, { ...p, demote: e.target.checked })} /> Demote everything one level</label>
                                <label><input type="checkbox" checked={p.copy_only} onChange={(e) => setPermission(a, { ...p, copy_only: e.target.checked })} /> Only to my copy channel</label>
                                <label>At most <input type="number" min="1" max="1000" style={{ ...select, width: 70 }} defaultValue={String(p.daily_cap)} onBlur={(e) => setPermission(a, { ...p, daily_cap: BigInt(Math.max(1, Number(e.target.value) || 1)) })} /> messages a day</label>
                                <label>It may cost me at most <input type="number" min="0" step="0.0001" style={{ ...select, width: 100 }} defaultValue={String(Number(p.daily_spend_cap_e8s) / 1e8)} onBlur={(e) => setPermission(a, { ...p, daily_spend_cap_e8s: BigInt(Math.round((Number(e.target.value) || 0) * 1e8)) })} /> ICP a day</label>
                                <div style={{ marginTop: 4 }}>
                                    {a.topics.map((t) => (
                                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0' }}>
                                            <span style={{ flex: 1, minWidth: 160 }}>{t.title} <span style={muted}>({levelOf(t.level)})</span></span>
                                            <select style={select} value={ruleValue(topicRuleOf(p, t.id))} onChange={(e) => setPermission(a, withTopicRule(p, t.id, e.target.value))}>
                                                <option value="default">As declared</option>
                                                <option value="urgent">Treat as urgent</option>
                                                <option value="normal">Treat as normal</option>
                                                <option value="info">Treat as info</option>
                                                <option value="mute">Mute</option>
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {(() => {
                const decided = new Set([...apps.map(([a]) => String(a.id)), ...requests.map((a) => String(a.id))]);
                const others = allApps.filter((a) => !decided.has(String(a.id)));
                if (!others.length) return null;
                return (
                    <div style={card}>
                        <h2 style={h2}><FaPlug color={accent} /> Other apps</h2>
                        {others.map((a) => (
                            <div key={String(a.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 0', borderTop: `1px solid ${c.border}` }}>
                                <div style={{ flex: 1, minWidth: 200 }}>
                                    <div style={{ color: c.primaryText, fontWeight: 600 }}>{a.name} {a.verified && <FaCheckCircle color="#3b82f6" size={12} title="Verified app" />}</div>
                                    <div style={muted}>{a.description || 'No description'} · {a.topics.map((t) => t.title).join(', ')}</div>
                                </div>
                                <button type="button" style={btn(true)} disabled={busy} onClick={() => run(() => actor.allow_app(a.id, true), `${a.name} may now notify you`)}>Allow</button>
                            </div>
                        ))}
                    </div>
                );
            })()}

            <div style={card}>
                <h2 style={h2}><FaBell color={accent} /> Channels</h2>
                {channels.map((ch) => (
                    <div key={String(ch.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderTop: `1px solid ${c.border}`, fontSize: '0.88rem' }}>
                        <span style={{ flex: 1, color: c.primaryText }}>{ch.name} <span style={muted}>· {kindLabel(kindOf(ch.kind))}</span></span>
                        <span style={{ ...muted, color: 'verified' in ch.state ? '#10b981' : accent }}>{'verified' in ch.state ? 'ready' : 'waiting for the code'}</span>
                        {kindOf(ch.kind) !== 'sneed_sms' && <button type="button" style={btn(false)} disabled={busy} onClick={() => run(() => actor.remove_channel(ch.id), 'Channel removed')}>Remove</button>}
                    </div>
                ))}
                {channels.filter((ch) => 'unverified' in ch.state).map((ch) => (
                    <div key={`v${ch.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', fontSize: '0.85rem', color: c.secondaryText }}>
                        <span>Code sent to {ch.name}:</span>
                        <input inputMode="numeric" maxLength={6} placeholder="123456" value={codes[String(ch.id)] || ''} onChange={(e) => setCodes({ ...codes, [String(ch.id)]: e.target.value.trim() })} style={{ ...select, width: 100 }} />
                        <button type="button" style={btn(true)} disabled={busy || (codes[String(ch.id)] || '').length !== 6} onClick={() => run(async () => {
                            const r = await actor.verify_channel(ch.id, codes[String(ch.id)]);
                            if ('err' in r) return r;
                            // a new channel starts with urgent and normal messages
                            const s = (await actor.get_my_settings()).settings;
                            return actor.set_settings({ ...s, defaults: { ...s.defaults, urgent: [...s.defaults.urgent, ch.id], normal: [...s.defaults.normal, ch.id] } });
                        }, `${ch.name} is ready: urgent and normal messages go there now`)}>Verify</button>
                        <button type="button" style={btn(false)} disabled={busy} onClick={() => run(async () => actor.resend_code(ch.id), 'A new code is on its way (the old one stops working)')}>Send a new code</button>
                    </div>
                ))}
                <p style={{ ...muted }}>Sneed SMS is your inbox: messages land in <Link to="/sms" style={{ color: accent }}>Sneed SMS</Link> and the bell in the header.</p>
                {smsPreview !== null && (
                    <label style={{ ...muted, display: 'flex', gap: 8, alignItems: 'center', cursor: busy ? 'default' : 'pointer' }}>
                        <input type="checkbox" checked={smsPreview} disabled={busy} onChange={(e) => { const on = e.target.checked; run(async () => { await smsActor.set_notification_preview(on); setSmsPreview(on); }, on ? 'New-message notifications show the first 100 characters' : 'New-message notifications show only who wrote and the subject'); }} />
                        Show the first 100 characters of new direct messages in notifications (they show on your lock screen, and Discord can read its DMs)
                    </label>
                )}
                {live.push && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                        {pushSupported() && (!isIOS() || isStandaloneApp())
                            ? <button type="button" style={btn(true)} disabled={busy} onClick={() => run(async () => { await addPushChannel(identity, /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'This computer'); }, 'Check this device: a code is on its way as a notification')}>Get notifications on this device</button>
                            : <span style={muted}>Phone notifications: {isIOS() ? <>install Sneed Hub on your home screen first (<Link to="/help/app" style={{ color: accent }}>how</Link>), then turn them on here inside the app.</> : 'this browser cannot receive push notifications.'}</span>}
                    </div>
                )}
                {live.discord && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                        <input placeholder="Your Discord user id" value={discordId} onChange={(e) => setDiscordId(e.target.value.trim())} style={{ ...select, width: 200 }} />
                        <button type="button" style={btn(false)} disabled={busy || !/^\d{15,22}$/.test(discordId)} onClick={() => run(async () => { await addDiscordChannel(identity, discordId); setDiscordId(''); }, 'Mr Sneed is sending you a code on Discord')}>{busy ? 'Adding…' : 'Add Discord'}</button>
                        {discordId && !/^\d{15,22}$/.test(discordId) && <span style={{ color: c.error || '#ef4444', fontSize: '0.8rem' }}>That's not a Discord user id: it is a number of about 18 digits, not your username.</span>}
                        <span style={{ ...muted, flexBasis: '100%' }}>Mr Sneed's bot DMs you, so you need to share a server with him (the Sneed Discord) and allow DMs from its members. Your user id: Discord settings → Advanced → Developer Mode, then right-click your name → Copy User ID.</span>
                    </div>
                )}
                {!live.push && !live.discord && <p style={muted}>Coming soon: {CHANNEL_KINDS.filter((k) => !k.live).map((k) => k.label).join(', ')}.</p>}
                <p style={{ ...muted, fontSize: '0.75rem', marginBottom: 0 }}>Addresses are encrypted in your browser to the relay that delivers them: this canister and other apps can't read them.</p>
            </div>

            <div style={card}>
                <h2 style={h2} id="message-balance"><FaWallet color={accent} /> Message balance</h2>
                <p style={{ ...muted, marginTop: 0 }}>You pay for your own deliveries on paid channels (phone push, Discord, email…); Sneed SMS is free. An app may pay for a message itself. Your message balance: <strong style={{ color: c.primaryText }}>{formatIcp(data.balance_e8s)}</strong>. Top-ups can't be withdrawn. This is separate from your <a href="#sneed-monitor" style={{ color: accent }}>Sneed Monitor balance</a>, which pays for proposal checks.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="number" min="0.0001" step="0.0001" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...select, width: 120 }} /> <span style={muted}>ICP</span>
                    <button type="button" style={btn(true)} disabled={busy || !(Number(amount) > 0)} onClick={() => run(async () => { await topUp(identity, BigInt(Math.round(Number(amount) * 1e8))); }, 'Topped up')}>Top up</button>
                    <span style={muted}>from your Sneed Hub wallet (plus the 0.0001 ICP ledger fee)</span>
                </div>
                {lowAlert !== '' && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                        <span style={muted}>Warn me when my message balance falls below</span>
                        <input type="number" min="0" step="0.0001" value={lowAlert} onChange={(e) => setLowAlert(e.target.value)} style={{ ...select, width: 110 }} /> <span style={muted}>ICP</span>
                        <button type="button" style={btn(false)} disabled={busy || !(Number(lowAlert) >= 0)} onClick={() => run(async () => actor.set_low_balance_alert(BigInt(Math.round(Number(lowAlert) * 1e8))), Number(lowAlert) > 0 ? 'Low-balance alert saved' : 'Low-balance alert turned off')}>Save</button>
                        <span style={{ ...muted, flexBasis: '100%', fontSize: '0.78rem' }}>Sent once, free, to Sneed SMS and your urgent channels; again after a top-up. 0 turns it off.</span>
                    </div>
                )}
            </div>

            <div style={card}>
                <h2 style={h2}><FaHistory color={accent} /> Recent</h2>
                {history.length === 0 && <p style={muted}>Nothing yet.</p>}
                {history.map((n) => (
                    <div key={String(n.id)} style={{ borderTop: `1px solid ${c.border}`, padding: '8px 0', fontSize: '0.86rem' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                            <strong style={{ color: c.primaryText }}>{n.title}</strong>
                            <span style={muted}>{n.app_name} · {levelOf(n.level)} · {new Date(Number(n.created_at / 1_000_000n)).toLocaleString()}</span>
                        </div>
                        {n.body && <div style={{ color: c.secondaryText, marginTop: 2, whiteSpace: 'pre-wrap' }}>{n.body.length > 300 ? `${n.body.slice(0, 300)}…` : n.body}</div>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                            {n.deliveries.map((d, i) => {
                                const s = Object.keys(d.state)[0];
                                const color = s === 'delivered' ? '#10b981' : s === 'failed' ? (c.error || '#ef4444') : s === 'suppressed' ? c.mutedText : accent;
                                const why = d.state[s]?.reason ? `: ${d.state[s].reason}` : '';
                                return <span key={i} style={{ fontSize: '0.72rem', border: `1px solid ${color}`, color, borderRadius: 999, padding: '1px 8px' }}>{kindLabel(kindOf(d.kind))} · {s}{why}</span>;
                            })}
                            {n.deliveries.length === 0 && <span style={muted}>not delivered (muted or no channel)</span>}
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
}
