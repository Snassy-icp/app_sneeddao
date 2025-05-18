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
import Char "mo:base/Char";

import T "Types";

shared (deployer) actor class AppSneedDaoBackend() = this {

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

  // stable memory
  stable var stable_principal_swap_canisters : StablePrincipalSwapCanisters = [];
  stable var stable_principal_ledger_canisters : StablePrincipalLedgerCanisters = [];
  stable var stable_whitelisted_tokens : [WhitelistedToken] = [];
  stable var stable_admins : [Principal] = [deployer.caller];

  // Stable storage for neuron names and nicknames
  stable var stable_neuron_names : [(NeuronNameKey, (Text, Bool))] = [];
  stable var stable_neuron_nicknames : [(Principal, [(NeuronNameKey, Text)])] = [];

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
  private func validate_name_text(text : Text) : Bool {
    let length = text.size();
    if (length < 1 or length > 32) {
        return false;
    };
    
    for (char in text.chars()) {
        let isAlphanumeric = (char >= 'a' and char <= 'z') or
                            (char >= 'A' and char <= 'Z') or
                            (char >= '0' and char <= '9');
        let isSeparator = char == ' ' or char == '-' or char == '_' or char == '.';
        
        if (not (isAlphanumeric or isSeparator)) {
            return false;
        };
    };
    true
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

  // Neuron name management
  public shared ({ caller }) func set_neuron_name(sns_root_canister_id : Principal, neuron_id : NeuronId, name : Text) : async Result.Result<Text, Text> {
    if (Principal.isAnonymous(caller)) {
        return #err("Anonymous caller not allowed");
    };

    // Validate name format (unless it's empty)
    if (name != "" and not validate_name_text(name)) {
        return #err("Name must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, and dots");
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

    // Validate nickname format (unless it's empty)
    if (nickname != "" and not validate_name_text(nickname)) {
        return #err("Nickname must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, and dots");
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
  };

};