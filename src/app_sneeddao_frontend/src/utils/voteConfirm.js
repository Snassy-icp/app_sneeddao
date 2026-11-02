// One confirmation step before every proposal vote (SNS and NNS), so a slip of the finger cannot
// cast the wrong vote. All vote buttons go through confirmVote(); the text is built by the pure
// voteConfirmOptions() so it can be tested without a dialog host.
//
//   if (!(await confirmVote({ vote: 2, proposalId: 477, title, neurons: 3, votingPower: '12.5K VP' }))) return;
//
// vote: 1 = Adopt, 2 = Reject (SNS and NNS use the same numbers).
import { appConfirm } from './appDialog.js';

export const VOTE_TITLE_MAX = 80;

export function voteWord(vote) {
    return Number(vote) === 1 ? 'Adopt' : Number(vote) === 2 ? 'Reject' : null;
}

export function truncateTitle(title, max = VOTE_TITLE_MAX) {
    const t = String(title ?? '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + '…';
}

function shortNeuronId(id) {
    const s = String(id ?? '');
    return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

/**
 * neurons: a number (how many neurons will vote) or a neuron id (hex string / NNS id) for one neuron.
 * votingPower: an already formatted string (e.g. "1,234 VP"), optional.
 * proposalIds: for a bulk vote on several proposals at once (proposalId/title are then ignored);
 * daoName: optional, names the DAO the proposals belong to.
 */
export function voteConfirmOptions({ vote, proposalId, title, neurons, votingPower, proposalIds, daoName } = {}) {
    const word = voteWord(vote);
    if (!word) throw new Error(`Unknown vote ${vote}`);
    const reject = word === 'Reject';
    const bulk = Array.isArray(proposalIds);

    let target;
    if (bulk) {
        const n = proposalIds.length;
        target = `${n} proposal${n === 1 ? '' : 's'}`;
    } else {
        target = proposalId !== undefined && proposalId !== null && proposalId !== '' ? `proposal #${proposalId}` : 'this proposal';
    }
    const dao = daoName ? ` of ${daoName}` : '';

    let who;
    if (typeof neurons === 'number') who = `with ${neurons} neuron${neurons === 1 ? '' : 's'}`;
    else if (neurons !== undefined && neurons !== null && neurons !== '') who = `with neuron ${shortNeuronId(neurons)}`;
    else who = bulk ? 'with all your eligible neurons' : 'with your neuron';
    if (votingPower) who += ` (${votingPower} voting power)`;

    const lines = [`Your vote: ${word} on ${target}${dao}.`];
    if (bulk) {
        const MAX_IDS = 20;
        const ids = proposalIds.slice(0, MAX_IDS).map((id) => `#${id}`).join(', ');
        if (ids) lines.push('', `Proposals: ${ids}${proposalIds.length > MAX_IDS ? `, and ${proposalIds.length - MAX_IDS} more` : ''}`);
    } else {
        const t = truncateTitle(title);
        if (t) lines.push('', `"${t}"`);
    }
    lines.push('', `This votes ${who}. A cast vote cannot be changed.`);

    return {
        title: `Vote ${word} on ${target}?`,
        message: lines.join('\n'),
        type: 'warning',
        confirmText: bulk ? `Vote ${word} on all` : `Vote ${word}`,
        cancelText: 'Cancel',
        confirmVariant: reject ? 'danger' : 'primary',
    };
}

/** Resolves true when the user confirms the vote, false when cancelled. */
export function confirmVote(args) {
    const { message, ...opts } = voteConfirmOptions(args);
    return appConfirm(message, opts);
}
