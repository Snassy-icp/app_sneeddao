// The forum client's pure helpers (src/app_sneeddao_frontend/src/utils/forumModel.js and
// reactionsModel.js): the bugs of the forum bug pass that live in the client, and the reaction bar's
// model. No canister needed.
//   1. scoreLabel: 999,950 tokens read "+1000K"; -0.004 read "-0" in red, 0.004 "+0" in green
//   2. winningOptionIds: an ended poll without votes marked every option as the winner
//   3. threadDisplayTitle: an untitled thread (title = []) showed an empty heading
//   4. planReadTracking: every reload of the posts (after a vote or a reply) re-stashed the read mark
//      just written, so all "new" highlights vanished; posts of the thread shown before (on a thread
//      switch) were taken as this thread's; own deleted posts were never counted (post.author)
//   5. createTipArgs: amounts and block indexes went through Number (precision lost above 2^53, so
//      the ledger check refused a real transfer) and block index 0 was dropped (tip unverified)
//   6. tipExceptionMessage: a call that threw after the tokens were sent told the tipper nothing,
//      so they could send again
//   7. tipDecimals: when the ledger did not answer icrc1_decimals the tip modal assumed 8, so a tip
//      in a 6-decimal token sent 100 times the amount typed
//   8. orderTopicThreads: the topic page sorted "by activity" on a field threads do not have
//      (last_activity), so both activity sorts were the creation-time sorts (and it asked for a
//      method that does not exist, get_threads_paginated, so unread markers never showed)
import { describe, it, expect } from 'vitest';
import { scoreLabel, winningOptionIds, threadDisplayTitle, planReadTracking, createTipArgs, tipExceptionMessage, tipDecimals, orderTopicThreads } from '../../../src/app_sneeddao_frontend/src/utils/forumModel.js';
import { isSingleEmoji, toggleEmoji, applyReactionChange, COMMON_EMOJIS, searchEmojis } from '../../../src/app_sneeddao_frontend/src/utils/reactionsModel.js';

const E8 = 100_000_000;

describe('forum client bug pass', () => {
  it('1. scores: rounding never shows 1000K, and a score that rounds to 0 is plain 0', () => {
    expect(scoreLabel(999_950 * E8)).toEqual({ text: '+1M', sign: 1 });
    expect(scoreLabel(-999_960 * E8)).toEqual({ text: '-1M', sign: -1 });
    expect(scoreLabel(0.004 * E8)).toEqual({ text: '0', sign: 0 });
    expect(scoreLabel(-0.004 * E8)).toEqual({ text: '0', sign: 0 });
    expect(scoreLabel(0)).toEqual({ text: '0', sign: 0 });
    expect(scoreLabel(1234 * E8)).toEqual({ text: '+1.2K', sign: 1 });
    expect(scoreLabel(-2.5 * E8)).toEqual({ text: '-2.5', sign: -1 });
    expect(scoreLabel(0.25 * E8)).toEqual({ text: '+0.25', sign: 1 });
    expect(scoreLabel(BigInt(3 * E8))).toEqual({ text: '+3', sign: 1 });
  });

  it('2. polls: no winner without votes; ties are all winners', () => {
    expect(winningOptionIds([{ id: 1n, total_voting_power: 0n }, { id: 2n, total_voting_power: 0n }])).toEqual(new Set());
    expect(winningOptionIds([{ id: 1n, total_voting_power: 5n }, { id: 2n, total_voting_power: 5n }, { id: 3n, total_voting_power: 1n }])).toEqual(new Set([1n, 2n]));
    expect(winningOptionIds(undefined)).toEqual(new Set());
  });

  it('3. an untitled thread shows "Thread #id"; a title is text, not the Candid opt', () => {
    expect(threadDisplayTitle({ threadDetails: { title: [] }, threadId: 7 })).toBe('Thread #7');
    expect(threadDisplayTitle({ threadDetails: { title: ['Hello'] }, threadId: 7 })).toBe('Hello');
    expect(threadDisplayTitle({ title: 'Given', threadDetails: { title: ['Hello'] }, threadId: 7 })).toBe('Given');
    expect(threadDisplayTitle({ threadDetails: null, threadId: 9 })).toBe('Thread #9');
  });

  it('4. read marks: stashed once per thread, only this thread\'s posts, own deleted posts count', () => {
    const posts = [{ id: 10n, thread_id: 5n, created_by: 'x' }, { id: 12n, thread_id: 5n, created_by: 'y' }];
    // first load: last read 10, highest 12 -> highlight 11..12, write 12
    const first = planReadTracking({ threadId: 5, posts, me: 'me', serverLastRead: 10, stashedFor: null });
    expect(first).toEqual({ stash: { lastRead: 10, highest: 12 }, write: 12 });
    // the posts reload after a vote: the server now says 12; the highlight must stay as stashed
    const again = planReadTracking({ threadId: 5, posts, me: 'me', serverLastRead: 12, stashedFor: 5 });
    expect(again.stash).toBe(null);
    expect(again.write).toBe(null);
    // a new reply arrives: the mark moves on, the highlight stays
    const more = planReadTracking({ threadId: 5, posts: [...posts, { id: 15n, thread_id: 5n }], me: 'me', serverLastRead: 12, stashedFor: 5 });
    expect(more).toEqual({ stash: null, write: 15 });
    // switched to thread 3 while thread 5's posts are still shown: nothing is written for thread 3
    expect(planReadTracking({ threadId: 3, posts, me: 'me', serverLastRead: 0, stashedFor: 5 })).toEqual({ stash: null, write: null });
    // own deleted posts count, others' deleted ones do not
    const del = [{ id: 20n, thread_id: 6n, deleted: true, created_by: { toString: () => 'me' } }, { id: 21n, thread_id: 6n, deleted: true, created_by: 'z' }];
    expect(planReadTracking({ threadId: 6, posts: del, me: 'me', serverLastRead: 0, stashedFor: null })).toEqual({ stash: { lastRead: 0, highest: 20 }, write: 20 });
  });

  it('5. create_tip arguments keep exact amounts and block index 0', () => {
    const big = 123_456_789_012_345_678_901n; // 18-decimal tokens
    const [to, post, ledger, amount, block] = createTipArgs({ to: 'to', postId: 4n, ledger: 'l', amount: big, blockIndex: 0n });
    expect([to, post, ledger]).toEqual(['to', 4n, 'l']);
    expect(amount).toBe(big);
    expect(block).toEqual([0n]);
    expect(createTipArgs({ to: 'to', postId: 4, ledger: 'l', amount: 5, blockIndex: null })[4]).toEqual([]);
    expect(createTipArgs({ to: 'to', postId: 4, ledger: 'l', amount: 5, blockIndex: 9 })[4]).toEqual([9n]);
  });

  it('6. a failure after the transfer always says the tokens were sent', () => {
    expect(tipExceptionMessage('register', new Error('timeout'))).toMatch(/tokens were sent.*do not send them again/i);
    expect(tipExceptionMessage('register', new Error('timeout'))).toMatch(/timeout/);
    expect(tipExceptionMessage('transfer', new Error('Network down'))).toMatch(/Network down/);
    expect(tipExceptionMessage('transfer', new Error('x'))).toMatch(/check your wallet/i); // the transfer may or may not have happened
  });

  it("8. topic threads: activity sorts keep the forum's activity order", () => {
    // most recently active first, as the forum answers: 3 (old thread, new reply), 5, 4
    const byActivity = [{ id: 3n, created_at: 30n }, { id: 5n, created_at: 50n }, { id: 9n, created_at: 90n, deleted: true }, { id: 4n, created_at: 40n }];
    expect(orderTopicThreads(byActivity, 'activity-newest').map((t) => t.id)).toEqual([3n, 5n, 4n]);
    expect(orderTopicThreads(byActivity, 'activity-oldest').map((t) => t.id)).toEqual([4n, 5n, 3n]);
    expect(orderTopicThreads(byActivity, 'newest').map((t) => t.id)).toEqual([5n, 4n, 3n]);
    expect(orderTopicThreads(byActivity, 'oldest').map((t) => t.id)).toEqual([3n, 4n, 5n]);
    expect(byActivity.map((t) => t.id)).toEqual([3n, 5n, 9n, 4n]); // not mutated
  });

  it('7. a tip is never converted with guessed decimals', () => {
    expect(tipDecimals({ decimals: 8, decimalsUnknown: true })).toHaveProperty('error');
    expect(tipDecimals({ decimals: 6 })).toEqual({ decimals: 6 });
    expect(tipDecimals(null)).toHaveProperty('error');
  });
});

describe('reactions model (reaction bar)', () => {
  it('one emoji = one grapheme cluster, as the canister checks it', () => {
    for (const e of ['👍', '👍🏽', '👩‍💻', '👨‍👩‍👧‍👦', '🇲🇹', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '1️⃣', '❤️', '🏳️‍🌈', '🫠']) expect(isSingleEmoji(e), e).toBe(true);
    for (const e of ['', ' ', 'a', '1', '👍👍', '👍 ', '🇲', 'é', '‍', '👍a', 'x'.repeat(70)]) expect(isSingleEmoji(e), JSON.stringify(e)).toBe(false);
    for (const e of COMMON_EMOJIS) expect(isSingleEmoji(e.emoji), e.emoji).toBe(true);
  });

  it('toggling and counting: mine are added, removed, capped at 10; counts follow', () => {
    expect(toggleEmoji(['👍'], '🎉')).toEqual(['👍', '🎉']);
    expect(toggleEmoji(['👍', '🎉'], '👍')).toEqual(['🎉']);
    const ten = ['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊'];
    expect(toggleEmoji(ten, '👍')).toBe(null); // full
    const counts = [{ emoji: '👍', count: 2n }, { emoji: '🎉', count: 1n }];
    expect(applyReactionChange(counts, ['🎉'], ['👍'])).toEqual([{ emoji: '👍', count: 3n }]);
    expect(applyReactionChange(counts, [], ['🚀'])).toEqual([...counts, { emoji: '🚀', count: 1n }]);
  });

  it('search finds emojis by name', () => {
    expect(searchEmojis('fire').map((e) => e.emoji)).toContain('🔥');
    expect(searchEmojis('THUMB').map((e) => e.emoji)).toContain('👍');
    expect(searchEmojis('').length).toBe(COMMON_EMOJIS.length);
  });
});
