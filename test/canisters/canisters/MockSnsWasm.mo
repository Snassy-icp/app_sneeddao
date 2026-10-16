/// Test double for the SNS wasm canister: serves wasm bytes by hash, as
/// `get_wasm` does on the real one. Tests load the bytes with `set_wasm`.
import Array "mo:base/Array";

persistent actor MockSnsWasm {
  stable var wasms : [(Blob, Blob)] = []; // (hash, bytes)
  stable var latest : [(Text, Text)] = []; // what get_latest_sns_version_pretty answers: (canister type, hex hash)
  public shared func set_latest(entries : [(Text, Text)]) : async () { latest := entries };
  public query func get_latest_sns_version_pretty(_ : Null) : async [(Text, Text)] { latest };
  stable var deployed : [Principal] = []; // roots of "deployed" SNSes
  stable var governances : [(Principal, Principal)] = []; // (root, governance), for the ones that have one
  public shared func set_deployed(roots : [Principal]) : async () { deployed := roots };
  public shared func set_deployed_snses(snses : [(Principal, Principal)]) : async () {
    deployed := Array.map<(Principal, Principal), Principal>(snses, func((r, _)) { r });
    governances := snses;
  };
  public query func list_deployed_snses(_ : {}) : async { instances : [{ root_canister_id : ?Principal; governance_canister_id : ?Principal }] } {
    { instances = Array.map<Principal, { root_canister_id : ?Principal; governance_canister_id : ?Principal }>(deployed, func(r) {
      { root_canister_id = ?r; governance_canister_id = switch (Array.find<(Principal, Principal)>(governances, func((x, _)) { x == r })) { case (?(_, g)) ?g; case null null } };
    }) };
  };

  // the blessed upgrade path, oldest first (what list_upgrade_steps answers)
  public type SnsVersion = { archive_wasm_hash : Blob; root_wasm_hash : Blob; swap_wasm_hash : Blob; ledger_wasm_hash : Blob; governance_wasm_hash : Blob; index_wasm_hash : Blob };
  stable var steps : [SnsVersion] = [];
  public shared func set_steps(s : [{ ledger : Blob; index : Blob; archive : Blob }]) : async () {
    steps := Array.map<{ ledger : Blob; index : Blob; archive : Blob }, SnsVersion>(s, func(x) { { archive_wasm_hash = x.archive; root_wasm_hash = ""; swap_wasm_hash = ""; ledger_wasm_hash = x.ledger; governance_wasm_hash = ""; index_wasm_hash = x.index } });
  };
  public query func list_upgrade_steps(_ : { limit : Nat32; starting_at : ?SnsVersion; sns_governance_canister_id : ?Principal }) : async { steps : [{ version : ?SnsVersion }] } {
    { steps = Array.map<SnsVersion, { version : ?SnsVersion }>(steps, func(v) { { version = ?v } }) };
  };

  public shared func set_wasm(hash : Blob, bytes : Blob) : async () {
    wasms := Array.append(Array.filter<(Blob, Blob)>(wasms, func((h, _)) { h != hash }), [(hash, bytes)]);
  };
  public query func get_wasm(args : { hash : Blob }) : async { wasm : ?{ wasm : Blob; canister_type : Int32; proposal_id : ?Nat64 } } {
    switch (Array.find<(Blob, Blob)>(wasms, func((h, _)) { h == args.hash })) {
      case (?(_, bytes)) { { wasm = ?{ wasm = bytes; canister_type = 0; proposal_id = null } } };
      case null { { wasm = null } };
    };
  };
};
