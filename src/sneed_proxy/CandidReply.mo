import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Int "mo:base/Int";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Text "mo:base/Text";

/// Reads the top level of a Candid reply, enough to tell `ok` from `err` (spec/sneed_proxy.md §3.5).
///
/// Many admin methods report a refusal as a reply (`#err`, `#Err`, `#err(#NotAuthorized)`) rather
/// than a trap. For allowlist entries with `reply = #result`, the proxy reads:
///   - the magic bytes and the type table (skipping every entry it does not need),
///   - the number of reply values and the type of the first one,
///   - when the reply is a single value of a variant type: the tag of that value.
/// A tag whose field name hashes to `ok`/`Ok` is success, `err`/`Err` is failure, and an `err`
/// with a `text` payload carries that text as the message. Any other shape (several values, a
/// record, a number, a variant with other tags, bytes it cannot parse) counts as success: the
/// reply bytes are logged so anyone can decode them. This is not a general Candid decoder.
module {

  public type Outcome = {
    #ok;
    #err : ?Text; // the err payload when it is text
  };

  /// Candid field-name hash: h = h * 223 + byte (mod 2^32) over the UTF-8 bytes.
  public func idlHash(t : Text) : Nat32 {
    var h : Nat32 = 0;
    for (b in Text.encodeUtf8(t).vals()) h := h *% 223 +% Nat32.fromNat(Nat8.toNat(b));
    h;
  };

  func isTag(h : Nat, names : [Text]) : Bool {
    for (n in names.vals()) if (h == Nat32.toNat(idlHash(n))) return true;
    false;
  };

  let TEXT_TYPE : Int = -15; // 0x71

  // Type table opcodes (SLEB128 values)
  let OPT : Int = -18;
  let VEC : Int = -19;
  let RECORD : Int = -20;
  let VARIANT : Int = -21;
  let FUNC : Int = -22;
  let SERVICE : Int = -23;

  // Hard bounds so a hostile reply cannot make the reader loop for long.
  let MAX_TABLE : Nat = 10_000;
  let MAX_FIELDS : Nat = 10_000;

  type Reader = { bytes : [Nat8]; var pos : Nat };

  func byte(r : Reader) : ?Nat8 {
    if (r.pos >= r.bytes.size()) return null;
    let b = r.bytes[r.pos];
    r.pos += 1;
    ?b;
  };

  func leb(r : Reader) : ?Nat {
    var n : Nat = 0;
    var shift : Nat = 0;
    loop {
      let b = switch (byte(r)) { case (?b) Nat8.toNat(b); case null return null };
      n += (b % 128) * (2 ** shift);
      if (b < 128) return ?n;
      shift += 7;
      if (shift > 63) return null; // longer than any length or hash we accept
    };
  };

  func sleb(r : Reader) : ?Int {
    var n : Int = 0;
    var shift : Nat = 0;
    loop {
      let b = switch (byte(r)) { case (?b) Nat8.toNat(b); case null return null };
      n += (b % 128) * (2 ** shift);
      shift += 7;
      if (b < 128) {
        if (b >= 64) n -= 2 ** shift; // sign bit of the last group
        return ?n;
      };
      if (shift > 63) return null;
    };
  };

  func skip(r : Reader, n : Nat) : Bool {
    if (r.pos + n > r.bytes.size()) return false;
    r.pos += n;
    true;
  };

  /// The variant fields of each type table entry (null for entries that are not variants), or
  /// null when the table cannot be read.
  func readTable(r : Reader) : ?[?[(Nat, Int)]] {
    let n = switch (leb(r)) { case (?n) n; case null return null };
    if (n > MAX_TABLE) return null;
    let table = Array.init<?[(Nat, Int)]>(n, null);
    var i = 0;
    while (i < n) {
      let op = switch (sleb(r)) { case (?o) o; case null return null };
      if (op == OPT or op == VEC) {
        if (sleb(r) == null) return null;
      } else if (op == RECORD or op == VARIANT) {
        let k = switch (leb(r)) { case (?k) k; case null return null };
        if (k > MAX_FIELDS) return null;
        let fields = Array.init<(Nat, Int)>(k, (0, 0));
        var j = 0;
        while (j < k) {
          let h = switch (leb(r)) { case (?h) h; case null return null };
          let t = switch (sleb(r)) { case (?t) t; case null return null };
          fields[j] := (h, t);
          j += 1;
        };
        if (op == VARIANT) table[i] := ?Array.freeze(fields);
      } else if (op == FUNC) {
        var part = 0;
        while (part < 2) {
          let k = switch (leb(r)) { case (?k) k; case null return null };
          if (k > MAX_FIELDS) return null;
          var j = 0;
          while (j < k) { if (sleb(r) == null) return null; j += 1 };
          part += 1;
        };
        let a = switch (leb(r)) { case (?a) a; case null return null };
        if (not skip(r, a)) return null;
      } else if (op == SERVICE) {
        let k = switch (leb(r)) { case (?k) k; case null return null };
        if (k > MAX_FIELDS) return null;
        var j = 0;
        while (j < k) {
          let len = switch (leb(r)) { case (?l) l; case null return null };
          if (not skip(r, len)) return null;
          if (sleb(r) == null) return null;
          j += 1;
        };
      } else {
        return null; // an opcode this reader does not know
      };
      i += 1;
    };
    ?Array.freeze(table);
  };

  /// Classify a reply (Candid-encoded reply bytes) as success or failure.
  public func classify(reply : Blob) : Outcome {
    let r : Reader = { bytes = Blob.toArray(reply); var pos = 0 };
    let b = r.bytes;
    if (b.size() < 4 or b[0] != 0x44 or b[1] != 0x49 or b[2] != 0x44 or b[3] != 0x4C) return #ok;
    r.pos := 4;
    let table = switch (readTable(r)) { case (?t) t; case null return #ok };
    let nargs = switch (leb(r)) { case (?n) n; case null return #ok };
    if (nargs != 1) return #ok;
    let t = switch (sleb(r)) { case (?t) t; case null return #ok };
    if (t < 0) return #ok; // a primitive type
    let idx = Int.abs(t);
    if (idx >= table.size()) return #ok;
    let fields = switch (table[idx]) { case (?f) f; case null return #ok }; // not a variant
    let tag = switch (leb(r)) { case (?n) n; case null return #ok };
    if (tag >= fields.size()) return #ok;
    let (h, ft) = fields[tag];
    if (isTag(h, ["ok", "Ok"])) return #ok;
    if (not isTag(h, ["err", "Err"])) return #ok;
    if (ft != TEXT_TYPE) return #err(null);
    let len = switch (leb(r)) { case (?n) n; case null return #err(null) };
    if (r.pos + len > b.size()) return #err(null);
    let bytes = Array.tabulate<Nat8>(len, func(i) = b[r.pos + i]);
    #err(Text.decodeUtf8(Blob.fromArray(bytes)));
  };
};
