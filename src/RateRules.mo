import Array "mo:base/Array";
import Nat "mo:base/Nat";
import RateLimit "RateLimit";

/// Admin-settable rules for src/RateLimit.mo, kept by each canister as a stable list of overrides
/// on top of its built-in defaults.
///
/// A canister keeps `var rate_rules : [(Text, RateLimit.Rule)] = []` (stable), a transient
/// `RateLimit.Limiter()`, and a `DEFAULTS` list naming every action it limits. `rule` gives the
/// effective rule for an action, `set` checks and stores an override, `all` lists the effective
/// rules for a getter. A rule with capacity 0 turns the limit off.
module {
  public type Rule = RateLimit.Rule;
  public type Rules = [(Text, Rule)];

  public let MAX_CAPACITY : Nat = 100_000;
  public let MAX_PER_MINUTE : Nat = 100_000;

  func find(rules : Rules, action : Text) : ?Rule = switch (Array.find<(Text, Rule)>(rules, func((a, _)) = a == action)) {
    case (?(_, r)) ?r;
    case null null;
  };

  /// The rule for `action`: the override, else the default, else no limit.
  public func rule(overrides : Rules, defaults : Rules, action : Text) : Rule = switch (find(overrides, action)) {
    case (?r) r;
    case null switch (find(defaults, action)) { case (?r) r; case null ({ capacity = 0; per_minute = 0 }) };
  };

  /// The overrides with `action` set to `r` (null: back to the default), or an error.
  public func set(overrides : Rules, defaults : Rules, action : Text, r : ?Rule) : { #ok : Rules; #err : Text } {
    if (find(defaults, action) == null) return #err("Unknown action \"" # action # "\" (see get_rate_limits)");
    let rest = Array.filter<(Text, Rule)>(overrides, func((a, _)) = a != action);
    switch r {
      case null #ok(rest);
      case (?x) {
        if (x.capacity > MAX_CAPACITY or x.per_minute > MAX_PER_MINUTE) return #err("capacity and per_minute must be at most " # Nat.toText(MAX_CAPACITY));
        if (x.capacity > 0 and x.per_minute == 0) return #err("per_minute must be at least 1 (capacity 0 turns the limit off)");
        #ok(Array.append(rest, [(action, x)]));
      };
    };
  };

  /// Every action with its effective rule.
  public func all(overrides : Rules, defaults : Rules) : Rules = Array.map<(Text, Rule), (Text, Rule)>(defaults, func((a, _)) = (a, rule(overrides, defaults, a)));
};
