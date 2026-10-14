// Dissolve delays for Sneed Lock (spec/sneed_lock_v2.md, section 1).
//
// PURE: no state, no awaits. main.mo keeps a DissolveInfo per lock that has a
// delay and asks this module what a change does. Every function answers either
// the new info or the reason it is refused, and the canister writes nothing on
// a refusal.
//
// THE EFFECTIVE EXPIRY. A lock record's stored `expiry` is the moment it unlocks:
// for a lock with a delay that is not dissolving, that is NEVER; while it
// dissolves, the moment dissolving ends. Every existing check in main.mo that
// frees tokens or positions compares `expiry` with now, so it stays correct for
// delay locks without being changed.
import Nat64 "mo:base/Nat64";
import Result "mo:base/Result";

module {
  public let NEVER : Nat64 = 0xFFFF_FFFF_FFFF_FFFF;

  /// Kept per lock id, for locks that have (or had) a dissolve delay.
  public type Info = {
    lock_end : Nat64;            // end of the lock period; dissolving cannot start before it
    delay : Nat64;               // the dissolve delay; while dissolving, the delay it started with (plus increases)
    dissolving_until : ?Nat64;   // set while dissolving: the moment the lock is free
  };

  public type Limits = { min : Nat64; max : Nat64 };

  /// What the stored `expiry` of the lock record must be.
  public func effectiveExpiry(i : Info) : Nat64 {
    switch (i.dissolving_until) {
      case (?u) { if (u > i.lock_end) u else i.lock_end };
      case null NEVER;
    }
  };

  public func isLocked(i : Info, now : Nat64) : Bool { effectiveExpiry(i) > now };

  /// The soonest the lock can be free: while dissolving, the end of the dissolve; otherwise
  /// if dissolving started as soon as allowed (the end of the lock period, or now if that is
  /// past), plus the delay. For a lock that is not dissolving this moves forward with time
  /// once its lock period is over. Saturates at NEVER.
  public func earliestUnlock(i : Info, now : Nat64) : Nat64 {
    switch (i.dissolving_until) {
      case (?_) effectiveExpiry(i);
      case null {
        let from = if (i.lock_end > now) i.lock_end else now;
        let t = Nat64.toNat(from) + Nat64.toNat(i.delay);
        if (t >= Nat64.toNat(NEVER)) NEVER else Nat64.fromNat(t)
      };
    }
  };

  /// How long the lock would still be held if dissolving started as soon as allowed:
  /// the rest of the lock period plus the delay, or the rest of the dissolve. In Nat,
  /// so nothing here can overflow.
  public func committed(i : Info, now : Nat64) : Nat {
    switch (i.dissolving_until) {
      case (?u) { if (u > now) Nat64.toNat(u - now) else 0 };
      case null { (if (i.lock_end > now) Nat64.toNat(i.lock_end - now) else 0) + Nat64.toNat(i.delay) };
    }
  };

  /// For a lock with a delay, a lock end at or before now means no lock period: the
  /// caller's clock and the moment the call runs never agree exactly, so "now" (or 0)
  /// must not be refused as the past.
  public func clampEnd(now : Nat64, lock_end : Nat64) : Nat64 { if (lock_end < now) now else lock_end };

  /// A new lock ending at `lock_end` with `delay`. With no delay the old rules apply
  /// unchanged (main.mo checks them); with one, the limits apply to period + delay,
  /// and the period may be zero.
  public func createRefusal(now : Nat64, lock_end : Nat64, delay : Nat64, limits : Limits) : ?Text {
    let total = Nat64.toNat(clampEnd(now, lock_end) - now) + Nat64.toNat(delay);
    if (total < Nat64.toNat(limits.min)) { return ?"Minimum lock time not fulfilled." };
    if (total > Nat64.toNat(limits.max)) { return ?"Maximum lock time exceeded." };
    null
  };

  /// The info of a lock that has no delay yet: its stored expiry is its lock end.
  public func fromPlain(expiry : Nat64) : Info { { lock_end = expiry; delay = 0; dissolving_until = null } };

  public func start(i : Info, now : Nat64) : Result.Result<Info, Text> {
    if (i.dissolving_until != null) { return #err("The lock is already dissolving.") };
    if (i.delay == 0) { return #err("The lock has no dissolve delay.") };
    if (now < i.lock_end) { return #err("Dissolving can start when the lock period ends.") };
    #ok({ i with dissolving_until = ?(now + i.delay) })
  };

  public func stop(i : Info, now : Nat64) : Result.Result<Info, Text> {
    switch (i.dissolving_until) {
      case null { #err("The lock is not dissolving.") };
      case (?u) {
        if (u <= now) { return #err("The lock has finished dissolving.") };
        // The time left becomes the delay again, as in the NNS.
        #ok({ i with delay = u - now; dissolving_until = null })
      };
    }
  };

  /// Add `add` to the delay; while dissolving, the end moves out by `add`. Only while
  /// the lock is held: a free lock is locked again by creating a lock.
  public func increase(i : Info, now : Nat64, add : Nat64, limits : Limits) : Result.Result<Info, Text> {
    if (add == 0) { return #err("The increase must be more than zero.") };
    // Checked before any Nat64 addition below, which would trap on overflow.
    if (Nat64.toNat(add) > Nat64.toNat(limits.max)) { return #err("Maximum lock time exceeded.") };
    if (not isLocked(i, now)) { return #err("The lock is no longer locked.") };
    let next : Info = switch (i.dissolving_until) {
      case (?u) { { i with delay = i.delay + add; dissolving_until = ?(u + add) } };
      case null { { i with delay = i.delay + add } };
    };
    if (committed(next, now) > Nat64.toNat(limits.max)) { return #err("Maximum lock time exceeded.") };
    #ok(next)
  };

  /// Move the end of the lock period out. Not while dissolving: once dissolving has
  /// started the lock period is over.
  public func extend(i : Info, now : Nat64, new_end : Nat64, limits : Limits) : Result.Result<Info, Text> {
    if (i.dissolving_until != null) { return #err("A dissolving lock cannot be extended; stop dissolving first.") };
    if (new_end <= i.lock_end) { return #err("New expiry is not after the current one.") };
    if (new_end <= now) { return #err("The lock period cannot end in the past.") };
    let next = { i with lock_end = new_end };
    if (committed(next, now) > Nat64.toNat(limits.max)) { return #err("Maximum lock time exceeded.") };
    #ok(next)
  };

  public type Op = { #Start; #Stop; #Increase : Nat64; #Extend : Nat64 };

  /// One change to one lock. `info` is the lock's dissolve info if it has one, `stored`
  /// its record's expiry. Answers the info to keep (null: the lock stays a plain lock)
  /// and the expiry its record must now carry, or why the change is refused.
  public func applyOp(op : Op, info : ?Info, stored : Nat64, now : Nat64, limits : Limits) : Result.Result<(?Info, Nat64), Text> {
    switch (info, op) {
      case (null, #Extend(e)) {
        switch (extendPlainRefusal(stored, now, e, limits)) { case (?why) #err(why); case null #ok((null, e)) }
      };
      case (null, #Increase(add)) {
        // A plain lock takes on a delay: its expiry becomes the end of its lock period.
        if (stored <= now) { return #err("The lock is no longer locked.") };
        switch (increase(fromPlain(stored), now, add, limits)) { case (#ok(n)) #ok((?n, effectiveExpiry(n))); case (#err(why)) #err(why) }
      };
      case (null, #Start) { #err("The lock has no dissolve delay.") };
      case (null, #Stop) { #err("The lock is not dissolving.") };
      case (?i, _) {
        let r = switch (op) {
          case (#Start) start(i, now);
          case (#Stop) stop(i, now);
          case (#Increase(add)) increase(i, now, add, limits);
          case (#Extend(e)) {
            if (not isLocked(i, now)) { return #err("The lock is no longer locked.") };
            extend(i, now, e, limits)
          };
        };
        switch (r) { case (#ok(n)) #ok((?n, effectiveExpiry(n))); case (#err(why)) #err(why) }
      };
    }
  };

  /// A lock without a delay: extending it only moves its expiry.
  public func extendPlainRefusal(expiry : Nat64, now : Nat64, new_end : Nat64, limits : Limits) : ?Text {
    if (expiry <= now) { return ?"The lock is no longer locked." };
    if (new_end <= expiry) { return ?"New expiry is not after the current one." };
    if (Nat64.toNat(new_end - now) > Nat64.toNat(limits.max)) { return ?"Maximum lock time exceeded." };
    null
  };
}
