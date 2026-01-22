import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Text "mo:base/Text";
import Char "mo:base/Char";
import Buffer "mo:base/Buffer";

import T "Types";

module {
    // ============================================
    // SUBACCOUNT GENERATION
    // ============================================
    
    // Subaccount structure (32 bytes):
    // - Byte 0: principal length
    // - Bytes 1-N: principal bytes  
    // - Bytes 24-31: 8-byte big-endian ID (offer_id or bid_id)
    // - Byte 23: type marker (0x4F = offer, 0x42 = bid)
    // This ensures uniqueness: each offer/bid has unique ID, and type marker prevents collisions
    
    /// Generate subaccount for user payments (offer creation fees)
    /// Simple: just the principal bytes padded to 32 bytes
    public func userPaymentSubaccount(user : Principal) : Blob {
        let a = Array.init<Nat8>(32, 0);
        let pa = Principal.toBlob(user);
        let size = pa.size();
        
        // Byte 0: principal length
        a[0] := Nat8.fromNat(size);
        
        // Bytes 1-N: principal bytes
        var pos = 1;
        for (x in pa.vals()) {
            a[pos] := x;
            pos += 1;
        };
        
        // Byte 23: type marker for payment
        a[23] := 0x50; // 'P' for Payment
        
        Blob.fromArray(Array.freeze(a));
    };
    
    /// Generate subaccount for offer escrow (for ICRC1 tokens in offer)
    public func offerEscrowSubaccount(creator : Principal, offerId : T.OfferId) : Blob {
        let a = Array.init<Nat8>(32, 0);
        let pa = Principal.toBlob(creator);
        let size = pa.size();
        
        // Byte 0: principal length
        a[0] := Nat8.fromNat(size);
        
        // Bytes 1-N: principal bytes
        var pos = 1;
        for (x in pa.vals()) {
            a[pos] := x;
            pos += 1;
        };
        
        // Byte 23: type marker for offer
        a[23] := 0x4F; // 'O'
        
        // Bytes 24-31: offer ID as big-endian Nat64
        let id64 = Nat64.fromNat(offerId);
        a[24] := Nat8.fromNat(Nat64.toNat((id64 >> 56) & 0xFF));
        a[25] := Nat8.fromNat(Nat64.toNat((id64 >> 48) & 0xFF));
        a[26] := Nat8.fromNat(Nat64.toNat((id64 >> 40) & 0xFF));
        a[27] := Nat8.fromNat(Nat64.toNat((id64 >> 32) & 0xFF));
        a[28] := Nat8.fromNat(Nat64.toNat((id64 >> 24) & 0xFF));
        a[29] := Nat8.fromNat(Nat64.toNat((id64 >> 16) & 0xFF));
        a[30] := Nat8.fromNat(Nat64.toNat((id64 >> 8) & 0xFF));
        a[31] := Nat8.fromNat(Nat64.toNat(id64 & 0xFF));
        
        Blob.fromArray(Array.freeze(a));
    };
    
    /// Generate subaccount for bid escrow (for ICRC1 tokens in bid)
    public func bidEscrowSubaccount(bidder : Principal, bidId : T.BidId) : Blob {
        let a = Array.init<Nat8>(32, 0);
        let pa = Principal.toBlob(bidder);
        let size = pa.size();
        
        // Byte 0: principal length
        a[0] := Nat8.fromNat(size);
        
        // Bytes 1-N: principal bytes
        var pos = 1;
        for (x in pa.vals()) {
            a[pos] := x;
            pos += 1;
        };
        
        // Byte 23: type marker for bid
        a[23] := 0x42; // 'B'
        
        // Bytes 24-31: bid ID as big-endian Nat64
        let id64 = Nat64.fromNat(bidId);
        a[24] := Nat8.fromNat(Nat64.toNat((id64 >> 56) & 0xFF));
        a[25] := Nat8.fromNat(Nat64.toNat((id64 >> 48) & 0xFF));
        a[26] := Nat8.fromNat(Nat64.toNat((id64 >> 40) & 0xFF));
        a[27] := Nat8.fromNat(Nat64.toNat((id64 >> 32) & 0xFF));
        a[28] := Nat8.fromNat(Nat64.toNat((id64 >> 24) & 0xFF));
        a[29] := Nat8.fromNat(Nat64.toNat((id64 >> 16) & 0xFF));
        a[30] := Nat8.fromNat(Nat64.toNat((id64 >> 8) & 0xFF));
        a[31] := Nat8.fromNat(Nat64.toNat(id64 & 0xFF));
        
        Blob.fromArray(Array.freeze(a));
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
    
    /// Get ALL principals from a neuron's permission list (regardless of permission level)
    public func getAllPrincipals(permissions : [T.NeuronPermission]) : [Principal] {
        let seen = Buffer.Buffer<Principal>(8);
        
        for (perm in permissions.vals()) {
            switch (perm.principal) {
                case (?p) {
                    // Check if already added (avoid duplicates)
                    var found = false;
                    for (existing in seen.vals()) {
                        if (Principal.equal(existing, p)) {
                            found := true;
                        };
                    };
                    if (not found) {
                        seen.add(p);
                    };
                };
                case null {};
            };
        };
        
        Buffer.toArray(seen);
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

