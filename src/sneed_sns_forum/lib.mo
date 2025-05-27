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

    // Hash utilities for VoteKey
    private let vote_key_hash_utils = (T.vote_key_hash, T.vote_key_equal);

    // Initialize forum state
    public func init_state() : ForumState {
        {
            var next_id = 1;
            forums = Map.new<Nat, Forum>();
            topics = Map.new<Nat, Topic>();
            threads = Map.new<Nat, Thread>();
            posts = Map.new<Nat, Post>();
            votes = Map.new<VoteKey, Vote>();
            admins = Vector.new<AdminInfo>();
            var principal_dedup_state = Dedup.empty();
            var neuron_dedup_state = Dedup.empty();
            forum_topics = Map.new<Nat, Buffer.Buffer<Nat>>();
            topic_subtopics = Map.new<Nat, Buffer.Buffer<Nat>>();
            topic_threads = Map.new<Nat, Buffer.Buffer<Nat>>();
            thread_posts = Map.new<Nat, Buffer.Buffer<Nat>>();
            post_replies = Map.new<Nat, Buffer.Buffer<Nat>>();
        }
    };

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
            added_by = caller;
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
    private func add_to_index(map: Map.Map<Nat, Buffer.Buffer<Nat>>, key: Nat, value: Nat) {
        switch (Map.get(map, Map.nhash, key)) {
            case (?buffer) {
                buffer.add(value);
            };
            case null {
                let buffer = Buffer.Buffer<Nat>(1);
                buffer.add(value);
                ignore Map.put(map, Map.nhash, key, buffer);
            };
        };
    };

    // Helper function to remove from index
    private func remove_from_index(map: Map.Map<Nat, Buffer.Buffer<Nat>>, key: Nat, value: Nat) {
        switch (Map.get(map, Map.nhash, key)) {
            case (?buffer) {
                let filtered = Buffer.Buffer<Nat>(buffer.size());
                for (item in buffer.vals()) {
                    if (item != value) {
                        filtered.add(item);
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
                for (topic_id in topic_ids.vals()) {
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
                for (subtopic_id in subtopic_ids.vals()) {
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
                for (subtopic_id in subtopic_ids.vals()) {
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
                for (thread_id in thread_ids.vals()) {
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
        input: T.CreatePostInput,
        initial_voting_power: Nat
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

        // Check if thread exists
        switch (Map.get(state.threads, Map.nhash, input.thread_id)) {
            case null return #err(#NotFound("Thread not found"));
            case (?_) {};
        };

        // Check if reply_to_post exists and belongs to the same thread
        switch (input.reply_to_post_id) {
            case (?reply_id) {
                switch (Map.get(state.posts, Map.nhash, reply_id)) {
                    case null return #err(#NotFound("Reply target post not found"));
                    case (?reply_post) {
                        if (reply_post.thread_id != input.thread_id) {
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
            thread_id = input.thread_id;
            reply_to_post_id = input.reply_to_post_id;
            title = input.title;
            body = input.body;
            upvote_score = initial_voting_power;
            downvote_score = 0;
            created_by = caller_index;
            created_at = now;
            updated_by = caller_index;
            updated_at = now;
            deleted = false;
        };

        ignore Map.put(state.posts, Map.nhash, id, post);
        add_to_index(state.thread_posts, input.thread_id, id);
        
        switch (input.reply_to_post_id) {
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
                for (post_id in post_ids.vals()) {
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
                for (reply_id in reply_ids.vals()) {
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
    public func vote_on_post(
        state: ForumState,
        caller: Principal,
        post_id: Nat,
        neuron_id: NeuronId,
        vote_type: VoteType,
        voting_power: Nat
    ) : Result<(), ForumError> {
        // Check if post exists
        let post = switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?p) p;
            case null return #err(#NotFound("Post not found"));
        };

        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let neuron_index = Dedup.getOrCreateIndex(state.neuron_dedup_state, Principal.toBlob(Principal.fromText("neuron:" # debug_show(neuron_id))));
        
        let vote_key : VoteKey = (post_id, neuron_index);
        let now = Time.now();

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
                    updated_at = now;
                };

                // Update post scores
                let updated_post = switch (existing_vote.vote_type, vote_type) {
                    case (#upvote, #upvote) {
                        // Same vote type, just update voting power
                        {
                            post with
                            upvote_score = post.upvote_score - existing_vote.voting_power + voting_power;
                            updated_at = now;
                        }
                    };
                    case (#downvote, #downvote) {
                        // Same vote type, just update voting power
                        {
                            post with
                            downvote_score = post.downvote_score - existing_vote.voting_power + voting_power;
                            updated_at = now;
                        }
                    };
                    case (#upvote, #downvote) {
                        // Changed from upvote to downvote
                        {
                            post with
                            upvote_score = post.upvote_score - existing_vote.voting_power;
                            downvote_score = post.downvote_score + voting_power;
                            updated_at = now;
                        }
                    };
                    case (#downvote, #upvote) {
                        // Changed from downvote to upvote
                        {
                            post with
                            downvote_score = post.downvote_score - existing_vote.voting_power;
                            upvote_score = post.upvote_score + voting_power;
                            updated_at = now;
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
                    created_at = now;
                    updated_at = now;
                };

                let updated_post = switch (vote_type) {
                    case (#upvote) {
                        {
                            post with
                            upvote_score = post.upvote_score + voting_power;
                            updated_at = now;
                        }
                    };
                    case (#downvote) {
                        {
                            post with
                            downvote_score = post.downvote_score + voting_power;
                            updated_at = now;
                        }
                    };
                };

                ignore Map.put(state.votes, vote_key_hash_utils, vote_key, new_vote);
                ignore Map.put(state.posts, Map.nhash, post_id, updated_post);
            };
        };

        #ok()
    };

    public func retract_vote(
        state: ForumState,
        caller: Principal,
        post_id: Nat,
        neuron_id: NeuronId
    ) : Result<(), ForumError> {
        // Check if post exists
        let post = switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?p) p;
            case null return #err(#NotFound("Post not found"));
        };

        let neuron_index = Dedup.getOrCreateIndex(state.neuron_dedup_state, Principal.toBlob(Principal.fromText("neuron:" # debug_show(neuron_id))));
        
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
                for (topic_id in topic_ids.vals()) {
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
                for (thread_id in thread_ids.vals()) {
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
                for (post_id in post_ids.vals()) {
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
                for (reply_id in reply_ids.vals()) {
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
}
