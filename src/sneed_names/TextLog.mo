import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Time "mo:base/Time";

import T "Types";

/// A bounded text log (newest CAPACITY entries) for the naming canisters' operational messages.
/// Business events go to the ICRC-3 log; this holds what an operator needs: spills, failures.
module {
  public let CAPACITY : Nat = 2_000;

  public type State = {
    var entries : [var ?T.LogEntry];
    var next_id : Nat; // id of the next entry; entry i lives at i % CAPACITY
    var next_cid : Nat;
  };

  public func init() : State = { var entries = Array.init<?T.LogEntry>(CAPACITY, null); var next_id = 0; var next_cid = 0 };

  public func correlationId(s : State) : Nat { s.next_cid += 1; s.next_cid };

  public func add(s : State, level : { #info; #error }, cid : Nat, caller : Principal, message : Text) {
    s.entries[s.next_id % CAPACITY] := ?{ id = s.next_id; ts = Time.now(); level; cid; caller; message };
    s.next_id += 1;
  };

  /// Entries with ids in [start, start + length), oldest first; ids that have rotated out are skipped.
  public func get(s : State, start : Nat, length : Nat) : [T.LogEntry] {
    let len = if (length > 500) 500 else length;
    let first = if (s.next_id > CAPACITY and start < s.next_id - CAPACITY) s.next_id - CAPACITY else start;
    let out = Buffer.Buffer<T.LogEntry>(len);
    var i = first;
    while (i < s.next_id and i < start + len) {
      switch (s.entries[i % CAPACITY]) { case (?e) out.add(e); case null {} };
      i += 1;
    };
    Buffer.toArray(out);
  };
};
