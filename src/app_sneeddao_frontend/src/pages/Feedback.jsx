// /feedback: report a bug or suggest an idea. A report becomes a thread in the Sneed forum, where
// anyone can discuss it, and its recipients (set on /admin/feedback) get a Sneed SMS ping. A
// security issue goes to the recipients privately by Sneed SMS and is never posted.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FaBug, FaLightbulb, FaLock, FaSpinner, FaCheckCircle, FaArrowRight, FaComments } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { getFeedbackConfig, recentReports, reportDetails, sendReport, MAX_TITLE, MAX_PUBLIC_TEXT, MAX_PRIVATE_TEXT } from '../utils/feedback';

const dateOf = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const KINDS = {
    bug: { icon: FaBug, label: 'Bug', color: '#ef4444', title: 'What went wrong?', placeholder: 'What did you do, what did you expect, and what happened instead?' },
    idea: { icon: FaLightbulb, label: 'Idea', color: '#eab308', title: 'Your idea', placeholder: 'What would you like Sneed Hub to do, and why would it help?' },
};

export default function Feedback() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated, login } = useAuth();
    const naming = useNaming();
    const [params] = useSearchParams();
    const [config, setConfig] = useState(undefined);
    const [kind, setKind] = useState(params.get('kind') === 'idea' ? 'idea' : 'bug');
    const [title, setTitle] = useState('');
    const [text, setText] = useState('');
    const [security, setSecurity] = useState(false);
    const [attach, setAttach] = useState(true);
    const [details, setDetails] = useState([]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(null); // { threadId, pinged, security }
    const [recent, setRecent] = useState(null);

    // the page the reporter came from: ?from=, or a same-site referrer
    const fromPath = useMemo(() => {
        const p = params.get('from');
        if (p && p.startsWith('/')) return p;
        try { const r = new URL(document.referrer); if (r.origin === window.location.origin && r.pathname !== '/feedback') return r.pathname + r.search; } catch { /* none */ }
        return null;
    }, [params]);

    useEffect(() => { getFeedbackConfig().then(setConfig).catch((e) => { setConfig(null); setError(e.message); }); }, []);
    useEffect(() => { reportDetails(fromPath).then(setDetails); }, [fromPath]);
    useEffect(() => {
        if (!config) return;
        // one topic may hold both kinds: read each topic once, and tell the kinds apart by the
        // "Bug:" / "Idea:" title this page writes (other threads: by their topic, if it has one kind)
        const same = config.bugTopic != null && config.bugTopic === config.ideaTopic;
        const topics = same ? [[null, config.bugTopic]] : [['bug', config.bugTopic], ['idea', config.ideaTopic]].filter(([, t]) => t != null);
        const kindOf = (th, k) => (/^Bug:/.test(th.title[0] || '') ? 'bug' : /^Idea:/.test(th.title[0] || '') ? 'idea' : k);
        Promise.all(topics.map(([k, t]) => recentReports(t, 10).then((ts) => ts.map((th) => ({ ...th, kind: kindOf(th, k) })))))
            .then((lists) => setRecent(lists.flat().sort((a, b) => Number(b.created_at - a.created_at)).slice(0, 10)))
            .catch(() => setRecent([]));
    }, [config, sent]);

    const isSecurity = kind === 'bug' && security;
    const maxText = isSecurity ? MAX_PRIVATE_TEXT : MAX_PUBLIC_TEXT;
    const open = config && (isSecurity ? config.recipients.length > 0 : (kind === 'bug' ? config.bugTopic : config.ideaTopic) != null);
    const ready = title.trim() && text.trim() && text.length <= maxText && open && !sending;
    const attached = kind === 'bug' && attach ? details : [];

    const submit = async () => {
        setSending(true); setError('');
        try {
            const r = await sendReport(identity, config, { kind, title: title.trim(), text: text.trim(), details: attached, security: isSecurity });
            setSent({ ...r, security: isSecurity });
            setTitle(''); setText(''); setSecurity(false);
        } catch (e) { setError(e?.message || String(e)); }
        finally { setSending(false); }
    };

    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 16, padding: 18 };
    const input = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: 15, fontFamily: 'inherit' };
    const label = { display: 'block', fontSize: 12, color: c.mutedText, textTransform: 'uppercase', letterSpacing: .6, margin: '14px 0 6px' };
    const K = KINDS[kind];

    return (
        <>
            <Header />
            <div style={{ maxWidth: 820, margin: '0 auto', padding: '1.5rem 16px 3rem' }}>
                <h1 style={{ margin: '0 0 6px', color: c.primaryText }}>Feedback</h1>
                <p style={{ margin: '0 0 18px', color: c.secondaryText, lineHeight: 1.6 }}>
                    Found a bug, or have an idea? Tell us here. Your report becomes a thread in the <Link to="/forum" style={{ color: c.accent }}>Sneed forum</Link>, where anyone can join the discussion, and the people who build Sneed Hub get a message about it.
                </p>

                {sent ? (
                    <section style={{ ...card, textAlign: 'center', padding: '28px 18px' }}>
                        <FaCheckCircle size={34} color={c.success} />
                        <h2 style={{ margin: '10px 0 6px', color: c.primaryText }}>Thank you!</h2>
                        <p style={{ margin: '0 auto 16px', maxWidth: 520, color: c.secondaryText, lineHeight: 1.6 }}>
                            {sent.security
                                ? 'Your security report went privately to the people who build Sneed Hub. Replies will arrive in your Sneed SMS inbox.'
                                : `Your report is on the forum.${sent.pinged ? ' The people who build Sneed Hub got a message about it.' : ''} Replies show up in the thread.`}
                        </p>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                            {sent.threadId != null && <Link to={`/thread?threadid=${sent.threadId}`} style={{ padding: '10px 18px', borderRadius: 999, background: c.accent, color: '#fff', textDecoration: 'none', fontWeight: 600 }}>Open the thread <FaArrowRight size={11} /></Link>}
                            {sent.security && <Link to="/sms" style={{ padding: '10px 18px', borderRadius: 999, background: c.accent, color: '#fff', textDecoration: 'none', fontWeight: 600 }}>Your messages <FaArrowRight size={11} /></Link>}
                            <button type="button" onClick={() => setSent(null)} style={{ padding: '10px 18px', borderRadius: 999, border: `1px solid ${c.border}`, background: 'transparent', color: c.secondaryText, cursor: 'pointer' }}>Send another</button>
                        </div>
                    </section>
                ) : (
                    <section style={card}>
                        {config === undefined && <div style={{ color: c.mutedText }}><FaSpinner /> Loading…</div>}
                        {config === null && <div style={{ color: c.mutedText }}>Feedback is not open yet.</div>}
                        {config && (
                            <>
                                <div role="tablist" style={{ display: 'flex', gap: 8 }}>
                                    {Object.entries(KINDS).map(([k, v]) => {
                                        const Icon = v.icon; const on = k === kind;
                                        return (
                                            <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setKind(k)}
                                                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 15, border: `1px solid ${on ? v.color : c.border}`, background: on ? `${v.color}1f` : 'transparent', color: on ? v.color : c.secondaryText }}>
                                                <Icon /> {k === 'bug' ? 'Report a bug' : 'Suggest an idea'}
                                            </button>
                                        );
                                    })}
                                </div>

                                {!isAuthenticated ? (
                                    <div style={{ textAlign: 'center', padding: '22px 0 6px' }}>
                                        <p style={{ color: c.secondaryText, margin: '0 0 12px' }}>Log in to send a report. It is posted under your principal, so we can reply.</p>
                                        <button type="button" onClick={login} style={{ padding: '10px 22px', borderRadius: 999, border: 'none', background: c.accent, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Log in</button>
                                    </div>
                                ) : (
                                    <>
                                        <label style={label} htmlFor="fb-title">{K.title}</label>
                                        <input id="fb-title" value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder="A short title" style={input} />
                                        <label style={label} htmlFor="fb-text">Details</label>
                                        <textarea id="fb-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={K.placeholder} rows={8} style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
                                        <div style={{ textAlign: 'right', fontSize: 12, color: text.length > maxText ? c.error : c.mutedText, marginTop: 4 }}>{text.length.toLocaleString()} / {maxText.toLocaleString()}</div>

                                        {kind === 'bug' && (
                                            <>
                                                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 10, cursor: 'pointer', color: c.secondaryText, fontSize: 14 }}>
                                                    <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} style={{ marginTop: 3 }} />
                                                    <span>Attach these details, to help us reproduce it:
                                                        <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: c.mutedText, wordBreak: 'break-word' }}>{details.map(([k, v]) => <span key={k} style={{ display: 'block' }}><b>{k}:</b> {v}</span>)}</span>
                                                    </span>
                                                </label>
                                                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 10, cursor: 'pointer', color: c.secondaryText, fontSize: 14 }}>
                                                    <input type="checkbox" checked={security} onChange={(e) => setSecurity(e.target.checked)} style={{ marginTop: 3 }} />
                                                    <span><FaLock size={11} /> This is a security issue: send it privately instead of posting it. It goes to the people who build Sneed Hub as a Sneed SMS message.</span>
                                                </label>
                                            </>
                                        )}

                                        {!open && <div style={{ color: c.mutedText, fontSize: 13, marginTop: 12 }}>{isSecurity ? 'Private reports are not open yet.' : `${K.label}s cannot be posted yet: no forum topic is set.`}</div>}
                                        {error && <div style={{ color: c.error, fontSize: 14, marginTop: 12 }}>{error}</div>}
                                        <p style={{ fontSize: 12, color: c.mutedText, margin: '14px 0 0', lineHeight: 1.5 }}>
                                            {isSecurity ? 'Sent from your principal to the recipients only.' : 'Posted publicly on the forum under your principal (with your Sneed name if you have one).'}
                                        </p>
                                        <button type="button" disabled={!ready} onClick={submit}
                                            style={{ marginTop: 12, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: 12, border: 'none', fontWeight: 700, fontSize: 15, color: '#fff', background: ready ? K.color : c.border, cursor: ready ? 'pointer' : 'not-allowed' }}>
                                            {sending ? <><FaSpinner /> Sending…</> : isSecurity ? <><FaLock /> Send privately</> : <><K.icon /> Post {K.label.toLowerCase()} report</>}
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </section>
                )}

                {recent && recent.length > 0 && (
                    <section style={{ marginTop: 22 }}>
                        <h2 style={{ fontSize: '1.1rem', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 8 }}><FaComments /> Recent reports</h2>
                        {recent.map((t) => {
                            const k = KINDS[t.kind] || { icon: FaComments, color: c.mutedText }; const Icon = k.icon;
                            const info = getPrincipalDisplayInfoFromContext(t.created_by, naming.principalNames, naming.principalNicknames, naming.verifiedNames, naming.principalCanisterTypes);
                            return (
                                <Link key={String(t.id)} to={`/thread?threadid=${t.id}`} style={{ ...card, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none', marginBottom: 8 }}>
                                    <Icon color={k.color} style={{ flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ color: c.primaryText, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title[0] || 'Untitled'}</div>
                                        <div style={{ fontSize: 12, color: c.mutedText, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                            <PrincipalDisplay principal={t.created_by} displayInfo={info} short showCopyButton={false} enableContextMenu={false} isAuthenticated={isAuthenticated} />
                                            <span>· {dateOf(t.created_at)}</span>
                                            {t.total_posts_count[0] != null && <span>· {String(t.total_posts_count[0])} {t.total_posts_count[0] === 1n ? 'reply' : 'replies'}</span>}
                                        </div>
                                    </div>
                                    <FaArrowRight size={11} color={c.mutedText} />
                                </Link>
                            );
                        })}
                    </section>
                )}
            </div>
        </>
    );
}
