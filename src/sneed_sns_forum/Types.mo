import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Map "mo:map/Map";
import Dedup "mo:dedup";
import _Array "mo:base/Array";
import _Buffer "mo:base/Buffer";
import Nat32 "mo:base/Nat32";
import Vector "mo:vector";

module {
    // SNS cache types
    public type DeployedSns = {
        root_canister_id : ?Principal;
        governance_canister_id : ?Principal;
        index_canister_id : ?Principal;
        swap_canister_id : ?Principal;
        ledger_canister_id : ?Principal;
    };

    public type ListDeployedSnsesResponse = {
        instances : [DeployedSns];
    };

    public type NNSSnsWCanister = actor {
        list_deployed_snses : ({}) -> async ListDeployedSnsesResponse;
    };

    public type SnsCache = {
        instances: [DeployedSns];
        last_updated: Int;
    };

    // SNS Governance canister interface for voting power validation
    public type NeuronPermission = {
        principal: ?Principal;
        permission_type: [Int32];
    };

    public type Neuron = {
        id: ?NeuronId;
        permissions: [NeuronPermission];
        cached_neuron_stake_e8s: Nat64;
        neuron_fees_e8s: Nat64;
        created_timestamp_seconds: Nat64;
        aging_since_timestamp_seconds: Nat64;
        voting_power_percentage_multiplier: Nat64;
        dissolve_delay_seconds: Nat64;
        followees: [(Int32, { followees: [NeuronId] })];
    };

    public type ListNeuronsResponse = {
        neurons: [SNSNeuron];
    };

    public type SNSGovernanceCanister = actor {
        list_neurons: ({
            of_principal: ?Principal;
            limit: Nat32;
            start_page_at: ?NeuronId;
        }) -> async ListNeuronsResponse;
        
        get_neuron: (NeuronId) -> async ?Neuron;
    };

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
        added_by: Nat32;
        added_at: Int;
    };

    // Proposal tracking types
    public type ProposalTopicMapping = {
        forum_id: Nat;
        proposals_topic_id: Nat;
        set_by: Nat32;
        set_at: Int;
    };

    public type ProposalThreadMapping = {
        thread_id: Nat;
        proposal_id: Nat;
        sns_root_canister_id: Nat32;
        created_by: Nat32;
        created_at: Int;
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

    // Composite key for proposal threads: (sns_root_index, proposal_id)
    public type ProposalThreadKey = (Nat32, Nat);

    // Text limits configuration
    public type TextLimits = {
        post_title_max_length: Nat;
        post_body_max_length: Nat;
        thread_title_max_length: Nat;
        thread_body_max_length: Nat;
        topic_title_max_length: Nat;
        topic_description_max_length: Nat;
        forum_title_max_length: Nat;
        forum_description_max_length: Nat;
    };

    // Input type for updating text limits
    public type UpdateTextLimitsInput = {
        post_title_max_length: ?Nat;
        post_body_max_length: ?Nat;
        thread_title_max_length: ?Nat;
        thread_body_max_length: ?Nat;
        topic_title_max_length: ?Nat;
        topic_description_max_length: ?Nat;
        forum_title_max_length: ?Nat;
        forum_description_max_length: ?Nat;
    };

    // State type for the forum system
    public type ForumState = {
        // Global ID counter
        var next_id: Nat;
        
        // Text limits configuration
        var text_limits: TextLimits;
        
        // Core data storage
        forums: Map.Map<Nat, Forum>;
        topics: Map.Map<Nat, Topic>;
        threads: Map.Map<Nat, Thread>;
        posts: Map.Map<Nat, Post>;
        votes: Map.Map<VoteKey, Vote>;
        tips: Map.Map<Nat, Tip>;
        
        // Admin management
        admins: Vector.Vector<AdminInfo>;
        
        // Deduplication states
        principal_dedup_state: Dedup.DedupState;
        neuron_dedup_state: Dedup.DedupState;
        
        // Indexes for efficient queries (using Vector for stable compatibility)
        forum_topics: Map.Map<Nat, Vector.Vector<Nat>>;
        topic_subtopics: Map.Map<Nat, Vector.Vector<Nat>>;
        topic_threads: Map.Map<Nat, Vector.Vector<Nat>>;
        thread_posts: Map.Map<Nat, Vector.Vector<Nat>>;
        post_replies: Map.Map<Nat, Vector.Vector<Nat>>;
        post_tips: Map.Map<Nat, Vector.Vector<Nat>>; // post_id -> [tip_ids]
        thread_tips: Map.Map<Nat, Vector.Vector<Nat>>; // thread_id -> [tip_ids]
        tips_given: Map.Map<Nat32, Vector.Vector<Nat>>; // from_principal_index -> [tip_ids]
        tips_received: Map.Map<Nat32, Vector.Vector<Nat>>; // to_principal_index -> [tip_ids]
        
        // Proposal tracking (separate from core structures)
        proposal_topics: Map.Map<Nat, ProposalTopicMapping>; // forum_id -> mapping
        proposal_threads: Map.Map<ProposalThreadKey, ProposalThreadMapping>; // (sns_root, proposal_id) -> mapping
        thread_proposals: Map.Map<Nat, (Nat32, Nat)>; // thread_id -> (sns_root_index, proposal_id) (for reverse lookup)
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

    // Proposal management input types
    public type SetProposalTopicInput = {
        forum_id: Nat;
        topic_id: Nat;
    };

    public type CreateProposalThreadInput = {
        proposal_id: Nat;
        sns_root_canister_id: Principal;
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

    // Proposal response types with resolved Principals
    public type ProposalTopicMappingResponse = {
        forum_id: Nat;
        proposals_topic_id: Nat;
        set_by: Principal;
        set_at: Int;
    };

    public type ProposalThreadMappingResponse = {
        thread_id: Nat;
        proposal_id: Nat;
        sns_root_canister_id: Principal;
        created_by: Principal;
        created_at: Int;
    };

    // Statistics type for admin endpoints
    public type ForumStats = {
        total_forums: Nat;
        total_topics: Nat;
        total_threads: Nat;
        total_posts: Nat;
        total_votes: Nat;
    };

    // Tip statistics type (separate to avoid stable structure changes)
    public type TipStats = {
        total_tips: Nat;
        total_tip_amount_by_token: [(Principal, Nat)]; // token_ledger_principal -> total_amount
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

    // Helper function for proposal thread key comparison
    public func proposal_thread_key_equal(a: ProposalThreadKey, b: ProposalThreadKey) : Bool {
        a.0 == b.0 and a.1 == b.1
    };

    // Helper function for proposal thread key hash
    public func proposal_thread_key_hash(key: ProposalThreadKey) : Nat32 {
        let sns_root_hash = key.0;
        let proposal_hash = Nat32.fromNat(key.1 % (2**32 - 1));
        sns_root_hash ^ proposal_hash
    };

    // Helper function for vote key comparison
    public func vote_key_equal(a: VoteKey, b: VoteKey) : Bool {
        a.0 == b.0 and a.1 == b.1
    };

    public func vote_key_hash(key: VoteKey) : Nat32 {
        let h1 : Nat32 = Nat32.fromNat(key.0 % 4294967295); // 2^32 - 1
        let h2 = key.1;
        h1 ^ h2
    };

    // Tip data structure (simplified to use principals only)
    public type Tip = {
        id: Nat;
        from_principal: Nat32; // Principal index of the tipper (deduplicated)
        to_principal: Nat32; // Principal index of the recipient (deduplicated)
        post_id: Nat;
        thread_id: Nat;
        token_ledger_principal: Principal;
        amount: Nat;
        transaction_block_index: ?Nat; // ICRC1 transaction block index for verification
        created_at: Int;
        created_by: Nat32; // Same as from_principal
    };

    // Composite key type for tips (post_id, tip_id) for efficient post-based queries
    public type TipKey = (Nat, Nat);

    // Input type for creating a tip
    public type CreateTipInput = {
        to_principal: Principal;
        post_id: Nat;
        token_ledger_principal: Principal;
        amount: Nat;
        transaction_block_index: ?Nat;
    };

    // Response type for tips with resolved data
    public type TipResponse = {
        id: Nat;
        from_principal: Principal;
        to_principal: Principal;
        post_id: Nat;
        thread_id: Nat;
        token_ledger_principal: Principal;
        amount: Nat;
        transaction_block_index: ?Nat;
        created_at: Int;
        created_by: Principal;
    };

    // Token summary for efficient wallet integration
    public type TipTokenSummary = {
        token_ledger_principal: Principal;
        total_amount: Nat;
        tip_count: Nat;
    };



    // Helper function for tip key comparison
    public func tip_key_equal(a: TipKey, b: TipKey) : Bool {
        a.0 == b.0 and a.1 == b.1
    };

    // Helper function for tip key hash
    public func tip_key_hash(key: TipKey) : Nat32 {
        let h1 : Nat32 = Nat32.fromNat(key.0 % 4294967295); // 2^32 - 1
        let h2 : Nat32 = Nat32.fromNat(key.1 % 4294967295); // 2^32 - 1
        h1 ^ h2
    };
}
