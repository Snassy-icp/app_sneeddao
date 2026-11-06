import { useEffect, useState } from 'react';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { useAuth } from '../AuthContext';
import {
    loadProposalTitles, getCachedProposalTitle, subscribeProposalTitles,
} from '../utils/proposalTitles';

// Proposal titles for a list of { governanceId, proposalId }: fetched in list_proposals windows
// (see utils/proposalTitles.js), cached for the session, shared by every list using this hook.
// Returns titleOf(governanceId, proposalId) -> title, or undefined while unknown.
export default function useProposalTitles(requests) {
    const { identity } = useAuth();
    const [, setVersion] = useState(0);

    useEffect(() => subscribeProposalTitles(() => setVersion(v => v + 1)), []);

    // A stable key, so a re-render with the same rows asks for nothing
    const key = (requests || [])
        .filter(r => r && r.governanceId && r.proposalId !== null && r.proposalId !== undefined)
        .map(r => `${r.governanceId}:${r.proposalId}`)
        .sort()
        .join(',');

    useEffect(() => {
        if (!key) return;
        const byGovernance = new Map();
        key.split(',').forEach(entry => {
            const [gov, id] = entry.split(':');
            if (!byGovernance.has(gov)) byGovernance.set(gov, []);
            byGovernance.get(gov).push(Number(id));
        });
        const listProposals = async (governanceId, before, limit) => {
            const gov = createSnsGovernanceActor(governanceId, {
                agentOptions: identity ? { identity } : {},
            });
            const response = await gov.list_proposals({
                limit,
                before_proposal: [{ id: BigInt(before) }],
                include_reward_status: [],
                exclude_type: [],
                include_status: [],
                include_topics: [],
            });
            return response?.proposals || [];
        };
        byGovernance.forEach((ids, gov) => { loadProposalTitles(gov, ids, listProposals); });
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

    // Read at render time; the subscription above re-renders when titles arrive
    return (governanceId, proposalId) => (governanceId && proposalId !== null && proposalId !== undefined)
        ? (getCachedProposalTitle(governanceId, proposalId) ?? undefined)
        : undefined;
}
