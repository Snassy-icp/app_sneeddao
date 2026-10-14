/// Test double for the NNS SNS-W canister's `list_deployed_snses`, which the
/// forum reads (at qaa6y-5yaaa-aaaaa-aaafa-cai) to find the governance
/// canister of an SNS root. The tests register (root, governance) pairs.
import Array "mo:base/Array";

persistent actor MockForumSnsW {
  public type DeployedSns = {
    root_canister_id : ?Principal;
    governance_canister_id : ?Principal;
    index_canister_id : ?Principal;
    swap_canister_id : ?Principal;
    ledger_canister_id : ?Principal;
  };
  stable var instances : [DeployedSns] = [];

  public shared func set_instances(pairs : [(Principal, Principal)]) : async () {
    instances := Array.map<(Principal, Principal), DeployedSns>(pairs, func((root, gov)) {
      { root_canister_id = ?root; governance_canister_id = ?gov; index_canister_id = null; swap_canister_id = null; ledger_canister_id = null }
    });
  };
  public query func list_deployed_snses(_ : {}) : async { instances : [DeployedSns] } { { instances } };
};
