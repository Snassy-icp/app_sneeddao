// /admin/feedback: where bug reports and ideas go. The forum topics public reports are posted in,
// and up to 5 recipients who get a Sneed SMS message about each report (and security reports,
// which are never posted). Kept in the backend.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { FaComments, FaPlus, FaTimes, FaSpinner } from 'react-icons/fa';
import Header from '../../components/Header';
import PrincipalInput from '../../components/PrincipalInput';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { getFeedbackConfig, adminSetFeedbackConfig, sneedForumTopics } from '../../utils/feedback';

const MAX_RECIPIENTS = 5;

export default function AdminFeedback() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated } = useAuth();
    const { isAdmin, loading: adminLoading } = useAdminCheck({ identity, isAuthenticated, redirectPath: '/admin' });
    const [loaded, setLoaded] = useState(false);
    const [recipients, setRecipients] = useState(['']);
    const [bugTopic, setBugTopic] = useState('');
    const [ideaTopic, setIdeaTopic] = useState('');
    const [topics, setTopics] = useState([]);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState(null); // { ok, text }

    const load = useCallback(async () => {
        const [cfg, ts] = await Promise.all([getFeedbackConfig(), sneedForumTopics()]);
        setTopics(ts);
        if (cfg) {
            setRecipients(cfg.recipients.length ? cfg.recipients.map((p) => p.toText()) : ['']);
            setBugTopic(cfg.bugTopic != null ? String(cfg.bugTopic) : '');
            setIdeaTopic(cfg.ideaTopic != null ? String(cfg.ideaTopic) : '');
        } else setNotice({ ok: false, text: 'This backend has no feedback settings yet (it needs the upgrade).' });
        setLoaded(true);
    }, []);
    useEffect(() => { if (isAdmin) load().catch((e) => { setNotice({ ok: false, text: e.message }); setLoaded(true); }); }, [isAdmin, load]);

    const parsed = (() => {
        const out = [];
        for (const r of recipients.map((x) => x.trim()).filter(Boolean)) {
            try { const p = Principal.fromText(r); if (p.isAnonymous()) return { error: 'The anonymous principal cannot receive reports' }; out.push(p); }
            catch { return { error: `Not a principal: ${r}` }; }
        }
        return { recipients: out };
    })();

    const save = async () => {
        setSaving(true); setNotice(null);
        try {
            await adminSetFeedbackConfig(identity, { recipients: parsed.recipients, bugTopic: bugTopic || null, ideaTopic: ideaTopic || null });
            await load();
            setNotice({ ok: true, text: 'Feedback settings saved.' });
        } catch (e) { setNotice({ ok: false, text: e.message }); }
        finally { setSaving(false); }
    };

    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16 };
    const select = { width: '100%', padding: '9px 12px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText };
    const option = { background: c.secondaryBg, color: c.primaryText };
    const label = { display: 'block', fontSize: 12, color: c.mutedText, margin: '12px 0 4px' };
    const topicName = (t) => { const parent = t.parent != null ? topics.find((x) => x.id === t.parent) : null; return parent ? `${parent.title} › ${t.title}` : t.title; };

    if (adminLoading || (isAdmin && !loaded)) return <><Header /><div style={{ padding: 40, textAlign: 'center', color: c.mutedText }}><FaSpinner /> Loading…</div></>;
    if (!isAdmin) return <><Header /><div style={{ padding: 40, textAlign: 'center', color: c.mutedText }}>Admins only.</div></>;

    return (
        <>
            <Header />
            <div style={{ maxWidth: 820, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <h1 style={{ margin: '0 0 4px', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 10 }}><FaComments color={c.accent} /> Feedback</h1>
                <p style={{ margin: '0 0 16px', color: c.secondaryText }}>Where reports from the <Link to="/feedback" style={{ color: c.accent }}>feedback page</Link> go.</p>
                {notice && <div style={{ ...card, borderColor: notice.ok ? c.success : c.error, color: c.primaryText }}>{notice.text}</div>}

                <section style={card}>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem', color: c.primaryText }}>Forum topics</h2>
                    <p style={{ margin: 0, fontSize: 13, color: c.mutedText }}>Public reports become threads here, in the Sneed DAO forum. Without a topic, that kind of report cannot be sent.</p>
                    {[['Bugs', bugTopic, setBugTopic], ['Ideas', ideaTopic, setIdeaTopic]].map(([name, value, set]) => (
                        <div key={name}>
                            <label style={label}>{name}</label>
                            <select value={value} onChange={(e) => set(e.target.value)} style={select}>
                                <option value="" style={option}>None</option>
                                {topics.map((t) => <option key={String(t.id)} value={String(t.id)} style={option}>{topicName(t)}</option>)}
                            </select>
                        </div>
                    ))}
                </section>

                <section style={card}>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem', color: c.primaryText }}>Recipients</h2>
                    <p style={{ margin: 0, fontSize: 13, color: c.mutedText }}>They get a Sneed SMS message about every report, and security reports only go to them. At most {MAX_RECIPIENTS}: one message reaches no more.</p>
                    {recipients.map((r, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                            <div style={{ flex: 1, minWidth: 0 }}><PrincipalInput value={r} onChange={(v) => setRecipients(recipients.map((x, j) => (j === i ? v : x)))} isAuthenticated={isAuthenticated} defaultPrincipalType="users" /></div>
                            <button type="button" title="Remove" onClick={() => setRecipients(recipients.length > 1 ? recipients.filter((_, j) => j !== i) : [''])} style={{ padding: 8, borderRadius: 8, border: `1px solid ${c.border}`, background: 'transparent', color: c.mutedText, cursor: 'pointer' }}><FaTimes /></button>
                        </div>
                    ))}
                    {recipients.length < MAX_RECIPIENTS && <button type="button" onClick={() => setRecipients([...recipients, ''])} style={{ marginTop: 10, padding: '7px 12px', borderRadius: 8, border: `1px dashed ${c.border}`, background: 'transparent', color: c.secondaryText, cursor: 'pointer' }}><FaPlus size={10} /> Add a recipient</button>}
                    {parsed.error && <div style={{ color: c.error, fontSize: 13, marginTop: 8 }}>{parsed.error}</div>}
                </section>

                <button type="button" disabled={saving || !!parsed.error} onClick={save} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: saving || parsed.error ? c.border : c.accent, color: '#fff', fontWeight: 700, cursor: saving || parsed.error ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
        </>
    );
}
