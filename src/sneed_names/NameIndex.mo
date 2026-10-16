import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Iter "mo:base/Iter";
import Nat32 "mo:base/Nat32";
import Order "mo:base/Order";
import OrderedMap "mo:base/OrderedMap";
import Text "mo:base/Text";

import NameRules "NameRules";

/// The unique-name index and the search index of a naming canister (spec/sneed_names.md §3.2, §3.3).
///
/// Keys carry a `scope` so one index can hold several name spaces: `sneed_pid_names` uses scope 0
/// for everything, `sneed_neuron_names` uses the deduplicated SNS root index (names are unique
/// per SNS). `R` is the canister's reference to the owner of a name.
///
/// Both maps are red-black trees from `mo:base/OrderedMap`; `entriesFrom` adds the lower-bound
/// seek that prefix search needs (the library has no range iteration).
module {
  public type UniqueKey = (Nat32, Text); // (scope, normalized name)
  public type WordKey = (Nat32, Text, Text); // (scope, suffix from a later word start, normalized name)

  public type State<R> = {
    var unique : OrderedMap.Map<UniqueKey, R>;
    var words : OrderedMap.Map<WordKey, R>;
  };

  public func compareUnique(a : UniqueKey, b : UniqueKey) : Order.Order {
    switch (Nat32.compare(a.0, b.0)) {
      case (#equal) Text.compare(a.1, b.1);
      case o o;
    };
  };

  public func compareWord(a : WordKey, b : WordKey) : Order.Order {
    switch (Nat32.compare(a.0, b.0)) {
      case (#equal) switch (Text.compare(a.1, b.1)) {
        case (#equal) Text.compare(a.2, b.2);
        case o o;
      };
      case o o;
    };
  };

  // OrderedMap operations are objects, which a module cannot hold; they are cheap to make.
  func uniqueOps() : OrderedMap.Operations<UniqueKey> = OrderedMap.Make<UniqueKey>(compareUnique);
  func wordOps() : OrderedMap.Operations<WordKey> = OrderedMap.Make<WordKey>(compareWord);

  public func init<R>() : State<R> = {
    var unique = uniqueOps().empty<R>();
    var words = wordOps().empty<R>();
  };

  public func size<R>(s : State<R>) : Nat = uniqueOps().size(s.unique);

  /// The owner of a name (any capitals) in a scope.
  public func owner<R>(s : State<R>, scope : Nat32, name : Text) : ?R = uniqueOps().get(s.unique, (scope, NameRules.normalize(name)));

  /// Index a name. The caller has checked that the normalized name is free (or owned by `ref`).
  public func add<R>(s : State<R>, scope : Nat32, name : Text, ref : R) {
    let norm = NameRules.normalize(name);
    s.unique := uniqueOps().put(s.unique, (scope, norm), ref);
    let suffixes = NameRules.wordSuffixes(norm);
    var i = 1; // the whole name (suffix 0) is the unique key itself
    while (i < suffixes.size()) {
      s.words := wordOps().put(s.words, (scope, suffixes[i], norm), ref);
      i += 1;
    };
  };

  /// Remove a name from the index (no-op when absent).
  public func remove<R>(s : State<R>, scope : Nat32, name : Text) {
    let norm = NameRules.normalize(name);
    s.unique := uniqueOps().delete(s.unique, (scope, norm));
    let suffixes = NameRules.wordSuffixes(norm);
    var i = 1;
    while (i < suffixes.size()) {
      s.words := wordOps().delete(s.words, (scope, suffixes[i], norm));
      i += 1;
    };
  };

  public let MAX_SEARCH_RESULTS : Nat = 50;
  /// Entries a search may walk past (duplicates and filtered-out owners) before it stops.
  public let MAX_SEARCH_STEPS : Nat = 2_000;

  /// Names in `scope` that start with `prefix`, then names with a later word starting with it.
  /// `keep` filters owners (e.g. accounts only); `same` recognises an owner already returned.
  /// Returns (owner, normalized name) pairs, at most `limit` (capped at MAX_SEARCH_RESULTS).
  public func search<R>(
    s : State<R>,
    scope : Nat32,
    prefix : Text,
    limit : Nat,
    keep : R -> Bool,
    same : (R, R) -> Bool,
  ) : [(R, Text)] {
    let p = NameRules.normalizePrefix(prefix);
    let max = if (limit > MAX_SEARCH_RESULTS) MAX_SEARCH_RESULTS else limit;
    let out = Buffer.Buffer<(R, Text)>(max);
    if (max == 0 or p == "") return [];
    var steps = 0;
    let seen = func(r : R) : Bool {
      for ((o, _) in out.vals()) { if (same(o, r)) return true };
      false;
    };
    // 1. names starting with the prefix
    label first for (((sc, norm), r) in entriesFrom<UniqueKey, R>(s.unique, compareUnique, (scope, p))) {
      if (out.size() >= max or steps >= MAX_SEARCH_STEPS) break first;
      if (sc != scope or not NameRules.startsWith(norm, p)) break first;
      steps += 1;
      if (keep(r)) out.add((r, norm));
    };
    // 2. names with a later word starting with the prefix
    label second for (((sc, suffix, norm), r) in entriesFrom<WordKey, R>(s.words, compareWord, (scope, p, ""))) {
      if (out.size() >= max or steps >= MAX_SEARCH_STEPS) break second;
      if (sc != scope or not NameRules.startsWith(suffix, p)) break second;
      steps += 1;
      if (keep(r) and not seen(r)) out.add((r, norm));
    };
    Buffer.toArray(out);
  };

  /// The names of a scope in alphabetical (normalized) order, after `startAfter`.
  public func page<R>(s : State<R>, scope : Nat32, startAfter : ?Text, limit : Nat) : ([(R, Text)], ?Text) {
    let out = Buffer.Buffer<(R, Text)>(limit);
    let from = switch (startAfter) { case null ""; case (?t) t };
    var last : ?Text = null;
    label walk for (((sc, norm), r) in entriesFrom<UniqueKey, R>(s.unique, compareUnique, (scope, from))) {
      if (sc != scope) break walk;
      if (startAfter == ?norm) continue walk;
      if (out.size() >= limit) {
        return (Buffer.toArray(out), last);
      };
      out.add((r, norm));
      last := ?norm;
    };
    (Buffer.toArray(out), null);
  };

  // ---- lower-bound iteration over mo:base/OrderedMap ----

  // The same structural type as OrderedMap's (private) Tree, so a map's root can be walked here.
  type Tree<K, V> = {
    #red : (Tree<K, V>, K, V, Tree<K, V>);
    #black : (Tree<K, V>, K, V, Tree<K, V>);
    #leaf;
  };

  /// The entries with keys >= `from`, in ascending key order. O(log n) to start, O(1) amortised a step.
  public func entriesFrom<K, V>(m : OrderedMap.Map<K, V>, compare : (K, K) -> Order.Order, from : K) : Iter.Iter<(K, V)> {
    // stack of nodes whose key and right subtree are still to be visited
    var stack : [var ?(Tree<K, V>, K, V)] = [var];
    var top = 0;
    let push = func(t : Tree<K, V>, k : K, v : V) {
      if (top == stack.size()) {
        let bigger = Array.init<?(Tree<K, V>, K, V)>(if (top == 0) 64 else top * 2, null);
        var i = 0;
        while (i < top) { bigger[i] := stack[i]; i += 1 };
        stack := bigger;
      };
      stack[top] := ?(t, k, v);
      top += 1;
    };
    // all keys of a subtree are >= from: push its left spine
    let pushAll = func(t0 : Tree<K, V>) {
      var t = t0;
      label down loop {
        switch t {
          case (#leaf) break down;
          case (#red(l, k, v, r) or #black(l, k, v, r)) { push(r, k, v); t := l };
        };
      };
    };
    // seek: push the nodes with key >= from on the path to `from`
    var t : Tree<K, V> = m.root;
    label seek loop {
      switch t {
        case (#leaf) break seek;
        case (#red(l, k, v, r) or #black(l, k, v, r)) {
          switch (compare(k, from)) {
            case (#less) { t := r };
            case _ { push(r, k, v); t := l };
          };
        };
      };
    };
    object {
      public func next() : ?(K, V) {
        if (top == 0) return null;
        top -= 1;
        switch (stack[top]) {
          case null null;
          case (?(r, k, v)) {
            stack[top] := null;
            pushAll(r);
            ?(k, v);
          };
        };
      };
    };
  };
};
