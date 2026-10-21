import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaTimes, FaSpinner, FaGavel } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import CandidValue from './CandidValue';
import useProposeAction, { MIN_WHY, readCurrent } from '../governance/useProposeAction';
import { CLASSES, SNEED_ROOT, DEFAULT_EXPIRY_DAYS, votingPeriodText } from '../governance/registry';
import { neuronIdHex } from '../governance/neurons';

/// Propose one registry action to Sneed DAO (spec/sneed_proxy.md §4.2), generalised from the
/// Mr Sneed dialog. The page builds the new argument tuple (`args`, in @dfinity/candid form) with its
/// own form, passes it in, and may render that form as `children`; the dialog shows current →
/// proposed, asks why, generates an editable title and summary, previews the proxy validator's text
/// (what voters will see, before anything is paid) and files the proposal from the chosen neuron.
/// The proposer's principal and neuron are public: the summary says so.
export default function ProposeDialog({ actionKey, args, onClose, children }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const { isAuthenticated } = useAuth();
    const p = useProposeAction(actionKey);
    const [why, setWhy] = useState('');
    const [note, setNote] = useState('');
    const [expiryDays, setExpiryDays] = useState(DEFAULT_EXPIRY_DAYS);
    const [draft, setDraft] = useState(null);
    const [title, setTitle] = useState('');
    const [summary, setSummary] = useState('');
    const [edited, setEdited] = useState(false);
    const [preview, setPreview] = useState(null);
    const [current, setCurrent] = useState(null);
    const [neuron, setNeuron] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);

    useEffect(() => { readCurrent(actionKey).then(setCurrent); }, [actionKey]);
    useEffect(() => { if (p.neurons?.eligible?.[0] && !neuron) setNeuron(neuronIdHex(p.neurons.eligible[0])); }, [p.neurons]);

    // re-draft and re-validate as the inputs change
    useEffect(() => {
        let live = true;
        const t = setTimeout(async () => {
            try {
                const d = await p.draft(args, { why, note, expiryDays: Number(expiryDays) || 0 });
                if (!live) return;
                setDraft(d);
                if (!edited) { setTitle(d.title); setSummary(d.summary); }
                const v = await p.validate(d);
                if (live) setPreview(v);
            } catch (e) { if (live) setPreview({ err: e?.message || String(e) }); }
        }, 400);
        return () => { live = false; clearTimeout(t); };
    }, [actionKey, JSON.stringify(args, (_, v) => (typeof v === 'bigint' ? v.toString() : v)), why, note, expiryDays, p.functionId]);

    if (!p.action) return null;
    const cls = CLASSES[p.action.class];
    const whyOk = why.trim().length >= MIN_WHY;
    const canSubmit = p.canPropose && neuron && draft && preview?.ok && whyOk && title.trim() && !busy;

    const submit = async () => {
        setBusy(true); setError('');
        try {
            const n = p.neurons.eligible.find((x) => neuronIdHex(x) === neuron);
            const id = await p.propose({ draft, neuronId: n.id[0].id, title: title.trim(), summary: `${summary}\n\n---\n${preview.ok}` });
            setDone({ id });
        } catch (e) { setError(e?.message || String(e)); }
        finally { setBusy(false); }
    };

    const input = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: 14, fontFamily: 'inherit' };
    const label = { display: 'block', fontSize: 12, color: c.mutedText, textTransform: 'uppercase', letterSpacing: 0.6, margin: '12px 0 6px' };
    const button = (primary, disabled) => ({ padding: '9px 18px', borderRadius: 999, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? c.accent : 'transparent', color: primary ? '#fff' : c.secondaryText, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 });
    const notice = { margin: '12px 0', padding: 12, borderRadius: 10, border: `1px solid ${c.warning || '#f59e0b'}`, color: c.secondaryText, fontSize: 14, lineHeight: 1.5 };

    return (
        <div role="dialog" aria-modal="true" aria-label={`Propose: ${p.action.label}`} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: c.primaryBg, border: `1px solid ${c.border}`, borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
                    <h2 style={{ margin: 0, fontSize: 18, color: c.primaryText }}>Propose: {p.action.label}</h2>
                    <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ background: 'none', border: 'none', color: c.mutedText, cursor: 'pointer' }}><FaTimes /></button>
                </div>
                <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 18px 14px' }}>
                    {done ? (
                        <div style={{ padding: '18px 0', color: c.primaryText, lineHeight: 1.6 }}>
                            Proposal filed{done.id != null ? <> as <Link to={`/proposal?proposalid=${done.id}&sns=${SNEED_ROOT}`} style={{ color: c.accent }}>proposal {done.id.toString()}</Link></> : ''}. Your neuron voted yes on it automatically, as SNS proposers do. It takes effect if the DAO adopts it.
                        </div>
                    ) : (
                        <>
                            {p.functionId === null && <div style={notice}>Proposals for this setting are not enabled yet: the DAO has not registered the Sneed proxy's <code>{cls.method}</code> function. You can still draft the change and see how voters would see it.</div>}
                            <div style={{ fontSize: 13, color: c.secondaryText, margin: '12px 0 0', lineHeight: 1.5 }}>
                                {p.canister.name} · {cls.topic}{cls.critical ? ' (critical)' : ''}: {votingPeriodText(p.action.class)}.
                            </div>
                            {children}
                            <div style={label}>Current → proposed</div>
                            <CandidValue values={args} fields={p.action.fields} current={current} />

                            <label style={label} htmlFor="prop-why">Why (at least {MIN_WHY} characters)</label>
                            <textarea id="prop-why" value={why} onChange={(e) => setWhy(e.target.value)} rows={3} placeholder="Explain the change to voters" style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)', gap: 10 }}>
                                <div><label style={label} htmlFor="prop-note">Note on chain (optional, 500 characters)</label>
                                    <input id="prop-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} style={input} /></div>
                                <div><label style={label} htmlFor="prop-exp">Expires after (days, 0 = never)</label>
                                    <input id="prop-exp" inputMode="numeric" value={String(expiryDays)} onChange={(e) => setExpiryDays(e.target.value.replace(/[^0-9]/g, ''))} style={input} /></div>
                            </div>

                            <label style={label} htmlFor="prop-title">Title</label>
                            <input id="prop-title" value={title} maxLength={256} onChange={(e) => { setEdited(true); setTitle(e.target.value); }} style={input} />
                            <label style={label} htmlFor="prop-summary">Summary (Markdown)</label>
                            <textarea id="prop-summary" value={summary} onChange={(e) => { setEdited(true); setSummary(e.target.value); }} rows={8} style={{ ...input, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 12 }} />
                            {edited && <button type="button" onClick={() => { setEdited(false); if (draft) { setTitle(draft.title); setSummary(draft.summary); } }} style={{ ...button(false), padding: '4px 10px', fontSize: 12, marginTop: 6 }}>Regenerate title and summary</button>}

                            <div style={label}>What voters will see (the proxy's validator)</div>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, padding: 12, borderRadius: 10, background: c.secondaryBg, border: `1px solid ${preview?.err ? c.error : c.border}`, color: preview?.err ? c.error : c.secondaryText, maxHeight: 220, overflowY: 'auto', overflowWrap: 'anywhere' }}>
                                {preview ? (preview.ok || preview.err) : 'Checking…'}
                            </div>

                            <label style={label} htmlFor="prop-neuron">From your neuron</label>
                            {!isAuthenticated ? <div style={{ color: c.secondaryText, fontSize: 14 }}>Log in with a principal that can submit proposals for a SNEED neuron.</div>
                                : p.neurons === null ? <div style={{ color: c.mutedText, fontSize: 14 }}><FaSpinner /> Looking for your neurons…</div>
                                : (
                                    <>
                                        {p.neurons.eligible.length > 0 ? (
                                            <select id="prop-neuron" value={neuron} onChange={(e) => setNeuron(e.target.value)} style={{ ...input, background: c.secondaryBg, color: c.primaryText }}>
                                                {p.neurons.eligible.map((n) => { const h = neuronIdHex(n); return <option key={h} value={h} style={{ background: c.secondaryBg, color: c.primaryText }}>{h.slice(0, 12)}… · {(Number(n.cached_neuron_stake_e8s) / 1e8).toLocaleString()} SNEED</option>; })}
                                            </select>
                                        ) : <div style={{ color: c.secondaryText, fontSize: 14 }}>You need a SNEED neuron that lets you submit proposals. <Link to="/neurons" style={{ color: c.accent }}>Your neurons</Link></div>}
                                        {p.neurons.excluded.map(({ neuron: n, reason }) => (
                                            <div key={neuronIdHex(n)} style={{ fontSize: 12, color: c.mutedText, marginTop: 4 }}>{neuronIdHex(n).slice(0, 12)}… can't propose: {reason}</div>
                                        ))}
                                    </>
                                )}
                            <p style={{ fontSize: 12, color: c.mutedText, margin: '8px 0 0', lineHeight: 1.5 }}>Proposals are public: your principal and neuron are shown with it. A rejected proposal costs its proposer the DAO's rejection fee; your neuron votes yes on its own proposal automatically.</p>
                            {(error || p.error) && <div style={{ color: c.error, fontSize: 14, marginTop: 10 }}>{error || p.error}</div>}
                        </>
                    )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: `1px solid ${c.border}`, flexShrink: 0 }}>
                    <button type="button" onClick={onClose} disabled={busy} style={button(false, busy)}>{done ? 'Close' : 'Cancel'}</button>
                    {!done && <button type="button" onClick={submit} disabled={!canSubmit} style={button(true, !canSubmit)}>{busy ? <FaSpinner /> : <FaGavel size={12} />} File proposal</button>}
                </div>
            </div>
        </div>
    );
}
