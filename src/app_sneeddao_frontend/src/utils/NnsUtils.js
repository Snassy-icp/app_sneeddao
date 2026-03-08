/**
 * NNS (Internet Computer) Governance Utilities
 *
 * Provides functions for interacting with the NNS governance canister,
 * including proposal listing, neuron management, and voting.
 * Parallels the SNS utilities but handles NNS-specific data structures.
 */

import { createActor as createNnsGovActorRaw } from 'external/nns_gov';
import { HttpAgent } from '@dfinity/agent';
import { safePrincipalString } from './NeuronUtils';

// ============================================================================
// Constants
// ============================================================================

export const NNS_GOVERNANCE_CANISTER_ID = 'rrkah-fqaaa-aaaaa-aaaaq-cai';
export const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

// NNS Governance Topics - Official IDs from NNS Governance Canister
// Source: https://github.com/dfinity/ic/blob/master/rs/nns/governance/proto/ic_nns_governance/pb/v1/governance.proto
// Critical topics (4 and 14) require explicit followee settings
export const NNS_TOPICS = [
    { id: 0, name: 'All Topics (Catch-all)', description: 'Default following for all topics without specific followees set', isCritical: false },
    { id: 1, name: 'Neuron Management', description: 'Proposals about neuron-related changes', isCritical: false },
    { id: 2, name: 'Exchange Rate', description: 'Exchange rate oracle updates', isCritical: false },
    { id: 3, name: 'Network Economics', description: 'ICP tokenomics, rewards, etc.', isCritical: false },
    { id: 4, name: 'Governance', description: 'Changes to the governance system itself (critical topic)', isCritical: true },
    { id: 5, name: 'Node Admin', description: 'Node operator management', isCritical: false },
    { id: 6, name: 'Participant Management', description: 'Managing participants in the network', isCritical: false },
    { id: 7, name: 'Subnet Management', description: 'Creating/managing subnets', isCritical: false },
    { id: 8, name: 'Network Canister Management', description: 'NNS canister upgrades', isCritical: false },
    { id: 9, name: 'KYC', description: 'Know Your Customer related', isCritical: false },
    { id: 10, name: 'Node Provider Rewards', description: 'Rewards for node providers', isCritical: false },
    { id: 11, name: 'SNS Decentralization Sale', description: 'SNS token sale proposals (legacy)', isCritical: false },
    { id: 12, name: 'Subnet Replica Version Management', description: 'Managing replica versions for subnets (IC OS deployment)', isCritical: false },
    { id: 13, name: 'Replica Version Management', description: 'Managing IC replica versions (IC OS election)', isCritical: false },
    { id: 14, name: 'SNS & Community Fund', description: 'SNS launches and Neurons\' Fund management (critical topic)', isCritical: true },
    { id: 15, name: 'API Boundary Node Management', description: 'Managing API boundary nodes', isCritical: false },
    { id: 16, name: 'Subnet Rental', description: 'Subnet rental requests', isCritical: false },
    { id: 17, name: 'Protocol Canister Management', description: 'Protocol-level canister management', isCritical: false },
    { id: 18, name: 'Service Nervous System Management', description: 'SNS governance system management', isCritical: false },
];

// NNS Proposal Status values (from governance.proto)
export const NNS_PROPOSAL_STATUS = {
    UNKNOWN: 0,
    OPEN: 1,
    REJECTED: 2,
    ADOPTED: 3,
    EXECUTED: 4,
    FAILED: 5,
};

// NNS Proposal Reward Status
export const NNS_REWARD_STATUS = {
    UNKNOWN: 0,
    ACCEPT_VOTES: 1,
    READY_TO_SETTLE: 2,
    SETTLED: 3,
    INELIGIBLE: 4,
};

// NNS Action type display names
const NNS_ACTION_NAMES = {
    RegisterKnownNeuron: 'Register Known Neuron',
    ManageNeuron: 'Manage Neuron',
    UpdateCanisterSettings: 'Update Canister Settings',
    InstallCode: 'Install Code',
    StopOrStartCanister: 'Stop or Start Canister',
    CreateServiceNervousSystem: 'Create Service Nervous System',
    ExecuteNnsFunction: 'Execute NNS Function',
    RewardNodeProvider: 'Reward Node Provider',
    OpenSnsTokenSwap: 'Open SNS Token Swap',
    SetSnsTokenSwapOpenTimeWindow: 'Set SNS Token Swap Open Time Window',
    SetDefaultFollowees: 'Set Default Followees',
    RewardNodeProviders: 'Reward Node Providers',
    ManageNetworkEconomics: 'Manage Network Economics',
    ApproveGenesisKyc: 'Approve Genesis KYC',
    AddOrRemoveNodeProvider: 'Add or Remove Node Provider',
    Motion: 'Motion',
};

// Known neurons fallback
export const KNOWN_NEURONS_FALLBACK = {
    '27': 'DFINITY Foundation',
    '28': 'Internet Computer Association',
};

// ============================================================================
// Actor Creation
// ============================================================================

/**
 * Create an NNS governance actor for the given identity.
 */
export function createNnsGovActor(identity) {
    return createNnsGovActorRaw(NNS_GOVERNANCE_CANISTER_ID, {
        agentOptions: { identity }
    });
}

// ============================================================================
// Topic & Status Helpers
// ============================================================================

/**
 * Get the human-readable name for an NNS topic ID.
 */
export function getNnsTopicName(topicId) {
    const topic = NNS_TOPICS.find(t => t.id === Number(topicId));
    return topic ? topic.name : `Unknown Topic (${topicId})`;
}

/**
 * Get human-readable proposal status text from status Int32.
 */
export function getNnsProposalStatusText(statusInt) {
    switch (Number(statusInt)) {
        case NNS_PROPOSAL_STATUS.OPEN: return 'Open';
        case NNS_PROPOSAL_STATUS.REJECTED: return 'Rejected';
        case NNS_PROPOSAL_STATUS.ADOPTED: return 'Adopted';
        case NNS_PROPOSAL_STATUS.EXECUTED: return 'Executed';
        case NNS_PROPOSAL_STATUS.FAILED: return 'Failed';
        default: return 'Unknown';
    }
}

/**
 * Get the display name for an NNS proposal action variant.
 */
export function getNnsActionTypeName(action) {
    if (!action) return 'Unknown';
    const key = Object.keys(action)[0];
    return NNS_ACTION_NAMES[key] || key || 'Unknown';
}

// ============================================================================
// Proposal Status & Voting Helpers
// ============================================================================

/**
 * Determines if an NNS proposal is still accepting votes.
 * NNS ProposalInfo has deadline_timestamp_seconds as Opt Nat64 ([value] or []).
 */
export function isNnsProposalAcceptingVotes(proposalInfo) {
    if (!proposalInfo) return false;

    try {
        const now = BigInt(Math.floor(Date.now() / 1000));

        // Priority 1: deadline_timestamp_seconds (Opt Nat64)
        const deadline = Array.isArray(proposalInfo.deadline_timestamp_seconds)
            ? proposalInfo.deadline_timestamp_seconds[0]
            : proposalInfo.deadline_timestamp_seconds;
        if (deadline !== undefined && deadline !== null) {
            return now < BigInt(deadline);
        }

        // Priority 2: reward_status
        if (proposalInfo.reward_status !== undefined && proposalInfo.reward_status !== null) {
            return Number(proposalInfo.reward_status) === NNS_REWARD_STATUS.ACCEPT_VOTES;
        }

        // Priority 3: status field
        return Number(proposalInfo.status) === NNS_PROPOSAL_STATUS.OPEN;
    } catch (err) {
        console.error('Error checking NNS proposal voting status:', err);
        return false;
    }
}

/**
 * Gets a combined status string for an NNS proposal.
 */
export function getNnsProposalStatus(proposalInfo) {
    if (!proposalInfo) return 'Unknown';

    const statusText = getNnsProposalStatusText(proposalInfo.status);
    const isVotingOpen = isNnsProposalAcceptingVotes(proposalInfo);

    if (statusText === 'Open') {
        return isVotingOpen ? 'Open for Voting' : 'Voting Closed';
    }

    return isVotingOpen ? `${statusText} (Voting Open)` : `${statusText} (Voting Closed)`;
}

/**
 * Gets the voting deadline for an NNS proposal.
 */
export function getNnsVotingDeadline(proposalInfo) {
    if (!proposalInfo) return null;

    const deadline = Array.isArray(proposalInfo.deadline_timestamp_seconds)
        ? proposalInfo.deadline_timestamp_seconds[0]
        : proposalInfo.deadline_timestamp_seconds;
    if (deadline !== undefined && deadline !== null) {
        return BigInt(deadline);
    }

    return null;
}

/**
 * Formats the remaining time until voting closes for an NNS proposal.
 */
export function getNnsVotingTimeRemaining(proposalInfo) {
    const deadline = getNnsVotingDeadline(proposalInfo);
    if (!deadline) return '';

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= deadline) return 'Voting closed';

    const remainingSeconds = Number(deadline - now);
    const days = Math.floor(remainingSeconds / (24 * 60 * 60));
    const hours = Math.floor((remainingSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((remainingSeconds % (60 * 60)) / 60);

    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    if (minutes > 0) return `${minutes}m remaining`;
    return 'Less than 1m remaining';
}

// ============================================================================
// Ballot Helpers
// ============================================================================

/**
 * Look up a ballot for a given NNS neuron ID in a proposal's ballots array.
 * NNS ballots: [(Nat64, {vote: Int32, voting_power: Nat64})]
 * Key is BigInt (Nat64), not hex string like SNS.
 */
export function getNnsBallotForNeuron(ballots, neuronId) {
    if (!ballots || !neuronId) return null;
    const targetId = BigInt(neuronId);
    const entry = ballots.find(([id]) => BigInt(id) === targetId);
    return entry ? entry[1] : null;
}

/**
 * Format an NNS vote value to display text.
 * NNS: 0=unspecified, 1=yes/adopt, 2=no/reject
 */
export function formatNnsVote(voteNumber) {
    switch (Number(voteNumber)) {
        case 1: return { text: 'Adopt', isYes: true };
        case 2: return { text: 'Reject', isYes: false };
        default: return { text: 'Not Voted', isYes: null };
    }
}

// ============================================================================
// Neuron Helpers
// ============================================================================

/**
 * Fetch the user's NNS neurons (where they are controller or hotkey).
 * Returns full_neurons from the list_neurons response.
 */
export async function fetchUserNnsNeurons(identity) {
    if (!identity) return [];

    try {
        const nnsGovActor = createNnsGovActor(identity);
        const response = await nnsGovActor.list_neurons({
            neuron_ids: [],
            include_neurons_readable_by_caller: true,
            include_empty_neurons_readable_by_caller: [],
            include_public_neurons_in_full_neurons: [],
            neuron_subaccounts: [],
            page_size: [],
            page_number: [],
        });

        return response.full_neurons || [];
    } catch (err) {
        console.error('Error fetching NNS neurons:', err);
        return [];
    }
}

/**
 * Check if a user is a hotkey on an NNS neuron.
 * NNS neurons have hot_keys: [Principal] (array of principals).
 */
export function isNnsHotkeyNeuron(neuron, principalStr) {
    if (!neuron?.hot_keys || !principalStr) return false;
    return neuron.hot_keys.some(hk => safePrincipalString(hk) === principalStr);
}

/**
 * Check if a user is the controller of an NNS neuron.
 */
export function isNnsControllerNeuron(neuron, principalStr) {
    if (!neuron?.controller || !principalStr) return false;
    // controller is Opt Principal -> [Principal] or []
    const controller = Array.isArray(neuron.controller) ? neuron.controller[0] : neuron.controller;
    return safePrincipalString(controller) === principalStr;
}

/**
 * Check if a user has voting access on an NNS neuron (is hotkey or controller).
 */
export function hasNnsVotingAccess(neuron, principalStr) {
    return isNnsHotkeyNeuron(neuron, principalStr) || isNnsControllerNeuron(neuron, principalStr);
}

/**
 * Get the NNS neuron ID as a BigInt.
 */
export function getNnsNeuronId(neuron) {
    if (!neuron?.id) return null;
    const id = Array.isArray(neuron.id) ? neuron.id[0] : neuron.id;
    return id?.id !== undefined ? BigInt(id.id) : null;
}

/**
 * Get voting power for an NNS neuron.
 * Uses deciding_voting_power (already computed by governance canister).
 */
export function getNnsNeuronVotingPower(neuron) {
    if (!neuron) return 0n;

    // deciding_voting_power is Opt Nat64
    const deciding = Array.isArray(neuron.deciding_voting_power)
        ? neuron.deciding_voting_power[0]
        : neuron.deciding_voting_power;
    if (deciding !== undefined && deciding !== null) {
        return BigInt(deciding);
    }

    // Fallback to potential_voting_power
    const potential = Array.isArray(neuron.potential_voting_power)
        ? neuron.potential_voting_power[0]
        : neuron.potential_voting_power;
    if (potential !== undefined && potential !== null) {
        return BigInt(potential);
    }

    // Last resort: raw stake
    return BigInt(neuron.cached_neuron_stake_e8s || 0);
}

/**
 * Get dissolve state info for an NNS neuron.
 */
export function getNnsNeuronDissolveState(neuron) {
    if (!neuron?.dissolve_state) return { state: 'Unknown', seconds: 0 };

    const dissolveState = Array.isArray(neuron.dissolve_state)
        ? neuron.dissolve_state[0]
        : neuron.dissolve_state;

    if (!dissolveState) return { state: 'Unknown', seconds: 0 };

    if (dissolveState.DissolveDelaySeconds !== undefined) {
        const seconds = Number(dissolveState.DissolveDelaySeconds);
        return { state: 'Not Dissolving', seconds, days: Math.floor(seconds / 86400) };
    }

    if (dissolveState.WhenDissolvedTimestampSeconds !== undefined) {
        const timestamp = Number(dissolveState.WhenDissolvedTimestampSeconds);
        const now = Math.floor(Date.now() / 1000);
        if (timestamp <= now) {
            return { state: 'Dissolved', seconds: 0, days: 0 };
        }
        const remaining = timestamp - now;
        return { state: 'Dissolving', seconds: remaining, days: Math.floor(remaining / 86400), dissolveDate: new Date(timestamp * 1000) };
    }

    return { state: 'Unknown', seconds: 0 };
}

/**
 * Format e8s to ICP string.
 */
export function formatIcpE8s(e8s) {
    return (Number(e8s) / 100_000_000).toFixed(4);
}

// ============================================================================
// Voting
// ============================================================================

/**
 * Vote on an NNS proposal with a specific neuron.
 * @param {Object} identity - User identity
 * @param {BigInt|number|string} neuronId - NNS neuron ID (Nat64)
 * @param {BigInt|number|string} proposalId - NNS proposal ID
 * @param {number} vote - 1 = adopt, 2 = reject
 * @returns {Object} - { success: boolean, error?: string }
 */
export async function voteOnNnsProposal(identity, neuronId, proposalId, vote) {
    try {
        const nnsGovActor = createNnsGovActor(identity);

        const response = await nnsGovActor.manage_neuron({
            id: [{ id: BigInt(neuronId) }],
            command: [{
                RegisterVote: {
                    vote: vote,
                    proposal: [{ id: BigInt(proposalId) }]
                }
            }],
            neuron_id_or_subaccount: []
        });

        const command = response?.command?.[0];
        if (command?.RegisterVote !== undefined) {
            return { success: true };
        } else if (command?.Error) {
            return { success: false, error: command.Error.error_message || 'Voting failed' };
        }
        return { success: false, error: 'Unknown voting error' };
    } catch (err) {
        console.error('Error voting on NNS proposal:', err);
        return { success: false, error: err.message || 'Voting failed' };
    }
}

// ============================================================================
// Hotkey Management
// ============================================================================

/**
 * Add a hotkey to an NNS neuron.
 */
export async function addNnsHotkey(identity, neuronId, hotkeyPrincipal) {
    try {
        const { Principal } = await import('@dfinity/principal');
        const nnsGovActor = createNnsGovActor(identity);

        const response = await nnsGovActor.manage_neuron({
            id: [{ id: BigInt(neuronId) }],
            command: [{
                Configure: {
                    operation: [{
                        AddHotKey: { new_hot_key: [Principal.fromText(hotkeyPrincipal)] }
                    }]
                }
            }],
            neuron_id_or_subaccount: []
        });

        const command = response?.command?.[0];
        if (command?.Configure !== undefined) {
            return { success: true };
        } else if (command?.Error) {
            return { success: false, error: command.Error.error_message || 'Failed to add hotkey' };
        }
        return { success: false, error: 'Unknown error adding hotkey' };
    } catch (err) {
        console.error('Error adding NNS hotkey:', err);
        return { success: false, error: err.message || 'Failed to add hotkey' };
    }
}

/**
 * Remove a hotkey from an NNS neuron.
 */
export async function removeNnsHotkey(identity, neuronId, hotkeyPrincipal) {
    try {
        const { Principal } = await import('@dfinity/principal');
        const nnsGovActor = createNnsGovActor(identity);

        const response = await nnsGovActor.manage_neuron({
            id: [{ id: BigInt(neuronId) }],
            command: [{
                Configure: {
                    operation: [{
                        RemoveHotKey: { hot_key_to_remove: [Principal.fromText(hotkeyPrincipal)] }
                    }]
                }
            }],
            neuron_id_or_subaccount: []
        });

        const command = response?.command?.[0];
        if (command?.Configure !== undefined) {
            return { success: true };
        } else if (command?.Error) {
            return { success: false, error: command.Error.error_message || 'Failed to remove hotkey' };
        }
        return { success: false, error: 'Unknown error removing hotkey' };
    } catch (err) {
        console.error('Error removing NNS hotkey:', err);
        return { success: false, error: err.message || 'Failed to remove hotkey' };
    }
}

// ============================================================================
// Known Neurons
// ============================================================================

/**
 * Fetch known neurons from NNS governance.
 */
export async function fetchKnownNeurons(identity) {
    try {
        const nnsGovActor = createNnsGovActor(identity);
        const response = await nnsGovActor.list_known_neurons();
        const map = {};
        for (const kn of (response.known_neurons || [])) {
            const id = kn.id?.[0]?.id;
            const name = kn.known_neuron_data?.[0]?.name;
            if (id !== undefined && name) {
                map[id.toString()] = name;
            }
        }
        return map;
    } catch (err) {
        console.warn('Error fetching known neurons, using fallback:', err);
        return { ...KNOWN_NEURONS_FALLBACK };
    }
}
