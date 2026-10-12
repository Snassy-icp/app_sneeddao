/// Archive canister of an ICRC-3 block log (shared library, see src/icrc3/Log.mo).
///
/// Created by the logging canister (the "parent") when its live block store fills up.
/// Stores one contiguous range of already encoded blocks in stable memory
/// Regions, so capacity is bounded by the canister's stable memory allowance
/// rather than the Motoko heap. The only write path is `append_blocks`, which
/// accepts batches from the parent alone; blocks are never altered or removed.
///
/// Design: spec/sneed_lock_icrc3.md (the sneed_lock instance; the library is generic).
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Cycles "mo:base/ExperimentalCycles";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Region "mo:base/Region";

import T "Types";

shared ({ caller = parent }) persistent actor class Icrc3Archive(init : T.ArchiveInit) = this {

  // Global index of the first block held here and the capacity in blocks.
  // Captured at install; ignored on upgrade (the fields are stable).
  stable let first_index : Nat = init.first_index;
  stable let max_blocks : Nat = init.max_blocks;

  stable var block_count : Nat = 0;
  stable var data_bytes : Nat64 = 0; // bytes used in data_region

  // index_region: per block, 8 bytes offset + 4 bytes length into data_region
  stable let index_region : Region.Region = Region.new();
  stable let data_region : Region.Region = Region.new();

  transient let INDEX_ENTRY_BYTES : Nat64 = 12;
  transient let PAGE_BYTES : Nat64 = 65536;
  transient let MAX_RESPONSE_BLOCKS : Nat = 1000;
  transient let MAX_RESPONSE_BYTES : Nat = 1_500_000;

  // Grow a region so that at least `needed` bytes are addressable. Traps if the
  // subnet refuses, which rolls the whole append back.
  private func ensure_capacity(region : Region.Region, needed : Nat64) {
    let have = Region.size(region) * PAGE_BYTES;
    if (needed > have) {
      let more = (needed - have + PAGE_BYTES - 1) / PAGE_BYTES;
      if (Region.grow(region, more) == 0xFFFF_FFFF_FFFF_FFFF) {
        assert false; // out of stable memory
      };
    };
  };

  private func load_block(i : Nat) : Blob {
    let entry = Nat64.fromNat(i) * INDEX_ENTRY_BYTES;
    let offset = Region.loadNat64(index_region, entry);
    let length = Region.loadNat32(index_region, entry + 8);
    Region.loadBlob(data_region, offset, Nat32.toNat(length));
  };

  /// Append a batch of consecutive blocks. Idempotent: a batch that is already
  /// stored in full returns `#Ok` without writing. Any gap, overlap or overflow
  /// is refused and nothing is written.
  public shared ({ caller }) func append_blocks(args : T.AppendBlocksArgs) : async T.AppendBlocksResult {
    if (caller != parent) {
      return #Err("Only the parent canister " # Principal.toText(parent) # " may append blocks");
    };
    let next = first_index + block_count;
    let n = args.blocks.size();
    if (n == 0) { return #Ok(block_count) };
    if (args.first_index + n <= next) {
      return #Ok(block_count); // already stored (a lost reply was retried)
    };
    if (args.first_index != next) {
      return #Err("Expected first_index " # Nat.toText(next) # " but got " # Nat.toText(args.first_index));
    };
    if (block_count + n > max_blocks) {
      return #Err("Archive is full: " # Nat.toText(block_count) # " + " # Nat.toText(n) # " > " # Nat.toText(max_blocks));
    };
    var total : Nat64 = 0;
    for (b in args.blocks.vals()) { total += Nat64.fromNat(b.size()) };
    ensure_capacity(data_region, data_bytes + total);
    ensure_capacity(index_region, (Nat64.fromNat(block_count + n)) * INDEX_ENTRY_BYTES);
    for (b in args.blocks.vals()) {
      let entry = Nat64.fromNat(block_count) * INDEX_ENTRY_BYTES;
      Region.storeBlob(data_region, data_bytes, b);
      Region.storeNat64(index_region, entry, data_bytes);
      Region.storeNat32(index_region, entry + 8, Nat32.fromNat(b.size()));
      data_bytes += Nat64.fromNat(b.size());
      block_count += 1;
    };
    #Ok(block_count);
  };

  /// ICRC-3 block read for the range this archive holds. Ranges outside it are
  /// ignored. Responses are capped by block count and bytes.
  public query func icrc3_get_blocks(args : T.GetBlocksArgs) : async T.GetBlocksResult {
    let out = Buffer.Buffer<T.Block>(64);
    var bytes = 0;
    let end_held = first_index + block_count;
    label ranges for (range in args.vals()) {
      let lo = Nat.max(range.start, first_index);
      let hi = Nat.min(range.start + range.length, end_held);
      if (lo >= hi) { continue ranges };
      var i = lo;
      while (i < hi) {
        if (out.size() >= MAX_RESPONSE_BLOCKS or bytes >= MAX_RESPONSE_BYTES) { break ranges };
        let blob = load_block(i - first_index);
        switch (from_candid(blob) : ?T.Value) {
          case (?block) { out.add({ id = i; block }); bytes += blob.size() };
          case null {}; // cannot happen: only the parent writes, with to_candid
        };
        i += 1;
      };
    };
    { log_length = end_held; blocks = Buffer.toArray(out); archived_blocks = [] };
  };

  public query func archive_status() : async T.ArchiveStatus {
    {
      parent;
      first_index;
      block_count;
      max_blocks;
      cycles = Cycles.balance();
      data_bytes = Nat64.toNat(data_bytes);
    };
  };

  /// Accept cycles from anyone (the parent tops archives up from its balance).
  public shared func deposit_cycles() : async () {
    ignore Cycles.accept<system>(Cycles.available());
  };

  // Ingress messages never come from the parent canister, so reject them for
  // the write method before they cost any cycles.
  system func inspect({
    msg : {
      #append_blocks : () -> T.AppendBlocksArgs;
      #archive_status : () -> ();
      #deposit_cycles : () -> ();
      #icrc3_get_blocks : () -> T.GetBlocksArgs;
    };
  }) : Bool {
    switch (msg) {
      case (#append_blocks _) { false };
      case _ { true };
    };
  };

};
