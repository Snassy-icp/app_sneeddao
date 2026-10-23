import Array "mo:base/Array";
import Debug "mo:base/Debug";
import Iter "mo:base/Iter";

/// A stable ring buffer for the bots' append-only logs (bot log, trade log, portfolio and
/// purse snapshots, price history).
///
/// Appending is O(1) (amortised: the array grows by doubling up to the cap), where the old
/// immutable-array logs copied the whole log on every append. The record is a stable type, so
/// a bot keeps it in a stable `var` and hands the same record to its helpers: they mutate it in
/// place, and the change is persisted with the actor's state.
///
/// Entry i (0 = oldest) lives at `items[(start + i) % items.size()]`; `count` entries are used.
module {

    public type Ring<T> = {
        var items : [var ?T];
        var start : Nat;
        var count : Nat;
    };

    public func empty<T>() : Ring<T> = { var items = [var]; var start = 0; var count = 0 };

    public func size<T>(r : Ring<T>) : Nat = r.count;

    /// The i-th oldest entry (0-based). Traps when i >= size.
    public func get<T>(r : Ring<T>, i : Nat) : T {
        if (i >= r.count) Debug.trap("BotRing.get: index out of range");
        switch (r.items[(r.start + i) % r.items.size()]) {
            case (?x) x;
            case null Debug.trap("BotRing.get: empty slot");
        };
    };

    /// Replace the i-th oldest entry (0-based) in place. Traps when i >= size.
    public func set<T>(r : Ring<T>, i : Nat, x : T) {
        if (i >= r.count) Debug.trap("BotRing.set: index out of range");
        r.items[(r.start + i) % r.items.size()] := ?x;
    };

    /// The i-th newest entry (0 = newest). Traps when i >= size.
    public func getFromNewest<T>(r : Ring<T>, i : Nat) : T {
        if (i >= r.count) Debug.trap("BotRing.getFromNewest: index out of range");
        get(r, r.count - 1 - i : Nat);
    };

    public func last<T>(r : Ring<T>) : ?T {
        if (r.count == 0) null else ?get(r, r.count - 1 : Nat);
    };

    public func clear<T>(r : Ring<T>) {
        r.items := [var];
        r.start := 0;
        r.count := 0;
    };

    /// Lay out the newest min(count, cap) entries from index 0 in an array of `physical` slots
    /// (physical >= kept).
    func relayout<T>(r : Ring<T>, cap : Nat, physical : Nat) {
        let kept = if (r.count < cap) r.count else cap;
        let skip = r.count - kept : Nat;
        let fresh = Array.init<?T>(physical, null);
        var i = 0;
        while (i < kept) {
            fresh[i] := ?get(r, skip + i);
            i += 1;
        };
        r.items := fresh;
        r.start := 0;
        r.count := kept;
    };

    /// Keep only the newest `cap` entries (cap 0 empties the ring).
    public func trim<T>(r : Ring<T>, cap : Nat) {
        if (cap == 0) { clear(r); return };
        if (r.count > cap or r.items.size() > cap) relayout(r, cap, if (r.count < cap) r.count else cap);
    };

    /// Append `x`, keeping at most `cap` entries. Returns the oldest entry if one was dropped to
    /// make room. With cap 0 nothing is kept and `x` itself is returned.
    public func push<T>(r : Ring<T>, x : T, cap : Nat) : ?T {
        if (cap == 0) { clear(r); return ?x };
        if (r.count > cap or r.items.size() > cap) trim(r, cap);
        if (r.count < cap) {
            if (r.count == r.items.size()) {
                // full array but under the cap: grow (doubling, at least 8, at most cap)
                let grown = r.items.size() * 2;
                let target = if (grown < 8) 8 else grown;
                relayout(r, cap, if (target > cap) cap else target);
            };
            r.items[(r.start + r.count) % r.items.size()] := ?x;
            r.count += 1;
            null
        } else {
            // full at the cap: overwrite the oldest
            let evicted = r.items[r.start];
            r.items[r.start] := ?x;
            r.start := (r.start + 1) % r.items.size();
            evicted
        };
    };

    /// Append every entry of `xs` (oldest first), keeping at most `cap` entries.
    public func appendAll<T>(r : Ring<T>, xs : [T], cap : Nat) {
        for (x in xs.vals()) { ignore push(r, x, cap) };
    };

    /// Oldest first.
    public func vals<T>(r : Ring<T>) : Iter.Iter<T> {
        var i = 0;
        object {
            public func next() : ?T {
                if (i >= r.count) return null;
                let x = get(r, i);
                i += 1;
                ?x;
            };
        };
    };

    /// Newest first.
    public func valsNewestFirst<T>(r : Ring<T>) : Iter.Iter<T> {
        var i = r.count;
        object {
            public func next() : ?T {
                if (i == 0) return null;
                i -= 1;
                ?get(r, i);
            };
        };
    };

    /// Oldest first.
    public func toArray<T>(r : Ring<T>) : [T] {
        Array.tabulate<T>(r.count, func(i) { get(r, i) });
    };

    /// Keep only the entries for which `keep` holds (order preserved). O(n).
    public func retain<T>(r : Ring<T>, keep : T -> Bool) {
        let kept = Array.filter<T>(toArray(r), keep);
        let fresh = Array.init<?T>(kept.size(), null);
        for (i in kept.keys()) { fresh[i] := ?kept[i] };
        r.items := fresh;
        r.start := 0;
        r.count := kept.size();
    };
};
