import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Result "mo:base/Result";
import Map "mo:map/Map";
import Buffer "mo:base/Buffer";
import Dedup "mo:dedup";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Text "mo:base/Text";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Vector "mo:vector";
import Nat64 "mo:base/Nat64";
import Debug "mo:base/Debug";
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
    public type ForumError = T.ForumError;
    public type Result<A, B> = T.Result<A, B>;
    public type AdminInfo = T.AdminInfo;
    public type SnsCache = T.SnsCache;
    public type DeployedSns = T.DeployedSns;
    public type ListDeployedSnsesResponse = T.ListDeployedSnsesResponse;
    public type NNSSnsWCanister = T.NNSSnsWCanister;



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
                    let reachable_neurons = await SnsUtil.get_reachable_neurons(governance_canister_id, caller);
                    
                    if (reachable_neurons.size() == 0) {
                        return (#err(#Unauthorized("No accessible neurons found")), updated_cache);
                    };
                    
                    let system_parameters = await SnsUtil.get_system_parameters(governance_canister_id);
                    
                    var total_voting_power: Nat = 0;
                    let neuron_voting_powers = Buffer.Buffer<(T.NeuronId, Nat)>(reachable_neurons.size());
                    
                    for (neuron in reachable_neurons.vals()) {
                        switch (neuron.id) {
                            case (?neuron_id) {
                                let voting_power = SnsUtil.calculate_neuron_voting_power(neuron, system_parameters);
                                if (voting_power > 0) {
                                    total_voting_power += voting_power;
                                    neuron_voting_powers.add((neuron_id, voting_power));
                                };
                            };
                            case null { };
                        };
                    };
                    
                    if (total_voting_power == 0) {
                        return (#err(#Unauthorized("No voting power available")), updated_cache);
                    };
                    
                    let post_id = create_post(state, caller, thread_id, reply_to_post_id, title, body, total_voting_power, Time.now());
                    
                    switch (post_id) {
                        case (#ok(id)) {
                            let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                            for ((neuron_id, voting_power) in neuron_voting_powers.vals()) {
                                let neuron_index = Dedup.getOrCreateIndex(state.neuron_dedup_state, neuron_id.id);
                                let vote_key : VoteKey = (id, neuron_index);

                                let vote : Vote = {
                                    post_id = id;
                                    neuron_id = neuron_index;
                                    voter_principal = caller_index;
                                    vote_type = #upvote;
                                    voting_power;
                                    created_at = Time.now();
                                    updated_at = Time.now();
                                };
                                
                                ignore Map.put(state.votes, vote_key_hash_utils, vote_key, vote);
                            };
                        };
                        case (#err(_)) { };
                    };
                    
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
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        // Validate input
        switch (validate_text(input.title, "Title", 100)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };
        switch (validate_text(input.description, "Description", 1000)) {
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

        // Validate input
        switch (validate_text(input.title, "Title", 100)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };
        switch (validate_text(input.description, "Description", 1000)) {
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
                switch (validate_text(title, "Title", 200)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };
            };
            case null {};
        };
        switch (validate_text(input.body, "Body", 10000)) {
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
                switch (validate_text(t, "Title", 200)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };
            };
            case null {};
        };
        switch (validate_text(body, "Body", 10000)) {
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
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?post) {
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
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
                switch (validate_text(input.title, "Title", 100)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };
                switch (validate_text(input.description, "Description", 1000)) {
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
                switch (validate_text(input.title, "Title", 100)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };
                switch (validate_text(input.description, "Description", 1000)) {
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
                        switch (validate_text(t, "Title", 200)) {
                            case (#err(e)) return #err(e);
                            case (#ok()) {};
                        };
                    };
                    case null {};
                };
                switch (validate_text(body, "Body", 10000)) {
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
        // Check admin access
        if (not is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };

        switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?post) {
                // Validate input
                switch (title) {
                    case (?t) {
                        switch (validate_text(t, "Title", 200)) {
                            case (#err(e)) return #err(e);
                            case (#ok()) {};
                        };
                    };
                    case null {};
                };
                switch (validate_text(body, "Body", 10000)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };

                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
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
        for ((forum_id, forum) in Map.entries(state.forums)) {
            switch (forum.sns_root_canister_id) {
                case (?root) {
                    if (Principal.equal(root, input.sns_root_canister_id)) {
                        found_forum_id := ?forum_id;
                    };
                };
                case null {};
            };
        };

        let forum_id = switch (found_forum_id) {
            case (?fid) fid;
            case null return #err(#NotFound("No forum found for this SNS"));
        };

        // Get the proposal topic for this specific forum
        let topic_id = switch (Map.get(state.proposal_topics, Map.nhash, forum_id)) {
            case (?mapping) mapping.proposals_topic_id;
            case null return #err(#InvalidInput("No proposals topic set for this SNS"));
        };

        // Validate input
        switch (input.title) {
            case (?title) {
                switch (validate_text(title, "Title", 200)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };
            };
            case null {};
        };
        switch (validate_text(input.body, "Body", 10000)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        let thread_id = get_next_id(state);
        let now = Time.now();
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);

        let thread : Thread = {
            id = thread_id;
            topic_id = topic_id;
            title = input.title;
            body = input.body;
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
