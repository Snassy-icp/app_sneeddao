import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Text "mo:base/Text";

/// Emoji reactions on posts and threads (spec/pipeline.md, "Forum reactions, thread tips and votes").
///
/// Each member gives a target (a post, or a thread's own opening text) a small set of emojis, at most
/// MAX_PER_USER, each exactly one emoji: one grapheme cluster, so a ZWJ sequence (👩‍💻), a skin tone
/// (👍🏽), a flag (🇲🇹, 🏴󠁧󠁢󠁳󠁣󠁴󠁿) or a keycap (1️⃣) counts as one. Every target keeps running counts
/// (emoji -> number of members who gave it), changed by the difference between a member's old set and
/// the new one, so reading a target's reactions costs O(distinct emojis), never O(members).
///
/// Only emoji are accepted, not text: a letter, a digit without the keycap mark, whitespace, two
/// emojis side by side and anything over MAX_BYTES bytes are refused.
module {
  public let MAX_PER_USER : Nat = 10; // emojis one member gives one target
  public let MAX_DISTINCT : Nat = 100; // different emojis on one target
  public let MAX_BYTES : Nat = 64; // UTF-8 bytes of one emoji (the longest RGI sequences are ~35)
  let MAX_CODE_POINTS : Nat = 16;

  /// Running counts of one target, in the order the emojis were first given.
  public type Counts = [(Text, Nat)];

  func isRegional(c : Nat32) : Bool = c >= 0x1F1E6 and c <= 0x1F1FF;
  func isSkinTone(c : Nat32) : Bool = c >= 0x1F3FB and c <= 0x1F3FF;
  func isTag(c : Nat32) : Bool = c >= 0xE0020 and c <= 0xE007E;
  let TAG_END : Nat32 = 0xE007F;
  let ZWJ : Nat32 = 0x200D;
  let VS16 : Nat32 = 0xFE0F;
  let VS15 : Nat32 = 0xFE0E;
  let KEYCAP : Nat32 = 0x20E3;
  func isKeycapBase(c : Nat32) : Bool = (c >= 0x30 and c <= 0x39) or c == 0x23 or c == 0x2A; // 0-9 # *

  /// A code point that can start an emoji: the pictographic blocks and the older symbols that have
  /// emoji presentation (©, ®, ‼, ™, arrows, ⌚, ☀…➿, ⤴, ⬅, ⭐, 〰, ㊗…).
  func isEmojiBase(c : Nat32) : Bool {
    if (c >= 0x1F000 and c <= 0x1FAFF) return not isRegional(c) and not isSkinTone(c);
    if (c >= 0x2600 and c <= 0x27BF) return true;
    c == 0x00A9 or c == 0x00AE or c == 0x203C or c == 0x2049 or c == 0x2122 or c == 0x2139
    or (c >= 0x2194 and c <= 0x2199) or c == 0x21A9 or c == 0x21AA
    or c == 0x231A or c == 0x231B or c == 0x2328 or c == 0x23CF or (c >= 0x23E9 and c <= 0x23F3) or (c >= 0x23F8 and c <= 0x23FA)
    or c == 0x24C2 or c == 0x25AA or c == 0x25AB or c == 0x25B6 or c == 0x25C0 or (c >= 0x25FB and c <= 0x25FE)
    or c == 0x2934 or c == 0x2935 or (c >= 0x2B05 and c <= 0x2B07) or c == 0x2B1B or c == 0x2B1C or c == 0x2B50 or c == 0x2B55
    or c == 0x3030 or c == 0x303D or c == 0x3297 or c == 0x3299
  };

  /// Whether `t` is exactly one emoji (one grapheme cluster of emoji), within MAX_BYTES.
  public func isEmoji(t : Text) : Bool {
    if (t.size() == 0 or t.size() > MAX_CODE_POINTS or Text.encodeUtf8(t).size() > MAX_BYTES) return false;
    let cs = Array.map<Char, Nat32>(Text.toArray(t), Char.toNat32);
    let n = cs.size();
    // a flag: two regional indicators
    if (isRegional(cs[0])) return n == 2 and isRegional(cs[1]);
    // a keycap: 0-9 # *, an optional VS16, the combining keycap
    if (isKeycapBase(cs[0])) return (n == 2 and cs[1] == KEYCAP) or (n == 3 and cs[1] == VS16 and cs[2] == KEYCAP);
    // elements joined by ZWJ: base, then an optional variation selector, skin tone, VS16 and tag run
    var i = 0;
    loop {
      if (i >= n or not isEmojiBase(cs[i])) return false;
      i += 1;
      if (i < n and (cs[i] == VS16 or cs[i] == VS15)) i += 1;
      if (i < n and isSkinTone(cs[i])) i += 1;
      if (i < n and cs[i] == VS16) i += 1;
      if (i < n and cs[i] == KEYCAP) i += 1;
      if (i < n and isTag(cs[i])) {
        while (i < n and isTag(cs[i])) i += 1;
        if (i >= n or cs[i] != TAG_END) return false;
        i += 1;
      };
      if (i == n) return true;
      if (cs[i] != ZWJ) return false; // a second cluster, or something that is not an emoji modifier
      i += 1; // the next element must follow the joiner
    };
  };

  /// Checks a member's new set: at most MAX_PER_USER emojis, each one emoji. Repeats are dropped,
  /// the order of first appearance kept.
  public func normalize(emojis : [Text]) : { #ok : [Text]; #err : Text } {
    let out = Buffer.Buffer<Text>(emojis.size());
    for (e in emojis.vals()) {
      if (not isEmoji(e)) return #err("Not a single emoji: \"" # clip(e) # "\"");
      if (not Buffer.contains<Text>(out, e, Text.equal)) out.add(e);
    };
    if (out.size() > MAX_PER_USER) return #err("At most " # Nat.toText(MAX_PER_USER) # " reactions per member");
    #ok(Buffer.toArray(out));
  };

  func clip(t : Text) : Text {
    var s = "";
    var k = 0;
    label l for (c in t.chars()) { if (k >= 16) { s #= "…"; break l }; s #= Char.toText(c); k += 1 };
    s
  };

  func has(xs : [Text], x : Text) : Bool = Array.find<Text>(xs, func(y) = y == x) != null;

  /// The counts after a member changed their set from `old` to `new`, or an error when that would
  /// give the target more than MAX_DISTINCT different emojis. Counts reaching 0 are dropped.
  public func apply(counts : Counts, old : [Text], new : [Text]) : { #ok : Counts; #err : Text } {
    var fresh = 0;
    for (e in new.vals()) if (not has(old, e) and Array.find<(Text, Nat)>(counts, func((k, _)) = k == e) == null) fresh += 1;
    if (fresh > 0 and counts.size() + fresh > MAX_DISTINCT) return #err("This already has " # Nat.toText(counts.size()) # " different reactions, the most there can be; add one of those");
    let out = Buffer.Buffer<(Text, Nat)>(counts.size() + fresh);
    for ((k, c) in counts.vals()) {
      let removed = has(old, k) and not has(new, k);
      let added = has(new, k) and not has(old, k);
      let n : Nat = if (removed) { if (c > 0) c - 1 else 0 } else if (added) c + 1 else c;
      if (n > 0) out.add((k, n));
    };
    for (e in new.vals()) if (not has(old, e) and Array.find<(Text, Nat)>(counts, func((k, _)) = k == e) == null) out.add((e, 1));
    #ok(Buffer.toArray(out));
  };
};
