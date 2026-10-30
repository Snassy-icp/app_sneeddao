/// A canister for sneed_attestations' tests to install into: its wasm (raw, or gzipped) is the
/// module a proposal "upgrades" a target to. `MockAttTargetV2.mo` is the same with another version,
/// so its module hash differs.
persistent actor MockAttTarget {
  public query func version() : async Nat { 1 };
};
