import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import OrderedMap "mo:base/OrderedMap";
import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Dedup "mo:dedup";
import Map "mo:map/Map";

import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import Moderation "../sneed_names/Moderation";
import NameIndex "../sneed_names/NameIndex";
import NameRules "../sneed_names/NameRules";
import SnsDirectory "../sneed_names/SnsDirectory";
import TextLog "../sneed_names/TextLog";
import T "../sneed_names/Types";

/// Public names of SNS neurons, unique per SNS (spec/sneed_names.md §5).
shared (deployer) persistent actor class SneedNeuronNames() = this {

  public type AvatarRef = T.AvatarRef;
  public type Verification = T.Verification;
  public type Result = T.Result;
  public type NeuronKey = { sns_root : Principal; neuron_id : Blob };

  type NeuronName = {
    var name : Text;
    var verification : ?Verification;
    var avatar : ?AvatarRef;
    var set_by : Principal;
    var updated_at : Nat64;
  };

  public type Config = {
    moderator : ?Principal;
    dao_governance : Principal;
    sns_wasm : Principal;
    archive_controllers : [Principal];
  };

  public type NeuronNameInfo = { name : Text; verified : Bool; avatar : ?AvatarRef };
  public type NeuronNameView = {
    sns_root : Principal;
    neuron_id : Blob;
    name : Text;
    verified : Bool;
    verification : ?Verification;
    avatar : ?AvatarRef;
    set_by : Principal;
    updated_at : Nat64;
  };
  public type Change = { seq : Nat; key : NeuronKey; state : ?NeuronNameView }; // null: removed
  public type ImportItem = { sns_root : Principal; neuron_id : Blob; name : Text; verified : Bool };
  public type ImportResult = { key : NeuronKey; result : Result };
  public type Stats = { names : Nat; snses : Nat; last_seq : Nat; log_length : Nat; import_closed : Bool };

  // ---------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------

  let MAX_BATCH : Nat = 500;
  let MAX_PAGE : Nat = 500;
  let MAX_NEURON_ID : Nat = 64;

  var config : Config = {
    moderator = null;
    dao_governance = Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai");
    sns_wasm = Principal.fromText(SnsDirectory.SNS_W_MAINNET);
    archive_controllers = [];
  };
  var admins : [Principal] = [];
  var import_closed : Bool = false;

  // SNS roots are deduplicated to a Nat32 index (a few hundred roots, repeated on every key);
  // a neuron's key is the 4-byte root index followed by its id.
  let roots : Dedup.DedupState = Dedup.empty();
  let neurons = Map.new<Blob, NeuronName>();
  let index : NameIndex.State<Blob> = NameIndex.init<Blob>(); // scope = root index, ref = neuron id

  func Nat_ops() : OrderedMap.Operations<Nat> = OrderedMap.Make<Nat>(Nat.compare);
  func Blob_ops() : OrderedMap.Operations<Blob> = OrderedMap.Make<Blob>(Blob.compare);
  var seq : Nat = 0;
  var changes : OrderedMap.Map<Nat, Blob> = Nat_ops().empty<Blob>();
  var last_change : OrderedMap.Map<Blob, Nat> = Blob_ops().empty<Nat>();

  let sns : SnsDirectory.State = SnsDirectory.init();
  let textlog : TextLog.State = TextLog.init();
  var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  func now64() : Nat64 = Nat64.fromNat(Int.abs(Time.now()));
  func self() : Principal = Principal.fromActor(this);
  func isAdmin(p : Principal) : Bool = Principal.isController(p) or Array.find<Principal>(admins, func(a) = a == p) != null;

  func scopeBytes(s : Nat32) : [Nat8] = [
    Nat8.fromNat(Nat32.toNat((s >> 24) & 0xff)),
    Nat8.fromNat(Nat32.toNat((s >> 16) & 0xff)),
    Nat8.fromNat(Nat32.toNat((s >> 8) & 0xff)),
    Nat8.fromNat(Nat32.toNat(s & 0xff)),
  ];
  func keyOf(scope : Nat32, neuronId : Blob) : Blob = Blob.fromArray(Array.append(scopeBytes(scope), Blob.toArray(neuronId)));
  /// The key of an existing SNS's neuron (null when the root never had a name here).
  func findKey(k : NeuronKey) : ?(Nat32, Blob) = switch (Dedup.getIndexForPrincipal(roots, k.sns_root)) {
    case (?s) ?(s, keyOf(s, k.neuron_id));
    case null null;
  };
  func splitKey(key : Blob) : NeuronKey {
    let b = Blob.toArray(key);
    let s = Nat32.fromNat(Nat8.toNat(b[0])) << 24 | Nat32.fromNat(Nat8.toNat(b[1])) << 16 | Nat32.fromNat(Nat8.toNat(b[2])) << 8 | Nat32.fromNat(Nat8.toNat(b[3]));
    let root = switch (Dedup.getPrincipalForIndex(roots, s)) { case (?p) p; case null Principal.fromText("aaaaa-aa") };
    { sns_root = root; neuron_id = Blob.fromArray(Array.subArray<Nat8>(b, 4, b.size() - 4)) };
  };

  func verified(n : NeuronName) : Bool = switch (n.verification) { case (?v) v.name == n.name; case null false };

  func view(key : Blob, n : NeuronName) : NeuronNameView {
    let k = splitKey(key);
    { sns_root = k.sns_root; neuron_id = k.neuron_id; name = n.name; verified = verified(n); verification = n.verification; avatar = n.avatar; set_by = n.set_by; updated_at = n.updated_at };
  };

  func touch(key : Blob) {
    switch (Blob_ops().get(last_change, key)) { case (?old) changes := Nat_ops().delete(changes, old); case null {} };
    seq += 1;
    changes := Nat_ops().put(changes, seq, key);
    last_change := Blob_ops().put(last_change, key, seq);
  };

  func nameFree(scope : Nat32, name : Text, neuronId : Blob) : Bool = switch (NameIndex.owner<Blob>(index, scope, name)) {
    case null true;
    case (?id) id == neuronId;
  };

  // ---- ICRC-3 ----

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_neuron_names#block-types";
    block_types = [
      "sneedneuronnames_name_set",
      "sneedneuronnames_avatar_set",
      "sneedneuronnames_verify",
      "sneedneuronnames_unverify",
      "sneedneuronnames_config_update",
      "sneedneuronnames_import",
    ];
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
    ignore Icrc3Log.append(icrc3, "sneedneuronnames_" # btype, Int.abs(Time.now()), Array.append<(Text, T3.Value)>([("caller", Icrc3Log.principal(caller))], tx));
  };
  func keyFields(k : NeuronKey) : [(Text, T3.Value)] = [("sns_root", Icrc3Log.principal(k.sns_root)), ("neuron_id", #Blob(k.neuron_id))];
  func sourceValue(s : T.VerifySource) : T3.Value = switch s {
    case (#admin(p)) #Map([("admin", Icrc3Log.principal(p))]);
    case (#dao) #Text("dao");
    case (#sns_governance(p)) #Map([("sns_governance", Icrc3Log.principal(p))]);
    case (#import_) #Text("import");
  };

  /// Set (or with "" remove) a neuron's name. The caller has validated the name and checked it is free.
  func applyName(k : NeuronKey, name : Text, caller : Principal) {
    let scope = Dedup.getOrCreateIndexForPrincipal(roots, k.sns_root);
    let key = keyOf(scope, k.neuron_id);
    switch (Map.get(neurons, Map.bhash, key)) {
      case (?n) {
        NameIndex.remove<Blob>(index, scope, n.name);
        if (name == "") {
          Map.delete(neurons, Map.bhash, key);
          block("name_set", caller, Array.flatten<(Text, T3.Value)>([keyFields(k), [("old_name", #Text(n.name))]]));
        } else {
          let old = n.name;
          NameIndex.add<Blob>(index, scope, name, k.neuron_id);
          n.name := name;
          let cleared = switch (n.verification) { case (?v) v.name != name; case null false };
          if (cleared) n.verification := null;
          n.set_by := caller;
          n.updated_at := now64();
          block("name_set", caller, Array.flatten<(Text, T3.Value)>([keyFields(k), [("old_name", #Text(old)), ("name", #Text(name))], if (cleared) [("verification_cleared", #Nat(1))] else []]));
        };
      };
      case null {
        if (name == "") return;
        NameIndex.add<Blob>(index, scope, name, k.neuron_id);
        Map.set<Blob, NeuronName>(neurons, Map.bhash, key, { var name = name; var verification = null; var avatar = null; var set_by = caller; var updated_at = now64() });
        block("name_set", caller, Array.flatten<(Text, T3.Value)>([keyFields(k), [("name", #Text(name))]]));
      };
    };
    touch(key);
  };

  /// The caller may name the neuron: it has a permission on it, per the governance of a deployed SNS.
  func mayName(caller : Principal, k : NeuronKey) : async* { #ok; #err : Text } {
    if (isAdmin(caller)) return #ok;
    let governance = switch (await* SnsDirectory.governanceOf(sns, config.sns_wasm, k.sns_root)) {
      case (?g) g;
      case null return #err("Not a deployed SNS");
    };
    let neuron = switch (await* SnsDirectory.getNeuron(governance, k.neuron_id)) {
      case (?n) n;
      case null return #err("No such neuron in that SNS");
    };
    if (not SnsDirectory.hasAnyPermission(neuron, caller)) return #err("You have no permission on that neuron");
    #ok;
  };

  func signedIn(caller : Principal) : ?Text = if (Principal.isAnonymous(caller)) ?"Please sign in" else null;

  // ---------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------

  /// Names of up to 500 neurons, in order.
  public query func get_names(keys : [NeuronKey]) : async [?NeuronNameInfo] {
    if (keys.size() > MAX_BATCH) Debug.trap("At most 500 neurons per call");
    Array.map<NeuronKey, ?NeuronNameInfo>(keys, func(k) = switch (findKey(k)) {
      case (?(_, key)) switch (Map.get(neurons, Map.bhash, key)) {
        case (?n) ?{ name = n.name; verified = verified(n); avatar = n.avatar };
        case null null;
      };
      case null null;
    });
  };

  public query func get_name(k : NeuronKey) : async ?NeuronNameView {
    switch (findKey(k)) {
      case (?(_, key)) switch (Map.get(neurons, Map.bhash, key)) { case (?n) ?view(key, n); case null null };
      case null null;
    };
  };

  /// Neurons of one SNS whose name, or a word in it, starts with `prefix`.
  public query func search(args : { sns_root : Principal; prefix : Text; limit : Nat }) : async [NeuronNameView] {
    switch (Dedup.getIndexForPrincipal(roots, args.sns_root)) {
      case (?scope) {
        let hits = NameIndex.search<Blob>(index, scope, args.prefix, args.limit, func(_) = true, Blob.equal);
        Array.mapFilter<(Blob, Text), NeuronNameView>(hits, func((id, _)) {
          let key = keyOf(scope, id);
          switch (Map.get(neurons, Map.bhash, key)) { case (?n) ?view(key, n); case null null };
        });
      };
      case null [];
    };
  };

  /// One SNS's neuron names in alphabetical (lowercase) order, a page at a time.
  public query func list_by_sns(args : { sns_root : Principal; start_after : ?Text; limit : Nat }) : async { items : [NeuronNameView]; next : ?Text } {
    switch (Dedup.getIndexForPrincipal(roots, args.sns_root)) {
      case (?scope) {
        let (items, next) = NameIndex.page<Blob>(index, scope, args.start_after, Nat.min(args.limit, MAX_PAGE));
        {
          items = Array.mapFilter<(Blob, Text), NeuronNameView>(items, func((id, _)) {
            let key = keyOf(scope, id);
            switch (Map.get(neurons, Map.bhash, key)) { case (?n) ?view(key, n); case null null };
          });
          next;
        };
      };
      case null { { items = []; next = null } };
    };
  };

  /// What changed after sequence number `after`, oldest first, each neuron once (null: name removed).
  public query func changes_since(args : { after : Nat; limit : Nat }) : async { items : [Change]; last_seq : Nat } {
    let limit = Nat.min(args.limit, MAX_PAGE);
    let out = Buffer.Buffer<Change>(limit);
    label walk for ((s, key) in NameIndex.entriesFrom<Nat, Blob>(changes, Nat.compare, args.after + 1)) {
      if (out.size() >= limit) break walk;
      out.add({ seq = s; key = splitKey(key); state = switch (Map.get(neurons, Map.bhash, key)) { case (?n) ?view(key, n); case null null } });
    };
    { items = Buffer.toArray(out); last_seq = seq };
  };

  public query func stats() : async Stats {
    { names = Map.size(neurons); snses = Map.size(roots.blobToIndex); last_seq = seq; log_length = icrc3.log_length; import_closed };
  };
  public query func get_config() : async Config { config };
  public query func get_admins() : async [Principal] { admins };
  public query ({ caller }) func get_log(start : Nat, length : Nat) : async [T.LogEntry] {
    if (not isAdmin(caller)) Debug.trap("Admins only");
    TextLog.get(textlog, start, length);
  };

  // ---------------------------------------------------------------------------------------------
  // Naming
  // ---------------------------------------------------------------------------------------------

  /// Name a neuron you have a permission on ("" removes the name). Unique per SNS, any capitals.
  public shared ({ caller }) func set_name(k : NeuronKey, name : Text) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    if (k.neuron_id.size() == 0 or k.neuron_id.size() > MAX_NEURON_ID) return #err("Not a neuron id");
    let taken = func() : Bool = switch (findKey(k)) {
      case (?(scope, _)) not nameFree(scope, name, k.neuron_id);
      case null false;
    };
    if (name != "") {
      switch (NameRules.problem(name, 1)) { case (?p) return #err(p); case null {} };
      if (taken()) return #err("That name is taken in this SNS");
    };
    switch (await* mayName(caller, k)) { case (#err(e)) return #err(e); case (#ok) {} };
    if (name != "") {
      switch (await* Moderation.check(config.moderator, caller, name, true)) { case (#err(e)) return #err(e); case (#ok) {} };
      if (taken()) return #err("That name is taken in this SNS");
    };
    let current = switch (findKey(k)) { case (?(_, key)) Map.get(neurons, Map.bhash, key); case null null };
    switch (current, name) {
      case (null, "") return #ok("Unchanged");
      case (?n, _) if (n.name == name) return #ok("Unchanged");
      case _ {};
    };
    applyName(k, name, caller);
    #ok(if (name == "") "Name removed" else "Name set");
  };

  /// Set or clear a named neuron's avatar.
  public shared ({ caller }) func set_avatar(k : NeuronKey, avatar : ?AvatarRef) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    switch avatar { case (?x) switch (T.avatarProblem(x)) { case (?p) return #err(p); case null {} }; case null {} };
    switch (await* mayName(caller, k)) { case (#err(e)) return #err(e); case (#ok) {} };
    switch (findKey(k)) {
      case (?(_, key)) switch (Map.get(neurons, Map.bhash, key)) {
        case (?n) {
          n.avatar := avatar;
          n.updated_at := now64();
          block("avatar_set", caller, Array.flatten<(Text, T3.Value)>([keyFields(k), switch avatar { case (?#url(u)) [("avatar", #Map([("url", #Text(u))]))]; case (?#blob(h)) [("avatar", #Map([("blob", #Blob(h))]))]; case null [] }]));
          touch(key);
          return #ok(if (avatar == null) "Avatar cleared" else "Avatar set");
        };
        case null {};
      };
      case null {};
    };
    #err("Name the neuron first");
  };

  // ---------------------------------------------------------------------------------------------
  // Verification: admins, Sneed DAO proposals, and an SNS's governance for its own neurons
  // ---------------------------------------------------------------------------------------------

  func checkVerify(k : NeuronKey, expected : Text) : { #ok : (Blob, NeuronName); #err : Text } {
    switch (findKey(k)) {
      case (?(_, key)) switch (Map.get(neurons, Map.bhash, key)) {
        case (?n) if (n.name == expected) #ok((key, n)) else #err("The name is not " # expected);
        case null #err("That neuron has no name");
      };
      case null #err("That neuron has no name");
    };
  };

  func applyVerify(k : NeuronKey, expected : Text, source : T.VerifySource, caller : Principal) : Result {
    switch (checkVerify(k, expected)) {
      case (#ok((key, n))) {
        n.verification := ?{ name = expected; source; at = now64() };
        n.updated_at := now64();
        block("verify", caller, Array.flatten<(Text, T3.Value)>([keyFields(k), [("name", #Text(expected)), ("source", sourceValue(source))]]));
        touch(key);
        #ok("Verified");
      };
      case (#err(e)) #err(e);
    };
  };

  func applyUnverify(k : NeuronKey, caller : Principal) : Result {
    switch (findKey(k)) {
      case (?(_, key)) switch (Map.get(neurons, Map.bhash, key)) {
        case (?n) {
          if (n.verification == null) return #err("Not verified");
          n.verification := null;
          n.updated_at := now64();
          block("unverify", caller, keyFields(k));
          touch(key);
          #ok("Unverified");
        };
        case null #err("That neuron has no name");
      };
      case null #err("That neuron has no name");
    };
  };

  public shared ({ caller }) func verify(k : NeuronKey, expected_name : Text) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    applyVerify(k, expected_name, #admin(caller), caller);
  };

  public shared ({ caller }) func unverify(k : NeuronKey) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    applyUnverify(k, caller);
  };

  /// Called by an SNS's governance canister (a proposal of that SNS) for its own neurons.
  public shared ({ caller }) func verify_by_sns(k : NeuronKey, expected_name : Text) : async Result {
    switch (await* SnsDirectory.governanceOf(sns, config.sns_wasm, k.sns_root)) {
      case (?g) if (g != caller) return #err("Only the governance canister of that SNS");
      case null return #err("Not a deployed SNS");
    };
    applyVerify(k, expected_name, #sns_governance(caller), caller);
  };

  public shared ({ caller }) func unverify_by_sns(k : NeuronKey) : async Result {
    switch (await* SnsDirectory.governanceOf(sns, config.sns_wasm, k.sns_root)) {
      case (?g) if (g != caller) return #err("Only the governance canister of that SNS");
      case null return #err("Not a deployed SNS");
    };
    applyUnverify(k, caller);
  };

  public shared ({ caller }) func verify_by_dao(k : NeuronKey, expected_name : Text) : async () {
    if (caller != config.dao_governance) Debug.trap("Only Sneed DAO governance");
    switch (applyVerify(k, expected_name, #dao, caller)) { case (#ok _) {}; case (#err(e)) Debug.trap(e) };
  };

  public query func validate_verify_by_dao(k : NeuronKey, expected_name : Text) : async T.ValidationResult {
    switch (checkVerify(k, expected_name)) {
      case (#ok(_)) #Ok("Verify the name \"" # expected_name # "\" of a neuron of SNS " # Principal.toText(k.sns_root));
      case (#err(e)) #Err(e);
    };
  };

  public shared ({ caller }) func unverify_by_dao(k : NeuronKey) : async () {
    if (caller != config.dao_governance) Debug.trap("Only Sneed DAO governance");
    switch (applyUnverify(k, caller)) { case (#ok _) {}; case (#err(e)) Debug.trap(e) };
  };

  public query func validate_unverify_by_dao(k : NeuronKey) : async T.ValidationResult {
    switch (findKey(k)) {
      case (?(_, key)) switch (Map.get(neurons, Map.bhash, key)) {
        case (?n) if (n.verification != null) #Ok("Remove the checkmark from the neuron named \"" # n.name # "\"") else #Err("Not verified");
        case null #Err("That neuron has no name");
      };
      case null #Err("That neuron has no name");
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Administration
  // ---------------------------------------------------------------------------------------------

  /// Set or remove a neuron's name (no moderation, no SNS check).
  public shared ({ caller }) func admin_set_name(k : NeuronKey, name : Text) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (name != "") {
      switch (NameRules.problem(name, 1)) { case (?p) return #err(p); case null {} };
      switch (findKey(k)) { case (?(scope, _)) if (not nameFree(scope, name, k.neuron_id)) return #err("That name is taken in this SNS"); case null {} };
    };
    applyName(k, name, caller);
    #ok("Set");
  };

  public shared ({ caller }) func admin_clear_avatar(k : NeuronKey) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (findKey(k)) {
      case (?(_, key)) switch (Map.get(neurons, Map.bhash, key)) {
        case (?n) {
          n.avatar := null;
          block("avatar_set", caller, keyFields(k));
          touch(key);
          #ok("Cleared");
        };
        case null #err("Nothing to clear");
      };
      case null #err("Nothing to clear");
    };
  };

  public shared ({ caller }) func admin_set_config(c : Config) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (c.archive_controllers.size() > 10) return #err("At most 10 archive controllers");
    config := c;
    block("config_update", caller, [("config", #Text(debug_show (c)))]);
    #ok("Config updated");
  };

  public shared ({ caller }) func admin_add_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (Array.find<Principal>(admins, func(a) = a == p) != null) return #ok("Already an admin");
    admins := Array.append(admins, [p]);
    block("config_update", caller, [("admin_added", Icrc3Log.principal(p))]);
    #ok("Added");
  };

  public shared ({ caller }) func admin_remove_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    admins := Array.filter<Principal>(admins, func(a) = a != p);
    block("config_update", caller, [("admin_removed", Icrc3Log.principal(p))]);
    #ok("Removed");
  };

  /// One-time import from the backend (spec §10).
  public shared ({ caller }) func admin_import_names(items : [ImportItem]) : async [ImportResult] {
    if (not isAdmin(caller)) Debug.trap("Admins only");
    if (import_closed) Debug.trap("Import is closed");
    if (items.size() > MAX_BATCH) Debug.trap("At most 500 items per call");
    Array.map<ImportItem, ImportResult>(items, func(it) {
      let k = { sns_root = it.sns_root; neuron_id = it.neuron_id };
      { key = k; result = importOne(it, k, caller) };
    });
  };

  func importOne(it : ImportItem, k : NeuronKey, caller : Principal) : Result {
    if (it.neuron_id.size() == 0 or it.neuron_id.size() > MAX_NEURON_ID) return #err("Not a neuron id");
    switch (NameRules.problem(it.name, 1)) { case (?p) return #err(p); case null {} };
    switch (findKey(k)) {
      case (?(scope, key)) {
        if (Map.has(neurons, Map.bhash, key)) return #err("already imported");
        if (not nameFree(scope, it.name, k.neuron_id)) return #err("name taken");
      };
      case null {};
    };
    applyName(k, it.name, caller);
    switch (findKey(k)) {
      case (?(_, key)) switch (Map.get(neurons, Map.bhash, key)) {
        case (?n) if (it.verified) n.verification := ?{ name = it.name; source = #import_; at = now64() };
        case null {};
      };
      case null {};
    };
    block("import", caller, Array.flatten<(Text, T3.Value)>([keyFields(k), [("name", #Text(it.name)), ("verified", #Nat(if (it.verified) 1 else 0))]]));
    #ok("imported");
  };

  public shared ({ caller }) func admin_finish_import() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    import_closed := true;
    block("config_update", caller, [("import_closed", #Nat(1))]);
    #ok("Import closed");
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
    #admin_clear_avatar : Any;
    #admin_finish_import : Any;
    #admin_icrc3_repair_archive_controllers : Any;
    #admin_icrc3_spill_now : Any;
    #admin_import_names : Any;
    #admin_remove_admin : Any;
    #admin_set_config : Any;
    #admin_set_icrc3_settings : Any;
    #admin_set_name : Any;
    #changes_since : Any;
    #get_admins : Any;
    #get_config : Any;
    #get_log : Any;
    #get_name : Any;
    #get_names : Any;
    #icrc10_supported_standards : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_log_status : Any;
    #icrc3_supported_block_types : Any;
    #list_by_sns : Any;
    #search : Any;
    #set_avatar : Any;
    #set_name : Any;
    #stats : Any;
    #unverify : Any;
    #unverify_by_dao : Any;
    #unverify_by_sns : Any;
    #validate_unverify_by_dao : Any;
    #validate_verify_by_dao : Any;
    #verify : Any;
    #verify_by_dao : Any;
    #verify_by_sns : Any;
  } }) : Bool {
    switch msg {
      // queries are free as queries; as updates the canister would pay for consensus
      case (#get_api_doc _ or #changes_since _ or #get_admins _ or #get_config _ or #get_log _ or #get_name _ or #get_names _ or #icrc10_supported_standards _ or #icrc3_get_archives _ or #icrc3_get_blocks _ or #icrc3_get_tip_certificate _ or #icrc3_log_status _ or #icrc3_supported_block_types _ or #list_by_sns _ or #search _ or #stats _ or #validate_unverify_by_dao _ or #validate_verify_by_dao _) false;
      // only governance canisters call these, never by ingress
      case (#verify_by_dao _ or #unverify_by_dao _ or #verify_by_sns _ or #unverify_by_sns _) false;
      case (#admin_import_names _) isAdmin(caller) and arg.size() <= 2_000_000;
      case (#admin_set_config _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(1_000);
      case (#admin_set_icrc3_settings _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#admin_add_admin _ or #admin_clear_avatar _ or #admin_finish_import _ or #admin_icrc3_repair_archive_controllers _ or #admin_icrc3_spill_now _ or #admin_remove_admin _ or #admin_set_name _ or #unverify _ or #verify _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#set_avatar _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(T.MAX_URL_LENGTH);
      case _ not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };

  ensure_icrc3_timer<system>();
};
