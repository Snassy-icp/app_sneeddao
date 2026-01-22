import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Map "mo:map/Map";
import { phash } "mo:map/Map";

/// Reusable module for checking Sneed Premium membership status with caching.
/// Uses stable Map for the cache.
/// 
/// Usage in client canisters:
/// 1. Import this module: `import PremiumClient "../PremiumClient";`
/// 2. Create a stable cache: `var premiumCache = PremiumClient.emptyCache();`
/// 3. Call `PremiumClient.checkPremium(cache, premiumCanisterId, principal)` to check membership
/// 4. The cache is automatically updated (Map is mutable)

module {
    // ============================================
    // TYPES
    // ============================================
    
    /// Cache type: Map of principal -> expiration timestamp
    /// If expiration > Time.now(), the user has an active premium membership
    public type PremiumCache = Map.Map<Principal, Time.Time>;
    
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
    
    /// Create an empty cache
    public func emptyCache() : PremiumCache {
        Map.new<Principal, Time.Time>();
    };
    
    /// Get cached expiration for a principal
    /// Returns null if not in cache, or the cached expiration timestamp
    public func getCachedExpiration(cache : PremiumCache, principal : Principal) : ?Time.Time {
        Map.get(cache, phash, principal);
    };
    
    /// Update the cache with a new expiration timestamp
    public func updateCache(cache : PremiumCache, principal : Principal, expiration : Time.Time) : () {
        ignore Map.put(cache, phash, principal, expiration);
    };
    
    /// Remove expired entries from the cache (cleanup helper)
    public func cleanCache(cache : PremiumCache) : () {
        let now = Time.now();
        let toRemove = Map.filter<Principal, Time.Time>(cache, phash, func(_, exp) { exp <= now });
        for ((principal, _) in Map.entries(toRemove)) {
            ignore Map.remove(cache, phash, principal);
        };
    };
    
    /// Get cache size
    public func cacheSize(cache : PremiumCache) : Nat {
        Map.size(cache);
    };
    
    // ============================================
    // PREMIUM CHECKS
    // ============================================
    
    /// Check if a principal has an active premium membership.
    /// Uses the cache if the cached expiration hasn't passed yet.
    /// If cache miss or expired, calls the Sneed Premium canister and updates the cache.
    /// 
    /// Returns: (isPremium, expiration)
    /// - isPremium: true if the user has an active premium membership
    /// - expiration: the expiration timestamp (0 if not found)
    /// 
    /// Note: The cache is updated in-place (Map is mutable)
    public func checkPremium(
        cache : PremiumCache,
        premiumCanisterId : Principal,
        principal : Principal
    ) : async* (Bool, Time.Time) {
        let now = Time.now();
        
        // Check cache first
        switch (getCachedExpiration(cache, principal)) {
            case (?expiration) {
                if (expiration > now) {
                    // Cache hit - user is premium
                    return (true, expiration);
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
                updateCache(cache, principal, expiration);
                return (true, expiration);
            };
            case (#Expired({ expiredAt })) {
                // Update cache with expired timestamp (so we don't keep checking)
                updateCache(cache, principal, expiredAt);
                return (false, expiredAt);
            };
            case (#NotFound) {
                // Mark as "never had premium" with timestamp 0
                updateCache(cache, principal, 0);
                return (false, 0);
            };
        };
    };
    
    /// Simple check that returns only whether the user is premium.
    public func isPremium(
        cache : PremiumCache,
        premiumCanisterId : Principal,
        principal : Principal
    ) : async* Bool {
        let (isPremium, _) = await* checkPremium(cache, premiumCanisterId, principal);
        isPremium;
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
