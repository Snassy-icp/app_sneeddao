import HashMap "mo:base/HashMap";
import Text "mo:base/Text";
import Principal "mo:base/Principal";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Iter "mo:base/Iter";

/// Per-caller rate limits for update methods anyone can call (posting, sending, creating).
///
/// A token bucket per (caller, action): `capacity` calls at once, refilled at `per_minute` calls a
/// minute. State is transient on purpose: an upgrade gives everyone a full bucket, which is fine.
///
/// Use it twice, like the ingress guard's other checks:
/// - in `system func inspect`, `allows` refuses a caller whose bucket is empty, before the call
///   runs (inspect can't change state, so it only peeks);
/// - in the method, `take` consumes a token and refuses when there is none. This is the real
///   check: inspect runs on one replica and doesn't see calls from other canisters.
module {
  public type Rule = { capacity : Nat; per_minute : Nat };

  type Bucket = { var milli : Nat; var at : Int; rule : Rule }; // tokens × 1000, last refill time (ns), its rule

  let MINUTE_NS : Int = 60_000_000_000;

  public class Limiter() {
    let buckets = HashMap.HashMap<Text, Bucket>(64, Text.equal, Text.hash);

    func key(p : Principal, action : Text) : Text = Principal.toText(p) # "/" # action;

    // milli-tokens in the bucket at `now`, refilled since its last update, capped at capacity
    func level(b : Bucket, rule : Rule, now : Int) : Nat {
      let elapsed = if (now > b.at) Int.abs(now - b.at) else 0;
      let refill = elapsed * rule.per_minute * 1000 / Int.abs(MINUTE_NS);
      Nat.min(b.milli + refill, rule.capacity * 1000);
    };

    /// Whether `p` may call `action` now (doesn't consume). For inspect.
    public func allows(p : Principal, action : Text, rule : Rule, now : Int) : Bool {
      if (rule.capacity == 0) return true; // a rule with capacity 0 means "no limit"
      switch (buckets.get(key(p, action))) {
        case null true;
        case (?b) level(b, rule, now) >= 1000;
      };
    };

    /// Consumes one call of `action` for `p`; false when the bucket is empty.
    public func take(p : Principal, action : Text, rule : Rule, now : Int) : Bool {
      if (rule.capacity == 0) return true;
      let k = key(p, action);
      let b = switch (buckets.get(k)) {
        case (?b) b;
        case null {
          if (buckets.size() >= 50_000) prune(now);
          let nb : Bucket = { var milli = rule.capacity * 1000; var at = now; rule };
          buckets.put(k, nb);
          nb;
        };
      };
      let l = level(b, rule, now);
      b.at := now;
      if (l < 1000) { b.milli := l; return false };
      b.milli := l - 1000;
      true;
    };

    /// Drops buckets that are full again (their callers have been quiet), bounding memory.
    func prune(now : Int) {
      for ((k, b) in Iter.toArray(buckets.entries()).vals()) {
        if (level(b, b.rule, now) >= b.rule.capacity * 1000) buckets.delete(k);
      };
    };

    public func size() : Nat = buckets.size();
  };
};
