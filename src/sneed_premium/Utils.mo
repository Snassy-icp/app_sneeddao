import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Array "mo:base/Array";
import Time "mo:base/Time";

import T "Types";

module {
    // ============================================
    // SUBACCOUNT GENERATION
    // ============================================
    
    /// Generate a subaccount for a user to deposit ICP for premium membership.
    /// Uses the standard ICRC-1 principal-to-subaccount encoding:
    /// - Byte 0: length of principal bytes
    /// - Bytes 1-N: principal bytes
    /// - Remaining bytes: zero-padded to 32 bytes
    public func principalToSubaccount(p : Principal) : Blob {
        let pa = Principal.toBlob(p);
        let size = pa.size();
        let a = Array.init<Nat8>(32, 0);
        
        // Byte 0: principal length
        a[0] := Nat8.fromNat(size);
        
        // Bytes 1-N: principal bytes
        var pos = 1;
        for (x in pa.vals()) {
            a[pos] := x;
            pos += 1;
        };
        
        Blob.fromArray(Array.freeze(a));
    };
    
    // ============================================
    // PRINCIPAL LIST UTILITIES
    // ============================================
    
    /// Check if a principal is in a list
    public func principalInList(p : Principal, list : [Principal]) : Bool {
        for (item in list.vals()) {
            if (Principal.equal(p, item)) return true;
        };
        false;
    };
    
    /// Remove a principal from a list
    public func removePrincipal(p : Principal, list : [Principal]) : [Principal] {
        Array.filter<Principal>(list, func(item : Principal) : Bool {
            not Principal.equal(p, item);
        });
    };
    
    /// Add a principal to a list if not already present
    public func addPrincipal(p : Principal, list : [Principal]) : [Principal] {
        if (principalInList(p, list)) {
            list;
        } else {
            Array.append(list, [p]);
        };
    };
    
    // ============================================
    // VOTING POWER CALCULATION
    // ============================================
    
    /// Calculate the voting power of a single neuron
    /// Based on stake, dissolve delay bonus, and age bonus
    public func calculateNeuronVotingPower(
        neuron : T.Neuron, 
        systemParams : T.NervousSystemParameters
    ) : Nat {
        if (neuron.cached_neuron_stake_e8s == 0) {
            return 0;
        };

        // Stake includes staked maturity
        let stake : Nat = Nat64.toNat(neuron.cached_neuron_stake_e8s) + (
            switch (neuron.staked_maturity_e8s_equivalent) {
                case (null) { 0 };
                case (?v) { Nat64.toNat(v) };
            }
        );

        // Get dissolve delay
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

        // Get system parameters
        let maxDissolveBonus = switch (systemParams.max_dissolve_delay_bonus_percentage) {
            case (null) { 0 };
            case (?v) { Nat64.toNat(v) };
        };
        let minDissolveDelay = switch (systemParams.neuron_minimum_dissolve_delay_to_vote_seconds) {
            case (null) { 0 };
            case (?min) { Nat64.toNat(min) };
        };
        let maxDissolveDelay = switch (systemParams.max_dissolve_delay_seconds) {
            case (null) { 0 };
            case (?v) { Nat64.toNat(v) };
        };
        let maxAgeBonus = switch (systemParams.max_age_bonus_percentage) {
            case (null) { 0 };
            case (?v) { Nat64.toNat(v) };
        };
        let maxAge = switch (systemParams.max_neuron_age_for_age_bonus) {
            case (null) { 0 };
            case (?v) { Nat64.toNat(v) };
        };

        // Neurons with dissolve delay below minimum have no voting power
        if (dissolveDelay < minDissolveDelay) {
            return 0;
        };

        // Calculate age
        let now = Int.abs(Time.now()) / 1_000_000_000;
        let agingSeconds = Nat64.toNat(neuron.aging_since_timestamp_seconds);
        let age = if (agingSeconds > now) {
            0;  // If aging timestamp is in the future, age is 0
        } else {
            now - agingSeconds;
        };

        // Cap values
        let cappedDissolveDelay = Nat.min(dissolveDelay, maxDissolveDelay);
        let cappedAge = Nat.min(age, maxAge);

        // Calculate dissolve delay bonus
        let dissolveBonus = if (maxDissolveDelay > 0 and cappedDissolveDelay > 0) {
            (stake * cappedDissolveDelay * maxDissolveBonus) / (100 * maxDissolveDelay);
        } else {
            0;
        };
        let stakeWithDissolveBonus = stake + dissolveBonus;

        // Calculate age bonus
        let ageBonus = if (maxAge > 0 and cappedAge > 0) {
            (stakeWithDissolveBonus * cappedAge * maxAgeBonus) / (100 * maxAge);
        } else {
            0;
        };
        let stakeWithAllBonuses = stakeWithDissolveBonus + ageBonus;

        // Apply voting power percentage multiplier
        let multiplier = Nat64.toNat(neuron.voting_power_percentage_multiplier);
        if (multiplier > 0) {
            (stakeWithAllBonuses * multiplier) / 100;
        } else {
            0;
        };
    };
    
    /// Calculate total voting power across all neurons for a principal
    public func calculateTotalVotingPower(
        neurons : [T.Neuron],
        principal : Principal,
        systemParams : T.NervousSystemParameters
    ) : Nat {
        var total : Nat = 0;
        
        for (neuron in neurons.vals()) {
            // Only count neurons where the principal has permissions
            let hasPermission = Array.find<T.NeuronPermission>(
                neuron.permissions,
                func(perm : T.NeuronPermission) : Bool {
                    switch (perm.principal) {
                        case (?p) { Principal.equal(p, principal) };
                        case null { false };
                    };
                }
            );
            
            switch (hasPermission) {
                case (?_) {
                    total += calculateNeuronVotingPower(neuron, systemParams);
                };
                case null {};
            };
        };
        
        total;
    };
    
    // ============================================
    // TIER UTILITIES
    // ============================================
    
    /// Find the best matching ICP tier for a given amount
    /// Returns the tier that provides the longest duration for the exact amount
    public func findIcpTier(tiers : [T.IcpTier], amountE8s : Nat) : ?T.IcpTier {
        var bestTier : ?T.IcpTier = null;
        
        for (tier in tiers.vals()) {
            if (tier.active and tier.amountE8s == amountE8s) {
                switch (bestTier) {
                    case (null) { bestTier := ?tier };
                    case (?current) {
                        if (tier.durationNs > current.durationNs) {
                            bestTier := ?tier;
                        };
                    };
                };
            };
        };
        
        bestTier;
    };
    
    /// Find the best matching voting power tier for a given VP amount
    /// Returns the tier with the highest minimum VP that the user qualifies for
    public func findVotingPowerTier(tiers : [T.VotingPowerTier], votingPower : Nat) : ?T.VotingPowerTier {
        var bestTier : ?T.VotingPowerTier = null;
        
        for (tier in tiers.vals()) {
            if (tier.active and votingPower >= tier.minVotingPowerE8s) {
                switch (bestTier) {
                    case (null) { bestTier := ?tier };
                    case (?current) {
                        // Prefer tiers with higher minimum VP (more exclusive = better reward)
                        if (tier.minVotingPowerE8s > current.minVotingPowerE8s) {
                            bestTier := ?tier;
                        };
                    };
                };
            };
        };
        
        bestTier;
    };
    
    // ============================================
    // TIME UTILITIES
    // ============================================
    
    /// Extend an expiration timestamp by a duration.
    /// If the current expiration is in the past, starts from now.
    public func extendExpiration(currentExpiration : Time.Time, durationNs : Nat, now : Time.Time) : Time.Time {
        let base = if (currentExpiration > now) { currentExpiration } else { now };
        base + durationNs;
    };
};

