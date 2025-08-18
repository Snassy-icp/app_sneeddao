import Principal "mo:base/Principal";
import Map "mo:map/Map";
import Dedup "mo:dedup";
import Vector "mo:vector";
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



    // Non-stable cache for SNS instances (will be refreshed on canister upgrade)
    private transient var sns_cache : SnsCache = {
        instances = [];
        last_updated = 0;
    };

    // Stable storage using stable Map and Vector structures
    stable var stable_next_id : Nat = 1;
    stable let stable_forums = Map.new<Nat, T.Forum>();
    stable let stable_topics = Map.new<Nat, T.Topic>();
    stable let stable_threads = Map.new<Nat, T.Thread>();
    stable let stable_posts = Map.new<Nat, T.Post>();
    stable let stable_votes = Map.new<T.VoteKey, T.Vote>();
    stable let stable_tips = Map.new<Nat, T.Tip>();
    stable let stable_admins = Vector.new<T.AdminInfo>();
    stable var stable_principal_dedup : Dedup.DedupState = Dedup.empty();
    stable var stable_neuron_dedup : Dedup.DedupState = Dedup.empty();
    stable let stable_forum_topics = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_topic_subtopics = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_topic_threads = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_thread_posts = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_post_replies = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_post_tips = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_thread_tips = Map.new<Nat, Vector.Vector<Nat>>();
    stable let stable_tips_given = Map.new<Nat32, Vector.Vector<Nat>>();
    stable let stable_tips_received = Map.new<Nat32, Vector.Vector<Nat>>();
    stable let stable_proposal_topics = Map.new<Nat, T.ProposalTopicMapping>();
    stable let stable_proposal_threads = Map.new<T.ProposalThreadKey, T.ProposalThreadMapping>();
    stable let stable_thread_proposals = Map.new<Nat, (Nat32, Nat)>();
    stable var stable_text_limits : T.TextLimits = Lib.get_default_text_limits();

    // Runtime state that directly references stable storage
    private transient var state : T.ForumState = {
        var next_id = stable_next_id;
        var text_limits = stable_text_limits;
        forums = stable_forums;
        topics = stable_topics;
        threads = stable_threads;
        posts = stable_posts;
        votes = stable_votes;
        tips = stable_tips;
        admins = stable_admins;
        principal_dedup_state = stable_principal_dedup;
        neuron_dedup_state = stable_neuron_dedup;
        forum_topics = stable_forum_topics;
        topic_subtopics = stable_topic_subtopics;
        topic_threads = stable_topic_threads;
        thread_posts = stable_thread_posts;
        post_replies = stable_post_replies;
        post_tips = stable_post_tips;
        thread_tips = stable_thread_tips;
        tips_given = stable_tips_given;
        tips_received = stable_tips_received;
        proposal_topics = stable_proposal_topics;
        proposal_threads = stable_proposal_threads;
        thread_proposals = stable_thread_proposals;
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

    public query func get_forum_by_sns_root(sns_root_canister_id: Principal) : async ?T.ForumResponse {
        Lib.get_forum_by_sns_root(state, sns_root_canister_id)
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
    public shared ({ caller }) func create_post(
        thread_id: Nat,
        reply_to_post_id: ?Nat,
        title: ?Text,
        body: Text
    ) : async T.Result<Nat, T.ForumError> {
        let (result, updated_cache) = await Lib.create_post_with_sns(state, caller, thread_id, reply_to_post_id, title, body, sns_cache);
        sns_cache := updated_cache;
        result
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
        vote_type: T.VoteType
    ) : async T.Result<(), T.ForumError> {
        let (result, updated_cache) = await Lib.vote_on_post_with_sns(state, caller, post_id, vote_type, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public shared ({ caller }) func retract_vote(post_id: Nat) : async T.Result<(), T.ForumError> {
        let (result, updated_cache) = await Lib.retract_vote_with_sns(state, caller, post_id, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public query func get_post_votes(post_id: Nat) : async [T.VoteResponse] {
        Lib.get_post_votes(state, post_id)
    };

    // Tip API endpoints
    public shared ({ caller }) func create_tip(
        to_principal: Principal,
        post_id: Nat,
        token_ledger_principal: Principal,
        amount: Nat,
        transaction_block_index: ?Nat
    ) : async T.Result<Nat, T.ForumError> {
        let input : T.CreateTipInput = {
            to_principal;
            post_id;
            token_ledger_principal;
            amount;
            transaction_block_index;
        };
        Lib.create_tip(state, caller, input)
    };

    public query func get_tip(id: Nat) : async ?T.TipResponse {
        Lib.get_tip(state, id)
    };

    public query func get_tips_by_post(post_id: Nat) : async [T.TipResponse] {
        Lib.get_tips_by_post(state, post_id)
    };

    public query func get_tips_by_thread(thread_id: Nat) : async [T.TipResponse] {
        Lib.get_tips_by_thread(state, thread_id)
    };

    public query func get_tips_given_by_user(user_principal: Principal) : async [T.TipResponse] {
        Lib.get_tips_given_by_user(state, user_principal)
    };

    public query func get_tips_received_by_user(user_principal: Principal) : async [T.TipResponse] {
        Lib.get_tips_received_by_user(state, user_principal)
    };

    public query func get_tip_stats() : async T.TipStats {
        Lib.get_tip_stats(state)
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

    // Admin undelete endpoints
    public shared ({ caller }) func undelete_forum(id: Nat) : async T.Result<(), T.ForumError> {
        Lib.undelete_forum(state, caller, id)
    };

    public shared ({ caller }) func undelete_topic(id: Nat) : async T.Result<(), T.ForumError> {
        Lib.undelete_topic(state, caller, id)
    };

    public shared ({ caller }) func undelete_thread(id: Nat) : async T.Result<(), T.ForumError> {
        Lib.undelete_thread(state, caller, id)
    };

    public shared ({ caller }) func undelete_post(id: Nat) : async T.Result<(), T.ForumError> {
        Lib.undelete_post(state, caller, id)
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

    public query func get_proposals_topic_by_sns_root(sns_root_canister_id: Principal) : async ?T.ProposalTopicMappingResponse {
        Lib.get_proposals_topic_by_sns_root(state, sns_root_canister_id)
    };

    public shared ({ caller }) func create_proposal_thread(input: T.CreateProposalThreadInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_proposal_thread(state, caller, input)
    };

    public shared ({ caller }) func create_proposal_thread_with_auto_setup(input: T.CreateProposalThreadInput) : async T.Result<Nat, T.ForumError> {
        let (result, updated_cache) = await Lib.create_proposal_thread_with_auto_setup(state, caller, input, sns_cache);
        sns_cache := updated_cache;
        result
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

    // Text limits management endpoints
    public query func get_text_limits() : async T.TextLimits {
        Lib.get_text_limits(state)
    };

    public shared ({ caller }) func update_text_limits(input: T.UpdateTextLimitsInput) : async T.Result<(), T.ForumError> {
        Lib.update_text_limits(state, caller, input)
    };

    // System upgrade hooks to maintain stable storage consistency
    system func preupgrade() {
        stable_next_id := state.next_id;
        stable_text_limits := state.text_limits;
    };

    system func postupgrade() {
        // State is already initialized with stable values
        // This ensures any post-upgrade initialization if needed
    };
}