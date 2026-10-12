/// Hashing for the ICRC-3 block log:
///
///  - the representation-independent hash of a `Value` (ICRC-3 section
///    "Value hashing", the same construction as IC request ids)
///  - IC hash trees (hashing and CBOR encoding) for the tip certificate
///  - LEB128 encoders used by both
///
/// Pure functions only; nothing here traps on well-formed input.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import Sha256 "mo:sha2/Sha256";

import T "Types";

module {

  public type Value = T.Value;

  // -------------------------------------------------------------------------
  // LEB128
  // -------------------------------------------------------------------------

  /// Unsigned LEB128 encoding of a natural number.
  public func leb128(n : Nat) : [Nat8] {
    let out = Buffer.Buffer<Nat8>(10);
    var v = n;
    loop {
      let byte = Nat8.fromNat(v % 128);
      v := v / 128;
      if (v == 0) {
        out.add(byte);
        return Buffer.toArray(out);
      };
      out.add(byte | 0x80);
    };
  };

  /// Signed LEB128 encoding of an integer.
  public func sleb128(i : Int) : [Nat8] {
    let out = Buffer.Buffer<Nat8>(10);
    var v = i;
    loop {
      // floor division by 128 and the matching non-negative remainder
      var q = v / 128;
      var r = v % 128;
      if (r < 0) { q -= 1; r += 128 };
      let byte = Nat8.fromNat(Int.abs(r));
      v := q;
      let signBit = (byte & 0x40) != 0;
      if ((v == 0 and not signBit) or (v == -1 and signBit)) {
        out.add(byte);
        return Buffer.toArray(out);
      };
      out.add(byte | 0x80);
    };
  };

  // -------------------------------------------------------------------------
  // Representation-independent hash of a Value
  // -------------------------------------------------------------------------

  func sha256(bytes : [Nat8]) : Blob = Sha256.fromArray(#sha256, bytes);

  func encode(v : Value) : [Nat8] {
    switch (v) {
      case (#Blob(b)) { Blob.toArray(b) };
      case (#Text(t)) { Blob.toArray(Text.encodeUtf8(t)) };
      case (#Nat(n)) { leb128(n) };
      case (#Int(i)) { sleb128(i) };
      case (#Array(items)) {
        let out = Buffer.Buffer<Nat8>(32 * items.size());
        for (item in items.vals()) {
          for (byte in Blob.toArray(hashValue(item)).vals()) { out.add(byte) };
        };
        Buffer.toArray(out);
      };
      case (#Map(entries)) {
        // hash(key) ‖ hash(value) per entry, sorted bytewise, concatenated
        let pairs = Array.map<(Text, Value), Blob>(entries, func((k, val)) {
          Blob.fromArray(Array.append(Blob.toArray(hashValue(#Text(k))), Blob.toArray(hashValue(val))));
        });
        let sorted = Array.sort<Blob>(pairs, Blob.compare);
        let out = Buffer.Buffer<Nat8>(64 * sorted.size());
        for (pair in sorted.vals()) {
          for (byte in Blob.toArray(pair).vals()) { out.add(byte) };
        };
        Buffer.toArray(out);
      };
    };
  };

  /// The ICRC-3 hash of a value (32 bytes).
  public func hashValue(v : Value) : Blob {
    sha256(encode(v));
  };

  // -------------------------------------------------------------------------
  // IC hash trees
  // -------------------------------------------------------------------------

  public type HashTree = {
    #empty;
    #fork : (HashTree, HashTree);
    #labeled : (Blob, HashTree);
    #leaf : Blob;
    #pruned : Blob;
  };

  func domainSep(name : Text) : [Nat8] {
    let bytes = Blob.toArray(Text.encodeUtf8(name));
    Array.append([Nat8.fromNat(bytes.size())], bytes);
  };

  /// Root hash of a hash tree, per the IC interface specification.
  public func treeHash(t : HashTree) : Blob {
    switch (t) {
      case (#empty) { sha256(domainSep("ic-hashtree-empty")) };
      case (#fork(l, r)) {
        sha256(Array.flatten<Nat8>([domainSep("ic-hashtree-fork"), Blob.toArray(treeHash(l)), Blob.toArray(treeHash(r))]));
      };
      case (#labeled(lbl, sub)) {
        sha256(Array.flatten<Nat8>([domainSep("ic-hashtree-labeled"), Blob.toArray(lbl), Blob.toArray(treeHash(sub))]));
      };
      case (#leaf(data)) { sha256(Array.append(domainSep("ic-hashtree-leaf"), Blob.toArray(data))) };
      case (#pruned(h)) { h };
    };
  };

  func cborBytes(out : Buffer.Buffer<Nat8>, bytes : [Nat8]) {
    // CBOR major type 2 (byte string)
    let n = bytes.size();
    if (n < 24) {
      out.add(0x40 + Nat8.fromNat(n));
    } else if (n < 256) {
      out.add(0x58);
      out.add(Nat8.fromNat(n));
    } else if (n < 65536) {
      out.add(0x59);
      out.add(Nat8.fromNat(n / 256));
      out.add(Nat8.fromNat(n % 256));
    } else {
      out.add(0x5a);
      out.add(Nat8.fromNat((n / 16777216) % 256));
      out.add(Nat8.fromNat((n / 65536) % 256));
      out.add(Nat8.fromNat((n / 256) % 256));
      out.add(Nat8.fromNat(n % 256));
    };
    for (b in bytes.vals()) { out.add(b) };
  };

  func cborTree(out : Buffer.Buffer<Nat8>, t : HashTree) {
    switch (t) {
      case (#empty) { out.add(0x81); out.add(0x00) };
      case (#fork(l, r)) { out.add(0x83); out.add(0x01); cborTree(out, l); cborTree(out, r) };
      case (#labeled(lbl, sub)) { out.add(0x83); out.add(0x02); cborBytes(out, Blob.toArray(lbl)); cborTree(out, sub) };
      case (#leaf(data)) { out.add(0x82); out.add(0x03); cborBytes(out, Blob.toArray(data)) };
      case (#pruned(h)) { out.add(0x82); out.add(0x04); cborBytes(out, Blob.toArray(h)) };
    };
  };

  /// CBOR encoding of a hash tree with the self-describing tag, as expected in
  /// `DataCertificate.hash_tree`.
  public func treeCbor(t : HashTree) : Blob {
    let out = Buffer.Buffer<Nat8>(128);
    out.add(0xd9); out.add(0xd9); out.add(0xf7); // tag 55799
    cborTree(out, t);
    Blob.fromArray(Buffer.toArray(out));
  };

  /// The ICRC-3 tip tree: `last_block_hash` and `last_block_index` leaves,
  /// labels in lexicographic order.
  public func tipTree(lastIndex : Nat, lastHash : Blob) : HashTree {
    #fork(
      #labeled(Text.encodeUtf8("last_block_hash"), #leaf(lastHash)),
      #labeled(Text.encodeUtf8("last_block_index"), #leaf(Blob.fromArray(leb128(lastIndex))))
    );
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  public func toHex(b : Blob) : Text {
    let digits = "0123456789abcdef";
    let chars = Text.toArray(digits);
    var t = "";
    for (byte in Blob.toArray(b).vals()) {
      let n = Nat8.toNat(byte);
      t := t # Text.fromChar(chars[n / 16]) # Text.fromChar(chars[n % 16]);
    };
    t;
  };
};
