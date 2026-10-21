import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Array "mo:base/Array";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Nat8 "mo:base/Nat8";
import Error "mo:base/Error";
import Random "mo:base/Random";
import Debug "mo:base/Debug";
import Nat "mo:base/Nat";

import Icrc3Log "../icrc3/Log";
import Icrc3Sns "../icrc3/SnsRegister";
import T3 "../icrc3/Types";

import T "Types";
import Utils "Utils";
import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";

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
    
    // Payment and claim logs
    var claimLog : [T.ClaimLogEntry] = [];
    var nextClaimLogId : Nat = 0;
    var icpPaymentLog : [T.IcpPaymentLogEntry] = [];
    var nextIcpPaymentLogId : Nat = 0;
    
    // Statistics
    var totalIcpCollectedE8s : Nat = 0;
    var totalIcpPayments : Nat = 0;
    var totalVpClaims : Nat = 0;
    var totalPromoClaims : Nat = 0;

    // ICRC-3 activity log: a hash-chained, certified block per membership, payment, promo code,
    // tier and config change, with archive canisters for old blocks. Library src/icrc3; design
    // and block catalogue: spec/sneed_premium_icrc3.md. New stable fields (additive); the
    // runtimes are transient.
    var icrc3 : Icrc3Log.State = Icrc3Log.init();
    transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
    // SNS registration of archives (skipped until a hotkeyed neuron is configured)
    var icrc3_sns : Icrc3Sns.State = Icrc3Sns.init();
    transient let icrc3_sns_rt : Icrc3Sns.Runtime = Icrc3Sns.runtime();
    transient let SNEED_SNS_ROOT : Principal = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");
    transient var icrc3_next_cid : Nat = 0; // groups the canister-log lines of one spill run

    // Promo codes are logged by id, never by their text (a logged code could be claimed by
    // anyone reading the log): code -> id, ids sequential and never reused. Codes that exist
    // when this is first installed get ids in list order (see the end of the actor body).
    var promoCodeIds : [(Text, Nat)] = [];
    var nextPromoCodeId : Nat = 0;
    
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
    
    transient let PROMO_CODE_LENGTH : Nat = 8;
    transient let PROMO_CODE_LETTERS : [Text] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];

    // A promo code (8 uppercase letters) from the IC's randomness (raw_rand): unguessable, unlike
    // the time-seeded generator used before 2026-10-20. Bytes of 234 and up are skipped so every
    // letter is equally likely; null if the entropy runs out first (the caller asks again).
    func promoCodeFrom(entropy : Blob) : ?Text {
        var code = "";
        var n = 0;
        for (byte in entropy.vals()) {
            if (n < PROMO_CODE_LENGTH and Nat8.toNat(byte) < 234) {
                code #= PROMO_CODE_LETTERS[Nat8.toNat(byte) % 26];
                n += 1;
            };
        };
        if (n == PROMO_CODE_LENGTH) ?code else null;
    };

    // Callers with a purchase or withdrawal running: one at a time per caller (awaits interleave)
    transient var busy : [Principal] = [];
    func acquire(p : Principal) : Bool {
        if (Utils.principalInList(p, busy)) return false;
        busy := Array.append(busy, [p]);
        true;
    };
    func release(p : Principal) { busy := Utils.removePrincipal(p, busy) };
    
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
    
    func promoCodeId(code : Text) : ?Nat {
        for ((c, id) in promoCodeIds.vals()) { if (c == code) return ?id };
        null;
    };

    /// The id of a code, given one now if it has none.
    func ensurePromoCodeId(code : Text) : Nat {
        switch (promoCodeId(code)) {
            case (?id) id;
            case null {
                let id = nextPromoCodeId;
                nextPromoCodeId += 1;
                promoCodeIds := Array.append(promoCodeIds, [(code, id)]);
                id;
            };
        };
    };

    // ---- ICRC-3 block helpers ----

    /// Append one block for a change that has just been committed to local state.
    func icrc3_add(btype : Text, tx : [(Text, T3.Value)]) {
        ignore Icrc3Log.append(icrc3, btype, Int.abs(Time.now()), tx);
    };
    func pv(p : Principal) : T3.Value { Icrc3Log.principal(p) };
    func av(a : T.Account) : T3.Value { Icrc3Log.account(a.owner, a.subaccount) };
    func tv(t : Time.Time) : T3.Value { if (t >= 0) #Nat(Int.abs(t)) else #Int(t) }; // an admin may set any Int
    func flag(b : Bool) : T3.Value { #Nat(if b 1 else 0) };
    /// `previous_expiration` when there was a membership record
    func prevExp(prev : ?T.Membership) : [(Text, T3.Value)] {
        switch (prev) { case (?m) [("previous_expiration", tv(m.expiration))]; case null [] };
    };
    func icpTierValue(t : T.IcpTier) : T3.Value {
        #Map([("name", #Text(t.name)), ("amount_e8s", #Nat(t.amountE8s)), ("duration_ns", #Nat(t.durationNs)), ("active", flag(t.active))]);
    };
    func vpTierValue(t : T.VotingPowerTier) : T3.Value {
        #Map([("name", #Text(t.name)), ("min_voting_power_e8s", #Nat(t.minVotingPowerE8s)), ("duration_ns", #Nat(t.durationNs)), ("active", flag(t.active))]);
    };
    func icrc3_tier(btype : Text, caller : Principal, kind : Text, index : Nat, fields : [(Text, T3.Value)]) {
        icrc3_add(btype, Array.append<(Text, T3.Value)>([("caller", pv(caller)), ("kind", #Text(kind)), ("index", #Nat(index))], fields));
    };
    func icrc3_config(caller : Principal, key : Text, value : T3.Value, old_value : ?T3.Value) {
        let base : [(Text, T3.Value)] = [("caller", pv(caller)), ("key", #Text(key)), ("value", value)];
        icrc3_add("premium_config_update", switch (old_value) { case (?o) Array.append(base, [("old_value", o)]); case null base });
    };
    func samePrincipals(a : [Principal], b : [Principal]) : Bool {
        if (a.size() != b.size()) return false;
        for (p in a.vals()) { if (not Utils.principalInList(p, b)) return false };
        for (p in b.vals()) { if (not Utils.principalInList(p, a)) return false };
        true;
    };
    func sameAccount(a : T.Account, b : T.Account) : Bool {
        Principal.equal(a.owner, b.owner) and a.subaccount == b.subaccount;
    };
    /// One config-update block per field of the Config record that changed.
    func icrc3_config_changes(caller : Principal, old : T.Config, new : T.Config) {
        let principals = func(ps : [Principal]) : T3.Value { #Array(Array.map<Principal, T3.Value>(ps, pv)) };
        if (not samePrincipals(old.admins, new.admins)) { icrc3_config(caller, "admins", principals(new.admins), ?principals(old.admins)) };
        if (not Principal.equal(old.icpLedgerId, new.icpLedgerId)) { icrc3_config(caller, "icp_ledger_id", pv(new.icpLedgerId), ?pv(old.icpLedgerId)) };
        if (not Principal.equal(old.sneedGovernanceId, new.sneedGovernanceId)) { icrc3_config(caller, "sneed_governance_id", pv(new.sneedGovernanceId), ?pv(old.sneedGovernanceId)) };
        if (not sameAccount(old.paymentRecipient, new.paymentRecipient)) { icrc3_config(caller, "payment_recipient", av(new.paymentRecipient), ?av(old.paymentRecipient)) };
        if (old.minClaimIntervalNs != new.minClaimIntervalNs) { icrc3_config(caller, "min_claim_interval_ns", #Nat(new.minClaimIntervalNs), ?#Nat(old.minClaimIntervalNs)) };
    };
    func icrc3_promo(btype : Text, caller : Principal, code : Text, fields : [(Text, T3.Value)]) {
        icrc3_add(btype, Array.append<(Text, T3.Value)>([("caller", pv(caller)), ("code_id", #Nat(ensurePromoCodeId(code)))], fields));
    };

    // Record a claim log entry
    func recordClaim(
        claimant : Principal,
        claimType : T.ClaimType,
        durationGrantedNs : Nat,
        tierName : Text,
        previousExpiration : Time.Time,
        newExpiration : Time.Time,
        icpAmountE8s : ?Nat,
        votingPowerE8s : ?Nat,
        promoCode : ?Text
    ) {
        let entry : T.ClaimLogEntry = {
            id = nextClaimLogId;
            timestamp = Time.now();
            claimant = claimant;
            claimType = claimType;
            durationGrantedNs = durationGrantedNs;
            tierName = tierName;
            previousExpiration = previousExpiration;
            newExpiration = newExpiration;
            icpAmountE8s = icpAmountE8s;
            votingPowerE8s = votingPowerE8s;
            promoCode = promoCode;
        };
        claimLog := Array.append(claimLog, [entry]);
        nextClaimLogId += 1;
        
        // Update stats
        switch (claimType) {
            case (#IcpPayment) { totalIcpPayments += 1; };
            case (#VotingPower) { totalVpClaims += 1; };
            case (#PromoCode) { totalPromoClaims += 1; };
        };
    };
    
    // Record an ICP payment log entry
    func recordIcpPayment(
        payer : Principal,
        amountE8s : Nat,
        netAmountE8s : Nat,
        transactionId : Nat,
        tierName : Text,
        durationGrantedNs : Nat
    ) {
        let entry : T.IcpPaymentLogEntry = {
            id = nextIcpPaymentLogId;
            timestamp = Time.now();
            payer = payer;
            amountE8s = amountE8s;
            netAmountE8s = netAmountE8s;
            icpTransactionId = transactionId;
            tierName = tierName;
            durationGrantedNs = durationGrantedNs;
        };
        icpPaymentLog := Array.append(icpPaymentLog, [entry]);
        nextIcpPaymentLogId += 1;
        totalIcpCollectedE8s += amountE8s;
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
    
    /// Get all currently active premium members (public)
    /// Returns list of principals with active (non-expired) premium memberships
    /// This is used by frontend to show premium badges across the site
    public query func getActivePremiumMembers() : async [Principal] {
        let now = Time.now();
        let activeMembers = Array.filter<(Principal, T.Membership)>(
            memberships,
            func((_, m) : (Principal, T.Membership)) : Bool {
                m.expiration > now
            }
        );
        Array.map<(Principal, T.Membership), Principal>(
            activeMembers,
            func((p, _) : (Principal, T.Membership)) : Principal { p }
        )
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
        if (not acquire(caller)) {
            return #err(#InternalError("A purchase or withdrawal of yours is already in progress"));
        };
        try { await* purchase(caller) } finally { release(caller) };
    };

    /// Take back what is in your own deposit subaccount (getDepositAccount(you)), minus the ledger
    /// fee, to your default account: for a deposit that matches no tier, or that you changed your
    /// mind about. Only ever the caller's own subaccount; one purchase or withdrawal at a time.
    public shared ({ caller }) func withdrawDeposit() : async T.WithdrawResult {
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };
        if (not acquire(caller)) {
            return #err(#InProgress);
        };
        try { await* withdraw(caller) } finally { release(caller) };
    };

    func withdraw(caller : Principal) : async* T.WithdrawResult {
        let icpLedger = getIcpLedger();
        let userSubaccount = Utils.principalToSubaccount(caller);
        let to : T.Account = { owner = caller; subaccount = null };
        let (balance, fee) = try {
            let b = await icpLedger.icrc1_balance_of({ owner = Principal.fromActor(this); subaccount = ?userSubaccount });
            (b, await icpLedger.icrc1_fee());
        } catch (e) {
            return #err(#TransferFailed("Could not reach the ICP ledger: " # Error.message(e)));
        };
        if (balance <= fee) {
            return #err(#NothingToWithdraw({ balance; fee }));
        };
        let result = try {
            await icpLedger.icrc1_transfer({
                to;
                fee = ?fee;
                memo = null;
                from_subaccount = ?userSubaccount;
                created_at_time = ?Nat64.fromNat(Int.abs(Time.now()));
                amount = balance - fee;
            });
        } catch (e) {
            return #err(#TransferFailed("Could not reach the ICP ledger: " # Error.message(e)));
        };
        switch (result) {
            case (#Ok(blockIndex)) {
                icrc3_add("premium_deposit_withdraw", [
                    ("caller", pv(caller)), ("amount_e8s", #Nat(balance - fee)), ("fee_e8s", #Nat(fee)), ("to", av(to)), ("icp_tx", #Nat(blockIndex)),
                ]);
                #ok({ amountE8s = balance - fee; blockIndex; to });
            };
            case (#Err(e)) #err(#TransferFailed(debug_show (e)));
        };
    };

    func purchase(caller : Principal) : async* T.PurchaseResult {
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
        
        // Transfer ICP to payment recipient (as configured now: the log names this account)
        let recipient = config.paymentRecipient;
        let transferResult = await icpLedger.icrc1_transfer({
            to = recipient;
            fee = ?fee;
            memo = null;
            from_subaccount = ?userSubaccount;
            created_at_time = ?Nat64.fromNat(Int.abs(now));
            amount = balance - fee;
        });
        
        let transactionId = switch (transferResult) {
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
            case (#Ok(txId)) { txId };
        };
        
        // Record the ICP payment
        recordIcpPayment(
            caller,
            balance,
            balance - fee,
            transactionId,
            tier.name,
            tier.durationNs
        );
        
        // Update membership
        let previous = getMembership(caller);
        let currentExpiration = switch (previous) {
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
        
        // Record the claim
        recordClaim(
            caller,
            #IcpPayment,
            tier.durationNs,
            tier.name,
            currentExpiration,
            newExpiration,
            ?balance,
            null,
            null
        );

        icrc3_add("premium_icp_purchase", Array.flatten<(Text, T3.Value)>([
            [("caller", pv(caller)), ("tier", #Text(tier.name)), ("duration_ns", #Nat(tier.durationNs)), ("amount_e8s", #Nat(balance)),
             ("fee_e8s", #Nat(fee)), ("to", av(recipient)), ("icp_tx", #Nat(transactionId))],
            prevExp(previous),
            [("new_expiration", tv(newExpiration))],
        ]));
        
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
        
        // Check the rate limit again: claims by the same caller can interleave at the awaits above.
        switch (getLastVpClaimTime(caller)) {
            case (?lastClaim) {
                if (now - lastClaim < config.minClaimIntervalNs) {
                    return #err(#AlreadyClaimedRecently({
                        lastClaimTime = lastClaim;
                        intervalNs = config.minClaimIntervalNs;
                        nextClaimTime = lastClaim + config.minClaimIntervalNs;
                    }));
                };
            };
            case null {};
        };

        // Update last claim time
        setLastVpClaimTime(caller, now);
        
        // VP claims are NOT additive: they set the expiration to now + tier duration, and only
        // when that is later than the current one. Holding voting power keeps a membership
        // topped up; it cannot be banked. (Additive claims with a short claim interval would let
        // a holder stack a tier's whole duration on every claim.) ICP purchases and promo codes
        // are additive.
        let previous = getMembership(caller);
        let currentExpiration = switch (previous) {
            case (?m) { m.expiration };
            case null { 0 };
        };
        let vpExpiration = now + tier.durationNs;
        let newExpiration = if (vpExpiration > currentExpiration) { vpExpiration } else { currentExpiration };
        
        let newMembership : T.Membership = {
            principal = caller;
            expiration = newExpiration;
            lastUpdated = now;
        };
        
        setMembership(newMembership);
        
        // Record the claim
        recordClaim(
            caller,
            #VotingPower,
            tier.durationNs,
            tier.name,
            currentExpiration,
            newExpiration,
            null,
            ?totalVp,
            null
        );

        icrc3_add("premium_vp_claim", Array.flatten<(Text, T3.Value)>([
            [("caller", pv(caller)), ("voting_power", #Nat(totalVp)), ("tier", #Text(tier.name)), ("duration_ns", #Nat(tier.durationNs))],
            prevExp(previous),
            [("new_expiration", tv(newExpiration))],
        ]));
        
        #ok(newMembership);
    };
    
    // ============================================
    // PROMO CODE METHODS
    // ============================================
    
    /// Claim a promo code to get free premium membership
    public shared ({ caller }) func claimPromoCode(code : Text) : async T.PromoCodeResult {
        if (Principal.isAnonymous(caller)) {
            return #err(#NotAuthorized);
        };
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
                let previous = getMembership(caller);
                let currentExpiration = switch (previous) {
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
                
                // Record the promo code claim (existing system)
                let claim : T.PromoCodeClaim = {
                    code = code;
                    claimedBy = caller;
                    claimedAt = now;
                    durationGrantedNs = promoCode.durationNs;
                };
                promoCodeClaims := Array.append(promoCodeClaims, [claim]);
                
                // Record to the unified claim log
                recordClaim(
                    caller,
                    #PromoCode,
                    promoCode.durationNs,
                    "Promo: " # code,
                    currentExpiration,
                    newExpiration,
                    null,
                    null,
                    ?code
                );
                
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

                icrc3_promo("premium_promo_claim", caller, code, Array.flatten<(Text, T3.Value)>([
                    [("duration_ns", #Nat(promoCode.durationNs)), ("claim_count", #Nat(updatedPromoCode.claimCount))],
                    prevExp(previous),
                    [("new_expiration", tv(newExpiration))],
                ]));
                
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
        let old = config;
        config := newConfig;
        icrc3_config_changes(caller, old, newConfig);
        #ok(());
    };
    
    /// Add admin (admin only)
    public shared ({ caller }) func addAdmin(newAdmin : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let wasAdmin = Utils.principalInList(newAdmin, config.admins);
        config := {
            admins = Utils.addPrincipal(newAdmin, config.admins);
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        if (not wasAdmin) { icrc3_config(caller, "admin_added", pv(newAdmin), null) };
        #ok(());
    };
    
    /// Remove admin (admin only)
    public shared ({ caller }) func removeAdmin(admin : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let wasAdmin = Utils.principalInList(admin, config.admins);
        config := {
            admins = Utils.removePrincipal(admin, config.admins);
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        if (wasAdmin) { icrc3_config(caller, "admin_removed", pv(admin), null) };
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
        icrc3_tier("premium_tier_add", caller, "icp", icpTiers.size() - 1, [("tier", icpTierValue(tier))]);
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
        let old = icpTiers[index];
        icpTiers := Array.tabulate<T.IcpTier>(icpTiers.size(), func(i : Nat) : T.IcpTier {
            if (i == index) { tier } else { icpTiers[i] };
        });
        icrc3_tier("premium_tier_update", caller, "icp", index, [("tier", icpTierValue(tier)), ("old_tier", icpTierValue(old))]);
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
        let old = icpTiers[index];
        icpTiers := Array.tabulate<T.IcpTier>(icpTiers.size() - 1, func(i : Nat) : T.IcpTier {
            if (i < index) { icpTiers[i] } else { icpTiers[i + 1] };
        });
        icrc3_tier("premium_tier_remove", caller, "icp", index, [("old_tier", icpTierValue(old))]);
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
        icrc3_tier("premium_tier_add", caller, "vp", vpTiers.size() - 1, [("tier", vpTierValue(tier))]);
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
        let old = vpTiers[index];
        vpTiers := Array.tabulate<T.VotingPowerTier>(vpTiers.size(), func(i : Nat) : T.VotingPowerTier {
            if (i == index) { tier } else { vpTiers[i] };
        });
        icrc3_tier("premium_tier_update", caller, "vp", index, [("tier", vpTierValue(tier)), ("old_tier", vpTierValue(old))]);
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
        let old = vpTiers[index];
        vpTiers := Array.tabulate<T.VotingPowerTier>(vpTiers.size() - 1, func(i : Nat) : T.VotingPowerTier {
            if (i < index) { vpTiers[i] } else { vpTiers[i + 1] };
        });
        icrc3_tier("premium_tier_remove", caller, "vp", index, [("old_tier", vpTierValue(old))]);
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
        let previous = getMembership(principal);
        let membership : T.Membership = {
            principal = principal;
            expiration = expirationNs;
            lastUpdated = now;
        };
        setMembership(membership);
        icrc3_add("premium_admin_set", Array.flatten<(Text, T3.Value)>([
            [("caller", pv(caller)), ("principal", pv(principal))], prevExp(previous), [("new_expiration", tv(expirationNs))],
        ]));
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
        let previous = getMembership(principal);
        let currentExpiration = switch (previous) {
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
        icrc3_add("premium_admin_extend", Array.flatten<(Text, T3.Value)>([
            [("caller", pv(caller)), ("principal", pv(principal)), ("duration_ns", #Nat(durationNs))], prevExp(previous), [("new_expiration", tv(newExpiration))],
        ]));
        #ok(membership);
    };
    
    /// Revoke membership for a principal (admin only)
    public shared ({ caller }) func revokeMembership(principal : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let previous = getMembership(principal);
        memberships := Array.filter<(Principal, T.Membership)>(
            memberships,
            func((p, _) : (Principal, T.Membership)) : Bool {
                not Principal.equal(p, principal);
            }
        );
        // revoking a non-member changes nothing and logs nothing
        if (previous != null) {
            icrc3_add("premium_admin_revoke", Array.append<(Text, T3.Value)>([("caller", pv(caller)), ("principal", pv(principal))], prevExp(previous)));
        };
        #ok(());
    };
    
    /// Set the ICP ledger canister ID (admin only)
    public shared ({ caller }) func setIcpLedgerId(ledgerId : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let old = config.icpLedgerId;
        config := {
            admins = config.admins;
            icpLedgerId = ledgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        icrc3_config(caller, "icp_ledger_id", pv(ledgerId), ?pv(old));
        #ok(());
    };
    
    /// Set the Sneed SNS governance canister ID (admin only)
    public shared ({ caller }) func setSneedGovernanceId(governanceId : Principal) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let old = config.sneedGovernanceId;
        config := {
            admins = config.admins;
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = governanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        icrc3_config(caller, "sneed_governance_id", pv(governanceId), ?pv(old));
        #ok(());
    };
    
    /// Set the payment recipient account (admin only)
    public shared ({ caller }) func setPaymentRecipient(recipient : T.Account) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let old = config.paymentRecipient;
        config := {
            admins = config.admins;
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = recipient;
            minClaimIntervalNs = config.minClaimIntervalNs;
        };
        icrc3_config(caller, "payment_recipient", av(recipient), ?av(old));
        #ok(());
    };
    
    /// Set minimum claim interval (admin only)
    public shared ({ caller }) func setMinClaimInterval(intervalNs : Nat) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let old = config.minClaimIntervalNs;
        config := {
            admins = config.admins;
            icpLedgerId = config.icpLedgerId;
            sneedGovernanceId = config.sneedGovernanceId;
            paymentRecipient = config.paymentRecipient;
            minClaimIntervalNs = intervalNs;
        };
        icrc3_config(caller, "min_claim_interval_ns", #Nat(intervalNs), ?#Nat(old));
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
        
        // Generate a unique code from the IC's randomness
        var found : ?Text = null;
        var attempts = 0;
        while (found == null and attempts < 10) {
            let entropy = try { await Random.blob() } catch (e) {
                return #err(#InvalidInput("Could not get randomness: " # Error.message(e)));
            };
            switch (promoCodeFrom(entropy)) {
                case (?c) if (getPromoCode(c) == null) found := ?c;
                case null {};
            };
            attempts += 1;
        };
        let code = switch (found) {
            case (?c) c;
            case null return #err(#InvalidInput("Failed to generate unique code"));
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
        // logged by id: never the code itself, nor the admin notes
        icrc3_promo("premium_promo_create", caller, code, Array.append<(Text, T3.Value)>(
            [("duration_ns", #Nat(request.durationNs)), ("max_claims", #Nat(request.maxClaims))],
            switch (request.expiration) { case (?e) [("code_expiration", tv(e))]; case null [] },
        ));
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
                icrc3_promo("premium_promo_deactivate", caller, pc.code, []);
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
                icrc3_promo("premium_promo_reactivate", caller, pc.code, []);
                #ok(());
            };
        };
    };
    
    /// Delete a promo code entirely (admin only)
    public shared ({ caller }) func deletePromoCode(code : Text) : async T.AdminResult<()> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        let deleted = switch (getPromoCode(code)) {
            case null { return #err(#NotFound) };
            case (?pc) pc;
        };
        promoCodes := Array.filter<T.PromoCode>(
            promoCodes,
            func(pc : T.PromoCode) : Bool { pc.code != code }
        );
        icrc3_promo("premium_promo_delete", caller, code, [("claim_count", #Nat(deleted.claimCount))]);
        // the id is not reused; the code's text is dropped from the map with the code
        promoCodeIds := Array.filter<(Text, Nat)>(promoCodeIds, func((c, _) : (Text, Nat)) : Bool { c != code });
        #ok(());
    };
    
    // ============================================
    // PAYMENT & CLAIM LOG QUERIES (Admin only)
    // ============================================
    
    /// Get paginated claim log (admin only)
    /// Returns claims in reverse chronological order (newest first)
    public shared query ({ caller }) func getClaimLog(offset : Nat, limit : Nat) : async {
        claims : [T.ClaimLogEntry];
        total_count : Nat;
        has_more : Bool;
    } {
        assert(isAdmin(caller));
        
        let total = claimLog.size();
        
        if (offset >= total) {
            return {
                claims = [];
                total_count = total;
                has_more = false;
            };
        };
        
        let effectiveLimit = if (limit > 1000) { 1000 } else { limit };
        let startIdx = if (total > offset) { total - offset } else { 0 };
        let endIdx = if (startIdx > effectiveLimit) { startIdx - effectiveLimit } else { 0 };
        
        var result : [T.ClaimLogEntry] = [];
        var idx = startIdx;
        while (idx > endIdx) {
            idx -= 1;
            result := Array.append(result, [claimLog[idx]]);
        };
        
        {
            claims = result;
            total_count = total;
            has_more = endIdx > 0;
        };
    };
    
    /// Get paginated ICP payment log (admin only)
    /// Returns payments in reverse chronological order (newest first)
    public shared query ({ caller }) func getIcpPaymentLog(offset : Nat, limit : Nat) : async {
        payments : [T.IcpPaymentLogEntry];
        total_count : Nat;
        has_more : Bool;
    } {
        assert(isAdmin(caller));
        
        let total = icpPaymentLog.size();
        
        if (offset >= total) {
            return {
                payments = [];
                total_count = total;
                has_more = false;
            };
        };
        
        let effectiveLimit = if (limit > 1000) { 1000 } else { limit };
        let startIdx = if (total > offset) { total - offset } else { 0 };
        let endIdx = if (startIdx > effectiveLimit) { startIdx - effectiveLimit } else { 0 };
        
        var result : [T.IcpPaymentLogEntry] = [];
        var idx = startIdx;
        while (idx > endIdx) {
            idx -= 1;
            result := Array.append(result, [icpPaymentLog[idx]]);
        };
        
        {
            payments = result;
            total_count = total;
            has_more = endIdx > 0;
        };
    };
    
    /// Get payment and claim statistics: public, for the revenue page (the logs themselves stay admin only)
    public query func getPaymentStats() : async {
        total_icp_collected_e8s : Nat;
        total_icp_payments : Nat;
        total_vp_claims : Nat;
        total_promo_claims : Nat;
        total_claims : Nat;
        claim_log_size : Nat;
        payment_log_size : Nat;
    } {
        {
            total_icp_collected_e8s = totalIcpCollectedE8s;
            total_icp_payments = totalIcpPayments;
            total_vp_claims = totalVpClaims;
            total_promo_claims = totalPromoClaims;
            total_claims = totalIcpPayments + totalVpClaims + totalPromoClaims;
            claim_log_size = claimLog.size();
            payment_log_size = icpPaymentLog.size();
        };
    };
    
    /// Get claim log count (admin only)
    public shared query ({ caller }) func getClaimLogCount() : async Nat {
        assert(isAdmin(caller));
        claimLog.size();
    };
    
    /// Get ICP payment log count (admin only)
    public shared query ({ caller }) func getIcpPaymentLogCount() : async Nat {
        assert(isAdmin(caller));
        icpPaymentLog.size();
    };

    /// Every promo code with the id the activity log names it by (admin only).
    public query ({ caller }) func getPromoCodeIds() : async T.AdminResult<[(Text, Nat)]> {
        if (not isAdmin(caller)) {
            return #err(#NotAuthorized);
        };
        #ok(promoCodeIds);
    };

    // ============================================
    // ICRC-3 ACTIVITY LOG (library src/icrc3, design spec/sneed_premium_icrc3.md)
    // ============================================

    transient let icrc3_catalogue : Icrc3Log.Config = {
        block_types_url = "https://app.sneeddao.com/api/sneed_premium#block-types";
        block_types = [
            "premium_icp_purchase",
            "premium_vp_claim",
            "premium_deposit_withdraw",
            "premium_promo_create",
            "premium_promo_claim",
            "premium_promo_deactivate",
            "premium_promo_reactivate",
            "premium_promo_delete",
            "premium_admin_set",
            "premium_admin_extend",
            "premium_admin_revoke",
            "premium_tier_add",
            "premium_tier_update",
            "premium_tier_remove",
            "premium_config_update",
        ];
    };

    func icrc3_cid() : Nat { icrc3_next_cid += 1; icrc3_next_cid };
    // Sneed Premium has no text log; the library's lines go to the canister log
    func icrc3_print(cid : Nat, message : Text) { Debug.print("[icrc3 " # Nat.toText(cid) # "] " # message) };

    func icrc3_env() : Icrc3Log.Environment {
        {
            self = Principal.fromActor(this);
            archive_controllers = [SNEED_SNS_ROOT];
            cycle_reserve = 2_000_000_000_000; // never spend this canister's balance below 2 T
            new_correlation_id = icrc3_cid;
            log_info = icrc3_print;
            log_error = icrc3_print;
        };
    };

    func icrc3_sns_env() : Icrc3Sns.Environment {
        {
            governance = config.sneedGovernanceId; // Sneed governance on production
            name = "Sneed Premium";
            doc_url = "https://app.sneeddao.com/api/sneed_premium#activity-log-icrc-3";
            new_correlation_id = icrc3_cid;
            log_info = icrc3_print;
            log_error = icrc3_print;
            describe = null;
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
        if (not isAdmin(caller)) { return #Err("Only admins can change the ICRC-3 settings") };
        switch (Icrc3Log.applySettings(icrc3, update)) {
            case (#Err(e)) { #Err(e) };
            case (#Ok(changes)) {
                for ((key, old_value, new_value) in changes.vals()) {
                    icrc3_config(caller, key, #Nat(new_value), ?#Nat(old_value));
                };
                #Ok(icrc3.settings);
            };
        };
    };

    /// Move every live block to the archives now (creating archives as needed). Returns the number of blocks moved.
    public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
        if (not isAdmin(caller)) { return #Err("Only admins can trigger a spill") };
        if (icrc3_rt.spilling) { return #Err("A spill is already in progress") };
        let moved = await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true);
        ignore await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
        #Ok(moved);
    };

    /// Re-apply the intended controllers (this canister and SNS root) to every archive.
    public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
        if (not isAdmin(caller)) { Debug.trap("Only admins can repair archive controllers") };
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
        if (not isAdmin(caller)) { return #Err("Only admins can set the proposal neuron") };
        let old = icrc3_sns.neuron;
        switch (Icrc3Sns.setNeuron(icrc3_sns, neuron)) {
            case (#Err(e)) { #Err(e) };
            case (#Ok) {
                let asValue = func(n : ?Blob) : T3.Value { switch (n) { case (?b) { #Blob(b) }; case null { #Text("none") } } };
                icrc3_config(caller, "icrc3_proposal_neuron", asValue(neuron), ?asValue(old));
                #Ok;
            };
        };
    };

    /// Submit the pending registration proposals now instead of at the next spill check.
    public shared ({ caller }) func admin_icrc3_register_archives_now() : async { #Ok : Nat; #Err : Text } {
        if (not isAdmin(caller)) { return #Err("Only admins can submit registration proposals") };
        #Ok(await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env()));
    };

    /// Forget an archive's proposal (after a rejection) so a new one is submitted.
    public shared ({ caller }) func admin_icrc3_reset_archive_registration(canister_id : Principal) : async { #Ok : Bool; #Err : Text } {
        if (not isAdmin(caller)) { return #Err("Only admins can reset a registration") };
        #Ok(Icrc3Sns.reset(icrc3_sns, canister_id));
    };

    // ---- background work ----

    func icrc3_timer_job() : async () {
        ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false);
        ignore await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
    };

    func ensure_icrc3_timer<system>() {
        Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job);
    };

    // Republish the certified tip after an upgrade (certified data does not survive one).
    system func postupgrade() {
        Icrc3Log.certify(icrc3);
        ensure_icrc3_timer<system>();
    };

    // Promo codes without an id (all of them on the first run of this code) get one, in list
    // order. Runs on install and every upgrade; a no-op once every code has an id.
    for (pc in promoCodes.vals()) { ignore ensurePromoCodeId(pc.code) };

    // the ICRC-3 spill check (every 15 minutes; started once, also on upgrades)
    ensure_icrc3_timer<system>();

    // Limit of the ingress guard below
    transient let MAX_PROMO_CODE : Nat = 64;

    // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
    // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
    public query func get_api_doc() : async Text { ApiDoc.text };

    // Ingress guard (src/IngressGuard.mo): queries are never accepted as update calls, which
    // would go through consensus at our cost, and arguments are capped in size.
    system func inspect({ caller : Principal; arg : Blob; msg : {
        #get_api_doc : Any;
        #admin_icrc3_register_archives_now : Any;
        #admin_icrc3_repair_archive_controllers : Any;
        #admin_icrc3_reset_archive_registration : Any;
        #admin_icrc3_spill_now : Any;
        #admin_set_icrc3_proposal_neuron : Any;
        #admin_set_icrc3_settings : Any;
        #getPromoCodeIds : Any;
        #icrc10_supported_standards : Any;
        #icrc3_get_archives : Any;
        #icrc3_get_blocks : Any;
        #icrc3_get_tip_certificate : Any;
        #icrc3_log_status : Any;
        #icrc3_registration_status : Any;
        #icrc3_supported_block_types : Any;
        #addAdmin : Any;
        #addIcpTier : Any;
        #addVpTier : Any;
        #checkMembership : Any;
        #claimPromoCode : () -> Text;
        #claimWithVotingPower : Any;
        #createPromoCode : Any;
        #deactivatePromoCode : Any;
        #deletePromoCode : Any;
        #extendMembershipAdmin : Any;
        #getActivePremiumMembers : Any;
        #getAllIcpTiers : Any;
        #getAllMemberships : Any;
        #getAllVotingPowerTiers : Any;
        #getCanisterId : Any;
        #getClaimLog : Any;
        #getClaimLogCount : Any;
        #getConfig : Any;
        #getDepositAccount : Any;
        #getIcpPaymentLog : Any;
        #getIcpPaymentLogCount : Any;
        #getIcpTiers : Any;
        #getMembershipDetails : Any;
        #getPaymentStats : Any;
        #getPromoCodeClaims : Any;
        #getPromoCodes : Any;
        #getVotingPowerTiers : Any;
        #isCallerAdmin : Any;
        #purchaseWithIcp : Any;
        #reactivatePromoCode : Any;
        #removeAdmin : Any;
        #removeIcpTier : Any;
        #removeVpTier : Any;
        #revokeMembership : Any;
        #setIcpLedgerId : Any;
        #setMembershipAdmin : Any;
        #setMinClaimInterval : Any;
        #setPaymentRecipient : Any;
        #setSneedGovernanceId : Any;
        #updateConfig : Any;
        #updateIcpTier : Any;
        #updateVpTier : Any;
        #withdrawDeposit : Any;
    } }) : Bool {
        switch (msg) {
            case (
                #get_api_doc _
                or #checkMembership _
                or #getActivePremiumMembers _
                or #getAllIcpTiers _
                or #getAllMemberships _
                or #getAllVotingPowerTiers _
                or #getCanisterId _
                or #getClaimLog _
                or #getClaimLogCount _
                or #getConfig _
                or #getDepositAccount _
                or #getIcpPaymentLog _
                or #getIcpPaymentLogCount _
                or #getIcpTiers _
                or #getMembershipDetails _
                or #getPaymentStats _
                or #getPromoCodeClaims _
                or #getPromoCodes _
                or #getVotingPowerTiers _
                or #isCallerAdmin _
                or #getPromoCodeIds _
                or #icrc10_supported_standards _
                or #icrc3_get_archives _
                or #icrc3_get_blocks _
                or #icrc3_get_tip_certificate _
                or #icrc3_log_status _
                or #icrc3_registration_status _
                or #icrc3_supported_block_types _
            ) false;
            // codes are 8 letters; leave room for what people paste
            case (#claimPromoCode f) arg.size() <= IngressGuard.textArg(MAX_PROMO_CODE) and IngressGuard.text(f(), MAX_PROMO_CODE);
            // admin tools with free-form content
            case (#addIcpTier _ or #addVpTier _ or #updateIcpTier _ or #updateVpTier _ or #createPromoCode _ or #deactivatePromoCode _ or #reactivatePromoCode _ or #deletePromoCode _ or #updateConfig _) isAdmin(caller);
            case _ arg.size() <= IngressGuard.SMALL_ARG;
        };
    };

};

