import IC "mo:base/ExperimentalInternetComputer";

/// An app canister for the sneed_notifications tests: forwards any call (raw Candid), so the
/// test can call notify, request_permission and get_receipts as this canister.
persistent actor {
  public func forward(target : Principal, method : Text, arg : Blob) : async Blob {
    await IC.call(target, method, arg);
  };
};
