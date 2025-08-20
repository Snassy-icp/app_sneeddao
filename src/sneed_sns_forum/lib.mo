import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Result "mo:base/Result";
import Map "mo:map/Map";
import Buffer "mo:base/Buffer";
import Dedup "mo:dedup";
import Iter "mo:base/Iter";
import Text "mo:base/Text";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Array "mo:base/Array";
import Order "mo:base/Order";
import Vector "mo:vector";
import SnsUtil "../SnsUtil";

import T "Types";

module {
    public type ForumState = T.ForumState;
    public type Forum = T.Forum;
    public type Topic = T.Topic;
    public type Thread = T.Thread;
    public type Post = T.Post;
    public type Vote = T.Vote;
    public type VoteKey = T.VoteKey;
    public type VoteType = T.VoteType;
    public type NeuronId = T.NeuronId;
    public type ThreadVoteResponse = T.ThreadVoteResponse;
    public type NeuronVote = T.NeuronVote;
    public type ForumError = T.ForumError;
    public type Result<A, B> = T.Result<A, B>;
    public type AdminInfo = T.AdminInfo;
    public type SnsCache = T.SnsCache;
    public type DeployedSns = T.DeployedSns;
    public type ListDeployedSnsesResponse = T.ListDeployedSnsesResponse;
    public type NNSSnsWCanister = T.NNSSnsWCanister;
    public type Tip = T.Tip;
    public type CreateTipInput = T.CreateTipInput;
    public type TipResponse = T.TipResponse;
    public type TipStats = T.TipStats;



    // Constants
    private let NNS_SNS_W_CANISTER_ID = "qaa6y-5yaaa-aaaaa-aaafa-cai"; // NNS SNS-W canister
    private let CACHE_EXPIRY_NANOSECONDS = 86400000000000; // 24 hours in nanoseconds
    // SNS cache management functions
    public func is_cache_expired(cache: SnsCache, current_time: Int) : Bool {
        (current_time - cache.last_updated) > CACHE_EXPIRY_NANOSECONDS
    };

    public func refresh_sns_cache(current_time: Int) : async SnsCache {
        let nns_sns_w : NNSSnsWCanister = actor(NNS_SNS_W_CANISTER_ID);
        let response = await nns_sns_w.list_deployed_snses({});
        
        {
            instances = response.instances;
            last_updated = current_time;
        }
    };

    public func get_governance_canister_from_cache(cache: SnsCache, root_canister_id: Principal) : ?Principal {
        for (instance in cache.instances.vals()) {
            switch (instance.root_canister_id) {
                case (?root_id) {
                    if (Principal.equal(root_id, root_canister_id)) {
                        return instance.governance_canister_id;
                    };
                };
                case null {};
            };
        };
        null
    };

    public func ensure_sns_cache(cache: SnsCache, current_time: Int) : async SnsCache {
        if (is_cache_expired(cache, current_time)) {
            await refresh_sns_cache(current_time)
        } else {
            cache
        }
    };

    // Utility function to get SNS governance canister ID from forum
    public func get_governance_canister_id_from_forum(state: ForumState, forum_id: Nat, cache: SnsCache, current_time: Int) : async (?Principal, SnsCache) {
        switch (get_forum(state, forum_id)) {
            case (?forum_response) {
                switch (forum_response.sns_root_canister_id) {
                    case (?sns_root) {
                        let updated_cache = await ensure_sns_cache(cache, current_time);
                        let governance_id = get_governance_canister_from_cache(updated_cache, sns_root);
                        (governance_id, updated_cache)
                    };
                    case null (null, cache);
                };
            };
            case null (null, cache);
        };
    };

    // Utility function to get governance canister ID from thread hierarchy
    public func get_governance_canister_id_from_thread(state: ForumState, thread_id: Nat, cache: SnsCache, current_time: Int) : async (?Principal, SnsCache) {
        switch (get_thread(state, thread_id)) {
            case (?thread_response) {
                switch (get_topic(state, thread_response.topic_id)) {
                    case (?topic_response) {
                        await get_governance_canister_id_from_forum(state, topic_response.forum_id, cache, current_time)
                    };
                    case null (null, cache);
                };
            };
            case null (null, cache);
        }
    };

    // Utility function to get governance canister ID from post hierarchy
    public func get_governance_canister_id_from_post(state: ForumState, post_id: Nat, cache: SnsCache, current_time: Int) : async (?Principal, SnsCache) {
        switch (get_post(state, post_id)) {
            case (?post_response) {
                switch (get_thread(state, post_response.thread_id)) {
                    case (?thread_response) {
                        switch (get_topic(state, thread_response.topic_id)) {
                            case (?topic_response) {
                                await get_governance_canister_id_from_forum(state, topic_response.forum_id, cache, current_time)
                            };
                            case null (null, cache);
                        };
                    };
                    case null (null, cache);
                };
            };
            case null (null, cache);
        }
    };

    // Utility function to calculate total voting power for a caller
    public func calculate_caller_total_voting_power(governance_canister_id: Principal, caller: Principal) : async Nat {
        try {
            let reachable_neurons = await SnsUtil.get_reachable_neurons(governance_canister_id, caller);
            
            var total_voting_power = 0;
            for (neuron in reachable_neurons.vals()) {
                let neuron_power = await SnsUtil.get_neuron_voting_power(governance_canister_id, neuron);
                total_voting_power += neuron_power;
            };
            
            total_voting_power
        } catch (error) {
            0
        }
    };

    // New create_post function that handles SNS integration internally
    public func create_post_with_sns(
        state: ForumState,
        caller: Principal,
        thread_id: Nat,
        reply_to_post_id: ?Nat,
        title: ?Text,
        body: Text,
        cache: SnsCache
    ) : async (T.Result<Nat, T.ForumError>, SnsCache) {
        let (governance_canister_id_opt, updated_cache) = await get_governance_canister_id_from_thread(state, thread_id, cache, Time.now());
        
        switch (governance_canister_id_opt) {
            case (?governance_canister_id) {
                try {
                    // Allow post creation without checking for neurons - users can post without voting power
                    // Just create the post with 0 initial voting power - voting will be done separately
                    let post_id = create_post(state, caller, thread_id, reply_to_post_id, title, body, 0, Time.now());
                    
                    (post_id, updated_cache)
                } catch (error) {
                    (#err(#InternalError("Failed to create post with SNS")), updated_cache)
                }
            };
            case null {
                (#err(#InternalError("No SNS governance canister found")), updated_cache)
            };
        }
    };

    // Vote with specific neurons only
    public func vote_on_post_with_specific_neurons(
        state: ForumState,
        caller: Principal,
        post_id: Nat,
        vote_type: VoteType,
        neuron_ids: [T.NeuronId],
        cache: SnsCache
    ) : async (T.Result<(), T.ForumError>, SnsCache) {
        // Get the governance canister ID for this post
        let (governance_canister_id_opt, updated_cache) = await get_governance_canister_id_from_post(state, post_id, cache, Time.now());
        
        switch (governance_canister_id_opt) {
            case (?governance_canister_id) {
                try {
                    let reachable_neurons = await SnsUtil.get_reachable_neurons(governance_canister_id, caller);
                    
                    if (reachable_neurons.size() == 0) {
                        return (#err(#Unauthorized("No accessible neurons found")), updated_cache);
                    };
                    
                    let system_parameters = await SnsUtil.get_system_parameters(governance_canister_id);
                    
                    // Filter reachable neurons to only include the specified ones
                    let target_neuron_ids = Array.map<T.NeuronId, Blob>(neuron_ids, func(n) = n.id);
                    
                    for (neuron in reachable_neurons.vals()) {
                        switch (neuron.id) {
                            case (?neuron_id) {
                                // Check if this neuron is in our target list
                                let neuron_blob = neuron_id.id;
                                var should_vote = false;
                                for (target_id in target_neuron_ids.vals()) {
                                    if (Blob.equal(neuron_blob, target_id)) {
                                        should_vote := true;
                                    };
                                };
                                
                                if (should_vote) {
                                    let voting_power = SnsUtil.calculate_neuron_voting_power(neuron, system_parameters);
                                    if (voting_power > 0) {
                                        switch (vote_on_post(state, caller, post_id, vote_type, neuron_id, voting_power, Time.now())) {
                                            case (#err(error)) {
                                                return (#err(error), updated_cache);
                                            };
                                            case (#ok()) { };
                                        };
                                    };
                                };
                            };
                            case null { };
                        };
                    };
                    
                    return (#ok(), updated_cache);
                } catch (_error) {
                    return (#err(#InternalError("Failed to vote")), updated_cache);
                };
            };
            case null {
                return (#err(#NotFound("Post not found")), updated_cache);
            };
        };
    };

    // New vote_on_post function that handles SNS integration internally
    public func vote_on_post_with_sns(
        state: ForumState,
        caller: Principal,
        post_id: Nat,
        vote_type: VoteType,
        cache: SnsCache
    ) : async (T.Result<(), T.ForumError>, SnsCache) {
        // Get the governance canister ID for this post
        let (governance_canister_id_opt, updated_cache) = await get_governance_canister_id_from_post(state, post_id, cache, Time.now());
        
        switch (governance_canister_id_opt) {
            case (?governance_canister_id) {
                try {
                    let reachable_neurons = await SnsUtil.get_reachable_neurons(governance_canister_id, caller);
                    
                    if (reachable_neurons.size() == 0) {
                        return (#err(#Unauthorized("No accessible neurons found")), updated_cache);
                    };
                    
                    let system_parameters = await SnsUtil.get_system_parameters(governance_canister_id);
                    
                    for (neuron in reachable_neurons.vals()) {
                        switch (neuron.id) {
                            case (?neuron_id) {
                                let voting_power = SnsUtil.calculate_neuron_voting_power(neuron, system_parameters);
                                if (voting_power > 0) {
                                    switch (vote_on_post(state, caller, post_id, vote_type, neuron_id, voting_power, Time.now())) {
                                        case (#err(error)) {
                                            return (#err(error), updated_cache);
                                        };
                                        case (#ok()) { };
                                    };
                                };
                            };
                            case null { };
                        };
                    };
                    
                    (#ok(), updated_cache)
                } catch (error) {
                    (#err(#InternalError("Failed to vote on post with SNS")), updated_cache)
                }
            };
            case null {
                (#err(#InternalError("No SNS governance canister found")), updated_cache)
            };
        }
    };

    // Retract votes for specific neurons only
    public func retract_vote_with_specific_neurons(
        state: ForumState,
        caller: Principal,
        post_id: Nat,
        neuron_ids: [T.NeuronId],
        cache: SnsCache
    ) : async (T.Result<(), T.ForumError>, SnsCache) {
        // Get the governance canister ID for this post
        let (governance_canister_id_opt, updated_cache) = await get_governance_canister_id_from_post(state, post_id, cache, Time.now());
        
        switch (governance_canister_id_opt) {
            case (?governance_canister_id) {
                try {
                    let reachable_neurons = await SnsUtil.get_reachable_neurons(governance_canister_id, caller);
                    
                    if (reachable_neurons.size() == 0) {
                        return (#err(#Unauthorized("No accessible neurons found")), updated_cache);
                    };
                    
                    // Filter reachable neurons to only include the specified ones
                    let target_neuron_ids = Array.map<T.NeuronId, Blob>(neuron_ids, func(n) = n.id);
                    
                    var any_vote_retracted = false;
                    for (neuron in reachable_neurons.vals()) {
                        switch (neuron.id) {
                            case (?neuron_id) {
                                // Check if this neuron is in our target list
                                let neuron_blob = neuron_id.id;
                                var should_retract = false;
                                for (target_id in target_neuron_ids.vals()) {
                                    if (Blob.equal(neuron_blob, target_id)) {
                                        should_retract := true;
                                    };
                                };
                                
                                if (should_retract) {
                                    switch (retract_vote(state, post_id, neuron_id)) {
                                        case (#ok()) {
                                            any_vote_retracted := true;
                                        };
                                        case (#err(_)) { };
                                    };
                                };
                            };
                            case null { };
                        };
                    };
                    
                    if (any_vote_retracted) {
                        return (#ok(), updated_cache);
                    } else {
                        return (#err(#NotFound("No votes found to retract")), updated_cache);
                    };
                } catch (_error) {
                    return (#err(#InternalError("Failed to retract vote")), updated_cache);
                };
            };
            case null {
                return (#err(#NotFound("Post not found")), updated_cache);
            };
        };
    };

    // New retract_vote function that handles SNS integration internally
    public func retract_vote_with_sns(
        state: ForumState,
        caller: Principal,
        post_id: Nat,
        cache: SnsCache
    ) : async (T.Result<(), T.ForumError>, SnsCache) {
        // Get the governance canister ID for this post
        let (governance_canister_id_opt, updated_cache) = await get_governance_canister_id_from_post(state, post_id, cache, Time.now());
        
        switch (governance_canister_id_opt) {
            case (?governance_canister_id) {
                try {
                    let reachable_neurons = await SnsUtil.get_reachable_neurons(governance_canister_id, caller);
                    
                    if (reachable_neurons.size() == 0) {
                        return (#err(#Unauthorized("No accessible neurons found")), updated_cache);
                    };
                    
                    var any_vote_retracted = false;
                    for (neuron in reachable_neurons.vals()) {
                        switch (neuron.id) {
                            case (?neuron_id) {
                                switch (retract_vote(state, post_id, neuron_id)) {
                                    case (#ok()) {
                                        any_vote_retracted := true;
                                    };
                                    case (#err(_)) { };
                                };
                            };
                            case null { };
                        };
                    };
                    
                    if (any_vote_retracted) {
                        (#ok(), updated_cache)
                    } else {
                        (#err(#NotFound("No votes found to retract")), updated_cache)
                    }
                } catch (error) {
                    (#err(#InternalError("Failed to retract vote with SNS")), updated_cache)
                }
            };
            case null {
                (#err(#InternalError("No SNS governance canister found")), updated_cache)
            };
        }
    };

    // Hash utilities for VoteKey
    private let vote_key_hash_utils = (T.vote_key_hash, T.vote_key_equal);

    // Admin management functions
    public func is_admin(state: ForumState, principal: Principal) : Bool {
        if (Principal.equal(principal, Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai"))) { // Sneed governance canister is admin.
            return true;
        };
        if (Principal.isController(principal)) {
            return true;
        };
        for (admin in Vector.vals(state.admins)) {
            if (Principal.equal(admin.principal, principal)) {
                return true;
            };
        };
        false
    };

    public func add_admin(
        state: ForumState,
        caller: Principal,
        new_admin: Principal
    ) : Result<(), ForumError> {
        // Check if caller is already an admin (or if this is the first admin)
        if (Vector.size(state.admins) > 0 and not is_admin(state, caller)) {
            return #err(#Unauthorized("Only admins can add new admins"));
        };

        // Check if the principal is already an admin
        if (is_admin(state, new_admin)) {
            return #err(#AlreadyExists("Principal is already an admin"));
        };

        let admin_info : AdminInfo = {
            principal = new_admin;
            added_by = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
            added_at = Time.now();
        };

        Vector.add(state.admins, admin_info);
        #ok()
    };

    public func remove_admin(
        state: ForumState,
        caller: Principal,
        admin_to_remove: Principal
    ) : Result<(), ForumError> {
        // Check if caller is an admin
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Only admins can remove admins"));
        };

        // Don't allow removing yourself if you're the last admin
        if (Vector.size(state.admins) == 1 and Principal.equal(caller, admin_to_remove)) {
            return #err(#InvalidInput("Cannot remove the last admin"));
        };

        // Find and remove the admin
        let new_admins = Vector.new<AdminInfo>();
        var found = false;

        for (admin in Vector.vals(state.admins)) {
            if (not Principal.equal(admin.principal, admin_to_remove)) {
                Vector.add(new_admins, admin);
            } else {
                found := true;
            };
        };

        if (not found) {
            return #err(#NotFound("Admin not found"));
        };

        // Replace the admins vector
        Vector.clear(state.admins);
        for (admin in Vector.vals(new_admins)) {
            Vector.add(state.admins, admin);
        };

        #ok()
    };

    public func get_admins(state: ForumState) : [AdminInfo] {
        Vector.toArray(state.admins)
    };

    // Helper function to get next ID
    private func get_next_id(state: ForumState) : Nat {
        let id = state.next_id;
        state.next_id += 1;
        id
    };

    // Helper function to validate text input
    private func validate_text(text: Text, field_name: Text, max_length: Nat) : Result<(), ForumError> {
        if (Text.size(text) == 0) {
            return #err(#InvalidInput(field_name # " cannot be empty"));
        };
        if (Text.size(text) > max_length) {
            return #err(#InvalidInput(field_name # " cannot exceed " # Nat.toText(max_length) # " characters"));
        };
        #ok()
    };

    // Helper function to add to index
    private func add_to_index(map: Map.Map<Nat, Vector.Vector<Nat>>, key: Nat, value: Nat) {
        switch (Map.get(map, Map.nhash, key)) {
            case (?vector) {
                Vector.add(vector, value);
            };
            case null {
                let vector = Vector.new<Nat>();
                Vector.add(vector, value);
                ignore Map.put(map, Map.nhash, key, vector);
            };
        };
    };

    private func add_to_index_32(map: Map.Map<Nat32, Vector.Vector<Nat>>, key: Nat32, value: Nat) {
        switch (Map.get(map, Map.n32hash, key)) {
            case (?vector) {
                Vector.add(vector, value);
            };
            case null {
                let vector = Vector.new<Nat>();
                Vector.add(vector, value);
                ignore Map.put(map, Map.n32hash, key, vector);
            };
        };
    };

    // Helper function to remove from index
    private func remove_from_index(map: Map.Map<Nat, Vector.Vector<Nat>>, key: Nat, value: Nat) {
        switch (Map.get(map, Map.nhash, key)) {
            case (?vector) {
                let filtered = Vector.new<Nat>();
                for (item in Vector.vals(vector)) {
                    if (item != value) {
                        Vector.add(filtered, item);
                    };
                };
                ignore Map.put(map, Map.nhash, key, filtered);
            };
            case null {};
        };
    };

    // Forum operations
    public func create_forum(
        state: ForumState,
        caller: Principal,
        input: T.CreateForumInput
    ) : Result<Nat, ForumError> {
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        create_forum_internal(state, caller, input)
    };

    private func create_forum_internal(
        state: ForumState,
        caller: Principal,
        input: T.CreateForumInput
    ) : Result<Nat, ForumError> {
        // Check admin access

        // Validate input
        switch (validate_text(input.title, "Title", state.text_limits.forum_title_max_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };
        switch (validate_text(input.description, "Description", state.text_limits.forum_description_max_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        let id = get_next_id(state);
        let now = Time.now();
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        
        let sns_root = switch (input.sns_root_canister_id) {
            case (?root) ?root;
            case null ?T.sneed_dao_root_canister_id();
        };

        let forum : Forum = {
            id;
            title = input.title;
            description = input.description;
            sns_root_canister_id = sns_root;
            created_by = caller_index;
            created_at = now;
            updated_by = caller_index;
            updated_at = now;
            deleted = false;
        };

        ignore Map.put(state.forums, Map.nhash, id, forum);
        #ok(id)
    };

    public func get_forum(state: ForumState, id: Nat) : ?T.ForumResponse {
        switch (Map.get(state.forums, Map.nhash, id)) {
            case (?forum) {
                let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, forum.created_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae"); // Anonymous principal as fallback
                };
                let updated_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, forum.updated_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                ?{
                    id = forum.id;
                    title = forum.title;
                    description = forum.description;
                    sns_root_canister_id = forum.sns_root_canister_id;
                    created_by;
                    created_at = forum.created_at;
                    updated_by;
                    updated_at = forum.updated_at;
                    deleted = forum.deleted;
                }
            };
            case null null;
        }
    };

    public func get_forums(state: ForumState) : [T.ForumResponse] {
        let forums = Buffer.Buffer<T.ForumResponse>(0);
        for ((_, forum) in Map.entries(state.forums)) {
            switch (get_forum(state, forum.id)) {
                case (?forum_response) forums.add(forum_response);
                case null {};
            };
        };
        Buffer.toArray(forums)
    };

    public func get_forum_by_sns_root(state: ForumState, sns_root_canister_id: Principal) : ?T.ForumResponse {
        for ((forum_id, forum) in Map.entries(state.forums)) {
            switch (forum.sns_root_canister_id) {
                case (?root) {
                    if (Principal.equal(root, sns_root_canister_id) and not forum.deleted) {
                        return get_forum(state, forum_id);
                    };
                };
                case null {};
            };
        };
        null
    };

    // Topic operations
    public func create_topic(
        state: ForumState,
        caller: Principal,
        input: T.CreateTopicInput
    ) : Result<Nat, ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };
        create_topic_internal(state, caller, input)
    };

    private func create_topic_internal(
        state: ForumState,
        caller: Principal,
        input: T.CreateTopicInput
    ) : Result<Nat, ForumError> {

        // Validate input
        switch (validate_text(input.title, "Title", state.text_limits.topic_title_max_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };
        switch (validate_text(input.description, "Description", state.text_limits.topic_description_max_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        // Check if forum exists
        switch (Map.get(state.forums, Map.nhash, input.forum_id)) {
            case null return #err(#NotFound("Forum not found"));
            case (?_) {};
        };

        // Check if parent topic exists and belongs to the same forum
        switch (input.parent_topic_id) {
            case (?parent_id) {
                switch (Map.get(state.topics, Map.nhash, parent_id)) {
                    case null return #err(#NotFound("Parent topic not found"));
                    case (?parent_topic) {
                        if (parent_topic.forum_id != input.forum_id) {
                            return #err(#InvalidInput("Parent topic must belong to the same forum"));
                        };
                    };
                };
            };
            case null {};
        };

        let id = get_next_id(state);
        let now = Time.now();
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);

        let topic : Topic = {
            id;
            forum_id = input.forum_id;
            parent_topic_id = input.parent_topic_id;
            title = input.title;
            description = input.description;
            created_by = caller_index;
            created_at = now;
            updated_by = caller_index;
            updated_at = now;
            deleted = false;
        };

        ignore Map.put(state.topics, Map.nhash, id, topic);
        
        // Update indexes
        add_to_index(state.forum_topics, input.forum_id, id);
        switch (input.parent_topic_id) {
            case (?parent_id) add_to_index(state.topic_subtopics, parent_id, id);
            case null {};
        };

        #ok(id)
    };

    public func get_topic(state: ForumState, id: Nat) : ?T.TopicResponse {
        switch (Map.get(state.topics, Map.nhash, id)) {
            case (?topic) {
                let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, topic.created_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                let updated_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, topic.updated_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                ?{
                    id = topic.id;
                    forum_id = topic.forum_id;
                    parent_topic_id = topic.parent_topic_id;
                    title = topic.title;
                    description = topic.description;
                    created_by;
                    created_at = topic.created_at;
                    updated_by;
                    updated_at = topic.updated_at;
                    deleted = topic.deleted;
                }
            };
            case null null;
        }
    };

    public func get_topics_by_forum(state: ForumState, forum_id: Nat) : [T.TopicResponse] {
        let topics = Buffer.Buffer<T.TopicResponse>(0);
        switch (Map.get(state.forum_topics, Map.nhash, forum_id)) {
            case (?topic_ids) {
                for (topic_id in Vector.vals(topic_ids)) {
                    switch (get_topic(state, topic_id)) {
                        case (?topic_response) topics.add(topic_response);
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(topics)
    };

    public func get_subtopics(state: ForumState, topic_id: Nat) : [T.TopicResponse] {
        let topics = Buffer.Buffer<T.TopicResponse>(0);
        switch (Map.get(state.topic_subtopics, Map.nhash, topic_id)) {
            case (?subtopic_ids) {
                for (subtopic_id in Vector.vals(subtopic_ids)) {
                    switch (get_topic(state, subtopic_id)) {
                        case (?topic_response) topics.add(topic_response);
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(topics)
    };

    public func get_subtopics_filtered(state: ForumState, topic_id: Nat, show_deleted: Bool) : [T.TopicResponse] {
        let topics = Buffer.Buffer<T.TopicResponse>(0);
        switch (Map.get(state.topic_subtopics, Map.nhash, topic_id)) {
            case (?subtopic_ids) {
                for (subtopic_id in Vector.vals(subtopic_ids)) {
                    switch (get_topic(state, subtopic_id)) {
                        case (?topic_response) {
                            if (show_deleted or not topic_response.deleted) {
                                topics.add(topic_response);
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(topics)
    };

    // Special topic creation function
    public func create_special_topic(
        state: ForumState,
        caller: Principal,
        input: T.CreateSpecialTopicInput
    ) : async Result<Nat, ForumError> {
        // Find the forum for this SNS
        var found_forum_id : ?Nat = null;
        for ((forum_id, forum) in Map.entries(state.forums)) {
            switch (forum.sns_root_canister_id) {
                case (?root) {
                    if (Principal.equal(root, input.sns_root_canister_id) and not forum.deleted) {
                        found_forum_id := ?forum_id;
                    };
                };
                case null {};
            };
        };

        let forum_id = switch (found_forum_id) {
            case (?fid) fid;
            case null return #err(#NotFound("Forum not found for this SNS"));
        };

        switch (input.special_topic_type) {
            case (#General) {
                // Check if "General" topic already exists at root level
                switch (Map.get(state.forum_topics, Map.nhash, forum_id)) {
                    case (?topic_ids) {
                        for (topic_id in Vector.vals(topic_ids)) {
                            switch (Map.get(state.topics, Map.nhash, topic_id)) {
                                case (?topic) {
                                    if (topic.title == "General" and topic.parent_topic_id == null and not topic.deleted) {
                                        return #err(#AlreadyExists("General topic already exists"));
                                    };
                                };
                                case null {};
                            };
                        };
                    };
                    case null {};
                };

                // Create "General" topic
                let general_topic_input : T.CreateTopicInput = {
                    forum_id = forum_id;
                    parent_topic_id = null;
                    title = "General";
                    description = "General discussion topics for the community";
                };
                
                create_topic_internal(state, caller, general_topic_input)
            };

            case (#Governance) {
                // Check if "Governance" topic already exists at root level
                switch (Map.get(state.forum_topics, Map.nhash, forum_id)) {
                    case (?topic_ids) {
                        for (topic_id in Vector.vals(topic_ids)) {
                            switch (Map.get(state.topics, Map.nhash, topic_id)) {
                                case (?topic) {
                                    if (topic.title == "Governance" and topic.parent_topic_id == null and not topic.deleted) {
                                        return #err(#AlreadyExists("Governance topic already exists"));
                                    };
                                };
                                case null {};
                            };
                        };
                    };
                    case null {};
                };

                // Create "Governance" topic
                let governance_topic_input : T.CreateTopicInput = {
                    forum_id = forum_id;
                    parent_topic_id = null;
                    title = "Governance";
                    description = "Topics related to governance, voting, and decision-making";
                };
                
                create_topic_internal(state, caller, governance_topic_input)
            };

            case (#Preproposals) {
                // First check if "Preproposals" topic already exists
                var preproposals_exists = false;
                switch (Map.get(state.forum_topics, Map.nhash, forum_id)) {
                    case (?topic_ids) {
                        for (topic_id in Vector.vals(topic_ids)) {
                            switch (Map.get(state.topics, Map.nhash, topic_id)) {
                                case (?topic) {
                                    if (topic.title == "Preproposals" and not topic.deleted) {
                                        preproposals_exists := true;
                                    };
                                };
                                case null {};
                            };
                        };
                    };
                    case null {};
                };

                if (preproposals_exists) {
                    return #err(#AlreadyExists("Preproposals topic already exists"));
                };

                // Check if "Governance" topic exists, if not create it
                var governance_topic_id : ?Nat = null;
                switch (Map.get(state.forum_topics, Map.nhash, forum_id)) {
                    case (?topic_ids) {
                        for (topic_id in Vector.vals(topic_ids)) {
                            switch (Map.get(state.topics, Map.nhash, topic_id)) {
                                case (?topic) {
                                    if (topic.title == "Governance" and topic.parent_topic_id == null and not topic.deleted) {
                                        governance_topic_id := ?topic_id;
                                    };
                                };
                                case null {};
                            };
                        };
                    };
                    case null {};
                };

                let governance_topic_id_final = switch (governance_topic_id) {
                    case (?tid) tid;
                    case null {
                        // Create "Governance" topic first
                        let governance_topic_input : T.CreateTopicInput = {
                            forum_id = forum_id;
                            parent_topic_id = null;
                            title = "Governance";
                            description = "Topics related to governance, voting, and decision-making";
                        };
                        
                        switch (create_topic_internal(state, caller, governance_topic_input)) {
                            case (#ok(new_topic_id)) new_topic_id;
                            case (#err(error)) return #err(error);
                        }
                    };
                };

                // Create "Preproposals" topic under Governance
                let preproposals_topic_input : T.CreateTopicInput = {
                    forum_id = forum_id;
                    parent_topic_id = ?governance_topic_id_final;
                    title = "Preproposals";
                    description = "Discussion of potential proposals before formal submission";
                };
                
                create_topic_internal(state, caller, preproposals_topic_input)
            };
        }
    };

    // Thread operations
    public func create_thread(
        state: ForumState,
        caller: Principal,
        input: T.CreateThreadInput
    ) : Result<Nat, ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        // Validate input
        switch (input.title) {
            case (?title) {
                switch (validate_text(title, "Title", state.text_limits.thread_title_max_length)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };
            };
            case null {};
        };
        switch (validate_text(input.body, "Body", state.text_limits.thread_body_max_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        // Check if topic exists
        switch (Map.get(state.topics, Map.nhash, input.topic_id)) {
            case null return #err(#NotFound("Topic not found"));
            case (?_) {};
        };

        let id = get_next_id(state);
        let now = Time.now();
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);

        let thread : Thread = {
            id;
            topic_id = input.topic_id;
            title = input.title;
            body = input.body;
            created_by = caller_index;
            created_at = now;
            updated_by = caller_index;
            updated_at = now;
            deleted = false;
        };

        ignore Map.put(state.threads, Map.nhash, id, thread);
        add_to_index(state.topic_threads, input.topic_id, id);

        #ok(id)
    };

    public func get_thread(state: ForumState, id: Nat) : ?T.ThreadResponse {
        switch (Map.get(state.threads, Map.nhash, id)) {
            case (?thread) {
                let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, thread.created_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                let updated_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, thread.updated_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                ?{
                    id = thread.id;
                    topic_id = thread.topic_id;
                    title = thread.title;
                    body = thread.body;
                    created_by;
                    created_at = thread.created_at;
                    updated_by;
                    updated_at = thread.updated_at;
                    deleted = thread.deleted;
                }
            };
            case null null;
        }
    };

    public func get_threads_by_topic(state: ForumState, topic_id: Nat) : [T.ThreadResponse] {
        let threads = Buffer.Buffer<T.ThreadResponse>(0);
        switch (Map.get(state.topic_threads, Map.nhash, topic_id)) {
            case (?thread_ids) {
                for (thread_id in Vector.vals(thread_ids)) {
                    switch (get_thread(state, thread_id)) {
                        case (?thread_response) threads.add(thread_response);
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(threads)
    };

    public func get_thread_context(state: ForumState, thread_id: Nat) : ?T.ThreadContextResponse {
        // Get thread to get topic_id
        switch (get_thread(state, thread_id)) {
            case (?thread_response) {
                // Get topic to get forum_id
                switch (get_topic(state, thread_response.topic_id)) {
                    case (?topic_response) {
                        // Get forum to get sns_root_canister_id
                        switch (get_forum(state, topic_response.forum_id)) {
                            case (?forum_response) {
                                ?{
                                    thread_id = thread_id;
                                    topic_id = thread_response.topic_id;
                                    forum_id = topic_response.forum_id;
                                    sns_root_canister_id = forum_response.sns_root_canister_id;
                                }
                            };
                            case null null;
                        };
                    };
                    case null null;
                };
            };
            case null null;
        }
    };

    // Post operations
    public func create_post(
        state: ForumState,
        caller: Principal,
        thread_id: Nat,
        reply_to_post_id: ?Nat,
        title: ?Text,
        body: Text,
        initial_voting_power: Nat,
        current_time: Int
    ) : Result<Nat, ForumError> {
        // Validate input
        switch (title) {
            case (?t) {
                switch (validate_text(t, "Title", state.text_limits.post_title_max_length)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };
            };
            case null {};
        };
        switch (validate_text(body, "Body", state.text_limits.post_body_max_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        // Check if thread exists
        switch (Map.get(state.threads, Map.nhash, thread_id)) {
            case null return #err(#NotFound("Thread not found"));
            case (?_) {};
        };

        // Check if reply_to_post exists and belongs to the same thread
        switch (reply_to_post_id) {
            case (?reply_id) {
                switch (Map.get(state.posts, Map.nhash, reply_id)) {
                    case null return #err(#NotFound("Reply target post not found"));
                    case (?reply_post) {
                        if (reply_post.thread_id != thread_id) {
                            return #err(#InvalidInput("Reply target must be in the same thread"));
                        };
                    };
                };
            };
            case null {};
        };

        let id = get_next_id(state);
        let now = Time.now();
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);

        let post : Post = {
            id;
            thread_id = thread_id;
            reply_to_post_id = reply_to_post_id;
            title = title;
            body = body;
            upvote_score = initial_voting_power;
            downvote_score = 0;
            created_by = caller_index;
            created_at = now;
            updated_by = caller_index;
            updated_at = now;
            deleted = false;
        };

        ignore Map.put(state.posts, Map.nhash, id, post);
        add_to_index(state.thread_posts, thread_id, id);
        
        switch (reply_to_post_id) {
            case (?reply_id) add_to_index(state.post_replies, reply_id, id);
            case null {};
        };

        #ok(id)
    };

    public func get_post(state: ForumState, id: Nat) : ?T.PostResponse {
        switch (Map.get(state.posts, Map.nhash, id)) {
            case (?post) {
                let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, post.created_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                let updated_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, post.updated_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                ?{
                    id = post.id;
                    thread_id = post.thread_id;
                    reply_to_post_id = post.reply_to_post_id;
                    title = post.title;
                    body = post.body;
                    upvote_score = post.upvote_score;
                    downvote_score = post.downvote_score;
                    created_by;
                    created_at = post.created_at;
                    updated_by;
                    updated_at = post.updated_at;
                    deleted = post.deleted;
                }
            };
            case null null;
        }
    };

    public func get_posts_by_thread(state: ForumState, thread_id: Nat) : [T.PostResponse] {
        let posts = Buffer.Buffer<T.PostResponse>(0);
        switch (Map.get(state.thread_posts, Map.nhash, thread_id)) {
            case (?post_ids) {
                for (post_id in Vector.vals(post_ids)) {
                    switch (get_post(state, post_id)) {
                        case (?post_response) posts.add(post_response);
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(posts)
    };

    public func get_post_replies(state: ForumState, post_id: Nat) : [T.PostResponse] {
        let posts = Buffer.Buffer<T.PostResponse>(0);
        switch (Map.get(state.post_replies, Map.nhash, post_id)) {
            case (?reply_ids) {
                for (reply_id in Vector.vals(reply_ids)) {
                    switch (get_post(state, reply_id)) {
                        case (?post_response) posts.add(post_response);
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(posts)
    };

    // Voting operations
    private func vote_on_post(
        state: ForumState,
        caller: Principal,
        post_id: Nat,
        vote_type: VoteType,
        neuron_id: NeuronId,
        voting_power: Nat,
        current_time: Int
    ) : Result<(), ForumError> {
        // Check if post exists
        let post = switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?p) p;
            case null return #err(#NotFound("Post not found"));
        };

        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let neuron_index = Dedup.getOrCreateIndex(state.neuron_dedup_state, neuron_id.id);
        
        let vote_key : VoteKey = (post_id, neuron_index);

        // Check if vote already exists
        switch (Map.get(state.votes, vote_key_hash_utils, vote_key)) {
            case (?existing_vote) {
                // Update existing vote
                let updated_vote : Vote = {
                    post_id;
                    neuron_id = neuron_index;
                    voter_principal = caller_index;
                    vote_type;
                    voting_power;
                    created_at = existing_vote.created_at;
                    updated_at = current_time;
                };

                // Update post scores
                let updated_post = switch (existing_vote.vote_type, vote_type) {
                    case (#upvote, #upvote) {
                        // Same vote type, just update voting power
                        let new_upvote_score = if (post.upvote_score >= existing_vote.voting_power) {
                            post.upvote_score - existing_vote.voting_power + voting_power
                        } else {
                            voting_power
                        };
                        {
                            post with
                            upvote_score = new_upvote_score;
                            updated_at = current_time;
                        }
                    };
                    case (#downvote, #downvote) {
                        // Same vote type, just update voting power
                        let new_downvote_score = if (post.downvote_score >= existing_vote.voting_power) {
                            post.downvote_score - existing_vote.voting_power + voting_power
                        } else {
                            voting_power
                        };
                        {
                            post with
                            downvote_score = new_downvote_score;
                            updated_at = current_time;
                        }
                    };
                    case (#upvote, #downvote) {
                        // Changed from upvote to downvote
                        let new_upvote_score = if (post.upvote_score >= existing_vote.voting_power) {
                            post.upvote_score - existing_vote.voting_power
                        } else {
                            0
                        };
                        {
                            post with
                            upvote_score = new_upvote_score;
                            downvote_score = post.downvote_score + voting_power;
                            updated_at = current_time;
                        }
                    };
                    case (#downvote, #upvote) {
                        // Changed from downvote to upvote
                        let new_downvote_score = if (post.downvote_score >= existing_vote.voting_power) {
                            post.downvote_score - existing_vote.voting_power
                        } else {
                            0
                        };
                        {
                            post with
                            downvote_score = new_downvote_score;
                            upvote_score = post.upvote_score + voting_power;
                            updated_at = current_time;
                        }
                    };
                };

                ignore Map.put(state.votes, vote_key_hash_utils, vote_key, updated_vote);
                ignore Map.put(state.posts, Map.nhash, post_id, updated_post);
            };
            case null {
                // Create new vote
                let new_vote : Vote = {
                    post_id;
                    neuron_id = neuron_index;
                    voter_principal = caller_index;
                    vote_type;
                    voting_power;
                    created_at = current_time;
                    updated_at = current_time;
                };

                let updated_post = switch (vote_type) {
                    case (#upvote) {
                        {
                            post with
                            upvote_score = post.upvote_score + voting_power;
                            updated_at = current_time;
                        }
                    };
                    case (#downvote) {
                        {
                            post with
                            downvote_score = post.downvote_score + voting_power;
                            updated_at = current_time;
                        }
                    };
                };

                ignore Map.put(state.votes, vote_key_hash_utils, vote_key, new_vote);
                ignore Map.put(state.posts, Map.nhash, post_id, updated_post);
            };
        };

        #ok()
    };

    private func retract_vote(
        state: ForumState,
        post_id: Nat,
        neuron_id: NeuronId
    ) : Result<(), ForumError> {
        // Check if post exists
        let post = switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?p) p;
            case null return #err(#NotFound("Post not found"));
        };

        let neuron_index = Dedup.getOrCreateIndex(state.neuron_dedup_state, neuron_id.id);
        
        let vote_key : VoteKey = (post_id, neuron_index);

        // Check if vote exists
        let existing_vote = switch (Map.get(state.votes, vote_key_hash_utils, vote_key)) {
            case (?vote) vote;
            case null return #err(#NotFound("Vote not found"));
        };

        // Update post scores
        let updated_post = switch (existing_vote.vote_type) {
            case (#upvote) {
                {
                    post with
                    upvote_score = if (post.upvote_score >= existing_vote.voting_power) {
                        post.upvote_score - existing_vote.voting_power
                    } else { 0 };
                    updated_at = Time.now();
                }
            };
            case (#downvote) {
                {
                    post with
                    downvote_score = if (post.downvote_score >= existing_vote.voting_power) {
                        post.downvote_score - existing_vote.voting_power
                    } else { 0 };
                    updated_at = Time.now();
                }
            };
        };

        ignore Map.remove(state.votes, vote_key_hash_utils, vote_key);
        ignore Map.put(state.posts, Map.nhash, post_id, updated_post);

        #ok()
    };

    public func get_post_votes(state: ForumState, post_id: Nat) : [T.VoteResponse] {
        let votes = Buffer.Buffer<T.VoteResponse>(0);
        for ((vote_key, vote) in Map.entries(state.votes)) {
            if (vote_key.0 == post_id) {
                let voter_principal = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, vote.voter_principal)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                let neuron_id = switch (Dedup.getBlob(state.neuron_dedup_state, vote.neuron_id)) {
                    case (?blob) {
                        // Extract neuron ID from blob (this is a simplified approach)
                        { id = blob }
                    };
                    case null {
                        { id = Blob.fromArray([]) }
                    };
                };
                votes.add({
                    post_id = vote.post_id;
                    neuron_id;
                    voter_principal;
                    vote_type = vote.vote_type;
                    voting_power = vote.voting_power;
                    created_at = vote.created_at;
                    updated_at = vote.updated_at;
                });
            };
        };
        Buffer.toArray(votes)
    };

    // Get votes for specific neurons across all posts in a thread
    public func get_thread_votes_for_neurons(state: ForumState, thread_id: Nat, neuron_ids: [T.NeuronId]) : [T.ThreadVoteResponse] {
        // First, get all posts in the thread
        let thread_posts = switch (Map.get(state.thread_posts, Map.nhash, thread_id)) {
            case (?post_ids) Vector.toArray(post_ids);
            case null [];
        };

        // Create a map to store votes by post_id
        let post_votes_map = Map.new<Nat, Buffer.Buffer<T.NeuronVote>>();

        // Convert neuron IDs to their deduplicated indices for efficient lookup
        let neuron_indices = Buffer.Buffer<Nat32>(neuron_ids.size());
        for (neuron_id in neuron_ids.vals()) {
            switch (Dedup.getIndex(state.neuron_dedup_state, neuron_id.id)) {
                case (?index) neuron_indices.add(index);
                case null {}; // Neuron not found in dedup state, skip
            };
        };

        // Search through all votes for matching post_id and neuron_id combinations
        for ((vote_key, vote) in Map.entries(state.votes)) {
            let (post_id, neuron_index) = vote_key;
            
            // Check if this vote is for a post in our thread
            let is_in_thread = Array.find<Nat>(thread_posts, func(id) = id == post_id) != null;
            
            // Check if this vote is from one of our target neurons
            let is_target_neuron = Array.find<Nat32>(Buffer.toArray(neuron_indices), func(idx) = idx == neuron_index) != null;
            
            if (is_in_thread and is_target_neuron) {
                // Get the original neuron ID from the dedup state
                let neuron_id : T.NeuronId = switch (Dedup.getBlob(state.neuron_dedup_state, neuron_index)) {
                    case (?blob) {
                        { id = blob }
                    };
                    case null {
                        { id = Blob.fromArray([]) }
                    };
                };

                let neuron_vote : T.NeuronVote = {
                    neuron_id = neuron_id;
                    vote_type = vote.vote_type;
                    voting_power = vote.voting_power;
                    created_at = vote.created_at;
                    updated_at = vote.updated_at;
                };

                // Add to the post's vote collection
                switch (Map.get(post_votes_map, Map.nhash, post_id)) {
                    case (?existing_votes) existing_votes.add(neuron_vote);
                    case null {
                        let new_votes = Buffer.Buffer<T.NeuronVote>(1);
                        new_votes.add(neuron_vote);
                        ignore Map.put(post_votes_map, Map.nhash, post_id, new_votes);
                    };
                };
            };
        };

        // Convert the map to the response format
        let response = Buffer.Buffer<T.ThreadVoteResponse>(Map.size(post_votes_map));
        for ((post_id, votes_buffer) in Map.entries(post_votes_map)) {
            response.add({
                post_id;
                neuron_votes = Buffer.toArray(votes_buffer);
            });
        };

        Buffer.toArray(response)
    };

    // Get votes for specific neurons on a single post
    public func get_post_votes_for_neurons(state: ForumState, post_id: Nat, neuron_ids: [T.NeuronId]) : ?T.ThreadVoteResponse {
        // Get all votes for this post - need to filter from all votes
        let all_votes = Map.entries(state.votes);
        let post_votes = Buffer.Buffer<T.Vote>(0);
        
        for ((vote_key, vote) in all_votes) {
            if (vote_key.0 == post_id) {
                post_votes.add(vote);
            };
        };
        
        let post_votes_array = Buffer.toArray(post_votes);

        // Convert neuron IDs to their deduplicated indices for efficient lookup
        let neuron_indices = Buffer.Buffer<Nat32>(neuron_ids.size());
        for (neuron_id in neuron_ids.vals()) {
            switch (Dedup.getIndex(state.neuron_dedup_state, neuron_id.id)) {
                case (?index) neuron_indices.add(index);
                case null {}; // Neuron not found in dedup state, skip
            };
        };
        let neuron_indices_array = Buffer.toArray(neuron_indices);

        // Collect votes from the specified neurons
        let matching_votes = Buffer.Buffer<T.NeuronVote>(0);
        
        for (vote in post_votes_array.vals()) {
            // Check if this vote is from one of our target neurons
            for (target_index in neuron_indices_array.vals()) {
                if (vote.neuron_id == target_index) {
                    // Reconstruct the neuron_id from the dedup state
                    let neuron_id = switch (Dedup.getBlob(state.neuron_dedup_state, target_index)) {
                        case (?blob) {
                            { id = blob }
                        };
                        case null {
                            // Fallback to empty blob if not found
                            { id = Blob.fromArray([]) }
                        };
                    };

                    let neuron_vote : T.NeuronVote = {
                        neuron_id = neuron_id;
                        vote_type = vote.vote_type;
                        voting_power = vote.voting_power;
                        created_at = vote.created_at;
                        updated_at = vote.updated_at;
                    };

                    matching_votes.add(neuron_vote);
                };
            };
        };

        // Return the response if we found any votes
        if (matching_votes.size() > 0) {
            ?{
                post_id;
                neuron_votes = Buffer.toArray(matching_votes);
            }
        } else {
            ?{
                post_id;
                neuron_votes = [];
            }
        }
    };

    // Tip functions
    public func create_tip(
        state: ForumState,
        caller: Principal,
        input: CreateTipInput
    ) : Result<Nat, ForumError> {
        // Validate that the post exists and get its thread_id
        let post = switch (Map.get(state.posts, Map.nhash, input.post_id)) {
            case (?p) p;
            case null return #err(#NotFound("Post not found"));
        };

        let id = get_next_id(state);
        let now = Time.now();
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let recipient_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, input.to_principal);

        let tip : Tip = {
            id;
            from_principal = caller_index;
            to_principal = recipient_index;
            post_id = input.post_id;
            thread_id = post.thread_id;
            token_ledger_principal = input.token_ledger_principal;
            amount = input.amount;
            transaction_block_index = input.transaction_block_index;
            created_at = now;
            created_by = caller_index;
        };

        ignore Map.put(state.tips, Map.nhash, id, tip);
        add_to_index(state.post_tips, input.post_id, id);
        add_to_index(state.thread_tips, post.thread_id, id);
        add_to_index_32(state.tips_given, caller_index, id);
        add_to_index_32(state.tips_received, recipient_index, id);

        #ok(id)
    };

    public func get_tip(state: ForumState, id: Nat) : ?TipResponse {
        switch (Map.get(state.tips, Map.nhash, id)) {
            case (?tip) {
                let from_principal = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, tip.from_principal)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae"); // Anonymous principal fallback
                };
                let to_principal = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, tip.to_principal)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae"); // Anonymous principal fallback
                };
                let created_by_principal = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, tip.created_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae"); // Anonymous principal fallback
                };
                
                ?{
                    id = tip.id;
                    from_principal;
                    to_principal;
                    post_id = tip.post_id;
                    thread_id = tip.thread_id;
                    token_ledger_principal = tip.token_ledger_principal;
                    amount = tip.amount;
                    transaction_block_index = tip.transaction_block_index;
                    created_at = tip.created_at;
                    created_by = created_by_principal;
                }
            };
            case null null;
        }
    };

    public func get_tips_by_post(state: ForumState, post_id: Nat) : [TipResponse] {
        switch (Map.get(state.post_tips, Map.nhash, post_id)) {
            case (?tip_ids) {
                let tips = Buffer.Buffer<TipResponse>(Vector.size(tip_ids));
                for (tip_id in Vector.vals(tip_ids)) {
                    switch (get_tip(state, tip_id)) {
                        case (?tip) tips.add(tip);
                        case null {}; // Skip if tip not found
                    };
                };
                Buffer.toArray(tips)
            };
            case null [];
        }
    };

    public func get_tips_by_thread(state: ForumState, thread_id: Nat) : [TipResponse] {
        switch (Map.get(state.thread_tips, Map.nhash, thread_id)) {
            case (?tip_ids) {
                let tips = Buffer.Buffer<TipResponse>(Vector.size(tip_ids));
                for (tip_id in Vector.vals(tip_ids)) {
                    switch (get_tip(state, tip_id)) {
                        case (?tip) tips.add(tip);
                        case null {}; // Skip if tip not found
                    };
                };
                Buffer.toArray(tips)
            };
            case null [];
        }
    };

    public func get_tips_given_by_user(state: ForumState, user_principal: Principal) : [TipResponse] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no tips given
        };
        
        switch (Map.get(state.tips_given, Map.n32hash, user_index)) {
            case (?tip_ids) {
                let tips = Buffer.Buffer<TipResponse>(Vector.size(tip_ids));
                for (tip_id in Vector.vals(tip_ids)) {
                    switch (get_tip(state, tip_id)) {
                        case (?tip) tips.add(tip);
                        case null {}; // Skip if tip not found
                    };
                };
                Buffer.toArray(tips)
            };
            case null [];
        }
    };

    public func get_tips_received_by_user(state: ForumState, user_principal: Principal) : [TipResponse] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no tips received
        };
        
        switch (Map.get(state.tips_received, Map.n32hash, user_index)) {
            case (?tip_ids) {
                let tips = Buffer.Buffer<TipResponse>(Vector.size(tip_ids));
                for (tip_id in Vector.vals(tip_ids)) {
                    switch (get_tip(state, tip_id)) {
                        case (?tip) tips.add(tip);
                        case null {}; // Skip if tip not found
                    };
                };
                Buffer.toArray(tips)
            };
            case null [];
        }
    };

    // Efficient method for wallet integration - returns only token summaries
    public func get_tip_tokens_received_by_user(state: ForumState, user_principal: Principal) : [T.TipTokenSummary] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no tips received
        };
        
        switch (Map.get(state.tips_received, Map.n32hash, user_index)) {
            case (?tip_ids) {
                // Track token totals and counts
                let token_summaries = Map.new<Principal, Nat>();
                let token_counts = Map.new<Principal, Nat>();
                
                for (tip_id in Vector.vals(tip_ids)) {
                    switch (Map.get(state.tips, Map.nhash, tip_id)) {
                        case (?tip) {
                            let token_principal = tip.token_ledger_principal;
                            
                            // Update total amount
                            let current_amount = switch (Map.get(token_summaries, Map.phash, token_principal)) {
                                case (?amount) amount;
                                case null 0;
                            };
                            ignore Map.put(token_summaries, Map.phash, token_principal, current_amount + tip.amount);
                            
                            // Update tip count
                            let current_count = switch (Map.get(token_counts, Map.phash, token_principal)) {
                                case (?count) count;
                                case null 0;
                            };
                            ignore Map.put(token_counts, Map.phash, token_principal, current_count + 1);
                        };
                        case null {}; // Skip if tip not found
                    };
                };
                
                // Convert to array of TipTokenSummary
                let summaries = Buffer.Buffer<T.TipTokenSummary>(Map.size(token_summaries));
                for ((token_principal, total_amount) in Map.entries(token_summaries)) {
                    let tip_count = switch (Map.get(token_counts, Map.phash, token_principal)) {
                        case (?count) count;
                        case null 0;
                    };
                    summaries.add({
                        token_ledger_principal = token_principal;
                        total_amount = total_amount;
                        tip_count = tip_count;
                    });
                };
                
                Buffer.toArray(summaries)
            };
            case null [];
        }
    };

    // Get tips received by user since a specific timestamp (for notifications)
    // Get tips received since the user's last seen timestamp (or all if never seen)
    public func get_recent_tips_received(state: ForumState, user_principal: Principal) : [TipResponse] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no tips received
        };
        
        // Get user's last seen timestamp (0 if never seen)
        let since_timestamp = switch (Map.get(state.user_last_seen_tips, Map.n32hash, user_index)) {
            case (?timestamp) timestamp;
            case null 0; // If never seen, return all tips (since 0)
        };
        
        switch (Map.get(state.tips_received, Map.n32hash, user_index)) {
            case (?tip_ids) {
                let new_tips = Buffer.Buffer<TipResponse>(0);
                
                for (tip_id in Vector.vals(tip_ids)) {
                    switch (get_tip(state, tip_id)) {
                        case (?tip_response) {
                            // Only include tips created after the since_timestamp
                            if (tip_response.created_at > since_timestamp) {
                                new_tips.add(tip_response);
                            }
                        };
                        case null {}; // Skip if tip not found
                    };
                };
                
                Buffer.toArray(new_tips)
            };
            case null [];
        }
    };

    // Get count of tips received since the user's last seen timestamp (optimized for notifications)
    public func get_recent_tips_count(state: ForumState, user_principal: Principal) : Nat {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return 0; // User not found in dedup, so no tips received
        };
        
        // Get user's last seen timestamp (0 if never seen)
        let since_timestamp = switch (Map.get(state.user_last_seen_tips, Map.n32hash, user_index)) {
            case (?timestamp) timestamp;
            case null 0; // If never seen, count all tips (since 0)
        };
        
        switch (Map.get(state.tips_received, Map.n32hash, user_index)) {
            case (?tip_ids) {
                var count = 0;
                
                for (tip_id in Vector.vals(tip_ids)) {
                    switch (get_tip(state, tip_id)) {
                        case (?tip_response) {
                            // Only count tips created after the since_timestamp
                            if (tip_response.created_at > since_timestamp) {
                                count += 1;
                            }
                        };
                        case null {}; // Skip if tip not found
                    };
                };
                
                count
            };
            case null 0;
        }
    };

    // Get count of replies to user since their last seen timestamp (optimized for notifications)
    public func get_recent_replies_count(state: ForumState, user_principal: Principal) : Nat {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return 0; // User not found in dedup, so no replies received
        };
        
        // Get user's last seen replies timestamp (0 if never seen)
        let since_timestamp = switch (Map.get(state.user_last_seen_replies, Map.n32hash, user_index)) {
            case (?timestamp) timestamp;
            case null 0; // If never seen, count all replies (since 0)
        };
        
        var count = 0;
        
        // First, find all posts created by the user
        let user_post_ids = Buffer.Buffer<Nat>(0);
        for ((post_id, post) in Map.entries(state.posts)) {
            if (post.created_by == user_index and not post.deleted) {
                user_post_ids.add(post_id);
            };
        };
        
        // Then count replies to the user's posts that are newer than since_timestamp
        for ((reply_id, reply_post) in Map.entries(state.posts)) {
            if (not reply_post.deleted and reply_post.created_at > since_timestamp) {
                switch (reply_post.reply_to_post_id) {
                    case (?parent_post_id) {
                        // Check if this reply is to one of the user's posts
                        let user_post_array = Buffer.toArray(user_post_ids);
                        for (user_post_id in user_post_array.vals()) {
                            if (parent_post_id == user_post_id) {
                                count += 1;
                            };
                        };
                    };
                    case null {}; // Not a reply, skip
                };
            };
        };
        
        count
    };

    // Mark replies as seen up to a specific timestamp
    public func mark_replies_seen_up_to(state: ForumState, user_principal: Principal, timestamp: Int) : () {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return; // User not found in dedup, nothing to update
        };
        
        // Update the user's last seen replies timestamp
        ignore Map.put(state.user_last_seen_replies, Map.n32hash, user_index, timestamp);
    };

    // Get the last seen replies timestamp for a user
    public func get_last_seen_replies_timestamp(state: ForumState, user_principal: Principal) : ?Int {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return null; // User not found in dedup
        };
        
        Map.get(state.user_last_seen_replies, Map.n32hash, user_index)
    };

    // Legacy method - keep for backward compatibility but rename parameter for clarity
    public func get_tips_received_since(state: ForumState, user_principal: Principal, since_timestamp: Int) : [TipResponse] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no tips received
        };
        
        switch (Map.get(state.tips_received, Map.n32hash, user_index)) {
            case (?tip_ids) {
                let new_tips = Buffer.Buffer<TipResponse>(0);
                
                for (tip_id in Vector.vals(tip_ids)) {
                    switch (get_tip(state, tip_id)) {
                        case (?tip_response) {
                            // Only include tips created after the since_timestamp
                            if (tip_response.created_at > since_timestamp) {
                                new_tips.add(tip_response);
                            }
                        };
                        case null {}; // Skip if tip not found
                    };
                };
                
                Buffer.toArray(new_tips)
            };
            case null [];
        }
    };

    // Mark tips as seen up to a specific timestamp (update method)
    public func mark_tips_seen_up_to(state: ForumState, user_principal: Principal, timestamp: Int) : () {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return; // User not found in dedup, nothing to update
        };
        
        // Update the user's last seen timestamp
        ignore Map.put(state.user_last_seen_tips, Map.n32hash, user_index, timestamp);
    };

    // Get the last seen tip timestamp for a user (helper method)
    public func get_last_seen_tip_timestamp(state: ForumState, user_principal: Principal) : ?Int {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return null; // User not found in dedup
        };
        
        Map.get(state.user_last_seen_tips, Map.n32hash, user_index)
    };

    public func get_tip_stats(state: ForumState) : TipStats {
        let total_tips = Map.size(state.tips);
        let token_amounts = Map.new<Principal, Nat>();
        
        for (tip in Map.vals(state.tips)) {
            let current_amount = switch (Map.get(token_amounts, Map.phash, tip.token_ledger_principal)) {
                case (?amount) amount;
                case null 0;
            };
            ignore Map.put(token_amounts, Map.phash, tip.token_ledger_principal, current_amount + tip.amount);
        };

        {
            total_tips;
            total_tip_amount_by_token = Iter.toArray(Map.entries(token_amounts));
        }
    };

    // Post query functions by user
    public func get_posts_by_user(state: ForumState, user_principal: Principal) : [T.PostResponse] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no posts
        };
        
        let posts = Buffer.Buffer<T.PostResponse>(0);
        for ((post_id, post) in Map.entries(state.posts)) {
            if (post.created_by == user_index and not post.deleted) {
                switch (get_post(state, post_id)) {
                    case (?post_response) posts.add(post_response);
                    case null {}; // Skip if post not found
                };
            };
        };
        
        // Sort by creation time (newest first)
        let sorted_posts = Array.sort(Buffer.toArray(posts), func(a: T.PostResponse, b: T.PostResponse) : Order.Order {
            if (a.created_at > b.created_at) #less
            else if (a.created_at < b.created_at) #greater
            else #equal
        });
        
        sorted_posts
    };

    public func get_replies_to_user(state: ForumState, user_principal: Principal) : [T.PostResponse] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no replies
        };
        
        let replies = Buffer.Buffer<T.PostResponse>(0);
        
        // First, find all posts created by the user
        let user_post_ids = Buffer.Buffer<Nat>(0);
        for ((post_id, post) in Map.entries(state.posts)) {
            if (post.created_by == user_index and not post.deleted) {
                user_post_ids.add(post_id);
            };
        };
        
        // Then find all posts that reply to the user's posts
        for ((reply_id, reply_post) in Map.entries(state.posts)) {
            if (not reply_post.deleted) {
                switch (reply_post.reply_to_post_id) {
                    case (?parent_post_id) {
                        // Check if this reply is to one of the user's posts
                        let user_post_array = Buffer.toArray(user_post_ids);
                        for (user_post_id in user_post_array.vals()) {
                            if (parent_post_id == user_post_id) {
                                switch (get_post(state, reply_id)) {
                                    case (?reply_response) replies.add(reply_response);
                                    case null {}; // Skip if post not found
                                };
                            };
                        };
                    };
                    case null {}; // Not a reply, skip
                };
            };
        };
        
        // Sort by creation time (newest first)
        let sorted_replies = Array.sort(Buffer.toArray(replies), func(a: T.PostResponse, b: T.PostResponse) : Order.Order {
            if (a.created_at > b.created_at) #less
            else if (a.created_at < b.created_at) #greater
            else #equal
        });
        
        sorted_replies
    };

    // Soft delete operations
    public func soft_delete_forum(
        state: ForumState,
        caller: Principal,
        forum_id: Nat
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.forums, Map.nhash, forum_id)) {
            case (?forum) {
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let updated_forum = {
                    forum with
                    deleted = true;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.forums, Map.nhash, forum_id, updated_forum);
                #ok()
            };
            case null #err(#NotFound("Forum not found"));
        }
    };

    public func soft_delete_topic(
        state: ForumState,
        caller: Principal,
        topic_id: Nat
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.topics, Map.nhash, topic_id)) {
            case (?topic) {
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let updated_topic = {
                    topic with
                    deleted = true;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.topics, Map.nhash, topic_id, updated_topic);
                #ok()
            };
            case null #err(#NotFound("Topic not found"));
        }
    };

    public func soft_delete_thread(
        state: ForumState,
        caller: Principal,
        thread_id: Nat
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.threads, Map.nhash, thread_id)) {
            case (?thread) {
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let updated_thread = {
                    thread with
                    deleted = true;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.threads, Map.nhash, thread_id, updated_thread);
                #ok()
            };
            case null #err(#NotFound("Thread not found"));
        }
    };

    public func soft_delete_post(
        state: ForumState,
        caller: Principal,
        post_id: Nat
    ) : Result<(), ForumError> {
        switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?post) {
                // Check if caller is admin or post owner
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let is_post_owner = (post.created_by == caller_index);
                
                if (not (is_admin(state, caller) or is_post_owner)) {
                    return #err(#Unauthorized("Only admins or post owners can delete posts"));
                };

                let updated_post = {
                    post with
                    deleted = true;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.posts, Map.nhash, post_id, updated_post);
                #ok()
            };
            case null #err(#NotFound("Post not found"));
        }
    };

    // Undelete operations
    public func undelete_forum(
        state: ForumState,
        caller: Principal,
        forum_id: Nat
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.forums, Map.nhash, forum_id)) {
            case (?forum) {
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let updated_forum = {
                    forum with
                    deleted = false;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.forums, Map.nhash, forum_id, updated_forum);
                #ok()
            };
            case null #err(#NotFound("Forum not found"));
        }
    };

    public func undelete_topic(
        state: ForumState,
        caller: Principal,
        topic_id: Nat
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.topics, Map.nhash, topic_id)) {
            case (?topic) {
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let updated_topic = {
                    topic with
                    deleted = false;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.topics, Map.nhash, topic_id, updated_topic);
                #ok()
            };
            case null #err(#NotFound("Topic not found"));
        }
    };

    public func undelete_thread(
        state: ForumState,
        caller: Principal,
        thread_id: Nat
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.threads, Map.nhash, thread_id)) {
            case (?thread) {
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let updated_thread = {
                    thread with
                    deleted = false;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.threads, Map.nhash, thread_id, updated_thread);
                #ok()
            };
            case null #err(#NotFound("Thread not found"));
        }
    };

    public func undelete_post(
        state: ForumState,
        caller: Principal,
        post_id: Nat
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?post) {
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let updated_post = {
                    post with
                    deleted = false;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.posts, Map.nhash, post_id, updated_post);
                #ok()
            };
            case null #err(#NotFound("Post not found"));
        }
    };

    // Helper function to filter out deleted items for non-admin users
    public func get_forums_filtered(state: ForumState, show_deleted: Bool) : [T.ForumResponse] {
        let forums = Buffer.Buffer<T.ForumResponse>(0);
        for ((_, forum) in Map.entries(state.forums)) {
            if (show_deleted or not forum.deleted) {
                switch (get_forum(state, forum.id)) {
                    case (?forum_response) forums.add(forum_response);
                    case null {};
                };
            };
        };
        Buffer.toArray(forums)
    };

    public func get_topics_by_forum_filtered(state: ForumState, forum_id: Nat, show_deleted: Bool) : [T.TopicResponse] {
        let topics = Buffer.Buffer<T.TopicResponse>(0);
        switch (Map.get(state.forum_topics, Map.nhash, forum_id)) {
            case (?topic_ids) {
                for (topic_id in Vector.vals(topic_ids)) {
                    switch (get_topic(state, topic_id)) {
                        case (?topic_response) {
                            if (show_deleted or not topic_response.deleted) {
                                topics.add(topic_response);
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(topics)
    };

    public func get_threads_by_topic_filtered(state: ForumState, topic_id: Nat, show_deleted: Bool) : [T.ThreadResponse] {
        let threads = Buffer.Buffer<T.ThreadResponse>(0);
        switch (Map.get(state.topic_threads, Map.nhash, topic_id)) {
            case (?thread_ids) {
                for (thread_id in Vector.vals(thread_ids)) {
                    switch (get_thread(state, thread_id)) {
                        case (?thread_response) {
                            if (show_deleted or not thread_response.deleted) {
                                threads.add(thread_response);
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(threads)
    };

    public func get_posts_by_thread_filtered(state: ForumState, thread_id: Nat, show_deleted: Bool) : [T.PostResponse] {
        let posts = Buffer.Buffer<T.PostResponse>(0);
        switch (Map.get(state.thread_posts, Map.nhash, thread_id)) {
            case (?post_ids) {
                for (post_id in Vector.vals(post_ids)) {
                    switch (get_post(state, post_id)) {
                        case (?post_response) {
                            if (show_deleted or not post_response.deleted) {
                                posts.add(post_response);
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(posts)
    };

    // Filtered individual get functions for admin access control
    public func get_forum_filtered(state: ForumState, id: Nat, show_deleted: Bool) : ?T.ForumResponse {
        switch (get_forum(state, id)) {
            case (?forum_response) {
                if (show_deleted or not forum_response.deleted) {
                    ?forum_response
                } else {
                    null
                }
            };
            case null null;
        }
    };

    public func get_topic_filtered(state: ForumState, id: Nat, show_deleted: Bool) : ?T.TopicResponse {
        switch (get_topic(state, id)) {
            case (?topic_response) {
                if (show_deleted or not topic_response.deleted) {
                    ?topic_response
                } else {
                    null
                }
            };
            case null null;
        }
    };

    public func get_thread_filtered(state: ForumState, id: Nat, show_deleted: Bool) : ?T.ThreadResponse {
        switch (get_thread(state, id)) {
            case (?thread_response) {
                if (show_deleted or not thread_response.deleted) {
                    ?thread_response
                } else {
                    null
                }
            };
            case null null;
        }
    };

    public func get_post_filtered(state: ForumState, id: Nat, show_deleted: Bool) : ?T.PostResponse {
        switch (get_post(state, id)) {
            case (?post_response) {
                if (show_deleted or not post_response.deleted) {
                    ?post_response
                } else {
                    null
                }
            };
            case null null;
        }
    };

    public func get_post_replies_filtered(state: ForumState, post_id: Nat, show_deleted: Bool) : [T.PostResponse] {
        let posts = Buffer.Buffer<T.PostResponse>(0);
        switch (Map.get(state.post_replies, Map.nhash, post_id)) {
            case (?reply_ids) {
                for (reply_id in Vector.vals(reply_ids)) {
                    switch (get_post(state, reply_id)) {
                        case (?post_response) {
                            if (show_deleted or not post_response.deleted) {
                                posts.add(post_response);
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };
        Buffer.toArray(posts)
    };

    // Update operations
    public func update_forum(
        state: ForumState,
        caller: Principal,
        forum_id: Nat,
        input: T.CreateForumInput
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.forums, Map.nhash, forum_id)) {
            case (?forum) {
                // Validate input
                switch (validate_text(input.title, "Title", state.text_limits.forum_title_max_length)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };
                switch (validate_text(input.description, "Description", state.text_limits.forum_description_max_length)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };

                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let sns_root = switch (input.sns_root_canister_id) {
                    case (?root) ?root;
                    case null ?T.sneed_dao_root_canister_id();
                };

                let updated_forum = {
                    forum with
                    title = input.title;
                    description = input.description;
                    sns_root_canister_id = sns_root;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.forums, Map.nhash, forum_id, updated_forum);
                #ok()
            };
            case null #err(#NotFound("Forum not found"));
        }
    };

    public func update_topic(
        state: ForumState,
        caller: Principal,
        topic_id: Nat,
        input: T.CreateTopicInput
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.topics, Map.nhash, topic_id)) {
            case (?topic) {
                // Validate input
                switch (validate_text(input.title, "Title", state.text_limits.topic_title_max_length)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };
                switch (validate_text(input.description, "Description", state.text_limits.topic_description_max_length)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };

                // Check if parent topic exists and belongs to the same forum (if provided)
                switch (input.parent_topic_id) {
                    case (?parent_id) {
                        if (parent_id != topic_id) { // Can't be parent of itself
                            switch (Map.get(state.topics, Map.nhash, parent_id)) {
                                case null return #err(#NotFound("Parent topic not found"));
                                case (?parent_topic) {
                                    if (parent_topic.forum_id != topic.forum_id) {
                                        return #err(#InvalidInput("Parent topic must belong to the same forum"));
                                    };
                                };
                            };
                        } else {
                            return #err(#InvalidInput("Topic cannot be parent of itself"));
                        };
                    };
                    case null {};
                };

                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let updated_topic = {
                    topic with
                    parent_topic_id = input.parent_topic_id;
                    title = input.title;
                    description = input.description;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.topics, Map.nhash, topic_id, updated_topic);
                #ok()
            };
            case null #err(#NotFound("Topic not found"));
        }
    };

    public func update_thread(
        state: ForumState,
        caller: Principal,
        thread_id: Nat,
        title: ?Text,
        body: Text
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.threads, Map.nhash, thread_id)) {
            case (?thread) {
                // Validate input
                switch (title) {
                    case (?t) {
                        switch (validate_text(t, "Title", state.text_limits.thread_title_max_length)) {
                            case (#err(e)) return #err(e);
                            case (#ok()) {};
                        };
                    };
                    case null {};
                };
                switch (validate_text(body, "Body", state.text_limits.thread_body_max_length)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };

                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let updated_thread = {
                    thread with
                    title = title;
                    body = body;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.threads, Map.nhash, thread_id, updated_thread);
                #ok()
            };
            case null #err(#NotFound("Thread not found"));
        }
    };

    public func update_post(
        state: ForumState,
        caller: Principal,
        post_id: Nat,
        title: ?Text,
        body: Text
    ) : Result<(), ForumError> {
        switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?post) {
                // Check if caller is admin or post owner
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let is_post_owner = (post.created_by == caller_index);
                
                if (not (is_admin(state, caller) or is_post_owner)) {
                    return #err(#Unauthorized("Only admins or post owners can edit posts"));
                };

                // Validate input
                switch (title) {
                    case (?t) {
                        switch (validate_text(t, "Title", state.text_limits.post_title_max_length)) {
                            case (#err(e)) return #err(e);
                            case (#ok()) {};
                        };
                    };
                    case null {};
                };
                switch (validate_text(body, "Body", state.text_limits.post_body_max_length)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };

                let updated_post = {
                    post with
                    title = title;
                    body = body;
                    updated_by = caller_index;
                    updated_at = Time.now();
                };
                ignore Map.put(state.posts, Map.nhash, post_id, updated_post);
                #ok()
            };
            case null #err(#NotFound("Post not found"));
        }
    };

    // Proposal management functions
    public func set_proposals_topic(
        state: ForumState,
        caller: Principal,
        input: T.SetProposalTopicInput
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        // Check if forum exists
        switch (Map.get(state.forums, Map.nhash, input.forum_id)) {
            case null return #err(#NotFound("Forum not found"));
            case (?_) {};
        };

        // Check if topic exists and belongs to the forum
        switch (Map.get(state.topics, Map.nhash, input.topic_id)) {
            case null return #err(#NotFound("Topic not found"));
            case (?topic) {
                if (topic.forum_id != input.forum_id) {
                    return #err(#InvalidInput("Topic must belong to the specified forum"));
                };
            };
        };

        let mapping : T.ProposalTopicMapping = {
            forum_id = input.forum_id;
            proposals_topic_id = input.topic_id;
            set_by = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
            set_at = Time.now();
        };

        ignore Map.put(state.proposal_topics, Map.nhash, input.forum_id, mapping);
        #ok()
    };

    public func get_proposals_topic(state: ForumState, forum_id: Nat) : ?T.ProposalTopicMapping {
        Map.get(state.proposal_topics, Map.nhash, forum_id)
    };

    public func get_proposals_topic_response(state: ForumState, forum_id: Nat) : ?T.ProposalTopicMappingResponse {
        switch (Map.get(state.proposal_topics, Map.nhash, forum_id)) {
            case (?mapping) {
                let set_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, mapping.set_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                ?{
                    forum_id = mapping.forum_id;
                    proposals_topic_id = mapping.proposals_topic_id;
                    set_by;
                    set_at = mapping.set_at;
                }
            };
            case null null;
        }
    };

    public func get_proposals_topic_by_sns_root(state: ForumState, sns_root_canister_id: Principal) : ?T.ProposalTopicMappingResponse {
        // First find the forum for this SNS root ID
        switch (get_forum_by_sns_root(state, sns_root_canister_id)) {
            case (?forum) {
                // If forum exists, get the proposals topic for this forum
                get_proposals_topic_response(state, forum.id)
            };
            case null null;
        }
    };

    // Helper function to get SNS name from governance canister
    public func get_sns_name(governance_canister_id: Principal): async ?Text {
        await SnsUtil.get_sns_name(governance_canister_id);
    };

    // Helper function to automatically create forum and topic structure for SNS proposals
    public func ensure_sns_proposal_structure(
        state: ForumState,
        caller: Principal,
        sns_root_canister_id: Principal,
        cache: SnsCache,
        current_time: Int
    ) : async (Result<Nat, ForumError>, SnsCache) {
        // First, ensure we have the SNS cache updated
        let updated_cache = await ensure_sns_cache(cache, current_time);
        
        // Get governance canister ID from cache
        let governance_canister_id_opt = get_governance_canister_from_cache(updated_cache, sns_root_canister_id);
        let governance_canister_id = switch (governance_canister_id_opt) {
            case (?gov_id) gov_id;
            case null return (#err(#NotFound("SNS governance canister not found")), updated_cache);
        };

        // Step 1: Check if forum exists for this SNS, if not create it
        var found_forum_id : ?Nat = null;
        for ((forum_id, forum) in Map.entries(state.forums)) {
            switch (forum.sns_root_canister_id) {
                case (?root) {
                    if (Principal.equal(root, sns_root_canister_id)) {
                        found_forum_id := ?forum_id;
                    };
                };
                case null {};
            };
        };

        let forum_id = switch (found_forum_id) {
            case (?fid) fid;
            case null {
                // Create new forum for this SNS
                let sns_name_opt = await get_sns_name(governance_canister_id);
                let sns_name = switch (sns_name_opt) {
                    case (?name) name;
                    case null "SNS " # Principal.toText(sns_root_canister_id);
                };
                let forum_input : T.CreateForumInput = {
                    title = sns_name # " Forum";
                    description = "Discussion forum for " # sns_name # " governance and community topics";
                    sns_root_canister_id = ?sns_root_canister_id;
                };
                
                switch (create_forum_internal(state, caller, forum_input)) {
                    case (#ok(new_forum_id)) new_forum_id;
                    case (#err(error)) return (#err(error), updated_cache);
                }
            };
        };

        // Step 2: Check if "Governance" topic exists, if not create it
        var governance_topic_id : ?Nat = null;
        switch (Map.get(state.forum_topics, Map.nhash, forum_id)) {
            case (?topic_ids) {
                for (topic_id in Vector.vals(topic_ids)) {
                    switch (Map.get(state.topics, Map.nhash, topic_id)) {
                        case (?topic) {
                            if (topic.title == "Governance" and topic.parent_topic_id == null) {
                                governance_topic_id := ?topic_id;
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };

        let governance_topic_id_final = switch (governance_topic_id) {
            case (?tid) tid;
            case null {
                // Create "Governance" topic
                let governance_topic_input : T.CreateTopicInput = {
                    forum_id = forum_id;
                    parent_topic_id = null;
                    title = "Governance";
                    description = "Topics related to governance, voting, and decision-making";
                };
                
                switch (create_topic_internal(state, caller, governance_topic_input)) {
                    case (#ok(new_topic_id)) new_topic_id;
                    case (#err(error)) return (#err(error), updated_cache);
                }
            };
        };

        // Step 3: Check if "Proposals" subtopic exists under Governance, if not create it
        var proposals_topic_id : ?Nat = null;
        switch (Map.get(state.topic_subtopics, Map.nhash, governance_topic_id_final)) {
            case (?subtopic_ids) {
                for (subtopic_id in Vector.vals(subtopic_ids)) {
                    switch (Map.get(state.topics, Map.nhash, subtopic_id)) {
                        case (?topic) {
                            if (topic.title == "Proposals") {
                                proposals_topic_id := ?subtopic_id;
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };

        let proposals_topic_id_final = switch (proposals_topic_id) {
            case (?tid) tid;
            case null {
                // Create "Proposals" subtopic under Governance
                let proposals_topic_input : T.CreateTopicInput = {
                    forum_id = forum_id;
                    parent_topic_id = ?governance_topic_id_final;
                    title = "Proposals";
                    description = "Discussion threads for individual governance proposals";
                };
                
                switch (create_topic_internal(state, caller, proposals_topic_input)) {
                    case (#ok(new_topic_id)) new_topic_id;
                    case (#err(error)) return (#err(error), updated_cache);
                }
            };
        };

        // Step 4: Register the "Proposals" topic as the special proposals topic for this forum
        let mapping : T.ProposalTopicMapping = {
            forum_id = forum_id;
            proposals_topic_id = proposals_topic_id_final;
            set_by = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
            set_at = current_time;
        };

        ignore Map.put(state.proposal_topics, Map.nhash, forum_id, mapping);

        (#ok(proposals_topic_id_final), updated_cache)
    };

    public func create_proposal_thread(
        state: ForumState,
        caller: Principal,
        input: T.CreateProposalThreadInput
    ) : Result<Nat, ForumError> {
        // Get deduplicated index for SNS root
        let sns_root_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, input.sns_root_canister_id);

        // Check if proposal thread already exists for this SNS and proposal ID
        let proposal_key : T.ProposalThreadKey = (sns_root_index, input.proposal_id);
        switch (Map.get(state.proposal_threads, (T.proposal_thread_key_hash, T.proposal_thread_key_equal), proposal_key)) {
            case (?_) return #err(#AlreadyExists("Thread for this proposal already exists"));
            case null {};
        };

        // Find the forum for this specific SNS
        var found_forum_id : ?Nat = null;
        var found_forum : ?Forum = null;
        for ((forum_id, forum) in Map.entries(state.forums)) {
            switch (forum.sns_root_canister_id) {
                case (?root) {
                    if (Principal.equal(root, input.sns_root_canister_id)) {
                        found_forum_id := ?forum_id;
                        found_forum := ?forum;
                    };
                };
                case null {};
            };
        };

        let forum_id = switch (found_forum_id) {
            case (?fid) fid;
            case null return #err(#NotFound("No forum found for this SNS"));
        };

        let forum = switch (found_forum) {
            case (?f) f;
            case null return #err(#NotFound("No forum found for this SNS"));
        };

        // Get the proposal topic for this specific forum
        let topic_id = switch (Map.get(state.proposal_topics, Map.nhash, forum_id)) {
            case (?mapping) mapping.proposals_topic_id;
            case null return #err(#InvalidInput("No proposals topic set for this SNS"));
        };

        // Generate standardized title and description based on forum name and proposal ID
        let standardized_title = forum.title # " Proposal #" # Nat.toText(input.proposal_id);
        let standardized_description = "Discussion thread for " # forum.title # " Proposal #" # Nat.toText(input.proposal_id);

        let thread_id = get_next_id(state);
        let now = Time.now();
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);

        let thread : Thread = {
            id = thread_id;
            topic_id = topic_id;
            title = ?standardized_title;
            body = standardized_description;
            created_by = caller_index;
            created_at = now;
            updated_by = caller_index;
            updated_at = now;
            deleted = false;
        };

        // Create the thread
        ignore Map.put(state.threads, Map.nhash, thread_id, thread);
        add_to_index(state.topic_threads, topic_id, thread_id);

        // Create the proposal mapping
        let proposal_mapping : T.ProposalThreadMapping = {
            thread_id = thread_id;
            proposal_id = input.proposal_id;
            sns_root_canister_id = sns_root_index;
            created_by = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
            created_at = now;
        };

        ignore Map.put(state.proposal_threads, (T.proposal_thread_key_hash, T.proposal_thread_key_equal), proposal_key, proposal_mapping);
        ignore Map.put(state.thread_proposals, Map.nhash, thread_id, (sns_root_index, input.proposal_id));

        #ok(thread_id)
    };

    // New create_proposal_thread function that handles automatic forum/topic creation
    public func create_proposal_thread_with_auto_setup(
        state: ForumState,
        caller: Principal,
        input: T.CreateProposalThreadInput,
        cache: SnsCache
    ) : async (Result<Nat, ForumError>, SnsCache) {
        let current_time = Time.now();
        
        // Get deduplicated index for SNS root
        let sns_root_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, input.sns_root_canister_id);

        // Check if proposal thread already exists for this SNS and proposal ID
        let proposal_key : T.ProposalThreadKey = (sns_root_index, input.proposal_id);
        switch (Map.get(state.proposal_threads, (T.proposal_thread_key_hash, T.proposal_thread_key_equal), proposal_key)) {
            case (?_) return (#err(#AlreadyExists("Thread for this proposal already exists")), cache);
            case null {};
        };

        // Find the forum for this specific SNS
        var found_forum_id : ?Nat = null;
        var found_forum : ?Forum = null;
        for ((forum_id, forum) in Map.entries(state.forums)) {
            switch (forum.sns_root_canister_id) {
                case (?root) {
                    if (Principal.equal(root, input.sns_root_canister_id)) {
                        found_forum_id := ?forum_id;
                        found_forum := ?forum;
                    };
                };
                case null {};
            };
        };

        // Check if proposals topic exists for this forum
        let proposals_topic_exists = switch (found_forum_id) {
            case (?forum_id) {
                switch (Map.get(state.proposal_topics, Map.nhash, forum_id)) {
                    case (?_) true;
                    case null false;
                }
            };
            case null false;
        };

        // If no forum exists or no proposals topic is set, create the full structure
        let (proposals_topic_result, updated_cache) = if (found_forum_id == null or not proposals_topic_exists) {
            await ensure_sns_proposal_structure(state, caller, input.sns_root_canister_id, cache, current_time)
        } else {
            (#ok(0), cache) // Dummy result, we'll get the real topic_id below
        };

        // Handle any errors from structure creation
        switch (proposals_topic_result) {
            case (#err(error)) return (#err(error), updated_cache);
            case (#ok(_)) {};
        };

        // Now find the forum and topic again (they should exist now)
        var final_forum_id : ?Nat = null;
        var final_forum : ?Forum = null;
        for ((forum_id, forum) in Map.entries(state.forums)) {
            switch (forum.sns_root_canister_id) {
                case (?root) {
                    if (Principal.equal(root, input.sns_root_canister_id)) {
                        final_forum_id := ?forum_id;
                        final_forum := ?forum;
                    };
                };
                case null {};
            };
        };

        let forum_id = switch (final_forum_id) {
            case (?fid) fid;
            case null return (#err(#InternalError("Forum creation failed")), updated_cache);
        };

        let forum = switch (final_forum) {
            case (?f) f;
            case null return (#err(#InternalError("Forum creation failed")), updated_cache);
        };

        // Get the proposal topic for this specific forum
        let topic_id = switch (Map.get(state.proposal_topics, Map.nhash, forum_id)) {
            case (?mapping) mapping.proposals_topic_id;
            case null return (#err(#InternalError("Proposals topic creation failed")), updated_cache);
        };

        // Generate standardized title and description based on forum name and proposal ID
        let standardized_title = forum.title # " Proposal #" # Nat.toText(input.proposal_id);
        let standardized_description = "Discussion thread for " # forum.title # " Proposal #" # Nat.toText(input.proposal_id);

        let thread_id = get_next_id(state);
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);

        let thread : Thread = {
            id = thread_id;
            topic_id = topic_id;
            title = ?standardized_title;
            body = standardized_description;
            created_by = caller_index;
            created_at = current_time;
            updated_by = caller_index;
            updated_at = current_time;
            deleted = false;
        };

        // Create the thread
        ignore Map.put(state.threads, Map.nhash, thread_id, thread);
        add_to_index(state.topic_threads, topic_id, thread_id);

        // Create the proposal mapping
        let proposal_mapping : T.ProposalThreadMapping = {
            thread_id = thread_id;
            proposal_id = input.proposal_id;
            sns_root_canister_id = sns_root_index;
            created_by = caller_index;
            created_at = current_time;
        };

        ignore Map.put(state.proposal_threads, (T.proposal_thread_key_hash, T.proposal_thread_key_equal), proposal_key, proposal_mapping);
        ignore Map.put(state.thread_proposals, Map.nhash, thread_id, (sns_root_index, input.proposal_id));

        (#ok(thread_id), updated_cache)
    };

    // Text limits management functions
    public func get_text_limits(state: ForumState) : T.TextLimits {
        state.text_limits
    };

    public func update_text_limits(
        state: ForumState,
        caller: Principal,
        input: T.UpdateTextLimitsInput
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        // Update only the provided fields
        let updated_limits : T.TextLimits = {
            post_title_max_length = switch (input.post_title_max_length) {
                case (?value) value;
                case null state.text_limits.post_title_max_length;
            };
            post_body_max_length = switch (input.post_body_max_length) {
                case (?value) value;
                case null state.text_limits.post_body_max_length;
            };
            thread_title_max_length = switch (input.thread_title_max_length) {
                case (?value) value;
                case null state.text_limits.thread_title_max_length;
            };
            thread_body_max_length = switch (input.thread_body_max_length) {
                case (?value) value;
                case null state.text_limits.thread_body_max_length;
            };
            topic_title_max_length = switch (input.topic_title_max_length) {
                case (?value) value;
                case null state.text_limits.topic_title_max_length;
            };
            topic_description_max_length = switch (input.topic_description_max_length) {
                case (?value) value;
                case null state.text_limits.topic_description_max_length;
            };
            forum_title_max_length = switch (input.forum_title_max_length) {
                case (?value) value;
                case null state.text_limits.forum_title_max_length;
            };
            forum_description_max_length = switch (input.forum_description_max_length) {
                case (?value) value;
                case null state.text_limits.forum_description_max_length;
            };
        };

        state.text_limits := updated_limits;
        #ok()
    };

    // Helper function to get default text limits
    public func get_default_text_limits() : T.TextLimits {
        {
            post_title_max_length = 200;
            post_body_max_length = 10000;
            thread_title_max_length = 200;
            thread_body_max_length = 10000;
            topic_title_max_length = 100;
            topic_description_max_length = 1000;
            forum_title_max_length = 100;
            forum_description_max_length = 1000;
        }
    };

    public func get_proposal_thread(state: ForumState, sns_root: Principal, proposal_id: Nat) : ?T.ProposalThreadMapping {
        let sns_root_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, sns_root);
        let proposal_key : T.ProposalThreadKey = (sns_root_index, proposal_id);
        Map.get(state.proposal_threads, (T.proposal_thread_key_hash, T.proposal_thread_key_equal), proposal_key)
    };

    public func get_proposal_thread_response(state: ForumState, sns_root: Principal, proposal_id: Nat) : ?T.ProposalThreadMappingResponse {
        // Safely get the SNS root index - if it doesn't exist, return null instead of creating it
        let sns_root_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, sns_root)) {
            case (?index) index;
            case null return null; // SNS root not found in dedup state, so no proposal thread exists
        };
        
        let proposal_key : T.ProposalThreadKey = (sns_root_index, proposal_id);
        switch (Map.get(state.proposal_threads, (T.proposal_thread_key_hash, T.proposal_thread_key_equal), proposal_key)) {
            case (?mapping) {
                let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, mapping.created_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                let sns_root_principal = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, mapping.sns_root_canister_id)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                ?{
                    thread_id = mapping.thread_id;
                    proposal_id = mapping.proposal_id;
                    sns_root_canister_id = sns_root_principal;
                    created_by;
                    created_at = mapping.created_at;
                }
            };
            case null null;
        }
    };

    public func get_thread_proposal_id(state: ForumState, thread_id: Nat) : ?(Nat32, Nat) {
        Map.get(state.thread_proposals, Map.nhash, thread_id)
    };

    public func remove_proposals_topic(
        state: ForumState,
        caller: Principal,
        forum_id: Nat
    ) : Result<(), ForumError> {
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.remove(state.proposal_topics, Map.nhash, forum_id)) {
            case (?_) #ok();
            case null #err(#NotFound("No proposals topic set for this forum"));
        }
    };
}
