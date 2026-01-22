import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Array "mo:base/Array";

/// Reusable module for checking Sneed Premium membership status with caching.
/// 
/// Usage in client canisters:
/// 1. Import this module: `import PremiumClient "../PremiumClient";`
/// 2. Create a stable cache variable: `var premiumCache : [(Principal, Time.Time)] = [];`
/// 3. Call `PremiumClient.checkPremium(cache, premiumCanisterId, principal)` to check membership
/// 4. The cache will be updated automatically with expiration timestamps
/// 5. Save/restore the cache in preupgrade/postupgrade

module {
    // ============================================
    // TYPES
    // ============================================
    
    /// Cache entry: (principal, expiration timestamp)
    /// If expiration > Time.now(), the user has an active premium membership
    public type PremiumCache = [(Principal, Time.Time)];
    
    /// Result of a premium check
    public type PremiumStatus = {
        #Active : { expiration : Time.Time };
        #Expired : { expiredAt : Time.Time };
        #NotFound;
    };
    
    /// Actor interface for the Sneed Premium canister
    public type SneedPremiumActor = actor {
        checkMembership : shared query (Principal) -> async PremiumStatus;
    };
    
    // ============================================
    // CACHE MANAGEMENT
    // ============================================
    
    /// Get cached expiration for a principal
    /// Returns null if not in cache, or the cached expiration timestamp
    public func getCachedExpiration(cache : PremiumCache, principal : Principal) : ?Time.Time {
        for ((p, exp) in cache.vals()) {
            if (Principal.equal(p, principal)) {
                return ?exp;
            };
        };
        null;
    };
    
    /// Update the cache with a new expiration timestamp
    /// Returns the updated cache
    public func updateCache(cache : PremiumCache, principal : Principal, expiration : Time.Time) : PremiumCache {
        let filtered = Array.filter<(Principal, Time.Time)>(
            cache,
            func((p, _) : (Principal, Time.Time)) : Bool {
                not Principal.equal(p, principal);
            }
        );
        Array.append(filtered, [(principal, expiration)]);
    };
    
    /// Remove expired entries from the cache (cleanup helper)
    public func cleanCache(cache : PremiumCache) : PremiumCache {
        let now = Time.now();
        Array.filter<(Principal, Time.Time)>(
            cache,
            func((_, exp) : (Principal, Time.Time)) : Bool {
                exp > now;
            }
        );
    };
    
    // ============================================
    // PREMIUM CHECKS
    // ============================================
    
    /// Check if a principal has an active premium membership.
    /// Uses the cache if the cached expiration hasn't passed yet.
    /// If cache miss or expired, calls the Sneed Premium canister and updates the cache.
    /// 
    /// Returns: (isPremium, expiration, updatedCache)
    /// - isPremium: true if the user has an active premium membership
    /// - expiration: the expiration timestamp (0 if not found)
    /// - updatedCache: the updated cache (caller should save this)
    public func checkPremium(
        cache : PremiumCache,
        premiumCanisterId : Principal,
        principal : Principal
    ) : async* (Bool, Time.Time, PremiumCache) {
        let now = Time.now();
        
        // Check cache first
        switch (getCachedExpiration(cache, principal)) {
            case (?expiration) {
                if (expiration > now) {
                    // Cache hit - user is premium
                    return (true, expiration, cache);
                };
                // Cache expired - fall through to check canister
            };
            case null {
                // Not in cache - fall through to check canister
            };
        };
        
        // Cache miss or expired - call the premium canister
        let premiumActor : SneedPremiumActor = actor(Principal.toText(premiumCanisterId));
        let status = await premiumActor.checkMembership(principal);
        
        switch (status) {
            case (#Active({ expiration })) {
                // Update cache with new expiration
                let newCache = updateCache(cache, principal, expiration);
                return (true, expiration, newCache);
            };
            case (#Expired({ expiredAt })) {
                // Update cache with expired timestamp (so we don't keep checking)
                let newCache = updateCache(cache, principal, expiredAt);
                return (false, expiredAt, newCache);
            };
            case (#NotFound) {
                // Mark as "never had premium" with timestamp 0
                let newCache = updateCache(cache, principal, 0);
                return (false, 0, newCache);
            };
        };
    };
    
    /// Simple check that returns only whether the user is premium.
    /// Still updates the cache internally.
    public func isPremium(
        cache : PremiumCache,
        premiumCanisterId : Principal,
        principal : Principal
    ) : async* (Bool, PremiumCache) {
        let (isPremium, _, newCache) = await* checkPremium(cache, premiumCanisterId, principal);
        (isPremium, newCache);
    };
    
    /// Check from cache only (synchronous, no inter-canister call).
    /// Returns true only if user is in cache AND expiration hasn't passed.
    /// Use this when you want to avoid inter-canister calls.
    public func isPremiumCached(cache : PremiumCache, principal : Principal) : Bool {
        let now = Time.now();
        switch (getCachedExpiration(cache, principal)) {
            case (?expiration) { expiration > now };
            case null { false };
        };
    };
};

