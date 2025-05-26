import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory } from 'declarations/app_sneeddao_backend';
import { canisterId } from 'declarations/app_sneeddao_backend';

// Create an actor for the backend canister
export const createBackendActor = (identity) => {
    const agent = new HttpAgent({
        identity,
        host: process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943'
    });

    if (process.env.DFX_NETWORK !== 'ic') {
        agent.fetchRootKey().catch(err => {
            console.warn('Unable to fetch root key. Check to ensure that your local replica is running');
            console.error(err);
        });
    }

    return Actor.createActor(idlFactory, {
        agent,
        canisterId
    });
};

// Helper function to convert hex string to Uint8Array
const hexToUint8Array = (hex) => {
    if (!hex) return null;
    return new Uint8Array(
        hex.match(/.{1,2}/g)
            .map(byte => parseInt(byte, 16))
    );
};

// Set a public name for a neuron (only owner can do this)
export const setNeuronName = async (identity, snsRootCanisterId, neuronId, name) => {
    if (!identity || !snsRootCanisterId || !neuronId || !name) return null;
    
    try {
        const actor = createBackendActor(identity);
        const neuronIdBytes = typeof neuronId === 'string' ? 
            hexToUint8Array(neuronId) : 
            neuronId;

        const response = await actor.set_neuron_name(
            Principal.fromText(snsRootCanisterId),
            { id: neuronIdBytes },
            name
        );

        return response;
    } catch (error) {
        console.error('Error setting neuron name:', error);
        throw error;
    }
};

// Set a private nickname for a neuron (any user can do this)
export const setNeuronNickname = async (identity, snsRootCanisterId, neuronId, nickname) => {
    if (!identity || !snsRootCanisterId || !neuronId || !nickname) return null;
    
    try {
        const actor = createBackendActor(identity);
        const neuronIdBytes = typeof neuronId === 'string' ? 
            hexToUint8Array(neuronId) : 
            neuronId;

        const response = await actor.set_neuron_nickname(
            Principal.fromText(snsRootCanisterId),
            { id: neuronIdBytes },
            nickname
        );

        return response;
    } catch (error) {
        console.error('Error setting neuron nickname:', error);
        throw error;
    }
};

// Get the public name of a neuron
export const getNeuronName = async (identity, snsRootCanisterId, neuronId) => {
    if (!snsRootCanisterId || !neuronId) return null;
    
    try {
        const actor = createBackendActor(identity);
        const neuronIdBytes = typeof neuronId === 'string' ? 
            hexToUint8Array(neuronId) : 
            neuronId;
        console.log('Getting neuron name for:', {
            snsRootCanisterId,
            neuronIdBytes
        });
        const response = await actor.get_neuron_name(
            Principal.fromText(snsRootCanisterId),
            { id: neuronIdBytes }
        );

        return response;
    } catch (error) {
        console.error('Error getting neuron name:', error);
        return null;
    }
};

// Get the private nickname of a neuron
export const getNeuronNickname = async (identity, snsRootCanisterId, neuronId) => {
    if (!identity || !snsRootCanisterId || !neuronId) return null;
    
    try {
        const actor = createBackendActor(identity);
        const neuronIdBytes = typeof neuronId === 'string' ? 
            hexToUint8Array(neuronId) : 
            neuronId;
        console.log('Getting neuron nickname for:', {
            snsRootCanisterId,
            neuronIdBytes
        });
        const response = await actor.get_neuron_nickname(
            Principal.fromText(snsRootCanisterId),
            { id: neuronIdBytes }
        );

        return response;
    } catch (error) {
        console.error('Error getting neuron nickname:', error);
        return null;
    }
};

// Get all neuron names
export const getAllNeuronNames = async (identity) => {
    try {
        const actor = createBackendActor(identity);
        console.log('Getting all neuron names');
        const response = await actor.get_all_neuron_names();
        return response;
    } catch (error) {
        console.error('Error getting all neuron names:', error);
        return null;
    }
};

// Get all neuron nicknames for the current user
export const getAllNeuronNicknames = async (identity) => {
    if (!identity) return null;
    
    try {
        const actor = createBackendActor(identity);
        console.log('Getting all neuron nicknames');
        const response = await actor.get_all_neuron_nicknames();
        return response;
    } catch (error) {
        console.error('Error getting all neuron nicknames:', error);
        return null;
    }
};

// Cache for principal names and nicknames
const principalNameCache = new Map();
const principalNicknameCache = new Map();

// Set a public name for your principal
export const setPrincipalName = async (identity, name) => {
    if (!identity || name === undefined) return null;
    
    try {
        const actor = createBackendActor(identity);
        const response = await actor.set_principal_name(name);
        if ('ok' in response) {
            // Clear name cache for this principal
            const cacheKey = `${identity.getPrincipal().toString()}-${identity.getPrincipal().toString()}`;
            principalNameCache.delete(cacheKey);
        }
        return response;
    } catch (error) {
        console.error('Error setting principal name:', error);
        throw error;
    }
};

// Set a private nickname for a principal
export const setPrincipalNickname = async (identity, principal, nickname) => {
    if (!identity || !principal || nickname === undefined) return null;
    
    try {
        const actor = createBackendActor(identity);
        const response = await actor.set_principal_nickname(
            typeof principal === 'string' ? Principal.fromText(principal) : principal,
            nickname
        );
        if ('ok' in response) {
            // Clear nickname cache for this principal
            const cacheKey = `${identity.getPrincipal().toString()}-${principal.toString()}`;
            principalNicknameCache.delete(cacheKey);
        }
        return response;
    } catch (error) {
        console.error('Error setting principal nickname:', error);
        throw error;
    }
};

// Get the public name of a principal
export const getPrincipalName = async (identity, principal) => {
    if (!principal) return null;
    
    const principalStr = principal.toString();
    const identityStr = identity ? identity.getPrincipal().toString() : 'anonymous';
    const cacheKey = `${identityStr}-${principalStr}`;
    
    // Check cache first
    if (principalNameCache.has(cacheKey)) {
        return principalNameCache.get(cacheKey);
    }
    
    try {
        const actor = createBackendActor(identity);
        console.log('Getting principal name for:', {
            principal: principalStr
        });
        const response = await actor.get_principal_name(
            typeof principal === 'string' ? Principal.fromText(principal) : principal
        );
        
        // Cache the result
        principalNameCache.set(cacheKey, response);
        return response;
    } catch (error) {
        console.error('Error getting principal name:', error);
        return null;
    }
};

// Get your private nickname for a principal
export const getPrincipalNickname = async (identity, principal) => {
    if (!identity || !principal) return null;
    
    const principalStr = principal.toString();
    const cacheKey = `${identity.getPrincipal().toString()}-${principalStr}`;
    
    // Check cache first
    if (principalNicknameCache.has(cacheKey)) {
        return principalNicknameCache.get(cacheKey);
    }
    
    try {
        const actor = createBackendActor(identity);
        console.log('Getting principal nickname for:', {
            principal: principalStr
        });
        const response = await actor.get_principal_nickname(
            typeof principal === 'string' ? Principal.fromText(principal) : principal
        );
        
        // Cache the result
        principalNicknameCache.set(cacheKey, response);
        return response;
    } catch (error) {
        console.error('Error getting principal nickname:', error);
        return null;
    }
};

// Get all principal names
export const getAllPrincipalNames = async (identity) => {
    if (!identity) return null;
    
    try {
        const actor = createBackendActor(identity);
        console.log('Getting all principal names');
        const response = await actor.get_all_principal_names();
        return response;
    } catch (error) {
        console.error('Error getting all principal names:', error);
        return null;
    }
};

// Get all principal nicknames for the current user
export const getAllPrincipalNicknames = async (identity) => {
    if (!identity) return null;
    
    try {
        const actor = createBackendActor(identity);
        console.log('Getting all principal nicknames');
        const response = await actor.get_all_principal_nicknames();
        return response;
    } catch (error) {
        console.error('Error getting all principal nicknames:', error);
        return null;
    }
};

// Verify a neuron name (admin only)
export const verifyNeuronName = async (identity, snsRootCanisterId, neuronId) => {
    if (!identity || !snsRootCanisterId || !neuronId) return null;
    
    try {
        const actor = createBackendActor(identity);
        const neuronIdBytes = typeof neuronId === 'string' ? 
            hexToUint8Array(neuronId) : 
            neuronId;

        const response = await actor.verify_neuron_name(
            Principal.fromText(snsRootCanisterId),
            { id: neuronIdBytes }
        );

        return response;
    } catch (error) {
        console.error('Error verifying neuron name:', error);
        throw error;
    }
};

// Unverify a neuron name (admin only)
export const unverifyNeuronName = async (identity, snsRootCanisterId, neuronId) => {
    if (!identity || !snsRootCanisterId || !neuronId) return null;
    
    try {
        const actor = createBackendActor(identity);
        const neuronIdBytes = typeof neuronId === 'string' ? 
            hexToUint8Array(neuronId) : 
            neuronId;

        const response = await actor.unverify_neuron_name(
            Principal.fromText(snsRootCanisterId),
            { id: neuronIdBytes }
        );

        return response;
    } catch (error) {
        console.error('Error unverifying neuron name:', error);
        throw error;
    }
};

// Verify a principal name (admin only)
export const verifyPrincipalName = async (identity, principal) => {
    if (!identity || !principal) return null;
    
    try {
        const actor = createBackendActor(identity);
        const response = await actor.verify_principal_name(
            typeof principal === 'string' ? Principal.fromText(principal) : principal
        );

        return response;
    } catch (error) {
        console.error('Error verifying principal name:', error);
        throw error;
    }
};

// Unverify a principal name (admin only)
export const unverifyPrincipalName = async (identity, principal) => {
    if (!identity || !principal) return null;
    
    try {
        const actor = createBackendActor(identity);
        const response = await actor.unverify_principal_name(
            typeof principal === 'string' ? Principal.fromText(principal) : principal
        );

        return response;
    } catch (error) {
        console.error('Error unverifying principal name:', error);
        throw error;
    }
};

// Admin function to set principal name for any principal
export const setPrincipalNameFor = async (identity, principal, name, snsRootCanisterId = null) => {
    if (!identity || !principal || name === undefined) return null;
    
    try {
        const actor = createBackendActor(identity);
        const response = await actor.set_principal_name_for(
            typeof principal === 'string' ? Principal.fromText(principal) : principal,
            name,
            snsRootCanisterId ? [Principal.fromText(snsRootCanisterId)] : []
        );

        return response;
    } catch (error) {
        console.error('Error setting principal name for user:', error);
        throw error;
    }
}; 