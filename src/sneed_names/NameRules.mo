import Buffer "mo:base/Buffer";
import Iter "mo:base/Iter";
import Text "mo:base/Text";

/// The rules every public name and nickname follows (spec/sneed_names.md §3.1, §3.2).
module {
  public let MAX_LENGTH : Nat = 32;

  /// At most this many word starts of a name go into the search index.
  public let MAX_WORDS : Nat = 8;

  public func isSeparator(c : Char) : Bool = c == ' ' or c == '-' or c == '_' or c == '.' or c == '\'';

  public func isAlphanumeric(c : Char) : Bool = (c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9');

  /// Why a name is refused, in words a user can act on; null when it is valid.
  /// `min` is the shortest length allowed (1 for people and neurons, 2 for canisters).
  public func problem(name : Text, min : Nat) : ?Text {
    let n = name.size();
    if (n < min) return ?("Name must be at least " # debug_show (min) # " character" # (if (min == 1) "" else "s"));
    if (n > MAX_LENGTH) return ?("Name must be at most " # debug_show (MAX_LENGTH) # " characters");
    var hasAlnum = false;
    var prev : ?Char = null;
    var i = 0;
    for (c in name.chars()) {
      if (isAlphanumeric(c)) { hasAlnum := true } else if (not isSeparator(c)) {
        return ?"Names may contain only letters a-z, digits, spaces, hyphens, underscores, dots and apostrophes";
      };
      if (c == ' ') {
        if (i == 0 or i + 1 == n) return ?"Names may not start or end with a space";
        if (prev == ?' ') return ?"Names may not contain two spaces in a row";
      };
      prev := ?c;
      i += 1;
    };
    if (not hasAlnum) return ?"Names must contain at least one letter or digit";
    null;
  };

  /// The form names are unique by: lowercase (names are ASCII).
  public func normalize(name : Text) : Text = Text.toLowercase(name);

  /// A search prefix as typed: lowercased, runs of spaces collapsed, leading spaces dropped
  /// (a trailing space is kept, so "sneed " finds "sneed whale" but not "sneedy").
  public func normalizePrefix(prefix : Text) : Text {
    let out = Buffer.Buffer<Char>(prefix.size());
    var lastSpace = true;
    for (c in Text.toLowercase(prefix).chars()) {
      if (c == ' ') {
        if (not lastSpace) out.add(c);
        lastSpace := true;
      } else {
        out.add(c);
        lastSpace := false;
      };
    };
    Text.fromIter(out.vals());
  };

  /// The suffixes of a normalized name that start at a word: the whole name first, then the
  /// text from each later word start ("big-whale x" → "big-whale x", "whale x", "x").
  /// At most MAX_WORDS.
  public func wordSuffixes(normalized : Text) : [Text] {
    let chars = Iter.toArray(normalized.chars());
    let out = Buffer.Buffer<Text>(4);
    var i = 0;
    while (i < chars.size() and out.size() < MAX_WORDS) {
      let startsWord = not isSeparator(chars[i]) and (i == 0 or isSeparator(chars[i - 1]));
      if (startsWord) {
        out.add(Text.fromIter(Iter.map<Nat, Char>(Iter.range(i, chars.size() - 1), func(j) = chars[j])));
      };
      i += 1;
    };
    Buffer.toArray(out);
  };

  /// True when `t` starts with `p`.
  public func startsWith(t : Text, p : Text) : Bool = Text.startsWith(t, #text p);
};
