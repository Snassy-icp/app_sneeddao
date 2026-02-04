import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import { useNeurons } from '../contexts/NeuronsContext';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { calculateVotingPower } from '../utils/VotingPowerUtils';
import { getSnsById } from '../utils/SnsUtils';
import { safePrincipalString, safePermissionType } from '../utils/NeuronUtils';

/**
 * Hook to check if the current user is a Sneed DAO member
 * A member is defined as someone with hotkeyed Sneed neurons and Voting Power > 0
 * 
 * @returns {Object} Membership state and data
 * - isSneedMember: boolean - true if user has VP > 0 from hotkeyed Sneed neurons
 * - sneedNeurons: array - list of hotkeyed Sneed neurons
 * - sneedVotingPower: number - total voting power from hotkeyed neurons
 * - loading: boolean - true while checking membership
 * - error: string|null - error message if check failed
 * - refresh: function - manually refresh membership status
 */
export function useSneedMembership() {
    const { identity, isAuthenticated } = useAuth();
    const { SNEED_SNS_ROOT } = useSns();
    const { fetchNeuronsForSns } = useNeurons();
    
    const [sneedNeurons, setSneedNeurons] = useState([]);
    const [sneedNervousSystemParams, setSneedNervousSystemParams] = useState(null);
    const [sneedVotingPower, setSneedVotingPower] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchSneedMembership = useCallback(async () => {
        if (!identity || !SNEED_SNS_ROOT) {
            setSneedNeurons([]);
            setSneedVotingPower(0);
            setError(null);
            return;
        }

        setLoading(true);
        setError(null);
        
        try {
            // Fetch neurons for Sneed SNS
            const neurons = await fetchNeuronsForSns(SNEED_SNS_ROOT);
            
            // Filter to only hotkeyed neurons (where user has hotkey permission)
            const userPrincipalStr = identity.getPrincipal().toString();
            const hotkeyNeurons = neurons.filter(neuron => {
                return neuron.permissions?.some(p => {
                    const permPrincipal = safePrincipalString(p.principal);
                    if (!permPrincipal || permPrincipal !== userPrincipalStr) return false;
                    const permTypes = safePermissionType(p);
                    return permTypes.includes(4); // Hotkey permission
                });
            });
            
            setSneedNeurons(hotkeyNeurons);

            // Fetch nervous system parameters for VP calculation
            const sneedSns = getSnsById(SNEED_SNS_ROOT);
            if (sneedSns) {
                const snsGovActor = createSnsGovernanceActor(sneedSns.canisters.governance, {
                    agentOptions: { identity }
                });
                const params = await snsGovActor.get_nervous_system_parameters(null);
                setSneedNervousSystemParams(params);

                // Calculate total voting power from hotkeyed Sneed neurons
                const totalVP = hotkeyNeurons.reduce((total, neuron) => {
                    try {
                        const vp = calculateVotingPower(neuron, params);
                        return total + vp;
                    } catch (err) {
                        console.warn('Error calculating VP for neuron:', err);
                        return total;
                    }
                }, 0);
                setSneedVotingPower(totalVP);
            }
        } catch (err) {
            console.error('Error fetching Sneed membership:', err);
            setSneedNeurons([]);
            setSneedVotingPower(0);
            setError(err.message || 'Failed to check membership');
        } finally {
            setLoading(false);
        }
    }, [identity, SNEED_SNS_ROOT, fetchNeuronsForSns]);

    // Effect to fetch Sneed membership when authenticated
    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchSneedMembership();
        } else {
            setSneedNeurons([]);
            setSneedVotingPower(0);
            setError(null);
        }
    }, [isAuthenticated, identity, fetchSneedMembership]);

    return {
        isSneedMember: sneedVotingPower > 0,
        sneedNeurons,
        sneedVotingPower,
        sneedNervousSystemParams,
        loading,
        error,
        refresh: fetchSneedMembership
    };
}

export default useSneedMembership;

