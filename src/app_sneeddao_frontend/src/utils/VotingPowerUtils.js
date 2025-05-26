/**
 * Voting Power Calculator - JavaScript translation of the Motoko VP calculation
 * Based on the VP.md reference implementation
 */

export class VotingPowerCalculator {
    constructor() {
        this.params = null;
        // Parameter-derived values
        this.minDissolveDelay = 604800; // 7 days in seconds
        this.maxDissolveDelay = 2628000; // ~1 month in seconds
        this.maxAge = 0;
        this.maxDissolveBonus = 0;
        this.maxAgeBonus = 0;
    }

    /**
     * Set the nervous system parameters for voting power calculation
     * @param {Object} nervousSystemParameters - The SNS nervous system parameters
     */
    setParams(nervousSystemParameters) {
        this.params = nervousSystemParameters;
        
        if (!nervousSystemParameters) {
            this.minDissolveDelay = 0;
            this.maxDissolveDelay = 0;
            this.maxAge = 0;
            this.maxDissolveBonus = 0;
            this.maxAgeBonus = 0;
            return;
        }

        // Extract parameter values, handling optional fields
        this.minDissolveDelay = nervousSystemParameters.neuron_minimum_dissolve_delay_to_vote_seconds?.[0] 
            ? Number(nervousSystemParameters.neuron_minimum_dissolve_delay_to_vote_seconds[0]) 
            : 0;
            
        this.maxDissolveDelay = nervousSystemParameters.max_dissolve_delay_seconds?.[0]
            ? Number(nervousSystemParameters.max_dissolve_delay_seconds[0])
            : 0;
            
        this.maxAge = nervousSystemParameters.max_neuron_age_for_age_bonus?.[0]
            ? Number(nervousSystemParameters.max_neuron_age_for_age_bonus[0])
            : 0;
            
        this.maxDissolveBonus = nervousSystemParameters.max_dissolve_delay_bonus_percentage?.[0]
            ? Number(nervousSystemParameters.max_dissolve_delay_bonus_percentage[0])
            : 0;
            
        this.maxAgeBonus = nervousSystemParameters.max_age_bonus_percentage?.[0]
            ? Number(nervousSystemParameters.max_age_bonus_percentage[0])
            : 0;
    }

    /**
     * Calculate the voting power for a neuron
     * @param {Object} neuron - The neuron object with required fields
     * @returns {number} - The calculated voting power
     */
    getVotingPower(neuron) {
        // If no stake, no voting power
        if (!neuron.cached_neuron_stake_e8s || Number(neuron.cached_neuron_stake_e8s) === 0) {
            return 0;
        }

        // Calculate total stake (cached stake + staked maturity)
        const cachedStake = Number(neuron.cached_neuron_stake_e8s);
        const stakedMaturity = neuron.staked_maturity_e8s_equivalent?.[0] 
            ? Number(neuron.staked_maturity_e8s_equivalent[0])
            : 0;
        const stake = cachedStake + stakedMaturity;

        // Calculate dissolve delay
        let dissolveDelay = 0;
        if (neuron.dissolve_state?.[0]) {
            const dissolveState = neuron.dissolve_state[0];
            
            if (dissolveState.DissolveDelaySeconds !== undefined) {
                dissolveDelay = Number(dissolveState.DissolveDelaySeconds);
            } else if (dissolveState.WhenDissolvedTimestampSeconds !== undefined) {
                const dissolveTimestamp = Number(dissolveState.WhenDissolvedTimestampSeconds);
                const now = Math.floor(Date.now() / 1000); // Current time in seconds
                
                if (dissolveTimestamp > now) {
                    dissolveDelay = dissolveTimestamp - now;
                } else {
                    dissolveDelay = 0; // Already dissolved
                }
            }
        }

        // If dissolve delay is below minimum, no voting power
        if (dissolveDelay < this.minDissolveDelay) {
            return 0;
        }

        // Calculate age
        const now = Math.floor(Date.now() / 1000);
        const agingSeconds = Number(neuron.aging_since_timestamp_seconds || 0);
        
        // Add safety check to prevent underflow
        const age = agingSeconds > now ? 0 : now - agingSeconds;

        // Cap values to their maximums
        const cappedDissolveDelay = Math.min(dissolveDelay, this.maxDissolveDelay);
        const cappedAge = Math.min(age, this.maxAge);

        // Calculate dissolve bonus
        let dissolveBonus = 0;
        if (this.maxDissolveDelay > 0 && cappedDissolveDelay > 0) {
            dissolveBonus = Math.floor((stake * cappedDissolveDelay * this.maxDissolveBonus) / (100 * this.maxDissolveDelay));
        }
        const stakeWithDissolveBonus = stake + dissolveBonus;

        // Calculate age bonus
        let ageBonus = 0;
        if (this.maxAge > 0 && cappedAge > 0) {
            ageBonus = Math.floor((stakeWithDissolveBonus * cappedAge * this.maxAgeBonus) / (100 * this.maxAge));
        }
        const stakeWithAllBonuses = stakeWithDissolveBonus + ageBonus;

        // Apply voting power multiplier
        const multiplier = Number(neuron.voting_power_percentage_multiplier || 0);
        if (multiplier > 0) {
            return Math.floor((stakeWithAllBonuses * multiplier) / 100);
        } else {
            return 0;
        }
    }
}

// Global instance for easy access
let globalVpCalculator = null;

/**
 * Get or create the global voting power calculator instance
 * @returns {VotingPowerCalculator}
 */
export function getVotingPowerCalculator() {
    if (!globalVpCalculator) {
        globalVpCalculator = new VotingPowerCalculator();
    }
    return globalVpCalculator;
}

/**
 * Calculate voting power for a neuron using the global calculator
 * @param {Object} neuron - The neuron object
 * @param {Object} nervousSystemParameters - Optional parameters to set
 * @returns {number} - The calculated voting power
 */
export function calculateVotingPower(neuron, nervousSystemParameters = null) {
    const calculator = getVotingPowerCalculator();
    
    if (nervousSystemParameters) {
        calculator.setParams(nervousSystemParameters);
    }
    
    return calculator.getVotingPower(neuron);
}

/**
 * Format voting power for display
 * @param {number} votingPower - The voting power value
 * @returns {string} - Formatted voting power string
 */
export function formatVotingPower(votingPower) {
    if (votingPower === 0) return '0';
    
    // Convert from e8s to display units and format with commas
    const displayValue = votingPower / 100_000_000;
    return displayValue.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
} 