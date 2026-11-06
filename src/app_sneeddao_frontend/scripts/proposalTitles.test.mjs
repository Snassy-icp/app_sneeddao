// Tests for src/utils/proposalTitles.js (proposal titles in the forum's Proposals topic and the feed).
//   node --test scripts/proposalTitles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    proposalIdFromThreadTitle, proposalWindows, loadProposalTitles, getCachedProposalTitle,
    clearProposalTitleCache, WINDOW,
} from '../src/utils/proposalTitles.js';

test('proposal id from the forum-made thread title', () => {
    assert.equal(proposalIdFromThreadTitle('Sneed DAO Proposal #888'), 888);
    assert.equal(proposalIdFromThreadTitle(['Sneed DAO Proposal #12']), 12);
    assert.equal(proposalIdFromThreadTitle('Proposal #7 '), 7);
    assert.equal(proposalIdFromThreadTitle('About Proposal #7 and more'), null);
    assert.equal(proposalIdFromThreadTitle('General chat'), null);
    assert.equal(proposalIdFromThreadTitle([]), null);
    assert.equal(proposalIdFromThreadTitle(undefined), null);
});

test('windows: consecutive ids share one call, far ids get their own', () => {
    assert.deepEqual(proposalWindows([]), []);
    assert.deepEqual(proposalWindows([5]), [{ before: 6, limit: 1, ids: [5] }]);
    assert.deepEqual(proposalWindows([480, 487, 485, 487]), [{ before: 488, limit: 8, ids: [487, 485, 480] }]);
    const w = proposalWindows([500, 500 - WINDOW + 1, 500 - WINDOW, 3]);
    assert.deepEqual(w.map(x => x.ids), [[500, 500 - WINDOW + 1], [500 - WINDOW], [3]]);
    w.forEach(x => assert.ok(x.limit <= WINDOW));
});

const proposal = (id, title) => ({ id: [{ id: BigInt(id) }], proposal: [{ title }] });

test('one call per window, cached for the session, never asked twice', async () => {
    clearProposalTitleCache();
    const calls = [];
    const list = async (gov, before, limit) => {
        calls.push({ gov, before, limit });
        const out = [];
        for (let id = before - 1; id >= before - limit; id--) if (id !== 486) out.push(proposal(id, `Title ${id}`));
        return out;
    };
    // the same rows twice at once (a re-render while the first load is in flight)
    await Promise.all([
        loadProposalTitles('gov-a', [487, 486, 480], list),
        loadProposalTitles('gov-a', [487, 486, 480], list),
    ]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { gov: 'gov-a', before: 488, limit: 8 });
    assert.equal(getCachedProposalTitle('gov-a', 487), 'Title 487');
    assert.equal(getCachedProposalTitle('gov-a', 486), null); // not found: remembered, not re-asked
    assert.equal(getCachedProposalTitle('gov-b', 487), undefined); // per governance canister
    await loadProposalTitles('gov-a', [487, 486, 480], list);
    assert.equal(calls.length, 1);
});

test('a failed window is forgotten, so a later load asks again', async () => {
    clearProposalTitleCache();
    let fail = true;
    let calls = 0;
    const list = async (gov, before) => {
        calls++;
        if (fail) throw new Error('down');
        return [proposal(before - 1, 'Back')];
    };
    await loadProposalTitles('gov-a', [9], list);
    assert.equal(getCachedProposalTitle('gov-a', 9), undefined);
    fail = false;
    await loadProposalTitles('gov-a', [9], list);
    assert.equal(calls, 2);
    assert.equal(getCachedProposalTitle('gov-a', 9), 'Back');
});
