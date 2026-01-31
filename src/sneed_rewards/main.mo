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

import T "Types";

shared (deployer) actor class SneedRLL() = this {

  private func this_canister_id() : Principal {
      Principal.fromActor(this);
  };
    
  // The Sneed SNS governance canister principal
  let sneed_governance_canister_id = Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai");

  let SWAPRUNNER_CANISTER_ID : Text = "tt72q-zqaaa-aaaaj-az4va-cai";


  // Admin principals
  stable var admin_principals : [Principal] = [
    sneed_governance_canister_id, // sneed_governance_canister_id
    Principal.fromText("d7zib-qo5mr-qzmpb-dtyof-l7yiu-pu52k-wk7ng-cbm3n-ffmys-crbkz-nae"), // Sneed team admin
  ];

  // Imported neurons (stable)
  stable var stable_neurons : [(Blob, T.Neuron)]= []; // Neuron id
  stable var stable_owners : [(Blob, Principal)]= []; // Neuron id
  stable var stable_props : [(Int, T.ProposalData)]= []; // Proposal id

  stable var stable_balances : [(Principal, T.LocalBalances)]= []; // Owner (Principal) id

  stable var imported_proposal_max : Nat64 = 0;

  stable var import_next_neuron_id : ?T.NeuronId = null;

  stable var stable_whitelisted_tokens : [(Principal, T.TokenMetadata)] = [];
  var whitelisted_tokens = Map.fromIter<Principal, T.TokenMetadata>(stable_whitelisted_tokens.vals(), 10, Principal.equal, Principal.hash);

  stable var stable_known_tokens : [(Principal, T.TokenMetadata)] = [];
  var known_tokens = Map.fromIter<Principal, T.TokenMetadata>(stable_known_tokens.vals(), 10, Principal.equal, Principal.hash);

  // Track total distributions per token
  stable var stable_total_distributions : [(Principal, Nat)] = [];
  var total_distributions = Map.fromIter<Principal, Nat>(stable_total_distributions.vals(), 10, Principal.equal, Principal.hash);

  stable var stable_user_distributions : [(Principal, T.UserDistributions)] = [];
  var user_distributions = Map.fromIter<Principal, T.UserDistributions>(stable_user_distributions.vals(), 100, Principal.equal, Principal.hash);

  // Distribution event log
  stable var stable_distribution_events : [T.DistributionEvent] = [];
  var distribution_events = Buffer.fromArray<T.DistributionEvent>(stable_distribution_events);

  // User distribution event log
  stable var stable_user_distribution_events : [T.UserDistributionEvent] = [];
  var user_distribution_events = Buffer.fromArray<T.UserDistributionEvent>(stable_user_distribution_events);

  // Event sequence counter
  stable var event_sequence : Nat = 0;

  // Claim and transfer event logs
  stable var stable_claim_events : [T.ClaimEvent] = [];
  var claim_events = Buffer.fromArray<T.ClaimEvent>(stable_claim_events);

  // Imported neurons
  var neurons = Map.fromIter<Blob, T.Neuron>(stable_neurons.vals(), 100, Blob.equal, Blob.hash);
  // Owning principals for imported neurons
  var owners = Map.fromIter<Blob, Principal>(stable_owners.vals(), 100, Blob.equal, Blob.hash);

  var props = Map.fromIter<Int, T.ProposalData>(stable_props.vals(), 100, Int.equal, Int.hash);

  var balances = Map.fromIter<Principal, T.LocalBalances>(stable_balances.vals(), 100, Principal.equal, Principal.hash);

  var import_neuron_ticks : Nat = 0;
  var import_prop_ticks : Nat = 0;
  var distribute_tokens_ticks : Nat = 0;


  let sneed_exclude_principal = Principal.fromText("umo43-o3yqa-363iw-wroso-jm5az-kmfp2-rdzoj-q7il2-zfhcj-l35r7-oqe");

  stable var MIN_FEE_MULTIPLIER : Nat = 10;

  let sneed_gov_canister = actor (Principal.toText(sneed_governance_canister_id)) : actor {
    get_proposal : shared query T.GetProposal -> async T.GetProposalResponse;
    get_neuron : shared query T.GetNeuron -> async T.GetNeuronResponse;
    list_neurons : shared query T.ListNeurons -> async T.ListNeuronsResponse;
  };  

  // SwapRunner actor
  let swaprunner = actor(SWAPRUNNER_CANISTER_ID) : actor {
    get_all_tokens : shared query () -> async [(Principal, T.SwapRunnerTokenMetadata)];
  };  

  let MAX_TICKS : Nat = 250; // maximum number of ticks for a longrunning function

  // Track token balance check state
  stable var token_balance_check_timer_id : ?Nat = null;
  stable var tokens_to_check : [(Principal, T.TokenMetadata)] = [];
  stable var current_token_check_index : Nat = 0;
  stable var token_check_ticks : Nat = 0;

  // Per-wallet known tokens tracking
  stable var stable_wallet_known_tokens : [(Principal, [(Principal, T.TokenMetadata)])] = [];
  var wallet_known_tokens = Map.HashMap<Principal, HashMap.HashMap<Principal, T.TokenMetadata>>(10, Principal.equal, Principal.hash);

  // Initialize wallet_known_tokens from stable storage
  for ((wallet, tokens) in stable_wallet_known_tokens.vals()) {
    let token_map = HashMap.HashMap<Principal, T.TokenMetadata>(10, Principal.equal, Principal.hash);
    for ((token_id, metadata) in tokens.vals()) {
      token_map.put(token_id, metadata);
    };
    wallet_known_tokens.put(wallet, token_map);
  };

  // Track wallet token check state
  stable var wallet_token_check_timer_id : ?Nat = null;
  stable var wallet_tokens_to_check : [(Principal, T.TokenMetadata)] = [];
  stable var current_wallet_token_check_index : Nat = 0;
  stable var wallet_token_check_ticks : Nat = 0;
  stable var current_wallet_being_checked : ?Principal = null;

  // Track per-token minimum distribution amounts
  stable var stable_token_min_distributions : [(Principal, Nat)] = [];
  var token_min_distributions = Map.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

  // Initialize token_min_distributions from stable storage
  for ((token_id, min_amount) in stable_token_min_distributions.vals()) {
    token_min_distributions.put(token_id, min_amount);
  };

  // Track per-token maximum distribution amounts
  stable var stable_token_max_distributions : [(Principal, Nat)] = [];
  var token_max_distributions = Map.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

  // Initialize token_max_distributions from stable storage
  for ((token_id, max_amount) in stable_token_max_distributions.vals()) {
    token_max_distributions.put(token_id, max_amount);
  };

  // PUBLIC API

  public query func balance_of(owner : Principal, icrc1_ledger_canister_id : Principal) : async Nat {
    get_balance(owner, icrc1_ledger_canister_id);
  };

  public query func total_balance(icrc1_ledger_canister_id : Principal) : async Nat {
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
  stable var orchestrator_stage : {
    #idle;
    #importing_whitelist;
    #checking_balances;
    #importing_neurons;
    #importing_proposals;
    #distributing_tokens;
  } = #idle;

  // Track actual running state of imports and distribution
  stable var distribution_cycle_timer_id : ?Nat = null;
  stable var neuron_import_timer_id : ?Nat = null;
  stable var proposal_import_timer_id : ?Nat = null;
  stable var token_distribution_timer_id : ?Nat = null;
  stable var current_distribution_token : ?Principal = null;

  // Track distribution progress
  stable var processed_token_count : Nat = 0;
  stable var total_tokens_to_process : Nat = 0;

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

  stable var main_loop_frequence_seconds : Nat = 60 * 60 * 24; // 24 hours

  stable var main_loop_timer_id : ?Nat = null;
  stable var main_loop_last_started : ?Nat = null;
  stable var main_loop_last_stopped : ?Nat = null;
  stable var main_loop_next_scheduled : ?Nat = null;
  stable var cycle_last_started : ?Nat = null;
  stable var cycle_last_ended : ?Nat = null;

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
    #ok("Distribution cycle stopped")
  };

  public shared ({ caller }) func start_distribution_cycle() : async Result.Result<Text, Text> {
    assert is_admin(caller);

    await run_distribution_cycle();
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
    Debug.print("Started distribution cycle with timer id " # debug_show(distribution_cycle_timer_id));
    #ok("Started distribution cycle with timer id " # debug_show(distribution_cycle_timer_id))
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
              await import_whitelisted_tokens_from_swaprunner_impl();
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

      // 1. Get server balance
      let server_balance = await token_canister.icrc1_balance_of({
        owner = this_canister_id();
        subaccount = null;
      });
    
      // 2. Get total distributed balance
      let total_distributed = await total_balance(token_id);

      Debug.print("Server balance: " # debug_show(server_balance) # ", total distributed: " # debug_show(total_distributed));

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
            null  // No exclusion
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

    // Log that we're about to attempt the transfer
    log_claim(seq, hotkey, icrc1_ledger_canister_id, amount, fee, #Pending, null, null);


    if (total_balance <= fee) {
        // Log failed claim due to insufficient funds
        log_claim(seq, hotkey, icrc1_ledger_canister_id, total_balance, fee, #Failed, ?("Insufficient funds. Total balance: " # debug_show(total_balance) # " is smaller than Fee: " # debug_show(fee)), null);
        
        for((owner, balance) in owner_balances.vals()) {
            ignore increase_balance(owner, icrc1_ledger_canister_id, balance);
        };      
        return #Err(#InsufficientFunds { balance = total_balance});
    };

    try {
        let transfer_args : T.TransferArgs = {
            from_subaccount = null;
            to = {
                owner = hotkey;
                subaccount = null;
            };
            amount = amount;
            fee = ?fee;
            memo = null;
            created_at_time = null;
        };


        let icrc1_ledger_canister = actor (Principal.toText(icrc1_ledger_canister_id)) : actor {
            icrc1_transfer(args : T.TransferArgs) : async T.TransferResult;
        };  

        let result = await icrc1_ledger_canister.icrc1_transfer(transfer_args);
        
        switch (result) {
            case (#Ok(index)) {
                // Log successful claim with tx_index
                log_claim(seq, hotkey, icrc1_ledger_canister_id, amount, fee, #Success, null, ?index);
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
        // Log error in claim
        log_claim(seq, hotkey, icrc1_ledger_canister_id, total_balance - fee, fee, #Failed, ?Error.message(e), null);
        
        for((owner, balance) in owner_balances.vals()) {
            ignore increase_balance(owner, icrc1_ledger_canister_id, balance);
        };
        return #Err(#GenericError { error_code = 1; message = Error.message(e); });
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
    let dist_list = calc_distribution_list(first_proposal_id, last_proposal_id, amount_to_share, exclude_principal);
    
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
        user_distribution_events.add({
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
      distribution_events.add({
        token_id = icrc1_ledger_canister_id;
        amount = total_distributed;
        timestamp = timestamp;
        proposal_range = proposal_range;
      });
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

  private func calc_distribution_list(first_proposal_id : T.ProposalId, last_proposal_id : T.ProposalId, amount_to_share : Nat, exclude_principal : ?Principal) : [(Principal, Nat)] {

    let votes = index_proposal_votes_between(first_proposal_id, last_proposal_id);
    let vp_total = sum_votes_total(votes, exclude_principal);    
    let shares = Map.HashMap<Principal, Nat>(votes.size(), Principal.equal, Principal.hash);

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

              };
            };
          };         
        };
      }; 
    };

    Iter.toArray(shares.entries());
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
  };


//ADMIN

  public shared ({ caller }) func clear_balances() : async () { 
    assert is_admin(caller);
    for (key in balances.keys()) { balances.delete(key); }; 
  };

  public shared ({ caller }) func clear_total_distributions() : async () { 
    assert is_admin(caller);
    for (key in total_distributions.keys()) { total_distributions.delete(key); };
  };

  public shared ({ caller }) func clear_user_distributions() : async () { 
    assert is_admin(caller);
    for (key in user_distributions.keys()) { user_distributions.delete(key); };
  };

  public shared ({ caller }) func clear_user_distribution_events() : async () { 
    assert is_admin(caller);
    user_distribution_events.clear(); 
  };

  public shared ({ caller }) func clear_distribution_events() : async () { 
    assert is_admin(caller);
    distribution_events.clear(); 
  };

  public shared ({ caller }) func clear_claim_events() : async () { 
    assert is_admin(caller);
    claim_events.clear(); 
  };
  
  public shared ({ caller }) func clear_all_balances_and_distributions() : async () { 
    assert is_admin(caller);
    for (key in balances.keys()) { balances.delete(key); }; 
    for (key in total_distributions.keys()) { total_distributions.delete(key); };
    for (key in user_distributions.keys()) { user_distributions.delete(key); };
    user_distribution_events.clear(); 
    distribution_events.clear(); 
    claim_events.clear(); 
  };


  public query func get_imported_proposal_max() : async Nat64 { imported_proposal_max; };
  public query func get_import_next_neuron_id() : async ?T.NeuronId { import_next_neuron_id; };

  public query func imported_neurons_count() : async Nat { neurons.size(); };
  public query func imported_owners_count() : async Nat { owners.size(); };
  public query func imported_props_count() : async Nat { props.size(); };
  public query func balances_count() : async Nat { balances.size(); };

  public shared ({ caller }) func clear_imported_neurons() : async () { 
    assert is_admin(caller);
    for (key in neurons.keys()) { neurons.delete(key); }; 
  };
  public shared ({ caller }) func clear_imported_owners() : async () { 
    assert is_admin(caller);
    for (key in owners.keys()) { owners.delete(key); }; 
  };
  public shared ({ caller }) func clear_imported_props() : async () {
    assert is_admin(caller);
    for (key in props.keys()) { props.delete(key); }; 
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
    } catch e {
      throw Error.reject("Failed to fetch token metadata: " # Error.message(e));
    };
  };

  public shared ({ caller }) func remove_known_token(token_ledger_id : Principal) : async () {
    assert is_admin(caller);
    known_tokens.delete(token_ledger_id);
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
  public query func get_user_specific_distribution_events(user : Principal) : async [T.UserDistributionEvent] {
    let events = Buffer.Buffer<T.UserDistributionEvent>(10);
    for (event in user_distribution_events.vals()) {
      if (event.user == user) {
        events.add(event);
      };
    };
    Buffer.toArray(events);
  };

  // Query function to get distribution events for a specific user and token
  public query func get_user_token_distribution_events(user : Principal, token_id : Principal) : async [T.UserDistributionEvent] {
    let events = Buffer.Buffer<T.UserDistributionEvent>(10);
    for (event in user_distribution_events.vals()) {
      if (event.user == user and event.token_id == token_id) {
        events.add(event);
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
    claim_events.add({
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
    for (key in whitelisted_tokens.keys()) {
      whitelisted_tokens.delete(key);
    };
  };

  public shared  ({ caller }) func clear_known_tokens() : async () {
    assert(is_admin(caller));
    for (key in known_tokens.keys()) {
      known_tokens.delete(key);
    };
  };

  var import_whitelisted_running = false;
  var cntImportedWhitelist = 0;
  var cntImportedWithBalance = 0;



  public shared ({ caller }) func import_whitelisted_tokens_from_swaprunner() : async () {    
    assert(is_admin(caller));

    await import_whitelisted_tokens_from_swaprunner_impl();
  };

  private func import_whitelisted_tokens_from_swaprunner_impl() : async () {    
    if (import_whitelisted_running) {
      return;
    };
    import_whitelisted_running := true;
    
    try { 

      let tokens = await swaprunner.get_all_tokens();

      for ((ledger_id, metadata) in tokens.vals()) {
        if (not import_whitelisted_running) {
          return;
        };
        
        switch (metadata.decimals, metadata.fee, metadata.name, metadata.symbol) {
          case (?decimals, ?fee, ?name, ?symbol) {
            switch (whitelisted_tokens.get(ledger_id)) {
              case (?_token) { /* o nothing */ };
              case (null) {
                // only add tokens with a standard starting with icrc1
                if (metadata.standard.chars().next() == ?'I' or metadata.standard.chars().next() == ?'i') {
                  cntImportedWhitelist += 1;

                  whitelisted_tokens.put(ledger_id, {
                    name = name;
                    symbol = symbol;  
                    fee = fee;
                    decimals = decimals;
                  });
                };
              };
            };
          };
          case _ { /* Skip tokens with missing required metadata */ };
        };
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

    token_min_distributions.put(token_id, min_amount);
    #ok("Set minimum distribution amount for token " # Principal.toText(token_id) # " to " # debug_show(min_amount))
  };

  public shared ({ caller }) func remove_token_min_distribution(token_id : Principal) : async Result.Result<Text, Text> {
    assert(is_admin(caller));
    
    switch (token_min_distributions.get(token_id)) {
      case (null) { 
        return #err("No minimum distribution amount set for token " # Principal.toText(token_id)); 
      };
      case (?_) {
        token_min_distributions.delete(token_id);
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

    token_max_distributions.put(token_id, max_amount);
    #ok("Set maximum distribution amount for token " # Principal.toText(token_id) # " to " # debug_show(max_amount))
  };

  public shared ({ caller }) func remove_token_max_distribution(token_id : Principal) : async Result.Result<Text, Text> {
    assert(is_admin(caller));
    
    switch (token_max_distributions.get(token_id)) {
      case (null) { 
        return #err("No maximum distribution amount set for token " # Principal.toText(token_id)); 
      };
      case (?_) {
        token_max_distributions.delete(token_id);
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

  public query func get_event_statistics() : async {
    all_time : {
      server_distributions : {
        total : Nat;
        per_token : [(Principal, Nat)];
      };
      user_distributions : {
        total : Nat;
        unique_users : Nat;
        per_token : [(Principal, Nat)];
      };
      claims : {
        total : Nat;
        successful : Nat;
        failed : Nat;
        pending : Nat;
        unique_users : Nat;
        per_token : [(Principal, Nat)];
      };
    };
    last_24h : {
      server_distributions : {
        total : Nat;
        per_token : [(Principal, Nat)];
      };
      user_distributions : {
        total : Nat;
        unique_users : Nat;
        per_token : [(Principal, Nat)];
      };
      claims : {
        total : Nat;
        successful : Nat;
        failed : Nat;
        pending : Nat;
        unique_users : Nat;
        per_token : [(Principal, Nat)];
      };
    };
  } {
    let current_time = Int.abs(Time.now());
    let twenty_four_hours_ago = current_time - (24 * 60 * 60 * 1_000_000_000); // 24 hours in nanoseconds

    // Initialize counters for all time
    var all_time_server_dist_count = 0;
    var all_time_user_dist_count = 0;
    var all_time_claims_total = 0;
    var all_time_claims_successful = 0;
    var all_time_claims_failed = 0;
    var all_time_claims_pending = 0;

    // Initialize counters for last 24h
    var last_24h_server_dist_count = 0;
    var last_24h_user_dist_count = 0;
    var last_24h_claims_total = 0;
    var last_24h_claims_successful = 0;
    var last_24h_claims_failed = 0;
    var last_24h_claims_pending = 0;

    // Track unique users
    let all_time_dist_users = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
    let last_24h_dist_users = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
    let all_time_claim_users = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
    let last_24h_claim_users = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);

    // Track per-token amounts (only for successful claims)
    let all_time_server_dist_amounts = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
    let last_24h_server_dist_amounts = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
    let all_time_user_dist_amounts = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
    let last_24h_user_dist_amounts = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
    let all_time_claim_amounts = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
    let last_24h_claim_amounts = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);

    // Count server distributions
    for (event in distribution_events.vals()) {
      all_time_server_dist_count += 1;
      let current_amount = switch (all_time_server_dist_amounts.get(event.token_id)) {
        case (null) { 0 };
        case (?amount) { amount };
      };
      all_time_server_dist_amounts.put(event.token_id, current_amount + event.amount);
      
      if (event.timestamp >= twenty_four_hours_ago) {
        last_24h_server_dist_count += 1;
        let current_24h_amount = switch (last_24h_server_dist_amounts.get(event.token_id)) {
          case (null) { 0 };
          case (?amount) { amount };
        };
        last_24h_server_dist_amounts.put(event.token_id, current_24h_amount + event.amount);
      };
    };

    // Count user distributions
    for (event in user_distribution_events.vals()) {
      all_time_user_dist_count += 1;
      all_time_dist_users.put(event.user, true);
      let current_amount = switch (all_time_user_dist_amounts.get(event.token_id)) {
        case (null) { 0 };
        case (?amount) { amount };
      };
      all_time_user_dist_amounts.put(event.token_id, current_amount + event.amount);
      
      if (event.timestamp >= twenty_four_hours_ago) {
        last_24h_user_dist_count += 1;
        last_24h_dist_users.put(event.user, true);
        let current_24h_amount = switch (last_24h_user_dist_amounts.get(event.token_id)) {
          case (null) { 0 };
          case (?amount) { amount };
        };
        last_24h_user_dist_amounts.put(event.token_id, current_24h_amount + event.amount);
      };
    };

    // Count claims
    for (event in claim_events.vals()) {
      all_time_claims_total += 1;
      all_time_claim_users.put(event.hotkey, true);
      
      switch (event.status) {
        case (#Success) { 
          all_time_claims_successful += 1;
          // Only add amounts for successful claims
          let current_amount = switch (all_time_claim_amounts.get(event.token_id)) {
            case (null) { 0 };
            case (?amount) { amount };
          };
          all_time_claim_amounts.put(event.token_id, current_amount + event.amount);
        };
        case (#Failed) { all_time_claims_failed += 1; };
        case (#Pending) { all_time_claims_pending += 1; };
      };

      // Convert timestamp from Nat64 to Int for comparison
      let event_time = Int.abs(Nat64.toNat(event.timestamp));
      if (event_time >= twenty_four_hours_ago) {
        last_24h_claims_total += 1;
        last_24h_claim_users.put(event.hotkey, true);
        
        switch (event.status) {
          case (#Success) { 
            last_24h_claims_successful += 1;
            // Only add amounts for successful claims
            let current_24h_amount = switch (last_24h_claim_amounts.get(event.token_id)) {
              case (null) { 0 };
              case (?amount) { amount };
            };
            last_24h_claim_amounts.put(event.token_id, current_24h_amount + event.amount);
          };
          case (#Failed) { last_24h_claims_failed += 1; };
          case (#Pending) { last_24h_claims_pending += 1; };
        };
      };
    };

    {
      all_time = {
        server_distributions = {
          total = all_time_server_dist_count;
          per_token = Iter.toArray(all_time_server_dist_amounts.entries());
        };
        user_distributions = {
          total = all_time_user_dist_count;
          unique_users = all_time_dist_users.size();
          per_token = Iter.toArray(all_time_user_dist_amounts.entries());
        };
        claims = {
          total = all_time_claims_total;
          successful = all_time_claims_successful;
          failed = all_time_claims_failed;
          pending = all_time_claims_pending;
          unique_users = all_time_claim_users.size();
          per_token = Iter.toArray(all_time_claim_amounts.entries());
        };
      };
      last_24h = {
        server_distributions = {
          total = last_24h_server_dist_count;
          per_token = Iter.toArray(last_24h_server_dist_amounts.entries());
        };
        user_distributions = {
          total = last_24h_user_dist_count;
          unique_users = last_24h_dist_users.size();
          per_token = Iter.toArray(last_24h_user_dist_amounts.entries());
        };
        claims = {
          total = last_24h_claims_total;
          successful = last_24h_claims_successful;
          failed = last_24h_claims_failed;
          pending = last_24h_claims_pending;
          unique_users = last_24h_claim_users.size();
          per_token = Iter.toArray(last_24h_claim_amounts.entries());
        };
      };
    }
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
};
