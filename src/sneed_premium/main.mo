import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Array "mo:base/Array";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";

import T "Types";
import Utils "Utils";

shared (deployer) persistent actor class SneedPremium(initConfig : ?T.Config) = this {
    // ============================================
    // STATE
    // ============================================
    
    // Default configuration (created here because Principal.fromText requires actor context)
    let defaultConfig : T.Config = {
        admins = [];
        icpLedgerId = Principal.fromText(T.ICP_LEDGER_ID_TEXT);
        sneedGovernanceId = Principal.fromText(T.SNEED_GOVERNANCE_ID_TEXT);
        paymentRecipient = {
            owner = Principal.fromText("aaaaa-aa");  // Placeholder - must be set by admin
            subaccount = null;
        };
        minClaimIntervalNs = T.DEFAULT_MIN_CLAIM_INTERVAL_NS;
    };
    
    // Configuration
    var config : T.Config = switch (initConfig) {
        case (?c) { c };
        case null { defaultConfig };
    };
    
    // Membership registry: principal -> membership info
    var memberships : [(Principal, T.Membership)] = [];
    
    // Last VP claim time per principal (to prevent spam)
    var lastVpClaimTime : [(Principal, Time.Time)] = [];
    
    // ICP payment tiers
    var icpTiers : [T.IcpTier] = [];
    
    // Voting power tiers
    var vpTiers : [T.VotingPowerTier] = [];
    
    // Promo codes
    var promoCodes : [T.PromoCode] = [];
    var promoCodeClaims : [T.PromoCodeClaim] = [];
    
    // ============================================
    // PRIVATE HELPERS
    // ============================================
    
    func isAdmin(caller : Principal) : Bool {
        Principal.isController(caller) or Utils.principalInList(caller, config.admins);
    };
    
    func getMembership(principal : Principal) : ?T.Membership {
        for ((p, m) in memberships.vals()) {
            if (Principal.equal(p, principal)) return ?m;
        };
        null;
    };
    
    func setMembership(membership : T.Membership) : () {
        let newMemberships = Array.filter<(Principal, T.Membership)>(
            memberships,
            func((p, _) : (Principal, T.Membership)) : Bool {
                not Principal.equal(p, membership.principal);
            }
        );
        memberships := Array.append(newMemberships, [(membership.principal, membership)]);
    };
    
    func getLastVpClaimTime(principal : Principal) : ?Time.Time {
        for ((p, t) in lastVpClaimTime.vals()) {
            if (Principal.equal(p, principal)) return ?t;
        };
        null;
    };
    
    func setLastVpClaimTime(principal : Principal, time : Time.Time) : () {
        let filtered = Array.filter<(Principal, Time.Time)>(
            lastVpClaimTime,
            func((p, _) : (Principal, Time.Time)) : Bool {
                not Principal.equal(p, principal);
            }
        );
        lastVpClaimTime := Array.append(filtered, [(principal, time)]);
    };
    
    func getIcpLedger() : T.ICRC1Actor {
        actor(Principal.toText(config.icpLedgerId)) : T.ICRC1Actor;
    };
    
    func getSneedGovernance() : T.SnsGovernance {
        actor(Principal.toText(config.sneedGovernanceId)) : T.SnsGovernance;
    };
    
    // Generate a random promo code (uppercase letters only, 8 chars)
    func generatePromoCode() : Text {
        // Use time-based pseudo-random generation
        let now = Int.abs(Time.now());
        let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let charsLen = 26;
        var code = "";
        var seed = now;
        for (_ in [0, 1, 2, 3, 4, 5, 6, 7].vals()) {
            let idx = seed % charsLen;
            let char = switch (idx) {
                case 0 { "A" }; case 1 { "B" }; case 2 { "C" }; case 3 { "D" };
                case 4 { "E" }; case 5 { "F" }; case 6 { "G" }; case 7 { "H" };
                case 8 { "I" }; case 9 { "J" }; case 10 { "K" }; case 11 { "L" };
                case 12 { "M" }; case 13 { "N" }; case 14 { "O" }; case 15 { "P" };
                case 16 { "Q" }; case 17 { "R" }; case 18 { "S" }; case 19 { "T" };
                case 20 { "U" }; case 21 { "V" }; case 22 { "W" }; case 23 { "X" };
                case 24 { "Y" }; case _ { "Z" };
            };
            code := code # char;
            seed := (seed * 1103515245 + 12345) / 65536;  // Simple LCG
        };
        code;
    };
    
    func getPromoCode(code : Text) : ?T.PromoCode {
        for (pc in promoCodes.vals()) {
            if (pc.code == code) return ?pc;
        };
        null;
    };
    
    func updatePromoCode(updatedCode : T.PromoCode) : () {
        promoCodes := Array.map<T.PromoCode, T.PromoCode>(
            promoCodes,
            func(pc : T.PromoCode) : T.PromoCode {
                if (pc.code == updatedCode.code) { updatedCode } else { pc }
            }
        );
    };
    
    func hasUserClaimedPromoCode(user : Principal, code : Text) : Bool {
        for (claim in promoCodeClaims.vals()) {
            if (Principal.equal(claim.claimedBy, user) and claim.code == code) {
                return true;
            };
        };
        false;
    };
    
    // ============================================
    // PUBLIC QUERY METHODS
    // ============================================
    
    /// Check membership status for a principal
    /// This is the primary method for other canisters to check premium membership
    public query func checkMembership(principal : Principal) : async T.MembershipStatus {
        let now = Time.now();
        switch (getMembership(principal)) {
            case (?m) {
                if (m.expiration > now) {
                    #Active({ expiration = m.expiration });
                } else {
                    #Expired({ expiredAt = m.expiration });
                };
            };
            case null { #NotFound };
        };
    };
    
    /// Get full membership details (for the user themselves or admin)
    public query ({ caller }) func getMembershipDetails(principal : Principal) : async ?T.Membership {
        if (Principal.equal(caller, principal) or isAdmin(caller)) {
            getMembership(principal);
        } else {
            null;
        };
    };
    
    /// Get the deposit account for a user to pay for premium
    public query func getDepositAccount(user : Principal) : async T.Account {
        {
            owner = Principal.fromActor(this);
            subaccount = ?Utils.principalToSubaccount(user);
        };
    };
    
    /// Get available ICP payment tiers
    public query func getIcpTiers() : async [T.IcpTier] {
        Array.filter<T.IcpTier>(icpTiers, func(t : T.IcpTier) : Bool { t.active });
    };
    
    /// Get all ICP tiers (admin view)
    public query func getAllIcpTiers() : async [T.IcpTier] {
        icpTiers;
    };
    
    /// Get available voting power tiers
    public query func getVotingPowerTiers() : async [T.VotingPowerTier] {
        Array.filter<T.VotingPowerTier>(vpTiers, func(t : T.VotingPowerTier) : Bool { t.active });
    };
    
    /// Get all voting power tiers (admin view)
    public query func getAllVotingPowerTiers() : async [T.VotingPowerTier] {
        vpTiers;
    };
    
    /// Get current configuration
    public query func getConfig() : async T.Config {
        config;
    };
    
    /// Get all memberships (admin only)
    public query ({ caller }) func getAllMemberships() : async [(Principal, T.Membership)] {
        if (isAdmin(caller)) {
            memberships;
        } else {
            [];
        };
    };
    
    /// Get canister's own principal
    public query func getCanisterId() : async Principal {
        Principal.fromActor(this);
    };
    
    // ============================================
    // PUBLIC UPDATE METHODS - PURCHASE
    // ============================================
    
    /// Purchase premium membership with ICP
    /// User must first send ICP to their deposit account (getDepositAccount)
    /// Amount must exactly match one of the active ICP tiers
    public shared ({ caller }) func purchaseWithIcp() : async T.PurchaseResult {
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };
        
        let now = Time.now();
        let icpLedger = getIcpLedger();
        let userSubaccount = Utils.principalToSubaccount(caller);
        
        // Check balance in user's subaccount
        let balance = await icpLedger.icrc1_balance_of({
            owner = Principal.fromActor(this);
            subaccount = ?userSubaccount;
        });
        
        // Find matching tier
        let tier = switch (Utils.findIcpTier(icpTiers, balance)) {
            case (?t) { t };
            case null {
                return #err(#InvalidTier);
            };
        };
        
        // Get ledger fee
        let fee = await icpLedger.icrc1_fee();
        
        // Ensure we have enough to pay the fee
        if (balance <= fee) {
            return #err(#InsufficientPayment({ required = tier.amountE8s; received = balance }));
        };
        
        // Transfer ICP to payment recipient
        let transferResult = await icpLedger.icrc1_transfer({
            to = config.paymentRecipient;
            fee = ?fee;
            memo = null;
            from_subaccount = ?userSubaccount;
            created_at_time = ?Nat64.fromNat(Int.abs(now));
            amount = balance - fee;
        });
        
        switch (transferResult) {
            case (#Err(e)) {
                let errMsg = switch (e) {
                    case (#GenericError({ message; error_code = _ })) { message };
                    case (#TemporarilyUnavailable) { "Temporarily unavailable" };
                    case (#BadBurn(_)) { "Bad burn" };
                    case (#Duplicate(_)) { "Duplicate" };
                    case (#BadFee(_)) { "Bad fee" };
                    case (#CreatedInFuture(_)) { "Created in future" };
                    case (#TooOld) { "Too old" };
                    case (#InsufficientFunds(_)) { "Insufficient funds" };
                };
                return #err(#TransferFailed(errMsg));
            };
            case (#Ok(_)) {};
        };
        
        // Update membership
        let currentExpiration = switch (getMembership(caller)) {
            case (?m) { m.expiration };
            case null { 0 };
        };
        
        let newExpiration = Utils.extendExpiration(currentExpiration, tier.durationNs, now);
        let newMembership : T.Membership = {
            principal = caller;
            expiration = newExpiration;
            lastUpdated = now;
        };
        
        setMembership(newMembership);
        #ok(newMembership);
    };
    
    /// Claim premium membership based on Sneed staking (voting power)
    public shared ({ caller }) func claimWithVotingPower() : async T.ClaimResult {
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };
        
        let now = Time.now();
        
        // Check spam prevention
        switch (getLastVpClaimTime(caller)) {
            case (?lastClaim) {
                if (now - lastClaim < config.minClaimIntervalNs) {
                    let nextClaimTime = lastClaim + config.minClaimIntervalNs;
                    return #err(#AlreadyClaimedRecently({
                        lastClaimTime = lastClaim;
                        intervalNs = config.minClaimIntervalNs;
                        nextClaimTime = nextClaimTime;
                    }));
                };
            };
            case null {};
        };
        
        // Get active VP tiers
        let activeTiers = Array.filter<T.VotingPowerTier>(
            vpTiers, 
            func(t : T.VotingPowerTier) : Bool { t.active }
        );
        
        if (activeTiers.size() == 0) {
            return #err(#NoActiveTiers);
        };
        
        // Get user's neurons from Sneed governance
        let governance = getSneedGovernance();
        
        let neuronsResponse = await governance.list_neurons({
            of_principal = ?caller;
            limit = 100;
            start_page_at = null;
        });
        
        if (neuronsResponse.neurons.size() == 0) {
            return #err(#NoEligibleNeurons);
        };
        
        // Get system parameters for VP calculation
        let systemParams = await governance.get_nervous_system_parameters();
        
        // Calculate total voting power
        let totalVp = Utils.calculateTotalVotingPower(
            neuronsResponse.neurons,
            caller,
            systemParams
        );
        
        // Find best matching tier
        let tier = switch (Utils.findVotingPowerTier(activeTiers, totalVp)) {
            case (?t) { t };
            case null {
                // Find minimum required VP
                var minRequired : Nat = 0;
                for (t in activeTiers.vals()) {
                    if (minRequired == 0 or t.minVotingPowerE8s < minRequired) {
                        minRequired := t.minVotingPowerE8s;
                    };
                };
                return #err(#InsufficientVotingPower({ required = minRequired; found = totalVp }));
            };
        };
        
        // Update last claim time
        setLastVpClaimTime(caller, now);
        
        // For VP claims: set to now + duration, but only if it extends past current expiration
        // This is different from ICP purchases which are additive
        let currentExpiration = switch (getMembership(caller)) {
            case (?m) { m.expiration };
            case null { 0 };
        };
        
        // VP claim sets expiration to now + tier duration (not additive)
        let vpExpiration = now + tier.durationNs;
        
        // Only update if VP-based expiration is later than current
        let newExpiration = if (vpExpiration > currentExpiration) { vpExpiration } else { currentExpiration };
        
        let newMembership : T.Membership = {
            principal = caller;
            expiration = newExpiration;
            lastUpdated = now;
        };
        
        setMembership(newMembership);
        #ok(newMembership);
    };
    
    // ============================================
    // PROMO CODE METHODS
    // ============================================
    
    /// Claim a promo code to get free premium membership
    public shared ({ caller }) func claimPromoCode(code : Text) : async T.PromoCodeResult {
        let now = Time.now();
        
        // Find the promo code
        let promoCodeOpt = getPromoCode(code);
        switch (promoCodeOpt) {
            case null {
                return #err(#InvalidCode);
            };
            case (?promoCode) {
                // Check if code is active
                if (not promoCode.active) {
                    return #err(#CodeInactive);
                };
                
                // Check if code is expired
                switch (promoCode.expiration) {
                    case (?exp) {
                        if (now > exp) {
                            return #err(#CodeExpired);
                        };
                    };
                    case null {};
                };
                
                // Check if max claims reached
                if (promoCode.claimCount >= promoCode.maxClaims) {
                    return #err(#CodeFullyClaimed);
                };
                
                // Check if user already claimed this code
                if (hasUserClaimedPromoCode(caller, code)) {
                    return #err(#AlreadyClaimed);
                };
                
                // All checks passed - grant membership
                let currentExpiration = switch (getMembership(caller)) {
                    case (?m) { if (m.expiration > now) { m.expiration } else { now } };
                    case null { now };
                };
                
                let newExpiration = Utils.extendExpiration(currentExpiration, promoCode.durationNs, now);
                let newMembership : T.Membership = {
                    principal = caller;
                    expiration = newExpiration;
                    lastUpdated = now;
                };
                
                setMembership(newMembership);
                
                // Record the claim
                let claim : T.PromoCodeClaim = {
                    code = code;
                    claimedBy = caller;
                    claimedAt = now;
                    durationGrantedNs = promoCode.durationNs;
                };
                promoCodeClaims := Array.append(promoCodeClaims, [claim]);
                
                // Increment claim count
                let updatedPromoCode : T.PromoCode = {
                    code = promoCode.code;
                    durationNs = promoCode.durationNs;
                    maxClaims = promoCode.maxClaims;
                    claimCount = promoCode.claimCount + 1;
                    expiration = promoCode.expiration;
                    notes = promoCode.notes;
                    createdBy = promoCode.createdBy;
                    createdAt = promoCode.createdAt;
                    active = promoCode.active;
                };
                updatePromoCode(updatedPromoCode);
                
                #ok(newMembership);
            };
        };
    };
    
    // ============================================
    // ADMIN METHODS
    // ============================================
    
    /// Update configuration (admin only)
    public shared ({ caller }) func updateConfig(newConfig : T.Config) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        config := newConfig;
        #ok(());
    };
    
    /// Add admin (admin only)
    public shared ({ caller }) func addAdmin(newAdmin : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        config := {
            admins = Utils.addPrincipal(newAdmin, config.admins);
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        #ok(());
    };
    
    /// Remove admin (admin only)
    public shared ({ caller }) func removeAdmin(admin : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        config := {
            admins = Utils.removePrincipal(admin, config.admins);
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        #ok(());
    };
    
    /// Check if caller is admin
    public query ({ caller }) func isCallerAdmin() : async Bool {
        isAdmin(caller);
    };
    
    // --- ICP Tier Management ---
    
    /// Add a new ICP tier (admin only)
    public shared ({ caller }) func addIcpTier(tier : T.IcpTier) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        if (tier.amountE8s == 0 or tier.durationNs == 0) {
            return #err(#InvalidInput("Amount and duration must be positive"));
        };
        icpTiers := Array.append(icpTiers, [tier]);
        #ok(());
    };
    
    /// Update an ICP tier by index (admin only)
    public shared ({ caller }) func updateIcpTier(index : Nat, tier : T.IcpTier) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        if (index >= icpTiers.size()) {
            return #err(#NotFound);
        };
        icpTiers := Array.tabulate<T.IcpTier>(icpTiers.size(), func(i : Nat) : T.IcpTier {
            if (i == index) { tier } else { icpTiers[i] };
        });
        #ok(());
    };
    
    /// Remove an ICP tier by index (admin only)
    public shared ({ caller }) func removeIcpTier(index : Nat) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        if (index >= icpTiers.size()) {
            return #err(#NotFound);
        };
        icpTiers := Array.tabulate<T.IcpTier>(icpTiers.size() - 1, func(i : Nat) : T.IcpTier {
            if (i < index) { icpTiers[i] } else { icpTiers[i + 1] };
        });
        #ok(());
    };
    
    // --- Voting Power Tier Management ---
    
    /// Add a new voting power tier (admin only)
    public shared ({ caller }) func addVpTier(tier : T.VotingPowerTier) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        if (tier.durationNs == 0) {
            return #err(#InvalidInput("Duration must be positive"));
        };
        vpTiers := Array.append(vpTiers, [tier]);
        #ok(());
    };
    
    /// Update a voting power tier by index (admin only)
    public shared ({ caller }) func updateVpTier(index : Nat, tier : T.VotingPowerTier) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        if (index >= vpTiers.size()) {
            return #err(#NotFound);
        };
        vpTiers := Array.tabulate<T.VotingPowerTier>(vpTiers.size(), func(i : Nat) : T.VotingPowerTier {
            if (i == index) { tier } else { vpTiers[i] };
        });
        #ok(());
    };
    
    /// Remove a voting power tier by index (admin only)
    public shared ({ caller }) func removeVpTier(index : Nat) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        if (index >= vpTiers.size()) {
            return #err(#NotFound);
        };
        vpTiers := Array.tabulate<T.VotingPowerTier>(vpTiers.size() - 1, func(i : Nat) : T.VotingPowerTier {
            if (i < index) { vpTiers[i] } else { vpTiers[i + 1] };
        });
        #ok(());
    };
    
    // --- Membership Management ---
    
    /// Manually set membership for a principal (admin only)
    /// Useful for granting complimentary memberships
    public shared ({ caller }) func setMembershipAdmin(
        principal : Principal, 
        expirationNs : Time.Time
    ) : async T.AdminResult<T.Membership> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let now = Time.now();
        let membership : T.Membership = {
            principal = principal;
            expiration = expirationNs;
            lastUpdated = now;
        };
        setMembership(membership);
        #ok(membership);
    };
    
    /// Extend membership for a principal by a duration (admin only)
    public shared ({ caller }) func extendMembershipAdmin(
        principal : Principal,
        durationNs : Nat
    ) : async T.AdminResult<T.Membership> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let now = Time.now();
        let currentExpiration = switch (getMembership(principal)) {
            case (?m) { m.expiration };
            case null { 0 };
        };
        let newExpiration = Utils.extendExpiration(currentExpiration, durationNs, now);
        let membership : T.Membership = {
            principal = principal;
            expiration = newExpiration;
            lastUpdated = now;
        };
        setMembership(membership);
        #ok(membership);
    };
    
    /// Revoke membership for a principal (admin only)
    public shared ({ caller }) func revokeMembership(principal : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        memberships := Array.filter<(Principal, T.Membership)>(
            memberships,
            func((p, _) : (Principal, T.Membership)) : Bool {
                not Principal.equal(p, principal);
            }
        );
        #ok(());
    };
    
    /// Set the ICP ledger canister ID (admin only)
    public shared ({ caller }) func setIcpLedgerId(ledgerId : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        config := {
            admins = config.admins;
            icpLedgerId = ledgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        #ok(());
    };
    
    /// Set the Sneed SNS governance canister ID (admin only)
    public shared ({ caller }) func setSneedGovernanceId(governanceId : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        config := {
            admins = config.admins;
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = governanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        #ok(());
    };
    
    /// Set the payment recipient account (admin only)
    public shared ({ caller }) func setPaymentRecipient(recipient : T.Account) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        config := {
            admins = config.admins;
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = recipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        #ok(());
    };
    
    /// Set minimum claim interval (admin only)
    public shared ({ caller }) func setMinClaimInterval(intervalNs : Nat) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        config := {
            admins = config.admins;
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = intervalNs;
        };
        #ok(());
    };
    
    // --- Promo Code Management (Admin) ---
    
    /// Create a new promo code (admin only)
    public shared ({ caller }) func createPromoCode(request : T.CreatePromoCodeRequest) : async T.AdminResult<T.PromoCode> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        
        if (request.durationNs == 0) {
            return #err(#InvalidInput("Duration must be positive"));
        };
        if (request.maxClaims == 0) {
            return #err(#InvalidInput("Max claims must be positive"));
        };
        
        // Generate a unique code
        var code = generatePromoCode();
        var attempts = 0;
        while (getPromoCode(code) != null and attempts < 100) {
            code := generatePromoCode();
            attempts += 1;
        };
        
        if (attempts >= 100) {
            return #err(#InvalidInput("Failed to generate unique code"));
        };
        
        let now = Time.now();
        let promoCode : T.PromoCode = {
            code = code;
            durationNs = request.durationNs;
            maxClaims = request.maxClaims;
            claimCount = 0;
            expiration = request.expiration;
            notes = request.notes;
            createdBy = caller;
            createdAt = now;
            active = true;
        };
        
        promoCodes := Array.append(promoCodes, [promoCode]);
        #ok(promoCode);
    };
    
    /// Get all promo codes (admin only)
    public query ({ caller }) func getPromoCodes() : async T.AdminResult<[T.PromoCode]> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        #ok(promoCodes);
    };
    
    /// Get promo code claims for a specific code (admin only)
    public query ({ caller }) func getPromoCodeClaims(code : Text) : async T.AdminResult<[T.PromoCodeClaim]> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let claims = Array.filter<T.PromoCodeClaim>(
            promoCodeClaims,
            func(c : T.PromoCodeClaim) : Bool { c.code == code }
        );
        #ok(claims);
    };
    
    /// Deactivate a promo code (admin only)
    public shared ({ caller }) func deactivatePromoCode(code : Text) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        switch (getPromoCode(code)) {
            case null { return #err(#NotFound); };
            case (?pc) {
                let updated : T.PromoCode = {
                    code = pc.code;
                    durationNs = pc.durationNs;
                    maxClaims = pc.maxClaims;
                    claimCount = pc.claimCount;
                    expiration = pc.expiration;
                    notes = pc.notes;
                    createdBy = pc.createdBy;
                    createdAt = pc.createdAt;
                    active = false;
                };
                updatePromoCode(updated);
                #ok(());
            };
        };
    };
    
    /// Reactivate a promo code (admin only)
    public shared ({ caller }) func reactivatePromoCode(code : Text) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        switch (getPromoCode(code)) {
            case null { return #err(#NotFound); };
            case (?pc) {
                let updated : T.PromoCode = {
                    code = pc.code;
                    durationNs = pc.durationNs;
                    maxClaims = pc.maxClaims;
                    claimCount = pc.claimCount;
                    expiration = pc.expiration;
                    notes = pc.notes;
                    createdBy = pc.createdBy;
                    createdAt = pc.createdAt;
                    active = true;
                };
                updatePromoCode(updated);
                #ok(());
            };
        };
    };
    
    /// Delete a promo code entirely (admin only)
    public shared ({ caller }) func deletePromoCode(code : Text) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let initialLen = promoCodes.size();
        promoCodes := Array.filter<T.PromoCode>(
            promoCodes,
            func(pc : T.PromoCode) : Bool { pc.code != code }
        );
        if (promoCodes.size() == initialLen) {
            return #err(#NotFound);
        };
        #ok(());
    };
};

