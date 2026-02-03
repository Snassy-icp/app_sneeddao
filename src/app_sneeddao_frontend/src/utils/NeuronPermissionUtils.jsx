// Neuron permission utilities - shared across components
import React from 'react';
import { FaCrown, FaKey, FaVoteYea, FaBolt, FaBriefcase, FaWrench, FaLock, FaHourglassHalf, FaUnlock, FaQuestion } from 'react-icons/fa';
import { normalizeId } from '../hooks/useNeuronsCache';

// SNS Neuron Permission Types
// Official source: https://github.com/dfinity/ic/blob/master/rs/sns/governance/proto/ic_sns_governance.proto
export const PERM = {
    UNSPECIFIED: 0,
    CONFIGURE_DISSOLVE_STATE: 1,
    MANAGE_PRINCIPALS: 2,
    SUBMIT_PROPOSAL: 3,
    VOTE: 4,
    DISBURSE: 5,
    SPLIT: 6,
    MERGE_MATURITY: 7,
    DISBURSE_MATURITY: 8,
    STAKE_MATURITY: 9,
    MANAGE_VOTING_PERMISSION: 10
};

/**
 * Get the appropriate icon and title for a principal based on their permissions
 * @param {Object} neuronPermissions - Neuron permissions object with permission_type array
 * @returns {Object} - Object with icon (React component) and title properties
 */
export function getPrincipalSymbol(neuronPermissions) {
    const permArray = neuronPermissions.permission_type || [];
    const permCount = permArray.length;
    
    // Full owner (all 10 or 11 permissions - 11 includes UNSPECIFIED from neuron creation)
    if (permCount === 10 || permCount === 11) {
        return { 
            icon: <FaCrown size={14} />, 
            title: permCount === 11 
                ? 'Full Owner - All permissions (including creator permission)' 
                : 'Full Owner - All permissions' 
        };
    }
    
    // Hotkey (exactly permissions 3 and 4: submit proposal and vote)
    const hasSubmit = permArray.includes(PERM.SUBMIT_PROPOSAL);
    const hasVote = permArray.includes(PERM.VOTE);
    if (permCount === 2 && hasSubmit && hasVote) {
        return { icon: <FaKey size={14} />, title: 'Hotkey - Submit proposals and vote' };
    }
    
    // Voting only (just vote permission)
    if (permCount === 1 && hasVote) {
        return { icon: <FaVoteYea size={14} />, title: 'Voter - Vote only' };
    }
    
    // Management focused (has manage principals)
    if (permArray.includes(PERM.MANAGE_PRINCIPALS)) {
        return { icon: <FaBolt size={14} />, title: 'Manager - Has management permissions' };
    }
    
    // Financial focused (has disburse or disburse maturity)
    if (permArray.includes(PERM.DISBURSE) || permArray.includes(PERM.DISBURSE_MATURITY)) {
        return { icon: <FaBriefcase size={14} />, title: 'Financial - Has disbursement permissions' };
    }
    
    // Custom/partial permissions
    return { icon: <FaWrench size={14} />, title: 'Custom permissions' };
}

/**
 * Get icons for the user's own permissions on a neuron
 * @param {Object} neuron - Full neuron object
 * @param {string} userPrincipalString - User's principal as string
 * @returns {Array} - Array of permission icon objects
 */
export function getUserPermissionIcons(neuron, userPrincipalString) {
    if (!neuron.permissions || !userPrincipalString) {
        return [];
    }
    
    // Find the user's permissions
    const normalizedUserPrincipal = normalizeId(userPrincipalString);
    const userPerms = neuron.permissions.find(p => 
        normalizeId(p.principal?.[0]) === normalizedUserPrincipal
    );
    
    if (!userPerms) {
        return [];
    }
    
    return [getPrincipalSymbol(userPerms)];
}

/**
 * Get state icon and color for neuron dissolve state
 * @param {string} state - State string ('Locked', 'Dissolving', 'Dissolved')
 * @returns {Object} - Object with icon (React component) and color
 */
export function getStateIcon(state) {
    switch (state) {
        case 'Locked':
            return { icon: <FaLock size={14} />, color: '#4CAF50' }; // Green
        case 'Dissolving':
            return { icon: <FaHourglassHalf size={14} />, color: '#FF9800' }; // Orange
        case 'Dissolved':
            return { icon: <FaUnlock size={14} />, color: '#F44336' }; // Red
        default:
            return { icon: <FaQuestion size={14} />, color: '#9E9E9E' }; // Grey
    }
}

