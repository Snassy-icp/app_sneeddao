/// Test double for the SNS wasm canister: serves wasm bytes by hash, as
/// `get_wasm` does on the real one. Tests load the bytes with `set_wasm`.
import Array "mo:base/Array";

persistent actor MockSnsWasm {
  stable var wasms : [(Blob, Blob)] = []; // (hash, bytes)
  stable var latest : [(Text, Text)] = []; // what get_latest_sns_version_pretty answers: (canister type, hex hash)
  public shared func set_latest(entries : [(Text, Text)]) : async () { latest := entries };
  public query func get_latest_sns_version_pretty(_ : Null) : async [(Text, Text)] { latest };
  stable var deployed : [Principal] = []; // roots of "deployed" SNSes
  public shared func set_deployed(roots : [Principal]) : async () { deployed := roots };
  public query func list_deployed_snses(_ : {}) : async { instances : [{ root_canister_id : ?Principal }] } {
    { instances = Array.map<Principal, { root_canister_id : ?Principal }>(deployed, func(r) { { root_canister_id = ?r } }) };
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
