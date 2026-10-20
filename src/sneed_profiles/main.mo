import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Map "mo:map/Map";

import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import Control "../sneed_names/Control";
import Moderation "../sneed_names/Moderation";
import NameIndex "../sneed_names/NameIndex";
import NameRules "../sneed_names/NameRules";
import SnsDirectory "../sneed_names/SnsDirectory";
import TextLog "../sneed_names/TextLog";
import T "../sneed_names/Types";

/// Profiles beyond the name (spec/sneed_names.md §7a). Phase 1: the dapp registry that the
/// dapp labels of sneed_pid_names refer to ("this is me on TACO"). Phase 2 adds profile fields.
shared (deployer) persistent actor class SneedProfiles() = this {

  public type AvatarRef = T.AvatarRef;
  public type Result = T.Result;
  public type DappId = Nat;

  type Dapp = {
    id : DappId;
    var name : Text;
    var url : Text;
    var logo : ?AvatarRef;
    var canisters : [Principal];
    var verified : Bool;
    var hidden : Bool;
    registered_by : Principal;
    created_at : Nat64;
    var updated_at : Nat64;
  };

  public type DappInput = { name : Text; url : Text; logo : ?AvatarRef; canisters : [Principal] };
  public type DappView = {
    id : DappId;
    name : Text;
    url : Text;
    logo : ?AvatarRef;
    canisters : [Principal];
    verified : Bool;
    hidden : Bool;
    registered_by : Principal;
    created_at : Nat64;
    updated_at : Nat64;
  };

  public type Config = {
    max_dapp_canisters : Nat;
    moderator : ?Principal;
    dao_governance : Principal;
    sns_wasm : Principal;
    archive_controllers : [Principal];
  };

  let MAX_BATCH : Nat = 500;
  let MAX_PAGE : Nat = 500;
  let MAX_DAPP_URL : Nat = 200;

  var config : Config = {
    max_dapp_canisters = 10;
    moderator = null;
    dao_governance = Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai");
    sns_wasm = Principal.fromText(SnsDirectory.SNS_W_MAINNET);
    archive_controllers = [];
  };
  var admins : [Principal] = [];

  let dapps = Map.new<DappId, Dapp>();
  var next_dapp_id : DappId = 1;
  let dapp_index : NameIndex.State<DappId> = NameIndex.init<DappId>(); // unique dapp names, search

  let sns : SnsDirectory.State = SnsDirectory.init();
  let textlog : TextLog.State = TextLog.init();
  var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();

  func now64() : Nat64 = Nat64.fromNat(Int.abs(Time.now()));
  func self() : Principal = Principal.fromActor(this);
  func isAdmin(p : Principal) : Bool = Principal.isController(p) or Array.find<Principal>(admins, func(a) = a == p) != null;
  func pv(p : Principal) : T3.Value = Icrc3Log.principal(p);

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_profiles#block-types";
    block_types = ["sneedprofiles_dapp_register", "sneedprofiles_dapp_update", "sneedprofiles_dapp_verify", "sneedprofiles_config_update"];
  };

  func icrc3_env() : Icrc3Log.Environment {
    {
      self = self();
      archive_controllers = config.archive_controllers;
      cycle_reserve = 2_000_000_000_000;
      new_correlation_id = func() : Nat = TextLog.correlationId(textlog);
      log_info = func(cid : Nat, m : Text) = TextLog.add(textlog, #info, cid, self(), m);
      log_error = func(cid : Nat, m : Text) = TextLog.add(textlog, #error, cid, self(), m);
    };
  };

  func block(btype : Text, caller : Principal, tx : [(Text, T3.Value)]) {
    ignore Icrc3Log.append(icrc3, "sneedprofiles_" # btype, Int.abs(Time.now()), Array.append<(Text, T3.Value)>([("caller", pv(caller))], tx));
  };

  func dappView(d : Dapp) : DappView = {
    id = d.id;
    name = d.name;
    url = d.url;
    logo = d.logo;
    canisters = d.canisters;
    verified = d.verified;
    hidden = d.hidden;
    registered_by = d.registered_by;
    created_at = d.created_at;
    updated_at = d.updated_at;
  };

  // ---------------------------------------------------------------------------------------------
  // Dapp registry
  // ---------------------------------------------------------------------------------------------

  func dappProblem(d : DappInput) : ?Text {
    switch (NameRules.problem(d.name, 1)) { case (?p) return ?p; case null {} };
    if (d.url.size() > MAX_DAPP_URL or not Text.startsWith(d.url, #text "https://")) return ?"The dapp's link must start with https:// (max 200 characters)";
    switch (d.logo) { case (?l) switch (T.avatarProblem(l)) { case (?p) return ?p; case null {} }; case null {} };
    if (d.canisters.size() == 0 or d.canisters.size() > config.max_dapp_canisters) return ?("List 1 to " # Nat.toText(config.max_dapp_canisters) # " of the dapp's canisters");
    for (c in d.canisters.vals()) if (not T.isCanisterId(c)) return ?"The dapp's canisters must be canister ids";
    null;
  };

  func controlsAny(caller : Principal, cs : [Principal]) : async* Bool {
    for (c in cs.vals()) {
      switch (await* Control.controls(sns, config.sns_wasm, caller, c)) { case (#ok) return true; case (#err _) {} };
    };
    false;
  };

  func nameFree(name : Text, id : DappId) : Bool = switch (NameIndex.owner<DappId>(dapp_index, 0, name)) {
    case null true;
    case (?x) x == id;
  };

  /// Register a dapp, as a controller of at least one of its canisters (or as the governance of the
  /// SNS that controls one). Dapp names are unique regardless of capitals.
  public shared ({ caller }) func register_dapp(d : DappInput) : async T.ResultNat {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    switch (dappProblem(d)) { case (?p) return #err(p); case null {} };
    if (not nameFree(d.name, 0)) return #err("A dapp with that name is registered");
    if (not isAdmin(caller) and not (await* controlsAny(caller, d.canisters))) return #err("You must control at least one of the dapp's canisters");
    switch (await* Moderation.check(config.moderator, caller, d.name, true)) { case (#err(e)) return #err(e); case (#ok) {} };
    if (not nameFree(d.name, 0)) return #err("A dapp with that name is registered");
    let id = next_dapp_id;
    next_dapp_id += 1;
    let t = now64();
    Map.set<DappId, Dapp>(dapps, Map.nhash, id, { id; var name = d.name; var url = d.url; var logo = d.logo; var canisters = d.canisters; var verified = false; var hidden = false; registered_by = caller; created_at = t; var updated_at = t });
    NameIndex.add<DappId>(dapp_index, 0, d.name, id);
    block("dapp_register", caller, [("dapp", #Nat(id)), ("name", #Text(d.name)), ("url", #Text(d.url)), ("canisters", #Array(Array.map<Principal, T3.Value>(d.canisters, pv)))]);
    #ok(id);
  };

  /// Update a dapp, as a controller of one of its current canisters (or the governance of the SNS
  /// that controls one) or an admin. New canisters must include one the caller controls too.
  /// A new name loses the checkmark, and so does adding a canister, unless an admin does it.
  public shared ({ caller }) func update_dapp(id : DappId, d : DappInput) : async Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    switch (dappProblem(d)) { case (?p) return #err(p); case null {} };
    if (not Map.has(dapps, Map.nhash, id)) return #err("No such dapp");
    if (not nameFree(d.name, id)) return #err("A dapp with that name is registered");
    let current = switch (Map.get(dapps, Map.nhash, id)) { case (?x) x.canisters; case null return #err("No such dapp") };
    let admin = isAdmin(caller);
    // the caller must manage the entry as it stands, not just the canisters it would list
    if (not admin and not (await* controlsAny(caller, current))) return #err("You must control at least one of the dapp's current canisters");
    if (not admin and not (await* controlsAny(caller, d.canisters))) return #err("You must control at least one of the dapp's canisters");
    let existing = switch (Map.get(dapps, Map.nhash, id)) { case (?x) x; case null return #err("No such dapp") };
    // checked against the canisters as they were: refuse if they changed while we were asking
    if (not samePrincipals(existing.canisters, current)) return #err("The dapp was changed meanwhile; please try again");
    var cleared = false;
    if (d.name != existing.name) {
      switch (await* Moderation.check(config.moderator, caller, d.name, true)) { case (#err(e)) return #err(e); case (#ok) {} };
      if (not nameFree(d.name, id)) return #err("A dapp with that name is registered");
      if (not samePrincipals(existing.canisters, current)) return #err("The dapp was changed meanwhile; please try again");
      NameIndex.remove<DappId>(dapp_index, 0, existing.name);
      NameIndex.add<DappId>(dapp_index, 0, d.name, id);
      if (existing.verified) cleared := true;
      existing.verified := false;
    };
    // a canister added by anyone but an admin is not covered by the checkmark
    let added = Array.find<Principal>(d.canisters, func(c) = Array.find<Principal>(existing.canisters, func(x) = x == c) == null) != null;
    if (added and not admin and existing.verified) {
      existing.verified := false;
      cleared := true;
    };
    existing.name := d.name;
    existing.url := d.url;
    existing.logo := d.logo;
    existing.canisters := d.canisters;
    existing.updated_at := now64();
    block("dapp_update", caller, Array.append<(Text, T3.Value)>([("dapp", #Nat(id)), ("name", #Text(d.name)), ("url", #Text(d.url)), ("canisters", #Array(Array.map<Principal, T3.Value>(d.canisters, pv)))], if (cleared) [("verification_cleared", #Nat(1))] else []));
    #ok("Updated");
  };

  func samePrincipals(a : [Principal], b : [Principal]) : Bool = Array.equal<Principal>(a, b, Principal.equal);

  func applyVerify(id : DappId, value : Bool, caller : Principal) : Result {
    switch (Map.get(dapps, Map.nhash, id)) {
      case (?d) {
        d.verified := value;
        d.updated_at := now64();
        block("dapp_verify", caller, [("dapp", #Nat(id)), ("name", #Text(d.name)), ("verified", #Nat(if value 1 else 0))]);
        #ok(if value "Verified" else "Unverified");
      };
      case null #err("No such dapp");
    };
  };

  public shared ({ caller }) func verify_dapp(id : DappId, value : Bool) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    applyVerify(id, value, caller);
  };

  /// Generic nervous system function target: Sneed DAO verifies (or unverifies) a dapp.
  public shared ({ caller }) func verify_dapp_by_dao(id : DappId, value : Bool) : async () {
    if (caller != config.dao_governance) Debug.trap("Only Sneed DAO governance");
    switch (applyVerify(id, value, caller)) { case (#ok _) {}; case (#err(e)) Debug.trap(e) };
  };

  public query func validate_verify_dapp_by_dao(id : DappId, value : Bool) : async T.ValidationResult {
    switch (Map.get(dapps, Map.nhash, id)) {
      case (?d) #Ok((if value "Verify" else "Unverify") # " the dapp \"" # d.name # "\" (" # d.url # ")");
      case null #Err("No such dapp");
    };
  };

  public shared ({ caller }) func admin_hide_dapp(id : DappId, hidden : Bool) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (Map.get(dapps, Map.nhash, id)) {
      case (?d) {
        d.hidden := hidden;
        d.updated_at := now64();
        block("dapp_update", caller, [("dapp", #Nat(id)), ("hidden", #Nat(if hidden 1 else 0))]);
        #ok(if hidden "Hidden" else "Shown");
      };
      case null #err("No such dapp");
    };
  };

  /// Registered dapps (hidden ones left out), by id, a page at a time.
  public query func list_dapps(page : T.Page<DappId>) : async { items : [DappView]; next : ?DappId } {
    let limit = Nat.min(page.limit, MAX_PAGE);
    let out = Buffer.Buffer<DappView>(limit);
    var next : ?DappId = null;
    var id = switch (page.start_after) { case (?s) s + 1; case null 1 };
    label walk while (id < next_dapp_id) {
      switch (Map.get(dapps, Map.nhash, id)) {
        case (?d) if (not d.hidden) {
          if (out.size() >= limit) { next := ?(id - 1); break walk };
          out.add(dappView(d));
        };
        case null {};
      };
      id += 1;
    };
    { items = Buffer.toArray(out); next };
  };

  /// Dapps by id (hidden ones too, flagged), up to 500.
  public query func get_dapps(ids : [DappId]) : async [?DappView] {
    if (ids.size() > MAX_BATCH) Debug.trap("At most 500 dapps per call");
    Array.map<DappId, ?DappView>(ids, func(id) = switch (Map.get(dapps, Map.nhash, id)) { case (?d) ?dappView(d); case null null });
  };

  /// Dapps whose name, or a word in it, starts with `prefix` (hidden ones left out).
  public query func search_dapps(prefix : Text, limit : Nat) : async [DappView] {
    let keep = func(id : DappId) : Bool = switch (Map.get(dapps, Map.nhash, id)) { case (?d) not d.hidden; case null false };
    let hits = NameIndex.search<DappId>(dapp_index, 0, prefix, limit, keep, Nat.equal);
    Array.mapFilter<(DappId, Text), DappView>(hits, func((id, _)) = switch (Map.get(dapps, Map.nhash, id)) { case (?d) ?dappView(d); case null null });
  };

  // ---------------------------------------------------------------------------------------------
  // Administration
  // ---------------------------------------------------------------------------------------------

  public query func stats() : async { dapps : Nat; log_length : Nat } { { dapps = Map.size(dapps); log_length = icrc3.log_length } };
  public query func get_config() : async Config { config };
  public query func get_admins() : async [Principal] { admins };
  public query ({ caller }) func get_log(start : Nat, length : Nat) : async [T.LogEntry] {
    if (not isAdmin(caller)) Debug.trap("Admins only");
    TextLog.get(textlog, start, length);
  };

  public shared ({ caller }) func admin_set_config(c : Config) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (c.max_dapp_canisters < 1 or c.max_dapp_canisters > 100) return #err("max_dapp_canisters must be 1-100");
    if (c.archive_controllers.size() > 10) return #err("At most 10 archive controllers");
    config := c;
    block("config_update", caller, [("config", #Text(debug_show (c)))]);
    #ok("Config updated");
  };

  public shared ({ caller }) func admin_add_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (Array.find<Principal>(admins, func(a) = a == p) != null) return #ok("Already an admin");
    admins := Array.append(admins, [p]);
    block("config_update", caller, [("admin_added", pv(p))]);
    #ok("Added");
  };

  public shared ({ caller }) func admin_remove_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    admins := Array.filter<Principal>(admins, func(a) = a != p);
    block("config_update", caller, [("admin_removed", pv(p))]);
    #ok("Removed");
  };

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 interface
  // ---------------------------------------------------------------------------------------------

  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Icrc3Log.getBlocks(icrc3, args) };
  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Icrc3Log.getArchives(icrc3, args) };
  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Icrc3Log.tipCertificate(icrc3) };
  public query func icrc3_supported_block_types() : async [T3.BlockType] { Icrc3Log.supportedBlockTypes(icrc3_catalogue) };
  public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Icrc3Log.supportedStandards() };
  public query func icrc3_log_status() : async T3.LogStatus { Icrc3Log.status(icrc3, icrc3_rt) };

  public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    if (not isAdmin(caller)) return #Err("Admins only");
    switch (Icrc3Log.applySettings(icrc3, u)) {
      case (#Err(e)) #Err(e);
      case (#Ok(changes)) {
        for ((key, old, new) in changes.vals()) block("config_update", caller, [("key", #Text(key)), ("old_value", #Nat(old)), ("value", #Nat(new))]);
        #Ok(icrc3.settings);
      };
    };
  };

  public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) return #Err("Admins only");
    if (icrc3_rt.spilling) return #Err("A spill is already in progress");
    #Ok(await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
  };

  public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
    if (not isAdmin(caller)) Debug.trap("Admins only");
    await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
  };

  func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };
  func ensure_icrc3_timer<system>() { Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job) };

  system func postupgrade() {
    Icrc3Log.certify(icrc3);
    ensure_icrc3_timer<system>();
  };

  // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
  // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
  public query func get_api_doc() : async Text { ApiDoc.text };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo)
  // ---------------------------------------------------------------------------------------------

  system func inspect({ caller : Principal; arg : Blob; msg : {
    #get_api_doc : Any;
    #admin_add_admin : Any;
    #admin_hide_dapp : Any;
    #admin_icrc3_repair_archive_controllers : Any;
    #admin_icrc3_spill_now : Any;
    #admin_remove_admin : Any;
    #admin_set_config : Any;
    #admin_set_icrc3_settings : Any;
    #get_admins : Any;
    #get_config : Any;
    #get_dapps : Any;
    #get_log : Any;
    #icrc10_supported_standards : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_log_status : Any;
    #icrc3_supported_block_types : Any;
    #list_dapps : Any;
    #register_dapp : Any;
    #search_dapps : Any;
    #stats : Any;
    #update_dapp : Any;
    #validate_verify_dapp_by_dao : Any;
    #verify_dapp : Any;
    #verify_dapp_by_dao : Any;
  } }) : Bool {
    switch msg {
      // queries are free as queries; as updates the canister would pay for consensus
      case (#get_api_doc _ or #get_admins _ or #get_config _ or #get_dapps _ or #get_log _ or #icrc10_supported_standards _ or #icrc3_get_archives _ or #icrc3_get_blocks _ or #icrc3_get_tip_certificate _ or #icrc3_log_status _ or #icrc3_supported_block_types _ or #list_dapps _ or #search_dapps _ or #stats _ or #validate_verify_dapp_by_dao _) false;
      // only governance canisters call these, never by ingress
      case (#verify_dapp_by_dao _) false;
      case (#admin_set_config _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(1_000);
      case (#admin_set_icrc3_settings _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#admin_add_admin _ or #admin_hide_dapp _ or #admin_icrc3_repair_archive_controllers _ or #admin_icrc3_spill_now _ or #admin_remove_admin _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#verify_dapp _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#register_dapp _ or #update_dapp _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(1_000);
      case _ not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };

  ensure_icrc3_timer<system>();
};
