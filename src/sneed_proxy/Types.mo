/// Public types of sneed_proxy (spec/sneed_proxy.md §3).
module {

  /// Which proposal topic (and so which GNSF) an allowlist entry belongs to.
  public type Class = { #business; #dapp; #community; #critical; #treasury };

  /// How the proxy reads the target's reply: `#any` = any reply is success; `#result` = a single
  /// top-level variant with an `err`/`Err` tag is failure (spec §3.5).
  public type ReplyMode = { #any; #result };

  /// The payload of every execute_* proposal (and the argument of every validate_* method).
  public type ProxyCall = {
    canister : Principal; // target
    method : Text; // target method
    arg : Blob; // Candid-encoded argument tuple, exactly as the target expects
    note : ?Text; // at most 500 characters, shown in the validator text and logged
    expires_at : ?Nat64; // nanoseconds; refused after this time (stale proposals)
  };

  /// `class_` and `label_` are `class` and `label` in Candid (Motoko keywords take a trailing _).
  public type Entry = {
    canister : Principal;
    method : Text;
    class_ : Class;
    label_ : Text;
    max_arg_bytes : Nat;
    reply : ReplyMode;
    enabled : Bool;
  };

  public type EntryView = {
    canister : Principal;
    method : Text;
    class_ : Class;
    label_ : Text;
    max_arg_bytes : Nat;
    reply : ReplyMode;
    enabled : Bool;
    builtin : Bool; // the proxy's own self_* entries (spec §3.6), fixed in code
  };

  public type CanisterName = { canister : Principal; name : Text };

  public type AllowlistUpdate = {
    upsert : [Entry];
    remove : [(Principal, Text)];
    names : [CanisterName];
    remove_names : [Principal];
  };

  /// What a generic nervous system function validator answers.
  public type ValidationResult = { #Ok : Text; #Err : Text };

  public type InitArgs = {
    governance : Principal; // the only caller of execute_* and set_allowlist
    root : Principal; // SNS root: lists the SNS canisters, co-controls the ICRC-3 archives
  };

  public type Outcome = { #ok; #err; #unknown };

  /// One forwarded call, as kept for get_recent (the full record is the ICRC-3 block).
  public type Forwarded = {
    block : Nat; // ICRC-3 block index
    ts : Nat64;
    function_id : Nat;
    class_ : Class;
    target : Principal;
    method : Text;
    label_ : Text;
    arg_size : Nat;
    arg_hash : Blob;
    payload_hash : Blob;
    note : ?Text;
    outcome : Outcome;
    error : ?Text;
    reply_size : ?Nat;
    reply_hash : ?Blob;
  };

  public type ClassStats = { class_ : Class; forwarded : Nat; ok : Nat; err : Nat; unknown : Nat };

  public type FunctionInfo = {
    id : Nat;
    name : Text;
    topic : Text;
    critical : Bool;
    target_method : Text;
    validator_method : Text;
  };

  public type Config = {
    governance : Principal;
    root : Principal;
    sns_canisters : [Principal]; // refused as targets (from root's list_sns_canisters)
    sns_canisters_refreshed_at : ?Nat64;
    max_in_flight : Nat;
    in_flight : Nat;
    forward_timeout_seconds : Nat;
    functions : [FunctionInfo]; // the GNSFs this proxy expects to be registered
  };

  public type LogEntry = { id : Nat; ts : Int; level : { #info; #error }; cid : Nat; caller : Principal; message : Text };

  /// SNS root's list_sns_canisters reply.
  public type ListSnsCanistersResponse = {
    root : ?Principal;
    swap : ?Principal;
    ledger : ?Principal;
    index : ?Principal;
    governance : ?Principal;
    dapps : [Principal];
    archives : [Principal];
  };
};
