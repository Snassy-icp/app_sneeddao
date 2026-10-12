/// Smallest possible canister using the src/icrc3 library, following the
/// recipe in src/icrc3/README.md step by step. Used by the library tests;
/// anyone can append `demo_event` blocks, admin operations are restricted to
/// controllers. Text-log lines are kept in memory so tests can read them.
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Int "mo:base/Int";
import Principal "mo:base/Principal";
import Time "mo:base/Time";

import Log "../../../src/icrc3/Log";
import Sns "../../../src/icrc3/SnsRegister";
import T3 "../../../src/icrc3/Types";

shared ({ caller = deployer }) persistent actor class Icrc3Demo(init : { extra_controller : Principal; cycle_reserve : Nat; timer_seconds : Nat; governance : Principal }) = this {

  // 1. state
  stable var icrc3 : Log.State = Log.init();
  transient let icrc3_rt : Log.Runtime = Log.runtime();
  stable var icrc3_sns : Sns.State = Sns.init();
  transient let icrc3_sns_rt : Sns.Runtime = Sns.runtime();

  // 2. catalogue
  transient let icrc3_catalogue : Log.Config = {
    block_types_url = "https://example.test/demo#block-types";
    block_types = ["demo_event", "demo_config_update"];
  };

  // text log substitute
  transient let lines = Buffer.Buffer<(Nat, Text)>(64);
  transient var next_cid : Nat = 0;
  func new_cid() : Nat { next_cid += 1; next_cid };

  // 3. glue
  private func icrc3_env() : Log.Environment {
    {
      self = Principal.fromActor(this);
      archive_controllers = [init.extra_controller];
      cycle_reserve = init.cycle_reserve;
      new_correlation_id = new_cid;
      log_info = func(cid : Nat, m : Text) { lines.add((cid, "info: " # m)) };
      log_error = func(cid : Nat, m : Text) { lines.add((cid, "error: " # m)) };
    };
  };

  private func icrc3_sns_env() : Sns.Environment {
    {
      governance = init.governance;
      name = "Demo";
      doc_url = "https://example.test/demo";
      new_correlation_id = new_cid;
      log_info = func(cid : Nat, m : Text) { lines.add((cid, "info: " # m)) };
      log_error = func(cid : Nat, m : Text) { lines.add((cid, "error: " # m)) };
    };
  };

  func isAdmin(p : Principal) : Bool { Principal.isController(p) or p == deployer };

  // 4. append
  public shared ({ caller }) func record(fields : [(Text, T3.Value)]) : async Nat {
    let tx = Array.append([("cid", #Nat(new_cid()) : T3.Value), ("caller", Log.principal(caller))], fields);
    Log.append(icrc3, "demo_event", Int.abs(Time.now()), tx);
  };

  /// Append `n` blocks in one call (for filling the live store quickly).
  public shared ({ caller }) func record_many(n : Nat) : async Nat {
    var last = 0;
    var i = 0;
    while (i < n) {
      last := Log.append(icrc3, "demo_event", Int.abs(Time.now()), [("caller", Log.principal(caller)), ("n", #Nat(i))]);
      i += 1;
    };
    last;
  };

  // 5. standard queries
  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Log.getBlocks(icrc3, args) };
  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Log.getArchives(icrc3, args) };
  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Log.tipCertificate(icrc3) };
  public query func icrc3_supported_block_types() : async [T3.BlockType] { Log.supportedBlockTypes(icrc3_catalogue) };
  public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Log.supportedStandards() };
  public query func icrc3_log_status() : async T3.LogStatus { Log.status(icrc3, icrc3_rt) };

  // 6. admin
  public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    switch (Log.applySettings(icrc3, u)) {
      case (#Err(e)) { #Err(e) };
      case (#Ok(changes)) {
        let cid = new_cid();
        for ((key, old_value, new_value) in changes.vals()) {
          ignore Log.append(icrc3, "demo_config_update", Int.abs(Time.now()), [("cid", #Nat(cid)), ("caller", Log.principal(caller)), ("key", #Text(key)), ("value", #Nat(new_value)), ("old_value", #Nat(old_value))]);
        };
        #Ok(icrc3.settings);
      };
    };
  };
  public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    if (icrc3_rt.spilling) { return #Err("A spill is already in progress") };
    let moved = await* Log.spill(icrc3, icrc3_rt, icrc3_env(), true);
    ignore await* Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
    #Ok(moved);
  };
  public query func icrc3_registration_status() : async Sns.Status { Sns.status(icrc3_sns, icrc3_sns_env()) };
  public shared ({ caller }) func admin_set_icrc3_proposal_neuron(neuron : ?Blob) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    Sns.setNeuron(icrc3_sns, neuron);
  };
  public shared ({ caller }) func admin_icrc3_register_archives_now() : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    #Ok(await* Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env()));
  };
  public shared ({ caller }) func admin_icrc3_reset_archive_registration(canister_id : Principal) : async { #Ok : Bool; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    #Ok(Sns.reset(icrc3_sns, canister_id));
  };
  public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
    if (not isAdmin(caller)) { Debug.trap("admin only") };
    await* Log.repairArchiveControllers(icrc3, icrc3_env());
  };

  // 7. background
  private func icrc3_timer_job() : async () {
    ignore await* Log.spill(icrc3, icrc3_rt, icrc3_env(), false);
    ignore await* Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
  };
  private func ensure_icrc3_timer<system>() { Log.ensureTimer<system>(icrc3_rt, init.timer_seconds, icrc3_timer_job) };
  system func postupgrade() { Log.certify(icrc3); ensure_icrc3_timer<system>() };

  // ---- test helpers ----
  public query func logs() : async [(Nat, Text)] { Buffer.toArray(lines) };
  public query func whoami() : async Principal { Principal.fromActor(this) };

  ensure_icrc3_timer<system>();
};
