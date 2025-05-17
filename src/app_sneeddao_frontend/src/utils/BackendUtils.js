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
    if (!identity || !snsRootCanisterId || !neuronId) return null;
    
    try {
        const actor = createBackendActor(identity);
        const neuronIdBytes = typeof neuronId === 'string' ? 
            hexToUint8Array(neuronId) : 
            neuronId;

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
    if (!identity) return null;
    
    try {
        const actor = createBackendActor(identity);
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
        const response = await actor.get_all_neuron_nicknames();
        return response;
    } catch (error) {
        console.error('Error getting all neuron nicknames:', error);
        return null;
    }
}; 