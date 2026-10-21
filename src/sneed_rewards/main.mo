import Text "mo:base/Text";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Int64 "mo:base/Int64";
import Float "mo:base/Float";
import Map "mo:base/HashMap";
import Blob "mo:base/Blob";
import Iter "mo:base/Iter";
import Array "mo:base/Array";
import Principal "mo:base/Principal";
import Debug "mo:base/Debug";
import Char "mo:base/Char";
import Timer "mo:base/Timer";
import HashMap "mo:base/HashMap";
import List "mo:base/List";
import Error "mo:base/Error";
import Buffer "mo:base/Buffer";
import Time "mo:base/Time";
import Result "mo:base/Result";
import Hash "mo:base/Hash";
import IC "mo:base/ExperimentalInternetComputer";

import T "Types";
import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";
import Icrc3Log "../icrc3/Log";
import Icrc3Sns "../icrc3/SnsRegister";
import T3 "../icrc3/Types";

shared (deployer) persistent actor class SneedRLL() = this {

  private func this_canister_id() : Principal {
      Principal.fromActor(this);
  };
    
  // The Sneed SNS governance canister principal
  transient let sneed_governance_canister_id = Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai");
  // The Sneed SNS root: co-controller of the ICRC-3 archive canisters
  transient let SNEED_SNS_ROOT = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");

  // ICPSwap's trusted token list: the source of the whitelist (Swaprunner is being retired).
  transient let ICPSWAP_TOKEN_LIST_CANISTER_ID : Text = "k37c6-riaaa-aaaag-qcyza-cai";


  // Admin principals
  var admin_principals : [Principal] = [
    sneed_governance_canister_id, // sneed_governance_canister_id
    Principal.fromText("d7zib-qo5mr-qzmpb-dtyof-l7yiu-pu52k-wk7ng-cbm3n-ffmys-crbkz-nae"), // Sneed team admin
  ];

  // Imported neurons (stable)
  var stable_neurons : [(Blob, T.Neuron)]= []; // Neuron id
  var stable_owners : [(Blob, Principal)]= []; // Neuron id
  var stable_props : [(Int, T.ProposalData)]= []; // Proposal id

  var stable_balances : [(Principal, T.LocalBalances)]= []; // Owner (Principal) id

  var imported_proposal_max : Nat64 = 0;

  var import_next_neuron_id : ?T.NeuronId = null;

  var stable_whitelisted_tokens : [(Principal, T.TokenMetadata)] = [];
  transient var whitelisted_tokens = Map.fromIter<Principal, T.TokenMetadata>(stable_whitelisted_tokens.vals(), 10, Principal.equal, Principal.hash);

  var stable_known_tokens : [(Principal, T.TokenMetadata)] = [];
  transient var known_tokens = Map.fromIter<Principal, T.TokenMetadata>(stable_known_tokens.vals(), 10, Principal.equal, Principal.hash);

  // Track total distributions per token
  var stable_total_distributions : [(Principal, Nat)] = [];
  transient var total_distributions = Map.fromIter<Principal, Nat>(stable_total_distributions.vals(), 10, Principal.equal, Principal.hash);

  var stable_user_distributions : [(Principal, T.UserDistributions)] = [];
  transient var user_distributions = Map.fromIter<Principal, T.UserDistributions>(stable_user_distributions.vals(), 100, Principal.equal, Principal.hash);

  // Distribution event log
  var stable_distribution_events : [T.DistributionEvent] = [];
  transient var distribution_events = Buffer.fromArray<T.DistributionEvent>(stable_distribution_events);

  // User distribution event log
  var stable_user_distribution_events : [T.UserDistributionEvent] = [];
  transient var user_distribution_events = Buffer.fromArray<T.UserDistributionEvent>(stable_user_distribution_events);

  // Event sequence counter
  var event_sequence : Nat = 0;

  // Claim and transfer event logs
  var stable_claim_events : [T.ClaimEvent] = [];
  transient var claim_events = Buffer.fromArray<T.ClaimEvent>(stable_claim_events);

  // Incident tickets for claim transfers whose await threw (ambiguous outcome).
  // Stored directly in a stable array (not a rotating buffer) — these are fund-loss
  // evidence and must never be dropped. Growth is naturally bounded because a ticket
  // is only ever created by a genuine ambiguous transfer failure, which requires a
  // real (costly) transfer attempt that trapped — an attacker cannot cheaply spam them.
  stable var claim_incidents : [T.ClaimIncident] = [];
  stable var next_incident_id : Nat = 0;

  // Per token, the amounts of claims whose transfer is awaiting the ledger: already debited
  // from the local balances but still in the canister's ledger balance. Transient: a claim's
  // continuation does not survive an upgrade either.
  transient let in_flight_claims = Map.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

  // ICRC-3 activity log: hash-chained, certified blocks for every distribution, credit,
  // claim, incident, reconciliation and admin change, spilled to archive canisters.
  // Library src/icrc3; design and block catalogue: spec/rll_icrc3.md. New stable fields
  // (additive); the runtimes are transient.
  stable var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  stable var icrc3_sns : Icrc3Sns.State = Icrc3Sns.init();
  transient let icrc3_sns_rt : Icrc3Sns.Runtime = Icrc3Sns.runtime();
  transient var icrc3_next_cid : Nat = 0; // groups the canister-log lines of one spill run

  private func add_in_flight(token_id : Principal, amount : Nat) {
    let cur = switch (in_flight_claims.get(token_id)) { case (?a) a; case null 0 };
    in_flight_claims.put(token_id, cur + amount);
  };

  private func remove_in_flight(token_id : Principal, amount : Nat) {
    let cur = switch (in_flight_claims.get(token_id)) { case (?a) a; case null 0 };
    if (cur > amount) { in_flight_claims.put(token_id, cur - amount) } else { in_flight_claims.delete(token_id) };
  };

  // Amounts of a token the canister may still hold that are owed although no local balance
  // shows them: claims awaiting the ledger, and unresolved incidents (debited owners whose
  // transfer may not have landed). A distribution must not share these out again.
  private func reserved_balance(token_id : Principal) : Nat {
    var total : Nat = switch (in_flight_claims.get(token_id)) { case (?a) a; case null 0 };
    for (inc in claim_incidents.vals()) {
      if (not inc.resolved and inc.token_id == token_id) { total += inc.total };
    };
    total;
  };

  private func create_claim_incident(
    seq : Nat,
    token_id : Principal,
    recipient : Principal,
    owners : [(Principal, Nat)],
    total : Nat,
    amount : Nat,
    fee : Nat,
    memo : Blob,
    created_at_time : Nat64,
    error_message : Text
  ) : Nat {
    let id = next_incident_id;
    next_incident_id += 1;
    let incident : T.ClaimIncident = {
      id;
      sequence_number = seq;
      token_id;
      recipient;
      owners;
      total;
      amount;
      fee;
      memo;
      created_at_time;
      error_message;
      resolved = false;
      landed = null;
      resolved_at = null;
    };
    claim_incidents := Array.append(claim_incidents, [incident]);
    id;
  };

  // Imported neurons
  transient var neurons = Map.fromIter<Blob, T.Neuron>(stable_neurons.vals(), 100, Blob.equal, Blob.hash);
  // Owning principals for imported neurons
  transient var owners = Map.fromIter<Blob, Principal>(stable_owners.vals(), 100, Blob.equal, Blob.hash);

  transient var props = Map.fromIter<Int, T.ProposalData>(stable_props.vals(), 100, Int.equal, Int.hash);

  transient var balances = Map.fromIter<Principal, T.LocalBalances>(stable_balances.vals(), 100, Principal.equal, Principal.hash);

  transient var import_neuron_ticks : Nat = 0;
  transient var import_prop_ticks : Nat = 0;
  transient var distribute_tokens_ticks : Nat = 0;


  transient let sneed_exclude_principal = Principal.fromText("umo43-o3yqa-363iw-wroso-jm5az-kmfp2-rdzoj-q7il2-zfhcj-l35r7-oqe");

  var MIN_FEE_MULTIPLIER : Nat = 10;

  transient let sneed_gov_canister = actor (Principal.toText(sneed_governance_canister_id)) : actor {
    get_proposal : shared query T.GetProposal -> async T.GetProposalResponse;
    get_neuron : shared query T.GetNeuron -> async T.GetNeuronResponse;
    list_neurons : shared query T.ListNeurons -> async T.ListNeuronsResponse;
  };  

  // SwapRunner actor
  type IcpSwapListToken = { canisterId : Text; decimals : Nat; fee : Nat; name : Text; symbol : Text; standard : Text };
  transient let icpswap_token_list = actor(ICPSWAP_TOKEN_LIST_CANISTER_ID) : actor {
    getList : shared query () -> async { #ok : [IcpSwapListToken]; #err : Text };
  };
  func principal_from_canister_text(t : Text) : ?Principal {
    if (t.size() != 27) { return null };
    for (c in t.chars()) { if (not (c == '-' or (c >= 'a' and c <= 'z') or (c >= '2' and c <= '7'))) { return null } };
    ?Principal.fromText(t);
  };  

  transient let MAX_TICKS : Nat = 250; // maximum number of ticks for a longrunning function

  // Track token balance check state
  var token_balance_check_timer_id : ?Nat = null;
  var tokens_to_check : [(Principal, T.TokenMetadata)] = [];
  var current_token_check_index : Nat = 0;
  var token_check_ticks : Nat = 0;

  // Per-wallet known tokens tracking
  var stable_wallet_known_tokens : [(Principal, [(Principal, T.TokenMetadata)])] = [];
  transient var wallet_known_tokens = Map.HashMap<Principal, HashMap.HashMap<Principal, T.TokenMetadata>>(10, Principal.equal, Principal.hash);

  // Initialize wallet_known_tokens from stable storage
  for ((wallet, tokens) in stable_wallet_known_tokens.vals()) {
    let token_map = HashMap.HashMap<Principal, T.TokenMetadata>(10, Principal.equal, Principal.hash);
    for ((token_id, metadata) in tokens.vals()) {
      token_map.put(token_id, metadata);
    };
    wallet_known_tokens.put(wallet, token_map);
  };

  // Track wallet token check state
  var wallet_token_check_timer_id : ?Nat = null;
  var wallet_tokens_to_check : [(Principal, T.TokenMetadata)] = [];
  var current_wallet_token_check_index : Nat = 0;
  var wallet_token_check_ticks : Nat = 0;
  var current_wallet_being_checked : ?Principal = null;

  // Track per-token minimum distribution amounts
  var stable_token_min_distributions : [(Principal, Nat)] = [];
  transient var token_min_distributions = Map.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

  // Initialize token_min_distributions from stable storage
  for ((token_id, min_amount) in stable_token_min_distributions.vals()) {
    token_min_distributions.put(token_id, min_amount);
  };

  // Track per-token maximum distribution amounts
  var stable_token_max_distributions : [(Principal, Nat)] = [];
  transient var token_max_distributions = Map.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

  // Initialize token_max_distributions from stable storage
  for ((token_id, max_amount) in stable_token_max_distributions.vals()) {
    token_max_distributions.put(token_id, max_amount);
  };

  // PUBLIC API

  public query func balance_of(owner : Principal, icrc1_ledger_canister_id : Principal) : async Nat {
    get_balance(owner, icrc1_ledger_canister_id);
  };

  public query func total_balance(icrc1_ledger_canister_id : Principal) : async Nat {
    local_total_balance(icrc1_ledger_canister_id);
  };

  private func local_total_balance(icrc1_ledger_canister_id : Principal) : Nat {
    var total : Nat = 0;
    for ((owner, local_balances) in balances.entries()) {
      for (local_balance in local_balances.balances.vals()) {
        if (local_balance.icrc1_ledger_canister_id == icrc1_ledger_canister_id) {
          total += local_balance.amount;
        };
      };
    };
    total;
  };

  public query func all_token_balances() : async [(Principal, Nat)] {
    get_all_token_balances();
  };


  private func get_all_token_balances() : [(Principal, Nat)] {
    let token_totals = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);
    
    for ((owner, local_balances) in balances.entries()) {
      for (local_balance in local_balances.balances.vals()) {
        let token_id = local_balance.icrc1_ledger_canister_id;
        let current_total = switch (token_totals.get(token_id)) {
          case (null) { 0 };
          case (?existing) { existing };
        };
        token_totals.put(token_id, current_total + local_balance.amount);
      };
    };
    
    Iter.toArray(token_totals.entries());
  };

  public shared func balance_reconciliation() : async [{
    token_id : Principal;
    local_total : Nat;
    server_balance : Nat;
    remaining : Nat;
    underflow : Nat;
  }] {
    await get_balance_reconciliation();
  };

  private func get_balance_reconciliation() : async [{
    token_id : Principal;
    local_total : Nat;
    server_balance : Nat;
    remaining : Nat;
    underflow : Nat;
  }] {

    let canister_id = this_canister_id();
    let local_balances = get_all_token_balances();
    let local_balances_map = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);
    
    // Convert local balances array to map for easier lookup
    for ((token_id, balance) in local_balances.vals()) {
      local_balances_map.put(token_id, balance);
    };
    
    let results = Buffer.Buffer<{
      token_id : Principal;
      local_total : Nat;
      server_balance : Nat;
      remaining : Nat;
      underflow : Nat;
    }>(known_tokens.size());

    // Iterate over all known tokens
    for ((token_id, _) in known_tokens.entries()) {
      let local_total = switch (local_balances_map.get(token_id)) {
        case (?balance) { balance };
        case (null) { 0 }; // No local balance record means 0
      };

      let icrc1_ledger_canister = actor (Principal.toText(token_id)) : actor {
        icrc1_balance_of : shared query (account : T.Account) -> async Nat;
      };

      let server_balance = await icrc1_ledger_canister.icrc1_balance_of({
        owner = canister_id;
        subaccount = null;
      });

      let (remaining, underflow) = if (server_balance >= local_total) {
        (server_balance - local_total, 0)
      } else {
        (0, local_total - server_balance)
      };

      results.add({
        token_id;
        local_total;
        server_balance;
        remaining;
        underflow;
      });
    };
    
    Buffer.toArray(results);
  };

  public query func balance_reconciliation_from_balances(token_balances: [(Principal, Nat)]) : async [{
    token_id : Principal;
    local_total : Nat;
    server_balance : Nat;
    remaining : Nat;
    underflow : Nat;
  }] {
    get_balance_reconciliation_from_balances(token_balances);
  };

  private func get_balance_reconciliation_from_balances(token_balances: [(Principal, Nat)]) : [{
    token_id : Principal;
    local_total : Nat;
    server_balance : Nat;
    remaining : Nat;
    underflow : Nat;
  }] {
    let local_balances = get_all_token_balances();
    let local_balances_map = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);
    let server_balances_map = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);
    
    // Convert local balances array to map for easier lookup
    for ((token_id, balance) in local_balances.vals()) {
      local_balances_map.put(token_id, balance);
    };

    // Convert input server balances to map
    for ((token_id, balance) in token_balances.vals()) {
      server_balances_map.put(token_id, balance);
    };
    
    let results = Buffer.Buffer<{
      token_id : Principal;
      local_total : Nat;
      server_balance : Nat;
      remaining : Nat;
      underflow : Nat;
    }>(known_tokens.size());

    // Iterate over all known tokens
    for ((token_id, _) in known_tokens.entries()) {
      let local_total = switch (local_balances_map.get(token_id)) {
        case (?balance) { balance };
        case (null) { 0 }; // No local balance record means 0
      };

      let server_balance = switch (server_balances_map.get(token_id)) {
        case (?balance) { balance };
        case (null) { 0 }; // No server balance record means 0
      };

      let (remaining, underflow) = if (server_balance >= local_total) {
        (server_balance - local_total, 0)
      } else {
        (0, local_total - server_balance)
      };

      results.add({
        token_id;
        local_total;
        server_balance;
        remaining;
        underflow;
      });
    };
    
    Buffer.toArray(results);
  };

  public query func balances_of_hotkey_neurons(neurons : [T.Neuron]) : async [(Principal, Nat)] {
    let owners = get_hotkey_owners_from_neurons(neurons);
    get_balances_from_owners(owners);
  };

  public shared  ({ caller }) func balances_of_hotkey() : async [(Principal, Nat)] {
    await get_hotkey_balances(caller);
  };

  public shared ({ caller }) func claim_full_balance_of_hotkey(icrc1_ledger_canister_id : Principal, fee : Nat) : async T.TransferResult {
    await claim_hotkey_balance(caller, icrc1_ledger_canister_id, fee);
  };

  // GOV API

  
  // ORCHESTRATOR
  var orchestrator_stage : {
    #idle;
    #importing_whitelist;
    #checking_balances;
    #importing_neurons;
    #importing_proposals;
    #distributing_tokens;
  } = #idle;

  // Track actual running state of imports and distribution
  var distribution_cycle_timer_id : ?Nat = null;
  var neuron_import_timer_id : ?Nat = null;
  var proposal_import_timer_id : ?Nat = null;
  var token_distribution_timer_id : ?Nat = null;
  var current_distribution_token : ?Principal = null;

  // Track distribution progress
  var processed_token_count : Nat = 0;
  var total_tokens_to_process : Nat = 0;

  // Helper method to cancel a timer and clear its ID
  private func cancel_timer(timer_id_ref : ?Nat) : ?Nat {
    switch(timer_id_ref) {
      case (?timer_id) {
        Timer.cancelTimer(timer_id);
      };
      case (null) { };
    };
    null;
  };

  var main_loop_frequence_seconds : Nat = 60 * 60 * 24; // 24 hours

  var main_loop_timer_id : ?Nat = null;
  var main_loop_last_started : ?Nat = null;
  var main_loop_last_stopped : ?Nat = null;
  var main_loop_next_scheduled : ?Nat = null;
  var cycle_last_started : ?Nat = null;
  var cycle_last_ended : ?Nat = null;

  public shared ({ caller }) func start_rll_main_loop() : async Result.Result<Text, Text> {
    assert is_admin(caller);

    // Check if already running
    switch(main_loop_timer_id) {
      case (?_timer_id) {
        Debug.print("Main loop already running");
        return #err("Main loop already running");
      };
      case (null) { };
    };

    // Record start time
    let current_time = Int.abs(Time.now());
    main_loop_last_started := ?current_time;
    
    // Calculate next run time (in nanoseconds)
    main_loop_next_scheduled := ?(current_time + Nat64.toNat(Nat64.fromNat(main_loop_frequence_seconds)) * 1_000_000_000);

    // Start the main loop and store the timer ID
    main_loop_timer_id := ?Timer.setTimer<system>(#seconds 0, main_loop_tick);
    Debug.print("Started main loop with timer id " # debug_show(main_loop_timer_id));
    icrc3_config(?caller, "main_loop", #Text("on"), null);
    #ok("Started main loop with timer id " # debug_show(main_loop_timer_id))
  };

  public shared ({ caller }) func stop_rll_main_loop() : async Result.Result<Text, Text> {
    assert is_admin(caller);

    switch(main_loop_timer_id) {
      case (?timer_id) {
        Timer.cancelTimer(timer_id);
        main_loop_timer_id := null;
        main_loop_last_stopped := ?Int.abs(Time.now());
        main_loop_next_scheduled := null;
        icrc3_config(?caller, "main_loop", #Text("off"), null);
        #ok("Stopped main loop")
      };
      case (null) {
        #err("Main loop not running")
      };
    }
  };

  private func main_loop_tick<system>() : async () {
    // Check if we still have an active timer
    switch(main_loop_timer_id) {
      case (null) { return; };
      case (?_) { };
    };

    Debug.print("Main loop tick at " # debug_show(Int.abs(Time.now())));

    // Update tracking variables
    let current_time = Int.abs(Time.now());
    cycle_last_started := ?current_time;

    // Start a distribution cycle
    let result = await run_distribution_cycle();
    
    // Log the result
    switch(result) {
      case (#ok(msg)) {
        Debug.print("Distribution cycle started: " # msg);
      };
      case (#err(msg)) {
        Debug.print("Failed to start distribution cycle: " # msg);
      };
    };

    main_loop_next_scheduled := ?(current_time + Nat64.toNat(Nat64.fromNat(main_loop_frequence_seconds)) * 1_000_000_000);

    // Schedule next run if timer is still active
    switch(main_loop_timer_id) {
      case (?_) {
        main_loop_timer_id := ?Timer.setTimer<system>(#seconds main_loop_frequence_seconds, main_loop_tick);
        Debug.print("Scheduled next main loop run for " # debug_show(main_loop_next_scheduled));
      };
      case (null) {
        Debug.print("Main loop was stopped, not scheduling next run");
      };
    };
  };

  public shared ({ caller }) func stop_distribution_cycle() : async Result.Result<Text, Text> {
    assert is_admin(caller);
    
    // Cancel all timers
    distribution_cycle_timer_id := cancel_timer(distribution_cycle_timer_id);
    neuron_import_timer_id := cancel_timer(neuron_import_timer_id);
    proposal_import_timer_id := cancel_timer(proposal_import_timer_id);
    token_distribution_timer_id := cancel_timer(token_distribution_timer_id);
    token_balance_check_timer_id := cancel_timer(token_balance_check_timer_id);

    import_prop_ticks := 0;
    import_neuron_ticks := 0; 
    distribute_tokens_ticks := 0;    
    import_next_neuron_id := null;
    imported_proposal_max := 0;
    processed_token_count := 0;
    total_tokens_to_process := 0;
    current_distribution_token := null;

    orchestrator_stage := #idle;
    icrc3_admin(caller, "distribution_cycle_stop", []);
    #ok("Distribution cycle stopped")
  };

  public shared ({ caller }) func start_distribution_cycle() : async Result.Result<Text, Text> {
    assert is_admin(caller);

    let result = await run_distribution_cycle();
    switch (result) {
      case (#ok(_)) { icrc3_admin(caller, "distribution_cycle_start", []) };
      case (#err(_)) {};
    };
    result;
  };

  private func run_distribution_cycle() : async Result.Result<Text, Text> {

    // Cancel any existing timer
    switch(distribution_cycle_timer_id) {
      case (?_timer_id) {
        Debug.print("Distribution cycle already running");
        return #err("Distribution cycle already running");
      };
      case (null) { };
    };

    assert orchestrator_stage == #idle;
    assert neuron_import_timer_id == null;
    assert proposal_import_timer_id == null;
    assert token_distribution_timer_id == null;
    assert token_balance_check_timer_id == null;

    begin_distribution_cycle<system>();
    Debug.print("Started distribution cycle with timer id " # debug_show(distribution_cycle_timer_id));
    #ok("Started distribution cycle with timer id " # debug_show(distribution_cycle_timer_id))
  };

  // Resets the cycle progress and starts the orchestrator at its first stage. Synchronous,
  // so it can also be called from postupgrade to restart a cycle an upgrade interrupted.
  private func begin_distribution_cycle<system>() {
    orchestrator_stage := #importing_whitelist;
    Debug.print("Starting distribution cycle");

    import_prop_ticks := 0;
    import_neuron_ticks := 0; 
    distribute_tokens_ticks := 0;    
    import_next_neuron_id := null;
    imported_proposal_max := 0;
    processed_token_count := 0;
    total_tokens_to_process := 0;
    current_distribution_token := null;
    cntImportedWhitelist := 0;
    cntImportedWithBalance := 0;
    
    // Start the orchestration cycle and store the timer ID
    distribution_cycle_timer_id := ?Timer.setTimer<system>(#seconds 0, orchestrate_imports_tick);
  };

  public query func get_import_stage() : async Text {
    let running_state = switch(orchestrator_stage) {
      case (#idle) { "idle" };
      case (#importing_whitelist) { "importing whitelist" };
      case (#checking_balances) { "checking balances" };
      case (#importing_neurons) { 
        switch (neuron_import_timer_id) {
          case (?_) { "importing neurons (running)" };
          case (null) { "importing neurons (waiting)" };
        }
      };
      case (#importing_proposals) { 
        switch (proposal_import_timer_id) {
          case (?_) { "importing proposals (running)" };
          case (null) { "importing proposals (waiting)" };
        }
      };
      case (#distributing_tokens) {
        switch (token_distribution_timer_id) {
          case (?_) {
            switch (current_distribution_token) {
              case (null) { "distributing tokens (initializing)" };
              case (?token) { 
                "distributing tokens (processing " # Principal.toText(token) # 
                ", " # debug_show(processed_token_count) # "/" # debug_show(total_tokens_to_process) # ")"
              };
            }
          };
          case (null) { "distributing tokens (waiting)" };
        }
      };
    };
    let timer_status = switch(distribution_cycle_timer_id) {
      case (?_) { " (timer active)" };
      case (null) { " (no timer)" };
    };
    running_state # timer_status # ", neuron ticks: " # debug_show(import_neuron_ticks) # ", prop ticks: " # debug_show(import_prop_ticks);
  };

  private func orchestrate_imports_tick<system>() : async () {
    let current_time = Int.abs(Time.now());

    // Check if we still have an active timer
    switch(distribution_cycle_timer_id) {
      case (null) {
        // Timer was cancelled, clean up
        neuron_import_timer_id := cancel_timer(neuron_import_timer_id);
        proposal_import_timer_id := cancel_timer(proposal_import_timer_id);
        token_distribution_timer_id := cancel_timer(token_distribution_timer_id);
        token_balance_check_timer_id := cancel_timer(token_balance_check_timer_id);
        cycle_last_ended := ?current_time;

        return;
      };
      case (?_) { };
    };

    Debug.print("Orchestrating imports tick: " # debug_show(orchestrator_stage));
    switch(orchestrator_stage) {
      case (#idle) { 
        // Clean up and clear timers
        distribution_cycle_timer_id := cancel_timer(distribution_cycle_timer_id);
        neuron_import_timer_id := cancel_timer(neuron_import_timer_id);
        proposal_import_timer_id := cancel_timer(proposal_import_timer_id);
        token_distribution_timer_id := cancel_timer(token_distribution_timer_id);
        token_balance_check_timer_id := cancel_timer(token_balance_check_timer_id);
        cycle_last_ended := ?current_time;

        return; 
      };

      case (#importing_whitelist) {
        // Start whitelist import if not already running
        if (not import_whitelisted_running) {
          //if (cntImportedWhitelist == 0) {
            // Start the import
            try {
              await import_whitelisted_tokens_from_swaprunner_impl(null);
              // Move to balance checking stage
              orchestrator_stage := #checking_balances;
              // Reset counters for balance check
              current_token_check_index := 0;
              token_check_ticks := 1;
              cntImportedWithBalance := 0;
              // Get whitelisted tokens for checking
              tokens_to_check := Iter.toArray(whitelisted_tokens.entries());
              // Start the balance check process
              token_balance_check_timer_id := ?Timer.setTimer<system>(#seconds 0, check_token_balances_tick);
            } catch e {
              Debug.print("Error during whitelist import: " # Error.message(e));
            };
          //};
        };
        
        // Schedule next orchestrator tick
        distribution_cycle_timer_id := ?Timer.setTimer<system>(#seconds 15, orchestrate_imports_tick);
      };

      case (#checking_balances) {
        // Check if balance check is complete
        switch(token_balance_check_timer_id) {
          case (null) {
            if (token_check_ticks == 0) {
              token_check_ticks := 1;
              current_token_check_index := 0;
              token_check_ticks := 1;
              cntImportedWithBalance := 0;
              // Get whitelisted tokens for checking
              tokens_to_check := Iter.toArray(whitelisted_tokens.entries());
              token_balance_check_timer_id := ?Timer.setTimer<system>(#seconds 0, check_token_balances_tick);
              Debug.print("Started balance check with timer id " # debug_show(token_balance_check_timer_id));
            } else {
              // Balance check is done, move to neuron import
              Debug.print("Balance check completed, moving to neuron import");
              orchestrator_stage := #importing_neurons;
              token_check_ticks := 0;
              import_neuron_ticks := 1;
              import_next_neuron_id := null;
              neuron_import_timer_id := ?Timer.setTimer<system>(#seconds 0, import_next_neurons_tick);
            };
          };
          case (?_) {
            Debug.print("Balance check already running with timer id " # debug_show(token_balance_check_timer_id));
          };
        };
        
        // Schedule next orchestrator tick
        distribution_cycle_timer_id := ?Timer.setTimer<system>(#seconds 15, orchestrate_imports_tick);
      };
      
      case (#importing_neurons) {
        // Start neuron import if not already running
        switch(neuron_import_timer_id) {
          case (null) {
            // Only start if we haven't completed all imports
            if (import_neuron_ticks == 0) {
              import_neuron_ticks := 1;
              import_next_neuron_id := null; // import all neurons!
              neuron_import_timer_id := ?Timer.setTimer<system>(#seconds 0, import_next_neurons_tick);
              Debug.print("Started neuron import with timer id " # debug_show(neuron_import_timer_id));
            } else {
              // We've completed all imports, move to proposal import
              Debug.print("Neuron import completed, moving to proposals");
              orchestrator_stage := #importing_proposals;
              import_neuron_ticks := 0; 
              import_next_neuron_id := null;
              import_prop_ticks := 1;
              imported_proposal_max := getHighestClosedProposalId(); // no need to reimport closed proposals

              proposal_import_timer_id := ?Timer.setTimer<system>(#seconds 0, import_proposals_tick);
            };
          };
          case (?_) { 
            Debug.print("Neuron import already running with timer id " # debug_show(neuron_import_timer_id));
          };
        };
        
        // Schedule next orchestrator tick if we're not done
        if (orchestrator_stage != #idle) {
          distribution_cycle_timer_id := ?Timer.setTimer<system>(#seconds 15, orchestrate_imports_tick);
        };
      };
      
      case (#importing_proposals) {
        // Start proposal import if not already running
        switch(proposal_import_timer_id) {
          case (null) {
            // Only start if we haven't completed all imports
            if (import_prop_ticks == 0) {
              import_prop_ticks := 1;
              imported_proposal_max := getHighestClosedProposalId(); // no need to reimport closed proposals
              proposal_import_timer_id := ?Timer.setTimer<system>(#seconds 0, import_proposals_tick);
              Debug.print("Started proposal import with timer id " # debug_show(proposal_import_timer_id));
            } else {
              // We've completed all imports, move to token distribution
              Debug.print("Proposal import completed, moving to token distribution");
              orchestrator_stage := #distributing_tokens;
              import_prop_ticks := 0;
              distribute_tokens_ticks := 1;
              processed_token_count := 0;
              token_distribution_timer_id := ?Timer.setTimer<system>(#seconds 0, distribute_tokens_tick);
            };
          };
          case (?_) { 
            Debug.print("Proposal import already running with timer id " # debug_show(proposal_import_timer_id));
          };
        };
        
        // Schedule next orchestrator tick if we're not done
        if (orchestrator_stage != #idle) {
          distribution_cycle_timer_id := ?Timer.setTimer<system>(#seconds 15, orchestrate_imports_tick);
        };
      };

      case (#distributing_tokens) {
        // Start token distribution if not already running
        switch(token_distribution_timer_id) {
          case (null) {
            // Only start if we haven't completed all distributions
            if (distribute_tokens_ticks == 0) {
              distribute_tokens_ticks := 1;
              processed_token_count := 0;
              token_distribution_timer_id := ?Timer.setTimer<system>(#seconds 0, distribute_tokens_tick);
              Debug.print("Started token distribution with timer id " # debug_show(token_distribution_timer_id));
            } else {
              // We've completed all distributions
              Debug.print("Token distribution completed, moving to idle");
              orchestrator_stage := #idle;              
              cycle_last_ended := ?current_time;

              // Clean up timers
              distribution_cycle_timer_id := cancel_timer(distribution_cycle_timer_id);
              neuron_import_timer_id := cancel_timer(neuron_import_timer_id);
              proposal_import_timer_id := cancel_timer(proposal_import_timer_id);
              return;
            };
          };
          case (?_) { 
            Debug.print("Token distribution already running with timer id " # debug_show(token_distribution_timer_id));
          };
        };

        // Schedule next orchestrator tick if we're not done
        if (orchestrator_stage != #idle) {
          distribution_cycle_timer_id := ?Timer.setTimer<system>(#seconds 15, orchestrate_imports_tick);
        };
      };
    };
  };

  private func distribute_tokens_tick<system>() : async () {
    // Check if we still have an active timer
    switch(token_distribution_timer_id) {
      case (null) { return; };
      case (?_) { };
    };

    distribute_tokens_ticks += 1;
    Debug.print("Distributing tokens tick: " # debug_show(processed_token_count) # "/" # debug_show(total_tokens_to_process) # ", ticks: " # debug_show(distribute_tokens_ticks));

    // If we haven't started yet, initialize the token list
    if (processed_token_count == 0) {
      total_tokens_to_process := known_tokens.size();
      if (total_tokens_to_process == 0) {
        // No tokens to process
        token_distribution_timer_id := cancel_timer(token_distribution_timer_id);
        current_distribution_token := null;
        return;
      };
    };
    
    // Get next token to process
    let tokens_array = Iter.toArray(known_tokens.entries());
    if (processed_token_count >= tokens_array.size()) {
      // Done processing all tokens
      token_distribution_timer_id := cancel_timer(token_distribution_timer_id);
      current_distribution_token := null;
      processed_token_count := 0;
      total_tokens_to_process := 0;
      return;
    };

    let (token_id, token_metadata) = tokens_array[processed_token_count];
    current_distribution_token := ?token_id;

    try {
      // Get token canister
      let token_canister = actor (Principal.toText(token_id)) : actor {
        icrc1_balance_of : shared query (account : T.Account) -> async Nat;
      };

      // 1. What the canister owes in this token, taken before the balance is read (claims
      //    that complete while the balance call is out only make the balance smaller): the
      //    local balances plus amounts reserved for in-flight claims and unresolved incidents.
      let claimable = local_total_balance(token_id);
      let reserved = reserved_balance(token_id);
      let total_distributed = claimable + reserved;

      // 2. Get server balance
      let server_balance = await token_canister.icrc1_balance_of({
        owner = this_canister_id();
        subaccount = null;
      });

      Debug.print("Server balance: " # debug_show(server_balance) # ", total distributed: " # debug_show(total_distributed));

      // ICRC-3: what the ledger holds against what is owed, and what this cycle shares now
      let icrc3_undistributed : Nat = if (server_balance > total_distributed) { server_balance - total_distributed } else { 0 };
      icrc3_add("rll_reconciliation", [
        ("token", Icrc3Log.principal(token_id)), ("ledger_balance", #Nat(server_balance)), ("claimable", #Nat(claimable)),
        ("reserved", #Nat(reserved)), ("undistributed", #Nat(icrc3_undistributed)),
        ("underflow", #Nat(if (total_distributed > server_balance) { total_distributed - server_balance } else { 0 })),
        ("to_distribute", #Nat(if (icrc3_undistributed > 0) { get_distribution_amount(token_id, token_metadata, icrc3_undistributed) } else { 0 })),
        ("via", #Text("cycle")),
      ]);

      // 3. Calculate undistributed amount
      if (server_balance > total_distributed) {
        let undistributed = server_balance - total_distributed;

        // 4. Calculate distribution amount considering min and max limits
        let amount_to_distribute = get_distribution_amount(token_id, token_metadata, undistributed);

        Debug.print("Undistributed: " # debug_show(undistributed) # 
                   ", min distribution: " # debug_show(get_min_distribution_amount(token_id, token_metadata)) #
                   ", max distribution: " # debug_show(token_max_distributions.get(token_id)) #
                   ", will distribute: " # debug_show(amount_to_distribute));

        if (amount_to_distribute > 0) {
          Debug.print("Distributing amount: " # debug_show(amount_to_distribute));
          // 5. Distribute the calculated amount
          distribute_to_local_balances(
            amount_to_distribute,
            token_id,
            { id = 1 },  // First proposal
            { id = getHighestClosedProposalId() },  // Last imported proposal
            ?sneed_exclude_principal  // the exclusion principal's neurons get nothing
          );
        };
      };
    } catch e {
      // Log error but continue to next token
      Debug.print("Error processing token: " # Principal.toText(token_id) # " - " # Error.message(e));
    };

    // Move to next token
    processed_token_count += 1;

    // Schedule next tick if more tokens to process and haven't hit safety limit
    if (processed_token_count < total_tokens_to_process) {
      if (distribute_tokens_ticks < MAX_TICKS) {
        token_distribution_timer_id := ?Timer.setTimer<system>(#seconds 2, distribute_tokens_tick);
      } else {
        // Hit safety limit
        Debug.print("Hit safety limit for token distribution after " # debug_show(distribute_tokens_ticks) # " ticks");
        token_distribution_timer_id := cancel_timer(token_distribution_timer_id);
        current_distribution_token := null;
        processed_token_count := 0;
        total_tokens_to_process := 0;
      };
    } else {
      token_distribution_timer_id := cancel_timer(token_distribution_timer_id);
      current_distribution_token := null;
      processed_token_count := 0;
      total_tokens_to_process := 0;
    };
  };


  /*public shared ({ caller }) func distribute_amount(amount_to_share : Nat, icrc1_ledger_canister_id : Principal, first_proposal_id : T.ProposalId, last_proposal_id : T.ProposalId) : async () {
    assert is_admin(caller);
    distribute_to_local_balances(amount_to_share, icrc1_ledger_canister_id, first_proposal_id, last_proposal_id, ?sneed_exclude_principal);
  };*/


  public shared ({ caller }) func import_all_neurons() : async Result.Result<Text, Text> {
    if (not is_admin(caller)) {
        return #err("Caller is not admin");
    };
    
    // Cancel any existing timer
    switch(neuron_import_timer_id) {
      case (?_timer_id) {
        return #err("Neuron import already running");
      };
      case (null) { };
    };

    import_neuron_ticks := 0;
    import_next_neuron_id := null;
    neuron_import_timer_id := ?Timer.setTimer<system>(#seconds 0, import_next_neurons_tick);
    //await import_next_neurons_tick();
    icrc3_admin(caller, "neuron_import_start", [("mode", #Text("all"))]);
    #ok("Started full neuron import")
  };

  public shared ({ caller }) func import_all_new_neurons() : async Result.Result<Text, Text> {
    if (not is_admin(caller)) {
        return #err("Caller is not admin");
    };
    
    // Cancel any existing timer
    switch(neuron_import_timer_id) {
      case (?_timer_id) {
        return #err("Neuron import already running");
      };
      case (null) { };
    };

    import_neuron_ticks := 0;
    neuron_import_timer_id := ?Timer.setTimer<system>(#seconds 0, import_next_neurons_tick);
    icrc3_admin(caller, "neuron_import_start", [("mode", #Text("new"))]);
    await import_next_neurons_tick();
    #ok("Started incremental neuron import")
  };

  public shared ({ caller }) func import_all_proposals() : async Result.Result<Text, Text> {
    if (not is_admin(caller)) {
        return #err("Caller is not admin");
    };
    
    // Check if already running
    switch(proposal_import_timer_id) {
      case (?_timer_id) {
        return #err("Proposal import already running");
      };
      case (null) { };
    };

    import_prop_ticks := 0;
    imported_proposal_max := 0;
    proposal_import_timer_id := ?Timer.setTimer<system>(#seconds 0, import_proposals_tick);
    //await import_proposals_tick();
    icrc3_admin(caller, "proposal_import_start", [("mode", #Text("all")), ("from_proposal", Icrc3Log.nat64(imported_proposal_max + 1))]);
    #ok("Started full proposal import from " # debug_show(imported_proposal_max) # " with timer id " # debug_show(proposal_import_timer_id))
  };

  public shared ({ caller }) func import_all_new_proposals() : async Result.Result<Text, Text> {
    if (not is_admin(caller)) {
        return #err("Caller is not admin");
    };
    
    // Check if already running
    switch(proposal_import_timer_id) {
      case (?_timer_id) {
        return #err("Proposal import already running");
      };
      case (null) { };
    };

    import_prop_ticks := 0;
    imported_proposal_max := getHighestClosedProposalId();
    proposal_import_timer_id := ?Timer.setTimer<system>(#seconds 0, import_proposals_tick);
    //await import_proposals_tick();
    icrc3_admin(caller, "proposal_import_start", [("mode", #Text("new")), ("from_proposal", Icrc3Log.nat64(imported_proposal_max + 1))]);
    #ok("Started incremental proposal import from " # debug_show(imported_proposal_max) # " with timer id " # debug_show(proposal_import_timer_id))
  };

  public shared ({ caller }) func stop_neuron_import() : async Result.Result<Text, Text> {
    if (not is_admin(caller)) {
        return #err("Caller is not admin");
    };
    
    switch(neuron_import_timer_id) {
      case (?timer_id) {
        Timer.cancelTimer(timer_id);
        neuron_import_timer_id := null;
        icrc3_admin(caller, "neuron_import_stop", []);
        #ok("Stopped neuron import process with timer id " # debug_show(timer_id))
      };
      case (null) {
        #err("No neuron import process running")
      };
    };
  };

  public shared ({ caller }) func stop_proposal_import() : async Result.Result<Text, Text> {
    if (not is_admin(caller)) {
        return #err("Caller is not admin");
    };
    
    switch(proposal_import_timer_id) {
      case (?timer_id) {
        Timer.cancelTimer(timer_id);
        proposal_import_timer_id := null;
        import_prop_ticks := 0;
        icrc3_admin(caller, "proposal_import_stop", []);
        #ok("Stopped proposal import process from " # debug_show(imported_proposal_max) # " with timer id " # debug_show(timer_id))
      };
      case (null) {
        #err("No proposal import process running")
      };
    };
  };

  public query func get_neuron_import_status() : async Result.Result<Text, Text> {
    switch(neuron_import_timer_id) {
      case (?_) { #ok("Neuron import process is running") };
      case (null) { #ok("No neuron import process running") };
    };
  };

  public query func get_proposal_import_status() : async Result.Result<Text, Text> {
    switch(proposal_import_timer_id) {
      case (?_) { #ok("Proposal import process is running") };
      case (null) { #ok("No proposal import process running") };
    };
  };

  // PRIVATE METHODS

  private func is_admin(caller : Principal) : Bool {
    if (Principal.isController(caller)) { 
      return true;
    };
    if (caller == sneed_governance_canister_id) { 
      return true;
    };    

    for (admin in admin_principals.vals()) {
      if (Principal.equal(caller, admin)) {
        return true;
      };
    };

    false;
  };

  private func claim_hotkey_balance(hotkey : Principal, icrc1_ledger_canister_id : Principal, fee : Nat) : async T.TransferResult {
    event_sequence += 1;
    let seq = event_sequence;
    
    let owner_balances = await get_hotkey_owner_balances(hotkey, icrc1_ledger_canister_id);
    var total_balance : Nat = 0;

    for((owner, balance) in owner_balances.vals()) {
        total_balance += balance;
        assert decrease_balance(owner, icrc1_ledger_canister_id, balance);
    };

    let amount = if (total_balance >= fee) { total_balance - fee } else { 0 };

    // Nothing to claim (balance under the fee): hand the balances back and say so, without
    // writing a pending/failed pair into the claim log. This is the normal state of a hotkey
    // that has nothing accrued, not a failure.
    if (total_balance <= fee) {
        for((owner, balance) in owner_balances.vals()) {
            ignore increase_balance(owner, icrc1_ledger_canister_id, balance);
        };
        return #Err(#InsufficientFunds { balance = total_balance});
    };

    // Identifiers stamped onto the transfer so an ambiguous (thrown) outcome can be
    // reconciled later: the memo is a unique per-claim match key for the ledger's
    // get_transactions, and created_at_time is a deterministic time anchor. We do NOT
    // rely on ledger dedup here — not all ICRC1 ledgers implement it correctly.
    let claim_memo : Blob = Text.encodeUtf8("rll-claim:" # Nat.toText(seq));
    let claim_created_at : Nat64 = Nat64.fromNat(Int.abs(Time.now()));

    // Log that we're about to attempt the transfer
    log_claim(seq, hotkey, icrc1_ledger_canister_id, amount, fee, #Pending, null, null);

    // Debited but still on the ledger until the transfer answers: keep it out of distributions.
    add_in_flight(icrc1_ledger_canister_id, total_balance);


    try {
        let transfer_args : T.TransferArgs = {
            from_subaccount = null;
            to = {
                owner = hotkey;
                subaccount = null;
            };
            amount = amount;
            fee = ?fee;
            memo = ?claim_memo;
            created_at_time = ?claim_created_at;
        };


        let icrc1_ledger_canister = actor (Principal.toText(icrc1_ledger_canister_id)) : actor {
            icrc1_transfer(args : T.TransferArgs) : async T.TransferResult;
        };  

        let result = await icrc1_ledger_canister.icrc1_transfer(transfer_args);
        remove_in_flight(icrc1_ledger_canister_id, total_balance);

        switch (result) {
            case (#Ok(index)) {
                // Log successful claim with tx_index
                log_claim(seq, hotkey, icrc1_ledger_canister_id, amount, fee, #Success, null, ?index);
                icrc3_add("rll_claim", [
                    ("caller", Icrc3Log.principal(hotkey)), ("token", Icrc3Log.principal(icrc1_ledger_canister_id)),
                    ("amount", #Nat(amount)), ("fee", #Nat(fee)), ("total", #Nat(total_balance)),
                    ("owners", icrc3_owner_amounts(owner_balances)), ("to", Icrc3Log.account(hotkey, null)),
                    ("ledger_tx", #Nat(index)), ("seq", #Nat(seq)),
                ]);
            };
            case (#Err(err)) {
                // Log failed claim
                log_claim(seq, hotkey, icrc1_ledger_canister_id, amount, fee, #Failed, ?debug_show(err), null);
                
                for((owner, balance) in owner_balances.vals()) {
                    ignore increase_balance(owner, icrc1_ledger_canister_id, balance);
                };
            };
        };

        return result;

    } catch e {
        remove_in_flight(icrc1_ledger_canister_id, total_balance);
        log_claim(seq, hotkey, icrc1_ledger_canister_id, total_balance - fee, fee, #Failed, ?Error.message(e), null);

        // Classify the thrown call by its error code. These codes guarantee the
        // call never executed (not delivered, or the ledger trapped and rolled
        // back), so re-crediting the owners is safe and no manual step is needed.
        let not_executed = switch (Error.code(e)) {
            case (#system_fatal or #system_transient or #destination_invalid or #canister_error) { true };
            case _ { false };
        };
        if (not_executed) {
            for((owner, balance) in owner_balances.vals()) {
                ignore increase_balance(owner, icrc1_ledger_canister_id, balance);
            };
            return #Err(#GenericError { error_code = 1; message = Error.message(e); });
        };

        // Ambiguous outcome: the await threw with a code that does not rule out the
        // transfer having executed on the ledger. We must NOT re-credit — restoring the
        // balance after a transfer that actually landed would enable a double-withdrawal.
        // Instead, leave the owners debited and record a persistent incident carrying
        // everything needed to reconcile it manually (match the memo in the ledger's
        // get_transactions; re-credit the recorded owners via resolve_claim_incident if
        // it turns out the transfer never landed).
        let incident_id = create_claim_incident(
            seq,
            icrc1_ledger_canister_id,
            hotkey,
            owner_balances,
            total_balance,
            amount,
            fee,
            claim_memo,
            claim_created_at,
            Error.message(e)
        );
        icrc3_add("rll_claim_incident", [
            ("incident_id", #Nat(incident_id)), ("caller", Icrc3Log.principal(hotkey)), ("token", Icrc3Log.principal(icrc1_ledger_canister_id)),
            ("total", #Nat(total_balance)), ("amount", #Nat(amount)), ("fee", #Nat(fee)), ("owners", icrc3_owner_amounts(owner_balances)),
            ("seq", #Nat(seq)), ("memo", #Blob(claim_memo)), ("created_at_time", Icrc3Log.nat64(claim_created_at)), ("error", #Text(Error.message(e))),
        ]);
        return #Err(#GenericError {
            error_code = 1;
            message = "Transfer outcome unknown; balances were NOT re-credited. Incident #" # Nat.toText(incident_id) # " recorded for manual reconciliation. Underlying error: " # Error.message(e);
        });
    };
  };



  // Admin: list all recorded claim incidents (ambiguous-outcome transfer failures).
  public query ({ caller }) func list_claim_incidents() : async [T.ClaimIncident] {
    assert is_admin(caller);
    claim_incidents;
  };

  // Admin: resolve an incident after checking the ledger (e.g. via get_transactions,
  // matching the incident's memo). Pass landed = true if the transfer DID execute
  // (nothing owed — just close it), or landed = false if it never executed, in which
  // case the recorded owners are re-credited exactly what they were debited.
  public shared ({ caller }) func resolve_claim_incident(id : Nat, landed : Bool) : async Result.Result<Text, Text> {
    if (not is_admin(caller)) {
      return #err("Caller is not admin");
    };

    var target : ?T.ClaimIncident = null;
    claim_incidents := Array.map<T.ClaimIncident, T.ClaimIncident>(claim_incidents, func (inc) {
      if (inc.id == id and not inc.resolved) {
        target := ?inc;
        {
          inc with
          resolved = true;
          landed = ?landed;
          resolved_at = ?Nat64.fromNat(Int.abs(Time.now()));
        }
      } else { inc }
    });

    switch (target) {
      case (null) { #err("Incident #" # Nat.toText(id) # " not found or already resolved"); };
      case (?inc) {
        icrc3_add("rll_claim_incident_resolve", Array.append<(Text, T3.Value)>([
          ("caller", Icrc3Log.principal(caller)), ("incident_id", #Nat(id)), ("token", Icrc3Log.principal(inc.token_id)),
          ("landed", #Nat(if (landed) 1 else 0)), ("recredited", #Nat(if (landed) 0 else inc.total)),
        ], if (landed) { [] } else { [("owners", icrc3_owner_amounts(inc.owners))] }));
        if (not landed) {
          // Transfer never executed → make the owners whole by restoring exactly
          // what was debited.
          for ((owner, amt) in inc.owners.vals()) {
            ignore increase_balance(owner, inc.token_id, amt);
          };
          #ok("Incident #" # Nat.toText(id) # " resolved: transfer did not land, " # Nat.toText(inc.owners.size()) # " owner balance(s) re-credited");
        } else {
          #ok("Incident #" # Nat.toText(id) # " resolved: transfer confirmed landed, no re-credit");
        };
      };
    };
  };

  // returns (owner, amount) pairs for balances of the owner accounts of neurons tagged by the given hotkey, for a given token
  private func get_hotkey_owner_balances(hotkey : Principal, icrc1_ledger_canister_id : Principal) : async [(Principal, Nat)] {
    let owners = await get_hotkey_owners(hotkey);
    let ledger_amounts = Map.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash); 
    for (owner in owners.vals()) {
      switch (balances.get(owner)) {
        case (null) { };
        case (?local_balances) {
          for (local_balance in local_balances.balances.vals()) {
            if (local_balance.icrc1_ledger_canister_id == icrc1_ledger_canister_id) {
              ledger_amounts.put(owner, local_balance.amount);
            };
          };
        };
      };
    };
    Iter.toArray(ledger_amounts.entries());
  };

  private func get_hotkey_balances(hotkey : Principal) : async [(Principal, Nat)] {
    let owners = await get_hotkey_owners(hotkey);
    get_balances_from_owners(owners);
  };

  private func get_balances_from_owners(owners : [Principal]) : [(Principal, Nat)] {
    let ledger_amounts = Map.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash); 
    for (owner in owners.vals()) {
      switch (balances.get(owner)) {
        case (null) { };
        case (?local_balances) {
          for (local_balance in local_balances.balances.vals()) {
            let existing_amount = switch (ledger_amounts.get(local_balance.icrc1_ledger_canister_id)) {
              case (null) { 0; };
              case (?existing) { existing; };
            };
            ledger_amounts.put(local_balance.icrc1_ledger_canister_id, existing_amount + local_balance.amount);
          };
        };
      };
    };
    Iter.toArray(ledger_amounts.entries());
  };


  private func get_hotkey_owners(hotkey : Principal) : async [Principal] {

    let owners = Map.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

    // Call list_neurons for caller
    let result = await sneed_gov_canister.list_neurons({ 
      of_principal = ?hotkey;
      limit = 100;
      start_page_at = null; 
    });

    // Iterate over the batch of neurons returned by the governance canister.
    for (neuron in result.neurons.vals()) {      

      //get owner for each neuron
      switch (get_neuron_owner(neuron)) {
        case (null) { };
        case (?neuron_owner) { 
          switch (owners.get(neuron_owner)) {
            case (null) {
              owners.put(neuron_owner, 1);
            };
            case (?existing) {
              owners.put(neuron_owner, existing + 1);
            };
          };
        };
      };

    };

    Iter.toArray(owners.keys());
  };

  private func get_hotkey_owners_from_neurons(neurons : [T.Neuron]) : [Principal] {
    let owners = Map.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

    // Iterate over the provided neurons array
    for (neuron in neurons.vals()) {      
      //get owner for each neuron
      switch (get_neuron_owner(neuron)) {
        case (null) { };
        case (?neuron_owner) { 
          switch (owners.get(neuron_owner)) {
            case (null) {
              owners.put(neuron_owner, 1);
            };
            case (?existing) {
              owners.put(neuron_owner, existing + 1);
            };
          };
        };
      };
    };

    Iter.toArray(owners.keys());
  };

  private func distribute_to_local_balances(amount_to_share : Nat, icrc1_ledger_canister_id : Principal, first_proposal_id : T.ProposalId, last_proposal_id : T.ProposalId, exclude_principal : ?Principal) : () {

    // get the list of people to distribute to
    let dist = calc_distribution(first_proposal_id, last_proposal_id, amount_to_share, exclude_principal);
    let dist_list = dist.shares;

    // Only record if we actually distributed something
    if (dist_list.size() > 0) {
      let timestamp = Time.now();
      let proposal_range = {
        first = first_proposal_id.id;
        last = last_proposal_id.id;
      };

      var total_distributed : Nat = 0;

      for ((owner, amount) in dist_list.vals()) {
        ignore increase_balance(owner, icrc1_ledger_canister_id, amount);
        // Record per-user distribution
        record_user_distribution(owner, icrc1_ledger_canister_id, amount);
        total_distributed += amount;

        // Log the user distribution event
        append_user_distribution_event({
          user = owner;
          token_id = icrc1_ledger_canister_id;
          amount = amount;
          timestamp = timestamp;
          proposal_range = proposal_range;
        });
      };

      assert (amount_to_share >= total_distributed);

      // Record the total distribution for this token
      record_distribution(icrc1_ledger_canister_id, total_distributed);
      
      // Log the distribution event
      append_distribution_event({
        token_id = icrc1_ledger_canister_id;
        amount = total_distributed;
        timestamp = timestamp;
        proposal_range = proposal_range;
      });

      // ICRC-3: every owner is credited (same message, no await since): the summary, then
      // one block per non-zero credit pointing back at it.
      let token_v = Icrc3Log.principal(icrc1_ledger_canister_id);
      var credited_owners = 0;
      for ((_, amount) in dist_list.vals()) { if (amount > 0) { credited_owners += 1 } };
      let summary = icrc3_add_i("rll_distribution", [
        ("token", token_v), ("amount", #Nat(total_distributed)), ("requested", #Nat(amount_to_share)),
        ("owners", #Nat(credited_owners)), ("neurons", #Nat(dist.neurons)), ("voting_power", Icrc3Log.nat64(dist.vp_total)),
        ("first_proposal", Icrc3Log.nat64(first_proposal_id.id)), ("last_proposal", Icrc3Log.nat64(last_proposal_id.id)), ("via", #Text("cycle")),
      ]);
      for ((owner, amount) in dist_list.vals()) {
        if (amount > 0) {
          let vp = switch (dist.owner_vp.get(owner)) { case (?v) v; case null 0 };
          icrc3_add("rll_credit", [
            ("owner", Icrc3Log.principal(owner)), ("token", token_v), ("amount", #Nat(amount)),
            ("voting_power", #Nat(vp)), ("distribution", #Nat(summary)),
          ]);
        };
      };
    };
  };


  private func increase_balance(owner : Principal, icrc1_ledger_canister_id : Principal, amount : Nat) : Nat {
    let balance = get_balance(owner, icrc1_ledger_canister_id);
    let new_balance = balance + amount; 
    set_balance(owner, icrc1_ledger_canister_id, new_balance);
    new_balance;
  };

  private func decrease_balance(owner : Principal, icrc1_ledger_canister_id : Principal, amount : Nat) : Bool {
    let balance = get_balance(owner, icrc1_ledger_canister_id);
    if (balance < amount) {
      return false;
    };
    let new_balance : Nat = balance - amount; 
    //let new_balance : Nat = if (balance >= amount) { balance - amount; } else { 0; /* log this */ }; 
    set_balance(owner, icrc1_ledger_canister_id, new_balance);
    true;
  };

  private func get_balance(owner : Principal, icrc1_ledger_canister_id : Principal) : Nat {
    switch (balances.get(owner)) {
      case (null) { return 0; };
      case (?local_balances) {
        for (local_balance in local_balances.balances.vals()) {
          if (local_balance.icrc1_ledger_canister_id == icrc1_ledger_canister_id) {
            return local_balance.amount;
          };
        };
      };
    };
    0;
  };

  private func set_balance(owner : Principal, icrc1_ledger_canister_id : Principal, new_balance : Nat) : () {

    let new_local_balance : T.LocalBalance = {
      icrc1_ledger_canister_id = icrc1_ledger_canister_id;
      var amount = new_balance;
    };

    switch (balances.get(owner)) {
      case (null) { 

        let new_local_balances : T.LocalBalances = {
          var balances = [new_local_balance];
        };

        balances.put(owner, new_local_balances);

       };
      case (?local_balances) {
        for (local_balance in local_balances.balances.vals()) {
          if (local_balance.icrc1_ledger_canister_id == icrc1_ledger_canister_id) {
            local_balance.amount := new_balance;
            return;
          };
        };

        // Append
        local_balances.balances := Array.append(local_balances.balances, [new_local_balance]);
      };
    };
  };

  // The shares of a distribution, plus what the ICRC-3 log reports about them: each
  // owner's cast voting power in the range, the number of neurons that counted and the
  // total voting power (the basis of every share). The shares are computed as they always were.
  private func calc_distribution(first_proposal_id : T.ProposalId, last_proposal_id : T.ProposalId, amount_to_share : Nat, exclude_principal : ?Principal) : {
    shares : [(Principal, Nat)];
    owner_vp : Map.HashMap<Principal, Nat>;
    neurons : Nat;
    vp_total : Nat64;
  } {

    let votes = index_proposal_votes_between(first_proposal_id, last_proposal_id);
    let vp_total = sum_votes_total(votes, exclude_principal);
    let shares = Map.HashMap<Principal, Nat>(votes.size(), Principal.equal, Principal.hash);
    let owner_vp = Map.HashMap<Principal, Nat>(votes.size(), Principal.equal, Principal.hash);
    var neurons_counted : Nat = 0;

    let exclude : Principal = switch (exclude_principal) {
      case (null) { Principal.fromText("2vxsx-fae"); };
      case (?principal) { principal; };
    };

    for (neuron_id in votes.keys()) {
      switch (owners.get(neuron_id)) {
        case (null) { };
        case (?owner) {

          if (not (Principal.equal(exclude, owner))) {

            switch (votes.get(neuron_id)) {
              case (null) { };
              case (?vp) { 

                  // Multiple neurons can be owned by the same principal
                  let existing_vp : Nat = switch (shares.get(owner)) {
                    case (null) { 0; };
                    case (?existing) { existing; };
                  };

                  let share_of_total : Float = float_from_nat64(vp) / float_from_nat64(vp_total);
                  let share : Float = share_of_total * Float.fromInt(amount_to_share);
                  let floored_share: Nat = Int.abs(Float.toInt(Float.floor(share))) + existing_vp;

                  shares.put(owner, floored_share);

                  let owner_vp_before : Nat = switch (owner_vp.get(owner)) { case (?v) v; case null 0 };
                  owner_vp.put(owner, owner_vp_before + Nat64.toNat(vp));
                  neurons_counted += 1;

              };
            };
          };
        };
      };
    };

    { shares = Iter.toArray(shares.entries()); owner_vp; neurons = neurons_counted; vp_total };
  };

  private func sum_votes_total(votes : Map.HashMap<Blob, Nat64>, exclude_principal : ?Principal) : Nat64 {

    let exclude : Principal = switch (exclude_principal) {
      case (null) { Principal.fromText("2vxsx-fae"); };
      case (?principal) { principal; };
    };

    var total : Nat64 = 0;
    for ((neuron_id, vote) in votes.entries()) {
      switch (owners.get(neuron_id)) {
        case (null) { };
        case (?owner) { 
          if (not (Principal.equal(owner, exclude))) {
            total := total + vote;
          };
        };
      };
    };

    total;
  };

  private func import_next_neurons_tick<system>() : async () {
    // Check if we still have an active timer
    switch(neuron_import_timer_id) {
      case (null) { return; };
      case (?_) { };
    };

    import_neuron_ticks += 1;
    Debug.print("import_neuron_ticks: " # debug_show(import_neuron_ticks) # ", import_next_neuron_id: " # debug_show(import_next_neuron_id) # ", owners.size(): " # debug_show(owners.size()));
    switch (await import_neuron_batch(import_next_neuron_id, 1000, 100)) {
      case (null) { 
        // Actually done - no more neurons
        switch(neuron_import_timer_id) {
          case (?timer_id) {
            Timer.cancelTimer(timer_id);
            neuron_import_timer_id := null;
          };
          case (null) { };
        };
      };
      case (?last) {
        import_next_neuron_id := ?last;
        if (import_neuron_ticks < MAX_TICKS) {
          neuron_import_timer_id := ?Timer.setTimer<system>(#seconds 2, import_next_neurons_tick)
        } else {
          // Hit safety limit
          switch(neuron_import_timer_id) {
            case (?timer_id) {
              Timer.cancelTimer(timer_id);
              neuron_import_timer_id := null;
            };
            case (null) { };
          };
        };
      };
    };
  };

  private func import_neuron_batch(start_neuron_id : ?T.NeuronId, max : Nat32, batch_size : Nat32) : async ?T.NeuronId {

    // Variable to hold the neuron id of the last imported neuron
    var last : ?T.NeuronId = null;

    // Variable to hold the neuron id to import from in each call to the SNS1 governance canister. 
    var curr : ?T.NeuronId = start_neuron_id;

    // Variable to track hom many neurons have been imported in this call to the function. 
    var cnt : Nat32 = 0;

    // Flag to indicate if the last batch returned from the SNS1 governance canister was 
    // smaller than the requested batch size, indicating we've reached the end of the list and should stop.
    var stop = false;

    // Fetch neurons in batches until we reach the max number of neurons to import or until 
    // the SNS1 governance canister returns a batch smaller than the requested batch size. 
    while (cnt < max and stop == false) {

      Debug.print("import_neuron_batch: " # debug_show(cnt) # ", max: " # debug_show(max) # ", stop: " # debug_show(stop));
      // Fetch the vatch of neurons from the governance canister.
      let result = await sneed_gov_canister.list_neurons({ 
        of_principal = null;
        limit = batch_size;
        start_page_at = curr; 
      });

      // Iterate over the batch of neurons returned by the governance canister.
      for (neuron in result.neurons.vals()) {      

        // Ensure the neuron has an id.
        switch (neuron.id) {
          case (null) { Debug.trap("Null neuron id!"); };
          case (?id) {

            // Store the neuron in the HashMap using its id as key.
            neurons.put(id.id, neuron);
            switch (get_neuron_owner(neuron)) {
              case (null) { };
              case (?neuron_owner) { owners.put(id.id, neuron_owner); };
            };
            
            // Store away the neuron id in the curr and last variables.
            curr := neuron.id;
            last := neuron.id;
          };
        };
      };

      // If the last batch returned from the SNS1 governance canister was smaller than the requested 
      // batch size, raise stop flag to indicate we've reached the end of the list and should stop.
      if (Nat32.fromNat(result.neurons.size()) < batch_size) {
        stop := true;
        last := null;
      };
 
      // Increase the count of how many neurons we have imported by the batch size.
      cnt := cnt + batch_size;

    };

    // Return the neuron id of the last imported neuron.
    last;    

  };

//first_proposal_id : T.ProposalId, last_proposal_id : T.ProposalId

  private func import_proposals_tick<system>() : async () {
    // Check if we still have an active timer
    switch(proposal_import_timer_id) {
      case (null) { return; };
      case (?_) { };
    };

    let batch_size : Nat64 = 10;
    var proposal_id : Nat64 = imported_proposal_max + 1;
    var first : Nat64 = proposal_id;
    var last : Nat64 = first + batch_size;

    import_prop_ticks += 1;
    Debug.print("import_prop_ticks: " # debug_show(import_prop_ticks) # ", proposal_id: " # debug_show(proposal_id) # ", last: " # debug_show(last));

    while (Nat64.greaterOrEqual(last, proposal_id)) {
      if (not (await import_proposal({ id = proposal_id; }))) {
        // No more proposals found
        switch(proposal_import_timer_id) {
          case (?timer_id) {
            Timer.cancelTimer(timer_id);
            proposal_import_timer_id := null;
          };
          case (null) { };
        };
        return;
      };
      proposal_id += 1;
    };

    if (import_prop_ticks < MAX_TICKS) {
      proposal_import_timer_id := ?Timer.setTimer<system>(#seconds 2, import_proposals_tick)
    } else {
      // Hit safety limit
      switch(proposal_import_timer_id) {
        case (?timer_id) {
          Timer.cancelTimer(timer_id);
          proposal_import_timer_id := null;
        };
        case (null) { };
      };
    };
  };

  private func import_proposal(proposal_id : T.ProposalId) : async Bool { 
    switch (await fetch_proposal_data(proposal_id)) {
        case (null) { false; };
        case (?prop_data) { 
            let prop_int_id = Int64.toInt(Int64.fromNat64(proposal_id.id));
            Debug.print("import_proposal: " # debug_show(prop_int_id));
            // Check if we already have this proposal
            switch (props.get(prop_int_id)) {
                case (?existing_prop) {
                    // Count ballots in both versions
                    let existing_ballot_count = Iter.size(existing_prop.ballots.vals());
                    let new_ballot_count = Iter.size(prop_data.ballots.vals());
                    
                    // Only update if new version has same or more ballots
                    if (new_ballot_count >= existing_ballot_count) {
                        props.put(prop_int_id, prop_data);
                    };
                    // Otherwise keep existing version with more ballots
                };
                case (null) {
                    // New proposal, just add it
                    props.put(prop_int_id, prop_data);
                };
            };
            
            if (Nat64.greater(proposal_id.id, imported_proposal_max)) {
                imported_proposal_max := proposal_id.id;
            };

            true;
        };
    };
  };

  //private func clear_votes() : () { for (key in votes.keys()) { votes.delete(key); }; };

  private func index_proposal_votes_between(first_proposal_id : T.ProposalId, last_proposal_id : T.ProposalId) : Map.HashMap<Blob, Nat64> { 

    var votes = Map.HashMap<Blob, Nat64>(100, Blob.equal, Blob.hash);

    var proposal_id : Nat64 = first_proposal_id.id;
    var first = first_proposal_id.id;
    var last = last_proposal_id.id;

    if (Nat64.greater(first, last)) {
      first := last;
      last := proposal_id;
      proposal_id := first;
    };

    while (Nat64.greaterOrEqual(last, proposal_id)) {
      switch (props.get(int_from_nat64(proposal_id))) {
        case (null) { return votes; };
        case (?prop_data) { 
          index_proposal_votes(votes, prop_data);
        };
      };
      proposal_id += 1;
    };

    votes;
  };

  private func index_proposal_votes(votes : Map.HashMap<Blob, Nat64>, proposal_data : T.ProposalData) : () { 

    // index voting power in proposal.
    for ((neuron_hex_text_id, ballot) in proposal_data.ballots.vals()) {
      if (ballot.vote != 0) {
        let vp = ballot.voting_power;
        increase_votes(votes, hex_text_to_blob(neuron_hex_text_id), vp);
      };
    };

  };

  private func increase_votes(votes : Map.HashMap<Blob, Nat64>, neuron_id : Blob, vp : Nat64) {
    switch (votes.get(neuron_id)) {
      case (null) {
        votes.put(neuron_id, vp);
      };
      case (?old_vp) {
        votes.put(neuron_id, old_vp + vp);
      };
    };
  };

  private func fetch_proposal_data(proposal_id : T.ProposalId) : async ?T.ProposalData { 
    let result = await sneed_gov_canister.get_proposal({
      proposal_id = ?proposal_id;
    });
    switch (result.result) {
      case (null) { null; };
      case (?proposal_data) { 
        switch (proposal_data) {
          case (#Proposal(data)) { ?data };
          case _ { null};
        };
      };
    };
  };

  private func get_neuron_owner(neuron : T.Neuron) : ?Principal {
    var found : ?Principal = null;
    for (permission in neuron.permissions.vals()) {

      found := permission.principal;
      if (permission.permission_type.size() > 7) {
        return found;
      }
    };   

    found;
  };


  private func blob_to_hex_text(blob : Blob) : Text {
    let bytes = Blob.toArray(blob);
    let hex_chars = "0123456789abcdef";
    Array.foldLeft<Nat8, Text>(
      bytes,
      "",
      func (acc, byte) {
        let hi = Nat8.toNat(byte >> 4);
        let lo = Nat8.toNat(byte & 0x0f);
        acc # Text.fromChar(Text.toArray(hex_chars)[hi])
            # Text.fromChar(Text.toArray(hex_chars)[lo])
      }
    );
  };

  private func hex_text_to_blob(hex_text : Text) : Blob {

    // Step 1: Convert the Text to an array of characters
    let hex_arr : [Char] = Text.toArray(hex_text);

    // Step 2: Convert the array of characters into an array of Nat8 values
    let byte_arr : [Nat8] = Array.tabulate<Nat8>(
      hex_arr.size() / 2,
      func(i : Nat) : Nat8 {
        let hex_char1 : Nat8 = hex_char_to_nat8(hex_arr[2 * i]);      // First hex character
        let hex_char2 : Nat8 = hex_char_to_nat8(hex_arr[2 * i + 1]);  // Second hex character
        let byte : Nat8 = (hex_char1 * 16) + hex_char2;              // Combine to form a full byte
        byte
      }
    );

    // Step 3: Create a Blob from the array of Nat8 values
    let blob : Blob = Blob.fromArray(byte_arr);

    return blob;
  };


  // Helper function to convert a single hex character into its Nat8 value
  func hex_char_to_nat8(hex_char: Char): Nat8 {
      switch (hex_char) {
          case '0' { 0 };
          case '1' { 1 };
          case '2' { 2 };
          case '3' { 3 };
          case '4' { 4 };
          case '5' { 5 };
          case '6' { 6 };
          case '7' { 7 };
          case '8' { 8 };
          case '9' { 9 };
          case 'a' { 10 };
          case 'b' { 11 };
          case 'c' { 12 };
          case 'd' { 13 };
          case 'e' { 14 };
          case 'f' { 15 };
          case 'A' { 10 };
          case 'B' { 11 };
          case 'C' { 12 };
          case 'D' { 13 };
          case 'E' { 14 };
          case 'F' { 15 };
          case (_) { 0 };  // Default case for invalid characters
      }
  };

  private func int_from_nat64(nat64 : Nat64) : Int { Int64.toInt(Int64.fromNat64(nat64)); };
  private func float_from_nat64(nat64 : Nat64) : Float { Float.fromInt(int_from_nat64(nat64)); };

  system func preupgrade() {
    // Move transient state into persistent state before upgrading the canister,
    // stashing it away so it survives the canister upgrade.
    stable_neurons := Iter.toArray(neurons.entries());
    stable_owners := Iter.toArray(owners.entries());
    stable_props := Iter.toArray(props.entries());
    stable_balances := Iter.toArray(balances.entries());
    stable_whitelisted_tokens := Iter.toArray(whitelisted_tokens.entries());
    stable_known_tokens := Iter.toArray(known_tokens.entries());
    stable_total_distributions := Iter.toArray(total_distributions.entries());
    stable_user_distributions := Iter.toArray(user_distributions.entries());
    stable_distribution_events := Buffer.toArray(distribution_events);
    stable_user_distribution_events := Buffer.toArray(user_distribution_events);
    stable_claim_events := Buffer.toArray(claim_events);
    // Add to existing preupgrade
    stable_wallet_known_tokens := Array.map<(Principal, HashMap.HashMap<Principal, T.TokenMetadata>), (Principal, [(Principal, T.TokenMetadata)])>(
      Iter.toArray(wallet_known_tokens.entries()),
      func((wallet, tokens)) : (Principal, [(Principal, T.TokenMetadata)]) {
        (wallet, Iter.toArray(tokens.entries()))
      }
    );
    stable_token_min_distributions := Iter.toArray(token_min_distributions.entries());
    stable_token_max_distributions := Iter.toArray(token_max_distributions.entries());
  };

  // System Function //
  // Runs after the canister is upgraded
  system func postupgrade() {
    // Clear persistent state after upgrading the canister
    stable_neurons := [];
    stable_owners := [];
    stable_props := [];
    stable_balances := [];
    stable_whitelisted_tokens := [];
    stable_known_tokens := [];
    stable_total_distributions := [];
    stable_user_distributions := [];
    stable_distribution_events := [];
    stable_user_distribution_events := [];
    stable_claim_events := [];
    // Add to existing postupgrade
    stable_wallet_known_tokens := [];
    stable_token_min_distributions := [];
    stable_token_max_distributions := [];

    // the event statistics' counters and the per-owner index (transient): one pass over the lists
    rebuild_event_stats();

    recover_timers_after_upgrade<system>();

    // ICRC-3: certified data does not survive an upgrade; the spill timer is (re)started
    Icrc3Log.certify(icrc3);
    ensure_icrc3_timer<system>();
    postupgrade_instructions := IC.performanceCounter(0);
  };

  // Timers do not survive an upgrade, but their ids are stable variables: left alone, every
  // process would report itself running (and refuse to start) while nothing is scheduled.
  // The stale ids are dropped without cancelling them (timer ids restart after an upgrade,
  // so a stale id may name a new timer). Then:
  // - a distribution cycle the upgrade interrupted is restarted from its first stage. This
  //   cannot pay anything twice: each token is shared in one message (no await between
  //   computing and crediting), and a restarted cycle recomputes what is undistributed from
  //   the ledger balance minus the local balances and the reserved amounts.
  // - the main loop, if it was enabled, is re-armed on its schedule: last cycle start +
  //   interval, or at once if that is past.
  // Manual imports and balance checks the upgrade interrupted are left stopped (idle).
  private func recover_timers_after_upgrade<system>() {
    let loop_was_enabled = main_loop_timer_id != null;
    let cycle_was_running = distribution_cycle_timer_id != null or orchestrator_stage != #idle;

    main_loop_timer_id := null;
    distribution_cycle_timer_id := null;
    neuron_import_timer_id := null;
    proposal_import_timer_id := null;
    token_distribution_timer_id := null;
    token_balance_check_timer_id := null;
    wallet_token_check_timer_id := null;

    orchestrator_stage := #idle;
    import_prop_ticks := 0;
    import_neuron_ticks := 0;
    distribute_tokens_ticks := 0;
    import_next_neuron_id := null;
    processed_token_count := 0;
    total_tokens_to_process := 0;
    current_distribution_token := null;
    tokens_to_check := [];
    current_token_check_index := 0;
    token_check_ticks := 0;
    wallet_tokens_to_check := [];
    current_wallet_token_check_index := 0;
    wallet_token_check_ticks := 0;
    current_wallet_being_checked := null;

    if (cycle_was_running) {
      begin_distribution_cycle<system>();
    };

    if (loop_was_enabled) {
      let now = Int.abs(Time.now());
      let interval_ns = main_loop_frequence_seconds * 1_000_000_000;
      let due = switch (cycle_last_started) {
        case (?started) { started + interval_ns };
        case (null) { now };
      };
      let delay_seconds : Nat = if (due > now) { (due - now) / 1_000_000_000 } else { 0 };
      main_loop_next_scheduled := ?(now + delay_seconds * 1_000_000_000);
      main_loop_timer_id := ?Timer.setTimer<system>(#seconds delay_seconds, main_loop_tick);
    };
  };


//ADMIN

  // The reset tools log what they removed (ICRC-3 rll_admin_action). Clearing balances
  // makes what they owed undistributed again: the block lists the totals per token.
  public shared ({ caller }) func clear_balances() : async () { 
    assert is_admin(caller);
    let owners_before = balances.size();
    let totals_before = icrc3_ledger_amounts(get_all_token_balances());
    for (key in balances.keys()) { balances.delete(key); }; 
    icrc3_admin(caller, "clear_balances", [("owners", #Nat(owners_before)), ("totals", totals_before)]);
  };

  public shared ({ caller }) func clear_total_distributions() : async () { 
    assert is_admin(caller);
    let totals_before = icrc3_ledger_amounts(Iter.toArray(total_distributions.entries()));
    for (key in total_distributions.keys()) { total_distributions.delete(key); };
    icrc3_admin(caller, "clear_total_distributions", [("totals", totals_before)]);
  };

  public shared ({ caller }) func clear_user_distributions() : async () { 
    assert is_admin(caller);
    let count = user_distributions.size();
    for (key in user_distributions.keys()) { user_distributions.delete(key); };
    icrc3_admin(caller, "clear_user_distributions", [("count", #Nat(count))]);
  };

  public shared ({ caller }) func clear_user_distribution_events() : async () { 
    assert is_admin(caller);
    let count = user_distribution_events.size();
    user_distribution_events.clear(); 
    rebuild_event_stats();
    icrc3_admin(caller, "clear_user_distribution_events", [("count", #Nat(count))]);
  };

  public shared ({ caller }) func clear_distribution_events() : async () { 
    assert is_admin(caller);
    let count = distribution_events.size();
    distribution_events.clear(); 
    rebuild_event_stats();
    icrc3_admin(caller, "clear_distribution_events", [("count", #Nat(count))]);
  };

  public shared ({ caller }) func clear_claim_events() : async () { 
    assert is_admin(caller);
    let count = claim_events.size();
    claim_events.clear(); 
    rebuild_event_stats();
    icrc3_admin(caller, "clear_claim_events", [("count", #Nat(count))]);
  };
  
  public shared ({ caller }) func clear_all_balances_and_distributions() : async () { 
    assert is_admin(caller);
    let owners_before = balances.size();
    let totals_before = icrc3_ledger_amounts(get_all_token_balances());
    let counts = [
      ("distribution_events", #Nat(distribution_events.size()) : T3.Value),
      ("user_distribution_events", #Nat(user_distribution_events.size())),
      ("claim_events", #Nat(claim_events.size())),
    ];
    for (key in balances.keys()) { balances.delete(key); }; 
    for (key in total_distributions.keys()) { total_distributions.delete(key); };
    for (key in user_distributions.keys()) { user_distributions.delete(key); };
    user_distribution_events.clear(); 
    distribution_events.clear(); 
    claim_events.clear(); 
    rebuild_event_stats();
    icrc3_admin(caller, "clear_all_balances_and_distributions", Array.append<(Text, T3.Value)>([("owners", #Nat(owners_before)), ("totals", totals_before)], counts));
  };


  public query func get_imported_proposal_max() : async Nat64 { imported_proposal_max; };
  public query func get_import_next_neuron_id() : async ?T.NeuronId { import_next_neuron_id; };

  public query func imported_neurons_count() : async Nat { neurons.size(); };
  public query func imported_owners_count() : async Nat { owners.size(); };
  public query func imported_props_count() : async Nat { props.size(); };
  public query func balances_count() : async Nat { balances.size(); };

  public shared ({ caller }) func clear_imported_neurons() : async () { 
    assert is_admin(caller);
    let count = neurons.size();
    for (key in neurons.keys()) { neurons.delete(key); }; 
    icrc3_admin(caller, "clear_imported_neurons", [("count", #Nat(count))]);
  };
  public shared ({ caller }) func clear_imported_owners() : async () { 
    assert is_admin(caller);
    let count = owners.size();
    for (key in owners.keys()) { owners.delete(key); }; 
    icrc3_admin(caller, "clear_imported_owners", [("count", #Nat(count))]);
  };
  public shared ({ caller }) func clear_imported_props() : async () {
    assert is_admin(caller);
    let count = props.size();
    for (key in props.keys()) { props.delete(key); }; 
    icrc3_admin(caller, "clear_imported_props", [("count", #Nat(count))]);
  };

/*

  public shared ({ caller }) func test_set_balance(owner : Principal, icrc1_ledger_canister_id : Principal, new_balance : Nat) : async () {
    assert is_admin(caller);
    set_balance(owner, icrc1_ledger_canister_id, new_balance);
  };

  public query func imported_votes() : async [(Blob, Nat64)]  { 
    Iter.toArray(votes.entries());
   };


  public query func get_votes_total(exclude_principal : ?Principal) : async Nat64 {
    sum_votes_total(exclude_principal);
  };




  public shared func test_get_neuron() : async T.GetNeuronResponse {

    let neuron_id = hex_text_to_blob("0087a913ad22c47b9bd6057e16d34d5951bc7c84f69c0e1566f3327251e5cdde");

      let result = await sneed_gov_canister.get_neuron({
        neuron_id = ?{ id = neuron_id; };
      });

    result;

  };

  public shared query func test_blob() : async Blob {
    hex_text_to_blob("0087a913ad22c47b9bd6057e16d34d5951bc7c84f69c0e1566f3327251e5cdde");
  };

  public shared ({ caller }) func test_import_proposal(proposal_id : T.ProposalId) : async Bool {
    await import_proposal(proposal_id);
  };


  public query func test_get_all_balances () : async Text { 
    var t : Text = "";
    for (key in balances.keys()) {
      t := t # debug_show(key) # " : " # debug_show(balances.get(key)) # "; ";
    };
    t;
  };

  public query func imported_prop(proposal_id : Int) : async ?T.ProposalData  { 
    props.get(proposal_id);
  };


  public query func test_get_balances(owner : Principal) : async [(Principal, Nat)] { // Ledger and amount
    switch (balances.get(owner)) {
      case (null) { []; };
      case (?local_balances) {
        let ledger_amounts = Map.HashMap<Principal, Nat>(local_balances.balances.size(), Principal.equal, Principal.hash); 
        for (local_balance in local_balances.balances.vals()) {
          ledger_amounts.put(local_balance.icrc1_ledger_canister_id, local_balance.amount);
        };
        Iter.toArray(ledger_amounts.entries());
      };
    };
  };

  public shared func test_inc_balance(owner : Principal, icrc1_ledger_canister_id : Principal, amount : Nat) : async Nat {
    increase_balance(owner, icrc1_ledger_canister_id, amount);
  };

  public shared func test_dec_balance(owner : Principal, icrc1_ledger_canister_id : Principal, amount : Nat) : async Bool {
    decrease_balance(owner, icrc1_ledger_canister_id, amount);
  };

  public shared func test_get_hotkey_balances(hotkey : Principal) : async [(Principal, Nat)] {
    await get_hotkey_balances(hotkey);
  };

  public shared ({ caller }) func test_claim_full_hotkey_balance(hotkey : Principal, icrc1_ledger_canister_id : Principal, fee : Nat) : async [T.ClaimResult] {
    await claim_hotkey_balance(hotkey, icrc1_ledger_canister_id, fee);
  };


  public shared func test_import_neurons(start_neuron_id : ?T.NeuronId, max : Nat32, batch_size : Nat32) : async ?T.NeuronId {
    await import_neuron_batch(start_neuron_id, max, batch_size);
  };


  public shared func test_get_hotkey_owners(hotkey : Principal) : async [Principal] {
    await get_hotkey_owners(hotkey);
  };

  public query func test_get_distribution_list(amount_to_share : Nat, exclude_principal : ?Principal) : async [(Principal, Nat)] {
    calc_distribution_list(amount_to_share, exclude_principal);
  };
*/

//UNUSED
/*
  private func get_hotkey_token_balance(hotkey : Principal, icrc1_ledger_canister_id : Principal) : async Nat {
    for ((ledger, amount) in (await get_hotkey_balances(hotkey)).vals()) {
      if (ledger == icrc1_ledger_canister_id) {
        return amount;
      };
    };
    0;
  };

*/

  public shared ({ caller }) func add_known_token(token_ledger_id : Principal) : async () {
    assert is_admin(caller);

    let token_canister = actor (Principal.toText(token_ledger_id)) : actor {
      icrc1_name : shared query () -> async Text;
      icrc1_symbol : shared query () -> async Text;
      icrc1_fee : shared query () -> async Nat;
      icrc1_decimals : shared query () -> async Nat8;
    };

    try {
      let name = await token_canister.icrc1_name();
      let symbol = await token_canister.icrc1_symbol();
      let fee = await token_canister.icrc1_fee();
      let decimals = await token_canister.icrc1_decimals();

      let metadata : T.TokenMetadata = {
        name;
        symbol;
        fee;
        decimals;
      };

      known_tokens.put(token_ledger_id, metadata);
      icrc3_config(?caller, "known_token_added", icrc3_token_value(token_ledger_id, metadata, null), null);
    } catch e {
      throw Error.reject("Failed to fetch token metadata: " # Error.message(e));
    };
  };

  public shared ({ caller }) func remove_known_token(token_ledger_id : Principal) : async () {
    assert is_admin(caller);
    switch (known_tokens.remove(token_ledger_id)) {
      case (?_) { icrc3_config(?caller, "known_token_removed", Icrc3Log.principal(token_ledger_id), null) };
      case null {};
    };
  };

  public query func get_known_tokens() : async [(Principal, T.TokenMetadata)] {
    Iter.toArray(known_tokens.entries());
  };

  public query func get_token_metadata(token_ledger_id : Principal) : async ?T.TokenMetadata {
    known_tokens.get(token_ledger_id);
  };

  // Helper function to track distributions
  private func record_distribution(token_id : Principal, amount : Nat) : () {
    let current = switch (total_distributions.get(token_id)) {
      case (null) { 0 };
      case (?existing) { existing };
    };
    total_distributions.put(token_id, current + amount);
  };

  // Query function to get total distributions
  public query func get_total_distributions() : async [(Principal, Nat)] {
    Iter.toArray(total_distributions.entries());
  };

  // Query function to get distribution for specific token
  public query func get_token_total_distribution(token_id : Principal) : async Nat {
    switch (total_distributions.get(token_id)) {
      case (null) { 0 };
      case (?amount) { amount };
    };
  };

  // Helper function to record per-user distributions
  private func record_user_distribution(user : Principal, token_id : Principal, amount : Nat) : () {
    switch (user_distributions.get(user)) {
      case (null) { 
        // Create new user distributions record
        let new_distributions : T.UserDistributions = {
          var distributions = [{
            token_id = token_id;
            var amount = amount;
          }];
        };
        user_distributions.put(user, new_distributions);
      };
      case (?user_dists) {
        // Look for existing token distribution
        var found = false;
        for (dist in user_dists.distributions.vals()) {
          if (dist.token_id == token_id) {
            dist.amount += amount;
            found := true;
          };
        };
        
        // If token not found, append new distribution
        if (not found) {
          user_dists.distributions := Array.append(
            user_dists.distributions,
            [{
              token_id = token_id;
              var amount = amount;
            }]
          );
        };
      };
    };
  };

  // Query function to get total distributions for a specific user
  public query func get_user_distributions(user : Principal) : async [(Principal, Nat)] {
    switch (user_distributions.get(user)) {
      case (null) { [] };
      case (?user_dists) {
        Array.map<T.UserDistribution, (Principal, Nat)>(
          user_dists.distributions,
          func(dist) { (dist.token_id, dist.amount) }
        );
      };
    };
  };

  // Query function to get all user balances (claimable amounts)
  public query func get_all_user_balances() : async [(Principal, [(Principal, Nat)])] {
    let results = Buffer.Buffer<(Principal, [(Principal, Nat)])>(balances.size());
    for ((owner, local_balances) in balances.entries()) {
      let token_balances = Buffer.Buffer<(Principal, Nat)>(local_balances.balances.size());
      for (local_balance in local_balances.balances.vals()) {
        if (local_balance.amount > 0) {
          token_balances.add((local_balance.icrc1_ledger_canister_id, local_balance.amount));
        };
      };
      if (token_balances.size() > 0) {
        results.add((owner, Buffer.toArray(token_balances)));
      };
    };
    Buffer.toArray(results);
  };

  // Query function to get specific token distribution for a user
  public query func get_user_token_distribution(user : Principal, token_id : Principal) : async Nat {
    switch (user_distributions.get(user)) {
      case (null) { 0 };
      case (?user_dists) {
        for (dist in user_dists.distributions.vals()) {
          if (dist.token_id == token_id) {
            return dist.amount;
          };
        };
        0;
      };
    };
  };

  // Query function to get distribution events
  public query func get_distribution_events() : async [T.DistributionEvent] {
    Buffer.toArray(distribution_events);
  };

  // Query function to get distribution events for a specific token
  public query func get_token_distribution_events(token_id : Principal) : async [T.DistributionEvent] {
    let events = Buffer.Buffer<T.DistributionEvent>(10);
    for (event in distribution_events.vals()) {
      if (event.token_id == token_id) {
        events.add(event);
      };
    };
    Buffer.toArray(events);
  };

  // Query function to get all user distribution events
  public query func get_user_distribution_events() : async [T.UserDistributionEvent] {
    Buffer.toArray(user_distribution_events);
  };

  // Query function to get distribution events for a specific user
  // (through the per-owner index: visits only this owner's events)
  public query func get_user_specific_distribution_events(user : Principal) : async [T.UserDistributionEvent] {
    switch (event_stats.user_index.get(user)) {
      case null [];
      case (?ix) Array.tabulate<T.UserDistributionEvent>(ix.size(), func(k) { user_distribution_events.get(ix.get(k)) });
    };
  };

  // Query function to get distribution events for a specific user and token
  public query func get_user_token_distribution_events(user : Principal, token_id : Principal) : async [T.UserDistributionEvent] {
    let events = Buffer.Buffer<T.UserDistributionEvent>(10);
    switch (event_stats.user_index.get(user)) {
      case null {};
      case (?ix) {
        for (i in ix.vals()) {
          let event = user_distribution_events.get(i);
          if (event.token_id == token_id) events.add(event);
        };
      };
    };
    Buffer.toArray(events);
  };

  private func log_claim(
    sequence_number: Nat,
    hotkey: Principal, 
    token_id: Principal, 
    amount: Nat,
    fee: Nat,
    status: T.ClaimStatus,
    error_message: ?Text,
    tx_index: ?Nat
  ) {
    append_claim_event({
        sequence_number;
        hotkey;
        token_id;
        amount;
        fee;
        timestamp = Nat64.fromNat(Int.abs(Time.now()));
        status;
        error_message;
        tx_index;
    });
  };

  public query func get_claim_events() : async [T.ClaimEvent] {
    Buffer.toArray(claim_events)
  };

  public query func get_claim_events_for_hotkey(hotkey: Principal) : async [T.ClaimEvent] {
    let filtered = Buffer.Buffer<T.ClaimEvent>(10);
    for (event in claim_events.vals()) {
        if (event.hotkey == hotkey) {
            filtered.add(event);
        };
    };
    Buffer.toArray(filtered)
  };


  // Calculates the deadline timestamp for the proposal
  private func getDeadlineTimestampSeconds(proposal: T.ProposalData) : Nat64 {
    switch (proposal.wait_for_quiet_state) {
        case (?state) { state.current_deadline_timestamp_seconds };
        case (null) { proposal.proposal_creation_timestamp_seconds + proposal.initial_voting_period_seconds };
    };
  };

  // Convert Time.now() nanoseconds to seconds
  private func getCurrentTimeSeconds() : Nat64 {
    // Time.now() returns nanoseconds, divide by 1_000_000_000 to get seconds
    Nat64.fromNat(Int.abs(Time.now()) / 1_000_000_000);
  };

  // Checks if the proposal still accepts votes
  public query func acceptsVote(proposal: T.ProposalData, nowSeconds: Nat64) : async Bool {
    nowSeconds < getDeadlineTimestampSeconds(proposal);
  };

  // Find the highest proposal ID that no longer accepts votes
  public query func get_highest_closed_proposal_id() : async Nat64 {
    getHighestClosedProposalId();
  };

  private func getHighestClosedProposalId() : Nat64 {
    let currentTimeSeconds = getCurrentTimeSeconds();
    var highestClosed : Nat64 = 0;
    
    for ((id, prop_data) in props.entries()) {
        let propId = Nat64.fromIntWrap(id);
        if (propId > highestClosed and 
            currentTimeSeconds >= getDeadlineTimestampSeconds(prop_data)) {
            highestClosed := propId;
        };
    };
    
    highestClosed
  };

  // Returns information about proposals with no ballots
  public query func get_empty_ballot_proposals() : async {
    proposal_ids: [Nat64];
    total_count: Nat;
  } {
    let empty_proposals = Buffer.Buffer<Nat64>(10);
    
    for ((id, prop_data) in props.entries()) {
        if (Iter.size(prop_data.ballots.vals()) == 0) {
            empty_proposals.add(Nat64.fromIntWrap(id));
        };
    };
    
    {
        proposal_ids = Buffer.toArray(empty_proposals);
        total_count = empty_proposals.size();
    }
  };

  public shared  ({ caller }) func clear_whitelisted_tokens() : async () {
    assert(is_admin(caller));
    let count = whitelisted_tokens.size();
    for (key in whitelisted_tokens.keys()) {
      whitelisted_tokens.delete(key);
    };
    if (count > 0) { icrc3_config(?caller, "whitelist_cleared", #Nat(count), null) };
  };

  public shared  ({ caller }) func clear_known_tokens() : async () {
    assert(is_admin(caller));
    let count = known_tokens.size();
    for (key in known_tokens.keys()) {
      known_tokens.delete(key);
    };
    if (count > 0) { icrc3_config(?caller, "known_tokens_cleared", #Nat(count), null) };
  };

  transient var import_whitelisted_running = false;
  transient var cntImportedWhitelist = 0;
  transient var cntImportedWithBalance = 0;



  /// Import ICPSwap's trusted token list (admin). The old name below is kept for callers.
  public shared ({ caller }) func import_whitelisted_tokens_from_icpswap() : async () {
    assert(is_admin(caller));
    await import_whitelisted_tokens_from_swaprunner_impl(?caller);
  };

  public shared ({ caller }) func import_whitelisted_tokens_from_swaprunner() : async () {    
    assert(is_admin(caller));

    await import_whitelisted_tokens_from_swaprunner_impl(?caller);
  };

  // `by`: the admin who asked for the import, or null for the distribution cycle's own.
  private func import_whitelisted_tokens_from_swaprunner_impl(by : ?Principal) : async () {    
    if (import_whitelisted_running) {
      return;
    };
    import_whitelisted_running := true;
    
    try { 

      let tokens = switch (await icpswap_token_list.getList()) {
        case (#ok(list)) { list };
        case (#err(e)) { throw Error.reject("ICPSwap token list: " # e) };
      };

      let added = Buffer.Buffer<Principal>(0);
      for (t in tokens.vals()) {
        if (not import_whitelisted_running) {
          return;
        };
        switch (principal_from_canister_text(t.canisterId)) {
          case (?ledger_id) {
            switch (whitelisted_tokens.get(ledger_id)) {
              case (?_token) { /* already known */ };
              case (null) {
                // only ICRC tokens (standard starting with "I"), with decimals that fit
                if ((t.standard.chars().next() == ?'I' or t.standard.chars().next() == ?'i') and t.decimals < 256) {
                  cntImportedWhitelist += 1;
                  whitelisted_tokens.put(ledger_id, {
                    name = t.name;
                    symbol = t.symbol;
                    fee = t.fee;
                    decimals = Nat8.fromNat(t.decimals);
                  });
                  added.add(ledger_id);
                };
              };
            };
          };
          case null {};
        };
      };

      // ICRC-3: the ledgers this import added, at most 100 per block
      var next_i = 0;
      while (next_i < added.size()) {
        let first_i = next_i;
        let n = Nat.min(100, added.size() - first_i);
        let chunk = Array.tabulate<T3.Value>(n, func(i) { Icrc3Log.principal(added.get(first_i + i)) });
        icrc3_config(by, "whitelist_tokens_added", #Array(chunk), null);
        next_i += n;
      };

    } catch e { 
      import_whitelisted_running := false;
      Debug.print("Error importing whitelisted tokens: " # Error.message(e));
      throw e;
    };

    import_whitelisted_running := false;
  };


  public shared ({ caller }) func add_admin(principal : Principal) : async Result.Result<Text, Text> {
    if (not is_admin(caller)) {
      return #err("Caller is not admin");
    };

    // Check if already an admin
    for (admin in admin_principals.vals()) {
      if (Principal.equal(principal, admin)) {
        return #err("Principal is already an admin");
      };
    };

    // Add to admin list
    admin_principals := Array.append(admin_principals, [principal]);
    icrc3_config(?caller, "admin_added", Icrc3Log.principal(principal), null);
    #ok("Added admin " # Principal.toText(principal))
  };

  public shared ({ caller }) func remove_admin(principal : Principal) : async Result.Result<Text, Text> {
    if (not is_admin(caller)) {
      return #err("Caller is not admin");
    };

    // Don't allow removing the governance canister
    if (Principal.equal(principal, sneed_governance_canister_id)) {
      return #err("Cannot remove governance canister from admin list");
    };

    // Create new array without the specified principal
    let new_admins = Array.filter<Principal>(
      admin_principals,
      func(p : Principal) : Bool { not Principal.equal(p, principal) }
    );

    // Check if any admin was removed
    if (new_admins.size() == admin_principals.size()) {
      return #err("Principal is not an admin");
    };

    admin_principals := new_admins;
    icrc3_config(?caller, "admin_removed", Icrc3Log.principal(principal), null);
    #ok("Removed admin " # Principal.toText(principal))
  };

  public query func list_admins() : async [Principal] {
    admin_principals;
  };

  public query ({ caller }) func caller_is_admin() : async Bool {
    is_admin(caller);
  };

  public query func principal_is_admin(principal : Principal) : async Bool {
    is_admin(principal);
  };

  public query func get_main_loop_status() : async {
    is_running : Bool;
    last_started : ?Int;
    last_stopped : ?Int;
    last_cycle_started : ?Int;
    last_cycle_ended : ?Int;
    next_scheduled : ?Int;
    frequency_seconds : Nat;
    current_time : Int;
  } {
    {
      is_running = switch(main_loop_timer_id) {
        case (?_) { true };
        case (null) { false };
      };
      last_started = main_loop_last_started;
      last_stopped = main_loop_last_stopped;
      last_cycle_started = cycle_last_started;
      last_cycle_ended = cycle_last_ended;
      next_scheduled = main_loop_next_scheduled;
      frequency_seconds = main_loop_frequence_seconds;
      current_time = Time.now();
    }
  };


  public query func get_hotkey_voting_power(neurons: [T.Neuron]) : async {
    neurons_by_owner : [(Principal, [T.Neuron])];
    total_voting_power : Nat64;
    distribution_voting_power : Nat64;
  } {
    let neuron_groups = HashMap.HashMap<Principal, Buffer.Buffer<T.Neuron>>(10, Principal.equal, Principal.hash);
    
    // Group neurons by owner
    for (neuron in neurons.vals()) {
      switch (get_neuron_owner(neuron)) {
        case (null) { };
        case (?owner) {
          switch (neuron_groups.get(owner)) {
            case (null) {
              let new_buffer = Buffer.Buffer<T.Neuron>(1);
              new_buffer.add(neuron);
              neuron_groups.put(owner, new_buffer);
            };
            case (?buffer) {
              buffer.add(neuron);
            };
          };
        };
      };
    };

    // Convert the HashMap to an array of tuples
    let result = Buffer.Buffer<(Principal, [T.Neuron])>(neuron_groups.size());
    for ((owner, neurons) in neuron_groups.entries()) {
      result.add((owner, Buffer.toArray(neurons)));
    };

    // Calculate total voting power from proposal 1 to highest closed proposal
    let highest_closed = getHighestClosedProposalId();
    let votes = index_proposal_votes_between(
      { id = 1 },  // First proposal
      { id = highest_closed }  // Last closed proposal
    );

    // Calculate total voting power for the input neurons
    var total_vp : Nat64 = 0;
    for (neuron in neurons.vals()) {
      switch (neuron.id) {
        case (null) { };
        case (?id) {
          switch (votes.get(id.id)) {
            case (null) { };
            case (?vp) { total_vp += vp; };
          };
        };
      };
    };

    // Calculate total voting power for all neurons in the distribution period
    var distribution_vp : Nat64 = 0;
    for ((_, vp) in votes.entries()) {
      distribution_vp += vp;
    };

    {
      neurons_by_owner = Buffer.toArray(result);
      total_voting_power = total_vp;
      distribution_voting_power = distribution_vp;
    }
  };

  public shared ({ caller }) func stop_token_balance_check() : async Result.Result<Text, Text> {
    assert(is_admin(caller));
    
    switch(token_balance_check_timer_id) {
      case (?timer_id) {
        Timer.cancelTimer(timer_id);
        token_balance_check_timer_id := null;
        tokens_to_check := [];
        current_token_check_index := 0;
        token_check_ticks := 0;
        #ok("Stopped token balance check process")
      };
      case (null) {
        #err("No token balance check process running")
      };
    }
  };

  public query func get_token_balance_check_status() : async {
    is_running : Bool;
    processed : Nat;
    total : Nat;
    ticks : Nat;
  } {
    {
      is_running = switch(token_balance_check_timer_id) {
        case (?_) { true };
        case (null) { false };
      };
      processed = current_token_check_index;
      total = tokens_to_check.size();
      ticks = token_check_ticks;
    }
  };

  public shared ({ caller }) func check_whitelisted_token_balances() : async Result.Result<Text, Text> {    
    assert(is_admin(caller));
    
    // Check if already running
    switch(token_balance_check_timer_id) {
      case (?_timer_id) {
        return #err("Token balance check already running");
      };
      case (null) { };
    };

    // Reset counters
    current_token_check_index := 0;
    token_check_ticks := 0;
    cntImportedWithBalance := 0;

    // Get all whitelisted tokens
    tokens_to_check := Iter.toArray(whitelisted_tokens.entries());
    
    // Start the balance check process
    token_balance_check_timer_id := ?Timer.setTimer<system>(#seconds 0, check_token_balances_tick);
    #ok("Started token balance check process for " # debug_show(tokens_to_check.size()) # " tokens")
  };

  private func check_token_balances_tick<system>() : async () {
    // Check if we still have an active timer
    switch(token_balance_check_timer_id) {
      case (null) { return; };
      case (?_) { };
    };

    token_check_ticks += 1;
    Debug.print("Checking token balances starting from " # debug_show(current_token_check_index + 1) # "/" # debug_show(tokens_to_check.size()) # ", ticks: " # debug_show(token_check_ticks));

    let batch_size : Nat = 20; // Process 20 tokens per tick
    var processed_in_tick : Nat = 0;

    while (current_token_check_index < tokens_to_check.size() and processed_in_tick < batch_size) {
      let (ledger_id, metadata) = tokens_to_check[current_token_check_index];
      
      // Skip if already in known_tokens
      switch (known_tokens.get(ledger_id)) {
        case (?_) { /* Skip if already known */ };
        case (null) {
          // Check balance
          let token_canister = actor (Principal.toText(ledger_id)) : actor {
            icrc1_balance_of : shared query (T.Account) -> async Nat;
          };
          try {
            let balance = await token_canister.icrc1_balance_of({ owner = this_canister_id(); subaccount = null });
            if (balance > 0) {
              Debug.print("Adding token " # Principal.toText(ledger_id) # " to known tokens with balance " # debug_show(balance));
              known_tokens.put(ledger_id, metadata);
              cntImportedWithBalance += 1;
              icrc3_config(null, "known_token_added", icrc3_token_value(ledger_id, metadata, ?balance), null);
            };
          } catch e {
            Debug.print("Error getting balance for token " # Principal.toText(ledger_id) # ": " # Error.message(e));
          };
        };
      };

      // Move to next token
      current_token_check_index += 1;
      processed_in_tick += 1;
    };

    Debug.print("Processed " # debug_show(processed_in_tick) # " tokens in this tick");

    // Schedule next tick if more tokens to process and haven't hit safety limit
    if (current_token_check_index < tokens_to_check.size()) {
      if (token_check_ticks < MAX_TICKS) {
        token_balance_check_timer_id := ?Timer.setTimer<system>(#seconds 2, check_token_balances_tick);
      } else {
        // Hit safety limit
        Debug.print("Hit safety limit for token balance check after " # debug_show(token_check_ticks) # " ticks");
        token_balance_check_timer_id := cancel_timer(token_balance_check_timer_id);
        tokens_to_check := [];
        current_token_check_index := 0;
      };
    } else {
      token_balance_check_timer_id := cancel_timer(token_balance_check_timer_id);
      tokens_to_check := [];
      current_token_check_index := 0;
    };
  };

  public query func get_whitelisted_tokens() : async [(Principal, T.TokenMetadata)] {
    Iter.toArray(whitelisted_tokens.entries());
  };

  public shared ({ caller }) func check_wallet_token_balances(wallet : Principal) : async Result.Result<Text, Text> {    
    assert(is_admin(caller));
    
    // Check if already running
    switch(wallet_token_check_timer_id) {
      case (?_timer_id) {
        return #err("Wallet token check already running");
      };
      case (null) { };
    };

    // Reset counters
    current_wallet_token_check_index := 0;
    wallet_token_check_ticks := 0;
    current_wallet_being_checked := ?wallet;

    // Get all whitelisted tokens to check
    wallet_tokens_to_check := Iter.toArray(whitelisted_tokens.entries());
    
    // Start the balance check process
    wallet_token_check_timer_id := ?Timer.setTimer<system>(#seconds 0, check_wallet_token_balances_tick);
    #ok("Started wallet token balance check process for " # Principal.toText(wallet))
  };

  private func check_wallet_token_balances_tick<system>() : async () {
    // Check if we still have an active timer
    switch(wallet_token_check_timer_id) {
      case (null) { return; };
      case (?_) { };
    };

    // Get the wallet we're checking
    let wallet = switch (current_wallet_being_checked) {
      case (null) { 
        wallet_token_check_timer_id := cancel_timer(wallet_token_check_timer_id);
        return;
      };
      case (?w) { w };
    };

    wallet_token_check_ticks += 1;
    Debug.print("Checking wallet token balances starting from " # debug_show(current_wallet_token_check_index + 1) # "/" # debug_show(wallet_tokens_to_check.size()) # ", ticks: " # debug_show(wallet_token_check_ticks));

    let batch_size : Nat = 20; // Process 20 tokens per tick
    var processed_in_tick : Nat = 0;

    while (current_wallet_token_check_index < wallet_tokens_to_check.size() and processed_in_tick < batch_size) {
      let (ledger_id, metadata) = wallet_tokens_to_check[current_wallet_token_check_index];
      
      // Get the wallet's known tokens map or create a new one
      let wallet_tokens = switch (wallet_known_tokens.get(wallet)) {
        case (?existing) { existing };
        case (null) { 
          let new_map = HashMap.HashMap<Principal, T.TokenMetadata>(10, Principal.equal, Principal.hash);
          wallet_known_tokens.put(wallet, new_map);
          new_map;
        };
      };

      // Skip if already in wallet's known tokens
      switch (wallet_tokens.get(ledger_id)) {
        case (?_) { /* Skip if already known */ };
        case (null) {
          // Check balance
          let token_canister = actor (Principal.toText(ledger_id)) : actor {
            icrc1_balance_of : shared query (T.Account) -> async Nat;
          };
          try {
            let balance = await token_canister.icrc1_balance_of({ owner = wallet; subaccount = null });
            if (balance > 0) {
              Debug.print("Adding token " # Principal.toText(ledger_id) # " to wallet " # Principal.toText(wallet) # " known tokens with balance " # debug_show(balance));
              wallet_tokens.put(ledger_id, metadata);
            };
          } catch e {
            Debug.print("Error getting balance for token " # Principal.toText(ledger_id) # ": " # Error.message(e));
          };
        };
      };

      // Move to next token
      current_wallet_token_check_index += 1;
      processed_in_tick += 1;
    };

    Debug.print("Processed " # debug_show(processed_in_tick) # " tokens in this tick");

    // Schedule next tick if more tokens to process and haven't hit safety limit
    if (current_wallet_token_check_index < wallet_tokens_to_check.size()) {
      if (wallet_token_check_ticks < MAX_TICKS) {
        wallet_token_check_timer_id := ?Timer.setTimer<system>(#seconds 2, check_wallet_token_balances_tick);
      } else {
        // Hit safety limit
        Debug.print("Hit safety limit for wallet token check after " # debug_show(wallet_token_check_ticks) # " ticks");
        wallet_token_check_timer_id := cancel_timer(wallet_token_check_timer_id);
        wallet_tokens_to_check := [];
        current_wallet_token_check_index := 0;
        current_wallet_being_checked := null;
      };
    } else {
      wallet_token_check_timer_id := cancel_timer(wallet_token_check_timer_id);
      wallet_tokens_to_check := [];
      current_wallet_token_check_index := 0;
      current_wallet_being_checked := null;
    };
  };

  public shared ({ caller }) func stop_wallet_token_check() : async Result.Result<Text, Text> {
    assert(is_admin(caller));
    
    switch(wallet_token_check_timer_id) {
      case (?timer_id) {
        Timer.cancelTimer(timer_id);
        wallet_token_check_timer_id := null;
        wallet_tokens_to_check := [];
        current_wallet_token_check_index := 0;
        current_wallet_being_checked := null;
        #ok("Stopped wallet token check process")
      };
      case (null) {
        #err("No wallet token check process running")
      };
    }
  };

  public query func get_wallet_token_check_status() : async {
    is_running : Bool;
    wallet : ?Principal;
    processed : Nat;
    total : Nat;
    ticks : Nat;
  } {
    {
      is_running = switch(wallet_token_check_timer_id) {
        case (?_) { true };
        case (null) { false };
      };
      wallet = current_wallet_being_checked;
      processed = current_wallet_token_check_index;
      total = wallet_tokens_to_check.size();
      ticks = wallet_token_check_ticks;
    }
  };

  public query func get_wallet_known_tokens(wallet : Principal) : async [(Principal, T.TokenMetadata)] {
    switch (wallet_known_tokens.get(wallet)) {
      case (?tokens) { Iter.toArray(tokens.entries()) };
      case (null) { [] };
    }
  };

  public shared ({ caller }) func set_token_min_distribution(token_id : Principal, min_amount : Nat) : async Result.Result<Text, Text> {
    assert(is_admin(caller));
    
    // Verify token exists in whitelisted  tokens
    switch (whitelisted_tokens.get(token_id)) {
      case (null) { 
        return #err("Token " # Principal.toText(token_id) # " not found in whitelisted tokens"); 
      };
      case (?_) { };
    };

    let old_min = token_min_distributions.get(token_id);
    token_min_distributions.put(token_id, min_amount);
    icrc3_config(?caller, "token_min_distribution", icrc3_limit_value(token_id, ?min_amount), ?icrc3_limit_value(token_id, old_min));
    #ok("Set minimum distribution amount for token " # Principal.toText(token_id) # " to " # debug_show(min_amount))
  };

  public shared ({ caller }) func remove_token_min_distribution(token_id : Principal) : async Result.Result<Text, Text> {
    assert(is_admin(caller));
    
    switch (token_min_distributions.get(token_id)) {
      case (null) { 
        return #err("No minimum distribution amount set for token " # Principal.toText(token_id)); 
      };
      case (?old_min) {
        token_min_distributions.delete(token_id);
        icrc3_config(?caller, "token_min_distribution", icrc3_limit_value(token_id, null), ?icrc3_limit_value(token_id, ?old_min));
        #ok("Removed minimum distribution amount for token " # Principal.toText(token_id))
      };
    }
  };

  public query func get_token_min_distribution(token_id : Principal) : async ?Nat {
    token_min_distributions.get(token_id)
  };

  public query func get_all_token_min_distributions() : async [(Principal, Nat)] {
    Iter.toArray(token_min_distributions.entries())
  };

  // Modify the distribute_tokens_tick function to use custom minimums
  private func get_min_distribution_amount(token_id : Principal, token_metadata : T.TokenMetadata) : Nat {
    switch (token_min_distributions.get(token_id)) {
      case (?min_amount) { min_amount };
      case (null) { Nat.mul(token_metadata.fee, MIN_FEE_MULTIPLIER) };
    }
  };

  public shared ({ caller }) func set_token_max_distribution(token_id : Principal, max_amount : Nat) : async Result.Result<Text, Text> {
    assert(is_admin(caller));
    
    // Verify token exists in whitelisted tokens
    switch (whitelisted_tokens.get(token_id)) {
      case (null) { 
        return #err("Token " # Principal.toText(token_id) # " not found in whitelisted tokens"); 
      };
      case (?_) { };
    };

    let old_max = token_max_distributions.get(token_id);
    token_max_distributions.put(token_id, max_amount);
    icrc3_config(?caller, "token_max_distribution", icrc3_limit_value(token_id, ?max_amount), ?icrc3_limit_value(token_id, old_max));
    #ok("Set maximum distribution amount for token " # Principal.toText(token_id) # " to " # debug_show(max_amount))
  };

  public shared ({ caller }) func remove_token_max_distribution(token_id : Principal) : async Result.Result<Text, Text> {
    assert(is_admin(caller));
    
    switch (token_max_distributions.get(token_id)) {
      case (null) { 
        return #err("No maximum distribution amount set for token " # Principal.toText(token_id)); 
      };
      case (?old_max) {
        token_max_distributions.delete(token_id);
        icrc3_config(?caller, "token_max_distribution", icrc3_limit_value(token_id, null), ?icrc3_limit_value(token_id, ?old_max));
        #ok("Removed maximum distribution amount for token " # Principal.toText(token_id))
      };
    }
  };

  public query func get_token_max_distribution(token_id : Principal) : async ?Nat {
    token_max_distributions.get(token_id)
  };

  public query func get_all_token_max_distributions() : async [(Principal, Nat)] {
    Iter.toArray(token_max_distributions.entries())
  };

  // Update the distribution logic to handle both min and max amounts
  private func get_distribution_amount(token_id : Principal, token_metadata : T.TokenMetadata, available_amount : Nat) : Nat {
    let min_amount = get_min_distribution_amount(token_id, token_metadata);
    
    // If available amount is less than minimum, don't distribute
    if (available_amount < min_amount) {
      return 0;
    };

    // Check if there's a maximum limit
    switch (token_max_distributions.get(token_id)) {
      case (?max_amount) {
        // If we have enough to distribute (min requirement met), 
        // return either max_amount or available_amount, whichever is smaller
        Nat.min(max_amount, available_amount)
      };
      case (null) {
        // No maximum limit, distribute all available amount
        available_amount
      };
    }
  };

  ////////////////
  // Event statistics. get_event_statistics used to scan every event list on each call, which
  // the growing user_distribution_events list pushed over the query instruction limit. The
  // all-time figures are now running counters, updated whenever an event is appended and
  // rebuilt from the lists by one pass in postupgrade (and after a reset tool clears a list);
  // the last-24h figures scan only the newest events, back to the cutoff. All of this is
  // transient: the event lists stay the only stored data. The same pass keeps an index of
  // each owner's user distribution events for the per-owner queries.
  ////////////////

  // per-token sums, as cells: a running total changes with one lookup
  type TokenAmounts = HashMap.HashMap<Principal, { var v : Nat }>;
  // Time order of an event list, so the last-24h window can stop at the cutoff: the list is
  // non-decreasing in time from `sorted_from` on (always 0 for lists appended in real time);
  // `max_before` is the latest timestamp before `sorted_from`.
  type TimeOrder = { var last : Int; var max : Int; var sorted_from : Nat; var max_before : Int };
  type EventStats = {
    var server_count : Nat;
    server_amounts : TokenAmounts;
    var user_count : Nat; // unique owners: the size of user_index
    user_amounts : TokenAmounts;
    var claims_total : Nat;
    var claims_successful : Nat;
    var claims_failed : Nat;
    var claims_pending : Nat;
    claim_users : HashMap.HashMap<Principal, ()>;
    claim_amounts : TokenAmounts;
    user_index : HashMap.HashMap<Principal, Buffer.Buffer<Nat>>; // owner -> indices in user_distribution_events
    server_order : TimeOrder;
    user_order : TimeOrder;
    claim_order : TimeOrder;
  };

  private func new_time_order() : TimeOrder { { var last = 0; var max = 0; var sorted_from = 0; var max_before = 0 } };

  private func new_token_amounts() : TokenAmounts { HashMap.HashMap<Principal, { var v : Nat }>(100, Principal.equal, Principal.hash) };

  private func token_amounts_array(m : TokenAmounts) : [(Principal, Nat)] {
    Iter.toArray(Iter.map<(Principal, { var v : Nat }), (Principal, Nat)>(m.entries(), func((p, c)) { (p, c.v) }));
  };

  private func new_event_stats() : EventStats {
    {
      var server_count = 0;
      server_amounts = new_token_amounts();
      var user_count = 0;
      user_amounts = new_token_amounts();
      var claims_total = 0;
      var claims_successful = 0;
      var claims_failed = 0;
      var claims_pending = 0;
      claim_users = HashMap.HashMap<Principal, ()>(100, Principal.equal, Principal.hash);
      claim_amounts = new_token_amounts();
      user_index = HashMap.HashMap<Principal, Buffer.Buffer<Nat>>(100, Principal.equal, Principal.hash);
      server_order = new_time_order();
      user_order = new_time_order();
      claim_order = new_time_order();
    };
  };

  transient var event_stats : EventStats = new_event_stats();
  // what the last rebuild cost (get_event_statistics_status)
  transient var event_stats_rebuilt_at : Int = 0;
  transient var event_stats_rebuild_instructions : Nat64 = 0;
  transient var postupgrade_instructions : Nat64 = 0;

  private func add_amount(map : TokenAmounts, token_id : Principal, amount : Nat) {
    switch (map.get(token_id)) {
      case (?c) c.v += amount;
      case null map.put(token_id, { var v = amount });
    };
  };

  // `index` is the event's position in its list (its size before the append)
  private func order_add(o : TimeOrder, index : Nat, ts : Int) {
    if (index > 0 and ts < o.last) { o.sorted_from := index; o.max_before := o.max };
    if (index == 0 or ts > o.max) { o.max := ts };
    o.last := ts;
  };

  private func stats_add_server(index : Nat, e : T.DistributionEvent) {
    let s = event_stats;
    s.server_count += 1;
    add_amount(s.server_amounts, e.token_id, e.amount);
    order_add(s.server_order, index, e.timestamp);
  };

  private func stats_add_user(index : Nat, e : T.UserDistributionEvent) {
    let s = event_stats;
    s.user_count += 1;
    add_amount(s.user_amounts, e.token_id, e.amount);
    order_add(s.user_order, index, e.timestamp);
    switch (s.user_index.get(e.user)) {
      case (?b) b.add(index);
      case null { let b = Buffer.Buffer<Nat>(4); b.add(index); s.user_index.put(e.user, b) };
    };
  };

  private func stats_add_claim(index : Nat, e : T.ClaimEvent) {
    let s = event_stats;
    s.claims_total += 1;
    if (s.claim_users.get(e.hotkey) == null) s.claim_users.put(e.hotkey, ());
    switch (e.status) {
      case (#Success) { s.claims_successful += 1; add_amount(s.claim_amounts, e.token_id, e.amount) };
      case (#Failed) { s.claims_failed += 1 };
      case (#Pending) { s.claims_pending += 1 };
    };
    order_add(s.claim_order, index, Nat64.toNat(e.timestamp));
  };

  // Every append to the three event lists goes through these.
  private func append_distribution_event(e : T.DistributionEvent) {
    stats_add_server(distribution_events.size(), e);
    distribution_events.add(e);
  };

  private func append_user_distribution_event(e : T.UserDistributionEvent) {
    stats_add_user(user_distribution_events.size(), e);
    user_distribution_events.add(e);
  };

  private func append_claim_event(e : T.ClaimEvent) {
    stats_add_claim(claim_events.size(), e);
    claim_events.add(e);
  };

  // One pass over the lists (postupgrade, and after a reset tool cleared one).
  private func rebuild_event_stats() {
    let start = IC.performanceCounter(0);
    event_stats := new_event_stats();
    var i = 0;
    for (e in distribution_events.vals()) { stats_add_server(i, e); i += 1 };
    i := 0;
    for (e in user_distribution_events.vals()) { stats_add_user(i, e); i += 1 };
    i := 0;
    for (e in claim_events.vals()) { stats_add_claim(i, e); i += 1 };
    event_stats_rebuilt_at := Time.now();
    event_stats_rebuild_instructions := IC.performanceCounter(0) - start;
  };

  // The positions of a list whose timestamp may be >= cutoff, oldest first: the newest run back
  // to the cutoff, preceded by the unsorted head if one exists and reaches the cutoff (then
  // every position before the run is visited and the caller filters by time).
  private func window_positions(o : TimeOrder, size : Nat, ts_at : Nat -> Int, cutoff : Int) : Iter.Iter<Nat> {
    var from = size;
    while (from > o.sorted_from and ts_at(from - 1) >= cutoff) { from -= 1 };
    let head = if (o.sorted_from > 0 and o.max_before >= cutoff) o.sorted_from else 0;
    let first = if (head > 0) 0 else from;
    var i = first;
    {
      next = func() : ?Nat {
        if (i == head and head > 0) { i := from };
        if (i >= size) return null;
        let r = i;
        i += 1;
        ?r;
      };
    };
  };

  type PeriodStatistics = {
    server_distributions : { total : Nat; per_token : [(Principal, Nat)] };
    user_distributions : { total : Nat; unique_users : Nat; per_token : [(Principal, Nat)] };
    claims : { total : Nat; successful : Nat; failed : Nat; pending : Nat; unique_users : Nat; per_token : [(Principal, Nat)] };
  };

  private func last_24h_statistics(cutoff : Int) : PeriodStatistics {
    let s = event_stats;
    var server_count = 0;
    let server_amounts = new_token_amounts();
    for (i in window_positions(s.server_order, distribution_events.size(), func(i) { distribution_events.get(i).timestamp }, cutoff)) {
      let e = distribution_events.get(i);
      if (e.timestamp >= cutoff) { server_count += 1; add_amount(server_amounts, e.token_id, e.amount) };
    };
    var user_count = 0;
    let users = HashMap.HashMap<Principal, ()>(100, Principal.equal, Principal.hash);
    let user_amounts = new_token_amounts();
    for (i in window_positions(s.user_order, user_distribution_events.size(), func(i) { user_distribution_events.get(i).timestamp }, cutoff)) {
      let e = user_distribution_events.get(i);
      if (e.timestamp >= cutoff) { user_count += 1; if (users.get(e.user) == null) users.put(e.user, ()); add_amount(user_amounts, e.token_id, e.amount) };
    };
    var total = 0;
    var successful = 0;
    var failed = 0;
    var pending = 0;
    let claim_users = HashMap.HashMap<Principal, ()>(100, Principal.equal, Principal.hash);
    let claim_amounts = new_token_amounts();
    for (i in window_positions(s.claim_order, claim_events.size(), func(i) { Nat64.toNat(claim_events.get(i).timestamp) }, cutoff)) {
      let e = claim_events.get(i);
      if (Nat64.toNat(e.timestamp) >= cutoff) {
        total += 1;
        if (claim_users.get(e.hotkey) == null) claim_users.put(e.hotkey, ());
        switch (e.status) {
          case (#Success) { successful += 1; add_amount(claim_amounts, e.token_id, e.amount) };
          case (#Failed) { failed += 1 };
          case (#Pending) { pending += 1 };
        };
      };
    };
    {
      server_distributions = { total = server_count; per_token = token_amounts_array(server_amounts) };
      user_distributions = { total = user_count; unique_users = users.size(); per_token = token_amounts_array(user_amounts) };
      claims = { total; successful; failed; pending; unique_users = claim_users.size(); per_token = token_amounts_array(claim_amounts) };
    };
  };

  // All-time figures from the counters; last 24 hours by scanning back from the newest event.
  // Same results as the full scan it replaces (test/canisters/tests/rll-stats.test.js).
  public query func get_event_statistics() : async { all_time : PeriodStatistics; last_24h : PeriodStatistics } {
    let current_time = Int.abs(Time.now());
    let twenty_four_hours_ago : Int = current_time - (24 * 60 * 60 * 1_000_000_000); // 24 hours in nanoseconds
    let s = event_stats;
    {
      all_time = {
        server_distributions = { total = s.server_count; per_token = token_amounts_array(s.server_amounts) };
        user_distributions = { total = s.user_count; unique_users = s.user_index.size(); per_token = token_amounts_array(s.user_amounts) };
        claims = {
          total = s.claims_total;
          successful = s.claims_successful;
          failed = s.claims_failed;
          pending = s.claims_pending;
          unique_users = s.claim_users.size();
          per_token = token_amounts_array(s.claim_amounts);
        };
      };
      last_24h = last_24h_statistics(twenty_four_hours_ago);
    };
  };

  // The sizes of the event lists (for the paged queries) and what the last rebuild of the
  // statistics cost, in instructions (postupgrade_instructions: the whole post-upgrade step,
  // stable-variable restore included).
  public query func get_event_statistics_status() : async {
    distribution_events : Nat;
    user_distribution_events : Nat;
    claim_events : Nat;
    rebuilt_at : Int;
    rebuild_instructions : Nat64;
    postupgrade_instructions : Nat64;
  } {
    {
      distribution_events = distribution_events.size();
      user_distribution_events = user_distribution_events.size();
      claim_events = claim_events.size();
      rebuilt_at = event_stats_rebuilt_at;
      rebuild_instructions = event_stats_rebuild_instructions;
      postupgrade_instructions;
    };
  };

  // Paged reads of the event lists, oldest first (position `start`, at most EVENT_PAGE_MAX
  // events); `total` is the list's size, so the newest page starts at total - length.
  transient let EVENT_PAGE_MAX = 2_000;

  private func page_range(size : Nat, start : Nat, length : Nat) : (Nat, Nat) {
    let from = Nat.min(start, size);
    (from, Nat.min(size, from + Nat.min(length, EVENT_PAGE_MAX)));
  };

  public query func get_distribution_events_page(start : Nat, length : Nat) : async { total : Nat; events : [T.DistributionEvent] } {
    let (from, to) = page_range(distribution_events.size(), start, length);
    { total = distribution_events.size(); events = Array.tabulate<T.DistributionEvent>(to - from, func(k) { distribution_events.get(from + k) }) };
  };

  public query func get_user_distribution_events_page(start : Nat, length : Nat) : async { total : Nat; events : [T.UserDistributionEvent] } {
    let (from, to) = page_range(user_distribution_events.size(), start, length);
    { total = user_distribution_events.size(); events = Array.tabulate<T.UserDistributionEvent>(to - from, func(k) { user_distribution_events.get(from + k) }) };
  };

  public query func get_claim_events_page(start : Nat, length : Nat) : async { total : Nat; events : [T.ClaimEvent] } {
    let (from, to) = page_range(claim_events.size(), start, length);
    { total = claim_events.size(); events = Array.tabulate<T.ClaimEvent>(to - from, func(k) { claim_events.get(from + k) }) };
  };

  public query ({ caller }) func get_error_claim_events() : async Result.Result<[T.ClaimEvent], Text> {
    if (not is_admin(caller)) {
      return #err("Caller is not admin");
    };

    let error_events = Buffer.Buffer<T.ClaimEvent>(10);
    for (event in claim_events.vals()) {
      switch (event.status) {
        case (#Failed) {
          error_events.add(event);
        };
        case (_) { };
      };
    };
    #ok(Buffer.toArray(error_events))
  };

  public query ({ caller }) func get_unmatched_pending_claims() : async Result.Result<[T.ClaimEvent], Text> {
    if (not is_admin(caller)) {
      return #err("Caller is not admin");
    };

    // First, collect all pending claims in a HashMap using sequence number as key
    let pending_claims = HashMap.HashMap<Nat, T.ClaimEvent>(100, Nat.equal, Int.hash);
    
    // Also track which sequence numbers have been resolved (success/fail)
    let resolved_sequences = HashMap.HashMap<Nat, Bool>(100, Nat.equal, Int.hash);

    // First pass - collect all claims
    for (event in claim_events.vals()) {
      switch (event.status) {
        case (#Pending) {
          pending_claims.put(event.sequence_number, event);
        };
        case (#Success or #Failed) {
          resolved_sequences.put(event.sequence_number, true);
        };
      };
    };

    // Create result array of pending claims that don't have a matching resolution
    let unmatched = Buffer.Buffer<T.ClaimEvent>(10);
    for ((seq, event) in pending_claims.entries()) {
      switch (resolved_sequences.get(seq)) {
        case (null) {
          // No matching resolution found
          unmatched.add(event);
        };
        case (?_) { 
          // Has a resolution, skip it
        };
      };
    };

    #ok(Buffer.toArray(unmatched))
  };

  public query func get_proposal_ballots(proposal_id : Nat64) : async [(Text, T.Ballot)] {
    switch (props.get(int_from_nat64(proposal_id))) {
      case (null) { [] };
      case (?prop_data) {
        Iter.toArray(prop_data.ballots.vals());
      };
    };
  };

  public query func get_user_voting_history(user : Principal) : async [{
    proposal_id : Nat64;
    vote : Int32;
    voting_power : Nat64;
    timestamp : Nat64;
    proposal_title : ?Text;
    proposal_action : Nat64;
    neuron_votes : [{
      neuron_id : Text;
      vote : Int32;
      voting_power : Nat64;
      timestamp : Nat64;
    }];
  }] {
    let voting_history = Buffer.Buffer<{
      proposal_id : Nat64;
      vote : Int32;
      voting_power : Nat64;
      timestamp : Nat64;
      proposal_title : ?Text;
      proposal_action : Nat64;
      neuron_votes : [{
        neuron_id : Text;
        vote : Int32;
        voting_power : Nat64;
        timestamp : Nat64;
      }];
    }>(10);

    // First get all neurons controlled by this user
    let user_neurons = Map.HashMap<Blob, Bool>(100, Blob.equal, Blob.hash);
    for ((neuron_id, neuron) in neurons.entries()) {
      for (permission in neuron.permissions.vals()) {
        switch (permission.principal) {
          case (?principal) {
            if (Principal.equal(principal, user)) {
              user_neurons.put(neuron_id, true);
            };
          };
          case (null) { };
        };
      };
    };

    // Now scan all proposals for votes from these neurons
    for ((prop_id, prop_data) in props.entries()) {
      let proposal_id = Nat64.fromIntWrap(prop_id);
      let neuron_votes = Buffer.Buffer<{
        neuron_id : Text;
        vote : Int32;
        voting_power : Nat64;
        timestamp : Nat64;
      }>(5);

      var total_voting_power : Nat64 = 0;
      var latest_timestamp : Nat64 = 0;
      var combined_vote : Int32 = 0;

      // Collect all votes from user's neurons for this proposal
      for ((neuron_hex_id, ballot) in prop_data.ballots.vals()) {
        let neuron_id = hex_text_to_blob(neuron_hex_id);
        switch (user_neurons.get(neuron_id)) {
          case (?_) {
            // This ballot belongs to one of the user's neurons
            neuron_votes.add({
              neuron_id = neuron_hex_id;
              vote = ballot.vote;
              voting_power = ballot.voting_power;
              timestamp = ballot.cast_timestamp_seconds;
            });

            total_voting_power += ballot.voting_power;
            if (ballot.cast_timestamp_seconds > latest_timestamp) {
              latest_timestamp := ballot.cast_timestamp_seconds;
            };
            // For combined vote, we'll use the most common vote direction
            combined_vote := ballot.vote;
          };
          case (null) { };
        };
      };

      // Only add to history if we found votes from user's neurons
      if (neuron_votes.size() > 0) {
        voting_history.add({
          proposal_id = proposal_id;
          vote = combined_vote;
          voting_power = total_voting_power;
          timestamp = latest_timestamp;
          proposal_title = switch (prop_data.proposal) {
            case (null) { null };
            case (?proposal) { ?proposal.title };
          };
          proposal_action = prop_data.action;
          neuron_votes = Buffer.toArray(neuron_votes);
        });
      };
    };

    Buffer.toArray(voting_history);
  };

  public query func get_neuron_voting_history(neuron_id : Blob) : async [{
    proposal_id : Nat64;
    vote : Int32;
    voting_power : Nat64;
    timestamp : Nat64;
    proposal_title : ?Text;
    proposal_action : Nat64;
  }] {
    let voting_history = Buffer.Buffer<{
      proposal_id : Nat64;
      vote : Int32;
      voting_power : Nat64;
      timestamp : Nat64;
      proposal_title : ?Text;
      proposal_action : Nat64;
    }>(10);

    let neuron_hex_id = blob_to_hex_text(neuron_id);

    // Scan all proposals for votes from this neuron
    for ((prop_id, prop_data) in props.entries()) {
      for ((ballot_neuron_id, ballot) in prop_data.ballots.vals()) {
        if (ballot_neuron_id == neuron_hex_id) {
          voting_history.add({
            proposal_id = Nat64.fromIntWrap(prop_id);
            vote = ballot.vote;
            voting_power = ballot.voting_power;
            timestamp = ballot.cast_timestamp_seconds;
            proposal_title = switch (prop_data.proposal) {
              case (null) { null };
              case (?proposal) { ?proposal.title };
            };
            proposal_action = prop_data.action;
          });
        };
      };
    };

    Buffer.toArray(voting_history);
  };

  public query func get_neuron_statistics() : async {
    total_neurons : Nat;
    active_neurons : Nat;  // neurons with stake > 0
    total_stake : Nat64;
    dissolve_state : {
      not_dissolving : Nat;
      dissolving : Nat;
      dissolved : Nat;
      not_dissolving_stake : Nat64;
      dissolving_stake : Nat64;
      dissolved_stake : Nat64;
    };
    dissolve_times : {
      min_dissolve_delay_seconds : ?Nat64;
      max_dissolve_delay_seconds : ?Nat64;
      avg_dissolve_delay_seconds : Float;
      min_delay_neurons : {
        count : Nat;
        total_voting_power : Nat64;
      };
      max_delay_neurons : {
        count : Nat;
        total_voting_power : Nat64;
      };
    };
    voting_power : {
      total : Nat64;
      min : Nat64;
      max : Nat64;
      avg : Float;
    };
    permissions : {
      total_hotkeys : Nat;  // total number of unique hotkeys
      multi_hotkey_neurons : Nat;  // neurons with multiple hotkeys
    };
  } {
    var total_neurons : Nat = neurons.size();
    var active_neurons : Nat = 0;
    var total_stake : Nat64 = 0;
    var not_dissolving : Nat = 0;
    var dissolving : Nat = 0;
    var dissolved : Nat = 0;
    // Track stake amounts for each dissolve state
    var not_dissolving_stake : Nat64 = 0;
    var dissolving_stake : Nat64 = 0;
    var dissolved_stake : Nat64 = 0;
    
    var min_dissolve_delay : ?Nat64 = null;
    var max_dissolve_delay : ?Nat64 = null;
    var total_dissolve_delay : Nat64 = 0;
    var neurons_with_delay : Nat = 0;

    // Track neurons at min/max dissolve delay
    var min_delay_neuron_count : Nat = 0;
    var max_delay_neuron_count : Nat = 0;
    var min_delay_voting_power : Nat64 = 0;
    var max_delay_voting_power : Nat64 = 0;
    
    var min_voting_power : Nat64 = 0;
    var max_voting_power : Nat64 = 0;
    var total_voting_power : Nat64 = 0;
    
    let hotkeys_map = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
    var multi_hotkey_neurons : Nat = 0;

    // First pass - collect basic statistics
    for ((_, neuron) in neurons.entries()) {
      // Count active neurons and total stake
      let stake = neuron.cached_neuron_stake_e8s;
      if (stake > 0) {
        active_neurons += 1;
        total_stake += stake;
      };

      // Calculate voting power (stake * voting power percentage multiplier)
      let power = neuron.cached_neuron_stake_e8s * neuron.voting_power_percentage_multiplier / 100_000_000_00;
      if (power > max_voting_power) { max_voting_power := power };
      if (min_voting_power == 0 or power < min_voting_power) { min_voting_power := power };
      total_voting_power += power;

      // Analyze dissolve state and track min/max delay neurons
      switch (neuron.dissolve_state) {
        case (?state) {
          switch (state) {
            case (#DissolveDelaySeconds(delay)) {
              not_dissolving += 1;
              not_dissolving_stake += stake;
              
              // Track dissolve delay statistics
              switch (min_dissolve_delay) {
                case (?min) { 
                  if (delay < min) {
                    min_dissolve_delay := ?delay;
                    min_delay_neuron_count := 1;
                    min_delay_voting_power := power;
                  } else if (delay == min) {
                    min_delay_neuron_count += 1;
                    min_delay_voting_power += power;
                  };
                };
                case (null) { 
                  min_dissolve_delay := ?delay;
                  min_delay_neuron_count := 1;
                  min_delay_voting_power := power;
                };
              };
              switch (max_dissolve_delay) {
                case (?max) { 
                  if (delay > max) {
                    max_dissolve_delay := ?delay;
                    max_delay_neuron_count := 1;
                    max_delay_voting_power := power;
                  } else if (delay == max) {
                    max_delay_neuron_count += 1;
                    max_delay_voting_power += power;
                  };
                };
                case (null) { 
                  max_dissolve_delay := ?delay;
                  max_delay_neuron_count := 1;
                  max_delay_voting_power := power;
                };
              };
              total_dissolve_delay += delay;
              neurons_with_delay += 1;
            };
            case (#WhenDissolvedTimestampSeconds(timestamp)) { 
              let current_time = Nat64.fromNat(Int.abs(Time.now()) / 1_000_000_000);
              if (timestamp <= current_time) {
                dissolved += 1;
                dissolved_stake += stake;
              } else {
                dissolving += 1;
                dissolving_stake += stake;
              };
            };
          };
        };
        case (null) { 
          not_dissolving += 1;
          not_dissolving_stake += stake;
        };
      };

      // Count hotkeys and track owners
      var hotkey_count : Nat = 0;
      for (permission in neuron.permissions.vals()) {
        switch (permission.principal) {
          case (?principal) {
            hotkeys_map.put(principal, true);
            hotkey_count += 1;
          };
          case (null) { };
        };
      };
      if (hotkey_count > 1) {
        multi_hotkey_neurons += 1;
      };
    };

    // Calculate averages
    let avg_dissolve_delay : Float = if (neurons_with_delay > 0) {
      Float.fromInt(Int64.toInt(Int64.fromNat64(total_dissolve_delay))) / Float.fromInt(neurons_with_delay)
    } else { 0.0 };

    let avg_voting_power : Float = if (total_neurons > 0) {
      Float.fromInt(Int64.toInt(Int64.fromNat64(total_voting_power))) / Float.fromInt(total_neurons)
    } else { 0.0 };

    {
      total_neurons;
      active_neurons;
      total_stake;
      dissolve_state = {
        not_dissolving;
        dissolving;
        dissolved;
        not_dissolving_stake;
        dissolving_stake;
        dissolved_stake;
      };
      dissolve_times = {
        min_dissolve_delay_seconds = min_dissolve_delay;
        max_dissolve_delay_seconds = max_dissolve_delay;
        avg_dissolve_delay_seconds = avg_dissolve_delay;
        min_delay_neurons = {
          count = min_delay_neuron_count;
          total_voting_power = min_delay_voting_power;
        };
        max_delay_neurons = {
          count = max_delay_neuron_count;
          total_voting_power = max_delay_voting_power;
        };
      };
      voting_power = {
        total = total_voting_power;
        min = min_voting_power;
        max = max_voting_power;
        avg = avg_voting_power;
      };
      permissions = {
        total_hotkeys = hotkeys_map.size();
        multi_hotkey_neurons;
      };
    };
  };

  public query func get_hotkey_claimed_amounts(hotkey: Principal) : async [(Principal, Nat)] {
    let claimed_amounts = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);
    
    for (event in claim_events.vals()) {
      if (event.hotkey == hotkey and event.status == #Success) {
        let current_amount = switch (claimed_amounts.get(event.token_id)) {
          case (null) { 0 };
          case (?amount) { amount };
        };
        claimed_amounts.put(event.token_id, current_amount + event.amount);
      };
    };
    
    Iter.toArray(claimed_amounts.entries())
  };

  ////////////////
  // ICRC-3 activity log (library src/icrc3, design spec/rll_icrc3.md)
  ////////////////

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/rll#block-types";
    block_types = [
      "rll_reconciliation",
      "rll_distribution",
      "rll_credit",
      "rll_claim",
      "rll_claim_incident",
      "rll_claim_incident_resolve",
      "rll_config_update",
      "rll_admin_action",
    ];
  };

  private func icrc3_cid() : Nat { icrc3_next_cid += 1; icrc3_next_cid };
  // RLL has no text log; the library's lines go to the canister log
  private func icrc3_print(cid : Nat, message : Text) { Debug.print("[icrc3 " # Nat.toText(cid) # "] " # message) };

  private func icrc3_env() : Icrc3Log.Environment {
    {
      self = this_canister_id();
      archive_controllers = [SNEED_SNS_ROOT];
      cycle_reserve = 2_000_000_000_000; // never spend this canister's balance below 2 T
      new_correlation_id = icrc3_cid;
      log_info = icrc3_print;
      log_error = icrc3_print;
    };
  };

  private func icrc3_sns_env() : Icrc3Sns.Environment {
    {
      governance = sneed_governance_canister_id;
      name = "RLL";
      doc_url = "https://app.sneeddao.com/api/rll#activity-log-icrc-3";
      new_correlation_id = icrc3_cid;
      log_info = icrc3_print;
      log_error = icrc3_print;
      describe = null;
    };
  };

  // Append one block for a change that has just been committed to local state.
  private func icrc3_add(btype : Text, tx : [(Text, T3.Value)]) {
    ignore Icrc3Log.append(icrc3, btype, Int.abs(Time.now()), tx);
  };

  private func icrc3_add_i(btype : Text, tx : [(Text, T3.Value)]) : Nat {
    Icrc3Log.append(icrc3, btype, Int.abs(Time.now()), tx);
  };

  /// A setting changed: by `by` (an admin), or by the distribution cycle when null.
  private func icrc3_config(by : ?Principal, key : Text, value : T3.Value, old_value : ?T3.Value) {
    let who : (Text, T3.Value) = switch (by) { case (?p) ("caller", Icrc3Log.principal(p)); case null ("via", #Text("cycle")) };
    let base : [(Text, T3.Value)] = [who, ("key", #Text(key)), ("value", value)];
    icrc3_add("rll_config_update", switch (old_value) { case (?o) Array.append(base, [("old_value", o)]); case null base });
  };

  private func icrc3_admin(caller : Principal, action : Text, fields : [(Text, T3.Value)]) {
    icrc3_add("rll_admin_action", Array.append<(Text, T3.Value)>([("caller", Icrc3Log.principal(caller)), ("action", #Text(action))], fields));
  };

  /// Owners and amounts (zero amounts left out) as an Array of Map { owner; amount }.
  private func icrc3_owner_amounts(pairs : [(Principal, Nat)]) : T3.Value {
    let out = Buffer.Buffer<T3.Value>(pairs.size());
    for ((owner, amount) in pairs.vals()) {
      if (amount > 0) { out.add(#Map([("owner", Icrc3Log.principal(owner)), ("amount", #Nat(amount))])) };
    };
    #Array(Buffer.toArray(out));
  };

  /// Ledgers and amounts as an Array of Map { ledger; amount }.
  private func icrc3_ledger_amounts(pairs : [(Principal, Nat)]) : T3.Value {
    #Array(Array.map<(Principal, Nat), T3.Value>(pairs, func((ledger, amount)) { #Map([("ledger", Icrc3Log.principal(ledger)), ("amount", #Nat(amount))]) }));
  };

  private func icrc3_token_value(ledger : Principal, m : T.TokenMetadata, balance : ?Nat) : T3.Value {
    let base : [(Text, T3.Value)] = [("ledger", Icrc3Log.principal(ledger)), ("symbol", #Text(m.symbol)), ("decimals", #Nat(Nat8.toNat(m.decimals))), ("fee", #Nat(m.fee))];
    #Map(switch (balance) { case (?b) Array.append(base, [("balance", #Nat(b))]); case null base });
  };

  /// A per-token minimum or maximum; without `amount` there is none (the default applies).
  private func icrc3_limit_value(ledger : Principal, amount : ?Nat) : T3.Value {
    switch (amount) {
      case (?a) { #Map([("ledger", Icrc3Log.principal(ledger)), ("amount", #Nat(a))]) };
      case null { #Map([("ledger", Icrc3Log.principal(ledger))]) };
    };
  };

  // ---- standard ICRC-3 read interface ----

  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult {
    Icrc3Log.getBlocks(icrc3, args);
  };

  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult {
    Icrc3Log.getArchives(icrc3, args);
  };

  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate {
    Icrc3Log.tipCertificate(icrc3);
  };

  public query func icrc3_supported_block_types() : async [T3.BlockType] {
    Icrc3Log.supportedBlockTypes(icrc3_catalogue);
  };

  public query func icrc10_supported_standards() : async [T3.SupportedStandard] {
    Icrc3Log.supportedStandards();
  };

  public query func icrc3_log_status() : async T3.LogStatus {
    Icrc3Log.status(icrc3, icrc3_rt);
  };

  // ---- administration ----

  public shared ({ caller }) func admin_set_icrc3_settings(update : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    if (not is_admin(caller)) { return #Err("Only admins can change the ICRC-3 settings") };
    switch (Icrc3Log.applySettings(icrc3, update)) {
      case (#Err(e)) { #Err(e) };
      case (#Ok(changes)) {
        for ((key, old_value, new_value) in changes.vals()) {
          icrc3_config(?caller, key, #Nat(new_value), ?#Nat(old_value));
        };
        #Ok(icrc3.settings);
      };
    };
  };

  /// Move every live block to the archives now (creating archives as needed). Returns the number of blocks moved.
  public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    if (not is_admin(caller)) { return #Err("Only admins can trigger a spill") };
    if (icrc3_rt.spilling) { return #Err("A spill is already in progress") };
    let moved = await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true);
    ignore await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
    #Ok(moved);
  };

  /// Re-apply the intended controllers (this canister and SNS root) to every archive.
  public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
    if (not is_admin(caller)) { Debug.trap("Only admins can repair archive controllers") };
    await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
  };

  // ---- SNS registration of archives ----

  /// Where each archive stands with its RegisterDappCanisters proposal.
  public query func icrc3_registration_status() : async Icrc3Sns.Status {
    Icrc3Sns.status(icrc3_sns, icrc3_sns_env());
  };

  /// The SNS neuron (32-byte id) that has this canister as a hotkey and submits the
  /// registration proposals; null switches the step off.
  public shared ({ caller }) func admin_set_icrc3_proposal_neuron(neuron : ?Blob) : async { #Ok; #Err : Text } {
    if (not is_admin(caller)) { return #Err("Only admins can set the proposal neuron") };
    let old = icrc3_sns.neuron;
    switch (Icrc3Sns.setNeuron(icrc3_sns, neuron)) {
      case (#Err(e)) { #Err(e) };
      case (#Ok) {
        let asValue = func(n : ?Blob) : T3.Value { switch (n) { case (?b) { #Blob(b) }; case null { #Text("none") } } };
        icrc3_config(?caller, "icrc3_proposal_neuron", asValue(neuron), ?asValue(old));
        #Ok;
      };
    };
  };

  /// Submit the pending registration proposals now instead of at the next spill check.
  public shared ({ caller }) func admin_icrc3_register_archives_now() : async { #Ok : Nat; #Err : Text } {
    if (not is_admin(caller)) { return #Err("Only admins can submit registration proposals") };
    #Ok(await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env()));
  };

  /// Forget an archive's proposal (after a rejection) so a new one is submitted.
  public shared ({ caller }) func admin_icrc3_reset_archive_registration(canister_id : Principal) : async { #Ok : Bool; #Err : Text } {
    if (not is_admin(caller)) { return #Err("Only admins can reset a registration") };
    #Ok(Icrc3Sns.reset(icrc3_sns, canister_id));
  };

  // ---- background work ----

  private func icrc3_timer_job() : async () {
    ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false);
    ignore await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
  };

  private func ensure_icrc3_timer<system>() {
    Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job);
  };

  // the ICRC-3 spill check (every 15 minutes; started on install, and on upgrade before
  // postupgrade, which calls it again harmlessly)
  ensure_icrc3_timer<system>();

  // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
  // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
  public query func get_api_doc() : async Text { ApiDoc.text };

  // Ingress guard (src/IngressGuard.mo): queries are never accepted as update calls, which
  // would go through consensus at our cost, and arguments are capped in size.
  system func inspect({ arg : Blob; msg : {
    #get_api_doc : Any;
    #acceptsVote : Any;
    #add_admin : Any;
    #add_known_token : Any;
    #admin_icrc3_register_archives_now : Any;
    #admin_icrc3_repair_archive_controllers : Any;
    #admin_icrc3_reset_archive_registration : Any;
    #admin_icrc3_spill_now : Any;
    #admin_set_icrc3_proposal_neuron : Any;
    #admin_set_icrc3_settings : Any;
    #all_token_balances : Any;
    #balance_of : Any;
    #balance_reconciliation : Any;
    #balance_reconciliation_from_balances : Any;
    #balances_count : Any;
    #balances_of_hotkey : Any;
    #balances_of_hotkey_neurons : Any;
    #caller_is_admin : Any;
    #check_wallet_token_balances : Any;
    #check_whitelisted_token_balances : Any;
    #claim_full_balance_of_hotkey : Any;
    #clear_all_balances_and_distributions : Any;
    #clear_balances : Any;
    #clear_claim_events : Any;
    #clear_distribution_events : Any;
    #clear_imported_neurons : Any;
    #clear_imported_owners : Any;
    #clear_imported_props : Any;
    #clear_known_tokens : Any;
    #clear_total_distributions : Any;
    #clear_user_distribution_events : Any;
    #clear_user_distributions : Any;
    #clear_whitelisted_tokens : Any;
    #get_all_token_max_distributions : Any;
    #get_all_token_min_distributions : Any;
    #get_all_user_balances : Any;
    #get_claim_events : Any;
    #get_claim_events_for_hotkey : Any;
    #get_distribution_events : Any;
    #get_empty_ballot_proposals : Any;
    #get_error_claim_events : Any;
    #get_event_statistics : Any;
    #get_event_statistics_status : Any;
    #get_distribution_events_page : Any;
    #get_user_distribution_events_page : Any;
    #get_claim_events_page : Any;
    #get_highest_closed_proposal_id : Any;
    #get_hotkey_claimed_amounts : Any;
    #get_hotkey_voting_power : Any;
    #get_import_next_neuron_id : Any;
    #get_import_stage : Any;
    #get_imported_proposal_max : Any;
    #get_known_tokens : Any;
    #get_main_loop_status : Any;
    #get_neuron_import_status : Any;
    #get_neuron_statistics : Any;
    #get_neuron_voting_history : Any;
    #get_proposal_ballots : Any;
    #get_proposal_import_status : Any;
    #get_token_balance_check_status : Any;
    #get_token_distribution_events : Any;
    #get_token_max_distribution : Any;
    #get_token_metadata : Any;
    #get_token_min_distribution : Any;
    #get_token_total_distribution : Any;
    #get_total_distributions : Any;
    #get_unmatched_pending_claims : Any;
    #get_user_distribution_events : Any;
    #get_user_distributions : Any;
    #get_user_specific_distribution_events : Any;
    #get_user_token_distribution : Any;
    #get_user_token_distribution_events : Any;
    #get_user_voting_history : Any;
    #get_wallet_known_tokens : Any;
    #get_wallet_token_check_status : Any;
    #get_whitelisted_tokens : Any;
    #icrc10_supported_standards : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_log_status : Any;
    #icrc3_registration_status : Any;
    #icrc3_supported_block_types : Any;
    #import_all_neurons : Any;
    #import_all_new_neurons : Any;
    #import_all_new_proposals : Any;
    #import_all_proposals : Any;
    #import_whitelisted_tokens_from_icpswap : Any;
    #import_whitelisted_tokens_from_swaprunner : Any;
    #imported_neurons_count : Any;
    #imported_owners_count : Any;
    #imported_props_count : Any;
    #list_admins : Any;
    #list_claim_incidents : Any;
    #principal_is_admin : Any;
    #remove_admin : Any;
    #remove_known_token : Any;
    #remove_token_max_distribution : Any;
    #remove_token_min_distribution : Any;
    #resolve_claim_incident : Any;
    #set_token_max_distribution : Any;
    #set_token_min_distribution : Any;
    #start_distribution_cycle : Any;
    #start_rll_main_loop : Any;
    #stop_distribution_cycle : Any;
    #stop_neuron_import : Any;
    #stop_proposal_import : Any;
    #stop_rll_main_loop : Any;
    #stop_token_balance_check : Any;
    #stop_wallet_token_check : Any;
    #total_balance : Any;
  } }) : Bool {
    switch (msg) {
      case (
        #get_api_doc _
        or #acceptsVote _
        or #all_token_balances _
        or #balance_of _
        or #balance_reconciliation_from_balances _
        or #balances_count _
        or #balances_of_hotkey_neurons _
        or #caller_is_admin _
        or #get_all_token_max_distributions _
        or #get_all_token_min_distributions _
        or #get_all_user_balances _
        or #get_claim_events _
        or #get_claim_events_for_hotkey _
        or #get_distribution_events _
        or #get_empty_ballot_proposals _
        or #get_error_claim_events _
        or #get_event_statistics _
        or #get_event_statistics_status _
        or #get_distribution_events_page _
        or #get_user_distribution_events_page _
        or #get_claim_events_page _
        or #get_highest_closed_proposal_id _
        or #get_hotkey_claimed_amounts _
        or #get_hotkey_voting_power _
        or #get_import_next_neuron_id _
        or #get_import_stage _
        or #get_imported_proposal_max _
        or #get_known_tokens _
        or #get_main_loop_status _
        or #get_neuron_import_status _
        or #get_neuron_statistics _
        or #get_neuron_voting_history _
        or #get_proposal_ballots _
        or #get_proposal_import_status _
        or #get_token_balance_check_status _
        or #get_token_distribution_events _
        or #get_token_max_distribution _
        or #get_token_metadata _
        or #get_token_min_distribution _
        or #get_token_total_distribution _
        or #get_total_distributions _
        or #get_unmatched_pending_claims _
        or #get_user_distribution_events _
        or #get_user_distributions _
        or #get_user_specific_distribution_events _
        or #get_user_token_distribution _
        or #get_user_token_distribution_events _
        or #get_user_voting_history _
        or #get_wallet_known_tokens _
        or #get_wallet_token_check_status _
        or #get_whitelisted_tokens _
        or #icrc10_supported_standards _
        or #icrc3_get_archives _
        or #icrc3_get_blocks _
        or #icrc3_get_tip_certificate _
        or #icrc3_log_status _
        or #icrc3_registration_status _
        or #icrc3_supported_block_types _
        or #imported_neurons_count _
        or #imported_owners_count _
        or #imported_props_count _
        or #list_admins _
        or #list_claim_incidents _
        or #principal_is_admin _
        or #total_balance _
      ) false;
      case _ arg.size() <= IngressGuard.SMALL_ARG;
    };
  };

};
