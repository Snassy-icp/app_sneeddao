/// Test double for an SNS governance canister as the forum sees it
/// (src/SnsTypes.mo): `list_neurons` by principal (owner or hotkey),
/// `get_nervous_system_parameters` and `get_metadata`. Neurons are set by the
/// tests; the parameters make voting power = stake (no bonuses) with a
/// minimum dissolve delay of 100 s to vote, so a neuron below it has none.
import Array "mo:base/Array";
import Debug "mo:base/Debug";

persistent actor MockForumGovernance {
  public type NeuronId = { id : Blob };
  public type NeuronPermission = { principal : ?Principal; permission_type : [Int32] };
  public type DissolveState = { #DissolveDelaySeconds : Nat64; #WhenDissolvedTimestampSeconds : Nat64 };
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type DisburseMaturityInProgress = {
    timestamp_of_disbursement_seconds : Nat64; amount_e8s : Nat64; account_to_disburse_to : ?Account; finalize_disbursement_timestamp_seconds : ?Nat64;
  };
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
    followees : [(Nat64, { followees : [NeuronId] })];
    neuron_fees_e8s : Nat64;
  };
  public type NervousSystemParameters = {
    default_followees : ?{ followees : [(Nat64, { followees : [{ id : Blob }] })] };
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
      final_reward_rate_basis_points : ?Nat64; initial_reward_rate_basis_points : ?Nat64;
      reward_rate_transition_duration_seconds : ?Nat64; round_duration_seconds : ?Nat64;
    };
    maturity_modulation_disabled : ?Bool;
    max_number_of_principals_per_neuron : ?Nat64;
  };
  public type GetMetadataResponse = { url : ?Text; logo : ?Text; name : ?Text; description : ?Text };

  stable var neurons : [Neuron] = [];
  stable var name : ?Text = ?"Mock SNS";
  stable var trap : Bool = false;

  // ---- what the forum calls ----
  public query func list_neurons(args : { of_principal : ?Principal; limit : Nat32; start_page_at : ?NeuronId }) : async { neurons : [Neuron] } {
    if (trap) { Debug.trap("governance is down") };
    switch (args.of_principal) {
      case null { { neurons } };
      case (?p) {
        { neurons = Array.filter<Neuron>(neurons, func(n) {
          Array.find<NeuronPermission>(n.permissions, func(perm) { perm.principal == ?p }) != null
        }) };
      };
    };
  };
  public shared func get_nervous_system_parameters() : async NervousSystemParameters {
    if (trap) { Debug.trap("governance is down") };
    {
      default_followees = null; max_dissolve_delay_seconds = ?0; max_dissolve_delay_bonus_percentage = ?0; max_followees_per_function = null;
      automatically_advance_target_version = null; neuron_claimer_permissions = null; neuron_minimum_stake_e8s = null; max_neuron_age_for_age_bonus = ?0;
      initial_voting_period_seconds = null; neuron_minimum_dissolve_delay_to_vote_seconds = ?100; reject_cost_e8s = null;
      max_proposals_to_keep_per_action = null; wait_for_quiet_deadline_increase_seconds = null; max_number_of_neurons = null; transaction_fee_e8s = null;
      max_number_of_proposals_with_ballots = null; max_age_bonus_percentage = ?0; neuron_grantable_permissions = null; voting_rewards_parameters = null;
      maturity_modulation_disabled = null; max_number_of_principals_per_neuron = null;
    };
  };
  public shared func get_metadata(_ : {}) : async GetMetadataResponse {
    if (trap) { Debug.trap("governance is down") };
    { url = null; logo = null; name; description = null };
  };

  // ---- test helpers ----
  /// A neuron owned by `owner` (all permissions) with `hotkeys` (vote/submit only).
  public shared func add_neuron(id : Blob, owner : Principal, hotkeys : [Principal], stake_e8s : Nat64, dissolve_delay_seconds : Nat64) : async () {
    let owner_perm : NeuronPermission = { principal = ?owner; permission_type = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
    let hotkey_perms = Array.map<Principal, NeuronPermission>(hotkeys, func(h) { { principal = ?h; permission_type = [3, 4] } });
    let n : Neuron = {
      id = ?{ id }; staked_maturity_e8s_equivalent = null; permissions = Array.append([owner_perm], hotkey_perms);
      maturity_e8s_equivalent = 0; cached_neuron_stake_e8s = stake_e8s; created_timestamp_seconds = 0; source_nns_neuron_id = null;
      auto_stake_maturity = null; aging_since_timestamp_seconds = 0; dissolve_state = ?#DissolveDelaySeconds(dissolve_delay_seconds);
      voting_power_percentage_multiplier = 100; vesting_period_seconds = null; disburse_maturity_in_progress = []; followees = []; neuron_fees_e8s = 0;
    };
    neurons := Array.append(Array.filter<Neuron>(neurons, func(x) { x.id != ?{ id } }), [n]);
  };
  public shared func set_stake(id : Blob, stake_e8s : Nat64) : async () {
    neurons := Array.map<Neuron, Neuron>(neurons, func(n) { if (n.id == ?{ id }) { { n with cached_neuron_stake_e8s = stake_e8s } } else { n } });
  };
  public shared func set_name(n : ?Text) : async () { name := n };
  public shared func set_trap(t : Bool) : async () { trap := t };
};
