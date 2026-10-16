import Debug "mo:base/Debug";
import Nat "mo:base/Nat";
import OrderedMap "mo:base/OrderedMap";
import Iter "mo:base/Iter";
import Text "mo:base/Text";

import NameRules "../../../src/sneed_names/NameRules";
import NameIndex "../../../src/sneed_names/NameIndex";

func check(ok : Bool, what : Text) { if (not ok) Debug.trap("FAILED: " # what) };

// ---- name rules
check(NameRules.problem("Snassy", 1) == null, "valid name");
check(NameRules.problem("a", 1) == null, "1 char ok for people");
check(NameRules.problem("a", 2) != null, "1 char refused for canisters");
check(NameRules.problem("", 1) != null, "empty refused");
check(NameRules.problem("abcdefghijabcdefghijabcdefghijab", 1) == null, "32 ok");
check(NameRules.problem("abcdefghijabcdefghijabcdefghijabc", 1) != null, "33 refused");
check(NameRules.problem(" x", 1) != null, "leading space");
check(NameRules.problem("x ", 1) != null, "trailing space");
check(NameRules.problem("a  b", 1) != null, "double space");
check(NameRules.problem("a b", 1) == null, "single space");
check(NameRules.problem("--", 1) != null, "no alnum");
check(NameRules.problem("O'Neil_x.y-z", 1) == null, "separators");
check(NameRules.problem("héllo", 1) != null, "non-ascii");
check(NameRules.problem("a<b", 1) != null, "symbols");
check(NameRules.normalize("SnAssy") == "snassy", "normalize");
check(NameRules.normalizePrefix("  Sneed   W") == "sneed w", "prefix collapse");
check(NameRules.normalizePrefix("sneed ") == "sneed ", "prefix keeps trailing space");
check(NameRules.wordSuffixes("big-whale x") == ["big-whale x", "whale x", "x"], "suffixes");
check(NameRules.wordSuffixes("--a") == ["a"], "suffixes after separators");
check(NameRules.wordSuffixes("a b c d e f g h i j").size() == 8, "max words");

// ---- lower-bound iteration against a plain scan, for many sizes
let ops = OrderedMap.Make<Nat>(Nat.compare);
var n = 0;
while (n < 300) {
  var m = ops.empty<Nat>();
  var i = 0;
  while (i < n) { m := ops.put(m, i * 3, i); i += 1 };
  var from = 0;
  while (from < n * 3 + 3) {
    let got = Iter.toArray(Iter.map<(Nat, Nat), Nat>(NameIndex.entriesFrom<Nat, Nat>(m, Nat.compare, from), func(kv) = kv.0));
    let want = Iter.toArray(Iter.filter<Nat>(ops.keys(m), func(k) = k >= from));
    check(got == want, "entriesFrom n=" # Nat.toText(n) # " from=" # Nat.toText(from));
    from += if (n > 50) 7 else 1;
  };
  n += if (n > 40) 37 else 1;
};

// ---- index and search
type R = Nat;
let s = NameIndex.init<R>();
let names = ["Sneed Whale", "Sneedy", "Big-Whale", "snassy", "Whale Watcher", "Alice", "Bob the Whale"];
var id = 0;
for (nm in names.vals()) { NameIndex.add<R>(s, 0, nm, id); id += 1 };
NameIndex.add<R>(s, 1, "Sneed Whale", 100); // other scope
check(NameIndex.size(s) == 8, "size");
check(NameIndex.owner<R>(s, 0, "SNEEDY") == ?1, "owner any case");
check(NameIndex.owner<R>(s, 1, "sneed whale") == ?100, "owner scope 1");
let all = func(_ : R) : Bool = true;
let same = func(a : R, b : R) : Bool = a == b;
func ids(xs : [(R, Text)]) : [Nat] = Iter.toArray(Iter.map<(R, Text), Nat>(xs.vals(), func(x) = x.0));
check(ids(NameIndex.search<R>(s, 0, "sne", 10, all, same)) == [0, 1], "prefix sne");
check(ids(NameIndex.search<R>(s, 0, "whale", 10, all, same)) == [4, 2, 6, 0], "whale: starts first, then words");
check(ids(NameIndex.search<R>(s, 0, "WHA", 2, all, same)) == [4, 2], "limit");
check(ids(NameIndex.search<R>(s, 0, "sneed ", 10, all, same)) == [0], "trailing space");
check(ids(NameIndex.search<R>(s, 0, "zzz", 10, all, same)) == [], "none");
check(ids(NameIndex.search<R>(s, 0, "", 10, all, same)) == [], "empty prefix");
check(ids(NameIndex.search<R>(s, 1, "whale", 10, all, same)) == [100], "scope 1 only");
check(ids(NameIndex.search<R>(s, 0, "whale", 10, func(r : R) : Bool = r != 2, same)) == [4, 6, 0], "keep filter");
NameIndex.remove<R>(s, 0, "BIG-whale");
check(ids(NameIndex.search<R>(s, 0, "whale", 10, all, same)) == [4, 6, 0], "removed");
check(NameIndex.owner<R>(s, 0, "big-whale") == null, "removed owner");
// paging
let (p1, n1) = NameIndex.page<R>(s, 0, null, 2);
check(ids(p1) == [5, 6] and n1 == ?"bob the whale", "page 1");
let (p2, n2) = NameIndex.page<R>(s, 0, n1, 2);
check(ids(p2) == [3, 0] and n2 == ?"sneed whale", "page 2");
let (p3, n3) = NameIndex.page<R>(s, 0, n2, 2);
check(ids(p3) == [1, 4] and n3 == null, "page 3 (last, exactly full)");
let (p4, n4) = NameIndex.page<R>(s, 1, null, 10);
check(ids(p4) == [100] and n4 == null, "scope 1 page");
Debug.print("names.test.mo: all passed");
