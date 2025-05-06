import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import List "mo:base/List";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";

import T "Types";

shared (deployer) actor class AppSneedDaoBackend() = this {

  let SWAPRUNNER_CANISTER_ID : Text = "tt72q-zqaaa-aaaaj-az4va-cai";

  // aliases
  type State = T.State;
  type StablePrincipalSwapCanisters = T.StablePrincipalSwapCanisters;
  type StablePrincipalLedgerCanisters = T.StablePrincipalLedgerCanisters;
  type SwapRunnerTokenMetadata = T.SwapRunnerTokenMetadata;

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
  };

};