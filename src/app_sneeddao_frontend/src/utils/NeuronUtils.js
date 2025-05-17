import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { Principal } from '@dfinity/principal';
import React from 'react';
import { Link } from 'react-router-dom';

// Helper function to convert Uint8Array to hex string
export const uint8ArrayToHex = (array) => {
    if (!array) return null;
    return Array.from(array)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

// Helper function to convert hex string to Uint8Array
export const hexToUint8Array = (hex) => {
    if (!hex) return null;
    return new Uint8Array(
        hex.match(/.{1,2}/g)
            .map(byte => parseInt(byte, 16))
    );
};

// Helper function to get neuron ID as string
export const getNeuronId = (neuron) => {
    if (!neuron.id || !neuron.id[0] || !neuron.id[0].id) return null;
    return uint8ArrayToHex(neuron.id[0].id);
};

// Helper function to find owner principals from neuron permissions
export const getOwnerPrincipals = (neuron) => {
    const owners = new Set();
    // Look for principals with the most permissions
    let maxPermissions = 0;
    
    neuron.permissions.forEach(permission => {
        if (permission.principal) {
            const permCount = permission.permission_type.length;
            if (permCount > maxPermissions) {
                maxPermissions = permCount;
                owners.clear();
                owners.add(permission.principal.toString());
            } else if (permCount === maxPermissions) {
                owners.add(permission.principal.toString());
            }
        }
    });
    
    return Array.from(owners);
};

// Helper function to format dissolve state
export const getDissolveState = (neuron) => {
    if (!neuron.dissolve_state?.[0]) return 'Unknown';
    
    if ('DissolveDelaySeconds' in neuron.dissolve_state[0]) {
        const seconds = Number(neuron.dissolve_state[0].DissolveDelaySeconds);
        const days = Math.floor(seconds / (24 * 60 * 60));
        return `Locked for ${days} days`;
    }
    
    if ('WhenDissolvedTimestampSeconds' in neuron.dissolve_state[0]) {
        const dissolveTime = Number(neuron.dissolve_state[0].WhenDissolvedTimestampSeconds);
        const now = Math.floor(Date.now() / 1000);
        if (dissolveTime <= now) {
            return 'Dissolved';
        }
        const daysLeft = Math.floor((dissolveTime - now) / (24 * 60 * 60));
        return `Dissolving (${daysLeft} days left)`;
    }
    
    return 'Unknown';
};

// Helper function to format e8s values
export const formatE8s = (e8s) => {
    if (!e8s) return '0';
    return (Number(e8s) / 100000000).toFixed(8);
};

// Helper function to format vote
export const formatVote = (voteNumber) => {
    switch (voteNumber) {
        case 1:
            return 'Yes';
        case 2:
            return 'No';
        default:
            return 'Not Voted';
    }
};

// Create a React link component for a neuron ID
export const formatNeuronIdLink = (neuronId, snsRoot, getNeuronDisplayNameFn) => {
    if (!neuronId) return 'Unknown';
    
    // Convert the neuron ID to a hex string if it's a byte array
    const displayId = Array.isArray(neuronId) || neuronId instanceof Uint8Array 
        ? uint8ArrayToHex(neuronId)
        : neuronId;

    // Get the display name from either the provided function or the global one
    const displayName = getNeuronDisplayNameFn 
        ? getNeuronDisplayNameFn(displayId, snsRoot)
        : window.getNeuronDisplayName?.(displayId, snsRoot);

    return React.createElement(Link, {
        to: `/neuron?neuronid=${displayId}&sns=${snsRoot}`,
        style: {
            color: '#3498db',
            textDecoration: 'none',
            fontFamily: 'monospace'
        },
        onMouseEnter: (e) => e.target.style.textDecoration = 'underline',
        onMouseLeave: (e) => e.target.style.textDecoration = 'none'
    }, displayName || displayId);
};

// Create a React link component for a proposal ID
export const formatProposalIdLink = (proposalId, snsRoot) => {
    if (!proposalId) return 'Unknown';
    
    return React.createElement(Link, {
        to: `/proposal?proposalid=${proposalId}&sns=${snsRoot}`,
        style: {
            color: '#3498db',
            textDecoration: 'none'
        },
        onMouseEnter: (e) => e.target.style.textDecoration = 'underline',
        onMouseLeave: (e) => e.target.style.textDecoration = 'none'
    }, `#${proposalId}`);
};

// Keep track of principals we've already fetched neurons for
const fetchedPrincipals = new Set();

// Main function to fetch user neurons for a specific SNS
export const fetchUserNeuronsForSns = async (identity, snsGovernanceCanisterId) => {
    if (!identity || !snsGovernanceCanisterId) return [];
    
    try {
        const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
            agentOptions: { identity }
        });

        // Clear the set of fetched principals for this new request
        fetchedPrincipals.clear();
        
        // Start with the user's principal
        const userPrincipal = identity.getPrincipal().toString();
        fetchedPrincipals.add(userPrincipal);
        
        // Initialize result map to store unique neurons by ID
        const neuronsMap = new Map();
        
        // Queue of principals to fetch neurons for
        let principalsToFetch = [userPrincipal];
        
        // Process each principal in the queue
        while (principalsToFetch.length > 0) {
            const currentPrincipal = principalsToFetch.shift();
            
            // Fetch neurons for the current principal
            const result = await snsGovActor.list_neurons({
                of_principal: [Principal.fromText(currentPrincipal)],
                limit: 100,
                start_page_at: []
            });
            
            // Add these neurons to our map, deduplicating by ID
            for (const neuron of result.neurons) {
                const neuronId = getNeuronId(neuron);
                if (neuronId) {
                    neuronsMap.set(neuronId, neuron);
                }
                
                // Find owner principals and add to queue
                const ownerPrincipals = getOwnerPrincipals(neuron);
                for (const ownerPrincipal of ownerPrincipals) {
                    if (!fetchedPrincipals.has(ownerPrincipal)) {
                        fetchedPrincipals.add(ownerPrincipal);
                        principalsToFetch.push(ownerPrincipal);
                    }
                }
            }
        }
        
        return Array.from(neuronsMap.values());
    } catch (error) {
        console.error('Error fetching neurons from SNS:', error);
        return [];
    }
};

// Function to get a single neuron's details
export const getNeuronDetails = async (identity, snsGovernanceCanisterId, neuronId) => {
    if (!identity || !snsGovernanceCanisterId || !neuronId) return null;
    
    try {
        const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
            agentOptions: { identity }
        });

        // Convert the hex string neuron ID to a byte array if it's not already
        const neuronIdBytes = typeof neuronId === 'string' ? 
            hexToUint8Array(neuronId) : 
            neuronId;

        const response = await snsGovActor.get_neuron({
            neuron_id: [{ id: Array.from(neuronIdBytes) }]
        });

        if (response?.result?.[0]?.Neuron) {
            return response.result[0].Neuron;
        }
        
        return null;
    } catch (error) {
        console.error('Error fetching neuron details:', error);
        return null;
    }
};

// Legacy function for backward compatibility - uses default SNS
export const fetchUserNeurons = async (identity) => {
    // This is the default SNS governance canister ID (Sneed)
    const defaultSnsGovernanceCanisterId = 'fp274-iaaaa-aaaaq-aacha-cai';
    return fetchUserNeuronsForSns(identity, defaultSnsGovernanceCanisterId);
}; 