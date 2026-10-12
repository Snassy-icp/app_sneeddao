/// The sneed_lock side of the ICRC-3 block log: block construction, the
/// hash chain, the bounded live store, the certified tip and the read
/// endpoints. Everything that needs cross-canister calls (spilling to archives,
/// creating them, topping them up) lives in main.mo, which owns the state.
///
/// Design: spec/sneed_lock_icrc3.md
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import CertifiedData "mo:base/CertifiedData";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";

import Hash "Icrc3Hash";
import T "Icrc3Types";

module {

  public type Value = T.Value;

  public type State = {
    live : T.LiveStore;
    var log_length : Nat; // blocks ever appended (next index)
    var last_hash : ?Blob; // hash of block log_length - 1
    var archives : [T.ArchiveInfo]; // in index order
    var settings : T.Settings;
    var history_imported : Bool;
  };

  public let MAX_RESPONSE_BLOCKS : Nat = 1000;
  public let MAX_RESPONSE_BYTES : Nat = 1_500_000;

  public let BLOCK_TYPES_URL : Text = "https://app.sneeddao.com/api/sneed_lock#block-types";

  public let BLOCK_TYPES : [Text] = [
    "sneedlock_log_start",
    "sneedlock_import_token_lock",
    "sneedlock_import_position_lock",
    "sneedlock_import_position_claim",
    "sneedlock_token_lock_create",
    "sneedlock_token_lock_transfer",
    "sneedlock_token_withdraw",
    "sneedlock_position_claim",
    "sneedlock_position_lock_create",
    "sneedlock_position_lock_extend",
    "sneedlock_position_transfer",
    "sneedlock_position_withdraw",
    "sneedlock_fees_claim",
    "sneedlock_liquidity_add",
    "sneedlock_fee_pay",
    "sneedlock_admin_token_return",
    "sneedlock_admin_token_rescue",
    "sneedlock_admin_pool_deposit",
    "sneedlock_admin_pool_withdraw",
    "sneedlock_config_update",
  ];

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

  public func supportedBlockTypes() : [T.BlockType] {
    Array.map<Text, T.BlockType>(BLOCK_TYPES, func(t) { { block_type = t; url = BLOCK_TYPES_URL } });
  };

  public func status(state : State, spilling : Bool) : T.LogStatus {
    {
      log_length = state.log_length;
      live_blocks = state.live.count;
      live_first_index = state.live.first_index;
      last_block_hash = state.last_hash;
      archives = state.archives;
      settings = state.settings;
      history_imported = state.history_imported;
      spilling;
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
};
