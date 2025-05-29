module SnsTypes {
    
    public type Subaccount = Blob;
    public type NeuronId = { id : Blob };

    public type Account = {
        owner : Principal;
        subaccount : ?Subaccount;
    };

    public type ListNeurons = {
        of_principal : ?Principal;
        limit : Nat32;
        start_page_at : ?NeuronId;
    };

    public type ListNeuronsResponse = { neurons : [Neuron] };    

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

    public type NeuronPermission = {
        principal : ?Principal;
        permission_type : [Int32];
    };    

    public type DissolveState = {
        #DissolveDelaySeconds : Nat64;
        #WhenDissolvedTimestampSeconds : Nat64;
    };

    public type DisburseMaturityInProgress = {
        timestamp_of_disbursement_seconds : Nat64;
        amount_e8s : Nat64;
        account_to_disburse_to : ?Account;
        finalize_disbursement_timestamp_seconds : ?Nat64;
    };

    public type Followees = { followees : [NeuronId] };

    public type NervousSystemParameters = {
        default_followees : ?{
        followees : [(Nat64, { followees : [{ id : Blob }] })];
        };
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

    public type SnsGovernance = actor {
        list_neurons : shared query ListNeurons -> async ListNeuronsResponse;
        get_nervous_system_parameters : shared () -> async NervousSystemParameters;        
    };    
}