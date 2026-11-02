// The confirmation shown before every proposal vote (src/app_sneeddao_frontend/src/utils/voteConfirm.js).
// No canister needed. Added 2026-11-02 after a near slip-of-the-finger Reject vote: every vote button
// (SNS and NNS, single neuron, all neurons, list quick votes, bulk votes) now asks once first.
import { describe, it, expect } from 'vitest';
import { voteConfirmOptions, confirmVote, truncateTitle } from '../../../src/app_sneeddao_frontend/src/utils/voteConfirm.js';

describe('voteConfirmOptions', () => {
    it('Adopt: primary button "Vote Adopt", proposal id and title in the text', () => {
        const o = voteConfirmOptions({ vote: 1, proposalId: 477, title: 'Upgrade the forum', neurons: 3, votingPower: '1.2K VP' });
        expect(o.title).toBe('Vote Adopt on proposal #477?');
        expect(o.confirmText).toBe('Vote Adopt');
        expect(o.confirmVariant).toBe('primary');
        expect(o.type).toBe('warning');
        expect(o.message).toContain('Your vote: Adopt on proposal #477.');
        expect(o.message).toContain('"Upgrade the forum"');
        expect(o.message).toContain('with 3 neurons (1.2K VP voting power)');
        expect(o.message).not.toContain('Reject');
    });

    it('Reject: red (danger) button "Vote Reject"', () => {
        const o = voteConfirmOptions({ vote: 2, proposalId: '477', title: 't', neurons: 1 });
        expect(o.title).toBe('Vote Reject on proposal #477?');
        expect(o.confirmText).toBe('Vote Reject');
        expect(o.confirmVariant).toBe('danger');
        expect(o.message).toContain('Your vote: Reject');
        expect(o.message).toContain('with 1 neuron.');
        expect(o.message).not.toContain('Adopt');
    });

    it('a single neuron is named by a shortened id', () => {
        const o = voteConfirmOptions({ vote: 1, proposalId: 5, neurons: '4a0d7df0aabbccddeeff00112233' });
        expect(o.message).toContain('with neuron 4a0d7df0…');
        const nns = voteConfirmOptions({ vote: 2, proposalId: 5, neurons: '1234' });
        expect(nns.message).toContain('with neuron 1234.');
    });

    it('truncates long titles and collapses whitespace', () => {
        const long = 'A'.repeat(200);
        const t = truncateTitle(long);
        expect(t.length).toBe(80);
        expect(t.endsWith('…')).toBe(true);
        expect(voteConfirmOptions({ vote: 1, proposalId: 1, title: long }).message).toContain(`"${t}"`);
        expect(truncateTitle('  a \n  b ')).toBe('a b');
    });

    it('no title: no quoted line', () => {
        expect(voteConfirmOptions({ vote: 1, proposalId: 1 }).message).not.toContain('"');
    });

    it('bulk vote on several proposals lists them', () => {
        const o = voteConfirmOptions({ vote: 2, proposalIds: ['10', '11', '12'], daoName: 'Sneed' });
        expect(o.title).toBe('Vote Reject on 3 proposals?');
        expect(o.confirmText).toBe('Vote Reject on all');
        expect(o.confirmVariant).toBe('danger');
        expect(o.message).toContain('on 3 proposals of Sneed.');
        expect(o.message).toContain('#10, #11, #12');
        const many = voteConfirmOptions({ vote: 1, proposalIds: Array.from({ length: 25 }, (_, i) => i) });
        expect(many.message).toContain('and 5 more');
    });

    it('rejects an unknown vote value', () => {
        expect(() => voteConfirmOptions({ vote: 0, proposalId: 1 })).toThrow();
    });
});

describe('confirmVote', () => {
    it('resolves false (no vote) when no dialog host is mounted', async () => {
        expect(await confirmVote({ vote: 1, proposalId: 1 })).toBe(false);
    });
});
