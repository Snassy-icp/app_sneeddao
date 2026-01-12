import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor, canisterId } from 'declarations/app_sneeddao_backend';

// Create an actor for the backend canister using the established pattern
export const createBackendActor = (identity) => {
    return createActor(canisterId, {
        agentOptions: {
            host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
            identity: identity || undefined,
        },
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
    try {
        const actor = createBackendActor(identity); // identity can be null for anonymous calls
        console.log('Getting all principal names with identity:', identity ? 'authenticated' : 'anonymous');
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

// Get text limits from the forum backend
export const getTextLimits = async (forumActor) => {
    try {
        const result = await forumActor.get_text_limits();
        
        // Map backend field names to frontend expected field names and convert BigInt to Number
        return {
            // Frontend expected field names (for Discussion component)
            max_title_length: Number(result.post_title_max_length),
            max_body_length: Number(result.post_body_max_length),
            max_comment_length: Number(result.post_body_max_length), // Use post body length for comments
            
            // Backend field names (for admin form)
            post_title_max_length: Number(result.post_title_max_length),
            post_body_max_length: Number(result.post_body_max_length),
            thread_title_max_length: Number(result.thread_title_max_length),
            thread_body_max_length: Number(result.thread_body_max_length),
            topic_title_max_length: Number(result.topic_title_max_length),
            topic_description_max_length: Number(result.topic_description_max_length),
            forum_title_max_length: Number(result.forum_title_max_length),
            forum_description_max_length: Number(result.forum_description_max_length)
        };
    } catch (error) {
        console.error('Error fetching text limits:', error);
        throw error;
    }
};

// Update text limits in the forum backend (admin only)
export const updateTextLimits = async (forumActor, textLimitsInput) => {
    try {
        // Map frontend field names to backend expected field names
        const backendInput = {
            post_title_max_length: textLimitsInput.post_title_max_length ? [textLimitsInput.post_title_max_length] : [],
            post_body_max_length: textLimitsInput.post_body_max_length ? [textLimitsInput.post_body_max_length] : [],
            thread_title_max_length: textLimitsInput.thread_title_max_length ? [textLimitsInput.thread_title_max_length] : [],
            thread_body_max_length: textLimitsInput.thread_body_max_length ? [textLimitsInput.thread_body_max_length] : [],
            topic_title_max_length: textLimitsInput.topic_title_max_length ? [textLimitsInput.topic_title_max_length] : [],
            topic_description_max_length: textLimitsInput.topic_description_max_length ? [textLimitsInput.topic_description_max_length] : [],
            forum_title_max_length: textLimitsInput.forum_title_max_length ? [textLimitsInput.forum_title_max_length] : [],
            forum_description_max_length: textLimitsInput.forum_description_max_length ? [textLimitsInput.forum_description_max_length] : []
        };
        
        const result = await forumActor.update_text_limits(backendInput);
        return result;
    } catch (error) {
        console.error('Error updating text limits:', error);
        throw error;
    }
};

// Tip-related functions for forum
export const createTip = async (forumActor, tipInput) => {
    try {
        const result = await forumActor.create_tip(
            tipInput.to_principal,
            tipInput.post_id,
            tipInput.token_ledger_principal,
            tipInput.amount,
            tipInput.transaction_block_index ? [tipInput.transaction_block_index] : []
        );
        return result;
    } catch (error) {
        console.error('Error creating tip:', error);
        throw error;
    }
};

export const getTipsByPost = async (forumActor, postId) => {
    try {
        const result = await forumActor.get_tips_by_post(postId);
        return result;
    } catch (error) {
        console.error('Error getting tips by post:', error);
        throw error;
    }
};

export const getTipsByThread = async (forumActor, threadId) => {
    try {
        const result = await forumActor.get_tips_by_thread(threadId);
        return result;
    } catch (error) {
        console.error('Error getting tips by thread:', error);
        throw error;
    }
};

export const getPostsByUser = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_posts_by_user(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting posts by user:', error);
        throw error;
    }
};

export const getRepliesToUser = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_replies_to_user(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting replies to user:', error);
        throw error;
    }
};

export const getThreadsByUser = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_threads_by_user(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting threads by user:', error);
        throw error;
    }
};

export const getPostsByThread = async (forumActor, threadId) => {
    try {
        const result = await forumActor.get_posts_by_thread(Number(threadId));
        return result;
    } catch (error) {
        console.error('Error getting posts by thread:', error);
        throw error;
    }
};

export const getTipsGivenByUser = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_tips_given_by_user(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting tips given by user:', error);
        throw error;
    }
};

export const getTipsReceivedByUser = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_tips_received_by_user(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting tips received by user:', error);
        throw error;
    }
};

export const getTipTokensReceivedByUser = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_tip_tokens_received_by_user(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting tip tokens received by user:', error);
        throw error;
    }
};

export const getTipStats = async (forumActor) => {
    try {
        const result = await forumActor.get_tip_stats();
        return result;
    } catch (error) {
        console.error('Error getting tip stats:', error);
        throw error;
    }
};

// Tip notification methods
export const getRecentTipsReceived = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_recent_tips_received(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting recent tips received:', error);
        throw error;
    }
};

export const getRecentTipsCount = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_recent_tips_count(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting recent tips count:', error);
        throw error;
    }
};

export const getTipsReceivedSince = async (forumActor, userPrincipal, sinceTimestamp) => {
    try {
        const result = await forumActor.get_tips_received_since(userPrincipal, sinceTimestamp);
        return result;
    } catch (error) {
        console.error('Error getting tips received since timestamp:', error);
        throw error;
    }
};

export const markTipsSeenUpTo = async (forumActor, timestamp) => {
    try {
        const result = await forumActor.mark_tips_seen_up_to(timestamp);
        return result;
    } catch (error) {
        console.error('Error marking tips as seen:', error);
        throw error;
    }
};

export const getLastSeenTipTimestamp = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_last_seen_tip_timestamp(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting last seen tip timestamp:', error);
        throw error;
    }
};

// Reply notification methods
export const getRecentRepliesCount = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_recent_replies_count(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting recent replies count:', error);
        throw error;
    }
};

export const markRepliesSeenUpTo = async (forumActor, timestamp) => {
    try {
        const result = await forumActor.mark_replies_seen_up_to(timestamp);
        return result;
    } catch (error) {
        console.error('Error marking replies as seen:', error);
        throw error;
    }
};

export const getLastSeenRepliesTimestamp = async (forumActor, userPrincipal) => {
    try {
        const result = await forumActor.get_last_seen_replies_timestamp(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting last seen replies timestamp:', error);
        throw error;
    }
};

// SMS notification methods
export const getRecentMessagesCount = async (smsActor, userPrincipal) => {
    try {
        const result = await smsActor.get_recent_messages_count(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting recent messages count:', error);
        throw error;
    }
};

export const markMessagesSeenUpTo = async (smsActor, timestamp) => {
    try {
        const result = await smsActor.mark_messages_seen_up_to(timestamp);
        return result;
    } catch (error) {
        console.error('Error marking messages as seen:', error);
        throw error;
    }
};

export const getLastSeenMessagesTimestamp = async (smsActor, userPrincipal) => {
    try {
        const result = await smsActor.get_last_seen_messages_timestamp(userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting last seen messages timestamp:', error);
        throw error;
    }
};

// Update a post
export const updatePost = async (forumActor, postId, title, body) => {
    try {
        const result = await forumActor.update_post(
            Number(postId),
            title ? [title] : [], // opt text
            body
        );
        return result;
    } catch (error) {
        console.error('Error updating post:', error);
        throw error;
    }
};

// Delete a post
export const deletePost = async (forumActor, postId) => {
    try {
        const result = await forumActor.delete_post(Number(postId));
        return result;
    } catch (error) {
        console.error('Error deleting post:', error);
        throw error;
    }
};

// Update a thread
export const updateThread = async (forumActor, threadId, title, body) => {
    try {
        const result = await forumActor.update_thread(
            Number(threadId),
            title ? [title] : [], // opt text
            body
        );
        return result;
    } catch (error) {
        console.error('Error updating thread:', error);
        throw error;
    }
};

// Delete a thread
export const deleteThread = async (forumActor, threadId) => {
    try {
        const result = await forumActor.delete_thread(Number(threadId));
        return result;
    } catch (error) {
        console.error('Error deleting thread:', error);
        throw error;
    }
};

// Get thread context (thread -> topic -> forum -> SNS)
export const getThreadContext = async (forumActor, threadId) => {
    try {
        const result = await forumActor.get_thread_context(Number(threadId));
        return result;
    } catch (error) {
        console.error('Error getting thread context:', error);
        throw error;
    }
};

// Get canister info (controllers and module hash) via backend
// This calls our backend which in turn calls the IC management canister
export const getCanisterInfo = async (identity, canisterId) => {
    if (!canisterId) return null;
    
    try {
        const actor = createBackendActor(identity);
        const result = await actor.get_canister_info(
            typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId
        );
        return result;
    } catch (error) {
        console.error('Error getting canister info:', error);
        throw error;
    }
};

// Tracked canisters - for users to track arbitrary canisters
export const getTrackedCanisters = async (identity) => {
    if (!identity) return [];
    
    try {
        const actor = createBackendActor(identity);
        const result = await actor.get_tracked_canisters();
        return result;
    } catch (error) {
        console.error('Error getting tracked canisters:', error);
        return [];
    }
};

export const registerTrackedCanister = async (identity, canisterId) => {
    if (!identity || !canisterId) return null;
    
    try {
        const actor = createBackendActor(identity);
        await actor.register_tracked_canister(
            typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId
        );
        return true;
    } catch (error) {
        console.error('Error registering tracked canister:', error);
        throw error;
    }
};

export const unregisterTrackedCanister = async (identity, canisterId) => {
    if (!identity || !canisterId) return null;
    
    try {
        const actor = createBackendActor(identity);
        await actor.unregister_tracked_canister(
            typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId
        );
        return true;
    } catch (error) {
        console.error('Error unregistering tracked canister:', error);
        throw error;
    }
};

// Set a public name for a canister (caller must be a controller)
export const setCanisterName = async (identity, canisterId, name) => {
    if (!identity || !canisterId) return null;
    
    try {
        const actor = createBackendActor(identity);
        const result = await actor.set_canister_name(
            typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId,
            name
        );
        return result;
    } catch (error) {
        console.error('Error setting canister name:', error);
        throw error;
    }
}; 