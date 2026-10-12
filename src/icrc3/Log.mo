/// ICRC-3 block log library for Sneed DAO canisters.
///
/// A canister that wants a hash-chained, certified activity log with archive
/// canisters needs:
///
///   1. a `Config` (its block-type catalogue and where it is documented),
///   2. one stable `State` (`Log.init()`), one transient `Runtime`
///      (`Log.runtime()`) and an `Environment` telling the library who the
///      canister is, how to write to its text log and who should co-control
///      the archives,
///   3. one-line public wrappers for the standard queries and the admin
///      operations (public functions cannot live in a library),
///   4. `Log.append(...)` at every point where an action has been committed,
///   5. `Log.ensureTimer` from the actor body and `postupgrade`, plus
///      `Log.certify` in `postupgrade`.
///
/// Everything else (hashing, chaining, the live store, certification, the
/// read endpoints, spilling to archives, creating, controlling and topping up
/// archives) is in here and in Hash.mo / Archive.mo. The library uses only
/// `mo:base` and `mo:sha2`, builds with moc 0.14.x and 1.x, and shares cycles
/// with nobody.
///
/// First instance and design document: spec/sneed_lock_icrc3.md.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import CertifiedData "mo:base/CertifiedData";
import Cycles "mo:base/ExperimentalCycles";
import Error "mo:base/Error";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Timer "mo:base/Timer";

import Archive "Archive";
import Hash "Hash";
import T "Types";

module {

  public type Value = T.Value;

  /// Per-canister, compile-time configuration.
  public type Config = {
    block_types : [Text]; // every btype this canister may append
    block_types_url : Text; // where the catalogue is documented
  };

  /// Per-canister glue the library calls back into.
  public type Environment = {
    self : Principal; // the logging canister
    archive_controllers : [Principal]; // added next to `self` on every archive (e.g. SNS root)
    cycle_reserve : Nat; // never spend the canister's balance below this
    new_correlation_id : () -> Nat; // groups the text-log lines of one spill run
    log_info : (Nat, Text) -> ();
    log_error : (Nat, Text) -> ();
  };

  /// Stable state. Declare as `stable var log : Log.State = Log.init();`.
  public type State = {
    live : T.LiveStore;
    var log_length : Nat; // blocks ever appended (next index)
    var last_hash : ?Blob; // hash of block log_length - 1
    var archives : [T.ArchiveInfo]; // in index order
    var settings : T.Settings;
    var history_imported : Bool; // for canisters that import pre-log state once
  };

  /// Transient state. Declare as `transient let log_rt = Log.runtime();`.
  public type Runtime = {
    var spilling : Bool;
    var timer_started : Bool;
  };

  public let MAX_RESPONSE_BLOCKS : Nat = 1000;
  public let MAX_RESPONSE_BYTES : Nat = 1_500_000;

  public func defaultSettings() : T.Settings {
    {
      max_live_blocks = 2000;
      spill_batch_size = 500;
      archive_max_blocks = 1_000_000;
      archive_initial_cycles = 1_500_000_000_000; // 1.5 T: the subnet keeps the creation fee (0.5 T on 13-node subnets)
      archive_top_up_threshold = 500_000_000_000; // 0.5 T
      archive_top_up_amount = 500_000_000_000; // 0.5 T
    };
  };

  public func init() : State {
    {
      live = { var blocks = [var] : [var Blob]; var count = 0; var first_index = 0 };
      var log_length = 0;
      var last_hash = null;
      var archives = [];
      var settings = defaultSettings();
      var history_imported = false;
    };
  };

  public func runtime() : Runtime {
    { var spilling = false; var timer_started = false };
  };

  // -------------------------------------------------------------------------
  // Value helpers for building `tx` maps
  // -------------------------------------------------------------------------

  public func principal(p : Principal) : Value = #Blob(Principal.toBlob(p));

  /// ICRC-1 account in the ICRC-3 representation: [owner, subaccount?].
  public func account(owner : Principal, subaccount : ?Blob) : Value {
    switch (subaccount) {
      case (?s) { #Array([#Blob(Principal.toBlob(owner)), #Blob(s)]) };
      case null { #Array([#Blob(Principal.toBlob(owner))]) };
    };
  };

  public func nat64(n : Nat64) : Value = #Nat(Nat64.toNat(n));

  // -------------------------------------------------------------------------
  // Live store
  // -------------------------------------------------------------------------

  func livePush(live : T.LiveStore, blob : Blob) {
    if (live.count == live.blocks.size()) {
      let grown = Array.init<Blob>(Nat.max(64, live.blocks.size() * 2), "" : Blob);
      var i = 0;
      while (i < live.count) { grown[i] := live.blocks[i]; i += 1 };
      live.blocks := grown;
    };
    live.blocks[live.count] := blob;
    live.count += 1;
  };

  /// The oldest `n` live blocks, encoded, oldest first.
  public func oldestBlobs(state : State, n : Nat) : [Blob] {
    let take = Nat.min(n, state.live.count);
    Array.tabulate<Blob>(take, func(i) { state.live.blocks[i] });
  };

  /// Forget live blocks whose global index is below `index` (they are now in
  /// an archive). Keeps the array capacity.
  public func dropBelow(state : State, index : Nat) {
    let live = state.live;
    if (index <= live.first_index) { return };
    let n = Nat.min(index - live.first_index, live.count);
    if (n == 0) { return };
    let remaining : Nat = if (live.count > n) { live.count - n } else { 0 };
    let fresh = Array.init<Blob>(Nat.max(64, live.blocks.size()), "" : Blob);
    var i = 0;
    while (i < remaining) { fresh[i] := live.blocks[i + n]; i += 1 };
    live.blocks := fresh;
    live.count := remaining;
    live.first_index += n;
  };

  func liveGet(state : State, index : Nat) : ?Blob {
    let live = state.live;
    if (index < live.first_index or index >= live.first_index + live.count) { return null };
    ?live.blocks[index - live.first_index];
  };

  // -------------------------------------------------------------------------
  // Appending and certification
  // -------------------------------------------------------------------------

  /// Append a block with the given type and `tx` map. Returns the block index.
  /// Must be called from an update context (it sets certified data).
  public func append(state : State, btype : Text, now_ns : Nat, tx : [(Text, Value)]) : Nat {
    let fields = Buffer.Buffer<(Text, Value)>(4);
    fields.add(("btype", #Text(btype)));
    fields.add(("ts", #Nat(now_ns)));
    switch (state.last_hash) {
      case (?h) { fields.add(("phash", #Blob(h))) };
      case null {};
    };
    fields.add(("tx", #Map(tx)));
    let block : Value = #Map(Buffer.toArray(fields));
    let hash = Hash.hashValue(block);
    let bytes : Blob = to_candid(block);
    livePush(state.live, bytes);
    let index = state.log_length;
    state.log_length += 1;
    state.last_hash := ?hash;
    certify(state);
    index;
  };

  /// (Re)publish the certified tip. Call after every append and in postupgrade.
  public func certify(state : State) {
    switch (state.last_hash) {
      case (?h) {
        CertifiedData.set(Hash.treeHash(Hash.tipTree(state.log_length - 1, h)));
      };
      case null {};
    };
  };

  public func decode(blob : Blob) : ?Value = from_candid(blob);

  // -------------------------------------------------------------------------
  // Read endpoints
  // -------------------------------------------------------------------------

  type ArchiveReader = actor {
    icrc3_get_blocks : shared query T.GetBlocksArgs -> async T.GetBlocksResult;
  };

  public func getBlocks(state : State, args : T.GetBlocksArgs) : T.GetBlocksResult {
    let blocks = Buffer.Buffer<T.Block>(64);
    var bytes = 0;
    let live = state.live;
    let live_end = live.first_index + live.count;

    // Live part
    label ranges for (range in args.vals()) {
      let lo = Nat.max(range.start, live.first_index);
      let hi = Nat.min(range.start + range.length, live_end);
      if (lo >= hi) { continue ranges };
      var i = lo;
      while (i < hi) {
        if (blocks.size() >= MAX_RESPONSE_BLOCKS or bytes >= MAX_RESPONSE_BYTES) { break ranges };
        switch (liveGet(state, i)) {
          case (?blob) {
            switch (decode(blob)) {
              case (?v) { blocks.add({ id = i; block = v }); bytes += blob.size() };
              case null {};
            };
          };
          case null {};
        };
        i += 1;
      };
    };

    // Archived part: one callback entry per archive that overlaps a request
    let archived = Buffer.Buffer<T.ArchivedBlocks>(4);
    for (a in state.archives.vals()) {
      let a_end = a.start + a.length;
      let sub = Buffer.Buffer<T.BlockRange>(2);
      for (range in args.vals()) {
        let lo = Nat.max(range.start, a.start);
        let hi = Nat.min(range.start + range.length, Nat.min(a_end, live.first_index));
        if (lo < hi) { sub.add({ start = lo; length = hi - lo }) };
      };
      if (sub.size() > 0) {
        let reader : ArchiveReader = actor (Principal.toText(a.canister_id));
        archived.add({ args = Buffer.toArray(sub); callback = reader.icrc3_get_blocks });
      };
    };

    { log_length = state.log_length; blocks = Buffer.toArray(blocks); archived_blocks = Buffer.toArray(archived) };
  };

  public func getArchives(state : State, args : T.GetArchivesArgs) : T.GetArchivesResult {
    let out = Buffer.Buffer<T.ArchiveRange>(state.archives.size());
    var after_from = switch (args.from) { case null { true }; case (?_) { false } };
    for (a in state.archives.vals()) {
      if (after_from and a.length > 0) {
        out.add({ canister_id = a.canister_id; start = a.start; end = a.start + a.length - 1 });
      };
      switch (args.from) {
        case (?p) { if (p == a.canister_id) { after_from := true } };
        case null {};
      };
    };
    Buffer.toArray(out);
  };

  public func tipCertificate(state : State) : ?T.DataCertificate {
    switch (state.last_hash, CertifiedData.getCertificate()) {
      case (?h, ?certificate) {
        ?{ certificate; hash_tree = Hash.treeCbor(Hash.tipTree(state.log_length - 1, h)) };
      };
      case _ { null };
    };
  };

  public func supportedBlockTypes(config : Config) : [T.BlockType] {
    Array.map<Text, T.BlockType>(config.block_types, func(t) { { block_type = t; url = config.block_types_url } });
  };

  public func supportedStandards() : [T.SupportedStandard] {
    [
      { name = "ICRC-3"; url = "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
      { name = "ICRC-10"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-10/ICRC-10.md" },
    ];
  };

  public func status(state : State, rt : Runtime) : T.LogStatus {
    {
      log_length = state.log_length;
      live_blocks = state.live.count;
      live_first_index = state.live.first_index;
      last_block_hash = state.last_hash;
      archives = state.archives;
      settings = state.settings;
      history_imported = state.history_imported;
      spilling = rt.spilling;
    };
  };

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  /// Validate and apply a partial settings update. Returns the changed keys
  /// with their old and new values so the caller can log them.
  public func applySettings(state : State, u : T.SettingsUpdate) : { #Ok : [(Text, Nat, Nat)]; #Err : Text } {
    let s = state.settings;
    let n = {
      max_live_blocks = switch (u.max_live_blocks) { case (?v) v; case null s.max_live_blocks };
      spill_batch_size = switch (u.spill_batch_size) { case (?v) v; case null s.spill_batch_size };
      archive_max_blocks = switch (u.archive_max_blocks) { case (?v) v; case null s.archive_max_blocks };
      archive_initial_cycles = switch (u.archive_initial_cycles) { case (?v) v; case null s.archive_initial_cycles };
      archive_top_up_threshold = switch (u.archive_top_up_threshold) { case (?v) v; case null s.archive_top_up_threshold };
      archive_top_up_amount = switch (u.archive_top_up_amount) { case (?v) v; case null s.archive_top_up_amount };
    };
    if (n.max_live_blocks < 1) { return #Err("max_live_blocks must be at least 1") };
    if (n.spill_batch_size < 1 or n.spill_batch_size > 1000) { return #Err("spill_batch_size must be between 1 and 1000") };
    if (n.archive_max_blocks < n.spill_batch_size) { return #Err("archive_max_blocks must be at least spill_batch_size") };
    if (n.archive_initial_cycles < 200_000_000_000) { return #Err("archive_initial_cycles must be at least 0.2 T") };
    if (n.archive_top_up_amount < 100_000_000_000) { return #Err("archive_top_up_amount must be at least 0.1 T") };
    let changes = Buffer.Buffer<(Text, Nat, Nat)>(6);
    if (n.max_live_blocks != s.max_live_blocks) { changes.add(("icrc3_max_live_blocks", s.max_live_blocks, n.max_live_blocks)) };
    if (n.spill_batch_size != s.spill_batch_size) { changes.add(("icrc3_spill_batch_size", s.spill_batch_size, n.spill_batch_size)) };
    if (n.archive_max_blocks != s.archive_max_blocks) { changes.add(("icrc3_archive_max_blocks", s.archive_max_blocks, n.archive_max_blocks)) };
    if (n.archive_initial_cycles != s.archive_initial_cycles) { changes.add(("icrc3_archive_initial_cycles", s.archive_initial_cycles, n.archive_initial_cycles)) };
    if (n.archive_top_up_threshold != s.archive_top_up_threshold) { changes.add(("icrc3_archive_top_up_threshold", s.archive_top_up_threshold, n.archive_top_up_threshold)) };
    if (n.archive_top_up_amount != s.archive_top_up_amount) { changes.add(("icrc3_archive_top_up_amount", s.archive_top_up_amount, n.archive_top_up_amount)) };
    state.settings := n;
    #Ok(Buffer.toArray(changes));
  };

  // -------------------------------------------------------------------------
  // Archives: spilling, creation, controllers, cycles
  // -------------------------------------------------------------------------

  type ArchiveActor = actor {
    append_blocks : shared T.AppendBlocksArgs -> async T.AppendBlocksResult;
    archive_status : shared query () -> async T.ArchiveStatus;
    deposit_cycles : shared () -> async ();
  };

  type ManagementCanister = actor {
    update_settings : shared {
      canister_id : Principal;
      settings : {
        controllers : ?[Principal];
        compute_allocation : ?Nat;
        memory_allocation : ?Nat;
        freezing_threshold : ?Nat;
      };
      sender_canister_version : ?Nat64;
    } -> async ();
  };

  /// Start the periodic spill check once per canister lifetime. Call from the
  /// actor body and from `postupgrade` (the runtime guard makes the second
  /// call a no-op in classic persistence, where both run on upgrade).
  public func ensureTimer<system>(rt : Runtime, period_seconds : Nat, job : () -> async ()) {
    if (rt.timer_started) { return };
    rt.timer_started := true;
    ignore Timer.recurringTimer<system>(#seconds period_seconds, job);
  };

  func lastArchive(state : State) : ?T.ArchiveInfo {
    let n = state.archives.size();
    if (n == 0) { null } else { ?state.archives[n - 1] };
  };

  func archiveWithRoom(state : State) : ?T.ArchiveInfo {
    switch (lastArchive(state)) {
      case (?a) { if (a.length < a.max_blocks) { ?a } else { null } };
      case null { null };
    };
  };

  func updateArchiveLength(state : State, canister_id : Principal, length : Nat) {
    state.archives := Array.map<T.ArchiveInfo, T.ArchiveInfo>(state.archives, func(a) {
      if (a.canister_id == canister_id) { { a with length } } else { a };
    });
  };

  /// Move batches of the oldest live blocks to the newest archive while the
  /// live store is at or above the threshold (or, when forced, while it holds
  /// anything). Blocks are forgotten locally only after the archive confirms.
  /// Returns the number of blocks moved.
  public func spill(state : State, rt : Runtime, env : Environment, force : Bool) : async* Nat {
    if (rt.spilling) { return 0 };
    if (state.live.count == 0 or (not force and state.live.count < state.settings.max_live_blocks)) { return 0 };
    rt.spilling := true;
    let cid = env.new_correlation_id();
    let before = state.live.first_index;
    try {
      var rounds = 0;
      label spills while (rounds < 50 and state.live.count > 0 and (force or state.live.count >= state.settings.max_live_blocks)) {
        rounds += 1;
        let archive = switch (archiveWithRoom(state)) {
          case (?a) { a };
          case null {
            switch (await* createArchive(state, env, cid)) {
              case (#Ok(a)) { a };
              case (#Err(e)) {
                env.log_error(cid, "ICRC-3 spill stopped: " # e);
                break spills;
              };
            };
          };
        };
        let first_index = state.live.first_index;
        if (first_index != archive.start + archive.length) {
          env.log_error(cid, "ICRC-3 spill stopped: live store starts at " # Nat.toText(first_index) # " but archive " # Principal.toText(archive.canister_id) # " expects " # Nat.toText(archive.start + archive.length));
          break spills;
        };
        let room : Nat = if (archive.max_blocks > archive.length) { archive.max_blocks - archive.length } else { 0 };
        let n = Nat.min(Nat.min(state.settings.spill_batch_size, room), state.live.count);
        let blobs = oldestBlobs(state, n);
        let reader : ArchiveActor = actor (Principal.toText(archive.canister_id));
        let result : T.AppendBlocksResult = try {
          await reader.append_blocks({ first_index; blocks = blobs });
        } catch (e) {
          #Err("append_blocks call failed: " # Error.message(e));
        };
        switch (result) {
          case (#Ok(count)) {
            updateArchiveLength(state, archive.canister_id, count);
            dropBelow(state, archive.start + count);
            env.log_info(cid, "ICRC-3: moved " # Nat.toText(n) # " blocks from index " # Nat.toText(first_index) # " to archive " # Principal.toText(archive.canister_id) # ", which now holds " # Nat.toText(count));
          };
          case (#Err(e)) {
            env.log_error(cid, "ICRC-3 spill stopped: " # e);
            break spills;
          };
        };
        await* topUpIfNeeded(state, env, reader, archive.canister_id, cid);
      };
    } finally {
      rt.spilling := false;
    };
    state.live.first_index - before;
  };

  func createArchive(state : State, env : Environment, cid : Nat) : async* { #Ok : T.ArchiveInfo; #Err : Text } {
    let s = state.settings;
    if (Cycles.balance() < s.archive_initial_cycles + env.cycle_reserve) {
      return #Err("not enough cycles to create an archive (balance " # Nat.toText(Cycles.balance()) # ", need " # Nat.toText(s.archive_initial_cycles + env.cycle_reserve) # ")");
    };
    let first_index = state.live.first_index;
    switch (lastArchive(state)) {
      case (?last) {
        if (last.start + last.length != first_index) {
          return #Err("archive chain is not contiguous: last archive ends at " # Nat.toText(last.start + last.length) # ", live store starts at " # Nat.toText(first_index));
        };
      };
      case null {};
    };
    let created = try {
      await (with cycles = s.archive_initial_cycles) Archive.Icrc3Archive({ first_index; max_blocks = s.archive_max_blocks });
    } catch (e) {
      return #Err("archive creation failed: " # Error.message(e));
    };
    let canister_id = Principal.fromActor(created);
    let info : T.ArchiveInfo = { canister_id; start = first_index; length = 0; max_blocks = s.archive_max_blocks };
    state.archives := Array.append(state.archives, [info]);
    env.log_info(cid, "ICRC-3: created archive " # Principal.toText(canister_id) # " for blocks from index " # Nat.toText(first_index) # " with " # Nat.toText(s.archive_initial_cycles) # " cycles");
    switch (await* setArchiveControllers(env, canister_id)) {
      case (#Ok) {};
      case (#Err(e)) { env.log_error(cid, "ICRC-3: could not set the controllers of archive " # Principal.toText(canister_id) # ": " # e) };
    };
    #Ok(info);
  };

  /// Set an archive's controllers to the logging canister plus
  /// `env.archive_controllers`.
  public func setArchiveControllers(env : Environment, canister_id : Principal) : async* { #Ok; #Err : Text } {
    let ic : ManagementCanister = actor ("aaaaa-aa");
    try {
      await ic.update_settings({
        canister_id;
        settings = {
          controllers = ?Array.append([env.self], env.archive_controllers);
          compute_allocation = null;
          memory_allocation = null;
          freezing_threshold = null;
        };
        sender_canister_version = null;
      });
      #Ok;
    } catch (e) {
      #Err(Error.message(e));
    };
  };

  /// Re-apply the intended controllers to every archive.
  public func repairArchiveControllers(state : State, env : Environment) : async* [(Principal, { #Ok; #Err : Text })] {
    var results : [(Principal, { #Ok; #Err : Text })] = [];
    for (a in state.archives.vals()) {
      let r = await* setArchiveControllers(env, a.canister_id);
      results := Array.append(results, [(a.canister_id, r)]);
    };
    results;
  };

  func topUpIfNeeded(state : State, env : Environment, reader : ArchiveActor, canister_id : Principal, cid : Nat) : async* () {
    let s = state.settings;
    let status = try {
      await reader.archive_status();
    } catch (e) {
      env.log_error(cid, "ICRC-3: could not read the status of archive " # Principal.toText(canister_id) # ": " # Error.message(e));
      return;
    };
    if (status.cycles >= s.archive_top_up_threshold) { return };
    if (Cycles.balance() < s.archive_top_up_amount + env.cycle_reserve) {
      env.log_error(cid, "ICRC-3: archive " # Principal.toText(canister_id) # " is low on cycles (" # Nat.toText(status.cycles) # ") but this canister cannot spare " # Nat.toText(s.archive_top_up_amount));
      return;
    };
    try {
      await (with cycles = s.archive_top_up_amount) reader.deposit_cycles();
      env.log_info(cid, "ICRC-3: topped up archive " # Principal.toText(canister_id) # " with " # Nat.toText(s.archive_top_up_amount) # " cycles (it reported " # Nat.toText(status.cycles) # ", threshold " # Nat.toText(s.archive_top_up_threshold) # ")");
    } catch (e) {
      env.log_error(cid, "ICRC-3: top-up of archive " # Principal.toText(canister_id) # " failed: " # Error.message(e));
    };
  };
};
