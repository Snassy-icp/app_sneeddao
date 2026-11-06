// Sneed SMS conversations: the received and sent lists grouped by who takes part. A conversation is
// the set of everyone in a message (sender and recipients) other than me, so the same group of people
// is one conversation whoever wrote each message. One other person: a 1:1 chat; two or more: a group;
// nobody else (a message I sent only to myself): "Notes to self". Pure functions, no React, so the
// grouping can be tested (scripts/smsConversations.test.mjs).

export const NOTES_KEY = 'self';

const text = (p) => (typeof p === 'string' ? p : p?.toString?.() ?? String(p));

/// The other participants of a message (sorted principal texts) and the conversation key.
export function conversationOf(message, me) {
    const others = new Set();
    const sender = text(message.sender);
    if (sender !== me) others.add(sender);
    for (const r of message.recipients || []) {
        const t = text(r);
        if (t !== me) others.add(t);
    }
    const list = [...others].sort();
    return { key: keyOf(list), others: list };
}

/// The key of a participant set (principal texts, me excluded; any order).
export function keyOf(others) {
    const list = [...new Set((others || []).map(text))].sort();
    return list.length ? list.join(',') : NOTES_KEY;
}

/// The participants of a key, back from keyOf.
export const othersOfKey = (key) => (key === NOTES_KEY || !key ? [] : key.split(','));

const byOldest = (a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : (a.created_at < b.created_at ? -1 : 1));

/// All conversations of the loaded messages, newest activity first. Each: { key, others, messages
/// (oldest first), last, unread }. `isUnread(message)` (optional) says whether a received message
/// counts as unread; `seenInConversation` (optional Map key -> created_at) marks a conversation read
/// up to that time (it was opened).
export function groupConversations(received, sent, me, { isUnread, seenInConversation } = {}) {
    const seen = new Set();
    const groups = new Map();
    for (const m of [...(received || []), ...(sent || [])]) {
        const id = m.id.toString();
        if (seen.has(id)) continue; // a message to myself is in both lists
        seen.add(id);
        const { key, others } = conversationOf(m, me);
        let g = groups.get(key);
        if (!g) { g = { key, others, messages: [] }; groups.set(key, g); }
        g.messages.push(m);
    }
    const out = [];
    for (const g of groups.values()) {
        g.messages.sort(byOldest);
        g.last = g.messages[g.messages.length - 1];
        const readUpTo = seenInConversation?.get(g.key);
        g.unread = isUnread
            ? g.messages.filter((m) => text(m.sender) !== me && isUnread(m) && (readUpTo === undefined || m.created_at > readUpTo)).length
            : 0;
        out.push(g);
    }
    return out.sort((a, b) => -byOldest(a.last, b.last));
}

/// A subject without its "Re: " prefixes, for comparing.
export const baseSubject = (s) => String(s || '').replace(/^\s*(re:\s*)+/i, '').trim();

/// The subject of a reply to `subject` ("Re: " once).
export const replySubject = (subject) => {
    const base = baseSubject(subject);
    return base ? `Re: ${base}` : '';
};

/// The subject a conversation message gets when the sender typed none: a reply to the last
/// message's subject, or else the start of the body's first line (the canister requires a subject).
export function defaultSubject(lastSubject, body, limit = 200) {
    const reply = replySubject(lastSubject);
    if (reply) return reply.length > limit ? reply.slice(0, limit) : reply;
    const line = String(body || '').split('\n').map((l) => l.trim()).find(Boolean) || 'Message';
    const plain = line.replace(/^[#>*\-\s]+/, '') || 'Message';
    const max = Math.min(limit, 60);
    return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

const dayOf = (ns) => new Date(Number(ns) / 1e6).toDateString();

/// The rows of a conversation (messages oldest first): each message with what to show around it.
///   day        a day divider before it (its local date text), or null
///   mine       I sent it (right-aligned bubble)
///   showSender the sender's name above it (group chats, first of a run by the same sender)
///   subject    the subject to show above the body (when it differs from the previous message's), or null
///   runEnd     the last of a run by the same sender (the bubble gets its tail, the avatar shows)
///   replyTo    the id of the message it replies to (the first), or null
export function threadRows(messages, me, { group = false } = {}) {
    const rows = [];
    let prevDay = null;
    let prevSender = null;
    let prevSubject = null;
    messages.forEach((m, i) => {
        const day = dayOf(m.created_at);
        const sender = text(m.sender);
        const newDay = day !== prevDay;
        const subj = baseSubject(m.subject);
        // not when the subject is only the start of the body (defaultSubject made it)
        const echo = subj && previewOf(m.body, 10_000).startsWith(subj.replace(/…$/, ''));
        const showSubject = Boolean(subj) && subj !== prevSubject && !echo;
        const next = messages[i + 1];
        const nextBreaks = !next || text(next.sender) !== sender || dayOf(next.created_at) !== day;
        const reply = Array.isArray(m.reply_to) && m.reply_to.length && m.reply_to[0]?.length ? m.reply_to[0][0] : null;
        rows.push({
            message: m,
            day: newDay ? day : null,
            mine: sender === me,
            showSender: group && sender !== me && (newDay || sender !== prevSender),
            subject: showSubject ? m.subject : null,
            runEnd: nextBreaks,
            replyTo: reply,
        });
        prevDay = day;
        prevSender = sender;
        prevSubject = subj || prevSubject;
    });
    return rows;
}

/// A one-line preview of a message body (markdown marks and line breaks dropped).
export function previewOf(body, max = 80) {
    const flat = String(body || '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`#>~]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
