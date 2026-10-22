import Principal "mo:base/Principal";
import Map "mo:map/Map";
import Dedup "mo:dedup";
import Vector "mo:vector";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Int "mo:base/Int";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Result "mo:base/Result";
import Buffer "mo:base/Buffer";
import Array "mo:base/Array";
import Char "mo:base/Char";
import Debug "mo:base/Debug";
import PremiumClient "../PremiumClient";
import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import TextLog "../sneed_names/TextLog";
import NT "../sneed_names/Types";

persistent actor SneedSMS {
    // Types
    public type Result<T, E> = Result.Result<T, E>;
    
    public type SMSError = {
        #Unauthorized: Text;
        #NotFound: Text;
        #InvalidInput: Text;
        #RateLimited: Text;
        #AlreadyExists: Text;
    };

    public type AdminInfo = {
        principal: Principal;
        added_by: Nat32;
        added_at: Int;
    };

    public type Message = {
        id: Nat;
        sender: Nat32; // Principal index (deduplicated)
        recipients: [Nat32]; // Principal indices (deduplicated)
        subject: Text;
        body: Text;
        reply_to: ?[Nat]; // Reply to message IDs
        created_at: Int;
        updated_at: Int;
    };

    public type MessageResponse = {
        id: Nat;
        sender: Principal;
        recipients: [Principal];
        subject: Text;
        body: Text;
        reply_to: ?[Nat];
        created_at: Int;
        updated_at: Int;
        can_remove_self: Bool; // Whether caller can remove themselves from this message
    };

    public type CreateMessageInput = {
        recipients: [Principal];
        subject: Text;
        body: Text;
        reply_to: ?[Nat];
    };

    public type SMSConfig = {
        var rate_limit_minutes: Nat; // Minutes between messages per user
        var max_subject_length: Nat;
        var max_body_length: Nat;
        var max_recipients: Nat;
    };

    public type SMSState = {
        var next_id: Nat;
        var config: SMSConfig;
        
        // Core data storage
        messages: Map.Map<Nat, Message>;
        
        // Admin management
        admins: Vector.Vector<AdminInfo>;
        
        // Deduplication state
        principal_dedup_state: Dedup.DedupState;
        
        // Indexes for efficient queries
        sender_messages: Map.Map<Nat32, Vector.Vector<Nat>>; // sender_index -> [message_ids]
        recipient_messages: Map.Map<Nat32, Vector.Vector<Nat>>; // recipient_index -> [message_ids]
        
        // Rate limiting
        user_last_message_time: Map.Map<Nat32, Int>; // user_index -> last_message_timestamp
        
        // Notification tracking
        user_last_seen_messages_timestamp: Map.Map<Nat32, Int>; // user_index -> last_seen_timestamp
    };

    // Stable storage - using mops stable-compatible types
    var stable_next_id: Nat = 1;
    var stable_messages = Map.new<Nat, Message>();
    var stable_admins = Vector.new<AdminInfo>();
    var stable_principal_dedup : Dedup.DedupState = Dedup.empty();
    var stable_sender_messages = Map.new<Nat32, Vector.Vector<Nat>>();
    var stable_recipient_messages = Map.new<Nat32, Vector.Vector<Nat>>();
    var stable_user_last_message_time = Map.new<Nat32, Int>();
    var stable_user_last_seen_messages_timestamp = Map.new<Nat32, Int>();
    var stable_rate_limit_minutes: Nat = 10;
    var stable_max_subject_length: Nat = 200;
    var stable_max_body_length: Nat = 5000;
    var stable_max_recipients: Nat = 20;
    
    // Premium config - stable storage
    var stable_sneed_premium_canister_id: ?Principal = null;
    var stable_premium_max_subject_length: Nat = 500;
    var stable_premium_max_body_length: Nat = 20000;
    var stable_premium_rate_limit_minutes: Nat = 1;
    var stable_premium_max_recipients: Nat = 50;
    
    // System notification config - authorized canisters that can send system notifications
    var stable_authorized_senders : [Principal] = [];
    var stable_system_sender_principal : ?Principal = null; // Principal shown as "sender" for system messages

    // Messages whose sender has removed themselves (message_id -> true). The message keeps the
    // original sender index, but the sender no longer has access and is shown as the anonymous principal.
    var stable_sender_removed = Map.new<Nat, Bool>();

    // Premium membership cache (principal -> expiration)
    var stable_premium_cache = PremiumClient.emptyCache();
    
    // Sneed Notifications (spec/sneed_notifications.md): when set, a message a person sends with
    // send_message also gives each recipient a heads-up there ("New message from ..."; the subject,
    // with a 100-character preview unless turned off), for those who allowed Sneed Hub. System messages (send_system_notification,
    // which is how Sneed Notifications itself copies notifications into inboxes) never notify, and
    // Sneed Notifications never copies what this canister sends back into Sneed SMS: no loop.
    // Best effort: sending never waits on it. Unset: off.
    var stable_notifications : ?Principal = null;
    let no_previews = Map.new<Principal, ()>(); // recipients who don't want the start of messages in notifications

    // ICRC-3 activity log (spec/sms_icrc3.md; library src/icrc3): admin and configuration acts only
    // (the admin list, the authorised system senders, the system sender, the notifications canister,
    // limits, premium settings, data imports, the log's own settings). Never a message's subject,
    // text, sender or recipients, and nothing a user does with their own messages or settings.
    // Enhanced orthogonal persistence: these are new stable variables, so an upgrade starts an empty log.
    var icrc3 : Icrc3Log.State = Icrc3Log.init();
    transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
    // operational messages of the log (spills, archive creation, failures), admins read them with get_log
    let icrc3_textlog : TextLog.State = TextLog.init();

    transient let SNEED_SNS_ROOT : Principal = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");

    transient let icrc3_catalogue : Icrc3Log.Config = {
        block_types_url = "https://app.sneeddao.com/api/sneed_sms#block-types";
        block_types = [
            "sneedsms_admin_add",
            "sneedsms_admin_remove",
            "sneedsms_authorized_sender_add",
            "sneedsms_authorized_sender_remove",
            "sneedsms_config_update",
            "sneedsms_messages_import",
        ];
    };

    func icrc3_self() : Principal = Principal.fromActor(SneedSMS);

    func icrc3_env() : Icrc3Log.Environment {
        {
            self = icrc3_self();
            archive_controllers = [SNEED_SNS_ROOT]; // added next to this canister on every archive
            cycle_reserve = 2_000_000_000_000; // never spend the balance below 2 T
            new_correlation_id = func() : Nat = TextLog.correlationId(icrc3_textlog);
            log_info = func(cid : Nat, m : Text) = TextLog.add(icrc3_textlog, #info, cid, icrc3_self(), m);
            log_error = func(cid : Nat, m : Text) = TextLog.add(icrc3_textlog, #error, cid, icrc3_self(), m);
        };
    };

    /// Appends one block: `sneedsms_<btype>`, with the calling principal first.
    func block(btype : Text, caller : Principal, tx : [(Text, T3.Value)]) {
        ignore Icrc3Log.append(icrc3, "sneedsms_" # btype, Int.abs(Time.now()), Array.append<(Text, T3.Value)>([("caller", Icrc3Log.principal(caller))], tx));
    };

    /// A setting changed: its key, the old and the new value.
    func configBlock(caller : Principal, key : Text, old : T3.Value, value : T3.Value) {
        block("config_update", caller, [("key", #Text(key)), ("old_value", old), ("value", value)]);
    };
    func natChange(caller : Principal, key : Text, old : Nat, value : Nat) {
        if (old != value) configBlock(caller, key, #Nat(old), #Nat(value));
    };
    func optPrincipal(p : ?Principal) : T3.Value = switch p { case (?x) Icrc3Log.principal(x); case null #Text("none") };
    func principalChange(caller : Principal, key : Text, old : ?Principal, value : ?Principal) {
        if (old != value) configBlock(caller, key, optPrincipal(old), optPrincipal(value));
    };

    // Runtime config (mutable wrapper around stable values)
    transient var runtime_config : SMSConfig = {
        var rate_limit_minutes = stable_rate_limit_minutes;
        var max_subject_length = stable_max_subject_length;
        var max_body_length = stable_max_body_length;
        var max_recipients = stable_max_recipients;
    };

    // Runtime state that directly references stable storage
    transient var state : SMSState = {
        var next_id = stable_next_id;
        var config = runtime_config;
        messages = stable_messages;
        admins = stable_admins;
        principal_dedup_state = stable_principal_dedup;
        sender_messages = stable_sender_messages;
        recipient_messages = stable_recipient_messages;
        user_last_message_time = stable_user_last_message_time;
        user_last_seen_messages_timestamp = stable_user_last_seen_messages_timestamp;
    };

    // System functions - save config values to stable vars
    system func preupgrade() {
        stable_next_id := state.next_id;
        stable_rate_limit_minutes := state.config.rate_limit_minutes;
        stable_max_subject_length := state.config.max_subject_length;
        stable_max_body_length := state.config.max_body_length;
        stable_max_recipients := state.config.max_recipients;
    };
    
    system func postupgrade() {
        // Restore config from stable values
        state.config.rate_limit_minutes := stable_rate_limit_minutes;
        state.config.max_subject_length := stable_max_subject_length;
        state.config.max_body_length := stable_max_body_length;
        state.config.max_recipients := stable_max_recipients;
        state.next_id := stable_next_id;
        ignore mark_legacy_removed_senders();
        Icrc3Log.certify(icrc3);
        ensure_icrc3_timer<system>();
    };

    // Builds before stable_sender_removed (ab70f949) marked a sender who left a message by setting
    // its sender to index 0, a real user's index, who then had the message as their own. Those
    // builds also took a message out of index 0's sent list whenever a recipient left it, whoever
    // sent it. So a message with sender 0 that is missing from index 0's sent list was either handed
    // to index 0 by a sender leaving, or really sent by index 0 and then left by a recipient; the
    // data cannot tell which. Both are marked sender-removed (decided 2026-10-17): the leak closes
    // for certain, and index 0 may lose sight of a message they sent that a recipient left (the
    // other recipients keep it, with the sender shown as removed). A message index 0 sent that no
    // recipient left is still in their sent list and stays theirs. Running it again finds nothing
    // new. Returns how many it marked.
    private func mark_legacy_removed_senders() : Nat {
        let sent_by_zero = Map.new<Nat, Bool>();
        switch (Map.get(state.sender_messages, Map.n32hash, 0 : Nat32)) {
            case (?ids) { for (id in Vector.vals(ids)) Map.set(sent_by_zero, Map.nhash, id, true) };
            case null {};
        };
        var marked = 0;
        for ((id, message) in Map.entries(state.messages)) {
            if (message.sender == 0 and Map.get(sent_by_zero, Map.nhash, id) == null and not is_sender_removed(id)) {
                Map.set(stable_sender_removed, Map.nhash, id, true);
                marked += 1;
            };
        };
        marked
    };

    // Helper functions
    private func get_next_id() : Nat {
        let id = state.next_id;
        state.next_id += 1;
        id
    };

    private func validate_text(text: Text, field_name: Text, max_length: Nat) : Result<(), SMSError> {
        if (Text.size(text) == 0) {
            return #err(#InvalidInput(field_name # " cannot be empty"));
        };
        if (Text.size(text) > max_length) {
            return #err(#InvalidInput(field_name # " exceeds maximum length of " # Nat.toText(max_length) # " characters"));
        };
        #ok()
    };

    // Admin management functions
    private func is_admin(principal: Principal) : Bool {
        if (Principal.equal(principal, Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai"))) { // Sneed governance canister is admin
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

    private func check_rate_limit(caller: Principal, rate_limit_minutes: Nat) : Result<(), SMSError> {
        if (is_admin(caller)) {
            return #ok(); // Admins bypass rate limits
        };

        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let current_time = Time.now();
        
        switch (Map.get(state.user_last_message_time, Map.n32hash, caller_index)) {
            case (?last_time) {
                let time_diff_ns = current_time - last_time;
                let time_diff_minutes = if (time_diff_ns >= 0) { 
                    Int.abs(time_diff_ns) / (60 * 1_000_000_000) 
                } else { 0 }; // Convert nanoseconds to minutes
                if (time_diff_minutes < rate_limit_minutes) {
                    let remaining_minutes = if (rate_limit_minutes >= time_diff_minutes) {
                        rate_limit_minutes - time_diff_minutes
                    } else { 0 };
                    return #err(#RateLimited("Must wait " # Nat.toText(remaining_minutes) # " more minutes before sending another message"));
                };
            };
            case null {}; // First message, no rate limit
        };
        
        #ok()
    };

    private func update_user_message_time(caller: Principal) {
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        Map.set(state.user_last_message_time, Map.n32hash, caller_index, Time.now());
    };

    private func is_sender_removed(message_id: Nat) : Bool {
        switch (Map.get(stable_sender_removed, Map.nhash, message_id)) {
            case (?removed) removed;
            case null false;
        }
    };

    // True if the caller is the message's sender and has not removed themselves from it
    private func is_active_sender(caller_index: Nat32, message: Message) : Bool {
        message.sender == caller_index and not is_sender_removed(message.id)
    };

    private func can_access_message(caller: Principal, message: Message) : Bool {
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        
        // Check if caller is sender (and has not removed themselves)
        if (is_active_sender(caller_index, message)) {
            return true;
        };
        
        // Check if caller is recipient
        for (recipient_index in message.recipients.vals()) {
            if (recipient_index == caller_index) {
                return true;
            };
        };
        
        false
    };

    private func convert_message_to_response(caller: Principal, message: Message) : ?MessageResponse {
        // Get sender principal (the anonymous principal marks a sender who removed themselves)
        let sender_principal = if (is_sender_removed(message.id)) {
            Principal.fromText("2vxsx-fae")
        } else {
            switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, message.sender)) {
                case (?p) p;
                case null return null; // Invalid sender index
            };
        };

        // Get recipient principals
        let recipients_buffer = Buffer.Buffer<Principal>(message.recipients.size());
        for (recipient_index in message.recipients.vals()) {
            switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, recipient_index)) {
                case (?p) recipients_buffer.add(p);
                case null {}; // Skip invalid recipient indices
            };
        };

        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let can_remove_self = is_active_sender(caller_index, message) or 
                             (Array.find<Nat32>(message.recipients, func(idx) = idx == caller_index) != null);

        ?{
            id = message.id;
            sender = sender_principal;
            recipients = Buffer.toArray(recipients_buffer);
            subject = message.subject;
            body = message.body;
            reply_to = message.reply_to;
            created_at = message.created_at;
            updated_at = message.updated_at;
            can_remove_self = can_remove_self;
        }
    };

    private func add_to_indexes(message_id: Nat, sender_index: Nat32, recipient_indices: [Nat32]) {
        // Add to sender index
        switch (Map.get(state.sender_messages, Map.n32hash, sender_index)) {
            case (?existing) Vector.add(existing, message_id);
            case null {
                let new_vector = Vector.new<Nat>();
                Vector.add(new_vector, message_id);
                Map.set(state.sender_messages, Map.n32hash, sender_index, new_vector);
            };
        };

        // Add to recipient indexes
        for (recipient_index in recipient_indices.vals()) {
            switch (Map.get(state.recipient_messages, Map.n32hash, recipient_index)) {
                case (?existing) Vector.add(existing, message_id);
                case null {
                    let new_vector = Vector.new<Nat>();
                    Vector.add(new_vector, message_id);
                    Map.set(state.recipient_messages, Map.n32hash, recipient_index, new_vector);
                };
            };
        };
    };

    private func remove_from_indexes(message_id: Nat, sender_index: Nat32, recipient_indices: [Nat32]) {
        remove_from_sender_index(message_id, sender_index);
        remove_from_recipient_indexes(message_id, recipient_indices);
    };

    private func remove_from_sender_index(message_id: Nat, sender_index: Nat32) {
        switch (Map.get(state.sender_messages, Map.n32hash, sender_index)) {
            case (?vector) {
                let new_vector = Vector.new<Nat>();
                for (id in Vector.vals(vector)) {
                    if (id != message_id) {
                        Vector.add(new_vector, id);
                    };
                };
                Map.set(state.sender_messages, Map.n32hash, sender_index, new_vector);
            };
            case null {};
        };
    };

    private func remove_from_recipient_indexes(message_id: Nat, recipient_indices: [Nat32]) {
        for (recipient_index in recipient_indices.vals()) {
            switch (Map.get(state.recipient_messages, Map.n32hash, recipient_index)) {
                case (?vector) {
                    let new_vector = Vector.new<Nat>();
                    for (id in Vector.vals(vector)) {
                        if (id != message_id) {
                            Vector.add(new_vector, id);
                        };
                    };
                    Map.set(state.recipient_messages, Map.n32hash, recipient_index, new_vector);
                };
                case null {};
            };
        };
    };

    // Public API endpoints

    // Admin management endpoints
    public shared ({ caller }) func add_admin(new_admin: Principal) : async Result<(), SMSError> {
        // Only admins (which includes the controllers and Sneed governance) add admins. There is no
        // "first admin" rule: an empty list must not let anyone in.
        if (not is_admin(caller)) {
            return #err(#Unauthorized("Only admins can add new admins"));
        };

        // Check if the principal is already an admin
        if (is_admin(new_admin)) {
            return #err(#AlreadyExists("Principal is already an admin"));
        };

        let admin_info : AdminInfo = {
            principal = new_admin;
            added_by = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
            added_at = Time.now();
        };

        Vector.add(state.admins, admin_info);
        block("admin_add", caller, [("principal", Icrc3Log.principal(new_admin))]);
        #ok()
    };

    public shared ({ caller }) func remove_admin(admin_to_remove: Principal) : async Result<(), SMSError> {
        // Check if caller is an admin
        if (not is_admin(caller)) {
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
        block("admin_remove", caller, [("principal", Icrc3Log.principal(admin_to_remove))]);

        #ok()
    };

    public query func get_admins() : async [AdminInfo] {
        Vector.toArray(state.admins)
    };

    public query func is_admin_query(principal: Principal) : async Bool {
        is_admin(principal)
    };

    // Configuration management
    public shared ({ caller }) func update_config(
        rate_limit_minutes: ?Nat,
        max_subject_length: ?Nat,
        max_body_length: ?Nat,
        max_recipients: ?Nat
    ) : async Result<(), SMSError> {
        if (not is_admin(caller)) {
            return #err(#Unauthorized("Only admins can update configuration"));
        };
        let o = { rate = state.config.rate_limit_minutes; subject = state.config.max_subject_length;
                  body = state.config.max_body_length; recipients = state.config.max_recipients };

        switch (rate_limit_minutes) {
            case (?minutes) state.config.rate_limit_minutes := minutes;
            case null {};
        };
        switch (max_subject_length) {
            case (?length) state.config.max_subject_length := length;
            case null {};
        };
        switch (max_body_length) {
            case (?length) state.config.max_body_length := length;
            case null {};
        };
        switch (max_recipients) {
            case (?count) state.config.max_recipients := count;
            case null {};
        };
        natChange(caller, "rate_limit_minutes", o.rate, state.config.rate_limit_minutes);
        natChange(caller, "max_subject_length", o.subject, state.config.max_subject_length);
        natChange(caller, "max_body_length", o.body, state.config.max_body_length);
        natChange(caller, "max_recipients", o.recipients, state.config.max_recipients);

        #ok()
    };

    public query func get_config() : async {
        rate_limit_minutes: Nat;
        max_subject_length: Nat;
        max_body_length: Nat;
        max_recipients: Nat;
    } {
        {
            rate_limit_minutes = state.config.rate_limit_minutes;
            max_subject_length = state.config.max_subject_length;
            max_body_length = state.config.max_body_length;
            max_recipients = state.config.max_recipients;
        }
    };

    // Premium configuration
    public query func get_premium_config() : async {
        sneed_premium_canister_id: ?Principal;
        premium_max_subject_length: Nat;
        premium_max_body_length: Nat;
        premium_rate_limit_minutes: Nat;
        premium_max_recipients: Nat;
    } {
        {
            sneed_premium_canister_id = stable_sneed_premium_canister_id;
            premium_max_subject_length = stable_premium_max_subject_length;
            premium_max_body_length = stable_premium_max_body_length;
            premium_rate_limit_minutes = stable_premium_rate_limit_minutes;
            premium_max_recipients = stable_premium_max_recipients;
        }
    };

    public shared ({ caller }) func update_premium_config(
        sneed_premium_canister_id: ??Principal, // null = no change, ?null = clear, ?(?id) = set
        premium_max_subject_length: ?Nat,
        premium_max_body_length: ?Nat,
        premium_rate_limit_minutes: ?Nat,
        premium_max_recipients: ?Nat
    ) : async Result<(), SMSError> {
        if (not is_admin(caller)) {
            return #err(#Unauthorized("Only admins can update premium configuration"));
        };
        let o = { id = stable_sneed_premium_canister_id; subject = stable_premium_max_subject_length; body = stable_premium_max_body_length;
                  rate = stable_premium_rate_limit_minutes; recipients = stable_premium_max_recipients };

        switch (sneed_premium_canister_id) {
            case (?opt_id) stable_sneed_premium_canister_id := opt_id;
            case null {}; // No change
        };
        switch (premium_max_subject_length) {
            case (?length) stable_premium_max_subject_length := length;
            case null {};
        };
        switch (premium_max_body_length) {
            case (?length) stable_premium_max_body_length := length;
            case null {};
        };
        switch (premium_rate_limit_minutes) {
            case (?minutes) stable_premium_rate_limit_minutes := minutes;
            case null {};
        };
        switch (premium_max_recipients) {
            case (?count) stable_premium_max_recipients := count;
            case null {};
        };
        principalChange(caller, "sneed_premium_canister_id", o.id, stable_sneed_premium_canister_id);
        natChange(caller, "premium_max_subject_length", o.subject, stable_premium_max_subject_length);
        natChange(caller, "premium_max_body_length", o.body, stable_premium_max_body_length);
        natChange(caller, "premium_rate_limit_minutes", o.rate, stable_premium_rate_limit_minutes);
        natChange(caller, "premium_max_recipients", o.recipients, stable_premium_max_recipients);

        #ok()
    };

    // ============================================
    // SYSTEM NOTIFICATION MANAGEMENT (for canister-to-user notifications)
    // ============================================
    
    // Check if a principal is an authorized system sender
    private func is_authorized_sender(principal : Principal) : Bool {
        for (p in stable_authorized_senders.vals()) {
            if (Principal.equal(p, principal)) return true;
        };
        false
    };
    
    // Get list of authorized senders (admin only)
    public query ({ caller }) func get_authorized_senders() : async Result<[Principal], SMSError> {
        if (not is_admin(caller)) {
            return #err(#Unauthorized("Only admins can view authorized senders"));
        };
        #ok(stable_authorized_senders)
    };
    
    // Add an authorized sender (admin only)
    public shared ({ caller }) func add_authorized_sender(sender : Principal) : async Result<(), SMSError> {
        if (not is_admin(caller)) {
            return #err(#Unauthorized("Only admins can add authorized senders"));
        };
        
        // Check if already authorized
        if (is_authorized_sender(sender)) {
            return #err(#AlreadyExists("Sender is already authorized"));
        };
        
        let buffer = Buffer.Buffer<Principal>(stable_authorized_senders.size() + 1);
        for (p in stable_authorized_senders.vals()) {
            buffer.add(p);
        };
        buffer.add(sender);
        stable_authorized_senders := Buffer.toArray(buffer);
        block("authorized_sender_add", caller, [("principal", Icrc3Log.principal(sender))]);
        
        #ok()
    };
    
    // Remove an authorized sender (admin only)
    public shared ({ caller }) func remove_authorized_sender(sender : Principal) : async Result<(), SMSError> {
        if (not is_admin(caller)) {
            return #err(#Unauthorized("Only admins can remove authorized senders"));
        };
        
        if (not is_authorized_sender(sender)) {
            return #err(#NotFound("Sender is not in authorized list"));
        };
        
        stable_authorized_senders := Array.filter<Principal>(stable_authorized_senders, func(p) = not Principal.equal(p, sender));
        block("authorized_sender_remove", caller, [("principal", Icrc3Log.principal(sender))]);
        #ok()
    };
    
    // Get/set system sender principal (the "from" address shown on system messages)
    public query func get_system_sender_principal() : async ?Principal {
        stable_system_sender_principal
    };
    
    public shared ({ caller }) func set_system_sender_principal(principal : ?Principal) : async Result<(), SMSError> {
        if (not is_admin(caller)) {
            return #err(#Unauthorized("Only admins can set system sender principal"));
        };
        let old = stable_system_sender_principal;
        stable_system_sender_principal := principal;
        principalChange(caller, "system_sender_principal", old, principal);
        #ok()
    };
    
    // System notification input type
    public type SystemNotificationInput = {
        recipients: [Principal];
        subject: Text;
        body: Text;
    };
    
    // Send a system notification (only authorized canisters can call this)
    // This bypasses rate limits and sends from the system sender principal
    public shared ({ caller }) func send_system_notification(input: SystemNotificationInput) : async Result<Nat, SMSError> {
        // Check if caller is authorized
        if (not is_authorized_sender(caller)) {
            return #err(#Unauthorized("Caller is not authorized to send system notifications"));
        };
        
        // Get system sender principal (fall back to caller if not set)
        let sender_principal = switch (stable_system_sender_principal) {
            case (?p) p;
            case null caller;
        };
        
        // Validate input (use premium limits for system messages)
        if (Text.size(input.subject) > stable_premium_max_subject_length) {
            return #err(#InvalidInput("Subject too long. Maximum is " # Nat.toText(stable_premium_max_subject_length)));
        };
        if (Text.size(input.body) > stable_premium_max_body_length) {
            return #err(#InvalidInput("Body too long. Maximum is " # Nat.toText(stable_premium_max_body_length)));
        };
        
        if (input.recipients.size() == 0) {
            return #err(#InvalidInput("At least one recipient is required"));
        };
        if (input.recipients.size() > stable_premium_max_recipients) {
            return #err(#InvalidInput("Too many recipients. Maximum is " # Nat.toText(stable_premium_max_recipients)));
        };
        
        let message_id = get_next_id();
        let current_time = Time.now();
        let sender_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, sender_principal);
        
        // Convert recipient principals to indices
        let recipient_indices_buffer = Buffer.Buffer<Nat32>(input.recipients.size());
        for (recipient in input.recipients.vals()) {
            let recipient_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, recipient);
            recipient_indices_buffer.add(recipient_index);
        };
        let recipient_indices = Buffer.toArray(recipient_indices_buffer);
        
        let message : Message = {
            id = message_id;
            sender = sender_index;
            recipients = recipient_indices;
            subject = input.subject;
            body = input.body;
            reply_to = null;
            created_at = current_time;
            updated_at = current_time;
        };
        
        Map.set(state.messages, Map.nhash, message_id, message);
        add_to_indexes(message_id, sender_index, recipient_indices);
        // Note: No rate limit update for system notifications
        
        #ok(message_id)
    };

    // Message management endpoints
    public shared ({ caller }) func send_message(input: CreateMessageInput) : async Result<Nat, SMSError> {
        // Reject anonymous callers
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Anonymous callers cannot send messages"));
        };

        // Premium members get the premium limits (checked before any state is read, since it may await)
        let is_premium = switch (stable_sneed_premium_canister_id) {
            case null false; // No premium canister configured
            case (?canisterId) {
                try {
                    await* PremiumClient.isPremium(stable_premium_cache, canisterId, caller)
                } catch (_) {
                    false // Premium canister unavailable: plain limits
                };
            };
        };
        let rate_limit_minutes = if (is_premium) stable_premium_rate_limit_minutes else state.config.rate_limit_minutes;
        let max_subject_length = if (is_premium) stable_premium_max_subject_length else state.config.max_subject_length;
        let max_body_length = if (is_premium) stable_premium_max_body_length else state.config.max_body_length;
        let max_recipients = if (is_premium) stable_premium_max_recipients else state.config.max_recipients;

        // Check rate limit
        switch (check_rate_limit(caller, rate_limit_minutes)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        // Validate input
        switch (validate_text(input.subject, "Subject", max_subject_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };
        switch (validate_text(input.body, "Body", max_body_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        if (input.recipients.size() == 0) {
            return #err(#InvalidInput("At least one recipient is required"));
        };
        if (input.recipients.size() > max_recipients) {
            return #err(#InvalidInput("Too many recipients. Maximum is " # Nat.toText(max_recipients)));
        };

        // Validate reply_to messages exist and caller has access to them
        switch (input.reply_to) {
            case (?reply_ids) {
                for (reply_id in reply_ids.vals()) {
                    switch (Map.get(state.messages, Map.nhash, reply_id)) {
                        case (?reply_message) {
                            if (not can_access_message(caller, reply_message)) {
                                return #err(#Unauthorized("Cannot reply to message " # Nat.toText(reply_id) # " - access denied"));
                            };
                        };
                        case null {
                            return #err(#NotFound("Reply message " # Nat.toText(reply_id) # " not found"));
                        };
                    };
                };
            };
            case null {};
        };

        let message_id = get_next_id();
        let current_time = Time.now();
        let sender_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);

        // Convert recipient principals to indices
        let recipient_indices_buffer = Buffer.Buffer<Nat32>(input.recipients.size());
        for (recipient in input.recipients.vals()) {
            let recipient_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, recipient);
            recipient_indices_buffer.add(recipient_index);
        };
        let recipient_indices = Buffer.toArray(recipient_indices_buffer);

        let message : Message = {
            id = message_id;
            sender = sender_index;
            recipients = recipient_indices;
            subject = input.subject;
            body = input.body;
            reply_to = input.reply_to;
            created_at = current_time;
            updated_at = current_time;
        };

        Map.set(state.messages, Map.nhash, message_id, message);
        add_to_indexes(message_id, sender_index, recipient_indices);
        update_user_message_time(caller);
        await* notify_recipients(caller, input.recipients, message_id, input.subject, input.body);

        #ok(message_id)
    };

    // ---- Sneed Notifications (person-to-person messages only) ----

    type NotifyInput = { user : Principal; topic : Text; title : Text; body : Text; link : ?Text; dedupe : ?Text; sponsored : Bool };
    type Notifications = actor { notify_batch : shared [NotifyInput] -> async [Any] };
    transient let MAX_NOTIFY_BATCH : Nat = 100; // what notify_batch takes
    transient let MAX_NOTIFY_SUBJECT : Nat = 200;
    transient let NOTIFY_PREVIEW_CHARS : Nat = 100;

    /// "abcde…xyz": a principal short enough for a title.
    private func short_principal(p : Principal) : Text {
        let cs = Text.toArray(Principal.toText(p));
        if (cs.size() <= 12) return Principal.toText(p);
        Text.fromIter(Array.subArray(cs, 0, 5).vals()) # "…" # Text.fromIter(Array.subArray(cs, cs.size() - 3, 3).vals())
    };

    /// Whether a (lowercase) token the preview limit cuts holds a link: it has http:// or https://
    /// in it (also inside Markdown, "[@Name](https://…"), or it is the start of one ("http",
    /// "https:/").
    private func isLinkPart(token : Text) : Bool {
        Text.contains(token, #text "http://") or Text.contains(token, #text "https://")
        or (token.size() >= 4 and (Text.startsWith("http://", #text token) or Text.startsWith("https://", #text token)))
    };

    /// At most `max` characters of `t`, "…" appended only when something was cut. The cut falls on
    /// the last whitespace before the limit, so no word is split; a token cut by the limit that
    /// holds a link (http:// or https://) is dropped whole, never left as a broken link. Only
    /// when there is no whitespace in the second half of the room (one long word) is the word cut
    /// at the limit, unless it is a link. Trailing whitespace goes; a preview that would hold only
    /// a partial link is empty.
    private func clip(t : Text, max : Nat) : Text {
        let cs = Text.toArray(t);
        if (cs.size() <= max) return t;
        var cut = max;
        if (not Char.isWhitespace(cs[max])) {
            // the token the limit cuts: from after the last whitespace before the limit
            var start = max;
            while (start > 0 and not Char.isWhitespace(cs[start - 1])) start -= 1;
            let token = Text.toLowercase(Text.fromIter(Array.subArray(cs, start, max - start).vals()));
            if (isLinkPart(token) or (start > 0 and start * 2 >= max)) cut := start;
        };
        while (cut > 0 and Char.isWhitespace(cs[cut - 1])) cut -= 1;
        if (cut == 0) return "";
        Text.fromIter(Array.subArray(cs, 0, cut).vals()) # "…"
    };

    /// A heads-up per recipient (each once, never the sender) through Sneed Notifications: who it
    /// is from, the subject, the start of the text (clip: at most 100 characters, no half links) (unless the recipient turned
    /// previews off with set_notification_preview(false)) and a link. Fire and forget, bounded: an
    /// unanswered call never holds up sending or upgrades. Called from send_message only, never
    /// for system messages.
    private func notify_recipients(sender : Principal, recipients : [Principal], message_id : Nat, subject : Text, text : Text) : async* () {
        let id = switch (stable_notifications) { case (?id) id; case null return };
        let items = Buffer.Buffer<NotifyInput>(recipients.size());
        let seen = Buffer.Buffer<Principal>(recipients.size());
        let title = "New message from " # short_principal(sender);
        let subjectLine = clip(subject, MAX_NOTIFY_SUBJECT);
        let preview = clip(text, NOTIFY_PREVIEW_CHARS);
        let withPreview = if (subjectLine == "") preview else if (preview == "") subjectLine else subjectLine # "\n" # preview;
        for (r in recipients.vals()) {
            if (r != sender and not Principal.isAnonymous(r) and items.size() < MAX_NOTIFY_BATCH
                and Buffer.indexOf<Principal>(r, seen, Principal.equal) == null) {
                seen.add(r);
                let body = if (Map.has(no_previews, Map.phash, r)) subjectLine else withPreview;
                items.add({ user = r; topic = "direct_message"; title; body;
                    link = ?("https://app.sneeddao.com/msg/" # Nat.toText(message_id));
                    dedupe = ?("sms-" # Nat.toText(message_id)); sponsored = false });
            };
        };
        if (items.size() == 0) return;
        let n : Notifications = actor (Principal.toText(id));
        ignore (with timeout = 60) n.notify_batch(Buffer.toArray(items));
    };

    /// Whether your new-message notifications show the start of the text (at most 100 characters) (default on).
    public shared ({ caller }) func set_notification_preview(on : Bool) : async Result<(), SMSError> {
        if (Principal.isAnonymous(caller)) return #err(#Unauthorized("Sign in first"));
        if (on) Map.delete(no_previews, Map.phash, caller) else Map.set(no_previews, Map.phash, caller, ());
        #ok(());
    };

    public query ({ caller }) func get_notification_preview() : async Bool {
        not Map.has(no_previews, Map.phash, caller);
    };

    /// Admins: the Sneed Notifications canister to tell recipients of new messages (null: off).
    public shared ({ caller }) func admin_set_notifications(canister : ?Principal) : async Result<(), SMSError> {
        if (not is_admin(caller)) return #err(#Unauthorized("Admins only"));
        let old = stable_notifications;
        stable_notifications := canister;
        principalChange(caller, "notifications_canister", old, canister);
        #ok()
    };

    public query func get_notifications_canister() : async ?Principal { stable_notifications };

    public query ({ caller }) func get_message(message_id: Nat) : async ?MessageResponse {
        switch (Map.get(state.messages, Map.nhash, message_id)) {
            case (?message) {
                if (can_access_message(caller, message)) {
                    convert_message_to_response(caller, message)
                } else {
                    null
                };
            };
            case null null;
        }
    };

    public query ({ caller }) func get_sent_messages() : async [MessageResponse] {
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let results = Buffer.Buffer<MessageResponse>(0);

        switch (Map.get(state.sender_messages, Map.n32hash, caller_index)) {
            case (?message_ids) {
                for (message_id in Vector.vals(message_ids)) {
                    switch (Map.get(state.messages, Map.nhash, message_id)) {
                        case (?message) {
                            switch (convert_message_to_response(caller, message)) {
                                case (?response) results.add(response);
                                case null {};
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };

        Buffer.toArray(results)
    };

    public query ({ caller }) func get_received_messages() : async [MessageResponse] {
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let results = Buffer.Buffer<MessageResponse>(0);

        switch (Map.get(state.recipient_messages, Map.n32hash, caller_index)) {
            case (?message_ids) {
                for (message_id in Vector.vals(message_ids)) {
                    switch (Map.get(state.messages, Map.nhash, message_id)) {
                        case (?message) {
                            switch (convert_message_to_response(caller, message)) {
                                case (?response) results.add(response);
                                case null {};
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };

        Buffer.toArray(results)
    };

    public query ({ caller }) func get_all_messages() : async [MessageResponse] {
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        let results = Buffer.Buffer<MessageResponse>(0);
        let seen_messages = Map.new<Nat, Bool>();

        // Add sent messages
        switch (Map.get(state.sender_messages, Map.n32hash, caller_index)) {
            case (?message_ids) {
                for (message_id in Vector.vals(message_ids)) {
                    Map.set(seen_messages, Map.nhash, message_id, true);
                    switch (Map.get(state.messages, Map.nhash, message_id)) {
                        case (?message) {
                            switch (convert_message_to_response(caller, message)) {
                                case (?response) results.add(response);
                                case null {};
                            };
                        };
                        case null {};
                    };
                };
            };
            case null {};
        };

        // Add received messages (avoiding duplicates)
        switch (Map.get(state.recipient_messages, Map.n32hash, caller_index)) {
            case (?message_ids) {
                for (message_id in Vector.vals(message_ids)) {
                    switch (Map.get(seen_messages, Map.nhash, message_id)) {
                        case (?_) {}; // Already added
                        case null {
                            switch (Map.get(state.messages, Map.nhash, message_id)) {
                                case (?message) {
                                    switch (convert_message_to_response(caller, message)) {
                                        case (?response) results.add(response);
                                        case null {};
                                    };
                                };
                                case null {};
                            };
                        };
                    };
                };
            };
            case null {};
        };

        Buffer.toArray(results)
    };

    public shared ({ caller }) func remove_self_from_message(message_id: Nat) : async Result<(), SMSError> {
        switch (Map.get(state.messages, Map.nhash, message_id)) {
            case (?message) {
                if (not can_access_message(caller, message)) {
                    return #err(#Unauthorized("Cannot access this message"));
                };

                let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                var new_recipients = Buffer.Buffer<Nat32>(message.recipients.size());
                var was_recipient = false;
                let sender_already_removed = is_sender_removed(message_id);
                let is_sender = message.sender == caller_index and not sender_already_removed;

                // Remove caller from recipients if present
                for (recipient_index in message.recipients.vals()) {
                    if (recipient_index == caller_index) {
                        was_recipient := true;
                    } else {
                        new_recipients.add(recipient_index);
                    };
                };

                if (not is_sender and not was_recipient) {
                    return #err(#InvalidInput("You are not associated with this message"));
                };

                let new_recipients_array = Buffer.toArray(new_recipients);
                // Does the sender remain on the message after the caller leaves?
                let sender_remains = not sender_already_removed and not is_sender;

                if (not sender_remains and new_recipients_array.size() == 0) {
                    // No one left: delete the message
                    if (not sender_already_removed) {
                        remove_from_sender_index(message_id, message.sender);
                    };
                    remove_from_recipient_indexes(message_id, message.recipients);
                    Map.delete(state.messages, Map.nhash, message_id);
                    Map.delete(stable_sender_removed, Map.nhash, message_id);
                } else {
                    // Remove only the caller's own index entries
                    if (is_sender) {
                        remove_from_sender_index(message_id, caller_index);
                        // Keep the stored sender index, but mark the sender as removed: they lose access
                        // and are shown as the anonymous principal. Never hand the slot to another user.
                        Map.set(stable_sender_removed, Map.nhash, message_id, true);
                    };
                    if (was_recipient) {
                        remove_from_recipient_indexes(message_id, [caller_index]);
                    };

                    let updated_message : Message = {
                        id = message.id;
                        sender = message.sender;
                        recipients = new_recipients_array;
                        subject = message.subject;
                        body = message.body;
                        reply_to = message.reply_to;
                        created_at = message.created_at;
                        updated_at = Time.now();
                    };
                    Map.set(state.messages, Map.nhash, message_id, updated_message);
                };

                #ok()
            };
            case null #err(#NotFound("Message not found"));
        }
    };

    // Statistics and admin queries
    public query func get_stats() : async {
        total_messages: Nat;
        total_users: Nat;
    } {
        {
            total_messages = Map.size(state.messages);
            total_users = Vector.size(state.principal_dedup_state.blobs);
        }
    };

    public query ({ caller }) func get_all_messages_admin() : async [MessageResponse] {
        if (not is_admin(caller)) {
            return [];
        };

        let results = Buffer.Buffer<MessageResponse>(Map.size(state.messages));
        for ((_, message) in Map.entries(state.messages)) {
            switch (convert_message_to_response(caller, message)) {
                case (?response) results.add(response);
                case null {};
            };
        };

        Buffer.toArray(results)
    };

    // ============================================================================
    // DATA IMPORT - For restoring data after migration
    // ============================================================================
    
    // Import admins from backup - accepts exact output of get_admins()
    public shared ({ caller }) func import_admins(admins_to_import: [AdminInfo]) : async Result<Nat, SMSError> {
        // Only controllers can import
        if (not Principal.isController(caller)) {
            return #err(#Unauthorized("Only controllers can import data"));
        };
        
        var imported = 0;
        for (admin_info in admins_to_import.vals()) {
            // Skip if already admin
            if (not is_admin(admin_info.principal)) {
                Vector.add(state.admins, admin_info);
                block("admin_add", caller, [("principal", Icrc3Log.principal(admin_info.principal)), ("source", #Text("import_admins"))]);
                imported += 1;
            };
        };
        
        #ok(imported)
    };
    
    // Import messages from backup (accepts MessageResponse format from get_all_messages_admin)
    public shared ({ caller }) func import_messages(messages_to_import: [MessageResponse]) : async Result<Nat, SMSError> {
        // Only controllers can import
        if (not Principal.isController(caller)) {
            return #err(#Unauthorized("Only controllers can import data"));
        };
        
        var imported = 0;
        for (msg in messages_to_import.vals()) {
            // Skip if message ID already exists
            switch (Map.get(state.messages, Map.nhash, msg.id)) {
                case (?_) {}; // Already exists, skip
                case null {
                    // Convert sender principal to index
                    let sender_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, msg.sender);
                    
                    // Convert recipient principals to indices
                    let recipient_indices_buffer = Buffer.Buffer<Nat32>(msg.recipients.size());
                    for (recipient in msg.recipients.vals()) {
                        let recipient_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, recipient);
                        recipient_indices_buffer.add(recipient_index);
                    };
                    let recipient_indices = Buffer.toArray(recipient_indices_buffer);
                    
                    // Create message with internal format
                    let message : Message = {
                        id = msg.id;
                        sender = sender_index;
                        recipients = recipient_indices;
                        subject = msg.subject;
                        body = msg.body;
                        reply_to = msg.reply_to;
                        created_at = msg.created_at;
                        updated_at = msg.updated_at;
                    };
                    
                    // Store message
                    Map.set(state.messages, Map.nhash, msg.id, message);
                    
                    // Rebuild indexes
                    add_to_indexes(msg.id, sender_index, recipient_indices);
                    
                    // Update next_id if needed
                    if (msg.id >= state.next_id) {
                        state.next_id := msg.id + 1;
                    };
                    
                    imported += 1;
                };
            };
        };
        // how many, never what: the messages' contents and parties stay out of the log
        if (imported > 0) block("messages_import", caller, [("count", #Nat(imported)), ("next_id", #Nat(state.next_id))]);
        
        #ok(imported)
    };

    // Notification functions
    public query func get_recent_messages_count(user_principal: Principal) : async Nat {
        let user_index_opt = Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal);
        let user_index = switch (user_index_opt) {
            case (?index) index;
            case null return 0;
        };

        let last_seen_opt = Map.get(state.user_last_seen_messages_timestamp, Map.n32hash, user_index);
        let last_seen = switch (last_seen_opt) {
            case (?timestamp) timestamp;
            case null 0;
        };

        let recipient_messages_opt = Map.get(state.recipient_messages, Map.n32hash, user_index);
        let recipient_messages = switch (recipient_messages_opt) {
            case (?messages) messages;
            case null return 0;
        };

        var count = 0;
        for (message_id in Vector.vals(recipient_messages)) {
            switch (Map.get(state.messages, Map.nhash, message_id)) {
                case (?message) {
                    if (message.created_at > last_seen) {
                        count += 1;
                    };
                };
                case null {};
            };
        };

        count
    };

    public shared ({ caller }) func mark_messages_seen_up_to(timestamp: Int) : async () {
        let user_index_opt = Dedup.getIndexForPrincipal(state.principal_dedup_state, caller);
        let user_index = switch (user_index_opt) {
            case (?index) index;
            case null return;
        };

        ignore Map.put(state.user_last_seen_messages_timestamp, Map.n32hash, user_index, timestamp);
    };

    public query func get_last_seen_messages_timestamp(user_principal: Principal) : async ?Int {
        let user_index_opt = Dedup.getIndexForPrincipal(state.principal_dedup_state, user_principal);
        let user_index = switch (user_index_opt) {
            case (?index) index;
            case null return null;
        };

        Map.get(state.user_last_seen_messages_timestamp, Map.n32hash, user_index)
    };

    // ---- ICRC-3 interface (spec/sms_icrc3.md) ----

    public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Icrc3Log.getBlocks(icrc3, args) };
    public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Icrc3Log.getArchives(icrc3, args) };
    public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Icrc3Log.tipCertificate(icrc3) };
    public query func icrc3_supported_block_types() : async [T3.BlockType] { Icrc3Log.supportedBlockTypes(icrc3_catalogue) };
    public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Icrc3Log.supportedStandards() };
    public query func icrc3_log_status() : async T3.LogStatus { Icrc3Log.status(icrc3, icrc3_rt) };

    public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
        if (not is_admin(caller)) return #Err("Admins only");
        switch (Icrc3Log.applySettings(icrc3, u)) {
            case (#Err(e)) #Err(e);
            case (#Ok(changes)) {
                for ((key, old, new) in changes.vals()) configBlock(caller, key, #Nat(old), #Nat(new));
                #Ok(icrc3.settings);
            };
        };
    };

    public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
        if (not is_admin(caller)) return #Err("Admins only");
        if (icrc3_rt.spilling) return #Err("A spill is already in progress");
        #Ok(await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
    };

    public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
        if (not is_admin(caller)) Debug.trap("Admins only");
        await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
    };

    /// Admins: the log's operational messages (spills, archives created, failures), oldest first.
    public query ({ caller }) func get_log(start : Nat, length : Nat) : async [NT.LogEntry] {
        if (not is_admin(caller)) Debug.trap("Admins only");
        TextLog.get(icrc3_textlog, start, length);
    };

    func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };
    func ensure_icrc3_timer<system>() { Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job) };

    // Limit of the ingress guard below: a reply names the message(s) it answers
    transient let MAX_REPLY_TO : Nat = 100;

    // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
    // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
    public query func get_api_doc() : async Text { ApiDoc.text };

    // Ingress guard (src/IngressGuard.mo): queries are never accepted as update calls, which
    // would go through consensus at our cost, and arguments are capped in size.
    system func inspect({ caller : Principal; arg : Blob; msg : {
        #get_api_doc : Any;
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
        #add_authorized_sender : Any;
        #admin_set_notifications : Any;
        #set_notification_preview : Any;
        #get_notification_preview : Any;
        #get_admins : Any;
        #get_all_messages : Any;
        #get_all_messages_admin : Any;
        #get_authorized_senders : Any;
        #get_config : Any;
        #get_last_seen_messages_timestamp : Any;
        #get_message : Any;
        #get_notifications_canister : Any;
        #get_premium_config : Any;
        #get_received_messages : Any;
        #get_recent_messages_count : Any;
        #get_sent_messages : Any;
        #get_stats : Any;
        #get_system_sender_principal : Any;
        #import_admins : Any;
        #import_messages : Any;
        #is_admin_query : Any;
        #mark_messages_seen_up_to : Any;
        #remove_admin : Any;
        #remove_authorized_sender : Any;
        #remove_self_from_message : Any;
        #send_message : () -> CreateMessageInput;
        #send_system_notification : () -> SystemNotificationInput;
        #set_system_sender_principal : Any;
        #update_config : Any;
        #update_premium_config : Any;
    } }) : Bool {
        switch (msg) {
            case (
                #get_api_doc _
                or #get_admins _
                or #get_all_messages _
                or #get_all_messages_admin _
                or #get_authorized_senders _
                or #get_config _
                or #get_last_seen_messages_timestamp _
                or #get_message _
                or #get_notifications_canister _
                or #get_notification_preview _
                or #get_premium_config _
                or #get_received_messages _
                or #get_recent_messages_count _
                or #get_sent_messages _
                or #get_stats _
                or #get_system_sender_principal _
                or #is_admin_query _
                or #get_log _
                or #icrc10_supported_standards _
                or #icrc3_get_archives _
                or #icrc3_get_blocks _
                or #icrc3_get_tip_certificate _
                or #icrc3_log_status _
                or #icrc3_supported_block_types _
            ) false;
            // the log's admin methods: admins only, small arguments
            case (#admin_icrc3_repair_archive_controllers _ or #admin_icrc3_spill_now _ or #admin_set_icrc3_settings _) is_admin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
            // against the configured limits; a member may use the premium ones (the method decides)
            case (#send_message f) {
                let i = f();
                let premium = stable_sneed_premium_canister_id != null;
                let maxSubject = if premium Nat.max(state.config.max_subject_length, stable_premium_max_subject_length) else state.config.max_subject_length;
                let maxBody = if premium Nat.max(state.config.max_body_length, stable_premium_max_body_length) else state.config.max_body_length;
                let maxRecipients = if premium Nat.max(state.config.max_recipients, stable_premium_max_recipients) else state.config.max_recipients;
                let replies = switch (i.reply_to) { case null 0; case (?ids) ids.size() };
                replies <= MAX_REPLY_TO and i.recipients.size() <= maxRecipients
                and arg.size() <= IngressGuard.textArg(maxSubject + maxBody) + 32 * (maxRecipients + replies)
                and IngressGuard.text(i.subject, maxSubject) and IngressGuard.text(i.body, maxBody)
            };
            case (#send_system_notification f) {
                let i = f();
                i.recipients.size() <= stable_premium_max_recipients
                and arg.size() <= IngressGuard.textArg(stable_premium_max_subject_length + stable_premium_max_body_length) + 32 * stable_premium_max_recipients
                and IngressGuard.text(i.subject, stable_premium_max_subject_length) and IngressGuard.text(i.body, stable_premium_max_body_length)
            };
            // data migration by controllers: as large as an ingress message may be
            case (#import_admins _ or #import_messages _) Principal.isController(caller);
            case _ arg.size() <= IngressGuard.SMALL_ARG;
        };
    };

    ensure_icrc3_timer<system>();
}
