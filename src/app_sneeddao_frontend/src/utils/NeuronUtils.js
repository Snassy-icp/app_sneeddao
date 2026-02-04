import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { Principal } from '@dfinity/principal';
import React from 'react';
import { Link } from 'react-router-dom';
import NeuronDisplay from '../components/NeuronDisplay';
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

// Helper function to safely get permission_type as an array
// Handles cases where cache serialization/deserialization might corrupt the type
export const safePermissionType = (permission) => {
    if (!permission?.permission_type) return [];
    const pt = permission.permission_type;
    if (Array.isArray(pt)) return pt;
    // Handle array-like objects (TypedArrays, objects with length)
    if (pt.length !== undefined) return Array.from(pt);
    // Handle plain objects that should have been arrays
    if (typeof pt === 'object') {
        const keys = Object.keys(pt).filter(k => !isNaN(parseInt(k)));
        if (keys.length > 0) {
            return keys.sort((a, b) => parseInt(a) - parseInt(b)).map(k => pt[k]);
        }
    }
    return [];
};

/**
 * Safely extract principal string from various formats
 * Handles:
 * - Real Principal objects (from fresh API calls)
 * - Serialized principals (from IndexedDB/cache as strings)
 * - Dfinity agent format: {"__principal__":"..."}
 * - Our custom format: {"__type":"Principal","value":"..."}
 * - Principal objects with _arr property (internal representation)
 * - Arrays containing a principal (SNS API format): [Principal]
 * 
 * @param {Principal|string|object|array} principal - The principal in any format
 * @returns {string|null} The principal as a string, or null if invalid
 */
export const safePrincipalString = (principal) => {
    if (!principal) return null;
    
    // Handle arrays (SNS API sometimes returns [Principal])
    if (Array.isArray(principal)) {
        if (principal.length === 0) return null;
        return safePrincipalString(principal[0]);
    }
    
    // Already a string
    if (typeof principal === 'string') {
        // Validate it looks like a principal (has dashes)
        return principal.includes('-') ? principal : null;
    }
    
    // Real Principal object with toText method
    if (typeof principal.toText === 'function') {
        return principal.toText();
    }
    
    // Dfinity agent serialized format: {"__principal__":"..."}
    if (principal.__principal__ && typeof principal.__principal__ === 'string') {
        return principal.__principal__;
    }
    
    // Our custom format: {"__type":"Principal","value":"..."}
    if (principal.__type === 'Principal' && principal.value) {
        return principal.value;
    }
    
    // Generic value property
    if (principal.value && typeof principal.value === 'string' && principal.value.includes('-')) {
        return principal.value;
    }
    
    // Handle Principal objects with _arr property (internal byte representation)
    // When a Principal object is serialized to IndexedDB, it loses its methods but keeps _arr
    if (principal._arr !== undefined) {
        try {
            // _arr contains the raw principal bytes
            const arr = principal._arr;
            // Convert to Uint8Array if needed
            const bytes = arr instanceof Uint8Array ? arr : 
                         (Array.isArray(arr) ? new Uint8Array(arr) : 
                          (arr.length !== undefined ? new Uint8Array(Array.from(arr)) : null));
            if (bytes) {
                // Use Principal.fromUint8Array to reconstruct
                const reconstructed = Principal.fromUint8Array(bytes);
                return reconstructed.toText();
            }
        } catch (e) {
            // Reconstruction failed, continue to fallback
            console.warn('[safePrincipalString] Failed to reconstruct from _arr:', e);
        }
    }
    
    // Last resort - try toString but validate result
    if (typeof principal.toString === 'function') {
        const str = principal.toString();
        // Check it's not "[object Object]" and looks like a principal
        if (str && str !== '[object Object]' && str.includes('-')) {
            return str;
        }
    }
    
    return null;
};

// ============================================================================
// NEURON INDEXING ENGINE
// Shared indexing logic for /hub, /users, and anywhere else that needs to 
// compute owner stakes, member counts, etc. from a list of neurons.
// ============================================================================

// Permission type constants
const MANAGE_PRINCIPALS = 2; // ManageVotingPermission = owner-level permission

/**
 * Safely extract principal string from various formats.
 * Handles: Principal object, [Principal] opt array, serialized {_arr} from IndexedDB
 */
export const extractPrincipalString = (principalData) => {
    if (!principalData) return null;
    
    // If it's an array (opt type), get first element
    const principal = Array.isArray(principalData) ? principalData[0] : principalData;
    if (!principal) return null;
    
    // If it has a toString method that returns a valid principal string, use it
    if (typeof principal.toString === 'function') {
        const str = principal.toString();
        // Check if it's a valid principal string (not "[object Object]")
        if (str && !str.includes('[object')) {
            return str;
        }
    }
    
    // If it has toText method (Principal object), use it
    if (typeof principal.toText === 'function') {
        return principal.toText();
    }
    
    // If it has _arr property (serialized from IndexedDB), try to reconstruct
    if (principal._arr) {
        try {
            return Principal.fromUint8Array(new Uint8Array(principal._arr)).toString();
        } catch (e) {
            return null;
        }
    }
    
    // If it's a Uint8Array directly
    if (principal instanceof Uint8Array) {
        try {
            return Principal.fromUint8Array(principal).toString();
        } catch (e) {
            return null;
        }
    }
    
    return null;
};

/**
 * Index neurons by owner principal.
 * Returns an object with owner stakes map and computed stats.
 * 
 * @param {Array} neurons - Array of neuron objects
 * @returns {Object} { ownerStakes: Map<principal, BigInt>, stats: { activeMembers, totalNeurons, uniqueOwners, permissionsProcessed } }
 */
export const indexNeuronsByOwner = (neurons) => {
    if (!neurons || neurons.length === 0) {
        return {
            ownerStakes: new Map(),
            stats: {
                activeMembers: 0,
                totalNeurons: 0,
                uniqueOwners: 0,
                permissionsProcessed: 0
            }
        };
    }
    
    const ownerStakes = new Map();
    let permissionsProcessed = 0;
    
    neurons.forEach(neuron => {
        const stake = BigInt(neuron.cached_neuron_stake_e8s || 0);
        
        neuron.permissions?.forEach(p => {
            permissionsProcessed++;
            const principalStr = extractPrincipalString(p.principal);
            if (!principalStr) return;
            
            // Use safePermissionType to handle serialized/corrupted arrays
            const permTypes = safePermissionType(p);
            if (permTypes.includes(MANAGE_PRINCIPALS)) {
                const currentStake = ownerStakes.get(principalStr) || BigInt(0);
                ownerStakes.set(principalStr, currentStake + stake);
            }
        });
    });
    
    // Count owners with stake > 0 (active members)
    const activeMembers = Array.from(ownerStakes.values()).filter(stake => stake > BigInt(0)).length;
    
    return {
        ownerStakes,
        stats: {
            activeMembers,
            totalNeurons: neurons.length,
            uniqueOwners: ownerStakes.size,
            permissionsProcessed
        }
    };
};

/**
 * Full neuron index for /users page - includes both owner and hotkey data
 * @param {Array} neurons - Array of neuron objects
 * @returns {Array} Array of user data objects with principals, neurons, stakes
 */
export const indexNeuronsForUsers = (neurons) => {
    if (!neurons || neurons.length === 0) {
        return [];
    }
    
    const userMap = new Map();
    
    neurons.forEach(neuron => {
        const neuronId = uint8ArrayToHex(neuron.id?.[0]?.id);
        if (!neuronId) return;
        
        const stake = BigInt(neuron.cached_neuron_stake_e8s || 0);
        const maturity = BigInt(neuron.maturity_e8s_equivalent || 0);
        
        // Build owner set by checking MANAGE_PRINCIPALS permission
        const ownerPrincipals = new Set();
        const allPrincipals = new Set();
        
        neuron.permissions?.forEach(p => {
            const principalStr = extractPrincipalString(p.principal);
            if (!principalStr) return;
            
            allPrincipals.add(principalStr);
            
            // Use safePermissionType to handle serialized/corrupted arrays
            const permTypes = safePermissionType(p);
            if (permTypes.includes(MANAGE_PRINCIPALS)) {
                ownerPrincipals.add(principalStr);
            }
        });
        
        // Update user data for each principal
        allPrincipals.forEach(principal => {
            if (!userMap.has(principal)) {
                userMap.set(principal, {
                    principal,
                    neurons: [],
                    ownedNeurons: [],
                    hotkeyNeurons: [],
                    totalStake: BigInt(0),
                    totalMaturity: BigInt(0),
                    ownedStake: BigInt(0),
                    hotkeyStake: BigInt(0)
                });
            }
            
            const userData = userMap.get(principal);
            userData.neurons.push(neuron);
            userData.totalStake += stake;
            userData.totalMaturity += maturity;
            
            // Track if this is owned or hotkey access
            if (ownerPrincipals.has(principal)) {
                userData.ownedNeurons.push(neuron);
                userData.ownedStake += stake;
            } else {
                userData.hotkeyNeurons.push(neuron);
                userData.hotkeyStake += stake;
            }
        });
    });
    
    return Array.from(userMap.values());
};

// Helper function to find owner principals from neuron permissions
export const getOwnerPrincipals = (neuron) => {
    // Treat principals with MANAGE_PRINCIPALS (aka "ManagePermissions") as owners.
    // SNS NeuronPermissionType enum:
    // 2 = MANAGE_PRINCIPALS
    const MANAGE_PRINCIPALS = 2;

    const owners = new Set();

    const perms = neuron?.permissions || [];
    perms.forEach(permission => {
        if (!permission?.principal) return;
        
        // Use safePrincipalString to handle cached/serialized principals
        const principalStr = safePrincipalString(permission.principal);
        if (!principalStr) return;
        
        // Use safePermissionType to handle cached/serialized permission arrays
        const permArray = safePermissionType(permission);
        if (permArray.includes(MANAGE_PRINCIPALS)) {
            owners.add(principalStr);
        }
    });

    // Fallback to previous heuristic if no explicit owners found.
    if (owners.size === 0) {
        let maxPermissions = 0;
        perms.forEach(permission => {
            if (!permission?.principal) return;
            let permType = permission.permission_type || [];
            if (!Array.isArray(permType)) {
                permType = permType.length !== undefined ? Array.from(permType) : [];
            }
            const permCount = permType.length;
            if (permCount > maxPermissions) {
                maxPermissions = permCount;
                owners.clear();
                owners.add(permission.principal.toString());
            } else if (permCount === maxPermissions) {
                owners.add(permission.principal.toString());
            }
        });
    }

    return Array.from(owners).sort();
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
    const value = Number(e8s) / 100000000;
    // Convert to string with all 8 decimal places
    const str = value.toFixed(8);
    // Remove trailing zeros after decimal point
    const trimmed = str.replace(/\.?0+$/, '');
    // Add commas to the integer part
    const [integerPart, decimalPart] = trimmed.split('.');
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    // Only add decimal part if it exists
    return decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger;
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

// Enhanced neuron display with context menu support
export const formatNeuronDisplayWithContext = (neuronId, snsRoot, displayInfo = null, options = {}) => {
    const {
        showCopyButton = true,
        enableContextMenu = true,
        isAuthenticated = false,
        onNicknameUpdate = null,
        style = {},
        noLink = false
    } = options;

    return React.createElement(NeuronDisplay, {
        neuronId,
        snsRoot,
        displayInfo,
        showCopyButton,
        enableContextMenu,
        isAuthenticated,
        onNicknameUpdate,
        style,
        noLink
    });
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
export const fetchUserNeuronsForSns = async (identity, snsGovernanceCanisterId) => { 
    if (!identity) return [];
    return fetchPrincipalNeuronsForSns(identity, snsGovernanceCanisterId, identity.getPrincipal().toString()); 
}

export const fetchPrincipalNeuronsForSns = async (identity, snsGovernanceCanisterId, principalId) => {
    if (!snsGovernanceCanisterId || !principalId) return [];
    
    try {
        // Create an agent
        const agent = identity ? 
            new HttpAgent({ identity }) : 
            new HttpAgent();

        if (process.env.DFX_NETWORK !== 'ic') {
            await agent.fetchRootKey();
        }

        const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
            agentOptions: { agent }
        });
        
        // Map to store all unique neurons by their ID
        const neuronsById = new Map();
        
        // Set to track which principals we've already fetched neurons for
        const fetchedPrincipals = new Set([principalId]);
        
        // First get all neurons where the user is a hotkey
        const hotkeyResult = await snsGovActor.list_neurons({
            of_principal: [Principal.fromText(principalId)],
            limit: 100,
            start_page_at: []
        });
        
        // Add all hotkeyed neurons to our map
        for (const neuron of hotkeyResult.neurons) {
            const neuronId = getNeuronId(neuron);
            if (neuronId) {
                neuronsById.set(neuronId, neuron);
                
                // Get owner principals for this neuron
                const ownerPrincipals = getOwnerPrincipals(neuron);
                // Add any owner principals we haven't fetched yet
                for (const ownerPrincipal of ownerPrincipals) {
                    if (!fetchedPrincipals.has(ownerPrincipal)) {
                        fetchedPrincipals.add(ownerPrincipal);
                        
                        // Fetch neurons for this owner
                        const ownerResult = await snsGovActor.list_neurons({
                            of_principal: [Principal.fromText(ownerPrincipal)],
                            limit: 100,
                            start_page_at: []
                        });
                        
                        // Add any new neurons we find
                        for (const ownerNeuron of ownerResult.neurons) {
                            const ownerNeuronId = getNeuronId(ownerNeuron);
                            if (ownerNeuronId && !neuronsById.has(ownerNeuronId)) {
                                neuronsById.set(ownerNeuronId, ownerNeuron);
                            }
                        }
                    }
                }
            }
        }
        
        return Array.from(neuronsById.values());
        
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