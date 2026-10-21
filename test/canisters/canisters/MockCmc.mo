/// Test double for the cycles minting canister: a fixed ICP/XDR rate and a
/// notify_top_up that records what it was asked and answers as configured
/// (set_mode), or fails (set_fail: #reject throws at the caller, #processing
/// answers #Err(#Processing)) until set_fail(#none).
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Error "mo:base/Error";

persistent actor MockCmc {
  public type NotifyError = {
    #Refunded : { block_index : ?Nat64; reason : Text }; #InvalidTransaction : Text; #Other : { error_message : Text; error_code : Nat64 };
    #Processing; #TransactionTooOld : Nat64;
  };
  stable var rate : Nat64 = 35_000; // 3.5 XDR per ICP
  stable var mode : { #ok; #refund } = #ok;
  transient let notifications = Buffer.Buffer<(Nat64, Principal)>(8);
  transient var fail : { #none; #reject; #processing } = #none;

  public query func get_icp_xdr_conversion_rate() : async { data : { xdr_permyriad_per_icp : Nat64; timestamp_seconds : Nat64 }; hash_tree : Blob; certificate : Blob } {
    { data = { xdr_permyriad_per_icp = rate; timestamp_seconds = 0 }; hash_tree = ""; certificate = "" };
  };
  public shared func notify_top_up(args : { block_index : Nat64; canister_id : Principal }) : async { #Ok : Nat; #Err : NotifyError } {
    switch (fail) {
      case (#reject) { throw Error.reject("mock CMC: notify rejected") };
      case (#processing) { return #Err(#Processing) };
      case (#none) {};
    };
    notifications.add((args.block_index, args.canister_id));
    switch (mode) {
      case (#ok) { #Ok(1_000_000_000_000) };
      case (#refund) { #Err(#Refunded({ block_index = ?args.block_index; reason = "mock refund" })) };
    };
  };
  public shared func set_rate(r : Nat64) : async () { rate := r };
  public shared func set_mode(m : { #ok; #refund }) : async () { mode := m };
  public shared func set_fail(f : { #none; #reject; #processing }) : async () { fail := f };
  public query func get_notifications() : async [(Nat64, Principal)] { Buffer.toArray(notifications) };
};
