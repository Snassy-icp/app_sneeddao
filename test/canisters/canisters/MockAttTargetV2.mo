/// MockAttTarget with another version: a second module hash for sneed_attestations' tests.
persistent actor MockAttTargetV2 {
  public query func version() : async Nat { 2 };
};
