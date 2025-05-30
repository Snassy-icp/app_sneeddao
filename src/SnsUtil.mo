import HashMap "mo:base/HashMap";
import Principal "mo:base/Principal";
import Iter "mo:base/Iter";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Blob "mo:base/Blob";
import Time "mo:base/Time";
import SnsTypes "SnsTypes";

module SnsUtility {

    private func get_sns_governance_canister(sns_governance_canister_id : Principal) : SnsTypes.SnsGovernance {
        actor (Principal.toText(sns_governance_canister_id)) : SnsTypes.SnsGovernance;
    };

    public func get_hotkey_neurons(sns_governance_canister_id : Principal, hotkey : Principal) : async [SnsTypes.Neuron] {

        let sns_gov_canister = get_sns_governance_canister(sns_governance_canister_id);

        // Call list_neurons for caller
        let result = await sns_gov_canister.list_neurons({ 
            of_principal = ?hotkey;
            limit = 100;
            start_page_at = null; 
        });

        result.neurons;
    };    

    public func get_hotkey_owners(sns_governance_canister_id : Principal, hotkey : Principal) : async [Principal] {
        get_owners_for_neurons(await get_hotkey_neurons(sns_governance_canister_id, hotkey));
    };    

    // Reachable neurons are the neurons that are reachable via the hotkey.
    // Take all the neurons returned by list_neurons for the hotkey. These are the neurons the hotkey has direct access to. 
    // Then find the owners for all those neurons and call list_neurons for each owner. Add neurons that have not been seen yet to the result set.
    public func get_reachable_neurons(sns_governance_canister_id : Principal, hotkey : Principal) : async [SnsTypes.Neuron] {

        let hotkey_neurons = await get_hotkey_neurons(sns_governance_canister_id, hotkey);
        let hotkey_neurons_owners = get_owners_for_neurons(hotkey_neurons);

        let reachable_neurons = HashMap.HashMap<Blob, SnsTypes.Neuron>(10, Blob.equal, Blob.hash);

        for (neuron in hotkey_neurons.vals()) {
            switch (neuron.id) {
                case (null) { };
                case (?neuron_id) {
                    reachable_neurons.put(neuron_id.id, neuron);
                };
            };
        };

        for (owner in hotkey_neurons_owners.vals()) {
            let owner_neurons = await get_hotkey_neurons(sns_governance_canister_id, owner);
            for (neuron in owner_neurons.vals()) {
                switch (neuron.id) {
                    case (null) { };
                    case (?neuron_id) {
                        reachable_neurons.put(neuron_id.id, neuron);
                    };
                };
            };
        };

        Iter.toArray(reachable_neurons.vals());
    };

    public func get_owners_for_neurons(neurons : [SnsTypes.Neuron]) : [Principal] {

        let owners = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);

        // Iterate over the batch of neurons returned by the governance canister.
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


    public func get_neuron_owner(neuron : SnsTypes.Neuron) : ?Principal {
        var found : ?Principal = null;
        for (permission in neuron.permissions.vals()) {
            found := permission.principal;
            if (permission.permission_type.size() > 7) {
                return found;
            }
        };   

        found;
    };

    public func get_system_parameters(sns_governance_canister_id : Principal) : async SnsTypes.NervousSystemParameters {
        let sns_gov_canister = get_sns_governance_canister(sns_governance_canister_id);
        await sns_gov_canister.get_nervous_system_parameters();
    };

    public func get_neuron_voting_power(sns_governance_canister_id : Principal, neuron : SnsTypes.Neuron) : async Nat {
        let system_parameters = await get_system_parameters(sns_governance_canister_id);
        calculate_neuron_voting_power(neuron, system_parameters);
    };

    public func calculate_neuron_voting_power(neuron : SnsTypes.Neuron, system_parameters : SnsTypes.NervousSystemParameters) : Nat {
        if (neuron.cached_neuron_stake_e8s == 0) {
            return 0;
        };

        let stake : Nat = Nat64.toNat(neuron.cached_neuron_stake_e8s) + (
            switch (neuron.staked_maturity_e8s_equivalent) {
            case (null) { 0 };
            case (?v) { Nat64.toNat(v) };
            }
        );

        let dissolveDelay : Nat = switch (neuron.dissolve_state) {
            case (null) { 0 };
            case (? #DissolveDelaySeconds(s)) { Nat64.toNat(s) };
            case (? #WhenDissolvedTimestampSeconds(ts)) {
            let now = Int.abs(Time.now()) / 1_000_000_000;
            if (ts > Nat64.fromNat(now)) {
                Nat64.toNat(ts) - now;
            } else { 0 };
            };
        };

        let maxDissolveBonus = switch (system_parameters.max_dissolve_delay_bonus_percentage) {
            case (null) { 0 };
            case (?v) { Nat64.toNat(v) };
        };
        let minDissolveDelay = switch (system_parameters.neuron_minimum_dissolve_delay_to_vote_seconds) {
            case (null) { 0 };
            case (?min) { Nat64.toNat(min) };
        };
        let maxDissolveDelay = switch (system_parameters.max_dissolve_delay_seconds) {
            case (null) { 0 };
            case (?v) { Nat64.toNat(v) };
        };
        let maxAgeBonus = switch (system_parameters.max_age_bonus_percentage) {
            case (null) { 0 };
            case (?v) { Nat64.toNat(v) };
        };
        let maxAge = switch (system_parameters.max_neuron_age_for_age_bonus) {
            case (null) { 0 };
            case (?v) { Nat64.toNat(v) };
        };

        if (dissolveDelay < minDissolveDelay) {
            return 0;
        };

        let now = Int.abs(Time.now()) / 1_000_000_000;
        let agingSeconds = Nat64.toNat(neuron.aging_since_timestamp_seconds);
        // Add safety check to prevent underflow
        let age = if (agingSeconds > now) {
            0  // If aging timestamp is in the future, age is 0
        } else {
            now - agingSeconds
        };

        let cappedDissolveDelay = Nat.min(dissolveDelay, maxDissolveDelay);
        let cappedAge = Nat.min(age, maxAge);

        let dissolveBonus = if (maxDissolveDelay > 0 and cappedDissolveDelay > 0) {
            (stake * cappedDissolveDelay * maxDissolveBonus) / (100 * maxDissolveDelay);
        } else {
            0;
        };
        let stakeWithDissolveBonus = stake + dissolveBonus;

        let ageBonus = if (maxAge > 0 and cappedAge > 0) {
            (stakeWithDissolveBonus * cappedAge * maxAgeBonus) / (100 * maxAge);
        } else {
            0;
        };
        let stakeWithAllBonuses = stakeWithDissolveBonus + ageBonus;

        let multiplier = Nat64.toNat(neuron.voting_power_percentage_multiplier);
        if (multiplier > 0) {
            (stakeWithAllBonuses * multiplier) / 100;
        } else {
            0;
        };
    };

    public func get_sns_name(sns_governance_canister_id : Principal) : async ?Text {
        let sns_gov_canister = get_sns_governance_canister(sns_governance_canister_id);
        let metadata = await sns_gov_canister.get_metadata({});
        metadata.name;
    };

}