/**
 * Shared utilities for finding votable proposals across the app.
 * Used by ActiveProposals page and votable proposals notification.
 */

import { getAllSnses } from './SnsUtils';
import { normalizeId } from './IdUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { HttpAgent } from '@dfinity/agent';
import { uint8ArrayToHex, safePrincipalString } from './NeuronUtils';
import { calculateVotingPower } from './VotingPowerUtils';
import { isProposalAcceptingVotes } from './ProposalUtils';
import {
    createNnsGovActor, isNnsProposalAcceptingVotes,
    hasNnsVotingAccess, getNnsNeuronId, getNnsNeuronVotingPower,
    getNnsBallotForNeuron, NNS_GOVERNANCE_CANISTER_ID
} from './NnsUtils';

/**
 * Get SNSes where the user has hotkey neurons.
 * @param {Map} neuronCache - Map of governanceId -> neurons from WalletContext
 * @param {Object} identity - User identity
 * @returns {Array<{sns, neurons}>} - Relevant SNSes with hotkey neurons
 */
export function getRelevantSnses(neuronCache, identity) {
    if (!neuronCache || neuronCache.size === 0) return [];
    
    const allSnses = getAllSnses();
    const relevant = [];
    
    for (const sns of allSnses) {
        const govId = normalizeId(sns.canisters?.governance);
        if (!govId) continue;
        
        const neurons = neuronCache.get(govId);
        if (!neurons || neurons.length === 0) continue;
        
        const userPrincipal = identity?.getPrincipal()?.toString();
        if (!userPrincipal) continue;
        
        const hotkeyNeurons = neurons.filter(neuron => {
            return neuron.permissions?.some(p => {
                const permPrincipal = safePrincipalString(p.principal);
                if (!permPrincipal || permPrincipal !== userPrincipal) return false;
                const permTypes = p.permission_type || [];
                return permTypes.includes(4); // Vote permission
            });
        });
        
        if (hotkeyNeurons.length > 0) {
            relevant.push({ sns, neurons: hotkeyNeurons });
        }
    }
    
    return relevant;
}

/**
 * Check if the user has eligible neurons to vote on a proposal (hasn't voted yet).
 */
function hasEligibleNeurons(proposal, neurons, nervousSystemParams, userPrincipal) {
    for (const neuron of neurons) {
        const hasVotePerm = neuron.permissions?.some(p => {
            const permPrincipal = safePrincipalString(p.principal);
            if (!permPrincipal || permPrincipal !== userPrincipal) return false;
            const permTypes = p.permission_type || [];
            return permTypes.includes(4);
        });
        if (!hasVotePerm) continue;

        const votingPower = nervousSystemParams ? 
            calculateVotingPower(neuron, nervousSystemParams) : 0;
        if (votingPower === 0) continue;

        const neuronIdHex = uint8ArrayToHex(neuron.id?.[0]?.id);
        const ballot = proposal.ballots?.find(([id]) => id === neuronIdHex);
        
        if (ballot && ballot[1]) {
            const ballotData = ballot[1];
            const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
            if (hasVoted) continue;
        }

        return true; // Found at least one eligible neuron
    }
    return false;
}

/**
 * Get NNS neurons where the user has voting access (hotkey or controller).
 * @param {Map} neuronCache - Map of governanceId -> neurons from WalletContext
 * @param {Object} identity - User identity
 * @returns {Array} - NNS neurons with voting access, or empty array
 */
export function getRelevantNnsNeurons(neuronCache, identity) {
    if (!neuronCache || neuronCache.size === 0) return [];

    const neurons = neuronCache.get(NNS_GOVERNANCE_CANISTER_ID);
    if (!neurons || neurons.length === 0) return [];

    const userPrincipal = identity?.getPrincipal()?.toString();
    if (!userPrincipal) return [];

    return neurons.filter(neuron => hasNnsVotingAccess(neuron, userPrincipal));
}

/**
 * Check if user has eligible NNS neurons to vote on an NNS proposal.
 */
function hasEligibleNnsNeurons(proposal, neurons, userPrincipal) {
    for (const neuron of neurons) {
        if (!hasNnsVotingAccess(neuron, userPrincipal)) continue;

        const votingPower = getNnsNeuronVotingPower(neuron);
        if (votingPower === 0n) continue;

        const neuronId = getNnsNeuronId(neuron);
        if (!neuronId) continue;

        const ballot = getNnsBallotForNeuron(proposal.ballots, neuronId);
        if (ballot && Number(ballot.vote) !== 0) continue; // Already voted

        return true;
    }
    return false;
}

/**
 * Fetch the count of votable proposals the user hasn't voted on yet.
 * Includes both SNS and NNS proposals.
 * @param {Object} identity - User identity
 * @param {Map} neuronCache - Neuron cache from WalletContext
 * @param {boolean} includeFullData - Whether to return full proposal data
 * @returns {Promise<{count: number, snsProposalsData?: Array}>} - Count and optionally full data
 */
export async function fetchVotableProposalsCount(identity, neuronCache, includeFullData = false) {
    if (!identity || !neuronCache || neuronCache.size === 0) {
        return { count: 0, snsProposalsData: [] };
    }

    const userPrincipal = identity.getPrincipal().toString();
    let totalCount = 0;
    const snsProposalsData = [];

    // Fetch SNS votable proposals
    const relevantSnses = getRelevantSnses(neuronCache, identity);
    const snsPromises = relevantSnses.map(async ({ sns, neurons }) => {
        try {
            const govId = sns.canisters.governance;
            const snsGovActor = createSnsGovernanceActor(govId, {
                agentOptions: { identity }
            });

            let nervousSystemParams = null;
            try {
                nervousSystemParams = await snsGovActor.get_nervous_system_parameters(null);
            } catch (e) {
                // Ignore
            }

            const response = await snsGovActor.list_proposals({
                limit: 50,
                before_proposal: [],
                include_reward_status: [],
                exclude_type: [],
                include_status: [],
                include_topics: []
            });

            const activeProposals = response.proposals.filter(p => isProposalAcceptingVotes(p));
            let snsCount = 0;

            for (const proposal of activeProposals) {
                if (hasEligibleNeurons(proposal, neurons, nervousSystemParams, userPrincipal)) {
                    snsCount++;
                }
            }

            totalCount += snsCount;

            if (includeFullData && snsCount > 0) {
                return {
                    snsInfo: sns,
                    proposals: activeProposals,
                    neurons,
                    nervousSystemParams,
                    logo: null
                };
            }
            return null;
        } catch (err) {
            console.warn(`Error fetching proposals for ${sns.name}:`, err);
            return null;
        }
    });

    // Fetch NNS votable proposals
    const nnsNeurons = getRelevantNnsNeurons(neuronCache, identity);
    const nnsPromise = nnsNeurons.length > 0 ? (async () => {
        try {
            const nnsGovActor = createNnsGovActor(identity);
            const response = await nnsGovActor.list_proposals({
                include_reward_status: [1], // ACCEPT_VOTES only
                omit_large_fields: [true],
                before_proposal: [],
                limit: 50,
                exclude_topic: [],
                include_all_manage_neuron_proposals: [],
                include_status: [],
            });

            const activeProposals = (response.proposal_info || []).filter(p => isNnsProposalAcceptingVotes(p));
            let nnsCount = 0;

            for (const proposal of activeProposals) {
                if (hasEligibleNnsNeurons(proposal, nnsNeurons, userPrincipal)) {
                    nnsCount++;
                }
            }

            totalCount += nnsCount;

            if (includeFullData && nnsCount > 0) {
                return {
                    snsInfo: {
                        name: 'Internet Computer',
                        rootCanisterId: 'nns',
                        canisters: { governance: NNS_GOVERNANCE_CANISTER_ID }
                    },
                    proposals: activeProposals,
                    neurons: nnsNeurons,
                    nervousSystemParams: null,
                    logo: null,
                    isNns: true
                };
            }
            return null;
        } catch (err) {
            console.warn('Error fetching NNS votable proposals:', err);
            return null;
        }
    })() : Promise.resolve(null);

    const results = await Promise.all([...snsPromises, nnsPromise]);

    if (includeFullData) {
        snsProposalsData.push(...results.filter(Boolean));
    }

    return { count: totalCount, snsProposalsData };
}
