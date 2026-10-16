import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Error "mo:base/Error";
import Int "mo:base/Int";
import Debug "mo:base/Debug";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Option "mo:base/Option";
import Order "mo:base/Order";
import OrderedMap "mo:base/OrderedMap";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Map "mo:map/Map";

import IngressGuard "../IngressGuard";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import Control "../sneed_names/Control";
import Moderation "../sneed_names/Moderation";
import NameIndex "../sneed_names/NameIndex";
import NameRules "../sneed_names/NameRules";
import SnsDirectory "../sneed_names/SnsDirectory";
import TextLog "../sneed_names/TextLog";
import T "../sneed_names/Types";

/// Public names of principals: accounts (one name for all of a person's principals) and canister
/// names. Design: spec/sneed_names.md. The dapp registry the dapp labels refer to is in sneed_profiles.
shared (deployer) persistent actor class SneedPidNames() = this {

  // ---------------------------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------------------------

  public type AvatarRef = T.AvatarRef;
  public type Verification = T.Verification;
  public type AccountId = Nat;
  public type DappId = Nat; // an id in sneed_profiles' dapp registry
  public type Role = { #owner; #member };
  public type LinkProof = {
    #self_; // created the account
    #hotkey; // its account gave the linking account's owner a hotkey, and was merged in
    #neuron_stake : { sns_root : Principal; neuron_id : Blob; memo : Nat64 }; // staked a neuron the caller has a permission on
    #admin;
    #import_;
  };
  public type Member = { principal : Principal; role : Role; dapp : ?DappId; linked_at : Nat64; via : LinkProof };

  type Account = {
    id : AccountId;
    var name : ?Text;
    var verification : ?Verification;
    var avatar : ?AvatarRef;
    var members : [Member];
    var hotkeys : [Principal]; // may manage the account (not shown as the account's principals)
    created_at : Nat64;
    var updated_at : Nat64;
  };

  type CanisterName = {
    canister : Principal;
    var name : Text;
    var verification : ?Verification;
    var avatar : ?AvatarRef;
    var run_by : ?AccountId;
    var set_by : Principal;
    var updated_at : Nat64;
  };

  public type Config = {
    max_members : Nat; // principals per account
    max_hotkeys : Nat; // hotkeys per account
    moderator : ?Principal; // the backend (names_moderate); null = no ban/blacklist check
    dao_governance : Principal; // Sneed SNS governance, caller of the *_by_dao methods
    sns_wasm : Principal; // SNS-W
    archive_controllers : [Principal]; // co-controllers of ICRC-3 archives (the SNS root)
  };

  // views
  public type RunBy = { account : AccountId; name : ?Text };
  public type AccountView = {
    id : AccountId;
    name : ?Text;
    verified : Bool;
    verification : ?Verification;
    avatar : ?AvatarRef;
    members : [Member];
    hotkeys : [Principal]; // only shown to the account's owners and hotkeys
    created_at : Nat64;
    updated_at : Nat64;
  };
  public type CanisterView = {
    canister : Principal;
    name : Text;
    verified : Bool;
    verification : ?Verification;
    avatar : ?AvatarRef;
    run_by : ?RunBy;
    set_by : Principal;
    updated_at : Nat64;
  };
  public type NameInfo = {
    name : ?Text;
    verified : Bool;
    avatar : ?AvatarRef;
    kind : { #account : AccountId; #canister };
    dapp : ?DappId; // this principal's dapp label in its account
    run_by : ?RunBy;
  };
  public type SearchHit = {
    name : Text;
    verified : Bool;
    avatar : ?AvatarRef;
    target : { #account : { id : AccountId; members : [{ principal : Principal; dapp : ?DappId }] }; #canister : Principal };
  };
  public type ChangeRef = { #account : AccountId; #canister : Principal };
  public type Change = {
    seq : Nat;
    ref : ChangeRef;
    state : ?{ #account : AccountView; #canister : CanisterView }; // null: deleted
  };
  public type ImportItem = { principal : Principal; name : Text; verified : Bool; avatar : ?AvatarRef };
  public type ImportResult = { principal : Principal; result : T.Result };
  public type Stats = { accounts : Nat; named : Nat; canisters : Nat; last_seq : Nat; log_length : Nat; import_closed : Bool };
  public type Result = T.Result;

  type NameRef = { #account : AccountId; #canister : Principal };

  // ---------------------------------------------------------------------------------------------
  // State (enhanced orthogonal persistence: everything not transient survives upgrades)
  // ---------------------------------------------------------------------------------------------

  let MAX_BATCH : Nat = 500;
  let MAX_PAGE : Nat = 500;
  let MAX_SEARCH_MEMBERS : Nat = 10;

  var config : Config = {
    max_members = 50;
    max_hotkeys = 10;
    moderator = null;
    dao_governance = Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai");
    sns_wasm = Principal.fromText(SnsDirectory.SNS_W_MAINNET);
    archive_controllers = [];
  };
  var admins : [Principal] = [];
  var import_closed : Bool = false;

  let accounts = Map.new<AccountId, Account>();
  var next_account_id : AccountId = 1;
  let pid_account = Map.new<Principal, AccountId>(); // member principal -> account
  let hotkey_accounts = Map.new<Principal, [AccountId]>(); // hotkey -> the accounts it may manage
  let canisters = Map.new<Principal, CanisterName>();
  let index : NameIndex.State<NameRef> = NameIndex.init<NameRef>();

  // changes feed: the latest change of each entity, by sequence number
  func Nat_ops() : OrderedMap.Operations<Nat> = OrderedMap.Make<Nat>(Nat.compare);
  func compareRef(a : ChangeRef, b : ChangeRef) : Order.Order {
    switch (a, b) {
      case (#account(x), #account(y)) Nat.compare(x, y);
      case (#canister(x), #canister(y)) Principal.compare(x, y);
      case (#account _, #canister _) #less;
      case (#canister _, #account _) #greater;
    };
  };
  func Ref_ops() : OrderedMap.Operations<ChangeRef> = OrderedMap.Make<ChangeRef>(compareRef);

  var seq : Nat = 0;
  var changes : OrderedMap.Map<Nat, ChangeRef> = Nat_ops().empty<ChangeRef>();
  var last_change : OrderedMap.Map<ChangeRef, Nat> = Ref_ops().empty<Nat>();

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

  func logInfo(cid : Nat, caller : Principal, m : Text) = TextLog.add(textlog, #info, cid, caller, m);
  func logError(cid : Nat, caller : Principal, m : Text) = TextLog.add(textlog, #error, cid, caller, m);

  func touch(ref : ChangeRef) {
    let ops = Nat_ops();
    switch (Ref_ops().get(last_change, ref)) {
      case (?old) changes := ops.delete(changes, old);
      case null {};
    };
    seq += 1;
    changes := ops.put(changes, seq, ref);
    last_change := Ref_ops().put(last_change, ref, seq);
  };

  // ---- ICRC-3 ----

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_pid_names#block-types";
    block_types = [
      "sneednames_account_create",
      "sneednames_account_delete",
      "sneednames_name_set",
      "sneednames_avatar_set",
      "sneednames_member_link",
      "sneednames_member_unlink",
      "sneednames_member_update",
      "sneednames_hotkey_add",
      "sneednames_hotkey_remove",
      "sneednames_account_merge",
      "sneednames_verify",
      "sneednames_unverify",
      "sneednames_canister_name_set",
      "sneednames_canister_run_by",
      "sneednames_config_update",
      "sneednames_import",
    ];
  };

  func icrc3_env() : Icrc3Log.Environment {
    {
      self = self();
      archive_controllers = config.archive_controllers;
      cycle_reserve = 2_000_000_000_000;
      new_correlation_id = func() : Nat = TextLog.correlationId(textlog);
      log_info = func(cid : Nat, m : Text) = logInfo(cid, self(), m);
      log_error = func(cid : Nat, m : Text) = logError(cid, self(), m);
    };
  };

  func block(btype : Text, caller : Principal, tx : [(Text, T3.Value)]) {
    ignore Icrc3Log.append(icrc3, "sneednames_" # btype, Int.abs(Time.now()), Array.append<(Text, T3.Value)>([("caller", Icrc3Log.principal(caller))], tx));
  };

  func pv(p : Principal) : T3.Value = Icrc3Log.principal(p);
  func optText(key : Text, t : ?Text) : [(Text, T3.Value)] = switch t { case (?x) [(key, #Text(x))]; case null [] };
  func avatarValue(a : AvatarRef) : T3.Value = switch a { case (#url(u)) #Map([("url", #Text(u))]); case (#blob(h)) #Map([("blob", #Blob(h))]) };
  func optAvatar(key : Text, a : ?AvatarRef) : [(Text, T3.Value)] = switch a { case (?x) [(key, avatarValue(x))]; case null [] };
  func roleText(r : Role) : Text = switch r { case (#owner) "owner"; case (#member) "member" };
  func proofValue(p : LinkProof) : T3.Value = switch p {
    case (#self_) #Text("self");
    case (#hotkey) #Text("hotkey");
    case (#admin) #Text("admin");
    case (#import_) #Text("import");
    case (#neuron_stake(n)) #Map([("sns_root", pv(n.sns_root)), ("neuron_id", #Blob(n.neuron_id)), ("memo", Icrc3Log.nat64(n.memo))]);
  };
  func sourceValue(s : T.VerifySource) : T3.Value = switch s {
    case (#admin(p)) #Map([("admin", pv(p))]);
    case (#dao) #Text("dao");
    case (#sns_governance(p)) #Map([("sns_governance", pv(p))]);
    case (#import_) #Text("import");
  };

  // ---- accounts ----

  func accountOf(p : Principal) : ?Account = switch (Map.get(pid_account, Map.phash, p)) {
    case (?id) Map.get(accounts, Map.nhash, id);
    case null null;
  };

  func memberIn(a : Account, p : Principal) : ?Member = Array.find<Member>(a.members, func(m) = m.principal == p);
  func isOwner(a : Account, p : Principal) : Bool = switch (memberIn(a, p)) { case (?m) m.role == #owner; case null false };
  func ownerCount(a : Account) : Nat = Array.filter<Member>(a.members, func(m) = m.role == #owner).size();
  func isHotkey(a : Account, p : Principal) : Bool = Array.find<Principal>(a.hotkeys, func(h) = h == p) != null;
  /// Owners and hotkeys manage an account (hotkeys cannot change hotkeys or remove owners).
  func canManage(a : Account, p : Principal) : Bool = isOwner(a, p) or isHotkey(a, p);

  func verified(v : ?Verification, name : ?Text) : Bool = switch (v, name) {
    case (?x, ?n) x.name == n;
    case _ false;
  };

  func newAccount(owner : Principal, via : LinkProof, caller : Principal) : Account {
    let id = next_account_id;
    next_account_id += 1;
    let t = now64();
    let a : Account = {
      id;
      var name = null;
      var verification = null;
      var avatar = null;
      var members = [{ principal = owner; role = #owner; dapp = null; linked_at = t; via }];
      var hotkeys = [];
      created_at = t;
      var updated_at = t;
    };
    Map.set(accounts, Map.nhash, id, a);
    Map.set(pid_account, Map.phash, owner, id);
    block("account_create", caller, [("account", #Nat(id)), ("owner", pv(owner)), ("via", proofValue(via))]);
    touch(#account(id));
    a;
  };

  func addHotkeyIndex(h : Principal, id : AccountId) {
    let ids = switch (Map.get(hotkey_accounts, Map.phash, h)) { case (?x) x; case null [] };
    if (Array.find<AccountId>(ids, func(x) = x == id) == null) Map.set(hotkey_accounts, Map.phash, h, Array.append(ids, [id]));
  };

  func dropHotkeyIndex(h : Principal, id : AccountId) {
    switch (Map.get(hotkey_accounts, Map.phash, h)) {
      case (?ids) {
        let rest = Array.filter<AccountId>(ids, func(x) = x != id);
        if (rest.size() == 0) Map.delete(hotkey_accounts, Map.phash, h) else Map.set(hotkey_accounts, Map.phash, h, rest);
      };
      case null {};
    };
  };

  func deleteAccount(a : Account, caller : Principal) {
    switch (a.name) { case (?n) NameIndex.remove<NameRef>(index, 0, n); case null {} };
    for (m in a.members.vals()) Map.delete(pid_account, Map.phash, m.principal);
    for (h in a.hotkeys.vals()) dropHotkeyIndex(h, a.id);
    Map.delete(accounts, Map.nhash, a.id);
    block("account_delete", caller, Array.flatten<(Text, T3.Value)>([[("account", #Nat(a.id))], optText("name", a.name)]));
    touch(#account(a.id));
  };

  /// An account with nothing left to show (no name, no avatar, at most one member, no hotkeys) is deleted.
  func collect(a : Account, caller : Principal) {
    if (a.members.size() == 0 or (a.name == null and a.avatar == null and a.members.size() <= 1 and a.hotkeys.size() == 0)) {
      deleteAccount(a, caller);
    };
  };

  func nameFree(name : Text, ref : NameRef) : Bool = switch (NameIndex.owner<NameRef>(index, 0, name)) {
    case null true;
    case (?r) sameRef(r, ref);
  };

  func sameRef(a : NameRef, b : NameRef) : Bool = switch (a, b) {
    case (#account(x), #account(y)) x == y;
    case (#canister(x), #canister(y)) x == y;
    case _ false;
  };

  /// Set (or with "" clear) an account's name. The caller has validated the name and checked it is free.
  func applyAccountName(a : Account, name : Text, caller : Principal) {
    let old = a.name;
    switch old { case (?o) NameIndex.remove<NameRef>(index, 0, o); case null {} };
    if (name == "") a.name := null else {
      NameIndex.add<NameRef>(index, 0, name, #account(a.id));
      a.name := ?name;
    };
    let cleared = switch (a.verification) { case (?v) v.name != name; case null false };
    if (cleared) a.verification := null;
    a.updated_at := now64();
    block("name_set", caller, Array.flatten<(Text, T3.Value)>([[("account", #Nat(a.id))], optText("old_name", old), optText("name", a.name), (if (cleared) [("verification_cleared", #Nat(1))] else [])]));
    touch(#account(a.id));
  };

  func applyCanisterName(canister : Principal, name : Text, caller : Principal, setBy : Principal) {
    switch (Map.get(canisters, Map.phash, canister)) {
      case (?c) {
        NameIndex.remove<NameRef>(index, 0, c.name);
        if (name == "") {
          Map.delete(canisters, Map.phash, canister);
          block("canister_name_set", caller, [("canister", pv(canister)), ("old_name", #Text(c.name))]);
        } else {
          let old = c.name;
          NameIndex.add<NameRef>(index, 0, name, #canister(canister));
          c.name := name;
          let cleared = switch (c.verification) { case (?v) v.name != name; case null false };
          if (cleared) c.verification := null;
          // a different controller renaming it ends the old "run by" claim
          let runByCleared = c.set_by != setBy and c.run_by != null;
          if (runByCleared) c.run_by := null;
          c.set_by := setBy;
          c.updated_at := now64();
          block("canister_name_set", caller, Array.flatten<(Text, T3.Value)>([[("canister", pv(canister)), ("old_name", #Text(old)), ("name", #Text(name))], (if (cleared) [("verification_cleared", #Nat(1))] else []), (if (runByCleared) [("run_by_cleared", #Nat(1))] else [])]));
        };
      };
      case null {
        if (name == "") return;
        NameIndex.add<NameRef>(index, 0, name, #canister(canister));
        Map.set<Principal, CanisterName>(canisters, Map.phash, canister, { canister; var name = name; var verification = null; var avatar = null; var run_by = null; var set_by = setBy; var updated_at = now64() });
        block("canister_name_set", caller, [("canister", pv(canister)), ("name", #Text(name))]);
      };
    };
    touch(#canister(canister));
  };

  // ---- views ----

  func accountView(a : Account, caller : ?Principal) : AccountView {
    let showHotkeys = switch caller { case (?c) canManage(a, c) or isAdmin(c); case null false };
    {
      id = a.id;
      name = a.name;
      verified = verified(a.verification, a.name);
      verification = a.verification;
      avatar = a.avatar;
      members = a.members;
      hotkeys = if (showHotkeys) a.hotkeys else [];
      created_at = a.created_at;
      updated_at = a.updated_at;
    };
  };

  func runByView(id : ?AccountId) : ?RunBy = switch id {
    case (?i) ?{ account = i; name = switch (Map.get(accounts, Map.nhash, i)) { case (?a) a.name; case null null } };
    case null null;
  };

  func canisterView(c : CanisterName) : CanisterView = {
    canister = c.canister;
    name = c.name;
    verified = verified(c.verification, ?c.name);
    verification = c.verification;
    avatar = c.avatar;
    run_by = runByView(c.run_by);
    set_by = c.set_by;
    updated_at = c.updated_at;
  };

  func nameInfo(p : Principal) : ?NameInfo {
    switch (accountOf(p)) {
      case (?a) {
        let dapp = switch (memberIn(a, p)) { case (?m) m.dapp; case null null };
        return ?{ name = a.name; verified = verified(a.verification, a.name); avatar = a.avatar; kind = #account(a.id); dapp; run_by = null };
      };
      case null {};
    };
    switch (Map.get(canisters, Map.phash, p)) {
      case (?c) ?{ name = ?c.name; verified = verified(c.verification, ?c.name); avatar = c.avatar; kind = #canister; dapp = null; run_by = runByView(c.run_by) };
      case null null;
    };
  };

  // ---- shared checks ----

  func signedIn(caller : Principal) : ?Text {
    if (Principal.isAnonymous(caller)) ?"Please sign in" else null;
  };

  func controls(caller : Principal, canister : Principal) : async* { #ok; #err : Text } {
    await* Control.controls(sns, config.sns_wasm, caller, canister);
  };

  // ---------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------

  /// Names of up to 500 principals, in order (null: no name or avatar).
  public query func get_names(principals : [Principal]) : async [?NameInfo] {
    if (principals.size() > MAX_BATCH) Error_trap("At most 500 principals per call");
    Array.map<Principal, ?NameInfo>(principals, nameInfo);
  };

  public query func get_name(p : Principal) : async ?NameInfo { nameInfo(p) };

  /// Accounts and canisters whose name, or a word in it, starts with `prefix`.
  public query func search(args : { prefix : Text; limit : Nat; kind : ?{ #account; #canister } }) : async [SearchHit] {
    let keep = func(r : NameRef) : Bool = switch (args.kind, r) {
      case (null, _) true;
      case (?#account, #account _) true;
      case (?#canister, #canister _) true;
      case _ false;
    };
    let hits = NameIndex.search<NameRef>(index, 0, args.prefix, args.limit, keep, sameRef);
    Array.mapFilter<(NameRef, Text), SearchHit>(hits, func((r, _)) = hitOf(r));
  };

  func hitOf(r : NameRef) : ?SearchHit {
    switch r {
      case (#account(id)) switch (Map.get(accounts, Map.nhash, id)) {
        case (?a) switch (a.name) {
          case (?n) ?{
            name = n;
            verified = verified(a.verification, a.name);
            avatar = a.avatar;
            target = #account({
              id;
              members = Array.map<Member, { principal : Principal; dapp : ?DappId }>(
                Array.subArray<Member>(a.members, 0, Nat.min(MAX_SEARCH_MEMBERS, a.members.size())),
                func(m) = { principal = m.principal; dapp = m.dapp },
              );
            });
          };
          case null null;
        };
        case null null;
      };
      case (#canister(p)) switch (Map.get(canisters, Map.phash, p)) {
        case (?c) ?{ name = c.name; verified = verified(c.verification, ?c.name); avatar = c.avatar; target = #canister(p) };
        case null null;
      };
    };
  };

  /// All names in alphabetical (lowercase) order, a page at a time.
  public query func list_names(page : T.Page<Text>) : async { items : [SearchHit]; next : ?Text } {
    let (items, next) = NameIndex.page<NameRef>(index, 0, page.start_after, Nat.min(page.limit, MAX_PAGE));
    { items = Array.mapFilter<(NameRef, Text), SearchHit>(items, func((r, _)) = hitOf(r)); next };
  };

  public query ({ caller }) func get_account(id : AccountId) : async ?AccountView {
    switch (Map.get(accounts, Map.nhash, id)) { case (?a) ?accountView(a, ?caller); case null null };
  };

  public query ({ caller }) func get_account_of(p : Principal) : async ?AccountView {
    switch (accountOf(p)) { case (?a) ?accountView(a, ?caller); case null null };
  };

  public query func get_canister_name(p : Principal) : async ?CanisterView {
    switch (Map.get(canisters, Map.phash, p)) { case (?c) ?canisterView(c); case null null };
  };

  /// Pending invites for the caller.
  /// What changed after sequence number `after`, oldest first: each entity once, with its current
  /// state (null when deleted). Page through with the last item's seq; empty when caught up.
  public query func changes_since(args : { after : Nat; limit : Nat }) : async { items : [Change]; last_seq : Nat } {
    let limit = Nat.min(args.limit, MAX_PAGE);
    let out = Buffer.Buffer<Change>(limit);
    label walk for ((s, ref) in NameIndex.entriesFrom<Nat, ChangeRef>(changes, Nat.compare, args.after + 1)) {
      if (out.size() >= limit) break walk;
      let state : ?{ #account : AccountView; #canister : CanisterView } = switch ref {
        case (#account(id)) switch (Map.get(accounts, Map.nhash, id)) { case (?a) ?#account(accountView(a, null)); case null null };
        case (#canister(p)) switch (Map.get(canisters, Map.phash, p)) { case (?c) ?#canister(canisterView(c)); case null null };
      };
      out.add({ seq = s; ref; state });
    };
    { items = Buffer.toArray(out); last_seq = seq };
  };

  public query func stats() : async Stats {
    {
      accounts = Map.size(accounts);
      named = NameIndex.size<NameRef>(index);
      canisters = Map.size(canisters);
      last_seq = seq;
      log_length = icrc3.log_length;
      import_closed;
    };
  };

  public query func get_config() : async Config { config };
  public query func get_admins() : async [Principal] { admins };
  public query ({ caller }) func get_log(start : Nat, length : Nat) : async [T.LogEntry] {
    if (not isAdmin(caller)) Error_trap("Admins only");
    TextLog.get(textlog, start, length);
  };

  func Error_trap(m : Text) : None = Debug.trap(m);

  // ---------------------------------------------------------------------------------------------
  // Your account
  // ---------------------------------------------------------------------------------------------

  /// Set the name of your account ("" clears it). Creates the account on first use.
  public shared ({ caller }) func set_my_name(name : Text) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    if (T.isCanisterId(caller)) return #err("Canisters are named by their controllers (set_canister_name)");
    if (name != "") {
      switch (NameRules.problem(name, 1)) { case (?p) return #err(p); case null {} };
      switch (accountOf(caller)) {
        case (?a) if (not isOwner(a, caller)) return #err("Only the account's owners can rename it");
        case null {};
      };
      let ref : NameRef = switch (accountOf(caller)) { case (?a) #account(a.id); case null #account(0) };
      if (not nameFree(name, ref)) return #err("That name is taken");
      switch (await* Moderation.check(config.moderator, caller, name, true)) { case (#err(e)) return #err(e); case (#ok) {} };
    };
    // re-check after the moderation call: state may have changed meanwhile
    switch (accountOf(caller)) {
      case (?a) {
        if (not isOwner(a, caller)) return #err("Only the account's owners can rename it");
        if (name != "" and not nameFree(name, #account(a.id))) return #err("That name is taken");
        if (a.name == (if (name == "") null else ?name)) return #ok("Unchanged");
        applyAccountName(a, name, caller);
        if (name == "") collect(a, caller);
        #ok(if (name == "") "Name cleared" else "Name set");
      };
      case null {
        if (name == "") return #ok("Unchanged");
        if (not nameFree(name, #account(0))) return #err("That name is taken");
        let a = newAccount(caller, #self_, caller);
        applyAccountName(a, name, caller);
        #ok("Name set");
      };
    };
  };

  /// Set or clear your account's avatar.
  public shared ({ caller }) func set_my_avatar(avatar : ?AvatarRef) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    if (T.isCanisterId(caller)) return #err("Canisters use set_canister_avatar");
    switch avatar { case (?x) switch (T.avatarProblem(x)) { case (?p) return #err(p); case null {} }; case null {} };
    let a = switch (accountOf(caller)) {
      case (?a) {
        if (not isOwner(a, caller)) return #err("Only the account's owners can change its avatar");
        a;
      };
      case null {
        if (avatar == null) return #ok("Unchanged");
        newAccount(caller, #self_, caller);
      };
    };
    a.avatar := avatar;
    a.updated_at := now64();
    block("avatar_set", caller, Array.flatten<(Text, T3.Value)>([[("account", #Nat(a.id))], optAvatar("avatar", avatar)]));
    touch(#account(a.id));
    if (avatar == null) collect(a, caller);
    #ok(if (avatar == null) "Avatar cleared" else "Avatar set");
  };

  /// Give a principal a hotkey on your account: it may then manage the account (rename it, change
  /// its avatar, its principals' labels) and merge it into its own account, which makes your
  /// principal show that account's name. The hotkey needs to do nothing to accept. It is not shown
  /// as one of the account's principals.
  public shared ({ caller }) func add_hotkey(hotkey : Principal) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    if (T.isCanisterId(caller)) return #err("Canisters cannot own accounts");
    if (Principal.isAnonymous(hotkey)) return #err("Not a principal");
    if (hotkey == caller) return #err("That is you");
    let a = switch (accountOf(caller)) {
      case (?a) a;
      case null newAccount(caller, #self_, caller);
    };
    if (not isOwner(a, caller)) return #err("Only the account's owners can add hotkeys");
    if (isHotkey(a, hotkey)) return #ok("Already a hotkey");
    if (memberIn(a, hotkey) != null) return #err("That principal is already in this account");
    if (a.hotkeys.size() >= config.max_hotkeys) return #err("At most " # Nat.toText(config.max_hotkeys) # " hotkeys per account");
    a.hotkeys := Array.append(a.hotkeys, [hotkey]);
    addHotkeyIndex(hotkey, a.id);
    a.updated_at := now64();
    block("hotkey_add", caller, [("account", #Nat(a.id)), ("hotkey", pv(hotkey))]);
    touch(#account(a.id));
    #ok("Hotkey added");
  };

  /// Owners remove a hotkey from their account; a hotkey may remove itself.
  public shared ({ caller }) func remove_hotkey(account : AccountId, hotkey : Principal) : async Result {
    let a = switch (Map.get(accounts, Map.nhash, account)) { case (?a) a; case null return #err("No such account") };
    if (not isOwner(a, caller) and caller != hotkey) return #err("Only the account's owners can remove hotkeys");
    if (not isHotkey(a, hotkey)) return #err("Not a hotkey of this account");
    a.hotkeys := Array.filter<Principal>(a.hotkeys, func(h) = h != hotkey);
    dropHotkeyIndex(hotkey, a.id);
    a.updated_at := now64();
    block("hotkey_remove", caller, [("account", #Nat(a.id)), ("hotkey", pv(hotkey))]);
    touch(#account(a.id));
    collect(a, caller);
    #ok("Hotkey removed");
  };

  /// The accounts the caller may manage as a hotkey.
  public query ({ caller }) func my_hotkey_accounts() : async [AccountView] {
    switch (Map.get(hotkey_accounts, Map.phash, caller)) {
      case (?ids) Array.mapFilter<AccountId, AccountView>(ids, func(id) = switch (Map.get(accounts, Map.nhash, id)) { case (?a) ?accountView(a, ?caller); case null null });
      case null [];
    };
  };

  /// Rename an account you own or have a hotkey on ("" clears the name).
  public shared ({ caller }) func set_account_name(account : AccountId, name : Text) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    let check = func() : ?Text {
      switch (Map.get(accounts, Map.nhash, account)) {
        case (?a) {
          if (not canManage(a, caller)) return ?"You do not manage this account";
          if (name != "" and not nameFree(name, #account(account))) return ?"That name is taken";
          null;
        };
        case null ?"No such account";
      };
    };
    if (name != "") switch (NameRules.problem(name, 1)) { case (?p) return #err(p); case null {} };
    switch (check()) { case (?e) return #err(e); case null {} };
    if (name != "") switch (await* Moderation.check(config.moderator, caller, name, true)) { case (#err(e)) return #err(e); case (#ok) {} };
    switch (check()) { case (?e) return #err(e); case null {} };
    switch (Map.get(accounts, Map.nhash, account)) {
      case (?a) {
        if (a.name == (if (name == "") null else ?name)) return #ok("Unchanged");
        applyAccountName(a, name, caller);
        if (name == "") collect(a, caller);
        #ok(if (name == "") "Name cleared" else "Name set");
      };
      case null #err("No such account");
    };
  };

  /// Set or clear the avatar of an account you own or have a hotkey on.
  public shared ({ caller }) func set_account_avatar(account : AccountId, avatar : ?AvatarRef) : async Result {
    switch avatar { case (?x) switch (T.avatarProblem(x)) { case (?p) return #err(p); case null {} }; case null {} };
    let a = switch (Map.get(accounts, Map.nhash, account)) { case (?a) a; case null return #err("No such account") };
    if (not canManage(a, caller)) return #err("You do not manage this account");
    a.avatar := avatar;
    a.updated_at := now64();
    block("avatar_set", caller, Array.flatten<(Text, T3.Value)>([[("account", #Nat(a.id))], optAvatar("avatar", avatar)]));
    touch(#account(a.id));
    if (avatar == null) collect(a, caller);
    #ok(if (avatar == null) "Avatar cleared" else "Avatar set");
  };

  /// Merge an account you have a hotkey on (or own) into your own: its principals join your account
  /// as members and show its name from then on. If your account has no name it takes the merged
  /// account's name (and checkmark); otherwise the merged account's name is freed. The merged
  /// account and its hotkeys are deleted.
  public shared ({ caller }) func merge_account(from : AccountId) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    if (T.isCanisterId(caller)) return #err("Canisters cannot own accounts");
    let src = switch (Map.get(accounts, Map.nhash, from)) { case (?a) a; case null return #err("No such account") };
    if (not canManage(src, caller)) return #err("You need a hotkey on that account");
    if (memberIn(src, caller) != null) return #err("You are in that account already");
    switch (accountOf(caller)) { case (?a) if (not isOwner(a, caller)) return #err("Only owners can merge into their account"); case null {} };
    let dst = switch (accountOf(caller)) { case (?a) a; case null newAccount(caller, #self_, caller) };
    if (dst.members.size() + src.members.size() > config.max_members) return #err("Together the accounts would have more than " # Nat.toText(config.max_members) # " principals");
    let takeName = dst.name == null and src.name != null;
    let srcName = src.name;
    let srcVerification = src.verification;
    let moved = src.members;
    // free the source first (its name, principals and hotkeys)
    src.members := [];
    deleteAccount(src, caller);
    for (m in moved.vals()) {
      addMember(dst, { principal = m.principal; role = #member; dapp = m.dapp; linked_at = now64(); via = #hotkey }, caller);
    };
    if (takeName) {
      switch srcName {
        case (?n) if (nameFree(n, #account(dst.id))) {
          applyAccountName(dst, n, caller);
          switch srcVerification { case (?v) if (v.name == n) dst.verification := ?v; case null {} };
        };
        case null {};
      };
    };
    if (dst.avatar == null) dst.avatar := src.avatar;
    block("account_merge", caller, [("from", #Nat(from)), ("into", #Nat(dst.id)), ("principals", #Nat(moved.size()))]);
    touch(#account(dst.id));
    #ok("Merged");
  };

  func addMember(a : Account, m : Member, caller : Principal) {
    a.members := Array.append(a.members, [m]);
    Map.set(pid_account, Map.phash, m.principal, a.id);
    a.updated_at := now64();
    block("member_link", caller, Array.flatten<(Text, T3.Value)>([[("account", #Nat(a.id)), ("principal", pv(m.principal)), ("role", #Text(roleText(m.role))), ("via", proofValue(m.via))], (switch (m.dapp) { case (?d) [("dapp", #Nat(d))]; case null [] })]));
    touch(#account(a.id));
  };

  /// Link a principal that staked an SNS neuron you have a permission on (it gave you a hotkey).
  /// The neuron's id must be the staking subaccount of `principal` with `memo`, which proves that
  /// principal created the neuron; it must still hold ManagePrincipals on it.
  /// For principals you cannot sign in with here (e.g. your NNS dapp principal).
  public shared ({ caller }) func link_by_neuron(sns_root : Principal, neuron_id : Blob, memo : Nat64, principal : Principal, dapp : ?DappId) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    if (T.isCanisterId(caller)) return #err("Canisters cannot own accounts");
    if (Principal.isAnonymous(principal) or T.isCanisterId(principal)) return #err("Only people's principals can join an account");
    if (principal == caller) return #err("You are already in your account");
    if (SnsDirectory.stakingNeuronId(principal, memo) != neuron_id) return #err("That neuron was not staked by that principal with that memo");
    switch (accountOf(caller)) { case (?a) if (not isOwner(a, caller)) return #err("Only the account's owners can link principals"); case null {} };
    if (Option.isSome(accountOf(principal))) return #err("That principal is already in an account; it can leave it first");
    let governance = switch (await* SnsDirectory.governanceOf(sns, config.sns_wasm, sns_root)) {
      case (?g) g;
      case null return #err("Not a deployed SNS");
    };
    let neuron = switch (await* SnsDirectory.getNeuron(governance, neuron_id)) {
      case (?n) n;
      case null return #err("No such neuron in that SNS");
    };
    if (not SnsDirectory.hasPermission(neuron, principal, SnsDirectory.PERMISSION_MANAGE_PRINCIPALS)) return #err("That principal no longer manages the neuron");
    if (not SnsDirectory.hasAnyPermission(neuron, caller)) return #err("You have no permission on that neuron");
    // re-check after the calls
    if (Option.isSome(accountOf(principal))) return #err("That principal is already in an account; it can leave it first");
    let a = switch (accountOf(caller)) {
      case (?a) {
        if (not isOwner(a, caller)) return #err("Only the account's owners can link principals");
        a;
      };
      case null newAccount(caller, #self_, caller);
    };
    if (a.members.size() >= config.max_members) return #err("The account is full");
    addMember(a, { principal; role = #member; dapp; linked_at = now64(); via = #neuron_stake({ sns_root; neuron_id; memo }) }, caller);
    #ok("Linked");
  };

  /// Remove a principal from an account you manage (hotkeys cannot remove owners), or leave it
  /// (the principal itself). The last owner cannot go while others remain; when the last principal
  /// goes, the account is deleted.
  public shared ({ caller }) func remove_member(principal : Principal) : async Result {
    let a = switch (accountOf(principal)) { case (?a) a; case null return #err("That principal is not in an account") };
    let m = switch (memberIn(a, principal)) { case (?m) m; case null return #err("That principal is not in the account") };
    if (principal != caller and not canManage(a, caller)) return #err("You do not manage this account");
    if (principal != caller and m.role == #owner and not isOwner(a, caller)) return #err("Only owners can remove owners");
    if (m.role == #owner and ownerCount(a) == 1 and a.members.size() > 1) return #err("Make another principal an owner first");
    a.members := Array.filter<Member>(a.members, func(x) = x.principal != principal);
    Map.delete(pid_account, Map.phash, principal);
    a.updated_at := now64();
    block("member_unlink", caller, [("account", #Nat(a.id)), ("principal", pv(principal))]);
    touch(#account(a.id));
    collect(a, caller);
    #ok(if (principal == caller) "Left the account" else "Removed");
  };

  /// Owners set a member's role and dapp label; hotkeys and the member itself may set its dapp label.
  public shared ({ caller }) func set_member(principal : Principal, role : Role, dapp : ?DappId) : async Result {
    let a = switch (accountOf(principal)) { case (?a) a; case null return #err("That principal is not in an account") };
    let m = switch (memberIn(a, principal)) { case (?m) m; case null return #err("That principal is not in the account") };
    if (role != m.role and not isOwner(a, caller)) return #err("Only the account's owners can change roles");
    if (not canManage(a, caller) and caller != principal) return #err("You do not manage this account");
    if (m.role == #owner and role == #member and ownerCount(a) == 1) return #err("An account needs an owner");
    a.members := Array.map<Member, Member>(a.members, func(x) = if (x.principal == principal) { { x with role; dapp } } else x);
    a.updated_at := now64();
    block("member_update", caller, Array.flatten<(Text, T3.Value)>([[("account", #Nat(a.id)), ("principal", pv(principal)), ("role", #Text(roleText(role)))], (switch dapp { case (?d) [("dapp", #Nat(d))]; case null [] })]));
    touch(#account(a.id));
    #ok("Updated");
  };

  // ---------------------------------------------------------------------------------------------
  // Canister names
  // ---------------------------------------------------------------------------------------------

  /// Name a canister you control ("" clears). An SNS's governance canister may name the canisters its root controls.
  public shared ({ caller }) func set_canister_name(canister : Principal, name : Text) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    if (not T.isCanisterId(canister)) return #err("Not a canister id");
    if (name != "") {
      switch (NameRules.problem(name, 2)) { case (?p) return #err(p); case null {} };
      if (not nameFree(name, #canister(canister))) return #err("That name is taken");
    };
    switch (await* controls(caller, canister)) { case (#err(e)) return #err(e); case (#ok) {} };
    if (name != "") {
      switch (await* Moderation.check(config.moderator, caller, name, true)) { case (#err(e)) return #err(e); case (#ok) {} };
      if (not nameFree(name, #canister(canister))) return #err("That name is taken");
    };
    applyCanisterName(canister, name, caller, caller);
    #ok(if (name == "") "Name cleared" else "Name set");
  };

  public shared ({ caller }) func set_canister_avatar(canister : Principal, avatar : ?AvatarRef) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    switch avatar { case (?x) switch (T.avatarProblem(x)) { case (?p) return #err(p); case null {} }; case null {} };
    switch (await* controls(caller, canister)) { case (#err(e)) return #err(e); case (#ok) {} };
    switch (Map.get(canisters, Map.phash, canister)) {
      case (?c) {
        c.avatar := avatar;
        c.updated_at := now64();
        block("avatar_set", caller, Array.flatten<(Text, T3.Value)>([[("canister", pv(canister))], optAvatar("avatar", avatar)]));
        touch(#canister(canister));
        #ok("Avatar set");
      };
      case null #err("Name the canister first");
    };
  };

  /// Say which account runs a canister ("Trading Bot · run by Snassy"). The caller controls the
  /// canister and owns that account; null clears it.
  public shared ({ caller }) func set_canister_run_by(canister : Principal, account : ?AccountId) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    switch account {
      case (?id) switch (Map.get(accounts, Map.nhash, id)) {
        case (?a) if (not isOwner(a, caller)) return #err("You can only name accounts you own");
        case null return #err("No such account");
      };
      case null {};
    };
    switch (await* controls(caller, canister)) { case (#err(e)) return #err(e); case (#ok) {} };
    switch (Map.get(canisters, Map.phash, canister)) {
      case (?c) {
        // re-check ownership after the call
        switch account {
          case (?id) switch (Map.get(accounts, Map.nhash, id)) {
            case (?a) if (not isOwner(a, caller)) return #err("You can only name accounts you own");
            case null return #err("No such account");
          };
          case null {};
        };
        c.run_by := account;
        c.updated_at := now64();
        block("canister_run_by", caller, Array.flatten<(Text, T3.Value)>([[("canister", pv(canister))], (switch account { case (?id) [("account", #Nat(id))]; case null [] })]));
        touch(#canister(canister));
        #ok("Updated");
      };
      case null #err("Name the canister first");
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Verification (admins and Sneed DAO proposals)
  // ---------------------------------------------------------------------------------------------

  func checkVerify(p : Principal, expected : Text) : { #ok : NameRef; #err : Text } {
    switch (accountOf(p)) {
      case (?a) return if (a.name == ?expected) #ok(#account(a.id)) else #err("The name is not " # expected);
      case null {};
    };
    switch (Map.get(canisters, Map.phash, p)) {
      case (?c) if (c.name == expected) #ok(#canister(p)) else #err("The name is not " # expected);
      case null #err("That principal has no name");
    };
  };

  func applyVerify(ref : NameRef, expected : Text, source : T.VerifySource, caller : Principal) {
    let v : Verification = { name = expected; source; at = now64() };
    switch ref {
      case (#account(id)) switch (Map.get(accounts, Map.nhash, id)) {
        case (?a) {
          a.verification := ?v;
          a.updated_at := now64();
          block("verify", caller, [("account", #Nat(id)), ("name", #Text(expected)), ("source", sourceValue(source))]);
          touch(#account(id));
        };
        case null {};
      };
      case (#canister(p)) switch (Map.get(canisters, Map.phash, p)) {
        case (?c) {
          c.verification := ?v;
          c.updated_at := now64();
          block("verify", caller, [("canister", pv(p)), ("name", #Text(expected)), ("source", sourceValue(source))]);
          touch(#canister(p));
        };
        case null {};
      };
    };
  };

  func applyUnverify(p : Principal, caller : Principal) : Result {
    switch (accountOf(p)) {
      case (?a) {
        if (a.verification == null) return #err("Not verified");
        a.verification := null;
        a.updated_at := now64();
        block("unverify", caller, [("account", #Nat(a.id))]);
        touch(#account(a.id));
        return #ok("Unverified");
      };
      case null {};
    };
    switch (Map.get(canisters, Map.phash, p)) {
      case (?c) {
        if (c.verification == null) return #err("Not verified");
        c.verification := null;
        c.updated_at := now64();
        block("unverify", caller, [("canister", pv(p))]);
        touch(#canister(p));
        #ok("Unverified");
      };
      case null #err("That principal has no name");
    };
  };

  /// Give the checkmark to the name `expected_name` of `principal`'s account or canister.
  public shared ({ caller }) func verify(principal : Principal, expected_name : Text) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (checkVerify(principal, expected_name)) {
      case (#ok(ref)) { applyVerify(ref, expected_name, #admin(caller), caller); #ok("Verified") };
      case (#err(e)) #err(e);
    };
  };

  public shared ({ caller }) func unverify(principal : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    applyUnverify(principal, caller);
  };

  /// Generic nervous system function target: Sneed DAO verifies a name.
  public shared ({ caller }) func verify_by_dao(principal : Principal, expected_name : Text) : async () {
    if (caller != config.dao_governance) Error_trap("Only Sneed DAO governance");
    switch (checkVerify(principal, expected_name)) {
      case (#ok(ref)) applyVerify(ref, expected_name, #dao, caller);
      case (#err(e)) Error_trap(e);
    };
  };

  public query func validate_verify_by_dao(principal : Principal, expected_name : Text) : async T.ValidationResult {
    switch (checkVerify(principal, expected_name)) {
      case (#ok(_)) #Ok("Verify the name \"" # expected_name # "\" of " # Principal.toText(principal));
      case (#err(e)) #Err(e);
    };
  };

  public shared ({ caller }) func unverify_by_dao(principal : Principal) : async () {
    if (caller != config.dao_governance) Error_trap("Only Sneed DAO governance");
    switch (applyUnverify(principal, caller)) { case (#ok _) {}; case (#err(e)) Error_trap(e) };
  };

  public query func validate_unverify_by_dao(principal : Principal) : async T.ValidationResult {
    switch (nameInfo(principal)) {
      case (?i) if (i.verified) #Ok("Remove the checkmark from " # Principal.toText(principal)) else #Err("Not verified");
      case null #Err("That principal has no name");
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Administration
  // ---------------------------------------------------------------------------------------------

  /// Set the name of a principal's account (created if needed) or of a canister. No moderation.
  public shared ({ caller }) func admin_set_name(principal : Principal, name : Text) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (T.isCanisterId(principal)) {
      if (name != "") {
        switch (NameRules.problem(name, 2)) { case (?p) return #err(p); case null {} };
        if (not nameFree(name, #canister(principal))) return #err("That name is taken");
      };
      applyCanisterName(principal, name, caller, caller);
      return #ok("Set");
    };
    if (name != "") switch (NameRules.problem(name, 1)) { case (?p) return #err(p); case null {} };
    switch (accountOf(principal)) {
      case (?a) {
        if (name != "" and not nameFree(name, #account(a.id))) return #err("That name is taken");
        applyAccountName(a, name, caller);
        if (name == "") collect(a, caller);
      };
      case null {
        if (name == "") return #ok("Unchanged");
        if (not nameFree(name, #account(0))) return #err("That name is taken");
        applyAccountName(newAccount(principal, #admin, caller), name, caller);
      };
    };
    #ok("Set");
  };

  /// Remove an abusive avatar.
  public shared ({ caller }) func admin_clear_avatar(principal : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (accountOf(principal)) {
      case (?a) {
        a.avatar := null;
        block("avatar_set", caller, [("account", #Nat(a.id))]);
        touch(#account(a.id));
        collect(a, caller);
        return #ok("Cleared");
      };
      case null {};
    };
    switch (Map.get(canisters, Map.phash, principal)) {
      case (?c) {
        c.avatar := null;
        block("avatar_set", caller, [("canister", pv(principal))]);
        touch(#canister(principal));
        #ok("Cleared");
      };
      case null #err("Nothing to clear");
    };
  };

  public shared ({ caller }) func admin_set_config(c : Config) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (c.max_members < 1 or c.max_members > 1_000) return #err("max_members must be 1-1000");
    if (c.max_hotkeys > 100) return #err("max_hotkeys must be at most 100");
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

  // ---- one-time import from the backend (spec §10) ----

  /// Import names: self-authenticating principals become one-owner accounts, canister ids become
  /// canister names. A verified flag becomes an import verification of the name as imported.
  public shared ({ caller }) func admin_import_names(items : [ImportItem]) : async [ImportResult] {
    if (not isAdmin(caller)) Error_trap("Admins only");
    if (import_closed) Error_trap("Import is closed");
    if (items.size() > MAX_BATCH) Error_trap("At most 500 items per call");
    Array.map<ImportItem, ImportResult>(items, func(it) = { principal = it.principal; result = importOne(it, caller) });
  };

  func importOne(it : ImportItem, caller : Principal) : Result {
    if (Principal.isAnonymous(it.principal)) return #err("anonymous");
    let canister = T.isCanisterId(it.principal);
    switch (NameRules.problem(it.name, if canister 2 else 1)) { case (?p) return #err(p); case null {} };
    switch (it.avatar) { case (?x) switch (T.avatarProblem(x)) { case (?p) return #err(p); case null {} }; case null {} };
    if (canister) {
      if (Map.has(canisters, Map.phash, it.principal)) return #err("already imported");
      if (not nameFree(it.name, #canister(it.principal))) return #err("name taken");
      applyCanisterName(it.principal, it.name, caller, caller);
      switch (Map.get(canisters, Map.phash, it.principal)) {
        case (?c) {
          c.avatar := it.avatar;
          if (it.verified) c.verification := ?{ name = it.name; source = #import_; at = now64() };
        };
        case null {};
      };
    } else {
      if (Option.isSome(accountOf(it.principal))) return #err("already imported");
      if (not nameFree(it.name, #account(0))) return #err("name taken");
      let a = newAccount(it.principal, #import_, caller);
      applyAccountName(a, it.name, caller);
      a.avatar := it.avatar;
      if (it.verified) a.verification := ?{ name = it.name; source = #import_; at = now64() };
    };
    block("import", caller, Array.flatten<(Text, T3.Value)>([[("principal", pv(it.principal)), ("name", #Text(it.name)), ("verified", #Nat(if (it.verified) 1 else 0))], optAvatar("avatar", it.avatar)]));
    touch(if canister #canister(it.principal) else #account(switch (accountOf(it.principal)) { case (?a) a.id; case null 0 }));
    #ok("imported");
  };

  /// Close the import for good.
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
    if (not isAdmin(caller)) Error_trap("Admins only");
    await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
  };

  func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };
  func ensure_icrc3_timer<system>() { Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job) };

  system func postupgrade() {
    Icrc3Log.certify(icrc3);
    ensure_icrc3_timer<system>();
  };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo)
  // ---------------------------------------------------------------------------------------------

  system func inspect({ caller : Principal; arg : Blob; msg : {
    #add_hotkey : Any;
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
    #get_account : Any;
    #get_account_of : Any;
    #get_admins : Any;
    #get_canister_name : Any;
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
    #link_by_neuron : Any;
    #list_names : Any;
    #merge_account : Any;
    #my_hotkey_accounts : Any;
    #remove_hotkey : Any;
    #remove_member : Any;
    #search : Any;
    #set_account_avatar : Any;
    #set_account_name : Any;
    #set_canister_avatar : Any;
    #set_canister_name : Any;
    #set_canister_run_by : Any;
    #set_member : Any;
    #set_my_avatar : Any;
    #set_my_name : Any;
    #stats : Any;
    #unverify : Any;
    #unverify_by_dao : Any;
    #validate_unverify_by_dao : Any;
    #validate_verify_by_dao : Any;
    #verify : Any;
    #verify_by_dao : Any;
  } }) : Bool {
    switch msg {
      // queries are free as queries; as updates the canister would pay for consensus
      case (#changes_since _ or #get_account _ or #get_account_of _ or #get_admins _ or #get_canister_name _ or #get_config _ or #get_log _ or #get_name _ or #get_names _ or #icrc10_supported_standards _ or #icrc3_get_archives _ or #icrc3_get_blocks _ or #icrc3_get_tip_certificate _ or #icrc3_log_status _ or #icrc3_supported_block_types _ or #list_names _ or #my_hotkey_accounts _ or #search _ or #stats _ or #validate_unverify_by_dao _ or #validate_verify_by_dao _) false;
      // only governance canisters call these, never by ingress
      case (#verify_by_dao _ or #unverify_by_dao _) false;
      case (#admin_import_names _) isAdmin(caller) and arg.size() <= 2_000_000;
      case (#admin_set_config _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(1_000);
      case (#admin_set_icrc3_settings _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#admin_add_admin _ or #admin_clear_avatar _ or #admin_finish_import _ or #admin_icrc3_repair_archive_controllers _ or #admin_icrc3_spill_now _ or #admin_remove_admin _ or #admin_set_name _ or #unverify _ or #verify _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#set_my_avatar _ or #set_account_avatar _ or #set_canister_avatar _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(T.MAX_URL_LENGTH);
      case _ not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };

  ensure_icrc3_timer<system>();
};
