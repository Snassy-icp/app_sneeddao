import Principal "mo:base/Principal";
import Map "mo:map/Map";
import Dedup "mo:dedup";
import Vector "mo:vector";
import Nat64 "mo:base/Nat64";
import Nat "mo:base/Nat";
import Time "mo:base/Time";

import T "Types";
import Lib "lib";
import PremiumClient "../PremiumClient";
import IngressGuard "../IngressGuard";

persistent actor SneedSNSForum {
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
    var stable_next_id : Nat = 1;
    let stable_forums = Map.new<Nat, T.Forum>();
    var stable_topics = Map.new<Nat, T.Topic>();
    var stable_threads = Map.new<Nat, T.Thread>();
    var stable_posts = Map.new<Nat, T.Post>();
    var stable_votes = Map.new<T.VoteKey, T.Vote>();
    let stable_tips = Map.new<Nat, T.Tip>();
    var stable_polls = Map.new<Nat, T.Poll>();
    var stable_poll_votes = Map.new<T.PollVoteKey, T.PollVote>();
    var stable_admins = Vector.new<T.AdminInfo>();
    var stable_principal_dedup : Dedup.DedupState = Dedup.empty();
    var stable_neuron_dedup : Dedup.DedupState = Dedup.empty();
    let stable_forum_topics = Map.new<Nat, Vector.Vector<Nat>>();
    let stable_topic_subtopics = Map.new<Nat, Vector.Vector<Nat>>();
    let stable_topic_threads = Map.new<Nat, Vector.Vector<Nat>>();
    let stable_thread_posts = Map.new<Nat, Vector.Vector<Nat>>();
    let stable_post_replies = Map.new<Nat, Vector.Vector<Nat>>();
    let stable_post_tips = Map.new<Nat, Vector.Vector<Nat>>();
    let stable_thread_tips = Map.new<Nat, Vector.Vector<Nat>>();
    let stable_thread_polls = Map.new<Nat, Vector.Vector<Nat>>();
    let stable_post_polls = Map.new<Nat, Vector.Vector<Nat>>();
    let stable_tips_given = Map.new<Nat32, Vector.Vector<Nat>>();
    let stable_tips_received = Map.new<Nat32, Vector.Vector<Nat>>();
    let stable_user_last_seen_tips = Map.new<Nat32, Int>();
    let stable_user_last_seen_replies = Map.new<Nat32, Int>();
    let stable_proposal_topics = Map.new<Nat, T.ProposalTopicMapping>();
    let stable_proposal_threads = Map.new<T.ProposalThreadKey, T.ProposalThreadMapping>();
    let stable_thread_proposals = Map.new<Nat, (Nat32, Nat)>();
    let stable_user_thread_reads = Map.new<Text, T.UserThreadReadData>();
    var stable_text_limits : T.TextLimits = Lib.get_default_text_limits();
    
    // Premium configuration and cache
    var stable_premium_config : T.PremiumConfig = {
        sneed_premium_canister_id = null;
        premium_post_body_max_length = 50000;      // 50k chars for premium (vs 10k default)
        premium_thread_body_max_length = 50000;    // 50k chars for premium (vs 10k default)
    };
    var stable_premium_cache = PremiumClient.emptyCache();

    // Runtime state that directly references stable storage
    private transient var state : T.ForumState = {
        var next_id = stable_next_id;
        var text_limits = stable_text_limits;
        var premium_config = stable_premium_config;
        forums = stable_forums;
        topics = stable_topics;
        threads = stable_threads;
        posts = stable_posts;
        votes = stable_votes;
        tips = stable_tips;
        polls = stable_polls;
        poll_votes = stable_poll_votes;
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
        thread_polls = stable_thread_polls;
        post_polls = stable_post_polls;
        tips_given = stable_tips_given;
        tips_received = stable_tips_received;
        user_last_seen_tips = stable_user_last_seen_tips;
        user_last_seen_replies = stable_user_last_seen_replies;
        proposal_topics = stable_proposal_topics;
        proposal_threads = stable_proposal_threads;
        thread_proposals = stable_thread_proposals;
        user_thread_reads = stable_user_thread_reads;
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

    public shared ({ caller }) func create_special_topic(input: T.CreateSpecialTopicInput) : async T.Result<Nat, T.ForumError> {
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create special topics"));
        };
        await Lib.create_special_topic(state, caller, input)
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
        // Check if user is premium and get appropriate body max length
        let body_max_override = switch (state.premium_config.sneed_premium_canister_id) {
            case null { null }; // No premium canister configured
            case (?canisterId) {
                let isPremium = await* PremiumClient.isPremium(stable_premium_cache, canisterId, caller);
                if (isPremium) {
                    ?state.premium_config.premium_thread_body_max_length
                } else {
                    null
                };
            };
        };
        Lib.create_thread(state, caller, input, body_max_override)
    };

    public shared ({ caller }) func update_thread(id: Nat, title: ?Text, body: Text) : async T.Result<(), T.ForumError> {
        // Check if user is premium and get appropriate body max length
        let body_max_override = switch (state.premium_config.sneed_premium_canister_id) {
            case null { null }; // No premium canister configured
            case (?canisterId) {
                let isPremium = await* PremiumClient.isPremium(stable_premium_cache, canisterId, caller);
                if (isPremium) {
                    ?state.premium_config.premium_thread_body_max_length
                } else {
                    null
                };
            };
        };
        Lib.update_thread(state, caller, id, title, body, body_max_override)
    };

    public query ({ caller }) func get_thread(id: Nat) : async ?T.ThreadResponse {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_thread_filtered(state, id, is_admin)
    };

    public query ({ caller }) func get_threads_by_topic(topic_id: Nat) : async [T.ThreadResponse] {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_threads_by_topic_filtered(state, topic_id, is_admin)
    };

    public query ({ caller }) func get_threads_by_activity(topic_id: Nat, start_from: ?Nat, length: Nat, reverse: Bool) : async T.GetThreadsByActivityResponse {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_threads_by_activity(state, topic_id, start_from, length, reverse, is_admin)
    };

    public query ({ caller }) func get_threads_by_activity_with_unread_counts(topic_id: Nat, start_from: ?Nat, length: Nat, reverse: Bool) : async T.GetThreadsByActivityResponse {
        let is_admin = Lib.is_admin(state, caller);
        Lib.get_threads_by_activity_with_unread_counts(state, topic_id, start_from, length, reverse, is_admin, caller)
    };

    public query ({ caller }) func get_threads_by_topic_with_unread_counts(topic_id: Nat) : async [T.ThreadResponse] {
        Lib.get_threads_by_topic_with_unread_counts(state, topic_id, caller)
    };

    public query func get_thread_context(thread_id: Nat) : async ?T.ThreadContextResponse {
        Lib.get_thread_context(state, thread_id)
    };

    // Post API endpoints
    public shared ({ caller }) func create_post(
        thread_id: Nat,
        reply_to_post_id: ?Nat,
        title: ?Text,
        body: Text
    ) : async T.Result<Nat, T.ForumError> {
        // Check if user is premium and get appropriate body max length
        let body_max_override = switch (state.premium_config.sneed_premium_canister_id) {
            case null { null }; // No premium canister configured
            case (?canisterId) {
                let isPremium = await* PremiumClient.isPremium(stable_premium_cache, canisterId, caller);
                if (isPremium) {
                    ?state.premium_config.premium_post_body_max_length
                } else {
                    null
                };
            };
        };
        let (result, updated_cache) = await Lib.create_post_with_sns(state, caller, thread_id, reply_to_post_id, title, body, sns_cache, body_max_override);
        sns_cache := updated_cache;
        result
    };

    public shared ({ caller }) func update_post(id: Nat, title: ?Text, body: Text) : async T.Result<(), T.ForumError> {
        // Check if user is premium and get appropriate body max length
        let body_max_override = switch (state.premium_config.sneed_premium_canister_id) {
            case null { null }; // No premium canister configured
            case (?canisterId) {
                let isPremium = await* PremiumClient.isPremium(stable_premium_cache, canisterId, caller);
                if (isPremium) {
                    ?state.premium_config.premium_post_body_max_length
                } else {
                    null
                };
            };
        };
        Lib.update_post(state, caller, id, title, body, body_max_override)
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

    public shared ({ caller }) func vote_on_post_with_neurons(
        post_id: Nat,
        vote_type: T.VoteType,
        neuron_ids: [T.NeuronId]
    ) : async T.Result<(), T.ForumError> {
        let (result, updated_cache) = await Lib.vote_on_post_with_specific_neurons(state, caller, post_id, vote_type, neuron_ids, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public shared ({ caller }) func retract_vote(post_id: Nat) : async T.Result<(), T.ForumError> {
        let (result, updated_cache) = await Lib.retract_vote_with_sns(state, caller, post_id, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public shared ({ caller }) func retract_vote_with_neurons(
        post_id: Nat,
        neuron_ids: [T.NeuronId]
    ) : async T.Result<(), T.ForumError> {
        let (result, updated_cache) = await Lib.retract_vote_with_specific_neurons(state, caller, post_id, neuron_ids, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public query func get_post_votes(post_id: Nat) : async [T.VoteResponse] {
        Lib.get_post_votes(state, post_id)
    };

    // Get votes for specific neurons across all posts in a thread
    public query func get_thread_votes_for_neurons(thread_id: Nat, neuron_ids: [T.NeuronId]) : async [Lib.ThreadVoteResponse] {
        Lib.get_thread_votes_for_neurons(state, thread_id, neuron_ids)
    };

    // Get votes for specific neurons on a single post
    public query func get_post_votes_for_neurons(post_id: Nat, neuron_ids: [T.NeuronId]) : async ?Lib.ThreadVoteResponse {
        Lib.get_post_votes_for_neurons(state, post_id, neuron_ids)
    };

    // Poll API endpoints
    public shared ({ caller }) func create_poll(input: T.CreatePollInput) : async T.Result<Nat, T.ForumError> {
        Lib.create_poll(state, caller, input)
    };

    public query func get_poll(id: Nat) : async ?T.PollResponse {
        Lib.get_poll(state, id)
    };

    public query func get_polls_by_thread(thread_id: Nat) : async [T.PollResponse] {
        Lib.get_polls_by_thread(state, thread_id)
    };

    public query func get_polls_by_post(post_id: Nat) : async [T.PollResponse] {
        Lib.get_polls_by_post(state, post_id)
    };

    public shared ({ caller }) func vote_on_poll_with_neurons(
        poll_id: Nat,
        option_id: Nat,
        neuron_ids: [T.NeuronId]
    ) : async T.Result<(), T.ForumError> {
        let (result, updated_cache) = await Lib.vote_on_poll_with_specific_neurons(state, caller, poll_id, option_id, neuron_ids, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public query func get_poll_votes(poll_id: Nat) : async [T.PollVoteResponse] {
        Lib.get_poll_votes(state, poll_id)
    };

    // Tip API endpoints
    public shared ({ caller }) func create_tip(
        to_principal: Principal,
        post_id: Nat,
        token_ledger_principal: Principal,
        amount: Nat,
        transaction_block_index: ?Nat
    ) : async T.Result<Nat, T.ForumError> {
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create tips"));
        };
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

    // Efficient method for wallet integration - returns only token summaries
    public query func get_tip_tokens_received_by_user(user_principal: Principal) : async [T.TipTokenSummary] {
        Lib.get_tip_tokens_received_by_user(state, user_principal)
    };

    // Tip notification methods
    public query func get_recent_tips_received(user_principal: Principal) : async [T.TipResponse] {
        Lib.get_recent_tips_received(state, user_principal)
    };

    public query func get_recent_tips_count(user_principal: Principal) : async Nat {
        Lib.get_recent_tips_count(state, user_principal)
    };

    public query func get_recent_replies_count(user_principal: Principal) : async Nat {
        Lib.get_recent_replies_count(state, user_principal)
    };

    public query func get_tips_received_since(user_principal: Principal, since_timestamp: Int) : async [T.TipResponse] {
        Lib.get_tips_received_since(state, user_principal, since_timestamp)
    };

    public shared ({ caller }) func mark_tips_seen_up_to(timestamp: Int) : async () {
        Lib.mark_tips_seen_up_to(state, caller, timestamp)
    };

    public query func get_last_seen_tip_timestamp(user_principal: Principal) : async ?Int {
        Lib.get_last_seen_tip_timestamp(state, user_principal)
    };

    public shared ({ caller }) func mark_replies_seen_up_to(timestamp: Int) : async () {
        Lib.mark_replies_seen_up_to(state, caller, timestamp)
    };

    public query func get_last_seen_replies_timestamp(user_principal: Principal) : async ?Int {
        Lib.get_last_seen_replies_timestamp(state, user_principal)
    };

    public query func get_tip_stats() : async T.TipStats {
        Lib.get_tip_stats(state)
    };

    // Post query endpoints by user
    public query func get_posts_by_user(user_principal: Principal) : async [T.PostResponse] {
        Lib.get_posts_by_user(state, user_principal)
    };

    public query func get_replies_to_user(user_principal: Principal) : async [T.PostResponse] {
        Lib.get_replies_to_user(state, user_principal)
    };

    public query func get_threads_by_user(user_principal: Principal) : async [T.ThreadResponse] {
        Lib.get_threads_by_user(state, user_principal)
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
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create proposal threads"));
        };
        Lib.create_proposal_thread(state, caller, input)
    };

    public shared ({ caller }) func create_proposal_thread_with_auto_setup(input: T.CreateProposalThreadInput) : async T.Result<Nat, T.ForumError> {
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create proposal threads"));
        };
        let (result, updated_cache) = await Lib.create_proposal_thread_with_auto_setup(state, caller, input, sns_cache);
        sns_cache := updated_cache;
        result
    };

    // Create forum with governance and proposals topics for an SNS
    public shared ({ caller }) func create_sns_forum_setup(sns_root_canister_id: Principal) : async T.Result<Nat, T.ForumError> {
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create an SNS forum setup"));
        };
        let current_time = Time.now();
        let (result, updated_cache) = await Lib.ensure_sns_proposal_structure(state, caller, sns_root_canister_id, sns_cache, current_time);
        sns_cache := updated_cache;
        switch (result) {
            case (#ok(proposals_topic_id)) #ok(proposals_topic_id);
            case (#err(error)) #err(error);
        }
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

    // Feed endpoint
    public query func get_feed(input: T.GetFeedInput) : async T.GetFeedResponse {
        Lib.get_feed(state, input)
    };

    // Get current counter ID (for checking if new items are available)
    public query func get_current_counter() : async Nat {
        Lib.get_current_counter(state)
    };

    // Text limits management endpoints
    public query func get_text_limits() : async T.TextLimits {
        Lib.get_text_limits(state)
    };

    public shared ({ caller }) func update_text_limits(input: T.UpdateTextLimitsInput) : async T.Result<(), T.ForumError> {
        Lib.update_text_limits(state, caller, input)
    };
    
    // Premium configuration management endpoints
    public query func get_premium_config() : async T.PremiumConfig {
        state.premium_config
    };
    
    public shared ({ caller }) func update_premium_config(input: T.UpdatePremiumConfigInput) : async T.Result<(), T.ForumError> {
        // Check if caller is admin
        if (not Lib.is_admin(state, caller)) {
            return #err(#Unauthorized("Admin access required"));
        };
        
        // Update config fields
        state.premium_config := {
            sneed_premium_canister_id = switch (input.sneed_premium_canister_id) {
                case (?maybeId) { maybeId };
                case null { state.premium_config.sneed_premium_canister_id };
            };
            premium_post_body_max_length = switch (input.premium_post_body_max_length) {
                case (?len) { len };
                case null { state.premium_config.premium_post_body_max_length };
            };
            premium_thread_body_max_length = switch (input.premium_thread_body_max_length) {
                case (?len) { len };
                case null { state.premium_config.premium_thread_body_max_length };
            };
        };
        
        // Sync to stable storage
        stable_premium_config := state.premium_config;
        
        #ok(())
    };
    
    // Helper to check if a user is a Sneed Premium member
    public func check_user_premium_status(user: Principal) : async Bool {
        switch (state.premium_config.sneed_premium_canister_id) {
            case null { false }; // No premium canister configured
            case (?canisterId) {
                await* PremiumClient.isPremium(stable_premium_cache, canisterId, user);
            };
        };
    };

    // Read tracking endpoints
    public shared ({ caller }) func set_last_read_post(request: T.SetLastReadPostRequest) : async T.SetLastReadPostResponse {
        Lib.set_last_read_post(state, caller, request.thread_id, request.last_read_post_id)
    };

    public query ({ caller }) func get_last_read_post(request: T.GetLastReadPostRequest) : async T.GetLastReadPostResponse {
        Lib.get_last_read_post(state, caller, request.thread_id)
    };

    public query ({ caller }) func get_user_thread_reads_for_topic(topic_id: Nat) : async [(Nat, Nat)] {
        Lib.get_user_thread_reads_for_topic(state, caller, topic_id)
    };

    public query ({ caller }) func get_topic_statistics(topic_id: Nat) : async T.TopicStatistics {
        Lib.get_topic_statistics(state, caller, topic_id)
    };

    // System upgrade hooks to maintain stable storage consistency
    system func preupgrade() {
        stable_next_id := state.next_id;
        stable_text_limits := state.text_limits;
    };

    system func postupgrade() {
        // State is already initialized with stable values.
        // Put right the poll counts of builds before f9df91bf (first votes went uncounted).
        ignore Lib.recount_poll_votes(state);
    };

    // Limits of the ingress guard below
    transient let MAX_POLL_OPTIONS : Nat = 100;
    transient let MAX_NEURONS : Nat = 1_000;
    transient let NEURONS_ARG : Nat = 64 * 1024;

    // the longest body anyone may post: the premium limit when premium is on
    private func longestBody(normal : Nat, premium : Nat) : Nat {
        switch (state.premium_config.sneed_premium_canister_id) {
            case null normal;
            case (?_) Nat.max(normal, premium);
        }
    };
    private func postChars(premium : Bool) : Nat {
        let l = state.text_limits;
        l.post_title_max_length + (if premium longestBody(l.post_body_max_length, state.premium_config.premium_post_body_max_length) else l.post_body_max_length)
    };
    private func forumOk(arg : Blob, title : Text, description : Text) : Bool {
        let l = state.text_limits;
        arg.size() <= IngressGuard.textArg(l.forum_title_max_length + l.forum_description_max_length)
        and IngressGuard.text(title, l.forum_title_max_length) and IngressGuard.text(description, l.forum_description_max_length)
    };
    private func topicOk(arg : Blob, title : Text, description : Text) : Bool {
        let l = state.text_limits;
        arg.size() <= IngressGuard.textArg(l.topic_title_max_length + l.topic_description_max_length)
        and IngressGuard.text(title, l.topic_title_max_length) and IngressGuard.text(description, l.topic_description_max_length)
    };
    private func threadOk(arg : Blob, title : ?Text, body : Text) : Bool {
        let l = state.text_limits;
        let maxBody = longestBody(l.thread_body_max_length, state.premium_config.premium_thread_body_max_length);
        arg.size() <= IngressGuard.textArg(l.thread_title_max_length + maxBody)
        and IngressGuard.optText(title, l.thread_title_max_length) and IngressGuard.text(body, maxBody)
    };
    private func postOk(arg : Blob, title : ?Text, body : Text, premium : Bool) : Bool {
        let l = state.text_limits;
        let maxBody = if premium longestBody(l.post_body_max_length, state.premium_config.premium_post_body_max_length) else l.post_body_max_length;
        arg.size() <= IngressGuard.textArg(postChars(premium))
        and IngressGuard.optText(title, l.post_title_max_length) and IngressGuard.text(body, maxBody)
    };

    // Ingress guard (src/IngressGuard.mo): queries are never accepted as update calls, which
    // would go through consensus at our cost, and arguments are capped in size.
    system func inspect({ arg : Blob; msg : {
        #add_admin : Any;
        #check_user_premium_status : Any;
        #create_forum : () -> T.CreateForumInput;
        #create_poll : () -> T.CreatePollInput;
        #create_post : () -> (Nat, ?Nat, ?Text, Text);
        #create_proposal_thread : Any;
        #create_proposal_thread_with_auto_setup : Any;
        #create_sns_forum_setup : Any;
        #create_special_topic : Any;
        #create_thread : () -> T.CreateThreadInput;
        #create_tip : Any;
        #create_topic : () -> T.CreateTopicInput;
        #delete_forum : Any;
        #delete_post : Any;
        #delete_thread : Any;
        #delete_topic : Any;
        #get_admins : Any;
        #get_current_counter : Any;
        #get_feed : Any;
        #get_forum : Any;
        #get_forum_admin : Any;
        #get_forum_by_sns_root : Any;
        #get_forums : Any;
        #get_forums_admin : Any;
        #get_last_read_post : Any;
        #get_last_seen_replies_timestamp : Any;
        #get_last_seen_tip_timestamp : Any;
        #get_poll : Any;
        #get_poll_votes : Any;
        #get_polls_by_post : Any;
        #get_polls_by_thread : Any;
        #get_post : Any;
        #get_post_admin : Any;
        #get_post_replies : Any;
        #get_post_replies_admin : Any;
        #get_post_votes : Any;
        #get_post_votes_for_neurons : Any;
        #get_posts_by_thread : Any;
        #get_posts_by_thread_admin : Any;
        #get_posts_by_user : Any;
        #get_premium_config : Any;
        #get_proposal_thread : Any;
        #get_proposals_topic : Any;
        #get_proposals_topic_by_sns_root : Any;
        #get_recent_replies_count : Any;
        #get_recent_tips_count : Any;
        #get_recent_tips_received : Any;
        #get_replies_to_user : Any;
        #get_stats : Any;
        #get_subtopics : Any;
        #get_text_limits : Any;
        #get_thread : Any;
        #get_thread_admin : Any;
        #get_thread_context : Any;
        #get_thread_proposal_id : Any;
        #get_thread_votes_for_neurons : Any;
        #get_threads_by_activity : Any;
        #get_threads_by_activity_with_unread_counts : Any;
        #get_threads_by_topic : Any;
        #get_threads_by_topic_admin : Any;
        #get_threads_by_topic_with_unread_counts : Any;
        #get_threads_by_user : Any;
        #get_tip : Any;
        #get_tip_stats : Any;
        #get_tip_tokens_received_by_user : Any;
        #get_tips_by_post : Any;
        #get_tips_by_thread : Any;
        #get_tips_given_by_user : Any;
        #get_tips_received_by_user : Any;
        #get_tips_received_since : Any;
        #get_topic : Any;
        #get_topic_admin : Any;
        #get_topic_statistics : Any;
        #get_topics_by_forum : Any;
        #get_topics_by_forum_admin : Any;
        #get_user_thread_reads_for_topic : Any;
        #health_check : Any;
        #is_admin : Any;
        #mark_replies_seen_up_to : Any;
        #mark_tips_seen_up_to : Any;
        #remove_admin : Any;
        #remove_proposals_topic : Any;
        #retract_vote : Any;
        #retract_vote_with_neurons : () -> (Nat, [T.NeuronId]);
        #set_last_read_post : Any;
        #set_proposals_topic : Any;
        #undelete_forum : Any;
        #undelete_post : Any;
        #undelete_thread : Any;
        #undelete_topic : Any;
        #update_forum : () -> (Nat, T.CreateForumInput);
        #update_post : () -> (Nat, ?Text, Text);
        #update_premium_config : Any;
        #update_text_limits : Any;
        #update_thread : () -> (Nat, ?Text, Text);
        #update_topic : () -> (Nat, T.CreateTopicInput);
        #vote_on_poll_with_neurons : () -> (Nat, Nat, [T.NeuronId]);
        #vote_on_post : Any;
        #vote_on_post_with_neurons : () -> (Nat, T.VoteType, [T.NeuronId]);
    } }) : Bool {
        switch (msg) {
            case (
                #get_admins _
                or #get_current_counter _
                or #get_feed _
                or #get_forum _
                or #get_forum_admin _
                or #get_forum_by_sns_root _
                or #get_forums _
                or #get_forums_admin _
                or #get_last_read_post _
                or #get_last_seen_replies_timestamp _
                or #get_last_seen_tip_timestamp _
                or #get_poll _
                or #get_poll_votes _
                or #get_polls_by_post _
                or #get_polls_by_thread _
                or #get_post _
                or #get_post_admin _
                or #get_post_replies _
                or #get_post_replies_admin _
                or #get_post_votes _
                or #get_post_votes_for_neurons _
                or #get_posts_by_thread _
                or #get_posts_by_thread_admin _
                or #get_posts_by_user _
                or #get_premium_config _
                or #get_proposal_thread _
                or #get_proposals_topic _
                or #get_proposals_topic_by_sns_root _
                or #get_recent_replies_count _
                or #get_recent_tips_count _
                or #get_recent_tips_received _
                or #get_replies_to_user _
                or #get_stats _
                or #get_subtopics _
                or #get_text_limits _
                or #get_thread _
                or #get_thread_admin _
                or #get_thread_context _
                or #get_thread_proposal_id _
                or #get_thread_votes_for_neurons _
                or #get_threads_by_activity _
                or #get_threads_by_activity_with_unread_counts _
                or #get_threads_by_topic _
                or #get_threads_by_topic_admin _
                or #get_threads_by_topic_with_unread_counts _
                or #get_threads_by_user _
                or #get_tip _
                or #get_tip_stats _
                or #get_tip_tokens_received_by_user _
                or #get_tips_by_post _
                or #get_tips_by_thread _
                or #get_tips_given_by_user _
                or #get_tips_received_by_user _
                or #get_tips_received_since _
                or #get_topic _
                or #get_topic_admin _
                or #get_topic_statistics _
                or #get_topics_by_forum _
                or #get_topics_by_forum_admin _
                or #get_user_thread_reads_for_topic _
                or #health_check _
                or #is_admin _
            ) false;
            // texts against the forum's text limits; a body may be as long as the premium limit, the
            // method itself decides whether the caller is premium
            case (#create_forum f) { let i = f(); forumOk(arg, i.title, i.description) };
            case (#update_forum f) { let (_, i) = f(); forumOk(arg, i.title, i.description) };
            case (#create_topic f) { let i = f(); topicOk(arg, i.title, i.description) };
            case (#update_topic f) { let (_, i) = f(); topicOk(arg, i.title, i.description) };
            case (#create_thread f) { let i = f(); threadOk(arg, i.title, i.body) };
            case (#update_thread f) { let (_, title, body) = f(); threadOk(arg, title, body) };
            case (#create_post f) { let (_, _, title, body) = f(); postOk(arg, title, body, true) };
            case (#update_post f) { let (_, title, body) = f(); postOk(arg, title, body, true) };
            case (#create_poll f) {
                let i = f();
                i.options.size() <= MAX_POLL_OPTIONS and arg.size() <= IngressGuard.textArg((i.options.size() + 1) * postChars(false))
                and postOk(arg, ?i.title, i.body, false)
                and IngressGuard.all<T.CreatePollOptionInput>(i.options, MAX_POLL_OPTIONS, func(o) = IngressGuard.text(o.title, state.text_limits.post_title_max_length) and IngressGuard.optText(o.body, state.text_limits.post_body_max_length))
            };
            case (#vote_on_post_with_neurons f) arg.size() <= NEURONS_ARG and f().2.size() <= MAX_NEURONS;
            case (#retract_vote_with_neurons f) arg.size() <= NEURONS_ARG and f().1.size() <= MAX_NEURONS;
            case (#vote_on_poll_with_neurons f) arg.size() <= NEURONS_ARG and f().2.size() <= MAX_NEURONS;
            case _ arg.size() <= IngressGuard.SMALL_ARG;
        };
    };

}