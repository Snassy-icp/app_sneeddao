// The Conversations view of /sms: the loaded received and sent messages grouped by the set of people
// in them (utils/smsConversations.js), shown as chat bubbles. Sending goes through the page's own send
// path (`send`), so limits, fees and rate-limit errors are handled in one place.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import BigAvatar from './BigAvatar';
import PrincipalInput from './PrincipalInput';
import MarkdownBody from './MarkdownBody';
import { PrincipalDisplay, truncatePrincipal } from '../utils/PrincipalUtils';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import { appAlert } from '../utils/appDialog';
import { Principal } from '@dfinity/principal';
import {
    groupConversations, keyOf, othersOfKey, threadRows, defaultSubject, previewOf,
} from '../utils/smsConversations';
import { FaArrowLeft, FaPaperPlane, FaPlus, FaTrash, FaSync, FaChevronUp, FaChevronDown, FaStickyNote, FaComments, FaExpand, FaTimes, FaReply } from 'react-icons/fa';

const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const css = `
.sms-conv-layout { display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 1rem; }
.sms-conv-pane { height: 72vh; height: 72dvh; min-height: 420px; }
.sms-conv-back { display: none !important; }
@media (max-width: 760px) {
    .sms-conv-layout { grid-template-columns: minmax(0, 1fr); }
    .sms-conv-layout.has-open .sms-conv-list { display: none; }
    .sms-conv-layout:not(.has-open) .sms-conv-thread { display: none; }
    .sms-conv-back { display: inline-flex !important; }
    .sms-conv-pane { height: calc(100vh - 140px); height: calc(100dvh - 140px); min-height: 360px; }
}
.sms-bubble p:last-child { margin-bottom: 0 !important; }
.sms-bubble img { max-width: 100%; }
.sms-bubble pre { white-space: pre-wrap; word-break: break-word; }
.sms-bubble-mine a, .sms-bubble-mine code { color: #fff !important; }
.sms-conv-row { transition: background 0.15s ease; }
`;

const shortTime = (ns) => new Date(Number(ns) / 1e6).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function dayLabel(dayText) {
    const d = new Date(dayText);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/// props:
///   me            my principal text
///   received/sent the loaded lists (newest first, as SmsContext holds them)
///   unreadMark    received messages newer than this (ns bigint) count as unread; null = none
///   loaded        both lists loaded
///   hasOlder, loadingOlder, onLoadOlder   older pages of both lists
///   send          async ({ recipients: string[], subject, body, replyTo }) -> { ok: true } | { ok: false, error }
///   limits        { subject, body, recipients } (the effective ones)
///   accent, accentDark  the page's accent colours
///   onOpenMessage(message)  the page's message details (Reply all, remove, thread)
///   initialKey    a conversation to open first
export default function SmsConversations({
    me, received, sent, unreadMark, loaded, hasOlder, loadingOlder, onLoadOlder, send, limits,
    accent, accentDark, onOpenMessage, initialKey = null,
}) {
    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming() || {};
    const [activeKey, setActiveKey] = useState(initialKey);
    const [readInConversation, setReadInConversation] = useState(() => new Map());
    const [startingNew, setStartingNew] = useState(false);
    const [newRecipients, setNewRecipients] = useState(['']);
    const [drafts, setDrafts] = useState(() => new Map()); // key -> { body, subject }
    const [sending, setSending] = useState(false);
    const scrollRef = useRef(null);
    const bodyRef = useRef(null);

    // grouping: once per change of the lists (not per conversation opened)
    const conversations = useMemo(
        () => (me ? groupConversations(received || [], sent || [], me) : []),
        [received, sent, me],
    );
    const byId = useMemo(() => {
        const m = new Map();
        for (const c of conversations) for (const x of c.messages) m.set(x.id.toString(), x);
        return m;
    }, [conversations]);
    // unread per conversation: received after the page's last-seen mark, and not yet read here
    const unread = useMemo(() => {
        const out = new Map();
        if (unreadMark === null || unreadMark === undefined) return out;
        const mark = BigInt(unreadMark);
        for (const c of conversations) {
            const readUpTo = readInConversation.get(c.key);
            const n = c.messages.filter((m) => m.sender.toString() !== me && m.created_at > mark && (readUpTo === undefined || m.created_at > readUpTo)).length;
            if (n) out.set(c.key, n);
        }
        return out;
    }, [conversations, unreadMark, readInConversation, me]);

    const active = useMemo(() => {
        if (!activeKey) return null;
        return conversations.find((c) => c.key === activeKey) || { key: activeKey, others: othersOfKey(activeKey), messages: [], last: null };
    }, [activeKey, conversations]);
    const isGroup = (active?.others?.length || 0) > 1;
    const rows = useMemo(() => (active ? threadRows(active.messages, me, { group: isGroup }) : []), [active, me, isGroup]);

    // an open conversation is read up to its newest message (also those that come in while open)
    const lastAt = active?.last?.created_at ?? null;
    useEffect(() => {
        if (!activeKey || lastAt === null) return;
        setReadInConversation((prev) => {
            const cur = prev.get(activeKey);
            if (cur !== undefined && cur >= lastAt) return prev;
            const next = new Map(prev); next.set(activeKey, lastAt); return next;
        });
    }, [activeKey, lastAt]);

    // keep the newest bubble in view: on opening and when a message arrives
    const lastId = active?.last?.id?.toString() ?? null;
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [activeKey, lastId]);

    const nameOf = (p) => {
        const t = p.toString();
        return principalNicknames?.get(t) || principalNames?.get(t) || truncatePrincipal(t);
    };
    const titleOf = (c) => {
        if (!c.others.length) return 'Notes to self';
        const names = c.others.map(nameOf);
        if (names.length <= 3) return names.join(', ');
        return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
    };

    const draft = drafts.get(activeKey) || { body: '', subject: '' };
    const setDraft = (patch) => setDrafts((prev) => {
        const next = new Map(prev);
        next.set(activeKey, { ...(prev.get(activeKey) || { body: '', subject: '' }), ...patch });
        return next;
    });
    const subjectDefault = defaultSubject(active?.last?.subject, draft.body, limits.subject);
    const recipientsOfActive = active ? (active.others.length ? active.others : [me]) : [];
    const tooMany = recipientsOfActive.length > limits.recipients;
    const bodyTooLong = draft.body.length > limits.body;
    const canSend = !!active && !sending && draft.body.trim() && !tooMany && !bodyTooLong;

    const doSend = async () => {
        if (!canSend) return;
        setSending(true);
        try {
            const r = await send({
                recipients: recipientsOfActive,
                subject: (draft.subject.trim() || subjectDefault).slice(0, limits.subject),
                body: draft.body.trim(),
                replyTo: active.last ? active.last.id : null,
            });
            if (r?.ok) {
                setDrafts((prev) => { const next = new Map(prev); next.delete(activeKey); return next; });
                bodyRef.current?.focus();
            } else {
                await appAlert(r?.error || 'Failed to send message', { type: 'error', title: 'Message not sent' });
            }
        } finally {
            setSending(false);
        }
    };

    const validNew = newRecipients.map((r) => r.trim()).filter((r) => {
        if (!r) return false;
        try { Principal.fromText(r); return true; } catch (_) { return false; }
    });
    const openNew = () => {
        const key = keyOf(validNew.filter((r) => r !== me));
        setActiveKey(key);
        setStartingNew(false);
        setNewRecipients(['']);
        setTimeout(() => bodyRef.current?.focus(), 0);
    };

    const pill = (props) => ({
        background: theme.colors.tertiaryBg, color: theme.colors.primaryText, border: `1px solid ${theme.colors.border}`,
        borderRadius: '10px', padding: '0.5rem 0.85rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
        fontFamily: SYSTEM_FONT, display: 'inline-flex', alignItems: 'center', gap: '0.4rem', ...props,
    });
    const paneStyle = {
        background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: '16px',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0,
    };

    const avatarsOf = (c, size) => {
        if (!c.others.length) {
            return (
                <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${accent}, ${accentDark})`, color: '#fff' }}>
                    <FaStickyNote size={Math.round(size * 0.42)} />
                </span>
            );
        }
        if (c.others.length === 1) return <BigAvatar principal={c.others[0]} size={size} verified="auto" />;
        const small = Math.round(size * 0.68);
        return (
            <span style={{ position: 'relative', width: size, height: size, flexShrink: 0, display: 'inline-block' }}>
                <BigAvatar principal={c.others[0]} size={small} style={{ position: 'absolute', left: 0, top: 0 }} />
                <span style={{ position: 'absolute', right: 0, bottom: 0, borderRadius: '50%', boxShadow: `0 0 0 2px ${theme.colors.secondaryBg}` }}>
                    <BigAvatar principal={c.others[1]} size={small} style={{ display: 'block' }} />
                </span>
            </span>
        );
    };

    // ---- the list ----
    const list = (
        <div className="sms-conv-list sms-conv-pane" style={paneStyle}>
            <div style={{ padding: '0.75rem', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: theme.colors.primaryText, fontWeight: 700, flex: 1 }}>Conversations</span>
                <button type="button" onClick={() => setStartingNew((v) => !v)} title="Start a new conversation"
                    style={pill({ background: `linear-gradient(135deg, ${accent}, ${accentDark})`, color: '#fff', border: 'none' })}>
                    {startingNew ? <FaTimes size={11} /> : <FaPlus size={11} />}
                    {startingNew ? 'Cancel' : 'New'}
                </button>
            </div>
            {startingNew && (
                <div style={{ padding: '0.75rem', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.8rem' }}>
                        With whom? Add one person for a chat, more for a group.
                    </span>
                    {newRecipients.map((r, i) => (
                        <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <PrincipalInput value={r} autoFocus={i === newRecipients.length - 1}
                                    onChange={(v) => setNewRecipients((prev) => prev.map((x, j) => (j === i ? v : x)))}
                                    placeholder="Principal ID or name" />
                            </div>
                            {newRecipients.length > 1 && (
                                <button type="button" title="Remove" onClick={() => setNewRecipients((prev) => prev.filter((_, j) => j !== i))}
                                    style={pill({ padding: '0.55rem', color: theme.colors.error })}>
                                    <FaTrash size={11} />
                                </button>
                            )}
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => setNewRecipients((prev) => [...prev, ''])}
                            disabled={newRecipients.length >= limits.recipients} style={pill({ opacity: newRecipients.length >= limits.recipients ? 0.5 : 1 })}>
                            <FaPlus size={10} /> Add person
                        </button>
                        <button type="button" onClick={openNew} disabled={!validNew.length}
                            style={pill({ background: validNew.length ? accent : theme.colors.tertiaryBg, color: validNew.length ? '#fff' : theme.colors.mutedText, border: 'none', cursor: validNew.length ? 'pointer' : 'not-allowed' })}>
                            <FaComments size={11} /> Open conversation
                        </button>
                    </div>
                </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {!loaded && (
                    <div style={{ padding: '1.5rem', textAlign: 'center', color: theme.colors.mutedText }}>Loading conversations…</div>
                )}
                {loaded && conversations.length === 0 && (
                    <div style={{ padding: '1.5rem', textAlign: 'center', color: theme.colors.mutedText, fontSize: '0.9rem', lineHeight: 1.5 }}>
                        No conversations yet. Press New to start one.
                    </div>
                )}
                {conversations.map((c) => {
                    const n = unread.get(c.key) || 0;
                    const open = c.key === activeKey;
                    const mine = c.last.sender.toString() === me;
                    return (
                        <div key={c.key} className="sms-conv-row" role="button" tabIndex={0}
                            onClick={() => setActiveKey(c.key)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveKey(c.key); } }}
                            style={{
                                display: 'flex', gap: '0.65rem', alignItems: 'center', padding: '0.7rem 0.75rem', cursor: 'pointer',
                                background: open ? `${accent}22` : 'transparent', borderBottom: `1px solid ${theme.colors.border}`,
                            }}>
                            {avatarsOf(c, 42)}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                                    <span style={{ flex: 1, minWidth: 0, color: theme.colors.primaryText, fontWeight: n ? 700 : 600, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {titleOf(c)}
                                    </span>
                                    <span title={getFullDate(c.last.created_at)} style={{ color: n ? accent : theme.colors.mutedText, fontSize: '0.72rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                        {getRelativeTime(c.last.created_at)}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.15rem' }}>
                                    <span style={{ flex: 1, minWidth: 0, color: n ? theme.colors.primaryText : theme.colors.mutedText, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {mine && c.others.length ? 'You: ' : (c.others.length > 1 ? `${nameOf(c.last.sender)}: ` : '')}
                                        {previewOf(c.last.body) || c.last.subject}
                                    </span>
                                    {n > 0 && (
                                        <span aria-label={`${n} unread`} style={{ background: accent, color: '#fff', borderRadius: '999px', minWidth: '1.25rem', padding: '0 0.4rem', fontSize: '0.7rem', fontWeight: 700, lineHeight: '1.25rem', textAlign: 'center', flexShrink: 0 }}>
                                            {n}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                {hasOlder && (
                    <div style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <button type="button" onClick={onLoadOlder} disabled={loadingOlder} style={pill({ opacity: loadingOlder ? 0.6 : 1 })}>
                            {loadingOlder ? <FaSync size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <FaChevronDown size={11} />}
                            {loadingOlder ? 'Loading…' : 'Load older messages'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );

    // ---- the open conversation ----
    const bubbleRadius = (mine, runEnd) => (mine
        ? `18px 18px ${runEnd ? '4px' : '18px'} 18px`
        : `18px 18px 18px ${runEnd ? '4px' : '18px'}`);

    const quoted = (id) => {
        const q = byId.get(id.toString());
        return (
            <Link to={`/msg/${id}`} onClick={(e) => e.stopPropagation()} title="Open the thread"
                style={{ display: 'flex', gap: '0.35rem', alignItems: 'baseline', fontSize: '0.75rem', color: 'inherit', opacity: 0.8, textDecoration: 'none', borderLeft: '3px solid currentColor', paddingLeft: '0.45rem', marginBottom: '0.35rem', overflow: 'hidden' }}>
                <FaReply size={9} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {q ? `${q.sender.toString() === me ? 'You' : nameOf(q.sender)}: ${previewOf(q.body, 60)}` : `Message #${id.toString()}`}
                </span>
            </Link>
        );
    };

    const thread = active ? (
        <div className="sms-conv-thread sms-conv-pane" style={paneStyle}>
            {/* header */}
            <div style={{ padding: '0.65rem 0.75rem', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <button type="button" className="sms-conv-back" onClick={() => setActiveKey(null)} title="All conversations" style={pill({ padding: '0.5rem' })}>
                    <FaArrowLeft size={12} />
                </button>
                {avatarsOf(active, 36)}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {active.others.length === 0 ? (
                        <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>Notes to self</div>
                    ) : active.others.length === 1 ? (
                        <PrincipalDisplay principal={Principal.fromText(active.others[0])} short={true} showCopyButton={false} hideIcon={true}
                            style={{ color: theme.colors.primaryText, fontWeight: 700 }} />
                    ) : (
                        <>
                            <div style={{ color: theme.colors.primaryText, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {titleOf(active)}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.15rem 0.6rem', fontSize: '0.75rem', marginTop: '0.1rem' }}>
                                <span style={{ color: theme.colors.mutedText }}>{active.others.length + 1} people:</span>
                                {active.others.map((p) => (
                                    <PrincipalDisplay key={p} principal={Principal.fromText(p)} short={true} showCopyButton={false}
                                        style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }} />
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* bubbles */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, padding: '0.75rem 0.75rem 0.5rem' }}>
                {hasOlder && (
                    <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
                        <button type="button" onClick={onLoadOlder} disabled={loadingOlder} style={pill({ fontSize: '0.78rem', opacity: loadingOlder ? 0.6 : 1 })}>
                            {loadingOlder ? <FaSync size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <FaChevronUp size={10} />}
                            {loadingOlder ? 'Loading…' : 'Load older messages'}
                        </button>
                    </div>
                )}
                {rows.length === 0 && (
                    <div style={{ textAlign: 'center', color: theme.colors.mutedText, fontSize: '0.88rem', padding: '2rem 1rem', lineHeight: 1.5 }}>
                        {active.others.length ? 'No messages with them yet. Write the first one below.' : 'Notes you send only to yourself show here.'}
                    </div>
                )}
                {rows.map((r) => {
                    const m = r.message;
                    return (
                        <React.Fragment key={m.id.toString()}>
                            {r.day && (
                                <div style={{ textAlign: 'center', margin: '0.9rem 0 0.6rem', color: theme.colors.mutedText, fontSize: '0.72rem', fontWeight: 600 }}>
                                    {dayLabel(r.day)}
                                </div>
                            )}
                            {r.showSender && (
                                <div style={{ fontSize: '0.72rem', color: theme.colors.mutedText, margin: '0.5rem 0 0.15rem 2.6rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {nameOf(m.sender)}
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: r.mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '0.4rem', marginBottom: r.runEnd ? '0.55rem' : '0.15rem' }}>
                                {!r.mine && (
                                    <span style={{ width: 28, flexShrink: 0 }}>
                                        {r.runEnd && <BigAvatar principal={m.sender} size={28} />}
                                    </span>
                                )}
                                <div
                                    className={`sms-bubble${r.mine ? ' sms-bubble-mine' : ''}`}
                                    title={getFullDate(m.created_at)}
                                    style={{
                                        maxWidth: 'min(78%, 560px)', minWidth: 0, overflowWrap: 'anywhere',
                                        background: r.mine ? `linear-gradient(135deg, ${accent}, ${accentDark})` : theme.colors.tertiaryBg,
                                        color: r.mine ? '#fff' : theme.colors.primaryText,
                                        borderRadius: bubbleRadius(r.mine, r.runEnd), padding: '0.5rem 0.75rem',
                                    }}>
                                    {r.replyTo !== null && quoted(r.replyTo)}
                                    {r.subject && (
                                        <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.8, marginBottom: '0.2rem' }}>{r.subject}</div>
                                    )}
                                    <MarkdownBody text={m.body} style={{ color: 'inherit', fontSize: '0.92rem', lineHeight: 1.4 }} />
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.4rem', marginTop: '0.15rem', fontSize: '0.65rem', opacity: 0.7 }}>
                                        <span>{shortTime(m.created_at)}</span>
                                        <button type="button" onClick={() => onOpenMessage(m)} title="Message details (reply all, remove, thread)" aria-label="Message details"
                                            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'inline-flex' }}>
                                            <FaExpand size={9} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* composer */}
            <div style={{ borderTop: `1px solid ${theme.colors.border}`, padding: '0.5rem 0.75rem calc(0.6rem + env(safe-area-inset-bottom, 0px))', background: theme.colors.secondaryBg }}>
                <input type="text" value={draft.subject} onChange={(e) => setDraft({ subject: e.target.value })}
                    maxLength={limits.subject} placeholder={`Subject: ${subjectDefault}`} aria-label="Subject (optional)"
                    style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', borderBottom: `1px dashed ${theme.colors.border}`, color: theme.colors.secondaryText, fontSize: '0.75rem', padding: '0.2rem 0.25rem', marginBottom: '0.4rem', fontFamily: SYSTEM_FONT, outline: 'none' }} />
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                    <textarea ref={bodyRef} value={draft.body} rows={1}
                        onChange={(e) => setDraft({ body: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSend(); } }}
                        onFocus={(e) => { const t = e.currentTarget; setTimeout(() => t.scrollIntoView?.({ block: 'nearest' }), 300); }}
                        placeholder={active.others.length ? 'Message' : 'Note to self'}
                        aria-label="Message"
                        style={{
                            flex: 1, minWidth: 0, boxSizing: 'border-box', resize: 'none', maxHeight: '9rem', minHeight: '2.4rem',
                            height: `${Math.min(9, 1.4 * Math.max(1, draft.body.split('\n').length) + 1)}rem`,
                            background: theme.colors.tertiaryBg, color: theme.colors.primaryText,
                            border: `1px solid ${bodyTooLong ? theme.colors.error : theme.colors.border}`, borderRadius: '18px',
                            padding: '0.55rem 0.85rem', fontSize: '16px', fontFamily: SYSTEM_FONT, lineHeight: 1.4, outline: 'none',
                        }} />
                    <button type="button" onClick={doSend} disabled={!canSend} title="Send (Ctrl+Enter)" aria-label="Send"
                        style={{
                            width: '2.4rem', height: '2.4rem', borderRadius: '50%', border: 'none', flexShrink: 0,
                            background: canSend ? `linear-gradient(135deg, ${accent}, ${accentDark})` : theme.colors.tertiaryBg,
                            color: canSend ? '#fff' : theme.colors.mutedText, cursor: canSend ? 'pointer' : 'not-allowed',
                            display: 'grid', placeItems: 'center',
                        }}>
                        {sending ? <FaSync size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FaPaperPlane size={13} />}
                    </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.35rem', fontSize: '0.68rem', color: theme.colors.mutedText, flexWrap: 'wrap' }}>
                    <span>
                        {tooMany
                            ? <span style={{ color: theme.colors.error }}>{`This group has more people than one message can go to (${limits.recipients}).`}</span>
                            : <>Private, not encrypted: Sneed SMS admins can read messages. <Link to="/help/sms#privacy" style={{ color: 'inherit' }}>Details</Link></>}
                    </span>
                    {draft.body.length > limits.body * 0.8 && (
                        <span style={{ color: bodyTooLong ? theme.colors.error : theme.colors.warning }}>{draft.body.length}/{limits.body}</span>
                    )}
                </div>
            </div>
        </div>
    ) : (
        <div className="sms-conv-thread sms-conv-pane" style={{ ...paneStyle, alignItems: 'center', justifyContent: 'center', color: theme.colors.mutedText, padding: '2rem', textAlign: 'center' }}>
            <FaComments size={32} style={{ opacity: 0.5, marginBottom: '0.75rem' }} />
            Pick a conversation, or press New to start one.
        </div>
    );

    return (
        <div style={{ fontFamily: SYSTEM_FONT }}>
            <style>{css}</style>
            <div className={`sms-conv-layout${activeKey ? ' has-open' : ''}`}>
                {list}
                {thread}
            </div>
        </div>
    );
}

