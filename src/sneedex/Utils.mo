import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Text "mo:base/Text";
import Char "mo:base/Char";
import Buffer "mo:base/Buffer";

import T "Types";
import Crypto "Crypto";

module {
    // ============================================
    // SUBACCOUNT GENERATION
    // ============================================
    
    /// Generate a deterministic subaccount from a principal and an ID (offer_id or bid_id)
    /// This creates a unique escrow subaccount for each user+offer or user+bid combination
    public func generateEscrowSubaccount(principal : Principal, id : Nat) : Blob {
        let principalBlob = Principal.toBlob(principal);
        let idBytes = natToBytes(id);
        
        // Combine principal and id
        let combined = Array.append<Nat8>(Blob.toArray(principalBlob), idBytes);
        
        // Hash to get 32 bytes
        let hash = Crypto.sha256(combined);
        Blob.fromArray(hash);
    };
    
    /// Generate subaccount for offer escrow (for ICRC1 tokens in offer)
    public func offerEscrowSubaccount(creator : Principal, offerId : T.OfferId) : Blob {
        let prefix : [Nat8] = [0x4F, 0x46, 0x46, 0x45, 0x52]; // "OFFER"
        let principalBlob = Principal.toBlob(creator);
        let idBytes = natToBytes(offerId);
        
        let combined = Array.flatten<Nat8>([prefix, Blob.toArray(principalBlob), idBytes]);
        let hash = Crypto.sha256(combined);
        Blob.fromArray(hash);
    };
    
    /// Generate subaccount for bid escrow (for ICRC1 tokens in bid)
    public func bidEscrowSubaccount(bidder : Principal, bidId : T.BidId) : Blob {
        let prefix : [Nat8] = [0x42, 0x49, 0x44]; // "BID"
        let principalBlob = Principal.toBlob(bidder);
        let idBytes = natToBytes(bidId);
        
        let combined = Array.flatten<Nat8>([prefix, Blob.toArray(principalBlob), idBytes]);
        let hash = Crypto.sha256(combined);
        Blob.fromArray(hash);
    };
    
    // ============================================
    // BYTE CONVERSION UTILITIES
    // ============================================
    
    /// Convert a Nat to bytes (big-endian, variable length)
    public func natToBytes(n : Nat) : [Nat8] {
        if (n == 0) return [0];
        
        let buffer = Buffer.Buffer<Nat8>(8);
        var value = n;
        
        while (value > 0) {
            buffer.add(Nat8.fromNat(value % 256));
            value := value / 256;
        };
        
        // Reverse for big-endian
        Array.reverse(Buffer.toArray(buffer));
    };
    
    /// Convert Nat to 8 bytes (big-endian, fixed size)
    public func natToBytes8(n : Nat) : [Nat8] {
        let bytes = natToBytes(n);
        let padding = 8 - bytes.size() : Nat;
        if (padding > 0) {
            Array.append(Array.tabulate<Nat8>(padding, func(_ : Nat) : Nat8 { 0 }), bytes);
        } else {
            bytes;
        };
    };
    
    /// Convert bytes to Nat (big-endian)
    public func bytesToNat(bytes : [Nat8]) : Nat {
        var result : Nat = 0;
        for (byte in bytes.vals()) {
            result := result * 256 + Nat8.toNat(byte);
        };
        result;
    };
    
    // ============================================
    // PRINCIPAL UTILITIES
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
    // SNS NEURON PERMISSION UTILITIES
    // ============================================
    
    /// Check if a permission list contains all owner permissions
    public func hasFullOwnerPermissions(permissions : [Int32]) : Bool {
        for (required in T.FULL_OWNER_PERMISSIONS.vals()) {
            var found = false;
            for (p in permissions.vals()) {
                if (p == required) {
                    found := true;
                };
            };
            if (not found) return false;
        };
        true;
    };
    
    /// Get principals with full owner permissions from a neuron's permission list
    public func getOwnerPrincipals(permissions : [T.NeuronPermission]) : [Principal] {
        let buffer = Buffer.Buffer<Principal>(4);
        
        for (perm in permissions.vals()) {
            switch (perm.principal) {
                case (?p) {
                    if (hasFullOwnerPermissions(perm.permission_type)) {
                        buffer.add(p);
                    };
                };
                case null {};
            };
        };
        
        Buffer.toArray(buffer);
    };
    
    // ============================================
    // VALIDATION UTILITIES
    // ============================================
    
    /// Validate an offer has either buyout or expiration (or both)
    public func validateOfferPricing(
        _minBid : ?Nat,
        buyout : ?Nat,
        expiration : ?Int
    ) : Bool {
        switch (buyout, expiration) {
            case (null, null) { false }; // Must have at least one
            case (_, _) { true };
        };
    };
    
    /// Calculate the effective minimum bid for an offer
    public func effectiveMinBid(minBid : ?Nat, buyout : ?Nat) : Nat {
        switch (minBid) {
            case (?min) { min };
            case null {
                switch (buyout) {
                    case (?b) { b };
                    case null { 0 }; // Should not happen if validated
                };
            };
        };
    };
    
    // ============================================
    // ARRAY UTILITIES
    // ============================================
    
    /// Update an element in an array by index
    public func updateAt<T>(arr : [T], index : Nat, newValue : T) : [T] {
        Array.tabulate<T>(arr.size(), func(i : Nat) : T {
            if (i == index) { newValue } else { arr[i] };
        });
    };
    
    /// Find index of element matching predicate
    public func findIndex<T>(arr : [T], predicate : (T) -> Bool) : ?Nat {
        for (i in Iter.range(0, arr.size() - 1)) {
            if (predicate(arr[i])) return ?i;
        };
        null;
    };
    
    // ============================================
    // TIME UTILITIES
    // ============================================
    
    /// Check if a time has passed (is in the past)
    public func isPast(time : Int, now : Int) : Bool {
        time < now;
    };
    
    /// Check if an offer has expired
    public func isExpired(expiration : ?Int, now : Int) : Bool {
        switch (expiration) {
            case (?exp) { isPast(exp, now) };
            case null { false };
        };
    };
};

