import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import Iter "mo:base/Iter";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Principal "mo:base/Principal";
import Text "mo:base/Text";

/// @-mentions in forum threads and posts (spec/forum_mentions.md). A mention is a Markdown link
/// whose text starts with "@" and whose target is a Sneed Hub principal page:
///
///   [@Mr Sneed](https://app.sneeddao.com/principal?id=tksci-…-aae)
///
/// The name in the link text is only how it reads; the principal in the link is who is meant, so
/// names may contain spaces and a rename never breaks a mention. Every client shows a working
/// link. The forum records who was mentioned where, so they can be told.
module {
  public let MAX_PER_TEXT : Nat = 10; // mentions counted per thread or post
  let MAX_LINK_TEXT : Nat = 64; // characters between "[@" and "]"
  let PREFIXES : [Text] = ["https://app.sneeddao.com/principal?id=", "/principal?id="];

  /// Where someone was mentioned, by whom and when.
  public type Mention = { thread_id : Nat; post_id : ?Nat; by : Principal; at : Int };

  /// The principals mentioned in a text, in order of first appearance, without repeats, at most
  /// MAX_PER_TEXT. Anything that is not a well-formed mention of a valid principal is ignored.
  public func parse(body : Text) : [Principal] {
    let out = Buffer.Buffer<Principal>(4);
    var first = true;
    label scan for (piece in Text.split(body, #text "[@")) {
      if (first) { first := false; continue scan };
      if (out.size() >= MAX_PER_TEXT) break scan;
      // piece = <link text>](<url>)<rest>
      let parts = Iter.toArray(Text.split(piece, #text "]("));
      if (parts.size() < 2 or parts[0].size() == 0 or parts[0].size() > MAX_LINK_TEXT) continue scan;
      if (Text.contains(parts[0], #char ']') or Text.contains(parts[0], #char '\n')) continue scan;
      let url = switch (Text.split(parts[1], #char ')').next()) { case (?u) u; case null continue scan };
      for (prefix in PREFIXES.vals()) {
        switch (Text.stripStart(url, #text prefix)) {
          case (?id) switch (principalOfText(id)) {
            case (?p) if (Buffer.indexOf<Principal>(p, out, Principal.equal) == null) out.add(p);
            case null {};
          };
          case null {};
        };
      };
    };
    Buffer.toArray(out);
  };

  /// The principal a textual id stands for, or null when it is not one (checksum, grouping and
  /// case included). Principal.fromText traps on bad input; this never does.
  public func principalOfText(t : Text) : ?Principal {
    if (t.size() < 7 or t.size() > 63) return null;
    // groups of 5 characters joined by '-', the last group 1-5 characters
    let bits = Buffer.Buffer<Nat8>(40);
    var group = 0;
    for (c in t.chars()) {
      if (c == '-') {
        if (group != 5) return null;
        group := 0;
      } else {
        let v : Nat32 = if (c >= 'a' and c <= 'z') Char.toNat32(c) - 97 else if (c >= '2' and c <= '7') Char.toNat32(c) - 50 + 26 else return null;
        bits.add(Nat8.fromNat(Nat32.toNat(v)));
        group += 1;
        if (group > 5) return null;
      };
    };
    if (group == 0) return null;
    // base32 (RFC 4648, no padding) to bytes
    let bytes = Buffer.Buffer<Nat8>(32);
    var acc : Nat32 = 0;
    var n : Nat32 = 0;
    for (v in bits.vals()) {
      acc := ((acc << 5) | Nat32.fromNat(Nat8.toNat(v))) & 0x1FFF;
      n += 5;
      if (n >= 8) {
        n -= 8;
        bytes.add(Nat8.fromNat(Nat32.toNat((acc >> n) & 0xFF)));
      };
    };
    if (bytes.size() < 4 or bytes.size() > 33) return null;
    let all = Buffer.toArray(bytes);
    let body = Array.subArray<Nat8>(all, 4, all.size() - 4);
    let c = crc32(body);
    let check : [Nat8] = [Nat8.fromNat(Nat32.toNat((c >> 24) & 0xFF)), Nat8.fromNat(Nat32.toNat((c >> 16) & 0xFF)), Nat8.fromNat(Nat32.toNat((c >> 8) & 0xFF)), Nat8.fromNat(Nat32.toNat(c & 0xFF))];
    if (Array.subArray<Nat8>(all, 0, 4) != check) return null;
    let p = Principal.fromBlob(Blob.fromArray(body));
    if (Principal.toText(p) != t) return null; // only the canonical spelling
    ?p;
  };

  func crc32(data : [Nat8]) : Nat32 {
    var crc : Nat32 = 0xFFFFFFFF;
    for (byte in data.vals()) {
      crc ^= Nat32.fromNat(Nat8.toNat(byte));
      var i = 0;
      while (i < 8) {
        crc := if (crc & 1 == 1) (crc >> 1) ^ 0xEDB88320 else crc >> 1;
        i += 1;
      };
    };
    crc ^ 0xFFFFFFFF;
  };

  /// The first characters of a text, for notifications.
  public func excerpt(t : Text, max : Nat) : Text {
    if (t.size() <= max) return t;
    var out = "";
    var i = 0;
    label take for (c in t.chars()) { if (i >= max) break take; out #= Char.toText(c); i += 1 };
    out # "…";
  };
};
