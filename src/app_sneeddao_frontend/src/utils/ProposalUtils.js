/**
 * Proposal Utility Functions
 * 
 * Contains reusable functions for determining proposal voting status,
 * accounting for the wait-for-quiet mechanism and reward periods.
 */

/**
 * Determines if a proposal is still accepting votes.
 * 
 * IMPORTANT: A proposal can be executed/decided AND still accept votes!
 * The voting period is independent of execution status because:
 * - Voters earn rewards for participating during the full voting window
 * - The wait-for-quiet mechanism can extend the deadline
 * 
 * Priority of checks:
 * 1. deadline_timestamp_seconds - Most accurate, includes wait-for-quiet extensions
 * 2. reward_status - 1 = ACCEPT_VOTES, 2 = READY_TO_SETTLE, 3 = SETTLED
 * 3. Fallback: initial_voting_period_seconds from creation (less accurate)
 * 
 * @param {Object} proposalData - The proposal data object
 * @param {number} [currentTimeSeconds] - Optional current time in seconds (for testing)
 * @returns {boolean} - True if the proposal accepts votes, false otherwise
 */
export const isProposalAcceptingVotes = (proposalData, currentTimeSeconds = null) => {
    if (!proposalData) return false;
    
    try {
        const now = currentTimeSeconds !== null 
            ? BigInt(currentTimeSeconds) 
            : BigInt(Math.floor(Date.now() / 1000));
        
        // Priority 1: Use deadline_timestamp_seconds if available
        // This is the most accurate as it accounts for wait-for-quiet extensions
        if (proposalData.deadline_timestamp_seconds !== undefined && 
            proposalData.deadline_timestamp_seconds !== null) {
            const deadline = BigInt(proposalData.deadline_timestamp_seconds);
            return now < deadline;
        }
        
        // Also check for SNS format (current_deadline_timestamp_seconds in wait_for_quiet_state)
        if (proposalData.wait_for_quiet_state?.current_deadline_timestamp_seconds !== undefined) {
            const deadline = BigInt(proposalData.wait_for_quiet_state.current_deadline_timestamp_seconds);
            return now < deadline;
        }
        
        // Priority 2: Check reward_status
        // 1 = ACCEPT_VOTES (still accepting votes)
        // 2 = READY_TO_SETTLE (voting closed, calculating rewards)
        // 3 = SETTLED (rewards distributed, fully closed)
        if (proposalData.reward_status !== undefined && proposalData.reward_status !== null) {
            return Number(proposalData.reward_status) === 1;
        }
        
        // Priority 3: Fallback to initial voting period calculation
        // Note: This is LESS ACCURATE because it doesn't account for wait-for-quiet extensions
        // The actual deadline could be up to 8 days from creation (vs initial 4 days)
        const created = BigInt(proposalData.proposal_creation_timestamp_seconds || 
                               proposalData.proposal_timestamp_seconds || 0);
        const votingPeriod = BigInt(proposalData.initial_voting_period_seconds || 0);
        
        if (created > 0n && votingPeriod > 0n) {
            // Add a buffer for potential wait-for-quiet extensions
            // Initial period is typically 4 days, can extend to 8 days
            // We err on the side of showing voting buttons
            const maxExtension = votingPeriod; // Double the initial period as safety margin
            return created + votingPeriod + maxExtension > now;
        }
        
        // If we can't determine, err on the side of showing voting buttons
        // (false negative is worse than false positive)
        return true;
        
    } catch (err) {
        console.error('Error checking if proposal accepts votes:', err);
        // Err on the side of showing voting buttons
        return true;
    }
};

/**
 * Gets a human-readable proposal status string.
 * Now correctly distinguishes between execution status and voting status.
 * 
 * @param {Object} proposalData - The proposal data object
 * @returns {string} - Status string like 'Executed (Voting Open)', 'Open for Voting', etc.
 */
export const getProposalStatus = (proposalData) => {
    if (!proposalData) return 'Unknown';
    
    try {
        const executed = BigInt(proposalData.executed_timestamp_seconds || 0);
        const failed = BigInt(proposalData.failed_timestamp_seconds || 0);
        const decided = BigInt(proposalData.decided_timestamp_seconds || 0);
        
        const isVotingOpen = isProposalAcceptingVotes(proposalData);
        
        // Determine execution/decision status
        let executionStatus = '';
        if (executed > 0n) {
            executionStatus = 'Executed';
        } else if (failed > 0n) {
            executionStatus = 'Failed';
        } else if (decided > 0n) {
            executionStatus = 'Decided';
        }
        
        // Combine execution status with voting status
        if (executionStatus) {
            if (isVotingOpen) {
                return `${executionStatus} (Voting Open)`;
            } else {
                return `${executionStatus} (Voting Closed)`;
            }
        }
        
        // No execution status yet
        if (isVotingOpen) {
            return 'Open for Voting';
        }
        
        return 'Voting Closed';
        
    } catch (err) {
        console.error('Error in getProposalStatus:', err);
        return 'Unknown';
    }
};

/**
 * Gets a simplified proposal status for display (without voting suffix).
 * Use this when you need just the execution state.
 * 
 * @param {Object} proposalData - The proposal data object
 * @returns {string} - Simple status: 'Executed', 'Failed', 'Decided', 'Open', or 'Unknown'
 */
export const getProposalExecutionStatus = (proposalData) => {
    if (!proposalData) return 'Unknown';
    
    try {
        const executed = BigInt(proposalData.executed_timestamp_seconds || 0);
        const failed = BigInt(proposalData.failed_timestamp_seconds || 0);
        const decided = BigInt(proposalData.decided_timestamp_seconds || 0);
        
        if (executed > 0n) return 'Executed';
        if (failed > 0n) return 'Failed';
        if (decided > 0n) return 'Decided';
        return 'Open';
        
    } catch (err) {
        console.error('Error in getProposalExecutionStatus:', err);
        return 'Unknown';
    }
};

/**
 * Gets the voting deadline timestamp for a proposal.
 * Returns the deadline accounting for wait-for-quiet extensions.
 * 
 * @param {Object} proposalData - The proposal data object
 * @returns {bigint|null} - Deadline timestamp in seconds, or null if unknown
 */
export const getProposalVotingDeadline = (proposalData) => {
    if (!proposalData) return null;
    
    try {
        // Priority 1: deadline_timestamp_seconds (includes wait-for-quiet)
        if (proposalData.deadline_timestamp_seconds !== undefined && 
            proposalData.deadline_timestamp_seconds !== null) {
            return BigInt(proposalData.deadline_timestamp_seconds);
        }
        
        // Priority 2: SNS format with wait_for_quiet_state
        if (proposalData.wait_for_quiet_state?.current_deadline_timestamp_seconds !== undefined) {
            return BigInt(proposalData.wait_for_quiet_state.current_deadline_timestamp_seconds);
        }
        
        // Fallback: Calculate from creation + initial period
        const created = BigInt(proposalData.proposal_creation_timestamp_seconds || 
                               proposalData.proposal_timestamp_seconds || 0);
        const votingPeriod = BigInt(proposalData.initial_voting_period_seconds || 0);
        
        if (created > 0n && votingPeriod > 0n) {
            return created + votingPeriod;
        }
        
        return null;
        
    } catch (err) {
        console.error('Error getting proposal voting deadline:', err);
        return null;
    }
};

/**
 * Formats the remaining time until voting closes.
 * 
 * @param {Object} proposalData - The proposal data object
 * @returns {string} - Human readable time remaining, or empty string if closed/unknown
 */
export const getVotingTimeRemaining = (proposalData) => {
    const deadline = getProposalVotingDeadline(proposalData);
    if (!deadline) return '';
    
    const now = BigInt(Math.floor(Date.now() / 1000));
    
    if (now >= deadline) {
        return 'Voting closed';
    }
    
    const remainingSeconds = Number(deadline - now);
    
    const days = Math.floor(remainingSeconds / (24 * 60 * 60));
    const hours = Math.floor((remainingSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((remainingSeconds % (60 * 60)) / 60);
    
    if (days > 0) {
        return `${days}d ${hours}h remaining`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m remaining`;
    } else if (minutes > 0) {
        return `${minutes}m remaining`;
    } else {
        return 'Less than 1m remaining';
    }
};

/**
 * ProposalRewardStatus enum values for reference
 */
export const ProposalRewardStatus = {
    UNKNOWN: 0,
    ACCEPT_VOTES: 1,
    READY_TO_SETTLE: 2,
    SETTLED: 3
};

/**
 * Gets the reward status as a human-readable string.
 * 
 * @param {number} rewardStatus - The reward_status field value
 * @returns {string} - Human readable reward status
 */
export const getRewardStatusString = (rewardStatus) => {
    switch (Number(rewardStatus)) {
        case ProposalRewardStatus.UNKNOWN:
            return 'Unknown';
        case ProposalRewardStatus.ACCEPT_VOTES:
            return 'Accepting Votes';
        case ProposalRewardStatus.READY_TO_SETTLE:
            return 'Ready to Settle';
        case ProposalRewardStatus.SETTLED:
            return 'Settled';
        default:
            return 'Unknown';
    }
};
