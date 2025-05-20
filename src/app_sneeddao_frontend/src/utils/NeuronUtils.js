import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { Principal } from '@dfinity/principal';
import React from 'react';
import { Link } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';

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

// Helper function to generate a consistent color from a neuron ID
export const getNeuronColor = (neuronId) => {
    // Simple hash function that sums char codes multiplied by position
    let hash = 0;
    for (let i = 0; i < neuronId.length; i++) {
        hash = ((hash << 5) - hash) + neuronId.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }

    // Generate HSL color with:
    // - Hue: full range (0-360) for maximum distinction
    // - Saturation: 60-80% for good color without being too bright
    // - Lightness: 45-65% for good contrast on both dark and light backgrounds
    const hue = Math.abs(hash % 360);
    const saturation = 70 + (Math.abs((hash >> 8) % 11)); // 70-80%
    const lightness = 55 + (Math.abs((hash >> 16) % 11)); // 55-65%

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// Create a React link component for a neuron ID
export const formatNeuronIdLink = (neuronId, snsRoot, getNeuronDisplayNameFn) => {
    if (!neuronId) return 'Unknown';
    
    // Convert the neuron ID to a hex string if it's a byte array
    const displayId = Array.isArray(neuronId) || neuronId instanceof Uint8Array 
        ? uint8ArrayToHex(neuronId)
        : typeof neuronId === 'string' 
            ? neuronId 
            : neuronId.toString();

    if (!displayId) return 'Unknown';

    // Get the display name from either the provided function or the global one
    const { name, nickname, isVerified } = getNeuronDisplayNameFn 
        ? getNeuronDisplayNameFn(displayId, snsRoot)
        : window.getNeuronDisplayName?.(displayId, snsRoot) || {};

    // Create truncated ID display (first 6 and last 6 chars)
    const truncatedId = `${displayId.slice(0, 6)}...${displayId.slice(-6)}`;

    // Get consistent color for this neuron ID
    const neuronColor = getNeuronColor(displayId);

    // Create container div for link and copy button
    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            flexWrap: 'wrap',
            width: '100%'
        }
    }, [
        // Link with name and truncated ID
        React.createElement(Link, {
            key: 'link',
            to: `/neuron?neuronid=${displayId}&sns=${snsRoot}`,
            style: {
                color: neuronColor,
                textDecoration: 'none',
                fontFamily: 'monospace',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '4px',
                flexWrap: 'wrap',
                flex: '1'
            },
            title: displayId,
            onMouseEnter: (e) => e.target.style.textDecoration = 'underline',
            onMouseLeave: (e) => e.target.style.textDecoration = 'none'
        },
            // If there's a name, show it with verification badge
            name && React.createElement('span', {
                key: 'name-container',
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: neuronColor,
                    fontWeight: 'bold',
                    flexWrap: 'wrap'
                }
            }, [
                isVerified && React.createElement('span', {
                    key: 'verified',
                    style: { 
                        color: '#2ecc71',
                        cursor: 'help',
                        fontSize: '14px'
                    },
                    title: 'Verified neuron name'
                }, '✓'),
                name
            ]),
            
            // If there's a nickname and it's different from the name, show it
            nickname && (!name || nickname !== name) && React.createElement('span', {
                key: 'nickname',
                style: {
                    color: neuronColor,
                    fontStyle: 'italic'
                }
            }, `(${nickname})`),
            
            // Always show the truncated ID
            React.createElement('span', {
                key: 'id',
                style: {
                    color: neuronColor,
                    opacity: 0.7
                }
            }, `[${truncatedId}]`)
        ),
        
        // Copy button
        React.createElement('button', {
            key: 'copy',
            onClick: (e) => {
                e.preventDefault();
                navigator.clipboard.writeText(displayId);
            },
            style: {
                background: 'none',
                border: 'none',
                padding: '4px',
                cursor: 'pointer',
                color: '#888',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0
            },
            title: 'Copy neuron ID to clipboard'
        }, '📋')
    ]);
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

// Keep track of principals we've already fetched neurons for, per SNS
const fetchedPrincipalsBySns = new Map();

// Keep track of neurons we've fetched, per SNS
const neuronsBySns = new Map();

// Main function to fetch user neurons for a specific SNS
export const fetchUserNeuronsForSns = async (identity, snsGovernanceCanisterId) => { return fetchPrincipalNeuronsForSns(identity, snsGovernanceCanisterId, identity?.getPrincipal().toString()); }

export const fetchPrincipalNeuronsForSns = async (identity, snsGovernanceCanisterId, principalId) => {
    if (!snsGovernanceCanisterId) return [];
    
    try {
        // Get or create the caches for this SNS
        if (!fetchedPrincipalsBySns.has(snsGovernanceCanisterId)) {
            fetchedPrincipalsBySns.set(snsGovernanceCanisterId, new Set());
        }
        if (!neuronsBySns.has(snsGovernanceCanisterId)) {
            neuronsBySns.set(snsGovernanceCanisterId, new Map());
        }
        const fetchedPrincipals = fetchedPrincipalsBySns.get(snsGovernanceCanisterId);
        const neuronsMap = neuronsBySns.get(snsGovernanceCanisterId);

        // If we have neurons cached and the principal has been fetched, return cached neurons
        if (neuronsMap.size > 0 && (!principalId || fetchedPrincipals.has(principalId))) {
            return Array.from(neuronsMap.values());
        }

        // Create an anonymous agent if no identity is provided
        const agent = identity ? 
            new HttpAgent({ identity }) : 
            new HttpAgent();

        if (process.env.DFX_NETWORK !== 'ic') {
            await agent.fetchRootKey();
        }

        const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
            agentOptions: { agent }
        });
        
        let principalsToFetch = [];
        if (principalId) {
            if (!fetchedPrincipals.has(principalId)) {
                fetchedPrincipals.add(principalId);
                principalsToFetch.push(principalId);
            }
        }
        
        // If we have no principals to fetch (anonymous), just fetch all neurons
        if (principalsToFetch.length === 0 && neuronsMap.size === 0) {
            const result = await snsGovActor.list_neurons({
                of_principal: [], // Empty array means fetch all neurons
                limit: 100,
                start_page_at: []
            });
            
            // Add these neurons to our map, deduplicating by ID
            for (const neuron of result.neurons) {
                const neuronId = getNeuronId(neuron);
                if (neuronId) {
                    neuronsMap.set(neuronId, neuron);
                }
            }
        } else {
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
                    
                    // Find owner principals and add to queue if not already fetched
                    const ownerPrincipals = getOwnerPrincipals(neuron);
                    for (const ownerPrincipal of ownerPrincipals) {
                        if (!fetchedPrincipals.has(ownerPrincipal)) {
                            fetchedPrincipals.add(ownerPrincipal);
                            principalsToFetch.push(ownerPrincipal);
                        }
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