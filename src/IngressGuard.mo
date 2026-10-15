import Array "mo:base/Array";

/// Helpers for `system func inspect` (the ingress guard of a canister).
///
/// inspect runs on one replica before an ingress update call is accepted, and a call it
/// refuses costs the canister nothing. It guards two things:
/// - Query methods sent as update calls. A query is free as a query call, but as an update call
///   it goes through consensus and the canister pays for it, so anyone could drain cycles by
///   calling queries that way. Canisters calling us are not affected: inspect only sees ingress.
/// - Oversized arguments. Text, Blob, Nat and vectors have no size limit in Candid, so every
///   method caps the raw argument size, and methods taking text compare each text with the
///   canister's own limit (its config, where it has one).
///
/// inspect runs on a single replica, so it is not a security boundary: the methods keep their
/// own checks, and inspect only refuses early what they would refuse anyway.
module {
  /// Raw argument cap for methods whose arguments are ids, numbers, flags and small records.
  /// It also bounds every Nat they take (a Nat of n bytes needs n bytes of argument).
  public let SMALL_ARG : Nat = 4_096;

  /// Raw argument cap for methods taking a few short texts (names, codes, reasons).
  public let MEDIUM_ARG : Nat = 65_536;

  /// Raw argument cap for methods taking texts of at most `chars` characters in all (UTF-8 takes
  /// up to 4 bytes a character).
  public func textArg(chars : Nat) : Nat = SMALL_ARG + 4 * chars;

  /// At most `max` characters.
  public func text(t : Text, max : Nat) : Bool = t.size() <= max;

  /// Absent, or at most `max` characters.
  public func optText(t : ?Text, max : Nat) : Bool = switch (t) {
    case null true;
    case (?s) s.size() <= max;
  };

  /// At most `max` bytes.
  public func blob(b : Blob, max : Nat) : Bool = b.size() <= max;

  /// Absent, or at most `max` bytes.
  public func optBlob(b : ?Blob, max : Nat) : Bool = switch (b) {
    case null true;
    case (?x) x.size() <= max;
  };

  /// At most `max` items, each passing `ok`.
  public func all<T>(xs : [T], max : Nat, ok : T -> Bool) : Bool = xs.size() <= max and Array.foldLeft<T, Bool>(xs, true, func(acc, x) = acc and ok(x));
};
