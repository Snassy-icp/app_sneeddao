import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";

module {
    // SHA-256 initial hash values
    let SHA256_H: [Nat32] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    // SHA-256 round constants
    let K: [Nat32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    /// Rotate right for 32-bit values
    func rotr32(x: Nat32, n: Nat32): Nat32 {
        (x >> n) | (x << (32 - n));
    };

    /// Pad message according to SHA-256 specification
    func padMessage(data: [Nat8]): [Nat8] {
        let dataLen = data.size();
        let bitLen : Nat64 = Nat64.fromNat(dataLen * 8);
        
        // Message needs to be padded to 512 bits (64 bytes) boundary
        // After adding 1 bit and length (8 bytes), find next multiple of 64
        var paddedLen = dataLen + 1 + 8;
        while (paddedLen % 64 != 0) {
            paddedLen += 1;
        };
        
        let padded = Array.init<Nat8>(paddedLen, 0);
        
        // Copy original data
        var i = 0;
        while (i < dataLen) {
            padded[i] := data[i];
            i += 1;
        };
        
        // Append 1 bit (0x80)
        padded[dataLen] := 0x80;
        
        // Append length as 64-bit big-endian
        let lenPos : Nat = paddedLen - 8;
        padded[lenPos + 0] := Nat8.fromNat(Nat64.toNat((bitLen >> 56) & 0xFF));
        padded[lenPos + 1] := Nat8.fromNat(Nat64.toNat((bitLen >> 48) & 0xFF));
        padded[lenPos + 2] := Nat8.fromNat(Nat64.toNat((bitLen >> 40) & 0xFF));
        padded[lenPos + 3] := Nat8.fromNat(Nat64.toNat((bitLen >> 32) & 0xFF));
        padded[lenPos + 4] := Nat8.fromNat(Nat64.toNat((bitLen >> 24) & 0xFF));
        padded[lenPos + 5] := Nat8.fromNat(Nat64.toNat((bitLen >> 16) & 0xFF));
        padded[lenPos + 6] := Nat8.fromNat(Nat64.toNat((bitLen >> 8) & 0xFF));
        padded[lenPos + 7] := Nat8.fromNat(Nat64.toNat(bitLen & 0xFF));
        
        Array.freeze(padded);
    };

    /// Compute SHA-256 hash
    public func sha256(data: [Nat8]): [Nat8] {
        let paddedData = padMessage(data);
        var h = Array.thaw<Nat32>(SHA256_H);
        
        let numBlocks = paddedData.size() / 64;
        var blockIdx = 0;
        
        while (blockIdx < numBlocks) {
            let blockStart = blockIdx * 64;
            
            var w = Array.init<Nat32>(64, 0);
            
            // Prepare message schedule
            var i = 0;
            while (i < 16) {
                let byteIdx = blockStart + i * 4;
                w[i] := (Nat32.fromNat(Nat8.toNat(paddedData[byteIdx])) << 24) |
                        (Nat32.fromNat(Nat8.toNat(paddedData[byteIdx + 1])) << 16) |
                        (Nat32.fromNat(Nat8.toNat(paddedData[byteIdx + 2])) << 8) |
                        Nat32.fromNat(Nat8.toNat(paddedData[byteIdx + 3]));
                i += 1;
            };
            
            while (i < 64) {
                let s0 = rotr32(w[i-15], 7) ^ rotr32(w[i-15], 18) ^ (w[i-15] >> 3);
                let s1 = rotr32(w[i-2], 17) ^ rotr32(w[i-2], 19) ^ (w[i-2] >> 10);
                w[i] := w[i-16] +% s0 +% w[i-7] +% s1;
                i += 1;
            };
            
            // Initialize working variables
            var a = h[0];
            var b = h[1];
            var c = h[2];
            var d = h[3];
            var e = h[4];
            var f = h[5];
            var g = h[6];
            var hh = h[7];
            
            // Main loop
            i := 0;
            while (i < 64) {
                let S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
                let ch = (e & f) ^ ((^e) & g);
                let temp1 = hh +% S1 +% ch +% K[i] +% w[i];
                let S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
                let maj = (a & b) ^ (a & c) ^ (b & c);
                let temp2 = S0 +% maj;
                
                hh := g;
                g := f;
                f := e;
                e := d +% temp1;
                d := c;
                c := b;
                b := a;
                a := temp1 +% temp2;
                i += 1;
            };
            
            // Add compressed chunk to current hash value
            h[0] +%= a;
            h[1] +%= b;
            h[2] +%= c;
            h[3] +%= d;
            h[4] +%= e;
            h[5] +%= f;
            h[6] +%= g;
            h[7] +%= hh;
            
            blockIdx += 1;
        };
        
        // Produce final hash value (32 bytes)
        let result = Buffer.Buffer<Nat8>(32);
        var wordIdx = 0;
        while (wordIdx < 8) {
            result.add(Nat8.fromNat(Nat32.toNat((h[wordIdx] >> 24) & 0xFF)));
            result.add(Nat8.fromNat(Nat32.toNat((h[wordIdx] >> 16) & 0xFF)));
            result.add(Nat8.fromNat(Nat32.toNat((h[wordIdx] >> 8) & 0xFF)));
            result.add(Nat8.fromNat(Nat32.toNat(h[wordIdx] & 0xFF)));
            wordIdx += 1;
        };
        
        Buffer.toArray(result);
    };
};

