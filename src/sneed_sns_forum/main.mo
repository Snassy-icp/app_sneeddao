import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Result "mo:base/Result";
import Map "mo:map/Map";
import Buffer "mo:base/Buffer";
import Dedup "mo:dedup";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Debug "mo:base/Debug";

import T "Types";
import Lib "lib";

actor SneedSNSForum {
    // Stable storage for forum state
    stable var stable_next_id : Nat = 1;
    stable var stable_forums : [(Nat, T.Forum)] = [];
    stable var stable_topics : [(Nat, T.Topic)] = [];
    stable var stable_threads : [(Nat, T.Thread)] = [];
    stable var stable_posts : [(Nat, T.Post)] = [];
    stable var stable_votes : [(T.VoteKey, T.Vote)] = [];
    stable var stable_principal_dedup : Dedup.DedupState = Dedup.empty();
    stable var stable_neuron_dedup : Dedup.DedupState = Dedup.empty();
    stable var stable_forum_topics : [(Nat, [Nat])] = [];
    stable var stable_topic_subtopics : [(Nat, [Nat])] = [];
    stable var stable_topic_threads : [(Nat, [Nat])] = [];
    stable var stable_thread_posts : [(Nat, [Nat])] = [];
    stable var stable_post_replies : [(Nat, [Nat])] = [];

    // Runtime state
    private var state : T.ForumState = Lib.init_state();

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

    // Forum API endpoints
    public shared ({ caller }) func create_forum(input: T.CreateForumInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_forum(state, caller, input)
    };

    public query func get_forum(id: Nat) : async ?T.ForumResponse {
        Lib.get_forum(state, id)
    };

    public query func get_forums() : async [T.ForumResponse] {
        Lib.get_forums(state)
    };

    // Topic API endpoints
    public shared ({ caller }) func create_topic(input: T.CreateTopicInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_topic(state, caller, input)
    };

    public query func get_topic(id: Nat) : async ?T.TopicResponse {
        Lib.get_topic(state, id)
    };

    public query func get_topics_by_forum(forum_id: Nat) : async [T.TopicResponse] {
        Lib.get_topics_by_forum(state, forum_id)
    };

    public query func get_subtopics(topic_id: Nat) : async [T.TopicResponse] {
        Lib.get_subtopics(state, topic_id)
    };

    // Thread API endpoints
    public shared ({ caller }) func create_thread(input: T.CreateThreadInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_thread(state, caller, input)
    };

    public query func get_thread(id: Nat) : async ?T.ThreadResponse {
        Lib.get_thread(state, id)
    };

    public query func get_threads_by_topic(topic_id: Nat) : async [T.ThreadResponse] {
        Lib.get_threads_by_topic(state, topic_id)
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

    public query func get_post(id: Nat) : async ?T.PostResponse {
        Lib.get_post(state, id)
    };

    public query func get_posts_by_thread(thread_id: Nat) : async [T.PostResponse] {
        Lib.get_posts_by_thread(state, thread_id)
    };

    public query func get_post_replies(post_id: Nat) : async [T.PostResponse] {
        Lib.get_post_replies(state, post_id)
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
}