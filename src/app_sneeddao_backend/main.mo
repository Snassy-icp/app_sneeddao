import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import List "mo:base/List";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Result "mo:base/Result";
import Buffer "mo:base/Buffer";
import Error "mo:base/Error";
import Time "mo:base/Time";
import Int "mo:base/Int";

import T "Types";

shared (deployer) actor class AppSneedDaoBackend() = this {

  private func this_canister_id() : Principal {
      Principal.fromActor(this);
  };
  
  let SWAPRUNNER_CANISTER_ID : Text = "tt72q-zqaaa-aaaaj-az4va-cai";

  // aliases
  type State = T.State;
  type StablePrincipalSwapCanisters = T.StablePrincipalSwapCanisters;
  type StablePrincipalLedgerCanisters = T.StablePrincipalLedgerCanisters;
  type SwapRunnerTokenMetadata = T.SwapRunnerTokenMetadata;
  type NeuronId = T.NeuronId;
  type NeuronName = T.NeuronName;
  type NeuronNickname = T.NeuronNickname;
  type NeuronNameKey = T.NeuronNameKey;

  // Token whitelist types
  type WhitelistedToken = {
    ledger_id: Principal;
    decimals: Nat8;
    fee: Nat;
    name: Text;
    symbol: Text;
    standard: Text;
  };

  // Ban types
  type BanLogEntry = {
    user: Principal;
    admin: Principal;
    ban_timestamp: Int;
    expiry_timestamp: Int;
    reason: Text;
  };

  // stable memory
  stable var stable_principal_swap_canisters : StablePrincipalSwapCanisters = [];
  stable var stable_principal_ledger_canisters : StablePrincipalLedgerCanisters = [];
  stable var stable_whitelisted_tokens : [WhitelistedToken] = [];
  stable var stable_admins : [Principal] = [deployer.caller];
  stable var stable_blacklisted_words : [(Text, Bool)] = [];

  // Stable storage for neuron names and nicknames
  stable var stable_neuron_names : [(NeuronNameKey, (Text, Bool))] = [];
  stable var stable_neuron_nicknames : [(Principal, [(NeuronNameKey, Text)])] = [];

  // Stable storage for bans
  stable var stable_ban_log : [BanLogEntry] = [];
  stable var stable_banned_users : [(Principal, Int)] = [];

  // Stable storage for principal names and nicknames
  stable var stable_principal_names : [(Principal, (Text, Bool))] = [];
  stable var stable_principal_nicknames : [(Principal, [(Principal, Text)])] = [];

  // Runtime hashmaps for neuron names and nicknames
  var neuron_names = HashMap.HashMap<NeuronNameKey, (Text, Bool)>(100, func(k1: NeuronNameKey, k2: NeuronNameKey) : Bool {
    Principal.equal(k1.sns_root_canister_id, k2.sns_root_canister_id) and Blob.equal(k1.neuron_id.id, k2.neuron_id.id)
  }, func(k: NeuronNameKey) : Nat32 {
    let h1 = Principal.hash(k.sns_root_canister_id);
    let h2 = Blob.hash(k.neuron_id.id);
    h1 ^ h2
  });

  var neuron_nicknames = HashMap.HashMap<Principal, HashMap.HashMap<NeuronNameKey, Text>>(100, Principal.equal, Principal.hash);

  var cached_token_meta : HashMap.HashMap<Principal, T.TokenMeta> = HashMap.HashMap<Principal, T.TokenMeta>(100, Principal.equal, Principal.hash);
  var whitelisted_tokens : HashMap.HashMap<Principal, WhitelistedToken> = HashMap.HashMap<Principal, WhitelistedToken>(10, Principal.equal, Principal.hash);
  var admins : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(10, Principal.equal, Principal.hash);

  // Add after other runtime variables
  private var blacklisted_words = HashMap.fromIter<Text, Bool>(
    stable_blacklisted_words.vals(),
    0,
    Text.equal,
    Text.hash
  );

  // Runtime storage for bans
  private var ban_log = Buffer.Buffer<BanLogEntry>(0);
  private var banned_users = HashMap.HashMap<Principal, Int>(0, Principal.equal, Principal.hash);

  // Runtime hashmaps for principal names and nicknames
  var principal_names = HashMap.HashMap<Principal, (Text, Bool)>(100, Principal.equal, Principal.hash);
  var principal_nicknames = HashMap.HashMap<Principal, HashMap.HashMap<Principal, Text>>(100, Principal.equal, Principal.hash);

  // ephemeral state
  let state : State = object { 
    // initialize as empty here, see postupgrade for how to populate from stable memory
    public let principal_swap_canisters: HashMap.HashMap<Principal, List.List<Principal>> = HashMap.HashMap<Principal, List.List<Principal>>(100, Principal.equal, Principal.hash);
    public let principal_ledger_canisters: HashMap.HashMap<Principal, List.List<Principal>> = HashMap.HashMap<Principal, List.List<Principal>>(100, Principal.equal, Principal.hash);
  };

  // SwapRunner actor
  let swaprunner = actor(SWAPRUNNER_CANISTER_ID) : actor {
    get_whitelisted_tokens : shared query () -> async [(Principal, SwapRunnerTokenMetadata)];
    get_all_tokens : shared query () -> async [(Principal, SwapRunnerTokenMetadata)];
  };

  // Admin management functions
  public shared ({ caller }) func add_admin(principal: Principal) : async () {
    assert(is_admin(caller));
    admins.put(principal, true);
  };

  public shared ({ caller }) func remove_admin(principal: Principal) : async () {
    assert(is_admin(caller) and principal != deployer.caller);
    admins.delete(principal);
  };

  public query func get_admins() : async [Principal] {
    Iter.toArray(admins.keys());
  };

  func is_admin(principal: Principal) : Bool {
    if (Principal.isAnonymous(principal)) {
      return false;
    };
    if (principal == deployer.caller) {
      return true;
    };
    if (Principal.isController(principal)) {
      return true;
    };
    switch (admins.get(principal)) {
      case (?_) true;
      case null false;
    };
  };

  // Add public query function for admin check
  public query ({ caller }) func caller_is_admin() : async Bool {
    is_admin(caller)
  };

  // Whitelist management functions
  public shared ({ caller }) func add_whitelisted_token(token: WhitelistedToken) : async () {
    // Only allow the deployer to add whitelisted tokens
    assert(is_admin(caller));
    whitelisted_tokens.put(token.ledger_id, token);
  };

  public shared ({ caller }) func remove_whitelisted_token(ledger_id: Principal) : async () {
    assert(is_admin(caller));
    whitelisted_tokens.delete(ledger_id);
  };

  public query func get_whitelisted_tokens() : async [WhitelistedToken] {
    Iter.toArray(whitelisted_tokens.vals());
  };

  public query func is_token_whitelisted(ledger_id: Principal) : async Bool {
    whitelisted_tokens.get(ledger_id) != null;
  };

  public query func get_cached_token_meta(swap_canister_id : Principal) : async ?T.TokenMeta { 
    cached_token_meta.get(swap_canister_id); 
  };

  public shared func set_cached_token_meta(swap_canister_id : Principal, new_token_meta : T.TokenMeta) : async () {
    cached_token_meta.put(swap_canister_id, new_token_meta);
  };

  public shared ({ caller }) func register_swap_canister_id(icrc1_swap_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let swapCanisters = switch (state.principal_swap_canisters.get(principal)) {
      case (?existingSwapCanisters) existingSwapCanisters;
      case _ List.nil<Principal>();
    };

    if (List.some<Principal>(swapCanisters, func swapCanister { swapCanister == icrc1_swap_canister_id; } )) {
      return;
    };

    let newSwapCanisters = List.push<Principal>(icrc1_swap_canister_id, swapCanisters);
    state.principal_swap_canisters.put(principal, newSwapCanisters);
  };

  public shared ({ caller }) func unregister_swap_canister_id(icrc1_swap_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let swapCanisters = switch (state.principal_swap_canisters.get(principal)) {
      case (?existingSwapCanisters) existingSwapCanisters;
      case _ List.nil<Principal>();
    };

    let newSwapCanisters = List.filter<Principal>(swapCanisters, func test_swap_canister { test_swap_canister != icrc1_swap_canister_id; });
    state.principal_swap_canisters.put(principal, newSwapCanisters);
  };

  public shared ({ caller }) func register_ledger_canister_id(icrc1_ledger_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let ledgerCanisters = switch (state.principal_ledger_canisters.get(principal)) {
      case (?existingLedgerCanisters) existingLedgerCanisters;
      case _ List.nil<Principal>();
    };

    if (List.some<Principal>(ledgerCanisters, func ledgerCanister { ledgerCanister == icrc1_ledger_canister_id; } )) {
      return;
    };

    let newLedgerCanisters = List.push<Principal>(icrc1_ledger_canister_id, ledgerCanisters);
    state.principal_ledger_canisters.put(principal, newLedgerCanisters);
  };

  public shared ({ caller }) func unregister_ledger_canister_id(icrc1_ledger_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let ledgerCanisters = switch (state.principal_ledger_canisters.get(principal)) {
      case (?existingLedgerCanisters) existingLedgerCanisters;
      case _ List.nil<Principal>();
    };

    let newLedgerCanisters = List.filter<Principal>(ledgerCanisters, func test_ledger_canister { test_ledger_canister != icrc1_ledger_canister_id; });
    state.principal_ledger_canisters.put(principal, newLedgerCanisters);
  };

  public query ({ caller }) func get_swap_canister_ids() : async [Principal] {
    let principal = caller;
    switch (state.principal_swap_canisters.get(principal)) {
      case (?existingSwapCanisters) List.toArray<Principal>(existingSwapCanisters);
      case _ [] : [Principal];
    };
  };

  public query ({ caller }) func get_ledger_canister_ids() : async [Principal] {
    let principal = caller;
    switch (state.principal_ledger_canisters.get(principal)) {
      case (?existingLedgerCanisters) List.toArray<Principal>(existingLedgerCanisters);
      case _ [] : [Principal];
    };
  };

  public shared ({ caller }) func import_whitelist_from_swaprunner() : async () {
    assert(is_admin(caller));
    
    let tokens = await swaprunner.get_all_tokens();
    for ((ledger_id, metadata) in tokens.vals()) {
      switch (metadata.decimals, metadata.fee, metadata.name, metadata.symbol) {
        case (?decimals, ?fee, ?name, ?symbol) {
          let token : WhitelistedToken = {
            ledger_id = ledger_id;
            decimals = decimals;
            fee = fee;
            name = name;
            symbol = symbol;
            standard = metadata.standard;
          };
          whitelisted_tokens.put(ledger_id, token);
        };
        case _ { /* Skip tokens with missing required metadata */ };
      };
    };
  };

  public shared ({ caller }) func send_tokens(icrc1_ledger_canister_id: Principal, amount: Nat, to: Principal) : async T.TransferResult {
    assert(is_admin(caller));

    let from_subaccount = PrincipalToSubaccount(to);

    let transfer_args : T.TransferArgs = {
        from_subaccount = ?from_subaccount;
        to = {
            owner = to;
            subaccount = null;
        };
        amount = amount;
        fee = null;
        memo = null;
        created_at_time = null;
    };


    let icrc1_ledger_canister = actor (Principal.toText(icrc1_ledger_canister_id)) : actor {
        icrc1_transfer(args : T.TransferArgs) : async T.TransferResult;
    };  

    await icrc1_ledger_canister.icrc1_transfer(transfer_args);
  };

  public shared ({ caller }) func transfer_position(swap_canister_id: Principal, to: Principal, position_id: Nat) : async T.TransferPositionResult {
    assert(is_admin(caller));

    let swap_canister = actor (Principal.toText(swap_canister_id)) : actor {
        transferPosition(from : Principal, to : Principal, positionId : Nat) : async T.TransferPositionResult;
    };

    await swap_canister.transferPosition(this_canister_id(), to, position_id);
  };


  private func PrincipalToSubaccount(p : Principal) : [Nat8] {
    //let a = List.nil<Nat8>();
    let pa = Principal.toBlob(p);
    let size = pa.size();
    let arr_size = if (size < 31) { 31; } else { size; };
    let a = Array.init<Nat8>(arr_size + 1, 0);
    a[0] := Nat8.fromNat(size);

    var pos = 1;
    for (x in pa.vals()) {
      a[pos] := x;
      pos := pos + 1;
    };

    Array.freeze(a);
  };

  // Helper function to get SNS governance canister from root canister
  private func get_sns_governance_canister(sns_root_canister_id : Principal) : async Principal {
    let sns_root = actor (Principal.toText(sns_root_canister_id)) : actor {
      list_sns_canisters : ({}) -> async {
        root : ?Principal;
        governance : ?Principal;
        ledger : ?Principal;
        swap : ?Principal;
        index : ?Principal;
        dapps : [Principal];
        archives : [Principal];
      };
    };
    let canisters = await sns_root.list_sns_canisters({});
    switch (canisters.governance) {
      case (?governance) { governance };
      case null { throw Error.reject("Could not find governance canister") };
    }
  };

  // Helper function to check if caller owns a neuron
  private func is_neuron_owner(caller : Principal, sns_governance_canister_id : Principal, neuron_id : NeuronId) : async Bool {
    if (is_admin(caller)) { return true; };

    let sns_governance = actor (Principal.toText(sns_governance_canister_id)) : actor {
      list_neurons : shared query ({
        of_principal : ?Principal;
        limit : Nat32;
        start_page_at : ?NeuronId;
      }) -> async {
        neurons : [{
          id : ?NeuronId;
          controller : ?Principal;
        }];
      };
    };

    let response = await sns_governance.list_neurons({
      of_principal = ?caller;
      limit = 100;
      start_page_at = null;
    });
    
    for (neuron in response.neurons.vals()) {
      switch (neuron.id) {
        case (?id) {
          if (Blob.equal(id.id, neuron_id.id)) {
            return true;
          };
        };
        case null {};
      };
    };
    false
  };

  // Helper function to check if caller is authorized to verify names
  private func can_verify_names(caller : Principal, sns_root_canister_id : Principal) : async Bool {
    if (is_admin(caller)) { return true; };
    
    // Check if caller is the SNS governance canister for this root
    let governance_canister_id = await get_sns_governance_canister(sns_root_canister_id);
    Principal.equal(caller, governance_canister_id)
  };

  // Helper function to validate name text
  private func validate_name_text(text: Text) : async* Result.Result<Bool, (Text, Text)> {
    if (text.size() > 32) {
      return #ok(false);
    };

    // Check characters
    for (char in text.chars()) {
      let isAlphanumeric = (char >= 'a' and char <= 'z') or
                          (char >= 'A' and char <= 'Z') or
                          (char >= '0' and char <= '9');
      let isSeparator = char == ' ' or char == '-' or char == '_' or char == '.' or char == '\'';
      
      if (not (isAlphanumeric or isSeparator)) {
        return #ok(false);
      };
    };

    // Check blacklist last so any other errors are caught if the blacklist is ignored by caller.
    // Check if text contains any blacklisted words (case insensitive)
    let lowercaseText = Text.toLowercase(text);
    for ((word, _) in blacklisted_words.entries()) {
      let lowercaseWord = Text.toLowercase(word);
      if (Text.contains(lowercaseText, #text lowercaseWord)) {
        // Found a blacklisted word - return it along with the full text for the ban reason
        return #err(word, text);
      };
    };

    return #ok(true);
  };

  // Helper function to check if a name is unique
  private func is_name_unique(sns_root_canister_id : Principal, name : Text, exclude_neuron : ?NeuronId) : Bool {
    for ((key, (existing_name, _)) in neuron_names.entries()) {
        if (Principal.equal(key.sns_root_canister_id, sns_root_canister_id) and 
            Text.equal(existing_name, name)) {
            // If we're excluding a neuron (e.g. when updating), check it's not that one
            switch (exclude_neuron) {
                case (?neuron_id) {
                    if (Blob.equal(key.neuron_id.id, neuron_id.id)) {
                        // Skip if this is the neuron we're updating
                        return true;
                    };
                };
                case null {};
            };
            // Found a match that's not our excluded neuron
            return false;
        };
    };
    // No matches found
    true
  };

  // Helper function to check if a user is banned
  private func is_banned(user: Principal) : Bool {
    switch (banned_users.get(user)) {
      case (?expiry) {
        let now = Time.now();
        if (now >= expiry) {
          // Ban has expired, remove it
          banned_users.delete(user);
          false
        } else {
          true
        };
      };
      case null { false };
    };
  };

  // Function to ban a user
  public shared ({ caller }) func ban_user(user: Principal, duration_hours: Nat, reason: Text) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    // Use the admin-specified duration directly
    await ban_user_impl(caller, user, duration_hours, reason);
  };

  public shared ({ caller }) func test_calculate_ban_duration(user: Principal) : async Nat {
    calculate_ban_duration(user)
  };

  // Helper function to calculate automatic ban duration based on ban history
  private func calculate_ban_duration(user: Principal) : Nat {
    var ban_count = 0;
    
    // Count bans (excluding unbans where timestamps are equal)
    for (entry in ban_log.vals()) {
      if (Principal.equal(entry.user, user)) {
        if (entry.ban_timestamp != entry.expiry_timestamp) {
          ban_count += 1;
        } else {
          // This is an unban entry, reduce the count
          if (ban_count > 0) {
            ban_count -= 1;
          };
        };
      };
    };

    // Ensure ban_count doesn't go negative
    let final_count : Nat = if (ban_count < 0) { 0 } else { Int.abs(ban_count) };

    // Define durations in hours
    let HOUR = 1;
    let DAY = 24;
    let WEEK = 7 * DAY;
    let MONTH = 30 * DAY;
    let YEAR = 365 * DAY;
    let CENTURY = 100 * YEAR;

    // Return duration based on ban count
    switch (final_count) {
      case 0 { HOUR };     // First ban: 1 hour
      case 1 { DAY };      // Second ban: 24 hours
      case 2 { WEEK };     // Third ban: 1 week
      case 3 { MONTH };    // Fourth ban: 1 month
      case 4 { YEAR };     // Fifth ban: 1 year
      case _ { CENTURY };  // Sixth+ ban: 100 years (permaban)
    }
  };

  // Function to ban a user with automatic duration calculation
  private func auto_ban_user(caller: Principal, user: Principal, reason: Text) : async Result.Result<(), Text> {
    // Calculate duration based on ban history
    let duration = calculate_ban_duration(user);
    await ban_user_impl(caller, user, duration, reason);
  };

  private func ban_user_impl(caller: Principal, user: Principal, duration_hours: Nat, reason: Text) : async Result.Result<(), Text> {
    if (Principal.isAnonymous(user)) {
      return #err("Cannot ban anonymous users");
    };

    if (is_admin(user)) {
      return #err("Cannot ban administrators");
    };

    let now = Time.now();
    let duration_nanos = Int.abs(duration_hours) * 3_600_000_000_000;
    let expiry = now + duration_nanos;

    // Check if user is already banned
    switch (banned_users.get(user)) {
      case (?current_expiry) {
        // Only update if new ban expires later
        if (expiry > current_expiry) {
          banned_users.put(user, expiry);
        };
      };
      case null {
        banned_users.put(user, expiry);
      };
    };

    // Add to ban log
    let entry : BanLogEntry = {
      user;
      admin = caller;
      ban_timestamp = now;
      expiry_timestamp = expiry;
      reason;
    };
    ban_log.add(entry);

    #ok()
  };

  // Helper function to format duration in hours to human readable string
  private func format_duration(hours : Int) : Text {
    if (hours < 0) { return "0 hours" };

    let years = hours / (365 * 24);
    let remaining_after_years = hours % (365 * 24);
    
    let months = remaining_after_years / (30 * 24);
    let remaining_after_months = remaining_after_years % (30 * 24);
    
    let weeks = remaining_after_months / (7 * 24);
    let remaining_after_weeks = remaining_after_months % (7 * 24);
    
    let days = remaining_after_weeks / 24;
    let remaining_hours = remaining_after_weeks % 24;

    var parts = Buffer.Buffer<Text>(5);
    
    if (years > 0) {
      parts.add(Int.toText(years) # (if (years == 1) " year" else " years"));
    };
    if (months > 0) {
      parts.add(Int.toText(months) # (if (months == 1) " month" else " months"));
    };
    if (weeks > 0) {
      parts.add(Int.toText(weeks) # (if (weeks == 1) " week" else " weeks"));
    };
    if (days > 0) {
      parts.add(Int.toText(days) # (if (days == 1) " day" else " days"));
    };
    if (remaining_hours > 0 or parts.size() == 0) {
      parts.add(Int.toText(remaining_hours) # (if (remaining_hours == 1) " hour" else " hours"));
    };

    let parts_array = Buffer.toArray(parts);
    
    switch (parts_array.size()) {
      case 0 { "0 hours" };
      case 1 { parts_array[0] };
      case 2 { parts_array[0] # " and " # parts_array[1] };
      case _ {
        var result = "";
        for (i in Iter.range(0, parts_array.size() - 1)) {
          if (i == parts_array.size() - 1) {
            result #= "and " # parts_array[i];
          } else if (i == parts_array.size() - 2) {
            result #= parts_array[i] # " ";
          } else {
            result #= parts_array[i] # ", ";
          };
        };
        result
      };
    }
  };

  // Function to check ban status
  public query func check_ban_status(user: Principal) : async Result.Result<(), Text> {
    if (is_banned(user)) {
      switch (banned_users.get(user)) {
        case (?expiry) {
          let time_remaining = expiry - Time.now();
          if (time_remaining > 0) {
            let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
            #err("You are banned. Ban expires in " # format_duration(hours_remaining))
          } else {
            #err("You are banned") // This shouldn't happen due to is_banned check
          };
        };
        case null {
          #err("You are banned") // This shouldn't happen due to is_banned check
        };
      };
    } else {
      #ok()
    };
  };

  // Function to get ban log
  public query ({ caller }) func get_ban_log() : async Result.Result<[BanLogEntry], Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    #ok(Buffer.toArray(ban_log))
  };

  // Function to get all currently banned users
  public query ({ caller }) func get_banned_users() : async Result.Result<[(Principal, Int)], Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    #ok(Iter.toArray(banned_users.entries()))
  };

  // Function to unban a user
  public shared ({ caller }) func unban_user(user: Principal) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    if (Principal.isAnonymous(user)) {
      return #err("Cannot unban anonymous users");
    };

    if (is_admin(user)) {
      return #err("Administrators cannot be banned or unbanned");
    };

    switch (banned_users.get(user)) {
      case (?_) {
        banned_users.delete(user);
        // Add unban entry to ban log
        let entry : BanLogEntry = {
          user;
          admin = caller;
          ban_timestamp = Time.now();
          expiry_timestamp = Time.now(); // Immediate expiry indicates unban
          reason = "Manual unban by administrator";
        };
        ban_log.add(entry);
        #ok()
      };
      case null {
        #err("User is not currently banned")
      };
    }
  };

  // Neuron name management
  public shared ({ caller }) func set_neuron_name(sns_root_canister_id : Principal, neuron_id : NeuronId, name : Text) : async Result.Result<Text, Text> {
    if (Principal.isAnonymous(caller)) {
        return #err("Anonymous caller not allowed");
    };

    // Check if user is banned
    if (is_banned(caller)) {
        switch (banned_users.get(caller)) {
            case (?expiry) {
                let time_remaining = expiry - Time.now();
                if (time_remaining > 0) {
                    let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
                    return #err("You are banned. Ban expires in " # format_duration(hours_remaining));
                } else {
                    return #err("You are banned"); // This shouldn't happen due to is_banned check
                };
            };
            case null {
                return #err("You are banned"); // This shouldn't happen due to is_banned check
            };
        };
    };

    // Validate name format (unless it's empty)
    if (name != "") {
        switch (await* validate_name_text(name)) {
            case (#ok(valid)) {
                if (not valid) {
                    return #err("Name must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes");
                };
            };
            case (#err(blacklisted_word, attempted_name)) {
                // Ban the user automatically based on ban history
                let reason = "Attempted to set neuron name containing blacklisted word '" # blacklisted_word # "'. Full attempted name: '" # attempted_name # "'";
                ignore await auto_ban_user(this_canister_id(), caller, reason);
                return #err("Name contains inappropriate content. You have been banned.");
            };
        };
    };

    let key : NeuronNameKey = {
        sns_root_canister_id;
        neuron_id;
    };

    // Check name uniqueness (only if setting a new name)
    if (name != "" and not is_name_unique(sns_root_canister_id, name, ?neuron_id)) {
        return #err("Name is already taken by another neuron");
    };

    // Get governance canister and check ownership
    try {
        let governance_canister_id = await get_sns_governance_canister(sns_root_canister_id);
        let is_owner = await is_neuron_owner(caller, governance_canister_id, neuron_id);
        
        if (not is_owner) {
            return #err("Caller is not authorized to name this neuron");
        };

        if (name == "") {
            // Remove the name if it exists
            neuron_names.delete(key);
            return #ok("Successfully removed neuron name");
        } else {
            // Keep verification status if it exists, otherwise set to false
            let current_verified = switch (neuron_names.get(key)) {
                case (?(_, verified)) { verified };
                case null { false };
            };
            
            neuron_names.put(key, (name, current_verified));
            return #ok("Successfully set neuron name");
        }
    } catch (e) {
        return #err("Failed to verify neuron ownership: " # Error.message(e));
    }
  };

  public query func get_neuron_name(sns_root_canister_id : Principal, neuron_id : NeuronId) : async ?(Text, Bool) {
    let key : NeuronNameKey = {
      sns_root_canister_id;
      neuron_id;
    };
    neuron_names.get(key)
  };

  public query func get_all_neuron_names() : async [(NeuronNameKey, (Text, Bool))] {
    Iter.toArray(neuron_names.entries())
  };

  public shared ({ caller }) func verify_neuron_name(sns_root_canister_id : Principal, neuron_id : NeuronId) : async Result.Result<Text, Text> {
    try {
      let authorized = await can_verify_names(caller, sns_root_canister_id);
      if (not authorized) {
        return #err("Caller is not authorized to verify names");
      };

      let key : NeuronNameKey = {
        sns_root_canister_id;
        neuron_id;
      };

      switch (neuron_names.get(key)) {
        case (?(name, _)) {
          neuron_names.put(key, (name, true));
          #ok("Successfully verified neuron name")
        };
        case null {
          #err("No name found for this neuron")
        };
      }
    } catch (e) {
      #err("Failed to verify name: " # Error.message(e))
    }
  };

  public shared ({ caller }) func unverify_neuron_name(sns_root_canister_id : Principal, neuron_id : NeuronId) : async Result.Result<Text, Text> {
    try {
      let authorized = await can_verify_names(caller, sns_root_canister_id);
      if (not authorized) {
        return #err("Caller is not authorized to unverify names");
      };

      let key : NeuronNameKey = {
        sns_root_canister_id;
        neuron_id;
      };

      switch (neuron_names.get(key)) {
        case (?(name, _)) {
          neuron_names.put(key, (name, false));
          #ok("Successfully unverified neuron name")
        };
        case null {
          #err("No name found for this neuron")
        };
      }
    } catch (e) {
      #err("Failed to unverify name: " # Error.message(e))
    }
  };

  // Neuron nickname management
  public shared ({ caller }) func set_neuron_nickname(sns_root_canister_id : Principal, neuron_id : NeuronId, nickname : Text) : async Result.Result<Text, Text> {
    if (Principal.isAnonymous(caller)) {
        return #err("Anonymous caller not allowed");
    };

    // Check if user is banned
    if (is_banned(caller)) {
        switch (banned_users.get(caller)) {
            case (?expiry) {
                let time_remaining = expiry - Time.now();
                if (time_remaining > 0) {
                    let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
                    return #err("You are banned. Ban expires in " # format_duration(hours_remaining));
                } else {
                    return #err("You are banned"); // This shouldn't happen due to is_banned check
                };
            };
            case null {
                return #err("You are banned"); // This shouldn't happen due to is_banned check
            };
        };
    };

    // Validate nickname format (unless it's empty)
    if (nickname != "") {
        switch (await* validate_name_text(nickname)) {
            case (#ok(valid)) {
                if (not valid) {
                    return #err("Nickname must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes");
                };
            };
            case (#err(blacklisted_word, attempted_name)) {
                // Don't ban users for nicknames only they can see

                // Ban the user automatically based on ban history
                //let reason = "Attempted to set neuron nickname containing blacklisted word '" # blacklisted_word # "'. Full attempted name: '" # attempted_name # "'";
                //ignore await auto_ban_user(this_canister_id(), caller, reason);
                //return #err("Nickname contains inappropriate content. You have been banned.");
            };
        };
    };

    let key : NeuronNameKey = {
        sns_root_canister_id;
        neuron_id;
    };

    if (nickname == "") {
        // Get the user's nickname map
        switch (neuron_nicknames.get(caller)) {
            case (?user_map) {
                // Remove the nickname if it exists
                user_map.delete(key);
            };
            case null { /* No nicknames map exists, nothing to remove */ };
        };
        return #ok("Successfully removed neuron nickname");
    } else {
        // Get or create the user's nickname map
        let user_map = switch (neuron_nicknames.get(caller)) {
            case (?existing_map) { existing_map };
            case null {
                let new_map = HashMap.HashMap<NeuronNameKey, Text>(10, func(k1: NeuronNameKey, k2: NeuronNameKey) : Bool {
                    k1.sns_root_canister_id == k2.sns_root_canister_id and k1.neuron_id.id == k2.neuron_id.id
                }, func(k : NeuronNameKey) : Nat32 {
                    Principal.hash(k.sns_root_canister_id) ^ Blob.hash(k.neuron_id.id)
                });
                neuron_nicknames.put(caller, new_map);
                new_map
            };
        };
        
        // Set the nickname
        user_map.put(key, nickname);
        return #ok("Successfully set neuron nickname");
    }
  };

  public query ({ caller }) func get_neuron_nickname(sns_root_canister_id : Principal, neuron_id : NeuronId) : async ?Text {
    switch (neuron_nicknames.get(caller)) {
      case (?user_nicknames) {
        let key : NeuronNameKey = {
          sns_root_canister_id;
          neuron_id;
        };
        user_nicknames.get(key)
      };
      case (null) { null };
    }
  };

  public query ({ caller }) func get_all_neuron_nicknames() : async [(NeuronNameKey, Text)] {
    switch (neuron_nicknames.get(caller)) {
      case (?user_nicknames) {
        Iter.toArray(user_nicknames.entries())
      };
      case (null) { [] };
    }
  };

  // Helper function to check if caller owns a principal
  private func is_principal_owner(caller : Principal, principal : Principal, sns_root_canister_id : ?Principal) : async Bool {
    // Case 1: If caller is the principal, they own it
    if (Principal.equal(caller, principal)) {
      return true;
    };

    // Case 2: Check if caller has a hotkeyed neuron where principal is the owner
    switch (sns_root_canister_id) {
      case (?sns_root_canister_id) {
        try {
          let governance_canister_id = await get_sns_governance_canister(sns_root_canister_id);
          let sns_governance = actor (Principal.toText(governance_canister_id)) : actor {
            list_neurons : shared query ({
              of_principal : ?Principal;
              limit : Nat32;
              start_page_at : ?NeuronId;
            }) -> async {
              neurons : [{
                id : ?NeuronId;
                permissions : [{
                  principal : ?Principal;
                  permission_type : [Int32];
                }];
              }];
            };        
          };

          let response = await sns_governance.list_neurons({
            of_principal = ?caller;
            limit = 100;
            start_page_at = null;
          });

          // For each neuron
          for (neuron in response.neurons.vals()) {
            // Find the principal with the most permissions
            var max_permissions = 0;
            var owner_principal : ?Principal = null;

            for (permission in neuron.permissions.vals()) {
              let perm_count = permission.permission_type.size();
              if (perm_count > max_permissions) {
                max_permissions := perm_count;
                owner_principal := permission.principal;
              };
            };

            // If the target principal is the owner of this neuron, caller has ownership
            switch (owner_principal) {
              case (?p) {
                if (Principal.equal(p, principal)) {
                  return true;
                };
              };
              case null {};
            };
          };
        } catch (e) {
          // If there's an error checking neuron ownership, default to false
          return false;
        };
      };
      case null {
        return false;
      };
    };

    false
  };

  // Principal name management
  public shared ({ caller }) func set_principal_name(name : Text) : async Result.Result<Text, Text> {
    await set_principal_name_impl(caller, caller, name, null)
  };

  public shared ({ caller }) func set_principal_name_for(principal : Principal, name : Text, sns_root_canister_id : ?Principal) : async Result.Result<Text, Text> {
    await set_principal_name_impl(caller, principal, name, sns_root_canister_id)
  };

  // Principal name management
  private func set_principal_name_impl(caller : Principal, principal : Principal, name : Text, sns_root_canister_id : ?Principal) : async Result.Result<Text, Text> {
      if (Principal.isAnonymous(caller)) {
          return #err("Anonymous caller not allowed");
      };

      if (is_banned(caller)) {
          switch (banned_users.get(caller)) {
              case (?expiry) {
                  let time_remaining = expiry - Time.now();
                  if (time_remaining > 0) {
                      let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
                      return #err("You are banned. Ban expires in " # format_duration(hours_remaining));
                  } else {
                      return #err("You are banned"); // This shouldn't happen due to is_banned check
                  };
              };
              case null {
                  return #err("You are banned"); // This shouldn't happen due to is_banned check
              };
          };
      };

      // Check ownership
      let is_owner = await is_principal_owner(caller, principal, sns_root_canister_id );
      if (not is_owner and not is_admin(caller)) {
          return #err("Caller is not authorized to set name for this principal");
      };

      // Validate name format (unless it's empty)
      if (name != "") {
          switch (await* validate_name_text(name)) {
              case (#ok(valid)) {
                  if (not valid) {
                      return #err("Name must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes");
                  };
              };
              case (#err(blacklisted_word, attempted_name)) {
                  // Ban the user automatically based on ban history
                  let reason = "Attempted to set principal name containing blacklisted word '" # blacklisted_word # "'. Full attempted name: '" # attempted_name # "'";
                  ignore await auto_ban_user(this_canister_id(), caller, reason);
                  return #err("Name contains inappropriate content. You have been banned.");
              };
          };
      };

      // Check name uniqueness (only if setting a new name)
      if (name != "") {
          for ((existing_principal, (existing_name, _)) in principal_names.entries()) {
              if (Text.equal(existing_name, name) and not Principal.equal(existing_principal, principal)) {
                  return #err("Name is already taken by another principal");
              };
          };
      };

      if (name == "") {
          // Remove the name if it exists
          principal_names.delete(principal);
          return #ok("Successfully removed principal name");
      } else {
          // Keep verification status if it exists, otherwise set to false
          let current_verified = switch (principal_names.get(principal)) {
              case (?(_, verified)) { verified };
              case null { false };
          };
          
          principal_names.put(principal, (name, current_verified));
          return #ok("Successfully set principal name");
      };
  };

  public query func get_principal_name(principal : Principal) : async ?(Text, Bool) {
      principal_names.get(principal)
  };

  public query func get_all_principal_names() : async [(Principal, (Text, Bool))] {
      Iter.toArray(principal_names.entries())
  };

  public shared ({ caller }) func verify_principal_name(principal : Principal) : async Result.Result<Text, Text> {
      if (not is_admin(caller)) {
          return #err("Caller is not authorized to verify names");
      };

      switch (principal_names.get(principal)) {
          case (?(name, _)) {
              principal_names.put(principal, (name, true));
              #ok("Successfully verified principal name")
          };
          case null {
              #err("No name found for this principal")
          };
      }
  };

  public shared ({ caller }) func unverify_principal_name(principal : Principal) : async Result.Result<Text, Text> {
      if (not is_admin(caller)) {
          return #err("Caller is not authorized to unverify names");
      };

      switch (principal_names.get(principal)) {
          case (?(name, _)) {
              principal_names.put(principal, (name, false));
              #ok("Successfully unverified principal name")
          };
          case null {
              #err("No name found for this principal")
          };
      }
  };

  // Principal nickname management
  public shared ({ caller }) func set_principal_nickname(principal : Principal, nickname : Text) : async Result.Result<Text, Text> {
      if (Principal.isAnonymous(caller)) {
          return #err("Anonymous caller not allowed");
      };

      if (is_banned(caller)) {
          switch (banned_users.get(caller)) {
              case (?expiry) {
                  let time_remaining = expiry - Time.now();
                  if (time_remaining > 0) {
                      let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
                      return #err("You are banned. Ban expires in " # format_duration(hours_remaining));
                  } else {
                      return #err("You are banned"); // This shouldn't happen due to is_banned check
                  };
              };
              case null {
                  return #err("You are banned"); // This shouldn't happen due to is_banned check
              };
          };
      };

      // Validate nickname format (unless it's empty)
      if (nickname != "") {
          switch (await* validate_name_text(nickname)) {
              case (#ok(valid)) {
                  if (not valid) {
                      return #err("Nickname must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes");
                  };
              };
              case (#err(blacklisted_word, attempted_name)) {
                  // Don't ban users for nicknames only they can see

                  // Ban the user automatically based on ban history
                  //let reason = "Attempted to set principal nickname containing blacklisted word '" # blacklisted_word # "'. Full attempted name: '" # attempted_name # "'";
                  //ignore await auto_ban_user(this_canister_id(), caller, reason);
                  //return #err("Nickname contains inappropriate content. You have been banned.");
              };
          };
      };

      if (nickname == "") {
          // Get the user's nickname map
          switch (principal_nicknames.get(caller)) {
              case (?user_map) {
                  // Remove the nickname if it exists
                  user_map.delete(principal);
              };
              case null { /* No nicknames map exists, nothing to remove */ };
          };
          return #ok("Successfully removed principal nickname");
      } else {
          // Get or create the user's nickname map
          let user_map = switch (principal_nicknames.get(caller)) {
              case (?existing_map) { existing_map };
              case null {
                  let new_map = HashMap.HashMap<Principal, Text>(10, Principal.equal, Principal.hash);
                  principal_nicknames.put(caller, new_map);
                  new_map
              };
          };
          
          // Set the nickname
          user_map.put(principal, nickname);
          return #ok("Successfully set principal nickname");
      };
  };

  public query ({ caller }) func get_principal_nickname(principal : Principal) : async ?Text {
      switch (principal_nicknames.get(caller)) {
          case (?user_nicknames) {
              user_nicknames.get(principal)
          };
          case null { null };
      }
  };

  public query ({ caller }) func get_all_principal_nicknames() : async [(Principal, Text)] {
      switch (principal_nicknames.get(caller)) {
          case (?user_nicknames) {
              Iter.toArray(user_nicknames.entries())
          };
          case null { [] };
      }
  };

  // Add after other admin functions
  public shared ({ caller }) func add_blacklisted_word(word: Text) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    let lowercaseWord = Text.toLowercase(word);
    switch (blacklisted_words.get(lowercaseWord)) {
      case (?_) { return #err("Word already blacklisted") };
      case null {
        blacklisted_words.put(lowercaseWord, true);
        #ok()
      };
    };
  };

  public shared ({ caller }) func remove_blacklisted_word(word: Text) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    let lowercaseWord = Text.toLowercase(word);
    switch (blacklisted_words.get(lowercaseWord)) {
      case (?_) {
        blacklisted_words.delete(lowercaseWord);
        #ok()
      };
      case null { return #err("Word not found in blacklist") };
    };
  };

  public query func get_blacklisted_words() : async [Text] {
    Iter.toArray(blacklisted_words.keys())
  };

  // Function to get ban history for a specific user
  public query ({ caller }) func get_user_ban_history(user: Principal) : async Result.Result<[BanLogEntry], Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    
    let userBans = Buffer.Buffer<BanLogEntry>(0);
    for (entry in ban_log.vals()) {
      if (Principal.equal(entry.user, user)) {
        userBans.add(entry);
      };
    };
    
    #ok(Buffer.toArray(userBans))
  };

  // Function to get all neurons owned by a user
  public shared ({ caller }) func get_user_neurons() : async Result.Result<[T.Neuron], Text> {
    if (Principal.isAnonymous(caller)) {
        return #err("Anonymous users cannot get neurons");
    };

    if (is_banned(caller)) {
        return #err("You are banned");
    };

    try {
        let governance_canister_id = await get_sns_governance_canister(Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai"));
        let sns_governance = actor (Principal.toText(governance_canister_id)) : actor {
            list_neurons : shared query ({
                of_principal : ?Principal;
                limit : Nat32;
                start_page_at : ?NeuronId;
            }) -> async {
                neurons : [T.Neuron];
            };
        };

        let response = await sns_governance.list_neurons({
            of_principal = ?caller;
            limit = 100;
            start_page_at = null;
        });

        #ok(response.neurons)
    } catch (e) {
        #err("Failed to fetch neurons: " # Error.message(e))
    }
  };

  // save state to stable arrays
  system func preupgrade() {
    /// stable_principal_swap_canisters
    var list_stable_principal_swap_canisters = List.nil<(Principal, [Principal])>();
    let principalSwapCanistersIter : Iter.Iter<Principal> = state.principal_swap_canisters.keys();
    for (principal in principalSwapCanistersIter) {
      let swapCanisters = switch (state.principal_swap_canisters.get(principal)) {
        case (?existingSwapCanisters) existingSwapCanisters;
        case _ List.nil<Principal>();
      };

      list_stable_principal_swap_canisters := List.push<(Principal, [Principal])>((principal, List.toArray<Principal>(swapCanisters)), list_stable_principal_swap_canisters);
    };
    stable_principal_swap_canisters := List.toArray<(Principal, [Principal])>(list_stable_principal_swap_canisters);

    /// stable_principal_ledger_canisters
    var list_stable_principal_ledger_canisters = List.nil<(Principal, [Principal])>();
    let principalLedgerCanistersIter : Iter.Iter<Principal> = state.principal_ledger_canisters.keys();
    for (principal in principalLedgerCanistersIter) {
      let ledgerCanisters = switch (state.principal_ledger_canisters.get(principal)) {
        case (?existingSwapCanisters) existingSwapCanisters;
        case _ List.nil<Principal>();
      };

      list_stable_principal_ledger_canisters := List.push<(Principal, [Principal])>((principal, List.toArray<Principal>(ledgerCanisters)), list_stable_principal_ledger_canisters);
    };
    stable_principal_ledger_canisters := List.toArray<(Principal, [Principal])>(list_stable_principal_ledger_canisters);

    // Save whitelisted tokens to stable storage
    stable_whitelisted_tokens := Iter.toArray(whitelisted_tokens.vals());

    // Save admins to stable storage
    stable_admins := Iter.toArray(admins.keys());

    stable_neuron_names := Iter.toArray(neuron_names.entries());
    
    // Convert nested HashMap to stable format
    let nickname_entries = Buffer.Buffer<(Principal, [(NeuronNameKey, Text)])>(neuron_nicknames.size());
    for ((user, nicknames) in neuron_nicknames.entries()) {
      nickname_entries.add((user, Iter.toArray(nicknames.entries())));
    };
    stable_neuron_nicknames := Buffer.toArray(nickname_entries);

    // Save blacklisted words to stable storage
    stable_blacklisted_words := Iter.toArray(blacklisted_words.entries());

    // Save ban data
    stable_ban_log := Buffer.toArray(ban_log);
    stable_banned_users := Iter.toArray(banned_users.entries());

    // Save principal names and nicknames to stable storage
    stable_principal_names := Iter.toArray(principal_names.entries());
    
    // Convert nested HashMap to stable format for principal nicknames
    let principal_nickname_entries = Buffer.Buffer<(Principal, [(Principal, Text)])>(principal_nicknames.size());
    for ((user, nicknames) in principal_nicknames.entries()) {
        principal_nickname_entries.add((user, Iter.toArray(nicknames.entries())));
    };
    stable_principal_nicknames := Buffer.toArray(principal_nickname_entries);
  };

  // initialize ephemeral state and empty stable arrays to save memory
  system func postupgrade() {
      /// stable_principal_swap_canisters
      let stableSwapCanistersIter : Iter.Iter<(Principal, [Principal])> = stable_principal_swap_canisters.vals();
      for (principalSwapCanisters in stableSwapCanistersIter) {
        state.principal_swap_canisters.put(principalSwapCanisters.0, List.fromArray<Principal>(principalSwapCanisters.1));
      };
      stable_principal_swap_canisters := [];

      /// stable_principal_ledger_canisters
      let stableLedgerCanistersIter : Iter.Iter<(Principal, [Principal])> = stable_principal_ledger_canisters.vals();
      for (principalLedgerCanisters in stableLedgerCanistersIter) {
        state.principal_ledger_canisters.put(principalLedgerCanisters.0, List.fromArray<Principal>(principalLedgerCanisters.1));
      };
      stable_principal_ledger_canisters := [];

      // Restore whitelisted tokens from stable storage
      for (token in stable_whitelisted_tokens.vals()) {
        whitelisted_tokens.put(token.ledger_id, token);
      };
      stable_whitelisted_tokens := [];

      // Restore admins from stable storage
      for (admin in stable_admins.vals()) {
        admins.put(admin, true);
      };

      // Restore neuron names
      for ((key, name) in stable_neuron_names.vals()) {
        neuron_names.put(key, name);
      };
      stable_neuron_names := [];

      // Restore neuron nicknames
      for ((user, nicknames) in stable_neuron_nicknames.vals()) {
        let user_map = HashMap.HashMap<NeuronNameKey, Text>(10, func(k1: NeuronNameKey, k2: NeuronNameKey) : Bool {
          Principal.equal(k1.sns_root_canister_id, k2.sns_root_canister_id) and Blob.equal(k1.neuron_id.id, k2.neuron_id.id)
        }, func(k: NeuronNameKey) : Nat32 {
          let h1 = Principal.hash(k.sns_root_canister_id);
          let h2 = Blob.hash(k.neuron_id.id);
          h1 ^ h2
        });
        for ((key, nickname) in nicknames.vals()) {
          user_map.put(key, nickname);
        };
        neuron_nicknames.put(user, user_map);
      };
      stable_neuron_nicknames := [];

      // Restore blacklisted words from stable storage
      blacklisted_words := HashMap.fromIter<Text, Bool>(
        stable_blacklisted_words.vals(),
        0,
        Text.equal,
        Text.hash
      );
      stable_blacklisted_words := [];

      // Restore ban data
      ban_log := Buffer.fromArray(stable_ban_log);
      banned_users := HashMap.fromIter<Principal, Int>(
        stable_banned_users.vals(),
        0,
        Principal.equal,
        Principal.hash
      );
      stable_ban_log := [];
      stable_banned_users := [];

      // Restore principal names
      for ((principal, name) in stable_principal_names.vals()) {
          principal_names.put(principal, name);
      };
      stable_principal_names := [];

      // Restore principal nicknames
      for ((user, nicknames) in stable_principal_nicknames.vals()) {
          let user_map = HashMap.HashMap<Principal, Text>(10, Principal.equal, Principal.hash);
          for ((principal, nickname) in nicknames.vals()) {
              user_map.put(principal, nickname);
          };
          principal_nicknames.put(user, user_map);
      };
      stable_principal_nicknames := [];
  };

};