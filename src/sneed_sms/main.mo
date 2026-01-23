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

actor SneedSMS {
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

    // Stable storage
    var stable_next_id: Nat = 1;
    let stable_messages = Map.new<Nat, Message>();
    let stable_admins = Vector.new<AdminInfo>();
    var stable_principal_dedup : Dedup.DedupState = Dedup.empty();
    let stable_sender_messages = Map.new<Nat32, Vector.Vector<Nat>>();
    let stable_recipient_messages = Map.new<Nat32, Vector.Vector<Nat>>();
    let stable_user_last_message_time = Map.new<Nat32, Int>();
    let stable_user_last_seen_messages_timestamp = Map.new<Nat32, Int>();
    var stable_config : SMSConfig = {
        var rate_limit_minutes = 10;
        var max_subject_length = 200;
        var max_body_length = 5000;
        var max_recipients = 20;
    };

    // Runtime state that directly references stable storage
    private transient var state : SMSState = {
        var next_id = stable_next_id;
        var config = stable_config;
        messages = stable_messages;
        admins = stable_admins;
        principal_dedup_state = stable_principal_dedup;
        sender_messages = stable_sender_messages;
        recipient_messages = stable_recipient_messages;
        user_last_message_time = stable_user_last_message_time;
        user_last_seen_messages_timestamp = stable_user_last_seen_messages_timestamp;
    };

    // System functions
    system func preupgrade() {
        stable_next_id := state.next_id;
        stable_config := state.config;
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

    private func check_rate_limit(caller: Principal) : Result<(), SMSError> {
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
                if (time_diff_minutes < state.config.rate_limit_minutes) {
                    let remaining_minutes = if (state.config.rate_limit_minutes >= time_diff_minutes) {
                        state.config.rate_limit_minutes - time_diff_minutes
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

    private func can_access_message(caller: Principal, message: Message) : Bool {
        let caller_index = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
        
        // Check if caller is sender
        if (message.sender == caller_index) {
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
        // Get sender principal
        let sender_principal = switch (Dedup.getPrincipalForIndex(state.principal_dedup_state, message.sender)) {
            case (?p) p;
            case null return null; // Invalid sender index
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
        let can_remove_self = (message.sender == caller_index) or 
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
        // Remove from sender index
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

        // Remove from recipient indexes
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
        // Check if caller is already an admin (or if this is the first admin)
        if (Vector.size(state.admins) > 0 and not is_admin(caller)) {
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

    // Message management endpoints
    public shared ({ caller }) func send_message(input: CreateMessageInput) : async Result<Nat, SMSError> {
        // Reject anonymous callers
        if (Principal.isAnonymous(caller)) {
            return #err(#Unauthorized("Anonymous callers cannot send messages"));
        };

        // Check rate limit
        switch (check_rate_limit(caller)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        // Validate input
        switch (validate_text(input.subject, "Subject", state.config.max_subject_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };
        switch (validate_text(input.body, "Body", state.config.max_body_length)) {
            case (#err(e)) return #err(e);
            case (#ok()) {};
        };

        if (input.recipients.size() == 0) {
            return #err(#InvalidInput("At least one recipient is required"));
        };
        if (input.recipients.size() > state.config.max_recipients) {
            return #err(#InvalidInput("Too many recipients. Maximum is " # Nat.toText(state.config.max_recipients)));
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

        #ok(message_id)
    };

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
                var is_sender = message.sender == caller_index;

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

                // If caller is sender and there are still recipients, just remove from sender index
                if (is_sender and new_recipients_array.size() > 0) {
                    // Remove from sender index only
                    remove_from_indexes(message_id, caller_index, []);
                    
                    // Update message to remove sender (set to anonymous-like index)
                    let updated_message : Message = {
                        id = message.id;
                        sender = 0; // Use 0 as "removed sender" marker
                        recipients = new_recipients_array;
                        subject = message.subject;
                        body = message.body;
                        reply_to = message.reply_to;
                        created_at = message.created_at;
                        updated_at = Time.now();
                    };
                    Map.set(state.messages, Map.nhash, message_id, updated_message);
                }
                // If caller was recipient, update message
                else if (was_recipient and (not is_sender or new_recipients_array.size() > 0)) {
                    // Remove from recipient index only
                    remove_from_indexes(message_id, 0, [caller_index]);
                    
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
                }
                // If no one left (sender removed and no recipients, or sender was only recipient), delete message
                else {
                    remove_from_indexes(message_id, message.sender, message.recipients);
                    Map.delete(state.messages, Map.nhash, message_id);
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
    
    // Import admins from backup
    public shared ({ caller }) func import_admins(admins_to_import: [Principal]) : async Result<Nat, SMSError> {
        // Only controllers can import
        if (not Principal.isController(caller)) {
            return #err(#Unauthorized("Only controllers can import data"));
        };
        
        var imported = 0;
        for (admin_principal in admins_to_import.vals()) {
            // Skip if already admin
            if (not is_admin(admin_principal)) {
                let admin_info : AdminInfo = {
                    principal = admin_principal;
                    added_by = Dedup.getOrCreateIndexForPrincipal(state.principal_dedup_state, caller);
                    added_at = Time.now();
                };
                Vector.add(state.admins, admin_info);
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
}
