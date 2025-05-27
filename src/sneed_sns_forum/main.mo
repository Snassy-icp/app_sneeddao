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

import T "Types";
import Lib "lib";

actor SneedSNSForum {
    // RLL canister interface for voting power validation
    type RLLNeuron = {
        id: ?T.NeuronId;
        permissions: [{
            principal: ?Principal;
            permission_type: [Int32];
        }];
        cached_neuron_stake_e8s: Nat64;
        neuron_fees_e8s: Nat64;
        created_timestamp_seconds: Nat64;
        aging_since_timestamp_seconds: Nat64;
        voting_power_percentage_multiplier: Nat64;
    };

    type RLLVotingPowerResponse = {
        distribution_voting_power: Nat64;
        neurons_by_owner: [(Principal, [RLLNeuron])];
        total_voting_power: Nat64;
    };

    type RLLCanister = actor {
        get_hotkey_voting_power: ([RLLNeuron]) -> async RLLVotingPowerResponse;
    };

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

    // Helper function to get caller's voting power from SNS
    private func get_caller_voting_power(caller: Principal, neuron_id: T.NeuronId, sns_root: ?Principal) : async Nat {
        // Get the RLL canister ID based on the SNS root
        let rll_canister_id = switch (sns_root) {
            case (?root) {
                // For now, use the default RLL canister - in production you'd map SNS roots to their RLL canisters
                Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai") // Default Sneed RLL canister
            };
            case null {
                Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai") // Default Sneed RLL canister
            };
        };

        try {
            let rll_canister : RLLCanister = actor(Principal.toText(rll_canister_id));
            
            // Create a neuron object to query with
            let query_neuron : RLLNeuron = {
                id = ?neuron_id;
                permissions = [];
                cached_neuron_stake_e8s = 0;
                neuron_fees_e8s = 0;
                created_timestamp_seconds = 0;
                aging_since_timestamp_seconds = 0;
                voting_power_percentage_multiplier = 0;
            };

            // Call RLL canister to get voting power for this caller's neurons
            let response = await rll_canister.get_hotkey_voting_power([query_neuron]);
            
            // Find the caller's neurons and calculate their total voting power
            var total_voting_power : Nat = 0;
            for ((owner, neurons) in response.neurons_by_owner.vals()) {
                if (Principal.equal(owner, caller)) {
                    for (neuron in neurons.vals()) {
                        switch (neuron.id) {
                            case (?nid) {
                                // Check if this is the neuron they're trying to vote with
                                if (Blob.equal(nid.id, neuron_id.id)) {
                                    // Calculate voting power based on stake and multiplier
                                    let stake = Nat64.toNat(neuron.cached_neuron_stake_e8s);
                                    let multiplier = Nat64.toNat(neuron.voting_power_percentage_multiplier);
                                    if (multiplier > 0) {
                                        total_voting_power += (stake * multiplier) / 100;
                                    };
                                };
                            };
                            case null {};
                        };
                    };
                };
            };
            
            total_voting_power
        } catch (error) {
            // If we can't reach the RLL canister, return 0 voting power for security
            Debug.print("Error calling RLL canister for voting power validation");
            0
        }
    };

    // Helper function to validate that caller has hotkey access to the neuron
    private func validate_neuron_access(caller: Principal, neuron_id: T.NeuronId, sns_root: ?Principal) : async Bool {
        // Get the RLL canister ID based on the SNS root
        let rll_canister_id = switch (sns_root) {
            case (?root) {
                Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai") // Default Sneed RLL canister
            };
            case null {
                Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai") // Default Sneed RLL canister
            };
        };

        try {
            let rll_canister : RLLCanister = actor(Principal.toText(rll_canister_id));
            
            // Create a neuron object to query with
            let query_neuron : RLLNeuron = {
                id = ?neuron_id;
                permissions = [];
                cached_neuron_stake_e8s = 0;
                neuron_fees_e8s = 0;
                created_timestamp_seconds = 0;
                aging_since_timestamp_seconds = 0;
                voting_power_percentage_multiplier = 0;
            };

            // Call RLL canister to get voting power for this caller's neurons
            let response = await rll_canister.get_hotkey_voting_power([query_neuron]);
            
            // Check if the caller has access to this neuron
            for ((owner, neurons) in response.neurons_by_owner.vals()) {
                if (Principal.equal(owner, caller)) {
                    for (neuron in neurons.vals()) {
                        switch (neuron.id) {
                            case (?nid) {
                                if (Blob.equal(nid.id, neuron_id.id)) {
                                    return true;
                                };
                            };
                            case null {};
                        };
                    };
                };
            };
            
            false
        } catch (error) {
            // If we can't reach the RLL canister, deny access for security
            Debug.print("Error calling RLL canister for neuron validation");
            false
        }
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
                                let has_access = await validate_neuron_access(caller, neuron_id, forum_response.sns_root_canister_id);
                                if (not has_access) {
                                    return #err(#Unauthorized("You do not have access to this neuron"));
                                };
                                
                                // Get voting power for initial score
                                let voting_power = await get_caller_voting_power(caller, neuron_id, forum_response.sns_root_canister_id);
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
                                        let has_access = await validate_neuron_access(caller, neuron_id, forum_response.sns_root_canister_id);
                                        if (not has_access) {
                                            return #err(#Unauthorized("You do not have access to this neuron"));
                                        };
                                        
                                        // Get voting power from SNS
                                        let voting_power = await get_caller_voting_power(caller, neuron_id, forum_response.sns_root_canister_id);
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
                                        let has_access = await validate_neuron_access(caller, neuron_id, forum_response.sns_root_canister_id);
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
                // Get the RLL canister ID based on the SNS root
                let rll_canister_id = switch (forum_response.sns_root_canister_id) {
                    case (?root) {
                        Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai") // Default Sneed RLL canister
                    };
                    case null {
                        Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai") // Default Sneed RLL canister
                    };
                };

                try {
                    let rll_canister : RLLCanister = actor(Principal.toText(rll_canister_id));
                    
                    // Call RLL canister to get voting power for this caller's neurons
                    let response = await rll_canister.get_hotkey_voting_power([]);
                    
                    // Find the caller's neurons and their voting power
                    let neurons_buffer = Buffer.Buffer<(T.NeuronId, Nat)>(0);
                    for ((owner, neurons) in response.neurons_by_owner.vals()) {
                        if (Principal.equal(owner, caller)) {
                            for (neuron in neurons.vals()) {
                                switch (neuron.id) {
                                    case (?nid) {
                                        // Calculate voting power based on stake and multiplier
                                        let stake = Nat64.toNat(neuron.cached_neuron_stake_e8s);
                                        let multiplier = Nat64.toNat(neuron.voting_power_percentage_multiplier);
                                        let voting_power = if (multiplier > 0) {
                                            (stake * multiplier) / 100
                                        } else {
                                            0
                                        };
                                        
                                        if (voting_power > 0) {
                                            neurons_buffer.add((nid, voting_power));
                                        };
                                    };
                                    case null {};
                                };
                            };
                        };
                    };
                    
                    #ok(Buffer.toArray(neurons_buffer))
                } catch (error) {
                    #err(#InternalError("Failed to fetch voting neurons from RLL canister"))
                }
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