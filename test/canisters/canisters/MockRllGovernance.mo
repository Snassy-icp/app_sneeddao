/// Test double for the Sneed SNS governance canister as the reward loop (rll)
/// and sneed_premium read it: `list_neurons` with pages (sorted by id, the
/// page starts after `start_page_at`) and the `of_principal` filter,
/// `get_proposal` with ballots, and `get_nervous_system_parameters`. Tests load
/// neurons and proposals through the helpers at the bottom; a neuron's owner
/// gets every permission type (ten of them), a hotkey only two.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Principal "mo:base/Principal";

persistent actor MockRllGovernance {
  public type NeuronId = { id : Blob };
  public type NeuronPermission = { principal : ?Principal; permission_type : [Int32] };
  public type DissolveState = { #DissolveDelaySeconds : Nat64; #WhenDissolvedTimestampSeconds : Nat64 };
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type DisburseMaturityInProgress = {
    timestamp_of_disbursement_seconds : Nat64;
    amount_e8s : Nat64;
    account_to_disburse_to : ?Account;
    finalize_disbursement_timestamp_seconds : ?Nat64;
  };
  public type Followees = { followees : [NeuronId] };
  public type Neuron = {
    id : ?NeuronId;
    staked_maturity_e8s_equivalent : ?Nat64;
    permissions : [NeuronPermission];
    maturity_e8s_equivalent : Nat64;
    cached_neuron_stake_e8s : Nat64;
    created_timestamp_seconds : Nat64;
    source_nns_neuron_id : ?Nat64;
    auto_stake_maturity : ?Bool;
    aging_since_timestamp_seconds : Nat64;
    dissolve_state : ?DissolveState;
    voting_power_percentage_multiplier : Nat64;
    vesting_period_seconds : ?Nat64;
    disburse_maturity_in_progress : [DisburseMaturityInProgress];
    followees : [(Nat64, Followees)];
    neuron_fees_e8s : Nat64;
  };
  public type ListNeurons = { of_principal : ?Principal; limit : Nat32; start_page_at : ?NeuronId };

  public type Ballot = { vote : Int32; cast_timestamp_seconds : Nat64; voting_power : Nat64 };
  public type Tally = { no : Nat64; yes : Nat64; total : Nat64; timestamp_seconds : Nat64 };
  public type Percentage = { basis_points : ?Nat64 };
  public type GovernanceError = { error_message : Text; error_type : Int32 };
  public type Proposal = { url : Text; title : Text; action : ?{ #Motion : { motion_text : Text } }; summary : Text };
  public type ProposalData = {
    id : ?{ id : Nat64 };
    payload_text_rendering : ?Text;
    action : Nat64;
    failure_reason : ?GovernanceError;
    ballots : [(Text, Ballot)];
    minimum_yes_proportion_of_total : ?Percentage;
    reward_event_round : Nat64;
    failed_timestamp_seconds : Nat64;
    reward_event_end_timestamp_seconds : ?Nat64;
    proposal_creation_timestamp_seconds : Nat64;
    initial_voting_period_seconds : Nat64;
    reject_cost_e8s : Nat64;
    latest_tally : ?Tally;
    wait_for_quiet_deadline_increase_seconds : Nat64;
    decided_timestamp_seconds : Nat64;
    proposal : ?Proposal;
    proposer : ?NeuronId;
    wait_for_quiet_state : ?{ current_deadline_timestamp_seconds : Nat64 };
    minimum_yes_proportion_of_exercised : ?Percentage;
    is_eligible_for_rewards : Bool;
    executed_timestamp_seconds : Nat64;
  };
  public type GetProposalResponse = { result : ?{ #Error : GovernanceError; #Proposal : ProposalData } };

  public type NervousSystemParameters = {
    default_followees : ?{ followees : [(Nat64, Followees)] };
    max_dissolve_delay_seconds : ?Nat64;
    max_dissolve_delay_bonus_percentage : ?Nat64;
    max_followees_per_function : ?Nat64;
    automatically_advance_target_version : ?Bool;
    neuron_claimer_permissions : ?{ permissions : [Int32] };
    neuron_minimum_stake_e8s : ?Nat64;
    max_neuron_age_for_age_bonus : ?Nat64;
    initial_voting_period_seconds : ?Nat64;
    neuron_minimum_dissolve_delay_to_vote_seconds : ?Nat64;
    reject_cost_e8s : ?Nat64;
    max_proposals_to_keep_per_action : ?Nat32;
    wait_for_quiet_deadline_increase_seconds : ?Nat64;
    max_number_of_neurons : ?Nat64;
    transaction_fee_e8s : ?Nat64;
    max_number_of_proposals_with_ballots : ?Nat64;
    max_age_bonus_percentage : ?Nat64;
    neuron_grantable_permissions : ?{ permissions : [Int32] };
    voting_rewards_parameters : ?{
      final_reward_rate_basis_points : ?Nat64;
      initial_reward_rate_basis_points : ?Nat64;
      reward_rate_transition_duration_seconds : ?Nat64;
      round_duration_seconds : ?Nat64;
    };
    maturity_modulation_disabled : ?Bool;
    max_number_of_principals_per_neuron : ?Nat64;
  };

  stable var neurons : [Neuron] = [];
  stable var proposals : [ProposalData] = [];
  stable var params : NervousSystemParameters = {
    default_followees = null; max_dissolve_delay_seconds = null; max_dissolve_delay_bonus_percentage = null;
    max_followees_per_function = null; automatically_advance_target_version = null; neuron_claimer_permissions = null;
    neuron_minimum_stake_e8s = null; max_neuron_age_for_age_bonus = null; initial_voting_period_seconds = null;
    neuron_minimum_dissolve_delay_to_vote_seconds = null; reject_cost_e8s = null; max_proposals_to_keep_per_action = null;
    wait_for_quiet_deadline_increase_seconds = null; max_number_of_neurons = null; transaction_fee_e8s = null;
    max_number_of_proposals_with_ballots = null; max_age_bonus_percentage = null; neuron_grantable_permissions = null;
    voting_rewards_parameters = null; maturity_modulation_disabled = null; max_number_of_principals_per_neuron = null;
  };

  func idOf(n : Neuron) : Blob { switch (n.id) { case (?i) i.id; case null "" } };

  // ---- the governance interface the canisters under test use ----

  public query func list_neurons(req : ListNeurons) : async { neurons : [Neuron] } {
    var out = Array.sort<Neuron>(neurons, func(a, b) { Blob.compare(idOf(a), idOf(b)) });
    switch (req.start_page_at) {
      case (?start) { out := Array.filter<Neuron>(out, func(n) { Blob.compare(idOf(n), start.id) == #greater }) };
      case null {};
    };
    switch (req.of_principal) {
      case (?p) { out := Array.filter<Neuron>(out, func(n) { Array.find<NeuronPermission>(n.permissions, func(perm) { perm.principal == ?p }) != null }) };
      case null {};
    };
    let limit = Nat32.toNat(req.limit);
    if (out.size() > limit) { out := Array.subArray<Neuron>(out, 0, limit) };
    { neurons = out };
  };


  public query func get_proposal(req : { proposal_id : ?{ id : Nat64 } }) : async GetProposalResponse {
    switch (req.proposal_id) {
      case null { { result = ?#Error({ error_message = "no id"; error_type = 1 }) } };
      case (?pid) {
        switch (Array.find<ProposalData>(proposals, func(p) { p.id == ?pid })) {
          case (?p) { { result = ?#Proposal(p) } };
          case null { { result = ?#Error({ error_message = "Proposal not found"; error_type = 4 }) } };
        };
      };
    };
  };

  public query func get_nervous_system_parameters() : async NervousSystemParameters { params };

  // ---- test helpers ----

  public type NeuronSpec = {
    id : Blob;
    owner : ?Principal;          // gets all ten permission types; null = no owner permission
    hotkeys : [Principal];       // get permission types [3, 4] only
    hotkeys_first : Bool;        // list the hotkeys before the owner
    stake_e8s : Nat64;
    dissolve_delay_seconds : Nat64;
    aging_since_timestamp_seconds : Nat64;
    multiplier : Nat64;          // voting_power_percentage_multiplier
  };

  func build(spec : NeuronSpec) : Neuron {
    let ownerPerm : [NeuronPermission] = switch (spec.owner) {
      case (?o) { [{ principal = ?o; permission_type = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }] };
      case null { [] };
    };
    let hotkeyPerms = Array.map<Principal, NeuronPermission>(spec.hotkeys, func(h) { { principal = ?h; permission_type = [3, 4] } });
    {
      id = ?{ id = spec.id };
      staked_maturity_e8s_equivalent = null;
      permissions = if (spec.hotkeys_first) { Array.append(hotkeyPerms, ownerPerm) } else { Array.append(ownerPerm, hotkeyPerms) };
      maturity_e8s_equivalent = 0;
      cached_neuron_stake_e8s = spec.stake_e8s;
      created_timestamp_seconds = spec.aging_since_timestamp_seconds;
      source_nns_neuron_id = null;
      auto_stake_maturity = null;
      aging_since_timestamp_seconds = spec.aging_since_timestamp_seconds;
      dissolve_state = ?#DissolveDelaySeconds(spec.dissolve_delay_seconds);
      voting_power_percentage_multiplier = spec.multiplier;
      vesting_period_seconds = null;
      disburse_maturity_in_progress = [];
      followees = [];
      neuron_fees_e8s = 0;
    };
  };

  public shared func add_neuron(spec : NeuronSpec) : async () {
    neurons := Array.append(Array.filter<Neuron>(neurons, func(n) { idOf(n) != spec.id }), [build(spec)]);
  };

  /// `count` neurons owned by `owner` with ids 0xF0 0xF0 <i as two bytes>, no votes anywhere.
  public shared func add_filler_neurons(count : Nat, owner : Principal) : async () {
    var added : [Neuron] = [];
    var i = 0;
    while (i < count) {
      let id = Blob.fromArray([0xF0, 0xF0, Nat8.fromNat(i / 256), Nat8.fromNat(i % 256)]);
      added := Array.append(added, [build({ id; owner = ?owner; hotkeys = []; hotkeys_first = false; stake_e8s = 1; dissolve_delay_seconds = 0; aging_since_timestamp_seconds = 0; multiplier = 100 })]);
      i += 1;
    };
    neurons := Array.append(neurons, added);
  };

  public shared func clear_neurons() : async () { neurons := [] };
  public query func neuron_count() : async Nat { neurons.size() };

  public type ProposalSpec = { id : Nat64; title : Text; deadline_seconds : Nat64; ballots : [(Text, Ballot)] };

  public shared func set_proposal(spec : ProposalSpec) : async () {
    let p : ProposalData = {
      id = ?{ id = spec.id };
      payload_text_rendering = null;
      action = 1;
      failure_reason = null;
      ballots = spec.ballots;
      minimum_yes_proportion_of_total = null;
      reward_event_round = 0;
      failed_timestamp_seconds = 0;
      reward_event_end_timestamp_seconds = null;
      proposal_creation_timestamp_seconds = if (spec.deadline_seconds > 100) { spec.deadline_seconds - 100 } else { 0 };
      initial_voting_period_seconds = 100;
      reject_cost_e8s = 0;
      latest_tally = null;
      wait_for_quiet_deadline_increase_seconds = 0;
      decided_timestamp_seconds = 0;
      proposal = ?{ url = ""; title = spec.title; action = null; summary = "" };
      proposer = null;
      wait_for_quiet_state = ?{ current_deadline_timestamp_seconds = spec.deadline_seconds };
      minimum_yes_proportion_of_exercised = null;
      is_eligible_for_rewards = true;
      executed_timestamp_seconds = 0;
    };
    proposals := Array.append(Array.filter<ProposalData>(proposals, func(x) { x.id != ?{ id = spec.id } }), [p]);
  };

  public shared func clear_proposals() : async () { proposals := [] };

  // ---- manage_neuron, for the ICRC-3 archive registration of rll (src/icrc3/SnsRegister.mo):
  // a MakeProposal from a hotkey of the neuron is accepted and recorded ----
  public type MakeProposal = { title : Text; url : Text; summary : Text; action : ?{ #RegisterDappCanisters : { canister_ids : [Principal] } } };
  public type ManageNeuronResponse = { command : ?{ #MakeProposal : { proposal_id : ?{ id : Nat64 } }; #Error : { error_message : Text; error_type : Int32 } } };
  public type ProposalRecord = { id : Nat64; proposer : Principal; neuron : Blob; title : Text; url : Text; summary : Text; canister_ids : [Principal] };
  stable var hotkeys : [(Blob, Principal)] = [];
  stable var made : [ProposalRecord] = [];
  stable var next_made_id : Nat64 = 100;

  public shared ({ caller }) func manage_neuron(req : { subaccount : Blob; command : ?{ #MakeProposal : MakeProposal } }) : async ManageNeuronResponse {
    if (Array.find<(Blob, Principal)>(hotkeys, func((n, p)) { n == req.subaccount and p == caller }) == null) {
      return { command = ?#Error({ error_message = "Caller is not authorized to perform this operation on the neuron"; error_type = 3 }) };
    };
    switch (req.command) {
      case (?#MakeProposal(p)) {
        let id = next_made_id;
        next_made_id += 1;
        let canister_ids = switch (p.action) { case (?#RegisterDappCanisters(r)) { r.canister_ids }; case null { [] } };
        made := Array.append(made, [{ id; proposer = caller; neuron = req.subaccount; title = p.title; url = p.url; summary = p.summary; canister_ids }]);
        { command = ?#MakeProposal({ proposal_id = ?{ id } }) };
      };
      case null { { command = ?#Error({ error_message = "no command"; error_type = 1 }) } };
    };
  };
  public shared func add_hotkey(neuron : Blob, p : Principal) : async () { hotkeys := Array.append(hotkeys, [(neuron, p)]) };
  public query func list_proposals() : async [ProposalRecord] { made };

  public shared func set_parameters(p : {
    max_dissolve_delay_seconds : Nat64;
    max_dissolve_delay_bonus_percentage : Nat64;
    neuron_minimum_dissolve_delay_to_vote_seconds : Nat64;
    max_neuron_age_for_age_bonus : Nat64;
    max_age_bonus_percentage : Nat64;
  }) : async () {
    params := {
      params with
      max_dissolve_delay_seconds = ?p.max_dissolve_delay_seconds;
      max_dissolve_delay_bonus_percentage = ?p.max_dissolve_delay_bonus_percentage;
      neuron_minimum_dissolve_delay_to_vote_seconds = ?p.neuron_minimum_dissolve_delay_to_vote_seconds;
      max_neuron_age_for_age_bonus = ?p.max_neuron_age_for_age_bonus;
      max_age_bonus_percentage = ?p.max_age_bonus_percentage;
    };
  };
};
