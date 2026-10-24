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
import Float "mo:base/Float";
import Int "mo:base/Int";
import Char "mo:base/Char";
import Nat64 "mo:base/Nat64";
import ExperimentalInternetComputer "mo:base/ExperimentalInternetComputer";
import SnsUtil "../SnsUtil";

import T "Types";
import T3 "../icrc3/Types";

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
    public type Poll = T.Poll;
    public type PollOption = T.PollOption;
    public type PollVote = T.PollVote;
    public type PollVoteKey = T.PollVoteKey;
    public type PollResponse = T.PollResponse;
    public type PollOptionResponse = T.PollOptionResponse;
    public type PollVoteResponse = T.PollVoteResponse;
    public type CreatePollInput = T.CreatePollInput;
    public type CreatePollOptionInput = T.CreatePollOptionInput;



    // Constants
    public let MAX_VP_POWER : Float = 10.0; // polls' vp_power: (voting power ^ 10) still fits a Float
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
        cache: SnsCache,
        body_max_length_override: ?Nat
    ) : async (T.Result<Nat, T.ForumError>, SnsCache) {
        let (governance_canister_id_opt, updated_cache) = await get_governance_canister_id_from_thread(state, thread_id, cache, Time.now());
        
        switch (governance_canister_id_opt) {
            case (?governance_canister_id) {
                try {
                    // Allow post creation without checking for neurons - users can post without voting power
                    // Just create the post with 0 initial voting power - voting will be done separately
                    let post_id = create_post(state, caller, thread_id, reply_to_post_id, title, body, 0, Time.now(), body_max_length_override);
                    
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
    
    // Hash utilities for PollVoteKey
    private let poll_vote_key_hash_utils = (T.poll_vote_key_hash, T.poll_vote_key_equal);

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
        // Only admins (which includes the controllers and Sneed governance) add admins. There is no
        // "first admin" rule: an empty list must not let anyone in.
        if (not is_admin(state, caller)) {
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
    public func get_next_id(state: ForumState) : Nat {
        let id = state.next_id;
        state.next_id += 1;
        id
    };

    // Public function to get the current counter ID (without incrementing)
    public func get_current_counter(state: ForumState) : Nat {
        state.next_id
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
        state.log("forum_create", caller, Array.append<(Text, T3.Value)>([("forum_id", #Nat(id)), ("title", #Text(input.title))],
            switch (sns_root) { case (?r) [("sns_root", #Blob(Principal.toBlob(r)))]; case null [] }));
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
        state.log("topic_create", caller, Array.append<(Text, T3.Value)>([("topic_id", #Nat(id)), ("forum_id", #Nat(input.forum_id)), ("title", #Text(input.title))],
            switch (input.parent_topic_id) { case (?p) [("parent_topic_id", #Nat(p))]; case null [] }));
        
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
                        case (?topic_response) {
                            // Skip stale index entries left by re-parenting before the index was kept in step
                            if (topic_response.parent_topic_id == ?topic_id) {
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

    public func get_subtopics_filtered(state: ForumState, topic_id: Nat, show_deleted: Bool) : [T.TopicResponse] {
        let topics = Buffer.Buffer<T.TopicResponse>(0);
        switch (Map.get(state.topic_subtopics, Map.nhash, topic_id)) {
            case (?subtopic_ids) {
                for (subtopic_id in Vector.vals(subtopic_ids)) {
                    switch (get_topic(state, subtopic_id)) {
                        case (?topic_response) {
                            // Skip stale index entries left by re-parenting before the index was kept in step
                            if ((show_deleted or not topic_response.deleted) and topic_response.parent_topic_id == ?topic_id) {
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
        input: T.CreateThreadInput,
        body_max_length_override: ?Nat
    ) : Result<Nat, ForumError> {
        // Check that user is authenticated (not anonymous)
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create threads"));
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
        // Use override body max length if provided (for premium users)
        let effective_body_max = switch (body_max_length_override) {
            case (?override) { override };
            case null { state.text_limits.thread_body_max_length };
        };
        switch (validate_text(input.body, "Body", effective_body_max)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        // Check if topic exists (and is not deleted, nor its forum: moderators closed it)
        switch (Map.get(state.topics, Map.nhash, input.topic_id)) {
            case null return #err(#NotFound("Topic not found"));
            case (?topic) {
                if (topic.deleted) return #err(#NotFound("Topic not found"));
                switch (Map.get(state.forums, Map.nhash, topic.forum_id)) {
                    case (?forum) if (forum.deleted) return #err(#NotFound("Forum not found"));
                    case null {};
                };
            };
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
        index_thread(state, thread);

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
                    unread_posts_count = null; // Not calculated in basic get_thread
                    total_posts_count = null; // Not calculated in basic get_thread
                }
            };
            case null null;
        }
    };

    // Get thread with unread count for a specific caller
    public func get_thread_with_unread_count(state: ForumState, id: Nat, caller: Principal) : ?T.ThreadResponse {
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
                let (unread_count, total_count) = calculate_thread_post_counts(state, caller, id);
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
                    unread_posts_count = ?unread_count;
                    total_posts_count = ?total_count;
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

    // Get threads by topic with unread counts for a specific caller
    public func get_threads_by_topic_with_unread_counts(state: ForumState, topic_id: Nat, caller: Principal) : [T.ThreadResponse] {
        let threads = Buffer.Buffer<T.ThreadResponse>(0);
        let show_deleted = is_admin(state, caller); // as get_threads_by_topic: deleted threads only for admins
        switch (Map.get(state.topic_threads, Map.nhash, topic_id)) {
            case (?thread_ids) {
                for (thread_id in Vector.vals(thread_ids)) {
                    switch (get_thread_with_unread_count(state, thread_id, caller)) {
                        case (?thread_response) if (show_deleted or not thread_response.deleted) threads.add(thread_response);
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
        current_time: Int,
        body_max_length_override: ?Nat
    ) : Result<Nat, ForumError> {
        // Check that user is authenticated (not anonymous)
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create posts"));
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
        // Use override body max length if provided (for premium users)
        let effective_body_max = switch (body_max_length_override) {
            case (?override) { override };
            case null { state.text_limits.post_body_max_length };
        };
        switch (validate_text(body, "Body", effective_body_max)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        // Check if thread exists and is not deleted
        switch (Map.get(state.threads, Map.nhash, thread_id)) {
            case null return #err(#NotFound("Thread not found"));
            case (?thread) {
                if (thread.deleted) {
                    return #err(#InvalidInput("Cannot post in a deleted thread"));
                };
            };
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
                        if (reply_post.deleted) return #err(#NotFound("Reply target post not found"));
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
        index_post(state, post);
        
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
        // Check if post exists (votes on deleted posts, or posts of deleted threads, are refused;
        // retracting stays possible)
        let post = switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?p) p;
            case null return #err(#NotFound("Post not found"));
        };
        if (post.deleted) return #err(#NotFound("Post not found"));
        switch (Map.get(state.threads, Map.nhash, post.thread_id)) {
            case (?t) if (t.deleted) return #err(#NotFound("Post not found"));
            case null {};
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

    /// The (deduplicated) indexes of the given neurons that ever voted, in the order given.
    func known_neuron_indexes(state: ForumState, neuron_ids: [T.NeuronId]) : [(Nat32, T.NeuronId)] {
        let out = Buffer.Buffer<(Nat32, T.NeuronId)>(neuron_ids.size());
        for (neuron_id in neuron_ids.vals()) switch (Dedup.getIndex(state.neuron_dedup_state, neuron_id.id)) {
            case (?index) if (not Buffer.contains<(Nat32, T.NeuronId)>(out, (index, neuron_id), func(x, y) = x.0 == y.0)) out.add((index, neuron_id));
            case null {}; // never voted
        };
        Buffer.toArray(out)
    };

    /// The votes of these neurons on one post, by direct key lookups (no scan of all votes).
    func neuron_votes_on_post(state: ForumState, post_id: Nat, neurons: [(Nat32, T.NeuronId)]) : [T.NeuronVote] {
        let out = Buffer.Buffer<T.NeuronVote>(0);
        for ((index, neuron_id) in neurons.vals()) switch (Map.get(state.votes, vote_key_hash_utils, (post_id, index))) {
            case (?vote) out.add({ neuron_id; vote_type = vote.vote_type; voting_power = vote.voting_power; created_at = vote.created_at; updated_at = vote.updated_at });
            case null {};
        };
        Buffer.toArray(out)
    };

    // Get votes for specific neurons across all posts in a thread: the thread's posts × the neurons,
    // looked up by key (it used to scan every vote in the forum, with a search of the thread's posts
    // for each, which grows past the query instruction limit as the forum grows)
    public func get_thread_votes_for_neurons(state: ForumState, thread_id: Nat, neuron_ids: [T.NeuronId]) : [T.ThreadVoteResponse] {
        let neurons = known_neuron_indexes(state, neuron_ids);
        if (neurons.size() == 0) return [];
        let response = Buffer.Buffer<T.ThreadVoteResponse>(0);
        switch (Map.get(state.thread_posts, Map.nhash, thread_id)) {
            case (?post_ids) for (post_id in Vector.vals(post_ids)) {
                let votes = neuron_votes_on_post(state, post_id, neurons);
                if (votes.size() > 0) response.add({ post_id; neuron_votes = votes });
            };
            case null {};
        };
        Buffer.toArray(response)
    };

    // Get votes for specific neurons on a single post (by key, as above); an empty answer when none
    public func get_post_votes_for_neurons(state: ForumState, post_id: Nat, neuron_ids: [T.NeuronId]) : ?T.ThreadVoteResponse {
        ?{ post_id; neuron_votes = neuron_votes_on_post(state, post_id, known_neuron_indexes(state, neuron_ids)) }
    };

    // Poll functions
    public func create_poll(
        state: ForumState,
        caller: Principal,
        input: CreatePollInput
    ) : Result<Nat, ForumError> {
        // Validate input
        switch (validate_text(input.title, "Title", state.text_limits.post_title_max_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };
        switch (validate_text(input.body, "Body", state.text_limits.post_body_max_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        // Validate options - must have at least 2
        if (input.options.size() < 2) {
            return #err(#InvalidInput("Poll must have at least 2 options"));
        };

        // Validate each option
        for (option in input.options.vals()) {
            switch (validate_text(option.title, "Option title", state.text_limits.post_title_max_length)) {
                case (#err(e)) return #err(e);
                case (#ok()) {};
            };
            switch (option.body) {
                case (?body) {
                    switch (validate_text(body, "Option body", state.text_limits.post_body_max_length)) {
                        case (#err(e)) return #err(e);
                        case (#ok()) {};
                    };
                };
                case null {};
            };
        };

        // Validate VP power
        let vp_power = switch (input.vp_power) {
            case (?power) {
                if (power < 0) {
                    return #err(#InvalidInput("VP power cannot be negative"));
                };
                // NaN fails every comparison; above the cap, voting power ^ vp_power overflows to inf
                if (not (power <= MAX_VP_POWER)) {
                    return #err(#InvalidInput("VP power must be a number from 0 to " # Float.toText(MAX_VP_POWER)));
                };
                power
            };
            case null 1.0;
        };

        // Set allow vote changes (defaults to true)
        let allow_vote_changes = switch (input.allow_vote_changes) {
            case (?allow) allow;
            case null true;
        };

        // Validate end timestamp is in the future
        let current_time = Time.now();
        if (input.end_timestamp <= current_time) {
            return #err(#InvalidInput("End timestamp must be in the future"));
        };

        // Check if thread exists
        let thread = switch (Map.get(state.threads, Map.nhash, input.thread_id)) {
            case (?t) t;
            case null return #err(#NotFound("Thread not found"));
        };

        // If post_id is specified, check if post exists and belongs to the thread
        switch (input.post_id) {
            case (?post_id) {
                let post = switch (Map.get(state.posts, Map.nhash, post_id)) {
                    case (?p) p;
                    case null return #err(#NotFound("Post not found"));
                };
                if (post.thread_id != input.thread_id) {
                    return #err(#InvalidInput("Post does not belong to the specified thread"));
                };
                
                // Check if caller is the creator of the post
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                if (post.created_by != caller_index) {
                    return #err(#Unauthorized("Only the post creator can create a poll for it"));
                };
                
                // Check if a poll already exists for this post
                let existing_polls = switch (Map.get(state.post_polls, Map.nhash, post_id)) {
                    case (?polls) polls;
                    case null Vector.new<Nat>();
                };
                if (Vector.size(existing_polls) > 0) {
                    return #err(#AlreadyExists("A poll already exists for this post"));
                };
            };
            case null {
                // Check if caller is the creator of the thread
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                if (thread.created_by != caller_index) {
                    return #err(#Unauthorized("Only the thread creator can create a poll for it"));
                };
                
                // Check if a poll already exists for this thread (without post_id)
                for ((poll_id, poll) in Map.entries(state.polls)) {
                    if (poll.thread_id == input.thread_id and poll.post_id == null and not poll.deleted) {
                        return #err(#AlreadyExists("A poll already exists for this thread"));
                    };
                };
            };
        };

        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let poll_id = get_next_id(state);

        // Create poll options
        var option_id = 0;
        let poll_options = Array.map<CreatePollOptionInput, PollOption>(input.options, func(option_input) {
            let option : PollOption = {
                id = option_id;
                title = option_input.title;
                body = option_input.body;
                vote_count = 0;
                total_voting_power = 0;
            };
            option_id += 1;
            option
        });

        let poll : Poll = {
            id = poll_id;
            thread_id = input.thread_id;
            post_id = input.post_id;
            title = input.title;
            body = input.body;
            options = poll_options;
            vp_power = vp_power;
            end_timestamp = input.end_timestamp;
            allow_vote_changes = allow_vote_changes;
            created_by = caller_index;
            created_at = current_time;
            updated_by = caller_index;
            updated_at = current_time;
            deleted = false;
        };

        ignore Map.put(state.polls, Map.nhash, poll_id, poll);
        
        // Add to indexes
        switch (input.post_id) {
            case (?post_id) add_to_index(state.post_polls, post_id, poll_id);
            case null add_to_index(state.thread_polls, input.thread_id, poll_id);
        };

        #ok(poll_id)
    };

    public func get_poll(state: ForumState, id: Nat) : ?PollResponse {
        switch (Map.get(state.polls, Map.nhash, id)) {
            case (?poll) {
                let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, poll.created_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                let updated_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, poll.updated_by)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                
                let current_time = Time.now();
                let has_ended = current_time >= poll.end_timestamp;
                
                let option_responses = Array.map<PollOption, PollOptionResponse>(poll.options, func(option) {
                    {
                        id = option.id;
                        title = option.title;
                        body = option.body;
                        vote_count = option.vote_count;
                        total_voting_power = option.total_voting_power;
                    }
                });

                ?{
                    id = poll.id;
                    thread_id = poll.thread_id;
                    post_id = poll.post_id;
                    title = poll.title;
                    body = poll.body;
                    options = option_responses;
                    vp_power = poll.vp_power;
                    end_timestamp = poll.end_timestamp;
                    allow_vote_changes = poll.allow_vote_changes;
                    created_by;
                    created_at = poll.created_at;
                    updated_by;
                    updated_at = poll.updated_at;
                    deleted = poll.deleted;
                    has_ended;
                }
            };
            case null null;
        }
    };

    public func get_polls_by_thread(state: ForumState, thread_id: Nat) : [PollResponse] {
        let poll_ids = switch (Map.get(state.thread_polls, Map.nhash, thread_id)) {
            case (?ids) ids;
            case null return [];
        };
        
        let results = Buffer.Buffer<PollResponse>(Vector.size(poll_ids));
        for (poll_id in Vector.vals(poll_ids)) {
            switch (get_poll(state, poll_id)) {
                case (?poll_response) {
                    if (not poll_response.deleted) {
                        results.add(poll_response);
                    };
                };
                case null {};
            };
        };
        Buffer.toArray(results)
    };

    public func get_polls_by_post(state: ForumState, post_id: Nat) : [PollResponse] {
        let poll_ids = switch (Map.get(state.post_polls, Map.nhash, post_id)) {
            case (?ids) ids;
            case null return [];
        };
        
        let results = Buffer.Buffer<PollResponse>(Vector.size(poll_ids));
        for (poll_id in Vector.vals(poll_ids)) {
            switch (get_poll(state, poll_id)) {
                case (?poll_response) {
                    if (not poll_response.deleted) {
                        results.add(poll_response);
                    };
                };
                case null {};
            };
        };
        Buffer.toArray(results)
    };

    // Poll voting functions
    public func vote_on_poll_with_specific_neurons(
        state: ForumState,
        caller: Principal,
        poll_id: Nat,
        option_id: Nat,
        neuron_ids: [T.NeuronId],
        cache: SnsCache
    ) : async (T.Result<(), T.ForumError>, SnsCache) {
        // Check if poll exists
        let poll = switch (Map.get(state.polls, Map.nhash, poll_id)) {
            case (?p) p;
            case null return (#err(#NotFound("Poll not found")), cache);
        };

        // Check if poll has ended
        let current_time = Time.now();
        if (current_time >= poll.end_timestamp) {
            return (#err(#InvalidInput("Poll has ended")), cache);
        };

        // Check if option exists
        var option_found = false;
        for (option in poll.options.vals()) {
            if (option.id == option_id) {
                option_found := true;
            };
        };
        if (not option_found) {
            return (#err(#NotFound("Poll option not found")), cache);
        };

        // Get the governance canister ID for this poll's thread
        let (governance_canister_id_opt, updated_cache) = await get_governance_canister_id_from_thread(state, poll.thread_id, cache, current_time);
        
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
                                    let base_voting_power = SnsUtil.calculate_neuron_voting_power(neuron, system_parameters);
                                    if (base_voting_power > 0) {
                                        // Apply VP power transformation
                                        let adjusted_voting_power = if (poll.vp_power == 1.0) {
                                            base_voting_power
                                        } else if (poll.vp_power == 0.0) {
                                            1 // Every vote counts as 1 regardless of VP
                                        } else {
                                            // Calculate base_voting_power^vp_power
                                            let base_float = Float.fromInt(base_voting_power);
                                            let raw = Float.pow(base_float, poll.vp_power);
                                            // polls made before vp_power was capped: never let inf or NaN trap the vote
                                            let result_float = if (raw != raw) 0.0 else Float.min(raw, 1e300);
                                            let result_int = Float.toInt(result_float);
                                            if (result_int < 0) 0 else Int.abs(result_int)
                                        };
                                        
                                        switch (vote_on_poll(state, caller, poll_id, option_id, neuron_id, adjusted_voting_power, current_time, poll)) {
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
                    return (#err(#InternalError("Failed to vote on poll")), updated_cache);
                };
            };
            case null {
                return (#err(#NotFound("Thread not found")), updated_cache);
            };
        };
    };

    private func vote_on_poll(
        state: ForumState,
        caller: Principal,
        poll_id: Nat,
        option_id: Nat,
        neuron_id: NeuronId,
        voting_power: Nat,
        current_time: Int,
        poll: Poll
    ) : Result<(), ForumError> {
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let neuron_index = Dedup.getOrCreateIndex(state.neuron_dedup_state, neuron_id.id);
        
        let vote_key : PollVoteKey = (poll_id, neuron_index);

        // Check if vote already exists
        switch (Map.get(state.poll_votes, poll_vote_key_hash_utils, vote_key)) {
            case (?existing_vote) {
                // Check if vote changes are allowed
                if (not poll.allow_vote_changes) {
                    return #err(#InvalidInput("Vote changes are not allowed for this poll"));
                };
                // Update existing vote
                let updated_vote : PollVote = {
                    existing_vote with
                    option_id = option_id;
                    voting_power = voting_power;
                    updated_at = current_time;
                };

                // Update poll option counts
                switch (update_poll_vote_counts(state, poll_id, existing_vote.option_id, option_id, existing_vote.voting_power, voting_power, false, current_time)) {
                    case (#err(error)) return #err(error);
                    case (#ok()) {};
                };

                ignore Map.put(state.poll_votes, poll_vote_key_hash_utils, vote_key, updated_vote);
            };
            case null {
                // Create new vote
                let new_vote : PollVote = {
                    poll_id;
                    option_id;
                    neuron_id = neuron_index;
                    voter_principal = caller_index;
                    voting_power;
                    created_at = current_time;
                    updated_at = current_time;
                };

                // Update poll option counts
                switch (update_poll_vote_counts(state, poll_id, option_id, option_id, 0, voting_power, true, current_time)) {
                    case (#err(error)) return #err(error);
                    case (#ok()) {};
                };

                ignore Map.put(state.poll_votes, poll_vote_key_hash_utils, vote_key, new_vote);
            };
        };

        #ok()
    };

    private func update_poll_vote_counts(
        state: ForumState,
        poll_id: Nat,
        old_option_id: Nat,
        new_option_id: Nat,
        old_voting_power: Nat,
        new_voting_power: Nat,
        is_new_vote: Bool, // a first vote by this neuron: counts once on new_option_id
        current_time: Int
    ) : Result<(), ForumError> {
        let poll = switch (Map.get(state.polls, Map.nhash, poll_id)) {
            case (?p) p;
            case null return #err(#NotFound("Poll not found"));
        };

        let updated_options = Array.map<PollOption, PollOption>(poll.options, func(option) {
            if (option.id == old_option_id and old_option_id != new_option_id) {
                // Remove vote from old option
                {
                    option with
                    vote_count = if (option.vote_count > 0) option.vote_count - 1 else 0;
                    total_voting_power = if (option.total_voting_power >= old_voting_power) {
                        option.total_voting_power - old_voting_power
                    } else { 0 };
                }
            } else if (option.id == new_option_id and old_option_id != new_option_id) {
                // Add vote to new option
                {
                    option with
                    vote_count = option.vote_count + 1;
                    total_voting_power = option.total_voting_power + new_voting_power;
                }
            } else if (option.id == new_option_id and old_option_id == new_option_id) {
                // Update vote on same option (or a first vote, which also adds one to the count)
                {
                    option with
                    vote_count = if (is_new_vote) option.vote_count + 1 else option.vote_count;
                    total_voting_power = if (option.total_voting_power >= old_voting_power) {
                        (option.total_voting_power - old_voting_power) + new_voting_power
                    } else { new_voting_power };
                }
            } else {
                option
            }
        });

        let updated_poll = {
            poll with
            options = updated_options;
            updated_at = current_time;
        };

        ignore Map.put(state.polls, Map.nhash, poll_id, updated_poll);
        #ok()
    };

    /// Sets every poll option's vote_count and total_voting_power from the stored votes (one per
    /// poll and neuron, never deleted), the source of truth. Builds before f9df91bf did not count a
    /// neuron's first vote, so polls voted on then show too few votes; postupgrade runs this to put
    /// them right. Counting again gives the same result. Returns the number of options it changed.
    public func recount_poll_votes(state: ForumState) : Nat {
        // poll id -> option id -> (votes, voting power)
        let tallies = Map.new<Nat, Map.Map<Nat, (Nat, Nat)>>();
        for (vote in Map.vals(state.poll_votes)) {
            let options = switch (Map.get(tallies, Map.nhash, vote.poll_id)) {
                case (?o) o;
                case null { let o = Map.new<Nat, (Nat, Nat)>(); Map.set(tallies, Map.nhash, vote.poll_id, o); o };
            };
            let (n, vp) = switch (Map.get(options, Map.nhash, vote.option_id)) { case (?t) t; case null (0, 0) };
            Map.set(options, Map.nhash, vote.option_id, (n + 1, vp + vote.voting_power));
        };
        var changed = 0;
        for (poll in Map.vals(state.polls)) {
            let options = Map.get(tallies, Map.nhash, poll.id);
            var differs = false;
            let recounted = Array.map<PollOption, PollOption>(poll.options, func(option) {
                let (n, vp) = switch (options) {
                    case (?o) { switch (Map.get(o, Map.nhash, option.id)) { case (?t) t; case null (0, 0) } };
                    case null (0, 0);
                };
                if (n != option.vote_count or vp != option.total_voting_power) { differs := true; changed += 1 };
                { option with vote_count = n; total_voting_power = vp }
            });
            if (differs) {
                // updated_at stays: a recount is not an edit of the poll
                ignore Map.put(state.polls, Map.nhash, poll.id, { poll with options = recounted });
            };
        };
        changed
    };

    public func get_poll_votes(state: ForumState, poll_id: Nat) : [PollVoteResponse] {
        let results = Buffer.Buffer<PollVoteResponse>(0);
        
        for ((vote_key, vote) in Map.entries(state.poll_votes)) {
            if (vote_key.0 == poll_id) {
                let voter_principal = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, vote.voter_principal)) {
                    case (?p) p;
                    case null Principal.fromText("2vxsx-fae");
                };
                let neuron_blob = switch (Dedup.getBlob(state.neuron_dedup_state, vote.neuron_id)) {
                    case (?blob) blob;
                    case null Blob.fromArray([]);
                };
                let neuron_id : NeuronId = { id = neuron_blob };
                
                results.add({
                    poll_id = vote.poll_id;
                    option_id = vote.option_id;
                    neuron_id;
                    voter_principal;
                    voting_power = vote.voting_power;
                    created_at = vote.created_at;
                    updated_at = vote.updated_at;
                });
            };
        };
        
        Buffer.toArray(results)
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

    /// The ledger confirmed this tip (TipVerify.mo). Counts, sums, stats and notifications count
    /// only these; lists show every tip with its `verified` flag.
    public func tip_verified(state: ForumState, id: Nat) : Bool {
        switch (Map.get(state.tip_checks, Map.nhash, id)) { case (?c) c.status == #verified; case null false };
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
                    verified = switch (Map.get(state.tip_checks, Map.nhash, tip.id)) { case (?c) ?(c.status == #verified); case null null };
                    verification_note = switch (Map.get(state.tip_checks, Map.nhash, tip.id)) { case (?c) c.note; case null null };
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
                    switch (if (tip_verified(state, tip_id)) Map.get(state.tips, Map.nhash, tip_id) else null) {
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
                            // Only include verified tips created after the since_timestamp
                            if (tip_response.created_at > since_timestamp and tip_response.verified == ?true) {
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
                            // Only count verified tips created after the since_timestamp
                            if (tip_response.created_at > since_timestamp and tip_response.verified == ?true) {
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

    // ---- Per-user indexes (spec/paging_audit.md): user_posts, user_threads, user_reply_inbox ----

    /// Records a new thread under its author.
    public func index_thread(state: ForumState, thread: Thread) {
        add_to_index_32(state.user_threads, thread.created_by, thread.id);
    };

    /// Records a new post under its author, and in the reply inbox of whoever it may answer: the
    /// author of the post it replies to (also when that is the poster), or for a top-level post the
    /// thread's author when someone else posts.
    public func index_post(state: ForumState, post: Post) {
        add_to_index_32(state.user_posts, post.created_by, post.id);
        switch (post.reply_to_post_id) {
            case (?parent_id) switch (Map.get(state.posts, Map.nhash, parent_id)) {
                case (?parent) add_to_index_32(state.user_reply_inbox, parent.created_by, post.id);
                case null {};
            };
            case null switch (Map.get(state.threads, Map.nhash, post.thread_id)) {
                case (?thread) if (thread.created_by != post.created_by) add_to_index_32(state.user_reply_inbox, thread.created_by, post.id);
                case null {};
            };
        };
    };

    /// Builds the per-user indexes from scratch (on the first upgrade to the build that has them),
    /// in creation order. Returns how many posts and threads were indexed.
    public func rebuild_user_indexes(state: ForumState) : Nat {
        Map.clear(state.user_posts);
        Map.clear(state.user_threads);
        Map.clear(state.user_reply_inbox);
        let by_time = func(a_at: Int, a_id: Nat, b_at: Int, b_id: Nat) : Order.Order {
            if (a_at < b_at) #less else if (a_at > b_at) #greater else Nat.compare(a_id, b_id)
        };
        let threads = Array.sort<Thread>(Iter.toArray(Map.vals(state.threads)), func(a, b) = by_time(a.created_at, a.id, b.created_at, b.id));
        for (thread in threads.vals()) index_thread(state, thread);
        let posts = Array.sort<Post>(Iter.toArray(Map.vals(state.posts)), func(a, b) = by_time(a.created_at, a.id, b.created_at, b.id));
        for (post in posts.vals()) index_post(state, post);
        threads.size() + posts.size()
    };

    /// Whether `post` counts as a reply to `user_index` now: not deleted, and either a reply to a live
    /// post of theirs, or a top-level post by someone else in a live thread of theirs.
    func is_reply_to_user(state: ForumState, user_index: Nat32, post: Post) : Bool {
        if (post.deleted) return false;
        switch (post.reply_to_post_id) {
            case (?parent_id) switch (Map.get(state.posts, Map.nhash, parent_id)) {
                case (?parent) parent.created_by == user_index and not parent.deleted;
                case null false;
            };
            case null switch (Map.get(state.threads, Map.nhash, post.thread_id)) {
                case (?thread) thread.created_by == user_index and not thread.deleted and post.created_by != user_index;
                case null false;
            };
        }
    };

    func user_list(map: Map.Map<Nat32, Vector.Vector<Nat>>, user_index: Nat32) : Vector.Vector<Nat> {
        switch (Map.get(map, Map.n32hash, user_index)) { case (?v) v; case null Vector.new<Nat>() }
    };

    // Get count of replies to user since their last seen timestamp (optimized for notifications).
    // Walks the user's reply inbox from the newest entry back to the last-seen time: the cost is the
    // number of replies since then, not the size of the forum.
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

        let inbox = user_list(state.user_reply_inbox, user_index);
        var count = 0;
        var i = Vector.size(inbox);
        label newest while (i > 0) {
            i -= 1;
            switch (Map.get(state.posts, Map.nhash, Vector.get(inbox, i))) {
                case (?post) {
                    if (post.created_at <= since_timestamp) break newest; // the inbox is in creation order
                    if (is_reply_to_user(state, user_index, post)) count += 1;
                };
                case null {};
            };
        };
        count
    };

    // Page limits of the per-user lists
    public let USER_PAGE_MAX : Nat = 100;
    let USER_PAGE_SCAN : Nat = 1_000; // entries looked at per page (deleted ones are skipped)
    public let USER_PAGE_BYTE_BUDGET : Nat = 1_500_000;

    /// One page of a per-user list, newest first: positions below `before` (all for null), at most
    /// `limit` (0 or above USER_PAGE_MAX: USER_PAGE_MAX) items, about USER_PAGE_BYTE_BUDGET bytes of
    /// text (always at least one item), USER_PAGE_SCAN positions looked at. `view` gives an entry's
    /// item and its size, or null to skip it.
    func user_page<R>(list: Vector.Vector<Nat>, before: ?Nat, limit: Nat, view: Nat -> ?(R, Nat)) : { items: [R]; next: ?Nat } {
        let max = if (limit == 0 or limit > USER_PAGE_MAX) USER_PAGE_MAX else limit;
        let size = Vector.size(list);
        var i : Nat = switch (before) { case (?b) Nat.min(b, size); case null size };
        let out = Buffer.Buffer<R>(max);
        var scanned = 0;
        var bytes = 0;
        label fill while (i > 0 and out.size() < max and scanned < USER_PAGE_SCAN) {
            switch (view(Vector.get(list, i - 1))) {
                case (?(item, n)) {
                    if (out.size() > 0 and bytes + n > USER_PAGE_BYTE_BUDGET) break fill; // starts the next page
                    out.add(item);
                    bytes += n;
                };
                case null {};
            };
            i -= 1;
            scanned += 1;
        };
        { items = Buffer.toArray(out); next = if (i > 0) ?i else null }
    };

    func post_bytes(p: T.PostResponse) : Nat = 200 + opt_text_bytes(p.title) + Text.encodeUtf8(p.body).size();
    func thread_bytes(t: T.ThreadResponse) : Nat = 200 + opt_text_bytes(t.title) + Text.encodeUtf8(t.body).size();

    func live_post(state: ForumState, id: Nat) : ?(T.PostResponse, Nat) {
        switch (Map.get(state.posts, Map.nhash, id)) {
            case (?post) if (not post.deleted) switch (get_post(state, id)) { case (?r) ?(r, post_bytes(r)); case null null } else null;
            case null null;
        }
    };

    /// A user's posts (not deleted), newest first, paged (see user_page).
    public func get_posts_by_user_page(state: ForumState, user_principal: Principal, before: ?Nat, limit: Nat) : T.PostsPage {
        let ?user_index = Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal) else return { items = []; next = null };
        user_page<T.PostResponse>(user_list(state.user_posts, user_index), before, limit, func(id) = live_post(state, id))
    };

    /// A user's threads (not deleted), newest first, paged (see user_page).
    public func get_threads_by_user_page(state: ForumState, user_principal: Principal, before: ?Nat, limit: Nat) : T.ThreadsPage {
        let ?user_index = Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal) else return { items = []; next = null };
        user_page<T.ThreadResponse>(user_list(state.user_threads, user_index), before, limit, func(id) {
            switch (Map.get(state.threads, Map.nhash, id)) {
                case (?thread) if (not thread.deleted) switch (get_thread(state, id)) { case (?r) ?(r, thread_bytes(r)); case null null } else null;
                case null null;
            }
        })
    };

    /// Replies to a user (what get_replies_to_user lists), newest first, paged (see user_page).
    public func get_replies_to_user_page(state: ForumState, user_principal: Principal, before: ?Nat, limit: Nat) : T.PostsPage {
        let ?user_index = Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal) else return { items = []; next = null };
        user_page<T.PostResponse>(user_list(state.user_reply_inbox, user_index), before, limit, func(id) {
            switch (Map.get(state.posts, Map.nhash, id)) {
                case (?post) if (is_reply_to_user(state, user_index, post)) live_post(state, id) else null;
                case null null;
            }
        })
    };

    func tip_page(state: ForumState, index: Map.Map<Nat32, Vector.Vector<Nat>>, user_principal: Principal, before: ?Nat, limit: Nat) : T.TipsPage {
        let ?user_index = Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal) else return { items = []; next = null };
        user_page<TipResponse>(user_list(index, user_index), before, limit, func(id) {
            switch (get_tip(state, id)) { case (?t) ?(t, 300); case null null }
        })
    };

    /// Tips a user gave (what get_tips_given_by_user lists), newest first, paged (see user_page).
    public func get_tips_given_by_user_page(state: ForumState, user_principal: Principal, before: ?Nat, limit: Nat) : T.TipsPage {
        tip_page(state, state.tips_given, user_principal, before, limit)
    };

    /// Tips a user received (what get_tips_received_by_user lists), newest first, paged (see user_page).
    public func get_tips_received_by_user_page(state: ForumState, user_principal: Principal, before: ?Nat, limit: Nat) : T.TipsPage {
        tip_page(state, state.tips_received, user_principal, before, limit)
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
                            // Only include verified tips created after the since_timestamp
                            if (tip_response.created_at > since_timestamp and tip_response.verified == ?true) {
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
        var total_tips = 0;
        let token_amounts = Map.new<Principal, Nat>();
        
        for (tip in Map.vals(state.tips)) if (tip_verified(state, tip.id)) {
            total_tips += 1;
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

    // ids of a per-user list in id order (the order the full scans of earlier builds visited them in)
    func ids_ascending(list: Vector.Vector<Nat>) : [Nat] = Array.sort<Nat>(Vector.toArray(list), Nat.compare);

    func newest_first_posts(items: [T.PostResponse]) : [T.PostResponse] {
        Array.sort(items, func(a: T.PostResponse, b: T.PostResponse) : Order.Order {
            if (a.created_at > b.created_at) #less
            else if (a.created_at < b.created_at) #greater
            else #equal
        })
    };

    // Post query functions by user (from the per-user indexes; the same lists as the full scans of
    // earlier builds, unpaged: the *_page variants page them)
    public func get_posts_by_user(state: ForumState, user_principal: Principal) : [T.PostResponse] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no posts
        };
        
        let posts = Buffer.Buffer<T.PostResponse>(0);
        for (post_id in ids_ascending(user_list(state.user_posts, user_index)).vals()) {
            switch (live_post(state, post_id)) {
                case (?(post_response, _)) posts.add(post_response);
                case null {};
            };
        };
        
        // Sort by creation time (newest first)
        newest_first_posts(Buffer.toArray(posts))
    };

    public func get_replies_to_user(state: ForumState, user_principal: Principal) : [T.PostResponse] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no replies
        };
        
        // replies to the user's posts first, then top-level posts by others in the user's threads
        // (each in id order), as earlier builds listed them before sorting
        let replies = Buffer.Buffer<T.PostResponse>(0);
        let top_level = Buffer.Buffer<T.PostResponse>(0);
        for (post_id in ids_ascending(user_list(state.user_reply_inbox, user_index)).vals()) {
            switch (Map.get(state.posts, Map.nhash, post_id)) {
                case (?post) if (is_reply_to_user(state, user_index, post)) switch (get_post(state, post_id)) {
                    case (?r) if (post.reply_to_post_id != null) replies.add(r) else top_level.add(r);
                    case null {};
                };
                case null {};
            };
        };
        replies.append(top_level);
        
        // Sort by creation time (newest first)
        newest_first_posts(Buffer.toArray(replies))
    };

    public func get_threads_by_user(state: ForumState, user_principal: Principal) : [T.ThreadResponse] {
        let user_index = switch (Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal)) {
            case (?index) index;
            case null return []; // User not found in dedup, so no threads
        };
        
        let threads = Buffer.Buffer<T.ThreadResponse>(0);
        for (thread_id in ids_ascending(user_list(state.user_threads, user_index)).vals()) {
            switch (Map.get(state.threads, Map.nhash, thread_id)) {
                case (?thread) if (not thread.deleted) switch (get_thread(state, thread_id)) {
                    case (?thread_response) threads.add(thread_response);
                    case null {}; // Skip if thread not found
                };
                case null {};
            };
        };
        
        // Sort by creation time (newest first)
        let sorted_threads = Array.sort(Buffer.toArray(threads), func(a: T.ThreadResponse, b: T.ThreadResponse) : Order.Order {
            if (a.created_at > b.created_at) #less
            else if (a.created_at < b.created_at) #greater
            else #equal
        });
        
        sorted_threads
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
                                    // Refuse a parent that is a descendant of this topic (would form a cycle)
                                    var ancestor = parent_topic.parent_topic_id;
                                    var steps = 0;
                                    let max_steps = Map.size(state.topics);
                                    label walk while (steps <= max_steps) {
                                        switch (ancestor) {
                                            case null break walk;
                                            case (?ancestor_id) {
                                                if (ancestor_id == topic_id) {
                                                    return #err(#InvalidInput("Parent topic cannot be a subtopic of this topic"));
                                                };
                                                ancestor := switch (Map.get(state.topics, Map.nhash, ancestor_id)) {
                                                    case (?t) t.parent_topic_id;
                                                    case null null;
                                                };
                                            };
                                        };
                                        steps += 1;
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

                // Keep the subtopic index in step with a changed parent
                if (topic.parent_topic_id != input.parent_topic_id) {
                    switch (topic.parent_topic_id) {
                        case (?old_parent) remove_from_index(state.topic_subtopics, old_parent, topic_id);
                        case null {};
                    };
                    switch (input.parent_topic_id) {
                        case (?new_parent) {
                            remove_from_index(state.topic_subtopics, new_parent, topic_id); // no duplicate from a stale entry
                            add_to_index(state.topic_subtopics, new_parent, topic_id);
                        };
                        case null {};
                    };
                };
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
        body: Text,
        body_max_length_override: ?Nat
    ) : Result<(), ForumError> {
        switch (Map.get(state.threads, Map.nhash, thread_id)) {
            case (?thread) {
                // Check if caller is admin or thread owner
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let is_thread_owner = (thread.created_by == caller_index);
                
                if (not (is_admin(state, caller) or is_thread_owner)) {
                    return #err(#Unauthorized("Only admins or thread owners can edit threads"));
                };
                // a deleted thread stays as moderators left it; only admins edit it
                if (thread.deleted and not is_admin(state, caller)) return #err(#NotFound("Thread not found"));

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
                // Use override body max length if provided (for premium users)
                let effective_body_max = switch (body_max_length_override) {
                    case (?override) { override };
                    case null { state.text_limits.thread_body_max_length };
                };
                switch (validate_text(body, "Body", effective_body_max)) {
                    case (#err(e)) return #err(e);
                    case (#ok()) {};
                };

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
        body: Text,
        body_max_length_override: ?Nat
    ) : Result<(), ForumError> {
        switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?post) {
                // Check if caller is admin or post owner
                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                let is_post_owner = (post.created_by == caller_index);
                
                if (not (is_admin(state, caller) or is_post_owner)) {
                    return #err(#Unauthorized("Only admins or post owners can edit posts"));
                };
                // a deleted post stays as moderators left it; only admins edit it
                if (post.deleted and not is_admin(state, caller)) return #err(#NotFound("Post not found"));

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
                // Use override body max length if provided (for premium users)
                let effective_body_max = switch (body_max_length_override) {
                    case (?override) { override };
                    case null { state.text_limits.post_body_max_length };
                };
                switch (validate_text(body, "Body", effective_body_max)) {
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

        let previous = Map.put(state.proposal_topics, Map.nhash, forum_id, mapping);
        switch (previous) {
            case (?p) if (p.proposals_topic_id != proposals_topic_id_final) state.log("proposals_topic_set", caller, [("forum_id", #Nat(forum_id)), ("topic_id", #Nat(proposals_topic_id_final)), ("old_topic_id", #Nat(p.proposals_topic_id))]);
            case null state.log("proposals_topic_set", caller, [("forum_id", #Nat(forum_id)), ("topic_id", #Nat(proposals_topic_id_final))]);
        };

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
        index_thread(state, thread);

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
        index_thread(state, thread);

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

    // Feed functionality
    private func build_feed_item_from_forum(state: ForumState, forum: Forum) : ?T.FeedItem {
        let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, forum.created_by)) {
            case (?p) p;
            case null return null;
        };

        ?{
            id = forum.id;
            item_type = #forum;
            title = ?forum.title;
            body = ?forum.description;
            created_by;
            created_at = forum.created_at;
            sns_root_canister_id = forum.sns_root_canister_id;
            forum_id = null;
            forum_title = null;
            topic_id = null;
            topic_title = null;
            thread_id = null;
            thread_title = null;
            poll_id = null; // Forums don't have polls
            replied_to_post = null; // Forums don't reply to posts
        }
    };

    private func build_feed_item_from_topic(state: ForumState, topic: Topic) : ?T.FeedItem {
        let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, topic.created_by)) {
            case (?p) p;
            case null return null;
        };

        let (forum_title, sns_root_canister_id) = switch (Map.get(state.forums, Map.nhash, topic.forum_id)) {
            case (?forum) (forum.title, forum.sns_root_canister_id);
            case null ("Unknown Forum", null);
        };

        ?{
            id = topic.id;
            item_type = #topic;
            title = ?topic.title;
            body = ?topic.description;
            created_by;
            created_at = topic.created_at;
            sns_root_canister_id;
            forum_id = ?topic.forum_id;
            forum_title = ?forum_title;
            topic_id = null;
            topic_title = null;
            thread_id = null;
            thread_title = null;
            poll_id = null; // Topics don't have polls
            replied_to_post = null; // Topics don't reply to posts
        }
    };

    func feed_topic_deleted(state: ForumState, topic_id: Nat) : Bool = switch (Map.get(state.topics, Map.nhash, topic_id)) {
        case (?t) t.deleted;
        case null false;
    };
    func feed_thread_hidden(state: ForumState, thread_id: Nat) : Bool = switch (Map.get(state.threads, Map.nhash, thread_id)) {
        case (?t) t.deleted or feed_topic_deleted(state, t.topic_id);
        case null false;
    };

    private func build_feed_item_from_thread(state: ForumState, thread: Thread) : ?T.FeedItem {
        let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, thread.created_by)) {
            case (?p) p;
            case null return null;
        };

        let (topic_title, forum_id, forum_title, sns_root_canister_id) = switch (Map.get(state.topics, Map.nhash, thread.topic_id)) {
            case (?topic) {
                let (f_title, sns_root) = switch (Map.get(state.forums, Map.nhash, topic.forum_id)) {
                    case (?forum) (forum.title, forum.sns_root_canister_id);
                    case null ("Unknown Forum", null);
                };
                (topic.title, topic.forum_id, f_title, sns_root)
            };
            case null ("Unknown Topic", 0, "Unknown Forum", null);
        };

        // Get poll_id if there's a poll associated with this thread
        let poll_id = switch (Map.get(state.thread_polls, Map.nhash, thread.id)) {
            case (?poll_ids) {
                if (Vector.size(poll_ids) > 0) {
                    ?Vector.get(poll_ids, 0) // Get first poll ID
                } else null
            };
            case null null;
        };

        ?{
            id = thread.id;
            item_type = #thread;
            title = thread.title;
            body = ?thread.body;
            created_by;
            created_at = thread.created_at;
            sns_root_canister_id;
            forum_id = ?forum_id;
            forum_title = ?forum_title;
            topic_id = ?thread.topic_id;
            topic_title = ?topic_title;
            thread_id = null;
            thread_title = null;
            poll_id = poll_id;
            replied_to_post = null; // Threads don't reply to posts
        }
    };

    private func build_feed_item_from_post(state: ForumState, post: Post) : ?T.FeedItem {
        let created_by = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, post.created_by)) {
            case (?p) p;
            case null return null;
        };

        let (thread_title, topic_id, topic_title, forum_id, forum_title, sns_root_canister_id) = switch (Map.get(state.threads, Map.nhash, post.thread_id)) {
            case (?thread) {
                let (t_title, f_id, f_title, sns_root) = switch (Map.get(state.topics, Map.nhash, thread.topic_id)) {
                    case (?topic) {
                        let (forum_t, sns_r) = switch (Map.get(state.forums, Map.nhash, topic.forum_id)) {
                            case (?forum) (forum.title, forum.sns_root_canister_id);
                            case null ("Unknown Forum", null);
                        };
                        (topic.title, topic.forum_id, forum_t, sns_r)
                    };
                    case null ("Unknown Topic", 0, "Unknown Forum", null);
                };
                (thread.title, thread.topic_id, t_title, f_id, f_title, sns_root)
            };
            case null (null, 0, "Unknown Topic", 0, "Unknown Forum", null);
        };

        // Get poll_id if there's a poll associated with this post
        let poll_id = switch (Map.get(state.post_polls, Map.nhash, post.id)) {
            case (?poll_ids) {
                if (Vector.size(poll_ids) > 0) {
                    ?Vector.get(poll_ids, 0) // Get first poll ID
                } else null
            };
            case null null;
        };

        // Get replied-to post information if this is a reply
        let replied_to_post = switch (post.reply_to_post_id) {
            case (?reply_to_id) {
                switch (Map.get(state.posts, Map.nhash, reply_to_id)) {
                    case (?replied_post) {
                        if (not replied_post.deleted) {
                            ?{
                                id = replied_post.id;
                                title = replied_post.title;
                                body = replied_post.body;
                            }
                        } else null
                    };
                    case null null;
                }
            };
            case null null;
        };

        ?{
            id = post.id;
            item_type = #post;
            title = post.title;
            body = ?post.body;
            created_by;
            created_at = post.created_at;
            sns_root_canister_id;
            forum_id = ?forum_id;
            forum_title = ?forum_title;
            topic_id = ?topic_id;
            topic_title = ?topic_title;
            thread_id = ?post.thread_id;
            thread_title = thread_title;
            poll_id = poll_id;
            replied_to_post = replied_to_post;
        }
    };

    private func matches_filter(item: T.FeedItem, filter: T.FeedFilter) : Bool {
        // Check SNS root canister ID filter
        switch (filter.sns_root_canister_ids) {
            case (?sns_ids) {
                switch (item.sns_root_canister_id) {
                    case (?sns_root) {
                        var found = false;
                        for (sns_id in sns_ids.vals()) {
                            if (Principal.equal(sns_root, sns_id)) {
                                found := true;
                            };
                        };
                        if (not found) return false;
                    };
                    case null return false;
                };
            };
            case null {};
        };

        // Check topic ID filter
        switch (filter.topic_ids) {
            case (?topic_ids) {
                switch (item.topic_id) {
                    case (?topic_id) {
                        var found = false;
                        for (tid in topic_ids.vals()) {
                            if (topic_id == tid) {
                                found := true;
                            };
                        };
                        if (not found) return false;
                    };
                    case null return false;
                };
            };
            case null {};
        };

        // Check creator principals filter
        switch (filter.creator_principals) {
            case (?principals) {
                var found = false;
                for (principal in principals.vals()) {
                    if (Principal.equal(item.created_by, principal)) {
                        found := true;
                    };
                };
                if (not found) return false;
            };
            case null {};
        };

        // Check search text filter
        switch (filter.search_text) {
            case (?search_text) {
                let search_lower = Text.map(search_text, func (c: Char) : Char {
                    if (c >= 'A' and c <= 'Z') {
                        Char.fromNat32(Char.toNat32(c) + 32)
                    } else {
                        c
                    }
                });
                
                var text_match = false;
                
                // Check title
                switch (item.title) {
                    case (?title) {
                        let title_lower = Text.map(title, func (c: Char) : Char {
                            if (c >= 'A' and c <= 'Z') {
                                Char.fromNat32(Char.toNat32(c) + 32)
                            } else {
                                c
                            }
                        });
                        if (Text.contains(title_lower, #text search_lower)) {
                            text_match := true;
                        };
                    };
                    case null {};
                };
                
                // Check body if title didn't match
                if (not text_match) {
                    switch (item.body) {
                        case (?body) {
                            let body_lower = Text.map(body, func (c: Char) : Char {
                                if (c >= 'A' and c <= 'Z') {
                                    Char.fromNat32(Char.toNat32(c) + 32)
                                } else {
                                    c
                                }
                            });
                            if (Text.contains(body_lower, #text search_lower)) {
                                text_match := true;
                            };
                        };
                        case null {};
                    };
                };
                
                if (not text_match) return false;
            };
            case null {};
        };

        true
    };

    // get_feed limits (spec/paging_audit.md S5). `length` is clamped to FEED_MAX_ITEMS, a reply stops
    // at about FEED_BYTE_BUDGET bytes of text (always at least one item), at most FEED_MAX_CHECKS ids
    // are looked at, and a page stops early once the query has used FEED_INSTRUCTION_BUDGET
    // instructions (search filters lowercase every body they look at). A page cut short this way says
    // has_more with next_start_id where it stopped, so a client that follows next_start_id sees every
    // item; it may get fewer items than it asked for, or none, on a page.
    public let FEED_MAX_ITEMS : Nat = 500;
    public let FEED_BYTE_BUDGET : Nat = 1_500_000;
    public let FEED_MAX_CHECKS : Nat = 5_000;
    let FEED_INSTRUCTION_BUDGET : Nat64 = 2_500_000_000;

    func opt_text_bytes(t : ?Text) : Nat = switch t { case (?x) Text.encodeUtf8(x).size(); case null 0 };

    // about the size of an item in the reply: its texts plus the fixed fields
    func feed_item_bytes(item : T.FeedItem) : Nat {
        200 + opt_text_bytes(item.title) + opt_text_bytes(item.body) + opt_text_bytes(item.forum_title)
        + opt_text_bytes(item.topic_title) + opt_text_bytes(item.thread_title)
        + (switch (item.replied_to_post) { case (?r) 16 + opt_text_bytes(r.title) + Text.encodeUtf8(r.body).size(); case null 0 })
    };

    public func get_feed(state: ForumState, input: T.GetFeedInput) : T.GetFeedResponse {
        let start_id = switch (input.start_id) {
            case (?id) id;
            case null if (state.next_id > 0) state.next_id - 1 else 0; // Start from highest ID
        };

        let length = Nat.min(input.length, FEED_MAX_ITEMS);
        let items_buffer = Buffer.Buffer<T.FeedItem>(length);
        var current_id = start_id;
        var checked_count = 0;
        var bytes = 0;
        let max_checks = Nat.min(length * 10, FEED_MAX_CHECKS); // Prevent infinite loops

        label scan while (items_buffer.size() < length and current_id > 0 and checked_count < max_checks) {
            if (checked_count > 0 and ExperimentalInternetComputer.performanceCounter(0) > FEED_INSTRUCTION_BUDGET) break scan;
            checked_count += 1;
            
            // Try to find an item with this ID
            var feed_item : ?T.FeedItem = null;
            
            // Check if it's a forum
            switch (Map.get(state.forums, Map.nhash, current_id)) {
                case (?forum) {
                    if (not forum.deleted) {
                        feed_item := build_feed_item_from_forum(state, forum);
                    };
                };
                case null {
                    // Check if it's a topic
                    switch (Map.get(state.topics, Map.nhash, current_id)) {
                        case (?topic) {
                            if (not topic.deleted) {
                                feed_item := build_feed_item_from_topic(state, topic);
                            };
                        };
                        case null {
                            // Check if it's a thread
                            switch (Map.get(state.threads, Map.nhash, current_id)) {
                                case (?thread) {
                                    // not deleted, nor in a deleted topic
                                    if (not thread.deleted and not feed_topic_deleted(state, thread.topic_id)) {
                                        feed_item := build_feed_item_from_thread(state, thread);
                                    };
                                };
                                case null {
                                    // Check if it's a post
                                    switch (Map.get(state.posts, Map.nhash, current_id)) {
                                        case (?post) {
                                            // not deleted, nor in a deleted thread (whose title would show) or topic
                                            if (not post.deleted and not feed_thread_hidden(state, post.thread_id)) {
                                                feed_item := build_feed_item_from_post(state, post);
                                            };
                                        };
                                        case null {};
                                    };
                                };
                            };
                        };
                    };
                };
            };

            // If we found an item, check if it matches the filter
            switch (feed_item) {
                case (?item) {
                    let matches = switch (input.filter) {
                        case (?filter) matches_filter(item, filter);
                        case null true;
                    };
                    
                    if (matches) {
                        let size = feed_item_bytes(item);
                        // the reply is full: this item starts the next page
                        if (items_buffer.size() > 0 and bytes + size > FEED_BYTE_BUDGET) break scan;
                        items_buffer.add(item);
                        bytes += size;
                    };
                };
                case null {};
            };

            current_id -= 1;
        };

        // More ids remain below where scanning stopped, whether the page filled or a budget ran out
        let has_more = current_id > 0 and length > 0;
        let next_start_id = if (has_more) ?current_id else null;

        {
            items = Buffer.toArray(items_buffer);
            has_more;
            next_start_id;
        }
    };

    public func get_threads_by_activity(state: ForumState, topic_id: Nat, start_from: ?Nat, length: Nat, reverse: Bool, show_deleted: Bool) : T.GetThreadsByActivityResponse {
        // Get all threads in the topic
        let thread_activity_pairs = Buffer.Buffer<(T.ThreadResponse, Nat)>(0);
        
        switch (Map.get(state.topic_threads, Map.nhash, topic_id)) {
            case (?thread_ids) {
                for (thread_id in Vector.vals(thread_ids)) {
                    switch (get_thread(state, thread_id)) {
                        case (?thread_response) {
                            if (show_deleted or not thread_response.deleted) {
                                // Find the highest post ID in this thread
                                let highest_post_id = get_highest_post_id_in_thread(state, thread_id);
                                thread_activity_pairs.add((thread_response, highest_post_id));
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };

        // Sort by activity (highest post ID)
        let sorted_pairs = Array.sort(Buffer.toArray(thread_activity_pairs), func(a : (T.ThreadResponse, Nat), b : (T.ThreadResponse, Nat)) : Order.Order {
            let (_, a_activity) = a;
            let (_, b_activity) = b;
            if (reverse) {
                Nat.compare(b_activity, a_activity) // Newest activity first
            } else {
                Nat.compare(a_activity, b_activity) // Oldest activity first
            }
        });

        // Apply pagination
        let total_count = sorted_pairs.size();
        let start_index = switch (start_from) {
            case (?from) from;
            case null 0;
        };
        
        let end_index = Nat.min(start_index + length, total_count);
        let has_more = end_index < total_count;
        let next_start_from = if (has_more) ?end_index else null;

        // Extract threads from the paginated slice
        let result_threads = Buffer.Buffer<T.ThreadResponse>(0);
        var i = start_index;
        while (i < end_index) {
            let (thread_response, _) = sorted_pairs[i];
            result_threads.add(thread_response);
            i += 1;
        };

        {
            threads = Buffer.toArray(result_threads);
            has_more = has_more;
            next_start_from = next_start_from;
        }
    };

    // Get threads by activity with unread counts for a specific caller
    public func get_threads_by_activity_with_unread_counts(state: ForumState, topic_id: Nat, start_from: ?Nat, length: Nat, reverse: Bool, show_deleted: Bool, caller: Principal) : T.GetThreadsByActivityResponse {
        // Get all threads in the topic
        let thread_activity_pairs = Buffer.Buffer<(T.ThreadResponse, Nat)>(0);
        
        switch (Map.get(state.topic_threads, Map.nhash, topic_id)) {
            case (?thread_ids) {
                for (thread_id in Vector.vals(thread_ids)) {
                    switch (get_thread_with_unread_count(state, thread_id, caller)) {
                        case (?thread_response) {
                            if (show_deleted or not thread_response.deleted) {
                                // Find the highest post ID in this thread
                                let highest_post_id = get_highest_post_id_in_thread(state, thread_id);
                                thread_activity_pairs.add((thread_response, highest_post_id));
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };

        // Sort by activity (highest post ID)
        let sorted_pairs = Array.sort(Buffer.toArray(thread_activity_pairs), func(a : (T.ThreadResponse, Nat), b : (T.ThreadResponse, Nat)) : Order.Order {
            let (_, a_activity) = a;
            let (_, b_activity) = b;
            if (reverse) {
                Nat.compare(b_activity, a_activity) // Newest activity first
            } else {
                Nat.compare(a_activity, b_activity) // Oldest activity first
            }
        });

        // Apply pagination
        let total_count = sorted_pairs.size();
        let start_index = switch (start_from) {
            case (?from) from;
            case null 0;
        };
        
        let end_index = Nat.min(start_index + length, total_count);
        let has_more = end_index < total_count;
        let next_start_from = if (has_more) ?end_index else null;

        // Extract threads from the paginated slice
        let result_threads = Buffer.Buffer<T.ThreadResponse>(0);
        var i = start_index;
        while (i < end_index) {
            let (thread_response, _) = sorted_pairs[i];
            result_threads.add(thread_response);
            i += 1;
        };

        {
            threads = Buffer.toArray(result_threads);
            has_more;
            next_start_from;
        }
    };

    private func get_highest_post_id_in_thread(state: ForumState, thread_id: Nat) : Nat {
        switch (Map.get(state.thread_posts, Map.nhash, thread_id)) {
            case (?post_ids) {
                var highest_id = 0;
                for (post_id in Vector.vals(post_ids)) {
                    if (post_id > highest_id) {
                        highest_id := post_id;
                    };
                };
                highest_id
            };
            case null 0; // No posts in thread, use 0 as activity level
        }
    };

    // Read tracking functions
    private func make_user_thread_key(user: Principal, thread_id: Nat) : Text {
        Principal.toText(user) # ":" # Nat.toText(thread_id)
    };

    public func set_last_read_post(state: ForumState, caller: Principal, thread_id: Nat, last_read_post_id: Nat) : T.SetLastReadPostResponse {
        // read marks are per signed-in member and per existing thread (nobody grows the state with marks on nothing)
        if (Principal.isAnonymous(caller)) return { success = false; message = "Log in to keep read marks" };
        if (not Map.has(state.threads, Map.nhash, thread_id)) return { success = false; message = "Thread not found" };
        let key = make_user_thread_key(caller, thread_id);
        let current_time = Time.now();
        
        let read_data : T.UserThreadReadData = {
            last_read_post_id = last_read_post_id;
            updated_at = current_time;
        };
        
        Map.set(state.user_thread_reads, Map.thash, key, read_data);
        
        {
            success = true;
            message = "Last read post updated successfully";
        }
    };

    public func get_last_read_post(state: ForumState, caller: Principal, thread_id: Nat) : T.GetLastReadPostResponse {
        let key = make_user_thread_key(caller, thread_id);
        
        switch (Map.get(state.user_thread_reads, Map.thash, key)) {
            case (?read_data) {
                { last_read_post_id = ?read_data.last_read_post_id }
            };
            case null {
                { last_read_post_id = null }
            };
        }
    };

    public func get_user_thread_reads_for_topic(state: ForumState, caller: Principal, topic_id: Nat) : [(Nat, Nat)] {
        let results = Buffer.Buffer<(Nat, Nat)>(0);
        
        // Get all threads in the topic
        switch (Map.get(state.topic_threads, Map.nhash, topic_id)) {
            case (?thread_ids) {
                for (thread_id in Vector.vals(thread_ids)) {
                    let key = make_user_thread_key(caller, thread_id);
                    switch (Map.get(state.user_thread_reads, Map.thash, key)) {
                        case (?read_data) {
                            results.add((thread_id, read_data.last_read_post_id));
                        };
                        case null {
                            // No read data means they haven't read any posts in this thread
                            results.add((thread_id, 0));
                        };
                    };
                };
            };
            case null {};
        };
        
        Buffer.toArray(results)
    };

    // Helper function to calculate both unread and total post counts for a user in a thread
    private func calculate_thread_post_counts(state: ForumState, caller: Principal, thread_id: Nat) : (Nat, Nat) {
        let key = make_user_thread_key(caller, thread_id);
        let last_read_post_id = switch (Map.get(state.user_thread_reads, Map.thash, key)) {
            case (?read_data) read_data.last_read_post_id;
            case null 0; // Never read = 0
        };
        
        var total_count = 0;
        var unread_count = 0;
        
        switch (Map.get(state.thread_posts, Map.nhash, thread_id)) {
            case (?post_ids) {
                for (post_id in Vector.vals(post_ids)) {
                    // Check if post exists and user can see it
                    switch (Map.get(state.posts, Map.nhash, post_id)) {
                        case (?post) {
                            let user_can_see_post = if (not post.deleted) {
                                true
                            } else {
                                // If post is deleted, check if user is the author
                                switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, post.created_by)) {
                                    case (?post_author) Principal.equal(post_author, caller);
                                    case null false;
                                };
                            };
                            
                            if (user_can_see_post) {
                                total_count += 1;
                                if (post_id > last_read_post_id) {
                                    unread_count += 1;
                                };
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };
        
        (unread_count, total_count)
    };

    // Calculate statistics for a topic (thread count and total unread posts)
    public func get_topic_statistics(state: ForumState, caller: Principal, topic_id: Nat) : T.TopicStatistics {
        var thread_count = 0;
        var total_unread_posts = 0;
        
        switch (Map.get(state.topic_threads, Map.nhash, topic_id)) {
            case (?thread_ids) {
                for (thread_id in Vector.vals(thread_ids)) {
                    // Check if thread exists and is not deleted
                    switch (Map.get(state.threads, Map.nhash, thread_id)) {
                        case (?thread) {
                            if (not thread.deleted) {
                                thread_count += 1;
                                // Calculate unread posts for this thread
                                let (unread_count, _) = calculate_thread_post_counts(state, caller, thread_id);
                                total_unread_posts += unread_count;
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };
        
        {
            topic_id = topic_id;
            thread_count = thread_count;
            total_unread_posts = total_unread_posts;
        }
    };
}
