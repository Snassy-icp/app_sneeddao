import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Map "mo:map/Map";
import Dedup "mo:dedup";
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Nat32 "mo:base/Nat32";
import Vector "mo:vector";

module {
    // Basic types from SNS governance
    public type NeuronId = {
        id: Blob;
    };

    // Vote type enum
    public type VoteType = {
        #upvote;
        #downvote;
    };

    // Admin management types
    public type AdminInfo = {
        principal: Principal;
        added_by: Principal;
        added_at: Int;
    };

    // Core data structures
    public type Forum = {
        id: Nat;
        title: Text;
        description: Text;
        sns_root_canister_id: ?Principal;
        created_by: Nat32;
        created_at: Int;
        updated_by: Nat32;
        updated_at: Int;
        deleted: Bool;
    };

    public type Topic = {
        id: Nat;
        forum_id: Nat;
        parent_topic_id: ?Nat;
        title: Text;
        description: Text;
        created_by: Nat32;
        created_at: Int;
        updated_by: Nat32;
        updated_at: Int;
        deleted: Bool;
    };

    public type Thread = {
        id: Nat;
        topic_id: Nat;
        title: ?Text;
        body: Text;
        created_by: Nat32;
        created_at: Int;
        updated_by: Nat32;
        updated_at: Int;
        deleted: Bool;
    };

    public type Post = {
        id: Nat;
        thread_id: Nat;
        reply_to_post_id: ?Nat;
        title: ?Text;
        body: Text;
        upvote_score: Nat;
        downvote_score: Nat;
        created_by: Nat32;
        created_at: Int;
        updated_by: Nat32;
        updated_at: Int;
        deleted: Bool;
    };

    public type Vote = {
        post_id: Nat;
        neuron_id: Nat32;
        voter_principal: Nat32;
        vote_type: VoteType;
        voting_power: Nat;
        created_at: Int;
        updated_at: Int;
    };

    // Composite key type for votes (post_id, neuron_id)
    public type VoteKey = (Nat, Nat32);

    // State type for the forum system
    public type ForumState = {
        // Global ID counter
        var next_id: Nat;
        
        // Core data storage
        forums: Map.Map<Nat, Forum>;
        topics: Map.Map<Nat, Topic>;
        threads: Map.Map<Nat, Thread>;
        posts: Map.Map<Nat, Post>;
        votes: Map.Map<VoteKey, Vote>;
        
        // Admin management
        admins: Vector.Vector<AdminInfo>;
        
        // Deduplication states
        var principal_dedup_state: Dedup.DedupState;
        var neuron_dedup_state: Dedup.DedupState;
        
        // Indexes for efficient queries (using Vector for stable compatibility)
        forum_topics: Map.Map<Nat, Vector.Vector<Nat>>;
        topic_subtopics: Map.Map<Nat, Vector.Vector<Nat>>;
        topic_threads: Map.Map<Nat, Vector.Vector<Nat>>;
        thread_posts: Map.Map<Nat, Vector.Vector<Nat>>;
        post_replies: Map.Map<Nat, Vector.Vector<Nat>>;
    };

    // Input types for creation functions
    public type CreateForumInput = {
        title: Text;
        description: Text;
        sns_root_canister_id: ?Principal;
    };

    public type CreateTopicInput = {
        forum_id: Nat;
        parent_topic_id: ?Nat;
        title: Text;
        description: Text;
    };

    public type CreateThreadInput = {
        topic_id: Nat;
        title: ?Text;
        body: Text;
    };

    public type CreatePostInput = {
        thread_id: Nat;
        reply_to_post_id: ?Nat;
        title: ?Text;
        body: Text;
    };

    public type VoteInput = {
        post_id: Nat;
        neuron_id: NeuronId;
        vote_type: VoteType;
    };

    // Response types with resolved data
    public type ForumResponse = {
        id: Nat;
        title: Text;
        description: Text;
        sns_root_canister_id: ?Principal;
        created_by: Principal;
        created_at: Int;
        updated_by: Principal;
        updated_at: Int;
        deleted: Bool;
    };

    public type TopicResponse = {
        id: Nat;
        forum_id: Nat;
        parent_topic_id: ?Nat;
        title: Text;
        description: Text;
        created_by: Principal;
        created_at: Int;
        updated_by: Principal;
        updated_at: Int;
        deleted: Bool;
    };

    public type ThreadResponse = {
        id: Nat;
        topic_id: Nat;
        title: ?Text;
        body: Text;
        created_by: Principal;
        created_at: Int;
        updated_by: Principal;
        updated_at: Int;
        deleted: Bool;
    };

    public type PostResponse = {
        id: Nat;
        thread_id: Nat;
        reply_to_post_id: ?Nat;
        title: ?Text;
        body: Text;
        upvote_score: Nat;
        downvote_score: Nat;
        created_by: Principal;
        created_at: Int;
        updated_by: Principal;
        updated_at: Int;
        deleted: Bool;
    };

    public type VoteResponse = {
        post_id: Nat;
        neuron_id: NeuronId;
        voter_principal: Principal;
        vote_type: VoteType;
        voting_power: Nat;
        created_at: Int;
        updated_at: Int;
    };

    // Statistics type for admin endpoints
    public type ForumStats = {
        total_forums: Nat;
        total_topics: Nat;
        total_threads: Nat;
        total_posts: Nat;
        total_votes: Nat;
    };

    // SNS Governance integration types
    public type SNSNeuron = {
        id: ?NeuronId;
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

    public type ListNeuronsResponse = {
        neurons: [SNSNeuron];
    };

    // Error types
    public type ForumError = {
        #NotFound: Text;
        #Unauthorized: Text;
        #InvalidInput: Text;
        #AlreadyExists: Text;
        #InternalError: Text;
    };

    // Result type alias
    public type Result<T, E> = {
        #ok: T;
        #err: E;
    };

    // Constants
    public func sneed_dao_root_canister_id() : Principal {
        Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai")
    };

    // Helper functions for deduplication
    public func principal_equal(a: Principal, b: Principal) : Bool {
        Principal.equal(a, b)
    };

    public func principal_hash(p: Principal) : Nat32 {
        Principal.hash(p)
    };

    public func neuron_id_equal(a: NeuronId, b: NeuronId) : Bool {
        Blob.equal(a.id, b.id)
    };

    public func neuron_id_hash(n: NeuronId) : Nat32 {
        Blob.hash(n.id)
    };

    // Helper function for vote key comparison
    public func vote_key_equal(a: VoteKey, b: VoteKey) : Bool {
        a.0 == b.0 and a.1 == b.1
    };

    public func vote_key_hash(key: VoteKey) : Nat32 {
        let h1 : Nat32 = switch (key.0 % (2**32 - 1)) {
            case (n) { Nat32.fromNat(n) };
        };
        let h2 = key.1;
        h1 ^ h2
    };
}
