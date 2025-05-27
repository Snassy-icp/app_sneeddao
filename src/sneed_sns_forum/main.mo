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

import T "Types";
import Lib "lib";

actor SneedSNSForum {
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
    stable let stable_proposal_threads = Map.new<Nat, T.ProposalThreadMapping>();
    stable let stable_thread_proposals = Map.new<Nat, Nat>();

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
        // This is a simplified implementation
        // In a real implementation, you would call the SNS governance canister
        // to get the actual voting power of the neuron
        switch (sns_root) {
            case (?root) {
                // Call SNS governance to get voting power
                // For now, return a default value
                1
            };
            case null {
                // Use default SNS root
                1
            };
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
                                // Get voting power for initial score
                                let voting_power = await get_caller_voting_power(caller, neuron_id, forum_response.sns_root_canister_id);
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
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_post_filtered(state, id, is_admin)
    };

    public query ({ caller }) func get_posts_by_thread(thread_id: Nat) : async [T.PostResponse] {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_posts_by_thread_filtered(state, thread_id, is_admin)
    };

    public query ({ caller }) func get_post_replies(post_id: Nat) : async [T.PostResponse] {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_post_replies_filtered(state, post_id, is_admin)
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
                                        // Get voting power from SNS
                                        let voting_power = await get_caller_voting_power(caller, neuron_id, forum_response.sns_root_canister_id);
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
        Lib.retract_vote(state, caller, post_id, neuron_id)
    };

    public query func get_post_votes(post_id: Nat) : async [T.VoteResponse] {
        Lib.get_post_votes(state, post_id)
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
        Lib.get_proposals_topic(state, forum_id)
    };

    public shared ({ caller }) func create_proposal_thread(input: T.CreateProposalThreadInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_proposal_thread(state, caller, input)
    };

    public query func get_proposal_thread(proposal_id: Nat) : async ?T.ProposalThreadMappingResponse {
        Lib.get_proposal_thread(state, proposal_id)
    };

    public query func get_thread_proposal_id(thread_id: Nat) : async ?Nat {
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