import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor, canisterId } from 'declarations/app_sneeddao_backend';
import * as NS from './NamingService';
import { createTipArgs } from './forumModel';

// Create an actor for the backend canister using the established pattern
export const createBackendActor = (identity) => {
    return createActor(canisterId, {
        agentOptions: {
            host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
            identity: identity || undefined,
        },
    });
};

const toOptional = (value) => (value === undefined || value === null ? [] : [value]);

// User settings
export const getMySettings = async (identity) => {
    if (!identity) return null;

    try {
        const actor = createBackendActor(identity);
        return await actor.get_my_settings();
    } catch (error) {
        console.error('Error getting user settings:', error);
        return null;
    }
};

export const setMySettings = async (identity, updates) => {
    if (!identity) return null;

    try {
        const actor = createBackendActor(identity);
        const payload = {
            principal_color_coding: toOptional(updates.principal_color_coding),
            neuron_color_coding: toOptional(updates.neuron_color_coding),
            show_vp_bar: toOptional(updates.show_vp_bar),
            show_header_notifications: toOptional(updates.show_header_notifications),
            collectibles_threshold: toOptional(updates.collectibles_threshold),
            expand_quick_links_on_desktop: toOptional(updates.expand_quick_links_on_desktop),
            particle_effects_enabled: toOptional(updates.particle_effects_enabled),
            neuron_manager_cycle_threshold_red: toOptional(updates.neuron_manager_cycle_threshold_red),
            neuron_manager_cycle_threshold_orange: toOptional(updates.neuron_manager_cycle_threshold_orange),
            canister_manager_cycle_threshold_red: toOptional(updates.canister_manager_cycle_threshold_red),
            canister_manager_cycle_threshold_orange: toOptional(updates.canister_manager_cycle_threshold_orange),
            frontend_auto_update_enabled: toOptional(updates.frontend_auto_update_enabled),
            frontend_clear_cache_on_update: toOptional(updates.frontend_clear_cache_on_update),
            frontend_update_check_interval_sec: toOptional(updates.frontend_update_check_interval_sec),
            frontend_update_countdown_sec: toOptional(updates.frontend_update_countdown_sec),
            swap_slippage_tolerance: toOptional(updates.swap_slippage_tolerance),
            always_show_remove_token: toOptional(updates.always_show_remove_token),
            denomination_token: toOptional(updates.denomination_token),
            notify_replies: toOptional(updates.notify_replies),
            notify_tips: toOptional(updates.notify_tips),
            notify_messages: toOptional(updates.notify_messages),
            notify_collectibles: toOptional(updates.notify_collectibles),
            notify_votable_proposals: toOptional(updates.notify_votable_proposals),
            notify_outdated_bots: toOptional(updates.notify_outdated_bots),
            notify_low_cycles: toOptional(updates.notify_low_cycles),
            notify_bot_chores: toOptional(updates.notify_bot_chores),
            notify_bot_log_errors: toOptional(updates.notify_bot_log_errors),
            notify_bot_log_warnings: toOptional(updates.notify_bot_log_warnings),
            notify_updates: toOptional(updates.notify_updates),
        };
        return await actor.set_my_settings(payload);
    } catch (error) {
        console.error('Error setting user settings:', error);
        throw error;
    }
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
    if (NS.namingServiceEnabled) return NS.setNeuronName(identity, snsRootCanisterId, neuronId, name);
    
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
    // nickname may be '' to remove a nickname, so only reject null/undefined
    if (!identity || !snsRootCanisterId || !neuronId || nickname === undefined || nickname === null) return null;
    if (NS.namingServiceEnabled) return NS.setNeuronNickname(identity, snsRootCanisterId, neuronId, nickname);
    
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
    if (NS.namingServiceEnabled) return NS.getNeuronName(identity, snsRootCanisterId, neuronId).catch(() => null);
    
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
    if (NS.namingServiceEnabled) return NS.getNeuronNickname(identity, snsRootCanisterId, neuronId).catch(() => null);
    
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
    if (NS.namingServiceEnabled) return NS.getAllNeuronNames(identity).catch((e) => { console.error('Error getting all neuron names:', e); return null; });
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
    if (NS.namingServiceEnabled) return NS.getAllNeuronNicknames(identity).catch((e) => { console.error('Error getting all neuron nicknames:', e); return null; });
    
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
    if (NS.namingServiceEnabled) return NS.setPrincipalName(identity, name);
    
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

// ---- Avatars ----
export const setMyAvatar = async (identity, url) => {
    if (NS.namingServiceEnabled) return NS.setMyAvatar(identity, url);
    const actor = createBackendActor(identity);
    return actor.set_my_avatar(url || '');
};

export const getAvatar = async (identity, principal) => {
    if (NS.namingServiceEnabled) return (await NS.getAvatars(identity, [principal])).get(principal.toString()) || null;
    const actor = createBackendActor(identity);
    const r = await actor.get_avatar(principal);
    return r && r.length ? r[0] : null;
};

/// Avatars for up to 50 principals: Map<principalText, url> (principals without one are absent).
export const getAvatars = async (identity, principals) => {
    if (NS.namingServiceEnabled) return NS.getAvatars(identity, principals);
    const actor = createBackendActor(identity);
    const r = await actor.get_avatars(principals.slice(0, 50));
    const out = new Map();
    for (const [p, url] of r) out.set(p.toString(), url);
    return out;
};

export const adminClearAvatar = async (identity, principal) => {
    if (NS.namingServiceEnabled) return NS.adminClearAvatar(identity, principal);
    const actor = createBackendActor(identity);
    return actor.admin_clear_avatar(principal);
};

// Set a private nickname for a principal
export const setPrincipalNickname = async (identity, principal, nickname) => {
    if (!identity || !principal || nickname === undefined) return null;
    if (NS.namingServiceEnabled) return NS.setPrincipalNickname(identity, principal, nickname);
    
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
    
    if (NS.namingServiceEnabled) {
        const r = await NS.getPrincipalName(identity, principal).catch(() => null);
        if (r) principalNameCache.set(cacheKey, r);
        return r;
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
    
    if (NS.namingServiceEnabled) {
        const r = await NS.getPrincipalNickname(identity, principal).catch(() => null);
        if (r) principalNicknameCache.set(cacheKey, r);
        return r;
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
    if (NS.namingServiceEnabled) return NS.getAllPrincipalNames(identity).catch((e) => { console.error('Error getting all principal names:', e); return null; });
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
    if (NS.namingServiceEnabled) return NS.getAllPrincipalNicknames(identity).catch((e) => { console.error('Error getting all principal nicknames:', e); return null; });
    
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
    if (NS.namingServiceEnabled) return NS.verifyNeuronName(identity, snsRootCanisterId, neuronId);
    
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
    if (NS.namingServiceEnabled) return NS.unverifyNeuronName(identity, snsRootCanisterId, neuronId);
    
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
    if (NS.namingServiceEnabled) return NS.verifyPrincipalName(identity, principal);
    
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
    if (NS.namingServiceEnabled) return NS.unverifyPrincipalName(identity, principal);
    
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
    if (NS.namingServiceEnabled) return NS.setPrincipalNameFor(identity, principal, name);
    
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

// The forum reads each tip's transfer on the token's ledger when it is recorded (TipVerify.mo):
// `verified` is [true] when the ledger confirmed it, [false] when it could not, [] for tips recorded
// before the forum checked tips. Sneed Hub shows and counts confirmed tips only. A forum canister
// older than tip verification sends no `verified` field; its tips are shown as before.
export const isTipVerified = (tip) => tip?.verified === undefined || tip?.verified?.[0] === true;
export const verifiedTips = (tips) => (tips || []).filter(isTipVerified);

// create_tip's error as a sentence for people (the tokens were already sent when it fails)
export const tipErrorMessage = (err) => {
    if (!err) return 'Unknown error';
    const [kind, text] = Object.entries(err)[0] || [];
    return text ? String(text) : String(kind);
};

export const createTip = async (forumActor, tipInput) => {
    try {
        // exact amounts (BigInt) and block index 0 kept (utils/forumModel.js createTipArgs)
        const result = await forumActor.create_tip(...createTipArgs({
            to: tipInput.to_principal,
            postId: tipInput.post_id,
            ledger: tipInput.token_ledger_principal,
            amount: tipInput.amount,
            blockIndex: tipInput.transaction_block_index,
        }));
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

// The forum's paged per-user lists (get_*_by_user_page: newest first, `next` is the `before` of the
// next page). Reads every page, so a busy user's list never has to fit in one reply; falls back to the
// unpaged method on a forum (or declarations) without the paged one.
const isMissingForumMethod = (e) => /has no (query|update) method|method not found|IC0536|IC0302|is not a function/i.test(String(e?.message || e));
const readUserPages = async (forumActor, pageMethod, fullMethod, userPrincipal) => {
    if (typeof forumActor[pageMethod] === 'function') {
        try {
            const items = [];
            let before = [];
            for (let i = 0; i < 1000; i++) {
                const page = await forumActor[pageMethod](userPrincipal, before, 100n);
                items.push(...page.items);
                if (!page.next || page.next.length === 0) return items;
                before = page.next;
            }
            return items;
        } catch (e) {
            if (!isMissingForumMethod(e)) throw e;
        }
    }
    return forumActor[fullMethod](userPrincipal);
};

export const getPostsByUser = async (forumActor, userPrincipal) => {
    try {
        const result = await readUserPages(forumActor, 'get_posts_by_user_page', 'get_posts_by_user', userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting posts by user:', error);
        throw error;
    }
};

export const getRepliesToUser = async (forumActor, userPrincipal) => {
    try {
        const result = await readUserPages(forumActor, 'get_replies_to_user_page', 'get_replies_to_user', userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting replies to user:', error);
        throw error;
    }
};

export const getThreadsByUser = async (forumActor, userPrincipal) => {
    try {
        const result = await readUserPages(forumActor, 'get_threads_by_user_page', 'get_threads_by_user', userPrincipal);
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
        const result = await readUserPages(forumActor, 'get_tips_given_by_user_page', 'get_tips_given_by_user', userPrincipal);
        return result;
    } catch (error) {
        console.error('Error getting tips given by user:', error);
        throw error;
    }
};

export const getTipsReceivedByUser = async (forumActor, userPrincipal) => {
    try {
        const result = await readUserPages(forumActor, 'get_tips_received_by_user_page', 'get_tips_received_by_user', userPrincipal);
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

// Canister Groups - hierarchical grouping of canisters
export const getCanisterGroups = async (identity) => {
    if (!identity) return null;
    
    try {
        const actor = createBackendActor(identity);
        const result = await actor.get_canister_groups();
        // Result is an optional, so it's an array with 0 or 1 elements
        return result.length > 0 ? result[0] : null;
    } catch (error) {
        console.error('Error getting canister groups:', error);
        return null;
    }
};

export const setCanisterGroups = async (identity, groupsRoot) => {
    if (!identity) return { ok: false, err: 'Not authenticated' };
    
    try {
        const actor = createBackendActor(identity);
        // Convert canister IDs to Principal objects if they're strings
        const convertedGroups = convertGroupsForBackend(groupsRoot);
        const result = await actor.set_canister_groups(convertedGroups);
        if ('ok' in result) {
            return { ok: true };
        } else {
            return { ok: false, err: result.err };
        }
    } catch (error) {
        console.error('Error setting canister groups:', error);
        throw error;
    }
};

export const deleteCanisterGroups = async (identity) => {
    if (!identity) return false;
    
    try {
        const actor = createBackendActor(identity);
        await actor.delete_canister_groups();
        return true;
    } catch (error) {
        console.error('Error deleting canister groups:', error);
        throw error;
    }
};

// Helper to convert groups structure for backend (strings to Principals)
const convertGroupsForBackend = (groupsRoot) => {
    const convertGroup = (group) => ({
        id: group.id,
        name: group.name,
        canisters: group.canisters.map(c => 
            typeof c === 'string' ? Principal.fromText(c) : c
        ),
        subgroups: group.subgroups.map(convertGroup),
    });
    
    return {
        groups: groupsRoot.groups.map(convertGroup),
        ungrouped: groupsRoot.ungrouped.map(c => 
            typeof c === 'string' ? Principal.fromText(c) : c
        ),
    };
};

// Helper to convert groups from backend (Principals to strings for easier use)
export const convertGroupsFromBackend = (groupsRoot) => {
    if (!groupsRoot) return null;
    
    const convertGroup = (group) => ({
        id: group.id,
        name: group.name,
        canisters: group.canisters.map(c => c.toString()),
        subgroups: group.subgroups.map(convertGroup),
    });
    
    return {
        groups: groupsRoot.groups.map(convertGroup),
        ungrouped: groupsRoot.ungrouped.map(c => c.toString()),
    };
};

// Wallet Layout - user's preferred ordering for wallet sections
export const getWalletLayout = async (identity) => {
    if (!identity) return null;
    
    try {
        const actor = createBackendActor(identity);
        const result = await actor.get_wallet_layout();
        if (!result || result.length === 0) return null;
        const layout = result[0]; // Candid ?T comes back as [] or [value]
        return {
            tokens: layout.tokens.map(p => p.toString()),
            positions: layout.positions.map(p => p.toString()),
            apps: layout.apps.map(p => p.toString()),
            sneedapp: layout.sneedapp.map(p => p.toString()),
        };
    } catch (error) {
        console.error('Error getting wallet layout:', error);
        return null;
    }
};

export const setWalletLayout = async (identity, layout) => {
    if (!identity) return;
    
    try {
        const actor = createBackendActor(identity);
        await actor.set_wallet_layout({
            tokens: layout.tokens.map(id => typeof id === 'string' ? Principal.fromText(id) : id),
            positions: layout.positions.map(id => typeof id === 'string' ? Principal.fromText(id) : id),
            apps: layout.apps.map(id => typeof id === 'string' ? Principal.fromText(id) : id),
            sneedapp: layout.sneedapp.map(id => typeof id === 'string' ? Principal.fromText(id) : id),
        });
    } catch (error) {
        console.error('Error saving wallet layout:', error);
        throw error;
    }
};

// Set a public name for a canister (caller must be a controller)
export const setCanisterName = async (identity, canisterId, name) => {
    if (!identity || !canisterId) return null;
    if (NS.namingServiceEnabled) return NS.setCanisterName(identity, canisterId, name);
    
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