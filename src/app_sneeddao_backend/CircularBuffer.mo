import Debug "mo:base/Debug";
import Time "mo:base/Time";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Principal "mo:base/Principal";

type BufferEntry = {
    id : Nat;
    correlation_id : Nat;
    caller : Principal;
    timestamp : Int;
    content : Text;
};

type CircularBuffer = {
    buffer : [var ?BufferEntry];
    capacity : Nat;
    var start : Nat;
    var count : Nat;
    var nextId : Nat;
};

module CircularBufferLogic {

  public func create(capacity: Nat) : CircularBuffer {
    {
      buffer = Array.init<?BufferEntry>(capacity, null);
      capacity = capacity;
      var start = 0;
      var count = 0;
      var nextId = 1;
    }
  };

  // Helper to get the oldest and newest IDs currently stored.
  // Returns null if no entries.
  public func get_id_range(cb: CircularBuffer) : ?(Nat, Nat) {
    if (cb.count == 0) {
      return null;
    };
    let oldestID = switch (cb.buffer[cb.start]) {
      case (null) { 0; };
      case (?oldest) { oldest.id; };
    };
    let newestIndex = (cb.start + cb.count - 1) % cb.capacity;
    let newestID = switch (cb.buffer[newestIndex]) {
      case (null) { 0; };
      case (?newest) { newest.id; };
    };
    ?(oldestID, newestID)
  };

  public func add(cb: CircularBuffer, correlation_id : Nat, caller : Principal, message: Text) {
    if (cb.capacity == 0) {
      return;
    };

    let now = Time.now();
    let end = (cb.start + cb.count) % cb.capacity;
    let newEntry = { id = cb.nextId; correlation_id = correlation_id; caller = caller; timestamp = now; content = message };

    if (cb.count < cb.capacity) {
      cb.buffer[end] := ?newEntry;
      cb.count += 1;
    } else {
      // Overwrite the oldest log
      cb.buffer[cb.start] := ?newEntry;
      cb.start := (cb.start + 1) % cb.capacity;
    };

    cb.nextId += 1;
  };

  // Get a single entry by its id
  public func get_entry_by_id(cb: CircularBuffer, id: Nat) : ?BufferEntry {
    let range = get_id_range(cb);
    switch (range) {
      case (null) {
        // no entries at all
        null
      };
      case (? (oldestID, newestID)) {
        if (id < oldestID or id > newestID) {
          // id not in range
          null
        } else {
          let offset = id - oldestID;
          let realIndex = (cb.start + offset) % cb.capacity;
          cb.buffer[realIndex]
        }
      }
    }
  };

  // Get multiple entries starting from a given id, up to length.
  public func get_entries_by_id(cb: CircularBuffer, startId: Nat, length: Nat) : [?BufferEntry] {
    let range = get_id_range(cb);
    var _startId = startId;
    var _length = length;
    switch (range) {
      case (null) {
        // no entries
        return [];
      };
      case (? (oldestID, newestID)) {
        if (startId > newestID) {
          // startId not in current range
          return [];
        }
        else {
          if (startId < oldestID) {
            _startId := oldestID;
            _length := length - (oldestID - startId);
          };
         
          // How many entries are available from startId to newestID?
          let available = (newestID - _startId) + 1; 
          let toTake = if (_length < available) { _length } else { available };
          let arr = Array.init<?BufferEntry>(toTake, null);
          let offset = _startId - oldestID;
          let startIndex = (cb.start + offset) % cb.capacity;

          for (i in Iter.range(0, toTake - 1)) {
            let realIndex = (startIndex + i) % cb.capacity;
            arr[i] := cb.buffer[realIndex];
          };

          Array.freeze(arr)
        }
      }
    }
  };

  public func to_array(cb: CircularBuffer) : [var ?BufferEntry] {
    let arr = Array.init<?BufferEntry>(cb.count, null);
    
    for (i in Iter.range(0, cb.count - 1)) {
      let realIndex = (cb.start + i) % cb.capacity;
      arr[i] := cb.buffer[realIndex];
    };

    arr;
  };

  // Get all logs within a time interval [startTime, endTime]
  public func get_entries_by_timerange(cb: CircularBuffer, startTime: Int, endTime: Int) : [?BufferEntry] {
    let arr = Array.freeze(to_array(cb));
    let filtered = Array.filter<?BufferEntry>(arr, func (?entry) {
      switch (?entry) {
        case (null) { false; };
        case (?the_entry) {
          the_entry.timestamp >= startTime and the_entry.timestamp <= endTime
        };
      }
    });
    filtered;
  };
};


// // Example usage:
// Debug.print(debug_show(Time.now()));
// let logs = CircularBufferLogic.create(5);

// CircularBufferLogic.add(logs, "Log #1");
// CircularBufferLogic.add(logs, "Log #2");
// CircularBufferLogic.add(logs, "Log #3");
// CircularBufferLogic.add(logs, "Log #4");
// CircularBufferLogic.add(logs, "Log #5");
// CircularBufferLogic.add(logs, "Log #6");
// CircularBufferLogic.add(logs, "Log #7");
// Debug.print(debug_show(CircularBufferLogic.to_array(logs)));

// // Check time range
// let now = Time.now();
// let startTime = now - 1_000_000_000;  // one second ago
// let endTime = now + 1_000_000_000;    // one second in the future

// let rangedLogs = CircularBufferLogic.get_entries_by_timerange(logs, startTime, endTime);
// Debug.print(debug_show(rangedLogs));

// Debug.print(debug_show("ID Range:"));
// let entries = CircularBufferLogic.get_entries_by_id(logs, 4, 3);
// Debug.print(debug_show(entries));