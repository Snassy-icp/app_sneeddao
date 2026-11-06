// Tests for src/utils/smsConversations.js (the Conversations view of /sms: grouping by participant
// set, thread rows, subjects).
//   node --test scripts/smsConversations.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    conversationOf, keyOf, othersOfKey, groupConversations, threadRows, baseSubject, replySubject,
    defaultSubject, previewOf, NOTES_KEY,
} from '../src/utils/smsConversations.js';

const ME = 'me-aaaa';
const A = 'alice-bbbb';
const B = 'bob-cccc';
const SYS = 'sneedex-dddd';
// a principal-like value, as the canister returns them
const P = (t) => ({ toString: () => t });
const DAY = 86_400_000_000_000n;
const T0 = 1_780_000_000_000_000_000n + DAY / 2n; // noon-ish UTC, so local days stay distinct
let nextId = 1n;
const msg = (sender, recipients, at, extra = {}) => ({
    id: nextId++, sender: P(sender), recipients: recipients.map(P), subject: 'Hi', body: 'hello', created_at: at,
    reply_to: [], ...extra,
});

test('conversation key: participants minus me, sorted; me alone = notes', () => {
    assert.deepEqual(conversationOf(msg(A, [ME]), ME), { key: A, others: [A] });
    assert.deepEqual(conversationOf(msg(ME, [A]), ME), { key: A, others: [A] });
    assert.equal(conversationOf(msg(ME, [B, A]), ME).key, `${A},${B}`);
    assert.equal(conversationOf(msg(B, [ME, A]), ME).key, `${A},${B}`);
    assert.equal(conversationOf(msg(ME, [ME]), ME).key, NOTES_KEY);
    assert.equal(conversationOf(msg(ME, [ME, A, A]), ME).key, A);
    assert.equal(keyOf([B, A, B]), `${A},${B}`);
    assert.equal(keyOf([]), NOTES_KEY);
    assert.deepEqual(othersOfKey(`${A},${B}`), [A, B]);
    assert.deepEqual(othersOfKey(NOTES_KEY), []);
});

test('grouping: received + sent merged, deduped, oldest first, newest conversation first', () => {
    const m1 = msg(A, [ME], T0);
    const m2 = msg(ME, [A], T0 + 10n);
    const g1 = msg(B, [ME, A], T0 + 20n);
    const n1 = msg(ME, [ME], T0 + 5n);
    const s1 = msg(SYS, [ME], T0 + 30n);
    const received = [s1, g1, n1, m1];
    const sent = [n1, m2]; // n1 (to myself) is in both lists
    const convs = groupConversations(received, sent, ME);
    assert.deepEqual(convs.map((c) => c.key), [SYS, `${A},${B}`, A, NOTES_KEY]);
    const withA = convs.find((c) => c.key === A);
    assert.deepEqual(withA.messages.map((m) => m.id), [m1.id, m2.id]);
    assert.equal(withA.last, m2);
    assert.equal(convs.find((c) => c.key === NOTES_KEY).messages.length, 1);
});

test('unread: received only, after the last-seen mark, not when read in the conversation', () => {
    const mark = T0 + 5n;
    const old = msg(A, [ME], T0);
    const fresh1 = msg(A, [ME], T0 + 10n);
    const mine = msg(ME, [A], T0 + 15n);
    const fresh2 = msg(A, [ME], T0 + 20n);
    const isUnread = (m) => m.created_at > mark;
    let [c] = groupConversations([fresh2, fresh1, old], [mine], ME, { isUnread });
    assert.equal(c.unread, 2);
    [c] = groupConversations([fresh2, fresh1, old], [mine], ME, { isUnread, seenInConversation: new Map([[A, T0 + 10n]]) });
    assert.equal(c.unread, 1);
});

test('thread rows: days, sender runs in groups, subjects only when they change, reply_to', () => {
    const a1 = msg(A, [ME, B], T0, { subject: 'Plan' });
    const a2 = msg(A, [ME, B], T0 + 1n, { subject: 'Re: Plan' });
    const b1 = msg(B, [ME, A], T0 + 2n, { subject: 'Re: Plan', reply_to: [[a2.id]] });
    const m1 = msg(ME, [A, B], T0 + DAY, { subject: 'Re: Plan' });
    const a3 = msg(A, [ME, B], T0 + DAY + 1n, { subject: 'Lunch?' });
    const rows = threadRows([a1, a2, b1, m1, a3], ME, { group: true });
    assert.deepEqual(rows.map((r) => Boolean(r.day)), [true, false, false, true, false]);
    assert.deepEqual(rows.map((r) => r.showSender), [true, false, true, false, true]);
    assert.deepEqual(rows.map((r) => r.mine), [false, false, false, true, false]);
    assert.deepEqual(rows.map((r) => r.subject), ['Plan', null, null, null, 'Lunch?']);
    assert.deepEqual(rows.map((r) => r.runEnd), [false, true, true, true, true]);
    assert.equal(rows[2].replyTo, a2.id);
    assert.equal(rows[0].replyTo, null);
    // 1:1: no sender names
    assert.ok(threadRows([a1, a2], ME).every((r) => !r.showSender));
});

test('a subject that is only the start of the body is not shown', () => {
    const m = msg(ME, [A], T0, { subject: 'See you at the meetup', body: 'See you at the meetup tomorrow!' });
    assert.equal(threadRows([m], ME)[0].subject, null);
});

test('subjects: Re: once, default from the last subject or the body', () => {
    assert.equal(baseSubject('Re: Re: re:  Plan'), 'Plan');
    assert.equal(replySubject('Re: Plan'), 'Re: Plan');
    assert.equal(replySubject('Plan'), 'Re: Plan');
    assert.equal(replySubject(''), '');
    assert.equal(defaultSubject('Plan', 'x'), 'Re: Plan');
    assert.equal(defaultSubject(null, '\n\n# Hello there\nmore'), 'Hello there');
    assert.equal(defaultSubject(null, '   '), 'Message');
    const long = defaultSubject(null, 'a'.repeat(100));
    assert.equal(long.length, 60);
    assert.ok(long.endsWith('…'));
    assert.equal(defaultSubject('x'.repeat(50), '', 20).length, 20);
});

test('preview: one line, markdown marks dropped', () => {
    assert.equal(previewOf('**Hi** [there](https://x.y)\n\nnew `line`'), 'Hi there new line');
    assert.equal(previewOf('a'.repeat(100), 10).length, 10);
});
