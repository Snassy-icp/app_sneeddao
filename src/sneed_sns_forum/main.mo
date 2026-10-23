import Array "mo:base/Array";
import Principal "mo:base/Principal";
import Map "mo:map/Map";
import Dedup "mo:dedup";
import Vector "mo:vector";
import Nat64 "mo:base/Nat64";
import Nat "mo:base/Nat";
import Time "mo:base/Time";
import Int "mo:base/Int";
import Text "mo:base/Text";
import Iter "mo:base/Iter";
import Debug "mo:base/Debug";
import Sha256 "mo:sha2/Sha256";

import T "Types";
import Lib "lib";
import PremiumClient "../PremiumClient";
import IngressGuard "../IngressGuard";
import RateLimit "../RateLimit";
import RateRules "../RateRules";
import Mentions "Mentions";
import TipVerify "TipVerify";
import ApiDoc "ApiDoc";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import TextLog "../sneed_names/TextLog";
import NT "../sneed_names/Types";

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

    // @-mentions (Mentions.mo, spec/forum_mentions.md): who was mentioned where, newest last; the
    // keys already recorded (so an edit only adds new mentions); when each user last looked; and
    // who asked for a Sneed SMS when mentioned.
    let stable_mentions = Map.new<Principal, Vector.Vector<Mentions.Mention>>();
    let stable_mention_keys = Map.new<Text, ()>();
    let stable_user_last_seen_mentions = Map.new<Principal, Int>();
    let stable_mention_sms = Map.new<Principal, ()>();

    // Sneed Notifications (spec/sneed_notifications.md): when set, replies, mentions and tips are
    // also sent there, for members who allowed Sneed Hub to notify them. Best effort: the forum
    // never waits on it.
    var stable_notifications : ?Principal = null;

    // Tip verification (TipVerify.mo): what the ledger said about each tip recorded since the
    // forum checks tips (none: recorded before), and which (ledger, block) pairs tips have used,
    // so one transfer backs one tip only. Blocks of tips recorded before are added once, on the
    // first upgrade to this build.
    let stable_tip_checks = Map.new<Nat, T.TipCheck>();
    let stable_tip_blocks = Map.new<Text, Nat>(); // TipVerify.blockKey(ledger, block) -> tip id
    var stable_tip_blocks_backfilled : Bool = false;
    // blocks being checked right now: reserved before the ledger call, so two calls interleaving
    // over the await cannot both accept the same block
    transient let pending_tip_blocks = Map.new<Text, ()>();
    
    // Premium configuration and cache
    var stable_premium_config : T.PremiumConfig = {
        sneed_premium_canister_id = null;
        premium_post_body_max_length = 50000;      // 50k chars for premium (vs 10k default)
        premium_thread_body_max_length = 50000;    // 50k chars for premium (vs 10k default)
    };
    var stable_premium_cache = PremiumClient.emptyCache();

    // Per-user indexes (spec/paging_audit.md; Types.mo ForumState): posts and threads by author, and
    // the posts that may answer each user. Built from the forum's data on the first upgrade to this
    // build (postupgrade), kept up to date on every new post and thread after that.
    let stable_user_posts = Map.new<Nat32, Vector.Vector<Nat>>();
    let stable_user_threads = Map.new<Nat32, Vector.Vector<Nat>>();
    let stable_user_reply_inbox = Map.new<Nat32, Vector.Vector<Nat>>();
    var stable_user_indexes_built : Bool = false;

    // Rate limits (src/RateLimit.mo, rules in src/RateRules.mo) per caller and action, for the methods
    // anyone signed in can call to write: admins set them (admin_set_rate_limit), only the ones changed
    // from the defaults are kept; admins also keep a list of exempt principals (integrators' canisters
    // and bots). The buckets are transient: an upgrade refills everyone.
    var stable_rate_rules : RateRules.Rules = [];
    let stable_rate_exempt = Map.new<Principal, ()>();
    transient let limiter = RateLimit.Limiter();

    // ICRC-3 activity log (spec/forum_icrc3.md; library src/icrc3): tips verified on the ledger,
    // moderation, admins, configuration, forum structure and proposal threads. Ordinary posts,
    // threads and votes are not logged (public already, and the bulk of all calls). Enhanced
    // orthogonal persistence: these are new stable variables, so an upgrade starts an empty log.
    var icrc3 : Icrc3Log.State = Icrc3Log.init();
    transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
    // operational messages of the log (spills, archive creation, failures), admins read them with get_log
    let icrc3_textlog : TextLog.State = TextLog.init();

    transient let SNEED_SNS_ROOT : Principal = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");

    transient let icrc3_catalogue : Icrc3Log.Config = {
        block_types_url = "https://app.sneeddao.com/api/sneed_sns_forum#block-types";
        block_types = [
            "sneedforum_tip",
            "sneedforum_tip_verified",
            "sneedforum_tip_rejected",
            "sneedforum_delete",
            "sneedforum_undelete",
            "sneedforum_edit",
            "sneedforum_forum_create",
            "sneedforum_forum_update",
            "sneedforum_topic_create",
            "sneedforum_topic_update",
            "sneedforum_proposals_topic_set",
            "sneedforum_proposals_topic_remove",
            "sneedforum_proposal_thread_create",
            "sneedforum_admin_add",
            "sneedforum_admin_remove",
            "sneedforum_config_update",
        ];
    };

    func icrc3_self() : Principal = Principal.fromActor(SneedSNSForum);

    func icrc3_env() : Icrc3Log.Environment {
        {
            self = icrc3_self();
            archive_controllers = [SNEED_SNS_ROOT]; // added next to the forum on every archive
            cycle_reserve = 2_000_000_000_000; // never spend the forum's balance below 2 T
            new_correlation_id = func() : Nat = TextLog.correlationId(icrc3_textlog);
            log_info = func(cid : Nat, m : Text) = TextLog.add(icrc3_textlog, #info, cid, icrc3_self(), m);
            log_error = func(cid : Nat, m : Text) = TextLog.add(icrc3_textlog, #error, cid, icrc3_self(), m);
        };
    };

    /// Appends one block: `sneedforum_<btype>`, with the calling principal first.
    func block(btype : Text, caller : Principal, tx : [(Text, T3.Value)]) {
        ignore Icrc3Log.append(icrc3, "sneedforum_" # btype, Int.abs(Time.now()), Array.append<(Text, T3.Value)>([("caller", Icrc3Log.principal(caller))], tx));
    };

    func pv(p : Principal) : T3.Value = Icrc3Log.principal(p);
    func cat(parts : [[(Text, T3.Value)]]) : [(Text, T3.Value)] = Array.flatten<(Text, T3.Value)>(parts);
    func sha(t : Text) : T3.Value = #Blob(Sha256.fromBlob(#sha256, Text.encodeUtf8(t)));
    func optNat(key : Text, n : ?Nat) : [(Text, T3.Value)] = switch n { case (?x) [(key, #Nat(x))]; case null [] };
    func optSha(key : Text, t : ?Text) : [(Text, T3.Value)] = switch t { case (?x) [(key, sha(x))]; case null [] };
    func optPrincipal(p : ?Principal) : T3.Value = switch p { case (?x) pv(x); case null #Text("none") };

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
        tip_checks = stable_tip_checks;
        user_last_seen_replies = stable_user_last_seen_replies;
        proposal_topics = stable_proposal_topics;
        proposal_threads = stable_proposal_threads;
        thread_proposals = stable_thread_proposals;
        user_thread_reads = stable_user_thread_reads;
        user_posts = stable_user_posts;
        user_threads = stable_user_threads;
        user_reply_inbox = stable_user_reply_inbox;
        log = block;
    };






    // ---- Rate limits (src/RateLimit.mo) ----

    // What each action covers, and its default: generous for a person, a wall for a script.
    //   thread: create_thread, create_proposal_thread(_with_auto_setup), create_special_topic, create_sns_forum_setup
    //   post: create_post (posts and replies); edit: update_post, update_thread; poll: create_poll
    //   tip: create_tip, verify_tip; vote: vote_on_post(_with_neurons), retract_vote(_with_neurons), vote_on_poll_with_neurons
    transient let RATE_DEFAULTS : [(Text, T.RateRule)] = [
        ("thread", { capacity = 10; per_minute = 2 }),
        ("post", { capacity = 10; per_minute = 4 }),
        ("edit", { capacity = 10; per_minute = 4 }),
        ("poll", { capacity = 5; per_minute = 1 }),
        ("tip", { capacity = 10; per_minute = 3 }),
        ("vote", { capacity = 30; per_minute = 10 }),
    ];

    func rateRule(action : Text) : T.RateRule = RateRules.rule(stable_rate_rules, RATE_DEFAULTS, action);

    /// An SNS canister the forum knows: the SNS root of one of its forums, or a root or governance
    /// canister in its SNS-W cache (filled on the first post or vote after an upgrade).
    func isKnownSns(p : Principal) : Bool {
        for (i in sns_cache.instances.vals()) if (i.root_canister_id == ?p or i.governance_canister_id == ?p) return true;
        for (f in Map.vals(state.forums)) if (f.sns_root_canister_id == ?p) return true;
        false
    };

    /// Not rate limited: admins (the controllers, Sneed governance, the admin list), the principals on
    /// the exempt list (admin_set_rate_limit_exempt) and the SNS canisters the forum knows.
    func rateExempt(caller : Principal) : Bool {
        Lib.is_admin(state, caller) or Map.has(stable_rate_exempt, Map.phash, caller) or isKnownSns(caller)
    };

    /// Takes one call of `action` from the caller's bucket; false when it is empty.
    func rateOk(caller : Principal, action : Text) : Bool {
        rateExempt(caller) or limiter.take(caller, action, rateRule(action), Time.now())
    };

    /// For the ingress guard: whether the caller's bucket has a call left (takes nothing).
    func rateAllows(caller : Principal, action : Text) : Bool {
        rateExempt(caller) or limiter.allows(caller, action, rateRule(action), Time.now())
    };

    func rateError(action : Text) : T.ForumError {
        let r = rateRule(action);
        #InvalidInput("Rate limited: at most " # Nat.toText(r.capacity) # " " # action # " calls in a row and " # Nat.toText(r.per_minute) # " a minute after that. Please try again in a minute.")
    };

    func rateValue(r : T.RateRule) : T3.Value = #Map([("capacity", #Nat(r.capacity)), ("per_minute", #Nat(r.per_minute))]);

    /// The rate limit of every action (thread, post, edit, poll, tip, vote): `capacity` calls in a
    /// row per caller, refilled at `per_minute` a minute; capacity 0 means no limit. Admins are never limited.
    public query func get_rate_limits() : async [(Text, T.RateRule)] {
        RateRules.all(stable_rate_rules, RATE_DEFAULTS)
    };

    /// Admins: sets the rate limit of an action (null: back to the default). Logged as config_update
    /// with key "rate_limit.<action>".
    public shared ({ caller }) func admin_set_rate_limit(action : Text, rule : ?T.RateRule) : async T.Result<(), T.ForumError> {
        if (not Lib.is_admin(state, caller)) return #err(#Unauthorized("Admin access required"));
        let old = rateRule(action);
        switch (RateRules.set(stable_rate_rules, RATE_DEFAULTS, action, rule)) {
            case (#err e) return #err(#InvalidInput(e));
            case (#ok rules) stable_rate_rules := rules;
        };
        let new = rateRule(action);
        if (old != new) configBlock(caller, "rate_limit." # action, rateValue(old), rateValue(new));
        #ok
    };

    /// Principals exempt from the rate limits (besides admins and the SNS canisters the forum knows):
    /// integrators' canisters and bots that write in bursts.
    public query func get_rate_limit_exempt() : async [Principal] {
        Iter.toArray(Map.keys(stable_rate_exempt))
    };

    /// Admins: puts a principal on the exempt list or takes it off. Logged as config_update with key
    /// "rate_limit_exempt", the principal, and old_value / value 1 (exempt) or 0.
    public shared ({ caller }) func admin_set_rate_limit_exempt(principal : Principal, exempt : Bool) : async T.Result<(), T.ForumError> {
        if (not Lib.is_admin(state, caller)) return #err(#Unauthorized("Admin access required"));
        let was = Map.has(stable_rate_exempt, Map.phash, principal);
        if (exempt) Map.set(stable_rate_exempt, Map.phash, principal, ()) else Map.delete(stable_rate_exempt, Map.phash, principal);
        if (was != exempt) block("config_update", caller, [("key", #Text("rate_limit_exempt")), ("principal", pv(principal)),
            ("old_value", #Nat(if was 1 else 0)), ("value", #Nat(if exempt 1 else 0))]);
        #ok
    };

    // Admin management endpoints
    public shared ({ caller }) func add_admin(new_admin: Principal) : async T.Result<(), T.ForumError> {
        let r = Lib.add_admin(state, caller, new_admin);
        switch (r) { case (#ok) block("admin_add", caller, [("principal", pv(new_admin))]); case _ {} };
        r
    };

    public shared ({ caller }) func remove_admin(admin_to_remove: Principal) : async T.Result<(), T.ForumError> {
        let r = Lib.remove_admin(state, caller, admin_to_remove);
        switch (r) { case (#ok) block("admin_remove", caller, [("principal", pv(admin_to_remove))]); case _ {} };
        r
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
        let r = Lib.update_forum(state, caller, id, input);
        switch (r, Map.get(state.forums, Map.nhash, id)) {
            case (#ok, ?f) block("forum_update", caller, cat([[("forum_id", #Nat(id)), ("title", #Text(f.title))],
                switch (f.sns_root_canister_id) { case (?root) [("sns_root", pv(root))]; case null [] }]));
            case _ {};
        };
        r
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
        let old_parent = switch (Map.get(state.topics, Map.nhash, id)) { case (?t) t.parent_topic_id; case null null };
        let r = Lib.update_topic(state, caller, id, input);
        switch (r, Map.get(state.topics, Map.nhash, id)) {
            case (#ok, ?t) block("topic_update", caller, cat([[("topic_id", #Nat(id)), ("forum_id", #Nat(t.forum_id)), ("title", #Text(t.title))],
                optNat("parent_topic_id", t.parent_topic_id), if (old_parent != t.parent_topic_id) optNat("old_parent_topic_id", old_parent) else []]));
            case _ {};
        };
        r
    };

    public shared ({ caller }) func create_special_topic(input: T.CreateSpecialTopicInput) : async T.Result<Nat, T.ForumError> {
        if (not rateOk(caller, "thread")) return #err(rateError("thread"));
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
        if (not rateOk(caller, "thread")) return #err(rateError("thread"));
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
        let r = Lib.create_thread(state, caller, input, body_max_override);
        switch (r) { case (#ok(id)) { let m = recordMentions(caller, id, null, input.body); await* notifyMentions(id, null, input.body, m) }; case _ {} };
        r
    };

    public shared ({ caller }) func update_thread(id: Nat, title: ?Text, body: Text) : async T.Result<(), T.ForumError> {
        if (not rateOk(caller, "edit")) return #err(rateError("edit"));
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
        let before = Map.get(state.threads, Map.nhash, id);
        let r = Lib.update_thread(state, caller, id, title, body, body_max_override);
        switch (r, before) {
            case (#ok, ?old) logEdit(caller, "thread", id, old.created_by, old.title, old.body, title, body);
            case _ {};
        };
        switch (r) { case (#ok) { let m = recordMentions(caller, id, null, body); await* notifyMentions(id, null, body, m) }; case _ {} };
        r
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
        if (not rateOk(caller, "post")) return #err(rateError("post"));
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
        switch (result) {
            case (#ok(post_id)) {
                let m = recordMentions(caller, thread_id, ?post_id, body);
                await* notifyPost(caller, thread_id, reply_to_post_id, post_id, body, m);
            };
            case _ {};
        };
        result
    };

    public shared ({ caller }) func update_post(id: Nat, title: ?Text, body: Text) : async T.Result<(), T.ForumError> {
        if (not rateOk(caller, "edit")) return #err(rateError("edit"));
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
        let before = Map.get(state.posts, Map.nhash, id);
        let r = Lib.update_post(state, caller, id, title, body, body_max_override);
        switch (r, before) {
            case (#ok, ?old) logEdit(caller, "post", id, old.created_by, old.title, old.body, title, body);
            case _ {};
        };
        switch (r, Map.get(state.posts, Map.nhash, id)) {
            case (#ok, ?post) { let m = recordMentions(caller, post.thread_id, ?id, body); await* notifyMentions(post.thread_id, ?id, body, m) };
            case _ {};
        };
        r
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
        if (not rateOk(caller, "vote")) return #err(rateError("vote"));
        let (result, updated_cache) = await Lib.vote_on_post_with_sns(state, caller, post_id, vote_type, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public shared ({ caller }) func vote_on_post_with_neurons(
        post_id: Nat,
        vote_type: T.VoteType,
        neuron_ids: [T.NeuronId]
    ) : async T.Result<(), T.ForumError> {
        if (not rateOk(caller, "vote")) return #err(rateError("vote"));
        let (result, updated_cache) = await Lib.vote_on_post_with_specific_neurons(state, caller, post_id, vote_type, neuron_ids, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public shared ({ caller }) func retract_vote(post_id: Nat) : async T.Result<(), T.ForumError> {
        if (not rateOk(caller, "vote")) return #err(rateError("vote"));
        let (result, updated_cache) = await Lib.retract_vote_with_sns(state, caller, post_id, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public shared ({ caller }) func retract_vote_with_neurons(
        post_id: Nat,
        neuron_ids: [T.NeuronId]
    ) : async T.Result<(), T.ForumError> {
        if (not rateOk(caller, "vote")) return #err(rateError("vote"));
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
        if (not rateOk(caller, "poll")) return #err(rateError("poll"));
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
        if (not rateOk(caller, "vote")) return #err(rateError("vote"));
        let (result, updated_cache) = await Lib.vote_on_poll_with_specific_neurons(state, caller, poll_id, option_id, neuron_ids, sns_cache);
        sns_cache := updated_cache;
        result
    };

    public query func get_poll_votes(poll_id: Nat) : async [T.PollVoteResponse] {
        Lib.get_poll_votes(state, poll_id)
    };

    // Tip API endpoints

    /// Records a tip the caller has already sent: `transaction_block_index` is the block of an
    /// ICRC-1 transfer of exactly `amount` from the caller's main account to the post author's
    /// main account on `token_ledger_principal`. The forum reads that block on the ledger once
    /// (TipVerify.mo). A block that contradicts the tip, a block another tip already used and a
    /// recipient who is not the post's author are refused; a tip whose block cannot be read (no
    /// block index, the ledger did not answer) is recorded as unverified, and verify_tip retries it.
    /// Only verified tips notify the author and count in stats and totals.
    public shared ({ caller }) func create_tip(
        to_principal: Principal,
        post_id: Nat,
        token_ledger_principal: Principal,
        amount: Nat,
        transaction_block_index: ?Nat
    ) : async T.Result<Nat, T.ForumError> {
        if (not rateOk(caller, "tip")) return #err(rateError("tip"));
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create tips"));
        };
        let post = switch (Map.get(state.posts, Map.nhash, post_id)) {
            case (?p) p;
            case null return #err(#NotFound("Post not found"));
        };
        if (authorOf(post.created_by) != ?to_principal) {
            return #err(#InvalidInput("A tip goes to the post's author: to_principal must be the author of post " # Nat.toText(post_id)));
        };
        let input : T.CreateTipInput = { to_principal; post_id; token_ledger_principal; amount; transaction_block_index };
        let ?block = transaction_block_index else {
            return recordTip(caller, input, #unchecked, ?"No block index was given", null);
        };
        let key = TipVerify.blockKey(token_ledger_principal, block);
        switch (Map.get(stable_tip_blocks, Map.thash, key)) {
            case (?other) return #err(#AlreadyExists("Block " # Nat.toText(block) # " of this ledger is already the transfer of tip " # Nat.toText(other)));
            case null {};
        };
        if (Map.has(pending_tip_blocks, Map.thash, key)) {
            return #err(#AlreadyExists("Block " # Nat.toText(block) # " of this ledger is being registered by another call"));
        };
        Map.set(pending_tip_blocks, Map.thash, key, ());
        let outcome = await* TipVerify.verify(token_ledger_principal, block, caller, to_principal, amount);
        Map.delete(pending_tip_blocks, Map.thash, key);
        switch (outcome) {
            case (#rejected reason) #err(#InvalidInput("Tip not recorded: " # reason));
            case (#unchecked reason) recordTip(caller, input, #unchecked, ?reason, ?key);
            case (#verified) {
                let r = recordTip(caller, input, #verified, null, ?key);
                switch (r) { case (#ok id) logTip("tip", caller, id, []); case _ {} };
                switch (r) {
                    case (#ok _) if (to_principal != caller) await* sendNotifications([{
                        user = to_principal; topic = "tip"; title = "Your post got a tip"; body = "Someone tipped your post in " # threadName(post.thread_id) # ".";
                        link = ?postLink(post_id); dedupe = null; sponsored = false }]);
                    case _ {};
                };
                r
            };
        };
    };

    /// Records a tip with what the ledger said, and claims its block for it.
    func recordTip(caller : Principal, input : T.CreateTipInput, status : T.TipCheckStatus, note : ?Text, key : ?Text) : T.Result<Nat, T.ForumError> {
        let r = Lib.create_tip(state, caller, input);
        switch (r) {
            case (#ok id) {
                Map.set(stable_tip_checks, Map.nhash, id, { status; note; checked_at = Time.now() });
                switch (key) { case (?k) Map.set(stable_tip_blocks, Map.thash, k, id); case null {} };
            };
            case _ {};
        };
        r
    };

    /// A tip block: the tip as recorded, the ledger block that backs it and `extra` fields.
    func logTip(btype : Text, caller : Principal, tip_id : Nat, extra : [(Text, T3.Value)]) {
        let ?tip = Map.get(state.tips, Map.nhash, tip_id) else return;
        let who = func(i : Nat32) : T3.Value = switch (authorOf(i)) { case (?p) pv(p); case null #Text("unknown") };
        block(btype, caller, cat([[("tip_id", #Nat(tip_id)), ("from", who(tip.from_principal)), ("to", who(tip.to_principal)),
            ("post_id", #Nat(tip.post_id)), ("thread_id", #Nat(tip.thread_id)), ("ledger", pv(tip.token_ledger_principal)), ("amount", #Nat(tip.amount))],
            optNat("ledger_block", tip.transaction_block_index), extra]));
    };

    /// Checks a tip on the ledger again: a tip recorded unverified because its block could not be
    /// read, or one recorded before the forum checked tips. Anyone signed in may ask; a verified or
    /// rejected tip is final. Answers whether the tip is now verified (the reason is in the tip's
    /// verification_note). No notification is sent for a tip verified later.
    public shared ({ caller }) func verify_tip(tip_id : Nat) : async T.Result<Bool, T.ForumError> {
        if (not rateOk(caller, "tip")) return #err(rateError("tip"));
        if (Principal.isAnonymous(caller)) return #err(#Unauthorized("Authentication required"));
        let ?tip = Map.get(state.tips, Map.nhash, tip_id) else return #err(#NotFound("Tip not found"));
        switch (Map.get(stable_tip_checks, Map.nhash, tip_id)) {
            case (?{ status = #verified }) return #ok(true);
            case (?{ status = #rejected }) return #ok(false);
            case _ {};
        };
        let set = func(status : T.TipCheckStatus, note : ?Text) {
            Map.set(stable_tip_checks, Map.nhash, tip_id, { status; note; checked_at = Time.now() });
            switch (status, note) {
                case (#verified, _) logTip("tip_verified", caller, tip_id, []);
                case (#rejected, ?reason) logTip("tip_rejected", caller, tip_id, [("reason", #Text(reason))]);
                case _ {};
            };
        };
        let ?block = tip.transaction_block_index else { set(#unchecked, ?"No block index was given"); return #ok(false) };
        let (?from, ?to) = (authorOf(tip.from_principal), authorOf(tip.to_principal)) else return #err(#InternalError("Unknown principal index"));
        let post_author = switch (Map.get(state.posts, Map.nhash, tip.post_id)) { case (?p) authorOf(p.created_by); case null null };
        if (post_author != ?to) { set(#rejected, ?"The recipient is not the post's author"); return #ok(false) };
        let key = TipVerify.blockKey(tip.token_ledger_principal, block);
        switch (Map.get(stable_tip_blocks, Map.thash, key)) {
            case (?other) if (other != tip_id) {
                set(#rejected, ?("Block " # Nat.toText(block) # " of this ledger is the transfer of tip " # Nat.toText(other)));
                return #ok(false);
            };
            case _ {};
        };
        if (Map.has(pending_tip_blocks, Map.thash, key)) return #err(#AlreadyExists("This tip's block is being checked by another call"));
        Map.set(pending_tip_blocks, Map.thash, key, ());
        let outcome = await* TipVerify.verify(tip.token_ledger_principal, block, from, to, tip.amount);
        Map.delete(pending_tip_blocks, Map.thash, key);
        // another tip may have claimed the block while we waited
        switch (Map.get(stable_tip_blocks, Map.thash, key)) {
            case (?other) if (other != tip_id) {
                set(#rejected, ?("Block " # Nat.toText(block) # " of this ledger is the transfer of tip " # Nat.toText(other)));
                return #ok(false);
            };
            case _ {};
        };
        switch (outcome) {
            case (#verified) { set(#verified, null); Map.set(stable_tip_blocks, Map.thash, key, tip_id); #ok(true) };
            case (#rejected reason) { set(#rejected, ?reason); #ok(false) };
            case (#unchecked reason) { set(#unchecked, ?reason); #ok(false) };
        };
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

    // Paged per-user lists (spec/paging_audit.md): newest first, from `before` (a position in the
    // user's list, exclusive; null for the newest), at most 100 items (limit 0: 100) and about 1.5 MB
    // per page (always at least one item); `next` is the `before` of the next page, null at the end.
    // A page may hold fewer items than asked (deleted ones are skipped), even none, while `next` is set.

    /// The user's posts (not deleted): what get_posts_by_user lists, paged.
    public query func get_posts_by_user_page(user_principal : Principal, before : ?Nat, limit : Nat) : async T.PostsPage {
        Lib.get_posts_by_user_page(state, user_principal, before, limit)
    };

    /// Replies to the user: what get_replies_to_user lists, paged.
    public query func get_replies_to_user_page(user_principal : Principal, before : ?Nat, limit : Nat) : async T.PostsPage {
        Lib.get_replies_to_user_page(state, user_principal, before, limit)
    };

    /// The user's threads (not deleted): what get_threads_by_user lists, paged.
    public query func get_threads_by_user_page(user_principal : Principal, before : ?Nat, limit : Nat) : async T.ThreadsPage {
        Lib.get_threads_by_user_page(state, user_principal, before, limit)
    };

    /// Tips the user gave: what get_tips_given_by_user lists, paged.
    public query func get_tips_given_by_user_page(user_principal : Principal, before : ?Nat, limit : Nat) : async T.TipsPage {
        Lib.get_tips_given_by_user_page(state, user_principal, before, limit)
    };

    /// Tips the user received: what get_tips_received_by_user lists, paged.
    public query func get_tips_received_by_user_page(user_principal : Principal, before : ?Nat, limit : Nat) : async T.TipsPage {
        Lib.get_tips_received_by_user_page(state, user_principal, before, limit)
    };

    // @-mentions (Mentions.mo, spec/forum_mentions.md)

    /// Records new mentions in a thread or post and answers who was newly mentioned.
    func recordMentions(by : Principal, thread_id : Nat, post_id : ?Nat, body : Text) : [Principal] {
        let fresh = Vector.new<Principal>();
        let at = Time.now();
        let place = switch (post_id) { case (?p) "p" # Nat.toText(p); case null "t" # Nat.toText(thread_id) };
        for (p in Mentions.parse(body).vals()) {
            let key = place # ":" # Principal.toText(p);
            if (p != by and not Principal.isAnonymous(p) and Map.get(stable_mention_keys, Map.thash, key) == null) {
                Map.set(stable_mention_keys, Map.thash, key, ());
                let list = switch (Map.get(stable_mentions, Map.phash, p)) {
                    case (?l) l;
                    case null { let l = Vector.new<Mentions.Mention>(); Map.set(stable_mentions, Map.phash, p, l); l };
                };
                Vector.add(list, { thread_id; post_id; by; at });
                Vector.add(fresh, p);
            };
        };
        Vector.toArray(fresh);
    };

    // ---- Sneed Notifications ----

    type NotifyInput = { user : Principal; topic : Text; title : Text; body : Text; link : ?Text; dedupe : ?Text; sponsored : Bool };
    type Notifications = actor { notify_batch : shared [NotifyInput] -> async [Any] };

    func postLink(post_id : Nat) : Text = "https://app.sneeddao.com/post?postid=" # Nat.toText(post_id);
    func threadLink(thread_id : Nat) : Text = "https://app.sneeddao.com/thread?threadid=" # Nat.toText(thread_id);
    func threadName(thread_id : Nat) : Text = switch (Map.get(state.threads, Map.nhash, thread_id)) {
        case (?t) switch (t.title) { case (?title) "“" # Mentions.excerpt(title, 120) # "”"; case null "a thread" };
        case null "a thread";
    };
    func authorOf(index : Nat32) : ?Principal = Dedup.getPrincipalForIndex(state.principal_dedup_state, index);

    /// Hands the messages to Sneed Notifications without waiting for the answer (bounded, so an
    /// unanswered call can never hold up the forum or its upgrades).
    func sendNotifications(items : [NotifyInput]) : async* () {
        if (items.size() == 0) return;
        switch (stable_notifications) {
            case (?id) {
                let n : Notifications = actor (Principal.toText(id));
                ignore (with timeout = 60) n.notify_batch(items);
            };
            case null {};
        };
    };

    func mentionItems(thread_id : Nat, post_id : ?Nat, body : Text, mentioned : [Principal]) : [NotifyInput] {
        let link = switch (post_id) { case (?p) postLink(p); case null threadLink(thread_id) };
        Array.map<Principal, NotifyInput>(mentioned, func(u) = { user = u; topic = "mention"; title = "You were mentioned in " # threadName(thread_id);
            body = Mentions.excerpt(body, 300); link = ?link; dedupe = null; sponsored = false });
    };

    func notifyMentions(thread_id : Nat, post_id : ?Nat, body : Text, mentioned : [Principal]) : async* () {
        await* sendNotifications(mentionItems(thread_id, post_id, body, mentioned));
    };

    /// A new post: its mentions, and a reply notice to the author of the post it answers (or of
    /// the thread), unless that is the poster or someone already mentioned.
    func notifyPost(by : Principal, thread_id : Nat, reply_to : ?Nat, post_id : Nat, body : Text, mentioned : [Principal]) : async* () {
        let target : ?Principal = switch (reply_to) {
            case (?pid) switch (Map.get(state.posts, Map.nhash, pid)) { case (?p) authorOf(p.created_by); case null null };
            case null switch (Map.get(state.threads, Map.nhash, thread_id)) { case (?t) authorOf(t.created_by); case null null };
        };
        let reply : [NotifyInput] = switch (target) {
            case (?u) if (u != by and Array.find<Principal>(mentioned, func(m) = m == u) == null) [{
                user = u; topic = "reply"; title = "New reply in " # threadName(thread_id); body = Mentions.excerpt(body, 300);
                link = ?postLink(post_id); dedupe = null; sponsored = false }] else [];
            case null [];
        };
        await* sendNotifications(Array.append(reply, mentionItems(thread_id, ?post_id, body, mentioned)));
    };

    /// Admins: where to send notifications (null: nowhere).
    public shared ({ caller }) func admin_set_notifications(canister : ?Principal) : async T.Result<(), T.ForumError> {
        if (not Lib.is_admin(state, caller)) return #err(#Unauthorized("Admins only"));
        let old = stable_notifications;
        stable_notifications := canister;
        if (old != canister) configBlock(caller, "notifications_canister", optPrincipal(old), optPrincipal(canister));
        #ok();
    };

    public query func get_notifications_canister() : async ?Principal { stable_notifications };

    /// The mention as shown in a notification, or null when its thread or post is gone.
    func mentionView(i : Nat, m : Mentions.Mention) : ?T.MentionResponse {
        let thread = switch (Map.get(state.threads, Map.nhash, m.thread_id)) { case (?t) t; case null return null };
        if (thread.deleted) return null;
        let (title, body) = switch (m.post_id) {
            case (?pid) switch (Map.get(state.posts, Map.nhash, pid)) {
                case (?post) { if (post.deleted) return null; (post.title, post.body) };
                case null return null;
            };
            case null (thread.title, thread.body);
        };
        ?{ index = i; thread_id = m.thread_id; post_id = m.post_id; by = m.by; created_at = m.at;
           thread_title = thread.title; title; excerpt = Mentions.excerpt(body, 200) };
    };

    /// Where a user was mentioned, newest first, from `before` (an index, exclusive), at most 100.
    public query func get_mentions_of_user(user : Principal, before : ?Nat, limit : Nat) : async T.MentionsPage {
        let list = switch (Map.get(stable_mentions, Map.phash, user)) { case (?l) l; case null return { items = []; next = null } };
        let max = if (limit == 0 or limit > 100) 100 else limit;
        var i : Nat = switch (before) { case (?b) if (b < Vector.size(list)) b else Vector.size(list); case null Vector.size(list) };
        let out = Vector.new<T.MentionResponse>();
        var scanned = 0;
        while (i > 0 and Vector.size(out) < max and scanned < 1_000) {
            i -= 1; scanned += 1;
            switch (mentionView(i, Vector.get(list, i))) { case (?v) Vector.add(out, v); case null {} };
        };
        { items = Vector.toArray(out); next = if (i > 0) ?i else null };
    };

    /// Mentions since the user last marked them seen (live threads and posts only).
    public query func get_recent_mentions_count(user : Principal) : async Nat {
        let list = switch (Map.get(stable_mentions, Map.phash, user)) { case (?l) l; case null return 0 };
        let since = switch (Map.get(stable_user_last_seen_mentions, Map.phash, user)) { case (?t) t; case null 0 };
        var count = 0;
        var i = Vector.size(list);
        label newest while (i > 0) {
            i -= 1;
            let m = Vector.get(list, i);
            if (m.at <= since) break newest;
            if (mentionView(i, m) != null) count += 1;
        };
        count
    };

    public shared ({ caller }) func mark_mentions_seen_up_to(timestamp : Int) : async () {
        if (Principal.isAnonymous(caller)) return;
        Map.set(stable_user_last_seen_mentions, Map.phash, caller, timestamp);
    };

    public query func get_last_seen_mentions_timestamp(user : Principal) : async ?Int {
        Map.get(stable_user_last_seen_mentions, Map.phash, user)
    };

    /// Opt in (or out) of a Sneed SMS when someone mentions you. The SMS is sent by the poster's
    /// own client, from the poster's principal, so it counts against their SMS limits.
    public shared ({ caller }) func set_mention_sms(on : Bool) : async T.Result<(), T.ForumError> {
        if (Principal.isAnonymous(caller)) return #err(#Unauthorized("Log in to change this setting"));
        if (on) Map.set(stable_mention_sms, Map.phash, caller, ()) else Map.delete(stable_mention_sms, Map.phash, caller);
        #ok
    };

    public query func get_mention_sms(user : Principal) : async Bool {
        Map.get(stable_mention_sms, Map.phash, user) != null
    };

    /// Which of these principals (at most Mentions.MAX_PER_TEXT) want a Sneed SMS when mentioned.
    public query func get_mention_sms_opted_in(users : [Principal]) : async [Principal] {
        let out = Vector.new<Principal>();
        for (u in users.vals()) {
            if (Vector.size(out) < Mentions.MAX_PER_TEXT and Map.get(stable_mention_sms, Map.phash, u) != null) Vector.add(out, u);
        };
        Vector.toArray(out)
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

    // ---- Moderation (logged: spec/forum_icrc3.md) ----

    /// Whether the principal index `author` is the caller.
    func isAuthor(caller : Principal, author : Nat32) : Bool = authorOf(author) == ?caller;

    /// An edit of someone else's thread or post (only admins can): hashes of the texts before and
    /// after, never the texts. Authors editing their own content are not logged.
    func logEdit(caller : Principal, kind : Text, id : Nat, author : Nat32, old_title : ?Text, old_body : Text, title : ?Text, body : Text) {
        if (isAuthor(caller, author)) return;
        block("edit", caller, cat([[("kind", #Text(kind)), ("id", #Nat(id)), ("author", optPrincipal(authorOf(author))),
            ("old_body_sha256", sha(old_body)), ("body_sha256", sha(body))], optSha("old_title_sha256", old_title), optSha("title_sha256", title)]));
    };

    /// A delete or undelete that changed the item's state. Forums and topics are always logged;
    /// threads and posts with their author and the hashes of their texts, a delete only when the
    /// caller is not the author (a moderator's act, not the author's own retraction).
    func logModeration(btype : Text, caller : Principal, kind : Text, id : Nat, content : ?(Nat32, ?Text, Text)) {
        switch (content) {
            case null block(btype, caller, [("kind", #Text(kind)), ("id", #Nat(id))]);
            case (?(author, title, body)) {
                if (btype == "delete" and isAuthor(caller, author)) return;
                block(btype, caller, cat([[("kind", #Text(kind)), ("id", #Nat(id)), ("author", optPrincipal(authorOf(author))), ("body_sha256", sha(body))], optSha("title_sha256", title)]));
            };
        };
    };

    func forumDeleted(id : Nat) : ?Bool = switch (Map.get(state.forums, Map.nhash, id)) { case (?f) ?f.deleted; case null null };
    func topicDeleted(id : Nat) : ?Bool = switch (Map.get(state.topics, Map.nhash, id)) { case (?t) ?t.deleted; case null null };
    func threadContent(id : Nat) : ?(Bool, (Nat32, ?Text, Text)) = switch (Map.get(state.threads, Map.nhash, id)) { case (?t) ?(t.deleted, (t.created_by, t.title, t.body)); case null null };
    func postContent(id : Nat) : ?(Bool, (Nat32, ?Text, Text)) = switch (Map.get(state.posts, Map.nhash, id)) { case (?p) ?(p.deleted, (p.created_by, p.title, p.body)); case null null };

    /// Runs a delete (`to` = true) or undelete of a forum or topic and logs it when the flag changed.
    func structureFlag(caller : Principal, kind : Text, id : Nat, to : Bool, was : ?Bool, r : T.Result<(), T.ForumError>) : T.Result<(), T.ForumError> {
        switch (r, was) {
            case (#ok, ?w) if (w != to) logModeration(if to "delete" else "undelete", caller, kind, id, null);
            case _ {};
        };
        r
    };
    func contentFlag(caller : Principal, kind : Text, id : Nat, to : Bool, was : ?(Bool, (Nat32, ?Text, Text)), r : T.Result<(), T.ForumError>) : T.Result<(), T.ForumError> {
        switch (r, was) {
            case (#ok, ?(w, content)) if (w != to) logModeration(if to "delete" else "undelete", caller, kind, id, ?content);
            case _ {};
        };
        r
    };

    // Admin delete endpoints
    public shared ({ caller }) func delete_forum(id: Nat) : async T.Result<(), T.ForumError> {
        let was = forumDeleted(id);
        structureFlag(caller, "forum", id, true, was, Lib.soft_delete_forum(state, caller, id))
    };

    public shared ({ caller }) func delete_topic(id: Nat) : async T.Result<(), T.ForumError> {
        let was = topicDeleted(id);
        structureFlag(caller, "topic", id, true, was, Lib.soft_delete_topic(state, caller, id))
    };

    public shared ({ caller }) func delete_thread(id: Nat) : async T.Result<(), T.ForumError> {
        let was = threadContent(id);
        contentFlag(caller, "thread", id, true, was, Lib.soft_delete_thread(state, caller, id))
    };

    public shared ({ caller }) func delete_post(id: Nat) : async T.Result<(), T.ForumError> {
        let was = postContent(id);
        contentFlag(caller, "post", id, true, was, Lib.soft_delete_post(state, caller, id))
    };

    // Admin undelete endpoints
    public shared ({ caller }) func undelete_forum(id: Nat) : async T.Result<(), T.ForumError> {
        let was = forumDeleted(id);
        structureFlag(caller, "forum", id, false, was, Lib.undelete_forum(state, caller, id))
    };

    public shared ({ caller }) func undelete_topic(id: Nat) : async T.Result<(), T.ForumError> {
        let was = topicDeleted(id);
        structureFlag(caller, "topic", id, false, was, Lib.undelete_topic(state, caller, id))
    };

    public shared ({ caller }) func undelete_thread(id: Nat) : async T.Result<(), T.ForumError> {
        let was = threadContent(id);
        contentFlag(caller, "thread", id, false, was, Lib.undelete_thread(state, caller, id))
    };

    public shared ({ caller }) func undelete_post(id: Nat) : async T.Result<(), T.ForumError> {
        let was = postContent(id);
        contentFlag(caller, "post", id, false, was, Lib.undelete_post(state, caller, id))
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
        let old = Map.get(state.proposal_topics, Map.nhash, input.forum_id);
        let r = Lib.set_proposals_topic(state, caller, input);
        switch (r, old) {
            case (#ok, ?o) if (o.proposals_topic_id != input.topic_id) block("proposals_topic_set", caller, [("forum_id", #Nat(input.forum_id)), ("topic_id", #Nat(input.topic_id)), ("old_topic_id", #Nat(o.proposals_topic_id))]);
            case (#ok, null) block("proposals_topic_set", caller, [("forum_id", #Nat(input.forum_id)), ("topic_id", #Nat(input.topic_id))]);
            case _ {};
        };
        r
    };

    public query func get_proposals_topic(forum_id: Nat) : async ?T.ProposalTopicMappingResponse {
        Lib.get_proposals_topic_response(state, forum_id)
    };

    public query func get_proposals_topic_by_sns_root(sns_root_canister_id: Principal) : async ?T.ProposalTopicMappingResponse {
        Lib.get_proposals_topic_by_sns_root(state, sns_root_canister_id)
    };

    public shared ({ caller }) func create_proposal_thread(input: T.CreateProposalThreadInput) : async T.Result<Nat, T.ForumError> {
        if (not rateOk(caller, "thread")) return #err(rateError("thread"));
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create proposal threads"));
        };
        logProposalThread(caller, input, Lib.create_proposal_thread(state, caller, input))
    };

    public shared ({ caller }) func create_proposal_thread_with_auto_setup(input: T.CreateProposalThreadInput) : async T.Result<Nat, T.ForumError> {
        if (not rateOk(caller, "thread")) return #err(rateError("thread"));
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Authentication required to create proposal threads"));
        };
        let (result, updated_cache) = await Lib.create_proposal_thread_with_auto_setup(state, caller, input, sns_cache);
        sns_cache := updated_cache;
        logProposalThread(caller, input, result)
    };

    // Create forum with governance and proposals topics for an SNS
    public shared ({ caller }) func create_sns_forum_setup(sns_root_canister_id: Principal) : async T.Result<Nat, T.ForumError> {
        if (not rateOk(caller, "thread")) return #err(rateError("thread"));
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
        let old = Map.get(state.proposal_topics, Map.nhash, forum_id);
        let r = Lib.remove_proposals_topic(state, caller, forum_id);
        switch (r, old) {
            case (#ok, ?o) block("proposals_topic_remove", caller, [("forum_id", #Nat(forum_id)), ("old_topic_id", #Nat(o.proposals_topic_id))]);
            case _ {};
        };
        r
    };

    /// A proposal's discussion thread was created (the thread's text is standard: forum title and proposal id).
    func logProposalThread(caller : Principal, input : T.CreateProposalThreadInput, r : T.Result<Nat, T.ForumError>) : T.Result<Nat, T.ForumError> {
        switch (r) {
            case (#ok thread_id) {
                let topic = switch (Map.get(state.threads, Map.nhash, thread_id)) { case (?t) optNat("topic_id", ?t.topic_id); case null [] };
                block("proposal_thread_create", caller, cat([[("thread_id", #Nat(thread_id)), ("sns_root", pv(input.sns_root_canister_id)), ("proposal_id", #Nat(input.proposal_id))], topic]));
            };
            case _ {};
        };
        r
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
        let o = state.text_limits;
        let r = Lib.update_text_limits(state, caller, input);
        switch (r) {
            case (#ok) {
                let n = state.text_limits;
                for ((key, a, b) in [
                    ("post_title_max_length", o.post_title_max_length, n.post_title_max_length),
                    ("post_body_max_length", o.post_body_max_length, n.post_body_max_length),
                    ("thread_title_max_length", o.thread_title_max_length, n.thread_title_max_length),
                    ("thread_body_max_length", o.thread_body_max_length, n.thread_body_max_length),
                    ("topic_title_max_length", o.topic_title_max_length, n.topic_title_max_length),
                    ("topic_description_max_length", o.topic_description_max_length, n.topic_description_max_length),
                    ("forum_title_max_length", o.forum_title_max_length, n.forum_title_max_length),
                    ("forum_description_max_length", o.forum_description_max_length, n.forum_description_max_length),
                ].vals()) if (a != b) configBlock(caller, key, #Nat(a), #Nat(b));
            };
            case _ {};
        };
        r
    };

    /// A setting changed: its key, the old and the new value.
    func configBlock(caller : Principal, key : Text, old : T3.Value, value : T3.Value) {
        block("config_update", caller, [("key", #Text(key)), ("old_value", old), ("value", value)]);
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
        
        let o = state.premium_config;
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
        let n = state.premium_config;
        if (o.sneed_premium_canister_id != n.sneed_premium_canister_id) configBlock(caller, "sneed_premium_canister_id", optPrincipal(o.sneed_premium_canister_id), optPrincipal(n.sneed_premium_canister_id));
        if (o.premium_post_body_max_length != n.premium_post_body_max_length) configBlock(caller, "premium_post_body_max_length", #Nat(o.premium_post_body_max_length), #Nat(n.premium_post_body_max_length));
        if (o.premium_thread_body_max_length != n.premium_thread_body_max_length) configBlock(caller, "premium_thread_body_max_length", #Nat(o.premium_thread_body_max_length), #Nat(n.premium_thread_body_max_length));
        
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

    // ---- ICRC-3 interface (spec/forum_icrc3.md) ----

    public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Icrc3Log.getBlocks(icrc3, args) };
    public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Icrc3Log.getArchives(icrc3, args) };
    public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Icrc3Log.tipCertificate(icrc3) };
    public query func icrc3_supported_block_types() : async [T3.BlockType] { Icrc3Log.supportedBlockTypes(icrc3_catalogue) };
    public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Icrc3Log.supportedStandards() };
    public query func icrc3_log_status() : async T3.LogStatus { Icrc3Log.status(icrc3, icrc3_rt) };

    public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
        if (not Lib.is_admin(state, caller)) return #Err("Admins only");
        switch (Icrc3Log.applySettings(icrc3, u)) {
            case (#Err(e)) #Err(e);
            case (#Ok(changes)) {
                for ((key, old, new) in changes.vals()) configBlock(caller, key, #Nat(old), #Nat(new));
                #Ok(icrc3.settings);
            };
        };
    };

    public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
        if (not Lib.is_admin(state, caller)) return #Err("Admins only");
        if (icrc3_rt.spilling) return #Err("A spill is already in progress");
        #Ok(await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
    };

    public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
        if (not Lib.is_admin(state, caller)) Debug.trap("Admins only");
        await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
    };

    /// Admins: the log's operational messages (spills, archives created, failures), oldest first.
    public query ({ caller }) func get_log(start : Nat, length : Nat) : async [NT.LogEntry] {
        if (not Lib.is_admin(state, caller)) Debug.trap("Admins only");
        TextLog.get(icrc3_textlog, start, length);
    };

    func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };
    func ensure_icrc3_timer<system>() { Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job) };

    system func postupgrade() {
        Icrc3Log.certify(icrc3);
        ensure_icrc3_timer<system>();
        // State is already initialized with stable values.
        // Put right the poll counts of builds before f9df91bf (first votes went uncounted).
        ignore Lib.recount_poll_votes(state);
        // Tips recorded before the forum checked them keep their blocks: the first tip to name a
        // (ledger, block) owns it, so no later tip can reuse that transfer.
        if (not stable_tip_blocks_backfilled) {
            for (tip in Map.vals(stable_tips)) switch (tip.transaction_block_index) {
                case (?b) {
                    let key = TipVerify.blockKey(tip.token_ledger_principal, b);
                    if (not Map.has(stable_tip_blocks, Map.thash, key)) Map.set(stable_tip_blocks, Map.thash, key, tip.id);
                };
                case null {};
            };
            stable_tip_blocks_backfilled := true;
        };
        // the per-user indexes, from all posts and threads, once (later posts and threads add themselves)
        if (not stable_user_indexes_built) {
            ignore Lib.rebuild_user_indexes(state);
            stable_user_indexes_built := true;
        };
    };

    /// A short Markdown guide to this canister for AI agents and developers (ApiDoc.mo), following
    /// the ICP service-discoverability guide; the full reference is linked from it.
    public query func get_api_doc() : async Text { ApiDoc.text };

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
    system func inspect({ caller : Principal; arg : Blob; msg : {
        #add_admin : Any;
        #admin_icrc3_repair_archive_controllers : Any;
        #admin_icrc3_spill_now : Any;
        #admin_set_icrc3_settings : Any;
        #get_log : Any;
        #icrc10_supported_standards : Any;
        #icrc3_get_archives : Any;
        #icrc3_get_blocks : Any;
        #icrc3_get_tip_certificate : Any;
        #icrc3_log_status : Any;
        #icrc3_supported_block_types : Any;
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
        #get_api_doc : Any;
        #get_notifications_canister : Any;
        #admin_set_notifications : Any;
        #get_current_counter : Any;
        #get_feed : Any;
        #get_forum : Any;
        #get_forum_admin : Any;
        #get_forum_by_sns_root : Any;
        #get_forums : Any;
        #get_forums_admin : Any;
        #get_last_read_post : Any;
        #get_last_seen_mentions_timestamp : Any;
        #get_last_seen_replies_timestamp : Any;
        #get_mention_sms : Any;
        #get_mention_sms_opted_in : Any;
        #get_mentions_of_user : Any;
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
        #get_recent_mentions_count : Any;
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
        #mark_mentions_seen_up_to : Any;
        #mark_replies_seen_up_to : Any;
        #mark_tips_seen_up_to : Any;
        #remove_admin : Any;
        #remove_proposals_topic : Any;
        #retract_vote : Any;
        #retract_vote_with_neurons : () -> (Nat, [T.NeuronId]);
        #set_last_read_post : Any;
        #set_mention_sms : Any;
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
        #get_posts_by_user_page : Any;
        #get_replies_to_user_page : Any;
        #get_threads_by_user_page : Any;
        #get_tips_given_by_user_page : Any;
        #get_tips_received_by_user_page : Any;
        #get_rate_limits : Any;
        #admin_set_rate_limit : Any;
        #get_rate_limit_exempt : Any;
        #admin_set_rate_limit_exempt : Any;
        #verify_tip : Any;
    } }) : Bool {
        switch (msg) {
            case (
                #get_notifications_canister _ or
                #get_admins _
                or #get_api_doc _
                or #get_current_counter _
                or #get_feed _
                or #get_forum _
                or #get_forum_admin _
                or #get_forum_by_sns_root _
                or #get_forums _
                or #get_forums_admin _
                or #get_last_read_post _
                or #get_last_seen_mentions_timestamp _
                or #get_last_seen_replies_timestamp _
                or #get_mention_sms _
                or #get_mention_sms_opted_in _
                or #get_mentions_of_user _
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
                or #get_recent_mentions_count _
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
                or #get_log _
                or #icrc10_supported_standards _
                or #icrc3_get_archives _
                or #icrc3_get_blocks _
                or #icrc3_get_tip_certificate _
                or #icrc3_log_status _
                or #icrc3_supported_block_types _
                or #get_posts_by_user_page _
                or #get_replies_to_user_page _
                or #get_threads_by_user_page _
                or #get_tips_given_by_user_page _
                or #get_tips_received_by_user_page _
                or #get_rate_limits _
                or #get_rate_limit_exempt _
            ) false;
            // the log's admin methods: admins only, small arguments
            case (#admin_icrc3_repair_archive_controllers _ or #admin_icrc3_spill_now _ or #admin_set_icrc3_settings _) Lib.is_admin(state, caller) and arg.size() <= IngressGuard.SMALL_ARG;
            // texts against the forum's text limits; a body may be as long as the premium limit, the
            // method itself decides whether the caller is premium
            case (#create_forum f) { let i = f(); forumOk(arg, i.title, i.description) };
            case (#update_forum f) { let (_, i) = f(); forumOk(arg, i.title, i.description) };
            case (#create_topic f) { let i = f(); topicOk(arg, i.title, i.description) };
            case (#update_topic f) { let (_, i) = f(); topicOk(arg, i.title, i.description) };
            case (#create_thread f) { let i = f(); rateAllows(caller, "thread") and threadOk(arg, i.title, i.body) };
            case (#update_thread f) { let (_, title, body) = f(); rateAllows(caller, "edit") and threadOk(arg, title, body) };
            case (#create_post f) { let (_, _, title, body) = f(); rateAllows(caller, "post") and postOk(arg, title, body, true) };
            case (#update_post f) { let (_, title, body) = f(); rateAllows(caller, "edit") and postOk(arg, title, body, true) };
            case (#create_poll f) {
                let i = f();
                rateAllows(caller, "poll") and i.options.size() <= MAX_POLL_OPTIONS and arg.size() <= IngressGuard.textArg((i.options.size() + 1) * postChars(false))
                and postOk(arg, ?i.title, i.body, false)
                and IngressGuard.all<T.CreatePollOptionInput>(i.options, MAX_POLL_OPTIONS, func(o) = IngressGuard.text(o.title, state.text_limits.post_title_max_length) and IngressGuard.optText(o.body, state.text_limits.post_body_max_length))
            };
            case (#vote_on_post_with_neurons f) rateAllows(caller, "vote") and arg.size() <= NEURONS_ARG and f().2.size() <= MAX_NEURONS;
            case (#retract_vote_with_neurons f) rateAllows(caller, "vote") and arg.size() <= NEURONS_ARG and f().1.size() <= MAX_NEURONS;
            case (#vote_on_poll_with_neurons f) rateAllows(caller, "vote") and arg.size() <= NEURONS_ARG and f().2.size() <= MAX_NEURONS;
            case (#vote_on_post _ or #retract_vote _) rateAllows(caller, "vote") and arg.size() <= IngressGuard.SMALL_ARG;
            case (#create_tip _ or #verify_tip _) rateAllows(caller, "tip") and arg.size() <= IngressGuard.SMALL_ARG;
            case (#create_proposal_thread _ or #create_proposal_thread_with_auto_setup _ or #create_special_topic _ or #create_sns_forum_setup _) rateAllows(caller, "thread") and arg.size() <= IngressGuard.SMALL_ARG;
            case _ arg.size() <= IngressGuard.SMALL_ARG;
        };
    };

    ensure_icrc3_timer<system>();
}