/// Types of the ICRC-3 block log library (src/icrc3) shared by a logging canister and its archive canisters.
///
/// The interface types follow the ICRC-3 standard verbatim
/// (https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3). The remaining
/// types are the private protocol between the logging canister and the archives it creates.
module {

  /// Generic ICRC-3 value. Blocks are always the `#Map` variant.
  public type Value = {
    #Blob : Blob;
    #Text : Text;
    #Nat : Nat;
    #Int : Int;
    #Array : [Value];
    #Map : [(Text, Value)];
  };

  public type BlockRange = { start : Nat; length : Nat };
  public type GetBlocksArgs = [BlockRange];

  public type Block = { id : Nat; block : Value };

  public type ArchivedBlocks = {
    args : GetBlocksArgs;
    callback : shared query GetBlocksArgs -> async GetBlocksResult;
  };

  public type GetBlocksResult = {
    log_length : Nat;
    blocks : [Block];
    archived_blocks : [ArchivedBlocks];
  };

  public type GetArchivesArgs = { from : ?Principal };
  public type ArchiveRange = { canister_id : Principal; start : Nat; end : Nat };
  public type GetArchivesResult = [ArchiveRange];

  public type DataCertificate = { certificate : Blob; hash_tree : Blob };

  public type BlockType = { block_type : Text; url : Text };

  public type SupportedStandard = { name : Text; url : Text };

  // -------------------------------------------------------------------------
  // sneed_lock <-> archive protocol
  // -------------------------------------------------------------------------

  /// Installation argument of an archive canister.
  public type ArchiveInit = {
    first_index : Nat; // global index of the first block this archive will hold
    max_blocks : Nat; // capacity in blocks
  };

  /// A batch of consecutive, already encoded (Candid bytes of `Value`) blocks.
  public type AppendBlocksArgs = { first_index : Nat; blocks : [Blob] };

  /// `#Ok` carries the archive's block count after the call.
  public type AppendBlocksResult = { #Ok : Nat; #Err : Text };

  public type ArchiveStatus = {
    parent : Principal;
    first_index : Nat;
    block_count : Nat;
    max_blocks : Nat;
    cycles : Nat;
    data_bytes : Nat;
  };

  // -------------------------------------------------------------------------
  // sneed_lock side bookkeeping (stable)
  // -------------------------------------------------------------------------

  public type ArchiveInfo = {
    canister_id : Principal;
    start : Nat; // global index of the archive's first block
    length : Nat; // blocks stored so far
    max_blocks : Nat;
  };

  public type Settings = {
    max_live_blocks : Nat; // spill when the live store reaches this many blocks
    spill_batch_size : Nat; // blocks per append_blocks call
    archive_max_blocks : Nat; // capacity of newly created archives
    archive_initial_cycles : Nat; // cycles attached when creating an archive
    archive_top_up_threshold : Nat; // top an archive up when below this
    archive_top_up_amount : Nat; // cycles sent per top-up
  };

  public type SettingsUpdate = {
    max_live_blocks : ?Nat;
    spill_batch_size : ?Nat;
    archive_max_blocks : ?Nat;
    archive_initial_cycles : ?Nat;
    archive_top_up_threshold : ?Nat;
    archive_top_up_amount : ?Nat;
  };

  /// Live (not yet archived) blocks, stored encoded, oldest first.
  public type LiveStore = {
    var blocks : [var Blob];
    var count : Nat;
    var first_index : Nat; // global index of blocks[0]
  };

  public type LogStatus = {
    log_length : Nat;
    live_blocks : Nat;
    live_first_index : Nat;
    last_block_hash : ?Blob;
    archives : [ArchiveInfo];
    settings : Settings;
    history_imported : Bool;
    spilling : Bool;
  };
};
