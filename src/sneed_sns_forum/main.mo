import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Result "mo:base/Result";
import Map "mo:map/Map";
import Buffer "mo:base/Buffer";
import Dedup "mo:dedup";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Debug "mo:base/Debug";
import Vector "mo:vector";
import Blob "mo:base/Blob";
import Nat64 "mo:base/Nat64";
import Nat "mo:base/Nat";

import T "Types";
import Lib "lib";

actor SneedSNSForum {
    // NNS SNS-W canister interface for getting deployed SNS instances
    type DeployedSns = {
        root_canister_id : ?Principal;
        governance_canister_id : ?Principal;
        index_canister_id : ?Principal;
        swap_canister_id : ?Principal;
        ledger_canister_id : ?Principal;
    };

    type ListDeployedSnsesResponse = {
        instances : [DeployedSns];
    };

    type NNSSnsWCanister = actor {
        list_deployed_snses : ({}) -> async ListDeployedSnsesResponse;
    };

    // SNS cache types
    type SnsCache = {
        instances: [DeployedSns];
        last_updated: Int;
    };

    // SNS Governance canister interface for voting power validation
    type NeuronPermission = {
        principal: ?Principal;
        permission_type: [Int32];
    };

    type Neuron = {
        id: ?T.NeuronId;
        permissions: [NeuronPermission];
        cached_neuron_stake_e8s: Nat64;
        neuron_fees_e8s: Nat64;
        created_timestamp_seconds: Nat64;
        aging_since_timestamp_seconds: Nat64;
        voting_power_percentage_multiplier: Nat64;
        dissolve_delay_seconds: Nat64;
        followees: [(Int32, { followees: [T.NeuronId] })];
    };

    type ListNeuronsResponse = {
        neurons: [Neuron];
    };

    type SNSGovernanceCanister = actor {
        list_neurons: ({
            of_principal: ?Principal;
            limit: Nat32;
            start_page_at: ?T.NeuronId;
        }) -> async ListNeuronsResponse;
        
        get_neuron: (T.NeuronId) -> async ?Neuron;
    };

    // Constants
    private let NNS_SNS_W_CANISTER_ID = "qaa6y-5yaaa-aaaah-qcbsq-cai"; // NNS SNS-W canister
    private let CACHE_EXPIRY_NANOSECONDS = 24 * 60 * 60 * 1_000_000_000; // 24 hours in nanoseconds

    // Non-stable cache for SNS instances (will be refreshed on canister upgrade)
    private var sns_cache : ?SnsCache = null;

    // Stable storage using stable Map and Vector structures
    stable var stable_next_id : Nat = 1;
    stable let stable_forums = Map.new<Nat, T.Forum>();
    stable let stable_topics = Map.new<Nat, T.Topic>();
    stable let stable_threads = Map.new<Nat, T.Thread>();
    stable let stable_posts = Map.new<Nat, T.Post>();
    stable let stable_votes = Map.new<T.VoteKey, T.Vote>();
    stable let stable_admins = Vector.new<T.AdminInfo>();
    stable var stable_principal_dedup : Dedup.DedupState = Dedup.empty();
    stable var stable_neuron_dedup : Dedup.DedupState = Dedup.empty();
    stable let stable_forum_topics = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_topic_subtopics = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_topic_threads = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_thread_posts = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_post_replies = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_proposal_topics = Map.new<Nat, T.ProposalTopicMapping>();
    stable let stable_proposal_threads = Map.new<T.ProposalThreadKey, T.ProposalThreadMapping>();
    stable let stable_thread_proposals = Map.new<Nat, (Nat32, Nat)>();

    // Runtime state that directly references stable storage
    private var state : T.ForumState = {
        var next_id = stable_next_id;
        forums = stable_forums;
        topics = stable_topics;
        threads = stable_threads;
        posts = stable_posts;
        votes = stable_votes;
        admins = stable_admins;
        principal_dedup_state = stable_principal_dedup;
        neuron_dedup_state = stable_neuron_dedup;
        forum_topics = stable_forum_topics;
        topic_subtopics = stable_topic_subtopics;
        topic_threads = stable_topic_threads;
        thread_posts = stable_thread_posts;
        post_replies = stable_post_replies;
        proposal_topics = stable_proposal_topics;
        proposal_threads = stable_proposal_threads;
        thread_proposals = stable_thread_proposals;
    };

    // SNS cache management functions
    private func is_cache_expired() : Bool {
        switch (sns_cache) {
            case (?cache) {
                let current_time = Time.now();
                (current_time - cache.last_updated) > CACHE_EXPIRY_NANOSECONDS
            };
            case null true;
        }
    };

    private func refresh_sns_cache() : async Bool {
        try {
            let nns_sns_w : NNSSnsWCanister = actor(NNS_SNS_W_CANISTER_ID);
            let response = await nns_sns_w.list_deployed_snses({});
            
            sns_cache := ?{
                instances = response.instances;
                last_updated = Time.now();
            };
            
            Debug.print("SNS cache refreshed with " # Nat.toText(response.instances.size()) # " instances");
            true
        } catch (error) {
            Debug.print("Failed to refresh SNS cache");
            false
        }
    };

    private func get_governance_canister_from_cache(root_canister_id: Principal) : ?Principal {
        switch (sns_cache) {
            case (?cache) {
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
            case null null;
        }
    };

    private func ensure_sns_cache() : async Bool {
        if (is_cache_expired()) {
            await refresh_sns_cache()
        } else {
            true
        }
    };

    // Helper function to get SNS governance canister ID from forum
    private func get_sns_governance_canister_id(forum_id: Nat) : async ?Principal {
        switch (Lib.get_forum(state, forum_id)) {
            case (?forum_response) {
                switch (forum_response.sns_root_canister_id) {
                    case (?sns_root) {
                        // Ensure cache is fresh
                        let cache_ok = await ensure_sns_cache();
                        if (not cache_ok) {
                            Debug.print("Failed to refresh SNS cache, cannot get governance canister ID");
                            return null;
                        };
                        
                        // Look up governance canister from cache
                        get_governance_canister_from_cache(sns_root)
                    };
                    case null null;
                };
            };
            case null null;
        };
    };

    // Helper function to calculate voting power for a neuron
    private func calculate_neuron_voting_power(neuron: Neuron) : Nat {
        let stake = Nat64.toNat(neuron.cached_neuron_stake_e8s);
        let multiplier = Nat64.toNat(neuron.voting_power_percentage_multiplier);
        
        if (multiplier > 0) {
            (stake * multiplier) / 100
        } else {
            stake
        }
    };

    // Helper function to check if caller has hotkey permission for neuron
    private func has_hotkey_permission(caller: Principal, neuron: Neuron) : Bool {
        for (permission in neuron.permissions.vals()) {
            switch (permission.principal) {
                case (?principal) {
                    if (Principal.equal(principal, caller)) {
                        // Check if they have voting permission (permission type 1 is typically voting)
                        for (perm_type in permission.permission_type.vals()) {
                            if (perm_type == 1) { // Voting permission
                                return true;
                            };
                        };
                    };
                };
                case null {};
            };
        };
        false
    };

    // Helper function to validate that caller has hotkey access to the neuron
    private func validate_neuron_access(caller: Principal, neuron_id: T.NeuronId, forum_id: Nat) : async Bool {
        switch (await get_sns_governance_canister_id(forum_id)) {
            case (?governance_canister_id) {
                try {
                    let governance_canister : SNSGovernanceCanister = actor(Principal.toText(governance_canister_id));
                    
                    // Get the specific neuron
                    switch (await governance_canister.get_neuron(neuron_id)) {
                        case (?neuron) {
                            has_hotkey_permission(caller, neuron)
                        };
                        case null false;
                    };
                } catch (error) {
                    Debug.print("Error calling SNS governance canister for neuron validation");
                    false
                }
            };
            case null false;
        };
    };

    // Helper function to get caller's voting power from SNS
    private func get_caller_voting_power(caller: Principal, neuron_id: T.NeuronId, forum_id: Nat) : async Nat {
        switch (await get_sns_governance_canister_id(forum_id)) {
            case (?governance_canister_id) {
                try {
                    let governance_canister : SNSGovernanceCanister = actor(Principal.toText(governance_canister_id));
                    
                    // Get the specific neuron
                    switch (await governance_canister.get_neuron(neuron_id)) {
                        case (?neuron) {
                            // Check if caller has permission to use this neuron
                            if (has_hotkey_permission(caller, neuron)) {
                                calculate_neuron_voting_power(neuron)
                            } else {
                                0
                            }
                        };
                        case null 0;
                    };
                } catch (error) {
                    Debug.print("Error calling SNS governance canister for voting power");
                    0
                }
            };
            case null 0;
        };
    };

    // Admin management endpoints
    public shared ({ caller }) func add_admin(new_admin: Principal) : async T.Result<(), T.ForumError> {
        Lib.add_admin(state, caller, new_admin)
    };

    public shared ({ caller }) func remove_admin(admin_to_remove: Principal) : async T.Result<(), T.ForumError> {
        Lib.remove_admin(state, caller, admin_to_remove)
    };

    public query func get_admins() : async [T.AdminInfo] {
        Lib.get_admins(state)
    };

    public query func is_admin(principal: Principal) : async Bool {
        Lib.is_admin(state, principal)
    };

    // Forum API endpoints
    public shared ({ caller }) func create_forum(input: T.CreateForumInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_forum(state, caller, input)
    };

    public shared ({ caller }) func update_forum(id: Nat, input: T.CreateForumInput) : async T.Result<(), T.ForumError> {
        Lib.update_forum(state, caller, id, input)
    };

    public query ({ caller }) func get_forum(id: Nat) : async ?T.ForumResponse {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_forum_filtered(state, id, is_admin)
    };

    public query ({ caller }) func get_forums() : async [T.ForumResponse] {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_forums_filtered(state, is_admin)
    };

    // Topic API endpoints
    public shared ({ caller }) func create_topic(input: T.CreateTopicInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_topic(state, caller, input)
    };

    public shared ({ caller }) func update_topic(id: Nat, input: T.CreateTopicInput) : async T.Result<(), T.ForumError> {
        Lib.update_topic(state, caller, id, input)
    };

    public query ({ caller }) func get_topic(id: Nat) : async ?T.TopicResponse {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_topic_filtered(state, id, is_admin)
    };

    public query ({ caller }) func get_topics_by_forum(forum_id: Nat) : async [T.TopicResponse] {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_topics_by_forum_filtered(state, forum_id, is_admin)
    };

    public query ({ caller }) func get_subtopics(topic_id: Nat) : async [T.TopicResponse] {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_subtopics_filtered(state, topic_id, is_admin)
    };

    // Thread API endpoints
    public shared ({ caller }) func create_thread(input: T.CreateThreadInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_thread(state, caller, input)
    };

    public shared ({ caller }) func update_thread(id: Nat, title: ?Text, body: Text) : async T.Result<(), T.ForumError> {
        Lib.update_thread(state, caller, id, title, body)
    };

    public query ({ caller }) func get_thread(id: Nat) : async ?T.ThreadResponse {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_thread_filtered(state, id, is_admin)
    };

    public query ({ caller }) func get_threads_by_topic(topic_id: Nat) : async [T.ThreadResponse] {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_threads_by_topic_filtered(state, topic_id, is_admin)
    };

    // Post API endpoints
    public shared ({ caller }) func create_post(input: T.CreatePostInput, neuron_id: T.NeuronId) : async T.Result<Nat, T.ForumError> {
        // Get the thread to determine which forum/SNS this belongs to
        switch (Lib.get_thread(state, input.thread_id)) {
            case (?thread_response) {
                switch (Lib.get_topic(state, thread_response.topic_id)) {
                    case (?topic_response) {
                        switch (Lib.get_forum(state, topic_response.forum_id)) {
                            case (?forum_response) {
                                // Validate that caller has access to this neuron
                                let has_access = await validate_neuron_access(caller, neuron_id, topic_response.forum_id);
                                if (not has_access) {
                                    return #err(#Unauthorized("You do not have access to this neuron"));
                                };
                                
                                // Get voting power for initial score
                                let voting_power = await get_caller_voting_power(caller, neuron_id, topic_response.forum_id);
                                if (voting_power == 0) {
                                    return #err(#Unauthorized("Neuron has no voting power"));
                                };
                                
                                Lib.create_post(state, caller, input, voting_power)
                            };
                            case null #err(#NotFound("Forum not found"));
                        };
                    };
                    case null #err(#NotFound("Topic not found"));
                };
            };
            case null #err(#NotFound("Thread not found"));
        }
    };

    public shared ({ caller }) func update_post(id: Nat, title: ?Text, body: Text) : async T.Result<(), T.ForumError> {
        Lib.update_post(state, caller, id, title, body)
    };

    public query ({ caller }) func get_post(id: Nat) : async ?T.PostResponse {
        Lib.get_post_filtered(state, id, false) // show_deleted = false for all users
    };

    public query ({ caller }) func get_posts_by_thread(thread_id: Nat) : async [T.PostResponse] {
        Lib.get_posts_by_thread_filtered(state, thread_id, false) // show_deleted = false for all users
    };

    public query ({ caller }) func get_post_replies(post_id: Nat) : async [T.PostResponse] {
        Lib.get_post_replies_filtered(state, post_id, false) // show_deleted = false for all users
    };

    // Voting API endpoints
    public shared ({ caller }) func vote_on_post(
        post_id: Nat,
        neuron_id: T.NeuronId,
        vote_type: T.VoteType
    ) : async T.Result<(), T.ForumError> {
        // Get the post to determine which forum/SNS this belongs to
        switch (Lib.get_post(state, post_id)) {
            case (?post_response) {
                switch (Lib.get_thread(state, post_response.thread_id)) {
                    case (?thread_response) {
                        switch (Lib.get_topic(state, thread_response.topic_id)) {
                            case (?topic_response) {
                                switch (Lib.get_forum(state, topic_response.forum_id)) {
                                    case (?forum_response) {
                                        // Validate that caller has access to this neuron
                                        let has_access = await validate_neuron_access(caller, neuron_id, topic_response.forum_id);
                                        if (not has_access) {
                                            return #err(#Unauthorized("You do not have access to this neuron"));
                                        };
                                        
                                        // Get voting power from SNS
                                        let voting_power = await get_caller_voting_power(caller, neuron_id, topic_response.forum_id);
                                        if (voting_power == 0) {
                                            return #err(#Unauthorized("Neuron has no voting power"));
                                        };
                                        
                                        Lib.vote_on_post(state, caller, post_id, neuron_id, vote_type, voting_power)
                                    };
                                    case null #err(#NotFound("Forum not found"));
                                };
                            };
                            case null #err(#NotFound("Topic not found"));
                        };
                    };
                    case null #err(#NotFound("Thread not found"));
                };
            };
            case null #err(#NotFound("Post not found"));
        }
    };

    public shared ({ caller }) func retract_vote(
        post_id: Nat,
        neuron_id: T.NeuronId
    ) : async T.Result<(), T.ForumError> {
        // Get the post to determine which forum/SNS this belongs to
        switch (Lib.get_post(state, post_id)) {
            case (?post_response) {
                switch (Lib.get_thread(state, post_response.thread_id)) {
                    case (?thread_response) {
                        switch (Lib.get_topic(state, thread_response.topic_id)) {
                            case (?topic_response) {
                                switch (Lib.get_forum(state, topic_response.forum_id)) {
                                    case (?forum_response) {
                                        // Validate that caller has access to this neuron
                                        let has_access = await validate_neuron_access(caller, neuron_id, topic_response.forum_id);
                                        if (not has_access) {
                                            return #err(#Unauthorized("You do not have access to this neuron"));
                                        };
                                        
                                        Lib.retract_vote(state, caller, post_id, neuron_id)
                                    };
                                    case null #err(#NotFound("Forum not found"));
                                };
                            };
                            case null #err(#NotFound("Topic not found"));
                        };
                    };
                    case null #err(#NotFound("Thread not found"));
                };
            };
            case null #err(#NotFound("Post not found"));
        }
    };

    public query func get_post_votes(post_id: Nat) : async [T.VoteResponse] {
        Lib.get_post_votes(state, post_id)
    };

    // Get caller's available voting neurons for a specific forum
    public shared ({ caller }) func get_caller_voting_neurons(forum_id: Nat) : async T.Result<[(T.NeuronId, Nat)], T.ForumError> {
        // Get the forum to determine which SNS this belongs to
        switch (Lib.get_forum(state, forum_id)) {
            case (?forum_response) {
                switch (await get_sns_governance_canister_id(forum_id)) {
                    case (?governance_canister_id) {
                        try {
                            let governance_canister : SNSGovernanceCanister = actor(Principal.toText(governance_canister_id));
                            
                            // List neurons for this caller
                            let response = await governance_canister.list_neurons({
                                of_principal = ?caller;
                                limit = 100; // Reasonable limit
                                start_page_at = null;
                            });
                            
                            // Find the caller's neurons and their voting power
                            let neurons_buffer = Buffer.Buffer<(T.NeuronId, Nat)>(0);
                            for (neuron in response.neurons.vals()) {
                                switch (neuron.id) {
                                    case (?nid) {
                                        // Check if caller has hotkey permission for this neuron
                                        if (has_hotkey_permission(caller, neuron)) {
                                            let voting_power = calculate_neuron_voting_power(neuron);
                                            if (voting_power > 0) {
                                                neurons_buffer.add((nid, voting_power));
                                            };
                                        };
                                    };
                                    case null {};
                                };
                            };
                            
                            #ok(Buffer.toArray(neurons_buffer))
                        } catch (error) {
                            #err(#InternalError("Failed to fetch voting neurons from SNS governance canister"))
                        }
                    };
                    case null #err(#InternalError("No SNS governance canister found for this forum"));
                };
            };
            case null #err(#NotFound("Forum not found"));
        }
    };

    // Admin/utility endpoints
    public query func get_stats() : async T.ForumStats {
        {
            total_forums = Map.size(state.forums);
            total_topics = Map.size(state.topics);
            total_threads = Map.size(state.threads);
            total_posts = Map.size(state.posts);
            total_votes = Map.size(state.votes);
        }
    };

    // Health check endpoint
    public query func health_check() : async Bool {
        true
    };

    // Admin delete endpoints
    public shared ({ caller }) func delete_forum(id: Nat) : async T.Result<(), T.ForumError> {
        Lib.soft_delete_forum(state, caller, id)
    };

    public shared ({ caller }) func delete_topic(id: Nat) : async T.Result<(), T.ForumError> {
        Lib.soft_delete_topic(state, caller, id)
    };

    public shared ({ caller }) func delete_thread(id: Nat) : async T.Result<(), T.ForumError> {
        Lib.soft_delete_thread(state, caller, id)
    };

    public shared ({ caller }) func delete_post(id: Nat) : async T.Result<(), T.ForumError> {
        Lib.soft_delete_post(state, caller, id)
    };

    // Admin query functions that show deleted items
    public query ({ caller }) func get_forums_admin() : async [T.ForumResponse] {
        if (not Lib.is_admin(state, caller)) {
            return [];
        };
        Lib.get_forums_filtered(state, true) // show_deleted = true for admins
    };

    public query ({ caller }) func get_topics_by_forum_admin(forum_id: Nat) : async [T.TopicResponse] {
        if (not Lib.is_admin(state, caller)) {
            return [];
        };
        Lib.get_topics_by_forum_filtered(state, forum_id, true)
    };

    public query ({ caller }) func get_threads_by_topic_admin(topic_id: Nat) : async [T.ThreadResponse] {
        if (not Lib.is_admin(state, caller)) {
            return [];
        };
        Lib.get_threads_by_topic_filtered(state, topic_id, true)
    };

    public query ({ caller }) func get_posts_by_thread_admin(thread_id: Nat) : async [T.PostResponse] {
        if (not Lib.is_admin(state, caller)) {
            return [];
        };
        Lib.get_posts_by_thread_filtered(state, thread_id, true)
    };

    // Admin endpoints for individual items
    public query ({ caller }) func get_forum_admin(id: Nat) : async ?T.ForumResponse {
        if (not Lib.is_admin(state, caller)) {
            return null;
        };
        Lib.get_forum_filtered(state, id, true)
    };

    public query ({ caller }) func get_topic_admin(id: Nat) : async ?T.TopicResponse {
        if (not Lib.is_admin(state, caller)) {
            return null;
        };
        Lib.get_topic_filtered(state, id, true)
    };

    public query ({ caller }) func get_thread_admin(id: Nat) : async ?T.ThreadResponse {
        if (not Lib.is_admin(state, caller)) {
            return null;
        };
        Lib.get_thread_filtered(state, id, true)
    };

    public query ({ caller }) func get_post_admin(id: Nat) : async ?T.PostResponse {
        if (not Lib.is_admin(state, caller)) {
            return null;
        };
        Lib.get_post_filtered(state, id, true)
    };

    public query ({ caller }) func get_post_replies_admin(post_id: Nat) : async [T.PostResponse] {
        if (not Lib.is_admin(state, caller)) {
            return [];
        };
        Lib.get_post_replies_filtered(state, post_id, true)
    };

    // Proposal management endpoints
    public shared ({ caller }) func set_proposals_topic(input: T.SetProposalTopicInput) : async T.Result<(), T.ForumError> {
        Lib.set_proposals_topic(state, caller, input)
    };

    public query func get_proposals_topic(forum_id: Nat) : async ?T.ProposalTopicMappingResponse {
        Lib.get_proposals_topic_response(state, forum_id)
    };

    public shared ({ caller }) func create_proposal_thread(input: T.CreateProposalThreadInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_proposal_thread(state, caller, input)
    };

    public query func get_proposal_thread(sns_root: Principal, proposal_id: Nat) : async ?T.ProposalThreadMappingResponse {
        Lib.get_proposal_thread_response(state, sns_root, proposal_id)
    };

    public query func get_thread_proposal_id(thread_id: Nat) : async ?(Nat32, Nat) {
        Lib.get_thread_proposal_id(state, thread_id)
    };

    public shared ({ caller }) func remove_proposals_topic(forum_id: Nat) : async T.Result<(), T.ForumError> {
        Lib.remove_proposals_topic(state, caller, forum_id)
    };

    // System upgrade hooks to maintain stable storage consistency
    system func preupgrade() {
        stable_next_id := state.next_id;
    };

    system func postupgrade() {
        // State is already initialized with stable values
        // This ensures any post-upgrade initialization if needed
    };
}